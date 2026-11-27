/**
 * Another player's weapons, as this screen shows them in co-op: the remote FX table, and the `Watcher` that draws from it.
 *
 * The rule (owner, 2026-11-18): everything that happens on one player's screen happens on the others'. So a friend's shot is
 * not a look-alike drawn by co-op code. It is the shooter's own code run again here from the friend's body: the same
 * `Combat.fireRay` (tracers, wall impacts, decals, needles, sparks, bursts, exits through cover), the same `Raufoss`, the same
 * `Lance` class, the same projectile pool. Two switches make that harmless: `Combat.watching` (a strike and a blast do
 * nothing, no corpse, map object or vehicle is touched, no blood is drawn) and `ProjectileSpec.cosmetic`. The damage is the
 * shooter's own game's, checked by the host; the blast, the blood and the kill reach this screen by their own events.
 *
 * `REMOTE_FX` says, weapon by weapon, what leaves the gun for a watcher, and `REMOTE_MODS` what each mod changes of it. A new
 * weapon or mod has to be added to both (they are `Record`s over every id, so `tsc` asks), and watch.test.ts holds each row
 * to what the weapon's own row fires.
 *
 * The wire is src/net/world/remoteFire.ts; the friend's body is src/net/remote.ts (`Shooter`).
 */
import * as THREE from 'three';
import { CG, type Ctx, type LoopHandle, type PlayOptions, type SlashKind } from '../core/contracts';
import type { FireKind, FireNote, MeleeFx, ModId, ProjectileSpec, ShotSpec, WeaponId, WeaponModifiers } from '../core/gameplay';
import { lookup } from '../audio/catalog';
import { SeededRandom, randomInCone } from '../core/math';
import type { Combat } from './Combat';
import { LAUNCHER, OICW_LAUNCHER, TUNING, WEAPONS, type SoundLayer, type WeaponDef } from './data';
import { FRIEND_EVERY } from './Flames';
import { Lance, type LanceHolder, type LanceHost, type LanceShot } from './lance';
import { MODS, moddedDef } from './mods';
import { ENERGY } from './melee/data';
import { Raufoss } from './raufoss';
import { Microwave } from './microwave';
import { Harpoon } from './harpoon';
import { backblast, fillShot } from './shot';

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

/**
 * How a weapon is drawn from outside.
 * - `rounds`: hitscan. Every round is the shooter's own ray run again here: tracer from the friend's muzzle, the impact and
 *   decal where it stops, through what it goes through.
 * - `pellets`: `rounds`, many a pull, each down the direction the shooter's own seed gave it.
 * - `projectile`: the flash and report here; the round itself flies as a cosmetic copy of the shooter's projectile.
 * - `lance`: a `Lance` of the friend's own (rail, beam, ball, giant ball).
 * - `hose`: the Kiln's stream, napalm and all, from the friend's nozzle.
 * - `melee`: the swing on the friend's body and its slash at their blade.
 */
export type RemoteKind = 'rounds' | 'pellets' | 'projectile' | 'lance' | 'hose' | 'melee';

export interface RemoteRow {
  kind: RemoteKind;
  /** What a watcher sees and hears, in plain words (docs/notes/coop.md lists these). */
  sees: string;
}

const BULLET = 'tracer from their muzzle to where the round stops, wall impact and bullet hole, flash, report, casing';

export const REMOTE_FX: Readonly<Record<WeaponId, RemoteRow>> = {
  smg: { kind: 'rounds', sees: BULLET },
  gimlet: { kind: 'rounds', sees: `${BULLET}; its launcher's grenade flies as a projectile` },
  harrow: { kind: 'rounds', sees: `${BULLET}, on through a body or a sheet of cover with the exit mark` },
  shear: { kind: 'rounds', sees: `${BULLET}; opening hyperburst fires two or three rounds in one tight cluster` },
  flail: { kind: 'rounds', sees: `${BULLET}, through thin cover` },
  shotgun: { kind: 'pellets', sees: 'every pellet the shooter fired, from the same seed: its tracer, impact and hole' },
  thresher: { kind: 'pellets', sees: 'every pellet of every shell, from the same seed' },
  deuce: { kind: 'pellets', sees: 'every pellet of each barrel, from the same seed; both barrels echo as the shooter hears them' },
  rocket: { kind: 'projectile', sees: 'the rocket in flight with its smoke, steering for their laser dot when the sight is on; the laser line itself' },
  quiver: { kind: 'projectile', sees: 'each missile leaving, turning onto the same mark or braiding in the helix salvo' },
  mgl: { kind: 'projectile', sees: 'each 40 mm grenade arcing from the revolving drum; sticky bombs clamp onto surfaces or targets with a pulsing beacon until detonation' },
  satchel: { kind: 'projectile', sees: 'each lobbed demolition satchel charge clamping onto surfaces or targets with a pulsing red beacon until remote detonation' },
  howitzer: { kind: 'projectile', sees: 'the 105 mm shell tearing through the air with supersonic vapor rings, rear venturi backblast, and a massive finisher detonation' },
  sabot: { kind: 'rounds', sees: 'the dart and its vapour wake, through walls and bodies with exit marks; Raufoss bursts and pellets when fitted' },
  awl: { kind: 'rounds', sees: 'the round and its wake, through cover' },
  autocannon: { kind: 'projectile', sees: 'the shell in flight with its rings; a flak shell bursts in the air with its ring, sparks and fragment tracers' },
  sword: { kind: 'melee', sees: 'the swing on their body and the slash at their blade; the energy blade glows and zaps' },
  knife: { kind: 'melee', sees: 'the swing on their body and the slash at their blade' },
  crowbar: { kind: 'melee', sees: 'the swing on their body and the slash at their blade' },
  shovel: { kind: 'melee', sees: 'the swing on their body and the slash at their blade' },
  baton: { kind: 'melee', sees: 'the swing on their body and the slash at their blade' },
  judge: { kind: 'rounds', sees: `${BULLET}; a fanned shot goes to the head it locked` },
  rivet: { kind: 'rounds', sees: BULLET },
  ultramag: { kind: 'rounds', sees: BULLET },
  autoraffica: { kind: 'rounds', sees: `${BULLET}; a smart round goes to the head it locked` },
  lance: { kind: 'lance', sees: 'the rail with its bolt and a plasma burst at each body; the charged beam (column, sheath, shell, end sparks, scorch, light, its loop heard from the gun); the ball and the giant ball in flight and going off' },
  buzzsaw: { kind: 'rounds', sees: 'every 20 mm round and its burst where it lands, the barrage heard from their gun' },
  piledriver: { kind: 'rounds', sees: `${BULLET}, through walls with exit craters; Raufoss bursts when loaded` },
  metalstorm: { kind: 'rounds', sees: 'electronic stacked-barrel tracers from the 36-barrel matrix, up to a 1M RPM hyper-volley; 40mm FireStorm grenades arc as projectiles' },
  kiln: { kind: 'hose', sees: 'the napalm stream from their nozzle, its splashes, burning pools and scorches' },
  autoclave: { kind: 'hose', sees: 'the heat shimmer ahead of the emitter and the rising hum as targets steam, swell and burst' },
  stakegun: { kind: 'projectile', sees: 'the stake in flight and standing in the wall; an exploding bolt sticks, beeps and blinks' },
  gaff: { kind: 'projectile', sees: 'the heavy harpoon in flight with its steel tether cable, skewering bodies to the wall and reeling' },
  bodkin: { kind: 'rounds', sees: 'three-round bursts of thin flechette tracers through plates and cover, leaving needles in the wall; its 20 mm OICW launcher fires flat-arc smart grenades' },
  billhook: { kind: 'pellets', sees: 'every pellet of the semi-auto twelve-gauge shell from the same seed, or a single heavy slug when loaded' },
};

