/**
 * The first-person rig. WeaponSystem drives it through ViewmodelRig and it never changes game state.
 *
 * Each frame on player time: read the player's motion, step the springs, compose the gun's view-space pose from its
 * layers, let the weapon's clip move parts and queue hand targets, then solve both arms against the result.
 */
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../../core/math';
import { CG, type Ctx, type RayHit } from '../../core/contracts';
import type { CallInId, PerkId, PowerupId, SwordMove, ViewmodelRig, WeaponId } from '../../core/gameplay';
import { Arm } from './arms';
import { inQuad, outBack, outCubic } from './curves';
import { Anim, type HandCtl, type ViewDef } from './def';
import { Kit } from './kit/kit';
import { VmMaterials } from './kit/materials';
import type { Model } from './kit/model';
import { buildDefs, buildOffhand, type OffhandSet } from './models';
import { Offhand } from './offhand';
import { Spring, Spring3 } from './spring';

/**
 * Shoulders sit well under the frustum and out to the sides, not where a body would put them. The arms are shorter
 * than the reach most poses ask for, and a true shoulder would slide the whole limb up past the eye as a huge sleeve.
 * From down here an arm always enters from a bottom corner of the screen.
 */
const SHOULDER_R = new THREE.Vector3(0.42, -0.62, -0.02);
const SHOULDER_L = new THREE.Vector3(-0.44, -0.62, -0.02);
const POLE_R = new THREE.Vector3(0.75, -0.7, 0.1);
const POLE_L = new THREE.Vector3(-0.55, -0.85, 0.1);

/** Bring-up offset at the bottom of a draw. */
const DRAW_Y = -0.34;
const DRAW_Z = 0.08;
const DRAW_PITCH = -1.0;
const DRAW_ROLL = 0.35;

/**
 * The view scene has no shadow receivers: PCF on a quarter of the screen would cost more than it shows. Instead the eye
 * itself samples the sky: a few rays toward the moon each second decide how much of the moon reaches the gun.
 */
const MOON_RAY_INTERVAL = 1 / 20;
const MOON_REACH = 240;
const MOON_FLOOR = 0.03;
/** Ray origins around the eye, so the gun fades through a doorway instead of switching. */
const MOON_PROBES: readonly (readonly [number, number, number])[] = [[0, 0, 0], [0.5, 0.1, -0.4], [-0.5, 0.1, -0.4], [0, 0.35, 0.3]];
/**
 * A dim light fixed to the view, so a dark gun keeps its shape in the darkest corridor. It stays on in the moon too: the
 * moon is often in front of the player, and then it lights only the faces of the gun that nobody can see.
 */
const FILL_MOONLIT = 1.0;
const FILL_DARK = 1.5;

/** Call-ins and the device that goes with them; progression's targeting state drives this. */
const DEVICE: Record<CallInId, 'walkie' | 'designator'> = {
  airstrike: 'walkie', warthog: 'walkie', doorGunner: 'walkie', attackChopper: 'walkie', orbital: 'designator', ac130: 'walkie', blackSun: 'designator', nuke: 'designator',
};

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _rot = new THREE.Vector3();
const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const _gunEuler = new THREE.Euler();
const _moonFrom = new THREE.Vector3();
const _moonHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

/** Soft limit: linear near zero, flattening toward `limit`. */
const soft = (v: number, limit: number) => limit * Math.tanh(v / limit);

export class Rig implements ViewmodelRig {
  private ctx!: Ctx;
  readonly root = new THREE.Group();
  /** Main gun pivot. */
  private readonly gun = new THREE.Group();
  /** Left gun pivot, for akimbo. */
  private readonly gunL = new THREE.Group();
  private armR!: Arm;
  private armL!: Arm;
  private defs: Record<string, ViewDef> = {};
  private def: ViewDef | null = null;
  private defLeft: ViewDef | null = null;
  private offhand!: Offhand;
  mats!: VmMaterials;
  private readonly anchors: Record<string, THREE.Object3D> = {};

  readonly a = new Anim();
  readonly a2 = new Anim();

  // Timers.
  private drawLeft = 0;
  private drawSeconds = 1;
  private holsterW = 0;
  private holsterRate = 0;
  private holstered = false;
  private scoped = false;
  private scopeW = 0;
  private akimbo = false;
  private akimboW = 0;
  private reloadLeft = 0;

  // Springs.
  private readonly recoilP = new Spring3(50, 0.6);
  private readonly recoilR = new Spring3(50, 0.6);
  private readonly recoilLP = new Spring3(50, 0.6);
  private readonly recoilLR = new Spring3(50, 0.6);
  /** Mouse-look lag. */
  private readonly lookR = new Spring3(15, 0.62);
  private readonly lookP = new Spring3(13, 0.6);
  /** Body inertia: strafing, jumping, landing. */
  private readonly moveP = new Spring3(11, 0.5);
  private readonly moveR = new Spring3(10, 0.55);
  /** Settles the gun when a draw ends. */
  private readonly settle = new Spring(26, 0.42);

