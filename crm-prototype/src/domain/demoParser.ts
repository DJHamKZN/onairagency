/**
 * РАЗБОР ПО КЛЮЧЕВЫМ СЛОВАМ: детерминированные правила на регулярных выражениях.
 * Это НЕ ИИ и не интеграция с языковой моделью. Разбор только предлагает изменения с цитатами;
 * каждое значимое предложение принимает человек. Для результата внешнего инструмента есть отдельный
 * «импорт структурированного результата» (тоже с проверкой человеком).
 */
import type { FactKey, FactValue, ProposedChangeKind } from './types';

export interface ParsedProposal {
  kind: ProposedChangeKind;
  key: FactKey | null;
  value: FactValue;
  excerpt: string;
  timecode: string | null;
  note: string;
  addressedToRole: string | null;
}

const MONTHS: Record<string, string> = {
  января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05', июня: '06',
  июля: '07', августа: '08', сентября: '09', октября: '10', ноября: '11', декабря: '12',
};

const LABELLED: [RegExp, FactKey][] = [
  [/^запрос\s*:/i, 'request_verbatim'],
  [/^цель бизнеса\s*:/i, 'business_goal'],
  [/^продукт\s*:/i, 'product'],
  [/^аудитория\s*:/i, 'audience'],
  [/^география\s*:/i, 'geography'],
  [/^ограничения\s*:/i, 'constraints'],
  [/^материалы\s*:/i, 'materials'],
  [/^лпр\s*:/i, 'decision_maker'],
  [/^риск\s*:/i, 'risk'],
];

const METRIC_ENTITIES: [RegExp, string][] = [
  [/^регистрац/i, 'регистрации'],
  [/^оплат/i, 'оплаты'],
  [/^подпис/i, 'подписки'],
  [/^заяв/i, 'заявки'],
  [/^обращени/i, 'обращения'],
  [/^лид/i, 'лиды'],
];

function splitSentences(text: string): { sentence: string; timecode: string | null }[] {
  const out: { sentence: string; timecode: string | null }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    let timecode: string | null = null;
    const tc = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/);
    if (tc) {
      timecode = tc[1];
      line = line.slice(tc[0].length);
    }
    // Строки «Метка: значение» не дробим.
    if (LABELLED.some(([re]) => re.test(line))) {
      out.push({ sentence: line, timecode });
      continue;
    }
    for (const s of line.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«"])/)) if (s.trim()) out.push({ sentence: s.trim(), timecode });
  }
  return out;
}

