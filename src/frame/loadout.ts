/**
 * The Distraint Frame's modular loadout (`src/frame/loadout.ts`): built from parts, one per slot.
 *
 *   leftArm, rightArm   arm weapon each side (LMB fires left, RMB fires right; 1 / 2 cycles each arm's mode/rounds)
 *   shoulder            as many as the chassis allows (`cockpit.shoulders`, up to 3: G, V, B fire; 3, 4, 5 cycle rounds)
 *   legs                how it walks, glides, drifts, or climbs (gait plug-in + leg stats)
 *   cockpit             full chassis / core silhouette, shoulder count, canopy armour, and core traits
 *   head                sculpted head / sensor crown (tracking, thermal vision, lock range, head armour)
 *   engine              how it travels (drive plug-in + speed, dash, fuel, redline/assault traits)
 *   expansion           Core Expansion on `Q` (Smoke & Flares, Breacher Nova, Aegis Barrier, Bunker Dome, Last-Stand Fuse)
 *   paint               livery & thruster flame palette (+ optional 4-swatch `customPaint` override)
 *
 * The default reproduces the original Distraint Frame with every multiplier at 1 and every special flag off.
 * On the co-op wire, `kitIds` appends the new slots after the original 8 so 7-number and 8-number legacy poses still decode.
 *
 * Pure: no three.js, no DOM beyond localStorage. Tested in loadout.test.ts.
 */
import type { CustomFrameColors, PaintKind } from './models/palette';

export type { CustomFrameColors, PaintKind } from './models/palette';

export type FrameSlot =
  | 'leftArm'
  | 'rightArm'
  | 'shoulder'
  | 'legs'
  | 'cockpit'
  | 'head'
  | 'engine'
  | 'expansion'
  | 'paint';
export type ArmSide = 'left' | 'right';

/** What an arm carries (`src/frame/arms/`). */
export type ArmKind =
  | 'rotary' | 'cannon40' | 'howitzer105' | 'vulcan30' | 'beam' | 'cluster' | 'shotgun'
  | 'grenade' | 'sword' | 'bunker' | 'flamer' | 'plasma' | 'rail' | 'shield';

/** What a shoulder mount carries (`src/frame/shoulders/`). */
export type ShoulderKind =
  | 'pod6' | 'storm' | 'mirv' | 'wire' | 'mortar' | 'fpv' | 'pointdef' | 'flares'
  | 'twinGrenade' | 'laserOrbit' | 'arcNeedle' | 'plasmaMissiles' | 'shoulderGatling';

/** Movement gait plug-in (`src/frame/move/gait/`). */
export type GaitKind =
  | 'walker' | 'sprinter' | 'heavy' | 'treads' | 'spider'
  | 'hover' | 'wheels' | 'aeroQuad';

/** Travel drive plug-in (`src/frame/move/drive/`). */
export type DriveKind =
  | 'jets' | 'flight' | 'hover' | 'afterburner' | 'overcharge' | 'diesel'
  | 'blink' | 'redline' | 'assault';

/** Head / sensor crown visual & perk (`src/frame/models/heads/`). */
export type HeadKind = 'standard' | 'duelist' | 'cyclops' | 'stealth' | 'bunker' | 'halo';

/** Core Expansion on Q (`src/frame/expansions/`). */
export type ExpansionKind = 'smoke' | 'nova' | 'aegis' | 'dome' | 'terminal';

/** How the legs move it. Every multiplier is relative to the standard Frame (`FRAME` in data.ts). */
export interface LegStats {
  walk: number;
  jump: number;
  stomp: number;
  stompPower?: number;
  gait: GaitKind;
  legArmor?: number;
  hullScale?: number;
  strafe?: number;
  turnRate?: number;
  noRecoil?: boolean;
  noSway?: boolean;
  immuneKnockback?: boolean;
  legSweep?: boolean;
  crushOnDrive?: boolean;
  /** Repulsor hover height in metres (Mag-Skiff Hover Hull = 0.65). */
  hoverHeight?: number;
  /** Repulsor downward crush pulse on crouch instead of stomp. */
  repulsorPulse?: boolean;
  /** High-speed powerslide drift rig (Drift-Wheel Rig). */
  driftRig?: boolean;
  /** Mid-air splayed flat hover-glide (Aero-Quad Legs). */
  aeroHover?: boolean;
}

/** How the engine drives it. */
export interface EngineStats {
  speed: number;
  drive: DriveKind;
  dash: number;
  fuelScale?: number;
  airborneDamageMult?: number;
  /** Fuel regeneration multiplier (defaults to 1). */
  fuelRegenScale?: number;
  /** Redline Surge Reactor: draining fuel to 0% triggers instant 75% surge + energy weapon buff. */
  redlineSurge?: boolean;
  /** Assault-Ram Drive: hold Shift forward shielded rush + F Boost Kick. */
  assaultRam?: boolean;
  /** Blink-Step Booster: rapid omnidirectional Quick-Boost dodge. */
  blinkBoost?: boolean;
}

/** Full Chassis / Core silhouette and performance traits. */
export interface CockpitStats {
  shoulders: number;
  canopyScale?: number;
  hullScale?: number;
  openSeat?: boolean;
  sensorRange?: number;
  /** Core walk speed modifier (e.g. Kestrel = 1.12, Bastion = 0.9). */
  walkScale?: number;
  /** Core dash speed modifier (e.g. Kestrel = 1.15). */
  dashScale?: number;
  /** View recoil scale (e.g. Bastion = 0.6). */
  recoilScale?: number;
  /** Energy weapon charge & cooling rate multiplier (e.g. Valkyrie = 1.2). */
  energyChargeMult?: number;
  /** Jet/drive fuel regeneration multiplier (e.g. Chitin = 1.35). */
  fuelRegenScale?: number;
}

/** Head / Sensor Crown traits. */
export interface HeadStats {
  head: HeadKind;
  /** Arm gun tracking speed multiplier (e.g. V-Crest Duelist = 1.15). */
  armTrackMult?: number;
  /** Thermal wall-seeing enemy outline range in metres (Cyclops = 70). */
  sensorRange?: number;
  /** Shoulder missile / painter lock-on range & speed multiplier (Flat Stealth = 1.25). */
  lockRangeMult?: number;
  /** Canopy / head durability multiplier (Demolition Cage = 1.35). */
  canopyScale?: number;
  /** Status / canopy-crack resistance multiplier (Seraph Crown = 0.8). */
  crackDamageMult?: number;
}

/** Core Expansion (`Q` key) metadata. */
export interface ExpansionStats {
  expansion: ExpansionKind;
  charges: number;
  refill: number;
  passive?: boolean;
}

export interface FramePart {
  id: FramePartId;
  slot: FrameSlot;
  name: string;
  does: string;
  lore: string;
  side?: ArmSide;
  arm?: ArmKind;
  shoulder?: ShoulderKind;
  legs?: LegStats;
  engine?: EngineStats;
  cockpit?: CockpitStats;
  head?: HeadStats;
  expansion?: ExpansionStats;
  paint?: PaintKind;
}

/**
 * Append-only wire table. Index = id on the co-op wire (`kitIds`). Never insert, reorder or remove.
 */
