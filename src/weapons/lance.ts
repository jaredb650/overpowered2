/**
 * The Lance. A tap is a plasma ball. Held, the trigger charges through the stages in TUNING.lance, and letting go fires
 * the beam of the last stage reached: through bodies and, at full charge, through walls on the Lance's per-wall rule. At
 * every body a beam strikes a plasma burst goes off, one after another down the line.
 *
 * Three parts. The rules of the charge are plain functions. `PlasmaChain` is the pool the bursts wait in. `Lance` is the
 * trigger, driven by `Weapons` through the few things it needs of it (`LanceHost`), so none of this lives in Weapons.ts.
 * Every number is in data.ts. `?lance=old` turns all of it off and `Weapons.updateCharge` fires the gun as it did.
 *
 * Nothing here is one frame's work however long the line. A full beam is a sweep: it strikes a few bodies a frame and
 * carries on next frame from where it stopped, so twenty deaths are spread over the hit-stop its first one starts. Its
 * bursts are booked as it goes and set off a couple a frame.
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle } from '../core/contracts';
import type {
  AmmoState, ExplosionSpec, ProjectileSpec, ProjectileTrail, ShotSpec, StruckList, WeaponModifiers,
} from '../core/gameplay';
import { clamp } from '../core/math';
import type { Combat } from './Combat';
import { HIT_STOP, LANCE_OLD, TUNING, WEAPONS, type WeaponDef } from './data';

export const LANCE_ON = !LANCE_OLD;

const T = TUNING.lance;
const STAGES = T.stages;
const LAST = STAGES.length - 1;
const EPS = 1e-6;
/** Metres back up the beam the bolt to the first body starts from. */
const LEAD = 3;
/** The stretch of a full beam its own bolt crackles along, in metres from the muzzle. Not from the muzzle itself: there it fills the view. */
const CRACKLE_FROM = 2.5;
const CRACKLE_TO = 11;

// ---------------------------------------------------------------------------------------------
// The charge
// ---------------------------------------------------------------------------------------------

/** The last stage a charge of `level` has reached, or -1 under the first: a plasma ball. */
export function stageAt(level: number): number {
  let stage = -1;
  for (let i = 0; i <= LAST; i++) if (level >= STAGES[i]!.at - EPS) stage = i;
  return stage;
}

/** The highest stage a cell with `mag` left can pay for, or -1 when all it holds is balls. */
export function stageAfforded(mag: number, bottomless = false): number {
  if (bottomless) return LAST;
  let stage = -1;
  for (let i = 0; i <= LAST; i++) if (STAGES[i]!.cost <= mag) stage = i;
  return stage;
}

/** How far the charge can climb on what the cell holds: to the stage it can pay for and no further. */
export function chargeCap(mag: number, bottomless = false): number {
  const stage = stageAfforded(mag, bottomless);
  return stage < 0 ? 0 : STAGES[stage]!.at;
}

/** The charge after the trigger has been down `held` seconds. Nothing for the length of a tap, then a line to `cap`. */
export function chargeAfter(held: number, cap = 1): number {
  return Math.min(cap, clamp((held - T.tapTime) / T.chargeTime));
}

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
/** The ball's own feedback: the row's numbers are the full beam's. */
const BALL_DEF: WeaponDef = {
  ...DEF, muzzle: 'plasma', sounds: [{ id: 'lance_plasma', pitchJitter: 0.05 }],
  recoil: T.ball.recoil, kick: T.ball.kick, shake: T.ball.shake, fovPunch: T.ball.fovPunch,
};
/** A weaker beam is the same report higher and thinner. The full one is the row as written. */
const BEAM_DEFS: readonly WeaponDef[] = STAGES.map((st, i) => (i === LAST ? DEF : {
  ...DEF, sounds: [{ id: 'railgun_fire', pitch: 1.6 - 0.6 * st.weight, volume: 0.45 + 0.4 * st.weight }, { id: 'railgun_beam', volume: st.weight }],
}));

/** A beam on its way down a line: what it may still do, and where its next ray starts. */
interface Sweep {
  active: boolean;
  stage: number;
  readonly origin: THREE.Vector3;
  /** Where the next piece of the drawn beam starts. */
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
/** The charge hum's pitch from nothing to full, as a share of the loop as recorded. */
const HUM_LOW = 0.42;
const HUM_STEPS = 12;
/** Reused, so a charge builds nothing. */
const HUM_START = { pitch: HUM_LOW, volume: 0.3 };
const TICK = { pitch: 1 };

export class Lance {
  /** 0..1, for the HUD and the viewmodel. */
  level = 0;
  /** The stage the charge has reached, -1 under the first. */
  stage = -1;
  readonly chain = new PlasmaChain();
  /** Beams fired, by stage, and balls: for tests and the lab. */
  readonly fired = { balls: 0, beams: [0, 0, 0] as number[], bursts: 0 };

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

