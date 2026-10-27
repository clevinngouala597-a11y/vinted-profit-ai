/**
 * Exports. Chaque export est d'abord construit comme un TABLEAU typé (montants en centimes, dates ISO…),
 * puis mis en forme en CSV (ici), en Excel ou en PDF (src/lib/office.ts). Les trois formats affichent donc
 * exactement les mêmes chiffres.
 *
 * CSV : séparateur « ; », virgule décimale, UTF-8 avec BOM — s'ouvre directement dans Excel en français.
 */
import { getDb, DATA_TABLES } from './db';
import { itemCost, periodMetrics, saleBreakdown } from './engine';
import { isReceipt } from './fiscal';
import { formatPercent } from './money';
import { formatDate, type Range } from './period';
import { ORDER_LABEL, STATUS_LABEL, type Dataset } from './types';

export type ColType = 'text' | 'eur' | 'pct' | 'int' | 'date';
export type CellValue = string | number | null;
export interface Table {
  /** Nom court (onglet Excel, nom de fichier). */
  name: string;
  title: string;
  range: Range | null;
  filters: string;
  definitions: string[];
  columns: { header: string; type: ColType }[];
  rows: CellValue[][];
}

export const NOTICE = "Rapport de gestion interne — ce n'est pas un document comptable officiel.";
const inR = (d: string, r: Range | null) => !r || (d >= r.from && d <= r.to);
const C = (header: string, type: ColType = 'text') => ({ header, type });

// ---------------------------------------------------------------------------
// Tableaux
// ---------------------------------------------------------------------------

export function itemsTable(ds: Dataset, filters = ''): Table {
  return {
    name: 'Inventaire',
    title: 'Inventaire des articles',
    range: null,
    filters,
    definitions: [
      "Coût de revient = prix d'achat attribué + frais d'achat attribués",
      'Bénéfice prévisionnel = prix souhaité − coût de revient (estimation, hors frais de vente)',
    ],
    columns: [
      C('Nom'), C('Catégorie'), C('Marque'), C('Taille'), C('Couleur'), C('État'), C('Statut'), C("Date d'achat", 'date'),
      C("Prix d'achat", 'eur'), C('Frais', 'eur'), C('Coût de revient', 'eur'), C('Prix souhaité', 'eur'), C('Prix minimum', 'eur'),
      C('Bénéfice prévisionnel', 'eur'), C('Date de vente', 'date'), C('Notes'),
    ],
    rows: [...ds.items]
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
      .map((i) => [
        i.name, i.category, i.brand, i.size, i.color, i.condition, STATUS_LABEL[i.status], i.purchaseDate,
        i.purchasePrice, i.directFees, itemCost(i), i.targetPrice, i.minPrice,
        i.targetPrice === null ? null : i.targetPrice - itemCost(i), i.soldAt, i.notes,
      ]),
  };
}

export function salesTable(ds: Dataset, range: Range | null): Table {
  const names = new Map(ds.items.map((i) => [i.id, i.name]));
  return {
    name: 'Ventes',
    title: 'Liste des ventes',
    range,
    filters: '',
    definitions: [
      'Montant encaissé = ce que le vendeur reçoit réellement (les frais payés par l’acheteur n’en font pas partie)',
      'Bénéfice commercial = encaissé − remboursements − coût de revient des articles non récupérés − coûts supportés',
    ],
    columns: [
      C('Date', 'date'), C('Articles'), C('Statut'), C('Paiement'), C('Prix affiché', 'eur'), C('Réduction', 'eur'),
      C('Montant encaissé', 'eur'), C('Remboursé', 'eur'), C('Coût de revient', 'eur'), C('Coûts de vente', 'eur'),
      C('Bénéfice commercial', 'eur'), C('Marge', 'pct'), C('ROI', 'pct'),
    ],
    rows: ds.sales
      .filter((s) => inR(s.date, range))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => {
        const b = saleBreakdown(ds, s);
        return [
          s.date, b.lines.map((l) => names.get(l.itemId)).join(' + '), ORDER_LABEL[s.orderStatus],
          s.paymentStatus === 'recu' ? 'Reçu' : 'En attente', s.listedPrice, s.discount, b.revenue, b.refunded, b.cogs,
          b.directCosts, b.profit, b.margin, b.roi,
        ];
      }),
  };
}

