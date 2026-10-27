/**
 * Module fiscal — AIDE à la préparation, jamais une déclaration.
 *
 * Toutes les règles chiffrées sont regroupées ici avec leur source officielle et la date de vérification.
 * Aucun taux n'est appliqué si le statut de l'utilisateur ne le justifie pas : un particulier ne reçoit
 * pas d'estimation de cotisations, seulement les informations utiles et les alertes.
 *
 * Distinction essentielle : le chiffre d'affaires fiscal d'un micro-entrepreneur correspond aux RECETTES
 * ENCAISSÉES (date du paiement), pas au bénéfice commercial calculé par l'application.
 */
import { sum, type Cents } from './money';
import type { Dataset, ISODate, Transaction } from './types';

export const VERIFIED_ON = '2026-10-27';

export interface Rule<T = number> {
  value: T;
  label: string;
  source: string;
  url: string;
}

export const RULES = {
  dac7Sales: {
    value: 30,
    label: 'Transmission DAC7 : à partir de 30 ventes dans l’année civile, ou plus de 2 000 € encaissés',
    source: 'BOFiP, BOI-INT-AEA-30-20-10, § 10',
    url: 'https://bofip.impots.gouv.fr/bofip/13762-PGP.html/identifiant=BOI-INT-AEA-30-20-10-20230111',
  },
  dac7Amount: {
    value: 200_000,
    label: 'Seuil DAC7 en montant',
    source: 'BOFiP, BOI-INT-AEA-30-20-10, § 10',
    url: 'https://bofip.impots.gouv.fr/bofip/13762-PGP.html/identifiant=BOI-INT-AEA-30-20-10-20230111',
  },
  resaleTaxable: {
    value: 1,
    label: 'Les ventes de biens achetés pour être revendus sont imposables et doivent être déclarées',
    source: 'impots.gouv.fr, « Comment déclarer mes revenus issus de l’économie collaborative ? »',
    url: 'https://www.impots.gouv.fr/particulier/questions/comment-declarer-mes-revenus-issus-de-leconomie-collaborative',
  },
  microCeiling: {
    value: 18_870_000,
    label: 'Plafond de chiffre d’affaires de la micro-entreprise (ventes de marchandises)',
    source: 'impots.gouv.fr, fiche « Les régimes réservés aux petites entreprises » 2026',
    url: 'https://www.impots.gouv.fr/sites/default/files/media/3_Documentation/depliants/pro_fiche_regimes_reserves_aux_petites_entreprises_2026.pdf',
  },
  microAllowance: {
    value: 71,
    label: 'Abattement forfaitaire micro-BIC (achat de biens revendus en l’état)',
    source: 'impots.gouv.fr, fiche « Les régimes réservés aux petites entreprises » 2026',
    url: 'https://www.impots.gouv.fr/sites/default/files/media/3_Documentation/depliants/pro_fiche_regimes_reserves_aux_petites_entreprises_2026.pdf',
  },
  vatBase: {
    value: 8_500_000,
    label: 'Franchise en base de TVA (ventes) : seuil de base',
    source: 'impots.gouv.fr, fiche « Les régimes réservés aux petites entreprises » 2026',
    url: 'https://www.impots.gouv.fr/sites/default/files/media/3_Documentation/depliants/pro_fiche_regimes_reserves_aux_petites_entreprises_2026.pdf',
  },
  vatMajor: {
    value: 9_350_000,
    label: 'Franchise en base de TVA (ventes) : seuil majoré',
    source: 'impots.gouv.fr, fiche « Les régimes réservés aux petites entreprises » 2026',
    url: 'https://www.impots.gouv.fr/sites/default/files/media/3_Documentation/depliants/pro_fiche_regimes_reserves_aux_petites_entreprises_2026.pdf',
  },
  socialRate: {
    value: 12.3,
    label: 'Cotisations sociales micro-entrepreneur, achat-revente de marchandises (BIC)',
    source: 'economie.gouv.fr, « Micro-entreprises, quel est le montant de vos cotisations sociales ? » (06/03/2026)',
    url: 'https://www.economie.gouv.fr/entreprises/gerer-sa-micro-entreprise/micro-entreprises-quel-est-le-montant-de-vos-cotisations-sociales',
  },
  cfpRate: {
    value: 0.1,
    label: 'Contribution à la formation professionnelle (activité commerciale)',
    source: 'economie.gouv.fr, « Micro-entreprises, quel est le montant de vos cotisations sociales ? » (06/03/2026)',
    url: 'https://www.economie.gouv.fr/entreprises/gerer-sa-micro-entreprise/micro-entreprises-quel-est-le-montant-de-vos-cotisations-sociales',
  },
  vlRate: {
    value: 1,
    label: 'Versement libératoire de l’impôt sur le revenu (ventes de marchandises), sur option',
    source: 'impots.gouv.fr, fiche « Les régimes réservés aux petites entreprises » 2026',
    url: 'https://www.impots.gouv.fr/sites/default/files/media/3_Documentation/depliants/pro_fiche_regimes_reserves_aux_petites_entreprises_2026.pdf',
  },
  vlIncomeCap: {
    value: 2_931_500,
    label: 'Condition du versement libératoire en 2026 : revenu fiscal de référence 2024 ≤ 29 315 € par part',
    source: 'impots.gouv.fr, fiche « Les régimes réservés aux petites entreprises » 2026',
    url: 'https://www.impots.gouv.fr/sites/default/files/media/3_Documentation/depliants/pro_fiche_regimes_reserves_aux_petites_entreprises_2026.pdf',
  },
  books: {
    value: 1,
    label: 'Obligations : livre des recettes (chronologique) et registre des achats pour une activité de vente ; déclaration Urssaf chaque mois ou trimestre, même à 0 €',
    source: 'economie.gouv.fr, « Micro-entrepreneur : quelles sont vos obligations ? » (14/01/2026)',
    url: 'https://www.economie.gouv.fr/entreprises/gerer-sa-micro-entreprise/micro-entrepreneur-auto-entrepreneur-quelles-sont-vos-obligations',
  },
} satisfies Record<string, Rule>;

