import { Fragment, useState } from 'react';
import { workItemIssues } from '../../../domain/commands';
import { formatBp, formatKop, formatShare, parseRubInput } from '../../../domain/money';
import type { CostLine, CostLineKind, EstimateVersion, WorkItem } from '../../../domain/types';
import { COST_LINE_LABELS } from '../../../domain/types';
import { isFull } from '../../types';
import { PART_LABELS, type EstimateResult } from '../../../domain/economics';
import { isWebDemo } from '../../mode';
import type { TabProps } from '../OpportunityCard';
import { Badge, Check, Confirm, Empty, ErrorBox, Field, Select, useAction, useApp } from '../../ui';

const rubStr = (k: number | null) => (k === null ? '' : String(k / 100));
const parse = (s: string) => (s.trim() === '' ? null : parseRubInput(s));
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function EconomicsTab({ v, run }: TabProps) {
  const est = [...v.estimates].sort((a, b) => b.number - a.number)[0] ?? null;
  const [selId, setSelId] = useState<string | null>(null);
  const sel = v.estimates.find((e) => e.id === selId) ?? est;
  const a = useAction();
  return (
    <div className="stack">
      <WorkItems v={v} run={run} />
      <section className="card">
        <div className="row"><h2>Расчёт</h2>
          {v.estimates.length > 1 && (
            <label className="row small right">Версия:
              <select value={sel?.id} onChange={(e) => setSelId(e.target.value)} style={{ width: 'auto' }}>
                {v.estimates.map((e) => <option key={e.id} value={e.id}>v{e.number} — {e.status === 'locked' ? 'зафиксирован' : 'черновик'}</option>)}
              </select>
            </label>
          )}
        </div>
        <p className="small muted">Управленческий расчёт, не обещание чистой прибыли. Нормативы, ставки и маржа в демо не утверждены владельцем и подписаны как демо.</p>
        {!sel ? (
          <>
            <Empty>Расчёта ещё нет. Черновик расчёта создаётся вместе с черновиком КП.</Empty>
            <button className="btn primary" style={{ marginTop: 8 }} disabled={a.busy} onClick={() => void a.run(() => run({ type: 'createProposalDraft', payload: {} }))}>Создать черновик КП и расчёта</button>
            <ErrorBox error={a.error} />
          </>
        ) : <Estimate key={sel.id} est={sel} v={v} run={run} />}
      </section>
    </div>
  );
}

