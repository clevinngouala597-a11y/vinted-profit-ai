/**
 * Connexion Google sans serveur ni script externe : redirection vers Google, puis retour dans l'appli
 * avec un jeton d'accès valable une heure (flux OAuth « token », adapté aux applis installées sur iPhone).
 *
 * Plusieurs comptes Gmail peuvent être connectés en même temps (un par compte Vinted / dressing) :
 * chaque compte a son propre jeton, rangé sous son adresse. Les jetons restent sur l'appareil (stockage
 * local) ; ils ne sont jamais copiés dans les sauvegardes. Quand un jeton expire, une reconnexion
 * silencieuse (sans écran Google si la session est ouverte) le renouvelle, compte par compte.
 */
import { BETA } from '../beta';
import { GOOGLE_CLIENT_ID, SCOPES } from './config';

/** Ancienne clé (un seul compte) : reprise automatiquement. */
const LEGACY_KEY = BETA ? 'cng-beta-google' : 'cng-google';
const KEY = LEGACY_KEY + '-comptes';
const STATE_KEY = LEGACY_KEY + '-state';
const SILENT_KEY = LEGACY_KEY + '-silent';

export interface GoogleSession { token: string; expiresAt: number; email: string | null }

export const googleReady = () => !!GOOGLE_CLIENT_ID;

const sameEmail = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Tous les comptes connectés sur cet appareil (le premier est le compte principal). */
export function getSessions(): GoogleSession[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? 'null') as GoogleSession[] | null;
    if (Array.isArray(list)) return list.filter((s) => s && s.token);
    // reprise de l'ancienne connexion (un seul compte)
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null') as GoogleSession | null;
    return old && old.token ? [old] : [];
  } catch {
    return [];
  }
}

function saveAll(list: GoogleSession[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* navigation privée */ }
}

/**
 * Jeton d'un compte (par adresse). Sans adresse : le compte principal.
 * Une connexion d'avant le multi-comptes dont l'adresse n'est pas encore connue sert de compte unique.
 */
export function getSession(email?: string | null): GoogleSession | null {
  const list = getSessions();
  if (!email) return list[0] ?? null;
  return list.find((s) => sameEmail(s.email, email)) ?? (list.length === 1 && !list[0].email ? list[0] : null);
}

/** Ajoute ou remplace la connexion d'un compte (même adresse : le jeton est remplacé, pas dupliqué). */
export function putSession(s: GoogleSession) {
  const list = getSessions();
  const i = s.email ? list.findIndex((x) => sameEmail(x.email, s.email)) : list.findIndex((x) => !x.email);
  if (i >= 0) list[i] = s; else list.push(s);
  saveAll(list);
}

/** Jeton encore valable (avec une marge d'une minute) ? */
export const tokenValid = (s: GoogleSession | null, now = Date.now()) => !!s && s.expiresAt - 60_000 > now;

const redirectUri = () => `${location.origin}${import.meta.env.BASE_URL}`;

export interface LoginOptions {
  /** sans écran si l'utilisateur est déjà connecté et a déjà accepté */
  silent?: boolean;
  /** compte attendu (reconnexion) */
  hint?: string | null;
  /** ajout d'un autre compte : Google propose de choisir le compte */
  add?: boolean;
  /** dressing auquel rattacher le compte ajouté */
  shop?: string;
}

/** Part chez Google. */
export function startGoogleLogin(opts: LoginOptions = {}) {
  if (!GOOGLE_CLIENT_ID) throw new Error('La connexion Google n’est pas encore activée sur cette version.');
  const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
  // l'écran où revenir après la connexion, et ce qu'il faut faire du compte
  sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, back: location.hash || '#/', add: !!opts.add, shop: opts.shop ?? null, hint: opts.hint ?? null }));
  if (opts.silent) sessionStorage.setItem(SILENT_KEY, String(Date.now()));
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPES.join(' '),
    include_granted_scopes: 'true',
    state,
    ...(opts.silent ? { prompt: 'none' } : opts.add ? { prompt: 'select_account' } : {}),
    ...(opts.hint ? { login_hint: opts.hint } : {}),
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

