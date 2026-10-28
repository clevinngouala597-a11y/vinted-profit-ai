import { useState } from 'react';
import { BUILD, deviceSummary, FEEDBACK_KINDS, feedbackMessage, sendFeedback, type FeedbackInput, type FeedbackKind } from '../lib/beta';
import { go } from '../lib/router';
import { ErrorBox, Field, PageHeader, useAction, useUI } from '../ui/kit';

/** « Donner mon avis » (version bêta) : envoyé directement en notification au créateur de l'appli. */
export function Feedback({ from }: { from?: string }) {
  const ui = useUI();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [tech, setTech] = useState(true);
  const [sent, setSent] = useState(false);
  const { error, run, busy } = useAction();

  const input = (): FeedbackInput => ({
    kind, rating, message, contact,
    tech: tech ? {
      screen: from ? decodeURIComponent(from) : '',
      build: BUILD,
      device: deviceSummary(navigator.userAgent, matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true, window.innerWidth),
    } : null,
  });

  const share = async () => {
    const m = feedbackMessage(input());
    const text = `${m.title}\n\n${m.message}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); ui.toast('Avis copié : colle-le dans un message'); }
    } catch { /* partage annulé */ }
  };

  if (sent) {
    return (
      <>
        <PageHeader title="Merci !" backTo="" />
        <div className="card" style={{ textAlign: 'center', padding: '30px 18px' }}>
          <div style={{ fontSize: 52 }}>🙏</div>
          <p style={{ fontWeight: 800, fontSize: 19, margin: '8px 0 4px' }}>Ton avis est bien arrivé.</p>
          <p className="muted small" style={{ margin: 0 }}>Chaque retour aide à améliorer l'appli pour tous les revendeurs.</p>
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => { setSent(false); setMessage(''); setRating(null); }}>Envoyer un autre avis</button>
          <button className="btn btn-primary" onClick={() => go('')}>Retour à l'accueil</button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Donner mon avis" sub="Tu testes la bêta : dis-moi tout, même les petits détails" backTo={from ? decodeURIComponent(from) : ''} />
      <ErrorBox error={error} />
      <div className="card">
        <div className="field">
          <span id="fb-kind">C'est plutôt…</span>
          <div className="chips" role="group" aria-labelledby="fb-kind" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {FEEDBACK_KINDS.map((k) => <button key={k.id} className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>)}
          </div>
        </div>
        <Field label={kind === 'bug' ? 'Que s’est-il passé ?' : kind === 'idee' ? 'Ton idée' : kind === 'pasclair' ? 'Qu’est-ce qui n’est pas clair ?' : 'Qu’est-ce qui te plaît ?'}
          hint={kind === 'bug' ? 'Sur quel écran, ce que tu as touché, ce que tu attendais.' : undefined}>
          <textarea className="input" value={message} onChange={(e) => setMessage(e.target.value)} style={{ minHeight: 140 }} maxLength={3000}
            placeholder={kind === 'bug' ? 'ex. Sur « Ventes », quand je touche « Terminée », rien ne change' : kind === 'idee' ? 'ex. Pouvoir trier les ventes par bénéfice' : ''} />
        </Field>
        <div className="field">
          <span>Ta note de l'appli (facultatif)</span>
          <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Note sur 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} aria-label={`${n} sur 5`} aria-pressed={rating === n} onClick={() => setRating(rating === n ? null : n)}
                style={{ fontSize: 32, lineHeight: 1, background: 'none', border: 0, padding: 4, color: rating && n <= rating ? 'var(--green)' : 'var(--faint)' }}>★</button>
            ))}
          </div>
        </div>
        <Field label="Pour te répondre (facultatif)" hint="Pseudo Vinted, Instagram, TikTok… seulement si tu veux une réponse.">
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} autoCapitalize="off" />
        </Field>
        <label className="check" style={{ marginBottom: 0 }}>
          <input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} />
          <span><b>Joindre les infos techniques</b><br /><span className="small muted">L'écran d'où tu viens, la version de l'appli et le type de téléphone. Aucune de tes ventes ni de tes chiffres.</span></span>
        </label>
      </div>
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={busy || message.trim().length < 3}
        onClick={() => run(async () => { await sendFeedback(input()); setSent(true); })}>{busy ? 'Envoi…' : 'Envoyer mon avis'}</button>
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={message.trim().length < 3} onClick={share}>Ou l'envoyer par message</button>
      <p className="tiny faint">Ton avis est transmis en notification au créateur de l'appli (via le service ntfy.sh). N'y mets pas d'informations personnelles sensibles.</p>
    </>
  );
}
