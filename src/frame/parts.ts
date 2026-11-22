/**
 * The Distraint Frame's armour, health and locational parts (stage 5 of docs/proposals/mission-2-plan.md).
 *
 *   Hull          4000 HP. Small arms bounce off with sparks and a metallic ping (0 HP). Heavy ordnance, rockets,
 *                 anti-air missiles, tank shells, sappers and Old Mother deal full damage.
 *   Left/Right    900 HP each. A broken leg halves pace (62% with one down, 42% with both) and kicks a limp into
 *   legs          the stride.
 *   Rocket pod    500 HP on the right shoulder. Knocking it out takes the 6-tube salvo offline until a fresh Frame.
 *   Rear vents    2.5x damage from behind (past 110 degrees off the view): the reactor slats on the back.
 *   Canopy glass  Sniper rounds chip through for light damage and spiderweb the glass (3 crack stages).
 *
 * Pure state + math with no scene or audio, so unit tests can drive every hit directly.
 */
import * as THREE from 'three';
import type { PlayerDamage } from '../core/contracts';
import { clamp } from '../core/math';
import { FRAME } from './data';

export type FramePart = 'hull' | 'leftLeg' | 'rightLeg' | 'pod' | 'reactor' | 'canopy';

export const FRAME_PARTS = {
  hull: FRAME.hull.maxHealth,
  leg: 900,
  pod: 500,
  maxCracks: 3,
  /** Rear reactor weak-point multiplier (hits coming from behind the torso). */
  rearMult: FRAME.hull.rearMult,
  /** Dot product of incoming vector (from -> frame) with torso forward above which the hit struck the back. */
  rearDot: 0.4,
  /** Small-arms rounds below this damage bounce off the plate for 0 HP (unless sniper/armour-piercing). */
  smallArmsCap: 34,
  /** Chip damage a sniper round does through the canopy glass while cracking it. */
  sniperChip: 18,
  /** Walk speed multipliers: intact, one leg crippled, both legs crippled. */
  speedOneLeg: 0.62,
  speedNoLegs: 0.42,
} as const;

export interface FrameHitResult {
  /** Damage actually subtracted from the Frame's hull. */
  dealt: number;
  /** True if small arms bounced cleanly off the armour plate. */
  blocked: boolean;
  /** Which region absorbed the hit. */
  part: FramePart;
  /** Non-null on the exact hit that crippled a part. */
  broke: 'leftLeg' | 'rightLeg' | 'pod' | null;
  /** True on a hit that added a new canopy crack stage. */
  cracked: boolean;
  /** True on the hit that reduced hull HP to 0. */
  killed: boolean;
}

/** Snapshot read by the cockpit HUD each frame. */
export interface FrameHullHud {
  hp: number;
  max: number;
  leftLeg: number;
  rightLeg: number;
  pod: number;
  cracks: number;
  rearFlash: number;
  /** 0..1 while the cockpit boot sequence runs, 1 once online. */
  boot: number;
  /** True during Old Mother's hull breach grab before eject. */
  breach: boolean;
  /** True while a sapper charge is ticking on a leg. */
  sapper: boolean;
}

const SNIPER_SOURCES = /sniper|sabot|rail/i;
const HEAVY_TYPES = new Set<PlayerDamage['type']>(['explosive', 'crush', 'shock', 'true']);

export class FrameParts {
  maxHp: number = FRAME_PARTS.hull;
  maxLeg: number = FRAME_PARTS.leg;
  canopyScale = 1;
  hp: number = FRAME_PARTS.hull;
  leftLeg: number = FRAME_PARTS.leg;
  rightLeg: number = FRAME_PARTS.leg;
  pod: number = FRAME_PARTS.pod;
  cracks = 0;
  rearFlash = 0;

