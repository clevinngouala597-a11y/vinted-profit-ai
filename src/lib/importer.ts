/**
 * Import CSV : lecture tolérante (séparateur ; , ou tabulation, guillemets, BOM), association automatique
 * des colonnes, validation ligne par ligne, détection des doublons, puis écriture via les opérations
 * habituelles (donc mêmes règles de calcul et même journal que la saisie manuelle).
 * Rien n'est écrit avant la confirmation de l'utilisateur.
 */
import { findDuplicateExpenses, recordExpense, recordPurchase, recordSale, saveSettings, setOrderStatus } from './actions';
import { parseEuros, type Cents } from './money';
import { DEFAULT_CATEGORIES, EXPENSE_CATEGORIES, type Dataset, type ISODate } from './types';

// ---------------------------------------------------------------------------
// Lecture du fichier
// ---------------------------------------------------------------------------

export function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5).join('\n');
  const count = (d: string) => firstLines.split(d).length - 1;
  return [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
}

export function parseCSV(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const d = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/** Dates acceptées : 31/12/2026, 31/12/26, 31-12-2026, 31.12.2026, 2026-12-31. */
export function parseDate(s: string): ISODate | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
    if (y < 100) y += 2000;
  } else return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Champs et association automatique
// ---------------------------------------------------------------------------

export type ImportKind = 'articles' | 'depenses';

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  synonyms: string[];
}

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  articles: [
    { key: 'name', label: "Nom de l'article", required: true, synonyms: ['nom', 'article', 'produit', 'titre', 'designation', 'libelle', 'description'] },
    { key: 'purchaseDate', label: "Date d'achat", required: true, synonyms: ['date achat', "date d'achat", 'achete le', 'date'] },
    { key: 'purchasePrice', label: "Prix d'achat", required: true, synonyms: ['prix achat', "prix d'achat", 'achat', 'cout', 'paye', 'prix paye'] },
    { key: 'fees', label: "Frais d'achat", required: false, synonyms: ['frais achat', "frais d'achat", 'frais de port achat', 'livraison achat'] },
    { key: 'category', label: 'Catégorie', required: false, synonyms: ['categorie', 'type', 'rayon'] },
    { key: 'brand', label: 'Marque', required: false, synonyms: ['marque', 'brand'] },
    { key: 'size', label: 'Taille', required: false, synonyms: ['taille', 'size', 'pointure'] },
    { key: 'targetPrice', label: 'Prix de vente souhaité', required: false, synonyms: ['prix souhaite', 'prix prevu', 'prix annonce', 'prix affiche', 'prix cible'] },
    { key: 'saleDate', label: 'Date de vente', required: false, synonyms: ['date vente', 'date de vente', 'vendu le'] },
    { key: 'salePrice', label: 'Montant encaissé à la vente', required: false, synonyms: ['prix de vente', 'prix vente', 'vendu', 'montant encaisse', 'encaisse', 'revenu', 'vente'] },
    { key: 'saleCosts', label: 'Frais de vente', required: false, synonyms: ['frais vente', 'frais de vente', 'emballage', 'frais envoi'] },
    { key: 'notes', label: 'Notes', required: false, synonyms: ['notes', 'note', 'commentaire', 'remarque'] },
  ],
  depenses: [
    { key: 'date', label: 'Date', required: true, synonyms: ['date'] },
    { key: 'amount', label: 'Montant', required: true, synonyms: ['montant', 'prix', 'total', 'somme', 'cout'] },
    { key: 'category', label: 'Catégorie', required: false, synonyms: ['categorie', 'type', 'poste'] },
    { key: 'supplier', label: 'Fournisseur', required: false, synonyms: ['fournisseur', 'magasin', 'vendeur', 'enseigne'] },
    { key: 'description', label: 'Description', required: false, synonyms: ['description', 'libelle', 'objet', 'detail', 'designation'] },
  ],
};

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'_\-()€]/g, ' ').replace(/\s+/g, ' ').trim();

