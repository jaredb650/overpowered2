import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { WoundKind } from '../characters/anatomy/wounds';
import { HumanoidBone as B, humanoidRig } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo, WoundHit } from '../core/contracts';
import { TestDummy } from './testDummy';
import { WoundPlanner, WoundTuning } from './wounds';

/** Records what a body was given, because the planner reuses its one hit object. */
class Marked extends TestDummy {
  readonly hits: (Omit<WoundHit, 'point' | 'dir' | 'along'> & { point: THREE.Vector3; dir: THREE.Vector3; along?: THREE.Vector3 })[] = [];
  readonly snapped: { bone: number; style: string }[] = [];

  override wound(hit: WoundHit): void {
    this.hits.push({ ...hit, point: hit.point.clone(), dir: hit.dir.clone(), along: hit.along?.clone() });
  }

  override fracture(bone: number, style?: 'hyper' | 'limp'): boolean {
    const fresh = super.fracture(bone);
    if (fresh) this.snapped.push({ bone, style: style ?? 'hyper' });
    return fresh;
  }
}

const ctx = {
  player: { eye: new THREE.Vector3(0, 1.6, 4) },
  fx: { bloodHit() {} },
  audio: { play() {} },
} as unknown as Ctx;

function setup(machine = false) {
  const body = new Marked(humanoidRig('dummy'));
  body.root.updateMatrixWorld(true);
  const opened: number[] = [];
  const planner = new WoundPlanner(ctx, () => machine, (_c: CharacterInstance, bone: number) => opened.push(bone));
  return { body, planner, opened };
}

const damage = (o: Partial<DamageInfo>): DamageInfo => ({
  amount: 25, type: 'bullet', point: new THREE.Vector3(0, 1.3, 0.2), dir: new THREE.Vector3(0, 0, -1), force: 0, source: 'smg', bone: B.chest, ...o,
});

const place = (body: Marked, bone: number, x = 0, y = 0, z = 0.05): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(body.bones[bone]!.matrixWorld);

afterEach(() => {
  WoundTuning.level = 1;
});

describe('what each weapon leaves', () => {
  it('an SMG round makes one small hole and stays in the chest', () => {
    const { body, planner } = setup();
    planner.onBody(body, damage({}), 0.2);
    expect(body.hits.length).toBe(1);
    expect(body.hits[0]!.kind).toBe(WoundKind.hole);
    expect(body.hits[0]!.radius).toBeLessThan(0.02);
  });

  it('a revolver goes through: a small way in and a bigger, ragged way out on the far side', () => {
    const { body, planner } = setup();
    planner.onBody(body, damage({ source: 'judge', amount: 60, point: place(body, B.chest, 0, 0.1, 0.16) }), 0.5);
    const [entry, exit] = body.hits;
    expect(exit!.kind).toBe(WoundKind.exit);
    expect(exit!.radius).toBeGreaterThan(entry!.radius * 2.5);
    expect(exit!.ragged).toBeGreaterThan(entry!.ragged);
    expect(exit!.point.z).toBeLessThan(entry!.point.z - 0.2);
    expect(exit!.dir.z).toBeGreaterThan(0.9);
  });

  it('a shotgun tears a crater up close and leaves holes at range', () => {
    const near = setup();
    near.planner.onBody(near.body, damage({ type: 'pellet', source: 'shotgun', point: new THREE.Vector3(0, 1.3, 3) }), 0.2);
    expect(near.body.hits[0]!.kind).toBe(WoundKind.crater);
    const far = setup();
    far.planner.onBody(far.body, damage({ type: 'pellet', source: 'shotgun', point: new THREE.Vector3(0, 1.3, -6) }), 0.2);
    expect(far.body.hits[0]!.kind).toBe(WoundKind.hole);
    expect(far.body.hits[0]!.radius).toBeLessThan(near.body.hits[0]!.radius / 2);
  });

  it('a sword leaves a long thin gash that runs along the blade', () => {
    const { body, planner } = setup();
    const plane = new THREE.Vector3(0, 1, 0);
    planner.onBody(body, damage({ type: 'slash', source: 'sword', amount: 40, slicePlaneNormal: plane, point: place(body, B.chest, 0, 0.1, 0.15) }), 0.5);
    const g = body.hits[0]!;
    expect(g.kind).toBe(WoundKind.gash);
    expect(g.length!).toBeGreaterThan(g.radius * 5);
    expect(Math.abs(g.along!.dot(plane))).toBeLessThan(0.01);
  });

  it('a blast opens the side that faced it, and scorches it', () => {
    const { body, planner } = setup();
    const point = place(body, B.chest, 0, 0.1, 0);
    planner.onBody(body, damage({ type: 'explosive', source: 'rocket', amount: 60, point, dir: new THREE.Vector3(0, 0, -1), bone: undefined }), 0.85);
    const crater = body.hits.find(h => h.kind === WoundKind.crater)!;
    expect(crater.radius).toBeGreaterThan(0.12);
    expect(crater.point.z).toBeGreaterThan(point.z);
    expect(body.hits.some(h => h.kind === WoundKind.burn)).toBe(true);
    expect(body.hits.filter(h => h.kind === WoundKind.hole).length).toBeGreaterThan(2);
  });

  it('a light blast burns and peppers but opens nothing', () => {
    const { body, planner } = setup();
    planner.onBody(body, damage({ type: 'explosive', source: 'rocket', amount: 6, point: place(body, B.chest, 0, 0.1, 0), bone: undefined }), 0.08);
    expect(body.hits.some(h => h.kind === WoundKind.crater)).toBe(false);
    expect(body.hits.some(h => h.kind === WoundKind.burn)).toBe(true);
  });

  it('fire chars and takes nothing away', () => {
    const { body, planner } = setup();
    planner.onBody(body, damage({ type: 'fire', source: 'kiln', amount: 9 }), 0.1);
    expect(body.hits.map(h => h.kind)).toEqual([WoundKind.burn]);
  });
});

