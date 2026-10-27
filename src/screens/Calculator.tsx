import { useState } from 'react';
import { estimate } from '../lib/engine';
import { centsToInput, formatEuros, formatPercent, roundHalfAway } from '../lib/money';
import { useData } from '../lib/useData';
import { SELLABLE } from '../lib/types';
import { cents, centsOrNull, Field, InfoButton, MoneyInput, PageHeader } from '../ui/kit';

export function Calculator() {
  const ds = useData();
  const stock = ds.items.filter((i) => SELLABLE.includes(i.status));
  const [itemId, setItemId] = useState('');
  const [buy, setBuy] = useState('');
  const [fees, setFees] = useState('');
  const [price, setPrice] = useState('');
  const [sellCosts, setSellCosts] = useState('');
  const [target, setTarget] = useState(ds.settings.minProfitPerItem ? centsToInput(ds.settings.minProfitPerItem) : '');

  const pick = (id: string) => {
    setItemId(id);
    const it = stock.find((i) => i.id === id);
    if (!it) return;
    setBuy(centsToInput(it.purchasePrice));
    setFees(centsToInput(it.directFees));
    if (it.targetPrice !== null) setPrice(centsToInput(it.targetPrice));
  };

  const t = centsOrNull(target);
  const e = estimate({ purchasePrice: cents(buy), directFees: cents(fees), sellerRevenue: cents(price), sellerCosts: cents(sellCosts), targetProfit: t });
  const base = cents(price) || e.minRevenueForTarget || 0;
  const options = base > 0
    ? [0.8, 0.9, 1, 1.1, 1.2].map((f) => {
        const p = roundHalfAway((base * f) / 100) * 100; // arrondi à l'euro
        return { p, ...estimate({ purchasePrice: cents(buy), directFees: cents(fees), sellerRevenue: p, sellerCosts: cents(sellCosts) }) };
      })
    : [];
  const ready = buy.trim() !== '';

  return (
    <>
      <PageHeader title="Calculateur de prix" sub="Simule ton bénéfice avant de publier" backTo="" />
      {stock.length > 0 && (
        <Field label="Partir d'un article du stock (facultatif)">
          <select className="input" value={itemId} onChange={(e) => pick(e.target.value)}>
            <option value="">Saisie libre</option>
            {stock.map((i) => <option key={i.id} value={i.id}>{i.name}{i.size ? ` · ${i.size}` : ''}</option>)}
          </select>
        </Field>
      )}
      <div className="cols">
        <Field label="Prix d'achat"><MoneyInput value={buy} onChange={setBuy} /></Field>
        <Field label="Frais d'achat"><MoneyInput value={fees} onChange={setFees} /></Field>
        <Field label="Montant encaissé envisagé" hint="Ce que tu recevras, hors frais payés par l'acheteur."><MoneyInput value={price} onChange={setPrice} /></Field>
        <Field label="Frais de vente estimés" hint="Emballage, frais à ta charge…"><MoneyInput value={sellCosts} onChange={setSellCosts} /></Field>
      </div>
      <Field label="Bénéfice minimum recherché"><MoneyInput value={target} onChange={setTarget} /></Field>

      {ready ? (
        <>
          <div className="calc">
            <div className="calc-row"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Coût de revient <InfoButton k="cost" /></span><span>{formatEuros(e.cost)}</span></div>
            {price.trim() !== '' && (
              <>
                <div className="calc-row total"><span>Bénéfice prévisionnel</span><span className={e.isLoss ? 'neg' : 'pos'}>{formatEuros(e.profit, { signed: true })}</span></div>
                <div className="calc-row"><span>Marge sur le prix</span><span>{formatPercent(e.margin)}</span></div>
                <div className="calc-row"><span>Retour sur investissement</span><span>{formatPercent(e.roi)}</span></div>
              </>
            )}
            {e.minRevenueForTarget !== null && (
              <div className="calc-row total"><span>Prix minimum pour gagner {formatEuros(t ?? 0)}</span><span>{formatEuros(e.minRevenueForTarget)}</span></div>
            )}
          </div>
          {options.length > 0 && (
            <>
              <h2>Comparer plusieurs prix</h2>
              <div className="card scroll-x">
                <table className="report">
                  <thead><tr><th>Encaissé</th><th>Bénéfice</th><th>Marge</th><th>ROI</th></tr></thead>
                  <tbody>
                    {options.map((o) => (
                      <tr key={o.p} style={t !== null && o.profit >= t ? undefined : { opacity: 0.6 }}>
                        <td>{formatEuros(o.p)}</td>
                        <td className={o.isLoss ? 'neg' : 'pos'}>{formatEuros(o.profit, { signed: true })}</td>
                        <td>{formatPercent(o.margin)}</td>
                        <td>{formatPercent(o.roi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tiny faint">Les frais de vente sont des estimations : après la vente, le bénéfice réel est calculé avec les montants réellement saisis.</p>
            </>
          )}
        </>
      ) : (
        <div className="card small muted">Indique au moins le prix d'achat pour voir le calcul.</div>
      )}
    </>
  );
}
