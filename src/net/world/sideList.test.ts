/**
 * The vehicles' and the garrison's state on the unreliable lane (sideList.ts, context.ts `sendSide`): cut into parts that fit
 * a packet, drawn whole, a lost or late part costing only that list; and never on the reliable lane, where it held real events.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNRELIABLE_SAFE_BYTES } from '../room';
import { ListParts, PART_BYTES, SIDE, sendList } from './sideList';
import { party } from './testkit';
import type { WorldContext } from './context';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

describe('a latest-wins list in parts', () => {
  const capture = () => {
    const sent: { kind: number; value: { at: number; i: number; n: number; list: unknown[] } }[] = [];
    const w = { sendSide: (kind: number, value: never) => { sent.push({ kind, value }); } } as unknown as WorldContext;
    return { sent, w };
  };
  it('a short list is one part, an empty list is one empty part, and a long one is cut so each part fits a packet', () => {
    const { sent, w } = capture();
    expect(sendList(w, SIDE.allies, 100, [[1, 2, 3]])).toBe(1);
    expect(sendList(w, SIDE.allies, 150, [])).toBe(1);
    expect(sent.map(s => [s.value.i, s.value.n, s.value.list.length])).toEqual([[0, 1, 1], [0, 1, 0]]);
    sent.length = 0;
    const rows = Array.from({ length: 16 }, (_, i) => ({ id: i, p: [123.456, 7.891, -234.567], q: [0.1, 0.2, 0.3, 0.9], x: Array.from({ length: 24 }, (_, k) => k * 1.001) }));
    const n = sendList(w, SIDE.vehicles, 200, rows);
    expect(n).toBeGreaterThan(1);
    for (const s of sent) expect(JSON.stringify(s.value).length + 3).toBeLessThanOrEqual(UNRELIABLE_SAFE_BYTES);
    expect(sent.flatMap(s => s.value.list)).toEqual(rows);
    expect(PART_BYTES).toBeLessThan(UNRELIABLE_SAFE_BYTES);
  });
  it('is drawn whole, in any order of parts; a list missing a part is never drawn, and an older part after a newer is dropped', () => {
    const parts = new ListParts();
    expect(parts.take({ at: 10, i: 1, n: 2, list: ['b'] })).toBeNull();
    expect(parts.take({ at: 10, i: 1, n: 2, list: ['b'] })).toBeNull();
    expect(parts.take({ at: 10, i: 0, n: 2, list: ['a'] })).toEqual({ at: 10, list: ['b', 'a'] });
    // The next stamp loses its second part: nothing is drawn from it, and the one after is whole again.
    expect(parts.take({ at: 20, i: 0, n: 2, list: ['c'] })).toBeNull();
    expect(parts.take({ at: 30, i: 0, n: 1, list: ['d'] })).toEqual({ at: 30, list: ['d'] });
    expect(parts.take({ at: 20, i: 1, n: 2, list: ['late'] })).toBeNull();
    // Junk from another browser.
    for (const junk of [null, 5, {}, { at: 40, i: 0, n: 99, list: [] }, { at: 40, i: 3, n: 2, list: [] }, { at: NaN, i: 0, n: 1, list: [] }, { at: 40, i: 0, n: 1, list: 'x' }]) expect(parts.take(junk)).toBeNull();
  });
});

describe('the vehicles ride the unreliable lane', () => {
  it('the host sends them as side packets on the `world` lane and none on the reliable lane; the guest is handed whole lists', () => {
    const truck = { alive: true, def: { kind: 'truck' }, position: new THREE.Vector3(0, 0, -20), quaternion: new THREE.Quaternion() };
    const game = party(1);
    (game.host.ctx.enemies as unknown as { vehicles: unknown }).vehicles = { live: [truck] };
    const drawn: { at: number; list: { id: number; kind: string }[] }[] = [];
    const vehicles = (game.gws[0] as unknown as { vehicles: { draw(value: { at: number; list: { id: number; kind: string }[] }, now: number): void } }).vehicles;
    vehicles.draw = value => { drawn.push(value); };
    const before = game.relay.packets.length;
    for (let i = 0; i < 4; i++) { vi.advanceTimersByTime(250); game.step(); }
    const packets = game.relay.packets.slice(before);
    expect(packets.filter(p => p.lane === 'action' && ['allies', 'vehicles'].includes((p.data as { data?: { t?: string } }).data?.t ?? ''))).toHaveLength(0);
    const side = packets.filter(p => p.lane === 'world' && p.data instanceof ArrayBuffer && new Uint8Array(p.data)[0] === 0x05 && new Uint8Array(p.data)[1] === 0xc2);
    expect(side.length).toBeGreaterThanOrEqual(3);
    expect(side.every(p => (p.data as ArrayBuffer).byteLength <= UNRELIABLE_SAFE_BYTES)).toBe(true);
    expect(drawn.length).toBe(side.length);
    expect(drawn.at(-1)!.list.map(v => v.kind)).toEqual(['truck']);
    game.dispose();
  });
});
