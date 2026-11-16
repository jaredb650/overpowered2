/**
 * The radio net (docs/design/squad-comms.md, "Radio and multi-squad coordination"). Each squad has one radio operator: its first
 * rifleman who is not the leader, or the leader when there is nobody else. He is the squad's voice to the others.
 *
 *   contact report   "Bravo, Charlie. Contact, one hostile, 40 metres south." Another squad's operator answers "Copy."
 *   status           "Charlie is down to two."
 *   squad wiped      another squad's operator: "Delta's been wiped!"
 *   operator killed  his line dies in static if he was talking. Then another operator: "Charlie, say again?", "Charlie, radio check,
 *                    over." and, with nobody answering, "We lost Charlie." Unless a Charlie survivor grabs the set: "This is Charlie,
 *                    Rook's dead, we need help!" and carries it from then on
 *
 * Lines only: who knows where the player is still travels as before (index.ts `radio`). Every call is timed on the AI clock
 * (`Comms.after`), so a moment that has passed when its turn comes is looked up again then.
 */
import type { Outpost } from '../index';
import { FEAR } from '../morale';
import type { Soldier } from '../soldier';
import type { OutpostSquad } from '../squad';

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Chance a survivor picks the set up instead of the net losing the squad. */
const GRAB = 0.6;
const WORDS = ['nobody', 'one', 'two', 'three'];

/** The eight-point compass from `from` to `to`, north being -z. */
export function cardinal(dx: number, dz: number): string {
  const a = Math.atan2(dx, -dz);
  return POINTS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]!;
}

/** The operator of the nearest other squad still on the net, or null. */
export function listener(o: Outpost, from: OutpostSquad): Soldier | null {
  let best: Soldier | null = null;
  let near = Infinity;
  const at = from.radioman?.e.position ?? from.leader?.e.position ?? null;
  for (const q of o.squads) {
    const r = q.radioman;
    if (q === from || !r || !r.fighting || !q.members.includes(r)) continue;
    const d = at ? r.e.position.distanceToSquared(at) : 0;
    if (d < near) {
      near = d;
      best = r;
    }
  }
  return best;
}

/** After a squad's own "Contact!": its operator puts it on the net. */
export function contactReport(o: Outpost, squad: OutpostSquad): void {
  const r = squad.radioman;
  if (!r || !r.fighting) return;
  const p = o.w.player.position;
  const dx = p.x - r.e.position.x;
  const dz = p.z - r.e.position.z;
  const to = listener(o, squad);
  o.comms.say('contactReport', r, null, {
    slots: { squad: squad.name, to: to ? to.squad.name : 'All units', range: `${Math.max(10, Math.round(Math.hypot(dx, dz) / 10) * 10)} metres`, cardinal: cardinal(dx, dz) },
  });
}

/** After a loss: the squad's state on the net, a wiped squad reported by its neighbour, and a dead operator looked for. */
export function radioLoss(o: Outpost, squad: OutpostSquad, dead: Soldier | null): void {
  const left = squad.members.filter(m => m.fighting).length;
  if (left === 0) {
    o.memory.wiped.push(squad.name);
    const r = listener(o, squad);
    if (r) o.comms.say('squadWiped', r, null, { slots: { squad: squad.name } });
    return;
  }
  if (dead && dead === squad.radioman) {
    squad.radioman = null;
    radioCheck(o, squad, dead);
    return;
  }
  if (left <= 2 && squad.radioman) o.comms.say('status', squad.radioman, null, { slots: { squad: squad.name, count: WORDS[left]! } });
}

function radioCheck(o: Outpost, squad: OutpostSquad, dead: Soldier): void {
  const slots = { squad: squad.name };
  o.comms.after(1.5, () => {
    const r = listener(o, squad);
    if (r) o.comms.say('sayAgain', r, null, { slots });
  });
  o.comms.after(4, () => {
    const r = listener(o, squad);
    if (r) o.comms.say('radioCheck', r, null, { slots });
  });
  o.comms.after(7, () => {
    const survivor = squad.members.find(m => m.fighting && !m.injuries.mute) ?? null;
    if (survivor && !squad.radioman && Math.random() < GRAB) {
      squad.radioman = survivor;
      o.comms.say('radioGrab', survivor, dead, { slots });
      return;
    }
    const r = listener(o, squad);
    if (!r) return;
    o.comms.say('radioLost', r, null, { slots });
    for (const m of r.squad.members) if (m.fighting) o.scare(m, FEAR.allyDown * 0.5);
  });
}
