/**
 * Assistant : des questions en français, des réponses calculées sur les vraies données.
 *
 * La question est analysée sur l'appareil (période, nombre, sujet), puis la réponse est calculée par
 * le même moteur que le bilan. Aucun chiffre n'est jamais inventé : chaque réponse indique sur quelles
 * opérations elle repose, et renvoie vers elles. Une question non comprise reçoit des suggestions, pas
 * une approximation.
 *
 * Option : avec une clé Claude, une question formulée librement peut être reformulée par l'IA en une
 * question type (seul le texte de la question est envoyé, jamais les données). Le calcul reste local.
 */
import { cashState, goalProgress, periodMetrics, plEntries, type PLEntry } from './engine';
import { formatEuros, formatPercent, percent, sum, type Cents } from './money';
import { addDays, addMonths, monthEnd, monthStart } from './period';
import { activeShop, ALL, scopeDataset, shopsOf } from './shops';
import { sellerStats } from './stats';
import { unsoldAnalysis } from './unsold';
import type { Dataset, ISODate } from './types';

export interface Answer {
  /** sujet compris (pour les tests et l'affichage) */
  intent: string;
  title: string;
  /** phrase de réponse */
  text: string;
  /** chiffres clés */
  lines?: [string, string][];
  table?: { columns: string[]; rows: string[][]; links?: (string | null)[] };
  /** sur quoi repose le calcul */
  basis: string;
  link?: { label: string; to: string };
}

export interface Period { from: ISODate; to: ISODate; label: string; explicit: boolean }

export const SUGGESTIONS = [
  'Quels sont mes cinq articles les plus rentables ?',
  'Combien j’ai gagné ce mois-ci ?',
  'Quel est mon chiffre d’affaires le mois dernier ?',
  'Quelle marque me rapporte le plus ?',
  'Combien d’argent dort dans mon stock ?',
  'Quels articles sont en stock depuis le plus longtemps ?',
  'Combien de ventes cette semaine ?',
  'Quelles ventes m’ont fait perdre de l’argent ?',
  'Quel jour je vends le plus ?',
  'En combien de temps je vends un article ?',
  'Où en est mon objectif du mois ?',
  'Quelles ventes attendent encore un paiement ?',
  'Combien j’ai dépensé ce mois-ci ?',
  'Compare ce mois avec le mois dernier',
  'Quel a été mon meilleur mois ?',
  'Quelle est ma trésorerie ?',
];

// ---------------------------------------------------------------------------
// Lecture de la question
// ---------------------------------------------------------------------------

