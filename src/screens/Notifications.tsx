import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { dismissNotification, restoreNotifications, toggleNotificationCategory } from '../lib/actions';
import { getDb } from '../lib/db';
import { CATEGORIES, computeNotifications, visibleNotifications, type Notif, type NotifCategory } from '../lib/notifications';
import { todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { IChevron, IClose } from '../ui/icons';
import { Empty, PageHeader, useUI } from '../ui/kit';

/** Notifications visibles (calculées, moins celles que l'utilisateur a masquées). */
export function useNotifications() {
  const ds = useData();
  const dismissed = useLiveQuery(() => getDb().notifications.toArray(), []);
  return useMemo(() => {
    const all = computeNotifications(ds, todayISO());
    const set = new Set((dismissed ?? []).map((d) => d.id));
    return { visible: visibleNotifications(all, set), hidden: all.filter((n) => set.has(n.id)), ready: dismissed !== undefined };
  }, [ds, dismissed]);
}

const DOT: Record<Notif['level'], { cls: string; sym: string; style?: React.CSSProperties }> = {
  danger: { cls: 'bad', sym: '!' },
  warn: { cls: 'out', sym: '!', style: { color: 'var(--warn)', background: 'var(--warn-soft)' } },
  info: { cls: 'out', sym: 'i' },
  ok: { cls: 'in', sym: '✓' },
};

export function NotifRow({ n, onDismiss }: { n: Notif; onDismiss?: () => void }) {
  const d = DOT[n.level];
  return (
    <div className="li" style={{ alignItems: 'flex-start' }}>
      <span className={`dot ${d.cls}`} style={d.style}>{d.sym}</span>
      <button className="li-main" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit' }} onClick={() => go(n.to)}>
        <div className="li-title" style={{ whiteSpace: 'normal' }}>{n.title}</div>
        <div className="li-sub" style={{ whiteSpace: 'normal' }}>{n.text}</div>
      </button>
      {onDismiss ? (
        <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label={`Masquer : ${n.title}`} onClick={onDismiss}>
          <IClose width={15} height={15} />
        </button>
      ) : (
        <IChevron className="faint" />
      )}
    </div>
  );
}

export function NotificationsScreen() {
  const ds = useData();
  const ui = useUI();
  const { visible, hidden, ready } = useNotifications();
  const disabled = ds.settings.disabledNotifications;

  return (
    <>
      <PageHeader title="Notifications" sub={visible.length ? `${visible.length} à traiter` : 'Tout est à jour'} backTo="" />
      {!ready ? <div className="skeleton" style={{ height: 160 }} /> : visible.length === 0 ? (
        <Empty title="Rien à signaler" text="Les alertes apparaissent ici quand un article reste trop longtemps en stock, qu'une donnée manque ou qu'une échéance approche." />
      ) : (
        <div className="list">
          {visible.map((n) => (
            <NotifRow key={n.id} n={n} onDismiss={async () => { await dismissNotification(n.id); ui.toast('Notification masquée'); }} />
          ))}
        </div>
      )}
      {visible.length > 0 && <p className="tiny faint">Une notification masquée ne revient que si la situation change.</p>}
      {hidden.length > 0 && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={async () => { await restoreNotifications(); ui.toast('Notifications réaffichées'); }}>
          {hidden.length > 1 ? `Réafficher les ${hidden.length} notifications masquées` : 'Réafficher la notification masquée'}
        </button>
      )}

      <h2>Types d'alertes</h2>
      <div className="list">
        {(Object.keys(CATEGORIES) as NotifCategory[]).map((c) => (
          <label key={c} className="li" style={{ cursor: 'pointer' }}>
            <span className="li-main"><span className="li-title" style={{ fontWeight: 600, fontSize: 14.5 }}>{CATEGORIES[c]}</span></span>
            <input
              type="checkbox"
              style={{ width: 22, height: 22, accentColor: 'var(--green)' }}
              checked={!disabled.includes(c)}
              onChange={(e) => toggleNotificationCategory(c, e.target.checked)}
              aria-label={CATEGORIES[c]}
            />
          </label>
        ))}
      </div>
      <p className="tiny faint">Les alertes s'affichent dans l'application. Les notifications du téléphone (push) nécessiteraient un serveur, pas encore disponible.</p>
    </>
  );
}
