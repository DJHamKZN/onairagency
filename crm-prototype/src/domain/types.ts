/**
 * Доменные типы прототипа ON AIR CRM.
 * Деньги — целые копейки (number, проверяется Number.isSafeInteger).
 * Доли (комиссия, маржа) — целые базисные пункты: 10000 bp = 100 %.
 * Отсутствующее значение — null, а не 0 и не пустая строка.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;
export type Kop = number; // целые копейки
export type Bp = number; // базисные пункты

export type Role = 'owner' | 'presale_pm' | 'lead_specialist' | 'specialist' | 'receiving_pm';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Владелец',
  presale_pm: 'Проджект пресейла',
  lead_specialist: 'Ведущий специалист / стратег',
  specialist: 'Специалист',
  receiving_pm: 'Принимающий проджект',
};

/** Общие поля любой записи. */
export interface BaseRecord {
  id: string;
  createdAt: ISODateTime;
  createdBy: string; // user id
  updatedAt: ISODateTime;
  updatedBy: string;
  rev: number; // версия записи
  isDemo: boolean;
}

export interface User {
  id: string;
  login: string;
  displayName: string;
  roles: Role[];
  isDemo: boolean;
}

export interface Company extends BaseRecord {
  name: string;
  note: string | null;
}

export interface Contact extends BaseRecord {
  companyId: string;
  /** Синтетическая метка без реальных персональных данных: «Контакт 1». */
  label: string;
  decisionRole: 'decision_maker' | 'influencer' | 'user' | 'data_owner' | 'unknown';
}

export type WorkStage =
  | 'new_request'
  | 'clarifying'
  | 'preparing_proposal'
  | 'discussing_proposal'
  | 'preparing_launch';

export type Stage = WorkStage | 'handed_off' | 'paused' | 'closed_lost';

export type RouteType = 'A' | 'B' | 'C';

export interface NextStep {
  text: string;
  assigneeUserId: string;
  due: ISODate;
}

export type BudgetStatus = 'not_discussed' | 'range' | 'confirmed';

export interface Budget {
  status: BudgetStatus;
  minKop: Kop | null;
  maxKop: Kop | null;
  period: string | null;
  note: string | null;
}

/* ---------- Источники, факты, предложения изменений ---------- */

export type SourceKind = 'note' | 'transcript' | 'email' | 'link' | 'file_text';

export interface Source extends BaseRecord {
  kind: SourceKind;
  title: string;
  /** Компания, к которой источник отнесён при вводе (для проверки чужого клиента). */
  declaredCompany: string | null;
  receivedAt: ISODate | null;
  text: string;
  link: string | null; // не открывается и не проверяется прототипом
  original: { stored: false; filename: string | null; mime: string | null; sizeBytes: number | null };
  version: number;
  previousVersionId: string | null;
  status: 'active' | 'superseded' | 'quarantined' | 'rejected';
  quarantineReason: string | null;
  attributionDecision: { by: string; at: ISODateTime; comment: string } | null;
  parsedAt: ISODateTime | null;
}

export type FactStatus = 'client_words' | 'confirmed' | 'hypothesis' | 'needs_clarification';

export const FACT_STATUS_LABELS: Record<FactStatus, string> = {
  client_words: 'Слова клиента',
  confirmed: 'Подтверждено',
  hypothesis: 'Гипотеза',
  needs_clarification: 'Требует уточнения',
};

/** Однозначные поля карточки: новое отличающееся значение создаёт конфликт. */
export type SingleFactKey =
  | 'request_verbatim'
  | 'business_goal'
  | 'product'
  | 'audience'
  | 'geography'
  | 'deadline'
  | 'constraints'
  | 'materials'
  | 'decision_maker';

/** Многозначные записи: добавляются рядом, никогда не суммируются. */
export type MultiFactKey = 'metric' | 'budget_mention' | 'client_wish' | 'risk' | 'unknown';

export type FactKey = SingleFactKey | MultiFactKey;

export interface MetricValue {
  kind: 'actual' | 'goal';
  entity: string; // «регистрации», «оплаты», «подписки»
  value: number | null;
  unit: string;
  period: string | null;
  denominator: string | null;
}

export interface BudgetMentionValue {
  amountKop: Kop | null;
  period: string | null; // «в месяц», «на первый тест»
  purpose: string | null;
}

export type FactValue = string | MetricValue | BudgetMentionValue;

export interface HistoryEntry {
  at: ISODateTime;
  by: string;
  actingRole: Role;
  action: string;
  from: unknown;
  to: unknown;
  reason: string | null;
}

