/**
 * The gore update's G1 and G2 on real Rapier: a rocket's kill cracks the trunk, the pieces are thrown up and out of where
 * the fireball is at full weight, they trail blood, the mid-size slabs are there, and it all comes down near.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { droneRig, humanoidRig, HumanoidBone as B, skitterRig } from '../characters/rig';
import type { Ctx, DamageInfo } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import { BLAST } from '../enemies/blast';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { EXPLOSIONS, TUNING } from '../weapons/data';
import { ChunkTuning, OrganTuning } from './chunks';
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
    // Past the cap on bodies the oldest pieces fly on without one: nothing is left standing in the air.
    expect(chunks().length).toBeGreaterThan(ChunkTuning.maxBodies);
    step(240);
    for (const c of chunks()) expect(c.p.y).toBeLessThan(0.6);
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

describe('guts', () => {
  it('leave a burst body as their own strands, thrown clear, hanging from nothing', () => {
    const char = spawn();
    const { d, force, centre } = rocket(char);
    d.torso = 'crack';
    gore.gib(char, centre, force, d);
    expect(gore.ropes.loose).toBeGreaterThanOrEqual(2);
    expect(gore.stats().guts).toBe(gore.ropes.loose);
    step(30);
    // In the air and on their way out at half a second.
    const high = gore.ropes.loosePoints().filter(x => x[1]! > 1.2).length;
    expect(high).toBeGreaterThanOrEqual(1);
    step(150);
    for (const x of gore.ropes.loosePoints()) for (let i = 1; i < x.length; i += 3) expect(x[i]!).toBeGreaterThan(-0.01);
  });

  it('a belly opened before the burst lets go of its guts instead of taking them with the body', () => {
    const char = spawn();
    const belly = v(0, 0, 0).setFromMatrixPosition(char.bones[B.spine]!.matrixWorld);
    gore.wound(char, { amount: 30, type: 'pellet', point: belly, dir: v(0, 0, -1), force: 0, source: 'shotgun', bone: B.spine, region: 'abdomen', spill: true }, 0.3);
    expect(gore.ropes.hangingFrom(char.root)).toBe(1);
    const { d, force, centre } = rocket(char);
    d.torso = 'crack';
    const before = gore.ropes.loose;
    gore.gib(char, centre, force, d);
    expect(gore.ropes.hangingFrom(char.root)).toBe(0);
    expect(gore.ropes.loose).toBeGreaterThanOrEqual(before + 3);
  });

  it('drape over what they land on: caught on a ledge, with the rest hanging off it', () => {
    // A rail, thinner than a strand's coil is wide.
    const wall = physics.addStaticBox(v(20, 0.35, 0), v(0.03, 0.35, 2), null, 'concrete');
    physics.flushQueries();
    void wall;
    for (let k = 0; k < 4; k++) gore.ropes.spill(v(19.0 + k * 0.1, 1.5, -0.6 + k * 0.4), v(2.6, 1.5, 0), 1, 3 + k);
    step(240);
    expect(gore.ropes.snagged).toBeGreaterThanOrEqual(1);
    let draped = 0;
    for (const x of gore.ropes.loosePoints()) {
      let top = -Infinity;
      let low = Infinity;
      for (let i = 1; i < x.length; i += 3) {
        top = Math.max(top, x[i]!);
        low = Math.min(low, x[i]!);
      }
      // On the wall's top (0.7 m) and down to the floor beside it.
      if (top > 0.68 && low < 0.2) draped++;
    }
    expect(draped).toBeGreaterThanOrEqual(1);
  });
});

describe('organs', () => {
  type Soft = { alive: boolean; kind: string; p: THREE.Vector3; wob: number; sag: number; restedAt: number };
  const organs = (): Soft[] => (gore.chunks as unknown as { all: Soft[] }).all.filter(c => c.alive && ['lung', 'liver', 'heart', 'stomach'].includes(c.kind));
  const feet = v(50, 0, 50);
  const walk = v(0, 0, 0);
  beforeAll(() => {
    (ctx as unknown as { player: unknown }).player = { position: feet, velocity: walk, eye: v(50, 1.6, 50) };
  });
  beforeEach(() => {
    feet.set(50, 0, 50);
    walk.set(0, 0, 0);
  });
  /** One liver dropped at x from a metre and a half, and left to lie. */
  const drop = (x: number): Soft => {
    gore.chunks.spawn('liver', x, 1.5, 30, 0, 0, 0, 0.14);
    const o = organs()[0]!;
    let most = 0;
    for (let i = 0; i < 150; i++) {
      step(1);
      most = Math.max(most, Math.abs(o.wob));
    }
    // It squashed when it landed, by a share of its height and not past the most it may.
    expect(most).toBeGreaterThan(0.03);
    expect(most).toBeLessThanOrEqual(OrganTuning.most);
    return o;
  };

  it('squash when they land, spring back, and sag where they lie', () => {
    const o = drop(10);
    expect(o.restedAt).toBeGreaterThanOrEqual(0);
    expect(Math.abs(o.wob)).toBeLessThan(0.02);
    expect(o.sag).toBe(1);
    // Something landing beside it sets it quivering again.
    gore.chunks.quiver(o.p.clone().add(v(0.4, 0, 0)), 1);
    step(2);
    expect(Math.abs(o.wob)).toBeGreaterThan(0.004);
  });

  it('burst under a foot, and that is how they leave', () => {
    const o = drop(12);
    const before = gore.chunks.bursts;
    // Stood beside it, nothing.
    feet.set(o.p.x + 1.5, 0, o.p.z);
    walk.set(-4, 0, 0);
    step(2);
    expect(o.alive).toBe(true);
    // Walked onto it.
    feet.set(o.p.x + 0.05, 0, o.p.z);
    step(1);
    expect(o.alive).toBe(false);
    expect(gore.chunks.bursts).toBe(before + 1);
    // Scraps of it are left, not an organ.
    expect(gore.chunks.aliveOf('liver')).toBe(0);
    expect(gore.chunks.aliveOf('meat')).toBeGreaterThanOrEqual(3);
  });

  it('roll off when walked into', () => {
    const o = drop(14);
    const from = o.p.clone();
    feet.set(o.p.x - 0.45, 0, o.p.z + 0.25);
    walk.set(3, 0, 0);
    step(1);
    feet.set(60, 0, 60);
    step(40);
    const now = organs()[0]!;
    expect(now.alive).toBe(true);
    expect(now.p.distanceTo(from)).toBeGreaterThan(0.3);
  });

  it('burst when shot', () => {
    const o = drop(16);
    const from = o.p.clone().add(v(0, 1.4, 2));
    const dir = o.p.clone().sub(from).normalize();
    const hit = gore.raycastCorpses(from, dir, 20);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeGreaterThan(1.5);
    const before = gore.chunks.bursts;
    gore.damageCorpse(hit!, { amount: 25, type: 'bullet', point: hit!.point.clone(), dir, force: 20, source: 'smg' });
    expect(gore.chunks.bursts).toBe(before + 1);
    expect(organs().length).toBe(0);
    // A ray that misses it finds nothing.
    expect(gore.raycastCorpses(from, v(0, 1, 0), 20)).toBeNull();
  });
});

