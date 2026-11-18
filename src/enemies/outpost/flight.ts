/**
 * A broken man running. He never leaves the map: he runs from cover to cover, away from every player and out of their sight, and
 * plans again when one closes in. Caught (a player on top of him, or on him for a few seconds, or nowhere left to run), he does one
 * thing, weighed by his nerve, his rank, his wounds and what the player has done to prisoners:
 *
 *   surrender   hands up and on his knees, into the capture flow (prisoners.ts)
 *   fight       cornered-rat courage: a gun again, a last-stand line, and he never breaks again
 *   fake        hands up, and when a player comes close to take him he fumbles at his vest (a rustle, a red glint) before the pin
 *   cower       crouched, arms over his head, shaking and begging. Not a prisoner: he can be shot, and he runs again once nobody is looking
 *   taunt       wounded, he stands his ground and tells the player to get it over with
 *   self        very rare: nerve gone and a player known for shooting prisoners. The pistol goes to his head
 *
 * A man who has been running too long stops: he gives up or he fights, so a wave always ends.
 */
import * as THREE from 'three';
import { HumanoidBone as B } from '../../characters/rig';
import type { DamageInfo } from '../../core/contracts';
import type { Enemy } from '../Enemy';
import type { Outpost } from './index';
import type { Rank } from './rank';
import { pose, type Soldier } from './soldier';
import { dropGrenade, soldierAttacks } from './weapons';

export type Reaction = 'surrender' | 'fight' | 'fake' | 'cower' | 'taunt' | 'self';
export const REACTIONS: readonly Reaction[] = ['surrender', 'fight', 'fake', 'cower', 'taunt', 'self'];

/** Destinations: no nearer than this, no further. */
const RUN_MIN = 8;
const RUN_MAX = 48;
/** Candidates checked for a player's line of sight, best first. */
const SIGHT_CHECKS = 5;
/** A run must end at least this far from every player. */
const SAFE_GAP = 12;
/** A player this close and in sight, and he is caught. */
export const CORNERED = 5;
/** A player this close and in sight for CAUGHT_SECONDS, and he is caught. */
export const CAUGHT_RANGE = 12;
export const CAUGHT_SECONDS = 3.5;
/** A player this close and in sight makes him think again about where he is going, this often. */
export const CHASED_RANGE = 18;
export const REPLAN_SECONDS = 1.6;
/** Seconds of running before he stops for good, one way or the other. */
export const FLEE_LIMIT = 50;
/** Catching his breath at the end of a run, out of sight. */
export const BREATH = [0.5, 1.6] as const;
/** A cowering or taunting man runs again once nobody has seen him for this long. */
const UNSEEN_SECONDS = 2.5;
/** Fake surrender: how close a player comes before the hand goes to the vest, the fumble, and the pin after it. */
export const FAKE_RANGE = 4.5;
export const FUMBLE_SECONDS = 0.9;
const PIN_SECONDS = 1;
/** Self: the pistol comes up, and stays at his head this long. */
const DRAW_SECONDS = 0.7;
const TEMPLE_SECONDS = 1.3;
/** Self needs a man this far gone, and a player who has shot this many prisoners this run. */
export const SELF_MORALE = 4;
export const SELF_EXECUTIONS = 2;

/** Rank's share of each reaction. Veterans fight, conscripts cower. */
const FIGHT: Record<Rank, number> = { conscript: 0.25, regular: 0.4, veteran: 0.65, elite: 0.9 };
const COWER: Record<Rank, number> = { conscript: 0.6, regular: 0.45, veteran: 0.25, elite: 0.1 };
const FAKE = 0.035;
const SELF = 0.07;

export interface CornerFacts {
  morale: number;
  rank: Rank;
  /** Rank's willingness to give up (rank.ts `gives`). */
  gives: number;
  /** Allowed to kneel: doctrine, and not already shot on his knees once. */
  canSurrender: boolean;
  /** A gun to fight with: his own on the floor near him, or a pistol. */
  armed: boolean;
  grenade: boolean;
  /** A pistol and a hand to hold it. */
  pistol: boolean;
  /** 0 whole to 1 dying. */
  wounded: number;
  bravado: boolean;
  /** Prisoners the players have shot, and men they let go, this run. */
  executed: number;
  freed: number;
  /** He has run out of time: only giving up or fighting will do. */
  timeout: boolean;
}

