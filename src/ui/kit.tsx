import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getDb } from '../lib/db';
import { back } from '../lib/router';
import { formatEuros, parseEuros, type Cents } from '../lib/money';
import { IBack } from './icons';

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

export function Money({ c, signed, tone, className = '' }: { c: Cents; signed?: boolean; tone?: boolean; className?: string }) {
  const cls = tone ? (c > 0 ? 'pos' : c < 0 ? 'neg' : '') : '';
  return <span className={`${cls} ${className}`}>{formatEuros(c, { signed })}</span>;
}

/** Grand montant : les centimes sont réduits pour la lisibilité. */
export function BigMoney({ c }: { c: Cents }) {
  const s = formatEuros(c, { signed: c < 0 });
  const m = s.match(/^(.*?)(,\d{2})(\s?€)$/);
  return (
    <span className={c < 0 ? 'neg' : c > 0 ? 'pos' : ''}>
      {m ? (
        <>
          {m[1]}
          <span className="cents">{m[2]}{m[3]}</span>
        </>
      ) : s}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Champs
// ---------------------------------------------------------------------------

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Saisie d'un montant en euros. `value` est la chaîne saisie ; utiliser `parseEuros` pour obtenir des centimes. */
export function MoneyInput({ value, onChange, placeholder = '0,00', invalid, ...rest }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string;
}) {
  return (
    <div className="money-wrap">
      <input
        className="input"
        inputMode="decimal"
        enterKeyHint="next"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || (value.trim() !== '' && parseEuros(value) === null) || undefined}
        onChange={(e) => onChange(e.target.value.replace(/[^\d,.\s-]/g, ''))}
        {...rest}
      />
    </div>
  );
}

export const cents = (s: string): Cents => parseEuros(s) ?? 0;
export const centsOrNull = (s: string): Cents | null => (s.trim() === '' ? null : parseEuros(s));

// ---------------------------------------------------------------------------
// Structure de page
// ---------------------------------------------------------------------------

