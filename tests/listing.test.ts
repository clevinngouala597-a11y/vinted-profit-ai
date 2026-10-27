import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, markRepublished, recordPurchase, recordSale, saveSettings } from '../src/lib/actions';
import { draftListing, parseDraft, priceAdvice, republishList } from '../src/lib/listing';
import { fillTemplate, templatesWithOverrides } from '../src/lib/templates';
import { autoBackground, buildPrompts } from '../src/lib/photoPrompts';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`listing-${++n}`));
  await saveSettings({ ...defaultSettings('2026-09-01'), onboarded: true, minProfitPerItem: 1000, republishDays: 7 });
});
const buy = async (name: string, cost: number, date: string, target: number | null = null, brand = '') =>
  (await recordPurchase({ date, source: 'Friperie', commonFees: 0, lotPrice: null, lines: [{ name, brand, category: 'Sweats et pulls', price: cost, targetPrice: target, status: 'en_vente' }] })).itemIds[0];

describe('Annonce IA', () => {
  it('appel à Claude : en-têtes, photos, réponse JSON ; erreurs claires', async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const ok = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Voici : {"title":"Pull Lacoste marine col rond - Taille L","description":"Joli pull.","brand":"Lacoste","size":"L","condition":"Très bon état","category":"Sweats et pulls","color":"marine","hashtags":["lacoste","pull vintage"],"defects":[]}' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const d = await draftListing('sk-ant-test', ['AAAA'], 'taille L', undefined, ok);
    expect(d).toMatchObject({ brand: 'Lacoste', size: 'L', condition: 'Très bon état', hashtags: ['#lacoste', '#pullvintage'] });
    const h = sent!.init.headers as Record<string, string>;
    expect(sent!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(h['x-api-key']).toBe('sk-ant-test');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String(sent!.init.body));
    expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg', data: 'AAAA' } });
    expect(body.messages[0].content[1].text).toContain("N'invente rien");
    const bad = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(draftListing('sk-x', ['A'], '', undefined, bad)).rejects.toThrow(/Clé API refusée/);
    await expect(draftListing('', ['A'], '')).rejects.toThrow(/clé API/);
  });

  it('réponse incomplète ou fantaisiste : champs sûrs', () => {
    const d = parseDraft('{"title":"Veste","condition":"Comme neuf","category":"Fusées","hashtags":"x"}', ['Vestes et manteaux']);
    expect(d).toMatchObject({ title: 'Veste', condition: null, category: 'Autres vêtements', hashtags: [], brand: null });
  });

  it('prix conseillé : uniquement l’historique (même marque d’abord) et minimum rentable', async () => {
    for (const [p, d] of [[3000, '2026-09-02'], [3500, '2026-09-03'], [4000, '2026-09-04']] as const) {
      const id = await buy('Pull col rond', 800, d, null, 'Lacoste');
      await recordSale({ date: d, itemIds: [id], listedPrice: p, discount: 0, sellerRevenue: p, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'recu' });
    }
    const a = priceAdvice(await loadDataset(), { brand: 'Lacoste', category: 'Sweats et pulls' }, 1200);
    expect(a).toMatchObject({ median: 3500, count: 3, basis: 'Lacoste · Sweats et pulls', minimum: 2200 });
    const none = priceAdvice(await loadDataset(), { brand: 'Nike', category: 'Chaussures' }, null);
    expect(none).toMatchObject({ median: null, count: 0, minimum: null });
  });
});

describe('À republier', () => {
  it('articles immobiles, baisse de 10 % sans passer sous le minimum rentable', async () => {
    const a = await buy('Veste Carhartt', 1500, '2026-10-01', 4000);
    await buy('Pull récent', 500, '2026-10-25', 2000);
    const c = await buy('Sweat', 1800, '2026-10-01', 3000);
    let rows = republishList(await loadDataset(), '2026-10-27');
    expect(rows.map((r) => [r.item.name, r.suggested])).toEqual([['Sweat', 2800], ['Veste Carhartt', 3600]]);
    await markRepublished(a, 3600, '2026-10-27');
    rows = republishList(await loadDataset(), '2026-10-27');
    expect(rows.map((r) => r.item.id)).toEqual([c]);
    expect((await loadDataset()).items.find((i) => i.id === a)!.targetPrice).toBe(3600);
  });
});

describe('Messages et prompts photo', () => {
  it('messages remplis, modèles modifiables', () => {
    const t = templatesWithOverrides({ merci: 'Merci {acheteur} pour {article} !' });
    expect(fillTemplate(t.find((x) => x.id === 'merci')!.text, { acheteur: 'mickelyn', article: 'la robe' })).toBe('Merci mickelyn pour la robe !');
    expect(fillTemplate('Merci {acheteur}, à bientôt', {})).toBe('Merci, à bientôt');
  });

  it('un prompt par vue, article inchangé, fond auto contrasté', () => {
    const out = buildPrompts({ mode: 'plat', type: 'sweater', color: 'noir', brand: 'Lacoste', condition: 'Très bon état', views: ['face', 'etiquette'], background: 'auto', light: 'naturelle', style: 'soigne' });
    expect(out.map((o) => o.view)).toEqual(['Face', 'Étiquette']);
    expect(out[0].prompt).toContain('noir Lacoste sweater');
    expect(out[0].prompt).toContain('wooden parquet');
    expect(out[0].prompt).toContain('EXACTLY identical');
    expect(autoBackground('blanc cassé')).toContain('black');
  });
});
