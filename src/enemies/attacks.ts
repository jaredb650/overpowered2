/**
 * Attack library. Factories take tuning and return data the brain runs, so a new enemy is a table entry.
 * Everything that hurts goes through a telegraph: a pose, a sound, and for the worst of it a laser or a ring.
 */
import * as THREE from 'three';
import { HumanoidBone as B } from '../characters/rig';
import type { MuzzleKind, TracerKind } from '../core/contracts';
import { clamp, rand, randomUnit } from '../core/math';
import type { AttackDef } from './brain';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';
import { leapTo } from './movement';

const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rand = new THREE.Vector3();
const _a = new THREE.Vector3();

/** The contract leaves this off; the library sets it on anything carrying a gun. */
interface Armed {
  readonly muzzle: THREE.Object3D | null;
}

export const hasGun = (e: Enemy): boolean => e.maim.gunArm;

/**
 * World position of the barrel. Guns report it exactly. Bodies with no gun model (the Titan's arm cannon, the drone's
 * turret) fall back on the bone, and a shooter whose gun arm is gone fires the sidearm from the other hand.
 */
export function muzzleOf(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  const muzzle = (e.char as unknown as Armed).muzzle;
  if (muzzle && e.maim.gunArm) return muzzle.getWorldPosition(out);
  const bone = e.char.bones[e.maim.gunArm ? e.def.muzzleBone : B.handL];
  if (!bone) return out.copy(e.center);
  bone.getWorldPosition(out);
  out.x += Math.sin(e.yaw) * e.def.muzzleForward;
  out.z += Math.cos(e.yaw) * e.def.muzzleForward;
  return out;
}

/**
 * Speed is armour. The aim point is off by a miss radius in metres at the player, so a standing target eats
 * nearly everything at any range, while a full-speed target needs a lucky roll inside `missFast`.
 * `lead` is how much of the player's flight-time motion the shooter accounts for.
 */
export function aimAtPlayer(
  w: AiWorld, from: THREE.Vector3, out: THREE.Vector3, projectileSpeed: number, lead: number, missStill: number, missFast: number,
): THREE.Vector3 {
  const p = w.player;
  const flight = from.distanceTo(p.chest) / projectileSpeed;
  _target.copy(p.chest).addScaledVector(p.velocity, flight * lead);
  const miss = (missStill + (missFast - missStill) * p.evasion) * Math.sqrt(Math.random());
  randomUnit(_rand);
  _target.addScaledVector(_rand, miss);
  return out.subVectors(_target, from).normalize();
}

/** A fast player gets grazed: what does land, lands lighter. */
export const grazed = (w: AiWorld, amount: number): number => amount * (1 - 0.5 * w.player.evasion);

/** One line from this enemy's own voice. */
export function say(e: Enemy, w: AiWorld, line: string, volume = 0.7): void {
  w.ctx.audio.play(line, { position: e.center, volume, pitch: e.def.voice.pitch, pitchJitter: 0.08 });
}

/**
 * Where a leap at the player should come down: at their feet by the time it lands, but short of them by a body width,
 * so it arrives in the face and not inside the camera.
 */
export function leadLanding(e: Enemy, w: AiWorld, lead: number, snap: number, out: THREE.Vector3): THREE.Vector3 {
  const p = w.player;
  out.copy(p.position).addScaledVector(p.velocity, lead);
  const dx = e.position.x - out.x;
  const dz = e.position.z - out.z;
  const d = Math.hypot(dx, dz) || 1;
  const standOff = Math.min(e.def.radius + 0.7, d);
  out.x += (dx / d) * standOff;
  out.z += (dz / d) * standOff;
  if (!w.ctx.world.nav.nearest(out, snap, out)) out.copy(p.position);
  return out;
}

export function meleeConnect(e: Enemy, w: AiWorld, reach: number, arc: number, damage: number, source: string, knock = 0): boolean {
  const p = w.player;
  if (!p.alive) return false;
  const dx = p.position.x - e.position.x;
  const dz = p.position.z - e.position.z;
  const dy = p.position.y - e.position.y;
  const d = Math.hypot(dx, dz);
  if (d > reach || Math.abs(dy) > 2.4 + e.char.rig.height * 0.3) return false;
  if (d > 0.3) {
    const facing = (Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz) / d;
    if (facing < arc) return false;
  }
  w.ctx.player.takeDamage({ amount: damage * e.damageMul, from: e.position, type: 'melee', source });
  if (knock > 0 && d > 0.01) {
    _vel.set((dx / d) * knock, knock * 0.35, (dz / d) * knock);
    w.ctx.player.launch(_vel);
  }
  return true;
}

