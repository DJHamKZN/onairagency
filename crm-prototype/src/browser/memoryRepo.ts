/**
 * Хранилище веб-демо: данные в памяти страницы, копия — в localStorage этого браузера.
 * Повторяет контракт серверного хранилища (RepoLike), включая проверку версии записи и append-only журнал.
 * Не является защищённым хранилищем: пользователь браузера может изменить или стереть данные.
 */
import type { Backup } from '../domain/backup';
import { BACKUP_WARNING, SCHEMA_VERSION } from '../domain/backup';
import type { EventDraft } from '../domain/commands';
import { ConflictError, newId } from '../domain/ids';
import type { ChangeEvent, Company, Contact, Opportunity, Role, Settings, Snapshot, User } from '../domain/types';
import type { RepoLike } from '../../server/repoTypes';
import { DEFAULT_SETTINGS, sanitizeForJournal } from '../../server/storeShared';

interface State {
  users: User[];
  companies: Company[];
  contacts: Contact[];
  opportunities: Opportunity[];
  events: ChangeEvent[];
  snapshots: Snapshot[];
  settings: { data: Settings; version: number };
}

const empty = (): State => ({ users: [], companies: [], contacts: [], opportunities: [], events: [], snapshots: [], settings: { data: DEFAULT_SETTINGS, version: 0 } });
const clone = <T,>(v: T): T => structuredClone(v);

export class MemoryRepo implements RepoLike {
  private s: State = empty();
  private depth = 0;
  constructor(private onCommit: (r: MemoryRepo) => void = () => {}) {}

  /** Транзакция: при ошибке состояние откатывается к снимку. */
  transaction<T>(fn: () => T): T {
    const before = this.depth === 0 ? clone(this.s) : null;
    this.depth++;
    try {
      const r = fn();
      this.depth--;
      if (this.depth === 0) this.onCommit(this);
      return r;
    } catch (e) {
      this.depth--;
      if (before) this.s = before;
      throw e;
    }
  }
  private write(fn: () => void) {
    if (this.depth > 0) fn();
    else this.transaction(fn);
  }

  userByLogin(login: string) {
    const u = this.s.users.find((x) => x.login === login);
    return u ? { ...clone(u), passwordHash: null } : null;
  }
  userById(id: string) {
    const u = this.s.users.find((x) => x.id === id);
    return u ? clone(u) : null;
  }
  users() { return clone(this.s.users); }
  upsertUser(u: User, _passwordHash: string | null = null) {
    void _passwordHash; // в веб-демо паролей нет
    this.write(() => {
      this.s.users = [...this.s.users.filter((x) => x.id !== u.id), clone(u)];
    });
  }
  companies() { return clone(this.s.companies).sort((a, b) => a.name.localeCompare(b.name)); }
  company(id: string) {
    const c = this.s.companies.find((x) => x.id === id);
    return c ? clone(c) : null;
  }
  insertCompany(c: Company) { this.write(() => { this.s.companies.push(clone(c)); }); }
  contacts(companyId?: string) { return clone(this.s.contacts.filter((c) => !companyId || c.companyId === companyId)); }
  insertContact(c: Contact) { this.write(() => { this.s.contacts.push(clone(c)); }); }
  opportunities() { return clone(this.s.opportunities).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  opportunity(id: string) {
    const o = this.s.opportunities.find((x) => x.id === id);
    return o ? clone(o) : null;
  }
  insertOpportunity(o: Opportunity) {
    this.write(() => {
      if (this.s.opportunities.some((x) => x.id === o.id)) throw new Error('Дублирующийся ID возможности');
      this.s.opportunities.push(clone(o));
    });
  }
  saveOpportunity(o: Opportunity, expectedVersion: number): number {
    const i = this.s.opportunities.findIndex((x) => x.id === o.id);
    if (i < 0 || this.s.opportunities[i].rev !== expectedVersion) throw new ConflictError(i < 0 ? -1 : this.s.opportunities[i].rev);
    const next = expectedVersion + 1;
    this.write(() => { this.s.opportunities[i] = { ...clone(o), rev: next }; });
    return next;
  }
  appendEvents(opportunityId: string | null, drafts: EventDraft[], userId: string, actingRole: Role | 'system', at: string, isDemo: boolean) {
    this.write(() => {
      for (const d of drafts)
        this.s.events.push({
          id: newId('evt'), opportunityId, entityType: d.entityType, entityId: d.entityId, action: d.action, userId, actingRole, at,
          before: sanitizeForJournal(d.before) ?? null, after: sanitizeForJournal(d.after) ?? null, reason: d.reason, override: !!d.override, isDemo,
        });
    });
  }
  events(opportunityId?: string) { return clone(this.s.events.filter((e) => !opportunityId || e.opportunityId === opportunityId)); }
  insertSnapshot(s: Snapshot) { this.write(() => { this.s.snapshots.push(clone(s)); }); }
  snapshots() { return clone(this.s.snapshots); }
  settings() { return clone(this.s.settings); }
  saveSettings(data: Settings, expectedVersion: number) {
    if (expectedVersion !== this.s.settings.version) throw new ConflictError(this.s.settings.version);
    this.write(() => { this.s.settings = { data: clone(data), version: expectedVersion + 1 }; });
    return expectedVersion + 1;
  }
  exportBackup(): Backup {
    return {
      format: 'onair-crm-backup', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), warning: BACKUP_WARNING,
      users: this.users(), companies: this.companies(), contacts: this.contacts(), opportunities: this.opportunities(),
      changeEvents: this.events(), snapshots: this.snapshots(), settings: this.settings().data,
    };
  }
  /** Загрузка в пустое хранилище (как восстановление на чистой базе). */
  importInto(b: Backup) {
    this.transaction(() => {
      if (this.s.opportunities.length || this.s.companies.length) throw new Error('Восстановление выполняется только в чистое хранилище');
      this.s = {
        users: clone(b.users), companies: clone(b.companies), contacts: clone(b.contacts), opportunities: clone(b.opportunities),
        events: clone(b.changeEvents), snapshots: clone(b.snapshots), settings: { data: clone(b.settings), version: 1 },
      };
    });
  }
  clearDemo() {
    this.transaction(() => {
      const keep = this.s.opportunities.filter((o) => !o.isDemo);
      const usedCompanies = new Set(keep.map((o) => o.companyId));
      this.s.opportunities = keep;
      this.s.events = this.s.events.filter((e) => !e.isDemo);
      this.s.snapshots = this.s.snapshots.filter((x) => !x.isDemo);
      this.s.contacts = this.s.contacts.filter((c) => !c.isDemo);
      this.s.companies = this.s.companies.filter((c) => !c.isDemo || usedCompanies.has(c.id));
    });
  }
  /** Полный сброс (для «начать заново» и неудачного чтения сохранения). */
  resetAll() { this.s = empty(); }
}
