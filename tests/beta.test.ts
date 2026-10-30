import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, getDb, setDb } from '../src/lib/db';
import { loadDataset } from '../src/lib/actions';
import { leaveDemo, loadDemoData } from '../src/lib/demo';
import { saleBreakdown } from '../src/lib/engine';
import { deviceSummary, FEEDBACK_TOPIC, feedbackMessage, sendFeedback } from '../src/lib/beta';
import { checkCode, codeHash, normalizeCode, storedAccess } from '../src/lib/betaAccess';

let n = 0;
beforeEach(() => setDb(new VPDatabase(`beta-${++n}`)));

describe('données d’exemple', () => {
  it('remplit l’appli autour d’aujourd’hui, puis s’efface entièrement', async () => {
    await loadDemoData('2026-11-03');
    const ds = await loadDataset();
    expect(ds.settings.onboarded).toBe(true);
    expect(ds.settings.demoData).toBe(true);
    expect(ds.sales.length).toBe(32);
    expect(ds.settings.showStock).toBe(true);
    // ventes sur le mois en cours et le précédent, aucune dans le futur
    expect(ds.sales.every((s) => s.date <= '2026-11-03')).toBe(true);
    expect(ds.sales.some((s) => s.date.startsWith('2026-11'))).toBe(true);
    expect(ds.sales.some((s) => s.date.startsWith('2026-10'))).toBe(true);
    // bénéfices cohérents : les ventes avec coût connu sont rentables
    const known = ds.sales.map((s) => saleBreakdown(ds, s)).filter((b) => b.cogs > 0);
    expect(known.every((b) => b.netRevenue - b.cogs > 0)).toBe(true);
    expect(ds.sales.filter((x) => x.date.startsWith('2026-10')).length).toBeGreaterThan(10);
    // statuts variés, coûts à compléter, articles à republier, bordereaux
    expect(new Set(ds.sales.map((s) => s.orderStatus)).size).toBeGreaterThanOrEqual(3);
    expect(ds.items.some((i) => i.costPending)).toBe(false);
    expect(ds.items.filter((i) => i.status === 'en_vente').length).toBe(3);
    expect(await getDb().syncedEmails.count()).toBe(0);
    expect(ds.goals[0].id).toBe('2026-11');

    await leaveDemo();
    const empty = await loadDataset();
    expect(empty.sales).toHaveLength(0);
    expect(empty.settings.onboarded).toBe(false);
  });

  it('peut être rechargé sans doublons', async () => {
    await loadDemoData('2026-11-03');
    await loadDemoData('2026-11-03');
    expect((await loadDataset()).sales).toHaveLength(32);
  });
});

