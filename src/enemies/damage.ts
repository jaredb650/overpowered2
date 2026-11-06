/**
 * The damage model: the only code that takes health off an enemy, and the only code that kills one.
 *
 * Order of a hit: ward, riot shield, tank, region multiplier, armour plate, boss filter, health, limb pool.
 * Everything a kill should do happens in `kill`, once, so the first game's seven drifting kill paths cannot return.
 */
import * as THREE from 'three';
import { DroneBone, HumanoidBone as B, type GoreRegion } from '../characters/rig';
import type { DamageInfo, DamageType } from '../core/contracts';
import type { DamageResult, KillEvent } from '../core/gameplay';
import { chance, clamp, pick, rand } from '../core/math';
import { ENEMIES, LIMB_SIZE, REGION_DAMAGE } from './data';
import { say } from './attacks';
import { finishAttack } from './brain';
import { dropOff } from './roles';
import type { Enemy } from './Enemy';
import type { Plate } from './armor';
import type { AiWorld } from './aiWorld';
import type { EnemyManager } from './EnemyManager';

/** Newton-seconds on a ragdoll when the caller leaves `force` at zero. */
const DEFAULT_FORCE: Record<DamageType, number> = {
  bullet: 60, pellet: 45, explosive: 260, melee: 160, slash: 90, fire: 10, shock: 40, crush: 300, true: 120,
};

/** How hard each damage type works a limb pool, on top of the weapon's severMult. */
const SEVER_FACTOR: Record<DamageType, number> = {
  bullet: 1, pellet: 1.2, explosive: 0.7, melee: 0.8, slash: 2.4, fire: 0, shock: 0, crush: 1, true: 0,
};

/** Damage types that ignore where they land. */
const AREA_TYPES: ReadonlySet<DamageType> = new Set<DamageType>(['explosive', 'fire', 'shock', 'crush', 'true']);

/** Limbs that can come off, for blasts that have no struck region. */
const BLAST_LIMBS: readonly GoreRegion[] = ['armL', 'armR', 'legL', 'legR', 'forearmL', 'forearmR', 'shinL', 'shinR'];

const REGION_BONE: Record<GoreRegion, number> = {
  head: B.head, chest: B.chest, abdomen: B.spine,
  armL: B.upperArmL, forearmL: B.foreArmL, armR: B.upperArmR, forearmR: B.foreArmR,
  legL: B.thighL, shinL: B.shinL, legR: B.thighR, shinR: B.shinR,
};

const WHOLE_LIMB: Partial<Record<GoreRegion, GoreRegion>> = { forearmL: 'armL', forearmR: 'armR', shinL: 'legL', shinR: 'legR' };

/** Gore bursts the head at this much damage and only holds the body briefly; below it the head pops off whole. */
const HEAD_BURST_DAMAGE = 40;
const RESULT_RING = 16;
/** Seconds between cries of pain. Under an SMG every hit would otherwise be one. */
const PAIN_GAP = 0.7;
const BOSS_PAIN_GAP = 6;
/** A tank the player did not set off, as a share of a full blast. */
export const STRAY_TANK_DAMAGE = 0.17;
export const STRAY_TANK_RADIUS = 0.8;
/** Share of a shot tank's blast that reaches the player who shot it. Too close is a mistake, not a death sentence. */
const TANK_SELF_DAMAGE = 0.35;
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

function newResult(): DamageResult {
  return { dealt: 0, killed: false, headshot: false, severed: [], blocked: false };
}

export class DamageModel {
  private readonly results: DamageResult[] = Array.from({ length: RESULT_RING }, newResult);
  private head = 0;

  constructor(private readonly w: AiWorld, private readonly m: EnemyManager) {}

  private result(): DamageResult {
    const r = this.results[this.head]!;
    this.head = (this.head + 1) % RESULT_RING;
    r.dealt = 0;
    r.killed = r.headshot = r.blocked = false;
    r.severed.length = 0;
    return r;
  }

