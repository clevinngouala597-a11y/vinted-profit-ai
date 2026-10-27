import { useMemo, useState } from 'react';
import {
  cashState,
  goalFor,
  isAwaitingPayment,
  periodMetrics,
  plEntries,
  reinvestment,
  saleBreakdown,
  series,
  stockState,
} from '../lib/engine';
import { formatEuros, formatPercent, percent } from '../lib/money';
import { buckets, formatDate, formatRange, monthEnd, monthStart, previousRange } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { RevenueProfitChart } from '../ui/charts';
import { ICalc, IChevron, IDownload, IGear, IMenu, IReceipt, ITarget, IWallet } from '../ui/icons';
import { BigMoney, Empty, InfoButton, Money, Sheet } from '../ui/kit';
import { PeriodPicker, usePeriod } from './PeriodPicker';

export function Home() {
  const ds = useData();
  const p = usePeriod();
  const [menu, setMenu] = useState(false);

  const entries = useMemo(() => plEntries(ds), [ds]);
  const m = periodMetrics(ds, p.range.from, p.range.to, entries);
  const prevR = previousRange(p.key, p.range);
  const prev = periodMetrics(ds, prevR.from, prevR.to, entries);
  const cash = cashState(ds);
  const stock = stockState(ds, p.today);
  const month = periodMetrics(ds, monthStart(p.today), monthEnd(p.today), entries);
  const re = reinvestment(ds, cash, month.commercialProfit);
  const chart = series(entries, buckets(p.range, p.today));
  const hasPrev = prev.revenue !== 0 || prev.commercialProfit !== 0;
  const goal = goalFor(ds, p.today.slice(0, 7)).profit;

  const lossSales = ds.sales.filter((s) => s.orderStatus !== 'annulee' && saleBreakdown(ds, s).isLoss);
  const pendingPay = ds.sales.filter((s) => isAwaitingPayment(ds, s));
  const nothing = ds.items.length === 0 && ds.expenses.length === 0;

  return (
    <>
      <header className="top">
        <div>
          <h1>{ds.settings.businessName || 'Mon activité'}</h1>
          <div className="sub">{formatRange(p.range)}</div>
        </div>
        <button className="icon-btn" aria-label="Menu : dépenses, calculateur, trésorerie, exports, réglages" onClick={() => setMenu(true)}>
          <IMenu />
        </button>
      </header>

      <PeriodPicker p={p} />

      <section className="hero" style={{ marginTop: 14 }} aria-label="Bénéfice de la période">
        <div className="hero-label">Bénéfice commercial <InfoButton k="profit" /></div>
        <div className="hero-amount"><BigMoney c={m.commercialProfit} /></div>
        <div className="hero-meta">
          <span>CA <b>{formatEuros(m.revenue)}</b> <InfoButtonInline k="revenue" /></span>
          <span>Résultat après charges <b className={m.result < 0 ? 'neg' : ''}>{formatEuros(m.result)}</b> <InfoButtonInline k="result" /></span>
        </div>
        {hasPrev && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }} className="small muted">
            <Delta now={m.commercialProfit} before={prev.commercialProfit} />
            par rapport à la période précédente ({formatEuros(prev.commercialProfit)})
          </div>
        )}
        {goal > 0 && (p.key === 'mois') && (
          <div style={{ marginTop: 14 }}>
            <div className="row-between small" role="button" tabIndex={0} onClick={() => go('objectifs')} style={{ cursor: 'pointer' }}>
              <span className="muted">Objectif du mois</span>
              <span><b>{formatEuros(Math.max(0, m.commercialProfit))}</b> <span className="muted">/ {formatEuros(goal)}</span></span>
            </div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, Math.max(0, (m.commercialProfit / goal) * 100)))}>
              <div style={{ width: `${Math.min(100, Math.max(0, (m.commercialProfit / goal) * 100))}%` }} />
            </div>
            <div className="tiny muted">
              {m.commercialProfit >= goal ? 'Objectif atteint.' : `Encore ${formatEuros(goal - m.commercialProfit)} à réaliser.`}
            </div>
          </div>
        )}
      </section>

      {nothing && (
        <div style={{ marginTop: 12 }}>
          <Empty
            title="Commence par ton premier achat"
            text="Enregistre un article acheté : son coût sert ensuite à calculer ton bénéfice réel quand tu le vends."
            action={<button className="btn btn-primary" onClick={() => go('achat')}>Enregistrer un achat</button>}
          />
        </div>
      )}

      <div className="grid2" style={{ marginTop: 12 }}>
        <Tile k="cash" label="Trésorerie" value={formatEuros(cash.balance)} note={cash.pendingIn ? `+ ${formatEuros(cash.pendingIn)} en attente` : 'confirmée'} onClick={() => go('tresorerie')} tone={cash.balance < 0 ? 'neg' : ''} />
        <Tile k="stockValue" label="Valeur du stock" value={formatEuros(stock.costValue)} note="au coût d'achat" onClick={() => go('stock')} />
        <Tile k="purchases" label="Achats" value={formatEuros(m.purchases)} note="sur la période" />
        <Tile k="expenses" label="Dépenses annexes" value={formatEuros(m.general + m.saleCosts)} note="sur la période" onClick={() => go('depenses')} />
        <Tile k="stockCount" label="En stock" value={`${stock.count}`} note={stock.count > 1 ? 'articles' : 'article'} onClick={() => go('stock')} />
        <Tile k="sold" label="Vendus" value={`${m.itemsSold}`} note="sur la période" onClick={() => go('ventes')} />
        <Tile k="avg" label="Bénéfice / article" value={m.avgProfitPerItem === null ? '—' : formatEuros(m.avgProfitPerItem)} tone={m.avgProfitPerItem !== null && m.avgProfitPerItem < 0 ? 'neg' : ''} note={`marge ${formatPercent(m.margin)}`} />
        <Tile k="roi" label="ROI" value={m.roi === null ? '—' : formatPercent(m.roi)} tone={m.roi !== null && m.roi < 0 ? 'neg' : ''} note={m.roi === null ? 'non applicable' : 'sur le coût vendu'} />
        <Tile k="reinvest" label="À réinvestir" value={formatEuros(re.planned)} note={`${ds.settings.reinvestPct} % du bénéfice du mois`} onClick={() => go('tresorerie')} />
        <Tile k="available" label="Disponible" value={formatEuros(re.available)} note="pour de nouveaux achats" onClick={() => go('tresorerie')} />
      </div>

      <h2>Évolution</h2>
      <div className="card"><RevenueProfitChart data={chart} /></div>

      {(stock.stale.length > 0 || lossSales.length > 0 || pendingPay.length > 0 || stock.missingTarget > 0) && (
        <>
          <h2>À surveiller</h2>
          <div className="list">
            {stock.stale.length > 0 && (
              <AlertRow tone="warn" title={`${stock.stale.length} article${stock.stale.length > 1 ? 's' : ''} en stock depuis ${ds.settings.staleDays} jours ou plus`} sub={`${formatEuros(stock.stale.reduce((a, i) => a + i.purchasePrice + i.directFees, 0))} immobilisés`} onClick={() => go('stock?filtre=anciens')} />
            )}
            {lossSales.length > 0 && (
              <AlertRow tone="bad" title={`${lossSales.length} vente${lossSales.length > 1 ? 's' : ''} à perte`} sub="Le revenu ne couvre pas le coût de revient et les frais" onClick={() => go('ventes?filtre=perte')} />
            )}
            {pendingPay.length > 0 && (
              <AlertRow tone="warn" title={`${pendingPay.length} paiement${pendingPay.length > 1 ? 's' : ''} en attente`} sub={`${formatEuros(cash.pendingIn)} pas encore dans ta trésorerie`} onClick={() => go('ventes?filtre=attente')} />
            )}
            {stock.missingTarget > 0 && (
              <AlertRow tone="warn" title={`${stock.missingTarget} article${stock.missingTarget > 1 ? 's' : ''} sans prix de vente souhaité`} sub="Nécessaire pour estimer le bénéfice potentiel du stock" onClick={() => go('stock?filtre=sansprix')} />
            )}
          </div>
        </>
      )}

      <RecentActivity />

      <Sheet open={menu} onClose={() => setMenu(false)} title="Menu">
        <MenuLink icon={<IReceipt width={18} height={18} />} title="Dépenses et justificatifs" sub="Liste, catégories, photos de tickets" to="depenses" close={() => setMenu(false)} />
        <MenuLink icon={<ITarget width={18} height={18} />} title="Objectifs" sub="Bénéfice, ventes, budget, stock" to="objectifs" close={() => setMenu(false)} />
        <MenuLink icon={<ICalc width={18} height={18} />} title="Calculateur de prix" sub="Simule un prix avant de publier" to="calculateur" close={() => setMenu(false)} />
        <MenuLink icon={<IWallet width={18} height={18} />} title="Trésorerie et réinvestissement" sub="Mouvements, réserve, budget d'achat" to="tresorerie" close={() => setMenu(false)} />
        <MenuLink icon={<IDownload width={18} height={18} />} title="Exports et sauvegarde" sub="CSV pour Excel, sauvegarde complète" to="exports" close={() => setMenu(false)} />
        <MenuLink icon={<IGear width={18} height={18} />} title="Réglages" sub="Objectifs, réserve, statut, catégories" to="reglages" close={() => setMenu(false)} />
      </Sheet>
    </>
  );
}

