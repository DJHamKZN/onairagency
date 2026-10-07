import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientExportReadiness, supportBlockers } from '../src/domain/audit';
import { exportClientAudit, findForbiddenKeys } from '../src/domain/clientExport';
import { demoParse } from '../src/domain/demoParser';
import { isBudgetMention, isMetric } from '../src/domain/labels';
import { DEMO_SOURCES } from '../server/seed';
import { expectThrows, seeded } from './helpers';

describe('Источники, факты, противоречия (2, 3, 4, 25)', () => {
  it('2: вставка заметки создаёт предлагаемые изменения, а не факты', () => {
    const s = seeded();
    const A = s.get(s.ids.A);
    assert.equal(A.facts.length, 0);
    assert.ok(A.proposedChanges.length >= 4);
    assert.ok(A.proposedChanges.every((p) => p.status === 'pending'));
    assert.equal(A.sources[0].original.stored, false, 'оригинал файла не хранится — только текст');
  });

  it('2: подтверждённое значение не перезаписывается новым источником без решения человека', () => {
    const s = seeded();
    const id = s.ids.C;
    const C0 = s.get(id);
    const goal = C0.facts.find((f) => f.key === 'business_goal')!;
    s.run(id, { type: 'setFactStatus', payload: { factId: goal.id, status: 'confirmed', reason: 'Подтверждено на созвоне (демо)' } });
    s.run(id, { type: 'addSource', payload: { kind: 'note', title: 'Демо-заметка 3', declaredCompany: 'Контур Образец', receivedAt: '2026-10-01', text: 'Цель бизнеса: Выйти на новый регион', link: null, originalFilename: null, replacesSourceId: null } });
    const src = s.get(id).sources.at(-1)!;
    s.run(id, { type: 'parseSource', payload: { sourceId: src.id } });
    const pc = s.get(id).proposedChanges.find((p) => p.sourceId === src.id)!;
    s.run(id, { type: 'decideProposedChange', payload: { id: pc.id, accept: true } });
    const C = s.get(id);
    const f = C.facts.find((x) => x.key === 'business_goal')!;
    assert.equal(f.value, 'Запустить новое направление до конца года.');
    assert.equal(f.status, 'confirmed');
    assert.ok(C.conflicts.some((c) => c.factId === f.id && c.status === 'open'));
  });

  it('3: противоречие дат видно с двумя источниками; последняя дата не выбирается автоматически; решение и автор — в истории', () => {
    const s = seeded();
    const id = s.ids.C;
    const C = s.get(id);
    const c = C.conflicts[0];
    assert.equal(c.key, 'deadline');
    assert.equal(c.existingValue, '2026-11-20');
    assert.equal(c.proposedValue, '2026-12-05');
    assert.equal(C.sources.find((x) => x.id === c.existingSourceId)!.title, 'Демо-заметка 1');
    assert.equal(C.sources.find((x) => x.id === c.proposedSourceId)!.title, 'Демо-письмо 2');
    assert.equal(C.facts.find((f) => f.key === 'deadline')!.value, '2026-11-20', 'дата из более позднего письма не применена молча');
    expectThrows(() => s.run(id, { type: 'resolveConflict', payload: { conflictId: c.id, choice: 'take_proposed', comment: '' } }), /Комментарий/);
    s.run(id, { type: 'resolveConflict', payload: { conflictId: c.id, choice: 'needs_clarification', comment: 'Уточнить у ЛПР' } }, 'lead', 'lead_specialist');
    const after = s.get(id);
    const f = after.facts.find((x) => x.key === 'deadline')!;
    assert.equal(f.status, 'needs_clarification');
    assert.equal(after.conflicts[0].resolution!.by, 'u_lead');
    assert.equal(after.conflicts[0].resolution!.actingRole, 'lead_specialist');
    assert.ok(f.history.some((h) => h.action === 'conflict_needs_clarification' && h.by === 'u_lead'));
    assert.ok(after.clarifications.some((q) => /2026-11-20.*2026-12-05/.test(q.question)));
    assert.ok(s.repo.events(id).some((e) => e.entityType === 'Conflict' && e.action === 'resolved' && e.userId === 'u_lead'));
  });

  it('4: пожелание скидки не становится обещанием агентства', () => {
    const s = seeded();
    const id = s.ids.C;
    const wish = s.get(id).proposedChanges.find((p) => p.kind === 'client_wish')!;
    assert.match(wish.note, /не согласованная скидка/);
    const before = s.get(id).promises.length;
    s.run(id, { type: 'decideProposedChange', payload: { id: wish.id, accept: true } });
    const C = s.get(id);
    assert.equal(C.promises.length, before);
    assert.ok(C.facts.some((f) => f.key === 'client_wish'));
    assert.equal(C.estimates[0].discount, null, 'скидка в расчёт не попала');
  });

  it('4: кандидат в обещания принимается только со статусом «обсуждалось»; условное нельзя подтвердить', () => {
    const s = seeded();
    const id = s.ids.A;
    s.run(id, { type: 'addSource', payload: { kind: 'note', title: 'Демо-заметка 2', declaredCompany: 'Линия Плюс', receivedAt: '2026-10-02', text: 'Мы пообещали сделать первый макет за 3 дня.', link: null, originalFilename: null, replacesSourceId: null } });
    const src = s.get(id).sources.at(-1)!;
    s.run(id, { type: 'parseSource', payload: { sourceId: src.id } });
    const pc = s.get(id).proposedChanges.find((p) => p.sourceId === src.id && p.kind === 'promise_candidate')!;
    s.run(id, { type: 'decideProposedChange', payload: { id: pc.id, accept: true } });
    const pr = s.get(id).promises.at(-1)!;
    assert.equal(pr.status, 'discussed');
    s.run(id, { type: 'addPromise', payload: { what: 'Если получится, запустим к пятнице', category: 'deadline', byRole: 'Проджект', sourceId: null, conditional: true } });
    const cond = s.get(id).promises.at(-1)!;
    expectThrows(() => s.run(id, { type: 'setPromiseStatus', payload: { id: cond.id, status: 'confirmed', reason: 'x' } }), /Условное/);
  });

  it('25: источник другого клиента попадает на карантин и не разбирается без решения', () => {
    const s = seeded();
    const id = s.ids.A;
    s.run(id, { type: 'addSource', payload: { kind: 'note', title: 'Чужая заметка', declaredCompany: 'Маяк Сервис', receivedAt: '2026-10-02', text: 'Запрос: Нужна реклама', link: null, originalFilename: null, replacesSourceId: null } });
    const src = s.get(id).sources.at(-1)!;
    assert.equal(src.status, 'quarantined');
    assert.match(src.quarantineReason!, /Маяк Сервис/);
    expectThrows(() => s.run(id, { type: 'parseSource', payload: { sourceId: src.id } }), /карантин/);
    s.run(id, { type: 'decideSourceAttribution', payload: { sourceId: src.id, accept: false, comment: 'Источник другого клиента' } });
    assert.equal(s.get(id).sources.at(-1)!.status, 'rejected');
    assert.equal(s.get(id).facts.length, 0, 'карточки не смешались');
  });

  it('25: устаревшая версия источника требует решения; изменение источника помечает зависимые выводы, не удаляя историю', () => {
    const s = seeded();
    const id = s.ids.B;
    const src = s.get(id).sources[0];
    s.run(id, { type: 'addSource', payload: { kind: 'transcript', title: 'Демо-заметка 1 (старая выгрузка)', declaredCompany: 'Маяк Сервис', receivedAt: '2026-09-01', text: 'Запрос: старое', link: null, originalFilename: null, replacesSourceId: src.id } });
    const old = s.get(id).sources.at(-1)!;
    assert.equal(old.status, 'quarantined');
    assert.match(old.quarantineReason!, /устаревшая/);
    assert.equal(s.get(id).sources[0].status, 'active');
    // правка текста источника → новая версия; находка и факт требуют повторной проверки
    const finding = s.get(id).findings[0];
    const fact = s.get(id).facts.find((f) => f.sourceId === src.id)!;
    s.run(id, { type: 'updateSourceText', payload: { sourceId: src.id, text: src.text + '\n[00:09:00] Форма иногда не открывается.', reason: 'Дополнена расшифровка' } });
    const B = s.get(id);
    assert.equal(B.sources.find((x) => x.id === src.id)!.status, 'superseded');
    assert.equal(B.findings.find((f) => f.id === finding.id)!.verification, 'needs_recheck');
    assert.equal(B.facts.find((f) => f.id === fact.id)!.needsRecheck, true);
    assert.equal(B.findings.find((f) => f.id === finding.id)!.code, finding.code, 'код находки не меняется');
    assert.ok(B.facts.find((f) => f.id === fact.id)!.history.length >= 2, 'история сохранена');
  });
});