  apply(e: Enemy, d: DamageInfo): DamageResult {
    const res = this.result();
    if (!e.alive) return res;

    if (e.entrance === 'boss') return this.blocked(e, d, res);

    const area = AREA_TYPES.has(d.type);
    if (e.ward > 0 && d.type !== 'true' && d.type !== 'fire') {
      this.hitWard(e, d, res);
      return res;
    }
    if (e.shield && this.shieldStops(e, d, res)) return res;

    let region: GoreRegion = d.region ?? 'chest';
    if (e.def.wholeLimbs) region = WHOLE_LIMB[region] ?? region;

    if (e.def.tank && !e.tankBlown && this.tankStruck(e, d, region)) {
      this.blowTank(e, d);
      // The tank going up is the kill. Fall through with enough damage to finish it.
      return this.lethal(e, d, res, region, false);
    }

    const headMul = d.headshotMult ?? REGION_DAMAGE.head;
    let amount = d.amount * (area ? 1 : region === 'head' ? headMul : REGION_DAMAGE[region]);
    res.headshot = region === 'head' && !area;

    const plate = area ? this.blastPlate(e) : this.plateFor(e, region, d);
    if (plate) {
      const absorbed = Math.min(plate.hp, amount);
      plate.hp -= absorbed;
      e.armor = Math.max(0, e.armor - absorbed);
      amount -= absorbed;
      if (plate.hp <= 0) this.shootOff(e, plate, d);
      if (amount <= 0) {
        res.blocked = true;
        res.headshot = false;
        res.dealt = absorbed;
        this.react(e, d, region, absorbed, res);
        this.m.emitHit(e, d, res);
        return res;
      }
      // What breaks through a plate only half lands; the rest went into tearing the plate off.
      amount *= 0.5;
    }

    if (e.frozen > 0 && amount >= 4) amount *= 3;
    if (e.boss) amount = e.boss.filter(e, this.w, amount, d, region);

    e.health -= amount;
    res.dealt = amount;

    const headPool = region === 'head' ? this.spendPool(e, 'head', amount) : Infinity;
    if (e.health <= 0 || headPool <= 0) return this.lethal(e, d, res, region, true);

    if (area) this.blastLimb(e, d, res);
    else this.spendLimb(e, region, d, res);

    if (!e.alive) return res;
    this.react(e, d, region, amount, res);
    this.m.emitHit(e, d, res);
    return res;
  }

  private blocked(e: Enemy, d: DamageInfo, res: DamageResult): DamageResult {
    res.blocked = true;
    this.m.emitHit(e, d, res);
    return res;
  }

  private spendPool(e: Enemy, region: GoreRegion, amount: number): number {
    const left = (e.limbHp.get(region) ?? Infinity) - amount;
    e.limbHp.set(region, left);
    return left;
  }

  private spendLimb(e: Enemy, region: GoreRegion, d: DamageInfo, res: DamageResult): void {
    if (!e.limbHp.has(region) || region === 'head' || e.char.severed.has(region)) return;
    const hit = d.amount * (d.severMult ?? 1) * SEVER_FACTOR[d.type];
    if (hit <= 0) return;
    if (this.spendPool(e, region, hit) <= 0) this.sever(e, region, d, res);
  }

  /** A blast that does not kill still takes something with it, so survivors of a rocket come out maimed. */
  private blastLimb(e: Enemy, d: DamageInfo, res: DamageResult): void {
    if (d.type !== 'explosive' || e.def.machine || !chance(0.65)) return;
    const region = pick(BLAST_LIMBS);
    if (e.limbHp.has(region) && !e.char.severed.has(region)) {
      const hit = d.amount * (d.severMult ?? 1) * SEVER_FACTOR.explosive;
      if (this.spendPool(e, region, hit) <= 0) this.sever(e, region, d, res);
    }
  }

  sever(e: Enemy, region: GoreRegion, d: DamageInfo, res: DamageResult | null): void {
    const { ctx } = this.w;
    const cut = ctx.gore.sever(e.char, e.def.severAt?.[region] ?? region, d, e.velocity);
    if (!cut) return;
    ctx.audio.play('limb_sever', { position: cut.stump, pitchJitter: 0.08 });
    if (!e.def.machine) say(e, this.w, 'vox_scream', 0.8);
    for (const r of cut.regions) {
      e.limbHp.delete(r);
      res?.severed.push(r);
      ctx.events.emit('enemy:severed', { enemy: e, region: r, damage: d });
    }
    this.updateMaim(e);
    e.def.onLimbLost?.(e, this.w, region);
    e.boss?.onLimbLost(e, this.w, region);
  }

