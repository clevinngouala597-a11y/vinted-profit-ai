/**
 * Test d'intégration : vraie reconnaissance OCR (tesseract.js) sur un ticket photographié de travers,
 * puis extraction du montant, de la date et du fournisseur. Le dictionnaire français vient du paquet de dev.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { describe, expect, it } from 'vitest';
import { parseReceiptText } from '../src/lib/receipt';

const require = createRequire(import.meta.url);
const fra = require('@tesseract.js-data/fra') as { langPath: string };
const IMG = process.env.OCR_TICKET ?? path.join(__dirname, 'fixtures', 'ticket.jpg');

describe.skipIf(!IMG || !existsSync(IMG))('OCR réel', () => {
  it('lit un ticket de caisse', async () => {
    const worker = await createWorker('fra', 1, { langPath: path.join(fra.langPath, '..', '4.0.0_best_int'), gzip: true, cachePath: path.join(process.cwd(), 'node_modules', '.cache') });
    const { data } = await worker.recognize(readFileSync(IMG!));
    await worker.terminate();
    const g = parseReceiptText(data.text, '2026-10-27');
    expect(g.amount).toBe(890);
    expect(g.date).toBe('2026-10-14');
    expect(g.supplier).toMatch(/ACTION/);
  }, 60_000);
});