  // Motion samples.
  private lastYaw = 0;
  private lastPitch = 0;
  private bobW = 0;
  private runW = 0;
  private fastW = 0;
  private slideW = 0;
  private wallW = 0;
  private wallSide = 0;
  private slamW = 0;
  private airW = 0;
  /** Where the eye and look were on this frame's rig update; muzzle() uses them to correct a stale camera. */
  private readonly eyeAtUpdate = new THREE.Vector3();
  private yawAtUpdate = 0;
  private pitchAtUpdate = 0;

  // Light on the gun.
  private viewMoon: THREE.DirectionalLight | null = null;
  private moonIntensity = 0;
  private readonly moonDir = new THREE.Vector3();
  private readonly fill = new THREE.DirectionalLight(0xc6d0e2, FILL_DARK);
  private moonVis = 1;
  private moonOpen = 1;
  private moonProbe = 0;
  private moonClock = 0;

  // Perk looks.
  private perkHeat = 0;
  private perkHeatOn = false;
  private rage = 0;
  private rageOn = false;
  private frost = 0;
  private frostLeft = 0;

  private lastMag = -1;
  private lastMagLeft = -1;
  private lastBucket = -1;
  private lastWrist = '';
  private wristClock = 0;
  private lastGrenades = -1;
  private unsub: (() => void)[] = [];

  async init(ctx: Ctx): Promise<void> {
    this.ctx = ctx;
    const { render } = ctx;
    this.mats = new VmMaterials(render.materials);
    const kit = new Kit(this.mats);
    this.root.name = 'viewmodels';
    this.root.add(this.gun, this.gunL);

    const defs = buildDefs(kit);
    this.defs = defs;
    for (const def of Object.values(defs)) {
      def.model.root.visible = false;
      (def.id === 'smgLeft' ? this.gunL : this.gun).add(def.model.root);
    }
    this.defLeft = defs.smgLeft ?? null;
    if (this.defLeft) {
      this.recoilLP.tune(this.defLeft.recoil.omega, this.defLeft.recoil.zeta);
      this.recoilLR.tune(this.defLeft.recoil.omega, this.defLeft.recoil.zeta);
    }

    this.armR = new Arm(kit, 1);
    this.armL = new Arm(kit, -1);
    this.root.add(this.armR.mesh, this.armL.mesh);

    this.anchor('pouchL', [-0.3, -0.62, -0.1], [0.4, 0.2, Math.PI]);
    this.anchor('pouchR', [0.34, -0.62, -0.1], [0.4, -0.2, -Math.PI / 2]);
    this.anchor('chestL', [-0.2, -0.3, -0.25], [0.9, 0.4, Math.PI * 0.75]);

    const off: OffhandSet = buildOffhand(kit);
    this.offhand = new Offhand(off);
    this.root.add(this.offhand.root);

    render.viewScene.add(this.root);

    // Over the left shoulder, so the top and the camera-side bevels of every gun catch it.
    this.fill.position.set(-0.55, 0.85, 0.6);
    render.viewScene.add(this.fill);
    const moon = (render as unknown as { moon?: THREE.DirectionalLight }).moon;
    if (moon) {
      this.moonDir.copy(moon.position).normalize();
      this.viewMoon = render.viewScene.children.find(o => (o as THREE.DirectionalLight).isDirectionalLight && o !== this.fill) as THREE.DirectionalLight ?? null;
      this.moonIntensity = this.viewMoon?.intensity ?? 0;
    }

    const on = ctx.events.on.bind(ctx.events);
    this.unsub.push(
      on('player:jumped', e => this.onJump(e.double)),
      on('player:landed', e => this.onLand(e.impact)),
      on('player:dashed', () => this.onDash()),
      on('player:slam', e => this.onLand(Math.min(e.impact, 40) + 14)),
      on('perk:start', e => this.onPerk(e.id, true)),
      on('perk:end', e => this.onPerk(e.id, false)),
      on('player:damaged', e => this.onHurt(e.amount)),
      on('callin:used', () => this.offhand.confirm()),
      on('sonar:tap', () => this.offhand.tap()),
    );
    this.reset();
  }

  private anchor(name: string, pos: readonly [number, number, number], rot: readonly [number, number, number]): void {
    const o = new THREE.Object3D();
    o.position.set(pos[0], pos[1], pos[2]);
    o.rotation.set(rot[0], rot[1], rot[2]);
    this.root.add(o);
    this.anchors[name] = o;
    o.updateMatrixWorld(true);
  }

