/**
 * Synchronisation automatique à partir des e-mails Vinted.
 *
 *  1. `fetchVintedEmails` interroge le script Google de l'utilisateur (qui lit SON Gmail et ne renvoie
 *     que les e-mails Vinted utiles, protégé par une clé secrète).
 *  2. `ingestEmails` lit chaque e-mail une seule fois (identifiant Gmail) et en extrait un événement.
 *  3. `processPending` applique les événements dans l'ordre chronologique, avec les opérations
 *     habituelles de l'application (mêmes calculs, même journal) :
 *       - certains → enregistrés automatiquement ;
 *       - ambigus (article introuvable dans le stock…) → liste « À valider » ;
 *       - dépendants d'une vente encore à valider → mis en attente puis réessayés.
 * Rien n'est jamais enregistré deux fois : une vente déjà saisie à la main est reconnue.
 */
import {
  AUTO_ITEM_SOURCE,
  MANUAL_STATUS_NOTE,
  cancelSale,
  correctSale,
  findDuplicateExpenses,
  loadDataset,
  markPaymentReceived,
  recordExpense,
  recordPurchase,
  recordSale,
  saveSettings,
  setOrderStatus,
  updateItem,
} from '../actions';
import { getDb } from '../db';
import { sum, type Cents } from '../money';
import { SELLABLE, type Dataset, type ISODate, type Item, type Sale, type SyncedEmail } from '../types';
import { announceSales } from '../saleAlert';
import { normTitle, parseVintedEmail, titleSimilarity, type RawEmail, type VintedEvent } from './parse';

export const MATCH_THRESHOLD = 0.75;
const NOTE = (d: ISODate) => `Synchronisé depuis l'e-mail Vinted du ${d.split('-').reverse().join('/')}`;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Récupération
// ---------------------------------------------------------------------------

export class SyncError extends Error {}

export interface ScriptReply {
  messages: RawEmail[];
  /** version du script (1 si absente : première version) */
  version: number;
  notifications: boolean;
  /** sujet ntfy écrit dans le script (il fait foi) */
  topic: string | null;
}

export async function fetchVintedEmails(url: string, token: string, since: ISODate, fetcher: typeof fetch = fetch): Promise<ScriptReply> {
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw new SyncError("L'adresse du script doit commencer par https://script.google.com/");
  const u = `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}&after=${since.replace(/-/g, '/')}`;
  let res: Response;
  try {
    res = await fetcher(u, { method: 'GET', redirect: 'follow' });
  } catch {
    throw new SyncError('Impossible de joindre le script Google : pas de connexion internet, ou limite Gmail du jour atteinte (elle se réinitialise en 24 h).');
  }
  if (!res.ok) throw new SyncError(`Le script Google a répondu avec une erreur (${res.status}). Vérifie qu'il est déployé en « Application Web » accessible à « Tout le monde ».`);
  let body: { error?: string; messages?: RawEmail[]; version?: number; notifications?: boolean; sujet?: string };
  try {
    body = await res.json();
  } catch {
    throw new SyncError("Réponse illisible : vérifie que l'adresse est bien celle de l'application Web (elle se termine par /exec).");
  }
  if (body.error === 'unauthorized') throw new SyncError('Clé secrète refusée : le script et l’application n’ont pas la même clé.');
  if (body.error) throw new SyncError(`Erreur du script Google : ${body.error}`);
  if (!Array.isArray(body.messages)) throw new SyncError('Réponse inattendue du script Google.');
  const topic = typeof body.sujet === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.sujet) ? body.sujet : null;
  return { messages: body.messages, version: body.version ?? 1, notifications: body.notifications === true, topic };
}

// ---------------------------------------------------------------------------
// Association aux articles et aux ventes
// ---------------------------------------------------------------------------

