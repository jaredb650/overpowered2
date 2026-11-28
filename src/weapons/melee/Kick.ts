/**
 * First-person movement-intertwined kick system (`F` / `melee` action).
 *
 * Pressing `F` never draws or swings a knife or sword — blades only come out when explicitly equipped.
 * Instead, `F` dynamically chooses a kinetic martial-arts kick matched to your movement state and direction:
 *  - Grounded near ANY downed/crawling/rising opponent (or looking sharply down in low air):
 *    **Head Stomp** (`stomp`) — hoists the boot visibly overhead, snaps the camera down, and crushes their skull
 *    right inside the lower-center viewport (`source: 'stomp'`, `region: 'head'`).
 *  - Wall-running (`p.wallRunning`):
 *    **Wall-Run Kick** (`wallKickL` / `wallKickR`) — vaults explosively off the wall (refreshing your air kick),
 *    homing toward nearby targets and blasting them diagonally away (`source: 'wallKick'`).
 *  - Sliding (`p.sliding`):
 *    **Slide Tackle** (`slideKick`) — surges low along your slide and sweeps enemies' legs completely out from
 *    under them (even underneath Riot shields!), flipping them onto their backs for a follow-up stomp (`source: 'slideKick'`).
 *  - Airborne + strafing (`A` / `D`):
 *    **Tornado Kick** (`tornadoL` / `tornadoR`) — high-damage dramatic aerial spinning whip kick with air-hang lift,
 *    wide cleave, massive sideways launch, and bounce-refresh on hit (`source: 'tornado'`).
 *  - Airborne + forward / neutral:
 *    **Dive Kick** (`diveKick`) — double-leg flying dropkick that magnets toward enemies in range, blasts their chest
 *    across the room, and bounces you cleanly off them (refreshing air kicks!). With no enemy in range, lurches you
 *    aggressively forward once per airtime — usable as a skill-based 3rd air dash (`source: 'diveKick'`).
 *  - Grounded + strafing (`A` / `D`):
 *    **Roundhouse Kick** (`roundhouseL` / `roundhouseR`) — whipping horizontal kick in your movement direction that
 *    blasts enemies sideways (`source: 'roundhouse'`).
 *  - Grounded + backpedaling (`S`):
 *    **Push-Off Back Kick** (`backKick`) — thrusts rushing pursuers back while kicking yourself backward to safety.
 *  - Grounded + standing / forward (`W`):
 *    **Sparta Kick** (`kick`) — swift, violent forward boot thrust that ragdolls standing foes, breaks Riot shields
 *    wide open, and punts live grenades.
 */
import * as THREE from 'three';
import { HumanoidBone } from '../../characters/rig';
import { CG, type CharacterInstance, type Ctx } from '../../core/contracts';
import type { EnemyInstance, KickMove, WeaponModifiers } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { Combat } from '../Combat';

export const KICK = {
  /** Total kick animation duration (seconds) — swift, snapping Sparta thrust. */
  duration: 0.28,
  /** Seconds after press when the boot first connects. */
  impactAt: 0.04,
  /** Seconds after press when the active strike window closes. */
  liveEnd: 0.14,
  /** Brief recovery gap after the kick finishes before another can begin. */
  cooldown: 0.07,
  /** Forward clearing reach from the player's eye (meters, plus target body radius). */
  reach: 2.6,
  /** Horizontal distance within which flanking enemies rubbing against the player are still cleared. */
  pointBlank: 1.3,
  /** Minimum horizontal dot product with view forward (~70° half-angle arc). */
  minDot: 0.35,
  /** Wide dot product inside pointBlank so close swarmers on your hips get shoved away. */
  pointBlankDot: -0.05,
  /** Vertical tolerance between player eye and enemy center/chest (meters). */
  verticalReach: 1.85,
  /** Base kick damage (primary value is heavy ragdoll knockback and space creation). */
  damage: 35,
  /** Knockback impulse force passed through DamageInfo. */
  force: 190,
  /** Hit-stop duration on non-lethal contact. */
  hitStop: 0.055,
  /** Hit-stop duration on a lethal Sparta kick. */
  killStop: 0.08,
  /** Camera trauma on impact. */
  shake: 0.36,
  /** Live grenade punt reach (meters). */
  grenadeReach: 3.4,
} as const;

export const STOMP = {
  /** Total stomp animation duration (seconds) — clearly readable hoist, slam, and skull crush-grind. */
  duration: 0.42,
  /** Seconds into the animation when the heel slams down onto the skull right inside the lower-center frame. */
  impactAt: 0.14,
  /** Recovery gap after a stomp finishes. */
  cooldown: 0.08,
  /** Generous horizontal reach from the player to trigger a head stomp on any grounded enemy (meters). */
  reach: 3.2,
  /** Forgiving horizontal reach at the moment of heel impact so movement during windup still connects. */
  impactReach: 4.2,
  /** Maximum height above the player's feet for a grounded head (keeps airborne bodies from being stomped mid-flight). */
  maxHeadHeight: 1.3,
  /** Maximum height below the player's feet (stairs, curbs, ledges). */
  minHeadHeight: -1.55,
  /** Minimum horizontal dot product with view forward (full 180° front hemisphere outside underfoot radius). */
  minDot: 0.0,
  /** Horizontal distance within which any grounded opponent underfoot is stomped from any facing angle. */
  underfoot: 1.65,
  /** Guaranteed lethal finisher damage on grounded non-boss humanoids. */
  damage: 1000,
  /** Downward crush force passed through DamageInfo. */
  force: 150,
  /** Hit-stop on skull burst. */
  hitStop: 0.08,
  /** Camera trauma on skull burst. */
  shake: 0.52,
} as const;

