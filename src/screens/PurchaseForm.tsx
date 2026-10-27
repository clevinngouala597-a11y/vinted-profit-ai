import { useEffect, useState } from 'react';
import { recordPurchase, savePhoto } from '../lib/actions';
import { splitPurchase } from '../lib/engine';
import { compressImage } from '../lib/images';
import { formatEuros, parseEuros } from '../lib/money';
import { todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { DEFAULT_CATEGORIES, type ItemStatus } from '../lib/types';
import { IClose } from '../ui/icons';
import { cents, centsOrNull, ErrorBox, Field, MoneyInput, PageHeader, useAction, useUI } from '../ui/kit';
import { CONDITIONS } from './ItemDetail';

interface Line {
  key: number;
  name: string;
  category: string;
  brand: string;
  size: string;
  condition: string;
  price: string;
  target: string;
  status: ItemStatus;
  photos: Blob[];
}

let k = 0;
const newLine = (category = DEFAULT_CATEGORIES[1]): Line => ({
  key: ++k, name: '', category, brand: '', size: '', condition: '', price: '', target: '', status: 'achete', photos: [],
});

export function PurchaseForm() {
  const ds = useData();
  const ui = useUI();
  const [date, setDate] = useState(todayISO());
  const [source, setSource] = useState('');
  const [payment, setPayment] = useState('');
  const [mode, setMode] = useState<'unit' | 'lot'>('unit');
  const [lotPrice, setLotPrice] = useState('');
  const [fees, setFees] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const { error, run, busy } = useAction();
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...ds.settings.customCategories])];
  const sources = [...new Set(ds.purchases.map((p) => p.source).filter(Boolean))].slice(0, 8);

  const split = splitPurchase(
    lines.map((l) => ({ price: centsOrNull(l.price), targetPrice: centsOrNull(l.target) })),
    cents(fees),
    mode === 'lot' ? cents(lotPrice) : null,
  );
  const total = split.reduce((a, s) => a + s.price + s.fees, 0);
  const budget = ds.settings.maxPurchaseBudget;

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async () => {
    const res = await run(async () => {
      if (fees.trim() && parseEuros(fees) === null) throw new Error('Les frais ne sont pas un montant valide.');
      if (mode === 'lot' && parseEuros(lotPrice) === null) throw new Error('Indique le prix payé pour le lot.');
      for (const [i, l] of lines.entries()) {
        if (!l.name.trim()) throw new Error(`Article ${i + 1} : indique un nom.`);
        if (mode === 'unit' && parseEuros(l.price) === null) throw new Error(`Article ${i + 1} : indique le prix payé.`);
        if (l.target.trim() && parseEuros(l.target) === null) throw new Error(`Article ${i + 1} : le prix souhaité n'est pas valide.`);
      }
      const withPhotos = [];
      for (const l of lines) {
        const ids = [];
        for (const b of l.photos) ids.push(await savePhoto(b));
        withPhotos.push({
          name: l.name, category: l.category, brand: l.brand, size: l.size, condition: l.condition,
          price: mode === 'unit' ? parseEuros(l.price) : null, targetPrice: centsOrNull(l.target), status: l.status, photoIds: ids,
        });
      }
      return recordPurchase({
        date, source, paymentMethod: payment, commonFees: cents(fees),
        lotPrice: mode === 'lot' ? cents(lotPrice) : null, notes, lines: withPhotos,
      });
    });
    if (res) {
      ui.toast(lines.length > 1 ? `Achat enregistré : ${lines.length} articles en stock` : 'Achat enregistré');
      go(res.itemIds.length === 1 ? `stock/${res.itemIds[0]}` : 'stock');
    }
  };

  return (
    <>
      <PageHeader title="Nouvel achat" sub="Un article ou un lot acheté en une fois" backTo="" />
      <ErrorBox error={error} />

      <div className="cols">
        <Field label="Date"><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Source">
          <input className="input" list="sources" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Vinted, friperie…" />
          <datalist id="sources">{['Vinted', 'Friperie', 'Vide-grenier', 'Emmaüs', 'Leboncoin', ...sources].map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
      </div>

      <div className="seg" role="group" aria-label="Mode de prix" style={{ marginBottom: 12 }}>
        <button aria-pressed={mode === 'unit'} onClick={() => setMode('unit')}>Prix par article</button>
        <button aria-pressed={mode === 'lot'} onClick={() => setMode('lot')}>Prix global du lot</button>
      </div>

      <div className="cols">
        {mode === 'lot' && <Field label="Prix du lot"><MoneyInput value={lotPrice} onChange={setLotPrice} /></Field>}
        <Field label="Frais d'achat" hint="Livraison, protection acheteur, trajet…"><MoneyInput value={fees} onChange={setFees} /></Field>
      </div>
      {mode === 'lot' && <p className="tiny muted" style={{ marginTop: -4 }}>Le prix du lot est réparti selon le prix de vente souhaité de chaque article (à parts égales s'il manque un prix). Les frais suivent la même logique.</p>}

      <h2>Articles <span className="h2-note">{lines.length}</span></h2>
      {lines.map((l, i) => (
        <div className="line-card" key={l.key}>
          <div className="line-card-head">
            <span>Article {i + 1}</span>
            <span className="row-between" style={{ gap: 10 }}>
              <span className="small muted">coût {formatEuros(split[i].price + split[i].fees)}</span>
              {lines.length > 1 && (
                <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label={`Retirer l'article ${i + 1}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                  <IClose width={16} height={16} />
                </button>
              )}
            </span>
          </div>
          <Field label="Nom"><input className="input" value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} placeholder="Sweat Carhartt gris" /></Field>
          <div className="cols">
            <Field label="Catégorie"><select className="input" value={l.category} onChange={(e) => update(l.key, { category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Marque"><input className="input" value={l.brand} onChange={(e) => update(l.key, { brand: e.target.value })} /></Field>
            <Field label="Taille"><input className="input" value={l.size} onChange={(e) => update(l.key, { size: e.target.value })} /></Field>
            <Field label="État">
              <select className="input" value={l.condition} onChange={(e) => update(l.key, { condition: e.target.value })}>
                <option value="">—</option>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            {mode === 'unit' && <Field label="Prix payé"><MoneyInput value={l.price} onChange={(v) => update(l.key, { price: v })} /></Field>}
            <Field label="Prix souhaité" hint={mode === 'lot' ? 'Sert aussi à répartir le lot' : undefined}><MoneyInput value={l.target} onChange={(v) => update(l.key, { target: v })} /></Field>
          </div>
          <Field label="Statut de départ">
            <select className="input" value={l.status} onChange={(e) => update(l.key, { status: e.target.value as ItemStatus })}>
              <option value="achete">Acheté</option>
              <option value="a_preparer">À nettoyer ou préparer</option>
              <option value="pret">Prêt à publier</option>
              <option value="en_vente">Déjà en vente</option>
            </select>
          </Field>
          <PhotoPicker photos={l.photos} onChange={(photos) => update(l.key, { photos })} />
        </div>
      ))}
      <button className="btn btn-ghost" onClick={() => setLines([...lines, newLine(lines[lines.length - 1].category)])}>+ Ajouter un article</button>

      <Field label="Moyen de paiement (facultatif)"><input className="input" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="Carte, espèces, porte-monnaie Vinted…" /></Field>
      <Field label="Notes"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

      <div className="sticky-actions">
        {budget > 0 && total > budget && <div className="alert warn">Au-dessus de ton budget maximal par achat ({formatEuros(budget)}).</div>}
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Enregistrement…' : `Enregistrer l'achat · ${formatEuros(total)}`}
        </button>
      </div>
    </>
  );
}

function PhotoPicker({ photos, onChange }: { photos: Blob[]; onChange: (p: Blob[]) => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const u = photos.map((p) => URL.createObjectURL(p));
    setUrls(u);
    return () => u.forEach(URL.revokeObjectURL);
  }, [photos]);
  return (
    <div style={{ marginBottom: 12 }}>
      {err && <div className="alert error">{err}</div>}
      <div className="gallery" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {urls.map((u, i) => (
          <button key={u} className="ph" aria-label="Retirer cette photo" onClick={() => onChange(photos.filter((_, j) => j !== i))}>
            <img src={u} alt="" />
          </button>
        ))}
        <label className="add-photo" style={{ cursor: 'pointer' }}>
          + Photo
          <input type="file" accept="image/*" multiple hidden onChange={async (e) => {
            setErr(null);
            try {
              const out = [];
              for (const f of Array.from(e.target.files ?? [])) out.push(await compressImage(f));
              onChange([...photos, ...out]);
            } catch (x) {
              setErr(x instanceof Error ? x.message : 'Photo illisible.');
            }
            e.target.value = '';
          }} />
        </label>
      </div>
      {photos.length > 0 && <div className="tiny faint" style={{ marginTop: 4 }}>Touche une photo pour la retirer.</div>}
    </div>
  );
}
