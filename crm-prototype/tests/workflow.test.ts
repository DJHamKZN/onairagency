import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { approvalBlockers, createOpportunity } from '../src/domain/commands';
import { exportClientProposal, findForbiddenKeys } from '../src/domain/clientExport';
import { computeEstimate } from '../src/domain/economics';
import { handoffBlockers, packageBlockers } from '../src/domain/launch';
import { moveBlockers } from '../src/domain/stages';
import { rub } from '../src/domain/money';
import type { ApprovalCategory, Opportunity } from '../src/domain/types';
import { apply, ctx, expectThrows, seeded } from './helpers';

/** Кейс C до утверждения: противоречие дат решено. */
function caseCReady() {
  const s = seeded();
  const C = s.get(s.ids.C);
  const conflict = C.conflicts[0];
  s.run(s.ids.C, { type: 'resolveConflict', payload: { conflictId: conflict.id, choice: 'take_proposed', comment: 'Клиент подтвердил 05.12 письмом (демо)' } });
  return s;
}

function approveC() {
  const s = caseCReady();
  const p = s.get(s.ids.C).proposals[0];
  s.run(s.ids.C, { type: 'approveDeal', payload: { proposalId: p.id, comment: 'Утверждаю v1' } });
  return s;
}

describe('Создание и стадии (1, 5, 17)', () => {
  it('1: новый запрос создаётся без бюджета, брифа и аудита, но с ответственным и следующим шагом', () => {
    const { opp } = createOpportunity({
      title: 'Тестовая компания — запрос', companyId: 'co_1', originalRequest: 'Нужна помощь с рекламой', promisesNotRecorded: true, promises: [],
      ownerUserId: 'u_owner', presalePmUserId: 'u_pm', nextStep: { text: 'Созвон', assigneeUserId: 'u_pm', due: '2026-10-10' }, isDemo: true,
    }, ctx());
    assert.equal(opp.stage, 'new_request');
    assert.equal(opp.budget.status, 'not_discussed');
    assert.equal(opp.budget.minKop, null);
    assert.equal(opp.audit.type, null);
    assert.equal(opp.facts.length, 0);
  });

  it('1: без ответственного, следующего шага или отметки об обещаниях создать нельзя — с перечнем недостающего', () => {
    const r = expectThrows(() => createOpportunity({
      title: 'X', companyId: 'co_1', originalRequest: '', promisesNotRecorded: false, promises: [], ownerUserId: '', presalePmUserId: null,
      nextStep: { text: '', assigneeUserId: '', due: '' }, isDemo: true,
    }, ctx()), /не хватает/);
    for (const m of ['Исходный запрос', 'Обещания', 'Ответственный', 'Следующий шаг', 'Срок следующего шага']) assert.ok(r.missing.some((x) => x.includes(m)), m);
  });

  it('Переход в «Готовим предложение» объясняет недостающие условия', () => {
    const s = seeded();
    const A = s.get(s.ids.A);
    const b = moveBlockers(A, 'preparing_proposal');
    assert.ok(b.some((x) => /решение: данных достаточно/.test(x)));
    expectThrows(() => s.run(s.ids.A, { type: 'moveStage', payload: { target: 'preparing_proposal', reason: 'Хочу дальше' } }), /недоступен/);
  });

  it('5: кейс A доходит до КП без полного аудита и без трёх файлов', () => {
    const s = seeded();
    const id = s.ids.A;
    for (const pc of s.get(id).proposedChanges) s.run(id, { type: 'decideProposedChange', payload: { id: pc.id, accept: true } });
    s.run(id, { type: 'setReadiness', payload: { decision: 'enough_for_proposal', justification: 'Результат, материалы и согласующий понятны' } });
    s.run(id, { type: 'moveStage', payload: { target: 'preparing_proposal', reason: 'Достаточно данных' } });
    const A = s.get(id);
    assert.equal(A.stage, 'preparing_proposal');
    assert.equal(A.audit.fullMarketingAudit, false);
    assert.equal(A.audit.deliverables.length, 0);
    assert.equal(A.findings.length, 0);
  });

  it('Открытие вкладок не меняет стадию: стадия меняется только командой; отправка/принятие — только событием', () => {
    const s = seeded();
    const A = s.get(s.ids.A);
    assert.ok(moveBlockers(A, 'discussing_proposal')[0].includes('Зафиксировать отправку'));
    assert.ok(moveBlockers(A, 'preparing_launch')[0].includes('Зафиксировать принятие'));
  });

  it('17: пауза требует причины, следующего действующего и даты; возврат восстанавливает стадию', () => {
    const s = seeded();
    const id = s.ids.B;
    const r = expectThrows(() => s.run(id, { type: 'pause', payload: { reason: '', nextActor: '', returnDate: '' } }), /паузы/);
    assert.equal(r.missing.length, 3);
    s.run(id, { type: 'pause', payload: { reason: 'Клиент в отпуске', nextActor: 'Клиент: ЛПР', returnDate: '2026-10-20' } });
    assert.equal(s.get(id).stage, 'paused');
    expectThrows(() => s.run(id, { type: 'setRoute', payload: { type: 'A', rationale: 'x', depth: 'none', fullMarketingAudit: false } }), /на паузе/);
    s.run(id, { type: 'resume', payload: {} });
    assert.equal(s.get(id).stage, 'clarifying');
  });

  it('17: закрытие требует причины; открытые задачи снимаются без удаления истории', () => {
    const s = seeded();
    const id = s.ids.B;
    expectThrows(() => s.run(id, { type: 'close', payload: { reason: '', outcome: '' } }), /Причина закрытия/);
    const before = s.repo.events(id).length;
    const openTasks = s.get(id).tasks.filter((t) => t.status === 'open').length;
    assert.ok(openTasks > 0);
    s.run(id, { type: 'close', payload: { reason: 'Клиент выбрал другого подрядчика', outcome: 'Контакт сохранён, вернуться через полгода' } });
    const o = s.get(id);
    assert.equal(o.stage, 'closed_lost');
    assert.ok(o.tasks.every((t) => t.status !== 'open'));
    assert.ok(o.tasks.every((t) => t.status !== 'cancelled' || t.cancelledReason?.includes('Сделка закрыта')));
    assert.ok(s.repo.events(id).length > before);
    assert.ok(o.facts.length > 0, 'факты сохранены');
  });

  it('17: возврат с «Обсуждаем» на пересчёт сохраняет историю версий', () => {
    const s = approveC();
    const id = s.ids.C;
    const p = s.get(id).proposals[0];
    s.run(id, { type: 'recordSent', payload: { proposalId: p.id, versionNumber: 1, recipientLabel: 'Клиент: ЛПР (демо)', date: '2026-10-06', channelNote: 'демо' } });
    s.run(id, { type: 'createRevision', payload: { fromProposalId: p.id, reason: 'Клиент просит изменить объём' } });
    const o = s.get(id);
    assert.equal(o.stage, 'preparing_proposal');
    assert.equal(o.proposals.length, 2);
    assert.equal(o.proposals[0].status, 'sent');
    assert.ok(s.repo.events(id).some((e) => e.action === 'stage_returned'));
  });
});

