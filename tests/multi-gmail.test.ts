import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, getDb, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, saveSettings } from '../src/lib/actions';
import { _setSessions, getSession, getSessions, putSession, resolvePendingAccount } from '../src/lib/google/auth';
import { accountsOf, registerAccount, removeAccount, updateAccount } from '../src/lib/google/accounts';
import { addShop, deleteShop } from '../src/lib/shopActions';
import { syncNow } from '../src/lib/vinted/sync';
import { setRetryDelays } from '../src/lib/vinted/errors';
import { buildLabelsPdf } from '../src/lib/vinted/labels';
import { scopeDataset } from '../src/lib/shops';
import { PDFDocument } from 'pdf-lib';

const store = new Map<string, string>();
const mem = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k),
  clear: () => m.clear(), key: () => null, length: 0,
}) as unknown as Storage;
(globalThis as unknown as { localStorage: Storage }).localStorage = mem(store);
const session = new Map<string, string>();
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = mem(session);

const b64url = (s: string | Uint8Array) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const msg = (id: string, date: string, subject: string, html: string, pdf?: Uint8Array) => ({
  id, internalDate: String(Date.parse(date)), _pdf: pdf,
  payload: pdf
    ? { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: subject }], parts: [{ mimeType: 'text/html', body: { data: b64url(html) } }, { mimeType: 'application/pdf', filename: 'b.pdf', body: { attachmentId: 'att-' + id } }] }
    : { mimeType: 'text/html', headers: [{ name: 'Subject', value: subject }], body: { data: b64url(html) } },
});
const sold = (who: string, title: string, price: string) => `<h3>Bonjour ${who},</h3><p>lea a acheté ${title} <b>${price}&nbsp;€</b></p><p>Nous transférerons le paiement</p>`;
const SOLD = "Ton article s'est vendu !";

/** Deux boîtes Gmail, chacune avec son jeton ; un jeton peut être expiré. */
function fakeGoogle() {
  const boxes: Record<string, ReturnType<typeof msg>[]> = { TA: [], TB: [] };
  const used: { token: string; path: string }[] = [];
  const expired = new Set<string>();
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  const fetcher = (async (url: string, init?: RequestInit) => {
    const token = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '').replace('Bearer ', '');
    const u = new URL(url);
    if (u.host === 'www.googleapis.com' && u.pathname === '/oauth2/v3/userinfo') return json({ email: token === 'TA' ? 'vendeur.a@gmail.com' : 'vendeur.b@gmail.com' });
    if (!boxes[token] || expired.has(token)) return json({}, 401);
    const p = u.pathname.replace('/gmail/v1/users/me', '');
    used.push({ token, path: p });
    if (p === '/messages') return json({ messages: boxes[token].map((m) => ({ id: m.id })) });
    const att = p.match(/^\/messages\/([^/]+)\/attachments\/(.+)$/);
    if (att) return json({ data: b64url(boxes[token].find((m) => m.id === att[1])!._pdf!) });
    const one = boxes[token].find((m) => p === `/messages/${m.id}`);
    return one ? json(one) : json({}, 404);
  }) as unknown as typeof fetch;
  return { boxes, used, expired, fetcher };
}

const live = (token: string, email: string | null) => ({ token, expiresAt: Date.now() + 3_600_000, email });
let n = 0;
let shop2 = '';
beforeEach(async () => {
  setDb(new VPDatabase(`multi-${++n}`));
  store.clear(); session.clear();
  setRetryDelays([0, 0]);
  await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, syncSince: '2026-10-01', autoRecord: true });
  shop2 = await addShop('Dressing 2', 'autre.pseudo');
});

