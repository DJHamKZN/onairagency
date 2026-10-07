import { createReadStream, existsSync, renameSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateBackupText, MAX_BACKUP_BYTES, type Backup } from '../src/domain/backup';
import { migrateStoredData } from './migrateStore';
import { exportClientAudit, exportClientProposal, exportHandoff } from '../src/domain/clientExport';
import { DomainError } from '../src/domain/errors';
import type { Role, User } from '../src/domain/types';
import { ROLE_LABELS } from '../src/domain/types';
import { loginAllowed, loginFailed, loginSucceeded, newToken, parseCookies, tokenHash, verifyPassword } from './auth';
import { openDb, type DB } from './db';
import { auditBriefPdf, auditDocx, handoffDocx, internalAuditDocx, PdfFontMissing, proposalDocx } from './docs';
import { ConflictError, Repo } from './repo';
import { seedDemo, ensureUsers } from './seed';
import { AccessError, Service } from './service';

export interface AppState {
  dbPath: string;
  db: DB;
  repo: Repo;
  svc: Service;
  pendingImports: Map<string, { backup: Backup; userId: string; expires: number }>;
  distDir: string;
}

export function createState(dbPath: string, distDir = resolve('dist')): AppState {
  const db = openDb(dbPath);
  const repo = new Repo(db);
  const migrated = migrateStoredData(repo);
  if (migrated.length) console.log(`Данные приведены к текущей схеме: карточек — ${migrated.length} (подробности — в истории карточек).`);
  return { dbPath, db, repo, svc: new Service(repo), pendingImports: new Map(), distDir };
}

const COOKIE = 'onair_crm_session';
const MUTATION_HEADER = 'x-requested-with';

class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...securityHeaders(),
    ...headers,
  });
  res.end(data);
}

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  };
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, `Слишком большой запрос (лимит ${Math.round(limit / 1024)} КБ)`);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req: IncomingMessage, limit = 1024 * 1024): Promise<Record<string, unknown>> {
  const t = await readBody(req, limit);
  if (!t) return {};
  try {
    const v = JSON.parse(t);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'Некорректный JSON в запросе');
  }
}

function auth(state: AppState, req: IncomingMessage): { user: User; role: Role; token: string } {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) throw new AccessError(401, 'Требуется вход');
  const s = state.repo.session(tokenHash(token));
  if (!s) throw new AccessError(401, 'Сессия истекла — войдите снова');
  const user = state.repo.userById(s.userId);
  if (!user) throw new AccessError(401, 'Пользователь не найден');
  if (!user.roles.includes(s.actingRole)) throw new AccessError(403, 'Роль сессии больше не назначена пользователю');
  return { user, role: s.actingRole, token };
}

function attachment(res: ServerResponse, name: string, mime: string, data: Buffer | Uint8Array) {
  res.writeHead(200, {
    'content-type': mime,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'no-store',
    ...securityHeaders(),
  });
  res.end(Buffer.from(data));
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function serveStatic(state: AppState, req: IncomingMessage, res: ServerResponse) {
  if (!existsSync(state.distDir)) return send(res, 503, 'Интерфейс не собран. Выполните: npm run build');
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let p = normalize(join(state.distDir, url));
  if (!p.startsWith(state.distDir)) return send(res, 403, 'forbidden');
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(state.distDir, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', ...securityHeaders() });
  createReadStream(p).pipe(res);
}

export function createApp(state: AppState): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';
      if (!path.startsWith('/api/')) return serveStatic(state, req, res);
      if (method !== 'GET' && req.headers[MUTATION_HEADER] !== 'onair-crm')
        throw new HttpError(403, 'Изменяющие запросы принимаются только от интерфейса (нет заголовка X-Requested-With)');
      await route(state, req, res, method, path, url);
    } catch (e) {
      handleError(res, e, state);
    }
  });
}

function handleError(res: ServerResponse, e: unknown, state: AppState) {
  if (e instanceof DomainError) return send(res, 422, { error: e.code, message: e.message, missing: e.missing, field: e.field });
  if (e instanceof AccessError) return send(res, e.status, { error: e.status === 401 ? 'unauthorized' : e.status === 404 ? 'not_found' : 'forbidden', message: e.message });
  if (e instanceof ConflictError) return send(res, 409, { error: 'version_conflict', message: 'Карточку уже изменили. Ваши введённые данные сохранены в форме — обновите карточку и повторите действие', currentVersion: e.currentVersion });
  if (e instanceof HttpError) return send(res, e.status, { error: 'http', message: e.message, ...e.body });
  if (e instanceof PdfFontMissing) return send(res, 501, { error: 'pdf_font_missing', message: e.message });
  console.error('[server] unexpected error:', (e as Error)?.message);
  void state;
  return send(res, 500, { error: 'internal', message: 'Внутренняя ошибка сервера. Данные не изменены' });
}