/** What a mod changes of its gun for a watcher. */
export type ModLook = 'none' | 'report' | 'round' | 'pellets' | 'second gun' | 'light' | 'blade' | 'shell' | 'rate';

const SIGHT = 'a sight: nothing a watcher sees';
const MAG = 'more rounds: nothing a watcher sees';
const AP = 'the round\'s own tracer colour';
const LIGHT = 'a light cone from their gun, on while it is in hand';
const AKIMBO = 'a second gun in the left hand; shots alternate muzzles';
const MAGWELL = 'a flared magwell: the reload gesture is shorter';
const SHIELD = 'a ballistic riot shield carried on the left arm, stopping frontal fire until fatigued';

export const REMOTE_MODS: Readonly<Record<ModId, { look: ModLook; sees: string }>> = {
  awlAcog: { look: 'none', sees: SIGHT }, harrowAcog: { look: 'none', sees: SIGHT }, gimletAcog: { look: 'none', sees: SIGHT },
  gimletDot: { look: 'none', sees: SIGHT }, gimletHolo: { look: 'none', sees: SIGHT }, reddot: { look: 'none', sees: SIGHT },
  harrowHolo: { look: 'none', sees: SIGHT }, piledriverDot: { look: 'none', sees: SIGHT }, piledriverHolo: { look: 'none', sees: SIGHT },
  piledriverAcog: { look: 'none', sees: SIGHT }, ultramagDot: { look: 'none', sees: SIGHT }, flailDot: { look: 'none', sees: SIGHT },
  flailHolo: { look: 'none', sees: SIGHT }, flailAcog: { look: 'none', sees: SIGHT }, rivetDot: { look: 'none', sees: SIGHT }, billhookDot: { look: 'none', sees: SIGHT },
  shotgunDot: { look: 'none', sees: SIGHT }, thresherDot: { look: 'none', sees: SIGHT }, deuceDot: { look: 'pellets', sees: 'the tighter pattern (the cone the shooter used is sent)' },
  bodkinAcog: { look: 'none', sees: SIGHT },
  awlCan: { look: 'report', sees: 'the suppressed report and the small dim flash' },
  awl50: { look: 'report', sees: 'the thunderous .50 Cal anti-materiel report (or suppressed .50 Cal report with a can), heavy sabot flash, and oversized cannon casing' },
  suppressor: { look: 'report', sees: 'the suppressed report and the small dim flash, at the faster rate' },
  gimletCan: { look: 'report', sees: 'the suppressed report and the small dim flash' },
  ultramagCan: { look: 'report', sees: 'the suppressed report and the small dim flash' },
  rivetCan: { look: 'report', sees: 'the suppressed Rivet report and the small dim flash' },
  shotgunCan: { look: 'report', sees: 'the heavy suppressed shotgun thump and the small dim flash' },
  awlAp: { look: 'round', sees: AP }, awlHp: { look: 'round', sees: AP }, awlPlusP: { look: 'round', sees: AP },
  smgAp: { look: 'round', sees: AP }, smgHp: { look: 'round', sees: AP }, smgPlusP: { look: 'round', sees: AP },
  gimletAp: { look: 'round', sees: AP }, gimletHp: { look: 'round', sees: AP }, gimletPlusP: { look: 'round', sees: AP },
  harrowAp: { look: 'round', sees: AP }, harrowHp: { look: 'round', sees: AP }, harrowPlusP: { look: 'round', sees: AP },
  rivetAp: { look: 'round', sees: AP }, rivetHp: { look: 'round', sees: AP }, rivetPlusP: { look: 'round', sees: AP },
  ultramagAp: { look: 'round', sees: AP }, ultramagHp: { look: 'round', sees: AP }, ultramagPlusP: { look: 'round', sees: AP },
  judgeAp: { look: 'round', sees: AP }, judgeHp: { look: 'round', sees: AP }, judgePlusP: { look: 'round', sees: AP },
  autorafficaAp: { look: 'round', sees: AP }, autorafficaHp: { look: 'round', sees: AP }, autorafficaPlusP: { look: 'round', sees: AP },
  flailAp: { look: 'round', sees: AP }, flailHp: { look: 'round', sees: AP }, flailPlusP: { look: 'round', sees: AP },
  harrowApi: { look: 'round', sees: 'the red API tracer and orange sparks where it lands' },
  flailApi: { look: 'round', sees: 'the red API tracer and orange sparks where it lands' },
  awlBarrel: { look: 'round', sees: 'the longer, brighter vapour wake, through more cover' },
  gimletLong: { look: 'round', sees: 'the longer bright scout tracer through more cover at a slightly slower cadence' },
  flailHeavy: { look: 'rate', sees: 'the faster heavy-barrel rate through cover' },
  flailBolt: { look: 'rate', sees: 'the lightened bolt hammering at twelve hundred rounds a minute' },
  billhookSlug: { look: 'round', sees: 'a single heavy slug tracer and larger wall impact in place of buckshot' },
  bodkinTungsten: { look: 'round', sees: 'the heavy sabot-grade dart wake punching through twice the cover' },
  raufoss: { look: 'round', sees: 'the Raufoss tracer, its burst, sparkle and scorch where it strikes, and the pellets out of the far side' },
  shotgunFlechette: { look: 'pellets', sees: 'a needle of a tracer a dart, from the same seed, and the needles standing in the wall' },
  thresherFlechette: { look: 'pellets', sees: 'a needle of a tracer a dart, from the same seed, and the needles standing in the wall' },
  deuceFlechette: { look: 'pellets', sees: 'a needle of a tracer a dart, from the same seed, and the needles standing in the wall' },
  billhookFlechette: { look: 'pellets', sees: 'a needle of a tracer a dart, from the same seed, and the needles standing in the wall' },
  thresherDragon: { look: 'pellets', sees: 'a tongue of flame, wide shower of glowing sparks, orange tracers and scorches' },
  billhookDragon: { look: 'pellets', sees: 'a tongue of flame, wide shower of glowing sparks, orange tracers and scorches' },
  shotgunChoke: { look: 'pellets', sees: 'the tighter pattern (the cone the shooter used is sent)' },
  shotgunSawedOff: { look: 'pellets', sees: 'the wider sawed-off cone (the cone the shooter used is sent)' },
  deuceLong: { look: 'pellets', sees: 'the tighter long-barrel pattern (the cone the shooter used is sent)' },
  deuceQuad: { look: 'pellets', sees: 'four barrels\' worth of pellets and echoes on a right click' },
  trommel12: { look: 'round', sees: 'the heavy round through walls in place of the 20 mm burst, the barrage a step lower' },
  autocannonFlak: { look: 'shell', sees: 'the flak shell\'s air burst: ring, sparks, light and fragment tracers' },
  autocannonBarrel: { look: 'shell', sees: 'the faster 20 mm shell in flight' },
  rocketTube: { look: 'shell', sees: 'the faster rocket in flight' },
  rocketWp: { look: 'shell', sees: 'the white phosphorus rocket bursting into a burning white-smoke cloud' },
  mglLong: { look: 'shell', sees: 'the flatter, faster 40 mm grenade arc' },
  howitzerCluster: { look: 'shell', sees: 'the standoff burst throwing a carpet of bomblets across the target zone' },
  metalstorm40mm: { look: 'shell', sees: 'stacked 40 mm HE grenades arcing from the FireStorm barrel matrix, with a heavy launcher thump' },
  mglSticky: { look: 'shell', sees: '40 mm sticky bombs clamping onto surfaces or targets with a pulsing red-amber LED until remote detonation' },
  smgAkimbo: { look: 'second gun', sees: AKIMBO }, rivetAkimbo: { look: 'second gun', sees: AKIMBO },
  ultramagAkimbo: { look: 'second gun', sees: AKIMBO }, judgeAkimbo: { look: 'second gun', sees: AKIMBO },
  autorafficaAkimbo: { look: 'second gun', sees: AKIMBO },
  rivetShield: { look: 'second gun', sees: SHIELD }, ultramagShield: { look: 'second gun', sees: SHIELD },
  judgeShield: { look: 'second gun', sees: SHIELD }, autorafficaShield: { look: 'second gun', sees: SHIELD },
  smgLight: { look: 'light', sees: LIGHT }, gimletLight: { look: 'light', sees: LIGHT }, harrowLight: { look: 'light', sees: LIGHT },
  awlLight: { look: 'light', sees: LIGHT }, shotgunLight: { look: 'light', sees: LIGHT }, thresherLight: { look: 'light', sees: LIGHT },
  deuceLight: { look: 'light', sees: LIGHT }, judgeLight: { look: 'light', sees: LIGHT }, rivetLight: { look: 'light', sees: LIGHT },
  ultramagLight: { look: 'light', sees: LIGHT }, autorafficaLight: { look: 'light', sees: LIGHT },
  billhookLight: { look: 'light', sees: LIGHT }, bodkinLight: { look: 'light', sees: LIGHT },
  swordEnergy: { look: 'blade', sees: 'the blade of light: its glow, its zap on a swing, its cauterizing sparks' },
  gimletGl: { look: 'shell', sees: 'the 40 mm grenade arcing out of the launcher, with its thump' },
  sabotBrake: { look: 'rate', sees: 'the faster rate only' }, ultramagLam: { look: 'rate', sees: 'the faster rate only' },
  ultramagComp: { look: 'rate', sees: 'the faster rate only' }, gimletShort: { look: 'rate', sees: 'the faster rate only' },
  harrowShort: { look: 'rate', sees: 'the faster rate only' }, harrowBrake: { look: 'rate', sees: 'the faster rate only' },
  rivetLam: { look: 'rate', sees: 'the faster rate only' }, rivetComp: { look: 'rate', sees: 'the faster rate only' },
  mglTrigger: { look: 'rate', sees: 'the faster rate only' },
  awlBolt: { look: 'rate', sees: 'the faster bolt only' },
  shotgunBolt: { look: 'rate', sees: 'the faster pump cycle only' },
  bodkinBurst5: { look: 'rate', sees: 'five darts per burst instead of three' },
  bodkinAuto: { look: 'rate', sees: 'continuous full-auto dart streams instead of bursts' },
  smgMag: { look: 'none', sees: MAG }, rivetMag: { look: 'none', sees: MAG }, piledriverBox: { look: 'none', sees: MAG },
  ultramagMag: { look: 'none', sees: MAG }, autorafficaMag: { look: 'none', sees: MAG }, flailBox: { look: 'none', sees: MAG },
  harrowMag: { look: 'none', sees: MAG }, billhookTube: { look: 'none', sees: MAG }, bodkinMag: { look: 'none', sees: MAG },
  smgTape: { look: 'none', sees: 'a faster reload: the reload gesture is shorter' },
  harrowMagwell: { look: 'none', sees: MAGWELL }, gimletMagwell: { look: 'none', sees: MAGWELL },
  ultramagMagwell: { look: 'none', sees: MAGWELL }, rivetMagwell: { look: 'none', sees: MAGWELL },
  bodkinMagwell: { look: 'none', sees: MAGWELL },
  smgStock: { look: 'none', sees: 'a longer held-breath zoom: nothing a watcher sees' },
  flailStock: { look: 'none', sees: 'a longer held-breath zoom: nothing a watcher sees' },
  billhookLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
  gimletLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
  harrowLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
  bodkinLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
  flailLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
  awlLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
  sabotLam: { look: 'none', sees: 'a laser sight: nothing a watcher sees' },
  shotgunLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
  thresherLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
  deuceLam: { look: 'none', sees: 'a laser sight: nothing a watcher sees' },
  judgeLong: { look: 'none', sees: 'higher damage per round: nothing a watcher sees' },
  deuceLoader: { look: 'none', sees: 'a faster reload: the reload gesture is shorter' },
  judgeHammer: { look: 'rate', sees: 'the faster fan only' }, judgeComp: { look: 'rate', sees: 'the faster fan charge only' },
  judgeGrip: { look: 'none', sees: 'more fanned rounds: each is drawn as it is fired' },
  bodkinOicw: { look: 'shell', sees: 'the flat-arc 20 mm grenade firing from the over-barrel launcher, airbursting mid-air with an amber ring when lased' },
  shearDot: { look: 'none', sees: SIGHT }, shearAcog: { look: 'none', sees: SIGHT },
  shearBurst3: { look: 'rate', sees: 'a three-round hyperburst opening instead of two' },
  shearFast: { look: 'rate', sees: 'the faster sustained auto rate only' },
  shearMag: { look: 'none', sees: MAG },
  shearLong: { look: 'round', sees: 'the longer barrel\'s rifle tracer through light cover' },
  shearShort: { look: 'rate', sees: 'the faster carbine rate only' },
  shearCan: { look: 'report', sees: 'the suppressed report and the small dim flash' },
  shearBrake: { look: 'rate', sees: 'the flatter compensator cycle only' },
  shearAp: { look: 'round', sees: AP }, shearHp: { look: 'round', sees: AP }, shearPlusP: { look: 'round', sees: AP },
  shearMagwell: { look: 'none', sees: MAGWELL },
  shearLight: { look: 'light', sees: LIGHT },
  shearLam: { look: 'none', sees: 'a laser sight and faster aim: nothing a watcher sees' },
};