/** Relative odds of each reaction. Zero is not on the table. */
export function cornerWeights(f: CornerFacts): Record<Reaction, number> {
  const mercy = 1 + Math.min(f.freed, 4) * 0.1;
  // Word gets round: a man who knows prisoners get shot does not kneel so easily, and fights or plays dirty instead.
  const dread = 1 + f.executed * 0.5;
  const w: Record<Reaction, number> = {
    surrender: f.canSurrender ? ((0.4 + f.gives) * mercy) / dread : 0,
    fight: f.armed ? FIGHT[f.rank] * (f.bravado ? 1.5 : 1) * (1 + f.executed * 0.25) : 0,
    fake: f.grenade && f.canSurrender && !f.timeout ? FAKE * dread : 0,
    cower: f.timeout ? 0 : COWER[f.rank] * (f.morale < 6 ? 1.3 : 1),
    taunt: !f.timeout && f.wounded >= 0.5 ? 0.6 * f.wounded : 0,
    self: !f.timeout && f.pistol && f.morale <= SELF_MORALE && f.executed >= SELF_EXECUTIONS ? SELF : 0,
  };
  // Out of time with nothing to fight with and nowhere to kneel: he fights with whatever he finds (`fight` reclaims his gun).
  if (f.timeout && w.surrender === 0 && w.fight === 0) w.fight = 1;
  return w;
}

/** One reaction from the weights, by `roll` in [0, 1). */
export function pickReaction(w: Record<Reaction, number>, roll: number): Reaction {
  let total = 0;
  for (const r of REACTIONS) total += w[r];
  let at = roll * total;
  for (const r of REACTIONS) {
    at -= w[r];
    if (at < 0 && w[r] > 0) return r;
  }
  return w.surrender > 0 ? 'surrender' : 'fight';
}

const flat = (a: THREE.Vector3, b: THREE.Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);

/** How far the straight run from `a` to `b` passes from `p`. */
function pastBy(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
}

/**
 * How good a place `to` is to run to from `me`, with every player in `players`: far from all of them, not past one, not a marathon,
 * and out of their sight (`seen`). -Infinity for a place that is no escape at all.
 */
export function fleeScore(me: THREE.Vector3, to: THREE.Vector3, players: readonly THREE.Vector3[], seen: boolean): number {
  const walk = flat(me, to);
  if (walk < RUN_MIN || walk > RUN_MAX) return -Infinity;
  let near = Infinity;
  let past = 0;
  for (const p of players) {
    const d = flat(p, to);
    near = Math.min(near, d);
    const by = pastBy(me, to, p);
    if (by < 6) past += 6 - by;
  }
  if (near < SAFE_GAP) return -Infinity;
  return Math.min(near, 40) - past * 4 - walk * 0.15 - (seen ? 25 : 0) + Math.random() * 4;
}

export interface FleeCandidate {
  at: THREE.Vector3;
  score: number;
}

/** The best few places to run to, best first, before anyone has looked for a line of sight. */
export function bestRuns(me: THREE.Vector3, places: Iterable<THREE.Vector3>, players: readonly THREE.Vector3[], out: FleeCandidate[], n = SIGHT_CHECKS): FleeCandidate[] {
  out.length = 0;
  for (const at of places) {
    const score = fleeScore(me, at, players, false);
    if (score === -Infinity) continue;
    if (out.length < n) out.push({ at, score });
    else if (score > out[out.length - 1]!.score) out[out.length - 1] = { at, score };
    else continue;
    out.sort((a, b) => b.score - a.score);
  }
  return out;
}

/** What he knows about himself and the run, for the weights. */
export function cornerFacts(o: Outpost, s: Soldier, timeout: boolean): CornerFacts {
  const e = s.e;
  const b = s.injuries;
  const gunNear = !!s.droppedAt && s.droppedAt.distanceTo(e.position) < 15;
  const pistol = s.def.sidearm && !s.spentSidearm && !b.armL && !b.handL;
  return {
    morale: s.morale,
    rank: s.rank,
    gives: s.rankDef.gives,
    canSurrender: o.doctrine.surrender && !s.refused && !s.holdout,
    armed: gunNear || (s.def.sidearm && !s.spentSidearm && (!b.armR || !b.armL)),
    grenade: s.grenades > 0 && !b.mute,
    pistol,
    wounded: b.condition === 'mortal' ? 1 : Math.max(0, Math.min(1, 1 - e.health / e.maxHealth)),
    bravado: s.bravado,
    executed: o.captives.executed,
    freed: o.captives.freed,
    timeout,
  };
}

/** Caught. He picks one thing and does it. */
export function corner(o: Outpost, s: Soldier, timeout: boolean, roll = Math.random()): Reaction {
  const r = pickReaction(cornerWeights(cornerFacts(o, s, timeout)), roll);
  const e = s.e;
  const now = o.w.now;
  s.cornerAt = now;
  e.thinkAt = 0;
  e.behaviourUntil = 0;
  switch (r) {
    case 'surrender':
      s.fate = 'surrender';
      break;
    case 'fake':
      s.fate = 'surrender';
      s.fakeRolled = true;
      s.fake = 'waiting';
      break;
    case 'fight':
      fightOn(o, s);
      break;
    case 'cower':
    case 'taunt':
    case 'self':
      s.corner = r;
      break;
  }
  return r;
}

