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
import type {
  ActiveEffect, CallInId, DamageResult, EnemyInstance, KillEvent, PerkId, PickupKind, PowerupId, ProgressionSystem,
} from '../core/gameplay';
import { CallInManager } from './callins/manager';
import { ChainEffects } from './chains';
import { Combo, TimeWindow } from './counters';
import {
  CHAIN_REACTION_KILLS, COMBO_PERKS, COMBO_WINDOW, EFFECTS, OVERDRIVE_MIN_SPEED, REGEN, SKYFALL, VAMPIRE_HEAL, WINDOWS, type EffectId,
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
/** Sources that may not re-arm Chain Reaction, or one explosion would extend itself for ever. */
const CHAIN_SOURCE = 'chain_reaction';

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

    const { events } = ctx;
    events.on('enemy:killed', e => this.onKill(e));
    events.on('enemy:hit', e => this.onHit(e.enemy, e.result));
    events.on('enemy:severed', () => this.onSevered());
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
  get targeting(): CallInId | null { return this.callInsManager.targeting.id; }
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
    const combo = this.comboCounter.hit();
    this.ctx.events.emit('combo:changed', { combo });
    const previousTier = this.scoreKeeper.comboTier(combo - 1);
    if (this.scoreKeeper.comboTier(combo) > previousTier) this.ctx.audio.play('combo_tier');
    else this.ctx.audio.play('combo_tick', { pitch: 1 + Math.min(combo, 50) * COMBO_PITCH_STEP });

    if (e.headshot) this.noteHeadshot(e.enemy, now);
    this.scoreKeeper.onKill(e, combo);

    // Check order from the first game, with the new rungs folded in behind each original.
    this.callInsManager.offer(combo);
    for (const rung of COMBO_PERKS) {
      if (combo >= this.comboAt.get(rung.perk)! && !this.perks.isActive(rung.perk)) {
        this.comboAt.set(rung.perk, combo + rung.rearm);
        this.perks.grant(rung.perk);
      }
    }
    if (this.windows.bloodthirst.push(now) >= WINDOWS.bloodthirst.need) this.perks.grant('bloodthirst');
    if (this.windows.hellfire.push(now) >= WINDOWS.hellfire.need) this.perks.grant('hellfire');

    if (SWORD.test(e.damage.source)) this.tripWindow('adrenaline', now);
    if (e.playerAirborne) this.tripWindow('skyfall', now);
    if (e.playerSpeed > OVERDRIVE_MIN_SPEED) this.tripWindow('overdrive', now);
    this.countExplosion(e);

    if (this.perks.isActive('vampire')) this.drain(e);
    this.frost.onKill(e);
    this.chains.onKill(e, this.perks.isActive('chainStorm'), this.perks.isActive('chainReaction'));
    this.pickupsManager.onKill(e);
  }

  private tripWindow(id: keyof typeof WINDOWS & EffectId, now: number): void {
    const rule = WINDOWS[id];
    if (this.windows[id].push(now) < rule.need) return;
    if (rule.clears) this.windows[id].clear();
    this.perks.grant(id);
  }

  private countExplosion(e: KillEvent): void {
    if (e.explosionId === null || e.damage.source === CHAIN_SOURCE) return;
    if (e.explosionId !== this.explosionId) {
      this.explosionId = e.explosionId;
      this.explosionKills = 0;
    }
    if (++this.explosionKills >= CHAIN_REACTION_KILLS) this.perks.grant('chainReaction');
  }

  private onHit(enemy: EnemyInstance, result: DamageResult): void {
    if (!result.headshot || result.killed) return;
    this.noteHeadshot(enemy, this.ctx.time.realElapsed);
    this.scoreKeeper.onHeadshotHit(enemy, this.combo, result);
  }

  private noteHeadshot(enemy: EnemyInstance, now: number): void {
    if (this.scoreKeeper.noteHeadshot(enemy)) this.tripWindow('slowmo', now);
  }

  private onSevered(): void {
    this.tripWindow('butcher', this.ctx.time.realElapsed);
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

  // --- Frame -----------------------------------------------------------------------------------

  update(): void {
    const { time, waves } = this.ctx;
    const real = time.realDt;

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
    this.explosionId = null;
    this.explosionKills = 0;
    this.regenTick = 0;
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
