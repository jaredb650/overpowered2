/**
 * The damage model: the only code that takes health off an enemy, and the only code that kills one.
 *
 * Order of a hit: ward, riot shield, tank, region multiplier, armour plate, boss filter, health, wounds, limb pool.
 * Everything a kill should do happens in `kill`, once, so the first game's seven drifting kill paths cannot return.
 *
 * A body with anatomy (FACTIONS, src/contracts/data.ts) does not simply die when its health is gone. `WoundSystem.take` says
 * whether this hit is the end of him. Bodies without it never reach that line, which is what keeps the swarm as it was.
 */
import * as THREE from 'three';
import { DroneBone, HumanoidBone as B, type GoreRegion } from '../characters/rig';
import { DEFAULT_FORCE, type DamageInfo, type DamageType } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { DamageResult, KillEvent } from '../core/gameplay';
import { chance, clamp, lerp, pick, rand } from '../core/math';
import { FACTIONS, type FactionRules } from '../contracts/data';
import { bursts } from './wounds/rules';
import { ENEMIES, LIMB_SIZE, REGION_DAMAGE } from './data';
import { say } from './attacks';
import { finishAttack } from './brain';
import { chooseReaction, mustFall, profileOf, type ReactionProfile } from './reactions';
import { dropOff } from './roles';
import type { Enemy } from './Enemy';
import type { Plate } from './armor';
import type { AiWorld } from './aiWorld';
import type { EnemyManager } from './EnemyManager';

