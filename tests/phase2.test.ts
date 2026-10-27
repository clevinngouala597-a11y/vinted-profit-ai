import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { correctSale, defaultSettings, loadDataset, recordPurchase, recordRefund, recordSale, saveGoal, saveSettings } from '../src/lib/actions';
import { cashState, goalFor, goalProgress, periodMetrics, saleBreakdown } from '../src/lib/engine';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`p2-${++n}`));
  await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, initialCash: 10000, monthlyProfitGoal: 5000 });
});

async function buySell(date: string, price: number, revenue: number, paid: 'recu' | 'en_attente' = 'recu', packaging = 0) {
  const { itemIds } = await recordPurchase({ date, source: 'x', commonFees: 0, lotPrice: null, lines: [{ name: 'Article', category: 'T-shirts', price, targetPrice: null }] });
  return recordSale({ date, itemIds, listedPrice: revenue, discount: 0, sellerRevenue: revenue, platformFees: 0, packagingCost: packaging, otherCosts: 0, paymentStatus: paid });
}

const G = { revenue: 0, profit: 0, salesCount: 0, minMargin: 0, maxPurchases: 0, maxStockCount: 0, cashToKeep: 0 };

describe('Objectifs', () => {
  it("reprend l'objectif des réglages tant qu'aucun objectif mensuel n'existe", async () => {
    const ds = await loadDataset();
    expect(goalFor(ds, '2026-10').profit).toBe(5000);
    expect(goalFor(ds, '2026-10').inherited).toBe(true);
  });

  it('modifier un mois ne change pas les mois passés', async () => {
    await saveGoal('2026-09', { ...G, profit: 3000 });
    await saveGoal('2026-11', { ...G, profit: 8000 });
    const ds = await loadDataset();
    expect(goalFor(ds, '2026-09').profit).toBe(3000);
    expect(goalFor(ds, '2026-10').profit).toBe(3000); // hérite du dernier mois renseigné
    expect(goalFor(ds, '2026-11').profit).toBe(8000);
    expect(goalFor(ds, '2026-12').profit).toBe(8000);
  });

  it('progression, reste à faire et estimation de fin de mois', async () => {
    await saveGoal('2026-10', { ...G, profit: 6000, salesCount: 10, maxPurchases: 5000, minMargin: 50 });
    await buySell('2026-10-02', 1000, 3000);
    await buySell('2026-10-05', 1000, 3000);
    const ds = await loadDataset();
    const p = goalProgress(ds, '2026-10', '2026-10-10');
    const profit = p.lines.find((l) => l.key === 'profit')!;
    expect(profit.current).toBe(4000);
    expect(profit.remaining).toBe(2000);
    expect(profit.projection).toBe(12400); // 4000 / 10 j × 31 j
    expect(profit.status).toBe('en_cours');
    const sales = p.lines.find((l) => l.key === 'salesCount')!;
    expect(sales.projection).toBe(6); // 2 / 10 × 31 = 6,2 → 6
    expect(sales.status).toBe('en_retard');
    const buy = p.lines.find((l) => l.key === 'maxPurchases')!;
    expect(buy.current).toBe(2000);
    expect(buy.remaining).toBe(3000);
    expect(buy.status).toBe('respecte');
    expect(p.lines.find((l) => l.key === 'minMargin')!.status).toBe('atteint'); // 66,67 %
  });

  it("pas d'estimation avant le 7e jour", async () => {
    await saveGoal('2026-10', { ...G, profit: 6000 });
    await buySell('2026-10-02', 1000, 3000);
    const ds = await loadDataset();
    expect(goalProgress(ds, '2026-10', '2026-10-05').lines[0].projection).toBeNull();
  });

  it('refuse des objectifs invalides', async () => {
    await expect(saveGoal('2026-10', { ...G, minMargin: 120 })).rejects.toThrow();
    await expect(saveGoal('2026-10', { ...G, salesCount: 2.5 })).rejects.toThrow();
  });
});

describe('Correction de vente', () => {
  it('paiement reçu : ajustement de trésorerie et répartition recalculée', async () => {
    const saleId = await buySell('2026-10-10', 1000, 3000);
    await correctSale(saleId, { sellerRevenue: 2600, packagingCost: 150 }, 'Montant réel vérifié');
    const ds = await loadDataset();
    const b = saleBreakdown(ds, ds.sales[0]);
    expect(b.profit).toBe(2600 - 1000 - 150);
    expect(ds.saleLines[0].revenue).toBe(2600);
    expect(ds.saleLines[0].costs).toBe(150);
    expect(cashState(ds).balance).toBe(10000 - 1000 + 3000 - 400 - 150);
    expect(ds.transactions.filter((t) => t.kind === 'ajustement')).toHaveLength(2);
    expect(ds.sales).toHaveLength(1);
  });

  it('paiement en attente : la somme attendue est corrigée sans mouvement en plus', async () => {
    const saleId = await buySell('2026-10-10', 1000, 3000, 'en_attente');
    await correctSale(saleId, { sellerRevenue: 3500 }, 'Erreur de saisie');
    const ds = await loadDataset();
    expect(cashState(ds).pendingIn).toBe(3500);
    expect(ds.transactions.filter((t) => t.kind === 'ajustement')).toHaveLength(0);
  });

  it('changement de date : la vente change de mois', async () => {
    const saleId = await buySell('2026-10-31', 1000, 3000);
    await correctSale(saleId, { date: '2026-11-01' }, 'Mauvaise date');
    const ds = await loadDataset();
    expect(periodMetrics(ds, '2026-10-01', '2026-10-31').revenue).toBe(0);
    expect(periodMetrics(ds, '2026-11-01', '2026-11-30').commercialProfit).toBe(2000);
    expect(ds.items[0].soldAt).toBe('2026-11-01');
  });

  it('refuse une correction sans raison ou sous le montant remboursé', async () => {
    const saleId = await buySell('2026-10-10', 1000, 3000);
    await expect(correctSale(saleId, { sellerRevenue: 2000 }, ' ')).rejects.toThrow(/raison/);
    await recordRefund({ saleId, date: '2026-10-11', amount: 2500, itemRecovered: false, extraCosts: 0 });
    await expect(correctSale(saleId, { sellerRevenue: 2000 }, 'test')).rejects.toThrow(/remboursé/);
  });
});

describe('Journal lisible', () => {
  it('transforme le JSON technique en phrase', async () => {
    const { humanDetails: h } = await import('../src/lib/journal');
    const humanDetails = (x: string) => h(x).replace(/[\u202f\u00a0]/g, ' ');
    expect(humanDetails('{"revenue":0,"profit":5000,"salesCount":5,"minMargin":0}')).toBe('bénéfice 50,00 €, ventes 5');
    expect(humanDetails('{"sellerRevenue":1800} → {"sellerRevenue":1600}. Raison : vérifié')).toBe('encaissé 18,00 € → encaissé 16,00 €. Raison : vérifié');
    expect(humanDetails('1 article(s), total 600 c')).toBe('1 article(s), total 6,00 €');
  });
});
