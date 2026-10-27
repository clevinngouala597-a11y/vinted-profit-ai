/**
 * Opérations d'écriture. Chaque opération :
 *  - valide ses données (erreurs explicites en français),
 *  - s'exécute dans une transaction IndexedDB (tout ou rien),
 *  - laisse une trace dans le journal (AuditLogs),
 *  - ne supprime jamais silencieusement une opération financière (annulation = statut + ajustement).
 */
import { getDb, DATA_TABLES } from './db';
import { splitPurchase, splitSale, itemCost } from './engine';
import { allocate, sum, type Cents } from './money';
import { todayISO } from './period';
import {
  MANUAL_TRANSITIONS,
  SELLABLE,
  STATUS_LABEL,
  type Dataset,
  type Expense,
  type Goal,
  type ISODate,
  type Item,
  type ItemStatus,
  type PaymentStatus,
  type Settings,
  type Transaction,
} from './types';

export class ValidationError extends Error {}
const fail = (msg: string): never => {
  throw new ValidationError(msg);
};

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const nonNeg = (c: Cents, label: string) => {
  if (!Number.isInteger(c) || c < 0) fail(`${label} doit être un montant positif ou nul.`);
};

export function defaultSettings(today = todayISO()): Settings {
  return {
    id: 'main',
    onboarded: false,
    businessName: '',
    activityStatus: 'particulier',
    trackingStart: today,
    initialCash: 0,
    monthlyProfitGoal: 0,
    maxPurchaseBudget: 0,
    minProfitPerItem: 0,
    reinvestPct: 50,
    safetyReserve: 0,
    staleDays: 30,
    customCategories: [],
    activityStart: null,
    vatRegime: 'franchise',
    declarationFrequency: 'trimestrielle',
    versementLiberatoire: false,
    disabledNotifications: [],
    lastBackupAt: null,
    syncUrl: '',
    syncToken: '',
    syncSince: null,
    lastSyncAt: null,
    saleAlert: true,
    autoRecord: true,
    showStock: false,
    ntfyTopic: '',
    scriptVersion: null,
    scriptNotifications: false,
    driveBackupAt: null,
  };
}

async function audit(entity: string, entityId: string, action: string, details = '') {
  await getDb().auditLogs.add({ id: uid(), at: now(), entity, entityId, action, details });
}