describe('Утверждение экономики (12)', () => {
  it('Нельзя утвердить при нерешённом противоречии дат', () => {
    const s = seeded();
    const C = s.get(s.ids.C);
    assert.ok(approvalBlockers(C, C.proposals[0]).some((b) => /противоречие/.test(b)));
  });

  it('Утверждение привязано к снимку; цена 150 000 → скидка до 140 000 снимает утверждение с причиной', () => {
    const s = approveC();
    const id = s.ids.C;
    let o = s.get(id);
    assert.equal(o.approvals[0].status, 'active');
    assert.equal(o.proposals[0].status, 'approved_for_send');
    assert.equal(s.repo.snapshots().filter((x) => x.kind === 'approval').length, 1);
    s.run(id, { type: 'updateEstimate', payload: { estimateId: o.estimates[0].id, patch: { discount: { amountKop: rub(10000), reason: 'Пожелание клиента (тест)' } } } });
    o = s.get(id);
    const a = o.approvals[0];
    assert.equal(a.status, 'revoked');
    assert.ok(a.revoked!.categories.includes('price'));
    assert.ok(a.revoked!.categories.includes('discount'));
    assert.match(a.revoked!.reason, /150\s000.*140\s000/);
    assert.equal(o.proposals[0].status, 'draft');
    const r = computeEstimate(o.estimates[0], o.commissionRules[0]);
    assert.equal(r.remainderKop, rub(36000));
    assert.ok(s.repo.events(id).some((e) => e.action === 'revoked_automatically'));
  });

  const cases: [ApprovalCategory, (o: Opportunity) => Parameters<ReturnType<typeof seeded>['run']>[1]][] = [
    ['scope', (o) => ({ type: 'updateWorkItem', payload: { id: o.workItems[0].id, patch: { quantity: 2 } } })],
    ['price', (o) => ({ type: 'updateEstimate', payload: { estimateId: o.estimates[0].id, patch: { priceMode: 'manual', manualPriceKop: rub(155000) } } })],
    ['discount', (o) => ({ type: 'updateEstimate', payload: { estimateId: o.estimates[0].id, patch: { discount: { amountKop: rub(1), reason: 'тест' } } } })],
    ['commission', (o) => ({ type: 'upsertCommissionRule', payload: { ...o.commissionRules[0], rateBp: 500 } })],
    ['payment', (o) => ({ type: 'updateProposalContent', payload: { proposalId: o.proposals[0].id, patch: { payment: '50/50' } } })],
    ['timeline', (o) => ({ type: 'updateProposalContent', payload: { proposalId: o.proposals[0].id, patch: { timeline: 'До 5 декабря 2026' } } })],
    ['free_work', (o) => ({ type: 'updateProposalContent', payload: { proposalId: o.proposals[0].id, patch: { freeWork: 'Бесплатный аудит рекламы' } } })],
    ['dependencies', (o) => ({ type: 'updateProposalContent', payload: { proposalId: o.proposals[0].id, patch: { dependencies: 'Доступ к CRM клиента' } } })],
    ['costs', (o) => ({ type: 'upsertCostLine', payload: { estimateId: o.estimates[0].id, line: { ...o.estimates[0].lines[0], hours: 6 } } })],
    ['margin', (o) => ({ type: 'updateEstimate', payload: { estimateId: o.estimates[0].id, patch: { targetMarginBp: 3500 } } })],
    ['content', (o) => ({ type: 'updateProposalContent', payload: { proposalId: o.proposals[0].id, patch: { understanding: 'Новый текст' } } })],
  ];
  for (const [cat, mk] of cases)
    it(`12: изменение категории «${cat}» снимает утверждение и показывает причину`, () => {
      const s = approveC();
      s.run(s.ids.C, mk(s.get(s.ids.C)));
      const a = s.get(s.ids.C).approvals[0];
      assert.equal(a.status, 'revoked', cat);
      assert.ok(a.revoked!.categories.includes(cat), `${cat} ∉ ${a.revoked!.categories}`);
      assert.ok(a.revoked!.reason.length > 10);
    });

  it('PM не может утвердить экономику; ставки задаёт только владелец', () => {
    const s = caseCReady();
    const o = s.get(s.ids.C);
    // PM-доступ к C: назначим pm
    s.run(s.ids.C, { type: 'updateBasics', payload: { presalePmUserId: 'u_pm' } });
    expectThrows(() => s.run(s.ids.C, { type: 'approveDeal', payload: { proposalId: o.proposals[0].id, comment: null } }, 'pm', 'presale_pm'), /недоступно/);
    expectThrows(() => s.run(s.ids.C, { type: 'upsertCostLine', payload: { estimateId: o.estimates[0].id, line: { ...o.estimates[0].lines[0], rateKop: 1 } } }, 'pm', 'presale_pm'), /Ставки задаёт владелец/);
  });
});

