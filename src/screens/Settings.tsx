import { useLiveQuery } from 'dexie-react-hooks';
import { Appearance, LockSettings, ShopSettings } from './SettingsExtra';
import { BETA, BUILD, LOCKED } from '../lib/beta';
import { isAdmin, setViewAsTester, viewAsTester } from '../lib/betaAccess';
import { useState } from 'react';
import { saveSettings, wipeAllData } from '../lib/actions';
import { getDb } from '../lib/db';
import { ENTITY_LABEL, humanDetails } from '../lib/journal';
import { centsToInput, parseEuros } from '../lib/money';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { DEFAULT_CATEGORIES, type ActivityStatus, type Settings } from '../lib/types';
import { IClose } from '../ui/icons';
import { cents, ErrorBox, Field, MoneyInput, PageHeader, useAction, useUI } from '../ui/kit';

export interface SettingsDraft {
  businessName: string;
  activityStatus: ActivityStatus;
  trackingStart: string;
  initialCash: string;
  monthlyProfitGoal: string;
  maxPurchaseBudget: string;
  minProfitPerItem: string;
  reinvestPct: string;
  safetyReserve: string;
  staleDays: number;
}

export const toDraft = (s: Settings): SettingsDraft => ({
  businessName: s.businessName,
  activityStatus: s.activityStatus,
  trackingStart: s.trackingStart,
  initialCash: s.initialCash ? centsToInput(s.initialCash) : '',
  monthlyProfitGoal: s.monthlyProfitGoal ? centsToInput(s.monthlyProfitGoal) : '',
  maxPurchaseBudget: s.maxPurchaseBudget ? centsToInput(s.maxPurchaseBudget) : '',
  minProfitPerItem: s.minProfitPerItem ? centsToInput(s.minProfitPerItem) : '',
  reinvestPct: String(s.reinvestPct),
  safetyReserve: s.safetyReserve ? centsToInput(s.safetyReserve) : '',
  staleDays: s.staleDays,
});

export function fromDraft(d: SettingsDraft): Partial<Settings> {
  for (const [label, v] of [
    ['La trésorerie de départ', d.initialCash], ["L'objectif mensuel", d.monthlyProfitGoal], ['Le budget par achat', d.maxPurchaseBudget],
    ['Le bénéfice minimum', d.minProfitPerItem], ['La réserve', d.safetyReserve],
  ] as const)
    if (v.trim() && parseEuros(v) === null) throw new Error(`${label} n'est pas un montant valide.`);
  const pct = Number(d.reinvestPct.replace(',', '.'));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Le pourcentage de réinvestissement doit être entre 0 et 100.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.trackingStart)) throw new Error('La date de début est invalide.');
  return {
    businessName: d.businessName.trim(),
    activityStatus: d.activityStatus,
    trackingStart: d.trackingStart,
    initialCash: cents(d.initialCash),
    monthlyProfitGoal: cents(d.monthlyProfitGoal),
    maxPurchaseBudget: cents(d.maxPurchaseBudget),
    minProfitPerItem: cents(d.minProfitPerItem),
    reinvestPct: Math.round(pct),
    safetyReserve: cents(d.safetyReserve),
    staleDays: d.staleDays,
  };
}

export function SettingsFields({ d, set, onboarding }: { d: SettingsDraft; set: (d: SettingsDraft) => void; onboarding?: boolean }) {
  const up = <K extends keyof SettingsDraft>(k: K) => (v: SettingsDraft[K]) => set({ ...d, [k]: v });
  const s = useData().settings;
  return (
    <>
      <Field label="Nom de l'activité (facultatif)"><input className="input" value={d.businessName} onChange={(e) => up('businessName')(e.target.value)} placeholder="Ma friperie" /></Field>
      <Field label="Statut" hint="Sert plus tard au module fiscal. Aucun taux n'est appliqué automatiquement.">
        <select className="input" value={d.activityStatus} onChange={(e) => up('activityStatus')(e.target.value as ActivityStatus)}>
          <option value="particulier">Particulier</option>
          <option value="micro">Micro-entrepreneur</option>
          <option value="autre">Autre statut</option>
        </select>
      </Field>
      <div className="cols">
        <Field label="Début du suivi"><input type="date" className="input" value={d.trackingStart} onChange={(e) => up('trackingStart')(e.target.value)} /></Field>
        <Field label="Trésorerie de départ" hint="L'argent dédié à l'activité."><MoneyInput value={d.initialCash} onChange={up('initialCash')} /></Field>
        {onboarding && <Field label="Objectif de bénéfice / mois"><MoneyInput value={d.monthlyProfitGoal} onChange={up('monthlyProfitGoal')} /></Field>}
        <Field label="Bénéfice minimum / article"><MoneyInput value={d.minProfitPerItem} onChange={up('minProfitPerItem')} /></Field>
        <Field label="Budget max par achat"><MoneyInput value={d.maxPurchaseBudget} onChange={up('maxPurchaseBudget')} /></Field>
        <Field label="Réserve de sécurité" hint="Jamais proposée au réinvestissement."><MoneyInput value={d.safetyReserve} onChange={up('safetyReserve')} /></Field>
        <Field label="Bénéfice à réinvestir">
          <div className="money-wrap" style={{ position: 'relative' }}>
            <input className="input" inputMode="numeric" value={d.reinvestPct} onChange={(e) => up('reinvestPct')(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} aria-label="Pourcentage du bénéfice à réinvestir" />
            <span style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }}>%</span>
          </div>
        </Field>
        {s.showStock && (
          <Field label="Alerte stock ancien">
            <select className="input" value={d.staleDays} onChange={(e) => up('staleDays')(Number(e.target.value))}>
              {[15, 30, 60, 90].map((n) => <option key={n} value={n}>après {n} jours</option>)}
            </select>
          </Field>
        )}
      </div>
      {!onboarding && <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={s.showStock === true} onChange={(e) => saveSettings({ showStock: e.target.checked })} />
        <span><b>Afficher le stock</b><br /><span className="small muted">Onglet Stock, saisie manuelle des achats et des ventes, alertes de stock. Inutile si la synchro Vinted fait tout.</span></span>
      </label>}
    </>
  );
}

