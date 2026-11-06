/**
 * Bosses. Both are normal enemies driven by the same brain, plus a controller that owns phases, damage rules and
 * the death. The Juggernaut's phases are its armour stages. The Titan's phases are its limbs: each one shot off
 * removes the attacks it carried, and losing both legs brings it down onto the floor with its core exposed.
 */
import * as THREE from 'three';
import { HumanoidBone as B, type GoreRegion } from '../characters/rig';
import type { DamageInfo } from '../core/contracts';
import { clamp, pick, rand, randomUnit } from '../core/math';
import type { AttackDef, Behaviour } from './brain';
import type { Enemy } from './Enemy';
import type { AiWorld } from './aiWorld';
import { meleeConnect, muzzleOf, rocket, melee, say } from './attacks';
import { crawl } from './behaviours';
import { leapTo } from './movement';

export interface BossController {
  /** Phase index for this boss, for attacks to gate on. */
  phase: number;
  /** How long the body plays out after the killing blow. */
  readonly deathSeconds: number;
  filter(e: Enemy, w: AiWorld, amount: number, d: DamageInfo, region: GoreRegion): number;
  onPlateLost?(e: Enemy, w: AiWorld): void;
  onLimbLost(e: Enemy, w: AiWorld, region: GoreRegion): void;
  /** The arrival landing. */
  onLand?(e: Enemy, w: AiWorld): void;
  onDeath(e: Enemy, w: AiWorld, d: DamageInfo): void;
  /** Each frame of the death. */
  dying(e: Enemy, w: AiWorld, dt: number): void;
  /** Last frame of the death. Must hand the body to gore. */
  finish(e: Enemy, w: AiWorld): void;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** No single hit may take more than this share of a boss. Instakill weapons still land hard, but they cannot delete it. */
const MAX_HIT_SHARE = 0.05;

/** Ground shock. Damage only reaches a grounded player: jumping it is the counterplay, and it is meant to feel great. */
export function shockwave(w: AiWorld, at: THREE.Vector3, radius: number, damage: number, source: string, knock = 12, sound = 'juggernaut_slam'): void {
  const { ctx } = w;
  ctx.fx.ring(_p.copy(at).setY(at.y + 0.3), _up, 0xffa060, radius);
  ctx.fx.sparks(at, _up, 30, 0xffd0a0);
  ctx.fx.smoke(at, 0x8899aa, radius * 0.5, 0.9);
  ctx.render.decals.add('crack', at, _up, radius * 0.7, rand(0, 6.28));
  ctx.physics.radialImpulse(at, radius * 1.2, 30);
  ctx.audio.play(sound, { position: at });
  const p = w.player;
  const dist = Math.hypot(p.position.x - at.x, p.position.z - at.z);
  const trauma = clamp(1 - dist / (radius * 3)) * 0.7;
  ctx.camera.addTrauma(trauma);
  if (dist > radius || !p.grounded || Math.abs(p.position.y - at.y) > 3 || !p.alive) return;
  const falloff = 1 - (dist / radius) * 0.5;
  ctx.player.takeDamage({ amount: damage * falloff, from: at, type: 'crush', source });
  _dir.subVectors(p.position, at).setY(0).normalize();
  _q.set(_dir.x * knock, knock * 0.7, _dir.z * knock);
  ctx.player.launch(_q);
}

function roar(e: Enemy, w: AiWorld): void {
  e.char.anim.play('roar');
  say(e, w, e.def.voice.attack, 1);
}

function randomBonePoint(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  const bones = e.char.bones;
  return bones[Math.floor(Math.random() * bones.length)]!.getWorldPosition(out);
}

// ---------------------------------------------------------------------------------------------
// Juggernaut
// ---------------------------------------------------------------------------------------------

const CHARGE_SPEED = 19;
/** How far ahead a charge looks for a wall, in metres, and how often. */
const CHARGE_PROBE = 3.4;
const CHARGE_PROBE_SECONDS = 0.08;

const charge: AttackDef = {
  name: 'charge',
  range: [9, 44],
  los: true,
  token: null,
  cooldown: [5.5, 8],
  windup: 1.2,
  active: 1.9,
  recover: 0.9,
  moveMul: 1,
  weight: 3,
  requires: e => e.maim.legs === 2,
  begin(e, w) {
    e.face = 'player';
    roar(e, w);
    w.ctx.audio.play('juggernaut_charge', { position: e.center });
    e.laser = w.telegraphs.lane(e.position, e.yaw, 34, 3.6, e.attackWindup);
  },
  windupTick(e, w) {
    // Locks a beat before it goes. Sidestep after the lane stops turning and it will miss.
    if (e.attackWindup - e.attackClock > 0.32) {
      e.aimDir.subVectors(w.player.position, e.position).setY(0).normalize();
      w.telegraphs.aimLane(e.laser, e.position, Math.atan2(e.aimDir.x, e.aimDir.z));
    } else e.face = 'lock';
  },
  fire(e, w) {
    e.face = 'lock';
    e.yaw = Math.atan2(e.aimDir.x, e.aimDir.z);
    e.mode = 'point';
    e.pace = CHARGE_SPEED / (e.def.speed * e.speedMul);
    e.velocity.copy(e.aimDir).multiplyScalar(14);
    // The charge watches for walls itself below, so the usual steering must not swerve it away from one.
    e.probeAt = w.now + 99;
    e.timerB = w.now;
    w.ctx.camera.addTrauma(0.15);
  },
  activeTick(e, w, dt) {
    _dir.subVectors(w.player.position, e.position).setY(0).normalize();
    const turn = 0.5 * dt;
    e.aimDir.lerp(_dir, turn).normalize();
    e.moveTarget.copy(e.position).addScaledVector(e.aimDir, 30);
    e.yaw = Math.atan2(e.aimDir.x, e.aimDir.z);
    if (e.attackStage === 0 && meleeConnect(e, w, 2.8, -0.2, 32, 'juggernaut', 20)) e.attackStage = 1;
    w.enemies.trample(e, 2.2);
    if (w.now < e.timerB) return;
    e.timerB = w.now + CHARGE_PROBE_SECONDS;
    _p.copy(e.position);
    _p.y += 1.4;
    // A wall ends it hard: the player baited that, and the stun is the opening they earned.
    if (w.ctx.physics.raycast(_p, e.aimDir, CHARGE_PROBE) === null && Math.hypot(e.velocity.x, e.velocity.z) > 5) return;
    if (e.attackClock < 0.2) return;
    e.stagger = 2.4;
    e.char.anim.play('stagger', 0.5);
    e.velocity.set(0, 0, 0);
    (e.boss as Juggernaut).stunnedUntil = w.now + 2.6;
    shockwave(w, e.position, 4, 0, 'juggernaut', 0);
    e.attackClock = 99;
  },
  end(e, w) {
    e.mode = 'flow';
    e.pace = 1;
    e.face = 'move';
    e.probeAt = 0;
    e.moveTarget.copy(e.position);
    w.telegraphs.releaseLane(e.laser);
    e.laser = -1;
  },
};

const slam: AttackDef = {
  name: 'slam',
  range: [0, 12],
  los: false,
  token: null,
  cooldown: [4.5, 7],
  windup: 1,
  active: 0.1,
  recover: 0.9,
  moveMul: 0,
  weight: 2,
  requires: e => e.maim.legs === 2,
  begin(e, w) {
    e.char.anim.play('attackHeavy', 0.7);
    e.face = 'player';
    w.telegraphs.zone(e.position, 10.5, e.attackWindup);
    say(e, w, e.def.voice.attack, 1);
    leapTo(e, e.position, e.attackWindup * 0.95, 2);
  },
  fire(e, w) {
    shockwave(w, e.position, 10.5, 30 * e.damageMul, 'juggernaut', 14);
  },
};

export const JUGGERNAUT_BEHAVIOURS: Behaviour[] = [
  {
    name: 'bossAdvance',
    score: () => 0.5,
    enter(e) {
      e.mode = 'flow';
      e.face = 'move';
      e.pace = 1;
    },
    think(e) {
      if (e.attackPhase === 'idle') e.face = e.dist < 12 ? 'player' : 'move';
    },
  },
  crawl(),
];

export const JUGGERNAUT_ATTACKS: AttackDef[] = [
  charge,
  slam,
  melee({ name: 'pummel', reach: 3.6, damage: 20, windup: 0.55, knock: 12, anim: 'attackHeavy', cooldown: [1.4, 2.2], weight: 1, requires: e => e.maim.arms > 0 }),
  rocket({
    name: 'salvo', range: [12, 50], damage: 18, radius: 4.5, speed: 30, windup: 0.9, cooldown: [5, 7], shots: 4, gap: 0.2,
    requires: e => (e.boss?.phase ?? 0) >= 2,
  }),
];

class Juggernaut implements BossController {
  phase = 0;
  readonly deathSeconds = 1.8;
  stunnedUntil = 0;
  private fullArmor = 1;
  private clock = 0;

