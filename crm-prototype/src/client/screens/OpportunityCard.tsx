import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Command } from '../../domain/commands';
import { ROUTE_LABELS, STAGE_LABELS, WORK_STAGES } from '../../domain/stages';
import type { WorkStage } from '../../domain/types';
import { PROPOSAL_STATUS_LABELS } from '../../domain/types';
import type { View } from '../types';
import { Badge, Confirm, ErrorBox, Field, fmtDate, Select, useAction, useApp } from '../ui';
import { IntakeTab } from './card/IntakeTab';
import { SourcesTab } from './card/SourcesTab';
import { DiagnosticsTab } from './card/DiagnosticsTab';
import { EconomicsTab } from './card/EconomicsTab';
import { ProposalsTab } from './card/ProposalsTab';
import { LaunchTab } from './card/LaunchTab';
import { HistoryTab } from './card/HistoryTab';

export type Run = (cmd: Command) => Promise<View>;

export interface TabProps { v: View; run: Run; reload: () => Promise<void> }

const TABS: [string, string][] = [
  ['summary', 'Вводные'],
  ['sources', 'Источники'],
  ['diagnostics', 'Диагностика'],
  ['economics', 'Работы и экономика'],
  ['proposals', 'КП и версии'],
  ['launch', 'Запуск'],
  ['history', 'История'],
];

export function OpportunityCard({ id, tab }: { id: string; tab: string }) {
  const [v, setV] = useState<View | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setV(await api.get<View>(`/api/opportunities/${id}`));
      setConflict(null);
    } catch (e) { setLoadErr(e); }
  }, [id]);
  useEffect(() => { setV(null); void reload(); }, [reload]);

  const run: Run = useCallback(async (cmd) => {
    if (!v) throw new Error('Карточка не загружена');
    try {
      const next = await api.post<View>(`/api/opportunities/${id}/commands`, { command: cmd, expectedVersion: v.rev });
      setV(next);
      return next;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
      throw e;
    }
  }, [id, v]);

  if (loadErr) return <ErrorBox error={loadErr} />;
  if (!v) return <p aria-live="polite">Загрузка карточки…</p>;

  const props: TabProps = { v, run, reload };
  return (
    <>
      <p className="small"><a href="#/opps">← Все возможности</a></p>
      <TopBlock v={v} run={run} />
      {conflict && (
        <div className="notice error" role="alert">
          <strong>Конфликт версии.</strong> {conflict}
          <div className="row" style={{ marginTop: 6 }}><button className="btn small" onClick={() => void reload()}>Обновить карточку (введённые в формы данные останутся)</button></div>
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="Разделы карточки">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { window.location.hash = `#/opp/${id}/${k}`; }}>{label}</button>
        ))}
      </div>
      <p className="small muted">Раздел карточки — не стадия сделки. Открытие «КП» или «Запуска» ничего не утверждает и не переводит сделку вперёд.</p>
      <div role="tabpanel">
        {tab === 'summary' && <IntakeTab {...props} />}
        {tab === 'sources' && <SourcesTab {...props} />}
        {tab === 'diagnostics' && <DiagnosticsTab {...props} />}
        {tab === 'economics' && <EconomicsTab {...props} />}
        {tab === 'proposals' && <ProposalsTab {...props} />}
        {tab === 'launch' && <LaunchTab {...props} />}
        {tab === 'history' && <HistoryTab {...props} />}
      </div>
    </>
  );
}

