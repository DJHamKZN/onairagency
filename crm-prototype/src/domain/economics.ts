import { applyBp, divCeil, divRoundHalfUp, hoursCost, shareThousandthsOfPercent } from './money';
import type { CommissionRule, CostLine, EstimateVersion, Kop } from './types';
import { COST_LINE_LABELS } from './types';

/**
 * Управленческий расчёт. Термины:
 *  - P — цена услуг = выручка агентства (отдельно для разовых и для ежемесячных работ);
 *  - C — затраты агентства на выполнение;
 *  - комиссия за привлечение — выплата партнёру ИЗ выручки агентства, не часть цены для клиента и не «вознаграждение агентства»;
 *  - рекламный бюджет и внешние расходы клиента — не выручка агентства, не входят ни в P, ни в C, ни в базу комиссии.
 * Три независимых статуса: данные заполнены → оценки проверены → экономика утверждена владельцем (последнее — в approval).
 */

export type Part = 'one_time' | 'monthly';
export const PART_LABELS: Record<Part, string> = { one_time: 'Разовые работы', monthly: 'Ежемесячные работы (в месяц)' };

export interface EconIssue {
  lineId: string | null;
  field: string;
  message: string;
  /** incomplete — не хватает данных; error — недопустимое значение; unverified — значение есть, но оценка не проверена. */
  severity: 'incomplete' | 'error' | 'unverified';
  part?: Part;
}

export interface FormulaStep {
  label: string;
  value: string;
}

export interface PartResult {
  part: Part;
  present: boolean;
  /** Все затраты части; null, если хотя бы одна строка без значения — пустое не считается нулём. */
  costKop: Kop | null;
  verifiedCostKop: Kop;
  unverifiedCostKop: Kop;
  unknownLines: number;
  unverifiedLines: number;
  costMinKop: Kop | null;
  costMaxKop: Kop | null;
  basePriceKop: Kop | null;
  discountKop: Kop;
  priceKop: Kop | null;
  commissionKop: Kop | null;
  remainderKop: Kop | null;
  remainderShareThousandths: number | null;
  belowTargetMargin: boolean;
  formulaUsed: boolean;
  steps: FormulaStep[];
}

export interface EstimateResult {
  /** Данные заполнены: нет пустых значений и ошибок. */
  filled: boolean;
  /** Все оценки проверены (строки подтверждены проверяющим). */
  verified: boolean;
  issues: EconIssue[];
  lineCosts: { lineId: string; part: Part; costKop: Kop | null; minKop: Kop | null; maxKop: Kop | null }[];
  oneTime: PartResult;
  monthly: PartResult;
  externalBudgetsKop: Kop | null;
}

const HOURLY = new Set(['specialist', 'pm', 'approvals']);
const fmt = (k: Kop) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(k / 100)}`;
const pct = (bp: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(bp / 100)} %`;

function lineCost(l: CostLine, issues: EconIssue[], part: Part): { cost: Kop | null; min: Kop | null; max: Kop | null } {
  const name = l.label || COST_LINE_LABELS[l.kind];
  const push = (field: string, message: string, severity: EconIssue['severity']) => issues.push({ lineId: l.id, field, message, severity, part });
  if (HOURLY.has(l.kind)) {
    if (l.hours === null) push('hours', `«${name}»: не указаны часы — значение неизвестно, итог не считается`, 'incomplete');
    if (l.rateKop === null) push('rateKop', `«${name}»: не указана ставка — значение неизвестно, итог не считается`, 'incomplete');
    if (l.hours !== null && l.hours < 0) push('hours', `«${name}»: часы не могут быть отрицательными`, 'error');
    if (l.rateKop !== null && l.rateKop < 0) push('rateKop', `«${name}»: ставка не может быть отрицательной`, 'error');
    if (l.hoursMin !== null && l.hoursMax !== null && l.hoursMin > l.hoursMax) push('hoursMin', `«${name}»: минимум диапазона больше максимума`, 'error');
    if ((l.hours === 0 || l.rateKop === 0) && !l.zeroReason) push('zeroReason', `«${name}»: ноль допустим только с подтверждённой причиной`, 'incomplete');
    if (l.hours === null || l.rateKop === null || l.hours < 0 || l.rateKop < 0) return { cost: null, min: null, max: null };
    const cost = hoursCost(l.hours, l.rateKop);
    return { cost, min: l.hoursMin !== null ? hoursCost(l.hoursMin, l.rateKop) : cost, max: l.hoursMax !== null ? hoursCost(l.hoursMax, l.rateKop) : cost };
  }
  if (l.amountKop === null) {
    push('amountKop', `«${name}»: не указана сумма — значение неизвестно, итог не считается`, 'incomplete');
    return { cost: null, min: null, max: null };
  }
  if (l.amountKop < 0) {
    push('amountKop', `«${name}»: сумма не может быть отрицательной`, 'error');
    return { cost: null, min: null, max: null };
  }
  if (l.amountKop === 0 && !l.zeroReason) push('zeroReason', `«${name}»: ноль допустим только с подтверждённой причиной`, 'incomplete');
  return { cost: l.amountKop, min: l.amountKop, max: l.amountKop };
}

