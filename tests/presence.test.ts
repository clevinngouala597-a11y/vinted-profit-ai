import { beforeEach, describe, expect, it } from 'vitest';
import { adminKey, fetchUsers, sendPresence, sha256hex, summarize, unlockAdmin, type DeviceRow } from '../src/lib/presence';
import { codeHash } from '../src/lib/betaAccess';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(), key: () => null, length: 0,
};
beforeEach(() => store.clear());

describe('utilisateurs (admin)', () => {
  it('signal anonyme, au plus toutes les 5 minutes, désactivable', async () => {
    const bodies: string[] = [];
    const f = (async (_u: string, init: RequestInit) => { bodies.push(String(init.body)); return new Response('{"ok":true}'); }) as unknown as typeof fetch;
    const t0 = Date.parse('2026-10-30T08:00:00Z');
    expect(await sendPresence({ google: true, enabled: true }, f, 'https://script/x', t0)).toBe(true);
    expect(await sendPresence({ google: true, enabled: true }, f, 'https://script/x', t0 + 60_000)).toBe(false);
    expect(await sendPresence({ google: true, enabled: true }, f, 'https://script/x', t0 + 5 * 60_000)).toBe(true);
    expect(await sendPresence({ google: true, enabled: false }, f, 'https://script/x', t0 + 20 * 60_000)).toBe(false);
    const p = JSON.parse(bodies[0]);
    expect(p).toMatchObject({ app: 'cng-presence', v: 'officielle', google: true, tester: null });
    expect(p.id).toMatch(/^[a-z0-9-]{8,}$/);
    expect(JSON.parse(bodies[1]).id).toBe(p.id);
    expect(Object.keys(p).sort()).toEqual(['app', 'build', 'device', 'google', 'id', 'tester', 'v']);
  });

  it('accès admin avec le code personnel, clé transmise au script', async () => {
    // code d'essai (le vrai code admin n'apparaît jamais dans le dépôt public)
    const list = { [await codeHash('codeEssai42')]: 'Admin' };
    expect(await unlockAdmin('mauvais', list)).toBe(false);
    expect(await unlockAdmin('codeessai42', list)).toBe(true);
    const key = await sha256hex('cng-stats:CODEESSAI42');
    expect(adminKey()).toBe(key);
    let url = '';
    const rows: DeviceRow[] = [
      { id: 'a', v: 'beta', build: 'x', tester: 'Testeur 03', device: 'iPhone', google: true, first: '2026-10-29T08:00:00Z', last: '2026-10-30T07:58:00Z', opens: 4 },
      { id: 'b', v: 'officielle', build: 'x', tester: null, device: 'Ordinateur', google: false, first: '2026-10-20T08:00:00Z', last: '2026-10-25T08:00:00Z', opens: 1 },
    ];
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify({ ok: true, devices: rows })); }) as unknown as typeof fetch;
    expect(await fetchUsers(f, 'https://script/x')).toHaveLength(2);
    expect(url).toContain(`action=presence&key=${key}`);
    expect(summarize(rows, Date.parse('2026-10-30T08:00:00Z'))).toEqual({ online: 1, today: 1, week: 2, total: 2, beta: 1, google: 1 });
  });
});