function tx(p: Omit<Transaction, 'id' | 'createdAt'>): Transaction {
  return { ...p, id: uid(), createdAt: now() };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function loadDataset(): Promise<Dataset> {
  const db = getDb();
  const [settings, items, purchases, purchaseLines, sales, saleLines, refunds, expenses, transactions, goals] =
    await Promise.all([
      db.settings.get('main'),
      db.items.toArray(),
      db.purchases.toArray(),
      db.purchaseLines.toArray(),
      db.sales.toArray(),
      db.saleLines.toArray(),
      db.refunds.toArray(),
      db.expenses.toArray(),
      db.transactions.toArray(),
      db.goals.toArray(),
    ]);
  return {
    // fusion avec les valeurs par défaut : les réglages créés par une version antérieure restent valides
    settings: { ...defaultSettings(), ...(settings ?? {}) },
    items,
    purchases,
    purchaseLines,
    sales,
    saleLines,
    refunds,
    expenses,
    transactions,
    goals,
  };
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export async function saveSettings(patch: Partial<Settings>) {
  const db = getDb();
  const cur = (await db.settings.get('main')) ?? defaultSettings();
  if (patch.reinvestPct !== undefined && (patch.reinvestPct < 0 || patch.reinvestPct > 100))
    fail('Le pourcentage de réinvestissement doit être compris entre 0 et 100.');
  for (const k of ['initialCash', 'monthlyProfitGoal', 'maxPurchaseBudget', 'minProfitPerItem', 'safetyReserve'] as const)
    if (patch[k] !== undefined) nonNeg(patch[k]!, 'Ce montant');
  const next = { ...cur, ...patch, id: 'main' as const };
  await db.settings.put(next);
  // la clé secrète de synchronisation n'apparaît jamais dans le journal
  const { syncToken: _hidden, ...visible } = patch;
  await audit('settings', 'main', 'modification', JSON.stringify(_hidden !== undefined ? { ...visible, syncToken: '••••' } : visible));
  return next;
}

// ---------------------------------------------------------------------------
// Achats
// ---------------------------------------------------------------------------

export interface PurchaseLineInput {
  name: string;
  category: string;
  brand?: string;
  size?: string;
  color?: string;
  condition?: string;
  price: Cents | null;
  targetPrice: Cents | null;
  minPrice?: Cents | null;
  status?: ItemStatus;
  photoIds?: string[];
  /** prix d'achat inconnu pour l'instant (article créé par la synchro) */
  costPending?: boolean;
}

export interface PurchaseInput {
  date: ISODate;
  source: string;
  paymentMethod?: string;
  commonFees: Cents;
  /** Prix global d'un lot ; si null, chaque ligne a son propre prix. */
  lotPrice: Cents | null;
  notes?: string;
  lines: PurchaseLineInput[];
}

export async function recordPurchase(input: PurchaseInput): Promise<{ purchaseId: string; itemIds: string[] }> {
  if (!isDate(input.date)) fail("La date d'achat est invalide.");
  if (input.lines.length === 0) fail('Ajoute au moins un article.');
  nonNeg(input.commonFees, 'Les frais');
  if (input.lotPrice !== null) nonNeg(input.lotPrice, 'Le prix du lot');
  input.lines.forEach((l, k) => {
    if (!l.name.trim()) fail(`Article ${k + 1} : indique un nom.`);
    if (!l.category.trim()) fail(`Article ${k + 1} : choisis une catégorie.`);
    if (input.lotPrice === null) {
      if (l.price === null) fail(`Article ${k + 1} : indique le prix payé.`);
      nonNeg(l.price!, `Article ${k + 1} : le prix`);
    }
    if (l.targetPrice !== null) nonNeg(l.targetPrice, `Article ${k + 1} : le prix souhaité`);
  });

  const split = splitPurchase(input.lines, input.commonFees, input.lotPrice);
  const db = getDb();
  const purchaseId = uid();
  const itemIds: string[] = [];
  const t = now();
  const itemsTotal = sum(split.map((s) => s.price));

  await db.transaction('rw', [db.purchases, db.purchaseLines, db.items, db.transactions, db.inventoryMovements, db.auditLogs], async () => {
    await db.purchases.add({
      id: purchaseId,
      date: input.date,
      source: input.source.trim(),
      paymentMethod: input.paymentMethod?.trim() ?? '',
      itemsTotal,
      commonFees: input.commonFees,
      notes: input.notes?.trim() ?? '',
      createdAt: t,
    });
    for (let k = 0; k < input.lines.length; k++) {
      const l = input.lines[k];
      const id = uid();
      itemIds.push(id);
      const status = l.status ?? 'achete';
      await db.items.add({
        id,
        name: l.name.trim(),
        category: l.category,
        brand: l.brand?.trim() ?? '',
        size: l.size?.trim() ?? '',
        color: l.color?.trim() ?? '',
        condition: l.condition ?? '',
        description: '',
        purchaseId,
        purchaseDate: input.date,
        purchasePrice: split[k].price,
        directFees: split[k].fees,
        targetPrice: l.targetPrice,
        minPrice: l.minPrice ?? null,
        status,
        listedAt: status === 'en_vente' ? input.date : null,
        soldAt: null,
        writtenOffAt: null,
        notes: '',
        listingRef: '',
        photoIds: l.photoIds ?? [],
        ...(l.costPending ? { costPending: true } : {}),
        createdAt: t,
        updatedAt: t,
      });
      await db.purchaseLines.add({ id: uid(), purchaseId, itemId: id, price: split[k].price, allocatedFees: split[k].fees });
      await db.inventoryMovements.add({ id: uid(), itemId: id, date: input.date, kind: 'entree', refId: purchaseId, createdAt: t });
    }
    const total = itemsTotal + input.commonFees;
    if (total > 0)
      await db.transactions.add(
        tx({
          date: input.date,
          amount: -total,
          kind: 'achat',
          status: 'confirme',
          refType: 'purchase',
          refId: purchaseId,
          label: `Achat · ${input.source.trim() || `${input.lines.length} article(s)`}`,
        }),
      );
    await audit('purchase', purchaseId, 'création', `${input.lines.length} article(s), total ${total} c`);
  });
  return { purchaseId, itemIds };
}

// ---------------------------------------------------------------------------
// Ventes
// ---------------------------------------------------------------------------

export interface SaleInput {
  date: ISODate;
  itemIds: string[];
  listedPrice: Cents;
  discount: Cents;
  sellerRevenue: Cents;
  platformFees: Cents;
  packagingCost: Cents;
  otherCosts: Cents;
  paymentStatus: PaymentStatus;
  notes?: string;
}

export async function recordSale(input: SaleInput): Promise<string> {
  if (!isDate(input.date)) fail('La date de vente est invalide.');
  if (input.itemIds.length === 0) fail('Choisis au moins un article vendu.');
  if (new Set(input.itemIds).size !== input.itemIds.length) fail('Un article est sélectionné deux fois.');
  nonNeg(input.sellerRevenue, 'Le montant encaissé');
  nonNeg(input.platformFees, 'Les frais de plateforme');
  nonNeg(input.packagingCost, "Les frais d'emballage");
  nonNeg(input.otherCosts, 'Les autres coûts');
  nonNeg(input.listedPrice, 'Le prix affiché');
  nonNeg(input.discount, 'La réduction');

  const db = getDb();
  const saleId = uid();
  const t = now();
  await db.transaction('rw', [db.items, db.sales, db.saleLines, db.transactions, db.inventoryMovements, db.auditLogs], async () => {
    const items = (await db.items.bulkGet(input.itemIds)) as (Item | undefined)[];
    items.forEach((it, k) => {
      if (!it) fail(`Article introuvable (${input.itemIds[k]}).`);
      if (!SELLABLE.includes(it!.status))
        fail(`« ${it!.name} » n'est pas disponible à la vente (statut : ${STATUS_LABEL[it!.status]}).`);
    });
    const its = items as Item[];
    const costs = input.platformFees + input.packagingCost + input.otherCosts;
    const split = splitSale(its, input.sellerRevenue, costs);
    await db.sales.add({
      id: saleId,
      date: input.date,
      listedPrice: input.listedPrice,
      discount: input.discount,
      sellerRevenue: input.sellerRevenue,
      platformFees: input.platformFees,
      packagingCost: input.packagingCost,
      otherCosts: input.otherCosts,
      paymentStatus: input.paymentStatus,
      orderStatus: 'confirmee',
      shippedAt: null,
      closedAt: null,
      cancelledAt: null,
      notes: input.notes?.trim() ?? '',
      createdAt: t,
    });
    for (const s of split) {
      await db.saleLines.add({ id: uid(), saleId, itemId: s.itemId, revenue: s.revenue, costs: s.costs, cogs: s.cogs });
      await db.items.update(s.itemId, { status: 'vendu', soldAt: input.date, updatedAt: t });
      await db.inventoryMovements.add({ id: uid(), itemId: s.itemId, date: input.date, kind: 'sortie_vente', refId: saleId, createdAt: t });
    }
    const label = its.length === 1 ? its[0].name : `${its.length} articles`;
    if (input.sellerRevenue > 0)
      await db.transactions.add(
        tx({
          date: input.date,
          amount: input.sellerRevenue,
          kind: 'vente',
          status: input.paymentStatus === 'recu' ? 'confirme' : 'en_attente',
          refType: 'sale',
          refId: saleId,
          label: `Vente · ${label}`,
        }),
      );
    if (costs > 0)
      await db.transactions.add(
        tx({ date: input.date, amount: -costs, kind: 'frais_vente', status: 'confirme', refType: 'sale', refId: saleId, label: `Frais de vente · ${label}` }),
      );
    await audit('sale', saleId, 'création', `${its.length} article(s), encaissé ${input.sellerRevenue} c`);
  });
  return saleId;
}

export async function markPaymentReceived(saleId: string, date: ISODate = todayISO()) {
  const db = getDb();
  await db.transaction('rw', [db.sales, db.transactions, db.auditLogs], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) fail('Vente introuvable.');
    if (sale!.orderStatus === 'annulee') fail('Cette vente est annulée.');
    await db.sales.update(saleId, { paymentStatus: 'recu' });
    const pending = await db.transactions.where('refId').equals(saleId).filter((t) => t.status === 'en_attente').toArray();
    for (const t of pending) await db.transactions.update(t.id, { status: 'confirme', date: t.kind === 'vente' ? date : t.date });
    await audit('sale', saleId, 'paiement reçu', date);
  });
}

