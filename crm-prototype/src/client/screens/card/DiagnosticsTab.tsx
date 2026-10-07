import { useState } from 'react';
import { download } from '../../api';
import { isWebDemo } from '../../mode';
import { ROUTE_LABELS } from '../../../domain/stages';
import type { AuditFinding, AuditModule, ClaimType, LeadPathLevel, LeadPathStatus, ModuleKey, ModuleStatus, RouteType } from '../../../domain/types';
import { CLAIM_TYPE_LABELS, LEAD_PATH_LABELS, LEAD_PATH_LEVELS, MODULE_LABELS, MODULE_STATUS_LABELS, VERIFICATION_LABELS } from '../../../domain/types';
import type { TabProps } from '../OpportunityCard';
import { Badge, Check, Demo, Empty, ErrorBox, Field, Select, useAction, useApp } from '../../ui';

const ROUTE_HELP: Record<RouteType, string> = {
  A: 'Понятны результат, границы, исходники, зависимости и приёмка. Короткая проверка и оценка; полный аудит и три файла не нужны.',
  B: 'Изучение доступных материалов и публичного пути клиента для содержательного разговора. Лимит времени задаёт владелец; по умолчанию он не утверждён.',
  C: 'Комплексная или неопределённая задача: отдельный оплачиваемый этап с собственным КП, объёмом, сроком и приёмкой. Внедрение — отдельная возможность.',
};
const LP_LABELS: Record<LeadPathStatus, string> = { not_checked: 'Не проверено', observed_publicly: 'Наблюдается публично', confirmed_by_client_data: 'Подтверждено данными клиента', not_applicable: 'Неприменимо' };

export function DiagnosticsTab({ v, run }: TabProps) {
  const { session } = useApp();
  return (
    <div className="stack">
      <RouteBlock v={v} run={run} />
      {v.audit.type === 'B' && <PresaleLimit v={v} run={run} owner={session.actingRole === 'owner'} />}
      {(v.audit.type === 'B' || v.audit.externalSummary) && <ExternalSummary v={v} run={run} />}
      <ModulesBlock v={v} run={run} />
      <LeadPathBlock v={v} run={run} />
      <FindingsBlock v={v} run={run} />
      {v.audit.fullMarketingAudit && <Deliverables v={v} run={run} />}
    </div>
  );
}

function RouteBlock({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const [type, setType] = useState<RouteType | ''>(v.audit.type ?? '');
  const [rationale, setRationale] = useState(v.audit.rationale ?? '');
  const [depth, setDepth] = useState(v.audit.depth);
  const [full, setFull] = useState(v.audit.fullMarketingAudit);
  const [diagTitle, setDiagTitle] = useState(`${v.companyName ?? ''} — платная диагностика`);
  const a = useAction();
  const d = useAction();
  return (
    <section className="card">
      <h2>Маршрут диагностики</h2>
      <p className="small muted">Маршрут выбирается по неопределённости задачи. Глубина определяется вопросом и доступами, а не шаблоном.</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'setRoute', payload: { type: type as RouteType, rationale, depth, fullMarketingAudit: full } })); }}>
        <fieldset>
          <legend className="small"><strong>Маршрут</strong></legend>
          {(['A', 'B', 'C'] as RouteType[]).map((r) => (
            <label key={r} className="check" style={{ marginBottom: 6 }}>
              <input type="radio" name="route" checked={type === r} onChange={() => setType(r)} />
              <span><strong>{ROUTE_LABELS[r]}</strong><br /><span className="small">{ROUTE_HELP[r]}</span></span>
            </label>
          ))}
        </fieldset>
        <div className="grid three">
          <Field label="Почему этот маршрут" value={rationale} onChange={setRationale} required />
          <Select label="Глубина" value={depth} onChange={setDepth} options={[['none', 'Без аудита'], ['external_evidence', 'Внешний доказательный аудит по публичным данным'], ['internal_diagnostics', 'Внутренняя диагностика по согласованным выгрузкам и доступам']]} />
          <div className="stack"><Check label="Полный маркетинговый аудит (включается явно; три результата)" checked={full} onChange={setFull} /></div>
        </div>
        <div><button className="btn primary" disabled={a.busy || !type}>Сохранить маршрут</button></div>
        <ErrorBox error={a.error} />
      </form>
      {v.audit.type === 'C' && !v.related.some((r) => r.relation === 'paid_diagnostic') && (
        <div className="notice" style={{ marginTop: 10 }}>
          <strong>Платная диагностика — отдельная возможность.</strong> Её покупка не закрывает внедрение: текущая возможность останется открытой.
          <div className="row" style={{ marginTop: 6 }}>
            <input type="text" aria-label="Название возможности диагностики" value={diagTitle} onChange={(e) => setDiagTitle(e.target.value)} style={{ maxWidth: 420 }} />
            <button className="btn" disabled={d.busy} onClick={() => void d.run(async () => { const r = await run({ type: 'requestDiagnosticOpportunity', payload: { title: diagTitle } }); if (r.createdId) window.location.hash = `#/opp/${r.createdId}`; })}>Создать связанную возможность</button>
          </div>
          <ErrorBox error={d.error} />
        </div>
      )}
    </section>
  );
}

