import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { getDb } from '../lib/db';
import { periodMetrics, plEntries } from '../lib/engine';
import { ENTITY_LABEL, humanAction, humanDetails } from '../lib/journal';
import { checkBooks, checkSummary, METRIC_HELP, METRIC_LABEL, sourceRoute, traceMetric, type Check, type Metric } from '../lib/ledger';
import { formatEuros } from '../lib/money';
import { formatMonth, monthEnd, monthStart, todayISO } from '../lib/period';
import { go } from '../lib/router';
import { useData } from '../lib/useData';
import { EVENT_LABEL, type VintedEvent } from '../lib/vinted/parse';
import type { AuditLog, SyncedEmail } from '../lib/types';
import { IChevron } from '../ui/icons';
import { PageHeader, Sheet } from '../ui/kit';

const fr = (d: string) => d.split('-').reverse().join('/');

// ---------------------------------------------------------------------------
// Détail d'un montant
// ---------------------------------------------------------------------------

/** Feuille « D'où vient ce montant ? » : chaque ligne renvoie à son opération. */
export function TraceSheet({ metric, from, to, onClose, sign = 1 }: { metric: Metric | null; from: string; to: string; onClose: () => void; sign?: 1 | -1 }) {
  const ds = useData();
  const t = useMemo(() => (metric ? traceMetric(ds, from, to, metric) : null), [ds, metric, from, to]);
  const [all, setAll] = useState(false);
  if (!metric || !t) return null;
  const rows = all ? t.rows : t.rows.slice(0, 60);
  return (
    <Sheet open onClose={onClose} title={METRIC_LABEL[metric]}>
      <p className="small muted" style={{ marginTop: 0 }}>{METRIC_HELP[metric]} Du {fr(from)} au {fr(to)}.</p>
      <div className="calc" style={{ marginBottom: 10 }}>
        <div className="calc-row total"><span>{t.rows.length} opération{t.rows.length > 1 ? 's' : ''}</span><span>{formatEuros(sign * t.total)}</span></div>
      </div>
      {t.rows.length === 0 ? <div className="card small muted">Aucune opération sur cette période.</div> : (
        <div className="list">
          {rows.map((r, k) => (
            <button key={k} className="li" onClick={() => { onClose(); go(sourceRoute(r.src)); }}>
              <span className="li-main">
                <div className="li-title" style={{ fontSize: 14 }}>{r.label}</div>
                <div className="li-sub">{fr(r.date)}</div>
              </span>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatEuros(sign * r.amount)}</span>
              <IChevron className="faint" />
            </button>
          ))}
        </div>
      )}
      {!all && t.rows.length > rows.length && <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setAll(true)}>Tout afficher ({t.rows.length})</button>}
      <p className="tiny faint">La somme des lignes est exactement le montant du bilan. Touche une ligne pour ouvrir l’opération.</p>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Vérification des comptes
// ---------------------------------------------------------------------------

const LEVEL: Record<Check['level'], { badge: string; word: string }> = {
  ok: { badge: 'green', word: 'OK' },
  warn: { badge: 'warn', word: 'À vérifier' },
  error: { badge: 'red', word: 'Anomalie' },
};

