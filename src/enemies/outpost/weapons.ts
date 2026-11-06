/**
 * The soldiers' weapons. All of these are the soldiers' own: the swarm's attacks are built so that speed is armour, and a human has to be
 * able to hit a player who runs. See aim.ts. Telegraphs stay: a muzzle glint on a burst, a pump before a shotgun, a laser before a rocket or
 * a sniper round, a ring under a grenade. What changed is that the warning is now worth heeding.
 */
import * as THREE from 'three';
import type { MuzzleKind } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { clamp, rand, randomUnit } from '../../core/math';
import { hasGun, melee, muzzleOf, rocket, sniperShot } from '../attacks';
import type { AttackDef, AttackToken } from '../brain';
import type { Enemy } from '../Enemy';
import type { AiWorld } from '../aiWorld';
import { aimRound, interceptPoint, missRadius } from './aim';
import { AIM_BY_STATE } from './morale';
import { soldierOf, type Soldier } from './soldier';

/** Metres of scatter per metre of range when firing on a position, not a target. */
const SUPPRESS_SCATTER = 0.035;
const BLIND_SCATTER = 0.16;
const GRAVITY = 22;
const FRAG_RADIUS = 6.5;
const FRAG_DAMAGE = 62;
const FLASH_FUSE = 0.7;
/** Metres the aim point wanders per step past steady, for a hurt man with a heavy weapon. */
const WOUND_DRIFT = 0.8;
/** Seconds on a grenade a dying man let go of, and the push it gets from his hand. */
const LAST_FUSE = 1.9;
const LAST_ROLL = 1.6;
/** How much of its own flight a thrown grenade leads a target by. A throw is a guess. */
const THROW_LEAD = 0.6;
/** Rate a marksman's laser closes on where the target is going, in 1/s, for a regular. */
const LASER_RATE = 8;
const SNIPE_DAMAGE = 58;
/** A target that has stood still for this long gets the shot in the head. */
const SNIPE_STILL_SECONDS = 1;
const SNIPE_STILL_DAMAGE = 85;

const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rand = new THREE.Vector3();

/** Weapon up, rounds left, nerve holding, and something to shoot at: the player, or a position the squad wants kept down. */
const canFire = (e: Enemy): boolean => {
  const s = soldierOf(e);
  return !!s && s.fighting && !s.silent && s.weapon === 'primary' && s.exposed && s.mag > 0 && s.reloadUntil === 0 && hasGun(e) && (s.sees || s.suppressing || s.blind) && !heldBack(s);
};

/** The same, but only on a target he can see. Rockets and sniper rounds are too few to spend on a guess. */
const canAim = (e: Enemy): boolean => {
  const s = soldierOf(e);
  return !!s && s.fighting && !s.silent && s.weapon === 'primary' && s.exposed && s.sees && s.mag > 0 && s.reloadUntil === 0 && hasGun(e) && !heldBack(s);
};

/** One hand and a pistol: on his feet with a target, or from the floor if it comes close enough. */
const canFireSidearm = (e: Enemy): boolean => {
  const s = soldierOf(e);
  if (!s || s.weapon !== 'sidearm' || s.mag <= 0 || s.reloadUntil > 0) return false;
  return s.downed ? !e.downed && s.sees : s.fighting && s.exposed && s.sees && !heldBack(s);
};

/** One of his own is in the way. Whether that stops him depends on who he is. */
const heldBack = (s: Soldier): boolean => s.e.alive && s.squad !== undefined && !!soldierOutpost(s)?.prisoners.stopsFire(s);

const soldierOutpost = (s: Soldier) => s.squad.outpost;

/** Everything a shot needs that does not depend on the gun. */
function nerveOf(s: Soldier, w: AiWorld): number {
  return AIM_BY_STATE[s.state] * s.injuries.aimNow(w.now);
}

interface GunSpec {
  name: string;
  range: readonly [number, number];
  shots: number;
  gap: number;
  damage: number;
  speed: number;
  windup: number;
  cooldown: readonly [number, number];
  /** Multiplies the miss radius in aim.ts. */
  miss: number;
  sound: string;
  muzzle: MuzzleKind;
  moveMul: number;
  /** Null lets it fire regardless of the director's slots: a base of fire is no use if it has to wait its turn. */
  token: AttackToken;
  pitch?: number;
  /** A sound that lasts as long as the burst. */
  loop?: string;
  /** Who may fire it. Every long gun is `canFire`. */
  requires?: (e: Enemy) => boolean;
  /** Radians per second a belt-fed gun can swing. Set, the stream walks across the ground, and getting out of the lane is the answer to it. */
  traverse?: number;
}

