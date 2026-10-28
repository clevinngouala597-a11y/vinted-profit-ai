import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { completeItemCost, saveSettings, setCustomSound } from '../lib/actions';
import { getDb } from '../lib/db';
import { formatEuros, parseEuros } from '../lib/money';
import { formatDate, todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { DEFAULT_CATEGORIES, SELLABLE, type SyncedEmail } from '../lib/types';
import { announceSales, previewSound, SOUNDS, type SoundId } from '../lib/saleAlert';
import { appsScriptSource, newSecret, newTopic, SCRIPT_VERSION } from '../lib/vinted/appsScript';
import { driveBackup, driveRestore, PasswordNeeded, removeBackupPassword, rotateScriptKey, sendTestNotification, setBackupPassword } from '../lib/vinted/drive';
import { MIN_PASSWORD } from '../lib/backupCrypto';
import { getSession, googleReady, signOut, startGoogleLogin, tokenValid } from '../lib/google/auth';
import { EVENT_LABEL, titleSimilarity, type VintedEvent } from '../lib/vinted/parse';
import { dismissSynced, guessCategory, NO_PAYMENT_DAYS, pairEvents, resolveSale, syncNow, unpaidInboxSales, type SyncResult } from '../lib/vinted/sync';
import { cents, Empty, ErrorBox, Field, MoneyInput, PageHeader, useAction, useUI } from '../ui/kit';

export const syncSummary = (r: SyncResult) =>
  r.added === 0
    ? 'Aucun nouvel e-mail Vinted.'
    : `${r.applied} opération${r.applied > 1 ? 's' : ''} enregistrée${r.applied > 1 ? 's' : ''}${r.inbox ? ` · ${r.inbox} à valider` : ''}.`;

// ---------------------------------------------------------------------------
// Réglage et installation
// ---------------------------------------------------------------------------

export function VintedSyncScreen() {
  const ds = useData();
  const ui = useUI();
  const s = ds.settings;
  const google = s.syncMode === 'google';
  const configured = google || !!(s.syncUrl && s.syncToken);
  // l'installation par script (option avancée) n'apparaît que si elle est déjà utilisée, ou avec #/synchro?avance
  const advanced = !google && (!!s.syncUrl || location.hash.includes('avance'));
  const [setup, setSetup] = useState(!configured);
  const [url, setUrl] = useState(s.syncUrl);
  const [since, setSince] = useState(s.syncSince ?? s.trackingStart);
  const [result, setResult] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const { error, run, busy } = useAction();
  const counts = useLiveQuery(async () => {
    const rows = await getDb().syncedEmails.toArray();
    return { inbox: rows.filter((r) => r.status === 'inbox').length, applied: rows.filter((r) => r.status === 'applied').length, waiting: rows.filter((r) => r.status === 'waiting').length };
  }, []);
  const recent = useLiveQuery(() => getDb().syncedEmails.where('status').equals('applied').reverse().sortBy('date').then((r) => r.slice(0, 15)), []);

  // la clé est créée dès l'ouverture de l'écran : au moment du toucher sur « Copier », la copie est immédiate
  // (Safari refuse de copier si une écriture en base passe avant)
  useEffect(() => {
    if (!s.syncToken) saveSettings({ syncToken: newSecret() });
    else if (!s.ntfyTopic) saveSettings({ ntfyTopic: newTopic() });
  }, [s.syncToken, s.ntfyTopic]);
  const [showScript, setShowScript] = useState(false);
  const copyScript = () => {
    if (!s.syncToken || !s.ntfyTopic) return;
    navigator.clipboard
      .writeText(appsScriptSource(s.syncToken, s.ntfyTopic))
      .then(() => ui.toast('Script copié'))
      .catch(() => {
        setShowScript(true);
        ui.toast('Copie bloquée : sélectionne le script affiché et copie-le');
      });
  };

  const activate = () => run(async () => {
    const u = url.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(u)) throw new Error("Colle l'adresse de l'application Web : elle commence par https://script.google.com/macros/s/ et se termine par /exec.");
    const k = key.trim().replace(/^'|'$/g, '');
    if (k && !/^[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error("La clé secrète doit être la suite de lettres et chiffres écrite après « const CLE = » dans le script.");
    await saveSettings({ syncUrl: u, syncSince: since, ...(k ? { syncToken: k } : {}) });
    const r = await syncNow();
    setResult(syncSummary(r));
    setSetup(false);
    ui.toast('Synchronisation activée');
  });

  return (
    <>
      <PageHeader title="Synchro Vinted" sub="Tes ventes et achats enregistrés à partir de tes e-mails Vinted" backTo="" />
      <ErrorBox error={error} />
      {result && <div className="alert ok">{result}</div>}

      {configured && !setup && (
        <>
          {google && <GoogleAccount />}
          <div className="card" style={google ? { marginTop: 10 } : undefined}>
            <div className="row-between"><b>{google ? 'Synchro automatique' : 'Gmail connecté'}</b><span className="badge green">Active</span></div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              La synchro se fait toute seule à chaque ouverture de l'application.
              {s.lastSyncAt && <> Dernière : {new Date(s.lastSyncAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.</>}
            </p>
            {counts && (
              <div className="grid2" style={{ marginTop: 12 }}>
                <div className="tile"><div className="tile-label">Enregistrées</div><div className="tile-value">{counts.applied}</div></div>
                <div className="tile" role="button" tabIndex={0} onClick={() => go('a-valider')} style={{ cursor: 'pointer' }}>
                  <div className="tile-label">À valider</div><div className={`tile-value ${counts.inbox ? 'warn' : ''}`}>{counts.inbox}</div>
                </div>
              </div>
            )}
          </div>
          {!google && (s.scriptVersion ?? 1) < SCRIPT_VERSION && <ScriptUpdate copy={copyScript} showScript={showScript} />}
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const r = await syncNow(); setResult(syncSummary(r)); })}>
              {busy ? 'Synchronisation…' : 'Synchroniser maintenant'}
            </button>
            {counts && counts.inbox > 0 && <button className="btn btn-ghost" onClick={() => go('a-valider')}>Voir les {counts.inbox} opérations à valider</button>}
          </div>
          <Field label="Importer les e-mails à partir du" hint="Les e-mails plus anciens ne sont pas lus.">
            <input type="date" className="input" value={since} max={todayISO()} onChange={(e) => { setSince(e.target.value); if (e.target.value) saveSettings({ syncSince: e.target.value }); }} />
          </Field>
          <div style={{ marginTop: 4 }}>
            <label className="check" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={s.autoRecord !== false} onChange={(e) => run(async () => { await saveSettings({ autoRecord: e.target.checked }); if (e.target.checked) { const r = await syncNow(); setResult(syncSummary(r)); } })} />
              <span><b>Tout enregistrer automatiquement</b><br /><span className="small muted">Sans confirmation : un article vendu qui n'est pas dans ton stock est créé tout seul (tu pourras ajouter son prix d'achat plus tard). Une vente sans paiement Vinted après {NO_PAYMENT_DAYS} jours n'est pas comptée.</span></span>
            </label>
            <label className="check" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={s.saleAlert !== false} onChange={(e) => saveSettings({ saleAlert: e.target.checked })} />
              <span><b>Bannière et son à chaque vente</b><br /><span className="small muted">Dès qu'une nouvelle vente arrive à l'ouverture de l'appli. Le son suit le mode silencieux de ton iPhone.</span></span>
            </label>
            {s.saleAlert !== false && <SoundPicker />}
            <button className="btn btn-ghost btn-sm" onClick={() => announceSales([{ id: 'test', title: 'Exemple : Robe longue rose à fleurs - Taille S', amount: 8000, recorded: true }])}>
              Tester la notification
            </button>
          </div>

          {!google && (s.scriptVersion ?? 1) >= 3 && <PushSection />}
          {(google || (s.scriptVersion ?? 1) >= 3) && <DriveSection />}
          {!google && (s.scriptVersion ?? 1) >= 3 && <KeySection />}

          {recent && recent.length > 0 && (
            <>
              <h2>Dernières opérations synchronisées</h2>
              <div className="list">
                {recent.map((r) => (
                  <div className="li" key={r.id}>
                    <span className="li-main">
                      <div className="li-title" style={{ fontSize: 14 }}>{EVENT_LABEL[r.kind as VintedEvent['kind']] ?? r.kind} · {r.title}</div>
                      <div className="li-sub">{formatDate(r.date)} · {r.note}</div>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {!google && <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => setSetup(true)}>Revoir l'installation</button>}
          {!google && <button className="btn btn-danger btn-sm" style={{ marginTop: 8, marginLeft: 8 }} onClick={async () => {
            if (await ui.confirm({ title: 'Déconnecter Gmail ?', text: "L'application n'interrogera plus ton script. Les opérations déjà enregistrées sont conservées. Pense aussi à supprimer le déploiement dans Google Apps Script.", confirmLabel: 'Déconnecter', danger: true })) {
              await saveSettings({ syncUrl: '', syncToken: '' });
              setUrl('');
              setSetup(true);
              ui.toast('Gmail déconnecté');
            }
          }}>Déconnecter</button>}
        </>
      )}

      {setup && !advanced && <GoogleConnect since={since} setSince={setSince} />}

      {setup && advanced && (
        <>
          <div className="card small" style={{ marginBottom: 12 }}>
            <b>Comment ça marche</b>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Un petit script installé dans <b>ton</b> compte Google lit les e-mails envoyés par Vinted (ventes, paiements, expéditions, annulations, factures de boost, achats).
              À chaque ouverture, l'application les récupère et les enregistre toute seule. Ton mot de passe Vinted n'est jamais utilisé, et le script ne répond qu'à cette application grâce à une clé secrète.
            </p>
          </div>
          <p className="small muted">L'installation prend 5 minutes, une seule fois. Elle est plus confortable sur ordinateur ; sur iPhone, demande la « version ordinateur » du site dans Safari.</p>

          <Step n={1} title="Copie ton script">
            <button className="btn btn-primary" onClick={copyScript} disabled={!s.syncToken || !s.ntfyTopic}>Copier le script</button>
            {s.syncToken && s.ntfyTopic && <ScriptPreview token={s.syncToken} topic={s.ntfyTopic} open={showScript} />}
          </Step>
          <Step n={2} title="Colle-le dans Google Apps Script">
            <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>Ouvre <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>script.google.com</a> avec ton compte Gmail : un nouveau projet s'ouvre.</li>
              <li>Efface le contenu de l'éditeur, colle le script, puis enregistre (icône disquette).</li>
              <li>En haut, choisis la fonction <b>installer</b> puis <b>Exécuter</b>. Accepte les accès demandés (Gmail, Drive pour les sauvegardes, services externes pour les notifications). Si Google affiche « application non validée » : <i>Paramètres avancés</i> → <i>Accéder au projet</i> (c'est ton propre script).</li>
            </ol>
          </Step>
          <Step n={3} title="Déploie-le en application Web">
            <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li><b>Déployer</b> → <b>Nouveau déploiement</b> → type <b>Application Web</b>.</li>
              <li>Exécuter en tant que : <b>Moi</b>. Qui a accès : <b>Tout le monde</b> (la clé secrète protège l'accès).</li>
              <li><b>Déployer</b>, puis copie l'<b>URL de l'application Web</b> (elle se termine par /exec).</li>
            </ol>
          </Step>
          <Step n={4} title="Colle l'adresse et active">
            <Field label="URL de l'application Web">
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </Field>
            <Field label="Importer les e-mails à partir du" hint="Avant cette date, rien n'est importé (évite de recréer d'anciennes ventes).">
              <input type="date" className="input" value={since} max={todayISO()} onChange={(e) => setSince(e.target.value)} />
            </Field>
            <details style={{ marginBottom: 12 }}>
              <summary className="small muted" style={{ cursor: 'pointer' }}>Script reçu autrement (fichier, ordinateur) ?</summary>
              <Field label="Clé secrète du script" hint="Recopie la clé écrite après « const CLE = » dans ton script. Laisse vide si tu as utilisé « Copier le script » ci-dessus.">
                <input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ex. Zk3…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </Field>
            </details>
            <button className="btn btn-primary" onClick={activate} disabled={busy || !s.syncToken}>{busy ? 'Test en cours…' : 'Tester et activer'}</button>
          </Step>
        </>
      )}
    </>
  );
}

/** Le script installé est d'une version antérieure : mise à jour en 2 minutes (même adresse). */
function ScriptUpdate({ copy, showScript }: { copy: () => void; showScript: boolean }) {
  const s = useData().settings;
  return (
    <div className="card" style={{ marginTop: 12, borderColor: 'rgba(99,247,123,.4)' }}>
      <b>Nouveau : sauvegarde Google Drive et notifications appli fermée</b>
      <p className="small muted" style={{ margin: '6px 0 10px' }}>Mets ton script à jour une fois (2 minutes, plus simple sur ordinateur). Ton adresse /exec ne change pas.</p>
      <ol className="small" style={{ margin: '0 0 12px', paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li>Appuie sur <b>Copier le script</b> ci-dessous.</li>
        <li>Sur <a href="https://script.google.com/home" target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>script.google.com</a>, ouvre ton projet, <b>sélectionne tout le code</b>, efface-le, colle le nouveau, puis <b>enregistre</b> (disquette).</li>
        <li>En haut, choisis la fonction <b>installer</b> → <b>Exécuter</b>, et accepte les nouvelles autorisations (Drive, services externes).</li>
        <li><b>Déployer</b> → <b>Gérer les déploiements</b> → ✏️ → Version : <b>Nouvelle version</b> → <b>Déployer</b>.</li>
        <li>Reviens ici et appuie sur <b>Synchroniser maintenant</b>.</li>
      </ol>
      <button className="btn btn-primary btn-sm" onClick={copy} disabled={!s.syncToken || !s.ntfyTopic}>Copier le script</button>
      {s.syncToken && s.ntfyTopic && <ScriptPreview token={s.syncToken} topic={s.ntfyTopic} open={showScript} />}
    </div>
  );
}

/** Notifications à chaque vente, même appli fermée (appli ntfy). */
function PushSection() {
  const s = useData().settings;
  const ui = useUI();
  const { error, run, busy } = useAction();
  const copyTopic = () => navigator.clipboard.writeText(s.ntfyTopic).then(() => ui.toast('Nom copié')).catch(() => ui.toast(s.ntfyTopic));
  return (
    <>
      <h2>Notifications appli fermée</h2>
      <div className="card">
        <div className="row-between">
          <b>Une notification à chaque vente</b>
          <span className={`badge ${s.scriptNotifications ? 'green' : 'warn'}`}>{s.scriptNotifications ? 'Actives' : 'À activer'}</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 10px' }}>Ton script vérifie ton Gmail toutes les 5 minutes et t'envoie une notification sur l'écran verrouillé (vente et paiement reçu), avec l'appli gratuite ntfy.</p>
        <ErrorBox error={error} />
        <ol className="small" style={{ margin: '0 0 12px', paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>Installe <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>ntfy</a> depuis l'App Store et autorise ses notifications.</li>
          <li>Dans ntfy, appuie sur <b>+</b>, colle ce nom de sujet, puis <b>Subscribe</b> :</li>
        </ol>
        <div className="row-between" style={{ gap: 8, marginBottom: 10 }}>
          <code style={{ fontSize: 13, wordBreak: 'break-all' }}>{s.ntfyTopic}</code>
          <button className="btn btn-ghost btn-sm" onClick={copyTopic}>Copier</button>
        </div>
        <p className="tiny faint" style={{ marginTop: 0 }}>Ce nom est secret : quelqu'un qui le connaît pourrait lire tes notifications de vente. Le texte des notifications (article, montant) passe par le service ntfy.sh.</p>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => {
          const active = await sendTestNotification();
          ui.toast(active ? 'Notification envoyée : regarde ton iPhone' : 'Notification envoyée — lance « installer » dans ton script pour la vérification automatique');
        })}>{busy ? 'Envoi…' : 'Envoyer une notification de test'}</button>
      </div>
    </>
  );
}

/** Sauvegarde automatique dans le Google Drive de l'utilisateur. */
function DriveSection() {
  const s = useData().settings;
  const ui = useUI();
  const { error, run, busy } = useAction();
  const last = s.driveBackupAt ? new Date(s.driveBackupAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : null;
  const [askPw, setAskPw] = useState(false);
  const [restorePw, setRestorePw] = useState('');
  const [encStep, setEncStep] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const encrypted = !!s.backupKey;
  const restore = (pw?: string) => run(async () => {
    try {
      const r = await driveRestore(fetch, pw);
      setAskPw(false); setRestorePw('');
      ui.toast(`Restauré : ${r.sales} ventes, ${r.items} articles`);
    } catch (e) {
      if (e instanceof PasswordNeeded) { setAskPw(true); return; }
      throw e;
    }
  });
  const saveEnc = () => run(async () => {
    if (pw1 !== pw2) throw new Error('Les deux mots de passe ne sont pas identiques.');
    await setBackupPassword(pw1);
    setPw1(''); setPw2(''); setEncStep(false);
    ui.toast('Sauvegardes chiffrées : une première sauvegarde chiffrée est faite');
  });
  return (
    <>
      <h2>Sauvegarde Google Drive</h2>
      <div className="card">
        <div className="row-between">
          <b>Sauvegarde automatique</b>
          <span className={`badge ${last ? 'green' : 'warn'}`}>{last ? 'Active' : 'Pas encore faite'}</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 10px' }}>
          Toutes tes données sont copiées dans ton Google Drive (dossier « CNG Vinted - sauvegardes ») toutes les 12 heures quand tu ouvres l'appli. Les 30 derniers jours sont gardés.
          {last && <> Dernière sauvegarde : <b>{last}</b>.</>}
        </p>
        <ErrorBox error={error} />
        <div className="btn-row">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await driveBackup(); ui.toast('Sauvegardé dans ton Google Drive'); })}>{busy ? '…' : 'Sauvegarder maintenant'}</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
            const ok = await ui.confirm({
              title: 'Restaurer depuis Google Drive ?',
              text: 'Toutes les données de l’appli sur ce téléphone sont remplacées par la dernière sauvegarde de ton Drive. À utiliser sur un nouveau téléphone ou après une perte de données.',
              confirmLabel: 'Restaurer', danger: true,
            });
            if (ok) restore();
          }}>Restaurer</button>
        </div>
        {askPw && (
          <div style={{ marginTop: 12 }}>
            <Field label="Mot de passe de sauvegarde" hint="Cette sauvegarde est chiffrée.">
              <input className="input" type="password" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} autoComplete="current-password" />
            </Field>
            <button className="btn btn-primary btn-sm" disabled={busy || !restorePw} onClick={() => restore(restorePw)}>Ouvrir et restaurer</button>
          </div>
        )}

        <div className="row-between" style={{ marginTop: 16, alignItems: 'center' }}>
          <b>🔐 Chiffrement</b>
          <span className={`badge ${encrypted ? 'green' : 'warn'}`}>{encrypted ? 'Activé' : 'Désactivé'}</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 10px' }}>
          {encrypted
            ? 'Tes sauvegardes sont chiffrées avec ton mot de passe : sans lui, personne ne peut les lire, même avec accès à ton Drive.'
            : 'Protège tes sauvegardes avec un mot de passe : sans lui, le fichier dans ton Drive est illisible.'}
        </p>
        {encStep ? (
          <>
            <Field label={`Mot de passe de sauvegarde (${MIN_PASSWORD} caractères minimum)`}><input className="input" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Confirme le mot de passe"><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
            <p className="tiny warn" style={{ marginTop: 0 }}>⚠️ Note-le bien (par exemple dans les mots de passe de ton iPhone) : s'il est perdu, les sauvegardes chiffrées ne peuvent plus être ouvertes. Personne ne peut le retrouver.</p>
            <div className="btn-row">
              <button className="btn btn-primary btn-sm" disabled={busy || pw1.length < MIN_PASSWORD} onClick={saveEnc}>{busy ? 'Chiffrement…' : 'Chiffrer mes sauvegardes'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEncStep(false); setPw1(''); setPw2(''); }}>Annuler</button>
            </div>
          </>
        ) : (
          <div className="btn-row">
            <button className="btn btn-ghost btn-sm" onClick={() => setEncStep(true)}>{encrypted ? 'Changer le mot de passe' : 'Chiffrer avec un mot de passe'}</button>
            {encrypted && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
              if (await ui.confirm({ title: 'Ne plus chiffrer ?', text: 'Les prochaines sauvegardes seront lisibles par toute personne ayant accès à ton Drive.', confirmLabel: 'Arrêter le chiffrement', danger: true }))
                run(async () => { await removeBackupPassword(); ui.toast('Chiffrement désactivé'); });
            }}>Désactiver</button>}
          </div>
        )}
      </div>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="line-card" style={{ paddingBottom: 14 }}>
      <div className="line-card-head"><span>{n}. {title}</span></div>
      {children}
    </div>
  );
}