export const FRAME_PART_ORDER = [
  // Original v1 indices 0..36 (LOCKED)
  'rotaryL', 'rotaryR', 'cannonL', 'cannonR', 'howitzerL', 'howitzerR', 'pod6', 'legsStandard', 'cockpitStandard', 'engineStandard',
  'vulcan30L', 'vulcan30R', 'beamL', 'beamR', 'clusterL', 'clusterR', 'shotgunL', 'shotgunR',
  'stormPod', 'mirv', 'wireBomb', 'mortarRack', 'fpvHive', 'pointDefence', 'flareRack',
  'legsSprinter', 'legsHeavy', 'legsTreads', 'legsSpider',
  'cockpitTwin', 'cockpitOpen', 'cockpitSensor',
  'engineJet', 'engineRotor', 'engineAfterburner', 'engineOvercharge', 'engineDiesel',

  // v2 Arm Weapons (indices 37..50)
  'grenadeL', 'grenadeR', 'swordL', 'swordR', 'bunkerL', 'bunkerR', 'flamerL', 'flamerR',
  'plasmaL', 'plasmaR', 'railL', 'railR', 'shieldL', 'shieldR',

  // v2 Shoulder Weapons (indices 51..55)
  'twinGrenade', 'laserOrbit', 'arcNeedle', 'plasmaMissiles', 'shoulderGatling',

  // v2 Legs (indices 56..58)
  'legsHover', 'legsWheels', 'legsAeroQuad',

  // v2 Full Chassis / Cores (indices 59..62)
  'chassisKestrel', 'chassisBastion', 'chassisValkyrie', 'chassisChitin',

  // v2 Engines (indices 63..65)
  'engineBlink', 'engineRedline', 'engineAssault',

  // v2 Heads (indices 66..71)
  'headStandard', 'headDuelist', 'headCyclops', 'headStealth', 'headBunker', 'headHalo',

  // v2 Core Expansions (indices 72..76)
  'expSmoke', 'expNova', 'expAegis', 'expDome', 'expTerminal',

  // v2 Paint Liveries (indices 77..86)
  'paintBureau', 'paintArctic', 'paintHazard', 'paintCrimson', 'paintDesert',
  'paintStealth', 'paintRust', 'paintCobalt', 'paintForest', 'paintChrome',
] as const;
export type FramePartId = (typeof FRAME_PART_ORDER)[number];

const ROTARY = {
  name: '20 mm Rotary',
  does: 'Six barrels, 24 rounds a second after a quarter-second spin. Overheats after about 6.7 s of fire. Tap 1 (left) or 2 (right) for airburst rounds.',
  lore: 'The Office measures enthusiasm in rounds per second. This arm is very enthusiastic.',
};
const CANNON = {
  name: '40 mm Autocannon',
  does: 'Ten shells a magazine, 0.28 s apart, 3.8 s to reload (R reloads early). Tap 1 (left) or 2 (right) to cycle high explosive, armour piercing and flak.',
  lore: 'Three kinds of shell, for the three kinds of problem the Council recognises.',
};
const HOWITZER = {
  name: '105 mm Howitzer',
  does: 'One shell at a time: a 15 m blast and a 22 m shockwave. 3.1 s to load the next.',
  lore: 'Field artillery, bolted to a forearm. Approved on the understanding that nobody stands in front of it.',
};
const VULCAN30 = {
  name: '30 mm Rotary Cannon',
  does: 'Three heavy barrels firing 24.5 explosive shells a second after a 0.35 s spin; overheats in ~5 s (2.5 s vent). Tap 1 (left) or 2 (right) to cycle HE, AP and flak.',
  lore: 'The compromise between the 20 mm and the 40 mm was to fire the 40 mm as fast as the 20 mm.',
};
const BEAM = {
  name: 'Red Beam',
  does: 'Hold 1.6 s to charge (walk slows to 60%), release for a 1.0 s, 1.4 m red beam out to 180 m through 3 walls. Vaporizes targets; 9 s cooldown.',
  lore: 'Listed under "surface preparation" in the ledger. Nothing left on the surface afterwards.',
};
const CLUSTER = {
  name: 'Bomblet Cannon',
  does: 'Single standoff shell (3.6 s reload): bursts 7 m short of the target and carpets a 14 m × 9 m patch with 28 rippling bomblets.',
  lore: 'For when the notice must be served to an entire courtyard at once.',
};
const SHOTGUN = {
  name: 'Mech Shotgun',
  does: 'Six-shell tube, 0.42 s semi-auto, 26 heavy pellets in a 5.5° spread with massive knockback. Shell-by-shell reload (0.45 s each, interrupted by firing).',
  lore: 'Scaled up until the recoil bracket needed its own chassis audit.',
};
const GRENADE = {
  name: '60 mm Grenade Launcher',
  does: 'Six-chamber revolving drum (0.55 s cadence, 3.2 s reload). Tap 1 (left) or 2 (right) to toggle High Explosive (7.5 m blast, 290 dmg) and Napalm (10 m burning pool carpet for 12 s).',
  lore: 'One drum for structural demolition, one drum for ensuring nobody returns to inspect the demolition.',
};
const SWORD = {
  name: 'Plasma Energy Sword',
  does: '3-hit slicing combo (9.5 m arc + forward booster lunge) that cuts enemies in half. Hold 0.85 s to charge: tap 1 (left) or 2 (right) for Wave Cleave (65 m slicing arc) or Impale Lunge (18 m jet skewer).',
  lore: 'Reclassified as an industrial brush-cutter to bypass the Council melee moratorium.',
};
const BUNKER = {
  name: 'Hydraulic Pile Bunker',
  does: 'Tap for a 4.5 m brutal piston shove (320 dmg). Hold 0.9 s and release to detonate a supersonic 6.5 m tungsten spike (900 dmg, launches vehicles & shatters bosses). 4.0 s reload.',
  lore: 'Originally a foundation-driving tool. Turns out tanks are mostly foundation.',
};
const FLAMER = {
  name: 'Heavy Incinerator',
  does: 'Twin-nozzle pressurized napalm hose out to 26 m: coats floors in burning pools, ignores low cover, and panics human squads (~7 s burn, 2.8 s vent).',
  lore: 'Issued by Sanitation & Enforcement under a shared budget code.',
};
const PLASMA = {
  name: 'Plasma Scatter Rifle',
  does: 'Tap for 85 m/s plasma orbs that burst into lingering 4.5 m crackling spheres (1.8 s DoT). Hold 0.8 s to charge a 3-orb horizontal fan volley.',
  lore: 'Leaves the air uninhabitable for two seconds, which is usually enough.',
};
const RAIL = {
  name: 'Linear Rail Rifle',
  does: 'Zero-spread mech railgun: tap for crisp 190 dmg penetrating slugs (0.35 s); hold 1.1 s to fire a 650 dmg hypersonic rail slug through 2 walls and every body in line.',
  lore: 'The projectile arrives before the paperwork can be opened.',
};
const SHIELD = {
  name: 'Armored Energy Shield',
  does: 'Hold to project a 4.5 × 3.5 m faceted energy barrier blocking 80% of frontal fire (95% + rocket reflection during the first 0.5 s Perfect Guard). Fires freely with your other arm.',
  lore: 'Polite refusal of incoming projectiles, reinforced with titanium and plasma.',
};

const arm = (id: FramePartId, side: ArmSide, kind: ArmKind, copy: typeof ROTARY): FramePart =>
  ({ id, slot: side === 'left' ? 'leftArm' : 'rightArm', side, arm: kind, ...copy });

const paint = (id: FramePartId, kind: PaintKind, name: string, does: string, lore: string): FramePart =>
  ({ id, slot: 'paint', paint: kind, name, does, lore });