function WorkItems({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const { team, teamName } = useApp();
  const empty = { title: '', basisType: 'client_task' as 'client_task' | 'finding', basisText: '', findingId: '', expectedResult: '', quantity: '', unit: '', acceptanceCriterion: '', recurrence: 'one_time' as WorkItem['recurrence'], assigneeUserId: '' };
  const [f, setF] = useState(empty);
  const a = useAction();
  const del = useAction();
  const [toDelete, setToDelete] = useState<WorkItem | null>(null);
  return (
    <section className="card">
      <h2>Работы</h2>
      <p className="small muted">У каждой работы — основание (подтверждённая находка или прямая задача клиента), ожидаемый результат, измеримый объём и критерий приёмки. Услуга из каталога без основания не добавляется.</p>
      {v.workItems.length === 0 ? <Empty>Работ пока нет</Empty> : (
        <div className="table-wrap">
          <table className="t stack-sm">
            <thead><tr><th>Работа</th><th>Основание</th><th>Объём</th><th>Результат и приёмка</th><th>Проверка</th><th></th></tr></thead>
            <tbody>
              {v.workItems.map((w) => {
                const issues = workItemIssues(v, w);
                const basis = w.basis?.type === 'finding' ? `Находка ${v.findings.find((x) => x.id === (w.basis as { findingId: string }).findingId)?.code ?? '?'}` : w.basis?.type === 'client_task' ? `Задача клиента: ${w.basis.text}` : 'нет';
                return (
                  <tr key={w.id}>
                    <td data-label="Работа">{w.title}<div className="small muted">{w.recurrence === 'monthly' ? 'Регулярная (ежемесячно)' : 'Разовая'} · {teamName(w.assigneeUserId)}</div></td>
                    <td data-label="Основание" className="small">{basis}</td>
                    <td data-label="Объём">{w.quantity ?? '—'} {w.unit ?? ''}</td>
                    <td data-label="Результат" className="small">{w.expectedResult ?? '—'}<br /><em>Приёмка:</em> {w.acceptanceCriterion ?? '—'}</td>
                    <td data-label="Проверка">{issues.length ? <ul className="small">{issues.map((i) => <li key={i}>{i}</li>)}</ul> : <Badge kind="ok">Готово к КП</Badge>}</td>
                    <td><button className="btn small danger" disabled={del.busy} onClick={() => setToDelete(w)}>Удалить</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ErrorBox error={del.error} />
      <Confirm open={!!toDelete} title="Удалить работу" confirmLabel="Удалить" disabled={del.busy} onCancel={() => setToDelete(null)}
        onConfirm={() => void del.run(async () => { if (toDelete) await run({ type: 'removeWorkItem', payload: { id: toDelete.id } }); setToDelete(null); })}>
        <p>Удалить работу «{toDelete?.title}» из черновика? В отправленных версиях КП она останется.</p>
      </Confirm>
      <details className="disclosure" style={{ marginTop: 10 }}>
        <summary>Добавить работу</summary>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void a.run(async () => {
          await run({ type: 'addWorkItem', payload: {
            title: f.title, basis: f.basisType === 'finding' ? (f.findingId ? { type: 'finding', findingId: f.findingId } : null) : (f.basisText.trim() ? { type: 'client_task', text: f.basisText } : null),
            expectedResult: f.expectedResult || null, quantity: num(f.quantity), unit: f.unit || null, acceptanceCriterion: f.acceptanceCriterion || null, recurrence: f.recurrence, assigneeUserId: f.assigneeUserId || null,
          } });
          setF(empty); }); }}>
          <div className="grid three">
            <Field label="Название" value={f.title} onChange={(x) => setF({ ...f, title: x })} required />
            <Select label="Основание" value={f.basisType} onChange={(x) => setF({ ...f, basisType: x })} options={[['client_task', 'Прямая задача клиента'], ['finding', 'Подтверждённая находка']]} />
            {f.basisType === 'client_task'
              ? <Field label="Формулировка задачи клиента" value={f.basisText} onChange={(x) => setF({ ...f, basisText: x })} />
              : <Select label="Находка" value={f.findingId} onChange={(x) => setF({ ...f, findingId: x })} placeholder="— выберите —" options={v.findings.map((x) => [x.id, `${x.code}. ${x.title}`])} />}
            <Field label="Ожидаемый результат" value={f.expectedResult} onChange={(x) => setF({ ...f, expectedResult: x })} />
            <Field label="Количество" type="number" value={f.quantity} onChange={(x) => setF({ ...f, quantity: x })} />
            <Field label="Единица" value={f.unit} onChange={(x) => setF({ ...f, unit: x })} hint="страница, кампания, месяц…" />
            <Field label="Критерий приёмки" value={f.acceptanceCriterion} onChange={(x) => setF({ ...f, acceptanceCriterion: x })} />
            <Select label="Тип" value={f.recurrence} onChange={(x) => setF({ ...f, recurrence: x })} options={[['one_time', 'Разовая'], ['monthly', 'Регулярная (ежемесячно)']]} />
            <Select label="Исполнитель" value={f.assigneeUserId} onChange={(x) => setF({ ...f, assigneeUserId: x })} placeholder="не назначен" options={team.map((t) => [t.id, t.displayName])} />
          </div>
          <ErrorBox error={a.error} />
          <div><button className="btn primary" disabled={a.busy}>Добавить работу</button></div>
        </form>
      </details>
    </section>
  );
}

const CONF_LABELS = { preliminary: 'Предварительно', specialist_estimate: 'Оценка специалиста', confirmed: 'Проверено' } as const;

function StatusBadges({ v, est, filled, verified, unverified, unknown }: { v: TabProps['v']; est: EstimateVersion; filled: boolean; verified: boolean; unverified: number; unknown: number }) {
  const p = v.proposals.find((x) => x.estimateVersionId === est.id);
  const ap = p ? [...v.approvals].filter((a) => a.proposalVersionId === p.id).pop() : undefined;
  const approved = ap?.status === 'active';
  return (
    <div className="row" aria-label="Статусы расчёта">
      <Badge kind={filled ? 'ok' : 'warn'}>1. Данные {filled ? 'заполнены' : `не заполнены${unknown ? ` (пустых строк: ${unknown})` : ''}`}</Badge>
      <Badge kind={verified ? 'ok' : 'warn'}>2. Оценки {verified ? 'проверены' : `не проверены${unverified ? ` (${unverified})` : ''}`}</Badge>
      <Badge kind={approved ? 'ok' : ap?.status === 'superseded' ? undefined : 'warn'}>3. Экономика {approved ? `утверждена владельцем (КП v${p?.number})` : ap?.status === 'superseded' ? 'утверждалась для заменённой версии' : 'не утверждена владельцем'}</Badge>
    </div>
  );
}

function Estimate({ est, v, run }: { est: EstimateVersion } & Pick<TabProps, 'v' | 'run'>) {
  const { session, teamName } = useApp();
  const owner = session.actingRole === 'owner';
  const canVerify = ['owner', 'presale_pm', 'lead_specialist'].includes(session.actingRole);
  const computed = v.computed.estimates[est.id];
  const full = computed && isFull(computed) ? computed : null;
  const locked = est.status === 'locked';
  const rec = (l: CostLine) => (l.workItemId ? v.workItems.find((w) => w.id === l.workItemId)?.recurrence : undefined) ?? l.recurrence ?? 'one_time';
  return (
    <div className="stack">
      {computed && (full
        ? <StatusBadges v={v} est={est} filled={full.filled} verified={full.verified} unverified={full.oneTime.unverifiedLines + full.monthly.unverifiedLines} unknown={full.oneTime.unknownLines + full.monthly.unknownLines} />
        : !isFull(computed) && <StatusBadges v={v} est={est} filled={computed.filled} verified={computed.verified} unverified={computed.unverifiedLines} unknown={computed.unknownLines} />)}
      {locked && <div className="notice">Расчёт v{est.number} утверждён и зафиксирован. Изменения — только в новой версии КП («КП и версии» → «Создать новую версию»); она потребует повторного согласования.</div>}
      <div className="table-wrap">
        <table className="t stack-sm">
          <thead><tr><th>Строка</th><th>Часть</th><th>Исполнитель</th><th>Часы (диапазон)</th><th>Ставка / сумма</th><th>Стоимость</th><th>Оценка</th><th></th></tr></thead>
          <tbody>
            {est.lines.map((l) => <LineRow key={l.id + l.confidence + l.hours} l={l} part={rec(l)} est={est} run={run} owner={owner} canVerify={canVerify && !locked && (owner || l.performerUserId !== session.user.id)} locked={locked} cost={full?.lineCosts.find((c) => c.lineId === l.id)?.costKop ?? null} teamName={teamName} />)}
          </tbody>
        </table>
      </div>
      {!locked && <AddLine est={est} v={v} run={run} />}
      {full ? (
        <>
          <Calc est={est} r={full} part="one_time" />
          {full.monthly.present && <Calc est={est} r={full} part="monthly" />}
          {full.issues.length > 0 && (
            <div className="notice error">
              <strong>Что не готово:</strong>
              <ul>{full.issues.map((i, k) => <li key={k}><Badge>{i.severity === 'unverified' ? 'не проверено' : i.severity === 'error' ? 'ошибка' : 'не заполнено'}</Badge> {i.message}</li>)}</ul>
            </div>
          )}
          <p className="small muted">Рекламный бюджет и внешние расходы клиента: {full.externalBudgetsKop === null ? 'есть строки без суммы' : formatKop(full.externalBudgetsKop)}. Это не выручка агентства: они не входят ни в P, ни в C, ни в базу комиссии.</p>
        </>
      ) : computed && !isFull(computed) && (
        <div className="notice">
          <strong>Цена услуг: разовые — {formatKop(computed.priceKop)}{computed.monthlyPriceKop !== null ? `; ежемесячные — ${formatKop(computed.monthlyPriceKop)} в месяц` : ''}</strong>
          <p className="small">Себестоимость, ставки, комиссия за привлечение и маржа удалены из данных для вашей роли{isWebDemo() ? ' (в веб-демо это делает код в браузере, а не защищённый сервер)' : ' на сервере'}.</p>
          {computed.issues.length > 0 && <ul className="small">{computed.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
        </div>
      )}
      {!locked && <EstimateSettings est={est} v={v} run={run} owner={owner} />}
      {owner && <CommissionRules v={v} run={run} />}
    </div>
  );
}

function LineRow({ l, part, est, run, owner, canVerify, locked, cost, teamName }: { l: CostLine; part: 'one_time' | 'monthly'; est: EstimateVersion; run: TabProps['run']; owner: boolean; canVerify: boolean; locked: boolean; cost: number | null; teamName: (id: string | null) => string }) {
  const hourly = ['specialist', 'pm', 'approvals'].includes(l.kind);
  const [f, setF] = useState({ hours: l.hours === null ? '' : String(l.hours), hoursMin: l.hoursMin === null ? '' : String(l.hoursMin), hoursMax: l.hoursMax === null ? '' : String(l.hoursMax), rate: rubStr(l.rateKop), amount: rubStr(l.amountKop), zeroReason: l.zeroReason ?? '', confidence: (l.confidence === 'confirmed' ? 'specialist_estimate' : l.confidence) as 'preliminary' | 'specialist_estimate', recurrence: l.recurrence ?? 'one_time' });
  const [edit, setEdit] = useState(false);
  const [verifyNote, setVerifyNote] = useState('');
  const a = useAction();
  const unknown = hourly ? l.hours === null || l.rateKop === null : l.amountKop === null;
  return (
    <tr>
      <td data-label="Строка">{l.label}<div className="small muted">{COST_LINE_LABELS[l.kind]}</div></td>
      <td data-label="Часть" className="small">{part === 'monthly' ? 'Ежемесячно' : 'Разово'}</td>
      <td data-label="Исполнитель">{teamName(l.performerUserId)}</td>
      <td data-label="Часы">{hourly ? (<>{l.hours ?? <Badge kind="warn">неизвестно</Badge>}{(l.hoursMin !== null || l.hoursMax !== null) && <span className="small muted"> ({l.hoursMin ?? '?'}–{l.hoursMax ?? '?'})</span>}</>) : '—'}</td>
      <td data-label="Ставка / сумма">{hourly ? (l.rateKop === null ? (owner ? <Badge kind="warn">ставка неизвестна</Badge> : <span className="muted">скрыто для роли</span>) : `${formatKop(l.rateKop)}/ч`) : (l.amountKop === null ? <Badge kind="warn">неизвестно</Badge> : formatKop(l.amountKop))}{l.zeroReason && <div className="small">Ноль подтверждён: {l.zeroReason}</div>}</td>
      <td data-label="Стоимость">{unknown ? <span className="muted">не считается (пусто ≠ 0)</span> : formatKop(cost)}</td>
      <td data-label="Оценка" className="small"><Badge kind={l.confidence === 'confirmed' ? 'ok' : 'warn'}>{CONF_LABELS[l.confidence]}</Badge>{l.verifiedAt && <div className="muted">{teamName(l.verifiedBy ?? null)}, {new Date(l.verifiedAt).toLocaleDateString('ru-RU')}</div>}</td>
      <td>
        {!locked && <button className="btn small" aria-expanded={edit} onClick={() => setEdit(!edit)}>Изменить</button>}
        {canVerify && l.confidence !== 'confirmed' && !unknown && (
          <form className="row" style={{ marginTop: 4 }} onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'verifyCostLine', payload: { estimateId: est.id, lineId: l.id, comment: verifyNote } })); }}>
            <input type="text" aria-label={`Комментарий проверки «${l.label}»`} placeholder="чем проверено" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} style={{ maxWidth: 160 }} />
            <button className="btn small">Проверить оценку</button>
          </form>
        )}
        {edit && (
          <form className="stack" style={{ marginTop: 6, minWidth: 220 }} onSubmit={(e) => { e.preventDefault(); void a.run(async () => {
            await run({ type: 'upsertCostLine', payload: { estimateId: est.id, line: { ...l, hours: num(f.hours), hoursMin: num(f.hoursMin), hoursMax: num(f.hoursMax), rateKop: owner ? parse(f.rate) : l.rateKop, amountKop: hourly ? null : parse(f.amount), zeroReason: f.zeroReason || null, confidence: f.confidence, recurrence: f.recurrence } } });
            setEdit(false); }); }}>
            {hourly && (<>
              <Field label="Часы" value={f.hours} onChange={(x) => setF({ ...f, hours: x })} hint="Пусто = неизвестно (не ноль)" />
              <div className="row"><Field label="Мин." value={f.hoursMin} onChange={(x) => setF({ ...f, hoursMin: x })} /><Field label="Макс." value={f.hoursMax} onChange={(x) => setF({ ...f, hoursMax: x })} /></div>
              {owner && <Field label="Ставка, усл. ₽/ч" value={f.rate} onChange={(x) => setF({ ...f, rate: x })} />}
            </>)}
            {!hourly && <Field label="Сумма, усл. ₽" value={f.amount} onChange={(x) => setF({ ...f, amount: x })} />}
            <Field label="Причина подтверждённого нуля" value={f.zeroReason} onChange={(x) => setF({ ...f, zeroReason: x })} hint="Только если значение — явный ноль" />
            <Select label="Происхождение оценки" value={f.confidence} onChange={(x) => setF({ ...f, confidence: x })} options={[['preliminary', 'Предварительно'], ['specialist_estimate', 'Оценка специалиста']]} hint="«Проверено» ставит только действие «Проверить оценку». Изменение значения снимает проверку" />
            {!l.workItemId && <Select label="Часть" value={f.recurrence} onChange={(x) => setF({ ...f, recurrence: x })} options={[['one_time', 'Разовые работы'], ['monthly', 'Ежемесячные работы']]} />}
            <button className="btn small primary" disabled={a.busy}>Сохранить строку</button>
          </form>
        )}
        <ErrorBox error={a.error} />
      </td>
    </tr>
  );
}

function AddLine({ est, v, run }: { est: EstimateVersion } & Pick<TabProps, 'v' | 'run'>) {
  const { team } = useApp();
  const [kind, setKind] = useState<CostLineKind>('specialist');
  const [label, setLabel] = useState('');
  const [performer, setPerformer] = useState('');
  const [wi, setWi] = useState('');
  const [recurrence, setRecurrence] = useState<'one_time' | 'monthly'>('one_time');
  const a = useAction();
  return (
    <details className="disclosure">
      <summary>Добавить строку расчёта</summary>
      <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'upsertCostLine', payload: { estimateId: est.id, line: { id: '', kind, workItemId: wi || null, label: label || COST_LINE_LABELS[kind], performerUserId: performer || null, hours: null, hoursMin: null, hoursMax: null, rateKop: null, amountKop: null, zeroReason: null, confidence: 'preliminary', recurrence: wi ? v.workItems.find((w) => w.id === wi)?.recurrence ?? 'one_time' : recurrence } } })); }}>
        <Select label="Тип" value={kind} onChange={setKind} options={Object.entries(COST_LINE_LABELS) as [CostLineKind, string][]} />
        <Field label="Название" value={label} onChange={setLabel} />
        <Select label="Исполнитель" value={performer} onChange={setPerformer} placeholder="не назначен" options={team.map((t) => [t.id, t.displayName])} />
        <Select label="К работе" value={wi} onChange={setWi} placeholder="общая строка" options={v.workItems.map((w) => [w.id, `${w.title} (${w.recurrence === 'monthly' ? 'ежемесячно' : 'разово'})`])} />
        {!wi && <Select label="Часть" value={recurrence} onChange={setRecurrence} options={[['one_time', 'Разовые работы'], ['monthly', 'Ежемесячные работы']]} />}
        <div><button className="btn" disabled={a.busy}>Добавить</button></div>
        <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={a.error} /></div>
      </form>
    </details>
  );
}