describe('breaking limbs', () => {
  it('snaps an elbow the wrong way from one heavy hit on the forearm, with a hole for the bone', () => {
    const { body, planner, opened } = setup();
    planner.onBody(body, damage({ source: 'judge', amount: 60, bone: B.foreArmL, point: place(body, B.foreArmL, 0.04, -0.12, 0.05) }), 0.5);
    expect(body.snapped).toEqual([{ bone: B.foreArmL, style: 'hyper' }]);
    expect(opened).toEqual([B.foreArmL]);
    expect(body.hits.at(-1)!.kind).toBe(WoundKind.crater);
    expect(body.hits.at(-1)!.bone).toBe(B.upperArmL);
  });

  it('kills a shoulder from a heavy hit on the upper arm', () => {
    const { body, planner } = setup();
    planner.onBody(body, damage({ source: 'autocannon', amount: 60, bone: B.upperArmR, point: place(body, B.upperArmR, -0.05, -0.14, 0.05) }), 0.5);
    expect(body.snapped).toEqual([{ bone: B.upperArmR, style: 'limp' }]);
  });

  it('wears a limb down under sustained small arms', () => {
    const { body, planner } = setup();
    const hit = damage({ bone: B.shinL, amount: 25, point: place(body, B.shinL, 0, -0.2, 0.05) });
    planner.onBody(body, hit, 0.2);
    expect(body.snapped.length).toBe(0);
    for (let i = 0; i < 8; i++) planner.onBody(body, hit, 0.2);
    expect(body.snapped).toEqual([{ bone: B.shinL, style: 'hyper' }]);
  });

  it('leaves a chest hit and a machine alone', () => {
    const flesh = setup();
    flesh.planner.onBody(flesh.body, damage({ source: 'autocannon', amount: 300 }), 1);
    expect(flesh.body.snapped.length).toBe(0);
    const machine = setup(true);
    machine.planner.onBody(machine.body, damage({ source: 'judge', amount: 300, bone: B.shinL, point: place(machine.body, B.shinL, 0, -0.2, 0.05) }), 1);
    expect(machine.body.snapped.length).toBe(0);
  });
});

describe('the Gore setting', () => {
  it('Low paints and opens nothing, and breaks nothing', () => {
    WoundTuning.level = 0;
    const { body, planner } = setup();
    planner.onBody(body, damage({ source: 'judge', amount: 120, bone: B.foreArmL, point: place(body, B.foreArmL, 0.04, -0.12, 0.05) }), 1);
    expect(body.hits.every(h => h.kind === WoundKind.graze)).toBe(true);
    expect(body.snapped.length).toBe(0);
  });

  it('Excessive cuts wider', () => {
    const full = setup();
    full.planner.onBody(full.body, damage({}), 0.2);
    WoundTuning.level = 2;
    const more = setup();
    more.planner.onBody(more.body, damage({}), 0.2);
    expect(more.body.hits[0]!.radius).toBeGreaterThan(full.body.hits[0]!.radius);
  });
});
