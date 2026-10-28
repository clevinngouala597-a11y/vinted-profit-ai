import { useEffect, useRef, useState } from 'react';
import { go, useRoute } from './lib/router';
import { DataContext, useData, useLiveDataset } from './lib/useData';
import { SaleBanner } from './ui/SaleBanner';
import { IBox, IChart, IHome, IPlus, ITag, ICart, IReceipt } from './ui/icons';
import { Sheet, UIProvider } from './ui/kit';
import { Home } from './screens/Home';
import { Stock } from './screens/Stock';
import { ItemDetail } from './screens/ItemDetail';
import { Sales } from './screens/Sales';
import { SaleDetail } from './screens/SaleDetail';
import { Bilan } from './screens/Bilan';
import { PurchaseForm } from './screens/PurchaseForm';
import { SaleForm } from './screens/SaleForm';
import { ExpenseForm, Expenses } from './screens/Expenses';
import { Calculator } from './screens/Calculator';
import { Treasury } from './screens/Treasury';
import { Exports } from './screens/Exports';
import { SettingsScreen, Journal } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';
import { Goals } from './screens/Goals';
import { Import } from './screens/Import';
import { NotificationsScreen } from './screens/Notifications';
import { ForecastScreen } from './screens/Forecast';
import { Fiscal } from './screens/Fiscal';
import { Labels } from './screens/Labels';
import { Stats } from './screens/Stats';
import { Listing } from './screens/Listing';
import { PhotoPrompts } from './screens/PhotoPrompts';
import { Messages } from './screens/Messages';
import { Republish } from './screens/Republish';
import { MonthCard } from './screens/MonthCard';
import { PullToRefresh } from './ui/PullToRefresh';
import { Feedback } from './screens/Feedback';
import { installPeek, setPrivacy } from './lib/privacy';
import { MissingCosts, SyncInbox, VintedSyncScreen, syncSummary } from './screens/VintedSync';
import { syncNow } from './lib/vinted/sync';
import { useUI } from './ui/kit';

export function App() {
  const ds = useLiveDataset();
  useSplash(!!ds);
  // tant que les données ne sont pas chargées, l'écran de chargement (index.html) reste affiché
  if (!ds) return null;
  return (
    <DataContext.Provider value={ds}>
      <UIProvider>
        <div className="app">{ds.settings.onboarded ? <Shell /> : <Onboarding />}</div>
      </UIProvider>
    </DataContext.Provider>
  );
}

/** Tirer pour actualiser : synchro Vinted si elle est configurée (les nouvelles ventes ont leur bannière). */
async function refresh(): Promise<string> {
  const { loadDataset } = await import('./lib/actions');
  const s = (await loadDataset()).settings;
  if (!s.syncUrl || !s.syncToken) return 'À jour';
  if (!navigator.onLine) throw new Error('Pas de connexion internet');
  const r = await syncNow();
  return r.newSales.length ? `${r.newSales.length} nouvelle${r.newSales.length > 1 ? 's' : ''} vente${r.newSales.length > 1 ? 's' : ''} !` : `À jour · ${syncSummary(r)}`;
}

