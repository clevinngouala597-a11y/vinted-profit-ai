import { useEffect, useRef, useState } from 'react';
import { formatEuros } from '../lib/money';
import { go } from '../lib/router';
import { installAudioUnlock, onSales, playSaleSound, type SaleAlert } from '../lib/saleAlert';

const SHOW_MS = 7000;

/** Bannière « Nouvelle vente » en haut de l'écran, avec le son de caisse. */
export function SaleBanner() {
  const [sales, setSales] = useState<SaleAlert[] | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    installAudioUnlock();
    return onSales((list) => {
      setSales(list);
      setLeaving(false);
      playSaleSound();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setLeaving(true), SHOW_MS);
    });
  }, []);

  if (!sales) return null;
  const close = () => setLeaving(true);
  const total = sales.reduce((s, x) => s + (x.amount ?? 0), 0);
  const one = sales.length === 1 ? sales[0] : null;
  const open = () => {
    close();
    go(sales.every((s) => s.recorded) ? 'ventes' : 'a-valider');
  };

  return (
    <div
      className={`sale-banner${leaving ? ' leaving' : ''}`}
      role="alert"
      onAnimationEnd={() => leaving && setSales(null)}
    >
      <button className="sale-banner-body" onClick={open}>
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={38} height={38} />
        <span className="sale-banner-text">
          <span className="sale-banner-app">CNG VINTED · maintenant</span>
          <b>{one ? 'Nouvelle vente !' : `${sales.length} nouvelles ventes !`}</b>
          <span className="sale-banner-line">
            {one ? one.title : 'Sur Vinted'}
          </span>
        </span>
        <span className="sale-banner-amount">{formatEuros(one ? one.amount ?? 0 : total)}</span>
      </button>
      <button className="sale-banner-close" aria-label="Fermer" onClick={close}>×</button>
    </div>
  );
}