  constructor(e: Enemy) {
    this.fullArmor = Math.max(e.armor, 1);
  }

  filter(e: Enemy, w: AiWorld, amount: number): number {
    const stunned = w.now < this.stunnedUntil ? 1.6 : 1;
    return Math.min(amount * stunned, e.maxHealth * MAX_HIT_SHARE);
  }

  onLand(e: Enemy, w: AiWorld): void {
    shockwave(w, e.position, 9, 10, 'juggernaut', 10);
    w.ctx.audio.play('boss_intro');
  }

  onPlateLost(e: Enemy, w: AiWorld): void {
    const left = e.armor / this.fullArmor;
    const next = left > 0.66 ? 0 : left > 0.33 ? 1 : left > 0.02 ? 2 : 3;
    if (next <= this.phase) return;
    this.phase = next;
    e.speedMul *= 1.07;
    roar(e, w);
    w.ctx.audio.play('juggernaut_armor_break', { position: e.center });
    shockwave(w, e.position, 6, 8, 'juggernaut', 9);
    w.ctx.render.post.chromatic(0.25, 0.2);
  }

  onLimbLost(e: Enemy, w: AiWorld): void {
    roar(e, w);
    w.ctx.camera.addTrauma(0.3);
  }

  onDeath(e: Enemy, w: AiWorld): void {
    w.ctx.audio.play('boss_death');
    w.ctx.time.hitStop(0.14, 0.03);
    w.ctx.time.pushScale('bossDeath', 0.4, 0.05, 0.5);
    w.ctx.render.post.flash(0xffe0c0, 0.5, 0.2);
    w.ctx.camera.addTrauma(0.6);
    e.char.anim.play('stagger', 0.4);
    this.clock = 0;
  }

