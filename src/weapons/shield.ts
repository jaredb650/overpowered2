/**
 * Riot shield gameplay state machine (`RiotShield`), tuning constants (`RIOT_SHIELD`), and co-op teammate
 * shield blocking geometry (`checkTeammateShieldHit`).
 *
 * Owner's binding design (Q6):
 * - Raised with right click (hold RMB), NOT always up.
 * - Lowered by default at the hip: does not block incoming fire.
 * - Raising smoothly transitions `raise` from 0 → 1; active interception begins past `activeThreshold`.
 * - Blocking frontal non-AP, non-explosive hits fills arm fatigue (`0 → 1`). Reaching `maxFatigue` triggers
 *   an involuntary drop and cooldown (`exhaustCooldown`) during which the shield cannot be raised.
 * - Fatigue drains steadily when lowered (immediately) and slowly when held raised after `drainDelay` s without hits.
 * - Armour-piercing rounds, explosives/blasts, melee strikes, and flank/rear hits outside the frontal arc bypass it.
 *
 * Zero-allocation on all per-frame and per-shot hot paths.
 */
import * as THREE from 'three';
import { clamp } from '../core/math';

export const RIOT_SHIELD = {
  /** Raise speed (units/s): 0 → 1 in ~0.18 s. */
  raiseRate: 5.5,
  /** Lower speed (units/s): 1 → 0 in ~0.20 s. */
  lowerRate: 5.0,
  /** Forced drop multiplier when arm fatigue forces the shield down. */
  exhaustDropMult: 1.6,
  /** Minimum raise blend [0..1] required for the shield to actively intercept frontal fire. */
  activeThreshold: 0.55,
  /**
   * Cosine of the frontal blocking half-angle (~68° each side → 136° total frontal arc).
   * Matches Melee guard convention: incomingDir.dot(forward) <= -frontCos.
   */
  frontCos: 0.375,
  /** Fatigue level that triggers an involuntary shield drop and cooldown. */
  maxFatigue: 1,
  /** Fatigue gained per point of blocked incoming damage. */
  fatiguePerDamage: 0.007,
  /** Minimum fatigue gained per blocked hit so rapid low-damage fire builds steady fatigue. */
  minFatiguePerHit: 0.07,
  /** Steady fatigue recovery per second when lowered (no delay). */
  drainRate: 0.36,
  /** Steady fatigue recovery per second when held raised after `drainDelay` without taking a hit. */
  raisedDrainRate: 0.16,
  /** Seconds after the last blocked hit before fatigue starts draining while raised. */
  drainDelay: 0.35,
  /** Cooldown duration (seconds) after fatigue hits `maxFatigue` before the shield can be raised again. */
  exhaustCooldown: 2.6,
  /** Movement speed multiplier while the shield is actively raised. */
  moveSpeedMult: 0.72,
  /** Co-op third-person raised shield blocking slab geometry (metres, relative to teammate feet `matePos`). */
  coop: {
    /** Forward offset ahead of teammate centre. */
    forwardOffset: 0.52,
    /** Vertical centre of the raised shield above teammate feet. */
    centerY: 1.18,
    /** Half-width of the raised ballistic shield slab. */
    halfWidth: 0.36,
    /** Half-height of the raised ballistic shield slab. */
    halfHeight: 0.54,
  },
} as const;

export interface RiotShieldState {
  /** 0 = lowered at hip, 1 = raised in front of face. */
  raise: number;
  /** 0 = fresh, 1 = fully fatigued / exhausted. */
  fatigue: number;
  /** True during the involuntary drop cooldown after fatigue hits 1.0. */
  exhausted: boolean;
  /** Remaining involuntary drop cooldown in seconds (0 when not exhausted). */
  cooldown: number;
  /** True when fitted, not exhausted, and raised past `RIOT_SHIELD.activeThreshold`. */
  active: boolean;
  /** Whether a riot shield mod is currently fitted on the active pistol. */
  fitted: boolean;
}

export interface RiotShieldBlockOpts {
  /** Armour-piercing round (`armorPiercing` / `pierces`): bypasses the shield. */
  armorPiercing?: boolean;
  /** Rockets, grenades, or area blasts: bypasses the shield. */
  explosive?: boolean;
  /** Close-quarters melee strike: bypasses the shield. */
  melee?: boolean;
}

export interface RiotShieldBlockResult {
  /** True when the shield stopped the hit. */
  blocked: boolean;
  /** True on the exact hit that pushed fatigue to 1.0 and forced the shield down. */
  exhaustedNow: boolean;
  /** Updated arm fatigue [0..1] after resolving this hit. */
  fatigue: number;
}

