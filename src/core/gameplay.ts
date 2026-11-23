/**
 * Gameplay contracts: weapons, combat, enemies, waves, progression, HUD.
 * Extends Ctx and GameEvents from contracts.ts by module augmentation.
 *
 * As in contracts.ts, a system owner may add to its own interface. Changing an existing signature
 * means updating every caller.
 */
import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GoreRegion } from '../characters/rig';
import type { ContractDef } from '../contracts/data';
import type { Flight } from '../vehicles/flight';
import type { HelixSpec } from '../weapons/helix';
import type { AmmoLoad, CharacterInstance, DamageInfo, DamageType, ExplosionKind, GameSystem, MuzzleKind, SurfaceKind, TracerKind } from './contracts';

// ---------------------------------------------------------------------------------------------
// Weapons and combat
// ---------------------------------------------------------------------------------------------

export type WeaponId =
  | 'smg' | 'shotgun' | 'rocket' | 'autocannon' | 'sword'
  | 'judge' | 'lance' | 'buzzsaw' | 'kiln' | 'stakegun'
  // Family members: they share a slot key with a base weapon. See src/weapons/families.ts.
  | 'harrow' | 'rivet' | 'sabot' | 'quiver' | 'thresher'
  // Key 5 beside the sword: knife, crowbar, shovel, baton. Swung by the same code, src/weapons/melee.
  | 'knife' | 'crowbar' | 'shovel' | 'baton'
  // The heavy machine gun and stacked-barrel volley gun beside the rotary cannon on key 8.
  | 'piledriver' | 'metalstorm'
  // The double-barrel on key 2 and the heavy pistol on key 6 (docs/proposals/weapons-update.md section 8), and the machine
  // pistol with the smart aim beside it (section 14).
  | 'deuce' | 'ultramag' | 'autoraffica'
  // The carbine on key 1, between the SMG and the Harrow (docs/proposals/weapons-update.md section 11).
  | 'gimlet' | 'awl'
  // The light machine gun on key 1, after the Harrow: a belt-fed box of 100.
  | 'flail'
  // The Milkor MGL 6-shot 40mm revolving grenade launcher on key 3, beside the Rocket and Quiver.
  | 'mgl'
  // Throw-and-stick demolition satchel charges with remote RMB clacker on key 3.
  | 'satchel'
  // Shoulder-fired 105mm recoilless artillery howitzer on key 3.
  | 'howitzer'
  // Weapons wishlist (docs/proposals/weapons-wishlist.md): semi-auto combat shotgun (key 2), flechette bullpup (key 1),
  // microwave gun (key 7), and harpoon cannon (key 0).
  | 'billhook' | 'bodkin' | 'autoclave' | 'gaff';

/**
 * A weapon mod (src/weapons/mods.ts): the SMG's suppressor, the Harrow's red dot and ACOG, the Sabot's Raufoss rounds, the
 * Gimlet's ACOG, red dot, suppressor and under-barrel launcher, and AP and HP rounds for the SMG, the rifles and the pistols.
 */
