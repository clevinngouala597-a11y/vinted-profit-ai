/** Mise en forme lisible des entrées du journal (les détails techniques sont stockés en JSON). */
import { formatEuros } from './money';

export const ENTITY_LABEL: Record<string, string> = {
  item: 'Article', sale: 'Vente', purchase: 'Achat', expense: 'Dépense', refund: 'Remboursement', settings: 'Réglages', goal: 'Objectifs',
};

const KEY_LABEL: Record<string, [string, 'eur' | 'pct' | 'n' | 'txt']> = {
  revenue: ["chiffre d'affaires", 'eur'], profit: ['bénéfice', 'eur'], salesCount: ['ventes', 'n'],
  minMargin: ['marge min.', 'pct'], maxPurchases: ["budget d'achat", 'eur'], maxStockCount: ['stock max.', 'n'], cashToKeep: ['trésorerie à conserver', 'eur'],
  sellerRevenue: ['encaissé', 'eur'], platformFees: ['frais', 'eur'], packagingCost: ['emballage', 'eur'], otherCosts: ['autres coûts', 'eur'],
  listedPrice: ['prix affiché', 'eur'], discount: ['réduction', 'eur'], date: ['date', 'txt'],
  initialCash: ['trésorerie de départ', 'eur'], monthlyProfitGoal: ['objectif mensuel', 'eur'], maxPurchaseBudget: ['budget par achat', 'eur'],
  minProfitPerItem: ['bénéfice min. par article', 'eur'], safetyReserve: ['réserve', 'eur'], reinvestPct: ['réinvestissement', 'pct'],
  staleDays: ['alerte stock (jours)', 'n'], businessName: ['nom', 'txt'], activityStatus: ['statut', 'txt'], trackingStart: ['début du suivi', 'txt'],
  onboarded: ['configuration terminée', 'txt'], customCategories: ['catégories', 'txt'],
};

function humanObject(o: Record<string, unknown>): string {
  return Object.entries(o)
    .filter(([k, v]) => KEY_LABEL[k] && !(typeof v === 'number' && v === 0 && KEY_LABEL[k][1] !== 'txt'))
    .map(([k, v]) => {
      const [label, t] = KEY_LABEL[k];
      if (t === 'eur') return `${label} ${formatEuros(Number(v))}`;
      if (t === 'pct') return `${label} ${v} %`;
      if (Array.isArray(v)) return `${label} : ${v.join(', ') || 'aucune'}`;
      if (typeof v === 'boolean') return `${label} : ${v ? 'oui' : 'non'}`;
      return `${label} ${v}`;
    })
    .join(', ') || 'aucun objectif';
}

/** Remplace chaque objet JSON du texte par une phrase lisible, et les montants « 1234 c » par des euros. */
export function humanDetails(details: string): string {
  return details
    .replace(/\{[^{}]*\}/g, (m) => {
      try {
        return humanObject(JSON.parse(m));
      } catch {
        return m;
      }
    })
    .replace(/(-?\d+) c\b/g, (_, n) => formatEuros(Number(n)));
}
