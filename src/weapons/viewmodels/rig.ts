/**
 * The first-person rig. WeaponSystem drives it through ViewmodelRig and it never changes game state.
 *
 * Each frame on player time: read the player's motion, step the springs, compose the gun's view-space pose from its
 * layers, let the weapon's clip move parts and queue hand targets, then solve both arms against the result.
 */
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../../core/math';
import { DevFlags } from '../../core/devflags';
import { CG, type Ctx, type DamageInfo, type MovePose, type RayHit } from '../../core/contracts';
import type { CallInId, EnemyInstance, KillEvent, ModId, PerkId, PowerupId, SwordMove, ViewmodelRig, WeaponId } from '../../core/gameplay';
import { Arm } from './arms';
import { inQuad, outBack, outCubic } from './curves';
import { Anim, HandCtl, ironsUp, type ModLook, type Tuple3, type ViewDef } from './def';
import { Kit } from './kit/kit';
import { VmMaterials } from './kit/materials';
import { BloodCoat, clearByte, closeness, killBlood, reachByte, VmBloodTuning } from './blood';
import type { Model } from './kit/model';
import { buildDefs, buildOffhand, type OffhandSet } from './models';
import { LamBeams, ROCKET_LAM_RANGE, type LaserCast } from './lam';
import { ROCKET_LASER } from '../laser';
import { Legs } from './legs';
import { Offhand, leftGunAway } from './offhand';
import { HANDS } from './poses';
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
  sentry: 'designator', frame: 'walkie',
};

const _p = new THREE.Vector3();
/**
 * The weapon light's beam: a 23 degree half-cone with a soft edge, out to 30 m. Falling off as 1/d, not 1/d^2: at 1/d^2 enough to
 * light a dark room 10 m off burnt out a desk 1.5 m off in a lit one (tools/scripts/light-live.mjs).
 */
const TORCH_BEAM = { color: 0xfff1dc, candela: 140, decay: 1, range: 30, cone: 0.4, soft: 0.6 } as const;
const _smart = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
/** Socket names of a gun's barrels after the first, which is `muzzle`. */
const BARRELS: readonly string[] = ['muzzle', 'muzzle1', 'muzzle2', 'muzzle3'];
/** Aim past which a magnified optic's `inner` part is hidden (ModLook.inner). */
const INNER_AT = 0.85;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _rot = new THREE.Vector3();
const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const _gunEuler = new THREE.Euler();
const _moonFrom = new THREE.Vector3();
const _c = new THREE.Vector3();
const _qc = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _bd = new THREE.Vector3();
const _be = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const _bm = new THREE.Matrix4();
const _bi = new THREE.Matrix4();
/** The hand bone of an `Arm` (arms.ts `B.hand`): what a glove's blood is measured against. */
const HAND_BONE = 3;

/**
 * Writes `aBlood` for a weapon, measured with its parts at rest, so a slide or a magazine keeps its share of the blood
 * wherever a clip carries it. `x`: a vertex's place along the weapon (blood.ts `reachByte`), mod parts counted, shown or not.
 * `y`: 0 near any point the gun is aimed by (its own sights and every sight mod's), so blood never lands on a sight.
 */
function bakeReach(def: ViewDef, hard: THREE.Material): void {
  const model = def.model;
  model.resetParts();
  model.root.updateMatrixWorld(true);
  _bi.copy(model.root.matrixWorld).invert();
  const sights: Tuple3[] = [];
  const note = (p: Tuple3 | null | undefined) => { if (p) sights.push(p); };
  note(def.sight); note(def.rear); note(def.scopeEye);
  for (const look of Object.values(def.mods ?? {})) { note(look.sight); note(look.rear); }
  const meshes: THREE.Mesh[] = [];
  model.root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material === hard) meshes.push(mesh);
  });
  let back = -Infinity;
  let front = Infinity;
  const at: Float32Array[] = [];
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    _bm.multiplyMatrices(_bi, mesh.matrixWorld);
    const p = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _be.fromBufferAttribute(pos, i).applyMatrix4(_bm);
      p[i * 3] = _be.x; p[i * 3 + 1] = _be.y; p[i * 3 + 2] = _be.z;
      if (_be.z > back) back = _be.z;
      if (_be.z < front) front = _be.z;
    }
    at.push(p);
  }
  meshes.forEach((mesh, k) => {
    const p = at[k]!;
    const n = p.length / 3;
    const reach = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
      let near = Infinity;
      for (const s of sights) near = Math.min(near, Math.hypot(x - s[0], y - s[1], z - s[2]));
      reach[i * 2] = reachByte(z, back, front);
      reach[i * 2 + 1] = clearByte(near);
    }
    mesh.geometry.setAttribute('aBlood', new THREE.BufferAttribute(reach, 2, true));
  });
}
const _mInv = new THREE.Matrix4();
const _mHand = new THREE.Matrix4();
const _moonHit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };

/** Eye relief when a ViewDef gives a sight and no `relief`. */
const RELIEF = 0.2;
/** Radians a Gun Kata shot snaps a gun toward its man, at most: past it the tracer does the pointing. */
const KATA_SNAP = 0.55;
/** An akimbo reload: both guns go down off the screen over this share of it, stay down, and come back up over the last. */
const AK_DROP = 0.2;
/** The share of breathing, bob, look lag and body inertia a gun keeps when fully aimed. */
const ADS_SWAY = 0.2;

/** The share of a move's weapon pose that a working gun keeps. */
const MOVE_CALM = 0.2;