export type ModId = 'awlAcog' | 'awlCan' | 'awlAp' | 'awlHp' | 'suppressor' | 'reddot' | 'raufoss' | 'harrowAcog' | 'gimletAcog' | 'gimletDot' | 'gimletCan' | 'gimletGl'
  // The heavy guns' mods: the Trommel's 12 mm rechamber and the Sabot's muzzle brake.
  | 'trommel12' | 'sabotBrake'
  // The Ultramag's suppressor, reflex sight, laser module, extended magazine and compensator.
  | 'ultramagCan' | 'ultramagDot' | 'ultramagLam' | 'ultramagMag' | 'ultramagComp'
  // The Deuce's quad barrels and speed loader, the pump's choke, the Judge's extended hammer and comfort grip.
  | 'deuceQuad' | 'deuceLoader' | 'shotgunChoke' | 'judgeHammer' | 'judgeGrip'
  | 'smgAp' | 'smgHp' | 'gimletAp' | 'gimletHp' | 'harrowAp' | 'harrowHp'
  | 'rivetAp' | 'rivetHp' | 'ultramagAp' | 'ultramagHp' | 'judgeAp' | 'judgeHp' | 'autorafficaAp' | 'autorafficaHp'
  | 'smgPlusP' | 'gimletPlusP' | 'harrowPlusP' | 'rivetPlusP' | 'ultramagPlusP' | 'judgePlusP' | 'autorafficaPlusP' | 'awlPlusP'
  | 'autorafficaMag'
  // The Awl's extended barrel, greased bolt, and .50 Cal conversion.
  | 'awlBarrel' | 'awlBolt' | 'awl50'
  // Extended magazines for the SMG, the Rivet and the Piledriver (a box), and the Gimlet's short barrel.
  | 'smgMag' | 'rivetMag' | 'piledriverBox' | 'gimletShort'
  // The SMG's mag tape and stock.
  | 'smgTape' | 'smgStock'
  // The autocannon's flak shells, and the Piledriver's red dot and ACOG.
  | 'autocannonFlak' | 'piledriverDot' | 'piledriverAcog'
  // The katana's energy blade (weapons/melee/data.ts ENERGY).
  | 'swordEnergy'
  // The weapon light, one a gun: every rifle, shotgun and pistol (weapons/mods.ts LIGHT_GUNS).
  | 'smgLight' | 'gimletLight' | 'harrowLight' | 'awlLight' | 'shotgunLight' | 'thresherLight' | 'deuceLight'
  | 'judgeLight' | 'rivetLight' | 'ultramagLight' | 'autorafficaLight' | 'billhookLight' | 'bodkinLight'
  // Flechettes for every shotgun and API rounds for the Harrow (weapons/mods.ts FLECHETTE_GUNS, API_GUNS).
  | 'shotgunFlechette' | 'thresherFlechette' | 'deuceFlechette' | 'billhookFlechette' | 'harrowApi' | 'flailApi'
  // Akimbo: a second gun of the same in the left hand (weapons/mods.ts AKIMBO_GUNS).
  | 'smgAkimbo' | 'rivetAkimbo' | 'ultramagAkimbo' | 'judgeAkimbo' | 'autorafficaAkimbo'
  // The Flail's red dot and ACOG, its 200-round box, and AP, HP and +P rounds.
  | 'flailDot' | 'flailAcog' | 'flailBox' | 'flailAp' | 'flailHp' | 'flailPlusP'
  // Metal Storm's 40mm FireStorm grenade matrix conversion.
  | 'metalstorm40mm'
  // Milkor MGL's Sticky Bomb 40mm conversion.
  | 'mglSticky'
  // Rifles wishlist: Gimlet long barrel, Harrow short barrel/brake/40-rd mag, Flail heavy barrel/stock.
  | 'gimletLong' | 'harrowShort' | 'harrowBrake' | 'harrowMag' | 'flailHeavy' | 'flailStock'
  // Flared magwells (weapons/mods.ts MAGWELL_GUNS): 15% faster reload.
  | 'harrowMagwell' | 'gimletMagwell' | 'ultramagMagwell' | 'rivetMagwell' | 'bodkinMagwell'
  // Shotguns wishlist: pump sawed-off & greased bolt, Thresher & Billhook dragon's breath, Deuce long barrel.
  | 'shotgunSawedOff' | 'shotgunBolt' | 'thresherDragon' | 'billhookDragon' | 'deuceLong'
  // Launchers & key 4 wishlist: Rocket tube & WP, MGL long barrel & trigger, Howitzer cluster, Autocannon barrel.
  | 'rocketTube' | 'rocketWp' | 'mglLong' | 'mglTrigger' | 'howitzerCluster' | 'autocannonBarrel'
  // Pistols wishlist: Judge extended barrel & compensator; Rivet comp, suppressor, reflex, laser; Riot shield (SHIELD_GUNS).
  | 'judgeLong' | 'judgeComp' | 'rivetComp' | 'rivetCan' | 'rivetDot' | 'rivetLam'
  | 'rivetShield' | 'ultramagShield' | 'judgeShield' | 'autorafficaShield'
  // Billhook mods: reflex, laser, extended tube, slugs (light, flechette, dragon above).
  | 'billhookDot' | 'billhookLam' | 'billhookTube' | 'billhookSlug'
  // Bodkin mods: 4x optic, extended mag, 5-round burst, tungsten darts (light, magwell above).
  | 'bodkinAcog' | 'bodkinMag' | 'bodkinBurst5' | 'bodkinTungsten';

export type Team = 'player' | 'enemy';

/** Which of a gun's shots a `weapon:fired` was, when it is not its row's one ordinary round. */
export type FireKind = 'gun' | 'rail' | 'beam' | 'ball' | 'giant' | 'hose' | 'swing';

/**
 * What a shot adds for the other players' screens in co-op, where weapons/watch.ts draws it from the shooter's body: which
 * hand and barrel fired, the rounds and the seed their spread was drawn from, and what left the gun when that is not the
 * row's ordinary round. Whoever fires fills it just before the shot's `weapon:fired`; it is cleared after.
 */
export interface FireNote {
  kind: FireKind;
  /** The left hand's gun (akimbo), and the barrel it left (a break-open gun's, a tube of the Quiver, the launcher's own). */
  left: boolean;
  barrel: number;
  /**
   * The hitscan rounds this pull fired, the half-angle of their cone in radians, and the seed their directions were drawn
   * from down the aim (`SeededRandom`, one `randomInCone` a round). 0 rounds: what left the gun flies (a projectile) or is not
   * a round. A cone of 0: every round went straight down the aim.
   */
  rays: number;
  cone: number;
  seed: number;
  /** The gun's second kind of round was loaded: Raufoss, an exploding bolt. */
  alt: boolean;
  /** The round went at `to` and not down the aim: a locked head (the smart aim, a fanned shot, Gun Kata). */
  aimed: boolean;
  readonly to: THREE.Vector3;
  /**
   * A melee swing (`kind` 'swing'): the sound it makes and at what pitch, whether it is a heavy one (the body's clip), and
   * whether the blade is the energy blade. Unset on a gun's note.
   */
  swing?: { sound: string; pitch: number; heavy: boolean; energy: boolean };
  /**
   * Co-op, on a watcher's screen only: the tracer a perk of the shooter's gives their rounds (Hellfire, Bloodthirst,
   * Berserk), as the shooter said it. Unset or null: the gun's own tracer.
   */
  tracer?: TracerKind | null;
}