export const FRAME_PARTS: Readonly<Record<FramePartId, FramePart>> = {
  // ---- Arm weapons ----
  rotaryL: arm('rotaryL', 'left', 'rotary', ROTARY),
  rotaryR: arm('rotaryR', 'right', 'rotary', ROTARY),
  cannonL: arm('cannonL', 'left', 'cannon40', CANNON),
  cannonR: arm('cannonR', 'right', 'cannon40', CANNON),
  howitzerL: arm('howitzerL', 'left', 'howitzer105', HOWITZER),
  howitzerR: arm('howitzerR', 'right', 'howitzer105', HOWITZER),
  vulcan30L: arm('vulcan30L', 'left', 'vulcan30', VULCAN30),
  vulcan30R: arm('vulcan30R', 'right', 'vulcan30', VULCAN30),
  beamL: arm('beamL', 'left', 'beam', BEAM),
  beamR: arm('beamR', 'right', 'beam', BEAM),
  clusterL: arm('clusterL', 'left', 'cluster', CLUSTER),
  clusterR: arm('clusterR', 'right', 'cluster', CLUSTER),
  shotgunL: arm('shotgunL', 'left', 'shotgun', SHOTGUN),
  shotgunR: arm('shotgunR', 'right', 'shotgun', SHOTGUN),
  grenadeL: arm('grenadeL', 'left', 'grenade', GRENADE),
  grenadeR: arm('grenadeR', 'right', 'grenade', GRENADE),
  swordL: arm('swordL', 'left', 'sword', SWORD),
  swordR: arm('swordR', 'right', 'sword', SWORD),
  bunkerL: arm('bunkerL', 'left', 'bunker', BUNKER),
  bunkerR: arm('bunkerR', 'right', 'bunker', BUNKER),
  flamerL: arm('flamerL', 'left', 'flamer', FLAMER),
  flamerR: arm('flamerR', 'right', 'flamer', FLAMER),
  plasmaL: arm('plasmaL', 'left', 'plasma', PLASMA),
  plasmaR: arm('plasmaR', 'right', 'plasma', PLASMA),
  railL: arm('railL', 'left', 'rail', RAIL),
  railR: arm('railR', 'right', 'rail', RAIL),
  shieldL: arm('shieldL', 'left', 'shield', SHIELD),
  shieldR: arm('shieldR', 'right', 'shield', SHIELD),

  // ---- Shoulder weapons ----
  pod6: {
    id: 'pod6', slot: 'shoulder', shoulder: 'pod6', name: 'Six-tube Missile Pod',
    does: 'Hold shoulder key (G / V / B) to paint up to six targets, let go to fire all six. 8.5 s to reload.',
    lore: 'Six opinions, delivered at once. The Office considers this efficient.',
  },
  stormPod: {
    id: 'stormPod', slot: 'shoulder', shoulder: 'storm', name: 'Iron Storm Pod',
    does: 'Hold shoulder key (G / V / B) to lock, charge and paint up to 8 targets; release for a snapping burst of 120 rounds per target. 7.5 s reload.',
    lore: 'No moving parts in the barrels; all the movement happens to whoever was painted.',
  },
  mirv: {
    id: 'mirv', slot: 'shoulder', shoulder: 'mirv', name: 'MIRV Launcher',
    does: 'Hold shoulder key (G / V / B) to mark ground out to 200 m; release to climb 70 m, dive, and split into 8 homing warheads at 25 m. 11 s reload.',
    lore: 'One filing at launch, eight separate enforcement actions on arrival.',
  },
  wireBomb: {
    id: 'wireBomb', slot: 'shoulder', shoulder: 'wire', name: 'Guided Heavy Missile',
    does: 'Fires a slow 16 m/s heavy missile steered to your crosshair all the way in. 26 m kill radius, 70 m shockwave. 28 s reload.',
    lore: 'Steered by hand so there can be no dispute about where it was meant to go.',
  },
  mortarRack: {
    id: 'mortarRack', slot: 'shoulder', shoulder: 'mortar', name: 'Mortar Rack',
    does: 'Hold shoulder key (G / V / B) to place a high-arc landing circle (25–180 m); 6 rounds, 6.5 s reload. Tap 3 / 4 / 5 to cycle HE, White Phosphorus and Cluster.',
    lore: 'For accounts settled from behind a wall.',
  },
  fpvHive: {
    id: 'fpvHive', slot: 'shoulder', shoulder: 'fpv', name: 'FPV Drone Hive',
    does: 'Press shoulder key (G / V / B) to launch 4 autonomous kamikaze drones (hold to bias toward crosshair). 4 m blast each; rebuilds 1 drone every 4 s.',
    lore: 'Four small contractors who do not submit expense reports.',
  },
  pointDefence: {
    id: 'pointDefence', slot: 'shoulder', shoulder: 'pointdef', name: 'Point Defence',
    does: 'Always on: shoots down incoming rockets, grenades and shells within 15 m (6 charges, 3 s refill) and clips infantry within 6 m.',
    lore: 'Declines incoming correspondence before it reaches the desk.',
  },
  flareRack: {
    id: 'flareRack', slot: 'shoulder', shoulder: 'flares', name: 'Countermeasure Rack',
    does: 'Doubles Q smoke to 6 charges, halves refill to 7 s, widens the screen by 50%, and auto-pops flares against incoming missiles every 5 s.',
    lore: 'Standard obscurity, now issued in commercial quantities.',
  },
  twinGrenade: {
    id: 'twinGrenade', slot: 'shoulder', shoulder: 'twinGrenade', name: 'Twin Grenade Cannon',
    does: 'Direct-fire twin 80 mm cannon: fires two high-velocity shells 0.14 s apart (6 m blast, 260 dmg each, heavy stagger). 6.5 s reload.',
    lore: 'Because a single reminder rarely settles a dispute.',
  },
  laserOrbit: {
    id: 'laserOrbit', slot: 'shoulder', shoulder: 'laserOrbit', name: 'Autonomous Laser Orbits',
    does: 'Press to deploy 2 hovering gun-drones around your shoulders for 14 s that automatically zap enemies within 45 m while both arms stay free. 10 s cooldown.',
    lore: 'Two junior auditors hovering at shoulder height, invoicing by the beam.',
  },
  arcNeedle: {
    id: 'arcNeedle', slot: 'shoulder', shoulder: 'arcNeedle', name: 'Arc Rail Needle',
    does: 'Fires a 240 m/s rail harpoon (380 dmg) that embeds, crackles 0.45 s, then detonates in a 9 m chain-lightning burst across up to 5 enemies. 7.0 s reload.',
    lore: 'Delivers a citation and immediately shares it with everyone standing nearby.',
  },
  plasmaMissiles: {
    id: 'plasmaMissiles', slot: 'shoulder', shoulder: 'plasmaMissiles', name: 'Vertical Plasma Rain',
    does: 'Hold to paint up to 6 targets (or tap for blind salvo); launches 6 missiles straight up that dive over walls and burst into 5 m lingering plasma domes. 9.0 s reload.',
    lore: 'Roof cover was never guaranteed under the service agreement.',
  },
  shoulderGatling: {
    id: 'shoulderGatling', slot: 'shoulder', shoulder: 'shoulderGatling', name: 'Shoulder Rotary Pod',
    does: 'Hold shoulder key to spin up a 4-barrel shoulder minigun (22 rds/s, 48 dmg, 4.5 s heat, 2.4 s vent) while firing both arm weapons simultaneously.',
    lore: 'For pilots who looked at two rotary arms and saw room for a third.',
  },

  // ---- Legs ----
  legsStandard: {
    id: 'legsStandard', slot: 'legs', name: 'Standard Legs',
    does: 'Reverse-jointed walker legs: 7 m/s ahead, the jets for a hop and a hover, the stomp from height.',
    lore: 'Two of them, which the Council considers the correct number.',
    legs: { walk: 1, jump: 1, stomp: 1, stompPower: 1, gait: 'walker', legArmor: 1, hullScale: 1, strafe: 1, turnRate: 1 },
  },
  legsSprinter: {
    id: 'legsSprinter', slot: 'legs', name: 'Sprinter Legs',
    does: 'Light reverse-jointed legs: walk ×1.30, jet launch ×1.6, stomp ×0.6, leg armour ×0.7.',
    lore: 'Trimmed of every gram not required to outrun an audit.',
    legs: { walk: 1.3, jump: 1.6, stomp: 0.6, stompPower: 0.6, gait: 'sprinter', legArmor: 0.7 },
  },
  legsHeavy: {
    id: 'legsHeavy', slot: 'legs', name: 'Pile-Driver Legs',
    does: 'Heavy legs: walk ×0.75, jet launch ×0.5, stomp ring ×1.5 with ×2.2 damage and push, leg armour ×1.6, knockback-immune. Hold C/Ctrl in mid-air to paint a ground target and dive-slam at an angle.',
    lore: 'Puts the weight of the Office firmly behind every step.',
    legs: { walk: 0.75, jump: 0.5, stomp: 1.5, stompPower: 2.2, gait: 'heavy', legArmor: 1.6, immuneKnockback: true },
  },
  legsTreads: {
    id: 'legsTreads', slot: 'legs', name: 'Treads',
    does: 'Tank tracks: ×1.25 on flat ground, ×0.6 on slopes, slower hull turn (×0.5), no hop, no aim sway, hull ×1.2, crushes enemies driven over.',
    lore: 'No knees to break, no stairs to climb, no apologies to offer.',
    legs: { walk: 1.25, jump: 0, stomp: 0, stompPower: 0, gait: 'treads', hullScale: 1.2, turnRate: 0.5, noSway: true, crushOnDrive: true },
  },
  legsSpider: {
    id: 'legsSpider', slot: 'legs', name: 'Spider Legs',
    does: 'Four legs: strafe ×1.4, climbs 45° slopes and 2.2 m ledges, zero view recoil kick, and a 360° 5 m leg sweep instead of stomp.',
    lore: 'Four points of contact, none of which care what the floor looks like.',
    legs: { walk: 1, jump: 1, stomp: 1, stompPower: 1, gait: 'spider', strafe: 1.4, noRecoil: true, legSweep: true },
  },
  legsHover: {
    id: 'legsHover', slot: 'legs', name: 'Mag-Skiff Hover Hull',
    does: 'Armoured repulsor hover-boat: floats 0.65 m off the ground at ×1.30 speed in all directions, zero aim sway or recoil, hull ×1.25. Crouch triggers a 10 m downward repulsor crush pulse.',
    lore: 'Friction was reviewed by Procurement and declared an unnecessary recurring expense.',
    legs: { walk: 1.3, jump: 0.85, stomp: 0, stompPower: 0, gait: 'hover', hullScale: 1.25, strafe: 1.3, noSway: true, noRecoil: true, hoverHeight: 0.65, repulsorPulse: true },
  },
  legsWheels: {
    id: 'legsWheels', slot: 'legs', name: 'Drift-Wheel Rig',
    does: 'Low-slung motorized wheel sled: ×1.60 ground speed, powerslide drifts around corners while firing steady, crushes enemies driven over (240 dmg). Hull ×0.85, weak hop (×0.4).',
    lore: 'Built from surplus tarmac racers and absolutely zero traffic safety waivers.',
    legs: { walk: 1.6, jump: 0.4, stomp: 0, stompPower: 0, gait: 'wheels', hullScale: 0.85, strafe: 1.15, turnRate: 1.35, noSway: true, crushOnDrive: true, driftRig: true },
  },
  legsAeroQuad: {
    id: 'legsAeroQuad', slot: 'legs', name: 'Aero-Quad Legs',
    does: 'Skeletal lightweight 4-leg frame: walk ×1.15, strafe ×1.35, zero recoil. Hold Space mid-air to splay flat into a 14 m/s X-wing hover-glide at half fuel drain. Leg armour ×0.75.',
    lore: 'Four razor limbs that politely forget gravity whenever asked.',
    legs: { walk: 1.15, jump: 1.25, stomp: 0.8, stompPower: 0.8, gait: 'aeroQuad', legArmor: 0.75, strafe: 1.35, noRecoil: true, aeroHover: true },
  },

  // ---- Chassis / Cores (`cockpit` slot) ----
  cockpitStandard: {
    id: 'cockpitStandard', slot: 'cockpit', name: 'Distraint Mk.IV (Standard)',
    does: 'Classic hunched Bureau heavy chassis: balanced hull (×1.0), full armoured canopy, 1 shoulder slot (G).',
    lore: 'Seats one. Comfort was considered and declined.',
    cockpit: { shoulders: 1, canopyScale: 1, hullScale: 1, openSeat: false, sensorRange: 0 },
  },
  cockpitTwin: {
    id: 'cockpitTwin', slot: 'cockpit', name: 'Twin-Mount Gunship Core',
    does: 'Broad twin-shoulder gunship chassis with 2 shoulder slots (G and V). Thinner canopy cracks at ×0.7 damage.',
    lore: 'Room for a second mount, paid for out of the glass budget.',
    cockpit: { shoulders: 2, canopyScale: 0.7 },
  },
  cockpitOpen: {
    id: 'cockpitOpen', slot: 'cockpit', name: 'Gantry Open-Cage Core',
    does: 'Stripped tubular exoskeleton frame with 3 shoulder slots (G, V and B) and exposed pilot seat (seat hits hurt the pilot directly). Hull ×0.9.',
    lore: 'Maximum ordinance, zero carapace. Sign the waiver before boarding.',
    cockpit: { shoulders: 3, canopyScale: 0, hullScale: 0.9, openSeat: true },
  },
  cockpitSensor: {
    id: 'cockpitSensor', slot: 'cockpit', name: 'Sensor Recon Core',
    does: 'Recon variant with 1 shoulder slot (G) and built-in 70 m wall-seeing thermal optics (shared in co-op). Hull ×0.9.',
    lore: 'Wired straight into the Thermal brain chip bus so walls stop pretending to be cover.',
    cockpit: { shoulders: 1, hullScale: 0.9, sensorRange: 70 },
  },
  chassisKestrel: {
    id: 'chassisKestrel', slot: 'cockpit', name: 'Kestrel Aero-Core',
    does: 'Razor-narrow forward-leaning wedge chassis: walk ×1.12, dash ×1.15, 2 shoulder slots (G and V). Light armour (hull ×0.78, canopy ×0.8).',
    lore: 'Shaved down until wind tunnels stopped filing complaints.',
    cockpit: { shoulders: 2, hullScale: 0.78, canopyScale: 0.8, walkScale: 1.12, dashScale: 1.15 },
  },
  chassisBastion: {
    id: 'chassisBastion', slot: 'cockpit', name: 'Bastion Siege-Core',
    does: 'Towering brutalist slab-armour bunker torso: hull ×1.45, canopy ×1.50, −40% view recoil, 2 shoulder slots (G and V). Slower walk (×0.90).',
    lore: 'A fortified guardhouse that grew shoulders and refused to stay on the perimeter.',
    cockpit: { shoulders: 2, hullScale: 1.45, canopyScale: 1.5, walkScale: 0.9, recoilScale: 0.6 },
  },
  chassisValkyrie: {
    id: 'chassisValkyrie', slot: 'cockpit', name: 'Valkyrie Wing-Core',
    does: 'Upright sculpted prototype torso with wide rear wing-pylons: +20% energy weapon charge & cooling speed, 2 wide-set shoulder slots (G and V), hull ×1.0.',
    lore: 'Built for executive demonstrations; confiscated by Field Compliance after the third test.',
    cockpit: { shoulders: 2, hullScale: 1, canopyScale: 1, energyChargeMult: 1.2 },
  },
  chassisChitin: {
    id: 'chassisChitin', slot: 'cockpit', name: 'Chitin Bio-Core',
    does: 'Smooth rounded segmented carapace: +35% jet/drive fuel regeneration, 2 shoulder slots (G and V), hull ×0.90.',
    lore: 'Its blueprints arrived unsigned from an unindexed deep-sector lab. It runs wonderfully.',
    cockpit: { shoulders: 2, hullScale: 0.9, canopyScale: 0.95, fuelRegenScale: 1.35 },
  },

  // ---- Heads / Sensor Crowns ----
  headStandard: {
    id: 'headStandard', slot: 'head', name: 'Flush Visor (Standard)',
    does: 'Integrated low-profile Distraint visor brow. Baseline stats.',
    lore: 'A neck is just another joint that requires quarterly lubrication.',
    head: { head: 'standard' },
  },
  headDuelist: {
    id: 'headDuelist', slot: 'head', name: 'V-Crest Duelist',
    does: 'Angular heroic mecha helmet with twin swept V-fin crest antennas. +15% arm weapon tracking speed.',
    lore: 'The crest improves target telemetry by 15% and pilot posture by roughly 40%.',
    head: { head: 'duelist', armTrackMult: 1.15 },
  },
  headCyclops: {
    id: 'headCyclops', slot: 'head', name: 'Cyclops Recon Dome',
    does: 'Armoured mono-eye sensor turret with twin whip antennas: highlights every enemy within 70 m through walls on ANY chassis (shared in co-op).',
    lore: 'One unblinking eye that bills overtime for seeing through concrete.',
    head: { head: 'cyclops', sensorRange: 70 },
  },
  headStealth: {
    id: 'headStealth', slot: 'head', name: 'Flat Arrowhead Hood',
    does: 'Razor-flat aerodynamic diamond hood tucked flush between the shoulders. +25% shoulder missile & target paint lock range.',
    lore: 'Headless from the side, merciless from two hundred metres.',
    head: { head: 'stealth', lockRangeMult: 1.25 },
  },
  headBunker: {
    id: 'headBunker', slot: 'head', name: 'Demolition Cage',
    does: 'Bolted heavy steel head block wrapped in roll-bars with quad floodlights. +35% canopy & head durability.',
    lore: 'Rated for falling girders, bricks, and enthusiastic disagreement.',
    head: { head: 'bunker', canopyScale: 1.35 },
  },
  headHalo: {
    id: 'headHalo', slot: 'head', name: 'Seraph Crown',
    does: 'Smooth curved sensor shell with a vertical glowing optic seam and swept horns. Reduces canopy crack wear by 20%.',
    lore: 'Unsettlingly symmetrical. Stares straight through smoke.',
    head: { head: 'halo', crackDamageMult: 0.8, armTrackMult: 1.08 },
  },

  // ---- Engines ----
  engineStandard: {
    id: 'engineStandard', slot: 'engine', name: 'Standard Engine',
    does: 'Walks, charges with Shift, lifts on the jets for about 2.3 s of fuel.',
    lore: 'It runs on the same thing you do: regulations.',
    engine: { speed: 1, drive: 'jets', dash: 1, fuelScale: 1, airborneDamageMult: 1 },
  },
  engineJet: {
    id: 'engineJet', slot: 'engine', name: 'Jump-Jet Engine',
    does: 'Walk ×1.2. Hold Space for true flight (14 m/s air speed, 4 s fuel); Shift triggers a 32 m/s jet blast in any direction.',
    lore: 'Vertical mobility, billed by the second.',
    engine: { speed: 1.2, drive: 'flight', dash: 32 / 18, fuelScale: 4 / 2.3 },
  },
  engineRotor: {
    id: 'engineRotor', slot: 'engine', name: 'Rotor Engine',
    does: 'Walk ×0.9. Hold Space to climb up to 14 m and hover indefinitely (9 m/s air strafe, no Shift charge). Hull takes ×1.25 damage airborne.',
    lore: 'A quiet ceiling of 14 metres, for prolonged oversight.',
    engine: { speed: 0.9, drive: 'hover', dash: 0, fuelScale: 1, airborneDamageMult: 1.25 },
  },
  engineAfterburner: {
    id: 'engineAfterburner', slot: 'engine', name: 'Afterburner',
    does: 'Normal hop. Hold Shift in the air to fold into 48 m/s jet mode (7 s fuel, arms locked forward); stomp from jet mode dive-bombs at ×1.5.',
    lore: 'Approved as a ground vehicle under a footnote nobody has read.',
    engine: { speed: 1, drive: 'afterburner', dash: 1, fuelScale: 7 / 2.3 },
  },
  engineOvercharge: {
    id: 'engineOvercharge', slot: 'engine', name: 'Overcharge Engine',
    does: 'Fast ground build: walk ×1.45, 3 charges at 26 m/s (2.5 s refill each), jet fuel ×0.5.',
    lore: 'Every safety governor removed and filed under "non-essential".',
    engine: { speed: 1.45, drive: 'overcharge', dash: 26 / 18, fuelScale: 0.5 },
  },
  engineDiesel: {
    id: 'engineDiesel', slot: 'engine', name: 'Long-Haul Engine',
    does: 'Walk ×0.95. Hold Shift for a steady 11 m/s run up to 12 s (4 s refill) that tramples small enemies; jet fuel ×1.3.',
    lore: 'Built to outlast the shift, the riot, and the building.',
    engine: { speed: 0.95, drive: 'diesel', dash: 11 / 18, fuelScale: 1.3 },
  },
  engineBlink: {
    id: 'engineBlink', slot: 'engine', name: 'Blink-Step Booster',
    does: 'Walk ×1.15. Shift fires a snappy 30 m/s omnidirectional Quick-Boost dodge in any WASD direction (ground or air): 4 charges, 1.3 s refill each.',
    lore: 'Six radial vernier nozzles calibrated to make enemy gunners question their eyesight.',
    engine: { speed: 1.15, drive: 'blink', dash: 30 / 18, fuelScale: 0.9, blinkBoost: true },
  },
  engineRedline: {
    id: 'engineRedline', slot: 'engine', name: 'Redline Surge Reactor',
    does: 'Massive ×1.8 fuel tank with slow normal regen (×0.5) — BUT draining fuel to 0% triggers a Redline Surge after 1.4 s that snaps 75% fuel back instantly and boosts energy weapons +25% for 4 s.',
    lore: 'The manual recommends never running it dry. The test pilots ignored the manual and doubled their flight time.',
    engine: { speed: 1.08, drive: 'redline', dash: 22 / 18, fuelScale: 1.8, fuelRegenScale: 0.5, redlineSurge: true },
  },
  engineAssault: {
    id: 'engineAssault', slot: 'engine', name: 'Assault-Ram Drive',
    does: 'Hold Shift for a 28 m/s shielded forward jet-rush (30% frontal damage reduction, lateral weave). Tap F or slam into enemies during the rush for a devastating 550 dmg Boost Kick.',
    lore: 'When the door is locked, the Bureau prefers to bring the whole doorframe with it.',
    engine: { speed: 1.05, drive: 'assault', dash: 28 / 18, fuelScale: 1.25, assaultRam: true },
  },

  // ---- Core Expansions (`Q` key) ----
  expSmoke: {
    id: 'expSmoke', slot: 'expansion', name: 'Smoke & Flares (Standard)',
    does: 'Standard Q countermeasure: 3 charges (14 s refill), deploys smoke wall, anti-missile flares, and a 6.5 m concussive pulse.',
    lore: 'Standard obscurity, issued in three polite canisters.',
    expansion: { expansion: 'smoke', charges: 3, refill: 14 },
  },
  expNova: {
    id: 'expNova', slot: 'expansion', name: 'Breacher Nova',
    does: 'Press Q: 0.35 s charge, then unleashes an 18 m omnidirectional energy shockwave (480 dmg, massive fling) that deletes incoming rockets/grenades and strips sappers. 2 charges, 22 s refill.',
    lore: 'Clears the immediate vicinity of ordnance, personnel, and ambiguity.',
    expansion: { expansion: 'nova', charges: 2, refill: 22 },
  },
  expAegis: {
    id: 'expAegis', slot: 'expansion', name: 'Aegis Barrier',
    does: 'Press Q to wrap the Frame in a mobile 1,500 HP faceted energy shield for 8 s, immediately clearing leg sappers and absorbing hits until broken. 2 charges, 24 s refill.',
    lore: 'A portable perimeter wall with a strict eight-second lease.',
    expansion: { expansion: 'aegis', charges: 2, refill: 24 },
  },
  expDome: {
    id: 'expDome', slot: 'expansion', name: 'Bunker Dome',
    does: 'Press Q to drop a stationary 10 m protective energy dome (3,000 HP, 12 s) that blocks outside enemy fire while you and co-op allies shoot freely from inside. 1 charge, 28 s refill.',
    lore: 'One-way ballistic glass, shaped into a temporary field office.',
    expansion: { expansion: 'dome', charges: 1, refill: 28 },
  },
  expTerminal: {
    id: 'expTerminal', slot: 'expansion', name: 'Last-Stand Fuse',
    does: 'Passive emergency save (no Q press needed): lethal hull damage instead clamps HP at 1, blasts enemies back 10 m, and activates a 4.5 s invulnerable shield. 90 s cooldown.',
    lore: 'Destruction of Bureau property requires Form 88-B; until filed, the hull remains intact.',
    expansion: { expansion: 'terminal', charges: 1, refill: 90, passive: true },
  },

  // ---- Paint Liveries ----
  paintBureau: paint('paintBureau', 'bureau', 'Bureau Standard', 'Obsidian & gunmetal plate with crimson optics and amber thrusters.', 'Regulation charcoal. Unmistakably official.'),
  paintArctic: paint('paintArctic', 'arctic', 'Arctic Prototype', 'Matte chalk white & titanium with ice-cyan optics and blue plasma jets.', 'Winter trials finish from Sector 9.'),
  paintHazard: paint('paintHazard', 'hazard', 'Hazard Demolition', 'Industrial safety yellow & dark steel with blazing amber thrusters.', 'High-visibility paint so nobody claims they did not see it coming.'),
  paintCrimson: paint('paintCrimson', 'crimson', 'Crimson Ace', 'Deep blood-red carapace, matte black joints, gold trim, and red surge jets.', 'Reserved for contractors whose kill tallies broke the ledger column.'),
  paintDesert: paint('paintDesert', 'desert', 'Desert Enforcement', 'Matte sand tan & olive drab with brass fittings and amber optics.', 'Dust-sealed coating from the Holdfast salt-flat detachments.'),
  paintStealth: paint('paintStealth', 'stealth', 'Stealth Night-Ops', 'Carbon black & dark graphite with razor-thin electric cyan inset lines.', 'Absorbs spotlight beams and polite inquiries alike.'),
  paintRust: paint('paintRust', 'rust', 'Scrapyard Rust', 'Weathered oxidized iron & raw welded steel with hot orange flares.', 'Found behind a salvage hangar; still refuses to stay down.'),
  paintCobalt: paint('paintCobalt', 'cobalt', 'Cobalt Security', 'Deep navy blue & brushed silver with cyan optics and bright blue jets.', 'Orbital garrison livery, repurposed for surface duty.'),
  paintForest: paint('paintForest', 'forest', 'Forest Heavy', 'Military olive green & dark moss armour with brass collars.', 'Field-drab finish for protracted brush clearance.'),
  paintChrome: paint('paintChrome', 'chrome', 'Chrome Experimental', 'Bright brushed steel, gold accents, and magenta-crimson experimental jets.', 'Mirror-polished to reflect lasers and irritate auditors.'),
};

