import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import {
  cancelSale,
  changeItemStatus,
  correctItemCost,
  defaultSettings,
  findDuplicateExpenses,
  loadDataset,
  markItemRecovered,
  markPaymentReceived,
  recordExpense,
  recordPurchase,
  recordRefund,
  recordSale,
  saveSettings,
} from '../src/lib/actions';
import {
  cashState,
  estimate,
  periodMetrics,
  reinvestment,
  saleBreakdown,
  splitPurchase,
  stockState,
} from '../src/lib/engine';
import { percent } from '../src/lib/money';

const D = '2026-10-10';
const FROM = '2026-10-01';
const TO = '2026-10-31';
let n = 0;

beforeEach(async () => {
  setDb(new VPDatabase(`test-${++n}`));
  await saveSettings({ ...defaultSettings(D), onboarded: true });
});

async function buyOne(price: number, fees = 0, extra: { targetPrice?: number | null; name?: string } = {}) {
  const { itemIds } = await recordPurchase({
    date: D,
    source: 'Friperie',
    commonFees: fees,
    lotPrice: null,
    lines: [{ name: extra.name ?? 'Sweat', category: 'Sweats et pulls', price, targetPrice: extra.targetPrice ?? null }],
  });
  return itemIds[0];
}

const sell = (itemIds: string[], sellerRevenue: number, costs = 0, paymentStatus: 'recu' | 'en_attente' = 'recu') =>
  recordSale({
    date: D,
    itemIds,
    listedPrice: sellerRevenue,
    discount: 0,
    sellerRevenue,
    platformFees: 0,
    packagingCost: costs,
    otherCosts: 0,
    paymentStatus,
  });

describe('Cas A — vente rentable', () => {
  it('calcule coût, bénéfice, marge et ROI', async () => {
    const e = estimate({ purchasePrice: 500, directFees: 100, sellerRevenue: 1800, sellerCosts: 0 });
    expect(e.cost).toBe(600);
    expect(e.profit).toBe(1200);
    expect(e.margin).toBe(66.67);
    expect(e.roi).toBe(200);

    const id = await buyOne(500, 100);
    const saleId = await sell([id], 1800);
    const ds = await loadDataset();
    const b = saleBreakdown(ds, ds.sales.find((s) => s.id === saleId)!);
    expect(b.cogs).toBe(600);
    expect(b.profit).toBe(1200);
    expect(b.margin).toBe(66.67);
    expect(b.roi).toBe(200);
    expect(b.isLoss).toBe(false);
  });
});

describe('Cas B — vente à perte', () => {
  it('détecte la perte', async () => {
    const id = await buyOne(2000, 200);
    const saleId = await sell([id], 1500, 100);
    const ds = await loadDataset();
    const b = saleBreakdown(ds, ds.sales.find((s) => s.id === saleId)!);
    expect(b.cogs).toBe(2200);
    expect(b.profit).toBe(-800);
    expect(b.isLoss).toBe(true);
  });
});

describe('Cas C — stock invendu', () => {
  it('valorise le stock sans créer de bénéfice', async () => {
    await buyOne(1000, 0, { targetPrice: 3000 });
    const ds = await loadDataset();
    const st = stockState(ds, D);
    const m = periodMetrics(ds, FROM, TO);
    expect(st.costValue).toBe(1000);
    expect(st.potentialProfit).toBe(2000);
    expect(m.revenue).toBe(0);
    expect(m.commercialProfit).toBe(0);
    expect(m.result).toBe(0);
  });
});

describe('Cas D — pas de double comptabilisation', () => {
  it("impute l'achat une seule fois", async () => {
    const id = await buyOne(1000);
    await sell([id], 2500);
    const ds = await loadDataset();
    const m = periodMetrics(ds, FROM, TO);
    expect(m.purchases).toBe(1000); // visible comme achat de stock…
    expect(m.cogs).toBe(1000); // …imputé une fois via l'article vendu
    expect(m.general).toBe(0); // …et jamais en frais généraux
    expect(m.commercialProfit).toBe(1500);
    expect(m.result).toBe(1500);
    expect(stockState(ds, D).count).toBe(0);
  });
});