/**
 * Something a melee swing drew in the air, for the other players' screens in co-op (weapons/melee/show.ts): a slash (`a`
 * centre, `b` normal, `c` start direction, `x` arc, `y` radius, `look` its SlashKind), a ring (`a` at, `b` facing, `x`
 * colour, `y` size), dash streaks (`a` at, `b` along), a cleave's slam (`a` at, `b` the blade's line, `x` impact), or a sound heard from the swinger
 * (`look` its id, `x` its pitch).
 */
export interface MeleeFx {
  kind: 'slash' | 'ring' | 'streaks' | 'slam' | 'sound';
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  readonly c: THREE.Vector3;
  x: number;
  y: number;
  look: string;
}

/**
 * A small cannon round going off where it lands: a flash, dust, a crack and a few fragments. It is not a blast: nothing is
 * thrown, nothing rolls on the blast table, and it costs a handful of particles. See src/weapons/burst.ts.
 */
export interface BurstSpec {
  /** Metres. A body this close to the burst, other than the one the round struck, takes fragments. */
  readonly radius: number;
  /** Fragment damage at the burst, falling to half at the edge. */
  readonly damage: number;
  /** Scales the flash, the dust and the sparks. Unset is 1, the round fired on foot. */
  readonly scale?: number;
  /** Its own sound id. Unset is `cannon_burst`. */
  readonly sound?: string;
}

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

export interface LoadoutOptions {
  mods?: readonly ModId[];
  exclusiveMods?: boolean;
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
  /** 0..1 aim down sights, eased. Optional so stand-in weapon systems need not carry it. */
  readonly aim?: number;
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
  /**
   * The off hand is busy for `seconds` (a stim injection): no fire, aim, reload, melee, grenade or switch, and any of
   * those under way stops. The gun stays out. Optional so stand-in weapon systems need not carry it.
   */
  occupy?(seconds: number): void;
  /** A mission's kit: these guns and no others, with the first drawn. */
  setLoadout(weapons: readonly WeaponId[], grenades?: number | LoadoutOptions, opts?: LoadoutOptions): void;
  /** Hands over a weapon mod, unfitted. Optional so stand-in weapon systems need not carry it. */
  grantMod?(id: ModId): void;
  /** Fits or removes a held weapon mod. Optional so stand-in weapon systems need not carry it. */
  fitMod?(id: ModId, on?: boolean): boolean;
  /** The member of a slot's family that its number key draws: the one last held there. */
  slotMember?(slot: number): WeaponId;
  /** What a painting launcher has marked so far, for the HUD. Unset on a weapon system that has none. */
  readonly paint?: PaintView;
  /** Weapon mods fitted now (src/weapons/mods.ts), for the viewmodels. Unset on a weapon system that has none. */
  readonly fitted?: ReadonlySet<ModId>;
  /** The Gimlet's under-barrel launcher is up (hold R): the shots and the reload are its. Unset on a weapon system that has none. */
  readonly launcherUp?: boolean;
  /** The Autoraffica's smart aim, for the HUD's circle and the gun turning to the head. Unset on a weapon system that has none. */
  readonly smartAim?: SmartAimView;
  /** Riot shield state (src/weapons/shield.ts), for the HUD arm-fatigue meter and co-op sync. */
  readonly shield?: Readonly<{
    raise: number;
    fatigue: number;
    exhausted: boolean;
    cooldown: number;
    active: boolean;
    fitted: boolean;
  }>;
  /** The left gun's smart aim with the Autoraffica akimbo (a lock a gun): the HUD's second crosshair. Unset on a system that has none. */
  readonly smartAimLeft?: SmartAimView;
  /** Two guns in hand now: the akimbo mod or Berserk's SMGs. Unset on a weapon system that has none. */
  readonly akimbo?: boolean;
  /** The Gun Kata brain chip: a burst into every man in reach, or why not. Unset on a weapon system that has none. */
  kata?(): KataResult;
  /** Who a Gun Kata would shoot now, in order, written into `out`: the brain chip's red highlight while it charges. */
  kataTargets?(out: EnemyInstance[]): EnemyInstance[];
}

/** What the Gun Kata brain chip got when it asked the guns: it went, or why it did not (and spent nothing). */
export type KataResult = 'go' | 'noAkimbo' | 'noTargets' | 'busy';

