import { useLiveQuery } from 'dexie-react-hooks';
import { defaultShopFor } from '../lib/shops';
import { ShopField } from '../ui/ShopPicker';
import { useState } from 'react';
import { getDb } from '../lib/db';
import { deleteExpense, findDuplicateExpenses, recordExpense, savePhoto } from '../lib/actions';
import { compressImage } from '../lib/images';
import { centsToInput, formatEuros, parseEuros } from '../lib/money';
import type { ReceiptGuess } from '../lib/receipt';
import { formatDate, todayISO } from '../lib/period';
import { go, queryParam } from '../lib/router';
import { useData } from '../lib/useData';
import { EXPENSE_CATEGORIES, type Expense } from '../lib/types';
import { BarList } from '../ui/charts';
import { cents, Empty, ErrorBox, Field, MoneyInput, PageHeader, Sheet, useAction, usePhotoUrl, useUI } from '../ui/kit';
import { PeriodPicker, usePeriod } from './PeriodPicker';

export function Expenses() {
  const ds = useData();
  const p = usePeriod();
  const [open, setOpen] = useState<Expense | null>(null);
  const list = ds.expenses.filter((e) => e.date >= p.range.from && e.date <= p.range.to).sort((a, b) => b.date.localeCompare(a.date));
  const total = list.reduce((a, e) => a + e.amount, 0);
  const byCat = [...list.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + e.amount), new Map<string, number>())]
    .map(([name, v]) => ({ name, v }))
    .sort((a, b) => b.v - a.v);

  return (
    <>
      <PageHeader title="Dépenses" sub={`${formatEuros(total)} sur la période`} backTo="" right={<button className="btn btn-primary btn-sm" onClick={() => go('depense')}>Ajouter</button>} />
      <PeriodPicker p={p} />
      <p className="tiny muted">Les achats d'articles ne sont pas des dépenses : enregistre-les comme achats, leur coût est imputé au moment de la vente.</p>
      {byCat.length > 0 && (
        <div className="card" style={{ marginTop: 6 }}>
          <BarList rows={byCat} valueOf={(r) => r.v as number} format={(r) => formatEuros(r.v as number)} />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        {list.length === 0 ? (
          <Empty title="Aucune dépense sur cette période" text="Ajoute tes emballages, ton matériel photo ou tes trajets pour obtenir un résultat réaliste." action={<button className="btn btn-primary" onClick={() => go('depense')}>Ajouter une dépense</button>} />
        ) : (
          <div className="list">
            {list.map((e) => (
              <button key={e.id} className="li" onClick={() => setOpen(e)}>
                <span className="dot out">{e.attachmentId ? '✓' : '€'}</span>
                <span className="li-main"><div className="li-title">{e.description || e.category}</div><div className="li-sub">{formatDate(e.date)} · {e.category}{e.saleId ? ' · liée à une vente' : ''}{e.attachmentId ? '' : ' · sans justificatif'}</div></span>
                <span className="li-end li-amount">− {formatEuros(e.amount)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {open && <ExpenseSheet e={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ExpenseSheet({ e, onClose }: { e: Expense; onClose: () => void }) {
  const ui = useUI();
  const ds = useData();
  const url = usePhotoUrl(e.attachmentId ?? undefined);
  const att = useLiveQuery(() => (e.attachmentId ? getDb().attachments.get(e.attachmentId) : undefined), [e.attachmentId]);
  const mime = att?.mime === 'application/pdf' ? 'pdf' : '';
  return (
    <Sheet open onClose={onClose} title={e.description || e.category}>
      <dl className="kv">
        <dt>Montant</dt><dd>{formatEuros(e.amount)}</dd>
        <dt>Date</dt><dd>{formatDate(e.date)}</dd>
        <dt>Catégorie</dt><dd>{e.category}</dd>
        <dt>Fournisseur</dt><dd>{e.supplier || '—'}</dd>
        <dt>Traitement</dt><dd>{e.saleId ? 'Coût de la vente liée' : 'Frais général'}</dd>
      </dl>
      {url && (
        <div style={{ marginTop: 12 }}>
          {!mime && <img src={url} alt="Justificatif" className="photo-view" />}
          {mime &&<a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">Ouvrir le justificatif (PDF)</a>}
        </div>
      )}
      <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        {e.saleId && ds.sales.some((s) => s.id === e.saleId) && <button className="btn btn-ghost" onClick={() => { onClose(); go(`ventes/${e.saleId}`); }}>Voir la vente liée</button>}
        <button className="btn btn-danger" onClick={async () => {
          if (await ui.confirm({ title: 'Annuler cette dépense ?', text: 'À utiliser pour une erreur de saisie. Le mouvement de trésorerie est annulé et l’opération reste tracée dans le journal.', confirmLabel: 'Annuler la dépense', danger: true })) {
            await deleteExpense(e.id);
            ui.toast('Dépense annulée');
            onClose();
          }
        }}>Annuler la dépense</button>
      </div>
    </Sheet>
  );
}

export function ExpenseForm() {
  const ds = useData();
  const [shop, setShop] = useState(() => defaultShopFor(ds.settings));
  const ui = useUI();
  const linkedSale = queryParam('vente');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(linkedSale ? 'Emballages' : EXPENSE_CATEGORIES[0]);
  const [supplier, setSupplier] = useState('');
  const [description, setDescription] = useState('');
  const [saleId, setSaleId] = useState(linkedSale ?? '');
  const [file, setFile] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState('');
  const [ocr, setOcr] = useState<ReceiptGuess | null>(null);
  const [reading, setReading] = useState<number | null>(null);
  const readTicket = () => run(async () => {
    if (!file) return;
    setReading(0);
    try {
      const { ocrImage, parseReceiptText } = await import('../lib/receipt');
      let text: string;
      try {
        text = await ocrImage(file, setReading);
      } catch {
        throw new Error('La lecture du ticket a échoué. Au premier usage, une connexion internet est nécessaire pour télécharger le moteur de lecture.');
      }
      const g = parseReceiptText(text, todayISO());
      setOcr(g);
      // on ne remplace jamais ce que l'utilisateur a déjà saisi
      if (g.amount !== null && !amount.trim()) setAmount(centsToInput(g.amount));
      if (g.date) setDate(g.date);
      if (g.supplier && !supplier.trim()) setSupplier(g.supplier);
    } finally {
      setReading(null);
    }
  });
  const { error, run, busy } = useAction();
  const names = new Map(ds.items.map((i) => [i.id, i.name]));
  const recentSales = ds.sales.filter((s) => s.orderStatus !== 'annulee').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  const submit = async () => {
    const a = parseEuros(amount);
    if (a === null || a <= 0) return run(async () => { throw new Error('Indique un montant supérieur à 0.'); });
    const dups = findDuplicateExpenses(ds.expenses, { amount: a, date, supplier, category });
    if (dups.length && !(await ui.confirm({ title: 'Dépense en double ?', text: `Une dépense de ${formatEuros(a)} existe déjà le ${formatDate(dups[0].date)} (${dups[0].description || dups[0].category}). L'enregistrer quand même ?`, confirmLabel: 'Enregistrer quand même' }))) return;
    const ok = await run(async () => {
      const attachmentId = file ? await savePhoto(file) : null;
      await recordExpense({ date, amount: a, category, supplier, description, saleId: saleId || null, attachmentId, ...(saleId ? {} : { shop }) });
      return true;
    });
    if (ok) {
      ui.toast('Dépense enregistrée');
      if (linkedSale) go(`ventes/${linkedSale}`);
      else go('depenses');
    }
  };

  return (
    <>
      <PageHeader title="Nouvelle dépense" sub="Hors achats d'articles" backTo="" />
      <ErrorBox error={error} />
      <Field label="Ticket ou facture (photo ou PDF)" hint="Commence par la photo : je peux lire le montant, la date et le magasin pour toi.">
        <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
          {fileName || 'Ajouter un justificatif'}
          <input type="file" accept="image/*,application/pdf" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setOcr(null);
            await run(async () => {
              if (f.size > 10 * 1024 * 1024 && f.type === 'application/pdf') throw new Error('PDF trop lourd (10 Mo maximum).');
              setFile(f.type.startsWith('image/') ? await compressImage(f) : f);
              setFileName(f.name);
            });
          }} />
        </label>
      </Field>
      {file && file.type.startsWith('image/') && !ocr && (
        <button className="btn btn-primary" style={{ marginBottom: 12 }} disabled={reading !== null} onClick={readTicket}>
          {reading === null ? 'Lire le ticket' : `Lecture du ticket… ${Math.round(reading * 100)} %`}
        </button>
      )}
      {ocr && (
        <div className={`alert ${ocr.amount === null ? 'error' : ocr.amountConfidence === 'haute' ? 'ok' : 'warn'}`} role="status">
          <span>
            {ocr.amount === null
              ? "Je n'ai pas trouvé de montant sur ce ticket : saisis-le à la main."
              : <>Montant lu : <b>{formatEuros(ocr.amount)}</b>{ocr.amountConfidence === 'haute' ? ' (total confirmé par le paiement)' : ocr.amountConfidence === 'moyenne' ? ' (ligne « total » trouvée)' : ' (incertain : vérifie bien)'}.
                {ocr.date && <> Date : {formatDate(ocr.date)}.</>}{ocr.supplier && <> Magasin : {ocr.supplier}.</>} Vérifie les champs avant d'enregistrer.</>}
            {ocr.candidates.length > 1 && (
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {ocr.candidates.slice(0, 4).map((c) => (
                  <button key={c} className="chip" aria-pressed={cents(amount) === c} onClick={() => setAmount(centsToInput(c))}>{formatEuros(c)}</button>
                ))}
              </span>
            )}
          </span>
        </div>
      )}
      <ShopField value={shop} onChange={setShop} />
      <div className="cols">
        <Field label="Montant"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Date"><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Catégorie">
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </Field>
      <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Lot de 50 enveloppes" /></Field>
      <Field label="Fournisseur (facultatif)"><input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
      <Field label="Liée à une vente" hint="Une dépense liée devient un coût de cette vente et n'est pas comptée une seconde fois en frais généraux.">
        <select className="input" value={saleId} onChange={(e) => setSaleId(e.target.value)}>
          <option value="">Non, frais général</option>
          {recentSales.map((s) => (
            <option key={s.id} value={s.id}>
              {formatDate(s.date)} · {ds.saleLines.filter((l) => l.saleId === s.id).map((l) => names.get(l.itemId)).join(', ')}
            </option>
          ))}
        </select>
      </Field>
      <div className="sticky-actions">
        <button className="btn btn-primary" onClick={submit} disabled={busy}>Enregistrer la dépense</button>
      </div>
    </>
  );
}
