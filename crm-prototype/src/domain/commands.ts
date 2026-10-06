/**
 * Команды над агрегатом «Возможность». Чистые функции: (агрегат, команда, контекст) → (новый агрегат, события).
 * Сервер вызывает их ПОСЛЕ проверки роли и назначения (см. permissions.ts) и сохраняет результат
 * с проверкой версии записи.
 */
import { buildMaterialSnapshot, diffMaterial, snapshotHash, type MaterialSnapshot } from './approval';
import { clientExportReadiness, emptyAudit, externalOverreach, supportBlockers, validateModule } from './audit';
import { demoParse } from './demoParser';
import { computeEstimate } from './economics';
import { DomainError, today, type Ctx } from './errors';
import { FACT_KEY_LABELS, SINGLE_KEYS, formatFactValue } from './labels';
import {
  CHECKLIST_LABELS, activeApprovalFor, currentAcceptance, emptyChecklist, handoffBlockers, latestMainProposal,
  looksLikeSecret, packageBlockers, packageHash,
} from './launch';
import { STAGE_LABELS, WORK_STAGES, moveBlockers, stageIndex } from './stages';
import type {
  AgencyPromise, Approval, AuditFinding, AuditModule, BaseRecord, Budget, ChecklistKey, Clarification, CommissionRule,
  CostLine, EstimateVersion, Fact, FactKey, FactStatus, FactValue, ImpactArea, LeadPathLevel, LeadPathStatus, NextStep,
  Opportunity, PromiseCategory, ProposalContent, ProposalVersion, ProposedChange, RouteType, Source, SourceKind, Task, WorkItem, WorkStage,
} from './types';

export interface EventDraft {
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  override?: boolean;
}

export interface CommandResult {
  opp: Opportunity;
  events: EventDraft[];
  /** Снимки, которые сервер должен сохранить в append-only таблицу. */
  snapshots: { id: string; kind: 'approval' | 'proposal_sent'; hash: string; data: unknown }[];
  /** Побочные эффекты вне агрегата (например, создать связанную возможность). */
  effects: { type: 'createLinkedDiagnostic'; title: string }[];
}

/* ---------- helpers ---------- */

const clone = <T,>(v: T): T => structuredClone(v);

function meta(ctx: Ctx, isDemo: boolean, prefix: string): BaseRecord {
  return { id: ctx.newId(prefix), createdAt: ctx.now, createdBy: ctx.userId, updatedAt: ctx.now, updatedBy: ctx.userId, rev: 1, isDemo };
}

function touch(r: BaseRecord, ctx: Ctx) {
  r.updatedAt = ctx.now;
  r.updatedBy = ctx.userId;
  r.rev += 1;
}

function req(v: unknown, label: string, field?: string): void {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim()))
    throw new DomainError('validation', `Заполните поле «${label}»`, [label], field ?? null);
}

function find<T extends { id: string }>(arr: T[], id: string, label: string): T {
  const x = arr.find((i) => i.id === id);
  if (!x) throw new DomainError('not_found', `${label} не найден(а)`);
  return x;
}

function ensureActive(opp: Opportunity) {
  if (opp.stage === 'closed_lost') throw new DomainError('closed', 'Возможность закрыта без сделки — изменения недоступны');
  if (opp.stage === 'handed_off') throw new DomainError('handed_off', 'Возможность уже передана в работу — изменения недоступны');
}

function hist(ctx: Ctx, action: string, from: unknown, to: unknown, reason: string | null) {
  return { at: ctx.now, by: ctx.userId, actingRole: ctx.actingRole, action, from, to, reason };
}

/* ---------- создание ---------- */

export interface CreateOpportunityInput {
  title: string;
  companyId: string;
  originalRequest: string;
  promisesNotRecorded: boolean;
  promises: { what: string; category: PromiseCategory; byRole: string }[];
  ownerUserId: string;
  presalePmUserId: string | null;
  nextStep: NextStep;
  budget?: Budget;
  isDemo: boolean;
}

export function createOpportunity(input: CreateOpportunityInput, ctx: Ctx): { opp: Opportunity; events: EventDraft[] } {
  const missing: string[] = [];
  if (!input.title?.trim() && !input.companyId) missing.push('Компания или понятное название');
  if (!input.companyId) missing.push('Компания');
  if (!input.originalRequest?.trim()) missing.push('Исходный запрос');
  if (!input.promisesNotRecorded && !input.promises?.length) missing.push('Обещания либо отметка «не зафиксированы»');
  if (!input.ownerUserId) missing.push('Ответственный');
  if (!input.nextStep?.text?.trim()) missing.push('Следующий шаг');
  if (!input.nextStep?.assigneeUserId) missing.push('Кто делает следующий шаг');
  if (!input.nextStep?.due) missing.push('Срок следующего шага');
  if (missing.length) throw new DomainError('validation', 'Для создания запроса не хватает данных', missing);
  const m = meta(ctx, input.isDemo, 'opp');
  const opp: Opportunity = {
    ...m,
    title: input.title.trim(),
    companyId: input.companyId,
    contactIds: [],
    stage: 'new_request',
    originalRequest: input.originalRequest.trim(),
    promisesNotRecorded: input.promisesNotRecorded,
    ownerUserId: input.ownerUserId,
    presalePmUserId: input.presalePmUserId,
    leadSpecialistUserId: null,
    specialistUserIds: [],
    receivingPmUserId: null,
    nextStep: input.nextStep,
    continuation: null,
    readiness: null,
    budget: input.budget ?? { status: 'not_discussed', minKop: null, maxKop: null, period: null, note: null },
    pause: null,
    closure: null,
    related: [],
    pmCostVisibility: false,
    sources: [],
    facts: [],
    proposedChanges: [],
    conflicts: [],
    promises: (input.promisesNotRecorded ? [] : input.promises).map((p): AgencyPromise => ({
      ...meta(ctx, input.isDemo, 'prm'),
      byRole: p.byRole, when: today(ctx), what: p.what, category: p.category, sourceId: null, status: 'discussed', conditional: false, history: [],
    })),
    clarifications: [],
    tasks: [],
    audit: emptyAudit(),
    findings: [],
    workItems: [],
    estimates: [],
    commissionRules: [],
    proposals: [],
    approvals: [],
    launch: emptyChecklist(),
    handoffAcceptances: [],
    launchAuthorizations: [],
    findingSeq: 0,
  };
  return { opp, events: [{ entityType: 'Opportunity', entityId: opp.id, action: 'created', before: null, after: { title: opp.title, stage: opp.stage }, reason: null }] };
}

/* ---------- команды ---------- */