  reset(): void {
    this.recoilP.reset();
    this.recoilR.reset();
    this.recoilLP.reset();
    this.recoilLR.reset();
    this.lookP.reset();
    this.lookR.reset();
    this.moveP.reset();
    this.moveR.reset();
    this.settle.reset();
    this.a.reload = -1;
    this.a.sinceFire = 99;
    this.a.heat = 0;
    this.a.charge = 0;
    this.a.spinRate = 0;
    this.a.swing = null;
    this.a2.sinceFire = 99;
    this.a2.heat = 0;
    this.holstered = false;
    this.holsterW = 0;
    this.holsterRate = 0;
    this.scoped = false;
    this.scopeW = 0;
    this.akimbo = false;
    this.akimboW = 0;
    this.perkHeat = 0;
    this.perkHeatOn = false;
    this.rage = 0;
    this.rageOn = false;
    this.frost = 0;
    this.frostLeft = 0;
    this.lastMag = -1;
    this.lastBucket = -1;
    this.lastGrenades = -1;
    this.offhand.reset();
    this.lastYaw = this.ctx.player.yaw;
    this.lastPitch = this.ctx.player.pitch;
  }

  // --- ViewmodelRig ------------------------------------------------------------------------------

  equip(id: WeaponId, seconds: number): void {
    const def = this.defs[id];
    if (!def) return;
    const same = this.def === def;
    if (this.def && !same) this.def.model.root.visible = false;
    this.def = def;
    def.model.root.visible = true;
    const a = this.a;
    a.parts = def.model.parts;
    a.model = def.model;
    a.reload = -1;
    a.swing = null;
    a.parry = -1;
    a.bladeHeat = 0;
    a.spinRate = 0;
    this.holstered = false;
    this.holsterRate = 0;
    this.holsterW = 0;
    this.recoilP.tune(def.recoil.omega, def.recoil.zeta);
    this.recoilR.tune(def.recoil.omega, def.recoil.zeta);
    this.lastMag = -1;
    this.lastMagLeft = -1;
    this.lastBucket = -1;
    if (seconds <= 0.03) {
      this.drawLeft = 0;
      a.draw = 1;
      return;
    }
    this.drawLeft = this.drawSeconds = seconds;
    a.draw = 0;
    a.sinceDraw = 0;
  }

  holster(seconds: number): void {
    this.holstered = true;
    this.holsterRate = 1 / Math.max(seconds, 0.02);
    this.a.reload = -1;
    this.a.swing = null;
  }

  fire(strength = 1, left = false): void {
    const def = left ? this.defLeft : this.def;
    if (!def) return;
    const a = left ? this.a2 : this.a;
    a.sinceFire = 0;
    a.shots++;
    a.strength = strength;
    a.heat = Math.min(1, a.heat + (def.heatPerShot ?? 0) * strength);
    const r = def.recoil;
    const p = left ? this.recoilLP : this.recoilP;
    const o = left ? this.recoilLR : this.recoilR;
    const jitter = 0.86 + Math.random() * 0.28;
    const side = (Math.random() - 0.5) * 2;
    // Peak on frame one: most of the travel lands immediately, and the spring only has to bring it home.
    const snap = 0.72;
    const launch = r.omega * 0.9;
    p.z.x += r.back * strength * jitter * snap;
    p.z.v += r.back * strength * jitter * launch;
    p.y.x += r.lift * strength * snap;
    p.y.v += r.lift * strength * launch;
    p.x.x += side * r.back * 0.08 * strength;
    o.x.x += r.pitch * strength * jitter * snap;
    o.x.v += r.pitch * strength * jitter * launch;
    o.y.v += side * r.yaw * strength * launch;
    o.z.v += (Math.random() - 0.5) * 2 * r.roll * strength * launch;
  }

  reload(seconds: number): void {
    this.a.reload = 0;
    this.a.reloadSeconds = Math.max(seconds, 0.05);
    this.reloadLeft = this.a.reloadSeconds;
  }

  swing(move: SwordMove, seconds: number): void {
    const a = this.a;
    if (move === 'block') {
      // A parry lands on top of the guard, so it plays as an overlay and the held pose survives it.
      a.parry = 0;
      a.parrySeconds = Math.max(seconds, 0.05);
      return;
    }
    a.swing = move;
    a.swingP = 0;
    a.swingSeconds = Math.max(seconds, 0.05);
  }

  setCharge(amount: number): void {
    this.a.charge = clamp(amount);
  }

  setAkimbo(on: boolean): void {
    this.akimbo = on;
  }

  setScoped(on: boolean): void {
    this.scoped = on;
  }

