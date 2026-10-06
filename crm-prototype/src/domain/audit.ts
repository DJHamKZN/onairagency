import type { AuditFinding, AuditModule, AuditRoute, LeadPathLevel, ModuleKey, Opportunity } from './types';
import { LEAD_PATH_LABELS, LEAD_PATH_LEVELS, MODULE_LABELS } from './types';

export const MODULE_KEYS = Object.keys(MODULE_LABELS) as ModuleKey[];

export function emptyAudit(): AuditRoute {
  return {
    type: null,
    rationale: null,
    depth: 'none',
    fullMarketingAudit: false,
    presaleLimit: { hours: null, approvedBy: null, approvedAt: null },
    spentHours: 0,
    overLimitDecision: null,
    modules: MODULE_KEYS.map((key): AuditModule => ({ key, status: 'not_done', reason: null, accessNeeded: null, accessOwnerRole: null, blockedDecision: null, deepDive: false })),
    scenarios: [],
    leadPath: Object.fromEntries(LEAD_PATH_LEVELS.map((l) => [l, { status: 'not_checked', note: null }])) as AuditRoute['leadPath'],
    deliverables: [],
    externalSummary: null,
  };
}

/** Проверка статуса модуля: «нет данных» не превращается в результат. */
export function validateModule(m: AuditModule): string[] {
  const e: string[] = [];
  if (m.status !== 'sufficient' && m.status !== 'not_done' && !m.reason?.trim()) e.push(`«${MODULE_LABELS[m.key]}»: для статуса нужна причина`);
  if (m.status === 'needs_access' && (!m.accessNeeded?.trim() || !m.accessOwnerRole?.trim()))
    e.push(`«${MODULE_LABELS[m.key]}»: укажите, какой доступ нужен и у кого (роль)`);
  if (m.status === 'needs_access' && !m.blockedDecision?.trim()) e.push(`«${MODULE_LABELS[m.key]}»: укажите, какое решение заблокировано`);
  return e;
}

const INTERNAL_ONLY = /(cac|cpl|cpa|маржинальн|маржа|рентабельн|качество лид|конверси[яи] (в )?продаж|причин[аы]? потер|окупаемост|romi|ltv)/i;

/** Внешние данные не позволяют утверждать внутренние показатели. */
export function externalOverreach(f: Pick<AuditFinding, 'dataBasis' | 'claimType' | 'observation' | 'title'>): string | null {
  if (f.dataBasis !== 'external_public') return null;
  if (f.claimType === 'hypothesis' || f.claimType === 'unknown') return null;
  if (INTERNAL_ONLY.test(`${f.title} ${f.observation}`))
    return 'По внешним публичным источникам нельзя утверждать CAC, маржу, рентабельность, качество лидов, реальную конверсию продаж или причины потерь. Отметьте как гипотезу или используйте внутренние данные';
  return null;
}

export function isUrlOnly(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^\s*(https?:\/\/\S+|www\.\S+)\s*$/i.test(s);
}

/** Почему находку нельзя отметить как подтверждённую доказательством. Пусто = можно. */
export function supportBlockers(opp: Opportunity, f: AuditFinding): string[] {
  const b: string[] = [];
  if (!f.sourceId) b.push('Не указан источник');
  else {
    const s = opp.sources.find((x) => x.id === f.sourceId);
    if (!s) b.push('Источник не найден');
    else if (s.status !== 'active') b.push('Источник неактуален (заменён или на карантине) — нужна повторная проверка');
  }
  if (!f.evidenceQuote?.trim()) b.push('Нет цитаты или строки-доказательства');
  else if (isUrlOnly(f.evidenceQuote)) b.push('URL не является доказательством: нужна конкретная цитата или строка');
  for (const n of f.numbers) {
    if (!n.entity || !n.unit || !n.period || !n.method) b.push(`Число ${n.value}: нужны сущность, единица, период и способ расчёта`);
    if (n.unit === '%' && !n.denominator) b.push(`Число ${n.value} %: нужен знаменатель`);
  }
  const over = externalOverreach(f);
  if (over) b.push(over);
  return b;
}

/** Готова ли находка к клиентскому экспорту. Только явное подтверждение проверяющим, а не наличие ссылки. */
export function clientExportReadiness(opp: Opportunity, f: AuditFinding): { ready: boolean; reason: string } {
  if (f.verification === 'needs_recheck') return { ready: false, reason: 'Источник изменился — требуется повторная проверка' };
  if (f.claimType === 'hypothesis' || f.claimType === 'unknown') {
    if (!f.limitation?.trim()) return { ready: false, reason: 'Гипотеза/неизвестное без явного ограничения' };
    return { ready: true, reason: `Экспортируется с пометкой «${f.claimType === 'hypothesis' ? 'Гипотеза' : 'Неизвестно'}»` };
  }
  if (f.verification !== 'supported') return { ready: false, reason: f.verification === 'not_supported' ? 'Цитата не подтверждает вывод' : 'Доказательство не проверено' };
  const b = supportBlockers(opp, f);
  if (b.length) return { ready: false, reason: b.join('; ') };
  return { ready: true, reason: 'Доказательство проверено' };
}

/** Каждый уровень пути заявки проверяется отдельно; подтверждение одного не подтверждает следующие. */
export function leadPathSummary(route: AuditRoute): { level: LeadPathLevel; label: string; status: string }[] {
  return LEAD_PATH_LEVELS.map((level) => ({ level, label: LEAD_PATH_LABELS[level], status: route.leadPath[level].status }));
}

export function deliverablesRequired(route: AuditRoute): boolean {
  return route.fullMarketingAudit;
}