export interface TeammateShieldHit {
  hit: boolean;
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

const _mateHit: TeammateShieldHit = {
  hit: false,
  distance: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
};

/**
 * Per-player riot shield state machine.
 *
 * Typical integration in `Weapons.ts`:
 * - Each tick: `const s = this.shield.update(dt, fitted, wantRaise, busy);`
 * - Drive viewmodel: `viewmodel.setAim(s.raise); viewmodel.setCharge(s.exhausted ? 1 : s.fatigue);`
 * - On enemy bullet ray in `Combat.ts`: `const res = this.shield.tryBlock(incomingDir, forward, damage, opts);`
 *   If `res.blocked`: trigger `viewmodel.swing('block', 0.16)`, play metallic impact + sparks, and cancel player damage.
 */
export class RiotShield {
  private _fitted = false;
  private _raise = 0;
  private _fatigue = 0;
  private _exhausted = false;
  private _cooldown = 0;
  private sinceHit = 99;

  private readonly stateOut: RiotShieldState = {
    raise: 0,
    fatigue: 0,
    exhausted: false,
    cooldown: 0,
    active: false,
    fitted: false,
  };

  private readonly blockOut: RiotShieldBlockResult = {
    blocked: false,
    exhaustedNow: false,
    fatigue: 0,
  };

  get raise(): number {
    return this._raise;
  }

  get fatigue(): number {
    return this._fatigue;
  }

  get exhausted(): boolean {
    return this._exhausted;
  }

  get cooldown(): number {
    return this._cooldown;
  }

  get fitted(): boolean {
    return this._fitted;
  }

  /** True when the shield is actively blocking frontal fire. */
  get active(): boolean {
    return this._fitted && !this._exhausted && this._raise >= RIOT_SHIELD.activeThreshold;
  }

  /** Movement speed multiplier for the player while carrying/raising the shield. */
  get moveSpeedMult(): number {
    return this.active ? RIOT_SHIELD.moveSpeedMult : 1;
  }

  /** Resets all shield state (e.g. respawn, run reset, weapon unequip). */
  reset(): void {
    this._fitted = false;
    this._raise = 0;
    this._fatigue = 0;
    this._exhausted = false;
    this._cooldown = 0;
    this.sinceHit = 99;
    this.syncState();
  }

  /** Returns a read-only view of the current state without allocating. */
  getState(): Readonly<RiotShieldState> {
    return this.syncState();
  }

  /**
   * Advances raise/lower interpolation, fatigue recovery, and exhaustion cooldown.
   * @param dt Frame delta in seconds.
   * @param fitted True if the active weapon currently has a riot shield mod fitted.
   * @param wantRaise True while the player is holding RMB to raise the shield.
   * @param busy True while reloading, drawing, holstering, dashing, or otherwise unable to hold the shield up.
   */
  update(dt: number, fitted: boolean, wantRaise: boolean, busy: boolean): Readonly<RiotShieldState> {
    this._fitted = fitted;
    if (!fitted) {
      this._raise = 0;
      this._fatigue = 0;
      this._exhausted = false;
      this._cooldown = 0;
      this.sinceHit = 99;
      return this.syncState();
    }

    const step = dt > 0 ? dt : 0;
    if (step > 0) {
      if (this._exhausted) {
        this._cooldown = Math.max(0, this._cooldown - step);
        this._raise = Math.max(0, this._raise - step * RIOT_SHIELD.lowerRate * RIOT_SHIELD.exhaustDropMult);
        this._fatigue = this._cooldown > 0
          ? clamp(this._cooldown / RIOT_SHIELD.exhaustCooldown, 0, RIOT_SHIELD.maxFatigue)
          : 0;
        if (this._cooldown <= 0) {
          this._exhausted = false;
          this._cooldown = 0;
          this._fatigue = 0;
        }
      } else {
        const raising = wantRaise && !busy;
        if (raising) {
          this._raise = Math.min(1, this._raise + step * RIOT_SHIELD.raiseRate);
        } else {
          this._raise = Math.max(0, this._raise - step * RIOT_SHIELD.lowerRate);
        }

        this.sinceHit += step;
        if (!raising) {
          this._fatigue = Math.max(0, this._fatigue - step * RIOT_SHIELD.drainRate);
        } else if (this.sinceHit >= RIOT_SHIELD.drainDelay) {
          this._fatigue = Math.max(0, this._fatigue - step * RIOT_SHIELD.raisedDrainRate);
        }
      }
    }

    return this.syncState();
  }

