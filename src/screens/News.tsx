import { useEffect, useState } from 'react';
import { lastSeen, markSeen, unseen, visibleChangelog, type ChangeEntry } from '../lib/changelog';
import { formatDateLong } from '../lib/period';
import { useData } from '../lib/useData';
import { PageHeader, Sheet } from '../ui/kit';

function Entry({ e, compact }: { e: ChangeEntry; compact?: boolean }) {
  return (
    <div style={{ marginBottom: compact ? 14 : 18 }}>
      <div className="tiny faint">{formatDateLong(e.date)}</div>
      <div style={{ fontWeight: 800, margin: '2px 0 6px' }}>{e.title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }} className="small">
        {e.points.map((p, i) => <li key={i}>{p.text}</li>)}
      </ul>
    </div>
  );
}

/** Fenêtre affichée une fois à l'ouverture après une mise à jour. */
export function NewsPopup() {
  const ds = useData();
  const [list, setList] = useState<ChangeEntry[]>([]);
  useEffect(() => {
    const isNew = ds.sales.length === 0 && ds.items.length === 0 && ds.expenses.length === 0;
    const l = unseen(lastSeen(), isNew);
    if (l.length) setList(l);
    else markSeen();
    // une seule fois, à l'ouverture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = () => { markSeen(); setList([]); };
  return (
    <Sheet open={list.length > 0} onClose={close} title="Nouveautés">
      <p className="muted small" style={{ marginTop: 0 }}>L’appli vient d’être mise à jour. Voici ce qui change :</p>
      {list.map((e) => <Entry key={e.id} e={e} compact />)}
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={close}>Compris</button>
    </Sheet>
  );
}

/** Historique complet des nouveautés. */
export function NewsScreen() {
  useEffect(() => markSeen(), []);
  const list = visibleChangelog();
  return (
    <>
      <PageHeader title="Nouveautés" sub="Ce qui a changé à chaque mise à jour" backTo="" />
      <div className="card">{list.map((e) => <Entry key={e.id} e={e} />)}</div>
    </>
  );
}