/** The Autoraffica smart aim's paint-then-snap phase. */
export type SmartAimPhase = 'idle' | 'painting' | 'firing';

/** The Autoraffica's smart aim (src/weapons/smartaim.ts), as the HUD and the viewmodel read it. */
export interface SmartAimView {
  /** Switched on (hold R) with the gun in hand. */
  readonly on: boolean;
  /** Radians off the crosshair a head may be and take the lock: the circle the HUD draws. */
  readonly cone: number;
  /** The middle of the locked or charging man's head, kept up to date, or null with no lock. */
  readonly lock: THREE.Vector3 | null;
  /** Paint-then-snap phase: idle at rest, painting while charging marks, firing while drilling locked heads. */
  readonly phase?: SmartAimPhase;
  /** 0..1 charge progress toward locking the head currently being painted. */
  readonly charge?: number;
  /** Live world-space position of the head currently charging up to lock, or null when not charging. */
  readonly chargingAt?: THREE.Vector3 | null;
  /** Number of painted heads currently held. */
  readonly markCount?: number;
}

/**
 * Anything a missile can be painted on and steered at: an enemy, a vehicle, an aircraft. An EnemyInstance is one as it
 * stands. `center` must be a live vector that follows the target.
 */
export interface MissileTarget {
  readonly center: THREE.Vector3;
  readonly alive: boolean;
  readonly isBoss?: boolean;
  /** Metres above `center` to aim at, for a target whose centre is its footprint. */
  readonly aimLift?: number;
  /** Its half size. A line of sight is clear when the first thing in the way is this close to the centre, its own hull. */
  readonly paintRadius?: number;
}

/** The marks of a launcher that paints its targets, as the HUD draws them. */
export interface PaintView {
  /** True while the trigger is held and marks are being laid. */
  readonly painting: boolean;
  /** In the order painted. A target painted twice is in here twice. */
  readonly marks: readonly MissileTarget[];
  /** How many marks the salvo can carry. */
  readonly max: number;
}

/**
 * `heavy` is the right click of a melee weapon with no guard. Each model reads the moves as its own swings. `windup` is the
 * katana's guard, held; `stab` its right click; `cleave`, `spin`, `wave` and `flurry` its combo moves.
 */
export type SwordMove = 'light1' | 'light2' | 'light3' | 'windup' | 'block' | 'heavy' | 'stab' | 'cleave' | 'spin' | 'wave' | 'flurry';

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
  /** Gun Kata: snaps one gun `yaw` radians toward its man (+ left), then lets it spring back. Optional for stand-in rigs. */
  kataSnap?(left: boolean, yaw: number): void;
  /** Hides the model while the scope overlay is up. */
  setScoped(on: boolean): void;
  /** 0..1 how far the gun is up at the eye, eased: aim down sights. Optional so stand-in rigs need not carry it. */
  setAim?(weight: number): void;
  /**
   * Writes the muzzle in WORLD space, corrected for the separate viewmodel FOV. Tracers start here. `barrel` picks a
   * barrel on a gun with more than one (sockets `muzzle`, `muzzle1`, ...); a gun with one answers its muzzle for any.
   */
  muzzle(out: THREE.Vector3, left?: boolean, barrel?: number): THREE.Vector3;
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
  /**
   * Penetration budget, in meters of concrete. Each wall passed costs its measured thickness times its surface's
   * factor, and each body costs `bodyCost`. See PENETRATION in src/weapons/data.ts. 0 or unset costs nothing.
   */
  penetrate?: number;
  /** Budget one body costs. Defaults to PENETRATION.body. 0 passes every body in line for free. */
  bodyCost?: number;
  /** Share of its damage the round keeps once its budget is spent. Defaults to PENETRATION.keep. 1 loses nothing. */
  penetrateKeep?: number;
  /**
   * Set, `penetrate` is not a total: the round passes up to this many walls, each no thicker than `penetrate` whatever it
   * is made of, and a vehicle is no exception. The Lance's rule from before budgets.
   */
  penetrateWalls?: number;
  /** Goes through armour plates as if they were not there. */
  armorPiercing?: boolean;
  /** The gun's ammo mod, carried onto every body it strikes (DamageInfo.load). */
  load?: AmmoLoad;
  /** The modded row's armour class, carried onto every body it strikes (DamageInfo.armour). */
  armour?: 'light' | 'medium' | 'heavy';
  /** An enemy ray's near-miss sound past the player. Defaults to `bullet_whizz`. */
  whizz?: string;
  /** Damage holds to `from` meters of flight, then falls in a line to `floor` of itself at `to`. */
  falloff?: { readonly from: number; readonly to: number; readonly floor: number };
  /** This many kills are split in two along the line of the shot. Head kills keep their own death. */
  cleave?: number;
  /**
   * The caller's own list. The ray adds each body it struck to it, nearest first, and passes over any body already in it:
   * for a weapon that does something at every body (the Lance's plasma bursts), and for a round resolved in more than one
   * ray, each starting where the last stopped (the Lance's beam, a few bodies a frame). Unset costs nothing.
   */
  struck?: StruckList;
  /**
   * The ray passes over corpses. For the later rays of a round resolved in more than one (the Lance's beam): the corpses
   * ahead of them are mostly its own kills of a frame before, and must not be struck again at full damage.
   */
  skipCorpses?: boolean;
  /**
   * The round bursts where it first strikes anything and where it stops: see BurstSpec. Not the same as `blastRadius`, which
   * is a real explosion, and which takes its place while both are set.
   */
  burst?: BurstSpec;
  /** Damage override on bosses and vehicles (e.g. Bodkin tungsten darts). */
  bossDamage?: number;
}

