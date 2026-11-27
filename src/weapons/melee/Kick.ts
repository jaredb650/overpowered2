/**
 * First-person Sparta kick and crawling-enemy head stomp (`F` / `melee` action).
 *
 * Pressing `F` never draws or swings a knife or sword — blades only come out when explicitly equipped.
 *  - Against standing/rushing enemies (or swarms): a wide-arc Sparta boot thrust that launches humanoids
 *    straight back into a flying physics ragdoll (`source: 'kick'`), clears flanking enemies outward to
 *    create breathing room, shoves machines, knocks back Riot shielders, and punts live grenades.
 *  - Against a crawling prone wounded enemy (`isCrawlingProne`): lifts the boot high and slams straight
 *    down onto their skull (`source: 'stomp'`, `region: 'head'`), bursting their head cleanly.
 */
import * as THREE from 'three';
import { HumanoidBone } from '../../characters/rig';
import { CG, type Ctx } from '../../core/contracts';
import type { EnemyInstance, KickMove, WeaponModifiers } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { Combat } from '../Combat';

export const KICK = {
  /** Total kick animation duration (seconds). */
  duration: 0.42,
  /** Seconds after press when the boot first connects. */
  impactAt: 0.06,
  /** Seconds after press when the active strike window closes. */
  liveEnd: 0.19,
  /** Brief recovery gap after the kick finishes before another can begin. */
  cooldown: 0.1,
  /** Forward clearing reach from the player's eye (meters, plus target body radius). */
  reach: 2.55,
  /** Horizontal distance within which flanking enemies rubbing against the player are still cleared. */
  pointBlank: 1.25,
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
  hitStop: 0.048,
  /** Hit-stop duration on a lethal Sparta kick. */
  killStop: 0.075,
  /** Camera trauma on impact. */
  shake: 0.24,
  /** Live grenade punt reach (meters). */
  grenadeReach: 3.4,
} as const;

export const STOMP = {
  /** Total stomp animation duration (seconds). */
  duration: 0.48,
  /** Seconds into the animation when the heel slams down onto the skull. */
  impactAt: 0.13,
  /** Recovery gap after a stomp finishes. */
  cooldown: 0.12,
  /** Horizontal reach from the player to start a head stomp on a crawling prone enemy (meters). */
  reach: 2.35,
  /** Forgiving horizontal reach at the moment of heel impact so slight player drift still connects. */
  impactReach: 3.25,
  /** Maximum height difference between the crawling enemy's head and the player's feet (meters). */
  verticalReach: 1.4,
  /** Minimum horizontal dot product with view forward (ignored when standing almost directly over them). */
  minDot: 0.18,
  /** Horizontal distance within which a crawler directly underfoot is stomped regardless of look yaw. */
  underfoot: 0.95,
  /** Guaranteed lethal finisher damage on crawling non-boss humanoids. */
  damage: 1000,
  /** Downward crush force passed through DamageInfo. */
  force: 120,
  /** Hit-stop on skull burst. */
  hitStop: 0.065,
  /** Camera trauma on skull burst. */
  shake: 0.34,
} as const;

const UP = new THREE.Vector3(0, 1, 0);
const MAX_LIST = 48;

interface EnemyExtras {
  downed?: boolean;
  maim?: { legs?: number };
  def?: { radius?: number };
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

  /** Starts either a head stomp (if a crawling prone wounded enemy is in reach) or a Sparta kick. */
  start(): KickMove | null {
    if (!this.canStart) return null;
    const c = this.ctx;
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
      c.viewmodel.kick?.('stomp', STOMP.duration);
      c.audio.play('kick_swing', { pitch: 0.85, volume: 0.78, pitchJitter: 0.05 });
      c.camera.kick(-0.022, 0, -0.008);
      return 'stomp';
    }