export async function setOrderStatus(saleId: string, status: 'expediee' | 'terminee', date: ISODate = todayISO()) {
  const db = getDb();
  await db.transaction('rw', [db.sales, db.saleLines, db.items, db.auditLogs], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) fail('Vente introuvable.');
    if (!['confirmee', 'expediee', 'en_attente'].includes(sale!.orderStatus))
      fail('Cette vente ne peut plus changer de statut.');
    const lines = await db.saleLines.where('saleId').equals(saleId).toArray();
    if (status === 'expediee') {
      await db.sales.update(saleId, { orderStatus: 'expediee', shippedAt: date });
      for (const l of lines) await db.items.update(l.itemId, { status: 'expedie', updatedAt: now() });
    } else {
      await db.sales.update(saleId, { orderStatus: 'terminee', closedAt: date, shippedAt: sale!.shippedAt ?? date });
      for (const l of lines) await db.items.update(l.itemId, { status: 'termine', updatedAt: now() });
    }
    await audit('sale', saleId, `statut → ${status}`, date);
  });
}

/** Annule une vente : l'historique est conservé, l'encaissement est annulé, les articles reviennent en vente. */
export async function cancelSale(saleId: string, date: ISODate = todayISO()) {
  const db = getDb();
  await db.transaction('rw', [db.sales, db.saleLines, db.items, db.transactions, db.inventoryMovements, db.refunds, db.auditLogs], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) fail('Vente introuvable.');
    if (sale!.orderStatus === 'annulee') fail('Cette vente est déjà annulée.');
    if ((await db.refunds.where('saleId').equals(saleId).count()) > 0)
      fail('Cette vente a déjà un remboursement : utilise le retour plutôt que l’annulation.');
    if (sale!.paymentStatus === 'recu')
      fail("Le paiement a déjà été reçu : enregistre un remboursement plutôt qu'une annulation.");
    await db.sales.update(saleId, { orderStatus: 'annulee', cancelledAt: date });
    const ts = await db.transactions.where('refId').equals(saleId).filter((t) => t.kind === 'vente').toArray();
    for (const t of ts) await db.transactions.update(t.id, { status: 'annule' });
    const lines = await db.saleLines.where('saleId').equals(saleId).toArray();
    for (const l of lines) {
      await db.items.update(l.itemId, { status: 'en_vente', soldAt: null, updatedAt: now() });
      await db.inventoryMovements.add({ id: uid(), itemId: l.itemId, date, kind: 'annulation_vente', refId: saleId, createdAt: now() });
    }
    await audit('sale', saleId, 'annulation', date);
  });
}

export const AUTO_ITEM_SOURCE = 'Créé par la synchro Vinted';

export type SaleStatusChoice = 'confirmee' | 'expediee' | 'terminee' | 'annulee' | 'remboursee';
export const MANUAL_STATUS_NOTE = 'Statut modifié à la main';

/**
 * Change le statut d'une vente dans n'importe quel sens (erreur de saisie, synchro corrigée à la main).
 * Les effets sont recalculés : paiement, articles, trésorerie. « Remboursée » rembourse la totalité,
 * article récupéré ; quitter « Remboursée » ou « Annulée » défait proprement ce qui avait été fait.
 */
