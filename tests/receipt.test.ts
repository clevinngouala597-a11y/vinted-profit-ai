import { describe, expect, it } from 'vitest';
import { parseReceiptText } from '../src/lib/receipt';

const TODAY = '2026-10-27';

describe('Lecture de ticket', () => {
  it('ticket de magasin : total TTC confirmé par le paiement CB', () => {
    const t = `ACTION
12 rue du Commerce 69003 LYON
Tel 04 00 00 00 00
Date: 14/10/2026 15:42
ENVELOPPES BULLES X10   4,99
SCOTCH                  1,49
RUBAN ADHESIF           2,42
SOUS-TOTAL              8,90
TOTAL TTC               8,90
CB                      8,90
TVA 20%                 1,48
MERCI DE VOTRE VISITE`;
    const g = parseReceiptText(t, TODAY);
    expect(g.amount).toBe(890);
    expect(g.amountConfidence).toBe('haute');
    expect(g.date).toBe('2026-10-14');
    expect(g.supplier).toBe('ACTION');
  });

  it('montant sur la ligne suivante et milliers', () => {
    const t = `LAMPE STUDIO PRO\nFacture n° 2026-118\n02.09.26\nNet à payer\n1 249,00 €\nTVA 208,17`;
    const g = parseReceiptText(t, TODAY);
    expect(g.amount).toBe(124900);
    expect(g.amountConfidence).toBe('moyenne');
    expect(g.date).toBe('2026-09-02');
    expect(g.supplier).toBe('LAMPE STUDIO PRO');
  });

  it('ignore la TVA et la remise, garde le total', () => {
    const t = `CARREFOUR CITY\nREMISE FIDELITE -2,00\nTOTAL 17,30\nTVA 5,5% 0,90\nESPECES 20,00\nRENDU 2,70`;
    const g = parseReceiptText(t, TODAY);
    expect(g.amount).toBe(1730);
    expect(g.candidates).toContain(2000);
  });

  it('sans mot-clé : plus grand montant, confiance faible ; date future ignorée', () => {
    const t = `Bon de dépôt\n12/12/2099\n3,50\n6,00`;
    const g = parseReceiptText(t, TODAY);
    expect(g.amount).toBe(600);
    expect(g.amountConfidence).toBe('faible');
    expect(g.date).toBeNull();
  });

  it('texte illisible : rien n’est inventé', () => {
    const g = parseReceiptText('~~ ## ..', TODAY);
    expect(g).toMatchObject({ amount: null, date: null, supplier: null, candidates: [] });
  });
});
