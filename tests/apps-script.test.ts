import 'fake-indexeddb/auto';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, saveSettings } from '../src/lib/actions';
import { appsScriptSource, newTopic } from '../src/lib/vinted/appsScript';
import { autoBackupIfDue, driveBackup, driveRestore, PasswordNeeded, rotateScriptKey, sendTestNotification, setBackupPassword } from '../src/lib/vinted/drive';
import { addItemPhotos, recordPurchase } from '../src/lib/actions';
import { syncNow } from '../src/lib/vinted/sync';
import { buildLabelsPdf } from '../src/lib/vinted/labels';
import { PDFDocument } from 'pdf-lib';

/** Faux environnement Google Apps Script : exécute le VRAI script généré par l'application. */
function googleEnv(secret: string, topic: string) {
  const mails: { id: string; date: Date; subject: string; body: string; pdf?: number[] }[] = [];
  const sent: { topic: string; title: string; message: string; tags: string[] }[] = [];
  const props = new Map<string, string>();
  const triggers: string[] = [];
  const folders: { name: string; files: { name: string; content: string; trashed: boolean }[] }[] = [];
  const folderObj = (f: (typeof folders)[number]) => {
    const live = () => f.files.filter((x) => !x.trashed);
    const fileObj = (x: (typeof f.files)[number]) => ({ getName: () => x.name, setTrashed: () => { x.trashed = true; }, getBlob: () => ({ getDataAsString: () => x.content }) });
    const iter = <T,>(arr: T[]) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
    return {
      getFilesByName: (n: string) => iter(live().filter((x) => x.name === n).map(fileObj)),
      getFiles: () => iter(live().map(fileObj)),
      createFile: (b: { content: string; name: string }) => { f.files.push({ name: b.name, content: b.content, trashed: false }); },
    };
  };
  const sandbox: Record<string, unknown> = {
    GmailApp: {
      getMessageById: (id: string) => {
        const m = mails.find((x) => x.id === id);
        if (!m) throw new Error('introuvable');
        return { getFrom: () => 'Vinted <no-reply@vinted.fr>', getSubject: () => m.subject, getAttachments: () => (m.pdf ? [{ getContentType: () => 'application/pdf', getName: () => 'Bordereau.pdf', getBytes: () => m.pdf }] : []) };
      },
      search: (q: string) => mails
        .filter((m) => !/subject:\(vendu OR finalisée\)/.test(q) || /vendu|finalisée/.test(m.subject))
        .map((m) => ({ getMessages: () => [{ getId: () => m.id, getDate: () => m.date, getSubject: () => m.subject, getPlainBody: () => m.body }] })),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ setMimeType: () => s }) },
    DriveApp: {
      getFoldersByName: (n: string) => { const f = folders.filter((x) => x.name === n); let i = 0; return { hasNext: () => i < f.length, next: () => folderObj(f[i++]) }; },
      createFolder: (n: string) => { const f = { name: n, files: [] }; folders.push(f); return folderObj(f); },
    },
    Utilities: {
      base64Encode: (b: number[]) => Buffer.from(b).toString('base64'),
      formatDate: () => '2026-10-27',
      newBlob: (content: string, _mime: string, name: string) => ({ content, name }),
    },
    UrlFetchApp: { fetch: (_url: string, o: { payload: string }) => { sent.push(JSON.parse(o.payload)); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((h) => ({ getHandlerFunction: () => h })),
      deleteTrigger: (t: { getHandlerFunction: () => string }) => triggers.splice(triggers.indexOf(t.getHandlerFunction()), 1),
      newTrigger: (h: string) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push(h) }) }) }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(appsScriptSource(secret, topic) + '\nthis.api = { doGet, doPost, verifierVentes, installer };', sandbox);
  const api = sandbox.api as Record<string, (e?: unknown) => string>;
  /** Le « réseau » : les appels de l'application arrivent au script comme sur Google. */
  const fetcher = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const parameter = Object.fromEntries(u.searchParams);
    const out = init?.method === 'POST' ? api.doPost({ parameter, postData: { contents: String(init.body) } }) : api.doGet({ parameter });
    return new Response(out, { status: 200 });
  }) as unknown as typeof fetch;
  return { mails, sent, props, triggers, folders, api, fetcher };
}

const SECRET = 'S3CRET-cle-de-test-0123456789';
let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`gas-${++n}`));
  await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, syncUrl: 'https://script.google.com/macros/s/abc/exec', syncToken: SECRET, syncSince: '2026-10-01', autoRecord: true });
});

