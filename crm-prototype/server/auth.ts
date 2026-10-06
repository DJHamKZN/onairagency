import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** scrypt-хэш пароля: salt:hash (hex). Пароли не хранятся и не логируются. */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 32);
  return `scrypt:${salt.toString('hex')}:${h.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [alg, saltHex, hashHex] = stored.split(':');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const h = scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === h.length && timingSafeEqual(expected, h);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Простейшее ограничение попыток входа (в памяти процесса). */
const attempts = new Map<string, { n: number; until: number }>();
export function loginAllowed(key: string): boolean {
  const a = attempts.get(key);
  return !a || a.until < Date.now() || a.n < 10;
}
export function loginFailed(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + 15 * 60_000 });
  else a.n += 1;
}
export function loginSucceeded(key: string) {
  attempts.delete(key);
}