/** Associe chaque champ à la colonne dont l'en-tête lui ressemble le plus (chaque colonne n'est utilisée qu'une fois). */
export function autoMap(kind: ImportKind, headers: string[]): Record<string, number | null> {
  const used = new Set<number>();
  const map: Record<string, number | null> = {};
  const H = headers.map(norm);
  // 1er passage : correspondance exacte ; 2e : l'en-tête contient le synonyme (synonymes longs d'abord)
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of FIELDS[kind]) {
      if (map[f.key] !== undefined && map[f.key] !== null) continue;
      const syns = [...f.synonyms, norm(f.label)].map(norm).sort((a, b) => b.length - a.length);
      let found: number | null = null;
      for (const s of syns) {
        const idx = H.findIndex((h, i) => !used.has(i) && (pass === 'exact' ? h === s : h.includes(s)));
        if (idx >= 0) { found = idx; break; }
      }
      map[f.key] = found;
      if (found !== null) used.add(found);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ArticleRow {
  line: number;
  name: string;
  category: string;
  brand: string;
  size: string;
  purchaseDate: ISODate;
  purchasePrice: Cents;
  fees: Cents;
  targetPrice: Cents | null;
  saleDate: ISODate | null;
  salePrice: Cents | null;
  saleCosts: Cents;
  notes: string;
}

export interface ExpenseRow {
  line: number;
  date: ISODate;
  amount: Cents;
  category: string;
  supplier: string;
  description: string;
}

export interface Validation<T> {
  valid: T[];
  duplicates: (T & { reason: string })[];
  rejected: { line: number; reason: string; raw: string[] }[];
}

const money = (s: string | undefined): Cents | null | 'invalid' => {
  if (s === undefined || s.trim() === '') return null;
  const v = parseEuros(s);
  return v === null ? 'invalid' : v;
};

function matchCategory(raw: string, known: string[], fallback: string): string {
  if (!raw.trim()) return fallback;
  const n = norm(raw);
  const words = (c: string) => norm(c).split(' ').filter((w) => w.length > 2);
  return (
    known.find((c) => norm(c) === n) ??
    known.find((c) => norm(c).startsWith(n) || n.startsWith(norm(c))) ??
    // « Jeans » → « Pantalons et jeans », « pull » → « Sweats et pulls »
    known.find((c) => words(c).some((w) => w === n || (n.length >= 4 && w.startsWith(n)) || (w.length >= 4 && n.startsWith(w)))) ??
    raw.trim()
  );
}

/**
 * @param rows lignes du fichier SANS l'en-tête
 * @param firstLine numéro de la première ligne de données dans le fichier (pour le rapport)
 */
export function validateArticles(ds: Dataset, rows: string[][], map: Record<string, number | null>, firstLine = 2, today: ISODate = new Date().toISOString().slice(0, 10)): Validation<ArticleRow> {
  const out: Validation<ArticleRow> = { valid: [], duplicates: [], rejected: [] };
  const get = (r: string[], k: string) => (map[k] === null || map[k] === undefined ? undefined : r[map[k]!]);
  const cats = [...DEFAULT_CATEGORIES, ...ds.settings.customCategories];
  const seen = new Set(ds.items.map((i) => `${norm(i.name)}|${i.purchaseDate}|${i.purchasePrice}`));
  rows.forEach((r, k) => {
    const line = firstLine + k;
    const reject = (reason: string) => out.rejected.push({ line, reason, raw: r });
    const name = (get(r, 'name') ?? '').trim();
    if (!name) return reject('nom manquant');
    const pd = parseDate(get(r, 'purchaseDate') ?? '');
    if (!pd) return reject(`date d'achat illisible (« ${get(r, 'purchaseDate') ?? ''} »)`);
    if (pd > today) return reject("date d'achat dans le futur");
    const price = money(get(r, 'purchasePrice'));
    if (price === null || price === 'invalid') return reject(`prix d'achat illisible (« ${get(r, 'purchasePrice') ?? ''} »)`);
    if (price < 0) return reject("prix d'achat négatif");
    const fees = money(get(r, 'fees'));
    if (fees === 'invalid' || (fees ?? 0) < 0) return reject("frais d'achat illisibles");
    const target = money(get(r, 'targetPrice'));
    if (target === 'invalid') return reject('prix souhaité illisible');
    const saleRaw = (get(r, 'saleDate') ?? '').trim();
    const sd = saleRaw ? parseDate(saleRaw) : null;
    if (saleRaw && !sd) return reject(`date de vente illisible (« ${saleRaw} »)`);
    const sp = money(get(r, 'salePrice'));
    if (sp === 'invalid') return reject('montant de vente illisible');
    if (sd && sp === null) return reject('date de vente sans montant encaissé');
    if (!sd && sp !== null) return reject('montant de vente sans date de vente');
    if (sd && sd < pd) return reject('vendu avant d’avoir été acheté');
    if (sd && sd > today) return reject('date de vente dans le futur');
    const sc = money(get(r, 'saleCosts'));
    if (sc === 'invalid' || (sc ?? 0) < 0) return reject('frais de vente illisibles');
    const row: ArticleRow = {
      line, name,
      category: matchCategory(get(r, 'category') ?? '', cats, 'Autres vêtements'),
      brand: (get(r, 'brand') ?? '').trim(),
      size: (get(r, 'size') ?? '').trim(),
      purchaseDate: pd, purchasePrice: price, fees: fees ?? 0, targetPrice: target,
      saleDate: sd, salePrice: sd ? (sp as Cents) : null, saleCosts: sc ?? 0,
      notes: (get(r, 'notes') ?? '').trim(),
    };
    const key = `${norm(name)}|${pd}|${price}`;
    if (seen.has(key)) out.duplicates.push({ ...row, reason: 'même nom, même date et même prix qu’un article existant ou une ligne précédente' });
    else { seen.add(key); out.valid.push(row); }
  });
  return out;
}

export function validateExpenses(ds: Dataset, rows: string[][], map: Record<string, number | null>, firstLine = 2, today: ISODate = new Date().toISOString().slice(0, 10)): Validation<ExpenseRow> {
  const out: Validation<ExpenseRow> = { valid: [], duplicates: [], rejected: [] };
  const get = (r: string[], k: string) => (map[k] === null || map[k] === undefined ? undefined : r[map[k]!]);
  const accepted: { amount: Cents; date: ISODate; supplier: string; category: string; id: string; description: string; saleId: null; attachmentId: null; validated: boolean; createdAt: string }[] = [];
  rows.forEach((r, k) => {
    const line = firstLine + k;
    const reject = (reason: string) => out.rejected.push({ line, reason, raw: r });
    const date = parseDate(get(r, 'date') ?? '');
    if (!date) return reject(`date illisible (« ${get(r, 'date') ?? ''} »)`);
    if (date > today) return reject('date dans le futur');
    const amount = money(get(r, 'amount'));
    if (amount === null || amount === 'invalid') return reject(`montant illisible (« ${get(r, 'amount') ?? ''} »)`);
    if (amount <= 0) return reject('montant nul ou négatif');
    const row: ExpenseRow = {
      line, date, amount,
      category: matchCategory(get(r, 'category') ?? '', EXPENSE_CATEGORIES, 'Autres dépenses'),
      supplier: (get(r, 'supplier') ?? '').trim(),
      description: (get(r, 'description') ?? '').trim(),
    };
    if (!EXPENSE_CATEGORIES.includes(row.category)) row.category = 'Autres dépenses';
    const dup = findDuplicateExpenses([...ds.expenses, ...accepted], row);
    if (dup.length) out.duplicates.push({ ...row, reason: `ressemble à une dépense du ${dup[0].date.split('-').reverse().join('/')} (${(dup[0].amount / 100).toFixed(2).replace('.', ',')} €)` });
    else {
      out.valid.push(row);
      accepted.push({ ...row, id: `l${line}`, saleId: null, attachmentId: null, validated: true, createdAt: '' });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Écriture (après confirmation)
// ---------------------------------------------------------------------------

export async function commitArticles(ds: Dataset, rows: ArticleRow[], fileName: string, onProgress?: (done: number) => void) {
  const known = new Set([...DEFAULT_CATEGORIES, ...ds.settings.customCategories]);
  const newCats = [...new Set(rows.map((r) => r.category).filter((c) => !known.has(c)))];
  if (newCats.length) await saveSettings({ customCategories: [...ds.settings.customCategories, ...newCats] });
  let sold = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const { itemIds } = await recordPurchase({
      date: r.purchaseDate, source: 'Import CSV', commonFees: r.fees, lotPrice: null,
      notes: `Importé depuis « ${fileName} », ligne ${r.line}${r.notes ? ` — ${r.notes}` : ''}`,
      lines: [{ name: r.name, category: r.category, brand: r.brand, size: r.size, price: r.purchasePrice, targetPrice: r.targetPrice, status: 'en_vente' }],
    });
    if (r.saleDate && r.salePrice !== null) {
      const saleId = await recordSale({
        date: r.saleDate, itemIds, listedPrice: r.salePrice, discount: 0, sellerRevenue: r.salePrice,
        platformFees: 0, packagingCost: r.saleCosts, otherCosts: 0, paymentStatus: 'recu',
        notes: `Importé depuis « ${fileName} », ligne ${r.line}`,
      });
      // une vente historique est considérée comme terminée
      await setOrderStatus(saleId, 'terminee', r.saleDate);
      sold++;
    }
    onProgress?.(i + 1);
  }
  return { items: rows.length, sold, newCategories: newCats };
}

export async function commitExpenses(rows: ExpenseRow[], fileName: string, onProgress?: (done: number) => void) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await recordExpense({
      date: r.date, amount: r.amount, category: r.category, supplier: r.supplier,
      description: r.description || `Import « ${fileName} » ligne ${r.line}`, saleId: null, attachmentId: null,
    });
    onProgress?.(i + 1);
  }
  return { expenses: rows.length };
}