export function ruleApplies(rule: CommissionRule | null, part: Part): boolean {
  if (!rule) return false;
  const a = rule.appliesTo ?? 'one_time';
  return a === 'both' || a === part;
}

/**
 * @param recurrenceOf — периодичность работы по её ID (строка, привязанная к работе, наследует её периодичность).
 */
export function computeEstimate(est: EstimateVersion, ruleArg: CommissionRule | null, recurrenceOf: (workItemId: string) => Part | undefined = () => undefined): EstimateResult {
  const rule = est.status === 'locked' && est.frozenRule !== undefined ? est.frozenRule : ruleArg;
  const issues: EconIssue[] = [];
  const partOf = (l: CostLine): Part => (l.workItemId ? recurrenceOf(l.workItemId) : undefined) ?? l.recurrence ?? 'one_time';

  const lineCosts = est.lines.map((l) => {
    const part = partOf(l);
    const r = lineCost(l, issues, part);
    if (r.cost !== null && l.confidence !== 'confirmed')
      issues.push({ lineId: l.id, field: 'confidence', part, severity: 'unverified', message: `«${l.label || COST_LINE_LABELS[l.kind]}»: оценка не проверена (${l.confidence === 'preliminary' ? 'предварительно' : 'оценка специалиста'})` });
    return { lineId: l.id, part, costKop: r.cost, minKop: r.min, maxKop: r.max, confirmed: l.confidence === 'confirmed' };
  });

  const oneTimeLines = lineCosts.filter((x) => x.part === 'one_time');
  if (!est.lines.some((l) => l.kind === 'pm'))
    issues.push({ lineId: null, field: 'lines', message: 'Нет строки часов проджекта (PM). Добавьте её или подтвердите ноль с причиной', severity: 'incomplete' });
  if (!est.lines.some((l) => l.kind === 'approvals'))
    issues.push({ lineId: null, field: 'lines', message: 'Нет строки часов на согласования. Добавьте её или подтвердите ноль с причиной', severity: 'incomplete' });
  if (est.taxModel.status !== 'set')
    issues.push({ lineId: null, field: 'taxModel', message: 'Модель налогов не задана владельцем — данные неполные (прототип ставки не подставляет)', severity: 'incomplete' });

  // Комиссия за привлечение
  let cBp = 0;
  const commissionOnPrice = !rule || rule.base === 'agency_fee';
  if (rule) {
    if (rule.rateBp === null) issues.push({ lineId: null, field: 'commission', message: `Комиссия за привлечение «${rule.label}»: ставка не задана`, severity: 'incomplete' });
    else if (rule.rateBp < 0 || rule.rateBp > 10000) issues.push({ lineId: null, field: 'commission', message: 'Ставка комиссии должна быть долей от 0 до 1 (0–100 %)', severity: 'error' });
    else cBp = rule.rateBp;
    if (!commissionOnPrice) {
      if (rule.baseAmountKop === null) issues.push({ lineId: null, field: 'commission', message: `База комиссии «${rule.baseDescription ?? 'другая сумма'}» не задана суммой`, severity: 'incomplete' });
      else if (rule.baseAmountKop < 0) issues.push({ lineId: null, field: 'commission', message: 'База комиссии не может быть отрицательной', severity: 'error' });
    }
  } else if (!est.noCommissionConfirmed) {
    issues.push({ lineId: null, field: 'commission', message: 'Не указано правило комиссии за привлечение и не подтверждено её отсутствие', severity: 'incomplete' });
  }
  const mBp = est.targetMarginBp;
  if (mBp !== null && (mBp < 0 || mBp >= 10000)) issues.push({ lineId: null, field: 'targetMarginBp', message: 'Целевая маржа должна быть долей от 0 до 1', severity: 'error' });

  const computePart = (part: Part): PartResult => {
    const rows = lineCosts.filter((x) => x.part === part);
    const steps: FormulaStep[] = [];
    const present = rows.length > 0 || (part === 'monthly' && est.manualMonthlyPriceKop != null);
    const unknownLines = rows.filter((x) => x.costKop === null).length;
    const verifiedCostKop = rows.filter((x) => x.costKop !== null && x.confirmed).reduce((s, x) => s + (x.costKop as number), 0);
    const unverifiedRows = rows.filter((x) => x.costKop !== null && !x.confirmed);
    const unverifiedCostKop = unverifiedRows.reduce((s, x) => s + (x.costKop as number), 0);
    const costKop = unknownLines ? null : verifiedCostKop + unverifiedCostKop;
    const costMinKop = unknownLines ? null : rows.reduce((s, x) => s + (x.minKop as number), 0);
    const costMaxKop = unknownLines ? null : rows.reduce((s, x) => s + (x.maxKop as number), 0);
    const per = part === 'monthly' ? ' в месяц' : '';
    const base: PartResult = {
      part, present, costKop, verifiedCostKop, unverifiedCostKop, unknownLines, unverifiedLines: unverifiedRows.length, costMinKop, costMaxKop,
      basePriceKop: null, discountKop: 0, priceKop: null, commissionKop: null, remainderKop: null, remainderShareThousandths: null,
      belowTargetMargin: false, formulaUsed: false, steps,
    };
    if (!present) return base;

    steps.push({ label: 'Затраты: проверенные оценки', value: fmt(verifiedCostKop) + per });
    steps.push({ label: 'Затраты: непроверенные оценки (предварительно / оценка специалиста)', value: fmt(unverifiedCostKop) + per });
    if (unknownLines) steps.push({ label: 'Строки без значения', value: `${unknownLines} — сумма затрат не считается, пустое не равно нулю` });
    else steps.push({ label: unverifiedRows.length ? 'C — затраты (включая непроверенные оценки)' : 'C — затраты (все оценки проверены)', value: fmt(costKop!) + per });

    const c = ruleApplies(rule, part) ? cBp : 0;
    const applies = ruleApplies(rule, part);
    const manual = part === 'one_time' ? est.manualPriceKop : est.manualMonthlyPriceKop ?? null;
    let basePrice: Kop | null = null;
    if (est.priceMode === 'formula') {
      if (applies && !commissionOnPrice) issues.push({ lineId: null, field: 'priceMode', part, severity: 'error', message: 'База комиссии отличается от цены услуг P — формула P = C / (1 − c − m) неприменима. Задайте цену вручную' });
      else if (mBp === null) issues.push({ lineId: null, field: 'targetMarginBp', part, severity: 'incomplete', message: 'Не задана целевая маржа m — формула не может быть применена' });
      else if (c + mBp >= 10000) issues.push({ lineId: null, field: 'targetMarginBp', part, severity: 'error', message: `Знаменатель 1 − c − m = ${pct(10000 - c - mBp)} ≤ 0: цена не определена. Уменьшите комиссию или маржу` });
      else if (costKop !== null && mBp >= 0 && c >= 0) {
        const denom = 10000 - c - mBp;
        basePrice = est.rounding === 'up_to_ruble' ? divCeil(divCeil(costKop * 10000, denom), 100) * 100 : divRoundHalfUp(costKop * 10000, denom);
        base.formulaUsed = true;
        steps.push({ label: 'c — комиссия за привлечение (доля цены услуг P)', value: applies ? pct(c) : '0 % (правило к этой части не применяется)' });
        steps.push({ label: 'm — целевая маржа (доля цены услуг P)', value: `${pct(mBp)}${est.targetMarginSource === 'owner_approved' ? '' : ' (демо, не утверждено владельцем)'}` });
        steps.push({ label: 'P — цена услуг (выручка агентства) = C / (1 − c − m)', value: `${fmt(costKop)} / ${pct(denom)} = ${fmt(basePrice)}${per}` });
        steps.push({ label: 'Правило округления', value: est.rounding === 'up_to_ruble' ? 'вверх до целого рубля' : 'half-up до копейки' });
      }
    } else if (manual === null || manual === undefined) {
      issues.push({ lineId: null, field: part === 'one_time' ? 'manualPriceKop' : 'manualMonthlyPriceKop', part, severity: 'incomplete', message: `Цена услуг (${PART_LABELS[part].toLowerCase()}) не задана` });
    } else if (manual < 0) issues.push({ lineId: null, field: 'manualPriceKop', part, severity: 'error', message: 'Цена не может быть отрицательной' });
    else {
      basePrice = manual;
      steps.push({ label: 'P — цена услуг (выручка агентства), задана вручную', value: fmt(manual) + per });
    }

    let price = basePrice;
    const d = est.discount;
    if (basePrice !== null && d && (d.appliesTo ?? 'one_time') === part) {
      if (d.amountKop < 0) issues.push({ lineId: null, field: 'discount', part, severity: 'error', message: 'Скидка не может быть отрицательной' });
      else if (d.amountKop > basePrice) issues.push({ lineId: null, field: 'discount', part, severity: 'error', message: 'Скидка больше цены' });
      else {
        price = basePrice - d.amountKop;
        base.discountKop = d.amountKop;
        steps.push({ label: `Скидка (${d.reason})`, value: `−${fmt(d.amountKop)} → P = ${fmt(price)}${per}` });
      }
    }
    base.basePriceKop = basePrice;
    base.priceKop = price;

    let commission: Kop | null = null;
    if (!applies) commission = rule || est.noCommissionConfirmed ? 0 : null;
    else if (rule && rule.rateBp !== null && c === rule.rateBp) {
      if (commissionOnPrice && price !== null) commission = applyBp(price, c);
      else if (!commissionOnPrice && rule.baseAmountKop !== null && rule.baseAmountKop >= 0) commission = applyBp(rule.baseAmountKop, c);
    }
    if (commission !== null && applies && rule)
      steps.push({ label: `Комиссия за привлечение: ${pct(c)} от ${commissionOnPrice ? 'цены услуг P' : rule.baseDescription ?? 'другой базы'} — выплата из выручки агентства (${rule.recipientRole})`, value: fmt(commission) + per });
    base.commissionKop = commission;

    if (price !== null && costKop !== null && commission !== null) {
      base.remainderKop = price - costKop - commission;
      base.remainderShareThousandths = price > 0 ? shareThousandthsOfPercent(base.remainderKop, price) : null;
      steps.push({ label: 'Остаток после затрат и комиссии = P − C − комиссия', value: `${fmt(price)} − ${fmt(costKop)} − ${fmt(commission)} = ${fmt(base.remainderKop)}${per}` });
      // доля в тысячных процента (25,714 % → 25714), маржа в сотых процента (30 % → 3000)
      base.belowTargetMargin = base.remainderShareThousandths !== null && mBp !== null && base.remainderShareThousandths < mBp * 10;
    }
    return base;
  };

  const oneTime = computePart('one_time');
  const monthly = computePart('monthly');
  if (!oneTime.present && !monthly.present) issues.push({ lineId: null, field: 'lines', message: 'Нет строк затрат', severity: 'incomplete' });
  void oneTimeLines;

  const externalKnown = est.externalBudgets.every((b) => b.amountKop !== null);
  const externalBudgetsKop = externalKnown ? est.externalBudgets.reduce((s, b) => s + (b.amountKop as number), 0) : null;
  if (!externalKnown) issues.push({ lineId: null, field: 'externalBudgets', message: 'Есть рекламный бюджет / внешний расход клиента без суммы', severity: 'incomplete' });

  const filled = !issues.some((i) => i.severity === 'error' || i.severity === 'incomplete')
    && (!oneTime.present || oneTime.remainderKop !== null) && (!monthly.present || monthly.remainderKop !== null);
  const verified = !issues.some((i) => i.severity === 'unverified') && lineCosts.every((x) => x.costKop !== null);
  return {
    filled,
    verified,
    issues,
    lineCosts: lineCosts.map(({ confirmed: _c, ...x }) => x),
    oneTime,
    monthly,
    externalBudgetsKop,
  };
}

/** Удобная обёртка: расчёт версии в контексте возможности (правило и периодичность работ). */
export function computeFor(opp: { estimates: EstimateVersion[]; commissionRules: CommissionRule[]; workItems: { id: string; recurrence: Part }[]; proposals?: { estimateVersionId: string; frozenWorks?: { id: string; recurrence: Part }[] | null }[] }, est: EstimateVersion): EstimateResult {
  const rule = est.commissionRuleId ? opp.commissionRules.find((r) => r.id === est.commissionRuleId) ?? null : null;
  const frozen = opp.proposals?.find((p) => p.estimateVersionId === est.id)?.frozenWorks ?? null;
  const works = frozen ?? opp.workItems;
  return computeEstimate(est, rule, (id) => works.find((w) => w.id === id)?.recurrence ?? opp.workItems.find((w) => w.id === id)?.recurrence);
}
