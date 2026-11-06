/**
 * Progression: the streak ladder, perks, call-ins, powerups, pickups and score. Everything hangs off 'enemy:killed':
 * one kill advances every counter, pays out score, rolls a drop and checks every reward.
 *
 * Clock choices, all on ctx.time:
 *  - Perks, combo, kill windows, strike timelines, pickups: realDt. The first game's ran on the wall clock, so the
 *    ladder feels the same in SLOWMO and rockets still pile up mid-air. update() stops with the game, so pause holds it.
 *  - Sentinels: playerDt. Ordnance and the Black Sun's pull: dt, because they push things in the simulated world.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { DamageInfo } from '../core/contracts';
import type {
  ActiveEffect, CallInId, DamageResult, EnemyInstance, KillEvent, PerkId, PickupKind, PowerupId, ProgressionSystem,
} from '../core/gameplay';
import { CallInManager } from './callins/manager';
import { ChainEffects } from './chains';
import { Combo, TimeWindow } from './counters';
import {
  ASSIST_COMBO_EVERY, ASSIST_SOURCES, CHAIN_REACTION_KILLS, COMBO_PERKS, COMBO_WINDOW, EFFECTS, OVERDRIVE_MIN_SPEED, REGEN, SKYFALL,
  SLOWMO_SAME_HEAD_GAP, STYLE_GATE, STYLE_PERKS, VAMPIRE_HEAL, WINDOWS, type EffectId, type StylePerk,
} from './data';
import { FrostNova } from './frost';
import { ModelMaterials } from './modelkit';
import { PerkRunner } from './perks';
import { Pickups } from './pickups/pickups';
import { DropPods } from './pickups/pods';
import { ScoreKeeper } from './score';
import { Sentinels } from './sentinels';

const COMBO_PITCH_STEP = 0.015;
const COMBO_BREAK_MIN = 5;
const SWORD = /sword/;
/** Damage that counts as the player taking a limb off by hand, for Butcher. */
const BY_HAND: ReadonlySet<DamageInfo['type']> = new Set(['bullet', 'pellet', 'melee', 'slash']);

const _up = new THREE.Vector3(0, 1, 0);
const _toPlayer = new THREE.Vector3();

class Progression implements ProgressionSystem {
  private perks!: PerkRunner;
  private scoreKeeper!: ScoreKeeper;
  private readonly comboCounter = new Combo(COMBO_WINDOW);
  private readonly windows = {
    bloodthirst: new TimeWindow(WINDOWS.bloodthirst.span),
    hellfire: new TimeWindow(WINDOWS.hellfire.span),
    adrenaline: new TimeWindow(WINDOWS.adrenaline.span),
    slowmo: new TimeWindow(WINDOWS.slowmo.span),
    butcher: new TimeWindow(WINDOWS.butcher.span),
    skyfall: new TimeWindow(WINDOWS.skyfall.span),
    overdrive: new TimeWindow(WINDOWS.overdrive.span),
  };
  /** Next combo at which each combo perk fires. */
  private readonly comboAt = new Map<PerkId, number>();
  private callInsManager!: CallInManager;
  private sentinels!: Sentinels;
  private chains!: ChainEffects;
  private frost!: FrostNova;
  private pickupsManager!: Pickups;
  private pods!: DropPods;
  private explosionId: number | null = null;
  private explosionKills = 0;
  private regenTick = 0;
  /** Seconds off the ground, for Skyfall. */
  private hang = 0;
  private lastHeadUid = -1;
  private lastHeadAt = -Infinity;
  /** realElapsed before which no style perk may start. */
  private styleOpenAt = 0;
  private readonly styleRearmAt = new Map<StylePerk, number>();
  /** Scratch for the HUD's combined pickup list. */
  private readonly listed: { kind: PickupKind; position: THREE.Vector3; active: boolean }[] = [];

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    const { ctx } = this;
    const materials = new ModelMaterials(ctx);
    this.perks = new PerkRunner(ctx);
    this.scoreKeeper = new ScoreKeeper(ctx);
    this.callInsManager = new CallInManager(ctx, materials);
    this.sentinels = new Sentinels(ctx, materials);
    this.chains = new ChainEffects(ctx);
    this.frost = new FrostNova(ctx);
    this.pickupsManager = new Pickups(ctx, materials);
    this.pods = new DropPods(ctx, materials);
    this.pickupsManager.onGrant(id => this.perks.grant(id));
    this.perks.listen({
      onEffectStart: id => this.effectStarted(id),
      onEffectEnd: id => this.effectEnded(id),
    });
    this.resetComboRungs();
    this.resetStyleGate();

