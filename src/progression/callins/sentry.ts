/**
 * The AA sentry: a squat twin 20 mm on a drop pod, the call-in on the Sentinels' old rung (combo 20).
 *
 * It falls on the mark as a supply pod does, rises out of its column and stands a minute. It shoots only what flies: the swarm's
 * drones, and the enemy's missiles climbing at the player's aircraft. The ground is left to the player, so it steals no kills
 * there and never blocks the view. Its rounds go through combat.fireRay with their tracers, so its kills pay like any strike's
 * (an assist: `sentry` in ASSIST_SOURCES). A missile held in its sight for `missileTrack` seconds bursts where it is.
 */
import * as THREE from 'three';
import { CG, type EmitterHandle } from '../../core/contracts';
import type { EnemyInstance, ShotSpec } from '../../core/gameplay';
import { clamp, damp, dampAngle, lerp, rand, smoothstep, TAU, wrapAngle } from '../../core/math';
import { CALLINS, SENTRY as S } from '../data';
import { ModelBuilder, type ModelMaterials } from '../modelkit';
import type { AntiAir, Missile } from './antiAir';
import { GroundRing } from './ground';
import { aboveFloor, type Strike, type StrikeKit, type StrikeOrder } from './shared';

const COLOR = CALLINS.sentry.color;
const STEEL = '#4a535d';
const DARK = '#262b31';
const BURNT = '#1a1715';
const IRON = '#14181c';
/** The yaw ring's height over the feet, stowed and raised. */
const STOWED = 0.5;
const RAISED = 1.05;
/** The pitch trunnion over the yaw ring, and the barrels' tips in the cradle's space (the guns point along -Z). */
const TRUNNION = 0.72;
const BORE_X = 0.17;
const MUZZLE_Z = -1.86;
const PITCH_MIN = -0.05;
const PITCH_MAX = 1.45;
const KICK = 0.14;

const _up = new THREE.Vector3(0, 1, 0);
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _p = new THREE.Vector3();

/** A 2D outline extruded `depth` with a chamfer on every edge, centred on its depth. */
function prism(points: readonly (readonly [number, number])[], depth: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4,
  });
  return geo.translate(0, 0, -(depth - bevel * 2) / 2);
}

function ngon(r: number, n: number, turn = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU + turn) * r, Math.sin((i / n) * TAU + turn) * r] as [number, number]);
}

const FLAT: readonly [number, number, number] = [-Math.PI / 2, 0, 0];
const ACROSS: readonly [number, number, number] = [0, Math.PI / 2, 0];
const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

/** The pod: a thruster skirt, an octagonal column and four splayed feet. Feet at the origin. */
function base(b: ModelBuilder): void {
  b.solid(prism(ngon(1.15, 8, Math.PI / 8), 0.34, 0.05), BURNT, { at: [0, 0.17, 0], rot: FLAT });
  b.solid(prism(ngon(0.86, 8, Math.PI / 8), 0.72, 0.05), DARK, { at: [0, 0.69, 0], rot: FLAT });
  b.solid(prism(ngon(0.72, 8, Math.PI / 8), 0.08, 0.02), STEEL, { at: [0, 1.06, 0], rot: FLAT });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // An outrigger raked down to a pad, with a strut back to the column.
    b.solid(prism([[0, -0.09], [0.95, -0.06], [0.95, 0.06], [0, 0.12]], 0.16, 0.03), STEEL, { at: [c * 0.75, 0.28, s * 0.75], rot: [0, -a, -0.32] });
    b.cyl(0.24, 0.27, 0.08, 10, IRON, { at: [c * 1.62, 0.04, s * 1.62] });
    b.box(0.08, 0.5, 0.08, DARK, { at: [c * 1.0, 0.62, s * 1.0], rot: [-s * 0.55, 0, c * 0.55] });
  }
  // Two vents a face and a thin cyan line round the column's waist.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.box(0.32, 0.05, 0.03, IRON, { at: [Math.sin(a) * 0.85, 0.56, Math.cos(a) * 0.85], rot: [0, a, 0] });
    b.box(0.32, 0.05, 0.03, IRON, { at: [Math.sin(a) * 0.85, 0.68, Math.cos(a) * 0.85], rot: [0, a, 0] });
    b.glow(new THREE.BoxGeometry(0.5, 0.018, 0.02), COLOR, 3, { at: [Math.sin(a) * 0.855, 0.9, Math.cos(a) * 0.855], rot: [0, a, 0] });
  }
}

