import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import {
  addItemPhotos,
  changeItemStatus,
  correctItemCost,
  removeItemPhoto,
  setMainPhoto,
  updateItem,
} from '../lib/actions';
import { getDb } from '../lib/db';
import { humanAction, humanDetails } from '../lib/journal';
import { daysBetween, estimate, itemCost, saleBreakdown } from '../lib/engine';
import { compressImage } from '../lib/images';
import { centsToInput, formatEuros, formatPercent } from '../lib/money';
import { formatDate, todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { DEFAULT_CATEGORIES, MANUAL_TRANSITIONS, SELLABLE, STATUS_LABEL, type ItemStatus } from '../lib/types';
import { centsOrNull, cents, Empty, ErrorBox, Field, InfoButton, MoneyInput, PageHeader, Sheet, useAction, usePhotoUrl, useUI } from '../ui/kit';
import { statusBadge } from './Stock';

export const CONDITIONS = ['Neuf avec étiquette', 'Neuf sans étiquette', 'Très bon état', 'Bon état', 'Satisfaisant'];

export function ItemDetail({ id }: { id: string }) {
  const ds = useData();
  const ui = useUI();
  const item = ds.items.find((i) => i.id === id);
  const [edit, setEdit] = useState(false);
  const [fix, setFix] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { error, run, busy } = useAction();
  const history = useLiveQuery(() => getDb().auditLogs.where('entityId').equals(id).reverse().sortBy('at'), [id]);

  if (!item) return (<><PageHeader title="Article" backTo="stock" /><Empty title="Article introuvable" text="Il a peut-être été supprimé lors d'une restauration." action={<button className="btn btn-ghost" onClick={() => go('stock')}>Retour au stock</button>} /></>);

  const cost = itemCost(item);
  const today = todayISO();
  const line = ds.saleLines.find((l) => l.itemId === id && ds.sales.find((s) => s.id === l.saleId)?.orderStatus !== 'annulee');
  const sale = line ? ds.sales.find((s) => s.id === line.saleId) : undefined;
  const sb = sale ? saleBreakdown(ds, sale) : undefined;
  const est = item.targetPrice !== null ? estimate({ purchasePrice: item.purchasePrice, directFees: item.directFees, sellerRevenue: item.targetPrice, sellerCosts: 0 }) : null;
  const purchase = item.purchaseId ? ds.purchases.find((p) => p.id === item.purchaseId) : undefined;
  const transitions = MANUAL_TRANSITIONS[item.status] ?? [];

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    await run(async () => {
      const blobs = [];
      for (const f of Array.from(files)) blobs.push(await compressImage(f));
      await addItemPhotos(id, blobs);
      ui.toast(blobs.length > 1 ? `${blobs.length} photos ajoutées` : 'Photo ajoutée');
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const setStatus = async (to: ItemStatus) => {
    if (to === 'perdu' || to === 'retire') {
      const ok = await ui.confirm({
        title: to === 'perdu' ? 'Marquer comme perdu ?' : 'Retirer définitivement du stock ?',
        text: `L'article sort du stock et son coût (${formatEuros(cost)}) est compté comme une perte dans ton résultat.`,
        confirmLabel: to === 'perdu' ? 'Marquer perdu' : 'Retirer du stock',
        danger: true,
      });
      if (!ok) return;
    }
    const ok = await run(async () => { await changeItemStatus(id, to); return true; });
    if (ok) ui.toast(`Statut : ${STATUS_LABEL[to]}`);
  };

  return (
    <>
      <PageHeader title={item.name} sub={[item.brand, item.size, item.category].filter(Boolean).join(' · ')} backTo="stock" />
      <span className={`badge ${statusBadge(item.status)}`}>{STATUS_LABEL[item.status]}</span>
      <span className="small muted" style={{ marginLeft: 8 }}>
        {SELLABLE.includes(item.status) ? `${daysBetween(item.purchaseDate, today)} jours en stock` : item.soldAt ? `vendu le ${formatDate(item.soldAt)}` : ''}
      </span>
      <ErrorBox error={error} />

      <h2>Photos</h2>
      <div className="gallery">
        {item.photoIds.map((pid, k) => <PhotoCell key={pid} id={pid} main={k === 0} onOpen={() => setView(pid)} />)}
        <button className="add-photo" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? 'Compression…' : '+ Ajouter des photos'}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />

      <h2>Coûts et rentabilité</h2>
      <div className="calc">
        <div className="calc-row"><span>Prix d'achat attribué</span><span>{formatEuros(item.purchasePrice)}</span></div>
        <div className="calc-row"><span>Frais d'achat attribués</span><span>{formatEuros(item.directFees)}</span></div>
        <div className="calc-row total"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Coût de revient <InfoButton k="cost" /></span><span>{formatEuros(cost)}</span></div>
        {sb && line ? (
          <>
            <div className="calc-row"><span>Revenu attribué à cet article</span><span>{formatEuros(line.revenue)}</span></div>
            <div className="calc-row"><span>Coûts de vente attribués</span><span>− {formatEuros(line.costs)}</span></div>
            <div className="calc-row total"><span>Bénéfice sur cet article</span><span className={line.revenue - line.cogs - line.costs < 0 ? 'neg' : 'pos'}>{formatEuros(line.revenue - line.cogs - line.costs, { signed: true })}</span></div>
          </>
        ) : (
          <>
            <div className="calc-row"><span>Prix de vente souhaité</span><span>{item.targetPrice === null ? 'à fixer' : formatEuros(item.targetPrice)}</span></div>
            {item.minPrice !== null && <div className="calc-row"><span>Prix minimum accepté</span><span>{formatEuros(item.minPrice)}</span></div>}
            {est && (
              <div className="calc-row total">
                <span>Bénéfice prévisionnel</span>
                <span className={est.isLoss ? 'neg' : 'pos'}>{formatEuros(est.profit, { signed: true })} <span className="tiny muted">· ROI {formatPercent(est.roi)}</span></span>
              </div>
            )}
          </>
        )}
      </div>
      {est && !sb && ds.settings.minProfitPerItem > 0 && est.profit < ds.settings.minProfitPerItem && (
        <div className="alert warn" style={{ marginTop: 10 }}>
          Sous ton objectif de {formatEuros(ds.settings.minProfitPerItem)} par article : il faudrait encaisser au moins {formatEuros(cost + ds.settings.minProfitPerItem)}.
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 14 }}>
        {SELLABLE.includes(item.status) && <button className="btn btn-primary" onClick={() => go(`vente?item=${id}`)}>Enregistrer la vente</button>}
        {sale && <button className="btn btn-ghost" onClick={() => go(`ventes/${sale.id}`)}>Voir la vente</button>}
      </div>

      {transitions.length > 0 && (
        <>
          <h2>Changer le statut</h2>
          <div className="chips" style={{ flexWrap: 'wrap', margin: 0, padding: 0 }}>
            {transitions.map((t) => (
              <button key={t} className="chip" onClick={() => setStatus(t)} disabled={busy} style={t === 'perdu' || t === 'retire' ? { color: 'var(--loss)' } : undefined}>
                {STATUS_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="tiny faint">« Vendu », « Expédié » et « Terminé » se mettent à jour depuis la vente.</p>
        </>
      )}

      <h2>Détails</h2>
      <dl className="card kv">
        <dt>Acheté le</dt><dd>{formatDate(item.purchaseDate)}</dd>
        {purchase && <><dt>Source</dt><dd>{purchase.source || '—'}</dd></>}
        <dt>Couleur</dt><dd>{item.color || '—'}</dd>
        <dt>État</dt><dd>{item.condition || '—'}</dd>
        <dt>Publié le</dt><dd>{formatDate(item.listedAt)}</dd>
        <dt>Réf. annonce</dt><dd>{item.listingRef || '—'}</dd>
        {item.description && <><dt>Description</dt><dd style={{ textAlign: 'left', whiteSpace: 'pre-wrap', fontWeight: 400 }}>{item.description}</dd></>}
        {item.notes && <><dt>Notes</dt><dd style={{ textAlign: 'left', whiteSpace: 'pre-wrap', fontWeight: 400 }}>{item.notes}</dd></>}
      </dl>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>Modifier les informations</button>
        {SELLABLE.includes(item.status) && <button className="btn btn-ghost btn-sm" onClick={() => setFix(true)}>Corriger le coût</button>}
      </div>

      {history && history.length > 0 && (
        <>
          <h2>Historique</h2>
          <div className="list">
            {history.slice(0, 12).map((h) => (
              <div className="li" key={h.id}>
                <span className="li-main"><div className="li-title" style={{ fontWeight: 600, fontSize: 14 }}>{humanAction(h.action)}</div><div className="li-sub" style={{ whiteSpace: 'normal' }}>{humanDetails(h.details)}</div></span>
                <span className="tiny faint">{new Date(h.at).toLocaleDateString('fr-FR')}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {edit && <EditSheet id={id} onClose={() => setEdit(false)} />}
      {fix && <FixCostSheet id={id} onClose={() => setFix(false)} />}
      <PhotoViewer id={view} onClose={() => setView(null)} itemId={id} isMain={view === item.photoIds[0]} />
    </>
  );
}

function PhotoCell({ id, main, onOpen }: { id: string; main: boolean; onOpen: () => void }) {
  const url = usePhotoUrl(id);
  return (
    <button className="ph" onClick={onOpen} aria-label={main ? 'Photo principale' : 'Voir la photo'}>
      {url && <img src={url} alt="" />}
      {main && <span className="badge green main-tag">Principale</span>}
    </button>
  );
}

function PhotoViewer({ id, onClose, itemId, isMain }: { id: string | null; onClose: () => void; itemId: string; isMain: boolean }) {
  const url = usePhotoUrl(id ?? undefined);
  const ui = useUI();
  return (
    <Sheet open={!!id} onClose={onClose} title="Photo">
      {url && <img className="photo-view" src={url} alt="" />}
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {!isMain && <button className="btn btn-ghost" onClick={async () => { await setMainPhoto(itemId, id!); ui.toast('Photo principale modifiée'); onClose(); }}>Définir comme photo principale</button>}
        <button className="btn btn-danger" onClick={async () => {
          if (await ui.confirm({ title: 'Supprimer cette photo ?', text: 'Elle sera effacée de l’appareil.', confirmLabel: 'Supprimer la photo', danger: true })) {
            await removeItemPhoto(itemId, id!);
            ui.toast('Photo supprimée');
            onClose();
          }
        }}>Supprimer la photo</button>
      </div>
    </Sheet>
  );
}

function EditSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const ds = useData();
  const ui = useUI();
  const it = ds.items.find((i) => i.id === id)!;
  const [f, setF] = useState({
    name: it.name, category: it.category, brand: it.brand, size: it.size, color: it.color, condition: it.condition,
    description: it.description, notes: it.notes, listingRef: it.listingRef,
    targetPrice: centsToInput(it.targetPrice), minPrice: centsToInput(it.minPrice),
  });
  const { error, run, busy } = useAction();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...ds.settings.customCategories, it.category])];
  const save = async () => {
    const ok = await run(async () => {
      await updateItem(id, { ...f, targetPrice: centsOrNull(f.targetPrice), minPrice: centsOrNull(f.minPrice) });
      return true;
    });
    if (ok) { ui.toast('Article enregistré'); onClose(); }
  };
  return (
    <Sheet open onClose={onClose} title="Modifier l'article">
      <ErrorBox error={error} />
      <Field label="Nom"><input className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} /></Field>
      <div className="cols">
        <Field label="Catégorie"><select className="input" value={f.category} onChange={(e) => set('category')(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Marque"><input className="input" value={f.brand} onChange={(e) => set('brand')(e.target.value)} /></Field>
        <Field label="Taille"><input className="input" value={f.size} onChange={(e) => set('size')(e.target.value)} /></Field>
        <Field label="Couleur"><input className="input" value={f.color} onChange={(e) => set('color')(e.target.value)} /></Field>
      </div>
      <Field label="État">
        <select className="input" value={f.condition} onChange={(e) => set('condition')(e.target.value)}>
          <option value="">Non renseigné</option>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <div className="cols">
        <Field label="Prix souhaité"><MoneyInput value={f.targetPrice} onChange={set('targetPrice')} /></Field>
        <Field label="Prix minimum"><MoneyInput value={f.minPrice} onChange={set('minPrice')} /></Field>
      </div>
      <Field label="Description"><textarea className="input" value={f.description} onChange={(e) => set('description')(e.target.value)} /></Field>
      <Field label="Référence de l'annonce" hint="Lien ou numéro de l'annonce Vinted, si tu veux le garder."><input className="input" value={f.listingRef} onChange={(e) => set('listingRef')(e.target.value)} /></Field>
      <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => set('notes')(e.target.value)} /></Field>
      <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
    </Sheet>
  );
}

function FixCostSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const ds = useData();
  const ui = useUI();
  const it = ds.items.find((i) => i.id === id)!;
  const [price, setPrice] = useState(centsToInput(it.purchasePrice));
  const [fees, setFees] = useState(centsToInput(it.directFees));
  const [reason, setReason] = useState('');
  const { error, run, busy } = useAction();
  const diff = cents(price) + cents(fees) - itemCost(it);
  return (
    <Sheet open onClose={onClose} title="Corriger le coût">
      <p className="muted small" style={{ marginTop: 0 }}>La correction est tracée dans l'historique et un ajustement de trésorerie est enregistré.</p>
      <ErrorBox error={error} />
      <div className="cols">
        <Field label="Prix d'achat"><MoneyInput value={price} onChange={setPrice} /></Field>
        <Field label="Frais"><MoneyInput value={fees} onChange={setFees} /></Field>
      </div>
      <Field label="Raison de la correction"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Erreur de saisie, ticket retrouvé…" /></Field>
      {diff !== 0 && <div className="alert warn">Écart : {formatEuros(diff, { signed: true })} sur le coût et la trésorerie.</div>}
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        const ok = await run(async () => { await correctItemCost(id, cents(price), cents(fees), reason); return true; });
        if (ok) { ui.toast('Coût corrigé'); onClose(); }
      }}>Corriger le coût</button>
    </Sheet>
  );
}
