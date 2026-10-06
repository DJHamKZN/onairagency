import { randomUUID } from 'node:crypto';
import type { EventDraft } from '../src/domain/commands';
import type { Backup } from '../src/domain/backup';
import { BACKUP_WARNING, SCHEMA_VERSION } from '../src/domain/backup';
import type { ChangeEvent, Company, Contact, Opportunity, Role, Settings, Snapshot, User } from '../src/domain/types';
import { tx, type DB } from './db';

export class ConflictError extends Error {
  constructor(public currentVersion: number) {
    super('version_conflict');
  }
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

const SECRET_KEYS = /^(password|password_hash|passwordHash|token|token_hash|secret|apiKey|api_key)$/i;

/** Журнал никогда не хранит секреты: ключи-секреты вырезаются на любой глубине. */
export function sanitizeForJournal(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sanitizeForJournal);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? '[удалено]' : sanitizeForJournal(val);
    return o;
  }
  return v;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultTargetMarginBp: 3000,
  targetMarginApproved: false,
  presaleLimitHoursDefault: null,
  presaleLimitApproved: false,
  rateCard: [
    { role: 'Специалист (демо)', rateKop: 250000, approved: false },
    { role: 'Проджект (демо)', rateKop: 200000, approved: false },
  ],
};

export class Repo {
  constructor(public db: DB) {}

  /* --- users --- */
  userByLogin(login: string): (User & { passwordHash: string | null }) | null {
    const r = this.db.prepare('SELECT * FROM users WHERE login = ?').get(login) as Record<string, unknown> | undefined;
    return r ? { ...rowUser(r), passwordHash: (r.password_hash as string) ?? null } : null;
  }
  userById(id: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? rowUser(r) : null;
  }
  users(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY id').all() as Record<string, unknown>[]).map(rowUser);
  }
  upsertUser(u: User, passwordHash: string | null) {
    this.db
      .prepare(`INSERT INTO users (id, login, display_name, roles, password_hash, is_demo) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET login=excluded.login, display_name=excluded.display_name, roles=excluded.roles,
        password_hash=COALESCE(excluded.password_hash, users.password_hash), is_demo=excluded.is_demo`)
      .run(u.id, u.login, u.displayName, JSON.stringify(u.roles), passwordHash, u.isDemo ? 1 : 0);
  }

