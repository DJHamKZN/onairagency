import { hashOf } from './hash';
import type { ChecklistItem, ChecklistKey, LaunchChecklist, Opportunity, ProposalVersion } from './types';

export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  goal_first_result: 'Цель и первый результат',
  accepted_scope: 'Принятое КП и объём',
  contract: 'Договор',
  payment_status: 'Фактический статус условий оплаты',
  scope_exclusions: 'Состав и исключения',
  revisions: 'Правки',
  promises: 'Обещания агентства разобраны',
  materials: 'Материалы клиента',
  findings: 'Выводы диагностики',
  open_risks: 'Открытые риски',
  roles: 'Роли агентства и клиента',
  approvers: 'Согласующие',
  communication: 'Порядок общения',
  accesses: 'Доступы (ссылка на защищённое место и ответственный, без паролей)',
  performers: 'Исполнители',
  capacity: 'Подтверждённая загрузка',
  calendar: 'Календарь первого этапа',
  acceptance_baseline: 'Критерии приёмки и исходные показатели',
};

export const CHECKLIST_KEYS = Object.keys(CHECKLIST_LABELS) as ChecklistKey[];

export function emptyChecklist(): LaunchChecklist {
  return {
    items: CHECKLIST_KEYS.map((key): ChecklistItem => ({ key, status: 'open', note: null, naReason: null, updatedBy: null, updatedAt: null })),
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

export function packageHash(opp: Opportunity): string {
  const latest = latestMainProposal(opp);
  return hashOf({
    acceptedProposalId: latest && latest.status === 'accepted' ? latest.id : null,
    items: opp.launch.items.map((i) => ({ k: i.key, s: i.status, n: i.note, r: i.naReason })),
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
  else if (!activeApprovalFor(opp, latest.id)) b.push('У принятой версии КП нет действующего утверждения экономики владельцем');
  for (const i of opp.launch.items) {
    if (i.status === 'open') b.push(`Не выполнено: «${CHECKLIST_LABELS[i.key]}»`);
    if (i.status === 'not_applicable' && !i.naReason?.trim()) b.push(`«${CHECKLIST_LABELS[i.key]}»: «неприменимо» без причины`);
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
