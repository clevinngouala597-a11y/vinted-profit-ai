import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUI } from './kit';

const TRIGGER = 72;
const MAX = 120;

/**
 * « Tirer pour actualiser » : en haut de l'écran, tirer vers le bas lance `onRefresh`
 * (la synchro Vinted). Ne s'active pas quand une feuille est ouverte ou qu'on est déjà descendu.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<string>; children: ReactNode }) {
  const ui = useUI();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const st = useRef({ y0: null as number | null, pull: 0, busy: false });
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const toast = useRef(ui.toast);
  toast.current = ui.toast;

  useEffect(() => {
    const s = st.current;
    const start = (e: TouchEvent) => {
      if (s.busy || window.scrollY > 0 || document.querySelector('.sheet, .scrim')) return;
      s.y0 = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => {
      if (s.y0 === null) return;
      const dy = e.touches[0].clientY - s.y0;
      if (dy <= 0 || window.scrollY > 0) { if (s.pull) { s.pull = 0; setPull(0); } return; }
      // résistance progressive, comme sur iOS
      s.pull = Math.min(MAX, dy * 0.5);
      setPull(s.pull);
    };
    const end = async () => {
      if (s.y0 === null) return;
      s.y0 = null;
      const go = s.pull >= TRIGGER;
      s.pull = 0;
      if (!go) return setPull(0);
      s.busy = true;
      setBusy(true);
      setPull(56);
      navigator.vibrate?.(8);
      try {
        const [msg] = await Promise.all([cb.current(), new Promise((r) => setTimeout(r, 700))]);
        toast.current(msg);
      } catch (err) {
        toast.current(err instanceof Error ? err.message : 'Actualisation impossible');
      } finally {
        s.busy = false;
        setBusy(false);
        setPull(0);
      }
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, []);

  const p = Math.min(1, pull / TRIGGER);
  const dragging = pull > 0 && !busy && st.current.y0 !== null;
  return (
    <>
      <div className={`ptr${busy ? ' ptr-busy' : ''}`} aria-hidden={!busy} role="status"
        style={{ transform: `translate(-50%, ${pull - 52}px) scale(${0.6 + p * 0.4})`, opacity: pull ? Math.max(0.2, p) : 0, transition: dragging ? 'none' : undefined }}>
        <svg viewBox="0 0 24 24" width="22" height="22" style={{ transform: busy ? undefined : `rotate(${p * 270}deg)` }}>
          <path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M20 4v4.5h-4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy && <span className="sr-only">Actualisation…</span>}
      </div>
      <div className="ptr-content" style={{ transform: pull ? `translateY(${pull * 0.6}px)` : undefined, transition: dragging ? 'none' : undefined }}>
        {children}
      </div>
    </>
  );
}
