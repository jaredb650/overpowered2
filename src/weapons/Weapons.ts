/**
 * The player's arsenal. Input in, shots out. All timing runs on ctx.time.playerDt, so SLOWMO leaves the
 * player at full cadence and a hit-stop pauses the gun with the world.
 *
 * Fire rate is a time accumulator: a shot's cooldown carries its remainder into the next one, so 20
 * rps is 20 rps at any frame rate rather than rounding up to whole frames.
 */
import * as THREE from 'three';
import { CG, type Ctx, type ExplosionKind, type LoopHandle } from '../core/contracts';
import type {
  AmmoState, ProjectileSpec, ProjectileTrail, ShotSpec, WeaponId, WeaponModifiers, WeaponSystem,
} from '../core/gameplay';
import { clamp, damp, invLerp, lerp, randomInCone, wrapAngle } from '../core/math';
import { MOVE } from '../player/tuning';
import type { Combat, Guard, GuardResult } from './Combat';
import { HIT_STOP, STARTING_WEAPONS, SWORD, TUNING, WEAPONS, WEAPON_ORDER, type SoundLayer, type WeaponDef } from './data';
import { Sword } from './Sword';

interface Slot {
  def: WeaponDef;
  /** Seconds until the next shot. Goes negative within a frame so the remainder carries. */
  cooldown: number;
  ammo: AmmoState;
}

const SLOT_ACTIONS = [
  'weapon0', 'weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5', 'weapon6', 'weapon7', 'weapon8', 'weapon9',
] as const;

const UP = new THREE.Vector3(0, 1, 0);
/** Seconds a rate boost cuts off a reload. Capped so Berserk does not turn reloads into a blink. */
const MAX_RELOAD_BOOST = 1.5;

export class Weapons implements WeaponSystem, Guard {
  current: WeaponId = 'smg';
  readonly owned = new Set<WeaponId>();
  grenades: number = TUNING.grenade.start;
  modifiers: WeaponModifiers = {
    damage: 1, fireRate: 1, bottomlessMag: false, pellets: 1, explosiveRounds: false, blastRadius: 1, instakillBlast: false,
    akimbo: false, ricochet: 0, shockRounds: false, alwaysSever: false, tracer: null, shotLayers: [],
  };

  private readonly slots: Record<WeaponId, Slot>;
  private readonly sword: Sword;
  private lastWeapon: WeaponId = 'shotgun';
  /** The gun a sword kill feeds: whatever was in hand before the blade came out. */
  private lastGun: WeaponId = 'smg';
  private pendingSwitch: WeaponId | null = null;
  private drawLeft = 0;
  private holstered = false;

  private reloadLeft = 0;
  private reloadTotal = 0;
  private reloadCue = 0;
  private autoReload = -1;
  /** Counts down to handing a dry gun over to the next loaded one. Negative when idle. */
  private drySwap = -1;

  private pressBuffer = 0;
  private fired = false;
  /** Akimbo: the next shot comes from the left gun. */
  private leftNext = false;

  private chargeLevel = 0;
  private chargeFull = false;
  private spin = 0;
  private spinning = false;
  private streamOn = false;
  private loop: LoopHandle | null = null;
  private fireLoop: LoopHandle | null = null;
  private loopKind = '';

  private zoomed = false;
  private zoom = 0;
  private scopeShown = false;

  private cooking = false;
  private cookLeft = 0;
  private cookCue = 0;

  private akimboOn = false;
  private quickReturn = 0;

  /** The player's pose as the rig sampled it, one system after this one, last frame. See flashPoint. */
  private readonly rigEye = new THREE.Vector3();
  private rigYaw = 0;
  private rigPitch = 0;

  private readonly muzzleAt = new THREE.Vector3();
  private readonly flashAt = new THREE.Vector3();
  private readonly flashDir = new THREE.Vector3();
  private readonly flashEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly flashTurn = new THREE.Quaternion();
  private readonly dir = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly shot: ShotSpec = { damage: 0, source: '', team: 'player' };
  private readonly firedEvent = { weapon: 'smg' as WeaponId, origin: new THREE.Vector3(), dir: new THREE.Vector3() };
  private readonly playOptions = { position: undefined as THREE.Vector3 | undefined, volume: 1, pitch: 1, pitchJitter: 0 };

  constructor(private readonly ctx: Ctx) {
    const slots = {} as Record<WeaponId, Slot>;
    for (const id of WEAPON_ORDER) {
      const def = WEAPONS[id];
      slots[id] = {
        def, cooldown: 0, ammo: { mag: def.magSize, magSize: def.magSize, reserve: def.reserve, maxReserve: def.maxReserve },
      };
    }
    this.slots = slots;
    this.sword = new Sword(ctx, this.combat, this.modifiers);
    for (const id of STARTING_WEAPONS) this.owned.add(id);
  }

  private get combat(): Combat {
    return this.ctx.combat as Combat;
  }

  init(): void {
    const { events } = this.ctx;
    events.on('player:died', () => {
      // A cooked grenade goes down with you, which is both fair and funny.
      if (this.cooking) this.throwGrenade(this.cookLeft, 0);
      this.stopEverything();
    });
    events.on('game:state', e => {
      // A pause drops the scope and silences the loops, but it must not cost a reload or a grenade already in the hand.
      if (e.to === 'paused') {
        this.endContinuous();
        this.clearScope(false);
      } else if (e.to !== 'playing') {
        this.stopEverything();
      }
    });
    events.on('enemy:killed', e => {
      if (e.damage.source.startsWith('sword')) this.feedGun();
    });
    events.on('wave:clear', () => this.liftReserves());
    this.ctx.viewmodel.equip?.(this.current, 0.01);
  }

