import { setActiveShop } from '../lib/shopActions';
import { activeShop, ALL, isMulti, shopName, shopsOf } from '../lib/shops';
import { useData } from '../lib/useData';
import { Field } from './kit';

/** Choix du dressing affiché (accueil) : « Tous » = total commun. */
export function ShopSwitcher() {
  const s = useData().settings;
  if (!isMulti(s)) return null;
  const cur = activeShop(s);
  return (
    <div className="chips shop-switch" role="group" aria-label="Dressing affiché" style={{ marginBottom: 10 }}>
      <button className="chip" aria-pressed={cur === ALL} onClick={() => setActiveShop(ALL)}>👗 Tous</button>
      {shopsOf(s).map((x) => <button key={x.id} className="chip" aria-pressed={cur === x.id} onClick={() => setActiveShop(x.id)}>{x.name}</button>)}
    </div>
  );
}

/** Dressing d'une nouvelle saisie (achat, dépense), seulement s'il y en a plusieurs. */
export function ShopField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const s = useData().settings;
  if (!isMulti(s)) return null;
  return (
    <Field label="Dressing">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {shopsOf(s).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </Field>
  );
}

/** Petit libellé du dressing, affiché dans les listes quand « Tous » est affiché. */
export function ShopTag({ id }: { id: string }) {
  const s = useData().settings;
  if (!isMulti(s) || activeShop(s) !== ALL) return null;
  return <span className="shop-tag">{shopName(s, id)}</span>;
}
