/**
 * Nothing the gore leaves in the world moves the player. One fixed input script (a run, a dash, a slide, a double jump, a
 * wall run, a jump off the wall, a slide off a landing, bunny hops) is played on a floor with nothing on it; then on the
 * same floor with one kind of gore at a time put in the player's way, thrown at him or heaped where he runs, by the real
 * gore system on the same Rapier world. The player's position and velocity must be the same to the last bit on every
 * frame, while he still shoves what he walks into.
 *
 * What made the difference before (`collide.ts`): Rapier gives the nearest hit of a cast, and between two equally near
 * it gives whichever its search tree meets first; every body in the world is in that tree, so a piece far off could
 * change which face the player was pushed off. Bodies that are hit by the player's casts never were: the gore is not in
 * his collision groups.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HumanoidBone as B, humanoidRig } from '../characters/rig';
import { CG, type Action, type Ctx, type DamageInfo, type InputSystem } from '../core/contracts';
import { EventBus } from '../core/events';
import { GameTime } from '../core/time';
import { noop } from '../core/stubs';
import type { CorpseSnapshot, FarBuffers } from '../gore/far';
import { createGoreSystem, type Gore } from '../gore/index';
import { MessTuning } from '../gore/mess';
import { TestDummy } from '../gore/testDummy';
import { Physics } from '../physics/Physics';
import { CameraRigSystem } from './CameraRig';
import { Player } from './Player';
import { HeadlessInput } from './testkit/headless';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const FPS = 60;
/** Frames of gore alone before the player's script starts, so heaps settle and organs come to rest. */
const PRE = 420;
const FRAMES = 620;

