/**
 * Accès à la bêta : réservé aux testeurs invités, avec un code personnel (« CNG-XXXXX-XXXXX »).
 *
 * Seules les empreintes SHA-256 des codes sont dans le code (public) de l'appli : on ne peut pas
 * retrouver un code à partir d'ici. Retirer une empreinte de la liste ferme l'accès à ce testeur
 * à sa prochaine ouverture de l'appli. L'appli étant un site statique, c'est une porte d'entrée
 * (pas un coffre-fort) : elle évite qu'un lien partagé ouvre la bêta à n'importe qui.
 */
export const ACCESS: Record<string, string> = {
  'd04f79ad16a3ea90ca066b963e3a997f3e24454ebed5b1026c2a67517479cdf3': 'Admin',
  '27fb7aee0c4dac5ee75ae60e0d02117ce4c8e095d419539ad5565db1b969b995': 'Testeur 01',
  'ecc90f6eebe3c1484cb34333d6000fb61988be9fed277a5a1515047c7b793cae': 'Testeur 02',
  'cc92b15e482e3e55a17773861488eba6b0786318fea5cfce31805e80da4d7a4c': 'Testeur 03',
  'f6b884ad42c5e0b372411b31e5ae86a61064d4ab9e72ee3fa40338dda0523eef': 'Testeur 04',
  'f119b769e0837364c86e6fff52e969b603e0d15d28e61e2d2dc1b64b06aa74f8': 'Testeur 05',
  '5b36256407e87682ac37a4118599155d44cf422df0ecd7c54f6d4c0ee2ad1e32': 'Testeur 06',
  '9a2160687e44c5e4cf2605dbbccfc0f6dec6ef120ce83b1e5dda0a3847a176bc': 'Testeur 07',
  '409c8ae616fa895d6d3316547cda0764c8e415e89139cbcc19dd577936f1102b': 'Testeur 08',
  '4d1330631ad915012d68ef72f69b0afa491d147b762ce1582bbed292544957a7': 'Testeur 09',
  'd5ad77cd26ca9976ae497f57a0d09bb160104b4183acda34d3879951cd1c51db': 'Testeur 10',
  '491deefd5ebae48b928834c4e6b5ef23431681929991b76030d6ade6fc837a89': 'Testeur 11',
  '174a850cec12f9ccd92c2dea81b857ba9a8fb2035cee497e3c4a822d21af5504': 'Testeur 12',
  '938c71581e20cc54f88cc64cf1fc7c0a757c7de5e6a043ce0147e89ce084a297': 'Testeur 13',
  '82089db775c288363a4bdb639c3f92c955acb51f27a8cce1f6384e3ada62c8c4': 'Testeur 14',
  'e800d2d08aad320d95de52329b525b90644e49a83bf35afae335a44b4e9e2fce': 'Testeur 15',
  'f4fca33fac11fe5f13aec607e782c924de87c46a90c3bd0c4c336fe1de1f2cca': 'Testeur 16',
  '70abfae1376fd741bd1ce9e43467cd6a91ea70ee6ccc726cca32b2998ea9e837': 'Testeur 17',
  '7e0827bd5227a1677f5270f77ae5365dde4f9dda9c9e18b26c214c18310598f1': 'Testeur 18',
  '372d6503cd48679360635bf006f102074171b6b2a6d92f0bbd65b064fa5a7eda': 'Testeur 19',
  '5ea005148f2de0171dcc493b7ce4e8b169daee24e736bb720154f010c3f4f175': 'Testeur 20',
};

const KEY = 'cng-beta-access';

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^CNG/, 'CNG');

export async function codeHash(code: string) {
  const data = new TextEncoder().encode('cng-beta:' + normalizeCode(code));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Nom du testeur si le code est valide, sinon null. */
export async function checkCode(code: string, list: Record<string, string> = ACCESS): Promise<{ hash: string; tester: string } | null> {
  const n = normalizeCode(code);
  if (n.length !== 13) return null; // CNG + 10 caractères
  const hash = await codeHash(n);
  return list[hash] ? { hash, tester: list[hash] } : null;
}

/** Accès déjà ouvert sur cet appareil (et toujours valide). */
export function storedAccess(list: Record<string, string> = ACCESS): { hash: string; tester: string } | null {
  try {
    const h = localStorage.getItem(KEY);
    return h && list[h] ? { hash: h, tester: list[h] } : null;
  } catch {
    return null;
  }
}

export const ADMIN = 'Admin';
const VIEW_KEY = 'cng-beta-view-as-tester';

/** Accès admin : toutes les fonctions ouvertes, sauf si l'admin choisit de voir l'appli comme un testeur. */
export const isAdmin = (list: Record<string, string> = ACCESS) => storedAccess(list)?.tester === ADMIN;
export function viewAsTester() {
  try { return localStorage.getItem(VIEW_KEY) === '1'; } catch { return false; }
}
export function setViewAsTester(on: boolean) {
  try { if (on) localStorage.setItem(VIEW_KEY, '1'); else localStorage.removeItem(VIEW_KEY); } catch { /* ignore */ }
}

export function storeAccess(hash: string) {
  try { localStorage.setItem(KEY, hash); } catch { /* navigation privée : il faudra ressaisir le code */ }
}
