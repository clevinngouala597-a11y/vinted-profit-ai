import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { go, useRoute } from './lib/router';
import { DataContext, FullDataContext, useData, useLiveDataset } from './lib/useData';
import { SaleBanner } from './ui/SaleBanner';
import { IBox, IChart, IHome, IPlus, ITag, ICart, IReceipt } from './ui/icons';
import { Sheet, UIProvider } from './ui/kit';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { NewsPopup, NewsScreen } from './screens/News';
import { PullToRefresh } from './ui/PullToRefresh';
import { BetaGate, Locked } from './screens/BetaGate';
import { BETA, isLocked } from './lib/beta';
import { storedAccess } from './lib/betaAccess';
import { installPeek, setPrivacy } from './lib/privacy';
import { applyTheme } from './lib/theme';
import { activeShop, scopeDataset } from './lib/shops';
import { AppLock } from './ui/AppLock';
import { Sidebar, useWide } from './ui/Sidebar';
import { syncSummary } from './lib/vinted/summary';
import { syncNow } from './lib/vinted/sync';
import { useUI } from './ui/kit';

// Écrans chargés à la demande (ouverture plus rapide), puis tous préchargés en arrière-plan
// pour que l'appli reste utilisable hors ligne.
const Stock = lazy(() => import('./screens/Stock').then((m) => ({ default: m.Stock })));
const ItemDetail = lazy(() => import('./screens/ItemDetail').then((m) => ({ default: m.ItemDetail })));
const Sales = lazy(() => import('./screens/Sales').then((m) => ({ default: m.Sales })));
const SaleDetail = lazy(() => import('./screens/SaleDetail').then((m) => ({ default: m.SaleDetail })));
const Bilan = lazy(() => import('./screens/Bilan').then((m) => ({ default: m.Bilan })));
const PurchaseForm = lazy(() => import('./screens/PurchaseForm').then((m) => ({ default: m.PurchaseForm })));
const SaleForm = lazy(() => import('./screens/SaleForm').then((m) => ({ default: m.SaleForm })));
const ExpenseForm = lazy(() => import('./screens/Expenses').then((m) => ({ default: m.ExpenseForm })));
const Expenses = lazy(() => import('./screens/Expenses').then((m) => ({ default: m.Expenses })));
const Calculator = lazy(() => import('./screens/Calculator').then((m) => ({ default: m.Calculator })));
const Treasury = lazy(() => import('./screens/Treasury').then((m) => ({ default: m.Treasury })));
const Exports = lazy(() => import('./screens/Exports').then((m) => ({ default: m.Exports })));
const SettingsScreen = lazy(() => import('./screens/Settings').then((m) => ({ default: m.SettingsScreen })));
const Controle = lazy(() => import('./screens/Controle').then((m) => ({ default: m.Controle })));
const JournalScreen = lazy(() => import('./screens/Controle').then((m) => ({ default: m.JournalScreen })));
const Unsold = lazy(() => import('./screens/Unsold').then((m) => ({ default: m.Unsold })));
const Assistant = lazy(() => import('./screens/Assistant').then((m) => ({ default: m.Assistant })));
const AdminUsers = lazy(() => import('./screens/AdminUsers').then((m) => ({ default: m.AdminUsers })));
const Goals = lazy(() => import('./screens/Goals').then((m) => ({ default: m.Goals })));
const Import = lazy(() => import('./screens/Import').then((m) => ({ default: m.Import })));
const NotificationsScreen = lazy(() => import('./screens/Notifications').then((m) => ({ default: m.NotificationsScreen })));
const ForecastScreen = lazy(() => import('./screens/Forecast').then((m) => ({ default: m.ForecastScreen })));
const Fiscal = lazy(() => import('./screens/Fiscal').then((m) => ({ default: m.Fiscal })));
const Labels = lazy(() => import('./screens/Labels').then((m) => ({ default: m.Labels })));
const Stats = lazy(() => import('./screens/Stats').then((m) => ({ default: m.Stats })));
const Listing = lazy(() => import('./screens/Listing').then((m) => ({ default: m.Listing })));
const PhotoPrompts = lazy(() => import('./screens/PhotoPrompts').then((m) => ({ default: m.PhotoPrompts })));
const Messages = lazy(() => import('./screens/Messages').then((m) => ({ default: m.Messages })));
const Republish = lazy(() => import('./screens/Republish').then((m) => ({ default: m.Republish })));
const Trends = lazy(() => import('./screens/Trends').then((m) => ({ default: m.Trends })));
const MonthCard = lazy(() => import('./screens/MonthCard').then((m) => ({ default: m.MonthCard })));
const Feedback = lazy(() => import('./screens/Feedback').then((m) => ({ default: m.Feedback })));
const MissingCosts = lazy(() => import('./screens/VintedSync').then((m) => ({ default: m.MissingCosts })));
const SyncInbox = lazy(() => import('./screens/VintedSync').then((m) => ({ default: m.SyncInbox })));
const VintedSyncScreen = lazy(() => import('./screens/VintedSync').then((m) => ({ default: m.VintedSyncScreen })));
const SCREENS: (() => Promise<unknown>)[] = [
  () => import('./screens/Stock'),
  () => import('./screens/ItemDetail'),
  () => import('./screens/Sales'),
  () => import('./screens/SaleDetail'),
  () => import('./screens/Bilan'),
  () => import('./screens/PurchaseForm'),
  () => import('./screens/SaleForm'),
  () => import('./screens/Expenses'),
  () => import('./screens/Calculator'),
  () => import('./screens/Treasury'),
  () => import('./screens/Exports'),
  () => import('./screens/Settings'),
  () => import('./screens/Controle'),
  () => import('./screens/Unsold'),
  () => import('./screens/Assistant'),
  () => import('./screens/AdminUsers'),
  () => import('./screens/Goals'),
  () => import('./screens/Import'),
  () => import('./screens/Notifications'),
  () => import('./screens/Forecast'),
  () => import('./screens/Fiscal'),
  () => import('./screens/Labels'),
  () => import('./screens/Stats'),
  () => import('./screens/Listing'),
  () => import('./screens/PhotoPrompts'),
  () => import('./screens/Messages'),
  () => import('./screens/Republish'),
  () => import('./screens/Trends'),
  () => import('./screens/MonthCard'),
  () => import('./screens/Feedback'),
  () => import('./screens/VintedSync'),
];
function usePreloadScreens() {
  useEffect(() => {
    const run = () => SCREENS.reduce((p, load) => p.then(() => load().catch(() => {})), Promise.resolve() as Promise<unknown>);
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const t = window.setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 4000 }) : run()), 1500);
    return () => window.clearTimeout(t);
  }, []);
}

