import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, saveSettings } from '../src/lib/actions';
import { _setSession, tokenValid } from '../src/lib/google/auth';
import { fetchGmailVinted, GoogleAuthNeeded, htmlToText, messageToRaw } from '../src/lib/google/gmail';
import { syncNow } from '../src/lib/vinted/sync';
import { driveBackup, driveRestore } from '../src/lib/vinted/drive';
import { buildLabelsPdf } from '../src/lib/vinted/labels';
import { extractPseudo } from '../src/lib/shops';
import { PDFDocument } from 'pdf-lib';

// localStorage minimal (le jeton Google y est gardé)
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(), key: () => null, length: 0,
};

const b64url = (s: string | Uint8Array) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** E-mail Vinted au format de l'API Gmail : HTML seul, comme les vrais. */
const gmailMsg = (id: string, date: string, subject: string, html: string, pdf?: Uint8Array) => ({
  id, internalDate: String(Date.parse(date)),
  payload: pdf
    ? { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: subject }], parts: [
        { mimeType: 'text/html', body: { data: b64url(html) } },
        { mimeType: 'application/pdf', filename: 'Bordereau.pdf', body: { attachmentId: 'att-' + id } }] }
    : { mimeType: 'text/html', headers: [{ name: 'Subject', value: subject }], body: { data: b64url(html) } },
  _pdf: pdf,
});
const saleHtml = (who: string, title: string, price: string) => `<html><head><style>.x{}</style></head><body><img alt=""/><table><tr><td><h3>Bonjour ${who},</h3><p>acheteuse_7 a acheté ${title} <strong>${price}&nbsp;€</strong></p><p>Nous transférerons le paiement sur ton porte-monnaie Vinted dès que l'acheteur aura confirmé la réception.</p><a href="https://links.vinted.com/t/x">Voir</a></td></tr></table></body></html>`;
const doneHtml = (who: string, title: string, amount: string) => `<html><body><h3>${who},</h3><h4>Cette transaction est finalisée.</h4><h4><span>La vente de ${title} a été réalisée avec succès.</span></h4><p>N° de Transaction : #2309855612<br/>Date : 25/10/2026</p><table><tr><td>Montant de la commande :</td><td>${amount}&nbsp;€</td></tr></table><table><tr><td><strong>Viré sur ton compte Vinted :</strong></td><td><strong>${amount}&nbsp;€</strong></td></tr></table></body></html>`;

/** Faux Google : Gmail (liste, messages, pièces jointes) et Drive (fichiers de l'appli). */
function fakeGoogle() {
  const mails: ReturnType<typeof gmailMsg>[] = [];
  const drive: { id: string; name: string; content: string }[] = [];
  const queries: string[] = [];
  let expired = false;
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  const fetcher = (async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== 'Bearer JETON' || expired) return json({ error: 'invalid' }, 401);
    const u = new URL(url);
    if (u.host === 'gmail.googleapis.com') {
      const p = u.pathname.replace('/gmail/v1/users/me', '');
      if (p === '/messages') { queries.push(u.searchParams.get('q')!); return json({ messages: mails.map((m) => ({ id: m.id })) }); }
      const att = p.match(/^\/messages\/([^/]+)\/attachments\/(.+)$/);
      if (att) return json({ data: b64url(mails.find((m) => m.id === att[1])!._pdf!) });
      const one = mails.find((m) => p === `/messages/${m.id}`);
      return one ? json(one) : json({}, 404);
    }
    if (u.pathname === '/drive/v3/files' && init?.method === 'GET') return json({ files: [...drive].sort((a, b) => b.name.localeCompare(a.name)).map(({ id, name }) => ({ id, name })) });
    if (u.pathname.startsWith('/drive/v3/files/') && init?.method === 'DELETE') { drive.splice(drive.findIndex((f) => u.pathname.endsWith(f.id)), 1); return new Response(null, { status: 204 }); }
    if (u.pathname.startsWith('/drive/v3/files/') && u.searchParams.get('alt') === 'media') return new Response(drive.find((f) => u.pathname.endsWith(f.id))!.content, { status: 200 });
    if (u.pathname === '/upload/drive/v3/files') {
      const body = String(init?.body);
      const meta = JSON.parse(body.split('\r\n\r\n')[1].split('\r\n')[0]);
      const content = body.split('\r\n\r\n')[2].split('\r\n--')[0];
      drive.push({ id: 'f' + drive.length, name: meta.name, content });
      return json({ id: 'f' + (drive.length - 1) });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { mails, drive, queries, fetcher, expire: () => { expired = true; } };
}

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`google-${++n}`));
  store.clear();
  _setSession({ token: 'JETON', expiresAt: Date.now() + 3_600_000, email: 'vendeur@gmail.com' });
  await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, syncMode: 'google', googleEmail: 'vendeur@gmail.com', syncSince: '2026-10-01', autoRecord: true });
});

