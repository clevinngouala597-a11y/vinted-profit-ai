import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { saveSettings } from '../lib/actions';
import { getDb } from '../lib/db';
import { formatEuros, parseEuros } from '../lib/money';
import { formatDate, todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { DEFAULT_CATEGORIES, SELLABLE, type SyncedEmail } from '../lib/types';
import { appsScriptSource, newSecret } from '../lib/vinted/appsScript';
import { EVENT_LABEL, titleSimilarity, type VintedEvent } from '../lib/vinted/parse';
import { dismissSynced, guessCategory, resolveSale, syncNow, type SyncResult } from '../lib/vinted/sync';
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
  const configured = !!(s.syncUrl && s.syncToken);
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
  }, [s.syncToken]);
  const [showScript, setShowScript] = useState(false);
  const copyScript = () => {
    if (!s.syncToken) return;
    navigator.clipboard
      .writeText(appsScriptSource(s.syncToken))
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
          <div className="card">
            <div className="row-between"><b>Gmail connecté</b><span className="badge green">Active</span></div>
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
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const r = await syncNow(); setResult(syncSummary(r)); })}>
              {busy ? 'Synchronisation…' : 'Synchroniser maintenant'}
            </button>
            {counts && counts.inbox > 0 && <button className="btn btn-ghost" onClick={() => go('a-valider')}>Voir les {counts.inbox} opérations à valider</button>}
          </div>
          <Field label="Importer les e-mails à partir du" hint="Les e-mails plus anciens ne sont pas lus.">
            <input type="date" className="input" value={since} max={todayISO()} onChange={(e) => { setSince(e.target.value); if (e.target.value) saveSettings({ syncSince: e.target.value }); }} />
          </Field>

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
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => setSetup(true)}>Revoir l'installation</button>
          <button className="btn btn-danger btn-sm" style={{ marginTop: 8, marginLeft: 8 }} onClick={async () => {
            if (await ui.confirm({ title: 'Déconnecter Gmail ?', text: "L'application n'interrogera plus ton script. Les opérations déjà enregistrées sont conservées. Pense aussi à supprimer le déploiement dans Google Apps Script.", confirmLabel: 'Déconnecter', danger: true })) {
              await saveSettings({ syncUrl: '', syncToken: '' });
              setUrl('');
              setSetup(true);
              ui.toast('Gmail déconnecté');
            }
          }}>Déconnecter</button>
        </>
      )}

      {setup && (
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
            <button className="btn btn-primary" onClick={copyScript} disabled={!s.syncToken}>Copier le script</button>
            {s.syncToken && <ScriptPreview token={s.syncToken} open={showScript} />}
          </Step>
          <Step n={2} title="Colle-le dans Google Apps Script">
            <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>Ouvre <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>script.google.com</a> avec ton compte Gmail : un nouveau projet s'ouvre.</li>
              <li>Efface le contenu de l'éditeur, colle le script, puis enregistre (icône disquette).</li>
              <li>En haut, choisis la fonction <b>autoriser</b> puis <b>Exécuter</b>. Accepte l'accès à Gmail. Si Google affiche « application non validée » : <i>Paramètres avancés</i> → <i>Accéder au projet</i> (c'est ton propre script).</li>
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

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="line-card" style={{ paddingBottom: 14 }}>
      <div className="line-card-head"><span>{n}. {title}</span></div>
      {children}
    </div>
  );
}

function ScriptPreview({ token, open }: { token: string; open: boolean }) {
  const code = useMemo(() => appsScriptSource(token), [token]);
  return (
    <details style={{ marginTop: 10 }} open={open || undefined}>
      <summary className="small muted" style={{ cursor: 'pointer' }}>Voir le script</summary>
      <textarea className="input" readOnly value={code} style={{ marginTop: 8, minHeight: 180, fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace' }} onFocus={(e) => e.currentTarget.select()} />
    </details>
  );
}

// ---------------------------------------------------------------------------
// À valider
// ---------------------------------------------------------------------------

export function SyncInbox() {
  const rows = useLiveQuery(() => getDb().syncedEmails.where('status').equals('inbox').sortBy('date'), []);
  return (
    <>
      <PageHeader title="À valider" sub="Opérations Vinted que je n'ai pas pu enregistrer seul" backTo="" />
      {!rows ? <div className="skeleton" style={{ height: 160 }} /> : rows.length === 0 ? (
        <Empty title="Tout est enregistré" text="Les prochaines ventes et paiements Vinted seront ajoutés automatiquement à chaque ouverture." action={<button className="btn btn-ghost" onClick={() => go('synchro')}>Voir la synchro</button>} />
      ) : (
        rows.map((r) => <InboxCard key={r.id} row={r} />)
      )}
    </>
  );
}

function InboxCard({ row }: { row: SyncedEmail }) {
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
