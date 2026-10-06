import { applyBp, divCeil, divRoundHalfUp, hoursCost, shareThousandthsOfPercent } from './money';
import type { CommissionRule, CostLine, EstimateVersion, Kop } from './types';
import { COST_LINE_LABELS } from './types';

export interface EconIssue {
  lineId: string | null;
  field: string;
  message: string;
  severity: 'incomplete' | 'error';
}

export interface FormulaStep {
  label: string;
  value: string;
}

export interface EstimateResult {
  /** Расчёт завершён: нет пропусков и ошибок. */
  complete: boolean;
  issues: EconIssue[];
  lineCosts: { lineId: string; costKop: Kop | null; minKop: Kop | null; maxKop: Kop | null }[];
  costKop: Kop | null; // C
  costMinKop: Kop | null;
  costMaxKop: Kop | null;
  basePriceKop: Kop | null; // до скидки
  priceKop: Kop | null; // P — итоговая агентская цена
  commissionKop: Kop | null;
  remainderKop: Kop | null;
  remainderShareThousandths: number | null; // доля остатка в тысячных долях процента
  belowTargetMargin: boolean;
  externalBudgetsKop: Kop | null;
  formulaUsed: boolean;
  steps: FormulaStep[];
}

const HOURLY = new Set(['specialist', 'pm', 'approvals']);

function lineCost(l: CostLine, issues: EconIssue[]): { cost: Kop | null; min: Kop | null; max: Kop | null } {
  const name = l.label || COST_LINE_LABELS[l.kind];
  if (HOURLY.has(l.kind)) {
    if (l.hours === null) issues.push({ lineId: l.id, field: 'hours', message: `«${name}»: не указаны часы — расчёт неполный`, severity: 'incomplete' });
    if (l.rateKop === null) issues.push({ lineId: l.id, field: 'rateKop', message: `«${name}»: не указана ставка — расчёт неполный`, severity: 'incomplete' });
    if (l.hours !== null && l.hours < 0) issues.push({ lineId: l.id, field: 'hours', message: `«${name}»: часы не могут быть отрицательными`, severity: 'error' });
    if (l.rateKop !== null && l.rateKop < 0) issues.push({ lineId: l.id, field: 'rateKop', message: `«${name}»: ставка не может быть отрицательной`, severity: 'error' });
    if (l.hoursMin !== null && l.hoursMax !== null && l.hoursMin > l.hoursMax) issues.push({ lineId: l.id, field: 'hoursMin', message: `«${name}»: минимум диапазона больше максимума`, severity: 'error' });
    if ((l.hours === 0 || l.rateKop === 0) && !l.zeroReason) issues.push({ lineId: l.id, field: 'zeroReason', message: `«${name}»: ноль допустим только с подтверждённой причиной`, severity: 'incomplete' });
    if (l.hours === null || l.rateKop === null || l.hours < 0 || l.rateKop < 0) return { cost: null, min: null, max: null };
    const cost = hoursCost(l.hours, l.rateKop);
    return {
      cost,
      min: l.hoursMin !== null ? hoursCost(l.hoursMin, l.rateKop) : cost,
      max: l.hoursMax !== null ? hoursCost(l.hoursMax, l.rateKop) : cost,
    };
  }
  if (l.amountKop === null) {
    issues.push({ lineId: l.id, field: 'amountKop', message: `«${name}»: не указана сумма — расчёт неполный`, severity: 'incomplete' });
    return { cost: null, min: null, max: null };
  }
  if (l.amountKop < 0) {
    issues.push({ lineId: l.id, field: 'amountKop', message: `«${name}»: сумма не может быть отрицательной`, severity: 'error' });
    return { cost: null, min: null, max: null };
  }
  if (l.amountKop === 0 && !l.zeroReason) issues.push({ lineId: l.id, field: 'zeroReason', message: `«${name}»: ноль допустим только с подтверждённой причиной`, severity: 'incomplete' });
  return { cost: l.amountKop, min: l.amountKop, max: l.amountKop };
}

const fmt = (k: Kop) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(k / 100)}`;
const pct = (bp: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(bp / 100)} %`;

/**
 * Управленческий расчёт. Не является обещанием чистой прибыли.
 * Формула P = C / (1 − c − m) применяется только если комиссия и маржа — доли одной и той же цены P
 * (база комиссии = агентское вознаграждение) или комиссии нет.
 */
