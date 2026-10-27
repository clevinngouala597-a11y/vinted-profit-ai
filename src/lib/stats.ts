/**
 * Statistiques de vendeur (fonctions pures) : ce qui se vend, quand, à quel prix, en combien de temps,
 * et ce qui pose problème (ventes à perte, annulations répétées, articles qui dorment).
 * Les articles créés par la synchro sans prix d'achat sont signalés : leur bénéfice est surestimé.
 */
import { AUTO_ITEM_SOURCE } from './actions';
import { daysBetween, saleBreakdown, type SaleBreakdown } from './engine';
import { percent, sum, type Cents } from './money';
import type { Range } from './period';
import { SELLABLE, type Dataset, type Item } from './types';

export interface Group {
  key: string;
  count: number;
  revenue: Cents;
  profit: Cents;
  avgProfit: Cents;
  margin: number | null;
}

export interface SellerStats {
  salesCount: number;
  revenue: Cents;
  profit: Cents;
  avgBasket: Cents | null;
  best: { name: string; profit: Cents; date: string } | null;
  /** ventes annulées ou remboursées en totalité / toutes les ventes de la période */
  cancelRate: number | null;
  cancelledCount: number;
  /** ventes dont un article n'a pas encore de prix d'achat */
  missingCost: number;
  weekdays: { day: string; count: number; revenue: Cents }[];
  bestWeekday: string | null;
  categories: Group[];
  brands: Group[];
  sizes: Group[];
  timeToSell: { avg: number; median: number; count: number; byCategory: { key: string; avg: number; count: number }[] } | null;
  sellThrough: { acquired: number; sold: number; rate: number | null } | null;
  dormant: { item: Item; days: number }[];
  losers: { name: string; profit: Cents; date: string; saleId: string }[];
  /** même article annulé / remboursé plusieurs fois */
  repeatCancels: { name: string; count: number }[];
}

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const weekday = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;

/** Marques courantes en friperie / revente, repérées dans le titre quand la marque n'est pas renseignée. */
const BRANDS = [
  'Ralph Lauren', 'Lacoste', 'The North Face', 'Nike', 'Adidas', 'Carhartt', 'Levi\'s', 'Tommy Hilfiger', 'Stone Island', 'Stüssy', 'Stussy',
  'Champion', 'Puma', 'New Balance', 'Napapijri', 'Patagonia', 'Columbia', 'Timberland', 'Dickies', 'Burberry', 'Calvin Klein', 'Hugo Boss',
  'Zara', 'H&M', 'Bershka', 'Pull&Bear', 'Jordan', 'Converse', 'Vans', 'Kappa', 'Fila', 'Ellesse', 'Diesel', 'Guess', 'Supreme', 'Moncler',
  'Barbour', 'Arc\'teryx', 'Salomon', 'Asics', 'Reebok', 'Under Armour', 'Lyle & Scott', 'Fred Perry', 'Realtree', 'Kaginuo', 'Cars',
];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function detectBrand(it: Pick<Item, 'brand' | 'name' | 'listingRef'>): string | null {
  if (it.brand?.trim()) return it.brand.trim();
  const t = norm(`${it.name} ${it.listingRef}`);
  const found = BRANDS.find((b) => new RegExp(`(^|[^a-z])${norm(b).replace(/[.*+?^${}()|[\]\\&']/g, '\\$&')}([^a-z]|$)`).test(t));
  return found ?? null;
}

export function detectSize(it: Pick<Item, 'size' | 'name' | 'listingRef'>): string | null {
  if (it.size?.trim()) return it.size.trim().toUpperCase();
  const m = `${it.listingRef} ${it.name}`.match(/taille\s*:?\s*([0-9]{2,3}|XXS|XS|S|M|L|XL|XXL|XXXL|TU)\b/i);
  return m ? m[1].toUpperCase() : null;
}

const isAuto = (ds: Dataset, it: Item) => ds.purchases.find((p) => p.id === it.purchaseId)?.source === AUTO_ITEM_SOURCE;

