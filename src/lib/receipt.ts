/**
 * Lecture d'un justificatif (ticket de caisse, facture) photographié.
 *
 * 1. `ocrImage` reconnaît le texte DANS LE NAVIGATEUR (tesseract.js) : l'image ne quitte pas le téléphone.
 *    Seul le moteur et le dictionnaire français sont téléchargés au premier usage, puis gardés en cache.
 * 2. `parseReceiptText` repère le montant total, la date et le fournisseur, avec un niveau de confiance.
 * Les valeurs sont toujours PROPOSÉES : l'utilisateur les vérifie avant d'enregistrer.
 */
import { parseEuros, type Cents } from './money';
import type { ISODate } from './types';

export type Confidence = 'haute' | 'moyenne' | 'faible';

export interface ReceiptGuess {
  amount: Cents | null;
  amountConfidence: Confidence;
  date: ISODate | null;
  supplier: string | null;
  /** Montants trouvés sur le ticket, du plus probable au moins probable (pour proposer une alternative). */
  candidates: Cents[];
}

const AMOUNT = /(?<![\d.,])(\d{1,5}(?:[ .]\d{3})*[.,]\d{2})(?![\d])/g;

const TOTAL_STRONG = /(total\s*(ttc|a payer|à payer|net)|net\s*[aà]\s*payer|montant\s*(ttc|total|d[uû]|a payer|à payer)|[aà]\s*payer|total\s*:?\s*$|^\s*total\b(?!.*(ht|tva|sous|articles?|remise)))/i;
const TOTAL_WEAK = /(total|carte|cb|esp[eè]ces|r[eè]glement|paiement|vente)/i;
const NOT_TOTAL = /(tva|\bht\b|sous[- ]?total|rendu|remise|[ée]conomie|fid[ée]lit[ée]|taux|base)/i;

function amountsIn(line: string): Cents[] {
  const out: Cents[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const v = parseEuros(m[1].replace(/ (?=\d{3}\b)/g, ''));
    if (v !== null && v > 0 && v < 10_000_000) out.push(v);
  }
  return out;
}

function findDate(text: string, today: ISODate): ISODate | null {
  const re = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})|(\d{4})-(\d{2})-(\d{2})/g;
  for (const m of text.matchAll(re)) {
    let y: number, mo: number, d: number;
    if (m[4]) [y, mo, d] = [Number(m[4]), Number(m[5]), Number(m[6])];
    else {
      [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (y < 100) y += 2000;
    }
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) continue;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso <= today && y >= 2000) return iso;
  }
  return null;
}

function findSupplier(lines: string[]): string | null {
  for (const raw of lines.slice(0, 6)) {
    const l = raw.replace(/[^\p{L}\d &'.-]/gu, ' ').replace(/\s+/g, ' ').trim();
    const letters = (l.match(/\p{L}/gu) ?? []).length;
    if (letters < 3) continue;
    if (/^(ticket|facture|re[çc]u|bienvenue|merci|tel|t[ée]l[ée]phone|siret|date)\b/i.test(l)) continue;
    if (/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(l)) continue;
    if (amountsIn(l).length) continue;
    // première ligne lisible du ticket = en général l'enseigne
    return l.length > 40 ? l.slice(0, 40).trim() : l;
  }
  return null;
}

export function parseReceiptText(text: string, today: ISODate = new Date().toISOString().slice(0, 10)): ReceiptGuess {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const strong: Cents[] = [];
  const weak: Cents[] = [];
  const all: Cents[] = [];
  lines.forEach((line, i) => {
    const a = amountsIn(line);
    all.push(...a);
    if (NOT_TOTAL.test(line)) return;
    // le montant peut être sur la ligne du libellé ou sur la suivante
    const here = a.length ? a : amountsIn(lines[i + 1] ?? '');
    if (!here.length) return;
    const last = here[here.length - 1];
    if (TOTAL_STRONG.test(line)) strong.push(last);
    else if (TOTAL_WEAK.test(line)) weak.push(last);
  });
  let amount: Cents | null = null;
  let amountConfidence: Confidence = 'faible';
  if (strong.length) {
    amount = Math.max(...strong);
    // confiance haute si le paiement (CB, espèces) confirme le même montant
    amountConfidence = weak.includes(amount) || strong.filter((x) => x === amount).length > 1 ? 'haute' : 'moyenne';
  } else if (weak.length) {
    amount = Math.max(...weak);
    amountConfidence = 'faible';
  } else if (all.length) {
    amount = Math.max(...all);
    amountConfidence = 'faible';
  }
  const candidates = [...new Set([amount, ...strong, ...weak, ...[...all].sort((a, b) => b - a)].filter((x): x is Cents => x !== null))].slice(0, 5);
  return { amount, amountConfidence, date: findDate(text, today), supplier: findSupplier(lines), candidates };
}

/** Reconnaissance du texte d'une image, dans le navigateur. `onProgress` reçoit une valeur de 0 à 1. */
export async function ocrImage(image: Blob, onProgress?: (p: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('fra', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
