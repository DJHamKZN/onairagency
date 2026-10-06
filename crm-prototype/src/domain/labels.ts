import type { FactKey, FactValue, MetricValue, BudgetMentionValue } from './types';
import { formatKop } from './money';

export const FACT_KEY_LABELS: Record<FactKey, string> = {
  request_verbatim: 'Запрос словами клиента',
  business_goal: 'Цель бизнеса',
  product: 'Продукт',
  audience: 'Аудитория',
  geography: 'География',
  deadline: 'Срок запуска',
  constraints: 'Ограничения',
  materials: 'Исходные материалы',
  decision_maker: 'Контакт и роль в решении',
  metric: 'Метрика',
  budget_mention: 'Упоминание бюджета',
  client_wish: 'Пожелание клиента',
  risk: 'Риск',
  unknown: 'Неизвестное',
};

export const SINGLE_KEYS = new Set<FactKey>([
  'request_verbatim', 'business_goal', 'product', 'audience', 'geography', 'deadline', 'constraints', 'materials', 'decision_maker',
]);

export function isMetric(v: FactValue): v is MetricValue {
  return typeof v === 'object' && v !== null && 'entity' in v;
}
export function isBudgetMention(v: FactValue): v is BudgetMentionValue {
  return typeof v === 'object' && v !== null && 'amountKop' in v;
}

export function formatFactValue(v: FactValue): string {
  if (typeof v === 'string') return v;
  if (isMetric(v))
    return `${v.kind === 'goal' ? 'Цель' : 'Факт со слов клиента'}: ${v.entity} = ${v.value ?? 'неизвестно'} ${v.unit}${v.period ? `, период: ${v.period}` : ', период не указан'}`;
  if (isBudgetMention(v))
    return `${v.amountKop === null ? 'сумма неизвестна' : formatKop(v.amountKop)}${v.period ? ` (${v.period})` : ' (период не указан)'}`;
  return JSON.stringify(v);
}
