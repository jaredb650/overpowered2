import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, CHUNK_RECORDS, ChunkReader, ChunkWriter, ENEMY_IDS, FAR_EVERY, FULL_BYTES, HEADER_BYTES, KEY_EVERY, LAST_FEW, MOTION_BYTES, NEAR_M,
  decodeChunk, dueOn, encodeChunk, encodeRoster, intervalOf, keyOn, tierOf, unwrap, wireEnemy, type EnemyFrame } from './worldProtocol';

const enemy = (uid = 1): EnemyFrame => ({ uid, id: 'husk', position: [1.25, -2, 30], velocity: [2.25, 0, -1.5], yaw: 0.75,
  health: 13, maxHealth: 100, armor: 45, flags: 9, animation: 2, severed: 1 << 7, plates: 255, posture: 'handsUp',
  full: true, tier: 1, legs: 1, rising: true, aiming: true, target: 3 });

describe('enemy snapshot chunks', () => {
  it('round trips every archetype, wounds, armour, animation, tier, aim and the header', () => {
    const enemies = ENEMY_IDS.map((id, index) => ({ ...enemy(index + 1), id }));
    const packet = encodeChunk({ time: 0xfffffff0, tick: 0xffff, wave: 12, phase: 'boss', nextWaveIn: 7.2, alive: 31, tickMs: 83, enemies });
    expect(packet.byteLength).toBe(HEADER_BYTES + FULL_BYTES * enemies.length);
    const back = decodeChunk(packet)!;
    expect(back).toMatchObject({ time: 0xfffffff0, tick: 0xffff, wave: 12, phase: 'boss', nextWaveIn: 8, alive: 31, tickMs: 83 });
    expect(back.enemies).toHaveLength(enemies.length);
    back.enemies.forEach((got, index) => {
      const sent = enemies[index]!;
      expect(got).toMatchObject(sent);
    });
    expect(decodeChunk(encodeChunk({ time: 0, tick: 0, wave: 0, enemies: [] }))).toMatchObject({ time: 0, wave: 0, phase: 'intermission', enemies: [] });
  });
  it('a motion-only record is 27 bytes and keeps what moves; a yaw past a full turn is wrapped', () => {
    const packet = encodeChunk({ time: 5, tick: 1, wave: 1, enemies: [{ ...enemy(), full: false, yaw: 0.75 + Math.PI * 4 }] });
    expect(packet.byteLength).toBe(HEADER_BYTES + MOTION_BYTES);
    const got = decodeChunk(packet)!.enemies[0]!;
    expect(got).toMatchObject({ uid: 1, full: false, position: [1.25, -2, 30], velocity: [2.25, 0, -1.5], flags: 9, animation: 2, tier: 1, legs: 1, rising: true, aiming: true, target: 3 });
    expect(got.yaw).toBeCloseTo(0.75, 3);
  });
  it('one chunk never passes the safe packet size: 24 full records, 40 motion records', () => {
    const writer = new ChunkWriter();
    const e = { ...wireEnemy(), full: true };
    writer.begin(0, 1, 1, 1, 'clearing', 0, 48, 50);
    let full = 0;
    while (writer.fits(true)) { e.uid = ++full; writer.add(e); }
    expect(full).toBe(24);
    expect(writer.end().byteLength).toBeLessThanOrEqual(CHUNK_BYTES);
    writer.begin(0, 1, 1, 1, 'clearing', 0, 48, 50);
    e.full = false;
    let motion = 0;
    while (writer.fits(false)) { e.uid = ++motion; writer.add(e); }
    expect(motion).toBe(CHUNK_RECORDS);
    expect(motion).toBe(40);
    expect(writer.end().byteLength).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(() => encodeChunk({ time: 0, tick: 0, wave: 0, enemies: Array.from({ length: 25 }, (_, index) => enemy(index + 1)) })).toThrow();
  });
  it('rejects malformed binary whole, and reads offset views', () => {
    const packet = encodeChunk({ time: 1, tick: 1, wave: 1, enemies: [enemy(), { ...enemy(2), full: false }] });
    expect(decodeChunk(packet.slice(0, -1))).toBeNull();
    expect(decodeChunk({})).toBeNull();
    expect(decodeChunk(new ArrayBuffer(4))).toBeNull();
    expect(decodeChunk(new Uint8Array(packet))?.enemies).toHaveLength(2);
    const offset = new Uint8Array(packet.byteLength + 8); offset.set(new Uint8Array(packet), 4);
    expect(decodeChunk(offset.subarray(4, -4))?.enemies).toHaveLength(2);
    const bad = (edit: (view: DataView) => void) => { const copy = packet.slice(0); edit(new DataView(copy)); return decodeChunk(copy); };
    expect(bad(v => v.setUint16(0, 0xc203, true))).toBeNull();             // the old format
    expect(bad(v => v.setFloat32(HEADER_BYTES + 7, NaN, true))).toBeNull();  // a position
    expect(bad(v => v.setFloat32(HEADER_BYTES + 32, -1, true))).toBeNull();  // health
    expect(bad(v => v.setUint8(HEADER_BYTES + 27, 200))).toBeNull();         // an archetype nobody has
    expect(bad(v => v.setUint8(12, 9))).toBeNull();                          // a phase nobody has
    expect(bad(v => v.setUint8(3, 3))).toBeNull();                           // more records than bytes
    expect(bad(v => v.setUint32(HEADER_BYTES + FULL_BYTES, 1, true))).toBeNull(); // the same uid twice
    expect(bad(v => v.setUint32(HEADER_BYTES, 0, true))).toBeNull();         // uid 0
    const reader = new ChunkReader();
    expect(reader.open(packet.slice(0, -1))).toBeNull();
    expect(reader.next()).toBeNull();
  });
  it('a roster names the living, and is not read as states', () => {
    const packet = encodeRoster({ time: 9, tick: 10, wave: 3, phase: 'clearing' }, [5, 9, 70000]);
    expect(packet.byteLength).toBe(HEADER_BYTES + 12);
    expect(decodeChunk(packet)).toMatchObject({ time: 9, wave: 3, alive: 3, roster: [5, 9, 70000], enemies: [] });
    expect(decodeChunk(packet.slice(0, -2))).toBeNull();
    const reader = new ChunkReader();
    reader.open(packet);
    expect(reader.next()).toBeNull();
    expect(reader.nextUid()).toBe(5);
  });
});

