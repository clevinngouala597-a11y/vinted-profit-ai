import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, recordExpense, recordPurchase, recordRefund, recordSale, saveSettings } from '../src/lib/actions';
import { answer, readCount, readPeriod, normQ, rephraseWithClaude, SUGGESTIONS } from '../src/lib/assistant';
import { periodMetrics } from '../src/lib/engine';
import { addShop } from '../src/lib/shopActions';

const TODAY = '2026-10-28';
let n = 0;
beforeEach(async () => {
  setDb(new VPDatabase(`assist-${++n}`));
  await saveSettings({ ...defaultSettings('2026-08-01'), onboarded: true });
});

async function sell(name: string, brand: string, cost: number, price: number, date: string, opts: { fees?: number; paid?: boolean; bought?: string } = {}) {
  const { itemIds } = await recordPurchase({ date: opts.bought ?? '2026-08-05', source: 'Friperie', commonFees: 0, lotPrice: null, lines: [{ name, category: 'Sweats et pulls', brand, price: cost, targetPrice: price }] });
  return recordSale({ date, itemIds, listedPrice: price, discount: 0, sellerRevenue: price, platformFees: 0, packagingCost: opts.fees ?? 0, otherCosts: 0, paymentStatus: opts.paid === false ? 'en_attente' : 'recu' });
}

async function history() {
  await sell('Doudoune TNF', 'The North Face', 3500, 9000, '2026-10-03');
  await sell('Veste Carhartt', 'Carhartt', 1800, 5500, '2026-10-10', { fees: 100 });
  await sell('Sweat Nike', 'Nike', 800, 2500, '2026-10-12');
  await sell('Polo Lacoste', 'Lacoste', 600, 2200, '2026-10-26', { paid: false });
  const loss = await sell('Jean abîmé', "Levi's", 1500, 1200, '2026-10-20');
  await sell('Air Max', 'Nike', 2500, 6000, '2026-09-15');
  await sell('T-shirt Stüssy', 'Stüssy', 500, 2000, '2026-09-20');
  const refunded = await sell('Pull Ralph', 'Ralph Lauren', 900, 3000, '2026-10-15');
  await recordRefund({ saleId: refunded, date: '2026-10-18', amount: 3000, itemRecovered: false, extraCosts: 0 });
  await recordPurchase({ date: '2026-08-02', source: 'Vide-grenier', commonFees: 0, lotPrice: null, lines: [{ name: 'Vieille veste', category: 'Vestes et manteaux', price: 2000, targetPrice: 4000 }] });
  await recordExpense({ date: '2026-10-05', amount: 1299, category: 'Emballages', supplier: 'Action', description: '', saleId: null, attachmentId: null });
  return { loss };
}