const score = (it: Pick<Item, 'name' | 'listingRef'>, title: string) =>
  normTitle(it.name) === normTitle(title) || (it.listingRef && normTitle(it.listingRef) === normTitle(title))
    ? 1
    : Math.max(titleSimilarity(it.name, title), it.listingRef ? titleSimilarity(it.listingRef, title) : 0);

/** Article du stock correspondant à un titre Vinted (le plus ancien en cas d'égalité, ex. plusieurs montres identiques). */
export function findStockItem(ds: Dataset, title: string): Item | null {
  const scored = ds.items
    .filter((i) => SELLABLE.includes(i.status))
    .map((i) => ({ i, s: score(i, title) }))
    .filter((x) => x.s >= MATCH_THRESHOLD)
    .sort((a, b) => b.s - a.s || a.i.purchaseDate.localeCompare(b.i.purchaseDate));
  return scored[0]?.i ?? null;
}

const saleItems = (ds: Dataset, s: Sale) =>
  ds.saleLines.filter((l) => l.saleId === s.id).map((l) => ds.items.find((i) => i.id === l.itemId)).filter((x): x is Item => !!x);

/**
 * Vente déjà enregistrée qui correspond au titre (filtrée par `accept`).
 * Par défaut la plus récente : un paiement ou une annulation concerne la dernière vente de cet article.
 */
export function findSale(ds: Dataset, title: string, accept: (s: Sale) => boolean, pick: 'latest' | 'oldest' = 'latest'): Sale | null {
  const list = ds.sales
    .filter(accept)
    .filter((s) => saleItems(ds, s).some((i) => score(i, title) >= MATCH_THRESHOLD))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return (pick === 'latest' ? list[list.length - 1] : list[0]) ?? null;
}

// ---------------------------------------------------------------------------
// Appariement des e-mails entre eux
// ---------------------------------------------------------------------------

export interface Pairing {
  /** e-mail de vente → e-mail qui la clôt (transaction finalisée ou annulée) */
  closedBy: Map<string, SyncedEmail>;
  /** e-mail de suite (finalisée, annulée, expédiée) → e-mail de la vente concernée */
  saleOf: Map<string, SyncedEmail>;
}

const FOLLOW_UPS = ['completed', 'cancelled', 'shipped'];

/**
 * Relie chaque paiement / annulation / expédition à la vente qu'il concerne : la dernière vente encore ouverte
 * du même article avant lui (même titre exact de préférence). Un même article revendu plusieurs fois après
 * des annulations est ainsi suivi vente par vente. Les ventes écartées à la main ne comptent pas.
 */
export function pairEvents(rows: SyncedEmail[]): Pairing {
  const evs = rows
    .filter((r) => r.event && (r.kind === 'sale' ? r.status !== 'ignored' : FOLLOW_UPS.includes(r.kind)))
    .filter((r) => !(r.status === 'ignored' && r.note === VENTE_ECARTEE))
    .sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind as VintedEvent['kind']] - ORDER[b.kind as VintedEvent['kind']] || a.id.localeCompare(b.id));
  const closedBy = new Map<string, SyncedEmail>();
  const saleOf = new Map<string, SyncedEmail>();
  const open: SyncedEmail[] = [];
  for (const r of evs) {
    if (r.kind === 'sale') {
      open.push(r);
      continue;
    }
    const t = normTitle(r.title);
    let idx = -1;
    for (let i = open.length - 1; i >= 0; i--) if (normTitle(open[i].title) === t) { idx = i; break; }
    if (idx < 0) for (let i = open.length - 1; i >= 0; i--) if (titleSimilarity(open[i].title, r.title) >= MATCH_THRESHOLD) { idx = i; break; }
    if (idx < 0) continue;
    const sale = open[idx];
    saleOf.set(r.id, sale);
    if (r.kind !== 'shipped') {
      closedBy.set(sale.id, r);
      open.splice(idx, 1);
    }
  }
  return { closedBy, saleOf };
}

