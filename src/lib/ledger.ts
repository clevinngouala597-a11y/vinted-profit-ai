/**
 * Comptabilité vérifiable.
 *
 *  - `traceMetric` : chaque montant du bilan (chiffre d'affaires, coûts, frais…) détaillé ligne par
 *    ligne, chaque ligne reliée à l'opération qui l'a produite (vente, remboursement, dépense, article).
 *    La somme des lignes est, par construction, exactement le montant affiché.
 *  - `checkBooks` : contrôles de cohérence entre les ventes, les achats, les articles, la trésorerie
 *    et les e-mails Vinted (rapprochement). Rien n'est modifié : les anomalies sont signalées, avec
 *    un lien vers l'opération à vérifier.
 */
import { daysBetween, itemCost, plEntries, type PLEntry, type SourceRef } from './engine';
import { sum, type Cents } from './money';
import { normTitle } from './vinted/parse';
import type { Dataset, ISODate, SyncedEmail } from './types';

// ---------------------------------------------------------------------------
// Détail d'un montant
// ---------------------------------------------------------------------------

export type Metric = 'revenue' | 'cogs' | 'saleCosts' | 'general' | 'writeOff' | 'purchases';

export const METRIC_LABEL: Record<Metric, string> = {
  revenue: 'Chiffre d’affaires',
  cogs: 'Coût des articles vendus',
  saleCosts: 'Frais de vente',
  general: 'Frais généraux',
  writeOff: 'Pertes de stock',
  purchases: 'Achats de stock',
};

export const METRIC_HELP: Record<Metric, string> = {
  revenue: 'Montants encaissés sur les ventes, moins les remboursements.',
  cogs: "Coût d'achat des articles vendus (repris si l'article revient en stock).",
  saleCosts: 'Frais de plateforme, emballage, frais de retour et dépenses liées à une vente.',
  general: 'Dépenses non liées à une vente précise, et frais des ventes annulées.',
  writeOff: 'Coût des articles perdus ou retirés de la vente.',
  purchases: 'Achats payés sur la période (prix des articles + frais d’achat).',
};

export interface TraceRow {
  date: ISODate;
  label: string;
  amount: Cents;
  src: SourceRef;
}

