/**
 * The cast. Pure data with no three.js dependency, so the offline baker and the runtime read one source.
 * `proportions.scale` is applied at export: models are built at human scale and scaled up, so one body
 * kit serves everything from a husk to the Titan.
 */
import { droneRig, humanoidRig, skitterRig, type HumanoidProportions, type RigDef } from './rig';

export interface ArchetypeDef {
  id: string;
  name: string;
  rig: 'humanoid' | 'skitter' | 'drone';
  proportions: HumanoidProportions;
  /** The one colour that identifies this enemy at range. sRGB 0..1. */
  accent: readonly [number, number, number];
  /** Triangle budget after simplification. */
  tris: number;
  /** Baked props spawned with the character, and the sockets they mount on. */
  props: readonly { model: string; socket: string }[];
  /** 'flesh' stumps bleed, 'machine' stumps spark. */
  stumps: 'flesh' | 'machine';
  /** Gait character: how heavily this body moves. 0 nimble, 1 ground-shaking. */
  weight: number;
  /** What the upper body does at rest and while aiming. */
  stance: 'unarmed' | 'rifle' | 'pistol' | 'shoulder' | 'heavy' | 'blades' | 'shield' | 'staff';
  /** Not one of the enemy cast: `load()` with no list and `archetypes()` leave it out, so only a caller who names it pays for it. */
  onRequest?: boolean;
}

const h = (scale: number, bulk: number, reach: number): HumanoidProportions => ({ scale, bulk, reach });
const hex = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255] as const;

const def = (
  id: string, name: string, p: HumanoidProportions, accent: number, tris: number,
  stance: ArchetypeDef['stance'], weight: number, props: ArchetypeDef['props'] = [],
): ArchetypeDef => ({ id, name, rig: 'humanoid', proportions: p, accent: hex(accent), tris, props, stumps: 'flesh', weight, stance });

export const ARCHETYPES: readonly ArchetypeDef[] = [
  def('husk', 'Husk', h(1, 0.88, 1.12), 0xa8ff3c, 12000, 'unarmed', 0.1),
  def('trooper', 'Trooper', h(1, 1, 1), 0x26d9ff, 13000, 'rifle', 0.25, [{ model: 'smg', socket: 'handR' }, { model: 'trooperHelmet', socket: 'head' }]),
  def('gunner', 'Gunner', h(1.04, 1.14, 1), 0xffb020, 13000, 'rifle', 0.35, [{ model: 'shotgun', socket: 'handR' }, { model: 'gunnerHelmet', socket: 'head' }]),
  def('brute', 'Brute', h(1.22, 1.5, 1.08), 0xff2a1a, 14000, 'heavy', 0.7, [{ model: 'minigun', socket: 'handR' }]),
  def('stalker', 'Stalker', h(1.06, 0.84, 1.1), 0xa040ff, 12000, 'blades', 0.05, [{ model: 'blade', socket: 'handR' }, { model: 'blade', socket: 'handL' }]),
  def('rocketeer', 'Rocketeer', h(1.02, 1.08, 1), 0x10ffb0, 13000, 'shoulder', 0.4, [{ model: 'launcher', socket: 'handR' }, { model: 'rocketPack', socket: 'back' }, { model: 'rocketeerHelmet', socket: 'head' }]),
  def('sniper', 'Sniper', h(1.1, 0.86, 1.06), 0xff1060, 12000, 'rifle', 0.2, [{ model: 'sniperRifle', socket: 'handR' }]),
  def('riot', 'Riot', h(1.06, 1.22, 1), 0x2a6cff, 13000, 'shield', 0.5, [{ model: 'riotShield', socket: 'handL' }, { model: 'pistol', socket: 'handR' }, { model: 'riotHelmet', socket: 'head' }]),
  def('leaper', 'Leaper', h(0.96, 0.8, 1.32), 0xff30d0, 12000, 'unarmed', 0.02),
  def('bomber', 'Bomber', h(0.98, 0.98, 1), 0xffd800, 12000, 'unarmed', 0.3, [{ model: 'fuelTank', socket: 'back' }]),
  def('burner', 'Burner', h(1.04, 1.2, 1), 0xff8a20, 13000, 'rifle', 0.45, [{ model: 'flamer', socket: 'handR' }, { model: 'twinTanks', socket: 'back' }]),
  def('warden', 'Warden', h(1.18, 0.98, 1.06), 0xffe9a0, 14000, 'staff', 0.3, [{ model: 'wardenStaff', socket: 'handR' }]),
  def('juggernaut', 'Juggernaut', h(1.72, 1.62, 1.14), 0xff4a10, 22000, 'heavy', 0.92),
  { ...def('titan', 'Titan', h(3.8, 1.4, 1.18), 0xff5a1e, 30000, 'heavy', 1), stumps: 'machine' },
  // The player, for the main menu's background. Nothing fights it, so it is never loaded with the cast.
  { ...def('contractor', 'Contractor', h(1, 1.04, 1), 0xff5a14, 14000, 'unarmed', 0.3), onRequest: true },
  {
    id: 'skitter', name: 'Skitter', rig: 'skitter', proportions: h(1, 1, 1), accent: hex(0xff2030), tris: 6000,
    props: [], stumps: 'machine', weight: 0, stance: 'unarmed',
  },
  {
    id: 'drone', name: 'Drone', rig: 'drone', proportions: h(1, 1, 1), accent: hex(0x66e0ff), tris: 6000,
    props: [], stumps: 'machine', weight: 0, stance: 'unarmed',
  },
];

/** Everything a run can spawn: the list `load()` and `archetypes()` use when nobody names one. */
export const CAST: readonly ArchetypeDef[] = ARCHETYPES.filter(a => !a.onRequest);

export const archetypeById = (id: string): ArchetypeDef => {
  const a = ARCHETYPES.find(x => x.id === id);
  if (!a) throw new Error(`Unknown archetype "${id}"`);
  return a;
};

/** The rig as the game sees it, at final scale. */
export function rigFor(a: ArchetypeDef): RigDef {
  if (a.rig === 'skitter') return skitterRig(a.id);
  if (a.rig === 'drone') return droneRig(a.id);
  return humanoidRig(a.id, a.proportions);
}

/** The rig at modelling scale, which the baker builds against. */
export function unitRigFor(a: ArchetypeDef): RigDef {
  if (a.rig !== 'humanoid') return rigFor(a);
  return humanoidRig(a.id, { ...a.proportions, scale: 1 });
}
