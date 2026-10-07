/**
 * Локальная генерация документов. Ничего не отправляется клиенту и не загружается во внешние системы.
 * DOCX — настоящий редактируемый Word (библиотека docx), A4, поля 20 / 19,6 / 26 мм.
 * PDF — pdf-lib с системным TTF-шрифтом с кириллицей (Arial / Liberation Sans / DejaVu Sans).
 * Логотип не добавляется: официальный файл логотипа не предоставлен.
 */
import { existsSync, readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ClientAuditExport, ClientProposalExport, HandoffExport, exportInternalAudit } from '../src/domain/clientExport';
import { formatKop } from '../src/domain/money';

const MM_TWIP = 56.6929;
const PAGE = {
  size: { width: 11906, height: 16838 },
  margin: { top: Math.round(20 * MM_TWIP), bottom: Math.round(26 * MM_TWIP), left: Math.round(19.6 * MM_TWIP), right: Math.round(19.6 * MM_TWIP) },
};
const DARK = '192440';
const TEXT = '3C4560';
const MUTED = '6B7386';

type Block = { h?: string; p?: string; muted?: boolean; table?: string[][] };

function para(text: string, opts: { bold?: boolean; color?: string; size?: number } = {}) {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? TEXT, size: opts.size ?? 22, font: 'Arial' })] });
}

function blocksToDocx(title: string, banner: string, blocks: Block[]): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 160 }, children: [new TextRun({ text: title, bold: true, color: DARK, size: 36, font: 'Arial' })] }),
    para(banner, { color: MUTED, size: 20 }),
  ];
  for (const b of blocks) {
    if (b.h) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: b.h, bold: true, color: DARK, size: 26, font: 'Arial' })] }));
    if (b.p) children.push(para(b.p, { color: b.muted ? MUTED : TEXT }));
    if (b.table)
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.table.map((row, ri) =>
            new TableRow({
              children: row.map((cell) =>
                new TableCell({
                  borders: { top: { style: BorderStyle.SINGLE, size: 4, color: 'DCE1EA' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DCE1EA' }, left: { style: BorderStyle.SINGLE, size: 4, color: 'DCE1EA' }, right: { style: BorderStyle.SINGLE, size: 4, color: 'DCE1EA' } },
                  children: [para(cell, { bold: ri === 0, size: 20 })],
                }),
              ),
            }),
          ),
        }),
      );
  }
  const doc = new Document({
    creator: 'ON AIR CRM (локальный прототип)',
    title,
    styles: { default: { document: { run: { font: 'Arial', size: 22, color: TEXT } } } },
    sections: [
      {
        properties: { page: PAGE },
        headers: { default: new Header({ children: [para(banner, { color: MUTED, size: 16 })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['Стр. ', PageNumber.CURRENT], size: 16, color: MUTED, font: 'Arial' })] })] }) },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const v = (s: string | null | undefined) => (s && String(s).trim() ? String(s) : 'не указано');

export function proposalBlocks(e: ClientProposalExport): Block[] {
  return [
    { h: 'Что мы поняли', p: v(e.understanding) },
    { h: 'Что предлагаем первым и почему', p: v(e.firstOfferWhy) },
    { h: 'Результат и приёмка', p: v(e.resultAndAcceptance) },
    {
      h: 'Состав работ',
      table: [['Работа', 'Объём', 'Результат', 'Критерий приёмки', 'Тип'], ...e.works.map((w) => [w.title, `${w.quantity ?? '—'} ${w.unit ?? ''}`, v(w.expectedResult), v(w.acceptanceCriterion), w.recurrence])],
    },
    { h: 'Сроки и зависимости', p: `${v(e.timeline)}. Зависимости: ${v(e.dependencies)}` },
    { h: 'Материалы и действия клиента', p: v(e.clientActions) },
    {
      h: 'Стоимость услуг агентства',
      p: [
        e.serviceOneTimeKop !== null ? `Разовые работы: ${formatKop(e.serviceOneTimeKop)}${e.discountKop ? ` (с учётом скидки ${formatKop(e.discountKop)})` : ''}` : null,
        e.serviceMonthlyKop !== null ? `Ежемесячные работы: ${formatKop(e.serviceMonthlyKop)} в месяц` : null,
      ].filter(Boolean).join('\n') || 'не рассчитана',
    },
    {
      h: 'Рекламный бюджет и внешние расходы клиента (не входят в стоимость услуг)',
      p: e.externalBudgets.length ? e.externalBudgets.map((b) => `${b.label}: ${formatKop(b.amountKop)}${b.period ? `, ${b.period}` : ''} — ${b.paidBy}`).join('; ') : 'Не предусмотрены',
    },
    { p: e.externalBudgetsNote, muted: true },
    { h: 'Оплата', p: v(e.payment) },
    { h: 'Правки', p: v(e.revisions) },
    { h: 'Исключения', p: v(e.exclusions) },
    { h: 'Бесплатные работы', p: e.freeWork ? e.freeWork : 'Не предусмотрены' },
    { h: 'Срок действия предложения', p: v(e.validUntil) },
    { h: 'Порядок дополнительных работ', p: v(e.extraWorkProcedure) },
    { h: 'Следующий шаг', p: v(e.nextStep) },
  ];
}

