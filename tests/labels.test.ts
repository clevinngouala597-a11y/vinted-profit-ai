import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { composeLabels, findLabelBoxes, LABEL_PAGE, labelList, labelsToPrint, type PdfJs } from '../src/lib/vinted/labels';
import { parseVintedEmail } from '../src/lib/vinted/parse';
import type { SyncedEmail } from '../src/lib/types';

/** PDF construit comme un bordereau Mondial Relay de Vinted : A4, instructions en haut, étiquette 15 × 10 cm encadrée en bas. */
async function fakeVintedLabel() {
  const label = await PDFDocument.create();
  const lp = label.addPage([425.197, 283.465]);
  for (let i = 0; i < 40; i++) lp.drawRectangle({ x: 30 + i * 6, y: 40, width: i % 3 ? 2 : 4, height: 60, color: rgb(0, 0, 0) });
  lp.drawText('MONDIAL RELAY 37114086', { x: 30, y: 200, size: 18 });
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Instructions Vinted : emballe ton colis…', { x: 95, y: 790, size: 12, font });
  const [emb] = await doc.embedPdf(await label.save());
  page.drawRectangle({ x: 85.29, y: 36.25, width: 424.697, height: 283.298, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
  page.drawPage(emb, { x: 85.54, y: 36.5, xScale: 0.997648, yScale: 0.997648 });
  return doc.save();
}

async function pdfjs(): Promise<PdfJs> {
  const m = await import('pdfjs-dist/legacy/build/pdf.mjs');
  m.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  return m as unknown as PdfJs;
}

describe('Bordereaux', () => {
  it('lecture de l’e-mail « Bordereau d’envoi »', () => {
    const ev = parseVintedEmail({
      id: 'b1', date: '2026-10-13T18:48:48Z',
      subject: "Bordereau d'envoi Vinted - à utiliser avant le 19/10/2026 10 h 00 pour Blau karierte Windbreaker Style Jacke Vintage - Taille L",
      text: "Bonjour clevinnng, Retrouve ton bordereau d'envoi en pièce jointe | Article : | Blau karierte Windbreaker Style Jacke Vintage - Taille L | Format du colis : | 2000.0 g | N° de suivi : | 37114086 | À envoyer avant le : | 19/10/2026 10 h 00 | Vérifie les horaires du point relais Mondial Relay",
    });
    expect(ev).toEqual({ msgId: 'b1', date: '2026-10-13', kind: 'label', title: 'Blau karierte Windbreaker Style Jacke Vintage - Taille L', deadline: '2026-10-19T10:00', carrier: 'Mondial Relay', tracking: '37114086' });
  });

  it('liste : à imprimer d’abord, par date limite ; les expirés et imprimés à part', () => {
    const row = (id: string, deadline: string): SyncedEmail => ({ id, kind: 'label', date: '2026-10-20', title: id, event: { kind: 'label', msgId: id, date: '2026-10-20', title: id, deadline, carrier: null, tracking: null }, status: 'applied', ref: null, note: '', createdAt: '', resolvedAt: null });
    const list = labelList([row('tard', '2026-10-30T10:00'), row('vieux', '2026-10-20T10:00'), row('demain', '2026-10-28T09:00'), row('fait', '2026-10-29T10:00')], ['fait'], '2026-10-27T21:00');
    expect(list.map((l) => [l.id, l.urgency, l.printed])).toEqual([['demain', 'urgent', false], ['tard', 'ok', false], ['vieux', 'retard', false], ['fait', 'ok', true]]);
    expect(labelsToPrint(list).map((l) => l.id)).toEqual(['demain', 'tard']);
  });

  it('étiquette : seul le cadre 15 × 10 cm est gardé, tourné sur une page 10 × 15 cm', async () => {
    const pdf = await fakeVintedLabel();
    const [boxes] = [await findLabelBoxes(await pdfjs(), pdf)];
    expect(boxes).toHaveLength(1);
    const b = boxes[0]!;
    expect(b.left).toBeCloseTo(82.5, 0);
    expect(b.bottom).toBeCloseTo(33.5, 0);
    expect(b.right).toBeGreaterThan(510);
    expect(b.top).toBeLessThan(330); // les instructions du haut sont exclues
    const out = await PDFDocument.load(await composeLabels([pdf, pdf], 'etiquette', [boxes, boxes]));
    expect(out.getPageCount()).toBe(2);
    const { width, height } = out.getPage(0).getSize();
    expect(width).toBeCloseTo(LABEL_PAGE.width, 1);
    expect(height).toBeCloseTo(LABEL_PAGE.height, 1);
    const a4 = await PDFDocument.load(await composeLabels([pdf, pdf, pdf], 'a4'));
    expect(a4.getPageCount()).toBe(3);
  });
});
