import { useEffect, useState, type ReactNode } from 'react';
import { BETA, isLocked } from '../lib/beta';
import { useData } from '../lib/useData';
import { IBell, IBox, ICalc, IChart, IDownload, IGear, IHome, IMail, IPlus, IReceipt, IScale, ITag, ITarget, ITrend, IWallet } from './icons';

/** Écran large (ordinateur, tablette en paysage) : menu latéral et mises en page en colonnes. */
export const WIDE = '(min-width: 1024px)';
export function useWide() {
  const q = () => typeof matchMedia === 'function' && matchMedia(WIDE).matches;
  const [wide, setWide] = useState(q);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

type Link = { to: string; label: string; icon: ReactNode };

/** Menu fixe à gauche sur ordinateur (remplace la barre du bas et le menu ☰). */
export function Sidebar({ route, onAdd }: { route: string | undefined; onAdd: () => void }) {
  const s = useData().settings;
  const main: Link[] = [
    { to: '', label: 'Accueil', icon: <IHome /> },
    { to: 'ventes', label: 'Ventes', icon: <ITag /> },
    s.showStock ? { to: 'stock', label: 'Stock', icon: <IBox /> } : { to: 'depenses', label: 'Dépenses', icon: <IReceipt /> },
    { to: 'bilan', label: 'Bilan', icon: <IChart /> },
    { to: 'statistiques', label: 'Statistiques', icon: <ITrend /> },
    { to: 'notifications', label: 'Alertes', icon: <IBell /> },
  ];
  const tools: Link[] = [
    { to: 'synchro', label: 'Synchro Vinted', icon: <IMail /> },
    { to: 'bordereaux', label: 'Bordereaux', icon: <IReceipt /> },
    { to: 'messages', label: 'Messages prêts', icon: <IMail /> },
    { to: 'republier', label: 'À republier', icon: <ITrend /> },
    { to: 'resume', label: 'Résumé du mois', icon: <IChart /> },
    ...(s.showStock ? [{ to: 'depenses', label: 'Dépenses', icon: <IReceipt /> }] : []),
  ];
  const gestion: Link[] = [
    { to: 'objectifs', label: 'Objectifs', icon: <ITarget /> },
    { to: 'previsions', label: 'Prévisions', icon: <ITrend /> },
    { to: 'tresorerie', label: 'Trésorerie', icon: <IWallet /> },
    { to: 'fiscal', label: 'Fiscalité', icon: <IScale /> },
    { to: 'calculateur', label: 'Calculateur', icon: <ICalc /> },
    { to: 'exports', label: 'Exports', icon: <IDownload /> },
    ...(BETA ? [{ to: 'avis', label: 'Donner mon avis', icon: <IMail /> }] : []),
    { to: 'reglages', label: 'Réglages', icon: <IGear /> },
  ];
  const cur = route ?? '';
  const item = (l: Link) => (
    <a key={l.to + l.label} href={`#/${l.to}`} className="side-link" aria-current={cur === l.to ? 'page' : undefined}>
      {l.icon}<span>{l.label}</span>{isLocked(l.to) && <span className="side-lock">🔒</span>}
    </a>
  );
  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="side-brand">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={34} height={34} />
        <span>CNG Vinted{BETA && <span className="beta-badge">BÊTA</span>}</span>
      </div>
      <button className="btn btn-primary side-add" onClick={onAdd}><IPlus width={18} height={18} /> Ajouter</button>
      <nav>{main.map(item)}</nav>
      <div className="side-title">Outils</div>
      <nav>{tools.map(item)}</nav>
      <div className="side-title">Gestion</div>
      <nav>{gestion.map(item)}</nav>
    </aside>
  );
}