describe('rate tiers', () => {
  it('near by distance, by the cone ahead, for a boss and for the last few', () => {
    expect(tierOf(NEAR_M - 1, 0, 0, 0, 1, false, 30)).toBe(0);
    // Behind the guest and past the near ring: far.
    expect(tierOf(0, 0, -40, 0, 1, false, 30)).toBe(1);
    // The same distance straight ahead: near.
    expect(tierOf(0, 0, 40, 0, 1, false, 30)).toBe(0);
    // 59 degrees off the nose is in the cone, 61 is out.
    expect(tierOf(Math.sin(59 * Math.PI / 180) * 40, 0, Math.cos(59 * Math.PI / 180) * 40, 0, 1, false, 30)).toBe(0);
    expect(tierOf(Math.sin(61 * Math.PI / 180) * 40, 0, Math.cos(61 * Math.PI / 180) * 40, 0, 1, false, 30)).toBe(1);
    // Ahead but beyond the cone's reach.
    expect(tierOf(0, 0, 90, 0, 1, false, 30)).toBe(1);
    expect(tierOf(0, 0, -90, 0, 1, true, 30)).toBe(0);
    expect(tierOf(0, 0, -90, 0, 1, false, LAST_FEW)).toBe(0);
  });
  it('far enemies take turns: each goes once every fourth tick, a quarter of them on any tick, and its key tick is one of its own', () => {
    for (let uid = 1; uid <= 48; uid++) {
      let sends = 0, keys = 0;
      for (let tick = 0; tick < KEY_EVERY * 4; tick++) {
        if (dueOn(uid, tick, 1, FAR_EVERY)) sends++;
        if (keyOn(uid, tick)) { keys++; expect(dueOn(uid, tick, 1, FAR_EVERY)).toBe(true); expect(dueOn(uid, tick, 1, 10)).toBe(true); }
        expect(dueOn(uid, tick, 0, FAR_EVERY)).toBe(true);
      }
      expect(sends).toBe(KEY_EVERY);
      expect(keys).toBe(4);
    }
    for (let tick = 0; tick < 8; tick++) expect(Array.from({ length: 48 }, (_, index) => index + 1).filter(uid => dueOn(uid, tick, 1, FAR_EVERY))).toHaveLength(12);
    expect(intervalOf(0, 50)).toBe(50);
    expect(intervalOf(1, 50)).toBe(200);
    expect(intervalOf(2, 83)).toBe(830);
  });
  it('unwraps the wrapped clock and tick either way round', () => {
    expect(unwrap(5, 0xfffffff0, 32)).toBe(0x100000005);
    expect(unwrap(0xfffffff0, 0x100000005, 32)).toBe(0xfffffff0);
    expect(unwrap(3, 65534, 16)).toBe(65539);
    expect(unwrap(65534, 65539, 16)).toBe(65534);
    expect(unwrap(1000, 900, 32)).toBe(1000);
  });
});
