import { applyCommand, createOpportunity, type Command, type CreateOpportunityInput } from '../src/domain/commands';
import { DomainError, type Ctx } from '../src/domain/errors';
import { canRun, canView, checkActingRole, COMMAND_ROLES, listItemFor, ownerDecisions, viewFor } from '../src/domain/permissions';
import type { ChangeEvent, Company, Opportunity, Role, User } from '../src/domain/types';
import { tx } from './db';
import { ConflictError, newId, type Repo } from './repo';
import { clientExportReadiness } from '../src/domain/audit';

export class AccessError extends Error {
  constructor(public status: 403 | 404 | 401, message: string) {
    super(message);
  }
}

const ECONOMIC_ENTITIES = new Set(['CostLine', 'EstimateVersion', 'CommissionRule', 'Approval']);

export class Service {
  constructor(public repo: Repo, public clock: () => string = () => new Date().toISOString()) {}

  ctx(user: User, role: Role): Ctx {
    return { userId: user.id, actingRole: role, now: this.clock(), newId };
  }

  private load(user: User, role: Role, id: string): Opportunity {
    const opp = this.repo.opportunity(id);
    if (!opp) throw new AccessError(404, 'Возможность не найдена или недоступна');
    const v = canView(user, role, opp);
    if (!v.ok) throw new AccessError(v.status, v.message);
    return opp;
  }

  list(user: User, role: Role) {
    const r = checkActingRole(user, role);
    if (!r.ok) throw new AccessError(403, r.message);
    return this.repo
      .opportunities()
      .filter((o) => canView(user, role, o).ok)
      .map((o) => listItemFor(o, role));
  }

  view(user: User, role: Role, id: string) {
    const opp = this.load(user, role, id);
    return viewFor(opp, user, role);
  }

  history(user: User, role: Role, id: string): ChangeEvent[] {
    const opp = this.load(user, role, id);
    const hideEconomics = !(role === 'owner' || (role === 'presale_pm' && opp.pmCostVisibility));
    return this.repo.events(id).map((e) =>
      hideEconomics && ECONOMIC_ENTITIES.has(e.entityType) ? { ...e, before: '[скрыто для роли]', after: '[скрыто для роли]' } : e,
    );
  }

  create(user: User, role: Role, input: Omit<CreateOpportunityInput, 'isDemo'> & { isDemo?: boolean }) {
    const r = checkActingRole(user, role);
    if (!r.ok) throw new AccessError(403, r.message);
    if (role !== 'owner' && role !== 'presale_pm') throw new AccessError(403, 'Создавать запросы могут владелец и проджект пресейла');
    const ctx = this.ctx(user, role);
    // Сначала доменная проверка — она возвращает полный список недостающего, затем проверка ссылки на компанию.
    const { opp, events } = createOpportunity({ ...input, isDemo: input.isDemo ?? false }, ctx);
    if (!this.repo.company(input.companyId)) throw new DomainError('validation', 'Компания не найдена — выберите существующую или создайте новую', ['Компания']);
    if (role === 'presale_pm' && !opp.presalePmUserId) opp.presalePmUserId = user.id;
    tx(this.repo.db, () => {
      this.repo.insertOpportunity(opp);
      this.repo.appendEvents(opp.id, events, user.id, role, ctx.now, opp.isDemo);
    });
    return viewFor(opp, user, role);
  }

  createCompany(user: User, role: Role, name: string, isDemo = false): Company {
    if (role !== 'owner' && role !== 'presale_pm') throw new AccessError(403, 'Компании создают владелец и проджект пресейла');
    if (!name?.trim()) throw new DomainError('validation', 'Укажите название компании', ['Компания']);
    const now = this.clock();
    const c: Company = { id: newId('co'), createdAt: now, createdBy: user.id, updatedAt: now, updatedBy: user.id, rev: 1, isDemo, name: name.trim(), note: null };
    tx(this.repo.db, () => {
      this.repo.insertCompany(c);
      this.repo.appendEvents(null, [{ entityType: 'Company', entityId: c.id, action: 'created', before: null, after: { name: c.name }, reason: null }], user.id, role, now, isDemo);
    });
    return c;
  }

