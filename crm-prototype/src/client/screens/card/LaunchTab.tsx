import { useState } from 'react';
import { api, download } from '../../api';
import type { HandoffExport } from '../../../domain/clientExport';
import { CHECKLIST_STATUS_LABELS, checklistLabel, checklistStatusLabel, currentAcceptance, currentAuthorization, handoffBlockers, packageBlockers } from '../../../domain/launch';
import { formatKop } from '../../../domain/money';
import type { ChecklistItem, ChecklistStatus, LaunchChecklist } from '../../../domain/types';
import { isWebDemo } from '../../mode';
import type { TabProps } from '../OpportunityCard';
import { Badge, Demo, ErrorBox, Field, fmtDate, fmtDateTime, Select, useAction, useApp } from '../../ui';

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
  const canEdit = role === 'owner' || role === 'presale_pm';
  return (
    <div className="stack">
      {draft && <div className="notice"><Badge kind="draft">Черновик</Badge> Проверки можно готовить заранее. Возможность сейчас не в стадии «Готовим запуск» — отметки здесь не переводят сделку вперёд.</div>}
      <Demo>«Оплачено» — ручная отметка, а не платёжная интеграция. В доступах храните ссылку на защищённое место и ответственного — не пароли.</Demo>
      <AgreedTermsBlock v={v} />
      <section className="card">
        <h2>Проверка готовности</h2>
        <p className="small muted">Проджект не переписывает договорённости: он отмечает готовность и фиксирует отклонения. Если отклонение меняет условия (объём, цену, сроки, исключения), нужна новая версия КП с повторным согласованием.</p>
        <div className="table-wrap">
          <table className="t stack-sm">
            <thead><tr><th>Проверка</th><th>Статус</th><th>Комментарий / отклонение / причина</th><th></th></tr></thead>
            <tbody>{v.launch.items.map((i) => <ItemRow key={i.key + i.status} i={i} run={run} canEdit={canEdit} owner={role === 'owner'} />)}</tbody>
          </table>
        </div>
        <Payment v={v} run={run} canEdit={canEdit} />
        <LegacyItems v={v} />
      </section>
      <section className="card" aria-labelledby="h-gates">
        <h2 id="h-gates">Отдельные события запуска</h2>
        <ol>
          <li>Утверждение экономики владельцем — во вкладке «КП и версии».</li>
          <li>Принятие клиентом конкретной версии КП — там же.</li>
          <li>Готовность условий пакета: {pkg.length === 0 ? <Badge kind="ok">выполнены</Badge> : <Badge kind="warn">не выполнены: {pkg.length}</Badge>}</li>
          <li>Принятие пакета проджектом ({teamName(v.receivingPmUserId)}): {acc.valid ? <Badge kind="ok">«Проверил, принимаю» {fmtDateTime(acc.last?.at)}</Badge> : acc.last?.decision === 'returned' ? <Badge kind="warn">возвращён: {acc.last.remarks}</Badge> : acc.last ? <Badge kind="warn">пакет изменился после приёмки</Badge> : <Badge kind="warn">нет</Badge>}</li>
          <li>Разрешение запуска владельцем: {auth.valid ? <Badge kind="ok">{fmtDateTime(auth.last?.at)}</Badge> : <Badge kind="warn">{auth.last ? 'устарело — пакет или КП изменились' : 'нет'}</Badge>}</li>
        </ol>
        {v.launch.linkSharedAt && <p className="small">Ссылка на пакет передана {fmtDateTime(v.launch.linkSharedAt)}. Это не является приёмкой.</p>}
        {all.length > 0 && <div className="notice error"><strong>Почему нельзя «Передано в работу»:</strong><ul>{all.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
        <div className="row">
          {canEdit && <button className="btn" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'recordLinkShared', payload: {} }))}>Отметить: ссылка передана</button>}
          {role === 'receiving_pm' && (<>
            <input type="text" aria-label="Замечания принимающего проджекта" placeholder="Замечания" value={remarks} onChange={(e) => setRemarks(e.target.value)} style={{ maxWidth: 320 }} />
            <button className="btn primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'handoffDecision', payload: { decision: 'accepted', remarks: remarks || null } }))}>Проверил, принимаю</button>
            <button className="btn" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'handoffDecision', payload: { decision: 'returned', remarks } }))}>Вернуть на исправление</button>
          </>)}
          {role === 'owner' && <button className="btn primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'authorizeLaunch', payload: { comment: null } }))}>Разрешить запуск</button>}
          {canEdit && <button className="btn primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'handOff', payload: {} }))}>Передано в работу</button>}
        </div>
        <ErrorBox error={a.error} />
      </section>
    </div>
  );
}