export type Command =
  | { type: 'updateBasics'; payload: Partial<Pick<Opportunity, 'title' | 'originalRequest' | 'promisesNotRecorded' | 'nextStep' | 'budget' | 'ownerUserId' | 'presalePmUserId' | 'leadSpecialistUserId' | 'specialistUserIds' | 'receivingPmUserId' | 'contactIds'>> }
  | { type: 'setContinuation'; payload: { method: string } }
  | { type: 'setReadiness'; payload: { decision: 'enough_for_proposal' | 'offer_paid_diagnostic'; justification: string } }
  | { type: 'moveStage'; payload: { target: WorkStage; reason: string; override?: boolean } }
  | { type: 'pause'; payload: { reason: string; nextActor: string; returnDate: string } }
  | { type: 'resume'; payload: { comment?: string } }
  | { type: 'close'; payload: { reason: string; outcome: string } }
  | { type: 'setPmCostVisibility'; payload: { visible: boolean; comment: string } }
  | { type: 'requestDiagnosticOpportunity'; payload: { title: string } }
  // источники и факты
  | { type: 'addSource'; payload: { kind: SourceKind; title: string; declaredCompany: string | null; receivedAt: string | null; text: string; link: string | null; originalFilename: string | null; replacesSourceId: string | null } }
  | { type: 'decideSourceAttribution'; payload: { sourceId: string; accept: boolean; comment: string } }
  | { type: 'parseSource'; payload: { sourceId: string } }
  | { type: 'updateSourceText'; payload: { sourceId: string; text: string; reason: string } }
  | { type: 'decideProposedChange'; payload: { id: string; accept: boolean; comment?: string } }
  | { type: 'resolveConflict'; payload: { conflictId: string; choice: 'keep_existing' | 'take_proposed' | 'needs_clarification'; comment: string } }
  | { type: 'setFactStatus'; payload: { factId: string; status: FactStatus; reason: string } }
  | { type: 'addFact'; payload: { key: FactKey; value: FactValue; status: FactStatus; sourceId: string | null; excerpt: string | null; significant?: boolean } }
  | { type: 'editFact'; payload: { factId: string; value: FactValue; reason: string } }
  | { type: 'addPromise'; payload: { what: string; category: PromiseCategory; byRole: string; sourceId: string | null; conditional: boolean } }
  | { type: 'setPromiseStatus'; payload: { id: string; status: 'discussed' | 'confirmed' | 'withdrawn'; reason: string } }
  | { type: 'addClarification'; payload: { question: string; addressedToRole: string; impacts: ImpactArea[]; sourceId?: string | null } }
  | { type: 'answerClarification'; payload: { id: string; answer: string | null; status: 'answered' | 'dropped' | 'open' } }
  | { type: 'addTask'; payload: { title: string; assigneeUserId: string | null; role: Task['role']; due: string | null; blocker: boolean; kind: Task['kind'] } }
  | { type: 'setTaskStatus'; payload: { id: string; status: Task['status']; reason?: string } }
  // диагностика
  | { type: 'setRoute'; payload: { type: RouteType; rationale: string; depth: Opportunity['audit']['depth']; fullMarketingAudit: boolean } }
  | { type: 'approvePresaleLimit'; payload: { hours: number } }
  | { type: 'logPresaleHours'; payload: { hours: number } }
  | { type: 'decideOverLimit'; payload: { comment: string } }
  | { type: 'setModule'; payload: AuditModule }
  | { type: 'setExternalSummary'; payload: NonNullable<Opportunity['audit']['externalSummary']> }
  | { type: 'setLeadPath'; payload: { level: LeadPathLevel; status: LeadPathStatus; note: string | null } }
  | { type: 'addScenario'; payload: { title: string; decision: string } }
  | { type: 'addFinding'; payload: Partial<AuditFinding> & { title: string; module: AuditFinding['module']; observation: string } }
  | { type: 'updateFinding'; payload: { id: string; patch: Partial<AuditFinding> } }
  | { type: 'reviewEvidence'; payload: { findingId: string; supportsClaim: boolean; comment: string } }
  | { type: 'recordDeliverableGenerated'; payload: { kind: 'client_brief_pdf' | 'client_detailed_docx' | 'internal_docx' } }
  // работы и экономика
  | { type: 'addWorkItem'; payload: Omit<WorkItem, keyof BaseRecord> }
  | { type: 'updateWorkItem'; payload: { id: string; patch: Partial<Omit<WorkItem, keyof BaseRecord>> } }
  | { type: 'removeWorkItem'; payload: { id: string } }
  | { type: 'upsertCostLine'; payload: { estimateId: string; line: CostLine } }
  | { type: 'removeCostLine'; payload: { estimateId: string; lineId: string } }
  | { type: 'updateEstimate'; payload: { estimateId: string; patch: Partial<Pick<EstimateVersion, 'commissionRuleId' | 'noCommissionConfirmed' | 'targetMarginBp' | 'targetMarginSource' | 'rounding' | 'taxModel' | 'priceMode' | 'manualPriceKop' | 'discount' | 'externalBudgets'>> } }
  | { type: 'upsertCommissionRule'; payload: Omit<CommissionRule, keyof BaseRecord> & { id?: string } }
  // КП
  | { type: 'createProposalDraft'; payload: Record<string, never> }
  | { type: 'updateProposalContent'; payload: { proposalId: string; patch: Partial<ProposalContent> } }
  | { type: 'approveDeal'; payload: { proposalId: string; comment: string | null } }
  | { type: 'recordSent'; payload: { proposalId: string; versionNumber: number; recipientLabel: string; date: string; channelNote: string } }
  | { type: 'recordAccepted'; payload: { proposalId: string; versionNumber: number; date: string; confirmationSource: string } }
  | { type: 'recordRejected'; payload: { proposalId: string; date: string; reason: string } }
  | { type: 'createRevision'; payload: { fromProposalId: string; reason: string } }
  | { type: 'addClientQuestion'; payload: { proposalId: string; text: string; nextContact: string | null } }
  | { type: 'recordProposalGenerated'; payload: { proposalId: string; format: string } }
  // запуск
  | { type: 'setChecklistItem'; payload: { key: ChecklistKey; status: 'open' | 'done' | 'not_applicable'; note: string | null; naReason: string | null } }
  | { type: 'setPayment'; payload: { status: Opportunity['launch']['payment']['status']; note: string | null } }
  | { type: 'recordLinkShared'; payload: Record<string, never> }
  | { type: 'handoffDecision'; payload: { decision: 'accepted' | 'returned'; remarks: string | null } }
  | { type: 'authorizeLaunch'; payload: { comment: string | null } }
  | { type: 'handOff'; payload: Record<string, never> };

export type CommandType = Command['type'];

