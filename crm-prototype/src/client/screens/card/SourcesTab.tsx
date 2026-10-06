import { useState } from 'react';
import { FACT_KEY_LABELS, formatFactValue } from '../../../domain/labels';
import type { ProposedChange, Source, SourceKind } from '../../../domain/types';
import type { TabProps } from '../OpportunityCard';
import { Badge, Demo, Empty, ErrorBox, Field, fmtDate, fmtDateTime, Select, useAction } from '../../ui';

const KIND_LABELS: Record<SourceKind, string> = { note: 'Заметка', transcript: 'Расшифровка (текст)', email: 'Письмо (текст)', link: 'Ссылка', file_text: 'Текст из файла' };
const PC_LABELS: Record<ProposedChange['kind'], string> = {
  fact: 'Сведение', metric: 'Метрика', budget_mention: 'Упоминание бюджета', client_wish: 'Пожелание клиента',
  promise_candidate: 'Кандидат в обещания', conditional: 'Условное высказывание', clarification: 'Вопрос',
};

export function SourcesTab({ v, run }: TabProps) {
  const pending = v.proposedChanges.filter((p) => p.status === 'pending');
  const conflicts = v.conflicts.filter((c) => c.status === 'open');
  return (
    <div className="stack">
      <Demo>«Демо-разбор» — детерминированные правила по ключевым словам, а не AI и не транскрибация. Разбор только предлагает изменения: каждое принимает человек. Записи созвонов прототип не делает и не принимает.</Demo>
      <section className="card" aria-labelledby="h-conf">
        <h2 id="h-conf">Противоречия <span className="muted">({conflicts.length})</span></h2>
        {conflicts.length === 0 ? <Empty>Открытых противоречий нет</Empty> : conflicts.map((c) => <ConflictBox key={c.id} c={c} v={v} run={run} />)}
      </section>
      <section className="card" aria-labelledby="h-queue">
        <h2 id="h-queue">Очередь предложенных изменений <span className="muted">({pending.length})</span></h2>
        {pending.length === 0 ? <Empty>Нечего разбирать. Добавьте источник и запустите демо-разбор.</Empty> : (
          <div className="table-wrap">
            <table className="t stack-sm">
              <thead><tr><th>Тип</th><th>Предложение</th><th>Цитата</th><th>Пояснение</th><th>Решение</th></tr></thead>
              <tbody>{pending.map((p) => <PcRow key={p.id} p={p} v={v} run={run} />)}</tbody>
            </table>
          </div>
        )}
        {v.proposedChanges.some((p) => p.status !== 'pending') && (
          <details className="disclosure" style={{ marginTop: 10 }}>
            <summary>Разобранные ({v.proposedChanges.filter((p) => p.status !== 'pending').length})</summary>
            <ul className="small">{v.proposedChanges.filter((p) => p.status !== 'pending').map((p) => (
              <li key={p.id}>{PC_LABELS[p.kind]}: {formatFactValue(p.value)} — <strong>{{ accepted: 'принято', rejected: 'отклонено', conflict: 'противоречие', pending: '' }[p.status]}</strong> {p.decision && `(${fmtDateTime(p.decision.at)})`}</li>
            ))}</ul>
          </details>
        )}
      </section>
      <section className="card" aria-labelledby="h-src">
        <h2 id="h-src">Источники</h2>
        {v.sources.length === 0 ? <Empty>Источников пока нет</Empty> : v.sources.map((s) => <SourceItem key={s.id} s={s} v={v} run={run} />)}
        <AddSource v={v} run={run} />
      </section>
    </div>
  );
}

function PcRow({ p, v, run }: { p: ProposedChange } & Pick<TabProps, 'v' | 'run'>) {
  const a = useAction();
  const src = v.sources.find((s) => s.id === p.sourceId);
  return (
    <tr>
      <td data-label="Тип"><Badge>{PC_LABELS[p.kind]}</Badge>{p.key && <div className="small">{FACT_KEY_LABELS[p.key]}</div>}</td>
      <td data-label="Предложение">{formatFactValue(p.value)}{p.addressedToRole && <div className="small">Кому: {p.addressedToRole}</div>}</td>
      <td data-label="Цитата" className="small">«{p.excerpt}»{p.timecode && ` [${p.timecode}]`}<div className="muted">{src?.title}</div></td>
      <td data-label="Пояснение" className="small">{p.note}</td>
      <td data-label="Решение">
        <div className="row">
          <button className="btn small primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'decideProposedChange', payload: { id: p.id, accept: true } }))}>Принять</button>
          <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'decideProposedChange', payload: { id: p.id, accept: false, comment: 'Отклонено проверяющим' } }))}>Отклонить</button>
        </div>
        <ErrorBox error={a.error} />
      </td>
    </tr>
  );
}

