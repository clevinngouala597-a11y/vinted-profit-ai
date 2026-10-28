/**
 * Bordereaux d'envoi Vinted : liste (d'après les e-mails déjà synchronisés), téléchargement des PDF
 * par le script Google de l'utilisateur, et assemblage en un seul PDF à imprimer.
 *
 * Format « étiquette » : chaque bordereau est découpé (seul le cadre de l'étiquette est gardé, sans les
 * instructions de Vinted autour) et placé sur une page 10 × 15 cm, tourné si besoin. Le découpage reste
 * vectoriel : codes-barres nets à l'impression.
 */
import { degrees, PDFDocument } from 'pdf-lib';
import type { SyncedEmail } from '../types';
import type { VintedEvent } from './parse';

export interface LabelRow {
  id: string;
  title: string;
  date: string;
  deadline: string | null;
  carrier: string | null;
  tracking: string | null;
  printed: boolean;
  expired: boolean;
  /** retard : date limite passée ; urgent : moins de 24 h ; ok */
  urgency: 'retard' | 'urgent' | 'ok';
}

/** « AAAA-MM-JJTHH:MM » à l'heure de Paris. */
export function parisNow(d = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const plusHours = (iso: string, h: number) => {
  const t = new Date(`${iso}:00Z`).getTime() + h * 3_600_000;
  return new Date(t).toISOString().slice(0, 16);
};

export function labelList(rows: SyncedEmail[], printed: string[], now = parisNow()): LabelRow[] {
  const done = new Set(printed);
  return rows
    .filter((r) => r.kind === 'label' && r.status !== 'ignored' && r.event)
    .map((r) => {
      const ev = r.event as VintedEvent & { kind: 'label' };
      const expired = !!ev.deadline && ev.deadline < now;
      return {
        id: r.id,
        title: ev.title,
        date: r.date,
        deadline: ev.deadline,
        carrier: ev.carrier,
        tracking: ev.tracking,
        printed: done.has(r.id),
        expired,
        urgency: expired ? 'retard' : ev.deadline && ev.deadline < plusHours(now, 24) ? 'urgent' : 'ok',
      } satisfies LabelRow;
    })
    .sort((a, b) => Number(a.printed) - Number(b.printed) || Number(a.expired) - Number(b.expired) || (a.deadline ?? '9').localeCompare(b.deadline ?? '9'));
}

/** Bordereaux à imprimer : pas encore imprimés et date limite pas dépassée. */
export const labelsToPrint = (list: LabelRow[]) => list.filter((l) => !l.printed && !l.expired);

// ---------------------------------------------------------------------------
// Repérage du cadre de l'étiquette dans la page
// ---------------------------------------------------------------------------

export interface Box { left: number; bottom: number; right: number; top: number }

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Sous-ensemble de pdf.js utilisé (injecté : module navigateur ou Node selon le contexte). */
export interface PdfJs {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ view: number[]; rotate: number; getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }> }> }> };
  OPS: Record<string, number>;
}

/**
 * Cadre de l'étiquette sur chaque page : le plus grand « bloc » dessiné (XObject de formulaire) qui
 * couvre au moins 15 % de la page — chez Mondial Relay, l'étiquette 15 × 10 cm en bas de la page A4.
 * null si rien de tel (la page entière est alors utilisée).
 */
