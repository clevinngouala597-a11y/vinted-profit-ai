import { useEffect, useState } from 'react';
import { saveSettings } from '../lib/actions';
import { fetchUsers, isStatsAdmin, lockAdmin, ONLINE_MS, summarize, unlockAdmin, type DeviceRow } from '../lib/presence';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { sinceLabel } from '../lib/vinted/reliability';
import { ErrorBox, Field, PageHeader, useAction, useUI } from '../ui/kit';

/** Admin : qui utilise l'appli (appareils anonymes, testeurs de la bêta). */
export function AdminUsers() {
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [filter, setFilter] = useState<'tous' | 'en_ligne' | 'beta' | 'officielle'>('tous');
  const { error, run, busy } = useAction();
  const load = () => run(async () => setRows(await fetchUsers()));
  useEffect(() => { if (isStatsAdmin()) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isStatsAdmin()) return (<><PageHeader title="Utilisateurs" backTo="reglages" /><AdminUnlock onDone={load} /></>);

  const now = Date.now();
  const s = rows ? summarize(rows, now) : null;
  const shown = (rows ?? [])
    .filter((r) => filter === 'tous' || (filter === 'en_ligne' ? now - Date.parse(r.last) < ONLINE_MS : r.v === filter))
    .sort((a, b) => b.last.localeCompare(a.last));

  return (
    <>
      <PageHeader title="Utilisateurs" sub="Appareils qui ont ouvert l'appli (anonymes)" backTo="reglages"
        right={<button className="btn btn-ghost btn-sm" disabled={busy} onClick={load}>{busy ? '…' : 'Actualiser'}</button>} />
      <ErrorBox error={error} />
      {!rows ? <div className="skeleton" style={{ height: 160 }} /> : (
        <>
          <div className="grid2">
            <div className="tile"><div className="tile-label">En ligne maintenant</div><div className={`tile-value ${s!.online ? 'pos' : ''}`}>{s!.online}</div><div className="tile-note">appli ouverte (6 dernières min.)</div></div>
            <div className="tile"><div className="tile-label">Aujourd'hui</div><div className="tile-value">{s!.today}</div><div className="tile-note">sur 24 h</div></div>
            <div className="tile"><div className="tile-label">7 derniers jours</div><div className="tile-value">{s!.week}</div><div className="tile-note">appareils actifs</div></div>
            <div className="tile"><div className="tile-label">Au total</div><div className="tile-value">{s!.total}</div><div className="tile-note">{s!.beta} en bêta · {s!.google} avec Google</div></div>
          </div>
          <div className="chips" role="group" aria-label="Filtrer" style={{ margin: '14px 0 10px' }}>
            {([['tous', 'Tous'], ['en_ligne', 'En ligne'], ['beta', 'Bêta'], ['officielle', 'Version officielle']] as const).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          {shown.length === 0 ? <div className="card small muted">Personne pour l'instant.</div> : (
            <div className="list">
              {shown.map((r) => {
                const online = now - Date.parse(r.last) < ONLINE_MS;
                return (
                  <div key={r.id} className="li">
                    <span className="li-main">
                      <div className="li-title" style={{ fontSize: 14 }}>
                        {online && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--green)', marginRight: 6 }} aria-label="En ligne" />}
                        {r.tester ?? `Appareil ${r.id.slice(0, 4).toUpperCase()}`}
                      </div>
                      <div className="li-sub" style={{ whiteSpace: 'normal' }}>
                        {r.device} · {r.v === 'beta' ? 'bêta' : 'officielle'}{r.google ? ' · Google' : ''} · {r.opens} visite{r.opens > 1 ? 's' : ''} · depuis le {new Date(r.first).toLocaleDateString('fr-FR')}
                      </div>
                    </span>
                    <span className={`tiny ${online ? 'pos' : 'faint'}`} style={{ whiteSpace: 'nowrap' }}>{online ? 'en ligne' : sinceLabel(r.last, now)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="tiny faint">Chaque appareil est compté une fois, sans nom ni e-mail. Un utilisateur qui change de téléphone ou de navigateur compte deux fois.</p>
          <button className="btn btn-ghost btn-sm" onClick={() => { lockAdmin(); go('reglages'); }}>Verrouiller l'accès admin sur cet appareil</button>
        </>
      )}
    </>
  );
}

function AdminUnlock({ onDone }: { onDone: () => void }) {
  const ui = useUI();
  const [code, setCode] = useState('');
  const { error, run, busy } = useAction();
  return (
    <div className="card">
      <ErrorBox error={error} />
      <Field label="Code admin"><input className="input" type="password" autoCapitalize="none" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={() => run(async () => {
        if (!(await unlockAdmin(code))) throw new Error('Code incorrect.');
        ui.toast('Accès admin ouvert sur cet appareil');
        onDone();
      })}>Ouvrir</button>
    </div>
  );
}

/** Réglages : partage des statistiques anonymes et accès admin. */
export function StatsSettings() {
  const s = useData().settings;
  return (
    <>
      <label className="check" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={s.shareStats !== false} onChange={(e) => saveSettings({ shareStats: e.target.checked })} />
        <span><b>Statistiques anonymes</b><br /><span className="small muted">Aide le créateur de l'appli à savoir combien de personnes l'utilisent : un identifiant tiré au hasard, le type d'appareil et la version. Jamais tes ventes, ton nom ou ton e-mail.</span></span>
      </label>
      <button className="link small" style={{ marginTop: 4 }} onClick={() => go('admin')}>{isStatsAdmin() ? 'Admin : utilisateurs' : 'Accès admin'}</button>
    </>
  );
}
