/**
 * Exports Excel (XLSX) et PDF. Chargé à la demande (import dynamique) : ces bibliothèques
 * ne pèsent rien tant que l'utilisateur n'exporte pas.
 */
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cashState, goalProgress, periodMetrics, plEntries, profitBy, saleBreakdown, stockValueAt } from './engine';
import { formatEuros, formatPercent } from './money';
import { addMonths, formatDate, formatMonth, monthEnd } from './period';
import {
  cellType,
  expensesTable,
  formatCell,
  metaRows,
  MONTHLY_DEFINITIONS,
  NOTICE,
  type Table,
} from './exports';
import type { Dataset } from './types';

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

const EUR_FMT = '#,##0.00 "€";[Red]-#,##0.00 "€"';
const PCT_FMT = '0.00 %';
const DATE_FMT = 'dd/mm/yyyy';
const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141714' } };

const sheetName = (s: string) => s.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);

export async function buildWorkbook(tables: Table[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vinted Profit AI';
  wb.created = new Date();

  for (const t of tables) {
    const ws = wb.addWorksheet(sheetName(t.name), { views: [{ state: 'frozen', ySplit: 0 }] });
    const meta = metaRows(t);
    meta.forEach((r, i) => {
      const row = ws.addRow(r);
      if (i === 0) row.font = { bold: true, size: 14 };
      else row.getCell(1).font = { color: { argb: 'FF6B6F6B' } };
    });
    ws.addRow([]);
    const headerRow = ws.addRow(t.columns.map((c) => c.header));
    headerRow.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFF5F5F5' } };
      c.fill = HEAD_FILL;
      c.alignment = { vertical: 'middle', wrapText: true };
    });
    const first = headerRow.number + 1;

    t.rows.forEach((r, i) => {
      const row = ws.addRow(
        r.map((v, j) => {
          if (v === null || v === '') return null;
          const type = cellType(t, i, j);
          if (type === 'eur') return (v as number) / 100;
          if (type === 'pct') return (v as number) / 100;
          if (type === 'date') return new Date(`${v}T12:00:00Z`);
          return v;
        }),
      );
      r.forEach((_, j) => {
        const type = cellType(t, i, j);
        const cell = row.getCell(j + 1);
        if (type === 'eur') cell.numFmt = EUR_FMT;
        if (type === 'pct') cell.numFmt = PCT_FMT;
        if (type === 'date') cell.numFmt = DATE_FMT;
      });
    });
    const last = first + t.rows.length - 1;

    // Ligne de totaux (formules Excel, avec la valeur déjà calculée)
    const monthly = t.name === 'Rapport mensuel';
    if (!monthly && t.rows.length > 0) {
      const totals = t.columns.map((c, j) => {
        if (j === 0) return 'Total';
        if (c.type !== 'eur' && c.type !== 'int') return null;
        const col = ws.getColumn(j + 1).letter;
        const result = t.rows.reduce((a, r) => a + (typeof r[j] === 'number' ? (r[j] as number) : 0), 0);
        return { formula: `SUM(${col}${first}:${col}${last})`, result: c.type === 'eur' ? result / 100 : result };
      });
      const tr = ws.addRow(totals);
      tr.font = { bold: true };
      t.columns.forEach((c, j) => {
        if (c.type === 'eur') tr.getCell(j + 1).numFmt = EUR_FMT;
        tr.getCell(j + 1).border = { top: { style: 'thin' } };
      });
    }

    ws.views = [{ state: 'frozen', ySplit: headerRow.number, xSplit: monthly ? 1 : 0 }];
    if (!monthly && t.rows.length) ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: last, column: t.columns.length } };
    t.columns.forEach((c, j) => {
      const longest = Math.max(
        c.header.length,
        ...t.rows.map((r, i) => formatCell(r[j], cellType(t, i, j)).length),
      );
      ws.getColumn(j + 1).width = Math.min(45, Math.max(j === 0 ? 14 : 10, longest + 3));
    });
  }

  const defs = wb.addWorksheet('Définitions');
  defs.addRow(['Définitions des indicateurs']).font = { bold: true, size: 14 };
  defs.addRow([NOTICE]);
  defs.addRow([]);
  const seen = new Set<string>();
  for (const t of tables) for (const d of t.definitions) if (!seen.has(d)) { seen.add(d); defs.addRow([d]); }
  defs.getColumn(1).width = 110;

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------------------------------------------------------------------------
// PDF — bilan mensuel
// ---------------------------------------------------------------------------

