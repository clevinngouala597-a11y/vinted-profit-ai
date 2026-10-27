import type { Cents } from './money';

/** Date au format ISO "AAAA-MM-JJ" (jour local de l'utilisateur). */
export type ISODate = string;
/** Horodatage ISO complet. */
export type ISOTime = string;

export type ActivityStatus = 'particulier' | 'micro' | 'autre';

export interface Settings {
  id: 'main';
  onboarded: boolean;
  businessName: string;
  activityStatus: ActivityStatus;
  trackingStart: ISODate;
  initialCash: Cents;
  monthlyProfitGoal: Cents;
  maxPurchaseBudget: Cents;
  minProfitPerItem: Cents;
  reinvestPct: number; // 0..100
  safetyReserve: Cents;
  staleDays: number; // 15 | 30 | 60 | 90
  customCategories: string[];
  // --- module fiscal ---
  /** Date de début d'activité déclarée (micro-entreprise), si différente du début du suivi. */
  activityStart: ISODate | null;
  vatRegime: 'franchise' | 'assujetti' | 'inconnu';
  declarationFrequency: 'mensuelle' | 'trimestrielle';
  versementLiberatoire: boolean;
  // --- notifications ---
  disabledNotifications: string[];
  lastBackupAt: ISOTime | null;
  // --- synchronisation des e-mails Vinted (script Google) ---
  syncUrl: string;
  syncToken: string;
  /** Les e-mails antérieurs à cette date ne sont pas importés. */
  syncSince: ISODate | null;
  lastSyncAt: ISOTime | null;
  /** Bannière et son de caisse à chaque nouvelle vente. */
  saleAlert: boolean;
  /** Synchro : tout enregistrer sans passer par « À valider » (articles inconnus créés avec un coût à compléter). */
  autoRecord: boolean;
  /** Afficher la gestion du stock (onglet, tuiles, alertes). Masquée par défaut : la synchro s'en occupe. */
  showStock: boolean;
  /** Sujet ntfy secret des notifications « appli fermée ». */
  ntfyTopic: string;
  /** Version du script Google installé (renvoyée par le script) ; null = inconnue. */
  scriptVersion: number | null;
  /** Le script vérifie Gmail toutes les 5 minutes (notifications actives). */
  scriptNotifications: boolean;
  driveBackupAt: ISOTime | null;
  /** Date « à partir du » de la dernière lecture complète de Gmail (ensuite : lecture des derniers jours seulement). */
  syncedFrom: ISODate | null;
}

export const DEFAULT_CATEGORIES = [
  'T-shirts',
  'Sweats et pulls',
  'Vestes et manteaux',
  'Pantalons et jeans',
  'Shorts',
  'Chaussures',
  'Accessoires',
  'Sacs',
  'Autres vêtements',
];

export type ItemStatus =
  | 'a_acheter'
  | 'achete'
  | 'a_preparer'
  | 'pret'
  | 'en_vente'
  | 'reserve'
  | 'vendu'
  | 'expedie'
  | 'termine'
  | 'retourne'
  | 'rembourse'
  | 'retire'
  | 'perdu';

export const STATUS_LABEL: Record<ItemStatus, string> = {
  a_acheter: 'À acheter',
  achete: 'Acheté',
  a_preparer: 'À préparer',
  pret: 'Prêt à publier',
  en_vente: 'En vente',
  reserve: 'Réservé',
  vendu: 'Vendu',
  expedie: 'Expédié',
  termine: 'Terminé',
  retourne: 'Retourné',
  rembourse: 'Remboursé',
  retire: 'Retiré de la vente',
  perdu: 'Perdu',
};

/** Statuts pour lesquels l'article est physiquement dans le stock de l'utilisateur. */
export const IN_STOCK: ItemStatus[] = ['achete', 'a_preparer', 'pret', 'en_vente', 'reserve', 'retourne'];
/** Statuts depuis lesquels on peut vendre. */
export const SELLABLE: ItemStatus[] = ['achete', 'a_preparer', 'pret', 'en_vente', 'reserve', 'retourne'];

