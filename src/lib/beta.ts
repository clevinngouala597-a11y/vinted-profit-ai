/**
 * Version bêta : publiée à part (…/vinted-profit-ai/beta/), avec sa propre base de données sur
 * l'appareil, des données d'exemple pour essayer tout de suite, et un formulaire d'avis.
 *
 * Les avis sont envoyés en notification via ntfy.sh sur un sujet dédié : le créateur de l'appli
 * s'y abonne dans l'appli ntfy et reçoit chaque avis sur son téléphone. Le sujet est public (comme
 * tout le code de l'appli) : les testeurs sont prévenus de ne pas y mettre d'informations personnelles.
 */
import { isAdmin, viewAsTester } from './betaAccess';

export const BETA = import.meta.env.VITE_BETA === '1';
export const BUILD: string = (import.meta.env.VITE_BUILD || 'dev').slice(0, 7);
export const FEEDBACK_TOPIC = 'cng-vinted-avis-d64bxo3kxbfgy7e9uplx';

/** Fonctions réservées à la version complète pendant la bêta (écran → nom affiché). */
export const LOCKED: Record<string, string> = {
  previsions: 'Prévisions', fiscal: 'Fiscalité', tresorerie: 'Trésorerie et réinvestissement', exports: 'Exports et sauvegarde', import: 'Import',
  annonce: 'Annonce IA', photos: 'Photos IA',
  messages: 'Messages prêts', republier: 'À republier', calculateur: 'Calculateur de prix', resume: 'Résumé du mois',
  bordereaux: 'Bordereaux',
};
export const isLocked = (route: string | undefined) => BETA && !!route && route.split('?')[0] in LOCKED && (!isAdmin() || viewAsTester());

export const FEEDBACK_KINDS = [
  { id: 'bug', label: '🐞 Un bug', tag: 'bug', title: 'Bug' },
  { id: 'idee', label: '💡 Une idée', tag: 'bulb', title: 'Idée' },
  { id: 'pasclair', label: '😕 Pas clair', tag: 'thinking', title: 'Pas clair' },
  { id: 'aime', label: '❤️ J’aime', tag: 'heart', title: 'J’aime' },
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]['id'];

export interface FeedbackInput {
  kind: FeedbackKind;
  /** « Testeur 03 » (code d'invitation) */
  tester?: string | null;
  /** 1 à 5, ou null si pas de note */
  rating: number | null;
  message: string;
  contact: string;
  /** écran, version, appareil */
  tech: { screen: string; build: string; device: string } | null;
}

/** Appareil en clair, sans identifiant : « iPhone · iOS 18.1 · appli installée ». */
export function deviceSummary(ua: string, standalone: boolean, width: number) {
  const ios = ua.match(/OS (\d+)[._](\d+)/);
  const kind = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Ordinateur';
  const os = ios && /iPhone|iPad/.test(ua) ? `iOS ${ios[1]}.${ios[2]}` : /Android (\d+)/.exec(ua)?.[0] ?? '';
  return [kind, os, `${width} px`, standalone ? 'appli installée' : 'navigateur'].filter(Boolean).join(' · ');
}

export function feedbackMessage(f: FeedbackInput) {
  const kind = FEEDBACK_KINDS.find((k) => k.id === f.kind)!;
  const lines = [f.message.trim()];
  if (f.tester) lines.unshift(`[${f.tester}]`);
  if (f.rating) lines.push('', `Note : ${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}`);
  if (f.contact.trim()) lines.push(`Contact : ${f.contact.trim()}`);
  if (f.tech) lines.push('', `Écran : ${f.tech.screen || 'accueil'} · version ${f.tech.build}`, f.tech.device);
  return {
    topic: FEEDBACK_TOPIC,
    title: `Avis bêta · ${kind.title}`,
    message: lines.join('\n').slice(0, 3800),
    tags: [kind.tag],
    priority: f.kind === 'bug' ? 4 : 3,
  };
}

export async function sendFeedback(f: FeedbackInput, fetcher: typeof fetch = fetch) {
  if (f.message.trim().length < 3) throw new Error('Écris quelques mots pour expliquer.');
  let res: Response;
  try {
    res = await fetcher('https://ntfy.sh/', { method: 'POST', body: JSON.stringify(feedbackMessage(f)) });
  } catch {
    throw new Error('Pas de connexion internet : réessaie dans un moment.');
  }
  if (!res.ok) throw new Error(res.status === 429 ? 'Trop d’envois d’un coup : réessaie dans une minute.' : 'Envoi impossible pour le moment, réessaie plus tard.');
}

/** Prévient le créateur de l'appli qu'un testeur vient d'ouvrir la bêta. */
export async function announceTester(tester: string, fetcher: typeof fetch = fetch) {
  await fetcher('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: FEEDBACK_TOPIC, title: `Nouveau testeur · ${tester}`, message: `${tester} vient d'ouvrir la bêta.`, tags: ['tada'], priority: 3 }) }).catch(() => {});
}