/** Writes where this man wants his rounds to go, for a gun that has to swing to get there. */
function wanted(e: Enemy, w: AiWorld, s: Soldier, speed: number): void {
  if (s.sees) interceptPoint(w, s.squad.outpost.track, _muzzle, speed, s.rankDef.lead, _want);
  else _want.copy(s.aim);
  _dir.subVectors(_want, _muzzle).normalize();
}

function soldierGun(t: GunSpec): AttackDef {
  return {
    name: t.name,
    range: t.range,
    los: false,
    token: t.token,
    cooldown: t.cooldown,
    windup: t.windup,
    active: t.gap,
    shots: t.shots,
    recover: 0.2,
    moveMul: t.moveMul,
    requires: t.requires ?? canFire,
    begin(e, w) {
      const s = soldierOf(e)!;
      e.face = s.sees ? 'player' : 'lock';
      muzzleOf(e, _muzzle);
      w.telegraphs.glint(_muzzle, 0xff5030, 0.5, e.attackWindup);
      if (t.traverse) {
        wanted(e, w, s, t.speed);
        e.aimDir.copy(_dir);
      }
    },
    activeTick: t.traverse ? (e, w, dt) => {
      const s = soldierOf(e);
      if (!s) return;
      muzzleOf(e, _muzzle);
      wanted(e, w, s, t.speed);
      const angle = Math.acos(clamp(e.aimDir.dot(_dir), -1, 1));
      const swing = t.traverse! * dt / s.rankDef.aim;
      if (angle > 1e-3) e.aimDir.lerp(_dir, Math.min(1, swing / angle)).normalize();
    } : undefined,
    fire(e, w, index) {
      const s = soldierOf(e);
      if (!s || s.mag <= 0) return;
      s.mag--;
      s.firedAt = w.now;
      muzzleOf(e, _muzzle);
      const o = s.squad.outpost;
      const nerve = nerveOf(s, w);
      if (t.traverse) {
        const range = Math.max(_muzzle.distanceTo(s.sees ? w.player.chest : s.aim), 1);
        randomUnit(_rand);
        _dir.copy(e.aimDir).addScaledVector(_rand, (missRadius(w, range, s.rankDef, nerve, t.miss, 1) / range) * Math.sqrt(Math.random())).normalize();
      } else if (s.sees && !s.blind) aimRound(w, o.track, _muzzle, _dir, t.speed, s.rankDef, nerve, t.miss, index);
      else {
        randomUnit(_rand);
        const scatter = (s.blind ? BLIND_SCATTER : SUPPRESS_SCATTER) * _muzzle.distanceTo(s.aim) * nerve;
        _target.copy(s.aim).addScaledVector(_rand, scatter);
        _dir.subVectors(_target, _muzzle).normalize();
      }
      _vel.copy(_dir).multiplyScalar(t.speed);
      w.ctx.combat.spawnProjectile({
        origin: _muzzle, velocity: _vel, kind: 'bullet', team: 'enemy', damage: t.damage * e.damageMul, source: e.id, tracer: 'enemy', lifetime: 1.6,
      });
      w.ctx.combat.enemyMuzzle(_muzzle, _dir, t.muzzle);
      o.suppression.round(_muzzle, _dir, e.hasLos);
      if (t.loop) {
        if (index === 0) e.attackLoop = w.ctx.audio.startLoop(t.loop, { position: e.center });
      } else w.ctx.audio.play(t.sound, { position: _muzzle, pitch: t.pitch ?? 1, pitchJitter: 0.08 });
      e.char.anim.play('shoot', 1.4);
    },
  };
}

const rifle = soldierGun({
  name: 'rifle', range: [1.5, 52], shots: 3, gap: 0.1, damage: 7, speed: 88, windup: 0.26, cooldown: [0.5, 1.05], miss: 1,
  sound: 'enemy_smg', muzzle: 'enemy', moveMul: 0.65, token: 'ranged',
});

