import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, getDb, setDb } from '../src/lib/db';
import {
  cancelSale,
  changeSaleStatus,
  correctItemCost,
  correctSale,
  defaultSettings,
  loadDataset,
  markPaymentReceived,
  recordExpense,
  recordPurchase,
  recordRefund,
  recordSale,
  saveSettings,
  spreadCost,
  spreadShares,
} from '../src/lib/actions';
import { itemCost, periodMetrics, splitPurchase } from '../src/lib/engine';
import { checkBooks, traceMetric, type Metric } from '../src/lib/ledger';
import { loadDemoData } from '../src/lib/demo';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`ledger-${++n}`));
  await saveSettings({ ...defaultSettings('2026-09-01'), onboarded: true });
});

const sale = (itemIds: string[], date: string, rev: number, fees = 0, paid = true) =>
  recordSale({ date, itemIds, listedPrice: rev, discount: 0, sellerRevenue: rev, platformFees: fees, packagingCost: 0, otherCosts: 0, paymentStatus: paid ? 'recu' : 'en_attente' });
const buy = async (name: string, price: number, date = '2026-09-05', target: number | null = null) =>
  (await recordPurchase({ date, source: 'Friperie', commonFees: 0, lotPrice: null, lines: [{ name, category: 'T-shirts', price, targetPrice: target }] })).itemIds[0];

/** Un historique varié : lot, ventes, paiement, corrections, remboursements, annulation, coût réparti. */
async function busyHistory() {
  const { itemIds: lot } = await recordPurchase({
    date: '2026-09-02', source: 'Vide-grenier', commonFees: 300, lotPrice: 3000, lotSplit: 'manuel',
    lines: [{ name: 'Veste', category: 'Vestes et manteaux', price: 1500, targetPrice: 4000 }, { name: 'Pull', category: 'Sweats et pulls', price: 1000, targetPrice: null }, { name: 'Bonnet', category: 'Accessoires', price: 500, targetPrice: null }],
  });
  const a = await buy('Jean Levi’s', 900, '2026-09-03', 3000);
  const b = await buy('Air Max', 2500, '2026-09-04', 6000);
  const c = await buy('Casquette', 300, '2026-09-04', 1400);
  const d = await buy('Polo', 600, '2026-09-06', 2200);
  await spreadCost({ itemIds: [lot[0], lot[1], a], amount: 450, label: 'Pressing', date: '2026-09-07', method: 'egal' });
  await correctItemCost(b, 2700, 0, 'Prix mal saisi');
  const s1 = await sale([lot[0]], '2026-09-10', 4000, 100);
  const s2 = await sale([a, lot[2]], '2026-09-12', 3600, 0, false);
  await correctSale(s2, { sellerRevenue: 3500, packagingCost: 80 }, 'Réduction accordée');
  await markPaymentReceived(s2, '2026-09-15');
  const s3 = await sale([b], '2026-09-14', 6000);
  await recordRefund({ saleId: s3, date: '2026-09-20', amount: 1500, itemRecovered: false, extraCosts: 0 });
  const s4 = await sale([c], '2026-09-16', 1400, 0, false);
  await cancelSale(s4, '2026-09-18');
  const s5 = await sale([d], '2026-09-18', 2200, 0, false);
  await recordRefund({ saleId: s5, date: '2026-09-22', amount: 2200, itemRecovered: true, extraCosts: 350 });
  const s6 = await sale([lot[1]], '2026-09-19', 2500);
  await changeSaleStatus(s6, 'remboursee', '2026-09-25');
  await changeSaleStatus(s6, 'terminee', '2026-09-26');
  await recordExpense({ date: '2026-09-09', amount: 1299, category: 'Emballages', supplier: 'Action', description: '', saleId: null, attachmentId: null });
  await recordExpense({ date: '2026-09-11', amount: 250, category: 'Frais de plateforme', supplier: 'Vinted', description: 'Boost', saleId: s1, attachmentId: null });
  return { lot, a, b, c, d, s1, s2, s3, s5 };
}

