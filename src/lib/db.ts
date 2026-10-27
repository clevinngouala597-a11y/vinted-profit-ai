import Dexie, { type Table } from 'dexie';
import type {
  Attachment,
  AuditLog,
  Expense,
  InventoryMovement,
  Item,
  Purchase,
  PurchaseLine,
  Refund,
  Sale,
  SaleLine,
  Settings,
  Transaction,
} from './types';

/**
 * Base locale (IndexedDB) : les données restent sur l'appareil, persistent après fermeture,
 * et peuvent être sauvegardées / restaurées depuis les Réglages.
 */
export class VPDatabase extends Dexie {
  settings!: Table<Settings, string>;
  items!: Table<Item, string>;
  purchases!: Table<Purchase, string>;
  purchaseLines!: Table<PurchaseLine, string>;
  sales!: Table<Sale, string>;
  saleLines!: Table<SaleLine, string>;
  refunds!: Table<Refund, string>;
  expenses!: Table<Expense, string>;
  transactions!: Table<Transaction, string>;
  inventoryMovements!: Table<InventoryMovement, string>;
  attachments!: Table<Attachment, string>;
  auditLogs!: Table<AuditLog, string>;

  constructor(name = 'vinted-profit-ai') {
    super(name);
    this.version(1).stores({
      settings: 'id',
      items: 'id, status, category, brand, purchaseId, purchaseDate, soldAt',
      purchases: 'id, date',
      purchaseLines: 'id, purchaseId, itemId',
      sales: 'id, date, orderStatus',
      saleLines: 'id, saleId, itemId',
      refunds: 'id, saleId, date',
      expenses: 'id, date, category, saleId',
      transactions: 'id, date, kind, refId',
      inventoryMovements: 'id, itemId, date',
      attachments: 'id',
      auditLogs: 'id, at, entityId',
    });
  }
}

export const DATA_TABLES = [
  'settings',
  'items',
  'purchases',
  'purchaseLines',
  'sales',
  'saleLines',
  'refunds',
  'expenses',
  'transactions',
  'inventoryMovements',
  'auditLogs',
] as const;

let current = new VPDatabase();
export const getDb = () => current;
/** Utilisé par les tests pour travailler sur une base isolée. */
export const setDb = (d: VPDatabase) => {
  current = d;
};

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* non bloquant */
  }
}
