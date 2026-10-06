import { useEffect, useState } from 'react';
import { api } from '../api';
import { STAGE_LABELS } from '../../domain/stages';
import type { ListItem } from '../types';
import { Badge, Empty, ErrorBox, fmtDate, useApp } from '../ui';

interface Dash { today: string; needsAction: ListItem[]; overdue: ListItem[]; blocked: ListItem[]; ownerDecisions: ListItem[]; upcoming: ListItem[]; pausedReturning: ListItem[] }

export function OppLine({ o, extra }: { o: ListItem; extra?: React.ReactNode }) {
  const { teamName } = useApp();
  return (
    <li style={{ marginBottom: 8 }}>
      <a href={`#/opp/${o.id}`}><strong>{o.title}</strong></a>{' '}
      <Badge>{STAGE_LABELS[o.stage]}</Badge>
      <div className="small">
        Следующий шаг: {o.nextStep.text} · {teamName(o.nextStep.assigneeUserId)} · до {fmtDate(o.nextStep.due)}
      </div>
      {extra}
    </li>
  );
}

function Block({ title, items, empty, extra }: { title: string; items: ListItem[]; empty: string; extra?: (o: ListItem) => React.ReactNode }) {
  return (
    <section className="card" aria-labelledby={`h-${title}`}>
      <h2 id={`h-${title}`}>{title} <span className="muted">({items.length})</span></h2>
      {items.length ? <ul style={{ paddingLeft: 18, margin: 0 }}>{items.map((o) => <OppLine key={o.id} o={o} extra={extra?.(o)} />)}</ul> : <Empty>{empty}</Empty>}
    </section>
  );
}

export function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const { session } = useApp();
  useEffect(() => { api.get<Dash>('/api/dashboard').then(setD, setErr); }, [session.actingRole]);
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Загрузка…</p>;
  return (
    <>
      <div className="row"><h1>Рабочий обзор</h1><span className="muted">на {fmtDate(d.today)}</span><a className="btn primary right" href="#/new">Новый запрос</a></div>
      <div className="grid two">
        <Block title="Требуют действия" items={d.needsAction} empty="Нет возможностей, где следующий шаг за вами или ждут разбора изменений"
          extra={(o) => (o.pendingChanges ? <Badge kind="warn">Предложенных изменений к разбору: {o.pendingChanges}</Badge> : null)} />
        <Block title="Просроченные шаги" items={d.overdue} empty="Просроченных шагов нет" extra={() => <Badge kind="warn">Просрочено</Badge>} />
        <Block title="С блокерами" items={d.blocked} empty="Блокеров нет" extra={(o) => <Badge kind="warn">Блокеров: {o.blockers}</Badge>} />
        {session.actingRole === 'owner' && (
          <Block title="Ждут решения владельца" items={d.ownerDecisions} empty="Решений не ждут"
            extra={(o) => <ul className="small">{o.ownerDecisions.map((x) => <li key={x}>{x}</li>)}</ul>} />
        )}
        <Block title="Ближайшие сроки (7 дней)" items={d.upcoming} empty="В ближайшую неделю сроков нет" />
        <Block title="Возврат с паузы (7 дней)" items={d.pausedReturning} empty="Нет возможностей, возвращающихся с паузы" />
      </div>
    </>
  );
}
