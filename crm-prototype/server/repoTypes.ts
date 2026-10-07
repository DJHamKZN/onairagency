import type { Backup } from '../src/domain/backup';
import type { EventDraft } from '../src/domain/commands';
import type { ChangeEvent, Company, Contact, Opportunity, Role, Settings, Snapshot, User } from '../src/domain/types';

/** Контракт хранилища. Реализации: SQLite на сервере (repo.ts) и память браузера для веб-демо (src/browser/memoryRepo.ts). */
export interface RepoLike {
  transaction<T>(fn: () => T): T;
  userByLogin(login: string): (User & { passwordHash: string | null }) | null;
  userById(id: string): User | null;
  users(): User[];
  upsertUser(u: User, passwordHash: string | null): void;
  companies(): Company[];
  company(id: string): Company | null;
  insertCompany(c: Company): void;
  contacts(companyId?: string): Contact[];
  insertContact(c: Contact): void;
  opportunities(): Opportunity[];
  opportunity(id: string): Opportunity | null;
  insertOpportunity(o: Opportunity): void;
  saveOpportunity(o: Opportunity, expectedVersion: number): number;
  appendEvents(opportunityId: string | null, drafts: EventDraft[], userId: string, actingRole: Role | 'system', at: string, isDemo: boolean): void;
  events(opportunityId?: string): ChangeEvent[];
  insertSnapshot(s: Snapshot): void;
  snapshots(): Snapshot[];
  settings(): { data: Settings; version: number };
  saveSettings(s: Settings, expectedVersion: number): number;
  exportBackup(): Backup;
  importInto(b: Backup): void;
  clearDemo(): void;
}
