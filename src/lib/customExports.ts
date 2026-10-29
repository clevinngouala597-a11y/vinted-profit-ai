/**
 * Exports personnalisés : l'utilisateur choisit les tableaux, la période, le dressing et le format.
 * Tableaux ajoutés pour la préparation comptable : écritures reliées à leur opération, invendus,
 * synthèse par dressing.
 */
import { daysBetween, periodMetrics, plEntries } from './engine';
import {
  expensesTable,
  itemsTable,
  monthlyTable,
  purchasesRegisterTable,
  purchasesTable,
  receiptsBookTable,
  salesTable,
  transactionsTable,
  type ColType,
  type Table,
} from './exports';
import { addMonths, formatMonth, monthEnd, monthStart, type Range } from './period';
import { ALL, scopeDataset, shopsOf } from './shops';
import { unsoldAnalysis } from './unsold';
import type { Dataset, ISODate } from './types';

const C = (header: string, type: ColType = 'text') => ({ header, type });
const SRC_LABEL: Record<string, string> = { sale: 'Vente', refund: 'Remboursement', expense: 'Dépense', item: 'Article', purchase: 'Achat' };

/** Écritures du compte de résultat, une ligne par opération source, avec sa référence. */
export function ledgerTable(ds: Dataset, range: Range | null): Table {
  const rows = plEntries(ds)
    .filter((e) => !range || (e.date >= range.from && e.date <= range.to))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => [
      e.date, SRC_LABEL[e.src.type] ?? e.src.type, e.src.label, e.category ?? '', (e.src.saleId ?? e.src.id).slice(0, 8).toUpperCase(),
      e.revenue, e.cogs, e.saleCosts, e.general, e.writeOff, e.revenue - e.cogs - e.saleCosts - e.general - e.writeOff,
    ]);
  return {
    name: 'Écritures',
    title: 'Détail des écritures (chaque montant relié à son opération)',
    range,
    filters: '',
    definitions: [
      'Chaque ligne est une part d’opération : vente (par article), remboursement, dépense, article perdu ou retiré.',
      'La somme de chaque colonne est exactement le montant correspondant du bilan sur la période.',
      'Référence : identifiant court de l’opération dans l’appli (vente ou dépense).',
    ],
    columns: [C('Date', 'date'), C('Type'), C('Opération'), C('Catégorie'), C('Référence'), C('Chiffre d’affaires', 'eur'), C('Coût des articles', 'eur'), C('Frais de vente', 'eur'), C('Frais généraux', 'eur'), C('Pertes', 'eur'), C('Effet sur le résultat', 'eur')],
    rows,
  };
}

export function unsoldTable(ds: Dataset, today: ISODate): Table {
  const a = unsoldAnalysis(ds, today);
  return {
    name: 'Invendus',
    title: 'Articles en stock (invendus)',
    range: null,
    filters: `au ${today.split('-').reverse().join('/')}`,
    definitions: [
      'Coût de revient = prix d’achat attribué + frais (achat, coûts répartis).',
      `Bénéfice au prix souhaité = prix souhaité − coût − frais moyens par vente (${(a.avgSaleCost / 100).toFixed(2).replace('.', ',')} €).`,
    ],
    columns: [C('Article'), C('Catégorie'), C('Marque'), C('Date d’achat', 'date'), C('Ancienneté (jours)', 'int'), C('Coût de revient', 'eur'), C('Prix souhaité', 'eur'), C('Bénéfice au prix souhaité', 'eur'), C('Prix sans perte', 'eur'), C('Dort')],
    rows: a.items.map((x) => [
      x.item.name, x.item.category, x.item.brand, x.item.purchaseDate, x.age, x.cost, x.item.targetPrice,
      x.item.targetPrice ? x.item.targetPrice - x.cost - a.avgSaleCost : null, x.breakEven, x.dormant ? 'Oui' : '',
    ]),
  };
}

export interface ShopRow {
  id: string;
  name: string;
  revenue: number;
  profit: number;
  result: number;
  margin: number | null;
  itemsSold: number;
  stockCount: number;
  stockCapital: number;
  dormant: number;
  avgDaysToSell: number | null;
}

/** Indicateurs de chaque dressing sur une période (et le total). */
export function shopComparison(full: Dataset, range: Range, today: ISODate): ShopRow[] {
  const shops = shopsOf(full.settings);
  const row = (id: string, name: string, ds: Dataset): ShopRow => {
    const m = periodMetrics(ds, range.from, range.to);
    const u = unsoldAnalysis(ds, today);
    const sold = ds.items.filter((i) => i.soldAt && i.soldAt >= range.from && i.soldAt <= range.to && !i.costPending);
    const days = sold.map((i) => daysBetween(i.listedAt ?? i.purchaseDate, i.soldAt!)).filter((d) => d >= 0);
    return {
      id, name, revenue: m.revenue, profit: m.commercialProfit, result: m.result, margin: m.margin, itemsSold: m.itemsSold,
      stockCount: u.count, stockCapital: u.capital, dormant: u.dormantCount,
      avgDaysToSell: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    };
  };
  return [...shops.map((s) => row(s.id, s.name, scopeDataset(full, s.id))), row(ALL, 'Total', full)];
}