// ---------------------------------------------------------------------------------------------
// The watcher
// ---------------------------------------------------------------------------------------------

/** A one-shot move on a friend's body. */
export type Gesture = 'shoot' | 'reload' | 'stim' | 'throw' | 'swing' | 'heavy';

/** A friend's body, as their weapons need it: where they look from and where their gun is. src/net/remote.ts is the one. */
export interface Shooter extends LanceHolder {
  readonly velocity: THREE.Vector3;
  /** Their muzzle in the world: the gun in the right hand, or the one in the left (akimbo). */
  muzzle(out: THREE.Vector3, left?: boolean): THREE.Vector3;
  gesture(kind: Gesture): void;
  /** Which of the friends they are, 1 to 3: their own strand of the napalm hose, their own light. */
  readonly seat: number;
}

/**
 * What a friend is doing with their gun besides firing it, as their pose says 20 times a second (net/pose.ts `flags`):
 * reloading, injecting a stim, the rocket's laser sight up, a Lance charge under way and in which mode.
 */
export interface Doing {
  reload: boolean;
  stim: boolean;
  laser: boolean;
  charge: boolean;
  ball: boolean;
  shield?: boolean;
}

/** A friend's perks are not known here, and their look is the shooter's own to send: every round is filled plain. */
const PLAIN: WeaponModifiers = {
  damage: 1, fireRate: 1, bottomlessMag: false, pellets: 1, explosiveRounds: false, blastRadius: 1, instakillBlast: false, akimbo: false,
  ricochet: 0, shockRounds: false, alwaysSever: false, tracer: null, shotLayers: [],
};
/** A friend's gun is heard at this share of its own report: it is theirs, beside yours, not yours. */
export const REPORT = 0.65;
/**
 * Seconds without a round before a friend's rotary cannon is heard to stop if they never said it had: their own word ends it
 * at once (`loop`, kind `spin`), and this only covers a word that never came.
 */