function Calc({ est, r, part }: { est: EstimateVersion; r: EstimateResult; part: 'one_time' | 'monthly' }) {
  const x = part === 'one_time' ? r.oneTime : r.monthly;
  const per = part === 'monthly' ? ' в месяц' : '';
  return (
    <div className="card" style={{ margin: 0 }} aria-live="polite">
      <h3>{PART_LABELS[part]}: как получена цена услуг</h3>
      <dl className="kv">
        <dt>Проверенные оценки</dt><dd>{formatKop(x.verifiedCostKop)}{per}</dd>
        <dt>Непроверенные оценки</dt><dd>{formatKop(x.unverifiedCostKop)}{per} {x.unverifiedLines > 0 && <Badge kind="warn">строк: {x.unverifiedLines}</Badge>}</dd>
        <dt>Строки без значения</dt><dd>{x.unknownLines ? <Badge kind="warn">{x.unknownLines} — итог затрат не считается</Badge> : 'нет'}</dd>
        {x.steps.filter((s) => !/^Затраты: /.test(s.label) && s.label !== 'Строки без значения').map((s, i) => (<Fragment key={i}><dt>{s.label}</dt><dd>{s.value}</dd></Fragment>))}
        {x.costMinKop !== null && x.costMaxKop !== null && x.costMinKop !== x.costMaxKop && (<><dt>Диапазон затрат</dt><dd>{formatKop(x.costMinKop)} – {formatKop(x.costMaxKop)}{per}</dd></>)}
        {x.remainderKop !== null && x.priceKop ? (<><dt>Доля остатка от цены услуг</dt><dd>{formatShare(x.remainderKop, x.priceKop)} {x.belowTargetMargin && <Badge kind="warn">ниже целевой маржи {formatBp(est.targetMarginBp)}</Badge>}</dd></>) : null}
      </dl>
      <p className="small muted" style={{ marginTop: 8 }}>P — цена услуг, то есть выручка агентства. Комиссия за привлечение — выплата партнёру из этой выручки. Остаток — управленческая оценка, не обещание чистой прибыли.</p>
    </div>
  );
}