  /** Re-reads what is left of the body. The AI layers react through `requires` and scores; nothing else is needed. */
  updateMaim(e: Enemy): void {
    if (e.def.machine) return;
    const s = e.char.severed;
    const m = e.maim;
    const legL = s.has('legL') || s.has('shinL');
    const legR = s.has('legR') || s.has('shinR');
    const armL = s.has('armL') || s.has('forearmL');
    const armR = s.has('armR') || s.has('forearmR');
    m.legs = (legL ? 0 : 1) + (legR ? 0 : 1);
    m.arms = (armL ? 0 : 1) + (armR ? 0 : 1);
    m.gunArm = !armR;
    m.offArm = !armL;
    m.head = !s.has('head');
    const open = 4 - m.legs - m.arms;
    e.bleed = e.isBoss ? 0 : open * e.maxHealth * 0.022;

    if (armL && e.shield) {
      // The shield went with the arm. It stops guarding and comes at you.
      e.shield = false;
      e.face = 'move';
      this.w.ctx.audio.play('riot_shield_break', { position: e.center });
    }
    if (e.attack?.requires && !e.attack.requires(e)) finishAttack(e, this.w, true);
    if (e.pinned && (m.legs < 2 || m.arms === 0)) dropOff(e);
    // Force a fresh choice now. Waiting for the next think would show a beat of the old behaviour on the new body.
    e.thinkAt = 0;
    e.behaviourUntil = 0;
  }

  private plateFor(e: Enemy, region: GoreRegion, d: DamageInfo): Plate | null {
    for (let i = 0; i < e.plates.length; i++) {
      const p = e.plates[i]!;
      if (p.hp <= 0 || !p.spec.regions.includes(region)) continue;
      if (p.spec.facing) {
        const behind = Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z > 0;
        if (behind !== (p.spec.facing === 'back')) continue;
      }
      return p;
    }
    return null;
  }

  /** A blast chips whichever plate is left. */
  private blastPlate(e: Enemy): Plate | null {
    for (let i = 0; i < e.plates.length; i++) {
      const p = e.plates[i]!;
      if (p.hp > 0) return p;
    }
    return null;
  }

  private shootOff(e: Enemy, plate: Plate, d: DamageInfo): void {
    const { ctx } = this.w;
    plate.hp = 0;
    plate.mesh.getWorldPosition(_v);
    this.m.debris.launch(plate, _n.copy(d.dir).negate());
    ctx.fx.sparks(_v, _n, 18, 0xffe0a0);
    ctx.fx.ring(_v, _n, 0xffd0a0, 1.1);
    ctx.audio.play('armor_plate_off', { position: _v, pitchJitter: 0.08 });
    e.boss?.onPlateLost?.(e, this.w);
  }

  private hitWard(e: Enemy, d: DamageInfo, res: DamageResult): void {
    const { ctx } = this.w;
    e.ward -= d.amount;
    res.blocked = true;
    this.w.telegraphs.flashWard(e.wardVisual);
    e.char.hitFlash(0.25);
    if (e.ward <= 0) {
      this.m.dropWard(e);
      ctx.fx.ring(e.center, _n.set(0, 1, 0), 0xffe9a0, 1.8);
      ctx.fx.sparks(e.center, _n, 14, 0xffe9a0);
    }
    this.m.emitHit(e, d, res);
  }

  private shieldStops(e: Enemy, d: DamageInfo, res: DamageResult): boolean {
    const facing = Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z;
    // Angle of the incoming shot against the body. The shield covers a little over the front half.
    if (facing > -0.35) return false;
    // Shots at the exposed gun arm or the legs below the rim still land.
    const region = d.region;
    if (region === 'armR' || region === 'forearmR' || region === 'shinL' || region === 'shinR') return false;
    res.blocked = true;
    const { ctx } = this.w;
    ctx.audio.play('riot_shield_hit', { position: d.point, pitchJitter: 0.1 });
    e.char.anim.flinch(B.upperArmL, d.dir, 0.3);
    if (d.type === 'explosive' || d.amount >= 40) e.char.anim.play('block', 1.4);
    // Sustained fire batters the arm behind the shield: enough of it and the arm goes, shield and all.
    const left = this.spendPool(e, 'armL', d.amount * (d.type === 'explosive' ? 0.35 : 0.22));
    if (left <= 0) this.sever(e, 'armL', d, res);
    this.m.emitHit(e, d, res);
    return true;
  }