const BARRAGE_GAP = 1;
const UP = new THREE.Vector3(0, 1, 0);
/**
 * Seconds a friend's Kiln pours on after their last word that it is on (one comes every 120 ms): long enough to ride out a
 * resend stall on a lossy link. Their own word that it stopped ends it at once.
 */
const HOSE_HOLD = 0.75;
const SLASHES: readonly SlashKind[] = ['light', 'heavy', 'sweep', 'finisher', 'wave'];
/** The weapon light of a friend's gun: the viewmodel's own beam (viewmodels/rig.ts TORCH_BEAM). */
export const FRIEND_TORCH = { color: 0xfff1dc, candela: 140, decay: 1, range: 30, cone: 0.4, soft: 0.6 } as const;

/** What a watcher counted, by kind, since the page loaded: for the browser proofs (tools/scripts/coop-fx-matrix.mjs). */
export const WATCHED = {
  shots: 0, rays: 0, flashes: 0, casings: 0, sounds: 0, projectiles: 0, rails: 0, beams: 0, balls: 0, giants: 0, beamStops: 0, giantLands: 0,
  raufoss: 0, hose: 0, globs: 0, swings: 0, slashes: 0, meleeFx: 0, reloads: 0, stims: 0, lasers: 0, lights: 0, whines: 0, perkTracers: 0, last: '' as string,
};