export interface Fact extends BaseRecord {
  key: FactKey;
  value: FactValue;
  status: FactStatus;
  sourceId: string | null;
  excerpt: string | null;
  timecode: string | null;
  verifiedBy: string | null;
  verifiedAt: ISODateTime | null;
  significant: boolean;
  needsRecheck: boolean;
  recheckReason: string | null;
  corroboratingSourceIds: string[];
  history: HistoryEntry[];
}

export type ProposedChangeKind =
  | 'fact'
  | 'metric'
  | 'budget_mention'
  | 'client_wish'
  | 'promise_candidate'
  | 'conditional'
  | 'clarification';

export interface ProposedChange extends BaseRecord {
  sourceId: string;
  kind: ProposedChangeKind;
  key: FactKey | null;
  value: FactValue;
  excerpt: string;
  timecode: string | null;
  /** Пояснение демо-разбора: почему предложено именно так. */
  note: string;
  status: 'pending' | 'accepted' | 'rejected' | 'conflict';
  decision: { by: string; actingRole: Role; at: ISODateTime; comment: string | null } | null;
  /** Предлагаемый адресат вопроса (для clarification). */
  addressedToRole: string | null;
}

export interface Conflict extends BaseRecord {
  key: SingleFactKey;
  factId: string;
  proposedChangeId: string;
  existingValue: FactValue;
  existingSourceId: string | null;
  proposedValue: FactValue;
  proposedSourceId: string;
  status: 'open' | 'resolved';
  resolution: {
    choice: 'keep_existing' | 'take_proposed' | 'needs_clarification';
    comment: string;
    by: string;
    actingRole: Role;
    at: ISODateTime;
  } | null;
}

export type PromiseCategory = 'result' | 'price' | 'deadline' | 'discount' | 'free_work' | 'other';

export interface AgencyPromise extends BaseRecord {
  /** Кто обещал — роль агентства, без персональных данных. */
  byRole: string;
  when: ISODate | null;
  what: string;
  category: PromiseCategory;
  sourceId: string | null;
  status: 'discussed' | 'confirmed' | 'withdrawn';
  conditional: boolean;
  history: HistoryEntry[];
}

export type ImpactArea = 'route' | 'scope' | 'cost' | 'timeline' | 'risk' | 'acceptance';

export interface Clarification extends BaseRecord {
  question: string;
  addressedToRole: string; // «Владелец данных клиента», «Клиент: ЛПР»…
  impacts: ImpactArea[];
  sourceId: string | null;
  status: 'open' | 'answered' | 'dropped';
  answer: string | null;
}

export interface Task extends BaseRecord {
  title: string;
  assigneeUserId: string | null;
  role: Role | null;
  due: ISODate | null;
  status: 'open' | 'done' | 'cancelled';
  blocker: boolean;
  kind: 'estimate' | 'owner_decision' | 'client_reply' | 'handoff_fix' | 'other';
  cancelledReason: string | null;
}

/* ---------- Диагностика и аудит ---------- */

export type ModuleKey =
  | 'product_offer'
  | 'audience'
  | 'demand'
  | 'competitors'
  | 'site_path'
  | 'ads'
  | 'content'
  | 'analytics'
  | 'sales_crm'
  | 'economics'
  | 'partnerships';

export const MODULE_LABELS: Record<ModuleKey, string> = {
  product_offer: 'Продукт и предложение',
  audience: 'Аудитория',
  demand: 'Спрос',
  competitors: 'Конкуренты',
  site_path: 'Сайт и путь обращения',
  ads: 'Реклама',
  content: 'Контент',
  analytics: 'Аналитика',
  sales_crm: 'Продажи и CRM',
  economics: 'Экономика',
  partnerships: 'Партнёрства',
};

export type ModuleStatus = 'sufficient' | 'partial' | 'not_done' | 'needs_access' | 'not_applicable';

export const MODULE_STATUS_LABELS: Record<ModuleStatus, string> = {
  sufficient: 'Достаточно для решения',
  partial: 'Частично',
  not_done: 'Не выполнено',
  needs_access: 'Нужен конкретный доступ',
  not_applicable: 'Неприменимо',
};

export interface AuditModule {
  key: ModuleKey;
  status: ModuleStatus;
  reason: string | null; // обязательна для partial/not_done/needs_access/not_applicable
  accessNeeded: string | null;
  accessOwnerRole: string | null;
  blockedDecision: string | null;
  deepDive: boolean; // глубокий разбор только выбранных сценариев
}

