import { useMemo, useRef, useState } from 'react';
import { inRange, type PLEntry } from '../lib/engine';
import { formatEuros } from '../lib/money';
import { buckets, type Range } from '../lib/period';

type Metric = 'revenue' | 'profit' | 'items';
const METRICS: { id: Metric; label: string }[] = [
  { id: 'revenue', label: "Chiffre d'affaires" },
  { id: 'profit', label: 'Bénéfice' },
  { id: 'items', label: 'Ventes' },
];

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const fmtDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const label = (d: string) => fmtDay.format(new Date(`${d}T12:00:00Z`));

/** Points jour par jour (≤ 92 jours), sinon par mois. */
function points(r: Range, today: string) {
  const to = r.to > today ? today : r.to;
  const days = Math.round((Date.parse(to) - Date.parse(r.from)) / DAY) + 1;
  if (days <= 0) return [];
  if (days <= 92) return Array.from({ length: days }, (_, i) => { const d = addDays(r.from, i); return { from: d, to: d, label: label(d) }; });
  return buckets(r, today).map((b) => ({ from: b.from, to: b.to, label: b.label }));
}

const valueOf = (e: PLEntry[], m: Metric) =>
  m === 'revenue' ? e.reduce((a, x) => a + x.revenue, 0)
  : m === 'profit' ? e.reduce((a, x) => a + x.revenue - x.cogs - x.saleCosts, 0)
  : e.reduce((a, x) => a + x.itemsSold, 0);

/** Courbe lissée (Catmull-Rom → Bézier), sans dépasser franchement les points. */
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    // points de contrôle bornés entre les deux points : la courbe ne « déborde » jamais (pas de faux creux sous 0)
    const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
    const c = (v: number) => Math.min(hi, Math.max(lo, v));
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${c(p1[1] + (p2[1] - p0[1]) * t)} ${p2[0] - (p3[0] - p1[0]) * t},${c(p2[1] - (p3[1] - p1[1]) * t)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * p).find((x) => x >= v)!;
};
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

