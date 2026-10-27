/**
 * Lecture des e-mails envoyés par Vinted. Chaque e-mail utile devient un « événement » structuré ;
 * les autres (messages d'acheteurs, offres, transferts bancaires…) sont ignorés.
 * Le format a été relevé sur de vrais e-mails Vinted (France, 2026) ; le texte est normalisé pour
 * tolérer les variantes (texte brut de Gmail, tableaux, apostrophes typographiques, « €12.00 »).
 */
import { parseEuros, type Cents } from '../money';
import type { ISODate } from '../types';

export interface RawEmail {
  id: string;
  /** Date d'envoi, ISO complet. */
  date: string;
  subject: string;
  text: string;
}

interface Base {
  msgId: string;
  date: ISODate;
}

export type VintedEvent =
  | (Base & { kind: 'sale'; title: string; amount: Cents; buyer: string | null })
  | (Base & { kind: 'completed'; title: string; amount: Cents | null; transaction: string | null })
  | (Base & { kind: 'shipped'; title: string })
  | (Base & { kind: 'cancelled'; title: string })
  | (Base & { kind: 'invoice'; label: string; amount: Cents })
  | (Base & { kind: 'purchase'; title: string; total: Cents; article: Cents | null; seller: string | null })
  | (Base & { kind: 'purchase_refund'; title: string });

export const EVENT_LABEL: Record<VintedEvent['kind'], string> = {
  sale: 'Vente',
  completed: 'Paiement reçu',
  shipped: 'Colis expédié',
  cancelled: 'Vente annulée',
  invoice: 'Facture Vinted',
  purchase: 'Achat sur Vinted',
  purchase_refund: 'Achat remboursé',
};

const ENTITIES: Record<string, string> = { '&#39;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

export function normalizeText(s: string): string {
  return s
    .replace(/&#39;|&quot;|&amp;|&lt;|&gt;|&nbsp;/g, (m) => ENTITIES[m])
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[\]\(\s*\)/g, ' ')
    .replace(/[|*#]/g, ' ')
    .replace(/[’`]/g, "'")
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Montant « 80,00 € », « 1 249,00 € » ou « €12.00 ». */
const AMOUNT = String.raw`(?:€\s*)?(\d{1,5}(?:[ .]\d{3})*[.,]\d{2})\s*€?`;
const money = (s: string | undefined): Cents | null => (s ? parseEuros(s.replace(/ (?=\d{3}\b)/g, '')) : null);
const after = (text: string, label: string): Cents | null => {
  const m = text.match(new RegExp(label + String.raw`\s*:?\s*` + AMOUNT, 'i'));
  return m ? money(m[1]) : null;
};
const cleanTitle = (t: string) => t.replace(/^[«"\s]+|[»"\s.]+$/g, '').replace(/\s+/g, ' ').trim();

/** Date locale (Europe/Paris) d'un horodatage ISO. */
export function localDate(iso: string): ISODate {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // fr-CA → AAAA-MM-JJ
}

export function parseVintedEmail(e: RawEmail): VintedEvent | null {
  const subject = normalizeText(e.subject);
  const text = normalizeText(e.text);
  const base = { msgId: e.id, date: localDate(e.date) };

  // Vente : « mickelyn a acheté Robe longue … - Taille S 80,00 € »
  if (/s'est vendu/i.test(subject)) {
    const m = text.match(new RegExp(String.raw`(\S+)\s+a achet[ée]\s+(.+?)\s+` + AMOUNT, 'i'));
    if (!m) return null;
    const amount = money(m[3]);
    if (amount === null) return null;
    return { ...base, kind: 'sale', title: cleanTitle(m[2]), amount, buyer: m[1] };
  }

  // Transaction finalisée : l'argent est viré sur le porte-monnaie Vinted
  if (/transaction est finalis/i.test(subject)) {
    const t = text.match(/La vente de\s+(.+?)\s+a [ée]t[ée] r[ée]alis[ée]e/i);
    if (!t) return null;
    const tr = text.match(/Transaction\s*:?\s*#?\s*(\d{6,})/i);
    return {
      ...base,
      kind: 'completed',
      title: cleanTitle(t[1]),
      amount: after(text, "Vir[ée] sur ton compte Vinted") ?? after(text, 'Montant de la commande'),
      transaction: tr ? tr[1] : null,
    };
  }

  // Mise à jour de commande : seules l'expédition et l'annulation nous intéressent
  const upd = subject.match(/Commande mise à jour pour\s+(.+)$/i);
  if (upd) {
    const title = cleanTitle(upd[1]);
    if (/transaction a [ée]t[ée] annul[ée]e/i.test(text)) return { ...base, kind: 'cancelled', title };
    if (/en cours d'acheminement/i.test(text)) return { ...base, kind: 'shipped', title };
    return null;
  }

  // Factures de services Vinted (boosts, vitrine…) : dépense à la charge du vendeur
  if (/facture/i.test(subject)) {
    const amount = after(text, 'Total');
    if (amount === null || amount <= 0) return null;
    // libellé de la ligne facturée (« Boost international de 7 jours (1 article) 2,75 € ») — pas « Tu as boosté »
    const l = text.match(/\b((?:Boost|Vitrine|Mise en avant) [^€]*?)\s+\d{1,5}[.,]\d{2}\s*€/);
    return { ...base, kind: 'invoice', label: l ? l[1].trim() : subject.replace(/\s*:\s*ta facture/i, '').trim(), amount };
  }

  // Reçu d'un achat fait sur Vinted
  if (/re[çc]u pour (?:la|ta|votre) commande/i.test(subject)) {
    const total = after(text, 'Montant pay[ée]');
    if (total === null) return null;
    const fromSubject = subject.match(/«\s*(.+?)\s*»/);
    const fromBody = text.match(/Commande\s+(.+?)\s+Montant pay/i);
    const seller = text.match(/Vendeur\s+(\S+)/i);
    return {
      ...base,
      kind: 'purchase',
      title: cleanTitle((fromSubject ?? fromBody)?.[1] ?? 'Achat Vinted'),
      total,
      article: after(text, 'Article'),
      seller: seller ? seller[1] : null,
    };
  }

  // Achat remboursé
  if (/a [ée]t[ée] rembours[ée]e/i.test(subject)) {
    const t = subject.match(/commande\s+["«]\s*(.+?)\s*["»]/i);
    return { ...base, kind: 'purchase_refund', title: cleanTitle(t ? t[1] : subject) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Comparaison de titres
// ---------------------------------------------------------------------------

export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Mots qui ne distinguent pas un article (tailles, liaisons, mots de style des annonces). */
const STOP = new Set(['taille', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'a', 'au', 'aux', 'un', 'une', 'pour', 'avec', 'style', 'xs', 'xl', 'xxl', 'tu', 'homme', 'femme', 'mixte']);

function words(s: string): Set<string> {
  // « - Taille L » en fin de titre n'aide pas à reconnaître l'article
  const t = normTitle(s).replace(/\btaille\s+\S+$/, '');
  return new Set(t.split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
}

/**
 * Similarité de deux titres (0 à 1).
 *  - part des mots significatifs en commun ;
 *  - ou, si tous les mots du titre le plus court (au moins 2) figurent dans l'autre, 0,9 :
 *    « Jogging gris léopard » ↔ « Jogging gris clair motif léopard - Taille L ».
 */
export function titleSimilarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  const overlap = common / Math.max(A.size, B.size);
  const small = Math.min(A.size, B.size);
  const contained = small >= 2 && common === small ? 0.9 : 0;
  return Math.max(overlap, contained);
}
