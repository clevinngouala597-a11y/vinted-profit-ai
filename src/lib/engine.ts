/**
 * Moteur financier — fonctions pures, sans accès à la base.
 * L'interface et (plus tard) l'assistant IA utilisent EXCLUSIVEMENT ces fonctions
 * pour que tous les chiffres affichés suivent les mêmes règles.
 *
 * Définitions (voir aussi docs/methodes-de-calcul.md) :
 *  - Coût de revient d'un article = prix d'achat attribué + frais d'achat attribués.
 *  - Bénéfice commercial d'une vente = revenu vendeur − remboursements − coût de revient des articles
 *    non récupérés − coûts supportés par le vendeur (frais, emballage, autres, dépenses liées, frais de retour).
 *  - Les achats de stock ne sont PAS des charges : ils deviennent du coût de revient au moment de la vente
 *    (ou une perte s'ils sont retirés / perdus). Pas de double comptabilisation.
 *  - Trésorerie = solde initial + mouvements de fonds confirmés. La valeur du stock n'y est jamais ajoutée.
 */
import { allocate, percent, sum, type Cents } from './money';
import {
  IN_STOCK,
  type Dataset,
  type ISODate,
  type Item,
  type Sale,
  type SaleLine,
} from './types';

export const itemCost = (i: Pick<Item, 'purchasePrice' | 'directFees'>): Cents => i.purchasePrice + i.directFees;

// ---------------------------------------------------------------------------
// Calculateur de prix (simulation avant publication)
// ---------------------------------------------------------------------------

export interface Estimate {
  cost: Cents;
  profit: Cents;
  margin: number | null; // % du revenu vendeur
  roi: number | null; // % du coût de revient
  minRevenueForTarget: Cents | null;
  isLoss: boolean;
}

export function estimate(p: {
  purchasePrice: Cents;
  directFees: Cents;
  sellerRevenue: Cents;
  sellerCosts: Cents;
  targetProfit?: Cents | null;
}): Estimate {
  const cost = p.purchasePrice + p.directFees;
  const profit = p.sellerRevenue - cost - p.sellerCosts;
  return {
    cost,
    profit,
    margin: percent(profit, p.sellerRevenue),
    roi: percent(profit, cost),
    minRevenueForTarget:
      p.targetProfit === null || p.targetProfit === undefined ? null : cost + p.sellerCosts + p.targetProfit,
    isLoss: profit < 0,
  };
}

// ---------------------------------------------------------------------------
// Répartition d'une vente groupée
// ---------------------------------------------------------------------------

/**
 * Répartit le revenu et les coûts d'une vente entre ses articles.
 * Méthode : au prorata du prix de vente souhaité de chaque article ;
 * à défaut, au prorata du coût de revient ; à défaut, à parts égales.
 */
export function splitSale(
  items: Pick<Item, 'id' | 'targetPrice' | 'purchasePrice' | 'directFees'>[],
  sellerRevenue: Cents,
  totalCosts: Cents,
): { itemId: string; revenue: Cents; costs: Cents; cogs: Cents }[] {
  const byTarget = items.map((i) => i.targetPrice ?? 0);
  const weights = byTarget.some((w) => w > 0) && byTarget.every((w) => w > 0) ? byTarget : items.map(itemCost);
  const rev = allocate(sellerRevenue, weights);
  const costs = allocate(totalCosts, weights);
  return items.map((i, k) => ({ itemId: i.id, revenue: rev[k], costs: costs[k], cogs: itemCost(i) }));
}

/**
 * Répartit un achat (éventuellement un lot) entre ses articles.
 *  - Si `lotPrice` est fourni : le prix du lot est réparti au prorata des prix de vente souhaités (à défaut, à parts égales).
 *  - Sinon chaque ligne garde son prix.
 *  - Les frais communs sont répartis au prorata du prix attribué (à défaut, à parts égales).
 */
