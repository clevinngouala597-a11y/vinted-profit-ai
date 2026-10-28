/** Gestion des dressings : ajout, renommage, suppression (ses données reviennent au principal). */
import { loadDataset, saveSettings } from './actions';
import { getDb } from './db';
import { ALL, MAIN, shopsOf, type Shop } from './shops';

const uidShop = () => 'd' + Math.random().toString(36).slice(2, 8);
const clean = (p: string) => p.trim().replace(/^@/, '');

function checkPseudo(list: Shop[], pseudo: string, except?: string) {
  if (pseudo && list.some((x) => x.id !== except && x.pseudo.toLowerCase() === pseudo.toLowerCase()))
    throw new Error('Ce pseudo est déjà utilisé par un autre dressing.');
}

export async function addShop(name: string, pseudo: string) {
  const s = (await loadDataset()).settings;
  const list = shopsOf(s);
  if (!name.trim()) throw new Error('Donne un nom à ce dressing.');
  if (list.length >= 6) throw new Error('6 dressings maximum.');
  checkPseudo(list, clean(pseudo));
  const shop = { id: uidShop(), name: name.trim(), pseudo: clean(pseudo) };
  await saveSettings({ shops: [...list, shop] });
  return shop.id;
}

export async function updateShop(id: string, patch: { name?: string; pseudo?: string }) {
  const list = shopsOf((await loadDataset()).settings);
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('Donne un nom à ce dressing.');
  if (patch.pseudo !== undefined) checkPseudo(list, clean(patch.pseudo), id);
  await saveSettings({ shops: list.map((x) => (x.id === id ? { ...x, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.pseudo !== undefined ? { pseudo: clean(patch.pseudo) } : {}) } : x)) });
}

/** Supprime un dressing : ses achats, articles, ventes et dépenses passent dans le dressing principal. */
export async function deleteShop(id: string) {
  if (id === MAIN) throw new Error('Le dressing principal ne peut pas être supprimé.');
  const db = getDb();
  await db.transaction('rw', [db.purchases, db.items, db.sales, db.expenses, db.syncedEmails], async () => {
    const unset = (r: { shop?: string }) => { if (r.shop === id) delete r.shop; };
    await db.purchases.toCollection().modify(unset);
    await db.items.toCollection().modify(unset);
    await db.sales.toCollection().modify(unset);
    await db.expenses.toCollection().modify(unset);
    await db.syncedEmails.toCollection().modify(unset);
  });
  const s = (await loadDataset()).settings;
  const rest = shopsOf(s).filter((x) => x.id !== id);
  await saveSettings({ shops: rest.length > 1 ? rest : [], activeShop: s.activeShop === id ? ALL : s.activeShop });
}

export const setActiveShop = (id: string) => saveSettings({ activeShop: id });
