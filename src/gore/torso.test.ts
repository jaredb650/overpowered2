import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig, HumanoidBone as B } from '../characters/rig';
import type { Ctx, DamageInfo, ExplosionKind } from '../core/contracts';
import { BLAST } from '../enemies/blast';
import { EXPLOSIONS, TUNING } from '../weapons/data';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { ChunkTuning } from './chunks';
import { createGoreSystem, type Gore } from './index';
import { ORGANS, RIB_KINDS } from './organs';
import { RopeTuning } from './rope';
import { SliceTuning } from './sliced';
import { heartbeat, SpurtTuning } from './spurt';
import { TestDummy } from './testDummy';
import { blowsOut, GUT_RANGE, kitPieces, planGib, spillsGuts, TorsoTuning } from './torso';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const blast = (point: THREE.Vector3, force = 900): DamageInfo => ({ amount: 300, type: 'explosive', point, dir: v(0, 0, -1), force, source: 'rocket' });

describe('choosing how a trunk breaks', () => {
  it('is the same choice from the same kill, and a guest told the host\'s mode makes every other choice the same', () => {
    for (let i = 0; i < 40; i++) {
      const d = blast(v(i * 0.37, 1.2, -i * 0.11), 300 + i * 40);
      const host = planGib(d, d.force);
      expect(planGib(d, d.force)).toEqual(host);
      // The host writes its mode on the damage; the wire carries the point and source exactly.
      const wire = { ...d, point: d.point.clone(), torso: host.mode };
      expect(planGib(wire, wire.force)).toEqual(host);
    }
  });
  it('cracks a trunk into 3 to 6 pieces, tears one in five at the waist, and stays inside its organ budget', () => {
    const modes = new Set<string>();
    let waists = 0;
    for (let i = 0; i < 200; i++) {
      const force = 20 + i * 12;
      const plan = planGib(blast(v(i, 1, 0), force), force);
      modes.add(plan.mode);
      if (plan.mode === 'crack') {
        expect(plan.pieces).toBeGreaterThanOrEqual(3);
        expect(plan.pieces).toBeLessThanOrEqual(6);
        expect(plan.ribs).toEqual(RIB_KINDS);
        // A big blast is five or six pieces, a small one three, and the biggest always six.
        if (force > TorsoTuning.six) expect(plan.pieces).toBe(6);
        else if (force >= TorsoTuning.bigFrom) expect(plan.pieces).toBeGreaterThanOrEqual(5);
        else expect(plan.pieces).toBe(3);
      } else {
        waists++;
        expect(plan.pieces).toBe(2);
      }
      expect(plan.organs.length).toBeGreaterThan(0);
      expect(plan.organs.length).toBeLessThanOrEqual(4);
      for (const o of plan.organs) expect(ORGANS).toContain(o);
    }
    expect(modes).toEqual(new Set(['crack', 'waist']));
    expect(waists / 200).toBeGreaterThan(TorsoTuning.waistShare - 0.1);
    expect(waists / 200).toBeLessThan(TorsoTuning.waistShare + 0.1);
    // Past the frame's full gibs: still pieces, fewer of everything else.
    const lite = planGib({ ...blast(v(0, 1, 0), 2000), torso: 'crack' }, 2000, false);
    expect(lite).toMatchObject({ mode: 'crack', pieces: 3, ribs: [] });
    expect(lite.organs.length).toBeLessThanOrEqual(2);
  });
  it('cracks for every blast in the game that can burst a body: none has to reach a force no weapon has', () => {
    // What `Combat.blastEnemies` puts on the damage: blastForce x impulse x radius x falloff, and the fireball that
    // bursts is the inner ring (src/enemies/blast.ts), where the falloff is still 0.85 or more.
    const blasts: readonly (readonly [ExplosionKind, number])[] = [
      ['rocket', TUNING.rocket.radius], ['grenade', TUNING.grenade.radius], ['grenade', TUNING.launcher.radius],
      ['barrel', 4.5], ['barrel', 7], ['shell', 5], ['enemy', 5], ['hellfire', 9], ['plasma', 5],
    ];
    for (const [kind, radius] of blasts) {
      const [fireball] = BLAST.rings[kind];
      for (const reach of [0, fireball]) {
        const falloff = 1 - reach * (1 - EXPLOSIONS[kind].edgeDamage);
        const force = TUNING.blastForce * EXPLOSIONS[kind].impulse * radius * falloff;
        let cracks = 0;
        let big = 0;
        const N = 100;
        for (let i = 0; i < N; i++) {
          const plan = planGib({ ...blast(v(i * 0.31, 1.1, i * 0.17), force), source: kind }, force);
          if (plan.mode !== 'crack') continue;
          cracks++;
          expect(plan.ribs).toEqual(RIB_KINDS);
          expect(plan.organs.length).toBe(4);
          if (plan.pieces >= 5) big++;
        }
        // Four in five crack, whatever the blast.
        expect(cracks, `${kind} at ${reach}`).toBeGreaterThan(N * 0.65);
        // And the weapons a player thinks of as big are five or six pieces every time they do.
        if (kind === 'rocket' || kind === 'hellfire' || (kind === 'grenade' && radius === TUNING.grenade.radius)) expect(big, `${kind} at ${reach}`).toBe(cracks);
      }
    }
    // A round that obliterates (the Trommel's) and a frozen body shattering are not blasts: three pieces, with the ribs.
    const round: DamageInfo = { amount: 300, type: 'bullet', point: v(1, 1.2, 3), dir: v(0, 0, -1), force: 60, source: 'buzzsaw', gib: true };
    const plan = planGib({ ...round, torso: 'crack' }, round.force);
    expect(plan).toMatchObject({ mode: 'crack', pieces: 3 });
    expect(plan.ribs).toEqual(RIB_KINDS);
  });
  it('makes the same plan from a force that crossed the wire in tenths', () => {
    for (let i = 0; i < 400; i++) {
      const force = 59.5 + i * 0.0025;
      const d = blast(v(i * 0.13, 1, 2), force);
      const host = planGib(d, force);
      const sent = Math.round(force * 10) / 10;
      expect(planGib({ ...d, torso: host.mode }, sent)).toEqual(host);
    }
  });
  it('blows a trunk out for the big single rounds and a shotgun at point blank, and nothing else', () => {
    const hit = (source: string, type: DamageInfo['type'], region: DamageInfo['region']) => ({ source, type, region });
    for (const s of ['sabot', 'awl', 'ultramag']) expect(blowsOut(hit(s, 'bullet', 'chest'), 30)).toBe(true);
    expect(blowsOut(hit('shotgun', 'pellet', 'abdomen'), 2)).toBe(true);
    expect(blowsOut(hit('shotgun', 'pellet', 'abdomen'), 9)).toBe(false);
    expect(blowsOut(hit('sabot', 'bullet', 'head'), 5)).toBe(false);
    expect(blowsOut(hit('smg', 'bullet', 'chest'), 1)).toBe(false);
    expect(blowsOut({ ...hit('smg', 'bullet', 'chest'), torso: 'blowout' }, 50)).toBe(true);
  });
  it('spills guts only from an opened belly', () => {
    const pellet = { type: 'pellet' as const, source: 'shotgun' };
    expect(spillsGuts(pellet, true, 0.2, 2)).toBe(true);
    expect(spillsGuts(pellet, true, 0.2, GUT_RANGE + 1)).toBe(false);
    expect(spillsGuts(pellet, false, 0.2, 2)).toBe(false);
    expect(spillsGuts({ type: 'bullet', source: 'smg' }, true, 0.9, 1)).toBe(false);
    expect(spillsGuts({ type: 'bullet', source: 'sabot' }, true, 0.5, 30)).toBe(true);
    expect(spillsGuts({ type: 'explosive', source: 'rocket' }, true, 0.3, 30)).toBe(false);
    expect(spillsGuts({ type: 'explosive', source: 'rocket' }, true, 0.6, 30)).toBe(true);
    // A guest replays the host's word for it, wherever it stands.
    expect(spillsGuts({ type: 'pellet', source: 'shotgun', spill: true }, false, 0, 99)).toBe(true);
  });
});