export interface MeleeTuning {
  name: string;
  reach: number;
  damage: number;
  windup: number;
  recover?: number;
  cooldown?: readonly [number, number];
  anim?: 'attackMelee' | 'attackHeavy';
  moveMul?: number;
  arc?: number;
  knock?: number;
  requires?(e: Enemy): boolean;
  weight?: number;
  /** Extra strikes spaced by `gap`. */
  hits?: number;
  gap?: number;
  source?: string;
  sound?: string;
}

export function melee(t: MeleeTuning): AttackDef {
  const anim = t.anim ?? 'attackMelee';
  const arc = t.arc ?? 0.1;
  return {
    name: t.name,
    range: [0, t.reach + 0.4],
    los: false,
    token: 'melee',
    cooldown: t.cooldown ?? [0.9, 1.5],
    windup: t.windup,
    active: t.gap ?? 0.1,
    shots: t.hits ?? 1,
    recover: t.recover ?? 0.45,
    moveMul: t.moveMul ?? 0.35,
    weight: t.weight ?? 3,
    requires: t.requires,
    begin(e, w) {
      e.char.anim.play(anim, 0.45 / Math.max(t.windup + 0.12, 0.2));
      e.face = 'player';
      say(e, w, e.def.voice.attack);
    },
    fire(e, w) {
      w.ctx.audio.play(t.sound ?? 'enemy_swing', { position: e.center, pitchJitter: 0.1 });
      meleeConnect(e, w, t.reach, arc, t.damage, t.source ?? e.id, t.knock ?? 0);
    },
  };
}

export interface LungeTuning {
  name: string;
  range: readonly [number, number];
  damage: number;
  windup: number;
  flight: number;
  cooldown: readonly [number, number];
  requires?(e: Enemy): boolean;
  apex?: number;
}

/** Springs at where the player is going. Dangerous head on, a free kill if you sidestep it. */
export function lunge(t: LungeTuning): AttackDef {
  return {
    name: t.name,
    range: t.range,
    los: true,
    token: 'melee',
    cooldown: t.cooldown,
    windup: t.windup,
    active: t.flight,
    recover: 0.5,
    moveMul: 0.1,
    weight: 2,
    requires: t.requires,
    begin(e, w) {
      e.char.anim.play('attackHeavy', 0.8);
      e.face = 'player';
      say(e, w, e.def.voice.attack, 0.9);
    },
    fire(e, w) {
      leadLanding(e, w, t.flight * 0.5, 6, _target);
      e.char.anim.play('leap');
      w.ctx.audio.play('enemy_lunge', { position: e.center, pitchJitter: 0.1 });
      leapTo(e, _target, t.flight, t.apex ?? 0.8);
      e.attackStage = 1;
    },
    activeTick(e, w) {
      if (e.attackStage !== 1) return;
      if (meleeConnect(e, w, 1.7, -1, t.damage, e.id, 5)) e.attackStage = 2;
    },
  };
}

export interface GunTuning {
  name: string;
  range: readonly [number, number];
  shots: number;
  gap: number;
  damage: number;
  speed: number;
  windup: number;
  recover?: number;
  cooldown: readonly [number, number];
  lead: number;
  missStill: number;
  missFast: number;
  sound: string;
  volume?: number;
  pitch?: number;
  muzzle: MuzzleKind;
  tracer?: TracerKind;
  moveMul?: number;
  requires?(e: Enemy): boolean;
  weight?: number;
  /** Plays during the wind-up as the audible tell. */
  tell?: string;
  tellPitch?: number;
  /** A red sight line during the wind-up, for guns too small to read at range. */
  laser?: boolean;
  source?: string;
}

