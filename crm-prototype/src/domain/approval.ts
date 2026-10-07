import { computeFor } from './economics';
import { hashOf } from './hash';
import type { ApprovalCategory, EstimateVersion, Opportunity, ProposalVersion, WorkItem } from './types';
import { formatKop } from './money';

/**
 * Снимок существенных условий версии КП. Утверждение владельца привязано к нему.
 * Утверждённая версия неизменяема: изменение условий делается в новой версии,
 * а различия с утверждённой показываются по категориям ниже.
 */
export interface MaterialSnapshot {
  scope: { id: string; title: string; quantity: number | null; unit: string | null; acceptance: string | null; recurrence: string; expectedResult: string | null }[];
  priceKop: number | null; // разовые работы
  monthlyPriceKop: number | null; // ежемесячные работы
  discount: { amountKop: number; reason: string; appliesTo?: string } | null;
  commission: { ruleId: string | null; rateBp: number | null; base: string | null; baseAmountKop: number | null; appliesTo: string | null; noCommissionConfirmed: boolean };
  payment: string | null;
  timeline: string | null;
  freeWork: string | null;
  dependencies: string | null;
  costs: { lines: { id: string; kind: string; hours: number | null; rateKop: number | null; amountKop: number | null; workItemId: string | null; confidence: string }[]; oneTimeKop: number | null; monthlyKop: number | null };
  margin: { targetMarginBp: number | null; priceMode: string; manualPriceKop: number | null; manualMonthlyPriceKop: number | null; rounding: string };
  /** Полный текст КП: утверждается точная версия. */
  content: unknown;
}

export function findEstimate(opp: Opportunity, id: string): EstimateVersion {
  const e = opp.estimates.find((x) => x.id === id);
  if (!e) throw new Error(`Расчёт ${id} не найден`);
  return e;
}

/** Работы версии: замороженные копии для утверждённых и отправленных версий, живые записи — для черновика. */
export function worksOf(opp: Opportunity, p: ProposalVersion): WorkItem[] {
  if (p.frozenWorks) return p.frozenWorks;
  return p.content.workItemIds.map((id) => opp.workItems.find((w) => w.id === id)).filter((w): w is WorkItem => !!w);
}

export function buildMaterialSnapshot(opp: Opportunity, p: ProposalVersion): MaterialSnapshot {
  const est = findEstimate(opp, p.estimateVersionId);
  const rule = est.status === 'locked' && est.frozenRule !== undefined ? est.frozenRule : est.commissionRuleId ? opp.commissionRules.find((r) => r.id === est.commissionRuleId) ?? null : null;
  const r = computeFor(opp, est);
  const works = worksOf(opp, p);
  return {
    scope: p.content.workItemIds.map((id) => {
      const w = works.find((x) => x.id === id);
      return { id, title: w?.title ?? '(удалена)', quantity: w?.quantity ?? null, unit: w?.unit ?? null, acceptance: w?.acceptanceCriterion ?? null, recurrence: w?.recurrence ?? 'one_time', expectedResult: w?.expectedResult ?? null };
    }),
    priceKop: r.oneTime.priceKop,
    monthlyPriceKop: r.monthly.present ? r.monthly.priceKop : null,
    discount: est.discount,
    commission: {
      ruleId: rule?.id ?? null, rateBp: rule?.rateBp ?? null, base: rule?.base ?? null, baseAmountKop: rule?.baseAmountKop ?? null,
      appliesTo: rule ? rule.appliesTo ?? 'one_time' : null, noCommissionConfirmed: est.noCommissionConfirmed,
    },
    payment: p.content.payment,
    timeline: p.content.timeline,
    freeWork: p.content.freeWork,
    dependencies: p.content.dependencies,
    costs: {
      lines: est.lines.map((l) => ({ id: l.id, kind: l.kind, hours: l.hours, rateKop: l.rateKop, amountKop: l.amountKop, workItemId: l.workItemId, confidence: l.confidence })),
      oneTimeKop: r.oneTime.costKop,
      monthlyKop: r.monthly.costKop,
    },
    margin: { targetMarginBp: est.targetMarginBp, priceMode: est.priceMode, manualPriceKop: est.manualPriceKop, manualMonthlyPriceKop: est.manualMonthlyPriceKop ?? null, rounding: est.rounding },
    content: p.content,
  };
}

export const snapshotHash = (s: MaterialSnapshot) => hashOf(s);

/** Категории и человекочитаемые различия между двумя снимками (например, утверждённой v1 и черновиком v2). */
export function diffMaterial(a: MaterialSnapshot, b: MaterialSnapshot): { categories: ApprovalCategory[]; details: string[] } {
  const cats: ApprovalCategory[] = [];
  const details: string[] = [];
  const same = (x: unknown, y: unknown) => hashOf(x) === hashOf(y);
  if (!same(a.scope, b.scope)) { cats.push('scope'); details.push('Изменён состав или объём работ'); }
  if (a.priceKop !== b.priceKop || (a.monthlyPriceKop ?? null) !== (b.monthlyPriceKop ?? null)) {
    cats.push('price');
    if (a.priceKop !== b.priceKop) details.push(`Цена разовых работ: ${formatKop(a.priceKop)} → ${formatKop(b.priceKop)}`);
    if ((a.monthlyPriceKop ?? null) !== (b.monthlyPriceKop ?? null)) details.push(`Цена ежемесячных работ: ${formatKop(a.monthlyPriceKop)} → ${formatKop(b.monthlyPriceKop)}`);
  }
  if (!same(a.discount, b.discount)) { cats.push('discount'); details.push(`Скидка: ${a.discount ? formatKop(a.discount.amountKop) : 'нет'} → ${b.discount ? formatKop(b.discount.amountKop) : 'нет'}`); }
  if (!same(a.commission, b.commission)) { cats.push('commission'); details.push('Изменены комиссия за привлечение или её база'); }
  if (a.payment !== b.payment) { cats.push('payment'); details.push('Изменены условия оплаты'); }
  if (a.timeline !== b.timeline) { cats.push('timeline'); details.push('Изменены сроки'); }
  if (a.freeWork !== b.freeWork) { cats.push('free_work'); details.push('Изменены бесплатные работы'); }
  if (a.dependencies !== b.dependencies) { cats.push('dependencies'); details.push('Изменены существенные зависимости'); }
  if (!same(a.costs, b.costs)) { cats.push('costs'); details.push(`Изменены затраты: ${formatKop(a.costs.oneTimeKop)} → ${formatKop(b.costs.oneTimeKop)}`); }
  if (!same(a.margin, b.margin)) { cats.push('margin'); details.push('Изменены целевая маржа, режим цены или округление'); }
  if (!cats.length && !same(a.content, b.content)) { cats.push('content'); details.push('Изменён текст КП'); }
  return { categories: cats, details };
}
