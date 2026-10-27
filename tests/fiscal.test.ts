import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { correctSale, defaultSettings, loadDataset, markPaymentReceived, recordPurchase, recordRefund, recordSale, saveSettings } from '../src/lib/actions';
import { dac7, declarationPeriods, fiscalSummary, receipts } from '../src/lib/fiscal';
import { receiptsBookTable } from '../src/lib/exports';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`fiscal-${++n}`));
  await saveSettings({ ...defaultSettings('2026-01-01'), onboarded: true });
});

async function sale(date: string, revenue: number, paid: 'recu' | 'en_attente' = 'recu') {
  const { itemIds } = await recordPurchase({ date, source: 'x', commonFees: 0, lotPrice: null, lines: [{ name: 'A', category: 'T-shirts', price: 100, targetPrice: null }] });
  return recordSale({ date, itemIds, listedPrice: revenue, discount: 0, sellerRevenue: revenue, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: paid });
}

describe('Recettes encaissées', () => {
  it('comptent à la date du paiement, remboursements et corrections compris', async () => {
    const s1 = await sale('2026-03-30', 2000, 'en_attente');
    await markPaymentReceived(s1, '2026-04-02'); // encaissé en avril
    const s2 = await sale('2026-04-10', 1500);
    await recordRefund({ saleId: s2, date: '2026-04-12', amount: 500, itemRecovered: false, extraCosts: 0 });
    await correctSale(s2, { sellerRevenue: 1600 }, 'vérifié');
    await sale('2026-04-20', 999, 'en_attente'); // non encaissé
    const ds = await loadDataset();
    expect(receipts(ds, '2026-03-01', '2026-03-31')).toBe(0);
    // 2000 + 1500 − 500 + 100 (correction) ; la correction est datée du jour → on prend toute l'année
    expect(receipts(ds, '2026-01-01', '2026-12-31')).toBe(3100);
    const book = receiptsBookTable(ds, null);
    expect(book.rows.map((r) => r[5])).toEqual(expect.arrayContaining([2000, 1500, -500, 100]));
    expect(book.rows).toHaveLength(4);
  });
});

describe('DAC7', () => {
  it('signale la transmission à partir de 30 ventes ou plus de 2 000 €', async () => {
    for (let i = 0; i < 29; i++) await sale('2026-05-01', 100);
    let ds = await loadDataset();
    expect(dac7(ds, 2026)).toEqual({ count: 29, amount: 2900, reportable: false });
    await sale('2026-05-02', 100);
    ds = await loadDataset();
    expect(dac7(ds, 2026).reportable).toBe(true);
  });
  it('2 000 € pile ne suffit pas, 2 000,01 € oui', async () => {
    await sale('2026-05-01', 200000);
    let ds = await loadDataset();
    expect(dac7(ds, 2026).reportable).toBe(false);
    await sale('2026-05-02', 1);
    ds = await loadDataset();
    expect(dac7(ds, 2026).reportable).toBe(true);
  });
});

describe('Estimations selon le statut', () => {
  it("particulier : aucune estimation, mais l'alerte achat-revente", async () => {
    await sale('2026-05-01', 10000);
    const ds = await loadDataset();
    const f = fiscalSummary(ds, 2026, '2026-10-27');
    expect(f.total).toBeNull();
    expect(f.social).toBeNull();
    expect(f.alerts.some((a) => a.rule === 'resaleTaxable')).toBe(true);
  });

  it('micro-entrepreneur : 12,3 % + 0,1 %, versement libératoire 1 % sur option', async () => {
    await saveSettings({ activityStatus: 'micro', declarationFrequency: 'trimestrielle', activityStart: '2026-01-01' });
    await sale('2026-02-10', 100000); // 1 000 €
    await sale('2026-05-10', 50000);
    let ds = await loadDataset();
    let f = fiscalSummary(ds, 2026, '2026-10-27');
    expect(f.receipts).toBe(150000);
    expect(f.social).toBe(18450); // 12,3 %
    expect(f.cfp).toBe(150); // 0,1 %
    expect(f.vl).toBe(0);
    expect(f.taxableBase).toBe(43500); // 29 % après abattement de 71 %
    const q = declarationPeriods(ds, 2026, '2026-10-27');
    expect(q.map((p) => p.receipts)).toEqual([100000, 50000, 0, 0]);
    expect(q.map((p) => p.closed)).toEqual([true, true, true, false]);

    await saveSettings({ versementLiberatoire: true });
    ds = await loadDataset();
    f = fiscalSummary(ds, 2026, '2026-10-27');
    expect(f.vl).toBe(1500);
    expect(f.taxableBase).toBeNull(); // l'impôt est déjà payé par le versement libératoire
  });

  it('déclaration mensuelle : une période par mois écoulé', async () => {
    await saveSettings({ activityStatus: 'micro', declarationFrequency: 'mensuelle' });
    const ds = await loadDataset();
    expect(declarationPeriods(ds, 2026, '2026-10-27')).toHaveLength(10);
  });
});

describe('Périodes et début d’activité', () => {
  it("ne liste pas les périodes antérieures au début d'activité", async () => {
    await saveSettings({ activityStatus: 'micro', declarationFrequency: 'trimestrielle', activityStart: '2026-08-15' });
    const ds = await loadDataset();
    expect(declarationPeriods(ds, 2026, '2026-10-27').map((p) => p.label)).toEqual(['3e trimestre 2026', '4e trimestre 2026']);
  });
});
