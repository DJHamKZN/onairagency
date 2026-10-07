import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeEstimate } from '../src/domain/economics';
import { formatShare, rub } from '../src/domain/money';
import type { CommissionRule, CostLine, EstimateVersion } from '../src/domain/types';

const base = { id: 'x', createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', rev: 1, isDemo: true };
const line = (p: Partial<CostLine>): CostLine => ({
  id: Math.random().toString(36), kind: 'specialist', workItemId: null, label: 'Работа', performerUserId: null, hours: null, hoursMin: null,
  hoursMax: null, rateKop: null, amountKop: null, zeroReason: null, confidence: 'confirmed', recurrence: 'one_time', ...p,
});
const rule = (p: Partial<CommissionRule> = {}): CommissionRule => ({
  ...base, label: 'Комиссия за привлечение (тест)', rateBp: 1000, base: 'agency_fee', baseDescription: null, baseAmountKop: null, period: null, condition: null,
  recipientRole: 'Партнёр (демо)', ownerApproved: true, appliesTo: 'one_time', ...p,
});
/** C = 90 000: 30 ч × 2 500 + 5 ч × 2 000 + 2,5 ч × 2 000; все оценки проверены. */
const est = (p: Partial<EstimateVersion> = {}): EstimateVersion => ({
  ...base, number: 1, status: 'draft',
  lines: [
    line({ hours: 30, rateKop: rub(2500) }),
    line({ kind: 'pm', label: 'PM', hours: 5, rateKop: rub(2000) }),
    line({ kind: 'approvals', label: 'Согласования', hours: 2.5, rateKop: rub(2000) }),
  ],
  commissionRuleId: 'r', noCommissionConfirmed: false, targetMarginBp: 3000, targetMarginSource: 'demo_unapproved', rounding: 'up_to_ruble',
  taxModel: { status: 'set', description: 'демо' }, priceMode: 'formula', manualPriceKop: null, discount: null,
  externalBudgets: [{ id: 'b', label: 'Рекламный бюджет', amountKop: rub(40000), period: 'месяц', paidBy: 'client_direct' }], ...p,
});

describe('Экономика: статусы, термины, разовые и ежемесячные работы', () => {
  it('10: P = 90 000 / (1 − 0,10 − 0,30) = 150 000; комиссия за привлечение 15 000 — выплата из выручки; остаток 45 000 = 30 %; рекламный бюджет вне P и базы', () => {
    const r = computeEstimate(est(), rule());
    assert.equal(r.filled, true, JSON.stringify(r.issues));
    assert.equal(r.verified, true);
    const o = r.oneTime;
    assert.equal(o.costKop, rub(90000));
    assert.equal(o.priceKop, rub(150000));
    assert.equal(o.commissionKop, rub(15000));
    assert.equal(o.remainderKop, rub(45000));
    assert.equal(o.remainderShareThousandths, 30000);
    assert.equal(r.externalBudgetsKop, rub(40000));
    const r2 = computeEstimate(est({ externalBudgets: [] }), rule());
    assert.equal(r2.oneTime.priceKop, o.priceKop);
    assert.equal(r2.oneTime.commissionKop, o.commissionKop);
    const text = o.steps.map((s) => `${s.label} ${s.value}`).join('\n');
    assert.match(text, /цена услуг \(выручка агентства\)/i);
    assert.match(text, /Комиссия за привлечение.*выплата из выручки агентства/);
    assert.doesNotMatch(text, /агентское вознаграждение/i);
  });

  it('10: скидка до 140 000 → комиссия 14 000, остаток 36 000, доля ≈ 25,714 %, ниже целевой маржи', () => {
    const o = computeEstimate(est({ discount: { amountKop: rub(10000), reason: 'Тест' } }), rule()).oneTime;
    assert.equal(o.priceKop, rub(140000));
    assert.equal(o.commissionKop, rub(14000));
    assert.equal(o.remainderKop, rub(36000));
    assert.equal(o.remainderShareThousandths, 25714);
    assert.match(formatShare(o.remainderKop!, o.priceKop!), /25,714/);
    assert.equal(o.belowTargetMargin, true);
  });

  it('1: предварительные оценки — данные заполнены, но не проверены; суммы проверенных и непроверенных показаны отдельно', () => {
    const e = est();
    e.lines[1].confidence = 'preliminary';
    e.lines[0].confidence = 'specialist_estimate';
    const r = computeEstimate(e, rule());
    assert.equal(r.filled, true);
    assert.equal(r.verified, false);
    assert.equal(r.oneTime.verifiedCostKop, rub(5000));
    assert.equal(r.oneTime.unverifiedCostKop, rub(85000));
    assert.equal(r.oneTime.unverifiedLines, 2);
    assert.ok(r.issues.filter((i) => i.severity === 'unverified').length === 2);
    assert.ok(r.oneTime.steps.some((s) => /включая непроверенные/.test(s.label)), 'итог не называется «подтверждёнными затратами»');
  });

  it('1, 9: пустое значение не считается нулём — сумма затрат не считается, расчёт не заполнен', () => {
    const e = est();
    e.lines[0].rateKop = null;
    const r = computeEstimate(e, rule());
    assert.equal(r.filled, false);
    assert.equal(r.oneTime.costKop, null);
    assert.equal(r.oneTime.unknownLines, 1);
    assert.equal(r.oneTime.priceKop, null);
    assert.equal(r.oneTime.verifiedCostKop, rub(15000), 'известные строки показаны, но итог не выдаётся');
    assert.ok(r.issues.some((i) => /значение неизвестно/.test(i.message)));
  });

  it('9: ноль без причины — неполные данные; подтверждённый ноль с причиной — допустим', () => {
    const e2 = est();
    e2.lines[2].hours = 0;
    assert.equal(computeEstimate(e2, rule()).filled, false);
    e2.lines[2].zeroReason = 'Согласования входят в часы PM (подтверждено владельцем)';
    const r3 = computeEstimate(e2, rule());
    assert.equal(r3.filled, true);
    assert.equal(r3.oneTime.costKop, rub(85000));
  });

  it('Разовые и ежемесячные работы считаются раздельно; комиссия применяется только к своей части', () => {
    const e = est();
    e.lines.push(line({ label: 'Ведение (в месяц)', hours: 10, rateKop: rub(2500), recurrence: 'monthly' }));
    const r = computeEstimate(e, rule({ appliesTo: 'one_time' }));
    assert.equal(r.oneTime.priceKop, rub(150000), 'разовая часть не изменилась');
    assert.equal(r.monthly.present, true);
    assert.equal(r.monthly.costKop, rub(25000));
    assert.equal(r.monthly.priceKop, rub(35715)); // 25 000 / 0,7 = 35 714,29 → вверх до рубля
    assert.equal(r.monthly.commissionKop, 0);
    const both = computeEstimate(e, rule({ appliesTo: 'both' }));
    assert.equal(both.monthly.priceKop, rub(41667)); // 25 000 / 0,6
    assert.equal(both.monthly.commissionKop, rub(4166.7));
    // строка, привязанная к ежемесячной работе, наследует периодичность работы
    const e3 = est();
    e3.lines.push(line({ label: 'Привязанная', hours: 4, rateKop: rub(2500), workItemId: 'w_m', recurrence: undefined }));
    const r3 = computeEstimate(e3, rule(), (id) => (id === 'w_m' ? 'monthly' : undefined));
    assert.equal(r3.monthly.costKop, rub(10000));
    assert.equal(r3.oneTime.costKop, rub(90000));
  });

  it('Нет строк PM и согласований; не задана налоговая модель — данные неполные', () => {
    const r = computeEstimate(est({ lines: [line({ hours: 30, rateKop: rub(2500) })] }), rule());
    assert.equal(r.filled, false);
    assert.ok(r.issues.some((i) => /проджекта/.test(i.message)));
    assert.ok(r.issues.some((i) => /согласования/.test(i.message)));
    assert.ok(computeEstimate(est({ taxModel: { status: 'not_set', description: null } }), rule()).issues.some((i) => /налогов/.test(i.message)));
  });

  it('11: знаменатель ≤ 0, отрицательные значения, несовместимая база комиссии — понятные ошибки', () => {
    const r = computeEstimate(est({ targetMarginBp: 9000 }), rule());
    assert.equal(r.oneTime.priceKop, null);
    assert.ok(r.issues.some((i) => i.severity === 'error' && /Знаменатель.*≤ 0/.test(i.message)));
    const e = est();
    e.lines[0].rateKop = -100;
    assert.ok(computeEstimate(e, rule()).issues.some((i) => i.severity === 'error' && /отрицательн/.test(i.message)));
    assert.ok(computeEstimate(est({ targetMarginBp: -1 }), rule()).issues.some((i) => i.severity === 'error'));
    assert.ok(computeEstimate(est(), rule({ rateBp: -5 })).issues.some((i) => i.severity === 'error'));
    assert.ok(computeEstimate(est({ discount: { amountKop: -1, reason: 'x' } }), rule()).issues.some((i) => i.severity === 'error'));
    const other = rule({ base: 'other', baseDescription: 'Первый платёж клиента', baseAmountKop: rub(50000) });
    assert.ok(computeEstimate(est(), other).issues.some((i) => /формула .* неприменима/.test(i.message)));
    const manual = computeEstimate(est({ priceMode: 'manual', manualPriceKop: rub(160000) }), other).oneTime;
    assert.equal(manual.commissionKop, rub(5000));
    assert.equal(manual.remainderKop, rub(160000 - 90000 - 5000));
  });

  it('Комиссия не применяется по умолчанию: без правила нужно подтвердить её отсутствие', () => {
    assert.equal(computeEstimate(est({ commissionRuleId: null }), null).filled, false);
    const r2 = computeEstimate(est({ commissionRuleId: null, noCommissionConfirmed: true }), null);
    assert.equal(r2.filled, true);
    assert.equal(r2.oneTime.priceKop, rub(128572));
    assert.equal(r2.oneTime.commissionKop, 0);
  });

  it('Утверждённый (зафиксированный) расчёт использует замороженное правило комиссии', () => {
    const r = computeEstimate(est({ status: 'locked', frozenRule: rule({ rateBp: 1000 }) }), rule({ rateBp: 500 }));
    assert.equal(r.oneTime.commissionKop, rub(15000));
  });

  it('Диапазон оценки считается отдельно от точечной оценки', () => {
    const e = est();
    e.lines[0].hoursMin = 26;
    e.lines[0].hoursMax = 36;
    const r = computeEstimate(e, rule());
    assert.equal(r.oneTime.costMinKop, rub(90000 - 4 * 2500));
    assert.equal(r.oneTime.costMaxKop, rub(90000 + 6 * 2500));
  });
});
