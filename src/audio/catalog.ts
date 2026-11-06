/**
 * Every sound id in the game. docs/notes/audio.md publishes this list, and a test keeps the two equal.
 *
 * Sample volumes come from the first game: its configured value times its 0.5 master. They are kept
 * as ratios, because "the loudest things are the rewards" was that mix's main idea.
 */
import type { SoundLayer } from '../core/contracts';
import { MIX, type MixClass, type MixProfile } from './mix';
import type { Recipe } from './synth/recipe';
import { weapons } from './synth/recipes/weapons';
import { bodies, impacts } from './synth/recipes/impacts';
import { player } from './synth/recipes/player';
import { enemyGear, voices } from './synth/recipes/enemies';
import { callIns, perks, pickups, powerups, progress, ui } from './synth/recipes/rewards';
import { world } from './synth/recipes/world';

export type SoundKind = 'sample' | 'synth' | 'group' | 'stack';

export interface SoundDef extends MixProfile {
  id: string;
  kind: SoundKind;
  loop: boolean;
  /** Sample file, relative to public/audio/sfx. */
  file?: string;
  /** Sample variants behind one id, measured and matched to the mix at load as synth variants are. */
  files?: readonly string[];
  /** Played instead if the samples are missing or have not landed. */
  fallback?: string;
  recipe?: Recipe;
  /** Group: one of these at random. */
  members?: readonly string[];
  /** Stack: all of these on the same audio frame. */
  layers?: readonly SoundLayer[];
}

/** Lifts the first game's levels to use the headroom a 1.0 master gives. */
const SAMPLE_TRIM = 1.5;

function sample(file: string, mix: MixClass, effective: number, over: Partial<MixProfile> = {}): SoundDef {
  return {
    ...MIX[mix],
    ...over,
    volume: effective * SAMPLE_TRIM,
    id: file.replace(/\.[a-z0-9]+$/, ''),
    kind: 'sample',
    loop: false,
    file,
  };
}

/** Combat and gore both react to a head kill, so `perFrame` is what keeps one kill from stacking twice. */
const HEADSHOT_LAYER: Partial<MixProfile> = { priority: 8, critical: true, maxVoices: 3, perFrame: 1, family: undefined, pitchJitter: 0.03, near: 12, far: 160 };

