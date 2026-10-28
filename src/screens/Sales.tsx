import { useState } from 'react';
import { shopOf } from '../lib/shops';
import { ShopTag } from '../ui/ShopPicker';
import { isAwaitingPayment, saleBreakdown } from '../lib/engine';
import { formatEuros } from '../lib/money';
import { formatDate } from '../lib/period';
import { go, queryParam } from '../lib/router';
import { useData } from '../lib/useData';
import { ORDER_LABEL, type OrderStatus } from '../lib/types';
import { Empty, Money, PageHeader, Thumb } from '../ui/kit';

type F = 'toutes' | 'confirmer' | 'expediees' | 'terminees' | 'annulees' | 'remboursees' | 'attente' | 'perte';
const FILTERS: [F, string][] = [
  ['toutes', 'Toutes'],
  ['confirmer', 'À confirmer'],
  ['expediees', 'Expédiées'],
  ['terminees', 'Terminées'],
  ['annulees', 'Annulées'],
  ['remboursees', 'Remboursées'],
  ['attente', 'Paiement en attente'],
  ['perte', 'À perte'],
];

export const orderBadge = (s: OrderStatus) =>
  s === 'terminee' ? 'green' : ['annulee', 'remboursee', 'retournee'].includes(s) ? 'red' : s === 'confirmee' ? 'warn' : '';

export function Sales() {
  const ds = useData();
  const init = queryParam('filtre') as F;
  const [f, setF] = useState<F>(FILTERS.some(([x]) => x === init) ? init : 'toutes');
  const names = new Map(ds.items.map((i) => [i.id, i]));
  const all = ds.sales
    .map((s) => saleBreakdown(ds, s))
    .sort((a, b) => b.sale.date.localeCompare(a.sale.date) || b.sale.createdAt.localeCompare(a.sale.createdAt));
  const list = all.filter(({ sale: s, isLoss, cancelled }) => {
    switch (f) {
      case 'attente': return isAwaitingPayment(ds, s) && !cancelled;
      case 'confirmer': return s.orderStatus === 'confirmee' || s.orderStatus === 'en_attente';
      case 'expediees': return s.orderStatus === 'expediee';
      case 'terminees': return s.orderStatus === 'terminee';
      case 'annulees': return s.orderStatus === 'annulee';
      case 'remboursees': return ['retournee', 'remboursee'].includes(s.orderStatus) || ds.refunds.some((r) => r.saleId === s.id);
      case 'perte': return isLoss && !cancelled;
      default: return true;
    }
  });
  const totRev = list.reduce((a, b) => a + b.netRevenue, 0);
  const totProfit = list.reduce((a, b) => a + b.profit, 0);

  return (
    <>
      <PageHeader title="Ventes" sub={`${list.length} vente${list.length > 1 ? 's' : ''} · ${formatEuros(totRev)} encaissés`} right={ds.settings.showStock ? <button className="btn btn-primary btn-sm" onClick={() => go('vente')}>Ajouter</button> : undefined} />
      <div className="chips" role="group" aria-label="Filtrer les ventes">
        {FILTERS.map(([x, l]) => <button key={x} className="chip" aria-pressed={f === x} onClick={() => setF(x)}>{l}</button>)}
      </div>
      {list.length > 0 && (
        <div className="card row-between" style={{ marginTop: 12 }}>
          <span className="muted small">Bénéfice commercial de cette liste</span>
          <b><Money c={totProfit} signed tone /></b>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        {list.length === 0 ? (
          ds.sales.length === 0 ? (
            ds.settings.showStock
              ? <Empty title="Aucune vente pour l'instant" text="Quand un article part, enregistre la vente pour connaître ton bénéfice réel." action={<button className="btn btn-primary" onClick={() => go('vente')}>Enregistrer une vente</button>} />
              : <Empty title="Aucune vente pour l'instant" text="Tes ventes Vinted arriveront ici toutes seules grâce à la synchro Gmail." action={<button className="btn btn-primary" onClick={() => go('synchro')}>Synchro Vinted</button>} />
          ) : (
            <Empty title="Aucune vente dans ce filtre" text="Choisis un autre filtre pour voir tes ventes." action={<button className="btn btn-ghost" onClick={() => setF('toutes')}>Voir toutes les ventes</button>} />
          )
        ) : (
          <div className="list">
            {list.map((b) => {
              const first = names.get(b.lines[0]?.itemId);
              const title = b.lines.length > 1 ? `${first?.name ?? 'Article'} + ${b.lines.length - 1}` : first?.name ?? 'Vente';
              return (
                <button key={b.sale.id} className="li" onClick={() => go(`ventes/${b.sale.id}`)}>
                  <Thumb photoId={first?.photoIds[0]} name={title} />
                  <span className="li-main">
                    <div className="li-title">{title}<ShopTag id={shopOf(b.sale)} /></div>
                    <div className="li-sub">{formatDate(b.sale.date)} · {formatEuros(b.netRevenue)}{isAwaitingPayment(ds, b.sale) ? ' · paiement en attente' : ''}</div>
                    <span className={`badge ${orderBadge(b.sale.orderStatus)}`} style={{ marginTop: 4 }}>{ORDER_LABEL[b.sale.orderStatus]}</span>
                  </span>
                  <span className="li-end">
                    <div className="li-amount"><Money c={b.profit} signed tone /></div>
                    <div className="tiny faint">bénéfice</div>
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
