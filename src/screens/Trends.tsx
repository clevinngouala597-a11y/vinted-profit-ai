import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../lib/db';
import { isAdmin } from '../lib/betaAccess';
import { isStatsAdmin, unlockAdmin } from '../lib/presence';
import { compressImage } from '../lib/images';
import { centsToInput, formatEuros, parseEuros } from '../lib/money';
import { formatDate } from '../lib/period';
import { filterTrends, parseTrend, publishTrend, removeTrend, sortTrends, syncTrends, type TrendSort } from '../lib/trends';
import type { Trend } from '../lib/types';
import { IHeart, IPlus } from '../ui/icons';
import { Empty, ErrorBox, Field, MoneyInput, PageHeader, Sheet, useAction, usePhotoUrl, useUI } from '../ui/kit';

/** Tendances (bêta) : les articles les plus likés, ajoutés par l'admin et visibles par tous les testeurs. */
export function Trends() {
  const list = useLiveQuery(() => getDb().trends.toArray(), []) ?? null;
  const [sort, setSort] = useState<TrendSort>('likes');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Trend | 'new' | null>(null);
  const [admin, setAdmin] = useState(() => isStatsAdmin());
  const [loading, setLoading] = useState(true);
  const [netError, setNetError] = useState<string | null>(null);
  const rows = useMemo(() => (list ? sortTrends(filterTrends(list, q), sort) : []), [list, q, sort]);
  const refresh = () => {
    setLoading(true);
    syncTrends().then(() => setNetError(null), (e) => setNetError(e instanceof Error ? e.message : 'Tendances indisponibles.')).finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  return (
    <>
      <PageHeader
        title="Tendances"
        sub="Les articles les plus likés que tu repères"
        backTo=""
        right={admin ? <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><IPlus width={16} height={16} /> Ajouter</button> : undefined}
      />
      {netError && <p className="tiny faint" style={{ marginTop: 0 }}>{netError}</p>}
      {!admin && isAdmin() && <AdminUnlock onOk={() => setAdmin(true)} />}
      {list && list.length === 0 ? (
        loading ? <p className="muted small">Chargement des tendances…</p> : (
        <Empty
          title="Aucune tendance pour l’instant"
          text={admin ? 'Ajoute un article repéré : une photo et sa description (colle le message du canal Telegram : la marque, la taille, le prix et les likes se remplissent tout seuls).' : 'Les articles les plus likés du moment apparaîtront ici dès qu’ils seront ajoutés.'}
          action={admin ? <button className="btn btn-primary" onClick={() => setEdit('new')}>Ajouter un article</button> : <button className="btn btn-ghost" onClick={refresh}>Actualiser</button>}
        />)
      ) : (
        <>
          <input className="input" placeholder="Rechercher (marque, taille, mot…)" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
          <div className="seg" style={{ marginBottom: 12 }}>
            {([['likes', 'Plus likés'], ['recent', 'Récents'], ['price', 'Prix']] as const).map(([k, l]) => (
              <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>
            ))}
          </div>
          {rows.length === 0 && list && <p className="muted small">Aucun article ne correspond à « {q} ».</p>}
          <div className="trend-grid">
            {rows.map((t) => <TrendCard key={t.id} t={t} onOpen={() => setEdit(t)} />)}
          </div>
        </>
      )}
      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Nouvel article repéré' : admin ? 'Modifier l’article' : 'Article repéré'}>
        {edit !== null && (admin
          ? <TrendForm key={edit === 'new' ? 'new' : edit.id} trend={edit === 'new' ? null : edit} onDone={() => setEdit(null)} />
          : edit !== 'new' && <TrendView t={edit} />)}
      </Sheet>
    </>
  );
}

function TrendCard({ t, onOpen }: { t: Trend; onOpen: () => void }) {
  const url = usePhotoUrl(t.photoId ?? undefined);
  const meta = [t.brand, t.size && `Taille ${t.size}`].filter(Boolean).join(' · ');
  return (
    <button className="trend-card" onClick={onOpen}>
      <div className="trend-photo">
        {url ? <img src={url} alt="" /> : <span className="faint small">Pas de photo</span>}
        {t.likes !== null && <span className="trend-likes"><IHeart width={13} height={13} /> {t.likes}</span>}
      </div>
      <div className="trend-body">
        <div className="trend-title">{t.title}</div>
        {meta && <div className="tiny muted">{meta}</div>}
        {t.price !== null && <div className="trend-price">{formatEuros(t.price)}</div>}
      </div>
    </button>
  );
}

function TrendForm({ trend, onDone }: { trend: Trend | null; onDone: () => void }) {
  const ui = useUI();
  const { error, run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string>();
  const saved = usePhotoUrl(trend?.photoId ?? undefined);
  const [text, setText] = useState(trend?.text ?? '');
  const [f, setF] = useState(() => ({
    title: trend?.title ?? '',
    brand: trend?.brand ?? '',
    size: trend?.size ?? '',
    condition: trend?.condition ?? '',
    price: trend?.price != null ? centsToInput(trend.price) : '',
    likes: trend?.likes != null ? String(trend.likes) : '',
    seller: trend?.seller ?? '',
    url: trend?.url ?? '',
    note: trend?.note ?? '',
  }));
  const set = (k: keyof typeof f) => (v: string) => setF((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    if (!blob) return setPreview(undefined);
    const u = URL.createObjectURL(blob);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  /** Description collée : les champs encore vides sont remplis avec ce que le texte contient. */
  const onText = (v: string) => {
    setText(v);
    const p = parseTrend(v);
    setF((o) => ({
      ...o,
      title: o.title || p.title,
      brand: o.brand || p.brand,
      size: o.size || p.size,
      condition: o.condition || p.condition,
      price: o.price || (p.price !== null ? centsToInput(p.price) : ''),
      likes: o.likes || (p.likes !== null ? String(p.likes) : ''),
      seller: o.seller || p.seller,
      url: o.url || p.url,
    }));
  };

  const onFile = (files: FileList | null) =>
    run(async () => {
      if (!files?.[0]) return;
      setBlob(await compressImage(files[0]));
      if (fileRef.current) fileRef.current.value = '';
    });

  const save = () =>
    run(async () => {
      const likes = f.likes.trim() === '' ? null : Number(f.likes.replace(/\D/g, ''));
      const price = f.price.trim() === '' ? null : parseEuros(f.price);
      if (f.price.trim() && price === null) throw new Error('Prix illisible.');
      await publishTrend({ id: trend?.id, text, note: f.note, title: f.title, brand: f.brand, size: f.size, condition: f.condition, price, likes, seller: f.seller, url: f.url }, blob, !!trend?.photoId);
      ui.toast(trend ? 'Article mis à jour pour tous les testeurs' : 'Article publié pour tous les testeurs');
      onDone();
    });

  const remove = () =>
    run(async () => {
      if (!trend) return;
      const ok = await ui.confirm({ title: 'Retirer cet article ?', text: 'Il disparaît des tendances de tous les testeurs (photo comprise).', confirmLabel: 'Retirer', danger: true });
      if (!ok) return;
      await removeTrend(trend.id);
      ui.toast('Article supprimé');
      onDone();
    });

  const shown = preview ?? saved;
  return (
    <div>
      <ErrorBox error={error} />
      <button className="trend-pick" onClick={() => fileRef.current?.click()} disabled={busy}>
        {shown ? <img src={shown} alt="" /> : <span>📷 Ajouter une photo</span>}
      </button>
      {shown && <button className="link small" style={{ marginBottom: 8 }} onClick={() => fileRef.current?.click()}>Changer la photo</button>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files)} />

      <Field label="Description" hint="Colle le message Telegram ou l'annonce : les champs ci-dessous se remplissent tout seuls.">
        <textarea className="input" value={text} onChange={(e) => onText(e.target.value)} style={{ minHeight: 110 }} placeholder="JEANS LOW RISE, MARQUE: …, TAILLE: L, 24,90 € · 120 ❤️" />
      </Field>
      <Field label="Titre"><input className="input" value={f.title} onChange={(e) => set('title')(e.target.value)} /></Field>
      <div className="grid2">
        <Field label="Marque"><input className="input" value={f.brand} onChange={(e) => set('brand')(e.target.value)} /></Field>
        <Field label="Taille"><input className="input" value={f.size} onChange={(e) => set('size')(e.target.value)} /></Field>
      </div>
      <div className="grid2">
        <Field label="Prix"><MoneyInput value={f.price} onChange={set('price')} /></Field>
        <Field label="Likes"><input className="input" inputMode="numeric" value={f.likes} onChange={(e) => set('likes')(e.target.value.replace(/\D/g, ''))} placeholder="0" /></Field>
      </div>
      <div className="grid2">
        <Field label="État"><input className="input" value={f.condition} onChange={(e) => set('condition')(e.target.value)} /></Field>
        <Field label="Vendeur"><input className="input" value={f.seller} onChange={(e) => set('seller')(e.target.value)} autoCapitalize="off" /></Field>
      </div>
      <Field label="Lien de l'annonce (facultatif)"><input className="input" value={f.url} onChange={(e) => set('url')(e.target.value)} placeholder="https://www.vinted.fr/items/…" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" /></Field>
      <Field label="Note (facultatif)"><input className="input" value={f.note} onChange={(e) => set('note')(e.target.value)} placeholder="À chercher en friperie, prix de revente visé…" /></Field>
      {trend && <p className="tiny faint">Ajouté le {formatDate(trend.addedAt.slice(0, 10))}</p>}
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Envoi…' : trend ? 'Enregistrer' : 'Publier dans les tendances'}</button>
        {f.url && /^https?:\/\//i.test(f.url) && <a className="btn btn-ghost" href={f.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', textAlign: 'center' }}>Voir l'annonce sur Vinted</a>}
        {trend && <button className="btn btn-ghost" disabled={busy} onClick={remove} style={{ color: 'var(--loss)' }}>Retirer des tendances</button>}
      </div>
    </div>
  );
}

/** Fiche en lecture seule (testeurs). */
function TrendView({ t }: { t: Trend }) {
  const url = usePhotoUrl(t.photoId ?? undefined);
  const rows: [string, string][] = [
    ['Marque', t.brand], ['Taille', t.size], ['État', t.condition],
    ['Prix', t.price !== null ? formatEuros(t.price) : ''], ['Likes', t.likes !== null ? String(t.likes) : ''], ['Vendeur', t.seller],
  ];
  return (
    <div>
      {url && <div className="trend-pick" style={{ borderStyle: 'solid' }}><img src={url} alt="" /></div>}
      <div style={{ fontWeight: 800, fontSize: 17, margin: '8px 0' }}>{t.title}</div>
      <div className="calc">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="calc-row"><span>{k}</span><span>{v}</span></div>)}
      </div>
      {t.note && <p className="small muted">{t.note}</p>}
      {t.url && <a className="btn btn-primary" href={t.url} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 12 }}>Voir l'annonce sur Vinted</a>}
    </div>
  );
}

/** Admin pas encore débloqué sur cet appareil : son code active l'ajout. */
function AdminUnlock({ onOk }: { onOk: () => void }) {
  const [code, setCode] = useState('');
  const { error, run, busy } = useAction();
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Ajouter des tendances</div>
      <p className="small muted" style={{ marginTop: 0 }}>Entre ton code admin pour pouvoir ajouter, modifier et retirer des articles.</p>
      <ErrorBox error={error} />
      <div className="row" style={{ display: 'flex', gap: 8 }}>
        <input className="input" type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code admin" autoCapitalize="off" autoComplete="off" />
        <button className="btn btn-primary" disabled={busy || !code} onClick={() => run(async () => { if (!(await unlockAdmin(code))) throw new Error('Code incorrect.'); onOk(); })}>OK</button>
      </div>
    </div>
  );
}
