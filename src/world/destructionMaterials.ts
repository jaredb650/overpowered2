/**
 * Material-vs-Damage Matrix & Source Classifier for OVERPOWERED 2's Destruction Overhaul.
 *
 * Replaces the old blunt `tier === 0 -> everything damages it` check with physically grounded
 * structural materials and weapon/vehicle damage classes:
 *   - glass               : shattered by any weapon, melee, or vehicle
 *   - drywall             : interior office/house partitions — shredded by shotguns, .50 cal/HMGs,
 *                           explosives, and ANY moving vehicle ram; small arms only chip/penetrate
 *   - timber              : wooden shacks, watchtowers, wood frames — IMMUNE to pistols/SMGs/ARs;
 *                           shredded by .50 cal / HMGs / autocannons, fire, explosives, and medium+ rams
 *   - masonry             : brick / cinderblock house walls & perimeter walls — immune to small arms & HMGs;
 *                           breached by explosives, heavy ordnance, and heavy tracked tank rams
 *   - concrete            : civilian poured-concrete office buildings & parking garages — immune to small arms,
 *                           HMGs, and light vehicle rams; blasted apart by heavy explosives (satchels, rockets,
 *                           tank cannons, 40mm, howitzers, bombs, airstrikes, Frame strikes)
 *   - heavy_steel         : legacy Tier-2 heavy industrial armor (Holdfast Cannery, Quay Crane, blast pillars) —
 *                           requires 40mm+, tank cannons, Frame ordnance, airstrikes, bombs, or siege ordnance
 *   - reinforced_concrete : Tier-3 military bunkers, pillboxes & Iron Bastion fortifications — immune to small
 *                           arms, HMGs, hand-held rockets/satchels, 40mm, and tank rams; requires siege
 *                           ordnance (105mm Howitzer, AC-130 105mm/bomb, jet heavy bombs, breach charges, nuke)
 */
import type { DestructionTier, StructuralMaterial, VehicleRamClass } from '../core/contracts';
import type { Mat } from './kit/geo';

export type { StructuralMaterial, VehicleRamClass };

export type DamageClass =
  | 'small_arms'
  | 'shotgun'
  | 'heavy_mg'
  | 'autocannon'
  | 'fire'
  | 'melee_light'
  | 'melee_breach'
  | 'light_explosive'
  | 'heavy_explosive'
  | 'armor_ordnance'
  | 'siege_ordnance'
  | 'nuke'
  | 'ram_light'
  | 'ram_medium'
  | 'ram_heavy';

export interface MaterialPhysicsProps {
  /** kg/m^3 used for structural mass, load distribution, and Rapier falling body density. */
  readonly density: number;
  /** Vertical compressive load capacity per m^2 of horizontal cross-section (kg). */
  readonly loadCapacityPerM2: number;
  /** Max unsupported horizontal overhang (m) before a floor/roof slab shears off. */
  readonly maxCantilever: number;
  /** Fraction of vehicle speed retained when smashing through a panel of this material. */
  readonly ramSpeedRetain: number;
  /** Minimum vehicle speed (m/s) required to smash through this material. */
  readonly ramMinSpeed: number;
  /** Surface kind for audio/FX feedback. */
  readonly fxClass: 'glass' | 'drywall' | 'wood' | 'concrete' | 'metal';
  /** Legacy numeric DestructionTier equivalent for compatibility. */
  readonly legacyTier: DestructionTier;
}