export class Watcher {
  /** The row their gun in hand fires by, mods fitted, when the kit they sent names it. */
  private def: WeaponDef = WEAPONS.smg;
  private weapon: WeaponId = 'smg';
  private readonly mods = new Set<ModId>();
  private puppet: Lance | null = null;
  private raufoss: Raufoss | null = null;
  private readonly shot: ShotSpec = { damage: 0, source: '', team: 'player' };
  private readonly muzzleAt = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly rng = new SeededRandom();
  private readonly heard: PlayOptions = {};
  /** The rotary cannon's barrage, heard from their gun while rounds keep coming. */
  private barrage: LoopHandle | null = null;
  private barrageLeft = 0;
  private barragePitch = 1;
  /** Their rocket's laser sight: on while it is up, and where its dot lies. A wired rocket of theirs steers for it. */
  readonly laser = { on: false, at: new THREE.Vector3() };
  /** True once they have said what they hold (`hold`). */
  held = false;
  /** Their Kiln or Autoclave: seconds it still streams without another word, its sound, and napalm glob cadence. */
  private hoseLeft = 0;
  private hoseLoop: LoopHandle | null = null;
  private hoseOwed = 0;
  private hoseWeapon: WeaponId = 'kiln';
  private microwave: Microwave | null = null;
  private harpoon: Harpoon | null = null;
  /** What their pose last said they were doing, to tell a start from more of the same. */
  private readonly was: Doing = { reload: false, stim: false, laser: false, charge: false, ball: false };
  /** Their weapon light: one of the session's spotlights (net/remote.ts hands it over), dark unless their gun has one fitted. */
  torch: THREE.SpotLight | null = null;
  /** A hand-cycled gun's shell, still in the chamber: seconds until the pump throws it, and its kind. */
  private casingIn = 0;
  private casingKind: NonNullable<WeaponDef['casing']> = 'shotgun';
  /** The energy blade's hum while it is in their hand, and seconds to its next glint of light. */
  private bladeHum: LoopHandle | null = null;
  private glintIn = 0;
  private readonly glob = new THREE.Vector3();
  private readonly speed = new THREE.Vector3();

  constructor(private readonly ctx: Ctx, private readonly shooter: Shooter) {}

  private get combat(): Combat {
    return this.ctx.combat as Combat;
  }

  /** What they hold now, and what is fitted to it: their own word (the `held` event). Unknown ids are dropped. */
  hold(weapon: string, mods: readonly string[]): void {
    if (!Object.hasOwn(WEAPONS, weapon)) return;
    this.held = true;
    this.weapon = weapon as WeaponId;
    this.mods.clear();
    for (const id of mods) if (Object.hasOwn(MODS, id) && MODS[id as ModId].weapon === weapon) this.mods.add(id as ModId);
    this.def = moddedDef(this.weapon, this.mods);
    if (this.weapon === 'lance') this.lance().prime();
  }

  /** True when their gun in hand has `mod` fitted. */
  has(mod: ModId): boolean {
    return this.mods.has(mod);
  }

  get holding(): WeaponId {
    return this.weapon;
  }

  private rowOf(weapon: WeaponId): WeaponDef {
    return weapon === this.weapon ? this.def : WEAPONS[weapon];
  }

  /**
   * One shot of theirs: `origin` and `dir` are their eye and the way the round went when they fired, `note` what else the
   * shot was (FireNote). Drawn from their body as it stands on this screen.
   */
  fire(weapon: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3, note: FireNote): void {
    const s = this.shooter;
    // A rifle with an attached launcher that fired no hitscan rays fired its launcher tube, not the rifle.
    const row = this.rowOf(weapon);
    const def = note.rays === 0 && note.kind === 'gun' && (weapon === 'gimlet' || weapon === 'bodkin' || row.launcher)
      ? (weapon === 'bodkin' ? OICW_LAUNCHER : LAUNCHER)
      : row;
    // Traced from where they stood and looked as they fired. Their body's own aim takes these back next frame.
    s.eye.copy(origin);
    s.forward.copy(dir);
    WATCHED.shots++;
    WATCHED.last = `${weapon}:${note.kind}`;
    switch (note.kind) {
      case 'rail': case 'beam': case 'ball': case 'giant':
        this.lanceShot(note.kind);
        return;
      case 'hose':
        this.pour(weapon);
        return;
      case 'swing':
        this.swing(note);
        return;
    }
    const kind = REMOTE_FX[weapon].kind;
    if (kind === 'melee' || kind === 'hose' || kind === 'lance') return;
    this.feedback(def, note.left, note.barrel);
    if (weapon === 'gaff') {
      const at = s.muzzle(this.muzzleAt, note.left);
      const h = (this.harpoon ??= new Harpoon(this.ctx));
      if (note.alt) {
        if (h.ropeOut) h.cut();
        h.finishReload();
      }
      h.fire(origin, dir, at, 'gaff', true, note.alt);
      WATCHED.projectiles++;
      return;
    }
    if (note.rays <= 0) return;
    this.rounds(def, origin, dir, note);
  }

  /** Their hitscan rounds: the shooter's own rays run again here, under `Combat.watching`. */
  private rounds(def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, note: FireNote): void {
    const combat = this.combat;
    const shot = fillShot(this.shot, def, def.damage, PLAIN, this.muzzleAt);
    shot.gib = false;
    // A perk's tracer is the shooter's to say (their perks are not known here): Hellfire, Bloodthirst, Berserk.
    if (note.tracer) { shot.tracer = note.tracer; WATCHED.perkTracers++; }
    // A scatter of barrels together (the Deuce): each barrel past the first is heard an echo late, as the shooter hears it.
    const two = def.altBoth;
    if (two && def.pellets > 0) {
      const barrels = Math.round(note.rays / def.pellets);
      for (let k = 1; k < barrels; k++) {
        this.ctx.fx.muzzleFlash(this.muzzleAt, this.shooter.forward, def.muzzle);
        this.say(def.sounds[0]!.id, REPORT, two.echoPitch, two.echo * k);
      }
    }
    const random = note.seed !== 0 ? this.rng.seed(note.seed) : Math.random;
    const raufoss = note.alt || def.raufoss === true;
    combat.watching++;
    try {
      for (let i = 0; i < note.rays; i++) {
        const d = note.cone > 0 ? randomInCone(dir, note.cone, this.dir, random) : dir;
        if (raufoss) {
          (this.raufoss ??= new Raufoss(this.ctx, combat)).fire(origin, d, shot);
          WATCHED.raufoss++;
        } else combat.fireRay(origin, d, shot);
        WATCHED.rays++;
      }
    } finally {
      combat.watching--;
    }
  }