function TopBlock({ v, run }: { v: View; run: Run }) {
  const { teamName, session, team } = useApp();
  const blockers = v.tasks.filter((t) => t.blocker && t.status === 'open');
  const conflicts = v.conflicts.filter((c) => c.status === 'open');
  const pending = v.proposedChanges.filter((p) => p.status === 'pending').length;
  const [editStep, setEditStep] = useState(false);
  const [step, setStep] = useState(v.nextStep);
  const a = useAction();
  const latest = v.proposals.reduce<View['proposals'][number] | null>((x, p) => (!x || p.number > x.number ? p : x), null);
  const situation =
    v.stage === 'paused' ? `Пауза: ${v.pause?.reason}. Следующим действует: ${v.pause?.nextActor}. Возврат: ${fmtDate(v.pause?.returnDate)}`
      : v.stage === 'closed_lost' ? `Закрыто без сделки: ${v.closure?.reason}. Результат: ${v.closure?.outcome}`
        : v.stage === 'handed_off' ? 'Передано в работу'
          : `${STAGE_LABELS[v.stage]}${v.audit.type ? ` · ${ROUTE_LABELS[v.audit.type]}` : ' · маршрут не выбран'}${latest ? ` · КП v${latest.number}: ${PROPOSAL_STATUS_LABELS[latest.status].toLowerCase()}` : ''}`;
  return (
    <section className="card" aria-labelledby="opp-title">
      <div className="row">
        <h1 id="opp-title" style={{ margin: 0 }}>{v.title}</h1>
        <Badge kind="dark">{STAGE_LABELS[v.stage]}</Badge>
        {v.isDemo && <Badge kind="draft">демо-данные</Badge>}
      </div>
      <p className="muted small">Компания: {v.companyName ?? v.companyId} · Ответственный: {teamName(v.ownerUserId)} · PM пресейла: {teamName(v.presalePmUserId)} · версия записи {v.rev}</p>
      <dl className="summary">
        <div><dt>Текущая ситуация</dt><dd>{situation}</dd></div>
        <div><dt>Следующий шаг</dt><dd>{v.nextStep.text}</dd></div>
        <div><dt>Кто</dt><dd>{teamName(v.nextStep.assigneeUserId)}</dd></div>
        <div><dt>Когда</dt><dd>{fmtDate(v.nextStep.due)} {v.nextStep.due < new Date().toISOString().slice(0, 10) && <Badge kind="warn">Просрочено</Badge>}</dd></div>
      </dl>
      {(blockers.length > 0 || conflicts.length > 0 || pending > 0 || v.ownerDecisions.length > 0) && (
        <div className="row" style={{ marginTop: 10 }}>
          {conflicts.length > 0 && <a className="badge warn" href={`#/opp/${v.id}/sources`}>Противоречий: {conflicts.length}</a>}
          {blockers.map((t) => <Badge key={t.id} kind="warn">Блокер: {t.title}</Badge>)}
          {pending > 0 && <a className="badge" href={`#/opp/${v.id}/sources`}>Предложенных изменений к разбору: {pending}</a>}
          {v.ownerDecisions.map((d) => <Badge key={d}>Ждёт владельца: {d}</Badge>)}
        </div>
      )}
      {v.related.length > 0 && (
        <p className="small" style={{ marginTop: 8 }}>
          Связанные возможности: {v.related.map((r) => (
            <a key={r.opportunityId} href={`#/opp/${r.opportunityId}`} style={{ marginRight: 10 }}>
              {r.relation === 'paid_diagnostic' ? 'платная диагностика (отдельный этап)' : 'внедрение (остаётся открытым)'}
            </a>
          ))}
        </p>
      )}
      {v.restricted.map((r) => <p key={r} className="small muted">🔒 {r}</p>)}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => { setStep(v.nextStep); setEditStep(!editStep); }} aria-expanded={editStep}>Изменить следующий шаг</button>
      </div>
      {editStep && (
        <form className="grid three" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'updateBasics', payload: { nextStep: step } }); setEditStep(false); }); }}>
          <Field label="Что сделать" value={step.text} onChange={(x) => setStep({ ...step, text: x })} required />
          <Select label="Кто" value={step.assigneeUserId} onChange={(x) => setStep({ ...step, assigneeUserId: x })} options={team.map((t) => [t.id, t.displayName])} />
          <Field label="Срок" type="date" value={step.due} onChange={(x) => setStep({ ...step, due: x })} required />
          <div className="row"><button className="btn primary" disabled={a.busy}>Сохранить шаг</button></div>
          <div style={{ gridColumn: '1 / -1' }}><ErrorBox error={a.error} /></div>
        </form>
      )}
      {(session.actingRole === 'owner' || session.actingRole === 'presale_pm') && <StageActions v={v} run={run} />}
    </section>
  );
}

