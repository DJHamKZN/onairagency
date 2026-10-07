/**
 * Миграция данных прежней версии (схема 1, коммит 0191e33) к текущей.
 * Фикстуры — настоящие данные прежней версии веб-демо, сгенерированные её же кодом:
 *  - webdemo-0191e33-seed.json   — исходные демо-данные (как в localStorage после первого открытия);
 *  - webdemo-0191e33-marked.json — то же + пользователь отметил пункты запуска «Контур Образец» (статус done / not_applicable).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { openDb } from '../server/db';
import { Repo } from '../server/repo';
import { migrateStoredData } from '../server/migrateStore';
import { MemoryRepo } from '../src/browser/memoryRepo';
import { Service } from '../server/service';
import { validateBackupText, SCHEMA_VERSION, type Backup } from '../src/domain/backup';
import { exportClientProposal, exportHandoff } from '../src/domain/clientExport';
import { CHECKLIST_KEYS, CHECKLIST_LABELS, packageBlockers, handoffBlockers } from '../src/domain/launch';
import { migrateOpportunity } from '../src/domain/migrate';
import { viewFor } from '../src/domain/permissions';
import type { Opportunity, Role, User } from '../src/domain/types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SEED = fixture('webdemo-0191e33-seed.json');
const MARKED = fixture('webdemo-0191e33-marked.json');
const NOW = '2026-10-07T12:00:00.000Z';
const kontur = (b: { opportunities: Opportunity[] }) => b.opportunities.find((o) => o.title.includes('Контур'))!;
const bad = /undefined|NaN|\[object Object\]/;

/** Всё, что видит пользователь по карточке: представления для всех ролей, блокеры, экспорт. */
function everythingShown(opp: Opportunity, users: User[], companyName: string) {
  const out: unknown[] = [packageBlockers(opp), handoffBlockers(opp)];
  for (const u of users) for (const r of u.roles) out.push(viewFor(opp, u, r as Role));
  for (const pv of opp.proposals) out.push(exportClientProposal(opp, { id: opp.companyId, name: companyName } as never, pv));
  out.push(exportHandoff(opp, { id: opp.companyId, name: companyName } as never));
  return JSON.stringify(out);
}