export function splitPurchase(
  lines: { price: Cents | null; targetPrice: Cents | null }[],
  commonFees: Cents,
  lotPrice: Cents | null,
): { price: Cents; fees: Cents }[] {
  const prices =
    lotPrice !== null ? allocate(lotPrice, lines.map((l) => l.targetPrice ?? 0)) : lines.map((l) => l.price ?? 0);
  const fees = allocate(commonFees, prices);
  return prices.map((p, k) => ({ price: p, fees: fees[k] }));
}

// ---------------------------------------------------------------------------
// Détail d'une vente
// ---------------------------------------------------------------------------

export interface SaleBreakdown {
  sale: Sale;
  lines: SaleLine[];
  revenue: Cents;
  refunded: Cents;
  netRevenue: Cents;
  cogs: Cents; // coût de revient des articles non récupérés
  cogsRecovered: Cents;
  directCosts: Cents; // frais + emballage + autres + dépenses liées + frais de retour
  profit: Cents;
  margin: number | null;
  roi: number | null;
  isLoss: boolean;
  cancelled: boolean;
}

export function saleBreakdown(ds: Dataset, sale: Sale): SaleBreakdown {
  const lines = ds.saleLines.filter((l) => l.saleId === sale.id);
  const refunds = ds.refunds.filter((r) => r.saleId === sale.id);
  const linkedExpenses = ds.expenses.filter((e) => e.saleId === sale.id);
  const cancelled = sale.orderStatus === 'annulee';
  const lineCogs = sum(lines.map((l) => l.cogs));
  const recovered = refunds.some((r) => r.itemRecovered);
  const revenue = cancelled ? 0 : sale.sellerRevenue;
  const refunded = cancelled ? 0 : sum(refunds.map((r) => r.amount));
  const cogsRecovered = cancelled ? lineCogs : recovered ? lineCogs : 0;
  const cogs = lineCogs - cogsRecovered;
  // une vente annulée ne génère ni revenu ni coût de revient, mais les frais déjà engagés restent une charge
  const saleCosts = sale.platformFees + sale.packagingCost + sale.otherCosts;
  const directCosts = saleCosts + sum(linkedExpenses.map((e) => e.amount)) + sum(refunds.map((r) => r.extraCosts));
  const netRevenue = revenue - refunded;
  const profit = netRevenue - cogs - directCosts;
  return {
    sale,
    lines,
    revenue,
    refunded,
    netRevenue,
    cogs,
    cogsRecovered,
    directCosts,
    profit,
    margin: percent(profit, netRevenue),
    roi: percent(profit, cogs),
    isLoss: profit < 0,
    cancelled,
  };
}

// ---------------------------------------------------------------------------
// Écritures de résultat datées (pour l'analyse par période)
// ---------------------------------------------------------------------------

export interface PLEntry {
  date: ISODate;
  revenue: Cents; // revenu vendeur (+) ou remboursement (−)
  cogs: Cents; // coût de revient imputé (+) ou repris en stock (−)
  saleCosts: Cents; // coûts directement attribuables aux ventes
  general: Cents; // frais généraux
  writeOff: Cents; // articles sortis du stock sans vente (perdus / retirés)
  itemsSold: number; // articles vendus (+) ou récupérés (−)
  category?: string;
  brand?: string;
}

