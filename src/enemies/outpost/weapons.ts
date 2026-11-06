/**
 * The soldiers' weapons. Rockets, shotguns and the sniper rifle are the swarm game's attacks with a soldier's conditions
 * on them. Rifles and the machine gun are new, because they have to be able to fire at where the player was, not just at
 * the player, and to shoot worse as the man holding them loses his nerve.
 */
import * as THREE from 'three';
import type { MuzzleKind } from '../../core/contracts';
import type { EnemyId } from '../../core/gameplay';
import { randomUnit } from '../../core/math';
import { aimAtPlayer, grazed, hasGun, melee, muzzleOf, rocket, shotgun, sniperShot } from '../attacks';
import type { AttackDef, AttackToken } from '../brain';
import type { Enemy } from '../Enemy';
import type { AiWorld } from '../aiWorld';
import { AIM_BY_STATE } from './morale';
import { soldierOf } from './soldier';

/** Metres of scatter per metre of range when firing on a position, not a target. */
const SUPPRESS_SCATTER = 0.05;
const BLIND_SCATTER = 0.16;
const GRAVITY = 22;
const FRAG_RADIUS = 6;
const FRAG_DAMAGE = 34;
/** Seconds after landing. Long enough to see it and go. */
const FRAG_FUSE = 1.25;
const FLASH_FUSE = 0.7;
/** Metres the aim point wanders per step past steady, for guns that aim through the swarm's own attacks. */
const WOUND_DRIFT = 0.8;
/** Seconds on a grenade a dying man let go of, and the push it gets from his hand. */
const LAST_FUSE = 1.9;
const LAST_ROLL = 1.6;

const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rand = new THREE.Vector3();

/** Weapon up, rounds left, nerve holding, and something to shoot at: the player, or a position the squad wants kept down. */
const canFire = (e: Enemy): boolean => {
  const s = soldierOf(e);
  return !!s && s.fighting && s.weapon === 'primary' && s.exposed && s.mag > 0 && s.reloadUntil === 0 && hasGun(e) && (s.sees || s.suppressing || s.blind);
};

/** The same, but only on a target he can see. Rockets and sniper rounds are too few to spend on a guess. */
const canAim = (e: Enemy): boolean => {
  const s = soldierOf(e);
  return !!s && s.fighting && s.weapon === 'primary' && s.exposed && s.sees && s.mag > 0 && s.reloadUntil === 0 && hasGun(e);
};

/** One hand and a pistol: on his feet with a target, or from the floor if it comes close enough. */
const canFireSidearm = (e: Enemy): boolean => {
  const s = soldierOf(e);
  if (!s || s.weapon !== 'sidearm' || s.mag <= 0 || s.reloadUntil > 0) return false;
  return s.downed ? !e.downed && s.sees : s.fighting && s.exposed && s.sees;
};

