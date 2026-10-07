/**
 * Веб-демо: тот же API, что у локального сервера, но выполняется в браузере.
 * Перехватывает fetch('/api/...') и вызывает ту же доменную логику и тот же Service, что и сервер.
 * ОГРАНИЧЕНИЯ: нет паролей и защищённых сессий; роли и журнал не защищены от пользователя браузера;
 * данные хранятся только в этом браузере. Файлы (Word/PDF) не скачиваются — так устроена страница claude.ai.
 */
import { validateBackupText, type Backup } from '../domain/backup';
import { exportClientAudit, exportClientProposal, exportHandoff } from '../domain/clientExport';
import { DomainError } from '../domain/errors';
import { ConflictError } from '../domain/ids';
import type { Role, User } from '../domain/types';
import { ROLE_LABELS } from '../domain/types';
import { DEMO_USERS, seedDemoData } from '../../server/seedData';
import { AccessError, Service } from '../../server/service';
import { MemoryRepo } from './memoryRepo';

const DATA_KEY = 'onair-crm-webdemo-data-v1';
const SESSION_KEY = 'onair-crm-webdemo-session-v1';

export const demoState = { storageOk: true, restoredFromStorage: false, loadProblem: null as string | null };

function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    demoState.storageOk = false;
  }
}
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    demoState.storageOk = false;
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const repo = new MemoryRepo((r) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(DATA_KEY, r.exportBackup()), 50);
});
const svc = new Service(repo);
let session: { userId: string; role: Role } | null = null;
let pendingImport: { backup: Backup; token: string } | null = null;

function seedFresh() {
  repo.resetAll();
  for (const u of DEMO_USERS) repo.upsertUser(u, null);
  seedDemoData(repo);
}

function setNotice(text: string) {
  demoState.loadProblem = text;
  (globalThis as { __ONAIR_DEMO_NOTICE__?: string }).__ONAIR_DEMO_NOTICE__ = text;
}