// ---------------------------------------------------------------------------
// Recettes encaissées
// ---------------------------------------------------------------------------

/** Un mouvement de trésorerie qui modifie les recettes encaissées (ventes, remboursements, corrections de montant). */
export const isReceipt = (t: Transaction) =>
  t.status === 'confirme' && (t.kind === 'vente' || t.kind === 'remboursement' || (t.kind === 'ajustement' && t.sub === 'recette'));

/** Recettes encaissées sur une période, à la date d'encaissement (remboursements déduits). */
export function receipts(ds: Dataset, from: ISODate, to: ISODate): Cents {
  return sum(ds.transactions.filter((t) => isReceipt(t) && t.date >= from && t.date <= to).map((t) => t.amount));
}

/** Compteur DAC7 approché : ventes non annulées et montants encaissés dans l'année civile (date de la vente). */
export function dac7(ds: Dataset, year: number) {
  const y = String(year);
  const sales = ds.sales.filter((s) => s.date.startsWith(y) && s.orderStatus !== 'annulee');
  const count = sales.length;
  const amount = sum(sales.map((s) => s.sellerRevenue));
  const reportable = count >= RULES.dac7Sales.value || amount > RULES.dac7Amount.value;
  return { count, amount, reportable };
}

// ---------------------------------------------------------------------------
// Périodes de déclaration Urssaf
// ---------------------------------------------------------------------------