  reset(): void {
    this.stopEverything();
    this.owned.clear();
    for (const id of STARTING_WEAPONS) this.owned.add(id);
    for (const id of WEAPON_ORDER) {
      const s = this.slots[id];
      s.cooldown = 0;
      s.ammo.mag = s.def.magSize;
      s.ammo.reserve = s.def.reserve;
    }
    this.grenades = TUNING.grenade.start;
    const m = this.modifiers;
    m.damage = m.fireRate = m.pellets = m.blastRadius = 1;
    m.bottomlessMag = m.explosiveRounds = m.instakillBlast = m.akimbo = m.shockRounds = m.alwaysSever = false;
    m.ricochet = 0;
    m.tracer = null;
    m.shotLayers.length = 0;
    this.current = 'smg';
    this.lastWeapon = 'shotgun';
    this.lastGun = 'smg';
    this.pendingSwitch = null;
    this.holstered = false;
    this.sword.reset();
    this.drawLeft = 0;
    this.ctx.viewmodel.equip?.(this.current, 0.01);
  }

  // -------------------------------------------------------------------------------------------
  // Public state
  // -------------------------------------------------------------------------------------------

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  get reloadProgress(): number {
    return this.reloadLeft > 0 ? 1 - this.reloadLeft / this.reloadTotal : 0;
  }

  get scoped(): boolean {
    return this.scopeShown;
  }

  get charge(): number {
    return this.current === 'buzzsaw' ? this.spin : this.chargeLevel;
  }

  /** Crosshair openness. Guns here are accurate, so only the pellet cone and the minigun's wobble show. */
  get spread(): number {
    const def = WEAPONS[this.current];
    return clamp(def.spread / 0.06);
  }

  get swordStep(): number {
    return this.sword.step;
  }

  ammo(id: WeaponId = this.current): AmmoState {
    return this.slots[id].ammo;
  }

  give(id: WeaponId): void {
    if (this.owned.has(id)) {
      this.addReserve(this.slots[id], 0.5);
      return;
    }
    this.owned.add(id);
    const s = this.slots[id];
    s.ammo.mag = s.def.magSize;
    s.ammo.reserve = s.def.reserve;
    this.ctx.events.emit('weapon:unlocked', { weapon: id });
  }

  setLoadout(weapons: readonly WeaponId[], grenades: number): void {
    this.stopEverything();
    this.owned.clear();
    for (const id of weapons) this.owned.add(id);
    this.grenades = grenades;
    const first = weapons[0]!;
    const gun = weapons.find(id => id !== 'sword') ?? first;
    this.current = first;
    this.lastWeapon = weapons[1] ?? first;
    this.lastGun = gun;
    this.ctx.viewmodel.equip?.(first, 0.01);
  }

  private addReserve(s: Slot, fraction: number): void {
    s.ammo.reserve = Math.min(s.ammo.maxReserve, s.ammo.reserve + Math.ceil(s.ammo.maxReserve * fraction));
  }

  addAmmo(fraction: number): void {
    for (const id of WEAPON_ORDER) this.addReserve(this.slots[id], fraction);
  }

  addGrenades(count: number): void {
    this.grenades = Math.min(TUNING.grenade.max, this.grenades + count);
  }

  private feedGun(): void {
    const id = this.current === 'sword' ? this.lastGun : this.current;
    const a = this.slots[id].ammo;
    a.reserve = Math.min(a.maxReserve, a.reserve + Math.ceil(a.magSize * TUNING.ammo.swordKillMags));
  }

  /** A floor, not a gift: it only reaches a gun that came out of the wave nearly empty. */
  private liftReserves(): void {
    for (const id of this.owned) {
      const a = this.slots[id].ammo;
      a.reserve = Math.max(a.reserve, Math.ceil(a.maxReserve * TUNING.ammo.waveFloor));
    }
  }

  refillMagazines(): void {
    for (const id of WEAPON_ORDER) this.slots[id].ammo.mag = this.slots[id].def.magSize;
    if (this.reloading) this.endReload(false);
  }

  setHolstered(holstered: boolean): void {
    if (this.holstered === holstered) return;
    this.holstered = holstered;
    if (holstered) {
      if (this.cooking) this.throwGrenade(this.cookLeft, 1);
      this.stopEverything();
      this.ctx.viewmodel.holster(0.18);
    } else {
      this.beginDraw(this.current);
    }
  }

  guard(incoming: THREE.Vector3): GuardResult {
    return this.current === 'sword' ? this.sword.guard(incoming) : 'none';
  }