describe('plusieurs comptes Gmail', () => {
  it('l’ancienne connexion (un seul compte) est reprise telle quelle', async () => {
    store.set('cng-google', JSON.stringify(live('TA', 'vendeur.a@gmail.com')));
    await saveSettings({ syncMode: 'google', googleEmail: 'vendeur.a@gmail.com', lastSyncAt: '2026-10-20T10:00:00Z', syncedFrom: '2026-10-01' });
    expect(getSession('vendeur.a@gmail.com')?.token).toBe('TA');
    const s = (await loadDataset()).settings;
    expect(accountsOf(s)).toEqual([{ email: 'vendeur.a@gmail.com', shop: 'main', lastSyncAt: '2026-10-20T10:00:00Z', syncedFrom: '2026-10-01' }]);
    // ajout d'un 2e compte : le premier est gardé, avec son point de reprise
    putSession(live('TB', 'vendeur.b@gmail.com'));
    await registerAccount('vendeur.b@gmail.com', shop2);
    expect(getSessions().map((x) => x.token)).toEqual(['TA', 'TB']);
    const acc = accountsOf((await loadDataset()).settings);
    expect(acc.map((a) => [a.email, a.shop, a.syncedFrom])).toEqual([['vendeur.a@gmail.com', 'main', '2026-10-01'], ['vendeur.b@gmail.com', shop2, null]]);
  });

  it('le retour de Google ajoute le compte sans remplacer l’autre ; même adresse : jeton remplacé', async () => {
    const g = fakeGoogle();
    _setSessions([live('TA', 'vendeur.a@gmail.com')]);
    session.set('cng-google-attente', JSON.stringify({ token: 'TB', expiresAt: Date.now() + 3_600_000 }));
    expect(await resolvePendingAccount(g.fetcher)).toBe('vendeur.b@gmail.com');
    expect(getSessions().map((x) => x.email)).toEqual(['vendeur.a@gmail.com', 'vendeur.b@gmail.com']);
    session.set('cng-google-attente', JSON.stringify({ token: 'TA', expiresAt: Date.now() + 7_200_000 }));
    await resolvePendingAccount(g.fetcher);
    expect(getSessions()).toHaveLength(2);
  });

  it('chaque compte est synchronisé à part et range ses ventes dans son dressing', async () => {
    const g = fakeGoogle();
    _setSessions([live('TA', 'vendeur.a@gmail.com'), live('TB', 'vendeur.b@gmail.com')]);
    await registerAccount('vendeur.a@gmail.com');
    await registerAccount('vendeur.b@gmail.com', shop2);
    g.boxes.TA.push(msg('a1', '2026-10-20T09:00:00Z', SOLD, sold('vendeura', 'Sweat Nike - Taille M', '25,00')));
    g.boxes.TB.push(msg('b1', '2026-10-21T09:00:00Z', SOLD, sold('vendeurb', 'Jean Levi’s 501 - Taille 32', '30,00')));
    // pseudo d'un autre dressing reconnu dans un e-mail du compte A : le pseudo l'emporte
    g.boxes.TA.push(msg('a2', '2026-10-22T09:00:00Z', SOLD, sold('autre.pseudo', 'Casquette New Era', '12,00')));
    await syncNow(g.fetcher, '2026-10-23');
    const ds = await loadDataset();
    const main = scopeDataset(ds, 'main');
    const two = scopeDataset(ds, shop2);
    expect(main.sales.map((s) => s.sellerRevenue)).toEqual([2500]);
    expect(two.sales.map((s) => s.sellerRevenue).sort()).toEqual([1200, 3000]);
    expect(ds.sales).toHaveLength(3); // total cumulé
    expect((await getDb().syncedEmails.get('b1'))!.account).toBe('vendeur.b@gmail.com');
    expect(ds.settings.googleAccounts.every((a) => a.lastSyncAt && a.syncedFrom === '2026-10-01')).toBe(true);
  });

  it('un compte en panne n’empêche pas l’autre ; relancer un seul compte ; déconnecter un seul compte', async () => {
    const g = fakeGoogle();
    _setSessions([live('TA', 'vendeur.a@gmail.com'), live('TB', 'vendeur.b@gmail.com')]);
    await registerAccount('vendeur.a@gmail.com');
    await registerAccount('vendeur.b@gmail.com', shop2);
    g.boxes.TA.push(msg('a1', '2026-10-20T09:00:00Z', SOLD, sold('x', 'Sweat Nike', '25,00')));
    g.boxes.TB.push(msg('b1', '2026-10-21T09:00:00Z', SOLD, sold('y', 'Jean Levi’s', '30,00')));
    g.expired.add('TB');
    const r = await syncNow(g.fetcher, '2026-10-23');
    expect(r.accountErrors?.map((e) => e.email)).toEqual(['vendeur.b@gmail.com']);
    let ds = await loadDataset();
    expect(ds.sales).toHaveLength(1);
    expect(ds.settings.syncLog[0]).toMatchObject({ ok: true, partial: true });
    expect(ds.settings.googleAccounts.find((a) => a.email === 'vendeur.b@gmail.com')!.lastSyncAt).toBeNull();
    // reconnexion du compte B, puis synchro de ce seul compte
    g.expired.delete('TB');
    g.used.length = 0;
    await syncNow(g.fetcher, '2026-10-23', 'vendeur.b@gmail.com');
    expect(new Set(g.used.map((u) => u.token))).toEqual(new Set(['TB']));
    ds = await loadDataset();
    expect(ds.sales).toHaveLength(2);
    // déconnexion du compte A seulement
    await removeAccount('vendeur.a@gmail.com', g.fetcher);
    ds = await loadDataset();
    expect(accountsOf(ds.settings).map((a) => a.email)).toEqual(['vendeur.b@gmail.com']);
    expect(ds.settings.syncMode).toBe('google');
    expect(getSessions().map((s) => s.token)).toEqual(['TB']);
    expect(ds.sales).toHaveLength(2); // ventes conservées
    // dernier compte déconnecté : synchro Google désactivée
    await removeAccount('vendeur.b@gmail.com', g.fetcher);
    expect((await loadDataset()).settings.syncMode).toBeNull();
  });

  it('le même e-mail reçu sur les deux boîtes n’est compté qu’une fois', async () => {
    const g = fakeGoogle();
    _setSessions([live('TA', 'vendeur.a@gmail.com'), live('TB', 'vendeur.b@gmail.com')]);
    await registerAccount('vendeur.a@gmail.com');
    await registerAccount('vendeur.b@gmail.com', shop2);
    g.boxes.TA.push(msg('a1', '2026-10-20T09:00:00Z', SOLD, sold('x', 'Robe noire', '42,00')));
    g.boxes.TB.push(msg('b9', '2026-10-20T09:00:10Z', SOLD, sold('x', 'Robe noire', '42,00')));
    await syncNow(g.fetcher, '2026-10-23');
    expect((await loadDataset()).sales).toHaveLength(1);
  });

  it('chaque bordereau est téléchargé avec le compte qui l’a reçu ; supprimer un dressing rattache son compte au principal', async () => {
    const g = fakeGoogle();
    _setSessions([live('TA', 'vendeur.a@gmail.com'), live('TB', 'vendeur.b@gmail.com')]);
    await registerAccount('vendeur.a@gmail.com');
    await registerAccount('vendeur.b@gmail.com', shop2);
    const doc = await PDFDocument.create(); doc.addPage([595, 842]); const pdf = await doc.save();
    const subj = "Bordereau d'envoi Vinted - à utiliser avant le 31/10/2026 12 h 00 pour Robe - Taille S";
    g.boxes.TB.push(msg('lb', '2026-10-26T09:00:00Z', subj, '<p>Ton bordereau</p>', pdf));
    await syncNow(g.fetcher, '2026-10-27');
    g.used.length = 0;
    const out = await buildLabelsPdf(['lb'], 'a4', g.fetcher);
    expect(out.printedIds).toEqual(['lb']);
    expect(g.used.every((u) => u.token === 'TB')).toBe(true);
    await updateAccount('vendeur.b@gmail.com', { shop: shop2 });
    await deleteShop(shop2);
    expect(accountsOf((await loadDataset()).settings).find((a) => a.email === 'vendeur.b@gmail.com')!.shop).toBe('main');
  });
});