/** Transitions manuelles autorisées (les passages à vendu/expédié/terminé/remboursé passent par les ventes). */
export const MANUAL_TRANSITIONS: Partial<Record<ItemStatus, ItemStatus[]>> = {
  achete: ['a_preparer', 'pret', 'en_vente', 'retire', 'perdu'],
  a_preparer: ['pret', 'en_vente', 'retire', 'perdu'],
  pret: ['a_preparer', 'en_vente', 'retire', 'perdu'],
  en_vente: ['reserve', 'pret', 'retire', 'perdu'],
  reserve: ['en_vente', 'retire', 'perdu'],
  retourne: ['a_preparer', 'pret', 'en_vente', 'retire', 'perdu'],
};

export interface Item {
  id: string;
  name: string;
  category: string;
  brand: string;
  size: string;
  color: string;
  condition: string;
  description: string;
  purchaseId: string | null;
  purchaseDate: ISODate;
  /** Part du prix d'achat attribuée à cet article. */
  purchasePrice: Cents;
  /** Part des frais d'achat attribuée à cet article. */
  directFees: Cents;
  targetPrice: Cents | null;
  minPrice: Cents | null;
  status: ItemStatus;
  listedAt: ISODate | null;
  soldAt: ISODate | null;
  /** Date de sortie du stock sans vente (retiré, perdu). */
  writtenOffAt: ISODate | null;
  notes: string;
  listingRef: string;
  photoIds: string[];
  /** Article créé automatiquement par la synchro : son prix d'achat (0 en attendant) reste à indiquer. */
  costPending?: boolean;
  createdAt: ISOTime;
  updatedAt: ISOTime;
}

export interface Purchase {
  id: string;
  date: ISODate;
  source: string;
  paymentMethod: string;
  /** Total des prix des articles. */
  itemsTotal: Cents;
  /** Frais communs (déplacement, livraison, protection acheteur…). */
  commonFees: Cents;
  notes: string;
  createdAt: ISOTime;
}

export interface PurchaseLine {
  id: string;
  purchaseId: string;
  itemId: string;
  price: Cents;
  allocatedFees: Cents;
}

export type PaymentStatus = 'en_attente' | 'recu';
export type OrderStatus = 'en_attente' | 'confirmee' | 'expediee' | 'terminee' | 'annulee' | 'retournee' | 'remboursee';

export const ORDER_LABEL: Record<OrderStatus, string> = {
  en_attente: 'En attente',
  confirmee: 'À confirmer',
  expediee: 'Expédiée',
  terminee: 'Terminée',
  annulee: 'Annulée',
  retournee: 'Retournée',
  remboursee: 'Remboursée',
};

export interface Sale {
  id: string;
  date: ISODate;
  /** Prix affiché total des articles (informatif). */
  listedPrice: Cents;
  /** Réduction accordée par le vendeur (informatif : le revenu retenu est déjà net). */
  discount: Cents;
  /** Montant réellement encaissé par le vendeur pour cette vente. Les frais payés par l'acheteur n'y sont pas. */
  sellerRevenue: Cents;
  /** Frais de plateforme réellement à la charge du vendeur, NON déjà déduits du montant encaissé. */
  platformFees: Cents;
  packagingCost: Cents;
  otherCosts: Cents;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  shippedAt: ISODate | null;
  closedAt: ISODate | null;
  cancelledAt: ISODate | null;
  notes: string;
  createdAt: ISOTime;
}

export interface SaleLine {
  id: string;
  saleId: string;
  itemId: string;
  /** Part du revenu vendeur attribuée à l'article. */
  revenue: Cents;
  /** Part des coûts de vente attribuée à l'article. */
  costs: Cents;
  /** Coût de revient de l'article figé au moment de la vente. */
  cogs: Cents;
}

export interface Refund {
  id: string;
  saleId: string;
  date: ISODate;
  amount: Cents;
  /** L'article a été effectivement récupéré (il revient alors en stock). */
  itemRecovered: boolean;
  recoveredAt: ISODate | null;
  /** Coûts supplémentaires non récupérables (frais de retour…). */
  extraCosts: Cents;
  notes: string;
  createdAt: ISOTime;
}

