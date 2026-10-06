import { useState } from 'react';
import { FACT_KEY_LABELS, SINGLE_KEYS, formatFactValue } from '../../../domain/labels';
import { formatKop, parseRubInput } from '../../../domain/money';
import type { BudgetStatus, Fact, FactStatus, ImpactArea, SingleFactKey } from '../../../domain/types';
import { FACT_STATUS_LABELS } from '../../../domain/types';
import type { TabProps } from '../OpportunityCard';
import { Badge, Check, Empty, ErrorBox, Field, fmtDate, fmtDateTime, Select, useAction, useApp } from '../../ui';

function FactRow({ f, v, run }: { f: Fact } & Pick<TabProps, 'v' | 'run'>) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<FactStatus>(f.status);
  const [reason, setReason] = useState('');
  const a = useAction();
  const src = v.sources.find((s) => s.id === f.sourceId);
  return (
    <tr>
      <td data-label="Поле">{FACT_KEY_LABELS[f.key]}{f.significant && <div><Badge>значимый</Badge></div>}</td>
      <td data-label="Значение">
        {formatFactValue(f.value)}
        {f.needsRecheck && <div><Badge kind="warn">Требует повторной проверки: {f.recheckReason}</Badge></div>}
        {f.excerpt && <div className="small muted">«{f.excerpt}»{f.timecode ? ` [${f.timecode}]` : ''}</div>}
      </td>
      <td data-label="Статус"><Badge kind={f.status === 'confirmed' ? 'ok' : f.status === 'needs_clarification' ? 'warn' : undefined}>{FACT_STATUS_LABELS[f.status]}</Badge></td>
      <td data-label="Источник">{src ? `${src.title} (v${src.version})` : 'ручной ввод'}{f.verifiedBy && <div className="small muted">проверено {fmtDateTime(f.verifiedAt)}</div>}</td>
      <td data-label="Действия">
        <button className="btn small" aria-expanded={open} onClick={() => setOpen(!open)}>Статус / история</button>
        {open && (
          <div className="stack" style={{ marginTop: 6, minWidth: 220 }}>
            <Select label="Статус доказанности" value={status} onChange={setStatus} options={Object.entries(FACT_STATUS_LABELS) as [FactStatus, string][]} />
            <Field label="Основание" value={reason} onChange={setReason} required />
            <button className="btn small primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'setFactStatus', payload: { factId: f.id, status, reason } }))}>Сохранить</button>
            <ErrorBox error={a.error} />
            <ul className="small">{f.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {h.action} · {h.reason ?? ''}</li>)}</ul>
          </div>
        )}
      </td>
    </tr>
  );
}

export function IntakeTab({ v, run }: TabProps) {
  const { session, team, teamName } = useApp();
  const single = [...SINGLE_KEYS] as SingleFactKey[];
  const multi = v.facts.filter((f) => !SINGLE_KEYS.has(f.key));
  const role = session.actingRole;
  const canEdit = role === 'owner' || role === 'presale_pm';
  return (
    <div className="stack">
      <ContinuationBlock v={v} run={run} />
      <section className="card">
        <h2>Сведения о задаче</h2>
        <p className="small muted">Поля заполняются постепенно из источников. Неизвестное остаётся неизвестным, а не нулём и не пустой строкой. Исходный запрос при создании: «{v.originalRequest}»</p>
        <div className="table-wrap">
          <table className="t stack-sm">
            <thead><tr><th>Поле</th><th>Значение</th><th>Статус</th><th>Источник</th><th></th></tr></thead>
            <tbody>
              {single.map((k) => {
                const f = v.facts.find((x) => x.key === k);
                return f ? <FactRow key={k} f={f} v={v} run={run} /> : (
                  <tr key={k}><td data-label="Поле">{FACT_KEY_LABELS[k]}</td><td data-label="Значение" className="muted">неизвестно</td><td /><td /><td /></tr>
                );
              })}
              {multi.map((f) => <FactRow key={f.id} f={f} v={v} run={run} />)}
            </tbody>
          </table>
        </div>
        <AddFact run={run} />
      </section>
      <BudgetBlock v={v} run={run} canEdit={canEdit} />
      <PromisesBlock v={v} run={run} />
      <ClarificationsBlock v={v} run={run} />
      <TasksBlock v={v} run={run} />
      <section className="card">
        <h2>Команда возможности</h2>
        <dl className="kv">
          <dt>Ответственный</dt><dd>{teamName(v.ownerUserId)}</dd>
          <dt>Проджект пресейла</dt><dd>{teamName(v.presalePmUserId)}</dd>
          <dt>Ведущий специалист</dt><dd>{teamName(v.leadSpecialistUserId)}</dd>
          <dt>Специалисты</dt><dd>{v.specialistUserIds.map(teamName).join(', ') || 'не назначены'}</dd>
          <dt>Принимающий проджект</dt><dd>{teamName(v.receivingPmUserId)}</dd>
        </dl>
        {canEdit && <TeamEdit v={v} run={run} team={team} />}
        {role === 'owner' && <PmVisibility v={v} run={run} />}
      </section>
    </div>
  );
}