export function purchasesTable(ds: Dataset, range: Range | null): Table {
  return {
    name: 'Achats',
    title: 'Liste des achats',
    range,
    filters: '',
    definitions: ['Total payé = prix des articles + frais communs. Un achat de stock n’est pas une charge : son coût est imputé à la vente.'],
    columns: [C('Date', 'date'), C('Source'), C('Moyen de paiement'), C('Articles', 'int'), C('Prix des articles', 'eur'), C('Frais communs', 'eur'), C('Total payé', 'eur'), C('Notes')],
    rows: ds.purchases
      .filter((p) => inR(p.date, range))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => [p.date, p.source, p.paymentMethod, ds.purchaseLines.filter((l) => l.purchaseId === p.id).length, p.itemsTotal, p.commonFees, p.itemsTotal + p.commonFees, p.notes]),
  };
}

export function expensesTable(ds: Dataset, range: Range | null): Table {
  return {
    name: 'Dépenses',
    title: 'Liste des dépenses',
    range,
    filters: '',
    definitions: ['Une dépense liée à une vente est un coût de cette vente, pas un frais général'],
    columns: [C('Date', 'date'), C('Montant', 'eur'), C('Catégorie'), C('Fournisseur'), C('Description'), C('Liée à une vente'), C('Justificatif')],
    rows: ds.expenses
      .filter((e) => inR(e.date, range))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => [e.date, e.amount, e.category, e.supplier, e.description, e.saleId ? 'Oui' : 'Non', e.attachmentId ? 'Oui' : 'Non']),
  };
}

const TX_KIND: Record<string, string> = {
  solde_initial: 'Solde initial', achat: 'Achat', vente: 'Vente', frais_vente: 'Frais de vente',
  depense: 'Dépense', remboursement: 'Remboursement', ajustement: 'Ajustement',
};
const TX_STATUS: Record<string, string> = { confirme: 'Confirmé', en_attente: 'En attente', annule: 'Annulé' };

export function transactionsTable(ds: Dataset, range: Range | null): Table {
  return {
    name: 'Trésorerie',
    title: 'Historique des mouvements de trésorerie',
    range,
    filters: '',
    definitions: ['Montant positif = encaissement, négatif = décaissement. Seuls les mouvements confirmés comptent dans la trésorerie.'],
    columns: [C('Date', 'date'), C('Libellé'), C('Type'), C('Statut'), C('Montant', 'eur')],
    rows: ds.transactions
      .filter((t) => inR(t.date, range))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map((t) => [t.date, t.label, TX_KIND[t.kind], TX_STATUS[t.status], t.amount]),
  };
}

/** Livre des recettes : recettes encaissées, dans l'ordre chronologique (obligation du micro-entrepreneur). */
export function receiptsBookTable(ds: Dataset, range: Range | null): Table {
  const names = new Map(ds.items.map((i) => [i.id, i.name]));
  const saleItems = (saleId: string | null) =>
    saleId ? ds.saleLines.filter((l) => l.saleId === saleId).map((l) => names.get(l.itemId)).join(' + ') : '';
  return {
    name: 'Livre des recettes',
    title: 'Livre des recettes',
    range,
    filters: 'recettes encaissées (paiements confirmés), remboursements en négatif',
    definitions: [
      'Recette = montant réellement encaissé, à la date du paiement. Les ventes dont le paiement est en attente n’y figurent pas encore.',
      'À compléter si besoin : mode de règlement exact et référence du justificatif (récapitulatif de vente Vinted).',
    ],
    columns: [C('Date d’encaissement', 'date'), C('Référence'), C('Nature'), C('Client'), C('Mode de règlement'), C('Montant', 'eur')],
    rows: ds.transactions
      .filter((t) => isReceipt(t) && inR(t.date, range))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map((t) => [
        t.date,
        (t.refId ?? '').slice(0, 8).toUpperCase(),
        `${t.kind === 'remboursement' ? 'Remboursement' : t.kind === 'ajustement' ? 'Correction' : 'Vente'} · ${saleItems(t.refId)}`,
        'Acheteur Vinted',
        'Plateforme Vinted',
        t.amount,
      ]),
  };
}