/**
 * The lane. A belt on a bipod fires for three seconds at a time and has to swing to follow, so at range it owns a line across the map. It
 * does not stop when the player breaks sight: the squad's `laneAt` keeps it working the ground, and that is what denies the space.
 */
const machineGun = soldierGun({
  name: 'machinegun', range: [2, 60], shots: 34, gap: 0.085, damage: 5.2, speed: 96, windup: 0.55, cooldown: [0.6, 1.2], miss: 1.15,
  sound: 'enemy_minigun_loop', muzzle: 'minigun', moveMul: 0.12, token: null, loop: 'enemy_minigun_loop', traverse: 1.15,
});

const sidearm = soldierGun({
  name: 'pistol', range: [2, 30], shots: 2, gap: 0.2, damage: 7, speed: 70, windup: 0.32, cooldown: [0.9, 1.6], miss: 1.15,
  sound: 'enemy_pistol', muzzle: 'enemy', moveMul: 0.8, token: 'ranged',
});

/** The backup. Slow to come up, single shots, and a good hand's worth of wandering on top of whatever is wrong with him. */
const backup = soldierGun({
  name: 'backup', range: [1.5, 24], shots: 1, gap: 0.2, damage: 6, speed: 66, windup: 0.5, cooldown: [0.8, 1.5], miss: 1.6,
  sound: 'enemy_pistol', muzzle: 'enemy', moveMul: 0.5, token: null, requires: canFireSidearm,
});

const carbine = soldierGun({
  name: 'carbine', range: [2, 36], shots: 2, gap: 0.15, damage: 7, speed: 74, windup: 0.36, cooldown: [1, 1.8], miss: 1.1,
  sound: 'enemy_pistol', pitch: 0.8, muzzle: 'enemy', moveMul: 0.6, token: 'ranged',
});

/** Pump, pause, boom. Close in it is the worst thing in the building, and the pause is the only way out of it. */
const shotgunBlast: AttackDef = {
  name: 'blast',
  range: [0.5, 16],
  los: false,
  token: 'ranged',
  cooldown: [1.1, 1.7],
  windup: 0.42,
  active: 0.1,
  recover: 0.35,
  moveMul: 0.55,
  requires: canAim,
  begin(e, w) {
    e.face = 'player';
    w.ctx.audio.play('smg_reload', { position: e.center, volume: 0.55, pitch: 1.5 });
    muzzleOf(e, _muzzle);
    w.telegraphs.glint(_muzzle, 0xffa030, 0.8, e.attackWindup);
  },
  fire(e, w) {
    const s = soldierOf(e);
    if (!s) return;
    s.mag--;
    s.firedAt = w.now;
    muzzleOf(e, _muzzle);
    aimRound(w, s.squad.outpost.track, _muzzle, _want, 80, s.rankDef, nerveOf(s, w), 0.45, 1);
    for (let i = 0; i < 8; i++) {
      _dir.copy(_want);
      _dir.x += rand(-0.055, 0.055);
      _dir.y += rand(-0.04, 0.04);
      _dir.z += rand(-0.055, 0.055);
      _dir.normalize();
      _vel.copy(_dir).multiplyScalar(80);
      w.ctx.combat.spawnProjectile({ origin: _muzzle, velocity: _vel, kind: 'bullet', team: 'enemy', damage: 5.5 * e.damageMul, source: e.id, tracer: 'enemy', lifetime: 0.6 });
    }
    w.ctx.combat.enemyMuzzle(_muzzle, _want, 'shotgun');
    s.squad.outpost.suppression.round(_muzzle, _want, e.hasLos);
    w.ctx.audio.play('enemy_shotgun', { position: _muzzle, pitchJitter: 0.08 });
    e.char.anim.play('shoot', 0.8);
  },
};

const launcher = rocket({ name: 'rocket', range: [8, 54], damage: 44, radius: 5, speed: 34, windup: 0.85, cooldown: [3, 4.4] });