/** Slow straight bullets with a near-miss whizz, as the first game had. Dodging them is the point. */
export function gun(t: GunTuning): AttackDef {
  return {
    name: t.name,
    range: t.range,
    los: true,
    token: 'ranged',
    cooldown: t.cooldown,
    windup: t.windup,
    active: t.gap,
    shots: t.shots,
    recover: t.recover ?? 0.3,
    moveMul: t.moveMul ?? 0.55,
    weight: t.weight ?? 1,
    requires: t.requires ?? hasGun,
    begin(e, w) {
      e.face = 'player';
      if (t.tell) w.ctx.audio.play(t.tell, { position: e.center, volume: 0.5, pitch: t.tellPitch ?? 1, pitchJitter: 0.05 });
      muzzleOf(e, _muzzle);
      w.telegraphs.glint(_muzzle, 0xff5030, 0.5, e.attackWindup);
      if (t.laser) e.laser = w.telegraphs.acquireLaser(0xff3020, 0.5);
    },
    windupTick(e, w) {
      if (e.laser >= 0) {
        muzzleOf(e, _muzzle);
        w.telegraphs.aimLaser(e.laser, _muzzle, w.player.chest);
      }
    },
    fire(e, w) {
      muzzleOf(e, _muzzle);
      aimAtPlayer(w, _muzzle, _dir, t.speed, t.lead, t.missStill, t.missFast);
      _vel.copy(_dir).multiplyScalar(t.speed);
      w.ctx.combat.spawnProjectile({
        origin: _muzzle, velocity: _vel, kind: 'bullet', team: 'enemy',
        damage: grazed(w, t.damage * e.damageMul), source: t.source ?? e.id,
        tracer: t.tracer ?? 'enemy', lifetime: 3,
      });
      w.ctx.combat.enemyMuzzle(_muzzle, _dir, t.muzzle);
      w.ctx.audio.play(t.sound, { position: _muzzle, volume: t.volume ?? 1, pitch: t.pitch ?? 1, pitchJitter: 0.08 });
      e.char.anim.play('shoot', 1.4);
    },
    end(e, w) {
      if (e.laser >= 0) {
        w.telegraphs.releaseLaser(e.laser);
        e.laser = -1;
      }
    },
  };
}

export interface ShotgunTuning {
  name: string;
  range: readonly [number, number];
  pellets: number;
  damage: number;
  speed: number;
  windup: number;
  cooldown: readonly [number, number];
  requires?(e: Enemy): boolean;
}

/** Pump, pause, boom. The pause is the dodge window. */
export function shotgun(t: ShotgunTuning): AttackDef {
  return {
    name: t.name,
    range: t.range,
    los: true,
    token: 'ranged',
    cooldown: t.cooldown,
    windup: t.windup,
    active: 0.1,
    recover: 0.45,
    moveMul: 0.5,
    requires: t.requires ?? hasGun,
    begin(e, w) {
      e.face = 'player';
      w.ctx.audio.play('smg_reload', { position: e.center, volume: 0.55, pitch: 1.5 });
      muzzleOf(e, _muzzle);
      w.telegraphs.glint(_muzzle, 0xffa030, 0.8, e.attackWindup);
    },
    fire(e, w) {
      muzzleOf(e, _muzzle);
      aimAtPlayer(w, _muzzle, _a, t.speed, 0.35, 0.2, 2.2);
      for (let i = 0; i < t.pellets; i++) {
        _dir.copy(_a);
        _dir.x += rand(-0.07, 0.07);
        _dir.y += rand(-0.05, 0.05);
        _dir.z += rand(-0.07, 0.07);
        _dir.normalize();
        _vel.copy(_dir).multiplyScalar(t.speed);
        w.ctx.combat.spawnProjectile({
          origin: _muzzle, velocity: _vel, kind: 'bullet', team: 'enemy',
          damage: grazed(w, t.damage * e.damageMul), source: e.id, tracer: 'enemy', lifetime: 1.2,
        });
      }
      w.ctx.combat.enemyMuzzle(_muzzle, _a, 'shotgun');
      w.ctx.audio.play('enemy_shotgun', { position: _muzzle, pitchJitter: 0.08 });
      e.char.anim.play('shoot', 0.8);
    },
  };
}

export interface RocketTuning {
  name: string;
  range: readonly [number, number];
  damage: number;
  radius: number;
  speed: number;
  windup: number;
  cooldown: readonly [number, number];
  homing?: number;
  shots?: number;
  gap?: number;
  requires?(e: Enemy): boolean;
}

