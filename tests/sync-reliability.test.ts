import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, getDb, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, saveSettings } from '../src/lib/actions';
import { _setSession } from '../src/lib/google/auth';
import { reparseUnrecognized, syncNow, FORMAT_INCONNU } from '../src/lib/vinted/sync';
import { setRetryDelays } from '../src/lib/vinted/errors';
import { announcesOperation, fingerprint, sinceLabel, syncHealth } from '../src/lib/vinted/reliability';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(), key: () => null, length: 0,
};
const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const msg = (id: string, date: string, subject: string, html: string) => ({
  id, internalDate: String(Date.parse(date)),
  payload: { mimeType: 'text/html', headers: [{ name: 'Subject', value: subject }], body: { data: b64url(html) } },
});
const saleHtml = (title: string, price: string) => `<h3>Bonjour clevinnng,</h3><p>lea_92 a acheté ${title} <b>${price}&nbsp;€</b></p><p>Nous transférerons le paiement sur ton porte-monnaie Vinted</p>`;
const SOLD = "Ton article s'est vendu !";

/** Faux Gmail dont chaque message peut échouer un certain nombre de fois (ou toujours). */
function fakeGmail() {
  const mails: ReturnType<typeof msg>[] = [];
  const failures = new Map<string, number>(); // id → échecs restants (Infinity : toujours)
  const gets: string[] = [];
  let listStatus = 200;
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  const fetcher = (async (url: string) => {
    const u = new URL(url);
    const p = u.pathname.replace('/gmail/v1/users/me', '');
    if (p === '/messages') return listStatus === 200 ? json({ messages: mails.map((m) => ({ id: m.id })) }) : json({}, listStatus);
    const id = p.replace('/messages/', '');
    gets.push(id);
    const left = failures.get(id) ?? 0;
    if (left > 0) { failures.set(id, left - 1); return json({ error: 'backend' }, 503); }
    return json(mails.find((m) => m.id === id));
  }) as unknown as typeof fetch;
  return { mails, failures, gets, fetcher, setList: (s: number) => { listStatus = s; } };
}

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`fiab-${++n}`));
  store.clear();
  setRetryDelays([0, 0]);
  _setSession({ token: 'JETON', expiresAt: Date.now() + 3_600_000, email: 'v@gmail.com' });
  await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, syncMode: 'google', syncSince: '2026-10-01', autoRecord: true });
});

