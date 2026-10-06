import type { Bp, Kop } from './types';

export class MoneyError extends Error {}

export function assertKop(v: number, label = 'Сумма'): Kop {
  if (!Number.isSafeInteger(v)) throw new MoneyError(`${label}: ожидается целое число копеек`);
  return v;
}

export function rub(r: number): Kop {
  return assertKop(Math.round(r * 100));
}

/** Деление с округлением half-up для неотрицательных целых. */
export function divRoundHalfUp(numer: number, denom: number): number {
  if (denom <= 0) throw new MoneyError('Деление на неположительное число');
  if (numer < 0) return -divRoundHalfUp(-numer, denom);
  const q = Math.floor(numer / denom);
  const r = numer - q * denom;
  return r * 2 >= denom ? q + 1 : q;
}

export function divCeil(numer: number, denom: number): number {
  if (denom <= 0) throw new MoneyError('Деление на неположительное число');
  return Math.ceil(numer / denom);
}

/** Применение доли (bp) к сумме: amount * bp / 10000, half-up до копейки. */
export function applyBp(amount: Kop, bp: Bp): Kop {
  return divRoundHalfUp(amount * bp, 10000);
}

/** Часы хранятся с точностью до 0,01 ч: стоимость = сотые_часа * ставка / 100, half-up. */
export function hoursCost(hours: number, rateKop: Kop): Kop {
  const centi = Math.round(hours * 100);
  return divRoundHalfUp(centi * rateKop, 100);
}

const nf = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatKop(v: Kop | null | undefined): string {
  if (v === null || v === undefined) return 'не задано';
  return `${nf.format(v / 100)} усл. ₽`;
}

export function formatBp(bp: Bp | null | undefined): string {
  if (bp === null || bp === undefined) return 'не задано';
  return `${nf.format(bp / 100)} %`;
}

/** Доля a/b в процентах с 3 знаками: 36000/140000 → "25,714 %". */
export function formatShare(a: Kop, b: Kop): string {
  if (b === 0) return '—';
  const thousandths = divRoundHalfUp(a * 100000, b); // проценты * 1000
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(thousandths / 1000)} %`;
}

export function shareThousandthsOfPercent(a: Kop, b: Kop): number {
  return divRoundHalfUp(a * 100000, b);
}

/** Разбор пользовательского ввода суммы в рублях («150 000», "150000,50") → копейки или null. */
export function parseRubInput(s: string): Kop | null {
  const t = s.replace(/\s| /g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) throw new MoneyError('Введите сумму числом, например 150000 или 150000,50');
  return rub(Number(t));
}