function PresaleLimit({ v, run, owner }: Pick<TabProps, 'v' | 'run'> & { owner: boolean }) {
  const [hours, setHours] = useState('');
  const [log, setLog] = useState('');
  const [dec, setDec] = useState('');
  const a = useAction();
  const lim = v.audit.presaleLimit;
  const over = lim.hours !== null && v.audit.spentHours > lim.hours;
  return (
    <section className="card">
      <h2>Лимит предварительной проверки</h2>
      <p>Лимит: <strong>{lim.hours === null ? 'не утверждён владельцем' : `${lim.hours} ч (утверждён)`}</strong> · потрачено: <strong>{v.audit.spentHours} ч</strong> {over && <Badge kind="warn">Превышен{v.audit.overLimitDecision ? ' — есть решение владельца' : ' — нужно решение владельца'}</Badge>}</p>
      <div className="row">
        <input type="number" min="0" step="0.5" aria-label="Потрачено часов" placeholder="часы" value={log} onChange={(e) => setLog(e.target.value)} style={{ maxWidth: 120 }} />
        <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'logPresaleHours', payload: { hours: Number(log) } }))}>Записать часы</button>
        {owner && (<>
          <input type="number" min="0" step="0.5" aria-label="Лимит часов" placeholder="лимит, ч" value={hours} onChange={(e) => setHours(e.target.value)} style={{ maxWidth: 120 }} />
          <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'approvePresaleLimit', payload: { hours: Number(hours) } }))}>Утвердить лимит</button>
        </>)}
      </div>
      {owner && over && !v.audit.overLimitDecision && (
        <div className="row" style={{ marginTop: 6 }}>
          <input type="text" aria-label="Решение по превышению" placeholder="Решение владельца по превышению" value={dec} onChange={(e) => setDec(e.target.value)} style={{ maxWidth: 380 }} />
          <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'decideOverLimit', payload: { comment: dec } }))}>Зафиксировать решение</button>
        </div>
      )}
      <ErrorBox error={a.error} />
    </section>
  );
}

