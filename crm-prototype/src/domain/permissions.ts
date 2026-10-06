/**
 * Матрица прав. Применяется на СЕРВЕРЕ к каждому запросу. Интерфейс использует её только для подсказок.
 */
import type { CommandType } from './commands';
import { computeEstimate } from './economics';
import type { Opportunity, Role, User } from './types';
import { approvalBlockers } from './commands';
import { currentAcceptance, currentAuthorization } from './launch';

/** Решения, которые ждут владельца. */
export function ownerDecisions(opp: Opportunity): string[] {
  const d: string[] = [];
  if (opp.stage === 'closed_lost' || opp.stage === 'handed_off') return d;
  for (const p of opp.proposals.filter((p) => p.status === 'draft'))
    if (approvalBlockers(opp, p).length === 0) d.push(`Утвердить КП v${p.number} и расчёт`);
  if (opp.audit.type === 'B' && opp.audit.presaleLimit.hours === null) d.push('Задать лимит предварительной проверки (не утверждён)');
  if (opp.audit.presaleLimit.hours !== null && opp.audit.spentHours > opp.audit.presaleLimit.hours && !opp.audit.overLimitDecision)
    d.push('Решение по превышению лимита пресейла');
  if (opp.stage === 'preparing_launch' && currentAcceptance(opp).valid && !currentAuthorization(opp).valid) d.push('Разрешить запуск');
  return d;
}

const ALL: Role[] = ['owner', 'presale_pm', 'lead_specialist', 'specialist', 'receiving_pm'];
const OWNER_PM: Role[] = ['owner', 'presale_pm'];
const OWNER_PM_LEAD: Role[] = ['owner', 'presale_pm', 'lead_specialist'];

export const COMMAND_ROLES: Record<CommandType, Role[]> = {
  updateBasics: OWNER_PM,
  setContinuation: OWNER_PM,
  setReadiness: OWNER_PM_LEAD,
  moveStage: OWNER_PM,
  pause: OWNER_PM,
  resume: OWNER_PM,
  close: OWNER_PM,
  setPmCostVisibility: ['owner'],
  requestDiagnosticOpportunity: OWNER_PM,
  addSource: ['owner', 'presale_pm', 'lead_specialist', 'specialist'],
  decideSourceAttribution: OWNER_PM_LEAD,
  parseSource: OWNER_PM_LEAD,
  updateSourceText: OWNER_PM_LEAD,
  decideProposedChange: OWNER_PM_LEAD,
  resolveConflict: OWNER_PM_LEAD,
  setFactStatus: OWNER_PM_LEAD,
  addFact: OWNER_PM_LEAD,
  editFact: OWNER_PM_LEAD,
  addPromise: OWNER_PM,
  setPromiseStatus: OWNER_PM,
  addClarification: ['owner', 'presale_pm', 'lead_specialist', 'specialist'],
  answerClarification: OWNER_PM_LEAD,
  addTask: OWNER_PM_LEAD,
  setTaskStatus: ['owner', 'presale_pm', 'lead_specialist', 'specialist'],
  setRoute: OWNER_PM_LEAD,
  approvePresaleLimit: ['owner'],
  logPresaleHours: ['owner', 'presale_pm', 'lead_specialist', 'specialist'],
  decideOverLimit: ['owner'],
  setModule: OWNER_PM_LEAD,
  setExternalSummary: OWNER_PM_LEAD,
  setLeadPath: ['owner', 'presale_pm', 'lead_specialist', 'specialist'],
  addScenario: OWNER_PM_LEAD,
  addFinding: ['owner', 'presale_pm', 'lead_specialist', 'specialist'],
  updateFinding: ['owner', 'presale_pm', 'lead_specialist', 'specialist'],
  reviewEvidence: ['owner', 'lead_specialist'],
  recordDeliverableGenerated: OWNER_PM_LEAD,
  addWorkItem: OWNER_PM_LEAD,
  updateWorkItem: OWNER_PM_LEAD,
  removeWorkItem: OWNER_PM_LEAD,
  upsertCostLine: ['owner', 'presale_pm', 'lead_specialist', 'specialist'],
  removeCostLine: OWNER_PM,
  updateEstimate: OWNER_PM,
  upsertCommissionRule: ['owner'],
  createProposalDraft: OWNER_PM,
  updateProposalContent: OWNER_PM,
  approveDeal: ['owner'],
  recordSent: OWNER_PM,
  recordAccepted: OWNER_PM,
  recordRejected: OWNER_PM,
  createRevision: OWNER_PM,
  addClientQuestion: OWNER_PM,
  recordProposalGenerated: OWNER_PM,
  setChecklistItem: OWNER_PM,
  setPayment: OWNER_PM,
  recordLinkShared: OWNER_PM,
  handoffDecision: ['receiving_pm'],
  authorizeLaunch: ['owner'],
  handOff: OWNER_PM,
};

/** Назначен ли пользователь на возможность в данной роли. Владелец видит всё. */
export function isAssigned(opp: Opportunity, userId: string, role: Role): boolean {
  switch (role) {
    case 'owner':
      return true;
    case 'presale_pm':
      return opp.presalePmUserId === userId || opp.ownerUserId === userId;
    case 'lead_specialist':
      return opp.leadSpecialistUserId === userId;
    case 'specialist':
      return opp.specialistUserIds.includes(userId);
    case 'receiving_pm':
      return opp.receivingPmUserId === userId && (opp.stage === 'preparing_launch' || opp.stage === 'handed_off');
  }
}

export type AccessDecision = { ok: true } | { ok: false; status: 403 | 404; message: string };