export function App() {
  const ds = useLiveDataset();
  const [access, setAccess] = useState(() => (BETA ? storedAccess() : null));
  useSplash(!!ds);
  const theme = ds?.settings.theme;
  // dressing affiché : tous les écrans voient ses données (les écritures, elles, voient tout)
  const view = useMemo(() => (ds ? scopeDataset(ds, activeShop(ds.settings)) : ds), [ds]);
  useEffect(() => applyTheme(theme), [theme]);
  // tant que les données ne sont pas chargées, l'écran de chargement (index.html) reste affiché
  if (!ds) return null;
  return (
    <FullDataContext.Provider value={ds}>
    <DataContext.Provider value={view!}>
      <UIProvider>
        <div className="app">{BETA && !access ? <BetaGate onOpen={setAccess} /> : ds.settings.onboarded ? <AppLock><Shell /></AppLock> : <Onboarding />}</div>
      </UIProvider>
    </DataContext.Provider>
    </FullDataContext.Provider>
  );
}

/** Tirer pour actualiser : synchro Vinted si elle est configurée (les nouvelles ventes ont leur bannière). */
async function refresh(): Promise<string> {
  const { loadDataset } = await import('./lib/actions');
  const s = (await loadDataset()).settings;
  if (s.syncMode !== 'google' && (!s.syncUrl || !s.syncToken)) return 'À jour';
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
  usePreloadScreens();
  const wide = useWide();

  let screen;
  switch (r0) {
    case undefined: screen = <Home />; break;
    // sur ordinateur : la liste à gauche, le détail à droite
    case 'stock': screen = wide ? <Split list={<Stock />} detail={r1 ? <ItemDetail key={r1} id={r1} /> : null} empty="Choisis un article pour voir son détail." /> : r1 ? <ItemDetail id={r1} /> : <Stock />; break;
    case 'ventes': screen = wide ? <Split list={<Sales />} detail={r1 ? <SaleDetail key={r1} id={r1} /> : null} empty="Choisis une vente pour voir son détail." /> : r1 ? <SaleDetail id={r1} /> : <Sales />; break;
    case 'bilan': screen = <Bilan />; break;
    case 'achat': screen = <PurchaseForm />; break;
    case 'vente': screen = <SaleForm />; break;
    case 'depense': screen = <ExpenseForm />; break;
    case 'depenses': screen = <Expenses />; break;
    case 'calculateur': screen = <Calculator />; break;
    case 'tresorerie': screen = <Treasury />; break;
    case 'exports': screen = <Exports />; break;
    case 'reglages': screen = <SettingsScreen />; break;
    case 'journal': screen = <JournalScreen />; break;
    case 'verification': screen = <Controle />; break;
    case 'invendus': screen = <Unsold />; break;
    case 'assistant': screen = <Assistant />; break;
    case 'admin': screen = <AdminUsers />; break;
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
    case 'tendances': screen = BETA ? <Trends /> : <Home />; break;
    case 'nouveautes': screen = <NewsScreen />; break;
    case 'resume': screen = <MonthCard />; break;
    case 'avis': screen = <Feedback from={r1} />; break;
    default: screen = <Home />;
  }
  if (isLocked(r0)) screen = <Locked route={r0!} />;

  const showStock = useData().settings.showStock === true;
  const tab = r0 === 'depenses' ? 'depenses' : r0 === 'stock' ? 'stock' : r0 === 'ventes' ? 'ventes' : r0 === 'bilan' ? 'bilan' : r0 === undefined ? 'home' : '';
  const pick = (path: string) => {
    setAddOpen(false);
    go(path);
  };

  return (
    <>
      <SaleBanner />
      <NewsPopup />
      {wide && <Sidebar route={r0} onAdd={() => setAddOpen(true)} />}
      <PullToRefresh onRefresh={refresh}>
        <main className={`page page-${r0 || 'accueil'}`} key={wide && (r0 === 'ventes' || r0 === 'stock') ? r0 : r0 + (r1 ?? '')}><Suspense fallback={null}>{screen}</Suspense></main>
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

/**
 * Durée d'affichage de l'écran de chargement (l'utilisateur peut toucher l'écran pour passer) :
 * l'animation complète dans l'appli installée, courte dans le navigateur (premières visites, Google).
 */
const SPLASH_MIN_MS = 10000;
const SPLASH_BROWSER_MS = 2500;
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function useSplash(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const el = document.getElementById('splash');
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const wait = reduced ? 0 : Math.max(0, (installed() ? SPLASH_MIN_MS : SPLASH_BROWSER_MS) - performance.now());
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
  // signal anonyme d'utilisation (liste des utilisateurs de l'admin), toutes les 5 minutes appli affichée
  useEffect(() => {
    const ping = async () => {
      if (document.visibilityState === 'hidden') return;
      const { loadDataset } = await import('./lib/actions');
      const s = (await loadDataset()).settings;
      const { sendPresence } = await import('./lib/presence');
      await sendPresence({ google: s.syncMode === 'google', enabled: s.shareStats !== false });
    };
    ping();
    const t = window.setInterval(ping, 60_000);
    document.addEventListener('visibilitychange', ping);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', ping); };
  }, []);
  // arrivée depuis l'ancienne adresse
  useEffect(() => {
    const t = (window as unknown as { __transfer?: import('./lib/transfer').TransferResult | null }).__transfer;
    (window as unknown as { __transfer?: unknown }).__transfer = null;
    if (t?.status === 'imported') toast.current(`Bienvenue sur la nouvelle adresse : tes données ont suivi (${t.sales} ventes)${t.photosMissing ? `, sauf ${t.photosMissing} photo${t.photosMissing > 1 ? 's' : ''}` : ''}.`);
  }, []);
  // retour de la connexion Google
  useEffect(() => {
    const r = (window as unknown as { __googleRedirect?: import('./lib/google/auth').RedirectResult }).__googleRedirect;
    (window as unknown as { __googleRedirect?: unknown }).__googleRedirect = null;
    if (!r) return;
    if (!r.ok) {
      if (!r.silent) toast.current(r.error);
      return;
    }
    (async () => {
      const { resolvePendingAccount } = await import('./lib/google/auth');
      const { registerAccount } = await import('./lib/google/accounts');
      const email = await resolvePendingAccount();
      if (!email) { toast.current('Connexion Google reçue, mais l’adresse du compte est illisible : réessaie.'); return; }
      // nouveau compte : ajouté sans toucher aux autres ; compte déjà connecté : jeton renouvelé
      await registerAccount(email, r.shop);
      if (r.silent) return;
      try {
        const res = await syncNow(undefined, undefined, r.add ? email : undefined);
        if (!res.newSales.length) toast.current(`${email} connecté · ${syncSummary(res)}`);
      } catch (e) {
        toast.current(e instanceof Error ? e.message : 'Synchro impossible pour le moment');
      }
    })();
  }, []);
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      const { loadDataset } = await import('./lib/actions');
      const s = (await loadDataset()).settings;
      const google = s.syncMode === 'google';
      if (!google && (!s.syncUrl || !s.syncToken)) return;
      if (s.lastSyncAt && Date.now() - Date.parse(s.lastSyncAt) < 120_000) return;
      // après un échec, on attend un peu avant de réessayer
      const last = s.syncLog?.[0];
      if (last && !last.ok && Date.now() - Date.parse(last.at) < 120_000) return;
      if (google) {
        // jeton expiré : reconnexion silencieuse chez Google, compte par compte (au plus une fois toutes les 30 min par compte)
        const { getSession, tokenValid, startGoogleLogin } = await import('./lib/google/auth');
        const { accountsOf } = await import('./lib/google/accounts');
        for (const acc of accountsOf(s)) {
          if (tokenValid(getSession(acc.email || null))) continue;
          const key = `cng-google-silent-at:${acc.email}`;
          const last = Number(localStorage.getItem(key) ?? 0);
          if (Date.now() - last < 30 * 60_000) continue;
          try { localStorage.setItem(key, String(Date.now())); } catch { /* */ }
          startGoogleLogin({ silent: true, hint: acc.email || s.googleEmail });
          return;
        }
      }
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

/** Liste + détail côte à côte (ordinateur). */
function Split({ list, detail, empty }: { list: React.ReactNode; detail: React.ReactNode; empty: string }) {
  return (
    <div className="split">
      <div className="split-list">{list}</div>
      <div className="split-detail">{detail ?? <div className="split-empty">{empty}</div>}</div>
    </div>
  );
}
