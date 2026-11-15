/**
 * The Lance. Right click toggles its two modes, and in each a press let go short of a full charge is a tap, a full charge
 * the big shot. Beam mode (the gun glows blue): a tap is the rail shot, through bodies and up to two walls, with a plasma
 * burst at every body it strikes; a full charge is a second of sustained beam down the aim that vaporizes what it touches
 * and sets fire to what lives. Ball mode (green): a tap is a plasma ball; a full charge is a giant slow ball that ends in a
 * plasma blast on whatever it meets, and vaporizes what that kills.
 *
 * Four parts. The rules of the charge are plain functions. `PlasmaChain` is the pool the rail shot's bursts wait in.
 * `Lance` is the trigger and the shots, driven by `Weapons` through the few things it needs of it (`LanceHost`), so none of
 * this lives in Weapons.ts. `LANCE_LOOK` is what the gun in the hands and the HUD show of it. Every number is in data.ts.
 * `?lance=old` turns all of it off and `Weapons.updateCharge` fires the gun as it did.
 *
 * Nothing here is one frame's work however long the line. A rail shot is a sweep: it strikes a few bodies a frame and
 * carries on next frame from where it stopped, so twenty deaths are spread over the hit-stop its first one starts. Its
 * bursts are booked as it goes and set off a couple a frame. The beam strikes in ticks, and a crowd it vaporizes is capped
 * in gore (VaporTuning.max).
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle } from '../core/contracts';
import type {
  AmmoState, EnemyInstance, ExplosionSpec, ProjectileSpec, ProjectileTrail, ShotSpec, StruckList, WeaponModifiers,
} from '../core/gameplay';
import { clamp, rand, randomUnit, TAU } from '../core/math';
import { orbitalMaterials } from '../progression/callins/orbital';
import type { Combat } from './Combat';
import { HIT_STOP, LANCE_OLD, TUNING, WEAPONS, type WeaponDef } from './data';

export const LANCE_ON = !LANCE_OLD;

const T = TUNING.lance;
const RAIL = T.rail;
const BEAM = T.beam;
const GIANT = T.giant;
/** The shares of the charge it ticks at, full last. */
export const MARKS: readonly number[] = [...T.marks, 1];
const EPS = 1e-6;
/** Metres back up the beam the bolt to the first body starts from. */
const LEAD = 3;
/** The stretch of a rail shot its own bolt crackles along, in metres from the muzzle. Not from the muzzle itself: there it fills the view. */
const CRACKLE_FROM = 2.5;
const CRACKLE_TO = 11;

// ---------------------------------------------------------------------------------------------
// The charge
// ---------------------------------------------------------------------------------------------

export type LanceMode = 'beam' | 'ball';
export type LanceShot = 'rail' | 'ball' | 'beam' | 'giant';

/** The last mark a charge of `level` has reached, or -1 under the first. The last mark is full. */
export function markAt(level: number): number {
  let mark = -1;
  for (let i = 0; i < MARKS.length; i++) if (level >= MARKS[i]! - EPS) mark = i;
  return mark;
}

/** What a full charge in `mode` takes from the cell. */
export const fullCost = (mode: LanceMode): number => (mode === 'beam' ? BEAM.cost : GIANT.cost);

/** How far the charge can climb on what the cell holds: to full if it can pay for the big shot, else not at all. */
export function chargeCap(mag: number, mode: LanceMode, bottomless = false): number {
  return bottomless || mag >= fullCost(mode) ? 1 : 0;
}

/** The charge after the trigger has been down `held` seconds. Nothing for the length of a tap, then a line to `cap`. */
export function chargeAfter(held: number, cap = 1): number {
  return Math.min(cap, clamp((held - T.tapTime) / T.chargeTime));
}

/**
 * What letting go fires: the big shot at a full charge, else the tap. A beam mode tap the cell cannot pay for is a ball,
 * as the old gun's last cell was.
 */
export function shotFor(mode: LanceMode, level: number, mag: number, bottomless = false): LanceShot {
  if (level >= 1 - EPS) return mode === 'beam' ? 'beam' : 'giant';
  return mode === 'beam' && (bottomless || mag >= RAIL.cost) ? 'rail' : 'ball';
}

/**
 * How thick the beam is drawn `t` seconds in, as a share of its widths: chunky as it leaves, running out of energy into a
 * thin line by its end.
 */
export const beamGirth = (t: number): number => {
  const k = clamp(t / BEAM.seconds);
  return Math.max(BEAM.thin, BEAM.thick * (1 - k) ** 1.4);
};

/** Cells a beam `t` seconds old has paid: one at a time as it goes, the last at its end, so it is never empty mid-beam. */
export const beamPaid = (t: number): number => Math.min(BEAM.cost, Math.floor((t / BEAM.seconds) * BEAM.cost + EPS));

/**
 * What the gun in the hands and the HUD show that the charge alone does not: the mode, the world time it last changed,
 * and 0..1 while a beam pours out of it. One Lance is ever in the hands.
 */
export const LANCE_LOOK = { ball: false, toggled: -99, beam: 0 };

// ---------------------------------------------------------------------------------------------
// The chain of bursts
// ---------------------------------------------------------------------------------------------

export interface Link {
  live: boolean;
  /** World clock it goes off at. */
  at: number;
  readonly point: THREE.Vector3;
  /** The body before it on the beam, or a little way back up the beam for the first: where the bolt to it jumps from. */
  readonly from: THREE.Vector3;
  /** The line of the beam that left it, for the ring. */
  readonly dir: THREE.Vector3;
  radius: number;
  damage: number;
}

/**
 * Bursts waiting their turn. A fixed pool: a beam books one for each body it struck, `gap` apart, and `drain` hands over
 * the ones that have come due, the earliest first and only a few a frame. Nothing is allocated after the constructor.
 */
export class PlasmaChain {
  private readonly links: Link[] = [];
  private live = 0;

  constructor(size: number = T.chain.max) {
    for (let i = 0; i < size; i++) {
      this.links.push({
        live: false, at: 0, point: new THREE.Vector3(), from: new THREE.Vector3(), dir: new THREE.Vector3(), radius: 0, damage: 0,
      });
    }
  }

  get pending(): number {
    return this.live;
  }

