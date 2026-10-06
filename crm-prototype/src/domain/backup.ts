/**
 * Формат резервной копии и её проверка перед импортом.
 * Проверка ничего не меняет: сначала валидация и предварительный результат, затем — отдельное подтверждение.
 */
import { z } from 'zod';
import type { ChangeEvent, Company, Contact, Opportunity, Settings, Snapshot, User } from './types';

export const SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export const BACKUP_WARNING =
  'ВНУТРЕННЯЯ РЕЗЕРВНАЯ КОПИЯ. Содержит себестоимость, ставки, маржу, комиссии, внутренние комментарии и журнал. ' +
  'Не передавать клиенту. Пароли и сессии не включены. Это ручной экспорт, а не автоматическое резервное копирование.';

export interface Backup {
  format: 'onair-crm-backup';
  schemaVersion: number;
  exportedAt: string;
  warning: string;
  users: User[];
  companies: Company[];
  contacts: Contact[];
  opportunities: Opportunity[];
  changeEvents: ChangeEvent[];
  snapshots: Snapshot[];
  settings: Settings;
}

const id = z.string().min(1).max(100);
const base = { id, createdAt: z.string(), createdBy: z.string(), updatedAt: z.string(), updatedBy: z.string(), rev: z.number().int().nonnegative(), isDemo: z.boolean() };
const withId = z.object({ id }).passthrough();

const stage = z.enum(['new_request', 'clarifying', 'preparing_proposal', 'discussing_proposal', 'preparing_launch', 'handed_off', 'paused', 'closed_lost']);
const role = z.enum(['owner', 'presale_pm', 'lead_specialist', 'specialist', 'receiving_pm']);

const opportunitySchema = z
  .object({
    ...base,
    title: z.string().max(500),
    companyId: id,
    stage,
    originalRequest: z.string().max(20000),
    ownerUserId: id,
    presalePmUserId: id.nullable(),
    leadSpecialistUserId: id.nullable(),
    specialistUserIds: z.array(id),
    receivingPmUserId: id.nullable(),
    nextStep: z.object({ text: z.string(), assigneeUserId: id, due: z.string() }),
    related: z.array(z.object({ opportunityId: id, relation: z.enum(['paid_diagnostic', 'implementation']) })),
    sources: z.array(withId.and(z.object({ text: z.string().max(80000), status: z.string(), version: z.number().int() }))),
    facts: z.array(withId.and(z.object({ sourceId: id.nullable(), key: z.string() }))),
    proposedChanges: z.array(withId.and(z.object({ sourceId: id }))),
    conflicts: z.array(withId.and(z.object({ factId: id, proposedChangeId: id }))),
    promises: z.array(withId),
    clarifications: z.array(withId),
    tasks: z.array(withId),
    audit: z.object({ modules: z.array(z.object({ key: z.string(), status: z.string() }).passthrough()) }).passthrough(),
    findings: z.array(withId.and(z.object({ code: z.string(), sourceId: id.nullable() }))),
    workItems: z.array(withId),
    estimates: z.array(withId.and(z.object({ number: z.number().int(), lines: z.array(withId) }))),
    commissionRules: z.array(withId),
    proposals: z.array(withId.and(z.object({ number: z.number().int(), status: z.string(), estimateVersionId: id, previousVersionId: id.nullable(), content: z.object({ workItemIds: z.array(id) }).passthrough() }))),
    approvals: z.array(withId.and(z.object({ proposalVersionId: id, estimateVersionId: id, snapshotId: id, snapshotHash: z.string(), status: z.enum(['active', 'revoked']) }))),
    launch: z.object({ items: z.array(z.object({ key: z.string(), status: z.enum(['open', 'done', 'not_applicable']) }).passthrough()) }).passthrough(),
    handoffAcceptances: z.array(withId),
    launchAuthorizations: z.array(withId),
    findingSeq: z.number().int().nonnegative(),
  })
  .passthrough();

const backupSchema = z.object({
  format: z.literal('onair-crm-backup'),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  warning: z.string(),
  users: z.array(z.object({ id, login: z.string(), displayName: z.string(), roles: z.array(role), isDemo: z.boolean() }).strict()),
  companies: z.array(z.object({ ...base, name: z.string().min(1).max(300), note: z.string().nullable() })),
  contacts: z.array(z.object({ ...base, companyId: id, label: z.string(), decisionRole: z.string() })),
  opportunities: z.array(opportunitySchema),
  changeEvents: z.array(z.object({ id, opportunityId: id.nullable(), entityType: z.string(), entityId: z.string(), action: z.string(), userId: z.string(), at: z.string(), isDemo: z.boolean() }).passthrough()),
  snapshots: z.array(z.object({ id, opportunityId: id, kind: z.enum(['approval', 'proposal_sent']), hash: z.string(), createdAt: z.string(), isDemo: z.boolean() }).passthrough()),
  settings: z.object({}).passthrough(),
});

export interface ImportPreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
  backup: Backup | null;
}

