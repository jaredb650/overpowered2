/**
 * Gameplay contracts: weapons, combat, enemies, waves, progression, HUD.
 * Extends Ctx and GameEvents from contracts.ts by module augmentation.
 *
 * As in contracts.ts, a system owner may add to its own interface. Changing an existing signature
 * means updating every caller.
 */
import type * as THREE from 'three';
import type { GoreRegion } from '../characters/rig';
import type { ContractDef } from '../contracts/data';
import type { CharacterInstance, DamageInfo, DamageType, ExplosionKind, GameSystem, MuzzleKind, TracerKind } from './contracts';

// ---------------------------------------------------------------------------------------------
// Weapons and combat
// ---------------------------------------------------------------------------------------------

export type WeaponId =
  | 'smg' | 'shotgun' | 'rocket' | 'autocannon' | 'sword'
  | 'judge' | 'lance' | 'buzzsaw' | 'kiln' | 'stakegun';

export type Team = 'player' | 'enemy';

/** Written by perks and powerups. WeaponSystem reads it every shot. Defaults are all neutral. */
export interface WeaponModifiers {
  damage: number;
  fireRate: number;
  bottomlessMag: boolean;
  /** Multiplies shotgun pellet count. */
  pellets: number;
  /** Bullets explode on impact. */
  explosiveRounds: boolean;
  /** Multiplies rocket blast radius. */
  blastRadius: number;
  /** Rockets kill everything in the blast. */
  instakillBlast: boolean;
  akimbo: boolean;
  /** Bounces left on each bullet. */
  ricochet: number;
  /** Bullets arc to nearby enemies. */
  shockRounds: boolean;
  /** Every hit severs a limb. */
  alwaysSever: boolean;
  /** Tracer override while a perk is active. */
  tracer: TracerKind | null;
  /** Extra sample layered on each shot, e.g. 'hellfire_shot'. */
  shotLayers: string[];
}

export interface AmmoState {
  mag: number;
  magSize: number;
  reserve: number;
  maxReserve: number;
}

export interface WeaponSystem extends GameSystem {
  /** 0..1 Lance charge or Buzzsaw spin, for the HUD. */
  readonly charge: number;
  /** 0..1 how open the crosshair should sit. */
  readonly spread: number;
  /** Which of the three chain swings comes next. */
  readonly swordStep: number;
  readonly current: WeaponId;
  readonly owned: ReadonlySet<WeaponId>;
  readonly reloading: boolean;
  /** 0..1 progress for the current reload. */
  readonly reloadProgress: number;
  readonly scoped: boolean;
  readonly grenades: number;
  modifiers: WeaponModifiers;
  ammo(id?: WeaponId): AmmoState;
  give(id: WeaponId): void;
  /** Fraction of max reserve for all weapons. */
  addAmmo(fraction: number): void;
  addGrenades(count: number): void;
  /** Fills every magazine. */
  refillMagazines(): void;
  switchTo(id: WeaponId): void;
  /** Hides the gun and blocks firing, for call-in targeting. */
  setHolstered(holstered: boolean): void;
}

export type SwordMove = 'light1' | 'light2' | 'light3' | 'windup' | 'area' | 'finisher' | 'block';

/** First-person arms and weapons. WeaponSystem drives it; it never changes game state. */
export interface ViewmodelRig extends GameSystem {
  /** Raises this weapon with a draw animation lasting `seconds`. */
  equip(id: WeaponId, seconds: number): void;
  /** Lowers the arms out of view. */
  holster(seconds: number): void;
  /** Fires one shot of recoil. `strength` 1 is the weapon's normal kick. */
  fire(strength?: number, left?: boolean): void;
  /** Plays the reload animation over `seconds`. */
  reload(seconds: number): void;
  swing(move: SwordMove, seconds: number): void;
  /** 0..1 charge or spin level, for the Lance and Buzzsaw. */
  setCharge(amount: number): void;
  setAkimbo(on: boolean): void;
  /** Hides the model while the scope overlay is up. */
  setScoped(on: boolean): void;
  /** Writes the muzzle in WORLD space, corrected for the separate viewmodel FOV. Tracers start here. */
  muzzle(out: THREE.Vector3, left?: boolean): THREE.Vector3;
  /** Writes the ejection port in world space. */
  ejectPort(out: THREE.Vector3): THREE.Vector3;
}

