/**
 * Клиентские экспорты строятся ТОЛЬКО по разрешённому списку полей (allowlist).
 * Внутренние ставки, себестоимость, маржа, комиссия, внутренние комментарии, сведения о команде,
 * служебные ссылки и секреты сюда не попадают по построению.
 */
import { clientExportReadiness } from './audit';
import { worksOf } from './approval';
import { computeFor } from './economics';
import { agreedTerms, checklistLabel, checklistStatusLabel, handoffBlockers, type AgreedTerms } from './launch';
import type { Company, ModuleKey, Opportunity, ProposalVersion } from './types';
import { CLAIM_TYPE_LABELS, MODULE_LABELS, MODULE_STATUS_LABELS, PROPOSAL_STATUS_LABELS } from './types';

export interface ClientProposalExport {
  documentType: 'Коммерческое предложение';
  watermark: string;
  versionNumber: number;
  statusLabel: string;
  company: string;
  understanding: string | null;
  firstOfferWhy: string | null;
  works: { title: string; expectedResult: string | null; quantity: number | null; unit: string | null; acceptanceCriterion: string | null; recurrence: 'Разовая' | 'Ежемесячная' }[];
  resultAndAcceptance: string | null;
  timeline: string | null;
  dependencies: string | null;
  clientActions: string | null;
  /** Цена услуг агентства (выручка агентства), разовые работы. */
  serviceOneTimeKop: number | null;
  /** Цена услуг агентства, ежемесячные работы (в месяц); null — ежемесячных работ нет. */
  serviceMonthlyKop: number | null;
  discountKop: number | null;
  externalBudgets: { label: string; amountKop: number | null; period: string | null; paidBy: string }[];
  externalBudgetsNote: string;
  payment: string | null;
  revisions: string | null;
  exclusions: string | null;
  freeWork: string | null;
  validUntil: string | null;
  extraWorkProcedure: string | null;
  nextStep: string | null;
}

export function exportClientProposal(opp: Opportunity, company: Company, p: ProposalVersion): ClientProposalExport {
  const est = opp.estimates.find((e) => e.id === p.estimateVersionId);
  const r = est ? computeFor(opp, est) : null;
  const works = worksOf(opp, p);
  const c = p.content;
  const watermark =
    p.status === 'draft' ? 'ЧЕРНОВИК — не утверждён, не отправлялся клиенту'
      : p.status === 'approved_for_send' ? 'Утверждён для отправки — отправка не зафиксирована'
        : p.status === 'superseded' ? 'АРХИВ — версия заменена'
          : `Версия ${p.number}`;
  return {
    documentType: 'Коммерческое предложение',
    watermark,
    versionNumber: p.number,
    statusLabel: PROPOSAL_STATUS_LABELS[p.status],
    company: company.name,
    understanding: c.understanding,
    firstOfferWhy: c.firstOfferWhy,
    works: c.workItemIds
      .map((id) => works.find((w) => w.id === id))
      .filter((w): w is NonNullable<typeof w> => !!w)
      .map((w) => ({
        title: w.title,
        expectedResult: w.expectedResult,
        quantity: w.quantity,
        unit: w.unit,
        acceptanceCriterion: w.acceptanceCriterion,
        recurrence: w.recurrence === 'monthly' ? 'Ежемесячная' : 'Разовая',
      })),
    resultAndAcceptance: c.resultAndAcceptance,
    timeline: c.timeline,
    dependencies: c.dependencies,
    clientActions: c.clientActions,
    serviceOneTimeKop: r?.oneTime.present ? r.oneTime.priceKop : null,
    serviceMonthlyKop: r?.monthly.present ? r.monthly.priceKop : null,
    discountKop: est?.discount?.amountKop ?? null,
    externalBudgets: (est?.externalBudgets ?? []).map((b) => ({
      label: b.label, amountKop: b.amountKop, period: b.period, paidBy: b.paidBy === 'client_direct' ? 'Оплачивает клиент напрямую' : 'Через агентство',
    })),
    externalBudgetsNote: 'Рекламный бюджет и другие внешние расходы клиента не входят в стоимость услуг агентства и оплачиваются отдельно.',
    payment: c.payment,
    revisions: c.revisions,
    exclusions: c.exclusions,
    freeWork: c.freeWork,
    validUntil: c.validUntil,
    extraWorkProcedure: c.extraWorkProcedure,
    nextStep: c.nextStep,
  };
}