  /** The frame-of-the-shot beats a watcher gets: the flash at their muzzle, the report from it, brass, and the body's kick. */
  private feedback(def: WeaponDef, left: boolean, barrel: number): void {
    const { fx } = this.ctx;
    const s = this.shooter;
    const at = s.muzzle(this.muzzleAt, left);
    fx.muzzleFlash(at, s.forward, def.muzzle);
    if (def.load === 'dragon') fx.dragonBreath?.(at, s.forward);
    WATCHED.flashes++;
    this.layers(def.sounds);
    if (def.mode === 'spin') this.rattle(def);
    if (def.cycleFoley) {
      // A hand-cycled gun: the pump or the bolt is heard from them, and its shell leaves when the hand pulls it back.
      for (const [when, id] of def.cycleFoley) if (id) this.say(id, REPORT, 1, Math.max(0.001, when));
      if (def.casing) {
        this.casingIn = Math.max(0.01, def.cycleFoley[def.cycleEject ?? 0]?.[0] ?? 0.1);
        this.casingKind = def.casing;
      }
    } else if (def.casing) this.eject(def.casing);
    // The Quiver's tubes and the 105mm Howitzer's recoilless venturi vent behind the shoulder.
    if (def.mode === 'paint' || def.id === 'howitzer') backblast(this.ctx, s.eye, s.forward);
    void barrel;
    s.gesture('shoot');
  }

  /** Brass out of the port of their gun: a hand back from the muzzle, thrown to their right. */
  private eject(kind: NonNullable<WeaponDef['casing']>): void {
    const s = this.shooter;
    const at = s.muzzle(this.muzzleAt);
    const right = this.v.crossVectors(s.forward, UP).normalize();
    const port = this.w.copy(at).addScaledVector(s.forward, -0.35);
    this.ctx.fx.shellCasing(port, right.multiplyScalar(2.6).addScaledVector(UP, 2.4).add(s.velocity), kind);
    WATCHED.casings++;
  }