interface GunSpec {
  name: string;
  range: readonly [number, number];
  shots: number;
  gap: number;
  damage: number;
  speed: number;
  windup: number;
  cooldown: readonly [number, number];
  lead: number;
  /** Miss radius in metres at the player, standing and at speed. */
  missStill: number;
  missFast: number;
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
    recover: 0.3,
    moveMul: t.moveMul,
    requires: t.requires ?? canFire,
    begin(e, w) {
      e.face = soldierOf(e)!.sees ? 'player' : 'lock';
      muzzleOf(e, _muzzle);
      w.telegraphs.glint(_muzzle, 0xff5030, 0.5, e.attackWindup);
    },
    fire(e, w, index) {
      const s = soldierOf(e);
      if (!s || s.mag <= 0) return;
      s.mag--;
      muzzleOf(e, _muzzle);
      const nerve = AIM_BY_STATE[s.state] * s.injuries.aimNow(w.now);
      if (s.sees && !s.blind) aimAtPlayer(w, _muzzle, _dir, t.speed, t.lead, t.missStill * nerve, t.missFast * nerve);
      else {
        randomUnit(_rand);
        const scatter = (s.blind ? BLIND_SCATTER : SUPPRESS_SCATTER) * _muzzle.distanceTo(s.aim) * nerve;
        _target.copy(s.aim).addScaledVector(_rand, scatter);
        _dir.subVectors(_target, _muzzle).normalize();
      }
      _vel.copy(_dir).multiplyScalar(t.speed);
      w.ctx.combat.spawnProjectile({
        origin: _muzzle, velocity: _vel, kind: 'bullet', team: 'enemy', damage: grazed(w, t.damage * e.damageMul), source: e.id, tracer: 'enemy', lifetime: 2.5,
      });
      w.ctx.combat.enemyMuzzle(_muzzle, _dir, t.muzzle);
      if (t.loop) {
        if (index === 0) e.attackLoop = w.ctx.audio.startLoop(t.loop, { position: e.center });
      } else w.ctx.audio.play(t.sound, { position: _muzzle, pitch: t.pitch ?? 1, pitchJitter: 0.08 });
      e.char.anim.play('shoot', 1.4);
    },
  };
}

/** Puts a soldier's conditions and magazine on one of the swarm's attacks. */
function drilled(a: AttackDef): AttackDef {
  return {
    ...a,
    requires: e => canAim(e),
    fire(e, w, index) {
      const s = soldierOf(e);
      if (s) s.mag--;
      // The swarm's attacks aim at the player's chest, so a shaking hand is a chest that is not quite there.
      const shake = s ? (s.injuries.aimNow(w.now) - 1) * WOUND_DRIFT : 0;
      if (shake > 0) {
        randomUnit(_rand);
        w.player.chest.addScaledVector(_rand, shake);
      }
      a.fire(e, w, index);
      if (shake > 0) w.player.chest.addScaledVector(_rand, -shake);
    },
  };
}

const rifle = soldierGun({
  name: 'rifle', range: [1.5, 46], shots: 3, gap: 0.11, damage: 5, speed: 52, windup: 0.34, cooldown: [0.9, 1.7], lead: 0.55,
  missStill: 0.35, missFast: 4, sound: 'enemy_smg', muzzle: 'enemy', moveMul: 0.6, token: 'ranged',
});

const machineGun = soldierGun({
  name: 'machinegun', range: [2, 50], shots: 22, gap: 0.095, damage: 3.2, speed: 58, windup: 0.8, cooldown: [1.2, 2.2], lead: 0.4,
  missStill: 0.7, missFast: 5, sound: 'enemy_minigun_loop', muzzle: 'minigun', moveMul: 0.15, token: null, loop: 'enemy_minigun_loop',
});

const sidearm = soldierGun({
  name: 'pistol', range: [2, 28], shots: 2, gap: 0.22, damage: 5, speed: 46, windup: 0.42, cooldown: [1.4, 2.4], lead: 0.4,
  missStill: 0.4, missFast: 4.5, sound: 'enemy_pistol', muzzle: 'enemy', moveMul: 0.8, token: 'ranged',
});

/** The backup. Slow to come up, single shots, and a good hand's worth of wandering on top of whatever is wrong with him. */
const backup = soldierGun({
  name: 'backup', range: [1.5, 22], shots: 1, gap: 0.2, damage: 4, speed: 44, windup: 0.6, cooldown: [1, 1.9], lead: 0.2,
  missStill: 1.1, missFast: 5.5, sound: 'enemy_pistol', muzzle: 'enemy', moveMul: 0.5, token: null, requires: canFireSidearm,
});

const carbine = soldierGun({
  name: 'carbine', range: [2, 34], shots: 2, gap: 0.16, damage: 5, speed: 46, windup: 0.5, cooldown: [1.6, 2.6], lead: 0.4,
  missStill: 0.45, missFast: 4.5, sound: 'enemy_pistol', pitch: 0.8, muzzle: 'enemy', moveMul: 0.6, token: 'ranged',
});

