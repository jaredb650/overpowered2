/**
 * Movement behaviours. Each is small and knows one thing; roles are lists of them in data.ts.
 * Scores sit on one rough scale: 0.3 default travel, 1 normal fighting, 2 reactions, 5+ maimed overrides.
 */
import * as THREE from 'three';
import { clamp, rand, TAU, wrapAngle } from '../core/math';
import type { Behaviour } from './brain';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';
import { say } from './attacks';
import { canWalk, leapTo } from './movement';

/** Past this the Ghost powerup hides the player. */
export const GHOST_RANGE = 15;

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Writes a point around the player at the enemy's slot bearing and returns false if nothing walkable is near it. */
function slotPoint(e: Enemy, w: AiWorld, radius: number, out: THREE.Vector3): boolean {
  const p = w.player.position;
  out.set(p.x + Math.sin(e.slotAngle) * radius, p.y, p.z + Math.cos(e.slotAngle) * radius);
  return w.ctx.world.nav.nearest(out, 7, out);
}

/** The bearing from the player to this enemy. */
const bearingFromPlayer = (e: Enemy, w: AiWorld): number =>
  Math.atan2(e.position.x - w.player.position.x, e.position.z - w.player.position.z);

/** Default travel: take the field to the player. Anything with a weapon drops out of this as soon as it can fight. */
export function advance(pace = 1, weave = 0.28): Behaviour {
  return {
    name: 'advance',
    score: () => 0.3,
    enter(e) {
      e.mode = 'flow';
      e.face = 'move';
      e.pace = pace;
      e.weave = weave;
    },
    exit(e) {
      e.weave = 0;
    },
  };
}

/**
 * How the swarm waits for an attack slot. No circling and no probing for gaps: it leans in until the crowd stops it,
 * and the crowd spreads itself around the player. That pressure is what reads as a tide.
 */
export function press(radius: number, pace = 0.6): Behaviour {
  return {
    name: 'press',
    score: (e, w) => (e.dist < radius + 2.5 && e.attackPhase === 'idle' && !e.holdsMelee && !w.director.meleeFree ? 1 : 0),
    enter(e) {
      e.face = 'player';
      e.pace = pace;
    },
    think(e) {
      e.mode = e.dist > radius ? 'flow' : 'hold';
    },
  };
}

/** The Stalker's wait: it circles at the edge of reach and doubles back. Nothing else on the roster moves like this. */
export function surround(radius: number, pace = 0.75): Behaviour {
  return {
    name: 'surround',
    score: (e, w) => (e.dist < radius + 3 && e.attackPhase === 'idle' && !e.holdsMelee && !w.director.meleeFree ? 1 : 0),
    enter(e) {
      e.mode = 'orbit';
      e.orbitRadius = radius;
      e.orbitDir = e.side;
      e.pace = pace;
      e.face = 'player';
    },
    think(e) {
      // A change of direction now and then reads as probing for a gap.
      if (Math.random() < 0.04) e.orbitDir = -e.orbitDir;
    },
  };
}

export interface Band {
  /** Opens fire inside this. */
  engage: number;
  /** Prefers to stand here. */
  hold: number;
  /** Backs up inside this. */
  backOff: number;
}

/**
 * The ranged dance. Hold a slot on a ring around the player, and let the slot creep toward the player's blind side.
 * Each enemy has its own slot, so a squad spreads into an arc rather than a clump.
 */
export function engage(band: Band, pace = 0.7): Behaviour {
  return {
    name: 'engage',
    score: (e) => (e.dist <= band.engage && e.hasLos ? 1 : 0),
    enter(e, w) {
      e.face = 'player';
      e.pace = pace;
      if (e.squad === null) e.slotAngle = bearingFromPlayer(e, w);
    },
    think(e, w) {
      const toBack = wrapAngle(Math.atan2(-w.player.forward.x, -w.player.forward.z) - e.slotAngle);
      // A slow drift. Any faster and a whole firing line reads as strafing.
      e.slotAngle += clamp(toBack, -1, 1) * 0.008;
      if (slotPoint(e, w, band.hold, _p)) {
        e.moveTarget.copy(_p);
        e.mode = 'point';
      } else e.mode = 'flow';
    },
  };
}

