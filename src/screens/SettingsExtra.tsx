import { useEffect, useState } from 'react';
import { saveSettings } from '../lib/actions';
import { biometricAvailable, checkPin, PIN_RE, pinHash, registerBiometric, verifyBiometric } from '../lib/lock';
import { ErrorBox, Field, useAction, useUI } from '../ui/kit';
import { MAIN, shopsOf } from '../lib/shops';
import { addShop, deleteShop, updateShop } from '../lib/shopActions';
import { useData } from '../lib/useData';
import type { Theme } from '../lib/theme';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'sombre', label: '🌙 Sombre' },
  { id: 'clair', label: '☀️ Clair' },
  { id: 'auto', label: '📱 Auto' },
];

/** Apparence : appliquée tout de suite, sans bouton « Enregistrer ». */
export function Appearance() {
  const t = useData().settings.theme ?? 'sombre';
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <b>Apparence</b>
      <div className="seg" role="group" aria-label="Apparence" style={{ marginTop: 10 }}>
        {THEMES.map((x) => <button key={x.id} aria-pressed={t === x.id} onClick={() => saveSettings({ theme: x.id })}>{x.label}</button>)}
      </div>
      {t === 'auto' && <p className="tiny faint" style={{ margin: '8px 0 0' }}>Suit le réglage de ton iPhone (clair le jour, sombre le soir si tu l'as activé).</p>}
    </div>
  );
}

const DELAYS = [{ v: 0, l: 'Toujours' }, { v: 1, l: '1 min' }, { v: 5, l: '5 min' }, { v: 15, l: '15 min' }];

/** Verrouillage : code de secours obligatoire, puis Face ID si l'iPhone le permet. */
export function LockSettings() {
  const s = useData().settings;
  const ui = useUI();
  const { error, run, busy } = useAction();
  const [step, setStep] = useState<null | 'pin' | 'face' | 'off'>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [bio, setBio] = useState(false);
  useEffect(() => { biometricAvailable().then(setBio); }, []);
  const on = s.lockEnabled === true && !!s.lockPin;

  const savePin = () => run(async () => {
    if (!PIN_RE.test(pin)) throw new Error('Le code doit contenir 4 à 6 chiffres.');
    if (pin !== pin2) throw new Error('Les deux codes ne sont pas identiques.');
    await saveSettings({ lockPin: await pinHash(pin), lockEnabled: true });
    setPin(''); setPin2('');
    if (bio && !s.lockCredential) setStep('face');
    else { setStep(null); ui.toast('Verrouillage activé'); }
  });
  const addFace = () => run(async () => {
    const id = await registerBiometric().catch(() => { throw new Error('Face ID n’a pas été activé. Tu peux réessayer, ou garder seulement le code.'); });
    await saveSettings({ lockCredential: id, lockEnabled: true });
    setStep(null);
    ui.toast('Face ID activé');
  });
  const turnOff = () => run(async () => {
    const ok = (s.lockCredential && pin === '' && (await verifyBiometric(s.lockCredential))) || (await checkPin(pin, s.lockPin));
    if (!ok) throw new Error(pin ? 'Code incorrect.' : 'Vérification annulée.');
    await saveSettings({ lockEnabled: false, lockPin: null, lockCredential: null });
    setPin(''); setStep(null);
    ui.toast('Verrouillage désactivé');
  });

  const pinField = (v: string, set: (v: string) => void, label: string) => (
    <Field label={label}>
      <input className="input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={v} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} style={{ letterSpacing: '.4em', fontSize: 20 }} />
    </Field>
  );

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row-between" style={{ alignItems: 'center' }}>
        <b>Verrouillage {bio ? 'Face ID' : 'par code'}</b>
        <span className={`small ${on ? 'pos' : 'muted'}`}>{on ? (s.lockCredential ? 'Face ID + code' : 'Code') : 'Désactivé'}</span>
      </div>
      <p className="tiny faint" style={{ margin: '6px 0 10px' }}>Demande Face ID (ou ton code) pour ouvrir l'appli. Le code de secours sert si Face ID ne marche pas, par exemple sur un nouveau téléphone.</p>
      <ErrorBox error={error} />

      {!on && step !== 'pin' && <button className="btn btn-ghost" onClick={() => setStep('pin')}>🔒 Activer le verrouillage</button>}
      {step === 'pin' && (
        <>
          {pinField(pin, setPin, on ? 'Nouveau code (4 à 6 chiffres)' : 'Choisis un code de secours (4 à 6 chiffres)')}
          {pinField(pin2, setPin2, 'Confirme le code')}
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={savePin}>Enregistrer le code</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setStep(null); setPin(''); setPin2(''); }}>Annuler</button>
          </div>
        </>
      )}
      {step === 'face' && (
        <>
          <p className="small" style={{ margin: '0 0 10px' }}>Code enregistré. Dernière étape : active Face ID (ton iPhone va te le demander).</p>
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={addFace}>Activer Face ID</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setStep(null); ui.toast('Verrouillage par code activé'); }}>Juste le code</button>
          </div>
        </>
      )}
      {on && step === null && (
        <>
          <Field label="Reverrouiller quand je quitte l'appli depuis">
            <div className="seg" role="group" aria-label="Délai de verrouillage">
              {DELAYS.map((d) => <button key={d.v} aria-pressed={(s.lockDelay ?? 1) === d.v} onClick={() => saveSettings({ lockDelay: d.v })}>{d.l}</button>)}
            </div>
          </Field>
          <div className="btn-row">
            {bio && !s.lockCredential && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={addFace}>Ajouter Face ID</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('pin')}>Changer le code</button>
            <button className="btn btn-danger btn-sm" onClick={() => setStep('off')}>Désactiver</button>
          </div>
        </>
      )}
      {step === 'off' && (
        <>
          <p className="small" style={{ margin: '0 0 8px' }}>{s.lockCredential ? 'Confirme avec Face ID, ou entre ton code :' : 'Entre ton code pour confirmer :'}</p>
          {pinField(pin, setPin, 'Code actuel')}
          <div className="btn-row">
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={turnOff}>{pin ? 'Désactiver avec le code' : s.lockCredential ? 'Désactiver avec Face ID' : 'Désactiver'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setStep(null); setPin(''); }}>Annuler</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Dressings : un par compte Vinted. Le pseudo range automatiquement les e-mails de la synchro. */
export function ShopSettings() {
  const s = useData().settings;
  const ui = useUI();
  const { error, run, busy } = useAction();
  const list = shopsOf(s);
  const multi = list.length > 1;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [ePseudo, setEPseudo] = useState('');

  const add = () => run(async () => {
    await addShop(name, pseudo);
    setName(''); setPseudo(''); setAdding(false);
    ui.toast('Dressing ajouté');
  });
  const save = (id: string) => run(async () => { await updateShop(id, { name: eName, pseudo: ePseudo }); setEdit(null); ui.toast('Dressing modifié'); });
  const remove = (id: string, n: string) => run(async () => {
    if (!(await ui.confirm({ title: `Supprimer « ${n} » ?`, text: 'Ses achats, ventes et dépenses ne sont pas effacés : ils passent dans ton dressing principal.', confirmLabel: 'Supprimer le dressing', danger: true }))) return;
    await deleteShop(id); ui.toast('Dressing supprimé');
  });

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <b>Dressings</b>
      <p className="tiny faint" style={{ margin: '6px 0 10px' }}>
        Tu as plusieurs comptes Vinted ? Chaque dressing a ses ventes, ses achats et ses dépenses, et l'accueil montre aussi le total de tous. Indique le pseudo Vinted de chaque compte : la synchro range toute seule chaque e-mail (« Bonjour <i>pseudo</i> ») dans le bon dressing.
      </p>
      <ErrorBox error={error} />
      {multi && (
        <div className="list" style={{ marginBottom: 10 }}>
          {list.map((x) => edit === x.id ? (
            <div key={x.id} className="li" style={{ display: 'block' }}>
              <div className="cols">
                <Field label="Nom"><input className="input" value={eName} onChange={(e) => setEName(e.target.value)} maxLength={30} /></Field>
                <Field label="Pseudo Vinted"><input className="input" value={ePseudo} onChange={(e) => setEPseudo(e.target.value)} autoCapitalize="off" autoCorrect="off" maxLength={40} /></Field>
              </div>
              <div className="btn-row">
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(x.id)}>Enregistrer</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>Annuler</button>
                {x.id !== MAIN && <button className="btn btn-danger btn-sm" onClick={() => remove(x.id, x.name)}>Supprimer</button>}
              </div>
            </div>
          ) : (
            <button key={x.id} className="li" onClick={() => { setEdit(x.id); setEName(x.name); setEPseudo(x.pseudo); }}>
              <span className="li-main">
                <div className="li-title">{x.name}{x.id === MAIN && <span className="shop-tag">principal</span>}</div>
                <div className="li-sub">{x.pseudo ? `@${x.pseudo}` : x.id === MAIN ? 'Tous les e-mails sans autre pseudo' : 'Pseudo Vinted à indiquer'}</div>
              </span>
              <span className="small muted">Modifier</span>
            </button>
          ))}
        </div>
      )}
      {adding ? (
        <>
          <div className="cols">
            <Field label="Nom du dressing"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Dressing 2" maxLength={30} /></Field>
            <Field label="Pseudo Vinted"><input className="input" value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder="ex. clevin.vintage" autoCapitalize="off" autoCorrect="off" maxLength={40} /></Field>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()} onClick={add}>Ajouter</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Annuler</button>
          </div>
        </>
      ) : (
        <button className="btn btn-ghost" onClick={() => setAdding(true)}>👗 {multi ? 'Ajouter un dressing' : 'Ajouter un 2e dressing'}</button>
      )}
    </div>
  );
}