export const DIVE_KICK = {
  duration: 0.42,
  impactAt: 0.03,
  liveEnd: 0.32,
  cooldown: 0.08,
  /** Max homing magnet acquisition range in front/below (meters). */
  magnetReach: 7.2,
  /** Minimum view-forward dot for dive-kick magnet lock. */
  magnetMinDot: 0.48,
  /** Horizontal homing velocity toward a locked enemy's chest (m/s). */
  magnetSpeed: 17.5,
  /** Free air-lurch forward speed when no enemy is in range (3rd-dash movement tech, m/s). */
  lurchSpeed: 16.5,
  /** Minimum vertical velocity granted on a free dive-kick air-lurch so it carries cleanly across gaps. */
  lurchLift: 2.8,
  /** Upward bounce velocity off an enemy's chest on dive-kick impact (m/s). */
  bounceUp: 7.6,
  /** Backward rebound velocity off an enemy's chest on dive-kick impact (m/s). */
  bounceBack: 5.4,
  reach: 2.85,
  minDot: 0.2,
  damage: 65,
  force: 300,
  hitStop: 0.075,
  killStop: 0.095,
  shake: 0.50,
} as const;

export const SLIDE_KICK = {
  duration: 0.34,
  impactAt: 0.04,
  liveEnd: 0.22,
  cooldown: 0.08,
  /** Forward speed surge added along the slide vector (m/s). */
  surge: 3.8,
  surgeCap: 19,
  reach: 2.85,
  minDot: 0.15,
  damage: 42,
  force: 220,
  hitStop: 0.06,
  killStop: 0.085,
  shake: 0.40,
} as const;

export const ROUNDHOUSE = {
  duration: 0.30,
  impactAt: 0.05,
  liveEnd: 0.16,
  cooldown: 0.07,
  stepSide: 4.2,
  stepFwd: 2.0,
  reach: 2.75,
  minDot: 0.05,
  damage: 48,
  force: 230,
  hitStop: 0.06,
  killStop: 0.085,
  shake: 0.42,
} as const;

export const TORNADO = {
  duration: 0.44,
  impactAt: 0.07,
  liveEnd: 0.28,
  cooldown: 0.10,
  /** Aerial hang/lift on launch (m/s). */
  lift: 4.4,
  /** Stylish lift sustain when the tornado connects in midair (m/s). */
  bounceUp: 5.4,
  sideSpeed: 7.5,
  fwdSpeed: 4.5,
  reach: 3.1,
  minDot: -0.35,
  damage: 75,
  force: 290,
  hitStop: 0.075,
  killStop: 0.095,
  shake: 0.54,
} as const;

export const WALL_KICK = {
  duration: 0.36,
  impactAt: 0.04,
  liveEnd: 0.24,
  cooldown: 0.08,
  magnetReach: 6.2,
  awaySpeed: 10.5,
  fwdSpeed: 12.5,
  lift: 7.2,
  bounceUp: 6.8,
  bounceBack: 4.5,
  reach: 3.0,
  minDot: 0.1,
  damage: 65,
  force: 265,
  hitStop: 0.07,
  killStop: 0.09,
  shake: 0.48,
} as const;

export const BACK_KICK = {
  duration: 0.28,
  impactAt: 0.04,
  liveEnd: 0.14,
  cooldown: 0.07,
  pushBack: 5.5,
  hitPushBack: 8.5,
  reach: 2.65,
  damage: 40,
  force: 210,
} as const;

const UP = new THREE.Vector3(0, 1, 0);
const MAX_LIST = 48;

interface EnemyExtras {
  downed?: boolean;
  rising?: number;
  maim?: { legs?: number };
  def?: { radius?: number };
}

interface GoreGroundQuery {
  downed?(char: CharacterInstance): { standing?: boolean } | null;
  rising?(char: CharacterInstance): boolean;
}

interface StrikeSpec {
  source: string;
  region: 'chest' | 'shinL';
  boneName: 'chest' | 'thighL';
  fallbackBone: number;
  damage: number;
  force: number;
  reach: number;
  minDot: number;
  impactAt: number;
  liveEnd: number;
  cooldown: number;
  hitStop: number;
  killStop: number;
  shake: number;
  callout: string | null;
}

/**
 * True when `e` is a live humanoid crawling prone on the floor (wounded/floored or legless)
 * with an intact head ready to be stomped.
 */
export function isCrawlingProne(e: EnemyInstance): boolean {
  if (!e.alive || e.isBoss || e.machine) return false;
  if (e.char.severed.has('head')) return false;
  if (e.char.anim.prone === true) return true;
  if (e.char.severed.has('legL') && e.char.severed.has('legR')) return true;
  return (e as unknown as EnemyExtras).maim?.legs === 0;
}

/**
 * True when `e` is ANY grounded live humanoid opponent with an intact head:
 *  - crawling prone wounded or legless (`isCrawlingProne`),
 *  - knocked down / ragdolled on the floor (`downed` and not standing upright in a carry/stagger),
 *  - mid-rise getting back up off the floor (`rising > 0` or `gore.rising(char)`),
 *  - or collapsed low near the ground (`headY - e.position.y < 1.0`).
 */
export function isGroundedOpponent(
  e: EnemyInstance,
  gore?: GoreGroundQuery | null,
  headY?: number,
): boolean {
  if (!e.alive || e.isBoss || e.machine) return false;
  if (e.char.severed.has('head')) return false;
  if (isCrawlingProne(e)) return true;
  const extras = e as unknown as EnemyExtras;
  if (extras.downed === true) {
    if (gore?.downed?.(e.char)?.standing !== true) return true;
  }
  if ((extras.rising ?? 0) > 0 || gore?.rising?.(e.char) === true) return true;
  if (headY !== undefined && headY - e.position.y < 1.0) return true;
  return false;
}

export class Kick {
  private mode: KickMove | null = null;
  private timer = 0;
  private duration = 0;
  private cooldownLeft = 0;
  private landed = false;
  private stompPlunged = false;
  private bounced = false;
  private hitCount = 0;
  private killCount = 0;
  private grenadePunted = false;
  /** True once a free air-kick movement lurch (dive kick / tornado) has been spent during the current airtime. */
  private airKickUsed = false;
  /** Lateral direction of the active sideways/wall kick: -1 left, +1 right, 0 forward. */
  private kickSide = 0;
  private stompTarget: EnemyInstance | null = null;
  private magnetTarget: EnemyInstance | null = null;