  /**
   * Books a burst at each body in the list from index `from` on. The body at index `i` goes off at `now + first + i * gap`,
   * so a beam that fills its list over several frames still ripples at one pace. Returns how many the pool had room for.
   */
  load(
    struck: StruckList, dir: THREE.Vector3, now: number, radius: number, damage: number,
    first: number = T.chain.first, gap: number = T.chain.gap, from = 0,
  ): number {
    let booked = 0;
    for (let i = from; i < struck.count; i++) {
      const link = this.free();
      if (!link) break;
      link.live = true;
      link.at = now + first + i * gap;
      link.point.copy(struck.points[i]!);
      if (i > 0) link.from.copy(struck.points[i - 1]!);
      else link.from.copy(link.point).addScaledVector(dir, -LEAD);
      link.dir.copy(dir);
      link.radius = radius;
      link.damage = damage;
      this.live++;
      booked++;
    }
    return booked;
  }

  private free(): Link | null {
    for (let i = 0; i < this.links.length; i++) if (!this.links[i]!.live) return this.links[i]!;
    return null;
  }

  /** Sets off every burst due by `now`, earliest first, up to `perFrame`. The rest wait for the next frame. Returns how many went. */
  drain(now: number, fire: (link: Link) => void, perFrame: number = T.chain.perFrame): number {
    let fired = 0;
    while (fired < perFrame && this.live > 0) {
      let next: Link | null = null;
      for (let i = 0; i < this.links.length; i++) {
        const link = this.links[i]!;
        if (link.live && link.at <= now && (!next || link.at < next.at)) next = link;
      }
      if (!next) break;
      // Freed first: what it sets off may fire a gun, and that must find the pool as it will be.
      next.live = false;
      this.live--;
      fired++;
      fire(next);
    }
    return fired;
  }

  clear(): void {
    for (let i = 0; i < this.links.length; i++) this.links[i]!.live = false;
    this.live = 0;
  }
}


// ---------------------------------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------------------------------

/** A weapon's slot, as `Weapons` keeps it. */
export interface LanceSlot {
  def: WeaponDef;
  cooldown: number;
  ammo: AmmoState;
}

/** What the Lance needs of the weapon system that holds it. `Weapons` hands these over as closures on its own methods. */
export interface LanceHost {
  readonly modifiers: WeaponModifiers;
  /** Where the last `feedback` put the muzzle, in world space. */
  readonly muzzleAt: THREE.Vector3;
  canShoot(s: LanceSlot): boolean;
  consume(s: LanceSlot, rounds: number): void;
  /** True, once, for a press that is still live: this frame's, or one buffered through a reload, a draw or the last shot's wait. */
  takePress(): boolean;
  /** The trigger on an empty cell: reload, or say so and hand over. */
  dry(): void;
  /** The frame-of-the-shot beats by `def`: flash, sound, recoil, kick, shake, FOV, the `weapon:fired` event. */
  feedback(def: WeaponDef, strength: number): void;
  /** The shared scratch shot, filled for this gun and the perks in force. */
  shot(def: WeaponDef, damage: number): ShotSpec;
  /** The shared scratch projectile, on the eye line and drawn from the muzzle. */
  projectile(kind: ProjectileSpec['kind'], def: WeaponDef, speed: number, damage: number, trail: ProjectileTrail): ProjectileSpec;
  /** Seconds between shots at the rate in force. */
  interval(def: WeaponDef): number;
}

const DEF = WEAPONS.lance;
/** The ball's own feedback: the row's numbers are the rail shot's. */
const BALL_DEF: WeaponDef = {
  ...DEF, muzzle: 'plasma', sounds: [{ id: 'lance_plasma', pitchJitter: 0.05 }],
  recoil: T.ball.recoil, kick: T.ball.kick, shake: T.ball.shake, fovPunch: T.ball.fovPunch,
};
/** The beam's first frame. What it does after is its own. */
const BEAM_DEF: WeaponDef = { ...DEF, sounds: [{ id: 'railgun_fire', pitch: 0.8 }], recoil: 1.5, kick: 0.05, shake: 0.12, fovPunch: 0 };
const GIANT_DEF: WeaponDef = {
  ...DEF, muzzle: 'plasma', sounds: [{ id: 'lance_giant' }],
  recoil: GIANT.recoil, kick: GIANT.kick, shake: GIANT.shakeFire, fovPunch: GIANT.fovPunch,
};

/** A rail shot on its way down a line: what it may still do, and where its next ray starts. */
interface Sweep {
  active: boolean;
  readonly origin: THREE.Vector3;
  /** Where the next piece of the drawn line starts. */
  readonly from: THREE.Vector3;
  readonly dir: THREE.Vector3;
  damage: number;
  burstDamage: number;
  /** Bodies it may still strike, walls it may still pass, kills it may still split, metres it may still fly. */
  bodies: number;
  walls: number;
  cleave: number;
  reach: number;
  /** Bodies a ray, which is a frame. */
  perFrame: number;
  kills: number;
  /** World clock at the shot, which the bursts are booked from. */
  at: number;
  first: boolean;
}

/** As far as any ray goes (Combat's MAX_RANGE). */
const RANGE = 800;
const RING = 0x7fdcff;
const BOLT = 0xa8ecff;
const FLASH = 0x9fdcff;
const GREEN = 0x5dff8a;
/** The charge hum's pitch from nothing to full, as a share of the loop as recorded. */
const HUM_LOW = 0.42;
const HUM_STEPS = 12;
/** Reused, so a charge builds nothing. */
const HUM_START = { pitch: HUM_LOW, volume: 0.3 };
const TICK = { pitch: 1 };
const MODE_SOUND = { pitch: 1 };
const AT = { position: undefined as THREE.Vector3 | undefined };
const UP = new THREE.Vector3(0, 1, 0);
const BASIS = new THREE.Matrix4();
/** Narrow at the muzzle and full width five metres out, so it leaves the gun as a line and does not fill the view. */
const RIBBON_VERT = /* glsl */ `
uniform float uLen;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  p.x *= mix(0.3, 1.0, clamp(p.y * uLen / 5.0, 0.0, 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
/** The Orbital Lance's beam (progression/callins/orbital.ts) across a ribbon: a hot core, a rim colour round it, pulses racing down. */
const RIBBON_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCore;
uniform vec3 uRim;
uniform float uTime;
uniform float uPower;
uniform float uLen;
varying vec2 vUv;
void main() {
  float x = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float d = vUv.y * uLen;
  float pulse = 0.7 + 0.3 * sin(d * 0.9 - uTime * 46.0) * sin(d * 0.23 + uTime * 17.0);
  // A solid white-hot band down the middle, a blue corona falling away round it.
  vec3 c = uRim * pow(x, 1.6) * pulse + uCore * (smoothstep(0.5, 0.9, x) + 0.3 * pow(x, 3.0));
  gl_FragColor = vec4(c * uPower, 1.0);
}`;
/** Newton-seconds a beam tick pushes a body with: it burns, it does not throw. */
const BURN_FORCE = 6;

