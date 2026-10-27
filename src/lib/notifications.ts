/**
 * Centre de notifications. Les alertes sont CALCULÉES à partir des données (aucune n'est stockée) ;
 * seul le masquage est enregistré. Chaque alerte porte une « signature » qui résume la situation :
 * une alerte masquée ne revient que si la situation change (ex. un nouvel article devient ancien),
 * ce qui évite les rappels répétitifs.
 */
import { daysBetween, goalProgress, saleBreakdown, stockState, isAwaitingPayment } from './engine';
import { declarationPeriods, dac7, RULES } from './fiscal';
import { monthVsForecast } from './forecast';
import { formatEuros } from './money';
import type { Dataset, ISODate } from './types';

export const CATEGORIES = {
  stock: 'Articles en stock depuis longtemps',
  justificatifs: 'Dépenses à justifier',
  incoherences: 'Opérations à vérifier',
  objectifs: 'Objectifs du mois',
  donnees: 'Données manquantes',
  previsions: 'Écarts avec les prévisions',
  fiscal: 'Rappels fiscaux',
  sauvegarde: 'Sauvegardes',
} as const;
export type NotifCategory = keyof typeof CATEGORIES;

export interface Notif {
  id: string; // catégorie:clé:signature
  category: NotifCategory;
  level: 'info' | 'warn' | 'danger' | 'ok';
  title: string;
  text: string;
  to: string;
}