  private readonly struck: EnemyInstance[] = [];
  private readonly list: EnemyInstance[] = [];
  private readonly flatFwd = new THREE.Vector3();
  private readonly flatRight = new THREE.Vector3();
  private readonly contact = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly strikeDir = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly rayDir = new THREE.Vector3();
  private readonly tmpVel = new THREE.Vector3();
  private readonly stompFx = new THREE.Vector3();

  constructor(
    private readonly ctx: Ctx,
    private readonly combat: Combat,
    private readonly modifiers: WeaponModifiers,
  ) {}

  get active(): boolean {
    return this.mode !== null;
  }

  get move(): KickMove | null {
    return this.mode;
  }

  get canStart(): boolean {
    return this.mode === null && this.cooldownLeft <= 0;
  }

  /** Advances post-kick cooldown and refreshes the free air-kick lurch on landing or wall-run. */
  tick(dt: number): void {
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    const p = this.ctx.player;
    if (p.grounded || p.wallRunning) this.airKickUsed = false;
  }

  cancel(): void {
    if (this.mode !== null) {
      this.mode = null;
      this.stompTarget = null;
      this.magnetTarget = null;
      this.struck.length = 0;
    }
  }

  reset(): void {
    this.cancel();
    this.timer = 0;
    this.duration = 0;
    this.cooldownLeft = 0;
    this.landed = false;
    this.stompPlunged = false;
    this.bounced = false;
    this.hitCount = 0;
    this.killCount = 0;
    this.grenadePunted = false;
    this.airKickUsed = false;
    this.kickSide = 0;
  }

  /** Selects and starts the contextual movement-intertwined kick move for the current player state. */
  start(): KickMove | null {
    if (!this.canStart) return null;
    const c = this.ctx;
    const p = c.player;
    const flat = this.computeFlatForward();
    const right = this.computeFlatRight(flat);

    this.timer = 0;
    this.landed = false;
    this.stompPlunged = false;
    this.bounced = false;
    this.hitCount = 0;
    this.killCount = 0;
    this.grenadePunted = false;
    this.kickSide = 0;
    this.stompTarget = null;
    this.magnetTarget = null;
    this.struck.length = 0;

    // 1. Head Stomp: grounded (not sliding) near any downed/crawling opponent, or deliberately looking down in low air.
    if (!p.sliding && !p.wallRunning) {
      const airDropStomp = !p.grounded && p.forward.y < -0.45;
      if (p.grounded || airDropStomp) {
        const stomp = this.findStompTarget(airDropStomp ? 1.9 : STOMP.reach);
        if (stomp) return this.beginStomp(stomp);
      }
    }

    // 2. Wall-Run Kick: athletic parkour kick-off away from the wall with homing cleave + air-kick refresh!
    if (p.wallRunning) {
      return this.beginWallKick(flat, right);
    }

    // 3. Slide Tackle: low twin-leg shin sweep that stays in slide and kicks enemies' legs out from under them!
    if (p.sliding) {
      return this.beginSlideKick(flat);
    }

    // Read movement intent (directional keys + velocity frame) to pick aerial vs grounded martial-arts moves.
    const fwdIn = (c.input.isDown('forward') ? 1 : 0) - (c.input.isDown('back') ? 1 : 0);
    const sideIn = (c.input.isDown('right') ? 1 : 0) - (c.input.isDown('left') ? 1 : 0);
    const fwdVel = p.velocity.x * flat.x + p.velocity.z * flat.z;
    const latVel = p.velocity.x * right.x + p.velocity.z * right.z;

    // 4. Airborne kicks: Jump-strafing -> Tornado Kick; Jump-forward / neutral -> Double-Leg Dive Kick!
    if (!p.grounded) {
      const wantTornado = sideIn !== 0 && (fwdIn <= 0 || Math.abs(latVel) > Math.max(2.0, fwdVel * 0.9));
      if (wantTornado) {
        return this.beginTornado(sideIn > 0 ? 1 : -1, flat, right);
      }
      return this.beginDiveKick(flat, fwdVel);
    }

    // 5. Grounded kicks: Strafing -> Roundhouse; Backpedaling -> Push-Off Back Kick; Forward/Neutral -> Sparta Kick!
    const wantRoundhouse = sideIn !== 0 && (fwdIn <= 0 || Math.abs(latVel) > Math.max(2.5, fwdVel * 1.1));
    if (wantRoundhouse) {
      return this.beginRoundhouse(sideIn > 0 ? 1 : -1, flat, right);
    }
    if (fwdIn < 0 && sideIn === 0) {
      return this.beginBackKick(flat);
    }
    return this.beginSpartaKick();
  }