/** A dummy the far batch can take: it bakes to one triangle at its hips, and stands up again from its pose. */
class BakeDummy extends TestDummy {
  readonly farMaterial = new THREE.MeshBasicMaterial();
  bakeFar(out: FarBuffers, vertex: number, index: number): { verts: number; indices: number } {
    const at = new THREE.Vector3().setFromMatrixPosition(this.bones[0]!.matrixWorld);
    for (let k = 0; k < 3; k++) out.position.set([at.x + k * 0.1, at.y, at.z + (k === 1 ? 0.1 : 0)], (vertex + k) * 3);
    out.index.set([vertex, vertex + 1, vertex + 2], index);
    return { verts: 3, indices: 3 };
  }
  snapshot(): CorpseSnapshot {
    const pose = new Float32Array(this.bones.length * 7);
    this.bones.forEach((b, i) => pose.set([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 7));
    const r = this.root;
    return {
      archetype: 'bake', root: Float32Array.of(r.position.x, r.position.y, r.position.z, r.quaternion.x, r.quaternion.y, r.quaternion.z, r.quaternion.w),
      pose, cut: [], surface: new Float32Array(0), wounds: { count: 0, open: 0, limits: new Float32Array(0) }, worn: {}, stress: new Float32Array(0), gear: [], standIns: [],
    };
  }
  restore(snap: CorpseSnapshot): void {
    this.root.position.fromArray(snap.root, 0);
    this.root.quaternion.fromArray(snap.root, 3);
    this.bones.forEach((b, i) => {
      b.position.fromArray(snap.pose, i * 7);
      b.quaternion.fromArray(snap.pose, i * 7 + 3);
    });
    this.root.updateMatrixWorld(true);
  }
}

interface Stage {
  ctx: Ctx;
  physics: Physics;
  gore: Gore;
  player: Player;
  input: HeadlessInput;
  scene: THREE.Scene;
  /** The frame of the script, from 0; negative in the gore's head start. */
  f: number;
  spawn(at: THREE.Vector3, yaw?: number, bake?: boolean): TestDummy;
}

interface Run {
  /** Feet, velocity and the interpolated position, nine numbers a frame. */
  track: Float64Array;
  states: Set<string>;
  /** Closest any gore collider came to the player's capsule axis, metres. */
  nearest: number;
  /** Gore colliders that came within reach of the capsule on some frame. */
  touched: number;
  /** The most of each the gore had at once over the script, and the rest field's counts at the end. */
  most: { chunkBodies: number; ragdolls: number; liveLimbs: number; halves: number; guts: number; far: number; resting: number };
  mess: ReturnType<Gore['mess']['stats']>;
}

/** The script: which keys are down on frame `f`, and how far the view turns. */
function inputs(f: number, input: HeadlessInput, player: Player): void {
  const set = (a: Action, down: boolean) => input.simulate(a, down);
  const tap = (a: Action, at: number) => set(a, f === at);
  set('forward', f >= 5 && f < 600);
  tap('dash', 30);
  set('slide', f >= 60 && f < 100);
  tap('jump', 110);
  tap('jump', 135);
  // Toward the wall on the right, a jump into it, along it, and off.
  const turn = (yaw: number) => {
    const s = player.sensitivity * player.lookScale;
    input.simulateLook(-yaw / s, 0);
  };
  if (f === 182) turn(-0.32);
  tap('jump', 186);
  if (f === 240) turn(0.32);
  tap('jump', 300);
  set('left', f >= 300 && f < 320);
  set('slide', f >= 330 && f < 380);
  tap('dash', 400);
  for (const at of [430, 470, 505, 540, 575]) tap('jump', at);
}

async function stage(layout: ((s: Stage) => void) | null): Promise<Run> {
  const physics = await Physics.create();
  physics.addStaticBox(v(0, -0.5, -100), v(40, 0.5, 140), null, 'concrete');
  // The wall to run along, to the right of the lane.
  physics.addStaticBox(v(2.4, 4, -60), v(0.25, 4, 50), null, 'concrete');
  physics.flushQueries();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.05, 2000);
  const input = new HeadlessInput();
  const ctx = {
    time: new GameTime(),
    events: new EventBus(),
    input: input as unknown as InputSystem,
    physics,
    render: {
      scene, camera, viewCamera: new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 10), post: noop('post'), lights: noop('lights'),
      decals: { add() {}, splat() {}, clear() {} },
    },
    world: noop('world'),
    characters: { spawn: () => new BakeDummy(humanoidRig('test')) },
    fx: noop('fx'),
    audio: new Proxy(noop<Record<string, unknown>>('audio'), { get: (t, k) => (k === 'startLoop' ? () => noop('loop') : t[k as string]) }),
  } as unknown as Ctx;
  const player = new Player(ctx);
  ctx.player = player;
  const cam = new CameraRigSystem(ctx);
  ctx.camera = cam;
  const gore = createGoreSystem(ctx);
  ctx.gore = gore;
  player.init();
  cam.init();
  gore.init();
  player.teleport(v(0, 0.05, 0), 0);
  const s: Stage = {
    ctx, physics, gore, player, input, scene, f: -PRE,
    spawn(at, yaw = 0, bake = false) {
      const c = bake ? new BakeDummy(humanoidRig('test')) : new TestDummy(humanoidRig('test'));
      c.root.position.copy(at);
      c.root.rotation.y = yaw;
      scene.add(c.root);
      c.root.updateMatrixWorld(true);
      return c;
    },
  };
  const states = new Set<string>();
  const track = new Float64Array(FRAMES * 9);
  let nearest = Infinity;
  const most = { chunkBodies: 0, ragdolls: 0, liveLimbs: 0, halves: 0, guts: 0, far: 0, resting: 0 };
  const near = new Set<number>();
  const pos = (player as unknown as { pos: THREE.Vector3 }).pos;
  const vel = (player as unknown as { v: THREE.Vector3 }).v;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3(), on = new THREE.Vector3(), line = new THREE.Line3(a, b);
  for (let f = -PRE; f < FRAMES; f++) {
    s.f = f;
    layout?.(s);
    ctx.time.tick(1 / FPS);
    if (f >= 0) {
      inputs(f, input, player);
      player.update();
      cam.update();
    }
    physics.step(ctx.time.dt);
    gore.update();
    input.endFrame();
    if (f < 0) continue;
    track.set([pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, player.position.x, player.position.y, player.position.z], f * 9);
    states.add(player.state);
    const g = gore.stats();
    for (const k of ['chunkBodies', 'ragdolls', 'liveLimbs', 'halves', 'guts', 'far'] as const) most[k] = Math.max(most[k], g[k]);
    most.resting = Math.max(most.resting, gore.mess.stats().resting);
    // How close the gore came: every collider in its groups against the capsule's axis.
    a.set(pos.x, pos.y + 0.45, pos.z);
    b.set(pos.x, pos.y + (player as unknown as { height: number }).height - 0.45, pos.z);
    physics.world.forEachCollider(col => {
      const m = col.collisionGroups() >>> 16;
      if (!(m & (CG.Ragdoll | CG.Gib | CG.Debris))) return;
      const t = col.translation();
      line.closestPointToPoint(q.set(t.x, t.y, t.z), true, on);
      const d = on.distanceTo(q);
      if (d < nearest) nearest = d;
      if (d < 0.75) near.add(col.handle);
    });
  }
  return { track, states, nearest, touched: near.size, most, mess: gore.mess.stats() };
}

