import { Fragment, useEffect, useState } from 'react';
import { api, download } from '../../api';
import { isWebDemo } from '../../mode';
import { approvalBlockers } from '../../../domain/commands';
import type { ClientProposalExport } from '../../../domain/clientExport';
import { formatKop } from '../../../domain/money';
import type { ProposalContent, ProposalVersion } from '../../../domain/types';
import { APPROVAL_CATEGORY_LABELS, PROPOSAL_STATUS_LABELS } from '../../../domain/types';
import type { TabProps } from '../OpportunityCard';
import { isFull } from '../../types';
import { Badge, Confirm, Demo, Empty, ErrorBox, Field, fmtDate, fmtDateTime, useAction, useApp } from '../../ui';

const CONTENT_LABELS: [keyof ProposalContent, string, boolean][] = [
  ['understanding', 'Что поняли', true],
  ['firstOfferWhy', 'Что предлагаем первым и почему', true],
  ['resultAndAcceptance', 'Результат и приёмка', true],
  ['timeline', 'Сроки', true],
  ['dependencies', 'Зависимости', false],
  ['clientActions', 'Материалы и действия клиента', false],
  ['payment', 'Оплата', true],
  ['revisions', 'Правки', false],
  ['exclusions', 'Исключения', true],
  ['freeWork', 'Бесплатные работы', false],
  ['validUntil', 'Срок действия (дата)', true],
  ['extraWorkProcedure', 'Порядок дополнительных работ', false],
  ['nextStep', 'Следующий шаг', true],
];

