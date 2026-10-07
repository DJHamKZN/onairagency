import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ROUTE_LABELS, STAGE_LABELS, WORK_STAGES } from '../../domain/stages';
import type { Stage } from '../../domain/types';
import type { ListItem } from '../types';
import { isWebDemo } from '../mode';
import { Badge, Empty, ErrorBox, Field, fmtDate, Select, useApp } from '../ui';

function Tile({ o, companies, today }: { o: ListItem; companies: Map<string, string>; today: string }) {
  const { teamName } = useApp();
  const overdue = o.nextStep.due < today && o.stage !== 'paused' && o.stage !== 'closed_lost' && o.stage !== 'handed_off';
  return (
    <a className={`opp-tile ${overdue ? 'overdue' : ''}`} href={`#/opp/${o.id}`}>
      <div className="t">{o.title}</div>
      <div className="small muted">{companies.get(o.companyId) ?? ''}</div>
      <div className="small">Шаг: {o.nextStep.text}</div>
      <div className="small">{teamName(o.nextStep.assigneeUserId)} · до {fmtDate(o.nextStep.due)} {overdue && <Badge kind="warn">Просрочено</Badge>}</div>
      <div className="row small" style={{ marginTop: 4 }}>
        {o.route && <Badge>Маршрут {o.route}</Badge>}
        {o.blockers > 0 && <Badge kind="warn">Блокеров: {o.blockers}</Badge>}
        {o.pendingChanges > 0 && <Badge>К разбору: {o.pendingChanges}</Badge>}
        {o.related.some((r) => r.relation === 'paid_diagnostic') && <Badge>Есть платная диагностика</Badge>}
        {o.related.some((r) => r.relation === 'implementation') && <Badge>Диагностика к внедрению</Badge>}
        {o.isDemo && <Badge kind="draft">демо</Badge>}
      </div>
    </a>
  );
}

function readPref(): 'board' | 'list' {
  try { return (localStorage.getItem('onair.listMode') as 'board' | 'list') || 'board'; } catch { return 'board'; }
}