/** Une vente sans paiement ni annulation depuis ce nombre de jours a sans doute été annulée ou remboursée. */
export const NO_PAYMENT_DAYS = 30;
const AUTO_CANCEL = `Annulée automatiquement : aucun paiement Vinted après ${NO_PAYMENT_DAYS} jours`;
const SKIPPED = `Non comptée : aucun paiement Vinted après ${NO_PAYMENT_DAYS} jours (vente remboursée ou annulée)`;

/** Crée l'article vendu quand il n'est pas dans le stock (mode automatique) : prix d'achat à compléter. */
async function autoItem(title: string, date: ISODate): Promise<string> {
  const { itemIds } = await recordPurchase({
    date, source: AUTO_ITEM_SOURCE, commonFees: 0, lotPrice: null,
    notes: "Article créé automatiquement à partir d'un e-mail Vinted : indique son prix d'achat.",
    lines: [{ name: title.replace(/\s*[-–]\s*Taille\s+\S+$/i, '').trim() || title, category: guessCategory(title), price: 0, targetPrice: null, status: 'en_vente', costPending: true }],
  });
  return itemIds[0];
}
const VENTE_ECARTEE = 'Vente écartée : suite ignorée';

const refunded = (ds: Dataset, saleId: string) => sum(ds.refunds.filter((r) => r.saleId === saleId).map((r) => r.amount));
const INCREMENTAL_DAYS = 3;
const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
const addDays = (d: ISODate, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Catégorie probable d'après le titre (modifiable ensuite). */
export function guessCategory(title: string): string {
  const t = normTitle(title);
  const rules: [RegExp, string][] = [
    [/\b(sweat|pull|hoodie|gilet|cardigan)/, 'Sweats et pulls'],
    [/\b(veste|manteau|blouson|doudoune|parka|windbreaker|jacke|bomber|coupe vent)/, 'Vestes et manteaux'],
    [/\b(jean|pantalon|jogging|sarouel|cargo|chino|legging)/, 'Pantalons et jeans'],
    [/\b(short|bermuda)/, 'Shorts'],
    [/\b(t shirt|tee|tshirt|debardeur|polo)/, 'T-shirts'],
    [/\b(basket|sneaker|chaussure|botte|bottine|sandale|mocassin)/, 'Chaussures'],
    [/\b(sac|sacoche|banane|tote)/, 'Sacs'],
    [/\b(montre|casquette|bonnet|ceinture|porte cle|bijou|collier|bracelet|lunettes|echarpe|bob)/, 'Accessoires'],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? 'Autres vêtements';
}

// ---------------------------------------------------------------------------
// Lecture et application
// ---------------------------------------------------------------------------

/** Enregistre les e-mails non encore lus. Renvoie le nombre de nouveaux événements utiles. */
export async function ingestEmails(emails: RawEmail[]): Promise<number> {
  const db = getDb();
  const known = new Set((await db.syncedEmails.toArray()).map((e) => e.id));
  let added = 0;
  for (const e of emails) {
    if (known.has(e.id)) continue;
    known.add(e.id);
    const ev = parseVintedEmail(e);
    await db.syncedEmails.put({
      id: e.id,
      kind: ev?.kind ?? 'autre',
      date: ev?.date ?? e.date.slice(0, 10),
      title: ev && 'title' in ev ? ev.title : ev?.kind === 'invoice' ? ev.label : e.subject,
      event: ev,
      // un e-mail sans intérêt est mémorisé pour ne pas être relu à chaque synchro
      status: ev ? 'waiting' : 'ignored',
      ref: null,
      note: ev ? '' : 'E-mail sans opération à enregistrer',
      createdAt: now(),
      resolvedAt: null,
    });
    if (ev) added++;
  }
  return added;
}

type Outcome = { status: SyncedEmail['status']; ref?: string | null; note: string };

const ORDER: Record<VintedEvent['kind'], number> = { purchase: 0, sale: 1, shipped: 2, cancelled: 3, completed: 4, invoice: 5, purchase_refund: 6 };

/** Applique tout ce qui peut l'être. Renvoie le résumé de ce qui a été fait. */
export async function processPending(today: ISODate = new Date().toISOString().slice(0, 10)) {
  const db = getDb();
  const auto = (await loadDataset()).settings.autoRecord !== false;
  // en mode automatique, ce qui attendait dans « À valider » est repris
  const statuses = auto ? ['waiting', 'inbox'] : ['waiting'];
  const pending = (await db.syncedEmails.where('status').anyOf(statuses).toArray())
    .filter((r) => r.status === 'waiting' || r.kind === 'sale' || r.kind === 'completed')
    .sort(
    (a, b) => a.date.localeCompare(b.date) || ORDER[(a.event as VintedEvent).kind] - ORDER[(b.event as VintedEvent).kind],
  );
  const summary = { applied: 0, inbox: 0, waiting: 0 };
  for (const row of pending) {
    const ev = row.event as VintedEvent;
    let out: Outcome;
    try {
      out = await applyEvent(row, ev, today, auto);
    } catch (e) {
      out = { status: 'inbox', note: e instanceof Error ? e.message : 'Erreur inattendue' };
    }
    await db.syncedEmails.update(row.id, {
      status: out.status,
      ref: out.ref ?? null,
      note: out.note,
      resolvedAt: out.status === 'waiting' ? null : now(),
    });
    if (out.status === 'applied') summary.applied++;
    else if (out.status === 'inbox') summary.inbox++;
    else if (out.status === 'waiting') summary.waiting++;
  }
  if (auto) await cancelUnpaid(today);
  return summary;
}

/** Ventes créées par la synchro restées sans paiement ni annulation après NO_PAYMENT_DAYS jours : annulées. */
async function cancelUnpaid(today: ISODate) {
  const db = getDb();
  const rows = await db.syncedEmails.toArray();
  const { closedBy } = pairEvents(rows);
  const ds = await loadDataset();
  for (const r of rows) {
    if (r.kind !== 'sale' || r.status !== 'applied' || !r.ref || closedBy.has(r.id) || daysBetween(r.date, today) < NO_PAYMENT_DAYS) continue;
    if (r.note === MANUAL_STATUS_NOTE || r.note === AUTO_CANCEL) continue; // choix fait à la main, ou déjà annulée une fois
    const sale = ds.sales.find((x) => x.id === r.ref);
    if (!sale || !sale.notes.startsWith('Synchronisé') || sale.orderStatus === 'annulee' || sale.paymentStatus !== 'en_attente' || refunded(ds, sale.id) > 0) continue;
    await cancelSale(sale.id, today);
    await db.syncedEmails.update(r.id, { note: AUTO_CANCEL });
  }
}

async function applyEvent(row: SyncedEmail, ev: VintedEvent, today: ISODate, auto: boolean): Promise<Outcome> {
  const ds = await loadDataset();
  const pairing = pairEvents(await getDb().syncedEmails.toArray());
  // vente concernée par un paiement / une annulation / une expédition, d'après les e-mails
  let linked: Sale | null | undefined; // undefined : aucun e-mail de vente ne correspond
  let linkedRow: SyncedEmail | undefined;
  if (FOLLOW_UPS.includes(ev.kind)) {
    linkedRow = pairing.saleOf.get(row.id);
    if (linkedRow) {
      if (linkedRow.status !== 'applied') {
        if (linkedRow.status === 'ignored') return { status: 'ignored', note: 'Vente non comptée' };
        return { status: 'waiting', note: 'En attente de la vente correspondante (à valider)' };
      }
      linked = ds.sales.find((s) => s.id === linkedRow!.ref) ?? null;
    }
  }
  switch (ev.kind) {
    case 'sale': {
      // déjà saisie à la main (même article, à quelques jours près) ?
      const manual = findSale(ds, ev.title, (s) => s.orderStatus !== 'annulee' && Math.abs(daysBetween(s.date, ev.date)) <= 3);
      if (manual) return { status: 'applied', ref: manual.id, note: 'Vente déjà enregistrée' };
      // ni paiement ni annulation depuis longtemps : vente remboursée (Vinted n'envoie pas toujours d'e-mail)
      if (auto && !pairing.closedBy.has(row.id) && daysBetween(ev.date, today) >= NO_PAYMENT_DAYS) return { status: 'ignored', note: SKIPPED };
      const item = findStockItem(ds, ev.title);
      if (!item && !auto) return { status: 'inbox', note: "Aucun article du stock ne correspond : indique l'article vendu." };
      const itemId = item?.id ?? (await autoItem(ev.title, ev.date));
      const saleId = await recordSale({
        date: ev.date, itemIds: [itemId], listedPrice: ev.amount, discount: 0, sellerRevenue: ev.amount,
        platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente', notes: NOTE(ev.date),
      });
      if (!item?.listingRef) await updateItem(itemId, { listingRef: ev.title });
      return { status: 'applied', ref: saleId, note: item ? `Vente enregistrée pour « ${item.name} »` : "Vente enregistrée · article créé, prix d'achat à indiquer" };
    }

    case 'completed': {
      if (linked) {
        if (linked.orderStatus === 'annulee') {
          // paiement arrivé après une annulation automatique : la vente est réenregistrée, payée
          const itemId = ds.saleLines.find((l) => l.saleId === linked!.id)?.itemId;
          const item = ds.items.find((i) => i.id === itemId);
          if (linkedRow?.note === AUTO_CANCEL && item && SELLABLE.includes(item.status)) {
            const saleId = await recordSale({
              date: linked.date, itemIds: [item.id], listedPrice: ev.amount ?? linked.sellerRevenue, discount: 0, sellerRevenue: ev.amount ?? linked.sellerRevenue,
              platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente', notes: NOTE(linked.date),
            });
            await markPaymentReceived(saleId, ev.date);
            await setOrderStatus(saleId, 'terminee', ev.date);
            await getDb().syncedEmails.update(linkedRow.id, { ref: saleId, note: 'Vente rétablie : paiement reçu après annulation automatique' });
            return { status: 'applied', ref: saleId, note: 'Paiement reçu : vente rétablie' };
          }
          return { status: 'ignored', note: 'Vente annulée dans l’application' };
        }
        if (linked.paymentStatus === 'recu') return { status: 'applied', ref: linked.id, note: 'Paiement déjà enregistré' };
      }
      const open = linked ?? findSale(ds, ev.title, (s) => s.orderStatus !== 'annulee' && s.paymentStatus === 'en_attente' && s.date <= ev.date);
      if (open) {
        const expected = open.sellerRevenue - refunded(ds, open.id);
        if (ev.amount !== null && ev.amount !== expected && refunded(ds, open.id) === 0)
          await correctSale(open.id, { sellerRevenue: ev.amount }, 'Montant viré par Vinted (e-mail « transaction finalisée »)');
        await markPaymentReceived(open.id, ev.date);
        if (['confirmee', 'expediee', 'en_attente'].includes(open.orderStatus)) await setOrderStatus(open.id, 'terminee', ev.date);
        return { status: 'applied', ref: open.id, note: 'Paiement reçu et vente terminée' };
      }
      const paid = findSale(ds, ev.title, (s) => s.orderStatus !== 'annulee' && s.paymentStatus === 'recu' && Math.abs(daysBetween(s.date, ev.date)) <= 30);
      if (paid) return { status: 'applied', ref: paid.id, note: 'Paiement déjà enregistré' };
      if (!auto) return { status: 'inbox', note: 'Vente finalisée sans vente enregistrée : indique l’article vendu.' };
      {
        // vente antérieure à la synchro : enregistrée directement, payée (article du stock ou créé)
        const item = findStockItem(ds, ev.title);
        const itemId = item?.id ?? (await autoItem(ev.title, ev.date));
        const amount = ev.amount ?? 0;
        const saleId = await recordSale({
          date: ev.date, itemIds: [itemId], listedPrice: amount, discount: 0, sellerRevenue: amount,
          platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente', notes: NOTE(ev.date),
        });
        await markPaymentReceived(saleId, ev.date);
        await setOrderStatus(saleId, 'terminee', ev.date);
        if (!item?.listingRef) await updateItem(itemId, { listingRef: ev.title });
        return { status: 'applied', ref: saleId, note: item ? 'Vente et paiement enregistrés' : "Vente et paiement enregistrés · article créé, prix d'achat à indiquer" };
      }
    }

    case 'shipped': {
      const s = linked !== undefined ? linked : findSale(ds, ev.title, (x) => x.orderStatus === 'confirmee' && x.date <= ev.date);
      if (s && s.orderStatus === 'confirmee') {
        await setOrderStatus(s.id, 'expediee', ev.date);
        return { status: 'applied', ref: s.id, note: 'Vente marquée expédiée' };
      }
      return { status: 'ignored', note: s ? 'Vente déjà au-delà de l’expédition' : 'Aucune vente à marquer comme expédiée' };
    }

    case 'cancelled': {
      const cancellable = (x: Sale) => x.orderStatus !== 'annulee' && x.paymentStatus === 'en_attente' && refunded(ds, x.id) === 0;
      const s = linked !== undefined ? (linked && cancellable(linked) ? linked : null) : findSale(ds, ev.title, (x) => cancellable(x) && x.date <= ev.date);
      if (s) {
        await cancelSale(s.id, ev.date);
        return { status: 'applied', ref: s.id, note: 'Vente annulée, article remis en vente' };
      }
      return { status: 'ignored', note: 'Aucune vente en cours à annuler' };
    }

    case 'invoice': {
      const dup = findDuplicateExpenses(ds.expenses, { amount: ev.amount, date: ev.date, supplier: 'Vinted', category: 'Frais de plateforme' });
      if (dup.length) return { status: 'applied', ref: dup[0].id, note: 'Dépense déjà enregistrée' };
      const id = await recordExpense({
        date: ev.date, amount: ev.amount, category: 'Frais de plateforme', supplier: 'Vinted', description: ev.label, saleId: null, attachmentId: null,
      });
      return { status: 'applied', ref: id, note: 'Dépense enregistrée (frais de plateforme)' };
    }

    case 'purchase': {
      const exists = ds.purchases.find((p) => p.source === 'Vinted' && p.date === ev.date && p.itemsTotal + p.commonFees === ev.total);
      if (exists) return { status: 'applied', ref: exists.id, note: 'Achat déjà enregistré' };
      const price = ev.article !== null && ev.article <= ev.total ? ev.article : ev.total;
      const { purchaseId } = await recordPurchase({
        date: ev.date, source: 'Vinted', paymentMethod: 'Vinted', commonFees: ev.total - price, lotPrice: null,
        notes: `${NOTE(ev.date)}${ev.seller ? ` — vendeur ${ev.seller}` : ''}`,
        lines: [{ name: ev.title, category: guessCategory(ev.title), price, targetPrice: null, status: 'achete' }],
      });
      return { status: 'applied', ref: purchaseId, note: 'Achat enregistré (frais de port et protection inclus dans le coût)' };
    }

    case 'purchase_refund':
      return { status: 'inbox', note: 'Un achat Vinted a été remboursé : corrige ou retire l’article correspondant.' };
  }
}

// ---------------------------------------------------------------------------
// Validation manuelle (liste « À valider »)
// ---------------------------------------------------------------------------

export interface NewItemInput {
  name: string;
  category: string;
  cost: Cents;
  purchaseDate: ISODate;
}

/** Associe une vente (ou une vente finalisée) à un article : existant, ou créé à partir du coût saisi. */
export async function resolveSale(rowId: string, target: { itemId: string } | { newItem: NewItemInput }) {
  const db = getDb();
  const row = await db.syncedEmails.get(rowId);
  if (!row || row.status !== 'inbox') throw new Error('Cet élément a déjà été traité.');
  const ev = row.event as VintedEvent;
  if (ev.kind !== 'sale' && ev.kind !== 'completed') throw new Error("Cet élément ne s'associe pas à un article.");
  let itemId: string;
  if ('itemId' in target) itemId = target.itemId;
  else {
    const n = target.newItem;
    const { itemIds } = await recordPurchase({
      date: n.purchaseDate, source: 'Ajouté à la synchro', commonFees: 0, lotPrice: null,
      notes: `Article créé à partir de l'e-mail Vinted du ${ev.date.split('-').reverse().join('/')}`,
      lines: [{ name: n.name, category: n.category, price: n.cost, targetPrice: null, status: 'en_vente' }],
    });
    itemId = itemIds[0];
  }
  const amount = ev.kind === 'sale' ? ev.amount : ev.amount ?? 0;
  const saleId = await recordSale({
    date: ev.date, itemIds: [itemId], listedPrice: amount, discount: 0, sellerRevenue: amount,
    platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: ev.kind === 'completed' ? 'recu' : 'en_attente', notes: NOTE(ev.date),
  });
  if (ev.kind === 'completed') await setOrderStatus(saleId, 'terminee', ev.date);
  const item = (await loadDataset()).items.find((i) => i.id === itemId);
  if (item && !item.listingRef) await updateItem(itemId, { listingRef: ev.title });
  await db.syncedEmails.update(rowId, { status: 'applied', ref: saleId, note: 'Associé manuellement', resolvedAt: now() });
  // les paiements / expéditions / annulations en attente de cette vente peuvent maintenant s'appliquer
  return processPending();
}

export async function dismissSynced(rowIds: string | string[]) {
  const db = getDb();
  const ids = Array.isArray(rowIds) ? rowIds : [rowIds];
  // le paiement / l'annulation / l'expédition d'une vente écartée sont écartés avec elle
  const pairing = pairEvents(await db.syncedEmails.toArray());
  const followUps = [...pairing.saleOf].filter(([, sale]) => ids.includes(sale.id)).map(([id]) => id);
  for (const id of followUps) {
    const r = await db.syncedEmails.get(id);
    if (r && r.status !== 'applied') await db.syncedEmails.update(id, { status: 'ignored', note: VENTE_ECARTEE, resolvedAt: now() });
  }
  for (const id of ids) await db.syncedEmails.update(id, { status: 'ignored', note: 'Écarté manuellement', resolvedAt: now() });
  return processPending();
}

/** Ventes « À valider » sans paiement ni annulation reçus depuis NO_PAYMENT_DAYS jours : sans doute remboursées. */
export function unpaidInboxSales(rows: SyncedEmail[], today: ISODate): SyncedEmail[] {
  const { closedBy } = pairEvents(rows);
  return rows.filter((r) => r.status === 'inbox' && r.kind === 'sale' && !closedBy.has(r.id) && daysBetween(r.date, today) >= NO_PAYMENT_DAYS);
}

// ---------------------------------------------------------------------------
// Synchronisation complète
// ---------------------------------------------------------------------------

export interface SyncResult {
  read: number;
  added: number;
  applied: number;
  inbox: number;
  waiting: number;
  /** ventes récentes (3 derniers jours) découvertes par cette synchro */
  newSales: { id: string; title: string; amount: number | null; recorded: boolean }[];
}

/** Au-delà, une vente découverte (import de l'historique) ne déclenche pas d'alerte. */
const ALERT_DAYS = 3;

/** Une seule synchronisation à la fois : un second appel pendant qu'une synchro tourne reçoit le même résultat. */
let inflight: Promise<SyncResult> | null = null;

export function syncNow(fetcher: typeof fetch = fetch, today: ISODate = new Date().toISOString().slice(0, 10)): Promise<SyncResult> {
  if (!inflight) inflight = runSync(fetcher, today).finally(() => { inflight = null; });
  return inflight;
}

const IMG = /\[image:[^\]]*\]/gi;
const stripImg = (t: string) => t.replace(IMG, ' ').replace(/\s+/g, ' ').trim();

/** Répare les titres enregistrés avant la correction du « [image: …] » de Gmail. */
export async function repairTitles() {
  const db = getDb();
  for (const r of await db.syncedEmails.toArray()) {
    if (!/\[image:/i.test(r.title)) continue;
    const ev = r.event && typeof r.event === 'object' && 'title' in (r.event as object) ? { ...(r.event as object), title: stripImg((r.event as { title: string }).title) } : r.event;
    await db.syncedEmails.update(r.id, { title: stripImg(r.title), event: ev });
  }
  for (const it of (await loadDataset()).items) {
    if (!/\[image:/i.test(it.name) && !/\[image:/i.test(it.listingRef)) continue;
    const name = stripImg(it.name).replace(/\s*[-–]\s*Taille\s+\S+$/i, '').trim() || it.name;
    await updateItem(it.id, { name, listingRef: stripImg(it.listingRef) });
  }
}

async function runSync(fetcher: typeof fetch, today: ISODate): Promise<SyncResult> {
  await repairTitles();
  const ds = await loadDataset();
  const { syncUrl, syncToken } = ds.settings;
  if (!syncUrl || !syncToken) throw new SyncError('La synchronisation Gmail n’est pas encore configurée.');
  const since = ds.settings.syncSince ?? ds.settings.trackingStart;
  // Gmail limite le nombre de lectures par jour : après une première lecture complète,
  // seuls les e-mails des derniers jours sont relus (les plus anciens sont déjà enregistrés).
  const incremental = ds.settings.lastSyncAt && ds.settings.syncedFrom === since;
  const from = incremental ? maxDate(since, addDays(ds.settings.lastSyncAt!.slice(0, 10), -INCREMENTAL_DAYS)) : since;
  const reply = await fetchVintedEmails(syncUrl, syncToken, from, fetcher);
  if (!incremental) await saveSettings({ syncedFrom: since });
  const emails = reply.messages;
  if (reply.version !== ds.settings.scriptVersion || reply.notifications !== ds.settings.scriptNotifications || (reply.topic && reply.topic !== ds.settings.ntfyTopic))
    await saveSettings({ scriptVersion: reply.version, scriptNotifications: reply.notifications, ...(reply.topic ? { ntfyTopic: reply.topic } : {}) });
  const db = getDb();
  const known = new Set((await db.syncedEmails.toArray()).map((e) => e.id));
  const added = await ingestEmails(emails.filter((e) => e.date.slice(0, 10) >= since));
  const s = await processPending(today);
  await saveSettings({ lastSyncAt: now() });
  const inbox = await db.syncedEmails.where('status').equals('inbox').count();
  const fresh = (await db.syncedEmails.where('date').aboveOrEqual(addDays(today, -ALERT_DAYS)).toArray())
    .filter((r) => r.kind === 'sale' && !known.has(r.id) && r.status !== 'ignored')
    .sort((a, b) => a.date.localeCompare(b.date));
  const newSales = fresh.map((r) => ({
    id: r.id, title: r.title, amount: (r.event as VintedEvent & { kind: 'sale' }).amount, recorded: r.status === 'applied',
  }));
  if (ds.settings.saleAlert !== false) announceSales(newSales);
  return { read: emails.length, added, applied: s.applied, inbox, waiting: s.waiting, newSales };
}
