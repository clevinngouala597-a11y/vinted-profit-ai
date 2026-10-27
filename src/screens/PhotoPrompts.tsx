import { useState } from 'react';
import { BACKGROUNDS, buildPrompts, LIGHTS, MODES, STYLES, VIEWS, type PromptInput } from '../lib/photoPrompts';
import { CONDITIONS } from '../lib/listing';
import { Field, PageHeader, useUI } from '../ui/kit';

const TYPES = ['T-shirt', 'Sweat', 'Pull', 'Hoodie', 'Veste', 'Manteau', 'Doudoune', 'Polaire', 'Chemise', 'Polo', 'Jean', 'Pantalon', 'Jogging', 'Short', 'Robe', 'Jupe', 'Ensemble', 'Baskets', 'Chaussures', 'Sac', 'Casquette', 'Montre', 'Bijou', 'Accessoire'];
const TYPE_EN: Record<string, string> = { 'T-shirt': 't-shirt', Sweat: 'sweatshirt', Pull: 'sweater', Hoodie: 'hoodie', Veste: 'jacket', Manteau: 'coat', Doudoune: 'puffer jacket', Polaire: 'fleece jacket', Chemise: 'shirt', Polo: 'polo shirt', Jean: 'jeans', Pantalon: 'trousers', Jogging: 'sweatpants', Short: 'shorts', Robe: 'dress', Jupe: 'skirt', Ensemble: 'two-piece set', Baskets: 'sneakers', Chaussures: 'shoes', Sac: 'bag', Casquette: 'cap', Montre: 'watch', Bijou: 'jewelry piece', Accessoire: 'accessory' };

function Chips<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string; recommended?: boolean }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
      {options.map((o) => <button key={o.id} className="chip" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}{o.recommended ? ' ⭐' : ''}</button>)}
    </div>
  );
}

/** Prompts pour une IA d'image : de belles photos homogènes à partir des vraies photos de l'article. */
export function PhotoPrompts() {
  const ui = useUI();
  const [p, setP] = useState<PromptInput>({ mode: 'plat', type: '', color: '', brand: '', condition: 'Très bon état', views: ['face', 'dos'], background: 'parquet', light: 'naturelle', style: 'soigne' });
  const [out, setOut] = useState<{ view: string; prompt: string }[] | null>(null);
  const set = <K extends keyof PromptInput>(k: K) => (v: PromptInput[K]) => { setP({ ...p, [k]: v }); setOut(null); };
  const toggleView = (id: string) => set('views')(p.views.includes(id) ? p.views.filter((v) => v !== id) : [...p.views, id]);
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => ui.toast('Prompt copié')).catch(() => ui.toast('Copie impossible'));

  return (
    <>
      <PageHeader title="Photos IA" sub="Prompts pour des photos réalistes à partir de tes vraies photos" backTo="annonce" />

      <div className="seg" role="group" aria-label="Type de photo" style={{ marginBottom: 12 }}>
        {MODES.map((m) => <button key={m.id} aria-pressed={p.mode === m.id} onClick={() => set('mode')(m.id)}>{m.emoji} {m.label}</button>)}
      </div>

      <div className="card">
        <b className="small" style={{ color: 'var(--green)', letterSpacing: '.08em' }}>🧥 ARTICLE</b>
        <Field label="Type de vêtement">
          <select className="input" value={p.type} onChange={(e) => set('type')(e.target.value)}>
            <option value="">— Choisir —</option>{TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <div className="cols">
          <Field label="Couleur principale"><input className="input" value={p.color} onChange={(e) => set('color')(e.target.value)} placeholder="ex : blanc cassé, kaki…" /></Field>
          <Field label="Marque (facultatif)"><input className="input" value={p.brand} onChange={(e) => set('brand')(e.target.value)} placeholder="ex : Zara, Nike…" /></Field>
        </div>
        <Field label="État"><Chips options={CONDITIONS.map((c) => ({ id: c, label: c }))} value={p.condition as (typeof CONDITIONS)[number]} onChange={set('condition')} /></Field>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <b className="small" style={{ color: 'var(--green)', letterSpacing: '.08em' }}>📸 VUES À PHOTOGRAPHIER</b>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          {VIEWS.map((v) => {
            const on = p.views.includes(v.id);
            return (
              <button key={v.id} onClick={() => toggleView(v.id)} aria-pressed={on} style={{ padding: '14px 8px', borderRadius: 16, border: `1.5px solid ${on ? 'var(--green)' : 'var(--line)'}`, background: on ? 'var(--green-soft)' : 'var(--card-2)', color: on ? 'var(--green)' : 'var(--text)', font: 'inherit', fontWeight: 700 }}>
                <div style={{ fontSize: 26 }}>{v.emoji}</div>{v.label}
              </button>
            );
          })}
        </div>
        <p className="tiny faint">Un prompt par vue, chacun avec son fond adapté.</p>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <b className="small" style={{ color: 'var(--green)', letterSpacing: '.08em' }}>🎨 AMBIANCE DU FOND</b>
        <Field label="Fond principal"><Chips options={BACKGROUNDS} value={p.background} onChange={set('background')} /></Field>
        <Field label="Lumière"><Chips options={LIGHTS} value={p.light} onChange={set('light')} /></Field>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <b className="small" style={{ color: 'var(--green)', letterSpacing: '.08em' }}>✨ RÉALISME</b>
        <Field label="Style photo" hint="⭐ Recommandé Vinted : naturel, sans effet « catalogue »."><Chips options={STYLES} value={p.style} onChange={set('style')} /></Field>
      </div>

      <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={p.views.length === 0}
        onClick={() => setOut(buildPrompts({ ...p, type: TYPE_EN[p.type] ?? p.type }))}>Générer les prompts →</button>

      {out && (
        <>
          <h2>{out.length} prompt{out.length > 1 ? 's' : ''}</h2>
          <p className="tiny faint" style={{ marginTop: 0 }}>Colle chaque prompt dans ton IA d'image (ChatGPT, Gemini…) avec la vraie photo de la vue. L'article reste identique : les acheteurs doivent recevoir ce qu'ils voient.</p>
          {out.map((o) => (
            <div key={o.view} className="card" style={{ marginBottom: 8 }}>
              <div className="row-between"><b>{o.view}</b><button className="btn btn-ghost btn-sm" onClick={() => copy(o.prompt)}>Copier</button></div>
              <p className="small muted" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{o.prompt}</p>
            </div>
          ))}
          {out.length > 1 && <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => copy(out.map((o) => `— ${o.view} —\n${o.prompt}`).join('\n\n'))}>Tout copier</button>}
        </>
      )}
    </>
  );
}
