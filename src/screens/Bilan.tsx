import { useMemo, useState } from 'react';
import { cashState, isAwaitingPayment, periodMetrics, plEntries, profitBy, saleBreakdown, series, stockValueAt, type PeriodMetrics } from '../lib/engine';
import { formatEuros, formatPercent } from '../lib/money';
import { addMonths, formatMonth, monthEnd, monthStart, todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { BarList, RevenueProfitChart } from '../ui/charts';
import { IBack, IChevron } from '../ui/icons';
import { InfoButton, Money, PageHeader } from '../ui/kit';

type View = 'jour' | 'mois' | 'annee';

export function Bilan() {
  const [view, setView] = useState<View>('mois');
  return (
    <>
      <PageHeader title="Bilan" sub="Rapport de gestion interne" right={<button className="btn btn-ghost btn-sm" onClick={() => go('exports')}>Exporter</button>} />
      <div className="seg" role="group" aria-label="Vue du bilan">
        <button aria-pressed={view === 'jour'} onClick={() => setView('jour')}>Aujourd'hui</button>
        <button aria-pressed={view === 'mois'} onClick={() => setView('mois')}>Mois</button>
        <button aria-pressed={view === 'annee'} onClick={() => setView('annee')}>Année</button>
      </div>
      {view === 'jour' && <Day />}
      {view === 'mois' && <Month />}
      {view === 'annee' && <Year />}
    </>
  );
}

function useEntries() {
  const ds = useData();
  return useMemo(() => plEntries(ds), [ds]);
}

function ToCheck() {
  const ds = useData();
  const pending = ds.sales.filter((s) => isAwaitingPayment(ds, s));
  const toShip = ds.sales.filter((s) => s.orderStatus === 'confirmee');
  const noProof = ds.expenses.filter((e) => !e.attachmentId);
  const losses = ds.sales.filter((s) => s.orderStatus !== 'annulee' && saleBreakdown(ds, s).isLoss);
  const waitingReturn = ds.refunds.filter((r) => !r.itemRecovered && !ds.refunds.some((x) => x.saleId === r.saleId && x.itemRecovered));
  const pl = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const rows: [number, string, string][] = [
    [pending.length, pl(pending.length, 'paiement en attente', 'paiements en attente'), 'ventes?filtre=attente'],
    [toShip.length, pl(toShip.length, 'vente à expédier', 'ventes à expédier'), 'ventes?filtre=expedier'],
    [waitingReturn.length, pl(waitingReturn.length, 'retour pas encore récupéré', 'retours pas encore récupérés'), 'ventes?filtre=retours'],
    [losses.length, pl(losses.length, 'vente à perte', 'ventes à perte'), 'ventes?filtre=perte'],
    [noProof.length, pl(noProof.length, 'dépense sans justificatif', 'dépenses sans justificatif'), 'depenses'],
  ];
  const shown = rows.filter((r) => r[0] > 0);
  return (
    <>
      <h2>Opérations à vérifier</h2>
      {shown.length === 0 ? (
        <div className="card small muted">Rien à vérifier pour l'instant.</div>
      ) : (
        <div className="list">
          {shown.map(([, l, to]) => (
            <button key={l} className="li" onClick={() => go(to)}>
              <span className="li-main"><span className="li-title">{l}</span></span>
              <IChevron className="faint" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Day() {
  const ds = useData();
  const entries = useEntries();
  const t = todayISO();
  const m = periodMetrics(ds, t, t, entries);
  const salesToday = ds.sales.filter((s) => s.date === t && s.orderStatus !== 'annulee').length;
  return (
    <>
      <div className="grid2" style={{ marginTop: 14 }}>
        <Box label="Ventes du jour" value={String(salesToday)} />
        <Box label="Articles vendus" value={String(m.itemsSold)} />
        <Box label="Achats du jour" value={formatEuros(m.purchases)} />
        <Box label="Dépenses du jour" value={formatEuros(m.general + m.saleCosts)} />
      </div>
      <div className="card row-between" style={{ marginTop: 10 }}>
        <span className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Bénéfice commercial <InfoButton k="profit" /></span>
        <b style={{ fontSize: 20 }}><Money c={m.commercialProfit} signed tone /></b>
      </div>
      <ToCheck />
    </>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return <div className="tile"><div className="tile-label">{label}</div><div className="tile-value">{value}</div></div>;
}

function Month() {
  const ds = useData();
  const entries = useEntries();
  const [anchor, setAnchor] = useState(monthStart(todayISO()));
  const from = anchor;
  const to = monthEnd(anchor);
  const prevFrom = addMonths(anchor, -1);
  const m = periodMetrics(ds, from, to, entries);
  const p = periodMetrics(ds, prevFrom, monthEnd(prevFrom), entries);
  const stockEnd = stockValueAt(ds, to);
  const cashEnd = cashState(ds, to);
  const isCurrent = anchor === monthStart(todayISO());
  const byCat = profitBy(entries, from, to, 'category');
  const byBrand = profitBy(entries, from, to, 'brand').slice(0, 6);

  return (
    <>
      <div className="row-between" style={{ margin: '16px 0 4px', alignItems: 'center' }}>
        <button className="icon-btn" aria-label="Mois précédent" onClick={() => setAnchor(addMonths(anchor, -1))}><IBack /></button>
        <b style={{ fontSize: 17, textTransform: 'capitalize' }}>{formatMonth(anchor)}</b>
        <button className="icon-btn" aria-label="Mois suivant" disabled={isCurrent} style={isCurrent ? { opacity: 0.3 } : undefined} onClick={() => setAnchor(addMonths(anchor, 1))}><IChevron /></button>
      </div>

      <h2>Compte de résultat</h2>
      <div className="calc">
        <Row label="Chiffre d'affaires vendeur" v={m.revenue} prev={p.revenue} />
        <Row label="Coût des articles vendus" v={-m.cogs} prev={-p.cogs} />
        <Row label="Coûts attribuables aux ventes" v={-m.saleCosts} prev={-p.saleCosts} />
        <Row label="Bénéfice commercial" v={m.commercialProfit} prev={p.commercialProfit} total info="profit" />
        <Row label="Dépenses générales" v={-m.general} prev={-p.general} />
        {(m.writeOff > 0 || p.writeOff > 0) && <Row label="Articles perdus ou retirés" v={-m.writeOff} prev={-p.writeOff} />}
        <Row label="Résultat estimé" v={m.result} prev={p.result} total info="result" />
      </div>
      <p className="tiny faint">Colonne de droite : écart avec le mois précédent. Estimation de gestion, à ne pas confondre avec ton revenu imposable.</p>

      <h2>Stock et trésorerie</h2>
      <div className="calc">
        <div className="calc-row"><span>Achats de stock du mois</span><span>{formatEuros(m.purchases)}</span></div>
        <div className="calc-row"><span>Articles vendus</span><span>{m.itemsSold}</span></div>
        <div className="calc-row"><span>Stock {isCurrent ? 'actuel' : 'en fin de mois'}</span><span>{stockEnd.count} article{stockEnd.count > 1 ? 's' : ''} · {formatEuros(stockEnd.value)}</span></div>
        <div className="calc-row"><span>Trésorerie {isCurrent ? 'actuelle' : 'en fin de mois'}</span><span>{formatEuros(cashEnd.balance)}</span></div>
        <div className="calc-row"><span>Marge · ROI</span><span>{formatPercent(m.margin)} · {formatPercent(m.roi)}</span></div>
      </div>

      {byCat.length > 0 && (
        <>
          <h2>Bénéfice par catégorie</h2>
          <div className="card"><BarList rows={byCat} valueOf={(r) => r.profit as number} format={(r) => `${formatEuros(r.profit as number)} · ${r.count} vendu${(r.count as number) > 1 ? 's' : ''}`} /></div>
        </>
      )}
      {byBrand.length > 0 && (
        <>
          <h2>Bénéfice par marque</h2>
          <div className="card"><BarList rows={byBrand} valueOf={(r) => r.profit as number} format={(r) => formatEuros(r.profit as number)} /></div>
        </>
      )}
      <ToCheck />
    </>
  );
}

function Row({ label, v, prev, total, info }: { label: string; v: number; prev: number; total?: boolean; info?: string }) {
  const d = v - prev;
  return (
    <div className={`calc-row ${total ? 'total' : ''}`}>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{label}{info && <InfoButton k={info} />}</span>
      <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span className={total ? (v < 0 ? 'neg' : v > 0 ? 'pos' : '') : ''}>{formatEuros(v)}</span>
        <span className={`tiny ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'faint'}`} style={{ minWidth: 62, textAlign: 'right' }}>{d === 0 ? '=' : formatEuros(d, { signed: true })}</span>
      </span>
    </div>
  );
}

function Year() {
  const ds = useData();
  const entries = useEntries();
  const [year, setYear] = useState(Number(todayISO().slice(0, 4)));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`).filter((m) => m <= todayISO());
  const rows: [string, PeriodMetrics][] = months.map((m) => [m, periodMetrics(ds, m, monthEnd(m), entries)]);
  const tot = periodMetrics(ds, `${year}-01-01`, `${year}-12-31`, entries);
  const chart = series(entries, months.map((m) => ({ key: m, label: new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(m + 'T12:00')), from: m, to: monthEnd(m) })));
  const byCat = profitBy(entries, `${year}-01-01`, `${year}-12-31`, 'category').slice(0, 6);
  const topExp = [...ds.expenses.filter((e) => e.date.startsWith(String(year))).reduce((mp, e) => mp.set(e.category, (mp.get(e.category) ?? 0) + e.amount), new Map<string, number>())]
    .map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
  const firstYear = Math.min(year, ...ds.purchases.map((p) => Number(p.date.slice(0, 4))));
  const stockEnd = stockValueAt(ds, `${year}-12-31` < todayISO() ? `${year}-12-31` : todayISO());

  return (
    <>
      <div className="row-between" style={{ margin: '16px 0 4px', alignItems: 'center' }}>
        <button className="icon-btn" aria-label="Année précédente" disabled={year <= firstYear} style={year <= firstYear ? { opacity: 0.3 } : undefined} onClick={() => setYear(year - 1)}><IBack /></button>
        <b style={{ fontSize: 17 }}>{year}</b>
        <button className="icon-btn" aria-label="Année suivante" disabled={year >= Number(todayISO().slice(0, 4))} style={year >= Number(todayISO().slice(0, 4)) ? { opacity: 0.3 } : undefined} onClick={() => setYear(year + 1)}><IChevron /></button>
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <Box label="Chiffre d'affaires" value={formatEuros(tot.revenue)} />
        <Box label="Bénéfice commercial" value={formatEuros(tot.commercialProfit)} />
        <Box label="Résultat estimé" value={formatEuros(tot.result)} />
        <Box label="Stock final" value={formatEuros(stockEnd.value)} />
      </div>
      <h2>Mois par mois</h2>
      <div className="card"><RevenueProfitChart data={chart} /></div>
      <div className="card scroll-x" style={{ marginTop: 10 }}>
        <table className="report">
          <thead><tr><th>Mois</th><th>CA</th><th>Bénéfice</th><th>Résultat</th><th>Vendus</th></tr></thead>
          <tbody>
            {rows.map(([mo, x]) => (
              <tr key={mo}>
                <td style={{ textTransform: 'capitalize' }}>{new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(new Date(mo + 'T12:00'))}</td>
                <td>{formatEuros(x.revenue)}</td>
                <td className={x.commercialProfit < 0 ? 'neg' : ''}>{formatEuros(x.commercialProfit)}</td>
                <td className={x.result < 0 ? 'neg' : ''}>{formatEuros(x.result)}</td>
                <td>{x.itemsSold}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 800 }}><td>Total</td><td>{formatEuros(tot.revenue)}</td><td>{formatEuros(tot.commercialProfit)}</td><td>{formatEuros(tot.result)}</td><td>{tot.itemsSold}</td></tr>
          </tbody>
        </table>
      </div>
      {byCat.length > 0 && (<><h2>Catégories les plus rentables</h2><div className="card"><BarList rows={byCat} valueOf={(r) => r.profit as number} format={(r) => formatEuros(r.profit as number)} /></div></>)}
      {topExp.length > 0 && (<><h2>Principales dépenses</h2><div className="card"><BarList rows={topExp} valueOf={(r) => r.v as number} format={(r) => formatEuros(r.v as number)} /></div></>)}
      <ToCheck />
    </>
  );
}