  /* --- sessions --- */
  createSession(tokenHash: string, userId: string, role: Role, ttlHours = 8) {
    const now = new Date();
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, acting_role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(tokenHash, userId, role, now.toISOString(), new Date(now.getTime() + ttlHours * 3600_000).toISOString());
  }
  session(tokenHash: string): { userId: string; actingRole: Role } | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, new Date().toISOString()) as Record<string, string> | undefined;
    return r ? { userId: r.user_id, actingRole: r.acting_role as Role } : null;
  }
  setSessionRole(tokenHash: string, role: Role) {
    this.db.prepare('UPDATE sessions SET acting_role = ? WHERE token_hash = ?').run(role, tokenHash);
  }
  deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  /* --- companies / contacts --- */
  companies(): Company[] {
    return (this.db.prepare('SELECT data FROM companies ORDER BY name').all() as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  company(id: string): Company | null {
    const r = this.db.prepare('SELECT data FROM companies WHERE id = ?').get(id) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : null;
  }
  insertCompany(c: Company) {
    this.db.prepare('INSERT INTO companies (id, name, data, version, is_demo) VALUES (?, ?, ?, ?, ?)').run(c.id, c.name, JSON.stringify(c), c.rev, c.isDemo ? 1 : 0);
  }
  contacts(companyId?: string): Contact[] {
    const rows = companyId
      ? (this.db.prepare('SELECT data FROM contacts WHERE company_id = ?').all(companyId) as { data: string }[])
      : (this.db.prepare('SELECT data FROM contacts').all() as { data: string }[]);
    return rows.map((r) => JSON.parse(r.data));
  }
  insertContact(c: Contact) {
    this.db.prepare('INSERT INTO contacts (id, company_id, data, version, is_demo) VALUES (?, ?, ?, ?, ?)').run(c.id, c.companyId, JSON.stringify(c), c.rev, c.isDemo ? 1 : 0);
  }

  /* --- opportunities --- */
  opportunities(): Opportunity[] {
    return (this.db.prepare('SELECT data, version FROM opportunities ORDER BY updated_at DESC').all() as { data: string; version: number }[]).map((r) => ({
      ...JSON.parse(r.data),
      rev: r.version,
    }));
  }
  opportunity(id: string): Opportunity | null {
    const r = this.db.prepare('SELECT data, version FROM opportunities WHERE id = ?').get(id) as { data: string; version: number } | undefined;
    return r ? { ...JSON.parse(r.data), rev: r.version } : null;
  }
  insertOpportunity(o: Opportunity) {
    this.db
      .prepare('INSERT INTO opportunities (id, company_id, stage, data, version, updated_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(o.id, o.companyId, o.stage, JSON.stringify(o), o.rev, o.updatedAt, o.isDemo ? 1 : 0);
  }
  /** Сохранение с проверкой версии: при несовпадении — ConflictError, чужие изменения не перезаписываются. */
  saveOpportunity(o: Opportunity, expectedVersion: number): number {
    const next = expectedVersion + 1;
    const saved = { ...o, rev: next };
    const r = this.db
      .prepare('UPDATE opportunities SET stage = ?, data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
      .run(saved.stage, JSON.stringify(saved), next, saved.updatedAt, saved.id, expectedVersion);
    if (Number(r.changes) !== 1) {
      const cur = this.db.prepare('SELECT version FROM opportunities WHERE id = ?').get(o.id) as { version: number } | undefined;
      throw new ConflictError(cur?.version ?? -1);
    }
    return next;
  }

  /* --- journal & snapshots --- */
  appendEvents(opportunityId: string | null, drafts: EventDraft[], userId: string, actingRole: Role | 'system', at: string, isDemo: boolean) {
    const st = this.db.prepare(
      `INSERT INTO change_events (id, opportunity_id, entity_type, entity_id, action, user_id, acting_role, at, before_json, after_json, reason, override, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const d of drafts)
      st.run(newId('evt'), opportunityId, d.entityType, d.entityId, d.action, userId, actingRole, at,
        JSON.stringify(sanitizeForJournal(d.before) ?? null), JSON.stringify(sanitizeForJournal(d.after) ?? null), d.reason, d.override ? 1 : 0, isDemo ? 1 : 0);
  }
  events(opportunityId?: string): ChangeEvent[] {
    const rows = (opportunityId
      ? this.db.prepare('SELECT * FROM change_events WHERE opportunity_id = ? ORDER BY seq').all(opportunityId)
      : this.db.prepare('SELECT * FROM change_events ORDER BY seq').all()) as Record<string, unknown>[];
    return rows.map(rowEvent);
  }
  insertSnapshot(s: Snapshot) {
    this.db.prepare('INSERT INTO snapshots (id, opportunity_id, kind, hash, data, created_at, created_by, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.id, s.opportunityId, s.kind, s.hash, JSON.stringify(s.data), s.createdAt, s.createdBy, s.isDemo ? 1 : 0);
  }
  snapshots(): Snapshot[] {
    return (this.db.prepare('SELECT * FROM snapshots').all() as Record<string, unknown>[]).map((r) => ({
      id: r.id as string, opportunityId: r.opportunity_id as string, kind: r.kind as Snapshot['kind'], hash: r.hash as string,
      data: JSON.parse(r.data as string), createdAt: r.created_at as string, createdBy: r.created_by as string, isDemo: !!r.is_demo,
    }));
  }

  /* --- settings --- */
  settings(): { data: Settings; version: number } {
    const r = this.db.prepare('SELECT data, version FROM settings WHERE id = 1').get() as { data: string; version: number } | undefined;
    if (!r) return { data: DEFAULT_SETTINGS, version: 0 };
    return { data: JSON.parse(r.data), version: r.version };
  }
  saveSettings(s: Settings, expectedVersion: number) {
    if (expectedVersion === 0) {
      const ex = this.db.prepare('SELECT version FROM settings WHERE id = 1').get() as { version: number } | undefined;
      if (ex) throw new ConflictError(ex.version);
      this.db.prepare('INSERT INTO settings (id, data, version) VALUES (1, ?, 1)').run(JSON.stringify(s));
      return 1;
    }
    const r = this.db.prepare('UPDATE settings SET data = ?, version = version + 1 WHERE id = 1 AND version = ?').run(JSON.stringify(s), expectedVersion);
    if (Number(r.changes) !== 1) throw new ConflictError(this.settings().version);
    return expectedVersion + 1;
  }

  /* --- backup --- */
  exportBackup(): Backup {
    return {
      format: 'onair-crm-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      warning: BACKUP_WARNING,
      users: this.users(),
      companies: this.companies(),
      contacts: this.contacts(),
      opportunities: this.opportunities(),
      changeEvents: this.events(),
      snapshots: this.snapshots(),
      settings: this.settings().data,
    };
  }

  /** Загрузка копии в ПУСТУЮ базу (используется для восстановления в отдельный файл). */
  importInto(b: Backup) {
    tx(this.db, () => {
      const existing = this.db.prepare('SELECT (SELECT COUNT(*) FROM opportunities) + (SELECT COUNT(*) FROM companies) AS n').get() as { n: number };
      if (existing.n > 0) throw new Error('Восстановление выполняется только в чистую базу');
      for (const u of b.users) this.upsertUser(u, null);
      for (const c of b.companies) this.insertCompany(c);
      for (const c of b.contacts) this.insertContact(c);
      for (const o of b.opportunities) this.insertOpportunity(o);
      const st = this.db.prepare(
        `INSERT INTO change_events (id, opportunity_id, entity_type, entity_id, action, user_id, acting_role, at, before_json, after_json, reason, override, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of b.changeEvents)
        st.run(e.id, e.opportunityId, e.entityType, e.entityId, e.action, e.userId, e.actingRole, e.at, JSON.stringify(e.before ?? null), JSON.stringify(e.after ?? null), e.reason ?? null, e.override ? 1 : 0, e.isDemo ? 1 : 0);
      for (const s of b.snapshots) this.insertSnapshot(s);
      this.db.prepare('INSERT INTO settings (id, data, version) VALUES (1, ?, 1)').run(JSON.stringify(b.settings));
    });
  }

  /** Удаляет только записи с признаком демо-данных. */
  clearDemo() {
    tx(this.db, () => {
      this.db.prepare('DELETE FROM change_events WHERE is_demo = 1').run();
      this.db.prepare('DELETE FROM snapshots WHERE is_demo = 1').run();
      this.db.prepare('DELETE FROM opportunities WHERE is_demo = 1').run();
      this.db.prepare('DELETE FROM contacts WHERE is_demo = 1').run();
      this.db.prepare('DELETE FROM companies WHERE is_demo = 1 AND id NOT IN (SELECT company_id FROM opportunities)').run();
    });
  }
}

function rowUser(r: Record<string, unknown>): User {
  return { id: r.id as string, login: r.login as string, displayName: r.display_name as string, roles: JSON.parse(r.roles as string), isDemo: !!r.is_demo };
}

function rowEvent(r: Record<string, unknown>): ChangeEvent {
  return {
    id: r.id as string,
    opportunityId: (r.opportunity_id as string) ?? null,
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    action: r.action as string,
    userId: r.user_id as string,
    actingRole: r.acting_role as ChangeEvent['actingRole'],
    at: r.at as string,
    before: r.before_json ? JSON.parse(r.before_json as string) : null,
    after: r.after_json ? JSON.parse(r.after_json as string) : null,
    reason: (r.reason as string) ?? null,
    override: !!r.override,
    isDemo: !!r.is_demo,
  };
}
