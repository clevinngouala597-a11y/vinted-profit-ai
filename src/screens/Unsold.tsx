import { useMemo, useState } from 'react';
import { SPREAD_LABEL, spreadCost, spreadShares, type SpreadMethod } from '../lib/actions';
import { formatEuros, formatPercent, parseEuros } from '../lib/money';
import { todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { profitAt, unsoldAnalysis, type UnsoldItem } from '../lib/unsold';
import { STATUS_LABEL } from '../lib/types';
import { BarList } from '../ui/charts';
import { IChevron } from '../ui/icons';
import { cents, Empty, ErrorBox, Field, MoneyInput, PageHeader, Sheet, useAction, useUI } from '../ui/kit';

type Sort = 'age' | 'capital' | 'marge';

/** Analyse des invendus : argent immobilisé, ancienneté, et marge à différents prix. */
export function Unsold() {
  const ds = useData();
  const today = todayISO();
  const a = useMemo(() => unsoldAnalysis(ds, today), [ds, today]);
  const [sort, setSort] = useState<Sort>('age');
  const [open, setOpen] = useState<string | null>(null);
  const [onlyDormant, setOnlyDormant] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [spreadOpen, setSpreadOpen] = useState(false);

  const rows = useMemo(() => {
    const r = a.items.filter((x) => !onlyDormant || x.dormant);
    const best = (x: UnsoldItem) => x.scenarios[0]?.margin ?? -Infinity;
    if (sort === 'capital') return [...r].sort((x, y) => y.cost - x.cost);
    if (sort === 'marge') return [...r].sort((x, y) => best(x) - best(y));
    return r;
  }, [a, sort, onlyDormant]);

  if (a.count === 0)
    return (
      <>
        <PageHeader title="Invendus" sub="L’argent immobilisé dans ton stock" backTo="" />
        <Empty title="Aucun article en stock" text="Les articles achetés et pas encore vendus apparaîtront ici, avec leur ancienneté et leur marge à différents prix." action={<button className="btn btn-primary" onClick={() => go('achat')}>Ajouter un achat</button>} />
      </>
    );

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <PageHeader title="Invendus" sub="L’argent immobilisé dans ton stock" backTo="" right={
        <button className="btn btn-ghost btn-sm" onClick={() => { setSelecting(!selecting); setPicked(new Set()); }}>{selecting ? 'Annuler' : 'Répartir un coût'}</button>
      } />

      <div className="grid2">
        <div className="tile"><div className="tile-label">Argent immobilisé</div><div className="tile-value">{formatEuros(a.capital)}</div><div className="tile-note">{a.count} article{a.count > 1 ? 's' : ''} au prix de revient</div></div>
        <div className="tile"><div className="tile-label">Ancienneté moyenne</div><div className="tile-value">{a.avgAge ?? 0} j</div><div className="tile-note">{a.medianDaysToSell !== null ? `tu vends d’habitude en ${a.medianDaysToSell} j` : 'pas encore assez de ventes'}</div></div>
        <div className="tile"><div className="tile-label">Articles qui dorment</div><div className={`tile-value ${a.dormantCount ? 'warn' : ''}`}>{a.dormantCount}</div><div className="tile-note">{formatEuros(a.dormantCapital)} bloqués</div></div>
        <div className="tile"><div className="tile-label">Bénéfice possible</div><div className={`tile-value ${a.potential < 0 ? 'neg' : 'pos'}`}>{formatEuros(a.potential)}</div><div className="tile-note">au prix souhaité</div></div>
      </div>
      {a.costPending > 0 && <div className="alert warn" style={{ marginTop: 10 }}>{a.costPending} article{a.costPending > 1 ? 's' : ''} sans prix d’achat : leur coût compte pour 0 € ici.</div>}
      <p className="tiny faint">Marges calculées avec tes frais moyens par vente ({formatEuros(a.avgSaleCost)} sur les 6 derniers mois). Un article « dort » quand il est en stock depuis plus de deux fois ton délai de vente habituel.</p>

      <h2>Par ancienneté</h2>
      <div className="card">
        <BarList rows={a.buckets.map((b) => ({ name: b.label, v: b.capital, n: b.count }))} valueOf={(r) => r.v as number} format={(r) => `${formatEuros(r.v as number)} · ${r.n} article${(r.n as number) > 1 ? 's' : ''}`} />
      </div>

      <div className="row-between" style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0 }}>Articles</h2>
        <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyDormant} onChange={(e) => setOnlyDormant(e.target.checked)} /> qui dorment
        </label>
      </div>
      <div className="chips" role="group" aria-label="Trier" style={{ margin: '10px 0 12px' }}>
        {([['age', 'Plus anciens'], ['capital', 'Plus coûteux'], ['marge', 'Marge la plus faible']] as [Sort, string][]).map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>
        ))}
      </div>
      {selecting && <div className="alert ok" style={{ marginBottom: 10 }}>Coche les articles qui partagent un coût (nettoyage, réparation, livraison d’un lot…), puis touche « Répartir ».</div>}

      <div className="list">
        {rows.map((x) => (
          <div key={x.item.id} className="li" style={{ display: 'block' }}>
            <div className="row-between" style={{ gap: 10 }}>
              {selecting && <input type="checkbox" aria-label={`Choisir ${x.item.name}`} checked={picked.has(x.item.id)} disabled={!!x.item.costPending} onChange={() => toggle(x.item.id)} style={{ width: 20, height: 20, accentColor: 'var(--green)' }} />}
              <button className="li-main" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0, flex: 1 }}
                aria-expanded={open === x.item.id} onClick={() => (selecting ? !x.item.costPending && toggle(x.item.id) : setOpen(open === x.item.id ? null : x.item.id))}>
                <div className="li-title" style={{ fontSize: 14 }}>{x.item.name}</div>
                <div className="li-sub">{STATUS_LABEL[x.item.status]} · coût {formatEuros(x.cost)}{x.item.targetPrice ? ` · prix ${formatEuros(x.item.targetPrice)}` : ''}</div>
              </button>
              <span className={`badge ${x.dormant ? 'red' : x.age >= 30 ? 'warn' : ''}`}>{x.age} j</span>
            </div>
            {open === x.item.id && !selecting && <Scenarios x={x} avgSaleCost={a.avgSaleCost} />}
          </div>
        ))}
      </div>

      {selecting && (
        <div className="sticky-actions">
          <button className="btn btn-primary" disabled={picked.size === 0} onClick={() => setSpreadOpen(true)}>Répartir un coût sur {picked.size} article{picked.size > 1 ? 's' : ''}</button>
        </div>
      )}
      {spreadOpen && <SpreadSheet itemIds={[...picked]} onClose={(done) => { setSpreadOpen(false); if (done) { setSelecting(false); setPicked(new Set()); } }} />}
    </>
  );
}