describe('comptabilité vérifiable', () => {
  it('chaque montant du bilan est exactement la somme de ses opérations sources', async () => {
    await busyHistory();
    const ds = await loadDataset();
    const m = periodMetrics(ds, '2026-09-01', '2026-09-30');
    for (const k of ['revenue', 'cogs', 'saleCosts', 'general', 'writeOff', 'purchases'] as Metric[]) {
      const t = traceMetric(ds, '2026-09-01', '2026-09-30', k);
      expect(t.total, k).toBe(m[k]);
      for (const r of t.rows) expect(r.src.id).toBeTruthy();
    }
    const rev = traceMetric(ds, '2026-09-01', '2026-09-30', 'revenue');
    // une vente de deux articles reste une seule ligne
    expect(rev.rows.filter((r) => r.src.saleId === rev.rows.find((x) => x.label.includes('plusieurs'))?.src.saleId)).toHaveLength(1);
    expect(rev.rows.some((r) => r.label.startsWith('Remboursement'))).toBe(true);
  });

  it('un historique normal passe tous les contrôles (corrections, remboursements, annulation, coût réparti)', async () => {
    await busyHistory();
    const checks = checkBooks(await loadDataset(), '2026-09-30');
    const bad = checks.filter((c) => c.level !== 'ok');
    expect(bad.map((c) => `${c.id}: ${c.refs.map((r) => r.detail).join(', ')}`)).toEqual([]);
  });

  it('les données d’exemple passent aussi tous les contrôles', async () => {
    await loadDemoData('2026-10-28');
    const checks = checkBooks(await loadDataset(), '2026-10-28');
    expect(checks.filter((c) => c.level === 'error')).toEqual([]);
  });

  it('détecte une incohérence introduite à la main, avec un lien vers l’opération', async () => {
    const h = await busyHistory();
    const db = getDb();
    // vente modifiée sans passer par l'appli : la trésorerie ne suit plus
    await db.sales.update(h.s1, { sellerRevenue: 4200 });
    // article dont le coût ne correspond plus à ses achats
    await db.items.update(h.c, { purchasePrice: 999 });
    // mouvement de trésorerie qui renvoie à une dépense supprimée
    const e = (await db.expenses.toArray())[0];
    await db.expenses.delete(e.id);
    const checks = checkBooks(await loadDataset(), '2026-09-30');
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by['sale-split'].level).toBe('error');
    expect(by['sale-split'].refs[0].to).toBe(`ventes/${h.s1}`);
    expect(by['item-cost'].level).toBe('error');
    expect(by['item-cost'].refs[0].to).toBe(`stock/${h.c}`);
    expect(by.orphans.level).toBe('error');
  });

  it('signale doublons, paiements en retard et écarts avec les e-mails Vinted', async () => {
    const a = await buy('Sweat Nike', 800);
    const b = await buy('Sweat Nike', 800);
    const s1 = await sale([a], '2026-09-10', 2500, 0, false);
    await sale([b], '2026-09-10', 2500, 0, false);
    const synced = [{ id: 'm1', kind: 'completed', date: '2026-09-12', title: 'Sweat Nike', event: { kind: 'completed', amount: 2400 }, status: 'applied' as const, ref: s1, note: '', createdAt: '', resolvedAt: null }];
    const checks = checkBooks(await loadDataset(), '2026-10-15', synced);
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by.duplicates.level).toBe('warn');
    expect(by.late.refs).toHaveLength(2);
    expect(by.emails.refs[0].detail).toContain('24,00');
  });
});

describe('lots et coûts répartis', () => {
  it('trois façons de répartir le prix d’un lot', () => {
    const lines = [{ price: 600, targetPrice: 3000 }, { price: 400, targetPrice: 1000 }];
    expect(splitPurchase(lines, 0, 1000, 'souhaite').map((x) => x.price)).toEqual([750, 250]);
    expect(splitPurchase(lines, 0, 1000, 'egal').map((x) => x.price)).toEqual([500, 500]);
    expect(splitPurchase(lines, 100, 1000, 'manuel')).toEqual([{ price: 600, fees: 60 }, { price: 400, fees: 40 }]);
  });

  it('lot « montant par article » : la somme doit faire le prix du lot', async () => {
    await expect(recordPurchase({ date: '2026-09-02', source: '', commonFees: 0, lotPrice: 1000, lotSplit: 'manuel', lines: [{ name: 'A', category: 'T-shirts', price: 600, targetPrice: null }, { name: 'B', category: 'T-shirts', price: 300, targetPrice: null }] }))
      .rejects.toThrow(/somme des parts/);
  });

  it('un coût réparti augmente le coût des articles et reste relié à son paiement', async () => {
    const a = await buy('A', 1000, '2026-09-02', 3000);
    const b = await buy('B', 3000, '2026-09-02', 1000);
    expect(spreadShares([{ purchasePrice: 1000, directFees: 0, targetPrice: 3000 }, { purchasePrice: 3000, directFees: 0, targetPrice: 1000 }], 400, 'cout')).toEqual([100, 300]);
    const pid = await spreadCost({ itemIds: [a, b], amount: 400, label: 'Réparation', date: '2026-09-08', method: 'prix' });
    const ds = await loadDataset();
    expect(itemCost(ds.items.find((i) => i.id === a)!)).toBe(1300);
    expect(itemCost(ds.items.find((i) => i.id === b)!)).toBe(3100);
    expect(ds.transactions.find((t) => t.refId === pid)!.amount).toBe(-400);
    // la correction du coût d'un article garde la part répartie
    await correctItemCost(a, 1200, 300, 'Erreur');
    await expect(correctItemCost(a, 1200, 100, 'Erreur')).rejects.toThrow(/coûts répartis/);
    expect(checkBooks(await loadDataset(), '2026-09-10').filter((c) => c.level !== 'ok')).toEqual([]);
    // un article vendu ne peut plus recevoir de coût
    await sale([b], '2026-09-09', 5000);
    await expect(spreadCost({ itemIds: [b], amount: 100, label: 'X', date: '2026-09-10', method: 'egal' })).rejects.toThrow(/plus en stock/);
  });
});