export const normQ = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, ' ').replace(/[^a-z0-9%]+/g, ' ').trim()} `;

const NUMBERS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20 };
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const pc = (p: number | null) => (p === null ? '—' : formatPercent(p));
const fr = (d: ISODate) => d.split('-').reverse().join('/');

/** Nombre demandé (« cinq articles », « top 10 ») ; `def` sinon. Plafonné à 20. */
export function readCount(q: string, def = 5): number {
  const m = q.match(/ (?:top |les |mes |des )?(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quinze|vingt) (?:premier|meilleur|pire|dernier|article|vente|marque|categorie|produit|plus|moins|taille|mois|jour)/)
    ?? q.match(/ top (\d{1,2}) /);
  if (!m) return def;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]];
  return Math.min(20, Math.max(1, n || def));
}

/** Période de la question ; `def` si aucune n'est indiquée. */
export function readPeriod(q: string, today: ISODate, def: 'mois' | 'tout', firstDate: ISODate): Period {
  const y = Number(today.slice(0, 4));
  const ms = monthStart(today);
  const mk = (from: ISODate, to: ISODate, label: string): Period => ({ from, to: to > today ? today : to, label, explicit: true });
  const n = q.match(/ (\d{1,3}) derniers? (jours?|semaines?|mois) /);
  if (n) {
    const k = Number(n[1]);
    if (n[2].startsWith('jour')) return mk(addDays(today, -(k - 1)), today, `les ${k} derniers jours`);
    if (n[2].startsWith('semaine')) return mk(addDays(today, -(7 * k - 1)), today, `les ${k} dernières semaines`);
    return mk(addMonths(ms, -(k - 1)), today, `les ${k} derniers mois`);
  }
  if (/ aujourd hui | ce jour /.test(q)) return mk(today, today, "aujourd'hui");
  if (/ hier /.test(q)) return mk(addDays(today, -1), addDays(today, -1), 'hier');
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = addDays(today, -dow);
  if (/ (semaine derniere|semaine precedente|derniere semaine) /.test(q)) return mk(addDays(weekStart, -7), addDays(weekStart, -1), 'la semaine dernière');
  if (/ (cette semaine|semaine en cours|de la semaine) /.test(q)) return mk(weekStart, today, 'cette semaine');
  if (/ (mois dernier|mois precedent|dernier mois) /.test(q)) { const p = addMonths(ms, -1); return mk(p, monthEnd(p), 'le mois dernier'); }
  if (/ (ce mois|mois ci|mois en cours|du mois|cette mois) /.test(q)) return mk(ms, monthEnd(ms), 'ce mois-ci');
  if (/ (annee derniere|annee precedente|l an dernier|l an passe) /.test(q)) return mk(`${y - 1}-01-01`, `${y - 1}-12-31`, `en ${y - 1}`);
  if (/ (cette annee|annee en cours|de l annee|depuis janvier) /.test(q)) return mk(`${y}-01-01`, today, `en ${y}`);
  if (/ (trimestre) /.test(q)) { const qm = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1; const f = `${y}-${String(qm).padStart(2, '0')}-01`; return mk(f, monthEnd(addMonths(f, 2)), 'ce trimestre'); }
  const yearOnly = q.match(/ (?:en )?(20\d\d) /);
  for (let i = 0; i < 12; i++) {
    const m = q.match(new RegExp(` ${MONTHS[i]}(?: (20\\d\\d))? `));
    if (m) {
      const yy = m[1] ? Number(m[1]) : `${y}-${String(i + 1).padStart(2, '0')}-01` > today ? y - 1 : y;
      const f = `${yy}-${String(i + 1).padStart(2, '0')}-01`;
      return mk(f, monthEnd(f), `en ${MONTHS[i].replace('fevrier', 'février').replace('aout', 'août').replace('decembre', 'décembre')} ${yy}`);
    }
  }
  if (yearOnly) return mk(`${yearOnly[1]}-01-01`, `${yearOnly[1]}-12-31`, `en ${yearOnly[1]}`);
  if (/ (depuis le debut|au total|en tout|depuis toujours|de tous les temps|depuis que) /.test(q)) return { from: firstDate, to: today, label: 'depuis le début', explicit: true };
  return def === 'mois' ? { from: ms, to: today, label: 'ce mois-ci', explicit: false } : { from: firstDate, to: today, label: 'depuis le début', explicit: false };
}

const has = (q: string, re: RegExp) => re.test(q);

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

/** Bénéfice par article vendu sur la période (remboursements et dépenses liées compris). */
export function profitByItem(ds: Dataset, entries: PLEntry[], from: ISODate, to: ISODate) {
  const firstItem = new Map<string, string>();
  for (const l of ds.saleLines) if (!firstItem.has(l.saleId)) firstItem.set(l.saleId, l.itemId);
  const acc = new Map<string, { itemId: string; saleId: string; revenue: Cents; profit: Cents; cogs: Cents; date: ISODate }>();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    const itemId = e.src.itemId ?? (e.src.type === 'expense' && e.src.saleId ? firstItem.get(e.src.saleId) : undefined);
    if (!itemId || !e.src.saleId) continue;
    const key = `${e.src.saleId}:${itemId}`;
    const cur = acc.get(key) ?? { itemId, saleId: e.src.saleId, revenue: 0, profit: 0, cogs: 0, date: e.date };
    cur.revenue += e.revenue;
    cur.cogs += e.cogs;
    cur.profit += e.revenue - e.cogs - e.saleCosts;
    if (e.src.type === 'sale') cur.date = e.date;
    acc.set(key, cur);
  }
  return [...acc.values()].filter((x) => x.revenue !== 0 || x.cogs !== 0);
}

export function answer(full: Dataset, question: string, today: ISODate): Answer | null {
  let q = normQ(question);
  if (q.trim().length < 3) return null;

  // dressing nommé dans la question, sinon celui affiché
  let ds = full;
  let shopNote = '';
  const named = shopsOf(full.settings).find((s) => (s.name && q.includes(normQ(s.name))) || (s.pseudo && q.includes(normQ(s.pseudo))));
  const shop = named && shopsOf(full.settings).length > 1 ? named.id : activeShop(full.settings);
  if (shop !== ALL) {
    ds = scopeDataset(full, shop);
    shopNote = ` · dressing « ${shopsOf(full.settings).find((s) => s.id === shop)?.name} »`;
    if (named) q = q.replace(normQ(named.name), ' ').replace(normQ(named.pseudo || '§'), ' ');
  }

  const first = [ds.settings.trackingStart, ...ds.sales.map((s) => s.date), ...ds.purchases.map((p) => p.date)].sort()[0] ?? today;
  const entries = plEntries(ds);
  const itemName = new Map(ds.items.map((i) => [i.id, i.name]));
  const basisP = (p: Period, n: number, what = 'vente') => `Calculé sur ${n} ${n > 1 ? what.split(' ').map((w) => `${w}s`).join(' ') : what} ${p.label === 'depuis le début' ? `depuis le ${fr(p.from)}` : `(${p.label}, du ${fr(p.from)} au ${fr(p.to)})`}${shopNote}.`;
  const salesIn = (p: Period) => ds.sales.filter((s) => s.date >= p.from && s.date <= p.to && s.orderStatus !== 'annulee').length;

  // --- 1. classement des articles (plus / moins rentables, pertes) ---
  const aboutItems = has(q, / (article|articles|vente|ventes|produit|produits|piece|pieces|vetement|vetements|truc|trucs) /);
  const worst = has(q, / (moins rentable|moins rentables|pire|pires|perte|pertes|perdu|a perte|perdre) /);
  const best = has(q, / (plus rentable|plus rentables|meilleur|meilleurs|meilleures|rapporte le plus|rapportent le plus|plus de benefice|plus gros benefice|top) /);
  const byGroup = q.match(/ (marque|marques|categorie|categories|taille|tailles) /);
  if ((best || worst) && aboutItems && !byGroup && !has(q, / (mois|jour) le plus /)) {
    const p = readPeriod(q, today, 'tout', first);
    const n = readCount(q);
    let rows = profitByItem(ds, entries, p.from, p.to);
    const total = rows.length;
    if (worst) rows = rows.filter((r) => has(q, / (perte|pertes|perdu|a perte|perdre) /) ? r.profit < 0 : true).sort((a, b) => a.profit - b.profit);
    else rows.sort((a, b) => b.profit - a.profit);
    rows = rows.slice(0, n);
    if (!rows.length) return { intent: worst ? 'pertes' : 'top-articles', title: worst ? 'Ventes à perte' : 'Articles les plus rentables', text: worst ? `Aucune vente à perte ${p.label}.` : `Aucune vente ${p.label}.`, basis: basisP(p, total, 'article vendu') };
    return {
      intent: worst ? 'pertes' : 'top-articles',
      title: worst ? `${rows.length > 1 ? `Les ${rows.length}` : 'L’'} article${rows.length > 1 ? 's' : ''} le${rows.length > 1 ? 's' : ''} moins rentable${rows.length > 1 ? 's' : ''}` : `Tes ${rows.length} article${rows.length > 1 ? 's' : ''} le${rows.length > 1 ? 's' : ''} plus rentable${rows.length > 1 ? 's' : ''}`,
      text: `${worst ? 'Le moins rentable' : 'Le plus rentable'} ${p.label} : « ${itemName.get(rows[0].itemId) ?? 'article'} », ${formatEuros(rows[0].profit, { signed: true })} de bénéfice.`,
      table: {
        columns: ['Article', 'Vendu', 'Coût', 'Bénéfice', 'Marge'],
        rows: rows.map((r) => [itemName.get(r.itemId) ?? 'Article', formatEuros(r.revenue), formatEuros(r.cogs), formatEuros(r.profit, { signed: true }), pc(percent(r.profit, r.revenue))]),
        links: rows.map((r) => `ventes/${r.saleId}`),
      },
      basis: `${basisP(p, total, 'article vendu')} Bénéfice = encaissé − remboursements − coût d’achat − frais de la vente.`,
    };
  }

  // --- 2. par marque / catégorie / taille ---
  if (byGroup && has(q, / (rapporte|rapportent|rentable|rentables|meilleur|meilleure|meilleures|meilleurs|plus|vend|vends|vendent|marche|marchent|top|benefice) /)) {
    const p = readPeriod(q, today, 'tout', first);
    const st = sellerStats(ds, p, today);
    const kind = byGroup[1].startsWith('marque') ? 'brands' : byGroup[1].startsWith('categ') ? 'categories' : 'sizes';
    const word = kind === 'brands' ? 'marque' : kind === 'categories' ? 'catégorie' : 'taille';
    const byCount = has(q, / (vend|vends|vendent|plus de ventes|nombre|souvent|part le plus|partent) /) && !has(q, / (rapporte|rentable|benefice) /);
    const groups = [...st[kind]].filter((g) => g.key !== 'Autres' || true).sort((a, b) => (byCount ? b.count - a.count : b.profit - a.profit)).slice(0, readCount(q));
    if (!groups.length) return { intent: `par-${word}`, title: `Par ${word}`, text: `Aucune vente ${p.label}.`, basis: basisP(p, 0) };
    return {
      intent: `par-${word}`,
      title: `${word[0].toUpperCase()}${word.slice(1)}s ${byCount ? 'qui se vendent le plus' : 'qui rapportent le plus'}`,
      text: `${byCount ? 'Celle qui se vend le plus' : 'Celle qui rapporte le plus'} ${p.label} : ${groups[0].key} (${byCount ? `${groups[0].count} vente${groups[0].count > 1 ? 's' : ''}` : `${formatEuros(groups[0].profit)} de bénéfice`}).`,
      table: { columns: [word[0].toUpperCase() + word.slice(1), 'Ventes', 'CA', 'Bénéfice', 'Marge'], rows: groups.map((g) => [g.key, String(g.count), formatEuros(g.revenue), formatEuros(g.profit), pc(g.margin)]) },
      basis: basisP(p, st.salesCount),
      link: { label: 'Toutes les statistiques', to: 'statistiques' },
    };
  }

  // --- 3. stock et invendus ---
  if (has(q, / (stock|invendu|invendus|immobilise|immobilises|dort|dorment|bloque|bloques|en vente depuis|pas vendu|pas vendus|anciens|ancien|longtemps) /) && !has(q, / combien de temps .*vend| en combien de temps /)) {
    const a = unsoldAnalysis(ds, today);
    const listOld = has(q, / (quels|quel|lesquels|liste|plus longtemps|plus anciens|plus vieux|dort|dorment|ancien|anciens) /) && !has(q, / combien /);
    const n = readCount(q);
    const rows = a.items.slice(0, n);
    return {
      intent: 'stock',
      title: listOld ? 'Articles en stock depuis le plus longtemps' : 'Argent immobilisé dans le stock',
      text: `${formatEuros(a.capital)} immobilisés dans ${a.count} article${a.count > 1 ? 's' : ''} (au prix de revient)${a.dormantCount ? `, dont ${formatEuros(a.dormantCapital)} dans ${a.dormantCount} article${a.dormantCount > 1 ? 's' : ''} qui dorment` : ''}.`,
      lines: [['Articles en stock', String(a.count)], ['Argent immobilisé', formatEuros(a.capital)], ['Ancienneté moyenne', `${a.avgAge ?? 0} jours`], ['Bénéfice possible au prix souhaité', formatEuros(a.potential)]],
      ...(listOld && rows.length ? { table: { columns: ['Article', 'Depuis', 'Coût', 'Prix souhaité'], rows: rows.map((x) => [x.item.name, `${x.age} j`, formatEuros(x.cost), x.item.targetPrice ? formatEuros(x.item.targetPrice) : '—']), links: rows.map((x) => `stock/${x.item.id}`) } } : {}),
      basis: `Calculé sur les ${a.count} article${a.count > 1 ? 's' : ''} actuellement en stock${shopNote}.`,
      link: { label: 'Analyse des invendus', to: 'invendus' },
    };
  }

  // --- 4. délai de vente ---
  if (has(q, / (combien de temps|en combien de temps|delai|delais|vite|rapidement|temps pour vendre|temps de vente) /)) {
    const p = readPeriod(q, today, 'tout', first);
    const st = sellerStats(ds, p, today);
    if (!st.timeToSell) return { intent: 'delai', title: 'Délai de vente', text: 'Pas encore assez de ventes avec une date de mise en vente connue pour le calculer.', basis: basisP(p, 0, 'article') };
    const t = st.timeToSell;
    return {
      intent: 'delai', title: 'Délai de vente',
      text: `Tu vends un article en ${t.median} jour${t.median > 1 ? 's' : ''} (médiane), ${t.avg} en moyenne.`,
      ...(t.byCategory.length ? { table: { columns: ['Catégorie', 'Délai moyen', 'Articles'], rows: t.byCategory.map((c) => [c.key, `${c.avg} j`, String(c.count)]) } } : {}),
      basis: `${basisP(p, t.count, 'article vendu')} De la mise en vente (ou de l’achat) jusqu’à la vente.`,
    };
  }

  // --- 5. meilleur jour de la semaine ---
  if (has(q, / (quel jour|quels jours|jour de la semaine|jours de la semaine|meilleur jour|jour ou je vends) /)) {
    const p = readPeriod(q.replace(/ jours? de la semaine /, ' '), today, 'tout', first);
    const st = sellerStats(ds, p, today);
    const w = [...st.weekdays].sort((a, b) => b.count - a.count || b.revenue - a.revenue);
    return {
      intent: 'jour', title: 'Ventes par jour de la semaine',
      text: st.bestWeekday ? `Tu vends le plus le ${st.bestWeekday.toLowerCase()} (${w[0].count} vente${w[0].count > 1 ? 's' : ''}).` : `Aucune vente ${p.label}.`,
      table: { columns: ['Jour', 'Ventes', 'CA'], rows: w.map((d) => [d.day, String(d.count), formatEuros(d.revenue)]) },
      basis: basisP(p, st.salesCount),
    };
  }

  // --- 6. meilleur mois ---
  if (has(q, / (meilleur mois|meilleurs mois|mois record|pire mois|mois le plus) /)) {
    const p = readPeriod(q, today, 'tout', first);
    const months: { m: ISODate; profit: Cents; revenue: Cents }[] = [];
    for (let m = monthStart(p.from); m <= p.to; m = addMonths(m, 1)) {
      const x = periodMetrics(ds, m, monthEnd(m), entries);
      months.push({ m, profit: x.commercialProfit, revenue: x.revenue });
    }
    const worstM = has(q, / (pire|moins) /);
    const sorted = [...months].filter((x) => x.revenue || x.profit).sort((a, b) => (worstM ? a.profit - b.profit : b.profit - a.profit));
    if (!sorted.length) return { intent: 'mois', title: 'Meilleur mois', text: `Aucune vente ${p.label}.`, basis: basisP(p, 0) };
    const lbl = (m: ISODate) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(`${m}T12:00:00`));
    return {
      intent: 'mois', title: worstM ? 'Mois le moins rentable' : 'Meilleur mois',
      text: `${worstM ? 'Ton mois le moins rentable' : 'Ton meilleur mois'} : ${lbl(sorted[0].m)}, avec ${formatEuros(sorted[0].profit)} de bénéfice commercial.`,
      table: { columns: ['Mois', 'CA', 'Bénéfice'], rows: sorted.slice(0, readCount(q, 6)).map((x) => [lbl(x.m), formatEuros(x.revenue), formatEuros(x.profit)]) },
      basis: basisP(p, salesIn(p)),
      link: { label: 'Bilan par année', to: 'bilan' },
    };
  }

  // --- 7. objectif ---
  if (has(q, / (objectif|objectifs|but du mois) /)) {
    const month = today.slice(0, 7);
    const g = goalProgress(ds, month, today);
    const set = g.lines.filter((l) => l.target > 0);
    if (!set.length) return { intent: 'objectif', title: 'Objectifs du mois', text: 'Aucun objectif fixé pour ce mois.', basis: 'Objectifs enregistrés dans l’appli.', link: { label: 'Fixer mes objectifs', to: 'objectifs' } };
    const fmt = (u: string, v: number) => (u === 'eur' ? formatEuros(v) : u === 'pct' ? `${v} %` : String(v));
    return {
      intent: 'objectif', title: 'Objectifs du mois',
      text: `${set.filter((l) => l.status === 'atteint' || l.status === 'respecte').length} objectif(s) sur ${set.length} atteint(s) ou respecté(s), au ${g.elapsed}e jour sur ${g.days}.`,
      table: { columns: ['Objectif', 'Actuel', 'Cible', 'Fin de mois estimée'], rows: set.map((l) => [l.label, fmt(l.unit, l.current), fmt(l.unit, l.target), l.projection === null ? '—' : fmt(l.unit, l.projection)]) },
      basis: `Opérations du mois en cours${shopNote}. L’estimation prolonge ton rythme actuel.`,
      link: { label: 'Objectifs', to: 'objectifs' },
    };
  }

  // --- 8. paiements en attente ---
  if (has(q, / (attente|attendent|pas encore paye|pas encore payee|pas paye|a recevoir|doit recevoir|en cours de paiement|impaye|impayes|impayee) /)) {
    const waiting = ds.sales.filter((s) => s.orderStatus !== 'annulee' && s.paymentStatus === 'en_attente' && s.sellerRevenue > 0).sort((a, b) => a.date.localeCompare(b.date));
    const firstLine = (id: string) => itemName.get(ds.saleLines.find((l) => l.saleId === id)?.itemId ?? '') ?? 'Vente';
    return {
      intent: 'attente', title: 'Paiements en attente',
      text: waiting.length ? `${waiting.length} vente${waiting.length > 1 ? 's' : ''} attend${waiting.length > 1 ? 'ent' : ''} un paiement, pour ${formatEuros(sum(waiting.map((s) => s.sellerRevenue)))}.` : 'Aucun paiement en attente.',
      ...(waiting.length ? { table: { columns: ['Vente', 'Date', 'Montant'], rows: waiting.slice(0, 20).map((s) => [firstLine(s.id), fr(s.date), formatEuros(s.sellerRevenue)]), links: waiting.slice(0, 20).map((s) => `ventes/${s.id}`) } } : {}),
      basis: `Ventes non annulées dont le paiement n’est pas encore reçu${shopNote}.`,
    };
  }

  // --- 9. trésorerie ---
  if (has(q, / (tresorerie|solde|argent disponible|argent dispo|cash|liquidite|sur mon compte|combien j ai d argent) /)) {
    const c = cashState(ds);
    return {
      intent: 'tresorerie', title: 'Trésorerie',
      text: `Solde : ${formatEuros(c.balance)}${c.pendingIn ? `, et ${formatEuros(c.pendingIn)} à recevoir` : ''}.`,
      lines: [['Solde confirmé', formatEuros(c.balance)], ['À recevoir', formatEuros(c.pendingIn)], ['À payer', formatEuros(c.pendingOut)]],
      basis: `Trésorerie de départ et tous les mouvements enregistrés${shopNote}.`,
      link: { label: 'Trésorerie', to: 'tresorerie' },
    };
  }

  // --- 10. dépenses ---
  if (has(q, / (depense|depenses|depensé|frais generaux|charges|achete en emballage) /) && !has(q, / achat de stock /)) {
    const p = readPeriod(q, today, 'mois', first);
    const ex = ds.expenses.filter((e) => e.date >= p.from && e.date <= p.to);
    const byCat = [...ex.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + e.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
    return {
      intent: 'depenses', title: 'Dépenses',
      text: `${formatEuros(sum(ex.map((e) => e.amount)))} de dépenses ${p.label}.`,
      ...(byCat.length ? { table: { columns: ['Catégorie', 'Montant'], rows: byCat.map(([k, v]) => [k, formatEuros(v)]) } } : {}),
      basis: basisP(p, ex.length, 'dépense'),
      link: { label: 'Dépenses', to: 'depenses' },
    };
  }

  // --- 11. comparaison de deux périodes ---
  if (has(q, / (compare|comparer|comparaison|par rapport|evolution|progresse|mieux que|moins bien que|vs) /)) {
    // « ce mois comparé au mois dernier » : la période étudiée est la plus récente
    const p = readPeriod(/ ce mois | mois ci /.test(q) ? q.replace(/ (mois dernier|mois precedent) /, ' ') : q, today, 'mois', first);
    const len = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000);
    const monthly = p.from === monthStart(p.from) && p.to <= monthEnd(p.from);
    let prev: Period;
    if (monthly) {
      const f = addMonths(p.from, -1);
      const t = addDays(f, len);
      prev = { from: f, to: t > monthEnd(f) ? monthEnd(f) : t, label: 'le mois précédent', explicit: true };
    } else prev = { from: addDays(p.from, -(len + 1)), to: addDays(p.from, -1), label: 'la période précédente', explicit: true };
    const a = periodMetrics(ds, p.from, p.to, entries);
    const b = periodMetrics(ds, prev.from, prev.to, entries);
    const d = (x: number, y: number) => `${formatEuros(x - y, { signed: true })}${y ? ` (${formatPercent(percent(x - y, Math.abs(y)))})` : ''}`;
    return {
      intent: 'comparaison', title: `${p.label[0].toUpperCase()}${p.label.slice(1)} comparé à ${prev.label}`,
      text: `Bénéfice commercial : ${formatEuros(a.commercialProfit)} contre ${formatEuros(b.commercialProfit)}, soit ${d(a.commercialProfit, b.commercialProfit)}.`,
      table: {
        columns: ['', p.label, prev.label, 'Écart'],
        rows: [
          ['Chiffre d’affaires', formatEuros(a.revenue), formatEuros(b.revenue), d(a.revenue, b.revenue)],
          ['Bénéfice commercial', formatEuros(a.commercialProfit), formatEuros(b.commercialProfit), d(a.commercialProfit, b.commercialProfit)],
          ['Résultat', formatEuros(a.result), formatEuros(b.result), d(a.result, b.result)],
          ['Articles vendus', String(a.itemsSold), String(b.itemsSold), `${a.itemsSold - b.itemsSold >= 0 ? '+' : ''}${a.itemsSold - b.itemsSold}`],
        ],
      },
      basis: `Du ${fr(p.from)} au ${fr(p.to)}, comparé au ${fr(prev.from)} – ${fr(prev.to)}${shopNote}.`,
    };
  }

  // --- 12. indicateurs d'une période (CA, bénéfice, ventes, marge, panier moyen) ---
  const metric =
    has(q, / (panier moyen|prix moyen|vente moyenne|en moyenne par vente) /) ? 'panier'
      : has(q, / (marge|marges|rentabilite|roi) /) ? 'marge'
        : has(q, / (combien de ventes|nombre de ventes|combien d articles|combien j ai vendu d|articles vendus|ventes ai je|combien de pieces|combien de vente) /) ? 'ventes'
          : has(q, / (chiffre d affaires|c a|encaisse|vendu pour|recette|recettes|rentre) /) ? 'ca'
            : has(q, / (gagne|benefice|benefices|profit|rapporte|resultat|net|gain|gains|combien je me fais) /) ? 'benefice'
              : has(q, / (achats|achete|investi|depense en stock) /) ? 'achats'
                : null;
  if (metric) {
    const p = readPeriod(q, today, 'mois', first);
    const m = periodMetrics(ds, p.from, p.to, entries);
    const n = salesIn(p);
    const lines: [string, string][] = [['Chiffre d’affaires', formatEuros(m.revenue)], ['Bénéfice commercial', formatEuros(m.commercialProfit)], ['Résultat (après frais généraux)', formatEuros(m.result)], ['Articles vendus', String(m.itemsSold)], ['Marge', formatPercent(m.margin)]];
    const text = metric === 'ca' ? `Chiffre d’affaires ${p.label} : ${formatEuros(m.revenue)}.`
      : metric === 'ventes' ? `${n} vente${n > 1 ? 's' : ''} ${p.label} (${m.itemsSold} article${m.itemsSold > 1 ? 's' : ''}).`
        : metric === 'marge' ? `Marge ${p.label} : ${formatPercent(m.margin)} (${formatEuros(m.commercialProfit)} de bénéfice sur ${formatEuros(m.revenue)} encaissés).`
          : metric === 'panier' ? (n ? `Panier moyen ${p.label} : ${formatEuros(Math.round(m.revenue / n))} par vente.` : `Aucune vente ${p.label}.`)
            : metric === 'achats' ? `Achats de stock ${p.label} : ${formatEuros(m.purchases)}.`
              : `Tu as gagné ${formatEuros(m.commercialProfit)} ${p.label} (bénéfice commercial), soit ${formatEuros(m.result)} après les frais généraux.`;
    return {
      intent: metric, title: { ca: 'Chiffre d’affaires', ventes: 'Ventes', marge: 'Marge', panier: 'Panier moyen', achats: 'Achats de stock', benefice: 'Bénéfice' }[metric],
      text, lines: metric === 'achats' ? [['Achats de stock', formatEuros(m.purchases)]] : lines,
      basis: `${basisP(p, n)} Mêmes calculs que le bilan.`,
      link: { label: 'Voir le bilan', to: 'bilan' },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reformulation par Claude (facultative)
// ---------------------------------------------------------------------------

/**
 * Demande à Claude de reformuler une question libre en une des questions types. Seul le texte de la
 * question part : aucune donnée de l'utilisateur. La réponse chiffrée est ensuite calculée sur l'appareil.
 */
export async function rephraseWithClaude(key: string, question: string, model: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const prompt = `Tu aides une application de comptabilité pour revendeurs Vinted. Reformule la question de l'utilisateur en UNE question courte en français, proche d'un de ces modèles, en gardant la période et le nombre demandés :\n${SUGGESTIONS.map((s) => `- ${s}`).join('\n')}\nRéponds uniquement par la question reformulée, ou par AUCUNE si la question ne concerne pas ces sujets.\n\nQuestion : ${question}`;
  let res: Response;
  try {
    res = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: 80, messages: [{ role: 'user', content: prompt }] }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[] } | null;
  const t = body?.content?.filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim() ?? '';
  return !t || /^aucune/i.test(t) ? null : t.slice(0, 200);
}