let reference: Run | null = null;
const empty = async (): Promise<Run> => (reference ??= await stage(null));

/** The first frame on which the two tracks part, or -1. Bit for bit: Object.is on every number. */
function parted(a: Float64Array, b: Float64Array): number {
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return Math.floor(i / 9);
  return -1;
}

/** Where the empty run's player is on script frame `f`, plus an offset. */
const at = (f: number, dx = 0, dy = 0, dz = 0): THREE.Vector3 => {
  const t = reference!.track;
  return v(t[f * 9]! + dx, t[f * 9 + 1]! + dy, t[f * 9 + 2]! + dz);
};

const rocket = (c: TestDummy, from: THREE.Vector3): { d: DamageInfo; force: number; centre: THREE.Vector3 } => {
  const chest = v(0, 0, 0).setFromMatrixPosition(c.bones[B.spine]!.matrixWorld);
  const centre = from.clone().setY(0.3);
  const dir = chest.clone().sub(centre);
  dir.y += 0.6;
  return { d: { amount: 9999, type: 'explosive', point: chest, dir: dir.normalize(), force: 900, source: 'rocket', blastKind: 'rocket', gib: true, torso: 'crack' } as DamageInfo, force: 900, centre };
};
const slash = (point: THREE.Vector3, dir: THREE.Vector3): DamageInfo => ({ amount: 200, type: 'slash', point, dir, force: 60, source: 'sword', severMult: 4 } as DamageInfo);

/** At script frame `f`, a man 2 m ahead of where the player will be `lead` frames later, blown up towards him. */
function blastAhead(s: Stage, f: number, lead = 20): void {
  if (s.f !== f) return;
  const target = at(Math.min(FRAMES - 1, f + lead));
  const c = s.spawn(target.clone().add(v(0.4, 0, -1.2)), Math.PI);
  const { d, force, centre } = rocket(c, target.clone().add(v(0.4, 0, -2.6)));
  s.gore.gib(c, centre, force, d);
}

type Check = (r: Run) => void;
const CHECKS: Record<string, Check> = {
  'flying pieces, slabs, ribs and organs out of a blast': r => expect(r.most.chunkBodies).toBeGreaterThan(30),
  'pieces and organs lying on the floor': r => expect(r.most.chunkBodies).toBeGreaterThan(0),
  'severed limbs': r => expect(r.most.liveLimbs).toBeGreaterThan(0),
  'trunk halves': r => expect(r.most.halves).toBeGreaterThan(0),
  'gut ropes': r => expect(r.most.guts).toBeGreaterThan(0),
  // He ploughs through the heap: the dead he walks into are woken and shoved.
  'resting corpses and a forty-body heap': r => { expect(r.most.resting).toBeGreaterThanOrEqual(40); expect(r.mess.pushWakes).toBeGreaterThan(0); },
  'falling and waking corpses': r => expect(r.most.ragdolls).toBeGreaterThan(2),
  'baked corpses': r => { expect(r.mess.baked).toBeGreaterThan(0); expect(r.most.far).toBeGreaterThan(0); },
};