/** The sustained beam while it lasts. */
interface Beam {
  active: boolean;
  slot: LanceSlot | null;
  /** Seconds on the player's clock since it began, and until the next strike. */
  t: number;
  tickIn: number;
  paid: number;
  damage: number;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly normal: THREE.Vector3;
  /** It ends on a wall, not in the air. */
  wall: boolean;
  readonly scorched: THREE.Vector3;
}

interface Giant {
  active: boolean;
  age: number;
  damage: number;
  readonly at: THREE.Vector3;
  readonly dir: THREE.Vector3;
}

export class Lance {
  /** 0..1, for the HUD and the viewmodel. */
  level = 0;
  /** The mark the charge has reached, -1 under the first. The last is full. */
  stage = -1;
  mode: LanceMode = 'beam';
  readonly chain = new PlasmaChain();
  /** Shots fired, by kind, and the rail shot's bursts: for tests and the lab. */
  readonly fired = { balls: 0, rails: 0, beams: 0, giants: 0, bursts: 0 };

  private holding = false;
  private heldFor = 0;
  private charging = false;
  private hum: LoopHandle | null = null;
  private humStep = -1;
  private fovFrom = Number.NaN;
  private punching = false;
  private punchLeft = 0;
  private punchFrom = 0;
  private punchDeg = 0;
  private inhaleOwed = 0;

  private readonly struck: StruckList;
  private readonly sweep: Sweep = {
    active: false, origin: new THREE.Vector3(), from: new THREE.Vector3(), dir: new THREE.Vector3(), damage: 0, burstDamage: 0,
    bodies: 0, walls: 0, cleave: 0, reach: 0, perFrame: 0, kills: 0, at: 0, first: true,
  };
  private readonly beamState: Beam = {
    active: false, slot: null, t: 0, tickIn: 0, paid: 0, damage: 0, from: new THREE.Vector3(), to: new THREE.Vector3(),
    normal: new THREE.Vector3(), wall: false, scorched: new THREE.Vector3(),
  };
  private readonly giant: Giant = { active: false, age: 0, damage: 0, at: new THREE.Vector3(), dir: new THREE.Vector3() };
  private beamLoop: LoopHandle | null = null;
  private giantLoop: LoopHandle | null = null;
  /** The beam's column and the giant ball: the Orbital Lance's shader, in the gun's colours. Built on first use. */
  private look: { column: THREE.Mesh; sheath: THREE.Mesh; orb: THREE.Mesh; halo: THREE.Mesh; orbMat: THREE.ShaderMaterial } | null = null;
  private readonly end = new THREE.Vector3();
  private readonly burst: ExplosionSpec = {
    radius: 0, damage: 0, kind: 'plasmaBurst', source: DEF.id, team: 'player', selfDamage: 0, playerPush: 0,
    scale: T.chain.scale, shake: T.chain.shake,
  };
  private readonly nova: ExplosionSpec = {
    radius: GIANT.blast, damage: 0, kind: 'plasma', source: DEF.id, team: 'player', selfDamage: GIANT.selfDamage,
    playerPush: GIANT.playerPush, scale: GIANT.scale, shake: GIANT.shake, vaporize: true,
  };
  private readonly ballBlast: NonNullable<ProjectileSpec['explosion']> = { radius: T.ball.radius, damage: 0, kind: 'plasmaBurst', scale: T.ball.scale };
  private readonly near = new THREE.Vector3();
  private readonly far = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly muzzlePos = new THREE.Vector3();
  private readonly list: EnemyInstance[] = [];
  private readonly fireLink = (link: Link): void => this.setOff(link);

  constructor(private readonly ctx: Ctx, private readonly host: LanceHost) {
    const points: THREE.Vector3[] = [];
    const enemies: null[] = [];
    for (let i = 0; i < T.chain.max; i++) {
      points.push(new THREE.Vector3());
      enemies.push(null);
    }
    this.struck = { count: 0, walls: 0, points, enemies };
  }

  private get combat(): Combat {
    return this.ctx.combat as Combat;
  }

  /** True while a press of this gun's is down. */
  get held(): boolean {
    return this.holding;
  }

  /** True while a rail shot is still on its way down a line. */
  get sweeping(): boolean {
    return this.sweep.active;
  }

  /** True while the sustained beam is pouring out. */
  get beaming(): boolean {
    return this.beamState.active;
  }