  muzzle(out: THREE.Vector3, left = false): THREE.Vector3 {
    const def = left && this.akimboW > 0.01 ? this.defLeft : this.def;
    const s = def?.model.sockets.muzzle;
    if (!s) return out;
    return this.toWorld(_a.setFromMatrixPosition(s.matrixWorld), out);
  }

  ejectPort(out: THREE.Vector3): THREE.Vector3 {
    const s = this.def?.model.sockets.eject;
    if (!s) return out;
    return this.toWorld(_a.setFromMatrixPosition(s.matrixWorld), out);
  }

  /**
   * Maps a viewmodel point to the world point that lands on the same pixel. The two cameras share an eye and a
   * depth axis, so only the x and y scale differs, by the ratio of the FOV tangents.
   *
   * WeaponSystem asks for this before CameraRig has run, so the camera is a frame stale. At 45 m/s that is most of a
   * meter, so the position and look come from the player, which has already moved, and the camera only supplies what
   * it adds on top: bob, kick, shake and roll.
   */
  private toWorld(viewPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const { camera, viewCamera } = this.ctx.render;
    _b.copy(viewPoint).applyMatrix4(viewCamera.matrixWorldInverse);
    const k = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((viewCamera.fov * Math.PI) / 360);
    _b.x *= k;
    _b.y *= k;
    const p = this.ctx.player;
    _eu.set(
      p.pitch + camera.rotation.x - this.pitchAtUpdate,
      p.yaw + wrapAngle(camera.rotation.y - this.yawAtUpdate),
      camera.rotation.z,
    );
    _b.applyQuaternion(_q.setFromEuler(_eu));
    return out.copy(_b).add(p.eye).add(camera.position).sub(this.eyeAtUpdate);
  }

  // --- Events ------------------------------------------------------------------------------------

  private onJump(double: boolean): void {
    this.moveP.y.v -= double ? 0.5 : 0.75;
    this.moveR.x.v -= double ? 0.8 : 1.3;
  }

  private onLand(impact: number): void {
    const k = clamp(impact / 30, 0.08, 1.2);
    this.moveP.y.v -= 2.2 * k;
    this.moveP.z.v += 0.5 * k;
    this.moveR.x.v -= 6.5 * k;
  }

  private onDash(): void {
    this.moveP.z.v += 1.4;
    this.moveR.x.v += 2.5;
  }

  private onHurt(amount: number): void {
    const k = clamp(amount / 40, 0.1, 1);
    this.moveR.x.v += (Math.random() - 0.5) * 4 * k;
    this.moveR.z.v += (Math.random() - 0.5) * 6 * k;
  }

  private onPerk(id: PerkId | PowerupId, on: boolean): void {
    if (id === 'hellfire') this.perkHeatOn = on;
    else if (id === 'berserk') this.rageOn = on;
    else if (id === 'frostNova' && on) this.frostLeft = 7;
  }

  // --- Frame -------------------------------------------------------------------------------------

  update(): void {
    const def = this.def;
    if (!def) return;
    const dt = this.ctx.time.playerDt;
    const a = this.a;
    a.dt = dt;
    a.time += dt;
    this.sampleMotion(dt);
    this.stepTimers(dt);
    this.stepSprings(dt);

    a.gunP.set(0, 0, 0);
    a.gunR.set(0, 0, 0);
    def.model.resetParts();
    a.right.begin(def.right);
    a.left.begin(def.left);
    this.readAmmo(def);
    def.animate(a);
    this.composeGun(def, a);
    this.gun.updateMatrixWorld(true);

    let akimboOn = false;
    const dl = this.defLeft;
    if (dl) {
      this.akimboW = damp(this.akimboW, this.akimbo && def.id === 'smg' ? 1 : 0, 16, dt);
      akimboOn = this.akimboW > 0.02;
      dl.model.root.visible = akimboOn;
      if (akimboOn) {
        const b = this.a2;
        b.dt = dt;
        b.time = a.time;
        b.mag = a.mag;
        b.magSize = a.magSize;
        b.sinceFire += dt;
        b.heat = Math.max(0, b.heat - dt * 0.3);
        b.parts = dl.model.parts;
        b.model = dl.model;
        b.reload = a.reload;
        b.draw = 1;
        if (b.mag !== this.lastMagLeft) {
          this.lastMagLeft = b.mag;
          dl.readout?.(b);
        }
        b.gunP.set(0, 0, 0);
        b.gunR.set(0, 0, 0);
        dl.model.resetParts();
        b.right.begin(null);
        b.left.begin(dl.left);
        dl.animate(b);
        this.composeLeftGun(dl, b);
        this.gunL.updateMatrixWorld(true);
      }
    }

    this.offhand.update(dt);
    this.solveArms(def, dl, akimboOn, dt);
    this.updateLooks(dt);
    this.updateMoon(dt);
    this.updateWrist(dt);
  }