function AgreedTermsBlock({ v }: { v: TabProps['v'] }) {
  const t = v.handoffTerms;
  const { session } = useApp();
  const [preview, setPreview] = useState<HandoffExport | null>(null);
  const a = useAction();
  const canExport = ['owner', 'presale_pm', 'receiving_pm'].includes(session.actingRole);
  if (!t)
    return (
      <section className="card">
        <h2>Договорённости для передачи</h2>
        <p>Появятся автоматически, когда клиент примет конкретную версию КП. Вручную их вводить не нужно.</p>
      </section>
    );
  return (
    <section className="card">
      <div className="row"><h2>Договорённости из принятой КП v{t.versionNumber}</h2><Badge>только чтение</Badge></div>
      <p className="small muted">Принято {fmtDate(t.acceptedDate)}, подтверждение: {t.confirmationSource}. Данные взяты из зафиксированной версии — те же, что в клиентском КП.</p>
      <div className="table-wrap">
        <table className="t stack-sm">
          <thead><tr><th>Работа</th><th>Объём</th><th>Результат</th><th>Приёмка</th><th>Тип</th></tr></thead>
          <tbody>{t.works.map((w) => (
            <tr key={w.id}><td data-label="Работа">{w.title}</td><td data-label="Объём">{w.quantity} {w.unit}</td><td data-label="Результат">{w.expectedResult}</td><td data-label="Приёмка">{w.acceptanceCriterion}</td><td data-label="Тип">{w.recurrence === 'monthly' ? 'Ежемесячная' : 'Разовая'}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Результат и приёмка</dt><dd>{t.resultAndAcceptance ?? '—'}</dd>
        <dt>Исключения</dt><dd>{t.exclusions ?? '—'}</dd>
        <dt>Правки</dt><dd>{t.revisions ?? '—'}</dd>
        <dt>Сроки</dt><dd>{t.timeline ?? '—'}</dd>
        <dt>Зависимости</dt><dd>{t.dependencies ?? '—'}</dd>
        <dt>Действия клиента</dt><dd>{t.clientActions ?? '—'}</dd>
        <dt>Оплата</dt><dd>{t.payment ?? '—'}</dd>
        <dt>Цена услуг</dt><dd>{t.serviceOneTimeKop !== null && <>Разовые работы: {formatKop(t.serviceOneTimeKop)}</>}{t.serviceMonthlyKop !== null && <div>Ежемесячные работы: {formatKop(t.serviceMonthlyKop)} в месяц</div>}</dd>
        <dt>Рекламный бюджет и внешние расходы клиента</dt><dd>{t.externalBudgets.map((b) => `${b.label}: ${formatKop(b.amountKop)} (${b.paidBy})`).join('; ') || 'нет'}</dd>
        <dt>Подтверждённые обещания</dt><dd>{t.confirmedPromises.map((p) => p.what).join('; ') || 'нет'}</dd>
      </dl>
      {canExport && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" disabled={a.busy} onClick={() => void a.run(async () => setPreview(await api.get<HandoffExport>(`/api/opportunities/${v.id}/export/handoff?format=json`)))}>Предпросмотр пакета передачи</button>
          {!isWebDemo() && <button className="btn" disabled={a.busy} onClick={() => void a.run(() => download(`/api/opportunities/${v.id}/export/handoff?format=docx`))}>Пакет передачи (Word)</button>}
        </div>
      )}
      <ErrorBox error={a.error} />
      {preview && (
        <div className="card" style={{ marginTop: 8, background: 'var(--zebra)' }} aria-label="Предпросмотр пакета передачи">
          <strong>{preview.documentType} — {preview.company}</strong>
          <p className="small">Из КП v{preview.terms.versionNumber}. Проверки: {preview.checks.filter((c) => c.status === 'Готово').length} из {preview.checks.length} готово. Статус оплаты: {preview.paymentStatus}.</p>
          {preview.blockers.length > 0 && <ul className="small">{preview.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}

/** Отметки прежней версии чек-листа, перенесённые при миграции данных. Только чтение, в условия запуска не входят. */
function LegacyItems({ v }: { v: TabProps['v'] }) {
  const { teamName } = useApp();
  const items = v.launch.legacyItems ?? [];
  if (!items.length) return null;
  return (
    <details className="legacy" style={{ marginTop: 12 }}>
      <summary>Отметки прежней версии чек-листа ({items.length}) — сохранены при обновлении {fmtDate(items[0].migratedAt)}</summary>
      <p className="small muted">Этих пунктов больше нет в проверке готовности: их смысл теперь находится в другом месте (см. колонку «Где теперь»). Отметки показаны для истории и не влияют на запуск.</p>
      <div className="table-wrap">
        <table className="t stack-sm">
          <thead><tr><th>Пункт (прежний)</th><th>Отметка</th><th>Комментарий</th><th>Кто и когда</th><th>Где теперь</th></tr></thead>
          <tbody>
            {items.map((l, idx) => (
              <tr key={l.key + idx}>
                <td data-label="Пункт">{l.label}</td>
                <td data-label="Отметка">{checklistStatusLabel(l.status)}</td>
                <td data-label="Комментарий">{l.status === 'not_applicable' ? l.naReason ?? '—' : l.note ?? '—'}</td>
                <td data-label="Кто и когда">{l.updatedBy ? `${teamName(l.updatedBy)}, ${fmtDateTime(l.updatedAt)}` : '—'}</td>
                <td data-label="Где теперь">{l.nowCoveredBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ItemRow({ i, run, canEdit, owner }: { i: ChecklistItem; run: TabProps['run']; canEdit: boolean; owner: boolean }) {
  const [edit, setEdit] = useState(false);
  const [status, setStatus] = useState<Exclude<ChecklistStatus, 'deviation_accepted'>>(i.status === 'deviation_accepted' ? 'deviation' : i.status);
  const [note, setNote] = useState(i.note ?? '');
  const [na, setNa] = useState(i.naReason ?? '');
  const [reason, setReason] = useState('');
  const a = useAction();
  const err = a.error as { field?: string; message?: string } | null;
  return (
    <tr>
      <td data-label="Проверка">{checklistLabel(i.key)}</td>
      <td data-label="Статус"><Badge kind={i.status === 'ready' ? 'ok' : i.status === 'open' || i.status === 'deviation' ? 'warn' : undefined}>{checklistStatusLabel(i.status)}</Badge></td>
      <td data-label="Комментарий" className="small">
        {i.status === 'not_applicable' ? `Причина: ${i.naReason}` : i.note ?? '—'}
        {i.deviationDecision && <div>Решение владельца: {i.deviationDecision.reason}</div>}
      </td>
      <td>
        {canEdit && <button className="btn small" aria-expanded={edit} onClick={() => setEdit(!edit)}>Отметить</button>}
        {owner && i.status === 'deviation' && (
          <form className="row" style={{ marginTop: 4 }} onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'decideDeviation', payload: { key: i.key, reason } })); }}>
            <input type="text" aria-label={`Почему отклонение допустимо: ${checklistLabel(i.key)}`} placeholder="почему допустимо" value={reason} onChange={(e) => setReason(e.target.value)} style={{ maxWidth: 180 }} />
            <button className="btn small">Принять как риск</button>
          </form>
        )}
        {edit && (
          <form className="stack" style={{ marginTop: 6, minWidth: 220 }} onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'setChecklistItem', payload: { key: i.key, status, note: note || null, naReason: na || null } }); setEdit(false); }); }}>
            <Select label="Статус" value={status} onChange={setStatus} options={[['open', 'Не проверено'], ['ready', 'Готово'], ['deviation', 'Отклонение'], ['not_applicable', 'Неприменимо']]} />
            {status !== 'not_applicable' && <Field label={status === 'deviation' ? 'Что не совпадает или не готово' : 'Комментарий (необязательно)'} value={note} onChange={setNote} error={err?.field === 'note' ? err.message : null} />}
            {status === 'not_applicable' && <Field label="Почему неприменимо" value={na} onChange={setNa} required error={err?.field === 'naReason' ? err.message : null} />}
            <button className="btn small primary" disabled={a.busy}>Сохранить</button>
          </form>
        )}
        {err && !err.field && <ErrorBox error={a.error} />}
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