export function applyCommand(input: Opportunity, cmd: Command, ctx: Ctx, env: { companyName: string | null } = { companyName: null }): CommandResult {
  const opp = clone(input);
  const events: EventDraft[] = [];
  const snapshots: CommandResult['snapshots'] = [];
  const effects: CommandResult['effects'] = [];
  const ev = (entityType: string, entityId: string, action: string, before: unknown, after: unknown, reason: string | null = null, override = false) =>
    events.push({ entityType, entityId, action, before, after, reason, override });

  const readOnlyAllowed: CommandType[] = ['recordProposalGenerated', 'recordDeliverableGenerated'];
  if (!readOnlyAllowed.includes(cmd.type) && cmd.type !== 'resume') {
    if (opp.stage === 'paused' && !['updateBasics', 'addSource', 'addTask', 'setTaskStatus', 'close'].includes(cmd.type))
      throw new DomainError('paused', 'Возможность на паузе. Верните её с паузы, чтобы продолжить работу');
    if (cmd.type !== 'close') ensureActive(opp);
  }

  switch (cmd.type) {
    /* ===== Карточка и стадии ===== */
    case 'updateBasics': {
      const p = cmd.payload;
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) continue;
        before[k] = (opp as unknown as Record<string, unknown>)[k];
        after[k] = v;
        (opp as unknown as Record<string, unknown>)[k] = v;
      }
      if (p.nextStep) {
        req(p.nextStep.text, 'Следующий шаг');
        req(p.nextStep.assigneeUserId, 'Кто делает следующий шаг');
        req(p.nextStep.due, 'Срок следующего шага');
      }
      if (p.budget) validateBudget(p.budget);
      if (p.title !== undefined) req(p.title, 'Название');
      if (p.originalRequest !== undefined) req(p.originalRequest, 'Исходный запрос');
      touch(opp, ctx);
      ev('Opportunity', opp.id, 'basics_updated', before, after);
      break;
    }
    case 'setContinuation': {
      req(cmd.payload.method, 'Способ продолжить');
      const before = opp.continuation;
      opp.continuation = { method: cmd.payload.method.trim(), by: ctx.userId, at: ctx.now };
      touch(opp, ctx);
      ev('Opportunity', opp.id, 'continuation_set', before, opp.continuation);
      break;
    }
    case 'setReadiness': {
      req(cmd.payload.justification, 'Обоснование решения');
      const before = opp.readiness;
      opp.readiness = { decision: cmd.payload.decision, justification: cmd.payload.justification.trim(), by: ctx.userId, at: ctx.now };
      touch(opp, ctx);
      ev('Opportunity', opp.id, 'readiness_set', before, opp.readiness);
      break;
    }
    case 'moveStage': {
      const { target, reason, override } = cmd.payload;
      if (!WORK_STAGES.includes(target)) throw new DomainError('validation', 'Неизвестная стадия');
      req(reason, 'Причина перехода');
      const blockers = moveBlockers(opp, target);
      const back = stageIndex(target) < stageIndex(opp.stage);
      if (blockers.length) {
        const overridable = (target === 'clarifying' || target === 'preparing_proposal') && opp.stage !== 'paused';
        if (!override || !overridable)
          throw new DomainError('transition_blocked', `Переход в «${STAGE_LABELS[target]}» недоступен`, blockers);
        if (ctx.actingRole !== 'owner') throw new DomainError('forbidden', 'Обход ограничения доступен только владельцу');
      }
      const before = opp.stage;
      opp.stage = target;
      touch(opp, ctx);
      ev('Opportunity', opp.id, back ? 'stage_returned' : 'stage_moved', before, target, reason, !!(override && blockers.length));
      if (override && blockers.length) ev('Opportunity', opp.id, 'override_used', blockers, target, reason, true);
      break;
    }
    case 'pause': {
      const { reason, nextActor, returnDate } = cmd.payload;
      const missing: string[] = [];
      if (!reason?.trim()) missing.push('Причина паузы');
      if (!nextActor?.trim()) missing.push('Кто следующий действует');
      if (!returnDate) missing.push('Дата возврата');
      if (missing.length) throw new DomainError('validation', 'Для паузы не хватает данных', missing);
      if (opp.stage === 'paused') throw new DomainError('validation', 'Уже на паузе');
      const resumeStage = opp.stage as WorkStage;
      opp.pause = { reason: reason.trim(), nextActor: nextActor.trim(), returnDate, resumeStage, at: ctx.now, by: ctx.userId };
      opp.stage = 'paused';
      touch(opp, ctx);
      ev('Opportunity', opp.id, 'paused', resumeStage, opp.pause, reason);
      break;
    }
    case 'resume': {
      if (opp.stage !== 'paused' || !opp.pause) throw new DomainError('validation', 'Возможность не на паузе');
      const target = opp.pause.resumeStage;
      const before = opp.pause;
      opp.stage = target;
      opp.pause = null;
      touch(opp, ctx);
      ev('Opportunity', opp.id, 'resumed', before, target, cmd.payload.comment ?? null);
      break;
    }
    case 'close': {
      const missing: string[] = [];
      if (!cmd.payload.reason?.trim()) missing.push('Причина закрытия');
      if (!cmd.payload.outcome?.trim()) missing.push('Результат');
      if (missing.length) throw new DomainError('validation', 'Для закрытия без сделки не хватает данных', missing);
      ensureActive(opp);
      const before = opp.stage;
      opp.closure = { reason: cmd.payload.reason.trim(), outcome: cmd.payload.outcome.trim(), at: ctx.now, by: ctx.userId };
      opp.stage = 'closed_lost';
      opp.pause = null;
      for (const t of opp.tasks.filter((t) => t.status === 'open')) {
        t.status = 'cancelled';
        t.cancelledReason = `Сделка закрыта: ${cmd.payload.reason.trim()}`;
        touch(t, ctx);
        ev('Task', t.id, 'cancelled_on_close', 'open', 'cancelled', t.cancelledReason);
      }
      touch(opp, ctx);
      ev('Opportunity', opp.id, 'closed_lost', before, opp.closure, cmd.payload.reason);
      break;
    }
    case 'setPmCostVisibility': {
      req(cmd.payload.comment, 'Комментарий к решению');
      const before = opp.pmCostVisibility;
      opp.pmCostVisibility = cmd.payload.visible;
      touch(opp, ctx);
      ev('Opportunity', opp.id, 'pm_cost_visibility_changed', before, cmd.payload.visible, cmd.payload.comment);
      break;
    }
    case 'requestDiagnosticOpportunity': {
      req(cmd.payload.title, 'Название диагностики');
      if (opp.audit.type !== 'C') throw new DomainError('validation', 'Отдельная платная диагностика создаётся для маршрута C. Выберите маршрут C');
      effects.push({ type: 'createLinkedDiagnostic', title: cmd.payload.title.trim() });
      break;
    }

    /* ===== Источники ===== */
    case 'addSource': {
      const p = cmd.payload;
      req(p.title, 'Название источника');
      if (!p.text?.trim() && !p.link?.trim()) throw new DomainError('validation', 'Вставьте текст или укажите ссылку на источник', ['Текст или ссылка']);
      if (p.text && p.text.length > 80000) throw new DomainError('validation', 'Текст длиннее 80 000 символов — разделите источник');
      if (looksLikeSecret(p.text) || looksLikeSecret(p.link)) throw new DomainError('secret_detected', 'Похоже на пароль или ключ. Не храните секреты в CRM: укажите ссылку на защищённое место и ответственного');
      const company = env.companyName;
      let status: Source['status'] = 'active';
      let quarantineReason: string | null = null;
      if (p.declaredCompany && company && norm(p.declaredCompany) !== norm(company)) {
        status = 'quarantined';
        quarantineReason = `Источник указан для компании «${p.declaredCompany}», а карточка — «${company}». Нужно решение: относится ли он к этой возможности`;
      }
      let version = 1;
      let previousVersionId: string | null = null;
      if (p.replacesSourceId) {
        const prev = find(opp.sources, p.replacesSourceId, 'Заменяемый источник');
        version = prev.version + 1;
        previousVersionId = prev.id;
        if (prev.receivedAt && p.receivedAt && p.receivedAt < prev.receivedAt) {
          status = 'quarantined';
          quarantineReason = `Дата нового файла (${p.receivedAt}) раньше текущей версии (${prev.receivedAt}) — возможно, устаревшая версия. Нужно решение`;
        }
      }
      const s: Source = {
        ...meta(ctx, opp.isDemo, 'src'),
        kind: p.kind, title: p.title.trim(), declaredCompany: p.declaredCompany?.trim() || null, receivedAt: p.receivedAt || null,
        text: p.text ?? '', link: p.link?.trim() || null,
        original: { stored: false, filename: p.originalFilename || null, mime: null, sizeBytes: null },
        version, previousVersionId, status, quarantineReason, attributionDecision: null, parsedAt: null,
      };
      opp.sources.push(s);
      if (status === 'active' && previousVersionId) supersedeSource(opp, previousVersionId, s, ctx, ev);
      touch(opp, ctx);
      ev('Source', s.id, 'added', null, { title: s.title, status, version }, quarantineReason);
      break;
    }
    case 'decideSourceAttribution': {
      const s = find(opp.sources, cmd.payload.sourceId, 'Источник');
      if (s.status !== 'quarantined') throw new DomainError('validation', 'Источник не на карантине');
      req(cmd.payload.comment, 'Комментарий к решению');
      const before = s.status;
      s.attributionDecision = { by: ctx.userId, at: ctx.now, comment: cmd.payload.comment.trim() };
      s.status = cmd.payload.accept ? 'active' : 'rejected';
      touch(s, ctx);
      if (cmd.payload.accept && s.previousVersionId) supersedeSource(opp, s.previousVersionId, s, ctx, ev);
      touch(opp, ctx);
      ev('Source', s.id, cmd.payload.accept ? 'attribution_accepted' : 'attribution_rejected', before, s.status, cmd.payload.comment);
      break;
    }
    case 'parseSource': {
      const s = find(opp.sources, cmd.payload.sourceId, 'Источник');
      if (s.status === 'quarantined') throw new DomainError('quarantined', 'Источник на карантине: сначала решите, относится ли он к этой возможности', [s.quarantineReason ?? '']);
      if (s.status !== 'active') throw new DomainError('validation', 'Разбирать можно только актуальный источник');
      const parsed = demoParse(s.text);
      for (const p of parsed) {
        const pc: ProposedChange = {
          ...meta(ctx, opp.isDemo, 'pc'),
          sourceId: s.id, kind: p.kind, key: p.key, value: p.value, excerpt: p.excerpt, timecode: p.timecode, note: p.note,
          status: 'pending', decision: null, addressedToRole: p.addressedToRole,
        };
        opp.proposedChanges.push(pc);
      }
      s.parsedAt = ctx.now;
      touch(s, ctx);
      touch(opp, ctx);
      ev('Source', s.id, 'demo_parsed', null, { proposals: parsed.length }, 'Демо-разбор по правилам (не AI)');
      break;
    }
    case 'updateSourceText': {
      const old = find(opp.sources, cmd.payload.sourceId, 'Источник');
      req(cmd.payload.reason, 'Причина изменения источника');
      if (old.status !== 'active') throw new DomainError('validation', 'Изменять можно только актуальную версию источника');
      const s: Source = { ...clone(old), ...meta(ctx, opp.isDemo, 'src'), text: cmd.payload.text, version: old.version + 1, previousVersionId: old.id, parsedAt: null };
      opp.sources.push(s);
      supersedeSource(opp, old.id, s, ctx, ev);
      touch(opp, ctx);
      ev('Source', s.id, 'new_version', { id: old.id, version: old.version }, { id: s.id, version: s.version }, cmd.payload.reason);
      break;
    }
    case 'decideProposedChange': {
      const pc = find(opp.proposedChanges, cmd.payload.id, 'Предложенное изменение');
      if (pc.status !== 'pending') throw new DomainError('validation', 'По этому предложению уже принято решение');
      pc.decision = { by: ctx.userId, actingRole: ctx.actingRole, at: ctx.now, comment: cmd.payload.comment ?? null };
      touch(pc, ctx);
      if (!cmd.payload.accept) {
        pc.status = 'rejected';
        ev('ProposedChange', pc.id, 'rejected', 'pending', 'rejected', cmd.payload.comment ?? null);
        touch(opp, ctx);
        break;
      }
      acceptProposedChange(opp, pc, ctx, ev);
      touch(opp, ctx);
      break;
    }
    case 'resolveConflict': {
      const c = find(opp.conflicts, cmd.payload.conflictId, 'Противоречие');
      if (c.status !== 'open') throw new DomainError('validation', 'Противоречие уже решено');
      req(cmd.payload.comment, 'Комментарий проверяющего');
      const fact = find(opp.facts, c.factId, 'Факт');
      const pc = find(opp.proposedChanges, c.proposedChangeId, 'Предложение');
      const before = { value: fact.value, status: fact.status, sourceId: fact.sourceId };
      if (cmd.payload.choice === 'take_proposed') {
        fact.value = c.proposedValue;
        fact.sourceId = c.proposedSourceId;
        fact.excerpt = pc.excerpt;
        fact.timecode = pc.timecode;
        fact.status = 'client_words';
        pc.status = 'accepted';
      } else if (cmd.payload.choice === 'keep_existing') {
        pc.status = 'rejected';
      } else {
        fact.status = 'needs_clarification';
        pc.status = 'rejected';
        opp.clarifications.push({
          ...meta(ctx, opp.isDemo, 'clr'),
          question: `Противоречие «${FACT_KEY_LABELS[c.key]}»: ${formatFactValue(c.existingValue)} или ${formatFactValue(c.proposedValue)}?`,
          addressedToRole: 'Клиент: ЛПР', impacts: ['timeline', 'scope'], sourceId: c.proposedSourceId, status: 'open', answer: null,
        });
      }
      c.status = 'resolved';
      c.resolution = { choice: cmd.payload.choice, comment: cmd.payload.comment.trim(), by: ctx.userId, actingRole: ctx.actingRole, at: ctx.now };
      fact.history.push(hist(ctx, `conflict_${cmd.payload.choice}`, before, { value: fact.value, status: fact.status, sourceId: fact.sourceId }, cmd.payload.comment));
      touch(fact, ctx);
      touch(c, ctx);
      touch(opp, ctx);
      ev('Conflict', c.id, 'resolved', before, c.resolution, cmd.payload.comment);
      break;
    }
    case 'setFactStatus': {
      const f = find(opp.facts, cmd.payload.factId, 'Факт');
      req(cmd.payload.reason, 'Основание изменения статуса');
      const before = f.status;
      f.status = cmd.payload.status;
      if (cmd.payload.status === 'confirmed') { f.verifiedBy = ctx.userId; f.verifiedAt = ctx.now; }
      f.history.push(hist(ctx, 'status', before, f.status, cmd.payload.reason));
      touch(f, ctx);
      touch(opp, ctx);
      ev('Fact', f.id, 'status_changed', before, f.status, cmd.payload.reason);
      break;
    }
    case 'addFact': {
      const p = cmd.payload;
      if (SINGLE_KEYS.has(p.key) && opp.facts.some((f) => f.key === p.key))
        throw new DomainError('fact_exists', `Поле «${FACT_KEY_LABELS[p.key]}» уже заполнено. Измените его с указанием причины или внесите новый источник`);
      validateFactValue(p.value);
      const f = newFact(opp, ctx, p.key, p.value, p.status, p.sourceId, p.excerpt, null);
      f.significant = !!p.significant;
      opp.facts.push(f);
      touch(opp, ctx);
      ev('Fact', f.id, 'added', null, { key: f.key, value: f.value, status: f.status });
      break;
    }
    case 'editFact': {
      const f = find(opp.facts, cmd.payload.factId, 'Факт');
      req(cmd.payload.reason, 'Причина изменения');
      validateFactValue(cmd.payload.value);
      const before = { value: f.value, status: f.status };
      f.value = cmd.payload.value;
      if (f.status === 'confirmed') f.status = 'needs_clarification'; // подтверждённое не перезаписывается бесшумно
      f.history.push(hist(ctx, 'edited', before, { value: f.value, status: f.status }, cmd.payload.reason));
      touch(f, ctx);
      touch(opp, ctx);
      ev('Fact', f.id, 'edited', before, { value: f.value, status: f.status }, cmd.payload.reason);
      break;
    }
    case 'addPromise': {
      const p = cmd.payload;
      req(p.what, 'Что обещано');
      req(p.byRole, 'Кто обещал (роль)');
      const pr: AgencyPromise = {
        ...meta(ctx, opp.isDemo, 'prm'), byRole: p.byRole, when: today(ctx), what: p.what.trim(), category: p.category,
        sourceId: p.sourceId, status: 'discussed', conditional: p.conditional, history: [],
      };
      opp.promises.push(pr);
      opp.promisesNotRecorded = false;
      touch(opp, ctx);
      ev('Promise', pr.id, 'added', null, { what: pr.what, status: pr.status });
      break;
    }
    case 'setPromiseStatus': {
      const pr = find(opp.promises, cmd.payload.id, 'Обещание');
      req(cmd.payload.reason, 'Основание');
      if (cmd.payload.status === 'confirmed' && pr.conditional)
        throw new DomainError('validation', 'Условное высказывание нельзя подтвердить как обязательство. Сформулируйте безусловное обещание отдельно');
      const before = pr.status;
      pr.status = cmd.payload.status;
      pr.history.push(hist(ctx, 'status', before, pr.status, cmd.payload.reason));
      touch(pr, ctx);
      touch(opp, ctx);
      ev('Promise', pr.id, 'status_changed', before, pr.status, cmd.payload.reason);
      break;
    }
    case 'addClarification': {
      req(cmd.payload.question, 'Вопрос');
      req(cmd.payload.addressedToRole, 'Кому адресован вопрос');
      const c: Clarification = {
        ...meta(ctx, opp.isDemo, 'clr'), question: cmd.payload.question.trim(), addressedToRole: cmd.payload.addressedToRole.trim(),
        impacts: cmd.payload.impacts ?? [], sourceId: cmd.payload.sourceId ?? null, status: 'open', answer: null,
      };
      opp.clarifications.push(c);
      touch(opp, ctx);
      ev('Clarification', c.id, 'added', null, { question: c.question });
      break;
    }
    case 'answerClarification': {
      const c = find(opp.clarifications, cmd.payload.id, 'Вопрос');
      if (cmd.payload.status === 'answered') req(cmd.payload.answer, 'Ответ');
      const before = { status: c.status, answer: c.answer };
      c.status = cmd.payload.status;
      c.answer = cmd.payload.answer;
      touch(c, ctx);
      touch(opp, ctx);
      ev('Clarification', c.id, 'updated', before, { status: c.status, answer: c.answer });
      break;
    }
    case 'addTask': {
      req(cmd.payload.title, 'Задача');
      const t: Task = { ...meta(ctx, opp.isDemo, 'tsk'), ...cmd.payload, title: cmd.payload.title.trim(), status: 'open', cancelledReason: null };
      opp.tasks.push(t);
      touch(opp, ctx);
      ev('Task', t.id, 'added', null, { title: t.title, blocker: t.blocker });
      break;
    }
    case 'setTaskStatus': {
      const t = find(opp.tasks, cmd.payload.id, 'Задача');
      const before = t.status;
      t.status = cmd.payload.status;
      t.cancelledReason = cmd.payload.status === 'cancelled' ? cmd.payload.reason ?? 'Отменено' : null;
      touch(t, ctx);
      touch(opp, ctx);
      ev('Task', t.id, 'status_changed', before, t.status, cmd.payload.reason ?? null);
      break;
    }

    /* ===== Диагностика ===== */
    case 'setRoute': {
      req(cmd.payload.rationale, 'Почему выбран маршрут');
      const before = { type: opp.audit.type, depth: opp.audit.depth, full: opp.audit.fullMarketingAudit };
      opp.audit.type = cmd.payload.type;
      opp.audit.rationale = cmd.payload.rationale.trim();
      opp.audit.depth = cmd.payload.depth;
      opp.audit.fullMarketingAudit = cmd.payload.fullMarketingAudit;
      if (cmd.payload.fullMarketingAudit && opp.audit.deliverables.length === 0)
        opp.audit.deliverables = (['client_brief_pdf', 'client_detailed_docx', 'internal_docx'] as const).map((kind) => ({ kind, lastGeneratedAt: null, lastGeneratedBy: null, limitationsNote: null }));
      touch(opp, ctx);
      ev('AuditRoute', opp.id, 'route_set', before, { type: opp.audit.type, depth: opp.audit.depth, full: opp.audit.fullMarketingAudit }, cmd.payload.rationale);
      break;
    }
    case 'approvePresaleLimit': {
      if (!(cmd.payload.hours > 0)) throw new DomainError('validation', 'Лимит должен быть положительным числом часов');
      const before = opp.audit.presaleLimit;
      opp.audit.presaleLimit = { hours: cmd.payload.hours, approvedBy: ctx.userId, approvedAt: ctx.now };
      touch(opp, ctx);
      ev('AuditRoute', opp.id, 'presale_limit_approved', before, opp.audit.presaleLimit);
      break;
    }
    case 'logPresaleHours': {
      if (!(cmd.payload.hours > 0)) throw new DomainError('validation', 'Укажите положительное число часов');
      const before = opp.audit.spentHours;
      opp.audit.spentHours = Math.round((opp.audit.spentHours + cmd.payload.hours) * 100) / 100;
      touch(opp, ctx);
      ev('AuditRoute', opp.id, 'presale_hours_logged', before, opp.audit.spentHours);
      break;
    }
    case 'decideOverLimit': {
      req(cmd.payload.comment, 'Решение по превышению');
      opp.audit.overLimitDecision = { by: ctx.userId, at: ctx.now, comment: cmd.payload.comment.trim() };
      touch(opp, ctx);
      ev('AuditRoute', opp.id, 'over_limit_decided', null, opp.audit.overLimitDecision, cmd.payload.comment);
      break;
    }
    case 'setModule': {
      const errs = validateModule(cmd.payload);
      if (errs.length) throw new DomainError('validation', 'Статус модуля заполнен не полностью', errs);
      const i = opp.audit.modules.findIndex((m) => m.key === cmd.payload.key);
      if (i < 0) throw new DomainError('not_found', 'Модуль не найден');
      const before = opp.audit.modules[i];
      opp.audit.modules[i] = { ...cmd.payload };
      touch(opp, ctx);
      ev('AuditModule', cmd.payload.key, 'updated', before, cmd.payload, cmd.payload.reason);
      break;
    }
    case 'setExternalSummary': {
      const before = opp.audit.externalSummary;
      opp.audit.externalSummary = cmd.payload;
      touch(opp, ctx);
      ev('AuditRoute', opp.id, 'external_summary_set', before, cmd.payload);
      break;
    }
    case 'setLeadPath': {
      const before = opp.audit.leadPath[cmd.payload.level];
      if (cmd.payload.status === 'confirmed_by_client_data' && !cmd.payload.note?.trim())
        throw new DomainError('validation', 'Для подтверждения по данным клиента укажите, какими данными подтверждено');
      opp.audit.leadPath[cmd.payload.level] = { status: cmd.payload.status, note: cmd.payload.note };
      touch(opp, ctx);
      ev('LeadPath', cmd.payload.level, 'updated', before, opp.audit.leadPath[cmd.payload.level]);
      break;
    }
    case 'addScenario': {
      req(cmd.payload.title, 'Бизнес-сценарий');
      const sc = { id: ctx.newId('scn'), title: cmd.payload.title.trim(), decision: cmd.payload.decision?.trim() ?? '' };
      opp.audit.scenarios.push(sc);
      touch(opp, ctx);
      ev('AuditScenario', sc.id, 'added', null, sc);
      break;
    }
    case 'addFinding': {
      const p = cmd.payload;
      req(p.title, 'Название находки');
      req(p.observation, 'Наблюдение');
      opp.findingSeq += 1;
      const f: AuditFinding = {
        ...meta(ctx, opp.isDemo, 'fnd'),
        code: `F-${String(opp.findingSeq).padStart(3, '0')}`,
        title: p.title.trim(), module: p.module, scenarioId: p.scenarioId ?? null, claimType: p.claimType ?? 'observation',
        dataBasis: p.dataBasis ?? 'external_public', observation: p.observation.trim(), causeHypothesis: p.causeHypothesis ?? null,
        sourceId: p.sourceId ?? null, sourceDate: p.sourceDate ?? null, scope: p.scope ?? null, dataPeriod: p.dataPeriod ?? null,
        evidenceQuote: p.evidenceQuote ?? null, evidenceReview: null, verification: 'unverified', limitation: p.limitation ?? null,
        impact: p.impact ?? null, recommendation: p.recommendation ?? null, effectCheck: p.effectCheck ?? null, numbers: p.numbers ?? [],
        authorUserId: ctx.userId, recheckReason: null, history: [],
      };
      const over = externalOverreach(f);
      if (over) throw new DomainError('external_overreach', over);
      opp.findings.push(f);
      touch(opp, ctx);
      ev('AuditFinding', f.id, 'added', null, { code: f.code, title: f.title });
      break;
    }
    case 'updateFinding': {
      const f = find(opp.findings, cmd.payload.id, 'Находка');
      if (ctx.actingRole === 'specialist' && f.authorUserId !== ctx.userId) throw new DomainError('forbidden', 'Специалист может менять только свои находки');
      const { id: _i, code: _c, history: _h, evidenceReview: _e, verification: _v, authorUserId: _a, ...patch } = cmd.payload.patch as AuditFinding;
      const before = clone(f);
      Object.assign(f, patch);
      const over = externalOverreach(f);
      if (over) throw new DomainError('external_overreach', over);
      // Изменение сути или доказательства снимает прежнюю проверку.
      if (['observation', 'evidenceQuote', 'sourceId', 'claimType', 'numbers'].some((k) => k in patch) && f.evidenceReview) {
        f.evidenceReview = null;
        f.verification = 'unverified';
      }
      f.history.push(hist(ctx, 'updated', { title: before.title, observation: before.observation, verification: before.verification }, { title: f.title, observation: f.observation, verification: f.verification }, null));
      touch(f, ctx);
      touch(opp, ctx);
      ev('AuditFinding', f.id, 'updated', { title: before.title, verification: before.verification }, { title: f.title, verification: f.verification });
      break;
    }
    case 'reviewEvidence': {
      const f = find(opp.findings, cmd.payload.findingId, 'Находка');
      req(cmd.payload.comment, 'Комментарий проверяющего');
      if (cmd.payload.supportsClaim) {
        const b = supportBlockers(opp, f);
        if (b.length) throw new DomainError('evidence_insufficient', 'Нельзя отметить вывод как подтверждённый', b);
      }
      const before = f.verification;
      f.evidenceReview = { supportsClaim: cmd.payload.supportsClaim, by: ctx.userId, at: ctx.now, comment: cmd.payload.comment.trim() };
      f.verification = cmd.payload.supportsClaim ? 'supported' : 'not_supported';
      f.recheckReason = null;
      f.history.push(hist(ctx, 'evidence_reviewed', before, f.verification, cmd.payload.comment));
      touch(f, ctx);
      touch(opp, ctx);
      ev('AuditFinding', f.id, 'evidence_reviewed', before, f.verification, cmd.payload.comment);
      break;
    }
    case 'recordDeliverableGenerated': {
      const d = opp.audit.deliverables.find((x) => x.kind === cmd.payload.kind);
      if (!d) throw new DomainError('validation', 'Документ полного аудита не предусмотрен: полный аудит не включён');
      d.lastGeneratedAt = ctx.now;
      d.lastGeneratedBy = ctx.userId;
      touch(opp, ctx);
      ev('AuditDeliverable', cmd.payload.kind, 'generated_locally', null, { at: ctx.now }, 'Локальный экспорт; клиенту не отправлялось');
      break;
    }

    /* ===== Работы и экономика ===== */
    case 'addWorkItem': {
      req(cmd.payload.title, 'Название работы');
      const w: WorkItem = { ...meta(ctx, opp.isDemo, 'wi'), ...cmd.payload, title: cmd.payload.title.trim() };
      validateBasis(opp, w);
      opp.workItems.push(w);
      touch(opp, ctx);
      ev('WorkItem', w.id, 'added', null, { title: w.title });
      break;
    }
    case 'updateWorkItem': {
      const w = find(opp.workItems, cmd.payload.id, 'Работа');
      assertWorkItemEditable(opp, w.id);
      const before = clone(w);
      Object.assign(w, cmd.payload.patch);
      validateBasis(opp, w);
      touch(w, ctx);
      touch(opp, ctx);
      ev('WorkItem', w.id, 'updated', pickWork(before), pickWork(w));
      break;
    }
    case 'removeWorkItem': {
      assertWorkItemEditable(opp, cmd.payload.id);
      const w = find(opp.workItems, cmd.payload.id, 'Работа');
      if (opp.proposals.some((p) => p.status !== 'draft' && p.content.workItemIds.includes(w.id)))
        throw new DomainError('immutable', 'Работа входит в отправленную или утверждённую версию КП — удалить нельзя, создайте новую редакцию');
      opp.workItems = opp.workItems.filter((x) => x.id !== w.id);
      for (const p of opp.proposals.filter((p) => p.status === 'draft' || p.status === 'approved_for_send'))
        p.content.workItemIds = p.content.workItemIds.filter((id) => id !== w.id);
      touch(opp, ctx);
      ev('WorkItem', w.id, 'removed', pickWork(w), null);
      break;
    }
    case 'upsertCostLine': {
      const est = editableEstimate(opp, cmd.payload.estimateId);
      const line = cmd.payload.line;
      if (!line.id) line.id = ctx.newId('cl');
      validateLineNumbers(line);
      const existing = est.lines.find((l) => l.id === line.id) ?? null;
      // Полевые права: ставки задаёт владелец; специалист меняет только свои часы.
      if (ctx.actingRole !== 'owner') {
        const prevRate = existing ? existing.rateKop : null;
        if (line.rateKop !== prevRate && !(existing === null && line.rateKop === null))
          throw new DomainError('forbidden_field', 'Ставки задаёт владелец. Проджект и специалисты вносят часы и оценки');
      }
      if (ctx.actingRole === 'specialist') {
        if (!existing || existing.performerUserId !== ctx.userId) throw new DomainError('forbidden', 'Специалист может менять только свою оценку');
        const allowed: (keyof CostLine)[] = ['hours', 'hoursMin', 'hoursMax', 'confidence', 'zeroReason'];
        for (const k of Object.keys(line) as (keyof CostLine)[])
          if (!allowed.includes(k) && JSON.stringify(line[k]) !== JSON.stringify(existing[k])) throw new DomainError('forbidden_field', `Специалист не может менять поле «${String(k)}»`);
      }
      const before = existing ? clone(existing) : null;
      if (existing) Object.assign(existing, line);
      else est.lines.push(line);
      touch(est, ctx);
      touch(opp, ctx);
      ev('CostLine', line.id, existing ? 'updated' : 'added', before, line);
      break;
    }
    case 'removeCostLine': {
      const est = editableEstimate(opp, cmd.payload.estimateId);
      const l = find(est.lines, cmd.payload.lineId, 'Строка расчёта');
      est.lines = est.lines.filter((x) => x.id !== l.id);
      touch(est, ctx);
      touch(opp, ctx);
      ev('CostLine', l.id, 'removed', l, null);
      break;
    }
    case 'updateEstimate': {
      const est = editableEstimate(opp, cmd.payload.estimateId);
      const ownerOnly = ['commissionRuleId', 'noCommissionConfirmed', 'targetMarginBp', 'targetMarginSource', 'rounding', 'taxModel'];
      if (ctx.actingRole !== 'owner' && Object.keys(cmd.payload.patch).some((k) => ownerOnly.includes(k)))
        throw new DomainError('forbidden_field', 'Комиссию, маржу, округление и налоговую модель задаёт владелец');
      const p = cmd.payload.patch;
      if (p.discount) {
        req(p.discount.reason, 'Причина скидки');
        if (!Number.isSafeInteger(p.discount.amountKop) || p.discount.amountKop < 0) throw new DomainError('validation', 'Скидка — неотрицательная сумма');
      }
      if (p.manualPriceKop !== undefined && p.manualPriceKop !== null && (!Number.isSafeInteger(p.manualPriceKop) || p.manualPriceKop < 0))
        throw new DomainError('validation', 'Цена — неотрицательная сумма');
      if (p.targetMarginBp !== undefined && p.targetMarginBp !== null && (p.targetMarginBp < 0 || p.targetMarginBp >= 10000))
        throw new DomainError('validation', 'Целевая маржа — доля от 0 до 1 (меньше 100 %)');
      for (const b of p.externalBudgets ?? []) if (b.amountKop !== null && b.amountKop < 0) throw new DomainError('validation', 'Внешний бюджет не может быть отрицательным');
      if (p.commissionRuleId) find(opp.commissionRules, p.commissionRuleId, 'Правило комиссии');
      const before = pickEstimate(est);
      Object.assign(est, p);
      if (p.commissionRuleId) est.noCommissionConfirmed = false;
      touch(est, ctx);
      touch(opp, ctx);
      ev('EstimateVersion', est.id, 'updated', before, pickEstimate(est));
      break;
    }
    case 'upsertCommissionRule': {
      const p = cmd.payload;
      req(p.label, 'Название правила');
      req(p.recipientRole, 'Получатель (роль)');
      if (p.rateBp !== null && (p.rateBp < 0 || p.rateBp > 10000)) throw new DomainError('validation', 'Ставка комиссии — доля от 0 до 1');
      if (p.base === 'other') req(p.baseDescription, 'Описание базы комиссии');
      if (p.baseAmountKop !== null && p.baseAmountKop < 0) throw new DomainError('validation', 'База комиссии не может быть отрицательной');
      if (p.id) {
        const r = find(opp.commissionRules, p.id, 'Правило комиссии');
        const before = clone(r);
        Object.assign(r, p);
        touch(r, ctx);
        ev('CommissionRule', r.id, 'updated', before, r);
      } else {
        const r: CommissionRule = { ...meta(ctx, opp.isDemo, 'com'), ...p };
        opp.commissionRules.push(r);
        ev('CommissionRule', r.id, 'added', null, r);
      }
      touch(opp, ctx);
      break;
    }

    /* ===== КП ===== */
    case 'createProposalDraft': {
      if (opp.proposals.some((p) => p.status === 'draft' || p.status === 'approved_for_send'))
        throw new DomainError('validation', 'Черновик КП уже есть — редактируйте его');
      if (opp.proposals.length) throw new DomainError('validation', 'КП уже есть. Для изменений создайте новую редакцию');
      const est = newEstimate(opp, ctx, 1);
      opp.estimates.push(est);
      const p = newProposal(opp, ctx, 1, est.id, null, emptyContent(opp));
      opp.proposals.push(p);
      touch(opp, ctx);
      ev('ProposalVersion', p.id, 'draft_created', null, { number: 1 });
      break;
    }
    case 'updateProposalContent': {
      const p = find(opp.proposals, cmd.payload.proposalId, 'Версия КП');
      if (p.status !== 'draft' && p.status !== 'approved_for_send')
        throw new DomainError('immutable', `Версия ${p.number} в статусе «${p.status}» неизменяема. Создайте новую редакцию`);
      for (const id of cmd.payload.patch.workItemIds ?? []) find(opp.workItems, id, 'Работа');
      const before = clone(p.content);
      Object.assign(p.content, cmd.payload.patch);
      touch(p, ctx);
      touch(opp, ctx);
      ev('ProposalVersion', p.id, 'content_updated', before, p.content);
      break;
    }
    case 'approveDeal': {
      const p = find(opp.proposals, cmd.payload.proposalId, 'Версия КП');
      if (p.status !== 'draft') throw new DomainError('validation', `Утверждать можно черновик. Текущий статус: ${p.status}`);
      const blockers = approvalBlockers(opp, p);
      if (blockers.length) throw new DomainError('approval_blocked', 'Утверждение недоступно', blockers);
      const snap = buildMaterialSnapshot(opp, p);
      const hash = snapshotHash(snap);
      const snapshotId = ctx.newId('snap');
      snapshots.push({ id: snapshotId, kind: 'approval', hash, data: snap });
      const a: Approval = {
        ...meta(ctx, opp.isDemo, 'apr'), proposalVersionId: p.id, estimateVersionId: p.estimateVersionId, snapshotId, snapshotHash: hash,
        snapshot: snap, approvedBy: ctx.userId, actingRole: 'owner', approvedAt: ctx.now, comment: cmd.payload.comment, status: 'active', revoked: null,
      };
      opp.approvals.push(a);
      p.status = 'approved_for_send';
      touch(p, ctx);
      touch(opp, ctx);
      ev('Approval', a.id, 'approved', null, { proposal: p.number, hash, priceKop: snap.priceKop }, cmd.payload.comment);
      break;
    }
    case 'recordSent': {
      const p = find(opp.proposals, cmd.payload.proposalId, 'Версия КП');
      const missing: string[] = [];
      if (!cmd.payload.recipientLabel?.trim()) missing.push('Получатель');
      if (!cmd.payload.date) missing.push('Дата отправки');
      if (cmd.payload.versionNumber !== p.number) missing.push(`Подтвердите номер версии: отправляется версия ${p.number}`);
      if (p.status !== 'approved_for_send') missing.push('Версия не утверждена владельцем для отправки');
      if (!activeApprovalFor(opp, p.id)) missing.push('Нет действующего утверждения экономики для этой версии');
      if (missing.length) throw new DomainError('send_blocked', 'Нельзя зафиксировать отправку', missing);
      const snapId = ctx.newId('snap');
      const frozen = { proposal: clone(p.content), material: buildMaterialSnapshot(opp, p) };
      snapshots.push({ id: snapId, kind: 'proposal_sent', hash: snapshotHash(frozen.material), data: frozen });
      p.status = 'sent';
      p.frozenSnapshotId = snapId;
      p.sent = { recipientLabel: cmd.payload.recipientLabel.trim(), date: cmd.payload.date, channelNote: cmd.payload.channelNote ?? '', recordedBy: ctx.userId, at: ctx.now, demo: true };
      const est = find(opp.estimates, p.estimateVersionId, 'Расчёт');
      est.status = 'locked';
      for (const other of opp.proposals) if (other.id !== p.id && other.status === 'sent') { other.status = 'superseded'; touch(other, ctx); }
      touch(p, ctx);
      const beforeStage = opp.stage;
      // Утверждённая и отправленная версия — выход из стадий 1–3, даже если стадию не переключали вручную.
      if (stageIndex(opp.stage) >= 0 && stageIndex(opp.stage) < stageIndex('discussing_proposal')) opp.stage = 'discussing_proposal';
      touch(opp, ctx);
      ev('ProposalVersion', p.id, 'sent_recorded', 'approved_for_send', { number: p.number, ...p.sent }, 'Демонстрационное событие: письмо не отправлялось');
      if (beforeStage !== opp.stage) ev('Opportunity', opp.id, 'stage_moved', beforeStage, opp.stage, `Зафиксирована отправка КП v${p.number}`);
      break;
    }
    case 'recordAccepted': {
      const p = find(opp.proposals, cmd.payload.proposalId, 'Версия КП');
      const missing: string[] = [];
      if (cmd.payload.versionNumber !== p.number) missing.push(`Подтвердите номер версии: принимается версия ${p.number}`);
      if (p.status !== 'sent') missing.push('Принять можно только отправленную и не заменённую версию');
      const latest = latestMainProposal(opp);
      if (latest && latest.id !== p.id) missing.push(`Есть более новая версия ${latest.number} — клиент должен принять актуальную`);
      if (!cmd.payload.date) missing.push('Дата принятия');
      if (!cmd.payload.confirmationSource?.trim()) missing.push('Источник подтверждения (например, «Демо-письмо 3»)');
      if (missing.length) throw new DomainError('accept_blocked', 'Нельзя зафиксировать принятие', missing);
      p.status = 'accepted';
      p.accepted = { date: cmd.payload.date, confirmationSource: cmd.payload.confirmationSource.trim(), recordedBy: ctx.userId, at: ctx.now };
      touch(p, ctx);
      const beforeStage = opp.stage;
      opp.stage = 'preparing_launch';
      touch(opp, ctx);
      ev('ProposalVersion', p.id, 'acceptance_recorded', 'sent', { number: p.number, ...p.accepted });
      if (beforeStage !== opp.stage) ev('Opportunity', opp.id, 'stage_moved', beforeStage, opp.stage, `Клиент принял КП v${p.number}`);
      break;
    }
    case 'recordRejected': {
      const p = find(opp.proposals, cmd.payload.proposalId, 'Версия КП');
      if (p.status !== 'sent') throw new DomainError('validation', 'Отклонить можно только отправленную версию');
      req(cmd.payload.reason, 'Причина отклонения');
      p.status = 'rejected';
      p.rejected = { date: cmd.payload.date, reason: cmd.payload.reason.trim(), recordedBy: ctx.userId, at: ctx.now };
      touch(p, ctx);
      touch(opp, ctx);
      ev('ProposalVersion', p.id, 'rejection_recorded', 'sent', p.rejected, cmd.payload.reason);
      break;
    }
    case 'createRevision': {
      const from = find(opp.proposals, cmd.payload.fromProposalId, 'Версия КП');
      req(cmd.payload.reason, 'Причина новой редакции');
      if (opp.proposals.some((p) => p.status === 'draft' || p.status === 'approved_for_send'))
        throw new DomainError('validation', 'Уже есть черновик новой редакции');
      const number = Math.max(...opp.proposals.map((p) => p.number)) + 1;
      const fromEst = find(opp.estimates, from.estimateVersionId, 'Расчёт');
      const est: EstimateVersion = { ...clone(fromEst), ...meta(ctx, opp.isDemo, 'est'), number, status: 'draft' };
      opp.estimates.push(est);
      const p = newProposal(opp, ctx, number, est.id, from.id, clone(from.content));
      opp.proposals.push(p);
      const beforeStage = opp.stage;
      if (opp.stage === 'discussing_proposal' || opp.stage === 'preparing_launch') opp.stage = 'preparing_proposal';
      touch(opp, ctx);
      ev('ProposalVersion', p.id, 'revision_created', { from: from.number }, { number }, cmd.payload.reason);
      if (beforeStage !== opp.stage) ev('Opportunity', opp.id, 'stage_returned', beforeStage, opp.stage, `Новая редакция КП v${number}: ${cmd.payload.reason}`);
      break;
    }
    case 'addClientQuestion': {
      const p = find(opp.proposals, cmd.payload.proposalId, 'Версия КП');
      req(cmd.payload.text, 'Вопрос клиента');
      p.clientQuestions.push({ id: ctx.newId('cq'), text: cmd.payload.text.trim(), at: ctx.now, by: ctx.userId });
      p.nextContact = cmd.payload.nextContact;
      // вопросы и следующий контакт не меняют содержание отправленной версии
      touch(opp, ctx);
      ev('ProposalVersion', p.id, 'client_question_added', null, cmd.payload);
      break;
    }
    case 'recordProposalGenerated': {
      const p = find(opp.proposals, cmd.payload.proposalId, 'Версия КП');
      ev('ProposalVersion', p.id, 'document_generated_locally', null, { format: cmd.payload.format, status: p.status }, 'Генерация не равна отправке');
      break;
    }

    /* ===== Запуск ===== */
    case 'setChecklistItem': {
      const item = opp.launch.items.find((i) => i.key === cmd.payload.key);
      if (!item) throw new DomainError('not_found', 'Пункт не найден');
      if (cmd.payload.status === 'not_applicable' && !cmd.payload.naReason?.trim())
        throw new DomainError('validation', `«${CHECKLIST_LABELS[item.key]}»: для «неприменимо» нужна причина`, ['Причина неприменимости'], 'naReason');
      if (cmd.payload.status === 'done' && !cmd.payload.note?.trim())
        throw new DomainError('validation', `«${CHECKLIST_LABELS[item.key]}»: укажите, что именно проверено или где лежит`, ['Комментарий / где лежит'], 'note');
      if (looksLikeSecret(cmd.payload.note) || looksLikeSecret(cmd.payload.naReason))
        throw new DomainError('secret_detected', 'Похоже на пароль или ключ. Укажите ссылку на защищённое хранилище и ответственного, а не сам секрет', [], 'note');
      const before = clone(item);
      Object.assign(item, { status: cmd.payload.status, note: cmd.payload.note, naReason: cmd.payload.status === 'not_applicable' ? cmd.payload.naReason : null, updatedBy: ctx.userId, updatedAt: ctx.now });
      touch(opp, ctx);
      ev('LaunchChecklist', item.key, 'item_updated', before, item);
      break;
    }
    case 'setPayment': {
      if (looksLikeSecret(cmd.payload.note)) throw new DomainError('secret_detected', 'Не храните реквизиты доступа в заметке');
      if (cmd.payload.status !== 'unknown') req(cmd.payload.note, 'Основание статуса оплаты');
      const before = opp.launch.payment;
      opp.launch.payment = { status: cmd.payload.status, note: cmd.payload.note };
      touch(opp, ctx);
      ev('LaunchChecklist', 'payment', 'payment_status_set', before, opp.launch.payment, 'Ручная отметка, не платёжная интеграция');
      break;
    }
    case 'recordLinkShared': {
      opp.launch.linkSharedAt = ctx.now;
      touch(opp, ctx);
      ev('LaunchChecklist', 'link', 'link_shared', null, ctx.now, 'Передача ссылки не является приёмкой пакета');
      break;
    }
    case 'handoffDecision': {
      if (opp.stage !== 'preparing_launch') throw new DomainError('validation', 'Пакет принимается в стадии «Готовим запуск»');
      if (opp.receivingPmUserId !== ctx.userId) throw new DomainError('forbidden', 'Подтвердить приёмку может только назначенный принимающий проджект');
      if (cmd.payload.decision === 'returned') req(cmd.payload.remarks, 'Замечания (что исправить)');
      if (cmd.payload.decision === 'accepted') {
        const b = packageBlockers(opp);
        if (b.length) throw new DomainError('package_incomplete', 'Пакет неполный — принять нельзя. Верните его с замечаниями', b);
      }
      const hash = packageHash(opp);
      const a = { ...meta(ctx, opp.isDemo, 'hoa'), packageHash: hash, decision: cmd.payload.decision, remarks: cmd.payload.remarks, by: ctx.userId, actingRole: 'receiving_pm' as const, at: ctx.now };
      opp.handoffAcceptances.push(a);
      if (cmd.payload.decision === 'returned') {
        opp.tasks.push({
          ...meta(ctx, opp.isDemo, 'tsk'), title: `Исправить пакет передачи: ${cmd.payload.remarks}`, assigneeUserId: opp.presalePmUserId,
          role: 'presale_pm', due: null, status: 'open', blocker: true, kind: 'handoff_fix', cancelledReason: null,
        });
      }
      touch(opp, ctx);
      ev('HandoffAcceptance', a.id, cmd.payload.decision === 'accepted' ? 'package_accepted' : 'package_returned', null, { hash, remarks: a.remarks }, cmd.payload.remarks);
      break;
    }
    case 'authorizeLaunch': {
      const b = packageBlockers(opp);
      const acc = currentAcceptance(opp);
      if (!acc.valid) b.push('Нет действующей приёмки пакета принимающим проджектом');
      if (b.length) throw new DomainError('launch_blocked', 'Разрешить запуск нельзя', b);
      const latest = latestMainProposal(opp)!;
      const la = { ...meta(ctx, opp.isDemo, 'lau'), packageHash: packageHash(opp), proposalVersionId: latest.id, by: ctx.userId, actingRole: 'owner' as const, at: ctx.now };
      opp.launchAuthorizations.push(la);
      touch(opp, ctx);
      ev('LaunchAuthorization', la.id, 'launch_authorized', null, { proposal: latest.number, hash: la.packageHash }, cmd.payload.comment);
      break;
    }
    case 'handOff': {
      const b = handoffBlockers(opp);
      if (b.length) throw new DomainError('handoff_blocked', 'Перевести в «Передано в работу» нельзя', b);
      const before = opp.stage;
      opp.stage = 'handed_off';
      touch(opp, ctx);
      ev('Opportunity', opp.id, 'handed_off', before, 'handed_off');
      break;
    }
    default: {
      const never: never = cmd;
      throw new DomainError('unknown_command', `Неизвестная команда ${(never as { type: string }).type}`);
    }
  }

  reconcileApprovals(opp, ctx, ev);
  return { opp, events, snapshots, effects };
}