function ExternalSummary({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const s = v.audit.externalSummary;
  const [f, setF] = useState({ understood: s?.understood ?? '', checked: s?.checked ?? '', unknown: s?.unknown ?? '', questions: s?.questions ?? '', recommendedRoute: (s?.recommendedRoute ?? '') as RouteType | '' });
  const a = useAction();
  return (
    <section className="card">
      <h2>Итог предварительной проверки</h2>
      <form className="grid two" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'setExternalSummary', payload: { ...f, recommendedRoute: f.recommendedRoute || null } })); }}>
        <Field label="Что поняли" multiline value={f.understood} onChange={(x) => setF({ ...f, understood: x })} />
        <Field label="Что проверили" multiline value={f.checked} onChange={(x) => setF({ ...f, checked: x })} />
        <Field label="Неизвестное" multiline value={f.unknown} onChange={(x) => setF({ ...f, unknown: x })} />
        <Field label="Вопросы" multiline value={f.questions} onChange={(x) => setF({ ...f, questions: x })} />
        <Select label="Рекомендуемый маршрут" value={f.recommendedRoute} onChange={(x) => setF({ ...f, recommendedRoute: x })} placeholder="не определён" options={[['A', ROUTE_LABELS.A], ['B', ROUTE_LABELS.B], ['C', ROUTE_LABELS.C]]} />
        <div><button className="btn" disabled={a.busy}>Сохранить итог</button></div>
      </form>
      <ErrorBox error={a.error} />
    </section>
  );
}

function ModulesBlock({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  return (
    <section className="card">
      <h2>Карта направлений</h2>
      <p className="small muted">Нет данных — это статус направления, а не нулевой результат и не отрицательная оценка бизнеса. Глубокий разбор — только для выбранных сценариев.</p>
      <div className="table-wrap">
        <table className="t stack-sm">
          <thead><tr><th>Направление</th><th>Статус</th><th>Причина / доступ / заблокированное решение</th><th></th></tr></thead>
          <tbody>{v.audit.modules.map((m) => <ModuleRow key={m.key} m={m} run={run} />)}</tbody>
        </table>
      </div>
    </section>
  );
}

function ModuleRow({ m, run }: { m: AuditModule; run: TabProps['run'] }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(m);
  const a = useAction();
  return (
    <tr>
      <td data-label="Направление">{MODULE_LABELS[m.key]}{m.deepDive && <div><Badge>глубокий разбор</Badge></div>}</td>
      <td data-label="Статус"><Badge kind={m.status === 'sufficient' ? 'ok' : m.status === 'needs_access' || m.status === 'not_done' ? 'warn' : undefined}>{MODULE_STATUS_LABELS[m.status]}</Badge></td>
      <td data-label="Детали" className="small">{[m.reason, m.accessNeeded && `Доступ: ${m.accessNeeded} (${m.accessOwnerRole})`, m.blockedDecision && `Заблокировано решение: ${m.blockedDecision}`].filter(Boolean).join(' · ') || '—'}</td>
      <td>
        <button className="btn small" aria-expanded={edit} onClick={() => { setF(m); setEdit(!edit); }}>Изменить</button>
        {edit && (
          <form className="stack" style={{ marginTop: 6, minWidth: 240 }} onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'setModule', payload: f }); setEdit(false); }); }}>
            <Select label="Статус" value={f.status} onChange={(x) => setF({ ...f, status: x })} options={Object.entries(MODULE_STATUS_LABELS) as [ModuleStatus, string][]} />
            <Field label="Причина" value={f.reason ?? ''} onChange={(x) => setF({ ...f, reason: x || null })} />
            {f.status === 'needs_access' && (<>
              <Field label="Какой доступ нужен" value={f.accessNeeded ?? ''} onChange={(x) => setF({ ...f, accessNeeded: x || null })} hint="Ссылка на защищённое место, без паролей" />
              <Field label="У кого (роль)" value={f.accessOwnerRole ?? ''} onChange={(x) => setF({ ...f, accessOwnerRole: x || null })} />
              <Field label="Какое решение заблокировано" value={f.blockedDecision ?? ''} onChange={(x) => setF({ ...f, blockedDecision: x || null })} />
            </>)}
            <Check label="Глубокий разбор" checked={f.deepDive} onChange={(x) => setF({ ...f, deepDive: x })} />
            <button className="btn small primary" disabled={a.busy}>Сохранить</button>
            <ErrorBox error={a.error} />
          </form>
        )}
      </td>
    </tr>
  );
}