export const STRUCTURAL_MATERIAL_PROPS: Readonly<Record<StructuralMaterial, MaterialPhysicsProps>> = {
  glass: {
    density: 240,
    loadCapacityPerM2: 0,
    maxCantilever: 1.0,
    ramSpeedRetain: 0.98,
    ramMinSpeed: 2.0,
    fxClass: 'glass',
    legacyTier: 0,
  },
  drywall: {
    density: 420,
    loadCapacityPerM2: 0,
    maxCantilever: 1.6,
    ramSpeedRetain: 0.92,
    ramMinSpeed: 4.5,
    fxClass: 'drywall',
    legacyTier: 0,
  },
  timber: {
    density: 620,
    loadCapacityPerM2: 24_000,
    maxCantilever: 2.8,
    ramSpeedRetain: 0.84,
    ramMinSpeed: 5.0,
    fxClass: 'wood',
    legacyTier: 0,
  },
  masonry: {
    density: 1850,
    loadCapacityPerM2: 68_000,
    maxCantilever: 3.4,
    ramSpeedRetain: 0.72,
    ramMinSpeed: 8.5,
    fxClass: 'concrete',
    legacyTier: 1,
  },
  concrete: {
    density: 2350,
    loadCapacityPerM2: 145_000,
    maxCantilever: 4.8,
    ramSpeedRetain: 0.58,
    ramMinSpeed: 14.0,
    fxClass: 'concrete',
    legacyTier: 2,
  },
  heavy_steel: {
    density: 2500,
    loadCapacityPerM2: 190_000,
    maxCantilever: 5.5,
    ramSpeedRetain: 0.45,
    ramMinSpeed: 999,
    fxClass: 'metal',
    legacyTier: 2,
  },
  reinforced_concrete: {
    density: 2650,
    loadCapacityPerM2: 320_000,
    maxCantilever: 5.8,
    ramSpeedRetain: 0.0,
    ramMinSpeed: 999,
    fxClass: 'concrete',
    legacyTier: 3,
  },
};

// ---------------------------------------------------------------------------------------------
// Source Classifier
// ---------------------------------------------------------------------------------------------

const SMALL_ARMS = new Set<string>([
  'smg', 'gimlet', 'harrow', 'bodkin', 'flail',
  'rivet', 'judge', 'autoraffica', 'stakegun', 'gaff',
  'rifle', 'pistol', 'bullet', 'enemy_rifle', 'enemy_smg', 'enemy_pistol',
  'jackal_mg', 'quad_mg', 'moto_mg',
]);

const SHOTGUNS = new Set<string>([
  'shotgun', 'thresher', 'deuce', 'billhook', 'ultramag',
]);

const HEAVY_MGS = new Set<string>([
  'piledriver', 'awl', 'sabot', 'buzzsaw', 'metalstorm',
  'minigun', 'hmg', '50cal', 'heavy_mg', 'lmg',
  'frame_rotary', 'frame_rotary_airburst', 'frame_flak',
  'jackal_hmg', 'jackal_auto_turret', 'valkyrie_m134', 'bastion_vulcan',
  'kestrel_mg', 'kestrel_hmg', 'aegis_mg', 'aegis_hmg',
]);

const AUTOCANNONS = new Set<string>([
  'autocannon', 'lance', 'ac130_25mm', 'warthog_gau8', 'warthog_cannon',
  'chopper_cannon', 'viper_lance', 'viper_lance_blast', 'viper_overcharge',
  'harrier_cannon', 'raptor_cannon', 'hornet_cannon', 'kestrel_cannon',
  'bastion_cannon',
]);

const FIRE_SOURCES = new Set<string>([
  'flame', 'flamer', 'fire', 'kiln', 'autoclave', 'frame_flamer', 'lancer_dump_burn', 'napalm',
]);

const MELEE_LIGHT = new Set<string>([
  'knife', 'baton', 'melee',
]);

const MELEE_BREACH = new Set<string>([
  'crowbar', 'shovel', 'sword', 'sledge',
]);

const LIGHT_EXPLOSIVES = new Set<string>([
  'grenade', 'mgl', 'barrel', 'mortar', 'enemy_rocket', 'sapper', 'sapper_charge',
  'shell', 'explosive', 'bomber', 'jackal_agl', 'jackal_auto_agl',
  'ac130_wp', 'chopper_rocket', 'test', 'team_shell',
]);

const HEAVY_EXPLOSIVES = new Set<string>([
  'rocket', 'quiver', 'satchel', 'c4', 'atgm', 'missile', 'airstrike',
  'kestrel_rocket', 'harrier_rocket', 'warthog_rocket', 'hornet_rocket',
  'aegis_atgm', 'kestrel_atgm', 'warthog_atgm', 'harrier_atgm',
]);