  private readonly struck: StruckList;
  private readonly sweep: Sweep = {
    active: false, stage: 0, origin: new THREE.Vector3(), from: new THREE.Vector3(), dir: new THREE.Vector3(), damage: 0, burstDamage: 0,
    bodies: 0, walls: 0, cleave: 0, reach: 0, perFrame: 0, kills: 0, at: 0, first: true,
  };
  private readonly end = new THREE.Vector3();
  private readonly burst: ExplosionSpec = {
    radius: 0, damage: 0, kind: 'plasmaBurst', source: DEF.id, team: 'player', selfDamage: 0, playerPush: 0,
    scale: T.chain.scale, shake: T.chain.shake,
  };
  private readonly ballBlast: NonNullable<ProjectileSpec['explosion']> = { radius: T.ball.radius, damage: 0, kind: 'plasmaBurst', scale: T.ball.scale };
  private readonly dir = new THREE.Vector3();
  private readonly near = new THREE.Vector3();
  private readonly far = new THREE.Vector3();
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

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  /** True while a beam is still on its way down a line. */
  get sweeping(): boolean {
    return this.sweep.active;
  }

  /**
   * Every frame, whatever is in hand: a beam still on its way strikes its next few bodies, and the bursts it has booked go
   * off on the world clock.
   */
  tick(): void {
    if (this.punching) this.stepPunch();
    if (this.sweep.active) this.step();
    if (this.chain.pending > 0) this.chain.drain(this.ctx.time.elapsed, this.fireLink);
  }

  /** Every frame the Lance is in hand and free to fire. */
  update(s: LanceSlot, dt: number, held: boolean): void {
    const { input } = this.ctx;
    const h = this.host;
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
    // Right click lets a charge go and keeps the cell, as it did.
    if (this.charging && input.pressed('aim')) {
      this.cancel();
      this.ctx.audio.play('railgun_fizzle');
      return;
    }
    this.heldFor += dt;
    const level = chargeAfter(this.heldFor, chargeCap(s.ammo.mag, h.modifiers.bottomlessMag));
    if (level <= 0) return;
    this.charge(level);
  }

