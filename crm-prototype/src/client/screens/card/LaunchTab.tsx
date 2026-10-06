import { useState } from 'react';
import { CHECKLIST_LABELS, currentAcceptance, currentAuthorization, handoffBlockers, packageBlockers } from '../../../domain/launch';
import type { ChecklistItem, LaunchChecklist } from '../../../domain/types';
import type { TabProps } from '../OpportunityCard';
import { Badge, Demo, ErrorBox, Field, fmtDateTime, Select, useAction, useApp } from '../../ui';

const PAY_LABELS: Record<LaunchChecklist['payment']['status'], string> = {
  unknown: 'Не указан',
  paid_confirmed_manually: 'Оплачено — отметка вручную',
  deferred_by_terms: 'Отсрочка по условиям договора',
  not_required_by_terms: 'Предоплата не требуется по условиям',
};

export function LaunchTab({ v, run }: TabProps) {
  const { session, teamName } = useApp();
  const role = session.actingRole;
  const draft = v.stage !== 'preparing_launch' && v.stage !== 'handed_off';
  const pkg = packageBlockers(v);
  const all = handoffBlockers(v);
  const acc = currentAcceptance(v);
  const auth = currentAuthorization(v);
  const a = useAction();
  const [remarks, setRemarks] = useState('');
  return (
    <div className="stack">
      {draft && <div className="notice"><Badge kind="draft">Черновик</Badge> Пакет можно готовить заранее. Возможность сейчас не в стадии «Готовим запуск» — отметки здесь не переводят сделку вперёд.</div>}
      <Demo>«Оплачено» — ручная отметка, а не платёжная интеграция. В доступах храните ссылку на защищённое место и ответственного — не пароли.</Demo>
      <section className="card">
        <h2>Пакет передачи</h2>
        <div className="table-wrap">
          <table className="t stack-sm">
            <thead><tr><th>Пункт</th><th>Статус</th><th>Комментарий / где лежит / причина неприменимости</th><th></th></tr></thead>
            <tbody>{v.launch.items.map((i) => <ItemRow key={i.key} i={i} run={run} canEdit={role === 'owner' || role === 'presale_pm'} />)}</tbody>
          </table>
        </div>
        <Payment v={v} run={run} canEdit={role === 'owner' || role === 'presale_pm'} />
      </section>
      <section className="card" aria-labelledby="h-gates">
        <h2 id="h-gates">Отдельные события запуска</h2>
        <ol>
          <li>Утверждение экономики владельцем — во вкладке «КП и версии».</li>
          <li>Принятие клиентом определённой версии КП — там же.</li>
          <li>Готовность условий пакета: {pkg.length === 0 ? <Badge kind="ok">выполнены</Badge> : <Badge kind="warn">не выполнены: {pkg.length}</Badge>}</li>
          <li>Принятие пакета проджектом ({teamName(v.receivingPmUserId)}): {acc.valid ? <Badge kind="ok">«Проверил, принимаю» {fmtDateTime(acc.last?.at)}</Badge> : acc.last?.decision === 'returned' ? <Badge kind="warn">возвращён: {acc.last.remarks}</Badge> : acc.last ? <Badge kind="warn">пакет изменился после приёмки</Badge> : <Badge kind="warn">нет</Badge>}</li>
          <li>Разрешение запуска владельцем: {auth.valid ? <Badge kind="ok">{fmtDateTime(auth.last?.at)}</Badge> : <Badge kind="warn">{auth.last ? 'устарело — пакет или КП изменились' : 'нет'}</Badge>}</li>
        </ol>
        {v.launch.linkSharedAt && <p className="small">Ссылка на пакет передана {fmtDateTime(v.launch.linkSharedAt)}. Это не является приёмкой.</p>}
        {all.length > 0 && <div className="notice error"><strong>Почему нельзя «Передано в работу»:</strong><ul>{all.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
        <div className="row">
          {(role === 'owner' || role === 'presale_pm') && <button className="btn" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'recordLinkShared', payload: {} }))}>Отметить: ссылка передана</button>}
          {role === 'receiving_pm' && (<>
            <input type="text" aria-label="Замечания принимающего проджекта" placeholder="Замечания" value={remarks} onChange={(e) => setRemarks(e.target.value)} style={{ maxWidth: 320 }} />
            <button className="btn primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'handoffDecision', payload: { decision: 'accepted', remarks: remarks || null } }))}>Проверил, принимаю</button>
            <button className="btn" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'handoffDecision', payload: { decision: 'returned', remarks } }))}>Вернуть на исправление</button>
          </>)}
          {role === 'owner' && <button className="btn primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'authorizeLaunch', payload: { comment: null } }))}>Разрешить запуск</button>}
          {(role === 'owner' || role === 'presale_pm') && <button className="btn primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'handOff', payload: {} }))}>Передано в работу</button>}
        </div>
        <ErrorBox error={a.error} />
      </section>
    </div>
  );
}

