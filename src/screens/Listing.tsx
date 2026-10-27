import { useMemo, useState } from 'react';
import { recordPurchase, saveSettings } from '../lib/actions';
import { centsToInput, formatEuros, parseEuros } from '../lib/money';
import { todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { DEFAULT_CATEGORIES } from '../lib/types';
import { CONDITIONS, draftListing, priceAdvice, type ListingDraft } from '../lib/listing';
import { ErrorBox, Field, MoneyInput, PageHeader, useAction, useUI } from '../ui/kit';

/** Photo réduite à 1024 px (JPEG) : envoi rapide et peu coûteux. */
async function shrink(file: File): Promise<{ url: string; b64: string }> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.82);
  return { url, b64: url.split(',')[1] };
}

function CopyField({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  const ui = useUI();
  const copy = () => navigator.clipboard.writeText(value).then(() => ui.toast(`${label} copié`)).catch(() => ui.toast('Copie impossible : sélectionne le texte'));
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {multiline
          ? <textarea className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ minHeight: 150, flex: 1 }} />
          : <input className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />}
        <button className="btn btn-ghost btn-sm" onClick={copy} style={{ flex: 'none' }}>Copier</button>
      </div>
    </Field>
  );
}

export function Listing() {
  const ds = useData();
  const ui = useUI();
  const s = ds.settings;
  const [photos, setPhotos] = useState<{ url: string; b64: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [cost, setCost] = useState('');
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [price, setPrice] = useState('');
  const [key, setKey] = useState('');
  const { error, run, busy } = useAction();
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...s.customCategories])];

  const advice = useMemo(() => (draft ? priceAdvice(ds, { brand: draft.brand, category: draft.category }, cost.trim() ? parseEuros(cost) : null) : null), [ds, draft, cost]);
  const set = <K extends keyof ListingDraft>(k: K) => (v: ListingDraft[K]) => draft && setDraft({ ...draft, [k]: v });

  const addPhotos = (files: FileList | null) => run(async () => {
    if (!files) return;
    const next = [...photos];
    for (const f of [...files].slice(0, 5 - photos.length)) next.push(await shrink(f));
    setPhotos(next);
  });

  const generate = () => run(async () => {
    const d = await draftListing(s.anthropicKey, photos.map((p) => p.b64), notes, cats);
    setDraft(d);
    const a = priceAdvice(ds, { brand: d.brand, category: d.category }, cost.trim() ? parseEuros(cost) : null);
    const suggested = Math.max(a.median ?? 0, a.minimum ?? 0);
    if (suggested > 0) setPrice(centsToInput(Math.ceil(suggested / 100) * 100));
  });

  const addToStock = () => run(async () => {
    if (!draft) return;
    const c = cost.trim() ? parseEuros(cost) : null;
    if (cost.trim() && (c === null || c < 0)) throw new Error("Le prix d'achat n'est pas valide.");
    const target = price.trim() ? parseEuros(price) : null;
    const name = draft.title.replace(/\s*[-–]\s*Taille\s+\S+$/i, '').trim() || draft.title;
    await recordPurchase({
      date: todayISO(), source: 'Annonce IA', commonFees: 0, lotPrice: null,
      lines: [{ name, category: draft.category, price: c ?? 0, targetPrice: target, status: 'en_vente', brand: draft.brand ?? '', size: draft.size ?? '', color: draft.color ?? '', condition: draft.condition ?? '', costPending: c === null }],
    }).then(async ({ itemIds }) => {
      const { updateItem } = await import('../lib/actions');
      await updateItem(itemIds[0], { listingRef: draft.title, description: draft.description });
    });
    ui.toast('Ajouté à tes articles en vente : la vente s’y rattachera toute seule');
    setDraft(null); setPhotos([]); setNotes(''); setCost(''); setPrice('');
  });

  if (!s.anthropicKey) {
    return (
      <>
        <PageHeader title="Annonce IA" sub="Titre, description et prix conseillé à partir de tes photos" backTo="" />
        <div className="card">
          <b>Clé API Claude</b>
          <ol className="small muted" style={{ paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>Va sur <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>console.anthropic.com</a>, crée un compte et ajoute quelques euros de crédit (une annonce coûte environ 1 à 3 centimes).</li>
            <li>Crée une clé (« Create Key ») et colle-la ici.</li>
          </ol>
          <p className="tiny faint">La clé reste sur ton téléphone (et dans tes sauvegardes Drive). Tes photos sont envoyées à Claude uniquement quand tu appuies sur « Rédiger l'annonce ».</p>
          <Field label="Clé API"><input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={!key.trim().startsWith('sk-')} onClick={() => run(async () => { await saveSettings({ anthropicKey: key.trim() }); ui.toast('Clé enregistrée'); })}>Enregistrer la clé</button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Annonce IA" sub="Titre, description et prix conseillé à partir de tes photos" backTo="" />
      <ErrorBox error={error} />
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }} onClick={() => go('photos')}>📸 Prompts pour des photos réalistes</button>

      <div className="card">
        <b>1. Photos</b> <span className="small muted">({photos.length}/5 — face, dos, étiquette, défauts)</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
          {photos.map((p, i) => (
            <button key={i} onClick={() => setPhotos(photos.filter((_, k) => k !== i))} aria-label="Retirer la photo" style={{ padding: 0, border: 0, background: 'none', position: 'relative' }}>
              <img src={p.url} alt="" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 12 }} />
              <span style={{ position: 'absolute', top: 2, right: 6, color: '#fff', fontWeight: 900, textShadow: '0 0 4px #000' }}>×</span>
            </button>
          ))}
          {photos.length < 5 && (
            <label className="btn btn-ghost" style={{ width: 70, height: 70, display: 'grid', placeItems: 'center', fontSize: 28 }}>
              +<input type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </div>
        <Field label="2. Ce que tu sais (facultatif)" hint="Marque, taille, matière, défaut… L'IA n'invente rien : sans info, elle laisse vide.">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex. Lacoste, taille L, petite tache manche gauche" />
        </Field>
        <Field label="Prix d'achat (facultatif)" hint="Sert au prix minimum rentable."><MoneyInput value={cost} onChange={setCost} /></Field>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || photos.length === 0} onClick={generate}>{busy ? 'Rédaction…' : draft ? 'Refaire une proposition' : "✨ Rédiger l'annonce"}</button>
      </div>

      {draft && (
        <>
          <h2>Ton annonce</h2>
          <div className="card">
            <CopyField label="Titre" value={draft.title} onChange={set('title')} />
            <CopyField label="Description" multiline value={[draft.description, draft.hashtags.join(' ')].filter(Boolean).join('\n\n')} onChange={(v) => setDraft({ ...draft, description: v, hashtags: [] })} />
            <div className="cols">
              <CopyField label="Marque" value={draft.brand ?? ''} onChange={(v) => set('brand')(v || null)} />
              <CopyField label="Taille" value={draft.size ?? ''} onChange={(v) => set('size')(v || null)} />
            </div>
            <div className="cols">
              <Field label="État">
                <select className="input" value={draft.condition ?? ''} onChange={(e) => set('condition')((e.target.value || null) as ListingDraft['condition'])}>
                  <option value="">—</option>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Catégorie">
                <select className="input" value={draft.category} onChange={(e) => set('category')(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
            </div>
            {draft.defects.length > 0 && <p className="small warn" style={{ marginTop: 0 }}>Défauts repérés : {draft.defects.join(', ')} — mentionnés pour éviter les litiges.</p>}
          </div>

          <h2>Prix</h2>
          <div className="card">
            {advice && advice.count > 0 ? (
              <p className="small" style={{ marginTop: 0 }}>
                Tes {advice.count} ventes comparables ({advice.basis}) : <b>{formatEuros(advice.median!)}</b> en médiane, entre {formatEuros(advice.low!)} et {formatEuros(advice.high!)}.
              </p>
            ) : (
              <p className="small muted" style={{ marginTop: 0 }}>Pas encore assez de ventes comparables dans ton historique (il en faut 3) : regarde les prix des articles similaires sur Vinted.</p>
            )}
            {advice?.minimum != null && <p className="small" style={{ marginTop: 0 }}>Prix minimum rentable : <b>{formatEuros(advice.minimum)}</b>{s.minProfitPerItem ? ` (ton coût + ${formatEuros(s.minProfitPerItem)} de bénéfice)` : ' (ton coût)'}.</p>}
            <Field label="Prix affiché sur Vinted"><MoneyInput value={price} onChange={setPrice} /></Field>
            {advice?.minimum != null && price.trim() && (parseEuros(price) ?? 0) < advice.minimum && <p className="small neg" style={{ marginTop: -4 }}>En dessous de ton prix minimum rentable.</p>}
          </div>

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={addToStock}>Ajouter à mes articles en vente</button>
          <p className="tiny faint">Une fois publié sur Vinted, la vente de cet article se rattachera toute seule (prix d'achat et délai de vente exacts).</p>
        </>
      )}
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={async () => { if (await ui.confirm({ title: 'Changer de clé API ?', text: 'La clé actuelle sera retirée de l’appli.', confirmLabel: 'Retirer la clé' })) await saveSettings({ anthropicKey: '' }); }}>Changer de clé API</button>
    </>
  );
}