  private updateMoon(dt: number): void {
    if (!this.viewMoon) return;
    this.moonClock -= dt;
    if (this.moonClock <= 0) {
      this.moonClock = MOON_RAY_INTERVAL;
      const o = MOON_PROBES[this.moonProbe]!;
      this.moonProbe = (this.moonProbe + 1) % MOON_PROBES.length;
      _moonFrom.copy(this.ctx.player.eye);
      _moonFrom.x += o[0];
      _moonFrom.y += o[1];
      _moonFrom.z += o[2];
      const blocked = this.ctx.physics.raycastInto(_moonFrom, this.moonDir, MOON_REACH, CG.World, _moonHit);
      this.moonOpen = damp(this.moonOpen, blocked ? 0 : 1, 1 / (MOON_RAY_INTERVAL * MOON_PROBES.length), MOON_RAY_INTERVAL);
    }
    this.moonVis = damp(this.moonVis, this.moonOpen, 9, dt);
    this.viewMoon.intensity = this.moonIntensity * lerp(MOON_FLOOR, 1, this.moonVis);
    this.fill.intensity = lerp(FILL_DARK, FILL_MOONLIT, this.moonVis);
  }

  private sampleMotion(dt: number): void {
    const p = this.ctx.player;
    const yaw = p.yaw;
    const pitch = p.pitch;
    this.eyeAtUpdate.copy(p.eye);
    this.yawAtUpdate = yaw;
    this.pitchAtUpdate = pitch;

    const a = this.a;
    const v = p.velocity;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const vr = v.x * cy - v.z * sy;
    const vf = -v.x * sy - v.z * cy;
    const speed = Math.hypot(v.x, v.z);
    a.speed = speed;

    const slideOn = p.sliding ? 1 : 0;
    const wallOn = p.wallRunning ? 1 : 0;
    const moved = a.sinceFire > 0.45 && a.reload < 0 && a.swing === null ? 1 : 0;
    this.slideW = damp(this.slideW, slideOn, 12, dt);
    this.wallW = damp(this.wallW, wallOn, 10, dt);
    this.airW = damp(this.airW, p.grounded ? 0 : 1, 7, dt);
    // Running is the default state here, so the gun only drops a little until the player is genuinely flying.
    this.runW = damp(this.runW, smoothstep(9, 16, speed) * (p.grounded ? 1 : 0.4) * moved, 8, dt);
    this.fastW = damp(this.fastW, smoothstep(22, 42, speed) * moved, 5, dt);
    this.bobW = damp(this.bobW, p.grounded || p.wallRunning ? smoothstep(0.6, 7, speed) : 0, 10, dt);
    if (p.wallSide !== 0) this.wallSide = p.wallSide;
    this.slamW = damp(this.slamW, p.state === 'slam' ? 1 : 0, 14, dt);

    if (dt > 0) {
      const yawRate = soft(wrapAngle(yaw - this.lastYaw) / dt, 9);
      const pitchRate = soft((pitch - this.lastPitch) / dt, 7);
      // Look lag: the gun trails the camera, and rolls into the turn.
      this.lookR.step(dt, -pitchRate * 0.0105, -yawRate * 0.0125, yawRate * 0.012);
      this.lookP.step(dt, yawRate * 0.0034, -pitchRate * 0.0026, 0);
      // Body inertia, with soft limits because speed has no cap in this game.
      this.moveP.step(dt, -soft(vr, 34) * 0.00095, soft(-v.y, 40) * 0.00055, soft(vf, 40) * 0.0006);
      this.moveR.step(dt, 0, -soft(vr, 34) * 0.0016, -soft(vr, 34) * 0.0052);
    }
    this.lastYaw = yaw;
    this.lastPitch = pitch;
  }

  private stepTimers(dt: number): void {
    const a = this.a;
    a.sinceFire += dt;
    a.sinceDraw += dt;
    a.heat = Math.max(0, a.heat - dt * (a.sinceFire > 0.25 ? 0.28 : 0.05));

    if (this.drawLeft > 0) {
      this.drawLeft -= dt;
      a.draw = clamp(1 - this.drawLeft / this.drawSeconds);
      a.sinceDraw = 0;
      if (this.drawLeft <= 0) {
        a.draw = 1;
        this.settle.v -= 2.2;
      }
    }
    if (a.reload >= 0) {
      this.reloadLeft -= dt;
      a.reload = clamp(1 - this.reloadLeft / a.reloadSeconds);
      if (this.reloadLeft <= 0) a.reload = -1;
      // A reload cancelled by the weapon system ends here; a clip alone would keep playing to the end.
      if (!this.ctx.weapons.reloading && a.reload > 0.02) a.reload = -1;
    }
    if (a.swing) {
      a.swingP += dt / a.swingSeconds;
      if (a.swing !== 'windup' && a.swingP >= 1 + a.recover / a.swingSeconds) a.swing = null;
    }
    if (a.parry >= 0) {
      a.parry += dt / a.parrySeconds;
      if (a.parry >= 1) a.parry = -1;
    }
    if (this.holstered) this.holsterW = Math.min(1, this.holsterW + dt * this.holsterRate);

    const def = this.def;
    if (def?.spinMax) {
      const target = a.charge * def.spinMax;
      a.spinRate = damp(a.spinRate, target, target > a.spinRate ? 7 : 2.4, dt);
      a.spin += a.spinRate * dt;
    }
    this.scopeW = damp(this.scopeW, this.scoped ? 1 : 0, 18, dt);
  }