function group(entries: { key: string | null; revenue: Cents; profit: Cents }[]): Group[] {
  const map = new Map<string, { count: number; revenue: Cents; profit: Cents }>();
  for (const e of entries) {
    if (!e.key) continue;
    const g = map.get(e.key) ?? { count: 0, revenue: 0, profit: 0 };
    g.count++;
    g.revenue += e.revenue;
    g.profit += e.profit;
    map.set(e.key, g);
  }
  return [...map].map(([key, g]) => ({ key, ...g, avgProfit: Math.round(g.profit / g.count), margin: percent(g.profit, g.revenue) }))
    .sort((a, b) => b.profit - a.profit || b.count - a.count);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round1 = (x: number) => Math.round(x * 10) / 10;

export function sellerStats(ds: Dataset, range: Range, today: string): SellerStats {
  const items = new Map(ds.items.map((i) => [i.id, i]));
  const all = ds.sales.filter((s) => s.date >= range.from && s.date <= range.to).map((s) => saleBreakdown(ds, s));
  const fullyRefunded = (b: SaleBreakdown) => !b.cancelled && b.refunded > 0 && b.refunded >= b.revenue;
  const effective = all.filter((b) => !b.cancelled && !fullyRefunded(b));
  const failed = all.filter((b) => b.cancelled || fullyRefunded(b));

  // par article vendu (ventes groupées : chaque article compte)
  const lines = effective.flatMap((b) => b.lines.map((l) => ({ b, l, it: items.get(l.itemId) })));
  const lineEntry = (x: (typeof lines)[number], key: string | null) => ({ key, revenue: x.l.revenue, profit: x.l.revenue - x.l.cogs - x.l.costs });

  const weekdays = DAYS.map((day) => ({ day, count: 0, revenue: 0 }));
  for (const b of effective) { const w = weekdays[weekday(b.sale.date)]; w.count++; w.revenue += b.netRevenue; }
  const bestW = [...weekdays].sort((a, b) => b.count - a.count || b.revenue - a.revenue)[0];

  const best = [...effective].sort((a, b) => b.profit - a.profit)[0];
  const nameOf = (b: SaleBreakdown) => {
    const it = items.get(b.lines[0]?.itemId);
    return b.lines.length > 1 ? `${it?.name ?? 'Article'} + ${b.lines.length - 1}` : it?.name ?? 'Vente';
  };

  // délai de vente : seulement les articles dont la date de mise en stock est réelle (pas créés par la synchro)
  const delays = lines.filter((x) => x.it && !isAuto(ds, x.it)).map((x) => ({ cat: x.it!.category, days: Math.max(0, daysBetween(x.it!.listedAt ?? x.it!.purchaseDate, x.b.sale.date)) }));
  const byCat = new Map<string, number[]>();
  for (const d of delays) byCat.set(d.cat, [...(byCat.get(d.cat) ?? []), d.days]);

  // taux d'écoulement : articles entrés en stock sur la période et déjà vendus
  const acquired = ds.items.filter((i) => i.purchaseDate >= range.from && i.purchaseDate <= range.to && !isAuto(ds, i));
  const soldIds = new Set(ds.saleLines.filter((l) => ds.sales.find((s) => s.id === l.saleId && s.orderStatus !== 'annulee')).map((l) => l.itemId));
  const soldAcq = acquired.filter((i) => soldIds.has(i.id) && !SELLABLE.includes(i.status)).length;

  const dormant = ds.items
    .filter((i) => SELLABLE.includes(i.status) && !i.costPending)
    .map((item) => ({ item, days: daysBetween(item.listedAt ?? item.purchaseDate, today) }))
    .filter((x) => x.days >= ds.settings.staleDays)
    .sort((a, b) => b.days - a.days)
    .slice(0, 10);

  const cancelsByName = new Map<string, number>();
  for (const b of failed) { const n = nameOf(b); cancelsByName.set(n, (cancelsByName.get(n) ?? 0) + 1); }

  return {
    salesCount: effective.length,
    revenue: sum(effective.map((b) => b.netRevenue)),
    profit: sum(effective.map((b) => b.profit)),
    avgBasket: effective.length ? Math.round(sum(effective.map((b) => b.netRevenue)) / effective.length) : null,
    best: best ? { name: nameOf(best), profit: best.profit, date: best.sale.date } : null,
    cancelRate: all.length ? round1((failed.length / all.length) * 100) : null,
    cancelledCount: failed.length,
    missingCost: effective.filter((b) => b.lines.some((l) => items.get(l.itemId)?.costPending)).length,
    weekdays,
    bestWeekday: bestW && bestW.count > 0 ? bestW.day : null,
    categories: group(lines.map((x) => lineEntry(x, x.it?.category ?? null))),
    brands: group(lines.map((x) => lineEntry(x, x.it ? detectBrand(x.it) : null))),
    sizes: group(lines.map((x) => lineEntry(x, x.it ? detectSize(x.it) : null))),
    timeToSell: delays.length
      ? {
          avg: round1(delays.reduce((a, d) => a + d.days, 0) / delays.length),
          median: median(delays.map((d) => d.days)),
          count: delays.length,
          byCategory: [...byCat].map(([key, xs]) => ({ key, avg: round1(xs.reduce((a, x) => a + x, 0) / xs.length), count: xs.length })).sort((a, b) => a.avg - b.avg),
        }
      : null,
    sellThrough: acquired.length ? { acquired: acquired.length, sold: soldAcq, rate: percent(soldAcq, acquired.length) } : null,
    dormant,
    losers: effective.filter((b) => b.profit < 0).map((b) => ({ name: nameOf(b), profit: b.profit, date: b.sale.date, saleId: b.sale.id })).sort((a, b) => a.profit - b.profit).slice(0, 10),
    repeatCancels: [...cancelsByName].filter(([, c]) => c >= 2).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}
