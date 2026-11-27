/**
 * First-person Sparta kick and grounded-enemy head stomp (`F` / `melee` action).
 *
 * Pressing `F` never draws or swings a knife or sword — blades only come out when explicitly equipped.
 *  - Against standing/rushing enemies (or swarms): a swift, violent wide-arc Sparta boot thrust that launches
 *    humanoids straight back into a flying physics ragdoll (`source: 'kick'`), clears flanking enemies outward
 *    to create breathing room, shoves machines, knocks back Riot shielders, and punts live grenades.
 *  - Against ANY grounded opponent (`isGroundedOpponent` — knocked-down ragdoll, crawling prone wounded,
 *    legless, mid-rise getting up, or collapsed low): rips the boot high and slams violently straight down onto
 *    their skull (`source: 'stomp'`, `region: 'head'`), bursting their head cleanly.
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
  /** Total stomp animation duration (seconds) — swift, brutal heel slam. */
  duration: 0.34,
  /** Seconds into the animation when the heel slams down onto the skull (synced to stomp_impact.mp3 transient). */
  impactAt: 0.09,
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
  hitStop: 0.075,
  /** Camera trauma on skull burst. */
  shake: 0.48,
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
  private hitCount = 0;
  private killCount = 0;
  private grenadePunted = false;
  private stompTarget: EnemyInstance | null = null;

  private readonly struck: EnemyInstance[] = [];
  private readonly list: EnemyInstance[] = [];
  private readonly flatFwd = new THREE.Vector3();
  private readonly contact = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly strikeDir = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly rayDir = new THREE.Vector3();

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

  /** Advances the post-kick cooldown every frame even while idle. */
  tick(dt: number): void {
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
  }

  cancel(): void {
    if (this.mode !== null) {
      this.mode = null;
      this.stompTarget = null;
      this.struck.length = 0;
    }
  }

  reset(): void {
    this.cancel();
    this.timer = 0;
    this.duration = 0;
    this.cooldownLeft = 0;
    this.landed = false;
    this.hitCount = 0;
    this.killCount = 0;
    this.grenadePunted = false;
  }

  /** Starts either a head stomp (if any grounded opponent is in reach) or a swift Sparta kick. */
  start(): KickMove | null {
    if (!this.canStart) return null;
    const c = this.ctx;
    const p = c.player;
    const stomp = this.findStompTarget();
    this.timer = 0;
    this.landed = false;
    this.hitCount = 0;
    this.killCount = 0;
    this.grenadePunted = false;
    this.struck.length = 0;

    if (stomp) {
      this.mode = 'stomp';
      this.stompTarget = stomp;
      this.duration = STOMP.duration;
      const head = this.combat.headOf(stomp, this.contact);
      c.viewmodel.kick?.('stomp', STOMP.duration);
      // Owner head-stomp recording starts immediately on trigger: its ~95 ms lead-in slams into the skull burst right at STOMP.impactAt.
      c.audio.play('stomp_hit', { position: head, pitchJitter: 0.03 });
      c.camera.kick(-0.042, 0, -0.016);
      c.camera.fovPunch?.(-2.5, 0.09);

      // Crisp magnetic step-in when initiating from 0.85–3.2 m away so the heel lands squarely on the skull.
      if (p.grounded) {
        const dx = head.x - p.position.x;
        const dz = head.z - p.position.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz > 0.85) {
          const lunge = Math.min(9.5, (horiz - 0.65) * 6.5);
          p.velocity.x = (dx / horiz) * lunge;
          p.velocity.z = (dz / horiz) * lunge;
        }
      }
      return 'stomp';
    }

    this.mode = 'kick';
    this.stompTarget = null;
    this.duration = KICK.duration;
    c.viewmodel.kick?.('kick', KICK.duration);
    c.audio.play('kick_swing', { pitchJitter: 0.05 });
    c.camera.kick(-0.028, 0.016, -0.024);
    c.camera.fovPunch?.(3.2, 0.12);
    return 'kick';
  }

  update(dt: number): void {
    if (this.mode === null) return;
    this.timer += dt;

    if (this.mode === 'stomp') {
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

    if (this.timer >= KICK.impactAt) {
      const first = !this.landed;
      this.landed = true;
      if (this.timer <= KICK.liveEnd || first) this.scanKick();
      if (first && this.hitCount === 0 && !this.grenadePunted) this.kickWall();
    }
    if (this.timer >= this.duration) {
      this.mode = null;
      this.struck.length = 0;
      this.cooldownLeft = KICK.cooldown;
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

  /**
   * Finds the best grounded opponent in front/underfoot to head-stomp.
   * Generous by design: measures distance to the closer of the opponent's head or body so standing over
   * their torso/legs still triggers effortlessly, and only yields to a Sparta kick if a standing enemy is
   * literally point-blank straight ahead and closer while the player isn't looking down.
   */
  private findStompTarget(): EnemyInstance | null {
    const c = this.ctx;
    const p = c.player;
    const gore = c.gore as unknown as GoreGroundQuery | undefined;
    const flat = this.computeFlatForward();
    const n = Math.min(c.enemies.query(p.position, STOMP.reach + 2.5, this.list) || 0, MAX_LIST);

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
      if (effHoriz > STOMP.reach) continue;

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
      c.camera.kick(0.042, 0, 0.016);
      return;
    }

    const head = this.combat.headOf(target, this.contact);
    const headHoriz = Math.hypot(head.x - p.position.x, head.z - p.position.z);
    const bodyHoriz = Math.hypot(target.position.x - p.position.x, target.position.z - p.position.z);
    if (Math.min(headHoriz, bodyHoriz) > STOMP.impactReach) {
      c.audio.play('impact_concrete', { position: p.position, volume: 0.85, pitch: 0.72 });
      c.camera.kick(0.042, 0, 0.016);
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

    c.fx.bloodHit(head, UP, 2.6);
    c.fx.bloodJet(head, UP, 1.55);
    c.fx.impact(head, UP, 'concrete');
    c.camera.kick(0.095, rand(-0.024, 0.024), 0.042);
    c.camera.fovPunch?.(6.5, 0.16);
    this.combat.feel.shake(STOMP.shake);
    this.combat.feel.stop(STOMP.hitStop, true);
    c.hud.hitMarker(res.killed ? 'kill' : 'head');
  }

  // -------------------------------------------------------------------------------------------
  // Sparta kick resolution
  // -------------------------------------------------------------------------------------------

  private scanKick(): void {
    const c = this.ctx;
    const p = c.player;
    const eye = p.eye;
    const flat = this.computeFlatForward();
    const prevHits = this.hitCount;
    const prevKills = this.killCount;

    const n = Math.min(c.enemies.query(eye, KICK.reach + 2.5, this.list) || 0, MAX_LIST);
    const damage = KICK.damage * this.modifiers.damage;

    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive || this.struck.includes(e)) continue;

      const extras = e as unknown as EnemyExtras;
      const radius = this.radiusOf(e);
      if (extras.downed || isCrawlingProne(e)) {
        this.contact.set(e.position.x, e.position.y + 0.45, e.position.z);
      } else {
        this.contact.copy(e.center);
      }

      const dx = this.contact.x - eye.x;
      const dz = this.contact.z - eye.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz - radius > KICK.reach) continue;
      if (Math.abs(this.contact.y - eye.y) > KICK.verticalReach) continue;

      const dot = horiz > 1e-4 ? (dx * flat.x + dz * flat.z) / horiz : 1;
      const minDot = horiz <= KICK.pointBlank + radius ? KICK.pointBlankDot : KICK.minDot;
      if (dot < minDot) continue;
      if (this.blocked(eye, this.contact, Math.max(0.25, radius))) continue;

      this.struck.push(e);

      // Blend 70% straight down sightline + 30% outward radial so a tight crowd fans apart cleanly.
      if (horiz > 1e-4) {
        this.toTarget.set(dx / horiz, 0, dz / horiz);
        this.strikeDir.set(flat.x * 0.7 + this.toTarget.x * 0.3, 0, flat.z * 0.7 + this.toTarget.z * 0.3);
      } else {
        this.strikeDir.copy(flat);
      }
      if (this.strikeDir.lengthSq() < 1e-6) this.strikeDir.copy(flat);
      else this.strikeDir.normalize();
      this.normal.copy(this.strikeDir).negate();

      const o = this.combat.strikeOptions('melee', 'kick');
      o.force = KICK.force;
      o.severMult = 0;
      o.headshotMult = 1;
      o.quiet = true;

      const chestBone = this.boneIndex(e, 'chest', HumanoidBone.chest);
      const res = this.combat.strike(e, this.contact, this.normal, this.strikeDir, chestBone, 'chest', damage, o);
      this.hitCount++;
      if (res.killed) this.killCount++;

      if (e.machine) {
        c.fx.sparks(this.contact, this.normal, 12, 0xfff2cc);
        c.audio.play('kick_hit', { position: this.contact, volume: 0.8, pitch: 0.96, pitchJitter: 0.04 });
        c.audio.play('machine_clang', { position: this.contact, volume: 0.85, pitch: 0.88, pitchJitter: 0.06 });
      } else if (res.blocked) {
        // Riot shielders already emit their shield clang & sparks in DamageModel.shieldHit and still ragdoll back.
        c.audio.play('kick_hit', { position: this.contact, volume: 0.92, pitch: 0.94, pitchJitter: 0.04 });
      } else {
        c.audio.play('kick_hit', { position: this.contact, pitchJitter: 0.04 });
        c.fx.bloodHit(this.contact, this.strikeDir, res.killed ? 1.25 : 0.55);
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
      c.camera.kick(0.052, rand(-0.02, 0.02), 0.034);
      c.camera.fovPunch?.(5.2, 0.15);
      this.combat.feel.shake(KICK.shake);
    }
    this.combat.feel.stop(kills > 0 ? KICK.killStop : KICK.hitStop, true);
    c.hud.hitMarker(kills > 0 ? 'kill' : 'body');
  }

  /** Boot meeting a wall, door, or explosive barrel when nothing live stood in front. */
  private kickWall(): void {
    const c = this.ctx;
    const wall = c.physics.raycast(c.player.eye, c.player.forward, KICK.reach - 0.3, CG.World);
    if (!wall) return;
    c.world.objects?.damageExplosive(wall.collider, KICK.damage * this.modifiers.damage, 'kick', wall.point);
    c.fx.impact(wall.point, wall.normal, wall.surface);
    c.audio.play('kick_impact', { position: wall.point, volume: 0.68, pitch: 0.85, pitchJitter: 0.06 });
    c.camera.kick(0.026, 0, 0.012);
  }
}