  /**
   * Tests whether an incoming attack is intercepted by the raised riot shield.
   *
   * Convention matches `Combat.guard(incoming)` and `Melee.guard(incoming)`:
   * `incomingDir` points FROM the attacker TO the shielded player, and `forward` is the player's look direction.
   * A direct head-on shot has `incomingDir · forward ≈ -1`.
   */
  tryBlock(
    incomingDir: THREE.Vector3,
    forward: THREE.Vector3,
    damage: number,
    opts?: RiotShieldBlockOpts,
  ): Readonly<RiotShieldBlockResult> {
    const out = this.blockOut;
    out.blocked = false;
    out.exhaustedNow = false;
    out.fatigue = this._fatigue;

    if (!this.active) return out;
    if (opts?.armorPiercing || opts?.explosive || opts?.melee) return out;

    const inLenSq = incomingDir.lengthSq();
    const fwdLenSq = forward.lengthSq();
    if (inLenSq < 1e-10 || fwdLenSq < 1e-10) return out;

    const cos = incomingDir.dot(forward) / Math.sqrt(inLenSq * fwdLenSq);
    if (cos > -RIOT_SHIELD.frontCos) return out;

    // Blocked! Accumulate arm fatigue proportional to damage with a per-hit floor.
    this.sinceHit = 0;
    const dmg = damage > 0 ? damage : 0;
    const gain = Math.max(RIOT_SHIELD.minFatiguePerHit, dmg * RIOT_SHIELD.fatiguePerDamage);
    this._fatigue = Math.min(RIOT_SHIELD.maxFatigue, this._fatigue + gain);

    out.blocked = true;
    out.fatigue = this._fatigue;

    if (this._fatigue >= RIOT_SHIELD.maxFatigue) {
      this._exhausted = true;
      this._cooldown = RIOT_SHIELD.exhaustCooldown;
      // Drop immediately below the active blocking threshold so follow-up pellets on the same frame don't stack.
      this._raise = Math.min(this._raise, RIOT_SHIELD.activeThreshold - 0.15);
      out.exhaustedNow = true;
    }

    this.syncState();
    return out;
  }

  private syncState(): Readonly<RiotShieldState> {
    const s = this.stateOut;
    s.raise = this._raise;
    s.fatigue = this._fatigue;
    s.exhausted = this._exhausted;
    s.cooldown = this._cooldown;
    s.active = this.active;
    s.fitted = this._fitted;
    return s;
  }
}

/**
 * Pure zero-allocation ray-vs-shield-slab intersection for co-op teammate shield blocking.
 *
 * Enemy rays aimed through a co-op teammate's raised ballistic shield from its frontal arc are stopped
 * by the shield plane, protecting both the shield bearer and teammates standing behind them.
 * Flank/rear rays (or shots when `shieldRaised` is false) return `null`.
 */
export function checkTeammateShieldHit(
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3,
  rayDist: number,
  matePos: THREE.Vector3,
  mateForward: THREE.Vector3,
  shieldRaised: boolean,
  out: TeammateShieldHit = _mateHit,
): TeammateShieldHit | null {
  if (!shieldRaised || rayDist <= 0) return null;

  const dirLenSq = rayDir.lengthSq();
  if (dirLenSq < 1e-10) return null;
  const invDirLen = 1 / Math.sqrt(dirLenSq);
  const dx = rayDir.x * invDirLen;
  const dy = rayDir.y * invDirLen;
  const dz = rayDir.z * invDirLen;

  // Horizontal forward normal for the upright ballistic shield slab.
  let nx = mateForward.x;
  let nz = mateForward.z;
  const nLenSq = nx * nx + nz * nz;
  if (nLenSq < 1e-10) {
    nx = 0;
    nz = -1;
  } else {
    const invN = 1 / Math.sqrt(nLenSq);
    nx *= invN;
    nz *= invN;
  }

  // Only rays striking from within the shield's frontal blocking arc are stopped.
  const denom = dx * nx + dz * nz;
  if (denom > -RIOT_SHIELD.frontCos) return null;

  // Shield plane centre in world space.
  const cfg = RIOT_SHIELD.coop;
  const cx = matePos.x + nx * cfg.forwardOffset;
  const cy = matePos.y + cfg.centerY;
  const cz = matePos.z + nz * cfg.forwardOffset;

  const t = ((cx - rayOrigin.x) * nx + (cz - rayOrigin.z) * nz) / denom;
  if (t < 0 || t > rayDist) return null;

  const px = rayOrigin.x + dx * t;
  const py = rayOrigin.y + dy * t;
  const pz = rayOrigin.z + dz * t;

  // Local slab coordinates: right = forward × up = (-nz, 0, nx), up = (0, 1, 0).
  const offX = px - cx;
  const offY = py - cy;
  const offZ = pz - cz;
  const localRight = offX * -nz + offZ * nx;
  if (Math.abs(localRight) > cfg.halfWidth || Math.abs(offY) > cfg.halfHeight) return null;

  out.hit = true;
  out.distance = t;
  out.point.set(px, py, pz);
  out.normal.set(nx, 0, nz);
  return out;
}
