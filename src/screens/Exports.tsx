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
  restoreBackup,
} from '../lib/exports';
import { addMonths, formatMonth, monthEnd, monthStart, todayISO } from '../lib/period';
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
      <h2 style={{ marginTop: 0 }}>Exports CSV</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Fichiers lisibles dans Excel ou Numbers. Chacun indique la période, la date de génération et la définition des indicateurs.</p>
      <PeriodPicker p={p} />
      <div className="list" style={{ marginTop: 12 }}>
        <ExportRow title="Rapport mensuel" sub="12 derniers mois, indicateurs clés" onClick={() => dl(`rapport-mensuel_${todayISO()}.csv`, exportMonthlyReport(ds, months))} />
        <ExportRow title="Ventes" sub="Sur la période choisie" onClick={() => dl(`ventes_${stamp}.csv`, exportSales(ds, p.range))} />
        <ExportRow title="Achats" sub="Sur la période choisie" onClick={() => dl(`achats_${stamp}.csv`, exportPurchases(ds, p.range))} />
        <ExportRow title="Dépenses" sub="Sur la période choisie" onClick={() => dl(`depenses_${stamp}.csv`, exportExpenses(ds, p.range))} />
        <ExportRow title="Mouvements de trésorerie" sub="Sur la période choisie" onClick={() => dl(`tresorerie_${stamp}.csv`, exportTransactions(ds, p.range))} />
        <ExportRow title="Inventaire complet" sub="Tous les articles, tous statuts" onClick={() => dl(`inventaire_${todayISO()}.csv`, exportItems(ds))} />
      </div>
      <p className="tiny faint">Ce sont des rapports de gestion interne, pas des documents comptables officiels. Les exports Excel (XLSX) et PDF arrivent dans la phase 2.</p>

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
