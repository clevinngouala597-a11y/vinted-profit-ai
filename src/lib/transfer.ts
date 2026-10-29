/**
 * Déménagement de l'appli vers une nouvelle adresse.
 *
 * L'ancienne adresse lit les données de l'appareil et les transmet dans l'adresse de la nouvelle
 * (« #transfert=… », compressées). Ici, elles sont enregistrées avant l'affichage de l'appli, à une
 * condition : cet appareil n'a encore rien à la nouvelle adresse (rien n'est jamais écrasé).
 */
import { DATA_TABLES, getDb } from './db';

export interface TransferPayload {
  v: number;
  from: string;
  tables: Record<string, unknown[]>;
  ls: Record<string, string>;
  photos: number;
  photosTotal: number;
}

export interface TransferResult {
  status: 'imported' | 'skipped' | 'invalid';
  sales?: number;
  items?: number;
  photosMissing?: number;
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function decodeTransfer(s: string): Promise<TransferPayload> {
  const kind = s[0];
  const bytes = fromB64url(s.slice(1));
  let text: string;
  if (kind === 'g') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else if (kind === 'j') text = new TextDecoder().decode(bytes);
  else throw new Error('format inconnu');
  const p = JSON.parse(text) as TransferPayload;
  if (p.v !== 1 || !p.tables || typeof p.tables !== 'object') throw new Error('format inconnu');
  return p;
}

function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: m[1] });
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/** Enregistre les données transférées, si cet appareil n'a encore rien ici. */
export async function applyTransfer(p: TransferPayload, storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): Promise<TransferResult> {
  const db = getDb();
  const here = await db.settings.get('main');
  if (here?.onboarded) return { status: 'skipped' };
  for (const t of DATA_TABLES) if (p.tables[t] !== undefined && !Array.isArray(p.tables[t])) return { status: 'invalid' };
  const atts = (Array.isArray(p.tables.attachments) ? p.tables.attachments : []) as { id: string; mime: string; createdAt: string; data: string }[];
  await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.attachments], async () => {
    for (const t of DATA_TABLES) {
      await db.table(t).clear();
      if (p.tables[t]?.length) await db.table(t).bulkPut(p.tables[t]);
    }
    for (const a of atts) {
      const blob = dataUrlToBlob(a.data);
      if (blob) await db.attachments.put({ id: a.id, mime: a.mime, createdAt: a.createdAt, blob });
    }
  });
  // réglages de l'appareil (connexion Google, accès bêta, période choisie…)
  if (storage) for (const [k, v] of Object.entries(p.ls ?? {})) { try { if (storage.getItem(k) === null) storage.setItem(k, v); } catch { /* plein */ } }
  return { status: 'imported', sales: p.tables.sales?.length ?? 0, items: p.tables.items?.length ?? 0, photosMissing: Math.max(0, (p.photosTotal ?? 0) - (p.photos ?? 0)) };
}

/** À l'ouverture : lit « #transfert=… » s'il est présent, l'enlève de l'adresse et enregistre les données. */
export async function handleTransfer(): Promise<TransferResult | null> {
  const m = /^#transfert=(.+)$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    return await applyTransfer(await decodeTransfer(m[1]));
  } catch {
    return { status: 'invalid' };
  }
}