function LeadPathBlock({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const a = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <section className="card">
      <h2>Путь заявки</h2>
      <Demo>Прототип не выполняет контрольных отправок. Каждый уровень отмечается отдельно; отправка или доставка не подтверждает обработку и качество обращения.</Demo>
      <div className="table-wrap">
        <table className="t stack-sm">
          <thead><tr><th>Уровень</th><th>Статус</th><th>Чем подтверждено</th><th></th></tr></thead>
          <tbody>
            {LEAD_PATH_LEVELS.map((l: LeadPathLevel) => {
              const cur = v.audit.leadPath[l];
              return (
                <tr key={l}>
                  <td data-label="Уровень">{LEAD_PATH_LABELS[l]}</td>
                  <td data-label="Статус"><Badge kind={cur.status === 'confirmed_by_client_data' ? 'ok' : undefined}>{LP_LABELS[cur.status]}</Badge></td>
                  <td data-label="Чем подтверждено" className="small">{cur.note ?? '—'}</td>
                  <td>
                    <div className="row">
                      <select aria-label={`Статус уровня «${LEAD_PATH_LABELS[l]}»`} value={cur.status} style={{ width: 'auto' }} onChange={(e) => void a.run(() => run({ type: 'setLeadPath', payload: { level: l, status: e.target.value as LeadPathStatus, note: notes[l] ?? cur.note } }))}>
                        {Object.entries(LP_LABELS).map(([k, lab]) => <option key={k} value={k}>{lab}</option>)}
                      </select>
                      <input type="text" aria-label={`Комментарий для уровня «${LEAD_PATH_LABELS[l]}»`} placeholder="чем подтверждено" value={notes[l] ?? ''} onChange={(e) => setNotes({ ...notes, [l]: e.target.value })} style={{ maxWidth: 200 }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ErrorBox error={a.error} />
    </section>
  );
}

function FindingsBlock({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  return (
    <section className="card">
      <h2>Находки <span className="muted">({v.findings.length})</span></h2>
      <p className="small muted">Наблюдение отделено от гипотезы о причине. Ссылка или заполненное поле не являются доказательством: проверяющий явно отмечает, подтверждает ли цитата вывод.</p>
      {v.findings.length === 0 ? <Empty>Находок нет — для маршрута A это нормально</Empty> : v.findings.map((f) => <FindingItem key={f.id} f={f} v={v} run={run} />)}
      <AddFinding v={v} run={run} />
    </section>
  );
}

export function FindingItem({ f, v, run }: { f: AuditFinding } & Pick<TabProps, 'v' | 'run'>) {
  const { session } = useApp();
  const [comment, setComment] = useState('');
  const a = useAction();
  const src = v.sources.find((s) => s.id === f.sourceId);
  const canReview = session.actingRole === 'owner' || session.actingRole === 'lead_specialist';
  return (
    <article className="card">
      <div className="row"><strong>{f.code}. {f.title}</strong><Badge>{MODULE_LABELS[f.module]}</Badge><Badge>{CLAIM_TYPE_LABELS[f.claimType]}</Badge>
        <Badge kind={f.verification === 'supported' ? 'ok' : 'warn'}>{VERIFICATION_LABELS[f.verification]}</Badge></div>
      <dl className="kv small" style={{ marginTop: 6 }}>
        <dt>Наблюдение</dt><dd>{f.observation}</dd>
        <dt>Гипотеза о причине</dt><dd>{f.causeHypothesis ?? '—'}</dd>
        <dt>Основание данных</dt><dd>{{ external_public: 'Внешние публичные данные', internal_client_data: 'Внутренние данные клиента', client_words: 'Слова клиента' }[f.dataBasis]}</dd>
        <dt>Источник</dt><dd>{src ? `${src.title} (v${src.version}, ${src.status === 'active' ? 'актуален' : 'неактуален'})` : 'не указан'} · дата {f.sourceDate ?? '—'} · период {f.dataPeriod ?? '—'} · область {f.scope ?? '—'}</dd>
        <dt>Доказательство (цитата)</dt><dd>{f.evidenceQuote ? `«${f.evidenceQuote}»` : 'нет'}</dd>
        <dt>Граница доказательства</dt><dd>{f.evidenceReview ? `${f.evidenceReview.supportsClaim ? 'Подтверждает вывод' : 'НЕ подтверждает вывод'}: ${f.evidenceReview.comment}` : 'Проверяющий ещё не оценил, подтверждает ли цитата именно этот вывод'}</dd>
        <dt>Ограничение</dt><dd>{f.limitation ?? '—'}</dd>
        <dt>Влияние</dt><dd>{f.impact ?? '—'}</dd>
        <dt>Рекомендация</dt><dd>{f.recommendation ?? '—'}</dd>
        <dt>Проверка эффекта</dt><dd>{f.effectCheck ?? '—'}</dd>
        {f.recheckReason && (<><dt>Повторная проверка</dt><dd>{f.recheckReason}</dd></>)}
      </dl>
      {canReview && (
        <div className="row" style={{ marginTop: 6 }}>
          <input type="text" aria-label={`Комментарий проверки ${f.code}`} placeholder="Комментарий проверяющего (обязательно)" value={comment} onChange={(e) => setComment(e.target.value)} style={{ maxWidth: 380 }} />
          <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'reviewEvidence', payload: { findingId: f.id, supportsClaim: true, comment } }))}>Цитата подтверждает вывод</button>
          <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'reviewEvidence', payload: { findingId: f.id, supportsClaim: false, comment } }))}>Не подтверждает</button>
        </div>
      )}
      <ErrorBox error={a.error} />
    </article>
  );
}

