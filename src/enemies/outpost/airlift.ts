/**
 * Taking a prisoner away. The player cuffs a man (prisoners.ts, hold E), and a second and a half later the Bureau's drone takes him: a
 * squat matte quadcopter that dives in low and fast with a hook trailing under it on a long line, snatches him off the floor on the pass
 * without slowing, and climbs away with him on the end of the line, limp and flailing (the game's own ragdoll, alive, not a kill), until
 * it is out of sight. Where the game has credits (Outpost Defense's, or the Crucible's purse: `ctx.contracts.wallet`) that pays a bounty
 * (contracts/defense/data.ts `BOUNTY`), once, as he leaves the floor.
 *
 * The pass is a parabola: the hook's path bottoms out at his back with the drone `TRAIL` m ahead of it and `DROP` m over it. Rays along
 * the hook's path and the drone's pick a heading with nothing in the way, so it never flies through a wall or a roof.
 *
 * Roofs: with no clear heading over him, the nearest floor within 14 m that has one is found, and on the pass he is dragged out to it
 * along the line, a ragdoll pulled across the floor (straight, or along a route through the door), and snatched from there.
 *
 * The state machine and the arithmetic are capture.ts.
 */
import * as THREE from 'three';
import { HumanoidBone as B } from '../../characters/rig';
import { CG, type LoopHandle } from '../../core/contracts';
import { clamp, TAU } from '../../core/math';
import { BOUNTY } from '../../contracts/defense/data';
import { Airframe, type AirframeSpec } from '../../progression/callins/airframe';
import { hitText } from '../../progression/data';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import type { AiWorld } from '../aiWorld';
import { finishAttack } from '../brain';
import { Capture, CLICKS, DRAG_SPEED, rope, snatchTime, type Wallet } from './capture';
import type { Outpost } from './index';
import { pose, type Soldier } from './soldier';

/** Most drones in the air at once. A pass takes about six seconds, so this many keeps the snatch on time for anyone cuffed. */
export const MAX_DRONES = 4;
/**
 * Metres a second along the pass, and the curve of it: up `SWOOP` s² either side of the snatch, and `CLIMB` s² more after it. Steep, so
 * the hook is low only for the few metres either side of him: it dives in at about 50 degrees, pulls nearly 4 g and climbs out.
 */
const SPEED = 22;
const SWOOP = 18;
const CLIMB = 4;
/** Seconds before the snatch it comes into the picture, and after it, that it is gone. */
const LEAD = 1.2;
const AFTER = 4.5;
const GONE_RANGE = 140;
/** Where the hook trails: this far behind the drone and this far under it. The line is the hypotenuse. */
const TRAIL = 4;
const DROP = 8;
const LINE = Math.hypot(TRAIL, DROP);
/** How hard the line takes up what is past its length, per second, and how far past it a stuck body is let go. */
const PULL = 9;
const SNAG = 5;
/** The column the pad search asks for before trying headings: the drone's span, from rotor height up. */
const COLUMN = 1.6;
const SKY = 30;
/** Farthest he is dragged out from under a roof. */
const DRAG_REACH = 14;
const DRAG_ROUTE = 18;
/** Seconds gore keeps him down: the whole drag and pass, and if he comes off the line, how long he lies there. */
const LIE = 8;
/** His back over the floor as he kneels, where the hook goes. */
const BACK = 0.9;
const FEED_COLOR = '#ffc14a';