export function SettingsScreen() {
  const ds = useData();
  const ui = useUI();
  const [d, setD] = useState(() => toDraft(ds.settings));
  const [newCat, setNewCat] = useState('');
  const { error, run, busy } = useAction();
  const custom = ds.settings.customCategories;

  const addCat = () => run(async () => {
    const c = newCat.trim();
    if (!c) return;
    if ([...DEFAULT_CATEGORIES, ...custom].some((x) => x.toLowerCase() === c.toLowerCase())) throw new Error('Cette catégorie existe déjà.');
    await saveSettings({ customCategories: [...custom, c] });
    setNewCat('');
    ui.toast('Catégorie ajoutée');
  });

  return (
    <>
      <PageHeader title="Réglages" backTo="" />
      <ErrorBox error={error} />
      <Appearance />
      <LockSettings />
      <ShopSettings />
      <SettingsFields d={d} set={setD} />
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        const ok = await run(async () => { await saveSettings(fromDraft(d)); return true; });
        if (ok) ui.toast('Réglages enregistrés');
      }}>Enregistrer les réglages</button>

      <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => go('objectifs')}>Objectifs mensuels</button>

      <h2>Catégories</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{DEFAULT_CATEGORIES.join(', ')}.</p>
      {custom.length > 0 && (
        <div className="chips" style={{ flexWrap: 'wrap', margin: '0 0 10px', padding: 0 }}>
          {custom.map((c) => (
            <span key={c} className="chip" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--text)' }}>
              {c}
              <button aria-label={`Retirer ${c}`} style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', display: 'grid' }} onClick={() => run(() => saveSettings({ customCategories: custom.filter((x) => x !== c) }))}>
                <IClose width={14} height={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nouvelle catégorie" onKeyDown={(e) => e.key === 'Enter' && addCat()} />
        <button className="btn btn-ghost btn-sm" onClick={addCat}>Ajouter</button>
      </div>

      <h2>Données</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        <button className="btn btn-ghost" onClick={() => go('exports')}>Exporter ou sauvegarder mes données</button>
        <button className="btn btn-ghost" onClick={() => go('journal')}>Journal des opérations</button>
        <button className="btn btn-danger" onClick={async () => {
          if (!(await ui.confirm({ title: 'Effacer toutes les données ?', text: 'Articles, ventes, dépenses, photos et réglages seront supprimés de cet appareil. Cette action est définitive.', confirmLabel: 'Continuer', danger: true }))) return;
          if (!(await ui.confirm({ title: 'Dernière confirmation', text: 'As-tu fait une sauvegarde ? Sans elle, rien ne pourra être récupéré.', confirmLabel: 'Tout effacer définitivement', danger: true }))) return;
          await wipeAllData();
          go('');
        }}>Effacer toutes les données</button>
      </div>
      <p className="tiny faint" style={{ marginTop: 14 }}>
        Les données sont stockées uniquement sur cet appareil, dans le navigateur. Aucune connexion à Vinted n'est utilisée et ton mot de passe Vinted n'est jamais demandé.
      </p>
      {BETA && isAdmin() && Object.keys(LOCKED).length > 0 && (
        <label className="check" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={viewAsTester()} onChange={(e) => { setViewAsTester(e.target.checked); location.reload(); }} />
          <span><b>Admin : voir comme un testeur</b><br /><span className="small muted">Affiche les cadenas des fonctions réservées, comme pour tes testeurs. Décoche pour tout rouvrir.</span></span>
        </label>
      )}
      {BETA && <p className="tiny faint">Version bêta · {BUILD} · <button className="link" style={{ fontSize: 'inherit' }} onClick={() => go('avis/reglages')}>Donner mon avis</button></p>}
    </>
  );
}

export function Journal() {
  const logs = useLiveQuery(() => getDb().auditLogs.orderBy('at').reverse().limit(200).toArray(), []);
  return (
    <>
      <PageHeader title="Journal" sub="Les 200 dernières opérations enregistrées" backTo="reglages" />
      {!logs ? <div className="skeleton" style={{ height: 200 }} /> : logs.length === 0 ? (
        <div className="card small muted">Aucune opération pour l'instant.</div>
      ) : (
        <div className="list">
          {logs.map((l) => (
            <div className="li" key={l.id}>
              <span className="li-main">
                <div className="li-title" style={{ fontSize: 14 }}>{ENTITY_LABEL[l.entity] ?? l.entity} · {l.action}</div>
                <div className="li-sub" style={{ whiteSpace: 'normal' }}>{humanDetails(l.details)}</div>
              </span>
              <span className="tiny faint">{new Date(l.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