describe('Версии КП (13, 14)', () => {
  it('13: генерация документа не фиксирует отправку; отправка требует точной версии', () => {
    const s = approveC();
    const id = s.ids.C;
    const p = s.get(id).proposals[0];
    exportClientProposal(s.get(id), s.repo.company(s.get(id).companyId)!, p); // «Сформировать КП»
    assert.equal(s.get(id).proposals[0].status, 'approved_for_send');
    expectThrows(() => s.run(id, { type: 'recordSent', payload: { proposalId: p.id, versionNumber: 2, recipientLabel: 'Клиент', date: '2026-10-06', channelNote: '' } }), /Подтвердите номер версии/);
    expectThrows(() => s.run(id, { type: 'recordSent', payload: { proposalId: p.id, versionNumber: 1, recipientLabel: '', date: '', channelNote: '' } }), /Получатель/);
    s.run(id, { type: 'recordSent', payload: { proposalId: p.id, versionNumber: 1, recipientLabel: 'Клиент: ЛПР (демо)', date: '2026-10-06', channelNote: 'демо' } });
    const o = s.get(id);
    assert.equal(o.proposals[0].status, 'sent');
    assert.equal(o.proposals[0].sent!.demo, true);
    assert.equal(o.stage, 'discussing_proposal');
    assert.notEqual(o.proposals[0].status, 'accepted');
    expectThrows(() => s.run(id, { type: 'recordAccepted', payload: { proposalId: p.id, versionNumber: 1, date: '2026-10-07', confirmationSource: '' } }), /Источник подтверждения/);
    s.run(id, { type: 'recordAccepted', payload: { proposalId: p.id, versionNumber: 1, date: '2026-10-07', confirmationSource: 'Демо-письмо 3' } });
    assert.equal(s.get(id).proposals[0].status, 'accepted');
    assert.equal(s.get(id).stage, 'preparing_launch');
  });

  it('13: неутверждённую версию отправить нельзя', () => {
    const s = caseCReady();
    const p = s.get(s.ids.C).proposals[0];
    expectThrows(() => s.run(s.ids.C, { type: 'recordSent', payload: { proposalId: p.id, versionNumber: 1, recipientLabel: 'К', date: '2026-10-06', channelNote: '' } }), /не утверждена/);
  });

  it('14: отправленная версия неизменяема; новая редакция ссылается на прежнюю; старое принятие недоступно', () => {
    const s = approveC();
    const id = s.ids.C;
    const p = s.get(id).proposals[0];
    s.run(id, { type: 'recordSent', payload: { proposalId: p.id, versionNumber: 1, recipientLabel: 'Клиент', date: '2026-10-06', channelNote: '' } });
    expectThrows(() => s.run(id, { type: 'updateProposalContent', payload: { proposalId: p.id, patch: { payment: 'Иначе' } } }), /неизменяема/);
    expectThrows(() => s.run(id, { type: 'upsertCostLine', payload: { estimateId: p.estimateVersionId, line: { ...s.get(id).estimates[0].lines[0], hours: 1 } } }), /зафиксирован/);
    s.run(id, { type: 'createRevision', payload: { fromProposalId: p.id, reason: 'Клиент просит скидку' } });
    const v2 = s.get(id).proposals[1];
    assert.equal(v2.previousVersionId, p.id);
    assert.equal(v2.number, 2);
    assert.notEqual(v2.estimateVersionId, p.estimateVersionId);
    s.run(id, { type: 'updateEstimate', payload: { estimateId: v2.estimateVersionId, patch: { discount: { amountKop: rub(10000), reason: 'Согласовано' } } } });
    assert.equal(s.get(id).proposals[0].status, 'sent', 'v1 не изменился');
    expectThrows(() => s.run(id, { type: 'recordAccepted', payload: { proposalId: p.id, versionNumber: 1, date: '2026-10-08', confirmationSource: 'Письмо' } }), /более новая версия 2/);
  });
});