const HULL = '#2a2d30';
const DARK = '#1a1c1e';
const PANEL = '#33373b';
const STEEL = '#4a4e52';
const MARK = '#7d8388';
const CORNERS = [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
const ARM_X = 0.92;
const ARM_Z = 0.78;

/** The Bureau's lifter. Nose along +Z, left +X, as every airframe here. About 2.9 m across the rotors: it carries a man. */
const DRONE: AirframeSpec<'winch'> = {
  name: 'bureau-drone',
  build(b) {
    b.box(1.0, 0.24, 0.84, HULL);
    b.box(0.78, 0.1, 0.62, PANEL, { at: [0, 0.17, -0.04] });
    b.box(0.66, 0.16, 0.5, DARK, { at: [0, -0.19, 0] });
    // A pale band down each flank and a sensor block in the nose, so its heading reads from the floor.
    b.box(0.02, 0.05, 0.62, MARK, { at: [0.505, 0.04, 0] });
    b.box(0.02, 0.05, 0.62, MARK, { at: [-0.505, 0.04, 0] });
    b.box(0.24, 0.13, 0.12, DARK, { at: [0, -0.03, 0.46] });
    b.glow(new THREE.SphereGeometry(0.032, 8, 6), '#ff1a0a', 4, { at: [0, -0.03, 0.53] });
    // The winch drum under the belly, the line's way out.
    b.cyl(0.1, 0.1, 0.34, 10, STEEL, { at: [0, -0.34, 0], rot: [0, 0, Math.PI / 2] });
    for (const [sx, sz] of CORNERS) {
      const x = sx * ARM_X, z = sz * ARM_Z;
      b.box(0.08, 0.06, Math.hypot(x, z) * 0.8, HULL, { at: [x * 0.56, 0.04, z * 0.56], rot: [0, Math.atan2(x, z), 0] });
      b.cyl(0.085, 0.1, 0.17, 10, DARK, { at: [x, 0.1, z] });
      b.box(0.035, 0.3, 0.035, DARK, { at: [sx * 0.38, -0.36, sz * 0.3] });
    }
    b.box(0.045, 0.04, 1.0, DARK, { at: [0.38, -0.51, 0] });
    b.box(0.045, 0.04, 1.0, DARK, { at: [-0.38, -0.51, 0] });
  },
  // Diagonal pairs turn the same way, as on any quad.
  rotors: CORNERS.map(([sx, sz]) => ({
    at: [sx * ARM_X, 0.2, sz * ARM_Z] as const, axis: 'y' as const, rate: sx * sz * 55, disc: 0.53,
    build: (b: ModelBuilder) => void b.box(1.04, 0.014, 0.085, DARK),
  })),
  mounts: { winch: [0, -0.45, 0] },
  strobe: { build: b => void b.glow(new THREE.SphereGeometry(0.05, 8, 6), '#ff2010', 6, { at: [0, 0.24, -0.32] }), period: 1.1, lit: 0.16 },
};

class Drone {
  readonly frame: Airframe<'winch'>;
  readonly pos = new THREE.Vector3();
  readonly rope: THREE.Mesh;
  readonly hook: THREE.Group;
  busy = false;
  hum: LoopHandle | null = null;

  constructor(materials: ModelMaterials, scene: THREE.Scene, rope: THREE.Mesh, hook: THREE.Group) {
    this.frame = new Airframe(materials, scene, DRONE);
    this.rope = rope;
    this.hook = hook;
    rope.visible = hook.visible = false;
    scene.add(rope, hook);
  }
}

/** What the airlift keeps about one cuffed man. */
interface Held {
  c: Capture;
  /** Seconds since the cuffs went on. */
  age: number;
  clicks: number;
  readonly cuffs: THREE.Group;
  /** Where the hook takes him (his back, or the pad he is dragged to), the heading of the pass, and the snatch, in `age`. */
  readonly at: THREE.Vector3;
  readonly dir: THREE.Vector3;
  planned: boolean;
  snatchAt: number;
  /** Out from under a roof: the floor he is dragged along, and its length. Empty in the open. */
  readonly path: THREE.Vector3[];
  drag: number;
  drone: Drone | null;
  /** Gore has him as a ragdoll. False when it had no room, and he hangs as he stands (`bob`). */
  limp: boolean;
  /** The end of the line: his chest, or with no ragdoll, a weight standing in for it. */
  readonly load: THREE.Vector3;
  readonly bob: THREE.Vector3;
  readonly bobVel: THREE.Vector3;
  snagged: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _yank = new THREE.Vector3();
const _pad = new THREE.Vector3();
const _padAt = new THREE.Vector3();
const _padDir = new THREE.Vector3();

/** Where the empty hook is `s` seconds from the snatch (negative before it), on a pass along `dir` that takes him at `at`. */
function hookAt(at: THREE.Vector3, dir: THREE.Vector3, s: number, out: THREE.Vector3): THREE.Vector3 {
  const up = SWOOP * s * s + (s > 0 ? CLIMB * s * s : 0);
  return out.set(at.x + dir.x * SPEED * s, at.y + up, at.z + dir.z * SPEED * s);
}

/** The drone, `TRAIL` ahead of its hook and `DROP` over it. */
function droneAt(at: THREE.Vector3, dir: THREE.Vector3, s: number, out: THREE.Vector3): THREE.Vector3 {
  return hookAt(at, dir, s, out).addScaledVector(dir, TRAIL).setY(out.y + DROP);
}

/** The shared parts a drone and a pair of cuffs are made from, built the first time one is needed. */
interface Parts { materials: ModelMaterials; rope: THREE.BufferGeometry; ropeMat: THREE.Material; ring: THREE.BufferGeometry; link: THREE.BufferGeometry; steel: THREE.Material }

function makeParts(ctx: Ctx): Parts {
  const { materials } = ctx.render;
  return {
    materials: new ModelMaterials(ctx),
    rope: new THREE.CylinderGeometry(0.02, 0.02, 1, 5, 1, true).translate(0, 0.5, 0),
    ropeMat: materials.patch(new THREE.MeshStandardMaterial({ color: '#1c1a17', roughness: 0.95 })),
    ring: new THREE.TorusGeometry(0.048, 0.012, 6, 14),
    link: new THREE.BoxGeometry(1, 0.014, 0.014),
    steel: materials.patch(new THREE.MeshStandardMaterial({ color: '#a2a8ae', metalness: 0.85, roughness: 0.3 })),
  };
}

function makeDrone(ctx: Ctx, kit: Parts): Drone {
  const { scene } = ctx.render;
  // Matte, not the call-ins' polished metal: a working machine, painted to be hard to see against a night sky.
  const matte = ctx.render.materials.patch(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0.2, roughness: 0.85 }));
  const paint = { group: (b: ModelBuilder) => kit.materials.group(b, matte) } as ModelMaterials;
  const hook = new ModelBuilder()
    .cyl(0.025, 0.025, 0.2, 6, STEEL, { at: [0, 0.1, 0] })
    .box(0.08, 0.06, 0.05, DARK, { at: [0, 0.21, 0] })
    .solid(new THREE.TorusGeometry(0.06, 0.014, 6, 12, Math.PI * 1.35), STEEL, { at: [0.06, 0, 0], rot: [0, 0, Math.PI * 0.85] });
  return new Drone(paint, scene, new THREE.Mesh(kit.rope, kit.ropeMat), kit.materials.group(hook));
}