export function plEntries(ds: Dataset): PLEntry[] {
  const out: PLEntry[] = [];
  const itemById = new Map(ds.items.map((i) => [i.id, i]));
  const saleById = new Map(ds.sales.map((s) => [s.id, s]));
  const zero = { revenue: 0, cogs: 0, saleCosts: 0, general: 0, writeOff: 0, itemsSold: 0 };

  for (const sale of ds.sales) {
    const saleCostsTotal = sale.platformFees + sale.packagingCost + sale.otherCosts;
    if (sale.orderStatus === 'annulee') {
      if (saleCostsTotal) out.push({ ...zero, date: sale.cancelledAt ?? sale.date, general: saleCostsTotal });
      continue;
    }
    const lines = ds.saleLines.filter((l) => l.saleId === sale.id);
    // une écriture par article pour permettre l'analyse par catégorie / marque
    const costShare = allocate(saleCostsTotal, lines.map((l) => (l.revenue > 0 ? l.revenue : 1)));
    lines.forEach((l, k) => {
      const it = itemById.get(l.itemId);
      out.push({
        ...zero,
        date: sale.date,
        revenue: l.revenue,
        cogs: l.cogs,
        saleCosts: costShare[k],
        itemsSold: 1,
        category: it?.category,
        brand: it?.brand,
      });
    });
    for (const r of ds.refunds.filter((x) => x.saleId === sale.id)) {
      out.push({ ...zero, date: r.date, revenue: -r.amount, saleCosts: r.extraCosts });
      if (r.itemRecovered) {
        lines.forEach((l) => {
          const it = itemById.get(l.itemId);
          out.push({
            ...zero,
            date: r.recoveredAt ?? r.date,
            cogs: -l.cogs,
            itemsSold: -1,
            category: it?.category,
            brand: it?.brand,
          });
        });
      }
    }
  }

  for (const e of ds.expenses) {
    const linkedSale = e.saleId ? saleById.get(e.saleId) : undefined;
    const direct = linkedSale && linkedSale.orderStatus !== 'annulee';
    out.push({ ...zero, date: e.date, saleCosts: direct ? e.amount : 0, general: direct ? 0 : e.amount });
  }

  for (const i of ds.items) {
    if ((i.status === 'perdu' || i.status === 'retire') && i.writtenOffAt) {
      out.push({ ...zero, date: i.writtenOffAt, writeOff: itemCost(i), category: i.category, brand: i.brand });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Indicateurs d'une période
// ---------------------------------------------------------------------------

export interface PeriodMetrics {
  revenue: Cents;
  cogs: Cents;
  saleCosts: Cents;
  commercialProfit: Cents;
  general: Cents;
  writeOff: Cents;
  result: Cents;
  purchases: Cents; // achats de stock payés sur la période (prix + frais)
  itemsSold: number;
  avgProfitPerItem: Cents | null;
  margin: number | null;
  roi: number | null;
}

export const inRange = (d: ISODate, from: ISODate, to: ISODate) => d >= from && d <= to;

export function periodMetrics(ds: Dataset, from: ISODate, to: ISODate, entries = plEntries(ds)): PeriodMetrics {
  const e = entries.filter((x) => inRange(x.date, from, to));
  const revenue = sum(e.map((x) => x.revenue));
  const cogs = sum(e.map((x) => x.cogs));
  const saleCosts = sum(e.map((x) => x.saleCosts));
  const general = sum(e.map((x) => x.general));
  const writeOff = sum(e.map((x) => x.writeOff));
  const itemsSold = e.reduce((a, x) => a + x.itemsSold, 0);
  const commercialProfit = revenue - cogs - saleCosts;
  const purchases = sum(
    ds.purchases.filter((p) => inRange(p.date, from, to)).map((p) => p.itemsTotal + p.commonFees),
  );
  return {
    revenue,
    cogs,
    saleCosts,
    commercialProfit,
    general,
    writeOff,
    result: commercialProfit - general - writeOff,
    purchases,
    itemsSold,
    avgProfitPerItem: itemsSold > 0 ? Math.round(commercialProfit / itemsSold) : null,
    margin: percent(commercialProfit, revenue),
    roi: percent(commercialProfit, cogs),
  };
}

// ---------------------------------------------------------------------------
// Trésorerie, stock, réinvestissement
// ---------------------------------------------------------------------------

export interface CashState {
  balance: Cents; // solde confirmé
  pendingIn: Cents;
  pendingOut: Cents;
}

export function cashState(ds: Dataset, asOf?: ISODate): CashState {
  let balance = ds.settings.initialCash;
  let pendingIn = 0;
  let pendingOut = 0;
  for (const t of ds.transactions) {
    if (asOf && t.date > asOf) continue;
    if (t.status === 'confirme') balance += t.amount;
    else if (t.status === 'en_attente') {
      if (t.amount >= 0) pendingIn += t.amount;
      else pendingOut += t.amount;
    }
  }
  return { balance, pendingIn, pendingOut };
}

export interface StockState {
  count: number;
  costValue: Cents;
  plannedValue: Cents; // somme des prix souhaités renseignés
  potentialProfit: Cents; // estimation, jamais incluse dans le bénéfice réalisé
  missingTarget: number;
  avgAgeDays: number | null;
  stale: Item[];
  unpublished: number;
  toPrepare: number;
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000);
}

export function stockState(ds: Dataset, today: ISODate): StockState {
  const items = ds.items.filter((i) => IN_STOCK.includes(i.status));
  const withTarget = items.filter((i) => i.targetPrice !== null);
  const ages = items.map((i) => daysBetween(i.purchaseDate, today));
  return {
    count: items.length,
    costValue: sum(items.map(itemCost)),
    plannedValue: sum(withTarget.map((i) => i.targetPrice ?? 0)),
    potentialProfit: sum(withTarget.map((i) => (i.targetPrice ?? 0) - itemCost(i))),
    missingTarget: items.length - withTarget.length,
    avgAgeDays: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
    stale: items
      .filter((i) => daysBetween(i.purchaseDate, today) >= ds.settings.staleDays)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate)),
    unpublished: items.filter((i) => ['achete', 'a_preparer', 'pret', 'retourne'].includes(i.status)).length,
    toPrepare: items.filter((i) => i.status === 'a_preparer').length,
  };
}

