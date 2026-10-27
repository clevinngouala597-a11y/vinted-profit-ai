import { useState } from 'react';
import { forecast } from '../lib/forecast';
import { formatEuros } from '../lib/money';
import { addDays, todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { Empty, PageHeader } from '../ui/kit';

const NAMES = { prudent: 'Prudent', central: 'Central', optimiste: 'Optimiste' } as const;

export function ForecastScreen() {
  const ds = useData();
  const [h, setH] = useState<30 | 60 | 90>(30);
  // seules les journées complètes comptent : l'historique s'arrête hier
  const f = forecast(ds, addDays(todayISO(), -1), h);

  return (
    <>
      <PageHeader title="Prévisions" sub="Estimations à partir de ton rythme récent" backTo="" />
      <div className="seg" role="group" aria-label="Horizon" style={{ marginBottom: 14 }}>
        {([30, 60, 90] as const).map((d) => (
          <button key={d} aria-pressed={h === d} onClick={() => setH(d)}>{d} jours</button>
        ))}
      </div>

      {!f.ok ? (
        <Empty title="Pas encore assez d'historique" text={f.reason} action={<button className="btn btn-ghost" onClick={() => go('ventes')}>Voir mes ventes</button>} />
      ) : (
        <>
          <div className="card scroll-x">
            <table className="report">
              <thead>
                <tr><th>Dans {h} jours</th>{f.scenarios.map((s) => <th key={s.name}>{NAMES[s.name]}</th>)}</tr>
              </thead>
              <tbody>
                <tr><td>Chiffre d'affaires</td>{f.scenarios.map((s) => <td key={s.name}>{formatEuros(s.revenue)}</td>)}</tr>
                <tr><td>Bénéfice commercial</td>{f.scenarios.map((s) => <td key={s.name} className={s.profit < 0 ? 'neg' : ''}>{formatEuros(s.profit)}</td>)}</tr>
                <tr><td>Résultat estimé</td>{f.scenarios.map((s) => <td key={s.name} className={s.result < 0 ? 'neg' : ''}>{formatEuros(s.result)}</td>)}</tr>
                <tr style={{ fontWeight: 800 }}><td>Trésorerie finale</td>{f.scenarios.map((s) => <td key={s.name} className={s.cashEnd < 0 ? 'neg' : ''}>{formatEuros(s.cashEnd)}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">Trésorerie aujourd'hui : <b>{formatEuros(f.cashNow)}</b>{f.pendingIn > 0 && <> + {formatEuros(f.pendingIn)} en attente</>}.</p>
          {f.scenarios[0].cashEnd < ds.settings.safetyReserve && (
            <div className="alert warn">Dans le scénario prudent, ta trésorerie passerait sous ta réserve de sécurité ({formatEuros(ds.settings.safetyReserve)}). Réduis les achats ou accélère les ventes du stock ancien.</div>
          )}

          <h2>Hypothèses</h2>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {f.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
          <h2>Limites</h2>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {f.limits.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </>
      )}
    </>
  );
}