  private stepSprings(dt: number): void {
    this.recoilP.step(dt);
    this.recoilR.step(dt);
    this.recoilLP.step(dt);
    this.recoilLR.step(dt);
    this.settle.step(dt);
  }

  private readAmmo(def: ViewDef): void {
    const a = this.a;
    const am = this.ctx.weapons.ammo(def.id as WeaponId);
    a.mag = am.mag;
    a.magSize = am.magSize;
    a.reserve = am.reserve;
    const bucket = Math.round(a.charge * 20);
    if (a.mag !== this.lastMag || bucket !== this.lastBucket) {
      this.lastMag = a.mag;
      this.lastBucket = bucket;
      def.readout?.(a);
    }
  }

  private composeGun(def: ViewDef, a: Anim): void {
    const t = a.time;
    const idle = 1 - this.bobW;
    const p = _pos.set(def.pos[0], def.pos[1], def.pos[2]);
    const r = _rot.set(def.rot[0], def.rot[1], def.rot[2]);

    // Akimbo pushes the main gun out to make room.
    const ak = this.akimboW;
    p.x += ak * 0.045;
    p.y -= ak * 0.015;
    r.y -= ak * 0.1;

    // Breathing: the slowest layer, gone once the player moves.
    p.y += Math.sin(t * 1.35) * 0.0013 * idle;
    p.x += Math.sin(t * 0.82 + 1) * 0.0008 * idle;
    r.x += Math.sin(t * 1.35 + 0.6) * 0.0028 * idle;
    r.z += Math.sin(t * 0.61) * 0.0022 * idle;

    // Synced to the footfalls CameraRig bobs to: side sway once per stride pair, drop on every footfall.
    const phase = this.ctx.player.stridePhase * Math.PI;
    p.x += Math.cos(phase) * 0.0062 * this.bobW;
    p.y += (0.0039 - Math.abs(Math.sin(phase)) * 0.0078) * this.bobW;
    r.z += Math.cos(phase) * 0.012 * this.bobW;
    r.x += (Math.abs(Math.sin(phase)) - 0.5) * 0.008 * this.bobW;

    // Pose layers.
    const run = this.runW;
    p.x += run * 0.006;
    p.y -= run * 0.014;
    p.z += run * 0.012;
    r.x -= run * 0.05;
    r.y += run * 0.09;
    r.z -= run * 0.07;

    const fast = this.fastW;
    p.x += fast * 0.018;
    p.y -= fast * 0.02;
    p.z += fast * 0.03;
    r.x -= fast * 0.14;
    r.y += fast * 0.14;
    r.z -= fast * 0.13;

    const slide = this.slideW;
    p.x -= slide * 0.014;
    p.y += slide * 0.012;
    p.z += slide * 0.008;
    r.z += slide * 0.2;
    r.x += slide * 0.04;

    const wall = this.wallW * this.wallSide;
    p.x -= wall * 0.016;
    r.z -= wall * 0.17;
    r.y += wall * 0.03;

    // Slam: gun thrown up and forward as the player drives down.
    p.y += this.slamW * 0.05;
    r.x += this.slamW * 0.25;

    // Air: a slight float as the arms lose their ground reference.
    p.y += this.airW * 0.006;

    p.x += this.lookP.x.x + this.moveP.x.x;
    p.y += this.lookP.y.x + this.moveP.y.x;
    p.z += this.moveP.z.x;
    r.x += this.lookR.x.x + this.moveR.x.x;
    r.y += this.lookR.y.x + this.moveR.y.x;
    r.z += this.lookR.z.x + this.moveR.z.x;

    // Recoil and clip motion.
    p.x += this.recoilP.x.x + a.gunP.x;
    p.y += this.recoilP.y.x + a.gunP.y;
    p.z += this.recoilP.z.x + a.gunP.z + this.settle.x * 0.008;
    r.x += this.recoilR.x.x + a.gunR.x + this.settle.x * 0.02;
    r.y += this.recoilR.y.x + a.gunR.y;
    r.z += this.recoilR.z.x + a.gunR.z;

    // Draw and holster share one curve.
    const raise = a.draw < 1 ? 1 - outBack(a.draw, 1.2) : 0;
    const lower = inQuad(this.holsterW);
    const k = Math.max(raise, lower);
    p.y += k * DRAW_Y;
    p.z += k * DRAW_Z;
    r.x += k * DRAW_PITCH;
    r.z += k * DRAW_ROLL;

    // Scope: the gun comes up to the eye just before the overlay takes over.
    const sc = this.scopeW;
    p.x -= sc * def.pos[0] * 0.9;
    p.y += sc * 0.05;
    r.y -= sc * def.rot[1];

    this.gun.position.copy(p);
    _gunEuler.set(r.x, r.y, r.z);
    this.gun.quaternion.setFromEuler(_gunEuler);
    this.gun.visible = this.holsterW < 1 && this.scopeW < 0.9;
  }