describe('Script Google (exécuté pour de vrai)', () => {
  it('notifications : installer puis une notification par nouvelle vente et par paiement, jamais deux fois', () => {
    const topic = newTopic();
    expect(topic).toMatch(/^cng-vinted-[A-Za-z0-9_-]{20}$/);
    const g = googleEnv(SECRET, topic);
    g.mails.push({ id: 'ancien', date: new Date('2026-10-26T10:00:00Z'), subject: "Ton article s'est vendu !", body: 'x a acheté Vieux pull 10,00 €' });
    g.api.installer();
    expect(g.triggers).toEqual(['verifierVentes']);
    expect(g.sent.map((x) => x.title)).toEqual(['CNG Vinted']); // confirmation d'installation
    expect(g.sent[0].topic).toBe(topic);
    g.api.installer(); // relancé : pas de double déclencheur
    expect(g.triggers).toEqual(['verifierVentes']);

    g.mails.push({ id: 'v1', date: new Date('2026-10-27T10:00:00Z'), subject: "Ton article s'est vendu !", body: 'Bonjour clevinnng, mickelyn a acheté [image: Robe longue rose] Robe longue rose - Taille S 80,00 € Nous transférerons https://x.y/z' });
    g.mails.push({ id: 'p1', date: new Date('2026-10-27T11:00:00Z'), subject: 'La transaction est finalisée', body: 'La vente de Veste Cars - Taille L a été réalisée avec succès. Viré sur ton compte Vinted : 54,00 €' });
    g.sent.length = 0;
    g.api.verifierVentes();
    expect(g.sent.map((x) => [x.title, x.message, x.tags[0]])).toEqual([
      ['Nouvelle vente !', 'Robe longue rose - Taille S — 80,00 €', 'moneybag'],
      ['Paiement reçu', 'Veste Cars - Taille L — 54,00 €', 'dollar'],
    ]);
    g.api.verifierVentes(); // 5 minutes plus tard : rien de nouveau
    expect(g.sent).toHaveLength(2);
  });

  it('sauvegarde Drive : un fichier par jour, restauration complète, mauvaise clé refusée', async () => {
    const g = googleEnv(SECRET, 'cng-vinted-sujet');
    g.mails.push({ id: 'v1', date: new Date('2026-10-22T09:10:49Z'), subject: "Ton article s'est vendu !", body: 'Bonjour clevinnng, mickelyn a acheté Robe longue rose - Taille S 80,00 € Nous transférerons' });
    const r = await syncNow(g.fetcher, '2026-10-27');
    expect(r.applied).toBe(1);
    let s = (await loadDataset()).settings;
    expect([s.scriptVersion, s.scriptNotifications]).toEqual([4, false]);
    expect(s.ntfyTopic).toBe('cng-vinted-sujet'); // le sujet du script fait foi

    expect(await autoBackupIfDue(g.fetcher)).toBe(true);
    expect(await autoBackupIfDue(g.fetcher)).toBe(false); // déjà faite il y a moins de 12 h
    await driveBackup(g.fetcher); // même jour : remplace le fichier du jour
    const files = g.folders[0].files.filter((f) => !f.trashed);
    expect(g.folders[0].name).toBe('CNG Vinted - sauvegardes');
    expect(files.map((f) => f.name)).toEqual(['cng-vinted-2026-10-27.json']);

    // perte de données (nouveau téléphone) → restauration
    setDb(new VPDatabase(`gas-vide-${n}`));
    await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, syncUrl: 'https://script.google.com/macros/s/abc/exec', syncToken: SECRET });
    expect((await loadDataset()).sales).toHaveLength(0);
    const back = await driveRestore(g.fetcher);
    expect(back.sales).toBe(1);
    const ds = await loadDataset();
    expect(ds.sales[0].sellerRevenue).toBe(8000);
    expect(ds.items[0].costPending).toBe(true);

    await saveSettings({ syncToken: 'mauvaise-cle' });
    await expect(driveBackup(g.fetcher)).rejects.toThrow(/Clé secrète refusée/);
    s = (await loadDataset()).settings;
  });

  it('clé secrète : changée depuis l’appli, l’ancienne ne marche plus, la synchro continue', async () => {
    const g = googleEnv(SECRET, 'cng-vinted-sujet');
    g.mails.push({ id: 'v1', date: new Date('2026-10-22T09:10:49Z'), subject: "Ton article s'est vendu !", body: 'Bonjour clevinnng, mickelyn a acheté Robe longue rose - Taille S 80,00 € Nous transférerons' });
    await syncNow(g.fetcher, '2026-10-27'); // le script répond en version 4
    await rotateScriptKey(g.fetcher);
    const fresh = (await loadDataset()).settings.syncToken!;
    expect(fresh).not.toBe(SECRET);
    expect(fresh.length).toBeGreaterThanOrEqual(24);
    expect(g.props.get('CLE')).toBe(fresh); // gardée dans les propriétés du script
    // l'ancienne clé est refusée par le script
    expect(JSON.parse(g.api.doGet({ parameter: { token: SECRET, action: 'ping' } }))).toEqual({ error: 'unauthorized' });
    // la nouvelle fonctionne pour tout
    expect(JSON.parse(g.api.doGet({ parameter: { token: fresh, action: 'ping' } })).ok).toBe(true);
    await expect(syncNow(g.fetcher, '2026-10-28')).resolves.toBeTruthy();
    // une clé mal formée est refusée
    expect(JSON.parse(g.api.doPost({ parameter: { token: fresh, action: 'changer_cle' }, postData: { contents: 'court' } }))).toEqual({ error: 'clé invalide' });
  });

  it('sauvegardes chiffrées : illisibles sans le mot de passe, restaurées avec, photos comprises', async () => {
    const g = googleEnv(SECRET, 'cng-vinted-sujet');
    await syncNow(g.fetcher, '2026-10-27');
    const { itemIds } = await recordPurchase({ date: '2026-10-05', source: 'Friperie', commonFees: 0, lotPrice: null, lines: [{ name: 'Veste secrète', category: 'Vestes et manteaux', price: 1800, targetPrice: 5500 }] });
    await addItemPhotos(itemIds[0], [new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' })]);
    await expect(setBackupPassword('court')).rejects.toThrow(/au moins 8/);
    await setBackupPassword('mon-mot-de-passe', g.fetcher);
    const file = g.folders[0].files.filter((f) => !f.trashed).at(-1)!;
    expect(file.content).not.toContain('Veste secrète');
    expect(file.content).not.toContain(SECRET);
    expect(JSON.parse(file.content).format).toBe('cng-vinted/chiffre-v1');
    // ce téléphone ouvre ses propres sauvegardes sans redemander le mot de passe
    const same = await driveRestore(g.fetcher);
    expect(same.items).toBe(1);

    // nouveau téléphone : le mot de passe est demandé
    setDb(new VPDatabase(`gas-neuf-${n}`));
    await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, syncUrl: 'https://script.google.com/macros/s/abc/exec', syncToken: SECRET });
    await expect(driveRestore(g.fetcher)).rejects.toBeInstanceOf(PasswordNeeded);
    await expect(driveRestore(g.fetcher, 'mauvais-mot-de-passe')).rejects.toThrow(/Mot de passe incorrect/);
    const back = await driveRestore(g.fetcher, 'mon-mot-de-passe');
    expect(back.items).toBe(1);
    const ds = await loadDataset();
    expect(ds.items[0].name).toBe('Veste secrète');
    expect(ds.settings.backupKey).toBeTruthy(); // les prochaines sauvegardes restent chiffrées
    expect(ds.settings.syncToken).toBe(SECRET); // la connexion de ce téléphone est gardée
    const { getDb } = await import('../src/lib/db');
    const photo = await getDb().attachments.toArray();
    expect(photo).toHaveLength(1);
    expect([...new Uint8Array(await photo[0].blob.arrayBuffer())]).toEqual([1, 2, 3, 250]);
    // la clé de chiffrement n'est jamais copiée dans une sauvegarde
    await driveBackup(g.fetcher);
    const { createBackup } = await import('../src/lib/exports');
    expect(await (await createBackup(false)).text()).not.toContain(ds.settings.backupKey!);
  });

  it('notification de test depuis l’application', async () => {
    const g = googleEnv(SECRET, 'cng-vinted-sujet');
    g.api.installer();
    g.sent.length = 0;
    expect(await sendTestNotification(g.fetcher)).toBe(true);
    expect(g.sent[0]).toMatchObject({ topic: 'cng-vinted-sujet', title: 'Test CNG Vinted' });
    expect((await loadDataset()).settings.scriptNotifications).toBe(true);
  });

  it('bordereaux : la synchro les liste, le script envoie les PDF, un seul PDF A4 en sort', async () => {
    const g = googleEnv(SECRET, 'cng-vinted-sujet');
    const one = async () => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); return Array.from(await d.save()); };
    g.mails.push({ id: 'aaaa0001aaaa0001', date: new Date('2026-10-26T10:00:00Z'), subject: "Bordereau d'envoi Vinted - à utiliser avant le 02/11/2026 10 h 00 pour Robe - Taille S", body: 'Article : Robe - Taille S Format du colis : 500 g N° de suivi : 123 Mondial Relay', pdf: await one() });
    g.mails.push({ id: 'aaaa0002aaaa0002', date: new Date('2026-10-26T11:00:00Z'), subject: "Bordereau d'envoi Vinted - à utiliser avant le 03/11/2026 10 h 00 pour Veste - Taille L", body: 'Article : Veste - Taille L Format du colis : 1 kg Vinted Go' });
    await syncNow(g.fetcher, '2026-10-27');
    const rows = (await import('../src/lib/db')).getDb().syncedEmails;
    expect((await rows.toArray()).filter((r) => r.kind === 'label').map((r) => r.title).sort()).toEqual(['Robe - Taille S', 'Veste - Taille L']);
    const r = await buildLabelsPdf(['aaaa0001aaaa0001', 'aaaa0002aaaa0002'], 'a4', g.fetcher);
    expect(r.printedIds).toEqual(['aaaa0001aaaa0001']);
    expect(r.missing).toEqual(['aaaa0002aaaa0002']); // QR code, pas de PDF
    expect((await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))).getPageCount()).toBe(1);
  });
});