  dying(e: Enemy, w: AiWorld, dt: number): void {
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 0.24;
    randomBonePoint(e, _p);
    w.ctx.fx.explosion(_p, { radius: 2.6, kind: 'shell', scale: 0.8 });
    w.ctx.fx.bloodJet(_p, randomUnit(_dir), 1.6);
    w.ctx.audio.play('enemy_explode', { position: _p, volume: 0.8, pitch: rand(0.6, 0.9) });
  }

  finish(e: Enemy, w: AiWorld): void {
    w.ctx.time.popScale('bossDeath');
    w.ctx.combat.explode(e.center, { radius: 9, damage: 60, kind: 'rocket', source: 'juggernaut', team: 'player', selfDamage: 0 });
    w.ctx.render.post.flash(0xffa060, 0.6, 0.3);
    w.ctx.camera.addTrauma(0.7);
    w.ctx.gore.gib(e.char, e.center, 900);
  }
}

export const juggernautController = (e: Enemy): BossController => new Juggernaut(e);

// ---------------------------------------------------------------------------------------------
// Titan
// ---------------------------------------------------------------------------------------------

const stomp: AttackDef = {
  name: 'stomp',
  range: [0, 17],
  los: false,
  token: null,
  cooldown: [5, 7.5],
  windup: 1.25,
  active: 0.1,
  recover: 1,
  moveMul: 0,
  weight: 2,
  requires: e => e.maim.legs === 2,
  begin(e, w) {
    e.char.anim.play('attackHeavy', 0.6);
    w.telegraphs.zone(e.position, 15, e.attackWindup);
    say(e, w, e.def.voice.attack, 1);
  },
  fire(e, w) {
    shockwave(w, e.position, 15, 26 * e.damageMul, 'titan', 15, 'titan_stomp');
  },
};

const sweep: AttackDef = {
  name: 'sweep',
  range: [0, 15],
  los: false,
  token: null,
  cooldown: [4, 6],
  windup: 1.05,
  active: 0.2,
  recover: 0.9,
  moveMul: 0.1,
  weight: 2,
  requires: e => e.maim.offArm,
  begin(e, w) {
    e.char.anim.play('attackMelee', 0.5);
    e.face = 'player';
    e.laser = w.telegraphs.lane(e.position, e.yaw, 15, 20, e.attackWindup);
    w.ctx.audio.play('enemy_swing', { position: e.center, pitch: 0.4 });
  },
  windupTick(e, w) {
    w.telegraphs.aimLane(e.laser, e.position, e.yaw);
  },
  fire(e, w) {
    // Sweeps at knee height. Jump it, or get inside it.
    if (w.player.position.y - e.position.y < 2.5) meleeConnect(e, w, 15, 0.1, 28, 'titan', 18);
    w.ctx.camera.addTrauma(0.25);
  },
  end(e, w) {
    w.telegraphs.releaseLane(e.laser);
    e.laser = -1;
  },
};

const barrage: AttackDef = {
  name: 'barrage',
  range: [15, 95],
  los: false,
  token: null,
  cooldown: [6, 9],
  windup: 0.9,
  active: 0.24,
  shots: 8,
  recover: 0.8,
  moveMul: 0.3,
  weight: 2,
  requires: e => e.maim.gunArm,
  begin(e, w) {
    e.char.anim.play('throw', 0.6);
    muzzleOf(e, _p);
    w.telegraphs.glint(_p, 0xff5010, 5, e.attackWindup, e.char.bones[B.handR] ?? null);
    w.ctx.audio.play('titan_charge', { position: e.center });
  },
  fire(e, w, index) {
    const p = w.player;
    // The first shells land on the player's line, the rest spread around it to take away the easy escape.
    const lead = index < 3 ? 0.7 : 0.4;
    _p.copy(p.position).addScaledVector(p.velocity, lead);
    const scatter = index < 3 ? 2 : 9;
    _p.x += rand(-scatter, scatter);
    _p.z += rand(-scatter, scatter);
    if (!w.ctx.world.nav.nearest(_p, 12, _p)) _p.copy(p.position);
    w.enemies.strike(_p, 1.15, 4.6, 20 * e.damageMul, 'titan');
    muzzleOf(e, _q);
    w.ctx.combat.enemyMuzzle(_q, _up, 'rocket');
    w.ctx.audio.play('enemy_rocket_fire', { position: _q, pitch: 0.6, pitchJitter: 0.1 });
  },
};

const BEAM_TICK = 0.14;

const beam: AttackDef = {
  name: 'beam',
  range: [8, 120],
  los: true,
  token: null,
  cooldown: [8, 11],
  windup: 1.5,
  active: 2.6,
  recover: 1,
  moveMul: 0,
  weight: 1.5,
  begin(e, w) {
    e.face = 'player';
    e.char.anim.play('roar', 0.7);
    e.laser = w.telegraphs.acquireLaser(0xff2a10, 0.5);
    w.ctx.audio.play('titan_charge', { position: e.center });
    // Start wide of the player and sweep across, so the beam has a path you can read and jump.
    _dir.subVectors(w.player.chest, e.center).setY(0).normalize();
    const side = Math.random() < 0.5 ? 1 : -1;
    e.aimPoint.copy(w.player.position).addScaledVector(_q.set(_dir.z * side, 0, -_dir.x * side), 13);
    e.timerB = 0;
  },
  windupTick(e, w) {
    w.telegraphs.aimLaser(e.laser, headOf(e, _p), e.aimPoint);
  },
  fire(e, w) {
    w.telegraphs.setLaserStrength(e.laser, 6);
    e.attackLoop = w.ctx.audio.startLoop('titan_beam_loop', { position: e.center });
  },
  activeTick(e, w, dt) {
    const p = w.player;
    _dir.subVectors(p.position, e.aimPoint).setY(0);
    const gap = _dir.length();
    // Sweeps at a fixed speed, chasing with lag: fast movement outruns it, standing still does not.
    if (gap > 0.01) e.aimPoint.addScaledVector(_dir.multiplyScalar(1 / gap), Math.min(gap, 11 * dt));
    headOf(e, _p);
    w.telegraphs.aimLaser(e.laser, _p, e.aimPoint);
    e.timerB -= dt;
    if (e.timerB > 0) return;
    e.timerB = BEAM_TICK;
    _dir.subVectors(e.aimPoint, _p).normalize();
    const hit = w.ctx.physics.raycast(_p, _dir, 200);
    if (hit) {
      w.ctx.fx.sparks(hit.point, hit.normal, 7, 0xff8040);
      w.ctx.render.decals.add('scorch', hit.point, hit.normal, 1.3, rand(0, 6.28));
    }
    if (Math.hypot(p.position.x - e.aimPoint.x, p.position.z - e.aimPoint.z) < 1.1 && p.position.y - e.aimPoint.y < 2.2) {
      w.ctx.player.takeDamage({ amount: 7 * e.damageMul, from: e.center, type: 'fire', source: 'titan' });
    }
  },
  end(e, w) {
    w.telegraphs.releaseLaser(e.laser);
    e.laser = -1;
  },
};

const groundPound: AttackDef = {
  name: 'groundPound',
  range: [0, 19],
  los: false,
  token: null,
  cooldown: [4, 6],
  windup: 1,
  active: 0.1,
  recover: 0.8,
  moveMul: 0,
  weight: 3,
  requires: e => e.maim.legs === 0 && e.maim.arms > 0,
  begin(e, w) {
    e.char.anim.play('attackHeavy', 0.6);
    w.telegraphs.zone(e.position, 17, e.attackWindup);
    say(e, w, e.def.voice.attack, 1);
  },
  fire(e, w) {
    shockwave(w, e.position, 17, 24 * e.damageMul, 'titan', 14, 'titan_stomp');
  },
};

function headOf(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
  return (e.char.bones[B.head] ?? e.char.root).getWorldPosition(out);
}

/** Walks in, stopping just outside arm's length. Every footfall lands in the player's hands. */
const titanWalk: Behaviour = {
  name: 'titanWalk',
  score: e => (e.maim.legs > 0 ? 0.5 : 0),
  enter(e) {
    e.face = 'move';
    e.pace = 1;
    e.timerA = 0;
  },
  think(e) {
    e.mode = e.dist < 10 ? 'hold' : 'flow';
    e.face = e.dist < 26 ? 'player' : 'move';
  },
};

const titanDown: Behaviour = {
  name: 'titanDown',
  score: e => (e.maim.legs === 0 ? 6 : 0),
  enter(e) {
    e.mode = 'hold';
    e.face = 'player';
  },
};

export const TITAN_BEHAVIOURS: Behaviour[] = [titanWalk, titanDown];
export const TITAN_ATTACKS: AttackDef[] = [stomp, sweep, barrage, beam, groundPound];


class Titan implements BossController {
  phase = 0;
  readonly deathSeconds = 3.2;
  private clock = 0;
  private time = 0;
  private fallDir = 1;

