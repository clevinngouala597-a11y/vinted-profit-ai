import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { AUTO_ITEM_SOURCE, cancelSale, defaultSettings, loadDataset, recordPurchase, recordSale, saveSettings } from '../src/lib/actions';
import { detectBrand, detectSize, sellerStats } from '../src/lib/stats';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`stats-${++n}`));
  await saveSettings({ ...defaultSettings('2026-09-01'), onboarded: true, staleDays: 30 });
});

const buy = async (name: string, cost: number, date: string, category = 'Sweats et pulls', source = 'Friperie') =>
  (await recordPurchase({ date, source, commonFees: 0, lotPrice: null, lines: [{ name, category, price: cost, targetPrice: null, status: 'en_vente' }] })).itemIds[0];
const sell = (itemId: string, date: string, revenue: number) =>
  recordSale({ date, itemIds: [itemId], listedPrice: revenue, discount: 0, sellerRevenue: revenue, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'recu' });

describe('Statistiques de vendeur', () => {
  it('marques et tailles repérées dans les titres Vinted', () => {
    expect(detectBrand({ brand: '', name: 'Pull half zip col camionneur Ralph Lauren | gris', listingRef: '' })).toBe('Ralph Lauren');
    expect(detectBrand({ brand: '', name: 'Veste polaire The North Face', listingRef: '' })).toBe('The North Face');
    expect(detectBrand({ brand: '', name: 'Sweat gris inrose', listingRef: '' })).toBeNull();
    expect(detectSize({ size: '', name: 'Pull Lacoste', listingRef: 'Pull col rond Lacoste | marine | Taille L' })).toBe('L');
    expect(detectSize({ size: '', name: 'Escarpins Taille 37', listingRef: '' })).toBe('37');
  });

  it('jours, catégories, délai de vente, annulations répétées, ventes à perte', async () => {
    const a = await buy('Pull Lacoste - Taille L', 1000, '2026-10-01');
    const b = await buy('Veste The North Face - Taille XL', 2000, '2026-10-01', 'Vestes et manteaux');
    const c = await buy('Pantalon Sarouel - Taille L', 800, '2026-10-02', 'Pantalons et jeans');
    const d = await buy('Montre CD', 0, '2026-10-20', 'Accessoires', AUTO_ITEM_SOURCE); // créée par la synchro
    await sell(a, '2026-10-05', 4000); // lundi
    await sell(b, '2026-10-12', 1500); // lundi, à perte
    const s1 = await recordSale({ date: '2026-10-06', itemIds: [c], listedPrice: 3500, discount: 0, sellerRevenue: 3500, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente' });
    await cancelSale(s1, '2026-10-07');
    const s2 = await recordSale({ date: '2026-10-08', itemIds: [c], listedPrice: 3500, discount: 0, sellerRevenue: 3500, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente' });
    await cancelSale(s2, '2026-10-09');
    await sell(d, '2026-10-20', 5000); // mardi
    const st = sellerStats(await loadDataset(), { from: '2026-10-01', to: '2026-10-31' }, '2026-10-31');
    expect(st.salesCount).toBe(3);
    expect(st.revenue).toBe(4000 + 1500 + 5000);
    expect(st.cancelledCount).toBe(2);
    expect(st.cancelRate).toBe(40);
    expect(st.bestWeekday).toBe('Lundi');
    expect(st.categories[0]).toMatchObject({ key: 'Accessoires', profit: 5000 });
    expect(st.brands.map((g) => g.key)).toEqual(['Lacoste', 'The North Face']);
    expect(st.timeToSell).toMatchObject({ count: 2, median: 7.5 }); // la montre (sans vraie date d'achat) est exclue
    expect(st.repeatCancels).toEqual([{ name: 'Pantalon Sarouel - Taille L', count: 2 }]);
    expect(st.losers.map((l) => l.profit)).toEqual([-500]);
    expect(st.dormant.map((x) => x.item.name)).toEqual([]); // le sarouel est en vente depuis 29 jours
    expect(st.best?.name).toBe('Montre CD');
  });
});