export interface FrameLoadout {
  leftArm: FramePartId;
  rightArm: FramePartId;
  /** One a shoulder slot, as many as the chassis allows. */
  shoulders: FramePartId[];
  legs: FramePartId;
  cockpit: FramePartId;
  head: FramePartId;
  engine: FramePartId;
  expansion: FramePartId;
  paint: FramePartId;
  /** Optional 4-swatch user custom paint override (`primary`, `secondary`, `accent`, `glow`). */
  customPaint?: CustomFrameColors;
}

/** The Frame as it always was. */
export const DEFAULT_FRAME_LOADOUT: Readonly<FrameLoadout> = Object.freeze({
  leftArm: 'rotaryL',
  rightArm: 'cannonR',
  shoulders: Object.freeze(['pod6']) as unknown as FramePartId[],
  legs: 'legsStandard',
  cockpit: 'cockpitStandard',
  head: 'headStandard',
  engine: 'engineStandard',
  expansion: 'expSmoke',
  paint: 'paintBureau',
});

export const defaultLoadout = (): FrameLoadout => ({
  ...DEFAULT_FRAME_LOADOUT,
  shoulders: [...DEFAULT_FRAME_LOADOUT.shoulders],
});

/** Iconic showcase builds for instant one-click switching on the Garage screen. */
export interface FramePreset {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly loadout: FrameLoadout;
}