/** Too close: back up along the real route, still facing and firing. */
export function backOff(band: Band, pace = 0.8): Behaviour {
  return {
    name: 'backOff',
    score: (e) => (e.dist < band.backOff ? 1.4 : 0),
    // Long enough to read as giving ground, so it never stutters between this and holding the line.
    commit: 1.2,
    enter(e) {
      e.mode = 'flee';
      e.face = 'player';
      e.pace = pace;
      e.timerB = 0;
    },
  };
}

/**
 * With squadmates in the fight, one trooper breaks wide while the others hold attention.
 * Scores only while the player is looking its way, because flanking someone looking elsewhere is pointless.
 */
export function flank(radius: number, pace = 1): Behaviour {
  return {
    name: 'flank',
    commit: 3.5,
    score(e, w) {
      if (e.squad === null || e.squad.size < 2 || !e.inView || e.dist > radius * 2.4) return 0;
      return w.now < e.lastDodgeAt + 6 ? 0 : 1.15;
    },
    enter(e, w) {
      e.lastDodgeAt = w.now;
      e.pace = pace;
      e.face = 'move';
      const back = Math.atan2(-w.player.forward.x, -w.player.forward.z);
      e.slotAngle = back + e.side * rand(0.7, 1.3);
    },
    think(e, w) {
      if (slotPoint(e, w, radius, _p)) {
        e.moveTarget.copy(_p);
        e.mode = 'point';
      } else e.mode = 'flow';
    },
    exit(e) {
      e.face = 'player';
    },
  };
}

/** Searches a few spots away from the player for one the player cannot see. */
function findCover(e: Enemy, w: AiWorld): boolean {
  const nav = w.ctx.world.nav;
  const away = bearingFromPlayer(e, w);
  for (let i = 0; i < 2; i++) {
    if (!w.director.spendRay()) return false;
    const a = away + rand(-1.5, 1.5);
    const r = rand(4, 11);
    _p.set(e.position.x + Math.sin(a) * r, e.position.y, e.position.z + Math.cos(a) * r);
    if (!nav.nearest(_p, 3, _p)) continue;
    _q.copy(_p);
    _q.y += e.def.eyeHeight;
    if (!w.director.clearLine(_q, w.player.eye)) {
      e.moveTarget.copy(_p);
      return true;
    }
  }
  return false;
}

/** Hurt or pinned down: break line of sight, breathe, come back out. Only a lone sprint across open floor looks dumb. */
export function seekCover(pressureLimit = 0.55): Behaviour {
  return {
    name: 'seekCover',
    commit: 1.4,
    score: (e, w) => (e.pressure > pressureLimit && e.dist > 6 && w.now > e.coverReadyAt ? 1.8 : 0),
    enter(e, w) {
      e.stage = 0;
      e.mode = 'hold';
      e.face = 'move';
      e.pace = 1;
      e.coverReadyAt = w.now + 6;
    },
    think(e, w) {
      if (e.stage === 0) {
        if (findCover(e, w)) {
          e.stage = 1;
          e.mode = 'point';
        } else e.mode = 'flee';
      } else if (e.stage === 1 && !e.hasLos) {
        e.stage = 2;
        e.mode = 'hold';
        e.pressure *= 0.4;
      }
    },
    exit(e) {
      e.stage = 0;
      e.face = 'player';
    },
  };
}

/** Sidesteps the crosshair. A dodge is a push impulse, so it stacks with whatever the enemy was doing. */
export function dodge(impulse: number, cooldown: number, reactTime = 0.1): Behaviour {
  return {
    name: 'dodge',
    commit: 0.28,
    score: (e, w) => (e.aimedAt > reactTime && e.attackPhase !== 'active' && w.now > e.lastDodgeAt + cooldown && !e.airborne ? 2.4 : 0),
    enter(e, w) {
      e.lastDodgeAt = w.now;
      _dir.subVectors(e.position, w.player.position).setY(0).normalize();
      let side = Math.random() < 0.5 ? 1 : -1;
      if (!canWalk(e, w, _dir.z * side, -_dir.x * side, 2.5)) side = -side;
      e.push.x += _dir.z * side * impulse;
      e.push.z += -_dir.x * side * impulse;
      e.char.anim.play('stagger', 2.2);
      w.ctx.fx.smoke(e.center, 0x8060c0, 0.7, 0.35);
      say(e, w, e.def.voice.attack, 0.5);
    },
  };
}

