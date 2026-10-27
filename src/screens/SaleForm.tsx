import { useMemo, useState } from 'react';
import { recordSale } from '../lib/actions';
import { estimate, itemCost } from '../lib/engine';
import { centsToInput, formatEuros, formatPercent, parseEuros } from '../lib/money';
import { todayISO } from '../lib/period';
import { go, queryParam } from '../lib/router';
import { useData } from '../lib/useData';
import { SELLABLE, STATUS_LABEL } from '../lib/types';
import { ICheck, ISearch } from '../ui/icons';
import { cents, Empty, ErrorBox, Field, InfoButton, MoneyInput, PageHeader, Thumb, useAction, useUI } from '../ui/kit';

export function SaleForm() {
  const ds = useData();
  const ui = useUI();
  const pre = queryParam('item');
  const available = ds.items.filter((i) => SELLABLE.includes(i.status));
  const [selected, setSelected] = useState<string[]>(pre && available.some((i) => i.id === pre) ? [pre] : []);
  const [q, setQ] = useState('');
  const [date, setDate] = useState(todayISO());
  const [listed, setListed] = useState(() => {
    const it = available.find((i) => i.id === pre);
    return it?.targetPrice != null ? centsToInput(it.targetPrice) : '';
  });
  const [discount, setDiscount] = useState('');
  const [revenue, setRevenue] = useState('');
  const [revenueTouched, setRevenueTouched] = useState(false);
  const [platform, setPlatform] = useState('');
  const [packaging, setPackaging] = useState('');
  const [other, setOther] = useState('');
  const [paid, setPaid] = useState(false);
  const [notes, setNotes] = useState('');
  const { error, run, busy } = useAction();

  const chosen = available.filter((i) => selected.includes(i.id));
  const autoRevenue = Math.max(0, cents(listed) - cents(discount));
  const sellerRevenue = revenueTouched ? cents(revenue) : autoRevenue;
  const costs = cents(platform) + cents(packaging) + cents(other);
  const cost = chosen.reduce((a, i) => a + itemCost(i), 0);
  const est = estimate({ purchasePrice: cost, directFees: 0, sellerRevenue, sellerCosts: costs });
  const minTarget = ds.settings.minProfitPerItem * chosen.length;

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    const its = available.filter((i) => next.includes(i.id));
    if (its.length && its.every((i) => i.targetPrice !== null)) setListed(centsToInput(its.reduce((a, i) => a + (i.targetPrice ?? 0), 0)));
  };

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return available
      .filter((i) => !qq || [i.name, i.brand, i.size].join(' ').toLowerCase().includes(qq))
      .sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || b.purchaseDate.localeCompare(a.purchaseDate));
  }, [available, q, selected]);

  const submit = async () => {
    const saleId = await run(async () => {
      for (const [label, v] of [['Le prix affiché', listed], ['La réduction', discount], ['Les frais', platform], ["L'emballage", packaging], ['Les autres coûts', other]] as const)
        if (v.trim() && parseEuros(v) === null) throw new Error(`${label} n'est pas un montant valide.`);
      if (revenueTouched && parseEuros(revenue) === null) throw new Error("Le montant encaissé n'est pas valide.");
      return recordSale({
        date, itemIds: selected, listedPrice: cents(listed), discount: cents(discount), sellerRevenue,
        platformFees: cents(platform), packagingCost: cents(packaging), otherCosts: cents(other),
        paymentStatus: paid ? 'recu' : 'en_attente', notes,
      });
    });
    if (saleId) {
      ui.toast(est.isLoss ? 'Vente enregistrée, à perte' : `Vente enregistrée · ${formatEuros(est.profit, { signed: true })}`);
      go(`ventes/${saleId}`);
    }
  };

  if (available.length === 0)
    return (
      <>
        <PageHeader title="Nouvelle vente" backTo="" />
        <Empty title="Aucun article à vendre" text="Une vente se rattache à un article de ton stock. Enregistre d'abord l'achat de l'article." action={<button className="btn btn-primary" onClick={() => go('achat')}>Enregistrer un achat</button>} />
      </>
    );

  return (
    <>
      <PageHeader title="Nouvelle vente" sub="Choisis le ou les articles vendus" backTo="" />
      <ErrorBox error={error} />

      <h2 style={{ marginTop: 0 }}>Articles <span className="h2-note">{selected.length} sélectionné{selected.length > 1 ? 's' : ''}</span></h2>
      {available.length > 5 && (
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <ISearch style={{ position: 'absolute', left: 13, top: 14, color: 'var(--faint)' }} />
          <input className="input" style={{ paddingLeft: 38 }} type="search" placeholder="Chercher dans le stock" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher un article" />
        </div>
      )}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {list.map((i) => (
          <button key={i.id} className="select-item" aria-pressed={selected.includes(i.id)} onClick={() => toggle(i.id)}>
            <span className="radio">{selected.includes(i.id) && <ICheck />}</span>
            <Thumb photoId={i.photoIds[0]} name={i.name} />
            <span className="li-main"><div className="li-title">{i.name}</div><div className="li-sub">{[i.brand, i.size, STATUS_LABEL[i.status]].filter(Boolean).join(' · ')}</div></span>
            <span className="li-end small"><div className="muted">coût</div><b>{formatEuros(itemCost(i))}</b></span>
          </button>
        ))}
      </div>

      <h2>Montants</h2>
      <div className="cols">
        <Field label="Date de la commande"><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Prix affiché"><MoneyInput value={listed} onChange={setListed} /></Field>
        <Field label="Réduction accordée"><MoneyInput value={discount} onChange={setDiscount} /></Field>
        <Field label="Montant encaissé">
          <MoneyInput value={revenueTouched ? revenue : centsToInput(autoRevenue)} onChange={(v) => { setRevenueTouched(true); setRevenue(v); }} />
        </Field>
      </div>
      <p className="tiny muted" style={{ marginTop: -4 }}>
        Le montant encaissé est ce que tu reçois réellement. La protection acheteur et la livraison payées par l'acheteur n'en font pas partie.
      </p>
      <div className="cols">
        <Field label="Frais à ta charge" hint="Seulement s'ils ne sont pas déjà déduits du montant encaissé."><MoneyInput value={platform} onChange={setPlatform} /></Field>
        <Field label="Emballage"><MoneyInput value={packaging} onChange={setPackaging} /></Field>
      </div>
      <Field label="Autres coûts liés à cette vente"><MoneyInput value={other} onChange={setOther} /></Field>
      <label className="check">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        <span><b>Paiement déjà reçu</b><br /><span className="small muted">Sinon, le montant reste « en attente » et n'entre pas encore dans ta trésorerie.</span></span>
      </label>
      <Field label="Notes"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

      <div className="calc">
        <div className="calc-row"><span>Montant encaissé</span><span>{formatEuros(sellerRevenue)}</span></div>
        <div className="calc-row"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Coût de revient <InfoButton k="cost" /></span><span>− {formatEuros(cost)}</span></div>
        <div className="calc-row"><span>Coûts de vente</span><span>− {formatEuros(costs)}</span></div>
        <div className="calc-row total"><span>Bénéfice commercial</span><span className={est.isLoss ? 'neg' : est.profit > 0 ? 'pos' : ''}>{formatEuros(est.profit, { signed: true })}</span></div>
        <div className="calc-row"><span>Marge · ROI</span><span>{formatPercent(est.margin)} · {formatPercent(est.roi)}</span></div>
      </div>

      <div className="sticky-actions">
        {chosen.length > 0 && est.isLoss && <div className="alert error">Vente à perte : il manque {formatEuros(-est.profit)} pour couvrir le coût de revient et les frais.</div>}
        {chosen.length > 0 && !est.isLoss && minTarget > 0 && est.profit < minTarget && <div className="alert warn">Sous ton objectif de {formatEuros(ds.settings.minProfitPerItem)} par article.</div>}
        <button className="btn btn-primary" onClick={submit} disabled={busy || selected.length === 0}>
          {selected.length === 0 ? 'Choisis un article' : busy ? 'Enregistrement…' : 'Enregistrer la vente'}
        </button>
      </div>
    </>
  );
}