export const FRAME_PRESETS: readonly FramePreset[] = [
  {
    id: 'standard',
    name: 'Bureau Standard',
    summary: 'Original Distraint Mk.IV walker',
    loadout: defaultLoadout(),
  },
  {
    id: 'samurai',
    name: 'Cyber Samurai',
    summary: 'Kestrel + V-Crest + Energy Sword & Shield + Blink-Step + Orbits',
    loadout: {
      leftArm: 'swordL', rightArm: 'shieldR', shoulders: ['laserOrbit', 'arcNeedle'],
      legs: 'legsSprinter', cockpit: 'chassisKestrel', head: 'headDuelist',
      engine: 'engineBlink', expansion: 'expNova', paint: 'paintArctic',
    },
  },
  {
    id: 'napalm',
    name: 'Napalm Juggernaut',
    summary: 'Bastion + Treads + HE/Napalm Grenade Launcher + Flamer + Aegis',
    loadout: {
      leftArm: 'grenadeL', rightArm: 'flamerR', shoulders: ['twinGrenade', 'mortarRack'],
      legs: 'legsTreads', cockpit: 'chassisBastion', head: 'headBunker',
      engine: 'engineDiesel', expansion: 'expAegis', paint: 'paintHazard',
    },
  },
  {
    id: 'gunship',
    name: 'Hover Gunship',
    summary: 'Valkyrie Wings + Aero-Quad + Plasma & Rail + Redline Surge',
    loadout: {
      leftArm: 'plasmaL', rightArm: 'railR', shoulders: ['plasmaMissiles', 'arcNeedle'],
      legs: 'legsAeroQuad', cockpit: 'chassisValkyrie', head: 'headStealth',
      engine: 'engineRedline', expansion: 'expDome', paint: 'paintCrimson',
    },
  },
  {
    id: 'wrecker',
    name: 'Drift Wrecker',
    summary: 'Open-Cage + Drift-Wheels + Pile Bunker + Shotgun + Assault-Ram',
    loadout: {
      leftArm: 'bunkerL', rightArm: 'shotgunR', shoulders: ['shoulderGatling', 'twinGrenade', 'pointDefence'],
      legs: 'legsWheels', cockpit: 'cockpitOpen', head: 'headCyclops',
      engine: 'engineAssault', expansion: 'expTerminal', paint: 'paintRust',
    },
  },
  {
    id: 'skiff',
    name: 'Chitin Skiff',
    summary: 'Chitin Bio-Core + Mag-Skiff Hover + Dual Grenade / Sword + Nova',
    loadout: {
      leftArm: 'grenadeL', rightArm: 'swordR', shoulders: ['laserOrbit', 'plasmaMissiles'],
      legs: 'legsHover', cockpit: 'chassisChitin', head: 'headHalo',
      engine: 'engineRedline', expansion: 'expNova', paint: 'paintChrome',
    },
  },
];