describe('avis bêta', () => {
  const base = { kind: 'bug' as const, rating: 4, message: '  Le bouton Terminée ne fait rien  ', contact: '@clevin', tech: { screen: 'ventes', build: 'abc1234', device: 'iPhone · iOS 18.1' } };

  it('forme un message lisible pour la notification', () => {
    const m = feedbackMessage(base);
    expect(m.topic).toBe(FEEDBACK_TOPIC);
    expect(m.title).toBe('Avis bêta · Bug');
    expect(m.priority).toBe(4);
    expect(m.tags).toEqual(['bug']);
    expect(m.message).toContain('Le bouton Terminée ne fait rien');
    expect(m.message).toContain('★★★★☆');
    expect(m.message).toContain('Contact : @clevin');
    expect(m.message).toContain('Écran : ventes · version abc1234');
    expect(feedbackMessage({ ...base, tester: 'Testeur 03' }).message.startsWith('[Testeur 03]')).toBe(true);
    // sans infos techniques ni contact
    const bare = feedbackMessage({ ...base, kind: 'idee', rating: null, contact: '', tech: null });
    expect(bare.message).toBe('Le bouton Terminée ne fait rien');
    expect(bare.priority).toBe(3);
  });

  it('envoie à ntfy et refuse un avis vide', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    await sendFeedback(base, fetcher);
    const ntfy = calls.find((c) => c.url === 'https://ntfy.sh/')!;
    expect(JSON.parse(ntfy.body).topic).toBe(FEEDBACK_TOPIC);
    expect(calls.some((c) => c.url.startsWith('https://script.google.com/macros/s/'))).toBe(true);
    await expect(sendFeedback({ ...base, message: ' ' }, fetcher)).rejects.toThrow(/quelques mots/);
    const down = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    await expect(sendFeedback(base, down)).rejects.toThrow(/connexion/);
  });

  it('envoie aussi l’avis par e-mail (script Google) ; un seul envoi réussi suffit', async () => {
    const calls: { url: string; body: string }[] = [];
    const ok = (url: string) => new Response(url.startsWith('https://script') ? '{"ok":true}' : '{}', { status: 200 });
    const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return ok(url); }) as unknown as typeof fetch;
    const r = await sendFeedback({ ...base, contact: 'lea@mail.fr' }, fetcher, 'https://script.google.com/macros/s/X/exec');
    expect(r).toEqual({ mailed: true, pushed: true });
    const mail = JSON.parse(calls.find((c) => c.url.startsWith('https://script'))!.body);
    expect(mail).toMatchObject({ app: 'cng-vinted', title: 'Avis bêta · Bug', contact: 'lea@mail.fr' });
    expect(mail.message).toContain('Le bouton Terminée ne fait rien');
    const ntfyDown = (async (url: string) => (url.startsWith('https://ntfy') ? new Response('', { status: 500 }) : ok(url))) as unknown as typeof fetch;
    expect(await sendFeedback(base, ntfyDown, 'https://script.google.com/macros/s/X/exec')).toEqual({ mailed: true, pushed: false });
    const allDown = (async (url: string) => new Response(url.startsWith('https://script') ? '{"ok":false}' : '', { status: url.startsWith('https://script') ? 200 : 500 })) as unknown as typeof fetch;
    await expect(sendFeedback(base, allDown, 'https://script.google.com/macros/s/X/exec')).rejects.toThrow(/impossible/);
  });

  it('résume l’appareil sans identifiant', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    expect(deviceSummary(ua, true, 390)).toBe('iPhone · iOS 18.1 · 390 px · appli installée');
    expect(deviceSummary('Mozilla/5.0 (X11; Linux x86_64)', false, 1280)).toBe('Ordinateur · 1280 px · navigateur');
  });
});

describe('accès à la bêta', () => {
  it('reconnaît un code valide, quelle que soit la saisie, et refuse les autres', async () => {
    const list = { [await codeHash('CNG-ABCDE-FGHJK')]: 'Testeur 07' };
    expect(normalizeCode(' cng-abcde fghjk ')).toBe('CNGABCDEFGHJK');
    expect(await checkCode('cng-abcde-fghjk', list)).toEqual({ hash: expect.any(String), tester: 'Testeur 07' });
    expect(await checkCode('CNGABCDEFGHJK', list)).not.toBeNull();
    expect(await checkCode('CNG-ABCDE-FGHJX', list)).toBeNull();
    expect(await checkCode('CNG-ABC', list)).toBeNull();
  });

  it('les vrais codes ne sont pas dans le code source, seulement leurs empreintes', async () => {
    const { ACCESS } = await import('../src/lib/betaAccess');
    expect(Object.keys(ACCESS)).toHaveLength(21);
    expect(Object.values(ACCESS).filter((v) => v === 'Admin')).toHaveLength(1);
    expect(Object.keys(ACCESS).every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    expect(storedAccess(ACCESS)).toBeNull(); // pas de localStorage ici : accès fermé
  });
});

describe('code admin personnel', () => {
  it('un code personnel (pas seulement CNG + 10 caractères) ouvre l’accès admin, sans tenir compte des majuscules', async () => {
    const { checkCode, codeHash } = await import('../src/lib/betaAccess');
    const list = { [await codeHash('MonCode99')]: 'Admin' };
    expect((await checkCode('moncode99', list))?.tester).toBe('Admin');
    expect((await checkCode(' MONCODE99 ', list))?.tester).toBe('Admin');
    expect(await checkCode('moncode', list)).toBeNull();
  });
});