describe('Клиентский экспорт (15)', () => {
  it('15: экспорт КП не содержит внутренних полей и значений, в том числе вложенных', () => {
    const s = approveC();
    const o = s.get(s.ids.C);
    o.commissionRules[0].label = 'SENTINEL_COMMISSION_LABEL';
    o.findings.push({ ...({} as never) });
    o.findings.pop();
    o.estimates[0].lines[0].label = 'SENTINEL_LINE_LABEL';
    o.tasks.push({ id: 't', createdAt: '', createdBy: 'u_owner', updatedAt: '', updatedBy: '', rev: 1, isDemo: true, title: 'SENTINEL_TASK', assigneeUserId: 'u_pm', role: null, due: null, status: 'open', blocker: false, kind: 'other', cancelledReason: null });
    const exp = exportClientProposal(o, s.repo.company(o.companyId)!, o.proposals[0]);
    const text = JSON.stringify(exp);
    assert.deepEqual(findForbiddenKeys(exp), []);
    for (const forbidden of ['SENTINEL', 'u_owner', 'u_pm', 'u_spec', '250000', '90 000', '2500', 'Партнёрская', 'Демо-заметка', 'snapshot', 'rateKop'])
      assert.ok(!text.includes(forbidden), `в экспорте найдено «${forbidden}»`);
    assert.equal(exp.agencyFeeKop, rub(150000));
    assert.equal(exp.externalBudgets[0].amountKop, rub(40000));
  });
});