/** The drone's nose down into its dive and up out of it, on a pass along `dir`, `s` seconds from the snatch. */
function flyDrone(d: Drone, dir: THREE.Vector3, s: number, wobble: number, dt: number): void {
  const climb = 2 * SWOOP * s + (s > 0 ? 2 * CLIMB * s : 0);
  const pitch = clamp(0.38 - climb * 0.012, 0.1, 0.55);
  _f.copy(dir).setY(-Math.tan(pitch));
  d.frame.fly(d.pos, _f, Math.sin(wobble * 3) * 0.06);
  d.frame.update(dt);
  d.hum?.setPosition(d.pos);
}

/** The line from the drum (`win`) down to the hook at `load`. */
function drawLine(d: Drone, win: THREE.Vector3, load: THREE.Vector3): void {
  d.rope.visible = d.hook.visible = true;
  _a.subVectors(win, load);
  const len = _a.length();
  if (len < 1e-3) return;
  _a.divideScalar(len);
  _q.setFromUnitVectors(UP, _a);
  d.hook.position.copy(load);
  d.hook.quaternion.copy(_q);
  // The line runs from the top of the hook's shank to the drum.
  d.rope.position.copy(load).addScaledVector(_a, 0.22);
  d.rope.quaternion.copy(_q);
  d.rope.scale.set(1, Math.max(0.01, len - 0.22), 1);
}

function parkDrone(d: Drone): void {
  d.busy = false;
  d.frame.hide();
  d.rope.visible = d.hook.visible = false;
  d.hum?.stop(0.3);
  d.hum = null;
}

/** One pass a co-op guest is flying a copy of. */
interface Pass {
  uid: number;
  readonly at: THREE.Vector3;
  readonly dir: THREE.Vector3;
  /** Seconds from the snatch: negative on the way in. */
  s: number;
  drone: Drone;
  hooked: boolean;
}

/**
 * Co-op, on a guest: the skyhook on this screen. The prisoners and their capture live on the host, which says when a drone
 * is sent for a man (`begin`: who, where the hook takes him, the heading of the pass, the seconds until it does) and if he
 * comes off the line or the pass is called off (`cancel`). This flies the same drone on the same pass with its hook and line,
 * takes this screen's copy of the man off the floor as the hook reaches him, and carries him up on the end of the line until
 * the host's snapshot drops him. It pays nothing and decides nothing.
 */