export function shopsTable(full: Dataset, range: Range, today: ISODate): Table {
  return {
    name: 'Par dressing',
    title: 'Synthèse par dressing',
    range,
    filters: '',
    definitions: ['Stock et invendus : à la date du jour. Les autres indicateurs : sur la période.', 'La trésorerie de départ est rattachée au dressing principal.'],
    columns: [C('Dressing'), C('Chiffre d’affaires', 'eur'), C('Bénéfice commercial', 'eur'), C('Résultat estimé', 'eur'), C('Marge', 'pct'), C('Articles vendus', 'int'), C('Délai de vente moyen (j)', 'int'), C('Articles en stock', 'int'), C('Argent immobilisé', 'eur'), C('Articles qui dorment', 'int')],
    rows: shopComparison(full, range, today).map((r) => [r.name, r.revenue, r.profit, r.result, r.margin, r.itemsSold, r.avgDaysToSell, r.stockCount, r.stockCapital, r.dormant]),
  };
}

// ---------------------------------------------------------------------------
// Choix de l'utilisateur
// ---------------------------------------------------------------------------

export const EXPORT_TABLES = [
  { id: 'ventes', label: 'Ventes', sub: 'Détail et bénéfice de chaque vente' },
  { id: 'achats', label: 'Achats', sub: 'Achats et lots, frais compris' },
  { id: 'depenses', label: 'Dépenses', sub: 'Avec catégorie et justificatif' },
  { id: 'tresorerie', label: 'Trésorerie', sub: 'Tous les mouvements d’argent' },
  { id: 'ecritures', label: 'Écritures', sub: 'Chaque montant relié à son opération' },
  { id: 'recettes', label: 'Livre des recettes', sub: 'Micro-entreprise : recettes encaissées' },
  { id: 'registre', label: 'Registre des achats', sub: 'Micro-entreprise : achats de marchandises' },
  { id: 'mensuel', label: 'Rapport mensuel', sub: 'Indicateurs mois par mois' },
  { id: 'inventaire', label: 'Inventaire', sub: 'Tous les articles, tous statuts' },
  { id: 'invendus', label: 'Invendus', sub: 'Stock, ancienneté, prix sans perte' },
  { id: 'dressings', label: 'Par dressing', sub: 'Comparaison de tes dressings' },
] as const;
export type ExportTableId = (typeof EXPORT_TABLES)[number]['id'];

/** Préparation comptable : les tableaux utiles à un comptable ou à la déclaration. */
export const ACCOUNTING_PRESET: ExportTableId[] = ['recettes', 'registre', 'ecritures', 'depenses', 'tresorerie', 'invendus'];

export interface CustomExport {
  tables: ExportTableId[];
  range: Range;
  /** « all » ou l'identifiant d'un dressing */
  shop: string;
  today: ISODate;
}

/** Construit les tableaux demandés, limités au dressing choisi. */
export function buildCustomTables(full: Dataset, o: CustomExport): Table[] {
  const ds = o.shop === ALL ? full : scopeDataset(full, o.shop);
  const shopName = o.shop === ALL ? '' : `dressing « ${shopsOf(full.settings).find((s) => s.id === o.shop)?.name ?? ''} »`;
  const months: { label: string; range: Range }[] = [];
  for (let m = monthStart(o.range.from); m <= o.range.to; m = addMonths(m, 1)) months.push({ label: formatMonth(m), range: { from: m, to: monthEnd(m) } });
  const make: Record<ExportTableId, () => Table> = {
    ventes: () => salesTable(ds, o.range),
    achats: () => purchasesTable(ds, o.range),
    depenses: () => expensesTable(ds, o.range),
    tresorerie: () => transactionsTable(ds, o.range),
    ecritures: () => ledgerTable(ds, o.range),
    recettes: () => receiptsBookTable(ds, o.range),
    registre: () => purchasesRegisterTable(ds, o.range),
    mensuel: () => monthlyTable(ds, months.slice(-24)),
    inventaire: () => itemsTable(ds),
    invendus: () => unsoldTable(ds, o.today),
    dressings: () => shopsTable(full, o.range, o.today),
  };
  return EXPORT_TABLES.filter((t) => o.tables.includes(t.id)).map((t) => {
    const table = make[t.id]();
    return t.id === 'dressings' || !shopName ? table : { ...table, filters: [table.filters, shopName].filter(Boolean).join(' · ') };
  });
}