function InfoButtonInline({ k }: { k: string }) {
  return <span style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 2 }}><InfoButton k={k} /></span>;
}

function Delta({ now, before }: { now: number; before: number }) {
  const diff = now - before;
  const pct = percent(Math.abs(diff), Math.abs(before));
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  return (
    <span className={`delta ${cls}`}>
      {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {pct === null ? formatEuros(Math.abs(diff)) : formatPercent(pct)}
    </span>
  );
}

function Tile({ k, label, value, note, onClick, tone = '' }: { k: string; label: string; value: string; note?: string; onClick?: () => void; tone?: string }) {
  const body = (
    <>
      <div className="tile-label"><span>{label}</span><InfoButton k={k} /></div>
      <div className={`tile-value ${tone}`}>{value}</div>
      {note && <div className="tile-note">{note}</div>}
    </>
  );
  return onClick ? (
    <div className="tile" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()} style={{ cursor: 'pointer' }}>{body}</div>
  ) : (
    <div className="tile">{body}</div>
  );
}

function AlertRow({ tone, title, sub, onClick }: { tone: 'warn' | 'bad'; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="li" onClick={onClick}>
      <span className={`dot ${tone === 'bad' ? 'bad' : 'out'}`} style={tone === 'warn' ? { color: 'var(--warn)', background: 'var(--warn-soft)' } : undefined}>!</span>
      <span className="li-main"><div className="li-title">{title}</div><div className="li-sub">{sub}</div></span>
      <IChevron className="faint" />
    </button>
  );
}