/** The core 5 single slots (wire positions 0..4 — locked order). */
export const SINGLE_SLOTS = ['leftArm', 'rightArm', 'legs', 'cockpit', 'engine'] as const;
export type SingleSlot = (typeof SINGLE_SLOTS)[number];

/** Trailing v2 single slots appended after the 3 shoulder wire indices (wire positions 8..10). */
export const EXTRA_SINGLE_SLOTS = ['head', 'expansion', 'paint'] as const;
export type ExtraSingleSlot = (typeof EXTRA_SINGLE_SLOTS)[number];

/** All single-value part slots on a FrameLoadout. */
export const ALL_SINGLE_SLOTS = [...SINGLE_SLOTS, ...EXTRA_SINGLE_SLOTS] as const;
export type AnySingleSlot = (typeof ALL_SINGLE_SLOTS)[number];

/** The most shoulder slots any chassis has: the length the wire keeps for them. */
export const MAX_SHOULDERS = 3;

type Parts = Readonly<Partial<Record<string, FramePart>>>;

/** Every part for `slot`, in the catalogue's order. */
export const partsFor = (slot: FrameSlot, parts: Parts = FRAME_PARTS): FramePart[] =>
  Object.values(parts).filter((p): p is FramePart => !!p && p.slot === slot);

/** Shoulder slots this loadout's chassis gives. */
export const shoulderSlots = (l: Pick<FrameLoadout, 'cockpit'>, parts: Parts = FRAME_PARTS): number =>
  Math.max(0, Math.min(MAX_SHOULDERS, parts[l.cockpit]?.cockpit?.shoulders ?? 1));

