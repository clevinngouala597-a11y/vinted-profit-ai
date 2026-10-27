import { useMemo, useRef, useState } from 'react';
import {
  autoMap,
  commitArticles,
  commitExpenses,
  FIELDS,
  parseCSV,
  validateArticles,
  validateExpenses,
  type ArticleRow,
  type ExpenseRow,
  type ImportKind,
  type Validation,
} from '../lib/importer';
import { downloadText } from '../lib/exports';
import { formatEuros } from '../lib/money';
import { formatDate } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { ErrorBox, Field, PageHeader, useAction, useUI } from '../ui/kit';

const TEMPLATES: Record<ImportKind, string> = {
  articles:
    'Article;Catégorie;Marque;Taille;Date achat;Prix achat;Frais achat;Prix souhaité;Date de vente;Prix de vente;Frais de vente;Notes\r\n' +
    'Sweat Nike gris;Sweats et pulls;Nike;M;01/09/2026;5,00;1,00;18,00;10/09/2026;18,00;0,50;\r\n' +
    'Jean Levi’s 501;Pantalons et jeans;Levi’s;W32;02/09/2026;12,00;;30,00;;;;encore en stock\r\n',
  depenses: 'Date;Montant;Catégorie;Fournisseur;Description\r\n05/09/2026;8,90;Emballages;Action;Enveloppes\r\n',
};

/** Lit le fichier en UTF-8, ou en Windows-1252 (export Excel ancien) si des caractères sont illisibles. */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