export function ProposalsTab({ v, run }: TabProps) {
  const versions = [...v.proposals].sort((a, b) => b.number - a.number);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = versions.find((p) => p.id === selId) ?? versions[0] ?? null;
  const a = useAction();
  const { session } = useApp();
  if (session.actingRole === 'specialist') return <Empty>КП и версии недоступны роли специалиста</Empty>;
  return (
    <div className="stack">
      <Demo>«Сформировать КП» создаёт локальный файл и не отправляет его клиенту. Отправка и принятие — отдельные ручные события с точной версией. Почта не подключена.</Demo>
      {versions.length === 0 ? (
        <section className="card">
          <Empty>КП ещё нет. Черновик можно готовить на любой стадии — он помечается как черновик.</Empty>
          <button className="btn primary" style={{ marginTop: 8 }} disabled={a.busy} onClick={() => void a.run(() => run({ type: 'createProposalDraft', payload: {} }))}>Создать черновик КП</button>
          <ErrorBox error={a.error} />
        </section>
      ) : (
        <>
          <section className="card">
            <h2>Версии</h2>
            <div className="table-wrap">
              <table className="t stack-sm">
                <thead><tr><th>Версия</th><th>Статус</th><th>Утверждение</th><th>Отправка / принятие</th><th></th></tr></thead>
                <tbody>
                  {versions.map((p) => {
                    const ap = [...v.approvals].filter((x) => x.proposalVersionId === p.id).pop();
                    return (
                      <tr key={p.id} aria-current={sel?.id === p.id ? 'true' : undefined}>
                        <td data-label="Версия">v{p.number}{p.previousVersionId && <div className="small muted">на основе v{v.proposals.find((x) => x.id === p.previousVersionId)?.number}</div>}</td>
                        <td data-label="Статус"><Badge kind={p.status === 'draft' ? 'draft' : p.status === 'accepted' ? 'ok' : undefined}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge></td>
                        <td data-label="Утверждение" className="small">{ap ? (ap.status === 'active' ? `Утверждено · ${fmtDateTime(ap.approvedAt)}` : ap.status === 'superseded' ? `Утверждалось ${fmtDateTime(ap.approvedAt)}; версия заменена, решение сохранено` : `Снято: ${ap.revoked?.reason}`) : 'нет'}</td>
                        <td data-label="События" className="small">{p.sent ? `Отправка зафиксирована ${fmtDate(p.sent.date)} → ${p.sent.recipientLabel} (демо-событие)` : '—'}{p.accepted && <div>Принято {fmtDate(p.accepted.date)} · {p.accepted.confirmationSource}</div>}{p.rejected && <div>Отклонено: {p.rejected.reason}</div>}</td>
                        <td><button className="btn small" onClick={() => setSelId(p.id)} aria-pressed={sel?.id === p.id}>Открыть</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          {sel && <VersionPanel key={sel.id + sel.rev} p={sel} v={v} run={run} />}
        </>
      )}
    </div>
  );
}

function VersionPanel({ p, v, run }: { p: ProposalVersion } & Pick<TabProps, 'v' | 'run'>) {
  const { session } = useApp();
  const owner = session.actingRole === 'owner';
  const editable = p.status === 'draft';
  const [c, setC] = useState<ProposalContent>(p.content);
  const [preview, setPreview] = useState<ClientProposalExport | null>(null);
  const [dlg, setDlg] = useState<'' | 'approve' | 'send' | 'accept' | 'reject' | 'revise'>('');
  const [form, setForm] = useState({ comment: '', version: '', recipient: '', date: new Date().toISOString().slice(0, 10), channel: '', source: '', reason: '' });
  const save = useAction();
  const act = useAction();
  const gen = useAction();
  const prev = v.proposals.find((x) => x.id === p.previousVersionId) ?? null;
  const showBlockers = owner || (session.actingRole === 'presale_pm' && v.pmCostVisibility);
  const blockers = editable && p.status === 'draft' && showBlockers ? approvalBlockers(v, p) : [];
  const approval = [...v.approvals].filter((x) => x.proposalVersionId === p.id).pop();
  const prices = (estId: string | undefined) => {
    const c = estId ? v.computed.estimates[estId] : undefined;
    if (!c) return { one: null as number | null, monthly: null as number | null };
    return isFull(c) ? { one: c.oneTime.priceKop, monthly: c.monthly.present ? c.monthly.priceKop : null } : { one: c.priceKop, monthly: c.monthlyPriceKop };
  };
  const price = prices(p.estimateVersionId);
  const prevPrice = prices(prev?.estimateVersionId);
  const change = v.versionChanges.find((x) => x.proposalId === p.id);
  const hasDraft = v.proposals.some((x) => x.status === 'draft');
  useEffect(() => { setPreview(null); }, [p.id]);
  const close = () => setDlg('');
  const doAct = (fn: () => Promise<unknown>) => void act.run(async () => { await fn(); close(); });

  return (
    <section className="card" aria-labelledby="ver-h">
      <div className="row"><h2 id="ver-h">КП v{p.number}</h2><Badge kind={p.status === 'draft' ? 'draft' : undefined}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge><span className="right">Цена услуг: <strong>{formatKop(price.one)}</strong>{price.monthly !== null && <> + <strong>{formatKop(price.monthly)}</strong> в месяц</>}</span></div>
      {!editable && (
        <div className="notice">
          Версия в статусе «{PROPOSAL_STATUS_LABELS[p.status]}» не меняется. Чтобы изменить условия, создайте новую версию: она потребует повторного согласования владельцем{p.status === 'sent' || p.status === 'accepted' ? ' и принятия клиентом' : ''}, а эта версия и решение по ней останутся в истории.
          {!hasDraft && p.status !== 'superseded' && <div className="row" style={{ marginTop: 6 }}><button className="btn" onClick={() => setDlg('revise')}>Создать новую версию для изменений…</button></div>}
        </div>
      )}
      {change && (
        <div className="notice error">
          <strong>Требует повторного согласования.</strong> Отличия от утверждённой v{change.againstVersion}:
          <div className="row" style={{ marginTop: 4 }}>{change.categories.map((k) => <Badge key={k} kind="warn">{APPROVAL_CATEGORY_LABELS[k]}</Badge>)}</div>
          {change.details.length > 0 && <ul>{change.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
          {!change.categories.length && <p className="small">Существенных отличий пока нет.</p>}
        </div>
      )}
      {approval?.status === 'revoked' && (
        <div className="notice error"><strong>Утверждение владельца снято {fmtDateTime(approval.revoked?.at)}.</strong> {approval.revoked?.reason}
          <div className="row" style={{ marginTop: 4 }}>{approval.revoked?.categories.map((k) => <Badge key={k} kind="warn">{APPROVAL_CATEGORY_LABELS[k]}</Badge>)}</div></div>
      )}
      {approval?.status === 'superseded' && <div className="notice">Решение владельца по этой версии ({fmtDateTime(approval.approvedAt)}) сохранено; версия заменена новой.</div>}
      {approval?.status === 'active' && <div className="notice">Утверждено владельцем {fmtDateTime(approval.approvedAt)} · снимок <span className="mono">{approval.snapshotHash.slice(0, 12)}…</span>{approval.comment ? ` · «${approval.comment}»` : ''}</div>}

      <h3>Работы в КП</h3>
      {editable ? (
        <fieldset>
          <legend className="small">Выберите работы (у каждой должны быть основание, объём и приёмка)</legend>
          {v.workItems.map((w) => (
            <label key={w.id} className="check"><input type="checkbox" checked={c.workItemIds.includes(w.id)} onChange={(e) => setC({ ...c, workItemIds: e.target.checked ? [...c.workItemIds, w.id] : c.workItemIds.filter((x) => x !== w.id) })} /><span>{w.title} — {w.quantity ?? '?'} {w.unit ?? ''}</span></label>
          ))}
          {v.workItems.length === 0 && <p className="small muted">Сначала добавьте работы во вкладке «Работы и экономика».</p>}
        </fieldset>
      ) : <ul>{p.content.workItemIds.map((id) => <li key={id}>{v.workItems.find((w) => w.id === id)?.title ?? id}</li>)}</ul>}

      <h3>Содержание</h3>
      {editable ? (
        <form className="grid two" onSubmit={(e) => { e.preventDefault(); void save.run(() => run({ type: 'updateProposalContent', payload: { proposalId: p.id, patch: c } })); }}>
          {CONTENT_LABELS.map(([k, label, req]) => (
            <Field key={k} label={label} required={req} type={k === 'validUntil' ? 'date' : 'text'} multiline={k !== 'validUntil'} value={(c[k] as string | null) ?? ''} onChange={(x) => setC({ ...c, [k]: x || null })} />
          ))}
          <div style={{ gridColumn: '1 / -1' }}>
            <ErrorBox error={save.error} />
            <button className="btn primary" disabled={save.busy}>Сохранить черновик</button>
          </div>
        </form>
      ) : (
        <dl className="kv">{CONTENT_LABELS.map(([k, label]) => (<Fragment key={k}><dt>{label}</dt><dd>{(p.content[k] as string | null) ?? '—'}</dd></Fragment>))}</dl>
      )}

      {prev && (
        <details className="disclosure" style={{ marginTop: 10 }} open>
          <summary>Отличия от v{prev.number}</summary>
          <Diff a={prev.content} b={p.content} aPrice={prevPrice.one} bPrice={price.one} v={v} />
        </details>
      )}

      {blockers.length > 0 && <div className="notice error" style={{ marginTop: 10 }}><strong>До утверждения владельцем не хватает:</strong><ul>{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}

      <h3 style={{ marginTop: 12 }}>Действия</h3>
      <div className="row">
        <button className="btn" disabled={gen.busy} onClick={() => void gen.run(async () => setPreview(await api.get<ClientProposalExport>(`/api/opportunities/${v.id}/export/proposal/${p.id}?format=json`)))}>Предпросмотр клиентского документа</button>
        {isWebDemo()
          ? <span className="small muted">Word-файл формируется в локальной версии; в веб-демо — только предпросмотр.</span>
          : <button className="btn" disabled={gen.busy} onClick={() => void gen.run(() => download(`/api/opportunities/${v.id}/export/proposal/${p.id}?format=docx`))}>Сформировать КП (Word, локально)</button>}
        {owner && p.status === 'draft' && <button className="btn primary" onClick={() => setDlg('approve')}>Утвердить версию и расчёт…</button>}
        {p.status === 'approved_for_send' && <button className="btn primary" onClick={() => setDlg('send')}>Зафиксировать отправку…</button>}
        {p.status === 'sent' && <button className="btn primary" onClick={() => setDlg('accept')}>Зафиксировать принятие…</button>}
        {p.status === 'sent' && <button className="btn" onClick={() => setDlg('reject')}>Зафиксировать отклонение…</button>}

      </div>
      <ErrorBox error={gen.error} />
      {preview && <ClientPreview e={preview} />}

      {p.status === 'sent' && <ClientQuestions p={p} run={run} />}

      <Confirm open={dlg === 'approve'} title={`Утвердить КП v${p.number} и расчёт`} confirmLabel="Утвердить" disabled={act.busy} onCancel={close}
        onConfirm={() => doAct(() => run({ type: 'approveDeal', payload: { proposalId: p.id, comment: form.comment || null } }))}>
        <p>Утверждённая версия фиксируется вместе с работами и расчётом. Любое изменение цены, объёма, скидки, комиссии, оплаты, сроков, бесплатных работ или зависимостей — только в новой версии с повторным согласованием. Снимок условий: цена, объём, скидка, комиссия, оплата, сроки, бесплатные работ и зависимостей. Любое изменение снимет его автоматически.</p>
        <Field label="Комментарий" value={form.comment} onChange={(x) => setForm({ ...form, comment: x })} />
        <ErrorBox error={act.error} />
      </Confirm>
      <Confirm open={dlg === 'send'} title="Зафиксировать отправку (демонстрационное событие)" confirmLabel="Зафиксировать отправку" disabled={act.busy} onCancel={close}
        onConfirm={() => doAct(() => run({ type: 'recordSent', payload: { proposalId: p.id, versionNumber: Number(form.version), recipientLabel: form.recipient, date: form.date, channelNote: form.channel } }))}>
        <p>Письмо не отправляется. Вы фиксируете факт отправки, сделанной вне системы. После этого версия станет неизменяемой.</p>
        <Field label={`Номер отправленной версии (должен быть ${p.number})`} value={form.version} onChange={(x) => setForm({ ...form, version: x })} required />
        <Field label="Получатель (роль, без персональных данных)" value={form.recipient} onChange={(x) => setForm({ ...form, recipient: x })} hint="Например: «Клиент: ЛПР»" required />
        <Field label="Дата отправки" type="date" value={form.date} onChange={(x) => setForm({ ...form, date: x })} required />
        <Field label="Канал (заметка)" value={form.channel} onChange={(x) => setForm({ ...form, channel: x })} />
        <ErrorBox error={act.error} />
      </Confirm>
      <Confirm open={dlg === 'accept'} title="Зафиксировать принятие клиентом" confirmLabel="Зафиксировать принятие" disabled={act.busy} onCancel={close}
        onConfirm={() => doAct(() => run({ type: 'recordAccepted', payload: { proposalId: p.id, versionNumber: Number(form.version), date: form.date, confirmationSource: form.source } }))}>
        <Field label={`Номер принятой версии (должен быть ${p.number})`} value={form.version} onChange={(x) => setForm({ ...form, version: x })} required />
        <Field label="Дата принятия" type="date" value={form.date} onChange={(x) => setForm({ ...form, date: x })} required />
        <Field label="Источник подтверждения" value={form.source} onChange={(x) => setForm({ ...form, source: x })} hint="Например: «Демо-письмо 3»" required />
        <ErrorBox error={act.error} />
      </Confirm>
      <Confirm open={dlg === 'reject'} title="Зафиксировать отклонение" confirmLabel="Зафиксировать" disabled={act.busy} onCancel={close}
        onConfirm={() => doAct(() => run({ type: 'recordRejected', payload: { proposalId: p.id, date: form.date, reason: form.reason } }))}>
        <Field label="Причина" value={form.reason} onChange={(x) => setForm({ ...form, reason: x })} required />
        <ErrorBox error={act.error} />
      </Confirm>
      <Confirm open={dlg === 'revise'} title="Новая версия КП" confirmLabel="Создать версию" disabled={act.busy} onCancel={close}
        onConfirm={() => doAct(() => run({ type: 'createRevision', payload: { fromProposalId: p.id, reason: form.reason } }))}>
        <p>Будет создан черновик v{Math.max(...v.proposals.map((x) => x.number)) + 1} с копией содержания и расчёта. v{p.number} и решение по ней сохранятся. Новая версия потребует утверждения владельцем{p.status === 'sent' || p.status === 'accepted' ? ', отправки и принятия клиентом; возможность вернётся на «Готовим предложение»' : ''}.</p>
        <Field label="Причина" value={form.reason} onChange={(x) => setForm({ ...form, reason: x })} required />
        <ErrorBox error={act.error} />
      </Confirm>
    </section>
  );
}

function Diff({ a, b, aPrice, bPrice, v }: { a: ProposalContent; b: ProposalContent; aPrice: number | null; bPrice: number | null; v: TabProps['v'] }) {
  const rows: [string, string, string][] = [];
  if (aPrice !== bPrice) rows.push(['Цена разовых работ', formatKop(aPrice), formatKop(bPrice)]);
  const w = (ids: string[]) => ids.map((id) => v.workItems.find((x) => x.id === id)?.title ?? id).join(', ');
  if (w(a.workItemIds) !== w(b.workItemIds)) rows.push(['Работы', w(a.workItemIds), w(b.workItemIds)]);
  for (const [k, label] of CONTENT_LABELS) if (a[k] !== b[k]) rows.push([label, String(a[k] ?? '—'), String(b[k] ?? '—')]);
  if (!rows.length) return <p className="small">Отличий в содержании и цене нет.</p>;
  return (
    <table className="t stack-sm"><thead><tr><th>Поле</th><th>Было</th><th>Стало</th></tr></thead>
      <tbody>{rows.map(([l, x, y]) => <tr key={l}><td data-label="Поле">{l}</td><td data-label="Было" className="diff-old">{x}</td><td data-label="Стало" className="diff-new">{y}</td></tr>)}</tbody></table>
  );
}

function ClientPreview({ e }: { e: ClientProposalExport }) {
  return (
    <div className="card" style={{ marginTop: 10, background: '#fafbfd' }} aria-label="Предпросмотр клиентского документа">
      <p className="small"><Badge kind="warn">{e.watermark}</Badge> Клиентское представление строится по разрешённому списку полей: без ставок, себестоимости, маржи, комиссии и внутренних комментариев.</p>
      <h3>Коммерческое предложение — {e.company}, версия {e.versionNumber}</h3>
      <dl className="kv small">
        <dt>Что поняли</dt><dd>{e.understanding ?? '—'}</dd>
        <dt>Что предлагаем первым</dt><dd>{e.firstOfferWhy ?? '—'}</dd>
        <dt>Работы</dt><dd><ul>{e.works.map((w, i) => <li key={i}>{w.title}: {w.quantity} {w.unit}; приёмка — {w.acceptanceCriterion}; {w.recurrence}</li>)}</ul></dd>
        <dt>Стоимость услуг агентства</dt><dd>{e.serviceOneTimeKop !== null && <>Разовые работы: {formatKop(e.serviceOneTimeKop)}{e.discountKop ? ` (скидка ${formatKop(e.discountKop)})` : ''}</>}{e.serviceMonthlyKop !== null && <div>Ежемесячные работы: {formatKop(e.serviceMonthlyKop)} в месяц</div>}</dd>
        <dt>Рекламный бюджет и внешние расходы</dt><dd>{e.externalBudgets.map((b) => `${b.label}: ${formatKop(b.amountKop)} (${b.paidBy})`).join('; ') || 'нет'}<div className="muted">{e.externalBudgetsNote}</div></dd>
        <dt>Сроки</dt><dd>{e.timeline ?? '—'}</dd>
        <dt>Оплата</dt><dd>{e.payment ?? '—'}</dd>
        <dt>Исключения</dt><dd>{e.exclusions ?? '—'}</dd>
        <dt>Срок действия</dt><dd>{fmtDate(e.validUntil)}</dd>
        <dt>Следующий шаг</dt><dd>{e.nextStep ?? '—'}</dd>
      </dl>
    </div>
  );
}

function ClientQuestions({ p, run }: { p: ProposalVersion; run: TabProps['run'] }) {
  const [text, setText] = useState('');
  const [next, setNext] = useState(p.nextContact ?? '');
  const a = useAction();
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <h3>Вопросы клиента и следующий контакт</h3>
      {p.clientQuestions.length ? <ul>{p.clientQuestions.map((q) => <li key={q.id}>{q.text} <span className="small muted">{fmtDateTime(q.at)}</span></li>)}</ul> : <p className="small muted">Вопросов не записано</p>}
      <p className="small">Следующий контакт: {fmtDate(p.nextContact)}</p>
      <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'addClientQuestion', payload: { proposalId: p.id, text, nextContact: next || null } }); setText(''); }); }}>
        <Field label="Вопрос клиента" value={text} onChange={setText} required />
        <Field label="Следующий контакт" type="date" value={next} onChange={setNext} />
        <div><button className="btn" disabled={a.busy}>Записать</button></div>
      </form>
      <ErrorBox error={a.error} />
    </div>
  );
}