function Scenarios({ x, avgSaleCost }: { x: UnsoldItem; avgSaleCost: number }) {
  const [custom, setCustom] = useState('');
  const c = parseEuros(custom);
  const sim = c !== null && c > 0 ? profitAt(x.cost, c, avgSaleCost) : null;
  return (
    <div style={{ marginTop: 10 }}>
      <table className="report" style={{ width: '100%' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>Si vendu à</th><th>Prix</th><th>Bénéfice</th><th>Marge</th></tr></thead>
        <tbody>
          {x.scenarios.map((s) => (
            <tr key={s.key}>
              <td style={{ textAlign: 'left' }}>{s.label}</td>
              <td>{formatEuros(s.price)}</td>
              <td className={s.profit < 0 ? 'neg' : s.profit > 0 ? 'pos' : ''}>{formatEuros(s.profit)}</td>
              <td>{formatPercent(s.margin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <div style={{ flex: 1 }}><MoneyInput value={custom} onChange={setCustom} placeholder="Autre prix" aria-label="Simuler un autre prix" /></div>
        {sim && <span className={`small ${sim.profit < 0 ? 'neg' : 'pos'}`} style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{formatEuros(sim.profit)} · {formatPercent(sim.margin)}</span>}
      </div>
      <div className="tiny faint" style={{ marginTop: 6 }}>
        {x.listedFor !== null ? `En ligne depuis ${x.listedFor} j` : 'Pas encore en ligne'} · acheté il y a {x.age} j · sans perte à partir de {formatEuros(x.breakEven)}
      </div>
      <button className="link" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => go(`stock/${x.item.id}`)}>Ouvrir l’article <IChevron width={14} height={14} /></button>
    </div>
  );
}

/** Répartir un coût payé après coup sur plusieurs articles du stock. */
export function SpreadSheet({ itemIds, onClose }: { itemIds: string[]; onClose: (done: boolean) => void }) {
  const ds = useData();
  const ui = useUI();
  const items = ds.items.filter((i) => itemIds.includes(i.id));
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<SpreadMethod>('egal');
  const { error, run, busy } = useAction();
  const shares = spreadShares(items, cents(amount), method);
  return (
    <Sheet open onClose={() => onClose(false)} title="Répartir un coût">
      <ErrorBox error={error} />
      <p className="small muted" style={{ marginTop: 0 }}>Le coût est payé une fois (il sort de ta trésorerie à cette date) et chaque article reçoit sa part : son coût de revient augmente d’autant.</p>
      <div className="cols">
        <Field label="Montant total"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Date"><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="C’est quoi ?"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pressing, réparation, livraison du lot…" /></Field>
      <Field label="Répartition">
        <select className="input" value={method} onChange={(e) => setMethod(e.target.value as SpreadMethod)}>
          {(Object.keys(SPREAD_LABEL) as SpreadMethod[]).map((k) => <option key={k} value={k}>{SPREAD_LABEL[k]}</option>)}
        </select>
      </Field>
      <div className="calc" style={{ marginBottom: 12 }}>
        {items.map((it, k) => <div className="calc-row" key={it.id}><span>{it.name}</span><span>+{formatEuros(shares[k] ?? 0)}</span></div>)}
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        const ok = await run(() => spreadCost({ itemIds, amount: cents(amount), label, date, method }));
        if (ok) { ui.toast(`Coût réparti sur ${items.length} article${items.length > 1 ? 's' : ''}`); onClose(true); }
      }}>Répartir {amount ? formatEuros(cents(amount)) : ''}</button>
    </Sheet>
  );
}