/** Keeps a long weapon alive: retreat by the real route when the player closes in. */
export function keepAway(distance: number, pace = 1): Behaviour {
  return {
    name: 'keepAway',
    commit: 0.8,
    score: (e) => (e.dist < distance ? 1.3 : 0),
    enter(e) {
      e.mode = 'flee';
      e.face = 'move';
      e.pace = pace;
      e.timerB = 0;
    },
  };
}

/** Stops to take a shot when the attack layer has one lined up. */
export function plant(maxRange: number): Behaviour {
  return {
    name: 'plant',
    score: (e) => (e.hasLos && e.dist <= maxRange ? 0.8 : 0),
    enter(e) {
      e.mode = 'hold';
      e.face = 'player';
    },
  };
}

/**
 * The riot officer leads with the shield. The body keeps turning to face the player, and a player who outruns
 * that turn has earned the flank. Pace drops as the angle grows, so it visibly scrambles to get the shield round.
 */
export function shieldWall(): Behaviour {
  return {
    name: 'shieldWall',
    score: (e) => (e.shield ? 1 : 0),
    enter(e) {
      e.mode = 'flow';
      e.face = 'player';
      e.pace = 0.8;
    },
    think(e, w) {
      const off = Math.abs(wrapAngle(Math.atan2(w.player.position.x - e.position.x, w.player.position.z - e.position.z) - e.yaw));
      e.pace = off > 1 ? 0.25 : 0.8;
      e.mode = e.dist < 3.2 ? 'hold' : 'flow';
    },
  };
}

/** Stands behind the front line, projects wards on allies, runs if the player reaches it. */
export function support(radius: number, wardHp: number, maxTargets: number): Behaviour {
  return {
    name: 'support',
    score: () => 1,
    enter(e) {
      e.face = 'move';
      e.pace = 0.85;
      e.timerA = 0;
    },
    think(e, w) {
      const ally = w.enemies.frontAlly(e, radius * 2.5);
      if (ally) {
        // Sit behind the ally on the far side from the player.
        _dir.subVectors(ally.position, w.player.position).setY(0).normalize();
        e.moveTarget.copy(ally.position).addScaledVector(_dir, 7);
        if (w.ctx.world.nav.nearest(e.moveTarget, 5, _p)) {
          e.moveTarget.copy(_p);
          e.mode = 'point';
        } else e.mode = 'flow';
      } else e.mode = e.dist > 24 ? 'flow' : 'flee';
      if (w.now >= e.timerA) {
        e.timerA = w.now + 1.2;
        w.enemies.wardNearby(e, radius, wardHp * e.damageMul, maxTargets);
      }
    },
  };
}

/** Jump-pack relocation: a sniper that has fired is a sniper that has been seen. */
export function relocate(minDist: number, maxDist: number, afterShots: number): Behaviour {
  return {
    name: 'relocate',
    commit: 1.6,
    score: (e) => (!e.airborne && e.maim.legs === 2 && e.attackPhase === 'idle' && (e.shotsFired >= afterShots || e.pressure > 0.6) ? 2 : 0),
    enter(e, w) {
      e.shotsFired = 0;
      e.pressure = 0;
      e.mode = 'hold';
      e.face = 'move';
      const nav = w.ctx.world.nav;
      const away = bearingFromPlayer(e, w);
      for (let i = 0; i < 6; i++) {
        const a = away + rand(-1.9, 1.9);
        const r = rand(minDist, maxDist);
        _p.set(e.position.x + Math.sin(a) * r, e.position.y + 8, e.position.z + Math.cos(a) * r);
        if (!nav.nearest(_p, 9, _q)) continue;
        if (!w.director.spendRay()) break;
        _p.copy(_q);
        _p.y += e.def.eyeHeight;
        if (!w.director.clearLine(_p, w.player.eye)) continue;
        e.char.anim.play('leap');
        leapTo(e, _q, 1.5, 3);
        w.ctx.fx.smoke(e.position, 0x667788, 1.4, 0.6);
        w.ctx.audio.play('enemy_lunge', { position: e.position, pitch: 0.7 });
        return;
      }
      // No vantage found this time. Falling back on a walk keeps it moving, which is what matters.
      e.mode = 'flee';
      e.timerB = 0;
    },
  };
}