  private charge(level: number): void {
    const { audio, camera, viewmodel } = this.ctx;
    if (!this.charging) {
      this.charging = true;
      this.hum = audio.startLoop?.('railgun_charge_loop', HUM_START) ?? null;
      this.humStep = -1;
      // A charge begun while the last beam's punch is still out narrows from the view it is going back to.
      this.fovFrom = this.punching ? this.punchFrom : typeof camera.fov === 'number' ? camera.fov : Number.NaN;
      this.punching = false;
    }
    this.level = level;
    const stage = stageAt(level);
    while (this.stage < stage) {
      this.stage++;
      // One tick a stage, each higher than the last, so the charge can be counted by ear.
      TICK.pitch = 1 + this.stage * 0.26;
      audio.play('lance_stage', TICK);
      if (this.stage === LAST) audio.play('railgun_ready');
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
  }

  private release(s: LanceSlot): void {
    const stage = this.charging ? stageAt(this.level) : -1;
    const from = this.fovFrom;
    this.cancel();
    if (stage < 0) this.fireBall(s);
    else {
      this.fireBeam(s, stage);
      this.punch(from, DEF.fovPunch * STAGES[stage]!.weight);
    }
  }

  /**
   * The beam's FOV punch, thrown outward from the charge's narrowed view. The camera's own punch sits under the zoom and
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

  /** Lets go of a press and whatever it had charged, with nothing fired and nothing spent. Bursts already booked still go off. */
  cancel(): void {
    this.endPunch();
    if (!this.holding && !this.charging) return;
    this.holding = false;
    this.heldFor = 0;
    this.level = 0;
    this.stage = -1;
    if (!this.charging) return;
    this.charging = false;
    this.hum?.stop(0.06);
    this.hum = null;
    this.ctx.viewmodel.setCharge(0);
    if (Number.isFinite(this.fovFrom)) this.ctx.camera.setZoom(null);
    this.fovFrom = Number.NaN;
  }

  /** A new run: nothing held, nothing on its way, nothing waiting to go off. */
  reset(): void {
    this.cancel();
    this.endSweep();
    this.chain.clear();
    this.fired.balls = this.fired.bursts = 0;
    this.fired.beams.fill(0);
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

  private fireBeam(s: LanceSlot, stage: number): void {
    const c = this.ctx;
    const h = this.host;
    const st = STAGES[stage]!;
    const def = s.def;
    const m = h.modifiers;
    const full = stage === LAST;
    h.consume(s, st.cost);
    h.feedback(BEAM_DEFS[stage]!, st.weight);
    this.fired.beams[stage] = (this.fired.beams[stage] ?? 0) + 1;
    s.cooldown = (h.interval(def) / def.interval) * T.recover * st.weight;

    // A beam still on its way from the last shot is finished where it stands: one list, one beam.
    this.endSweep();
    const sw = this.sweep;
    sw.active = true;
    sw.stage = stage;
    sw.origin.copy(c.player.eye);
    sw.from.copy(h.muzzleAt);
    sw.dir.copy(c.player.forward);
    sw.damage = def.damage * st.damage * m.damage;
    sw.burstDamage = st.burstDamage * m.damage;
    sw.bodies = st.pierce + 1;
    sw.walls = st.walls;
    sw.cleave = st.cleave;
    sw.reach = RANGE;
    // A few bodies a frame for the long line. A weaker beam has few to strike, and a beam a perk bounces or blows up at
    // its end is one ray as it always was: in pieces it would bounce or burst at the end of every piece.
    sw.perFrame = full && !m.explosiveRounds && m.ricochet === 0 ? T.sweep.perFrame : sw.bodies;
    sw.kills = 0;
    sw.at = c.time.elapsed;
    sw.first = true;
    this.struck.count = 0;
    this.struck.walls = 0;

    c.render.post.chromatic(0.4 * st.weight, 0.16);
    if (full) {
      // The full shot: a clap over the report, the screen pulled along the beam and the player shoved back. The world is
      // held on what it strikes, in `step`, and the bursts start when it moves again.
      c.audio.play('lance_thunder');
      c.render.post.radialBlur(0.22, 0.18);
      c.render.post.flash(FLASH, 0.18, 0.1);
      // Along the ground only: a shot at the floor must not lift the player off it.
      c.player.velocity.x -= sw.dir.x * T.push;
      c.player.velocity.z -= sw.dir.z * T.push;
    }
    this.step();
  }

  /** One ray of the beam: the next few bodies in line, the walls between them, and the piece of beam that reaches them. */
  private step(): void {
    const h = this.host;
    const sw = this.sweep;
    const st = STAGES[sw.stage]!;
    const full = sw.stage === LAST;
    const combat = this.combat;
    const list = this.struck;
    const want = Math.min(sw.bodies, sw.perFrame);
    const split = sw.perFrame < sw.bodies ? Math.min(sw.cleave, T.sweep.cleave) : sw.cleave;
    // Over unless this ray says otherwise: if a kill's listener throws, the beam must not be fired again every frame after.
    sw.active = false;

    const shot = h.shot(DEF, sw.damage);
    shot.pierce = want - 1;
    shot.tracer = undefined;
    shot.force = DEF.force * st.weight;
    shot.killStop = HIT_STOP.lanceKill;
    // Walls are the Lance's own per-wall rule (penetration.ts): up to `walls` of them, each up to `penetration` thick, of
    // anything, at no cost in damage. Bodies are `pierce`, and free.
    shot.penetrate = sw.walls > 0 ? T.penetration : 0;
    shot.penetrateWalls = sw.walls;
    shot.bodyCost = Infinity;
    shot.penetrateKeep = 1;
    shot.cleave = split;
    // A full beam is not stopped by a plate or a carried shield: it goes through them as it goes through the man.
    shot.armorPiercing = st.pierces;
    shot.impactScale = 1 + 0.6 * st.weight;
    shot.maxDistance = sw.reach;
    const before = list.count;
    const walls = list.walls;
    shot.struck = list;
    // Corpses on the first ray only. Ahead of a later one lie the bodies this beam killed a frame before, and the old
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

    this.drawBeam(sw.from, this.end, st, full && sw.first);
    this.chain.load(list, sw.dir, sw.at, st.burst, sw.burstDamage, T.chain.first, T.chain.gap, before);
    const stop = Math.min((full ? HIT_STOP.lanceShot : HIT_STOP.lanceKill - HIT_STOP.lancePerExtraKill) + sw.kills * HIT_STOP.lancePerExtraKill, HIT_STOP.lanceMax);
    if (full ? hit : sw.kills > 1) combat.feel.stop(stop, true);

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
   * The line itself: a core that stays and narrows away, and on a full charge a sheath that is gone in a blink and a bolt
   * crackling along its first few metres. The core is kept thin: seen from the gun it lies along the view, and a wide one
   * would hide the line of bursts it is there to show.
   */
  private drawBeam(from: THREE.Vector3, to: THREE.Vector3, st: (typeof STAGES)[number], full: boolean): void {
    const { fx } = this.ctx;
    fx.beam(from, to, 'rail', st.width, st.linger);
    if (!full) return;
    fx.beam(from, to, 'rail', st.width * T.sheath, 0.12);
    // A bolt's wander grows with its length, so one drawn down the whole beam would leave it by metres.
    const reach = from.distanceTo(to);
    if (reach <= CRACKLE_FROM + 1) return;
    const near = this.near.lerpVectors(from, to, CRACKLE_FROM / reach);
    const far = this.far.lerpVectors(from, to, Math.min(1, CRACKLE_TO / reach));
    fx.arc(near, far, BOLT, 0.3, 0.04);
  }

  /** One link of the chain: a bolt down the beam to the body it struck, a real blast there, and a ring round the line of the beam. */
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
}
