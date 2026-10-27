import { describe, expect, it } from 'vitest';
import { allocate, formatPercent, parseEuros, percent, roundHalfAway } from '../src/lib/money';

describe('montants', () => {
  it('convertit les saisies françaises en centimes sans flottant', () => {
    expect(parseEuros('12')).toBe(1200);
    expect(parseEuros('12,5')).toBe(1250);
    expect(parseEuros('12.50')).toBe(1250);
    expect(parseEuros('1 234,56 €')).toBe(123456);
    expect(parseEuros('0,1')).toBe(10);
    expect(parseEuros('1,005')).toBe(101); // demi vers l'extérieur
    expect(parseEuros('-3,2')).toBe(-320);
    expect(parseEuros('')).toBeNull();
    expect(parseEuros('abc')).toBeNull();
    expect(parseEuros('12,3,4')).toBeNull();
  });

  it('additionne sans erreur de précision', () => {
    expect((parseEuros('0,1') ?? 0) + (parseEuros('0,2') ?? 0)).toBe(30);
  });

  it('arrondit demi vers l’extérieur', () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(66.66666, 2)).toBe(66.67);
    expect(roundHalfAway(1.005, 2)).toBe(1.01);
  });

  it('ne calcule pas un pourcentage sur un dénominateur nul', () => {
    expect(percent(500, 0)).toBeNull();
    expect(percent(500, -100)).toBeNull();
    expect(formatPercent(null)).toBe('non applicable');
  });

  it('répartit exactement un montant (plus fort reste)', () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
    expect(allocate(1001, [2000, 1000])).toEqual([667, 334]);
    expect(allocate(500, [0, 0])).toEqual([250, 250]); // parts égales si pas de poids
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(-100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(-100);
  });
});

describe('affichage', () => {
  it("n'affiche jamais de zéro négatif", async () => {
    const { formatEuros } = await import('../src/lib/money');
    expect(formatEuros(-0)).not.toContain('-');
    expect(formatEuros(-0, { signed: true })).not.toMatch(/[-−]/);
  });
});
