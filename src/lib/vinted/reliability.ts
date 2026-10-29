/**
 * Fiabilité de la synchro : e-mails en double, formats inconnus, historique des synchros.
 */
import type { RawEmail } from './parse';

/** Version des règles de lecture des e-mails : à chaque changement, les e-mails non reconnus sont relus. */
export const PARSER_VERSION = 2;

/**
 * Empreinte du contenu d'un e-mail (objet, minute d'envoi, texte). Deux e-mails identiques au mot près,
 * envoyés à la même minute, sont un doublon (e-mail reçu deux fois, transféré, relu par un autre moyen).
 * Deux ventes du même article restent distinctes : leurs heures d'envoi diffèrent.
 */
export function fingerprint(e: Pick<RawEmail, 'subject' | 'text' | 'date'>): string {
  const s = `${e.subject.trim().toLowerCase()}|${e.date.slice(0, 16)}|${e.text.replace(/\s+/g, ' ').trim().toLowerCase()}`;
  // FNV-1a 32 bits, deux passes (sens normal et inverse) : 64 bits suffisent largement ici
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 ^ s.charCodeAt(s.length - 1 - i), 0x01000193);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/**
 * L'objet annonce une opération que l'appli sait enregistrer (vente, paiement, achat, facture, bordereau,
 * remboursement). Si sa lecture échoue, c'est probablement que Vinted a changé le format de l'e-mail.
 */
export function announcesOperation(subject: string): boolean {
  const s = subject.toLowerCase().replace(/[’`]/g, "'");
  return /s'est vendu|transaction est finalis|^bordereau d'envoi|re[çc]u pour (?:la|ta|votre) commande|a [ée]t[ée] rembours[ée]e|facture/.test(s);
}

export interface SyncRun {
  at: string;
  ok: boolean;
  /** synchro incomplète : certains e-mails seront relus la prochaine fois */
  partial?: boolean;
  read: number;
  added: number;
  applied: number;
  error?: string;
  ms: number;
}

export const SYNC_LOG_SIZE = 20;
/** Au-delà, la synchro est considérée en retard (bandeau d'alerte). */
export const STALE_SYNC_HOURS = 24;

export function syncHealth(s: { lastSyncAt: string | null; syncLog?: SyncRun[] }, now = Date.now()) {
  const last = s.syncLog?.[0];
  const okAt = s.lastSyncAt;
  const hours = okAt ? (now - Date.parse(okAt)) / 3_600_000 : null;
  const failing = !!last && !last.ok;
  return {
    okAt,
    hours,
    failing,
    lastError: failing ? last!.error ?? 'Erreur inconnue' : null,
    stale: hours === null || hours >= STALE_SYNC_HOURS,
    partial: !!last?.partial,
  };
}

/** « il y a 5 min », « il y a 3 h », « hier à 18:02 », « le 12/10 à 09:15 ». */
export function sinceLabel(iso: string, now = Date.now()) {
  const d = new Date(iso);
  const min = Math.round((now - d.getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 24 * 60) return `il y a ${Math.round(min / 60)} h`;
  const t = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (min < 48 * 60) return `hier à ${t}`;
  return `le ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${t}`;
}