export interface ShotSpec {
  damage: number;
  source: string;
  team: Team;
  maxDistance?: number;
  tracer?: TracerKind;
  /** Passes through this many targets. */
  pierce?: number;
  force?: number;
  severMult?: number;
  /** Bullet explodes on impact with this radius. */
  blastRadius?: number;
  ricochet?: number;
  shock?: boolean;
  headshotMult?: number;
  /** Where the tracer starts. Defaults to the ray origin. Player guns pass the viewmodel muzzle. */
  tracerFrom?: THREE.Vector3;
  /** Damage type. Defaults to 'bullet'. */
  type?: DamageType;
  /** Forces a gib on a lethal hit. */
  gib?: boolean;
  /** Hit-stop seconds on a kill. */
  killStop?: number;
  /** Multiplies impact effects and decal size on the world. */
  impactScale?: number;
  /** After a headshot the round jumps to this many more heads, as the Judge does. */
  headHops?: number;
  /** Punches through walls up to this thick, in meters. */
  penetrate?: number;
  /** This many kills are split in two along the line of the shot. Head kills keep their own death. */
  cleave?: number;
}

export interface ShotResult {
  hitEnemy: boolean;
  headshot: boolean;
  killed: boolean;
  /** Enemies this shot killed, for weapons that pass through a line of them. */
  kills: number;
  /** Where the ray ended. */
  end: THREE.Vector3;
}

export interface ExplosionSpec {
  radius: number;
  damage: number;
  kind: ExplosionKind;
  source: string;
  team: Team;
  /** Everything in the radius dies. */
  instakill?: boolean;
  /** Fraction of damage the player takes if caught. Defaults by source. */
  selfDamage?: number;
  /** Launches the player when inside. Enables rocket jumping. */
  playerPush?: number;
  /** Surface normal at the blast, for the scorch mark. Without it the floor below is used. */
  normal?: THREE.Vector3;
  /** Multiplies particle counts and sizes. */
  scale?: number;
  /** Overrides the shake from the explosion table, in first-game intensity units. */
  shake?: number;
  /** A map explosive went off. The world drew it, sounded it and chains its own neighbours, so combat only resolves it. */
  worldObject?: boolean;
}

/** Dotted smoke, Hellfire smoke, the heavy strike smoke, 30mm rings, or a plasma spark line. */
export type ProjectileTrail = 'none' | 'smoke' | 'big' | 'hellfire' | 'rings' | 'sparks';

export interface ProjectileSpec {
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  kind: 'rocket' | 'shell' | 'grenade' | 'bullet' | 'plasma' | 'stake' | 'flame';
  team: Team;
  damage: number;
  source: string;
  /** Set for projectiles that explode. */
  explosion?: Omit<ExplosionSpec, 'team' | 'source'>;
  gravity?: number;
  lifetime?: number;
  tracer?: TracerKind;
  /** Homing strength toward the player or target. 0 disables it. */
  homing?: number;
  /** Fuse in seconds for grenades. */
  fuse?: number;
  /** Draw from here at first and slide onto the real path, so shots leave the muzzle but fly true. */
  visualFrom?: THREE.Vector3;
  /** Trail look. Defaults by kind. */
  trail?: ProjectileTrail;
  /** Forces a gib on a lethal direct hit. */
  gib?: boolean;
  severMult?: number;
  force?: number;
  headshotMult?: number;
  /** Hit-stop seconds on a direct kill. */
  killStop?: number;
  /** Flames only: the caller draws the fire with fx.flame itself. */
  silent?: boolean;
}

export interface CombatSystem extends GameSystem {
  /** Instant hit. Resolves enemies, corpses, world, FX, sound and damage. */
  fireRay(origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec): ShotResult;
  spawnProjectile(spec: ProjectileSpec): void;
  /** Data-driven explosion: damage, impulses, FX, sound and shake, scaled by distance to the player. */
  explode(position: THREE.Vector3, spec: ExplosionSpec): void;
  /** Muzzle helper for enemy guns. */
  enemyMuzzle(position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind): void;
}

// ---------------------------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------------------------

export type EnemyId =
  | 'husk' | 'trooper' | 'gunner' | 'brute' | 'stalker' | 'rocketeer' | 'sniper' | 'riot'
  | 'leaper' | 'bomber' | 'burner' | 'warden' | 'skitter' | 'drone' | 'juggernaut' | 'titan';

