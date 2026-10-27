import { useMemo } from 'react';
import { markRepublished, saveSettings } from '../lib/actions';
import { republishList } from '../lib/listing';
import { formatEuros } from '../lib/money';
import { todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { Empty, ErrorBox, PageHeader, useAction, useUI } from '../ui/kit';

/** Articles qui ne bougent pas : à republier à la main sur Vinted (aucun robot), avec une baisse qui reste rentable. */
export function Republish() {
  const ds = useData();
  const ui = useUI();
  const rows = useMemo(() => republishList(ds, todayISO()), [ds]);
  const { error, run, busy } = useAction();
  const days = ds.settings.republishDays || 7;

  return (
    <>
      <PageHeader title="À republier" sub="Tes articles qui ne bougent pas, à remonter sur Vinted" backTo="" />
      <ErrorBox error={error} />
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="small muted">En vente depuis au moins</span>
        <select className="input" style={{ width: 'auto' }} value={days} onChange={(e) => saveSettings({ republishDays: Number(e.target.value) })}>
          {[3, 7, 14, 21, 30].map((d) => <option key={d} value={d}>{d} jours</option>)}
        </select>
      </div>
      {rows.length === 0 ? (
        <Empty
          title="Rien à republier"
          text="Les articles que tu ajoutes avec l'annonce IA (ou dans le stock) apparaissent ici quand ils restent en ligne trop longtemps sans se vendre."
          action={<button className="btn btn-primary" onClick={() => go('annonce')}>Créer une annonce</button>}
        />
      ) : (
        <>
          <p className="tiny faint" style={{ marginTop: 0 }}>Sur Vinted : supprime l'annonce et republie-la (ou modifie le prix) pour remonter dans les résultats. Puis touche « Republié ».</p>
          <div className="list">
            {rows.map((r) => (
              <div key={r.item.id} className="li" style={{ display: 'block' }}>
                <div className="row-between">
                  <div className="li-title" style={{ fontSize: 14 }}>{r.item.name}</div>
                  <span className={`badge ${r.days >= days * 2 ? 'red' : 'warn'}`}>{r.days} j</span>
                </div>
                <div className="li-sub" style={{ margin: '2px 0 8px' }}>
                  {r.item.targetPrice ? <>Prix actuel {formatEuros(r.item.targetPrice)}</> : 'Prix non renseigné'}
                  {r.suggested !== null && <> · conseillé <b style={{ color: 'var(--green)' }}>{formatEuros(r.suggested)}</b></>}
                  {r.floor > 0 && <> · minimum rentable {formatEuros(r.floor)}</>}
                </div>
                <div className="btn-row">
                  {r.suggested !== null && (
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await markRepublished(r.item.id, r.suggested); ui.toast(`Republié à ${formatEuros(r.suggested!)}`); })}>Republié à {formatEuros(r.suggested)}</button>
                  )}
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await markRepublished(r.item.id, null); ui.toast('Republié au même prix'); })}>Republié{r.suggested !== null ? ' (même prix)' : ''}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(r.item.listingRef || r.item.name).then(() => ui.toast('Titre copié')).catch(() => {})}>Copier le titre</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