/** Registre des achats : récapitulatif des achats de marchandises (obligation pour une activité de vente). */
export function purchasesRegisterTable(ds: Dataset, range: Range | null): Table {
  return {
    name: 'Registre des achats',
    title: 'Registre des achats',
    range,
    filters: '',
    definitions: ['Achats de marchandises destinées à la revente, frais d’achat compris.'],
    columns: [C('Date', 'date'), C('Fournisseur'), C('Articles'), C('Montant', 'eur'), C('Mode de paiement'), C('Justificatif / notes')],
    rows: ds.purchases
      .filter((p) => inR(p.date, range))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => [
        p.date,
        p.source,
        ds.purchaseLines.filter((l) => l.purchaseId === p.id).map((l) => ds.items.find((i) => i.id === l.itemId)?.name).join(' + '),
        p.itemsTotal + p.commonFees,
        p.paymentMethod,
        p.notes,
      ]),
  };
}

export const MONTHLY_DEFINITIONS = [
  'Bénéfice commercial = montant encaissé − coût de revient des articles vendus − coûts attribuables aux ventes',
  'Résultat estimé = bénéfice commercial − dépenses générales − articles perdus ou retirés',
  'Les achats de stock ne sont pas des charges : ils sont imputés au moment de la vente',
  'Marge = bénéfice commercial ÷ chiffre d’affaires ; ROI = bénéfice commercial ÷ coût des articles vendus',
];

export function monthlyTable(ds: Dataset, months: { label: string; range: Range }[]): Table {
  const m = months.map((x) => periodMetrics(ds, x.range.from, x.range.to));
  const line = (label: string, f: (x: (typeof m)[number]) => number | null): CellValue[] => [label, ...m.map(f)];
  return {
    name: 'Rapport mensuel',
    title: 'Rapport mensuel',
    range: months.length ? { from: months[0].range.from, to: months[months.length - 1].range.to } : null,
    filters: '',
    definitions: MONTHLY_DEFINITIONS,
    columns: [C('Indicateur'), ...months.map((x) => C(x.label, 'eur'))],
    // le type de chaque LIGNE est donné par MONTHLY_ROW_TYPES (les colonnes sont des mois)
    rows: [
      line("Chiffre d'affaires", (x) => x.revenue),
      line('Coût des articles vendus', (x) => x.cogs),
      line('Coûts attribuables aux ventes', (x) => x.saleCosts),
      line('Bénéfice commercial', (x) => x.commercialProfit),
      line('Dépenses générales', (x) => x.general),
      line('Articles perdus ou retirés', (x) => x.writeOff),
      line('Résultat estimé', (x) => x.result),
      line('Achats de stock', (x) => x.purchases),
      line('Articles vendus', (x) => x.itemsSold),
      line('Marge commerciale', (x) => x.margin),
      line('ROI', (x) => x.roi),
    ],
  };
}
/** Type de chaque ligne du rapport mensuel (dans l'ordre de monthlyTable). */
export const MONTHLY_ROW_TYPES: ColType[] = ['eur', 'eur', 'eur', 'eur', 'eur', 'eur', 'eur', 'eur', 'int', 'pct', 'pct'];

/** Type effectif d'une cellule : par colonne, sauf pour le rapport mensuel (par ligne). */
export const cellType = (t: Table, row: number, col: number): ColType =>
  col === 0 ? t.columns[0].type : t.name === 'Rapport mensuel' ? MONTHLY_ROW_TYPES[row] : t.columns[col].type;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const eurText = (c: number) => ((c || 0) / 100).toFixed(2).replace('.', ',');
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function formatCell(v: CellValue, type: ColType): string {
  if (v === null || v === '') return '';
  switch (type) {
    case 'eur': return eurText(v as number);
    case 'pct': return formatPercent(v as number);
    case 'date': return formatDate(v as string);
    default: return String(v);
  }
}