describe('Миграция данных прежней версии', () => {
  it('исходные данные прежней версии: проходят проверку, все карточки на месте, «undefined» нигде нет', () => {
    const rawBefore = JSON.parse(SEED) as Backup;
    assert.equal(rawBefore.schemaVersion, 1);
    // так выглядела ошибка: пункты с прежними идентификаторами без названия
    assert.ok(packageBlockers(kontur(rawBefore)).some((b) => b.includes('«Цель и первый результат»')) || kontur(rawBefore).launch.items.some((i) => !(i.key in CHECKLIST_LABELS)));

    const p = validateBackupText(SEED, NOW);
    assert.equal(p.ok, true, p.errors.join('; '));
    const b = p.backup!;
    assert.equal(b.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(b.opportunities.map((o) => o.id).sort(), rawBefore.opportunities.map((o) => o.id).sort(), 'ни одна карточка не потеряна');
    assert.ok(p.migrated.length >= 1);
    assert.match(p.warnings.join(' '), /приведена к схеме 2/);

    for (const o of b.opportunities) {
      assert.deepEqual(o.launch.items.map((i) => i.key), CHECKLIST_KEYS, `${o.title}: пункты текущей схемы в правильном порядке`);
      for (const blk of packageBlockers(o)) assert.doesNotMatch(blk, bad, `${o.title}: ${blk}`);
      const company = b.companies.find((c) => c.id === o.companyId)!.name;
      assert.doesNotMatch(everythingShown(o, b.users, company), bad, o.title);
    }
    const c = kontur(b);
    assert.deepEqual(c.launch.legacyItems!.map((l) => l.key).sort(), ['accepted_scope', 'goal_first_result', 'payment_status', 'promises', 'revisions', 'scope_exclusions']);
    assert.ok(packageBlockers(c).includes(`Не проверено: «${CHECKLIST_LABELS.terms_reconciled}»`));
    // остальные данные карточки не тронуты
    const before = kontur(rawBefore);
    for (const k of ['sources', 'facts', 'proposals', 'approvals', 'estimates', 'workItems', 'promises', 'findings'] as const)
      assert.deepEqual(c[k], before[k], `поле ${k} не изменилось`);
    assert.equal(c.rev, before.rev);
    // событие миграции в журнале — от имени системы
    const evs = b.changeEvents.filter((e) => e.action === 'schema_migrated');
    assert.equal(evs.length, p.migrated.length);
    assert.ok(evs.every((e) => e.userId === 'system' && e.actingRole === 'system' && /схеме 2/.test(e.reason ?? '')));
  });

  it('данные с отметками «выполнено» больше не отбрасываются: отметки, комментарии и авторы сохранены', () => {
    const raw = JSON.parse(MARKED) as Backup;
    const p = validateBackupText(MARKED, NOW);
    assert.equal(p.ok, true, p.errors.join('; '));
    assert.equal(p.backup!.opportunities.length, raw.opportunities.length);
    const c = kontur(p.backup!);
    const item = (k: string) => c.launch.items.find((i) => i.key === k)!;
    const old = (k: string) => kontur(raw).launch.items.find((i) => (i.key as string) === k)!;
    assert.equal(item('contract').status, 'ready');
    assert.equal(item('contract').note, 'Договор подписан, папка «Договоры»');
    assert.equal(item('contract').updatedBy, old('contract').updatedBy);
    assert.equal(item('contract').updatedAt, old('contract').updatedAt);
    assert.equal(item('calendar').status, 'not_applicable');
    assert.equal(item('calendar').naReason, 'Календарь ведёт клиент');
    const legacy = Object.fromEntries(c.launch.legacyItems!.map((l) => [l.key, l]));
    assert.equal(legacy.goal_first_result.status, 'done');
    assert.equal(legacy.goal_first_result.note, 'Первый результат: запуск лендинга к 20.11');
    assert.equal(legacy.payment_status.note, 'Счёт выставлен');
    assert.match(legacy.payment_status.nowCoveredBy, /статус условий оплаты/);
    assert.equal(legacy.promises.note, 'Обещания сверены на встрече');
    const m = p.migrated.find((x) => x.opportunityId === c.id)!;
    assert.ok(m.changes.some((x) => x.includes('«Договор»: «выполнено» → «Готово»')));
    for (const blk of packageBlockers(c)) assert.doesNotMatch(blk, bad);
    assert.ok(!packageBlockers(c).some((x) => x.includes('«Договор»')), 'отмеченный договор не стал блокером');
    // в пакете передачи прежние отметки видны отдельно
    const h = exportHandoff(c, { id: c.companyId, name: 'X' } as never);
    if (h) assert.ok(h.previousChecks.some((x) => x.item === 'Цель и первый результат' && x.note?.includes('20.11')));
  });

  it('миграция идемпотентна: повторная загрузка ничего не меняет и не дублирует события', () => {
    const first = validateBackupText(MARKED, NOW);
    const again = validateBackupText(JSON.stringify(first.backup), '2026-10-08T00:00:00.000Z');
    assert.equal(again.ok, true);
    assert.equal(again.migrated.length, 0);
    assert.equal(again.warnings.filter((w) => w.includes('приведена')).length, 0);
    assert.deepEqual(again.backup!.opportunities, first.backup!.opportunities);
    assert.equal(again.backup!.changeEvents.length, first.backup!.changeEvents.length);
    for (const o of first.backup!.opportunities) assert.equal(migrateOpportunity(o, NOW), null);
  });

  it('браузер: старая карточка после загрузки работает, новая карточка создаётся по текущей схеме', () => {
    const repo = new MemoryRepo();
    const p = validateBackupText(MARKED, NOW);
    repo.importInto(p.backup!); // ровно так веб-демо загружает localStorage
    const svc = new Service(repo, () => NOW);
    const owner = repo.users().find((u) => u.login === 'owner')!;
    const c = repo.opportunities().find((o) => o.title.includes('Контур'))!;
    // действия над мигрированной карточкой
    svc.run(owner, 'owner', c.id, { type: 'setChecklistItem', payload: { key: 'terms_reconciled', status: 'ready', note: 'Сверено с КП', naReason: null } }, c.rev);
    const after = repo.opportunity(c.id)!;
    assert.equal(after.launch.items.find((i) => i.key === 'terms_reconciled')!.status, 'ready');
    assert.equal(after.launch.legacyItems!.length, 6, 'прежние отметки сохраняются при последующих изменениях');
    // новая карточка
    const company = repo.companies()[0];
    const v = svc.create(owner, 'owner', {
      title: 'Новая карточка после миграции', companyId: company.id, originalRequest: 'Проверка', promisesNotRecorded: true, promises: [],
      ownerUserId: owner.id, presalePmUserId: owner.id, nextStep: { text: 'Позвонить', assigneeUserId: owner.id, due: '2026-10-10' },
    });
    const n = repo.opportunity(v.id)!;
    assert.deepEqual(n.launch.items.map((i) => i.key), CHECKLIST_KEYS);
    assert.equal(n.launch.legacyItems, undefined);
    for (const blk of packageBlockers(n)) assert.doesNotMatch(blk, bad);
    // повторное сохранение и загрузка (как перезагрузка страницы) — без новых миграций
    const reload = validateBackupText(JSON.stringify(repo.exportBackup()), NOW);
    assert.equal(reload.ok, true);
    assert.equal(reload.migrated.length, 0);
    assert.equal(reload.backup!.opportunities.length, p.backup!.opportunities.length + 1);
  });

  it('локальный сервер: база прежней версии мигрирует при запуске, в журнале — событие системы, повторный запуск ничего не меняет', () => {
    const repo = new Repo(openDb(':memory:'));
    // база прежней версии: записи схемы 1 как есть, без проверки
    repo.importInto(JSON.parse(MARKED) as Backup);
    const c0 = repo.opportunities().find((o) => o.title.includes('Контур'))!;
    assert.ok(c0.launch.items.some((i) => (i.status as string) === 'done'));
    const done = migrateStoredData(repo, NOW);
    assert.ok(done.length >= 1);
    const c = repo.opportunity(c0.id)!;
    assert.deepEqual(c.launch.items.map((i) => i.key), CHECKLIST_KEYS);
    assert.equal(c.rev, c0.rev + 1, 'изменение записано с новой версией (защита от одновременной правки сохраняется)');
    const ev = repo.events(c.id).filter((e) => e.action === 'schema_migrated');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].userId, 'system');
    assert.deepEqual(migrateStoredData(repo, NOW), []);
    assert.equal(repo.events(c.id).filter((e) => e.action === 'schema_migrated').length, 1);
    // резервная копия после миграции — текущей схемы и проходит проверку без изменений
    const p = validateBackupText(JSON.stringify(repo.exportBackup()), NOW);
    assert.equal(p.ok, true, p.errors.join('; '));
    assert.equal(p.migrated.length, 0);
  });

  it('неизвестный статус и повторяющийся пункт не теряются и не ломают показ', () => {
    const raw = JSON.parse(SEED) as Backup;
    const c = kontur(raw);
    (c.launch.items[0] as { status: string }).status = 'weird';
    c.launch.items.push({ ...c.launch.items.find((i) => i.key === 'contract')!, note: 'дубль' });
    const p = validateBackupText(JSON.stringify(raw), NOW);
    assert.equal(p.ok, true, p.errors.join('; '));
    const m = kontur(p.backup!);
    assert.ok(m.launch.legacyItems!.some((l) => l.key === 'contract' && l.note === 'дубль'));
    assert.ok(m.launch.legacyItems!.some((l) => l.key === 'goal_first_result' && l.status === 'weird'));
    for (const blk of packageBlockers(m)) assert.doesNotMatch(blk, bad);
  });

  it('копия неподдерживаемой версии отклоняется с понятным сообщением', () => {
    const raw = JSON.parse(SEED);
    raw.schemaVersion = 99;
    const p = validateBackupText(JSON.stringify(raw));
    assert.equal(p.ok, false);
    assert.match(p.errors[0], /Поддерживаются 1–2/);
  });
});