  /** The giant ball in flight, or null. */
  get giantAt(): THREE.Vector3 | null {
    return this.giant.active ? this.giant.at : null;
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  /**
   * Every frame, whatever is in hand: a rail shot still on its way strikes its next few bodies, the bursts it has booked go
   * off on the world clock, the beam pours on, and the giant ball flies.
   */
  tick(): void {
    if (this.punching) this.stepPunch();
    if (this.sweep.active) this.step();
    if (this.chain.pending > 0) this.chain.drain(this.ctx.time.elapsed, this.fireLink);
    if (this.beamState.active) this.stepBeam(this.ctx.time.dt);
    if (this.giant.active) this.stepGiant(this.ctx.time.dt);
  }

  /** Every frame the Lance is in hand and free to fire. */
  update(s: LanceSlot, dt: number, held: boolean): void {
    const { input } = this.ctx;
    const h = this.host;
    // Alt fire toggles the mode, and lets go of a charge on the way, as right click always did.
    if (input.pressed('aim')) {
      if (this.charging) this.ctx.audio.play('railgun_fizzle');
      this.cancel();
      this.toggle();
      return;
    }
    if (!this.holding) {
      if (s.cooldown > 0) return;
      if (!h.canShoot(s)) {
        if (input.pressed('fire')) h.dry();
        return;
      }
      if (!h.takePress()) return;
      this.holding = true;
      this.heldFor = 0;
    }
    if (!held) {
      this.release(s);
      return;
    }
    this.heldFor += dt;
    const level = chargeAfter(this.heldFor, chargeCap(s.ammo.mag, this.mode, h.modifiers.bottomlessMag));
    if (level <= 0) return;
    this.charge(level, dt);
  }

  /** Beam to ball and back. */
  toggle(): void {
    this.mode = this.mode === 'beam' ? 'ball' : 'beam';
    LANCE_LOOK.ball = this.mode === 'ball';
    LANCE_LOOK.toggled = this.ctx.time.elapsed;
    MODE_SOUND.pitch = this.mode === 'ball' ? 0.8 : 1.12;
    this.ctx.audio.play('lance_mode', MODE_SOUND);
  }

  private charge(level: number, dt: number): void {
    const { audio, camera, viewmodel, fx } = this.ctx;
    if (!this.charging) {
      this.charging = true;
      this.hum = audio.startLoop?.('railgun_charge_loop', HUM_START) ?? null;
      this.humStep = -1;
      this.inhaleOwed = 0;
      this.ensureLook();
      this.warm(true);
      // A charge begun while the last shot's punch is still out narrows from the view it is going back to.
      this.fovFrom = this.punching ? this.punchFrom : typeof camera.fov === 'number' ? camera.fov : Number.NaN;
      this.punching = false;
    }
    this.level = level;
    const mark = markAt(level);
    while (this.stage < mark) {
      this.stage++;
      // One tick a mark, each higher than the last, so the charge can be counted by ear.
      TICK.pitch = 1 + this.stage * 0.26;
      audio.play('lance_stage', TICK);
      if (this.stage === MARKS.length - 1) audio.play('railgun_ready');
    }
    // The hum climbs with the charge itself. Its level moves in steps, so the mixer is written a dozen times, not every frame.
    this.hum?.setPitch(HUM_LOW + (1 - HUM_LOW) * level, 0.05);
    const step = Math.round(level * HUM_STEPS);
    if (step !== this.humStep) {
      this.humStep = step;
      this.hum?.setVolume(0.3 + 0.7 * level, 0.08);
    }
    viewmodel.setCharge(level);
    if (Number.isFinite(this.fovFrom)) camera.setZoom(this.fovFrom - T.fovPull * level * level);

    // Energy pulled in from all round the gun, faster and from nearer as it fills, and the view shaking with it.
    const k = T.inhale;
    const color = this.mode === 'ball' ? GREEN : BOLT;
    const muzzle = this.muzzle();
    this.inhaleOwed += k.rate * level * level * dt;
    const n = Math.floor(this.inhaleOwed);
    if (n > 0) {
      this.inhaleOwed -= n;
      fx.inhale?.(muzzle, k.reach * (1 - 0.35 * level), n, color);
    }
    if (Math.random() < k.arcs * level * level * dt) {
      randomUnit(this.v).multiplyScalar(rand(0.5, 1.3) * k.reach * 0.6).add(muzzle);
      fx.arc(this.v, muzzle, color, 0.07, 0.008);
    }
    camera.addTrauma(k.trauma * level * level * level * dt);
  }

  /** The muzzle now, in world space, from the gun in the hands. */
  private muzzle(): THREE.Vector3 {
    const { player, viewmodel } = this.ctx;
    const out = this.muzzlePos.copy(player.eye).addScaledVector(player.forward, 0.6);
    out.y -= 0.18;
    return viewmodel.muzzle(out, false) ?? out;
  }

  private release(s: LanceSlot): void {
    const level = this.charging ? this.level : 0;
    const fov = this.ctx.camera.fov;
    // A tap never narrowed the view, so its punch is thrown from the view as it is.
    const from = Number.isFinite(this.fovFrom) ? this.fovFrom : typeof fov === 'number' ? fov : Number.NaN;
    this.cancel();
    const shot = shotFor(this.mode, level, s.ammo.mag, this.host.modifiers.bottomlessMag);
    if (shot === 'ball') this.fireBall(s);
    else if (shot === 'giant') {
      this.fireGiant(s);
      this.punch(from, GIANT.fovPunch);
    } else if (shot === 'beam') this.startBeam(s);
    else {
      this.fireRail(s);
      this.punch(from, DEF.fovPunch);
    }
  }

  /**
   * A shot's FOV punch, thrown outward from the charge's narrowed view. The camera's own punch sits under the zoom and
   * would be lost in the zoom letting go, so the Lance holds the zoom itself: wide at once by `degrees`, back to `from`
   * over `T.punchTime` on the real clock (the hit-stop does not hold it), then let go where the free view already is.
   */
  private punch(from: number, degrees: number): void {
    if (!Number.isFinite(from) || degrees <= 0) return;
    this.punching = true;
    this.punchFrom = from;
    this.punchDeg = degrees;
    this.punchLeft = T.punchTime;
    this.ctx.camera.setZoom(from + degrees);
  }

  private stepPunch(): void {
    this.punchLeft -= this.ctx.time.realDt;
    if (this.punchLeft <= 0) {
      this.endPunch();
      return;
    }
    const k = this.punchLeft / T.punchTime;
    this.ctx.camera.setZoom(this.punchFrom + this.punchDeg * k * k);
  }

  private endPunch(): void {
    if (!this.punching) return;
    this.punching = false;
    this.punchLeft = 0;
    this.ctx.camera.setZoom(null);
  }

  /**
   * Lets go of a press and whatever it had charged, with nothing fired and nothing spent, and ends a beam where it is: a
   * switch, a reload, a melee, a pause, a death. Bursts already booked still go off, and a giant ball flies on.
   */
  cancel(): void {
    this.endPunch();
    if (this.beamState.active) this.endBeam();
    if (!this.holding && !this.charging) return;
    this.holding = false;
    this.heldFor = 0;
    this.level = 0;
    this.stage = -1;
    if (!this.charging) return;
    this.charging = false;
    this.warm(false);
    this.hum?.stop(0.06);
    this.hum = null;
    this.ctx.viewmodel.setCharge(0);
    if (Number.isFinite(this.fovFrom)) this.ctx.camera.setZoom(null);
    this.fovFrom = Number.NaN;
  }

  /** A new run: nothing held, nothing on its way, nothing waiting to go off, and back in beam mode. */
  reset(): void {
    this.cancel();
    this.endSweep();
    this.chain.clear();
    this.endGiant();
    this.mode = 'beam';
    LANCE_LOOK.ball = false;
    LANCE_LOOK.beam = 0;
    this.fired.balls = this.fired.rails = this.fired.beams = this.fired.giants = this.fired.bursts = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Shots
  // -------------------------------------------------------------------------------------------

  private fireBall(s: LanceSlot): void {
    const h = this.host;
    const b = T.ball;
    const m = h.modifiers;
    h.consume(s, b.cost);
    h.feedback(BALL_DEF, 1);
    const p = h.projectile('plasma', s.def, b.speed, b.damage * m.damage, 'plasma');
    p.lifetime = b.life;
    p.force = b.force;
    p.severMult = m.alwaysSever ? 1000 : b.severMult;
    p.killStop = b.killStop;
    p.size = b.size;
    // Reused: the pool copies a projectile's blast out of its spec when it spawns.
    this.ballBlast.damage = b.splash * m.damage;
    p.explosion = this.ballBlast;
    this.combat.spawnProjectile(p);
    s.cooldown = h.interval(s.def);
    this.fired.balls++;
  }

  private fireRail(s: LanceSlot): void {
    const c = this.ctx;
    const h = this.host;
    const def = s.def;
    const m = h.modifiers;
    h.consume(s, RAIL.cost);
    h.feedback(DEF, RAIL.weight);
    this.fired.rails++;
    s.cooldown = (h.interval(def) / def.interval) * T.recover * RAIL.weight;

    // A shot still on its way from the last is finished where it stands: one list, one line.
    this.endSweep();
    const sw = this.sweep;
    sw.active = true;
    sw.origin.copy(c.player.eye);
    sw.from.copy(h.muzzleAt);
    sw.dir.copy(c.player.forward);
    sw.damage = def.damage * RAIL.damage * m.damage;
    sw.burstDamage = RAIL.burstDamage * m.damage;
    sw.bodies = RAIL.pierce + 1;
    sw.walls = RAIL.walls;
    sw.cleave = RAIL.cleave;
    sw.reach = RANGE;
    // A few bodies a frame for the long line. A shot a perk bounces or blows up at its end is one ray as it always was:
    // in pieces it would bounce or burst at the end of every piece.
    sw.perFrame = !m.explosiveRounds && m.ricochet === 0 ? T.sweep.perFrame : sw.bodies;
    sw.kills = 0;
    sw.at = c.time.elapsed;
    sw.first = true;
    this.struck.count = 0;
    this.struck.walls = 0;

    // A clap over the report, the screen pulled along the line and the player shoved back. The world is held on what it
    // strikes, in `step`, and the bursts start when it moves again.
    c.render.post.chromatic(0.4 * RAIL.weight, 0.16);
    c.audio.play('lance_thunder');
    c.render.post.radialBlur(0.22, 0.18);
    c.render.post.flash(FLASH, 0.18, 0.1);
    // Along the ground only: a shot at the floor must not lift the player off it.
    c.player.velocity.x -= sw.dir.x * T.push;
    c.player.velocity.z -= sw.dir.z * T.push;
    this.step();
  }

  /** One ray of the rail shot: the next few bodies in line, the walls between them, and the piece of line that reaches them. */
  private step(): void {
    const h = this.host;
    const sw = this.sweep;
    const combat = this.combat;
    const list = this.struck;
    const want = Math.min(sw.bodies, sw.perFrame);
    const split = sw.perFrame < sw.bodies ? Math.min(sw.cleave, T.sweep.cleave) : sw.cleave;
    // Over unless this ray says otherwise: if a kill's listener throws, the shot must not be fired again every frame after.
    sw.active = false;

    const shot = h.shot(DEF, sw.damage);
    shot.pierce = want - 1;
    shot.tracer = undefined;
    shot.force = DEF.force * RAIL.weight;
    shot.killStop = HIT_STOP.lanceKill;
    // Walls are the Lance's own per-wall rule (penetration.ts): up to `walls` of them, each up to `penetration` thick, of
    // anything, at no cost in damage. Bodies are `pierce`, and free.
    shot.penetrate = sw.walls > 0 ? T.penetration : 0;
    shot.penetrateWalls = sw.walls;
    shot.bodyCost = Infinity;
    shot.penetrateKeep = 1;
    shot.cleave = split;
    // Not stopped by a plate or a carried shield: it goes through them as it goes through the man.
    shot.armorPiercing = RAIL.pierces;
    shot.impactScale = 1 + 0.6 * RAIL.weight;
    shot.maxDistance = sw.reach;
    const before = list.count;
    const walls = list.walls;
    shot.struck = list;
    // Corpses on the first ray only. Ahead of a later one lie the bodies this shot killed a frame before, and the old
    // one-ray gun never struck its own kills a second time.
    shot.skipCorpses = !sw.first;
    let kills = 0;
    let hit = false;
    try {
      const end = combat.fireRay(sw.origin, sw.dir, shot);
      kills = end.kills;
      hit = end.hitEnemy;
      this.end.copy(end.end);
    } finally {
      // The spec is the one every gun fills. The next gun's shot must not write into this list.
      shot.struck = undefined;
      shot.skipCorpses = undefined;
    }
    const got = list.count - before;
    sw.bodies -= got;
    sw.walls -= list.walls - walls;
    sw.cleave -= Math.min(split, kills);
    sw.kills += kills;

    this.drawRail(sw.from, this.end, sw.first);
    this.chain.load(list, sw.dir, sw.at, RAIL.burst, sw.burstDamage, T.chain.first, T.chain.gap, before);
    const stop = Math.min(HIT_STOP.lanceShot + sw.kills * HIT_STOP.lancePerExtraKill, HIT_STOP.lanceMax);
    if (hit) combat.feel.stop(stop, true);

    // It struck all it was let, and may strike more: on from the last body next frame. The list keeps that body out of it.
    if (got === want && got > 0 && sw.bodies > 0) {
      const last = list.points[list.count - 1]!;
      sw.reach -= last.distanceTo(sw.origin);
      sw.origin.copy(last);
      sw.from.copy(last);
      sw.first = false;
      if (sw.reach > 0.05) {
        sw.active = true;
        return;
      }
    }
    this.endSweep();
  }

  private endSweep(): void {
    this.sweep.active = false;
    // The pool must not keep a dead enemy reachable.
    const list = this.struck;
    for (let i = 0; i < list.count; i++) list.enemies[i] = null;
  }

  /**
   * The line itself: a core that stays and narrows away, and on its first piece a sheath that is gone in a blink and a bolt
   * crackling along its first few metres. The core is kept thin: seen from the gun it lies along the view, and a wide one
   * would hide the line of bursts it is there to show.
   */
  private drawRail(from: THREE.Vector3, to: THREE.Vector3, first: boolean): void {
    const { fx } = this.ctx;
    fx.beam(from, to, 'rail', RAIL.width, RAIL.linger);
    if (!first) return;
    fx.beam(from, to, 'rail', RAIL.width * T.sheath, 0.12);
    // A bolt's wander grows with its length, so one drawn down the whole line would leave it by metres.
    const reach = from.distanceTo(to);
    if (reach <= CRACKLE_FROM + 1) return;
    const near = this.near.lerpVectors(from, to, CRACKLE_FROM / reach);
    const far = this.far.lerpVectors(from, to, Math.min(1, CRACKLE_TO / reach));
    fx.arc(near, far, BOLT, 0.3, 0.04);
  }

  /** One link of the chain: a bolt down the line to the body it struck, a real blast there, and a ring round the line. */
  private setOff(link: Link): void {
    const { fx } = this.ctx;
    const b = this.burst;
    b.radius = link.radius;
    b.damage = link.damage;
    this.fired.bursts++;
    fx.arc(link.from, link.point, BOLT, 0.16, 0.05);
    fx.ring(link.point, link.dir, RING, link.radius * 1.5);
    this.combat.explode(link.point, b);
  }

  // -------------------------------------------------------------------------------------------
  // The beam
  // -------------------------------------------------------------------------------------------

  private startBeam(s: LanceSlot): void {
    const c = this.ctx;
    const h = this.host;
    const b = this.beamState;
    h.feedback(BEAM_DEF, 1);
    this.fired.beams++;
    s.cooldown = BEAM.seconds + BEAM.recover;
    b.active = true;
    b.slot = s;
    b.t = 0;
    b.tickIn = 0;
    b.paid = 0;
    b.damage = BEAM.dps * BEAM.tick * h.modifiers.damage;
    b.scorched.set(Infinity, 0, 0);
    this.ensureLook();
    this.warm(false);
    this.look!.column.visible = this.look!.sheath.visible = true;
    c.audio.play('lance_thunder');
    this.beamLoop = c.audio.startLoop?.('lance_beam_loop') ?? null;
    c.render.post.flash(FLASH, 0.35, 0.18);
    c.render.post.chromatic(0.9, 0.3);
    c.render.post.radialBlur(0.3, 0.3);
    c.camera.addTrauma(0.45);
    this.stepBeam(0, true);
  }

  /**
   * One frame of beam: down the aim from the muzzle to the first wall, striking every body near the line in ticks, drawn
   * as the Orbital Lance's column, and shaking, burning and shoving all the while.
   */
  private stepBeam(dt: number, first = false): void {
    const c = this.ctx;
    const b = this.beamState;
    const s = b.slot!;
    // On the world's clock, so slow motion draws it out with everything else. Held still, it holds where it is.
    if (dt <= 0 && !first) {
      this.drawBeam(LANCE_LOOK.beam);
      return;
    }
    b.t += dt;
    const owed = beamPaid(b.t);
    if (owed > b.paid) {
      this.host.consume(s, owed - b.paid);
      b.paid = owed;
    }
    const k = b.t / BEAM.seconds;
    // Swells in in a blink and thins away over its last fifth.
    // Full in a blink, white-hot to its last tenth, then gone.
    const power = Math.min(1, b.t / 0.06 + 0.25) * (1 - clamp((k - 0.9) / 0.1) * 0.7);
    LANCE_LOOK.beam = power;
    const eye = c.player.eye;
    const dir = c.player.forward;
    const wall = c.physics.raycast(eye, dir, BEAM.range, CG.World);
    b.wall = wall !== null;
    if (wall) {
      b.to.copy(wall.point);
      b.normal.copy(wall.normal);
    } else b.to.copy(eye).addScaledVector(dir, BEAM.range);
    b.from.copy(this.muzzle());
    this.drawBeam(power);

    b.tickIn -= dt;
    if (b.tickIn <= 0) {
      b.tickIn += BEAM.tick;
      this.beamTick(eye, dir, power);
    }
    c.camera.addTrauma(BEAM.trauma * power * dt);
    c.player.velocity.x -= dir.x * BEAM.push * dt;
    c.player.velocity.z -= dir.z * BEAM.push * dt;
    this.beamLoop?.setVolume(0.4 + 0.6 * power, 0.05);
    if (b.t >= BEAM.seconds) this.endBeam();
  }

  /** What the beam does each tick: every body near the line burns or goes, and the end of it scorches and sparks. */
  private beamTick(eye: THREE.Vector3, dir: THREE.Vector3, power: number): void {
    const c = this.ctx;
    const b = this.beamState;
    const { fx } = c;
    const reach = eye.distanceTo(b.to);
    const mid = this.near.lerpVectors(eye, b.to, 0.5);
    const n = c.enemies.query(mid, reach / 2 + 3, this.list);
    let struck = 0;
    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive || !this.touches(e, eye, dir, reach)) continue;
      // Filled for each: a kill can set off a tank, and that blast fills the same scratch.
      const o = this.combat.strikeOptions('fire', DEF.id);
      o.force = BURN_FORCE;
      o.severMult = 1.5;
      o.quiet = true;
      o.pierces = true;
      o.vaporize = true;
      const res = this.combat.strike(e, this.far, UP, dir, undefined, 'chest', b.damage, o);
      struck++;
      if (!res.killed && e.alive) e.burning = Math.max(e.burning, BEAM.burn);
      fx.sparks(this.far, UP, 5, 0xbfeeff);
      fx.embers(this.far, 3, 0.6);
    }
    this.list.length = 0;
    if (struck > 0) c.hud.hitMarker('body');

    // The end of the line, and a bolt crackling off it somewhere along the first stretch.
    const at = b.to;
    if (b.wall) {
      fx.sparks(at, b.normal, 10, 0xd8f4ff);
      fx.embers(at, 4, 1);
      fx.heatShimmer(at, 1.6, 0.25);
      c.render.lights.flash(at, 0x8fd8ff, 14 * power, 9, 0.08);
      if (b.scorched.distanceToSquared(at) > 0.45 * 0.45) {
        b.scorched.copy(at);
        c.render.decals.add('scorch', at, b.normal, 1.4, rand(0, TAU));
      }
      c.physics.radialImpulse(at, 2.5, 6);
    }
    // Energy crackling along it, out to its end, thicker while the beam is.
    const girth = beamGirth(b.t);
    if (reach > CRACKLE_FROM + 1) {
      for (let i = 0; i < 3; i++) {
        this.v.lerpVectors(b.from, at, rand(CRACKLE_FROM / reach, 1));
        this.w.copy(this.v).add(randomUnit(this.far).multiplyScalar(rand(0.6, 1.6) * girth));
        fx.arc(this.v, this.w, i === 0 ? 0xffffff : BOLT, 0.09, 0.03 * girth);
      }
    }
    c.render.post.chromatic(0.25 * power, 0.08);
  }

