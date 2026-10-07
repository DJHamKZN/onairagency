import { useState } from 'react';
import { api, download } from '../api';
import { isWebDemo } from '../mode';
import { Confirm, Demo, ErrorBox, Field, useAction, useApp } from '../ui';

interface Preview { ok: boolean; errors: string[]; warnings: string[]; counts: Record<string, number>; token: string | null; note: string }

export function Admin() {
  const { session } = useApp();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState('');
  const [dlg, setDlg] = useState<'' | 'import' | 'reset'>('');
  const [phrase, setPhrase] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const a = useAction();
  const b = useAction();
  const [backupText, setBackupText] = useState('');
  const [copied, setCopied] = useState('');
  if (session.actingRole !== 'owner') return <div className="notice">Резервные копии, импорт и очистка демо-данных доступны только владельцу. Сервер проверяет это на каждом запросе.</div>;
  return (
    <div className="stack">
      <h1>Данные и настройки</h1>
      <Demo>Это ручной экспорт и импорт, а не автоматическое резервное копирование. Резервная копия — внутренний документ: в ней себестоимость, маржа, комиссии и журнал. Пароли и сессии в неё не входят.</Demo>
      {done && <div className="notice" role="status">{done}</div>}
      <section className="card">
        <h2>Резервная копия</h2>
        <p>JSON с версией схемы, датой и предупреждением о внутреннем содержимом.</p>
        {isWebDemo() ? (
          <>
            <p className="small">В веб-демо файл не скачивается. Покажите копию и скопируйте текст — его можно сохранить в файл .json и позже загрузить ниже.</p>
            <button className="btn primary" disabled={a.busy} onClick={() => void a.run(async () => setBackupText(JSON.stringify(await api.get('/api/admin/backup'), null, 2)))}>Показать резервную копию</button>
            {backupText && (
              <div className="stack" style={{ marginTop: 8 }}>
                <label className="field" htmlFor="backup-text"><span className="lbl">Резервная копия (JSON, внутреннее содержимое)</span>
                  <textarea id="backup-text" readOnly value={backupText} style={{ minHeight: 160 }} onFocus={(e) => e.currentTarget.select()} /></label>
                <div className="row">
                  <button className="btn" onClick={() => { navigator.clipboard?.writeText(backupText).then(() => setCopied('Скопировано'), () => setCopied('Не удалось скопировать — выделите текст и скопируйте вручную')); }}>Скопировать</button>
                  {copied && <span className="small" role="status">{copied}</span>}
                </div>
              </div>
            )}
          </>
        ) : (
          <button className="btn primary" disabled={a.busy} onClick={() => void a.run(() => download('/api/admin/backup'))}>Скачать резервную копию</button>
        )}
        <ErrorBox error={a.error} />
      </section>
      <section className="card">
        <h2>Импорт резервной копии</h2>
        <p className="small">Сначала проверка: версия схемы, типы, размер (до 10 МБ) и связи. Текущая база не меняется до отдельного подтверждения. Восстановление идёт в отдельный файл базы; прежний файл сохраняется рядом.</p>
        <label className="field">
          <span className="lbl">Файл копии (.json)</span>
          <input type="file" accept="application/json,.json" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            setPreview(null);
            void b.run(async () => setPreview(await api.postRaw<Preview>('/api/admin/import/preview', await f.text())));
          }} />
        </label>
        <ErrorBox error={b.error} />
        {preview && (
          <div className={`notice ${preview.ok ? '' : 'error'}`} style={{ marginTop: 10 }} role="status">
            <strong>{fileName}: {preview.ok ? 'проверка пройдена' : 'копия отклонена'}</strong>
            {preview.errors.length > 0 && <ul>{preview.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            {preview.warnings.map((w, i) => <p key={i} className="small">⚠ {w}</p>)}
            {preview.ok && <ul>{Object.entries(preview.counts).map(([k, n]) => <li key={k}>{k}: {n}</li>)}</ul>}
            <p className="small">{preview.note}</p>
            {preview.ok && <button className="btn danger" onClick={() => { setPhrase(''); setDlg('import'); }}>Заменить текущую базу этой копией…</button>}
          </div>
        )}
      </section>
      <section className="card">
        <h2>Демо-данные</h2>
        <p>Удаляет только записи с признаком демо-данных и заново загружает синтетические кейсы. Записи без признака демо остаются.</p>
        <button className="btn danger" onClick={() => { setPhrase(''); setDlg('reset'); }}>Очистить демо-данные…</button>
      </section>
      <Confirm open={dlg === 'import'} title="Заменить базу" confirmLabel="Заменить" disabled={b.busy} onCancel={() => setDlg('')}
        onConfirm={() => void b.run(async () => { const r = await api.post<{ archivedPreviousDb: string | null }>('/api/admin/import/confirm', { token: preview?.token, confirmText: phrase }); setDlg(''); setPreview(null); setDone(isWebDemo() ? 'Данные заменены копией' : `База заменена. Прежний файл: ${r.archivedPreviousDb ?? '(база в памяти)'}`); })}>
        <p>Текущие данные будут заменены содержимым копии. Прежний файл базы сохранится рядом.</p>
        <Field label="Введите «ЗАМЕНИТЬ БАЗУ»" value={phrase} onChange={setPhrase} required />
        <ErrorBox error={b.error} />
      </Confirm>
      <Confirm open={dlg === 'reset'} title="Очистить демо-данные" confirmLabel="Очистить" disabled={b.busy} onCancel={() => setDlg('')}
        onConfirm={() => void b.run(async () => { await api.post('/api/admin/reset-demo', { confirmText: phrase }); setDlg(''); setDone('Демо-данные очищены и загружены заново'); })}>
        <Field label="Введите «ОЧИСТИТЬ ДЕМО»" value={phrase} onChange={setPhrase} required />
        <ErrorBox error={b.error} />
      </Confirm>
    </div>
  );
}