const fits = (id: unknown, slot: FrameSlot, parts: Parts): id is FramePartId =>
  typeof id === 'string' && parts[id]?.slot === slot;

const HEX_RE = /^#[0-9a-f]{6}$/i;
function cleanCustomPaint(raw: unknown): CustomFrameColors | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: CustomFrameColors = {};
  let any = false;
  for (const k of ['primary', 'secondary', 'accent', 'glow'] as const) {
    const v = r[k];
    if (typeof v === 'string' && HEX_RE.test(v)) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

/**
 * Anything (a saved loadout, a wire's ids decoded, a test's) made into a loadout that can be built: each slot keeps its part
 * only if that part exists and goes in that slot, else the default's; the shoulders are as many as the chassis allows.
 */
export function normalizeLoadout(raw: unknown, parts: Parts = FRAME_PARTS): FrameLoadout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof FrameLoadout, unknown>>;
  const d = DEFAULT_FRAME_LOADOUT;
  const pick = (slot: AnySingleSlot): FramePartId => (fits(r[slot], slot, parts) ? r[slot] : d[slot]);
  const customPaint = cleanCustomPaint(r.customPaint);
  const out: FrameLoadout = {
    leftArm: pick('leftArm'),
    rightArm: pick('rightArm'),
    shoulders: [],
    legs: pick('legs'),
    cockpit: pick('cockpit'),
    head: pick('head'),
    engine: pick('engine'),
    expansion: pick('expansion'),
    paint: pick('paint'),
    ...(customPaint ? { customPaint } : {}),
  };
  const given = Array.isArray(r.shoulders) ? r.shoulders : [];
  for (let i = 0; i < shoulderSlots(out, parts); i++) {
    const id = given[i];
    out.shoulders.push(fits(id, 'shoulder', parts) ? id : d.shoulders[0]!);
  }
  return out;
}

/** The arm weapon each side carries. */
export function armsOf(l: FrameLoadout, parts: Parts = FRAME_PARTS): { left: ArmKind; right: ArmKind } {
  return { left: parts[l.leftArm]?.arm ?? 'rotary', right: parts[l.rightArm]?.arm ?? 'cannon40' };
}

/** The shoulder weapon kinds fitted in slots 0..N-1. */
export function shouldersOf(l: FrameLoadout, parts: Parts = FRAME_PARTS): ShoulderKind[] {
  const count = shoulderSlots(l, parts);
  const out: ShoulderKind[] = [];
  for (let i = 0; i < count; i++) {
    const id = l.shoulders[i];
    out.push((id ? parts[id]?.shoulder : undefined) ?? 'pod6');
  }
  return out;
}

/** The paint livery kind fitted on `l`. */
export function paintOf(l: Pick<FrameLoadout, 'paint'>, parts: Parts = FRAME_PARTS): PaintKind {
  return parts[l.paint]?.paint ?? 'bureau';
}

/** The head kind fitted on `l`. */
export function headOf(l: Pick<FrameLoadout, 'head'>, parts: Parts = FRAME_PARTS): HeadKind {
  return parts[l.head]?.head?.head ?? 'standard';
}

/** The Core Expansion kind fitted on `l`. */
export function expansionOf(l: Pick<FrameLoadout, 'expansion'>, parts: Parts = FRAME_PARTS): ExpansionKind {
  return parts[l.expansion]?.expansion?.expansion ?? 'smoke';
}

/** The arm part for `kind` on `side`. */
export function armPart(side: ArmSide, kind: ArmKind): FramePartId {
  const p = Object.values(FRAME_PARTS).find(x => x.side === side && x.arm === kind);
  return p!.id;
}

/** `l` with `id` in its slot (a shoulder part in shoulder slot `at`), and the shoulders fitted to a new chassis. */
export function fitPart(l: FrameLoadout, id: FramePartId, at = 0, parts: Parts = FRAME_PARTS): FrameLoadout {
  const p = parts[id];
  if (!p) return normalizeLoadout(l, parts);
  const next: FrameLoadout = { ...l, shoulders: [...l.shoulders] };
  if (p.slot === 'shoulder') next.shoulders[Math.max(0, at)] = id;
  else {
    next[p.slot] = id;
    // Selecting a preset paint clears custom overrides unless user explicitly re-tints.
    if (p.slot === 'paint') delete next.customPaint;
  }
  return normalizeLoadout(next, parts);
}

/** True when the two loadouts build the same Frame. */
export const sameLoadout = (a: FrameLoadout, b: FrameLoadout): boolean =>
  ALL_SINGLE_SLOTS.every(s => a[s] === b[s])
  && a.shoulders.length === b.shoulders.length
  && a.shoulders.every((s, i) => s === b.shoulders[i])
  && JSON.stringify(a.customPaint ?? null) === JSON.stringify(b.customPaint ?? null);

