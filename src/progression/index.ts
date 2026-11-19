/**
 * Progression: the streak ladder, perks, call-ins, powerups, pickups and score. Everything hangs off 'enemy:killed':
 * one kill advances every counter, pays out score, rolls a drop and checks every reward.
 *
 * Clock choices, all on ctx.time:
 *  - Perks, combo, kill windows, strike timelines, pickups: realDt. The first game's ran on the wall clock, so the
 *    ladder feels the same in SLOWMO and rockets still pile up mid-air. update() stops with the game, so pause holds it.
 *  - Stims: playerDt. Ordnance and the Black Sun's pull: dt, because they push things in the simulated world.
 */
import * as THREE from 'three';
import type { Ctx, GradeName } from '../core/contracts';
import { DevFlags } from '../core/devflags';
import type { DamageInfo } from '../core/contracts';
import type {
  ActiveEffect, CallInId, DamageResult, EnemyInstance, KillEvent, PerkId, PickupKind, PowerupId, ProgressionSystem,
} from '../core/gameplay';
import type { Flight } from '../vehicles/flight';
import { ALLY_SOURCE } from '../allies/data';
import { ACTIVE } from '../contracts/select';
import { SHOP_ON } from '../contracts/shop/data';
import { CallInManager } from './callins/manager';
import type { Frame } from '../frame/seat';
import { aboveFloor } from './callins/shared';
import { ChainEffects } from './chains';
import { Combo, TimeWindow } from './counters';
import {
  AIMED_ASSISTS, ASSIST_COMBO_EVERY, ASSIST_SOURCES, CHAIN_REACTION_KILLS, COMBO_PERKS, COMBO_WINDOW, EFFECTS, OVERDRIVE_MIN_SPEED, REGEN, SKYFALL,
  SLOWMO_SAME_HEAD_GAP, STYLE_GATE, STYLE_PERKS, VAMPIRE_HEAL, WINDOWS, type EffectId, type StylePerk,
} from './data';

const STYLE: ReadonlySet<EffectId> = new Set(STYLE_PERKS);
import { FrostNova } from './frost';
import { CAPS, IMPLANTS_ON, IMPLANT_ORDER, Loadout, isImplant, saveWorn, type ImplantId } from './implants';
import { wearOnViewmodel } from '../characters/implants';
import { ModelMaterials } from './modelkit';
import { PerkRunner } from './perks';
import { Pickups } from './pickups/pickups';
import { DropPods } from './pickups/pods';
import { ScoreKeeper } from './score';
import { Stims } from './stims';

