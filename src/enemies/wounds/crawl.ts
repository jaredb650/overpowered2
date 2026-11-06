/**
 * A man on the floor dragging himself away: toward cover the player cannot see, or toward his own side, and never toward the
 * player. This drives the body directly rather than through a behaviour, because being on the floor outranks the brain, and
 * because a body with its AI off on the Test Range has to crawl the same as one in a fight.
 */
import * as THREE from 'three';
import type { AiWorld } from '../aiWorld';
import type { Enemy } from '../Enemy';
import type { Outpost } from '../outpost';
import type { Soldier } from '../outpost/soldier';
import type { Injuries } from './injuries';

/** Metres per second on two good arms. A real wounded crawl, not the swarm's. */
const CRAWL_SPEED = 1.15;
const ONE_ARM = 0.6;
/** Nothing left to haul with: heels and shoulders. */
const NO_ARMS = 0.25;
const PARALYSED = 0.75;
/** Metres to the next point before he turns for the one after. */
const WAYPOINT = 0.7;
const REPLAN_SECONDS = 2.5;
/** How far he will try for an ally, and for cover. A man bleeding out at under a metre a second knows his limits. */
const ALLY_REACH = 16;
const COVER_REACH = 12;
/** He will not trade this much distance from the player for a better spot. */
const CLOSER_LIMIT = 1.5;
/** With nowhere to go, he just goes away. */
const AWAY_METRES = 7;
const RESCUER_CLOSE = 3.5;

const _to = new THREE.Vector3();
const _away = new THREE.Vector3();

/** Writes the best place within reach. False if there is nowhere better than simply away. */
function pickRefuge(e: Enemy, s: Soldier, o: Outpost, player: THREE.Vector3, out: THREE.Vector3): boolean {
  const mine = e.position.distanceTo(player);
  let bestScore = Infinity;
  for (const other of o.soldiers) {
    if (other === s || !other.fighting) continue;
    const reach = other.e.position.distanceTo(e.position);
    if (reach > ALLY_REACH || other.e.position.distanceTo(player) < mine - CLOSER_LIMIT) continue;
    if (reach < bestScore) {
      bestScore = reach;
      out.copy(other.e.position);
    }
  }
  for (const spot of o.cover.spots) {
    const reach = spot.position.distanceTo(e.position);
    if (reach > COVER_REACH || reach + 2 >= bestScore || Math.abs(spot.position.y - e.position.y) > 1) continue;
    if (o.intel.exposed(spot.position.x, spot.position.z) || spot.position.distanceTo(player) < mine - CLOSER_LIMIT) continue;
    bestScore = reach + 2;
    out.copy(spot.position);
  }
  return bestScore < Infinity;
}

function planCrawl(e: Enemy, s: Soldier, w: AiWorld, o: Outpost): void {
  s.crawlPlanAt = w.now + REPLAN_SECONDS;
  const player = w.player.position;
  if (!pickRefuge(e, s, o, player, _to)) {
    _away.subVectors(e.position, player).setY(0);
    if (_away.lengthSq() < 0.01) _away.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    _to.copy(e.position).addScaledVector(_away.normalize(), AWAY_METRES);
    if (!w.ctx.world.nav.nearest(_to, 4, _to)) _to.copy(e.position).addScaledVector(_away, AWAY_METRES);
  }
  s.dest.copy(_to);
  if (!o.takeRoute() || !o.routes.find(e.position, _to, s.route, o.intel)) s.route.clear();
  else s.route.next = 0;
  s.crawling = _to.distanceToSquared(e.position) > 1;
}

/** Sets where the body wants to go this frame. Runs ahead of movement. */
export function crawlOn(s: Soldier, b: Injuries, w: AiWorld, o: Outpost): void {
  const e = s.e;
  // Help is here, or nearly: he stops, or he would crawl out from under the man come to fetch him.
  const helped = s.rescuer !== null && s.rescuer.e.position.distanceToSquared(e.position) < RESCUER_CLOSE * RESCUER_CLOSE;
  if (helped || e.attack !== null) {
    e.mode = 'hold';
    e.face = e.attack ? 'player' : 'lock';
    return;
  }
  if (w.now >= s.crawlPlanAt) planCrawl(e, s, w, o);
  if (!s.crawling) {
    e.mode = 'hold';
    e.face = 'lock';
    return;
  }
  const r = s.route;
  if (!r.done) {
    if (Math.hypot(r.x[r.next]! - e.position.x, r.z[r.next]! - e.position.z) < WAYPOINT) r.next++;
    if (!r.done) e.moveTarget.set(r.x[r.next]!, r.y[r.next]!, r.z[r.next]!);
  } else e.moveTarget.copy(s.dest);
  const arms = e.maim.arms;
  const haul = arms === 2 ? 1 : arms === 1 ? ONE_ARM : NO_ARMS;
  const speed = CRAWL_SPEED * haul * (b.paralysed ? PARALYSED : 1);
  e.mode = 'point';
  e.face = 'move';
  e.pace = speed / (e.def.speed * e.speedMul);
}