export class AirliftCopy {
  private readonly passes: Pass[] = [];
  private readonly drones: Drone[] = [];
  private parts: Parts | null = null;

  constructor(private readonly ctx: Ctx) {}

  /** Drones in the air here, for the proofs. */
  get flying(): number {
    return this.passes.length;
  }

  /** Where each drone is, for the proofs. */
  get positions(): THREE.Vector3[] {
    return this.passes.map(p => p.drone.pos);
  }

  begin(uid: number, at: THREE.Vector3, dir: THREE.Vector3, lead: number): void {
    this.cancel(uid);
    if (this.passes.length >= MAX_DRONES) return;
    let drone = this.drones.find(d => !d.busy);
    if (!drone) this.drones.push(drone = makeDrone(this.ctx, this.parts ??= makeParts(this.ctx)));
    drone.busy = true;
    const pass: Pass = { uid, at: at.clone(), dir: dir.clone().setY(0).normalize(), s: -Math.max(0, Math.min(lead, 30)), drone, hooked: false };
    this.passes.push(pass);
  }

  cancel(uid: number): void {
    const i = this.passes.findIndex(p => p.uid === uid);
    if (i < 0) return;
    this.release(this.passes[i]!);
    parkDrone(this.passes[i]!.drone);
    this.passes.splice(i, 1);
  }

  /** The copy of the man goes back to the host's word for where he is. */
  private release(pass: Pass): void {
    const e = this.man(pass.uid);
    if (e) (e as EnemyInstance & { carried: boolean }).carried = false;
  }

  private man(uid: number): EnemyInstance | null {
    for (const e of this.ctx.enemies.alive) if (e.uid === uid) return e;
    return null;
  }

  update(dt: number): void {
    const { ctx } = this;
    for (let i = this.passes.length - 1; i >= 0; i--) {
      const pass = this.passes[i]!;
      const d = pass.drone;
      pass.s += dt;
      const { s } = pass;
      if (s < -LEAD) continue;
      droneAt(pass.at, pass.dir, s, d.pos);
      if (!d.hum) d.hum = ctx.audio.startLoop('liftdrone_rotor_loop', { position: d.pos, doppler: true, fadeIn: 0.2 }) ?? null;
      flyDrone(d, pass.dir, s, s, dt);
      const win = d.frame.mount('winch', _d);
      hookAt(pass.at, pass.dir, s, _b);
      const e = this.man(pass.uid);
      if (s >= 0 && !pass.hooked) {
        pass.hooked = true;
        ctx.audio.play('liftdrone_snatch', { position: pass.at });
        ctx.audio.play('cuff_click', { position: pass.at, pitch: 0.7, volume: 1.2 });
      }
      if (pass.hooked && e) {
        // He hangs from the hook by his back: the copy is carried, and the snapshot's word for where he stands is set aside.
        const carried = e as EnemyInstance & { carried: boolean; def?: { chest: number } };
        carried.carried = true;
        e.position.set(_b.x, _b.y - (carried.def?.chest ?? 1.2) - 0.12, _b.z);
        (ctx.enemies as unknown as { placeReplica?(enemy: EnemyInstance, dt: number, posture: string): void }).placeReplica?.(e, dt, 'bound');
      }
      drawLine(d, win, _b);
      if (s > AFTER || (s > 1 && d.pos.distanceTo(ctx.player.position) > GONE_RANGE)) {
        this.release(pass);
        parkDrone(d);
        this.passes.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const pass of this.passes) {
      this.release(pass);
      parkDrone(pass.drone);
    }
    this.passes.length = 0;
  }
}

export class Airlift {
  readonly held: Held[] = [];
  private readonly drones: Drone[] = [];
  private kit: Parts | null = null;
  /**
   * Co-op, on the host: told as a drone is sent for a man (his uid, where the hook takes him, the heading of the pass and the
   * seconds until it does) and, with `at` null, when he comes off the line or leaves the round, so every other screen flies
   * the same pass (`AirliftCopy`, net/world/airlift.ts).
   */
  onPass: ((uid: number, at: THREE.Vector3 | null, dir: THREE.Vector3, lead: number) => void) | null = null;
  /** The line's far end and length for this frame's tug, read by `pull`, which is made once. */
  private readonly anchor = new THREE.Vector3();
  private length = LINE;
  private readonly pull = (p: THREE.Vector3, v: THREE.Vector3): void => void rope(p, v, this.anchor, this.length, PULL);