export function Controle() {
  const ds = useData();
  const synced = useLiveQuery(() => getDb().syncedEmails.toArray(), []);
  const today = todayISO();
  const checks = useMemo(() => checkBooks(ds, today, synced ?? []), [ds, today, synced]);
  const sum = checkSummary(checks);
  const [open, setOpen] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric | null>(null);
  const from = monthStart(today);
  const to = monthEnd(today);
  const m = useMemo(() => periodMetrics(ds, from, to, plEntries(ds)), [ds, from, to]);
  const sorted = [...checks].sort((a, b) => rank(b.level) - rank(a.level));

  return (
    <>
      <PageHeader title="Vérification des comptes" sub="Chaque montant relié à son opération, et contrôlé" backTo="" />
      <div className={`alert ${sum.error ? 'error' : sum.warn ? 'warn' : 'ok'}`} style={{ display: 'block' }}>
        {sum.error ? `${sum.error} anomalie${sum.error > 1 ? 's' : ''} à corriger` : sum.warn ? `Comptes cohérents · ${sum.warn} point${sum.warn > 1 ? 's' : ''} à vérifier` : 'Tout est cohérent : chaque montant est justifié.'}
        <div className="tiny" style={{ opacity: 0.8, marginTop: 2 }}>{sum.ok} contrôle{sum.ok > 1 ? 's' : ''} réussi{sum.ok > 1 ? 's' : ''} sur {checks.length}</div>
      </div>

      <h2>Contrôles</h2>
      <div className="list">
        {sorted.map((c) => (
          <div key={c.id} className="li" style={{ display: 'block' }}>
            <button className="row-between" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', padding: 0, textAlign: 'left', cursor: c.refs.length ? 'pointer' : 'default' }}
              aria-expanded={c.refs.length ? open === c.id : undefined} onClick={() => c.refs.length && setOpen(open === c.id ? null : c.id)}>
              <span className="li-main">
                <div className="li-title" style={{ fontSize: 14, whiteSpace: 'normal' }}>{c.title}</div>
                <div className="li-sub" style={{ whiteSpace: 'normal' }}>{c.text}</div>
              </span>
              <span className={`badge ${LEVEL[c.level].badge}`}>{LEVEL[c.level].word}</span>
            </button>
            {open === c.id && (
              <div className="list" style={{ marginTop: 8 }}>
                {c.refs.slice(0, 50).map((r, k) => (
                  <button key={k} className="li" onClick={() => go(r.to)}>
                    <span className="li-main"><div className="li-title" style={{ fontSize: 13.5 }}>{r.label}</div>{r.detail && <div className="li-sub" style={{ whiteSpace: 'normal' }}>{r.detail}</div>}</span>
                    <IChevron className="faint" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <h2>D’où viennent les montants de {formatMonth(from)}</h2>
      <div className="list">
        {(['revenue', 'cogs', 'saleCosts', 'general', 'writeOff', 'purchases'] as Metric[]).map((k) => (
          <button key={k} className="li" onClick={() => setMetric(k)}>
            <span className="li-main"><div className="li-title" style={{ fontSize: 14 }}>{METRIC_LABEL[k]}</div></span>
            <span style={{ fontWeight: 700 }}>{formatEuros(m[k])}</span>
            <IChevron className="faint" />
          </button>
        ))}
      </div>

      <h2>Historique</h2>
      <div className="list">
        <button className="li" onClick={() => go('journal')}>
          <span className="li-main"><div className="li-title">Journal des opérations</div><div className="li-sub">Créations, corrections, remboursements, rapprochements</div></span>
          <IChevron className="faint" />
        </button>
      </div>
      <TraceSheet metric={metric} from={from} to={to} onClose={() => setMetric(null)} />
    </>
  );
}

const rank = (l: Check['level']) => (l === 'error' ? 2 : l === 'warn' ? 1 : 0);

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

type JournalFilter = 'tout' | 'corrections' | 'remboursements' | 'paiements' | 'creations';
const FILTERS: [JournalFilter, string][] = [['tout', 'Tout'], ['corrections', 'Corrections'], ['remboursements', 'Remboursements'], ['paiements', 'Paiements et statuts'], ['creations', 'Créations']];

export function journalKind(l: Pick<AuditLog, 'entity' | 'action'>): JournalFilter {
  const a = l.action.toLowerCase();
  if (l.entity === 'refund' || /rembours|récupéré/.test(a)) return 'remboursements';
  if (/correction|prix d'achat indiqué|coût réparti|à la main|suppression|annulation|modification/.test(a)) return 'corrections';
  if (/paiement|statut|republié/.test(a)) return 'paiements';
  return 'creations';
}

/** Écran à ouvrir pour une entrée du journal (null : rien à ouvrir). */
export function journalRoute(l: AuditLog, ds: ReturnType<typeof useData>): string | null {
  if (l.entity === 'sale') return ds.sales.some((s) => s.id === l.entityId) ? `ventes/${l.entityId}` : null;
  if (l.entity === 'refund') { const r = ds.refunds.find((x) => x.id === l.entityId); return r ? `ventes/${r.saleId}` : null; }
  if (l.entity === 'item') return ds.items.some((i) => i.id === l.entityId) ? `stock/${l.entityId}` : null;
  if (l.entity === 'purchase') { const it = ds.purchaseLines.find((x) => x.purchaseId === l.entityId); return it ? `stock/${it.itemId}` : null; }
  if (l.entity === 'expense') return 'depenses';
  if (l.entity === 'goal') return 'objectifs';
  return null;
}

export function JournalScreen() {
  const ds = useData();
  const [filter, setFilter] = useState<JournalFilter>('tout');
  const [limit, setLimit] = useState(150);
  const logs = useLiveQuery(() => getDb().auditLogs.orderBy('at').reverse().toArray(), []);
  const shown = (logs ?? []).filter((l) => l.entity !== 'settings' && (filter === 'tout' || journalKind(l) === filter));
  return (
    <>
      <PageHeader title="Journal" sub="Toutes les opérations, dans l’ordre, avec leurs corrections" backTo="verification" />
      <div className="chips" role="group" aria-label="Type d'opération" style={{ marginBottom: 12 }}>
        {FILTERS.map(([k, label]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
      </div>
      {!logs ? <div className="skeleton" style={{ height: 200 }} /> : shown.length === 0 ? (
        <div className="card small muted">Aucune opération de ce type.</div>
      ) : (
        <div className="list">
          {shown.slice(0, limit).map((l) => {
            const to = journalRoute(l, ds);
            const body = (
              <>
                <span className="li-main">
                  <div className="li-title" style={{ fontSize: 14 }}>{ENTITY_LABEL[l.entity] ?? l.entity} · {humanAction(l.action)}</div>
                  <div className="li-sub" style={{ whiteSpace: 'normal' }}>{humanDetails(l.details)}</div>
                </span>
                <span className="tiny faint" style={{ whiteSpace: 'nowrap' }}>{new Date(l.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </>
            );
            return to ? <button key={l.id} className="li" onClick={() => go(to)}>{body}</button> : <div key={l.id} className="li">{body}</div>;
          })}
        </div>
      )}
      {shown.length > limit && <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setLimit(limit + 300)}>Afficher plus</button>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Historique d'une vente (journal + e-mails Vinted rapprochés)
// ---------------------------------------------------------------------------

export function SaleHistory({ saleId }: { saleId: string }) {
  const ds = useData();
  const ids = useMemo(() => [saleId, ...ds.refunds.filter((r) => r.saleId === saleId).map((r) => r.id)], [ds, saleId]);
  const logs = useLiveQuery(() => getDb().auditLogs.where('entityId').anyOf(ids).toArray(), [ids.join()]);
  const mails = useLiveQuery(() => getDb().syncedEmails.filter((r) => r.ref === saleId).toArray(), [saleId]);
  const rows = [
    ...(logs ?? []).map((l) => ({ at: l.at, title: `${ENTITY_LABEL[l.entity] ?? l.entity} · ${humanAction(l.action)}`, sub: humanDetails(l.details.replace(/^vente [\w-]+, /, '')), mail: false })),
    ...(mails ?? []).map((r: SyncedEmail) => ({ at: r.resolvedAt ?? r.createdAt, title: `E-mail Vinted · ${EVENT_LABEL[(r.event as VintedEvent | null)?.kind ?? 'sale'] ?? r.kind} du ${fr(r.date)}`, sub: mailDetail(r), mail: true })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (!rows.length) return null;
  return (
    <>
      <h2>Historique</h2>
      <div className="list">
        {rows.map((r, k) => (
          <div key={k} className="li">
            <span className="li-main">
              <div className="li-title" style={{ fontSize: 14, fontWeight: 600 }}>{r.title}</div>
              <div className="li-sub" style={{ whiteSpace: 'normal' }}>{r.sub}</div>
            </span>
            <span className="tiny faint" style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function mailDetail(r: SyncedEmail) {
  const ev = r.event as { amount?: number | null } | null;
  const amount = typeof ev?.amount === 'number' ? `${formatEuros(ev.amount)} · ` : '';
  return `${amount}${r.note || 'Rapproché'}`;
}
