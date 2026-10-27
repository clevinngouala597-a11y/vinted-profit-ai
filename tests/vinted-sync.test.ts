import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, getDb, setDb } from '../src/lib/db';
import { changeSaleStatus, completeItemCost, correctSale, deleteSale, updateItem, defaultSettings, loadDataset, recordPurchase, recordSale, saveSettings } from '../src/lib/actions';
import { cashState, periodMetrics, saleBreakdown } from '../src/lib/engine';
import { dismissSynced, fetchVintedEmails, guessCategory, resolveSale, syncNow, unpaidInboxSales } from '../src/lib/vinted/sync';
import type { RawEmail } from '../src/lib/vinted/parse';

// E-mails fictifs au format Vinted
const sold = (id: string, date: string, title: string, price: string): RawEmail => ({ id, date, subject: "Ton article s'est vendu !", text: `Bonjour vendeur42, acheteur_${id} a acheté | ${title} ${price} € | Nous transférerons le paiement…` });
const done = (id: string, date: string, title: string, amount: string): RawEmail => ({ id, date, subject: 'La transaction est finalisée', text: `Cette transaction est finalisée. La vente de ${title} a été réalisée avec succès. N° de Transaction : #2300000${id} | Montant de la commande : | ${amount} € | Viré sur ton compte Vinted : | ${amount} € |` });
const update = (id: string, date: string, title: string, body: string): RawEmail => ({ id, date, subject: `Commande mise à jour pour ${title}`, text: body });
const boost = (id: string, date: string): RawEmail => ({ id, date, subject: 'Articles boostés : ta facture', text: 'Tu as boosté 1 article. | Boost local de 3 jours (1 article) | 1,95 € | Total | 1,95 € |' });
const receipt = (id: string, date: string): RawEmail => ({ id, date, subject: 'Ton reçu pour la commande « Porte-clé cuir »', text: '| Vendeur | vendeuse.test | Commande | Porte-clé cuir | Montant payé | 3,70 € | Article | 1,00 € | Frais de port | 2,83 € |' });

let inbox: RawEmail[] = [];
const fakeScript = (async (url: string) => {
  const u = new URL(url);
  if (u.searchParams.get('token') !== 'SECRET') return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200 });
  return new Response(JSON.stringify({ messages: inbox }), { status: 200 });
}) as unknown as typeof fetch;

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`sync-${++n}`));
  inbox = [];
  await saveSettings({ ...defaultSettings('2026-09-01'), onboarded: true, initialCash: 10000, syncUrl: 'https://script.google.com/macros/s/abc/exec', syncToken: 'SECRET', autoRecord: false });
});

const buy = (name: string, price: number, date = '2026-09-05') =>
  recordPurchase({ date, source: 'Friperie', commonFees: 0, lotPrice: null, lines: [{ name, category: 'T-shirts', price, targetPrice: null, status: 'en_vente' }] });

