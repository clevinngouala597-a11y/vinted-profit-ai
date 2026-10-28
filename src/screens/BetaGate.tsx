import { useState } from 'react';
import { announceTester, LOCKED } from '../lib/beta';
import { ADMIN, checkCode, storeAccess } from '../lib/betaAccess';
import { go } from '../lib/router';
import { ErrorBox, PageHeader } from '../ui/kit';

/** Porte d'entrée de la bêta privée : un code d'invitation par testeur. */
export function BetaGate({ onOpen }: { onOpen: (a: { hash: string; tester: string }) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);

  const submit = async () => {
    if (Date.now() < waitUntil) return setError('Trop d’essais : patiente 30 secondes.');
    setBusy(true); setError(null);
    const ok = await checkCode(code).catch(() => null);
    setBusy(false);
    if (!ok) {
      const f = fails + 1; setFails(f);
      if (f >= 5) { setWaitUntil(Date.now() + 30_000); setFails(0); }
      return setError('Ce code ne fonctionne pas. Vérifie-le (format CNG-XXXXX-XXXXX).');
    }
    storeAccess(ok.hash);
    if (ok.tester !== ADMIN) void announceTester(ok.tester);
    onOpen(ok);
  };

  return (
    <main className="page" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100dvh' }}>
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={84} height={84} style={{ borderRadius: 20 }} />
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', margin: '16px 0 6px' }}>Bêta privée</h1>
        <p className="muted" style={{ margin: 0 }}>CNG Vinted est en test avec un petit groupe de revendeurs. Entre le code d'invitation que tu as reçu.</p>
      </div>
      <div className="card">
        <input className="input gate-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CNG-XXXXX-XXXXX" aria-label="Code d'invitation"
          autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} maxLength={20} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <ErrorBox error={error} />
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || code.replace(/[^a-z0-9]/gi, '').length < 13} onClick={submit}>{busy ? 'Vérification…' : 'Entrer dans la bêta'}</button>
      </div>
      <p className="tiny faint" style={{ textAlign: 'center', marginTop: 14 }}>Pas de code ? Demande-le à la personne qui t'a envoyé ce lien. Un code = une personne.</p>
    </main>
  );
}

/** Fonction réservée à la version complète pendant la bêta. */
export function Locked({ route }: { route: string }) {
  const name = LOCKED[route.split('?')[0]] ?? 'Cette fonction';
  return (
    <>
      <PageHeader title={name} backTo="" />
      <div className="card" style={{ textAlign: 'center', padding: '30px 18px' }}>
        <div style={{ fontSize: 46 }}>🔒</div>
        <p style={{ fontWeight: 800, fontSize: 19, margin: '8px 0 6px' }}>Réservé à la version complète</p>
        <p className="muted small" style={{ margin: 0 }}>Cette fonction n'est pas ouverte pendant la bêta. Pour l'instant, on teste le cœur de l'appli : tes ventes, tes achats, tes dépenses et ton bénéfice.</p>
      </div>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <button className="btn btn-ghost" onClick={() => go(`avis/${encodeURIComponent(route)}`)}>Je veux l'essayer : le dire</button>
        <button className="btn btn-primary" onClick={() => go('')}>Retour à l'accueil</button>
      </div>
    </>
  );
}