export function Import() {
  const ds = useData();
  const ui = useUI();
  const [kind, setKind] = useState<ImportKind>('articles');
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [map, setMap] = useState<Record<string, number | null>>({});
  const [step, setStep] = useState<'file' | 'map' | 'check' | 'done'>('file');
  const [withDup, setWithDup] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const { error, setError, run, busy } = useAction();
  const frozen = useRef<Validation<ArticleRow> | Validation<ExpenseRow> | null>(null);

  const headers = file?.rows[0] ?? [];
  const body = useMemo(() => file?.rows.slice(1) ?? [], [file]);
  const validation = useMemo<Validation<ArticleRow> | Validation<ExpenseRow> | null>(() => {
    if (!file || step !== 'check') return null;
    if (busy) return frozen.current;
    return kind === 'articles' ? validateArticles(ds, body, map) : validateExpenses(ds, body, map);
  }, [file, step, kind, ds, body, map, busy]);
  if (!busy) frozen.current = validation;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    await run(async () => {
      if (f.size > 5 * 1024 * 1024) throw new Error('Fichier trop lourd (5 Mo maximum).');
      const rows = parseCSV(await readText(f));
      if (rows.length < 2) throw new Error("Le fichier ne contient pas de lignes de données sous l'en-tête.");
      setFile({ name: f.name, rows });
      setMap(autoMap(kind, rows[0]));
      setStep('map');
    });
  };

  const missing = FIELDS[kind].filter((f) => f.required && (map[f.key] === null || map[f.key] === undefined));

  const confirm = async () => {
    if (!validation) return;
    const rows = [...validation.valid, ...(withDup ? validation.duplicates : [])].sort((a, b) => a.line - b.line);
    if (!rows.length) return setError('Aucune ligne à importer.');
    const ok = await ui.confirm({
      title: `Importer ${rows.length} ligne${rows.length > 1 ? 's' : ''} ?`,
      text: kind === 'articles'
        ? 'Chaque ligne crée un achat (et une vente terminée si elle est renseignée). Pense à faire une sauvegarde avant si tu veux pouvoir revenir en arrière.'
        : 'Chaque ligne crée une dépense et un mouvement de trésorerie.',
      confirmLabel: 'Importer',
    });
    if (!ok) return;
    const res = await run(async () => {
      setProgress(0);
      setTotal(rows.length);
      if (kind === 'articles') {
        const r = await commitArticles(ds, rows as ArticleRow[], file!.name, setProgress);
        return `${r.items} article${r.items > 1 ? 's' : ''} importé${r.items > 1 ? 's' : ''}, dont ${r.sold} vendu${r.sold > 1 ? 's' : ''}.${r.newCategories.length ? ` Nouvelles catégories : ${r.newCategories.join(', ')}.` : ''}`;
      }
      const r = await commitExpenses(rows as ExpenseRow[], file!.name, setProgress);
      return `${r.expenses} dépense${r.expenses > 1 ? 's' : ''} importée${r.expenses > 1 ? 's' : ''}.`;
    });
    if (res) {
      setResult(res);
      setStep('done');
      ui.toast('Import terminé');
    }
  };

  return (
    <>
      <PageHeader title="Importer un fichier" sub="Reprends un suivi existant (Excel, Google Sheets…)" backTo="exports" />
      <ErrorBox error={error} />

      {step === 'file' && (
        <>
          <div className="seg" role="group" aria-label="Type de données" style={{ marginBottom: 14 }}>
            <button aria-pressed={kind === 'articles'} onClick={() => setKind('articles')}>Articles</button>
            <button aria-pressed={kind === 'depenses'} onClick={() => setKind('depenses')}>Dépenses</button>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            {kind === 'articles'
              ? "Une ligne par article : nom, date et prix d'achat obligatoires. Si la date et le montant de vente sont remplis, la vente est créée aussi."
              : 'Une ligne par dépense : date et montant obligatoires. Les achats d’articles ne sont pas des dépenses : importe-les comme articles.'}
          </p>
          <p className="small muted">Depuis Excel ou Numbers : Fichier → Exporter → CSV. Tu pourras vérifier chaque colonne avant d'importer.</p>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            {busy ? 'Lecture…' : 'Choisir un fichier CSV'}
            <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => downloadText(`modele-${kind}.csv`, '﻿' + TEMPLATES[kind])}>
            Télécharger un modèle à remplir
          </button>
        </>
      )}

      {step === 'map' && file && (
        <>
          <div className="card small" style={{ marginBottom: 12 }}>
            <b>{file.name}</b> · {body.length} ligne{body.length > 1 ? 's' : ''} · {headers.length} colonnes
          </div>
          <h2 style={{ marginTop: 0 }}>Associer les colonnes</h2>
          <p className="small muted" style={{ marginTop: 0 }}>J'ai proposé une correspondance d'après les en-têtes. Corrige-la si besoin.</p>
          {FIELDS[kind].map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? ' (obligatoire)' : ''}`}>
              <select
                className="input"
                value={map[f.key] ?? ''}
                aria-invalid={f.required && (map[f.key] === null || map[f.key] === undefined) ? true : undefined}
                onChange={(e) => setMap({ ...map, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">— Ne pas importer —</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>{h || `Colonne ${i + 1}`} · ex. « {body[0]?.[i] ?? ''} »</option>
                ))}
              </select>
            </Field>
          ))}
          {missing.length > 0 && <div className="alert warn">Associe d'abord : {missing.map((f) => f.label).join(', ')}.</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn btn-primary" disabled={missing.length > 0} onClick={() => setStep('check')}>Vérifier les lignes</button>
            <button className="btn btn-ghost" onClick={() => { setFile(null); setStep('file'); }}>Choisir un autre fichier</button>
          </div>
        </>
      )}

      {step === 'check' && validation && (
        <>
          <div className="grid2">
            <div className="tile"><div className="tile-label">Prêtes à importer</div><div className="tile-value pos">{validation.valid.length}</div></div>
            <div className="tile"><div className="tile-label">Rejetées</div><div className={`tile-value ${validation.rejected.length ? 'neg' : ''}`}>{validation.rejected.length}</div></div>
          </div>

          {validation.valid.length > 0 && (
            <>
              <h2>Aperçu</h2>
              <div className="card scroll-x">
                <table className="report">
                  {kind === 'articles' ? (
                    <>
                      <thead><tr><th>Article</th><th>Achat</th><th>Coût</th><th>Vente</th><th>Encaissé</th></tr></thead>
                      <tbody>
                        {(validation.valid as ArticleRow[]).slice(0, 8).map((r) => (
                          <tr key={r.line}>
                            <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}<div className="tiny faint">{r.category}</div></td>
                            <td>{formatDate(r.purchaseDate)}</td>
                            <td>{formatEuros(r.purchasePrice + r.fees)}</td>
                            <td>{r.saleDate ? formatDate(r.saleDate) : '—'}</td>
                            <td>{r.salePrice === null ? '—' : formatEuros(r.salePrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  ) : (
                    <>
                      <thead><tr><th>Date</th><th>Catégorie</th><th>Description</th><th>Montant</th></tr></thead>
                      <tbody>
                        {(validation.valid as ExpenseRow[]).slice(0, 8).map((r) => (
                          <tr key={r.line}><td>{formatDate(r.date)}</td><td>{r.category}</td><td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.description || r.supplier}</td><td>{formatEuros(r.amount)}</td></tr>
                        ))}
                      </tbody>
                    </>
                  )}
                </table>
                {validation.valid.length > 8 && <p className="tiny faint">… et {validation.valid.length - 8} autres lignes.</p>}
              </div>
            </>
          )}

          {validation.duplicates.length > 0 && (
            <>
              <h2>Doublons probables <span className="h2-note">{validation.duplicates.length}</span></h2>
              <div className="list">
                {validation.duplicates.slice(0, 20).map((d) => (
                  <div className="li" key={d.line}>
                    <span className="li-main"><div className="li-title" style={{ fontSize: 14 }}>Ligne {d.line} · {'name' in d ? d.name : formatEuros(d.amount)}</div><div className="li-sub" style={{ whiteSpace: 'normal' }}>{d.reason}</div></span>
                  </div>
                ))}
              </div>
              <label className="check" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={withDup} onChange={(e) => setWithDup(e.target.checked)} />
                <span><b>Importer aussi les doublons</b><br /><span className="small muted">Par défaut, ils sont ignorés pour ne rien compter deux fois.</span></span>
              </label>
            </>
          )}

          {validation.rejected.length > 0 && (
            <>
              <h2>Lignes rejetées <span className="h2-note">{validation.rejected.length}</span></h2>
              <div className="list">
                {validation.rejected.slice(0, 30).map((r) => (
                  <div className="li" key={r.line}>
                    <span className="li-main"><div className="li-title" style={{ fontSize: 14 }}>Ligne {r.line}</div><div className="li-sub" style={{ whiteSpace: 'normal' }}>{r.reason}</div></span>
                  </div>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => downloadText(
                'lignes-rejetees.csv',
                '﻿Ligne;Motif;' + headers.join(';') + '\r\n' + validation.rejected.map((r) => [r.line, r.reason, ...r.raw].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n'),
              )}>Télécharger le rapport des rejets</button>
            </>
          )}

          <div className="sticky-actions">
            {busy && <div className="alert ok">Import en cours… {progress} / {total}</div>}
            <button className="btn btn-primary" disabled={busy || validation.valid.length + (withDup ? validation.duplicates.length : 0) === 0} onClick={confirm}>
              Importer {validation.valid.length + (withDup ? validation.duplicates.length : 0)} ligne{validation.valid.length + (withDup ? validation.duplicates.length : 0) > 1 ? 's' : ''}
            </button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy} onClick={() => setStep('map')}>Revoir les colonnes</button>
          </div>
        </>
      )}

      {step === 'done' && (
        <>
          <div className="alert ok">{result}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => go(kind === 'articles' ? 'stock?filtre=tous' : 'depenses')}>{kind === 'articles' ? 'Voir le stock' : 'Voir les dépenses'}</button>
            <button className="btn btn-ghost" onClick={() => { setFile(null); setStep('file'); setResult(null); }}>Importer un autre fichier</button>
          </div>
        </>
      )}
    </>
  );
}
