/** Идентификаторы и ошибка конфликта версии — без зависимостей от Node, работают и в браузере. */
export class ConflictError extends Error {
  constructor(public currentVersion: number) {
    super('version_conflict');
  }
}

export function newId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 16)}`;
}