function ContinuationBlock({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const [method, setMethod] = useState(v.continuation?.method ?? '');
  const [decision, setDecision] = useState<'enough_for_proposal' | 'offer_paid_diagnostic'>(v.readiness?.decision ?? 'enough_for_proposal');
  const [just, setJust] = useState(v.readiness?.justification ?? '');
  const a = useAction();
  const b = useAction();
  return (
    <section className="card">
      <h2>Как продолжаем</h2>
      <div className="grid two">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'setContinuation', payload: { method } })); }}>
          <Field label="Способ продолжить" value={method} onChange={setMethod} hint="Например: созвон, внешняя проверка, сразу оценка" required />
          <button className="btn" disabled={a.busy}>Сохранить способ</button>
          <ErrorBox error={a.error} />
        </form>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void b.run(() => run({ type: 'setReadiness', payload: { decision, justification: just } })); }}>
          <Select label="Решение по уточнению" value={decision} onChange={setDecision} options={[['enough_for_proposal', 'Данных достаточно для конкретного предложения'], ['offer_paid_diagnostic', 'Предлагаем платную диагностику']]} />
          <Field label="Обоснование" value={just} onChange={setJust} required />
          <button className="btn" disabled={b.busy}>Зафиксировать решение</button>
          <ErrorBox error={b.error} />
        </form>
      </div>
    </section>
  );
}

function AddFact({ run }: Pick<TabProps, 'run'>) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<SingleFactKey | 'risk' | 'unknown'>('risk');
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<FactStatus>('hypothesis');
  const a = useAction();
  return (
    <details className="disclosure" style={{ marginTop: 10 }} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Добавить сведение вручную</summary>
      <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'addFact', payload: { key, value, status, sourceId: null, excerpt: null } }); setValue(''); }); }}>
        <Select label="Поле" value={key} onChange={setKey} options={[...[...SINGLE_KEYS].map((k) => [k, FACT_KEY_LABELS[k]] as [SingleFactKey, string]), ['risk', 'Риск'], ['unknown', 'Неизвестное']]} />
        <Field label="Значение" value={value} onChange={setValue} required />
        <Select label="Статус" value={status} onChange={setStatus} options={Object.entries(FACT_STATUS_LABELS) as [FactStatus, string][]} />
        <div><button className="btn" disabled={a.busy}>Добавить</button></div>
        <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={a.error} /></div>
      </form>
    </details>
  );
}