/** Slow, heavy, and it tells you: a laser settles on you and the launcher whines before it fires. */
export function rocket(t: RocketTuning): AttackDef {
  return {
    name: t.name,
    range: t.range,
    los: true,
    token: 'ranged',
    cooldown: t.cooldown,
    windup: t.windup,
    active: t.gap ?? 0.1,
    shots: t.shots ?? 1,
    recover: 0.6,
    moveMul: 0.2,
    requires: t.requires ?? hasGun,
    begin(e, w) {
      e.face = 'player';
      e.char.anim.play('throw', 0.7);
      w.ctx.audio.play('autocannon_zoom', { position: e.center, volume: 0.6, pitch: 1.3 });
      e.laser = w.telegraphs.acquireLaser(0x30ffc0, 0.8);
    },
    windupTick(e, w) {
      muzzleOf(e, _muzzle);
      w.telegraphs.aimLaser(e.laser, _muzzle, w.player.chest);
    },
    fire(e, w) {
      muzzleOf(e, _muzzle);
      // Rockets aim at the feet, so a miss still splashes near a player on the ground.
      _target.copy(w.player.position).addScaledVector(w.player.velocity, (e.dist / t.speed) * 0.5);
      _dir.subVectors(_target, _muzzle).normalize();
      _vel.copy(_dir).multiplyScalar(t.speed);
      w.ctx.combat.spawnProjectile({
        origin: _muzzle, velocity: _vel, kind: 'rocket', team: 'enemy', damage: t.damage * e.damageMul, source: e.id,
        explosion: { radius: t.radius, damage: t.damage * e.damageMul, kind: 'enemy', selfDamage: 1 },
        lifetime: 6, homing: t.homing ?? 0,
      });
      w.ctx.combat.enemyMuzzle(_muzzle, _dir, 'rocket');
      w.ctx.audio.play('enemy_rocket_fire', { position: _muzzle, pitchJitter: 0.08 });
    },
    end(e, w) {
      if (e.laser >= 0) {
        w.telegraphs.releaseLaser(e.laser);
        e.laser = -1;
      }
    },
  };
}

export interface SniperTuning {
  name: string;
  range: readonly [number, number];
  damage: number;
  windup: number;
  /** The laser stops tracking this long before the shot. That gap is the dodge. */
  lock: number;
  cooldown: readonly [number, number];
}

/** A visible laser walks onto you, turns solid, and the shot follows it exactly. Move and it misses. */
export function sniperShot(t: SniperTuning): AttackDef {
  return {
    name: t.name,
    range: t.range,
    los: true,
    token: 'ranged',
    cooldown: t.cooldown,
    windup: t.windup,
    active: 0.1,
    recover: 0.8,
    moveMul: 0,
    weight: 2,
    requires: hasGun,
    begin(e, w) {
      e.face = 'player';
      e.laser = w.telegraphs.acquireLaser(0xff1040, 0.35);
      e.aimPoint.copy(w.player.chest);
      w.ctx.audio.play('sniper_charge', { position: e.center });
      e.attackLoop = w.ctx.audio.startLoop('sniper_laser_loop', { position: e.center });
    },
    windupTick(e, w, dt) {
      const left = e.attackWindup - e.attackClock;
      if (left > t.lock) {
        // Lagging pursuit: the dot chases a moving player and settles on a still one.
        const rate = 1 - Math.exp(-6 * dt);
        e.aimPoint.lerp(w.player.chest, rate);
      } else if (e.attackStage === 0) {
        e.attackStage = 1;
        w.telegraphs.setLaserStrength(e.laser, 1.6);
        w.ctx.audio.play('menu_select', { position: e.center, volume: 0.8, pitch: 1.8 });
      }
      muzzleOf(e, _muzzle);
      w.telegraphs.aimLaser(e.laser, _muzzle, e.aimPoint);
    },
    fire(e, w) {
      muzzleOf(e, _muzzle);
      _dir.subVectors(e.aimPoint, _muzzle).normalize();
      w.ctx.combat.fireRay(_muzzle, _dir, {
        damage: t.damage * e.damageMul, source: e.id, team: 'enemy', maxDistance: 240, tracer: 'heavy',
      });
      w.ctx.combat.enemyMuzzle(_muzzle, _dir, 'railgun');
      w.ctx.audio.play('sniper_fire', { position: _muzzle, pitchJitter: 0.05 });
      e.char.anim.play('shoot', 0.8);
      e.shotsFired++;
    },
    end(e, w) {
      if (e.laser >= 0) {
        w.telegraphs.releaseLaser(e.laser);
        e.laser = -1;
      }
    },
  };
}