function EstimateSettings({ est, run, owner }: { est: EstimateVersion } & Pick<TabProps, 'v' | 'run'> & { owner: boolean }) {
  const { session } = useApp();
  const [f, setF] = useState({
    priceMode: est.priceMode, manualPrice: rubStr(est.manualPriceKop), manualMonthly: rubStr(est.manualMonthlyPriceKop ?? null), discount: est.discount ? rubStr(est.discount.amountKop) : '', discountReason: est.discount?.reason ?? '', discountPart: est.discount?.appliesTo ?? 'one_time',
    margin: est.targetMarginBp === null ? '' : String(est.targetMarginBp / 100), tax: est.taxModel.description ?? '', taxSet: est.taxModel.status === 'set', rounding: est.rounding, noCommission: est.noCommissionConfirmed, ruleId: est.commissionRuleId ?? '',
    xb: est.externalBudgets.map((b) => ({ ...b, amount: rubStr(b.amountKop) })),
  });
  const a = useAction();
  return (
    <details className="disclosure">
      <summary>Параметры цены, скидка, рекламный бюджет{owner ? ', маржа, налоги, комиссия' : ''}</summary>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void a.run(() => {
        const patch: Record<string, unknown> = {
          priceMode: f.priceMode, manualPriceKop: parse(f.manualPrice), manualMonthlyPriceKop: parse(f.manualMonthly),
          discount: f.discount.trim() ? { amountKop: parse(f.discount), reason: f.discountReason, appliesTo: f.discountPart } : null,
          externalBudgets: f.xb.map((b) => ({ id: b.id, label: b.label, amountKop: parse(b.amount), period: b.period, paidBy: b.paidBy })),
        };
        if (session.actingRole === 'owner') Object.assign(patch, {
          targetMarginBp: f.margin.trim() === '' ? null : Math.round(Number(f.margin.replace(',', '.')) * 100), targetMarginSource: f.margin.trim() === '' ? null : est.targetMarginSource ?? 'demo_unapproved',
          taxModel: { status: f.taxSet ? 'set' : 'not_set', description: f.tax || null }, rounding: f.rounding, noCommissionConfirmed: f.noCommission, commissionRuleId: f.ruleId || null,
        });
        return run({ type: 'updateEstimate', payload: { estimateId: est.id, patch: patch as never } });
      }); }}>
        <div className="grid three">
          <Select label="Режим цены услуг" value={f.priceMode} onChange={(x) => setF({ ...f, priceMode: x })} options={[['formula', 'Формула P = C / (1 − c − m)'], ['manual', 'Цена вручную']]} />
          {f.priceMode === 'manual' && <Field label="Цена разовых работ, усл. ₽" value={f.manualPrice} onChange={(x) => setF({ ...f, manualPrice: x })} />}
          {f.priceMode === 'manual' && <Field label="Цена ежемесячных работ, усл. ₽ в месяц" value={f.manualMonthly} onChange={(x) => setF({ ...f, manualMonthly: x })} hint="Пусто, если ежемесячных работ нет" />}
          <Field label="Скидка, усл. ₽" value={f.discount} onChange={(x) => setF({ ...f, discount: x })} />
          {f.discount.trim() && <Field label="Причина скидки" value={f.discountReason} onChange={(x) => setF({ ...f, discountReason: x })} required />}
          {f.discount.trim() && <Select label="Скидка применяется к" value={f.discountPart} onChange={(x) => setF({ ...f, discountPart: x })} options={[['one_time', 'Разовым работам'], ['monthly', 'Ежемесячным работам']]} />}
        </div>
        {owner && (
          <div className="grid three">
            <Field label="Целевая маржа m, %" value={f.margin} onChange={(x) => setF({ ...f, margin: x })} hint="Демо-значение; норматив утверждает владелец" />
            <Select label="Округление" value={f.rounding} onChange={(x) => setF({ ...f, rounding: x })} options={[['up_to_ruble', 'Вверх до целого рубля'], ['half_up_kopeck', 'Half-up до копейки']]} />
            <Field label="Налоговая модель (описание)" value={f.tax} onChange={(x) => setF({ ...f, tax: x })} hint="Прототип не подставляет налоговые ставки" />
            <Check label="Налоговая модель задана владельцем" checked={f.taxSet} onChange={(x) => setF({ ...f, taxSet: x })} />
            <Check label="Комиссии за привлечение нет (подтверждаю)" checked={f.noCommission} onChange={(x) => setF({ ...f, noCommission: x, ruleId: x ? '' : f.ruleId })} />
          </div>
        )}
        <fieldset className="card" style={{ margin: 0 }}>
          <legend><strong>Рекламный бюджет и внешние расходы клиента</strong> — не выручка агентства</legend>
          {f.xb.map((b, i) => (
            <div className="grid three" key={b.id}>
              <Field label="Название" value={b.label} onChange={(x) => setF({ ...f, xb: f.xb.map((y, j) => (j === i ? { ...y, label: x } : y)) })} />
              <Field label="Сумма, усл. ₽" value={b.amount} onChange={(x) => setF({ ...f, xb: f.xb.map((y, j) => (j === i ? { ...y, amount: x } : y)) })} hint="Пусто = неизвестно" />
              <Field label="Период" value={b.period ?? ''} onChange={(x) => setF({ ...f, xb: f.xb.map((y, j) => (j === i ? { ...y, period: x } : y)) })} />
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => setF({ ...f, xb: [...f.xb, { id: `xb_${Date.now()}`, label: '', amountKop: null, amount: '', period: null, paidBy: 'client_direct' }] })}>+ Внешний расход клиента</button>
        </fieldset>
        <ErrorBox error={a.error} />
        <div><button className="btn primary" disabled={a.busy}>Сохранить параметры</button></div>
      </form>
    </details>
  );
}

