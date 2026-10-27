import { useState } from 'react';
import type { SeriesPoint } from '../lib/engine';
import { formatEuros } from '../lib/money';

/**
 * Barres groupées chiffre d'affaires / bénéfice. Toucher une colonne affiche ses montants.
 * Les périodes sans données restent à zéro : rien n'est extrapolé.
 */
export function RevenueProfitChart({ data }: { data: SeriesPoint[] }) {
  const [sel, setSel] = useState<number | null>(null);
  if (data.length === 0) return null;
  const W = 340, H = 150, padB = 20, padT = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.profit, 0)));
  const min = Math.min(0, ...data.map((d) => d.profit));
  const span = max - min;
  const y = (v: number) => padT + ((max - v) / span) * (H - padB - padT);
  const slot = W / data.length;
  const bw = Math.max(3, Math.min(14, slot * 0.32));
  const labelEvery = Math.ceil(data.length / 7);
  const active = sel ?? data.length - 1;
  const cur = data[active];
  const empty = data.every((d) => d.revenue === 0 && d.profit === 0);

  return (
    <div>
      <div className="chart-tip" aria-live="polite">
        {empty ? (
          'Aucune vente sur cette période.'
        ) : (
          <>
            {cur.label} · CA <b>{formatEuros(cur.revenue)}</b> · bénéfice{' '}
            <b className={cur.profit < 0 ? 'neg' : ''}>{formatEuros(cur.profit)}</b>
          </>
        )}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chiffre d'affaires et bénéfice par période">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
        {data.map((d, i) => {
          const cx = slot * i + slot / 2;
          const on = i === active && !empty;
          return (
            <g key={d.key} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={slot * i} y={0} width={slot} height={H} fill={on ? 'rgba(255,255,255,0.04)' : 'transparent'} rx="6" />
              <rect x={cx - bw - 1} y={y(Math.max(0, d.revenue))} width={bw} height={Math.max(0, y(0) - y(d.revenue))} rx="3" fill="#3a403a" />
              <rect
                x={cx + 1}
                y={d.profit >= 0 ? y(d.profit) : y(0)}
                width={bw}
                height={Math.abs(y(d.profit) - y(0))}
                rx="3"
                fill={d.profit >= 0 ? 'var(--green)' : 'var(--loss)'}
              />
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--faint)">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i style={{ background: '#3a403a' }} />Chiffre d'affaires</span>
        <span><i style={{ background: 'var(--green)' }} />Bénéfice commercial</span>
      </div>
    </div>
  );
}

export function BarList({ rows, valueOf, format }: {
  rows: { name: string; [k: string]: unknown }[];
  valueOf: (r: { name: string; [k: string]: unknown }) => number;
  format: (r: { name: string; [k: string]: unknown }) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(valueOf(r))));
  return (
    <div>
      {rows.map((r) => {
        const v = valueOf(r);
        return (
          <div className="bar-row" key={r.name}>
            <span style={{ fontWeight: 600 }}>{r.name}</span>
            <span className={v < 0 ? 'neg' : ''} style={{ fontWeight: 700 }}>{format(r)}</span>
            <div className="bar-track"><div className={`bar-fill ${v < 0 ? 'neg' : ''}`} style={{ width: `${(Math.abs(v) / max) * 100}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

/** Courbe simple (ex. valeur du stock en fin de mois). Toucher un point affiche sa valeur. */
export function LineChart({ points, format, empty }: { points: { label: string; value: number }[]; format: (v: number) => string; empty: string }) {
  const [sel, setSel] = useState<number | null>(null);
  if (points.length === 0) return null;
  const W = 340, H = 130, padB = 20, padT = 10, padX = 8;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => padX + (points.length === 1 ? (W - 2 * padX) / 2 : (i * (W - 2 * padX)) / (points.length - 1));
  const y = (v: number) => padT + (1 - v / max) * (H - padB - padT);
  const active = sel ?? points.length - 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const allZero = points.every((p) => p.value === 0);
  const labelEvery = Math.ceil(points.length / 6);
  return (
    <div>
      <div className="chart-tip" aria-live="polite">{allZero ? empty : <>{points[active].label} · <b>{format(points[active].value)}</b></>}</div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Évolution">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
        <path d={`${d} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--green-soft)" />
        <path d={d} fill="none" stroke="var(--green)" strokeWidth="2.2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.label} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
            <rect x={x(i) - W / points.length / 2} y={0} width={W / points.length} height={H} fill="transparent" />
            <circle cx={x(i)} cy={y(p.value)} r={i === active ? 4.5 : 2.5} fill={i === active ? 'var(--text)' : 'var(--green)'} />
            {i % labelEvery === 0 && <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--faint)">{p.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Résultat de chaque mois comparé à son objectif (trait blanc). */
export function GoalChart({ data, format }: { data: { label: string; value: number; target: number }[]; format: (v: number) => string }) {
  const [sel, setSel] = useState<number | null>(null);
  if (data.length === 0) return null;
  const W = 340, H = 140, padB = 20, padT = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.target)));
  const min = Math.min(0, ...data.map((d) => d.value));
  const y = (v: number) => padT + ((max - v) / (max - min)) * (H - padB - padT);
  const slot = W / data.length;
  const bw = Math.max(6, Math.min(22, slot * 0.5));
  const active = sel ?? data.length - 1;
  const cur = data[active];
  const labelEvery = Math.ceil(data.length / 7);
  return (
    <div>
      <div className="chart-tip" aria-live="polite">
        {cur.label} · réalisé <b className={cur.value < 0 ? 'neg' : ''}>{format(cur.value)}</b>
        {cur.target > 0 ? <> · objectif <b>{format(cur.target)}</b></> : ' · pas d’objectif'}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Objectifs et résultats par mois">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
        {data.map((d, i) => {
          const cx = slot * i + slot / 2;
          const reached = d.target > 0 && d.value >= d.target;
          return (
            <g key={d.label} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={slot * i} y={0} width={slot} height={H} fill={i === active ? 'rgba(255,255,255,0.04)' : 'transparent'} rx="6" />
              <rect x={cx - bw / 2} y={d.value >= 0 ? y(d.value) : y(0)} width={bw} height={Math.abs(y(d.value) - y(0))} rx="3"
                fill={d.value < 0 ? 'var(--loss)' : reached || d.target === 0 ? 'var(--green)' : '#3a403a'} />
              {d.target > 0 && <line x1={cx - bw / 2 - 4} x2={cx + bw / 2 + 4} y1={y(d.target)} y2={y(d.target)} stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />}
              {i % labelEvery === 0 && <text x={cx} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--faint)">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i style={{ background: 'var(--green)' }} />Objectif atteint</span>
        <span><i style={{ background: '#3a403a' }} />Pas encore</span>
        <span><i style={{ background: 'var(--text)', height: 2, verticalAlign: 3 }} />Objectif</span>
      </div>
    </div>
  );
}
