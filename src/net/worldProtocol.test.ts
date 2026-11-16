import { describe, expect, it } from 'vitest';
import { decodeWorld, encodeWorld, ENEMY_BYTES, ENEMY_IDS, HEADER_BYTES, type EnemyFrame } from './worldProtocol';

const enemy = (uid = 1): EnemyFrame => ({ uid, id: 'husk', position: [1.25, -2, 30], velocity: [2.25, 0, -1.5], yaw: 0.75,
  health: 13, maxHealth: 100, armor: 45, flags: 9, animation: 2, severed: 1 << 7, plates: 255, posture: 'handsUp' });

describe('compact enemy snapshots', () => {
  it('round trips every archetype, wounds, armour, animation, and sequence wrap', () => {
    const enemies = ENEMY_IDS.map((id, index) => ({ ...enemy(index + 1), id }));
    const packet = encodeWorld({ seq: 0xffffffff, wave: 12, enemies });
    expect(packet.byteLength).toBe(HEADER_BYTES + ENEMY_BYTES * enemies.length);
    expect(decodeWorld(packet)).toEqual({ seq: 0xffffffff, wave: 12, phase: 'intermission', nextWaveIn: 0, enemies });
    expect(decodeWorld(encodeWorld({ seq: 0, wave: 0, enemies: [] }))).toEqual({ seq: 0, wave: 0, phase: 'intermission', nextWaveIn: 0, enemies: [] });
  });
  it('bounds a full 48-enemy wave to 2172 bytes and rejects malformed binary', () => {
    expect(encodeWorld({ seq: 1, wave: 4, enemies: Array.from({ length: 48 }, (_, index) => enemy(index + 1)) }).byteLength).toBe(2172);
    const packet = encodeWorld({ seq: 1, wave: 1, enemies: [enemy()] });
    expect(decodeWorld(packet.slice(0, -1))).toBeNull();
    expect(decodeWorld({})).toBeNull();
    expect(decodeWorld(new Uint8Array(packet))?.enemies).toHaveLength(1);
    const offset = new Uint8Array(packet.byteLength + 8); offset.set(new Uint8Array(packet), 4);
    expect(decodeWorld(offset.subarray(4, -4))?.enemies).toHaveLength(1);
    new DataView(packet).setFloat32(20, NaN, true);
    expect(decodeWorld(packet)).toBeNull();
    expect(decodeWorld(encodeWorld({ seq: 1, wave: 1, enemies: [enemy(), enemy()] }))).toBeNull();
  });
});