describe('Миграция на реальном HTTP-сервере', () => {
  it('файл базы прежней версии: сервер стартует, карточки на месте; импорт старой копии через API проходит с предупреждением о миграции', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createApp, createState } = await import('../server/app');
    const { ensureUsers } = await import('../server/seed');
    const dir = mkdtempSync(join(tmpdir(), 'onair-migr-'));
    const dbPath = join(dir, 'old.sqlite');
    // 1. база прежней версии на диске
    const oldDb = openDb(dbPath);
    const oldRepo = new Repo(oldDb);
    oldRepo.importInto(JSON.parse(MARKED) as Backup);
    ensureUsers(oldRepo, 'migr-pass');
    oldDb.close();
    // 2. запуск сервера на этой базе
    const state = createState(dbPath, join(dir, 'no-dist'));
    const server = createApp(state);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    try {
      const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'onair-crm' }, body: JSON.stringify({ login: 'owner', password: 'migr-pass' }) });
      assert.equal(login.status, 200);
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      const h = { cookie, 'content-type': 'application/json', 'x-requested-with': 'onair-crm' };
      const list = (await (await fetch(`${base}/api/opportunities`, { headers: h })).json()) as { id: string; title: string }[];
      assert.equal(list.length, (JSON.parse(MARKED) as Backup).opportunities.length);
      const c = list.find((o) => o.title.includes('Контур'))!;
      const view = (await (await fetch(`${base}/api/opportunities/${c.id}`, { headers: h })).json()) as Opportunity & { blockers?: unknown };
      assert.doesNotMatch(JSON.stringify(view), /«undefined»|undefined»/);
      assert.deepEqual(view.launch.items.map((i) => i.key), CHECKLIST_KEYS);
      const hist = (await (await fetch(`${base}/api/opportunities/${c.id}/history`, { headers: h })).json()) as { action: string; userId: string }[];
      assert.ok(hist.some((e) => e.action === 'schema_migrated' && e.userId === 'system'));
      // 3. импорт старой копии через API
      const pv = (await (await fetch(`${base}/api/admin/import/preview`, { method: 'POST', headers: h, body: MARKED })).json()) as { ok: boolean; warnings: string[]; token: string; errors: string[] };
      assert.equal(pv.ok, true, pv.errors.join('; '));
      assert.match(pv.warnings.join(' '), /приведена к схеме 2/);
      const ok = await fetch(`${base}/api/admin/import/confirm`, { method: 'POST', headers: h, body: JSON.stringify({ token: pv.token, confirmText: 'ЗАМЕНИТЬ БАЗУ' }) });
      assert.equal(ok.status, 200);
      const c2 = state.repo.opportunity(c.id)!;
      assert.deepEqual(c2.launch.items.map((i) => i.key), CHECKLIST_KEYS);
      assert.equal(c2.launch.legacyItems!.length, 6);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      state.db.close();
    }
  });
});