/* ---------- утверждения ---------- */

export function approvalBlockers(opp: Opportunity, p: ProposalVersion): string[] {
  const b: string[] = [];
  const est = find(opp.estimates, p.estimateVersionId, 'Расчёт');
  const rule = est.commissionRuleId ? opp.commissionRules.find((r) => r.id === est.commissionRuleId) ?? null : null;
  const r = computeEstimate(est, rule);
  if (!r.complete) for (const i of r.issues) b.push(i.message);
  if (rule && !rule.ownerApproved) b.push(`Правило комиссии «${rule.label}» не утверждено владельцем (демо)`);
  if (!p.content.workItemIds.length) b.push('В КП не выбрано ни одной работы');
  for (const id of p.content.workItemIds) {
    const w = opp.workItems.find((x) => x.id === id);
    if (!w) { b.push('В КП есть удалённая работа'); continue; }
    b.push(...workItemIssues(opp, w));
  }
  const required: [keyof ProposalContent, string][] = [
    ['understanding', 'Что поняли'], ['firstOfferWhy', 'Что предлагаем первым и почему'], ['resultAndAcceptance', 'Результат и приёмка'],
    ['timeline', 'Сроки'], ['payment', 'Оплата'], ['exclusions', 'Исключения'], ['validUntil', 'Срок действия'], ['nextStep', 'Следующий шаг'],
  ];
  for (const [k, label] of required) if (!p.content[k]) b.push(`КП: не заполнено «${label}»`);
  for (const c of opp.conflicts.filter((c) => c.status === 'open')) b.push(`Нерешённое противоречие «${FACT_KEY_LABELS[c.key]}»`);
  return b;
}

