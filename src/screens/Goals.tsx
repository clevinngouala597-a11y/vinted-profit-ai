import { useState } from 'react';
import { saveGoal } from '../lib/actions';
import { goalProgress, type GoalLine } from '../lib/engine';
import { centsToInput, formatEuros, formatPercent, parseEuros } from '../lib/money';
import { addMonths, formatMonth, todayISO } from '../lib/period';
import { useData } from '../lib/useData';
import { IBack, IChevron } from '../ui/icons';
import { cents, Empty, ErrorBox, Field, MoneyInput, PageHeader, Sheet, useAction, useUI } from '../ui/kit';

const fmt = (l: Pick<GoalLine, 'unit'>, v: number) =>
  l.unit === 'eur' ? formatEuros(v) : l.unit === 'pct' ? formatPercent(v) : `${v}`;

const STATUS: Record<GoalLine['status'], [string, string]> = {
  atteint: ['Atteint', 'green'],
  en_cours: ['En cours', ''],
  en_retard: ['En retard', 'warn'],
  respecte: ['Respecté', 'green'],
  depasse: ['Dépassé', 'red'],
};

export function Goals() {
  const ds = useData();
  const today = todayISO();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [edit, setEdit] = useState(false);
  const p = goalProgress(ds, month, today);
  const isCurrent = month === current;

  return (
    <>
      <PageHeader title="Objectifs" sub="Suivi mois par mois" backTo="" />
      <div className="row-between" style={{ margin: '0 0 6px', alignItems: 'center' }}>
        <button className="icon-btn" aria-label="Mois précédent" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}><IBack /></button>
        <b style={{ fontSize: 17, textTransform: 'capitalize' }}>{formatMonth(`${month}-01`)}</b>
        <button className="icon-btn" aria-label="Mois suivant" disabled={month > current} style={month > current ? { opacity: 0.3 } : undefined} onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}><IChevron /></button>
      </div>
      <p className="small muted" style={{ textAlign: 'center', marginTop: 0 }}>
        {!p.goal.inherited ? 'Objectifs propres à ce mois.' : p.goal.from === 'reglages' ? 'Objectifs repris de ta configuration initiale.' : `Objectifs repris de ${formatMonth(`${p.goal.from}-01`)}.`}
        {isCurrent && ` Jour ${p.elapsed} sur ${p.days}.`}
      </p>

      {p.lines.length === 0 ? (
        <Empty title="Aucun objectif pour ce mois" text="Fixe un bénéfice, un nombre de ventes ou un budget d'achat pour suivre ta progression." action={<button className="btn btn-primary" onClick={() => setEdit(true)}>Définir les objectifs</button>} />
      ) : (
        <>
          {p.lines.map((l) => <GoalCard key={l.key} l={l} isCurrent={isCurrent} />)}
          <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => setEdit(true)}>Modifier les objectifs de ce mois</button>
          {isCurrent && p.elapsed < 7 && <p className="tiny faint">L'estimation de fin de mois apparaît à partir du 7e jour, quand le rythme devient significatif.</p>}
        </>
      )}
      {edit && <GoalSheet month={month} onClose={() => setEdit(false)} />}
    </>
  );
}

function GoalCard({ l, isCurrent }: { l: GoalLine; isCurrent: boolean }) {
  const [label, tone] = STATUS[l.status];
  const over = l.kind === 'max' && l.status === 'depasse';
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row-between">
        <b>{l.label}</b>
        <span className={`badge ${tone}`}>{label}</span>
      </div>
      <div className="row-between" style={{ marginTop: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 800 }} className={over ? 'neg' : ''}>{fmt(l, l.current)}</span>
        <span className="muted small">{l.kind === 'max' ? 'maximum' : 'objectif'} {fmt(l, l.target)}</span>
      </div>
      <div className="progress"><div style={{ width: `${l.progress * 100}%`, background: over ? 'var(--loss)' : l.kind === 'max' ? 'var(--warn)' : undefined }} /></div>
      <div className="small muted">
        {l.kind === 'min'
          ? l.remaining > 0 ? `Reste ${fmt(l, l.remaining)}` : 'Objectif atteint'
          : over ? `Dépassement de ${fmt(l, l.current - l.target)}` : `Encore ${fmt(l, l.remaining)} disponibles`}
        {l.projection !== null && isCurrent && (
          <> · au rythme actuel : <b className={(l.kind === 'min' ? l.projection < l.target : l.projection > l.target) ? 'warn' : ''}>{fmt(l, l.projection)}</b> en fin de mois</>
        )}
      </div>
    </div>
  );
}

function GoalSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const ds = useData();
  const ui = useUI();
  const g = goalProgress(ds, month, todayISO()).goal;
  const m = (c: number) => (c ? centsToInput(c) : '');
  const i = (n: number) => (n ? String(n) : '');
  const [f, setF] = useState({
    revenue: m(g.revenue), profit: m(g.profit), maxPurchases: m(g.maxPurchases), cashToKeep: m(g.cashToKeep),
    salesCount: i(g.salesCount), maxStockCount: i(g.maxStockCount), minMargin: i(g.minMargin),
  });
  const { error, run, busy } = useAction();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const num = (k: keyof typeof f) => (v: string) => set(k)(v.replace(/[^\d]/g, '').slice(0, 5));

  const save = async () => {
    const ok = await run(async () => {
      for (const k of ['revenue', 'profit', 'maxPurchases', 'cashToKeep'] as const)
        if (f[k].trim() && parseEuros(f[k]) === null) throw new Error('Un des montants saisis est invalide.');
      await saveGoal(month, {
        revenue: cents(f.revenue), profit: cents(f.profit), maxPurchases: cents(f.maxPurchases), cashToKeep: cents(f.cashToKeep),
        salesCount: Number(f.salesCount || 0), maxStockCount: Number(f.maxStockCount || 0), minMargin: Number(f.minMargin || 0),
      });
      return true;
    });
    if (ok) { ui.toast('Objectifs enregistrés'); onClose(); }
  };

  return (
    <Sheet open onClose={onClose} title={`Objectifs de ${formatMonth(`${month}-01`)}`}>
      <p className="muted small" style={{ marginTop: 0 }}>Laisse vide ce que tu ne veux pas suivre. Les mois suivants reprendront ces objectifs tant que tu ne les changes pas ; les mois passés gardent les leurs.</p>
      <ErrorBox error={error} />
      <div className="cols">
        <Field label="Chiffre d'affaires"><MoneyInput value={f.revenue} onChange={set('revenue')} /></Field>
        <Field label="Bénéfice commercial"><MoneyInput value={f.profit} onChange={set('profit')} /></Field>
        <Field label="Articles vendus"><input className="input" inputMode="numeric" value={f.salesCount} onChange={(e) => num('salesCount')(e.target.value)} placeholder="0" /></Field>
        <Field label="Marge minimale (%)"><input className="input" inputMode="numeric" value={f.minMargin} onChange={(e) => num('minMargin')(e.target.value)} placeholder="0" /></Field>
        <Field label="Budget d'achat max"><MoneyInput value={f.maxPurchases} onChange={set('maxPurchases')} /></Field>
        <Field label="Stock max (articles)" hint="Pour réduire le stock"><input className="input" inputMode="numeric" value={f.maxStockCount} onChange={(e) => num('maxStockCount')(e.target.value)} placeholder="0" /></Field>
      </div>
      <Field label="Trésorerie à conserver"><MoneyInput value={f.cashToKeep} onChange={set('cashToKeep')} /></Field>
      <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer les objectifs</button>
    </Sheet>
  );
}
