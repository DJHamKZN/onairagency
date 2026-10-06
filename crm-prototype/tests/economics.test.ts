import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeEstimate } from '../src/domain/economics';
import { formatShare, rub } from '../src/domain/money';
import type { CommissionRule, CostLine, EstimateVersion } from '../src/domain/types';

const base = { id: 'x', createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', rev: 1, isDemo: true };
const line = (p: Partial<CostLine>): CostLine => ({
  id: Math.random().toString(36), kind: 'specialist', workItemId: null, label: 'Работа', performerUserId: null, hours: null, hoursMin: null,
  hoursMax: null, rateKop: null, amountKop: null, zeroReason: null, confidence: 'confirmed', ...p,
});
const rule = (p: Partial<CommissionRule> = {}): CommissionRule => ({
  ...base, label: 'Тестовая комиссия', rateBp: 1000, base: 'agency_fee', baseDescription: null, baseAmountKop: null, period: null, condition: null,
  recipientRole: 'Партнёр (демо)', ownerApproved: true, ...p,
});
/** C = 90 000: 30 ч × 2 500 + 5 ч × 2 000 + 2,5 ч × 2 000. */
const est = (p: Partial<EstimateVersion> = {}): EstimateVersion => ({
  ...base, number: 1, status: 'draft',
  lines: [
    line({ hours: 30, rateKop: rub(2500) }),
    line({ kind: 'pm', label: 'PM', hours: 5, rateKop: rub(2000) }),
    line({ kind: 'approvals', label: 'Согласования', hours: 2.5, rateKop: rub(2000) }),
  ],
  commissionRuleId: 'r', noCommissionConfirmed: false, targetMarginBp: 3000, targetMarginSource: 'demo_unapproved', rounding: 'up_to_ruble',
  taxModel: { status: 'set', description: 'демо' }, priceMode: 'formula', manualPriceKop: null, discount: null,
  externalBudgets: [{ id: 'b', label: 'Реклама', amountKop: rub(40000), period: 'месяц', paidBy: 'client_direct' }], ...p,
});

describe('Экономика (критерии 9–11)', () => {
  it('10: P = 90 000 / (1 − 0,10 − 0,30) = 150 000; комиссия 15 000; остаток 45 000 = 30 %; внешний бюджет вне P и базы', () => {
    const r = computeEstimate(est(), rule());
    assert.equal(r.complete, true, JSON.stringify(r.issues));
    assert.equal(r.costKop, rub(90000));
    assert.equal(r.priceKop, rub(150000));
    assert.equal(r.commissionKop, rub(15000));
    assert.equal(r.remainderKop, rub(45000));
    assert.equal(r.remainderShareThousandths, 30000);
    assert.equal(r.externalBudgetsKop, rub(40000));
    // внешний бюджет не участвует ни в P, ни в базе комиссии
    const r2 = computeEstimate(est({ externalBudgets: [] }), rule());
    assert.equal(r2.priceKop, r.priceKop);
    assert.equal(r2.commissionKop, r.commissionKop);
  });

  it('10: скидка до 140 000 → комиссия 14 000, остаток 36 000, доля ≈ 25,714 %, ниже целевой маржи', () => {
    const r = computeEstimate(est({ discount: { amountKop: rub(10000), reason: 'Тест' } }), rule());
    assert.equal(r.priceKop, rub(140000));
    assert.equal(r.commissionKop, rub(14000));
    assert.equal(r.remainderKop, rub(36000));
    assert.equal(r.remainderShareThousandths, 25714);
    assert.match(formatShare(r.remainderKop!, r.priceKop!), /25,714/);
    assert.equal(r.belowTargetMargin, true);
  });

  it('9: пустая ставка блокирует завершённый расчёт', () => {
    const e = est();
    e.lines[0].rateKop = null;
    const r = computeEstimate(e, rule());
    assert.equal(r.complete, false);
    assert.equal(r.costKop, null);
    assert.ok(r.issues.some((i) => /не указана ставка/.test(i.message)));
  });

  it('9: пустые часы блокируют расчёт; ноль без причины — неполный, подтверждённый ноль с причиной — допустим', () => {
    const e1 = est();
    e1.lines[0].hours = null;
    assert.equal(computeEstimate(e1, rule()).complete, false);
    const e2 = est();
    e2.lines[2].hours = 0;
    const r2 = computeEstimate(e2, rule());
    assert.equal(r2.complete, false);
    assert.ok(r2.issues.some((i) => /ноль допустим только/.test(i.message)));
    e2.lines[2].zeroReason = 'Согласования входят в часы PM (подтверждено владельцем)';
    const r3 = computeEstimate(e2, rule());
    assert.equal(r3.complete, true);
    assert.equal(r3.costKop, rub(85000));
  });

  it('Отсутствие строк PM и согласований делает расчёт неполным', () => {
    const r = computeEstimate(est({ lines: [line({ hours: 30, rateKop: rub(2500) })] }), rule());
    assert.equal(r.complete, false);
    assert.ok(r.issues.some((i) => /проджекта/.test(i.message)));
    assert.ok(r.issues.some((i) => /согласования/.test(i.message)));
  });

  it('Не заданная владельцем налоговая модель делает расчёт неполным (ставка не подставляется)', () => {
    const r = computeEstimate(est({ taxModel: { status: 'not_set', description: null } }), rule());
    assert.equal(r.complete, false);
    assert.ok(r.issues.some((i) => /налогов/.test(i.message)));
  });

  it('11: знаменатель ≤ 0 → понятная ошибка, цены нет', () => {
    const r = computeEstimate(est({ targetMarginBp: 9000 }), rule());
    assert.equal(r.priceKop, null);
    assert.ok(r.issues.some((i) => i.severity === 'error' && /Знаменатель/.test(i.message)));
    const r2 = computeEstimate(est({ targetMarginBp: 9000 }), rule({ rateBp: 1000 })); // ровно 0
    assert.ok(r2.issues.some((i) => /≤ 0/.test(i.message)));
  });

  it('11: отрицательные значения — ошибка', () => {
    const e = est();
    e.lines[0].rateKop = -100;
    assert.ok(computeEstimate(e, rule()).issues.some((i) => i.severity === 'error' && /отрицательн/.test(i.message)));
    assert.ok(computeEstimate(est({ targetMarginBp: -1 }), rule()).issues.some((i) => i.severity === 'error'));
    assert.ok(computeEstimate(est(), rule({ rateBp: -5 })).issues.some((i) => i.severity === 'error'));
    assert.ok(computeEstimate(est({ discount: { amountKop: -1, reason: 'x' } }), rule()).issues.some((i) => i.severity === 'error'));
  });

  it('11: несовместимая база комиссии запрещает формулу и требует ручной цены', () => {
    const r = computeEstimate(est(), rule({ base: 'other', baseDescription: 'Первый платёж клиента', baseAmountKop: rub(50000) }));
    assert.equal(r.priceKop, null);
    assert.ok(r.issues.some((i) => /формула .* неприменима/.test(i.message)));
    const manual = computeEstimate(est({ priceMode: 'manual', manualPriceKop: rub(160000) }), rule({ base: 'other', baseDescription: 'Первый платёж клиента', baseAmountKop: rub(50000) }));
    assert.equal(manual.commissionKop, rub(5000));
    assert.equal(manual.remainderKop, rub(160000 - 90000 - 5000));
  });

  it('Комиссия не применяется по умолчанию: без правила нужно явно подтвердить её отсутствие', () => {
    const r = computeEstimate(est({ commissionRuleId: null }), null);
    assert.equal(r.complete, false);
    const r2 = computeEstimate(est({ commissionRuleId: null, noCommissionConfirmed: true }), null);
    assert.equal(r2.complete, true);
    assert.equal(r2.priceKop, rub(128572)); // 90 000 / 0,7 = 128 571,43 → вверх до рубля
    assert.equal(r2.commissionKop, 0);
  });

  it('Диапазон оценки считается отдельно от точечной оценки', () => {
    const e = est();
    e.lines[0].hoursMin = 26;
    e.lines[0].hoursMax = 36;
    const r = computeEstimate(e, rule());
    assert.equal(r.costMinKop, rub(90000 - 4 * 2500));
    assert.equal(r.costMaxKop, rub(90000 + 6 * 2500));
  });
});