describe('connexion Google', () => {
  it('HTML des e-mails Vinted → même texte que le script, pseudo lu même sans « Bonjour »', () => {
    const t = htmlToText(doneHtml('clevinnng', 'Veste - Taille L', '65,00'));
    expect(t).toContain('La vente de Veste - Taille L a été réalisée avec succès.');
    expect(t).toContain('65,00 €');
    const raw = messageToRaw(gmailMsg('m1', '2026-10-25T12:07:59Z', 'La transaction est finalisée', doneHtml('clevinnng', 'Veste - Taille L', '65,00')));
    expect(raw.text).not.toMatch(/https?:/);
    expect(extractPseudo(raw.text)).toBe('clevinnng');
    expect(raw.date).toBe('2026-10-25T12:07:59.000Z');
  });

  it('synchro complète par Gmail : vente puis paiement, enregistrés sans script', async () => {
    const g = fakeGoogle();
    g.mails.push(gmailMsg('a1', '2026-10-20T09:00:00Z', "Ton article s'est vendu !", saleHtml('clevinnng', 'Robe longue rose - Taille S', '80,00')));
    g.mails.push(gmailMsg('a2', '2026-10-24T09:00:00Z', 'La transaction est finalisée', doneHtml('clevinnng', 'Robe longue rose - Taille S', '80,00')));
    const r = await syncNow(g.fetcher, '2026-10-27');
    expect(r.applied).toBe(2);
    expect(g.queries[0]).toContain('from:(vinted.fr OR vinted.com)');
    expect(g.queries[0]).toContain('after:2026/10/01');
    const ds = await loadDataset();
    expect(ds.sales).toHaveLength(1);
    expect(ds.sales[0].sellerRevenue).toBe(8000);
    expect(ds.sales[0].orderStatus).toBe('terminee');
  });

  it('jeton expiré : message clair pour se reconnecter', async () => {
    const g = fakeGoogle();
    g.expire();
    await expect(syncNow(g.fetcher, '2026-10-27')).rejects.toBeInstanceOf(GoogleAuthNeeded);
    _setSession({ token: 'JETON', expiresAt: Date.now() - 1000, email: null });
    expect(tokenValid({ token: 'JETON', expiresAt: Date.now() - 1000, email: null })).toBe(false);
    await expect(fetchGmailVinted('2026-10-01', g.fetcher)).rejects.toBeInstanceOf(GoogleAuthNeeded);
  });

  it('sauvegarde et restauration dans Google Drive (fichiers de l’appli seulement)', async () => {
    const g = fakeGoogle();
    g.mails.push(gmailMsg('a1', '2026-10-20T09:00:00Z', "Ton article s'est vendu !", saleHtml('clevinnng', 'Robe longue rose - Taille S', '80,00')));
    await syncNow(g.fetcher, '2026-10-27');
    const name = await driveBackup(g.fetcher);
    expect(name).toMatch(/^cng-vinted-\d{4}-\d{2}-\d{2}\.json$/);
    await driveBackup(g.fetcher); // même jour : remplacé, pas dupliqué
    expect(g.drive).toHaveLength(1);
    // nouveau téléphone
    setDb(new VPDatabase(`google-neuf-${n}`));
    await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, syncMode: 'google' });
    const back = await driveRestore(g.fetcher);
    expect(back.sales).toBe(1);
    expect((await loadDataset()).settings.syncMode).toBe('google');
  });

  it('bordereaux : PDF lus dans les pièces jointes Gmail', async () => {
    const g = fakeGoogle();
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const pdf = await doc.save();
    g.mails.push(gmailMsg('b1', '2026-10-26T09:00:00Z', "Bordereau d'envoi Vinted - à utiliser avant le 31/10/2026 12 h 00 pour Robe - Taille S", '<p>Ton bordereau</p>', pdf));
    const out = await buildLabelsPdf(['b1'], 'a4', g.fetcher);
    expect(out.printedIds).toEqual(['b1']);
    expect(out.blob.size).toBeGreaterThan(500);
  });
});