function parseAmount(s: string): number | null {
  const n = Number(s.replace(/[\s ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function demoParse(text: string): ParsedProposal[] {
  const res: ParsedProposal[] = [];
  for (const { sentence, timecode } of splitSentences(text)) {
    const push = (p: Omit<ParsedProposal, 'excerpt' | 'timecode'>) => res.push({ ...p, excerpt: sentence, timecode });

    // 1. Плейсхолдеры — никогда не факт.
    const placeholders = sentence.match(/\[уточнить[^\]]*\]/gi);
    if (placeholders) {
      for (const ph of placeholders)
        push({
          kind: 'clarification', key: null, value: `В источнике плейсхолдер ${ph}: значение не указано. Уточнить у клиента.`,
          note: 'Плейсхолдер не становится фактом', addressedToRole: 'Клиент: контактное лицо',
        });
    }
    const clean = sentence.replace(/\[уточнить[^\]]*\]/gi, '…');

    // 2. Условные высказывания — не факт и не обязательство.
    if (/(^|[^а-яё])если([^а-яё]|$)/i.test(clean) && /(запустим|сделаем|успеем|получится|подключим|сдадим)/i.test(clean)) {
      push({
        kind: 'conditional', key: null, value: clean,
        note: 'Условное высказывание: не факт и не обязательство. Предлагается вопрос для уточнения', addressedToRole: 'Клиент: контактное лицо',
      });
      continue;
    }

    // 3. Незнание аналитики — адресный вопрос владельцу данных.
    if (/(не знаю|не знает|не в курсе|не владеет)/i.test(clean) && /(аналитик|метрик|конверси|данн|cpl|cac)/i.test(clean)) {
      push({
        kind: 'clarification', key: null, value: 'Кто владеет данными по аналитике и может дать выгрузку обращений, статусов и оплат?',
        note: 'Собеседник не знает аналитику: метрики не восстанавливаются из предположений', addressedToRole: 'Владелец данных клиента (роль не определена)',
      });
      continue;
    }

    // 4. Пожелание скидки — пожелание клиента, не согласованная скидка.
    if (/скидк/i.test(clean)) {
      push({
        kind: 'client_wish', key: 'client_wish', value: clean,
        note: 'Пожелание клиента — не согласованная скидка и не обещание агентства', addressedToRole: null,
      });
      continue;
    }

    // 5. Обещание агентства — только кандидат со статусом «обсуждалось».
    if (/(^|[^а-яё])(мы|агентство|владелец|проджект)\s+(пообещал\w*|обещал\w*|гарантир\w*|сделаем|подготовим|запустим|сдадим|успеем|бесплатно\s+сделаем)/i.test(clean)) {
      push({
        kind: 'promise_candidate', key: null, value: clean,
        note: 'Кандидат в обещания агентства. После принятия статус «обсуждалось», подтверждение — отдельным действием', addressedToRole: null,
      });
    }

    // 6. Поля «Метка: значение».
    const lab = LABELLED.find(([re]) => re.test(clean));
    if (lab) {
      const value = clean.replace(lab[0], '').trim();
      if (value) push({ kind: 'fact', key: lab[1], value, note: 'Поле, размеченное в заметке', addressedToRole: null });
      continue;
    }

    // 7. Даты запуска/сроков.
    const dateRe = /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/gi;
    if (/(запуск|старт|срок|дедлайн|запустить|запуститься|опубликовать)/i.test(clean)) {
      for (const m of clean.matchAll(dateRe)) {
        const iso = `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
        push({ kind: 'fact', key: 'deadline', value: iso, note: 'Дата из источника (слова клиента)', addressedToRole: null });
      }
    }

    // 8. Упоминания бюджета — каждое отдельно, без суммирования.
    if (/(бюджет|готовы потратить|готовы выделить|на рекламу|на первый тест)/i.test(clean)) {
      const moneyRe = /(\d{1,3}(?:[\s ]\d{3})+|\d{4,})\s*(?:₽|руб(?:лей|\.)?|р\.)?/g;
      for (const m of clean.matchAll(moneyRe)) {
        const amount = parseAmount(m[1]);
        // Период берётся из того же предложения; одно предложение — одно упоминание.
        const period = /(в месяц|ежемесячно|\/\s*мес)/i.test(clean)
          ? 'в месяц'
          : /первый тест/i.test(clean) ? 'на первый тест'
            : /первый месяц/i.test(clean) ? 'на первый месяц' : null;
        push({
          kind: 'budget_mention', key: 'budget_mention',
          value: { amountKop: amount === null ? null : Math.round(amount * 100), period, purpose: null },
          note: 'Упоминание бюджета: не подтверждённый бюджет и не цена. Разные упоминания не складываются', addressedToRole: null,
        });
      }
    }

    // 9. Метрики: факт или цель.
    const isGoal = /(цель|хотим|хотят|план|нужно получить|задача —)/i.test(clean);
    for (const m of clean.matchAll(/(\d+)\s+([А-Яа-яЁё]+)/g)) {
      const ent = METRIC_ENTITIES.find(([re]) => re.test(m[2]));
      if (!ent) continue;
      push({
        kind: 'metric', key: 'metric',
        value: { kind: isGoal ? 'goal' : 'actual', entity: ent[1], value: Number(m[1]), unit: 'шт.', period: null, denominator: null },
        note: isGoal ? 'Цель клиента — не факт продаж' : 'Значение со слов клиента; период и источник данных не указаны', addressedToRole: null,
      });
    }
  }
  return res;
}
