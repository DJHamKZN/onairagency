import { openDb } from '../server/db';
import { Repo } from '../server/repo';
import { DEMO_USERS, seedDemo } from '../server/seed';
import { Service } from '../server/service';
import type { Command } from '../src/domain/commands';
import { applyCommand } from '../src/domain/commands';
import type { Ctx } from '../src/domain/errors';
import type { Opportunity, Role, User } from '../src/domain/types';

let n = 0;
export const ctx = (role: Role = 'owner', userId = 'u_owner', now = '2026-10-06T10:00:00.000Z'): Ctx => ({
  userId, actingRole: role, now, newId: (p) => `${p}_t${++n}`,
});

export function seeded() {
  const repo = new Repo(openDb(':memory:'));
  const ids = seedDemo(repo, { password: 'test-pass' });
  const svc = new Service(repo);
  const U = Object.fromEntries(DEMO_USERS.map((u) => [u.login, u])) as Record<string, User>;
  const run = (id: string, cmd: Command, login = 'owner', role: Role = 'owner') => svc.run(U[login], role, id, cmd, repo.opportunity(id)!.rev).view;
  const get = (id: string) => repo.opportunity(id)!;
  return { repo, svc, ids, U, run, get };
}

/** Применить команду к агрегату в памяти (чистая доменная функция). */
export function apply(opp: Opportunity, cmd: Command, role: Role = 'owner', userId = 'u_owner', companyName: string | null = null) {
  return applyCommand(opp, cmd, ctx(role, userId), { companyName }).opp;
}

export function expectThrows(fn: () => unknown, re: RegExp): { message: string; missing: string[] } {
  try {
    fn();
  } catch (e) {
    const err = e as Error & { missing?: string[] };
    const text = `${err.message} ${(err.missing ?? []).join(' | ')}`;
    if (!re.test(text)) throw new Error(`Ожидалась ошибка ${re}, получено: ${text}`);
    return { message: err.message, missing: err.missing ?? [] };
  }
  throw new Error(`Ожидалась ошибка ${re}, но действие выполнено`);
}
