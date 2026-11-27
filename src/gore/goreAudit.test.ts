import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BloodSurfacePool, buildWalkMesh, type WalkMesh } from '../characters/anatomy/bloodSurface';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidBone as B } from '../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo, HeadOutcome } from '../core/contracts';
import type { AiWorld } from '../enemies/aiWorld';
import type { KillFacts } from '../enemies/damage';
import type { Enemy } from '../enemies/Enemy';
import { Soldier } from '../enemies/outpost/soldier';
import { WoundSystem } from '../enemies/wounds/index';
import { Injuries } from '../enemies/wounds/injuries';
import { dripTrail } from '../enemies/wounds/trail';
import { packKill, unpackKill } from '../net/world/hitWire';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { BloodField } from './blood';
import { ChunkField, ChunkTuning } from './chunks';
import { ImpactEvents } from './impacts';
import { createGoreSystem, type Gore } from './index';
import type { SpurtField } from './spurt';
import { SurfaceBloodField, SurfaceBloodTuning } from './surfaceBlood';
import { TestDummy } from './testDummy';

function makeSimpleWalkMesh(): WalkMesh {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const cols = 4;
  const rows = 4;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const v = r / rows;
      positions.push(-0.2 + u * 0.4, 1.0 + v * 0.8, 0.12);
      uvs.push(0.1 + u * 0.8, 0.1 + v * 0.8);
      skinIndices.push(0, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      indices.push(a, b, d, b, e, d);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const model = {
    attributes: {
      position: geo.getAttribute('position'),
      normal: geo.getAttribute('normal'),
      uv: new THREE.Float32BufferAttribute(uvs, 2),
      skinIndex: new THREE.Uint16BufferAttribute(skinIndices, 4),
      skinWeight: new THREE.Float32BufferAttribute(skinWeights, 4),
    },
    lods: [geo, geo],
    meta: { rigBoneCount: 1 },
  };
  return buildWalkMesh(model as unknown as Parameters<typeof buildWalkMesh>[0])!;
}

function makeSurfaceChar(mesh: WalkMesh, pool: BloodSurfacePool): CharacterInstance {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.position.set(0, 1.4, 0);
  root.add(bone);
  scene.add(root);
  root.updateMatrixWorld(true);
  const rig = {
    name: 'test', height: 1.85,
    bones: [{ name: 'hips', parent: -1, offset: [0, 1.4, 0], region: 'abdomen' }],
  };
  return {
    archetype: 'trooper',
    rig,
    root,
    bones: [bone],
    severed: new Set(),
    a: { walkMesh: mesh, interior: new THREE.BufferGeometry(), bindPositions: [new THREE.Vector3(0, 1.4, 0)], bloodPool: pool },
    setBloodMapLayer: vi.fn(),
    isHidden: () => false,
    release: vi.fn(),
  } as unknown as CharacterInstance;
}

describe('SurfaceBloodField audit fixes', () => {
  const mesh = makeSimpleWalkMesh();

  function makeSurfaceHarness(pool: BloodSurfacePool) {
    const ctx = makeCtx({
      audio: { play: vi.fn(), playOneOf: vi.fn(), startLoop: vi.fn() } as unknown as Ctx['audio'],
      characters: { bloodPool: pool } as unknown as Ctx['characters'],
    });
    const blood = {
      drip: vi.fn(),
      droplet: vi.fn(),
      stainBelow: vi.fn(),
    } as unknown as BloodField;
    let nextId = 1;
    const spurts = {
      start: vi.fn(() => nextId++),
      stop: vi.fn(),
      setPower: vi.fn(),
      clampRemaining: vi.fn(),
    } as unknown as SpurtField;
    const field = new SurfaceBloodField(ctx, blood, spurts);
    return { ctx, field, spurts };
  }

  it('resets all emitter fields on eviction instead of merging into the evicted slot', () => {
    const pool = new BloodSurfacePool();
    const { ctx, field, spurts } = makeSurfaceHarness(pool);
    const char = makeSurfaceChar(mesh, pool);

    // Fill all emitter slots with Tier 2 / Tier 3 wounds at distinct positions & zones.
    const cap = SurfaceBloodTuning.maxEmittersPerBody;
    for (let i = 0; i < cap; i++) {
      ctx.time.tick(0.1);
      const x = -0.18 + i * 0.1;
      expect(field.bleedWound(char, {
        bone: 0,
        point: new THREE.Vector3(x, 1.5, 0.12),
        tier: i === 0 ? 2 : 3,
        zone: `z${i}`,
        duration: 30,
      })).toBe(true);
    }

    // Evict slot 0 (lowest tier = 2) with a fresh Tier 1 wound in a new zone and short duration.
    ctx.time.tick(0.1);
    const now = ctx.time.elapsed;
    expect(field.bleedWound(char, {
      bone: 0,
      point: new THREE.Vector3(0.18, 1.15, 0.12),
      tier: 1,
      zone: 'fresh_t1',
      duration: 2,
    })).toBe(true);

    // Inspect internal emitter state to verify slot 0 was reset and not kept at tier 2 / 30s ends.
    const bodies = (field as unknown as { bodies: { active: boolean; emitters: { zone: string; tier: number; ends: number; held: boolean }[] }[] }).bodies;
    const track = bodies.find(b => b.active)!;
    const evicted = track.emitters.find(e => e.zone === 'fresh_t1')!;
    expect(evicted).toBeDefined();
    expect(evicted.tier).toBe(1);
    expect(evicted.ends).toBeCloseTo(now + 2, 4);
    expect(evicted.held).toBe(false);
    expect(spurts.stop).not.toHaveBeenCalled(); // slot 0 was tier 2, no spurt
  });

  it('resets emitter fields when a track slot is recycled for a new character', () => {
    const pool = new BloodSurfacePool();
    const { ctx, field } = makeSurfaceHarness(pool);
    const c1 = makeSurfaceChar(mesh, pool);
    ctx.time.tick(0.5);
    field.bleedWound(c1, { bone: 0, point: new THREE.Vector3(0, 1.5, 0.12), tier: 3, zone: 'old_zone', duration: 99 });
    field.setClutch(c1, 0);
    field.forget(c1);

    const c2 = makeSurfaceChar(mesh, pool);
    ctx.time.tick(0.5);
    const now = ctx.time.elapsed;
    field.bleedWound(c2, { bone: 0, point: new THREE.Vector3(0, 1.5, 0.12), tier: 1, duration: 3 });

    const bodies = (field as unknown as { bodies: { active: boolean; emitters: { zone: string; tier: number; ends: number; held: boolean; soakRadius: number }[] }[] }).bodies;
    const track = bodies.find(b => b.active)!;
    const em = track.emitters[0]!;
    expect(em.zone).toBe('');
    expect(em.tier).toBe(1);
    expect(em.held).toBe(false);
    expect(em.ends).toBeCloseTo(now + 3, 4);
  });

  it('keeps dead-body pool priority at 1 on post-mortem bleedWound calls', () => {
    const pool = new BloodSurfacePool();
    const { field } = makeSurfaceHarness(pool);
    const char = makeSurfaceChar(mesh, pool);
    const spy = vi.spyOn(pool, 'setPriority');
    const acqSpy = vi.spyOn(pool, 'acquire');

    field.bleedWound(char, { bone: 0, point: new THREE.Vector3(0, 1.5, 0.12), tier: 3, zone: 'chest' });
    field.onDeath(char);
    expect(spy).toHaveBeenLastCalledWith(char, 1);

    spy.mockClear();
    acqSpy.mockClear();
    field.bleedWound(char, { bone: 0, point: new THREE.Vector3(0.08, 1.5, 0.12), tier: 3, zone: 'postmortem' });
    // Existing dead body must not be promoted back above priority 1.
    for (const call of spy.mock.calls) expect(call[1]).toBe(1);
    for (const call of acqSpy.mock.calls) expect(call[1]).toBe(1);
  });

  it('releases the BloodSurfacePool layer when a tracked character becomes hidden or detached', () => {
    const pool = new BloodSurfacePool();
    const { field } = makeSurfaceHarness(pool);
    const char = makeSurfaceChar(mesh, pool);

    field.bleedWound(char, { bone: 0, point: new THREE.Vector3(0, 1.5, 0.12), tier: 2, zone: 'ribs' });
    expect(pool.layerOf(char)).toBeGreaterThanOrEqual(0);

    char.root.visible = false;
    field.update(1 / 60);
    expect(pool.layerOf(char)).toBe(-1);
  });
});

describe('ChunkField audit fixes', () => {
  let physics: Physics;
  let scene: THREE.Scene;

  beforeAll(async () => {
    physics = await Physics.create();
    // Static floor at y = 0 in CG.World so raycastInto hits it.
    physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(60, 0.5, 60), null, 'concrete');
    physics.flushQueries();
    scene = new THREE.Scene();
  });

  it('does not clobber burst coordinates when spawn() ghosts an old chunk under maxBodies cap', () => {
    const ctx = makeCtx({
      physics,
      render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
      fx: { embers: vi.fn(), bloodMist: vi.fn(), bloodHit: vi.fn() } as unknown as Ctx['fx'],
      audio: { play: vi.fn() } as unknown as Ctx['audio'],
    });
    const blood = new BloodField(ctx);
    const chunks = new ChunkField(ctx, blood, new ImpactEvents(ctx));
    chunks.ensure();

    // Fill chunk bodies up to maxBodies at x = 20 so ghost() would overwrite _o with x ≈ 20.
    for (let i = 0; i < ChunkTuning.maxBodies; i++) {
      chunks.spawn('meat', 20, 2.0, 20, 0, 5, 0, 0.04);
    }
    // Spawn an organ at x = -5, y = 0.5, z = -5 and burst it.
    chunks.spawn('heart', -5, 0.5, -5, 0, 0, 0, 0.06);
    const spawnSpy = vi.spyOn(chunks, 'spawn');
    const ray = chunks.raycastOrgan(new THREE.Vector3(-5, 0.5, -4), new THREE.Vector3(0, 0, -1), 5);
    expect(ray).toBeGreaterThan(0);
    expect(chunks.burstHit(chunks.organHit, new THREE.Vector3(0, 0, -1))).toBe(true);

    expect(spawnSpy).toHaveBeenCalledTimes(4);
    for (const call of spawnSpy.mock.calls) {
      const [, sx, , sz] = call;
      expect(sx).toBeCloseTo(-5, 1);
      expect(sz).toBeCloseTo(-5, 1);
    }
    chunks.clear();
  });

  it('ghosts an airborne chunk at apex (near-zero velocity) so it falls to the floor instead of freezing mid-air', () => {
    const ctx = makeCtx({
      physics,
      render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
    });
    const blood = new BloodField(ctx);
    const chunks = new ChunkField(ctx, blood, new ImpactEvents(ctx));
    chunks.ensure();

    // Spawn chunk high in the air with zero velocity (apex of throw), then overflow maxBodies to force ghost().
    chunks.spawn('meat', 0, 5.0, 0, 0, 0, 0, 0.04);
    for (let i = 0; i < ChunkTuning.maxBodies; i++) {
      chunks.spawn('meat', 4, 1.0, 4, 0, 3, 0, 0.04);
    }
    const ghosts = (chunks as unknown as { ghosts: { p: THREE.Vector3 }[] }).ghosts;
    const apex = ghosts.find(g => Math.abs(g.p.x) < 0.5 && g.p.y > 4.0);
    expect(apex).toBeDefined();

    for (let i = 0; i < 120; i++) {
      ctx.time.tick(1 / 60);
      chunks.update(ctx.time.dt);
    }
    expect(apex!.p.y).toBeLessThan(0.25);
    chunks.clear();
  });
});