export function checkActingRole(user: User, role: Role): AccessDecision {
  if (!user.roles.includes(role)) return { ok: false, status: 403, message: `У пользователя нет роли «${role}»` };
  return { ok: true };
}

export function canView(user: User, role: Role, opp: Opportunity): AccessDecision {
  const r = checkActingRole(user, role);
  if (!r.ok) return r;
  // 404, чтобы перебор ID не раскрывал существование чужих карточек.
  if (!isAssigned(opp, user.id, role)) return { ok: false, status: 404, message: 'Возможность не найдена или недоступна' };
  return { ok: true };
}

export function canRun(user: User, role: Role, opp: Opportunity, cmd: CommandType): AccessDecision {
  const v = canView(user, role, opp);
  if (!v.ok) return v;
  if (!COMMAND_ROLES[cmd].includes(role)) return { ok: false, status: 403, message: `Действие недоступно для роли в этом действии` };
  return { ok: true };
}

export const ROLE_ALL = ALL;

/* ---------- Представление по ролям (серверная редакция данных) ---------- */

export interface Computed {
  estimates: Record<string, ReturnType<typeof computeEstimate> | { restricted: true; priceKop: number | null; complete: boolean; issues: { message: string }[] }>;
}

export type OpportunityView = Opportunity & { computed: Computed; viewRole: Role; restricted: string[] };

function computeAll(opp: Opportunity) {
  const out: Record<string, ReturnType<typeof computeEstimate>> = {};
  for (const e of opp.estimates) {
    const rule = e.commissionRuleId ? opp.commissionRules.find((r) => r.id === e.commissionRuleId) ?? null : null;
    out[e.id] = computeEstimate(e, rule);
  }
  return out;
}

/**
 * Строит представление для роли. Для не-владельцев внутренние суммы удаляются на сервере,
 * а не прячутся в интерфейсе.
 */
export function viewFor(opp: Opportunity, user: User, role: Role): OpportunityView {
  const o = structuredClone(opp) as OpportunityView;
  const full = computeAll(opp);
  o.viewRole = role;
  o.restricted = [];
  if (role === 'owner' || (role === 'presale_pm' && opp.pmCostVisibility)) {
    o.computed = { estimates: full };
    return o;
  }
  const restrictedComputed: Computed['estimates'] = {};
  for (const [id, r] of Object.entries(full))
    restrictedComputed[id] = {
      restricted: true,
      priceKop: role === 'specialist' ? null : r.priceKop,
      complete: r.complete,
      issues: role === 'specialist'
        ? []
        : r.issues.map((i) => ({
            message: ['hours', 'lines', 'manualPriceKop', 'discount', 'amountKop', 'zeroReason', 'hoursMin'].includes(i.field)
              ? i.message
              : 'Не заполнен параметр, который задаёт владелец (ставка, комиссия, маржа или налоговая модель)',
          })),
    };
  o.computed = { estimates: restrictedComputed };

  // Ставки, суммы, комиссия, маржа — убрать.
  o.commissionRules = [];
  o.restricted.push('Себестоимость, ставки, комиссия и маржа скрыты сервером для этой роли');
  for (const e of o.estimates) {
    e.commissionRuleId = null;
    e.targetMarginBp = null;
    e.targetMarginSource = null;
    e.taxModel = { status: e.taxModel.status, description: null };
    e.lines = e.lines
      .filter((l) => role !== 'specialist' || l.performerUserId === user.id)
      .map((l) => ({ ...l, rateKop: role === 'specialist' && l.performerUserId === user.id ? l.rateKop : null, amountKop: null }));
    if (role === 'specialist') {
      e.manualPriceKop = null;
      e.discount = null;
      e.externalBudgets = [];
    }
  }
  for (const a of o.approvals) a.snapshot = null;

  if (role === 'specialist') {
    o.restricted.push('Специалист видит назначенные задачи, источники, свои находки и свою оценку');
    o.tasks = o.tasks.filter((t) => t.assigneeUserId === user.id);
    o.findings = o.findings.filter((f) => f.authorUserId === user.id);
    o.proposals = [];
    o.approvals = [];
    o.launchAuthorizations = [];
    o.handoffAcceptances = [];
    o.budget = { status: o.budget.status, minKop: null, maxKop: null, period: null, note: null };
    o.facts = o.facts.filter((f) => f.key !== 'budget_mention');
  }
  if (role === 'receiving_pm') {
    o.restricted.push('Принимающий проджект видит пакет передачи без внутренней экономики');
    o.proposedChanges = [];
    o.approvals = o.approvals.map((a) => ({ ...a, snapshot: null }));
  }
  return o;
}

/** Краткая строка списка с учётом прав. */
export function listItemFor(opp: Opportunity, role: Role) {
  const blockers = opp.tasks.filter((t) => t.blocker && t.status === 'open').length + opp.conflicts.filter((c) => c.status === 'open').length;
  return {
    id: opp.id,
    title: opp.title,
    companyId: opp.companyId,
    stage: opp.stage,
    ownerUserId: opp.ownerUserId,
    presalePmUserId: opp.presalePmUserId,
    nextStep: opp.nextStep,
    route: opp.audit.type,
    blockers,
    pendingChanges: opp.proposedChanges.filter((p) => p.status === 'pending').length,
    ownerDecisions: role === 'specialist' ? [] : ownerDecisions(opp),
    pause: opp.pause,
    closure: opp.closure,
    related: opp.related,
    updatedAt: opp.updatedAt,
    version: opp.rev,
    isDemo: opp.isDemo,
  };
}