export function OpportunityList() {
  const { team, session } = useApp();
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [companies, setCompanies] = useState(new Map<string, string>());
  const [err, setErr] = useState<unknown>(null);
  const [mode, setMode] = useState<'board' | 'list'>(readPref);
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [stage, setStage] = useState<'' | Stage>('');
  const [due, setDue] = useState<'' | 'overdue' | 'week'>('');
  const [route, setRoute] = useState('');
  const [blocker, setBlocker] = useState<'' | 'yes' | 'no'>('');
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    Promise.all([api.get<ListItem[]>('/api/opportunities'), api.get<{ id: string; name: string }[]>('/api/companies')]).then(([l, c]) => {
      setItems(l);
      setCompanies(new Map(c.map((x) => [x.id, x.name])));
    }, setErr);
  }, [session.actingRole]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const week = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    return items.filter((o) =>
      (!q || `${o.title} ${companies.get(o.companyId) ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
      (!owner || o.ownerUserId === owner || o.presalePmUserId === owner || o.nextStep.assigneeUserId === owner) &&
      (!stage || o.stage === stage) &&
      (!route || (route === 'none' ? !o.route : o.route === route)) &&
      (!blocker || (blocker === 'yes' ? o.blockers > 0 : o.blockers === 0)) &&
      (!due || (due === 'overdue' ? o.nextStep.due < today : o.nextStep.due >= today && o.nextStep.due <= week)),
    );
  }, [items, q, owner, stage, due, route, blocker, companies, today]);

  const setPref = (m: 'board' | 'list') => { setMode(m); try { localStorage.setItem('onair.listMode', m); } catch { /* недоступно */ } };

  if (err) return <ErrorBox error={err} />;
  if (!items) return <p>Загрузка…</p>;
  const side = filtered.filter((o) => o.stage === 'paused' || o.stage === 'closed_lost' || o.stage === 'handed_off');

  return (
    <>
      <div className="row">
        <h1>Возможности</h1>
        <div className="row right">
          <div role="group" aria-label="Вид" className="row" style={{ gap: 4 }}>
            <button className="btn small" aria-pressed={mode === 'board'} onClick={() => setPref('board')}>Доска</button>
            <button className="btn small" aria-pressed={mode === 'list'} onClick={() => setPref('list')}>Список</button>
          </div>
          <a className="btn primary" href="#/new">Новый запрос</a>
        </div>
      </div>
      <section className="card" aria-label="Фильтры">
        <div className="grid three">
          <Field label="Поиск" value={q} onChange={setQ} placeholder="Название или компания" />
          <Select label="Ответственный / исполнитель шага" value={owner} onChange={setOwner} placeholder="Все" options={team.map((t) => [t.id, t.displayName])} />
          <Select label="Стадия" value={stage} onChange={setStage} placeholder="Все" options={(Object.keys(STAGE_LABELS) as Stage[]).map((s) => [s, STAGE_LABELS[s]])} />
          <Select label="Срок шага" value={due} onChange={setDue} placeholder="Любой" options={[['overdue', 'Просрочен'], ['week', 'Ближайшие 7 дней']]} />
          <Select label="Маршрут" value={route} onChange={setRoute} placeholder="Любой" options={[['A', ROUTE_LABELS.A], ['B', ROUTE_LABELS.B], ['C', ROUTE_LABELS.C], ['none', 'Не выбран']]} />
          <Select label="Блокеры" value={blocker} onChange={setBlocker} placeholder="Неважно" options={[['yes', 'Есть блокеры'], ['no', 'Без блокеров']]} />
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Показано: {filtered.length} из {items.length}. {isWebDemo() ? 'Список отфильтрован по роли кодом в браузере (веб-демо, без защиты).' : 'Сервер возвращает только возможности, доступные вашей роли.'}</p>
      </section>
      {filtered.length === 0 && <Empty>Ничего не найдено. Измените фильтры или создайте новый запрос.</Empty>}
      {mode === 'board' && filtered.length > 0 && (
        <>
          <div className="board">
            {WORK_STAGES.map((s) => {
              const col = filtered.filter((o) => o.stage === s);
              return (
                <section className="col" key={s} aria-label={STAGE_LABELS[s]}>
                  <h3><span>{STAGE_LABELS[s]}</span><span className="muted">{col.length}</span></h3>
                  {col.length ? col.map((o) => <Tile key={o.id} o={o} companies={companies} today={today} />) : <p className="small muted">Пусто</p>}
                </section>
              );
            })}
          </div>
          {side.length > 0 && (
            <section className="card" style={{ marginTop: 12 }}>
              <h2>Пауза, закрытые и переданные</h2>
              <div className="grid three">{side.map((o) => <Tile key={o.id} o={o} companies={companies} today={today} />)}</div>
            </section>
          )}
        </>
      )}
      {mode === 'list' && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="t stack-sm">
            <thead><tr><th>Возможность</th><th>Стадия</th><th>Следующий шаг</th><th>Срок</th><th>Маршрут</th><th>Блокеры</th></tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td data-label="Возможность"><a href={`#/opp/${o.id}`}>{o.title}</a><div className="small muted">{companies.get(o.companyId)}</div></td>
                  <td data-label="Стадия">{STAGE_LABELS[o.stage]}</td>
                  <td data-label="Шаг">{o.nextStep.text}</td>
                  <td data-label="Срок">{fmtDate(o.nextStep.due)} {o.nextStep.due < today && <Badge kind="warn">Просрочено</Badge>}</td>
                  <td data-label="Маршрут">{o.route ?? 'не выбран'}</td>
                  <td data-label="Блокеры">{o.blockers ? <Badge kind="warn">{o.blockers}</Badge> : 'нет'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