export const EXPENSE_CATEGORIES = [
  'Emballages',
  'Matériel photo',
  'Nettoyage et entretien',
  'Déplacements',
  'Frais de plateforme',
  'Abonnements',
  'Autres dépenses',
];

export interface Expense {
  id: string;
  date: ISODate;
  amount: Cents;
  category: string;
  supplier: string;
  description: string;
  /** Si renseigné, la dépense est un coût direct de cette vente (et n'est pas comptée en frais généraux). */
  saleId: string | null;
  attachmentId: string | null;
  validated: boolean;
  createdAt: ISOTime;
}

export type TxKind = 'solde_initial' | 'achat' | 'vente' | 'frais_vente' | 'depense' | 'remboursement' | 'ajustement';

/** Mouvement de trésorerie. amount > 0 = encaissement, < 0 = décaissement. */
export interface Transaction {
  id: string;
  date: ISODate;
  amount: Cents;
  kind: TxKind;
  status: 'confirme' | 'en_attente' | 'annule';
  refType: 'purchase' | 'sale' | 'expense' | 'refund' | 'item' | null;
  refId: string | null;
  label: string;
  /** Pour un ajustement : il corrige une recette (montant encaissé) ou des frais. */
  sub?: 'recette' | 'frais';
  createdAt: ISOTime;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  date: ISODate;
  kind: 'entree' | 'sortie_vente' | 'retour_stock' | 'annulation_vente' | 'sortie_perte' | 'sortie_retrait';
  refId: string | null;
  createdAt: ISOTime;
}

export interface Attachment {
  id: string;
  blob: Blob;
  mime: string;
  createdAt: ISOTime;
}

export interface AuditLog {
  id: string;
  at: ISOTime;
  entity: string;
  entityId: string;
  action: string;
  details: string;
}

/**
 * Objectifs d'un mois ("AAAA-MM"). Un mois sans objectifs propres reprend ceux du dernier mois renseigné :
 * modifier les objectifs d'un mois ne change jamais ceux des mois passés.
 * Une valeur 0 (ou null) signifie « pas d'objectif ».
 */
export interface Goal {
  id: string; // "AAAA-MM"
  revenue: Cents; // chiffre d'affaires minimum
  profit: Cents; // bénéfice commercial minimum
  salesCount: number; // articles vendus minimum
  minMargin: number; // marge commerciale minimale, en %
  maxPurchases: Cents; // budget d'achat maximal du mois
  maxStockCount: number; // stock maximal en fin de mois (objectif de réduction)
  cashToKeep: Cents; // trésorerie minimale à conserver
  updatedAt: ISOTime;
}

/** E-mail Vinted déjà lu, et ce qu'il est devenu. */
export interface SyncedEmail {
  id: string; // identifiant Gmail du message
  kind: string;
  date: ISODate;
  title: string;
  /** Événement extrait (voir src/lib/vinted/parse.ts). */
  event: unknown;
  /** applied : enregistré ; inbox : à valider ; waiting : attend une vente encore à valider ; ignored : écarté. */
  status: 'applied' | 'inbox' | 'waiting' | 'ignored';
  ref: string | null;
  note: string;
  createdAt: ISOTime;
  resolvedAt: ISOTime | null;
}

/** Notification masquée par l'utilisateur (les notifications elles-mêmes sont recalculées). */
export interface NotificationState {
  id: string;
  dismissedAt: ISOTime;
}

/** Ensemble des données de l'utilisateur, utilisé par le moteur de calcul (fonctions pures). */
export interface Dataset {
  goals: Goal[];
  settings: Settings;
  items: Item[];
  purchases: Purchase[];
  purchaseLines: PurchaseLine[];
  sales: Sale[];
  saleLines: SaleLine[];
  refunds: Refund[];
  expenses: Expense[];
  transactions: Transaction[];
}
