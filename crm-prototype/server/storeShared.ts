import type { Settings } from '../src/domain/types';

/** Общие для серверного и браузерного хранилищ функции (без зависимостей от Node). */
const SECRET_KEYS = /^(password|password_hash|passwordHash|token|token_hash|secret|apiKey|api_key)$/i;

/** Журнал никогда не хранит секреты: ключи-секреты вырезаются на любой глубине. */
export function sanitizeForJournal(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sanitizeForJournal);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? '[удалено]' : sanitizeForJournal(val);
    return o;
  }
  return v;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultTargetMarginBp: 3000,
  targetMarginApproved: false,
  presaleLimitHoursDefault: null,
  presaleLimitApproved: false,
  rateCard: [
    { role: 'Специалист (демо)', rateKop: 250000, approved: false },
    { role: 'Проджект (демо)', rateKop: 200000, approved: false },
  ],
};

