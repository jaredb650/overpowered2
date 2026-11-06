/**
 * The gunner's seat. Everything that is the same whichever aircraft it is bolted to: taking the view from the player,
 * leaving the body safe on the ground, reading the mouse as a gun on a mount, marking the enemies, and always handing
 * control back.
 *
 * `leave` is the only way out, and it undoes everything `board` and `sit` did, so any path out of the seat is safe:
 * rounds spent, time up, the key, death, or a new run.
 *
 * The seat's clock is the strike's, realDt: the aircraft flies through SLOWMO at full speed, and pause holds it.
 */
import * as THREE from 'three';
import { CG, type Ctx, type GradeName, type RayHit, type SeatView } from '../core/contracts';
import { clamp, wrapAngle } from '../core/math';
import type { Point } from '../progression/callins/airframe';
import type { GroundProbe } from '../progression/callins/ground';
import { GunnerHud, type GunnerTone, type GunnerWeapon } from './hud';
import { Skyline } from './skyline';

export interface SeatPlan {
  /** Top of the screen. */
  label: string;
  tone: GunnerTone;
  /** Time on station, once seated. */
  seconds: number;
  fov: number;
  zoomFov: number;
  /** True: hold `aim` to zoom. False: `aim` is a weapon, and the wheel toggles zoom. */
  aimZooms: boolean;
  /** Middle of the gun's arc, in radians left of the nose. */
  arcCenter: number;
  /** How far it swings either way. */
  arcHalf: number;
  pitchMin: number;
  pitchMax: number;
  /** Share of the aircraft's own motion the sight takes out, so the aim stays on the ground under it. 1 is a dead lock. */
  lock: number;
  /** Share of the aircraft's bank that reaches the horizon. */
  roll: number;
  /** Eye relative to the gun's pivot, along the aim: right, up, back. Negative back puts it ahead of the pivot. */
  eye: Point;
  /** How far the sight reads. */
  reach: number;
  /** Colour grade held while seated. Null leaves the perks in charge. */
  grade: GradeName | null;
  /** Silhouettes through walls, and the brackets round them. */
  enemyColor: string;
  /** Seconds the body stays untouchable once the player is back in it. */
  grace: number;
  /** Multiplies every shake that reaches the view. */
  shake: number;
}

export type SeatStage = 'boarding' | 'seated' | 'left';

/** Men with their hands up, marked apart: killing a prisoner has to stay the player's own decision. */
const PRISONER_COLOR = '#b9c8d2';
const PRISONER_STRENGTH = 0.8;
/** How far to look for floor under a body that was in the air when the call went out. */
const PARK_SEARCH = 60;
const SHELL_COLOR = '#39e0ff';
const SHELL_RADIUS = 1.7;
const SHELL_HEIGHT = 0.9;
const SHELL_SPIN = 0.6;
const CUT_FLASH = 0.5;
const CUT_SECONDS = 0.16;

const _up = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _to = new THREE.Vector3();
const _spot = new THREE.Vector3();

/** Where the body waits: under the player if that is honest ground, otherwise the nearest floor that is. */
function restingPlace(ctx: Ctx, out: THREE.Vector3): THREE.Vector3 {
  const { player, world } = ctx;
  if (player.grounded && !world.objects.hazardAt(player.position)) return out.copy(player.position);
  if (world.nav.nearest(player.position, PARK_SEARCH, out) && !world.objects.hazardAt(out)) return out;
  return out.copy(world.playerSpawns[0]?.position ?? player.position);
}

/** What the enemies are clawing at, and what the player looks for from the air. */
class BodyShell {
  readonly mesh: THREE.Mesh;