/** What the parts add up to, for movement, durability, optics, energy, and slots. */
export interface FrameStats {
  walk: number;
  jump: number;
  stomp: number;
  stompPower: number;
  dash: number;
  gait: GaitKind;
  drive: DriveKind;
  head: HeadKind;
  expansion: ExpansionKind;
  paint: PaintKind;
  shoulders: number;
  pod: boolean;
  hullScale: number;
  legArmor: number;
  canopyScale: number;
  openSeat: boolean;
  sensorRange: number;
  airborneDamageMult: number;
  noRecoil: boolean;
  noSway: boolean;
  immuneKnockback: boolean;
  legSweep: boolean;
  crushOnDrive: boolean;
  strafe: number;
  turnRate: number;
  fuelScale: number;
  // v2 modifiers
  fuelRegenScale: number;
  recoilScale: number;
  energyChargeMult: number;
  armTrackMult: number;
  lockRangeMult: number;
  crackDamageMult: number;
  hoverHeight: number;
  repulsorPulse: boolean;
  driftRig: boolean;
  aeroHover: boolean;
  redlineSurge: boolean;
  assaultRam: boolean;
  blinkBoost: boolean;
}

export function frameStats(l: FrameLoadout, parts: Parts = FRAME_PARTS): FrameStats {
  const legs = parts[l.legs]?.legs ?? FRAME_PARTS.legsStandard.legs!;
  const engine = parts[l.engine]?.engine ?? FRAME_PARTS.engineStandard.engine!;
  const cockpit = parts[l.cockpit]?.cockpit ?? FRAME_PARTS.cockpitStandard.cockpit!;
  const head = parts[l.head]?.head ?? FRAME_PARTS.headStandard.head!;
  const exp = parts[l.expansion]?.expansion ?? FRAME_PARTS.expSmoke.expansion!;
  const paintKind = parts[l.paint]?.paint ?? 'bureau';
  const baseCanopy = cockpit.canopyScale ?? 1;
  return {
    walk: legs.walk * engine.speed * (cockpit.walkScale ?? 1),
    jump: legs.jump,
    stomp: legs.stomp,
    stompPower: legs.stompPower ?? legs.stomp,
    dash: engine.dash * (cockpit.dashScale ?? 1),
    gait: legs.gait,
    drive: engine.drive,
    head: head.head,
    expansion: exp.expansion,
    paint: paintKind,
    shoulders: shoulderSlots(l, parts),
    pod: l.shoulders.includes('pod6'),
    hullScale: (legs.hullScale ?? 1) * (cockpit.hullScale ?? 1),
    legArmor: legs.legArmor ?? 1,
    canopyScale: baseCanopy <= 0 ? 0 : baseCanopy * (head.canopyScale ?? 1),
    openSeat: cockpit.openSeat ?? false,
    sensorRange: Math.max(cockpit.sensorRange ?? 0, head.sensorRange ?? 0),
    airborneDamageMult: engine.airborneDamageMult ?? 1,
    noRecoil: legs.noRecoil ?? false,
    noSway: legs.noSway ?? false,
    immuneKnockback: legs.immuneKnockback ?? false,
    legSweep: legs.legSweep ?? false,
    crushOnDrive: legs.crushOnDrive ?? false,
    strafe: legs.strafe ?? 1,
    turnRate: legs.turnRate ?? 1,
    fuelScale: engine.fuelScale ?? 1,
    fuelRegenScale: (engine.fuelRegenScale ?? 1) * (cockpit.fuelRegenScale ?? 1),
    recoilScale: legs.noRecoil ? 0 : (cockpit.recoilScale ?? 1),
    energyChargeMult: cockpit.energyChargeMult ?? 1,
    armTrackMult: head.armTrackMult ?? 1,
    lockRangeMult: head.lockRangeMult ?? 1,
    crackDamageMult: head.crackDamageMult ?? 1,
    hoverHeight: legs.hoverHeight ?? 0,
    repulsorPulse: legs.repulsorPulse ?? false,
    driftRig: legs.driftRig ?? false,
    aeroHover: legs.aeroHover ?? false,
    redlineSurge: engine.redlineSurge ?? false,
    assaultRam: engine.assaultRam ?? false,
    blinkBoost: engine.blinkBoost ?? false,
  };
}

/**
 * Wire kit length: 5 core single slots + 3 shoulders + 3 v2 single slots (`head`, `expansion`, `paint`) = 11.
 * Legacy 7-id (2 shoulders) and 8-id (3 shoulders, pre-v2) packets still decode cleanly via `kitFrom`.
 */
export const KIT_LENGTH = SINGLE_SLOTS.length + MAX_SHOULDERS + EXTRA_SINGLE_SLOTS.length;
export const LEGACY_V1_KIT_LENGTH = SINGLE_SLOTS.length + MAX_SHOULDERS;
export const LEGACY_KIT_LENGTH = SINGLE_SLOTS.length + 2;

/** A loadout as one short list of part numbers (places in `FRAME_PART_ORDER`), for the co-op wire. */
export function kitIds(l: FrameLoadout): number[] {
  const out = SINGLE_SLOTS.map(s => FRAME_PART_ORDER.indexOf(l[s]));
  for (let i = 0; i < MAX_SHOULDERS; i++) out.push(l.shoulders[i] ? FRAME_PART_ORDER.indexOf(l.shoulders[i]!) : -1);
  for (const s of EXTRA_SINGLE_SLOTS) out.push(FRAME_PART_ORDER.indexOf(l[s]));
  return out;
}

/**
 * The loadout another player's numbers say, made safe: an unknown number is the default's part for that slot.
 * Accepts 11-number v2 lists, 8-number v1 lists, and 7-number legacy lists.
 */
export function kitFrom(ids: ArrayLike<number>): FrameLoadout {
  const at = (i: number): FramePartId | undefined => {
    if (i >= ids.length) return undefined;
    const idx = Math.round(Number(ids[i]));
    return Number.isInteger(idx) && idx >= 0 ? FRAME_PART_ORDER[idx] : undefined;
  };
  const raw: Record<string, unknown> = {};
  SINGLE_SLOTS.forEach((s, i) => { raw[s] = at(i); });
  const shoulderCount = Math.min(MAX_SHOULDERS, Math.max(0, ids.length - SINGLE_SLOTS.length));
  raw.shoulders = Array.from({ length: shoulderCount }, (_, i) => at(SINGLE_SLOTS.length + i));
  const extraStart = SINGLE_SLOTS.length + MAX_SHOULDERS;
  if (ids.length > extraStart) {
    EXTRA_SINGLE_SLOTS.forEach((s, i) => { raw[s] = at(extraStart + i); });
  }
  return normalizeLoadout(raw);
}

// ---- kept between runs --------------------------------------------------------------------------------------------

export const FRAME_LOADOUT_KEY = 'op2.frame.loadout.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The loadout this browser chose last, or the default. Bad or missing storage is the default, never an error. */
export function loadFrameLoadout(s: Store | null = store()): FrameLoadout {
  try {
    const raw = s?.getItem(FRAME_LOADOUT_KEY);
    return normalizeLoadout(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultLoadout();
  }
}

export function saveFrameLoadout(l: FrameLoadout, s: Store | null = store()): void {
  try {
    s?.setItem(FRAME_LOADOUT_KEY, JSON.stringify(normalizeLoadout(l)));
  } catch {
    // Storage off: this page keeps it until reload.
  }
}
