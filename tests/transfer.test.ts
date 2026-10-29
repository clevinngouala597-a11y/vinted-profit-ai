import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VPDatabase, setDb } from '../src/lib/db';
import { defaultSettings, loadDataset, saveSettings } from '../src/lib/actions';
import { applyTransfer, decodeTransfer, type TransferPayload } from '../src/lib/transfer';

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const gz = async (o: unknown) => 'g' + b64url(new Uint8Array(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()));
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m } as unknown as Storage & { m: Map<string, string> }; };

const payload = (): TransferPayload => ({
  v: 1, from: 'https://ancienne/', photos: 1, photosTotal: 2,
  tables: {
    settings: [{ ...defaultSettings('2026-09-01'), onboarded: true, businessName: 'Ancien' }],
    sales: [{ id: 's1' }], items: [{ id: 'i1', status: 'vendu' }],
    attachments: [{ id: 'a1', mime: 'image/jpeg', createdAt: '', data: 'data:image/jpeg;base64,AAEC' }],
  },
  ls: { 'vpa.period': '{"key":"30j"}' },
});

let n = 0;
beforeEach(() => setDb(new VPDatabase(`transfert-${++n}`)));

describe('déménagement vers la nouvelle adresse', () => {
  it('décode le transfert compressé et enregistre tout (données, photos, réglages de l’appareil)', async () => {
    const p = await decodeTransfer(await gz(payload()));
    const ls = mem();
    const r = await applyTransfer(p, ls);
    expect(r).toEqual({ status: 'imported', sales: 1, items: 1, photosMissing: 1 });
    const ds = await loadDataset();
    expect(ds.settings.businessName).toBe('Ancien');
    expect(ds.sales).toHaveLength(1);
    expect(ls.m.get('vpa.period')).toBe('{"key":"30j"}');
  });

  it('n’écrase jamais des données déjà présentes à la nouvelle adresse', async () => {
    await saveSettings({ ...defaultSettings('2026-10-01'), onboarded: true, businessName: 'Nouveau' });
    expect((await applyTransfer(payload(), mem())).status).toBe('skipped');
    expect((await loadDataset()).settings.businessName).toBe('Nouveau');
  });

  it('refuse un transfert illisible', async () => {
    await expect(decodeTransfer('xabc')).rejects.toThrow();
    await expect(decodeTransfer('j' + b64url(new TextEncoder().encode('{"v":9}')))).rejects.toThrow();
  });
});
