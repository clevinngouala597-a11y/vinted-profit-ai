import { useState } from 'react';
import { cashState, periodMetrics, reinvestment } from '../lib/engine';
import { formatEuros } from '../lib/money';
import { formatDate, monthEnd, monthStart, todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { InfoButton, Money, PageHeader } from '../ui/kit';

const KIND: Record<string, string> = {
  achat: 'Achat', vente: 'Vente', frais_vente: 'Frais de vente', depense: 'Dépense', remboursement: 'Remboursement', ajustement: 'Ajustement', solde_initial: 'Solde initial',
};

export function Treasury() {
  const ds = useData();
  const t = todayISO();
  const cash = cashState(ds);
  const month = periodMetrics(ds, monthStart(t), monthEnd(t));
  const re = reinvestment(ds, cash, month.commercialProfit);
  const [all, setAll] = useState(false);
  const txs = [...ds.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const shown = all ? txs : txs.slice(0, 25);
  const maxBuy = ds.settings.maxPurchaseBudget;

  return (
    <>
      <PageHeader title="Trésorerie" sub="Argent réellement disponible, séparé du bénéfice" backTo="" />
      <section className="hero">
        <div className="hero-label">Solde confirmé <InfoButton k="cash" /></div>
        <div className="hero-amount" style={{ fontSize: 44 }}><span className={cash.balance < 0 ? 'neg' : ''}>{formatEuros(cash.balance)}</span></div>
        <div className="hero-meta">
          <span>Solde de départ <b>{formatEuros(ds.settings.initialCash)}</b></span>
          {cash.pendingIn > 0 && <span>À recevoir <b>{formatEuros(cash.pendingIn)}</b></span>}
          {cash.pendingOut < 0 && <span>À payer <b>{formatEuros(-cash.pendingOut)}</b></span>}
        </div>
      </section>

      <h2>Budget d'achat</h2>
      <div className="calc">
        <div className="calc-row"><span>Solde confirmé</span><span>{formatEuros(cash.balance)}</span></div>
        {cash.pendingOut < 0 && <div className="calc-row"><span>Sorties en attente</span><span>− {formatEuros(-cash.pendingOut)}</span></div>}
        <div className="calc-row"><span>Réserve de sécurité</span><span>− {formatEuros(ds.settings.safetyReserve)}</span></div>
        <div className="calc-row total"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Disponible pour acheter <InfoButton k="available" /></span><span className="pos">{formatEuros(re.available)}</span></div>
        <div className="calc-row"><span>Bénéfice commercial du mois</span><span><Money c={month.commercialProfit} tone /></span></div>
        <div className="calc-row total"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>À réinvestir ({ds.settings.reinvestPct} %) <InfoButton k="reinvest" /></span><span>{formatEuros(re.planned)}</span></div>
        {maxBuy > 0 && <div className="calc-row"><span>Plafond par achat</span><span>{formatEuros(maxBuy)}</span></div>}
      </div>
      {cash.pendingIn > 0 && <p className="tiny muted">Les {formatEuros(cash.pendingIn)} de ventes en attente de paiement ne sont pas comptés tant qu'ils ne sont pas reçus.</p>}
      <button className="link" onClick={() => go('reglages')}>Modifier la réserve et le pourcentage de réinvestissement</button>

      <h2>Mouvements <span className="h2-note">{txs.length}</span></h2>
      {txs.length === 0 ? (
        <div className="card small muted">Aucun mouvement : ils apparaissent à chaque achat, vente, dépense ou remboursement.</div>
      ) : (
        <div className="list">
          {shown.map((x) => (
            <div className="li" key={x.id} style={x.status === 'annule' ? { opacity: 0.45 } : undefined}>
              <span className={`dot ${x.amount >= 0 ? 'in' : 'out'}`}>{x.amount >= 0 ? '+' : '−'}</span>
              <span className="li-main">
                <div className="li-title">{x.label}</div>
                <div className="li-sub">{formatDate(x.date)} · {KIND[x.kind]}{x.status === 'en_attente' ? ' · en attente' : x.status === 'annule' ? ' · annulé' : ''}</div>
              </span>
              <span className="li-end li-amount"><Money c={x.amount} signed tone={x.status === 'confirme'} /></span>
            </div>
          ))}
        </div>
      )}
      {!all && txs.length > 25 && <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setAll(true)}>Afficher les {txs.length} mouvements</button>}
    </>
  );
}