export async function changeSaleStatus(saleId: string, target: SaleStatusChoice, date: ISODate = todayISO()) {
  const db = getDb();
  const tables = [db.sales, db.saleLines, db.items, db.refunds, db.transactions, db.inventoryMovements, db.syncedEmails, db.auditLogs];
  await db.transaction('rw', tables, async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) fail('Vente introuvable.');
    const s = sale!;
    const current: SaleStatusChoice = s.orderStatus === 'retournee' || s.orderStatus === 'remboursee' ? 'remboursee' : s.orderStatus === 'en_attente' ? 'confirmee' : (s.orderStatus as SaleStatusChoice);
    if (current === target) return;
    const lines = await db.saleLines.where('saleId').equals(saleId).toArray();
    const itemIds = lines.map((l) => l.itemId);
    const txs = await db.transactions.where('refId').equals(saleId).toArray();
    const setItems = async (status: ItemStatus, soldAt: ISODate | null) => {
      for (const id of itemIds) await db.items.update(id, { status, soldAt, updatedAt: now() });
    };

    // 1. défaire un remboursement
    const refunds = await db.refunds.where('saleId').equals(saleId).toArray();
    if (refunds.length) {
      await db.refunds.where('saleId').equals(saleId).delete();
      for (const t of txs) {
        if (t.refType === 'refund' && (t.kind === 'remboursement' || t.kind === 'frais_vente')) await db.transactions.delete(t.id);
        if (t.kind === 'vente' && / \(après remboursement\)$/.test(t.label))
          await db.transactions.update(t.id, { amount: s.sellerRevenue, status: s.paymentStatus === 'recu' ? 'confirme' : 'en_attente', label: t.label.replace(/ \(après remboursement\)$/, '') });
      }
      for (const m of await db.inventoryMovements.where('itemId').anyOf(itemIds).filter((m) => m.refId === saleId && m.kind === 'retour_stock').toArray()) await db.inventoryMovements.delete(m.id);
    }
    // 2. défaire une annulation
    if (s.orderStatus === 'annulee') {
      for (const id of itemIds) {
        const it = await db.items.get(id);
        if (it && !SELLABLE.includes(it.status)) fail(`« ${it.name} » a été revendu entre-temps : cette vente ne peut pas être rétablie.`);
      }
      for (const t of txs) if (t.kind === 'vente' && t.status === 'annule') await db.transactions.update(t.id, { status: s.paymentStatus === 'recu' ? 'confirme' : 'en_attente' });
      for (const m of await db.inventoryMovements.where('itemId').anyOf(itemIds).filter((m) => m.refId === saleId && m.kind === 'annulation_vente').toArray()) await db.inventoryMovements.delete(m.id);
      await db.sales.update(saleId, { cancelledAt: null });
    }
    const fresh = (await db.sales.get(saleId))!;
    const unpay = async () => {
      if (fresh.paymentStatus !== 'recu') return;
      await db.sales.update(saleId, { paymentStatus: 'en_attente' });
      for (const t of await db.transactions.where('refId').equals(saleId).toArray())
        if (t.kind === 'vente' && t.status === 'confirme') await db.transactions.update(t.id, { status: 'en_attente' });
    };

    // 3. appliquer le nouveau statut
    switch (target) {
      case 'confirmee':
        await db.sales.update(saleId, { orderStatus: 'confirmee', shippedAt: null, closedAt: null });
        await setItems('vendu', fresh.date);
        break;
      case 'expediee':
        await db.sales.update(saleId, { orderStatus: 'expediee', shippedAt: fresh.shippedAt ?? date, closedAt: null });
        await setItems('expedie', fresh.date);
        break;
      case 'terminee': {
        await db.sales.update(saleId, { orderStatus: 'terminee', paymentStatus: 'recu', closedAt: fresh.closedAt ?? date, shippedAt: fresh.shippedAt ?? date });
        for (const t of await db.transactions.where('refId').equals(saleId).toArray())
          if (t.status === 'en_attente') await db.transactions.update(t.id, { status: 'confirme', date: t.kind === 'vente' ? date : t.date });
        await setItems('termine', fresh.date);
        break;
      }
      case 'annulee':
        await unpay();
        await db.sales.update(saleId, { orderStatus: 'annulee', cancelledAt: date, shippedAt: fresh.shippedAt, closedAt: null });
        for (const t of await db.transactions.where('refId').equals(saleId).toArray()) if (t.kind === 'vente') await db.transactions.update(t.id, { status: 'annule' });
        await setItems('en_vente', null);
        for (const id of itemIds) await db.inventoryMovements.add({ id: uid(), itemId: id, date, kind: 'annulation_vente', refId: saleId, createdAt: now() });
        break;
      case 'remboursee': {
        await db.sales.update(saleId, { orderStatus: 'retournee', closedAt: null });
        const amount = fresh.sellerRevenue;
        await db.refunds.add({ id: uid(), saleId, date, amount, itemRecovered: true, recoveredAt: date, extraCosts: 0, notes: MANUAL_STATUS_NOTE, createdAt: now() });
        const pendingIn = (await db.transactions.where('refId').equals(saleId).toArray()).find((t) => t.kind === 'vente' && t.status === 'en_attente');
        if (pendingIn) await db.transactions.update(pendingIn.id, { amount: 0, status: 'annule', label: `${pendingIn.label} (après remboursement)` });
        else if (amount > 0) await db.transactions.add(tx({ date, amount: -amount, kind: 'remboursement', status: 'confirme', refType: 'refund', refId: saleId, label: 'Remboursement' }));
        await restock(itemIds, date, saleId);
        break;
      }
    }
    // la synchro ne doit pas revenir sur un choix fait à la main
    for (const r of await db.syncedEmails.toArray()) if (r.ref === saleId && r.kind === 'sale') await db.syncedEmails.update(r.id, { note: MANUAL_STATUS_NOTE });
    await audit('sale', saleId, `statut → ${target} (à la main)`, date);
  });
}

/**
 * Supprime une vente enregistrée par erreur, comme si elle n'avait jamais existé (trace gardée au journal).
 * Un article créé automatiquement pour cette vente est supprimé avec elle ; un article du stock y revient.
 * Les e-mails Vinted correspondants sont marqués écartés : la synchro ne la recréera pas.
 */
