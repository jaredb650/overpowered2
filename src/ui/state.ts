/**
 * One defensive read of the game per frame.
 *
 * Widgets never touch ctx directly. Game.ts swaps any unbuilt system for a no-op proxy, and a proxy's fields are
 * callable objects rather than numbers, so every read here is typed-checked once and falls back to a neutral value.
 * That keeps the HUD alive at every stage of the build, and it makes this the only file that knows field names.
 */
import { familyOfSlot } from '../weapons/families';
import { rulesCustom } from '../contracts/crucible';
import { MOVE } from '../player/tuning';
import { WEAPONS } from '../weapons/data';
import type { Ctx } from '../core/contracts';
import type {
  ActiveEffect, CallInId, EnemyInstance, WavePhase, WeaponId,
} from '../core/gameplay';

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && v === v ? v : fallback);
const bool = (v: unknown): boolean => v === true;
const str = <T extends string>(v: unknown, fallback: T): T => (typeof v === 'string' ? (v as T) : fallback);

const NO_EFFECTS: readonly ActiveEffect[] = [];
const NO_ENEMIES: readonly EnemyInstance[] = [];

export class HudState {
  health = 100;
  maxHealth = 100;
  armor = 0;
  maxArmor = MOVE.maxArmor;
  /** Horizontal speed in m/s. */
  speed = 0;
  grounded = true;
  sliding = false;
  wallRunning = false;
  dashing = false;
  alive = true;
  dashCharges = MOVE.dashCharges;
  /** 0..1 progress of the charge currently refilling. */
  dashRefill = 0;

  weapon: WeaponId = 'smg';
  mag = 0;
  magSize = 0;
  reserve = 0;
  maxReserve = 0;
  bottomless = false;
  reloading = false;
  reloadProgress = 0;
  scoped = false;
  /** 0..1 aim down sights. */
  aim = 0;
  grenades = 0;
  /** 0..1 charge of the Lance or spin of the Buzzsaw. */
  charge = 0;
  /** Cone half-angle in radians. Weapons publish a 0..1 openness, but the shotgun's reticle draws the true cone. */
  spread = 0;
  /** Which swing of the sword chain comes next, 0 when idle. */
  swordStep = 0;

  score = 0;
  kills = 0;
  highScore = 0;
  /** The run is on custom Crucible rules, so it is unranked. */
  customRules = false;
  combo = 0;
  comboTimer = 0;
  multiplier = 1;
  effects: readonly ActiveEffect[] = NO_EFFECTS;
  targeting: CallInId | null = null;
  /** True while a strike aimed here would catch the player. */
  dangerClose = false;

  wave = 0;
  phase: WavePhase = 'intermission';
  nextWaveIn = 0;
  remaining = 0;
  enemies: readonly EnemyInstance[] = NO_ENEMIES;

  stims = 0;
  stimsMax = 5;
  /** 0..1 through an injection, or -1. */
  stimInjecting = -1;

  /** Seconds until the next ping, out of `sonarLimit`. */
  sonarWait = 0;
  sonarLimit = 1;
  /** Seconds the enemies stay lit. */
  sonarLive = 0;

  read(ctx: Ctx): void {
    const p = ctx.player as unknown as Record<string, unknown>;
    this.health = num(p.health, 100);
    this.maxHealth = Math.max(1, num(p.maxHealth, 100));
    this.armor = num(p.armor, 0);
    this.maxArmor = MOVE.maxArmor;
    this.grounded = bool(p.grounded);
    this.sliding = bool(p.sliding);
    this.wallRunning = bool(p.wallRunning);
    this.dashing = bool(p.dashing);
    this.alive = p.alive !== false;
    // The player stores charges as one float that climbs while recharging.
    const charges = num(p.dashCharges, MOVE.dashCharges);
    this.dashCharges = Math.floor(charges);
    this.dashRefill = charges - this.dashCharges;
    const v = ctx.player.velocity;
    const vx = num(v?.x, 0);
    const vz = num(v?.z, 0);
    this.speed = Math.sqrt(vx * vx + vz * vz);

    const w = ctx.weapons as unknown as Record<string, unknown>;
    this.weapon = str(w.current, 'smg');
    const ammo = typeof w.ammo === 'function' ? ctx.weapons.ammo() : undefined;
    this.mag = num(ammo?.mag, 0);
    this.magSize = num(ammo?.magSize, 0);
    this.reserve = num(ammo?.reserve, 0);
    this.maxReserve = num(ammo?.maxReserve, 0);
    this.bottomless = bool(ctx.weapons.modifiers?.bottomlessMag);
    this.reloading = bool(w.reloading);
    this.reloadProgress = num(w.reloadProgress, 0);
    this.scoped = bool(w.scoped);
    this.aim = num(w.aim, 0);
    this.grenades = num(w.grenades, 0);
    this.charge = num(w.charge, 0);
    this.spread = WEAPONS[this.weapon].spread;
    this.swordStep = num(w.swordStep, 0);

    const g = ctx.progression as unknown as Record<string, unknown>;
    this.score = num(g.score, 0);
    this.kills = num(g.kills, 0);
    this.highScore = num(g.highScore, 0);
    this.customRules = rulesCustom();
    this.combo = num(g.combo, 0);
    this.comboTimer = num(g.comboTimer, 0);
    this.multiplier = num(g.multiplier, 1);
    this.effects = Array.isArray(g.effects) ? (g.effects as ActiveEffect[]) : NO_EFFECTS;
    this.targeting = str<CallInId | ''>(g.targeting, '') || null;
    this.dangerClose = bool(g.dangerClose);
    const kit = (g.stims ?? {}) as Record<string, unknown>;
    this.stims = num(kit.count, 0);
    this.stimsMax = num(kit.max, 5);
    this.stimInjecting = num(kit.injecting, -1);

    const waves = ctx.waves as unknown as Record<string, unknown>;
    this.wave = num(waves.wave, 0);
    this.phase = str(waves.phase, 'intermission');
    this.nextWaveIn = num(waves.nextWaveIn, 0);

    const e = ctx.enemies as unknown as Record<string, unknown>;
    this.remaining = num(e.remaining, 0);
    this.enemies = Array.isArray(e.alive) ? (e.alive as EnemyInstance[]) : NO_ENEMIES;

    const sonar = ctx.contracts?.sonar as unknown as Record<string, unknown> | undefined;
    this.sonarWait = num(sonar?.wait, 0);
    this.sonarLimit = Math.max(num(sonar?.limit, 1), 0.001);
    this.sonarLive = num(sonar?.live, 0);
  }

  hasCallIn(ctx: Ctx, id: CallInId): boolean {
    return ctx.progression.callIns?.has?.(id) === true;
  }

  owns(ctx: Ctx, id: WeaponId): boolean {
    return ctx.weapons.owned?.has?.(id) === true;
  }

  /** The member of a number key's family that the key draws now. Without a weapon system to ask, its first. */
  member(ctx: Ctx, slot: number): WeaponId | undefined {
    const w = ctx.weapons;
    const pick = typeof w.slotMember === 'function' ? w.slotMember(slot) : undefined;
    return typeof pick === 'string' ? pick : familyOfSlot(slot)[0];
  }

  /** Magazine count of any weapon, for the empty pip on the strip. Unknown reads as loaded. */
  loaded(ctx: Ctx, id: WeaponId): boolean {
    const a = typeof ctx.weapons.ammo === 'function' ? ctx.weapons.ammo(id) : undefined;
    return !a || typeof a.mag !== 'number' || a.magSize === 0 || a.mag + a.reserve > 0;
  }
}