export type LeadPathLevel =
  | 'button'
  | 'open'
  | 'fill'
  | 'submit'
  | 'delivery'
  | 'processing'
  | 'qualification';

export const LEAD_PATH_LEVELS: LeadPathLevel[] = [
  'button', 'open', 'fill', 'submit', 'delivery', 'processing', 'qualification',
];

export const LEAD_PATH_LABELS: Record<LeadPathLevel, string> = {
  button: 'Кнопка',
  open: 'Открытие формы',
  fill: 'Заполнение',
  submit: 'Отправка',
  delivery: 'Получение агентством/клиентом',
  processing: 'Обработка',
  qualification: 'Квалификация',
};

export type LeadPathStatus = 'not_checked' | 'observed_publicly' | 'confirmed_by_client_data' | 'not_applicable';

export interface AuditRoute {
  type: RouteType | null;
  rationale: string | null;
  depth: 'none' | 'external_evidence' | 'internal_diagnostics';
  fullMarketingAudit: boolean;
  /** Лимит внутренних часов на предварительную проверку. По умолчанию не утверждён. */
  presaleLimit: { hours: number | null; approvedBy: string | null; approvedAt: ISODateTime | null };
  spentHours: number;
  overLimitDecision: { by: string; at: ISODateTime; comment: string } | null;
  modules: AuditModule[];
  scenarios: { id: string; title: string; decision: string }[];
  leadPath: Record<LeadPathLevel, { status: LeadPathStatus; note: string | null }>;
  deliverables: AuditDeliverable[];
  externalSummary: { understood: string; checked: string; unknown: string; questions: string; recommendedRoute: RouteType | null } | null;
}

export type DeliverableKind = 'client_brief_pdf' | 'client_detailed_docx' | 'internal_docx';

export interface AuditDeliverable {
  kind: DeliverableKind;
  lastGeneratedAt: ISODateTime | null;
  lastGeneratedBy: string | null;
  limitationsNote: string | null;
}

export type ClaimType = 'observation' | 'source_statement' | 'calculation' | 'interpretation' | 'hypothesis' | 'unknown';

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  observation: 'Наблюдение',
  source_statement: 'Заявление источника',
  calculation: 'Расчёт',
  interpretation: 'Интерпретация',
  hypothesis: 'Гипотеза',
  unknown: 'Неизвестное',
};

export type Verification = 'unverified' | 'supported' | 'not_supported' | 'needs_recheck';

export const VERIFICATION_LABELS: Record<Verification, string> = {
  unverified: 'Не проверено',
  supported: 'Доказательство подтверждает вывод',
  not_supported: 'Цитата не подтверждает вывод',
  needs_recheck: 'Требует повторной проверки',
};

export interface NumberClaim {
  entity: string;
  value: number;
  unit: string;
  period: string;
  denominator: string | null;
  sample: string | null;
  method: string;
}

export interface AuditFinding extends BaseRecord {
  /** Стабильный код, не меняется при переименовании. */
  code: string;
  title: string;
  module: ModuleKey;
  scenarioId: string | null;
  claimType: ClaimType;
  dataBasis: 'external_public' | 'internal_client_data' | 'client_words';
  observation: string;
  causeHypothesis: string | null;
  sourceId: string | null;
  sourceDate: ISODate | null;
  scope: string | null;
  dataPeriod: string | null;
  evidenceQuote: string | null;
  evidenceReview: { supportsClaim: boolean; by: string; at: ISODateTime; comment: string } | null;
  verification: Verification;
  limitation: string | null;
  impact: string | null;
  recommendation: string | null;
  effectCheck: string | null;
  numbers: NumberClaim[];
  authorUserId: string;
  recheckReason: string | null;
  history: HistoryEntry[];
}

/* ---------- Работы и экономика ---------- */

export interface WorkItem extends BaseRecord {
  title: string;
  basis:
    | { type: 'finding'; findingId: string }
    | { type: 'client_task'; text: string }
    | null;
  expectedResult: string | null;
  quantity: number | null;
  unit: string | null;
  acceptanceCriterion: string | null;
  recurrence: 'one_time' | 'monthly';
  assigneeUserId: string | null;
}

export type CostLineKind = 'specialist' | 'pm' | 'approvals' | 'contractor' | 'service' | 'other';