export async function deleteSale(saleId: string) {
  const db = getDb();
  await db.transaction('rw', [db.sales, db.saleLines, db.items, db.purchases, db.purchaseLines, db.transactions, db.inventoryMovements, db.refunds, db.expenses, db.syncedEmails, db.auditLogs], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) fail('Vente introuvable.');
    if ((await db.refunds.where('saleId').equals(saleId).count()) > 0) fail('Cette vente a un remboursement : supprime-le ou garde la vente.');
    const lines = await db.saleLines.where('saleId').equals(saleId).toArray();
    for (const t of await db.transactions.where('refId').equals(saleId).toArray()) await db.transactions.delete(t.id);
    for (const e of await db.expenses.where('saleId').equals(saleId).toArray()) await db.expenses.update(e.id, { saleId: null });
    for (const m of await db.inventoryMovements.where('itemId').anyOf(lines.map((l) => l.itemId)).filter((m) => m.refId === saleId).toArray()) await db.inventoryMovements.delete(m.id);
    await db.saleLines.where('saleId').equals(saleId).delete();
    await db.sales.delete(saleId);
    for (const l of lines) {
      const it = await db.items.get(l.itemId);
      if (!it) continue;
      const purchase = it.purchaseId ? await db.purchases.get(it.purchaseId) : undefined;
      const otherSales = await db.saleLines.where('itemId').equals(it.id).count();
      const autoCreated = purchase?.source === AUTO_ITEM_SOURCE && (await db.purchaseLines.where('purchaseId').equals(purchase.id).count()) === 1;
      if (autoCreated && otherSales === 0) {
        for (const t of await db.transactions.where('refId').anyOf(purchase!.id, it.id).toArray()) await db.transactions.delete(t.id);
        await db.purchaseLines.where('purchaseId').equals(purchase!.id).delete();
        await db.purchases.delete(purchase!.id);
        for (const m of await db.inventoryMovements.where('itemId').equals(it.id).toArray()) await db.inventoryMovements.delete(m.id);
        await db.items.delete(it.id);
      } else if (otherSales === 0 || !['vendu', 'expedie', 'termine'].includes(it.status)) {
        await db.items.update(it.id, { status: 'en_vente', soldAt: null, updatedAt: now() });
      }
    }
    // la synchro ne doit pas recréer cette vente
    const rows = await db.syncedEmails.toArray();
    const saleRows = rows.filter((r) => r.ref === saleId);
    for (const r of saleRows) await db.syncedEmails.update(r.id, { status: 'ignored', note: r.kind === 'sale' ? 'Vente supprimée à la main' : 'Vente écartée : suite ignorée', ref: null, resolvedAt: now() });
    await audit('sale', saleId, 'suppression', `${sale!.date} · ${sale!.sellerRevenue} c`);
  });
}

export interface SaleCorrection {
  date?: ISODate;
  listedPrice?: Cents;
  discount?: Cents;
  sellerRevenue?: Cents;
  platformFees?: Cents;
  packagingCost?: Cents;
  otherCosts?: Cents;
}

/**
 * Corrige une vente déjà enregistrée. Rien n'est effacé : la répartition par article est recalculée,
 * la différence d'argent passe par un mouvement d'ajustement (ou modifie la somme encore attendue),
 * et l'avant/après est inscrit au journal avec la raison.
 */
export async function correctSale(saleId: string, patch: SaleCorrection, reason: string) {
  if (!reason.trim()) fail('Indique la raison de la correction.');
  if (patch.date !== undefined && !isDate(patch.date)) fail('La date de vente est invalide.');
  for (const [k, label] of [['listedPrice', 'Le prix affiché'], ['discount', 'La réduction'], ['sellerRevenue', 'Le montant encaissé'], ['platformFees', 'Les frais'], ['packagingCost', "L'emballage"], ['otherCosts', 'Les autres coûts']] as const)
    if (patch[k] !== undefined) nonNeg(patch[k]!, label);
  const db = getDb();
  await db.transaction('rw', [db.sales, db.saleLines, db.items, db.refunds, db.transactions, db.inventoryMovements, db.auditLogs], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) fail('Vente introuvable.');
    if (sale!.orderStatus === 'annulee') fail('Une vente annulée ne peut pas être corrigée.');
    const s = sale!;
    const next = { ...s, ...patch };
    const refunded = sum((await db.refunds.where('saleId').equals(saleId).toArray()).map((r) => r.amount));
    if (next.sellerRevenue < refunded) fail(`Le montant encaissé ne peut pas être inférieur au total déjà remboursé (${refunded / 100} €).`);
    const changed = (Object.keys(patch) as (keyof SaleCorrection)[]).filter((k) => patch[k] !== undefined && patch[k] !== s[k]);
    if (changed.length === 0) return;

    const oldCosts = s.platformFees + s.packagingCost + s.otherCosts;
    const newCosts = next.platformFees + next.packagingCost + next.otherCosts;
    const dRev = next.sellerRevenue - s.sellerRevenue;
    const dCosts = newCosts - oldCosts;

    // nouvelle répartition, avec les mêmes poids qu'à l'origine
    const lines = await db.saleLines.where('saleId').equals(saleId).toArray();
    const w = lines.every((l) => l.revenue > 0) ? lines.map((l) => l.revenue) : lines.map((l) => l.cogs);
    const rev = allocate(next.sellerRevenue, w);
    const cst = allocate(newCosts, w);
    for (let k = 0; k < lines.length; k++) await db.saleLines.update(lines[k].id, { revenue: rev[k], costs: cst[k] });

    await db.sales.update(saleId, { ...patch });
    const txs = await db.transactions.where('refId').equals(saleId).toArray();
    const label = txs.find((t) => t.kind === 'vente')?.label.replace(/^Vente · /, '').replace(/ \(après remboursement\)$/, '') ?? 'vente';
    if (dRev !== 0) {
      const pending = txs.find((t) => t.kind === 'vente' && t.status === 'en_attente');
      if (pending) await db.transactions.update(pending.id, { amount: pending.amount + dRev });
      else if (s.paymentStatus === 'recu' || !txs.some((t) => t.kind === 'vente'))
        await db.transactions.add(tx({
          date: todayISO(), amount: dRev, kind: 'ajustement', status: s.paymentStatus === 'recu' ? 'confirme' : 'en_attente',
          refType: 'sale', refId: saleId, label: `Correction du montant encaissé · ${label}`, sub: 'recette',
        }));
    }
    if (dCosts !== 0)
      await db.transactions.add(tx({
        date: todayISO(), amount: -dCosts, kind: 'ajustement', status: 'confirme', refType: 'sale', refId: saleId, label: `Correction des frais de vente · ${label}`, sub: 'frais',
      }));
    if (patch.date && patch.date !== s.date) {
      for (const t of txs) if (t.status === 'en_attente' || t.kind === 'frais_vente') await db.transactions.update(t.id, { date: patch.date });
      for (const l of lines) {
        const it = await db.items.get(l.itemId);
        if (it && it.soldAt === s.date) await db.items.update(l.itemId, { soldAt: patch.date });
        const mv = await db.inventoryMovements.where('itemId').equals(l.itemId).filter((m) => m.kind === 'sortie_vente' && m.refId === saleId).toArray();
        for (const m of mv) await db.inventoryMovements.update(m.id, { date: patch.date });
      }
    }
    const before = Object.fromEntries(changed.map((k) => [k, s[k]]));
    const after = Object.fromEntries(changed.map((k) => [k, next[k]]));
    await audit('sale', saleId, 'correction', `${JSON.stringify(before)} → ${JSON.stringify(after)}. Raison : ${reason.trim()}`);
  });
}