  private composeLeftGun(def: ViewDef, b: Anim): void {
    const rise = 1 - outCubic(this.akimboW);
    const p = _pos.set(def.pos[0], def.pos[1], def.pos[2]);
    const r = _rot.set(def.rot[0], def.rot[1], def.rot[2]);
    p.x += this.lookP.x.x + this.moveP.x.x * 0.8 + this.recoilLP.x.x + b.gunP.x;
    p.y += this.lookP.y.x + this.moveP.y.x * 0.8 + this.recoilLP.y.x + b.gunP.y - rise * 0.3;
    p.z += this.moveP.z.x + this.recoilLP.z.x + b.gunP.z;
    r.x += this.lookR.x.x + this.moveR.x.x + this.recoilLR.x.x + b.gunR.x - rise * 0.8;
    r.y += this.lookR.y.x + this.moveR.y.x + this.recoilLR.y.x + b.gunR.y;
    r.z += this.lookR.z.x + this.moveR.z.x + this.recoilLR.z.x + b.gunR.z;
    const phase = this.ctx.player.stridePhase * Math.PI;
    p.x -= Math.cos(phase) * 0.0062 * this.bobW;
    p.y -= Math.abs(Math.cos(phase)) * 0.0078 * this.bobW;
    // The same run, sprint and slide layers as the main gun, mirrored, or Berserk's speed leaves the left gun standing still.
    const run = this.runW;
    const fast = this.fastW;
    const slide = this.slideW;
    p.x -= run * 0.006 + fast * 0.018 - slide * 0.014;
    p.y -= run * 0.014 + fast * 0.02 - slide * 0.012;
    p.z += run * 0.012 + fast * 0.03 + slide * 0.008;
    r.x -= run * 0.05 + fast * 0.14 - slide * 0.04;
    r.y -= run * 0.09 + fast * 0.14;
    r.z += run * 0.07 + fast * 0.13 + slide * 0.2;
    this.gunL.position.copy(p);
    _gunEuler.set(r.x, r.y, r.z);
    this.gunL.quaternion.setFromEuler(_gunEuler);
    this.gunL.visible = this.gun.visible;
  }

  /** Finds a socket on the model, or a view-space anchor on the rig. */
  socket(model: Model, name: string): THREE.Object3D | null {
    return model.sockets[name] ?? this.anchors[name] ?? this.offhand.sockets[name] ?? null;
  }

  private resolveHand(h: HandCtl, model: Model, outP: THREE.Vector3, outQ: THREE.Quaternion): boolean {
    if (!h.base) return false;
    const base = this.socket(model, h.base);
    if (!base) return false;
    base.updateWorldMatrix(true, false);
    base.matrixWorld.decompose(outP, outQ, _s);
    for (let i = 0; i < h.steps; i++) {
      const s = this.socket(model, h.names[i]!);
      if (!s) continue;
      s.updateWorldMatrix(true, false);
      s.matrixWorld.decompose(_p, _q, _s);
      const w = h.weights[i]!;
      outP.lerp(_p, w);
      outQ.slerp(_q, w);
    }
    outP.add(h.nudge);
    return true;
  }

