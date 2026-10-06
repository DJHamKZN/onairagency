import type { Role } from './types';

/** Ошибка доменного правила: понятное сообщение + список недостающих условий. */
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public missing: string[] = [],
    public field: string | null = null,
  ) {
    super(message);
  }
}

export interface Ctx {
  userId: string;
  actingRole: Role;
  now: string; // ISO datetime
  newId: (prefix: string) => string;
}

export const today = (ctx: Ctx) => ctx.now.slice(0, 10);