describe('«Площадка Пример» (26, 27)', () => {
  it('26: 27 регистраций, 0 оплат и цель 15 подписок — три разных значения; цель не факт продаж', () => {
    const s = seeded();
    const D = s.get(s.ids.D);
    const metrics = D.facts.filter((f) => f.key === 'metric').map((f) => f.value).filter(isMetric);
    assert.equal(metrics.length, 3);
    assert.deepEqual(metrics.map((m) => [m.entity, m.value, m.kind]), [['регистрации', 27, 'actual'], ['оплаты', 0, 'actual'], ['подписки', 15, 'goal']]);
    assert.ok(metrics.every((m) => m.period === null), 'период неизвестен — не выдуман');
  });

  it('26: неизвестный бюджет ≠ подтверждённый ноль; бюджеты с разными периодами не складываются', () => {
    const s = seeded();
    const D = s.get(s.ids.D);
    assert.equal(D.budget.status, 'not_discussed');
    assert.equal(D.budget.minKop, null);
    const budgets = D.facts.filter((f) => f.key === 'budget_mention').map((f) => f.value).filter(isBudgetMention);
    assert.deepEqual(budgets.map((b) => [b.amountKop, b.period]), [[1200000, 'в месяц'], [4500000, 'на первый тест']]);
    assert.ok(D.facts.filter((f) => f.key === 'budget_mention').every((f) => f.status === 'needs_clarification'));
    assert.ok(!D.facts.some((f) => isBudgetMention(f.value) && f.value.amountKop === 5700000), 'суммы не сложены');
    expectThrows(() => s.run(s.ids.D, { type: 'updateBasics', payload: { budget: { status: 'confirmed', minKop: null, maxKop: null, period: null, note: null } } }), /ноль — тоже явное значение/);
  });

  it('27: плейсхолдер и условное высказывание не становятся фактами или обязательствами; незнание аналитики → вопрос владельцу данных', () => {
    const s = seeded();
    const D = s.get(s.ids.D);
    assert.equal(D.promises.length, 0);
    assert.ok(!D.facts.some((f) => typeof f.value === 'string' && /уточнить|пятниц/.test(f.value)));
    assert.ok(D.clarifications.some((c) => /\[уточнить количество\]/.test(c.question)));
    assert.ok(D.clarifications.some((c) => /Условное высказывание/.test(c.question)));
    const analytics = D.clarifications.find((c) => /аналитик/.test(c.question))!;
    assert.match(analytics.addressedToRole, /Владелец данных/);
    assert.ok(!D.facts.some((f) => isMetric(f.value) && /конверси/.test(f.value.entity)), 'метрика не выдумана');
  });

  it('Демо-разбор детерминирован и помечает таймкоды', () => {
    const a = demoParse(DEMO_SOURCES.D1);
    const b = demoParse(DEMO_SOURCES.D1);
    assert.deepEqual(a, b);
    assert.equal(a[0].timecode, '00:02:05');
  });
});