function AddFinding({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const empty = { title: '', module: 'site_path' as ModuleKey, claimType: 'observation' as ClaimType, dataBasis: 'external_public' as AuditFinding['dataBasis'], observation: '', causeHypothesis: '', sourceId: '', evidenceQuote: '', limitation: '', impact: '', recommendation: '', effectCheck: '', dataPeriod: '', scope: '' };
  const [f, setF] = useState(empty);
  const a = useAction();
  const n = (s: string) => s.trim() || null;
  return (
    <details className="disclosure" style={{ marginTop: 10 }}>
      <summary>Добавить находку</summary>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void a.run(async () => {
        await run({ type: 'addFinding', payload: { title: f.title, module: f.module, claimType: f.claimType, dataBasis: f.dataBasis, observation: f.observation, causeHypothesis: n(f.causeHypothesis), sourceId: n(f.sourceId), evidenceQuote: n(f.evidenceQuote), limitation: n(f.limitation), impact: n(f.impact), recommendation: n(f.recommendation), effectCheck: n(f.effectCheck), dataPeriod: n(f.dataPeriod), scope: n(f.scope), sourceDate: v.sources.find((s) => s.id === f.sourceId)?.receivedAt ?? null } });
        setF(empty); }); }}>
        <div className="grid three">
          <Field label="Название" value={f.title} onChange={(x) => setF({ ...f, title: x })} required />
          <Select label="Направление" value={f.module} onChange={(x) => setF({ ...f, module: x })} options={Object.entries(MODULE_LABELS) as [ModuleKey, string][]} />
          <Select label="Тип утверждения" value={f.claimType} onChange={(x) => setF({ ...f, claimType: x })} options={Object.entries(CLAIM_TYPE_LABELS) as [ClaimType, string][]} />
          <Select label="Основание данных" value={f.dataBasis} onChange={(x) => setF({ ...f, dataBasis: x })} options={[['external_public', 'Внешние публичные данные'], ['internal_client_data', 'Внутренние данные клиента'], ['client_words', 'Слова клиента']]} />
          <Select label="Источник" value={f.sourceId} onChange={(x) => setF({ ...f, sourceId: x })} placeholder="не указан" options={v.sources.filter((s) => s.status === 'active').map((s) => [s.id, s.title])} />
          <Field label="Период данных" value={f.dataPeriod} onChange={(x) => setF({ ...f, dataPeriod: x })} />
        </div>
        <Field label="Наблюдение" multiline value={f.observation} onChange={(x) => setF({ ...f, observation: x })} required />
        <Field label="Гипотеза о причине (отдельно от наблюдения)" value={f.causeHypothesis} onChange={(x) => setF({ ...f, causeHypothesis: x })} />
        <Field label="Цитата или строка-доказательство" multiline value={f.evidenceQuote} onChange={(x) => setF({ ...f, evidenceQuote: x })} hint="URL сам по себе не является доказательством" />
        <div className="grid two">
          <Field label="Ограничение" value={f.limitation} onChange={(x) => setF({ ...f, limitation: x })} />
          <Field label="Предполагаемое влияние" value={f.impact} onChange={(x) => setF({ ...f, impact: x })} />
          <Field label="Рекомендация" value={f.recommendation} onChange={(x) => setF({ ...f, recommendation: x })} />
          <Field label="Как проверить эффект" value={f.effectCheck} onChange={(x) => setF({ ...f, effectCheck: x })} />
        </div>
        <ErrorBox error={a.error} />
        <div><button className="btn primary" disabled={a.busy}>Добавить находку</button></div>
      </form>
    </details>
  );
}

