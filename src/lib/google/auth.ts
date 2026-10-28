/**
 * Connexion Google sans serveur ni script externe : redirection vers Google, puis retour dans l'appli
 * avec un jeton d'accès valable une heure (flux OAuth « token », adapté aux applis installées sur iPhone).
 *
 * Le jeton reste sur l'appareil (stockage local) ; il n'est jamais copié dans les sauvegardes.
 * Quand il expire, une reconnexion silencieuse (sans écran Google si la session est ouverte) le renouvelle.
 */
import { BETA } from '../beta';
import { GOOGLE_CLIENT_ID, SCOPES } from './config';

const KEY = BETA ? 'cng-beta-google' : 'cng-google';
const STATE_KEY = KEY + '-state';
const SILENT_KEY = KEY + '-silent';

export interface GoogleSession { token: string; expiresAt: number; email: string | null }

export const googleReady = () => !!GOOGLE_CLIENT_ID;

export function getSession(): GoogleSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as GoogleSession | null;
    return s && s.token ? s : null;
  } catch {
    return null;
  }
}
const save = (s: GoogleSession | null) => {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* navigation privée */ }
};

/** Jeton encore valable (avec une marge d'une minute) ? */
export const tokenValid = (s: GoogleSession | null, now = Date.now()) => !!s && s.expiresAt - 60_000 > now;

const redirectUri = () => `${location.origin}${import.meta.env.BASE_URL}`;

/** Part chez Google. `silent` : sans écran si l'utilisateur est déjà connecté et a déjà accepté. */
export function startGoogleLogin(opts: { silent?: boolean; hint?: string | null } = {}) {
  if (!GOOGLE_CLIENT_ID) throw new Error('La connexion Google n’est pas encore activée sur cette version.');
  const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
  // l'écran où revenir après la connexion
  sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, back: location.hash || '#/' }));
  if (opts.silent) sessionStorage.setItem(SILENT_KEY, String(Date.now()));
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPES.join(' '),
    include_granted_scopes: 'true',
    state,
    ...(opts.silent ? { prompt: 'none' } : {}),
    ...(opts.hint ? { login_hint: opts.hint } : {}),
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

export type RedirectResult = { ok: true } | { ok: false; error: string; silent: boolean } | null;

/**
 * À appeler au démarrage, avant le routeur : lit la réponse de Google dans l'adresse
 * (#access_token=…), l'enregistre, puis remet l'écran d'avant.
 */
export function handleGoogleRedirect(): RedirectResult {
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  let saved: { state: string; back: string } | null = null;
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
  const prev = getSession();
  save({ token: p.get('access_token')!, expiresAt: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000, email: prev?.email ?? null });
  return { ok: true };
}

/** Adresse du compte connecté (affichée dans l'appli). */
export async function loadEmail(fetcher: typeof fetch = fetch) {
  const s = getSession();
  if (!s) return null;
  try {
    const r = await fetcher('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${s.token}` } });
    const j = (await r.json()) as { email?: string };
    if (j.email) save({ ...s, email: j.email });
    return j.email ?? null;
  } catch {
    return null;
  }
}

export async function signOut(fetcher: typeof fetch = fetch) {
  const s = getSession();
  save(null);
  if (s) await fetcher(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.token)}`, { method: 'POST' }).catch(() => {});
}

/** Pour les tests. */
export const _setSession = save;
