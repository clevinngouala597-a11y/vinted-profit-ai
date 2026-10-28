import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, getDb, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, recordExpense, recordPurchase, recordSale, saveSettings } from '../src/lib/actions';
import { cashState, periodMetrics } from '../src/lib/engine';
import { activeShop, ALL, defaultShopFor, extractPseudo, MAIN, scopeDataset, shopForPseudo, shopOf, shopsOf } from '../src/lib/shops';
import { addShop, deleteShop, setActiveShop, updateShop } from '../src/lib/shopActions';
import { ingestEmails, processPending } from '../src/lib/vinted/sync';
import type { RawEmail } from '../src/lib/vinted/parse';
import { checkPin, pinHash, shouldRelock } from '../src/lib/lock';
import { resolveTheme } from '../src/lib/theme';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`shops-${++n}`));
  await saveSettings({ ...defaultSettings(), onboarded: true, initialCash: 10000, trackingStart: '2026-01-01' });
});

const buy = (name: string, price: number, shop?: string) =>
  recordPurchase({ date: '2026-10-01', source: 'Friperie', commonFees: 0, lotPrice: null, shop, lines: [{ name, category: 'T-shirts', price, targetPrice: null, status: 'en_vente' }] });
const sell = (itemId: string, amount: number, date = '2026-10-05') =>
  recordSale({ date, itemIds: [itemId], listedPrice: amount, discount: 0, sellerRevenue: amount, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'recu' });
const oct = { from: '2026-10-01', to: '2026-10-31' };