export interface EnemyInstance {
  readonly uid: number;
  readonly id: EnemyId;
  readonly char: CharacterInstance;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  yaw: number;
  health: number;
  maxHealth: number;
  /** Absorbs damage first, like armour plates. */
  armor: number;
  alive: boolean;
  /** Base kill score. */
  score: number;
  /** Chest position, for lock-on and arcs. */
  readonly center: THREE.Vector3;
  isBoss: boolean;
  /** Seconds left of being frozen by frost. */
  frozen: number;
  /** Seconds left of burning. */
  burning: number;
  /** Sparks where anything else would bleed. */
  readonly machine: boolean;
}

export interface EnemyRayHit {
  enemy: EnemyInstance;
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  bone: number;
  region: GoreRegion;
}

export interface DamageResult {
  dealt: number;
  killed: boolean;
  headshot: boolean;
  severed: GoreRegion[];
  /** Hit armour, a shield or an immune spot; suppresses blood. */
  blocked: boolean;
}

export interface EnemySystem extends GameSystem {
  readonly alive: readonly EnemyInstance[];
  /** Spawned enemies not yet killed in this wave, including those queued. */
  readonly remaining: number;
  spawn(id: EnemyId, position: THREE.Vector3): EnemyInstance | null;
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): EnemyRayHit | null;
  /** All enemies along a ray, nearest first, up to `limit`. */
  raycastAll(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, limit: number): EnemyRayHit[];
  /** The one place damage reaches an enemy. */
  applyDamage(enemy: EnemyInstance, damage: DamageInfo): DamageResult;
  /** Writes enemies within `radius` into `out` and returns its length. */
  query(center: THREE.Vector3, radius: number, out: EnemyInstance[]): number;
  killAll(source: string): void;
}

export type WavePhase = 'intermission' | 'spawning' | 'clearing' | 'boss';

export interface WaveSystem extends GameSystem {
  readonly wave: number;
  readonly phase: WavePhase;
  /** Seconds until the next wave during intermission. */
  readonly nextWaveIn: number;
  start(): void;
}

// ---------------------------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------------------------

export type PerkId =
  | 'bloodthirst' | 'hellfire' | 'berserk' | 'adrenaline' | 'slowmo'
  | 'sentinels' | 'chainStorm' | 'butcher' | 'skyfall' | 'chainReaction' | 'overdrive' | 'geneva';

export type CallInId = 'airstrike' | 'warthog' | 'doorGunner' | 'attackChopper' | 'orbital' | 'ac130' | 'blackSun' | 'nuke';

export type PowerupId =
  | 'quad' | 'haste' | 'vampire' | 'ricochet' | 'shock' | 'ghost' | 'magnet' | 'regen' | 'frostNova' | 'timeWarp';

export type PickupKind = 'health' | 'ammo' | 'armor' | 'megaHealth' | 'heavyArmor' | 'weaponCache' | PowerupId;

export interface ActiveEffect {
  id: PerkId | PowerupId;
  label: string;
  color: string;
  remaining: number;
  duration: number;
  stacks: number;
}

export interface ProgressionSystem extends GameSystem {
  readonly score: number;
  readonly kills: number;
  readonly headshots: number;
  readonly highScore: number;
  /** Consecutive kills within the combo window. */
  readonly combo: number;
  /** 0..1 of the combo window left. */
  readonly comboTimer: number;
  /** Current score multiplier. */
  readonly multiplier: number;
  readonly effects: readonly ActiveEffect[];
  readonly callIns: ReadonlySet<CallInId>;
  /** Set while the player is choosing a strike position. */
  readonly targeting: CallInId | null;
  isActive(id: PerkId | PowerupId): boolean;
  /** Forces a perk on, for tests and debug. */
  grant(id: PerkId | PowerupId): void;
  grantCallIn(id: CallInId): void;
  /** Puts the combo here with a fresh window, for tests and debug. What it would have paid on the way up waits for the next kill. */
  setCombo(combo: number): void;
  /** Drops a pickup in the world. */
  spawnPickup(kind: PickupKind, position: THREE.Vector3): void;
  /** Seconds until a call-in can be earned again. */
  callInCooldown(id: CallInId): number;
  /** True while the aim would put the player inside the blast. */
  readonly dangerClose: boolean;
  /** Everything worth a dot on the minimap, including weapon caches. */
  readonly pickups: readonly { kind: PickupKind; position: THREE.Vector3; active: boolean }[];
}

// ---------------------------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------------------------