function ConflictBox({ c, v, run }: { c: TabProps['v']['conflicts'][number] } & Pick<TabProps, 'v' | 'run'>) {
  const [choice, setChoice] = useState<'keep_existing' | 'take_proposed' | 'needs_clarification'>('needs_clarification');
  const [comment, setComment] = useState('');
  const a = useAction();
  const s1 = v.sources.find((s) => s.id === c.existingSourceId);
  const s2 = v.sources.find((s) => s.id === c.proposedSourceId);
  return (
    <div className="notice error" style={{ marginBottom: 10 }}>
      <h3>{FACT_KEY_LABELS[c.key]}: два источника расходятся</h3>
      <div className="grid two">
        <div className="card" style={{ margin: 0 }}><div className="small muted">Сейчас в карточке · {s1?.title ?? 'ручной ввод'} · {fmtDate(s1?.receivedAt)}</div><strong>{formatFactValue(c.existingValue)}</strong></div>
        <div className="card" style={{ margin: 0 }}><div className="small muted">Новый источник · {s2?.title} · {fmtDate(s2?.receivedAt)}</div><strong>{formatFactValue(c.proposedValue)}</strong></div>
      </div>
      <p className="small">Более поздний источник не выбирается автоматически. Решение и автор попадут в историю.</p>
      <form className="grid three" onSubmit={(e) => { e.preventDefault(); void a.run(() => run({ type: 'resolveConflict', payload: { conflictId: c.id, choice, comment } })); }}>
        <Select label="Решение проверяющего" value={choice} onChange={setChoice} options={[['keep_existing', 'Оставить текущее значение'], ['take_proposed', 'Принять значение нового источника'], ['needs_clarification', 'Требует уточнения у клиента']]} />
        <Field label="Комментарий (обязательно)" value={comment} onChange={setComment} required />
        <div><button className="btn primary" disabled={a.busy}>Зафиксировать решение</button></div>
      </form>
      <ErrorBox error={a.error} />
    </div>
  );
}

function SourceItem({ s, run }: { s: Source } & Pick<TabProps, 'v' | 'run'>) {
  const a = useAction();
  const [comment, setComment] = useState('');
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(s.text);
  const [reason, setReason] = useState('');
  return (
    <article className="card" style={{ background: s.status === 'active' ? undefined : '#fafbfd' }}>
      <div className="row">
        <strong>{s.title}</strong>
        <Badge>{KIND_LABELS[s.kind]}</Badge>
        <Badge>v{s.version}</Badge>
        <Badge kind={s.status === 'active' ? 'ok' : 'warn'}>{{ active: 'Актуален', superseded: 'Заменён новой версией', quarantined: 'Карантин: нужно решение', rejected: 'Отклонён' }[s.status]}</Badge>
        <Badge kind="draft">{s.original.filename ? `Файл «${s.original.filename}» не сохранён — сохранён только текст` : 'Сохранён только текст'}</Badge>
      </div>
      <p className="small muted">Дата источника: {fmtDate(s.receivedAt)} · компания в источнике: {s.declaredCompany ?? 'не указана'} · добавлен {fmtDateTime(s.createdAt)}{s.parsedAt && ` · демо-разбор ${fmtDateTime(s.parsedAt)}`}</p>
      {s.link && <p className="small">Ссылка (записана как текст, прототип её не открывает и не проверяет): <span className="mono">{s.link}</span></p>}
      {s.quarantineReason && <div className="notice error">{s.quarantineReason}</div>}
      <details><summary className="small">Текст источника ({s.text.length} симв.)</summary><pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{s.text}</pre></details>
      <div className="row" style={{ marginTop: 6 }}>
        {s.status === 'active' && !s.parsedAt && <button className="btn small primary" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'parseSource', payload: { sourceId: s.id } }))}>Демо-разбор (правила, не AI)</button>}
        {s.status === 'active' && <button className="btn small" onClick={() => setEdit(!edit)} aria-expanded={edit}>Новая версия текста</button>}
      </div>
      {s.status === 'quarantined' && (
        <div className="row" style={{ marginTop: 6 }}>
          <input type="text" aria-label="Комментарий к решению по источнику" placeholder="Комментарий (обязательно)" value={comment} onChange={(e) => setComment(e.target.value)} style={{ maxWidth: 320 }} />
          <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'decideSourceAttribution', payload: { sourceId: s.id, accept: true, comment } }))}>Относится к этой возможности</button>
          <button className="btn small" disabled={a.busy} onClick={() => void a.run(() => run({ type: 'decideSourceAttribution', payload: { sourceId: s.id, accept: false, comment } }))}>Не относится — отклонить</button>
        </div>
      )}
      {edit && (
        <form className="stack" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await run({ type: 'updateSourceText', payload: { sourceId: s.id, text, reason } }); setEdit(false); }); }}>
          <Field label="Текст новой версии" multiline value={text} onChange={setText} />
          <Field label="Причина изменения" value={reason} onChange={setReason} hint="Зависимые сведения и находки будут помечены «требует повторной проверки»; прежняя версия сохранится" required />
          <button className="btn" disabled={a.busy}>Сохранить новую версию</button>
        </form>
      )}
      <ErrorBox error={a.error} />
    </article>
  );
}