  private layers(layers: readonly SoundLayer[]): void {
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!;
      this.say(l.id, (l.volume ?? 1) * REPORT, l.pitch ?? 1, 0, l.pitchJitter ?? 0);
    }
  }

  /** A sound of theirs, from their muzzle: placed and faded by distance as any sound in the world. */
  private say(id: string, volume = 1, pitch = 1, delay = 0, pitchJitter = 0): void {
    const o = this.heard;
    o.position = this.muzzleAt;
    o.volume = volume;
    o.pitch = pitch;
    o.pitchJitter = pitchJitter;
    o.delay = delay > 0 ? delay : undefined;
    this.ctx.audio.play(id, o);
    WATCHED.sounds++;
  }

  /** The rotary cannon has no report a round: its barrage is a loop, heard from their gun while the rounds keep coming. */
  private rattle(def: WeaponDef): void {
    this.barragePitch = def.loopPitch ?? 1;
    this.barrageLeft = BARRAGE_GAP;
    if (this.barrage) return;
    this.barrage = this.ctx.audio.startLoop?.('minigun_fire_loop', { position: this.muzzleAt, volume: REPORT, pitch: this.barragePitch }) ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // The Lance
  // -------------------------------------------------------------------------------------------

  private lance(): Lance {
    return this.puppet ??= new Lance(this.ctx, this.lanceHost(), this.shooter);
  }

  /** What a friend's Lance needs of an arsenal: nothing of a cell or a trigger, and a shot's beats as a watcher gets them. */
  private lanceHost(): LanceHost {
    const projectile: ProjectileSpec = { origin: new THREE.Vector3(), velocity: new THREE.Vector3(), kind: 'plasma', team: 'player', damage: 0, source: 'lance', cosmetic: true };
    return {
      modifiers: PLAIN,
      muzzleAt: this.muzzleAt,
      canShoot: () => true,
      consume: () => {},
      takePress: () => false,
      dry: () => {},
      feedback: def => this.feedback(def, false, 0),
      shot: (def, damage) => fillShot(this.shot, def, damage, PLAIN, this.muzzleAt),
      projectile: () => projectile,
      interval: def => def.interval,
    };
  }

  private lanceShot(shot: LanceShot): void {
    const w = WATCHED;
    if (shot === 'rail') w.rails++;
    else if (shot === 'beam') w.beams++;
    else if (shot === 'ball') w.balls++;
    else w.giants++;
    this.lance().replay(shot);
  }

  // -------------------------------------------------------------------------------------------
  // Projectiles
  // -------------------------------------------------------------------------------------------

  /**
   * A round of theirs in flight: this screen's own copy, from their gun, flying, trailing, sticking and bursting as theirs
   * does and hurting nothing. `spec` is the caller's scratch, filled from the wire.
   */
  launch(spec: ProjectileSpec): void {
    const s = this.shooter;
    const thrown = spec.source === 'grenade';
    // Their own number for it, under their seat, so no two friends' rounds share one.
    spec.tag = spec.tag ? (s.seat << 16) | spec.tag : 0;
    spec.cosmetic = true;
    spec.team = 'player';
    // It leaves their gun and slides onto its true line, as the shooter's own does. A grenade leaves the hand.
    spec.visualFrom = thrown ? undefined : s.muzzle(this.muzzleAt);
    spec.laser = spec.wired ? this.laser : undefined;
    if (thrown) {
      s.muzzle(this.muzzleAt);
      this.say('grenade_throw');
      s.gesture('throw');
    }
    this.combat.spawnProjectile(spec);
    WATCHED.projectiles++;
  }

  // -------------------------------------------------------------------------------------------
  // The Kiln
  // -------------------------------------------------------------------------------------------

  /** Their Kiln or Autoclave is on: it starts if it was not, and streams from their nozzle down their aim until they say it stopped. */
  private pour(weapon: WeaponId): void {
    WATCHED.hose++;
    if (this.hoseLeft <= 0 || this.hoseWeapon !== weapon) {
      this.hoseLoop?.stop(0.08);
      this.hoseWeapon = weapon;
      this.shooter.muzzle(this.muzzleAt);
      if (weapon === 'autoclave') {
        this.hoseLoop = this.ctx.audio.startLoop?.('railgun_charge_loop', { position: this.muzzleAt, volume: REPORT * 0.65, pitch: 0.9 }) ?? null;
      } else {
        this.say('flame_ignite');
        this.hoseLoop = this.ctx.audio.startLoop?.('flame_hose_loop', { position: this.muzzleAt, volume: REPORT }) ?? null;
        this.hoseOwed = FRIEND_EVERY;
      }
    }
    this.hoseLeft = HOSE_HOLD;
  }

  private stopPour(): void {
    if (this.hoseLeft <= 0 && !this.hoseLoop) return;
    this.hoseLeft = 0;
    this.hoseLoop?.stop(0.1);
    this.hoseLoop = null;
    if (this.hoseWeapon !== 'autoclave') {
      this.shooter.muzzle(this.muzzleAt);
      this.say('flame_stop');
    }
  }

  /** A frame of their stream: Autoclave heat shimmer cone, or Kiln napalm globs (Flames.friendGlob) that burn nobody. */
  private stream(dt: number): void {
    const s = this.shooter;
    this.hoseLeft -= dt;
    if (this.hoseLeft <= 0) {
      this.stopPour();
      return;
    }
    const nozzle = s.muzzle(this.muzzleAt);
    this.hoseLoop?.setPosition(nozzle);
    if (this.hoseWeapon === 'autoclave') {
      (this.microwave ??= new Microwave(this.ctx)).emitShimmer(nozzle, s.forward, dt);
      return;
    }
    const k = TUNING.napalm;
    this.hoseOwed += dt;
    while (this.hoseOwed >= FRIEND_EVERY) {
      this.hoseOwed -= FRIEND_EVERY;
      // As the shooter's own glob leaves: from the eye line, at the stream's speed, with most of their own motion.
      this.glob.copy(s.eye).addScaledVector(s.forward, 0.25);
      this.speed.copy(s.forward).multiplyScalar(k.speed).addScaledVector(s.velocity, 0.6);
      this.combat.flames.friendGlob(s.seat, this.glob, this.speed, nozzle);
      WATCHED.globs++;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Melee
  // -------------------------------------------------------------------------------------------

  /** Their swing begins: the clip on their body and the swing's own sound from them; the energy blade's zap over it. */
  private swing(note: FireNote): void {
    const s = this.shooter;
    const told = note.swing;
    WATCHED.swings++;
    s.muzzle(this.muzzleAt);
    s.gesture(told?.heavy ? 'heavy' : 'swing');
    if (!told) return;
    if (told.sound && lookup(told.sound)) this.say(told.sound, 1, told.pitch, 0, 0.05);
    if (told.energy) this.say('lance_plasma', 0.35, 1.35, 0, 0.08);
  }

  /** Something their swing drew in the air (MeleeFx): the same crescent, ring, streaks or slam, where their game drew it. */
  meleeFx(e: MeleeFx): void {
    const { fx } = this.ctx;
    WATCHED.meleeFx++;
    switch (e.kind) {
      case 'slash':
        if (!SLASHES.includes(e.look as SlashKind)) return;
        WATCHED.slashes++;
        fx.slash(e.a, e.b, e.c, e.x, e.y, e.look as SlashKind);
        break;
      case 'ring':
        fx.ring(e.a, e.b, e.x, e.y);
        break;
      case 'streaks':
        fx.dashStreaks(e.a, e.b);
        break;
      case 'slam':
        fx.slam(e.a, e.x);
        fx.sparks(e.a, UP, 22, 0xfff2cc);
        this.ctx.render.decals.add('slash', e.a, UP, 2.2, Math.atan2(e.b.x, e.b.z));
        this.muzzleAt.copy(e.a);
        this.say('katana_cleave_land', 1, 1, 0, 0.05);
        break;
      case 'sound':
        if (!lookup(e.look)) return;
        this.shooter.muzzle(this.muzzleAt);
        this.say(e.look, 1, e.x || 1, 0, 0.04);
        break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // What their pose says they are doing
  // -------------------------------------------------------------------------------------------

  /**
   * Their pose's word on what they are doing with the gun, every frame: a reload or a stim that has just begun is a gesture
   * and its sound; the rocket's laser is drawn while it is up (and their wired rockets steer for its dot); a Lance charge
   * pulls its slivers and arcs into their muzzle.
   */
  doing(now: Doing, dt: number): void {
    const { fx, physics, enemies } = this.ctx;
    const s = this.shooter;
    const was = this.was;
    if (now.reload && !was.reload) {
      WATCHED.reloads++;
      s.muzzle(this.muzzleAt);
      s.gesture('reload');
      // The gun's own reload cues, heard from them at the times its reload plays them.
      for (const [at, id] of this.def.reloadFoley) this.say(id, REPORT, 1, Math.max(0.001, at));
    }
    if (now.stim && !was.stim) {
      WATCHED.stims++;
      s.muzzle(this.muzzleAt);
      s.gesture('stim');
      this.say('stim_click', REPORT);
      this.say('stim_hiss', REPORT, 1, 0.45);
    }
    const laser = this.laser;
    laser.on = now.laser && this.def.laser === true;
    if (laser.on) {
      if (!was.laser) {
        WATCHED.lasers++;
        s.muzzle(this.muzzleAt);
        this.say('rocket_laser', REPORT, 1.15);
      }
      let reach: number = TUNING.rocket.laserRange;
      const wall = physics.raycast(s.eye, s.forward, reach, CG.World);
      if (wall) reach = wall.distance;
      const body = enemies.raycast(s.eye, s.forward, reach);
      if (body) reach = body.distance;
      laser.at.copy(s.eye).addScaledVector(s.forward, Math.max(0, reach - 0.04));
      fx.beam(s.muzzle(this.muzzleAt), laser.at, 'laser');
    }
    if (now.charge) {
      // As the shooter's own charge draws it (lance.ts `charge`), at a middling level: how full it is is not sent.
      const k = TUNING.lance.inhale;
      const color = now.ball ? 0x5dff8a : 0xa8ecff;
      const muzzle = s.muzzle(this.muzzleAt);
      this.inhaleOwed += k.rate * 0.5 * dt;
      const n = Math.floor(this.inhaleOwed);
      if (n > 0) {
        this.inhaleOwed -= n;
        fx.inhale?.(muzzle, k.reach * 0.75, n, color);
      }
      if (!was.charge) {
        this.lance().prime();
        this.hum = this.ctx.audio.startLoop?.('railgun_charge_loop', { position: muzzle, volume: 0.5, pitch: 0.7 }) ?? null;
      }
      this.hum?.setPosition(muzzle);
    } else if (was.charge) {
      this.hum?.stop(0.06);
      this.hum = null;
    }
    was.reload = now.reload;
    was.stim = now.stim;
    was.laser = now.laser;
    was.charge = now.charge;
    was.ball = now.ball;
    this.light();
    this.blade(dt);
  }

  /** The energy blade in their hand: its hum from them, and its light on what is near. */
  private blade(dt: number): void {
    const out = this.weapon === 'sword' && this.mods.has('swordEnergy');
    if (!out) {
      this.bladeHum?.stop(0.15);
      this.bladeHum = null;
      return;
    }
    const at = this.shooter.muzzle(this.muzzleAt);
    const H = ENERGY.hum;
    if (!this.bladeHum?.alive) this.bladeHum = this.ctx.audio.startLoop?.(H.id, { position: at, volume: H.volume * 2.5, pitch: H.rest, fadeIn: 0.25 }) ?? null;
    this.bladeHum?.setPosition(at);
    this.glintIn -= dt;
    if (this.glintIn > 0) return;
    this.glintIn = 0.12;
    this.ctx.render.lights.flash(at, 0x8fe6ff, 2.2, 4.5, 0.16);
  }

  private inhaleOwed = 0;
  private hum: LoopHandle | null = null;

  /** Their weapon light: on while the gun in their hands has one fitted, from its muzzle down their aim. */
  private light(): void {
    const t = this.torch;
    if (!t) return;
    const on = this.mods.has(`${this.weapon}Light` as ModId);
    if (on && t.intensity === 0) WATCHED.lights++;
    t.intensity = on ? FRIEND_TORCH.candela : 0;
    if (!on) return;
    const s = this.shooter;
    s.muzzle(t.position);
    t.target.position.copy(s.eye).addScaledVector(s.forward, 20);
    t.updateMatrixWorld();
    t.target.updateMatrixWorld();
  }

  /** Their body is not on this screen (no word from them lately): what follows the body goes dark and quiet. */
  away(): void {
    this.laser.on = false;
    if (this.torch) this.torch.intensity = 0;
    this.hum?.stop(0.06);
    this.hum = null;
    this.bladeHum?.stop(0.15);
    this.bladeHum = null;
    const was = this.was;
    was.reload = was.stim = was.laser = was.charge = was.ball = false;
  }

  /** True while their weapon light is lit, their Kiln pours, and their laser is up: for tests and the proofs. */
  get lit(): boolean {
    return (this.torch?.intensity ?? 0) > 0;
  }

  get pouring(): boolean {
    return this.hoseLeft > 0;
  }

  /** Their own round `id` went off at `at` on their screen: this screen's copy of it ends there. */
  landed(id: number, at: THREE.Vector3): void {
    this.combat.projectiles.land((this.shooter.seat << 16) | id, at);
  }

  /** Something of theirs that lasts ended: the beam, the giant ball (where it went off), the Kiln's stream. */
  loop(kind: 'beam' | 'giant' | 'hose' | 'spin' | 'whine', at: THREE.Vector3 | null, normal: THREE.Vector3 | null, on = false): void {
    if (kind === 'whine') {
      // The rotary cannon's barrels: their spin-up as they begin to turn, their run-down as they stop, from the gun.
      WATCHED.whines++;
      this.shooter.muzzle(this.muzzleAt);
      this.say(on ? 'minigun_spinup' : 'minigun_spindown', REPORT);
      return;
    }
    if (kind === 'hose') this.stopPour();
    else if (kind === 'spin') this.barrageLeft = Math.min(this.barrageLeft, 0.001);
    else if (kind === 'beam') {
      WATCHED.beamStops++;
      this.puppet?.stop();
    } else if (kind === 'giant' && at) {
      WATCHED.giantLands++;
      this.puppet?.land(at, normal);
    }
  }

  /** True while their beam pours, and their giant ball if one is flying: for tests and the proofs. */
  get beaming(): boolean {
    return this.puppet?.beaming ?? false;
  }

  get giantAt(): THREE.Vector3 | null {
    return this.puppet?.giantAt ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  /** Every frame their body is drawn, after it has been placed: what of theirs is still going goes on. */
  update(dt: number): void {
    this.puppet?.tick();
    if (this.hoseLeft > 0) this.stream(this.ctx.time.dt);
    if (this.harpoon && (this.harpoon.active || this.harpoon.embeddedCount > 0)) {
      const s = this.shooter;
      this.harpoon.update(this.ctx.time.dt, false, false, s.muzzle(this.muzzleAt), s.eye, s.forward);
    }
    if (this.casingIn > 0 && (this.casingIn -= this.ctx.time.dt) <= 0) this.eject(this.casingKind);
    if (this.barrage) {
      this.barrageLeft -= dt;
      this.barrage.setPosition(this.shooter.muzzle(this.muzzleAt));
      if (this.barrageLeft <= 0) {
        this.barrage.stop(0.06);
        this.barrage = null;
        this.say('minigun_fire', REPORT, this.barragePitch);
      }
    }
  }

  dispose(): void {
    this.puppet?.dispose();
    this.puppet = null;
    this.harpoon?.dispose();
    this.harpoon = null;
    this.microwave?.reset();
    this.microwave = null;
    this.barrage?.stop(0.05);
    this.barrage = null;
    this.hoseLoop?.stop(0.05);
    this.hoseLoop = null;
    this.hum?.stop(0.05);
    this.hum = null;
    this.bladeHum?.stop(0.05);
    this.bladeHum = null;
    if (this.torch) this.torch.intensity = 0;
    this.torch = null;
  }
}

/** The note of a shot that says nothing more than "one round down the aim": what an old or bare `fire` event means. */
export function plainNote(note: FireNote, kind: FireKind = 'gun'): FireNote {
  note.kind = kind;
  note.left = false;
  note.barrel = 0;
  note.rays = 0;
  note.cone = note.seed = 0;
  note.alt = note.aimed = false;
  return note;
}

/** Seconds of TUNING the proofs read. */
export const WATCH_TUNING = { beamSeconds: TUNING.lance.beam.seconds, giantLife: TUNING.lance.giant.life };