// ---------------------------------------------------------------------------
// Objectifs
// ---------------------------------------------------------------------------

export async function saveGoal(month: string, g: Omit<Goal, 'id' | 'updatedAt'>) {
  if (!/^\d{4}-\d{2}$/.test(month)) fail('Mois invalide.');
  for (const k of ['revenue', 'profit', 'maxPurchases', 'cashToKeep'] as const) nonNeg(g[k], 'Ce montant');
  for (const k of ['salesCount', 'maxStockCount'] as const)
    if (!Number.isInteger(g[k]) || g[k] < 0) fail('Le nombre doit être un entier positif ou nul.');
  if (!(g.minMargin >= 0 && g.minMargin <= 100)) fail('La marge minimale doit être comprise entre 0 et 100 %.');
  const db = getDb();
  const before = await db.goals.get(month);
  await db.goals.put({ ...g, id: month, updatedAt: now() });
  await audit('goal', month, before ? 'modification' : 'création', JSON.stringify(g));
}

// ---------------------------------------------------------------------------
// Retours et remboursements
// ---------------------------------------------------------------------------

export interface RefundInput {
  saleId: string;
  date: ISODate;
  amount: Cents;
  itemRecovered: boolean;
  extraCosts: Cents;
  notes?: string;
}

export async function recordRefund(input: RefundInput): Promise<string> {
  if (!isDate(input.date)) fail('La date du remboursement est invalide.');
  nonNeg(input.amount, 'Le montant remboursé');
  nonNeg(input.extraCosts, 'Les frais de retour');
  const db = getDb();
  const id = uid();
  await db.transaction('rw', [db.sales, db.saleLines, db.items, db.refunds, db.transactions, db.inventoryMovements, db.auditLogs], async () => {
    const sale = await db.sales.get(input.saleId);
    if (!sale) fail('Vente introuvable.');
    if (sale!.orderStatus === 'annulee') fail('Cette vente est annulée.');
    const previous = await db.refunds.where('saleId').equals(input.saleId).toArray();
    const already = sum(previous.map((r) => r.amount));
    if (already + input.amount > sale!.sellerRevenue)
      fail(`Le total remboursé dépasserait le montant encaissé (${(sale!.sellerRevenue - already) / 100} € restants).`);
    if (input.itemRecovered && previous.some((r) => r.itemRecovered)) fail("L'article a déjà été récupéré.");
    await db.refunds.add({
      id,
      saleId: input.saleId,
      date: input.date,
      amount: input.amount,
      itemRecovered: input.itemRecovered,
      recoveredAt: input.itemRecovered ? input.date : null,
      extraCosts: input.extraCosts,
      notes: input.notes?.trim() ?? '',
      createdAt: now(),
    });
    if (input.amount > 0) {
      const pendingIn = sale!.paymentStatus === 'en_attente'
        ? await db.transactions.where('refId').equals(input.saleId).filter((t) => t.kind === 'vente' && t.status === 'en_attente').first()
        : undefined;
      if (pendingIn) {
        // paiement pas encore reçu : le remboursement réduit simplement la somme attendue
        const left = pendingIn.amount - input.amount;
        await db.transactions.update(pendingIn.id, {
          amount: left,
          status: left === 0 ? 'annule' : 'en_attente',
          label: `${pendingIn.label.replace(/ \(après remboursement\)$/, '')} (après remboursement)`,
        });
      } else {
        await db.transactions.add(
          tx({ date: input.date, amount: -input.amount, kind: 'remboursement', status: 'confirme', refType: 'refund', refId: input.saleId, label: 'Remboursement' }),
        );
      }
    }
    if (input.extraCosts > 0)
      await db.transactions.add(
        tx({ date: input.date, amount: -input.extraCosts, kind: 'frais_vente', status: 'confirme', refType: 'refund', refId: input.saleId, label: 'Frais de retour' }),
      );
    const full = already + input.amount === sale!.sellerRevenue;
    const lines = await db.saleLines.where('saleId').equals(input.saleId).toArray();
    if (input.itemRecovered) {
      await restock(lines.map((l) => l.itemId), input.date, input.saleId);
      await db.sales.update(input.saleId, { orderStatus: 'retournee' });
    } else if (full) {
      await db.sales.update(input.saleId, { orderStatus: 'remboursee' });
      for (const l of lines) await db.items.update(l.itemId, { status: 'rembourse', updatedAt: now() });
    }
    await audit('refund', id, 'création', `vente ${input.saleId}, ${input.amount} c, récupéré : ${input.itemRecovered}`);
  });
  return id;
}

async function restock(itemIds: string[], date: ISODate, saleId: string) {
  const db = getDb();
  for (const itemId of itemIds) {
    await db.items.update(itemId, { status: 'retourne', soldAt: null, updatedAt: now() });
    await db.inventoryMovements.add({ id: uid(), itemId, date, kind: 'retour_stock', refId: saleId, createdAt: now() });
  }
}

