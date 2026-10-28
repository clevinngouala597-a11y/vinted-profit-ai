/**
 * Données d'exemple (version bêta) : de quoi voir toute l'appli remplie en un toucher.
 * Les dates sont calculées à partir d'aujourd'hui, pour que l'exemple tombe toujours sur
 * le mois en cours et le mois précédent. Tout s'efface avec « Commencer avec mes données ».
 */
import { AUTO_ITEM_SOURCE, changeSaleStatus, defaultSettings, recordExpense, recordPurchase, recordSale, saveGoal, saveSettings, wipeAllData } from './actions';
import { getDb } from './db';
import type { ISODate } from './types';

type Line = [name: string, category: string, brand: string, size: string, cost: number, price: number];
const ITEMS: Line[] = [
  ['Veste Carhartt Detroit', 'Vestes et manteaux', 'Carhartt', 'L', 1800, 5500], ['Sweat Nike vintage', 'Sweats et pulls', 'Nike', 'M', 800, 2500],
  ["Jean Levi's 501", 'Pantalons et jeans', "Levi's", '32', 900, 3000], ['Polo Ralph Lauren', 'T-shirts', 'Ralph Lauren', 'M', 600, 2200],
  ['Doudoune The North Face', 'Vestes et manteaux', 'The North Face', 'M', 3500, 8500], ['Hoodie Champion', 'Sweats et pulls', 'Champion', 'L', 700, 2200],
  ['Air Max 90', 'Chaussures', 'Nike', '42', 2500, 6000], ['T-shirt Stüssy', 'T-shirts', 'Stüssy', 'L', 500, 2000],
  ['Pull Lacoste col V', 'Sweats et pulls', 'Lacoste', 'M', 900, 2800], ['Cargo Dickies', 'Pantalons et jeans', 'Dickies', '30', 800, 2400],
  ['Casquette New Era', 'Accessoires', 'New Era', 'TU', 300, 1400], ['Veste Adidas vintage', 'Vestes et manteaux', 'Adidas', 'L', 1000, 3500],
  ['Sacoche Lacoste', 'Sacs', 'Lacoste', 'TU', 600, 2000], ['Sweat Carhartt WIP', 'Sweats et pulls', 'Carhartt', 'M', 1100, 3200],
  ['Jogging Nike Tech', 'Pantalons et jeans', 'Nike', 'M', 1500, 4500], ['Chemise Tommy Hilfiger', 'Autres vêtements', 'Tommy Hilfiger', 'L', 500, 1800],
  ['Polaire Patagonia', 'Sweats et pulls', 'Patagonia', 'M', 1600, 4800], ['T-shirt Palace', 'T-shirts', 'Palace', 'M', 900, 3500],
];

const DAY = 86_400_000;
const shift = (d: ISODate, n: number): ISODate => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Remplit l'appli avec un exemple réaliste (≈ 2 mois de ventes). */
export async function loadDemoData(today: ISODate) {
  await wipeAllData();
  await saveSettings({ ...defaultSettings(), onboarded: true, demoData: true, initialCash: 20000, monthlyProfitGoal: 50000, minProfitPerItem: 500, trackingStart: shift(today, -90) });
  // une vente presque chaque jour sur les 55 derniers jours, un peu plus souvent récemment
  const ago = [54, 51, 49, 46, 43, 41, 38, 35, 33, 30, 28, 26, 24, 22, 20, 18, 16, 15, 13, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 0];
  for (const [k, n] of ago.entries()) {
    const [name, category, brand, size, cost, price] = ITEMS[k % ITEMS.length];
    const date = shift(today, -n);
    const { itemIds } = await recordPurchase({ date: shift(date, -(4 + (k * 7) % 25)), source: k % 3 ? 'Friperie' : 'Vinted', commonFees: 0, lotPrice: null,
      lines: [{ name, category, brand, size, price: cost, targetPrice: price, status: 'en_vente' }] });
    const sold = price - (k % 4 === 0 ? 300 : 0);
    const id = await recordSale({ date, itemIds, listedPrice: price, discount: price - sold, sellerRevenue: sold, platformFees: 0, packagingCost: 50, otherCosts: 0, paymentStatus: n >= 2 ? 'recu' : 'en_attente' });
    if (n >= 4) await changeSaleStatus(id, 'terminee', shift(date, 3));
    else if (n >= 1) await changeSaleStatus(id, 'expediee', shift(date, 1));
  }
  // articles en vente qui ne bougent pas (« À republier »)
  for (const [name, category, brand, size, cost, price] of [['Bomber Alpha Industries', 'Vestes et manteaux', 'Alpha Industries', 'L', 2000, 5500], ['Sweat Tommy Jeans', 'Sweats et pulls', 'Tommy Hilfiger', 'M', 700, 2600], ['Short Nike vintage', 'Shorts', 'Nike', 'M', 400, 1600]] as Line[])
    await recordPurchase({ date: shift(today, -23), source: 'Friperie', commonFees: 0, lotPrice: null, lines: [{ name, category, brand, size, price: cost, targetPrice: price, status: 'en_vente' }] });
  // ventes reçues par la synchro sans prix d'achat connu
  for (const [name, category, price, n] of [['Sweat Ralph Lauren bleu', 'Sweats et pulls', 3200, 1], ['Casquette Nike vintage', 'Accessoires', 1500, 2]] as const) {
    const { itemIds } = await recordPurchase({ date: shift(today, -n), source: AUTO_ITEM_SOURCE, commonFees: 0, lotPrice: null, lines: [{ name, category, price: 0, targetPrice: null, status: 'en_vente', costPending: true }] });
    await recordSale({ date: shift(today, -n), itemIds, listedPrice: price, discount: 0, sellerRevenue: price, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente' });
  }
  const exp = (n: number, amount: number, category: string, supplier: string, description: string) =>
    recordExpense({ date: shift(today, -n), amount, category, supplier, description, saleId: null, attachmentId: null });
  await exp(25, 1290, 'Emballages', 'Action', "Sacs d'envoi");
  await exp(16, 600, 'Déplacements', '', 'Essence friperie');
  await exp(8, 500, 'Nettoyage et entretien', '', 'Lessive et anti-bouloches');
  await exp(50, 990, 'Emballages', 'Action', "Sacs d'envoi");
  await saveGoal(today.slice(0, 7), { revenue: 80000, profit: 50000, salesCount: 25, minMargin: 50, maxPurchases: 30000, maxStockCount: 20, cashToKeep: 10000 });
  // bordereaux reçus par e-mail, à imprimer
  const now = new Date().toISOString();
  const label = (id: string, title: string, inDays: number, hour: string) => ({
    id, kind: 'label', date: today, title, status: 'applied' as const, ref: null, note: '', createdAt: now, resolvedAt: null,
    event: { kind: 'label', title, deadline: `${shift(today, inDays)}T${hour}`, carrier: 'Mondial Relay', tracking: null },
  });
  await getDb().syncedEmails.bulkPut([
    label('demo-l1', 'Jogging Nike Tech - Taille M', 1, '12:00'),
    label('demo-l2', 'Polaire Patagonia - Taille M', 2, '18:00'),
    label('demo-l3', 'T-shirt Palace - Taille M', 3, '09:00'),
  ]);
}

/** Efface l'exemple et revient à l'accueil de configuration. */
export async function leaveDemo() {
  await wipeAllData();
}
