/** Behaviours and attacks unique to one enemy: the leaper's wall game, the suicide runners, the drone's flight. */
import * as THREE from 'three';
import { DroneBone } from '../characters/rig';
import { clamp, damp, dampAngle, rand } from '../core/math';
import type { AttackDef, Behaviour } from './brain';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';
import { leadLanding, meleeConnect, say } from './attacks';
import { leapTo } from './movement';

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _dir = new THREE.Vector3();

const CLING_HEIGHT = 3.6;
const WALL_SEARCH = 11;
/** Seconds past its moment that a leaper will wait for a clear line before it gives up on the wall. */
const CLING_PATIENCE = 2.5;
const CLING_LEAP_SECONDS = 0.8;

/** Casts sideways around the leaper at head height over the floor, looking for a wall it can reach. */
function findWall(e: Enemy, w: AiWorld, out: THREE.Vector3): boolean {
  const toPlayer = Math.atan2(w.player.position.x - e.position.x, w.player.position.z - e.position.z);
  for (let i = 0; i < 3; i++) {
    if (!w.director.spendRay()) return false;
    const a = toPlayer + rand(-2.4, 2.4);
    _dir.set(Math.sin(a), 0, Math.cos(a));
    _p.copy(e.position);
    _p.y += CLING_HEIGHT;
    const hit = w.ctx.physics.raycast(_p, _dir, WALL_SEARCH);
    if (hit && Math.abs(hit.normal.y) < 0.3) {
      out.copy(hit.point).addScaledVector(hit.normal, 0.45);
      return true;
    }
  }
  return false;
}

/**
 * Off the floor and onto the wall, then wait for the moment. A leaper sitting on a wall is a threat you can see,
 * and you get to choose whether to shoot it off or dodge when it comes.
 */
export function wallCling(): Behaviour {
  return {
    name: 'wallCling',
    commit: 0.6,
    score(e, w) {
      if (e.pinned || e.stage === 1) return 3;
      if (e.maim.legs < 2 || e.maim.arms === 0) return 0;
      return e.dist > 9 && e.dist < 34 && w.now > e.timerA ? 1.4 : 0;
    },
    enter(e, w) {
      e.mode = 'hold';
      e.face = 'move';
      e.timerA = w.now + 2;
      if (!findWall(e, w, e.scratchPoint)) {
        e.stage = 0;
        return;
      }
      e.stage = 1;
      e.timerB = w.now + CLING_LEAP_SECONDS;
      e.char.anim.play('leap', 1.2);
      leapTo(e, e.scratchPoint, CLING_LEAP_SECONDS, 1.2);
      say(e, w, e.def.voice.attack, 0.5);
    },
    frame(e, w) {
      if (e.stage === 1 && w.now >= e.timerB) {
        e.stage = 2;
        e.airborne = e.ballistic = false;
        e.velocity.set(0, 0, 0);
        e.position.copy(e.scratchPoint);
        e.pinned = true;
        e.face = 'player';
        // It picks its moment. The pounce waits for this, so a player looking at it gets a beat to shoot it off.
        e.timerB = w.now + rand(1.1, 2.4);
        e.attackReadyAt = e.timerB;
        e.char.anim.play('block', 0.6);
        w.ctx.fx.sparks(e.position, _p.set(0, 1, 0), 5, 0xff30d0);
        w.ctx.audio.play('leaper_cling', { position: e.position });
      }
    },
    think(e, w) {
      if (e.stage === 0) e.timerA = w.now + 1.5;
      if (e.stage !== 0 && !e.pinned && e.stage !== 1) e.stage = 0;
      // Nothing to pounce on from here. Without this a leaper could wait on a wall for the rest of the wave.
      if (e.pinned && e.attackPhase === 'idle' && w.now > e.timerB + CLING_PATIENCE) {
        dropOff(e);
        e.timerA = w.now + 3;
      }
    },
    exit(e) {
      e.face = 'move';
    },
  };
}

/** Knocks a clinging or hovering enemy into free fall. Used by hits that interrupt it. */
export function dropOff(e: Enemy): void {
  if (!e.pinned) return;
  e.pinned = false;
  e.airborne = true;
  e.verticalSpeed = e.flightLeft = 0;
  e.velocity.set(0, 0, 0);
  e.stage = 0;
}

export function pounce(damage: number): AttackDef {
  return {
    name: 'pounce',
    range: [4, 38],
    los: true,
    token: 'melee',
    cooldown: [0.2, 0.2],
    windup: 0.7,
    active: 1.6,
    recover: 0.7,
    moveMul: 0,
    weight: 8,
    requires: (e) => e.pinned,
    begin(e, w) {
      e.char.anim.play('roar', 1.6);
      say(e, w, e.def.voice.attack, 1);
      w.telegraphs.glint(e.center, 0xff30d0, 1.3, e.attackWindup);
    },
    fire(e, w) {
      e.pinned = false;
      // Long enough to see the arc and shoot it down on the way in.
      const flight = clamp(e.dist / 15, 0.65, 1.5);
      leadLanding(e, w, flight * 0.6, 8, _q);
      e.char.anim.play('leap', 1.4);
      w.ctx.audio.play('leaper_pounce', { position: e.center });
      leapTo(e, _q, flight, 0.8);
      e.stage = 0;
      e.attackStage = 1;
    },
    activeTick(e, w) {
      if (e.attackStage === 1 && meleeConnect(e, w, 1.9, -1, damage, 'leaper', 7)) e.attackStage = 2;
    },
  };
}