export interface Reinvest {
  available: Cents; // trésorerie confirmée − réserve de sécurité (jamais négatif)
  planned: Cents; // part du bénéfice du mois à réinvestir, plafonnée par le disponible
}

export function reinvestment(ds: Dataset, cash: CashState, monthProfit: Cents): Reinvest {
  const available = Math.max(0, cash.balance + cash.pendingOut - ds.settings.safetyReserve);
  const share = Math.max(0, Math.round((monthProfit * ds.settings.reinvestPct) / 100));
  return { available, planned: Math.min(available, share) };
}

// ---------------------------------------------------------------------------
// Séries pour les graphiques
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  key: string;
  label: string;
  revenue: Cents;
  profit: Cents;
  expenses: Cents;
}

export function series(
  entries: PLEntry[],
  buckets: { key: string; label: string; from: ISODate; to: ISODate }[],
): SeriesPoint[] {
  return buckets.map((b) => {
    const e = entries.filter((x) => inRange(x.date, b.from, b.to));
    const revenue = sum(e.map((x) => x.revenue));
    return {
      key: b.key,
      label: b.label,
      revenue,
      profit: revenue - sum(e.map((x) => x.cogs)) - sum(e.map((x) => x.saleCosts)),
      expenses: sum(e.map((x) => x.general)),
    };
  });
}

/** Bénéfice commercial par clé (catégorie ou marque) sur une période. */
export function profitBy(entries: PLEntry[], from: ISODate, to: ISODate, key: 'category' | 'brand') {
  const map = new Map<string, { revenue: Cents; profit: Cents; count: number }>();
  for (const e of entries) {
    if (!inRange(e.date, from, to) || e.writeOff || e.general) continue;
    const k = (e[key] || '').trim();
    if (!k) continue;
    const cur = map.get(k) ?? { revenue: 0, profit: 0, count: 0 };
    cur.revenue += e.revenue;
    cur.profit += e.revenue - e.cogs - e.saleCosts;
    cur.count += e.itemsSold;
    map.set(k, cur);
  }
  return [...map.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.profit - a.profit);
}