    const { events } = ctx;
    events.on('enemy:killed', e => { if (DevFlags.progression) this.onKill(e); });
    events.on('enemy:hit', e => { if (DevFlags.progression) this.onHit(e.enemy, e.damage, e.result); });
    events.on('enemy:severed', e => { if (DevFlags.progression) this.onSevered(e.damage); });
    events.on('wave:clear', e => {
      if (e.bonus > 0) this.scoreKeeper.add(e.bonus, 'wave');
      this.scoreKeeper.persist();
      this.pods.onWaveClear(e.wave);
    });
    events.on('player:slam', e => this.onSlam(e.impact, e.position));
    events.on('player:died', () => this.onDeath());
    events.on('run:end', () => this.scoreKeeper.persist());
  }

  // --- Public surface --------------------------------------------------------------------------

  get score(): number { return this.scoreKeeper.score; }
  get kills(): number { return this.scoreKeeper.kills; }
  get headshots(): number { return this.scoreKeeper.headshots; }
  get highScore(): number { return this.scoreKeeper.highScore; }
  get combo(): number { return this.comboCounter.count; }
  get comboTimer(): number { return this.comboCounter.left / COMBO_WINDOW; }
  get multiplier(): number { return this.scoreKeeper.comboTier(this.combo) * this.scoreKeeper.speedTier(); }
  get effects(): readonly ActiveEffect[] { return this.perks.effects; }
  get callIns(): ReadonlySet<CallInId> { return this.callInsManager.held; }
  get targeting(): CallInId | null { return this.callInsManager.aiming; }
  /** True while the aim would put the player inside the blast. */
  get dangerClose(): boolean { return this.callInsManager.targeting.dangerClose; }
  /** Everything worth a dot on the minimap. Rebuilt per read; the HUD reads a few times a second. */
  get pickups(): readonly { kind: PickupKind; position: THREE.Vector3; active: boolean }[] {
    this.listed.length = 0;
    for (const p of this.pickupsManager.live) this.listed.push(p);
    for (const e of this.pods.entries) if (e.active) this.listed.push(e);
    return this.listed;
  }

  isActive(id: PerkId | PowerupId): boolean {
    return this.perks.isActive(id);
  }

  grant(id: PerkId | PowerupId): void {
    this.perks.grant(id);
  }

  grantCallIn(id: CallInId): void {
    this.callInsManager.grant(id);
  }

  spawnPickup(kind: PickupKind, position: THREE.Vector3): void {
    if (kind === 'weaponCache') this.pods.call(position);
    else this.pickupsManager.drop(kind, position);
  }

  /** Seconds left on a call-in's cooldown. */
  callInCooldown(id: CallInId): number {
    return this.callInsManager.cooldown(id);
  }

  // --- Events ----------------------------------------------------------------------------------

  private onKill(e: KillEvent): void {
    const now = this.ctx.time.realElapsed;
    const assist = ASSIST_SOURCES.test(e.damage.source);
    const combo = assist ? this.comboCounter.assist(ASSIST_COMBO_EVERY) : this.comboCounter.hit();
    this.ctx.events.emit('combo:changed', { combo });
    const previousTier = this.scoreKeeper.comboTier(combo - 1);
    if (this.scoreKeeper.comboTier(combo) > previousTier) this.ctx.audio.play('combo_tier');
    else this.ctx.audio.play('combo_tick', { pitch: 1 + Math.min(combo, 50) * COMBO_PITCH_STEP });

    if (e.headshot && !assist) this.noteHeadshot(e.enemy, now);
    this.scoreKeeper.onKill(e, combo);

    // Check order from the first game, with the new rungs folded in behind each original.
    this.callInsManager.offer(combo);
    for (const rung of COMBO_PERKS) {
      if (combo >= this.comboAt.get(rung.perk)! && !this.perks.isActive(rung.perk)) {
        this.comboAt.set(rung.perk, combo + rung.rearm);
        this.perks.grant(rung.perk);
      }
    }
    if (!assist) this.feedWindows(e, now);

    if (this.perks.isActive('vampire')) this.drain(e);
    this.frost.onKill(e);
    this.chains.onKill(e, this.perks.isActive('chainStorm'), this.perks.isActive('chainReaction'));
    this.pickupsManager.onKill(e);
  }

  /** Everything a kill does for the perk windows. Only the player's own kills come here. */
  private feedWindows(e: KillEvent, now: number): void {
    if (this.windows.bloodthirst.push(now) >= WINDOWS.bloodthirst.need) this.perks.grant('bloodthirst');
    if (this.windows.hellfire.push(now) >= WINDOWS.hellfire.need) this.perks.grant('hellfire');
    if (SWORD.test(e.damage.source)) this.tripWindow('adrenaline', now);
    if (e.playerAirborne && this.hang >= STYLE_GATE.hangTime) this.tripStyle('skyfall', now);
    if (e.playerSpeed / Math.max(this.ctx.player.modifiers.speed, 1) > OVERDRIVE_MIN_SPEED) this.tripStyle('overdrive', now);
    this.countExplosion(e, now);
  }

  private tripWindow(id: 'adrenaline' | 'slowmo', now: number): void {
    const rule = WINDOWS[id];
    if (this.windows[id].push(now) < rule.need) return;
    if (rule.clears) this.windows[id].clear();
    this.perks.grant(id);
  }

  private tripStyle(id: Exclude<StylePerk, 'chainReaction'>, now: number): void {
    // The window keeps its kills while the gate is shut, so the perk lands on the first good kill after it opens.
    if (this.windows[id].push(now) >= WINDOWS[id].need && this.grantStyle(id, now)) this.windows[id].clear();
  }

  /** Starts a style perk if the gate allows it. See STYLE_GATE. */
  private grantStyle(id: StylePerk, now: number): boolean {
    if (now < this.styleOpenAt || now < this.styleRearmAt.get(id)! || this.perks.isActive(id)) return false;
    this.styleOpenAt = now + STYLE_GATE.spacing;
    this.perks.grant(id);
    return true;
  }

  private countExplosion(e: KillEvent, now: number): void {
    // Under Hellfire every round is an explosion and every rocket an instakill, so nothing here is earned.
    if (e.explosionId === null || this.perks.isActive('hellfire')) return;
    if (e.explosionId !== this.explosionId) {
      this.explosionId = e.explosionId;
      this.explosionKills = 0;
    }
    if (++this.explosionKills >= CHAIN_REACTION_KILLS) this.grantStyle('chainReaction', now);
  }

  private onHit(enemy: EnemyInstance, damage: DamageInfo, result: DamageResult): void {
    if (!result.headshot || result.killed || ASSIST_SOURCES.test(damage.source)) return;
    this.noteHeadshot(enemy, this.ctx.time.realElapsed);
    this.scoreKeeper.onHeadshotHit(enemy, this.combo, result);
  }

  private noteHeadshot(enemy: EnemyInstance, now: number): void {
    if (!this.scoreKeeper.noteHeadshot(enemy)) return;
    const sameHead = enemy.uid === this.lastHeadUid && now - this.lastHeadAt < SLOWMO_SAME_HEAD_GAP;
    this.lastHeadUid = enemy.uid;
    this.lastHeadAt = now;
    if (!sameHead) this.tripWindow('slowmo', now);
  }

  private onSevered(damage: DamageInfo): void {
    if (BY_HAND.has(damage.type) && !ASSIST_SOURCES.test(damage.source)) this.tripStyle('butcher', this.ctx.time.realElapsed);
  }

  private drain(e: KillEvent): void {
    const { audio, fx, player } = this.ctx;
    player.heal(VAMPIRE_HEAL);
    _toPlayer.copy(player.eye).y -= 0.4;
    fx.arc(e.enemy.center, _toPlayer, EFFECTS.vampire.color, 0.18, 0.1);
    audio.play('vampire_drain');
  }

  private onSlam(impact: number, position: THREE.Vector3): void {
    if (!this.perks.isActive('skyfall')) return;
    const radius = Math.min(SKYFALL.maxRadius, SKYFALL.baseRadius + impact * SKYFALL.radiusPerImpact);
    this.ctx.combat.explode(position, {
      radius, damage: SKYFALL.damage, kind: 'rocket', source: 'skyfall', team: 'player', selfDamage: 0,
    });
    this.ctx.fx.ring(position, _up, EFFECTS.skyfall.color, radius * 2);
  }

  private onDeath(): void {
    this.scoreKeeper.persist();
    this.perks.clear();
    this.perks.showDeath();
    this.sentinels.stop();
    this.callInsManager.onDeath();
    this.ctx.time.popScale('slowmo');
    this.ctx.time.popScale('timeWarp');
  }

  private effectStarted(id: EffectId): void {
    const { audio, player, time, weapons } = this.ctx;
    switch (id) {
      case 'bloodthirst':
        weapons.refillMagazines();
        break;
      case 'slowmo':
        time.pushScale('slowmo', 0.25, 0.18, 0.4);
        break;
      case 'timeWarp':
        audio.play('time_warp_in');
        time.pushScale('timeWarp', 0.25, 0.18, 0.4);
        break;
      case 'sentinels':
        this.sentinels.start();
        break;
      case 'frostNova':
        this.frost.cast();
        break;
      case 'skyfall':
        player.modifiers.infiniteDash = true;
        break;
      case 'magnet':
        audio.play('magnet_pull');
        break;
    }
  }

  private effectEnded(id: EffectId): void {
    const { audio, player, time } = this.ctx;
    if (this.styleRearmAt.has(id as StylePerk)) this.styleRearmAt.set(id as StylePerk, time.realElapsed + STYLE_GATE.rearm);
    switch (id) {
      case 'slowmo':
        time.popScale('slowmo');
        break;
      case 'timeWarp':
        audio.play('time_warp_out');
        time.popScale('timeWarp');
        break;
      case 'sentinels':
        this.sentinels.stop();
        break;
      case 'skyfall':
        player.modifiers.infiniteDash = false;
        break;
    }
  }

  private resetComboRungs(): void {
    for (const rung of COMBO_PERKS) this.comboAt.set(rung.perk, rung.at);
  }

  private resetStyleGate(): void {
    this.styleOpenAt = 0;
    for (const id of STYLE_PERKS) this.styleRearmAt.set(id, 0);
  }

  // --- Frame -----------------------------------------------------------------------------------

  update(): void {
    const { player, time, waves } = this.ctx;
    const real = time.realDt;
    this.hang = player.grounded ? 0 : this.hang + real;

    // Wave breaks pause the gap timer: the first game's wave breaks always killed the combo.
    if (waves.phase !== 'intermission' && this.comboCounter.tick(real)) {
      this.resetComboRungs();
      this.ctx.events.emit('combo:changed', { combo: 0 });
    }

    this.perks.update(real);
    this.scoreKeeper.update(real);
    this.chains.update(real);
    this.callInsManager.update(real);
    this.sentinels.update(time.playerDt);
    this.frost.update(time.dt);
    this.pickupsManager.update(real, this.perks.isActive('magnet'));
    this.pods.update(real);

    if (this.perks.isActive('regen')) {
      this.regenTick -= real;
      if (this.regenTick <= 0) {
        this.regenTick += REGEN.tick;
        this.ctx.player.heal(REGEN.healthPerSecond * REGEN.tick);
        this.ctx.weapons.addAmmo(REGEN.ammoPerSecond * REGEN.tick);
      }
    }
  }

  reset(): void {
    this.perks.clear();
    this.scoreKeeper.reset();
    this.comboCounter.clear();
    for (const w of Object.values(this.windows)) w.clear();
    this.resetComboRungs();
    this.resetStyleGate();
    this.explosionId = null;
    this.explosionKills = 0;
    this.regenTick = 0;
    this.hang = 0;
    this.lastHeadUid = -1;
    this.lastHeadAt = -Infinity;
    this.callInsManager.clear();
    this.sentinels.clear();
    this.chains.clear();
    this.frost.clear();
    this.pickupsManager.clear();
    this.pods.clear();
    this.pickupsManager.layout();
    this.ctx.events.emit('combo:changed', { combo: 0 });
  }
}

export function createProgression(ctx: Ctx): ProgressionSystem {
  return new Progression(ctx);
}