  constructor(private readonly w: AiWorld, private readonly o: Outpost) {}

  /** The drones in the air, for the lab and tests. */
  get flying(): number {
    let n = 0;
    for (const d of this.drones) if (d.busy) n++;
    return n;
  }

  /** The capture for this man, if he is in cuffs. */
  of(s: Soldier): Capture | null {
    for (const h of this.held) if (h.c.s === s) return h.c;
    return null;
  }

  /** Hands behind his back and the cuffs on, and the drone on its way. */
  cuff(s: Soldier): void {
    const { ctx } = this.w;
    const e = s.e;
    const kit = this.prepare();
    s.cuffed = true;
    e.mode = 'hold';
    e.face = 'lock';
    e.velocity.set(0, 0, 0);
    const floor = ctx.world.nav.groundHeight(e.position.x, e.position.y + 1, e.position.z);
    if (!Number.isNaN(floor)) e.position.y = e.groundY = floor;
    e.thinkAt = e.behaviourUntil = 0;
    pose(e, 'cuffed');
    const cuffs = new THREE.Group();
    cuffs.add(new THREE.Mesh(kit.ring, kit.steel), new THREE.Mesh(kit.ring, kit.steel), new THREE.Mesh(kit.link, kit.steel));
    cuffs.visible = false;
    ctx.render.scene.add(cuffs);
    const h: Held = {
      c: new Capture(s), age: 0, clicks: 0, cuffs, at: new THREE.Vector3(), dir: new THREE.Vector3(), planned: false, snatchAt: 0, path: [], drag: 0,
      drone: null, limp: false, load: new THREE.Vector3(), bob: new THREE.Vector3(), bobVel: new THREE.Vector3(), snagged: 0,
    };
    this.held.push(h);
    this.plan(h);
    ctx.hud.feed('PRISONER CUFFED', FEED_COLOR);
    ctx.events.emit('prisoner:cuffed', { enemy: e });
  }

  update(dt: number): void {
    for (let i = this.held.length - 1; i >= 0; i--) {
      const h = this.held[i]!;
      h.age += dt;
      h.c.step(dt);
      this.click(h);
      if (!h.c.drone && h.c.phase !== 'hooked' && h.c.phase !== 'gone' && !h.c.s.e.downed && !h.c.s.e.airborne) {
        if (!h.planned) this.plan(h);
        if (this.flying < MAX_DRONES) this.dispatch(h);
      }
      if (h.drone && this.fly(h, h.drone, dt)) continue;
      this.placeCuffs(h);
    }
  }

  /** A body that has left the round, for any reason: killed, or carried off. */
  gone(s: Soldier): void {
    const i = this.held.findIndex(h => h.c.s === s);
    if (i < 0) return;
    const h = this.held[i]!;
    this.held.splice(i, 1);
    h.cuffs.removeFromParent();
    if (h.drone && h.c.phase !== 'hooked' && h.c.phase !== 'gone') this.onPass?.(s.e.uid, null, h.dir, 0);
    if (h.drone) parkDrone(h.drone);
  }

  reset(): void {
    for (const h of this.held) h.cuffs.removeFromParent();
    this.held.length = 0;
    for (const d of this.drones) parkDrone(d);
  }

  // -------------------------------------------------------------------------------------------
  // The man
  // -------------------------------------------------------------------------------------------

  private click(h: Held): void {
    const { c } = h;
    if (c.phase !== 'cuffing' || h.clicks >= CLICKS.length || c.t < CLICKS[h.clicks]!) return;
    h.clicks++;
    h.cuffs.visible = true;
    this.w.ctx.audio.play('cuff_click', { position: c.s.e.center, pitch: h.clicks === 1 ? 1 : 1.12 });
  }

  /** Steel on both wrists and the link between them, wherever his hands have got to. Thrown about on the line, the link is let go. */
  private placeCuffs(h: Held): void {
    if (!h.cuffs.visible) return;
    const bones = h.c.s.e.char.bones;
    const l = bones[B.handL], r = bones[B.handR];
    if (!l || !r) return;
    const [ringL, ringR, link] = h.cuffs.children as THREE.Mesh[];
    this.ring(ringL!, l, bones[B.foreArmL]);
    this.ring(ringR!, r, bones[B.foreArmR]);
    _a.subVectors(ringR!.position, ringL!.position);
    const span = _a.length();
    link!.visible = span < 0.3;
    link!.position.addVectors(ringL!.position, ringR!.position).multiplyScalar(0.5);
    link!.scale.set(Math.max(span, 0.01), 1, 1);
    if (span > 1e-4) link!.quaternion.setFromUnitVectors(_b.set(1, 0, 0), _a.divideScalar(span));
  }

