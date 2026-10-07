import { worksOf } from './approval';
import { computeFor } from './economics';
import { hashOf } from './hash';
import type { ChecklistItem, ChecklistKey, ChecklistStatus, LaunchChecklist, Opportunity, ProposalVersion } from './types';

/**
 * Передача в работу. Договорённости (объём, результат, исключения, правки, стоимость, зависимости, оплата, сроки)
 * берутся из КОНКРЕТНОЙ принятой версии КП и не вводятся заново. Проджект проверяет готовность и фиксирует отклонения.
 */
export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  terms_reconciled: 'Договорённости из принятой версии КП сверены с реальностью',
  contract: 'Договор',
  materials: 'Материалы клиента получены',
  findings: 'Выводы диагностики переданы',
  open_risks: 'Открытые риски разобраны',
  roles: 'Роли агентства и клиента',
  approvers: 'Согласующие со стороны клиента',
  communication: 'Порядок общения',
  accesses: 'Доступы (ссылка на защищённое место и ответственный, без паролей)',
  performers: 'Исполнители назначены',
  capacity: 'Загрузка исполнителей подтверждена',
  calendar: 'Календарь первого этапа',
  acceptance_baseline: 'Исходные показатели для приёмки зафиксированы',
};

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  open: 'Не проверено',
  ready: 'Готово',
  deviation: 'Отклонение',
  deviation_accepted: 'Отклонение принято владельцем',
  not_applicable: 'Неприменимо',
};

export const CHECKLIST_KEYS = Object.keys(CHECKLIST_LABELS) as ChecklistKey[];

/** Пункты чек-листа прежней версии (до 07.10.2026) и где их смысл находится теперь. Нужны для миграции сохранённых данных. */
export const LEGACY_CHECKLIST: Record<string, { label: string; nowCoveredBy: string }> = {
  goal_first_result: { label: 'Цель и первый результат', nowCoveredBy: 'Договорённости из принятой версии КП (результат и приёмка)' },
  accepted_scope: { label: 'Принятое КП и объём', nowCoveredBy: 'Договорённости из принятой версии КП (работы)' },
  payment_status: { label: 'Фактический статус условий оплаты', nowCoveredBy: 'Отдельное поле «Фактический статус условий оплаты»' },
  scope_exclusions: { label: 'Состав и исключения', nowCoveredBy: 'Договорённости из принятой версии КП (исключения)' },
  revisions: { label: 'Правки', nowCoveredBy: 'Договорённости из принятой версии КП (правки)' },
  promises: { label: 'Обещания агентства разобраны', nowCoveredBy: 'Обещания агентства во «Вводных» (блокер, пока есть «обсуждалось»)' },
};

/** Название пункта для показа. Никогда не возвращает undefined: неизвестный идентификатор показывается как есть. */
export function checklistLabel(key: string): string {
  return (CHECKLIST_LABELS as Record<string, string>)[key] ?? LEGACY_CHECKLIST[key]?.label ?? `Пункт «${key}» (неизвестный)`;
}

export function checklistStatusLabel(status: string): string {
  return (CHECKLIST_STATUS_LABELS as Record<string, string>)[status] ?? (status === 'done' ? 'Выполнено (прежняя версия)' : status);
}

export function emptyChecklist(): LaunchChecklist {
  return {
    items: CHECKLIST_KEYS.map((key): ChecklistItem => ({ key, status: 'open', note: null, naReason: null, deviationDecision: null, updatedBy: null, updatedAt: null })),
    payment: { status: 'unknown', note: null },
    linkSharedAt: null,
  };
}

/** Похоже ли значение на секрет. В доступах храним только ссылку на защищённое место и ответственного. */
export function looksLikeSecret(s: string | null | undefined): boolean {
  if (!s) return false;
  return /(пароль\s*[:=]|password\s*[:=]|passwd|token\s*[:=]|api[_-]?key\s*[:=]|secret\s*[:=]|:\/\/[^\s/:@]+:[^\s/@]+@|-----BEGIN)/i.test(s);
}

export function latestMainProposal(opp: Opportunity): ProposalVersion | null {
  return opp.proposals.reduce<ProposalVersion | null>((a, p) => (!a || p.number > a.number ? p : a), null);
}

export function acceptedProposal(opp: Opportunity): ProposalVersion | null {
  const latest = latestMainProposal(opp);
  return latest && latest.status === 'accepted' ? latest : null;
}

export interface AgreedTerms {
  proposalId: string;
  versionNumber: number;
  acceptedDate: string | null;
  confirmationSource: string | null;
  frozenSnapshotId: string | null;
  works: { id: string; title: string; quantity: number | null; unit: string | null; expectedResult: string | null; acceptanceCriterion: string | null; recurrence: 'one_time' | 'monthly' }[];
  resultAndAcceptance: string | null;
  exclusions: string | null;
  revisions: string | null;
  timeline: string | null;
  dependencies: string | null;
  clientActions: string | null;
  payment: string | null;
  freeWork: string | null;
  extraWorkProcedure: string | null;
  serviceOneTimeKop: number | null;
  serviceMonthlyKop: number | null;
  discountKop: number | null;
  externalBudgets: { label: string; amountKop: number | null; period: string | null; paidBy: string }[];
  confirmedPromises: { what: string; byRole: string }[];
}

