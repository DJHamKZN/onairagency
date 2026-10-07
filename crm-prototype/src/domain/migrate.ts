/**
 * Миграция сохранённых данных к текущей схеме.
 *
 * Схема 1 → 2 (07.10.2026): чек-лист запуска стал проверкой готовности, договорённости берутся из принятой версии КП.
 *  - пункты с прежними идентификаторами (goal_first_result, accepted_scope, payment_status, scope_exclusions, revisions,
 *    promises) переносятся в `launch.legacyItems` вместе с отметками, комментариями, автором и датой — ничего не теряется;
 *  - статус «done» оставшихся пунктов становится «ready» (Готово), комментарий и автор сохраняются;
 *  - недостающие пункты новой схемы добавляются со статусом «Не проверено»;
 *  - неизвестные статусы становятся «Не проверено» с исходным значением в комментарии.
 *
 * Функции чистые и идемпотентные: повторный запуск на уже мигрированных данных ничего не меняет.
 */
import { newId } from './ids';
import { CHECKLIST_KEYS, LEGACY_CHECKLIST, checklistLabel } from './launch';
import type { ChangeEvent, ChecklistItem, ChecklistKey, ChecklistStatus, LegacyChecklistItem, Opportunity } from './types';

export const CURRENT_SCHEMA_VERSION = 2;

const STATUSES: ChecklistStatus[] = ['open', 'ready', 'deviation', 'deviation_accepted', 'not_applicable'];
const isKey = (k: unknown): k is ChecklistKey => typeof k === 'string' && (CHECKLIST_KEYS as string[]).includes(k);

export interface OpportunityMigration {
  opportunityId: string;
  title: string;
  changes: string[];
  before: { key: string; status: string }[];
  after: { key: string; status: string }[];
  legacyAdded: LegacyChecklistItem[];
}

type RawItem = Partial<ChecklistItem> & { key?: unknown; status?: unknown };

/** Приводит возможность к текущей схеме. Возвращает null, если менять нечего. Исходный объект не изменяется. */
export function migrateOpportunity(source: Opportunity, at: string): { opp: Opportunity; migration: OpportunityMigration } | null {
  const launch = source.launch as Opportunity['launch'] | undefined;
  const rawItems: RawItem[] = Array.isArray(launch?.items) ? (launch!.items as RawItem[]) : [];
  const changes: string[] = [];
  const legacyAdded: LegacyChecklistItem[] = [];
  const kept = new Map<ChecklistKey, ChecklistItem>();

  for (const raw of rawItems) {
    const key = typeof raw.key === 'string' ? raw.key : String(raw.key);
    const status = typeof raw.status === 'string' ? raw.status : String(raw.status);
    const note = raw.note ?? null;
    const naReason = raw.naReason ?? null;
    if (!isKey(key) || kept.has(key)) {
      const legacy = LEGACY_CHECKLIST[key];
      legacyAdded.push({
        key, label: legacy?.label ?? checklistLabel(key), status, note, naReason,
        updatedBy: raw.updatedBy ?? null, updatedAt: raw.updatedAt ?? null,
        nowCoveredBy: legacy?.nowCoveredBy ?? (kept.has(key as ChecklistKey) ? 'Повторяющийся пункт — основная запись сохранена' : 'Нет соответствующего пункта в текущей версии'),
        migratedAt: at,
      });
      continue;
    }
    let nextStatus: ChecklistStatus;
    let nextNote = note;
    if ((STATUSES as string[]).includes(status)) nextStatus = status as ChecklistStatus;
    else if (status === 'done') {
      nextStatus = 'ready';
      changes.push(`«${checklistLabel(key)}»: «выполнено» → «Готово»`);
    } else {
      nextStatus = 'open';
      nextNote = [note, `Прежний статус «${status}» не распознан`].filter(Boolean).join('. ');
      changes.push(`«${checklistLabel(key)}»: неизвестный статус «${status}» → «Не проверено»`);
    }
    kept.set(key, {
      key, status: nextStatus, note: nextNote, naReason: nextStatus === 'not_applicable' ? naReason : (naReason ?? null),
      deviationDecision: raw.deviationDecision ?? null, updatedBy: raw.updatedBy ?? null, updatedAt: raw.updatedAt ?? null,
    });
  }

  for (const l of legacyAdded)
    changes.push(`«${l.label}» (${l.status === 'done' ? 'выполнено' : l.status === 'open' ? 'не отмечено' : l.status}) перенесено в «Отметки прежней версии»: теперь — ${l.nowCoveredBy}`);

  const items: ChecklistItem[] = CHECKLIST_KEYS.map((key) => {
    const k = kept.get(key);
    if (k) return k;
    changes.push(`Добавлен пункт «${checklistLabel(key)}» — «Не проверено»`);
    return { key, status: 'open', note: null, naReason: null, deviationDecision: null, updatedBy: null, updatedAt: null };
  });

  const orderChanged = rawItems.length !== items.length || rawItems.some((r, i) => r.key !== items[i]?.key);
  const fieldsMissing = rawItems.some((r) => r.deviationDecision === undefined);
  const paymentMissing = !launch?.payment;
  if (!changes.length && !orderChanged && !fieldsMissing && !paymentMissing) return null;

  const opp: Opportunity = structuredClone(source);
  opp.launch = {
    ...(launch ?? { linkSharedAt: null }),
    items,
    payment: launch?.payment ?? { status: 'unknown', note: null },
    linkSharedAt: launch?.linkSharedAt ?? null,
    legacyItems: [...(launch?.legacyItems ?? []), ...legacyAdded],
  };
  if (!opp.launch.legacyItems!.length) delete opp.launch.legacyItems;
  if (changes.length && (opp.handoffAcceptances?.length || opp.launchAuthorizations?.length))
    changes.push('Пакет передачи изменился по составу проверок: приёмку проджектом и разрешение владельца нужно подтвердить заново');

  return {
    opp,
    migration: {
      opportunityId: source.id, title: source.title, changes,
      before: rawItems.map((r) => ({ key: String(r.key), status: String(r.status) })),
      after: items.map((i) => ({ key: i.key, status: i.status })),
      legacyAdded,
    },
  };
}