export function computeEstimate(est: EstimateVersion, rule: CommissionRule | null): EstimateResult {
  const issues: EconIssue[] = [];
  const steps: FormulaStep[] = [];
  const lineCosts = est.lines.map((l) => {
    const r = lineCost(l, issues);
    return { lineId: l.id, costKop: r.cost, minKop: r.min, maxKop: r.max };
  });

  if (!est.lines.some((l) => l.kind === 'pm'))
    issues.push({ lineId: null, field: 'lines', message: 'Нет строки часов проджекта (PM). Добавьте её или подтвердите ноль с причиной', severity: 'incomplete' });
  if (!est.lines.some((l) => l.kind === 'approvals'))
    issues.push({ lineId: null, field: 'lines', message: 'Нет строки часов на согласования. Добавьте её или подтвердите ноль с причиной', severity: 'incomplete' });
  if (est.taxModel.status !== 'set')
    issues.push({ lineId: null, field: 'taxModel', message: 'Модель налогов не задана владельцем — расчёт неполный (прототип ставки не подставляет)', severity: 'incomplete' });

  const allKnown = lineCosts.every((c) => c.costKop !== null);
  const costKop = allKnown ? lineCosts.reduce((s, c) => s + (c.costKop as number), 0) : null;
  const costMinKop = allKnown ? lineCosts.reduce((s, c) => s + (c.minKop as number), 0) : null;
  const costMaxKop = allKnown ? lineCosts.reduce((s, c) => s + (c.maxKop as number), 0) : null;
  if (costKop !== null) steps.push({ label: 'C — подтверждённые затраты без комиссии (сумма строк)', value: fmt(costKop) });

  // Комиссия
  let cBp = 0;
  let commissionOnPrice = true;
  if (rule) {
    if (rule.rateBp === null) issues.push({ lineId: null, field: 'commission', message: `Комиссия «${rule.label}»: ставка не задана`, severity: 'incomplete' });
    else if (rule.rateBp < 0 || rule.rateBp > 10000) issues.push({ lineId: null, field: 'commission', message: 'Ставка комиссии должна быть долей от 0 до 1 (0–100 %)', severity: 'error' });
    else cBp = rule.rateBp;
    if (rule.base !== 'agency_fee') {
      commissionOnPrice = false;
      if (rule.baseAmountKop === null) issues.push({ lineId: null, field: 'commission', message: `База комиссии «${rule.baseDescription ?? 'другая сумма'}» не задана суммой`, severity: 'incomplete' });
      else if (rule.baseAmountKop < 0) issues.push({ lineId: null, field: 'commission', message: 'База комиссии не может быть отрицательной', severity: 'error' });
    }
  } else if (!est.noCommissionConfirmed) {
    issues.push({ lineId: null, field: 'commission', message: 'Не указано правило комиссии и не подтверждено её отсутствие', severity: 'incomplete' });
  }

  // Маржа
  const mBp = est.targetMarginBp;
  if (mBp !== null && (mBp < 0 || mBp >= 10000)) issues.push({ lineId: null, field: 'targetMarginBp', message: 'Целевая маржа должна быть долей от 0 до 1', severity: 'error' });

  let basePriceKop: Kop | null = null;
  let formulaUsed = false;
  if (est.priceMode === 'formula') {
    if (!commissionOnPrice) {
      issues.push({ lineId: null, field: 'priceMode', message: 'База комиссии отличается от цены P — формула P = C / (1 − c − m) неприменима. Задайте цену вручную', severity: 'error' });
    } else if (mBp === null) {
      issues.push({ lineId: null, field: 'targetMarginBp', message: 'Не задана целевая маржа m — формула не может быть применена', severity: 'incomplete' });
    } else if (cBp + mBp >= 10000) {
      issues.push({ lineId: null, field: 'targetMarginBp', message: `Знаменатель 1 − c − m = ${pct(10000 - cBp - mBp)} ≤ 0: цена не определена. Уменьшите комиссию или маржу`, severity: 'error' });
    } else if (costKop !== null && mBp >= 0 && cBp >= 0) {
      const denom = 10000 - cBp - mBp;
      basePriceKop = est.rounding === 'up_to_ruble'
        ? divCeil(divCeil(costKop * 10000, denom), 100) * 100
        : divRoundHalfUp(costKop * 10000, denom);
      formulaUsed = true;
      steps.push({ label: 'c — комиссия (доля цены P)', value: pct(cBp) });
      steps.push({ label: 'm — целевая маржа (доля цены P)', value: `${pct(mBp)}${est.targetMarginSource === 'owner_approved' ? '' : ' (демо, не утверждено владельцем)'}` });
      steps.push({ label: 'P = C / (1 − c − m)', value: `${fmt(costKop)} / ${pct(denom)} = ${fmt(basePriceKop)}` });
      steps.push({ label: 'Правило округления', value: est.rounding === 'up_to_ruble' ? 'вверх до целого рубля' : 'half-up до копейки' });
    }
  } else {
    if (est.manualPriceKop === null) issues.push({ lineId: null, field: 'manualPriceKop', message: 'Цена не задана', severity: 'incomplete' });
    else if (est.manualPriceKop < 0) issues.push({ lineId: null, field: 'manualPriceKop', message: 'Цена не может быть отрицательной', severity: 'error' });
    else {
      basePriceKop = est.manualPriceKop;
      steps.push({ label: 'Цена задана вручную', value: fmt(basePriceKop) });
    }
  }

  let priceKop: Kop | null = basePriceKop;
  if (basePriceKop !== null && est.discount) {
    if (est.discount.amountKop < 0) issues.push({ lineId: null, field: 'discount', message: 'Скидка не может быть отрицательной', severity: 'error' });
    else if (est.discount.amountKop > basePriceKop) issues.push({ lineId: null, field: 'discount', message: 'Скидка больше цены', severity: 'error' });
    else {
      priceKop = basePriceKop - est.discount.amountKop;
      steps.push({ label: `Скидка (${est.discount.reason})`, value: `−${fmt(est.discount.amountKop)} → P = ${fmt(priceKop)}` });
    }
  }

  let commissionKop: Kop | null = null;
  if (rule && rule.rateBp !== null && cBp === rule.rateBp) {
    if (commissionOnPrice && priceKop !== null) commissionKop = applyBp(priceKop, cBp);
    else if (!commissionOnPrice && rule.baseAmountKop !== null && rule.baseAmountKop >= 0) commissionKop = applyBp(rule.baseAmountKop, cBp);
  } else if (!rule && est.noCommissionConfirmed) commissionKop = 0;
  if (commissionKop !== null && rule)
    steps.push({ label: `Комиссия: ${pct(cBp)} от ${commissionOnPrice ? 'P (агентское вознаграждение)' : rule.baseDescription ?? 'другой базы'}`, value: fmt(commissionKop) });

  let remainderKop: Kop | null = null;
  let share: number | null = null;
  if (priceKop !== null && costKop !== null && commissionKop !== null) {
    remainderKop = priceKop - costKop - commissionKop;
    share = priceKop > 0 ? shareThousandthsOfPercent(remainderKop, priceKop) : null;
    steps.push({ label: 'Остаток = P − C − комиссия', value: `${fmt(priceKop)} − ${fmt(costKop)} − ${fmt(commissionKop)} = ${fmt(remainderKop)}` });
  }

  const externalKnown = est.externalBudgets.every((b) => b.amountKop !== null);
  const externalBudgetsKop = externalKnown ? est.externalBudgets.reduce((s, b) => s + (b.amountKop as number), 0) : null;
  if (est.externalBudgets.length)
    steps.push({ label: 'Внешние бюджеты (не входят в P, C и базу комиссии)', value: externalBudgetsKop === null ? 'есть незаполненные суммы' : fmt(externalBudgetsKop) });

  // share — тысячные доли процента (25,714 % → 25714), mBp — сотые доли процента (30 % → 3000)
  const belowTargetMargin = share !== null && mBp !== null && share < mBp * 10;
  const complete = !issues.some((i) => i.severity === 'error' || i.severity === 'incomplete') && priceKop !== null && remainderKop !== null;
  return {
    complete,
    issues,
    lineCosts,
    costKop,
    costMinKop,
    costMaxKop,
    basePriceKop,
    priceKop,
    commissionKop,
    remainderKop,
    remainderShareThousandths: share,
    belowTargetMargin,
    externalBudgetsKop,
    formulaUsed,
    steps,
  };
}
