/**
 * What a man does with his legs. The squad says where to be; these carry it out, and a frightened or hurt man's own state
 * outranks any order. Scores follow brain.ts: 1 is fighting, 3 is a job that overrides the fight, 5 and up is what has
 * happened to him.
 */
import * as THREE from 'three';
import type { PostureName } from '../../characters/animation/postures';
import { chance, dampAngle, rand } from '../../core/math';
import type { AiWorld } from '../aiWorld';
import { crawl, panic, wriggle } from '../behaviours';
import { finishAttack, type Behaviour } from '../brain';
import type { Enemy } from '../Enemy';
import type { SpotReading } from './cover';
import { PEEK_WAIT_BY_STATE } from './morale';
import { soldierOf, SPRINT_SECONDS, type Soldier } from './soldier';

/** Near top speed for a man in kit. */
const SPRINT_SPEED = 6;
const WALK_SHARE = 0.62;
const CROUCH_SHARE = 0.5;
const SPRINT_RECOVERY = 0.5;
/** Rounds this close keep his head down, whatever his orders. */
const PINNED = 0.62;
/** Metres to a route point before he turns for the next one. Tighter at the end, so he really reaches the spot. */
const WAYPOINT = 0.9;
const LAST_WAYPOINT = 0.45;
/** Under this many metres in STALL_SECONDS he is stuck against something. */
const STALL_METRES = 0.5;
const STALL_SECONDS = 1.3;
const MAX_STALLS = 2;
/** A man with the player this close and in sight gives up instead of running past him. */
const CORNERED = 5;
const KNEEL_DELAY = 0.75;
/** A prisoner left alone this long gets up and walks out. */
const PRISONER_SECONDS = 45;
const DRAG_SPEED = 1.7;
const DRAG_OFFSET = 1.1;
const REACH_PATIENT = 1.6;
const TREAT_SECONDS = 4.5;
const MEDIC_TREAT_SECONDS = 2.6;
const REVIVE_HEALTH = 0.4;
/** The furthest a man will haul a casualty to get him behind something. */
const DRAG_REACH = 14;

const _reading: SpotReading = { hidden: false, canShoot: false, side: 0 };

interface Posed {
  setPosture?(posture: PostureName): void;
}

const pose = (e: Enemy, posture: PostureName): void => (e.char.anim as unknown as Posed).setPosture?.(posture);

const lookAt = (e: Enemy, at: THREE.Vector3, dt: number): void => {
  e.yaw = dampAngle(e.yaw, Math.atan2(at.x - e.position.x, at.z - e.position.z), e.def.turn, dt);
};

const paceFor = (e: Enemy, speed: number): number => speed / e.def.speed;

/** Walks the route. True once he is at the end of it. */
function walkRoute(e: Enemy, s: Soldier, w: AiWorld): boolean {
  const r = s.route;
  if (r.done) return true;
  const last = r.next === r.count - 1;
  const d = Math.hypot(r.x[r.next]! - e.position.x, r.z[r.next]! - e.position.z);
  if (d < (last ? LAST_WAYPOINT : WAYPOINT)) {
    r.next++;
    if (r.done) return true;
  }
  e.moveTarget.set(r.x[r.next]!, r.y[r.next]!, r.z[r.next]!);
  if (w.now >= s.progressAt) {
    const moved = e.position.distanceTo(s.progressFrom);
    s.progressFrom.copy(e.position);
    s.progressAt = w.now + STALL_SECONDS;
    if (moved < STALL_METRES && e.attack === null && e.stagger <= 0) {
      if (++s.stalls >= MAX_STALLS) return true;
      w.enemies.outpost!.reroute(s);
    } else s.stalls = 0;
  }
  return false;
}

function hide(e: Enemy, w: AiWorld, s: Soldier): void {
  if (e.attack && e.attack.name !== 'grenade') finishAttack(e, w, true);
  s.stage = 'hide';
  s.exposed = s.blind = false;
  if (s.spot) e.moveTarget.copy(s.spot.position);
  pose(e, s.state === 'panicked' ? 'cower' : 'cover');
  s.nextPeekAt = w.now + rand(1.1, 2.4) * PEEK_WAIT_BY_STATE[s.state] * (1 + e.pressure * 1.5);
}