export function PageHeader({ title, sub, backTo, right }: { title: string; sub?: ReactNode; backTo?: string; right?: ReactNode }) {
  return (
    <>
      {backTo !== undefined && (
        <button className="back" onClick={() => back(backTo)}>
          <IBack width={18} height={18} /> Retour
        </button>
      )}
      <header className="top">
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right}
      </header>
    </>
  );
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Sheet({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  // rendu à la racine du document : les cartes en verre et les animations ne déforment pas la feuille
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        <div className="sheet-grip" />
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Définitions des indicateurs
// ---------------------------------------------------------------------------

export const DEFINITIONS: Record<string, { title: string; text: string }> = {
  revenue: { title: "Chiffre d'affaires", text: "Somme des montants réellement encaissés par toi sur les ventes de la période, après réductions et remboursements. Les frais payés par l'acheteur (protection, livraison) n'en font pas partie." },
  profit: { title: 'Bénéfice commercial', text: "Chiffre d'affaires − coût de revient des articles vendus − coûts directement liés aux ventes (frais à ta charge, emballage, dépenses rattachées à une vente). Un article invendu ne crée ni bénéfice ni perte." },
  result: { title: 'Résultat estimé', text: 'Bénéfice commercial − dépenses générales (matériel, abonnements…) − valeur des articles perdus ou retirés. Estimation de gestion : ce n’est pas ton revenu imposable.' },
  purchases: { title: 'Total des achats', text: "Ce que tu as payé pour acheter du stock sur la période (prix + frais d'achat). Ce n'est pas une charge : le coût d'un article est imputé au résultat seulement quand il est vendu." },
  expenses: { title: 'Dépenses annexes', text: 'Dépenses enregistrées sur la période qui ne sont pas des achats de stock : emballages, matériel photo, déplacements, abonnements…' },
  cash: { title: 'Trésorerie disponible', text: "Solde de départ + encaissements confirmés − décaissements confirmés. Les paiements en attente et la valeur du stock n'y sont pas ajoutés." },
  stockValue: { title: 'Valeur du stock', text: "Somme des coûts de revient des articles encore en ta possession (achetés, à préparer, en vente, réservés, retournés). C'est de l'argent immobilisé, pas de la trésorerie." },
  stockCount: { title: 'Articles en stock', text: 'Nombre d’articles encore en ta possession, publiés ou non.' },
  sold: { title: 'Articles vendus', text: 'Nombre d’articles vendus sur la période, moins ceux qui t’ont été retournés.' },
  avg: { title: 'Bénéfice moyen par article', text: 'Bénéfice commercial ÷ nombre d’articles vendus sur la période.' },
  roi: { title: 'Retour sur investissement', text: 'Bénéfice commercial ÷ coût de revient des articles vendus × 100. 100 % signifie que tu as doublé ta mise. « Non applicable » si aucun coût.' },
  margin: { title: 'Marge commerciale', text: 'Bénéfice commercial ÷ chiffre d’affaires × 100. « Non applicable » si aucun chiffre d’affaires.' },
  reinvest: { title: 'Réinvestissement prévu', text: 'Part de ton bénéfice du mois que tu as choisi de réinvestir, plafonnée par la trésorerie disponible moins ta réserve de sécurité et les dépenses en attente.' },
  available: { title: 'Disponible pour acheter', text: 'Trésorerie confirmée − sorties en attente − réserve de sécurité. Un bénéfice non encore encaissé n’est jamais compté.' },
  cost: { title: 'Coût de revient', text: "Prix d'achat attribué à l'article + frais d'achat attribués (déplacement, livraison, protection acheteur…). Pour un lot, le prix et les frais sont répartis entre les articles." },
};

export function InfoButton({ k }: { k: keyof typeof DEFINITIONS | string }) {
  const [open, setOpen] = useState(false);
  const d = DEFINITIONS[k];
  if (!d) return null;
  return (
    <>
      <button className="info-btn" aria-label={`Définition : ${d.title}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>
        i
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={d.title}>
        <p className="muted" style={{ marginTop: 0 }}>{d.text}</p>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>Compris</button>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Toasts et confirmations
// ---------------------------------------------------------------------------

interface ConfirmOpts { title: string; text?: string; confirmLabel: string; danger?: boolean }
interface UICtx { toast: (m: string) => void; confirm: (o: ConfirmOpts) => Promise<boolean> }
const UIContext = createContext<UICtx>({ toast: () => {}, confirm: async () => false });
export const useUI = () => useContext(UIContext);

export function UIProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [conf, setConf] = useState<(ConfirmOpts & { resolve: (b: boolean) => void }) | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConf({ ...o, resolve })), []);
  const close = (b: boolean) => {
    conf?.resolve(b);
    setConf(null);
  };
  return (
    <UIContext.Provider value={{ toast, confirm }}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
      <Sheet open={!!conf} onClose={() => close(false)} title={conf?.title}>
        {conf?.text && <p className="muted" style={{ marginTop: 0 }}>{conf.text}</p>}
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          <button className={`btn ${conf?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{conf?.confirmLabel}</button>
          <button className="btn btn-ghost" onClick={() => close(false)}>Annuler</button>
        </div>
      </Sheet>
    </UIContext.Provider>
  );
}

/** Exécute une opération et affiche l'erreur éventuelle en clair. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError(null);
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur inattendue est survenue.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { error, setError, busy, run };
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="alert error" role="alert">{error}</div>;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export function usePhotoUrl(id: string | undefined): string | undefined {
  const att = useLiveQuery(() => (id ? getDb().attachments.get(id) : undefined), [id]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!att) return setUrl(undefined);
    const u = URL.createObjectURL(att.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [att]);
  return url;
}

export function Thumb({ photoId, name }: { photoId?: string; name: string }) {
  const url = usePhotoUrl(photoId);
  return <div className="thumb">{url ? <img src={url} alt="" /> : name.trim().charAt(0).toUpperCase() || '?'}</div>;
}
