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
import { normTitle, parseVintedEmail, titleSimilarity, type RawEmail, type VintedEvent } from './parse';

export const MATCH_THRESHOLD = 0.75;
const WAIT_DAYS = 45;
const NOTE = (d: ISODate) => `Synchronisé depuis l'e-mail Vinted du ${d.split('-').reverse().join('/')}`;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Récupération
// ---------------------------------------------------------------------------

export class SyncError extends Error {}

export async function fetchVintedEmails(url: string, token: string, since: ISODate, fetcher: typeof fetch = fetch): Promise<RawEmail[]> {
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw new SyncError("L'adresse du script doit commencer par https://script.google.com/");
  const u = `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}&after=${since.replace(/-/g, '/')}`;
  let res: Response;
  try {
    res = await fetcher(u, { method: 'GET', redirect: 'follow' });
  } catch {
    throw new SyncError('Impossible de joindre le script Google. Vérifie ta connexion internet.');
  }
  if (!res.ok) throw new SyncError(`Le script Google a répondu avec une erreur (${res.status}). Vérifie qu'il est déployé en « Application Web » accessible à « Tout le monde ».`);
  let body: { error?: string; messages?: RawEmail[] };
  try {
    body = await res.json();
  } catch {
    throw new SyncError("Réponse illisible : vérifie que l'adresse est bien celle de l'application Web (elle se termine par /exec).");
  }
  if (body.error === 'unauthorized') throw new SyncError('Clé secrète refusée : le script et l’application n’ont pas la même clé.');
  if (body.error) throw new SyncError(`Erreur du script Google : ${body.error}`);
  if (!Array.isArray(body.messages)) throw new SyncError('Réponse inattendue du script Google.');
  return body.messages;
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

/** Vente déjà enregistrée qui correspond au titre (filtrée par `accept`), la plus ancienne d'abord. */
export function findSale(ds: Dataset, title: string, accept: (s: Sale) => boolean): Sale | null {
  return (
    ds.sales
      .filter(accept)
      .filter((s) => saleItems(ds, s).some((i) => score(i, title) >= MATCH_THRESHOLD))
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  );
}

const refunded = (ds: Dataset, saleId: string) => sum(ds.refunds.filter((r) => r.saleId === saleId).map((r) => r.amount));
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
  const pending = (await db.syncedEmails.where('status').equals('waiting').toArray()).sort(
    (a, b) => a.date.localeCompare(b.date) || ORDER[(a.event as VintedEvent).kind] - ORDER[(b.event as VintedEvent).kind],
  );
  const summary = { applied: 0, inbox: 0, waiting: 0 };
  for (const row of pending) {
    const ev = row.event as VintedEvent;
    let out: Outcome;
    try {
      out = await applyEvent(ev, today);
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
  return summary;
}

/** Une vente encore à valider porte-t-elle ce titre ? (les événements qui en dépendent attendent alors) */
async function saleAwaitingValidation(title: string): Promise<boolean> {
  const rows = await getDb().syncedEmails.where('status').anyOf('inbox', 'waiting').toArray();
  return rows.some((r) => r.kind === 'sale' && titleSimilarity(r.title, title) >= MATCH_THRESHOLD);
}

async function applyEvent(ev: VintedEvent, today: ISODate): Promise<Outcome> {
  const ds = await loadDataset();
  switch (ev.kind) {
    case 'sale': {
      // déjà saisie à la main (même article, à quelques jours près) ?
      const manual = findSale(ds, ev.title, (s) => s.orderStatus !== 'annulee' && Math.abs(daysBetween(s.date, ev.date)) <= 3);
      if (manual) return { status: 'applied', ref: manual.id, note: 'Vente déjà enregistrée' };
      const item = findStockItem(ds, ev.title);
      if (!item) return { status: 'inbox', note: "Aucun article du stock ne correspond : indique l'article vendu." };
      const saleId = await recordSale({
        date: ev.date, itemIds: [item.id], listedPrice: ev.amount, discount: 0, sellerRevenue: ev.amount,
        platformFees: 0, packagingCost: 0, otherCosts: 0, paymentStatus: 'en_attente', notes: NOTE(ev.date),
      });
      if (!item.listingRef) await updateItem(item.id, { listingRef: ev.title });
      return { status: 'applied', ref: saleId, note: `Vente enregistrée pour « ${item.name} »` };
    }

    case 'completed': {
      const open = findSale(ds, ev.title, (s) => s.orderStatus !== 'annulee' && s.paymentStatus === 'en_attente' && s.date <= ev.date);
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
      if (await saleAwaitingValidation(ev.title)) return waitOrDrop(ev, today, 'En attente de la vente correspondante');
      return { status: 'inbox', note: 'Vente finalisée sans vente enregistrée : indique l’article vendu.' };
    }

    case 'shipped': {
      const s = findSale(ds, ev.title, (x) => x.orderStatus === 'confirmee');
      if (s) {
        await setOrderStatus(s.id, 'expediee', ev.date);
        return { status: 'applied', ref: s.id, note: 'Vente marquée expédiée' };
      }
      if (await saleAwaitingValidation(ev.title)) return waitOrDrop(ev, today, 'En attente de la vente correspondante');
      return { status: 'ignored', note: 'Aucune vente à marquer comme expédiée' };
    }

    case 'cancelled': {
      const s = findSale(ds, ev.title, (x) => x.orderStatus !== 'annulee' && x.paymentStatus === 'en_attente' && refunded(ds, x.id) === 0 && x.date <= ev.date);
      if (s) {
        await cancelSale(s.id, ev.date);
        return { status: 'applied', ref: s.id, note: 'Vente annulée, article remis en vente' };
      }
      if (await saleAwaitingValidation(ev.title)) return waitOrDrop(ev, today, 'En attente de la vente correspondante');
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

function waitOrDrop(ev: VintedEvent, today: ISODate, note: string): Outcome {
  return daysBetween(ev.date, today) > WAIT_DAYS ? { status: 'ignored', note: 'Aucune vente correspondante après 45 jours' } : { status: 'waiting', note };
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

export async function dismissSynced(rowId: string) {
  await getDb().syncedEmails.update(rowId, { status: 'ignored', note: 'Écarté manuellement', resolvedAt: now() });
  return processPending();
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
}

/** Une seule synchronisation à la fois : un second appel pendant qu'une synchro tourne reçoit le même résultat. */
let inflight: Promise<SyncResult> | null = null;

export function syncNow(fetcher: typeof fetch = fetch, today: ISODate = new Date().toISOString().slice(0, 10)): Promise<SyncResult> {
  if (!inflight) inflight = runSync(fetcher, today).finally(() => { inflight = null; });
  return inflight;
}

async function runSync(fetcher: typeof fetch, today: ISODate): Promise<SyncResult> {
  const ds = await loadDataset();
  const { syncUrl, syncToken } = ds.settings;
  if (!syncUrl || !syncToken) throw new SyncError('La synchronisation Gmail n’est pas encore configurée.');
  const since = ds.settings.syncSince ?? ds.settings.trackingStart;
  const emails = await fetchVintedEmails(syncUrl, syncToken, since, fetcher);
  const added = await ingestEmails(emails.filter((e) => e.date.slice(0, 10) >= since));
  const s = await processPending(today);
  await saveSettings({ lastSyncAt: now() });
  const inbox = await getDb().syncedEmails.where('status').equals('inbox').count();
  return { read: emails.length, added, applied: s.applied, inbox, waiting: s.waiting };
}
