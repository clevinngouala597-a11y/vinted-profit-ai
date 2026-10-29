import { useMemo, useState } from 'react';
import { formatEuros, formatPercent } from '../lib/money';
import { formatDate } from '../lib/period';
import { go } from '../lib/router';
import { sellerStats, type Group } from '../lib/stats';
import { useData } from '../lib/useData';
import { Empty, Money, PageHeader } from '../ui/kit';
import { PeriodPicker, usePeriod } from './PeriodPicker';
import { ShopComparison } from './CustomExport';

/** Barre horizontale simple (proportion du maximum). */
function Bar({ value, max, tone = 'var(--green)' }: { value: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((Math.abs(value) / max) * 100)) : 0;
  return <div style={{ height: 6, borderRadius: 3, background: 'var(--card-2)', marginTop: 6 }}><div style={{ width: `${w}%`, height: '100%', borderRadius: 3, background: tone }} /></div>;
}

function GroupList({ title, groups, empty }: { title: string; groups: Group[]; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, 5);
  const max = Math.max(0, ...groups.map((g) => Math.abs(g.profit)));
  return (
    <>
      <h2>{title}</h2>
      {groups.length === 0 ? <p className="small muted">{empty}</p> : (
        <div className="card">
          {shown.map((g, i) => (
            <div key={g.key} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <div className="row-between">
                <span><b>{g.key}</b> <span className="small muted">· {g.count} vendu{g.count > 1 ? 's' : ''}</span></span>
                <Money c={g.profit} signed tone />
              </div>
              <div className="tiny faint">CA {formatEuros(g.revenue)} · {formatEuros(g.avgProfit)} / article · marge {formatPercent(g.margin)}</div>
              <Bar value={g.profit} max={max} tone={g.profit < 0 ? 'var(--loss)' : 'var(--green)'} />
            </div>
          ))}
          {groups.length > 5 && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? 'Moins' : `Voir les ${groups.length}`}</button>}
        </div>
      )}
    </>
  );
}