/** Les polices PDF standard ne connaissent pas certains espaces et signes typographiques. */
const pdfText = (s: string) => s.replace(/[  ]/g, ' ').replace(/−/g, '-');
const eur = (c: number, signed = false) => pdfText(formatEuros(c, { signed }));

const INK: [number, number, number] = [20, 23, 20];
const MUTED: [number, number, number] = [110, 114, 110];
const GREEN: [number, number, number] = [24, 140, 52];
const RED: [number, number, number] = [200, 40, 40];

export function buildMonthlyPdf(ds: Dataset, month: string): Blob {
  const from = `${month}-01`;
  const to = monthEnd(from);
  const prevFrom = addMonths(from, -1);
  const entries = plEntries(ds);
  const m = periodMetrics(ds, from, to, entries);
  const p = periodMetrics(ds, prevFrom, monthEnd(prevFrom), entries);
  const today = new Date().toISOString().slice(0, 10);
  const asOf = to < today ? to : today;
  const stock = stockValueAt(ds, asOf);
  const cash = cashState(ds, asOf);
  const names = new Map(ds.items.map((i) => [i.id, i.name]));

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 16;
  let y = 20;

  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...INK);
  doc.text(pdfText(`Bilan mensuel · ${formatMonth(from)}`), M, y);
  y += 7;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED);
  doc.text(pdfText(`${ds.settings.businessName || 'Activité de revente'} · du ${formatDate(from)} au ${formatDate(to)} · généré le ${new Date().toLocaleString('fr-FR')}`), M, y);
  y += 5;
  doc.text(pdfText(NOTICE), M, y);
  y += 10;

  // Chiffre clé
  doc.setFontSize(10).setTextColor(...MUTED).text('Bénéfice commercial', M, y);
  doc.text('Résultat estimé', W / 2, y);
  y += 9;
  doc.setFont('helvetica', 'bold').setFontSize(22);
  doc.setTextColor(...(m.commercialProfit < 0 ? RED : GREEN)).text(eur(m.commercialProfit), M, y);
  doc.setTextColor(...(m.result < 0 ? RED : INK)).text(eur(m.result), W / 2, y);
  y += 8;

  const base = {
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 2.2, textColor: INK, lineColor: [225, 228, 225] as [number, number, number], lineWidth: 0.1 },
    headStyles: { fillColor: INK, textColor: [245, 245, 245] as [number, number, number], fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [247, 248, 247] as [number, number, number] },
  };
  const section = (title: string) => {
    let yy = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    yy += 9;
    if (yy > 270) { doc.addPage(); yy = 20; }
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK).text(pdfText(title), M, yy);
    return yy + 3;
  };
  const right = { halign: 'right' as const };

  const row = (label: string, v: number, pv: number, bold = false) => ({
    cells: [label, eur(v), eur(pv), eur(v - pv, true)],
    bold,
  });
  const pl = [
    row("Chiffre d'affaires (montant encaissé)", m.revenue, p.revenue),
    row('Coût des articles vendus', -m.cogs, -p.cogs),
    row('Coûts attribuables aux ventes', -m.saleCosts, -p.saleCosts),
    row('Bénéfice commercial', m.commercialProfit, p.commercialProfit, true),
    row('Dépenses générales', -m.general, -p.general),
    row('Articles perdus ou retirés', -m.writeOff, -p.writeOff),
    row('Résultat estimé', m.result, p.result, true),
  ];
  autoTable(doc, {
    ...base,
    startY: section('Compte de résultat'),
    head: [['', pdfText(formatMonth(from)), pdfText(formatMonth(prevFrom)), 'Écart']],
    body: pl.map((r) => r.cells.map(pdfText)),
    columnStyles: { 1: right, 2: right, 3: right },
    didParseCell: (d) => {
      if (d.section === 'body' && pl[d.row.index]?.bold) d.cell.styles.fontStyle = 'bold';
    },
  });

  autoTable(doc, {
    ...base,
    startY: section(to < today ? 'Stock et trésorerie en fin de mois' : 'Stock et trésorerie à ce jour'),
    head: [['Indicateur', 'Valeur']],
    body: [
      ['Achats de stock du mois', eur(m.purchases)],
      ['Articles vendus', String(m.itemsSold)],
      ['Stock (au coût de revient)', pdfText(`${stock.count} article${stock.count > 1 ? 's' : ''} · ${formatEuros(stock.value)}`)],
      ['Trésorerie confirmée', eur(cash.balance)],
      ['Marge commerciale', pdfText(formatPercent(m.margin))],
      ['ROI', pdfText(formatPercent(m.roi))],
    ],
    columnStyles: { 1: right },
  });

  const goals = goalProgress(ds, month, today).lines;
  if (goals.length) {
    const f = (unit: string, v: number) => pdfText(unit === 'eur' ? formatEuros(v) : unit === 'pct' ? formatPercent(v) : String(v));
    const label: Record<string, string> = { atteint: 'Atteint', en_cours: 'En cours', en_retard: 'En retard', respecte: 'Respecté', depasse: 'Dépassé' };
    autoTable(doc, {
      ...base,
      startY: section('Objectifs'),
      head: [['Objectif', 'Cible', 'Réalisé', 'Statut']],
      body: goals.map((g) => [pdfText(g.label), (g.kind === 'max' ? 'max. ' : '') + f(g.unit, g.target), f(g.unit, g.current), label[g.status]]),
      columnStyles: { 1: right, 2: right },
    });
  }

  const cats = profitBy(entries, from, to, 'category');
  if (cats.length)
    autoTable(doc, {
      ...base,
      startY: section('Bénéfice par catégorie'),
      head: [['Catégorie', 'Vendus', 'Encaissé', 'Bénéfice']],
      body: cats.map((c) => [pdfText(c.name), String(c.count), eur(c.revenue), eur(c.profit)]),
      columnStyles: { 1: right, 2: right, 3: right },
    });

  const sales = ds.sales.filter((s) => s.date >= from && s.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  if (sales.length)
    autoTable(doc, {
      ...base,
      startY: section('Ventes du mois'),
      head: [['Date', 'Articles', 'Encaissé', 'Bénéfice']],
      body: sales.map((s) => {
        const b = saleBreakdown(ds, s);
        const what = b.lines.map((l) => names.get(l.itemId)).join(' + ') + (b.cancelled ? ' (annulée)' : '');
        return [formatDate(s.date), pdfText(what), eur(b.netRevenue), eur(b.profit, true)];
      }),
      columnStyles: { 0: { cellWidth: 22 }, 2: right, 3: right },
    });

  const exp = expensesTable(ds, { from, to });
  if (exp.rows.length)
    autoTable(doc, {
      ...base,
      startY: section('Dépenses du mois'),
      head: [['Date', 'Catégorie', 'Description', 'Montant']],
      body: exp.rows.map((r) => [formatDate(r[0] as string), pdfText(String(r[2])), pdfText(String(r[4] || '')), eur(r[1] as number)]),
      columnStyles: { 0: { cellWidth: 22 }, 3: right },
    });

  let yy = section('Définitions');
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
  for (const d of MONTHLY_DEFINITIONS) {
    const lines = doc.splitTextToSize(pdfText(d), W - 2 * M);
    if (yy + lines.length * 4 > 285) { doc.addPage(); yy = 20; }
    doc.text(lines, M, yy + 3);
    yy += lines.length * 4 + 1.5;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(pdfText(`Vinted Profit AI · bilan mensuel · ${formatMonth(from)} · page ${i}/${pages}`), M, 291);
  }
  return doc.output('blob');
}