export interface ClientAuditExport {
  documentType: string;
  company: string;
  draftNote: string;
  scopeNote: string;
  modules: { module: string; status: string; reason: string | null; accessNeeded: string | null; blockedDecision: string | null }[];
  findings: {
    code: string; title: string; module: string; claimType: string; observation: string; causeHypothesis: string | null;
    evidenceQuote: string | null; sourceDate: string | null; dataPeriod: string | null; scope: string | null; limitation: string | null;
    impact: string | null; recommendation: string | null; effectCheck: string | null;
    numbers: { entity: string; value: number; unit: string; period: string; denominator: string | null; method: string }[];
  }[];
  excludedCount: number;
  leadPath: { level: string; status: string }[];
  limitations: string[];
}

const LP_STATUS: Record<string, string> = {
  not_checked: 'Не проверено',
  observed_publicly: 'Наблюдается публично',
  confirmed_by_client_data: 'Подтверждено данными клиента',
  not_applicable: 'Неприменимо',
};

export function exportClientAudit(opp: Opportunity, company: Company, detail: 'brief' | 'detailed'): ClientAuditExport {
  const ready = opp.findings.filter((f) => clientExportReadiness(opp, f).ready);
  const limitations = [
    'Выводы по публичным данным описывают наблюдаемую коммуникацию и путь клиента; они не позволяют утверждать CAC, маржу, качество лидов или реальную конверсию продаж.',
    'Успешная отправка формы не подтверждает обработку и квалификацию обращения.',
    'Рекомендации — гипотезы для проверки, рост выручки не гарантируется.',
  ];
  for (const m of opp.audit.modules)
    if (m.status !== 'sufficient' && m.status !== 'not_applicable')
      limitations.push(`${MODULE_LABELS[m.key as ModuleKey]}: ${MODULE_STATUS_LABELS[m.status]}${m.reason ? ` — ${m.reason}` : ''}`);
  return {
    documentType: detail === 'brief' ? 'Краткий отчёт по аудиту' : 'Подробный отчёт по аудиту',
    company: company.name,
    draftNote: 'Черновик локального экспорта. Клиенту не отправлялся.',
    scopeNote: opp.audit.fullMarketingAudit ? 'Полный маркетинговый аудит в согласованных границах' : 'Диагностика в выбранных границах',
    modules: opp.audit.modules.map((m) => ({
      module: MODULE_LABELS[m.key], status: MODULE_STATUS_LABELS[m.status], reason: m.reason, accessNeeded: m.accessNeeded, blockedDecision: m.blockedDecision,
    })),
    findings: ready.map((f) => ({
      code: f.code,
      title: f.title,
      module: MODULE_LABELS[f.module],
      claimType: CLAIM_TYPE_LABELS[f.claimType],
      observation: f.observation,
      causeHypothesis: f.causeHypothesis,
      evidenceQuote: detail === 'detailed' ? f.evidenceQuote : null,
      sourceDate: f.sourceDate,
      dataPeriod: f.dataPeriod,
      scope: detail === 'detailed' ? f.scope : null,
      limitation: f.limitation,
      impact: f.impact,
      recommendation: f.recommendation,
      effectCheck: detail === 'detailed' ? f.effectCheck : null,
      numbers: detail === 'detailed' ? f.numbers.map((n) => ({ entity: n.entity, value: n.value, unit: n.unit, period: n.period, denominator: n.denominator, method: n.method })) : [],
    })),
    excludedCount: opp.findings.length - ready.length,
    leadPath: Object.entries(opp.audit.leadPath).map(([level, v]) => ({ level, status: LP_STATUS[v.status] })),
    limitations,
  };
}