function ScriptPreview({ token, topic, open }: { token: string; topic: string; open: boolean }) {
  const code = useMemo(() => appsScriptSource(token, topic), [token, topic]);
  return (
    <details style={{ marginTop: 10 }} open={open || undefined}>
      <summary className="small muted" style={{ cursor: 'pointer' }}>Voir le script</summary>
      <textarea className="input" readOnly value={code} style={{ marginTop: 8, minHeight: 180, fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace' }} onFocus={(e) => e.currentTarget.select()} />
    </details>
  );
}

// ---------------------------------------------------------------------------
// Prix d'achat à compléter
// ---------------------------------------------------------------------------

export function MissingCosts() {
  const ds = useData();
  const items = ds.items.filter((i) => i.costPending).sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
  return (
    <>
      <PageHeader title="Prix d'achat à indiquer" sub="Articles créés par la synchro Vinted" backTo="" />
      {items.length === 0 ? (
        <Empty title="Tout est complet" text="Tous tes articles ont un prix d'achat : ton bénéfice est exact." action={<button className="btn btn-ghost" onClick={() => go('')}>Accueil</button>} />
      ) : (
        <>
          <p className="small muted">Tant que le prix d'achat n'est pas indiqué, il compte pour 0 € : le bénéfice affiché est trop haut. Mets 0 si l'article t'appartenait déjà.</p>
          {items.map((i) => <CostRow key={i.id} itemId={i.id} />)}
        </>
      )}
    </>
  );
}

function CostRow({ itemId }: { itemId: string }) {
  const ds = useData();
  const ui = useUI();
  const item = ds.items.find((i) => i.id === itemId)!;
  const line = ds.saleLines.filter((l) => l.itemId === itemId).at(-1);
  const sale = line ? ds.sales.find((s) => s.id === line.saleId) : undefined;
  const [cost, setCost] = useState('');
  const { error, run, busy } = useAction();
  const save = () => run(async () => {
    const c = parseEuros(cost);
    if (c === null || c < 0) throw new Error("Indique ce que t'a coûté l'article (0 si c'était à toi).");
    await completeItemCost(itemId, c);
    ui.toast('Prix enregistré');
  });
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 800 }}>{item.name}</div>
      <div className="small muted" style={{ margin: '2px 0 8px' }}>
        {sale ? <>Vendu le {formatDate(sale.date)} · {formatEuros(sale.sellerRevenue)}{sale.orderStatus === 'annulee' ? ' (annulée)' : ''}</> : 'En stock'}
      </div>
      <ErrorBox error={error} />
      <div className="cols" style={{ alignItems: 'end' }}>
        <Field label="Prix d'achat"><MoneyInput value={cost} onChange={setCost} /></Field>
        <button className="btn btn-primary" style={{ marginBottom: 12 }} disabled={busy || !cost.trim()} onClick={save}>OK</button>
      </div>
      {sale && cost.trim() && parseEuros(cost) !== null && sale.orderStatus !== 'annulee' && (
        <p className="small" style={{ margin: '-4px 0 0' }}>Bénéfice : <b className={sale.sellerRevenue - cents(cost) < 0 ? 'neg' : 'pos'}>{formatEuros(sale.sellerRevenue - cents(cost), { signed: true })}</b></p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// À valider
// ---------------------------------------------------------------------------

export function SyncInbox() {
  const all = useLiveQuery(() => getDb().syncedEmails.toArray(), []);
  const ui = useUI();
  const { error, run, busy } = useAction();
  const today = todayISO();
  const view = useMemo(() => {
    if (!all) return null;
    const rows = all.filter((r) => r.status === 'inbox').sort((a, b) => a.date.localeCompare(b.date));
    return { rows, closedBy: pairEvents(all).closedBy, unpaid: unpaidInboxSales(all, today) };
  }, [all, today]);

  const dismissUnpaid = () => run(async () => {
    if (!view) return;
    const n = view.unpaid.length;
    const ok = await ui.confirm({
      title: `Ignorer ${n} vente${n > 1 ? 's' : ''} sans paiement ?`,
      text: `Aucun paiement Vinted n'a été reçu pour ${n > 1 ? 'ces ventes' : 'cette vente'} depuis plus de ${NO_PAYMENT_DAYS} jours : elles ont sans doute été annulées ou remboursées. Vérifie dans Vinted (Mes commandes → « Remboursement effectué ») avant de continuer.`,
      confirmLabel: 'Ignorer',
    });
    if (!ok) return;
    await dismissSynced(view.unpaid.map((r) => r.id));
    ui.toast(`${n} vente${n > 1 ? 's' : ''} ignorée${n > 1 ? 's' : ''}`);
  });

  return (
    <>
      <PageHeader title="À valider" sub="Opérations Vinted que je n'ai pas pu enregistrer seul" backTo="" />
      <ErrorBox error={error} />
      {!view ? <div className="skeleton" style={{ height: 160 }} /> : view.rows.length === 0 ? (
        <Empty title="Tout est enregistré" text="Les prochaines ventes et paiements Vinted seront ajoutés automatiquement à chaque ouverture." action={<button className="btn btn-ghost" onClick={() => go('synchro')}>Voir la synchro</button>} />
      ) : (
        <>
          {view.unpaid.length > 0 && (
            <div className="alert warn" style={{ marginBottom: 12, display: 'block' }}>
              <b>{view.unpaid.length} vente{view.unpaid.length > 1 ? 's' : ''} sans paiement reçu</b>
              <p className="small" style={{ margin: '4px 0 10px' }}>
                Vinted n'a envoyé ni « transaction finalisée » ni annulation depuis plus de {NO_PAYMENT_DAYS} jours : ce sont sans doute des ventes remboursées. Elles sont marquées « Sans paiement » ci-dessous.
              </p>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={dismissUnpaid}>Les ignorer toutes</button>
            </div>
          )}
          {view.rows.map((r) => <InboxCard key={r.id} row={r} closure={view.closedBy.get(r.id) ?? null} unpaid={view.unpaid.includes(r)} />)}
        </>
      )}
    </>
  );
}

function ClosureLine({ row, closure, unpaid }: { row: SyncedEmail; closure: SyncedEmail | null; unpaid: boolean }) {
  if (row.kind !== 'sale') return null;
  if (closure?.kind === 'completed') {
    const amt = (closure.event as VintedEvent & { kind: 'completed' }).amount;
    return <p className="small pos" style={{ margin: '4px 0 0' }}>✓ Paiement reçu le {formatDate(closure.date)}{amt !== null ? ` (${formatEuros(amt)})` : ''} : il sera enregistré avec la vente.</p>;
  }
  if (closure?.kind === 'cancelled') return <p className="small muted" style={{ margin: '4px 0 0' }}>Annulée le {formatDate(closure.date)} : l'article reviendra en vente après validation.</p>;
  if (unpaid) return <p className="small warn" style={{ margin: '4px 0 0' }}><b>Sans paiement</b> depuis {NO_PAYMENT_DAYS} jours ou plus : sans doute remboursée → Ignorer.</p>;
  return <p className="small muted" style={{ margin: '4px 0 0' }}>Paiement pas encore reçu (normal pour une vente récente).</p>;
}

function InboxCard({ row, closure, unpaid }: { row: SyncedEmail; closure: SyncedEmail | null; unpaid: boolean }) {
  const ds = useData();
  const ui = useUI();
  const ev = row.event as VintedEvent;
  const isSale = ev.kind === 'sale' || ev.kind === 'completed';
  const amount = ev.kind === 'sale' ? ev.amount : ev.kind === 'completed' ? ev.amount : null;
  const stock = useMemo(
    () => ds.items.filter((i) => SELLABLE.includes(i.status)).map((i) => ({ i, s: titleSimilarity(i.name, row.title) })).sort((a, b) => b.s - a.s || a.i.name.localeCompare(b.i.name)),
    [ds.items, row.title],
  );
  const [mode, setMode] = useState<'stock' | 'new'>(stock.length && stock[0].s > 0.3 ? 'stock' : 'new');
  const [itemId, setItemId] = useState(stock[0]?.i.id ?? '');
  const [name, setName] = useState(row.title.replace(/\s*[-–]\s*Taille\s+\S+$/i, ''));
  const [category, setCategory] = useState(guessCategory(row.title));
  const [cost, setCost] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(row.date);
  const { error, run, busy } = useAction();
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...ds.settings.customCategories])];

  const validate = () => run(async () => {
    if (mode === 'stock') {
      if (!itemId) throw new Error("Choisis l'article vendu.");
      await resolveSale(row.id, { itemId });
    } else {
      const c = parseEuros(cost);
      if (c === null || c < 0) throw new Error("Indique ce que t'a coûté l'article (0 si c'était à toi).");
      if (!name.trim()) throw new Error("Indique le nom de l'article.");
      await resolveSale(row.id, { newItem: { name: name.trim(), category, cost: c, purchaseDate } });
    }
    ui.toast('Vente enregistrée');
  });

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row-between">
        <span className="badge warn">{EVENT_LABEL[ev.kind]}</span>
        <span className="small muted">{formatDate(row.date)}</span>
      </div>
      <div style={{ fontWeight: 800, margin: '8px 0 2px' }}>{row.title}</div>
      {amount !== null && <div className="small">Montant : <b>{formatEuros(amount)}</b></div>}
      <ClosureLine row={row} closure={closure} unpaid={unpaid} />
      <p className="small muted" style={{ margin: '6px 0 10px' }}>{row.note}</p>
      <ErrorBox error={error} />

      {isSale ? (
        <>
          <div className="seg" role="group" aria-label="Article vendu" style={{ marginBottom: 10 }}>
            <button aria-pressed={mode === 'stock'} onClick={() => setMode('stock')} disabled={!stock.length}>Article du stock</button>
            <button aria-pressed={mode === 'new'} onClick={() => setMode('new')}>Nouvel article</button>
          </div>
          {mode === 'stock' ? (
            <Field label="Article vendu">
              <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                {stock.map(({ i }) => <option key={i.id} value={i.id}>{i.name}{i.size ? ` · ${i.size}` : ''} · coût {formatEuros(i.purchasePrice + i.directFees)}</option>)}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Nom de l'article"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <div className="cols">
                <Field label="Ce qu'il t'a coûté"><MoneyInput value={cost} onChange={setCost} /></Field>
                <Field label="Acheté le"><input type="date" className="input" value={purchaseDate} max={row.date} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
              </div>
              <Field label="Catégorie">
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
              {amount !== null && cost.trim() && parseEuros(cost) !== null && (
                <p className="small" style={{ marginTop: -4 }}>Bénéfice : <b className={amount - cents(cost) < 0 ? 'neg' : 'pos'}>{formatEuros(amount - cents(cost), { signed: true })}</b></p>
              )}
            </>
          )}
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" onClick={validate} disabled={busy}>Enregistrer la vente</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await dismissSynced(row.id); ui.toast('Écarté'); })}>Ignorer</button>
          </div>
        </>
      ) : (
        <div className="btn-row">
          <button className="btn btn-ghost btn-sm" onClick={() => go('stock?filtre=tous')}>Ouvrir le stock</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await dismissSynced(row.id); ui.toast('Marqué comme traité'); })}>C'est traité</button>
        </div>
      )}
    </div>
  );
}

