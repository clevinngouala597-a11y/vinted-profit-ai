import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, recordExpense, saveSettings } from '../src/lib/actions';
import { periodMetrics, stockState } from '../src/lib/engine';
import { autoMap, commitArticles, commitExpenses, parseCSV, parseDate, validateArticles, validateExpenses } from '../src/lib/importer';
import { parseEuros } from '../src/lib/money';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`imp-${++n}`));
  await saveSettings({ ...defaultSettings('2026-01-01'), onboarded: true });
});

const TODAY = '2026-10-27';

describe('Lecture', () => {
  it('lit un CSV Excel français (point-virgule, guillemets, BOM)', () => {
    const rows = parseCSV('﻿Nom;Prix d\'achat;Notes\r\n"Sweat ""Nike""";5,00;"ligne1\nligne2"\r\n\r\nJean;12;\r\n');
    expect(rows).toEqual([["Nom", "Prix d'achat", 'Notes'], ['Sweat "Nike"', '5,00', 'ligne1\nligne2'], ['Jean', '12', '']]);
  });
  it('détecte la virgule comme séparateur', () => {
    expect(parseCSV('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('dates et montants usuels', () => {
    expect(parseDate('03/10/2026')).toBe('2026-10-03');
    expect(parseDate('3/10/26')).toBe('2026-10-03');
    expect(parseDate('2026-10-03')).toBe('2026-10-03');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseEuros('1.234,56 €')).toBe(123456);
    expect(parseEuros('1,234.56')).toBe(123456);
  });
  it('associe les colonnes automatiquement', () => {
    const m = autoMap('articles', ['Article', 'Marque', 'Date achat', 'Prix achat', 'Date de vente', 'Prix de vente', 'Taille']);
    expect(m).toMatchObject({ name: 0, brand: 1, purchaseDate: 2, purchasePrice: 3, saleDate: 4, salePrice: 5, size: 6 });
  });
});

describe('Import d’articles', () => {
  const csv = [
    'Article;Catégorie;Date achat;Prix achat;Date de vente;Prix de vente',
    'Sweat Nike;sweats;01/09/2026;5;10/09/2026;18',
    'Jean Levis;Jeans;02/09/2026;12,50;;',
    ';T-shirts;02/09/2026;3;;',
    'Veste;Vestes;bientôt;10;;',
    'Casquette;Accessoires;05/09/2026;2;01/09/2026;8',
    'Short;Shorts;05/09/2026;4;;9',
    'Sweat Nike;sweats;01/09/2026;5;;',
  ].join('\n');

  it('valide, rejette avec un motif et repère les doublons', async () => {
    const ds = await loadDataset();
    const rows = parseCSV(csv);
    const v = validateArticles(ds, rows.slice(1), autoMap('articles', rows[0]), 2, TODAY);
    expect(v.valid.map((r) => r.name)).toEqual(['Sweat Nike', 'Jean Levis']);
    expect(v.valid[0].category).toBe('Sweats et pulls');
    expect(v.valid[1].category).toBe('Pantalons et jeans');
    expect(v.rejected.map((r) => [r.line, r.reason.split(' (')[0]])).toEqual([
      [4, 'nom manquant'],
      [5, "date d'achat illisible"],
      [6, 'vendu avant d’avoir été acheté'],
      [7, 'montant de vente sans date de vente'],
    ]);
    expect(v.duplicates.map((d) => d.line)).toEqual([8]);
  });

  it('écrit achats et ventes avec les mêmes règles que la saisie', async () => {
    let ds = await loadDataset();
    const rows = parseCSV(csv);
    const v = validateArticles(ds, rows.slice(1), autoMap('articles', rows[0]), 2, TODAY);
    const res = await commitArticles(ds, v.valid, 'suivi.csv');
    expect(res).toMatchObject({ items: 2, sold: 1 });
    ds = await loadDataset();
    const m = periodMetrics(ds, '2026-09-01', '2026-09-30');
    expect(m.commercialProfit).toBe(1300);
    expect(m.purchases).toBe(1750);
    expect(stockState(ds, TODAY).count).toBe(1);
    expect(ds.sales[0].orderStatus).toBe('terminee');
    expect(ds.purchases[0].notes).toContain('suivi.csv');
    // un second import du même fichier ne crée rien en double
    const again = validateArticles(ds, rows.slice(1), autoMap('articles', rows[0]), 2, TODAY);
    expect(again.valid).toHaveLength(0);
    expect(again.duplicates).toHaveLength(3);
  });
});

describe('Import de dépenses', () => {
  it('rejette, détecte les doublons (fichier et base) et importe', async () => {
    await recordExpense({ date: '2026-09-01', amount: 500, category: 'Emballages', supplier: 'Action', description: '', saleId: null, attachmentId: null });
    let ds = await loadDataset();
    const rows = parseCSV('Date;Montant;Catégorie;Fournisseur\n01/09/2026;5,00;Emballages;Action\n02/09/2026;12;matériel photo;Amazon\n02/09/2026;12;Matériel photo;Amazon\n03/09/2026;-4;Autres;\n04/09/2026;7;Divers;');
    const v = validateExpenses(ds, rows.slice(1), autoMap('depenses', rows[0]), 2, TODAY);
    expect(v.valid.map((r) => r.line)).toEqual([3, 6]);
    expect(v.valid[0].category).toBe('Matériel photo');
    expect(v.valid[1].category).toBe('Autres dépenses');
    expect(v.duplicates.map((r) => r.line)).toEqual([2, 4]);
    expect(v.rejected.map((r) => r.line)).toEqual([5]);
    await commitExpenses(v.valid, 'depenses.csv');
    ds = await loadDataset();
    expect(ds.expenses).toHaveLength(3);
  });
});