  private tankStruck(e: Enemy, d: DamageInfo, region: GoreRegion): boolean {
    const t = e.def.tank!;
    if (!t.regions.includes(region) || d.type === 'fire') return false;
    if (d.type === 'explosive') return true;
    return !t.rearOnly || Math.sin(e.yaw) * d.dir.x + Math.cos(e.yaw) * d.dir.z > 0.2;
  }

  /**
   * Credited to whoever hit it, so a player who bursts a bomber in a pack gets the whole pack. One enemy setting off
   * another is a smaller thing: a full tank at the player's feet for a kill they had no part in would be a free death.
   */
  blowTank(e: Enemy, d: DamageInfo): void {
    const { ctx } = this.w;
    const t = e.def.tank!;
    e.tankBlown = true;
    const stray = d.source in ENEMIES || d.type === 'true' || d.type === 'crush';
    ctx.combat.explode(e.center, {
      radius: t.radius * (stray ? STRAY_TANK_RADIUS : 1), damage: t.damage * e.damageMul * (stray ? STRAY_TANK_DAMAGE : 1),
      kind: stray ? 'enemy' : 'barrel', source: stray ? e.id : d.source, team: stray ? 'enemy' : 'player', selfDamage: TANK_SELF_DAMAGE,
    });
  }

  private lethal(e: Enemy, d: DamageInfo, res: DamageResult, region: GoreRegion, severNow: boolean): DamageResult {
    res.killed = true;
    if (severNow && region !== 'head' && e.limbHp.has(region)) {
      const left = (e.limbHp.get(region) ?? 0) - d.amount * (d.severMult ?? 1) * SEVER_FACTOR[d.type];
      if (left <= 0) this.sever(e, region, d, res);
    }
    this.kill(e, d, region, res);
    this.m.emitHit(e, d, res);
    return res;
  }

  /** The single kill flow. Picks one death, tells everyone once. */
  kill(e: Enemy, d: DamageInfo, region: GoreRegion, res: DamageResult | null): void {
    if (!e.alive) return;
    const { ctx, player } = this.w;
    const overkill = -e.health > e.maxHealth;
    e.alive = false;
    e.health = 0;
    this.m.detach(e);

    if (e.def.tank && !e.tankBlown && chance(e.def.tank.onDeath)) this.blowTank(e, d);

    const force = d.force || DEFAULT_FORCE[d.type];
    const headshot = region === 'head' && !AREA_TYPES.has(d.type);
    const shatter = e.frozen > 0;
    const explosive = d.type === 'explosive' && (overkill || d.amount >= e.maxHealth);
    let gibbed = false;
    let sliced = false;

    if (e.boss) {
      e.dyingKind = 'boss';
      e.dying = e.boss.deathSeconds;
      e.boss.onDeath(e, this.w, d);
    } else if (e.def.id === 'drone') {
      this.m.startCrash(e);
    } else if (shatter || d.gib || explosive || e.tankBlown) {
      gibbed = true;
      if (shatter) ctx.fx.sparks(e.center, _n.set(0, 1, 0), 40, 0xa0e8ff);
      else if (!e.def.machine) ctx.audio.play('gib_squelch', { position: e.center, pitchJitter: 0.1 });
      ctx.gore.gib(e.char, e.center, force);
    } else if (d.slicePlaneNormal) {
      sliced = true;
      ctx.gore.slice(e.char, d.point, d.slicePlaneNormal, d);
    } else if (headshot && !e.def.machine) {
      // Gore owns the body from here and drops it after its hold. Until then the feet keep carrying it forward.
      ctx.gore.headshot(e.char, d, e.velocity);
      if (d.amount < HEAD_BURST_DAMAGE) ctx.audio.play('vox_choke', { position: e.center, pitch: e.def.voice.pitch });
      if (e.maim.legs > 0) {
        e.dyingKind = 'stumble';
        e.dying = d.amount >= HEAD_BURST_DAMAGE ? 0.28 : 1.05;
      }
    } else {
      this.ragdoll(e, d, force);
    }

    if (res) res.headshot = headshot;

    const ev: KillEvent = {
      enemy: e,
      damage: d,
      headshot,
      gibbed,
      sliced,
      severedCount: e.char.severed.size,
      playerAirborne: !ctx.player.grounded,
      playerSliding: ctx.player.sliding,
      playerWallRunning: ctx.player.wallRunning,
      playerSpeed: player.speed,
      distance: e.position.distanceTo(player.position),
      explosionId: d.explosionId ?? null,
    };
    if (!headshot) say(e, this.w, e.def.voice.die, 0.7);
    ctx.events.emit('enemy:killed', ev);
    if (e.dyingKind === 'none') this.m.retire(e);
    else this.m.holdForDeath(e);
  }