  /** Выполнить команду: права → версия → доменная логика → атомарное сохранение с журналом. */
  run(user: User, role: Role, id: string, cmd: Command, expectedVersion: number) {
    if (!cmd || typeof cmd !== 'object' || !(cmd.type in COMMAND_ROLES)) throw new DomainError('unknown_command', 'Неизвестное действие');
    if (cmd.payload === null || typeof cmd.payload !== 'object' || Array.isArray(cmd.payload)) throw new DomainError('validation', 'Некорректные данные действия');
    const opp = this.load(user, role, id);
    const allowed = canRun(user, role, opp, cmd.type);
    if (!allowed.ok) throw new AccessError(allowed.status, allowed.message);
    if (!Number.isInteger(expectedVersion)) throw new DomainError('validation', 'Не передана версия записи (expectedVersion)');
    if (expectedVersion !== opp.rev) throw new ConflictError(opp.rev);
    const ctx = this.ctx(user, role);
    const company = this.repo.company(opp.companyId);
    const res = applyCommand(opp, cmd, ctx, { companyName: company?.name ?? null });
    let created: Opportunity | null = null;
    for (const eff of res.effects) {
      if (eff.type === 'createLinkedDiagnostic') {
        const c = createOpportunity(
          {
            title: eff.title, companyId: opp.companyId, originalRequest: `Платная диагностика по запросу «${opp.title}»: ${opp.originalRequest}`,
            promisesNotRecorded: true, promises: [], ownerUserId: opp.ownerUserId, presalePmUserId: opp.presalePmUserId,
            nextStep: { text: 'Подготовить КП на платную диагностику: объём, срок, приёмка', assigneeUserId: opp.presalePmUserId ?? opp.ownerUserId, due: ctx.now.slice(0, 10) },
            isDemo: opp.isDemo,
          },
          ctx,
        );
        created = c.opp;
        created.leadSpecialistUserId = opp.leadSpecialistUserId;
        created.continuation = { method: `Выделено из «${opp.title}» как отдельный оплачиваемый этап`, by: user.id, at: ctx.now };
        created.audit.type = 'C';
        created.audit.rationale = opp.audit.rationale;
        created.audit.depth = opp.audit.depth === 'none' ? 'internal_diagnostics' : opp.audit.depth;
        created.related = [{ opportunityId: opp.id, relation: 'implementation' }];
        res.opp.related.push({ opportunityId: created.id, relation: 'paid_diagnostic' });
        res.opp.tasks.push({
          id: newId('tsk'), createdAt: ctx.now, createdBy: user.id, updatedAt: ctx.now, updatedBy: user.id, rev: 1, isDemo: opp.isDemo,
          title: `Внедрение остаётся открытым: вернуться после диагностики «${created.title}»`, assigneeUserId: opp.presalePmUserId, role: 'presale_pm',
          due: null, status: 'open', blocker: false, kind: 'other', cancelledReason: null,
        });
        res.events.push({ entityType: 'Opportunity', entityId: created.id, action: 'linked_paid_diagnostic_created', before: null, after: { title: created.title }, reason: 'Покупка диагностики не закрывает внедрение' });
        c.events.push({ entityType: 'Opportunity', entityId: created.id, action: 'linked_to_implementation', before: null, after: { implementation: opp.id }, reason: null });
        tx(this.repo.db, () => {
          this.repo.saveOpportunity(res.opp, expectedVersion);
          this.repo.insertOpportunity(created!);
          this.repo.appendEvents(created!.id, c.events, user.id, role, ctx.now, created!.isDemo);
          this.repo.appendEvents(opp.id, res.events, user.id, role, ctx.now, opp.isDemo);
        });
        return { view: viewFor(this.repo.opportunity(id)!, user, role), createdId: created.id };
      }
    }
    tx(this.repo.db, () => {
      this.repo.saveOpportunity(res.opp, expectedVersion);
      for (const s of res.snapshots)
        this.repo.insertSnapshot({ id: s.id, opportunityId: opp.id, kind: s.kind, hash: s.hash, data: s.data, createdAt: ctx.now, createdBy: user.id, isDemo: opp.isDemo });
      this.repo.appendEvents(opp.id, res.events, user.id, role, ctx.now, opp.isDemo);
    });
    return { view: viewFor(this.repo.opportunity(id)!, user, role), createdId: null };
  }

  dashboard(user: User, role: Role) {
    const items = this.list(user, role);
    const today = this.clock().slice(0, 10);
    const active = items.filter((i) => i.stage !== 'closed_lost' && i.stage !== 'handed_off');
    const soon = new Date(Date.parse(today) + 7 * 86400_000).toISOString().slice(0, 10);
    return {
      today,
      needsAction: active.filter((i) => i.nextStep.assigneeUserId === user.id || i.pendingChanges > 0),
      overdue: active.filter((i) => i.nextStep.due < today && i.stage !== 'paused'),
      blocked: active.filter((i) => i.blockers > 0),
      ownerDecisions: role === 'owner' ? active.filter((i) => i.ownerDecisions.length > 0) : [],
      upcoming: active.filter((i) => i.nextStep.due >= today && i.nextStep.due <= soon),
      pausedReturning: items.filter((i) => i.stage === 'paused' && i.pause && i.pause.returnDate <= soon),
    };
  }

  approvalsJournal(user: User, role: Role) {
    const out: unknown[] = [];
    for (const o of this.repo.opportunities()) {
      if (!canView(user, role, o).ok) continue;
      const showMoney = role === 'owner' || (role === 'presale_pm' && o.pmCostVisibility);
      if (role === 'specialist') continue;
      for (const a of o.approvals) {
        const p = o.proposals.find((x) => x.id === a.proposalVersionId);
        const snap = a.snapshot as { priceKop?: number; costs?: { totalKop: number | null } } | null;
        out.push({
          opportunityId: o.id, opportunityTitle: o.title, approvalId: a.id, proposalNumber: p?.number ?? null, proposalStatus: p?.status ?? null,
          approvedBy: a.approvedBy, approvedAt: a.approvedAt, status: a.status, revoked: a.revoked, comment: a.comment, snapshotHash: a.snapshotHash,
          priceKop: snap?.priceKop ?? null, costKop: showMoney ? snap?.costs?.totalKop ?? null : null,
        });
      }
    }
    return out;
  }

  findingsRegistry(user: User, role: Role) {
    const out: unknown[] = [];
    for (const o of this.repo.opportunities()) {
      if (!canView(user, role, o).ok) continue;
      const v = viewFor(o, user, role);
      for (const f of v.findings) out.push({ opportunityId: o.id, opportunityTitle: o.title, finding: f, exportReadiness: clientExportReadiness(o, f) });
    }
    return out;
  }

  ownerDecisionsFor(opp: Opportunity) {
    return ownerDecisions(opp);
  }
}