/** Ключи, которых не должно быть ни в одном клиентском экспорте (на любой глубине). */
export const FORBIDDEN_CLIENT_KEYS = [
  'rateKop', 'costKop', 'verifiedCostKop', 'unverifiedCostKop', 'frozenRule', 'targetMargin', 'costMinKop', 'costMaxKop', 'commissionKop', 'remainderKop', 'targetMarginBp', 'commissionRuleId', 'commissionRules',
  'lines', 'snapshot', 'approvals', 'history', 'createdBy', 'updatedBy', 'authorUserId', 'evidenceReview', 'presalePmUserId', 'ownerUserId',
  'receivingPmUserId', 'specialistUserIds', 'accessOwnerRole', 'tasks', 'internal', 'password', 'token', 'reason_internal',
];

export function findForbiddenKeys(obj: unknown, path = ''): string[] {
  const out: string[] = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => out.push(...findForbiddenKeys(v, `${path}[${i}]`)));
  else if (obj && typeof obj === 'object')
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_CLIENT_KEYS.includes(k)) out.push(`${path}.${k}`);
      out.push(...findForbiddenKeys(v, `${path}.${k}`));
    }
  return out;
}

/** Внутренний аудит команды: все находки (включая непроверенные), модули, вопросы, задачи. Без ставок и экономики. */
export function exportInternalAudit(opp: Opportunity) {
  return {
    documentType: 'Внутренний аудит команды',
    note: 'ВНУТРЕННИЙ ДОКУМЕНТ. Не передавать клиенту.',
    route: opp.audit.type,
    depth: opp.audit.depth,
    modules: opp.audit.modules.map((m) => ({ module: MODULE_LABELS[m.key], status: MODULE_STATUS_LABELS[m.status], reason: m.reason, accessNeeded: m.accessNeeded, accessOwnerRole: m.accessOwnerRole, blockedDecision: m.blockedDecision })),
    findings: opp.findings.map((f) => ({
      code: f.code, title: f.title, module: MODULE_LABELS[f.module], claimType: CLAIM_TYPE_LABELS[f.claimType], verification: f.verification,
      observation: f.observation, causeHypothesis: f.causeHypothesis, evidenceQuote: f.evidenceQuote, reviewComment: f.evidenceReview?.comment ?? null,
      limitation: f.limitation, recommendation: f.recommendation, clientReady: clientExportReadiness(opp, f).ready,
    })),
    openQuestions: opp.clarifications.filter((c) => c.status === 'open').map((c) => ({ question: c.question, to: c.addressedToRole })),
    leadPath: Object.entries(opp.audit.leadPath).map(([level, v]) => ({ level, status: LP_STATUS[v.status], note: v.note })),
  };
}

/** Пакет передачи в работу: договорённости из принятой версии КП + проверки готовности. Без ставок, затрат и комиссии. */
export interface HandoffExport {
  documentType: 'Пакет передачи в работу';
  company: string;
  opportunity: string;
  terms: AgreedTerms;
  checks: { item: string; status: string; note: string | null }[];
  /** Отметки прежней версии чек-листа (после миграции данных) — для истории. */
  previousChecks: { item: string; status: string; note: string | null; coveredBy: string }[];
  paymentStatus: string;
  blockers: string[];
}

export function exportHandoff(opp: Opportunity, company: Company): HandoffExport | null {
  const terms = agreedTerms(opp);
  if (!terms) return null;
  const pay = { unknown: 'Не указан', paid_confirmed_manually: 'Оплачено — отметка вручную', deferred_by_terms: 'Отсрочка по условиям', not_required_by_terms: 'Предоплата не требуется по условиям' }[opp.launch.payment.status];
  return {
    documentType: 'Пакет передачи в работу',
    company: company.name,
    opportunity: opp.title,
    terms,
    checks: opp.launch.items.map((i) => ({ item: checklistLabel(i.key), status: checklistStatusLabel(i.status), note: i.status === 'not_applicable' ? i.naReason : i.note })),
    previousChecks: (opp.launch.legacyItems ?? []).map((l) => ({ item: l.label, status: checklistStatusLabel(l.status), note: l.status === 'not_applicable' ? l.naReason : l.note, coveredBy: l.nowCoveredBy })),
    paymentStatus: pay,
    blockers: handoffBlockers(opp),
  };
}