  constructor(ctx: Ctx) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(SHELL_COLOR).multiplyScalar(2.2), wireframe: true, toneMapped: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(SHELL_RADIUS, 1), material);
    this.mesh.name = 'seat.shell';
    this.mesh.visible = false;
    ctx.render.scene.add(this.mesh);
  }

  show(feet: THREE.Vector3): void {
    this.mesh.position.copy(feet);
    this.mesh.position.y += SHELL_HEIGHT;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    this.mesh.rotation.y += SHELL_SPIN * dt;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

/** The parts of the seat that exist once, built at load like the airframes. */
export class SeatRig {
  readonly hud: GunnerHud;
  readonly shell: BodyShell;
  readonly skyline: Skyline;
  /** By uid. Kept here because some will have surrendered before the aircraft was called. */
  readonly prisoners = new Set<number>();
  seat: GunnerSeat | null = null;

  constructor(ctx: Ctx, probe: GroundProbe, readonly holdGrade: (grade: GradeName | null) => void) {
    this.hud = new GunnerHud(ctx, this);
    this.shell = new BodyShell(ctx);
    this.skyline = new Skyline(ctx, probe);
    ctx.events.on('enemy:surrendered', e => this.prisoners.add(e.enemy.uid));
    ctx.events.on('run:start', () => {
      this.prisoners.clear();
      this.skyline.build();
    });
  }

  get occupied(): boolean {
    return this.seat !== null;
  }

  get shaders(): readonly THREE.Material[] {
    return [this.shell.mesh.material as THREE.Material];
  }

  /** Out of the seat now, wherever the strike has got to. */
  eject(): void {
    this.seat?.leave();
  }
}

export class GunnerSeat {
  stage: SeatStage = 'boarding';
  /** Seconds left on station. */
  left: number;
  yaw = 0;
  pitch = 0;
  readonly aim = new THREE.Vector3(0, 0, -1);
  /** Where the sight lands, or the end of its reach over open sky. */
  readonly point = new THREE.Vector3();
  /** Distance to `point`. */
  range = 0;
  zoomed = false;
  /** Metres above the floor below. The strike writes this. */
  altitude = 0;
  /** 0..1 for a gun that has to spin up. */
  spin = 0;
  readonly weapons: GunnerWeapon[] = [];
  readonly view: SeatView = { position: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, shake: 1 };

  /** True while `point` is on something, and the sight has a place on the ground to hold. */
  private locked = false;
  private readonly hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
  private readonly lit: THREE.Object3D[] = [];
  private readonly held: THREE.Object3D[] = [];

  constructor(private readonly ctx: Ctx, private readonly rig: SeatRig, readonly plan: SeatPlan) {
    this.left = plan.seconds;
    this.view.shake = plan.shake;
  }

  /** The view leaves the body. The player is safe from this frame on. */
  board(): void {
    const { camera, hud, player, render } = this.ctx;
    restingPlace(this.ctx, _spot);
    player.park(_spot);
    this.rig.seat = this;
    this.rig.shell.show(_spot);
    camera.setSeat(this.view);
    this.rig.hud.open(this);
    hud.seat(this.rig.hud);
    render.post.flash('#ffffff', CUT_FLASH, CUT_SECONDS);
  }

  /** Stands the view off the aircraft, for the look at it on the way in. */
  chase(eye: THREE.Vector3, target: THREE.Vector3): void {
    const v = this.view;
    v.position.copy(eye);
    _to.subVectors(target, eye);
    v.yaw = Math.atan2(-_to.x, -_to.z);
    v.pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
    v.roll = 0;
  }

  /** Into the seat itself, looking at `target`. */
  sit(target: THREE.Vector3, pivot: THREE.Vector3): void {
    const { camera, render } = this.ctx;
    this.stage = 'seated';
    _to.subVectors(target, pivot);
    this.yaw = Math.atan2(-_to.x, -_to.z);
    this.pitch = clamp(Math.atan2(_to.y, Math.hypot(_to.x, _to.z)), this.plan.pitchMin, this.plan.pitchMax);
    camera.setZoom(this.plan.fov);
    if (this.plan.grade) this.rig.holdGrade(this.plan.grade);
    render.post.flash('#ffffff', CUT_FLASH, CUT_SECONDS);
  }

  /** `frame` is the aircraft's orientation and `pivot` where the gun turns, both as flown this frame. */
  update(dt: number, frame: THREE.Quaternion, pivot: THREE.Vector3): void {
    this.mark();
    this.rig.shell.update(dt);
    if (this.stage !== 'seated') return;
    this.left = Math.max(0, this.left - dt);
    this.zoom();
    if (this.locked) this.holdGround(pivot);
    this.steer(frame);
    this.placeEye(pivot);
    this.horizon(frame);
    this.sight();
    this.ctx.camera.syncSeat();
  }

  /** Takes out what the aircraft's own motion did to the line of sight since last frame. */
  private holdGround(pivot: THREE.Vector3): void {
    this.placeEye(pivot);
    _to.subVectors(this.point, this.view.position);
    const { lock } = this.plan;
    this.yaw += wrapAngle(Math.atan2(-_to.x, -_to.z) - this.yaw) * lock;
    this.pitch += (Math.atan2(_to.y, Math.hypot(_to.x, _to.z)) - this.pitch) * lock;
  }

  private steer(frame: THREE.Quaternion): void {
    const { input, player } = this.ctx;
    const p = this.plan;
    const look = input.frameLook;
    const scale = player.sensitivity * player.lookScale;
    this.yaw -= look.x * scale;
    this.pitch -= look.y * scale * (player.invertY ? -1 : 1);
    _nose.set(0, 0, 1).applyQuaternion(frame);
    const middle = Math.atan2(-_nose.x, -_nose.z) + p.arcCenter;
    this.yaw = middle + clamp(wrapAngle(this.yaw - middle), -p.arcHalf, p.arcHalf);
    this.pitch = clamp(this.pitch, p.pitchMin, p.pitchMax);
  }

  private zoom(): void {
    const { camera, input } = this.ctx;
    const p = this.plan;
    if (p.aimZooms) this.zoomed = input.isDown('aim');
    else if (input.pressed('weaponNext') || input.pressed('weaponPrev')) this.zoomed = !this.zoomed;
    camera.setZoom(this.zoomed ? p.zoomFov : p.fov);
  }

  private placeEye(pivot: THREE.Vector3): void {
    const { eye } = this.plan;
    const cp = Math.cos(this.pitch);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.aim.set(-sy * cp, Math.sin(this.pitch), -cy * cp);
    _right.set(cy, 0, -sy);
    _camUp.crossVectors(_right, this.aim);
    const v = this.view;
    v.position.copy(pivot).addScaledVector(_right, eye[0]).addScaledVector(_camUp, eye[1]).addScaledVector(this.aim, -eye[2]);
    v.yaw = this.yaw;
    v.pitch = this.pitch;
  }

  /** How far the aircraft's up leans across this view. Looking out of a door, a bank tips the view forward, not sideways. */
  private horizon(frame: THREE.Quaternion): void {
    _up.set(0, 1, 0).applyQuaternion(frame);
    this.view.roll = -this.plan.roll * Math.atan2(_up.dot(_right), _up.dot(_camUp));
  }

  private sight(): void {
    const { physics } = this.ctx;
    const eye = this.view.position;
    this.locked = physics.raycastInto(eye, this.aim, this.plan.reach, CG.World, this.hit);
    if (this.locked) this.point.copy(this.hit.point);
    else this.point.copy(eye).addScaledVector(this.aim, this.plan.reach);
    this.range = this.locked ? this.hit.distance : this.plan.reach;
  }

  /** Every frame it should show: see RenderSystem.highlight. */
  private mark(): void {
    const { enemies, render } = this.ctx;
    const { lit, held } = this;
    const { prisoners } = this.rig;
    lit.length = 0;
    held.length = 0;
    for (const e of enemies.alive) (prisoners.has(e.uid) ? held : lit).push(e.char.mesh);
    render.highlight(lit, this.plan.enemyColor, 1);
    if (held.length > 0) render.highlight(held, PRISONER_COLOR, PRISONER_STRENGTH);
  }

  /** Back to the body, whatever state things are in. `quiet` is for a new run, which has its own cut. */
  leave(quiet = false): void {
    if (this.stage === 'left') return;
    this.stage = 'left';
    const { camera, hud, player, render } = this.ctx;
    this.rig.seat = null;
    this.rig.shell.hide();
    camera.setSeat(null);
    camera.setZoom(null);
    hud.seat(null);
    if (this.plan.grade) this.rig.holdGrade(null);
    player.unpark(quiet ? 0 : this.plan.grace);
    if (!quiet) render.post.flash('#ffffff', CUT_FLASH, CUT_SECONDS);
  }
}
