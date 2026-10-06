import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Миграции применяются по порядку и записываются в schema_migrations.
 * Журнал изменений и снимки утверждений — append-only: UPDATE запрещён триггерами всегда,
 * DELETE — для всех записей, кроме помеченных как демо (очистка демо-базы).
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  roles TEXT NOT NULL,             -- JSON-массив ролей
  password_hash TEXT,              -- scrypt; никогда не попадает в экспорт и журнал
  is_demo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,     -- хранится только хэш токена
  user_id TEXT NOT NULL REFERENCES users(id),
  acting_role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  is_demo INTEGER NOT NULL
);
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  is_demo INTEGER NOT NULL
);
CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  stage TEXT NOT NULL,
  data TEXT NOT NULL,              -- агрегат возможности (JSON), проверяется доменной логикой
  version INTEGER NOT NULL,        -- optimistic concurrency
  updated_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL
);
CREATE INDEX opportunities_company ON opportunities(company_id);
CREATE TABLE change_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  opportunity_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT NOT NULL,
  acting_role TEXT NOT NULL,
  at TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  override INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL
);
CREATE INDEX change_events_opp ON change_events(opportunity_id, seq);
CREATE TRIGGER change_events_no_update BEFORE UPDATE ON change_events
BEGIN SELECT RAISE(ABORT, 'change_events is append-only'); END;
CREATE TRIGGER change_events_no_delete BEFORE DELETE ON change_events WHEN OLD.is_demo = 0
BEGIN SELECT RAISE(ABORT, 'change_events is append-only'); END;
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  hash TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  is_demo INTEGER NOT NULL
);
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON snapshots
BEGIN SELECT RAISE(ABORT, 'snapshots are immutable'); END;
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON snapshots WHEN OLD.is_demo = 0
BEGIN SELECT RAISE(ABORT, 'snapshots are immutable'); END;
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  version INTEGER NOT NULL
);
`,
  },
];

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