async function route(state: AppState, req: IncomingMessage, res: ServerResponse, method: string, path: string, url: URL) {
  const { svc, repo } = state;
  const seg = path.split('/').filter(Boolean); // ['api', ...]

  if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, mode: 'local-prototype' });

  if (method === 'POST' && path === '/api/login') {
    const b = await readJson(req);
    const login = String(b.login ?? '');
    const key = `${req.socket.remoteAddress}:${login}`;
    if (!loginAllowed(key)) throw new HttpError(429, 'Слишком много попыток входа. Подождите 15 минут');
    const u = repo.userByLogin(login);
    if (!u || !verifyPassword(String(b.password ?? ''), u.passwordHash)) {
      loginFailed(key);
      throw new AccessError(401, 'Неверный логин или пароль');
    }
    loginSucceeded(key);
    const token = newToken();
    repo.createSession(tokenHash(token), u.id, u.roles[0]);
    return send(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
  }

  const { user, role, token } = auth(state, req);

  if (method === 'POST' && path === '/api/logout') {
    repo.deleteSession(tokenHash(token));
    return send(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }
  if (method === 'GET' && path === '/api/me') return send(res, 200, { user, actingRole: role, roleLabels: ROLE_LABELS });
  if (method === 'POST' && path === '/api/session/role') {
    const b = await readJson(req);
    const r = b.role as Role;
    if (!user.roles.includes(r)) throw new AccessError(403, 'Эта роль не назначена пользователю');
    repo.setSessionRole(tokenHash(token), r);
    return send(res, 200, { ok: true, actingRole: r });
  }
  if (method === 'GET' && path === '/api/team') return send(res, 200, repo.users().map((u) => ({ id: u.id, displayName: u.displayName, roles: u.roles })));
  if (method === 'GET' && path === '/api/companies') return send(res, 200, repo.companies().map((c) => ({ id: c.id, name: c.name, isDemo: c.isDemo })));
  if (method === 'POST' && path === '/api/companies') {
    const b = await readJson(req);
    return send(res, 201, svc.createCompany(user, role, String(b.name ?? '')));
  }
  if (method === 'GET' && path === '/api/dashboard') return send(res, 200, svc.dashboard(user, role));
  if (method === 'GET' && path === '/api/findings') return send(res, 200, svc.findingsRegistry(user, role));
  if (method === 'GET' && path === '/api/approvals') {
    if (role === 'specialist') throw new AccessError(403, 'Журнал утверждений недоступен специалисту');
    return send(res, 200, svc.approvalsJournal(user, role));
  }
  if (method === 'GET' && path === '/api/settings') {
    const s = repo.settings();
    if (role !== 'owner') return send(res, 200, { version: s.version, data: { targetMarginApproved: s.data.targetMarginApproved, presaleLimitApproved: s.data.presaleLimitApproved } });
    return send(res, 200, s);
  }
  if (method === 'PUT' && path === '/api/settings') {
    if (role !== 'owner') throw new AccessError(403, 'Настройки меняет владелец');
    const b = await readJson(req);
    const before = repo.settings();
    const version = repo.saveSettings(b.data as never, Number(b.expectedVersion));
    repo.appendEvents(null, [{ entityType: 'Settings', entityId: 'settings', action: 'updated', before: before.data, after: b.data, reason: (b.reason as string) ?? null }], user.id, role, new Date().toISOString(), false);
    return send(res, 200, { version });
  }

  if (path === '/api/opportunities') {
    if (method === 'GET') return send(res, 200, svc.list(user, role));
    if (method === 'POST') {
      const b = await readJson(req);
      return send(res, 201, svc.create(user, role, b as never));
    }
  }

  if (seg[1] === 'opportunities' && seg[2]) {
    const id = seg[2];
    if (method === 'GET' && seg.length === 3) {
      const v = svc.view(user, role, id);
      const company = repo.company(v.companyId);
      return send(res, 200, { ...v, companyName: company?.name ?? null, ownerDecisions: role === 'owner' ? svc.ownerDecisionsFor(repo.opportunity(id)!) : [] });
    }
    if (method === 'GET' && seg[3] === 'history') {
      const since = url.searchParams.get('since');
      const all = svc.history(user, role, id);
      return send(res, 200, since ? all.filter((e) => e.at > since) : all);
    }
    if (method === 'POST' && seg[3] === 'commands') {
      const b = await readJson(req);
      const r = svc.run(user, role, id, b.command as never, Number(b.expectedVersion));
      const company = repo.company(r.view.companyId);
      return send(res, 200, { ...r.view, companyName: company?.name ?? null, createdId: r.createdId, ownerDecisions: role === 'owner' ? svc.ownerDecisionsFor(repo.opportunity(id)!) : [] });
    }
    if (method === 'GET' && seg[3] === 'export') return exportRoute(state, res, user, role, id, seg.slice(4), url);
  }

  if (seg[1] === 'admin') {
    if (role !== 'owner') throw new AccessError(403, 'Администрирование доступно только владельцу');
    if (method === 'GET' && seg[2] === 'backup') {
      const b = repo.exportBackup();
      repo.appendEvents(null, [{ entityType: 'Backup', entityId: 'export', action: 'backup_exported', before: null, after: { exportedAt: b.exportedAt }, reason: null }], user.id, role, new Date().toISOString(), false);
      return attachment(res, `onair-crm-backup-${b.exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`, 'application/json', Buffer.from(JSON.stringify(b, null, 2)));
    }
    if (method === 'POST' && seg[2] === 'import' && seg[3] === 'preview') {
      const text = await readBody(req, MAX_BACKUP_BYTES + 1024);
      const p = validateBackupText(text);
      let token: string | null = null;
      if (p.ok && p.backup) {
        token = randomBytes(16).toString('hex');
        state.pendingImports.set(token, { backup: p.backup, userId: user.id, expires: Date.now() + 10 * 60_000 });
      }
      return send(res, 200, { ok: p.ok, errors: p.errors, warnings: p.warnings, counts: p.counts, token, note: 'Текущая база не изменена. Для замены нужно отдельное подтверждение' });
    }
    if (method === 'POST' && seg[2] === 'import' && seg[3] === 'confirm') {
      const b = await readJson(req);
      if (b.confirmText !== 'ЗАМЕНИТЬ БАЗУ') throw new HttpError(422, 'Для замены базы введите «ЗАМЕНИТЬ БАЗУ»');
      const pending = state.pendingImports.get(String(b.token ?? ''));
      if (!pending || pending.expires < Date.now() || pending.userId !== user.id) throw new HttpError(422, 'Предварительная проверка устарела — загрузите файл снова');
      state.pendingImports.delete(String(b.token));
      const archived = swapDatabase(state, pending.backup);
      return send(res, 200, { ok: true, archivedPreviousDb: archived, message: 'База заменена. Прежний файл базы сохранён' });
    }
    if (method === 'POST' && seg[2] === 'reset-demo') {
      const b = await readJson(req);
      if (b.confirmText !== 'ОЧИСТИТЬ ДЕМО') throw new HttpError(422, 'Для очистки демо-данных введите «ОЧИСТИТЬ ДЕМО»');
      repo.clearDemo();
      seedDemo(repo);
      repo.appendEvents(null, [{ entityType: 'DemoData', entityId: 'all', action: 'demo_reset', before: null, after: null, reason: 'Очистка только демо-записей и повторное наполнение' }], user.id, role, new Date().toISOString(), false);
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Маршрут не найден');
}

/** Восстановление в ОТДЕЛЬНЫЙ файл, проверка, затем замена. Прежняя база сохраняется рядом. */
function swapDatabase(state: AppState, backup: Backup): string | null {
  const hashes = new Map<string, string | null>();
  for (const u of state.repo.users()) hashes.set(u.id, state.repo.userByLogin(u.login)?.passwordHash ?? null);
  if (state.dbPath === ':memory:') {
    const db = openDb(':memory:');
    const repo = new Repo(db);
    repo.importInto(backup);
    for (const u of backup.users) repo.upsertUser(u, hashes.get(u.id) ?? null);
    state.db.close();
    Object.assign(state, { db, repo, svc: new Service(repo) });
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpPath = `${state.dbPath}.restore-${stamp}`;
  const db = openDb(tmpPath);
  const repo = new Repo(db);
  repo.importInto(backup);
  for (const u of backup.users) repo.upsertUser(u, hashes.get(u.id) ?? null);
  if (repo.opportunities().length !== backup.opportunities.length) throw new Error('Проверка восстановления не прошла: не совпадает число возможностей');
  db.close();
  state.db.close();
  const archived = `${state.dbPath}.before-import-${stamp}`;
  renameSync(state.dbPath, archived);
  renameSync(tmpPath, state.dbPath);
  const fresh = openDb(state.dbPath);
  const r = new Repo(fresh);
  Object.assign(state, { db: fresh, repo: r, svc: new Service(r) });
  return archived;
}

async function exportRoute(state: AppState, res: ServerResponse, user: User, role: Role, id: string, rest: string[], url: URL) {
  const { svc, repo } = state;
  svc.view(user, role, id); // проверка доступа к возможности (чужой ID → 404)
  const opp = repo.opportunity(id)!;
  const company = repo.company(opp.companyId)!;
  const log = (action: string, after: unknown) =>
    repo.appendEvents(id, [{ entityType: 'Export', entityId: id, action, before: null, after, reason: 'Локальный экспорт. Клиенту не отправлялось' }], user.id, role, new Date().toISOString(), opp.isDemo);
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const [kind, target] = rest;
  if (kind === 'proposal') {
    if (role !== 'owner' && role !== 'presale_pm') throw new AccessError(403, 'Экспорт КП доступен владельцу и проджекту');
    const p = opp.proposals.find((x) => x.id === target);
    if (!p) throw new AccessError(404, 'Версия КП не найдена');
    const data = exportClientProposal(opp, company, p);
    const format = url.searchParams.get('format') ?? 'json';
    log('client_proposal_generated', { version: p.number, status: p.status, format });
    if (format === 'json') return send(res, 200, data);
    if (format === 'docx') return attachment(res, `KP_${company.name}_v${p.number}${p.status === 'draft' ? '_CHERNOVIK' : ''}.docx`, DOCX, await proposalDocx(data));
    throw new HttpError(400, 'Неизвестный формат');
  }
  if (kind === 'handoff') {
    if (role !== 'owner' && role !== 'presale_pm' && role !== 'receiving_pm') throw new AccessError(403, 'Пакет передачи доступен владельцу, проджекту пресейла и принимающему проджекту');
    const data = exportHandoff(opp, company);
    if (!data) throw new HttpError(422, 'Нет принятой клиентом версии КП — пакет передачи строится только из неё');
    const format = url.searchParams.get('format') ?? 'json';
    log('handoff_package_generated', { version: data.terms.versionNumber, format });
    if (format === 'json') return send(res, 200, data);
    if (format === 'docx') return attachment(res, `Peredacha_${company.name}_KP_v${data.terms.versionNumber}.docx`, DOCX, await handoffDocx(data));
    throw new HttpError(400, 'Неизвестный формат');
  }
  if (kind === 'audit') {
    if (role !== 'owner' && role !== 'presale_pm' && role !== 'lead_specialist') throw new AccessError(403, 'Экспорт аудита недоступен для этой роли');
    if (target === 'client_json') return send(res, 200, exportClientAudit(opp, company, 'detailed'));
    const d = opp.audit.deliverables.find((x) => x.kind === target);
    if (!d) throw new HttpError(404, 'Документы полного аудита не предусмотрены: полный аудит не включён');
    if (!d.snapshotId) throw new HttpError(422, 'Сначала сохраните комплект документов аудита — файлы строятся из сохранённой версии');
    const snap = repo.snapshots().find((x) => x.id === d.snapshotId);
    if (!snap) throw new HttpError(404, 'Сохранённая версия документа не найдена');
    const data = snap.data as never;
    log('audit_document_downloaded', { kind: target, setNumber: d.setNumber });
    if (target === 'client_brief_pdf') return attachment(res, `Audit_vyzhimka_${company.name}_komplekt${d.setNumber}.pdf`, 'application/pdf', await auditBriefPdf(data));
    if (target === 'client_detailed_docx') return attachment(res, `Audit_klient_${company.name}_komplekt${d.setNumber}.docx`, DOCX, await auditDocx(data));
    if (target === 'internal_docx') return attachment(res, `Audit_vnutrenniy_${company.name}_komplekt${d.setNumber}.docx`, DOCX, await internalAuditDocx(data));
  }
  throw new HttpError(404, 'Неизвестный экспорт');
}

export { ensureUsers };
