/**
 * Verrouillage de l'appli : Face ID / Touch ID (clé d'accès WebAuthn de l'iPhone) + code de secours.
 *
 * C'est un verrou d'écran, comme celui d'une appli bancaire : il empêche quelqu'un qui prend ton
 * téléphone déverrouillé de voir tes chiffres. La clé d'accès ne quitte jamais l'iPhone ; l'appli
 * ne garde que son identifiant, et une empreinte du code de secours (jamais le code lui-même).
 */

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const PIN_RE = /^\d{4,6}$/;

export async function pinHash(pin: string) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode('cng-lock:' + pin));
  return b64url(buf);
}

export async function checkPin(pin: string, hash: string | null) {
  return !!hash && PIN_RE.test(pin) && (await pinHash(pin)) === hash;
}

/** Face ID / Touch ID disponible pour cette appli ? */
export async function biometricAvailable(): Promise<boolean> {
  try {
    const P = (window as { PublicKeyCredential?: typeof PublicKeyCredential }).PublicKeyCredential;
    return !!P && (await P.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** Crée la clé d'accès « Verrou CNG Vinted » (demande Face ID). Renvoie son identifiant. */
export async function registerBiometric(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'CNG Vinted' },
      user: { id: random(16), name: 'Verrou CNG Vinted', displayName: 'Verrou CNG Vinted' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Face ID n’a pas été activé.');
  return b64url(cred.rawId);
}

/** Demande Face ID. Vrai seulement si l'iPhone a bien vérifié la personne. */
export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    const res = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!res) return false;
    const data = new Uint8Array((res.response as AuthenticatorAssertionResponse).authenticatorData);
    return (data[32] & 0x04) !== 0; // drapeau « utilisateur vérifié » (Face ID réussi)
  } catch {
    return false;
  }
}

/** Faut-il reverrouiller au retour dans l'appli ? */
export const shouldRelock = (hiddenAt: number | null, now: number, delayMin: number) =>
  hiddenAt !== null && now - hiddenAt >= delayMin * 60_000;
