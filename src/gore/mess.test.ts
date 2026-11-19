/**
 * The dead at rest, headless on real ragdolls: bodies heap, a heap wakes without throwing what lies on it, whoever walks
 * into a body shoves it aside as a ragdoll and is never touched by it, and the caps take the oldest out of sight first.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { humanoidRig } from '../characters/rig';
import { CG, type Ctx, type DamageInfo } from '../core/contracts';
import { groups, Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import { createGoreSystem, GoreTuning, type Gore } from './index';
import { ChunkTuning } from './chunks';
import type { CorpseSnapshot, FarBuffers } from './far';
import { MESS, MessTuning, messBudget, stillSkeleton } from './mess';
import type { Rag } from './rag';
import { TestDummy } from './testDummy';

const rig = humanoidRig('test');
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();
const player = { alive: true, position: v(50, 0, 50), velocity: v(0, 0, 0), eye: v(50, 1.7, 50) };
const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 500);
const render = { scene, camera: null as THREE.PerspectiveCamera | null, decals: { add() {}, splat() {}, clear() {} } };

/** A dummy the far batch can take: it bakes to one triangle at its hips, and stands up again from its pose. */
class BakeDummy extends TestDummy {
  readonly farMaterial = new THREE.MeshBasicMaterial();
  bakeFar(out: FarBuffers, vertex: number, index: number): { verts: number; indices: number } {
    const at = hips(this);
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
const spawnBake = (x = 0, z = 0): BakeDummy => {
  const c = new BakeDummy(rig);
  c.root.position.set(x, 0, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  return c;
};

function spawn(x = 0, z = 0, y = 0): TestDummy {
  const c = new TestDummy(rig);
  c.root.position.set(x, y, z);
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  return c;
}
function frame(): void {
  ctx.time.tick(1 / 60);
  physics.step(ctx.time.dt);
  gore.update();
}
const run = (frames: number): void => {
  for (let i = 0; i < frames; i++) frame();
};
const chainOf = (c: TestDummy): Rag => (gore as unknown as { owned: Map<TestDummy, { rag: Rag }> }).owned.get(c)!.rag;
const hips = (c: TestDummy): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(c.bones[0]!.matrixWorld);
/** Runs until nothing simulates, or `frames` are up. */
function settle(frames = 600): number {
  for (let i = 0; i < frames; i++) {
    frame();
    if (gore.stats().ragdolls === 0 && gore.stats().liveLimbs === 0) return i;
  }
  return frames;
}
/** Dead bodies dropped one at a time on one spot, each from above the last. */
function heap(count: number, x = 0, z = 0): TestDummy[] {
  const out: TestDummy[] = [];
  for (let i = 0; i < count; i++) {
    const c = spawn(x + ((i * 7) % 5 - 2) * 0.12, z + ((i * 3) % 5 - 2) * 0.12, 0.6 + i * 0.12);
    c.root.rotation.y = i * 1.3;
    c.root.updateMatrixWorld(true);
    gore.ragdoll(c, { velocity: v(0, -1, 0) });
    out.push(c);
    settle(240);
  }
  settle();
  return out;
}
const dynamicBodies = (): number => {
  let n = 0;
  physics.world.bodies.forEach(b => { if (b.isDynamic()) n++; });
  return n;
};
const pellet = (point: THREE.Vector3): DamageInfo => ({ amount: 20, type: 'bullet', point: point.clone(), dir: v(0, -1, 0), force: 4, source: 'test' });

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({
    physics, render: render as unknown as Ctx['render'], player: player as unknown as Ctx['player'],
    characters: { spawn: () => new BakeDummy(rig) } as unknown as Ctx['characters'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(v(0, -0.5, 0), v(80, 0.5, 80), null, 'concrete');
  physics.flushQueries();
});

beforeEach(() => {
  gore.clear();
  player.position.set(50, 0, 50);
  player.velocity.set(0, 0, 0);
  render.camera = null;
  MessTuning.level = 'standard';
  MessTuning.rest = true;
  MessTuning.push = true;
  MessTuning.far = true;
  MessTuning.bakeAfter = 3;
  GoreTuning.maxCorpses = MESS.standard.corpses;
});

describe('a body at rest', () => {
  it('has no body in the physics world, only fixed capsules where its own lay', () => {
    const c = spawn();
    gore.ragdoll(c);
    settle();
    expect(gore.stats().ragdolls).toBe(0);
    expect(dynamicBodies()).toBe(0);
    const rag = chainOf(c);
    expect(rag.resting).toBe(true);
    expect(rag.restCount).toBeGreaterThanOrEqual(10);
    // The box round them holds the body, lying on the floor.
    const at = hips(c);
    expect(rag.restMin.y).toBeGreaterThan(-0.05);
    expect(rag.restMax.y).toBeLessThan(0.7);
    expect(at.x).toBeGreaterThan(rag.restMin.x);
    expect(at.x).toBeLessThan(rag.restMax.x);
    expect(gore.mess.stats().shapes).toBe(rag.restCount);
  });

  it('meets ragdolls and limbs and nothing else: not the player, the living, a bullet or the nav', () => {
    const c = spawn();
    gore.ragdoll(c);
    settle();
    const at = hips(c);
    // A world ray from above goes straight through to the floor.
    physics.flushQueries();
    const hit = physics.raycast(v(at.x, 3, at.z), v(0, -1, 0), 10, CG.World);
    expect(hit!.point.y).toBeCloseTo(0, 2);
    for (const mask of [CG.Player, CG.Enemy, CG.Projectile, CG.Debris]) {
      expect(physics.raycast(v(at.x, 3, at.z), v(0, -1, 0), 2.95, mask), `mask ${mask}`).toBeNull();
    }
    // The player's capsule sees nothing there either.
    expect(physics.overlapCapsule(v(at.x, 1, at.z), 0.45, 0.5, CG.World)).toBe(false);
    // A ragdoll's own filter does.
    let seen = 0;
    const ball = new physics.R.Ball(0.3);
    physics.world.intersectionsWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, ball, () => { seen++; return true; }, undefined, groups(CG.Ragdoll, CG.Ragdoll));
    expect(seen).toBeGreaterThan(0);
  });

  it('is woken by a round as before, and its capsules go with it', () => {
    const c = spawn();
    gore.ragdoll(c);
    settle();
    const hit = gore.raycastCorpses(hips(c).add(v(0, 1, 0)), v(0, -1, 0), 3)!;
    gore.damageCorpse(hit, pellet(hit.point));
    const rag = chainOf(c);
    expect(rag.active).toBe(true);
    expect(rag.resting).toBe(false);
    expect(gore.mess.stats().shapes).toBe(0);
    settle();
    expect(rag.resting).toBe(true);
  });

  it('keeps no capsules with ?messrest=0, as before', () => {
    MessTuning.rest = false;
    const c = spawn();
    gore.ragdoll(c);
    settle();
    expect(chainOf(c).resting).toBe(false);
    expect(physics.world.colliders.len()).toBe(1);
  });
});

describe('bodies heap', () => {
  it('land on each other: ten on one spot stand a body or more high, where they lay flat', () => {
    const top = (list: TestDummy[]): number => Math.max(...list.map(c => hips(c).y));
    const high = top(heap(10));
    gore.clear();
    MessTuning.rest = false;
    const flat = top(heap(10, 20, 20));
    // Flat, every body's hips rest on the floor, a hand's width up. Heaped, the last lie on the first.
    expect(flat).toBeLessThan(0.3);
    expect(high).toBeGreaterThan(0.42);
    expect(high).toBeGreaterThan(flat * 1.8);
  });

  it('leave nothing simulating once they lie still', () => {
    heap(8);
    expect(gore.stats().ragdolls).toBe(0);
    expect(dynamicBodies()).toBe(0);
    expect(gore.mess.stats().resting).toBe(8);
  });

  it('wake from under a pile without throwing what lies on it', () => {
    const list = heap(8);
    const before = list.map(hips);
    // The lowest body, shot where it lies.
    const low = list.reduce((a, b) => (hips(a).y < hips(b).y ? a : b));
    const hit = gore.raycastCorpses(hips(low).add(v(0.02, 0.05, 0)), v(0, -1, 0), 1) ?? gore.raycastCorpses(hips(low).add(v(0, 2, 0)), v(0, -1, 0), 3)!;
    gore.damageCorpse(hit, { ...pellet(hit.point), force: 1 });
    let fastest = 0;
    let risen = 0;
    for (let i = 0; i < 90; i++) {
      frame();
      list.forEach((c, k) => {
        const rag = chainOf(c);
        if (rag.active) fastest = Math.max(fastest, rag.speed);
        risen = Math.max(risen, hips(c).y - before[k]!.y);
      });
    }
    // A pop under a pile throws bodies at metres a second and lifts them. Settling is a shuffle.
    expect(fastest).toBeLessThan(3);
    expect(risen).toBeLessThan(0.15);
  });

  it('fall when what they lay on goes', () => {
    const list = heap(5);
    const order = [...list].sort((a, b) => hips(a).y - hips(b).y);
    const topOne = order[order.length - 1]!;
    const was = hips(topOne).y;
    expect(was).toBeGreaterThan(0.3);
    // Everything under it is taken away at once, as a gib takes a corpse.
    for (const c of order.slice(0, -1)) gore.gib(c, hips(c), 0);
    run(4);
    expect(chainOf(topOne).active).toBe(true);
    settle();
    expect(hips(topOne).y).toBeLessThan(was - 0.12);
    expect(gore.mess.stats().slipWakes).toBeGreaterThan(0);
  });
});

describe('walking into the dead', () => {
  const walk = (from: THREE.Vector3, to: THREE.Vector3, speed: number): void => {
    const dir = to.clone().sub(from);
    const frames = Math.ceil((dir.length() / speed) * 60);
    dir.normalize();
    player.velocity.copy(dir).multiplyScalar(speed);
    for (let i = 0; i <= frames; i++) {
      player.position.copy(from).addScaledVector(dir, (i / 60) * speed);
      frame();
    }
    player.velocity.set(0, 0, 0);
  };

  it('pushes a body aside as a ragdoll, and it settles again', () => {
    const c = spawn();
    gore.ragdoll(c);
    settle();
    const at = hips(c);
    const rag = chainOf(c);
    expect(rag.active).toBe(false);
    // Straight across its middle, a little to one side, at a walk.
    walk(v(at.x - 2.5, 0, at.z + 0.1), v(at.x + 2.5, 0, at.z + 0.1), 4);
    expect(gore.mess.stats().pushWakes).toBe(1);
    const moved = hips(c).sub(at);
    moved.y = 0;
    expect(moved.length()).toBeGreaterThan(0.25);
    // Shoved, not thrown: it stays on the floor and within a couple of metres.
    expect(moved.length()).toBeLessThan(3);
    expect(hips(c).y).toBeLessThan(0.6);
    player.position.set(50, 0, 50);
    settle();
    expect(rag.resting).toBe(true);
  });

  it('never moves or lifts the player: they are not in each other\'s world', () => {
    heap(6);
    physics.flushQueries();
    // The player's own sweep through the heap meets nothing but the floor it stands on.
    const sweep = physics.sweepCapsule(v(-3, 1.0, 0), 0.45, 0.45, v(6, 0, 0), CG.World);
    expect(sweep).toBeNull();
  });

  it('is nothing to a body the player only stands on', () => {
    const c = spawn();
    gore.ragdoll(c);
    settle();
    player.position.copy(hips(c)).setY(0);
    run(60);
    expect(chainOf(c).active).toBe(false);
    expect(gore.mess.stats().pushWakes).toBe(0);
  });

  it('does nothing with ?messpush=0', () => {
    MessTuning.push = false;
    const c = spawn();
    gore.ragdoll(c);
    settle();
    const at = hips(c);
    walk(v(at.x - 2, 0, at.z), v(at.x + 2, 0, at.z), 5);
    expect(chainOf(c).active).toBe(false);
    expect(hips(c).distanceTo(at)).toBeLessThan(1e-6);
  });

  it('wakes a few a frame and no more, however many are stood in', () => {
    const list: TestDummy[] = [];
    for (let i = 0; i < 6; i++) {
      const c = spawn(Math.cos(i) * 0.25, Math.sin(i) * 0.25, 0.2);
      gore.ragdoll(c);
      list.push(c);
    }
    settle();
    MessTuning.rest = true;
    player.position.set(-0.6, 0, 0);
    player.velocity.set(6, 0, 0);
    frame();
    expect(list.filter(c => chainOf(c).active).length).toBeLessThanOrEqual(MessTuning.wakesPerFrame);
    player.position.set(-0.5, 0, 0);
    frame();
    expect(list.filter(c => chainOf(c).active).length).toBeLessThanOrEqual(MessTuning.wakesPerFrame * 2);
  });

  it('charged through at a sprint, a heap is ploughed and nothing flies', () => {
    const list = heap(8);
    const before = list.map(hips);
    let top = 0;
    const from = v(-4, 0, 0.05);
    const to = v(4, 0, 0.05);
    const dir = to.clone().sub(from).normalize();
    player.velocity.copy(dir).multiplyScalar(12.5);
    for (let i = 0; i <= 40; i++) {
      player.position.copy(from).addScaledVector(dir, (i / 60) * 12.5);
      frame();
      for (const c of list) top = Math.max(top, hips(c).y);
    }
    player.velocity.set(0, 0, 0);
    player.position.set(50, 0, 50);
    settle();
    const moved = list.map((c, i) => hips(c).setY(0).distanceTo(before[i]!.setY(0)));
    expect(Math.max(...moved)).toBeGreaterThan(0.4);
    // Aside, not across the room, and never up past head height.
    expect(Math.max(...moved)).toBeLessThan(6);
    expect(top).toBeLessThan(1.6);
  });
});

describe('the caps', () => {
  it('sink the oldest past the cap where there is no camera to ask', () => {
    GoreTuning.maxCorpses = 12;
    const first = spawn(-6, -6);
    gore.ragdoll(first);
    for (let i = 0; i < 12; i++) gore.ragdoll(spawn((i % 6) * 2 - 5, 3 + Math.floor(i / 6) * 2));
    run(Math.ceil(MessTuning.policyEvery * 60) + 2);
    expect(gore.stats().corpses).toBe(12);
    expect(gore.mess.stats().sunk).toBe(1);
    run(Math.ceil(60 * GoreTuning.sinkSeconds) + 5);
    expect(gore.owns(first)).toBe(false);
  });

  it('take the oldest out of sight at once, and leave the ones in view', () => {
    GoreTuning.maxCorpses = 6;
    render.camera = camera;
    camera.position.set(0, 1.7, -8);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    // Six behind the camera, the oldest; then six in front of it.
    const behind = Array.from({ length: 6 }, (_, i) => spawn(i - 2.5, -20));
    for (const c of behind) gore.ragdoll(c);
    const ahead = Array.from({ length: 6 }, (_, i) => spawn(i - 2.5, 0));
    for (const c of ahead) gore.ragdoll(c);
    run(Math.ceil(MessTuning.policyEvery * 60) + 2);
    expect(gore.stats().corpses).toBe(6);
    expect(gore.mess.stats().removed).toBe(6);
    expect(gore.mess.stats().sunk).toBe(0);
    for (const c of behind) expect(gore.owns(c)).toBe(false);
    for (const c of ahead) expect(gore.owns(c)).toBe(true);
  });

  it('let no body sink in view until far past the cap', () => {
    GoreTuning.maxCorpses = 6;
    render.camera = camera;
    camera.position.set(0, 3, -10);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld(true);
    const n = 6 + MessTuning.hardOver;
    for (let i = 0; i < n; i++) gore.ragdoll(spawn((i % 6) - 2.5, Math.floor(i / 6) * 1.5));
    run(Math.ceil(MessTuning.policyEvery * 60) + 2);
    // All in view: over the cap, but inside the allowance.
    expect(gore.stats().corpses).toBe(n);
    expect(gore.mess.stats().sunk).toBe(0);
    gore.ragdoll(spawn(0, 6));
    gore.ragdoll(spawn(1, 6));
    run(Math.ceil(MessTuning.policyEvery * 60) + 2);
    expect(gore.mess.stats().sunk).toBe(2);
    expect(gore.stats().corpses).toBe(n);
  });

  it('settle all but the newest: no shadow of their own, given back when the body goes', () => {
    const full = messBudget().full;
    const list = Array.from({ length: full + 5 }, (_, i) => spawn((i % 6) * 1.5 - 4, Math.floor(i / 6) * 2));
    for (const c of list) gore.ragdoll(c);
    settle();
    run(Math.ceil(MessTuning.policyEvery * 60) + 2);
    expect(gore.mess.stats().settled).toBe(5);
    // The oldest five are the settled ones.
    for (let i = 0; i < list.length; i++) expect(list[i]!.mesh.castShadow, `body ${i}`).toBe(i >= 5);
    gore.clear();
    for (const c of list) expect(c.mesh.castShadow).toBe(true);
  });

  it('give up the oldest capsules past the budget for them, and wake what lay on those', () => {
    const was = MessTuning.maxShapes;
    const a = spawn(0, 0);
    gore.ragdoll(a);
    settle();
    const each = chainOf(a).restCount;
    MessTuning.maxShapes = each * 3;
    const more = Array.from({ length: 4 }, (_, i) => spawn(6 + i * 3, 0));
    for (const c of more) gore.ragdoll(c);
    settle();
    expect(gore.mess.stats().shapes).toBeLessThanOrEqual(each * 3);
    expect(chainOf(a).resting).toBe(false);
    expect(gore.mess.stats().ghosted).toBeGreaterThan(0);
    MessTuning.maxShapes = was;
  });
});

describe('a still skeleton', () => {
  const make = () => {
    const root = new THREE.Group();
    const bones = [new THREE.Bone(), new THREE.Bone()];
    root.add(bones[0]!);
    bones[0]!.add(bones[1]!);
    bones[1]!.position.set(0, 0.4, 0);
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    skeleton.computeBoneTexture();
    return { root, bones, skeleton, source: { skeleton, bones } };
  };
  const proto = THREE.Skeleton.prototype.update;

  it('is not worked out again until something writes to it', () => {
    const { skeleton, source } = make();
    stillSkeleton(source, true);
    expect(skeleton.update).not.toBe(proto);
    const tex = skeleton.boneTexture!;
    skeleton.update();
    const sent = tex.version;
    for (let i = 0; i < 5; i++) skeleton.update();
    expect(tex.version).toBe(sent);
    // A wound writes past the bones: sent once.
    const data = skeleton.boneMatrices!;
    data[data.length - 3] = 0.5;
    skeleton.update();
    expect(tex.version).toBe(sent + 1);
    skeleton.update();
    expect(tex.version).toBe(sent + 1);
    stillSkeleton(source, false);
    expect(skeleton.update).toBe(proto);
  });

  it('ends by itself the moment a bone moves, whoever moved it', () => {
    // The library hands a corpse's instance to a living enemy, or a body sinks: nobody told the skeleton.
    for (const move of ['bone', 'root'] as const) {
      const { root, bones, skeleton, source } = make();
      stillSkeleton(source, true);
      skeleton.update();
      expect(skeleton.update).not.toBe(proto);
      if (move === 'bone') bones[1]!.rotation.x = 0.3;
      else root.position.y -= 0.2;
      root.updateMatrixWorld(true);
      const before = skeleton.boneMatrices!.slice(0, 32);
      skeleton.update();
      expect(skeleton.update, move).toBe(proto);
      // And it was worked out on that same frame, not one late.
      expect([...skeleton.boneMatrices!.slice(0, 32)], move).not.toEqual([...before]);
    }
  });
});

describe('clear at wave break', () => {
  it('sweeps the dead off the floor when the wave ends, in sight and without a pop, and only at that setting', () => {
    const list = Array.from({ length: 5 }, (_, i) => spawn(i * 2 - 4, 0));
    for (const c of list) gore.ragdoll(c);
    settle();
    let faded = 0;
    (render.decals as unknown as { fadeOut(s: number): void }).fadeOut = () => { faded++; };
    ctx.events.emit('wave:clear', { wave: 1, bonus: 0 });
    run(5);
    expect(gore.stats().corpses).toBe(5);
    expect(faded).toBe(0);
    MessTuning.level = 'break';
    ctx.events.emit('wave:clear', { wave: 2, bonus: 0 });
    // Sinking, so no longer counted, but still there to be watched going.
    expect(gore.stats().corpses).toBe(0);
    expect(faded).toBe(1);
    for (const c of list) expect(gore.owns(c)).toBe(true);
    run(Math.ceil(60 * GoreTuning.sinkSeconds) + 5);
    for (const c of list) expect(gore.owns(c)).toBe(false);
    expect(physics.world.colliders.len()).toBe(1);
  });
});

describe('loose pieces', () => {
  const meat = (): number => gore.chunks.aliveOf('meat');

  it('lie until their slot is needed, and no longer than the room the setting gives them', () => {
    const room = ChunkTuning.capacity.meat;
    ChunkTuning.share = 0.5;
    ChunkTuning.linger = Infinity;
    for (let i = 0; i < room; i++) gore.chunks.spawn('meat', (i % 20) * 0.3, 0.3, 30 + Math.floor(i / 20) * 0.3, 0, 0, 0, 0.05);
    expect(meat()).toBe(room / 2);
    // Twenty seconds on, which used to be six seconds after the last of them had shrunk away.
    run(60 * 20);
    expect(meat()).toBe(room / 2);
    expect(gore.chunks.bodies).toBe(0);
    ChunkTuning.share = 0.25;
    gore.chunks.trim();
    expect(meat()).toBe(room / 4);
    // Swept at a wave break, they shrink away.
    gore.chunks.dismiss();
    run(Math.ceil(ChunkTuning.shrink * 60) + 3);
    expect(meat()).toBe(0);
    ChunkTuning.share = 0.5;
  });

  it('are kicked along by the player who walks into them', () => {
    gore.chunks.spawn('meat', 0, 0.2, 40, 0, 0, 0, 0.06);
    run(120);
    expect(gore.chunks.bodies).toBe(0);
    player.position.set(-0.2, 0, 40);
    player.velocity.set(8, 0, 0);
    frame();
    expect(gore.chunks.bodies).toBe(1);
    expect(gore.chunks.fastest).toBeGreaterThan(1.5);
    expect(gore.chunks.fastest).toBeLessThan(7);
    player.velocity.set(0, 0, 0);
    player.position.set(50, 0, 50);
    run(300);
    expect(gore.chunks.bodies).toBe(0);
    expect(meat()).toBe(1);
  });
});

describe('the far batch', () => {
  const looks = (n = 1): void => run(Math.ceil(MessTuning.policyEvery * 60 * n) + 2);
  /** `count` bakeable bodies killed in rows and left until every one that is going to be baked has been. */
  function field(count: number, x0 = 0, z0 = 0): BakeDummy[] {
    const list = Array.from({ length: count }, (_, i) => spawnBake(x0 + (i % 8) * 1.6, z0 + Math.floor(i / 8) * 2.2));
    for (const c of list) gore.ragdoll(c);
    settle(900);
    MessTuning.bakeAfter = 0;
    looks(count);
    return list;
  }
  const bonesOf = (c: TestDummy): THREE.Vector3[] => c.bones.map(b => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));

  it('takes the oldest bodies past the number drawn as characters, and gives their instances back', () => {
    const drawn = messBudget().drawn;
    const list = field(drawn + 6);
    expect(gore.stats().far).toBe(6);
    expect(gore.stats().corpses).toBe(drawn);
    expect(gore.far.count).toBe(6);
    expect(gore.far.triangles).toBe(6);
    expect(gore.mess.stats().baked).toBe(6);
    // The oldest six: gore no longer has their characters, and they are out of the scene.
    list.forEach((c, i) => {
      expect(gore.owns(c), `body ${i}`).toBe(i >= 6);
      expect(c.root.parent === null, `body ${i} released`).toBe(i < 6);
    });
    // Their fixed capsules are still in the world: a baked body is still part of its heap.
    expect(gore.mess.stats().resting).toBe(drawn + 6);
  });

  it('bakes nothing with ?messfar=0, nor a body younger than it should be, nor one that is held', () => {
    const drawn = messBudget().drawn;
    MessTuning.far = false;
    const list = field(drawn + 4);
    expect(gore.stats().far).toBe(0);
    MessTuning.far = true;
    MessTuning.bakeAfter = 1e9;
    looks(4);
    expect(gore.stats().far).toBe(0);
    MessTuning.bakeAfter = 0;
    for (const c of list.slice(0, 2)) gore.hold(c, 30);
    looks(8);
    expect(gore.stats().far).toBe(4);
    expect(gore.owns(list[0]!)).toBe(true);
    expect(gore.owns(list[1]!)).toBe(true);
  });

  it('stands a body up again exactly as it lay, on the same capsules', () => {
    const list = field(messBudget().drawn + 3);
    const oldest = list[0]!;
    const was = bonesOf(oldest);
    const colliders = physics.world.colliders.len();
    const rests = gore.mess.stats().shapes;
    expect(gore.owns(oldest)).toBe(false);
    // A round into where it lies finds it.
    const hit = gore.raycastCorpses(was[0]!.clone().add(v(0, 1.5, 0)), v(0, -1, 0), 4);
    expect(hit).not.toBeNull();
    expect(gore.stats().far).toBe(2);
    const body = (hit!.handle as { char: TestDummy }).char;
    expect(body).not.toBe(oldest);
    const now = bonesOf(body);
    now.forEach((p, i) => expect(p.distanceTo(was[i]!), `bone ${i}`).toBeLessThan(1e-4));
    // Nothing was added to or taken from the physics world: still at rest, on the capsules it had.
    expect(physics.world.colliders.len()).toBe(colliders);
    expect(gore.mess.stats().shapes).toBe(rests);
    expect(gore.stats().ragdolls).toBe(0);
    gore.damageCorpse(hit!, pellet(hit!.point));
    expect(gore.stats().ragdolls).toBe(1);
  });

  it('is walked into like any other body: the baked one stands up and is shoved', () => {
    field(messBudget().drawn + 2, 0, 0);
    // The oldest was killed standing at the origin and lies about there. A body just stood up is not baked again at once.
    const at = v(0, 0, 0);
    MessTuning.bakeAfter = 5;
    expect(gore.stats().far).toBe(2);
    player.velocity.set(4, 0, 0);
    let fewest = 2;
    let awake = 0;
    for (let i = 0; i <= 75; i++) {
      player.position.set(at.x - 2.5 + (i / 60) * 4, 0, at.z + 0.1);
      frame();
      fewest = Math.min(fewest, gore.stats().far);
      awake = Math.max(awake, gore.stats().ragdolls);
    }
    player.velocity.set(0, 0, 0);
    // It stood up and was shoved, and another further off was baked in its place: the number drawn stays at its cap. (With
    // no camera to hide the change from, it is stood up as the player nears it, before they touch.)
    expect(fewest).toBe(2);
    expect(awake).toBeGreaterThan(0);
    expect(gore.mess.stats().pushWakes).toBeGreaterThan(0);
    const baked = (gore as unknown as { farBodies: { rag: Rag }[] }).farBodies;
    for (const f of baked) expect(Math.hypot(f.rag.center.x, f.rag.center.z)).toBeGreaterThan(3);
  });

  it('is thrown by a blast: the nearest few stand up for it', () => {
    const list = field(messBudget().drawn + 8);
    const at = hips(list[2]!);
    expect(gore.stats().far).toBe(8);
    physics.radialImpulse(at.clone().setY(0.2), 4, 400);
    expect(gore.stats().far).toBeLessThan(8);
    // Six a frame at most.
    expect(gore.stats().far).toBeGreaterThanOrEqual(8 - 6);
    expect(gore.stats().ragdolls).toBeGreaterThan(0);
  });

  it('gives up its oldest out of sight past the cap for bodies, and everything at a clear', () => {
    const drawn = messBudget().drawn;
    render.camera = camera;
    camera.position.set(0, 1.7, -40);
    camera.lookAt(0, 1.7, -80);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    field(drawn + 10);
    expect(gore.stats().far).toBe(10);
    GoreTuning.maxCorpses = drawn + 4;
    looks(2);
    expect(gore.stats().far).toBe(4);
    expect(gore.far.count).toBe(4);
    gore.clear();
    expect(gore.stats().far).toBe(0);
    expect(gore.far.count).toBe(0);
    expect(physics.world.colliders.len()).toBe(1);
  });

  it('sinks with the rest when the floor is swept', () => {
    field(messBudget().drawn + 5);
    MessTuning.level = 'break';
    ctx.events.emit('wave:clear', { wave: 3, bonus: 0 });
    run(Math.ceil(60 * GoreTuning.sinkSeconds) + 5);
    expect(gore.stats().far).toBe(0);
    expect(gore.far.count).toBe(0);
    expect(gore.stats().corpses).toBe(0);
    expect(physics.world.colliders.len()).toBe(1);
  });
});
