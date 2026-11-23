import { describe, expect, it } from 'vitest';
import { decodePose, encodePose, MOVES, PoseBuffer, type Pose } from './pose';
const pose = (seq = 1, x = 0): Pose => ({ seq, position: [x, 1, 2], velocity: [3, -4, 5], yaw: 0.5, pitch: -0.25, move: 'walk', weapon: 'pistol' });

describe('pose wire format', () => {
  it('round trips all locomotion states, fields, slots and uint32 wrap', () => {
    for (const move of MOVES) for (let slot = 0; slot < 4; slot++) {
      // The doing bits ride along: a reload, a stim, the laser, a charge and its mode (DOING).
      const p = { ...pose(0xffffffff), move, flags: (slot * 7 + 1) & 31 };
      const bytes = encodePose(p, slot);
      expect(bytes.byteLength).toBe(47);
      expect(decodePose(bytes)).toEqual({ slot, pose: p });
      const offset = new Uint8Array(bytes.byteLength + 12);
      offset.set(new Uint8Array(bytes), 7);
      expect(decodePose(offset.subarray(7, 7 + bytes.byteLength))).toEqual({ slot, pose: p });
    }
  });
  it('drops malformed, truncated, wrong version, impossible and non-finite packets', () => {
    for (const data of [null, {}, 'pose', new ArrayBuffer(40), new ArrayBuffer(100)]) expect(decodePose(data)).toBeNull();
    for (const [byte, value] of [[0, 1], [1, 4], [2, MOVES.length], [3, 0]]) {
      const bytes = encodePose(pose(), 0);
      new DataView(bytes).setUint8(byte!, value!);
      expect(decodePose(bytes)).toBeNull();
    }
    for (const value of [NaN, Infinity, -Infinity, 10001]) {
      const bytes = encodePose(pose(), 0);
      new DataView(bytes).setFloat32(8, value, true);
      expect(decodePose(bytes)).toBeNull();
    }
    expect(() => encodePose({ ...pose(), weapon: 'x'.repeat(33) }, 0)).toThrow();
    expect(() => encodePose({ ...pose(), move: 'hack' as Pose['move'] }, 0)).toThrow();
  });
});

describe('100ms interpolation buffer', () => {
  it('holds the first and last poses, and interpolates position, velocity and pitch on receiver time', () => {
    const b = new PoseBuffer();
    expect(b.sample(0)).toBeNull();
    b.push(pose(1, 0), 1000);
    b.push({ ...pose(2, 4), pitch: 0.25, velocity: [7, 0, 1] }, 1100);
    expect(b.sample(1000)?.position[0]).toBe(0);
    expect(b.sample(1150)).toMatchObject({ position: [2, 1, 2], velocity: [5, -2, 3], pitch: 0 });
    expect(b.sample(10000)?.position[0]).toBe(4);
  });
  it('takes the short path around yaw wrap and drops duplicate/out of order poses', () => {
    const b = new PoseBuffer();
    b.push({ ...pose(0xfffffffe), yaw: Math.PI - 0.1 }, 0);
    expect(b.push(pose(0xfffffffe), 20)).toBe(false);
    expect(b.push(pose(0xfffffffd), 30)).toBe(false);
    expect(b.push({ ...pose(0), yaw: -Math.PI + 0.1 }, 100)).toBe(true);
    expect(b.sample(150)?.yaw).toBeCloseTo(Math.PI);
  });
  it('snaps teleports and keeps working across long streams and equal arrival times', () => {
    const b = new PoseBuffer();
    b.push(pose(1), 0);
    b.push(pose(2, 100), 50);
    expect(b.sample(50)?.position[0]).toBe(100);
    for (let i = 3; i < 100; i++) b.push(pose(i, 100 + i / 100), 50);
    expect(Number.isFinite(b.sample(151)?.position[0])).toBe(true);
    expect(b.sample(1000)?.seq).toBe(99);
  });
  it('recovers when a reconnected peer resets its sequence number after a stale gap', () => {
    const b = new PoseBuffer();
    b.push(pose(500, 10), 1000);
    // Out-of-order within the live window is still dropped.
    expect(b.push(pose(1, 20), 1500)).toBe(false);
    // After a >2s silence (e.g. peer reloaded and restarted seq at 1), accept and snap cleanly.
    expect(b.push(pose(1, 20), 3600)).toBe(true);
    expect(b.sample(3700)).toMatchObject({ seq: 1, position: [20, 1, 2] });
  });
});
