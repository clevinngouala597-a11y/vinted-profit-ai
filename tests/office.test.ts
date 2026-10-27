import 'fake-indexeddb/auto';
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, recordExpense, recordPurchase, recordSale, saveGoal, saveSettings } from '../src/lib/actions';
import { expensesTable, monthlyTable, salesTable, toCSV } from '../src/lib/exports';
import { buildMonthlyPdf, buildWorkbook } from '../src/lib/office';
import type { Dataset } from '../src/lib/types';

let ds: Dataset;
const R = { from: '2026-10-01', to: '2026-10-31' };
beforeAll(async () => {
  setDb(new VPDatabase('office'));
  await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, businessName: 'Test Resell', initialCash: 20000 });
  const { itemIds } = await recordPurchase({ date: '2026-10-03', source: 'Friperie', commonFees: 200, lotPrice: null, lines: [
    { name: 'Sweat Nike', category: 'Sweats et pulls', brand: 'Nike', price: 500, targetPrice: 1800 },
    { name: 'Jean Levi’s 501', category: 'Pantalons et jeans', brand: "Levi's", price: 1200, targetPrice: 3000 },
  ] });
  await recordSale({ date: '2026-10-08', itemIds: [itemIds[0]], listedPrice: 1800, discount: 0, sellerRevenue: 1800, platformFees: 0, packagingCost: 50, otherCosts: 0, paymentStatus: 'recu' });
  await recordExpense({ date: '2026-10-09', amount: 1234, category: 'Matériel photo', supplier: 'Action', description: 'Lampe', saleId: null, attachmentId: null });
  await saveGoal('2026-10', { revenue: 0, profit: 5000, salesCount: 4, minMargin: 0, maxPurchases: 0, maxStockCount: 0, cashToKeep: 0 });
  ds = await loadDataset();
});

describe('Excel', () => {
  it('écrit de vrais nombres en euros, des dates et des totaux', async () => {
    const months = [{ label: 'septembre 2026', range: { from: '2026-09-01', to: '2026-09-30' } }, { label: 'octobre 2026', range: R }];
    const blob = await buildWorkbook([monthlyTable(ds, months), salesTable(ds, R), expensesTable(ds, R)]);
    const buf = Buffer.from(await blob.arrayBuffer());
    writeFileSync(process.env.OUT_DIR ? `${process.env.OUT_DIR}/test.xlsx` : '/dev/null', buf);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Rapport mensuel', 'Ventes', 'Dépenses', 'Définitions']);

    const sales = wb.getWorksheet('Ventes')!;
    const header = sales.getRows(1, sales.rowCount)!.find((r) => r.getCell(1).value === 'Date')!;
    const data = sales.getRow(header.number + 1);
    expect(data.getCell(1).value).toBeInstanceOf(Date);
    expect(data.getCell(7).value).toBe(18); // montant encaissé : nombre, pas texte
    expect(data.getCell(7).numFmt).toContain('€');
    // coût de revient : 5 € + part des 2 € de frais (au prorata 500/1700) = 5,59 €
    expect(data.getCell(9).value).toBe(5.59);
    expect(data.getCell(11).value).toBe(18 - 5.59 - 0.5);
    expect(data.getCell(12).value).toBeCloseTo(0.6617, 4); // marge en fraction, affichée en %
    const total = sales.getRow(header.number + 2);
    expect(total.getCell(1).value).toBe('Total');
    expect((total.getCell(7).value as { formula: string }).formula).toBe(`SUM(G${header.number + 1}:G${header.number + 1})`);

    const monthly = wb.getWorksheet('Rapport mensuel')!;
    const profitRow = monthly.getRows(1, monthly.rowCount)!.find((r) => r.getCell(1).value === 'Bénéfice commercial')!;
    expect(profitRow.getCell(3).value).toBe(11.91);
    const soldRow = monthly.getRows(1, monthly.rowCount)!.find((r) => r.getCell(1).value === 'Articles vendus')!;
    expect(soldRow.getCell(3).value).toBe(1);
  });

  it('CSV et Excel partagent les mêmes chiffres', () => {
    const csv = toCSV(salesTable(ds, R));
    expect(csv).toContain('18,00');
    expect(csv).toContain('11,91');
  });
});

describe('PDF', () => {
  it('génère un bilan mensuel', async () => {
    const blob = buildMonthlyPdf(ds, '2026-10');
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(3000);
    if (process.env.OUT_DIR) writeFileSync(`${process.env.OUT_DIR}/bilan.pdf`, buf);
  });
});
