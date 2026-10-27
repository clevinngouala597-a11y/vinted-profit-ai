/**
 * Exports CSV (séparateur « ; », virgule décimale, UTF-8 avec BOM : s'ouvre directement dans Excel en français)
 * et sauvegarde / restauration complète au format JSON (photos incluses).
 */
import { getDb, DATA_TABLES } from './db';
import { itemCost, periodMetrics, saleBreakdown, type PeriodMetrics } from './engine';
import { formatPercent } from './money';
import { formatDate, type Range } from './period';
import { ORDER_LABEL, STATUS_LABEL, type Dataset } from './types';

const eur = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function csv(meta: string[][], header: string[], rows: unknown[][]): string {
  const lines = [...meta.map((m) => m.map(cell).join(';')), '', header.map(cell).join(';'), ...rows.map((r) => r.map(cell).join(';'))];
  return '﻿' + lines.join('\r\n');
}

function metaBlock(title: string, range: Range | null, filters: string, definitions: string[]): string[][] {
  return [
    [title],
    ['Période', range ? `du ${formatDate(range.from)} au ${formatDate(range.to)}` : 'Toutes les opérations'],
    ['Généré le', new Date().toLocaleString('fr-FR')],
    ['Filtres', filters || 'aucun'],
    ['Nature', "Rapport de gestion interne — ce n'est pas un document comptable officiel."],
    ...definitions.map((d) => ['Définition', d]),
  ];
}

const inR = (d: string, r: Range | null) => !r || (d >= r.from && d <= r.to);

export function exportItems(ds: Dataset, filters = ''): string {
  return csv(
    metaBlock('Inventaire des articles', null, filters, [
      "Coût de revient = prix d'achat attribué + frais d'achat attribués",
      'Bénéfice prévisionnel = prix souhaité − coût de revient (estimation, hors frais de vente)',
    ]),
    ['Nom', 'Catégorie', 'Marque', 'Taille', 'Couleur', 'État', 'Statut', "Date d'achat", "Prix d'achat (€)", 'Frais (€)', 'Coût de revient (€)', 'Prix souhaité (€)', 'Prix minimum (€)', 'Bénéfice prévisionnel (€)', 'Date de vente', 'Notes'],
    ds.items.map((i) => [
      i.name, i.category, i.brand, i.size, i.color, i.condition, STATUS_LABEL[i.status], formatDate(i.purchaseDate),
      eur(i.purchasePrice), eur(i.directFees), eur(itemCost(i)), eur(i.targetPrice), eur(i.minPrice),
      i.targetPrice === null ? '' : eur(i.targetPrice - itemCost(i)), formatDate(i.soldAt), i.notes,
    ]),
  );
}

export function exportSales(ds: Dataset, range: Range | null): string {
  const names = new Map(ds.items.map((i) => [i.id, i.name]));
  return csv(
    metaBlock('Liste des ventes', range, '', [
      'Revenu vendeur = montant réellement encaissé (les frais payés par l’acheteur n’en font pas partie)',
      'Bénéfice commercial = revenu − remboursements − coût de revient des articles non récupérés − coûts supportés',
    ]),
    ['Date', 'Articles', 'Statut', 'Paiement', 'Prix affiché (€)', 'Réduction (€)', 'Revenu vendeur (€)', 'Remboursé (€)', 'Coût de revient (€)', 'Coûts de vente (€)', 'Bénéfice commercial (€)', 'Marge', 'ROI'],
    ds.sales
      .filter((s) => inR(s.date, range))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => {
        const b = saleBreakdown(ds, s);
        return [
          formatDate(s.date), b.lines.map((l) => names.get(l.itemId)).join(' + '), ORDER_LABEL[s.orderStatus],
          s.paymentStatus === 'recu' ? 'Reçu' : 'En attente', eur(s.listedPrice), eur(s.discount), eur(b.revenue),
          eur(b.refunded), eur(b.cogs), eur(b.directCosts), eur(b.profit), formatPercent(b.margin), formatPercent(b.roi),
        ];
      }),
  );
}

export function exportPurchases(ds: Dataset, range: Range | null): string {
  return csv(
    metaBlock('Liste des achats', range, '', ['Total payé = prix des articles + frais communs']),
    ['Date', 'Source', 'Moyen de paiement', 'Nombre d’articles', 'Prix des articles (€)', 'Frais communs (€)', 'Total payé (€)', 'Notes'],
    ds.purchases
      .filter((p) => inR(p.date, range))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => [
        formatDate(p.date), p.source, p.paymentMethod, ds.purchaseLines.filter((l) => l.purchaseId === p.id).length,
        eur(p.itemsTotal), eur(p.commonFees), eur(p.itemsTotal + p.commonFees), p.notes,
      ]),
  );
}