const LAYOUTS: Record<string, (s: Stage) => void> = {
  /** Pieces, slabs, ribs, organs and limb parts of a rocket kill, thrown up and out through the player as he runs, dashes and hops. */
  'flying pieces, slabs, ribs and organs out of a blast'(s) {
    for (const f of [20, 50, 120, 220, 330, 420, 480, 540]) blastAhead(s, f);
  },
  /** The same blasts long before: everything lying where he runs, organs to roll and burst underfoot. */
  'pieces and organs lying on the floor'(s) {
    if (s.f !== -PRE) return;
    for (const f of [30, 70, 150, 260, 360, 460]) {
      const c = s.spawn(at(f, 0.2, 0, 0.3), 0.4);
      const { d, force, centre } = rocket(c, at(f, 0.6, 0, 1));
      s.gore.gib(c, centre, force * 0.25, d);
    }
  },
  /** Arms and legs cut off men standing in the lane, falling on and around him. */
  'severed limbs'(s) {
    for (const [f, region] of [[15, 'armL'], [45, 'legR'], [100, 'armR'], [200, 'legL'], [420, 'armL'], [500, 'legL']] as const) {
      if (s.f !== f) continue;
      const c = s.spawn(at(f + 12, 0.3, 0, -0.6), Math.PI);
      const p = v(0, 0, 0).setFromMatrixPosition(c.bones[region.startsWith('arm') ? (region === 'armL' ? B.upperArmL : B.upperArmR) : (region === 'legL' ? B.thighL : B.thighR)]!.matrixWorld);
      s.gore.sever(c, region, slash(p, v(0, 0, 1)), v(0, 1.5, 3));
    }
  },
  /** Men cut in two at the waist in front of him: the halves drop where he goes. */
  'trunk halves'(s) {
    for (const f of [10, 40, 115, 210, 410, 470]) {
      if (s.f !== f) continue;
      const c = s.spawn(at(f + 15, 0, 0, -0.5), Math.PI);
      s.gore.slice(c, v(0, 0, 0).setFromMatrixPosition(c.bones[B.spine]!.matrixWorld), v(0.1, 1, 0.05).normalize(), slash(at(f + 15, 0, 1.1, -0.5), v(1, 0, 0)));
    }
  },
  /** Guts on ropes: thrown free out of a blast kill, and hanging out of men cut at the belly, in his lane. */
  'gut ropes'(s) {
    for (const f of [-200, 25, 105, 230, 450]) {
      if (s.f !== f) continue;
      const c = s.spawn(f < 0 ? at(60, 0.3, 0, 0) : at(f + 12, 0.3, 0, -0.5), Math.PI);
      const { d, force, centre } = rocket(c, f < 0 ? at(60, 0.8, 0, 0.6) : at(f + 12, 0.6, 0, -1.6));
      s.gore.gib(c, centre, force * 0.4, d);
      const cut = s.spawn(f < 0 ? at(80, -0.3, 0, 0) : at(f + 18, -0.3, 0, -0.5), Math.PI);
      const belly = v(0, 0, 0).setFromMatrixPosition(cut.bones[B.spine]!.matrixWorld);
      s.gore.sever(cut, 'abdomen', slash(belly, v(1, 0, 0)));
    }
  },
  /** A heap of forty dead on the slide and two rows across the lane, at rest on their capsules; he ploughs through. */
  'resting corpses and a forty-body heap'(s) {
    if (s.f === -PRE) {
      MessTuning.rest = true;
      MessTuning.heaps = true;
      MessTuning.push = true;
    }
    if (s.f < -PRE + 200 && s.f % 5 === 0) {
      const i = (s.f + PRE) / 5;
      const spot = i < 40 ? at(70) : at(i < 52 ? 250 : 460, ((i % 6) - 2.5) * 0.7, 0, 0);
      const c = s.spawn(spot.clone().add(v(((i * 7) % 5 - 2) * 0.15, 0.4 + (i < 40 ? i * 0.08 : 0), ((i * 3) % 5 - 2) * 0.15)), i * 1.3);
      s.gore.ragdoll(c, { velocity: v(0, -1, 0) });
    }
  },
  /** Bodies dropped on him as he passes, and ones falling as he lands: corpses waking under and around him. */
  'falling and waking corpses'(s) {
    for (const f of [20, 60, 140, 240, 340, 440, 520]) {
      if (s.f !== f) continue;
      for (let k = 0; k < 3; k++) {
        const c = s.spawn(at(f + 10, (k - 1) * 0.5, 0.8 + k * 0.4, -0.3), k);
        s.gore.ragdoll(c, { velocity: v(0, -2, 3) });
      }
    }
  },
  /** Far past the number drawn, the oldest dead are baked into the batch, and stood up again when shot or walked into. */
  'baked corpses'(s) {
    if (s.f === -PRE) {
      MessTuning.far = true;
      MessTuning.bakeAfter = 0;
    }
    if (s.f < -PRE + 300 && s.f % 6 === 0) {
      const i = (s.f + PRE) / 6;
      const c = s.spawn(at([70, 160, 250, 360, 460][i % 5]!, ((i % 4) - 1.5) * 0.8, 0.3, Math.floor(i / 20) * 0.6), i, true);
      s.gore.ragdoll(c, { velocity: v(0, -1, 0) });
    }
  },
};

