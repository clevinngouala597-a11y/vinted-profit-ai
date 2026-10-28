import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { getDb } from '../lib/db';
import {
  cashState,
  goalFor,
  periodMetrics,
  plEntries,
  reinvestment,
  saleBreakdown,
  stockState,
} from '../lib/engine';
import { formatEuros, formatPercent, percent } from '../lib/money';
import { formatDate, formatRange, monthEnd, monthStart, previousRange } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { labelList, labelsToPrint } from '../lib/vinted/labels';
import { TrendChart } from '../ui/TrendChart';
import { IChart as IChartBar, ITag, IBell, IEye, IEyeOff, IMail, ICalc, IChevron, IDownload, IGear, IMenu, IReceipt, IScale, ITarget, ITrend, IWallet } from '../ui/icons';
import { saveSettings } from '../lib/actions';
import { BETA, isLocked } from '../lib/beta';
import { isAdmin, viewAsTester } from '../lib/betaAccess';
import { leaveDemo } from '../lib/demo';
import { useUI } from '../ui/kit';
import { ShopSwitcher } from '../ui/ShopPicker';
import { BigMoney, Empty, InfoButton, Money, Sheet } from '../ui/kit';
import { PeriodPicker, usePeriod } from './PeriodPicker';
import { NotifRow, useNotifications } from './Notifications';