function StageActions({ v, run }: { v: View; run: Run }) {
  const { session } = useApp();
  const [target, setTarget] = useState<WorkStage | ''>('');
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [dlg, setDlg] = useState<'' | 'pause' | 'close'>('');
  const [p, setP] = useState({ reason: '', nextActor: '', returnDate: '' });
  const [c, setC] = useState({ reason: '', outcome: '' });
  const a = useAction();
  const d = useAction();
  if (v.stage === 'closed_lost' || v.stage === 'handed_off') return null;
  return (
    <details className="disclosure" style={{ marginTop: 10 }}>
      <summary>Стадия, пауза, закрытие</summary>
      <div className="stack">
        {v.stage === 'paused' ? (
          <div className="row">
            <span>Вернуть в стадию «{v.pause ? STAGE_LABELS[v.pause.resumeStage] : ''}»</span>
            <button className="btn primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'resume', payload: {} }))}>Вернуть с паузы</button>
          </div>
        ) : (
          <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'moveStage', payload: { target: target as WorkStage, reason, override } })); }}>
            <Select label="Перевести в стадию" value={target} onChange={setTarget} placeholder="— выберите —" options={WORK_STAGES.filter((s) => s !== v.stage).map((s) => [s, STAGE_LABELS[s]])} hint="«Обсуждаем» и «Готовим запуск» наступают только по событиям отправки и принятия КП" />
            <Field label="Причина перехода" value={reason} onChange={setReason} required />
            <div className="stack">
              {session.actingRole === 'owner' && <label className="check"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /><span>Обход ограничения владельцем (с записью в истории)</span></label>}
              <button className="btn primary" disabled={a.busy || !target}>Перевести</button>
            </div>
          </form>
        )}
        <ErrorBox error={a.error} />
        {v.stage !== 'paused' && <div className="row"><button className="btn" onClick={() => setDlg('pause')}>Поставить на паузу…</button><button className="btn danger" onClick={() => setDlg('close')}>Закрыть без сделки…</button></div>}
        {v.stage === 'paused' && <div className="row"><button className="btn danger" onClick={() => setDlg('close')}>Закрыть без сделки…</button></div>}
      </div>
      <Confirm open={dlg === 'pause'} title="Пауза" confirmLabel="Поставить на паузу" disabled={d.busy} onCancel={() => setDlg('')}
        onConfirm={() => void d.run(async () => { await run({ type: 'pause', payload: p }); setDlg(''); })}>
        <Field label="Причина" value={p.reason} onChange={(x) => setP({ ...p, reason: x })} required />
        <Field label="Кто действует следующим" value={p.nextActor} onChange={(x) => setP({ ...p, nextActor: x })} hint="Роль, например «Клиент: ЛПР»" required />
        <Field label="Дата возврата" type="date" value={p.returnDate} onChange={(x) => setP({ ...p, returnDate: x })} required />
        <ErrorBox error={d.error} />
      </Confirm>
      <Confirm open={dlg === 'close'} title="Закрыть без сделки" confirmLabel="Закрыть" disabled={d.busy} onCancel={() => setDlg('')}
        onConfirm={() => void d.run(async () => { await run({ type: 'close', payload: c }); setDlg(''); })}>
        <p>Открытые задачи будут сняты с причиной. История, факты и версии сохраняются.</p>
        <Field label="Причина" value={c.reason} onChange={(x) => setC({ ...c, reason: x })} required />
        <Field label="Результат" value={c.outcome} onChange={(x) => setC({ ...c, outcome: x })} hint="Например: «вернуться через полгода»" required />
        <ErrorBox error={d.error} />
      </Confirm>
    </details>
  );
}