export interface SonarState {
  /** Seconds until the next ping. */
  readonly wait: number;
  /** The whole cooldown as it stands. It shortens when few enemies are left. */
  readonly limit: number;
  /** Seconds the enemies stay lit. */
  readonly live: number;
}

/** The page's contract. Code that runs before systems exist reads `ACTIVE` from contracts/select.ts instead. */
export interface ContractSystem extends GameSystem {
  readonly def: ContractDef;
  readonly sonar: SonarState;
}

// ---------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------

/** A full-screen panel that replaces the on-foot widgets. `update` runs after the camera, once a frame. */
export interface SeatPanel {
  readonly el: HTMLElement;
  update(): void;
}

export interface HudSystem extends GameSystem {
  /** Top-centre banner, e.g. 'WAVE 5'. */
  banner(text: string, subtext?: string, color?: string): void;
  /** Kill feed line. */
  feed(text: string, color?: string): void;
  /** Crosshair hit marker. */
  hitMarker(kind: 'body' | 'head' | 'kill' | 'armor'): void;
  /** Score text that floats up from a world position. */
  floatText(position: THREE.Vector3, text: string, color?: string): void;
  /** A world position marker, e.g. a weapon cache or powerup. Returns a remover. */
  marker(position: THREE.Vector3, label: string, color?: string): () => void;
  /** Loading screen progress. */
  loading(fraction: number, label: string): void;
  showScreen(screen: 'splash' | 'menu' | 'pause' | 'gameover' | 'guide' | 'settings' | 'none'): void;
  /** Puts up a seat's panel. Null brings the on-foot HUD back. */
  seat(panel: SeatPanel | null): void;
}

// ---------------------------------------------------------------------------------------------
// Events and context
// ---------------------------------------------------------------------------------------------

export interface KillEvent {
  enemy: EnemyInstance;
  damage: DamageInfo;
  headshot: boolean;
  gibbed: boolean;
  sliced: boolean;
  /** Regions the enemy had lost by the time it died. */
  severedCount: number;
  /** Player state at the moment of the kill, for style scoring. */
  playerAirborne: boolean;
  playerSliding: boolean;
  playerWallRunning: boolean;
  playerSpeed: number;
  distance: number;
  /** Same value for every kill from one explosion. */
  explosionId: number | null;
}

declare module './contracts' {
  interface DamageInfo {
    /** Same value for every hit from one explosion. KillEvent.explosionId reads it. */
    explosionId?: number;
    /** Damage multiplier on the head. Unset means the default of 2. */
    headshotMult?: number;
  }

  interface Ctx {
    weapons: WeaponSystem;
    viewmodel: ViewmodelRig;
    combat: CombatSystem;
    enemies: EnemySystem;
    waves: WaveSystem;
    progression: ProgressionSystem;
    contracts: ContractSystem;
    hud: HudSystem;
  }

  interface GameEvents {
    'run:start': Record<string, never>;
    'run:end': { score: number; wave: number; kills: number };

    'weapon:fired': { weapon: WeaponId; origin: THREE.Vector3; dir: THREE.Vector3 };
    'weapon:switched': { from: WeaponId; to: WeaponId };
    'weapon:reload': { weapon: WeaponId; phase: 'start' | 'end' };
    'weapon:empty': { weapon: WeaponId };
    'weapon:unlocked': { weapon: WeaponId };

    'enemy:spawned': { enemy: EnemyInstance };
    'enemy:hit': { enemy: EnemyInstance; damage: DamageInfo; result: DamageResult };
    'enemy:killed': KillEvent;
    'enemy:severed': { enemy: EnemyInstance; region: GoreRegion; damage: DamageInfo };

    'wave:start': { wave: number; total: number; boss: boolean };
    'wave:clear': { wave: number; bonus: number };

    'perk:start': { id: PerkId | PowerupId; seconds: number; label: string; color: string };
    'perk:end': { id: PerkId | PowerupId };
    'callin:ready': { id: CallInId };
    'callin:used': { id: CallInId; position: THREE.Vector3 };
    'combo:changed': { combo: number };
    'score:gain': { points: number; reason: string; position?: THREE.Vector3 };
    'pickup:collected': { kind: PickupKind; position: THREE.Vector3 };

    /** The left hand has started for the helmet. */
    'sonar:tap': Record<string, never>;
    /** The ring went out. `origin` is reused, so copy it to keep it. */
    'sonar:ping': { origin: THREE.Vector3 };
  }
}