export function Home() {
  const ds = useData();
  const p = usePeriod();
  const [menu, setMenu] = useState(false);
  const notifs = useNotifications();
  const missingCosts = ds.items.filter((i) => i.costPending).length;
  const showStock = ds.settings.showStock === true;
  const toValidate = useLiveQuery(() => getDb().syncedEmails.where('status').equals('inbox').count(), []) ?? 0;
  const labelRows = useLiveQuery(() => getDb().syncedEmails.where('date').aboveOrEqual(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)).toArray(), []);
  const toPrint = useMemo(() => (labelRows ? labelsToPrint(labelList(labelRows, ds.settings.printedLabels ?? [])) : []), [labelRows, ds.settings.printedLabels]);

  const entries = useMemo(() => plEntries(ds), [ds]);
  const m = periodMetrics(ds, p.range.from, p.range.to, entries);
  const prevR = previousRange(p.key, p.range);
  const prev = periodMetrics(ds, prevR.from, prevR.to, entries);
  const cash = cashState(ds);
  const stock = stockState(ds, p.today);
  const month = periodMetrics(ds, monthStart(p.today), monthEnd(p.today), entries);
  const re = reinvestment(ds, cash, month.commercialProfit);
  const hasPrev = prev.revenue !== 0 || prev.commercialProfit !== 0;
  const goal = goalFor(ds, p.today.slice(0, 7)).profit;

  const nothing = ds.items.length === 0 && ds.expenses.length === 0;

  return (
    <>
      <header className="top">
        <div>
          <h1>{ds.settings.businessName || 'Mon activité'}{BETA && <span className="beta-badge">{isAdmin() ? (viewAsTester() ? 'BÊTA · VUE TESTEUR' : 'BÊTA · ADMIN') : 'BÊTA'}</span>}</h1>
          <div className="sub">{formatRange(p.range)}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" aria-pressed={ds.settings.hideAmounts === true} aria-label={ds.settings.hideAmounts ? 'Afficher les montants' : 'Cacher les montants'}
            onClick={() => saveSettings({ hideAmounts: !ds.settings.hideAmounts })}>
            {ds.settings.hideAmounts ? <IEyeOff /> : <IEye />}
          </button>
          <button className="icon-btn" style={{ position: 'relative' }} aria-label={`Notifications${notifs.visible.length ? ` : ${notifs.visible.length} à traiter` : ''}`} onClick={() => go('notifications')}>
            <IBell />
            {notifs.visible.length > 0 && <span className="count-badge">{notifs.visible.length}</span>}
          </button>
          <button className="icon-btn" aria-label="Menu : objectifs, prévisions, fiscalité, dépenses, exports, réglages" onClick={() => setMenu(true)}>
            <IMenu />
          </button>
        </div>
      </header>

      <ShopSwitcher />
      <PeriodPicker p={p} />
      {BETA && <BetaCards demo={ds.settings.demoData === true} />}

      {toPrint.length > 0 && (
        <button className="alert warn" style={{ width: '100%', border: 0, marginTop: 12, textAlign: 'left', cursor: 'pointer' }} onClick={() => go('bordereaux')}>
          <span><b>🖨️ {toPrint.length} bordereau{toPrint.length > 1 ? 'x' : ''} à imprimer</b>{toPrint[0].urgency === 'urgent' ? ' — un est à envoyer dans moins de 24 h' : ''}</span>
        </button>
      )}
      {missingCosts > 0 && (
        <button className="alert warn" style={{ width: '100%', border: 0, marginTop: 12, textAlign: 'left', cursor: 'pointer' }} onClick={() => go('couts')}>
          <span><b>{missingCosts} article{missingCosts > 1 ? 's' : ''} sans prix d'achat</b> — ajoute-le{missingCosts > 1 ? 's' : ''} pour que le bénéfice soit juste.</span>
        </button>
      )}
      {toValidate > 0 && (
        <button className="alert warn" style={{ width: '100%', border: 0, marginTop: 12, textAlign: 'left', cursor: 'pointer' }} onClick={() => go('a-valider')}>
          <span><b>{toValidate} opération{toValidate > 1 ? 's' : ''} Vinted à valider</b> — indique l'article vendu pour que le bénéfice soit juste.</span>
        </button>
      )}

      <div className="home-cols"><div className="home-main">
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

      {nothing && (showStock || !ds.settings.syncUrl) && (
        <div style={{ marginTop: 12 }}>
          {showStock ? (
            <Empty
              title="Commence par ton premier achat"
              text="Enregistre un article acheté : son coût sert ensuite à calculer ton bénéfice réel quand tu le vends."
              action={<button className="btn btn-primary" onClick={() => go('achat')}>Enregistrer un achat</button>}
            />
          ) : (
            <Empty
              title="Connecte ton Gmail"
              text="Tes ventes et achats Vinted s'enregistreront tout seuls à partir de tes e-mails Vinted."
              action={<button className="btn btn-primary" onClick={() => go('synchro')}>Synchro Vinted</button>}
            />
          )}
        </div>
      )}

      <div className="grid2" style={{ marginTop: 12 }}>
        <Tile k="cash" label="Trésorerie" value={formatEuros(cash.balance)} note={cash.pendingIn ? `+ ${formatEuros(cash.pendingIn)} en attente` : 'confirmée'} onClick={() => go('tresorerie')} tone={cash.balance < 0 ? 'neg' : ''} />
        {showStock && <Tile k="stockValue" label="Valeur du stock" value={formatEuros(stock.costValue)} note="au coût d'achat" onClick={() => go('stock')} />}
        <Tile k="purchases" label="Achats" value={formatEuros(m.purchases)} note="sur la période" />
        <Tile k="expenses" label="Dépenses annexes" value={formatEuros(m.general + m.saleCosts)} note="sur la période" onClick={() => go('depenses')} />
        {showStock && <Tile k="stockCount" label="En stock" value={`${stock.count}`} note={stock.count > 1 ? 'articles' : 'article'} onClick={() => go('stock')} />}
        <Tile k="sold" label="Vendus" value={`${m.itemsSold}`} note="sur la période" onClick={() => go('ventes')} />
        <Tile k="avg" label="Bénéfice / article" value={m.avgProfitPerItem === null ? '—' : formatEuros(m.avgProfitPerItem)} tone={m.avgProfitPerItem !== null && m.avgProfitPerItem < 0 ? 'neg' : ''} note={`marge ${formatPercent(m.margin)}`} />
        <Tile k="roi" label="ROI" value={m.roi === null ? '—' : formatPercent(m.roi)} tone={m.roi !== null && m.roi < 0 ? 'neg' : ''} note={m.roi === null ? 'non applicable' : 'sur le coût vendu'} />
        <Tile k="reinvest" label="À réinvestir" value={formatEuros(re.planned)} note={`${ds.settings.reinvestPct} % du bénéfice du mois`} onClick={() => go('tresorerie')} />
        <Tile k="available" label="Disponible" value={formatEuros(re.available)} note="pour de nouveaux achats" onClick={() => go('tresorerie')} />
      </div>

      </div><div className="home-side">
      <h2>Évolution</h2>
      <div className="card"><TrendChart entries={entries} range={p.range} prevRange={prevR} today={p.today} /></div>

      {notifs.visible.length > 0 && (
        <>
          <div className="row-between">
            <h2>À surveiller</h2>
            {notifs.visible.length > 3 && <button className="link" onClick={() => go('notifications')}>Tout voir ({notifs.visible.length})</button>}
          </div>
          <div className="list">
            {notifs.visible.slice(0, 3).map((n) => <NotifRow key={n.id} n={n} />)}
          </div>
        </>
      )}

      <RecentActivity />
      </div></div>

      <Sheet open={menu} onClose={() => setMenu(false)} title="Menu">
        {BETA && <MenuLink icon={<IMail width={18} height={18} />} title="Donner mon avis" sub="Un bug, une idée ? Ça m'arrive directement" to="avis" close={() => setMenu(false)} />}
        <MenuLink icon={<IReceipt width={18} height={18} />} title="Dépenses et justificatifs" sub="Liste, catégories, photos de tickets" to="depenses" close={() => setMenu(false)} />
        <MenuLink icon={<ITag width={18} height={18} />} title="Annonce IA" sub="Titre, description et prix à partir de tes photos" to="annonce" close={() => setMenu(false)} />
        <MenuLink icon={<ITag width={18} height={18} />} title="Photos IA" sub="Prompts pour des photos réalistes" to="photos" close={() => setMenu(false)} />
        <MenuLink icon={<IMail width={18} height={18} />} title="Messages prêts" sub="Remerciement, relance, contre-offre…" to="messages" close={() => setMenu(false)} />
        <MenuLink icon={<ITrend width={18} height={18} />} title="À republier" sub="Articles qui ne bougent pas" to="republier" close={() => setMenu(false)} />
        <MenuLink icon={<IChartBar width={18} height={18} />} title="Résumé du mois" sub="Ton mois en une image" to="resume" close={() => setMenu(false)} />
        <MenuLink icon={<IReceipt width={18} height={18} />} title="Bordereaux à imprimer" sub="Tous tes bordereaux Vinted en un seul PDF" to="bordereaux" close={() => setMenu(false)} />
        <MenuLink icon={<IMail width={18} height={18} />} title="Synchro Vinted (Gmail)" sub={ds.settings.syncUrl ? 'Active : ventes et achats enregistrés seuls' : 'Enregistre tes ventes sans les saisir'} to="synchro" close={() => setMenu(false)} />
        <MenuLink icon={<ITarget width={18} height={18} />} title="Objectifs" sub="Bénéfice, ventes, budget, stock" to="objectifs" close={() => setMenu(false)} />
        <MenuLink icon={<IChartBar width={18} height={18} />} title="Statistiques" sub="Meilleurs jours, marques, tailles, délai de vente" to="statistiques" close={() => setMenu(false)} />
        <MenuLink icon={<ITrend width={18} height={18} />} title="Prévisions" sub="Trésorerie et résultat à 30, 60, 90 jours" to="previsions" close={() => setMenu(false)} />
        <MenuLink icon={<IScale width={18} height={18} />} title="Fiscalité" sub="Recettes, seuils, cotisations, livre des recettes" to="fiscal" close={() => setMenu(false)} />
        <MenuLink icon={<ICalc width={18} height={18} />} title="Calculateur de prix" sub="Simule un prix avant de publier" to="calculateur" close={() => setMenu(false)} />
        <MenuLink icon={<IWallet width={18} height={18} />} title="Trésorerie et réinvestissement" sub="Mouvements, réserve, budget d'achat" to="tresorerie" close={() => setMenu(false)} />
        <MenuLink icon={<IDownload width={18} height={18} />} title="Exports, import et sauvegarde" sub="Excel, PDF, CSV, import d'un ancien suivi" to="exports" close={() => setMenu(false)} />
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

function MenuLink({ icon, title, sub, to, close }: { icon: React.ReactNode; title: string; sub: string; to: string; close: () => void }) {
  const locked = isLocked(to);
  return (
    <button className={`menu-item${locked ? ' locked' : ''}`} onClick={() => { close(); go(to); }}>
      <span className="dot out">{icon}</span>
      <span style={{ flex: 1 }}><div className="mi-title">{title}{locked && ' 🔒'}</div><div className="mi-sub">{locked ? 'Version complète' : sub}</div></span>
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

/** Version bêta : données d'exemple et appel à donner son avis. */
function BetaCards({ demo }: { demo: boolean }) {
  const ui = useUI();
  return (
    <div style={{ display: 'grid', gap: 8, margin: '0 0 12px' }}>
      {demo && (
        <div className="alert warn" style={{ display: 'block' }}>
          <b>Données d'exemple</b> — tout ce que tu vois est inventé pour tester l'appli.
          <button className="btn btn-sm btn-ghost" style={{ marginTop: 8, display: 'flex' }} onClick={async () => {
            if (await ui.confirm({ title: 'Commencer avec tes données ?', text: "L'exemple sera effacé et tu pourras configurer ton propre suivi.", confirmLabel: "Effacer l'exemple" })) await leaveDemo();
          }}>Commencer avec mes données</button>
        </div>
      )}
      <button className="beta-card" onClick={() => go('avis')}>
        <span style={{ fontSize: 26 }}>💬</span>
        <span style={{ flex: 1, textAlign: 'left' }}><b>Tu testes la bêta</b><br /><span className="small muted">Un bug, une idée, un truc pas clair ? Dis-le-moi.</span></span>
        <IChevron />
      </button>
    </div>
  );
}