/** On fire and not built for it: it forgets the fight and runs in circles, lighting up whatever it brushes past. */
export function panic(): Behaviour {
  return {
    name: 'panic',
    score: (e) => (e.burning > 0 && !e.def.fireproof && e.maim.legs === 2 ? 4 : 0),
    enter(e, w) {
      e.mode = 'point';
      e.face = 'move';
      e.pace = 1.15;
      e.timerA = 0;
      say(e, w, 'vox_scream');
    },
    think(e, w) {
      if (w.now < e.timerA) return;
      e.timerA = w.now + rand(0.8, 1.5);
      const a = rand(0, TAU);
      _p.set(e.position.x + Math.sin(a) * 6, e.position.y, e.position.z + Math.cos(a) * 6);
      if (w.ctx.world.nav.nearest(_p, 4, _p)) e.moveTarget.copy(_p);
      e.char.anim.play('stagger', 1.5);
    },
  };
}

/** The Ghost powerup at work: past its range the player is just gone, so it wanders and looks around. */
export function lost(): Behaviour {
  return {
    name: 'lost',
    score: (e, w) => (w.player.ghost && e.dist > GHOST_RANGE && e.maim.legs > 0 ? 3.5 : 0),
    enter(e) {
      e.mode = 'point';
      e.face = 'move';
      e.pace = 0.45;
      e.timerA = 0;
      e.moveTarget.copy(e.position);
    },
    think(e, w) {
      if (w.now < e.timerA) return;
      e.timerA = w.now + rand(1.5, 3);
      const a = rand(0, TAU);
      _p.set(e.position.x + Math.sin(a) * 7, e.position.y, e.position.z + Math.cos(a) * 7);
      if (w.ctx.world.nav.nearest(_p, 4, _p)) e.moveTarget.copy(_p);
    },
  };
}

/** For anything with no gun left: run at the player, the way the gunless fight. */
export function rushWhenDisarmed(): Behaviour {
  return {
    name: 'rushDisarmed',
    score: (e) => (e.def.ranged && !e.maim.gunArm && !e.def.sidearm && e.maim.legs > 0 ? 3 : 0),
    enter(e) {
      e.mode = 'flow';
      e.face = 'move';
      e.pace = 1.1;
      e.weave = 0.15;
    },
    exit(e) {
      e.weave = 0;
    },
  };
}

/** Both legs gone. The rhythm comes from the gait in movement.ts; here it just decides where to drag. */
export function crawl(): Behaviour {
  return {
    name: 'crawl',
    score: (e) => (e.maim.legs === 0 && e.maim.arms > 0 ? 6 : 0),
    enter(e) {
      e.mode = 'flow';
      e.face = 'move';
      e.pace = e.def.crawlPace;
      e.weave = 0;
    },
    think(e) {
      // A crawler with a gun props up on one arm to shoot, then keeps dragging.
      const shooting = e.attackPhase === 'windup' || e.attackPhase === 'active';
      e.mode = shooting ? 'hold' : 'flow';
      e.face = shooting || e.dist < 3 ? 'player' : 'move';
    },
  };
}

/** No legs, no arms. Wriggling at the player with its teeth is all that is left. */
export function wriggle(): Behaviour {
  return {
    name: 'wriggle',
    score: (e) => (e.maim.legs === 0 && e.maim.arms === 0 ? 7 : 0),
    enter(e) {
      e.mode = 'flow';
      e.face = 'move';
      e.pace = e.def.crawlPace * 0.35;
    },
  };
}

/** No arms. Faster than before, because nothing else is left to try. */
export function headbuttCharge(): Behaviour {
  return {
    name: 'headbuttCharge',
    score: (e) => (e.maim.arms === 0 && e.maim.legs > 0 ? 5 : 0),
    enter(e) {
      e.mode = 'flow';
      e.face = 'move';
      e.pace = 1.2;
      e.weave = 0.1;
    },
    exit(e) {
      e.weave = 0;
    },
  };
}