  update(dt: number): void {
    if (this.mode === null) return;
    this.timer += dt;

    if (this.mode === 'stomp') {
      // Plunge the camera down with the descending boot right before impact so the skull crush happens squarely in frame.
      if (!this.stompPlunged && this.timer >= STOMP.impactAt - 0.045) {
        this.stompPlunged = true;
        this.ctx.camera.kick(-0.18, 0, 0.025);
      }
      if (!this.landed && this.timer >= STOMP.impactAt) {
        this.landed = true;
        this.landStomp();
      }
      if (this.timer >= this.duration) {
        this.mode = null;
        this.stompTarget = null;
        this.cooldownLeft = STOMP.cooldown;
      }
      return;
    }

    const spec = this.specOf(this.mode);

    // Gentle mid-flight homing for Dive Kick / Wall Kick until first enemy contact.
    if ((this.mode === 'diveKick' || this.mode === 'wallKickL' || this.mode === 'wallKickR')
      && !this.bounced && this.magnetTarget?.alive && this.timer < spec.liveEnd) {
      this.steerMagnet(this.magnetTarget, this.mode === 'diveKick' ? DIVE_KICK.magnetSpeed : WALL_KICK.fwdSpeed + 3);
    }

    if (this.timer >= spec.impactAt) {
      const first = !this.landed;
      this.landed = true;
      if (this.timer <= spec.liveEnd || first) this.scanKick(spec);
      if (first && this.hitCount === 0 && !this.grenadePunted && this.mode !== 'slideKick') this.kickWall(spec);
    }

    if (this.timer >= this.duration) {
      this.mode = null;
      this.magnetTarget = null;
      this.struck.length = 0;
      this.cooldownLeft = spec.cooldown;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Move initializers
  // -------------------------------------------------------------------------------------------

  private beginStomp(stomp: EnemyInstance): KickMove {
    const c = this.ctx;
    const p = c.player;
    this.mode = 'stomp';
    this.stompTarget = stomp;
    this.duration = STOMP.duration;
    const head = this.combat.headOf(stomp, this.contact);
    c.viewmodel.kick?.('stomp', STOMP.duration);
    c.audio.play('stomp_hit', { position: head, pitchJitter: 0.03 });
    // Slight upward hoist cue as the knee rips high, followed by the hard downward plunge right before impact.
    c.camera.kick(0.055, 0, -0.025);
    c.camera.fovPunch?.(-3.2, 0.12);

    // Tight magnetic step-in when grounded so the skull sits right under your descending boot.
    if (p.grounded) {
      const dx = head.x - p.position.x;
      const dz = head.z - p.position.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > 0.55) {
        const lunge = Math.min(10.5, (horiz - 0.42) * 7.2);
        p.velocity.x = (dx / horiz) * lunge;
        p.velocity.z = (dz / horiz) * lunge;
      }
    }
    return 'stomp';
  }

  private beginSpartaKick(): KickMove {
    const c = this.ctx;
    this.mode = 'kick';
    this.duration = KICK.duration;
    c.viewmodel.kick?.('kick', KICK.duration);
    c.audio.play('kick_swing', { pitchJitter: 0.05 });
    c.camera.kick(-0.028, 0.016, -0.024);
    c.camera.fovPunch?.(3.2, 0.12);
    return 'kick';
  }

  private beginBackKick(flat: THREE.Vector3): KickMove {
    const c = this.ctx;
    const p = c.player;
    this.mode = 'backKick';
    this.duration = BACK_KICK.duration;
    c.viewmodel.kick?.('backKick', BACK_KICK.duration);
    c.audio.play('kick_swing', { pitch: 1.06, pitchJitter: 0.04 });
    c.camera.kick(-0.036, 0.012, -0.022);
    c.camera.fovPunch?.(3.8, 0.13);
    // Immediate backward push-off burst away from the threat ahead.
    p.velocity.x = -flat.x * BACK_KICK.pushBack;
    p.velocity.z = -flat.z * BACK_KICK.pushBack;
    return 'backKick';
  }

  private beginRoundhouse(dir: 1 | -1, flat: THREE.Vector3, right: THREE.Vector3): KickMove {
    const c = this.ctx;
    const p = c.player;
    const move: KickMove = dir > 0 ? 'roundhouseR' : 'roundhouseL';
    this.mode = move;
    this.kickSide = dir;
    this.duration = ROUNDHOUSE.duration;
    c.viewmodel.kick?.(move, ROUNDHOUSE.duration);
    c.audio.play('kick_swing', { pitch: 1.12, pitchJitter: 0.05 });
    c.camera.kick(-0.022, -dir * 0.068, dir * 0.082);
    c.camera.fovPunch?.(4.2, 0.14);
    // Snappy lateral step-in burst along the roundhouse direction.
    p.velocity.x += right.x * dir * ROUNDHOUSE.stepSide + flat.x * ROUNDHOUSE.stepFwd;
    p.velocity.z += right.z * dir * ROUNDHOUSE.stepSide + flat.z * ROUNDHOUSE.stepFwd;
    return move;
  }

  private beginTornado(dir: 1 | -1, flat: THREE.Vector3, right: THREE.Vector3): KickMove {
    const c = this.ctx;
    const p = c.player;
    const move: KickMove = dir > 0 ? 'tornadoR' : 'tornadoL';
    this.mode = move;
    this.kickSide = dir;
    this.duration = TORNADO.duration;
    c.viewmodel.kick?.(move, TORNADO.duration);
    c.audio.play('kick_swing', { volume: 1.1, pitch: 1.24, pitchJitter: 0.04 });
    // Dramatic aerial spin whip camera roll & yaw snap.
    c.camera.kick(-0.042, -dir * 0.16, dir * 0.19);
    c.camera.fovPunch?.(7.0, 0.18);

    if (!this.airKickUsed) {
      this.airKickUsed = true;
      const vx = right.x * dir * TORNADO.sideSpeed + flat.x * TORNADO.fwdSpeed;
      const vz = right.z * dir * TORNADO.sideSpeed + flat.z * TORNADO.fwdSpeed;
      const vy = Math.max(p.velocity.y, TORNADO.lift);
      this.setAirVelocity(vx, vy, vz);
    }
    return move;
  }

  private beginDiveKick(flat: THREE.Vector3, fwdVel: number): KickMove {
    const c = this.ctx;
    const p = c.player;
    this.mode = 'diveKick';
    this.duration = DIVE_KICK.duration;
    c.viewmodel.kick?.('diveKick', DIVE_KICK.duration);
    c.audio.play('kick_swing', { volume: 1.12, pitch: 0.86, pitchJitter: 0.04 });
    c.camera.kick(-0.055, 0, 0.025);
    c.camera.fovPunch?.(6.2, 0.18);

    const target = this.findMagnetTarget(DIVE_KICK.magnetReach, DIVE_KICK.magnetMinDot, flat);
    if (target) {
      this.magnetTarget = target;
      const speed = Math.max(Math.hypot(p.velocity.x, p.velocity.z) + 4.5, DIVE_KICK.magnetSpeed);
      this.steerMagnet(target, speed);
    } else if (!this.airKickUsed) {
      // No enemy in magnet range: aggressive forward lurch usable as a skill-based 3rd air dash!
      this.airKickUsed = true;
      const surge = Math.max(fwdVel + 8.5, DIVE_KICK.lurchSpeed);
      const vy = Math.max(p.velocity.y * 0.45, DIVE_KICK.lurchLift);
      this.setAirVelocity(flat.x * surge, vy, flat.z * surge);
    }
    return 'diveKick';
  }

  private beginSlideKick(flat: THREE.Vector3): KickMove {
    const c = this.ctx;
    const p = c.player;
    this.mode = 'slideKick';
    this.duration = SLIDE_KICK.duration;
    c.viewmodel.kick?.('slideKick', SLIDE_KICK.duration);
    c.audio.play('kick_swing', { pitch: 0.92, pitchJitter: 0.05 });
    c.camera.kick(0.032, 0.045, -0.078);
    c.camera.fovPunch?.(4.8, 0.16);

    // Stay in the slide and surge forward along current slide velocity (or look forward) into their shins.
    const curSpeed = Math.hypot(p.velocity.x, p.velocity.z);
    let dx = flat.x;
    let dz = flat.z;
    if (curSpeed > 1.5) {
      dx = p.velocity.x / curSpeed;
      dz = p.velocity.z / curSpeed;
    }
    const nextSpeed = Math.min(Math.max(curSpeed + SLIDE_KICK.surge, 13.5), Math.max(curSpeed + 2, SLIDE_KICK.surgeCap));
    p.velocity.x = dx * nextSpeed;
    p.velocity.z = dz * nextSpeed;
    return 'slideKick';
  }

  private beginWallKick(flat: THREE.Vector3, right: THREE.Vector3): KickMove {
    const c = this.ctx;
    const p = c.player;
    // wallSide: -1 means wall on left -> kick off to right (+1); +1 means wall on right -> kick off to left (-1).
    const wallSide = p.wallSide === 0 ? -1 : p.wallSide;
    const awayDir: 1 | -1 = wallSide < 0 ? 1 : -1;
    const move: KickMove = awayDir > 0 ? 'wallKickR' : 'wallKickL';
    this.mode = move;
    this.kickSide = awayDir;
    this.duration = WALL_KICK.duration;
    // Kicking off a wall refreshes your free air dive-kick / tornado!
    this.airKickUsed = false;

    c.viewmodel.kick?.(move, WALL_KICK.duration);
    c.audio.play('kick_swing', { volume: 1.08, pitch: 0.96, pitchJitter: 0.04 });
    c.audio.play('impact_concrete', { position: p.position, volume: 0.75, pitch: 0.88 });
    c.camera.kick(-0.045, wallSide * 0.09, -wallSide * 0.13);
    c.camera.fovPunch?.(6.5, 0.18);

    const target = this.findMagnetTarget(WALL_KICK.magnetReach, 0.25, flat);
    if (target) {
      this.magnetTarget = target;
      const dx = target.center.x - p.position.x;
      const dz = target.center.z - p.position.z;
      const horiz = Math.hypot(dx, dz) || 1;
      const spd = Math.max(WALL_KICK.fwdSpeed + 3.5, Math.hypot(p.velocity.x, p.velocity.z) + 3);
      this.setAirVelocity((dx / horiz) * spd, WALL_KICK.lift, (dz / horiz) * spd);
    } else {
      const vx = flat.x * WALL_KICK.fwdSpeed + right.x * awayDir * WALL_KICK.awaySpeed;
      const vz = flat.z * WALL_KICK.fwdSpeed + right.z * awayDir * WALL_KICK.awaySpeed;
      this.setAirVelocity(vx, WALL_KICK.lift, vz);
    }
    return move;
  }

  // -------------------------------------------------------------------------------------------
  // Physics / velocity helpers
  // -------------------------------------------------------------------------------------------

  private setAirVelocity(vx: number, vy: number, vz: number): void {
    const p = this.ctx.player;
    this.tmpVel.set(vx - p.velocity.x, vy, vz - p.velocity.z);
    p.launch(this.tmpVel);
    // Keep StubPlayer in tests (whose launch() is a no-op) synchronized cleanly.
    p.velocity.set(vx, vy, vz);
  }

  private steerMagnet(target: EnemyInstance, speed: number): void {
    const p = this.ctx.player;
    const dx = target.center.x - p.position.x;
    const dz = target.center.z - p.position.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1.05) return;
    const dy = target.center.y - (p.position.y + 0.55);
    const eta = Math.max(horiz / speed, 0.12);
    const vy = clamp(dy / eta, -7.5, 5.5);
    this.setAirVelocity((dx / horiz) * speed, vy, (dz / horiz) * speed);
  }