describe('the gore is one-way: the player moves it, it never moves the player', () => {
  it('the script walks every move: run, dash, slide, air, wall run, and hops', async () => {
    const run = await empty();
    if (process.env.DUMP) {
      const lines: string[] = [];
      for (let f = 0; f < FRAMES; f += 10) lines.push(`${f} ${Array.from(run.track.slice(f * 9, f * 9 + 6)).map(x => x.toFixed(2)).join(' ')}`);
      (await import('node:fs')).writeFileSync(process.env.DUMP, lines.join('\n') + '\n' + [...run.states].join(','));
    }
    for (const st of ['ground', 'dash', 'slide', 'air', 'wallrun']) expect(run.states.has(st), st).toBe(true);
  }, 120000);

  for (const [name, layout] of Object.entries(LAYOUTS)) {
    it(`${name}: the player's track is the same to the bit as on an empty floor`, async () => {
      const ref = await empty();
      const saved = { ...MessTuning };
      try {
        const run = await stage(layout);
        // The gore was where he was: within a hand of the capsule's axis, and many pieces of it.
        expect(run.nearest, 'closest gore to the capsule axis').toBeLessThan(0.75);
        expect(run.touched).toBeGreaterThan(0);
        CHECKS[name]!(run);
        expect(parted(ref.track, run.track), 'first frame the tracks part').toBe(-1);
      } finally {
        Object.assign(MessTuning, saved);
      }
    }, 120000);
  }

  it('everything at once, and the dead he runs into are shoved aside', async () => {
    const ref = await empty();
    const saved = { ...MessTuning };
    try {
      const run = await stage(s => {
        for (const layout of Object.values(LAYOUTS)) layout(s);
      });
      expect(parted(ref.track, run.track), 'first frame the tracks part').toBe(-1);
      expect(run.touched).toBeGreaterThan(20);
      expect(run.mess.pushWakes).toBeGreaterThan(0);
    } finally {
      Object.assign(MessTuning, saved);
    }
  }, 240000);
});