/** Choix du son de vente : sons créés pour l'appli, ou ton propre fichier. */
function SoundPicker() {
  const s = useData().settings;
  const { error, run } = useAction();
  const ui = useUI();
  const cur = (s.saleSound || 'kaching') as SoundId;
  const pick = (id: SoundId) => run(async () => {
    if (id === 'perso' && !s.customSoundId) return;
    await saveSettings({ saleSound: id });
    previewSound(id);
  });
  return (
    <div style={{ margin: '0 0 12px 32px' }}>
      <div className="small muted" style={{ marginBottom: 6 }}>Son de vente (touche pour écouter)</div>
      <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
        {SOUNDS.filter((o) => o.id !== 'perso' || s.customSoundId).map((o) => (
          <button key={o.id} className="chip" aria-pressed={cur === o.id} onClick={() => pick(o.id)}>▶ {o.label}</button>
        ))}
      </div>
      <label className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
        🎵 {s.customSoundId ? 'Changer mon son' : 'Importer mon son'}
        <input type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) run(async () => { await setCustomSound(f); ui.toast('Ton son est enregistré'); setTimeout(() => previewSound('perso'), 300); });
        }} />
      </label>
      <p className="tiny faint" style={{ margin: '6px 0 0' }}>MP3, M4A ou WAV de quelques secondes (2 Mo max), par exemple un son enregistré avec ton téléphone. Les notifications appli fermée (ntfy) gardent le son de l'iPhone.</p>
      <ErrorBox error={error} />
    </div>
  );
}