/** Signature courte et stable d'une liste d'identifiants. */
function sig(ids: string[]): string {
  let h = 5381;
  for (const c of [...ids].sort().join('|')) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function computeNotifications(ds: Dataset, today: ISODate): Notif[] {
  const out: Notif[] = [];
  const add = (category: NotifCategory, key: string, signature: string, n: Omit<Notif, 'id' | 'category'>) =>
    out.push({ ...n, category, id: `${category}:${key}:${signature}` });

  // --- stock ancien
  const st = stockState(ds, today);
  const showStock = ds.settings.showStock === true;
  if (showStock && st.stale.length)
    add('stock', 'anciens', sig(st.stale.map((i) => i.id)), {
      level: 'warn',
      title: `${plural(st.stale.length, 'article', 'articles')} en stock depuis ${ds.settings.staleDays} jours ou plus`,
      text: `${formatEuros(st.stale.reduce((a, i) => a + i.purchasePrice + i.directFees, 0))} immobilisés. Baisse le prix, republie ou regroupe-les en lot.`,
      to: 'stock?filtre=anciens',
    });

  // --- justificatifs
  const noProof = ds.expenses.filter((e) => !e.attachmentId);
  if (noProof.length)
    add('justificatifs', 'sans', sig(noProof.map((e) => e.id)), {
      level: 'info',
      title: `${plural(noProof.length, 'dépense', 'dépenses')} sans justificatif`,
      text: 'Ajoute une photo du ticket : utile pour ton bilan et en cas de contrôle.',
      to: 'depenses',
    });

  // --- incohérences
  const live = ds.sales.filter((s) => s.orderStatus !== 'annulee');
  const losses = live.filter((s) => saleBreakdown(ds, s).isLoss);
  if (losses.length)
    add('incoherences', 'pertes', sig(losses.map((s) => s.id)), {
      level: 'danger',
      title: `${plural(losses.length, 'vente', 'ventes')} à perte`,
      text: 'Le montant encaissé ne couvre pas le coût de revient et les frais. Vérifie les montants saisis.',
      to: 'ventes?filtre=perte',
    });
  const oldPending = live.filter((s) => isAwaitingPayment(ds, s) && daysBetween(s.date, today) >= 14);
  if (oldPending.length)
    add('incoherences', 'paiements', sig(oldPending.map((s) => s.id)), {
      level: 'warn',
      title: `${plural(oldPending.length, 'paiement', 'paiements')} en attente depuis plus de 14 jours`,
      text: "As-tu reçu l'argent ? Marque le paiement comme reçu, ou annule la vente si elle n'a pas abouti.",
      to: 'ventes?filtre=attente',
    });
  const notShipped = live.filter((s) => s.orderStatus === 'confirmee' && daysBetween(s.date, today) >= 5);
  if (notShipped.length)
    add('incoherences', 'expedition', sig(notShipped.map((s) => s.id)), {
      level: 'warn',
      title: `${plural(notShipped.length, 'vente confirmée', 'ventes confirmées')} sans expédition depuis 5 jours`,
      text: "Marque-les comme expédiées si c'est fait.",
      to: 'ventes?filtre=confirmer',
    });
  const notBack = ds.refunds.filter((r) => !r.itemRecovered && !ds.refunds.some((x) => x.saleId === r.saleId && x.itemRecovered) && daysBetween(r.date, today) >= 14);
  if (notBack.length)
    add('incoherences', 'retours', sig(notBack.map((r) => r.id)), {
      level: 'warn',
      title: `${plural(notBack.length, 'retour', 'retours')} non récupéré${notBack.length > 1 ? 's' : ''} après 14 jours`,
      text: "L'article n'est pas encore revenu dans ton stock.",
      to: 'ventes?filtre=remboursees',
    });

  // --- objectifs (à partir du 10e jour, quand le rythme est significatif)
  const month = today.slice(0, 7);
  if (Number(today.slice(8, 10)) >= 10) {
    const gp = goalProgress(ds, month, today);
    const late = gp.lines.filter((l) => l.status === 'en_retard' || l.status === 'depasse');
    const done = gp.lines.filter((l) => l.status === 'atteint' && l.kind === 'min' && l.key !== 'cashToKeep');
    if (late.length)
      add('objectifs', `retard-${month}`, sig(late.map((l) => l.key)), {
        level: 'warn',
        title: late.length === 1 ? `Objectif en retard : ${late[0].label.toLowerCase()}` : `${late.length} objectifs en retard ce mois-ci`,
        text: late.map((l) => l.label).join(', ') + '.',
        to: 'objectifs',
      });
    if (done.length)
      add('objectifs', `atteint-${month}`, sig(done.map((l) => l.key)), {
        level: 'ok',
        title: done.length === 1 ? `Objectif atteint : ${done[0].label.toLowerCase()}` : `${done.length} objectifs atteints ce mois-ci`,
        text: done.map((l) => l.label).join(', ') + '.',
        to: 'objectifs',
      });
  }

  // --- données manquantes
  if (showStock && st.missingTarget)
    add('donnees', 'prix', String(st.missingTarget), {
      level: 'info',
      title: `${plural(st.missingTarget, 'article', 'articles')} sans prix de vente souhaité`,
      text: 'Nécessaire pour estimer le bénéfice potentiel du stock et répartir les lots.',
      to: 'stock?filtre=sansprix',
    });
  if (ds.settings.initialCash === 0 && ds.transactions.length > 0 && ds.settings.safetyReserve === 0)
    add('donnees', 'tresorerie', '1', {
      level: 'info',
      title: 'Trésorerie de départ non renseignée',
      text: 'Sans elle, le solde affiché ne correspond pas à ton argent réellement disponible.',
      to: 'reglages',
    });

  // --- écart avec les prévisions
  const gap = monthVsForecast(ds, today);
  if (gap && gap.actual < gap.prudent)
    add('previsions', `mois-${month}`, String(Math.floor(gap.actual / 1000)), {
      level: 'warn',
      title: 'Mois en dessous de ton rythme habituel',
      text: `Bénéfice du mois : ${formatEuros(gap.actual)}, contre environ ${formatEuros(gap.expected)} attendus à cette date d'après les semaines précédentes.`,
      to: 'previsions',
    });

  // --- fiscal
  const year = Number(today.slice(0, 4));
  const d = dac7(ds, year);
  if (d.reportable)
    add('fiscal', `dac7-${year}`, '1', {
      level: 'info',
      title: `Seuils DAC7 atteints en ${year}`,
      text: `${d.count} ventes, ${formatEuros(d.amount)} : Vinted transmettra probablement tes données de vente à l'administration fiscale.`,
      to: 'fiscal',
    });
  if (ds.settings.activityStatus === 'particulier' && ds.purchases.length >= 3)
    add('fiscal', 'achat-revente', '1', {
      level: 'warn',
      title: 'Achat-revente : vérifie ton statut',
      text: RULES.resaleTaxable.label + '.',
      to: 'fiscal',
    });
  if (ds.settings.activityStatus === 'micro') {
    const closed = declarationPeriods(ds, year, today).filter((p) => p.closed);
    const lastPeriod = closed[closed.length - 1];
    if (lastPeriod && daysBetween(lastPeriod.to, today) <= 31)
      add('fiscal', `decl-${lastPeriod.key}`, '1', {
        level: 'info',
        title: `Déclaration Urssaf : ${lastPeriod.label}`,
        text: `Recettes encaissées à déclarer : ${formatEuros(lastPeriod.receipts)} (même à 0 €). Vérifie la date limite dans ton espace autoentrepreneur.urssaf.fr.`,
        to: 'fiscal',
      });
  }

  // --- sauvegarde
  const hasData = ds.items.length + ds.expenses.length > 0;
  const last = ds.settings.lastBackupAt?.slice(0, 10) ?? null;
  if (hasData && (!last || daysBetween(last, today) >= 7))
    add('sauvegarde', 'rappel', last ?? 'jamais', {
      level: last ? 'info' : 'warn',
      title: last ? `Dernière sauvegarde il y a ${daysBetween(last, today)} jours` : 'Aucune sauvegarde pour l’instant',
      text: 'Tes données sont seulement sur ce téléphone. Une sauvegarde dans Fichiers ou iCloud Drive les protège.',
      to: 'exports',
    });

  const enabled = out.filter((n) => !ds.settings.disabledNotifications.includes(n.category));
  const rank = { danger: 0, warn: 1, info: 2, ok: 3 };
  return enabled.sort((a, b) => rank[a.level] - rank[b.level]);
}

export const visibleNotifications = (all: Notif[], dismissed: Set<string>) => all.filter((n) => !dismissed.has(n.id));
