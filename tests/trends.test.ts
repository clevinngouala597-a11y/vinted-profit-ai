import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb, getDb } from '../src/lib/db';
import { cleanRemote, filterTrends, parseTrend, publishTrend, removeTrend, sortTrends, syncTrends, type RemoteTrend } from '../src/lib/trends';
import { unseen, visibleChangelog, CHANGELOG } from '../src/lib/changelog';

const TELEGRAM = `#32 TOP 32 • 120 ❤️
________________________________
👗 JEANS LOW RISE BICOLORE Y2K STYLE, MARQUE: JAPAN STYLE, ÉTAT: TRÈS BON ÉTAT, TAILLE: L, 24.90 €, 26.85 €
👤 Paky200104 3541Pro
⭐⭐⭐⭐
💶 24,90 €
⏳ Ajouté Il y a un jour`;

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(), key: () => null, length: 0,
} as unknown as Storage;

const KEY = 'cle-admin-de-test';
const URL = 'https://script.test/exec';

/** Faux script Google : même protocole que le vrai (liste + photos, écriture réservée à la clé admin). */
function fakeScript() {
  const items: RemoteTrend[] = [];
  const photos = new Map<string, { data: string; mime: string }>();
  let n = 0;
  const reply = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  const fetcher = (async (input: string, init?: RequestInit) => {
    const u = new globalThis.URL(input);
    if (!init || init.method !== 'POST') {
      if (u.searchParams.get('action') === 'tendances') return reply({ ok: true, items });
      if (u.searchParams.get('action') === 'photo') { const p = photos.get(u.searchParams.get('id')!); return reply(p ? { ok: true, ...p } : { ok: false }); }
      return reply({ ok: false });
    }
    const d = JSON.parse(String(init.body));
    if (d.app !== 'cng-tendances' || d.key !== KEY) return reply({ ok: false, erreur: 'cle' });
    const at = new Date(Date.UTC(2026, 10, 1, 10, n++)).toISOString();
    if (d.op === 'save') {
      const i = items.findIndex((x) => x.id === d.item.id);
      let photo = i >= 0 ? items[i].photo : null;
      if (d.photo) { if (photo) photos.delete(photo); photo = 'drivefile' + n; photos.set(photo, d.photo); }
      const row = { ...d.item, id: d.item.id ?? 'trend-' + n, photo, addedAt: i >= 0 ? items[i].addedAt : at, updatedAt: at };
      if (i >= 0) items[i] = row; else items.push(row);
      return reply({ ok: true, item: row });
    }
    if (d.op === 'delete') {
      const i = items.findIndex((x) => x.id === d.id);
      if (i >= 0) { if (items[i].photo) photos.delete(items[i].photo!); items.splice(i, 1); }
      return reply({ ok: true });
    }
    return reply({ ok: false });
  }) as unknown as typeof fetch;
  return { fetcher, items, photos };
}

const input = (text: string) => ({ ...parseTrend(text), text, note: '' });