/** Событие журнала о миграции (выполнено системой, а не пользователем). */
export function migrationEvent(m: OpportunityMigration, at: string, isDemo: boolean): ChangeEvent {
  return {
    id: newId('evt'), opportunityId: m.opportunityId, entityType: 'LaunchChecklist', entityId: 'schema', action: 'schema_migrated',
    userId: 'system', actingRole: 'system', at,
    before: { items: m.before }, after: { items: m.after, legacyItems: m.legacyAdded.map((l) => ({ key: l.key, label: l.label, status: l.status })) },
    reason: `Данные приведены к схеме ${CURRENT_SCHEMA_VERSION}: ${m.changes.length ? m.changes.join('; ') : 'служебные поля дополнены'}`,
    override: false, isDemo,
  };
}

export interface BackupMigrationResult {
  fromVersion: number;
  migrations: OpportunityMigration[];
}

/**
 * Миграция сырого объекта резервной копии (до проверки типов). Изменяет переданный объект: возможности приводятся к
 * текущей схеме, в журнал добавляются события `schema_migrated`, версия схемы повышается.
 */
export function migrateBackupObject(raw: Record<string, unknown>, at: string): BackupMigrationResult {
  const fromVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : NaN;
  const migrations: OpportunityMigration[] = [];
  if (Array.isArray(raw.opportunities)) {
    const events = Array.isArray(raw.changeEvents) ? (raw.changeEvents as ChangeEvent[]) : [];
    raw.opportunities = (raw.opportunities as Opportunity[]).map((o) => {
      if (!o || typeof o !== 'object' || !o.launch || typeof o.launch !== 'object') return o;
      const r = migrateOpportunity(o, at);
      if (!r) return o;
      migrations.push(r.migration);
      events.push(migrationEvent(r.migration, at, !!o.isDemo));
      return r.opp;
    });
    raw.changeEvents = events;
  }
  raw.schemaVersion = CURRENT_SCHEMA_VERSION;
  return { fromVersion, migrations };
}