/** Полная проверка: размер → JSON → версия схемы → типы → ссылки. Ничего не записывает. */
export function validateBackupText(text: string): ImportPreview {
  const fail = (e: string): ImportPreview => ({ ok: false, errors: [e], warnings: [], counts: {}, backup: null });
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) return fail(`Файл больше ${MAX_BACKUP_BYTES / 1024 / 1024} МБ`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail(`Повреждённый JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object') return fail('Ожидается объект резервной копии');
  const r = raw as Record<string, unknown>;
  if (r.format !== 'onair-crm-backup') return fail('Это не резервная копия ON AIR CRM (поле format)');
  if (r.schemaVersion !== SCHEMA_VERSION) return fail(`Неподдерживаемая версия схемы: ${String(r.schemaVersion)}. Ожидается ${SCHEMA_VERSION}`);
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`), warnings: [], counts: {}, backup: null };
  const b = raw as Backup;
  const errors = referenceErrors(b);
  return {
    ok: errors.length === 0,
    errors,
    warnings: b.opportunities.some((o) => !o.isDemo) ? ['В копии есть записи без признака демо-данных. Прототип не предназначен для реальных клиентских данных'] : [],
    counts: {
      'Компании': b.companies.length,
      'Контакты': b.contacts.length,
      'Возможности': b.opportunities.length,
      'Версии КП': b.opportunities.reduce((s, o) => s + o.proposals.length, 0),
      'Утверждения': b.opportunities.reduce((s, o) => s + o.approvals.length, 0),
      'События журнала': b.changeEvents.length,
      'Снимки': b.snapshots.length,
    },
    backup: errors.length ? null : b,
  };
}

export function referenceErrors(b: Backup): string[] {
  const e: string[] = [];
  const users = new Set(b.users.map((u) => u.id));
  const companies = new Set(b.companies.map((c) => c.id));
  const opps = new Set(b.opportunities.map((o) => o.id));
  const snaps = new Set(b.snapshots.map((s) => s.id));
  const dup = (label: string, ids: string[]) => {
    const s = new Set<string>();
    for (const i of ids) { if (s.has(i)) e.push(`${label}: повторяющийся ID ${i}`); s.add(i); }
  };
  dup('Компании', b.companies.map((c) => c.id));
  dup('Возможности', b.opportunities.map((o) => o.id));
  dup('События', b.changeEvents.map((x) => x.id));
  for (const c of b.contacts) if (!companies.has(c.companyId)) e.push(`Контакт ${c.id}: компания ${c.companyId} отсутствует`);
  for (const o of b.opportunities) {
    const p = `Возможность «${o.title}» (${o.id})`;
    if (!companies.has(o.companyId)) e.push(`${p}: компания ${o.companyId} отсутствует`);
    for (const u of [o.ownerUserId, o.presalePmUserId, o.leadSpecialistUserId, o.receivingPmUserId, o.nextStep.assigneeUserId, ...o.specialistUserIds])
      if (u && !users.has(u)) e.push(`${p}: пользователь ${u} отсутствует`);
    for (const r of o.related) if (!opps.has(r.opportunityId)) e.push(`${p}: связанная возможность ${r.opportunityId} отсутствует`);
    const src = new Set(o.sources.map((s) => s.id));
    const facts = new Set(o.facts.map((f) => f.id));
    const pcs = new Set(o.proposedChanges.map((x) => x.id));
    const finds = new Set(o.findings.map((f) => f.id));
    const works = new Set(o.workItems.map((w) => w.id));
    const ests = new Set(o.estimates.map((x) => x.id));
    const props = new Set(o.proposals.map((x) => x.id));
    const rules = new Set(o.commissionRules.map((x) => x.id));
    for (const f of o.facts) if (f.sourceId && !src.has(f.sourceId)) e.push(`${p}: факт ${f.id} ссылается на отсутствующий источник`);
    for (const x of o.proposedChanges) if (!src.has(x.sourceId)) e.push(`${p}: предложение ${x.id} ссылается на отсутствующий источник`);
    for (const c of o.conflicts) if (!facts.has(c.factId) || !pcs.has(c.proposedChangeId)) e.push(`${p}: противоречие ${c.id} с разорванной ссылкой`);
    for (const f of o.findings) if (f.sourceId && !src.has(f.sourceId)) e.push(`${p}: находка ${f.code} ссылается на отсутствующий источник`);
    for (const w of o.workItems) if (w.basis?.type === 'finding' && !finds.has(w.basis.findingId)) e.push(`${p}: работа ${w.id} ссылается на отсутствующую находку`);
    for (const est of o.estimates) if (est.commissionRuleId && !rules.has(est.commissionRuleId)) e.push(`${p}: расчёт v${est.number} ссылается на отсутствующее правило комиссии`);
    for (const pr of o.proposals) {
      if (!ests.has(pr.estimateVersionId)) e.push(`${p}: КП v${pr.number} без расчёта`);
      if (pr.previousVersionId && !props.has(pr.previousVersionId)) e.push(`${p}: КП v${pr.number} ссылается на отсутствующую прежнюю версию`);
      for (const w of pr.content.workItemIds) if (!works.has(w)) e.push(`${p}: КП v${pr.number} ссылается на отсутствующую работу`);
      if (pr.frozenSnapshotId && !snaps.has(pr.frozenSnapshotId)) e.push(`${p}: КП v${pr.number} — отсутствует снимок отправки`);
    }
    for (const a of o.approvals) {
      if (!props.has(a.proposalVersionId) || !ests.has(a.estimateVersionId)) e.push(`${p}: утверждение ${a.id} с разорванной ссылкой`);
      if (!snaps.has(a.snapshotId)) e.push(`${p}: утверждение ${a.id} — отсутствует неизменяемый снимок`);
    }
  }
  for (const ev of b.changeEvents) if (ev.opportunityId && !opps.has(ev.opportunityId) && !ev.isDemo) e.push(`Событие ${ev.id}: возможность ${ev.opportunityId} отсутствует`);
  for (const s of b.snapshots) if (!opps.has(s.opportunityId)) e.push(`Снимок ${s.id}: возможность отсутствует`);
  return e;
}
