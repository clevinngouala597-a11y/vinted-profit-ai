/**
 * Nouveautés : à chaque mise à jour publiée, ajouter une entrée EN HAUT de la liste (id = date AAAA-MM-JJ,
 * suffixée -2, -3… s'il y en a plusieurs le même jour). À la prochaine ouverture, chaque utilisateur
 * voit les nouveautés qu'il n'a pas encore vues.
 *
 * `beta: true` sur un point : affiché seulement dans la version bêta.
 */
import { BETA } from './beta';

export interface ChangePoint { text: string; beta?: boolean }
export interface ChangeEntry { id: string; date: string; title: string; points: ChangePoint[] }

export const CHANGELOG: ChangeEntry[] = [
  {
    id: '2026-11-01-2',
    date: '2026-11-01',
    title: 'Tendances sur l’accueil',
    points: [
      { text: 'Tendances : accès direct depuis l’accueil (carte 🔥 Tendances), en plus du Menu.', beta: true },
    ],
  },
  {
    id: '2026-11-01',
    date: '2026-11-01',
    title: 'Prix d’achat habituels et plusieurs comptes Gmail',
    points: [
      { text: 'Prix d’achat habituels : un prix par catégorie et tes modèles (ex. Nike Air Force 1 · 15 €). Le prix se remplit tout seul quand tu ajoutes un achat, et reste modifiable. Réglages → Prix d’achat habituels.' },
      { text: 'Articles créés par la synchro sans prix : le prix habituel est proposé, et un bouton les applique tous d’un coup.' },
      { text: 'Plusieurs comptes Gmail : connecte une adresse par compte Vinted, chacune reliée à son dressing. Chaque compte se synchronise et se déconnecte séparément. Synchro Vinted → Ajouter un compte Gmail.' },
      { text: 'Tendances : les articles les plus likés du moment, avec photo, marque, taille, prix et lien Vinted. Menu → Tendances.', beta: true },
      { text: 'Ce message « Nouveautés » : tu seras prévenu à chaque mise à jour. Menu → Nouveautés pour tout revoir.' },
    ],
  },
];

const KEY = BETA ? 'cng-beta-nouveautes-vu' : 'cng-nouveautes-vu';

/** Entrées visibles dans cette version (les points bêta sont retirés de la version officielle). */
export function visibleChangelog(beta = BETA, list = CHANGELOG): ChangeEntry[] {
  return list
    .map((e) => ({ ...e, points: e.points.filter((p) => beta || !p.beta) }))
    .filter((e) => e.points.length);
}

export function lastSeen(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function markSeen(id = visibleChangelog()[0]?.id) {
  if (!id) return;
  try { localStorage.setItem(KEY, id); } catch { /* navigation privée */ }
}

/**
 * Nouveautés à montrer à l'ouverture : celles publiées depuis la dernière vue (3 au plus).
 * Nouvel utilisateur (rien vu, aucune donnée) : rien à montrer, tout est neuf pour lui.
 */
export function unseen(seen: string | null, isNewUser: boolean, list = visibleChangelog()): ChangeEntry[] {
  if (seen === null && isNewUser) return [];
  const fresh = seen === null ? list.slice(0, 1) : list.filter((e) => e.id > seen);
  return fresh.slice(0, 3);
}
