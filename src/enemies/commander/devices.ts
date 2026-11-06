/**
 * Everything the Commander leaves lying around: mines, wires, claymores, cables, decoy beacons, charges, mortar tubes. Each one has a
 * blink and a sound before it does anything, and each one can be shot or blown up, because section 16.5 says a trap that cannot be
 * answered is a cheat.
 *
 * Nothing here is a collider. `weapon:fired` gives the line of a shot and `physics.radialListeners` hears every blast, so a device is
 * a point with a radius and costs the world nothing.
 */
import * as THREE from 'three';
import { CG, type RayHit } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import type { Commander } from './index';

export type DeviceKind = 'mine' | 'tripwire' | 'claymore' | 'snare' | 'beacon' | 'charge' | 'tube';

/** Oldest out past this. Only the tube is spared: it is what the crew stand around. */
const MAX_DEVICES = 28;
const MINE_REACH = 1.5;
const MINE_BLAST = 4.6;
const MINE_DAMAGE = 40;
/** Long enough that a player running at full speed is out of the blast when it goes. */
const MINE_FUSE = 0.55;
/** Above this the player's feet have cleared it. */
const STEP_HEIGHT = 1.1;
const WIRE_REACH = 0.42;
/** A jump clears a wire strung at shin height. */
const WIRE_CLEAR = 0.75;
const WIRE_FUSE = 0.3;
const WIRE_BLAST = 5;
const WIRE_DAMAGE = 34;
const CLAYMORE_REACH = 5.5;
/** Cosine of the half angle of the claymore's fan. */
const CLAYMORE_FAN = 0.72;
const CLAYMORE_FUSE = 0.35;
const CLAYMORE_DAMAGE = 48;
const CLAYMORE_BLAST = 5.5;
/** Metres a second past which a cable takes the legs out. Under it the player steps over and only trips the alarm. */
const SNARE_SPEED = 9;
const SNARE_DAMAGE = 8;
const SNARE_STOP = 0.85;
const SNARE_ALARM = 26;
const CHARGE_BLAST = 5;
const CHARGE_DAMAGE = 42;
const CHARGE_FUSE = 0.7;
/** How close a body has to be for a shot along its line to count. */
const SHOT_RADIUS = 0.5;
/** Inside this the player can hear it. */
const EAR_RANGE = 8;
const BLINK = 1.1;
const BLINK_ON = 0.14;
/** Blink period once the fuse is lit. */
const BLINK_FUSE = 0.12;

const RED = 0xff2a18;
const AMBER = 0xffa400;
const GREEN = 0x4dff6a;
const STEEL = 0x3a4048;
const DARK = 0x1a1e24;
const OLIVE = 0x39452e;
const LED_RED = new THREE.Color(RED).multiplyScalar(6);
const LED_AMBER = new THREE.Color(AMBER).multiplyScalar(5);
const LED_GREEN = new THREE.Color(GREEN).multiplyScalar(4);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

export class Device {
  kind: DeviceKind = 'mine';
  live = false;
  readonly position = new THREE.Vector3();
  /** The far post of a wire. */
  readonly end = new THREE.Vector3();
  /** Which way a claymore looks. */
  readonly facing = new THREE.Vector3(0, 0, 1);
  /** What the blast counts as, for gifts, the gloating and the killed-by line. */
  cause = 'mine';
  /** Proximity reach. 0 means it only goes off when told. */
  reach = 0;
  fuse = 0;
  /** A fuse is burning. */
  lit = false;
  blinkAt = 0;
  tickAt = 0;
  /** Set when the rest of a group has to know, as a rigged room does. */
  group = 0;
  bornAt = 0;
  model: THREE.Object3D | null = null;
  led: THREE.Mesh | null = null;
  /** Second post and the line between them. */
  post: THREE.Object3D | null = null;
  wire: THREE.Mesh | null = null;
  /** The sonar's false man, for a beacon. */
  ghost: THREE.Mesh | null = null;
}

interface Stock {
  model: THREE.Group;
  led: THREE.Mesh;
}