const ARMOR_ORDNANCE = new Set<string>([
  'tank_cannon', 'aegis_cannon', 'enemy_tank_cannon', 'tank',
  'frame_40mm', 'frame_40mm_ap', 'frame_stomp', 'frame_charge', 'frame_crush',
  'frame_backhand', 'frame_pod', 'frame_beam', 'frame_rail', 'frame_plasma',
  'frame_sword', 'frame_sword_impale', 'frame_sword_wave', 'frame_shield_bash',
  'frame_bunker_jab', 'frame_bunker_charged', 'frame_nova',
  'ac130', 'ac130_40mm', 'ac130_40mm_ap', 'warthog', 'orbital', 'black_sun',
  'drop_pod',
]);

const SIEGE_ORDNANCE = new Set<string>([
  'bomb', 'howitzer', 'frame_howitzer', 'ac130_105mm', 'ac130_bomb',
  'hazard_chain', 'breach_charge', 'hydraulic_overload',
  'warthog_bomb', 'harrier_bomb', 'hornet_bomb', 'raptor_bomb', 'lancer_bomb',
  'warthog_thermobaric', 'harrier_thermobaric', 'lancer_thermobaric',
  'warthog_cluster', 'harrier_cluster', 'lancer_cluster',
  'warthog_chute', 'harrier_chute', 'lancer_chute',
  'aegis_kamikaze', 'warthog_kamikaze', 'harrier_kamikaze',
]);

/** Classifies any weapon, vehicle weapon, call-in, or vehicle ram source string into a semantic DamageClass. */
export function classifyDamageSource(source: string): DamageClass {
  if (!source) return 'small_arms';
  if (source === 'nuke') return 'nuke';
  if (source === 'ram_heavy' || source === 'tank_ram' || source === 'aegis_ram') return 'ram_heavy';
  if (source === 'ram_medium' || source === 'bastion_ram') return 'ram_medium';
  if (source === 'ram_light' || source === 'vehicle_ram') return 'ram_light';

  if (SIEGE_ORDNANCE.has(source)) return 'siege_ordnance';
  if (ARMOR_ORDNANCE.has(source)) return 'armor_ordnance';
  if (HEAVY_EXPLOSIVES.has(source)) return 'heavy_explosive';
  if (LIGHT_EXPLOSIVES.has(source)) return 'light_explosive';
  if (AUTOCANNONS.has(source)) return 'autocannon';
  if (HEAVY_MGS.has(source)) return 'heavy_mg';
  if (SHOTGUNS.has(source)) return 'shotgun';
  if (FIRE_SOURCES.has(source)) return 'fire';
  if (MELEE_BREACH.has(source)) return 'melee_breach';
  if (MELEE_LIGHT.has(source)) return 'melee_light';
  if (SMALL_ARMS.has(source)) return 'small_arms';

  // Pattern fallbacks for dynamically composed vehicle / Frame / call-in source names
  if (source.endsWith('_bomb') || source.endsWith('_thermobaric') || source.endsWith('_cluster') || source.endsWith('_chute')) {
    return 'siege_ordnance';
  }
  if (source.endsWith('_napalm')) return 'fire';
  if (source.endsWith('_cannon')) return source.startsWith('aegis') || source.startsWith('tank') ? 'armor_ordnance' : 'autocannon';
  if (source.endsWith('_atgm') || source.endsWith('_rocket')) return 'heavy_explosive';
  if (source.endsWith('_agl') || source.endsWith('_mortar')) return 'light_explosive';
  if (source.endsWith('_hmg') || source.endsWith('_vulcan') || source.endsWith('_m134')) return 'heavy_mg';
  if (source.endsWith('_mg')) return 'small_arms';
  if (source.endsWith('_kamikaze') || source.endsWith('_wreck')) return 'heavy_explosive';
  if (source.startsWith('frame_')) return 'armor_ordnance';
  return 'small_arms';
}

// ---------------------------------------------------------------------------------------------
// Material x DamageClass Capability & Multiplier Matrix
// ---------------------------------------------------------------------------------------------

/**
 * Multiplier table: 0 means blocked (bounces / cosmetic chips only).
 * > 0 means the source damages and can breach/destroy this structural material.
 */