/** Lignes qui composent un montant du bilan, de la plus récente à la plus ancienne. */
export function traceMetric(ds: Dataset, from: ISODate, to: ISODate, metric: Metric, entries: PLEntry[] = plEntries(ds)): { total: Cents; rows: TraceRow[] } {
  let rows: TraceRow[];
  if (metric === 'purchases') {
    rows = ds.purchases
      .filter((p) => p.date >= from && p.date <= to)
      .map((p) => {
        const n = ds.purchaseLines.filter((l) => l.purchaseId === p.id).length;
        const first = ds.purchaseLines.find((l) => l.purchaseId === p.id)?.itemId;
        return { date: p.date, label: `Achat · ${p.source || `${n} article${n > 1 ? 's' : ''}`}`, amount: p.itemsTotal + p.commonFees, src: { type: 'purchase' as const, id: p.id, itemId: first, label: p.source } };
      })
      .filter((r) => r.amount !== 0);
  } else {
    // une ligne par opération et par jour (une vente de 3 articles reste une seule ligne)
    const byKey = new Map<string, TraceRow>();
    for (const e of entries) {
      if (e.date < from || e.date > to || !e[metric]) continue;
      const key = `${e.src.type}:${e.src.id}:${e.date}:${e.src.label.split(' · ')[0]}`;
      const cur = byKey.get(key);
      if (cur) {
        cur.amount += e[metric];
        if (cur.label !== e.src.label) cur.label = `${cur.label.split(' · ')[0]} · plusieurs articles`;
      } else byKey.set(key, { date: e.date, label: e.src.label, amount: e[metric], src: e.src });
    }
    rows = [...byKey.values()].filter((r) => r.amount !== 0);
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
  return { total: sum(rows.map((r) => r.amount)), rows };
}

/** Écran à ouvrir pour une opération source. */
export function sourceRoute(src: SourceRef): string {
  if (src.type === 'sale' || src.type === 'refund') return `ventes/${src.saleId ?? src.id}`;
  if (src.type === 'expense') return src.saleId ? `ventes/${src.saleId}` : 'depenses';
  if (src.type === 'item') return `stock/${src.id}`;
  return src.itemId ? `stock/${src.itemId}` : 'stock';
}

// ---------------------------------------------------------------------------
// Contrôles de cohérence
// ---------------------------------------------------------------------------

export type CheckLevel = 'ok' | 'warn' | 'error';
export interface CheckRef { label: string; to: string; detail?: string }
export interface Check {
  id: string;
  level: CheckLevel;
  title: string;
  /** explication pour l'utilisateur (ce qui est vérifié, ou ce qui ne va pas) */
  text: string;
  refs: CheckRef[];
}

const eur = (c: Cents) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
/** au-delà de ce délai sans paiement, une vente est signalée */
export const LATE_PAYMENT_DAYS = 21;

export function checkBooks(ds: Dataset, today: ISODate, synced: SyncedEmail[] = []): Check[] {
  const checks: Check[] = [];
  const item = new Map(ds.items.map((i) => [i.id, i]));
  const sale = new Map(ds.sales.map((s) => [s.id, s]));
  const linesOf = (saleId: string) => ds.saleLines.filter((l) => l.saleId === saleId);
  const refundsOf = (saleId: string) => ds.refunds.filter((r) => r.saleId === saleId);
  const txOf = (refId: string) => ds.transactions.filter((t) => t.refId === refId && t.status !== 'annule');
  const saleName = (id: string) => {
    const names = linesOf(id).map((l) => item.get(l.itemId)?.name ?? 'article');
    return names.length > 1 ? `${names[0]} + ${names.length - 1}` : names[0] ?? 'Vente sans article';
  };
  const add = (id: string, okTitle: string, okText: string, badLevel: CheckLevel, badTitle: (n: number) => string, badText: string, refs: CheckRef[]) =>
    checks.push(refs.length ? { id, level: badLevel, title: badTitle(refs.length), text: badText, refs } : { id, level: 'ok', title: okTitle, text: okText, refs: [] });

  // 1. chaque montant du bilan est relié à une opération
  const entries = plEntries(ds);
  const orphanEntries = entries.filter((e) => !e.src?.id);
  add('trace', 'Chaque montant est relié à une opération', `${entries.length} écritures, toutes rattachées à une vente, un remboursement, une dépense ou un article.`,
    'error', (n) => `${n} écriture(s) sans opération d'origine`, 'Ces montants ne sont reliés à aucune opération.', orphanEntries.map((e) => ({ label: e.src?.label ?? 'Écriture', to: 'bilan' })));

  // 2. ventes : répartition par article
  const badSplit: CheckRef[] = [];
  for (const s of ds.sales) {
    const lines = linesOf(s.id);
    if (!lines.length) badSplit.push({ label: `Vente du ${fr(s.date)}`, to: `ventes/${s.id}`, detail: 'aucun article rattaché' });
    else if (sum(lines.map((l) => l.revenue)) !== s.sellerRevenue)
      badSplit.push({ label: saleName(s.id), to: `ventes/${s.id}`, detail: `articles ${eur(sum(lines.map((l) => l.revenue)))} ≠ vente ${eur(s.sellerRevenue)}` });
  }
  add('sale-split', 'Ventes réparties correctement entre leurs articles', 'Pour chaque vente, la somme des parts des articles est égale au montant encaissé.',
    'error', (n) => `${n} vente(s) mal réparties`, 'La somme des parts des articles ne correspond pas au montant de la vente.', badSplit);

  // 3. ventes ↔ trésorerie (rapprochement de l'argent)
  const badCash: CheckRef[] = [];
  for (const s of ds.sales) {
    const refunds = refundsOf(s.id);
    const cancelled = s.orderStatus === 'annulee';
    const expectedIn = cancelled ? 0 : s.sellerRevenue - sum(refunds.map((r) => r.amount));
    const tx = txOf(s.id);
    const actualIn = sum(tx.filter((t) => t.kind === 'vente' || t.kind === 'remboursement' || (t.kind === 'ajustement' && t.sub !== 'frais')).map((t) => t.amount));
    const expectedCosts = -(s.platformFees + s.packagingCost + s.otherCosts + sum(refunds.map((r) => r.extraCosts)));
    const actualCosts = sum(tx.filter((t) => t.kind === 'frais_vente' || (t.kind === 'ajustement' && t.sub === 'frais')).map((t) => t.amount));
    if (expectedIn !== actualIn) badCash.push({ label: saleName(s.id), to: `ventes/${s.id}`, detail: `attendu ${eur(expectedIn)}, trésorerie ${eur(actualIn)}` });
    else if (expectedCosts !== actualCosts) badCash.push({ label: saleName(s.id), to: `ventes/${s.id}`, detail: `frais ${eur(-expectedCosts)}, trésorerie ${eur(-actualCosts)}` });
  }
  add('sale-cash', 'Ventes rapprochées de la trésorerie', 'Chaque encaissement, remboursement et frais de vente a son mouvement de trésorerie, au centime près.',
    'error', (n) => `${n} vente(s) non rapprochées de la trésorerie`, 'Le montant de la vente et les mouvements de trésorerie ne correspondent pas.', badCash);

  // 4. achats : répartition et paiement
  const badPurchase: CheckRef[] = [];
  for (const p of ds.purchases) {
    const lines = ds.purchaseLines.filter((l) => l.purchaseId === p.id);
    const first = lines[0]?.itemId;
    const to = first ? `stock/${first}` : 'stock';
    const label = `Achat du ${fr(p.date)}${p.source ? ` · ${p.source}` : ''}`;
    if (sum(lines.map((l) => l.price)) !== p.itemsTotal || sum(lines.map((l) => l.allocatedFees)) !== p.commonFees) {
      badPurchase.push({ label, to, detail: 'répartition entre les articles différente du total' });
      continue;
    }
    // les corrections de coût d'un article passent par son achat d'origine
    const itemIds = new Set(lines.map((l) => l.itemId).filter((id) => item.get(id)?.purchaseId === p.id));
    const paid = sum(ds.transactions.filter((t) => t.refId === p.id && t.kind === 'achat' && t.status !== 'annule').map((t) => t.amount));
    const corrections = sum(ds.transactions.filter((t) => t.refType === 'item' && t.refId && itemIds.has(t.refId) && t.kind === 'ajustement' && t.label.startsWith('Correction du coût')).map((t) => t.amount));
    if (paid + corrections !== -(p.itemsTotal + p.commonFees)) badPurchase.push({ label, to, detail: `total ${eur(p.itemsTotal + p.commonFees)}, trésorerie ${eur(-(paid + corrections))}` });
  }
  add('purchases', 'Achats rapprochés de la trésorerie', 'Chaque achat est réparti entre ses articles et payé une seule fois.',
    'error', (n) => `${n} achat(s) incohérent(s)`, 'Le total de l’achat, sa répartition et son paiement ne correspondent pas.', badPurchase);

  // 5. coût de chaque article = ses lignes d'achat
  const badCost: CheckRef[] = [];
  for (const i of ds.items) {
    const lines = ds.purchaseLines.filter((l) => l.itemId === i.id);
    if (!lines.length) continue;
    const fromLines = sum(lines.map((l) => l.price + l.allocatedFees));
    if (fromLines !== itemCost(i)) badCost.push({ label: i.name, to: `stock/${i.id}`, detail: `article ${eur(itemCost(i))}, achats ${eur(fromLines)}` });
  }
  const badCogs: CheckRef[] = [];
  for (const l of ds.saleLines) {
    const i = item.get(l.itemId);
    const s = sale.get(l.saleId);
    if (!i || !s || s.orderStatus === 'annulee' || i.costPending) continue;
    if (l.cogs !== itemCost(i)) badCogs.push({ label: i.name, to: `ventes/${s.id}`, detail: `coût retenu ${eur(l.cogs)}, coût actuel ${eur(itemCost(i))}` });
  }
  add('item-cost', 'Coût de chaque article justifié par ses achats', 'Le coût de revient de chaque article est la somme de ses parts d’achat et des coûts répartis.',
    'error', (n) => `${n} article(s) au coût non justifié`, 'Le coût de l’article ne correspond pas à ses lignes d’achat.', [...badCost, ...badCogs]);

  // 6. coûts manquants
  const pending = ds.items.filter((i) => i.costPending);
  add('cost-pending', 'Aucun prix d’achat manquant', 'Tous les articles ont un prix d’achat : le bénéfice est complet.',
    'warn', (n) => `${n} prix d'achat à indiquer`, 'Ces articles ont été créés par la synchro : tant que leur prix d’achat manque, le bénéfice est surestimé.', pending.map((i) => ({ label: i.name, to: `stock/${i.id}` })));

  // 7. mouvements de trésorerie orphelins
  const exists: Record<string, (id: string) => boolean> = {
    sale: (id) => sale.has(id), refund: (id) => sale.has(id), purchase: (id) => ds.purchases.some((p) => p.id === id),
    expense: (id) => ds.expenses.some((e) => e.id === id), item: (id) => item.has(id),
  };
  const orphans = ds.transactions.filter((t) => t.refType && t.refId && t.status !== 'annule' && !exists[t.refType]?.(t.refId));
  add('orphans', 'Aucun mouvement de trésorerie orphelin', 'Chaque mouvement de trésorerie renvoie à une opération qui existe encore.',
    'error', (n) => `${n} mouvement(s) sans opération`, 'Ces mouvements de trésorerie renvoient à une opération supprimée.', orphans.map((t) => ({ label: t.label, to: 'tresorerie', detail: `${fr(t.date)} · ${eur(t.amount)}` })));

  // 8. doublons possibles
  const dups: CheckRef[] = [];
  const seen = new Map<string, string>();
  for (const s of [...ds.sales].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (s.orderStatus === 'annulee') continue;
    const key = `${s.date}|${s.sellerRevenue}|${linesOf(s.id).map((l) => normTitle(item.get(l.itemId)?.name ?? '')).sort().join('+')}`;
    const prev = seen.get(key);
    if (prev) dups.push({ label: saleName(s.id), to: `ventes/${s.id}`, detail: `même jour, même montant (${eur(s.sellerRevenue)}) qu’une autre vente` });
    else seen.set(key, s.id);
  }
  add('duplicates', 'Aucun doublon de vente détecté', 'Aucune vente n’a le même article, le même jour et le même montant qu’une autre.',
    'warn', (n) => `${n} doublon(s) possible(s)`, 'Ces ventes ressemblent trait pour trait à une autre : vérifie qu’il s’agit bien de deux ventes différentes.', dups);

  // 9. rapprochement avec les e-mails Vinted
  const mismatch: CheckRef[] = [];
  for (const r of synced) {
    if (r.kind !== 'completed' || r.status !== 'applied' || !r.ref) continue;
    const s = sale.get(r.ref);
    const amount = (r.event as { amount?: Cents | null } | null)?.amount;
    if (!s || amount === null || amount === undefined || s.orderStatus === 'annulee') continue;
    const net = s.sellerRevenue - sum(refundsOf(s.id).map((x) => x.amount));
    if (net !== amount) mismatch.push({ label: saleName(s.id), to: `ventes/${s.id}`, detail: `Vinted a viré ${eur(amount)}, l’appli compte ${eur(net)}` });
  }
  if (synced.length)
    add('emails', 'Montants identiques aux e-mails Vinted', 'Chaque paiement annoncé par Vinted correspond au montant enregistré pour la vente.',
      'warn', (n) => `${n} montant(s) différent(s) des e-mails Vinted`, 'Le montant viré par Vinted n’est pas celui enregistré : corrige la vente si besoin.', mismatch);

  // 10. paiements en retard
  const late = ds.sales.filter((s) => s.orderStatus !== 'annulee' && s.paymentStatus === 'en_attente' && s.sellerRevenue > 0 && daysBetween(s.date, today) >= LATE_PAYMENT_DAYS);
  add('late', 'Aucun paiement en retard', `Toutes les ventes de plus de ${LATE_PAYMENT_DAYS} jours ont été payées.`,
    'warn', (n) => `${n} paiement(s) attendu(s) depuis plus de ${LATE_PAYMENT_DAYS} jours`, 'Vérifie sur Vinted si la commande a été finalisée, annulée ou remboursée.',
    late.map((s) => ({ label: saleName(s.id), to: `ventes/${s.id}`, detail: `vendu le ${fr(s.date)} · ${eur(s.sellerRevenue)}` })));

  return checks;
}

const fr = (d: ISODate) => d.split('-').reverse().join('/');

/** Résumé : nombre de contrôles par niveau. */
export const checkSummary = (checks: Check[]) => ({
  ok: checks.filter((c) => c.level === 'ok').length,
  warn: checks.filter((c) => c.level === 'warn').length,
  error: checks.filter((c) => c.level === 'error').length,
});
