/** Миграция уже сохранённых записей хранилища к текущей схеме (локальная база прежней версии). Без node-зависимостей. */
import { migrateOpportunity, migrationEvent, type OpportunityMigration } from '../src/domain/migrate';
import type { RepoLike } from './repoTypes';

export function migrateStoredData(repo: RepoLike, at: string = new Date().toISOString()): OpportunityMigration[] {
  const done: OpportunityMigration[] = [];
  for (const o of repo.opportunities()) {
    const r = migrateOpportunity(o, at);
    if (!r) continue;
    const ev = migrationEvent(r.migration, at, o.isDemo);
    repo.transaction(() => {
      repo.saveOpportunity(r.opp, o.rev);
      repo.appendEvents(o.id, [{ entityType: ev.entityType, entityId: ev.entityId, action: ev.action, before: ev.before, after: ev.after, reason: ev.reason }], 'system', 'system', at, o.isDemo);
    });
    done.push(r.migration);
  }
  return done;
}
