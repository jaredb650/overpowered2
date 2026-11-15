/**
 * Taking a prisoner away. The player cuffs a man (prisoners.ts, hold E on the man he has by the collar), and the Bureau's drone comes for
 * him: a squat matte quadcopter that flies in high from off the map, comes straight down over him, lowers a hook on a line, hooks the
 * harness on his back, winches him off his feet and carries him off dangling under it until he is out of sight. Where the game has
 * credits that pays a bounty (contracts/defense/data.ts `BOUNTY`).
 *
 * Roofs: the drone only ever flies down a column of open sky. A man cuffed under a roof is walked out first, on his feet with his hands
 * behind him, to the nearest floor with open sky above it that a route reaches (a gate if nothing nearer will do). In and out, it flies
 * a straight line high above the map that a ray has found clear.
 *
 * The state machine is capture.ts. Two drones at most are in the air; anyone else cuffed waits his turn on his knees.
 */
import * as THREE from 'three';
import { HumanoidBone as B } from '../../characters/rig';
import { CG, type LoopHandle } from '../../core/contracts';
import { clamp, damp, dampAngle, TAU } from '../../core/math';
import { BOUNTY } from '../../contracts/defense/data';
import { Airframe, type AirframeSpec } from '../../progression/callins/airframe';
import { hitText } from '../../progression/data';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import type { AiWorld } from '../aiWorld';
import { Capture, type Wallet } from './capture';
import type { Outpost } from './index';
import { pose, type Soldier } from './soldier';

/** Most drones in the air at once. */
export const MAX_DRONES = 2;
/** Metres above him the drone comes down from, and the open sky the column test asks for. */
const TOP = 24;
const SKY = TOP + 6;
/** Radius of the column: the drone's span with a margin. */
const COLUMN = 1.6;
/** Metres above his floor it hovers to lower the hook, and the lowest its rotors get. */
const HOVER = 7.5;
const ROTORS = HOVER - 1.5;
/** Metres out along the clear line it comes in on and leaves by, and how far from the player counts as out of sight. */
const FAR = 100;
const GONE_RANGE = 130;
const CRUISE = 20;
/** Line paid out and wound in, metres a second, and the line left out when it carries him. */
const LOWER = 3.4;
const REEL = 1.5;
const SHORT = 3.2;
/** Seconds into the cuffing that the cuffs close, the second wrist a beat after. */
const CLICK_AT = 0.45;
const CLICK_GAP = 0.28;
/** Seconds the drone gives up after, whatever happens: nothing stays in the air for ever. */
const LIFETIME = 60;
/** Tries at a fresh pad for a man who stopped short of his. */
const PAD_TRIES = 3;
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

type Leg = 'inbound' | 'descend' | 'lower' | 'haul' | 'climb' | 'outbound';

/** What the airlift keeps about one cuffed man. */
interface Held {
  c: Capture;
  /** Where the drone comes down to him: where he kneels, or where he is being walked to. */
  readonly pad: THREE.Vector3;
  padded: boolean;
  tries: number;
  readonly cuffs: THREE.Group;
  clicks: number;
}

class Drone {
  readonly frame: Airframe<'winch'>;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly push = new THREE.Vector3();
  readonly top = new THREE.Vector3();
  readonly far = new THREE.Vector3();
  readonly bob = new THREE.Vector3();
  readonly bobVel = new THREE.Vector3();
  /** Where he was hooked: it hauls straight up from there, not after him as he swings. */
  readonly spot = new THREE.Vector3();
  readonly rope: THREE.Mesh;
  readonly hook: THREE.Group;
  heading = 0;
  pitch = 0;
  roll = 0;
  leg: Leg = 'inbound';
  held: Held | null = null;
  busy = false;
  line = 0;
  floorY = 0;
  lifted = false;
  age = 0;
  hum: LoopHandle | null = null;
  winch: LoopHandle | null = null;

