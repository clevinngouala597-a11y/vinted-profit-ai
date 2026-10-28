import { useEffect, useRef, useState, type ReactNode } from 'react';
import { checkPin, shouldRelock, verifyBiometric } from '../lib/lock';
import { useData } from '../lib/useData';

/**
 * Écran de verrouillage : à l'ouverture, et au retour dans l'appli après le délai choisi.
 * Quand l'appli passe en arrière-plan, son contenu est flouté (aperçu du sélecteur d'apps).
 */
export function AppLock({ children }: { children: ReactNode }) {
  const s = useData().settings;
  const on = s.lockEnabled === true && !!s.lockPin;
  const [locked, setLocked] = useState(on);
  const hiddenAt = useRef<number | null>(null);
  const delay = s.lockDelay ?? 1;

  // le verrou vient d'être activé dans les réglages : pas de verrouillage immédiat
  useEffect(() => { if (!on) setLocked(false); }, [on]);

  useEffect(() => {
    if (!on) return;
    const vis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        document.documentElement.classList.add('app-hidden');
      } else {
        document.documentElement.classList.remove('app-hidden');
        if (shouldRelock(hiddenAt.current, Date.now(), delay)) setLocked(true);
        hiddenAt.current = null;
      }
    };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); document.documentElement.classList.remove('app-hidden'); };
  }, [on, delay]);

  return (
    <>
      <div className="lockable" aria-hidden={locked || undefined} style={locked ? { visibility: 'hidden' } : undefined}>{children}</div>
      {locked && <LockScreen credential={s.lockCredential} pinHash={s.lockPin} onUnlock={() => setLocked(false)} />}
    </>
  );
}

function LockScreen({ credential, pinHash, onUnlock }: { credential: string | null; pinHash: string | null; onUnlock: () => void }) {
  const [mode, setMode] = useState<'face' | 'pin'>(credential ? 'face' : 'pin');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [fails, setFails] = useState(0);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);

  const face = async () => {
    if (!credential || busy) return;
    setBusy(true); setMsg(null);
    const ok = await verifyBiometric(credential);
    setBusy(false);
    if (ok) onUnlock();
    else setMsg('Face ID n’a pas fonctionné. Réessaie ou utilise ton code.');
  };

  const tryPin = async (p: string) => {
    if (Date.now() < wait) return setMsg('Trop d’essais : patiente 30 secondes.');
    if (await checkPin(p, pinHash)) return onUnlock();
    const f = fails + 1; setFails(f); setPin('');
    if (f % 5 === 0) setWait(Date.now() + 30_000);
    setMsg('Code incorrect.');
  };

  const press = (k: string) => {
    setMsg(null);
    if (k === '⌫') return setPin(pin.slice(0, -1));
    const p = (pin + k).slice(0, 6);
    setPin(p);
  };

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Appli verrouillée">
      <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={76} height={76} style={{ borderRadius: 18 }} />
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '14px 0 4px' }}>CNG Vinted est verrouillée</h1>
      {mode === 'face' ? (
        <>
          <p className="muted small" style={{ margin: '0 0 22px' }}>Tes chiffres sont protégés.</p>
          <button className="btn btn-primary" style={{ maxWidth: 320 }} onClick={face} disabled={busy}>{busy ? 'Vérification…' : '🔓 Déverrouiller avec Face ID'}</button>
          {msg && <p className="small neg" style={{ marginTop: 12 }}>{msg}</p>}
          <button className="link" style={{ marginTop: 16 }} onClick={() => { setMode('pin'); setMsg(null); }}>Utiliser mon code</button>
        </>
      ) : (
        <>
          <p className="muted small" style={{ margin: '0 0 16px' }}>Entre ton code</p>
          <div className="pin-dots" aria-label={`${pin.length} chiffres saisis`}>
            {Array.from({ length: 6 }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
          </div>
          <p className="small neg" style={{ minHeight: 20, margin: '10px 0 4px' }}>{msg}</p>
          <div className="pin-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
              k ? <button key={i} onClick={() => press(k)} aria-label={k === '⌫' ? 'Effacer' : k}>{k}</button> : <span key={i} />)}
          </div>
          <button className="btn btn-primary" style={{ maxWidth: 320, marginTop: 12 }} disabled={pin.length < 4} onClick={() => tryPin(pin)}>Valider</button>
          {credential && <button className="link" style={{ marginTop: 14 }} onClick={() => { setMode('face'); setMsg(null); setPin(''); }}>Utiliser Face ID</button>}
        </>
      )}
    </div>
  );
}