describe('assistant : lecture de la question', () => {
  it('nombre et période', () => {
    expect(readCount(normQ('Quels sont mes cinq articles les plus rentables ?'))).toBe(5);
    expect(readCount(normQ('top 10 des ventes'))).toBe(10);
    expect(readCount(normQ('mes 3 meilleures marques'))).toBe(3);
    const p = (s: string) => readPeriod(normQ(s), TODAY, 'mois', '2026-08-01');
    expect(p('ce mois-ci')).toMatchObject({ from: '2026-10-01', to: TODAY });
    expect(p('le mois dernier')).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(p('en septembre')).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(p('en décembre')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(p('les 30 derniers jours')).toMatchObject({ from: '2026-09-29', to: TODAY });
    expect(p('cette semaine')).toMatchObject({ from: '2026-10-26', to: TODAY });
    expect(p('hier')).toMatchObject({ from: '2026-10-27', to: '2026-10-27' });
    expect(p('depuis le début')).toMatchObject({ from: '2026-08-01' });
  });
});

describe('assistant : réponses calculées sur les vraies données', () => {
  it('« Quels sont mes cinq articles les plus rentables ? » : classement exact, avec lien vers chaque vente', async () => {
    await history();
    const a = answer(await loadDataset(), 'Quels sont mes cinq articles les plus rentables ?', TODAY)!;
    expect(a.intent).toBe('top-articles');
    expect(a.table!.rows.map((r) => r[0])).toEqual(['Doudoune TNF', 'Veste Carhartt', 'Air Max', 'Sweat Nike', 'Polo Lacoste']);
    expect(a.table!.rows[0][3]).toMatch(/55,00/);
    expect(a.table!.rows[1][3]).toMatch(/36,00/); // 55 − 18 − 1 € de frais
    expect(a.table!.links![0]).toMatch(/^ventes\//);
    expect(a.basis).toMatch(/8 articles vendus/);
  });

  it('ventes à perte (remboursement compris)', async () => {
    const { loss } = await history();
    const a = answer(await loadDataset(), 'Quelles ventes m’ont fait perdre de l’argent ?', TODAY)!;
    expect(a.intent).toBe('pertes');
    expect(a.table!.rows.map((r) => r[0])).toEqual(['Pull Ralph', 'Jean abîmé']);
    expect(a.table!.links).toContain(`ventes/${loss}`);
  });

  it('bénéfice, chiffre d’affaires et nombre de ventes : identiques au bilan', async () => {
    await history();
    const ds = await loadDataset();
    const m = periodMetrics(ds, '2026-10-01', TODAY);
    const g = answer(ds, 'Combien j’ai gagné ce mois-ci ?', TODAY)!;
    expect(g.intent).toBe('benefice');
    expect(g.text).toContain(`${(m.commercialProfit / 100).toFixed(2).replace('.', ',')}`);
    const ca = answer(ds, 'Quel est mon chiffre d’affaires le mois dernier ?', TODAY)!;
    expect(ca.text).toMatch(/80,00/);
    const v = answer(ds, 'Combien de ventes en septembre ?', TODAY)!;
    expect(v.text).toMatch(/^2 ventes/);
  });

  it('marques, stock, attente, dépenses, délai, comparaison, meilleur mois', async () => {
    await history();
    const ds = await loadDataset();
    expect(answer(ds, 'Quelle marque me rapporte le plus ?', TODAY)!.table!.rows[0][0]).toBe('The North Face');
    const st = answer(ds, 'Combien d’argent dort dans mon stock ?', TODAY)!;
    expect(st.intent).toBe('stock');
    expect(st.text).toMatch(/20,00/);
    expect(answer(ds, 'Quels articles sont en stock depuis le plus longtemps ?', TODAY)!.table!.rows[0][0]).toBe('Vieille veste');
    expect(answer(ds, 'Quelles ventes attendent encore un paiement ?', TODAY)!.table!.rows[0][0]).toBe('Polo Lacoste');
    expect(answer(ds, 'Combien j’ai dépensé ce mois-ci ?', TODAY)!.text).toMatch(/12,99/);
    expect(answer(ds, 'En combien de temps je vends un article ?', TODAY)!.intent).toBe('delai');
    const c = answer(ds, 'Compare ce mois avec le mois dernier', TODAY)!;
    expect(c.intent).toBe('comparaison');
    expect(c.basis).toMatch(/01\/10\/2026 au 28\/10\/2026, comparé au 01\/09\/2026 – 28\/09\/2026/);
    expect(answer(ds, 'Quel a été mon meilleur mois ?', TODAY)!.text).toMatch(/octobre 2026/);
  });

  it('chaque question suggérée reçoit une réponse', async () => {
    await history();
    const ds = await loadDataset();
    for (const q of SUGGESTIONS) expect(answer(ds, q, TODAY), q).not.toBeNull();
    expect(answer(ds, 'Quelle est la capitale du Pérou ?', TODAY)).toBeNull();
  });

  it('un dressing nommé dans la question limite le calcul à ce dressing', async () => {
    await history();
    await addShop('Vintage', 'clevin.vintage');
    const ds = await loadDataset();
    const a = answer(ds, 'Combien j’ai gagné ce mois-ci sur Vintage ?', TODAY)!;
    expect(a.basis).toMatch(/dressing « Vintage »/);
    expect(a.text).toMatch(/0,00/);
  });

  it('reformulation par Claude : seule la question est envoyée, jamais les données', async () => {
    let sent = '';
    const fetcher = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Quels sont mes cinq articles les plus rentables ?' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await history();
    const r = await rephraseWithClaude('sk-test', 'c quoi mes trucs qui marchent le mieux', 'claude-sonnet-5-5', fetcher);
    expect(r).toBe('Quels sont mes cinq articles les plus rentables ?');
    expect(sent).toContain('c quoi mes trucs');
    expect(sent).not.toMatch(/Doudoune|Carhartt|9000|90,00/);
  });
});