  constructor(materials: ModelMaterials, scene: THREE.Scene, rope: THREE.Mesh, hook: THREE.Group) {
    this.frame = new Airframe(materials, scene, DRONE);
    this.rope = rope;
    this.hook = hook;
    rope.visible = hook.visible = false;
    scene.add(rope, hook);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Airlift {
  readonly held: Held[] = [];
  private readonly drones: Drone[] = [];
  private kit: { materials: ModelMaterials; rope: THREE.BufferGeometry; ropeMat: THREE.Material; ring: THREE.BufferGeometry; link: THREE.BufferGeometry; steel: THREE.Material } | null = null;

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

  /** Hands behind his back and the cuffs on. Called with him already out of the player's hands. */
  cuff(s: Soldier): void {
    const { ctx } = this.w;
    const e = s.e;
    const kit = this.prepare();
    s.cuffed = true;
    s.led = false;
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
    this.held.push({ c: new Capture(s), pad: new THREE.Vector3(), padded: false, tries: 0, cuffs, clicks: 0 });
    ctx.hud.feed('PRISONER CUFFED: DRONE INBOUND', FEED_COLOR);
    ctx.events.emit('prisoner:cuffed', { enemy: e });
  }

  update(dt: number): void {
    for (let i = this.held.length - 1; i >= 0; i--) {
      const h = this.held[i]!;
      h.c.step(dt);
      this.cuffing(h);
      if (h.c.phase === 'cuffed' && !h.padded && h.tries < PAD_TRIES && !h.c.s.e.airborne) this.findPad(h);
      this.placeCuffs(h);
    }
    for (const h of this.held) if (h.c.waiting && h.padded && this.flying < MAX_DRONES) this.dispatch(h);
    for (const d of this.drones) if (d.busy) this.fly(d, dt);
  }

  /** A body that has left the round, for any reason: killed, or carried off. */
  gone(s: Soldier): void {
    const i = this.held.findIndex(h => h.c.s === s);
    if (i < 0) return;
    const h = this.held[i]!;
    this.held.splice(i, 1);
    h.cuffs.removeFromParent();
    for (const d of this.drones) if (d.held === h) this.letGo(d);
  }

  reset(): void {
    for (const h of this.held) h.cuffs.removeFromParent();
    this.held.length = 0;
    for (const d of this.drones) this.park(d);
  }

  // -------------------------------------------------------------------------------------------
  // The man
  // -------------------------------------------------------------------------------------------

  private cuffing(h: Held): void {
    const { c } = h;
    if (c.phase !== 'cuffing' || h.clicks >= 2 || c.t < CLICK_AT + h.clicks * CLICK_GAP) return;
    h.clicks++;
    h.cuffs.visible = true;
    this.w.ctx.audio.play('cuff_click', { position: c.s.e.center, pitch: h.clicks === 1 ? 1 : 1.12 });
  }

  /** Steel on both wrists and the link between them, wherever his hands have got to. */
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

  /**
   * Open sky over `p`: nothing over his head for the line, and nothing round the column from rotor height up for the drone. A wall
   * beside him lower than the rotors is no matter; one that reaches them is, as a ray started inside it says.
   */
  private openSky(p: THREE.Vector3): boolean {
    const { physics } = this.w.ctx;
    // Three rays for the line, so a beam across the top of him is not missed.
    for (let i = 0; i < 7; i++) {
      const line = i < 3;
      const a = line ? (i / 3) * TAU : ((i - 3) / 4) * TAU;
      const r = line ? 0.4 : COLUMN;
      _c.set(p.x + Math.cos(a) * r, p.y + (line ? 0.4 : ROTORS), p.z + Math.sin(a) * r);
      if (physics.raycast(_c, UP, line ? SKY : SKY - ROTORS, CG.World | CG.Air)) return false;
    }
    return true;
  }

  /** Where the drone can reach him: here, or the nearest open floor a route gets him to. */
  private findPad(h: Held): void {
    const s = h.c.s;
    const e = s.e;
    h.tries++;
    if (this.openSky(e.position)) {
      h.pad.copy(e.position);
      h.padded = true;
      return;
    }
    const { nav } = this.w.ctx.world;
    for (let r = 3; r <= 24; r += 3) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        _f.set(e.position.x + Math.cos(a) * r, e.position.y, e.position.z + Math.sin(a) * r);
        if (!nav.nearest(_f, 2, _f) || !this.openSky(_f) || !this.o.routeTo(s, _f)) continue;
        this.walk(h, _f);
        return;
      }
    }
    // shortcut: a man with no open floor in 24 m and no route to a gate stays where he is, cuffed and unpaid; nothing on the maps does this.
    if (this.o.routeToGate(s)) this.walk(h, s.dest);
  }

