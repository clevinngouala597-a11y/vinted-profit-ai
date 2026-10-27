import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, recordExpense, recordPurchase, recordSale, saveSettings } from '../src/lib/actions';
import { computeNotifications, visibleNotifications } from '../src/lib/notifications';

let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`notif-${++n}`));
  await saveSettings({ ...defaultSettings('2026-09-01'), onboarded: true, initialCash: 5000, staleDays: 30, showStock: true });
});
const buy = (date: string, name = 'A', target: number | null = 1000) =>
  recordPurchase({ date, source: 'x', commonFees: 0, lotPrice: null, lines: [{ name, category: 'T-shirts', price: 300, targetPrice: target }] });

describe('Notifications', () => {
  it('stock masqué : aucune alerte de stock', async () => {
    await recordPurchase({ date: '2026-09-01', source: 'Friperie', commonFees: 0, lotPrice: null, lines: [{ name: 'Veste', category: 'Vestes et manteaux', price: 1000, targetPrice: null, status: 'en_vente' }] });
    await saveSettings({ showStock: false });
    const { computeNotifications } = await import('../src/lib/notifications');
    expect(computeNotifications(await loadDataset(), '2026-10-27').some((n) => n.category === 'stock' || n.id.startsWith('donnees:prix'))).toBe(false);
  });

  it('stock ancien : masquée, elle ne revient que si la situation change', async () => {
    await buy('2026-09-01', 'Vieux');
    let ds = await loadDataset();
    let all = computeNotifications(ds, '2026-10-27');
    const stale = all.find((x) => x.category === 'stock')!;
    expect(stale.title).toMatch(/1 article en stock depuis 30 jours/);
    const dismissed = new Set([stale.id]);
    // même situation le lendemain : toujours masquée
    expect(visibleNotifications(computeNotifications(ds, '2026-10-28'), dismissed).some((x) => x.category === 'stock')).toBe(false);
    // un deuxième article devient ancien : elle revient
    await buy('2026-09-20', 'Autre');
    ds = await loadDataset();
    all = computeNotifications(ds, '2026-10-27');
    expect(visibleNotifications(all, dismissed).find((x) => x.category === 'stock')?.title).toMatch(/2 articles/);
  });

  it('catégorie désactivée : plus aucune alerte de ce type', async () => {
    await buy('2026-09-01');
    await saveSettings({ disabledNotifications: ['stock', 'sauvegarde'] });
    const ds = await loadDataset();
    const cats = computeNotifications(ds, '2026-10-27').map((x) => x.category);
    expect(cats).not.toContain('stock');
    expect(cats).not.toContain('sauvegarde');
  });

  it('opérations à vérifier, justificatifs, sauvegarde, statut', async () => {
    const { itemIds } = await buy('2026-10-01');
    await recordSale({ date: '2026-10-02', itemIds, listedPrice: 200, discount: 0, sellerRevenue: 200, platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente' });
    await recordExpense({ date: '2026-10-05', amount: 500, category: 'Emballages', supplier: '', description: '', saleId: null, attachmentId: null });
    await buy('2026-10-06', 'B'); await buy('2026-10-07', 'C');
    const ds = await loadDataset();
    const all = computeNotifications(ds, '2026-10-27');
    const titles = all.map((x) => x.title).join(' | ');
    expect(titles).toMatch(/1 vente à perte/);
    expect(titles).toMatch(/paiement en attente depuis plus de 14 jours/);
    expect(titles).toMatch(/sans expédition/);
    expect(titles).toMatch(/1 dépense sans justificatif/);
    expect(titles).toMatch(/Aucune sauvegarde/);
    expect(titles).toMatch(/Achat-revente : vérifie ton statut/);
    expect(all[0].level).toBe('danger'); // les plus importantes en premier
  });

  it('rappel de déclaration Urssaf après la fin du trimestre', async () => {
    await saveSettings({ activityStatus: 'micro', declarationFrequency: 'trimestrielle', lastBackupAt: '2026-10-26T10:00:00Z' });
    const ds = await loadDataset();
    const decl = computeNotifications(ds, '2026-10-15').find((x) => x.id.startsWith('fiscal:decl'));
    expect(decl?.title).toBe('Déclaration Urssaf : 3e trimestre 2026');
    expect(computeNotifications(ds, '2026-11-15').find((x) => x.id.startsWith('fiscal:decl'))).toBeUndefined();
  });
});