export async function findLabelBoxes(pdfjs: PdfJs, data: Uint8Array): Promise<(Box | null)[]> {
  const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true }).promise;
  const out: (Box | null)[] = [];
  const { OPS } = pdfjs;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const [x0, y0, x1, y1] = page.view;
    const pageArea = (x1 - x0) * (y1 - y0);
    const ops = await page.getOperatorList();
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    let best: Box | null = null;
    let bestArea = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i] as unknown[];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as Matrix);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        const m = (args[0] as Matrix | null) ?? [1, 0, 0, 1, 0, 0];
        ctm = mul(ctm, Array.from(m) as Matrix);
        const bb = args[1] as number[] | null;
        if (bb && bb.length === 4) {
          const pts = [apply(ctm, bb[0], bb[1]), apply(ctm, bb[2], bb[1]), apply(ctm, bb[0], bb[3]), apply(ctm, bb[2], bb[3])];
          const box = { left: Math.min(...pts.map((q) => q[0])), right: Math.max(...pts.map((q) => q[0])), bottom: Math.min(...pts.map((q) => q[1])), top: Math.max(...pts.map((q) => q[1])) };
          const area = (box.right - box.left) * (box.top - box.bottom);
          if (area > bestArea && area >= 0.15 * pageArea && area < 0.98 * pageArea) { best = box; bestArea = area; }
        }
      } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    }
    // un peu de marge autour du cadre (bordure comprise), sans sortir de la page
    out.push(page.rotate ? null : best && { left: Math.max(x0, best.left - 3), bottom: Math.max(y0, best.bottom - 3), right: Math.min(x1, best.right + 3), top: Math.min(y1, best.top + 3) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

const MM = 72 / 25.4;
/** Étiquette 10 × 15 cm (imprimantes d'étiquettes 4 × 6 pouces). */
export const LABEL_PAGE = { width: 100 * MM, height: 150 * MM };

export async function composeLabels(pdfs: Uint8Array[], format: 'etiquette' | 'a4', boxes: (Box | null)[][] = []): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle('Bordereaux Vinted');
  for (let k = 0; k < pdfs.length; k++) {
    const src = await PDFDocument.load(pdfs[k], { ignoreEncryption: true });
    if (format === 'a4') {
      for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
      continue;
    }
    const pages = src.getPages();
    for (let i = 0; i < pages.length; i++) {
      const { width: pw, height: ph } = pages[i].getSize();
      const box = boxes[k]?.[i] ?? { left: 0, bottom: 0, right: pw, top: ph };
      const emb = await out.embedPage(pages[i], box);
      const w = box.right - box.left;
      const h = box.top - box.bottom;
      const W = LABEL_PAGE.width;
      const H = LABEL_PAGE.height;
      const m = 2 * MM;
      const page = out.addPage([W, H]);
      if (w > h) {
        // paysage → tourné d'un quart de tour pour remplir l'étiquette verticale
        const s = Math.min((W - 2 * m) / h, (H - 2 * m) / w);
        page.drawPage(emb, { x: (W + h * s) / 2, y: (H - w * s) / 2, xScale: s, yScale: s, rotate: degrees(90) });
      } else {
        const s = Math.min((W - 2 * m) / w, (H - 2 * m) / h);
        page.drawPage(emb, { x: (W - w * s) / 2, y: (H - h * s) / 2, xScale: s, yScale: s });
      }
    }
  }
  return out.save();
}

export const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------
// Dans l'application : téléchargement et impression
// ---------------------------------------------------------------------------

/** Télécharge les PDF des bordereaux (par paquets, via le script Google) et les assemble en un seul PDF. */
export async function buildLabelsPdf(ids: string[], format: 'etiquette' | 'a4', fetcher: typeof fetch = fetch) {
  const { callScript } = await import('./drive');
  const { loadDataset } = await import('../actions');
  const got: { id: string; pdf?: string; error?: string }[] = [];
  if ((await loadDataset()).settings.syncMode === 'google') {
    const { fetchGmailLabels } = await import('../google/gmail');
    got.push(...(await fetchGmailLabels(ids, fetcher)));
  } else for (let i = 0; i < ids.length; i += 10) {
    const body = await callScript('bordereaux', { method: 'GET' }, fetcher, `&ids=${ids.slice(i, i + 10).join(',')}`);
    if (!Array.isArray(body.bordereaux)) throw new Error('Ton script Google ne sait pas encore envoyer les bordereaux : mets-le à jour (version 3).');
    got.push(...(body.bordereaux as typeof got));
  }
  const ok = got.filter((g) => g.pdf);
  const missing = got.filter((g) => !g.pdf).map((g) => g.id);
  if (!ok.length) throw new Error('Aucun PDF trouvé dans ces e-mails (certains transporteurs envoient un QR code à présenter, sans bordereau à imprimer).');
  const pdfs = ok.map((g) => base64ToBytes(g.pdf!));
  let boxes: (Box | null)[][] = [];
  if (format === 'etiquette') {
    const pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    boxes = await Promise.all(pdfs.map((p) => findLabelBoxes(pdfjs as unknown as PdfJs, p).catch(() => [])));
  }
  const bytes = await composeLabels(pdfs, format, boxes);
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), printedIds: ok.map((g) => g.id), missing };
}