  /** Configures hull HP, leg armour, and canopy strength from the active loadout (`frameStats`). */
  configure(opts?: { hullScale?: number; legArmor?: number; canopyScale?: number }): void {
    const prevMaxHp = this.maxHp;
    const prevMaxLeg = this.maxLeg;
    this.maxHp = Math.max(1, Math.round(FRAME_PARTS.hull * (opts?.hullScale ?? 1)));
    this.maxLeg = Math.max(1, Math.round(FRAME_PARTS.leg * (opts?.legArmor ?? 1)));
    this.canopyScale = Math.max(0, opts?.canopyScale ?? 1);
    this.hp = this.hp >= prevMaxHp ? this.maxHp : Math.min(this.hp, this.maxHp);
    this.leftLeg = this.leftLeg >= prevMaxLeg ? this.maxLeg : Math.min(this.leftLeg, this.maxLeg);
    this.rightLeg = this.rightLeg >= prevMaxLeg ? this.maxLeg : Math.min(this.rightLeg, this.maxLeg);
    if (this.canopyScale <= 0) this.cracks = 0;
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get podOnline(): boolean {
    return this.pod > 0;
  }

  get leftLegBroken(): boolean {
    return this.leftLeg <= 0;
  }

  get rightLegBroken(): boolean {
    return this.rightLeg <= 0;
  }

  get speedScale(): number {
    const broken = (this.leftLeg <= 0 ? 1 : 0) + (this.rightLeg <= 0 ? 1 : 0);
    return broken === 0 ? 1 : broken === 1 ? FRAME_PARTS.speedOneLeg : FRAME_PARTS.speedNoLegs;
  }

  /** -1 left leg limp, +1 right leg limp, 0 balanced. */
  get limpSide(): -1 | 0 | 1 {
    if (this.leftLeg <= 0 && this.rightLeg > 0) return -1;
    if (this.rightLeg <= 0 && this.leftLeg > 0) return 1;
    return 0;
  }

  reset(): void {
    this.hp = this.maxHp;
    this.leftLeg = this.maxLeg;
    this.rightLeg = this.maxLeg;
    this.pod = FRAME_PARTS.pod;
    this.cracks = 0;
    this.rearFlash = 0;
  }

  tick(dt: number): void {
    if (this.rearFlash > 0) this.rearFlash = Math.max(0, this.rearFlash - dt * 1.8);
  }

  /**
   * Resolves a hit against the Frame given its `feet` position and torso `viewYaw` (camera convention: 0 looks down -Z).
   */
  hit(damage: PlayerDamage, feet: THREE.Vector3, viewYaw: number): FrameHitResult {
    if (this.hp <= 0) {
      return { dealt: 0, blocked: false, part: 'hull', broke: null, cracked: false, killed: false };
    }
    const src = damage.source ?? '';
    const sniper = SNIPER_SOURCES.test(src);
    const heavy = HEAVY_TYPES.has(damage.type) || damage.amount >= FRAME_PARTS.smallArmsCap || src.includes('sapper') || src.includes('crawler') || src.includes('flak') || src.includes('aa_');

    // Small arms bounce cleanly off the plate with zero hull loss.
    if (!heavy && !sniper) {
      return { dealt: 0, blocked: true, part: 'hull', broke: null, cracked: false, killed: false };
    }

    // Compute incoming direction in torso local space: forward is (-sin(yaw), 0, -cos(yaw)), right is (cos(yaw), 0, -sin(yaw)).
    let localRight = 0;
    let localAhead = 1; // default: front hit when `from` is absent
    let localY = 3.6;
    if (damage.from) {
      const dx = damage.from.x - feet.x;
      const dz = damage.from.z - feet.z;
      const horiz = Math.hypot(dx, dz) || 1;
      const fx = -Math.sin(viewYaw);
      const fz = -Math.cos(viewYaw);
      const rx = Math.cos(viewYaw);
      const rz = -Math.sin(viewYaw);
      localAhead = (dx * fx + dz * fz) / horiz;
      localRight = (dx * rx + dz * rz) / horiz;
      localY = damage.from.y - feet.y;
    }

    // Sniper round: cracks the front canopy glass (when a canopy is fitted) and chips the hull.
    if (sniper && !HEAVY_TYPES.has(damage.type)) {
      let cracked = false;
      if (this.canopyScale > 0 && localAhead > -0.1 && this.cracks < FRAME_PARTS.maxCracks) {
        this.cracks++;
        cracked = true;
      }
      const dealt = Math.min(this.hp, Math.max(FRAME_PARTS.sniperChip, Math.round(damage.amount * FRAME.hull.sniperMult)));
      this.hp = Math.max(0, this.hp - dealt);
      return { dealt, blocked: false, part: cracked ? 'canopy' : 'hull', broke: null, cracked, killed: this.hp <= 0 };
    }

    // Determine struck region.
    let part: FramePart = 'hull';
    let mult: number = damage.type === 'bullet' ? FRAME.hull.bulletMult : FRAME.hull.heavyMult;
    let broke: FrameHitResult['broke'] = null;
    let cracked = false;

    const isSapper = src.includes('sapper');
    if (isSapper) {
      // Sapper charges are planted directly on a leg.
      part = localRight < 0 ? 'leftLeg' : 'rightLeg';
    } else if (localAhead < -FRAME_PARTS.rearDot) {
      // Shot in the back: reactor slats take bonus damage.
      part = 'reactor';
      mult *= FRAME_PARTS.rearMult;
      this.rearFlash = 1;
    } else if (localRight > 0.35 && localY >= 4.2 && this.pod > 0) {
      // High hit on the right side strikes the shoulder rocket pod.
      part = 'pod';
    } else if (localY < 2.6 || damage.type === 'crush') {
      // Low blast / shockwave / sweep hits the legs.
      part = localRight < 0 ? 'leftLeg' : 'rightLeg';
    } else if (
      this.canopyScale > 0
      && damage.type === 'explosive'
      && localAhead > 0.45
      && damage.amount >= 180 * this.canopyScale
      && this.cracks < FRAME_PARTS.maxCracks
    ) {
      // Massive frontal explosive also spiders the canopy glass (easier on thinner canopies like Twin-Mount).
      this.cracks++;
      cracked = true;
    }

    const raw = Math.round(damage.amount * mult);
    const dealt = Math.min(this.hp, raw);
    this.hp = Math.max(0, this.hp - dealt);

    // Apply locational pool wear.
    if (part === 'leftLeg' && this.leftLeg > 0) {
      this.leftLeg = Math.max(0, this.leftLeg - raw);
      if (this.leftLeg <= 0) broke = 'leftLeg';
    } else if (part === 'rightLeg' && this.rightLeg > 0) {
      this.rightLeg = Math.max(0, this.rightLeg - raw);
      if (this.rightLeg <= 0) broke = 'rightLeg';
    } else if (part === 'pod' && this.pod > 0) {
      this.pod = Math.max(0, this.pod - raw);
      if (this.pod <= 0) broke = 'pod';
    }

    return { dealt, blocked: false, part, broke, cracked, killed: this.hp <= 0 };
  }

  /** Normalized 0..1 integrity for HUD bars. */
  snapshot(boot: number, breach: boolean, sapper: boolean): FrameHullHud {
    return {
      hp: Math.ceil(this.hp),
      max: this.maxHp,
      leftLeg: clamp(this.leftLeg / this.maxLeg),
      rightLeg: clamp(this.rightLeg / this.maxLeg),
      pod: clamp(this.pod / FRAME_PARTS.pod),
      cracks: this.canopyScale > 0 ? this.cracks : 0,
      rearFlash: this.rearFlash,
      boot,
      breach,
      sapper,
    };
  }
}