/** Metres per second of knockback on the living, per newton-second per point of health, and the most one hit gives. */
const SHOVE_GAIN = 1.35;
const SHOVE_MAX = 4;
/** Seconds a stagger lasts, at no strength and at full. */
const STAGGER_MIN = 0.45;
const STAGGER_MAX = 1.05;
/** Seconds of failing to catch itself before a fall, least and most. */
const FALL_LEAD_MIN = 0.16;
const FALL_LEAD_MAX = 0.42;
/** What full strength adds to a catch step. */
const REEL_GAIN = 1.4;
/** Metres per second tipping the upper body over the feet, at no strength and at full. Less is a body that folds up. */
const TOPPLE_MIN = 1.2;
const TOPPLE_MAX = 2.2;
/** Share of a body's shock left after each kind of reaction, so one burst does not fell it twice. */
const SHOCK_AFTER_STAGGER = 0.5;
/** Weapons light enough that a body takes a moment to die of them, on its feet. Anything harder drops it. */
const DIES_ON_FEET: ReadonlySet<DamageType> = new Set<DamageType>(['bullet', 'fire', 'shock', 'true']);
const DIES_ON_FEET_FORCE = 30;
const COLLAPSE_MIN = 0.85;
const COLLAPSE_MAX = 1.4;
/** A man who bled out on his feet takes longer about it than one who was shot dead on them. */
const BLEED_COLLAPSE_MIN = 1.6;
const BLEED_COLLAPSE_MAX = 2.6;
/** How hard a body with anatomy twitches after a death that took it all at once, and one that came as a relief. */
const SUDDEN_TWITCH = 1;
const SLOW_TWITCH = 0.45;

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

  /** What can break this body. A husk on the Outpost is still a husk. */
  private rules(e: Enemy): FactionRules {
    return this.m.outpost?.wounds.bodyOf(e) ? FACTIONS.humans : FACTIONS.swarm;
  }

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

    const wounds = this.m.outpost?.wounds ?? null;
    const body = wounds?.bodyOf(e) ?? null;
    const placed = body ? wounds!.read(e, d, region) : null;
    const headMul = d.headshotMult ?? REGION_DAMAGE.head;
    let amount = d.amount * (area ? 1 : region === 'head' ? headMul : REGION_DAMAGE[region]);
    if (body) amount = wounds!.priced(placed, d, amount, region);
    res.headshot = region === 'head' && !area && (placed === null || (placed.zone === 'head' && !placed.glancing));

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
    // Before the death is picked, so a killing shot leaves its mark on the body too.
    if (this.w.ctx.gore.wound(e.char, d, amount / e.maxHealth)) this.updateMaim(e);
    res.dealt = amount;

    const headPool = region === 'head' ? this.spendPool(e, 'head', amount) : Infinity;
    const spent = e.health <= 0 || headPool <= 0;
    if (body ? wounds!.take(e, body, placed, d, amount, spent) : spent) return this.lethal(e, d, res, region, true);

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
    const hit = d.amount * (d.severMult ?? 1) * SEVER_FACTOR[d.type] * this.rules(e).limbWear;
    if (hit <= 0) return;
    if (this.spendPool(e, region, hit) <= 0) this.sever(e, region, d, res);
  }

  /** A blast that does not kill still takes something with it, so survivors of a rocket come out maimed. */
  private blastLimb(e: Enemy, d: DamageInfo, res: DamageResult): void {
    const rules = this.rules(e);
    if (d.type !== 'explosive' || e.def.machine || !chance(rules.blastLimb)) return;
    const region = pick(BLAST_LIMBS);
    if (e.limbHp.has(region) && !e.char.severed.has(region)) {
      const hit = d.amount * (d.severMult ?? 1) * SEVER_FACTOR.explosive * rules.limbWear;
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
    this.m.outpost?.wounds.onSevered(e, region);
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
    const c = e.char;
    const body = this.m.outpost?.wounds.bodyOf(e) ?? null;
    const armL = s.has('armL') || s.has('forearmL') || c.isFractured(B.upperArmL) || c.isFractured(B.foreArmL) || (body?.armL ?? false) || (body?.handL ?? false);
    const armR = s.has('armR') || s.has('forearmR') || c.isFractured(B.upperArmR) || c.isFractured(B.foreArmR) || (body?.armR ?? false) || (body?.handR ?? false);
    m.legs = (legL ? 0 : 1) + (legR ? 0 : 1);
    // A broken leg still drags along. Crawling is for a body that has lost the legs, which the animator can see.
    if (m.legs > 1 && (c.isFractured(B.thighL) || c.isFractured(B.shinL) || c.isFractured(B.thighR) || c.isFractured(B.shinR))) m.legs = 1;
    // A wound takes the legs without taking them off. Everything that reads `legs` already knows what a man on the floor can do.
    if (body?.floored) m.legs = 0;
    else if (body && m.legs > 1 && body.limp !== 0) m.legs = 1;
    m.arms = (armL ? 0 : 1) + (armR ? 0 : 1);
    m.gunArm = !armR;
    m.offArm = !armL;
    m.head = !s.has('head');
    const open = 4 - m.legs - m.arms;
    // Wounds keep their own account of blood. See `WoundSystem.syncBody`.
    if (!body) e.bleed = e.isBoss ? 0 : open * e.maxHealth * 0.022;

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
    const wounds = this.m.outpost?.wounds ?? null;
    const body = wounds?.bodyOf(e) ?? null;
    const slowly = wounds?.isBleedOut(d) ?? false;
    const headshot = region === 'head' && !AREA_TYPES.has(d.type);
    const shatter = e.frozen > 0;
    const blownUp = e.tankBlown || bursts(this.rules(e), d, e.maxHealth, overkill);
    let gibbed = false;
    let sliced = false;

    if (e.boss) {
      e.dyingKind = 'boss';
      e.dying = e.boss.deathSeconds;
      e.boss.onDeath(e, this.w, d);
    } else if (e.def.id === 'drone') {
      this.m.startCrash(e);
    } else if (DevFlags.gibbing && (shatter || (blownUp && DevFlags.explosiveDeaths))) {
      gibbed = true;
      if (shatter) ctx.fx.sparks(e.center, _n.set(0, 1, 0), 40, 0xa0e8ff);
      else if (!e.def.machine) ctx.audio.play('gib_squelch', { position: e.center, pitchJitter: 0.1 });
      ctx.gore.gib(e.char, e.center, force);
    } else if (d.slicePlaneNormal) {
      sliced = true;
      ctx.gore.slice(e.char, d.point, d.slicePlaneNormal, d);
    } else if (headshot && !e.def.machine && (e.rising > 0 || body?.floored)) {
      // Half up, or lying down, there is nothing for it to stand there on.
      this.ragdoll(e, d, force, body ? SUDDEN_TWITCH : undefined);
      if (!body || d.amount >= HEAD_BURST_DAMAGE) ctx.gore.sever(e.char, 'head', d);
    } else if (headshot && body && d.amount < HEAD_BURST_DAMAGE) {
      // A light round kills a man and leaves him his head. Popping it off every time is what "like clay" meant.
      this.ragdoll(e, d, force, SUDDEN_TWITCH);
    } else if (headshot && !e.def.machine) {
      // Gore owns the body from here and drops it after its hold. Until then the feet keep carrying it forward.
      ctx.gore.headshot(e.char, d, e.velocity);
      if (d.amount < HEAD_BURST_DAMAGE) ctx.audio.play('vox_choke', { position: e.center, pitch: e.def.voice.pitch });
      if (e.maim.legs > 0 && !e.downed) {
        e.dyingKind = 'stumble';
        e.dying = d.amount >= HEAD_BURST_DAMAGE ? 0.28 : 1.05;
      }
    } else {
      if (blownUp && !DevFlags.explosiveDeaths) this.blastMaim(e, d);
      const twitch = body ? (slowly ? SLOW_TWITCH : SUDDEN_TWITCH) : undefined;
      // Section 14.1: what kills a man all at once drops him where he is. Only a clock gives him time to go.
      if (!blownUp && this.diesOnFeet(e, d, force) && (!body || slowly)) this.collapse(e, d, region, force, slowly, twitch);
      else this.ragdoll(e, d, force, twitch);
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

  /** With explosive deaths off, what would have been a gib leaves a thrown body short of a limb or two. */
  private blastMaim(e: Enemy, d: DamageInfo): void {
    if (e.def.machine) return;
    for (let i = 0; i < 2; i++) {
      const region = pick(BLAST_LIMBS);
      if (e.limbHp.has(region) && !e.char.severed.has(region)) this.sever(e, region, d, null);
    }
  }

  /** It needs its legs under it and a hit too light to knock them away. */
  private diesOnFeet(e: Enemy, d: DamageInfo, force: number): boolean {
    return DIES_ON_FEET.has(d.type) && force <= DIES_ON_FEET_FORCE && e.maim.legs === 2 && !e.downed && e.rising <= 0
      && !e.airborne && !e.pinned && !e.def.machine;
  }

  /** Shot dead standing up: it takes a moment to go, and goes on taking rounds on the way. */
  private collapse(e: Enemy, d: DamageInfo, region: GoreRegion, force: number, slowly: boolean, twitch: number | undefined): void {
    const o = this.m.collapseOptions;
    o.duration = slowly ? rand(BLEED_COLLAPSE_MIN, BLEED_COLLAPSE_MAX) : rand(COLLAPSE_MIN, COLLAPSE_MAX);
    o.twitch = twitch;
    o.velocity.copy(e.velocity);
    if (AREA_TYPES.has(d.type)) o.hit = undefined;
    else {
      const hit = this.m.collapseHit;
      hit.bone = d.bone ?? REGION_BONE[region] ?? 0;
      hit.point.copy(d.point);
      hit.dir.copy(d.dir);
      hit.force = force;
      o.hit = hit;
    }
    this.w.ctx.gore.collapse(e.char, o);
  }

  ragdoll(e: Enemy, d: DamageInfo | null, force: number, twitch?: number): void {
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
    this.m.ragdollOptions.twitch = twitch;
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
      e.blood = Math.min(1, e.blood + 0.08 + frac * 1.1);
      char.setBloodiness(e.blood);
    }

    const pushForce = d.force || DEFAULT_FORCE[d.type];
    e.pressure = Math.min(1, e.pressure + 0.22 + frac);
    if (e.downed) {
      this.hitWhileDown(e, d, bone, pushForce);
      return;
    }
    // Getting up runs on keys from the root. Moved under it, the feet would slide.
    const shove = e.rising > 0 ? 0 : clamp((pushForce / e.def.hp) * SHOVE_GAIN, 0, SHOVE_MAX) * (e.isBoss ? 0.1 : 1);
    e.push.x += d.dir.x * shove;
    e.push.z += d.dir.z * shove;

    if (e.pinned) dropOff(e);

    const profile = profileOf(e);
    if (profile) {
      this.respond(e, d, profile, region, amount, pushForce, bone, armoured);
      return;
    }
    e.poise += amount;
    if (e.poise >= e.def.poise * e.maxHealth) {
      e.poise = 0;
      this.stagger(e, d.type === 'explosive' ? 0.75 : 0.5);
    } else if (!armoured) this.cryOut(e);
  }

  private cryOut(e: Enemy): void {
    if (this.w.now < e.painAt) return;
    e.painAt = this.w.now + (e.isBoss ? BOSS_PAIN_GAP : rand(PAIN_GAP, PAIN_GAP * 2));
    say(e, this.w, e.def.voice.pain, 0.6);
  }

  /** The rule in reactions.ts, carried out. */
  private respond(e: Enemy, d: DamageInfo, profile: ReactionProfile, region: GoreRegion, amount: number, force: number, bone: number, armoured: boolean): void {
    const anim = e.char.anim;
    const r = chooseReaction(e, d, profile, region, amount, force, this.w.now);
    if (this.m.outpost?.wounds.mustFall(e)) mustFall(r, d);
    // Ice cannot stumble, and a body still arriving is on somebody else's clock.
    if (e.frozen > 0 || e.entrance !== 'none') return;
    const felt = profile.pain > 0;
    const blast = d.type === 'explosive';
    if (r.level === 'flinch') {
      if (!armoured) this.cryOut(e);
      return;
    }
    if (felt) {
      if (blast || region === 'head') anim.guard?.(0.5 + r.strength * 0.5);
      else if (!armoured) anim.holdWound?.(bone, d.point, 0.7 + r.strength);
    }
    if (felt && !armoured) say(e, this.w, e.def.voice.pain, 0.7);
    e.reactAt = this.w.now + profile.cooldown;
    if (r.level === 'thrown') {
      this.knockDown(e, d.dir, r.strength, bone, profile, true);
      e.shock = 0;
      return;
    }
    const seconds = lerp(STAGGER_MIN, STAGGER_MAX, r.strength);
    if (r.tripped) {
      // Stopped short by its own leg, with the rest of the body still going.
      _v.copy(e.velocity);
      e.reel.copy(_v);
      e.velocity.set(0, 0, 0);
      this.stagger(e, seconds, _v.normalize(), r.strength, bone, 0);
    } else {
      this.stagger(e, seconds, d.dir, r.strength, bone, profile.reel);
    }
    e.shock *= SHOCK_AFTER_STAGGER;
    if (r.level === 'fall') {
      e.fallIn = rand(FALL_LEAD_MIN, FALL_LEAD_MAX);
      e.fallStrength = r.strength;
      e.fallBone = bone;
    }
  }

  /** Wounds: nothing hit him, he has simply stopped being able to stand. He goes over the way he was facing. */
  drop(e: Enemy, strength: number, bone: number): void {
    if (e.downed || e.fallIn > 0 || !e.alive) return;
    _n.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    this.stagger(e, STAGGER_MIN, _n, strength, bone, 0.5);
    e.fallIn = rand(FALL_LEAD_MIN, FALL_LEAD_MAX);
    e.fallStrength = strength;
    e.fallBone = bone;
  }

  /** Wounds: patched up and helped to his feet, from the crawl he was in. */
  standUp(e: Enemy): void {
    const profile = profileOf(e);
    if (!profile) return;
    e.char.anim.getUp?.('prone', profile.rise * 1.3, 0.9);
    e.rising = profile.rise * 1.3;
    e.stagger = e.rising + profile.daze;
    e.char.anim.daze?.(e.stagger);
  }

  /** Staggering did not save it. */
  fall(e: Enemy): void {
    const profile = profileOf(e);
    if (!profile || !e.alive || e.downed) return;
    _v.copy(e.reel).setY(0);
    if (_v.lengthSq() < 1e-4) _v.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).negate();
    this.knockDown(e, _v.normalize(), e.fallStrength, e.fallBone, profile, false);
  }

  private knockDown(e: Enemy, dir: THREE.Vector3, strength: number, bone: number, profile: ReactionProfile, thrown: boolean): void {
    const { ctx } = this.w;
    const m = this.m;
    const o = m.knockOptions;
    o.velocity.set(e.velocity.x + e.reel.x + e.push.x, e.airborne ? e.verticalSpeed : 0, e.velocity.z + e.reel.z + e.push.z);
    m.knockImpact.dir.copy(dir);
    m.knockImpact.strength = strength * 0.4;
    o.impact = m.knockImpact;
    // A blast throws it by itself, once this returns and the blast reaches Physics.
    o.topple = thrown ? undefined : m.knockTopple.copy(dir).multiplyScalar(lerp(TOPPLE_MIN, TOPPLE_MAX, strength));
    o.impulses = undefined;
    const wounds = m.outpost?.wounds ?? null;
    const floored = wounds?.bodyOf(e)?.floored ?? false;
    o.hurt = floored ? 1 : profile.pain * (0.5 + strength * 0.5);
    o.lie = floored ? wounds!.lieSeconds(wounds!.bodyOf(e)!) : rand(profile.lie[0], profile.lie[1]) * (0.7 + strength * 0.6);
    e.riseSeconds = floored ? 0 : profile.rise * (0.85 + strength * 0.4);
    e.dazeSeconds = floored ? 0 : profile.daze * (thrown ? 1 : strength);
    o.rise = e.riseSeconds;
    const wound = m.knockWound;
    wound.bone = bone;
    wound.point.setFromMatrixPosition(e.char.bones[bone]!.matrixWorld);
    o.wound = wound;
    if (!ctx.gore.knockdown(e.char, o)) {
      // Past the budget. Staggering is what it would have done with one more foot under it.
      e.fallIn = 0;
      if (thrown) this.stagger(e, STAGGER_MAX, dir, strength, bone, profile.reel);
      return;
    }
    if (e.attack) finishAttack(e, this.w, true);
    if (e.pinned) dropOff(e);
    e.downed = true;
    e.airborne = true;
    e.ballistic = false;
    e.fallIn = e.stagger = 0;
    e.verticalSpeed = e.flightLeft = 0;
    e.reel.set(0, 0, 0);
    e.push.set(0, 0, 0);
    e.velocity.set(0, 0, 0);
  }

  /** It keeps taking hits on the floor, and every one lands on the body as it lies. */
  private hitWhileDown(e: Enemy, d: DamageInfo, bone: number, force: number): void {
    const m = this.m;
    const o = m.knockOptions;
    const i = m.knockImpulses[0]!;
    i.bone = bone;
    i.point.copy(d.point);
    i.impulse.copy(d.dir).multiplyScalar(force);
    o.impulses = m.knockImpulses;
    o.impact = undefined;
    o.topple = undefined;
    const wound = m.knockWound;
    wound.bone = bone;
    wound.point.copy(d.point);
    o.wound = wound;
    this.w.ctx.gore.knockdown(e.char, o);
    this.cryOut(e);
  }

  /** A hit that took its balance. With `dir` it takes real steps that way, `reel` metres per second at the start. */
  stagger(e: Enemy, seconds: number, dir?: THREE.Vector3, strength = 0.5, bone = REGION_BONE.chest, reel = 1.5): void {
    if (e.isBoss) return;
    e.stagger = Math.max(e.stagger, seconds);
    const anim = e.char.anim;
    if (dir && anim.stumble) {
      anim.stumble(dir, strength, bone);
      const speed = reel * (1 + strength * REEL_GAIN);
      e.reel.x += dir.x * speed;
      e.reel.z += dir.z * speed;
    } else {
      anim.play('stagger', 1);
    }
    if (e.attackPhase === 'windup') finishAttack(e, this.w, true);
  }
}

