import type { ISODate } from './types';

export type PeriodKey = '7j' | '30j' | 'mois' | 'mois_prec' | 'trimestre' | 'annee' | 'perso';

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  '7j': '7 jours',
  '30j': '30 jours',
  mois: 'Ce mois',
  mois_prec: 'Mois dernier',
  trimestre: 'Trimestre',
  annee: 'Année',
  perso: 'Personnalisée',
};

const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s: ISODate): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayISO = (): ISODate => toISO(new Date());

export const addDays = (s: ISODate, n: number): ISODate => {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};

export const monthStart = (s: ISODate): ISODate => s.slice(0, 8) + '01';
export const monthEnd = (s: ISODate): ISODate => {
  const d = fromISO(monthStart(s));
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};
export const addMonths = (s: ISODate, n: number): ISODate => {
  const d = fromISO(monthStart(s));
  return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1));
};

export interface Range {
  from: ISODate;
  to: ISODate;
}

export function periodRange(key: PeriodKey, today: ISODate, custom?: Range): Range {
  switch (key) {
    case '7j':
      return { from: addDays(today, -6), to: today };
    case '30j':
      return { from: addDays(today, -29), to: today };
    case 'mois':
      return { from: monthStart(today), to: monthEnd(today) };
    case 'mois_prec': {
      const s = addMonths(today, -1);
      return { from: s, to: monthEnd(s) };
    }
    case 'trimestre': {
      const d = fromISO(today);
      const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
      return { from: toISO(qStart), to: monthEnd(toISO(new Date(qStart.getFullYear(), qStart.getMonth() + 2, 1))) };
    }
    case 'annee':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'perso':
      return custom ?? { from: monthStart(today), to: today };
  }
}

/** Période précédente de même nature (mois → mois précédent, sinon même nombre de jours juste avant). */
export function previousRange(key: PeriodKey, r: Range): Range {
  if (key === 'mois' || key === 'mois_prec') {
    const s = addMonths(r.from, -1);
    return { from: s, to: monthEnd(s) };
  }
  if (key === 'trimestre') {
    const s = addMonths(r.from, -3);
    return { from: s, to: monthEnd(addMonths(s, 2)) };
  }
  if (key === 'annee') {
    const y = Number(r.from.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  const len = Math.round((fromISO(r.to).getTime() - fromISO(r.from).getTime()) / 86_400_000) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const longFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const monthYearFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

export const formatDate = (s: ISODate | null | undefined) => (s ? fromISO(s).toLocaleDateString('fr-FR') : '—');
export const formatDateLong = (s: ISODate) => longFmt.format(fromISO(s));
export const formatMonth = (s: ISODate) => monthYearFmt.format(fromISO(s));
export const formatRange = (r: Range) => `du ${formatDate(r.from)} au ${formatDate(r.to)}`;

/** Découpage d'une plage en tranches pour un graphique (jours, semaines ou mois selon la durée). */
export function buckets(r: Range, today: ISODate) {
  const to = r.to > today ? today : r.to;
  const days = Math.round((fromISO(to).getTime() - fromISO(r.from).getTime()) / 86_400_000) + 1;
  const out: { key: string; label: string; from: ISODate; to: ISODate }[] = [];
  if (days <= 0) return out;
  if (days <= 14) {
    for (let i = 0; i < days; i++) {
      const d = addDays(r.from, i);
      out.push({ key: d, label: dayFmt.format(fromISO(d)), from: d, to: d });
    }
  } else if (days <= 92) {
    for (let s = r.from; s <= to; s = addDays(s, 7)) {
      const e = addDays(s, 6) > to ? to : addDays(s, 6);
      out.push({ key: s, label: dayFmt.format(fromISO(s)), from: s, to: e });
    }
  } else {
    for (let s = monthStart(r.from); s <= to; s = addMonths(s, 1)) {
      out.push({ key: s, label: monthFmt.format(fromISO(s)), from: s < r.from ? r.from : s, to: monthEnd(s) });
    }
  }
  return out;
}