/** The bomber's last act. Any telegraph longer than this and it never gets to go off. */
export function fuse(windup: number): AttackDef {
  return {
    name: 'fuse',
    range: [0, 3.6],
    los: false,
    token: null,
    cooldown: [9, 9],
    windup,
    active: 0.05,
    recover: 0,
    moveMul: 1.1,
    weight: 10,
    begin(e, w) {
      e.face = 'move';
      say(e, w, e.def.voice.attack, 1);
      w.ctx.audio.play('bomber_beep', { position: e.center });
      e.attackLoop = w.ctx.audio.startLoop('bomber_tank_hiss_loop', { position: e.center });
      w.telegraphs.glint(e.center, 0xffd800, 1, e.attackWindup);
    },
    windupTick(e, w) {
      const beat = Math.floor(e.attackClock / 0.14);
      if (beat !== e.attackStage) {
        e.attackStage = beat;
        w.ctx.audio.play('bomber_beep', { position: e.center, pitch: 1 + beat * 0.08 });
      }
    },
    fire(e, w) {
      w.enemies.selfDestruct(e);
    },
  };
}

/** Runs on the think tick for skitters: leaps the last few metres and blows on contact or on landing. */
export function skitterPounce(windup: number): AttackDef {
  return {
    name: 'skitterPounce',
    range: [0, 4.5],
    los: false,
    token: null,
    cooldown: [9, 9],
    windup,
    active: 0.9,
    recover: 0,
    moveMul: 0.2,
    weight: 10,
    begin(e, w) {
      e.face = 'player';
      say(e, w, e.def.voice.attack, 1);
      w.telegraphs.glint(e.center, 0xff2030, 1.2, e.attackWindup);
    },
    fire(e, w) {
      const p = w.player;
      _q.copy(p.position).addScaledVector(p.velocity, 0.15);
      if (!w.ctx.world.nav.nearest(_q, 5, _q)) _q.copy(p.position);
      leapTo(e, _q, 0.5, 0.7);
    },
    activeTick(e, w) {
      const close = e.position.distanceToSquared(w.player.position) < 2.9;
      if (close || !e.airborne) w.enemies.selfDestruct(e);
    },
  };
}

const HOVER_MIN = 5.5;
const HOVER_MAX = 8.5;

/**
 * Drones skip the flow field: they fly a ring around the player at gun height, climb over whatever they hit, and
 * lean into their motion. A drone that is sliding sideways and banking looks alive; a drone on rails does not.
 */
export function hover(radius: number): Behaviour {
  return {
    name: 'hover',
    score: () => 1,
    enter(e) {
      e.pinned = true;
      e.face = 'player';
      e.orbitDir = e.side;
      e.timerA = 0;
      e.timerB = rand(HOVER_MIN, HOVER_MAX);
    },
    think(e, w) {
      if (w.now >= e.timerA) {
        e.timerA = w.now + rand(2.5, 4.5);
        e.timerB = rand(HOVER_MIN, HOVER_MAX);
        if (Math.random() < 0.4) e.orbitDir = -e.orbitDir;
      }
      if (e.velocity.lengthSq() > 4 && w.director.spendRay()) {
        _dir.copy(e.velocity).normalize();
        const hit = w.ctx.physics.raycast(e.position, _dir, 5);
        e.stage = hit ? 1 : 0;
      }
    },
    frame(e, w, dt) {
      const p = w.player.position;
      _p.subVectors(e.position, p).setY(0);
      const r = _p.length() || 1;
      _p.multiplyScalar(1 / r);
      _dir.set(_p.z * e.orbitDir, 0, -_p.x * e.orbitDir).addScaledVector(_p, clamp((radius - r) * 0.3, -1, 1)).normalize();
      const speed = e.def.speed * e.speedMul;
      const floor = w.ctx.world.nav.groundHeight(e.position.x, e.position.y + 2, e.position.z);
      const base = Math.max(Number.isNaN(floor) ? p.y : floor, p.y);
      // Blocked ahead: rise over it rather than turning, so a drone never gets stuck against a tower.
      const climb = e.stage === 1 ? 7 : clamp((base + e.timerB - e.position.y) * 1.6, -5, 5);
      e.velocity.x = damp(e.velocity.x, _dir.x * speed, e.def.accel, dt);
      e.velocity.z = damp(e.velocity.z, _dir.z * speed, e.def.accel, dt);
      e.velocity.y = damp(e.velocity.y, climb, e.def.accel, dt);
      e.position.addScaledVector(e.velocity, dt);
      e.position.addScaledVector(e.push, dt);
      const fade = Math.exp(-5 * dt);
      e.push.multiplyScalar(fade);
      const root = e.char.root;
      const sway = Math.sin(w.now * 2.1 + e.uid) * 0.05;
      const cos = Math.cos(e.yaw);
      const sin = Math.sin(e.yaw);
      root.rotation.x = dampAngle(root.rotation.x, clamp((e.velocity.x * sin + e.velocity.z * cos) * 0.035, -0.4, 0.4), 6, dt);
      root.rotation.z = dampAngle(root.rotation.z, clamp((e.velocity.x * cos - e.velocity.z * sin) * -0.05 + sway, -0.5, 0.5), 6, dt);
      const gun = e.char.bones[DroneBone.gun];
      if (gun) gun.rotation.x = clamp(Math.atan2(e.position.y - w.player.eye.y, Math.max(r, 1)), -1, 1.2);
    },
  };
}