  /** Stops every continuous thing. Called on death, pause and holster, so nothing keeps roaring in a menu. */
  private stopEverything(): void {
    this.endContinuous();
    this.clearScope(false);
    this.cancelReload();
    this.sword.cancel();
    this.cooking = false;
    this.chargeLevel = 0;
    this.chargeFull = false;
    this.spin = 0;
    this.spinning = false;
    this.pressBuffer = 0;
    this.autoReload = -1;
    this.drySwap = -1;
    this.quickReturn = 0;
    this.ctx.viewmodel.setCharge(0);
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(): void {
    this.frame();
    const p = this.ctx.player;
    this.rigEye.copy(p.eye);
    this.rigYaw = p.yaw;
    this.rigPitch = p.pitch;
  }

  private frame(): void {
    const c = this.ctx;
    const dt = c.time.playerDt;
    this.sword.tick(dt);
    if (c.player.alive === false) return;

    for (const id of WEAPON_ORDER) {
      const s = this.slots[id];
      if (s.cooldown > 0) s.cooldown -= dt;
    }
    this.syncAkimbo();

    if (this.holstered) return;
    this.readSwitch();
    this.updateGrenade(dt);
    this.updateZoom();
    this.updateDrySwap(dt);

    if (this.sword.inQuickStrike) {
      this.sword.updateQuick(dt);
      if (!this.sword.inQuickStrike) this.afterQuick();
      this.endContinuous();
      return;
    }
    if (this.quickReturn > 0) {
      this.quickReturn -= dt;
      return;
    }

    if (this.drawLeft > 0) {
      this.drawLeft -= dt;
      if (this.drawLeft > 0) return;
    }

    if (this.current === 'sword') {
      this.sword.update(dt);
      return;
    }

    if (c.input.pressed('melee')) {
      this.startQuickMelee();
      return;
    }
    this.updateReload(dt);
    this.updateGun(dt);
    this.applyHandling(dt);
  }

  private syncAkimbo(): void {
    const on = this.modifiers.akimbo && this.current === 'smg';
    if (on === this.akimboOn) return;
    this.akimboOn = on;
    this.ctx.viewmodel.setAkimbo(on);
  }

  private readSwitch(): void {
    const { input } = this.ctx;
    for (let i = 0; i < SLOT_ACTIONS.length; i++) {
      if (!input.pressed(SLOT_ACTIONS[i]!)) continue;
      const id = WEAPON_ORDER.find(w => WEAPONS[w].slot === i);
      if (id) this.switchTo(id);
    }
    if (input.pressed('weaponLast')) this.switchTo(this.lastWeapon);
    if (input.pressed('weaponNext')) this.cycle(1);
    if (input.pressed('weaponPrev')) this.cycle(-1);
    if (this.pendingSwitch && !this.sword.committed) {
      const id = this.pendingSwitch;
      this.pendingSwitch = null;
      this.switchTo(id);
    }
  }

  private cycle(step: number): void {
    const from = WEAPON_ORDER.indexOf(this.current);
    for (let i = 1; i <= WEAPON_ORDER.length; i++) {
      const id = WEAPON_ORDER[(from + i * step + WEAPON_ORDER.length * 2) % WEAPON_ORDER.length]!;
      if (this.owned.has(id)) {
        this.switchTo(id);
        return;
      }
    }
  }

  switchTo(id: WeaponId): void {
    if (id === this.current || !this.owned.has(id)) return;
    // The blast is already swung. Taking it away now is the first game's slam sound with no slam.
    if (this.sword.committed) {
      this.pendingSwitch = id;
      return;
    }
    const from = this.current;
    this.endContinuous();
    this.clearScope(false);
    this.cancelReload();
    this.sword.cancel();
    this.chargeLevel = 0;
    this.chargeFull = false;
    this.spin = 0;
    this.spinning = false;
    this.pressBuffer = 0;
    this.autoReload = -1;
    this.drySwap = -1;
    this.quickReturn = 0;
    this.current = id;
    this.lastWeapon = from;
    if (from !== 'sword') this.lastGun = from;
    this.ctx.viewmodel.setCharge(0);
    this.beginDraw(id);
    this.ctx.events.emit('weapon:switched', { from, to: id });
    if (this.ammoEmpty(id)) this.autoReload = TUNING.autoReloadDelay;
  }

  private beginDraw(id: WeaponId): void {
    const def = WEAPONS[id];
    this.drawLeft = def.drawTime;
    this.ctx.viewmodel.equip(id, def.drawTime);
    this.ctx.audio.play(def.drawSound);
  }

  private ammoEmpty(id: WeaponId): boolean {
    const a = this.slots[id].ammo;
    return a.magSize > 0 && a.mag === 0;
  }

  // -------------------------------------------------------------------------------------------
  // Reload
  // -------------------------------------------------------------------------------------------

  private startReload(): boolean {
    const s = this.slots[this.current];
    const a = s.ammo;
    if (s.def.mode === 'melee' || this.reloading || a.mag >= a.magSize || a.reserve <= 0) return false;
    if (this.modifiers.bottomlessMag) return false;
    this.endContinuous();
    this.chargeLevel = 0;
    this.chargeFull = false;
    this.ctx.viewmodel.setCharge(0);
    this.clearScope(true);
    const boost = clamp(this.modifiers.fireRate, 1, MAX_RELOAD_BOOST);
    this.reloadTotal = this.reloadLeft = s.def.reloadTime / boost;
    this.reloadCue = 0;
    this.autoReload = -1;
    this.ctx.viewmodel.reload(this.reloadTotal);
    this.ctx.events.emit('weapon:reload', { weapon: this.current, phase: 'start' });
    return true;
  }

  private updateReload(dt: number): void {
    const { input } = this.ctx;
    if (this.reloading) {
      // A bottomless mag makes the wait pointless. The first game made you sit through it.
      if (this.modifiers.bottomlessMag) {
        this.endReload(true);
        return;
      }
      this.reloadLeft -= dt;
      const def = WEAPONS[this.current];
      const progress = this.reloadProgress;
      while (this.reloadCue < def.reloadFoley.length && progress >= def.reloadFoley[this.reloadCue]![0]) {
        this.ctx.audio.play(def.reloadFoley[this.reloadCue]![1]);
        this.reloadCue++;
      }
      if (this.reloadLeft <= 0) this.endReload(true);
      return;
    }
    if (input.pressed('reload')) {
      this.startReload();
      return;
    }
    if (this.autoReload >= 0) {
      this.autoReload -= dt;
      if (this.autoReload <= 0) {
        this.autoReload = -1;
        this.startReload();
      }
    }
  }

  private endReload(fill: boolean): void {
    const s = this.slots[this.current];
    this.reloadLeft = 0;
    if (fill) {
      const a = s.ammo;
      const take = Math.min(a.magSize - a.mag, a.reserve);
      a.mag += take;
      a.reserve -= take;
    }
    this.ctx.events.emit('weapon:reload', { weapon: this.current, phase: 'end' });
  }

  private cancelReload(): void {
    if (this.reloading) this.reloadLeft = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Firing
  // -------------------------------------------------------------------------------------------

  private interval(def: WeaponDef): number {
    return def.interval / Math.max(this.modifiers.fireRate, 0.01);
  }

  private updateGun(dt: number): void {
    const { input } = this.ctx;
    const s = this.slots[this.current];
    const def = s.def;
    const held = input.isDown('fire');
    // A press stays live for as long as the button is held, so a click during a reload fires on its first legal frame.
    if (input.pressed('fire')) this.pressBuffer = TUNING.pressBuffer;
    else if (this.pressBuffer > 0 && !held) this.pressBuffer -= dt;

    if (this.reloading) {
      // Keep the barrels turning down through a reload, so the Buzzsaw does not feel like it hit a wall.
      if (def.mode === 'spin') this.spinDown(dt);
      return;
    }

    switch (def.mode) {
      case 'auto': this.updateAuto(s, held); break;
      case 'semi': this.updateSemi(s); break;
      case 'charge': this.updateCharge(s, dt, held); break;
      case 'spin': this.updateSpin(s, dt, held); break;
      case 'stream': this.updateStream(s, dt, held); break;
    }
    if (def.mode === 'auto' || def.mode === 'spin') {
      if (!held && s.cooldown < 0) s.cooldown = 0;
    }
  }

  private canShoot(s: Slot): boolean {
    return s.ammo.mag > 0 || s.def.magSize === 0 || this.modifiers.bottomlessMag;
  }

  /** Trigger on an empty gun: reload if possible, otherwise tell the player and find them something that shoots. */
  private dryFire(): void {
    const { input } = this.ctx;
    if (!input.pressed('fire')) return;
    if (this.startReload()) return;
    this.wentDry();
  }

  private wentDry(): void {
    const { audio, events, hud } = this.ctx;
    audio.play('weapon_dry');
    events.emit('weapon:empty', { weapon: this.current });
    hud.feed(`${WEAPONS[this.current].name} DRY`, '#ffd400');
    this.drySwap = TUNING.ammo.swapDelay;
  }

  private consume(s: Slot, rounds = 1): void {
    if (this.modifiers.bottomlessMag) return;
    s.ammo.mag = Math.max(0, s.ammo.mag - rounds);
    if (s.ammo.mag > 0) return;
    if (s.ammo.reserve > 0) this.autoReload = TUNING.autoReloadDelay;
    else this.wentDry();
  }

  private updateDrySwap(dt: number): void {
    if (this.drySwap < 0) return;
    this.drySwap -= dt;
    if (this.drySwap > 0) return;
    this.drySwap = -1;
    // A pickup or a perk may have saved the gun during the delay.
    if (this.canShoot(this.slots[this.current]) || this.slots[this.current].ammo.reserve > 0) return;
    this.switchTo(this.nextLoaded());
    // The finger never left the trigger, so a semi-auto takes over firing instead of waiting for a fresh click.
    if (this.ctx.input.isDown('fire')) this.pressBuffer = TUNING.pressBuffer;
  }

  private nextLoaded(): WeaponId {
    const order = TUNING.ammo.fallback;
    for (let i = 0; i < order.length; i++) {
      const id = order[i]!;
      if (!this.owned.has(id)) continue;
      const a = this.slots[id].ammo;
      if (a.magSize === 0 || a.mag > 0 || a.reserve > 0) return id;
    }
    return 'sword';
  }

  private updateAuto(s: Slot, held: boolean): void {
    if (!held) return;
    if (!this.canShoot(s)) {
      this.dryFire();
      return;
    }
    const akimbo = this.akimboOn;
    const interval = this.interval(s.def) / (akimbo ? 2 : 1);
    while (s.cooldown <= 0 && this.canShoot(s)) {
      this.shootGun(s, akimbo && this.leftNext);
      if (akimbo) this.leftNext = !this.leftNext;
      s.cooldown += interval;
    }
  }

  private updateSemi(s: Slot): void {
    if (this.pressBuffer <= 0 || s.cooldown > 0) return;
    if (!this.canShoot(s)) {
      this.dryFire();
      this.pressBuffer = 0;
      return;
    }
    this.pressBuffer = 0;
    this.shootGun(s, false);
    s.cooldown = this.interval(s.def);
  }

  private updateCharge(s: Slot, dt: number, held: boolean): void {
    const { audio, input, viewmodel } = this.ctx;
    const t = TUNING.lance;
    if (held && this.chargeLevel === 0 && !input.pressed('fire')) return;
    if (held && (s.cooldown > 0 || !this.canShoot(s))) {
      if (input.pressed('fire') && !this.canShoot(s)) this.dryFire();
      return;
    }
    if (held) {
      if (input.pressed('aim') && this.chargeLevel > 0) {
        this.cancelCharge();
        audio.play('railgun_fizzle');
        return;
      }
      if (this.chargeLevel === 0) audio.play('railgun_charge');
      this.chargeLevel = Math.min(1, this.chargeLevel + dt / t.chargeTime);
      if (this.chargeLevel >= 1) {
        if (!this.chargeFull) audio.play('railgun_ready');
        this.chargeFull = true;
        this.setLoop('railgun_charge_loop');
      }
      viewmodel.setCharge(this.chargeLevel);
      return;
    }
    if (this.chargeLevel <= 0) return;
    const level = this.chargeLevel;
    this.cancelCharge();
    if (level < t.minCharge) {
      audio.play('railgun_fizzle');
      return;
    }
    this.shootLance(s, level);
    s.cooldown = this.interval(s.def);
  }

  private cancelCharge(): void {
    this.chargeLevel = 0;
    this.chargeFull = false;
    this.endContinuous();
    this.ctx.viewmodel.setCharge(0);
  }

  private spinDown(dt: number): void {
    if (this.spin <= 0) return;
    this.spin = Math.max(0, this.spin - dt / TUNING.buzzsaw.spinDown);
    this.ctx.viewmodel.setCharge(this.spin);
    if (this.spinning) {
      this.spinning = false;
      this.endContinuous();
      this.ctx.audio.play('minigun_spindown');
    }
  }

  private updateSpin(s: Slot, dt: number, held: boolean): void {
    const { audio, input, viewmodel } = this.ctx;
    const t = TUNING.buzzsaw;
    const wants = held || input.isDown('aim');
    if (!wants || (!this.canShoot(s) && !held)) {
      this.spinDown(dt);
      return;
    }
    if (!this.spinning) {
      this.spinning = true;
      audio.play('minigun_spinup');
    }
    this.setLoop('minigun_spin_loop');
    this.spin = Math.min(1, this.spin + dt / t.spinUp);
    viewmodel.setCharge(this.spin);
    if (!held || this.spin < t.fireAt) {
      this.setFireLoop(null);
      return;
    }
    if (!this.canShoot(s)) {
      this.setFireLoop(null);
      this.dryFire();
      return;
    }
    this.setFireLoop('minigun_fire_loop');
    const rate = lerp(t.minRate, 1, invLerp(t.fireAt, 1, this.spin));
    const interval = this.interval(s.def) / rate;
    while (s.cooldown <= 0 && this.canShoot(s)) {
      this.shootGun(s, false);
      s.cooldown += interval;
    }
  }

  private updateStream(s: Slot, dt: number, held: boolean): void {
    const c = this.ctx;
    if (!held || !this.canShoot(s)) {
      if (this.streamOn) {
        this.streamOn = false;
        this.endContinuous();
        c.audio.play('flame_stop');
      }
      if (held) this.dryFire();
      if (s.cooldown < 0) s.cooldown = 0;
      return;
    }
    if (!this.streamOn) {
      this.streamOn = true;
      c.audio.play('flame_ignite');
      this.setLoop('flame_loop');
    }
    this.muzzle(false);
    c.fx.flame(this.muzzleAt, c.player.forward, 1);
    const interval = this.interval(s.def);
    while (s.cooldown <= 0 && this.canShoot(s)) {
      this.shootFlame(s);
      s.cooldown += interval;
    }
  }

  private setLoop(id: string): void {
    if (this.loopKind === id) return;
    this.loop?.stop(0.08);
    this.loopKind = id;
    this.loop = this.ctx.audio.startLoop?.(id) ?? null;
  }

  private setFireLoop(id: string | null): void {
    if (id === null) {
      this.fireLoop?.stop(0.06);
      this.fireLoop = null;
      return;
    }
    if (!this.fireLoop) this.fireLoop = this.ctx.audio.startLoop?.(id) ?? null;
  }

  private endContinuous(): void {
    this.loop?.stop(0.1);
    this.loop = null;
    this.loopKind = '';
    this.setFireLoop(null);
    this.streamOn = false;
  }

  /** Writes the muzzle to `muzzleAt`, starting from a sane guess so a missing viewmodel still draws tracers. */
  private muzzle(left: boolean): THREE.Vector3 {
    const { player, viewmodel } = this.ctx;
    this.muzzleAt.copy(player.eye).addScaledVector(player.forward, 0.6);
    this.muzzleAt.y -= 0.18;
    viewmodel.muzzle(this.muzzleAt, left);
    return this.muzzleAt;
  }

  /**
   * Where to hand fx a player muzzle flash. fx lifts anything near the camera into the view scene through render.camera,
   * but CameraRig has not run yet this frame, while the rig's muzzle is already placed for the player's new pose. That
   * mismatch is a whole frame of motion: at 17 m/s, or mid-flick, the star lands far from the gun. So this takes the
   * muzzle back to its offset from the eye, then re-applies it to the camera as it stands, which is the one point fx's
   * lift returns to the gun exactly. The world parts of the flash (light, wisp, sparks) land a frame behind, unseen.
   *
   * fx.muzzleFlash's `view` flag cannot do this job: it would also spawn those world parts at view-scene coordinates.
   */
  private flashPoint(at: THREE.Vector3): THREE.Vector3 {
    const { render, player } = this.ctx;
    const cam = render.camera;
    this.flashEuler.set(
      player.pitch + cam.rotation.x - this.rigPitch,
      player.yaw + wrapAngle(cam.rotation.y - this.rigYaw),
      cam.rotation.z,
    );
    this.flashTurn.setFromEuler(this.flashEuler).invert();
    return this.flashAt.copy(at).sub(player.eye).sub(cam.position).add(this.rigEye)
      .applyQuaternion(this.flashTurn).applyMatrix4(cam.matrixWorld);
  }

  private layerSounds(layers: readonly SoundLayer[]): void {
    const p = this.playOptions;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!;
      p.volume = l.volume ?? 1;
      p.pitch = l.pitch ?? 1;
      p.pitchJitter = l.pitchJitter ?? 0;
      this.ctx.audio.play(l.id, p);
    }
    p.volume = p.pitch = 1;
    p.pitchJitter = 0;
    // One layer per perk per trigger pull, however many pellets left the barrel.
    const extra = this.modifiers.shotLayers;
    for (let i = 0; i < extra.length; i++) this.ctx.audio.play(extra[i]!);
  }

  /** The shared frame-of-the-shot beats: flash, light, sound, recoil, shake, brass, event. */
  private shotFeedback(def: WeaponDef, left: boolean, strength = 1): void {
    const c = this.ctx;
    const { player } = c;
    const fwd = player.forward;
    const at = this.muzzle(left);
    c.fx.muzzleFlash(this.flashPoint(at), this.flashDir.set(0, 0, -1).applyQuaternion(c.render.camera.quaternion), def.muzzle);
    this.layerSounds(def.sounds);
    c.viewmodel.fire(def.recoil * strength, left);
    if (def.kick > 0) {
      const side = left ? -1 : 1;
      c.camera.kick(def.kick * strength, (Math.random() - 0.5) * def.kick * 0.6 * side, 0);
    }
    this.combat.feel.shake(def.shake * strength);
    if (def.fovPunch > 0) c.camera.fovPunch(def.fovPunch * strength, 0.12);
    if (def.casing) this.eject(def);

    const e = this.firedEvent;
    e.weapon = def.id;
    e.origin.copy(player.eye);
    e.dir.copy(fwd);
    c.events.emit('weapon:fired', e);
  }

  private eject(def: WeaponDef): void {
    const c = this.ctx;
    const { player } = c;
    const port = this.v.copy(this.muzzleAt);
    c.viewmodel.ejectPort(port);
    this.right.crossVectors(player.forward, UP).normalize();
    const out = this.w.copy(player.velocity).addScaledVector(this.right, 2.6).addScaledVector(UP, 2.4);
    c.fx.shellCasing(port, out, def.casing!);
  }

  private fillShot(def: WeaponDef, damage: number): ShotSpec {
    const m = this.modifiers;
    const s = this.shot;
    const explosive = m.explosiveRounds;
    s.damage = explosive ? damage * TUNING.hellfireRounds.damageMult : damage;
    s.source = def.id;
    s.team = 'player';
    s.maxDistance = undefined;
    s.tracer = m.tracer ?? def.tracer;
    s.pierce = 0;
    s.force = def.force;
    s.severMult = m.alwaysSever ? 1000 : def.severMult;
    s.blastRadius = explosive ? TUNING.hellfireRounds.radius : undefined;
    s.ricochet = m.ricochet;
    s.shock = m.shockRounds;
    s.headshotMult = def.headshotMult;
    s.tracerFrom = this.muzzleAt;
    s.type = def.pellets > 1 ? 'pellet' : 'bullet';
    s.gib = false;
    s.killStop = 0;
    s.impactScale = 1;
    s.headHops = 0;
    s.penetrate = 0;
    s.cleave = 0;
    return s;
  }

  private shootGun(s: Slot, left: boolean): void {
    const def = s.def;
    this.consume(s);
    this.shotFeedback(def, left);
    switch (def.id) {
      case 'rocket': this.shootRocket(def); return;
      case 'autocannon': this.shootShell(def); return;
      case 'stakegun': this.shootStake(def); return;
    }
    const c = this.ctx;
    const eye = c.player.eye;
    const fwd = c.player.forward;
    const m = this.modifiers;
    const shot = this.fillShot(def, def.damage * m.damage);
    const pellets = Math.round(def.pellets * (def.id === 'shotgun' ? m.pellets : 1));
    if (def.id === 'shotgun') {
      shot.killStop = HIT_STOP.shotgunKill;
      const t = TUNING.shotgun;
      // One probe per trigger pull: a point-blank blast is a different event from a pellet at range.
      const near = c.enemies.raycast(eye, fwd, t.pointBlank);
      if (near) {
        shot.severMult = (shot.severMult ?? 1) * t.pointBlankSever;
        shot.force = def.force * t.pointBlankForce;
        shot.killStop = HIT_STOP.shotgunPointBlank;
      }
    } else if (def.id === 'judge') {
      shot.headHops = TUNING.judge.ricochets + m.ricochet;
      shot.killStop = HIT_STOP.heavyKill;
      shot.impactScale = 1.6;
    }
    for (let i = 0; i < pellets; i++) {
      const dir = def.spread > 0 ? randomInCone(fwd, def.spread, this.dir) : fwd;
      this.combat.fireRay(eye, dir, shot);
    }
  }

  private readonly projectile: ProjectileSpec = {
    origin: new THREE.Vector3(), velocity: new THREE.Vector3(), kind: 'rocket', team: 'player', damage: 0, source: '',
  };

  /** A projectile that truly starts on the eye line, so it lands under the crosshair, but is drawn from the muzzle. */
  private fillProjectile(kind: ProjectileSpec['kind'], def: WeaponDef, speed: number, damage: number, trail: ProjectileTrail): ProjectileSpec {
    const { player } = this.ctx;
    const p = this.projectile;
    p.origin.copy(player.eye).addScaledVector(player.forward, 0.25);
    p.velocity.copy(player.forward).multiplyScalar(speed);
    p.kind = kind;
    p.damage = damage;
    p.source = def.id;
    p.explosion = undefined;
    p.gravity = undefined;
    p.lifetime = undefined;
    p.tracer = undefined;
    p.homing = undefined;
    p.fuse = undefined;
    p.trail = trail;
    p.gib = false;
    p.severMult = this.modifiers.alwaysSever ? 1000 : def.severMult;
    p.force = def.force;
    p.headshotMult = def.headshotMult;
    p.killStop = 0;
    p.silent = false;
    p.visualFrom = this.muzzleAt;
    return p;
  }

  private shootRocket(def: WeaponDef): void {
    const m = this.modifiers;
    const hell = m.instakillBlast;
    const kind: ExplosionKind = hell ? 'hellfire' : 'rocket';
    const damage = def.damage * m.damage;
    const p = this.fillProjectile('rocket', def, TUNING.rocket.speed, damage, hell ? 'hellfire' : 'smoke');
    p.gib = true;
    p.killStop = HIT_STOP.heavyKill;
    p.explosion = {
      radius: TUNING.rocket.radius * m.blastRadius, damage, kind, instakill: hell, playerPush: TUNING.rocket.playerPush,
    };
    this.combat.spawnProjectile(p);
  }

  private shootShell(def: WeaponDef): void {
    const t = TUNING.autocannon;
    const p = this.fillProjectile('shell', def, t.speed, def.damage, 'rings');
    p.killStop = HIT_STOP.heavyKill;
    p.gib = true;
    p.explosion = { radius: t.radius, damage: def.damage, kind: 'shell', instakill: true, selfDamage: 0 };
    this.combat.spawnProjectile(p);
  }

  private shootStake(def: WeaponDef): void {
    const t = TUNING.stake;
    const damage = def.damage * this.modifiers.damage;
    const p = this.fillProjectile('stake', def, t.speed, damage, 'none');
    p.gravity = t.gravity;
    p.killStop = HIT_STOP.stakeKill;
    if (this.modifiers.explosiveRounds) p.explosion = { radius: TUNING.hellfireRounds.radius, damage, kind: 'hellfireBullet' };
    this.combat.spawnProjectile(p);
  }

  private shootFlame(s: Slot): void {
    const c = this.ctx;
    const def = s.def;
    const k = TUNING.kiln;
    this.consume(s);
    const p = this.fillProjectile('flame', def, k.speed, def.damage * this.modifiers.damage, 'none');
    p.velocity.addScaledVector(c.player.velocity, 0.6);
    p.lifetime = k.life;
    p.gravity = 2.5;
    p.silent = true;
    c.viewmodel.fire(def.recoil, false);
    this.combat.feel.shake(def.shake);
    this.combat.spawnProjectile(p);
    const e = this.firedEvent;
    e.weapon = def.id;
    e.origin.copy(c.player.eye);
    e.dir.copy(c.player.forward);
    c.events.emit('weapon:fired', e);
  }

  private shootLance(s: Slot, level: number): void {
    const c = this.ctx;
    const def = s.def;
    const t = TUNING.lance;
    const m = this.modifiers;
    this.consume(s);
    // The kick follows the square of the charge, so a full shot is worth the wait in the hands, not only in damage.
    const weight = lerp(0.35, 1, level * level);
    this.shotFeedback(def, false, weight);
    const shot = this.fillShot(def, lerp(t.minDamage, def.damage, level * level) * m.damage);
    shot.pierce = t.maxTargets;
    shot.tracer = undefined;
    shot.force = def.force * weight;
    shot.killStop = HIT_STOP.lanceKill;
    shot.penetrate = level >= 1 ? t.penetration : 0;
    shot.cleave = level >= 1 ? t.cleave : 0;
    shot.impactScale = 1.4;
    const end = this.combat.fireRay(c.player.eye, c.player.forward, shot);
    if (end.kills > 1) {
      this.combat.feel.stop(Math.min(HIT_STOP.lanceKill + (end.kills - 1) * HIT_STOP.lancePerExtraKill, HIT_STOP.lanceMax), true);
    }
    c.fx.beam(this.muzzleAt, end.end, 'rail', 0.05 + 0.08 * level, 0.3 + 0.35 * level);
    c.render.post.chromatic(0.3 * weight, 0.14);
    if (level >= 1) c.render.post.radialBlur(0.16, 0.14);
  }

  /**
   * Slowdown is written to velocity, not modifiers.speed, because progression rewrites that field every frame. The
   * player runs at 120 Hz and wins speed back between two clamps of this one, so the clamp sits half a frame's regain
   * under the target. That keeps the average on the target at any frame rate.
   */
  private applyHandling(dt: number): void {
    if (this.current !== 'buzzsaw' || this.spin <= 0.05) return;
    const t = TUNING.buzzsaw;
    const { player } = this.ctx;
    const v = player.velocity;
    const speed = Math.hypot(v.x, v.z);
    const scale = player.modifiers.speed;
    const target = MOVE.runSpeed * scale * lerp(1, t.moveSpeed, this.spin);
    if (speed < 1e-3) return;
    let next: number;
    if (player.grounded && !player.sliding) next = Math.min(speed, Math.max(target - MOVE.groundAccel * scale * dt * 0.5, 0));
    else if (speed > target) next = damp(speed, target, t.airDrag, dt);
    else return;
    const k = next / speed;
    v.x *= k;
    v.z *= k;
  }

  // -------------------------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------------------------

  private updateZoom(): void {
    const c = this.ctx;
    const t = TUNING.autocannon;
    if (this.current === 'autocannon' && c.input.pressed('aim') && !this.reloading && this.drawLeft <= 0) {
      this.zoomed = !this.zoomed;
      c.audio.play('autocannon_zoom');
      c.camera.setZoom(this.zoomed ? t.scopeFov : null);
    }
    this.zoom = damp(this.zoom, this.zoomed ? 1 : 0, t.zoomRate, c.time.realDt);
    const shown = this.zoomed && this.zoom > t.scopeShowAt;
    if (shown !== this.scopeShown) {
      this.scopeShown = shown;
      c.viewmodel.setScoped(shown);
    }
  }

  private clearScope(audible: boolean): void {
    if (this.zoomed && audible) this.ctx.audio.play('autocannon_zoom');
    this.zoomed = false;
    this.zoom = 0;
    if (this.scopeShown) this.ctx.viewmodel.setScoped(false);
    this.scopeShown = false;
    this.ctx.camera.setZoom(null);
  }

  // -------------------------------------------------------------------------------------------
  // Quick melee
  // -------------------------------------------------------------------------------------------

  private startQuickMelee(): void {
    const { viewmodel } = this.ctx;
    this.endContinuous();
    this.cancelReload();
    this.clearScope(false);
    this.chargeLevel = 0;
    this.chargeFull = false;
    viewmodel.setCharge(0);
    viewmodel.equip('sword', 0.02);
    this.sword.quickStrike();
  }

  private afterQuick(): void {
    const def = WEAPONS[this.current];
    this.ctx.viewmodel.equip(this.current, def.drawTime);
    this.quickReturn = SWORD.quickMelee.recover;
  }

  // -------------------------------------------------------------------------------------------
  // Grenades
  // -------------------------------------------------------------------------------------------

  private updateGrenade(dt: number): void {
    const { audio, input } = this.ctx;
    const t = TUNING.grenade;
    if (!this.cooking) {
      if (input.pressed('grenade') && this.grenades > 0) {
        this.cooking = true;
        this.cookLeft = t.fuse;
        this.cookCue = 0;
        this.grenades--;
        audio.play('grenade_pin');
      }
      return;
    }
    this.cookLeft -= dt;
    this.cookCue += dt;
    if (this.cookCue >= t.cookSound) {
      this.cookCue = 0;
      audio.play('bomber_beep', { volume: 0.5 });
    }
    if (this.cookLeft <= 0) {
      // Held too long. It goes off in the hand, and the blast rules decide what that costs.
      this.cooking = false;
      this.throwGrenade(0.02, 0);
      return;
    }
    if (!input.isDown('grenade')) {
      this.cooking = false;
      this.throwGrenade(this.cookLeft, 1);
    }
  }

  private throwGrenade(fuse: number, strength: number): void {
    const c = this.ctx;
    const t = TUNING.grenade;
    const { player } = c;
    const p = this.projectile;
    // The hand reaches past the capsule, so against a wall it must stop short or the frag starts on the far side.
    const wall = c.physics.raycast(player.eye, player.forward, 0.65, CG.World);
    p.origin.copy(player.eye).addScaledVector(player.forward, wall ? Math.max(wall.distance - 0.15, 0) : 0.5);
    p.origin.y -= 0.15;
    p.velocity.copy(player.forward).multiplyScalar(t.throwSpeed * strength);
    p.velocity.y += t.throwUp * strength;
    p.velocity.addScaledVector(player.velocity, t.inherit);
    p.kind = 'grenade';
    p.damage = t.damage;
    p.source = 'grenade';
    p.gravity = t.gravity;
    p.fuse = fuse;
    p.lifetime = fuse + 1;
    p.trail = 'none';
    p.explosion = { radius: t.radius, damage: t.damage * this.modifiers.damage, kind: 'grenade' };
    p.visualFrom = undefined;
    p.homing = undefined;
    p.silent = false;
    this.combat.spawnProjectile(p);
    if (strength > 0) c.audio.play('grenade_throw');
  }
}
