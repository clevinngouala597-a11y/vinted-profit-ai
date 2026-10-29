/**
 * Analyse des invendus : l'argent immobilisé dans le stock, depuis combien de temps,
 * et ce que rapporterait chaque article à différents prix de vente.
 *
 * Tout est calculé à partir des données de l'utilisateur : coût de revient des articles,
 * frais moyens de ses ventes passées, délai de vente habituel. Aucune estimation extérieure.
 */
import { daysBetween, itemCost, plEntries } from './engine';
import { sum, type Cents } from './money';
import { IN_STOCK, type Dataset, type ISODate, type Item } from './types';

export interface PriceScenario {
  key: string;
  label: string;
  price: Cents;
  profit: Cents;
  /** % du prix de vente */
  margin: number | null;
}

export interface UnsoldItem {
  item: Item;
  cost: Cents;
  /** jours depuis l'achat */
  age: number;
  /** jours depuis la mise en vente (null : pas encore en ligne) */
  listedFor: number | null;
  /** plus de deux fois le délai de vente habituel */
  dormant: boolean;
  /** prix de vente à partir duquel l'article ne fait plus perdre d'argent (frais de vente compris) */
  breakEven: Cents;
  scenarios: PriceScenario[];
}

export interface AgeBucket {
  label: string;
  min: number;
  max: number | null;
  count: number;
  capital: Cents;
}

export interface UnsoldAnalysis {
  items: UnsoldItem[];
  count: number;
  /** argent immobilisé (coût de revient du stock) */
  capital: Cents;
  /** somme des prix souhaités renseignés */
  planned: Cents;
  /** bénéfice si tout part au prix souhaité (articles avec prix seulement) */
  potential: Cents;
  avgAge: number | null;
  buckets: AgeBucket[];
  /** frais moyens par article vendu (emballage, frais, retours…), sur les 180 derniers jours */
  avgSaleCost: Cents;
  /** délai médian entre l'achat et la vente, d'après l'historique (null : pas assez de ventes) */
  medianDaysToSell: number | null;
  dormantCount: number;
  dormantCapital: Cents;
  /** articles sans prix d'achat (créés par la synchro) : leur coût est encore inconnu */
  costPending: number;
}

const round50 = (c: Cents) => Math.max(0, Math.round(c / 50) * 50);
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export const AGE_BUCKETS: [string, number, number | null][] = [
  ['Moins de 30 jours', 0, 29],
  ['30 à 59 jours', 30, 59],
  ['60 à 89 jours', 60, 89],
  ['90 jours et plus', 90, null],
];

/** Frais moyens par article vendu (180 derniers jours), et délai médian de vente. */
export function salesHabits(ds: Dataset, today: ISODate) {
  const from = new Date(Date.parse(today) - 180 * 86_400_000).toISOString().slice(0, 10);
  const recent = plEntries(ds).filter((e) => e.date >= from && e.date <= today && e.src.type === 'sale' && e.itemsSold > 0);
  const avgSaleCost = recent.length ? Math.round(sum(recent.map((e) => e.saleCosts)) / recent.length) : 0;
  const delays = ds.items
    .filter((i) => i.soldAt && !i.costPending)
    .map((i) => daysBetween(i.purchaseDate, i.soldAt!))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const medianDaysToSell = delays.length >= 3 ? delays[Math.floor(delays.length / 2)] : null;
  return { avgSaleCost, medianDaysToSell };
}

/** Bénéfice et marge d'un article vendu au prix `price` (frais de vente moyens déduits). */
export function profitAt(cost: Cents, price: Cents, avgSaleCost: Cents): { profit: Cents; margin: number | null } {
  const profit = price - cost - avgSaleCost;
  return { profit, margin: pct(profit, price) };
}

export function unsoldAnalysis(ds: Dataset, today: ISODate): UnsoldAnalysis {
  const { avgSaleCost, medianDaysToSell } = salesHabits(ds, today);
  const minProfit = ds.settings.minProfitPerItem || 0;
  const items: UnsoldItem[] = ds.items
    .filter((i) => IN_STOCK.includes(i.status))
    .map((item) => {
      const cost = itemCost(item);
      const age = Math.max(0, daysBetween(item.purchaseDate, today));
      const breakEven = cost + avgSaleCost;
      const scenarios: PriceScenario[] = [];
      const push = (key: string, label: string, price: Cents) => {
        if (price <= 0 || scenarios.some((s) => s.price === price)) return;
        scenarios.push({ key, label, price, ...profitAt(cost, price, avgSaleCost) });
      };
      if (item.targetPrice) {
        push('souhaite', 'Prix souhaité', item.targetPrice);
        push('-10', '−10 %', round50(item.targetPrice * 0.9));
        push('-20', '−20 %', round50(item.targetPrice * 0.8));
        push('-30', '−30 %', round50(item.targetPrice * 0.7));
      }
      if (item.minPrice) push('min', 'Prix minimum', item.minPrice);
      if (minProfit > 0) push('plancher', `Bénéfice min. (${(minProfit / 100).toFixed(0)} €)`, breakEven + minProfit);
      push('equilibre', 'Sans perte', breakEven);
      scenarios.sort((a, b) => b.price - a.price);
      return {
        item,
        cost,
        age,
        listedFor: item.listedAt ? Math.max(0, daysBetween(item.listedAt, today)) : null,
        dormant: medianDaysToSell !== null ? age > Math.max(2 * medianDaysToSell, 30) : age >= Math.max(ds.settings.staleDays || 60, 30),
        breakEven,
        scenarios,
      };
    })
    .sort((a, b) => b.age - a.age || b.cost - a.cost);

  const buckets = AGE_BUCKETS.map(([label, min, max]) => {
    const inB = items.filter((x) => x.age >= min && (max === null || x.age <= max));
    return { label, min, max, count: inB.length, capital: sum(inB.map((x) => x.cost)) };
  });
  const withTarget = items.filter((x) => x.item.targetPrice);
  const dormant = items.filter((x) => x.dormant);
  return {
    items,
    count: items.length,
    capital: sum(items.map((x) => x.cost)),
    planned: sum(withTarget.map((x) => x.item.targetPrice!)),
    potential: sum(withTarget.map((x) => x.item.targetPrice! - x.cost - avgSaleCost)),
    avgAge: items.length ? Math.round(sum(items.map((x) => x.age)) / items.length) : null,
    buckets,
    avgSaleCost,
    medianDaysToSell,
    dormantCount: dormant.length,
    dormantCapital: sum(dormant.map((x) => x.cost)),
    costPending: items.filter((x) => x.item.costPending).length,
  };
}
