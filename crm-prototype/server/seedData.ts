/**
 * Синтетические демо-данные. Все организации, роли и тексты вымышлены.
 * Наполнение идёт через те же команды, что и интерфейс, — поэтому seed проверяет доменные правила.
 */
import type { Command } from '../src/domain/commands';
import type { Opportunity, Role, User } from '../src/domain/types';
import type { RepoLike } from './repoTypes';
import { Service } from './service';

export const DEMO_USERS: User[] = [
  { id: 'u_owner', login: 'owner', displayName: 'Владелец (демо)', roles: ['owner', 'presale_pm'], isDemo: true },
  { id: 'u_pm', login: 'pm', displayName: 'Проджект пресейла (демо)', roles: ['presale_pm'], isDemo: true },
  { id: 'u_pm2', login: 'pm2', displayName: 'Проджект пресейла 2 (демо)', roles: ['presale_pm'], isDemo: true },
  { id: 'u_lead', login: 'lead', displayName: 'Стратег (демо)', roles: ['lead_specialist', 'specialist'], isDemo: true },
  { id: 'u_spec', login: 'spec', displayName: 'Специалист (демо)', roles: ['specialist'], isDemo: true },
  { id: 'u_rpm', login: 'rpm', displayName: 'Принимающий проджект (демо)', roles: ['receiving_pm'], isDemo: true },
];

export const DEMO_SOURCES = {
  A1: `Запрос: Нужен лендинг для одной услуги — консультации по подключению.
Цель бизнеса: Опубликовать согласованную страницу с рабочей формой заявки.
Материалы: Утверждённый текст страницы, фирменные цвета и логотип клиента (переданы клиентом).
ЛПР: Контакт 1, директор — единственный согласующий.
Бюджет пока не обсуждали.
Ограничения: Заявки и продажи не гарантируются, это не входит в первый этап.`,
  B1: `[00:01:10] Запрос: Обращений мало, хотим больше заявок.
[00:03:40] Данных по рекламе и продажам в одном месте нет.
[00:05:15] Я не знаю, какая у нас конверсия, аналитикой занимается другой человек.
[00:07:02] На сайте есть форма заявки.`,
  C1: `Запрос: Комплексная задача — новый сайт, реклама и CRM для отдела продаж.
Цель бизнеса: Запустить новое направление до конца года.
Запуск планируем 20 ноября 2026 года.
Клиент хотел бы скидку 10%, если подпишем быстро.`,
  C2: `Добрый день! По итогам обсуждения: запуск переносим на 5 декабря 2026 года.
Бюджет на рекламу на первый месяц — 40 000 руб.`,
  D1: `[00:02:05] Клиент сообщает 27 регистраций и 0 оплат за последний запуск.
[00:02:40] Цель — 15 подписок.
[00:04:10] Бюджет на рекламу примерно 12 000 в месяц.
[00:06:30] Я не знаю, как у нас настроена аналитика.
[00:07:15] Нужно сделать [уточнить количество] посадочных страниц.
[00:08:00] Если получится, запустим к пятнице.`,
  D2: `Бюджет на первый тест — 45 000.`,
};