function BudgetBlock({ v, run, canEdit }: Pick<TabProps, 'v' | 'run'> & { canEdit: boolean }) {
  const [status, setStatus] = useState<BudgetStatus>(v.budget.status);
  const [min, setMin] = useState(v.budget.minKop === null ? '' : String(v.budget.minKop / 100));
  const [max, setMax] = useState(v.budget.maxKop === null ? '' : String(v.budget.maxKop / 100));
  const [period, setPeriod] = useState(v.budget.period ?? '');
  const a = useAction();
  const mentions = v.facts.filter((f) => f.key === 'budget_mention');
  const label = { not_discussed: 'Не обсуждали', range: 'Диапазон', confirmed: 'Подтверждён' }[v.budget.status];
  return (
    <section className="card">
      <h2>Бюджет</h2>
      <p>Статус: <strong>{label}</strong>{v.budget.minKop !== null && ` · от ${formatKop(v.budget.minKop)}`}{v.budget.maxKop !== null && ` до ${formatKop(v.budget.maxKop)}`}{v.budget.period && ` · ${v.budget.period}`}</p>
      {mentions.length > 0 && <p className="small">Упоминания в источниках ({mentions.length}) — отдельные значения, не суммируются и не подтверждают бюджет. См. таблицу выше.</p>}
      {canEdit && (
        <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'updateBasics', payload: { budget: { status, minKop: min === '' ? null : parseRubInput(min), maxKop: max === '' ? null : parseRubInput(max), period: period || null, note: null } } })); }}>
          <Select label="Статус бюджета" value={status} onChange={setStatus} options={[['not_discussed', 'Не обсуждали'], ['range', 'Диапазон'], ['confirmed', 'Подтверждён']]} />
          <Field label="От, усл. ₽" value={min} onChange={setMin} hint="Пусто = неизвестно; 0 = подтверждённый ноль" />
          <Field label="До, усл. ₽" value={max} onChange={setMax} />
          <Field label="Период" value={period} onChange={setPeriod} hint="Например: в месяц, на первый тест" />
          <div><button className="btn" disabled={a.busy}>Сохранить бюджет</button></div>
          <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={a.error} /></div>
        </form>
      )}
    </section>
  );
}

function PromisesBlock({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const [what, setWhat] = useState('');
  const [byRole, setByRole] = useState('');
  const [conditional, setConditional] = useState(false);
  const a = useAction();
  const s = useAction();
  return (
    <section className="card">
      <h2>Обещания агентства</h2>
      <p className="small muted">Пожелания клиента сюда не попадают автоматически. Новое обещание получает статус «обсуждалось»; подтверждение — отдельное действие.</p>
      {v.promises.length === 0 ? <Empty>{v.promisesNotRecorded ? 'Обещания не зафиксированы' : 'Нет обещаний'}</Empty> : (
        <ul>
          {v.promises.map((p) => (
            <li key={p.id} style={{ marginBottom: 6 }}>
              {p.what} <Badge kind={p.status === 'confirmed' ? 'ok' : p.status === 'discussed' ? 'warn' : undefined}>{{ discussed: 'Обсуждалось', confirmed: 'Подтверждено', withdrawn: 'Отозвано' }[p.status]}</Badge>
              {p.conditional && <Badge>условное</Badge>} <span className="small muted">кто: {p.byRole}{p.sourceId ? ` · источник: ${v.sources.find((x) => x.id === p.sourceId)?.title}` : ''}</span>
              {p.status === 'discussed' && (
                <span className="row" style={{ display: 'inline-flex', marginLeft: 8 }}>
                  <button className="btn small" disabled={s.busy} onClick={() => void s.run(() => run({ type: 'setPromiseStatus', payload: { id: p.id, status: 'confirmed', reason: 'Подтверждено ответственным' } }))}>Подтвердить</button>
                  <button className="btn small" disabled={s.busy} onClick={() => void s.run(() => run({ type: 'setPromiseStatus', payload: { id: p.id, status: 'withdrawn', reason: 'Не является обязательством агентства' } }))}>Не обещание</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={s.error} />
      <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'addPromise', payload: { what, byRole, category: 'other', sourceId: null, conditional } }); setWhat(''); }); }}>
        <Field label="Что обещано" value={what} onChange={setWhat} required />
        <Field label="Кто обещал (роль)" value={byRole} onChange={setByRole} required />
        <div className="stack"><Check label="Условное высказывание" checked={conditional} onChange={setConditional} /><button className="btn" disabled={a.busy}>Добавить обещание</button></div>
        <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={a.error} /></div>
      </form>
    </section>
  );
}

const IMPACT_LABELS: Record<ImpactArea, string> = { route: 'маршрут', scope: 'состав', cost: 'стоимость', timeline: 'сроки', risk: 'риск', acceptance: 'приёмка' };

function ClarificationsBlock({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const [q, setQ] = useState('');
  const [to, setTo] = useState('');
  const a = useAction();
  const open = v.clarifications.filter((c) => c.status === 'open');
  return (
    <section className="card">
      <h2>Вопросы и неизвестное <span className="muted">({open.length} открыто)</span></h2>
      <p className="small muted">Только значимые вопросы: те, что меняют маршрут, состав, стоимость, сроки, риск или приёмку.</p>
      {v.clarifications.length === 0 ? <Empty>Вопросов нет</Empty> : (
        <ul>{v.clarifications.map((c) => <ClarItem key={c.id} c={c} run={run} />)}</ul>
      )}
      <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'addClarification', payload: { question: q, addressedToRole: to, impacts: ['scope'] } }); setQ(''); }); }}>
        <Field label="Вопрос" value={q} onChange={setQ} required />
        <Field label="Кому (роль)" value={to} onChange={setTo} hint="Например: Владелец данных клиента" required />
        <div><button className="btn" disabled={a.busy}>Добавить вопрос</button></div>
        <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={a.error} /></div>
      </form>
    </section>
  );
}