/**
 * The bodies a round has struck, in the order it met them, and the walls it has gone through. The caller makes it, as long
 * as it likes, clears it between rounds, and may hand the same one to several rays of one round: bodies past its length
 * are struck and not listed.
 */
export interface StruckList {
  count: number;
  /** Walls passed, by the penetration rule in force. */
  walls: number;
  readonly points: THREE.Vector3[];
  readonly enemies: (EnemyInstance | null)[];
  /** Given, whether armour (a plate, a helmet, a shield) took the round on each body, beside `enemies`. A Raufoss round reads it. */
  readonly armoured?: boolean[];
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
  /**
   * Co-op guest: a blast the host has already counted against the enemies and the world (a barrel the host set off). Here it is
   * only felt by this player: the damage, the push, the shake, and the bodies and debris it throws.
   */
  playerOnly?: boolean;
  /** Its kills are vaporized (DamageInfo.vaporize). */
  vaporize?: boolean;
  /**
   * Co-op: another player's blast, played here by this screen's copy of what made it (a call-in flown on every screen). Drawn,
   * heard and felt, and nothing more: it hurts nobody, breaks nothing and is never sent on.
   */
  cosmetic?: boolean;
  /** Co-op: every other screen flies its own copy of what made this blast and draws it there, so it is not sent as a `boom`. */
  mirrored?: boolean;
}

/**
 * Dotted smoke, Hellfire smoke, the heavy strike smoke, 30mm rings, a plasma spark line, a missile's thin quick smoke, or
 * the wake of the Lance's plasma ball: sparks with a ring pulse every few metres.
 */
export type ProjectileTrail = 'none' | 'smoke' | 'big' | 'hellfire' | 'rings' | 'howitzer' | 'sparks' | 'swarm' | 'plasma';

export interface ProjectileSpec {
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  kind: 'rocket' | 'shell' | 'grenade' | 'bullet' | 'plasma' | 'stake' | 'flame';
  team: Team;
  damage: number;
  /** Damage override on bosses, vehicles and the mech (e.g. Autocannon longer barrel: 1150 vs 900). */
  bossDamage?: number;
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
  /** Co-op: a copy of a projectile another browser owns. It flies and draws; it hurts nothing and never explodes. */
  cosmetic?: boolean;
  /** Penetration budget, as on ShotSpec. A round with any goes through walls and bodies until it is spent. */
  penetrate?: number;
  /** Budget one body costs, as on ShotSpec. */
  bodyCost?: number;
  armorPiercing?: boolean;
  /**
   * Co-op: a round of another player's call-in, fired here by this screen's copy of that call-in (progression/callins/
   * ghost.ts). It bursts on the first body or wall in its way, as its caller's does, and hurts nothing: its blast is `cosmetic`.
   * Not `cosmetic` above, which is a copy that waits for its owner's word and never bursts by itself.
   */
  ghost?: boolean;
  /**
   * A guided missile: steered at this target at `turnRate`, and onto the nearest live enemy, vehicle or aircraft ahead if
   * it dies. Null with a
   * `turnRate` flies straight until something dies near its line, which it never looks for: it stays dumb.
   */
  target?: MissileTarget | null;
  /** Radians a second the nose can turn. Set, the missile steers by this and not by `homing`. */
  turnRate?: number;
  /** Seconds after launch before it starts to steer, so a salvo leaves the tubes in a fan. */
  steerDelay?: number;
  /** Radians the path weaves either side of the line to its target, fading as it closes. */
  weave?: number;
  helix?: HelixSpec;
  /** Metres a second added each second, up to `topSpeed`. */
  accel?: number;
  topSpeed?: number;
  /** Scales the drawn body. */
  size?: number;
  /** The Rocket's: steers for the laser dot while the sight is on, flies straight while it is off (weapons/laser.ts). */
  wired?: boolean;
  /** The autocannon's flak shell: a proximity fuze and an air burst of shrapnel (weapons/flak.ts). */
  flak?: boolean;
  /** White phosphorus warhead (rocketWp): spawns a 6 m burning WP cloud for 12 s on detonation (weapons/wp.ts). */
  wp?: boolean;
  /** Howitzer standoff cluster shell (howitzerCluster): bursts ~7 m short into an 18-bomblet carpet (weapons/cluster.ts). */
  cluster?: boolean;
  /** The laser a `wired` rocket steers for, when it is not the player's own: the friend's whose rocket it is. */
  laser?: { on: boolean; at: THREE.Vector3 };
  /**
   * Co-op: the number this round goes by between screens, 0 or unset for none. `Combat.spawnProjectile` sets it on the
   * shooter's own; a copy carries its shooter's, so it can be ended where and when the shooter's really went off.
   */
  tag?: number;
  /** Milkor MGL sticky bomb: adheres to world geometry or struck enemies and awaits manual/swap detonation. */
  sticky?: boolean;
}

