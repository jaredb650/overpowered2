/**
 * The gore update's G1 and G2 on real Rapier: a rocket's kill cracks the trunk, the pieces are thrown up and out of where
 * the fireball is at full weight, they trail blood, the mid-size slabs are there, and it all comes down near.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig, HumanoidBone as B } from '../characters/rig';
import type { Ctx, DamageInfo } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { BLAST } from '../enemies/blast';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { EXPLOSIONS, TUNING } from '../weapons/data';
import { ChunkTuning } from './chunks';
import { createGoreSystem, GibThrow, type Gore } from './index';
import { RIB_KINDS } from './organs';
import { SlabTuning } from './slabs';
import { TestDummy } from './testDummy';
import { TrailTuning } from './trail';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
let trails = 0;
let hose = 0;
const scene = new THREE.Scene();

function spawn(x = 0, z = 0): TestDummy {
  const char = new TestDummy(humanoidRig('human'));
  char.root.position.set(x, 0, z);
  scene.add(char.root);
  char.root.updateMatrixWorld(true);
  return char;
}

function step(n: number): void {
  for (let i = 0; i < n; i++) {
    ctx.time.tick(1 / 60);
    physics.step(ctx.time.dt);
    gore.update();
  }
}

/** The damage a rocket's blast puts on a body `reach` of the way out of its fireball, `side` metres to the body's side. */
function rocket(char: TestDummy, reach = 0.5, side = 0.4): { d: DamageInfo; force: number; centre: THREE.Vector3 } {
  const at = v(0, 0, 0).setFromMatrixPosition(char.bones[B.spine]!.matrixWorld);
  const centre = at.clone().add(v(side, -at.y + 0.25, 0.2));
  const falloff = 1 - reach * BLAST.rings.rocket[0] * (1 - EXPLOSIONS.rocket.edgeDamage);
  const force = TUNING.blastForce * EXPLOSIONS.rocket.impulse * TUNING.rocket.radius * falloff;
  const dir = at.clone().sub(centre);
  dir.y += 0.6;
  return { d: { amount: 100, type: 'explosive', point: at, dir: dir.normalize(), force, source: 'rocket', blastKind: 'rocket', reach: 0.1 }, force, centre };
}

type Half = { mesh: THREE.Mesh; body: { gravityScale(): number; linvel(): { x: number; y: number; z: number } } | null; sinking: number };
type Chunk = { alive: boolean; kind: string; p: THREE.Vector3; body: { gravityScale(): number; translation(): { x: number; y: number; z: number } } | null };
const halves = (): Half[] => (gore.sliced as unknown as { halves: Half[] }).halves;
const chunks = (): Chunk[] => (gore.chunks as unknown as { all: Chunk[] }).all.filter(c => c.alive);