    this.mode = 'kick';
    this.stompTarget = null;
    this.duration = KICK.duration;
    c.viewmodel.kick?.('kick', KICK.duration);
    c.audio.play('kick_swing', { pitchJitter: 0.06 });
    c.camera.kick(-0.014, 0.008, -0.014);
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
   * Finds the best crawling prone wounded enemy in front/underfoot to head-stomp.
   * Yields to a Sparta kick if a standing enemy is closer, right in the player's face, and the player isn't looking down.
   */
  private findStompTarget(): EnemyInstance | null {
    const c = this.ctx;
    const p = c.player;
    const flat = this.computeFlatForward();
    const n = Math.min(c.enemies.query(p.position, STOMP.reach + 2, this.list) || 0, MAX_LIST);

    let best: EnemyInstance | null = null;
    let bestScore = Infinity;
    let bestHoriz = Infinity;
    let closestStanding = Infinity;

    for (let i = 0; i < n; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;

      if (!isCrawlingProne(e)) {
        const dx = e.position.x - p.position.x;
        const dz = e.position.z - p.position.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz < 1.4 && horiz > 1e-4) {
          const dot = (dx * flat.x + dz * flat.z) / horiz;
          if (dot > 0.7 && Math.abs(e.center.y - p.eye.y) <= KICK.verticalReach) {
            if (horiz < closestStanding) closestStanding = horiz;
          }
        }
        continue;
      }

      const head = this.combat.headOf(e, this.contact);
      const dx = head.x - p.position.x;
      const dz = head.z - p.position.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > STOMP.reach) continue;
      if (Math.abs(head.y - p.position.y) > STOMP.verticalReach) continue;

      const dot = horiz > 1e-4 ? (dx * flat.x + dz * flat.z) / horiz : 1;
      if (horiz > STOMP.underfoot && dot < STOMP.minDot) continue;
      if (this.blocked(p.eye, head, 0.25)) continue;

      const score = horiz + (1 - Math.max(0, dot)) * 0.7;
      if (score < bestScore) {
        bestScore = score;
        bestHoriz = horiz;
        best = e;
      }
    }

    if (best && closestStanding < bestHoriz && p.forward.y > -0.25) return null;
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
      c.camera.kick(0.028, 0, 0.01);
      return;
    }

    const head = this.combat.headOf(target, this.contact);
    const horiz = Math.hypot(head.x - p.position.x, head.z - p.position.z);
    if (horiz > STOMP.impactReach) {
      c.audio.play('impact_concrete', { position: p.position, volume: 0.85, pitch: 0.72 });
      c.camera.kick(0.028, 0, 0.01);
      return;
    }

    const flat = this.computeFlatForward();
    this.strikeDir.set(flat.x * 0.42, -0.91, flat.z * 0.42).normalize();
    const o = this.combat.strikeOptions('melee', 'stomp');
    o.force = STOMP.force;
    o.severMult = 0;
    o.headshotMult = 1;
    o.pierces = true;
    o.quiet = true;

    const headBone = this.boneIndex(target, 'head', HumanoidBone.head);
    const dmg = STOMP.damage * Math.max(1, this.modifiers.damage);
    const res = this.combat.strike(target, head, UP, this.strikeDir, headBone, 'head', dmg, o);

    c.audio.play('stomp_hit', { position: head, pitchJitter: 0.05 });
    c.fx.bloodHit(head, UP, 2.2);
    c.fx.bloodJet(head, UP, 1.3);
    c.fx.impact(head, UP, 'concrete');
    c.camera.kick(0.055, rand(-0.014, 0.014), 0.024);
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
        c.fx.sparks(this.contact, this.normal, 10, 0xfff2cc);
        c.audio.play('machine_clang', { position: this.contact, volume: 0.85, pitch: 0.88, pitchJitter: 0.06 });
      } else if (res.blocked) {
        // Riot shielders already emit their shield clang & sparks in DamageModel.shieldHit and still ragdoll back.
        c.audio.play('kick_impact', { position: this.contact, volume: 0.9, pitch: 0.92, pitchJitter: 0.05 });
      } else {
        c.audio.play('kick_hit', { position: this.contact, pitchJitter: 0.05 });
        c.fx.bloodHit(this.contact, this.strikeDir, res.killed ? 1.1 : 0.45);
      }
    }

    if (!this.grenadePunted) {
      const batted = this.combat.batGrenade?.(eye, p.forward, KICK.grenadeReach);
      if (batted) {
        this.grenadePunted = true;
        c.audio.play('kick_impact', { position: batted, pitch: 1.18, volume: 0.95 });
        c.fx.sparks(batted, p.forward, 14);
        c.camera.kick(0.024, 0.01, 0.016);
        this.combat.feel.stop(0.04, true);
        c.hud.hitMarker('armor');
        c.hud.callout?.('GRENADE PUNTED');
      }
    }

    if (this.hitCount === prevHits) return;
    const kills = this.killCount - prevKills;
    if (prevHits === 0) {
      c.camera.kick(0.032, rand(-0.012, 0.012), 0.02);
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
    c.audio.play('kick_impact', { position: wall.point, volume: 0.72, pitch: 0.85, pitchJitter: 0.06 });
    c.camera.kick(0.018, 0, 0.008);
  }
}
