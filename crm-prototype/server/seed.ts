/** Серверная часть наполнения: пароли тестовых учётных записей. Данные кейсов — в seedData.ts (работает и в браузере). */
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth';
import type { RepoLike } from './repoTypes';
import { DEMO_USERS, seedDemoData } from './seedData';

export { DEMO_USERS, DEMO_SOURCES } from './seedData';

export function ensureUsers(repo: RepoLike, password: string) {
  const hash = hashPassword(password);
  for (const u of DEMO_USERS) repo.upsertUser(u, hash);
}

export function resolveDemoPassword(): { password: string; generated: boolean } {
  const env = process.env.DEMO_USER_PASSWORD;
  if (env && env.trim()) return { password: env.trim(), generated: false };
  return { password: randomBytes(9).toString('base64url'), generated: true };
}

export function seedDemo(repo: RepoLike, opts: { password?: string } = {}) {
  if (opts.password) ensureUsers(repo, opts.password);
  return seedDemoData(repo);
}