beforeAll(async () => {
  physics = await Physics.create();
  physics.addStaticBox(v(0, -0.5, 0), v(60, 0.5, 60), null, 'concrete');
  physics.flushQueries();
  // Every effect a no-op, bar the two that draw a piece's trail: those are counted.
  const counted: Record<string, unknown> = {
    gibTrail: () => { trails++; },
    bloodHose: (_chain: Float32Array, count: number) => { hose = Math.max(hose, count); },
  };
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
    fx: new Proxy(counted, { get: (t, k: string) => t[k] ?? (() => null) }) as unknown as Ctx['fx'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
});

beforeEach(() => {
  gore.clear();
  // A new frame: past three gibs in one, a gib is the small version.
  step(1);
  trails = 0;
  hose = 0;
  DevFlags.gibThrow = true;
});
afterAll(() => gore.clear());

describe('a rocket into one man', () => {
  it('cracks his trunk: three to six pieces, the whole ribcage, four organs and the slabs, on any roll that cracks', () => {
    let cracks = 0;
    for (let i = 0; i < 12; i++) {
      gore.clear();
      step(1);
      const char = spawn(i * 0.37, i * 0.21);
      const { d, force, centre } = rocket(char, (i % 4) / 3);
      gore.gib(char, centre, force, d);
      if (d.torso !== 'crack') {
        // One in five tears at the waist: two halves, and still the slabs.
        expect(d.torso).toBe('waist');
        expect(gore.stats().halves).toBe(2);
        expect(chunks().filter(c => c.kind.startsWith('slab:')).length).toBe(Math.min(SlabTuning.waist, gore.kitFor(char).slabs.length));
        continue;
      }
      cracks++;
      expect(gore.stats().halves).toBeGreaterThanOrEqual(5);
      for (const k of RIB_KINDS) expect(gore.chunks.aliveOf(k)).toBe(1);
      const organs = chunks().filter(c => ['lung', 'liver', 'heart', 'stomach'].includes(c.kind)).length;
      expect(organs).toBe(4);
      expect(chunks().filter(c => c.kind.startsWith('slab:')).length).toBe(Math.min(SlabTuning.full, gore.kitFor(char).slabs.length));
    }
    expect(cracks).toBeGreaterThanOrEqual(7);
  });

  it('throws every piece of the trunk up over the fireball, at full weight, and brings it down near', () => {
    const char = spawn();
    const { d, force, centre } = rocket(char);
    d.torso = 'crack';
    gore.gib(char, centre, force, d);
    const n = halves().length;
    expect(n).toBeGreaterThanOrEqual(5);
    // No floaty pieces (the owner's rule): every body thrown falls at the world's own gravity.
    for (const h of halves()) expect(h.body!.gravityScale()).toBe(1);
    for (const c of chunks()) expect(c.body!.gravityScale()).toBe(1);
    // Thrown up hard: every trunk piece leaves at 6 m/s or more upward.
    for (const h of halves()) expect(h.body!.linvel().y).toBeGreaterThan(6);
    // A rocket's fireball is gone at 0.24 s and is about 2.5 m tall: by 0.4 s the pieces are over where it was.
    step(24);
    const up = halves().filter(h => h.mesh.position.y > 2.2).length;
    expect(up).toBeGreaterThanOrEqual(n - 1);
    for (const h of halves()) expect(h.mesh.position.y).toBeGreaterThan(1.5);
    const air = chunks().filter(c => c.body && c.body.translation().y > 1.2).length;
    expect(air).toBeGreaterThan(chunks().length * 0.7);
    // Still in the air at 0.8 s, and down by 1.6 s, within sight of where he stood.
    step(24);
    expect(halves().filter(h => h.mesh.position.y > 0.6).length).toBeGreaterThanOrEqual(n - 2);
    step(48);
    for (const h of halves()) {
      expect(h.mesh.position.y).toBeLessThan(0.6);
      expect(Math.hypot(h.mesh.position.x, h.mesh.position.z)).toBeLessThan(9);
    }
    for (const c of chunks()) expect(c.p.y).toBeGreaterThan(-0.02);
  });

  it('goes all round and not only on with the blast, so some of it comes back toward the gun', () => {
    let toward = 0;
    let away = 0;
    for (let i = 0; i < 6; i++) {
      gore.clear();
      step(1);
      const char = spawn(i, 0);
      const { d, force, centre } = rocket(char, 0.5, 0.4);
      d.torso = 'crack';
      gore.gib(char, centre, force, d);
      // The blast came from +x: away is -x.
      for (const h of halves()) (h.body!.linvel().x > 0 ? toward++ : away++);
    }
    expect(away).toBeGreaterThan(toward);
    expect(toward).toBeGreaterThan(0);
  });

  it('with the switch off, leaves as it did before', () => {
    DevFlags.gibThrow = false;
    const char = spawn();
    const { d, force, centre } = rocket(char);
    d.torso = 'crack';
    gore.gib(char, centre, force, d);
    const up = halves().map(h => h.body!.linvel().y);
    expect(up.reduce((a, b) => a + b, 0) / up.length).toBeLessThan(6);
    expect(GibThrow.on).toBe(true);
  });
});

describe('the blood a piece trails', () => {
  it('draws a ribbon behind each big piece while it flies, inside the pool, and is gone when it has landed', () => {
    const char = spawn();
    const { d, force, centre } = rocket(char);
    d.torso = 'crack';
    gore.gib(char, centre, force, d);
    step(12);
    // Five trunk pieces, five limbs, four organs and the slabs.
    expect(gore.trail.live).toBeGreaterThanOrEqual(10);
    expect(gore.trail.live).toBeLessThanOrEqual(TrailTuning.max);
    expect(hose).toBeGreaterThan(30);
    expect(hose).toBeLessThanOrEqual(gore.trail.points);
    // The small ones leave strands, a few a frame.
    expect(trails).toBeGreaterThan(0);
    expect(trails).toBeLessThanOrEqual(12 * TrailTuning.perFrame);
    step(180);
    expect(gore.trail.live).toBe(0);
  });

  it('stays inside its pool when a crowd goes at once', () => {
    for (let i = 0; i < 8; i++) {
      const char = spawn(i * 1.1 - 4, 0);
      const { d, force, centre } = rocket(char);
      gore.gib(char, centre, force, d);
    }
    step(6);
    expect(gore.trail.live).toBeLessThanOrEqual(TrailTuning.max);
    expect(gore.stats().chunkBodies).toBeLessThanOrEqual(ChunkTuning.maxBodies);
    expect(hose).toBeLessThanOrEqual(gore.trail.points);
  });
});

describe('slabs', () => {
  it('are lifted off the trunk in forearm-sized pieces with skin on one face and meat on the other', () => {
    const char = spawn();
    const kit = gore.kitFor(char);
    expect(kit.slabs.length).toBeGreaterThanOrEqual(4);
    for (const slab of kit.slabs) {
      const g = slab.geometry;
      expect(g.groups.length).toBe(2);
      expect(g.groups[0]!.count).toBeGreaterThan(60);
      expect(g.groups[1]!.count).toBeGreaterThan(g.groups[0]!.count);
      const size = slab.half.clone().multiplyScalar(2);
      const [thin, , long] = [size.x, size.y, size.z].sort((a, b) => a - b);
      // About a forearm long, and thick: never a sheet.
      expect(long!).toBeGreaterThan(0.16);
      expect(long!).toBeLessThan(0.45);
      expect(thin!).toBeGreaterThan(0.035);
      expect(slab.litres).toBeGreaterThan(0.25);
      expect(slab.litres).toBeLessThan(5);
      const p = g.getAttribute('position').array as Float32Array;
      for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i]!)).toBe(true);
      const c = g.getAttribute('color');
      expect(c.count).toBe(g.getAttribute('position').count);
    }
  });
});