/** Confirme la récupération physique d'un article remboursé : il revient alors en stock. */
export async function markItemRecovered(refundId: string, date: ISODate = todayISO()) {
  const db = getDb();
  await db.transaction('rw', [db.sales, db.saleLines, db.items, db.refunds, db.inventoryMovements, db.auditLogs], async () => {
    const r = await db.refunds.get(refundId);
    if (!r) fail('Remboursement introuvable.');
    if (r!.itemRecovered) fail("L'article est déjà marqué comme récupéré.");
    const others = await db.refunds.where('saleId').equals(r!.saleId).toArray();
    if (others.some((x) => x.itemRecovered)) fail("L'article a déjà été récupéré.");
    await db.refunds.update(refundId, { itemRecovered: true, recoveredAt: date });
    const lines = await db.saleLines.where('saleId').equals(r!.saleId).toArray();
    await restock(lines.map((l) => l.itemId), date, r!.saleId);
    await db.sales.update(r!.saleId, { orderStatus: 'retournee' });
    await audit('refund', refundId, 'article récupéré', date);
  });
}

// ---------------------------------------------------------------------------
// Dépenses
// ---------------------------------------------------------------------------

export type ExpenseInput = Omit<Expense, 'id' | 'createdAt' | 'validated'> & { validated?: boolean };

/** Doublons probables : même montant, même date (± 1 jour) et même fournisseur ou catégorie. */
export function findDuplicateExpenses(existing: Expense[], e: Pick<Expense, 'amount' | 'date' | 'supplier' | 'category'>) {
  const d = Date.parse(e.date);
  return existing.filter(
    (x) =>
      x.amount === e.amount &&
      Math.abs(Date.parse(x.date) - d) <= 86_400_000 &&
      (x.supplier.trim().toLowerCase() === e.supplier.trim().toLowerCase() || x.category === e.category),
  );
}

export async function recordExpense(input: ExpenseInput): Promise<string> {
  if (!isDate(input.date)) fail('La date de la dépense est invalide.');
  if (!(input.amount > 0)) fail('Le montant de la dépense doit être supérieur à 0.');
  if (!input.category) fail('Choisis une catégorie.');
  const db = getDb();
  const id = uid();
  await db.transaction('rw', [db.expenses, db.transactions, db.sales, db.auditLogs], async () => {
    if (input.saleId && !(await db.sales.get(input.saleId))) fail('La vente liée est introuvable.');
    await db.expenses.add({ ...input, id, validated: input.validated ?? true, createdAt: now() });
    await db.transactions.add(
      tx({
        date: input.date,
        amount: -input.amount,
        kind: 'depense',
        status: 'confirme',
        refType: 'expense',
        refId: id,
        label: `${input.category}${input.description ? ' · ' + input.description : ''}`,
      }),
    );
    await audit('expense', id, 'création', `${input.amount} c, ${input.category}`);
  });
  return id;
}