/** Lands on the point with a fuse that runs out shortly after. */
function lob(e: Enemy, w: AiWorld, flash: boolean): void {
  const s = soldierOf(e)!;
  muzzleOf(e, _muzzle);
  _muzzle.y += 0.25;
  const dx = s.throwAt.x - _muzzle.x, dy = s.throwAt.y - _muzzle.y, dz = s.throwAt.z - _muzzle.z;
  const flight = Math.min(1.5, Math.max(0.55, Math.hypot(dx, dz) / 13));
  _vel.set(dx / flight, dy / flight + 0.5 * GRAVITY * flight, dz / flight);
  const fuse = flight + (flash ? FLASH_FUSE : FRAG_FUSE);
  w.ctx.combat.spawnProjectile({
    origin: _muzzle, velocity: _vel, kind: 'grenade', team: 'enemy', damage: 0, source: flash ? 'flashbang' : 'frag', gravity: -GRAVITY, fuse, lifetime: fuse + 1, trail: 'none',
    explosion: flash ? { radius: 0.5, damage: 0, kind: 'grenade', scale: 0.4 } : { radius: FRAG_RADIUS, damage: FRAG_DAMAGE * e.damageMul, kind: 'grenade', selfDamage: 1 },
  });
  w.ctx.audio.play('grenade_throw', { position: e.center, volume: 0.7 });
  if (flash) w.enemies.outpost!.flashbang(s.throwAt, fuse);
  else w.telegraphs.zone(s.throwAt, FRAG_RADIUS, fuse);
}

const grenade: AttackDef = {
  name: 'grenade',
  range: [0, 80],
  los: false,
  token: null,
  cooldown: [1, 2],
  windup: 0.7,
  active: 0.1,
  recover: 0.5,
  moveMul: 0.2,
  weight: 10,
  requires: e => {
    const s = soldierOf(e);
    return !!s && s.fighting && s.throwKind !== null && e.maim.arms > 0;
  },
  begin(e, w) {
    const s = soldierOf(e)!;
    e.char.anim.play('throw', 0.9);
    w.ctx.audio.play('grenade_pin', { position: e.center, volume: 0.6 });
    w.enemies.outpost!.comms.say(s.throwKind === 'flash' ? 'flash' : 'frag', s);
  },
  fire(e, w) {
    const s = soldierOf(e)!;
    const flash = s.throwKind === 'flash';
    lob(e, w, flash);
    if (!flash) s.grenades--;
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
  name: 'bash', reach: 2.7, damage: 12, windup: 0.5, knock: 11, anim: 'attackHeavy', cooldown: [1.8, 2.8], requires: e => e.shield,
});

const buttStroke = melee({
  name: 'butt', reach: 2.6, damage: 16, windup: 0.55, anim: 'attackHeavy', knock: 9, cooldown: [2.2, 3.2], requires: e => e.maim.legs > 0 && e.maim.arms > 0 && !!soldierOf(e)?.fighting,
});

const LOADOUT: Partial<Record<EnemyId, readonly AttackDef[]>> = {
  trooper: [rifle],
  gunner: [drilled(shotgun({ name: 'blast', range: [0.5, 13], pellets: 6, damage: 3.2, speed: 62, windup: 0.5, cooldown: [1.7, 2.5] }))],
  brute: [machineGun, buttStroke],
  rocketeer: [drilled(rocket({ name: 'rocket', range: [8, 50], damage: 24, radius: 5, speed: 26, windup: 0.95, cooldown: [3.6, 5.2] }))],
  sniper: [drilled(sniperShot({ name: 'snipe', range: [10, 70], damage: 30, windup: 1.9, lock: 0.3, cooldown: [2.4, 3.4] }))],
  riot: [sidearm, shieldBash],
  warden: [carbine],
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