export function seedDemoData(repo: RepoLike) {
  const svc = new Service(repo);
  const U = Object.fromEntries(DEMO_USERS.map((u) => [u.id, u])) as Record<string, User>;
  const owner = U.u_owner;

  const run = (oppId: string, cmd: Command, user: User = owner, role: Role = 'owner') => {
    const opp = repo.opportunity(oppId)!;
    return svc.run(user, role, oppId, cmd, opp.rev);
  };
  const get = (id: string): Opportunity => repo.opportunity(id)!;
  const company = (name: string) => svc.createCompany(owner, 'owner', name, true);
  const create = (title: string, companyId: string, request: string, pm: string, due: string, extra: Partial<Parameters<Service['create']>[2]> = {}) =>
    svc.create(owner, 'owner', {
      title, companyId, originalRequest: request, promisesNotRecorded: true, promises: [], ownerUserId: 'u_owner', presalePmUserId: pm,
      nextStep: { text: 'Связаться с клиентом и уточнить задачу', assigneeUserId: pm, due }, isDemo: true, ...extra,
    }).id;
  const source = (oppId: string, title: string, kind: 'note' | 'email' | 'transcript', text: string, receivedAt: string, declared: string) => {
    run(oppId, { type: 'addSource', payload: { kind, title, declaredCompany: declared, receivedAt, text, link: null, originalFilename: null, replacesSourceId: null } });
    const s = get(oppId).sources.at(-1)!;
    run(oppId, { type: 'parseSource', payload: { sourceId: s.id } });
    return s.id;
  };
  const acceptAll = (oppId: string, sourceId: string, filter: (k: string) => boolean = () => true) => {
    for (const pc of get(oppId).proposedChanges.filter((p) => p.sourceId === sourceId && p.status === 'pending' && filter(p.kind)))
      run(oppId, { type: 'decideProposedChange', payload: { id: pc.id, accept: true, comment: 'Проверено по источнику (демо)' } });
  };

  /* ===== Кейс A «Линия Плюс» ===== */
  const coA = company('Линия Плюс');
  const A = create('Линия Плюс — лендинг одной услуги', coA.id, 'Нужен лендинг для одной услуги', 'u_pm', '2026-10-08');
  run(A, { type: 'updateBasics', payload: { leadSpecialistUserId: 'u_lead', specialistUserIds: ['u_spec'], receivingPmUserId: 'u_rpm' } });
  source(A, 'Демо-заметка 1', 'note', DEMO_SOURCES.A1, '2026-10-01', 'Линия Плюс');
  run(A, { type: 'setContinuation', payload: { method: 'Сразу оценка: задача конкретная, материалы есть' } });
  run(A, { type: 'moveStage', payload: { target: 'clarifying', reason: 'Назначен ответственный, выбран способ продолжить' } });
  run(A, { type: 'setRoute', payload: { type: 'A', rationale: 'Понятны результат, границы, исходники, один согласующий', depth: 'none', fullMarketingAudit: false } });

  /* ===== Кейс B «Маяк Сервис» ===== */
  const coB = company('Маяк Сервис');
  const B = create('Маяк Сервис — «обращений мало»', coB.id, 'Обращений мало, хотим больше заявок', 'u_pm', '2026-10-05');
  run(B, { type: 'updateBasics', payload: { leadSpecialistUserId: 'u_lead', specialistUserIds: ['u_spec'] } });
  const b1 = source(B, 'Демо-заметка 1', 'transcript', DEMO_SOURCES.B1, '2026-09-29', 'Маяк Сервис');
  acceptAll(B, b1);
  run(B, { type: 'setContinuation', payload: { method: 'Короткая внешняя проверка и содержательный разговор' } });
  run(B, { type: 'moveStage', payload: { target: 'clarifying', reason: 'Выбран способ продолжить' } });
  run(B, { type: 'setRoute', payload: { type: 'B', rationale: 'Нет согласованных данных о рекламе и продажах; нужен содержательный разговор', depth: 'external_evidence', fullMarketingAudit: false } });
  run(B, { type: 'logPresaleHours', payload: { hours: 3 } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'setLeadPath', payload: { level: 'button', status: 'observed_publicly', note: 'Кнопка «Оставить заявку» видна на главной (демо-наблюдение)' } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'setLeadPath', payload: { level: 'open', status: 'observed_publicly', note: 'Форма открывается (демо-наблюдение)' } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'setLeadPath', payload: { level: 'fill', status: 'observed_publicly', note: 'Поля заполняются; контрольная отправка не выполнялась' } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'setModule', payload: { key: 'site_path', status: 'partial', reason: 'Путь до отправки формы виден публично; получение и обработка не проверены', accessNeeded: null, accessOwnerRole: null, blockedDecision: null, deepDive: true } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'setModule', payload: { key: 'sales_crm', status: 'needs_access', reason: 'Нет выгрузки обращений и статусов', accessNeeded: 'Обезличенная выгрузка обращений и статусов за 6 месяцев', accessOwnerRole: 'Владелец данных клиента', blockedDecision: 'Где теряются обращения: до или после получения', deepDive: false } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'setModule', payload: { key: 'analytics', status: 'needs_access', reason: 'Собеседник не знает аналитику', accessNeeded: 'Доступ на чтение к системе аналитики (через защищённое хранилище)', accessOwnerRole: 'Владелец данных клиента', blockedDecision: 'Есть ли проблема в объёме трафика или в конверсии', deepDive: false } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'addFinding', payload: { title: 'Форма заявки доступна с главной страницы', module: 'site_path', claimType: 'observation', dataBasis: 'external_public', observation: 'На главной странице есть кнопка, открывающая форму из трёх полей.', sourceId: get(B).sources[0].id, sourceDate: '2026-09-29', scope: 'Главная страница, десктоп', dataPeriod: 'На дату проверки', evidenceQuote: 'На сайте есть форма заявки.', limitation: 'Отправка, получение и обработка заявки не проверялись', impact: 'Публичная точка входа существует; причина «мало обращений» по ней не определяется', recommendation: 'Проверить получение и обработку заявок по данным клиента', effectCheck: 'Сверка числа отправок с числом обращений в CRM клиента за период' } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'setExternalSummary', payload: { understood: 'Клиент ощущает нехватку обращений; общей картины данных нет', checked: 'Публичная точка входа: кнопка, открытие и заполнение формы', unknown: 'Фактическая конверсия, получение и обработка заявок, затраты на рекламу', questions: 'Кто владеет данными? Можно ли получить обезличенную выгрузку обращений?', recommendedRoute: 'C' } }, U.u_lead, 'lead_specialist');
  run(B, { type: 'setReadiness', payload: { decision: 'offer_paid_diagnostic', justification: 'Причину нельзя определить по внешним данным; дорогая ошибка выбора направления' } });
  run(B, { type: 'setRoute', payload: { type: 'C', rationale: 'Нужна внутренняя диагностика маркетинга и продаж по выгрузкам', depth: 'internal_diagnostics', fullMarketingAudit: false } });
  run(B, { type: 'requestDiagnosticOpportunity', payload: { title: 'Маяк Сервис — платная диагностика маркетинга и продаж' } });

  /* ===== Кейс C «Контур Образец» ===== */
  const coC = company('Контур Образец');
  const C = create('Контур Образец — комплексный запуск направления', coC.id, 'Комплексная задача: сайт, реклама, CRM', 'u_owner', '2026-10-07');
  run(C, { type: 'updateBasics', payload: { leadSpecialistUserId: 'u_lead', specialistUserIds: ['u_spec'], receivingPmUserId: 'u_rpm' } });
  const c1 = source(C, 'Демо-заметка 1', 'note', DEMO_SOURCES.C1, '2026-09-20', 'Контур Образец');
  acceptAll(C, c1, (k) => k !== 'client_wish'); // пожелание скидки оставляем на решение человека
  const c2 = source(C, 'Демо-письмо 2', 'email', DEMO_SOURCES.C2, '2026-09-27', 'Контур Образец');
  acceptAll(C, c2); // дата из письма создаёт противоречие, а не перезапись
  run(C, { type: 'setContinuation', payload: { method: 'Созвон и сбор оценок' } });
  run(C, { type: 'moveStage', payload: { target: 'clarifying', reason: 'Выбран способ продолжить' } });
  run(C, { type: 'setRoute', payload: { type: 'A', rationale: 'Первый этап конкретен: посадочная страница и запуск рекламы; комплекс — следующими этапами', depth: 'none', fullMarketingAudit: false } });
  run(C, { type: 'setReadiness', payload: { decision: 'enough_for_proposal', justification: 'Объём первого этапа понятен; дату запуска решаем отдельно' } });
  run(C, { type: 'addWorkItem', payload: { title: 'Посадочная страница направления', basis: { type: 'client_task', text: 'Клиент: «новый сайт» — первым этапом посадочная страница' }, expectedResult: 'Опубликованная страница с формой', quantity: 1, unit: 'страница', acceptanceCriterion: 'Страница опубликована на согласованном адресе и принята согласующим', recurrence: 'one_time', assigneeUserId: 'u_spec' } });
  run(C, { type: 'addWorkItem', payload: { title: 'Запуск рекламной кампании', basis: { type: 'client_task', text: 'Клиент: «реклама» для нового направления' }, expectedResult: 'Кампания запущена по согласованным настройкам', quantity: 1, unit: 'кампания', acceptanceCriterion: 'Кампания активна, настройки совпадают с согласованным медиапланом', recurrence: 'one_time', assigneeUserId: 'u_spec' } });
  run(C, { type: 'upsertCommissionRule', payload: { label: 'Партнёрская комиссия (тестовая)', rateBp: 1000, base: 'agency_fee', baseDescription: 'Агентское вознаграждение P', baseAmountKop: null, period: 'Разово, с первого этапа', condition: 'Клиент приведён партнёром (демо)', recipientRole: 'Партнёр (демо-роль)', ownerApproved: true } });
  run(C, { type: 'createProposalDraft', payload: {} });
  const opC = get(C);
  const est = opC.estimates[0];
  const [pmLine, apLine] = est.lines;
  const w1 = opC.workItems[0].id;
  run(C, { type: 'upsertCostLine', payload: { estimateId: est.id, line: { id: '', kind: 'specialist', workItemId: w1, label: 'Дизайн и вёрстка страницы + реклама', performerUserId: 'u_spec', hours: 30, hoursMin: 26, hoursMax: 36, rateKop: 250000, amountKop: null, zeroReason: null, confidence: 'specialist_estimate' } } });
  run(C, { type: 'upsertCostLine', payload: { estimateId: est.id, line: { ...pmLine, hours: 5, rateKop: 200000, performerUserId: 'u_owner' } } });
  run(C, { type: 'upsertCostLine', payload: { estimateId: est.id, line: { ...apLine, hours: 2.5, rateKop: 200000, performerUserId: 'u_owner' } } });
  run(C, { type: 'updateEstimate', payload: { estimateId: est.id, patch: { commissionRuleId: get(C).commissionRules[0].id, targetMarginBp: 3000, targetMarginSource: 'demo_unapproved', taxModel: { status: 'set', description: 'Демо-допущение: налоги учтены в ставках. Реальная модель не утверждена' }, externalBudgets: [{ id: 'xb_1', label: 'Рекламный бюджет (тест)', amountKop: 4000000, period: 'первый месяц', paidBy: 'client_direct' }] } } });
  run(C, { type: 'updateProposalContent', payload: { proposalId: get(C).proposals[0].id, patch: {
    understanding: 'Нужно запустить новое направление: первым этапом — посадочная страница и реклама.',
    firstOfferWhy: 'Страница и кампания дают проверяемый первый результат до выбора CRM.',
    resultAndAcceptance: 'Опубликованная страница и активная кампания; приёмка — согласующим клиента.',
    timeline: 'Срок зависит от решения о дате запуска (см. противоречие 20.11 / 05.12)',
    dependencies: 'Своевременное предоставление материалов и доступов клиентом',
    clientActions: 'Предоставить тексты, логотип, доступ к рекламному кабинету через защищённое хранилище',
    payment: '100 % предоплата первого этапа (демо-условие)',
    revisions: 'Два круга правок',
    exclusions: 'CRM и интеграции — следующими этапами; рекламный бюджет оплачивается отдельно',
    validUntil: '2026-10-31',
    extraWorkProcedure: 'Дополнительные работы — через изменение объёма с новой оценкой и решением клиента',
    nextStep: 'Созвон по КП',
    freeWork: null,
  } } });

  /* ===== Проверочная запись «Площадка Пример» ===== */
  const coD = company('Площадка Пример');
  const D = create('Площадка Пример — подписки', coD.id, 'Мало оплат после регистрации', 'u_pm2', '2026-10-09');
  const d1 = source(D, 'Демо-заметка 1', 'transcript', DEMO_SOURCES.D1, '2026-10-02', 'Площадка Пример');
  const d2 = source(D, 'Демо-заметка 2', 'note', DEMO_SOURCES.D2, '2026-10-03', 'Площадка Пример');
  acceptAll(D, d1);
  acceptAll(D, d2);

  return { A, B, C, D };
}