function Shell() {
  const [r0, r1] = useRoute();
  const hide = useData().settings.hideAmounts === true;
  useEffect(() => setPrivacy(hide), [hide]);
  useEffect(() => installPeek(), []);
  const [addOpen, setAddOpen] = useState(false);
  useAutoSync();

  let screen;
  switch (r0) {
    case undefined: screen = <Home />; break;
    case 'stock': screen = r1 ? <ItemDetail id={r1} /> : <Stock />; break;
    case 'ventes': screen = r1 ? <SaleDetail id={r1} /> : <Sales />; break;
    case 'bilan': screen = <Bilan />; break;
    case 'achat': screen = <PurchaseForm />; break;
    case 'vente': screen = <SaleForm />; break;
    case 'depense': screen = <ExpenseForm />; break;
    case 'depenses': screen = <Expenses />; break;
    case 'calculateur': screen = <Calculator />; break;
    case 'tresorerie': screen = <Treasury />; break;
    case 'exports': screen = <Exports />; break;
    case 'reglages': screen = <SettingsScreen />; break;
    case 'journal': screen = <Journal />; break;
    case 'objectifs': screen = <Goals />; break;
    case 'import': screen = <Import />; break;
    case 'notifications': screen = <NotificationsScreen />; break;
    case 'previsions': screen = <ForecastScreen />; break;
    case 'fiscal': screen = <Fiscal />; break;
    case 'synchro': screen = <VintedSyncScreen />; break;
    case 'a-valider': screen = <SyncInbox />; break;
    case 'couts': screen = <MissingCosts />; break;
    case 'bordereaux': screen = <Labels />; break;
    case 'statistiques': screen = <Stats />; break;
    case 'annonce': screen = <Listing />; break;
    case 'photos': screen = <PhotoPrompts />; break;
    case 'messages': screen = <Messages />; break;
    case 'republier': screen = <Republish />; break;
    case 'resume': screen = <MonthCard />; break;
    case 'avis': screen = <Feedback from={r1} />; break;
    default: screen = <Home />;
  }

  const showStock = useData().settings.showStock === true;
  const tab = r0 === 'depenses' ? 'depenses' : r0 === 'stock' ? 'stock' : r0 === 'ventes' ? 'ventes' : r0 === 'bilan' ? 'bilan' : r0 === undefined ? 'home' : '';
  const pick = (path: string) => {
    setAddOpen(false);
    go(path);
  };

  return (
    <>
      <SaleBanner />
      <PullToRefresh onRefresh={refresh}>
        <main className="page" key={r0 + (r1 ?? '')}>{screen}</main>
      </PullToRefresh>
      <nav className="tabbar" aria-label="Navigation principale">
        <div className="tabbar-inner">
          <TabLink to="" label="Accueil" current={tab === 'home'} icon={<IHome />} />
          {showStock ? <TabLink to="stock" label="Stock" current={tab === 'stock'} icon={<IBox />} /> : <TabLink to="depenses" label="Dépenses" current={tab === 'depenses'} icon={<IReceipt />} />}
          <button className="tab-add" aria-label="Ajouter un achat, une vente ou une dépense" onClick={() => setAddOpen(true)}>
            <IPlus width={26} height={26} />
          </button>
          <TabLink to="ventes" label="Ventes" current={tab === 'ventes'} icon={<ITag />} />
          <TabLink to="bilan" label="Bilan" current={tab === 'bilan'} icon={<IChart />} />
        </div>
      </nav>
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Ajouter">
        <p className="muted small" style={{ marginTop: 0 }}>{showStock ? 'Chaque opération met à jour le stock, le bénéfice et la trésorerie.' : 'Tes ventes et achats Vinted s’enregistrent tout seuls avec la synchro.'}</p>
        {showStock && (
          <>
            <button className="menu-item" onClick={() => pick('achat')}>
              <span className="dot in"><ICart width={18} height={18} /></span>
              <span><div className="mi-title">Un achat</div><div className="mi-sub">Un article ou un lot, avec ses frais</div></span>
            </button>
            <button className="menu-item" onClick={() => pick('vente')}>
              <span className="dot in"><ITag width={18} height={18} /></span>
              <span><div className="mi-title">Une vente</div><div className="mi-sub">Un ou plusieurs articles du stock</div></span>
            </button>
          </>
        )}
        <button className="menu-item" onClick={() => pick('depense')}>
          <span className="dot out"><IReceipt width={18} height={18} /></span>
          <span><div className="mi-title">Une dépense</div><div className="mi-sub">Emballage, matériel, déplacement…</div></span>
        </button>
      </Sheet>
    </>
  );
}

function TabLink({ to, label, icon, current }: { to: string; label: string; icon: React.ReactNode; current: boolean }) {
  return (
    <a className="tab" href={`#/${to}`} aria-current={current ? 'page' : undefined} style={{ textDecoration: 'none' }}>
      {icon}
      {label}
    </a>
  );
}

/** Durée d'affichage de l'écran de chargement (l'utilisateur peut toucher l'écran pour passer). */
const SPLASH_MIN_MS = 10000;

function useSplash(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const el = document.getElementById('splash');
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const wait = reduced ? 0 : Math.max(0, SPLASH_MIN_MS - performance.now());
    const t1 = window.setTimeout(() => el.classList.add('sp-hide'), wait);
    const t2 = window.setTimeout(() => el.remove(), wait + 850);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [ready]);
}

/** Synchro Gmail automatique : à l'ouverture et à chaque retour dans l'application (au plus toutes les 2 minutes). */
function useAutoSync() {
  const ui = useUI();
  const toast = useRef(ui.toast);
  toast.current = ui.toast;
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      const { loadDataset } = await import('./lib/actions');
      const s = (await loadDataset()).settings;
      if (!s.syncUrl || !s.syncToken) return;
      if (s.lastSyncAt && Date.now() - Date.parse(s.lastSyncAt) < 120_000) return;
      try {
        const r = await syncNow();
        // les nouvelles ventes ont leur propre bannière (avec le son) ; le reste est résumé discrètement
        if (!r.newSales.length && (r.applied || r.inbox)) toast.current(`Vinted : ${syncSummary(r)}`);
        // sauvegarde Google Drive automatique (toutes les 12 h), silencieuse
        const { autoBackupIfDue } = await import('./lib/vinted/drive');
        await autoBackupIfDue().catch(() => {});
      } catch {
        /* silencieux : l'erreur s'affiche dans l'écran Synchro quand l'utilisateur lance la synchro */
      }
    };
    tick();
    document.addEventListener('visibilitychange', tick);
    return () => document.removeEventListener('visibilitychange', tick);
  }, []);
}