describe('the spurt\'s beat', () => {
  it('pushes hardest at the top of each beat', () => {
    expect(heartbeat(0)).toBeGreaterThan(heartbeat(0.6));
    expect(heartbeat(0.32)).toBeGreaterThan(heartbeat(0.25));
  });
});

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
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

beforeAll(async () => {
  physics = await Physics.create();
  physics.addStaticBox(v(0, -0.5, 0), v(40, 0.5, 40), null, 'concrete');
  physics.flushQueries();
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
});

beforeEach(() => gore.clear());
afterAll(() => gore.clear());

describe('a gib on real Rapier', () => {
  it('leaves the trunk\'s pieces where the trunk was, never nothing', () => {
    const char = spawn();
    const chest = v(0, 0, 0).setFromMatrixPosition(char.bones[B.chest]!.matrixWorld);
    const d = blast(chest.clone().add(v(0, 0, 0.9)));
    gore.gib(char, chest.clone().add(v(0, -0.3, 0.9)), 900, d);
    expect(d.torso === 'crack' || d.torso === 'waist').toBe(true);
    const plan = planGib(d, 900);
    const kit = gore.kitFor(char);
    const pieces = kitPieces(kit, plan);
    expect(pieces.length).toBe(plan.pieces);
    expect(gore.stats().halves).toBe(pieces.length);
    // On the frame of the gib every piece is in the scene, inside the trunk it came from.
    const meshes = scene.children.filter(o => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry === pieces[0]!.side.geometry);
    expect(meshes.length).toBe(1);
    const all = pieces.map(p => scene.children.find(o => (o as THREE.Mesh).geometry === p.side.geometry)!);
    for (const m of all) {
      expect(m.parent).toBe(scene);
      expect(m.position.distanceTo(chest)).toBeLessThan(0.75);
    }
    // And the organs, the ribcage and the guts are out.
    expect(gore.chunks.aliveOf(plan.organs[0]!)).toBeGreaterThan(0);
    if (plan.mode === 'crack') for (const k of RIB_KINDS) expect(gore.chunks.aliveOf(k)).toBe(1);
    expect(gore.stats().guts).toBeGreaterThan(0);
    step(30);
    expect(gore.stats().halves).toBe(pieces.length);
  });

  it('keeps a crowd blown up in one frame inside every cap', () => {
    const chars = Array.from({ length: 14 }, (_, i) => spawn((i % 7) * 1.2 - 4, Math.floor(i / 7) * 1.5));
    for (const c of chars) {
      const at = v(0, 0, 0).setFromMatrixPosition(c.bones[B.hips]!.matrixWorld);
      gore.gib(c, at.clone().add(v(0, 0, 0.8)), 1600, blast(at, 1600));
    }
    const s = gore.stats();
    expect(s.chunkBodies).toBeLessThanOrEqual(ChunkTuning.maxBodies);
    expect(s.guts).toBeLessThanOrEqual(RopeTuning.max);
    // Past the hard cap the oldest sink at once; past the soft cap only once they have been seen a while.
    step(Math.ceil(SliceTuning.sinkSeconds * 60) + 2);
    expect(gore.stats().halves).toBeLessThanOrEqual(SliceTuning.hardCap);
    step(Math.ceil((SliceTuning.minShown + SliceTuning.sinkSeconds) * 60) + 40);
    expect(gore.stats().halves).toBeLessThanOrEqual(SliceTuning.maxHalves);
    for (const k of [...ORGANS, ...RIB_KINDS]) expect(gore.chunks.aliveOf(k)).toBeLessThanOrEqual(ChunkTuning.capacity[k]);
  });

  it('starts nothing under the floor, even out of a body lying on it, and nothing falls through', () => {
    const char = spawn(0, 0);
    // Lying face down: the trunk's bones a hand above the floor.
    char.root.rotation.x = Math.PI / 2;
    char.root.position.set(0, 0.12, 0);
    char.root.updateMatrixWorld(true);
    const hips = v(0, 0, 0).setFromMatrixPosition(char.bones[B.hips]!.matrixWorld);
    gore.gib(char, hips.clone().add(v(0, -0.3, 0)), 1600, blast(hips.clone(), 1600));
    step(240);
    const chunks = (gore.chunks as unknown as { all: { alive: boolean; p: THREE.Vector3 }[] }).all.filter(c => c.alive);
    expect(chunks.length).toBeGreaterThan(10);
    for (const c of chunks) expect(c.p.y).toBeGreaterThan(-0.02);
    const halves = (gore.sliced as unknown as { halves: { mesh: THREE.Mesh; sinking: number }[] }).halves;
    expect(halves.length).toBeGreaterThan(0);
    for (const h of halves) {
      expect(h.sinking).toBe(-1);
      expect(h.mesh.position.y).toBeGreaterThan(-0.02);
    }
  });
});

