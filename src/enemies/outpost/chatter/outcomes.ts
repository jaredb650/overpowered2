/**
 * What a man does when his nerve gives, and what he says about it (docs/design/squad-comms.md, "Low-morale outcomes"). Fighting to
 * the death is never the default: it is a rare, announced choice.
 *
 *   breaking      he runs ("I'm out!") or gives up, as before; or, rarely and by rank, he refuses: "I'm not going down without a
 *                 fight." From then on he never breaks again, and never surrenders
 *   fake surrender  rarely, a man on his knees close to the player shouts, pulls a pin (sound, a HUD cue), and drops a grenade a second
 *                 later, so the blast is never random
 *   revenge       a buddy's death can turn the survivor: a named line, nerve back, and the squad pushes for a moment
 *   taunts        when the player is hurt, a steady man taunts; a man with bravado talks big while his nerve is going ("Is that all
 *                 you got?"), which is the tell that he is about to crack
 */
import type { Outpost } from '../index';
import type { Rank } from '../rank';
import type { Soldier } from '../soldier';
import { dropGrenade } from '../weapons';

/** Chance, by rank, that a man about to break chooses to fight on instead. */
const HOLDOUT: Record<Rank, number> = { conscript: 0.02, regular: 0.05, veteran: 0.12, elite: 0.2 };
/** Chance a surrendered man with a grenade, close and in sight, tries it. Rolled once per man. */
export const FAKE_SURRENDER = 0.06;
const FAKE_RANGE = 10;
const PIN_SECONDS = 1;
/** Chance a buddy's death turns into revenge, and how long the squad pushes for it. */
export const REVENGE = 0.35;
const REVENGE_PUSH = 3;
/** Share of men who talk big. */
export const BRAVADO = 0.25;
const TAUNT_ROLL = 0.08;

/**
 * He has just broken. True when he chose to fight on instead (the caller then leaves him be). Otherwise a runner says so, and the
 * caller collapses him as before.
 */
export function breaking(o: Outpost, s: Soldier, fate: 'surrender' | 'flee'): boolean {
  if (s.holdout || Math.random() < HOLDOUT[s.rank]) {
    if (!s.holdout) o.comms.say('holdout', s);
    s.holdout = true;
    // He stays scared, and he stays: a panicked man still fights.
    s.state = 'panicked';
    s.morale = Math.max(s.morale, 13);
    return true;
  }
  if (fate === 'flee') o.comms.say('flee', s);
  return false;
}

/** A buddy is dead. Sometimes his pair takes it out on the player. */
export function revenge(o: Outpost, survivor: Soldier, dead: Soldier): void {
  if (!survivor.fighting || Math.random() >= REVENGE) return;
  survivor.morale = Math.min(survivor.baseMorale, survivor.morale + 15);
  // A squad wiped earlier this match is the bigger grudge, when there is one.
  const lost = o.memory.wiped.at(-1);
  o.comms.say('revenge', survivor, dead, lost ? { flags: { squadLost: true }, slots: { lost } } : null);
  survivor.squad.opening(REVENGE_PUSH);
}

/** On the morale tick: the fake surrender, and taunts. */
export function tickOutcomes(o: Outpost, now: number): void {
  const { w } = o;
  let taunter: Soldier | null = null;
  const hurt = w.ctx.player.health < w.ctx.player.maxHealth * 0.5;
  for (const s of o.soldiers) {
    const e = s.e;
    if (s.surrendered && !s.fakeRolled && now - s.surrenderedAt > 2 && e.dist < FAKE_RANGE && e.hasLos) {
      s.fakeRolled = true;
      if (s.grenades > 0 && !s.injuries.mute && Math.random() < FAKE_SURRENDER) pullPin(o, s);
    }
    if (!taunter && s.fighting && s.sees && ((hurt && s.state === 'steady') || (s.bravado && (s.state === 'shaken' || s.state === 'panicked')))) taunter = s;
  }
  if (taunter && Math.random() < TAUNT_ROLL) o.comms.say('taunt', taunter, null, { flags: { bravado: taunter.bravado && taunter.state !== 'steady' } });
}

/** Said first, then the pin, then the grenade a second later: the player always gets the warning. */
function pullPin(o: Outpost, s: Soldier): void {
  const { w } = o;
  o.comms.say('fakeOut', s);
  w.ctx.audio.play('grenade_pin', { position: s.e.center, volume: 0.9 });
  s.e.char.anim.play('throw', 0.5);
  o.comms.after(PIN_SECONDS, () => {
    if (!s.e.alive || !s.surrendered || !o.soldiers.includes(s)) return;
    s.grenades--;
    dropGrenade(s.e, w);
  });
}