function boot() {
  const raw = load(DATA_KEY);
  if (raw) {
    const p = validateBackupText(raw);
    if (p.ok && p.backup) {
      repo.importInto(p.backup); // сохраняет приведённую к текущей схеме копию
      demoState.restoredFromStorage = true;
      if (p.migrated.length)
        setNotice(
          `Данные, сохранённые прежней версией демо, приведены к текущей: карточек — ${p.migrated.length}. ` +
            'Прежние отметки чек-листа запуска сохранены во вкладке «Запуск» → «Отметки прежней версии», событие миграции — в истории карточки.',
        );
    } else {
      // Не перезаписываем непрочитанные данные: откладываем их под отдельным ключом, чтобы их можно было восстановить.
      const keep = `${DATA_KEY}-unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { localStorage.setItem(keep, raw); } catch { demoState.storageOk = false; }
      setNotice(
        `Сохранённые в браузере данные не прошли проверку (${p.errors.slice(0, 2).join('; ')}). Загружены исходные демо-данные; ` +
          `прежние данные не удалены — они лежат в хранилище браузера под ключом «${keep}».`,
      );
      seedFresh();
    }
  } else seedFresh();
  try {
    const s = JSON.parse(load(SESSION_KEY) ?? 'null');
    if (s && repo.userById(s.userId)?.roles.includes(s.role)) session = s;
  } catch { /* пустая сессия */ }
}

class HttpErr extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

function me(): { user: User; role: Role } {
  if (!session) throw new AccessError(401, 'Требуется вход');
  const user = repo.userById(session.userId);
  if (!user) throw new AccessError(401, 'Пользователь не найден');
  return { user, role: session.role };
}

const NO_FILES = 'В веб-демо файлы не скачиваются: страница claude.ai не разрешает загрузки. Используйте «Предпросмотр» или локальную версию (README)';

async function route(method: string, path: string, query: URLSearchParams, bodyText: string): Promise<Response> {
  const body = () => { try { return bodyText ? JSON.parse(bodyText) : {}; } catch { throw new HttpErr(400, 'Некорректный JSON в запросе'); } };
  const seg = path.split('/').filter(Boolean);

  if (path === '/api/health') return json(200, { ok: true, mode: 'web-demo' });
  if (method === 'POST' && path === '/api/login') {
    const u = repo.userByLogin(String(body().login ?? ''));
    if (!u) throw new AccessError(401, 'Неизвестная демо-учётная запись');
    session = { userId: u.id, role: u.roles[0] };
    save(SESSION_KEY, session);
    return json(200, { ok: true });
  }
  if (method === 'POST' && path === '/api/logout') { session = null; save(SESSION_KEY, null); return json(200, { ok: true }); }
  const { user, role } = me();
  if (method === 'GET' && path === '/api/me') return json(200, { user, actingRole: role, roleLabels: ROLE_LABELS });
  if (method === 'POST' && path === '/api/session/role') {
    const r = body().role as Role;
    if (!user.roles.includes(r)) throw new AccessError(403, 'Эта роль не назначена пользователю');
    session = { userId: user.id, role: r };
    save(SESSION_KEY, session);
    return json(200, { ok: true, actingRole: r });
  }
  if (method === 'GET' && path === '/api/team') return json(200, repo.users().map((u) => ({ id: u.id, displayName: u.displayName, roles: u.roles })));
  if (method === 'GET' && path === '/api/companies') return json(200, repo.companies().map((c) => ({ id: c.id, name: c.name, isDemo: c.isDemo })));
  if (method === 'POST' && path === '/api/companies') return json(201, svc.createCompany(user, role, String(body().name ?? '')));
  if (method === 'GET' && path === '/api/dashboard') return json(200, svc.dashboard(user, role));
  if (method === 'GET' && path === '/api/findings') return json(200, svc.findingsRegistry(user, role));
  if (method === 'GET' && path === '/api/approvals') {
    if (role === 'specialist') throw new AccessError(403, 'Журнал утверждений недоступен специалисту');
    return json(200, svc.approvalsJournal(user, role));
  }
  if (path === '/api/opportunities') {
    if (method === 'GET') return json(200, svc.list(user, role));
    if (method === 'POST') return json(201, svc.create(user, role, body()));
  }
  if (seg[1] === 'opportunities' && seg[2]) {
    const id = seg[2];
    const withExtras = (v: ReturnType<Service['view']>, createdId: string | null = null) => ({
      ...v, companyName: repo.company(v.companyId)?.name ?? null, createdId,
      ownerDecisions: role === 'owner' ? svc.ownerDecisionsFor(repo.opportunity(id)!) : [],
    });
    if (method === 'GET' && seg.length === 3) return json(200, withExtras(svc.view(user, role, id)));
    if (method === 'GET' && seg[3] === 'history') {
      const since = query.get('since');
      const all = svc.history(user, role, id);
      return json(200, since ? all.filter((e) => e.at > since) : all);
    }
    if (method === 'POST' && seg[3] === 'commands') {
      const b = body();
      const r = svc.run(user, role, id, b.command, Number(b.expectedVersion));
      return json(200, withExtras(r.view, r.createdId));
    }
    if (method === 'GET' && seg[3] === 'export') {
      svc.view(user, role, id);
      const opp = repo.opportunity(id)!;
      const company = repo.company(opp.companyId)!;
      const log = (action: string, after: unknown) =>
        repo.appendEvents(id, [{ entityType: 'Export', entityId: id, action, before: null, after, reason: 'Предпросмотр в веб-демо. Клиенту не отправлялось' }], user.id, role, new Date().toISOString(), opp.isDemo);
      const format = query.get('format') ?? 'json';
      if (seg[4] === 'proposal') {
        if (role !== 'owner' && role !== 'presale_pm') throw new AccessError(403, 'Экспорт КП доступен владельцу и проджекту');
        const p = opp.proposals.find((x) => x.id === seg[5]);
        if (!p) throw new AccessError(404, 'Версия КП не найдена');
        if (format !== 'json') throw new HttpErr(501, NO_FILES);
        log('client_proposal_previewed', { version: p.number, status: p.status });
        return json(200, exportClientProposal(opp, company, p));
      }
      if (seg[4] === 'handoff') {
        if (role !== 'owner' && role !== 'presale_pm' && role !== 'receiving_pm') throw new AccessError(403, 'Пакет передачи недоступен для этой роли');
        const data = exportHandoff(opp, company);
        if (!data) throw new HttpErr(422, 'Нет принятой клиентом версии КП — пакет передачи строится только из неё');
        if (format !== 'json') throw new HttpErr(501, NO_FILES);
        return json(200, data);
      }
      if (seg[4] === 'audit') {
        if (role !== 'owner' && role !== 'presale_pm' && role !== 'lead_specialist') throw new AccessError(403, 'Экспорт аудита недоступен для этой роли');
        if (seg[5] === 'client_json') return json(200, exportClientAudit(opp, company, 'detailed'));
      }
      throw new HttpErr(501, NO_FILES);
    }
  }
  if (seg[1] === 'admin') {
    if (role !== 'owner') throw new AccessError(403, 'Администрирование доступно только владельцу');
    if (method === 'GET' && seg[2] === 'backup') return json(200, repo.exportBackup());
    if (method === 'POST' && seg[2] === 'import' && seg[3] === 'preview') {
      const p = validateBackupText(bodyText);
      pendingImport = p.ok && p.backup ? { backup: p.backup, token: Math.random().toString(16).slice(2) } : null;
      return json(200, { ok: p.ok, errors: p.errors, warnings: p.warnings, counts: p.counts, token: pendingImport?.token ?? null, note: 'Текущие данные не изменены. Для замены нужно отдельное подтверждение' });
    }
    if (method === 'POST' && seg[2] === 'import' && seg[3] === 'confirm') {
      const b = body();
      if (b.confirmText !== 'ЗАМЕНИТЬ БАЗУ') throw new HttpErr(422, 'Для замены данных введите «ЗАМЕНИТЬ БАЗУ»');
      if (!pendingImport || pendingImport.token !== b.token) throw new HttpErr(422, 'Предварительная проверка устарела — загрузите файл снова');
      const previous = repo.exportBackup();
      try {
        repo.resetAll();
        repo.importInto(pendingImport.backup);
      } catch (e) {
        repo.resetAll();
        repo.importInto(previous);
        throw e;
      }
      for (const u of DEMO_USERS) if (!repo.userById(u.id)) repo.upsertUser(u, null);
      pendingImport = null;
      return json(200, { ok: true, archivedPreviousDb: null });
    }
    if (method === 'POST' && seg[2] === 'reset-demo') {
      if (body().confirmText !== 'ОЧИСТИТЬ ДЕМО') throw new HttpErr(422, 'Для очистки демо-данных введите «ОЧИСТИТЬ ДЕМО»');
      repo.clearDemo();
      for (const u of DEMO_USERS) repo.upsertUser(u, null);
      seedDemoData(repo);
      return json(200, { ok: true });
    }
  }
  throw new HttpErr(404, 'Маршрут не найден');
}

function toResponse(e: unknown): Response {
  if (e instanceof DomainError) return json(422, { error: e.code, message: e.message, missing: e.missing, field: e.field });
  if (e instanceof AccessError) return json(e.status, { error: 'access', message: e.message });
  if (e instanceof ConflictError) return json(409, { error: 'version_conflict', message: 'Карточку уже изменили. Обновите карточку и повторите действие', currentVersion: e.currentVersion });
  if (e instanceof HttpErr) return json(e.status, { error: 'http', message: e.message });
  console.error(e);
  return json(500, { error: 'internal', message: 'Внутренняя ошибка демо. Данные не изменены' });
}

export function installFakeApi() {
  boot();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    try {
      return await route(method, url.pathname, url.searchParams, bodyText);
    } catch (e) {
      return toResponse(e);
    }
  };
}