describe('guts hanging out', () => {
  const eye = v(0, 1.6, 2.5);
  beforeAll(() => {
    (ctx as unknown as { player: unknown }).player = { eye, position: v(0, 0, 2.5), isVector3: false };
  });
  const shot = (char: TestDummy, bone: number, type: DamageInfo['type'], source: string, from: THREE.Vector3): DamageInfo => {
    const at = v(0, 0, 0).setFromMatrixPosition(char.bones[bone]!.matrixWorld).add(v(0, 0.05, 0.12));
    return { amount: 30, type, point: at, dir: at.clone().sub(from).normalize(), force: 0, source, bone, region: bone === B.chest ? 'chest' : 'abdomen' };
  };

  it('hang only from a belly a shotgun opened from close', () => {
    const near = spawn(0, 0);
    gore.wound(near, shot(near, B.chest, 'pellet', 'shotgun', eye), 0.2);
    expect(gore.ropes.hangingFrom(near.root)).toBe(0);
    gore.wound(near, shot(near, B.spine, 'bullet', 'smg', eye), 0.2);
    expect(gore.ropes.hangingFrom(near.root)).toBe(0);
    const d = shot(near, B.spine, 'pellet', 'shotgun', eye);
    gore.wound(near, d, 0.2);
    expect(gore.ropes.hangingFrom(near.root)).toBe(1);
    expect(d.spill).toBe(true);
    // One a body, however many pellets follow.
    gore.wound(near, shot(near, B.spine, 'pellet', 'shotgun', eye), 0.2);
    expect(gore.ropes.hangingFrom(near.root)).toBe(1);

    const far = spawn(0, -12);
    gore.wound(far, shot(far, B.spine, 'pellet', 'shotgun', eye), 0.2);
    expect(gore.ropes.hangingFrom(far.root)).toBe(0);
  });

  it('follows a top half cut at the waist as it crawls, its far end dragging on the floor', () => {
    const char = spawn(0, 0);
    const cut = shot(char, B.spine, 'slash', 'sword', eye);
    const result = gore.sever(char, 'abdomen', { ...cut, force: 60 });
    expect(result?.torso).toBeDefined();
    gore.ragdoll(char);
    const p = v(0, 0, 0);
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      step(1);
      if (i < 30) continue;
      // The strand's held end stays on the crawler's cut.
      const crawler = result!.torso!.position;
      const end = gore.ropes.pointOf(findPiece(char), 0, p);
      if (end) worst = Math.max(worst, end.distanceTo(crawler));
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.6);
    const tail = gore.ropes.pointOf(findPiece(char), RopeTuning.points - 1, p)!;
    expect(tail.y).toBeLessThan(0.15);
  });

  /** The top half's root: the severed part in the scene that a strand hangs from, not the legs it left. */
  function findPiece(legs: TestDummy): THREE.Object3D {
    return scene.children.find(o => o !== legs.root && gore.ropes.hangingFrom(o) > 0)!;
  }
});

describe('a spurt', () => {
  it('pumps from a stump, weakens, and stops after its time', () => {
    const char = spawn(0, 0);
    const at = v(0, 0, 0).setFromMatrixPosition(char.bones[B.upperArmL]!.matrixWorld);
    gore.sever(char, 'armL', { amount: 60, type: 'pellet', point: at, dir: v(1, 0, 0), force: 0, source: 'shotgun', bone: B.upperArmL });
    expect(gore.spurts.pumping).toBe(1);
    step(60);
    expect(gore.spurts.pumping).toBe(1);
    // Where it lands, it stains.
    expect(gore.spurts.stains).toBeGreaterThan(0);
    // Its time is three quarters of the stump's, then its last globs land.
    step(Math.ceil(4.5 * 1.0 * 0.75 * 60) + Math.ceil(SpurtTuning.life * 60) + 10);
    expect(gore.spurts.pumping).toBe(0);
    expect(gore.spurts.live).toBe(0);
  });
});