describe('a machine bursts into its own hull (the volume audit, for machines)', () => {
  /** Litres inside a closed mesh, by its signed volume. */
  const litres = (g: THREE.BufferGeometry): number => {
    const p = g.getAttribute('position').array as Float32Array;
    const idx = g.getIndex()!.array;
    let sum = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
      sum += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
    }
    return Math.abs(sum) * 1000;
  };
  const machine = (id: string, x: number): TestDummy => {
    const char = new TestDummy(id === 'drone' ? droneRig(id) : skitterRig(id));
    char.root.position.set(x, id === 'drone' ? 1.6 : 0, 30);
    scene.add(char.root);
    char.root.updateMatrixWorld(true);
    return char;
  };
  type Wreck = Half & { scrap: boolean; pooled: boolean; side: { geometry: THREE.BufferGeometry } };

  it.each(['drone', 'skitter'])('%s: its hull is thrown in pieces that add up to it, with no blood', id => {
    // The hull alone, as the wreck is cut from it: every limb that leaves on its own folded away.
    const twin = machine(id, 8);
    const sever = [...new Set(twin.rig.bones.map((b, i) => (b.severable ? i : -1)).filter(i => i > 0))];
    for (const bone of sever) twin.hideLimb(bone);
    const hull = litres(twin.bakePose(true));
    twin.release();
    expect(hull).toBeGreaterThan(0.5);

    const char = machine(id, 0);
    const at = v(0, 0, 0).setFromMatrixPosition(char.bones[0]!.matrixWorld);
    gore.gib(char, at.clone().add(v(0.3, -0.2, 0.2)), 80, { amount: 200, type: 'explosive', point: at, dir: v(0, 0.3, 1).normalize(), force: 80, source: 'rocket' });
    const pieces = halves() as Wreck[];
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(pieces.length).toBeLessThanOrEqual(4);
    for (const piece of pieces) {
      expect(piece.scrap).toBe(true);
      // Nothing pools under a machine's piece.
      expect(piece.pooled).toBe(true);
    }
    const thrown = pieces.reduce((sum, piece) => sum + litres(piece.side.geometry), 0);
    expect(thrown).toBeGreaterThan(hull * 0.85);
    expect(thrown).toBeLessThan(hull * 1.15);
    // And every limb it has: a skitter's six legs and its head, where four legs and the head went and two were deleted.
    const limbBones = new Set(char.rig.bones.map((b, i) => (b.severable && i > 0 ? i : -1)).filter(i => i > 0));
    expect(gore.stats().limbs).toBe(limbBones.size);
    // Scrap still flies with them, less of it than when scrap was all there was.
    expect(chunks().filter(c => c.kind === 'scrap').length).toBe(7);
    step(240);
    for (const piece of halves()) expect(piece.mesh.position.y).toBeLessThan(1);
  });
});
