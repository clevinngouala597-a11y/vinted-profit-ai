import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, recordPurchase, recordSale, saveSettings } from '../src/lib/actions';
import { forecast, monthVsForecast, quantile, weeklyHistory } from '../src/lib/forecast';
import { addDays } from '../src/lib/period';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`fc-${++n}`));
  await saveSettings({ ...defaultSettings('2026-07-01'), onboarded: true, initialCash: 10000 });
});

async function sale(date: string, cost: number, revenue: number) {
  const { itemIds } = await recordPurchase({ date, source: 'x', commonFees: 0, lotPrice: null, lines: [{ name: 'A', category: 'T-shirts', price: cost, targetPrice: null }] });
  await recordSale({ date, itemIds, listedPrice: revenue, discount: 0, sellerRevenue: revenue, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'recu' });
}

describe('Prévisions', () => {
  it('quartiles', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([10, 20], 0.5)).toBe(15);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('refuse de prévoir sans historique suffisant', async () => {
    await sale('2026-10-20', 500, 1500);
    const ds = await loadDataset();
    const f = forecast(ds, '2026-10-26', 30);
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.reason).toMatch(/au moins 4 semaines/);
  });

  it('rythme régulier : les trois scénarios coïncident et se projettent linéairement', async () => {
    // 1 vente par semaine pendant 8 semaines : +10 € de bénéfice, +10 € de trésorerie par semaine
    for (let k = 0; k < 8; k++) await sale(addDays('2026-08-31', 7 * k), 500, 1500);
    const ds = await loadDataset();
    const f = forecast(ds, '2026-10-25', 30);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.weeks.length).toBe(8);
    const [p, c, o] = f.scenarios;
    // 30 jours = 30/7 semaines × 10 € = 42,86 €
    expect(c.profit).toBe(4286);
    expect(p.profit).toBe(c.profit);
    expect(o.profit).toBe(c.profit);
    expect(c.revenue).toBe(6429);
    expect(c.cashEnd).toBe(10000 + 8 * 1000 + 4286);
  });

  it('rythme irrégulier : prudent < central < optimiste', async () => {
    const amounts = [1000, 4000, 1500, 6000, 1200, 3000];
    for (let k = 0; k < amounts.length; k++) await sale(addDays('2026-09-14', 7 * k), 500, amounts[k]);
    const ds = await loadDataset();
    const f = forecast(ds, '2026-10-25', 90);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    const [p, c, o] = f.scenarios;
    expect(p.profit).toBeLessThan(c.profit);
    expect(c.profit).toBeLessThan(o.profit);
    expect(weeklyHistory(ds, '2026-10-25').length).toBe(6);
  });

  it('détecte un mois en dessous du rythme prévu', async () => {
    for (let k = 0; k < 8; k++) await sale(addDays('2026-08-03', 7 * k), 500, 3500);
    const ds = await loadDataset();
    const gap = monthVsForecast(ds, '2026-10-20');
    expect(gap).not.toBeNull();
    expect(gap!.actual).toBe(0);
    expect(gap!.expected).toBeGreaterThan(0);
  });
});