function peek(e: Enemy, w: AiWorld, s: Soldier): void {
  const spot = s.spot!;
  const o = w.enemies.outpost!;
  o.cover.read(spot, s.aim, _reading);
  o.fireFrom(s, spot, _reading);
  const panicked = s.state === 'panicked';
  if (!s.canShoot && !panicked) {
    if (s.noShotSince === 0) s.noShotSince = w.now;
    s.nextPeekAt = w.now + rand(0.7, 1.3);
    return;
  }
  s.noShotSince = 0;
  s.stage = 'peek';
  s.exposed = true;
  // A panicking man holds his gun round the corner and pulls the trigger. He does not look.
  s.blind = panicked && chance(0.6);
  e.moveTarget.copy(s.blind ? spot.position : s.firePoint);
  pose(e, s.blind ? 'cower' : s.fireSide < 0 ? 'leanLeft' : s.fireSide > 0 ? 'leanRight' : 'peek');
  s.peekUntil = w.now + (s.def.base ? rand(4.5, 7) : rand(2.2, 3.8)) * (s.state === 'shaken' ? 0.6 : 1);
}

function startReload(e: Enemy, w: AiWorld, s: Soldier): void {
  s.reloadUntil = w.now + s.def.reload;
  w.ctx.audio.play('smg_reload', { position: e.center, volume: 0.45 });
  w.enemies.outpost!.comms.say('reloading', s);
  if (s.spot) hide(e, w, s);
}

/** At a spot or on the spot: peek, fire, duck, reload. Everything a fight mostly is. */
const hold: Behaviour = {
  name: 'hold',
  score: () => 1,
  enter(e, w) {
    const s = soldierOf(e)!;
    e.mode = 'point';
    e.pace = CROUCH_SHARE;
    e.face = 'lock';
    e.moveTarget.copy(s.spot ? s.spot.position : e.position);
    s.stage = 'hide';
    s.exposed = s.blind = false;
    s.nextPeekAt = w.now + rand(0.1, 0.7);
    if (s.spot) pose(e, 'cover');
  },
  think(e, w) {
    const s = soldierOf(e)!;
    const now = w.now;
    s.aim.copy(s.sees ? w.player.chest : s.squad.threat);
    s.suppressing = now < s.squad.coverFireUntil && s.team !== s.squad.movingTeam;
    e.face = s.sees ? 'player' : 'lock';
    if (s.reloadUntil > 0) {
      if (now >= s.reloadUntil) {
        s.reloadUntil = 0;
        s.mag = s.def.mag;
      } else return;
    } else if (s.mag <= 0) {
      startReload(e, w, s);
      return;
    }
    if (!s.spot) {
      // No wall to use. He gets low, unless he is the wall.
      s.stage = 'peek';
      s.exposed = true;
      pose(e, s.role === 'shield' ? 'stand' : s.state === 'panicked' ? 'cower' : 'crouch');
      return;
    }
    if (s.stage === 'hide') {
      if (now >= s.nextPeekAt) peek(e, w, s);
    } else if (now >= s.peekUntil || e.pressure > PINNED) hide(e, w, s);
  },
  frame(e, _w, dt) {
    if (e.face === 'lock') lookAt(e, soldierOf(e)!.aim, dt);
  },
  exit(e) {
    const s = soldierOf(e);
    if (s) s.exposed = s.blind = s.suppressing = false;
    pose(e, 'stand');
  },
};

const move: Behaviour = {
  name: 'move',
  score: e => (soldierOf(e)?.task === 'move' ? 1.4 : 0),
  enter(e) {
    e.mode = 'point';
    e.face = 'move';
    pose(e, 'stand');
  },
  think(e, w) {
    const s = soldierOf(e)!;
    s.aim.copy(s.sees ? w.player.chest : s.squad.threat);
    s.exposed = s.sees && s.def.firesOnTheMove;
    e.face = e.attack ? 'player' : 'move';
  },
  frame(e, w, dt) {
    const s = soldierOf(e)!;
    const sprinting = s.urgency === 2 && s.sprintLeft > 0;
    if (sprinting) s.sprintLeft -= dt;
    else s.sprintLeft = Math.min(SPRINT_SECONDS, s.sprintLeft + dt * SPRINT_RECOVERY);
    e.pace = sprinting ? paceFor(e, SPRINT_SPEED) : s.urgency === 0 ? WALK_SHARE : 1;
    if (walkRoute(e, s, w)) s.task = 'hold';
  },
  exit(e) {
    const s = soldierOf(e);
    if (s) s.exposed = false;
  },
};

/** On the floor. This is the hook the wound conditions will drive: see Outpost.setDowned. */
const downed: Behaviour = {
  name: 'downed',
  score: e => (soldierOf(e)?.downed ? 9 : 0),
  enter(e) {
    e.mode = 'hold';
    e.face = 'lock';
    pose(e, 'downed');
  },
  exit(e) {
    pose(e, 'stand');
  },
};