/** The laser telegraph is the swarm's. The round goes where the target will be and not where it was, and it lands at its feet. */
const rocketShot: AttackDef = {
  ...launcher,
  requires: canAim,
  fire(e, w) {
    const s = soldierOf(e);
    if (!s) return;
    s.mag--;
    s.firedAt = w.now;
    muzzleOf(e, _muzzle);
    interceptPoint(w, s.squad.outpost.track, _muzzle, 34, s.rankDef.lead, _target);
    _target.y -= 1;
    wander(s, w);
    _dir.subVectors(_target, _muzzle).normalize();
    _vel.copy(_dir).multiplyScalar(34);
    w.ctx.combat.spawnProjectile({
      origin: _muzzle, velocity: _vel, kind: 'rocket', team: 'enemy', damage: 44 * e.damageMul, source: e.id, explosion: { radius: 5, damage: 44 * e.damageMul, kind: 'enemy', selfDamage: 1 }, lifetime: 5, homing: 0,
    });
    w.ctx.combat.enemyMuzzle(_muzzle, _dir, 'rocket');
    w.ctx.audio.play('enemy_rocket_fire', { position: _muzzle, pitchJitter: 0.08 });
  },
};

/** A shaking hand is a target that is not quite there. */
function wander(s: Soldier, w: AiWorld): void {
  const shake = (s.injuries.aimNow(w.now) - 1) * WOUND_DRIFT;
  if (shake <= 0) return;
  randomUnit(_rand);
  _target.addScaledVector(_rand, shake);
}

const snipe = sniperShot({ name: 'snipe', range: [10, 90], damage: SNIPE_DAMAGE, windup: 1.45, lock: 0.28, cooldown: [2, 3] });

/**
 * The laser walks onto where the target is going. Running in a straight line no longer dodges it, because the dot is ahead of you. What
 * dodges it is a change of direction inside the last third of a second, after the dot turns solid. Stand still and it is a head shot.
 */
const marksmanShot: AttackDef = {
  ...snipe,
  requires: canAim,
  windupTick(e, w, dt) {
    const s = soldierOf(e);
    if (!s) return;
    const left = e.attackWindup - e.attackClock;
    muzzleOf(e, _muzzle);
    if (left > 0.28) {
      interceptPoint(w, s.squad.outpost.track, _muzzle, _muzzle.distanceTo(w.player.chest) / Math.max(left, 0.28), s.rankDef.lead, _target);
      e.aimPoint.lerp(_target, 1 - Math.exp(-(LASER_RATE / s.rankDef.aim) * dt));
    } else if (e.attackStage === 0) {
      e.attackStage = 1;
      w.telegraphs.setLaserStrength(e.laser, 1.6);
      w.ctx.audio.play('menu_select', { position: e.center, volume: 0.8, pitch: 1.8 });
    }
    w.telegraphs.aimLaser(e.laser, _muzzle, e.aimPoint);
  },
  fire(e, w) {
    const s = soldierOf(e);
    if (!s) return;
    s.mag--;
    s.firedAt = w.now;
    muzzleOf(e, _muzzle);
    _target.copy(e.aimPoint);
    wander(s, w);
    _dir.subVectors(_target, _muzzle).normalize();
    const still = s.squad.outpost.stillFor >= SNIPE_STILL_SECONDS;
    w.ctx.combat.fireRay(_muzzle, _dir, { damage: (still ? SNIPE_STILL_DAMAGE : SNIPE_DAMAGE) * e.damageMul, source: e.id, team: 'enemy', maxDistance: 240, tracer: 'heavy' });
    w.ctx.combat.enemyMuzzle(_muzzle, _dir, 'railgun');
    s.squad.outpost.suppression.round(_muzzle, _dir, e.hasLos);
    w.ctx.audio.play('sniper_fire', { position: _muzzle, pitchJitter: 0.05 });
    e.char.anim.play('shoot', 0.8);
    e.shotsFired++;
  },
};

/** Lands on the point, with a fuse that runs out shortly after. A good man holds it first, so there is less time to leave. */
function lob(e: Enemy, w: AiWorld, flash: boolean): void {
  const s = soldierOf(e)!;
  muzzleOf(e, _muzzle);
  _muzzle.y += 0.25;
  const o = s.squad.outpost;
  _target.copy(s.throwAt);
  const reach = Math.hypot(_target.x - _muzzle.x, _target.z - _muzzle.z);
  const flight = Math.min(1.5, Math.max(0.55, reach / 13));
  if (s.sees) {
    _target.x += o.track.velocity.x * flight * THROW_LEAD;
    _target.z += o.track.velocity.z * flight * THROW_LEAD;
  }
  const dx = _target.x - _muzzle.x, dy = _target.y - _muzzle.y, dz = _target.z - _muzzle.z;
  _vel.set(dx / flight, dy / flight + 0.5 * GRAVITY * flight, dz / flight);
  const fuse = flight + (flash ? FLASH_FUSE : s.rankDef.cook);
  w.ctx.combat.spawnProjectile({
    origin: _muzzle, velocity: _vel, kind: 'grenade', team: 'enemy', damage: 0, source: flash ? 'flashbang' : 'frag', gravity: -GRAVITY, fuse, lifetime: fuse + 1, trail: 'none',
    explosion: flash ? { radius: 0.5, damage: 0, kind: 'grenade', scale: 0.4 } : { radius: FRAG_RADIUS, damage: FRAG_DAMAGE * e.damageMul, kind: 'grenade', selfDamage: 1 },
  });
  w.ctx.audio.play('grenade_throw', { position: e.center, volume: 0.7 });
  if (flash) o.flashbang(_target, fuse);
  else w.telegraphs.zone(_target, FRAG_RADIUS, fuse);
}