  private solveArms(def: ViewDef, defLeft: ViewDef | null, akimbo: boolean, dt: number): void {
    const a = this.a;
    const shown = this.gun.visible;
    const off = this.offhand;
    const rightOk = shown && this.resolveHand(a.right, def.model, _a, _qa);
    this.armR.mesh.visible = rightOk;
    if (rightOk) {
      this.fingers(this.armR, a.right, dt);
      this.armR.applyPose();
      this.armR.solve(_a, _qa, SHOULDER_R, POLE_R);
    }

    let leftOk = shown && this.resolveHand(a.left, def.model, _b, _qb);
    let hand = a.left;
    if (akimbo && defLeft) {
      const k = this.akimboW;
      if (this.resolveHand(this.a2.left, defLeft.model, _p, _q)) {
        if (!leftOk) { _b.copy(_p); _qb.copy(_q); leftOk = true; }
        _b.lerp(_p, k);
        _qb.slerp(_q, k);
        hand = this.a2.left;
      }
    }
    // The off-hand device takes the left hand from the gun.
    const ow = off.leftWeight;
    if (ow > 0.001) {
      off.hand.matrixWorld.decompose(_p, _q, _s);
      if (!leftOk) { _b.copy(_p); _qb.copy(_q); leftOk = true; }
      _b.lerp(_p, ow);
      _qb.slerp(_q, ow);
      hand = off.ctl;
    }
    this.armL.mesh.visible = leftOk;
    if (leftOk) {
      this.fingers(this.armL, hand, dt);
      this.armL.applyPose();
      this.armL.solve(_b, _qb, SHOULDER_L, POLE_L);
    }
  }

  private fingers(arm: Arm, h: HandCtl, dt: number): void {
    const out = arm.pose;
    const src = h.pose;
    const k = 1 - Math.exp(-h.fingerRate * dt);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + (src[i]! - out[i]!) * k;
    if (h.trigger > 0) {
      out[4] = out[4]! + h.trigger * 0.16;
      out[5] = out[5]! + h.trigger * 0.3;
    }
  }

  private updateLooks(dt: number): void {
    const u = this.mats.uniforms;
    u.uClock.value = this.a.time;
    this.perkHeat = damp(this.perkHeat, this.perkHeatOn ? 1 : 0, this.perkHeatOn ? 8 : 2, dt);
    u.uPerkHeat.value = this.perkHeat;
    this.rage = damp(this.rage, this.rageOn ? 1 : 0, this.rageOn ? 10 : 3, dt);
    // A heartbeat, not a sine: quick double thump, then rest.
    const beat = (this.a.time * 1.9) % 1;
    const thump = Math.exp(-beat * 9) + 0.7 * Math.exp(-Math.abs(beat - 0.26) * 16);
    u.uBerserk.value = this.rage * (0.32 + thump * 0.85);
    if (this.frostLeft > 0) this.frostLeft -= dt;
    this.frost = damp(this.frost, this.frostLeft > 0 ? 1 : 0, this.frostLeft > 0 ? 7 : 0.9, dt);
    u.uFrost.value = this.frost;
    u.uGunHeat.value = Math.max(this.a.heat, this.a.bladeHeat);
    this.pollDevices();
  }

  /** Grenades and call-ins have no rig calls; their public state is enough to drive the off-hand. */
  private pollDevices(): void {
    const { weapons, progression, input } = this.ctx;
    const g = weapons.grenades;
    if (this.lastGrenades >= 0 && g < this.lastGrenades) this.offhand.cook();
    this.lastGrenades = g;
    if (this.offhand.cooking && !input.isDown('grenade')) this.offhand.release();
    const t = progression.targeting;
    this.offhand.device(t ? DEVICE[t] : null);
  }

  private updateWrist(dt: number): void {
    const s = this.armL.screen;
    if (!s) return;
    this.wristClock -= dt;
    if (this.wristClock > 0) return;
    this.wristClock = 0.1;
    const { player } = this.ctx;
    const hp = Math.ceil(player.health);
    const ar = Math.ceil(player.armor);
    const mx = player.maxHealth;
    const key = `${hp}|${ar}|${Math.round(this.a.speed)}`;
    if (key === this.lastWrist) return;
    this.lastWrist = key;
    const { g, canvas, texture } = s;
    const w = canvas.width;
    const h = canvas.height;
    g.fillStyle = '#04090c';
    g.fillRect(0, 0, w, h);
    const low = hp / mx < 0.3;
    const hue = low ? '#ff3a2a' : '#35e8ff';
    g.fillStyle = hue;
    g.font = '700 46px "Courier New", monospace';
    g.textBaseline = 'top';
    g.fillText(String(hp).padStart(3, '0'), 8, 6);
    g.font = '700 18px "Courier New", monospace';
    g.fillText('VIT', 112, 12);
    g.fillRect(8, 58, (w - 16) * clamp(hp / mx), 9);
    g.fillStyle = '#7fa4b4';
    g.fillRect(8, 72, (w - 16) * clamp(ar / 100), 5);
    g.font = '700 22px "Courier New", monospace';
    g.fillText(`${String(Math.round(this.a.speed)).padStart(2, '0')} M/S`, 8, 88);
    texture.needsUpdate = true;
  }

  get currentDef(): ViewDef | null {
    return this.def;
  }

  get allDefs(): Record<string, ViewDef> {
    return this.defs;
  }
}