function ClarItem({ c, run }: { c: TabProps['v']['clarifications'][number]; run: TabProps['run'] }) {
  const [ans, setAns] = useState('');
  const a = useAction();
  return (
    <li style={{ marginBottom: 8 }}>
      <strong>{c.question}</strong> → {c.addressedToRole} {c.impacts.map((i) => <Badge key={i}>{IMPACT_LABELS[i]}</Badge>)}{' '}
      <Badge kind={c.status === 'open' ? 'warn' : 'ok'}>{{ open: 'Открыт', answered: 'Отвечен', dropped: 'Снят' }[c.status]}</Badge>
      {c.answer && <div className="small">Ответ: {c.answer}</div>}
      {c.status === 'open' && (
        <form className="row" style={{ marginTop: 4 }} onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'answerClarification', payload: { id: c.id, answer: ans, status: 'answered' } })); }}>
          <input type="text" aria-label={`Ответ на вопрос: ${c.question}`} value={ans} onChange={(e) => setAns(e.target.value)} style={{ maxWidth: 360 }} />
          <button className="btn small" disabled={a.busy}>Записать ответ</button>
          <button type="button" className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'answerClarification', payload: { id: c.id, answer: null, status: 'dropped' } }))}>Снять</button>
        </form>
      )}
      <ErrorBox error={a.error} />
    </li>
  );
}