const grenade: AttackDef = {
  name: 'grenade',
  range: [0, 80],
  los: false,
  token: null,
  cooldown: [1, 2],
  windup: 0.6,
  active: 0.1,
  recover: 0.4,
  moveMul: 0.2,
  weight: 10,
  requires: e => {
    const s = soldierOf(e);
    return !!s && s.fighting && !s.silent && s.throwKind !== null && e.maim.arms > 0;
  },
  begin(e, w) {
    const s = soldierOf(e)!;
    e.char.anim.play('throw', 0.9);
    w.ctx.audio.play('grenade_pin', { position: e.center, volume: 0.6 });
    s.squad.outpost.comms.say(s.throwKind === 'flash' ? 'flash' : 'frag', s);
  },
  fire(e, w) {
    const s = soldierOf(e)!;
    const flash = s.throwKind === 'flash';
    lob(e, w, flash);
    if (flash) s.flashes--;
    else s.grenades--;
    s.throwKind = null;
  },
};

/** It rolls free of his hand. Everyone near has about two seconds, him included. */
export function dropGrenade(e: Enemy, w: AiWorld): void {
  randomUnit(_rand);
  _muzzle.copy(e.center);
  _vel.set(_rand.x * LAST_ROLL, 1, _rand.z * LAST_ROLL);
  w.ctx.combat.spawnProjectile({
    origin: _muzzle, velocity: _vel, kind: 'grenade', team: 'enemy', damage: 0, source: 'frag', gravity: -GRAVITY, fuse: LAST_FUSE, lifetime: LAST_FUSE + 1, trail: 'none',
    explosion: { radius: FRAG_RADIUS, damage: FRAG_DAMAGE * e.damageMul, kind: 'grenade', selfDamage: 1 },
  });
  w.ctx.audio.play('grenade_pin', { position: e.center, volume: 0.8 });
  w.telegraphs.zone(_muzzle, FRAG_RADIUS, LAST_FUSE);
}

/** Riot officers still bash. It is the one melee a soldier does on purpose, and it needs the shield. */
const shieldBash = melee({
  name: 'bash', reach: 2.7, damage: 16, windup: 0.45, knock: 11, anim: 'attackHeavy', cooldown: [1.6, 2.4], requires: e => e.shield,
});

/** Get inside a rifle's reach and it comes round at your jaw. Closing on these men is not free. */
const buttStroke = melee({
  name: 'butt', reach: 2.6, damage: 20, windup: 0.45, anim: 'attackHeavy', knock: 9, cooldown: [1.8, 2.8], requires: e => e.maim.legs > 0 && e.maim.arms > 0 && !!soldierOf(e)?.fighting && !soldierOf(e)?.silent,
});

const LOADOUT: Partial<Record<EnemyId, readonly AttackDef[]>> = {
  trooper: [rifle, buttStroke],
  gunner: [shotgunBlast, buttStroke],
  brute: [machineGun, buttStroke],
  rocketeer: [rocketShot],
  sniper: [marksmanShot],
  riot: [sidearm, shieldBash],
  warden: [carbine, buttStroke],
};

/** One shared list per type: attacks hold no per-enemy state. */
const lists = new Map<EnemyId, AttackDef[]>();

export function soldierAttacks(id: EnemyId): AttackDef[] {
  let list = lists.get(id);
  if (!list) {
    list = [...(LOADOUT[id] ?? []), grenade, backup];
    lists.set(id, list);
  }
  return list;
}