/** Graphique façon tableau de bord : période en cours (trait plein) vs période précédente (pointillés). */
export function TrendChart({ entries, range, prevRange, today }: { entries: PLEntry[]; range: Range; prevRange: Range; today: string }) {
  const [metric, setMetric] = useState<Metric>('revenue');
  const [sel, setSel] = useState<number | null>(null);
  const [cumul, setCumul] = useState(true);
  const svg = useRef<SVGSVGElement>(null);

  const data = useMemo(() => {
    const cur = points(range, today);
    const prev = points(prevRange, prevRange.to).slice(0, Math.max(cur.length, 1));
    const at = (b: { from: string; to: string }, m: Metric) => valueOf(entries.filter((x) => inRange(x.date, b.from, b.to)), m);
    const totals = Object.fromEntries(METRICS.map(({ id }) => [id, { cur: valueOf(entries.filter((x) => inRange(x.date, range.from, range.to)), id), prev: valueOf(entries.filter((x) => inRange(x.date, prevRange.from, prevRange.to)), id) }])) as Record<Metric, { cur: number; prev: number }>;
    // cumul : on voit où l'on en est par rapport à la période précédente au même moment
    const run = (xs: number[]) => (cumul ? xs.map(((t) => (v: number) => (t += v))(0)) : xs);
    return { cur, prev, curV: run(cur.map((b) => at(b, metric))), prevV: run(prev.map((b) => at(b, metric))), totals };
  }, [entries, range, prevRange, today, metric, cumul]);

  const fmt = (v: number) => (metric === 'items' ? String(v) : formatEuros(v));
  const fmtAxis = (v: number) => (metric === 'items' ? String(Math.round(v)) : v >= 1000_00 ? `${(v / 100_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€` : `${Math.round(v / 100)} €`);

  const W = 340, H = 170, L = 44, R = 8, T = 10, B = 22;
  const all = [...data.curV, ...data.prevV];
  const max = niceMax(Math.max(0, ...all));
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const n = Math.max(data.cur.length, 2);
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + ((max - v) / span) * (H - T - B);
  const curPts = data.curV.map((v, i) => [x(i), y(v)] as [number, number]);
  const prevPts = data.prevV.map((v, i) => [x(i), y(v)] as [number, number]);
  const area = curPts.length > 1 ? `${smooth(curPts)} L${curPts[curPts.length - 1][0]},${y(min)} L${curPts[0][0]},${y(min)} Z` : '';
  const empty = all.every((v) => v === 0);

  const pick = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || !data.cur.length) return;
    const px = ((clientX - r.left) / r.width) * W;
    setSel(Math.max(0, Math.min(data.cur.length - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  const s = sel !== null && sel < data.cur.length ? sel : null;
  const ticks = [max, (max + min) / 2, min];
  const xl = data.cur.length ? [0, Math.floor((data.cur.length - 1) / 2), data.cur.length - 1].filter((v, i, a) => a.indexOf(v) === i) : [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
        {METRICS.map(({ id, label: l }) => {
          const t = data.totals[id];
          const d = pct(t.cur, t.prev);
          const on = metric === id;
          return (
            <button key={id} onClick={() => { setMetric(id); setSel(null); }} aria-pressed={on}
              style={{ flex: 'none', textAlign: 'left', padding: '10px 14px', borderRadius: 18, border: `1px solid ${on ? 'var(--line)' : 'transparent'}`, background: on ? 'var(--card-2)' : 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
              <div className="small" style={{ color: on ? 'var(--text)' : 'var(--muted)', fontWeight: 700 }}>{l}</div>
              <div style={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>
                {id === 'items' ? t.cur : formatEuros(t.cur)}
                {d !== null && <span style={{ fontSize: 13, marginLeft: 6, color: d >= 0 ? 'var(--green)' : 'var(--loss)' }}>{d >= 0 ? '+' : ''}{d} %</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="row-between" style={{ marginBottom: 2 }}>
        <span className="tiny faint">{cumul ? 'Total cumulé depuis le début de la période' : 'Jour par jour'}</span>
        <button className="btn btn-ghost btn-sm" style={{ minHeight: 0, padding: '2px 10px' }} onClick={() => setCumul(!cumul)}>{cumul ? 'Par jour' : 'Cumul'}</button>
      </div>
      <div className="tiny faint" style={{ minHeight: 16 }} aria-live="polite">
        {empty ? 'Aucune vente sur cette période.' : s !== null
          ? <><b style={{ color: 'var(--text)' }}>{cumul ? 'Au ' : ''}{data.cur[s].label}</b> : {fmt(data.curV[s])}{data.prevV[s] !== undefined && <> · période précédente au même moment {fmt(data.prevV[s])}</>}</>
          : 'Touche la courbe pour voir le détail'}
      </div>

      <svg ref={svg} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Évolution sur la période, comparée à la période précédente"
        onPointerDown={(e) => pick(e.clientX)} onPointerMove={(e) => e.buttons && pick(e.clientX)} style={{ touchAction: 'pan-y' }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--faint)">{fmtAxis(t)}</text>
          </g>
        ))}
        {area && <path d={area} fill="url(#trend-fill)" />}
        {prevPts.length > 1 && <path d={smooth(prevPts)} fill="none" stroke="var(--muted)" strokeWidth="1.4" strokeDasharray="4 4" opacity="0.7" />}
        {curPts.length > 1 && <path d={smooth(curPts)} fill="none" stroke="var(--green)" strokeWidth="2.4" strokeLinecap="round" />}
        {s !== null && (
          <g>
            <line x1={x(s)} x2={x(s)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" opacity="0.5" />
            <circle cx={x(s)} cy={y(data.curV[s])} r="4.5" fill="var(--bg)" stroke="var(--green)" strokeWidth="2.4" />
          </g>
        )}
        {xl.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === data.cur.length - 1 ? 'end' : 'middle'} fontSize="10" fill="var(--faint)">{data.cur[i].label}</text>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i style={{ background: 'var(--green)' }} />Cette période</span>
        <span><i style={{ background: 'var(--muted)', opacity: 0.7 }} />Période précédente</span>
      </div>
    </div>
  );
}