  private ring(ring: THREE.Object3D, hand: THREE.Object3D, arm: THREE.Object3D | undefined): void {
    hand.getWorldPosition(ring.position);
    if (!arm) return;
    arm.getWorldPosition(_c);
    _c.subVectors(ring.position, _c);
    if (_c.lengthSq() > 1e-6) ring.quaternion.setFromUnitVectors(_b.set(0, 0, 1), _c.normalize());
  }

  /** His upper back as he kneels, where the hook goes. Worked out, not read off his bones: he is still going down onto his knees. */
  private harness(s: Soldier, out: THREE.Vector3): THREE.Vector3 {
    const e = s.e;
    return out.set(e.position.x - Math.sin(e.yaw) * 0.16, e.position.y + BACK, e.position.z - Math.cos(e.yaw) * 0.16);
  }

  /** Nothing in the way of the hook's path or the drone's, on a pass along `dir` that takes him at `at`. */
  private clear(at: THREE.Vector3, dir: THREE.Vector3): boolean {
    const { physics } = this.w.ctx;
    for (let k = 0; k < 2; k++) {
      const path = k === 0 ? hookAt : droneAt;
      path(at, dir, -LEAD, _a);
      for (let s = -LEAD + 0.15; s <= 1.2 + 1e-6; s += 0.15) {
        path(at, dir, s, _b);
        _c.subVectors(_b, _a);
        const len = _c.length();
        if (physics.raycast(_a, _c.divideScalar(len), len, CG.World | CG.Air)) return false;
        _a.copy(_b);
      }
    }
    // And the line between them, where it is low enough to meet a roof.
    for (let s = -0.45; s <= 0.45 + 1e-6; s += 0.15) {
      hookAt(at, dir, s, _a);
      droneAt(at, dir, s, _b);
      _c.subVectors(_b, _a);
      const len = _c.length();
      if (physics.raycast(_a, _c.divideScalar(len), len, CG.World | CG.Air)) return false;
    }
    return true;
  }

  /** A clear heading for a pass that takes him at `at`, across the player's view first. Writes `out`. */
  private heading(at: THREE.Vector3, tries: number, out: THREE.Vector3): boolean {
    const p = this.w.player.position;
    const base = Math.atan2(at.x - p.x, at.z - p.z) + Math.PI / 2;
    for (let k = 0; k < tries; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / tries);
      out.set(Math.sin(a), 0, Math.cos(a));
      if (this.clear(at, out)) return true;
    }
    out.set(Math.sin(base), 0, Math.cos(base));
    return false;
  }

  /** Open sky over `p` from the drone's height up: a cheap look before the rays of a whole pass. */
  private openSky(p: THREE.Vector3): boolean {
    const { physics } = this.w.ctx;
    for (let i = 0; i < 5; i++) {
      const a = (i / 4) * TAU;
      const r = i === 4 ? 0 : COLUMN;
      _c.set(p.x + Math.cos(a) * r, p.y + (i === 4 ? 0.4 : DROP - 1), p.z + Math.sin(a) * r);
      if (physics.raycast(_c, UP, SKY, CG.World | CG.Air)) return false;
    }
    return true;
  }