/** Annule une dépense saisie par erreur : elle est retirée et son mouvement de trésorerie annulé, avec trace au journal. */
export async function deleteExpense(id: string) {
  const db = getDb();
  await db.transaction('rw', [db.expenses, db.transactions, db.auditLogs], async () => {
    const e = await db.expenses.get(id);
    if (!e) fail('Dépense introuvable.');
    await db.expenses.delete(id);
    const ts = await db.transactions.where('refId').equals(id).toArray();
    for (const t of ts) await db.transactions.update(t.id, { status: 'annule', label: t.label + ' (annulée)' });
    await audit('expense', id, 'annulation', JSON.stringify(e));
  });
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

const EDITABLE: (keyof Item)[] = [
  'name', 'category', 'brand', 'size', 'color', 'condition', 'description', 'targetPrice', 'minPrice', 'notes', 'listingRef',
];

export async function updateItem(id: string, patch: Partial<Item>) {
  const db = getDb();
  const cur = await db.items.get(id);
  if (!cur) fail('Article introuvable.');
  const clean: Partial<Item> = {};
  for (const k of EDITABLE) if (k in patch) (clean as Record<string, unknown>)[k] = patch[k];
  if (clean.name !== undefined && !String(clean.name).trim()) fail("Le nom de l'article ne peut pas être vide.");
  if (clean.targetPrice != null) nonNeg(clean.targetPrice, 'Le prix souhaité');
  if (clean.minPrice != null) nonNeg(clean.minPrice, 'Le prix minimum');
  await db.items.update(id, { ...clean, updatedAt: now() });
  const changed = Object.keys(clean).filter((k) => (cur as unknown as Record<string, unknown>)[k] !== (clean as Record<string, unknown>)[k]);
  if (changed.length) await audit('item', id, 'modification', changed.join(', '));
}

/**
 * Indique le prix d'achat d'un article créé par la synchro (même s'il est déjà vendu).
 * Tout est recalculé comme si le prix avait été saisi dès l'achat : achat, ligne d'achat,
 * sortie de trésorerie à la date d'achat, et coût de revient des ventes de l'article.
 */
export async function completeItemCost(id: string, cost: Cents) {
  nonNeg(cost, "Le prix d'achat");
  const db = getDb();
  await db.transaction('rw', [db.items, db.purchases, db.purchaseLines, db.saleLines, db.transactions, db.auditLogs], async () => {
    const it = await db.items.get(id);
    if (!it) fail('Article introuvable.');
    const before = it!.purchasePrice + it!.directFees;
    await db.items.update(id, { purchasePrice: cost, directFees: 0, costPending: false, updatedAt: now() });
    if (it!.purchaseId) {
      const p = await db.purchases.get(it!.purchaseId);
      if (p) {
        const itemsTotal = p.itemsTotal - it!.purchasePrice + cost;
        const commonFees = p.commonFees - it!.directFees;
        await db.purchases.update(p.id, { itemsTotal, commonFees });
        const line = await db.purchaseLines.where('itemId').equals(id).first();
        if (line) await db.purchaseLines.update(line.id, { price: cost, allocatedFees: 0 });
        const total = itemsTotal + commonFees;
        const ptx = (await db.transactions.where('refId').equals(p.id).toArray()).find((x) => x.refType === 'purchase' && x.kind === 'achat');
        if (ptx) await db.transactions.update(ptx.id, { amount: -total });
        else if (total > 0)
          await db.transactions.add(tx({ date: p.date, amount: -total, kind: 'achat', status: 'confirme', refType: 'purchase', refId: p.id, label: `Achat · ${p.source || it!.name}` }));
      }
    }
    // les anciennes corrections de coût de cet article sont remplacées par la nouvelle valeur (déjà dans l'achat)
    for (const t of await db.transactions.where('refId').equals(id).toArray())
      if (t.refType === 'item' && t.kind === 'ajustement' && t.label.startsWith('Correction du coût')) await db.transactions.delete(t.id);
    for (const l of await db.saleLines.where('itemId').equals(id).toArray()) await db.saleLines.update(l.id, { cogs: cost });
    await audit('item', id, "prix d'achat indiqué", `${before} c → ${cost} c`);
  });
}

/**
 * Corrige le coût d'achat d'un article encore en stock. La correction est tracée :
 * l'achat et la ligne d'achat sont mis à jour et un mouvement d'ajustement de trésorerie est créé.
 */
export async function correctItemCost(id: string, purchasePrice: Cents, directFees: Cents, reason: string) {
  nonNeg(purchasePrice, "Le prix d'achat");
  nonNeg(directFees, 'Les frais');
  if (!reason.trim()) fail('Indique la raison de la correction.');
  const db = getDb();
  await db.transaction('rw', [db.items, db.purchases, db.purchaseLines, db.transactions, db.auditLogs], async () => {
    const it = await db.items.get(id);
    if (!it) fail('Article introuvable.');
    if (!SELLABLE.includes(it!.status)) fail('Le coût ne peut être corrigé que pour un article encore en stock.');
    const dPrice = purchasePrice - it!.purchasePrice;
    const dFees = directFees - it!.directFees;
    if (dPrice === 0 && dFees === 0) return;
    await db.items.update(id, { purchasePrice, directFees, updatedAt: now() });
    if (it!.purchaseId) {
      const p = await db.purchases.get(it!.purchaseId);
      if (p) await db.purchases.update(p.id, { itemsTotal: p.itemsTotal + dPrice, commonFees: p.commonFees + dFees });
      const line = await db.purchaseLines.where('itemId').equals(id).first();
      if (line) await db.purchaseLines.update(line.id, { price: purchasePrice, allocatedFees: directFees });
    }
    await db.transactions.add(
      tx({
        date: todayISO(),
        amount: -(dPrice + dFees),
        kind: 'ajustement',
        status: 'confirme',
        refType: 'item',
        refId: id,
        label: `Correction du coût · ${it!.name}`,
      }),
    );
    await audit('item', id, 'correction du coût', `${itemCost(it!)} c → ${purchasePrice + directFees} c. Raison : ${reason.trim()}`);
  });
}

export async function changeItemStatus(id: string, to: ItemStatus, date: ISODate = todayISO()) {
  const db = getDb();
  await db.transaction('rw', [db.items, db.inventoryMovements, db.auditLogs], async () => {
    const it = await db.items.get(id);
    if (!it) fail('Article introuvable.');
    const allowed = MANUAL_TRANSITIONS[it!.status] ?? [];
    if (!allowed.includes(to))
      fail(`Passage impossible de « ${STATUS_LABEL[it!.status]} » à « ${STATUS_LABEL[to]} ».`);
    const patch: Partial<Item> = { status: to, updatedAt: now() };
    if (to === 'en_vente' && !it!.listedAt) patch.listedAt = date;
    if (to === 'retire' || to === 'perdu') {
      patch.writtenOffAt = date;
      await db.inventoryMovements.add({
        id: uid(), itemId: id, date, kind: to === 'perdu' ? 'sortie_perte' : 'sortie_retrait', refId: null, createdAt: now(),
      });
    }
    await db.items.update(id, patch);
    await audit('item', id, `statut → ${to}`, date);
  });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export async function savePhoto(blob: Blob): Promise<string> {
  const id = uid();
  await getDb().attachments.add({ id, blob, mime: blob.type, createdAt: now() });
  return id;
}

export async function addItemPhotos(itemId: string, blobs: Blob[]) {
  const ids: string[] = [];
  for (const b of blobs) ids.push(await savePhoto(b));
  const db = getDb();
  const it = await db.items.get(itemId);
  if (!it) fail('Article introuvable.');
  await db.items.update(itemId, { photoIds: [...it!.photoIds, ...ids], updatedAt: now() });
}

export async function removeItemPhoto(itemId: string, photoId: string) {
  const db = getDb();
  const it = await db.items.get(itemId);
  if (!it) fail('Article introuvable.');
  await db.items.update(itemId, { photoIds: it!.photoIds.filter((p) => p !== photoId), updatedAt: now() });
  await db.attachments.delete(photoId);
}

export async function setMainPhoto(itemId: string, photoId: string) {
  const db = getDb();
  const it = await db.items.get(itemId);
  if (!it) fail('Article introuvable.');
  await db.items.update(itemId, { photoIds: [photoId, ...it!.photoIds.filter((p) => p !== photoId)] });
}

// ---------------------------------------------------------------------------
// Remise à zéro
// ---------------------------------------------------------------------------

export async function wipeAllData() {
  const db = getDb();
  await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.attachments], async () => {
    for (const t of DATA_TABLES) await db.table(t).clear();
    await db.attachments.clear();
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function dismissNotification(id: string) {
  await getDb().notifications.put({ id, dismissedAt: now() });
}

export async function restoreNotifications() {
  await getDb().notifications.clear();
}

export async function toggleNotificationCategory(category: string, enabled: boolean) {
  const cur = (await loadDataset()).settings.disabledNotifications;
  await saveSettings({ disabledNotifications: enabled ? cur.filter((c) => c !== category) : [...new Set([...cur, category])] });
}
