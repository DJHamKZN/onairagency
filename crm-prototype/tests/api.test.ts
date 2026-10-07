import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, createState, type AppState } from '../server/app';
import { ensureUsers, seedDemo } from '../server/seed';
import { openDb } from '../server/db';
import { Repo } from '../server/repo';
import { validateBackupText } from '../src/domain/backup';

const PASS = 'api-test-pass';
let dir: string;
let dbPath: string;
let state: AppState;
let server: Server;
let base: string;
let ids: ReturnType<typeof seedDemo>;

async function start() {
  state = createState(dbPath, join(dir, 'no-dist'));
  server = createApp(state);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop() {
  await new Promise<void>((r) => server.close(() => r()));
  state.db.close();
}

const asText = (b: unknown) => (b instanceof ArrayBuffer ? Buffer.from(b).toString('utf8') : JSON.stringify(b));

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, raw = false) {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'onair-crm', cookie: this.cookie },
      body: body === undefined ? undefined : raw ? (body as string) : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer(), headers: r.headers };
  }
  async login(login: string, role?: string) {
    const r = await this.req('POST', '/api/login', { login, password: PASS });
    assert.equal(r.status, 200, `login ${login}`);
    if (role) assert.equal((await this.req('POST', '/api/session/role', { role })).status, 200);
    return this;
  }
  async cmd(id: string, command: unknown, expectedVersion?: number) {
    let v = expectedVersion;
    if (v === undefined) v = (await this.req('GET', `/api/opportunities/${id}`)).body.rev;
    return this.req('POST', `/api/opportunities/${id}/commands`, { command, expectedVersion: v });
  }
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'onair-crm-test-'));
  dbPath = join(dir, 'crm.sqlite');
  const repo = new Repo(openDb(dbPath));
  ensureUsers(repo, PASS);
  ids = seedDemo(repo);
  repo.db.close();
  await start();
});
after(async () => {
  await stop();
});

