import { expect, test, type Page } from '@playwright/test';

const PASS = 'e2e-pass';
const SHOTS = 'docs/screenshots';

async function login(page: Page, user = 'owner') {
  await page.goto('/');
  await page.getByLabel('Логин').fill(user);
  await page.getByLabel('Пароль').fill(PASS);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Рабочий обзор' })).toBeVisible();
}

async function resetDemo(page: Page) {
  const r = await page.request.post('/api/login', { data: { login: 'owner', password: PASS }, headers: { 'x-requested-with': 'onair-crm' } });
  expect(r.ok()).toBeTruthy();
  const reset = await page.request.post('/api/admin/reset-demo', { data: { confirmText: 'ОЧИСТИТЬ ДЕМО' }, headers: { 'x-requested-with': 'onair-crm' } });
  expect(reset.ok()).toBeTruthy();
  await page.request.post('/api/logout', { headers: { 'x-requested-with': 'onair-crm' } });
}

async function openOpp(page: Page, title: RegExp) {
  await page.getByRole('link', { name: 'Возможности' }).click();
  await page.getByRole('link', { name: title }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function noHorizontalScroll(page: Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(iw);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: false });

test.beforeEach(async ({ page }) => {
  await resetDemo(page);
});

test('21: предупреждение о симуляции видно постоянно, в том числе до входа', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('note', { name: 'Ограничения прототипа' })).toBeVisible();
  await login(page);
  await expect(page.getByRole('note', { name: 'Ограничения прототипа' })).toBeVisible();
  await shot(page, 'dashboard');
  await openOpp(page, /Линия Плюс/);
  await page.getByRole('tab', { name: 'Источники' }).click();
  await expect(page.getByText('Сохранён только текст').first()).toBeVisible();
  await expect(page.getByText(/детерминированные правила по ключевым словам, а не AI/)).toBeVisible();
  await page.mouse.wheel(0, 3000);
  await expect(page.getByRole('note', { name: 'Ограничения прототипа' })).toBeInViewport();
});

test('1, 20: новый запрос — ошибки текстом рядом с полями, создание без бюджета и аудита, форма проходится клавиатурой', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Новый запрос' }).click();
  await expect(page.getByRole('heading', { name: 'Новый запрос' })).toBeVisible();
  await page.getByRole('button', { name: 'Создать запрос' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'не хватает данных' })).toBeVisible();
  await expect(page.getByText('Обязательное поле').first()).toBeVisible();
  await shot(page, 'new-errors');
  // клавиатура: от названия компании по Tab к следующим полям
  await page.getByLabel('Название новой компании').focus();
  await page.keyboard.type('Тест Клавиатура');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Тест Клавиатура — запрос');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Нужна посадочная страница');
  await page.getByLabel('Что сделать').fill('Созвон для уточнения');
  await page.getByLabel('Срок').fill('2026-10-12');
  await page.getByRole('button', { name: 'Создать запрос' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Тест Клавиатура — запрос' })).toBeVisible();
  await expect(page.getByText('1. Новый запрос').first()).toBeVisible();
  await expect(page.getByText('Статус: Не обсуждали')).toBeVisible();
  await noHorizontalScroll(page);
});