function ItemRow({ i, run, canEdit }: { i: ChecklistItem; run: TabProps['run']; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  const [status, setStatus] = useState(i.status);
  const [note, setNote] = useState(i.note ?? '');
  const [na, setNa] = useState(i.naReason ?? '');
  const a = useAction();
  const err = a.error as { field?: string; message?: string } | null;
  return (
    <tr>
      <td data-label="Пункт">{CHECKLIST_LABELS[i.key]}</td>
      <td data-label="Статус"><Badge kind={i.status === 'done' ? 'ok' : i.status === 'open' ? 'warn' : undefined}>{{ open: 'Не выполнено', done: 'Выполнено', not_applicable: 'Неприменимо' }[i.status]}</Badge></td>
      <td data-label="Комментарий" className="small">{i.status === 'not_applicable' ? `Причина: ${i.naReason}` : i.note ?? '—'}</td>
      <td>
        {canEdit && <button className="btn small" aria-expanded={edit} onClick={() => setEdit(!edit)}>Изменить</button>}
        {edit && (
          <form className="stack" style={{ marginTop: 6, minWidth: 220 }} onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'setChecklistItem', payload: { key: i.key, status, note: note || null, naReason: na || null } }); setEdit(false); }); }}>
            <Select label="Статус" value={status} onChange={setStatus} options={[['open', 'Не выполнено'], ['done', 'Выполнено'], ['not_applicable', 'Неприменимо']]} />
            {status !== 'not_applicable' && <Field label="Что проверено / где лежит" value={note} onChange={setNote} error={err?.field === 'note' ? err.message : null} />}
            {status === 'not_applicable' && <Field label="Почему неприменимо" value={na} onChange={setNa} required error={err?.field === 'naReason' ? err.message : null} />}
            <button className="btn small primary" disabled={a.busy}>Сохранить</button>
            {err && !err.field && <ErrorBox error={a.error} />}
          </form>
        )}
      </td>
    </tr>
  );
}

function Payment({ v, run, canEdit }: Pick<TabProps, 'v' | 'run'> & { canEdit: boolean }) {
  const [status, setStatus] = useState(v.launch.payment.status);
  const [note, setNote] = useState(v.launch.payment.note ?? '');
  const a = useAction();
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <h3>Фактический статус условий оплаты</h3>
      <p>Сейчас: <strong>{PAY_LABELS[v.launch.payment.status]}</strong>{v.launch.payment.note && ` · ${v.launch.payment.note}`}</p>
      {canEdit && (
        <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'setPayment', payload: { status, note: note || null } })); }}>
          <Select label="Статус" value={status} onChange={setStatus} options={Object.entries(PAY_LABELS) as [LaunchChecklist['payment']['status'], string][]} />
          <Field label="Основание" value={note} onChange={setNote} hint="Например: «платёжка показана клиентом (демо)»" />
          <div><button className="btn" disabled={a.busy}>Сохранить</button></div>
        </form>
      )}
      <ErrorBox error={a.error} />
    </div>
  );
}
