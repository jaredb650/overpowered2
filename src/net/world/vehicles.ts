/**
 * The host's ground vehicles (humvees, trucks, tanks) on guests: the host sends where each is every SEND_MS, stamped with its
 * clock, and a guest draws each a little in the past between two of those states (motion.ts, as the enemies are), whatever
 * the frame rate. They are hurt only on the host (a guest's rounds and blasts reach them through vehicleHits.ts).
 *
 * The copy is a working machine, not a statue (lane world-b). Each state also carries what its parts are doing (`x`, from
 * `GroundVehicle.wire`): the wheels turn with its speed and steer, the tracks run, the body rides its springs, the main gun
 * lifts, the roof gun swings and kicks while it fires, a thrown track is gone, an engine or a fuel fire burns, and its engine
 * is heard. Its guns' flashes, shots and sounds are the enemy-attacks lane's (they arrive at the muzzle in the world).
 *
 * When one dies the host says so once (`wreck`): the guest's copy becomes the same wreck (enemies/vehicles/wreck.ts, as a
 * `ghost`: it hops, lands, burns and smokes there, and a tank's turret is thrown the same way), on colliders of its own, so it
 * is cover on every screen. A wreck the host clears goes everywhere, and a player who arrives late gets every wreck standing.
 */
import * as THREE from 'three';
import { damp, dampAngle } from '../../core/math';
import type { EmitterHandle } from '../../core/contracts';
import type RAPIER from '@dimforge/rapier3d-compat';
import { EngineSound } from '../../progression/callins/airframe';
import type { Gun } from '../../vehicles/guns';
import { VEHICLES, type GroundDef } from '../../enemies/vehicles/data';
import { pintleOf, WIRE, type GroundVehicle } from '../../enemies/vehicles/ground';
import type { VehicleSystem } from '../../enemies/vehicles';
import { PINTLE_GUN, TRUNNION, type GroundModel } from '../../enemies/vehicles/models';
import { GROUND_ENGINES } from '../../enemies/vehicles/sounds';
import type { Vehicle } from '../../enemies/vehicles/vehicle';
import { Wreck, type Flung } from '../../enemies/vehicles/wreck';
import type { WorldContext, WorldModule } from './context';
import { HostClock, MotionBuffer, motionSample } from './motion';
import type { Replicas } from './replicas';
import { validVec, type Vec } from './wire';

type Quat = [number, number, number, number];
type Ground = 'humvee' | 'truck' | 'tank';

export type VehiclesEvent =
  /**
   * Host: the trucks, humvees and tanks, 5 Hz, and the host's clock (ms) when they were read. Drawn on guests; hurt only on the
   * host. `x` is what the parts are doing (`GroundVehicle.wire`): [speed, wheel angle, body pitch, body roll, gun lift, roof gun
   * yaw, roof gun pitch, flags].
   */
  | { t: 'vehicles'; at?: number; list: { id: number; kind: string; p: Vec; q: Quat; turret: number; x?: number[] }[] }
  /**
   * Host: a vehicle died and this is its wreck (`add`, numbered `wid`; `id` is the vehicle it was), or a wreck was cleared (`gone`).
   * `r` is the hull's rotation at rest and `body` its slump; `hop` and `tumble` are how it leaves the ground (absent: already
   * lying there, and `burn` seconds of fire left); `flung` is a thrown turret: its velocity, spin and floor, or with `at` and
   * `rot` where it already lies.
   */
  | { t: 'wreck'; op: 'add'; wid: number; id: number; kind: string; p: Vec; r: Vec; body: Vec; turret: number; burn: number; hop?: number; tumble?: Vec;
      flung?: { v: Vec; spin: Vec; floor: number; at?: Vec; rot?: Vec } }
  | { t: 'wreck'; op: 'gone'; wid: number };

const SEND_MS = 200;
const GROUND: readonly string[] = ['humvee', 'truck', 'tank'];
const _q = new THREE.Quaternion();
const _pivot = new THREE.Vector3();
const _at = new THREE.Vector3();
const _half = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const vec = (v: THREE.Vector3 | THREE.Euler): Vec => [v.x, v.y, v.z];

