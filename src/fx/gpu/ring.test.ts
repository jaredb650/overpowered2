import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InstanceRing } from './ring';

function make(cap: number): InstanceRing {
  const ring = new InstanceRing(new THREE.BufferGeometry(), cap, ['aP', 'aV']);
  ring.object = new THREE.Mesh(ring.geometry);
  ring.object.visible = false;
  return ring;
}

const buffer = (r: InstanceRing) => r.geometry.getAttribute('aP') as THREE.InterleavedBufferAttribute;

function spawn(ring: InstanceRing, birth: number, life: number): number {
  const o = ring.alloc(birth + life);
  ring.data[o + 3] = birth;
  ring.data[o + 7] = life;
  return o;
}

describe('InstanceRing', () => {
  it('overwrites the oldest record once full', () => {
    const r = make(3);
    const a = spawn(r, 0, 10);
    spawn(r, 0, 10);
    spawn(r, 0, 10);
    expect(spawn(r, 1, 10)).toBe(a);
    r.sync(1);
    expect(r.geometry.instanceCount).toBe(3);
  });

  it('uploads only what was written, as two ranges across the wrap', () => {
    const r = make(4);
    for (let i = 0; i < 3; i++) spawn(r, 0, 10);
    r.sync(0);
    const data = buffer(r).data;
    data.clearUpdateRanges();

    spawn(r, 0, 10);
    spawn(r, 0, 10);
    r.sync(0);
    expect(data.updateRanges).toEqual([{ start: 3 * 8, count: 8 }, { start: 0, count: 8 }]);
  });

  it('uploads the whole buffer when one frame writes more than the cap', () => {
    const r = make(2);
    for (let i = 0; i < 5; i++) spawn(r, 0, 10);
    r.sync(0);
    expect(buffer(r).data.updateRanges).toEqual([{ start: 0, count: 16 }]);
  });

  it('costs nothing once everything has died', () => {
    const r = make(4);
    spawn(r, 0, 1);
    r.sync(0.5);
    expect(r.active).toBe(true);
    r.sync(1);
    expect(r.active).toBe(false);
    expect(r.geometry.instanceCount).toBe(0);
    expect(spawn(r, 2, 1)).toBe(0);
  });

  it('counts only particles that are alive', () => {
    const r = make(4);
    spawn(r, 0, 1);
    spawn(r, 0, 3);
    spawn(r, 5, 1);
    expect(r.countLive(2)).toBe(1);
  });

  it('trims trailing dead slots while preserving draw order on order-dependent rings', () => {
    const r = make(6);
    spawn(r, 0, 10);
    spawn(r, 0, 1);
    spawn(r, 0, 1);
    r.sync(0.5);
    expect(r.geometry.instanceCount).toBe(3);
    r.sync(2);
    expect(r.active).toBe(true);
    expect(r.geometry.instanceCount).toBe(1);
    expect(r.countLive(2)).toBe(1);
  });

  it('swap-compacts dead holes on order-independent rings', () => {
    const r = new InstanceRing(new THREE.BufferGeometry(), 6, ['aP', 'aV'], true);
    r.object = new THREE.Mesh(r.geometry);
    r.object.visible = false;
    const o0 = spawn(r, 0, 1);
    r.data[o0] = 10;
    const o1 = spawn(r, 0, 10);
    r.data[o1] = 20;
    const o2 = spawn(r, 0, 1);
    r.data[o2] = 30;
    const o3 = spawn(r, 0, 10);
    r.data[o3] = 40;
    r.sync(0.5);
    expect(r.geometry.instanceCount).toBe(4);
    r.sync(2);
    expect(r.active).toBe(true);
    expect(r.geometry.instanceCount).toBe(2);
    expect(r.countLive(2)).toBe(2);
    // Slot 0 received slot 3 (x=40), slot 1 kept x=20.
    expect([r.data[0], r.data[8]].sort((a, b) => a! - b!)).toEqual([20, 40]);
  });
});