const MATERIAL_DAMAGE_MATRIX: Readonly<Record<StructuralMaterial, Readonly<Partial<Record<DamageClass, number>>>>> = {
  glass: {
    small_arms: 1.5,
    shotgun: 2.5,
    heavy_mg: 3.0,
    autocannon: 4.0,
    fire: 1.0,
    melee_light: 2.0,
    melee_breach: 3.0,
    light_explosive: 4.0,
    heavy_explosive: 6.0,
    armor_ordnance: 8.0,
    siege_ordnance: 10.0,
    nuke: 100,
    ram_light: 6.0,
    ram_medium: 10.0,
    ram_heavy: 14.0,
  },
  drywall: {
    // Small arms do NOT collapse drywall panels (they penetrate / chip cosmestically).
    shotgun: 1.1,
    heavy_mg: 1.6,
    autocannon: 2.4,
    fire: 0.7,
    melee_breach: 1.4,
    light_explosive: 2.4,
    heavy_explosive: 3.5,
    armor_ordnance: 4.5,
    siege_ordnance: 8.0,
    nuke: 100,
    ram_light: 2.8,
    ram_medium: 5.5,
    ram_heavy: 10.0,
  },
  timber: {
    // Small arms & light shotguns CANNOT destroy wooden shacks / watchtower stilts!
    heavy_mg: 1.35,
    autocannon: 2.2,
    fire: 0.9,
    melee_breach: 0.55,
    light_explosive: 2.0,
    heavy_explosive: 3.2,
    armor_ordnance: 4.2,
    siege_ordnance: 8.0,
    nuke: 100,
    ram_medium: 3.5,
    ram_heavy: 8.0,
  },
  masonry: {
    // Brick / cinderblock: immune to small arms, shotguns, HMGs, and light/medium vehicle rams.
    autocannon: 0.85,
    light_explosive: 1.2,
    heavy_explosive: 2.2,
    armor_ordnance: 3.0,
    siege_ordnance: 7.0,
    nuke: 100,
    ram_heavy: 4.5,
  },
  concrete: {
    // Poured concrete buildings (offices, parking garages): immune to small arms, HMGs, light frags, and light/medium rams.
    // Heavy explosives (satchels, rockets, tank shells, 40mm, howitzers, bombs, Frame strikes) blow them apart!
    heavy_explosive: 1.6,
    armor_ordnance: 2.4,
    siege_ordnance: 6.5,
    nuke: 100,
  },
  heavy_steel: {
    // Legacy Tier-2 heavy armored industrial steel (Cannery, Quay Crane, heavy wall pillars).
    armor_ordnance: 2.2,
    siege_ordnance: 7.0,
    nuke: 100,
  },
  reinforced_concrete: {
    // Tier-3 military concrete bunkers & Iron Bastion fortifications: siege ordnance ONLY (tanks CANNOT ram through!).
    siege_ordnance: 6.0,
    nuke: 100,
  },
};

/** Exact legacy per-source multipliers preserved for tuning parity on ordnance & explosives. */
export const DESTRUCTION_SOURCE_MULT: Readonly<Record<string, number>> = {
  howitzer: 8.0,
  satchel: 3.2,
  frame_howitzer: 8.0,
  ac130_105mm: 8.0,
  ac130_bomb: 12.0,
  ac130_40mm_ap: 2.5,
  ac130_40mm: 2.2,
  ac130_wp: 1.8,
  ac130_25mm: 0.9,
  frame_40mm_ap: 2.5,
  frame_40mm: 2.2,
  frame_stomp: 4.5,
  frame_charge: 4.5,
  frame_crush: 4.5,
  frame_backhand: 3.0,
  frame_pod: 2.5,
  tank_cannon: 4.0,
  aegis_cannon: 4.0,
  hazard_chain: 2.5,
  breach_charge: 2.5,
  hydraulic_overload: 3.0,
  warthog_bomb: 9.0,
  harrier_bomb: 9.0,
  lancer_bomb: 10.0,
  nuke: 100,
};

/** Infers the physical StructuralMaterial from legacy `tier` and render `mat` when not explicitly specified. */
export function resolveStructuralMaterial(
  tier: DestructionTier,
  mat: Mat,
  explicit?: StructuralMaterial,
): StructuralMaterial {
  if (explicit) return explicit;
  if (mat === 'glass') return 'glass';
  if (tier === 0) {
    if (mat === 'plaster') return 'drywall';
    return 'timber';
  }
  if (tier === 1) return 'masonry';
  if (tier === 2) return 'heavy_steel';
  return 'reinforced_concrete';
}