describe('Cas E — remboursement', () => {
  it('remboursement total avec retour : vente conservée, stock restauré à la récupération', async () => {
    const id = await buyOne(1000);
    const saleId = await sell([id], 2500, 200);
    const refundId = await recordRefund({ saleId, date: D, amount: 2500, itemRecovered: false, extraCosts: 0 });
    let ds = await loadDataset();
    expect(ds.sales).toHaveLength(1); // la vente reste consultable
    expect(stockState(ds, D).count).toBe(0); // pas encore récupéré
    expect(cashState(ds).balance).toBe(-1000 + 2500 - 200 - 2500);

    await markItemRecovered(refundId, D);
    ds = await loadDataset();
    expect(stockState(ds, D).count).toBe(1);
    expect(ds.items[0].status).toBe('retourne');
    const b = saleBreakdown(ds, ds.sales[0]);
    expect(b.netRevenue).toBe(0);
    expect(b.cogs).toBe(0); // coût repris en stock
    expect(b.profit).toBe(-200); // l'emballage n'est pas récupérable
    const m = periodMetrics(ds, FROM, TO);
    expect(m.commercialProfit).toBe(-200);
    expect(m.itemsSold).toBe(0);
    // remboursement en double refusé
    await expect(recordRefund({ saleId, date: D, amount: 1, itemRecovered: false, extraCosts: 0 })).rejects.toThrow();
  });

  it('remboursement partiel sans retour', async () => {
    const id = await buyOne(1000);
    const saleId = await sell([id], 2500);
    await recordRefund({ saleId, date: D, amount: 500, itemRecovered: false, extraCosts: 0 });
    const ds = await loadDataset();
    const b = saleBreakdown(ds, ds.sales[0]);
    expect(b.netRevenue).toBe(2000);
    expect(b.profit).toBe(1000);
    expect(ds.sales[0].orderStatus).toBe('confirmee');
  });
});

describe('Cas F — trésorerie et stock', () => {
  it('ne confond pas bénéfice et trésorerie', async () => {
    await saveSettings({ initialCash: 5000 });
    const id = await buyOne(1500);
    const saleId = await sell([id], 3000, 200, 'en_attente');
    let ds = await loadDataset();
    expect(periodMetrics(ds, FROM, TO).commercialProfit).toBe(1300);
    let cash = cashState(ds);
    expect(cash.balance).toBe(5000 - 1500 - 200); // le paiement n'est pas encore reçu
    expect(cash.pendingIn).toBe(3000);
    expect(stockState(ds, D).count).toBe(0);

    await markPaymentReceived(saleId, D);
    ds = await loadDataset();
    cash = cashState(ds);
    expect(cash.balance).toBe(5000 - 1500 - 200 + 3000);
    expect(cash.pendingIn).toBe(0);
  });
});

describe('Ventes groupées et lots', () => {
  it('répartit le revenu au prorata des prix souhaités, sans perte de centime', async () => {
    const { itemIds } = await recordPurchase({
      date: D,
      source: 'Lot',
      commonFees: 100,
      lotPrice: 1000,
      lines: [
        { name: 'Jean', category: 'Pantalons et jeans', price: null, targetPrice: 2000 },
        { name: 'T-shirt', category: 'T-shirts', price: null, targetPrice: 1000 },
        { name: 'Casquette', category: 'Accessoires', price: null, targetPrice: 1000 },
      ],
    });
    let ds = await loadDataset();
    const costs = itemIds.map((id) => ds.items.find((i) => i.id === id)!);
    expect(costs.map((i) => i.purchasePrice)).toEqual([500, 250, 250]);
    expect(costs.reduce((a, i) => a + i.purchasePrice + i.directFees, 0)).toBe(1100);

    await recordSale({
      date: D, itemIds: itemIds.slice(0, 2), listedPrice: 2701, discount: 0, sellerRevenue: 2701,
      platformFees: 0, packagingCost: 101, otherCosts: 0, paymentStatus: 'recu',
    });
    ds = await loadDataset();
    const lines = ds.saleLines;
    expect(lines.reduce((a, l) => a + l.revenue, 0)).toBe(2701);
    expect(lines.reduce((a, l) => a + l.costs, 0)).toBe(101);
    const m = periodMetrics(ds, FROM, TO);
    expect(m.itemsSold).toBe(2);
    expect(m.commercialProfit).toBe(2701 - (550 + 275) - 101);
    expect(stockState(ds, D).count).toBe(1);
  });

  it('répartit les frais communs à parts égales si tous les prix sont nuls', () => {
    expect(splitPurchase([{ price: 0, targetPrice: null }, { price: 0, targetPrice: null }], 101, null)).toEqual([
      { price: 0, fees: 51 },
      { price: 0, fees: 50 },
    ]);
  });
});