  /** True when the body stands within the beam's radius of the line: tested at its feet, its middle and its head. */
  private touches(e: EnemyInstance, eye: THREE.Vector3, dir: THREE.Vector3, reach: number): boolean {
    const top = e.char ? e.char.rig.height : 1.8;
    const room = BEAM.radius + 0.35;
    for (let i = 0; i < 3; i++) {
      const y = e.position.y + 0.3 + (top - 0.3) * (i / 2);
      this.w.set(e.position.x - eye.x, y - eye.y, e.position.z - eye.z);
      const along = this.w.dot(dir);
      if (along < 0 || along > reach) continue;
      this.w.addScaledVector(dir, -along);
      if (this.w.lengthSq() <= room * room) {
        this.far.copy(eye).addScaledVector(dir, along);
        return true;
      }
    }
    return false;
  }

  private endBeam(): void {
    const b = this.beamState;
    if (!b.active) return;
    b.active = false;
    // Whatever was owed is paid, so a beam let go of early costs what a whole one does.
    if (b.slot && b.paid < BEAM.cost) this.host.consume(b.slot, BEAM.cost - b.paid);
    b.slot = null;
    LANCE_LOOK.beam = 0;
    if (this.look) this.look.column.visible = this.look.sheath.visible = false;
    this.beamLoop?.stop(0.12);
    this.beamLoop = null;
    this.ctx.audio.play('railgun_beam');
  }

