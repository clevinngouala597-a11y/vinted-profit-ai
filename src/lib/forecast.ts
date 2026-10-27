/**
 * Prévisions de trésorerie et de résultat à 30, 60 et 90 jours.
 *
 * Méthode (volontairement simple et explicable) :
 *  - on découpe l'historique récent (jusqu'à 12 semaines) en semaines complètes ;
 *  - pour chaque semaine : chiffre d'affaires, bénéfice commercial, dépenses générales et flux de trésorerie confirmé ;
 *  - scénario central = moyenne hebdomadaire ; prudent = 1er quartile ; optimiste = 3e quartile ;
 *  - projection = valeur hebdomadaire × nombre de semaines de l'horizon.
 * Ce sont des estimations : elles supposent que le rythme récent continue, sans saisonnalité ni achat exceptionnel.
 */
import { cashState, inRange, plEntries, type PLEntry } from './engine';
import { sum, type Cents } from './money';
import { addDays } from './period';
import type { Dataset, ISODate } from './types';

export const MIN_WEEKS = 4;
export const MIN_SALES = 5;
const MAX_WEEKS = 12;

export function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}

export interface WeekStat {
  from: ISODate;
  to: ISODate;
  revenue: Cents;
  profit: Cents;
  general: Cents;
  cashFlow: Cents;
  sales: number;
}

export function weeklyHistory(ds: Dataset, until: ISODate, entries: PLEntry[] = plEntries(ds)): WeekStat[] {
  // l'historique commence à la première opération réelle : les semaines d'avant ne reflètent pas le rythme de l'activité
  const firstActivity = [...ds.purchases.map((p) => p.date), ...ds.sales.map((s) => s.date)].sort()[0] ?? ds.settings.trackingStart;
  const weeks: WeekStat[] = [];
  for (let k = 1; k <= MAX_WEEKS; k++) {
    const to = addDays(until, -7 * (k - 1));
    const from = addDays(to, -6);
    if (from < firstActivity) break;
    const e = entries.filter((x) => inRange(x.date, from, to));
    const revenue = sum(e.map((x) => x.revenue));
    weeks.unshift({
      from,
      to,
      revenue,
      profit: revenue - sum(e.map((x) => x.cogs)) - sum(e.map((x) => x.saleCosts)),
      general: sum(e.map((x) => x.general + x.writeOff)),
      cashFlow: sum(ds.transactions.filter((t) => t.status === 'confirme' && inRange(t.date, from, to)).map((t) => t.amount)),
      sales: e.reduce((a, x) => a + Math.max(0, x.itemsSold), 0),
    });
  }
  return weeks;
}

export interface Scenario {
  name: 'prudent' | 'central' | 'optimiste';
  revenue: Cents;
  profit: Cents;
  result: Cents;
  cashEnd: Cents;
}

export type Forecast =
  | { ok: false; reason: string; weeks: number; sales: number }
  | {
      ok: true;
      horizon: number;
      weeks: WeekStat[];
      sales: number;
      scenarios: Scenario[];
      cashNow: Cents;
      pendingIn: Cents;
      assumptions: string[];
      limits: string[];
    };

/** @param until dernier jour inclus dans l'historique (en général : hier, pour n'avoir que des journées complètes). */
export function forecast(ds: Dataset, until: ISODate, horizonDays: 30 | 60 | 90): Forecast {
  const weeks = weeklyHistory(ds, until);
  const sales = weeks.reduce((a, w) => a + w.sales, 0);
  if (weeks.length < MIN_WEEKS || sales < MIN_SALES)
    return {
      ok: false,
      weeks: weeks.length,
      sales,
      reason: `Il faut au moins ${MIN_WEEKS} semaines d'historique et ${MIN_SALES} ventes pour une prévision utile (actuellement ${weeks.length} semaine${weeks.length > 1 ? 's' : ''} et ${sales} vente${sales > 1 ? 's' : ''}).`,
    };
  const n = horizonDays / 7;
  const pick = (f: (w: WeekStat) => number, q: 'prudent' | 'central' | 'optimiste') => {
    const v = weeks.map(f);
    const weekly = q === 'central' ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : quantile(v, q === 'prudent' ? 0.25 : 0.75);
    return Math.round(weekly * n);
  };
  const cash = cashState(ds);
  const scenarios: Scenario[] = (['prudent', 'central', 'optimiste'] as const).map((name) => {
    const revenue = pick((w) => w.revenue, name);
    const profit = pick((w) => w.profit, name);
    // les dépenses générales sont prises au niveau central dans tous les scénarios : elles ne dépendent pas des ventes
    const general = pick((w) => w.general, 'central');
    // en prudent, les paiements en attente ne sont pas comptés comme encaissés
    const cashEnd = cash.balance + pick((w) => w.cashFlow, name) + (name === 'prudent' ? 0 : cash.pendingIn) + cash.pendingOut;
    return { name, revenue, profit, result: profit - general, cashEnd };
  });
  const avg = (f: (w: WeekStat) => number) => Math.round(weeks.reduce((a, w) => a + f(w), 0) / weeks.length);
  const fmt = (c: Cents) => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  return {
    ok: true,
    horizon: horizonDays,
    weeks,
    sales,
    scenarios,
    cashNow: cash.balance,
    pendingIn: cash.pendingIn,
    assumptions: [
      `Basé sur ${weeks.length} semaines complètes, du ${weeks[0].from.split('-').reverse().join('/')} au ${weeks[weeks.length - 1].to.split('-').reverse().join('/')}, et ${sales} ventes.`,
      `Rythme moyen : ${fmt(avg((w) => w.revenue))} de chiffre d'affaires et ${fmt(avg((w) => w.profit))} de bénéfice par semaine.`,
      'Prudent = une semaine sur quatre fait moins bien ; optimiste = une semaine sur quatre fait mieux ; central = la moyenne.',
      "Trésorerie : solde confirmé + flux hebdomadaire observé (achats de stock compris). Le scénario prudent n'inclut pas les paiements en attente.",
    ],
    limits: [
      'Suppose que ton rythme récent continue : pas de saisonnalité (rentrée, soldes, fêtes), pas d’arrêt ni de gros achat exceptionnel.',
      'Plus l’historique est court ou irrégulier, plus l’écart entre les scénarios est grand.',
      "Ce n'est pas une promesse de résultat : à comparer chaque mois avec le réalisé.",
    ],
  };
}

/** Écart entre le mois en cours et ce que prévoyait l'historique antérieur au mois (pour les notifications). */
export function monthVsForecast(ds: Dataset, today: ISODate): { expected: Cents; actual: Cents; prudent: Cents } | null {
  const monthStart = `${today.slice(0, 7)}-01`;
  const elapsed = Number(today.slice(8, 10));
  if (elapsed < 10) return null;
  const before = addDays(monthStart, -1);
  const weeks = weeklyHistory(ds, before);
  const sales = weeks.reduce((a, w) => a + w.sales, 0);
  if (weeks.length < MIN_WEEKS || sales < MIN_SALES) return null;
  const per = (q: number | null) => {
    const v = weeks.map((w) => w.profit);
    const weekly = q === null ? v.reduce((a, b) => a + b, 0) / v.length : quantile(v, q);
    return Math.round((weekly / 7) * elapsed);
  };
  const entries = plEntries(ds).filter((e) => inRange(e.date, monthStart, today));
  const actual = sum(entries.map((e) => e.revenue - e.cogs - e.saleCosts));
  return { expected: per(null), prudent: per(0.25), actual };
}