test('5: кейс A — разбор очереди и переход к предложению без полного аудита', async ({ page }) => {
  await login(page);
  await openOpp(page, /Линия Плюс/);
  await page.getByRole('tab', { name: 'Источники' }).click();
  const accept = page.getByRole('button', { name: 'Принять' });
  await expect(accept).toHaveCount(5);
  for (let i = 0; i < 5; i++) { await accept.first().click(); await expect(accept).toHaveCount(4 - i); }
  await page.getByRole('tab', { name: 'Вводные' }).click();
  await expect(page.getByRole('cell', { name: /Опубликовать согласованную страницу с рабочей формой заявки\./ }).first()).toBeVisible();
  await page.getByLabel('Обоснование').fill('Результат, материалы и согласующий понятны');
  await page.getByRole('button', { name: 'Зафиксировать решение' }).click();
  await page.getByText('Стадия, пауза, закрытие').click();
  await page.getByLabel('Перевести в стадию').selectOption('preparing_proposal');
  await page.getByLabel('Причина перехода').fill('Достаточно данных');
  await page.getByRole('button', { name: 'Перевести' }).click();
  await expect(page.getByText('3. Готовим предложение').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Диагностика' }).click();
  await expect(page.getByText('Находок нет — для маршрута A это нормально')).toBeVisible();
  await expect(page.getByText('Три результата полного аудита')).toHaveCount(0);
});

test('3, 12: кейс C — противоречие дат с двумя источниками, утверждение и снятие после скидки', async ({ page }) => {
  await login(page);
  await openOpp(page, /Контур Образец/);
  await page.getByRole('tab', { name: 'Источники' }).click();
  await expect(page.getByText('Срок запуска: два источника расходятся')).toBeVisible();
  await expect(page.getByText('2026-11-20', { exact: true })).toBeVisible();
  await expect(page.getByText('2026-12-05', { exact: true })).toBeVisible();
  await shot(page, 'conflict');
  await page.getByLabel('Решение проверяющего').selectOption('take_proposed');
  await page.getByRole('button', { name: 'Зафиксировать решение' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Заполните поле «Комментарий проверяющего»' })).toBeVisible();
  await page.getByLabel('Комментарий (обязательно)').fill('Клиент подтвердил 05.12 (демо)');
  await page.getByRole('button', { name: 'Зафиксировать решение' }).click();
  await expect(page.getByText('Открытых противоречий нет')).toBeVisible();

  await page.getByRole('tab', { name: 'КП и версии' }).click();
  await page.getByRole('button', { name: 'Утвердить версию и расчёт…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Утвердить' }).click();
  await expect(page.getByText(/Утверждено владельцем/)).toBeVisible();
  await expect(page.getByText('150 000 усл. ₽').first()).toBeVisible();

  // 13: генерация (предпросмотр) не меняет статус
  await page.getByRole('button', { name: 'Предпросмотр клиентского документа' }).click();
  await expect(page.getByLabel('Предпросмотр клиентского документа')).toContainText('Утверждён для отправки — отправка не зафиксирована');
  await expect(page.getByLabel('Предпросмотр клиентского документа')).not.toContainText('2 500');

  await page.getByRole('tab', { name: 'Работы и экономика' }).click();
  await page.getByText(/Параметры цены, скидка/).click();
  await page.getByLabel('Скидка, усл. ₽').fill('10000');
  await page.getByLabel('Причина скидки').fill('Пожелание клиента (тест)');
  await page.getByRole('button', { name: 'Сохранить параметры' }).click();
  await expect(page.getByText(/36\s000/).first()).toBeVisible();
  await expect(page.getByText(/25,714/)).toBeVisible();
  await page.getByRole('tab', { name: 'КП и версии' }).click();
  await expect(page.getByText(/Утверждение владельца снято/)).toBeVisible();
  await expect(page.locator('.notice.error').filter({ hasText: /150\s000 усл\. ₽ → 140\s000 усл\. ₽/ })).toBeVisible();
  await shot(page, 'approval-revoked');
  // 18: после обновления страницы состояние сохранено (данные на сервере, не в браузере)
  await page.reload();
  await expect(page.getByText(/Утверждение владельца снято/)).toBeVisible();
  await expect(page.getByText('Открытых противоречий нет')).toHaveCount(0); // вкладка КП, а не источники
});

test('22: PM не видит чужие возможности и не получает их по прямому адресу', async ({ page }) => {
  await login(page, 'pm');
  await page.getByRole('link', { name: 'Возможности' }).click();
  await expect(page.getByRole('heading', { name: 'Возможности' })).toBeVisible();
  await expect(page.getByText('Линия Плюс — лендинг одной услуги').first()).toBeVisible();
  await expect(page.getByText('Контур Образец — комплексный запуск направления')).toHaveCount(0);
  await expect(page.getByText('Площадка Пример — подписки')).toHaveCount(0);
  const ids = await page.evaluate(async () => {
    const r = await fetch('/api/opportunities');
    return r.status;
  });
  expect(ids).toBe(200);
  await page.goto('/#/opp/opp_does_not_exist');
  await expect(page.getByRole('alert')).toContainText('не найдена');
  await expect(page.getByRole('link', { name: 'Данные и настройки' })).toBeVisible();
  await page.getByRole('link', { name: 'Данные и настройки' }).click();
  await expect(page.getByText('доступны только владельцу')).toBeVisible();
});

test('26, 27: «Площадка Пример» — три разных значения, два бюджета, вопросы вместо выдуманных фактов', async ({ page }) => {
  await login(page);
  await openOpp(page, /Площадка Пример/);
  await expect(page.getByText(/регистрации = 27/)).toBeVisible();
  await expect(page.getByText(/оплаты = 0/)).toBeVisible();
  await expect(page.getByText(/Цель: подписки = 15/)).toBeVisible();
  await expect(page.getByText(/12\s000 усл\. ₽ \(в месяц\)/)).toBeVisible();
  await expect(page.getByText(/45\s000 усл\. ₽ \(на первый тест\)/)).toBeVisible();
  await expect(page.getByText(/Владелец данных клиента/).first()).toBeVisible();
  await expect(page.getByText(/Условное высказывание: «Если получится, запустим к пятнице.»/)).toBeVisible();
  await expect(page.getByText('Обещания не зафиксированы')).toBeVisible();
  await shot(page, 'ploshchadka');
});

test('20: на узком и широком экране нет горизонтальной прокрутки основных экранов', async ({ page }) => {
  await login(page);
  await noHorizontalScroll(page);
  await page.getByRole('link', { name: 'Возможности' }).click();
  await expect(page.getByRole('heading', { name: 'Возможности' })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, 'board');
  await page.getByRole('link', { name: /Контур Образец/ }).first().click();
  for (const tab of ['Вводные', 'Источники', 'Диагностика', 'Работы и экономика', 'КП и версии', 'Запуск', 'История']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(200);
    await noHorizontalScroll(page);
  }
  await page.getByRole('tab', { name: 'Работы и экономика' }).click();
  await shot(page, 'economics');
  await page.getByRole('tab', { name: 'Запуск' }).click();
  await expect(page.getByText('Почему нельзя «Передано в работу»:')).toBeVisible();
  await shot(page, 'launch');
  for (const link of ['Реестр находок', 'Журнал утверждений', 'Данные и настройки']) {
    await page.getByRole('link', { name: link }).click();
    await page.waitForTimeout(200);
    await noHorizontalScroll(page);
  }
});