/** What turns: the ring and the housing, with an ammunition box either side. The yaw pivot at the origin. */
function housing(b: ModelBuilder): void {
  b.cyl(0.62, 0.66, 0.14, 16, IRON, { at: [0, 0.07, 0] });
  // Side profile: a long low nose, a raked glacis, a flat back. u is forward.
  b.solid(prism([[-0.5, 0.12], [0.55, 0.12], [0.62, 0.3], [0.3, 0.6], [-0.38, 0.6], [-0.52, 0.42]], 0.92, 0.05), STEEL, { rot: ACROSS });
  b.box(0.7, 0.04, 0.5, DARK, { at: [0, 0.62, 0.05] });
  for (const s of [1, -1]) {
    b.solid(prism([[-0.25, 0], [0.25, 0], [0.25, 0.4], [-0.18, 0.44]], 0.3, 0.03), DARK, { at: [s * 0.63, 0.2, 0.02], rot: ACROSS });
    b.box(0.04, 0.3, 0.42, IRON, { at: [s * 0.79, 0.4, 0.02] });
    b.glow(new THREE.BoxGeometry(0.02, 0.02, 0.34), COLOR, 2.6, { at: [s * 0.8, 0.56, 0.02] });
  }
}

/** The cradle on its trunnion: cheek plates, the sensor head over them. The pitch pivot at the origin. */
function cradle(b: ModelBuilder): void {
  b.solid(prism([[-0.3, -0.18], [0.36, -0.18], [0.42, 0.02], [0.3, 0.2], [-0.3, 0.2]], 0.5, 0.04), DARK, { rot: ACROSS });
  for (const s of [1, -1]) b.cyl(0.11, 0.11, 0.1, 12, STEEL, { at: [s * 0.3, 0, 0], rot: [0, 0, Math.PI / 2] });
  // The fire-control head: a box on a post, its lens a slot of cyan.
  b.box(0.06, 0.18, 0.06, IRON, { at: [0, 0.29, 0.08] });
  b.solid(prism([[-0.16, 0], [0.18, 0], [0.18, 0.16], [-0.12, 0.18]], 0.26, 0.025), STEEL, { at: [0, 0.36, 0.06], rot: ACROSS });
  b.glow(new THREE.BoxGeometry(0.18, 0.025, 0.02), COLOR, 5, { at: [0, 0.45, -0.13] });
}

/** One barrel, which kicks back on its own. Its breech at the origin, pointing along -Z. */
function barrel(b: ModelBuilder): void {
  b.cyl(0.075, 0.08, 0.6, 12, STEEL, { at: [0, 0, -0.42], rot: ALONG_Z });
  for (const z of [-0.2, -0.38, -0.56]) b.cyl(0.088, 0.088, 0.035, 12, IRON, { at: [0, 0, z], rot: ALONG_Z });
  b.cyl(0.042, 0.048, 1.1, 10, IRON, { at: [0, 0, -1.25], rot: ALONG_Z });
  b.solid(prism([[-0.06, -0.06], [0.06, -0.06], [0.06, 0.06], [-0.06, 0.06]], 0.2, 0.015), DARK, { at: [0, 0, MUZZLE_Z + 0.1] });
  for (const s of [1, -1]) b.box(0.03, 0.08, 0.035, IRON, { at: [s * 0.062, 0, MUZZLE_Z + 0.08] });
}

/** The one sentry, built at load like the airframes, hidden between calls. */
export class SentryRig {
  readonly root = new THREE.Group();
  readonly yaw = new THREE.Group();
  readonly pitch = new THREE.Group();
  readonly barrels: readonly [THREE.Group, THREE.Group];

  constructor(materials: ModelMaterials, scene: THREE.Scene) {
    const parts = (build: (b: ModelBuilder) => void) => {
      const b = new ModelBuilder();
      build(b);
      return materials.group(b);
    };
    this.root.name = 'sentry';
    this.root.add(parts(base), this.yaw);
    this.yaw.add(parts(housing), this.pitch);
    this.pitch.position.y = TRUNNION;
    this.pitch.add(parts(cradle));
    const pair: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const slide = new THREE.Group();
      slide.add(parts(barrel));
      slide.position.set(s * BORE_X, 0, -0.2);
      this.pitch.add(slide);
      pair.push(slide);
    }
    this.barrels = pair as [THREE.Group, THREE.Group];
    this.root.visible = false;
    scene.add(this.root);
  }

  /** The tip of one barrel in the world, as last posed. */
  muzzle(right: boolean, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    const slide = this.barrels[right ? 1 : 0];
    return slide.localToWorld(out.set(0, 0, MUZZLE_Z));
  }
}

type Phase = 'warning' | 'falling' | 'unfold' | 'active' | 'down';

export class Sentry implements Strike {
  private phase: Phase = 'warning';
  private t = 0;
  private readonly feet = new THREE.Vector3();
  private readonly pivot = new THREE.Vector3();
  private readonly ring: GroundRing;
  private readonly shot: ShotSpec = { damage: S.damage, source: 'sentry', team: 'player', maxDistance: S.range + 10, tracer: 'heavy', force: 8, impactScale: 1.3 };
  private fall: number = S.height;
  private trail: EmitterHandle | null = null;
  private unmark: (() => void) | null = null;
  private target: EnemyInstance | null = null;
  private missile: Missile | null = null;
  /** Seconds the missile has been in the sight. */
  private held = 0;
  private scanIn = 0;
  private fireIn = 0;
  private right = false;
  private yawNow = 0;
  private pitchNow = 0;