describe('Диагностика и доказательства (6, 7, 24, 28)', () => {
  it('6: кейс B — платная диагностика отдельной возможностью; внедрение остаётся открытым', () => {
    const s = seeded();
    const B = s.get(s.ids.B);
    const link = B.related.find((r) => r.relation === 'paid_diagnostic')!;
    const diag = s.get(link.opportunityId);
    assert.equal(diag.audit.type, 'C');
    assert.deepEqual(diag.related, [{ opportunityId: B.id, relation: 'implementation' }]);
    assert.equal(B.stage, 'clarifying');
    assert.ok(B.tasks.some((t) => /Внедрение остаётся открытым/.test(t.title)));
    // передача диагностики в работу не меняет внедрение
    assert.notEqual(B.stage, 'closed_lost');
    assert.notEqual(B.stage, 'handed_off');
  });

  it('7: полный аудит хранит три результата, ограничения и статусы непроверенных направлений', () => {
    const s = seeded();
    const id = s.ids.B;
    s.run(id, { type: 'setRoute', payload: { type: 'C', rationale: 'Полный аудит по согласованию', depth: 'external_evidence', fullMarketingAudit: true } });
    const B = s.get(id);
    assert.deepEqual(B.audit.deliverables.map((d) => d.kind), ['client_brief_pdf', 'client_detailed_docx', 'internal_docx']);
    const exp = exportClientAudit(B, s.repo.company(B.companyId)!, 'detailed');
    assert.ok(exp.modules.some((m) => m.status === 'Не выполнено'));
    assert.ok(exp.modules.some((m) => m.status === 'Нужен конкретный доступ' && m.accessNeeded));
    assert.ok(exp.modules.some((m) => m.status === 'Частично'));
    assert.ok(exp.limitations.some((l) => /Спрос: Не выполнено/.test(l)), 'невыполненный спрос остаётся пробелом');
    assert.deepEqual(findForbiddenKeys(exp), []);
    expectThrows(() => s.run(id, { type: 'setModule', payload: { key: 'demand', status: 'needs_access', reason: 'нет', accessNeeded: null, accessOwnerRole: null, blockedDecision: null, deepDive: false } }), /доступ/);
  });

  it('24: цитата существует, но не подтверждает вывод — находка не принимается и не экспортируется', () => {
    const s = seeded();
    const id = s.ids.B;
    s.run(id, { type: 'addFinding', payload: { title: 'Форма теряет заявки', module: 'site_path', claimType: 'interpretation', dataBasis: 'client_words', observation: 'Часть заявок с формы не доходит до отдела продаж', sourceId: s.get(id).sources[0].id, evidenceQuote: 'На сайте есть форма заявки.', limitation: 'Нет данных о доставке' } }, 'lead', 'lead_specialist');
    const f = s.get(id).findings.at(-1)!;
    assert.equal(clientExportReadiness(s.get(id), f).ready, false, 'наличие цитаты и ссылки само по себе не делает вывод доказанным');
    s.run(id, { type: 'reviewEvidence', payload: { findingId: f.id, supportsClaim: false, comment: 'Цитата говорит только о наличии формы, не о потере заявок' } }, 'lead', 'lead_specialist');
    const after = s.get(id).findings.at(-1)!;
    assert.equal(after.verification, 'not_supported');
    const r = clientExportReadiness(s.get(id), after);
    assert.equal(r.ready, false);
    assert.match(r.reason, /не подтверждает/);
    assert.ok(!exportClientAudit(s.get(id), s.repo.company(s.get(id).companyId)!, 'detailed').findings.some((x) => x.code === after.code));
  });

  it('24: URL вместо цитаты не является доказательством; внешние данные не доказывают CAC/конверсию продаж', () => {
    const s = seeded();
    const id = s.ids.B;
    s.run(id, { type: 'addFinding', payload: { title: 'Есть форма', module: 'site_path', observation: 'Форма есть', sourceId: s.get(id).sources[0].id, evidenceQuote: 'https://example.invalid/page' } }, 'lead', 'lead_specialist');
    const f = s.get(id).findings.at(-1)!;
    assert.ok(supportBlockers(s.get(id), f).some((x) => /URL не является доказательством/.test(x)));
    expectThrows(() => s.run(id, { type: 'reviewEvidence', payload: { findingId: f.id, supportsClaim: true, comment: 'ок' } }, 'lead', 'lead_specialist'), /URL/);
    expectThrows(() => s.run(id, { type: 'addFinding', payload: { title: 'Низкая конверсия продаж', module: 'sales_crm', claimType: 'observation', dataBasis: 'external_public', observation: 'Конверсия в продажи около 2 %' } }, 'lead', 'lead_specialist'), /нельзя утверждать/);
  });

  it('28: «доставлено», «обработано», «квалифицировано» проверяются раздельно', () => {
    const s = seeded();
    const id = s.ids.B;
    s.run(id, { type: 'setLeadPath', payload: { level: 'delivery', status: 'confirmed_by_client_data', note: 'Клиент показал тестовую заявку в почте (демо)' } }, 'lead', 'lead_specialist');
    const lp = s.get(id).audit.leadPath;
    assert.equal(lp.delivery.status, 'confirmed_by_client_data');
    assert.equal(lp.processing.status, 'not_checked');
    assert.equal(lp.qualification.status, 'not_checked');
    assert.equal(lp.submit.status, 'not_checked', 'отправка не выведена из получения');
    expectThrows(() => s.run(id, { type: 'setLeadPath', payload: { level: 'processing', status: 'confirmed_by_client_data', note: '' } }, 'lead', 'lead_specialist'), /какими данными/);
  });
});

