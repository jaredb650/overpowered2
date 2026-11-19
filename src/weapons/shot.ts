/**
 * A gun's hitscan round as `Combat.fireRay` wants it: the row's numbers, with the perks in force over them. One function, so
 * the player's own shots (Weapons.ts) and a friend's drawn on this screen in co-op (watch.ts) are filled the same way.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { ShotSpec, WeaponModifiers } from '../core/gameplay';
import { TUNING, type WeaponDef } from './data';
import { PIERCE_ON } from './penetration';

/** `?reach=0` takes range falloff out of every gun: the SMG and the Rivet hit as hard at 100 m as at 10. */
const REACH_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('reach') !== '0';

/** Fills `s`, the caller's scratch, for one round of `def` drawn from `muzzle`. `damage` is the round's, perks included. */
export function fillShot(s: ShotSpec, def: WeaponDef, damage: number, m: WeaponModifiers, muzzle: THREE.Vector3): ShotSpec {
  const explosive = m.explosiveRounds;
  s.damage = explosive ? damage * TUNING.hellfireRounds.damageMult : damage;
  s.source = def.id;
  s.team = 'player';
  s.maxDistance = undefined;
  s.tracer = m.tracer ?? def.tracer;
  s.pierce = 0;
  s.force = def.force;
  s.severMult = m.alwaysSever ? 1000 : def.canSever ? def.severMult : 0;
  s.blastRadius = explosive ? TUNING.hellfireRounds.radius : undefined;
  s.ricochet = m.ricochet;
  s.shock = m.shockRounds;
  s.headshotMult = def.headshotMult;
  s.tracerFrom = muzzle;
  s.type = def.pellets > 1 ? 'pellet' : 'bullet';
  // A round heavy enough to burst what it kills does so by its row's odds, rolled a round.
  s.gib = def.gib !== undefined && Math.random() < def.gib;
  s.burst = def.burst;
  s.killStop = def.killStop ?? 0;
  s.impactScale = def.impactScale ?? 1;
  s.headHops = def.headHops ? def.headHops + m.ricochet : 0;
  s.penetrate = PIERCE_ON ? def.penetration : 0;
  s.bodyCost = def.bodyCost;
  s.penetrateKeep = undefined;
  s.penetrateWalls = undefined;
  s.armorPiercing = def.armorPiercing ?? false;
  s.load = def.load;
  s.armour = def.armour;
  s.falloff = REACH_ON ? def.falloff : undefined;
  s.cleave = 0;
  return s;
}

const UP = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3();
const _at = new THREE.Vector3();
const _back = new THREE.Vector3();

/**
 * A launcher tube venting out of the back of the block: smoke over the shoulder and a spit of sparks, where anyone behind
 * sees it. From `eye`, looking along `forward`: the player's own, or a friend's on this screen.
 */
export function backblast(ctx: Ctx, eye: THREE.Vector3, forward: THREE.Vector3): void {
  const right = _right.crossVectors(forward, UP).normalize();
  const at = _at.copy(eye).addScaledVector(forward, -0.9).addScaledVector(right, 0.3);
  at.y -= 0.08;
  ctx.fx.smoke(at, 0xb9b4aa, 0.8, 1.3);
  ctx.fx.sparks(at, _back.copy(forward).negate(), 5, 0xffa040);
  ctx.fx.smoke(at.addScaledVector(forward, -1.2), 0x989389, 1.3, 1.9);
}