export function proposalDocx(e: ClientProposalExport) {
  return blocksToDocx(`Коммерческое предложение — ${e.company}, версия ${e.versionNumber}`, `${e.watermark}. Локальный экспорт прототипа; суммы в условных рублях.`, proposalBlocks(e));
}

export function auditBlocks(e: ClientAuditExport): Block[] {
  return [
    { p: e.scopeNote },
    { h: 'Статус направлений', table: [['Направление', 'Статус', 'Причина / нужный доступ'], ...e.modules.map((m) => [m.module, m.status, [m.reason, m.accessNeeded].filter(Boolean).join('; ') || '—'])] },
    { h: 'Путь заявки (каждый уровень проверяется отдельно)', table: [['Уровень', 'Статус'], ...e.leadPath.map((l) => [l.level, l.status])] },
    ...e.findings.flatMap((f): Block[] => [
      { h: `${f.code}. ${f.title}` },
      { p: `${f.module} · ${f.claimType}` , muted: true },
      { p: `Наблюдение: ${f.observation}` },
      ...(f.causeHypothesis ? [{ p: `Гипотеза о причине (не доказано): ${f.causeHypothesis}` }] : []),
      ...(f.evidenceQuote ? [{ p: `Доказательство: «${f.evidenceQuote}» (дата источника: ${v(f.sourceDate)}, период данных: ${v(f.dataPeriod)})` }] : []),
      ...f.numbers.map((n) => ({ p: `Число: ${n.entity} = ${n.value} ${n.unit}, период ${n.period}${n.denominator ? `, знаменатель ${n.denominator}` : ''}; способ: ${n.method}` })),
      { p: `Ограничение: ${v(f.limitation)}` },
      { p: `Влияние (предположение): ${v(f.impact)}` },
      { p: `Рекомендация: ${v(f.recommendation)}` },
      ...(f.effectCheck ? [{ p: `Как проверить эффект: ${f.effectCheck}` }] : []),
    ]),
    { h: 'Не вошло в документ', p: `Находок без проверенного доказательства: ${e.excludedCount}. Они остаются во внутренних материалах.` },
    { h: 'Ограничения', p: e.limitations.join('\n') },
  ];
}

export function auditDocx(e: ClientAuditExport) {
  return blocksToDocx(`${e.documentType} — ${e.company}`, e.draftNote, auditBlocks(e));
}

export function internalDocx(title: string, blocks: Block[]) { // оставлено для совместимости

  return blocksToDocx(title, 'ВНУТРЕННИЙ ДОКУМЕНТ КОМАНДЫ. Не передавать клиенту. Содержит экономику, задачи, допущения и риски.', blocks);
}

/* ---------- PDF ---------- */

