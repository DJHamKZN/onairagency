import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isWebDemo } from './mode';
import { AppCtx, ErrorBox, Field, useAction, type Session, type TeamMember } from './ui';
import type { Role } from '../domain/types';
import { Dashboard } from './screens/Dashboard';
import { OpportunityList } from './screens/OpportunityList';
import { NewOpportunity } from './screens/NewOpportunity';
import { OpportunityCard } from './screens/OpportunityCard';
import { FindingsRegistry } from './screens/FindingsRegistry';
import { ApprovalsJournal } from './screens/ApprovalsJournal';
import { Admin } from './screens/Admin';

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function SimulationBanner() {
  if (isWebDemo())
    return (
      <div className="sim-banner" role="note" aria-label="Ограничения прототипа">
        <span className="long">
          <strong>Веб-демо прототипа на синтетических данных.</strong> Всё работает в вашем браузере: данные видите только вы и они могут
          пропасть при очистке браузера. Вход без пароля, роли и журнал не защищены. AI, почта, Drive, подписание и платежи не подключены:
          «отправка» и «оплата» — ручные отметки. Файлы Word/PDF здесь не скачиваются.
        </span>
        <span className="short">
          <strong>Веб-демо, синтетические данные.</strong> Данные только в этом браузере; роли не защищены; интеграции не подключены.
        </span>
      </div>
    );
  return (
    <div className="sim-banner" role="note" aria-label="Ограничения прототипа">
      <span className="long">
        <strong>Локальный прототип на синтетических данных.</strong> Не для реальных клиентских данных. AI, транскрибация, почта, Drive, календарь,
        подписание и платежи не подключены: «отправка» и «оплата» — ручные отметки. Вход и роли проверяются локальным сервером, но он не
        прошёл проверку безопасности и не готов к эксплуатации.
      </span>
      <span className="short">
        <strong>Прототип, синтетические данные.</strong> Интеграции не подключены; «отправка» и «оплата» — ручные отметки. Не для эксплуатации.
      </span>
    </div>
  );
}

const DEMO_LOGINS: [string, string][] = [
  ['owner', 'Владелец (+ проджект пресейла)'],
  ['pm', 'Проджект пресейла'],
  ['pm2', 'Проджект пресейла 2'],
  ['lead', 'Стратег / ведущий специалист'],
  ['spec', 'Специалист'],
  ['rpm', 'Принимающий проджект'],
];

function DemoLogin({ onDone }: { onDone: () => void }) {
  const a = useAction();
  return (
    <main>
      <div className="card" style={{ maxWidth: 520, margin: '32px auto' }}>
        <h1>ON AIR CRM</h1>
        <p>Выберите синтетическую роль. В веб-демо вход без пароля: это показ процесса, а не защищённая система.</p>
        <div className="stack">
          {DEMO_LOGINS.map(([login, label]) => (
            <button key={login} className="btn" style={{ width: '100%', textAlign: 'left' }} disabled={a.busy}
              onClick={() => void a.run(async () => { await api.post('/api/login', { login }); onDone(); })}>
              Войти: {label} <span className="muted small">({login})</span>
            </button>
          ))}
        </div>
        <ErrorBox error={a.error} />
        <p className="muted small" style={{ marginTop: 10 }}>Начать удобнее с роли «Владелец» и кейса «Контур Образец». Текстовый заголовок — не логотип.</p>
      </div>
    </main>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  if (isWebDemo()) return <DemoLogin onDone={onDone} />;
  return <PasswordLogin onDone={onDone} />;
}

function PasswordLogin({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState('owner');
  const [password, setPassword] = useState('');
  const a = useAction();
  return (
    <main>
      <div className="card" style={{ maxWidth: 460, margin: '32px auto' }}>
        <h1>ON AIR CRM</h1>
        <p className="muted small">Текстовый заголовок, не логотип. Официальный файл логотипа не предоставлен.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              await api.post('/api/login', { login, password });
              onDone();
            });
          }}
        >
          <Field label="Логин" value={login} onChange={setLogin} hint="Синтетические учётные записи: owner, pm, pm2, lead, spec, rpm" required />
          <Field label="Пароль" type="password" value={password} onChange={setPassword} hint="Задаётся в .env (DEMO_USER_PASSWORD) или печатается сервером при первом запуске" required />
          <ErrorBox error={a.error} />
          <button className="btn primary" disabled={a.busy}>Войти</button>
        </form>
      </div>
    </main>
  );
}

const NAV: [string, string][] = [
  ['#/', 'Обзор'],
  ['#/opps', 'Возможности'],
  ['#/findings', 'Реестр находок'],
  ['#/approvals', 'Журнал утверждений'],
  ['#/admin', 'Данные и настройки'],
];

export function App() {
  const hash = useHash();
  const [session, setSession] = useState<Session | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [state, setState] = useState<'loading' | 'anon' | 'ready'>('loading');
  const [roleError, setRoleError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<Session>('/api/me');
      setSession(me);
      setTeam(await api.get<TeamMember[]>('/api/team'));
      setState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('anon');
      else throw e;
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (state === 'loading') return (<><SimulationBanner /><main><p>Загрузка…</p></main></>);
  if (state === 'anon' || !session) return (<><SimulationBanner /><Login onDone={() => void refresh()} /></>);

  const teamName = (id: string | null | undefined) => (id ? team.find((t) => t.id === id)?.displayName ?? id : 'не назначен');
  const parts = hash.replace(/^#\/?/, '').split('/');
  let screen;
  if (parts[0] === 'opps') screen = <OpportunityList />;
  else if (parts[0] === 'new') screen = <NewOpportunity />;
  else if (parts[0] === 'opp' && parts[1]) screen = <OpportunityCard key={`${parts[1]}:${session.actingRole}`} id={parts[1]} tab={parts[2] ?? 'summary'} />;
  else if (parts[0] === 'findings') screen = <FindingsRegistry />;
  else if (parts[0] === 'approvals') screen = <ApprovalsJournal />;
  else if (parts[0] === 'admin') screen = <Admin />;
  else screen = <Dashboard />;
  const current = '#/' + (parts[0] === 'opp' || parts[0] === 'new' ? 'opps' : parts[0]);

  return (
    <AppCtx.Provider value={{ session, team, teamName, refreshSession: () => void refresh() }}>
      <SimulationBanner />
      <header className="topbar">
        <span className="brand">ON AIR CRM<small>прототип</small></span>
        <nav className="main" aria-label="Основная навигация">
          {NAV.map(([href, label]) => (
            <a key={href} href={href} aria-current={current === href || (href === '#/' && current === '#/') ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
        <div className="who">
          <span>{session.user.displayName}</span>
          <label className="row small" style={{ gap: 4 }}>
            <span>Действую как:</span>
            <select
              aria-label="Роль в текущих действиях"
              value={session.actingRole}
              onChange={async (e) => {
                setRoleError(null);
                try {
                  await api.post('/api/session/role', { role: e.target.value as Role });
                  await refresh();
                } catch (err) { setRoleError(err); }
              }}
              style={{ width: 'auto' }}
            >
              {session.user.roles.map((r) => <option key={r} value={r}>{session.roleLabels[r]}</option>)}
            </select>
          </label>
          <button className="btn small" onClick={async () => { await api.post('/api/logout'); setState('anon'); setSession(null); }}>Выйти</button>
        </div>
      </header>
      <main>
        <ErrorBox error={roleError} />
        {screen}
      </main>
    </AppCtx.Provider>
  );
}
