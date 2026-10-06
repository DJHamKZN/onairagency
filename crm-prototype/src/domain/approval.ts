import { computeEstimate } from './economics';
import { hashOf } from './hash';
import type { ApprovalCategory, EstimateVersion, Opportunity, ProposalVersion } from './types';
import { formatKop } from './money';

/**
 * Неизменяемый снимок существенных условий, к которому привязано утверждение владельца.
 * Изменение любой категории снимает утверждение.
 */
export interface MaterialSnapshot {
  scope: { id: string; title: string; quantity: number | null; unit: string | null; acceptance: string | null; recurrence: string; expectedResult: string | null }[];
  priceKop: number | null;
  discount: { amountKop: number; reason: string } | null;
  commission: { ruleId: string | null; rateBp: number | null; base: string | null; baseAmountKop: number | null; noCommissionConfirmed: boolean };
  payment: string | null;
  timeline: string | null;
  freeWork: string | null;
  dependencies: string | null;
  costs: { lines: { id: string; kind: string; hours: number | null; rateKop: number | null; amountKop: number | null; workItemId: string | null }[]; totalKop: number | null };
  margin: { targetMarginBp: number | null; priceMode: string; manualPriceKop: number | null; rounding: string };
  /** Полный текст КП: утверждается точная версия. */
  content: unknown;
}

export function findEstimate(opp: Opportunity, id: string): EstimateVersion {
  const e = opp.estimates.find((x) => x.id === id);
  if (!e) throw new Error(`Расчёт ${id} не найден`);
  return e;
}

export function buildMaterialSnapshot(opp: Opportunity, p: ProposalVersion): MaterialSnapshot {
  const est = findEstimate(opp, p.estimateVersionId);
  const rule = est.commissionRuleId ? opp.commissionRules.find((r) => r.id === est.commissionRuleId) ?? null : null;
  const r = computeEstimate(est, rule);
  return {
    scope: p.content.workItemIds.map((id) => {
      const w = opp.workItems.find((x) => x.id === id);
      return {
        id,
        title: w?.title ?? '(удалена)',
        quantity: w?.quantity ?? null,
        unit: w?.unit ?? null,
        acceptance: w?.acceptanceCriterion ?? null,
        recurrence: w?.recurrence ?? 'one_time',
        expectedResult: w?.expectedResult ?? null,
      };
    }),
    priceKop: r.priceKop,
    discount: est.discount,
    commission: {
      ruleId: rule?.id ?? null,
      rateBp: rule?.rateBp ?? null,
      base: rule?.base ?? null,
      baseAmountKop: rule?.baseAmountKop ?? null,
      noCommissionConfirmed: est.noCommissionConfirmed,
    },
    payment: p.content.payment,
    timeline: p.content.timeline,
    freeWork: p.content.freeWork,
    dependencies: p.content.dependencies,
    costs: {
      lines: est.lines.map((l) => ({ id: l.id, kind: l.kind, hours: l.hours, rateKop: l.rateKop, amountKop: l.amountKop, workItemId: l.workItemId })),
      totalKop: r.costKop,
    },
    margin: { targetMarginBp: est.targetMarginBp, priceMode: est.priceMode, manualPriceKop: est.manualPriceKop, rounding: est.rounding },
    content: p.content,
  };
}

export const snapshotHash = (s: MaterialSnapshot) => hashOf(s);

/** Категории и человекочитаемые причины различий между двумя снимками. */
export function diffMaterial(a: MaterialSnapshot, b: MaterialSnapshot): { categories: ApprovalCategory[]; details: string[] } {
  const cats: ApprovalCategory[] = [];
  const details: string[] = [];
  const same = (x: unknown, y: unknown) => hashOf(x) === hashOf(y);
  if (!same(a.scope, b.scope)) { cats.push('scope'); details.push('Изменён состав или объём работ'); }
  if (a.priceKop !== b.priceKop) { cats.push('price'); details.push(`Цена: ${formatKop(a.priceKop)} → ${formatKop(b.priceKop)}`); }
  if (!same(a.discount, b.discount)) { cats.push('discount'); details.push(`Скидка: ${a.discount ? formatKop(a.discount.amountKop) : 'нет'} → ${b.discount ? formatKop(b.discount.amountKop) : 'нет'}`); }
  if (!same(a.commission, b.commission)) { cats.push('commission'); details.push('Изменены комиссия или её база'); }
  if (a.payment !== b.payment) { cats.push('payment'); details.push('Изменены условия оплаты'); }
  if (a.timeline !== b.timeline) { cats.push('timeline'); details.push('Изменены сроки'); }
  if (a.freeWork !== b.freeWork) { cats.push('free_work'); details.push('Изменены бесплатные работы'); }
  if (a.dependencies !== b.dependencies) { cats.push('dependencies'); details.push('Изменены существенные зависимости'); }
  if (!same(a.costs, b.costs)) { cats.push('costs'); details.push(`Изменены затраты: ${formatKop(a.costs.totalKop)} → ${formatKop(b.costs.totalKop)}`); }
  if (!same(a.margin, b.margin)) { cats.push('margin'); details.push('Изменены целевая маржа, режим цены или округление'); }
  if (!cats.length && !same(a.content, b.content)) { cats.push('content'); details.push('Изменён текст КП после утверждения'); }
  return { categories: cats, details };
}
