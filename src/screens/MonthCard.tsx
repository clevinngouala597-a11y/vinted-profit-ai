import { useEffect, useMemo, useRef, useState } from 'react';
import { periodMetrics } from '../lib/engine';
import { formatEuros } from '../lib/money';
import { monthEnd, monthStart } from '../lib/period';
import { sellerStats } from '../lib/stats';
import { useData } from '../lib/useData';
import { PageHeader, useUI } from '../ui/kit';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const shift = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/** Résumé du mois en image 1080 × 1350 (format story/post), à garder ou partager. */
export function MonthCard() {
  const ds = useData();
  const ui = useUI();
  const [ym, setYm] = useState(new Date().toISOString().slice(0, 7));
  const canvas = useRef<HTMLCanvasElement>(null);
  const from = monthStart(`${ym}-01`);
  const to = monthEnd(`${ym}-01`);
  const data = useMemo(() => {
    const m = periodMetrics(ds, from, to);
    const st = sellerStats(ds, { from, to }, to);
    const prev = periodMetrics(ds, monthStart(`${shift(ym, -1)}-01`), monthEnd(`${shift(ym, -1)}-01`));
    return { m, st, prev };
  }, [ds, from, to, ym]);
  const label = `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const W = 1080, H = 1350;
    g.fillStyle = '#090B0A'; g.fillRect(0, 0, W, H);
    const grad = g.createRadialGradient(W * 0.85, 120, 10, W * 0.85, 120, 700);
    grad.addColorStop(0, 'rgba(99,247,123,0.22)'); grad.addColorStop(1, 'rgba(99,247,123,0)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const font = (w: number, s: number) => `${w} ${s}px Inter, -apple-system, system-ui, sans-serif`;
    g.fillStyle = '#63F77B'; g.font = font(900, 44); g.fillText('CNG', 80, 120);
    g.fillStyle = '#F5F5F5'; g.font = font(600, 44); g.fillText('Vinted', 190, 120);
    g.fillStyle = '#A1A1AA'; g.font = font(500, 40); g.fillText(`Mon mois de ${label}`, 80, 200);

    g.fillStyle = '#A1A1AA'; g.font = font(600, 34); g.fillText('Bénéfice', 80, 330);
    g.fillStyle = data.m.commercialProfit >= 0 ? '#63F77B' : '#FF5D5D'; g.font = font(900, 150);
    g.fillText(formatEuros(data.m.commercialProfit), 72, 480);
    if (data.prev.commercialProfit > 0) {
      const d = Math.round(((data.m.commercialProfit - data.prev.commercialProfit) / data.prev.commercialProfit) * 100);
      g.fillStyle = d >= 0 ? '#63F77B' : '#FF5D5D'; g.font = font(700, 34);
      g.fillText(`${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} % vs mois précédent`, 80, 545);
    }

    const tile = (x: number, y: number, title: string, value: string) => {
      g.fillStyle = '#141714'; g.beginPath(); g.roundRect(x, y, 440, 190, 36); g.fill();
      g.strokeStyle = '#292D29'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#A1A1AA'; g.font = font(600, 30); g.fillText(title, x + 36, y + 64);
      g.fillStyle = '#F5F5F5'; g.font = font(800, 62); g.fillText(value, x + 36, y + 148);
    };
    tile(80, 620, "Chiffre d'affaires", formatEuros(data.m.revenue));
    tile(560, 620, 'Articles vendus', String(data.m.itemsSold));
    tile(80, 840, 'Panier moyen', data.st.avgBasket === null ? '—' : formatEuros(data.st.avgBasket));
    tile(560, 840, 'Meilleur jour', data.st.bestWeekday ?? '—');

    if (data.st.best) {
      g.fillStyle = '#141714'; g.beginPath(); g.roundRect(80, 1060, 920, 150, 36); g.fill(); g.stroke();
      g.fillStyle = '#A1A1AA'; g.font = font(600, 28); g.fillText('🏆 Meilleure vente', 116, 1112);
      let name = data.st.best.name; g.font = font(800, 40);
      while (g.measureText(name).width > 600 && name.length > 4) name = `${name.slice(0, -2)}…`;
      g.fillStyle = '#F5F5F5'; g.fillText(name, 116, 1170);
      g.fillStyle = '#63F77B'; g.textAlign = 'right'; g.fillText(`+${formatEuros(data.st.best.profit)}`, 964, 1170); g.textAlign = 'left';
    }
    g.fillStyle = '#6B6F6B'; g.font = font(500, 26);
    const top = data.st.brands[0] ? `Marque n°1 : ${data.st.brands[0].key}  ·  ` : '';
    g.fillText(`${top}${data.m.itemsSold} vente${data.m.itemsSold > 1 ? 's' : ''} sur Vinted`, 80, 1290);
  }, [data, label]);

  const share = async () => {
    const c = canvas.current!;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob) return;
    const file = new File([blob], `cng-vinted-${ym}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file] }); return; }
    } catch (e) { if ((e as Error).name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    ui.toast('Image enregistrée');
  };

  return (
    <>
      <PageHeader title="Résumé du mois" sub="Ton mois en une image, à garder ou partager" backTo="" />
      <div className="row-between" style={{ marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setYm(shift(ym, -1))}>‹ Précédent</button>
        <b style={{ textTransform: 'capitalize' }}>{label}</b>
        <button className="btn btn-ghost btn-sm" disabled={ym >= new Date().toISOString().slice(0, 7)} onClick={() => setYm(shift(ym, 1))}>Suivant ›</button>
      </div>
      <canvas ref={canvas} width={1080} height={1350} style={{ width: '100%', borderRadius: 20, border: '1px solid var(--line)' }} />
      {data.st.missingCost > 0 && <p className="small warn">{data.st.missingCost} vente{data.st.missingCost > 1 ? 's' : ''} sans prix d'achat : bénéfice surestimé.</p>}
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={share}>Partager / enregistrer l'image</button>
    </>
  );
}
