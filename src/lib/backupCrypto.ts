/**
 * Sauvegardes Google Drive chiffrées avec un mot de passe (AES-GCM 256 bits, clé dérivée par
 * PBKDF2-SHA-256, 310 000 itérations). Sans le mot de passe, le fichier du Drive est illisible.
 *
 * Le mot de passe n'est jamais gardé : seule la clé dérivée reste sur ce téléphone (pour les
 * sauvegardes automatiques), et elle n'est jamais copiée dans les sauvegardes elles-mêmes.
 */
export const ENVELOPE = 'cng-vinted/chiffre-v1';
const ITERATIONS = 310_000;

export interface Envelope { format: typeof ENVELOPE; sel: string; iv: string; donnees: string }

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const isEnvelope = (x: unknown): x is Envelope => !!x && typeof x === 'object' && (x as Envelope).format === ENVELOPE;

/** Clé (en base64) dérivée du mot de passe et d'un sel. */
export async function deriveKey(password: string, salt: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: ITERATIONS }, base, 256);
  return b64(bits);
}

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

const aes = (key: string) => crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function encryptText(text: string, key: string, salt: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(key), enc.encode(text));
  return { format: ENVELOPE, sel: salt, iv: b64(iv), donnees: b64(data) };
}

/** Déchiffre avec la clé ; erreur claire si le mot de passe (donc la clé) ne correspond pas. */
export async function decryptText(env: Envelope, key: string): Promise<string> {
  try {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await aes(key), unb64(env.donnees));
    return dec.decode(data);
  } catch {
    throw new Error('Mot de passe incorrect : impossible d’ouvrir cette sauvegarde.');
  }
}

export const MIN_PASSWORD = 8;
