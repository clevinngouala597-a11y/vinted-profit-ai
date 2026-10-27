import { useState } from 'react';
import { saveSettings } from '../lib/actions';
import { periodMetrics } from '../lib/engine';
import {
  downloadBlob,
  downloadText,
  expensesTable,
  itemsTable,
  monthlyTable,
  purchasesRegisterTable,
  receiptsBookTable,
  salesTable,
  toCSV,
  transactionsTable,
} from '../lib/exports';
import { fiscalSummary, RULES, VERIFIED_ON } from '../lib/fiscal';
import { formatEuros } from '../lib/money';
import { formatDate, formatMonth, todayISO } from '../lib/period';
import { useData } from '../lib/useData';
import type { Settings } from '../lib/types';
import { IBack, IChevron, IDownload } from '../ui/icons';
import { ErrorBox, Field, InfoButton, PageHeader, useAction, useUI } from '../ui/kit';

export function Fiscal() {
  const ds = useData();
  const ui = useUI();
  const today = todayISO();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { error, run, busy } = useAction();
  const f = fiscalSummary(ds, year, today);
  const s = ds.settings;
  const micro = s.activityStatus === 'micro';
  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  const profit = periodMetrics(ds, range.from, range.to).commercialProfit;
  const set = (patch: Partial<Settings>) => run(async () => { await saveSettings(patch); });

  const bar = (cur: number, max: number) => (
    <div className="progress"><div style={{ width: `${Math.min(100, Math.max(0, (cur / max) * 100))}%`, background: cur >= max ? 'var(--warn)' : undefined }} /></div>
  );

  const dossier = () => run(async () => {
    const { buildWorkbook } = await import('../lib/office');
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`)
      .filter((m) => m <= today)
      .map((m) => ({ label: formatMonth(m), range: { from: m, to: `${m.slice(0, 8)}${new Date(year, Number(m.slice(5, 7)), 0).getDate()}` } }));
    const blob = await buildWorkbook([
      receiptsBookTable(ds, range), purchasesRegisterTable(ds, range), monthlyTable(ds, months),
      salesTable(ds, range), expensesTable(ds, range), transactionsTable(ds, range), itemsTable(ds),
    ]);
    downloadBlob(`dossier-comptable_${year}.xlsx`, blob);
    ui.toast('Dossier exporté');
  });

  return (
    <>
      <PageHeader title="Fiscalité" sub="Aide à la préparation, pas une déclaration" backTo="" />
      <ErrorBox error={error} />
      <div className="row-between" style={{ margin: '0 0 12px', alignItems: 'center' }}>
        <button className="icon-btn" aria-label="Année précédente" onClick={() => setYear(year - 1)}><IBack /></button>
        <b style={{ fontSize: 17 }}>{year}</b>
        <button className="icon-btn" aria-label="Année suivante" disabled={year >= thisYear} style={year >= thisYear ? { opacity: 0.3 } : undefined} onClick={() => setYear(year + 1)}><IChevron /></button>
      </div>

      <section className="hero">
        <div className="hero-label">Recettes encaissées en {year}</div>
        <div className="hero-amount" style={{ fontSize: 40 }}>{formatEuros(f.receipts)}</div>
        <div className="hero-meta">
          <span>Bénéfice commercial <b>{formatEuros(profit)}</b> <InfoButton k="profit" /></span>
          <span>Achats de stock <b>{formatEuros(f.purchases)}</b></span>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Les recettes comptent les paiements réellement reçus, à leur date de réception, remboursements déduits. En micro-entreprise, c'est ce montant qu'on déclare, pas le bénéfice.
        </p>
      </section>

      {f.alerts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {f.alerts.map((a) => (
            <div key={a.text} className={`alert ${a.level === 'danger' ? 'error' : a.level === 'warn' ? 'warn' : 'ok'}`} style={a.level === 'info' ? { background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--line)' } : undefined}>
              {a.text}
            </div>
          ))}
        </div>
      )}

      <h2>Ton statut</h2>
      <div className="card">
        <Field label="Statut de l'activité">
          <select className="input" value={s.activityStatus} onChange={(e) => set({ activityStatus: e.target.value as Settings['activityStatus'] })}>
            <option value="particulier">Particulier</option>
            <option value="micro">Micro-entrepreneur</option>
            <option value="autre">Autre statut</option>
          </select>
        </Field>
        {micro && (
          <>
            <div className="cols">
              <Field label="Début d'activité">
                <input type="date" className="input" value={s.activityStart ?? ''} onChange={(e) => set({ activityStart: e.target.value || null })} />
              </Field>
              <Field label="Déclaration Urssaf">
                <select className="input" value={s.declarationFrequency} onChange={(e) => set({ declarationFrequency: e.target.value as Settings['declarationFrequency'] })}>
                  <option value="mensuelle">Mensuelle</option>
                  <option value="trimestrielle">Trimestrielle</option>
                </select>
              </Field>
            </div>
            <Field label="Régime de TVA">
              <select className="input" value={s.vatRegime} onChange={(e) => set({ vatRegime: e.target.value as Settings['vatRegime'] })}>
                <option value="franchise">Franchise en base (pas de TVA facturée)</option>
                <option value="assujetti">Assujetti à la TVA</option>
                <option value="inconnu">Je ne sais pas</option>
              </select>
            </Field>
            <label className="check" style={{ marginBottom: 0 }}>
              <input type="checkbox" checked={s.versementLiberatoire} onChange={(e) => set({ versementLiberatoire: e.target.checked })} disabled={busy} />
              <span><b>J'ai opté pour le versement libératoire</b><br /><span className="small muted">L'impôt sur le revenu est alors payé avec les cotisations, à {RULES.vlRate.value} % des recettes.</span></span>
            </label>
          </>
        )}
        {s.activityStatus === 'particulier' && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Vendre tes propres affaires d'occasion n'est en général pas imposable. Acheter pour revendre l'est : aucune estimation de cotisations n'est calculée ici, car elle dépend du cadre que tu choisiras.
          </p>
        )}
      </div>

      <h2>Transmission par Vinted (DAC7)</h2>
      <div className="card">
        <div className="row-between small"><span className="muted">Ventes en {year}</span><b>{f.dac7.count} / {RULES.dac7Sales.value}</b></div>
        {bar(f.dac7.count, RULES.dac7Sales.value)}
        <div className="row-between small" style={{ marginTop: 8 }}><span className="muted">Montants encaissés</span><b>{formatEuros(f.dac7.amount)} / {formatEuros(RULES.dac7Amount.value)}</b></div>
        {bar(f.dac7.amount, RULES.dac7Amount.value)}
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          {f.dac7.reportable
            ? 'Un seuil est atteint : la plateforme déclarera probablement tes ventes de l’année à l’administration fiscale.'
            : 'Sous les deux seuils, la plateforme ne transmet pas tes ventes.'}{' '}
          Compteur approximatif, d'après tes saisies. La transmission ne rend pas les sommes imposables en elle-même.
        </p>
      </div>

      {micro && (
        <>
          <h2>Estimation {year}</h2>
          <div className="calc">
            <div className="calc-row"><span>Cotisations sociales ({RULES.socialRate.value.toLocaleString('fr-FR')} %)</span><span>{formatEuros(f.social ?? 0)}</span></div>
            <div className="calc-row"><span>Formation professionnelle ({RULES.cfpRate.value.toLocaleString('fr-FR')} %)</span><span>{formatEuros(f.cfp ?? 0)}</span></div>
            {s.versementLiberatoire && <div className="calc-row"><span>Versement libératoire ({RULES.vlRate.value} %)</span><span>{formatEuros(f.vl ?? 0)}</span></div>}
            <div className="calc-row total"><span>Total estimé</span><span>{formatEuros(f.total ?? 0)}</span></div>
            {f.taxableBase !== null && (
              <div className="calc-row"><span>Revenu à ajouter à ta déclaration d'impôt (après abattement de {RULES.microAllowance.value} %)</span><span>{formatEuros(f.taxableBase)}</span></div>
            )}
          </div>
          <p className="tiny faint">Estimation à partir des recettes encaissées saisies. Le montant exact est celui calculé par l'Urssaf lors de ta déclaration.</p>

          <h2>Seuils</h2>
          <div className="card">
            <div className="row-between small"><span className="muted">Franchise de TVA</span><b>{formatEuros(f.receipts)} / {formatEuros(RULES.vatBase.value)}</b></div>
            {bar(f.receipts, RULES.vatBase.value)}
            <div className="row-between small" style={{ marginTop: 8 }}><span className="muted">Plafond micro-entreprise</span><b>{formatEuros(f.receipts)} / {formatEuros(RULES.microCeiling.value)}</b></div>
            {bar(f.receipts, RULES.microCeiling.value)}
          </div>

          <h2>Déclarations Urssaf</h2>
          {!s.activityStart && f.periods.length > 0 && <p className="tiny muted" style={{ marginTop: 0 }}>Indique ta date de début d'activité pour n'afficher que les périodes qui te concernent.</p>}
          {f.periods.length === 0 ? (
            <div className="card small muted">Aucune période écoulée pour {year}.</div>
          ) : (
            <div className="card scroll-x">
              <table className="report">
                <thead><tr><th>Période</th><th>Recettes</th><th>Estimation</th><th /></tr></thead>
                <tbody>
                  {f.periods.map((p) => (
                    <tr key={p.key}>
                      <td style={{ textTransform: 'capitalize' }}>{p.label}</td>
                      <td>{formatEuros(p.receipts)}</td>
                      <td>{formatEuros(p.total ?? 0)}</td>
                      <td><span className="badge">{p.closed ? 'Période close' : 'En cours'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="tiny faint">À déclarer même à 0 €, sur autoentrepreneur.urssaf.fr. L'application ne marque pas une période comme déclarée et n'effectue aucune démarche.</p>
        </>
      )}

      <h2>Documents</h2>
      <div className="list">
        <DocRow title="Livre des recettes" sub="Recettes encaissées, dans l'ordre chronologique" onClick={() => { downloadText(`livre-des-recettes_${year}.csv`, toCSV(receiptsBookTable(ds, range))); ui.toast('Livre des recettes exporté'); }} />
        <DocRow title="Registre des achats" sub="Achats de marchandises de l'année" onClick={() => { downloadText(`registre-des-achats_${year}.csv`, toCSV(purchasesRegisterTable(ds, range))); ui.toast('Registre des achats exporté'); }} />
        <DocRow title="Dossier pour l'expert-comptable" sub="Classeur Excel : recettes, achats, rapport mensuel, ventes, dépenses, trésorerie, inventaire" onClick={dossier} />
      </div>

      <h2>Sources</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Règles vérifiées le {formatDate(VERIFIED_ON)} sur les sites officiels. Elles peuvent évoluer : en cas de doute, la source fait foi.</p>
      <div className="list">
        {Object.values(RULES).map((r) => (
          <a key={r.label} className="li" href={r.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <span className="li-main">
              <div className="li-title" style={{ whiteSpace: 'normal', fontSize: 14 }}>{r.label}</div>
              <div className="li-sub" style={{ whiteSpace: 'normal' }}>{r.source}</div>
            </span>
            <IChevron className="faint" />
          </a>
        ))}
      </div>
      <p className="tiny faint" style={{ marginTop: 12 }}>
        Ce module t'aide à préparer tes démarches. Il ne remplace pas un conseil personnalisé : pour un doute sur ton statut, contacte ton service des impôts, l'Urssaf ou un expert-comptable.
      </p>
    </>
  );
}

function DocRow({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button className="li" onClick={onClick}>
      <span className="dot out"><IDownload width={17} height={17} /></span>
      <span className="li-main"><div className="li-title">{title}</div><div className="li-sub" style={{ whiteSpace: 'normal' }}>{sub}</div></span>
    </button>
  );
}
