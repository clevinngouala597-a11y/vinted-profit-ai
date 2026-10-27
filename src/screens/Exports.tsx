import { useRef, useState } from 'react';
import {
  createBackup,
  downloadBlob,
  downloadText,
  exportExpenses,
  exportItems,
  exportMonthlyReport,
  exportPurchases,
  exportSales,
  exportTransactions,
  expensesTable,
  itemsTable,
  monthlyTable,
  purchasesTable,
  restoreBackup,
  salesTable,
  transactionsTable,
} from '../lib/exports';
import { addMonths, formatMonth, monthEnd, monthStart, todayISO } from '../lib/period';
import { saveSettings } from '../lib/actions';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { IDownload } from '../ui/icons';
import { ErrorBox, PageHeader, useAction, useUI } from '../ui/kit';
import { PeriodPicker, usePeriod } from './PeriodPicker';

export function Exports() {
  const ds = useData();
  const ui = useUI();
  const p = usePeriod();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState(true);
  const [pdfMonth, setPdfMonth] = useState(todayISO().slice(0, 7));
  const { error, run, busy } = useAction();
  const stamp = `${p.range.from}_${p.range.to}`;

  const dl = (name: string, content: string) => {
    downloadText(name, content);
    ui.toast('Fichier exporté');
  };

  const months = Array.from({ length: 12 }, (_, i) => addMonths(monthStart(todayISO()), i - 11)).map((m) => ({
    label: formatMonth(m),
    range: { from: m, to: monthEnd(m) },
  }));

  return (
    <>
      <PageHeader title="Exports et sauvegarde" backTo="" />
      <ErrorBox error={error} />
      <PeriodPicker p={p} />

      <h2>Excel et PDF</h2>
      <div className="list">
        <ExportRow title="Classeur Excel complet" sub="Rapport mensuel, ventes, achats, dépenses, trésorerie, inventaire, définitions" onClick={() => run(async () => {
          const { buildWorkbook } = await import('../lib/office');
          const blob = await buildWorkbook([
            monthlyTable(ds, months), salesTable(ds, p.range), purchasesTable(ds, p.range), expensesTable(ds, p.range),
            transactionsTable(ds, p.range), itemsTable(ds),
          ]);
          downloadBlob(`vinted-profit-ai_${stamp}.xlsx`, blob);
          ui.toast('Classeur Excel exporté');
        })} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <select className="input" value={pdfMonth} onChange={(e) => setPdfMonth(e.target.value)} aria-label="Mois du bilan PDF">
          {months.slice().reverse().map((mo) => <option key={mo.range.from} value={mo.range.from.slice(0, 7)} style={{ textTransform: 'capitalize' }}>{mo.label}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" style={{ flex: 'none' }} disabled={busy} onClick={() => run(async () => {
          const { buildMonthlyPdf } = await import('../lib/office');
          downloadBlob(`bilan_${pdfMonth}.pdf`, buildMonthlyPdf(ds, pdfMonth));
          ui.toast('Bilan PDF exporté');
        })}>Bilan PDF</button>
      </div>
      {busy && <p className="tiny muted">Préparation du fichier…</p>}

      <h2>Exports CSV</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Fichiers texte lisibles partout. Chacun indique la période, la date de génération et la définition des indicateurs.</p>
      <div className="list" style={{ marginTop: 12 }}>
        <ExportRow title="Rapport mensuel" sub="12 derniers mois, indicateurs clés" onClick={() => dl(`rapport-mensuel_${todayISO()}.csv`, exportMonthlyReport(ds, months))} />
        <ExportRow title="Ventes" sub="Sur la période choisie" onClick={() => dl(`ventes_${stamp}.csv`, exportSales(ds, p.range))} />
        <ExportRow title="Achats" sub="Sur la période choisie" onClick={() => dl(`achats_${stamp}.csv`, exportPurchases(ds, p.range))} />
        <ExportRow title="Dépenses" sub="Sur la période choisie" onClick={() => dl(`depenses_${stamp}.csv`, exportExpenses(ds, p.range))} />
        <ExportRow title="Mouvements de trésorerie" sub="Sur la période choisie" onClick={() => dl(`tresorerie_${stamp}.csv`, exportTransactions(ds, p.range))} />
        <ExportRow title="Inventaire complet" sub="Tous les articles, tous statuts" onClick={() => dl(`inventaire_${todayISO()}.csv`, exportItems(ds))} />
      </div>
      <p className="tiny faint">Ce sont des rapports de gestion interne, pas des documents comptables officiels.</p>

      <h2>Importer</h2>
      <div className="list">
        <ExportRow title="Importer un fichier CSV" sub="Articles (achats et ventes) ou dépenses, avec vérification avant import" onClick={() => go('import')} />
      </div>

      <h2>Sauvegarde complète</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Tes données sont enregistrées sur cet appareil. Fais une sauvegarde régulièrement (par exemple dans Fichiers ou iCloud Drive) : elle permet de tout restaurer sur un autre appareil.
      </p>
      <label className="check">
        <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} />
        <span><b>Inclure les photos et justificatifs</b><br /><span className="small muted">Fichier plus lourd, mais rien ne se perd.</span></span>
      </label>
      <div style={{ display: 'grid', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
          const blob = await createBackup(photos);
          downloadBlob(`vinted-profit-ai_sauvegarde_${todayISO()}.json`, blob);
          await saveSettings({ lastBackupAt: new Date().toISOString() });
          ui.toast('Sauvegarde créée');
        })}>
          <IDownload width={18} height={18} /> Créer une sauvegarde
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>Restaurer une sauvegarde</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        const ok = await ui.confirm({
          title: 'Remplacer toutes les données ?',
          text: 'Les données actuelles de cet appareil seront remplacées par celles de la sauvegarde. Crée d’abord une sauvegarde si tu veux pouvoir revenir en arrière.',
          confirmLabel: 'Restaurer',
          danger: true,
        });
        if (!ok) return;
        const r = await run(() => restoreBackup(f));
        if (r) ui.toast(`Restauré : ${r.items} articles, ${r.sales} ventes`);
      }} />
    </>
  );
}

function ExportRow({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button className="li" onClick={onClick}>
      <span className="dot out"><IDownload width={17} height={17} /></span>
      <span className="li-main"><div className="li-title">{title}</div><div className="li-sub">{sub}</div></span>
    </button>
  );
}