/** A guest's copy of one vehicle: the model, where it is going, and what its parts are doing. */
interface Puppet {
  model: GroundModel;
  motion: MotionBuffer;
  kind: string;
  /** The host's latest word on its parts, and what is drawn now (eased toward it). */
  want: number[];
  speed: number;
  wheel: number;
  pitch: number;
  roll: number;
  lift: number;
  gunYaw: number;
  gunPitch: number;
  travelled: number;
  gun: Gun | null;
  kick: number;
  engine: EngineSound | null;
  fires: { engine: EmitterHandle[]; fuel: EmitterHandle[] };
}

interface GuestWreck { wreck: Wreck; flung: THREE.Object3D | null }

export class Vehicles implements WorldModule {
  /** Host: an id for each vehicle; guest: the drawn copies. */
  private readonly ids = new WeakMap<Vehicle, number>();
  private serial = 0;
  private next = 0;
  private sent = false;
  private readonly puppets = new Map<number, Puppet>();
  /** Host: each vehicle's id by its model, and each wreck's number; guest: the wrecks standing here. */
  private readonly roots = new WeakMap<THREE.Object3D, { id: number; kind: string }>();
  private readonly wreckIds = new Map<Wreck, number>();
  private wreckSerial = 0;
  private readonly wrecks = new Map<number, GuestWreck>();
  private readonly extra: number[] = [];
  /** Guest: the host's clock from these events alone, used until the enemies' lane (many more packets) has a better one. */
  private readonly clock = new HostClock();
  private readonly sample = motionSample();
  private lastFrame = 0;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas) {
    w.router.guest('vehicles', (value, _from, now) => this.draw(value, now));
    w.router.guest('wreck', value => { if (value.op === 'add') this.wreckIn(value); else this.wreckGone(value.wid); });
  }

  private get system(): VehicleSystem | null {
    return (this.w.ctx.enemies.vehicles as VehicleSystem | null | undefined) ?? null;
  }
  /** Guest: the wrecks standing here, by the host's number (for the proofs). */
  get wreckCount(): number { return this.wrecks.size; }
  /** Guest: one drawn vehicle's parts as they stand now (for the proofs). */
  parts(id: number): { speed: number; wheelTurn: number; roofGun: boolean; flags: number; lift: number; tracks: boolean[] } | null {
    const p = this.puppets.get(id);
    return p ? { speed: p.speed, wheelTurn: p.model.wheels[0]?.part.rotation.x ?? p.travelled, roofGun: !!p.gun, flags: p.want[7] ?? 0, lift: p.lift,
      tracks: p.model.tracks.map(t => t.belt.visible) } : null;
  }

  /** Guest: each drawn vehicle with the host's id for it (vehicleHits.ts gives them hit boxes). */
  each(visit: (id: number, kind: string, root: THREE.Object3D, turret: number) => void): void {
    for (const [id, puppet] of this.puppets) visit(id, puppet.kind, puppet.model.root, puppet.model.turret?.rotation.y ?? 0);
  }
  /** Guest: the host has sent no vehicle. */
  get none(): boolean { return this.puppets.size === 0; }
  /** Host: the live vehicle the guests know as `id` (claims.ts applies a guest's round to it). */
  find(id: number): Vehicle | undefined {
    const live = (this.w.ctx.enemies.vehicles as unknown as { live?: Vehicle[] } | undefined)?.live;
    return live?.find(vehicle => this.ids.get(vehicle) === id);
  }

  update(now: number): void {
    if (!this.w.hosting) return;
    if (now >= this.next) { this.next = now + SEND_MS; this.send(); }
    this.hostWrecks();
  }

  /** Host: where every truck, humvee and tank is, for the guests to draw. */
  private send(): void {
    const live = (this.w.ctx.enemies.vehicles as unknown as { live?: Vehicle[] } | undefined)?.live;
    if (!live?.length && !this.sent) return;
    this.sent = !!live?.length;
    const list = (live ?? []).filter(v => v.alive && ['humvee', 'truck', 'tank'].includes(v.def.kind)).slice(0, 16).map(v => {
      let id = this.ids.get(v);
      if (id === undefined) this.ids.set(v, id = ++this.serial);
      const g = v as unknown as Partial<GroundVehicle>;
      if (g.modelRoot) this.roots.set(g.modelRoot, { id, kind: v.def.kind });
      const x = g.wire ? g.wire(this.extra).map(n => Math.round(n * 1000) / 1000) : undefined;
      return { id, kind: v.def.kind, p: v.position.toArray() as Vec, q: v.quaternion.toArray() as [number, number, number, number],
        turret: (v as unknown as { turretYaw?: number }).turretYaw ?? 0, ...(x ? { x } : {}) };
    });
    this.w.send({ t: 'vehicles', at: Math.round(performance.now()), list });
  }

  /** Guest: the host's vehicles as models only; each state goes into its vehicle's buffer. */
  private draw(value: Extract<VehiclesEvent, { t: 'vehicles' }>, now: number): void {
    if (!Array.isArray(value.list)) return;
    // The host's stamp; from a host that sent none, the time it came (the same timeline, a little rougher).
    const stamped = typeof value.at === 'number' && Number.isFinite(value.at);
    const t = stamped ? value.at! : now;
    if (stamped) this.clock.observe(t, now); else this.clock.observe(now, now);
    const fleet = (this.w.ctx.enemies.vehicles as unknown as { fleet?: { ground(kind: string): GroundModel } } | undefined)?.fleet;
    const seen = new Set<number>();
    for (const v of value.list.slice(0, 16)) {
      if (!v || !Number.isInteger(v.id) || !['humvee', 'truck', 'tank'].includes(v.kind) || !validVec(v.p) || !Array.isArray(v.q) || v.q.length !== 4 || !v.q.every(Number.isFinite)) continue;
      seen.add(v.id);
      let puppet = this.puppets.get(v.id);
      if (!puppet || puppet.kind !== v.kind) {
        if (!fleet) continue;
        if (puppet) this.retire(puppet, true);
        const model = fleet.ground(v.kind as Ground);
        model.root.position.fromArray(v.p);
        model.root.quaternion.fromArray(v.q).normalize();
        for (const wheel of model.steered ?? []) wheel.rotation.order = 'YXZ';
        puppet = { model, motion: new MotionBuffer(), kind: v.kind, want: [], speed: 0, wheel: 0, pitch: 0, roll: 0, lift: 0, gunYaw: 0, gunPitch: 0,
          travelled: 0, gun: null, kick: 0, engine: null, fires: { engine: [], fuel: [] } };
        puppet.motion.interval = SEND_MS;
        this.puppets.set(v.id, puppet);
      }
      if (Array.isArray(v.x) && v.x.length === 8 && v.x.every(Number.isFinite)) {
        // A copy that has just appeared stands as the host's does, without easing in from nothing.
        if (puppet.want.length === 0) [puppet.speed, puppet.wheel, puppet.pitch, puppet.roll, puppet.lift, puppet.gunYaw, puppet.gunPitch] = v.x as [number, number, number, number, number, number, number];
        puppet.want = v.x;
      }
      // Where it is, its turret as the buffer's yaw (turned the short way), and its attitude in the four tags.
      puppet.motion.place(t, v.p[0], v.p[1], v.p[2], Number.isFinite(v.turret) ? v.turret : 0, v.q[0], v.q[1], v.q[2], v.q[3]);
      puppet.model.root.visible = true;
    }
    for (const [id, puppet] of this.puppets) if (!seen.has(id)) { this.retire(puppet, true); this.puppets.delete(id); }
  }

  /** Guest: a copy stops being a live vehicle: its gun goes back on the rack, its engine and fires stop. `gone` takes the model too. */
  private retire(puppet: Puppet, gone: boolean): void {
    if (puppet.gun) this.system?.guns.put(puppet.gun);
    puppet.gun = null;
    puppet.engine?.stop(gone ? 0.3 : 1.2);
    puppet.engine = null;
    for (const e of [...puppet.fires.engine, ...puppet.fires.fuel]) e.stop();
    puppet.fires.engine.length = puppet.fires.fuel.length = 0;
    if (gone) puppet.model.root.removeFromParent();
  }

  /** Guest, each frame: the parts of one copy, eased toward the host's last word on them. `dt` in seconds. */
  private work(puppet: Puppet, dt: number): void {
    const { model, want, kind } = puppet;
    if (want.length !== 8) return;
    const def = VEHICLES[kind as Ground] as GroundDef;
    const flags = want[7]!;
    puppet.speed = damp(puppet.speed, want[0]!, 8, dt);
    puppet.wheel = damp(puppet.wheel, want[1]!, 10, dt);
    puppet.pitch = damp(puppet.pitch, want[2]!, 10, dt);
    puppet.roll = damp(puppet.roll, want[3]!, 10, dt);
    puppet.lift = damp(puppet.lift, want[4]!, 10, dt);
    // As the host poses it (GroundVehicle.pose): the body on its springs, the wheels by the road run, the tracks' links swapping.
    model.body.rotation.set(puppet.pitch, 0, puppet.roll);
    model.body.position.y = Math.abs(puppet.pitch) * def.halfLength * 0.4;
    const step = puppet.speed * dt;
    puppet.travelled += step;
    for (const wheel of model.wheels) wheel.part.rotation.x += step / wheel.part.position.y;
    for (const wheel of model.steered) wheel.rotation.y = puppet.wheel;
    const link = Math.floor(puppet.travelled / 0.25) & 1;
    model.tracks.forEach((track, i) => {
      const on = !(flags & (i === 0 ? WIRE.trackLeft : WIRE.trackRight));
      track.belt.visible = on;
      track.links[0].visible = on && link === 0;
      track.links[1].visible = on && link === 1;
    });
    if (model.barrel) {
      model.barrel.rotation.x = -puppet.lift;
      model.barrel.position.z = TRUNNION[2];
    }
    model.root.updateMatrixWorld();
    // The roof gun: the same gun model, swung where the host's points, kicking at its rate while the host's fires.
    const system = this.system;
    if ((flags & WIRE.roofGun) && system) {
      if (!puppet.gun) { puppet.gun = system.guns.get(PINTLE_GUN); puppet.gunYaw = want[5]!; puppet.gunPitch = want[6]!; puppet.gun.snap(puppet.gunYaw, puppet.gunPitch); }
      puppet.gunYaw = dampAngle(puppet.gunYaw, want[5]!, 12, dt);
      puppet.gunPitch = damp(puppet.gunPitch, want[6]!, 12, dt);
      pintleOf(kind as Ground, model.root, model.turret?.rotation.y ?? 0, _pivot);
      puppet.gun.point(_pivot, puppet.gunYaw, puppet.gunPitch, dt);
      if (flags & WIRE.firing) {
        puppet.kick -= dt;
        if (puppet.kick <= 0) { puppet.kick = 1 / def.mount.rate; puppet.gun.recoil(0.05); }
      }
    } else if (puppet.gun) { system?.guns.put(puppet.gun); puppet.gun = null; }
    // What burns on the host burns here (GroundVehicle.broke and take).
    const { fx } = this.w.ctx;
    const burn = (list: EmitterHandle[], on: boolean, light: () => EmitterHandle[]) => {
      if (on && list.length === 0) list.push(...light());
      else if (!on && list.length > 0) { for (const e of list) e.stop(); list.length = 0; }
    };
    burn(puppet.fires.engine, (flags & WIRE.engineFire) !== 0, () => [fx.attachEmitter(model.root, 'burning', _at.set(0, 2.2, -3), 300), fx.attachEmitter(model.root, 'smokeTrail', _at.set(0, 2.4, -3.2), 300)]);
    burn(puppet.fires.fuel, (flags & WIRE.fuelFire) !== 0, () => [fx.attachEmitter(model.root, 'burning', _at.set(0, 1.5, def.halfLength * 0.6), 6)]);
    if (!puppet.engine) { puppet.engine = new EngineSound(this.w.ctx, GROUND_ENGINES[kind as Ground]); puppet.engine.start(1); }
    puppet.engine.update(model.root.position, 1, dt, undefined, 0.8 + 0.5 * Math.abs(puppet.speed) / def.drive.top);
  }

  /** Guest, each frame before the enemies draw: every vehicle where its playhead has it, between two of the host's states. */
  animate(now: number): void {
    const dt = Math.max(0, Math.min(250, now - this.lastFrame));
    this.lastFrame = now;
    const clock = this.replicas.clock.empty ? this.clock : this.replicas.clock;
    if (clock.empty) return;
    const hostNow = clock.now(now), jitter = clock.jitter;
    for (const puppet of this.puppets.values()) {
      const motion = puppet.motion;
      const s = motion.advance(dt, hostNow, jitter, this.sample);
      if (s.mode === 2) continue;
      const root = puppet.model.root;
      root.position.set(s.x, s.y, s.z);
      root.quaternion.set(motion.tag(s.at, 0), motion.tag(s.at, 1), motion.tag(s.at, 2), motion.tag(s.at, 3));
      if (s.k > 0) root.quaternion.slerp(_q.set(motion.tag(s.at + 1, 0), motion.tag(s.at + 1, 1), motion.tag(s.at + 1, 2), motion.tag(s.at + 1, 3)), s.k);
      root.quaternion.normalize();
      if (puppet.model.turret) puppet.model.turret.rotation.y = s.yaw;
      this.work(puppet, dt / 1000);
    }
    if (this.wrecks.size > 0) {
      const seconds = this.w.ctx.time.dt;
      for (const w of this.wrecks.values()) w.wreck.update(seconds);
    }
  }

  // ---- Wrecks ------------------------------------------------------------------------------------------------------

  /** Host: a wreck the vehicle system has made since the last look is told to the guests; one it has cleared, too. */
  private hostWrecks(): void {
    const system = this.system;
    if (!Array.isArray(system?.wrecks)) return;
    for (const wreck of system.wrecks) {
      if (this.wreckIds.has(wreck)) continue;
      this.wreckIds.set(wreck, ++this.wreckSerial);
      if (this.w.ready) this.w.send(this.wreckRow(wreck, false));
    }
    if (this.wreckIds.size > system.wrecks.length) for (const [wreck, wid] of this.wreckIds) {
      if (system.wrecks.includes(wreck)) continue;
      this.wreckIds.delete(wreck);
      if (this.w.ready) this.w.send({ t: 'wreck', op: 'gone', wid });
    }
  }

  private wreckRow(wreck: Wreck, settled: boolean): Extract<VehiclesEvent, { t: 'wreck'; op: 'add' }> {
    const was = this.roots.get(wreck.root);
    const m = wreck.motion();
    const body = (wreck.root.getObjectByName('body') as THREE.Object3D | undefined)?.rotation;
    const piece = m.flung;
    return {
      t: 'wreck', op: 'add', wid: this.wreckIds.get(wreck)!, id: was?.id ?? -1, kind: was?.kind ?? 'chopper', p: vec(wreck.root.position), r: vec(wreck.root.rotation),
      body: body ? vec(body) : [0, 0, 0], turret: 0, burn: Math.max(0, m.burnLeft),
      ...(settled ? {} : { hop: m.hop, tumble: vec(m.tumble) }),
      ...(piece ? { flung: { v: vec(piece.velocity), spin: vec(piece.spin), floor: piece.floor,
        ...(settled || !piece.flying ? { at: vec(piece.mesh.position), rot: vec(piece.mesh.rotation) } : {}) } } : {}),
    };
  }

  /** Host: every wreck standing, for a player who has just arrived: lying where it lies, burning for as long as it has left. */
  catchUp(id: string): void {
    const system = this.system;
    if (!this.w.hosting || !Array.isArray(system?.wrecks)) return;
    this.hostWrecks();
    for (const wreck of system.wrecks) if (this.wreckIds.has(wreck)) this.w.send(this.wreckRow(wreck, true), id);
  }

  /** Guest: the host's wreck. The copy that was driving becomes it; with none (a late arrival), one is put where it lies. */
  private wreckIn(value: Extract<VehiclesEvent, { t: 'wreck'; op: 'add' }>): void {
    const system = this.system;
    const { ctx } = this.w;
    if (!system || !Number.isInteger(value.wid) || this.wrecks.has(value.wid) || !GROUND.includes(value.kind) || ![value.p, value.r, value.body].every(validVec)) return;
    const kind = value.kind as Ground;
    const def = VEHICLES[kind] as GroundDef;
    const settled = typeof value.hop !== 'number' || !validVec(value.tumble);
    let puppet = this.puppets.get(value.id);
    if (puppet && puppet.kind !== kind) puppet = undefined;
    let model: GroundModel;
    if (puppet) {
      this.retire(puppet, false);
      this.puppets.delete(value.id);
      model = puppet.model;
    } else {
      model = system.fleet.ground(kind);
      model.root.visible = true;
    }
    const root = model.root;
    // As it stood when it died on the host, so both wrecks come to rest alike.
    root.position.fromArray(value.p);
    root.rotation.set(value.r[0], value.r[1], value.r[2]);
    root.updateMatrixWorld(true);
    // Its own colliders, where its parts were: cover on this screen too. (The live copy's hit boxes are vehicleHits.ts's and go with it.)
    const colliders: RAPIER.Collider[] = [];
    let turretBox: RAPIER.Collider | null = null;
    for (const part of def.parts) {
      _at.set(part.at[0], part.at[1], part.at[2]).applyQuaternion(root.quaternion).add(root.position);
      _q.copy(root.quaternion);
      if (part.turns) _q.multiply(_spin.setFromAxisAngle(_up, model.turret?.rotation.y ?? 0));
      const collider = ctx.physics.addStaticBox(_at, _half.set(part.half[0], part.half[1], part.half[2]), _q, def.surface);
      if (part.turns && value.flung) turretBox = collider;
      else colliders.push(collider);
    }
    system.fleet.scorch(root);
    model.body.rotation.set(value.body[0], value.body[1], value.body[2]);
    const wreck = new Wreck(system, root, colliders, def.wreck, def.halfWidth, def.halfLength, null, settled && !(value.burn > 0), true);
    if (!settled) wreck.follow(value.hop!, new THREE.Vector3(...value.tumble!));
    else wreck.burnLeft = Math.max(0, Math.min(def.wreck.burnSeconds, Number.isFinite(value.burn) ? value.burn : 0));
    let flung: THREE.Object3D | null = null;
    const f = value.flung;
    if (f && model.turret && validVec(f.v) && validVec(f.spin) && Number.isFinite(f.floor)) {
      // The turret leaves as the host's did (GroundVehicle.popTurret), or lies where the host's landed.
      const turret = model.turret;
      turret.getWorldPosition(_at);
      turret.getWorldQuaternion(_q);
      ctx.render.scene.add(turret);
      turret.position.copy(_at);
      turret.quaternion.copy(_q);
      system.fleet.scorch(turret);
      const landed = validVec(f.at) && validVec(f.rot);
      if (landed) {
        turret.position.fromArray(f.at!);
        turret.rotation.set(f.rot![0], f.rot![1], f.rot![2]);
        if (turretBox) { turretBox.setTranslation(turret.position); turretBox.setRotation(turret.quaternion); }
      }
      const piece: Flung = { mesh: turret, velocity: new THREE.Vector3(...f.v), spin: new THREE.Vector3(...f.spin), floor: f.floor, collider: turretBox, flying: !landed };
      wreck.fling(piece);
      flung = turret;
    } else if (turretBox) colliders.push(turretBox);
    this.wrecks.set(value.wid, { wreck, flung });
    if (settled) return;
    // What the host's screen shows as it goes (VehicleSystem.bury); the blast itself arrives as the host's explosion.
    _at.copy(root.position);
    _at.y += 1.2;
    ctx.fx.chips(_at, 0xff9000, 60);
    ctx.fx.embers(_at, 40, 4);
    ctx.fx.heatShimmer(_at, def.halfLength * 1.4, 6);
    ctx.render.lights.flash(_at, 0xffa050, 18, def.wreck.blastRadius * 5, 0.5);
    ctx.render.decals.add('scorch', root.position, _up, def.halfLength * 2.2, Math.random() * 6.28);
    ctx.audio.play('vehicle_explode', { position: _at });
    ctx.fx.ring(root.position, _up, 0xffa040, def.wreck.blastRadius);
  }

  private wreckGone(wid: number): void {
    const w = this.wrecks.get(wid);
    if (!w) return;
    w.wreck.dispose();
    this.wrecks.delete(wid);
  }

  dispose(): void {
    for (const puppet of this.puppets.values()) this.retire(puppet, true);
    this.puppets.clear();
    for (const w of this.wrecks.values()) w.wreck.dispose();
    this.wrecks.clear();
  }
}