describe('synchro fiable', () => {
  it('un e-mail reçu deux fois n’est compté qu’une fois ; deux ventes identiques à des heures différentes restent deux ventes', async () => {
    const g = fakeGmail();
    g.mails.push(msg('a', '2026-10-20T09:00:00Z', SOLD, saleHtml('Sweat Nike - Taille M', '25,00')));
    g.mails.push(msg('a-copie', '2026-10-20T09:00:30Z', SOLD, saleHtml('Sweat Nike - Taille M', '25,00')));
    g.mails.push(msg('b', '2026-10-20T15:42:00Z', SOLD, saleHtml('Sweat Nike - Taille M', '25,00')));
    await syncNow(g.fetcher, '2026-10-21');
    const ds = await loadDataset();
    expect(ds.sales).toHaveLength(2);
    const copy = await getDb().syncedEmails.get('a-copie');
    expect(copy!.status).toBe('ignored');
    expect(copy!.note).toMatch(/Doublon/);
  });

  it('format inconnu : signalé, gardé, puis relu quand les règles de lecture changent', async () => {
    const g = fakeGmail();
    g.mails.push(msg('x', '2026-10-20T09:00:00Z', SOLD, '<p>Nouveau modèle : ta vente « Veste » est confirmée, montant 40 euros</p>'));
    const r = await syncNow(g.fetcher, '2026-10-21');
    expect(r.unrecognized).toBe(1);
    const row = (await getDb().syncedEmails.get('x'))!;
    expect(row.note).toBe(FORMAT_INCONNU);
    expect(row.raw?.subject).toBe(SOLD);
    // simulation d'une mise à jour : l'e-mail est désormais lisible
    await getDb().syncedEmails.update('x', { parser: 0, raw: { ...row.raw!, text: 'Bonjour clevinnng, lea a acheté Veste en jean - Taille L 40,00 € Nous transférerons le paiement' } });
    expect(await reparseUnrecognized()).toBe(1);
    await syncNow(g.fetcher, '2026-10-21');
    expect((await loadDataset()).sales[0].sellerRevenue).toBe(4000);
    expect((await getDb().syncedEmails.get('x'))!.unrecognized).toBe(false);
  });

  it('coupure passagère : la lecture est retentée automatiquement', async () => {
    const g = fakeGmail();
    g.mails.push(msg('a', '2026-10-20T09:00:00Z', SOLD, saleHtml('Jean Levi’s 501', '30,00')));
    g.failures.set('a', 2);
    const r = await syncNow(g.fetcher, '2026-10-21');
    expect(r.failed).toBe(0);
    expect(g.gets.filter((x) => x === 'a')).toHaveLength(3);
    expect((await loadDataset()).sales).toHaveLength(1);
  });

  it('interruption : ce qui a été lu est gardé, la synchro suivante reprend sans tout relire', async () => {
    const g = fakeGmail();
    for (let i = 0; i < 6; i++) g.mails.push(msg(`m${i}`, `2026-10-1${i}T09:00:00Z`, SOLD, saleHtml(`Article numéro ${i} unique`, `1${i},00`)));
    g.failures.set('m4', Infinity);
    const r1 = await syncNow(g.fetcher, '2026-10-21');
    expect(r1.failed).toBe(1);
    let s = (await loadDataset()).settings;
    expect(s.lastSyncAt).toBeNull();
    expect(s.syncLog[0]).toMatchObject({ ok: true, partial: true });
    expect((await loadDataset()).sales).toHaveLength(5);
    // réseau rétabli : seul l'e-mail manquant est téléchargé
    g.failures.delete('m4');
    g.gets.length = 0;
    const r2 = await syncNow(g.fetcher, '2026-10-21');
    expect(g.gets).toEqual(['m4']);
    expect(r2.failed).toBe(0);
    s = (await loadDataset()).settings;
    expect(s.lastSyncAt).not.toBeNull();
    expect((await loadDataset()).sales).toHaveLength(6);
  });

  it('échec de connexion : inscrit dans l’historique, avec le message à afficher', async () => {
    const g = fakeGmail();
    g.setList(500);
    await expect(syncNow(g.fetcher, '2026-10-21')).rejects.toThrow(/momentanément indisponible/);
    const s = (await loadDataset()).settings;
    expect(s.syncLog[0].ok).toBe(false);
    const h = syncHealth(s);
    expect(h.failing).toBe(true);
    expect(h.stale).toBe(true);
    expect(h.lastError).toMatch(/indisponible/);
  });

  it('montant inhabituel : mis de côté pour vérification au lieu d’être enregistré', async () => {
    const g = fakeGmail();
    g.mails.push(msg('a', '2026-10-20T09:00:00Z', SOLD, saleHtml('Montre', '4 500,00')));
    await syncNow(g.fetcher, '2026-10-21');
    expect((await loadDataset()).sales).toHaveLength(0);
    expect((await getDb().syncedEmails.get('a'))!.status).toBe('inbox');
  });

  it('outils : empreinte, opérations annoncées, libellés de date', () => {
    const e = { subject: SOLD, date: '2026-10-20T09:00:12Z', text: 'abc' };
    expect(fingerprint(e)).toBe(fingerprint({ ...e, date: '2026-10-20T09:00:59Z' }));
    expect(fingerprint(e)).not.toBe(fingerprint({ ...e, date: '2026-10-20T09:01:00Z' }));
    expect(announcesOperation('La transaction est finalisée')).toBe(true);
    expect(announcesOperation('Nouveau message de lea')).toBe(false);
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(sinceLabel('2026-10-21T11:55:00Z', now)).toBe('il y a 5 min');
    expect(sinceLabel('2026-10-21T09:00:00Z', now)).toBe('il y a 3 h');
  });
});