describe('invendus', () => {
  it('argent immobilisé, ancienneté, articles qui dorment et marges à plusieurs prix', async () => {
    const { unsoldAnalysis } = await import('../src/lib/unsold');
    // historique : 3 ventes vendues en 10 jours, 1 € de frais chacune
    for (const k of [1, 2, 3]) {
      const id = await buy(`Vendu ${k}`, 500, '2026-09-01', 1500);
      await recordSale({ date: '2026-09-11', itemIds: [id], listedPrice: 1500, discount: 0, sellerRevenue: 1500, platformFees: 0, packagingCost: 100, otherCosts: 0, paymentStatus: 'recu' });
    }
    await buy('Récent', 1000, '2026-10-20', 3000);
    await buy('Vieux', 2000, '2026-08-01', 5000);
    const a = unsoldAnalysis(await loadDataset(), '2026-10-28');
    expect(a.count).toBe(2);
    expect(a.capital).toBe(3000);
    expect(a.avgSaleCost).toBe(100);
    expect(a.medianDaysToSell).toBe(10);
    expect(a.dormantCount).toBe(1);
    expect(a.items[0].item.name).toBe('Vieux');
    expect(a.items[0].age).toBe(88);
    expect(a.buckets.map((b) => b.count)).toEqual([1, 0, 1, 0]);
    const s = Object.fromEntries(a.items[0].scenarios.map((x) => [x.key, x]));
    expect(s.souhaite).toMatchObject({ price: 5000, profit: 2900, margin: 58 });
    expect(s['-20']).toMatchObject({ price: 4000, profit: 1900 });
    expect(s.equilibre).toMatchObject({ price: 2100, profit: 0 });
    expect(a.potential).toBe(5000 - 2100 + 3000 - 1100);
  });
});

describe('exports personnalisés et dressings', () => {
  it('écritures : la somme de chaque colonne est le montant du bilan ; un dressing filtre tous les tableaux', async () => {
    const { buildCustomTables, shopComparison } = await import('../src/lib/customExports');
    const { addShop } = await import('../src/lib/shopActions');
    await busyHistory();
    const shop = await addShop('Vintage', 'clevin.vintage');
    const v = (await recordPurchase({ date: '2026-09-03', source: 'Vinted', commonFees: 0, lotPrice: null, shop, lines: [{ name: 'Veste vintage', category: 'Vestes et manteaux', price: 1000, targetPrice: 3000 }] })).itemIds[0];
    await sale([v], '2026-09-20', 3000);
    const ds = await loadDataset();
    const range = { from: '2026-09-01', to: '2026-09-30' };
    const [ecr] = buildCustomTables(ds, { tables: ['ecritures'], range, shop: 'all', today: '2026-09-30' });
    const col = (k: number) => ecr.rows.reduce((a, r) => a + (r[k] as number), 0);
    const m = periodMetrics(ds, range.from, range.to);
    expect([col(5), col(6), col(7), col(8), col(9)]).toEqual([m.revenue, m.cogs, m.saleCosts, m.general, m.writeOff]);
    expect(col(10)).toBe(m.result);
    const only = buildCustomTables(ds, { tables: ['ventes', 'invendus'], range, shop, today: '2026-09-30' });
    expect(only[0].rows).toHaveLength(1);
    expect(only[0].filters).toMatch(/Vintage/);
    const cmp = shopComparison(ds, range, '2026-09-30');
    expect(cmp.map((r) => r.name)).toEqual(['Mon dressing', 'Vintage', 'Total']);
    expect(cmp[0].revenue + cmp[1].revenue).toBe(cmp[2].revenue);
    expect(cmp[1].profit).toBe(2000);
  });
});