export class Devices {
  readonly live: Device[] = [];
  private readonly spare = new Map<DeviceKind, Stock[]>();
  private readonly spareMast: Stock[] = [];
  private readonly spareWire: THREE.Mesh[] = [];
  private readonly free: Device[] = [];
  private readonly solid: ModelMaterials;
  private readonly ledGeometry = new THREE.SphereGeometry(0.035, 8, 6);
  private readonly wireGeometry = new THREE.CylinderGeometry(0.008, 0.008, 1, 4, 1, true).translate(0, 0.5, 0);
  private readonly wireRed: THREE.MeshBasicMaterial;
  private readonly wireCable: THREE.MeshBasicMaterial;
  private readonly ledRed: THREE.MeshBasicMaterial;
  private readonly ledAmber: THREE.MeshBasicMaterial;
  private readonly ledGreen: THREE.MeshBasicMaterial;
  /** The beacon's false man is drawn only by the X-ray pass. */
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private readonly ghostGeometry = ghostFigure();
  private nextGroup = 1;

  constructor(private readonly c: Commander) {
    const { ctx } = c.w;
    this.solid = new ModelMaterials(ctx);
    const glow = (color: THREE.Color) => new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false });
    this.ledRed = glow(LED_RED);
    this.ledAmber = glow(LED_AMBER);
    this.ledGreen = glow(LED_GREEN);
    this.wireRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(RED).multiplyScalar(2.4), toneMapped: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false });
    this.wireCable = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c0).multiplyScalar(1.6), toneMapped: false, fog: false });
  }

  private stock(kind: DeviceKind): Stock {
    const list = this.spare.get(kind);
    const ready = list?.pop();
    if (ready) return ready;
    const b = new ModelBuilder();
    let led = this.ledRed;
    let ledAt: readonly [number, number, number] = [0, 0.12, 0];
    switch (kind) {
      case 'mine':
        b.cyl(0.19, 0.22, 0.07, 10, OLIVE, { at: [0, 0.035, 0] }).cyl(0.07, 0.09, 0.04, 8, DARK, { at: [0, 0.09, 0] });
        break;
      case 'tripwire':
      case 'snare':
        b.box(0.05, 0.42, 0.05, STEEL, { at: [0, 0.21, 0] }).box(0.1, 0.1, 0.1, DARK, { at: [0, 0.42, 0] });
        ledAt = [0, 0.5, 0];
        break;
      case 'claymore':
        b.box(0.24, 0.14, 0.05, OLIVE, { at: [0, 0.22, 0], rot: [-0.18, 0, 0] })
          .box(0.015, 0.16, 0.015, STEEL, { at: [-0.09, 0.08, 0], rot: [0, 0, 0.2] })
          .box(0.015, 0.16, 0.015, STEEL, { at: [0.09, 0.08, 0], rot: [0, 0, -0.2] });
        led = this.ledGreen;
        ledAt = [0.08, 0.31, 0.02];
        break;
      case 'beacon':
        b.box(0.26, 0.15, 0.2, DARK, { at: [0, 0.075, 0] }).box(0.02, 0.62, 0.02, STEEL, { at: [0.08, 0.42, 0.06] }).box(0.1, 0.04, 0.02, STEEL, { at: [-0.04, 0.17, -0.06] });
        led = this.ledAmber;
        ledAt = [0.08, 0.76, 0.06];
        break;
      case 'charge':
        b.box(0.3, 0.12, 0.2, 0x63583e, { at: [0, 0.06, 0] }).box(0.07, 0.04, 0.05, DARK, { at: [0.06, 0.14, 0.02] }).box(0.32, 0.02, 0.02, 0xa02818, { at: [0, 0.07, 0.11] });
        ledAt = [0.06, 0.19, 0.02];
        break;
      case 'tube':
        b.cyl(0.42, 0.46, 0.06, 10, DARK, { at: [0, 0.03, 0] })
          .cyl(0.065, 0.075, 1.3, 10, OLIVE, { at: [0, 0.68, 0.24], rot: [-0.42, 0, 0] })
          .box(0.03, 0.74, 0.03, STEEL, { at: [0.18, 0.37, 0.28], rot: [0.32, 0, -0.1] })
          .box(0.03, 0.74, 0.03, STEEL, { at: [-0.18, 0.37, 0.28], rot: [0.32, 0, 0.1] })
          .box(0.52, 0.22, 0.32, 0x45503a, { at: [0.9, 0.11, -0.2], rot: [0, 0.4, 0] })
          .box(0.52, 0.22, 0.32, 0x45503a, { at: [0.82, 0.33, -0.18], rot: [0, 0.2, 0] });
        ledAt = [0, 0.1, -0.3];
        break;
    }
    const model = this.solid.group(b);
    const lamp = new THREE.Mesh(this.ledGeometry, led);
    lamp.position.set(ledAt[0], ledAt[1], ledAt[2]);
    model.add(lamp);
    if (kind === 'tube') lamp.scale.setScalar(0);
    model.visible = false;
    this.c.w.ctx.render.scene.add(model);
    return { model, led: lamp };
  }

  private shelve(kind: DeviceKind, stock: Stock): void {
    stock.model.visible = false;
    let list = this.spare.get(kind);
    if (!list) this.spare.set(kind, (list = []));
    list.push(stock);
  }

  private add(kind: DeviceKind, at: THREE.Vector3, cause: string, reach: number): Device {
    if (this.live.length >= MAX_DEVICES) {
      const i = this.live.findIndex(d => d.kind !== 'tube');
      if (i >= 0) this.remove(i);
    }
    const d = this.free.pop() ?? new Device();
    const stock = this.stock(kind);
    d.kind = kind;
    d.live = true;
    d.position.copy(at);
    d.end.copy(at);
    d.cause = cause;
    d.reach = reach;
    d.fuse = 0;
    d.lit = false;
    d.group = 0;
    d.bornAt = this.c.w.now;
    d.blinkAt = this.c.w.now + rand(0, BLINK);
    d.tickAt = 0;
    d.model = stock.model;
    d.led = stock.led;
    stock.model.position.copy(at);
    stock.model.rotation.set(0, rand(0, 6.28), 0);
    stock.model.visible = true;
    this.live.push(d);
    return d;
  }

  mine(at: THREE.Vector3): Device {
    return this.add('mine', at, 'mine', MINE_REACH);
  }

  private wired(kind: 'tripwire' | 'snare', a: THREE.Vector3, b: THREE.Vector3, cause: string, material: THREE.Material): Device {
    const d = this.add(kind, a, cause, 0);
    d.end.copy(b);
    d.end.y = a.y;
    const post = this.spareMast.pop() ?? this.stock(kind);
    post.model.position.copy(d.end);
    post.model.visible = true;
    d.post = post.model;
    const wire = this.spareWire.pop() ?? new THREE.Mesh(this.wireGeometry);
    wire.material = material;
    _a.subVectors(d.end, a);
    const length = _a.length();
    wire.position.copy(a);
    wire.position.y += 0.34;
    wire.quaternion.setFromUnitVectors(_b.set(0, 1, 0), _a.normalize());
    wire.scale.set(1, length, 1);
    wire.visible = true;
    if (!wire.parent) this.c.w.ctx.render.scene.add(wire);
    d.wire = wire;
    return d;
  }

  tripwire(a: THREE.Vector3, b: THREE.Vector3): Device {
    return this.wired('tripwire', a, b, 'tripwire', this.wireRed);
  }

  snare(a: THREE.Vector3, b: THREE.Vector3): Device {
    return this.wired('snare', a, b, 'snare', this.wireCable);
  }

  /** `facing` is where it will spray: toward the ground the player comes from. */
  claymore(at: THREE.Vector3, facing: THREE.Vector3): Device {
    const d = this.add('claymore', at, 'claymore', CLAYMORE_REACH);
    d.facing.copy(facing).setY(0).normalize();
    d.model!.rotation.set(0, Math.atan2(d.facing.x, d.facing.z), 0);
    return d;
  }

  beacon(at: THREE.Vector3): Device {
    const d = this.add('beacon', at, 'beacon', 0);
    const ghost = new THREE.Mesh(this.ghostGeometry, this.ghostMaterial);
    ghost.position.copy(at);
    ghost.position.x += rand(-0.8, 0.8);
    ghost.position.z += rand(-0.8, 0.8);
    ghost.rotation.y = rand(0, 6.28);
    this.c.w.ctx.render.scene.add(ghost);
    d.ghost = ghost;
    return d;
  }

  /** A block of explosive. `reach` 0 leaves it to whoever placed it. */
  charge(at: THREE.Vector3, cause: string, reach: number): Device {
    return this.add('charge', at, cause, reach);
  }

  tube(at: THREE.Vector3, facing: number): Device {
    const d = this.add('tube', at, 'tube', 0);
    d.model!.rotation.set(0, facing, 0);
    return d;
  }

  newGroup(): number {
    return this.nextGroup++;
  }

  private remove(index: number): void {
    const d = this.live[index]!;
    this.live.splice(index, 1);
    d.live = false;
    if (d.model) this.shelve(d.kind, { model: d.model as THREE.Group, led: d.led! });
    if (d.post) {
      d.post.visible = false;
      this.spareMast.push({ model: d.post as THREE.Group, led: d.post.children[d.post.children.length - 1] as THREE.Mesh });
    }
    if (d.wire) {
      d.wire.visible = false;
      this.spareWire.push(d.wire);
    }
    d.ghost?.removeFromParent();
    d.model = d.post = d.wire = d.ghost = d.led = null;
    this.free.push(d);
  }

  /** Lights the fuse. A fuse already burning keeps its time. */
  trigger(d: Device, fuse: number): void {
    if (d.lit) return;
    d.lit = true;
    d.fuse = fuse;
    const { audio } = this.c.w.ctx;
    audio.play('grenade_pin', { position: d.position, pitch: 1.5, volume: 0.9 });
  }

  /** Removes it with no blast: shot apart, or a run ending. */
  disarm(d: Device): void {
    const i = this.live.indexOf(d);
    if (i >= 0) this.remove(i);
  }

  /** It goes off now. */
  detonate(d: Device): void {
    const c = this.c;
    const i = this.live.indexOf(d);
    if (i < 0) return;
    _a.copy(d.position);
    const kind = d.kind;
    const cause = d.cause;
    if (kind === 'claymore') _a.addScaledVector(d.facing, 1.5);
    this.remove(i);
    switch (kind) {
      case 'mine': c.boom(_a, MINE_BLAST, MINE_DAMAGE, cause); break;
      case 'tripwire': c.boom(_a, WIRE_BLAST, WIRE_DAMAGE, cause); break;
      case 'claymore': c.boom(_a, CLAYMORE_BLAST, CLAYMORE_DAMAGE, cause); break;
      case 'charge': c.boom(_a, CHARGE_BLAST, CHARGE_DAMAGE, cause); break;
      default: break;
    }
  }

  update(): void {
    const { w } = this.c;
    const now = w.now;
    const dt = w.ctx.time.dt;
    const p = w.player;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i]!;
      this.blink(d, now);
      if (d.lit) {
        d.fuse -= dt;
        if (d.fuse <= 0) this.detonate(d);
        continue;
      }
      if (d.kind === 'tube' || d.kind === 'beacon' || !p.alive) continue;
      this.listen(d, now);
      switch (d.kind) {
        case 'mine':
          if (near(d.position, p.position, d.reach, STEP_HEIGHT)) this.trigger(d, MINE_FUSE);
          break;
        case 'charge':
          if (d.reach > 0 && near(d.position, p.position, d.reach, STEP_HEIGHT * 2)) this.trigger(d, CHARGE_FUSE);
          break;
        case 'tripwire':
          if (this.crossing(d)) this.trigger(d, WIRE_FUSE);
          break;
        case 'snare':
          if (this.crossing(d)) this.spring(d);
          break;
        case 'claymore':
          if (this.inFan(d)) this.trigger(d, CLAYMORE_FUSE);
          break;
      }
    }
  }

  private blink(d: Device, now: number): void {
    const led = d.led;
    if (!led) return;
    if (d.lit) {
      led.visible = Math.floor(now / BLINK_FUSE) % 2 === 0;
      return;
    }
    if (now >= d.blinkAt) d.blinkAt = now + BLINK;
    led.visible = d.blinkAt - now > BLINK - BLINK_ON;
    if (d.post) d.post.children[d.post.children.length - 1]!.visible = led.visible;
  }

  /** Ticks faster as the player closes, so a trap can be found with the eyes shut. */
  private listen(d: Device, now: number): void {
    const dist = d.position.distanceTo(this.c.w.player.position);
    if (dist > EAR_RANGE || now < d.tickAt) return;
    d.tickAt = now + 0.25 + 0.9 * clamp(dist / EAR_RANGE);
    this.c.w.ctx.audio.play('bomber_beep', { position: d.position, volume: 0.25, pitch: d.kind === 'charge' ? 1.2 : 1.7 });
  }

  /** Feet near the line between the posts, and not over it. */
  private crossing(d: Device): boolean {
    const p = this.c.w.player.position;
    if (p.y - d.position.y > WIRE_CLEAR || p.y - d.position.y < -1) return false;
    const ax = d.end.x - d.position.x, az = d.end.z - d.position.z;
    const t = clamp(((p.x - d.position.x) * ax + (p.z - d.position.z) * az) / (ax * ax + az * az));
    return Math.hypot(d.position.x + ax * t - p.x, d.position.z + az * t - p.z) < WIRE_REACH;
  }

  private spring(d: Device): void {
    const { ctx, player } = this.c.w;
    const c = this.c;
    if (player.speed < SNARE_SPEED) {
      ctx.audio.play('metal_clang', { position: d.position, volume: 0.8 });
      c.o.noise(d.position, SNARE_ALARM);
    } else {
      ctx.audio.play('metal_clang', { position: d.position, pitch: 0.7 });
      ctx.camera.addTrauma(0.6);
      _a.copy(ctx.player.velocity).multiplyScalar(-SNARE_STOP);
      ctx.player.push(_a);
      c.hurt(SNARE_DAMAGE, d.position, d.cause);
    }
    this.disarm(d);
  }

  private inFan(d: Device): boolean {
    const p = this.c.w.player;
    _a.subVectors(p.position, d.position).setY(0);
    const dist = _a.length();
    if (dist > d.reach || dist < 0.01 || Math.abs(p.position.y - d.position.y) > 2) return false;
    return _a.multiplyScalar(1 / dist).dot(d.facing) > CLAYMORE_FAN;
  }

  /** A round down the line of `dir`. Mines and charges go off. Beacons die quietly. */
  onShot(origin: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.live.length === 0) return;
    let best: Device | null = null;
    let bestD = Infinity;
    for (const d of this.live) {
      if (d.kind === 'tube') continue;
      const t = this.along(d.position, origin, dir);
      const u = d.post ? this.along(d.end, origin, dir) : Infinity;
      const closest = Math.min(t, u);
      if (closest < bestD) {
        bestD = closest;
        best = d;
      }
    }
    if (!best || bestD === Infinity) return;
    const { physics, fx } = this.c.w.ctx;
    if (physics.raycastInto(origin, dir, bestD, CG.World, _hit)) return;
    if (best.kind === 'beacon' || best.kind === 'snare') {
      fx.sparks(best.position, dir, 12, 0xffd0a0);
      this.c.w.ctx.audio.play('metal_clang', { position: best.position, volume: 0.7, pitch: 1.6 });
      this.disarm(best);
    } else this.detonate(best);
  }

  /** Distance along the shot to the point nearest `p`, or Infinity if the shot misses it. */
  private along(p: THREE.Vector3, origin: THREE.Vector3, dir: THREE.Vector3): number {
    _b.copy(p);
    _b.y += 0.15;
    _a.subVectors(_b, origin);
    const t = _a.dot(dir);
    if (t < 0) return Infinity;
    return _a.lengthSq() - t * t < SHOT_RADIUS * SHOT_RADIUS ? t : Infinity;
  }

  /** Any blast in the world. A live charge next to it goes too, a beat later, and a beacon or a tube is scrap. */
  onBlast(center: THREE.Vector3, radius: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i]!;
      if (d.lit || d.position.distanceTo(center) > radius) continue;
      if (d.kind === 'beacon' || d.kind === 'snare') this.disarm(d);
      else if (d.kind === 'tube') {
        this.c.mortars.tubeLost(d);
        this.disarm(d);
      } else this.trigger(d, 0.12);
    }
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.remove(i);
  }

  count(kind: DeviceKind): number {
    let n = 0;
    for (const d of this.live) if (d.kind === kind) n++;
    return n;
  }
}

const near = (a: THREE.Vector3, b: THREE.Vector3, reach: number, height: number): boolean => {
  if (Math.abs(a.y - b.y) > height) return false;
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz < reach * reach;
};

/** A man-shaped lump. It only ever shows as a red silhouette, so a torso, a head and two legs are all it needs. */
function ghostFigure(): THREE.BufferGeometry {
  const b = new ModelBuilder()
    .cyl(0.2, 0.17, 0.62, 8, 0xffffff, { at: [0, 1.15, 0] })
    .solid(new THREE.SphereGeometry(0.13, 8, 6), 0xffffff, { at: [0, 1.62, 0] })
    .cyl(0.09, 0.07, 0.85, 6, 0xffffff, { at: [-0.1, 0.42, 0] })
    .cyl(0.09, 0.07, 0.85, 6, 0xffffff, { at: [0.1, 0.42, 0] })
    .cyl(0.06, 0.05, 0.6, 6, 0xffffff, { at: [-0.27, 1.12, 0.06], rot: [-0.2, 0, -0.1] })
    .cyl(0.06, 0.05, 0.6, 6, 0xffffff, { at: [0.27, 1.12, 0.06], rot: [-0.2, 0, 0.1] });
  return b.solidGeometry()!;
}