/** Clé secrète du script : la changer si elle a pu être vue (capture d'écran, téléphone prêté…). */
function KeySection() {
  const s = useData().settings;
  const ui = useUI();
  const { error, run, busy } = useAction();
  const ready = (s.scriptVersion ?? 1) >= 4;
  return (
    <>
      <h2>Sécurité du script</h2>
      <div className="card">
        <b>🔑 Clé secrète</b>
        <p className="small muted" style={{ margin: '6px 0 10px' }}>
          Ton script Google ne répond qu'à l'appli qui connaît sa clé secrète. Si quelqu'un a pu la voir (capture de cet écran, téléphone prêté…), change-la : l'ancienne ne marchera plus du tout.
        </p>
        <ErrorBox error={error} />
        {ready ? (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
            if (await ui.confirm({ title: 'Changer la clé secrète ?', text: "Une nouvelle clé est créée et envoyée à ton script. Rien d'autre à faire : la synchro continue normalement.", confirmLabel: 'Changer la clé' }))
              run(async () => { await rotateScriptKey(); ui.toast('Nouvelle clé en place : l’ancienne ne fonctionne plus'); });
          }}>{busy ? 'Changement…' : 'Changer la clé secrète'}</button>
        ) : (
          <p className="small warn" style={{ margin: 0 }}>Mets d'abord ton script à jour (carte « Mettre à jour le script » plus haut) pour pouvoir changer la clé.</p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Connexion Google (méthode simple, par défaut)
// ---------------------------------------------------------------------------

function GoogleButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button className="google-btn" onClick={onClick} disabled={disabled}>
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      {label}
    </button>
  );
}

