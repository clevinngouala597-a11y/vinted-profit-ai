import { useMemo, useState } from 'react';
import { daysBetween, itemCost, stockState } from '../lib/engine';
import { formatEuros } from '../lib/money';
import { todayISO } from '../lib/period';
import { go, queryParam } from '../lib/router';
import { useData } from '../lib/useData';
import { DEFAULT_CATEGORIES, IN_STOCK, STATUS_LABEL, type Item, type ItemStatus } from '../lib/types';
import { ISearch } from '../ui/icons';
import { Empty, InfoButton, PageHeader, Thumb } from '../ui/kit';

type Filter = 'stock' | 'a_preparer' | 'en_vente' | 'non_publies' | 'anciens' | 'sansprix' | 'vendus' | 'sortis' | 'tous';
const FILTERS: [Filter, string][] = [
  ['stock', 'En stock'],
  ['en_vente', 'En vente'],
  ['non_publies', 'Non publiés'],
  ['a_preparer', 'À préparer'],
  ['anciens', 'Anciens'],
  ['sansprix', 'Sans prix'],
  ['vendus', 'Vendus'],
  ['sortis', 'Perdus / retirés'],
  ['tous', 'Tous'],
];
type Sort = 'recent' | 'ancien' | 'rentable' | 'valeur' | 'duree';

export const statusBadge = (s: ItemStatus) =>
  ['vendu', 'expedie', 'termine'].includes(s) ? 'green' : ['perdu', 'retire', 'rembourse'].includes(s) ? 'red' : ['a_preparer', 'retourne', 'reserve'].includes(s) ? 'warn' : '';

export function Stock() {
  const ds = useData();
  const today = todayISO();
  const initial = (queryParam('filtre') as Filter) || 'stock';
  const [filter, setFilter] = useState<Filter>(FILTERS.some(([f]) => f === initial) ? initial : 'stock');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState<Sort>(initial === 'anciens' ? 'duree' : 'recent');
  const st = stockState(ds, today);
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...ds.settings.customCategories, ...ds.items.map((i) => i.category)])];

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const age = (i: Item) => daysBetween(i.purchaseDate, today);
    const potential = (i: Item) => (i.targetPrice === null ? -Infinity : i.targetPrice - itemCost(i));
    return ds.items
      .filter((i) => {
        const inStock = IN_STOCK.includes(i.status);
        switch (filter) {
          case 'stock': return inStock;
          case 'a_preparer': return i.status === 'a_preparer';
          case 'en_vente': return i.status === 'en_vente' || i.status === 'reserve';
          case 'non_publies': return ['achete', 'a_preparer', 'pret', 'retourne'].includes(i.status);
          case 'anciens': return inStock && age(i) >= ds.settings.staleDays;
          case 'sansprix': return inStock && i.targetPrice === null;
          case 'vendus': return ['vendu', 'expedie', 'termine'].includes(i.status);
          case 'sortis': return ['perdu', 'retire', 'rembourse'].includes(i.status);
          default: return true;
        }
      })
      .filter((i) => !cat || i.category === cat)
      .filter((i) => !qq || [i.name, i.brand, i.size, i.color, i.category, i.notes].join(' ').toLowerCase().includes(qq))
      .sort((a, b) => {
        switch (sort) {
          case 'ancien': return a.purchaseDate.localeCompare(b.purchaseDate);
          case 'rentable': return potential(b) - potential(a);
          case 'valeur': return itemCost(b) - itemCost(a);
          case 'duree': return age(b) - age(a);
          default: return b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt);
        }
      });
  }, [ds, filter, q, cat, sort, today]);

  return (
    <>
      <PageHeader
        title="Stock"
        sub={`${st.count} article${st.count > 1 ? 's' : ''} · ${formatEuros(st.costValue)} immobilisés`}
        right={<button className="btn btn-primary btn-sm" onClick={() => go('achat')}>Ajouter</button>}
      />

      <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: 14 }}>
        <Stat label="Coût du stock" value={formatEuros(st.costValue)} k="stockValue" />
        <Stat label="Prix prévus" value={formatEuros(st.plannedValue)} />
        <Stat label="Potentiel" value={formatEuros(st.potentialProfit)} note="estimé, non réalisé" />
      </div>
      <div className="small muted" style={{ margin: '8px 2px 14px' }}>
        Âge moyen : {st.avgAgeDays === null ? '—' : `${st.avgAgeDays} j`} · {st.unpublished} non publié{st.unpublished > 1 ? 's' : ''}
        {st.missingTarget > 0 && ` · ${st.missingTarget} sans prix souhaité`}
      </div>

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <ISearch style={{ position: 'absolute', left: 13, top: 14, color: 'var(--faint)' }} />
        <input className="input" style={{ paddingLeft: 38 }} placeholder="Nom, marque, taille…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un article" type="search" />
      </div>
      <div className="chips" role="group" aria-label="Filtrer par statut">
        {FILTERS.map(([f, l]) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{l}</button>
        ))}
      </div>
      <div className="cols" style={{ marginTop: 10 }}>
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Trier">
          <option value="recent">Plus récents</option>
          <option value="ancien">Plus anciens</option>
          <option value="rentable">Plus rentables</option>
          <option value="valeur">Valeur du stock</option>
          <option value="duree">Durée en stock</option>
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        {list.length === 0 ? (
          ds.items.length === 0 ? (
            <Empty title="Ton stock est vide" text="Enregistre un achat pour créer tes premiers articles. Tu pourras ensuite les publier et les vendre." action={<button className="btn btn-primary" onClick={() => go('achat')}>Enregistrer un achat</button>} />
          ) : (
            <Empty title="Aucun article ne correspond" text="Change de filtre ou efface la recherche." action={<button className="btn btn-ghost" onClick={() => { setFilter('tous'); setQ(''); setCat(''); }}>Tout afficher</button>} />
          )
        ) : (
          <div className="list">
            {list.map((i) => {
              const cost = itemCost(i);
              const pot = i.targetPrice === null ? null : i.targetPrice - cost;
              const age = daysBetween(i.purchaseDate, today);
              return (
                <button key={i.id} className="li" onClick={() => go(`stock/${i.id}`)}>
                  <Thumb photoId={i.photoIds[0]} name={i.name} />
                  <span className="li-main">
                    <div className="li-title">{i.name}</div>
                    <div className="li-sub">{[i.brand, i.size, `${age} j`].filter(Boolean).join(' · ')}</div>
                    <span className={`badge ${statusBadge(i.status)}`} style={{ marginTop: 4 }}>{STATUS_LABEL[i.status]}</span>
                  </span>
                  <span className="li-end">
                    <div className="li-amount">{formatEuros(cost)}</div>
                    <div className={`tiny ${pot === null ? 'faint' : pot < 0 ? 'neg' : 'pos'}`}>
                      {pot === null ? 'prix à fixer' : `${pot >= 0 ? '+' : ''}${formatEuros(pot)} prévu`}
                    </div>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, note, k }: { label: string; value: string; note?: string; k?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="tiny muted" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{label}{k && <InfoButton k={k} />}</div>
      <div style={{ fontWeight: 800, fontSize: 16 }}>{value}</div>
      {note && <div className="tiny faint">{note}</div>}
    </div>
  );
}