export function metaRows(t: Table): string[][] {
  return [
    [t.title],
    ['Période', t.range ? `du ${formatDate(t.range.from)} au ${formatDate(t.range.to)}` : 'Toutes les opérations'],
    ['Généré le', new Date().toLocaleString('fr-FR')],
    ['Filtres', t.filters || 'aucun'],
    ['Nature', NOTICE],
    ...t.definitions.map((d) => ['Définition', d]),
  ];
}

export function toCSV(t: Table): string {
  const headers = t.columns.map((c) => (c.type === 'eur' && t.name !== 'Rapport mensuel' ? `${c.header} (€)` : c.header));
  const lines = [
    ...metaRows(t).map((r) => r.map(csvCell).join(';')),
    '',
    headers.map(csvCell).join(';'),
    ...t.rows.map((r, i) => r.map((v, j) => csvCell(formatCell(v, cellType(t, i, j)))).join(';')),
  ];
  return '﻿' + lines.join('\r\n');
}

// Raccourcis conservés pour l'écran d'export
export const exportItems = (ds: Dataset, filters = '') => toCSV(itemsTable(ds, filters));
export const exportSales = (ds: Dataset, r: Range | null) => toCSV(salesTable(ds, r));
export const exportPurchases = (ds: Dataset, r: Range | null) => toCSV(purchasesTable(ds, r));
export const exportExpenses = (ds: Dataset, r: Range | null) => toCSV(expensesTable(ds, r));
export const exportTransactions = (ds: Dataset, r: Range | null) => toCSV(transactionsTable(ds, r));
export const exportMonthlyReport = (ds: Dataset, months: { label: string; range: Range }[]) => toCSV(monthlyTable(ds, months));

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------------
// Sauvegarde complète
// ---------------------------------------------------------------------------

const BACKUP_FORMAT = 'vinted-profit-ai/backup';

const blobToDataURL = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export async function createBackup(includePhotos: boolean): Promise<Blob> {
  const db = getDb();
  const data: Record<string, unknown> = {};
  for (const t of DATA_TABLES) data[t] = await db.table(t).toArray();
  if (includePhotos) {
    const atts = await db.attachments.toArray();
    data.attachments = await Promise.all(atts.map(async (a) => ({ id: a.id, mime: a.mime, createdAt: a.createdAt, data: await blobToDataURL(a.blob) })));
  }
  return new Blob([JSON.stringify({ format: BACKUP_FORMAT, version: 2, createdAt: new Date().toISOString(), data })], {
    type: 'application/json',
  });
}

export async function restoreBackup(file: Blob): Promise<{ items: number; sales: number }> {
  let parsed: { format?: string; version?: number; data?: Record<string, unknown[]> };
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Ce fichier n'est pas une sauvegarde lisible.");
  }
  if (parsed.format !== BACKUP_FORMAT || !parsed.data) throw new Error("Ce fichier n'est pas une sauvegarde CNG Vinted.");
  const data = parsed.data;
  for (const t of DATA_TABLES) if (data[t] !== undefined && !Array.isArray(data[t])) throw new Error(`Sauvegarde invalide (${t}).`);
  const db = getDb();
  const atts = Array.isArray(data.attachments)
    ? await Promise.all(
        (data.attachments as { id: string; mime: string; createdAt: string; data: string }[]).map(async (a) => ({
          id: a.id, mime: a.mime, createdAt: a.createdAt, blob: await (await fetch(a.data)).blob(),
        })),
      )
    : null;
  await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.attachments], async () => {
    for (const t of DATA_TABLES) {
      await db.table(t).clear();
      if (data[t]) await db.table(t).bulkAdd(data[t]);
    }
    if (atts) {
      await db.attachments.clear();
      await db.attachments.bulkAdd(atts);
    }
  });
  return { items: (data.items ?? []).length, sales: (data.sales ?? []).length };
}
