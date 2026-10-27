import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { saveSettings } from '../lib/actions';
import { getDb } from '../lib/db';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { SCRIPT_VERSION } from '../lib/vinted/appsScript';
import { buildLabelsPdf, labelList, labelsToPrint, type LabelRow } from '../lib/vinted/labels';
import { Empty, ErrorBox, PageHeader, useAction, useUI } from '../ui/kit';

const fmtDeadline = (d: string | null) => {
  if (!d) return 'date limite inconnue';
  const [day, time] = d.split('T');
  const [y, m, dd] = day.split('-');
  return `avant le ${dd}/${m}${y !== String(new Date().getFullYear()) ? `/${y}` : ''} à ${time.replace(':', ' h ')}`;
};

/** Bordereaux d'envoi Vinted reçus par e-mail : sélection, assemblage en un PDF, impression. */
export function Labels() {
  const ds = useData();
  const ui = useUI();
  const s = ds.settings;
  const rows = useLiveQuery(() => getDb().syncedEmails.where('date').aboveOrEqual(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)).toArray(), []);
  const list = useMemo(() => (rows ? labelList(rows, s.printedLabels ?? []) : null), [rows, s.printedLabels]);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [ready, setReady] = useState<{ file: File; url: string; ids: string[]; missing: number } | null>(null);
  const [showOld, setShowOld] = useState(false);
  const { error, run, busy } = useAction();
  const format = s.labelFormat ?? 'etiquette';

  useEffect(() => {
    if (list && selected === null) setSelected(new Set(labelsToPrint(list).map((l) => l.id)));
  }, [list, selected]);
  useEffect(() => () => { if (ready) URL.revokeObjectURL(ready.url); }, [ready]);

  if (!s.syncUrl) {
    return (
      <>
        <PageHeader title="Bordereaux" backTo="" />
        <Empty title="Connecte d'abord ton Gmail" text="Les bordereaux arrivent dans tes e-mails Vinted : la synchro les retrouve toute seule." action={<button className="btn btn-primary" onClick={() => go('synchro')}>Synchro Vinted</button>} />
      </>
    );
  }

  const sel = selected ?? new Set<string>();
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); setReady(null); };
  const current = (list ?? []).filter((l) => !l.expired);
  const old = (list ?? []).filter((l) => l.expired);

  const prepare = () => run(async () => {
    const ids = [...sel];
    if (!ids.length) throw new Error('Coche au moins un bordereau.');
    const r = await buildLabelsPdf(ids, format);
    const name = `bordereaux-vinted-${new Date().toISOString().slice(0, 10)}.pdf`;
    setReady({ file: new File([r.blob], name, { type: 'application/pdf' }), url: URL.createObjectURL(r.blob), ids: r.printedIds, missing: r.missing.length });
  });

  const print = async () => {
    if (!ready) return;
    // feuille de partage iOS/Android : « Imprimer » (AirPrint) ou l'appli de l'imprimante d'étiquettes
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (nav.canShare?.({ files: [ready.file] })) await nav.share({ files: [ready.file], title: 'Bordereaux Vinted' });
      else window.open(ready.url, '_blank');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      window.open(ready.url, '_blank');
    }
    await saveSettings({ printedLabels: [...new Set([...(s.printedLabels ?? []), ...ready.ids])].slice(-300) });
    setSelected(new Set());
    setReady(null);
    ui.toast(`${ready.ids.length} bordereau${ready.ids.length > 1 ? 'x' : ''} marqué${ready.ids.length > 1 ? 's' : ''} comme imprimé${ready.ids.length > 1 ? 's' : ''}`);
  };

  const unprint = (id: string) => saveSettings({ printedLabels: (s.printedLabels ?? []).filter((x) => x !== id) });

  const Row = ({ l }: { l: LabelRow }) => (
    <label className="li" style={{ cursor: 'pointer', opacity: l.printed || l.expired ? 0.6 : 1 }}>
      <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} style={{ width: 22, height: 22, flex: 'none' }} />
      <span className="li-main">
        <div className="li-title" style={{ fontSize: 14 }}>{l.title}</div>
        <div className="li-sub">
          {l.carrier ?? 'Transporteur'} · <span className={l.urgency === 'retard' ? 'neg' : l.urgency === 'urgent' ? 'warn' : ''}>{l.expired ? 'expiré' : fmtDeadline(l.deadline)}</span>
          {l.printed && <> · imprimé <button className="btn btn-ghost btn-sm" style={{ padding: '0 8px', minHeight: 0, marginLeft: 4 }} onClick={(e) => { e.preventDefault(); unprint(l.id); }}>annuler</button></>}
        </div>
      </span>
      {l.urgency === 'urgent' && !l.printed && <span className="badge warn">Urgent</span>}
    </label>
  );

  return (
    <>
      <PageHeader title="Bordereaux" sub="Tes bordereaux d'envoi Vinted reçus par e-mail, imprimés d'un coup" backTo="" />
      <ErrorBox error={error} />
      {(s.scriptVersion ?? 1) < SCRIPT_VERSION && (
        <div className="alert warn" style={{ display: 'block', marginBottom: 12 }}>
          Ton script Google doit être mis à jour (version {SCRIPT_VERSION}) pour télécharger les bordereaux : Menu → Synchro Vinted.
        </div>
      )}

      <div className="seg" role="group" aria-label="Format d'impression" style={{ marginBottom: 6 }}>
        <button aria-pressed={format === 'etiquette'} onClick={() => { saveSettings({ labelFormat: 'etiquette' }); setReady(null); }}>Étiquette 10 × 15</button>
        <button aria-pressed={format === 'a4'} onClick={() => { saveSettings({ labelFormat: 'a4' }); setReady(null); }}>Feuille A4</button>
      </div>
      <p className="tiny faint" style={{ marginTop: 0 }}>
        {format === 'etiquette' ? "Seule l'étiquette est gardée (sans les instructions de Vinted), une par étiquette 10 × 15 cm." : 'Les bordereaux tels que Vinted les envoie, une page A4 chacun.'}
      </p>

      {!list ? <div className="skeleton" style={{ height: 120 }} /> : current.length === 0 && old.length === 0 ? (
        <Empty title="Aucun bordereau" text="Dès qu'un bordereau Vinted arrive dans ton Gmail, il apparaît ici (synchro à chaque ouverture de l'appli)." />
      ) : (
        <>
          <div className="row-between" style={{ margin: '10px 0 6px' }}>
            <b>{current.length} bordereau{current.length > 1 ? 'x' : ''} en cours</b>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(new Set(labelsToPrint(list).map((l) => l.id))); setReady(null); }}>Non imprimés</button>
          </div>
          <div className="list">{current.map((l) => <Row key={l.id} l={l} />)}</div>
          {old.length > 0 && (
            <>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setShowOld(!showOld)}>{showOld ? 'Masquer' : 'Voir'} les {old.length} expirés</button>
              {showOld && <div className="list" style={{ marginTop: 8 }}>{old.map((l) => <Row key={l.id} l={l} />)}</div>}
            </>
          )}
        </>
      )}

      <div className="sticky-actions">
        {!ready ? (
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || sel.size === 0} onClick={prepare}>
            {busy ? 'Préparation du PDF…' : `Préparer ${sel.size} bordereau${sel.size > 1 ? 'x' : ''}`}
          </button>
        ) : (
          <>
            {ready.missing > 0 && <p className="small warn" style={{ margin: '0 0 6px' }}>{ready.missing} sans PDF (QR code à présenter au point relais, rien à imprimer).</p>}
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={print}>🖨️ Imprimer {ready.ids.length} bordereau{ready.ids.length > 1 ? 'x' : ''}</button>
          </>
        )}
      </div>
    </>
  );
}
