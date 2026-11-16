import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { WEAPONS } from '../../data';
import { Anim, type ViewDef } from '../def';
import { Kit } from '../kit/kit';
import type { VmMaterials } from '../kit/materials';
import { ultramagDef } from './ultramag';

let def: ViewDef;

beforeAll(() => {
  const material = new THREE.MeshStandardMaterial();
  const mats = {
    hard: material,
    decal: material,
    decalRegions: {},
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials;
  def = ultramagDef(new Kit(mats));
});

function pose(time = 99, mag = 6, reload = -1, shots = 1): Anim {
  const anim = new Anim();
  anim.model = def.model;
  anim.parts = def.model.parts;
  anim.mag = mag;
  anim.magSize = WEAPONS.ultramag.magSize;
  anim.reserve = 42;
  anim.sinceFire = time;
  anim.shots = shots;
  anim.reload = reload;
  def.model.resetParts();
  def.animate(anim);
  def.model.root.updateMatrixWorld(true);
  return anim;
}

function position(name: string): THREE.Vector3 {
  return def.model.parts[name]!.getWorldPosition(new THREE.Vector3());
}

describe('Ultramag viewmodel', () => {
  const TRAVEL = 0.074;
  const BORE = 0.0475;

  it('rests closed, with the top round waiting in the magazine under the slide', () => {
    const anim = pose(99, 7, -1, 0);
    expect(anim.parts.slide!.position.z).toBeCloseTo(0);
    const round = position('feedRound');
    expect(round.y).toBeCloseTo(0.017);
    expect(round.z).toBeCloseTo(0.084);
    expect(def.model.sockets.muzzle!.position.z).toBeLessThan(-0.33);
  });

  it('runs the slide fully back and hangs there with the breech face behind the next round', () => {
    expect(pose(0.02).parts.slide!.position.z).toBeGreaterThan(0.03);
    for (const time of [0.045, 0.08, 0.12]) {
      const anim = pose(time);
      expect(anim.parts.slide!.position.z, String(time)).toBeCloseTo(TRAVEL);
      const face = 0.012 + anim.parts.slide!.position.z;
      expect(face).toBeGreaterThan(position('feedRound').z);
    }
  });

  it('pushes the round up out of the magazine, then strips it forward into the chamber', () => {
    pose(0.045);
    const start = position('feedRound');
    pose(0.12);
    const popped = position('feedRound');
    expect(popped.y).toBeGreaterThan(BORE);
    expect(popped.z).toBeCloseTo(start.z);
    const mid = pose(0.19);
    const stripped = position('feedRound');
    expect(mid.parts.feedRound!.visible).toBe(true);
    expect(stripped.z).toBeLessThan(popped.z - 0.02);
    expect(Math.abs(stripped.y - BORE)).toBeLessThan(0.003);
    pose(0.244);
    const chambered = position('feedRound');
    expect(chambered.y).toBeCloseTo(BORE, 2);
    expect(chambered.z).toBeLessThan(0.013);
  });

  it('is home well inside the unchanged refire interval', () => {
    const anim = pose(0.25);
    expect(anim.parts.slide!.position.z).toBeCloseTo(0);
    expect(position('feedRound').z).toBeCloseTo(0.084);
    expect(WEAPONS.ultramag.interval).toBeGreaterThan(0.3);
  });

  it('locks back on the last shot with no round to feed', () => {
    for (const time of [0.05, 0.18, 0.3, 99]) {
      const anim = pose(time, 0);
      expect(anim.parts.feedRound!.visible, String(time)).toBe(false);
      expect(anim.parts.stack!.visible).toBe(false);
      expect(anim.parts.slide!.position.z).toBeCloseTo(TRAVEL);
    }
  });

  it('drops the slide on a fresh magazine and chambers its top round', () => {
    expect(pose(99, 0, 0.3).parts.mag!.visible).toBe(false);
    expect(pose(99, 0, 0.6).parts.feedRound!.visible).toBe(true);
    expect(pose(99, 0, 0.78).parts.slide!.position.z).toBeCloseTo(TRAVEL);
    pose(99, 0, 0.86);
    expect(position('feedRound').z).toBeLessThan(0.07);
    const closed = pose(99, 0, 0.95);
    expect(closed.parts.slide!.position.z).toBeCloseTo(0);
  });

  it('racks with the off hand on a tactical reload', () => {
    expect(pose(99, 3, 0.5).parts.slide!.position.z).toBeCloseTo(0);
    const anim = pose(99, 3, 0.78);
    expect(anim.parts.slide!.position.z).toBeCloseTo(TRAVEL);
    expect(anim.left.names).toContain('boltHold');
    expect(pose(99, 3, 0.98).parts.slide!.position.z).toBeCloseTo(0);
  });

  it('resets deterministically and stays within budget', () => {
    pose(0.16);
    const first = position('feedRound');
    pose(0.27, 0);
    pose(0.16);
    expect(position('feedRound').distanceTo(first)).toBeLessThan(1e-9);
    expect(def.model.draws).toBeLessThanOrEqual(20);
    expect(def.model.triangles).toBeLessThan(24000);
    def.model.root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const positions = node.geometry.getAttribute('position');
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    });
  });
});