/**
 * The left hand's grip on a weapon in the hand-off is the right hand's, mirrored across the gun's centre plane. These nudge
 * it, in the gun's frame, on a weapon where the mirror lands the palm on something.
 */
const LEFT_GRIP: Partial<Record<string, readonly [number, number, number]>> = {};

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
  /** Written by `resolveHand`. */
  private held = 0;
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
  /** Aim down sights, eased, as the weapon system sets it. */
  private aimW = 0;
  private akimbo = false;
  private akimboW = 0;
  /** 0 to 1: how far down both guns are in an akimbo reload. */
  private akDrop = 0;
  /** 0 to 1: how far down the akimbo left gun is while the left hand does the off hand's work (offhand.ts `leftGunAway`). */
  private leftAway = 0;
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
  /** The player's body layer for this frame, or null where the player is a stand-in. See src/player/moveAnim.ts. */
  private move: MovePose | null = null;
  /** How much of a move's weapon pose shows. It drops while the gun is working, so a shot is never fired from a dipped gun. */
  private moveCalm = 1;
  /** How free the left hand is to leave the weapon for a ledge or a wall. */
  private handFree = 1;
  private readonly moveHand = new HandCtl();
  /** How free the gun is to pass to the left hand: a reload, a swing, a draw, akimbo or a device in the hand take it back. */
  private swapFree = 1;
  /** How far the gun is in the left hand this frame, and the sign that mirrors a side-to-side term with it: 1 to -1. */
  private swapW = 0;
  private gunSide = 1;
  private readonly swapHand = new HandCtl();
  private readonly wallHand = new HandCtl();
  private legs!: Legs;
  /** Each gun's rotation as composed this frame, which `settleMuzzle` needs to take a move back out of it. */
  private readonly gunRot = new THREE.Vector3();
  private readonly gunLRot = new THREE.Vector3();
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
  private moonTarget = 1;
  private moonProbe = 0;
  private moonProbesLeft = MOON_PROBES.length;
  private moonClock = 0;
  private readonly moonLastEye = new THREE.Vector3(Infinity, Infinity, Infinity);
  private lookCacheVer = -1;
  private readonly lookCache = new Map<ViewDef, { sight?: ModLook; muzzle?: ModLook; flip?: ModLook; laser?: ModLook }>();
  /**
   * The weapon light's beam (weapons/mods.ts LIGHT_GUNS): one spotlight made at boot and kept in the world, dark while no fitted
   * light is in hand. Adding or taking away a light recompiles every lit shader; a dark one costs a skipped branch (patch.ts).
   */
  private readonly torch = new THREE.SpotLight(TORCH_BEAM.color, 0, TORCH_BEAM.range, TORCH_BEAM.cone, TORCH_BEAM.soft, TORCH_BEAM.decay);
  /** A fitted laser module's beams and dot (lam.ts), and the one ray a frame it costs: down the camera's centre, walls then men. */
  private readonly lam = new LamBeams();
  private readonly lamCast: LaserCast = (from, dir, max, out) => {
    const wall = this.ctx.physics.raycastInto(from, dir, max, CG.World, out) === true;
    const man = this.ctx.enemies?.raycast(from, dir, wall ? out.distance : max);
    if (!man) return wall;
    out.point.copy(man.point);
    out.normal.copy(man.normal);
    out.distance = man.distance;
    return true;
  };

  // Perk looks.
  private perkHeat = 0;
  private perkHeatOn = false;
  private rage = 0;
  private rageOn = false;
  private frost = 0;
  private frostLeft = 0;

  // Blood on the weapon and the hands (blood.ts): a coat per gun, kept while it is put away, and one per glove.
  private readonly coats = new Map<string, BloodCoat>();
  private readonly handCoats: readonly [BloodCoat, BloodCoat] = [new BloodCoat(), new BloodCoat()];
  /** Player time since the rig was made: what the blood dries by. */
  private bloodClock = 0;

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
      (def.id.endsWith('Left') ? this.gunL : this.gun).add(def.model.root);
      bakeReach(def, this.mats.hard);
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
    this.legs = new Legs(kit);
    this.root.add(this.legs.root);
    this.moveHand.base = 'move';

    render.viewScene.add(this.root);
    render.scene?.add(this.torch, this.torch.target, this.lam.mesh);
    render.viewScene.add(this.lam.overlay);
    this.lam.viewCamera = render.viewCamera;
    this.lam.cast = this.lamCast;

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
      on('stim:inject', () => this.offhand.inject()),
      on('enemy:killed', e => this.onKill(e)),
      on('enemy:hit', e => this.onStrike(e.enemy, e.damage, e.result.dealt)),
      on('run:start', () => this.cleanBlood()),
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
    this.aimW = 0;
    this.akimbo = false;
    this.akimboW = 0;
    this.leftAway = 0;
    this.perkHeat = 0;
    this.perkHeatOn = false;
    this.rage = 0;
    this.rageOn = false;
    this.frost = 0;
    this.frostLeft = 0;
    this.lastMag = -1;
    this.lastBucket = -1;
    this.lastGrenades = -1;
    this.moonLastEye.set(Infinity, Infinity, Infinity);
    this.moonProbesLeft = MOON_PROBES.length;
    this.lookCacheVer = -1;
    this.lookCache.clear();
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
    // A new gun's twin comes up from below with its draw: after a quick melee's blade too, which has none and takes the hand.
    if (!same) this.akimboW = 0;
    this.def = def;
    // The gun's akimbo twin (models/index.ts `leftOf`), if it has one: shown while akimbo is on.
    if (this.defLeft && !same) this.defLeft.model.root.visible = false;
    this.defLeft = this.defs[`${id}Left`] ?? null;
    if (this.defLeft) {
      this.recoilLP.tune(this.defLeft.recoil.omega, this.defLeft.recoil.zeta);
      this.recoilLR.tune(this.defLeft.recoil.omega, this.defLeft.recoil.zeta);
    }
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
    // A shot brings the gun out of a move's pose at once, not over the next few frames: see `settleMuzzle`.
    this.moveCalm = Math.min(this.moveCalm, MOVE_CALM);
    a.shots++;
    a.strength = strength;
    a.heat = Math.min(1, a.heat + (def.heatPerShot ?? 0) * strength);
    const r = def.recoil;
    // A compensator's ports (ModLook.flip) hold the muzzle down.
    const flip = this.look(def, 'flip')?.flip ?? 1;
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
    o.x.x += r.pitch * flip * strength * jitter * snap;
    o.x.v += r.pitch * flip * strength * jitter * launch;
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

  kataSnap(left: boolean, yaw: number): void {
    // Straight onto the recoil spring's yaw: the gun is there this frame and the spring brings it home in a tenth of a second.
    const r = left ? this.recoilLR : this.recoilR;
    r.y.x = clamp(yaw, -KATA_SNAP, KATA_SNAP);
    r.y.v = 0;
  }

  setScoped(on: boolean): void {
    this.scoped = on;
  }

  setAim(weight: number): void {
    this.aimW = clamp(weight);
  }

  muzzle(out: THREE.Vector3, left = false, barrel = 0): THREE.Vector3 {
    const isLeft = left && this.akimboW > 0.01;
    const def = isLeft ? this.defLeft : this.def;
    const sockets = def?.model.sockets;
    const can = def ? this.look(def, 'muzzle')?.muzzle : undefined;
    const s = (barrel > 0 ? sockets?.[BARRELS[barrel] ?? ''] : undefined) ?? (can ? sockets?.[can] : undefined) ?? sockets?.muzzle;
    if (!s) return out;
    _a.setFromMatrixPosition(s.matrixWorld);
    this.settleMuzzle(_a, isLeft);
    return this.toWorld(_a, out);
  }

  /**
   * The weapon system reads the muzzle before it tells the rig about the shot, so the first round of a burst would
   * leave from wherever a climb or a hard landing had put the gun. While the gun carries more of a move than a working
   * gun keeps, the muzzle is answered from where `fire` is about to put it: the flash and the gun agree on that frame.
   */
  private settleMuzzle(point: THREE.Vector3, left: boolean): void {
    const mv = this.move;
    const k = this.moveCalm - MOVE_CALM;
    if (!mv || k < 0.01) return;
    const gun = left ? this.gunL : this.gun;
    const rot = left ? this.gunLRot : this.gunRot;
    const side = left ? -1 : this.gunSide;
    gun.worldToLocal(point);
    _gunEuler.set(rot.x - mv.gunPitch * k, rot.y - side * mv.gunYaw * k, rot.z - side * mv.gunRoll * k);
    point.multiply(gun.scale).applyQuaternion(_q.setFromEuler(_gunEuler));
    point.x += gun.position.x - side * mv.gunX * k;
    point.y += gun.position.y - mv.gunY * k;
    point.z += gun.position.z - mv.gunZ * k;
    this.root.localToWorld(point);
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

  // --- Blood on the weapon and the hands -----------------------------------------------------------

  /** A blow of the blade in the hands: the weapon named by the damage is the one held. */
  private byBlade(d: DamageInfo): boolean {
    return (d.type === 'melee' || d.type === 'slash') && this.def !== null && d.source.startsWith(this.def.id);
  }

  private onKill(e: KillEvent): void {
    if (e.enemy.machine) return;
    const d = e.damage;
    const from = e.enemy.center;
    const amount = killBlood(d.type, e.gibbed, e.headshot, e.sliced, d.vaporize === true) * closeness(from.distanceTo(this.ctx.player.eye));
    this.spatter(from, amount, this.byBlade(d));
  }

  /** Every blow of a blade that lands leaves blood on it, kill or not. */
  private onStrike(enemy: EnemyInstance, d: DamageInfo, dealt: number): void {
    if (enemy.machine || !(dealt > 0) || !this.byBlade(d)) return;
    this.spatter(d.point, VmBloodTuning.blow * closeness(d.point.distanceTo(this.ctx.player.eye)), true);
  }

  /**
   * Blood thrown at the player from `from`, a world position: `amount` 0 to 1 of it lands on the weapon in the hands, and a
   * share on the gloves. `blade`: the weapon was in the body, so it is covered more evenly along its length.
   */
  spatter(from: THREE.Vector3, amount: number, blade = false): void {
    if (!DevFlags.vmBlood || !(amount > 0.004)) return;
    const render = this.ctx.render;
    _bd.copy(from).sub(this.ctx.player.eye);
    if (_bd.lengthSq() < 1e-6) _bd.set(0, 0, -1);
    else _bd.normalize().transformDirection(render.camera.matrixWorldInverse).transformDirection(render.viewCamera.matrixWorld);
    this.spatterView(_bd, amount, blade);
  }

  /** The same, from a direction in the view's own space (-Z ahead, +X right). */
  spatterView(dir: THREE.Vector3, amount: number, blade = false): void {
    if (!DevFlags.vmBlood || !(amount > 0.004)) return;
    const T = VmBloodTuning;
    const now = this.bloodClock;
    // Blood falls, so what faces up takes more of it than what faces down.
    _bd.copy(dir).normalize();
    _bd.y += T.rain;
    _bd.normalize();
    const def = this.def;
    if (def) {
      let coat = this.coats.get(def.id);
      if (!coat) this.coats.set(def.id, coat = new BloodCoat());
      def.model.root.getWorldQuaternion(_bq).invert();
      _be.copy(_bd).applyQuaternion(_bq);
      if (blade) {
        // The blade went through him: wet on every side, and drawn out along its own length (-Z), so that is the way
        // the blood runs on it, leaning toward wherever the body was.
        _be.multiplyScalar(0.3);
        _be.z -= 1;
        _be.normalize();
      }
      coat.add(_be.x, _be.y, _be.z, amount, now, blade ? T.evenShareMelee : T.evenShare, Math.random, blade ? 1 : 0);
    }
    const share = amount * (blade ? T.handsMelee : T.hands);
    const arms = [this.armR, this.armL];
    for (let i = 0; i < 2; i++) {
      // A glove's blood is kept in the hand's own frame: it stays where it landed however the fingers move after.
      arms[i]!.bones[HAND_BONE]!.getWorldQuaternion(_bq).invert();
      _be.copy(_bd).applyQuaternion(_bq);
      this.handCoats[i]!.add(_be.x, _be.y, _be.z, share, now, T.evenShare, Math.random);
    }
  }

  /** Every gun and both gloves clean: a new run. */
  cleanBlood(): void {
    for (const coat of this.coats.values()) coat.clear();
    this.handCoats[0].clear();
    this.handCoats[1].clear();
  }

  /** Hands the shader this frame's blood: the coat of the gun that is out, and each glove's. */
  private updateBlood(dt: number): void {
    this.bloodClock += dt;
    const b = this.mats.blood;
    const now = this.bloodClock;
    const on = DevFlags.vmBlood;
    const coat = this.def ? this.coats.get(this.def.id) : undefined;
    b.gun.uBloodOn.value = on && coat ? coat.write(now, b.gun.uBloodA.value, b.gun.uBloodB.value) : 0;
    b.handR.uBloodOn.value = on ? this.handCoats[0].write(now, b.handR.uBloodA.value, b.handR.uBloodB.value) : 0;
    b.handL.uBloodOn.value = on ? this.handCoats[1].write(now, b.handL.uBloodA.value, b.handL.uBloodB.value) : 0;
  }

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
    // Akimbo has no reload clip: the hands stay on the grips and both guns drop off the screen and come back (`akDrop`).
    const akReload = this.akimbo && this.defLeft ? a.reload : -1;
    this.akDrop = akReload >= 0 ? smoothstep(0, AK_DROP, akReload) * (1 - smoothstep(1 - AK_DROP, 1, akReload)) : 0;
    if (akReload >= 0) a.reload = -1;

    a.gunP.set(0, 0, 0);
    a.gunR.set(0, 0, 0);
    def.model.resetParts();
    a.right.begin(def.right);
    a.left.begin(def.left);
    this.readAmmo(def);
    a.mods = this.ctx.weapons.fitted ?? null;
    a.alt = this.ctx.weapons.launcherUp === true;
    a.aim = this.aimW;
    this.readSmart(a, dt);
    def.animate(a);
    this.dressMods(def);
    this.composeGun(def, a);
    this.gun.updateMatrixWorld(true);

    let akimboOn = false;
    const dl = this.defLeft;
    if (dl) {
      this.akimboW = damp(this.akimboW, this.akimbo ? 1 : 0, 16, dt);
      // A grenade, a call-in device, the visor tap, a stim: the left hand leaves its gun, so the gun goes down out of shot first.
      this.leftAway = leftGunAway(this.leftAway, this.offhand.leftWeight, dt);
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
        // Its clip dresses by the fitted mods too: the compensator's lower flip.
        b.mods = a.mods;
        b.reload = -1;
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
        this.readSmart(b, dt, this.ctx.weapons.smartAimLeft);
        dl.animate(b);
        // A pistol's clip pulls the right hand's trigger; this gun's is the left's.
        if (!dl.right) b.left.trigger = Math.max(b.left.trigger, b.right.trigger);
        this.dressMods(dl);
        this.composeLeftGun(dl, b);
        this.gunL.updateMatrixWorld(true);
      }
    }

    this.offhand.update(dt);
    this.solveArms(def, dl, akimboOn, dt);
    if (akReload >= 0) a.reload = akReload;
    this.legs.update(this.gun.visible ? this.move : null, this.ctx.player.pitch, dt);
    this.updateLooks(dt);
    this.updateBlood(dt);
    this.updateMoon(dt);
    this.updateWrist(dt);
    this.updateLight(def);
    this.updateLam(def, 0, a.draw);
    this.updateLam(dl && akimboOn ? dl : null, 1, this.akimboW);
    this.lam.aim = this.aimW;
  }

  /** Slot `slot`'s laser: its fitted module's emitter while its gun shows, at `strength` (400 m for the Rocket's guided laser). */
  private updateLam(def: ViewDef | null, slot: number, strength: number): void {
    if (def && def.id === 'rocket' && slot === 0 && this.holsterW < 1 && ROCKET_LASER.on) {
      const socket = def.model.sockets.lam ?? null;
      this.lam.set(0, socket, strength, ROCKET_LAM_RANGE);
      return;
    }
    const id = def && this.holsterW < 1 ? this.look(def, 'laser')?.laser : undefined;
    let s: THREE.Object3D | null | undefined = id ? def!.model.sockets[id] : undefined;
    const socket = s ?? null;
    // Every part over it shown: the module is fitted and its gun is in shot.
    for (; s; s = s.parent) if (!s.visible) break;
    this.lam.set(slot, s ? null : socket, strength);
  }

  /** From the muzzle to the point 20 m down the line of sight, while the gun in hand has its light fitted. */
  private updateLight(def: ViewDef): void {
    const t = this.torch;
    t.intensity = this.holsterW < 1 && this.ctx.weapons.fitted?.has(`${def.id}Light` as ModId) ? TORCH_BEAM.candela : 0;
    if (t.intensity === 0) return;
    this.muzzle(t.position);
    // muzzle() leaves the look in _q.
    t.target.position.set(0, 0, -20).applyQuaternion(_q).add(this.ctx.player.eye);
    t.updateMatrixWorld();
    t.target.updateMatrixWorld();
  }

  private updateMoon(dt: number): void {
    if (!this.viewMoon) return;
    this.moonClock -= dt;
    if (this.moonClock <= 0) {
      this.moonClock = MOON_RAY_INTERVAL;
      const eye = this.ctx.player.eye;
      if (eye.distanceToSquared(this.moonLastEye) >= 0.05 * 0.05) {
        this.moonLastEye.copy(eye);
        this.moonProbesLeft = MOON_PROBES.length;
      }
      if (this.moonProbesLeft > 0) {
        this.moonProbesLeft--;
        const o = MOON_PROBES[this.moonProbe]!;
        this.moonProbe = (this.moonProbe + 1) % MOON_PROBES.length;
        _moonFrom.copy(eye);
        _moonFrom.x += o[0];
        _moonFrom.y += o[1];
        _moonFrom.z += o[2];
        const blocked = this.ctx.physics.raycastInto(_moonFrom, this.moonDir, MOON_REACH, CG.World, _moonHit);
        this.moonTarget = blocked ? 0 : 1;
        this.moonOpen = damp(this.moonOpen, this.moonTarget, 1 / (MOON_RAY_INTERVAL * MOON_PROBES.length), MOON_RAY_INTERVAL);
      } else if (Math.abs(this.moonOpen - this.moonTarget) >= 0.002) {
        this.moonOpen = damp(this.moonOpen, this.moonTarget, 1 / (MOON_RAY_INTERVAL * MOON_PROBES.length), MOON_RAY_INTERVAL);
      }
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
    // A stand-in player answers every read with a proxy, so the layer is only trusted when it holds numbers.
    const pose = p.moveAnim;
    this.move = pose && typeof pose.handW === 'number' ? pose : null;
    const working = a.sinceFire < 0.35 || a.reload >= 0 || a.swing !== null || a.draw < 1;
    this.moveCalm = damp(this.moveCalm, working ? MOVE_CALM : 1, working ? 30 : 9, dt);
    const busy = a.reload >= 0 || a.swing !== null || this.akimbo || a.draw < 1;
    this.handFree = damp(this.handFree, busy ? 0 : 1, 16, dt);
    // A blow is struck from the right hand, so a swing takes the weapon back at once and the hand-off rides its wind-up.
    this.swapFree = damp(this.swapFree, busy || this.offhand.leftWeight > 0.001 ? 0 : 1, a.swing !== null ? 40 : 16, dt);
    this.swapW = this.move ? this.move.swap * this.swapFree : 0;
    if (this.swapW < 1e-3) this.swapW = 0;
    this.gunSide = 1 - 2 * this.swapW;

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

    // Aim down sights: the sight comes onto the eye line, square to the view. x goes in before the hand-off's mirror, which
    // multiplies it by the gun's side, so the sight is centred from either hand. Sway falls to `ADS_SWAY` of itself.
    // A fitted optic (the Harrow's red dot) brings its own sight picture.
    const fit = this.look(def, 'sight');
    const sight = fit?.sight ?? def.sight;
    const aim = sight ? this.aimW : 0;
    if (sight && aim > 0) {
      // Iron sights: pitch so the rear lines up with the front, then put the front on the eye line.
      const rear = fit?.rear !== undefined ? fit.rear : def.rear;
      const pitch = rear ? Math.atan2(rear[1] - sight[1], rear[2] - sight[2]) : 0;
      const c = Math.cos(pitch);
      const s = Math.sin(pitch);
      const y = sight[1] * c - sight[2] * s;
      const z = sight[1] * s + sight[2] * c;
      p.x = lerp(p.x, -sight[0] * this.gunSide, aim);
      p.y = lerp(p.y, -y, aim);
      p.z = lerp(p.z, -(fit?.relief ?? def.relief ?? RELIEF) - z, aim);
      r.set(lerp(r.x, pitch, aim), r.y * (1 - aim), r.z * (1 - aim));
    }
    const sway = 1 - (1 - ADS_SWAY) * aim;

    // Akimbo pushes the main gun out to make room.
    const ak = this.akimboW;
    p.x += ak * 0.045;
    p.y -= ak * 0.015;
    r.y -= ak * 0.1;

    // Breathing: the slowest layer, gone once the player moves.
    const breath = idle * sway;
    p.y += Math.sin(t * 1.35) * 0.0013 * breath;
    p.x += Math.sin(t * 0.82 + 1) * 0.0008 * breath;
    r.x += Math.sin(t * 1.35 + 0.6) * 0.0028 * breath;
    r.z += Math.sin(t * 0.61) * 0.0022 * breath;

    // Synced to the footfalls CameraRig bobs to: side sway once per stride pair, drop on every footfall.
    const phase = this.ctx.player.stridePhase * Math.PI;
    const bob = this.bobW * sway;
    p.x += Math.cos(phase) * 0.0062 * bob;
    p.y += (0.0039 - Math.abs(Math.sin(phase)) * 0.0078) * bob;
    r.z += Math.cos(phase) * 0.012 * bob;
    r.x += (Math.abs(Math.sin(phase)) - 0.5) * 0.008 * bob;

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

    // The hand-off: the gun goes over to the left hand as its mirror image in place, but it is the same model, so the eye
    // sees its other side. It dips under the view on the way across. Every side-to-side term after this one is mirrored by
    // `m`; the motion springs, which answer the body and not the hand, are not.
    const sw = this.swapW;
    const m = this.gunSide;
    if (sw > 0) {
      p.x *= m;
      r.y *= m;
      r.z *= m;
      const arc = Math.sin(Math.PI * sw);
      p.y -= 0.03 * arc;
      p.z += 0.02 * arc;
      r.x -= 0.18 * arc;
    }

    const wall = this.wallW * this.wallSide * sway;
    p.x -= wall * 0.016;
    r.z -= wall * 0.17;
    r.y += wall * 0.03;

    // Slam: gun thrown up and forward as the player drives down.
    p.y += this.slamW * 0.05;
    r.x += this.slamW * 0.25;

    // Air: a slight float as the arms lose their ground reference.
    p.y += this.airW * 0.006;

    // The body layer: what a mantle, a vault, a hard landing and the rest do to the weapon.
    const mv = this.move;
    if (mv) {
      const c = this.moveCalm;
      p.x += mv.gunX * c * m;
      p.y += mv.gunY * c;
      p.z += mv.gunZ * c;
      r.x += mv.gunPitch * c;
      r.y += mv.gunYaw * c * m;
      r.z += mv.gunRoll * c * m;
    }

    p.x += (this.lookP.x.x + this.moveP.x.x) * sway;
    p.y += (this.lookP.y.x + this.moveP.y.x) * sway;
    p.z += this.moveP.z.x * sway;
    r.x += (this.lookR.x.x + this.moveR.x.x) * sway;
    r.y += (this.lookR.y.x + this.moveR.y.x) * sway;
    r.z += (this.lookR.z.x + this.moveR.z.x) * sway;

    // Recoil and clip motion.
    p.x += this.recoilP.x.x + a.gunP.x * m;
    p.y += this.recoilP.y.x + a.gunP.y;
    p.z += this.recoilP.z.x + a.gunP.z + this.settle.x * 0.008;
    r.x += this.recoilR.x.x + a.gunR.x + this.settle.x * 0.02;
    r.y += this.recoilR.y.x + a.gunR.y * m;
    r.z += this.recoilR.z.x + a.gunR.z * m;

    // Draw and holster share one curve.
    const raise = a.draw < 1 ? 1 - outBack(a.draw, 1.2) : 0;
    const lower = inQuad(this.holsterW);
    const k = Math.max(raise, lower, this.akDrop);
    p.y += k * DRAW_Y;
    p.z += k * DRAW_Z;
    r.x += k * DRAW_PITCH;
    r.z += k * DRAW_ROLL * m;

    // Scope: the gun comes up to the eye just before the overlay takes over. A gun with a `scopeEye` (the autocannon's sight,
    // off its left flank) brings that onto the eye line; one without brings its middle in.
    const sc = this.scopeW;
    const eye = def.scopeEye;
    p.x -= sc * (eye ? def.pos[0] + eye[0] : def.pos[0] * 0.9) * m;
    p.y += sc * (eye ? -(def.pos[1] + eye[1]) : 0.05);
    r.y -= sc * def.rot[1] * m;

    this.gun.position.copy(p);
    this.gunRot.copy(r);
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
    // An akimbo reload takes it down with the right one, as a holster does, mirrored; so does the left hand's own work.
    const drop = Math.max(this.akDrop, this.leftAway);
    p.y += drop * DRAW_Y;
    p.z += drop * DRAW_Z;
    r.x += drop * DRAW_PITCH;
    r.z -= drop * DRAW_ROLL;
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
    // The body layer, mirrored.
    const mv = this.move;
    if (mv) {
      const c = this.moveCalm;
      p.x -= mv.gunX * c;
      p.y += mv.gunY * c;
      p.z += mv.gunZ * c;
      r.x += mv.gunPitch * c;
      r.y -= mv.gunYaw * c;
      r.z -= mv.gunRoll * c;
    }
    this.gunL.position.copy(p);
    this.gunLRot.copy(r);
    _gunEuler.set(r.x, r.y, r.z);
    this.gunL.quaternion.setFromEuler(_gunEuler);
    this.gunL.visible = this.gun.visible && drop < 0.995;
  }

  /** Finds a socket on the model, or a view-space anchor on the rig. */
  socket(model: Model, name: string): THREE.Object3D | null {
    return model.sockets[name] ?? this.anchors[name] ?? this.offhand.sockets[name] ?? null;
  }

  /** Sets `held`: the share of the result that is the hand's own grip socket, against a clip's reach for a magazine. */
  private resolveHand(h: HandCtl, model: Model, outP: THREE.Vector3, outQ: THREE.Quaternion): boolean {
    this.held = 0;
    if (!h.base) return false;
    const base = this.socket(model, h.base);
    if (!base) return false;
    base.updateWorldMatrix(true, false);
    base.matrixWorld.decompose(outP, outQ, _s);
    this.held = 1;
    for (let i = 0; i < h.steps; i++) {
      const s = this.socket(model, h.names[i]!);
      if (!s) continue;
      s.updateWorldMatrix(true, false);
      s.matrixWorld.decompose(_p, _q, _s);
      const w = h.weights[i]!;
      outP.lerp(_p, w);
      outQ.slerp(_q, w);
      this.held += ((h.names[i] === h.base ? 1 : 0) - this.held) * w;
    }
    outP.add(h.nudge);
    return true;
  }

  private solveArms(def: ViewDef, defLeft: ViewDef | null, akimbo: boolean, dt: number): void {
    const a = this.a;
    const shown = this.gun.visible;
    const off = this.offhand;
    const rightOk = shown && this.resolveHand(a.right, def.model, _a, _qa);
    const heldR = this.held;
    const mv = this.move;
    // In the hand-off the left hand takes the right hand's grip, mirrored across the gun, while the right goes to the wall.
    const sw = rightOk ? this.swapW : 0;
    if (sw > 0) this.mirrorGrip(def.id, _a, _qa, _c, _qc);
    this.armR.mesh.visible = rightOk;
    if (rightOk) {
      let hand = a.right;
      const ww = mv && mv.handSide > 0 ? mv.handW * this.swapFree : 0;
      if (mv && ww > 0.001) {
        _p.set(-mv.handX, mv.handY, mv.handZ);
        _q.setFromEuler(_eu.set(mv.handPitch, -mv.handYaw, -mv.handRoll));
        _a.lerp(_p, ww);
        _qa.slerp(_q, ww);
        const out = this.wallHand.pose;
        const open = mv.handOpen * ww;
        for (let i = 0; i < out.length; i++) out[i] = hand.pose[i]! + (HANDS.open[i]! - hand.pose[i]!) * open;
        this.wallHand.fingerRate = 22;
        hand = this.wallHand;
      }
      this.fingers(this.armR, hand, dt);
      this.armR.applyPose();
      this.armR.solve(_a, _qa, SHOULDER_R, POLE_R, heldR * (1 - ww));
    }

    let leftOk = shown && this.resolveHand(a.left, def.model, _b, _qb);
    let heldL = this.held;
    let hand = a.left;
    const gw = smoothstep(0.15, 0.6, sw);
    if (gw > 0) {
      // A one-handed weapon has no left hand to start from: it comes up from below.
      if (!leftOk) {
        this.anchors.pouchL!.matrixWorld.decompose(_b, _qb, _s);
        leftOk = true;
      }
      _b.lerp(_c, gw);
      _qb.slerp(_qc, gw);
      heldL += (heldR - heldL) * gw;
      const out = this.swapHand.pose;
      for (let i = 0; i < out.length; i++) out[i] = hand.pose[i]! + (a.right.pose[i]! - hand.pose[i]!) * gw;
      this.swapHand.trigger = a.right.trigger * gw;
      hand = this.swapHand;
    }
    if (akimbo && defLeft) {
      const k = this.akimboW;
      if (this.resolveHand(this.a2.left, defLeft.model, _p, _q)) {
        if (!leftOk) { _b.copy(_p); _qb.copy(_q); leftOk = true; }
        _b.lerp(_p, k);
        _qb.slerp(_q, k);
        heldL += (this.held - heldL) * k;
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
    // A move takes the hand last and gives way to everything above: a ledge, the top of cover, a wall, the floor.
    const mw = mv && shown && mv.handSide < 0 ? mv.handW * this.handFree * (1 - ow) : 0;
    if (mv && mw > 0.001 && leftOk) {
      _p.set(mv.handX, mv.handY, mv.handZ);
      _q.setFromEuler(_eu.set(mv.handPitch, mv.handYaw, mv.handRoll));
      _b.lerp(_p, mw);
      _qb.slerp(_q, mw);
      const open = mv.handOpen * mw;
      const out = this.moveHand.pose;
      for (let i = 0; i < out.length; i++) out[i] = hand.pose[i]! + (HANDS.open[i]! - hand.pose[i]!) * open;
      this.moveHand.fingerRate = 22;
      hand = this.moveHand;
    }
    this.armL.mesh.visible = leftOk;
    if (leftOk) {
      this.fingers(this.armL, hand, dt);
      this.armL.applyPose();
      this.armL.solve(_b, _qb, SHOULDER_L, POLE_L, heldL * (1 - ow) * (1 - mw));
    }
  }

  /** The right hand's target on the gun, reflected across the gun's own centre plane, for the left arm (itself a reflection). */
  private mirrorGrip(id: string, p: THREE.Vector3, q: THREE.Quaternion, outP: THREE.Vector3, outQ: THREE.Quaternion): void {
    _mInv.copy(this.gun.matrixWorld).invert();
    _mHand.compose(p, q, _one).premultiply(_mInv).decompose(outP, outQ, _s);
    outP.x = -outP.x;
    outQ.y = -outQ.y;
    outQ.z = -outQ.z;
    const nudge = LEFT_GRIP[id];
    if (nudge) {
      outP.x += nudge[0];
      outP.y += nudge[1];
      outP.z += nudge[2];
    }
    _mHand.compose(outP, outQ, _s).premultiply(this.gun.matrixWorld).decompose(outP, outQ, _s);
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
    this.maskScope();
    this.pollDevices();
  }

  /**
   * Aimed through a magnified optic, the gun's surfaces behind its eyepiece and inside its clear circle are not drawn
   * (VmUniforms.uScope): the circle shows the world at the camera's zoom, the reticle and the eyepiece's dark rim.
   */
  private maskScope(): void {
    const scope = this.mats.uniforms.uScope.value;
    scope.z = 0;
    const def = this.def;
    const eye = def && this.aimW >= INNER_AT ? this.look(def, 'sight')?.eye : undefined;
    const s = eye ? def!.model.sockets[eye.socket] : undefined;
    if (!eye || !s) return;
    const cam = this.ctx.render.viewCamera;
    _a.setFromMatrixPosition(s.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
    const depth = -_a.z;
    if (depth <= 0) return;
    _a.applyMatrix4(cam.projectionMatrix);
    scope.set(_a.x, _a.y, eye.radius / depth / Math.tan((cam.fov * Math.PI) / 360), depth + 0.003);
    this.mats.uniforms.uScopeAspect.value = cam.aspect;
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
    g.fillStyle = '#0c0606';
    g.fillRect(0, 0, w, h);
    // The Bureau's red; amber when he is low, as a downed ally's beacon turns.
    const low = hp / mx < 0.3;
    const hue = low ? '#ffb030' : '#ff3a2a';
    g.fillStyle = hue;
    g.font = '700 46px "Courier New", monospace';
    g.textBaseline = 'top';
    g.fillText(String(hp).padStart(3, '0'), 8, 6);
    g.font = '700 18px "Courier New", monospace';
    g.fillText('VIT', 112, 12);
    g.fillRect(8, 58, (w - 16) * clamp(hp / mx), 9);
    g.fillStyle = '#9a9ea6';
    g.fillRect(8, 72, (w - 16) * clamp(ar / 100), 5);
    g.font = '700 22px "Courier New", monospace';
    g.fillText(`${String(Math.round(this.a.speed)).padStart(2, '0')} M/S`, 8, 88);
    texture.needsUpdate = true;
  }

  /** The smart aim's state for the clip, eased: on, locked, and the locked head's bearing off the view's centre. */
  /** `v`: the gun's smart aim, the left gun's own with the Autoraffica akimbo. */
  private readSmart(a: Anim, dt: number, v = this.ctx.weapons.smartAim): void {
    const lock = v?.on ? v.lock : null;
    // Aimed down sights the gun holds still on its sights: the smart aim's turn would throw the sight picture off.
    const free = 1 - this.aimW;
    a.smart = damp(a.smart, v?.on ? free : 0, 10, dt);
    a.lock = damp(a.lock, lock ? free : 0, 22, dt);
    if (!lock) return;
    const cam = this.ctx.render.camera;
    _smart.copy(lock).applyMatrix4(cam.matrixWorldInverse);
    const ahead = Math.max(-_smart.z, 0.1);
    a.lockYaw = damp(a.lockYaw, Math.atan2(-_smart.x, ahead), 26, dt);
    a.lockPitch = damp(a.lockPitch, Math.atan2(_smart.y, ahead), 26, dt);
  }

  /** The look of the fitted mod on `def` that sets `key` (`weapons.fitted`): its optic's sight, its can's muzzle. */
  private look(def: ViewDef, key: 'sight' | 'muzzle' | 'flip' | 'laser'): ModLook | undefined {
    const mods = def.mods;
    const fitted = this.ctx.weapons.fitted;
    if (!mods || !fitted) return undefined;
    const ver = (this.ctx.weapons as { fittedVersion?: number }).fittedVersion;
    if (ver === undefined) {
      for (const id in mods) if (fitted.has(id as ModId) && mods[id as ModId]![key] !== undefined) return mods[id as ModId];
      return undefined;
    }
    if (ver !== this.lookCacheVer) {
      this.lookCacheVer = ver;
      this.lookCache.clear();
    }
    let entry = this.lookCache.get(def);
    if (!entry) {
      entry = {};
      for (const id in mods) {
        if (!fitted.has(id as ModId)) continue;
        const m = mods[id as ModId]!;
        if (entry.sight === undefined && m.sight !== undefined) entry.sight = m;
        if (entry.muzzle === undefined && m.muzzle !== undefined) entry.muzzle = m;
        if (entry.flip === undefined && m.flip !== undefined) entry.flip = m;
        if (entry.laser === undefined && m.laser !== undefined) entry.laser = m;
      }
      this.lookCache.set(def, entry);
    }
    return entry[key];
  }

  /** Every mod part shows only while its mod is fitted. After `resetParts`, which shows every part. */
  private dressMods(def: ViewDef): void {
    const mods = def.mods;
    if (!mods) return;
    const fitted = this.ctx.weapons.fitted;
    for (const id in mods) {
      const look = mods[id as ModId]!;
      const part = def.model.parts[look.part];
      const on = fitted?.has(id as ModId) === true;
      if (part) part.visible = on;
      if (look.also) {
        if (typeof look.also === 'string') {
          const also = def.model.parts[look.also];
          if (also) also.visible = on;
        } else {
          for (const name of look.also) {
            const also = def.model.parts[name];
            if (also) also.visible = on;
          }
        }
      }
      const own = look.hides && on ? def.model.parts[look.hides] : undefined;
      if (own) own.visible = false;
      const moved = look.moves && on ? def.model.parts[look.moves.part] : undefined;
      if (moved) moved.position.z += look.moves!.z;
      const inner = look.inner ? def.model.parts[look.inner] : undefined;
      if (inner) inner.visible = this.aimW < INNER_AT;
    }
    const irons = def.irons ? def.model.parts[def.irons] : undefined;
    if (irons) irons.visible = ironsUp(def, fitted);
  }

  get currentDef(): ViewDef | null {
    return this.def;
  }

  get allDefs(): Record<string, ViewDef> {
    return this.defs;
  }
}
