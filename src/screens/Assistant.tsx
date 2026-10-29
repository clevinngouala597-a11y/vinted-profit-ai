import { useEffect, useRef, useState } from 'react';
import { answer, rephraseWithClaude, SUGGESTIONS, type Answer } from '../lib/assistant';
import { AI_MODEL } from '../lib/listing';
import { todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { IChevron } from '../ui/icons';
import { PageHeader } from '../ui/kit';

interface Turn { id: number; q: string; a: Answer | null; understood?: string; pending?: boolean }
let seq = 0;

/** Questions en langage naturel, réponses calculées sur les vraies données (jamais inventées). */
export function Assistant() {
  const ds = useData();
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const key = ds.settings.anthropicKey?.trim();

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns.length]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question) return;
    setQ('');
    const id = ++seq;
    const direct = answer(ds, question, todayISO());
    if (direct || !key) { setTurns((t) => [...t, { id, q: question, a: direct }]); return; }
    // question libre : reformulée par Claude en question type, puis calculée ici
    setTurns((t) => [...t, { id, q: question, a: null, pending: true }]);
    const re = await rephraseWithClaude(key, question, AI_MODEL);
    const a = re ? answer(ds, re, todayISO()) : null;
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, a, understood: a ? re! : undefined, pending: false } : x)));
  };

  return (
    <>
      <PageHeader title="Assistant" sub="Pose une question sur ton activité" backTo="" />
      {turns.length === 0 && (
        <div className="card small muted" style={{ marginBottom: 12 }}>
          Les réponses sont calculées sur tes vraies ventes, achats et dépenses, avec les mêmes calculs que le bilan. Chaque réponse indique sur quoi elle repose. Rien n’est inventé : si une question n’est pas comprise, l’assistant te le dit.
        </div>
      )}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {turns.map((t) => (
          <div key={t.id} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <div className="bubble-q">{t.q}</div>
            {t.pending ? <div className="card small muted">Je cherche ce que tu veux dire…</div> : t.a ? <AnswerCard a={t.a} understood={t.understood} /> : (
              <div className="card">
                <b>Je n’ai pas compris cette question.</b>
                <p className="small muted" style={{ margin: '4px 0 8px' }}>Je ne réponds qu’avec des chiffres calculés sur tes données. Essaie par exemple :</p>
                <Chips list={SUGGESTIONS.slice(0, 6)} onPick={ask} />
                {!key && <p className="tiny faint" style={{ marginBottom: 0 }}>Avec ta clé Claude (réglages de l’annonce IA), les questions formulées librement sont aussi comprises. Seule la question est envoyée, jamais tes données.</p>}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      {turns.length === 0 && (
        <>
          <h2>Exemples</h2>
          <Chips list={SUGGESTIONS} onPick={ask} wrap />
        </>
      )}

      <form className="sticky-actions" style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. mes 5 articles les plus rentables" aria-label="Ta question" enterKeyHint="send" />
        <button className="btn btn-primary" style={{ width: 'auto', flex: 'none' }} disabled={!q.trim()}>Demander</button>
      </form>
    </>
  );
}

function Chips({ list, onPick, wrap }: { list: string[]; onPick: (q: string) => void; wrap?: boolean }) {
  return (
    <div className="chips" style={wrap ? { flexWrap: 'wrap', overflow: 'visible', margin: 0, padding: 0 } : undefined}>
      {list.map((s) => <button key={s} className="chip" style={{ whiteSpace: wrap ? 'normal' : 'nowrap', textAlign: 'left' }} onClick={() => onPick(s)}>{s}</button>)}
    </div>
  );
}

export function AnswerCard({ a, understood }: { a: Answer; understood?: string }) {
  return (
    <div className="card answer">
      {understood && <div className="tiny faint" style={{ marginBottom: 4 }}>Compris comme : « {understood} »</div>}
      <div className="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{a.title}</div>
      <p style={{ margin: '4px 0 8px', fontSize: 16, fontWeight: 600 }}>{a.text}</p>
      {a.lines && (
        <div className="calc" style={{ marginBottom: 8 }}>
          {a.lines.map(([k, v]) => <div className="calc-row" key={k}><span>{k}</span><span>{v}</span></div>)}
        </div>
      )}
      {a.table && (
        <div className="scroll-x" style={{ marginBottom: 8 }}>
          <table className="report" style={{ width: '100%' }}>
            <thead><tr>{a.table.columns.map((c, i) => <th key={i} style={i === 0 ? { textAlign: 'left' } : undefined}>{c}</th>)}</tr></thead>
            <tbody>
              {a.table.rows.map((r, i) => {
                const to = a.table!.links?.[i];
                return (
                  <tr key={i} onClick={to ? () => go(to) : undefined} style={to ? { cursor: 'pointer' } : undefined}>
                    {r.map((c, j) => <td key={j} style={j === 0 ? { textAlign: 'left', textDecoration: to ? 'underline' : undefined, textDecorationColor: 'var(--line)' } : undefined} className={j > 0 && /^[-−]/.test(c) ? 'neg' : undefined}>{c}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="tiny faint">{a.basis}</div>
      {a.link && <button className="link" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => go(a.link!.to)}>{a.link.label} <IChevron width={14} height={14} /></button>}
    </div>
  );
}