describe('Synchronisation Gmail', () => {
  it('vente → expédition → paiement : tout est enregistré automatiquement', async () => {
    await buy('Robe longue rose à fleurs - Taille S', 1200);
    inbox = [
      sold('a', '2026-10-01T10:00:00Z', 'Robe longue rose à fleurs - Taille S', '80,00'),
      update('b', '2026-10-03T10:00:00Z', 'Robe longue rose à fleurs - Taille S', "Ton colis est en cours d'acheminement vers l'acheteur !"),
      done('c', '2026-10-08T10:00:00Z', 'Robe longue rose à fleurs - Taille S', '80,00'),
    ];
    const r = await syncNow(fakeScript, '2026-10-27');
    expect(r).toMatchObject({ read: 3, added: 3, applied: 3, inbox: 0 });
    const ds = await loadDataset();
    expect(ds.sales).toHaveLength(1);
    expect(ds.sales[0]).toMatchObject({ orderStatus: 'terminee', paymentStatus: 'recu', shippedAt: '2026-10-03', closedAt: '2026-10-08', sellerRevenue: 8000 });
    expect(saleBreakdown(ds, ds.sales[0]).profit).toBe(6800);
    expect(cashState(ds).balance).toBe(10000 - 1200 + 8000);
    expect(ds.items[0].listingRef).toBe('Robe longue rose à fleurs - Taille S');
    // une seconde synchro ne refait rien
    const again = await syncNow(fakeScript, '2026-10-27');
    expect(again).toMatchObject({ added: 0, applied: 0 });
    expect((await loadDataset()).sales).toHaveLength(1);
  });

  it('montant viré différent : la vente est corrigée et tracée', async () => {
    await buy('Veste coupe-vent - Taille L', 1000);
    inbox = [sold('a', '2026-10-01T10:00:00Z', 'Veste coupe-vent - Taille L', '65,00'), done('b', '2026-10-09T10:00:00Z', 'Veste coupe-vent - Taille L', '63,50')];
    await syncNow(fakeScript, '2026-10-27');
    const ds = await loadDataset();
    expect(ds.sales[0].sellerRevenue).toBe(6350);
    expect((await getDb().auditLogs.toArray()).some((l) => l.details.includes('Montant viré par Vinted'))).toBe(true);
  });

  it('annulation : l’article revient en vente', async () => {
    await buy('Chemise verte - Taille L', 800);
    inbox = [sold('a', '2026-10-01T10:00:00Z', 'Chemise verte - Taille L', '30,00'), update('b', '2026-10-02T10:00:00Z', 'Chemise verte - Taille L', "La transaction a été annulée. L'acheteur va recevoir un remboursement.")];
    await syncNow(fakeScript, '2026-10-27');
    const ds = await loadDataset();
    expect(ds.sales[0].orderStatus).toBe('annulee');
    expect(ds.items[0].status).toBe('en_vente');
    expect(periodMetrics(ds, '2026-10-01', '2026-10-31').revenue).toBe(0);
  });

  it('plusieurs articles identiques : le plus ancien part en premier', async () => {
    await buy('Montre argentée cadran CD', 500, '2026-09-02');
    await buy('Montre argentée cadran CD', 500, '2026-09-10');
    inbox = [sold('a', '2026-10-01T10:00:00Z', 'Montre argentée – cadran CD', '35,00')];
    await syncNow(fakeScript, '2026-10-27');
    const ds = await loadDataset();
    const soldItem = ds.items.find((i) => i.status === 'vendu')!;
    expect(soldItem.purchaseDate).toBe('2026-09-02');
  });

  it("article absent du stock : « À valider », puis la suite s'applique après validation", async () => {
    inbox = [
      sold('a', '2026-10-01T10:00:00Z', 'Sweat gris inrose - Taille L', '40,50'),
      done('b', '2026-10-06T10:00:00Z', 'Sweat gris inrose - Taille L', '40,50'),
    ];
    let r = await syncNow(fakeScript, '2026-10-27');
    expect(r).toMatchObject({ applied: 0, inbox: 1, waiting: 1 });
    const pending = await getDb().syncedEmails.where('status').equals('inbox').toArray();
    expect(pending[0].kind).toBe('sale');
    await resolveSale(pending[0].id, { newItem: { name: 'Sweat gris inrose', category: guessCategory('Sweat gris inrose'), cost: 600, purchaseDate: '2026-09-15' } });
    const ds = await loadDataset();
    expect(ds.items[0].category).toBe('Sweats et pulls');
    expect(ds.sales[0]).toMatchObject({ paymentStatus: 'recu', orderStatus: 'terminee' });
    expect(saleBreakdown(ds, ds.sales[0]).profit).toBe(4050 - 600);
    expect(await getDb().syncedEmails.where('status').anyOf('inbox', 'waiting').count()).toBe(0);
  });

  it('vente déjà saisie à la main : aucun doublon', async () => {
    const { itemIds } = await buy('Jogging gris léopard - Taille L', 700);
    await recordSale({ date: '2026-10-01', itemIds, listedPrice: 2900, discount: 0, sellerRevenue: 2900, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente' });
    inbox = [sold('a', '2026-10-01T10:00:00Z', 'Jogging gris léopard - Taille L', '29,00'), done('b', '2026-10-05T10:00:00Z', 'Jogging gris léopard - Taille L', '29,00')];
    await syncNow(fakeScript, '2026-10-27');
    const ds = await loadDataset();
    expect(ds.sales).toHaveLength(1);
    expect(ds.sales[0].paymentStatus).toBe('recu');
  });

  it('factures de boost et achats Vinted', async () => {
    inbox = [boost('a', '2026-10-03T10:00:00Z'), receipt('b', '2026-10-04T10:00:00Z')];
    await syncNow(fakeScript, '2026-10-27');
    const ds = await loadDataset();
    expect(ds.expenses[0]).toMatchObject({ amount: 195, category: 'Frais de plateforme', supplier: 'Vinted', description: 'Boost local de 3 jours (1 article)' });
    expect(ds.items[0]).toMatchObject({ name: 'Porte-clé cuir', category: 'Accessoires', purchasePrice: 100, directFees: 270 });
    expect(ds.purchases[0]).toMatchObject({ source: 'Vinted', itemsTotal: 100, commonFees: 270 });
  });

  it('e-mails antérieurs à la date de début ignorés ; élément écarté', async () => {
    await saveSettings({ syncSince: '2026-10-01' });
    inbox = [sold('a', '2026-09-20T10:00:00Z', 'Ancienne vente', '10,00'), sold('b', '2026-10-02T10:00:00Z', 'Inconnu', '10,00')];
    const r = await syncNow(fakeScript, '2026-10-27');
    expect(r).toMatchObject({ added: 1, inbox: 1 });
    const row = (await getDb().syncedEmails.where('status').equals('inbox').toArray())[0];
    await dismissSynced(row.id);
    expect(await getDb().syncedEmails.where('status').equals('inbox').count()).toBe(0);
  });

  it('erreurs claires : mauvaise clé, mauvaise adresse', async () => {
    await expect(fetchVintedEmails('https://script.google.com/macros/s/abc/exec', 'FAUX', '2026-10-01', fakeScript)).rejects.toThrow(/Clé secrète refusée/);
    await expect(fetchVintedEmails('https://exemple.com/x', 'SECRET', '2026-10-01', fakeScript)).rejects.toThrow(/script.google.com/);
  });
});

import vm from 'node:vm';
import { appsScriptSource, newSecret } from '../src/lib/vinted/appsScript';

describe('Article revendu plusieurs fois (annulations, remboursements)', () => {
  const T = 'Pantalon Sarouel Écru Drape à la Taille Style Bohème Chic - Taille L';

  it('chaque paiement va à la dernière vente ouverte ; les ventes sans paiement sont signalées', async () => {
    await saveSettings({ syncSince: '2026-07-01' });
    inbox = [
      sold('s1', '2026-07-31T06:15:00Z', T, '40,00'), // remboursée (aucun e-mail d'annulation)
      sold('s2', '2026-08-01T16:06:00Z', T, '35,00'), // remboursée
      sold('s3', '2026-08-06T20:38:00Z', T, '35,00'), // remboursée
      sold('s4', '2026-08-07T12:13:00Z', T, '35,00'),
      done('d4', '2026-08-13T15:28:00Z', T, '35,00'),
      sold('s5', '2026-08-22T12:58:00Z', T, '30,00'),
      done('d5', '2026-08-31T15:27:00Z', T, '30,00'),
      sold('s6', '2026-09-22T19:08:00Z', T, '36,00'),
      done('d6', '2026-09-29T16:55:00Z', T, '36,00'),
    ];
    const r = await syncNow(fakeScript, '2026-10-27');
    expect(r).toMatchObject({ applied: 0, inbox: 6, waiting: 3 });
    const rows = await getDb().syncedEmails.toArray();
    expect(unpaidInboxSales(rows, '2026-10-27').map((x) => x.id).sort()).toEqual(['s1', 's2', 's3']);

    // l'utilisateur écarte les 3 ventes remboursées, puis valide les autres (dans le désordre)
    await dismissSynced(['s1', 's2', 's3']);
    const item = { name: 'Pantalon sarouel écru', category: 'Pantalons et jeans', cost: 800, purchaseDate: '2026-07-20' };
    await resolveSale('s6', { newItem: item });
    await resolveSale('s4', { newItem: item });
    await resolveSale('s5', { newItem: item });

    const ds = await loadDataset();
    expect(ds.sales).toHaveLength(3);
    for (const s of ds.sales) expect(s).toMatchObject({ paymentStatus: 'recu', orderStatus: 'terminee' });
    const closed = Object.fromEntries(ds.sales.map((s) => [s.date, s.closedAt]));
    expect(closed).toEqual({ '2026-08-07': '2026-08-13', '2026-08-22': '2026-08-31', '2026-09-22': '2026-09-29' });
    expect(periodMetrics(ds, '2026-07-01', '2026-10-31').revenue).toBe(3500 + 3000 + 3600);
    expect(await getDb().syncedEmails.where('status').anyOf('inbox', 'waiting').count()).toBe(0);
  });

  it('annulée puis revendue : la 1re vente est annulée, la 2e est payée', async () => {
    await saveSettings({ syncSince: '2026-06-27' });
    const C = 'Chemise à carreaux verte style vintage Détails brandebourgs - Taille L';
    await buy(C, 600, '2026-06-20');
    inbox = [
      sold('a', '2026-07-01T10:00:00Z', C, '20,00'),
      update('b', '2026-07-03T15:17:00Z', C, "La transaction a été annulée. L'acheteur va recevoir un remboursement."),
      sold('c', '2026-07-12T21:40:00Z', C, '36,00'),
      update('d', '2026-07-13T18:27:00Z', C, "Ton colis est en cours d'acheminement vers l'acheteur !"),
      done('e', '2026-07-28T19:05:00Z', C, '36,00'),
    ];
    await syncNow(fakeScript, '2026-10-27');
    const ds = await loadDataset();
    const [first, second] = [...ds.sales].sort((x, y) => x.date.localeCompare(y.date));
    expect(first).toMatchObject({ orderStatus: 'annulee', cancelledAt: '2026-07-03' });
    expect(second).toMatchObject({ paymentStatus: 'recu', orderStatus: 'terminee', shippedAt: '2026-07-13', sellerRevenue: 3600 });
    expect(saleBreakdown(ds, second).profit).toBe(3000);
  });
});

describe('Mode automatique (sans « À valider »)', () => {
  const T = 'Pantalon Sarouel Écru Drape à la Taille Style Bohème Chic - Taille L';

  it('tout est enregistré seul : articles créés, ventes remboursées non comptées', async () => {
    await saveSettings({ autoRecord: true, syncSince: '2026-07-01' });
    inbox = [
      sold('s1', '2026-07-31T06:15:00Z', T, '40,00'), // remboursée, sans e-mail
      sold('s2', '2026-08-01T16:06:00Z', T, '35,00'), // remboursée, sans e-mail
      sold('s4', '2026-08-07T12:13:00Z', T, '35,00'),
      done('d4', '2026-08-13T15:28:00Z', T, '35,00'),
      sold('s5', '2026-08-22T12:58:00Z', T, '30,00'),
      done('d5', '2026-08-31T15:27:00Z', T, '30,00'),
      done('d0', '2026-07-05T10:00:00Z', 'Veste en jean brut à brandebourgs Y2K - Taille L', '30,00'), // vente d'avant la synchro
      sold('s9', '2026-10-04T00:32:00Z', 'Montre argentée homme/femme - cadran effet CD multicolore', '50,00'), // en cours (23 jours)
    ];
    const r = await syncNow(fakeScript, '2026-10-27');
    expect(r.inbox).toBe(0);
    let ds = await loadDataset();
    expect(ds.sales).toHaveLength(4);
    const byDate = Object.fromEntries(ds.sales.map((x) => [x.date, x]));
    expect(byDate['2026-08-07']).toMatchObject({ paymentStatus: 'recu', closedAt: '2026-08-13', sellerRevenue: 3500 });
    expect(byDate['2026-08-22']).toMatchObject({ paymentStatus: 'recu', closedAt: '2026-08-31', sellerRevenue: 3000 });
    expect(byDate['2026-07-05']).toMatchObject({ paymentStatus: 'recu', orderStatus: 'terminee', sellerRevenue: 3000 });
    expect(byDate['2026-10-04']).toMatchObject({ paymentStatus: 'en_attente', sellerRevenue: 5000 });
    expect(ds.items.filter((i) => i.costPending)).toHaveLength(4);
    expect(periodMetrics(ds, '2026-07-01', '2026-10-31').revenue).toBe(3500 + 3000 + 3000 + 5000);

    // prix d'achat indiqué après coup : bénéfice et trésorerie justes
    const pant = ds.items.find((i) => i.id === ds.saleLines.find((l) => l.saleId === byDate['2026-08-07'].id)!.itemId)!;
    const cashBefore = cashState(ds).balance;
    await completeItemCost(pant.id, 800);
    ds = await loadDataset();
    expect(saleBreakdown(ds, ds.sales.find((x) => x.date === '2026-08-07')!).profit).toBe(2700);
    expect(cashState(ds).balance).toBe(cashBefore - 800);
    expect(ds.items.find((i) => i.id === pant.id)!.costPending).toBe(false);

    // 30 jours sans paiement : la montre est annulée automatiquement ; si le paiement arrive ensuite, elle est rétablie
    await syncNow(fakeScript, '2026-11-04');
    ds = await loadDataset();
    expect(ds.sales.find((x) => x.date === '2026-10-04')!.orderStatus).toBe('annulee');
    inbox = [...inbox, done('d9', '2026-11-05T10:00:00Z', 'Montre argentée homme/femme - cadran effet CD multicolore', '50,00')];
    await saveSettings({ lastSyncAt: null });
    await syncNow(fakeScript, '2026-11-05');
    ds = await loadDataset();
    const montres = ds.sales.filter((x) => x.date === '2026-10-04');
    expect(montres.map((x) => x.orderStatus).sort()).toEqual(['annulee', 'terminee']);
    expect(periodMetrics(ds, '2026-10-01', '2026-10-31').revenue).toBe(5000);
  });

  it('les opérations déjà « À valider » sont reprises quand on active le mode automatique', async () => {
    await saveSettings({ syncSince: '2026-10-01' });
    inbox = [sold('a', '2026-10-20T10:00:00Z', 'Robe longue rose - Taille S', '80,00')];
    expect((await syncNow(fakeScript, '2026-10-27')).inbox).toBe(1);
    await saveSettings({ autoRecord: true, lastSyncAt: null });
    expect((await syncNow(fakeScript, '2026-10-27')).inbox).toBe(0);
    expect((await loadDataset()).sales).toHaveLength(1);
  });
});

describe('Modifier ou supprimer une vente synchronisée', () => {
  it('modifier : nom, prix d’achat, montant ; supprimer : tout disparaît et ne revient pas', async () => {
    await saveSettings({ autoRecord: true, syncSince: '2026-10-01' });
    const M = 'Montre argentée homme/femme - cadran effet CD multicolore';
    inbox = [
      { id: 'm', date: '2026-10-04T00:32:55Z', subject: "Ton article s'est vendu !", text: `Bonjour clevinnng, omidi a acheté [image: ${M}] ${M} 50,00 € Nous transférerons le paiement` },
      sold('r', '2026-10-22T09:10:49Z', 'Robe longue rose - Taille S', '80,00'),
    ];
    await syncNow(fakeScript, '2026-10-27');
    let ds = await loadDataset();
    const montre = ds.sales.find((x) => x.date === '2026-10-04')!;
    const item = ds.items.find((i) => i.id === ds.saleLines.find((l) => l.saleId === montre.id)!.itemId)!;
    expect(item.name).toBe('Montre argentée homme/femme - cadran effet CD multicolore');

    // modifier
    await updateItem(item.id, { name: 'Montre CD' });
    await completeItemCost(item.id, 1399);
    await completeItemCost(item.id, 1200); // deuxième correction : pas de double comptage
    await correctSale(montre.id, { sellerRevenue: 4800 }, 'Modification manuelle');
    ds = await loadDataset();
    expect(saleBreakdown(ds, ds.sales.find((x) => x.id === montre.id)!).profit).toBe(3600);
    expect(cashState(ds).balance).toBe(10000 - 1200);
    expect(cashState(ds).pendingIn).toBe(4800 + 8000);

    // supprimer la robe (erreur) : CA, trésorerie, article créé… tout disparaît
    const robe = ds.sales.find((x) => x.date === '2026-10-22')!;
    await deleteSale(robe.id);
    ds = await loadDataset();
    expect(ds.sales).toHaveLength(1);
    expect(ds.items).toHaveLength(1);
    expect(cashState(ds).pendingIn).toBe(4800);
    expect(periodMetrics(ds, '2026-10-01', '2026-10-31').revenue).toBe(4800);
    // la synchro suivante ne la recrée pas
    await saveSettings({ lastSyncAt: null });
    await syncNow(fakeScript, '2026-10-27');
    expect((await loadDataset()).sales).toHaveLength(1);
  });

  it('titres « [image: …] » déjà enregistrés : réparés à la synchro suivante', async () => {
    await saveSettings({ autoRecord: true, syncSince: '2026-10-01' });
    const { itemIds } = await recordPurchase({ date: '2026-10-04', source: 'Créé par la synchro Vinted', commonFees: 0, lotPrice: null, lines: [{ name: '[image: Montre argentée] Montre argentée', category: 'Accessoires', price: 0, targetPrice: null, status: 'en_vente' }] });
    await syncNow(fakeScript, '2026-10-27');
    expect((await loadDataset()).items.find((i) => i.id === itemIds[0])!.name).toBe('Montre argentée');
  });
});

describe('Changer le statut d’une vente à la main', () => {
  it('tous les sens : annulée → rétablie → expédiée → terminée → remboursée → à confirmer', async () => {
    await buy('Veste coupe-vent - Taille L', 1000);
    const ds0 = await loadDataset();
    const saleId = await recordSale({ date: '2026-10-10', itemIds: [ds0.items[0].id], listedPrice: 6500, discount: 0, sellerRevenue: 6500, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente' });
    const check = async (status: string, revenue: number, balance: number, pending: number, itemStatus: string) => {
      const ds = await loadDataset();
      const s = ds.sales.find((x) => x.id === saleId)!;
      expect(s.orderStatus).toBe(status);
      expect(periodMetrics(ds, '2026-10-01', '2026-10-31').revenue).toBe(revenue);
      expect(cashState(ds).balance).toBe(balance);
      expect(cashState(ds).pendingIn).toBe(pending);
      expect(ds.items[0].status).toBe(itemStatus);
    };
    await changeSaleStatus(saleId, 'annulee', '2026-10-12');
    await check('annulee', 0, 10000 - 1000, 0, 'en_vente');
    await changeSaleStatus(saleId, 'confirmee', '2026-10-13');
    await check('confirmee', 6500, 9000, 6500, 'vendu');
    await changeSaleStatus(saleId, 'expediee', '2026-10-14');
    await check('expediee', 6500, 9000, 6500, 'expedie');
    await changeSaleStatus(saleId, 'terminee', '2026-10-20');
    await check('terminee', 6500, 9000 + 6500, 0, 'termine');
    await changeSaleStatus(saleId, 'remboursee', '2026-10-22');
    const ds = await loadDataset();
    expect(saleBreakdown(ds, ds.sales[0]).profit).toBe(0);
    expect(cashState(ds).balance).toBe(9000);
    expect(ds.items[0].status).toBe('retourne');
    await changeSaleStatus(saleId, 'confirmee', '2026-10-23'); // erreur : on revient en arrière
    await check('confirmee', 6500, 9000 + 6500, 0, 'vendu');
    expect((await loadDataset()).refunds).toHaveLength(0);
  });
});

describe('Lectures Gmail économisées', () => {
  it('première synchro complète, ensuite seulement les 7 derniers jours', async () => {
    await saveSettings({ syncSince: '2026-07-01' });
    const afters: string[] = [];
    const spy = (async (url: string) => { afters.push(new URL(url).searchParams.get('after')!); return fakeScript(url); }) as unknown as typeof fetch;
    await syncNow(spy, '2026-10-27');
    await saveSettings({ lastSyncAt: '2026-10-27T18:00:00Z' });
    await syncNow(spy, '2026-10-28');
    await saveSettings({ syncSince: '2026-09-01' }); // date changée : relecture complète
    await syncNow(spy, '2026-10-28');
    expect(afters).toEqual(['2026/07/01', '2026/10/20', '2026/09/01']);
  });
});

describe('Alerte nouvelle vente', () => {
  it('seules les ventes récentes et nouvelles déclenchent la bannière', async () => {
    await saveSettings({ syncSince: '2026-09-01' });
    await buy('Jogging gris léopard', 700);
    inbox = [
      sold('old', '2026-10-01T10:00:00Z', 'Sweat gris - Taille L', '40,00'), // historique : pas d'alerte
      sold('new', '2026-10-26T20:28:00Z', 'Jogging gris clair motif léopard Streetwear - Taille L', '29,00'),
    ];
    const r = await syncNow(fakeScript, '2026-10-27');
    expect(r.newSales).toEqual([{ id: 'new', title: 'Jogging gris clair motif léopard Streetwear - Taille L', amount: 2900, recorded: true }]);
    const again = await syncNow(fakeScript, '2026-10-27');
    expect(again.newSales).toEqual([]);
  });
});

describe('Script Google', () => {
  it('ne répond qu’avec la bonne clé, filtre la recherche et nettoie le texte', () => {
    const queries: string[] = [];
    const msg = (id: string, subject: string) => ({
      getId: () => id, getDate: () => new Date('2026-10-02T10:00:00Z'), getSubject: () => subject,
      getPlainBody: () => 'Bonjour  https://links.vinted.com/t/xyz\n\n a acheté   Robe 80,00 €',
    });
    const sandbox = {
      GmailApp: { search: (q: string) => { queries.push(q); return [{ getMessages: () => [msg('m1', "Ton article s'est vendu !")] }]; } },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ setMimeType: () => s }) },
      ScriptApp: { getProjectTriggers: () => [] },
    };
    vm.createContext(sandbox);
    vm.runInContext(appsScriptSource('CLE-TEST', 'cng-vinted-test') + '\nthis.doGet = doGet;', sandbox);
    const doGet = (sandbox as unknown as { doGet: (e: unknown) => string }).doGet;
    expect(JSON.parse(doGet({ parameter: { token: 'mauvaise' } }))).toEqual({ error: 'unauthorized' });
    const ok = JSON.parse(doGet({ parameter: { token: 'CLE-TEST', after: '2026/10/01' } }));
    expect(ok.messages).toEqual([{ id: 'm1', date: '2026-10-02T10:00:00.000Z', subject: "Ton article s'est vendu !", text: 'Bonjour a acheté Robe 80,00 €' }]);
    expect(queries[0]).toContain('from:(vinted.fr OR vinted.com)');
    expect(queries[0]).toContain('after:2026/10/01');
    // une date mal formée n'est pas injectée dans la recherche
    doGet({ parameter: { token: 'CLE-TEST', after: '2026/10/01 OR in:anywhere' } });
    expect(queries[1]).toContain('after:2026/01/01');
  });

  it('clé secrète aléatoire et longue', () => {
    const a = newSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newSecret()).not.toBe(a);
  });
});

describe('Synchros simultanées', () => {
  it('deux synchros lancées en même temps ne comptent rien deux fois', async () => {
    let calls = 0;
    const slow = (async (url: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return fakeScript(url);
    }) as unknown as typeof fetch;
    inbox = [boost('a', '2026-10-03T10:00:00Z')];
    const [r1, r2] = await Promise.all([syncNow(slow, '2026-10-27'), syncNow(slow, '2026-10-27')]);
    expect(r1).toBe(r2);
    expect(calls).toBe(1);
    expect((await loadDataset()).expenses).toHaveLength(1);
  });
});