export interface CombatSystem extends GameSystem {
  /** Instant hit. Resolves enemies, corpses, world, FX, sound and damage. */
  fireRay(origin: THREE.Vector3, dir: THREE.Vector3, spec: ShotSpec): ShotResult;
  spawnProjectile(spec: ProjectileSpec): void;
  /** Data-driven explosion: damage, impulses, FX, sound and shake, scaled by distance to the player. */
  explode(position: THREE.Vector3, spec: ExplosionSpec): void;
  /** Muzzle helper for enemy guns. */
  enemyMuzzle(position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind): void;
  /**
   * Co-op: a round somebody else's gun landed on `enemy`, as the world shows it: blood or sparks where it struck and the
   * sound of it there. Nothing for the shooter alone (no marker, no 2D sound, no hit-stop).
   */
  remoteHit?(enemy: EnemyInstance, damage: DamageInfo, result: DamageResult): void;
  /** Co-op guest: the host says the local player's hit killed, and the gun did not announce it when it fired. */
  killConfirm?(point: THREE.Vector3, headshot: boolean): void;
  /** Co-op guest: the host says the local player's hit took a limb. */
  severConfirm?(point: THREE.Vector3): void;
  /**
   * Active protection hook (Frame Point Defence): intercepts up to `max` live enemy rockets, grenades, or shells
   * within `radius` m of `center` (or on a course entering `radius`), retiring them quietly without detonating.
   * `onIntercept` receives a scratch vector valid only during the callback. Returns the number intercepted.
   */
  interceptEnemyProjectiles?(
    center: THREE.Vector3,
    radius: number,
    max: number,
    onIntercept?: (at: THREE.Vector3) => void,
  ): number;
  /** True when any live enemy rocket is within `radius` m of `center` (Frame Countermeasure Rack auto-flares). */
  hasIncomingEnemyMissile?(center: THREE.Vector3, radius: number): boolean;
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
  /** World time an exploding bolt stuck in him goes off, while it is in him. He runs to his friends. */
  bolted?: number;
  /** Optional HUD display name overriding the default archetype label (e.g. scripted boss NPCs). */
  displayName?: string;
  /** True for scripted story NPCs that manage their own HUD markers and skip normal AI ticks. */
  scriptedNpc?: boolean;
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
  /** What a plate, helmet, shield or ward made of the round. Unset when no armour was in the way. */
  armour?: ArmourOutcome;
  /**
   * Co-op guest only: this hit should kill by the guest's own reckoning. The body dies on the host's word, so `killed` stays
   * false; what tells the shooter of a kill (the marker, the headshot's sound, hit-stop) goes by this, at once.
   */
  killSoon?: boolean;
  /**
   * Co-op guest only: the body was already reckoned dead by an earlier hit of this player's (the rest of a blast's pellets,
   * a rocket's splash after its own contact). In single player this round met a corpse: it marks the body and tells the
   * shooter nothing.
   */
  doomed?: boolean;
  /**
   * Co-op guest only, with kill prediction on: this machine is sure enough of the kill to start the death now, on the frame
   * of the shot. `fall`: the body drops limp, as a knockdown the host's `kill` turns into the corpse (and a wrong guess into a
   * get-up). `kill`: beyond doubt, so the whole death is played here at once (a head burst, a cut in two, a gib).
   */
  sure?: 'fall' | 'kill';
}

/** A kill as the shooter is told of one: decided here, or a co-op guest's own guess that the host will decide it. */
export const toldKill = (result: DamageResult): boolean => result.killed || result.killSoon === true;

/** Stopped: the armour took it all. Through: some reached the body. Broken: the piece was destroyed (with or without the rest getting in). */
export type ArmourOutcome = 'stopped' | 'through' | 'broken';

/** The player's aircraft, as an enemy chopper sees it. */
export interface FriendlyAircraft {
  readonly position: THREE.Vector3;
  /** Rounds landed: it loses this many seconds on station. */
  hit(seconds: number): void;
}