export interface StreamTuning {
  name: string;
  range: readonly [number, number];
  damage: number;
  rate: number;
  duration: number;
  speed: number;
  windup: number;
  cooldown: readonly [number, number];
  /** Radians per second the barrels can track. A low value means strafing beats the stream. */
  track: number;
  moveMul?: number;
}

/** Spin up, then hose. The stream tracks with lag, so you see it walk toward you and can step around it. */
export function stream(t: StreamTuning): AttackDef {
  return {
    name: t.name,
    range: t.range,
    los: true,
    token: 'ranged',
    cooldown: t.cooldown,
    windup: t.windup,
    active: 1 / t.rate,
    shots: Math.round(t.rate * t.duration),
    recover: 0.7,
    moveMul: t.moveMul ?? 0.3,
    requires: hasGun,
    begin(e, w) {
      e.face = 'player';
      e.aimDir.subVectors(w.player.chest, e.center).normalize();
      muzzleOf(e, _muzzle);
      w.telegraphs.glint(_muzzle, 0xff3010, 1.1, e.attackWindup);
      w.ctx.audio.play('autocannon_zoom', { position: e.center, volume: 0.7, pitch: 0.6 });
    },
    activeTick(e, w, dt) {
      muzzleOf(e, _muzzle);
      _dir.subVectors(w.player.chest, _muzzle).normalize();
      const angle = Math.acos(clamp(e.aimDir.dot(_dir), -1, 1));
      if (angle > 1e-3) e.aimDir.lerp(_dir, Math.min(1, (t.track * dt) / angle)).normalize();
    },
    fire(e, w, index) {
      if (index === 0) e.attackLoop = w.ctx.audio.startLoop('enemy_minigun_loop', { position: e.center });
      muzzleOf(e, _muzzle);
      _dir.copy(e.aimDir);
      randomUnit(_rand);
      _dir.addScaledVector(_rand, 0.012 + 0.02 * w.player.evasion).normalize();
      _vel.copy(_dir).multiplyScalar(t.speed);
      w.ctx.combat.spawnProjectile({
        origin: _muzzle, velocity: _vel, kind: 'bullet', team: 'enemy',
        damage: grazed(w, t.damage * e.damageMul), source: e.id, tracer: 'enemy', lifetime: 2,
      });
      w.ctx.combat.enemyMuzzle(_muzzle, _dir, 'minigun');
    },
  };
}

export interface FlameTuning {
  name: string;
  range: readonly [number, number];
  damage: number;
  duration: number;
  windup: number;
  cooldown: readonly [number, number];
}

/** A short-range zone, not a duel. Pilot light first, then a stream that sweeps slowly. */
export function flamer(t: FlameTuning): AttackDef {
  const rate = 12;
  return {
    name: t.name,
    range: t.range,
    los: true,
    token: 'ranged',
    cooldown: t.cooldown,
    windup: t.windup,
    active: 1 / rate,
    shots: Math.round(rate * t.duration),
    recover: 0.6,
    moveMul: 0.55,
    requires: hasGun,
    begin(e, w) {
      e.face = 'player';
      muzzleOf(e, _muzzle);
      w.telegraphs.glint(_muzzle, 0xff7010, 1.4, e.attackWindup);
      say(e, w, e.def.voice.attack);
      e.aimDir.subVectors(w.player.chest, _muzzle).normalize();
    },
    activeTick(e, w, dt) {
      muzzleOf(e, _muzzle);
      _dir.subVectors(w.player.chest, _muzzle).normalize();
      e.aimDir.lerp(_dir, 1 - Math.exp(-3 * dt)).normalize();
    },
    fire(e, w, index) {
      if (index === 0) e.attackLoop = w.ctx.audio.startLoop('burner_flame_loop', { position: e.center });
      muzzleOf(e, _muzzle);
      _dir.copy(e.aimDir);
      randomUnit(_rand);
      _dir.addScaledVector(_rand, 0.09).normalize();
      _vel.copy(_dir).multiplyScalar(22).addScaledVector(e.velocity, 0.5);
      // The stream is visual on most ticks; damage arrives in four readable pulses per second.
      w.ctx.combat.spawnProjectile({
        origin: _muzzle, velocity: _vel, kind: 'flame', team: 'enemy',
        damage: index % 3 === 0 ? t.damage * e.damageMul : 0, source: e.id, lifetime: 0.55, gravity: 2,
      });
    },
  };
}