  constructor(private readonly kit: StrikeKit, order: StrikeOrder, private readonly rig: SentryRig, private readonly sky: AntiAir) {
    const { ctx, probe } = kit;
    const p = order.point;
    const floor = probe.heightAt(p.x, p.y + 2, p.z, 40);
    this.feet.set(p.x, Number.isNaN(floor) ? p.y : floor, p.z);
    // Under a roof it comes down from the roof: it has nothing to shoot there, but nothing breaks either.
    this.fall = Math.max(2, probe.headroom(p.x, this.feet.y + 1, p.z, S.height) - 1);
    this.ring = new GroundRing(ctx);
    this.ring.setColor(COLOR, 2);
    this.yawNow = rand(0, TAU);
    this.unmark = ctx.hud.marker(_p.copy(this.feet).setY(this.feet.y + 3), CALLINS.sentry.name, COLOR);
    ctx.audio.play('cache_incoming');
  }

  update(dt: number): boolean {
    this.t += dt;
    const { rig, feet } = this;
    switch (this.phase) {
      case 'warning':
        this.showRing();
        if (this.t >= S.warn) this.drop();
        break;
      case 'falling': {
        const k = Math.min(1, this.t / (this.fall / S.speed));
        rig.root.position.set(feet.x, lerp(feet.y + this.fall, feet.y, k), feet.z);
        this.showRing();
        if (k >= 1) this.land();
        break;
      }
      case 'unfold': {
        const k = smoothstep(0, S.unfold, this.t);
        rig.yaw.position.y = lerp(STOWED, RAISED, k);
        this.pitchNow = lerp(0, 0.5, k);
        this.pose(dt);
        if (k >= 1) this.next('active');
        break;
      }
      case 'active':
        this.engage(dt);
        this.pose(dt);
        if (this.t >= S.life) this.powerDown();
        break;
      case 'down':
        this.pitchNow = damp(this.pitchNow, -0.05, 3, dt);
        rig.yaw.position.y = damp(rig.yaw.position.y, STOWED + 0.2, 2, dt);
        this.pose(dt);
        if (this.t >= 1.4) {
          this.burnOut();
          return true;
        }
        break;
    }
    return false;
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }

  private showRing(): void {
    this.ring.show(this.feet, S.impactRadius);
    this.ring.setOpacity(0.6 + Math.sin(this.t * 9) * 0.3);
    this.ring.tick(this.t);
  }

  private drop(): void {
    const { ctx } = this.kit;
    const { rig } = this;
    this.next('falling');
    rig.root.visible = true;
    rig.root.position.copy(this.feet).setY(this.feet.y + this.fall);
    rig.yaw.position.y = STOWED;
    rig.yaw.rotation.y = this.yawNow;
    rig.pitch.rotation.x = 0;
    this.trail = ctx.fx.attachEmitter(rig.root, 'hellfireTrail', new THREE.Vector3(0, 0.2, 0), this.fall / S.speed + 0.2);
    ctx.audio.play('missile_incoming', { position: this.feet });
  }

  private land(): void {
    const { audio, camera, combat, fx, player, render } = this.kit.ctx;
    const p = this.feet;
    this.next('unfold');
    this.rig.root.position.copy(p);
    this.ring.hide();
    this.trail?.stop();
    this.trail = null;
    combat.explode(aboveFloor(p), {
      radius: S.impactRadius, damage: S.impactDamage, kind: 'rocket', source: 'drop_pod', team: 'player', selfDamage: 0, playerPush: 8,
    });
    audio.play('cache_land', { position: p });
    audio.play('metal_groan', { position: p, volume: 0.6, pitch: 1.5 });
    fx.dust(p, _up, 3);
    fx.ring(p, _up, COLOR, S.impactRadius * 2);
    render.decals.add('crack', p, _up, S.impactRadius * 1.1, rand(0, TAU));
    camera.addTrauma(Math.max(0, 0.45 - player.position.distanceTo(p) / 90));
    this.pivot.copy(p).setY(p.y + RAISED + TRUNNION);
  }

