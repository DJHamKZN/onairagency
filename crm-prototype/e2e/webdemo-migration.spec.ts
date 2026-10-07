/**
 * Веб-демо (сборка dist-demo, как на claude.ai) с данными, сохранёнными ПРЕЖНЕЙ версией в localStorage.
 * Проверяет: старая карточка, новая карточка, импорт резервной копии, непрочитанные данные — без очистки браузера.
 */
import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const ROOT = process.cwd();
const OLD = readFileSync(join(ROOT, 'tests/fixtures/webdemo-0191e33-marked.json'), 'utf8');
const OLD_SEED = readFileSync(join(ROOT, 'tests/fixtures/webdemo-0191e33-seed.json'), 'utf8');
const DATA_KEY = 'onair-crm-webdemo-data-v1';
const SESSION_KEY = 'onair-crm-webdemo-session-v1';
const OLD_IDS: string[] = (JSON.parse(OLD).opportunities as { id: string }[]).map((o) => o.id);
const KONTUR = (JSON.parse(OLD).opportunities as { id: string; title: string }[]).find((o) => o.title.includes('Контур'))!.id;
const LABELS = [
  'Договорённости из принятой версии КП сверены с реальностью', 'Договор', 'Материалы клиента получены', 'Выводы диагностики переданы',
  'Открытые риски разобраны', 'Роли агентства и клиента', 'Согласующие со стороны клиента', 'Порядок общения', 'Доступы (ссылка на защищённое место и ответственный, без паролей)',
  'Исполнители назначены', 'Загрузка исполнителей подтверждена', 'Календарь первого этапа', 'Исходные показатели для приёмки зафиксированы',
];

let server: Server;
let base: string;

