/**
 * A hit as it crosses the wire to the screens that only show it (hits.ts): the round's inputs and the host's findings, as
 * ids and whole numbers. Never the gore: each screen feeds this to the same damage model and makes its own.
 *
 * A point is in millimetres (what gore seeds a broken trunk's pieces from, src/gore/torso.ts, so every screen breaks it
 * the same way), a direction in 127ths, an amount and a force in tenths. The cause is not the whole `DamageInfo` a guest's
 * claim carries (that one the host's damage model has to decide by): only what showing the hit needs.
 */
import * as THREE from 'three';
import type { AmmoLoad, DamageInfo, DamageType, HeadOutcome } from '../../core/contracts';
import type { ArmourOutcome } from '../../core/gameplay';
import type { BlastOutcome } from '../../enemies/blast';
import { newFacts, type HitFacts, type HitStop, type KillFacts } from '../../enemies/damage';
import type { ReactionLevel } from '../../enemies/reactions';
import { WEAPONS } from '../../weapons/data';
import { ENEMY_IDS, REGIONS } from './wire';

const TYPES: readonly DamageType[] = ['bullet', 'pellet', 'explosive', 'melee', 'slash', 'fire', 'shock', 'crush', 'true'];
const LOADS: readonly (AmmoLoad | undefined)[] = [undefined, 'ap', 'hp', 'plusP', 'flechette', 'api', 'dragon'];
const TORSOS: readonly DamageInfo['torso'][] = [undefined, 'crack', 'waist', 'blowout'];
const STOPS: readonly HitStop[] = ['none', 'plate', 'shield', 'ward', 'entrance'];
const ARMOURS: readonly (ArmourOutcome | undefined)[] = [undefined, 'stopped', 'through', 'broken'];
const LEVELS: readonly ReactionLevel[] = ['flinch', 'stagger', 'fall', 'felled', 'thrown'];
/** Index 0 is "none". Order is the wire's: add at the end. */
const BLASTS: readonly (BlastOutcome | null)[] = [null, 'gib', 'waist', 'head', 'limbs', 'armLeg', 'arm', 'burn', 'flesh', 'limb', 'scorch', 'thrown', 'dazed', 'parts', 'sparks'];
/** Sources both ends know by number: every gun, every enemy, and the world's own. Anything else goes as its name. */
const SOURCES: readonly string[] = [...Object.keys(WEAPONS), ...ENEMY_IDS, 'bleed', 'burn', 'hazard', 'trample', 'fell', 'crash', 'grenade', 'coop'];

const BIT = { gib: 1, pierces: 2, armorPiercing: 4, vaporize: 8, spill: 16, torso: 32 /* two bits */, slice: 128 } as const;

/**
 * [type, bone, region, x, y, z, dx, dy, dz, amount, force, bits, source, load] and, for a cut along a plane, its normal.
 * `bone` and `region` are -1 when the hit had none.
 */
export type WireHit = (number | string)[];

const int = (value: number, scale: number, most: number): number => Math.max(-most, Math.min(most, Math.round(value * scale)));

export function packHit(d: DamageInfo): WireHit {
  const source = SOURCES.indexOf(d.source);
  const out: WireHit = [
    TYPES.indexOf(d.type), d.bone ?? -1, d.region ? REGIONS.indexOf(d.region) : -1,
    int(d.point.x, 1000, 1e8), int(d.point.y, 1000, 1e8), int(d.point.z, 1000, 1e8),
    int(d.dir.x, 127, 127), int(d.dir.y, 127, 127), int(d.dir.z, 127, 127),
    int(d.amount, 10, 1e7), int(d.force, 10, 1e7),
    (d.gib ? BIT.gib : 0) | (d.pierces ? BIT.pierces : 0) | (d.armorPiercing ? BIT.armorPiercing : 0) | (d.vaporize ? BIT.vaporize : 0)
      | (d.spill ? BIT.spill : 0) | Math.max(0, TORSOS.indexOf(d.torso)) * BIT.torso | (d.slicePlaneNormal ? BIT.slice : 0),
    source >= 0 ? source : d.source.slice(0, 32),
    Math.max(0, LOADS.indexOf(d.load)),
  ];
  const n = d.slicePlaneNormal;
  if (n) out.push(int(n.x, 127, 127), int(n.y, 127, 127), int(n.z, 127, 127));
  return out;
}