export type RedirectResult =
  | { ok: true; silent: boolean; add: boolean; shop: string | null; hint: string | null }
  | { ok: false; error: string; silent: boolean }
  | null;

/**
 * À appeler au démarrage, avant le routeur : lit la réponse de Google dans l'adresse
 * (#access_token=…), l'enregistre (adresse du compte à confirmer avec `resolvePendingAccount`),
 * puis remet l'écran d'avant.
 */
export function handleGoogleRedirect(): RedirectResult {
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  let saved: { state: string; back: string; add?: boolean; shop?: string | null; hint?: string | null } | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? 'null'); } catch { /* */ }
  sessionStorage.removeItem(STATE_KEY);
  const silent = !!sessionStorage.getItem(SILENT_KEY);
  sessionStorage.removeItem(SILENT_KEY);
  history.replaceState(null, '', `${location.pathname}${saved?.back ?? '#/'}`);
  if (!saved || p.get('state') !== saved.state) return { ok: false, error: 'Réponse de Google inattendue : réessaie.', silent };
  if (p.get('error')) return { ok: false, error: p.get('error') === 'access_denied' ? 'Connexion annulée.' : `Google a refusé la connexion (${p.get('error')}).`, silent };
  const granted = (p.get('scope') ?? '').split(' ');
  if (!granted.includes('https://www.googleapis.com/auth/gmail.readonly'))
    return { ok: false, error: 'Coche bien l’accès à Gmail sur l’écran Google : sans lui, l’appli ne peut pas lire tes e-mails Vinted.', silent };
  // jeton en attente : son adresse est vérifiée juste après (resolvePendingAccount)
  try {
    sessionStorage.setItem(LEGACY_KEY + '-attente', JSON.stringify({ token: p.get('access_token')!, expiresAt: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000 }));
  } catch { /* */ }
  return { ok: true, silent, add: !!saved.add, shop: saved.shop ?? null, hint: saved.hint ?? null };
}

/**
 * Adresse du jeton reçu de Google, puis rangement sous ce compte (le jeton d'un compte déjà connecté
 * est remplacé ; un nouveau compte est ajouté sans toucher aux autres). Renvoie l'adresse.
 */
export async function resolvePendingAccount(fetcher: typeof fetch = fetch): Promise<string | null> {
  let pending: { token: string; expiresAt: number } | null = null;
  try { pending = JSON.parse(sessionStorage.getItem(LEGACY_KEY + '-attente') ?? 'null'); } catch { /* */ }
  if (!pending) return null;
  sessionStorage.removeItem(LEGACY_KEY + '-attente');
  const email = await fetchEmail(pending.token, fetcher);
  putSession({ ...pending, email });
  return email;
}

async function fetchEmail(token: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const r = await fetcher('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    const j = (await r.json()) as { email?: string };
    return j.email ?? null;
  } catch {
    return null;
  }
}

/** Adresse du compte principal (connexions d'avant le multi-comptes). */
export async function loadEmail(fetcher: typeof fetch = fetch) {
  const s = getSession();
  if (!s) return null;
  if (s.email) return s.email;
  const email = await fetchEmail(s.token, fetcher);
  if (email) {
    const list = getSessions().map((x) => (x === s || (x.token === s.token) ? { ...x, email } : x));
    saveAll(list);
  }
  return email;
}

/** Déconnecte un compte (les autres restent connectés) ; sans adresse : tous les comptes. */
export async function signOut(email?: string | null, fetcher: typeof fetch = fetch) {
  const list = getSessions();
  const gone = email ? list.filter((s) => sameEmail(s.email, email) || (!s.email && list.length === 1)) : list;
  saveAll(list.filter((s) => !gone.includes(s)));
  for (const s of gone) await fetcher(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.token)}`, { method: 'POST' }).catch(() => {});
}

/** Pour les tests : un seul compte (ou aucun). */
export const _setSession = (s: GoogleSession | null) => saveAll(s ? [s] : []);
/** Pour les tests : plusieurs comptes. */
export const _setSessions = (list: GoogleSession[]) => saveAll(list);
