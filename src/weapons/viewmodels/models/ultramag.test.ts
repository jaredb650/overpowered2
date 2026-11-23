import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModId } from '../../../core/gameplay';
import { WEAPONS } from '../../data';
import { COMP, moddedDef } from '../../mods';
import { Anim, type ViewDef } from '../def';
import { Kit } from '../kit/kit';
import type { VmMaterials } from '../kit/materials';
import { ultramagDef } from './ultramag';

let def: ViewDef;
let hardMaterial: THREE.Material;

beforeAll(() => {
  const material = new THREE.MeshStandardMaterial();
  hardMaterial = material;
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

function pose(time = 99, mag = 6, reload = -1, shots = 1, mods: readonly ModId[] = []): Anim {
  const anim = new Anim();
  anim.mods = new Set(mods);
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
  // Authored a tenth larger and built at S: every model-space length here is the authored one times S.
  const S = 0.9;
  const TRAVEL = 0.074 * S;
  const BORE = 0.0475 * S;
  const BREECH = 0.012 * S;
  const FEED = [0.017 * S, 0.084 * S] as const;

  it('rests closed, with the top round waiting in the magazine under the slide', () => {
    const anim = pose(99, 7, -1, 0);
    expect(anim.parts.slide!.position.z).toBeCloseTo(0);
    const round = position('feedRound');
    expect(round.y).toBeCloseTo(FEED[0]);
    expect(round.z).toBeCloseTo(FEED[1]);
    expect(def.model.sockets.muzzle!.position.z).toBeLessThan(-0.3);
  });

  it('runs the slide fully back and hangs there with the breech face behind the next round', () => {
    expect(pose(0.02).parts.slide!.position.z).toBeGreaterThan(0.03);
    for (const time of [0.045, 0.08, 0.12]) {
      const anim = pose(time);
      expect(anim.parts.slide!.position.z, String(time)).toBeCloseTo(TRAVEL);
      const face = BREECH + anim.parts.slide!.position.z;
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
    expect(chambered.z).toBeLessThan(BREECH + 0.001);
  });

  it('is home well inside the unchanged refire interval', () => {
    const anim = pose(0.25);
    expect(anim.parts.slide!.position.z).toBeCloseTo(0);
    expect(position('feedRound').z).toBeCloseTo(FEED[1]);
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
    expect(position('feedRound').z).toBeLessThan(0.07 * S);
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

  it('fits its cycle inside the laser module\'s faster interval', () => {
    const interval = moddedDef('ultramag', new Set(['ultramagLam'])).interval;
    expect(interval).toBeLessThan(WEAPONS.ultramag.interval);
    const anim = pose(interval - 0.02);
    expect(anim.parts.slide!.position.z).toBeCloseTo(0);
    expect(position('feedRound').z).toBeCloseTo(FEED[1]);
  });

  it('shows each mod as a part, the extended magazine riding with the magazine', () => {
    for (const [id, look] of Object.entries(def.mods ?? {})) expect(def.model.parts[look!.part], id).toBeDefined();
    expect(Object.keys(def.mods ?? {}).sort()).toEqual(['ultramagCan', 'ultramagComp', 'ultramagDot', 'ultramagLam', 'ultramagLight', 'ultramagMag', 'ultramagMagwell', 'ultramagShield']);
    // The laser's emitter faces down the bore, ahead of the module.
    const laser = def.model.sockets[def.mods!.ultramagLam!.laser!]!;
    expect(laser.position.z).toBeLessThan(-0.25);
    expect(laser.position.y).toBeLessThan(def.model.sockets.muzzle!.position.y - 0.05);
    expect(def.model.parts.magExt!.parent).toBe(def.model.parts.mag);
    // The reflex sight rides the slide, so it cycles with it.
    expect(def.model.parts.rmr!.parent).toBe(def.model.parts.slide);
  });

  it('keeps the suppressor under the sight line and the reflex dot over the irons', () => {
    pose(99, 7, -1, 0);
    const can = new THREE.Box3().setFromObject(def.model.parts.can!);
    expect(can.max.y).toBeLessThan(def.sight![1] - 0.004);
    expect(can.min.z).toBeLessThan(def.model.sockets.muzzle!.position.z - 0.12);
    expect(def.model.sockets.muzzleCan!.position.z).toBeLessThan(can.min.z + 0.003);
    const dot = def.mods!.ultramagDot!;
    expect(dot.rear).toBeNull();
    // The rear blade stands behind the sight, nearer the eye: its top must fall under the window's bottom edge (10.5 mm
    // authored under the dot) as the eye sees them, and it must still be ahead of the eye.
    const toBlade = dot.relief! - (def.rear![2] - dot.sight![2]);
    expect(toBlade).toBeGreaterThan(0.05);
    const bladeDrop = dot.sight![1] - (def.rear![1] + 0.0052 * S);
    expect(bladeDrop / toBlade).toBeGreaterThan((0.0105 * S) / dot.relief!);
  });

  it('fits the compensator on the barrel past the muzzle, under the sight line, its own muzzle at its face', () => {
    pose(99, 7, -1, 0);
    const comp = new THREE.Box3().setFromObject(def.model.parts.comp!);
    const muzzle = def.model.sockets.muzzle!.position.z;
    expect(comp.max.y).toBeLessThan(def.sight![1] - 0.004);
    expect(comp.min.z).toBeLessThan(muzzle - 0.06);
    expect(comp.max.z).toBeLessThan(muzzle + 0.006);
    expect(def.model.sockets.muzzleComp!.position.z).toBeLessThan(comp.min.z + 0.003);
    expect(def.mods!.ultramagComp!.flip).toBe(COMP.flip);
  });

  it('flips less with the compensator, and the slide still runs its whole cycle in the stacked interval', () => {
    for (const time of [0.01, 0.02, 0.06]) {
      const bare = pose(time).gunR.x;
      const comp = pose(time, 6, -1, 1, ['ultramagComp']).gunR.x;
      expect(comp, String(time)).toBeCloseTo(bare * COMP.flip);
      expect(comp).toBeGreaterThan(0);
    }
    expect(pose(0.08, 6, -1, 1, ['ultramagComp']).parts.slide!.position.z).toBeCloseTo(TRAVEL);
    const interval = moddedDef('ultramag', new Set(['ultramagComp', 'ultramagLam'])).interval;
    pose(interval - 0.002, 6, -1, 1, ['ultramagComp', 'ultramagLam']);
    expect(def.model.parts.slide!.position.z).toBeCloseTo(0);
    expect(position('feedRound').z).toBeCloseTo(FEED[1]);
  });

  it('leaves the reflex sight\'s window open from the aimed eye: nothing but its glass and its dot in the way', () => {
    pose(99, 7, -1, 0);
    const dot = def.mods!.ultramagDot!;
    const eye = new THREE.Vector3(dot.sight![0], dot.sight![1], dot.sight![2] + dot.relief!);
    // Across the window, 10 mm wide and 7 mm high around the dot at the built size: the test's materials have no glass.
    for (const [dx, dy] of [[0, 0.002], [0.008, 0.005], [-0.008, 0.005], [0.008, -0.006], [-0.008, -0.006], [0, 0.007]]) {
      const target = new THREE.Vector3(dot.sight![0] + dx, dot.sight![1] + dy, dot.sight![2]);
      const ray = new THREE.Raycaster(eye, target.sub(eye).normalize());
      const hits = ray.intersectObject(def.model.root, true).filter(h => (h.object as THREE.Mesh).material === hardMaterial);
      expect(hits.length, `${dx}, ${dy}`).toBe(0);
    }
  });

  it('resets deterministically and stays within budget', () => {
    pose(0.16);
    const first = position('feedRound');
    pose(0.27, 0);
    pose(0.16);
    expect(position('feedRound').distanceTo(first)).toBeLessThan(1e-9);
    expect(def.model.draws).toBeLessThanOrEqual(32);
    // All mod parts are baked and hidden until fitted (including ultramagMagwell and the shared riot shield).
    expect(def.model.triangles).toBeLessThan(50000);
    def.model.root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const positions = node.geometry.getAttribute('position');
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    });
  });
});