const whole = (value: unknown, least: number, most: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most;

/** The damage back from the wire, or null for anything that is not one. `bones` is how many the struck rig has. */
export function unpackHit(wire: unknown, bones = 256): DamageInfo | null {
  if (!Array.isArray(wire) || wire.length < 14 || wire.length > 17) return null;
  const [type, bone, region, x, y, z, dx, dy, dz, amount, force, bits, source, load] = wire as unknown[];
  if (!whole(type, 0, TYPES.length - 1) || !whole(bone, -1, 255) || !whole(region, -1, REGIONS.length - 1) || !whole(bits, 0, 255)
    || !whole(load, 0, LOADS.length - 1) || !whole(amount, 0, 1e7) || !whole(force, 0, 1e7)) return null;
  for (const axis of [x, y, z]) if (!whole(axis, -1e8, 1e8)) return null;
  for (const axis of [dx, dy, dz]) if (!whole(axis, -127, 127)) return null;
  const name = typeof source === 'string' ? source.slice(0, 32) : whole(source, 0, SOURCES.length - 1) ? SOURCES[source]! : null;
  if (name === null) return null;
  const dir = new THREE.Vector3(dx as number, dy as number, dz as number);
  if (dir.lengthSq() < 1) dir.set(0, 1, 0);
  const d: DamageInfo = {
    amount: amount / 10, type: TYPES[type]!, point: new THREE.Vector3((x as number) / 1000, (y as number) / 1000, (z as number) / 1000),
    dir: dir.normalize(), force: force / 10, source: name,
  };
  if (bone >= 0 && bone < bones) d.bone = bone;
  if (region >= 0) d.region = REGIONS[region];
  if (bits & BIT.gib) d.gib = true;
  if (bits & BIT.pierces) d.pierces = true;
  if (bits & BIT.armorPiercing) d.armorPiercing = true;
  if (bits & BIT.vaporize) d.vaporize = true;
  if (bits & BIT.spill) d.spill = true;
  d.torso = TORSOS[(bits >> 5) & 3];
  d.load = LOADS[load];
  if (bits & BIT.slice) {
    const [nx, ny, nz] = wire.slice(14) as unknown[];
    if (!whole(nx, -127, 127) || !whole(ny, -127, 127) || !whole(nz, -127, 127)) return null;
    const normal = new THREE.Vector3(nx, ny, nz);
    if (normal.lengthSq() < 1) return null;
    d.slicePlaneNormal = normal.normalize();
  }
  return d;
}

/** The host's findings about a hit: [amount, bits, plate, strength]. Strength is in hundredths. */
export type WireFacts = [number, number, number, number];

/** stop 3 bits, armour 2, broke, headshot, level 3, knockout, tripped, blast 4. */
export function packFacts(f: HitFacts): WireFacts {
  const bits = STOPS.indexOf(f.stop) | Math.max(0, ARMOURS.indexOf(f.armour)) << 3 | (f.broke ? 32 : 0) | (f.headshot ? 64 : 0)
    | LEVELS.indexOf(f.level) << 7 | (f.knockout ? 1024 : 0) | (f.tripped ? 2048 : 0) | Math.max(0, BLASTS.indexOf(f.blast)) << 12;
  return [int(f.amount, 10, 1e7), bits, f.plate, int(f.strength, 100, 100)];
}

export function unpackFacts(wire: unknown, out: HitFacts = newFacts()): HitFacts | null {
  if (!Array.isArray(wire) || wire.length !== 4) return null;
  const [amount, bits, plate, strength] = wire as unknown[];
  if (!whole(amount, 0, 1e7) || !whole(bits, 0, 0xffff) || !whole(plate, -1, 31) || !whole(strength, 0, 100)) return null;
  const stop = STOPS[bits & 7];
  const level = LEVELS[(bits >> 7) & 7];
  const blast = BLASTS[(bits >> 12) & 15];
  if (stop === undefined || level === undefined || blast === undefined) return null;
  out.amount = amount / 10;
  out.stop = stop;
  out.armour = ARMOURS[(bits >> 3) & 3];
  out.broke = (bits & 32) !== 0;
  out.headshot = (bits & 64) !== 0;
  out.level = level;
  out.knockout = (bits & 1024) !== 0;
  out.tripped = (bits & 2048) !== 0;
  out.blast = blast;
  out.plate = plate;
  out.strength = strength / 100;
  return out;
}

/**
 * What the host found about a kill, in one number: the blast's roll (4 bits), frozen (bit 4), a very damaging round to the
 * head (bit 5), the rolled head outcome (bits 6..8), and above those the health the killing hit took, in tenths (its wound's size).
 */
const HEAD_OUTCOMES: readonly (HeadOutcome | undefined)[] = [undefined, 'hole', 'partial', 'burst', 'off'];

export const packKill = (k: KillFacts): number =>
  (Math.max(0, BLASTS.indexOf(k.blast))
    | (k.shatter ? 16 : 0)
    | (k.heavyHead ? 32 : 0)
    | (Math.max(0, HEAD_OUTCOMES.indexOf(k.headOutcome)) << 6))
  + int(Math.max(0, k.wound ?? 0), 10, 1e7) * 512;

export function unpackKill(wire: unknown): KillFacts {
  const all = whole(wire, 0, 512e7 + 511) ? wire : 0;
  const bits = all % 512;
  const out: KillFacts = {
    blast: BLASTS[bits & 15] ?? null,
    shatter: (bits & 16) !== 0,
    heavyHead: (bits & 32) !== 0,
    wound: Math.floor(all / 512) / 10,
  };
  const headOutcome = HEAD_OUTCOMES[(bits >> 6) & 7];
  if (headOutcome !== undefined) out.headOutcome = headOutcome;
  return out;
}

/**
 * Why the host did not apply a claim, by number on the wire (add at the end only): `gone` (the enemy was already dead on the
 * host: the death is on its way or has come), then the validator's reasons (authority.ts `RejectReason`).
 */
export const NACK_REASONS = ['gone', 'shape', 'down', 'eye', 'range', 'point', 'rate', 'hits', 'flood', 'sight', 'replay'] as const;
export type NackReason = typeof NACK_REASONS[number];
/** The host's "no" to a guest's hit: [the hit's number (`DamageInfo.claim`), the enemy, why]. */
export type WireNack = [number, number, number];

export const packNack = (claim: number, uid: number, why: NackReason): WireNack => [claim, uid, Math.max(0, NACK_REASONS.indexOf(why))];

export function unpackNack(wire: unknown): { claim: number; uid: number; why: NackReason } | null {
  if (!Array.isArray(wire) || wire.length !== 3) return null;
  const [claim, uid, why] = wire as unknown[];
  if (!whole(claim, 1, 0xffff) || !whole(uid, 0, Number.MAX_SAFE_INTEGER) || !whole(why, 0, NACK_REASONS.length - 1)) return null;
  return { claim, uid, why: NACK_REASONS[why]! };
}
