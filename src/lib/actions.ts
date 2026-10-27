/**
 * Opérations d'écriture. Chaque opération :
 *  - valide ses données (erreurs explicites en français),
 *  - s'exécute dans une transaction IndexedDB (tout ou rien),
 *  - laisse une trace dans le journal (AuditLogs),
 *  - ne supprime jamais silencieusement une opération financière (annulation = statut + ajustement).
 */
import { getDb, DATA_TABLES } from './db';
import { splitPurchase, splitSale, itemCost } from './engine';
import { sum, type Cents } from './money';
import { todayISO } from './period';
import {
  MANUAL_TRANSITIONS,
  SELLABLE,
  STATUS_LABEL,
  type Dataset,
  type Expense,
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
  const [settings, items, purchases, purchaseLines, sales, saleLines, refunds, expenses, transactions] =
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
    ]);
  return {
    settings: settings ?? defaultSettings(),
    items,
    purchases,
    purchaseLines,
    sales,
    saleLines,
    refunds,
    expenses,
    transactions,
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
  await audit('settings', 'main', 'modification', JSON.stringify(patch));
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
    if (input.amount > 0)
      await db.transactions.add(
        tx({
          date: input.date,
          amount: -input.amount,
          kind: 'remboursement',
          status: sale!.paymentStatus === 'recu' ? 'confirme' : 'en_attente',
          refType: 'refund',
          refId: input.saleId,
          label: 'Remboursement',
        }),
      );
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