const FONT_CANDIDATES = [
  ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'],
  ['/Library/Fonts/Arial.ttf', '/Library/Fonts/Arial Bold.ttf'],
  ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
  ['/usr/share/fonts/truetype/msttcorefonts/Arial.ttf', '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
];

export function findFonts(): { regular: string; bold: string } | null {
  const env = process.env.PDF_FONT_PATH;
  if (env && existsSync(env)) return { regular: env, bold: env };
  for (const [r, b] of FONT_CANDIDATES) if (existsSync(r)) return { regular: r, bold: existsSync(b) ? b : r };
  return null;
}

export class PdfFontMissing extends Error {}

export async function blocksToPdf(title: string, banner: string, blocks: Block[]): Promise<Uint8Array> {
  const fonts = findFonts();
  if (!fonts) throw new PdfFontMissing('Не найден TTF-шрифт с кириллицей. Укажите PDF_FONT_PATH в .env (например, путь к Arial или Liberation Sans)');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const reg = await pdf.embedFont(readFileSync(fonts.regular), { subset: true });
  const bold = await pdf.embedFont(readFileSync(fonts.bold), { subset: true });
  pdf.setTitle(title);
  pdf.setCreator('ON AIR CRM (локальный прототип)');
  const mm = 2.83465;
  const W = 595.28, H = 841.89, L = 19.6 * mm, R = 19.6 * mm, T = 20 * mm, B = 26 * mm;
  const maxW = W - L - R;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - T;
  const color = (hex: string) => rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - T;
    page.drawText(banner, { x: L, y: H - 12 * mm, size: 7.5, font: reg, color: color(MUTED) });
  };
  page.drawText(banner, { x: L, y: H - 12 * mm, size: 7.5, font: reg, color: color(MUTED) });
  const write = (text: string, font: PDFFont, size: number, hex: string, gap = 4) => {
    for (const rawLine of text.split('\n')) {
      const words = rawLine.split(/\s+/);
      let line = '';
      const flush = () => {
        if (y - size < B) newPage();
        page.drawText(line, { x: L, y: y - size, size, font, color: color(hex) });
        y -= size * 1.35;
        line = '';
      };
      for (const w of words) {
        const cand = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(cand, size) > maxW && line) { flush(); line = w; } else line = cand;
      }
      if (line) flush();
    }
    y -= gap;
  };
  write(title, bold, 16, DARK, 8);
  for (const b of blocks) {
    if (b.h) { y -= 6; write(b.h, bold, 12, DARK); }
    if (b.p) write(b.p, reg, 10, b.muted ? MUTED : TEXT);
    if (b.table) for (const [i, row] of b.table.entries()) write(row.join(' · '), i === 0 ? bold : reg, 9, TEXT, 2);
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`Стр. ${i + 1} из ${pages.length}`, { x: W - R - 60, y: 12 * mm, size: 8, font: reg, color: color(MUTED) }));
  return pdf.save();
}

export function auditBriefPdf(e: ClientAuditExport) {
  const brief: Block[] = [
    { p: e.scopeNote },
    { h: 'Главные выводы', p: e.findings.length ? e.findings.map((f) => `${f.code}. ${f.title} — ${f.observation}`).join('\n') : 'Нет выводов с проверенным доказательством' },
    { h: 'Приоритеты и следующий этап', p: e.findings.map((f) => f.recommendation).filter(Boolean).join('\n') || 'Определяются после проверки доказательств' },
    { h: 'Направления, требующие доступа или не выполненные', p: e.modules.filter((m) => m.status !== 'Достаточно для решения' && m.status !== 'Неприменимо').map((m) => `${m.module}: ${m.status}${m.reason ? ` — ${m.reason}` : ''}`).join('\n') || 'Нет' },
    { h: 'Ограничения', p: e.limitations.join('\n') },
  ];
  return blocksToPdf(`Краткий отчёт по аудиту — ${e.company}`, e.draftNote, brief);
}