function GoogleConnect({ since, setSince }: { since: string; setSince: (v: string) => void }) {
  const { error, run } = useAction();
  const ready = googleReady();
  return (
    <>
      <div className="card" style={{ textAlign: 'center', padding: '26px 18px' }}>
        <div style={{ fontSize: 40 }}>📬</div>
        <h2 style={{ margin: '8px 0 6px' }}>Connecte ton Gmail</h2>
        <p className="small muted" style={{ margin: '0 auto 18px', maxWidth: 380 }}>
          Tes ventes, paiements, expéditions et achats Vinted s'enregistrent tout seuls à partir des e-mails que Vinted t'envoie. Un seul toucher, rien à installer.
        </p>
        <ErrorBox error={error} />
        <GoogleButton disabled={!ready} label={ready ? 'Se connecter avec Google' : 'Bientôt disponible'}
          onClick={() => run(async () => { await saveSettings({ syncSince: since }); startGoogleLogin(); })} />
        <ul className="small muted" style={{ textAlign: 'left', margin: '18px auto 0', maxWidth: 380, paddingLeft: 18, display: 'grid', gap: 5 }}>
          <li><b>Lecture seule</b> : l'appli lit uniquement les e-mails envoyés par Vinted. Elle n'envoie, ne modifie et ne supprime rien.</li>
          <li>Tout reste sur ton téléphone : aucun serveur ne reçoit tes e-mails.</li>
          <li>Ton mot de passe Vinted n'est jamais demandé.</li>
          <li>Si Google affiche « Google n'a pas validé cette application » : touche <b>Paramètres avancés</b>, puis <b>Accéder à CNG Vinted</b>.</li>
          <li><a href={`${import.meta.env.BASE_URL}confidentialite.html`} target="_blank" rel="noopener">Règles de confidentialité</a></li>
        </ul>
      </div>
      <Field label="Importer les e-mails à partir du" hint="Avant cette date, rien n'est importé.">
        <input type="date" className="input" value={since} max={todayISO()} onChange={(e) => setSince(e.target.value)} />
      </Field>
    </>
  );
}