function AddSource({ v, run }: Pick<TabProps, 'v' | 'run'>) {
  const [f, setF] = useState({ kind: 'note' as SourceKind, title: '', declaredCompany: v.companyName ?? '', receivedAt: '', text: '', link: '', originalFilename: '', replacesSourceId: '' });
  const a = useAction();
  return (
    <details className="disclosure" style={{ marginTop: 10 }}>
      <summary>Добавить источник: вставить заметку или текст расшифровки</summary>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        void a.run(async () => {
          await run({ type: 'addSource', payload: { ...f, link: f.link || null, originalFilename: f.originalFilename || null, receivedAt: f.receivedAt || null, replacesSourceId: f.replacesSourceId || null, declaredCompany: f.declaredCompany || null } });
          setF({ ...f, title: '', text: '', link: '', originalFilename: '' });
        });
      }}>
        <p className="small muted">Только синтетический текст. Не вставляйте пароли, ключи и персональные данные. Файлы прототип не принимает и не хранит.</p>
        <div className="grid three">
          <Select label="Тип" value={f.kind} onChange={(x) => setF({ ...f, kind: x })} options={Object.entries(KIND_LABELS) as [SourceKind, string][]} />
          <Field label="Название" value={f.title} onChange={(x) => setF({ ...f, title: x })} hint="Например: «Демо-заметка 3»" required />
          <Field label="Дата источника" type="date" value={f.receivedAt} onChange={(x) => setF({ ...f, receivedAt: x })} />
          <Field label="Компания, к которой относится источник" value={f.declaredCompany} onChange={(x) => setF({ ...f, declaredCompany: x })} hint="Несовпадение с карточкой отправит источник на карантин" />
          <Field label="Имя исходного файла (только метаданные)" value={f.originalFilename} onChange={(x) => setF({ ...f, originalFilename: x })} hint="Сам файл не сохраняется" />
          <Select label="Заменяет источник" value={f.replacesSourceId} onChange={(x) => setF({ ...f, replacesSourceId: x })} placeholder="— новый источник —" options={v.sources.filter((s) => s.status === 'active').map((s) => [s.id, `${s.title} (v${s.version})`])} />
        </div>
        <Field label="Текст" multiline value={f.text} onChange={(x) => setF({ ...f, text: x })} hint="Таймкоды в формате [00:12:34] в начале строки сохраняются" />
        <Field label="Ссылка на источник (как текст)" value={f.link} onChange={(x) => setF({ ...f, link: x })} />
        <ErrorBox error={a.error} />
        <div><button className="btn primary" disabled={a.busy}>Добавить источник</button></div>
      </form>
    </details>
  );
}