export function handoffBlocks(e: HandoffExport): Block[] {
  const t = e.terms;
  return [
    { p: `Источник договорённостей: принятая клиентом версия КП v${t.versionNumber} (${v(t.acceptedDate)}, подтверждение: ${v(t.confirmationSource)}). Договорённости не переписываются вручную — изменения только через новую версию КП.`, muted: true },
    { h: 'Объём и результат', table: [['Работа', 'Объём', 'Результат', 'Критерий приёмки', 'Тип'], ...t.works.map((w) => [w.title, `${w.quantity ?? '—'} ${w.unit ?? ''}`, v(w.expectedResult), v(w.acceptanceCriterion), w.recurrence === 'monthly' ? 'Ежемесячная' : 'Разовая'])] },
    { h: 'Результат и приёмка', p: v(t.resultAndAcceptance) },
    { h: 'Исключения', p: v(t.exclusions) },
    { h: 'Правки', p: v(t.revisions) },
    { h: 'Сроки и зависимости', p: `${v(t.timeline)}. Зависимости: ${v(t.dependencies)}` },
    { h: 'Действия клиента', p: v(t.clientActions) },
    { h: 'Стоимость услуг (из принятой версии)', p: [t.serviceOneTimeKop !== null ? `Разовые работы: ${formatKop(t.serviceOneTimeKop)}` : null, t.serviceMonthlyKop !== null ? `Ежемесячные работы: ${formatKop(t.serviceMonthlyKop)} в месяц` : null].filter(Boolean).join('\n') || '—' },
    { h: 'Рекламный бюджет и внешние расходы клиента', p: t.externalBudgets.map((b) => `${b.label}: ${formatKop(b.amountKop)}${b.period ? `, ${b.period}` : ''} — ${b.paidBy}`).join('\n') || 'Нет' },
    { h: 'Оплата', p: `${v(t.payment)}. Фактический статус: ${e.paymentStatus}` },
    { h: 'Подтверждённые обещания', p: t.confirmedPromises.map((x) => `${x.what} (${x.byRole})`).join('\n') || 'Нет' },
    { h: 'Проверка готовности', table: [['Пункт', 'Статус', 'Комментарий / отклонение'], ...e.checks.map((c) => [c.item, c.status, c.note ?? '—'])] },
    ...(e.previousChecks.length
      ? [{ h: 'Отметки прежней версии чек-листа (для истории)', table: [['Пункт', 'Отметка', 'Комментарий', 'Где теперь'], ...e.previousChecks.map((c) => [c.item, c.status, c.note ?? '—', c.coveredBy])] }]
      : []),
    { h: 'Что ещё блокирует передачу', p: e.blockers.length ? e.blockers.join('\n') : 'Блокеров нет' },
  ];
}

export function handoffDocx(e: HandoffExport) {
  return blocksToDocx(`Пакет передачи в работу — ${e.company}`, 'Для команды проекта. Без ставок, затрат и комиссии. Локальный экспорт прототипа.', handoffBlocks(e));
}

export function internalAuditDocx(e: ReturnType<typeof exportInternalAudit> & { setNumber?: number }) {
  const blocks: Block[] = [
    { p: `Комплект №${e.setNumber ?? '—'}. Маршрут: ${e.route ?? '—'}; глубина: ${e.depth}`, muted: true },
    { h: 'Направления', table: [['Направление', 'Статус', 'Причина / доступ'], ...e.modules.map((m) => [m.module, m.status, [m.reason, m.accessNeeded && `${m.accessNeeded} (${m.accessOwnerRole ?? '?'})`].filter(Boolean).join('; ') || '—'])] },
    { h: 'Все находки (включая непроверенные)', table: [['Код', 'Находка', 'Проверка', 'В клиентский отчёт'], ...e.findings.map((f) => [f.code, f.title, f.verification, f.clientReady ? 'да' : 'нет'])] },
    ...e.findings.map((f) => ({ p: `${f.code}: ${f.observation}${f.reviewComment ? ` — проверка: ${f.reviewComment}` : ''}${f.limitation ? ` — ограничение: ${f.limitation}` : ''}` })),
    { h: 'Путь заявки', table: [['Уровень', 'Статус', 'Чем подтверждено'], ...e.leadPath.map((l) => [l.level, l.status, l.note ?? '—'])] },
    { h: 'Открытые вопросы', p: e.openQuestions.map((q) => `${q.question} → ${q.to}`).join('\n') || 'Нет' },
  ];
  return blocksToDocx('Внутренний аудит команды', e.note, blocks);
}