describe('Серверный контроль доступа (22)', () => {
  it('без входа API отвечает 401', async () => {
    const r = await new Client().req('GET', '/api/opportunities');
    assert.equal(r.status, 401);
  });

  it('изменяющий запрос без X-Requested-With отклоняется (защита от CSRF)', async () => {
    const c = await new Client().login('owner');
    const r = await fetch(`${base}/api/opportunities/${ids.A}/commands`, { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
  });

  it('PM напрямую вызывает owner-only действие — 403', async () => {
    const pm = await new Client().login('pm');
    const opp = (await pm.req('GET', `/api/opportunities/${ids.A}`)).body;
    const r = await pm.cmd(ids.A, { type: 'approvePresaleLimit', payload: { hours: 100 } }, opp.rev);
    assert.equal(r.status, 403);
    const r2 = await pm.cmd(ids.A, { type: 'setPmCostVisibility', payload: { visible: true, comment: 'хочу видеть' } }, opp.rev);
    assert.equal(r2.status, 403);
    assert.equal((await pm.req('GET', '/api/admin/backup')).status, 403);
  });

  it('PM не может выбрать роль, которой у него нет', async () => {
    const pm = await new Client().login('pm');
    assert.equal((await pm.req('POST', '/api/session/role', { role: 'owner' })).status, 403);
  });

  it('подмена ID не открывает чужую возможность: 404 на чтение, историю, экспорт и команды', async () => {
    const pm = await new Client().login('pm');
    for (const path of [`/api/opportunities/${ids.C}`, `/api/opportunities/${ids.D}`, `/api/opportunities/${ids.D}/history`, `/api/opportunities/${ids.C}/export/audit/client_json`])
      assert.equal((await pm.req('GET', path)).status, 404, path);
    assert.equal((await pm.cmd(ids.D, { type: 'setContinuation', payload: { method: 'x' } }, 1)).status, 404);
    const list = (await pm.req('GET', '/api/opportunities')).body as { id: string }[];
    assert.ok(!list.some((o) => o.id === ids.C || o.id === ids.D));
  });

  it('PM без разрешения не получает ставок, себестоимости, маржи и комиссии — даже в JSON ответа', async () => {
    const owner = await new Client().login('owner');
    await owner.cmd(ids.C, { type: 'updateBasics', payload: { presalePmUserId: 'u_pm' } });
    const pm = await new Client().login('pm');
    const r = await pm.req('GET', `/api/opportunities/${ids.C}`);
    assert.equal(r.status, 200);
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes('250000'), 'ставка специалиста');
    assert.ok(!text.includes('Комиссия за привлечение (тестовая)'), 'правило комиссии');
    assert.ok(!/"frozenRule":\{/.test(text), 'замороженное правило комиссии не передаётся');
    assert.ok(!/"costKop":\d/.test(text) && !/"remainderKop":\d/.test(text) && !/"commissionKop":\d/.test(text));
    assert.ok(r.body.estimates[0].lines.every((l: { rateKop: number | null }) => l.rateKop === null));
    const hist = JSON.stringify((await pm.req('GET', `/api/opportunities/${ids.C}/history`)).body);
    assert.ok(!hist.includes('250000'), 'ставки не утекают через журнал');
    // владелец явно разрешает — PM видит
    await owner.cmd(ids.C, { type: 'setPmCostVisibility', payload: { visible: true, comment: 'Решение владельца (демо)' } });
    const r2 = await pm.req('GET', `/api/opportunities/${ids.C}`);
    assert.ok(JSON.stringify(r2.body).includes('250000'));
    await owner.cmd(ids.C, { type: 'setPmCostVisibility', payload: { visible: false, comment: 'Вернуть' } });
  });

  it('специалист видит только свою оценку, без чужих ставок, маржи, комиссии и КП', async () => {
    const spec = await new Client().login('spec');
    const r = await spec.req('GET', `/api/opportunities/${ids.C}`);
    assert.equal(r.status, 200);
    const v = r.body;
    assert.equal(v.proposals.length, 0);
    assert.equal(v.commissionRules.length, 0);
    assert.ok(v.estimates[0].lines.every((l: { performerUserId: string }) => l.performerUserId === 'u_spec'));
    assert.ok(!JSON.stringify(v).includes('200000'), 'ставка PM не видна');
    assert.equal((await spec.req('GET', '/api/approvals')).status, 403);
    // специалист не может поменять ставку даже в своей строке
    const line = v.estimates[0].lines[0];
    const bad = await spec.cmd(ids.C, { type: 'upsertCostLine', payload: { estimateId: v.estimates[0].id, line: { ...line, rateKop: 999 } } }, v.rev);
    assert.equal(bad.status, 422);
  });

  it('принимающий PM не видит возможность до стадии запуска', async () => {
    const rpm = await new Client().login('rpm');
    assert.equal((await rpm.req('GET', `/api/opportunities/${ids.A}`)).status, 404);
  });
});

describe('Финансы, передача и комплекты документов через HTTP', () => {
  it('специалист не получает финансы ни в карточке, ни в журнале, ни в экспорте КП', async () => {
    const spec = await new Client().login('spec');
    const v = (await spec.req('GET', `/api/opportunities/${ids.C}`)).body;
    const text = JSON.stringify(v);
    for (const leak of ['200000', '"discount":{', '"targetMarginBp":3000', 'Комиссия за привлечение', '"externalBudgets":[{'])
      assert.ok(!text.includes(leak), `утечка: ${leak}`);
    assert.equal(v.computed.estimates[v.estimates[0].id].priceKop, null, 'цена тоже скрыта от специалиста');
    const hist = JSON.stringify((await spec.req('GET', `/api/opportunities/${ids.C}/history`)).body);
    assert.ok(!hist.includes('200000'));
    const proposalId = (await new Client().login('owner').then((o) => o.req('GET', `/api/opportunities/${ids.C}`))).body.proposals[0].id;
    assert.equal((await spec.req('GET', `/api/opportunities/${ids.C}/export/proposal/${proposalId}?format=json`)).status, 403);
  });

  it('история изменений с момента версии: видно, что изменил другой пользователь', async () => {
    const owner = await new Client().login('owner');
    const before = (await owner.req('GET', `/api/opportunities/${ids.B}`)).body;
    await owner.cmd(ids.B, { type: 'addClarification', payload: { question: 'Вопрос для истории', addressedToRole: 'Клиент', impacts: ['scope'] } });
    const since = (await owner.req('GET', `/api/opportunities/${ids.B}/history?since=${encodeURIComponent(before.updatedAt)}`)).body;
    assert.ok(since.some((e: { action: string }) => e.action === 'added'));
    assert.ok(since.every((e: { at: string }) => e.at > before.updatedAt));
  });

  it('полный аудит: выжимка, клиентский и внутренний аудит сохраняются одним комплектом и скачиваются из сохранённой версии', async () => {
    const owner = await new Client().login('owner');
    const r0 = await owner.req('GET', `/api/opportunities/${ids.B}/export/audit/client_brief_pdf`);
    assert.equal(r0.status, 404, 'полный аудит не включён');
    await owner.cmd(ids.B, { type: 'setRoute', payload: { type: 'C', rationale: 'Полный аудит по согласованию', depth: 'external_evidence', fullMarketingAudit: true } });
    assert.equal((await owner.req('GET', `/api/opportunities/${ids.B}/export/audit/client_detailed_docx`)).status, 422, 'до сохранения комплекта файл не формируется');
    const r = await owner.cmd(ids.B, { type: 'saveAuditDeliverables', payload: { limitationsNote: 'Демо' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ds = r.body.audit.deliverables as { kind: string; snapshotId: string; setNumber: number }[];
    assert.equal(ds.length, 3);
    assert.ok(ds.every((d) => d.snapshotId && d.setNumber === 1));
    for (const kind of ['client_detailed_docx', 'internal_docx']) {
      const f = await owner.req('GET', `/api/opportunities/${ids.B}/export/audit/${kind}`);
      assert.equal(f.status, 200, kind);
      assert.equal(Buffer.from(f.body as ArrayBuffer).subarray(0, 2).toString(), 'PK', `${kind}: настоящий DOCX (zip)`);
    }
    assert.equal(state.repo.snapshots().filter((x) => x.kind.startsWith('audit_')).length, 3);
  });
});

describe('Версия записи и сохранность (22, 18)', () => {
  it('устаревшая версия вызывает 409 и не перезаписывает чужие изменения', async () => {
    const a = await new Client().login('owner');
    const b = await new Client().login('pm');
    const v = (await a.req('GET', `/api/opportunities/${ids.A}`)).body.rev;
    const r1 = await a.cmd(ids.A, { type: 'setContinuation', payload: { method: 'Изменение пользователя A' } }, v);
    assert.equal(r1.status, 200);
    const r2 = await b.cmd(ids.A, { type: 'setContinuation', payload: { method: 'Изменение пользователя B (устаревшее)' } }, v);
    assert.equal(r2.status, 409);
    assert.equal(r2.body.error, 'version_conflict');
    const now = (await a.req('GET', `/api/opportunities/${ids.A}`)).body;
    assert.equal(now.continuation.method, 'Изменение пользователя A');
  });

  it('перезапуск сервера сохраняет данные', async () => {
    const owner = await new Client().login('owner');
    await owner.cmd(ids.B, { type: 'addClarification', payload: { question: 'Вопрос до перезапуска', addressedToRole: 'Клиент', impacts: ['scope'] } });
    await stop();
    await start();
    const again = await new Client().login('owner');
    const v = (await again.req('GET', `/api/opportunities/${ids.B}`)).body;
    assert.ok(v.clarifications.some((c: { question: string }) => c.question === 'Вопрос до перезапуска'));
  });

  it('журнал изменений и снимки неизменяемы на уровне БД', () => {
    assert.throws(() => state.db.exec("UPDATE change_events SET reason = 'подмена'"), /append-only/);
    state.db.exec("INSERT INTO change_events (id, opportunity_id, entity_type, entity_id, action, user_id, acting_role, at, is_demo) VALUES ('evt_real', NULL, 'X', 'x', 'x', 'u_owner', 'owner', '2026-10-06', 0)");
    assert.throws(() => state.db.exec("DELETE FROM change_events WHERE id = 'evt_real'"), /append-only/);
    state.db.exec(`INSERT INTO snapshots (id, opportunity_id, kind, hash, data, created_at, created_by, is_demo) VALUES ('snap_real', '${ids.A}', 'approval', 'h', '{}', '2026-10-06', 'u_owner', 0)`);
    assert.throws(() => state.db.exec("UPDATE snapshots SET hash = 'x' WHERE id = 'snap_real'"), /immutable/);
    assert.throws(() => state.db.exec("DELETE FROM snapshots WHERE id = 'snap_real'"), /immutable/);
  });

  it('журнал не содержит секретов и хэшей паролей', () => {
    const all = JSON.stringify(state.repo.events());
    assert.ok(!all.includes(PASS));
    assert.ok(!all.includes('scrypt:'));
  });
});

describe('Резервная копия и импорт (18, 19, 23)', () => {
  it('экспорт → проверка → восстановление в чистую базу сохраняет связи, версии и историю; исходная база нетронута', async () => {
    const owner = await new Client().login('owner');
    const r = await owner.req('GET', '/api/admin/backup');
    assert.equal(r.status, 200);
    const text = asText(r.body);
    assert.ok(!text.includes('scrypt:'), 'хэши паролей не экспортируются');
    const b = JSON.parse(text);
    assert.match(b.warning, /ВНУТРЕННЯЯ/);
    assert.equal(b.schemaVersion, 1);
    const before = state.repo.exportBackup();
    const pv = validateBackupText(text);
    assert.equal(pv.ok, true, pv.errors.join('\n'));
    const clean = new Repo(openDb(':memory:'));
    clean.importInto(pv.backup!);
    const restored = clean.exportBackup();
    assert.equal(restored.opportunities.length, before.opportunities.length);
    assert.equal(restored.changeEvents.length, b.changeEvents.length);
    assert.equal(restored.snapshots.length, b.snapshots.length);
    const C1 = before.opportunities.find((o) => o.id === ids.C)!;
    const C2 = restored.opportunities.find((o) => o.id === ids.C)!;
    assert.equal(C2.rev, C1.rev);
    assert.deepEqual(C2.proposals.map((p) => p.id), C1.proposals.map((p) => p.id));
    assert.deepEqual(C2.related, C1.related);
    assert.equal(state.repo.exportBackup().opportunities.length, before.opportunities.length, 'исходная база не изменилась');
  });

  it('битый JSON, другая схема и разорванные ссылки отклоняются при предпросмотре; текущая база не меняется', async () => {
    const owner = await new Client().login('owner');
    const countBefore = state.repo.opportunities().length;
    const evBefore = state.repo.events().length;
    const good = state.repo.exportBackup();
    const cases: [string, string, RegExp][] = [
      ['битый JSON', '{"format": "onair-crm-backup", "schemaVersion": 1, ', /Повреждённый JSON/],
      ['другая схема', JSON.stringify({ ...good, schemaVersion: 99 }), /версия схемы/],
      ['не наш формат', JSON.stringify({ hello: 1 }), /не резервная копия/],
      ['разорванная ссылка', JSON.stringify({ ...good, opportunities: good.opportunities.map((o, i) => (i === 0 ? { ...o, companyId: 'co_missing' } : o)) }), /отсутствует/],
      ['неверный тип', JSON.stringify({ ...good, opportunities: [{ ...good.opportunities[0], stage: 42 }] }), /stage/],
    ];
    for (const [name, body, re] of cases) {
      const r = await owner.req('POST', '/api/admin/import/preview', body, true);
      assert.equal(r.status, 200, name);
      assert.equal(r.body.ok, false, name);
      assert.equal(r.body.token, null, name);
      assert.match(r.body.errors.join(' '), re, name);
    }
    const bad = await owner.req('POST', '/api/admin/import/confirm', { token: 'nope', confirmText: 'ЗАМЕНИТЬ БАЗУ' });
    assert.equal(bad.status, 422);
    assert.equal(state.repo.opportunities().length, countBefore);
    assert.equal(state.repo.events().length, evBefore + 0);
  });

  it('импорт через API: предпросмотр не меняет базу; подтверждение требует фразы; прежний файл базы сохраняется', async () => {
    const owner = await new Client().login('owner');
    const text = asText((await owner.req('GET', '/api/admin/backup')).body);
    const modified = JSON.parse(text);
    modified.opportunities = modified.opportunities.filter((o: { id: string; related: unknown[] }) => o.id === ids.A);
    modified.changeEvents = modified.changeEvents.filter((e: { opportunityId: string | null }) => e.opportunityId === ids.A || e.opportunityId === null);
    modified.snapshots = [];
    const pv = await owner.req('POST', '/api/admin/import/preview', JSON.stringify(modified), true);
    assert.equal(pv.body.ok, true, JSON.stringify(pv.body.errors));
    assert.ok(state.repo.opportunities().length > 1, 'до подтверждения база прежняя');
    const noPhrase = await owner.req('POST', '/api/admin/import/confirm', { token: pv.body.token, confirmText: 'да' });
    assert.equal(noPhrase.status, 422);
    const ok = await owner.req('POST', '/api/admin/import/confirm', { token: pv.body.token, confirmText: 'ЗАМЕНИТЬ БАЗУ' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(existsSync(ok.body.archivedPreviousDb));
    assert.ok(readdirSync(dir).some((f) => f.includes('before-import')));
    assert.equal(state.repo.opportunities().length, 1);
    // пароли сохранились — вход работает после замены базы
    await new Client().login('owner');
    void readFileSync;
  });
});