  filter(e: Enemy, _w: AiWorld, amount: number, _d: DamageInfo, region: GoreRegion): number {
    // Down on the floor the reactor in its chest is open. That is the reward for taking the legs.
    const exposed = e.maim.legs === 0 && (region === 'chest' || region === 'abdomen' || region === 'head') ? 1.8 : 1;
    return Math.min(amount * exposed, e.maxHealth * MAX_HIT_SHARE);
  }

  onLand(e: Enemy, w: AiWorld): void {
    shockwave(w, e.position, 16, 14, 'titan', 14, 'titan_stomp');
    roar(e, w);
    w.ctx.audio.play('boss_intro');
  }

  onLimbLost(e: Enemy, w: AiWorld, region: GoreRegion): void {
    this.phase++;
    roar(e, w);
    w.ctx.audio.play('titan_limb_break', { position: e.center });
    w.ctx.camera.addTrauma(0.5);
    w.ctx.render.post.chromatic(0.3, 0.25);
    w.ctx.time.hitStop(0.09, 0.05);
    const bone = e.char.bones[B.chest];
    if (bone) w.ctx.fx.explosion(bone.getWorldPosition(_p), { radius: 3.5, kind: 'shell' });
    w.enemies.reinforce(pick(['husk', 'trooper'] as const), 4);
    if (e.maim.legs === 0) {
      // Both legs gone: it comes down hard, and everything near it feels the landing.
      e.stagger = 3.2;
      shockwave(w, e.position, 12, 12, 'titan', 12, 'titan_fall');
      e.char.anim.play('stagger', 0.4);
      if (e.attack) e.attackClock = 99;
    } else if (region === 'legL' || region === 'legR' || region === 'shinL' || region === 'shinR') {
      e.speedMul *= 0.7;
    }
  }