  /** Where and how the pass takes him: over him, or over the nearest floor he can be dragged out to. */
  private plan(h: Held): void {
    const s = h.c.s;
    const e = s.e;
    h.planned = true;
    h.path.length = 0;
    h.drag = 0;
    this.harness(s, h.at);
    if (this.heading(h.at, 16, h.dir)) return;
    const { nav } = this.w.ctx.world;
    const { physics } = this.w.ctx;
    for (let r = 2; r <= DRAG_REACH; r += 2) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        _pad.set(e.position.x + Math.cos(a) * r, e.position.y, e.position.z + Math.sin(a) * r);
        if (!nav.nearest(_pad, 1.5, _pad) || !this.openSky(_pad)) continue;
        _padAt.copy(_pad).setY(_pad.y + BACK);
        if (!this.heading(_padAt, 8, _padDir)) continue;
        // Straight out if nothing is in the way at his height, or along a route through the door.
        _b.copy(e.position).setY(e.position.y + 0.6);
        _c.copy(_pad).setY(_pad.y + 0.6).sub(_b);
        const straight = _c.length();
        if (!physics.raycast(_b, _c.divideScalar(straight), straight, CG.World)) {
          h.path.push(e.position.clone().setY(e.position.y + BACK), _padAt.clone());
        } else {
          if (!this.o.routeTo(s, _pad) || s.route.length > DRAG_ROUTE) continue;
          for (let i = 0; i < s.route.count; i++) h.path.push(new THREE.Vector3(s.route.x[i]!, s.route.y[i]! + BACK, s.route.z[i]!));
          h.path.push(_padAt.clone());
        }
        for (let i = 1; i < h.path.length; i++) h.drag += h.path[i]!.distanceTo(h.path[i - 1]!);
        h.at.copy(_padAt);
        h.dir.copy(_padDir);
        return;
      }
    }
    // shortcut: no clear pass within 14 m of him: the drone takes him straight up through whatever is over him. Nothing on the maps does this.
  }

  /** The point `along` metres down the drag. */
  private dragPoint(h: Held, along: number, out: THREE.Vector3): THREE.Vector3 {
    let left = along;
    for (let i = 1; i < h.path.length; i++) {
      const a = h.path[i - 1]!, b = h.path[i]!;
      const len = a.distanceTo(b);
      if (left <= len) return out.lerpVectors(a, b, len > 0 ? left / len : 1);
      left -= len;
    }
    return out.copy(h.path[h.path.length - 1]!);
  }

  // -------------------------------------------------------------------------------------------
  // The drone
  // -------------------------------------------------------------------------------------------

  private prepare(): Parts {
    return this.kit ??= makeParts(this.w.ctx);
  }

  private build(): Drone {
    const d = makeDrone(this.w.ctx, this.prepare());
    this.drones.push(d);
    return d;
  }

  private dispatch(h: Held): void {
    const d = this.drones.find(x => !x.busy) ?? this.build();
    d.busy = true;
    h.drone = d;
    h.c.drone = true;
    h.snatchAt = Math.max(snatchTime(h.drag), h.age + LEAD);
    h.snagged = 0;
    this.onPass?.(h.c.s.e.uid, h.at, h.dir, h.snatchAt - h.age);
  }

  /** One frame of the pass. True when it is over and the man is gone. */
  private fly(h: Held, d: Drone, dt: number): boolean {
    const { ctx } = this.w;
    const e = h.c.s.e;
    const s = h.age - h.snatchAt;
    if (s < -LEAD) return false;
    droneAt(h.at, h.dir, s, d.pos);
    if (!d.hum) d.hum = ctx.audio.startLoop('liftdrone_rotor_loop', { position: d.pos, doppler: true, fadeIn: 0.2 }) ?? null;
    this.pose(d, h, s, dt);
    const win = d.frame.mount('winch', _d);
    const dragFrom = -h.drag / DRAG_SPEED;
    if (h.c.phase === 'cuffed') {
      if (h.drag > 0 && s >= dragFrom) {
        // Out from under the roof on the line, dragged across the floor to where the pass takes him.
        if (!h.limp && !e.downed) this.goLimp(h, _yank.copy(h.dir).multiplyScalar(4));
        this.dragPoint(h, (s - dragFrom) * DRAG_SPEED, this.anchor);
        this.tug(h, 0.25, dt);
      } else hookAt(h.at, h.dir, s, h.load);
      if (s >= 0) this.snatch(h);
    }
    if (h.c.phase === 'hooked') {
      this.anchor.copy(win);
      if (!this.tug(h, LINE, dt)) return this.offHook(h, d);
    }
    this.drawLine(d, win, h.load);
    if (s > AFTER || (s > 1 && d.pos.distanceTo(this.w.player.position) > GONE_RANGE)) return this.finish(h, d);
    return false;
  }

  /** The hook takes him, on the pass, without slowing. Paid for here, once. */
  private snatch(h: Held): void {
    const { ctx } = this.w;
    const e = h.c.s.e;
    if (!h.c.hook()) return;
    if (!h.limp && !e.downed) this.goLimp(h, _yank.copy(h.dir).multiplyScalar(SPEED * 0.5).setY(7));
    ctx.audio.play('liftdrone_snatch', { position: h.at });
    ctx.audio.play('cuff_click', { position: h.at, pitch: 0.7, volume: 1.2 });
    const wallet: Wallet | null | undefined = ctx.contracts?.wallet;
    const paid = h.c.secure(wallet, BOUNTY[h.c.s.rank]);
    if (paid === null) return;
    if (wallet) {
      const text = hitText('BOUNTY SECURED', paid);
      if (text) ctx.hud.floatText(e.center, text, FEED_COLOR);
      ctx.hud.feed(`BOUNTY SECURED +${paid} CREDITS`, FEED_COLOR);
    } else ctx.hud.feed('BOUNTY SECURED', FEED_COLOR);
    ctx.events.emit('prisoner:secured', { enemy: e, bounty: paid });
  }

  /** Gore takes him: a living ragdoll, down for as long as he is on the line. With no room for one, he hangs as he stands. */
  private goLimp(h: Held, velocity: THREE.Vector3): void {
    const { ctx } = this.w;
    const e = h.c.s.e;
    this.harness(h.c.s, h.bob);
    h.limp = ctx.gore.knockdown?.(e.char, { velocity, impact: { dir: UP, strength: 1 }, lie: LIE, rise: 1.2, hurt: 1 }) === true;
    if (e.attack) finishAttack(e, this.w, true);
    e.velocity.set(0, 0, 0);
    e.push.set(0, 0, 0);
    e.reel.set(0, 0, 0);
    e.stagger = e.fallIn = 0;
    if (h.limp) {
      e.downed = e.airborne = true;
      e.ballistic = false;
      e.verticalSpeed = e.flightLeft = 0;
      return;
    }
    e.pinned = e.carried = true;
    h.bobVel.copy(velocity);
    pose(e, 'bound');
  }

  /**
   * The line pulls the load toward `anchor`, no further from it than `length`. The ragdoll's chest is pulled by its velocity and the
   * joints bring the rest; with no ragdoll, a weight swings and he stands under it. False once he has come off it.
   */
  private tug(h: Held, length: number, dt: number): boolean {
    const e = h.c.s.e;
    this.length = length;
    if (h.limp) {
      const chest = this.w.ctx.gore.tug?.(e.char, this.pull);
      if (!chest) return false;
      h.load.copy(chest);
    } else {
      if (!e.pinned) return false;
      h.bobVel.y -= 9.8 * dt;
      rope(h.bob, h.bobVel, this.anchor, length, PULL);
      h.bob.addScaledVector(h.bobVel, dt);
      h.load.copy(h.bob);
      e.position.set(h.bob.x, Math.max(h.bob.y - e.def.chest - 0.12, e.groundY), h.bob.z);
      (e.char.anim as { resetFeet?(): void }).resetFeet?.();
    }
    // Caught on something the line cannot pull him through: let go of him.
    h.snagged = h.load.distanceTo(this.anchor) > length + SNAG ? h.snagged + dt : 0;
    return h.snagged < 0.5;
  }

  /** Off the line alive: he lies where he fell, gets up in his cuffs, and waits for another pass. Paid already, he is not paid again. */
  private offHook(h: Held, d: Drone): boolean {
    const e = h.c.s.e;
    if (!h.limp) {
      e.pinned = e.carried = false;
      e.airborne = true;
      e.verticalSpeed = 0;
    }
    pose(e, 'cuffed');
    h.c.drop();
    this.onPass?.(e.uid, null, h.dir, 0);
    h.limp = false;
    h.planned = false;
    h.drone = null;
    parkDrone(d);
    return false;
  }

  /** Out of sight. The man is gone from the round: no kill, and the bounty was paid as he left the floor. */
  private finish(h: Held, d: Drone): boolean {
    const s = h.c.s;
    parkDrone(d);
    h.drone = null;
    if (!h.c.leave()) return false;
    if (s.e.alive) this.w.enemies.withdraw(s.e);
    else this.gone(s);
    return true;
  }

  /** Leaning hard into a pass this fast, nose down in the dive and up into the climb. */
  private pose(d: Drone, h: Held, s: number, dt: number): void {
    flyDrone(d, h.dir, s, h.age, dt);
  }

  private drawLine(d: Drone, win: THREE.Vector3, load: THREE.Vector3): void {
    drawLine(d, win, load);
  }
}