const COMBO_PITCH_STEP = 0.015;
const COMBO_BREAK_MIN = 5;
/** Every kill by hand on key 5: the sword's moves and the four beside it. */
const SWORD = /^(sword|knife|crowbar|shovel|baton)/;
/** Damage that counts as the player taking a limb off by hand, for Butcher. */
const BY_HAND: ReadonlySet<DamageInfo['type']> = new Set(['bullet', 'pellet', 'melee', 'slash']);
const MAX_SEVER_MEMORY = 64;
/** Outpost Defense sells call-ins, weapons, stims and ammo (contracts/defense), so nothing here hands them out for free. */
const SHOPS_SELL = ACTIVE.def.economy === true;

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
  private chains!: ChainEffects;
  private frost!: FrostNova;
  private pickupsManager!: Pickups;
  private pods!: DropPods;
  private stimKit!: Stims;
  private explosionId: number | null = null;
  private explosionKills = 0;
  private regenTick = 0;
  /** Seconds off the ground, for Skyfall. */
  private hang = 0;
  private lastHeadUid = -1;
  private lastHeadAt = -Infinity;
  /** When each enemy last lost a limb to the player, so one body only counts once toward Butcher. */
  private readonly severedAt = new Map<number, number>();
  /** realElapsed before which no style perk may start. */
  private styleOpenAt = 0;
  /** realElapsed before which each implant may not start again. */
  private readonly rearmAt = new Map<ImplantId, number>();
  /** What this run has bought and fitted (implants.ts). Progression grants only a perk that is core or fitted. */
  readonly loadout = new Loadout();
  private readonly wasFitted = new Set<ImplantId>();
  /** Scratch for the HUD's combined pickup list. */
  private readonly listed: { kind: PickupKind; position: THREE.Vector3; active: boolean }[] = [];

  constructor(private readonly ctx: Ctx) {}

  /** Holds a grade over the perks' (perks.ts): a seat's sensor, or the Thermal brain chip (contracts/chips.ts). Null lets go. */
  holdGrade(grade: GradeName | null): void {
    this.perks.holdGrade(grade);
  }

  /** Co-op: a teammate's slow-mo is on, and this screen takes its look (net/world/clock.ts). Null gives the screen back. */
  shareGrade(grade: GradeName | null): void {
    this.perks.shareGrade(grade);
  }

  init(): void {
    const { ctx } = this;
    const materials = new ModelMaterials(ctx);
    this.perks = new PerkRunner(ctx);
    this.scoreKeeper = new ScoreKeeper(ctx);
    this.callInsManager = new CallInManager(ctx, materials, grade => this.perks.holdGrade(grade));
    this.chains = new ChainEffects(ctx);
    this.frost = new FrostNova(ctx);
    this.stimKit = new Stims(ctx);
    this.pickupsManager = new Pickups(ctx, materials, this.stimKit);
    // Where the Crucible sells its guns, the pods bring its shop every break instead (contracts/shop).
    this.pods = new DropPods(ctx, materials, SHOP_ON);
    this.pickupsManager.onGrant(id => this.perks.grant(id));
    this.perks.listen({
      onEffectStart: id => this.effectStarted(id),
      onEffectEnd: id => this.effectEnded(id),
      // A second Time Warp capsule: the slow-mo is asked for again. Alone that changes nothing (the request is already up);
      // in co-op it tells the host to start this player's slow-mo clock again (net/world/clock.ts), as the perk's own timer has.
      onEffectRefresh: id => { if (id === 'slowmo' || id === 'timeWarp') this.ctx.time.pushScale(id, 0.25, 0.18, 0.4); },
    });
    this.resetComboRungs();
    this.resetStyleGate();
    this.loadout.onChange(() => this.loadoutChanged());

    const { events } = ctx;
    // An ally's hits and kills (src/allies) pay nothing, move no combo and feed no perk: they are not the player's.
    // Nor is a co-op teammate's (net/world.ts notMine): their own browser scores it.
    events.on('enemy:killed', e => { if (DevFlags.progression && !ALLY_SOURCE.test(e.damage.source) && !ctx.coop?.world?.notMine(e.enemy)) this.onKill(e); });
    events.on('enemy:hit', e => { if (DevFlags.progression && !ALLY_SOURCE.test(e.damage.source) && !ctx.coop?.world?.notMine()) this.onHit(e.enemy, e.damage, e.result); });
    events.on('enemy:severed', e => { if (DevFlags.progression && !ALLY_SOURCE.test(e.damage.source) && !ctx.coop?.world?.notMine()) this.onSevered(e.enemy, e.damage); });
    // A prisoner caught in a strike's splash is not the player's choice, so it earns nothing.
    // Co-op: a teammate's execution or wound is theirs; the host's world sends them the reward (net/world/credit.ts `award`).
    events.on('enemy:executed', e => {
      if (DevFlags.progression && !ASSIST_SOURCES.test(e.kill.damage.source) && !ctx.coop?.world?.notMine(e.kill.enemy)) this.onExecuted(e.kill.enemy);
    });
    events.on('enemy:wounded', e => {
      // A guest's own wound bonus comes from the host as an award, never from its own copy of the enemy.
      if (ctx.coop?.world && (!ctx.coop.hosting || ctx.coop.world.notMine())) return;
      if (DevFlags.progression && !ASSIST_SOURCES.test(e.damage.source) && !ALLY_SOURCE.test(e.damage.source)) this.scoreKeeper.add(e.bonus, e.label, e.enemy.center);
    });
    events.on('wave:clear', e => {
      if (e.bonus > 0) this.scoreKeeper.add(e.bonus, 'wave');
      this.scoreKeeper.persist();
      if (!SHOPS_SELL) this.pods.onWaveClear(e.wave);
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

  get stims(): Stims { return this.stimKit; }

  isActive(id: PerkId | PowerupId): boolean {
    return this.perks.isActive(id);
  }

  grant(id: PerkId | PowerupId): void {
    this.perks.grant(id);
  }

  grantCallIn(id: CallInId): void {
    this.callInsManager.grant(id);
  }

  boardCallIn(id: CallInId, over?: THREE.Vector3): void {
    this.callInsManager.board(id, false, over);
  }

  boardFlight(flight: Flight): void {
    this.callInsManager.boardFlight(flight);
  }

  /** The Distraint Frame (src/frame/seat.ts): `frame.board(feet, yaw)` puts the player in a fresh one. Not on ProgressionSystem either. */
  get frame(): Frame {
    return this.callInsManager.frame;
  }

  /** A mission's courier: the Packmule on a fixed flight, crewed, nobody in the seat. Not on ProgressionSystem: only the campaign host asks. */
  flyFlight(flight: Flight): { down(): void; readonly position: THREE.Vector3 } {
    return this.callInsManager.flyFlight(flight);
  }

  /** A mission's flak shuts the sky (campaign `callins` step). Not on ProgressionSystem: only the campaign host asks. */
  holdCallIns(held: boolean): void {
    this.callInsManager.shut = held;
  }

  award(points: number, reason: string, position?: THREE.Vector3): void {
    if (DevFlags.progression) this.scoreKeeper.add(points, reason, position);
  }

  resume(score: number, kills: number, headshots: number): void {
    this.scoreKeeper.score = score;
    this.scoreKeeper.kills = kills;
    this.scoreKeeper.headshots = headshots;
  }

  setCombo(combo: number): void {
    this.comboCounter.set(combo);
    this.ctx.events.emit('combo:changed', { combo });
  }

  spawnPickup(kind: PickupKind, position: THREE.Vector3): void {
    if (kind === 'weaponCache') this.pods.call(position);
    else this.pickupsManager.drop(kind, position);
  }

  placePickup(kind: Exclude<PickupKind, 'weaponCache'>, position: THREE.Vector3): void {
    this.pickupsManager.place(kind, position);
  }

  /** Seconds left on a call-in's cooldown. */
  callInCooldown(id: CallInId): number {
    return this.callInsManager.cooldown(id);
  }

  /** The Commander's anti-air team got one. True if there was anything up there to hit. */
  shootDown(id: CallInId): boolean {
    return this.callInsManager.shootDown(id);
  }

  // --- Events ----------------------------------------------------------------------------------

  private onKill(e: KillEvent): void {
    const now = this.ctx.time.realElapsed;
    const assist = ASSIST_SOURCES.test(e.damage.source);
    const previousTier = this.scoreKeeper.comboTier(this.combo);
    const combo = !assist
      ? this.comboCounter.hit()
      : AIMED_ASSISTS.test(e.damage.source) ? this.comboCounter.assist(ASSIST_COMBO_EVERY) : this.comboCounter.keep();
    this.ctx.events.emit('combo:changed', { combo });
    if (this.scoreKeeper.comboTier(combo) > previousTier) this.ctx.audio.play('combo_tier');
    else this.ctx.audio.play('combo_tick', { pitch: 1 + Math.min(combo, 50) * COMBO_PITCH_STEP });

    if (e.headshot && !assist) this.noteHeadshot(e.enemy, now);
    this.scoreKeeper.onKill(e, combo);

    // Check order from the first game, with the new rungs folded in behind each original.
    if (!SHOPS_SELL) this.callInsManager.offer(combo);
    for (const rung of COMBO_PERKS) {
      // With implants the rung moves on even while the perk runs: one Berserk no longer re-arms on the next kill after it.
      if (combo >= this.comboAt.get(rung.perk)! && (IMPLANTS_ON || !this.perks.isActive(rung.perk))) {
        this.comboAt.set(rung.perk, combo + rung.rearm);
        this.tryGrant(rung.perk, now);
      }
    }
    if (!assist) this.feedWindows(e, now);

    if (this.perks.isActive('vampire')) this.drain(e);
    this.frost.onKill(e);
    this.chains.onKill(e, this.perks.isActive('chainStorm'), this.perks.isActive('chainReaction'));
    if (!SHOPS_SELL) this.pickupsManager.onKill(e);
  }

  /** Everything a kill does for the perk windows. Only the player's own kills come here. */
  private feedWindows(e: KillEvent, now: number): void {
    this.tripWindow('bloodthirst', now);
    this.tripWindow('hellfire', now);
    if (SWORD.test(e.damage.source)) this.tripWindow('adrenaline', now);
    if (e.playerAirborne && this.hang >= STYLE_GATE.hangTime) this.tripStyle('skyfall', now);
    if (e.playerSpeed / Math.max(this.ctx.player.modifiers.speed, 1) > OVERDRIVE_MIN_SPEED) this.tripStyle('overdrive', now);
    this.countExplosion(e, now);
  }

  private tripWindow(id: 'bloodthirst' | 'hellfire' | 'adrenaline' | 'slowmo', now: number): void {
    const rule = WINDOWS[id];
    if (this.windows[id].push(now) < rule.need) return;
    // A window that clears keeps its kills while the perk cannot start, so it lands on the first good kill after.
    if (this.tryGrant(id, now) && rule.clears) this.windows[id].clear();
  }

  private tripStyle(id: Exclude<StylePerk, 'chainReaction'>, now: number): void {
    // The window keeps its kills while the gate is shut, so the perk lands on the first good kill after it opens.
    if (this.windows[id].push(now) >= WINDOWS[id].need && this.tryGrant(id, now)) this.windows[id].clear();
  }

  /**
   * Starts a perk if the loadout and the gates allow it: core always; an implant only fitted, not running, and 30 s after it
   * last ended; a style perk also not inside STYLE_GATE.spacing of another. True if it started (or, for core, retriggered).
   */
  private tryGrant(id: EffectId, now: number): boolean {
    if (!this.loadout.allows(id)) return false;
    if (isImplant(id)) {
      if (this.perks.isActive(id) || now < this.rearmAt.get(id)!) return false;
      if (STYLE.has(id)) {
        if (now < this.styleOpenAt) return false;
        this.styleOpenAt = now + STYLE_GATE.spacing;
      }
    }
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
    if (++this.explosionKills >= CHAIN_REACTION_KILLS) this.tryGrant('chainReaction', now);
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

  private onSevered(enemy: EnemyInstance, damage: DamageInfo): void {
    if (!BY_HAND.has(damage.type) || ASSIST_SOURCES.test(damage.source)) return;
    const now = this.ctx.time.realElapsed;
    const last = this.severedAt.get(enemy.uid);
    if (last !== undefined && now - last < WINDOWS.butcher.span) return;
    this.severedAt.set(enemy.uid, now);
    this.tripStyle('butcher', now);
    if (this.severedAt.size > MAX_SEVER_MEMORY) this.severedAt.clear();
  }

  private onExecuted(enemy: EnemyInstance): void {
    this.scoreKeeper.onExecution(enemy, this.combo);
    this.perks.grant('geneva');
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
    this.ctx.combat.explode(aboveFloor(position), {
      radius, damage: SKYFALL.damage, kind: 'rocket', source: 'skyfall', team: 'player', selfDamage: 0,
    });
    this.ctx.fx.ring(position, _up, EFFECTS.skyfall.color, radius * 2);
  }

  private onDeath(): void {
    this.scoreKeeper.persist();
    // Before the death grade goes on, because leaving a seat releases the seat's own.
    this.callInsManager.onDeath();
    this.perks.clear();
    if (!this.ctx.coop?.world) this.perks.showDeath();
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
    // Before implants only the style perks had a rearm.
    if (isImplant(id) && (IMPLANTS_ON || STYLE.has(id))) this.rearmAt.set(id, time.realElapsed + (IMPLANTS_ON ? CAPS.rearm : STYLE_GATE.rearm));
    switch (id) {
      case 'slowmo':
        time.popScale('slowmo');
        break;
      case 'timeWarp':
        audio.play('time_warp_out');
        time.popScale('timeWarp');
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
    for (const id of IMPLANT_ORDER) this.rearmAt.set(id, 0);
  }

  /**
   * The shop or the cheat panel changed the loadout (the run is paused under either). An effect taken off ends silently; one
   * put on arms with its kill window empty. The arm on the viewmodel changes with it, and the menu remembers it.
   */
  private loadoutChanged(): void {
    const { fitted } = this.loadout;
    for (const id of IMPLANT_ORDER) {
      const on = fitted.has(id);
      if (id === 'jumpJet') continue;
      if (!on && this.perks.isActive(id) && IMPLANTS_ON) this.perks.stop(id);
      if (on && !this.wasFitted.has(id)) {
        if (id in this.windows) this.windows[id as keyof typeof this.windows].clear();
        if (id === 'chainReaction') this.explosionKills = 0;
      }
    }
    this.wasFitted.clear();
    for (const id of fitted) this.wasFitted.add(id);
    wearOnViewmodel(this.ctx, this.loadout.ofClass('gun'));
    (this.ctx.player as { jumpJet?: boolean }).jumpJet = fitted.has('jumpJet');
    saveWorn(fitted);
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
    this.stimKit.update(time.playerDt);
    this.frost.update(time.dt);
    // In co-op every player has their own pickups, caches and supply pod: what one picks up is theirs alone.
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
    // Every run starts on the default loadout: purchases last one run, as guns and mods do.
    this.loadout.reset();
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
    this.severedAt.clear();
    this.callInsManager.clear();
    this.chains.clear();
    this.frost.clear();
    this.pickupsManager.clear();
    this.pods.clear();
    this.stimKit.reset();
    this.pickupsManager.layout();
    this.ctx.events.emit('combo:changed', { combo: 0 });
  }
}

export function createProgression(ctx: Ctx): ProgressionSystem {
  return new Progression(ctx);
}