/** Cornered-rat courage. Back in a squad with a gun, and he will not break again. */
function fightOn(o: Outpost, s: Soldier): void {
  const e = s.e;
  const b = s.injuries;
  s.fate = 'none';
  s.corner = 'none';
  s.holdout = true;
  s.morale = Math.max(s.morale, 13);
  s.state = 'panicked';
  e.attacks = soldierAttacks(e.id);
  const gun = s.droppedAt;
  if (gun && gun.distanceTo(e.position) < 15) s.scramble = gun;
  else if (s.def.sidearm && !s.spentSidearm && (!b.armR || !b.armL)) o.wounds.drawSidearm(s, b);
  else o.reclaimWeapon(s);
  o.rejoin(s);
  o.comms.say('lastStand', s);
}

/** Running again, from wherever the cowering or taunting left him. */
export function runAgain(s: Soldier): void {
  s.corner = 'none';
  s.caughtSince = -1;
  s.plannedAt = -99;
  s.e.thinkAt = 0;
}

/**
 * A man on his knees who means to take someone with him. Close enough, and his hand goes to his vest: a rustle, a red glint, a
 * second to see it. Then the line, the pin, and the grenade a second after that. Runs on the morale tick and each frame he kneels.
 */
export function plotting(o: Outpost, s: Soldier, now: number): void {
  const e = s.e;
  if (!s.fake || s.collared || s.cuffed || !s.surrendered) return;
  if (s.fake === 'waiting') {
    if (e.dist > FAKE_RANGE || !e.hasLos) return;
    s.fake = 'fumbling';
    s.fakeAt = now + FUMBLE_SECONDS;
    pose(e, 'fumble');
    o.w.ctx.audio.play('gear_rustle', { position: e.center, volume: 1, pitchJitter: 0.1 });
    o.w.telegraphs.glint(e.center, 0xff2010, 0.45, FUMBLE_SECONDS + PIN_SECONDS);
    return;
  }
  if (s.fake === 'fumbling' && now >= s.fakeAt) {
    s.fake = 'pinned';
    s.fakeAt = now + PIN_SECONDS;
    // The shout is the warning (and the HUD's GRENADE), so it cuts whatever he was still saying.
    o.comms.silence(e);
    o.comms.say('fakeOut', s);
    o.w.ctx.audio.play('grenade_pin', { position: e.center, volume: 0.9 });
    e.char.anim.play('throw', 0.5);
    return;
  }
  if (s.fake === 'pinned' && now >= s.fakeAt) {
    s.fake = null;
    if (s.grenades <= 0) return;
    s.grenades--;
    dropGrenade(e, o.w);
  }
}

const _head = new THREE.Vector3();
const _right = new THREE.Vector3();
const SHOT: DamageInfo = { amount: 0, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: '', region: 'head' };

/** Each frame of the cornered stand-offs that are not a surrender. False once he is running again. */
export function standOff(o: Outpost, s: Soldier, now: number): boolean {
  const e = s.e;
  const seen = e.hasLos && e.dist < 40;
  if (seen) s.watchedAt = now;
  if (s.corner === 'cower' || s.corner === 'taunt') {
    if (now - s.watchedAt > UNSEEN_SECONDS) {
      runAgain(s);
      return false;
    }
    if (s.corner === 'cower') o.comms.say('beg', s);
    // The bravado rows are the "come on, I'm right here" ones.
    else if (seen) o.comms.say('taunt', s, null, { flags: { bravado: true } });
    return true;
  }
  if (s.corner !== 'self') return false;
  const b = s.injuries;
  const since = now - s.cornerAt;
  if (s.selfStage === 0) {
    s.selfStage = 1;
    o.wounds.drawSidearm(s, b, true);
    o.w.ctx.audio.play('weapon_draw', { position: e.center, volume: 0.8 });
    o.comms.say('dying', s);
  } else if (s.selfStage === 1 && since >= DRAW_SECONDS) {
    s.selfStage = 2;
    pose(e, 'temple');
  } else if (s.selfStage === 2 && since >= DRAW_SECONDS + TEMPLE_SECONDS) {
    s.selfStage = 3;
    shootSelf(o, e);
  }
  return true;
}

/** Through the temple, left to right, with his own round: the gore and the death are the damage model's, as for any headshot. */
function shootSelf(o: Outpost, e: Enemy): void {
  (e.char.bones[B.head] ?? e.char.root).getWorldPosition(_head);
  _right.set(-Math.cos(e.yaw), 0, Math.sin(e.yaw));
  SHOT.amount = e.health + 60;
  SHOT.point.copy(_head).addScaledVector(_right, -0.08);
  SHOT.dir.copy(_right);
  SHOT.force = 90;
  SHOT.source = e.id;
  o.w.ctx.audio.play('enemy_pistol', { position: _head, volume: 1.1 });
  o.w.telegraphs.glint(_head, 0xffd27a, 0.35, 0.08);
  o.killOutright(e, SHOT);
}