/** The first game's sounds never varied in pitch. A little jitter is the cheapest fix for machine-gun repetition. */
const samples: SoundDef[] = [
  // Doc 07: four voices cut at 20 Hz is where the SMG's stutter comes from. Keep it.
  sample('smg_fire.mp3', 'gun', 0.15, { maxVoices: 4 }),
  sample('shotgun_fire.mp3', 'gun', 0.16, { send: 0.2 }),
  sample('rocket_fire.mp3', 'gun', 0.2, { near: 10, far: 160, send: 0.2 }),
  sample('autocannon_fire.mp3', 'gun', 0.525, { send: 0.22 }),
  sample('autocannon_fire2.wav', 'gun', 0.395, { send: 0.22 }),
  sample('autocannon_zoom.wav', 'foley', 0.35),
  sample('smg_reload.mp3', 'foley', 0.2),
  sample('sword_swing.mp3', 'player', 0.25, { priority: 7, critical: true, maxVoices: 4 }),
  sample('sword_hit1.mp3', 'gore', 0.3, { perFrame: 3, family: undefined, near: 6 }),
  sample('sword_hit2.mp3', 'gore', 0.3, { perFrame: 3, family: undefined, near: 6 }),
  sample('sword_slam.mp3', 'gun', 0.35),

  // Buff layers. Over a third of the SMG's level again, so a buffed gun is a different gun.
  sample('bloodthirsty_shot.mp3', 'gun', 0.5, { maxVoices: 3 }),
  sample('berserk_shot.mp3', 'gun', 0.35, { maxVoices: 3 }),
  sample('hellfire_shot.mp3', 'gun', 0.3, { maxVoices: 3 }),

  sample('rocket_explosion.mp3', 'blast', 0.25, { pitchJitter: 0.05 }),
  sample('hellfirebullet_explode.mp3', 'blastSmall', 0.25, { maxVoices: 4, perFrame: 2 }),
  sample('hellfirerocket_explode.mp3', 'blast', 0.7, { priority: 10, maxVoices: 3, duck: [0.55, 1.5] }),
  // Doc 05: the shell cascade's BRRRT is voices being cut at 20 Hz. Four voices, oldest out.
  sample('30mmshell_explode.mp3', 'blast', 0.8, { maxVoices: 4, perFrame: 1, pitchJitter: 0.04, duck: [0.25, 0.3] }),
  sample('enemy_explode.mp3', 'blastSmall', 0.25, { maxVoices: 3 }),

  sample('bullet_hit1.mp3', 'impact', 0.15),
  sample('bullet_hit2.mp3', 'impact', 0.15),
  sample('bulltet_hit3.mp3', 'impact', 0.15),
  sample('bullet_hit4.mp3', 'impact', 0.15),
  sample('bullet_whizz.mp3', 'enemyFx', 0.2, { maxVoices: 3, near: 6, far: 18, send: 0.02, pitchJitter: 0.1 }),
  sample('30mmShell_flyBy.mp3', 'enemyFx', 0.25, { maxVoices: 4, near: 20, far: 200, send: 0.1 }),

  sample('enemy_hit.mp3', 'gore', 0.2, { maxVoices: 4, perFrame: 2 }),
  sample('enemy_grunt.mp3', 'voice', 0.2),
  sample('enemy_die.mp3', 'voice', 0.25, { priority: 4, maxVoices: 4, perFrame: 2 }),
  sample('enemy_deathgrunt.mp3', 'voice', 0.25, { priority: 4 }),
  sample('enemy_headshot.mp3', 'gore', 0.375, HEADSHOT_LAYER),
  sample('enemy_headshot2.mp3', 'gore', 0.281, HEADSHOT_LAYER),
  // Opens with dead silence, which the first game skipped with a hard 1.0 s start offset. The load-time trim does
  // that job here, for every caller. The sound really begins at 0.80 s, so the old skip also lost the attack
  // (0.71 peak, cut down to 0.46). Do not pass `offset` to this id: the trimmed buffer starts on the attack.
  sample('enemy_headshot3.mp3', 'gore', 0.375, { ...HEADSHOT_LAYER, maxVoices: 2 }),
  sample('enemy_shoot.mp3', 'enemyGun', 0.075),

  sample('walkietalkie_fire.mp3', 'stinger', 0.35, { duck: undefined }),
  sample('airstrike_activate.mp3', 'stinger', 0.5, { duck: [0.3, 2] }),
  sample('warthog_flyby.wav', 'blast', 0.8, { near: 80, far: 900, airDelay: false, duck: [0.5, 5], maxVoices: 2, pitchJitter: 0, exempt: false }),

  sample('perk_bloodthirsty.mp3', 'stinger', 0.35),
  sample('perk_hellfire.mp3', 'stinger', 0.4),
  sample('perk_berserk1.mp3', 'stinger', 0.4),
  sample('perk_berserk2.mp3', 'stinger', 0.6),
  sample('perk_berserk3.mp3', 'stinger', 0.4),
  sample('perk_adrenaline.mp3', 'stinger', 0.35),
  // The first game meant this to stay at full rate and overwrote its own exemption one line later.
  sample('perk_slowmo.mp3', 'stinger', 0.4, { exempt: true }),
  sample('perk_airstrike.mp3', 'stinger', 0.4),

  sample('player_footstep1.mp3', 'step', 0.1),
  sample('player_footstep2.mp3', 'step', 0.1),
  sample('player_footstep3.mp3', 'step', 0.1),
  sample('player_jump.mp3', 'player', 0.15),
  sample('player_land.mp3', 'player', 0.15),
  sample('slide_ground.mp3', 'player', 0.25),
  sample('menu_select.wav', 'ui', 0.35),

  // In the assets but never referenced by the first game. Kept so nothing is lost.
  sample('222.mp3', 'enemyFx', 0.3),
  sample('3333.mp3', 'enemyFx', 0.3),
  sample('asdf.mp3', 'enemyFx', 0.3),
  sample('frfff.mp3', 'enemyFx', 0.3),
];

/** Sample packs from docs/CREDITS.md. Each id is `count` numbered files in sfx/gore. */
function pack(id: string, count: number, fallback: string, volume: number, over: Partial<MixProfile> = {}): SoundDef {
  return {
    ...MIX.flesh, ...over, volume, id, kind: 'sample', loop: false, fallback,
    files: Array.from({ length: count }, (_, i) => `gore/${id}_${i + 1}.mp3`),
  };
}

