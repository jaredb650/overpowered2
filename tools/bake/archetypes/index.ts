import type { ArchetypeDef } from '../../../src/characters/archetypes';
import type { Socket } from '../../../src/characters/format';
import type { Model } from '../model';
import type { Sk } from '../parts/skeleton';
import { contractor } from './contractor';
import { bomber, drone, husk, juggernaut, leaper, skitter, stalker, titan, warden } from './creatures';
import { brute, burner, gunner, riot, rocketeer, sniper, trooper } from './soldiers';

export type Builder = (m: Model, sk: Sk, def: ArchetypeDef) => Record<string, Socket>;

export const BUILDERS: Record<string, Builder> = {
  husk, trooper, gunner, brute, stalker, rocketeer, sniper, riot, leaper, bomber, burner, warden, juggernaut, titan, skitter, drone, contractor,
};