const surrender: Behaviour = {
  name: 'surrender',
  score: e => (soldierOf(e)?.fate === 'surrender' ? 5.5 : 0),
  enter(e, w) {
    const s = soldierOf(e)!;
    e.mode = 'hold';
    e.face = 'player';
    pose(e, 'handsUp');
    s.peekUntil = w.now + KNEEL_DELAY;
    w.enemies.outpost!.onSurrender(s);
  },
  think(e, w) {
    const s = soldierOf(e)!;
    if (s.stage !== 'hide' && w.now >= s.peekUntil) {
      s.stage = 'hide';
      e.face = 'lock';
      pose(e, 'kneel');
    }
    if (e.dist < 9) w.enemies.outpost!.comms.say('surrender', s);
    if (w.now - s.surrenderedAt > PRISONER_SECONDS) w.enemies.outpost!.release(s);
  },
};

const flee: Behaviour = {
  name: 'flee',
  score: e => (soldierOf(e)?.fate === 'flee' ? 5 : 0),
  enter(e, w) {
    const s = soldierOf(e)!;
    e.mode = 'point';
    e.face = 'move';
    e.pace = s.released ? WALK_SHARE : paceFor(e, SPRINT_SPEED);
    pose(e, s.released ? 'handsUp' : 'flee');
    if (!w.enemies.outpost!.routeToGate(s)) s.fate = 'surrender';
  },
  think(e, w) {
    const s = soldierOf(e)!;
    if (!s.released && e.dist < CORNERED && e.hasLos && w.enemies.outpost!.doctrine.surrender) s.fate = 'surrender';
    else if (!s.released) w.enemies.outpost!.comms.say('panic', s);
  },
  frame(e, w) {
    const s = soldierOf(e)!;
    if (walkRoute(e, s, w)) w.enemies.outpost!.escape(s);
  },
};

function beginTreatment(e: Enemy, w: AiWorld, s: Soldier): void {
  s.aidStage = 'treat';
  s.aidUntil = w.now + (s.role === 'medic' ? MEDIC_TREAT_SECONDS : TREAT_SECONDS);
  e.mode = 'hold';
  e.face = 'lock';
  pose(e, 'revive');
}

/** Hauls the casualty along behind him, keeping the distance of a pair of arms. */
function haul(e: Enemy, patient: Enemy): void {
  const dx = patient.position.x - e.position.x, dz = patient.position.z - e.position.z;
  const d = Math.hypot(dx, dz) || 1;
  patient.position.x = e.position.x + (dx / d) * DRAG_OFFSET;
  patient.position.z = e.position.z + (dz / d) * DRAG_OFFSET;
  patient.yaw = Math.atan2(-dx, -dz);
}

/** Reach him, get him behind something if he is lying in the open, then bring him back. */
const aid: Behaviour = {
  name: 'aid',
  score: e => (soldierOf(e)?.patient ? 3 : 0),
  enter(e, w) {
    const s = soldierOf(e)!;
    s.aidStage = 'reach';
    e.mode = 'point';
    e.face = 'move';
    e.pace = paceFor(e, SPRINT_SPEED);
    pose(e, 'stand');
    w.enemies.outpost!.routeTo(s, s.patient!.e.position);
  },
  frame(e, w, dt) {
    const s = soldierOf(e)!;
    const patient = s.patient;
    if (!patient) return;
    const o = w.enemies.outpost!;
    if (s.aidStage === 'reach') {
      walkRoute(e, s, w);
      if (e.position.distanceTo(patient.e.position) > REACH_PATIENT) return;
      if (o.routeToShelter(s, patient, DRAG_REACH)) {
        s.aidStage = 'drag';
        e.face = 'lock';
        e.pace = paceFor(e, DRAG_SPEED);
        pose(e, 'drag');
      } else beginTreatment(e, w, s);
    } else if (s.aidStage === 'drag') {
      lookAt(e, patient.e.position, dt);
      haul(e, patient.e);
      if (walkRoute(e, s, w)) beginTreatment(e, w, s);
    } else if (w.now >= s.aidUntil) {
      patient.e.health = Math.max(patient.e.health, patient.e.maxHealth * REVIVE_HEALTH);
      o.setDowned(patient.e, false);
      s.patient = null;
    } else lookAt(e, patient.e.position, dt);
  },
  exit(e) {
    const s = soldierOf(e);
    if (!s) return;
    s.aidStage = 'none';
    if (s.patient) s.patient.rescuer = null;
    s.patient = null;
    pose(e, 'stand');
  },
};

/**
 * Burning and legless are the only maimed rules a soldier keeps from the swarm. Headbutts and disarmed rushes are out: a man
 * who loses his gun arm runs or gives up, which is a morale question and not a behaviour.
 */
export const SOLDIER_BEHAVIOURS: Behaviour[] = [crawl(), wriggle(), panic(), downed, surrender, flee, aid, move, hold];