  onDeath(e: Enemy, w: AiWorld): void {
    const { time, render, camera, audio } = w.ctx;
    audio.play('boss_death');
    time.hitStop(0.2, 0.02);
    time.pushScale('bossDeath', 0.45, 0.05, 0.8);
    render.post.flash(0xffffff, 0.8, 0.25);
    render.post.chromatic(0.5, 0.5);
    render.post.radialBlur(0.4, 0.5);
    camera.addTrauma(1);
    roar(e, w);
    this.time = 0;
    this.clock = 0;
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    w.enemies.fieldCleared = true;
    w.enemies.killAllExcept(e, 'titan_death');
  }

  dying(e: Enemy, w: AiWorld, dt: number): void {
    const { fx, audio, render, camera } = w.ctx;
    this.time += dt;
    const t = clamp(this.time / this.deathSeconds);
    // Topples slowly at first, then all at once.
    const root = e.char.root;
    root.rotation.z = this.fallDir * t * t * t * 1.25;
    root.position.y = e.position.y - t * t * 1.5;
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 0.16 + Math.random() * 0.1;
    randomBonePoint(e, _p);
    fx.explosion(_p, { radius: 4 + t * 3, kind: Math.random() < 0.5 ? 'shell' : 'rocket', scale: 1 + t });
    fx.bloodJet(_p, randomUnit(_dir), 2.5);
    fx.bloodMist(_p, 3);
    render.lights.flash(_p, 0xffaa55, 160, 30, 0.2);
    camera.addTrauma(0.25);
    audio.play('rocket_explosion', { position: _p, volume: 1, pitch: rand(0.55, 0.85) });
  }

  finish(e: Enemy, w: AiWorld): void {
    const { combat, render, camera, time, gore, fx, audio } = w.ctx;
    time.popScale('bossDeath');
    combat.explode(e.center, { radius: 18, damage: 200, kind: 'hellfire', source: 'titan', team: 'player', selfDamage: 0, scale: 2.5 });
    render.post.flash(0xffffff, 1, 0.6);
    render.post.chromatic(0.6, 0.6);
    camera.addTrauma(1);
    audio.play('hellfirerocket_explode', { volume: 1, pitch: 0.7, unaffectedByTime: true });
    fx.ring(e.position, _up, 0xffffff, 26);
    shockwave(w, e.position, 30, 0, 'titan', 0, 'titan_fall');
    gore.gib(e.char, e.center, 2400);
  }
}

export const titanController = (): BossController => new Titan();