/** Enemy vehicles, for whatever resolves a hit. A collider that is not a live vehicle's answers false, and the caller carries on as for any wall. */
export interface VehicleTargets {
  /** Anything with no blast behind it. */
  shot(collider: RAPIER.Collider | null, point: THREE.Vector3, amount: number, source: string): boolean;
  /** A rocket or a shell landing on it. Its blast then comes through `blast` like anyone else's. */
  direct(collider: RAPIER.Collider | null, point: THREE.Vector3, amount: number, kind: ExplosionKind, source: string): boolean;
  /** Returns how many were caught. */
  blast(center: THREE.Vector3, spec: ExplosionSpec): number;
  /** Writes where the enemy chopper is. False when none is up. */
  chopperAt(out: THREE.Vector3): boolean;
  /** Writes every live vehicle and aircraft a launcher could paint into `out`, and returns how many. */
  paintable?(out: MissileTarget[]): number;
  /** The player's aircraft has come on station, or with null, left. */
  setFriendly(aircraft: FriendlyAircraft | null): void;
  /** Distraint Frame charge against vehicles: destroys & tosses soft vehicles, staggers tanks. */
  frameCharge?(at: THREE.Vector3, dir: THREE.Vector3): 'soft' | 'tank' | null;
  /** Distraint Frame stomp or backhand against nearby vehicles & wrecks. */
  frameBlow?(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3 | null, source: string): number;
}

export interface EnemySystem extends GameSystem {
  readonly alive: readonly EnemyInstance[];
  /** Null on any page with no vehicles, which is every page of the swarm. */
  readonly vehicles?: VehicleTargets | null;
  /** Spawned enemies not yet killed in this wave, including those queued. */
  readonly remaining: number;
  spawn(id: EnemyId, position: THREE.Vector3): EnemyInstance | null;
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): EnemyRayHit | null;
  /** All enemies along a ray, nearest first, up to `limit`. */
  raycastAll(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, limit: number): EnemyRayHit[];
  /** The one place damage reaches an enemy. */
  applyDamage(enemy: EnemyInstance, damage: DamageInfo): DamageResult;
  /**
   * The one place a weapon, call-in or perk sets an enemy alight (`burn`: at least `seconds` more), freezes it (`freeze`: for
   * `seconds`) or leaves a live bolt in it (`bolt`: its fuse). A co-op guest's goes to the host as a claim.
   */
  afflict(enemy: EnemyInstance, kind: 'burn' | 'freeze' | 'bolt', seconds: number): void;
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
  | 'chainStorm' | 'butcher' | 'skyfall' | 'chainReaction' | 'overdrive' | 'geneva';

export type CallInId = 'airstrike' | 'warthog' | 'doorGunner' | 'sentry' | 'attackChopper' | 'orbital' | 'ac130' | 'frame' | 'blackSun' | 'nuke';

export type PowerupId =
  | 'quad' | 'haste' | 'vampire' | 'ricochet' | 'shock' | 'ghost' | 'magnet' | 'regen' | 'frostNova' | 'timeWarp';

/** `health` is the stim pickup: it puts one stim in the player's kit (progression/stims.ts) and heals nothing itself. */
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
  /** Straight into a gunner's seat, with no key and nothing earned. */
  boardCallIn(id: CallInId, over?: THREE.Vector3): void;
  /** Into the Packmule's door on a fixed flight, with no way out and no clock. A mission's insertion. */
  boardFlight(flight: Flight): void;
  /** Points for something that is not a kill: a vehicle, say. */
  award(points: number, reason: string, position?: THREE.Vector3): void;
  /** Carries a mission's tally across a restart, which a new run would otherwise zero. */
  resume(score: number, kills: number, headshots: number): void;
  /** Puts the combo here with a fresh window, for tests and debug. What it would have paid on the way up waits for the next kill. */
  setCombo(combo: number): void;
  /** Drops a pickup in the world. */
  spawnPickup(kind: PickupKind, position: THREE.Vector3): void;
  /** One that stays where it is put, for a mission to leave lying about. */
  placePickup(kind: Exclude<PickupKind, 'weaponCache'>, position: THREE.Vector3): void;
  /** Seconds until a call-in can be earned again. */
  callInCooldown(id: CallInId): number;
  /** True while the aim would put the player inside the blast. */
  readonly dangerClose: boolean;
  /** Everything worth a dot on the minimap, including weapon caches. */
  readonly pickups: readonly { kind: PickupKind; position: THREE.Vector3; active: boolean }[];
  /** The player's stims: carried, injected on the stim key. */
  readonly stims: StimKit;
}

