/**
 * Outpost Defense's waves on paper (docs/proposals/outpost-defense.md, "The waves", Q5): who comes in each, humans only, escalating
 * and endless, with a boss every fifth wave in the owner's order. Plain data and arithmetic, so the tests read it without a world;
 * `director.ts` turns a plan into men, machines and bosses on the fort.
 */
import type { EnemyId } from '../../core/gameplay';

export type BossKind = 'tanks' | 'choppers' | 'juggernaut' | 'titan' | 'all';

/** Q5: every fifth wave, in this order, then round again harder. The Juggernaut and the Titan are the undead surprise. */
export const BOSS_ORDER: readonly BossKind[] = ['tanks', 'choppers', 'juggernaut', 'titan', 'all'];

export const DIRECTOR = {
  /** Men on foot alive at once. The rest of the wave waits past the fence. Under MAX_ALIVE (48) with room for crews and bosses. */
  aliveCap: 20,
  /** Foot soldiers on wave 1, more each wave, up to the most. Boss waves bring a share of that as an escort. */
  firstMen: 8,
  menPerWave: 2,
  maxMen: 64,
  escort: 0.6,
  /** Seconds of the break before a wave: the economy's 30, longer before a boss so there is time to buy the answer. */
  breakSeconds: 30,
  bossBreak: 40,
  firstBreak: 20,
} as const;

export interface WavePlan {
  wave: number;
  /** Squads on foot, in the order they come in from the fence. Sappers, engineers and mortar crews are in here too. */
  squads: EnemyId[][];
  /** Riflemen who carry a satchel charge for the outer wall or a gate. */
  sappers: number;
  /** Two-man enemy mortar teams for the pits in the field. */
  mortars: number;
  /** Men who build cover in the field, and jump pads over a damaged wall. */
  engineers: number;
  trucks: number;
  humvees: number;
  bombers: number;
  boss: BossKind | null;
  tanks: number;
  choppers: number;
  juggernauts: number;
  titans: number;
}

export const bossFor = (wave: number): BossKind | null => (wave > 0 && wave % 5 === 0 ? BOSS_ORDER[(wave / 5 - 1) % BOSS_ORDER.length]! : null);

/** 0 the first time round the boss order, 1 the second, and so on. */
export const bossRound = (wave: number): number => Math.max(0, Math.floor((Math.floor(wave / 5) - 1) / BOSS_ORDER.length));

export const footMen = (wave: number): number => Math.min(DIRECTOR.firstMen + DIRECTOR.menPerWave * (wave - 1), DIRECTOR.maxMen);

/** Who can turn up in an ordinary squad by now: riflemen and shotgunners from the start, rocketeers from 7, snipers and machine gunners from 10. */
function pool(wave: number): readonly (readonly [EnemyId, number])[] {
  const out: [EnemyId, number][] = [['trooper', 3], ['gunner', 2]];
  if (wave >= 7) out.push(['rocketeer', 1.2]);
  if (wave >= 10) out.push(['sniper', 0.8], ['brute', 1]);
  return out;
}

function pick(list: readonly (readonly [EnemyId, number])[], roll: () => number): EnemyId {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = roll() * total;
  for (const [id, w] of list) {
    r -= w;
    if (r <= 0) return id;
  }
  return list[0]![0];
}