  private specOf(move: KickMove): StrikeSpec {
    switch (move) {
      case 'diveKick':
        return {
          source: 'diveKick', region: 'chest', boneName: 'chest', fallbackBone: HumanoidBone.chest,
          damage: DIVE_KICK.damage, force: DIVE_KICK.force, reach: DIVE_KICK.reach, minDot: DIVE_KICK.minDot,
          impactAt: DIVE_KICK.impactAt, liveEnd: DIVE_KICK.liveEnd, cooldown: DIVE_KICK.cooldown,
          hitStop: DIVE_KICK.hitStop, killStop: DIVE_KICK.killStop, shake: DIVE_KICK.shake, callout: 'DIVE KICK',
        };
      case 'slideKick':
        return {
          source: 'slideKick', region: 'shinL', boneName: 'thighL', fallbackBone: HumanoidBone.thighL,
          damage: SLIDE_KICK.damage, force: SLIDE_KICK.force, reach: SLIDE_KICK.reach, minDot: SLIDE_KICK.minDot,
          impactAt: SLIDE_KICK.impactAt, liveEnd: SLIDE_KICK.liveEnd, cooldown: SLIDE_KICK.cooldown,
          hitStop: SLIDE_KICK.hitStop, killStop: SLIDE_KICK.killStop, shake: SLIDE_KICK.shake, callout: 'LEG SWEEP',
        };
      case 'roundhouseL':
      case 'roundhouseR':
        return {
          source: 'roundhouse', region: 'chest', boneName: 'chest', fallbackBone: HumanoidBone.chest,
          damage: ROUNDHOUSE.damage, force: ROUNDHOUSE.force, reach: ROUNDHOUSE.reach, minDot: ROUNDHOUSE.minDot,
          impactAt: ROUNDHOUSE.impactAt, liveEnd: ROUNDHOUSE.liveEnd, cooldown: ROUNDHOUSE.cooldown,
          hitStop: ROUNDHOUSE.hitStop, killStop: ROUNDHOUSE.killStop, shake: ROUNDHOUSE.shake, callout: null,
        };
      case 'tornadoL':
      case 'tornadoR':
        return {
          source: 'tornado', region: 'chest', boneName: 'chest', fallbackBone: HumanoidBone.chest,
          damage: TORNADO.damage, force: TORNADO.force, reach: TORNADO.reach, minDot: TORNADO.minDot,
          impactAt: TORNADO.impactAt, liveEnd: TORNADO.liveEnd, cooldown: TORNADO.cooldown,
          hitStop: TORNADO.hitStop, killStop: TORNADO.killStop, shake: TORNADO.shake, callout: 'TORNADO KICK',
        };
      case 'wallKickL':
      case 'wallKickR':
        return {
          source: 'wallKick', region: 'chest', boneName: 'chest', fallbackBone: HumanoidBone.chest,
          damage: WALL_KICK.damage, force: WALL_KICK.force, reach: WALL_KICK.reach, minDot: WALL_KICK.minDot,
          impactAt: WALL_KICK.impactAt, liveEnd: WALL_KICK.liveEnd, cooldown: WALL_KICK.cooldown,
          hitStop: WALL_KICK.hitStop, killStop: WALL_KICK.killStop, shake: WALL_KICK.shake, callout: 'WALL KICK',
        };
      case 'backKick':
        return {
          source: 'kick', region: 'chest', boneName: 'chest', fallbackBone: HumanoidBone.chest,
          damage: BACK_KICK.damage, force: BACK_KICK.force, reach: BACK_KICK.reach, minDot: KICK.minDot,
          impactAt: BACK_KICK.impactAt, liveEnd: BACK_KICK.liveEnd, cooldown: BACK_KICK.cooldown,
          hitStop: KICK.hitStop, killStop: KICK.killStop, shake: KICK.shake, callout: null,
        };
      default:
        return {
          source: 'kick', region: 'chest', boneName: 'chest', fallbackBone: HumanoidBone.chest,
          damage: KICK.damage, force: KICK.force, reach: KICK.reach, minDot: KICK.minDot,
          impactAt: KICK.impactAt, liveEnd: KICK.liveEnd, cooldown: KICK.cooldown,
          hitStop: KICK.hitStop, killStop: KICK.killStop, shake: KICK.shake, callout: null,
        };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Target finding & LOS
  // -------------------------------------------------------------------------------------------

  private computeFlatForward(): THREE.Vector3 {
    const fwd = this.ctx.player.forward;
    this.flatFwd.set(fwd.x, 0, fwd.z);
    if (this.flatFwd.lengthSq() < 1e-6) {
      const yaw = this.ctx.player.yaw;
      this.flatFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    } else {
      this.flatFwd.normalize();
    }
    return this.flatFwd;
  }

  private computeFlatRight(flat: THREE.Vector3): THREE.Vector3 {
    // flat x UP = (-flat.z, 0, flat.x)
    return this.flatRight.set(-flat.z, 0, flat.x);
  }

  private blocked(eye: THREE.Vector3, target: THREE.Vector3, margin: number): boolean {
    const dir = this.rayDir.subVectors(target, eye);
    const dist = dir.length();
    if (dist <= margin + 0.05) return false;
    dir.divideScalar(dist);
    return this.ctx.physics.raycast(eye, dir, dist - margin, CG.World) !== null;
  }

  private radiusOf(e: EnemyInstance): number {
    const r = (e as unknown as EnemyExtras).def?.radius;
    return r !== undefined ? clamp(r * 0.9, 0.28, 0.75) : 0.4;
  }

  private boneIndex(e: EnemyInstance, name: string, fallback: number): number {
    const bones = e.char.rig.bones;
    for (let i = 0; i < bones.length; i++) if (bones[i]!.name === name) return i;
    return fallback;
  }

  /** Finds the best airborne homing target for Dive Kick or Wall-Run Kick. */
  private findMagnetTarget(maxReach: number, minDot: number, flat: THREE.Vector3): EnemyInstance | null {
    const c = this.ctx;
    const p = c.player;
    const n = Math.min(c.enemies.query(p.eye, maxReach + 1.5, this.list) || 0, MAX_LIST);
    let best: EnemyInstance | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;
      const extras = e as unknown as EnemyExtras;
      if (extras.downed || isCrawlingProne(e)) continue;

      const dx = e.center.x - p.position.x;
      const dz = e.center.z - p.position.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz < 0.1 || horiz > maxReach) continue;

      const dy = e.center.y - p.position.y;
      if (dy < -3.8 || dy > 2.4) continue;

      const dot = (dx * flat.x + dz * flat.z) / horiz;
      if (dot < minDot) continue;
      if (this.blocked(p.eye, e.center, Math.max(0.25, this.radiusOf(e)))) continue;

      const score = horiz + (1 - dot) * 4.0;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /**
   * Finds the best grounded opponent in front/underfoot to head-stomp.
   * Generous by design: measures distance to the closer of the opponent's head or body so standing over
   * their torso/legs still triggers effortlessly, and only yields to a Sparta kick if a standing enemy is
   * literally point-blank straight ahead and closer while the player isn't looking down.
   */
  private findStompTarget(maxReach: number): EnemyInstance | null {
    const c = this.ctx;
    const p = c.player;
    const gore = c.gore as unknown as GoreGroundQuery | undefined;
    const flat = this.computeFlatForward();
    const n = Math.min(c.enemies.query(p.position, maxReach + 2.5, this.list) || 0, MAX_LIST);

    let best: EnemyInstance | null = null;
    let bestScore = Infinity;
    let bestHoriz = Infinity;
    let closestStanding = Infinity;

    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;

      const head = this.combat.headOf(e, this.contact);
      if (!isGroundedOpponent(e, gore, head.y)) {
        const dx = e.position.x - p.position.x;
        const dz = e.position.z - p.position.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz < 1.15 && horiz > 1e-4) {
          const dot = (dx * flat.x + dz * flat.z) / horiz;
          if (dot > 0.78 && Math.abs(e.center.y - p.eye.y) <= KICK.verticalReach) {
            if (horiz < closestStanding) closestStanding = horiz;
          }
        }
        continue;
      }

      const relY = head.y - p.position.y;
      if (relY > STOMP.maxHeadHeight || relY < STOMP.minHeadHeight) continue;

      const hdx = head.x - p.position.x;
      const hdz = head.z - p.position.z;
      const headHoriz = Math.hypot(hdx, hdz);

      const bdx = e.position.x - p.position.x;
      const bdz = e.position.z - p.position.z;
      const bodyHoriz = Math.hypot(bdx, bdz);

      const effHoriz = Math.min(headHoriz, bodyHoriz);
      if (effHoriz > maxReach) continue;

      const headDot = headHoriz > 1e-4 ? (hdx * flat.x + hdz * flat.z) / headHoriz : 1;
      const bodyDot = bodyHoriz > 1e-4 ? (bdx * flat.x + bdz * flat.z) / bodyHoriz : 1;
      const dot = Math.max(headDot, bodyDot);

      if (effHoriz > STOMP.underfoot && dot < STOMP.minDot) continue;
      if (this.blocked(p.eye, head, 0.35)) continue;

      const score = effHoriz + (1 - Math.max(0, dot)) * 0.55;
      if (score < bestScore) {
        bestScore = score;
        bestHoriz = effHoriz;
        best = e;
      }
    }

    if (best && closestStanding < bestHoriz && p.forward.y > -0.15) return null;
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Head stomp resolution
  // -------------------------------------------------------------------------------------------

  private landStomp(): void {
    const c = this.ctx;
    const p = c.player;
    const target = this.stompTarget;

    if (!target || !target.alive || target.char.severed.has('head')) {
      c.audio.play('impact_concrete', { position: p.position, volume: 0.85, pitch: 0.72 });
      c.camera.kick(-0.08, 0, 0.016);
      return;
    }

    const head = this.combat.headOf(target, this.contact);
    const headHoriz = Math.hypot(head.x - p.position.x, head.z - p.position.z);
    const bodyHoriz = Math.hypot(target.position.x - p.position.x, target.position.z - p.position.z);
    if (Math.min(headHoriz, bodyHoriz) > STOMP.impactReach) {
      c.audio.play('impact_concrete', { position: p.position, volume: 0.85, pitch: 0.72 });
      c.camera.kick(-0.08, 0, 0.016);
      return;
    }

    const flat = this.computeFlatForward();
    this.strikeDir.set(flat.x * 0.38, -0.925, flat.z * 0.38).normalize();
    const o = this.combat.strikeOptions('melee', 'stomp');
    o.force = STOMP.force;
    o.severMult = 0;
    o.headshotMult = 1;
    o.pierces = true;
    o.quiet = true;

    const headBone = this.boneIndex(target, 'head', HumanoidBone.head);
    const dmg = STOMP.damage * Math.max(1, this.modifiers.damage);
    const res = this.combat.strike(target, head, UP, this.strikeDir, headBone, 'head', dmg, o);

    // Spray blood up directly around the descending boot heel so the crush reads unmistakably in view.
    this.stompFx.copy(head);
    this.stompFx.y += 0.08;
    c.fx.bloodHit(this.stompFx, UP, 2.8);
    c.fx.bloodJet(this.stompFx, UP, 1.7);
    c.fx.impact(head, UP, 'concrete', 1.3);
    c.camera.kick(-0.14, rand(-0.025, 0.025), 0.048);
    c.camera.fovPunch?.(7.5, 0.18);
    this.combat.feel.shake(STOMP.shake);
    this.combat.feel.stop(STOMP.hitStop, true);
    c.hud.hitMarker(res.killed ? 'kill' : 'head');
  }

  // -------------------------------------------------------------------------------------------
  // Kick strike sweep resolution (Sparta, Dive, Slide, Roundhouse, Tornado, Wall, Back)
  // -------------------------------------------------------------------------------------------

  private scanKick(spec: StrikeSpec): void {
    const c = this.ctx;
    const p = c.player;
    const eye = p.eye;
    const flat = this.computeFlatForward();
    const right = this.computeFlatRight(flat);
    const prevHits = this.hitCount;
    const prevKills = this.killCount;
    const move = this.mode!;
    let brokeShield = false;

    const n = Math.min(c.enemies.query(eye, spec.reach + 2.5, this.list) || 0, MAX_LIST);
    const damage = spec.damage * this.modifiers.damage;

    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive || this.struck.includes(e)) continue;

      const extras = e as unknown as EnemyExtras;
      const radius = this.radiusOf(e);
      if (move === 'slideKick') {
        // Low shin/ankle contact point for slide tackle leg sweep.
        this.contact.set(e.position.x, e.position.y + 0.55, e.position.z);
      } else if (extras.downed || isCrawlingProne(e)) {
        this.contact.set(e.position.x, e.position.y + 0.45, e.position.z);
      } else {
        this.contact.copy(e.center);
      }

      const dx = this.contact.x - eye.x;
      const dz = this.contact.z - eye.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz - radius > spec.reach) continue;
      const vTol = move === 'diveKick' || move === 'tornadoL' || move === 'tornadoR' ? 2.4 : KICK.verticalReach;
      if (Math.abs(this.contact.y - eye.y) > vTol) continue;