/** The stims the player carries. Health pickups put stims in here; the stim key spends one on the player. */
export interface StimKit {
  readonly count: number;
  readonly max: number;
  /** 0..1 through an injection, or -1 when none is going. While one goes the player cannot fire, aim or reload. */
  readonly injecting: number;
  /** Adds up to `n`, capped at `max`. Returns how many went in. */
  give(n: number): number;
  /**
   * Takes one stim for something other than the player's own injection, such as reviving a wounded ally. No animation, no
   * heal, no sound: the caller does those. False when there is none to take. Nothing calls this yet (Outpost Defense piece 2).
   */
  spend(): boolean;
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
  /** A co-op teammate pinged from `origin`: everyone sees what it lights. */
  share?(origin: THREE.Vector3): void;
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
  hitMarker(kind: 'body' | 'head' | 'kill' | 'armor' | 'armorThrough' | 'armorBroken'): void;
  /** The name of a move just done, called out small under the crosshair, as a fighting game does. Optional for stand-ins. */
  callout?(text: string): void;
  /** A hold under way (a capture, a revive): the ring round the crosshair at `fill`, 0 to 1, this frame; 1 is done. Optional for stand-ins. */
  hold?(fill: number): void;
  /** Score text that floats up from a world position. */
  floatText(position: THREE.Vector3, text: string, color?: string): void;
  /** A world position marker, e.g. a weapon cache or powerup. Returns a remover. */
  marker(position: THREE.Vector3, label: string, color?: string): () => void;
  /** The same, on something that moves. `target` must stay valid until the remover is called. */
  /** `tag`: a co-op friend's name tag. Tags that would be printed over each other are stacked, one line under the other. */
  follow(target: THREE.Vector3, label: string, color?: string, tag?: boolean): () => void;
  /** Loading screen progress. */
  loading(fraction: number, label: string): void;
  showScreen(screen: 'splash' | 'menu' | 'pause' | 'gameover' | 'guide' | 'settings' | 'none'): void;
  /** Puts up a seat's panel. Null brings the on-foot HUD back. */
  seat(panel: SeatPanel | null): void;
  /** 0 clear to 1 gone: the eyes have stopped working, and a readable minimap would say otherwise. */
  dazzle?(amount: number): void;
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

    /** `note`: what the shot adds for the other players' screens in co-op (FireNote). The object is reused: read it at once. */
    'weapon:fired': { weapon: WeaponId; origin: THREE.Vector3; dir: THREE.Vector3; note?: FireNote; suppressed?: boolean };
    /** Hitscan world geometry impact (non-enemy), for stealth bullet-impact acoustics. `position` is reused: copy it to keep it. */
    'weapon:impact': { position: THREE.Vector3; surface: SurfaceKind; weapon: WeaponId; suppressed: boolean };
    /** A melee swing drew this (MeleeFx), for the other players' screens in co-op. The object is reused: read it at once. */
    'melee:fx': MeleeFx;
    /**
     * A weapon effect that lasts ended, for the other players' screens in co-op: the Lance's sustained beam, its giant ball
     * (`at` and `normal`: where it went off), the Kiln's stream, the rotary cannon's barrage (`spin`). Each begins with a `weapon:fired` of that kind.
     * `whine` is the rotary cannon's barrels alone: `on` as they begin to turn (its spin-up), off as they run down.
     */
    'weapon:loop': { weapon: WeaponId; kind: 'beam' | 'giant' | 'hose' | 'spin' | 'whine'; on: boolean; at: THREE.Vector3; normal: THREE.Vector3 | null };
    'weapon:switched': { from: WeaponId; to: WeaponId };
    'weapon:reload': { weapon: WeaponId; phase: 'start' | 'end' };
    'weapon:empty': { weapon: WeaponId };
    'weapon:unlocked': { weapon: WeaponId };

    'enemy:spawned': { enemy: EnemyInstance };
    'enemy:hit': { enemy: EnemyInstance; damage: DamageInfo; result: DamageResult };
    'enemy:killed': KillEvent;
    /** One event a region lost. `cut` is on the first of a cut's events only: the region the cut was made at (co-op sends that one). */
    'enemy:severed': { enemy: EnemyInstance; region: GoreRegion; damage: DamageInfo; cut?: GoreRegion };

    'wave:start': { wave: number; total: number; boss: boolean };
    'wave:clear': { wave: number; bonus: number };

    'perk:start': { id: PerkId | PowerupId; seconds: number; label: string; color: string };
    'perk:end': { id: PerkId | PowerupId };
    'callin:ready': { id: CallInId };
    'callin:used': { id: CallInId; position: THREE.Vector3 };
    /** Co-op, on the host: another player called one in. Not `callin:used`, which is this player's own hand, score and report. */
    'callin:teammate': { id: CallInId; slot: number; position: THREE.Vector3 };
    'combo:changed': { combo: number };
    'score:gain': { points: number; reason: string; position?: THREE.Vector3 };
    'pickup:collected': { kind: PickupKind; position: THREE.Vector3 };

    /** The left hand has started for the helmet. */
    'sonar:tap': Record<string, never>;
    /** The ring went out. `origin` is reused, so copy it to keep it. */
    'sonar:ping': { origin: THREE.Vector3 };
    /** The player started a stim injection. The heal lands `STIM.injectAt` seconds later. */
    'stim:inject': Record<string, never>;
    /** The Gun Kata brain chip went (contracts/chips.ts): co-op tells the host to expect a burst (net/world.ts). */
    'chip:kata': Record<string, never>;
  }
}