export function planWave(wave: number, roll: () => number = Math.random): WavePlan {
  const boss = bossFor(wave);
  const round = bossRound(wave);
  const plan: WavePlan = {
    wave, squads: [], sappers: 0, mortars: 0, engineers: 0, trucks: 0, humvees: 0, bombers: 0, boss,
    tanks: 0, choppers: 0, juggernauts: 0, titans: 0,
  };
  // Each band keeps what came before it: a wave 12 still has charges, mortars, engineers and trucks.
  plan.sappers = wave <= 3 ? 1 + Math.ceil(wave / 2) : 1 + Math.floor(wave / 8);
  if (wave >= 4) {
    plan.mortars = Math.min(wave <= 6 ? (wave === 6 ? 2 : 1) : 2 + Math.floor((wave - 7) / 6), 4);
    plan.engineers = Math.min(1 + Math.floor((wave - 4) / 3), 4);
  }
  if (wave >= 7) {
    plan.trucks = Math.min(1 + Math.floor((wave - 7) / 4), 3);
    plan.humvees = Math.min(1 + Math.floor((wave - 7) / 5), 2);
  }
  if (wave >= 10) plan.bombers = Math.min(2 + Math.floor((wave - 10) / 3), 8);
  if (boss) {
    const all = boss === 'all';
    plan.tanks = boss === 'tanks' || all ? 1 + round : 0;
    plan.choppers = boss === 'choppers' || all ? 1 + round : 0;
    plan.juggernauts = boss === 'juggernaut' || all ? 1 + round : 0;
    plan.titans = boss === 'titan' || all ? 1 + Math.floor(round / 2) : 0;
    // A boss wave is the boss and an escort, not a full wave with a tank on top.
    plan.trucks = Math.min(plan.trucks, 1);
    plan.humvees = 0;
    plan.bombers = Math.ceil(plan.bombers / 2);
  }

  let men = Math.round(footMen(wave) * (boss ? DIRECTOR.escort : 1));
  const crews = plan.mortars * 2 + plan.engineers;
  men = Math.max(men - crews, 4);
  const list = pool(wave);
  // The sappers lead: the first rifle seats of the first squads.
  let sappersLeft = plan.sappers;
  while (men > 0) {
    const size = Math.min(men >= 7 ? 4 + Math.floor(roll() * 2) : men, men);
    const squad: EnemyId[] = [];
    for (let i = 0; i < size; i++) {
      const sapper = i < 2 && sappersLeft > 0;
      if (sapper) sappersLeft--;
      squad.push(sapper ? 'trooper' : pick(list, roll));
    }
    plan.squads.push(squad);
    men -= size;
  }
  for (let i = 0; i < plan.mortars; i++) plan.squads.push(['trooper', 'trooper']);
  for (let i = 0; i < plan.engineers; i++) plan.squads.push(['trooper']);
  return plan;
}

/** Men the plan sends on foot, not counting truck crews or bosses. */
export const menIn = (plan: WavePlan): number => plan.squads.reduce((n, s) => n + s.length, 0);

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A boss wave's bosses, in capitals: `1 TANK`, `1 TANK, 1 ATTACK HELICOPTER, ...`. Empty on any other wave. */
export function bossLine(plan: WavePlan): string {
  const bosses: string[] = [];
  if (plan.tanks) bosses.push(count(plan.tanks, 'TANK', 'TANKS'));
  if (plan.choppers) bosses.push(count(plan.choppers, 'ATTACK HELICOPTER', 'ATTACK HELICOPTERS'));
  if (plan.juggernauts) bosses.push(count(plan.juggernauts, 'JUGGERNAUT', 'JUGGERNAUTS'));
  if (plan.titans) bosses.push(count(plan.titans, 'TITAN', 'TITANS'));
  return bosses.join(', ');
}

/** The break's line about what is coming, for the HUD under the countdown. */
export function previewLine(plan: WavePlan): string {
  const parts: string[] = [];
  if (plan.boss) parts.push(bossLine(plan));
  const foot = menIn(plan) - plan.mortars * 2 - plan.engineers;
  parts.push(`${count(foot, 'man', 'men')} on foot`);
  if (plan.sappers) parts.push(`${plan.sappers} with charges`);
  if (plan.mortars) parts.push(count(plan.mortars, 'mortar team'));
  if (plan.engineers) parts.push(count(plan.engineers, 'engineer'));
  if (plan.trucks) parts.push(count(plan.trucks, 'troop truck'));
  if (plan.humvees) parts.push(count(plan.humvees, 'scout car'));
  if (plan.bombers) parts.push(count(plan.bombers, 'bomber'));
  const kinds = new Set(plan.squads.flat());
  const extra = [kinds.has('rocketeer') && 'rockets', kinds.has('sniper') && 'snipers', kinds.has('brute') && 'machine guns'].filter(Boolean);
  if (extra.length) parts.push(extra.join(', '));
  return parts.join(', ');
}

export const breakBefore = (wave: number): number => (wave <= 1 ? DIRECTOR.firstBreak : bossFor(wave) ? DIRECTOR.bossBreak : DIRECTOR.breakSeconds);