describe('Запуск и передача (16)', () => {
  function launchReady() {
    const s = approveC();
    const id = s.ids.C;
    const p = s.get(id).proposals[0];
    s.run(id, { type: 'recordSent', payload: { proposalId: p.id, versionNumber: 1, recipientLabel: 'Клиент', date: '2026-10-06', channelNote: '' } });
    s.run(id, { type: 'recordAccepted', payload: { proposalId: p.id, versionNumber: 1, date: '2026-10-07', confirmationSource: 'Демо-письмо 3' } });
    return s;
  }

  it('16: запуск блокируется при пропуске условия; «неприменимо» требует причины', () => {
    const s = launchReady();
    const id = s.ids.C;
    const b = handoffBlockers(s.get(id));
    assert.ok(b.some((x) => /Договор/.test(x)));
    assert.ok(b.some((x) => /статус условий оплаты/.test(x)));
    assert.ok(b.some((x) => /Проверил, принимаю/.test(x)));
    assert.ok(b.some((x) => /не разрешил/.test(x)));
    expectThrows(() => s.run(id, { type: 'setChecklistItem', payload: { key: 'contract', status: 'not_applicable', note: null, naReason: '' } }), /нужна причина/);
    expectThrows(() => s.run(id, { type: 'handOff', payload: {} }), /нельзя/);
    expectThrows(() => s.run(id, { type: 'setChecklistItem', payload: { key: 'accesses', status: 'done', note: 'логин admin пароль: qwerty', naReason: null } }), /пароль или ключ/);
  });

  it('16: принимающий PM отдельно подтверждает пакет; изменение пакета требует повторной приёмки; затем владелец разрешает запуск', () => {
    const s = launchReady();
    const id = s.ids.C;
    for (const i of s.get(id).launch.items)
      s.run(id, { type: 'setChecklistItem', payload: i.key === 'findings'
        ? { key: i.key, status: 'not_applicable', note: null, naReason: 'Маршрут A: диагностика не проводилась' }
        : { key: i.key, status: 'done', note: 'Проверено (демо)', naReason: null } });
    s.run(id, { type: 'setPayment', payload: { status: 'paid_confirmed_manually', note: 'Отметка вручную, демо (не платёжная интеграция)' } });
    assert.deepEqual(packageBlockers(s.get(id)), []);
    s.run(id, { type: 'recordLinkShared', payload: {} });
    expectThrows(() => s.run(id, { type: 'handOff', payload: {} }), /Проверил, принимаю/); // ссылка ≠ передача
    expectThrows(() => s.run(id, { type: 'authorizeLaunch', payload: { comment: null } }), /приёмки/);
    expectThrows(() => s.run(id, { type: 'handoffDecision', payload: { decision: 'accepted', remarks: null } }, 'pm', 'presale_pm'), /недоступн/);
    s.run(id, { type: 'handoffDecision', payload: { decision: 'accepted', remarks: 'Пакет полный' } }, 'rpm', 'receiving_pm');
    s.run(id, { type: 'setChecklistItem', payload: { key: 'calendar', status: 'done', note: 'Календарь сдвинут на неделю', naReason: null } });
    assert.ok(handoffBlockers(s.get(id)).some((x) => /повторная приёмка/.test(x)));
    s.run(id, { type: 'handoffDecision', payload: { decision: 'accepted', remarks: 'Перепроверил' } }, 'rpm', 'receiving_pm');
    expectThrows(() => s.run(id, { type: 'authorizeLaunch', payload: { comment: null } }, 'pm', 'presale_pm'), /недоступ|не найдена/);
    s.run(id, { type: 'authorizeLaunch', payload: { comment: 'Запуск разрешаю' } });
    s.run(id, { type: 'handOff', payload: {} });
    assert.equal(s.get(id).stage, 'handed_off');
  });

  it('16: возврат пакета принимающим PM создаёт блокирующую задачу', () => {
    const s = launchReady();
    s.run(s.ids.C, { type: 'handoffDecision', payload: { decision: 'returned', remarks: 'Нет календаря первого этапа' } }, 'rpm', 'receiving_pm');
    const t = s.get(s.ids.C).tasks.find((x) => x.kind === 'handoff_fix')!;
    assert.equal(t.blocker, true);
    assert.ok(handoffBlockers(s.get(s.ids.C)).some((x) => /возвращён/.test(x)));
  });
});

describe('Чистота доменных функций', () => {
  it('applyCommand не изменяет исходный агрегат', () => {
    const s = seeded();
    const before = JSON.stringify(s.get(s.ids.A));
    const o = s.get(s.ids.A);
    apply(o, { type: 'setContinuation', payload: { method: 'Другой способ' } });
    assert.equal(JSON.stringify(o), before);
  });
});