/** Compte Google connecté : adresse, état de la connexion, reconnexion, déconnexion. */
function GoogleAccount() {
  const s = useData().settings;
  const ui = useUI();
  const session = getSession();
  const live = tokenValid(session);
  return (
    <div className="card">
      <div className="row-between" style={{ alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="google-dot">G</span>
          <span><b>{s.googleEmail ?? 'Compte Google'}</b><br /><span className="small muted">{live ? 'Connecté' : 'Connexion à renouveler'}</span></span>
        </span>
        <span className={`badge ${live ? 'green' : 'warn'}`}>{live ? 'Gmail' : 'Expirée'}</span>
      </div>
      {!live && (
        <div style={{ marginTop: 12 }}>
          <GoogleButton label="Se reconnecter" onClick={() => startGoogleLogin({ hint: s.googleEmail })} />
        </div>
      )}
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={async () => {
        if (await ui.confirm({ title: 'Déconnecter Google ?', text: "L'appli ne lira plus tes e-mails Vinted. Tes ventes déjà enregistrées sont conservées.", confirmLabel: 'Déconnecter', danger: true })) {
          await signOut();
          await saveSettings({ syncMode: null, googleEmail: null });
          ui.toast('Compte Google déconnecté');
        }
      }}>Déconnecter</button>
    </div>
  );
}