/** Проверка основания, объёма и критерия приёмки работы. */
export function workItemIssues(opp: Opportunity, w: WorkItem): string[] {
  const b: string[] = [];
  if (!w.basis) b.push(`«${w.title}»: нет основания (подтверждённая находка или задача клиента)`);
  else if (w.basis.type === 'finding') {
    const fid = w.basis.findingId;
    const f = opp.findings.find((x) => x.id === fid);
    if (!f) b.push(`«${w.title}»: находка-основание не найдена`);
    else if (!clientExportReadiness(opp, f).ready || f.claimType === 'hypothesis' || f.claimType === 'unknown')
      b.push(`«${w.title}»: основание ${f.code} не подтверждено доказательством`);
  } else if (!w.basis.text.trim()) b.push(`«${w.title}»: пустая формулировка задачи клиента`);
  if (!w.expectedResult) b.push(`«${w.title}»: нет ожидаемого результата`);
  if (w.quantity === null || !w.unit) b.push(`«${w.title}»: нет измеримого объёма (количество и единица)`);
  if (!w.acceptanceCriterion) b.push(`«${w.title}»: нет критерия приёмки`);
  return b;
}

function reconcileApprovals(opp: Opportunity, ctx: Ctx, ev: (t: string, id: string, a: string, b: unknown, af: unknown, r?: string | null, o?: boolean) => void) {
  for (const a of opp.approvals.filter((x) => x.status === 'active')) {
    const p = opp.proposals.find((x) => x.id === a.proposalVersionId);
    if (!p || (p.status !== 'draft' && p.status !== 'approved_for_send')) continue; // отправленные неизменяемы
    const current = buildMaterialSnapshot(opp, p);
    if (snapshotHash(current) === a.snapshotHash) continue;
    const d = diffMaterial(a.snapshot as MaterialSnapshot, current);
    a.status = 'revoked';
    a.revoked = { at: ctx.now, by: ctx.userId, reason: `Изменены существенные условия: ${d.details.join('; ')}`, categories: d.categories, details: d.details };
    touch(a, ctx);
    if (p.status === 'approved_for_send') { p.status = 'draft'; touch(p, ctx); }
    ev('Approval', a.id, 'revoked_automatically', 'active', { categories: d.categories }, a.revoked.reason);
  }
}