describe('dressings', () => {
  it('un seul dressing tant qu’on n’en ajoute pas', async () => {
    const s = (await loadDataset()).settings;
    expect(shopsOf(s).map((x) => x.id)).toEqual([MAIN]);
    expect(activeShop(s)).toBe(ALL);
    expect(defaultShopFor(s)).toBe(MAIN);
  });

  it('chaque dressing a ses chiffres, et « Tous » en fait la somme', async () => {
    const b = await addShop('Dressing 2', '@clevin.vintage');
    const a1 = await buy('Veste', 1000);
    const b1 = await buy('Sweat', 500, b);
    await sell(a1.itemIds[0], 3000);
    await sell(b1.itemIds[0], 2000);
    await recordExpense({ date: '2026-10-06', amount: 300, category: 'Emballages', supplier: '', description: 'Sacs', saleId: null, attachmentId: null, shop: b });

    const ds = await loadDataset();
    // la vente prend le dressing de son article
    expect(ds.sales.map(shopOf).sort()).toEqual([b, MAIN].sort());
    expect(shopOf(ds.items.find((i) => i.name === 'Sweat'))).toBe(b);

    const all = periodMetrics(ds, oct.from, oct.to);
    const main = periodMetrics(scopeDataset(ds, MAIN), oct.from, oct.to);
    const two = periodMetrics(scopeDataset(ds, b), oct.from, oct.to);
    expect(main.revenue).toBe(3000);
    expect(two.revenue).toBe(2000);
    expect(all.revenue).toBe(main.revenue + two.revenue);
    expect(two.commercialProfit).toBe(1500);
    expect(main.commercialProfit + two.commercialProfit).toBe(all.commercialProfit);
    // trésorerie : le départ (100 €) appartient au principal ; le total reste juste
    const cAll = cashState(scopeDataset(ds, ALL), '2026-10-31').balance;
    const cMain = cashState(scopeDataset(ds, MAIN), '2026-10-31').balance;
    const cTwo = cashState(scopeDataset(ds, b), '2026-10-31').balance;
    expect(cTwo).toBe(2000 - 500 - 300);
    expect(cMain + cTwo).toBe(cAll);
  });

  it('les nouvelles saisies vont dans le dressing affiché', async () => {
    const b = await addShop('Dressing 2', 'deux');
    await setActiveShop(b);
    const { itemIds } = await buy('Jean', 800);
    const ds = await loadDataset();
    expect(activeShop(ds.settings)).toBe(b);
    expect(shopOf(ds.items.find((i) => i.id === itemIds[0]))).toBe(b);
    expect(shopOf(ds.purchases[0])).toBe(b);
  });

  it('supprimer un dressing remet ses données dans le principal', async () => {
    const b = await addShop('Dressing 2', 'deux');
    const { itemIds } = await buy('Sweat', 500, b);
    await sell(itemIds[0], 1500);
    await setActiveShop(b);
    await deleteShop(b);
    const ds = await loadDataset();
    expect(ds.sales.every((s) => shopOf(s) === MAIN)).toBe(true);
    expect(ds.items.every((i) => shopOf(i) === MAIN)).toBe(true);
    expect(shopsOf(ds.settings)).toHaveLength(1);
    expect(activeShop(ds.settings)).toBe(ALL);
    await expect(deleteShop(MAIN)).rejects.toThrow();
  });

  it('refuse un pseudo déjà utilisé', async () => {
    await addShop('A', 'pseudo1');
    await expect(addShop('B', '@Pseudo1')).rejects.toThrow(/déjà utilisé/);
    const b = await addShop('B', 'pseudo2');
    await expect(updateShop(b, { pseudo: 'pseudo1' })).rejects.toThrow(/déjà utilisé/);
  });

  it('la synchro range chaque e-mail dans le dressing de son pseudo', async () => {
    const b = await addShop('Dressing 2', 'clevin.vintage');
    const mail = (id: string, who: string, title: string, price: string): RawEmail => ({ id, date: '2026-10-10T10:00:00Z', subject: "Ton article s'est vendu !", text: `Bonjour ${who}, acheteur_${id} a acheté | ${title} ${price} € | Nous transférerons le paiement…` });
    const done = (id: string, who: string, title: string, amount: string): RawEmail => ({ id, date: '2026-10-14T10:00:00Z', subject: 'La transaction est finalisée', text: `Bonjour ${who}, Cette transaction est finalisée. La vente de ${title} a été réalisée avec succès. N° de Transaction : #2300000${id} | Montant de la commande : | ${amount} € | Viré sur ton compte Vinted : | ${amount} € |` });
    // même titre sur les deux comptes : chaque finalisation doit rester dans son dressing
    await ingestEmails([
      mail('s1', 'clevinnng', 'Polo Lacoste - Taille M', '20,00'),
      mail('s2', 'clevin.vintage', 'Polo Lacoste - Taille M', '25,00'),
      done('d2', 'clevin.vintage', 'Polo Lacoste - Taille M', '25,00'),
    ]);
    await processPending('2026-10-15');
    const ds = await loadDataset();
    const rows = await getDb().syncedEmails.toArray();
    expect(rows.find((r) => r.id === 's1')?.pseudo).toBe('clevinnng');
    expect(shopOf(rows.find((r) => r.id === 's2'))).toBe(b);
    const sMain = scopeDataset(ds, MAIN).sales;
    const sTwo = scopeDataset(ds, b).sales;
    expect(sMain).toHaveLength(1);
    expect(sTwo).toHaveLength(1);
    expect(sTwo[0].sellerRevenue).toBe(2500);
    expect(sTwo[0].orderStatus).toBe('terminee');
    expect(sMain[0].orderStatus).not.toBe('terminee');
    // l'article créé automatiquement est dans le bon dressing
    expect(scopeDataset(ds, b).items).toHaveLength(1);
  });

  it('lit le pseudo des e-mails', () => {
    expect(extractPseudo('Bonjour clevinnng, omidi a acheté…')).toBe('clevinnng');
    expect(extractPseudo('Bonjour a acheté Robe 80,00 €')).toBeNull();
    const s = { shops: [{ id: MAIN, name: 'Moi', pseudo: '' }, { id: 'x', name: 'B', pseudo: 'Clevin.Vintage' }] };
    expect(shopForPseudo(s, 'clevin.vintage')).toBe('x');
    expect(shopForPseudo(s, 'inconnu')).toBe(MAIN);
    expect(shopForPseudo(s, null)).toBe(MAIN);
  });
});

describe('verrouillage', () => {
  it('vérifie le code de secours sans le garder en clair', async () => {
    const h = await pinHash('4821');
    expect(h).not.toContain('4821');
    expect(await checkPin('4821', h)).toBe(true);
    expect(await checkPin('4822', h)).toBe(false);
    expect(await checkPin('12', h)).toBe(false);
    expect(await checkPin('4821', null)).toBe(false);
  });

  it('reverrouille après le délai choisi', () => {
    expect(shouldRelock(null, 10_000, 1)).toBe(false);
    expect(shouldRelock(0, 59_000, 1)).toBe(false);
    expect(shouldRelock(0, 60_000, 1)).toBe(true);
    expect(shouldRelock(0, 10, 0)).toBe(true);
  });
});

describe('apparence', () => {
  it('sombre par défaut, clair sur demande', () => {
    expect(resolveTheme(undefined)).toBe('dark');
    expect(resolveTheme('sombre')).toBe('dark');
    expect(resolveTheme('clair')).toBe('light');
    expect(resolveTheme('auto')).toBe('dark'); // pas de préférence système ici
  });
});