export function exportExpenses(ds: Dataset, range: Range | null): string {
  return csv(
    metaBlock('Liste des dépenses', range, '', ['Une dépense liée à une vente est un coût de cette vente, pas un frais général']),
    ['Date', 'Montant (€)', 'Catégorie', 'Fournisseur', 'Description', 'Liée à une vente', 'Justificatif'],
    ds.expenses
      .filter((e) => inR(e.date, range))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => [formatDate(e.date), eur(e.amount), e.category, e.supplier, e.description, e.saleId ? 'Oui' : 'Non', e.attachmentId ? 'Oui' : 'Non']),
  );
}

export function exportTransactions(ds: Dataset, range: Range | null): string {
  const kinds: Record<string, string> = {
    solde_initial: 'Solde initial', achat: 'Achat', vente: 'Vente', frais_vente: 'Frais de vente',
    depense: 'Dépense', remboursement: 'Remboursement', ajustement: 'Ajustement',
  };
  const st: Record<string, string> = { confirme: 'Confirmé', en_attente: 'En attente', annule: 'Annulé' };
  return csv(
    metaBlock('Historique des mouvements de trésorerie', range, '', ['Montant positif = encaissement, négatif = décaissement']),
    ['Date', 'Libellé', 'Type', 'Statut', 'Montant (€)'],
    ds.transactions
      .filter((t) => inR(t.date, range))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map((t) => [formatDate(t.date), t.label, kinds[t.kind], st[t.status], eur(t.amount)]),
  );
}

export function exportMonthlyReport(ds: Dataset, months: { label: string; range: Range }[]): string {
  const rows = months.map((m) => [m.label, periodMetrics(ds, m.range.from, m.range.to)] as const);
  const line = (label: string, f: (x: PeriodMetrics) => string) => [label, ...rows.map(([, x]) => f(x))];
  return csv(
    metaBlock('Rapport mensuel', months.length ? { from: months[0].range.from, to: months[months.length - 1].range.to } : null, '', [
      'Bénéfice commercial = revenu vendeur − coût de revient des articles vendus − coûts attribuables aux ventes',
      'Résultat estimé = bénéfice commercial − dépenses générales − articles perdus ou retirés',
      'Les achats de stock ne sont pas des charges : ils sont imputés au moment de la vente',
    ]),
    ['Indicateur', ...rows.map(([l]) => l)],
    [
      line('Chiffre d’affaires vendeur (€)', (x) => eur(x.revenue)),
      line('Coût des articles vendus (€)', (x) => eur(x.cogs)),
      line('Coûts attribuables aux ventes (€)', (x) => eur(x.saleCosts)),
      line('Bénéfice commercial (€)', (x) => eur(x.commercialProfit)),
      line('Dépenses générales (€)', (x) => eur(x.general)),
      line('Articles perdus ou retirés (€)', (x) => eur(x.writeOff)),
      line('Résultat estimé (€)', (x) => eur(x.result)),
      line('Achats de stock (€)', (x) => eur(x.purchases)),
      line('Articles vendus', (x) => String(x.itemsSold)),
      line('Marge commerciale', (x) => formatPercent(x.margin)),
      line('ROI', (x) => formatPercent(x.roi)),
    ],
  );
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------------
// Sauvegarde complète
// ---------------------------------------------------------------------------

const BACKUP_FORMAT = 'vinted-profit-ai/backup';

const blobToDataURL = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export async function createBackup(includePhotos: boolean): Promise<Blob> {
  const db = getDb();
  const data: Record<string, unknown> = {};
  for (const t of DATA_TABLES) data[t] = await db.table(t).toArray();
  if (includePhotos) {
    const atts = await db.attachments.toArray();
    data.attachments = await Promise.all(atts.map(async (a) => ({ id: a.id, mime: a.mime, createdAt: a.createdAt, data: await blobToDataURL(a.blob) })));
  }
  return new Blob([JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), data })], {
    type: 'application/json',
  });
}

export async function restoreBackup(file: Blob): Promise<{ items: number; sales: number }> {
  let parsed: { format?: string; version?: number; data?: Record<string, unknown[]> };
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Ce fichier n'est pas une sauvegarde lisible.");
  }
  if (parsed.format !== BACKUP_FORMAT || !parsed.data) throw new Error("Ce fichier n'est pas une sauvegarde Vinted Profit AI.");
  const data = parsed.data;
  for (const t of DATA_TABLES) if (data[t] !== undefined && !Array.isArray(data[t])) throw new Error(`Sauvegarde invalide (${t}).`);
  const db = getDb();
  const atts = Array.isArray(data.attachments)
    ? await Promise.all(
        (data.attachments as { id: string; mime: string; createdAt: string; data: string }[]).map(async (a) => ({
          id: a.id, mime: a.mime, createdAt: a.createdAt, blob: await (await fetch(a.data)).blob(),
        })),
      )
    : null;
  await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.attachments], async () => {
    for (const t of DATA_TABLES) {
      await db.table(t).clear();
      if (data[t]) await db.table(t).bulkAdd(data[t]);
    }
    if (atts) {
      await db.attachments.clear();
      await db.attachments.bulkAdd(atts);
    }
  });
  return { items: (data.items ?? []).length, sales: (data.sales ?? []).length };
}