export const COST_LINE_LABELS: Record<CostLineKind, string> = {
  specialist: 'Специалист (часы)',
  pm: 'Проджект (часы)',
  approvals: 'Согласования (часы)',
  contractor: 'Подрядчик (сумма)',
  service: 'Сервисы (сумма)',
  other: 'Прочие затраты (сумма)',
};

export interface CostLine {
  id: string;
  kind: CostLineKind;
  workItemId: string | null;
  label: string;
  performerUserId: string | null;
  hours: number | null;
  hoursMin: number | null;
  hoursMax: number | null;
  rateKop: Kop | null; // ставка за час, для часовых строк
  amountKop: Kop | null; // для фиксированных строк
  /** Ноль допустим только с явной причиной. */
  zeroReason: string | null;
  confidence: 'preliminary' | 'specialist_estimate' | 'confirmed';
}

export interface CommissionRule extends BaseRecord {
  label: string;
  rateBp: Bp | null;
  base: 'agency_fee' | 'other';
  baseDescription: string | null;
  /** Для base = other — явная сумма базы. */
  baseAmountKop: Kop | null;
  period: string | null;
  condition: string | null;
  recipientRole: string; // демо-роль, без персональных данных
  ownerApproved: boolean;
}

export interface ExternalBudget {
  id: string;
  label: string;
  amountKop: Kop | null;
  period: string | null;
  paidBy: 'client_direct' | 'through_agency';
}

export interface EstimateVersion extends BaseRecord {
  number: number;
  status: 'draft' | 'locked';
  lines: CostLine[];
  commissionRuleId: string | null; // null = комиссии нет (явно)
  noCommissionConfirmed: boolean;
  targetMarginBp: Bp | null;
  targetMarginSource: 'demo_unapproved' | 'owner_approved' | null;
  rounding: 'up_to_ruble' | 'half_up_kopeck';
  taxModel: { status: 'not_set' | 'set'; description: string | null };
  priceMode: 'formula' | 'manual';
  manualPriceKop: Kop | null;
  discount: { amountKop: Kop; reason: string } | null;
  externalBudgets: ExternalBudget[];
}

/* ---------- КП, утверждения ---------- */

export type ProposalStatus = 'draft' | 'approved_for_send' | 'sent' | 'accepted' | 'rejected' | 'superseded';

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Черновик',
  approved_for_send: 'Утверждён для отправки',
  sent: 'Отправлен (зафиксировано)',
  accepted: 'Принят клиентом',
  rejected: 'Отклонён',
  superseded: 'Заменён',
};

export interface ProposalContent {
  understanding: string | null;
  firstOfferWhy: string | null;
  resultAndAcceptance: string | null;
  workItemIds: string[];
  timeline: string | null;
  dependencies: string | null;
  clientActions: string | null;
  payment: string | null;
  revisions: string | null;
  exclusions: string | null;
  validUntil: ISODate | null;
  extraWorkProcedure: string | null;
  nextStep: string | null;
  freeWork: string | null;
}

export interface ProposalVersion extends BaseRecord {
  number: number;
  status: ProposalStatus;
  previousVersionId: string | null;
  estimateVersionId: string;
  content: ProposalContent;
  /** Снимок клиентских данных при фиксации отправки. */
  frozenSnapshotId: string | null;
  sent: { recipientLabel: string; date: ISODate; channelNote: string; recordedBy: string; at: ISODateTime; demo: true } | null;
  accepted: { date: ISODate; confirmationSource: string; recordedBy: string; at: ISODateTime } | null;
  rejected: { date: ISODate; reason: string; recordedBy: string; at: ISODateTime } | null;
  clientQuestions: { id: string; text: string; at: ISODateTime; by: string }[];
  nextContact: ISODate | null;
}

export type ApprovalCategory =
  | 'scope'
  | 'price'
  | 'discount'
  | 'commission'
  | 'payment'
  | 'timeline'
  | 'free_work'
  | 'dependencies'
  | 'costs'
  | 'margin'
  | 'content';

export const APPROVAL_CATEGORY_LABELS: Record<ApprovalCategory, string> = {
  scope: 'Объём работ',
  price: 'Цена',
  discount: 'Скидка',
  commission: 'Комиссия / база комиссии',
  payment: 'Условия оплаты',
  timeline: 'Сроки',
  free_work: 'Бесплатные работы',
  dependencies: 'Существенные зависимости',
  costs: 'Затраты (C)',
  margin: 'Целевая маржа',
  content: 'Текст КП',
};