describe('Gore machine limbs, releaseChar, and poolBlood', () => {
  let physics: Physics;
  let scene: THREE.Scene;
  let decalsAdded: { kind: string; pos: THREE.Vector3 }[];
  let ctx: Ctx;
  let gore: Gore;

  beforeAll(async () => {
    physics = await Physics.create();
    scene = new THREE.Scene();
    decalsAdded = [];
    ctx = makeCtx({
      physics,
      render: {
        scene,
        decals: {
          add: (kind: string, pos: THREE.Vector3) => decalsAdded.push({ kind, pos: pos.clone() }),
          splat: vi.fn(),
          clear: vi.fn(),
        },
        lights: { flash: vi.fn() },
      } as unknown as Ctx['render'],
      fx: {
        attachEmitter: vi.fn(() => null),
        bloodHit: vi.fn(),
        bloodPuff: vi.fn(),
        bloodMist: vi.fn(),
        bloodSpray: vi.fn(),
        sparks: vi.fn(),
        embers: vi.fn(),
      } as unknown as Ctx['fx'],
      audio: { play: vi.fn(), playOneOf: vi.fn(), startLoop: vi.fn() } as unknown as Ctx['audio'],
    });
    gore = createGoreSystem(ctx);
    gore.init();
  });

  beforeEach(() => {
    gore.clear();
    decalsAdded.length = 0;
  });

  afterAll(() => gore.clear());

  it('spawns scrap without blood stains when bursting a machine limb and leaves no blood during updateLimb', () => {
    const titanRig = rigFor(archetypeById('titan'));
    const char = new TestDummy(titanRig);
    (char as { archetype: string }).archetype = 'titan';
    char.root.position.set(0, 2, 0);
    scene.add(char.root);
    char.root.updateMatrixWorld(true);

    const dmg: DamageInfo = {
      amount: 120, type: 'bullet', point: new THREE.Vector3(0.4, 2.5, 0),
      dir: new THREE.Vector3(0, 0, -1), force: 40, source: 'judge',
    };
    const sev = gore.sever(char, 'armL', dmg);
    expect(sev).not.toBeNull();

    const stainSpy = vi.spyOn(gore.blood, 'stainBelow');
    const dropletSpy = vi.spyOn(gore.blood, 'droplet');
    const spawnSpy = vi.spyOn(gore.chunks, 'spawn');

    // Step limb physics through motion and stops: zero blood droplets or stains for a machine limb.
    for (let i = 0; i < 30; i++) {
      ctx.time.tick(1 / 60);
      physics.step(ctx.time.dt);
      gore.update();
    }
    expect(stainSpy).not.toHaveBeenCalled();
    expect(dropletSpy).not.toHaveBeenCalled();

    // Burst the loose machine limb directly.
    const limbs = (gore as unknown as { limbs: { machine: boolean; health: number }[] }).limbs;
    expect(limbs.length).toBe(1);
    expect(limbs[0]!.machine).toBe(true);
    (gore as unknown as { burstLimb(l: unknown, d: DamageInfo): void }).burstLimb(limbs[0]!, dmg);

    expect(stainSpy).not.toHaveBeenCalled();
    expect(spawnSpy).toHaveBeenCalled();
    for (const call of spawnSpy.mock.calls) {
      expect(call[0]).toBe('scrap');
    }
  });

  it('releaseChar cleans up gore ownership and effects without calling char.release()', () => {
    const char = new TestDummy(rigFor(archetypeById('trooper')));
    char.root.position.set(0, 2, 0);
    scene.add(char.root);
    char.root.updateMatrixWorld(true);
    const releaseSpy = vi.spyOn(char, 'release');

    gore.ragdoll(char);
    expect(gore.owns(char)).toBe(true);

    gore.releaseChar(char);
    expect(gore.owns(char)).toBe(false);
    expect(gore.stats().corpses).toBe(0);
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it('poolBlood registers wet spots in BloodField and dripTrail delegates lying pools to it', () => {
    gore.poolBlood(3, 0, -4, 0.6);
    expect(gore.blood.wetAt(3, 0, -4)).toBe(true);
    expect(decalsAdded.filter(d => d.kind === 'bloodPool')).toHaveLength(1);

    // Verify dripTrail routes floored+still bloodPool through ctx.gore.poolBlood without duplicate decals.
    decalsAdded.length = 0;
    const b = new Injuries();
    b.floored = true;
    b.bleed = 0.06;
    b.dripX = 7;
    b.dripZ = -2;
    b.nextDrip = 0;
    const e = { position: new THREE.Vector3(7, 0, -2), downed: false } as unknown as Enemy;
    const w = {
      ctx: {
        gore,
        render: ctx.render,
        world: { nav: { groundHeight: () => 0 } },
      },
    } as unknown as AiWorld;
    dripTrail(e, b, w, 2);
    expect(gore.blood.wetAt(7, 0, -2)).toBe(true);
    expect(decalsAdded.filter(d => d.kind === 'bloodPool')).toHaveLength(1);
  });
});

describe('KillFacts headOutcome wire round-trip', () => {
  it('round-trips every HeadOutcome value and preserves omission', () => {
    const outcomes: (HeadOutcome | undefined)[] = [undefined, 'hole', 'partial', 'burst', 'off'];
    for (const headOutcome of outcomes) {
      const kill: KillFacts = { blast: 'head', shatter: true, heavyHead: true, wound: 123.4 };
      if (headOutcome !== undefined) kill.headOutcome = headOutcome;
      const packed = packKill(kill);
      const unpacked = unpackKill(packed);
      expect(unpacked).toEqual(kill);
    }
  });
});

describe('Injuries.worst and WoundSystem.rearm audit fixes', () => {
  it('skips arm/hand/shoulder wounds on the clutching hand or whose opposite arm is disabled', () => {
    const b = new Injuries();
    const add = (zone: 'arm' | 'lung' | 'innerThigh', side: 1 | -1 | 0, bleed: number) => {
      const w = b.wounds[b.count++]!;
      w.zone = zone;
      w.side = side;
      w.bone = B.chest;
      w.bleed = bleed;
      w.dressed = false;
    };

    // Left arm wound (side = +1) is heaviest, lung wound is second.
    add('arm', 1, 0.08);
    add('lung', 0, 0.04);

    // When clutching with left hand (side = +1), left arm wound is skipped in favour of lung.
    expect(b.worst(1)?.zone).toBe('lung');
    // When clutching with right hand (side = -1), right hand CAN reach left arm wound.
    expect(b.worst(-1)?.zone).toBe('arm');

    // If right arm is disabled, nobody can reach the left arm wound even without explicit clutchHand.
    b.armR = true;
    expect(b.worst()?.zone).toBe('lung');
  });

  it('prevents an armless soldier from drawing a sidearm on rearm and breaks nerve instead', () => {
    const breakNerve = vi.fn();
    const o = { breakNerve, setDowned: vi.fn(), soldiers: [] };
    const ctx = makeCtx();
    const w = { now: 10, ctx } as unknown as AiWorld;
    const manager = { model: { updateMaim: vi.fn(), standUp: vi.fn() } };
    const ws = new WoundSystem(w, o as never, manager as never);
    const drawSpy = vi.spyOn(ws, 'drawSidearm');

    const s = new Soldier();
    s.e = {
      char: { anim: { setPose: vi.fn() }, severed: new Set() },
      health: 50, maxHealth: 100, speedMul: 1, bleed: 0, downed: false,
    } as unknown as Enemy;
    s.weapon = 'none';
    s.spentSidearm = false;
    s.def = { ...s.def, sidearm: true };
    s.injuries.armL = true;
    s.injuries.armR = true;
    expect(s.injuries.armless).toBe(true);

    (ws as unknown as { rearm(s: Soldier, b: Injuries): void }).rearm(s, s.injuries);
    expect(drawSpy).not.toHaveBeenCalled();
    expect(breakNerve).toHaveBeenCalledWith(s);
  });
});
