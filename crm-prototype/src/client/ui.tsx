import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import type { Role } from '../domain/types';

export interface TeamMember { id: string; displayName: string; roles: Role[] }
export interface Session { user: { id: string; displayName: string; roles: Role[]; login: string }; actingRole: Role; roleLabels: Record<Role, string> }

export const AppCtx = createContext<{ session: Session; team: TeamMember[]; teamName: (id: string | null | undefined) => string; refreshSession: () => void }>(null as never);
export const useApp = () => useContext(AppCtx);

export function Field(props: {
  label: string; hint?: string; error?: string | null; children?: ReactNode;
  value?: string; onChange?: (v: string) => void; type?: string; multiline?: boolean; required?: boolean; placeholder?: string; name?: string; disabled?: boolean;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const common = {
    id, name: props.name, value: props.value ?? '', disabled: props.disabled, placeholder: props.placeholder,
    'aria-invalid': props.error ? true : undefined, 'aria-describedby': props.error ? errId : undefined, 'aria-required': props.required || undefined,
    onChange: (e: { target: { value: string } }) => props.onChange?.(e.target.value),
  };
  return (
    <label className="field" htmlFor={id}>
      <span className="lbl">{props.label}{props.required ? ' *' : ''}</span>
      {props.hint && <span className="hint">{props.hint}</span>}
      {props.children ?? (props.multiline ? <textarea {...common} /> : <input type={props.type ?? 'text'} {...common} />)}
      {props.error && <div className="field-error" id={errId} role="alert">{props.error}</div>}
    </label>
  );
}

export function Select<T extends string>(props: { label: string; value: T | ''; onChange: (v: T) => void; options: [T, string][]; error?: string | null; hint?: string; required?: boolean; placeholder?: string }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="lbl">{props.label}{props.required ? ' *' : ''}</span>
      {props.hint && <span className="hint">{props.hint}</span>}
      <select id={id} value={props.value} aria-invalid={props.error ? true : undefined} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.placeholder !== undefined && <option value="">{props.placeholder}</option>}
        {props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {props.error && <div className="field-error" role="alert">{props.error}</div>}
    </label>
  );
}

export function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Badge({ children, kind }: { children: ReactNode; kind?: 'dark' | 'warn' | 'ok' | 'draft' }) {
  return <span className={`badge ${kind ?? ''}`}>{children}</span>;
}

/** Ошибка действия: сообщение + перечень недостающих условий. */
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="notice error" role="alert">
      <strong>{e.status === 409 ? 'Конфликт версии: ' : e.status === 403 ? 'Нет прав: ' : ''}{e.message ?? String(error)}</strong>
      {e.missing?.length ? (
        <ul>{e.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
      ) : null}
    </div>
  );
}

export function Demo({ children }: { children: ReactNode }) {
  return <div className="notice demo"><strong>Демонстрация.</strong> {children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Кнопка действия: показывает ошибку рядом, блокируется на время запроса. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/** Подтверждение разрушительного или значимого действия. */
export function Confirm(props: { open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); props.onCancel(); }} aria-labelledby="dlg-title">
      <h2 id="dlg-title">{props.title}</h2>
      <div className="stack">{props.children}</div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={props.disabled} onClick={props.onConfirm}>{props.confirmLabel}</button>
        <button className="btn" onClick={props.onCancel}>Отмена</button>
      </div>
    </dialog>
  );
}

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString('ru-RU') : '—');
export const fmtDateTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