/* ---------- внутренние helpers ---------- */

function norm(s: string) {
  return s.toLowerCase().replace(/[«»"'.,\s-]/g, '');
}

function validateBudget(b: Budget) {
  if (b.status === 'range' && b.minKop === null && b.maxKop === null) throw new DomainError('validation', 'Для диапазона укажите хотя бы одну границу');
  if (b.status === 'confirmed' && b.minKop === null) throw new DomainError('validation', 'Для подтверждённого бюджета укажите сумму (ноль — тоже явное значение)');
  if ((b.minKop ?? 0) < 0 || (b.maxKop ?? 0) < 0) throw new DomainError('validation', 'Бюджет не может быть отрицательным');
  if (b.minKop !== null && b.maxKop !== null && b.minKop > b.maxKop) throw new DomainError('validation', 'Минимум бюджета больше максимума');
}

function validateFactValue(v: FactValue) {
  if (typeof v === 'string') { if (!v.trim()) throw new DomainError('validation', 'Пустое значение факта не сохраняется — оставьте поле неизвестным'); return; }
  if ('entity' in v && v.value !== null && v.value < 0) throw new DomainError('validation', 'Метрика не может быть отрицательной');
}

function validateLineNumbers(l: CostLine) {
  for (const k of ['hours', 'hoursMin', 'hoursMax', 'rateKop', 'amountKop'] as const) {
    const v = l[k];
    if (v !== null && v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) throw new DomainError('validation', `Поле ${k}: ожидается число или пусто`);
    if (typeof v === 'number' && v < 0) throw new DomainError('validation', 'Отрицательные значения в расчёте недопустимы', [], k);
  }
  if ((l.rateKop !== null && !Number.isSafeInteger(l.rateKop)) || (l.amountKop !== null && !Number.isSafeInteger(l.amountKop)))
    throw new DomainError('validation', 'Суммы хранятся в целых копейках');
}

function newFact(opp: Opportunity, ctx: Ctx, key: FactKey, value: FactValue, status: FactStatus, sourceId: string | null, excerpt: string | null, timecode: string | null): Fact {
  return {
    ...meta(ctx, opp.isDemo, 'fct'), key, value, status, sourceId, excerpt, timecode, verifiedBy: null, verifiedAt: null,
    significant: key === 'deadline' || key === 'budget_mention', needsRecheck: false, recheckReason: null, corroboratingSourceIds: [],
    history: [hist(ctx, 'created', null, value, null)],
  };
}

function acceptProposedChange(opp: Opportunity, pc: ProposedChange, ctx: Ctx, ev: (t: string, id: string, a: string, b: unknown, af: unknown, r?: string | null) => void) {
  switch (pc.kind) {
    case 'fact': {
      const key = pc.key!;
      const existing = SINGLE_KEYS.has(key) ? opp.facts.find((f) => f.key === key) : undefined;
      if (existing) {
        if (JSON.stringify(existing.value) === JSON.stringify(pc.value)) {
          existing.corroboratingSourceIds.push(pc.sourceId);
          existing.history.push(hist(ctx, 'corroborated', null, pc.sourceId, 'То же значение во втором источнике'));
          touch(existing, ctx);
          pc.status = 'accepted';
          ev('Fact', existing.id, 'corroborated', null, pc.sourceId);
          return;
        }
        // Значение отличается: никакой бесшумной перезаписи — создаём противоречие.
        pc.status = 'conflict';
        const c = {
          ...meta(ctx, opp.isDemo, 'cnf'), key: key as Exclude<FactKey, 'metric' | 'budget_mention' | 'client_wish' | 'risk' | 'unknown'>, factId: existing.id, proposedChangeId: pc.id,
          existingValue: existing.value, existingSourceId: existing.sourceId, proposedValue: pc.value, proposedSourceId: pc.sourceId,
          status: 'open' as const, resolution: null,
        };
        opp.conflicts.push(c);
        ev('Conflict', c.id, 'opened', existing.value, pc.value, `Разные значения «${FACT_KEY_LABELS[key]}» в двух источниках`);
        return;
      }
      const f = newFact(opp, ctx, key, pc.value, 'client_words', pc.sourceId, pc.excerpt, pc.timecode);
      opp.facts.push(f);
      pc.status = 'accepted';
      ev('Fact', f.id, 'added_from_source', null, { key, value: pc.value }, 'Принято человеком из демо-разбора');
      return;
    }
    case 'metric':
    case 'budget_mention':
    case 'client_wish': {
      const status: FactStatus = pc.kind === 'budget_mention' ? 'needs_clarification' : 'client_words';
      const f = newFact(opp, ctx, pc.key ?? pc.kind, pc.value, status, pc.sourceId, pc.excerpt, pc.timecode);
      opp.facts.push(f);
      pc.status = 'accepted';
      ev('Fact', f.id, 'added_from_source', null, { key: f.key, value: f.value }, pc.note);
      return;
    }
    case 'promise_candidate': {
      const pr: AgencyPromise = {
        ...meta(ctx, opp.isDemo, 'prm'), byRole: 'Агентство (уточнить, кто)', when: null, what: String(pc.value), category: 'other',
        sourceId: pc.sourceId, status: 'discussed', conditional: false, history: [],
      };
      opp.promises.push(pr);
      opp.promisesNotRecorded = false;
      pc.status = 'accepted';
      ev('Promise', pr.id, 'added_from_source', null, { what: pr.what, status: 'discussed' }, 'Статус «обсуждалось»; подтверждение — отдельным действием');
      return;
    }
    case 'conditional':
    case 'clarification': {
      const c: Clarification = {
        ...meta(ctx, opp.isDemo, 'clr'),
        question: pc.kind === 'conditional' ? `Условное высказывание: «${String(pc.value)}». Это обязательство, план или пожелание? При каких условиях?` : String(pc.value),
        addressedToRole: pc.addressedToRole ?? 'Клиент: контактное лицо',
        impacts: pc.kind === 'conditional' ? ['timeline'] : ['scope', 'route'],
        sourceId: pc.sourceId, status: 'open', answer: null,
      };
      opp.clarifications.push(c);
      pc.status = 'accepted';
      ev('Clarification', c.id, 'added_from_source', null, { question: c.question, to: c.addressedToRole }, pc.note);
      return;
    }
  }
}

function supersedeSource(opp: Opportunity, oldId: string, s: Source, ctx: Ctx, ev: (t: string, id: string, a: string, b: unknown, af: unknown, r?: string | null) => void) {
  const old = opp.sources.find((x) => x.id === oldId);
  if (!old) return;
  old.status = 'superseded';
  touch(old, ctx);
  const reason = `Источник «${old.title}» изменён (v${old.version} → v${s.version})`;
  for (const f of opp.facts.filter((f) => f.sourceId === oldId)) {
    f.needsRecheck = true;
    f.recheckReason = reason;
    f.history.push(hist(ctx, 'needs_recheck', null, reason, reason));
    touch(f, ctx);
    ev('Fact', f.id, 'marked_needs_recheck', null, reason, reason);
  }
  for (const f of opp.findings.filter((f) => f.sourceId === oldId)) {
    const before = f.verification;
    f.verification = 'needs_recheck';
    f.recheckReason = reason;
    f.history.push(hist(ctx, 'needs_recheck', before, 'needs_recheck', reason));
    touch(f, ctx);
    ev('AuditFinding', f.id, 'marked_needs_recheck', before, 'needs_recheck', reason);
  }
}

function validateBasis(opp: Opportunity, w: WorkItem) {
  if (w.basis?.type === 'finding') find(opp.findings, w.basis.findingId, 'Находка-основание');
  if (w.quantity !== null && (typeof w.quantity !== 'number' || w.quantity < 0)) throw new DomainError('validation', 'Количество — неотрицательное число');
}

function assertWorkItemEditable(opp: Opportunity, id: string) {
  const locked = opp.proposals.find((p) => p.content.workItemIds.includes(id) && ['sent', 'accepted', 'rejected', 'superseded'].includes(p.status));
  const draftUses = opp.proposals.some((p) => p.content.workItemIds.includes(id) && (p.status === 'draft' || p.status === 'approved_for_send'));
  if (locked && !draftUses)
    throw new DomainError('immutable', `Работа входит в отправленную версию КП v${locked.number}. Создайте новую редакцию КП и копию работы`);
}

function editableEstimate(opp: Opportunity, id: string): EstimateVersion {
  const est = find(opp.estimates, id, 'Расчёт');
  if (est.status === 'locked') throw new DomainError('immutable', `Расчёт v${est.number} зафиксирован с отправленной версией КП. Создайте новую редакцию`);
  return est;
}

function newEstimate(opp: Opportunity, ctx: Ctx, number: number): EstimateVersion {
  return {
    ...meta(ctx, opp.isDemo, 'est'), number, status: 'draft',
    lines: [
      { id: ctx.newId('cl'), kind: 'pm', workItemId: null, label: 'Часы проджекта', performerUserId: opp.presalePmUserId, hours: null, hoursMin: null, hoursMax: null, rateKop: null, amountKop: null, zeroReason: null, confidence: 'preliminary' },
      { id: ctx.newId('cl'), kind: 'approvals', workItemId: null, label: 'Согласования с клиентом', performerUserId: opp.presalePmUserId, hours: null, hoursMin: null, hoursMax: null, rateKop: null, amountKop: null, zeroReason: null, confidence: 'preliminary' },
    ],
    commissionRuleId: null, noCommissionConfirmed: false, targetMarginBp: null, targetMarginSource: null, rounding: 'up_to_ruble',
    taxModel: { status: 'not_set', description: null }, priceMode: 'formula', manualPriceKop: null, discount: null, externalBudgets: [],
  };
}

function emptyContent(opp: Opportunity): ProposalContent {
  return {
    understanding: null, firstOfferWhy: null, resultAndAcceptance: null, workItemIds: opp.workItems.map((w) => w.id), timeline: null,
    dependencies: null, clientActions: null, payment: null, revisions: null, exclusions: null, validUntil: null, extraWorkProcedure: null,
    nextStep: null, freeWork: null,
  };
}

function newProposal(opp: Opportunity, ctx: Ctx, number: number, estimateVersionId: string, previousVersionId: string | null, content: ProposalContent): ProposalVersion {
  return {
    ...meta(ctx, opp.isDemo, 'kp'), number, status: 'draft', previousVersionId, estimateVersionId, content, frozenSnapshotId: null,
    sent: null, accepted: null, rejected: null, clientQuestions: [], nextContact: null,
  };
}

const pickWork = (w: WorkItem) => ({ title: w.title, quantity: w.quantity, unit: w.unit, acceptanceCriterion: w.acceptanceCriterion, basis: w.basis });
const pickEstimate = (e: EstimateVersion) => ({
  commissionRuleId: e.commissionRuleId, targetMarginBp: e.targetMarginBp, priceMode: e.priceMode, manualPriceKop: e.manualPriceKop, discount: e.discount,
  taxModel: e.taxModel, externalBudgets: e.externalBudgets, rounding: e.rounding,
});