export function Stats() {
  const ds = useData();
  const p = usePeriod();
  const st = useMemo(() => sellerStats(ds, p.range, p.today), [ds, p.range, p.today]);
  const maxDay = Math.max(0, ...st.weekdays.map((w) => w.count));

  return (
    <>
      <PageHeader title="Statistiques" sub="Ce qui se vend, quand, et ce qui coince" backTo="" />
      <PeriodPicker p={p} />
      <ShopComparison range={p.range} today={p.today} />

      {st.salesCount === 0 && st.cancelledCount === 0 ? (
        <div style={{ marginTop: 12 }}><Empty title="Pas de vente sur cette période" text="Choisis une période plus longue pour voir tes statistiques." /></div>
      ) : (
        <>
          {st.missingCost > 0 && (
            <button className="alert warn" style={{ width: '100%', border: 0, marginTop: 12, textAlign: 'left', cursor: 'pointer' }} onClick={() => go('couts')}>
              <span>{st.missingCost} vente{st.missingCost > 1 ? 's' : ''} sans prix d'achat : bénéfices et marges surestimés. <b>Compléter</b></span>
            </button>
          )}

          <div className="grid2" style={{ marginTop: 12 }}>
            <div className="tile"><div className="tile-label">Ventes</div><div className="tile-value">{st.salesCount}</div><div className="tile-note">CA {formatEuros(st.revenue)}</div></div>
            <div className="tile"><div className="tile-label">Bénéfice</div><div className="tile-value"><Money c={st.profit} tone /></div><div className="tile-note">sur la période</div></div>
            <div className="tile"><div className="tile-label">Panier moyen</div><div className="tile-value">{st.avgBasket === null ? '—' : formatEuros(st.avgBasket)}</div><div className="tile-note">par vente</div></div>
            <div className="tile"><div className="tile-label">Annulées / remboursées</div><div className={`tile-value ${st.cancelRate !== null && st.cancelRate >= 20 ? 'warn' : ''}`}>{st.cancelRate === null ? '—' : `${st.cancelRate.toLocaleString('fr-FR')} %`}</div><div className="tile-note">{st.cancelledCount} vente{st.cancelledCount > 1 ? 's' : ''}</div></div>
            {st.timeToSell && <div className="tile"><div className="tile-label">Délai de vente</div><div className="tile-value">{st.timeToSell.median.toLocaleString('fr-FR')} j</div><div className="tile-note">médiane · moyenne {st.timeToSell.avg.toLocaleString('fr-FR')} j</div></div>}
            {st.sellThrough && <div className="tile"><div className="tile-label">Écoulement</div><div className="tile-value">{formatPercent(st.sellThrough.rate)}</div><div className="tile-note">{st.sellThrough.sold} vendus sur {st.sellThrough.acquired} achetés</div></div>}
          </div>

          {st.best && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="tiny faint">Meilleure vente</div>
              <div className="row-between" style={{ marginTop: 4 }}><b style={{ fontSize: 14 }}>{st.best.name}</b><Money c={st.best.profit} signed tone /></div>
              <div className="tiny faint">{formatDate(st.best.date)}</div>
            </div>
          )}

          <h2>Jours où tu vends le plus</h2>
          <div className="card">
            {st.weekdays.map((w) => (
              <div key={w.day} style={{ display: 'grid', gridTemplateColumns: '78px 1fr 56px', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span className="small" style={{ fontWeight: w.day === st.bestWeekday ? 800 : 400 }}>{w.day}</span>
                <div style={{ height: 10, borderRadius: 5, background: 'var(--card-2)' }}><div style={{ width: `${maxDay ? (w.count / maxDay) * 100 : 0}%`, height: '100%', borderRadius: 5, background: w.day === st.bestWeekday ? 'var(--green)' : 'var(--muted)' }} /></div>
                <span className="small" style={{ textAlign: 'right' }}>{w.count}</span>
              </div>
            ))}
            {st.bestWeekday && <p className="tiny faint" style={{ margin: '8px 0 0' }}>Astuce : publie ou remonte tes articles la veille et le matin du {st.bestWeekday.toLowerCase()}.</p>}
          </div>

          <GroupList title="Catégories qui rapportent le plus" groups={st.categories} empty="Pas encore de catégorie." />
          <GroupList title="Marques" groups={st.brands} empty="Aucune marque reconnue dans les titres." />
          <GroupList title="Tailles" groups={st.sizes} empty="Aucune taille trouvée (« Taille L » dans le titre Vinted)." />

          {st.timeToSell && st.timeToSell.byCategory.length > 1 && (
            <>
              <h2>Vitesse de vente par catégorie</h2>
              <div className="card">
                {st.timeToSell.byCategory.map((c, i) => (
                  <div key={c.key} className="row-between" style={{ padding: '6px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
                    <span>{c.key} <span className="tiny faint">· {c.count}</span></span><b>{c.avg.toLocaleString('fr-FR')} j</b>
                  </div>
                ))}
              </div>
            </>
          )}

          {st.repeatCancels.length > 0 && (
            <>
              <h2>Articles souvent annulés</h2>
              <div className="card">
                <p className="tiny faint" style={{ marginTop: 0 }}>Vendus puis annulés ou remboursés plusieurs fois : vérifie la description, les photos ou la taille indiquée.</p>
                {st.repeatCancels.map((r, i) => (
                  <div key={r.name} className="row-between" style={{ padding: '6px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
                    <span className="small">{r.name}</span><span className="badge red">{r.count} fois</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {st.losers.length > 0 && (
            <>
              <h2>Ventes à perte</h2>
              <div className="list">
                {st.losers.map((l) => (
                  <button key={l.saleId} className="li" onClick={() => go(`ventes/${l.saleId}`)}>
                    <span className="li-main"><div className="li-title" style={{ fontSize: 14 }}>{l.name}</div><div className="li-sub">{formatDate(l.date)}</div></span>
                    <span className="li-end li-amount"><Money c={l.profit} signed tone /></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {st.dormant.length > 0 && (
            <>
              <h2>Articles qui dorment</h2>
              <div className="list">
                {st.dormant.map(({ item, days }) => (
                  <button key={item.id} className="li" onClick={() => go(`stock/${item.id}`)}>
                    <span className="li-main"><div className="li-title" style={{ fontSize: 14 }}>{item.name}</div><div className="li-sub">en vente depuis {days} jours · coût {formatEuros(item.purchasePrice + item.directFees)}</div></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