/** Volumes sit these against the synth gore around them: 0.42 is `body_thud`, 0.72 is `limb_sever`. */
const packs: SoundDef[] = [
  pack('body_fall_concrete', 5, 'body_thud', 0.5),
  pack('body_fall_metal', 5, 'body_thud', 0.5, { send: 0.1 }),
  pack('limb_thud', 5, 'gib_land', 0.36),
  pack('head_thud', 4, 'body_thud', 0.42),
  pack('wet_slap', 5, 'gib_land', 0.38),
  pack('organ_splat', 5, 'gib_squelch', 0.46),
  pack('flesh_slosh', 4, 'gib_squelch', 0.3, { maxVoices: 2 }),
  pack('wet_squelch', 4, 'gib_squelch', 0.34),
  pack('bone_snap', 4, 'bone_crack', 0.52, { priority: 5, family: 'gore', familyMax: 10, near: 6, far: 70 }),
  pack('flesh_tear', 4, 'limb_sever', 0.6, { priority: 5, family: 'gore', familyMax: 10, near: 6, far: 70 }),
  pack('blood_drip', 4, 'blood_spurt', 0.2, { near: 3, far: 25 }),
  pack('blood_splatter', 4, 'blood_splat', 0.36, { priority: 4 }),
  pack('body_drag', 3, 'body_scrape', 0.24, { maxVoices: 2, near: 3, far: 30 }),
  pack('bullet_body', 6, 'blood_splat', 0.42, { maxVoices: 4, priority: 4 }),
  pack('sword_flesh', 3, 'limb_sever', 0.6, { priority: 6, family: 'gore', familyMax: 10, near: 6, far: 70 }),
  // These run up to 2 s, so a pile of bodies must not stack them.
  pack('blood_spill', 3, 'blood_spurt', 0.4, { maxVoices: 2, priority: 4 }),
];

function group(id: string, members: readonly string[]): SoundDef {
  return { ...MIX.impact, id, kind: 'group', loop: false, members };
}

const groups: SoundDef[] = [
  group('bullet_hit', ['bullet_hit1', 'bullet_hit2', 'bulltet_hit3', 'bullet_hit4']),
  group('sword_hit', ['sword_hit1', 'sword_hit2']),
  group('player_footstep', ['player_footstep1', 'player_footstep2', 'player_footstep3']),
];

function stack(id: string, layers: readonly SoundLayer[]): SoundDef {
  return { ...MIX.impact, id, kind: 'stack', loop: false, layers };
}

const stacks: SoundDef[] = [
  // Levels are in the sample table: 0.75 / 0.5625 / 0.75. See enemy_headshot3 there for its silence.
  stack('headshot', [
    { id: 'enemy_headshot' },
    { id: 'enemy_headshot2' },
    { id: 'enemy_headshot3' },
  ]),
  stack('autocannon_shot', [
    { id: 'autocannon_fire', duration: 0.5 },
    { id: 'autocannon_fire2' },
  ]),
  stack('hellfire_rocket_blast', [{ id: 'rocket_explosion' }, { id: 'hellfirerocket_explode' }]),
  stack('sword_contact', [{ id: 'sword_flesh' }]),
  stack('perk_berserk', [{ id: 'perk_berserk1' }, { id: 'perk_berserk2' }, { id: 'perk_berserk3' }]),
];

const recipes: Recipe[] = [
  ...weapons, ...impacts, ...bodies, ...player, ...voices, ...enemyGear, ...perks, ...callIns, ...powerups,
  ...pickups, ...progress, ...ui, ...world,
];

function synth(recipe: Recipe): SoundDef {
  return { ...MIX[recipe.mix], ...recipe.over, id: recipe.id, kind: 'synth', loop: recipe.loop, recipe };
}

