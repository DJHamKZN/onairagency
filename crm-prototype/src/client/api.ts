export class ApiError extends Error {
  constructor(public status: number, message: string, public code: string, public missing: string[] = [], public field: string | null = null) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': raw ? 'text/plain' : 'application/json', 'x-requested-with': 'onair-crm' },
    body: body === undefined ? undefined : raw ? (body as string) : JSON.stringify(body),
  });
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const d = (typeof data === 'object' ? data : { message: String(data) }) as { message?: string; error?: string; missing?: string[]; field?: string };
    throw new ApiError(r.status, d.message ?? `Ошибка ${r.status}`, d.error ?? 'error', d.missing ?? [], d.field ?? null);
  }
  return data as T;
}

export const api = {
  get: <T,>(p: string) => call<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  put: <T,>(p: string, b?: unknown) => call<T>('PUT', p, b ?? {}),
  postRaw: <T,>(p: string, text: string) => call<T>('POST', p, text, true),
};

/** Скачать файл экспорта (локально, в браузер). Ничего не отправляется клиенту. */
export async function download(path: string) {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) {
    let msg = `Ошибка ${r.status}`;
    try { msg = (await r.json()).message ?? msg; } catch { /* */ }
    throw new ApiError(r.status, msg, 'download');
  }
  const cd = r.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const name = m ? decodeURIComponent(m[1]) : 'export';
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
