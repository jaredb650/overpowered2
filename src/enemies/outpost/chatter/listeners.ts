/**
 * Men hear each other (docs/design/squad-comms.md, "NPCs reacting to each other"). A spoken line is a world event: the men near it
 * act on it. The host only, since only the host's men think.
 *
 *   "Frag out!" / "Flash out!"  anyone near where it will land gets clear of the spot, never onto it
 *   "Rocket out!"               anyone in the back blast steps aside
 *   "I can't move!" and screams the call for help is heard now, not on the next aid round; his buddy comes first
 *   "Gun's down!"               the squad holds and hunkers for a moment, and it costs them nerve
 *
 * "He's blind, push!" needs nothing here: the flash that blinds the player already opens the squads to a rush, and the call is said
 * with it (`Outpost.seizeOpening`).
 */
import * as THREE from 'three';
import type { AiWorld } from '../../aiWorld';
import type { CommsKind } from '../events';
import type { Outpost } from '../index';
import { FEAR } from '../morale';
import { soldierOf, type Soldier } from '../soldier';
import { isGuest } from '../../../core/coop';

/** How close to a frag's landing spot a man must be to move, and where he goes. */
const FRAG_CLEAR = 6.5;
/** Direct lethal blast radius within which even a Commander-directed soldier jumps clear of a frag. */
const FRAG_LETHAL = 5;
const FLASH_CLEAR = 4;
/** The back blast: this far behind the tube, inside this cone. */
const BLAST_BACK = 4;
const BLAST_SIDE = 2.5;
/** How long a squad holds when its gun goes down. */
export const GUN_DOWN_HOLD = 2.5;
/** Urgent safety dodge priority and lock duration so squad.think() does not overwrite the dodge. */
const DODGE_PRIORITY = 2;
const DODGE_LOCK_SEC = 1.5;

type PriorityOrder = (s: Soldier, dest: THREE.Vector3, spot: null, urgency: 0 | 1 | 2, delay: number, priority?: number, lockSec?: number) => void;

const _to = new THREE.Vector3();
const _dest = new THREE.Vector3();

let handlingCommsSay = false;

/** Marks whether `Comms.say` is currently emitting `comms:line` after already invoking `reactToCall`. */
export function setReactedInSay(active: boolean): void {
  handlingCommsSay = active;
}

/**
 * Runs physical AI safety/tactical reactions for critical calls (`frag`, `flash`, `rocketOut`, `downed`, `scream`, `gunDown`).
 * Called directly at the top of `Comms.say` before speech rate-limits/mute/silence so critical AI responses never drop.
 */
export function reactToCall(o: Outpost, kind: CommsKind, s: Soldier): void {
  if (!o.w || isGuest(o.w.ctx)) return;
  switch (kind) {
    case 'frag':
    case 'flash':
      if (typeof o.order === 'function' && o.w.ctx?.world?.nav) {
        clear(o, s, s.throwAt, kind === 'frag' ? FRAG_CLEAR : FLASH_CLEAR, kind === 'frag');
      }
      break;
    case 'rocketOut':
      if (typeof o.order === 'function' && o.w.ctx?.world?.nav) backBlast(o, s);
      break;
    case 'downed':
    case 'scream':
      o.callForAid?.();
      break;
    case 'gunDown':
      s.squad.hold(GUN_DOWN_HOLD);
      if (typeof o.scare === 'function') {
        for (const m of s.squad.members) if (m.fighting) o.scare(m, FEAR.leaderDown * 0.6);
      }
      break;
  }
}

export function listenToEachOther(w: AiWorld, o: Outpost): void {
  w.ctx.events.on('comms:line', line => {
    if (handlingCommsSay || isGuest(w.ctx) || !line.enemy) return;
    const s = soldierOf(line.enemy);
    if (!s) return;
    reactToCall(o, line.kind, s);
  });
}

/** Everyone but the thrower within `r` of the spot moves straight away from it, out to `r` and a little more. */
function clear(o: Outpost, thrower: Soldier, spot: THREE.Vector3, r: number, lethal: boolean): void {
  const order = o.order as PriorityOrder;
  let i = 0;
  for (const m of o.soldiers) {
    if (m === thrower || !m.fighting) continue;
    _to.subVectors(m.e.position, spot).setY(0);
    const d = _to.length();
    if (d >= r) continue;
    if (m.squad.directed && (!lethal || d >= FRAG_LETHAL)) continue;
    if (d < 0.1) _to.set(1, 0, 0);
    _dest.copy(m.e.position).addScaledVector(_to.normalize(), r + 1 - d);
    if (!o.w.ctx.world.nav.nearest(_dest, 3, _dest)) continue;
    order.call(o, m, _dest, null, 2, 0.1 * i++, DODGE_PRIORITY, DODGE_LOCK_SEC);
  }
}

/** Anyone standing behind the tube steps out to the side. */
function backBlast(o: Outpost, gunner: Soldier): void {
  const order = o.order as PriorityOrder;
  const e = gunner.e;
  const fx = Math.sin(e.yaw);
  const fz = Math.cos(e.yaw);
  for (const m of o.soldiers) {
    if (m === gunner || !m.fighting || m.squad.directed) continue;
    const dx = m.e.position.x - e.position.x;
    const dz = m.e.position.z - e.position.z;
    const back = -(dx * fx + dz * fz);
    const side = dx * -fz + dz * fx;
    if (back <= 0 || back > BLAST_BACK || Math.abs(side) > BLAST_SIDE) continue;
    // Out to whichever side he is already leaning to.
    const out = side >= 0 ? 1 : -1;
    _dest.set(m.e.position.x + -fz * out * (BLAST_SIDE + 1), m.e.position.y, m.e.position.z + fx * out * (BLAST_SIDE + 1));
    if (o.w.ctx.world.nav.nearest(_dest, 3, _dest)) order.call(o, m, _dest, null, 2, 0, DODGE_PRIORITY, DODGE_LOCK_SEC);
  }
}