  ragdoll(e: Enemy, d: DamageInfo | null, force: number): void {
    const { ctx } = this.w;
    if (d) {
      const bone = d.bone ?? REGION_BONE[d.region ?? 'chest'] ?? 0;
      _v.copy(d.dir).multiplyScalar(force);
      _v.y += force * 0.15;
      this.m.ragdollOptions.impulses![0]!.bone = bone;
      this.m.ragdollOptions.impulses![0]!.point.copy(d.point);
      this.m.ragdollOptions.impulses![0]!.impulse.copy(_v);
    } else {
      this.m.ragdollOptions.impulses![0]!.impulse.set(0, 0, 0);
    }
    this.m.ragdollOptions.velocity!.copy(e.velocity);
    ctx.gore.ragdoll(e.char, this.m.ragdollOptions);
  }

  /** Non-lethal hits always answer, on the same frame. This is the first game's biggest missing feel. */
  private react(e: Enemy, d: DamageInfo, region: GoreRegion, amount: number, res: DamageResult): void {
    const char = e.char;
    const frac = clamp(amount / e.maxHealth, 0, 1);
    const bone = d.bone ?? (e.def.machine ? DroneBone.body : REGION_BONE[region] ?? 0);
    const armoured = res.blocked;

    char.anim.flinch(bone, d.dir, clamp(0.35 + frac * 3, 0.35, 1.6));
    char.hitFlash(armoured ? 0.35 : clamp(0.55 + frac * 2, 0.55, 1));
    if (!armoured && d.type !== 'fire' && d.type !== 'shock') {
      char.addWound(bone, d.point, clamp(0.05 + frac * 0.3, 0.05, 0.16));
      e.blood = Math.min(1, e.blood + 0.08 + frac * 1.1);
      char.setBloodiness(e.blood);
    }

    const pushForce = d.force || DEFAULT_FORCE[d.type];
    const shove = clamp((pushForce / e.def.hp) * 0.45, 0, 7) * (e.isBoss ? 0.1 : 1);
    e.push.x += d.dir.x * shove;
    e.push.z += d.dir.z * shove;
    e.pressure = Math.min(1, e.pressure + 0.22 + frac);

    if (e.pinned) dropOff(e);

    if (res.headshot && !e.isBoss && !e.def.machine) {
      // Whiplash, then a real beat of stagger. A head hit that does not kill should still rattle them.
      this.stagger(e, 0.3);
      return;
    }
    e.poise += amount;
    if (e.poise >= e.def.poise * e.maxHealth) {
      e.poise = 0;
      this.stagger(e, d.type === 'explosive' ? 0.75 : 0.5);
    } else if (!armoured && this.w.now >= e.painAt) {
      e.painAt = this.w.now + (e.isBoss ? BOSS_PAIN_GAP : rand(PAIN_GAP, PAIN_GAP * 2));
      say(e, this.w, e.def.voice.pain, 0.6);
    }
  }

  stagger(e: Enemy, seconds: number): void {
    if (e.isBoss) return;
    e.stagger = Math.max(e.stagger, seconds);
    e.char.anim.play('stagger', 1);
    if (e.attackPhase === 'windup') finishAttack(e, this.w, true);
  }
}