const DELIV_LABELS = { client_brief_pdf: '1. Выжимка для клиента (PDF)', client_detailed_docx: '2. Клиентский аудит (Word)', internal_docx: '3. Внутренний аудит команды (Word)' } as const;

function Deliverables({ v, run }: { v: TabProps['v']; run: TabProps['run'] }) {
  const a = useAction();
  const [note, setNote] = useState('');
  const base = `/api/opportunities/${v.id}/export/audit`;
  const saved = v.audit.deliverables.some((d) => d.snapshotId);
  const setNumber = Math.max(0, ...v.audit.deliverables.map((d) => d.setNumber ?? 0));
  return (
    <section className="card">
      <h2>Три результата полного аудита</h2>
      <p className="small">Выжимка, клиентский аудит и внутренний аудит команды сохраняются одним комплектом из одной версии находок. Клиентские документы включают только находки с проверенным доказательством (или явно помеченные гипотезы) и показывают невыполненные направления как пробелы. Внутренний документ в клиентский экспорт не входит.</p>
      <p>{saved ? <>Сохранён комплект №{setNumber} · {fmtDateTimeShort(v.audit.deliverables[0]?.lastGeneratedAt)}</> : 'Комплект ещё не сохранён.'}</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'saveAuditDeliverables', payload: { limitationsNote: note || null } })); }}>
        <input type="text" aria-label="Примечание об ограничениях комплекта" placeholder="Примечание об ограничениях (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} style={{ maxWidth: 360 }} />
        <button className="btn primary" disabled={a.busy}>{saved ? 'Сохранить новый комплект' : 'Сохранить комплект документов'}</button>
      </form>
      {saved && (isWebDemo()
        ? <p className="small"><strong>В веб-демо файлы не скачиваются.</strong> Комплект сохранён в данных браузера; файлы формирует локальная версия.</p>
        : <div className="row" style={{ marginTop: 8 }}>
            {(['client_brief_pdf', 'client_detailed_docx', 'internal_docx'] as const).map((k) => (
              <button key={k} className="btn" disabled={a.busy} onClick={() => void a.run(() => download(`${base}/${k}`))}>{DELIV_LABELS[k]}</button>
            ))}
          </div>)}
      <Demo>Файлы формируются локально из сохранённой версии. Клиенту ничего не отправляется.</Demo>
      <ErrorBox error={a.error} />
    </section>
  );
}

const fmtDateTimeShort = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
