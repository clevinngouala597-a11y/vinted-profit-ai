import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { completeItemCost, defaultSettings, deleteCostModel, loadDataset, recordPurchase, recordSale, saveCostModel, saveSettings, setCategoryPrice } from '../src/lib/actions';
import { matchModel, suggestCost } from '../src/lib/costTemplates';
import { saleBreakdown, itemCost } from '../src/lib/engine';
import { checkBooks } from '../src/lib/ledger';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`modeles-${++n}`));
  await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true });
});

describe('prix d’achat habituels', () => {
  it('prix par catégorie et modèles : créer, modifier, supprimer', async () => {
    await setCategoryPrice('T-shirts', 300);
    await setCategoryPrice('Sweats et pulls', 700);
    await setCategoryPrice('T-shirts', null);
    const id = await saveCostModel({ name: 'Nike Air Force 1', keywords: 'air force, af1', category: 'Chaussures', price: 1500 });
    await saveCostModel({ name: "Levi's 501", category: 'Pantalons et jeans', price: 600 });
    await expect(saveCostModel({ name: 'nike air force 1', price: 100 })).rejects.toThrow(/existe déjà/);
    await saveCostModel({ id, name: 'Nike Air Force 1', keywords: 'air force, af1', category: 'Chaussures', price: 1600 });
    let s = (await loadDataset()).settings;
    expect(s.categoryPrices).toEqual({ 'Sweats et pulls': 700 });
    expect(s.costModels.find((m) => m.id === id)!.price).toBe(1600);
    await deleteCostModel(id);
    s = (await loadDataset()).settings;
    expect(s.costModels.map((m) => m.name)).toEqual(["Levi's 501"]);
  });

  it('reconnaît un modèle dans un titre Vinted, sinon propose le prix de la catégorie', () => {
    const s = {
      categoryPrices: { 'Sweats et pulls': 700, Chaussures: 1200 },
      costModels: [
        { id: 'a', name: 'Nike Air Force 1', keywords: 'air force, af1', category: 'Chaussures', price: 1500 },
        { id: 'b', name: 'Nike', keywords: '', category: '', price: 900 },
        { id: 'c', name: "Levi's 501", keywords: '', category: '', price: 600 },
      ],
    };
    expect(matchModel(s.costModels, 'Baskets Nike Air Force 1 blanches - Taille 42')?.id).toBe('a');
    expect(matchModel(s.costModels, 'AF1 low blanche')?.id).toBe('a');
    expect(matchModel(s.costModels, 'Sweat Nike vintage')?.id).toBe('b');
    expect(matchModel(s.costModels, 'Jean Levi’s 501 brut W32')?.id).toBe('c');
    expect(suggestCost(s, { title: 'Pull Ralph Lauren', category: 'Sweats et pulls' })).toEqual({ price: 700, source: 'categorie', label: 'Sweats et pulls' });
    expect(suggestCost(s, { title: 'Robe longue', category: 'Autres vêtements' })).toBeNull();
  });

  it('jamais rétroactif : changer un prix habituel ne touche ni le coût des articles ni le bénéfice des ventes', async () => {
    const mid = await saveCostModel({ name: 'Nike Air Force 1', price: 1500 });
    await setCategoryPrice('Sweats et pulls', 700);
    // achat pré-rempli avec le prix habituel (1500), vendu 4000
    const { itemIds } = await recordPurchase({ date: '2026-10-02', source: 'Vinted', commonFees: 0, lotPrice: null, lines: [{ name: 'Nike Air Force 1', category: 'Chaussures', price: 1500, targetPrice: 4000 }] });
    const saleId = await recordSale({ date: '2026-10-05', itemIds, listedPrice: 4000, discount: 0, sellerRevenue: 4000, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'recu' });
    const before = saleBreakdown(await loadDataset(), (await loadDataset()).sales[0]).profit;
    await saveCostModel({ id: mid, name: 'Nike Air Force 1', price: 3000 });
    await setCategoryPrice('Sweats et pulls', 1000);
    await deleteCostModel(mid);
    const ds = await loadDataset();
    expect(itemCost(ds.items[0])).toBe(1500);
    expect(saleBreakdown(ds, ds.sales.find((x) => x.id === saleId)!).profit).toBe(before);
    expect(checkBooks(ds, '2026-10-06').filter((c) => c.level === 'error')).toEqual([]);
  });

  it('article créé par la synchro : le prix proposé est enregistré comme un prix saisi, comptes justes', async () => {
    await setCategoryPrice('Sweats et pulls', 700);
    const { itemIds } = await recordPurchase({ date: '2026-10-02', source: 'Créé par la synchro Vinted', commonFees: 0, lotPrice: null, lines: [{ name: 'Sweat Nike', category: 'Sweats et pulls', price: 0, targetPrice: null, costPending: true }] });
    await recordSale({ date: '2026-10-03', itemIds, listedPrice: 2500, discount: 0, sellerRevenue: 2500, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'recu' });
    let ds = await loadDataset();
    const sug = suggestCost(ds.settings, { title: ds.items[0].name, category: ds.items[0].category })!;
    await completeItemCost(itemIds[0], sug.price);
    ds = await loadDataset();
    expect(itemCost(ds.items[0])).toBe(700);
    expect(saleBreakdown(ds, ds.sales[0]).profit).toBe(1800);
    expect(checkBooks(ds, '2026-10-04').filter((c) => c.level === 'error')).toEqual([]);
  });
});
