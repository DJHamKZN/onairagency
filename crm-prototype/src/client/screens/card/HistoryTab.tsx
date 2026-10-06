import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { ChangeEvent } from '../../../domain/types';
import type { TabProps } from '../OpportunityCard';
import { Empty, ErrorBox, fmtDateTime, useApp } from '../../ui';

const short = (x: unknown) => {
  if (x === null || x === undefined) return '—';
  const s = typeof x === 'string' ? x : JSON.stringify(x);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
};

export function HistoryTab({ v }: TabProps) {
  const { teamName, session } = useApp();
  const [ev, setEv] = useState<ChangeEvent[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState('');
  useEffect(() => { api.get<ChangeEvent[]>(`/api/opportunities/${v.id}/history`).then(setEv, setErr); }, [v.id, v.rev]);
  if (err) return <ErrorBox error={err} />;
  if (!ev) return <p>Загрузка истории…</p>;
  const list = [...ev].reverse().filter((e) => !q || `${e.entityType} ${e.action} ${e.reason ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="card">
      <h2>История изменений</h2>
      <p className="small muted">Журнал только дополняется (запрет UPDATE/DELETE на уровне БД). Хранит прежнее и новое значение, автора, роль в действии, время и причину. Секреты вырезаются.{session.actingRole !== 'owner' && ' Экономические значения скрыты для вашей роли.'}</p>
      <input type="text" aria-label="Фильтр истории" placeholder="Фильтр: действие, сущность, причина" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360, marginBottom: 8 }} />
      {list.length === 0 ? <Empty>Нет событий</Empty> : (
        <div className="table-wrap">
          <table className="t stack-sm">
            <thead><tr><th>Когда</th><th>Кто / роль</th><th>Что</th><th>Было → стало</th><th>Причина</th></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id}>
                <td data-label="Когда" className="small">{fmtDateTime(e.at)}</td>
                <td data-label="Кто" className="small">{teamName(e.userId)}<div className="muted">{e.actingRole}</div></td>
                <td data-label="Что" className="small">{e.entityType} · {e.action}{e.override && <strong> · ОБХОД ОГРАНИЧЕНИЯ</strong>}</td>
                <td data-label="Было → стало" className="small mono">{short(e.before)} → {short(e.after)}</td>
                <td data-label="Причина" className="small">{e.reason ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