  /** Find, turn, fire. Missiles first: one on the player's aircraft is worth more than a drone. */
  private engage(dt: number): void {
    this.scanIn -= dt;
    if (this.missile && !this.missile.body.parent) this.missile = null;
    if (this.target && (!this.target.alive || this.target.center.distanceTo(this.pivot) > S.range)) this.target = null;
    if (this.scanIn <= 0) {
      this.scanIn = S.scanEvery;
      this.scan();
    }
    const aim = this.missile?.body.position ?? this.target?.center ?? null;
    if (!aim) {
      // Nothing up: it sweeps the sky slowly, barrels high.
      this.yawNow += 0.35 * dt;
      this.pitchNow = damp(this.pitchNow, 0.55, 2, dt);
      this.held = 0;
      return;
    }
    _to.subVectors(aim, this.pivot);
    const yaw = Math.atan2(-_to.x, -_to.z);
    const pitch = clamp(Math.atan2(_to.y, Math.hypot(_to.x, _to.z)), PITCH_MIN, PITCH_MAX);
    const dy = wrapAngle(yaw - this.yawNow);
    const dp = pitch - this.pitchNow;
    const step = S.slew * dt;
    this.yawNow += clamp(dy, -step, step);
    this.pitchNow += clamp(dp, -step, step);
    this.fireIn -= dt;
    if (Math.abs(dy) < S.onTarget && Math.abs(dp) < S.onTarget && this.fireIn <= 0) {
      this.fireIn = 1 / S.rate;
      this.fire(aim);
    }
  }

  private scan(): void {
    const { enemies } = this.kit.ctx;
    const missiles = this.sky.missiles;
    let best: number = S.range;
    let missile: Missile | null = null;
    for (const m of missiles) {
      const d = m.body.position.distanceTo(this.pivot);
      if (d < best && this.clear(m.body.position, d)) {
        best = d;
        missile = m;
      }
    }
    if (missile !== this.missile) this.held = 0;
    this.missile = missile;
    if (missile) return;
    // Drones only: whatever walks is the player's.
    if (this.target && this.target.alive) best = this.target.center.distanceTo(this.pivot) * 0.8;
    for (const e of enemies.alive) {
      if (e.id !== 'drone' || e === this.target) continue;
      const d = e.center.distanceTo(this.pivot);
      if (d < best && this.clear(e.center, d)) {
        best = d;
        this.target = e;
      }
    }
    if (this.target && !this.clear(this.target.center, this.target.center.distanceTo(this.pivot))) this.target = null;
  }

  /** Nothing solid between the sight and `p`. */
  private clear(p: THREE.Vector3, d: number): boolean {
    _dir.subVectors(p, this.pivot).divideScalar(d || 1);
    return !this.kit.ctx.physics.raycast(this.pivot, _dir, d, CG.World);
  }

  private fire(aim: THREE.Vector3): void {
    const { audio, combat, fx, hud } = this.kit.ctx;
    this.right = !this.right;
    this.rig.muzzle(this.right, _muzzle);
    _dir.subVectors(aim, _muzzle).normalize();
    _dir.x += rand(-S.spread, S.spread);
    _dir.y += rand(-S.spread, S.spread);
    _dir.z += rand(-S.spread, S.spread);
    _dir.normalize();
    fx.muzzleFlash(_muzzle, _dir, 'autocannon');
    audio.play('autocannon_fire', { position: _muzzle, pitch: rand(1.28, 1.4), volume: 0.5 });
    combat.fireRay(_muzzle, _dir, this.shot);
    this.rig.barrels[this.right ? 1 : 0].position.z = -0.2 + KICK;
    const m = this.missile;
    if (!m) return;
    this.held += 1 / S.rate;
    if (this.held < S.missileTrack) return;
    // With nothing to fly at, anti-air bursts it where it is on its next step.
    m.target = null;
    m.decoy = null;
    this.missile = null;
    this.held = 0;
    hud.feed('MISSILE DOWN', COLOR);
  }

  private pose(dt: number): void {
    const { rig } = this;
    rig.yaw.rotation.y = dampAngle(rig.yaw.rotation.y, this.yawNow, 30, dt);
    rig.pitch.rotation.x = this.pitchNow;
    for (const b of rig.barrels) b.position.z = damp(b.position.z, -0.2, 14, dt);
  }

  private powerDown(): void {
    this.next('down');
    this.target = null;
    this.missile = null;
    this.kit.ctx.audio.play('tank_turret_stop', { position: this.feet, pitch: 1.2 });
  }

  /** Its charge blows the mount so nobody can take it: sparks, a pop, gone. */
  private burnOut(): void {
    const { audio, fx } = this.kit.ctx;
    _p.copy(this.feet).setY(this.feet.y + 1.2);
    fx.sparks(_p, _up, 24, COLOR);
    fx.smoke(_p, 0x3a3c40, 2, 2);
    audio.play('explosion_small', { position: _p, volume: 0.6 });
    this.rig.root.visible = false;
  }

  dispose(): void {
    this.rig.root.visible = false;
    this.ring.dispose();
    this.trail?.stop();
    this.trail = null;
    this.unmark?.();
    this.unmark = null;
  }
}
