/**
 * Montants monétaires.
 *
 * Règle : tous les montants sont stockés en CENTIMES D'EURO, sous forme d'entiers.
 * Aucun calcul financier ne passe par des flottants en euros : on évite ainsi
 * les erreurs du type 0,1 + 0,2 = 0,30000000000000004.
 *
 * Arrondi : au centime, « demi vers l'extérieur » (0,005 € → 0,01 € ; -0,005 € → -0,01 €).
 * Les pourcentages sont arrondis à 2 décimales selon la même règle.
 */

export type Cents = number;

/** Arrondi demi vers l'extérieur (half away from zero). */
export function roundHalfAway(x: number, decimals = 0): number {
  const f = 10 ** decimals;
  const v = Math.abs(x) * f;
  // petite tolérance pour absorber les erreurs de représentation (ex. 1.005)
  const r = Math.floor(v + 0.5 + 1e-9);
  return (Math.sign(x) * r) / f || 0;
}

/** Convertit une saisie utilisateur ("12", "12,5", "12.50", "1 234,56 €") en centimes. Renvoie null si invalide. */
export function parseEuros(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? roundHalfAway(input * 100) : null;
  const s = input.replace(/[\s €]/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, decPart = ''] = s.replace('-', '').split('.');
  const neg = s.startsWith('-');
  // conversion exacte en chaîne pour éviter les flottants
  const dec = (decPart + '000').slice(0, 3); // 3 chiffres pour pouvoir arrondir
  let cents = Number(intPart) * 100 + Number(dec.slice(0, 2));
  if (Number(dec[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmtSigned = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });

export function formatEuros(c: Cents, opts?: { signed?: boolean }): string {
  // `|| 0` évite l'affichage « -0,00 € » pour un zéro négatif
  return (opts?.signed ? fmtSigned : fmt).format((c || 0) / 100);
}

/** Valeur pour un champ de saisie : 1250 → "12,50". */
export function centsToInput(c: Cents | null | undefined): string {
  if (c === null || c === undefined) return '';
  return (c / 100).toFixed(2).replace('.', ',');
}

/** Pourcentage arrondi à 2 décimales, ou null si le dénominateur n'est pas strictement positif. */
export function percent(numerator: Cents, denominator: Cents): number | null {
  if (!(denominator > 0)) return null;
  return roundHalfAway((numerator / denominator) * 100, 2);
}

export function formatPercent(p: number | null): string {
  if (p === null) return 'non applicable';
  return `${p.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} %`;
}

/**
 * Répartit `total` centimes proportionnellement aux `weights`,
 * par la méthode du plus fort reste : la somme des parts est EXACTEMENT égale au total.
 * Si tous les poids sont nuls (ou absents), répartition à parts égales.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sumW = w.reduce((a, b) => a + b, 0);
  const effective = sumW > 0 ? w : w.map(() => 1);
  const sum = sumW > 0 ? sumW : n;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = effective.map((x) => (abs * x) / sum);
  const floors = raw.map((x) => Math.floor(x));
  let rest = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) floors[order[k].i] += 1;
  return floors.map((x) => sign * x);
}

export const sum = (xs: Cents[]): Cents => xs.reduce((a, b) => a + b, 0);