const APPLIES_LABELS = { one_time: 'к разовым работам', monthly: 'к ежемесячным работам', both: 'к разовым и ежемесячным' } as const;

function CommissionRules({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const [f, setF] = useState({ label: '', rate: '', base: 'agency_fee' as 'agency_fee' | 'other', baseDescription: '', baseAmount: '', period: '', condition: '', recipientRole: '', ownerApproved: false, appliesTo: 'one_time' as 'one_time' | 'monthly' | 'both' });
  const a = useAction();
  const est = [...v.estimates].sort((x, y) => y.number - x.number)[0];
  return (
    <details className="disclosure">
      <summary>Комиссия за привлечение: правила ({v.commissionRules.length})</summary>
      <div className="stack">
        <p className="small muted">Комиссия за привлечение — выплата партнёру из выручки агентства. Не применяется ко всем сделкам автоматически; рекламный бюджет в базу не входит. Получатель — демо-роль.</p>
        {v.commissionRules.map((r) => (
          <div key={r.id} className="row">
            <strong>{r.label}</strong> · {formatBp(r.rateBp)} от {r.base === 'agency_fee' ? 'цены услуг P (выручки агентства)' : `${r.baseDescription} (${formatKop(r.baseAmountKop)})`} · {APPLIES_LABELS[r.appliesTo ?? 'one_time']} · {r.condition ?? 'условие не указано'} · {r.recipientRole}
            {r.ownerApproved ? <Badge kind="ok">утверждено</Badge> : <Badge kind="warn">не утверждено</Badge>}
            {est && est.status === 'draft' && est.commissionRuleId !== r.id && <button className="btn small" onClick={() => void a.run(() => run({ type: 'updateEstimate', payload: { estimateId: est.id, patch: { commissionRuleId: r.id } } }))}>Применить к расчёту v{est.number}</button>}
            {est?.commissionRuleId === r.id && <Badge>применено к v{est.number}</Badge>}
          </div>
        ))}
        <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'upsertCommissionRule', payload: { label: f.label, rateBp: f.rate === '' ? null : Math.round(Number(f.rate.replace(',', '.')) * 100), base: f.base, baseDescription: f.base === 'agency_fee' ? 'Цена услуг агентства P' : f.baseDescription, baseAmountKop: f.base === 'other' ? parse(f.baseAmount) : null, period: f.period || null, condition: f.condition || null, recipientRole: f.recipientRole, ownerApproved: f.ownerApproved, appliesTo: f.appliesTo } })); }}>
          <Field label="Название" value={f.label} onChange={(x) => setF({ ...f, label: x })} required />
          <Field label="Ставка, %" value={f.rate} onChange={(x) => setF({ ...f, rate: x })} />
          <Select label="База" value={f.base} onChange={(x) => setF({ ...f, base: x })} options={[['agency_fee', 'Цена услуг P (выручка агентства)'], ['other', 'Другая явно заданная сумма']]} />
          {f.base === 'other' && (<><Field label="Описание базы" value={f.baseDescription} onChange={(x) => setF({ ...f, baseDescription: x })} /><Field label="Сумма базы, усл. ₽" value={f.baseAmount} onChange={(x) => setF({ ...f, baseAmount: x })} /></>)}
          <Select label="Применяется" value={f.appliesTo} onChange={(x) => setF({ ...f, appliesTo: x })} options={[['one_time', 'К разовым работам'], ['monthly', 'К ежемесячным работам'], ['both', 'К обеим частям']]} />
          <Field label="Период" value={f.period} onChange={(x) => setF({ ...f, period: x })} />
          <Field label="Условие возникновения" value={f.condition} onChange={(x) => setF({ ...f, condition: x })} />
          <Field label="Получатель (демо-роль)" value={f.recipientRole} onChange={(x) => setF({ ...f, recipientRole: x })} required />
          <Check label="Утверждено владельцем" checked={f.ownerApproved} onChange={(x) => setF({ ...f, ownerApproved: x })} />
          <div><button className="btn" disabled={a.busy}>Добавить правило</button></div>
        </form>
        <ErrorBox error={a.error} />
      </div>
    </details>
  );
}