test.beforeAll(async () => {
  execSync('node scripts/build-demo.mjs', { cwd: ROOT, stdio: 'ignore' });
  server = createServer((req, res) => {
    const file = req.url?.startsWith('/app.js') ? 'app.js' : 'index.html';
    res.writeHead(200, { 'content-type': file === 'app.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(readFileSync(join(ROOT, 'dist-demo', file)));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

/** Кладёт данные прежней версии в localStorage ДО загрузки приложения (как у пользователя, открывшего старую страницу). */
async function withOldStorage(page: Page, data: string, session = true) {
  await page.addInitScript(([k, v, sk, s]) => {
    if (sessionStorage.getItem('__seeded')) return; // только при первом открытии вкладки — перезагрузка видит уже сохранённое
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    localStorage.setItem(k, v);
    if (s) localStorage.setItem(sk, s);
  }, [DATA_KEY, data, SESSION_KEY, session ? JSON.stringify({ userId: 'u_owner', role: 'owner' }) : ''] as const);
}

async function expectLaunchOk(page: Page, id: string) {
  await page.goto(`${base}#/opp/${id}/launch`);
  await expect(page.getByRole('heading', { name: 'Проверка готовности' })).toBeVisible();
  const body = await page.locator('main').innerText();
  expect(body).not.toContain('undefined');
  expect(body).not.toMatch(/«»/);
  for (const l of LABELS) await expect(page.getByRole('cell', { name: l, exact: true })).toBeVisible();
}

test('старая карточка: данные прежней версии мигрируют без очистки браузера, названия проверок на месте', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withOldStorage(page, OLD);
  await page.goto(base);
  await expect(page.getByRole('status').filter({ hasText: 'приведены к текущей' })).toBeVisible();
  // все карточки на месте
  await page.goto(`${base}#/opps`);
  for (const id of OLD_IDS) await expect(page.locator(`a[href="#/opp/${id}"]`).first()).toBeAttached();
  await expectLaunchOk(page, KONTUR);
  // отметки пользователя сохранены
  const contract = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Договор', exact: true }) });
  await expect(contract).toContainText('Готово');
  await expect(contract).toContainText('Договор подписан');
  // прежние отметки — отдельным блоком
  await page.getByText(/Отметки прежней версии чек-листа \(6\)/).click();
  await expect(page.getByRole('cell', { name: 'Цель и первый результат' })).toBeVisible();
  await expect(page.getByText('Первый результат: запуск лендинга к 20.11')).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/webdemo-migrated-launch-${test.info().project.name}.png`, fullPage: true });
  // блокеры без «undefined»
  await expect(page.getByText('Не проверено: «Договорённости из принятой версии КП сверены с реальностью»').first()).toBeVisible();
  // история: событие миграции от системы
  await page.goto(`${base}#/opp/${KONTUR}/history`);
  await expect(page.getByText('данные приведены к новой версии (миграция)').first()).toBeVisible();
  await expect(page.getByText('Система (обновление данных)').first()).toBeVisible();
  // перезагрузка: миграция не повторяется, данные остались
  await page.reload();
  await page.goto(`${base}#/opps`);
  await expect(page.getByRole('status').filter({ hasText: 'приведены к текущей' })).toHaveCount(0);
  for (const id of OLD_IDS) await expect(page.locator(`a[href="#/opp/${id}"]`).first()).toBeAttached();
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), DATA_KEY);
  expect(stored.schemaVersion).toBe(2);
  expect(errors).toEqual([]);
});

test('новая карточка рядом со старыми: создаётся по текущей схеме', async ({ page }) => {
  await withOldStorage(page, OLD);
  await page.goto(base);
  const id = await page.evaluate(async () => {
    const h = { 'content-type': 'application/json', 'x-requested-with': 'onair-crm' };
    const comps = await (await fetch('/api/companies', { headers: h })).json();
    const r = await fetch('/api/opportunities', { method: 'POST', headers: h, body: JSON.stringify({
      title: 'Новая карточка после обновления', companyId: comps[0].id, originalRequest: 'Проверка после миграции', promisesNotRecorded: true, promises: [],
      ownerUserId: 'u_owner', presalePmUserId: 'u_owner', nextStep: { text: 'Позвонить', assigneeUserId: 'u_owner', due: '2026-10-10' },
    }) });
    return (await r.json()).id as string;
  });
  expect(id).toMatch(/^opp_/);
  await expectLaunchOk(page, id);
  await expect(page.locator('main').getByText(/Отметки прежней версии чек-листа/)).toHaveCount(0);
  await page.goto(`${base}#/opps`);
  for (const old of OLD_IDS) await expect(page.locator(`a[href="#/opp/${old}"]`).first()).toBeAttached();
});

test('импорт резервной копии прежней версии: предупреждение о миграции, после замены — корректный «Запуск»', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: /Войти: Владелец/ }).click();
  await page.goto(`${base}#/admin`);
  await page.locator('input[type=file]').setInputFiles({ name: 'old-backup.json', mimeType: 'application/json', buffer: Buffer.from(OLD) });
  await expect(page.getByText('old-backup.json: проверка пройдена')).toBeVisible();
  await expect(page.getByText(/приведена к схеме 2/)).toBeVisible();
  await page.getByRole('button', { name: 'Заменить текущую базу этой копией…' }).click();
  await page.getByLabel(/Введите «ЗАМЕНИТЬ БАЗУ»/).fill('ЗАМЕНИТЬ БАЗУ');
  await page.getByRole('button', { name: 'Заменить', exact: true }).click();
  await expect(page.getByText('Данные заменены копией')).toBeVisible();
  await expectLaunchOk(page, KONTUR);
});

test('исходные данные прежней версии (без отметок) — тот же результат', async ({ page }) => {
  await withOldStorage(page, OLD_SEED);
  await page.goto(base);
  await expectLaunchOk(page, KONTUR);
});

test('непрочитанные данные не затираются: сохраняются под отдельным ключом, пользователь видит сообщение', async ({ page }) => {
  await withOldStorage(page, '{"format":"onair-crm-backup","schemaVersion":1, broken', false);
  await page.goto(base);
  await expect(page.getByText(/не прошли проверку/)).toBeVisible();
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const kept = keys.find((k) => k.includes('-unreadable-'))!;
  expect(kept).toBeTruthy();
  expect(await page.evaluate((k) => localStorage.getItem(k), kept)).toContain('broken');
});