describe('Règles et cas limites', () => {
  it('refuse de vendre deux fois le même article', async () => {
    const id = await buyOne(1000);
    await sell([id], 2000);
    await expect(sell([id], 2000)).rejects.toThrow(/pas disponible/);
  });

  it('montants nuls : pourcentages non applicables', async () => {
    const id = await buyOne(0);
    await sell([id], 0);
    const ds = await loadDataset();
    const b = saleBreakdown(ds, ds.sales[0]);
    expect(b.profit).toBe(0);
    expect(b.margin).toBeNull();
    expect(b.roi).toBeNull();
    expect(percent(0, 0)).toBeNull();
  });

  it('une dépense liée à une vente n’est pas comptée en frais généraux', async () => {
    const id = await buyOne(1000);
    const saleId = await sell([id], 3000);
    await recordExpense({ date: D, amount: 300, category: 'Emballages', supplier: '', description: 'Carton', saleId, attachmentId: null });
    await recordExpense({ date: D, amount: 1200, category: 'Matériel photo', supplier: '', description: 'Lampe', saleId: null, attachmentId: null });
    const ds = await loadDataset();
    const m = periodMetrics(ds, FROM, TO);
    expect(m.saleCosts).toBe(300);
    expect(m.general).toBe(1200);
    expect(m.commercialProfit).toBe(3000 - 1000 - 300);
    expect(m.result).toBe(3000 - 1000 - 300 - 1200);
    expect(saleBreakdown(ds, ds.sales[0]).profit).toBe(1700);
  });

  it('annuler une vente remet l’article en vente et annule l’encaissement', async () => {
    const id = await buyOne(1000);
    const saleId = await sell([id], 2000, 0, 'en_attente');
    await cancelSale(saleId, D);
    const ds = await loadDataset();
    expect(ds.items[0].status).toBe('en_vente');
    expect(cashState(ds).pendingIn).toBe(0);
    expect(periodMetrics(ds, FROM, TO).revenue).toBe(0);
    expect(ds.sales).toHaveLength(1);
  });

  it('article perdu : sortie de stock comptée en perte, pas en coût des ventes', async () => {
    const id = await buyOne(800);
    await changeItemStatus(id, 'perdu', D);
    const ds = await loadDataset();
    const m = periodMetrics(ds, FROM, TO);
    expect(stockState(ds, D).count).toBe(0);
    expect(m.writeOff).toBe(800);
    expect(m.commercialProfit).toBe(0);
    expect(m.result).toBe(-800);
  });

  it('refuse une transition de statut incohérente', async () => {
    const id = await buyOne(800);
    await expect(changeItemStatus(id, 'termine', D)).rejects.toThrow(/impossible/);
  });

  it('correction du coût tracée avec ajustement de trésorerie', async () => {
    const id = await buyOne(1000);
    await correctItemCost(id, 1200, 0, 'Erreur de saisie');
    const ds = await loadDataset();
    expect(ds.items[0].purchasePrice).toBe(1200);
    expect(cashState(ds).balance).toBe(-1200);
    expect(ds.purchases[0].itemsTotal).toBe(1200);
  });

  it('change de période sans mélanger les mois', async () => {
    const id = await buyOne(1000);
    await recordSale({
      date: '2026-11-02', itemIds: [id], listedPrice: 2000, discount: 0, sellerRevenue: 2000,
      platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'recu',
    });
    const ds = await loadDataset();
    expect(periodMetrics(ds, FROM, TO).revenue).toBe(0);
    expect(periodMetrics(ds, '2026-11-01', '2026-11-30').commercialProfit).toBe(1000);
  });

  it('détecte les dépenses en double', () => {
    const base = { id: 'x', date: D, amount: 500, category: 'Emballages', supplier: 'Action', description: '', saleId: null, attachmentId: null, validated: true, createdAt: '' };
    expect(findDuplicateExpenses([base], { amount: 500, date: '2026-10-11', supplier: 'action', category: 'Autres dépenses' })).toHaveLength(1);
    expect(findDuplicateExpenses([base], { amount: 501, date: D, supplier: 'Action', category: 'Emballages' })).toHaveLength(0);
  });

  it('réinvestissement plafonné par la trésorerie moins la réserve', async () => {
    await saveSettings({ initialCash: 10000, safetyReserve: 3000, reinvestPct: 50 });
    const ds = await loadDataset();
    const cash = cashState(ds);
    expect(reinvestment(ds, cash, 4000)).toEqual({ available: 7000, planned: 2000 });
    expect(reinvestment(ds, cash, -500).planned).toBe(0);
    expect(reinvestment(ds, cash, 100000).planned).toBe(7000);
  });
});