/** Legacy DestructionTier mapping used by `canDamageTier` and `damageMultiplierFor`. */
export function materialForLegacyTier(tier: DestructionTier): StructuralMaterial {
  if (tier === 0) return 'timber';
  if (tier === 1) return 'masonry';
  if (tier === 2) return 'heavy_steel';
  return 'reinforced_concrete';
}

/** Returns true if `source` can structurally damage the given `material`. */
export function canDamageMaterial(material: StructuralMaterial, source: string): boolean {
  const cls = classifyDamageSource(source);
  const base = MATERIAL_DAMAGE_MATRIX[material][cls] ?? 0;
  return base > 0;
}

/** Returns the effective damage multiplier for `source` against `material` (0 when blocked). */
export function damageMultiplierForMaterial(material: StructuralMaterial, source: string): number {
  const cls = classifyDamageSource(source);
  const matMult = MATERIAL_DAMAGE_MATRIX[material][cls] ?? 0;
  if (matMult <= 0) return 0;
  const exact = DESTRUCTION_SOURCE_MULT[source];
  if (exact !== undefined) return exact;
  return matMult;
}

/** Maps a VehicleRamClass to its canonical damage source string. */
export function ramSourceFor(ramClass: VehicleRamClass): string {
  if (ramClass === 'heavy') return 'ram_heavy';
  if (ramClass === 'medium') return 'ram_medium';
  return 'ram_light';
}

/** Returns true if a vehicle of `ramClass` moving at `speed` (m/s) can smash through `material`. */
export function canVehicleRamMaterial(
  material: StructuralMaterial,
  ramClass: VehicleRamClass,
  speed: number,
): boolean {
  const props = STRUCTURAL_MATERIAL_PROPS[material];
  if (speed < props.ramMinSpeed) return false;
  return canDamageMaterial(material, ramSourceFor(ramClass));
}

/** Backwards-compatible tier check delegating to the overhauled material matrix. */
export function canDamageTier(tier: DestructionTier, source: string): boolean {
  return canDamageMaterial(materialForLegacyTier(tier), source);
}

/** Backwards-compatible tier multiplier delegating to the overhauled material matrix. */
export function damageMultiplierFor(tier: DestructionTier, source: string): number {
  return damageMultiplierForMaterial(materialForLegacyTier(tier), source);
}

/** Returns a concise tactical feed hint when a player hits an armored material with an ineffective source. */
export function blockedHintFor(
  material: StructuralMaterial,
  source: string,
): { text: string; color: string } | null {
  const cls = classifyDamageSource(source);
  if (material === 'timber' && (cls === 'small_arms' || cls === 'melee_light')) {
    return { text: 'TIMBER STRUCTURE — .50 CAL, HMG OR EXPLOSIVES REQUIRED', color: '#d8b464' };
  }
  if (material === 'masonry' && (cls === 'small_arms' || cls === 'heavy_mg')) {
    return { text: 'MASONRY WALL — EXPLOSIVES OR HEAVY ARMOR REQUIRED', color: '#e6a855' };
  }
  if (material === 'concrete' && (cls === 'small_arms' || cls === 'heavy_mg' || cls === 'light_explosive' || cls === 'ram_light' || cls === 'ram_medium')) {
    return { text: 'CONCRETE STRUCTURE — HEAVY EXPLOSIVES OR TANK CANNON REQUIRED', color: '#f5a623' };
  }
  if (material === 'heavy_steel' && (cls === 'heavy_explosive' || cls === 'light_explosive')) {
    return { text: 'HEAVY ARMOR — FRAME ORDNANCE OR TANK CANNON REQUIRED', color: '#f5a623' };
  }
  if (material === 'reinforced_concrete' && (cls === 'heavy_explosive' || cls === 'light_explosive' || cls === 'armor_ordnance' || cls === 'ram_heavy')) {
    return { text: 'REINFORCED CONCRETE BUNKER — 105MM HOWITZER, BOMBS OR NUKE REQUIRED', color: '#ff6b4a' };
  }
  return null;
}