/** Договорённости из принятой версии КП (только чтение). null — принятой версии нет. */
export function agreedTerms(opp: Opportunity): AgreedTerms | null {
  const p = acceptedProposal(opp);
  if (!p) return null;
  const est = opp.estimates.find((e) => e.id === p.estimateVersionId);
  const r = est ? computeFor(opp, est) : null;
  const c = p.content;
  return {
    proposalId: p.id,
    versionNumber: p.number,
    acceptedDate: p.accepted?.date ?? null,
    confirmationSource: p.accepted?.confirmationSource ?? null,
    frozenSnapshotId: p.frozenSnapshotId,
    works: worksOf(opp, p).filter((w) => c.workItemIds.includes(w.id)).map((w) => ({
      id: w.id, title: w.title, quantity: w.quantity, unit: w.unit, expectedResult: w.expectedResult, acceptanceCriterion: w.acceptanceCriterion, recurrence: w.recurrence,
    })),
    resultAndAcceptance: c.resultAndAcceptance,
    exclusions: c.exclusions,
    revisions: c.revisions,
    timeline: c.timeline,
    dependencies: c.dependencies,
    clientActions: c.clientActions,
    payment: c.payment,
    freeWork: c.freeWork,
    extraWorkProcedure: c.extraWorkProcedure,
    serviceOneTimeKop: r?.oneTime.priceKop ?? null,
    serviceMonthlyKop: r?.monthly.present ? r.monthly.priceKop : null,
    discountKop: est?.discount?.amountKop ?? null,
    externalBudgets: (est?.externalBudgets ?? []).map((b) => ({ label: b.label, amountKop: b.amountKop, period: b.period, paidBy: b.paidBy === 'client_direct' ? 'Оплачивает клиент напрямую' : 'Через агентство' })),
    confirmedPromises: opp.promises.filter((x) => x.status === 'confirmed').map((x) => ({ what: x.what, byRole: x.byRole })),
  };
}

export function packageHash(opp: Opportunity): string {
  const accepted = acceptedProposal(opp);
  return hashOf({
    acceptedProposalId: accepted?.id ?? null,
    acceptedSnapshot: accepted?.frozenSnapshotId ?? null,
    items: opp.launch.items.map((i) => ({ k: i.key, s: i.status, n: i.note, r: i.naReason, d: i.deviationDecision ?? null })),
    payment: opp.launch.payment,
    promises: opp.promises.map((p) => ({ id: p.id, s: p.status, w: p.what })),
    receivingPm: opp.receivingPmUserId,
  });
}

export function activeApprovalFor(opp: Opportunity, proposalId: string) {
  return opp.approvals.find((a) => a.proposalVersionId === proposalId && a.status === 'active') ?? null;
}

/** Условия пакета (без приёмки PM и разрешения владельца). */
export function packageBlockers(opp: Opportunity): string[] {
  const b: string[] = [];
  const latest = latestMainProposal(opp);
  if (!latest || latest.status !== 'accepted') b.push('Последняя версия КП не принята клиентом');
  else if (!activeApprovalFor(opp, latest.id)) b.push('У принятой версии КП нет утверждения экономики владельцем');
  for (const i of opp.launch.items) {
    if (i.status === 'open') b.push(`Не проверено: «${checklistLabel(i.key)}»`);
    if (i.status === 'deviation') b.push(`Отклонение не устранено: «${checklistLabel(i.key)}» — ${i.note ?? ''}. Устраните, примите владельцем как риск или создайте новую версию КП, если меняются договорённости`);
    if (i.status === 'not_applicable' && !i.naReason?.trim()) b.push(`«${checklistLabel(i.key)}»: «неприменимо» без причины`);
  }
  if (opp.launch.payment.status === 'unknown') b.push('Фактический статус условий оплаты не указан');
  const undecided = opp.promises.filter((p) => p.status === 'discussed');
  if (undecided.length) b.push(`Обещания со статусом «обсуждалось» не разобраны: ${undecided.length}`);
  if (!opp.receivingPmUserId) b.push('Не назначен принимающий проджект');
  return b;
}

export function currentAcceptance(opp: Opportunity) {
  const h = packageHash(opp);
  const last = [...opp.handoffAcceptances].sort((a, b) => a.at.localeCompare(b.at)).pop() ?? null;
  return { hash: h, last, valid: !!last && last.decision === 'accepted' && last.packageHash === h };
}

export function currentAuthorization(opp: Opportunity) {
  const h = packageHash(opp);
  const latest = latestMainProposal(opp);
  const last = [...opp.launchAuthorizations].sort((a, b) => a.at.localeCompare(b.at)).pop() ?? null;
  return { last, valid: !!last && last.packageHash === h && !!latest && last.proposalVersionId === latest.id };
}

/** Все причины, по которым нельзя перевести в «Передано в работу». */
export function handoffBlockers(opp: Opportunity): string[] {
  const b = packageBlockers(opp);
  const acc = currentAcceptance(opp);
  if (!acc.last) b.push('Принимающий проджект не подтвердил «Проверил, принимаю»');
  else if (acc.last.decision === 'returned') b.push('Пакет возвращён принимающим проджектом на исправление');
  else if (!acc.valid) b.push('Пакет изменился после приёмки — нужна повторная приёмка проджектом');
  const auth = currentAuthorization(opp);
  if (!auth.last) b.push('Владелец не разрешил запуск');
  else if (!auth.valid) b.push('Разрешение запуска относится к прежней версии пакета или КП — нужно повторное разрешение');
  if (opp.stage !== 'preparing_launch') b.push('Возможность не в стадии «Готовим запуск»');
  return b;
}
