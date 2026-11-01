import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb, getDb } from '../src/lib/db';
import { deleteTrend, filterTrends, parseTrend, saveTrend, sortTrends } from '../src/lib/trends';

const TELEGRAM = `#32 TOP 32 • 120 ❤️
________________________________
👗 JEANS LOW RISE BICOLORE Y2K STYLE, MARQUE: JAPAN STYLE, ÉTAT: TRÈS BON ÉTAT, TAILLE: L, 24.90 €, 26.85 €
👤 Paky200104 3541Pro
⭐⭐⭐⭐
💶 24,90 €
⏳ Ajouté Il y a un jour`;

describe('tendances', () => {
  beforeEach(async () => {
    setDb(new VPDatabase('t-' + Math.random()));
  });

  it('lit un message du canal Telegram', () => {
    const t = parseTrend(TELEGRAM);
    expect(t.title).toBe('Jeans low rise bicolore Y2K style');
    expect(t.brand).toBe('Japan Style');
    expect(t.condition).toBe('Très bon état');
    expect(t.size).toBe('L');
    expect(t.price).toBe(2490);
    expect(t.likes).toBe(120);
    expect(t.seller).toBe('Paky200104');
  });

  it("n'invente rien quand le texte est libre", () => {
    const t = parseTrend('Veste Carhartt vue sur Vinted https://www.vinted.fr/items/123-veste');
    expect(t.url).toBe('https://www.vinted.fr/items/123-veste');
    expect(t.brand).toBe('');
    expect(t.price).toBeNull();
    expect(t.likes).toBeNull();
  });

  it('ajoute, modifie, trie et supprime (avec sa photo), sans toucher au reste', async () => {
    const db = getDb();
    await db.attachments.add({ id: 'p1', blob: new Blob(['x']), mime: 'image/jpeg', createdAt: '2026-01-01' });
    await db.attachments.add({ id: 'p2', blob: new Blob(['y']), mime: 'image/jpeg', createdAt: '2026-01-01' });
    const base = { text: TELEGRAM, note: '', photoId: 'p1', ...parseTrend(TELEGRAM) };
    const id = await saveTrend(base);
    const id2 = await saveTrend({ ...parseTrend('Sweat Nike 300 ❤️ 12 €'), text: 'Sweat Nike 300 ❤️ 12 €', note: '', photoId: null });
    expect(sortTrends(await db.trends.toArray(), 'likes').map((t) => t.id)).toEqual([id2, id]);
    expect(filterTrends(await db.trends.toArray(), 'japan').map((t) => t.id)).toEqual([id]);
    // photo remplacée : l'ancienne est effacée
    await saveTrend({ ...base, id, photoId: 'p2', likes: 150 });
    expect((await db.trends.get(id))!.likes).toBe(150);
    expect(await db.attachments.get('p1')).toBeUndefined();
    await deleteTrend(id);
    expect(await db.trends.count()).toBe(1);
    expect(await db.attachments.get('p2')).toBeUndefined();
    expect(await db.items.count()).toBe(0);
    expect(await db.sales.count()).toBe(0);
  });

  it('refuse une fiche vide', async () => {
    await expect(saveTrend({ ...parseTrend(''), text: '', note: '', photoId: null })).rejects.toThrow();
  });
});