/** The first game's keys and the string-built forms, so `impact_${surface}` style calls just work. */
const aliases: Record<string, string> = {
  shoot: 'smg_fire', shotgun: 'shotgun_fire', rocket: 'rocket_fire', reload: 'smg_reload',
  swordSwing: 'sword_swing', swordHit1: 'sword_hit1', swordHit2: 'sword_hit2', swordSlam: 'sword_slam',
  bloodthirstyShot: 'bloodthirsty_shot', berserkShot: 'berserk_shot', hellfireShot: 'hellfire_shot',
  rocketExplosion: 'rocket_explosion', hellfireBulletExplode: 'hellfirebullet_explode', hellfireRocketExplode: 'hellfirerocket_explode',
  enemyExplode: 'enemy_explode', bullet_hit3: 'bulltet_hit3', bulletHit: 'bullet_hit',
  bulletHit1: 'bullet_hit1', bulletHit2: 'bullet_hit2', bulletHit3: 'bulltet_hit3', bulletHit4: 'bullet_hit4',
  '30mmshell_flyby': '30mmShell_flyBy', bulletWhizz: 'bullet_whizz',
  enemyHit: 'enemy_hit', playerHit: 'enemy_hit', enemyGrunt: 'enemy_grunt', enemyDie: 'enemy_die', enemyDeathGrunt: 'enemy_deathgrunt',
  enemyHeadshot: 'enemy_headshot', enemyHeadshot2: 'enemy_headshot2', enemyHeadshot3: 'enemy_headshot3', enemyShoot: 'enemy_shoot',
  walkieTalkieFire: 'walkietalkie_fire', airstrikeActivate: 'airstrike_activate',
  perkBloodthirsty: 'perk_bloodthirsty', perkHellfire: 'perk_hellfire', perkAdrenaline: 'perk_adrenaline',
  perkBerserk1: 'perk_berserk1', perkBerserk2: 'perk_berserk2', perkBerserk3: 'perk_berserk3',
  perkSlowmo: 'perk_slowmo', perkAirstrike: 'perk_airstrike',
  perk_bloodthirst: 'perk_bloodthirsty', pickup: 'pickup_generic', footstep: 'player_footstep',
  // Every SurfaceKind can be underfoot. These three have no step of their own.
  footstep_armor: 'footstep_metal', footstep_energy: 'footstep_metal', footstep_lava: 'footstep_dirt',
  pickup_quad: 'powerup_quad', pickup_haste: 'powerup_haste', pickup_vampire: 'powerup_vampire',
  pickup_ricochet: 'powerup_ricochet', pickup_shock: 'powerup_shock', pickup_ghost: 'powerup_ghost',
  pickup_magnet: 'powerup_magnet', pickup_regen: 'powerup_regen', pickup_frostNova: 'powerup_frostNova',
  pickup_timeWarp: 'powerup_timeWarp',
};

export const CATALOG: ReadonlyMap<string, SoundDef> = new Map(
  [...samples, ...packs, ...groups, ...stacks, ...recipes.map(synth)].map(def => [def.id, def]),
);

export const ALIASES: Readonly<Record<string, string>> = aliases;

export function lookup(id: string): SoundDef | undefined {
  return CATALOG.get(ALIASES[id] ?? id);
}

/** Render order, by what a run reaches first. Whatever matches none of these can wait for the rest. */
const RENDER_TIERS: readonly RegExp[] = [
  // Menu, the first fight, and moving around in it.
  /^(ui_|hit_marker|wave_|footstep_|impact_|ricochet|casing_|weapon_|reload_|dash|double_jump|wall_kick|slide_|wallrun_|slam_|mantle|land_hard|jump_pad$|speed_wind|amb_)/,
  // The first kills: gore, enemy voices, and what a player feels getting hurt or picking something up.
  /^(limb_|bone_|gib_|blood_|head_pop|body_|flesh_|vox_(grunt|pain|death|husk|radio)|enemy_|player_|heartbeat|low_health|armor_|heal_|pickup_|combo_|multikill|style_|grenade_|bullet_)/,
  // The first streaks and the first weapon cache.
  /^(perk_|powerup_|callin_|cache_|missile_|explosion_|vox_|revolver_|stake_|flame_|minigun_|railgun_|sword_|sentinel_|lightning_)/,
];

/** Lower renders sooner. Every id's first variant comes before any id's spares in the same tier. */
export function renderRank(def: SoundDef, variant: number): number {
  let tier = RENDER_TIERS.findIndex(pattern => pattern.test(def.id));
  if (tier < 0) tier = RENDER_TIERS.length;
  return tier * 2 + (variant > 0 ? 1 : 0);
}

export function synthCount(): number {
  return [...CATALOG.values()].reduce((n, d) => n + (d.kind === 'synth' ? 1 : 0), 0);
}

export function sampleDefs(): SoundDef[] {
  return [...CATALOG.values()].filter(d => d.kind === 'sample');
}
