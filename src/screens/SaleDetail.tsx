import { useState } from 'react';
import { isLocked } from '../lib/beta';
import { changeSaleStatus, completeItemCost, correctSale, deleteSale, markItemRecovered, markPaymentReceived, recordRefund, updateItem } from '../lib/actions';
import { isAwaitingPayment, saleBreakdown } from '../lib/engine';
import { centsToInput, formatEuros, formatPercent, parseEuros } from '../lib/money';
import { formatDate, todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { ORDER_LABEL } from '../lib/types';
import type { SaleStatusChoice } from '../lib/actions';
import { cents, Empty, ErrorBox, Field, MoneyInput, PageHeader, Sheet, Thumb, useAction, useUI } from '../ui/kit';
import { orderBadge } from './Sales';

export function SaleDetail({ id }: { id: string }) {
  const ds = useData();
  const ui = useUI();
  const sale = ds.sales.find((s) => s.id === id);
  const [refundOpen, setRefundOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const { error, run, busy } = useAction();
  if (!sale) return (<><PageHeader title="Vente" backTo="ventes" /><Empty title="Vente introuvable" text="Elle a peut-être été remplacée lors d'une restauration." action={<button className="btn btn-ghost" onClick={() => go('ventes')}>Retour aux ventes</button>} /></>);

  const b = saleBreakdown(ds, sale);
  const items = b.lines.map((l) => ({ line: l, item: ds.items.find((i) => i.id === l.itemId) }));
  const refunds = ds.refunds.filter((r) => r.saleId === id).sort((a, c) => a.date.localeCompare(c.date));
  const linked = ds.expenses.filter((e) => e.saleId === id);
  const active = !b.cancelled && !['retournee', 'remboursee'].includes(sale.orderStatus);
  const remaining = sale.sellerRevenue - b.refunded;
  const pendingRecovery = refunds.find((r) => !r.itemRecovered);
  const recovered = refunds.some((r) => r.itemRecovered);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    const ok = await run(async () => { await fn(); return true; });
    if (ok) ui.toast(msg);
  };

  return (
    <>
      <PageHeader title={items.length > 1 ? `Vente de ${items.length} articles` : items[0]?.item?.name ?? 'Vente'} sub={`Commande du ${formatDate(sale.date)}`} backTo="ventes" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span className={`badge ${orderBadge(sale.orderStatus)}`}>{ORDER_LABEL[sale.orderStatus]}</span>
        {sale.paymentStatus === 'recu' && <span className="badge green">Paiement reçu</span>}
        {isAwaitingPayment(ds, sale) && <span className="badge warn">Paiement en attente</span>}
        {b.isLoss && !b.cancelled && <span className="badge red">Vente à perte</span>}
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '4px 14px', minHeight: 0 }} onClick={() => setFixOpen(true)}>✏️ Modifier</button>
      </div>
      <ErrorBox error={error} />

      <StatusPicker saleId={id} />

      <section className="hero" style={{ marginTop: 14 }}>
        <div className="hero-label">Bénéfice commercial</div>
        <div className="hero-amount" style={{ fontSize: 44 }}><span className={b.profit < 0 ? 'neg' : b.profit > 0 ? 'pos' : ''}>{formatEuros(b.profit, { signed: true })}</span></div>
        <div className="hero-meta"><span>Marge <b>{formatPercent(b.margin)}</b></span><span>ROI <b>{formatPercent(b.roi)}</b></span></div>
      </section>

      <h2>Calcul</h2>
      <div className="calc">
        {sale.listedPrice > 0 && <div className="calc-row"><span>Prix affiché</span><span>{formatEuros(sale.listedPrice)}</span></div>}
        {sale.discount > 0 && <div className="calc-row"><span>Réduction accordée</span><span>− {formatEuros(sale.discount)}</span></div>}
        <div className="calc-row"><span>Montant encaissé</span><span>{formatEuros(b.revenue)}</span></div>
        {b.refunded > 0 && <div className="calc-row"><span>Remboursé</span><span className="neg">− {formatEuros(b.refunded)}</span></div>}
        <div className="calc-row"><span>Coût de revient{b.cogsRecovered ? ' (articles non récupérés)' : ''}</span><span>− {formatEuros(b.cogs)}</span></div>
        <div className="calc-row"><span>Coûts de vente et dépenses liées</span><span>− {formatEuros(b.directCosts)}</span></div>
        <div className="calc-row total"><span>Bénéfice commercial</span><span className={b.profit < 0 ? 'neg' : 'pos'}>{formatEuros(b.profit, { signed: true })}</span></div>
      </div>
      {b.cancelled && <p className="small muted">Vente annulée le {formatDate(sale.cancelledAt)} : seuls les frais déjà engagés restent comptés.</p>}

      <h2>Articles</h2>
      <div className="list">
        {items.map(({ line, item }) => (
          <button key={line.id} className="li" onClick={() => item && go(`stock/${item.id}`)}>
            <Thumb photoId={item?.photoIds[0]} name={item?.name ?? '?'} />
            <span className="li-main"><div className="li-title">{item?.name ?? 'Article supprimé'}</div><div className="li-sub">coût {formatEuros(line.cogs)} · revenu attribué {formatEuros(line.revenue)}</div></span>
            <span className="li-end li-amount"><span className={line.revenue - line.cogs - line.costs < 0 ? 'neg' : 'pos'}>{formatEuros(line.revenue - line.cogs - line.costs, { signed: true })}</span></span>
          </button>
        ))}
      </div>
      {items.length > 1 && <p className="tiny faint">Vente groupée : le montant et les frais sont répartis selon le prix souhaité de chaque article (à défaut, selon leur coût).</p>}

      {(active || pendingRecovery) && (
        <>
          <h2>Actions</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {isAwaitingPayment(ds, sale) && (
              <button className="btn btn-primary" disabled={busy} onClick={() => act(() => markPaymentReceived(id, todayISO()), 'Paiement reçu : trésorerie mise à jour')}>Paiement reçu</button>
            )}
            {pendingRecovery && !recovered && (
              <button className="btn btn-ghost" disabled={busy} onClick={async () => {
                if (await ui.confirm({ title: "As-tu récupéré l'article ?", text: 'Il reviendra dans ton stock et son coût sera retiré du coût des ventes.', confirmLabel: 'Oui, article récupéré' }))
                  act(() => markItemRecovered(pendingRecovery.id, todayISO()), 'Article remis en stock');
              }}>Article retourné et récupéré</button>
            )}
            {active && remaining > 0 && <button className="btn btn-ghost" onClick={() => setRefundOpen(true)}>Enregistrer un retour ou un remboursement</button>}
            {active && !isLocked('messages') && <button className="btn btn-ghost" onClick={() => go(`messages?vente=${id}`)}>💬 Message à l'acheteur</button>}
            {active && <button className="btn btn-ghost" onClick={() => go(`depense?vente=${id}`)}>Ajouter une dépense liée à cette vente</button>}
          </div>
        </>
      )}

      {(refunds.length > 0 || linked.length > 0) && (
        <>
          <h2>Ajustements</h2>
          <div className="list">
            {refunds.map((r) => (
              <div className="li" key={r.id}>
                <span className="li-main"><div className="li-title">Remboursement</div><div className="li-sub">{formatDate(r.date)} · {r.itemRecovered ? `article récupéré le ${formatDate(r.recoveredAt)}` : 'article non récupéré'}{r.extraCosts ? ` · frais de retour ${formatEuros(r.extraCosts)}` : ''}</div></span>
                <span className="li-end li-amount neg">− {formatEuros(r.amount)}</span>
              </div>
            ))}
            {linked.map((e) => (
              <div className="li" key={e.id}>
                <span className="li-main"><div className="li-title">{e.description || e.category}</div><div className="li-sub">{formatDate(e.date)} · dépense liée</div></span>
                <span className="li-end li-amount">− {formatEuros(e.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Suivi</h2>
      <dl className="card kv">
        <dt>Commande</dt><dd>{formatDate(sale.date)}</dd>
        <dt>Expédition</dt><dd>{formatDate(sale.shippedAt)}</dd>
        <dt>Clôture</dt><dd>{formatDate(sale.closedAt)}</dd>
        {sale.notes && <><dt>Notes</dt><dd style={{ textAlign: 'left', fontWeight: 400, whiteSpace: 'pre-wrap' }}>{sale.notes}</dd></>}
      </dl>

      <button className="btn btn-ghost" style={{ marginTop: 12, width: '100%' }} onClick={() => setFixOpen(true)}>✏️ Modifier la vente</button>
      {fixOpen && <EditSaleSheet saleId={id} onClose={() => setFixOpen(false)} />}
      {refundOpen && <RefundSheet saleId={id} max={remaining} onClose={() => setRefundOpen(false)} />}
    </>
  );
}

function RefundSheet({ saleId, max, onClose }: { saleId: string; max: number; onClose: () => void }) {
  const ui = useUI();
  const [amount, setAmount] = useState(centsToInput(max));
  const [date, setDate] = useState(todayISO());
  const [recovered, setRecovered] = useState(false);
  const [extra, setExtra] = useState('');
  const [notes, setNotes] = useState('');
  const { error, run, busy } = useAction();
  return (
    <Sheet open onClose={onClose} title="Retour ou remboursement">
      <p className="muted small" style={{ marginTop: 0 }}>La vente d'origine est conservée ; le remboursement s'ajoute en ajustement.</p>
      <ErrorBox error={error} />
      <div className="cols">
        <Field label="Montant remboursé" hint={`Maximum ${formatEuros(max)}`}><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Date"><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Frais de retour à ta charge" hint="Non récupérables : ils restent dans le coût de la vente."><MoneyInput value={extra} onChange={setExtra} /></Field>
      <label className="check">
        <input type="checkbox" checked={recovered} onChange={(e) => setRecovered(e.target.checked)} />
        <span><b>J'ai déjà récupéré l'article</b><br /><span className="small muted">Sinon, il ne revient en stock que quand tu confirmes sa récupération.</span></span>
      </label>
      <Field label="Notes"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motif du retour…" /></Field>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        const ok = await run(async () => {
          const a = parseEuros(amount);
          if (a === null) throw new Error("Le montant remboursé n'est pas valide.");
          if (extra.trim() && parseEuros(extra) === null) throw new Error("Les frais de retour ne sont pas un montant valide.");
          await recordRefund({ saleId, date, amount: a, itemRecovered: recovered, extraCosts: cents(extra), notes });
          return true;
        });
        if (ok) { ui.toast(recovered ? 'Remboursement enregistré, article remis en stock' : 'Remboursement enregistré'); onClose(); }
      }}>Enregistrer le remboursement</button>
    </Sheet>
  );
}

function EditSaleSheet({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const ds = useData();
  const ui = useUI();
  const sale = ds.sales.find((x) => x.id === saleId)!;
  const cancelled = sale.orderStatus === 'annulee';
  const hasRefund = ds.refunds.some((r) => r.saleId === saleId);
  const lines = ds.saleLines.filter((l) => l.saleId === saleId);
  const items = lines.map((l) => ds.items.find((i) => i.id === l.itemId)).filter((x): x is NonNullable<typeof x> => !!x);
  const [names, setNames] = useState(() => Object.fromEntries(items.map((i) => [i.id, i.name])));
  const [costs, setCosts] = useState(() => Object.fromEntries(items.map((i) => [i.id, i.costPending ? '' : centsToInput(i.purchasePrice + i.directFees)])));
  const [f, setF] = useState({
    date: sale.date,
    sellerRevenue: centsToInput(sale.sellerRevenue),
    platformFees: centsToInput(sale.platformFees),
    packagingCost: centsToInput(sale.packagingCost),
    otherCosts: centsToInput(sale.otherCosts),
  });
  const { error, run, busy } = useAction();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  const save = async () => {
    const ok = await run(async () => {
      // tout est vérifié avant la moindre modification
      const newCosts: Record<string, number> = {};
      for (const it of items) {
        if (!names[it.id]?.trim()) throw new Error("Le nom de l'article ne peut pas être vide.");
        if (costs[it.id].trim() === '') continue;
        const c = parseEuros(costs[it.id]);
        if (c === null || c < 0) throw new Error(`Prix d'achat invalide pour « ${names[it.id]} ».`);
        newCosts[it.id] = c;
      }
      const vals = {} as Record<'sellerRevenue' | 'platformFees' | 'packagingCost' | 'otherCosts', number>;
      if (!cancelled)
        for (const k of ['sellerRevenue', 'platformFees', 'packagingCost', 'otherCosts'] as const) {
          const v = f[k].trim() === '' ? 0 : parseEuros(f[k]);
          if (v === null) throw new Error('Un des montants saisis est invalide.');
          vals[k] = v;
        }
      for (const it of items) {
        if (names[it.id].trim() !== it.name) await updateItem(it.id, { name: names[it.id].trim() });
        if (newCosts[it.id] !== undefined && (it.costPending || newCosts[it.id] !== it.purchasePrice + it.directFees)) await completeItemCost(it.id, newCosts[it.id]);
      }
      if (!cancelled) await correctSale(saleId, { date: f.date, ...vals }, 'Modification manuelle');
      return true;
    });
    if (ok) { ui.toast('Vente modifiée'); onClose(); }
  };

  const remove = async () => {
    const ok = await ui.confirm({
      title: 'Supprimer cette vente ?',
      text: "À utiliser si elle a été enregistrée par erreur : elle disparaît du chiffre d'affaires, du bénéfice et de la trésorerie, et la synchro ne la recréera pas.",
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const done = await run(async () => { await deleteSale(saleId); return true; });
    if (done) { ui.toast('Vente supprimée'); onClose(); go('ventes'); }
  };

  return (
    <Sheet open onClose={onClose} title="Modifier la vente">
      <ErrorBox error={error} />
      {items.map((it) => (
        <div key={it.id} className="line-card" style={{ paddingBottom: 6 }}>
          <Field label="Nom de l'article"><input className="input" value={names[it.id]} onChange={(e) => setNames({ ...names, [it.id]: e.target.value })} /></Field>
          <Field label="Prix d'achat" hint={it.costPending ? 'Pas encore indiqué.' : undefined}><MoneyInput value={costs[it.id]} onChange={(v) => setCosts({ ...costs, [it.id]: v })} /></Field>
        </div>
      ))}
      {!cancelled && (
        <>
          <div className="cols">
            <Field label="Date de la vente"><input type="date" className="input" value={f.date} max={todayISO()} onChange={(e) => set('date')(e.target.value)} /></Field>
            <Field label="Montant encaissé"><MoneyInput value={f.sellerRevenue} onChange={set('sellerRevenue')} /></Field>
            <Field label="Frais à ta charge"><MoneyInput value={f.platformFees} onChange={set('platformFees')} /></Field>
            <Field label="Emballage"><MoneyInput value={f.packagingCost} onChange={set('packagingCost')} /></Field>
          </div>
          <Field label="Autres coûts"><MoneyInput value={f.otherCosts} onChange={set('otherCosts')} /></Field>
        </>
      )}
      <p className="tiny faint" style={{ marginTop: 0 }}>Le bénéfice et la trésorerie sont recalculés ; l'avant/après reste dans le journal.</p>
      <button className="btn btn-primary" disabled={busy} onClick={save}>Enregistrer</button>
      {!hasRefund && <button className="btn btn-danger" style={{ marginTop: 10, width: '100%' }} disabled={busy} onClick={remove}>Supprimer cette vente</button>}
    </Sheet>
  );
}

const STATUS_CHOICES: [SaleStatusChoice, string][] = [
  ['confirmee', 'À confirmer'],
  ['expediee', 'Expédiée'],
  ['terminee', 'Terminée'],
  ['annulee', 'Annulée'],
  ['remboursee', 'Remboursée'],
];

/** Statut de la vente, modifiable d'un toucher (dans les deux sens). */
function StatusPicker({ saleId }: { saleId: string }) {
  const ds = useData();
  const ui = useUI();
  const sale = ds.sales.find((x) => x.id === saleId)!;
  const { error, run, busy } = useAction();
  const current: SaleStatusChoice = ['retournee', 'remboursee'].includes(sale.orderStatus) ? 'remboursee' : sale.orderStatus === 'en_attente' ? 'confirmee' : (sale.orderStatus as SaleStatusChoice);
  const pick = async (to: SaleStatusChoice) => {
    if (to === current || busy) return;
    const texts: Partial<Record<SaleStatusChoice, { title: string; text: string }>> = {
      annulee: { title: 'Marquer comme annulée ?', text: "La vente ne compte plus dans le chiffre d'affaires ni le bénéfice ; l'article revient chez toi." },
      remboursee: { title: 'Marquer comme remboursée ?', text: "L'acheteur est remboursé en totalité et l'article revient chez toi : la vente ne rapporte plus rien." },
      terminee: { title: 'Marquer comme terminée ?', text: 'Le paiement est considéré comme reçu sur ton porte-monnaie Vinted.' },
    };
    const t = texts[to];
    if (t && !(await ui.confirm({ ...t, confirmLabel: 'Confirmer', danger: to === 'annulee' || to === 'remboursee' }))) return;
    const ok = await run(async () => { await changeSaleStatus(saleId, to, todayISO()); return true; });
    if (ok) ui.toast(`Statut : ${STATUS_CHOICES.find(([k]) => k === to)![1]}`);
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="tiny faint" style={{ marginBottom: 6 }}>Statut (touche pour changer)</div>
      <div className="chips" role="group" aria-label="Statut de la vente" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
        {STATUS_CHOICES.map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={current === k} disabled={busy} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
