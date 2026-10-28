import { useState } from 'react';
import { defaultSettings, saveSettings } from '../lib/actions';
import { BETA } from '../lib/beta';
import { loadDemoData } from '../lib/demo';
import { todayISO } from '../lib/period';
import { requestPersistentStorage } from '../lib/db';
import { ErrorBox, useAction } from '../ui/kit';
import { fromDraft, SettingsFields, toDraft } from './Settings';

export function Onboarding() {
  const [step, setStep] = useState<0 | 1>(0);
  const [d, setD] = useState(() => toDraft(defaultSettings()));
  const { error, run, busy } = useAction();

  if (step === 0)
    return (
      <main className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh', paddingBottom: 'calc(var(--safe-b) + 24px)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="hero" style={{ marginBottom: 22 }}>
            <div className="hero-label">Bénéfice commercial · exemple</div>
            <div className="hero-amount"><span className="pos">+12,00 €</span></div>
            <div className="hero-meta"><span>Sweat acheté <b>5 €</b> + <b>1 €</b> de frais</span><span>encaissé <b>18 €</b></span></div>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 10px', lineHeight: 1.1 }}>
            Sache exactement ce que te rapporte chaque vêtement.
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Achats, ventes, stock, frais et trésorerie au même endroit. Les calculs séparent ce que tu as gagné, ce que tu as encaissé et ce qui dort dans ton stock.
          </p>
          <ul className="small muted" style={{ paddingLeft: 18, margin: '16px 0 0', display: 'grid', gap: 6 }}>
            <li>Tes données restent sur ce téléphone. Tu peux les sauvegarder à tout moment.</li>
            <li>Aucune connexion à ton compte Vinted, aucun mot de passe demandé.</li>
          </ul>
        </div>
        <ErrorBox error={error} />
        {BETA ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <p className="small" style={{ margin: '0 0 6px' }}><span className="beta-badge" style={{ marginLeft: 0, marginRight: 8, top: -1 }}>BÊTA</span>Merci de tester l'appli ! Commence avec un exemple pour tout voir, ou configure directement ton suivi.</p>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { await loadDemoData(todayISO()); })}>{busy ? 'Préparation de l’exemple…' : 'Essayer avec un exemple'}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setStep(1)}>Configurer mon suivi</button>
          </div>
        ) : <button className="btn btn-primary" onClick={() => setStep(1)}>Configurer mon suivi</button>}
      </main>
    );

  return (
    <main className="page" style={{ paddingBottom: 'calc(var(--safe-b) + 24px)' }}>
      <header className="top">
        <div>
          <h1>Ton activité</h1>
          <div className="sub">Tout est modifiable ensuite dans les réglages.</div>
        </div>
      </header>
      <ErrorBox error={error} />
      <SettingsFields d={d} set={setD} onboarding />
      <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
          await saveSettings({ ...defaultSettings(), ...fromDraft(d), onboarded: true });
          await requestPersistentStorage();
        })}>Commencer</button>
        <button className="btn btn-ghost" onClick={() => setStep(0)}>Retour</button>
      </div>
    </main>
  );
}
