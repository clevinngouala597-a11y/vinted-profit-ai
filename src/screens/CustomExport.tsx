import { useState } from 'react';
import { ACCOUNTING_PRESET, buildCustomTables, EXPORT_TABLES, shopComparison, type ExportTableId } from '../lib/customExports';
import { downloadBlob, downloadText, toCSV } from '../lib/exports';
import { formatEuros, formatPercent } from '../lib/money';
import { ALL, isMulti, shopsOf } from '../lib/shops';
import { useFullData } from '../lib/useData';
import { ErrorBox, Field, Sheet, useAction, useUI } from '../ui/kit';
import { PeriodPicker, usePeriod } from './PeriodPicker';

/** Export sur mesure : tableaux, période, dressing, format. */
export function CustomExportSheet({ preset, onClose }: { preset?: ExportTableId[]; onClose: () => void }) {
  const full = useFullData();
  const ui = useUI();
  const p = usePeriod();
  const multi = isMulti(full.settings);
  const [tables, setTables] = useState<Set<ExportTableId>>(new Set(preset ?? ['ventes', 'achats', 'depenses']));
  const [shop, setShop] = useState(ALL);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const { error, run, busy } = useAction();
  const list = EXPORT_TABLES.filter((t) => t.id !== 'dressings' || multi);
  const toggle = (id: ExportTableId) => setTables((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stamp = `${p.range.from}_${p.range.to}`;
  const shopSlug = shop === ALL ? '' : `_${(shopsOf(full.settings).find((s) => s.id === shop)?.name ?? 'dressing').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <Sheet open onClose={onClose} title="Export personnalisé">
      <ErrorBox error={error} />
      <Field label="Période"><div><PeriodPicker p={p} /></div></Field>
      {multi && (
        <Field label="Dressing">
          <select className="input" value={shop} onChange={(e) => setShop(e.target.value)}>
            <option value={ALL}>Tous les dressings</option>
            {shopsOf(full.settings).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}
      <div className="row-between" style={{ margin: '4px 0 6px' }}>
        <span className="small muted" style={{ fontWeight: 600 }}>Tableaux</span>
        <button className="link small" onClick={() => setTables(new Set(ACCOUNTING_PRESET))}>Préparation comptable</button>
      </div>
      {list.map((t) => (
        <label key={t.id} className="check" style={{ marginBottom: 6 }}>
          <input type="checkbox" checked={tables.has(t.id)} onChange={() => toggle(t.id)} />
          <span><b>{t.label}</b><br /><span className="small muted">{t.sub}</span></span>
        </label>
      ))}
      <div className="seg" role="group" aria-label="Format" style={{ margin: '10px 0 12px' }}>
        <button aria-pressed={format === 'xlsx'} onClick={() => setFormat('xlsx')}>Excel (un onglet par tableau)</button>
        <button aria-pressed={format === 'csv'} onClick={() => setFormat('csv')}>CSV (un fichier par tableau)</button>
      </div>
      <button className="btn btn-primary" disabled={busy || tables.size === 0} onClick={() => run(async () => {
        const built = buildCustomTables(full, { tables: [...tables], range: p.range, shop, today: p.today });
        if (format === 'xlsx') {
          const { buildWorkbook } = await import('../lib/office');
          downloadBlob(`cng-vinted_export${shopSlug}_${stamp}.xlsx`, await buildWorkbook(built));
        } else {
          for (const t of built) {
            downloadText(`${t.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}${shopSlug}_${stamp}.csv`, toCSV(t));
            await new Promise((r) => setTimeout(r, 350));
          }
        }
        ui.toast(`${built.length} tableau${built.length > 1 ? 'x' : ''} exporté${built.length > 1 ? 's' : ''}`);
        onClose();
      })}>{busy ? 'Préparation…' : `Exporter ${tables.size} tableau${tables.size > 1 ? 'x' : ''}`}</button>
      <p className="tiny faint">Rapports de gestion interne : ils aident à préparer ta comptabilité ou ta déclaration, mais ne remplacent pas un document comptable officiel.</p>
    </Sheet>
  );
}

/** Comparaison des dressings (statistiques, quand il y en a plusieurs). */
export function ShopComparison({ range, today }: { range: { from: string; to: string }; today: string }) {
  const full = useFullData();
  if (!isMulti(full.settings)) return null;
  const rows = shopComparison(full, range, today);
  return (
    <>
      <h2>Par dressing</h2>
      <div className="card scroll-x">
        <table className="report" style={{ width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>Dressing</th><th>CA</th><th>Bénéfice</th><th>Marge</th><th>Vendus</th><th>Délai</th><th>Stock</th><th>Immobilisé</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={r.id === ALL ? { fontWeight: 800 } : undefined}>
                <td style={{ textAlign: 'left' }}>{r.name}</td>
                <td>{formatEuros(r.revenue)}</td>
                <td className={r.profit < 0 ? 'neg' : ''}>{formatEuros(r.profit)}</td>
                <td>{r.margin === null ? '—' : formatPercent(r.margin)}</td>
                <td>{r.itemsSold}</td>
                <td>{r.avgDaysToSell === null ? '—' : `${r.avgDaysToSell} j`}</td>
                <td>{r.stockCount}{r.dormant ? <span className="warn"> ({r.dormant} dort{r.dormant > 1 ? 'ent' : ''})</span> : ''}</td>
                <td>{formatEuros(r.stockCapital)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny faint">Sur la période choisie, tous dressings visibles quel que soit le dressing affiché. Stock : à aujourd’hui.</p>
    </>
  );
}
