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
import type { Outpost } from '../index';
import { FEAR } from '../morale';
import { soldierOf, type Soldier } from '../soldier';

/** How close to a frag's landing spot a man must be to move, and where he goes. */
const FRAG_CLEAR = 6.5;
const FLASH_CLEAR = 4;
/** The back blast: this far behind the tube, inside this cone. */
const BLAST_BACK = 4;
const BLAST_SIDE = 2.5;
/** How long a squad holds when its gun goes down. */
export const GUN_DOWN_HOLD = 2.5;

const _to = new THREE.Vector3();
const _dest = new THREE.Vector3();

export function listenToEachOther(w: AiWorld, o: Outpost): void {
  w.ctx.events.on('comms:line', line => {
    const coop = w.ctx.coop;
    if ((coop?.world && !coop.hosting) || !line.enemy) return;
    const s = soldierOf(line.enemy);
    if (!s) return;
    switch (line.kind) {
      case 'frag':
      case 'flash':
        clear(o, s, s.throwAt, line.kind === 'frag' ? FRAG_CLEAR : FLASH_CLEAR);
        break;
      case 'rocketOut':
        backBlast(o, s);
        break;
      case 'downed':
      case 'scream':
        o.callForAid();
        break;
      case 'gunDown':
        s.squad.hold(GUN_DOWN_HOLD);
        for (const m of s.squad.members) if (m.fighting) o.scare(m, FEAR.leaderDown * 0.6);
        break;
    }
  });
}

/** Everyone but the thrower within `r` of the spot moves straight away from it, out to `r` and a little more. */
function clear(o: Outpost, thrower: Soldier, spot: THREE.Vector3, r: number): void {
  let i = 0;
  for (const m of o.soldiers) {
    if (m === thrower || !m.fighting) continue;
    _to.subVectors(m.e.position, spot).setY(0);
    const d = _to.length();
    if (d >= r) continue;
    if (d < 0.1) _to.set(1, 0, 0);
    _dest.copy(m.e.position).addScaledVector(_to.normalize(), r + 1 - d);
    if (!o.w.ctx.world.nav.nearest(_dest, 3, _dest)) continue;
    o.order(m, _dest, null, 2, 0.1 * i++);
  }
}

/** Anyone standing behind the tube steps out to the side. */
function backBlast(o: Outpost, gunner: Soldier): void {
  const e = gunner.e;
  const fx = Math.sin(e.yaw);
  const fz = Math.cos(e.yaw);
  for (const m of o.soldiers) {
    if (m === gunner || !m.fighting) continue;
    const dx = m.e.position.x - e.position.x;
    const dz = m.e.position.z - e.position.z;
    const back = -(dx * fx + dz * fz);
    const side = dx * -fz + dz * fx;
    if (back <= 0 || back > BLAST_BACK || Math.abs(side) > BLAST_SIDE) continue;
    // Out to whichever side he is already leaning to.
    const out = side >= 0 ? 1 : -1;
    _dest.set(m.e.position.x + -fz * out * (BLAST_SIDE + 1), m.e.position.y, m.e.position.z + fx * out * (BLAST_SIDE + 1));
    if (o.w.ctx.world.nav.nearest(_dest, 3, _dest)) o.order(m, _dest, null, 2, 0);
  }
}