describe('tendances', () => {
  beforeEach(() => {
    setDb(new VPDatabase('t-' + Math.random()));
    localStorage.clear();
  });

  it('lit un message du canal Telegram', () => {
    const t = parseTrend(TELEGRAM);
    expect(t).toMatchObject({ title: 'Jeans low rise bicolore Y2K style', brand: 'Japan Style', condition: 'Très bon état', size: 'L', price: 2490, likes: 120, seller: 'Paky200104' });
  });

  it("n'invente rien quand le texte est libre", () => {
    const t = parseTrend('Veste Carhartt vue sur Vinted https://www.vinted.fr/items/123-veste');
    expect(t.url).toBe('https://www.vinted.fr/items/123-veste');
    expect([t.brand, t.price, t.likes]).toEqual(['', null, null]);
  });

  it('seul l’admin peut publier ; les testeurs reçoivent la liste et les photos', async () => {
    const s = fakeScript();
    // testeur : pas de clé admin sur l'appareil
    await expect(publishTrend(input(TELEGRAM), null, false, s.fetcher, URL)).rejects.toThrow(/admin/);
    // mauvaise clé : refusée par le script
    localStorage.setItem('cng-admin-stats', 'mauvaise');
    await expect(publishTrend(input(TELEGRAM), null, false, s.fetcher, URL)).rejects.toThrow(/refusé/);
    expect(s.items).toHaveLength(0);

    localStorage.setItem('cng-admin-stats', KEY);
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });
    await publishTrend(input(TELEGRAM), jpeg, false, s.fetcher, URL);
    await publishTrend(input('SWEAT NIKE, MARQUE: NIKE, TAILLE: M, 18 € · 340 ❤️'), null, false, s.fetcher, URL);
    expect(s.items).toHaveLength(2);

    // un testeur sur un autre appareil
    localStorage.clear();
    setDb(new VPDatabase('t-' + Math.random()));
    expect(await syncTrends(s.fetcher, URL)).toBe(2);
    const db = getDb();
    const list = sortTrends(await db.trends.toArray(), 'likes');
    expect(list.map((t) => t.brand)).toEqual(['Nike', 'Japan Style']);
    const photo = await db.attachments.get(list[1].photoId!);
    expect(photo?.blob.size).toBe(6);
    expect(filterTrends(list, 'japan')).toHaveLength(1);
    // la comptabilité n'est pas touchée
    expect(await db.items.count()).toBe(0);
    expect(await db.sales.count()).toBe(0);
  });

  it('modifier et retirer se répercutent chez tout le monde (photo comprise)', async () => {
    const s = fakeScript();
    localStorage.setItem('cng-admin-stats', KEY);
    await publishTrend(input(TELEGRAM), new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), false, s.fetcher, URL);
    const id = s.items[0].id;
    await publishTrend({ ...input(TELEGRAM), id, likes: 150 }, null, true, s.fetcher, URL);
    expect(s.items[0]).toMatchObject({ likes: 150, photo: expect.any(String) });
    const db = getDb();
    const pid = (await db.trends.get(id))!.photoId!;
    expect(await db.attachments.get(pid)).toBeDefined();
    await removeTrend(id, s.fetcher, URL);
    expect(await db.trends.count()).toBe(0);
    expect(await db.attachments.get(pid)).toBeUndefined();
  });

  it('ignore les fiches invalides reçues du script', () => {
    expect(cleanRemote({ id: 'x' })).toBeNull();
    expect(cleanRemote({ id: 'abcdef12', url: 'javascript:alert(1)', price: -5, photo: '../../x' })).toMatchObject({ url: '', price: null, photo: null });
  });

  it('refuse une fiche vide', async () => {
    const s = fakeScript();
    localStorage.setItem('cng-admin-stats', KEY);
    await expect(publishTrend(input(''), null, false, s.fetcher, URL)).rejects.toThrow(/photo ou une description/);
  });
});

describe('nouveautés', () => {
  it('montre les nouveautés non vues, rien à un nouvel utilisateur, et masque la bêta dans la version officielle', () => {
    const list = [
      { id: '2026-12-01', date: '2026-12-01', title: 'B', points: [{ text: 'b' }] },
      { id: '2026-11-15', date: '2026-11-15', title: 'A', points: [{ text: 'a' }, { text: 'bêta', beta: true }] },
    ];
    expect(unseen(null, true, list)).toEqual([]);
    expect(unseen(null, false, list).map((e) => e.id)).toEqual(['2026-12-01']);
    expect(unseen('2026-11-01', false, list).map((e) => e.id)).toEqual(['2026-12-01', '2026-11-15']);
    expect(unseen('2026-12-01', false, list)).toEqual([]);
    expect(visibleChangelog(false, list)[1].points).toHaveLength(1);
    expect(visibleChangelog(true, list)[1].points).toHaveLength(2);
    // le journal réel : plus récent en premier, identifiants uniques
    const ids = CHANGELOG.map((e) => e.id);
    expect([...ids].sort().reverse()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
