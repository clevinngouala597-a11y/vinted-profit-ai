import { useState } from 'react';
import { PERIOD_LABEL, periodRange, todayISO, type PeriodKey, type Range } from '../lib/period';
import { Field } from '../ui/kit';
import { BETA } from '../lib/beta';

const KEY = BETA ? 'vpa-beta.period' : 'vpa.period';
function load(): { key: PeriodKey; custom?: Range } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && v.key in PERIOD_LABEL) return v;
  } catch { /* stockage indisponible */ }
  return { key: 'mois' };
}

export function usePeriod() {
  const [state, setState] = useState(load);
  const update = (s: { key: PeriodKey; custom?: Range }) => {
    setState(s);
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  };
  const today = todayISO();
  return { ...state, range: periodRange(state.key, today, state.custom), today, set: update };
}

export function PeriodPicker({ p }: { p: ReturnType<typeof usePeriod> }) {
  const [from, setFrom] = useState(p.range.from);
  const [to, setTo] = useState(p.range.to);
  return (
    <>
      <div className="chips" role="group" aria-label="Période">
        {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => (
          <button key={k} className="chip" aria-pressed={p.key === k} onClick={() => p.set({ key: k, custom: k === 'perso' ? { from, to } : undefined })}>
            {PERIOD_LABEL[k]}
          </button>
        ))}
      </div>
      {p.key === 'perso' && (
        <div className="cols" style={{ marginTop: 10 }}>
          <Field label="Du">
            <input type="date" className="input" value={from} max={to} onChange={(e) => { setFrom(e.target.value); if (e.target.value) p.set({ key: 'perso', custom: { from: e.target.value, to } }); }} />
          </Field>
          <Field label="Au">
            <input type="date" className="input" value={to} min={from} onChange={(e) => { setTo(e.target.value); if (e.target.value) p.set({ key: 'perso', custom: { from, to: e.target.value } }); }} />
          </Field>
        </div>
      )}
    </>
  );
}