  /**
   * The beam is two ribbons turned to the eye about the line, a white-hot core in a wide blue sheath, with the Orbital
   * Lance's pulses racing down them. A column like the Orbital's goes dark seen down its own length, which is how the gun sees it.
   */
  private drawBeam(power: number): void {
    const look = this.look!;
    const b = this.beamState;
    const time = this.ctx.time.elapsed;
    const len = Math.max(0.1, b.from.distanceTo(b.to));
    const flicker = 1 + Math.sin(time * 61) * 0.08 + Math.sin(time * 23) * 0.05;
    const dir = this.v.subVectors(b.to, b.from).divideScalar(len);
    // Across the line, square to the eye from the middle of it.
    const side = this.w.copy(b.from).lerp(b.to, 0.5).sub(this.ctx.player.eye).cross(dir);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const normal = this.near.crossVectors(side, dir);
    BASIS.makeBasis(side, dir, normal);
    for (const [mesh, width] of [[look.column, BEAM.width], [look.sheath, BEAM.sheath]] as const) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uTime!.value = time;
      mat.uniforms.uPower!.value = power;
      mat.uniforms.uLen!.value = len;
      mesh.position.copy(b.from);
      mesh.quaternion.setFromRotationMatrix(BASIS);
      mesh.scale.set(width * 2 * flicker * beamGirth(b.t), len, 1);
    }
  }

  /**
   * Built the first time the gun charges, and drawn at nothing while it does, so the programs are compiled before the first
   * shot and not on its frame.
   */
  private ensureLook(): void {
    if (this.look) return;
    const { scene } = this.ctx.render;
    const ribbon = (core: string, rim: string, coreGain: number, rimGain: number): THREE.ShaderMaterial => new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
      uniforms: {
        uCore: { value: new THREE.Color(core).multiplyScalar(coreGain) }, uRim: { value: new THREE.Color(rim).multiplyScalar(rimGain) },
        uTime: { value: 0 }, uPower: { value: 0 }, uLen: { value: 1 },
      },
    });
    // The Orbital's own shader on a sphere is a glowing orb. Its colours are shared objects: these get their own.
    const orb = orbitalMaterials().column;
    orb.uniforms.uRim!.value = new THREE.Color('#2dff7a').multiplyScalar(3);
    orb.uniforms.uCore!.value = new THREE.Color('#f0fff4').multiplyScalar(6);
    const strip = new THREE.PlaneGeometry(0.5, 1).translate(0, 0.5, 0);
    const ball = new THREE.IcosahedronGeometry(1, 3);
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      return m;
    };
    this.look = {
      column: mesh(strip, ribbon('#f4fbff', '#5ab4ff', 22, 9)), sheath: mesh(strip, ribbon('#9fd8ff', '#2f7bff', 0, 6)),
      orb: mesh(ball, orb), halo: mesh(ball, orb), orbMat: orb,
    };
  }

  /** While charging: everything the shots draw, drawn at nothing, so its programs are ready. */
  private warm(on: boolean): void {
    const look = this.look;
    if (!look || this.beamState.active || this.giant.active) return;
    for (const m of [look.column, look.sheath, look.orb, look.halo]) {
      m.visible = on;
      if (!on) continue;
      m.position.copy(this.ctx.player.eye);
      m.scale.setScalar(1e-4);
    }
    look.orbMat.uniforms.uPower!.value = 0;
    (look.column.material as THREE.ShaderMaterial).uniforms.uPower!.value = 0;
    (look.sheath.material as THREE.ShaderMaterial).uniforms.uPower!.value = 0;
  }

  // -------------------------------------------------------------------------------------------
  // The giant ball
  // -------------------------------------------------------------------------------------------

  private fireGiant(s: LanceSlot): void {
    const c = this.ctx;
    const h = this.host;
    const g = this.giant;
    h.consume(s, GIANT.cost);
    h.feedback(GIANT_DEF, 1);
    this.fired.giants++;
    s.cooldown = GIANT.recover;
    // One in the air at a time: a second sets the first off where it is.
    if (g.active) this.detonate(null);
    g.active = true;
    g.age = 0;
    g.damage = GIANT.damage * h.modifiers.damage;
    g.dir.copy(c.player.forward);
    g.at.copy(this.muzzle()).addScaledVector(g.dir, GIANT.size * 0.6);
    this.ensureLook();
    this.warm(false);
    this.look!.orb.visible = this.look!.halo.visible = true;
    AT.position = g.at;
    this.giantLoop = c.audio.startLoop?.('lance_giant_loop', AT) ?? null;
    c.render.post.flash(GREEN, 0.25, 0.15);
    c.render.post.chromatic(0.6, 0.25);
    c.camera.addTrauma(0.3);
    c.player.velocity.x -= g.dir.x * T.push;
    c.player.velocity.z -= g.dir.z * T.push;
    this.drawGiant();
  }

  /** The ball's frame: on along its line until it touches a wall or a body, crackling as it goes. */
  private stepGiant(dt: number): void {
    const c = this.ctx;
    const g = this.giant;
    g.age += dt;
    const r = GIANT.size / 2;
    const move = GIANT.speed * dt;
    const wall = c.physics.raycast(g.at, g.dir, move + r, CG.World);
    const body = c.enemies.raycast(g.at, g.dir, move + r);
    if (wall && (!body || wall.distance <= body.distance)) {
      g.at.addScaledVector(g.dir, Math.max(0, wall.distance - r * 0.5));
      this.detonate(wall.normal);
      return;
    }
    if (body) {
      g.at.copy(body.point);
      this.detonate(null);
      return;
    }
    g.at.addScaledVector(g.dir, move);
    const n = c.enemies.query(g.at, r + 1.2, this.list);
    let touching = false;
    for (let i = 0; i < n && !touching; i++) touching = this.list[i]!.alive && this.list[i]!.center.distanceTo(g.at) < r + 0.6;
    this.list.length = 0;
    if (touching || g.age >= GIANT.life) {
      this.detonate(null);
      return;
    }
    this.drawGiant();
    const { fx } = c;
    if (Math.random() < 0.6) {
      randomUnit(this.v).multiplyScalar(rand(r * 1.2, r * 3)).add(g.at);
      fx.arc(g.at, this.v, Math.random() < 0.5 ? GREEN : BOLT, 0.09, 0.03);
    }
    fx.sparks(g.at, g.dir, 2, GREEN);
    c.render.lights.flash(g.at, GREEN, 10, 10, 0.06);
    this.giantLoop?.setPosition(g.at);
  }

  private drawGiant(): void {
    const look = this.look!;
    const g = this.giant;
    const time = this.ctx.time.elapsed;
    const r = (GIANT.size / 2) * Math.min(1, 0.3 + g.age * 6);
    look.orbMat.uniforms.uTime!.value = time;
    look.orbMat.uniforms.uPower!.value = 1;
    look.orb.position.copy(g.at);
    look.orb.scale.setScalar(r * (1 + Math.sin(time * 37) * 0.06));
    look.orb.rotation.set(time * 3, time * 5, 0);
    look.halo.position.copy(g.at);
    look.halo.scale.setScalar(r * (1.8 + Math.sin(time * 19) * 0.15));
  }

  /** The giant ball ends: a plasma blast that vaporizes what it kills, and a great deal of light and noise. */
  private detonate(normal: THREE.Vector3 | null): void {
    const c = this.ctx;
    const g = this.giant;
    const at = this.near.copy(g.at);
    this.endGiant();
    const nova = this.nova;
    nova.damage = g.damage;
    nova.normal = normal ?? undefined;
    this.combat.explode(at, nova);
    nova.normal = undefined;
    const { fx, render } = c;
    fx.ring(at, UP, GREEN, GIANT.blast * 2.2);
    fx.ring(at, UP, 0xbfeeff, GIANT.blast * 1.2);
    fx.ring(at, normal ?? UP, GREEN, GIANT.blast * 0.8);
    for (let i = 0; i < 5; i++) {
      randomUnit(this.v).multiplyScalar(rand(0.3, 0.6) * GIANT.blast).add(at);
      this.v.y = Math.max(this.v.y, at.y);
      fx.explosion(this.v, { radius: GIANT.blast * 0.3, kind: 'plasmaBurst', scale: 1.2 });
    }
    fx.heatShimmer(at, GIANT.blast, 0.9);
    fx.embers(at, 40, GIANT.blast * 0.3);
    render.lights.flash(at, GREEN, 40, GIANT.blast * 3, 0.5);
    const close = clamp(1 - at.distanceTo(c.player.position) / (GIANT.blast * 5));
    render.post.flash(GREEN, 0.25 + 0.45 * close, 0.4);
    render.post.chromatic(1.2 * close + 0.2, 0.5);
    render.post.radialBlur(0.3 * close, 0.35);
    c.camera.addTrauma(0.2 + 0.6 * close);
    c.time.hitStop(0.05 * close);
    AT.position = at;
    c.audio.play('lance_nova', AT);
  }

  private endGiant(): void {
    this.giant.active = false;
    if (this.look) this.look.orb.visible = this.look.halo.visible = false;
    this.giantLoop?.stop(0.1);
    this.giantLoop = null;
  }
}