export interface Approval extends BaseRecord {
  proposalVersionId: string;
  estimateVersionId: string;
  snapshotId: string;
  snapshotHash: string;
  /** Копия неизменяемого снимка (MaterialSnapshot), хранится также в append-only таблице snapshots. */
  snapshot: unknown;
  approvedBy: string;
  actingRole: 'owner';
  approvedAt: ISODateTime;
  comment: string | null;
  status: 'active' | 'revoked';
  revoked: { at: ISODateTime; by: string; reason: string; categories: ApprovalCategory[]; details: string[] } | null;
}

/* ---------- Запуск ---------- */

export type ChecklistKey =
  | 'goal_first_result'
  | 'accepted_scope'
  | 'contract'
  | 'payment_status'
  | 'scope_exclusions'
  | 'revisions'
  | 'promises'
  | 'materials'
  | 'findings'
  | 'open_risks'
  | 'roles'
  | 'approvers'
  | 'communication'
  | 'accesses'
  | 'performers'
  | 'capacity'
  | 'calendar'
  | 'acceptance_baseline';

export interface ChecklistItem {
  key: ChecklistKey;
  status: 'open' | 'done' | 'not_applicable';
  note: string | null;
  naReason: string | null;
  updatedBy: string | null;
  updatedAt: ISODateTime | null;
}

export interface LaunchChecklist {
  items: ChecklistItem[];
  payment: { status: 'unknown' | 'paid_confirmed_manually' | 'deferred_by_terms' | 'not_required_by_terms'; note: string | null };
  linkSharedAt: ISODateTime | null; // «ссылка передана» — не является приёмкой
}

export interface HandoffAcceptance extends BaseRecord {
  packageHash: string;
  decision: 'accepted' | 'returned';
  remarks: string | null;
  by: string;
  actingRole: 'receiving_pm';
  at: ISODateTime;
}

export interface LaunchAuthorization extends BaseRecord {
  packageHash: string;
  proposalVersionId: string;
  by: string;
  actingRole: 'owner';
  at: ISODateTime;
}

/* ---------- Возможность (агрегат) ---------- */

export interface Opportunity extends BaseRecord {
  title: string;
  companyId: string;
  contactIds: string[];
  stage: Stage;
  originalRequest: string;
  promisesNotRecorded: boolean;
  ownerUserId: string; // ответственный
  presalePmUserId: string | null;
  leadSpecialistUserId: string | null;
  specialistUserIds: string[];
  receivingPmUserId: string | null;
  nextStep: NextStep;
  continuation: { method: string; by: string; at: ISODateTime } | null;
  readiness: { decision: 'enough_for_proposal' | 'offer_paid_diagnostic'; justification: string; by: string; at: ISODateTime } | null;
  budget: Budget;
  pause: { reason: string; nextActor: string; returnDate: ISODate; resumeStage: WorkStage; at: ISODateTime; by: string } | null;
  closure: { reason: string; outcome: string; at: ISODateTime; by: string } | null;
  related: { opportunityId: string; relation: 'paid_diagnostic' | 'implementation' }[];
  pmCostVisibility: boolean;
  sources: Source[];
  facts: Fact[];
  proposedChanges: ProposedChange[];
  conflicts: Conflict[];
  promises: AgencyPromise[];
  clarifications: Clarification[];
  tasks: Task[];
  audit: AuditRoute;
  findings: AuditFinding[];
  workItems: WorkItem[];
  estimates: EstimateVersion[];
  commissionRules: CommissionRule[];
  proposals: ProposalVersion[];
  approvals: Approval[];
  launch: LaunchChecklist;
  handoffAcceptances: HandoffAcceptance[];
  launchAuthorizations: LaunchAuthorization[];
  findingSeq: number;
}

export interface ChangeEvent {
  id: string;
  opportunityId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  actingRole: Role | 'system';
  at: ISODateTime;
  before: unknown;
  after: unknown;
  reason: string | null;
  override: boolean;
  isDemo: boolean;
}

export interface Snapshot {
  id: string;
  opportunityId: string;
  kind: 'approval' | 'proposal_sent';
  hash: string;
  data: unknown;
  createdAt: ISODateTime;
  createdBy: string;
  isDemo: boolean;
}

export interface Settings {
  /** Демо-значения: требуют утверждения владельцем. */
  defaultTargetMarginBp: Bp | null;
  targetMarginApproved: boolean;
  presaleLimitHoursDefault: number | null;
  presaleLimitApproved: boolean;
  rateCard: { role: string; rateKop: Kop; approved: boolean }[];
}