  private walk(h: Held, to: THREE.Vector3): void {
    const s = h.c.s;
    h.pad.copy(to);
    h.padded = true;
    s.led = true;
    s.e.thinkAt = 0;
    pose(s.e, 'bound');
  }

  /** At his pad and on the floor: the drone may come down to him. */
  private ready(h: Held): boolean {
    const s = h.c.s;
    if (s.led || s.e.airborne || s.downed) return false;
    // He stopped short of it, stuck on something. The next frame looks again from where he is.
    if (s.e.position.distanceTo(h.pad) > 1.5) {
      h.padded = false;
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // The drone
  // -------------------------------------------------------------------------------------------

  private prepare(): NonNullable<Airlift['kit']> {
    if (this.kit) return this.kit;
    const { materials } = this.w.ctx.render;
    const models = new ModelMaterials(this.w.ctx);
    const rope = new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1, true).translate(0, 0.5, 0);
    this.kit = {
      materials: models,
      rope,
      ropeMat: materials.patch(new THREE.MeshStandardMaterial({ color: '#1c1a17', roughness: 0.95 })),
      ring: new THREE.TorusGeometry(0.048, 0.012, 6, 14),
      link: new THREE.BoxGeometry(1, 0.014, 0.014),
      steel: materials.patch(new THREE.MeshStandardMaterial({ color: '#a2a8ae', metalness: 0.85, roughness: 0.3 })),
    };
    return this.kit;
  }

  private build(): Drone {
    const kit = this.prepare();
    const { scene } = this.w.ctx.render;
    // Matte, not the call-ins' polished metal: a working machine, painted to be hard to see against a night sky.
    const matte = this.w.ctx.render.materials.patch(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0.2, roughness: 0.85 }));
    const paint = { group: (b: ModelBuilder) => kit.materials.group(b, matte) } as ModelMaterials;
    const hook = new ModelBuilder()
      .cyl(0.025, 0.025, 0.2, 6, STEEL, { at: [0, 0.1, 0] })
      .box(0.08, 0.06, 0.05, DARK, { at: [0, 0.21, 0] })
      .solid(new THREE.TorusGeometry(0.06, 0.014, 6, 12, Math.PI * 1.35), STEEL, { at: [0.06, 0, 0], rot: [0, 0, Math.PI * 0.85] });
    const d = new Drone(paint, scene, new THREE.Mesh(kit.rope, kit.ropeMat), kit.materials.group(hook));
    this.drones.push(d);
    return d;
  }

  private dispatch(h: Held): void {
    const d = this.drones.find(x => !x.busy) ?? this.build();
    const { ctx } = this.w;
    const player = this.w.player.position;
    d.busy = true;
    d.held = h;
    h.c.drone = true;
    d.leg = 'inbound';
    d.age = d.line = 0;
    d.lifted = false;
    d.floorY = h.pad.y;
    d.top.copy(h.pad).setY(h.pad.y + TOP);
    // In over him from beyond him, as the player sees it, along the first line high over the map that a ray finds clear.
    const start = Math.atan2(h.pad.z - player.z, h.pad.x - player.x);
    let found = false;
    for (let k = 0; k < 8 && !found; k++) {
      const a = start + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 8);
      _f.set(Math.cos(a), 0.32, Math.sin(a)).normalize();
      found = !ctx.physics.raycast(d.top, _f, FAR, CG.World | CG.Air)
        && !ctx.physics.raycast(_c.copy(d.top).setY(d.top.y - SHORT - 2.5), _f, FAR, CG.World | CG.Air);
    }
    if (!found) _f.copy(UP);
    d.far.copy(d.top).addScaledVector(_f, FAR);
    d.pos.copy(d.far);
    d.vel.subVectors(d.top, d.far).setLength(CRUISE);
    d.heading = Math.atan2(-_f.x, -_f.z);
    d.pitch = d.roll = 0;
    d.frame.update(0);
    d.hum = ctx.audio.startLoop('liftdrone_rotor_loop', { position: d.pos, doppler: true, fadeIn: 1.5 }) ?? null;
  }

  /** Flies toward `to`, arriving without overshoot. Returns the distance left. */
  private seek(d: Drone, to: THREE.Vector3, top: number, accel: number, dt: number): number {
    _a.subVectors(to, d.pos);
    const dist = _a.length();
    const speed = Math.min(top, Math.sqrt(1.6 * accel * dist));
    if (dist > 1e-4) _a.multiplyScalar(speed / dist);
    _b.subVectors(_a, d.vel);
    const most = accel * dt;
    if (_b.length() > most) _b.setLength(most);
    d.vel.add(_b);
    d.push.copy(_b).divideScalar(Math.max(dt, 1e-4));
    d.pos.addScaledVector(d.vel, dt);
    return dist;
  }

  private fly(d: Drone, dt: number): void {
    const { player } = this.w;
    const h = d.held;
    d.age += dt;
    if (h && h.c.phase === 'hooked' && this.offHook(d, h)) return;
    const hover = _w.set(h ? h.c.s.e.position.x : d.pos.x, d.floorY + HOVER + Math.sin(d.age * 4.1) * 0.06, h ? h.c.s.e.position.z : d.pos.z);
    switch (d.leg) {
      case 'inbound':
        if (this.seek(d, d.top, CRUISE, 8, dt) < 2.5) d.leg = 'descend';
        break;
      case 'descend': {
        if (!h) {
          d.leg = 'climb';
          break;
        }
        const ready = this.ready(h);
        if (!ready) hover.set(h.pad.x, hover.y, h.pad.z);
        if (this.seek(d, hover, 8, 5, dt) < 0.4 && ready && d.vel.length() < 0.6) this.startLower(d);
        break;
      }
      case 'lower':
        this.seek(d, hover, 1.5, 3, dt);
        if (h) this.lower(d, h, dt);
        else this.reelIn(d, dt);
        break;
      case 'haul':
        hover.set(d.spot.x, d.floorY + HOVER + 2.5, d.spot.z);
        this.seek(d, hover, 1.4, 2.5, dt);
        d.line = Math.max(SHORT, d.line - REEL * dt);
        if (d.line <= SHORT && d.lifted) {
          d.leg = 'climb';
          d.winch?.stop(0.3);
          d.winch = null;
        }
        break;
      case 'climb':
        if (!h) this.reelIn(d, dt);
        if (this.seek(d, _c.set(d.pos.x, d.floorY + TOP, d.pos.z), 7, 3.5, dt) < 1.5) d.leg = 'outbound';
        break;
      case 'outbound':
        if (!h) this.reelIn(d, dt);
        // Past where it came in from, and on up: it has to get out of sight.
        this.seek(d, _c.copy(d.far).sub(d.top).multiplyScalar(2).add(d.top), CRUISE, 6, dt);
        if (d.pos.distanceTo(player.position) > GONE_RANGE) {
          this.finish(d);
          return;
        }
        break;
    }
    if (d.age > LIFETIME) {
      this.finish(d);
      return;
    }
    if (h && h.c.phase === 'hooked') this.hang(d, h, dt);
    this.pose(d, dt);
    this.drawLine(d);
  }

  private startLower(d: Drone): void {
    d.leg = 'lower';
    d.line = 0;
    d.frame.mount('winch', d.bob);
    d.bobVel.copy(d.vel);
    d.winch = this.w.ctx.audio.startLoop('liftdrone_winch_loop', { position: d.pos }) ?? null;
  }

  /** His upper back, where the harness ring is: what the hook goes for and what he hangs from. */
  private harness(h: Held, out: THREE.Vector3): THREE.Vector3 {
    const e = h.c.s.e;
    const chest = e.char.bones[B.chest];
    if (chest) chest.getWorldPosition(out);
    else out.copy(e.center);
    if (out.y <= e.position.y + 0.1) out.copy(e.center);
    return out.addScaledVector(_h.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)), -0.16).setY(out.y + 0.12);
  }

  /** The hook going down on its line, swinging, steered onto his back for the last of it. */
  private lower(d: Drone, h: Held, dt: number): void {
    const target = this.harness(h, _f);
    const win = d.frame.mount('winch', _a);
    const need = win.distanceTo(target);
    d.line = Math.min(d.line + LOWER * dt, need + 0.3);
    this.swing(d, dt);
    if (d.line > need * 0.5) {
      const k = 1 - Math.exp(-3 * dt);
      d.bob.x += (target.x - d.bob.x) * k;
      d.bob.z += (target.z - d.bob.z) * k;
    }
    const e = h.c.s.e;
    if ((d.bob.distanceTo(target) > 0.3 && d.line < need) || e.downed || !h.c.hook()) return;
    d.leg = 'haul';
    d.bob.copy(target);
    d.spot.copy(target);
    d.bobVel.set(0, 0, 0);
    d.lifted = false;
    e.pinned = e.carried = true;
    e.velocity.set(0, 0, 0);
    pose(e, 'bound');
    this.w.ctx.audio.play('cuff_click', { position: target, pitch: 0.72, volume: 1.2 });
  }

  /** A free weight on the line: gravity, a little air, and the line never longer than it is. */
  private swing(d: Drone, dt: number): void {
    d.bobVel.y -= 9.8 * dt;
    d.bobVel.multiplyScalar(Math.exp(-0.5 * dt));
    d.bob.addScaledVector(d.bobVel, dt);
    const win = d.frame.mount('winch', _c);
    _b.subVectors(d.bob, win);
    const len = _b.length();
    if (len <= d.line || len < 1e-4) return;
    _b.divideScalar(len);
    d.bob.copy(win).addScaledVector(_b, d.line);
    const out = d.bobVel.dot(_b);
    if (out > 0) d.bobVel.addScaledVector(_b, -out);
  }

  /** The man on the hook. The line takes his weight off the floor first, then he swings under the drone. */
  private hang(d: Drone, h: Held, dt: number): void {
    const e = h.c.s.e;
    const drop = e.def.chest + 0.12;
    if (!d.lifted) {
      const win = d.frame.mount('winch', _c);
      d.bob.x = e.position.x;
      d.bob.z = e.position.z;
      const over = win.distanceTo(d.bob) - d.line;
      if (over > 0) d.bob.y += over;
      e.position.y = Math.max(d.floorY, d.bob.y - drop);
      if (e.position.y > d.floorY + 0.5) this.secure(d, h);
    } else {
      this.swing(d, dt);
      e.position.set(d.bob.x, d.bob.y - drop, d.bob.z);
      // He turns slowly on the line.
      e.yaw += Math.sin(d.age * 0.7) * 0.35 * dt;
    }
    e.groundY = e.position.y;
    (e.char.anim as { resetFeet?(): void }).resetFeet?.();
  }

  /** Off the floor: paid for, once. */
  private secure(d: Drone, h: Held): void {
    d.lifted = true;
    d.bobVel.set(0, 0, 0);
    const { ctx } = this.w;
    const e = h.c.s.e;
    const wallet: Wallet | null | undefined = ctx.contracts?.defense;
    const paid = h.c.secure(wallet, BOUNTY[h.c.s.rank]);
    if (paid === null) return;
    if (wallet) {
      const text = hitText('BOUNTY SECURED', paid);
      if (text) ctx.hud.floatText(e.center, text, FEED_COLOR);
      ctx.hud.feed(`BOUNTY SECURED +${paid} CREDITS`, FEED_COLOR);
    } else ctx.hud.feed('BOUNTY SECURED', FEED_COLOR);
    ctx.events.emit('prisoner:secured', { enemy: e, bounty: paid });
  }

  /** Shot or knocked off the hook alive: he falls, and waits on the floor for another drone. */
  private offHook(d: Drone, h: Held): boolean {
    const e = h.c.s.e;
    if (e.pinned && !e.downed) return false;
    e.pinned = e.carried = false;
    if (!e.downed) {
      e.airborne = true;
      e.verticalSpeed = 0;
    }
    pose(e, 'cuffed');
    h.c.drop();
    h.padded = false;
    h.tries = 0;
    this.letGo(d);
    return true;
  }

  /** Nobody on the line any more. The drone winds it in and goes home. */
  private letGo(d: Drone): void {
    d.held = null;
    if (d.leg === 'lower' || d.leg === 'haul') d.leg = 'climb';
  }

  private reelIn(d: Drone, dt: number): void {
    d.line = Math.max(0, d.line - REEL * 2 * dt);
    if (d.line > 0) this.swing(d, dt);
    else if (d.winch) {
      d.winch.stop(0.2);
      d.winch = null;
    }
  }

  /** Out of sight. The man is gone from the round: no kill, and the bounty was paid when he left the floor. */
  private finish(d: Drone): void {
    const h = d.held;
    this.park(d);
    if (!h) return;
    const s = h.c.s;
    // Given up on before it had him (he never got out from under a roof): he stays, cuffed, and the next drone tries.
    if (!h.c.leave()) return;
    if (s.e.alive) this.w.enemies.withdraw(s.e);
    else this.gone(s);
  }

  private park(d: Drone): void {
    if (d.held) d.held.c.drone = false;
    d.held = null;
    d.busy = false;
    d.line = 0;
    d.frame.hide();
    d.rope.visible = d.hook.visible = false;
    d.hum?.stop(0.5);
    d.winch?.stop(0.2);
    d.hum = d.winch = null;
  }

  /** Leans into what it is doing, turns to where it is going, and its sound goes with it. */
  private pose(d: Drone, dt: number): void {
    const speed = Math.hypot(d.vel.x, d.vel.z);
    if (speed > 2) d.heading = dampAngle(d.heading, Math.atan2(d.vel.x, d.vel.z), 1.6, dt);
    const fx = Math.sin(d.heading), fz = Math.cos(d.heading);
    // Tilt toward the push and a little into the wind of its own speed.
    const tx = d.push.x * 0.045 + d.vel.x * 0.018;
    const tz = d.push.z * 0.045 + d.vel.z * 0.018;
    d.pitch = damp(d.pitch, clamp(tx * fx + tz * fz, -0.4, 0.4), 5, dt);
    d.roll = damp(d.roll, clamp(-tx * fz + tz * fx, -0.4, 0.4), 5, dt);
    _f.set(fx, -Math.tan(d.pitch), fz);
    d.frame.fly(d.pos, _f, d.roll);
    d.frame.update(dt);
    d.hum?.setPosition(d.pos);
    d.hum?.setPitch(d.held?.c.phase === 'hooked' ? 0.92 : 1, 0.6);
    d.winch?.setPosition(d.pos);
  }

  private drawLine(d: Drone): void {
    const show = d.line > 0.05 && (d.leg === 'lower' || d.leg === 'haul' || d.leg === 'climb' || d.leg === 'outbound');
    d.rope.visible = d.hook.visible = show;
    if (!show) return;
    const win = d.frame.mount('winch', _c);
    _a.subVectors(win, d.bob);
    const len = _a.length();
    if (len < 1e-3) return;
    _a.divideScalar(len);
    _q.setFromUnitVectors(UP, _a);
    d.hook.position.copy(d.bob);
    d.hook.quaternion.copy(_q);
    // The line runs from the top of the hook's shank to the drum.
    d.rope.position.copy(d.bob).addScaledVector(_a, 0.22);
    d.rope.quaternion.copy(_q);
    d.rope.scale.set(1, Math.max(0.01, len - 0.22), 1);
  }
}