export interface DeclPeriod {
  key: string;
  label: string;
  from: ISODate;
  to: ISODate;
  receipts: Cents;
  social: Cents | null;
  cfp: Cents | null;
  vl: Cents | null;
  total: Cents | null;
  closed: boolean; // période terminée
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const monthName = (m: number) => new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(new Date(2026, m - 1, 15));

const pct = (base: Cents, rate: number) => Math.round((base * rate) / 100);

/** Estimation des cotisations d'une période, uniquement pour un micro-entrepreneur. */
export function contributions(ds: Dataset, base: Cents) {
  if (ds.settings.activityStatus !== 'micro') return { social: null, cfp: null, vl: null, total: null };
  const social = pct(Math.max(0, base), RULES.socialRate.value);
  const cfp = pct(Math.max(0, base), RULES.cfpRate.value);
  const vl = ds.settings.versementLiberatoire ? pct(Math.max(0, base), RULES.vlRate.value) : 0;
  return { social, cfp, vl, total: social + cfp + vl };
}

export function declarationPeriods(ds: Dataset, year: number, today: ISODate): DeclPeriod[] {
  const monthly = ds.settings.declarationFrequency === 'mensuelle';
  const out: DeclPeriod[] = [];
  const steps = monthly ? 12 : 4;
  for (let i = 0; i < steps; i++) {
    const m1 = monthly ? i + 1 : i * 3 + 1;
    const m2 = monthly ? i + 1 : i * 3 + 3;
    const from = `${year}-${pad(m1)}-01`;
    const to = `${year}-${pad(m2)}-${pad(lastDay(year, m2))}`;
    if (from > today) break;
    // pas de période avant le début d'activité déclaré
    if (ds.settings.activityStart && to < ds.settings.activityStart) continue;
    const r = receipts(ds, from, to);
    out.push({
      key: from,
      label: monthly ? `${monthName(m1)} ${year}` : `${i + 1}${i ? 'e' : 'er'} trimestre ${year}`,
      from,
      to,
      receipts: r,
      ...contributions(ds, r),
      closed: to < today,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synthèse annuelle et alertes
// ---------------------------------------------------------------------------

export interface FiscalAlert {
  level: 'info' | 'warn' | 'danger';
  text: string;
  rule?: keyof typeof RULES;
}

export function fiscalSummary(ds: Dataset, year: number, today: ISODate) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const r = receipts(ds, from, to);
  const d = dac7(ds, year);
  const status = ds.settings.activityStatus;
  const est = contributions(ds, r);
  const taxableBase = status === 'micro' && !ds.settings.versementLiberatoire ? Math.round((Math.max(0, r) * (100 - RULES.microAllowance.value)) / 100) : null;
  const purchases = sum(ds.purchases.filter((p) => p.date >= from && p.date <= to).map((p) => p.itemsTotal + p.commonFees));
  const alerts: FiscalAlert[] = [];

  if (status === 'particulier' && ds.purchases.length > 0)
    alerts.push({
      level: 'warn',
      rule: 'resaleTaxable',
      text: "Tu achètes des articles pour les revendre : selon l'administration fiscale, ces ventes sont imposables et doivent être déclarées. Vérifie ta situation (micro-entreprise ou autre) auprès des impôts ou de l'Urssaf.",
    });
  if (status === 'autre')
    alerts.push({ level: 'info', text: "Pour ton statut, aucune estimation n'est calculée : transmets ces chiffres à ton expert-comptable." });
  if (d.reportable)
    alerts.push({ level: 'info', rule: 'dac7Sales', text: `Avec ${d.count} ventes et ${(d.amount / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} encaissés en ${year}, Vinted transmettra probablement tes informations de vente à l'administration fiscale (DAC7). Cette transmission ne rend pas à elle seule les sommes imposables.` });
  else if (d.count >= 25 || d.amount > 160_000)
    alerts.push({ level: 'info', rule: 'dac7Sales', text: `Tu approches des seuils de transmission DAC7 (${d.count}/30 ventes, ${(d.amount / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} / 2 000 €).` });
  if (status === 'micro') {
    if (r > RULES.vatMajor.value) alerts.push({ level: 'danger', rule: 'vatMajor', text: 'Recettes au-dessus du seuil majoré de franchise de TVA : la TVA est due dès le dépassement. Contacte ton service des impôts.' });
    else if (r > RULES.vatBase.value) alerts.push({ level: 'warn', rule: 'vatBase', text: 'Recettes au-dessus du seuil de base de franchise de TVA : vérifie les conséquences pour l’année suivante.' });
    else if (r > RULES.vatBase.value * 0.8) alerts.push({ level: 'info', rule: 'vatBase', text: 'Tu as atteint 80 % du seuil de franchise de TVA.' });
    if (r > RULES.microCeiling.value) alerts.push({ level: 'danger', rule: 'microCeiling', text: 'Recettes au-dessus du plafond de la micro-entreprise.' });
    if (!ds.settings.activityStart) alerts.push({ level: 'warn', text: "Indique ta date de début d'activité (immatriculation) : elle sert à vérifier les périodes déclarées." });
    if (ds.settings.vatRegime === 'inconnu') alerts.push({ level: 'warn', text: 'Précise ton régime de TVA (franchise en base ou assujetti).' });
  }
  const unpaid = ds.sales.filter((s) => s.paymentStatus === 'en_attente' && s.orderStatus !== 'annulee' && s.date >= from && s.date <= to).length;
  if (unpaid) alerts.push({ level: 'info', text: `${unpaid} vente${unpaid > 1 ? 's' : ''} sans paiement confirmé : ${unpaid > 1 ? 'elles ne sont' : 'elle n’est'} pas encore comptée${unpaid > 1 ? 's' : ''} dans les recettes encaissées.` });
  const noProof = ds.expenses.filter((e) => !e.attachmentId && e.date >= from && e.date <= to).length;
  if (noProof) alerts.push({ level: 'info', text: `${noProof} dépense${noProof > 1 ? 's' : ''} sans justificatif cette année.` });

  return { year, receipts: r, dac7: d, ...est, taxableBase, purchases, alerts, periods: declarationPeriods(ds, year, today) };
}