describe('Основной сценарий: письмо → предложения с цитатами → обещания → вопросы (5)', () => {
  const LETTER = `Добрый день! Нужен лендинг для акции.
Цель бизнеса: Собрать заявки на акцию до конца месяца.
Запуск нужен 1 ноября 2026 года.
Мы подготовим макет за 3 дня.
Хотели бы скидку за быстрый старт.
Если получится, запустим рекламу сразу.`;

  function withLetter() {
    const s = seeded();
    const id = s.ids.A;
    s.run(id, { type: 'addSource', payload: { kind: 'email', title: 'Демо-письмо 4', declaredCompany: 'Линия Плюс', receivedAt: '2026-10-05', text: LETTER, link: null, originalFilename: null, replacesSourceId: null } });
    const src = s.get(id).sources.at(-1)!;
    s.run(id, { type: 'parseSource', payload: { sourceId: src.id } });
    return { s, id, src };
  }

  it('Письмо даёт предложения с дословными цитатами; пожелание клиента — не обещание; обещание агентства — только кандидат на проверку человеком', () => {
    const { s, id, src } = withLetter();
    const pcs = s.get(id).proposedChanges.filter((p) => p.sourceId === src.id);
    assert.ok(pcs.length >= 4);
    assert.ok(pcs.every((p) => p.quoteFound === true && p.origin === 'keyword_rules'));
    assert.ok(pcs.some((p) => p.kind === 'fact' && p.key === 'deadline' && p.value === '2026-11-01'));
    assert.ok(pcs.some((p) => p.kind === 'client_wish'));
    assert.ok(pcs.some((p) => p.kind === 'conditional'));
    const promise = pcs.find((p) => p.kind === 'promise_candidate')!;
    assert.match(String(promise.value), /подготовим макет/);
    s.run(id, { type: 'decideProposedChange', payload: { id: promise.id, accept: true } });
    const pr = s.get(id).promises.at(-1)!;
    assert.equal(pr.status, 'discussed', 'человек подтверждает обещание отдельным действием');
    s.run(id, { type: 'setPromiseStatus', payload: { id: pr.id, status: 'confirmed', reason: 'Подтверждено владельцем' } });
    assert.equal(s.get(id).promises.at(-1)!.status, 'confirmed');
  });

  it('Повторная обработка не создаёт дублей и не затирает принятые сведения', () => {
    const { s, id, src } = withLetter();
    const goal = s.get(id).proposedChanges.find((p) => p.sourceId === src.id && p.key === 'business_goal')!;
    s.run(id, { type: 'decideProposedChange', payload: { id: goal.id, accept: true } });
    const countBefore = s.get(id).proposedChanges.length;
    const factBefore = JSON.stringify(s.get(id).facts.find((f) => f.key === 'business_goal'));
    s.run(id, { type: 'parseSource', payload: { sourceId: src.id } });
    s.run(id, { type: 'parseSource', payload: { sourceId: src.id } });
    assert.equal(s.get(id).proposedChanges.length, countBefore, 'новых дублей нет');
    assert.equal(JSON.stringify(s.get(id).facts.find((f) => f.key === 'business_goal')), factBefore, 'принятый факт не изменился');
    const ev = s.repo.events(id).filter((e) => e.action === 'keyword_parsed').at(-1)!;
    const fromLetter = s.get(id).proposedChanges.filter((p) => p.sourceId === src.id).length;
    assert.deepEqual(ev.after, { added: 0, skippedDuplicates: fromLetter, alreadyInCard: 0, quoteNotFound: 0 });
    // новая версия источника с тем же текстом + дополнение: старые предложения не повторяются
    s.run(id, { type: 'updateSourceText', payload: { sourceId: src.id, text: LETTER + '\nЛПР: Контакт 2, маркетолог.', reason: 'Дополнение письма' } });
    const src2 = s.get(id).sources.at(-1)!;
    s.run(id, { type: 'parseSource', payload: { sourceId: src2.id } });
    const added = s.get(id).proposedChanges.filter((p) => p.sourceId === src2.id);
    assert.equal(added.length, 1);
    assert.equal(added[0].key, 'decision_maker');
  });

  it('Импорт структурированного результата: проверка формата, отметка непроверенной цитаты, без дублей, без названия «ИИ»', () => {
    const { s, id, src } = withLetter();
    expectThrows(() => s.run(id, { type: 'importStructuredProposals', payload: { sourceId: src.id, items: [{ kind: 'fact', key: null, value: 'x', excerpt: '' } as never] } }), /ничего не импортировано/);
    s.run(id, { type: 'importStructuredProposals', payload: { sourceId: src.id, items: [
      { kind: 'fact', key: 'product', value: 'Лендинг акции', excerpt: 'Нужен лендинг для акции.' },
      { kind: 'fact', key: 'audience', value: 'Действующие клиенты', excerpt: 'Аудитория — действующие клиенты' },
    ] } });
    const imported = s.get(id).proposedChanges.filter((p) => p.origin === 'structured_import');
    assert.equal(imported.length, 2);
    assert.equal(imported.find((p) => p.key === 'product')!.quoteFound, true);
    const bad = imported.find((p) => p.key === 'audience')!;
    assert.equal(bad.quoteFound, false);
    assert.match(bad.note, /Цитата не найдена/);
    assert.ok(imported.every((p) => p.status === 'pending'), 'всё принимает человек');
    s.run(id, { type: 'importStructuredProposals', payload: { sourceId: src.id, items: [{ kind: 'fact', key: 'product', value: 'Лендинг акции', excerpt: 'Нужен лендинг для акции.' }] } });
    assert.equal(s.get(id).proposedChanges.filter((p) => p.origin === 'structured_import').length, 2, 'повторный импорт без дублей');
    assert.ok(!/ИИ|AI/.test(imported[0].note));
  });

  it('Недостающие вопросы создаются по незаполненным значимым полям без дублей; созвон и полный бриф не обязательны', () => {
    const { s, id, src } = withLetter();
    for (const p of s.get(id).proposedChanges.filter((x) => x.status === 'pending' && x.kind === 'fact' && x.sourceId === src.id)) s.run(id, { type: 'decideProposedChange', payload: { id: p.id, accept: true } });
    s.run(id, { type: 'createMissingQuestions', payload: {} });
    s.run(id, { type: 'createMissingQuestions', payload: {} });
    const qs = s.get(id).clarifications.filter((c) => c.factKey);
    const keys = qs.map((c) => c.factKey);
    assert.equal(new Set(keys).size, keys.length, 'без дублей');
    assert.ok(keys.includes('budget_mention'), 'неизвестный бюджет — вопрос, а не ноль');
    assert.ok(!keys.includes('deadline') && !keys.includes('business_goal'), 'то, что есть в письме, не спрашиваем');
    // достаточно письма: решение и переход без созвона
    s.run(id, { type: 'setReadiness', payload: { decision: 'enough_for_proposal', justification: 'Письма достаточно: результат, срок и материалы понятны' } });
    s.run(id, { type: 'moveStage', payload: { target: 'preparing_proposal', reason: 'Сведений из письма достаточно' } });
    assert.equal(s.get(id).stage, 'preparing_proposal');
    assert.equal(s.get(id).budget.minKop, null);
  });
});