      const dot = horiz > 1e-4 ? (dx * flat.x + dz * flat.z) / horiz : 1;
      const minDot = horiz <= KICK.pointBlank + radius ? Math.min(spec.minDot, KICK.pointBlankDot) : spec.minDot;
      if (dot < minDot) continue;
      if (this.blocked(eye, this.contact, Math.max(0.25, radius))) continue;

      this.struck.push(e);

      // Compute move-specific launch direction.
      if (move === 'roundhouseL' || move === 'roundhouseR' || move === 'tornadoL' || move === 'tornadoR') {
        // Whip enemies strongly SIDEWAYS in the direction of your kick!
        const sideW = move === 'tornadoL' || move === 'tornadoR' ? 0.85 : 0.82;
        const fwdW = 1 - sideW;
        this.strikeDir.set(
          right.x * this.kickSide * sideW + flat.x * fwdW,
          0,
          right.z * this.kickSide * sideW + flat.z * fwdW,
        );
      } else if (move === 'wallKickL' || move === 'wallKickR') {
        this.strikeDir.set(
          flat.x * 0.65 + right.x * this.kickSide * 0.35,
          0,
          flat.z * 0.65 + right.z * this.kickSide * 0.35,
        );
      } else if (horiz > 1e-4) {
        this.toTarget.set(dx / horiz, 0, dz / horiz);
        this.strikeDir.set(flat.x * 0.7 + this.toTarget.x * 0.3, 0, flat.z * 0.7 + this.toTarget.z * 0.3);
      } else {
        this.strikeDir.copy(flat);
      }
      if (this.strikeDir.lengthSq() < 1e-6) this.strikeDir.copy(flat);
      else this.strikeDir.normalize();
      this.normal.copy(this.strikeDir).negate();

