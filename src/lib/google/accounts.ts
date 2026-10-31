/**
 * Comptes Gmail connectés et leur dressing. Chaque compte a sa propre synchro (point de reprise,
 * dernière synchro réussie) : un compte en panne ne bloque pas les autres.
 */
import { loadDataset, saveSettings } from '../actions';
import { MAIN, shopsOf } from '../shops';
import type { Settings } from '../types';
import { signOut } from './auth';

export interface GoogleAccount {
  email: string;
  /** dressing où ranger les e-mails de ce compte (sauf pseudo Vinted reconnu) */
  shop: string;
  lastSyncAt: string | null;
  syncedFrom: string | null;
}

type AccSettings = Pick<Settings, 'googleAccounts' | 'syncMode' | 'googleEmail' | 'lastSyncAt' | 'syncedFrom'>;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Comptes connectés. Une connexion d'avant le multi-comptes devient le compte n°1 (dressing principal). */
export function accountsOf(s: AccSettings): GoogleAccount[] {
  if (s.googleAccounts?.length) return s.googleAccounts;
  if (s.syncMode === 'google') return [{ email: s.googleEmail ?? '', shop: MAIN, lastSyncAt: s.lastSyncAt, syncedFrom: s.syncedFrom }];
  return [];
}

/** Ajoute un compte (ou met à jour son dressing s'il est déjà connecté). */
export async function registerAccount(email: string, shop?: string | null) {
  const s = (await loadDataset()).settings;
  let list = accountsOf(s);
  // l'ancienne connexion sans adresse connue prend l'adresse du compte qui se reconnecte
  if (list.length === 1 && !list[0].email) list = [{ ...list[0], email }];
  const valid = (x?: string | null) => (x && shopsOf(s).some((sh) => sh.id === x) ? x : null);
  const i = list.findIndex((a) => same(a.email, email));
  if (i >= 0) { if (valid(shop)) list[i] = { ...list[i], shop: valid(shop)! }; }
  else list = [...list, { email, shop: valid(shop) ?? MAIN, lastSyncAt: null, syncedFrom: null }];
  await saveSettings({ googleAccounts: list, syncMode: 'google', googleEmail: list[0].email || email });
  return list;
}

export async function updateAccount(email: string, patch: Partial<Omit<GoogleAccount, 'email'>>) {
  const s = (await loadDataset()).settings;
  const list = accountsOf(s).map((a) => (same(a.email, email) ? { ...a, ...patch } : a));
  await saveSettings({ googleAccounts: list });
}

/** Déconnecte un seul compte. Ses ventes déjà enregistrées sont conservées. */
export async function removeAccount(email: string, fetcher: typeof fetch = fetch) {
  const s = (await loadDataset()).settings;
  const list = accountsOf(s).filter((a) => !same(a.email, email));
  await signOut(email || null, fetcher);
  await saveSettings(list.length
    ? { googleAccounts: list, googleEmail: list[0].email }
    : { googleAccounts: [], syncMode: null, googleEmail: null });
}
