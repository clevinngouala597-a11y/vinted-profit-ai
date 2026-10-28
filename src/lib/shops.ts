/**
 * Plusieurs dressings (comptes Vinted) dans la même appli.
 *
 * Chaque achat, article, vente et dépense appartient à un dressing (`shop`). Sans valeur, c'est le
 * dressing principal : les données d'avant cette fonction y restent, sans migration.
 * L'écran affiche « Tous » (le total commun) ou un seul dressing : `scopeDataset` filtre alors
 * toutes les tables de façon cohérente (les calculs du moteur ne changent pas).
 *
 * Synchro : chaque e-mail Vinted commence par « Bonjour <pseudo> ». Le pseudo indique le dressing ;
 * un pseudo inconnu va dans le dressing principal.
 */
import type { Dataset, Settings } from './types';

export const MAIN = 'main';
export const ALL = 'all';

export interface Shop {
  id: string;
  name: string;
  /** pseudo Vinted du compte (sert à ranger les e-mails de la synchro) */
  pseudo: string;
}

/** Liste complète, dressing principal en premier. */
export function shopsOf(s: Pick<Settings, 'shops'>): Shop[] {
  const list = s.shops ?? [];
  const main = list.find((x) => x.id === MAIN) ?? { id: MAIN, name: 'Mon dressing', pseudo: '' };
  return [main, ...list.filter((x) => x.id !== MAIN)];
}

export const isMulti = (s: Pick<Settings, 'shops'>) => shopsOf(s).length > 1;
export const shopOf = (x: { shop?: string } | undefined | null) => x?.shop ?? MAIN;
export const shopName = (s: Pick<Settings, 'shops'>, id: string) => shopsOf(s).find((x) => x.id === id)?.name ?? 'Dressing supprimé';

/** Dressing affiché : « Tous », ou un dressing existant. */
export function activeShop(s: Pick<Settings, 'shops' | 'activeShop'>): string {
  const a = s.activeShop ?? ALL;
  return a === ALL || !isMulti(s) || !shopsOf(s).some((x) => x.id === a) ? ALL : a;
}

/** Dressing des nouvelles saisies : celui affiché, ou le principal quand « Tous » est affiché. */
export const defaultShopFor = (s: Pick<Settings, 'shops' | 'activeShop'>) => (activeShop(s) === ALL ? MAIN : activeShop(s));

// ---------------------------------------------------------------------------
// Dressing « ambiant » : la synchro range ses enregistrements dans le dressing de l'e-mail
// ---------------------------------------------------------------------------

let ambient: string | null = null;
export const ambientShop = () => ambient;
export async function withShop<T>(shop: string, fn: () => Promise<T>): Promise<T> {
  const prev = ambient;
  ambient = shop;
  try {
    return await fn();
  } finally {
    ambient = prev;
  }
}

/** « Bonjour clevinnng, … » → « clevinnng ». */
export function extractPseudo(text: string): string | null {
  const m = text.match(/\b(?:Bonjour|Salut|Hello|Coucou)\s+([^\s,!:;|]+)\s*[,!]/i)
    // certains e-mails commencent directement par « pseudo, » (ex. transaction finalisée)
    ?? text.replace(/^[\s|]+/, '').match(/^([^\s,!:;|]+)\s*,/);
  return m ? m[1] : null;
}

export function shopForPseudo(s: Pick<Settings, 'shops'>, pseudo: string | null): string {
  if (!pseudo) return MAIN;
  const p = pseudo.toLowerCase();
  return shopsOf(s).find((x) => x.pseudo && x.pseudo.toLowerCase().replace(/^@/, '') === p)?.id ?? MAIN;
}

// ---------------------------------------------------------------------------
// Vue d'un seul dressing
// ---------------------------------------------------------------------------

export function scopeDataset(ds: Dataset, shop: string): Dataset {
  if (shop === ALL) return ds;
  const purchases = ds.purchases.filter((p) => shopOf(p) === shop);
  const pIds = new Set(purchases.map((p) => p.id));
  const items = ds.items.filter((i) => (i.shop ?? (i.purchaseId && ds.purchases.find((p) => p.id === i.purchaseId)?.shop) ?? MAIN) === shop);
  const itemIds = new Set(items.map((i) => i.id));
  const sales = ds.sales.filter((s) => shopOf(s) === shop);
  const saleIds = new Set(sales.map((s) => s.id));
  const refunds = ds.refunds.filter((r) => saleIds.has(r.saleId));
  const expenses = ds.expenses.filter((e) => shopOf(e) === shop);
  const refShop = new Map<string, boolean>();
  for (const p of purchases) refShop.set(p.id, true);
  for (const s of sales) refShop.set(s.id, true);
  for (const r of refunds) refShop.set(r.id, true);
  for (const e of expenses) refShop.set(e.id, true);
  for (const i of items) refShop.set(i.id, true);
  return {
    ...ds,
    // la trésorerie de départ appartient au dressing principal
    settings: shop === MAIN ? ds.settings : { ...ds.settings, initialCash: 0 },
    purchases,
    purchaseLines: ds.purchaseLines.filter((l) => pIds.has(l.purchaseId) || itemIds.has(l.itemId)),
    items,
    sales,
    saleLines: ds.saleLines.filter((l) => saleIds.has(l.saleId)),
    refunds,
    expenses,
    transactions: ds.transactions.filter((t) => (t.refId ? refShop.has(t.refId) : shop === MAIN)),
  };
}