      const o = this.combat.strikeOptions('melee', spec.source);
      o.force = spec.force;
      o.severMult = 0;
      o.headshotMult = 1;
      o.quiet = true;

      const hitBone = this.boneIndex(e, spec.boneName, spec.fallbackBone);
      const res = this.combat.strike(e, this.contact, this.normal, this.strikeDir, hitBone, spec.region, damage, o);
      this.hitCount++;
      if (res.killed) this.killCount++;

      // Movement payoff on first enemy contact: bounce-off, air-kick refresh, or push-off disengage!
      if (!this.bounced) {
        this.onFirstEnemyContact(move, flat);
      }

      if (e.machine) {
        c.fx.sparks(this.contact, this.normal, 12, 0xfff2cc);
        c.audio.play('kick_hit', { position: this.contact, volume: 0.8, pitch: 0.96, pitchJitter: 0.04 });
        c.audio.play('machine_clang', { position: this.contact, volume: 0.85, pitch: 0.88, pitchJitter: 0.06 });
      } else if (res.blocked && res.armour === 'broken') {
        brokeShield = true;
        c.audio.play('kick_hit', { position: this.contact, volume: 1, pitch: 0.88, pitchJitter: 0.04 });
        c.hud.callout?.('SHIELD BROKEN');
      } else if (res.blocked) {
        c.audio.play('kick_hit', { position: this.contact, volume: 0.92, pitch: 0.94, pitchJitter: 0.04 });
      } else {
        const pitch = move === 'diveKick' ? 0.86 : move === 'tornadoL' || move === 'tornadoR' ? 1.1 : 1.0;
        c.audio.play('kick_hit', { position: this.contact, volume: move === 'diveKick' || move === 'tornadoL' || move === 'tornadoR' ? 1.15 : 1, pitch, pitchJitter: 0.04 });
        c.fx.bloodHit(this.contact, this.strikeDir, res.killed ? 1.35 : 0.65);
      }
    }

    if (!this.grenadePunted) {
      const batted = this.combat.batGrenade?.(eye, p.forward, KICK.grenadeReach);
      if (batted) {
        this.grenadePunted = true;
        c.audio.play('kick_hit', { position: batted, pitch: 1.18, volume: 0.95 });
        c.fx.sparks(batted, p.forward, 14);
        c.camera.kick(0.036, 0.015, 0.024);
        c.camera.fovPunch?.(4.5, 0.14);
        this.combat.feel.stop(0.045, true);
        c.hud.hitMarker('armor');
        c.hud.callout?.('GRENADE PUNTED');
      }
    }

    if (this.hitCount === prevHits) return;
    const kills = this.killCount - prevKills;
    if (prevHits === 0) {
      c.camera.kick(0.056, rand(-0.02, 0.02), 0.036);
      c.camera.fovPunch?.(move === 'diveKick' || move === 'tornadoL' || move === 'tornadoR' ? 6.8 : 5.2, 0.16);
      this.combat.feel.shake(spec.shake);
      if (!brokeShield && spec.callout) c.hud.callout?.(spec.callout);
    }
    this.combat.feel.stop(kills > 0 ? spec.killStop : brokeShield ? 0.07 : spec.hitStop, true);
    c.hud.hitMarker(kills > 0 ? 'kill' : brokeShield ? 'armorBroken' : 'body');
  }

  /** Applies movement rebound / air-kick reset on first enemy hit for each athletic kick move. */
  private onFirstEnemyContact(move: KickMove, flat: THREE.Vector3): void {
    this.bounced = true;
    const p = this.ctx.player;

    if (move === 'diveKick') {
      // Bounce cleanly UP and slightly BACK off their chest, and refresh your air kick for aerial chains!
      this.airKickUsed = false;
      this.setAirVelocity(
        -this.strikeDir.x * DIVE_KICK.bounceBack,
        DIVE_KICK.bounceUp,
        -this.strikeDir.z * DIVE_KICK.bounceBack,
      );
      return;
    }

    if (move === 'tornadoL' || move === 'tornadoR') {
      // Sustain dramatic midair hang on contact and refresh air kick!
      this.airKickUsed = false;
      this.setAirVelocity(p.velocity.x * 0.85, Math.max(p.velocity.y, TORNADO.bounceUp), p.velocity.z * 0.85);
      return;
    }

    if (move === 'wallKickL' || move === 'wallKickR') {
      this.airKickUsed = false;
      this.setAirVelocity(
        -this.strikeDir.x * WALL_KICK.bounceBack,
        Math.max(p.velocity.y, WALL_KICK.bounceUp),
        -this.strikeDir.z * WALL_KICK.bounceBack,
      );
      return;
    }

    if (move === 'backKick') {
      // Extra crisp push-off disengage off the enemy's chest.
      p.velocity.x = -flat.x * BACK_KICK.hitPushBack;
      p.velocity.z = -flat.z * BACK_KICK.hitPushBack;
    }
  }

  /** Boot meeting a wall, door, or explosive barrel when nothing live stood in front. */
  private kickWall(spec: StrikeSpec): void {
    const c = this.ctx;
    const wall = c.physics.raycast(c.player.eye, c.player.forward, spec.reach - 0.3, CG.World);
    if (!wall) return;
    c.world.objects?.damageExplosive(wall.collider, spec.damage * this.modifiers.damage, spec.source, wall.point);
    c.fx.impact(wall.point, wall.normal, wall.surface);
    c.audio.play('kick_impact', { position: wall.point, volume: 0.68, pitch: 0.85, pitchJitter: 0.06 });
    c.camera.kick(0.026, 0, 0.012);
  }
}