function TasksBlock({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const { team, teamName } = useApp();
  const [title, setTitle] = useState('');
  const [who, setWho] = useState('');
  const [due, setDue] = useState('');
  const [blocker, setBlocker] = useState(false);
  const a = useAction();
  const s = useAction();
  return (
    <section className="card">
      <h2>Задачи и блокеры</h2>
      <p className="small muted">Ожидание оценки или решения владельца — это задача или блокер внутри стадии, а не отдельная колонка.</p>
      {v.tasks.length === 0 ? <Empty>Задач нет</Empty> : (
        <ul>
          {v.tasks.map((t) => (
            <li key={t.id}>
              {t.blocker && <Badge kind="warn">Блокер</Badge>} {t.title} · {teamName(t.assigneeUserId)}{t.due ? ` · до ${fmtDate(t.due)}` : ''} ·{' '}
              <Badge kind={t.status === 'done' ? 'ok' : undefined}>{{ open: 'Открыта', done: 'Выполнена', cancelled: 'Снята' }[t.status]}</Badge>
              {t.cancelledReason && <span className="small muted"> ({t.cancelledReason})</span>}
              {t.status === 'open' && <button className="btn small" style={{ marginLeft: 6 }} disabled={s.busy} onClick={() => void s.run(() => run({ type: 'setTaskStatus', payload: { id: t.id, status: 'done' } }))}>Выполнена</button>}
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={s.error} />
      <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'addTask', payload: { title, assigneeUserId: who || null, role: null, due: due || null, blocker, kind: 'other' } }); setTitle(''); }); }}>
        <Field label="Задача" value={title} onChange={setTitle} required />
        <Select label="Исполнитель" value={who} onChange={setWho} placeholder="не назначен" options={team.map((t) => [t.id, t.displayName])} />
        <Field label="Срок" type="date" value={due} onChange={setDue} />
        <Check label="Это блокер" checked={blocker} onChange={setBlocker} />
        <div><button className="btn" disabled={a.busy}>Добавить задачу</button></div>
        <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={a.error} /></div>
      </form>
    </section>
  );
}

function TeamEdit({ v, run, team }: Pick<TabProps, 'v' | 'run'> & { team: { id: string; displayName: string; roles: string[] }[] }) {
  const [pm, setPm] = useState(v.presalePmUserId ?? '');
  const [lead, setLead] = useState(v.leadSpecialistUserId ?? '');
  const [rpm, setRpm] = useState(v.receivingPmUserId ?? '');
  const [specs, setSpecs] = useState<string[]>(v.specialistUserIds);
  const a = useAction();
  const by = (r: string) => team.filter((t) => t.roles.includes(r)).map((t) => [t.id, t.displayName] as [string, string]);
  return (
    <details className="disclosure" style={{ marginTop: 10 }}>
      <summary>Изменить назначения</summary>
      <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'updateBasics', payload: { presalePmUserId: pm || null, leadSpecialistUserId: lead || null, receivingPmUserId: rpm || null, specialistUserIds: specs } })); }}>
        <Select label="Проджект пресейла" value={pm} onChange={setPm} placeholder="не назначен" options={by('presale_pm')} />
        <Select label="Ведущий специалист" value={lead} onChange={setLead} placeholder="не назначен" options={by('lead_specialist')} />
        <Select label="Принимающий проджект" value={rpm} onChange={setRpm} placeholder="не назначен" options={by('receiving_pm')} />
        <fieldset><legend className="small"><strong>Специалисты</strong></legend>
          {by('specialist').map(([id, name]) => <Check key={id} label={name} checked={specs.includes(id)} onChange={(c) => setSpecs(c ? [...specs, id] : specs.filter((x) => x !== id))} />)}
        </fieldset>
        <div><button className="btn" disabled={a.busy}>Сохранить назначения</button></div>
        <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={a.error} /></div>
      </form>
    </details>
  );
}

function PmVisibility({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const [comment, setComment] = useState('');
  const a = useAction();
  return (
    <div className="notice" style={{ marginTop: 10 }}>
      <strong>Видимость внутренних затрат для PM:</strong> {v.pmCostVisibility ? 'разрешена владельцем' : 'скрыта (по умолчанию)'}.
      <p className="small">Это решение владельца, а не доступ всей команды по умолчанию. Сервер скрывает ставки, себестоимость, маржу и комиссию для PM без разрешения.</p>
      <div className="row">
        <input type="text" aria-label="Комментарий к решению о видимости" placeholder="Комментарий к решению" value={comment} onChange={(e) => setComment(e.target.value)} style={{ maxWidth: 320 }} />
        <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'setPmCostVisibility', payload: { visible: !v.pmCostVisibility, comment } }))}>
          {v.pmCostVisibility ? 'Скрыть от PM' : 'Разрешить PM видеть'}
        </button>
      </div>
      <ErrorBox error={a.error} />
    </div>
  );
}