function MenuLink({ icon, title, sub, to, close }: { icon: React.ReactNode; title: string; sub: string; to: string; close: () => void }) {
  return (
    <button className="menu-item" onClick={() => { close(); go(to); }}>
      <span className="dot out">{icon}</span>
      <span style={{ flex: 1 }}><div className="mi-title">{title}</div><div className="mi-sub">{sub}</div></span>
      <IChevron className="faint" />
    </button>
  );
}

function RecentActivity() {
  const ds = useData();
  const names = new Map(ds.items.map((i) => [i.id, i.name]));
  type Ev = { at: string; date: string; title: string; sub: string; amount: number; kind: 'in' | 'out' | 'bad'; to: string };
  const ev: Ev[] = [];
  for (const p of ds.purchases) {
    const n = ds.purchaseLines.filter((l) => l.purchaseId === p.id);
    ev.push({ at: p.createdAt, date: p.date, title: n.length === 1 ? names.get(n[0].itemId) ?? 'Achat' : `Lot de ${n.length} articles`, sub: `Achat${p.source ? ' · ' + p.source : ''}`, amount: -(p.itemsTotal + p.commonFees), kind: 'out', to: n.length === 1 ? `stock/${n[0].itemId}` : 'stock' });
  }
  for (const s of ds.sales) {
    const b = saleBreakdown(ds, s);
    const lines = b.lines.map((l) => names.get(l.itemId)).join(', ');
    ev.push({ at: s.createdAt, date: s.date, title: lines || 'Vente', sub: s.orderStatus === 'annulee' ? 'Vente annulée' : `Vente · bénéfice ${formatEuros(b.profit, { signed: true })}`, amount: b.revenue, kind: b.isLoss ? 'bad' : 'in', to: `ventes/${s.id}` });
  }
  for (const r of ds.refunds) ev.push({ at: r.createdAt, date: r.date, title: 'Remboursement', sub: r.itemRecovered ? 'Article récupéré' : 'Retour en attente', amount: -r.amount, kind: 'bad', to: `ventes/${r.saleId}` });
  for (const e of ds.expenses) ev.push({ at: e.createdAt, date: e.date, title: e.description || e.category, sub: `Dépense · ${e.category}`, amount: -e.amount, kind: 'out', to: 'depenses' });
  ev.sort((a, b) => b.at.localeCompare(a.at));
  const last = ev.slice(0, 8);
  if (!last.length) return null;
  return (
    <>
      <h2>Activité récente</h2>
      <div className="list">
        {last.map((e) => (
          <button key={e.at + e.title} className="li" onClick={() => go(e.to)}>
            <span className={`dot ${e.kind}`}>{e.amount >= 0 ? '+' : '−'}</span>
            <span className="li-main"><div className="li-title">{e.title}</div><div className="li-sub">{e.sub} · {formatDate(e.date)}</div></span>
            <span className="li-end li-amount"><Money c={e.amount} signed tone={e.kind === 'in'} /></span>
          </button>
        ))}
      </div>
    </>
  );
}
