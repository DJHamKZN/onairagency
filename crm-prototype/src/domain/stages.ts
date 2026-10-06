import type { Opportunity, Stage, WorkStage } from './types';
import { FACT_KEY_LABELS } from './labels';
import { MODULE_LABELS } from './types';

export const WORK_STAGES: WorkStage[] = ['new_request', 'clarifying', 'preparing_proposal', 'discussing_proposal', 'preparing_launch'];

export const STAGE_LABELS: Record<Stage, string> = {
  new_request: '1. Новый запрос',
  clarifying: '2. Уточняем задачу',
  preparing_proposal: '3. Готовим предложение',
  discussing_proposal: '4. Обсуждаем предложение',
  preparing_launch: '5. Готовим запуск',
  handed_off: 'Передано в работу',
  paused: 'Пауза',
  closed_lost: 'Закрыто без сделки',
};

export const ROUTE_LABELS = {
  A: 'A. Конкретная работа',
  B: 'B. Предварительная внешняя проверка',
  C: 'C. Платная диагностика',
} as const;

export function stageIndex(s: Stage): number {
  return WORK_STAGES.indexOf(s as WorkStage);
}

/** Открытые значимые противоречия (конфликты фактов). */
export function openConflicts(opp: Opportunity) {
  return opp.conflicts.filter((c) => c.status === 'open');
}

/** Чего не хватает для перехода в рабочую стадию через moveStage. Пустой массив = можно. */
export function moveBlockers(opp: Opportunity, target: WorkStage): string[] {
  const missing: string[] = [];
  const from = opp.stage;
  if (from === 'paused') return ['Возможность на паузе: сначала верните её с паузы'];
  if (from === 'closed_lost' || from === 'handed_off') return [`Возможность в итоговом состоянии «${STAGE_LABELS[from]}»: смена стадии недоступна`];
  const fi = stageIndex(from);
  const ti = stageIndex(target);
  if (ti === fi) return ['Возможность уже в этой стадии'];
  if (ti < fi) return []; // назад — всегда можно с причиной, история сохраняется
  if (target === 'discussing_proposal')
    return ['В «Обсуждаем предложение» переводит только событие «Зафиксировать отправку» конкретной утверждённой версии КП'];
  if (target === 'preparing_launch')
    return ['В «Готовим запуск» переводит только событие «Зафиксировать принятие» конкретной версии КП клиентом'];
  // вперёд до clarifying / preparing_proposal
  if (!opp.ownerUserId) missing.push('Не назначен ответственный');
  if (!opp.continuation) missing.push('Не выбран способ продолжить (например: созвон, внешняя проверка, сразу оценка)');
  if (target === 'preparing_proposal') {
    if (!opp.audit.type) missing.push('Не выбран маршрут диагностики (A, B или C)');
    if (!opp.readiness) missing.push('Не зафиксировано решение: данных достаточно для предложения или предлагаем платную диагностику');
    for (const c of openConflicts(opp)) missing.push(`Нерешённое противоречие по полю «${FACT_KEY_LABELS[c.key]}» между двумя источниками`);
    if (opp.audit.type === 'B' && opp.audit.presaleLimit.hours !== null && opp.audit.spentHours > opp.audit.presaleLimit.hours && !opp.audit.overLimitDecision)
      missing.push('Превышен лимит предварительной проверки — нужно решение владельца');
    if (opp.audit.fullMarketingAudit)
      for (const m of opp.audit.modules)
        if (m.status !== 'sufficient' && !m.reason) missing.push(`Модуль аудита «${MODULE_LABELS[m.key]}»: статус без причины`);
  }
  return missing;
}

export function isActive(opp: Opportunity): boolean {
  return opp.stage !== 'closed_lost' && opp.stage !== 'handed_off';
}
