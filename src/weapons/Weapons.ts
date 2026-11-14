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
  AmmoState, MissileTarget, PaintView, ProjectileSpec, ProjectileTrail, ShotSpec, WeaponId, WeaponModifiers, WeaponSystem,
} from '../core/gameplay';
import { clamp, damp, invLerp, lerp, randomInCone, wrapAngle } from '../core/math';
import { MOVE } from '../player/tuning';
import type { Combat, Guard, GuardResult } from './Combat';
import { HIT_STOP, STARTING_WEAPONS, SWORD, TUNING, WEAPONS, WEAPON_ORDER, type SoundLayer, type WeaponDef } from './data';
import { familyOf, familyOfSlot, membersOf, pressSlot, wheelSlot } from './families';
import { Handling, holdSpeed } from './handling';
import { PIERCE_ON } from './penetration';
import { Painter, angleOff, type PaintCandidate } from './swarm';
import { isMelee } from './melee/data';
import { Melee } from './melee/Melee';
import { LANCE_ON, Lance } from './lance';

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
/** `?reach=0` takes range falloff out of every gun: the SMG and the Rivet hit as hard at 100 m as at 10. */
const REACH_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('reach') !== '0';
/** Seconds a rate boost cuts off a reload. Capped so Berserk does not turn reloads into a blink. */
const MAX_RELOAD_BOOST = 1.5;
/** `?climb=0` takes the real climb out of every gun that has one (the Thresher): its aim stays where it was put. */
const CLIMB_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('climb') !== '0';
/** Targets one paint look considers at most. */
const MAX_IN_VIEW = 32;
/** The spin loop's pitch with the barrels barely turning, as a share of its pitch at full spin. */
const SPIN_PITCH = 0.45;
/** Seconds of `minigun_spindown` that are the run-down from full spin, before the cluster stops. See its recipe. */
const SPIN_RUNDOWN = 1.1;
/** Seconds between two reports in `minigun_fire_loop`: a gun firing faster than that (`?slot8=old`) plays it faster. */
const FIRE_LOOP_STEP = 0.04;

export class Weapons implements WeaponSystem, Guard {
  current: WeaponId = 'smg';
  readonly owned = new Set<WeaponId>();
  grenades: number = TUNING.grenade.start;
  modifiers: WeaponModifiers = {
    damage: 1, fireRate: 1, bottomlessMag: false, pellets: 1, explosiveRounds: false, blastRadius: 1, instakillBlast: false,
    akimbo: false, ricochet: 0, shockRounds: false, alwaysSever: false, tracer: null, shotLayers: [],
  };

  private readonly slots: Record<WeaponId, Slot>;
  /** Every weapon on key 5, the katana and its family: src/weapons/melee. */
  private readonly sword: Melee;
  /** Slot 7's gun: tap for a plasma ball, hold for a beam. `?lance=old` leaves it idle and `updateCharge` fires instead. */
  readonly lance: Lance;
  private lastWeapon: WeaponId = 'shotgun';
  /** The gun a sword kill feeds: whatever was in hand before the blade came out. */
  private lastGun: WeaponId = 'smg';
  private pendingSwitch: WeaponId | null = null;
  /** The member last held on each number key, which is the one the key draws. */
  private readonly slotLast = new Map<number, WeaponId>();
  private readonly recall = (slot: number): WeaponId | undefined => this.slotLast.get(slot);
  private drawLeft = 0;
  private holstered = false;

  private reloadLeft = 0;
  private reloadTotal = 0;
  private reloadCue = 0;
  /** Seconds since the last shot of a hand-cycled gun, and its next `cycleFoley` cue. Negative when nothing is due. */
  private cycleAt = -1;
  private cycleCue = 0;
  private cycleGun: WeaponId | null = null;
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
  /** How much of a heavy gun's firing slowdown is on, and the cap it puts on the player's speed. See handling.ts. */
  private readonly handling = new Handling();
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
  /** Seconds left of `occupy`. */
  private occupied = 0;

  /** The Quiver: marks laid while the trigger is held, and the salvo that leaves when it lets go. */
  private readonly painter = new Painter(TUNING.quiver.paintEvery);
  private readonly salvoTargets: (MissileTarget | null)[] = [];
  private salvoLeft = 0;
  private salvoShot = 0;
  private salvoClock = 0;
  private salvoDumb = false;
  private readonly inView: PaintCandidate[] = [];
  private readonly candidatePool: PaintCandidate[] = [];
  private readonly paintables: MissileTarget[] = [];
  private readonly look = (): readonly PaintCandidate[] => this.gatherInView();

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
    this.sword = new Melee(ctx, this.combat, this.modifiers);
    // The Lance's trigger, its beams and its bursts are lance.ts. This is all it needs of the arsenal.
    this.lance = new Lance(ctx, {
      modifiers: this.modifiers,
      muzzleAt: this.muzzleAt,
      canShoot: s => this.canShoot(s),
      consume: (s, rounds) => this.consume(s, rounds),
      takePress: () => {
        if (this.pressBuffer <= 0) return false;
        this.pressBuffer = 0;
        return true;
      },
      dry: () => this.dryFire(),
      feedback: (def, strength) => this.shotFeedback(def, false, strength),
      shot: (def, damage) => this.fillShot(def, damage),
      projectile: (kind, def, speed, damage, trail) => this.fillProjectile(kind, def, speed, damage, trail),
      interval: def => this.interval(def),
    });
    for (const id of STARTING_WEAPONS) this.own(id);
  }

  /** Adds a weapon and the family members that come with it. Returns true when the weapon itself is new. */
  private own(id: WeaponId): boolean {
    const fresh = !this.owned.has(id);
    this.owned.add(id);
    const members = membersOf(id);
    for (let i = 0; i < members.length; i++) {
      const member = members[i]!;
      if (this.owned.has(member)) continue;
      this.owned.add(member);
      const s = this.slots[member];
      s.ammo.mag = s.def.magSize;
      s.ammo.reserve = s.def.reserve;
    }
    return fresh;
  }

  slotMember(slot: number): WeaponId {
    const family = familyOfSlot(slot);
    const last = this.slotLast.get(slot);
    if (last !== undefined && this.owned.has(last)) return last;
    for (let i = 0; i < family.length; i++) if (this.owned.has(family[i]!)) return family[i]!;
    return family[0] ?? this.current;
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
      if (e.damage.source.startsWith('sword') || isMelee(e.damage.source)) this.feedGun();
    });
    events.on('wave:clear', () => this.liftReserves());
    this.ctx.viewmodel.equip?.(this.current, 0.01);
  }

  reset(): void {
    this.stopEverything();
    this.owned.clear();
    this.slotLast.clear();
    for (const id of STARTING_WEAPONS) this.own(id);
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
    this.occupied = 0;
    this.sword.reset();
    this.lance.reset();
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
    const mode = WEAPONS[this.current].mode;
    return mode === 'spin' ? this.spin : mode === 'charge' && LANCE_ON ? this.lance.level : this.chargeLevel;
  }

  /** The blade is out: the weapon in hand is swung, not fired. */
  private get bladeOut(): boolean {
    return WEAPONS[this.current].mode === 'melee';
  }

  /** Crosshair openness. Guns here are accurate, so only the pellet cone and the minigun's wobble show. */
  get spread(): number {
    const def = WEAPONS[this.current];
    return clamp(def.spread / 0.06);
  }

  get swordStep(): number {
    return this.sword.step;
  }

  /** The Quiver's marks while it is in hand. */
  get paint(): PaintView | undefined {
    return WEAPONS[this.current].mode === 'paint' ? this.painter : undefined;
  }

  ammo(id: WeaponId = this.current): AmmoState {
    return this.slots[id].ammo;
  }

  give(id: WeaponId): void {
    if (this.owned.has(id)) {
      this.addReserve(this.slots[id], 0.5);
      // A second cache of a gun tops up what came with it too.
      const members = membersOf(id);
      for (let i = 0; i < members.length; i++) this.addReserve(this.slots[members[i]!], 0.5);
      this.own(id);
      return;
    }
    this.own(id);
    const s = this.slots[id];
    s.ammo.mag = s.def.magSize;
    s.ammo.reserve = s.def.reserve;
    this.ctx.events.emit('weapon:unlocked', { weapon: id });
    // The banner is the base weapon's. What came with it gets a line in the feed, with the one thing to know about it.
    const members = membersOf(id);
    for (let i = 0; i < members.length; i++) {
      this.ctx.hud.feed(`${WEAPONS[members[i]!].name}: PRESS ${s.def.slot} AGAIN`, '#39e0ff');
    }
    // An upgrade that lands on a key already in use (the autocannon beside the Sabot) says how to reach it, too.
    const family = familyOfSlot(s.def.slot);
    if (members.length === 0 && family.some(other => other !== id && this.owned.has(other))) {
      this.ctx.hud.feed(`${s.def.name}: PRESS ${s.def.slot} AGAIN`, '#39e0ff');
    }
  }

  setLoadout(weapons: readonly WeaponId[], grenades: number): void {
    this.stopEverything();
    this.owned.clear();
    this.slotLast.clear();
    for (const id of weapons) this.own(id);
    this.grenades = grenades;
    const first = weapons[0]!;
    const gun = weapons.find(id => WEAPONS[id].mode !== 'melee') ?? first;
    this.current = first;
    this.lastWeapon = weapons[1] ?? first;
    this.lastGun = gun;
    // A key draws the first weapon the loadout names on it, so a mission that hands out the autocannon gets the
    // autocannon on 4, not the Sabot that now comes first there.
    for (const id of weapons) if (!this.slotLast.has(WEAPONS[id].slot)) this.slotLast.set(WEAPONS[id].slot, id);
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
    const id = this.bladeOut ? this.lastGun : this.current;
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

  occupy(seconds: number): void {
    if (this.cooking) this.throwGrenade(this.cookLeft, 1);
    this.stopEverything();
    this.occupied = seconds;
  }

  guard(incoming: THREE.Vector3): GuardResult {
    return this.bladeOut ? this.sword.guard(incoming) : 'none';
  }

  /** Stops every continuous thing. Called on death, pause and holster, so nothing keeps roaring in a menu. */
  private stopEverything(): void {
    this.stopPaint();
    this.endContinuous();
    this.clearScope(false);
    this.cancelReload();
    this.sword.cancel();
    this.cooking = false;
    this.chargeLevel = 0;
    this.chargeFull = false;
    this.spin = 0;
    this.spinning = false;
    this.handling.reset();
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
    // The bursts a Lance beam booked go off whatever is in hand now, dead or holstered included.
    this.lance.tick();
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
    if (this.occupied > 0) {
      this.occupied -= dt;
      return;
    }
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

    if (this.bladeOut) {
      // A loadout or a reset can put a blade in hand without a draw: the swings are always the ones of the weapon held.
      this.sword.equip(this.current);
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
      // The key of the slot in hand steps through its family. Any other key draws what was last held there.
      const id = pressSlot(i, this.pendingSwitch ?? this.current, this.owned, this.slotLast.get(i));
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

  /** The wheel walks number keys, not weapons: each notch lands on the member last held on the next key along. */
  private cycle(step: number): void {
    const id = wheelSlot(this.current, step, this.owned, this.recall);
    if (id) this.switchTo(id);
  }

  switchTo(id: WeaponId): void {
    if (id === this.current || !this.owned.has(id)) return;
    // The blast is already swung. Taking it away now is the first game's slam sound with no slam.
    if (this.sword.committed) {
      this.pendingSwitch = id;
      return;
    }
    const from = this.current;
    this.stopPaint();
    this.endContinuous();
    this.clearScope(false);
    this.cancelReload();
    this.sword.cancel();
    this.chargeLevel = 0;
    this.chargeFull = false;
    this.spin = 0;
    this.spinning = false;
    this.handling.reset();
    this.pressBuffer = 0;
    this.autoReload = -1;
    this.drySwap = -1;
    this.quickReturn = 0;
    this.current = id;
    this.slotLast.set(WEAPONS[id].slot, id);
    this.lastWeapon = from;
    if (WEAPONS[from].mode !== 'melee') this.lastGun = from;
    this.ctx.viewmodel.setCharge(0);
    this.beginDraw(id);
    this.ctx.events.emit('weapon:switched', { from, to: id });
    if (this.ammoEmpty(id)) this.autoReload = TUNING.autoReloadDelay;
  }

  private beginDraw(id: WeaponId): void {
    const def = WEAPONS[id];
    this.drawLeft = def.drawTime;
    if (def.mode === 'melee') this.sword.equip(id);
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
    // A salvo in the air finishes before the tubes are opened.
    if (this.salvoLeft > 0) return false;
    this.stopPaint();
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

  private updateCycle(dt: number): void {
    if (this.cycleAt < 0) return;
    const cues = this.cycleGun === this.current ? WEAPONS[this.current].cycleFoley : undefined;
    // Put away mid-cycle: the hand never finished the pump, so neither does the sound.
    if (!cues || this.cycleCue >= cues.length) {
      this.cycleAt = -1;
      return;
    }
    this.cycleAt += dt;
    while (this.cycleCue < cues.length && this.cycleAt >= cues[this.cycleCue]![0]) this.ctx.audio.play(cues[this.cycleCue++]![1]);
  }

  private updateReload(dt: number): void {
    this.updateCycle(dt);
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
      case 'charge':
        if (LANCE_ON) this.lance.update(s, dt, held);
        else this.updateCharge(s, dt, held);
        break;
      case 'spin': this.updateSpin(s, dt, held); break;
      case 'stream': this.updateStream(s, dt, held); break;
      case 'paint': this.updatePaint(s, dt, held); break;
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

  /**
   * The gun on the same key first, so a dry Harrow hands over to the SMG beside it and not to whatever heads the list. Then
   * the list, which is base weapons, each one's family members taking their turn straight after it.
   */
  private nextLoaded(): WeaponId {
    const own = familyOf(this.current);
    for (let k = 0; k < own.length; k++) if (own[k] !== this.current && this.hasRounds(own[k]!)) return own[k]!;
    const order = TUNING.ammo.fallback;
    for (let i = 0; i < order.length; i++) {
      const base = order[i]!;
      if (this.hasRounds(base)) return base;
      const members = membersOf(base);
      for (let k = 0; k < members.length; k++) if (this.hasRounds(members[k]!)) return members[k]!;
    }
    return 'sword';
  }

  private hasRounds(id: WeaponId): boolean {
    if (!this.owned.has(id)) return false;
    const a = this.slots[id].ammo;
    return a.magSize === 0 || a.mag > 0 || a.reserve > 0;
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
      this.ceaseFire();
      this.endContinuous();
      // The run-down is written from full spin over SPIN_RUNDOWN seconds. A gun let go part way up starts it part way down.
      this.ctx.audio.play('minigun_spindown', { volume: lerp(0.5, 1, this.spin), offset: (1 - this.spin) * SPIN_RUNDOWN });
    }
  }

  /** The barrage stops: the loop is cut and the last round rolls off, so a burst ends on a report and not on a fade. */
  private ceaseFire(): void {
    if (!this.fireLoop) return;
    this.setFireLoop(null);
    this.ctx.audio.play('minigun_fire');
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
    // The drive is heard coming up with the barrels: the loop is written at full speed and turned with them.
    this.loop?.setPitch(lerp(SPIN_PITCH, 1, this.spin), 0.04);
    this.loop?.setVolume(lerp(0.45, 1, this.spin), 0.04);
    if (!held || this.spin < t.fireAt) {
      this.ceaseFire();
      return;
    }
    if (!this.canShoot(s)) {
      this.ceaseFire();
      this.dryFire();
      return;
    }
    this.setFireLoop('minigun_fire_loop');
    const rate = lerp(t.minRate, 1, invLerp(t.fireAt, 1, this.spin));
    // The loop is cut to the full rate. Turned with the rate, the barrage is heard winding up into it, and a perk that
    // speeds the gun speeds its sound.
    this.fireLoop?.setPitch(clamp((rate * this.modifiers.fireRate * FIRE_LOOP_STEP) / s.def.interval, 0.4, 2), 0.05);
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
    // Everything that ends a loop ends a Lance charge too: a switch, a reload, a melee, a pause, a death.
    this.lance.cancel();
    this.loop?.stop(0.1);
    this.loop = null;
    this.loopKind = '';
    this.setFireLoop(null);
    this.streamOn = false;
  }

  /** Writes the muzzle to `muzzleAt`, starting from a sane guess so a missing viewmodel still draws tracers. */
  private muzzle(left: boolean, barrel = 0): THREE.Vector3 {
    const { player, viewmodel } = this.ctx;
    this.muzzleAt.copy(player.eye).addScaledVector(player.forward, 0.6);
    this.muzzleAt.y -= 0.18;
    viewmodel.muzzle(this.muzzleAt, left, barrel);
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
  private shotFeedback(def: WeaponDef, left: boolean, strength = 1, barrel = 0): void {
    const c = this.ctx;
    const { player } = c;
    const fwd = player.forward;
    const at = this.muzzle(left, barrel);
    c.fx.muzzleFlash(this.flashPoint(at), this.flashDir.set(0, 0, -1).applyQuaternion(c.render.camera.quaternion), def.muzzle);
    this.layerSounds(def.sounds);
    if (def.cycleFoley) {
      this.cycleAt = 0;
      this.cycleCue = 0;
      this.cycleGun = def.id;
    }
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
    s.severMult = m.alwaysSever ? 1000 : def.canSever ? def.severMult : 0;
    s.blastRadius = explosive ? TUNING.hellfireRounds.radius : undefined;
    s.ricochet = m.ricochet;
    s.shock = m.shockRounds;
    s.headshotMult = def.headshotMult;
    s.tracerFrom = this.muzzleAt;
    s.type = def.pellets > 1 ? 'pellet' : 'bullet';
    // A round heavy enough to burst what it kills does so by its row's odds, rolled a round.
    s.gib = def.gib !== undefined && Math.random() < def.gib;
    s.burst = def.burst;
    s.killStop = def.killStop ?? 0;
    s.impactScale = def.impactScale ?? 1;
    s.headHops = def.headHops ? def.headHops + m.ricochet : 0;
    s.penetrate = PIERCE_ON ? def.penetration : 0;
    s.bodyCost = def.bodyCost;
    s.penetrateKeep = undefined;
    s.penetrateWalls = undefined;
    s.armorPiercing = def.armorPiercing ?? false;
    s.falloff = REACH_ON ? def.falloff : undefined;
    s.cleave = 0;
    return s;
  }

  private shootGun(s: Slot, left: boolean): void {
    const def = s.def;
    this.consume(s);
    this.shotFeedback(def, left);
    if (def.slow !== undefined) this.handling.shot();
    if (def.climb && CLIMB_ON) this.climb(def.climb);
    // By what the row says leaves the barrel, never by which gun it is: a family member picks its own.
    switch (def.round) {
      case 'rocket': this.shootRocket(def); return;
      case 'shell': this.shootShell(def); return;
      case 'stake': this.shootStake(def); return;
    }
    const c = this.ctx;
    const eye = c.player.eye;
    const fwd = c.player.forward;
    const m = this.modifiers;
    const shot = this.fillShot(def, def.damage * m.damage);
    const scatter = def.pellets > 1;
    const pellets = Math.round(def.pellets * (scatter ? m.pellets : 1));
    if (scatter) {
      shot.killStop = HIT_STOP.shotgunKill;
      const t = TUNING.shotgun;
      // One probe per trigger pull: a point-blank blast is a different event from a pellet at range.
      const near = c.enemies.raycast(eye, fwd, t.pointBlank);
      if (near) {
        shot.severMult = (shot.severMult ?? 1) * t.pointBlankSever;
        shot.force = def.force * t.pointBlankForce;
        shot.killStop = HIT_STOP.shotgunPointBlank;
      }
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
    p.severMult = this.modifiers.alwaysSever ? 1000 : def.canSever ? def.severMult : 0;
    p.penetrate = 0;
    p.bodyCost = undefined;
    p.armorPiercing = false;
    p.force = def.force;
    p.headshotMult = def.headshotMult;
    p.killStop = 0;
    p.silent = false;
    p.visualFrom = this.muzzleAt;
    unguided(p);
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
    // The per-wall rule it always had: two walls, each up to `penetration` thick, of anything, at no cost in damage.
    // Bodies are the `pierce` above. `?pierce=0` does not reach here, as it never did.
    shot.penetrate = level >= 1 ? t.penetration : 0;
    shot.penetrateWalls = t.walls;
    shot.bodyCost = Infinity;
    shot.penetrateKeep = 1;
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
   * A heavy gun slows the player: a little while the rotary cannon's barrels turn, a lot while it or the heavy machine gun
   * fires (`slow` in the row). The rules, and what a dash, a slide and the other moves keep, are handling.ts.
   */
  private applyHandling(dt: number): void {
    const def = WEAPONS[this.current];
    const cap = this.handling.cap(dt, def, def.mode === 'spin' ? this.spin : 0);
    holdSpeed(this.ctx.player, cap, dt, this.handling);
  }

  /**
   * Real climb, on a gun whose row has it: the aim itself moves, up and to a random side, and stays there until the player
   * pulls it back. The camera's kick is on top and springs back as usual.
   */
  private climb(c: { readonly pitch: number; readonly yaw: number }): void {
    const p = this.ctx.player;
    p.pitch = clamp(p.pitch + c.pitch * (0.85 + Math.random() * 0.3), -1.55, 1.55);
    p.yaw += (Math.random() - 0.5) * 2 * c.yaw;
  }

  // -------------------------------------------------------------------------------------------
  // The Quiver: hold to paint, let go to fire
  // -------------------------------------------------------------------------------------------

  /** Rounds the next salvo can carry. */
  private salvoRounds(s: Slot): number {
    return this.modifiers.bottomlessMag ? TUNING.quiver.marks : Math.min(TUNING.quiver.marks, s.ammo.mag);
  }

  private updatePaint(s: Slot, dt: number, held: boolean): void {
    const { audio, input, viewmodel } = this.ctx;
    const p = this.painter;
    if (this.salvoLeft > 0) {
      this.stepSalvo(s, dt);
      return;
    }
    if (!p.painting) {
      if (this.pressBuffer <= 0 || s.cooldown > 0) return;
      if (!this.canShoot(s)) {
        this.dryFire();
        this.pressBuffer = 0;
        return;
      }
      this.pressBuffer = 0;
      p.begin(this.salvoRounds(s));
      audio.play('quiver_arm');
    }
    if (held) {
      // Right click lets go of the marks and keeps the missiles, as it lets go of a Lance charge.
      if (input.pressed('aim')) {
        this.stopPaint();
        audio.play('quiver_cancel');
        return;
      }
      const marked = p.update(dt, this.look);
      if (marked) {
        const n = p.marks.length;
        audio.play('quiver_lock', { pitch: 1 + (n - 1) * 0.16 });
        if (p.full) audio.play('quiver_full');
      }
      viewmodel.setCharge(p.max > 0 ? p.marks.length / p.max : 0);
      return;
    }
    this.launch(s);
  }

  /** The trigger let go: every mark becomes a missile, spares on the best of them, or a dumb salvo with none. */
  private launch(s: Slot): void {
    const n = this.salvoRounds(s);
    const aimed = this.painter.release(this.salvoTargets, n, this.gatherInView());
    this.ctx.viewmodel.setCharge(0);
    if (n <= 0) return;
    this.salvoLeft = n;
    this.salvoShot = 0;
    this.salvoClock = 0;
    this.salvoDumb = aimed === 0;
    this.stepSalvo(s, 0);
  }

  /** One tube after another, `interval` apart, on the player's clock. */
  private stepSalvo(s: Slot, dt: number): void {
    this.salvoClock -= dt;
    const gap = this.interval(s.def);
    while (this.salvoLeft > 0 && this.salvoClock <= 0) {
      if (!this.canShoot(s)) {
        this.salvoLeft = 0;
        break;
      }
      this.fireMissile(s, this.salvoShot);
      this.salvoShot++;
      this.salvoLeft--;
      this.salvoClock += gap;
    }
    if (this.salvoLeft > 0) return;
    s.cooldown = TUNING.quiver.recover;
    for (let i = 0; i < this.salvoTargets.length; i++) this.salvoTargets[i] = null;
  }

  private stopPaint(): void {
    if (this.painter.painting || this.salvoLeft > 0) this.ctx.viewmodel.setCharge(0);
    this.painter.cancel();
    this.salvoLeft = 0;
    for (let i = 0; i < this.salvoTargets.length; i++) this.salvoTargets[i] = null;
  }

  /** Everyone near the crosshair with a clear line to them, enemies and then vehicles. A ray each, only for those in the cone. */
  private gatherInView(): readonly PaintCandidate[] {
    const c = this.ctx;
    const out = this.inView;
    out.length = 0;
    const alive = c.enemies.alive;
    for (let i = 0; i < alive.length && out.length < MAX_IN_VIEW; i++) this.consider(alive[i]!);
    const v = c.enemies.vehicles;
    if (v && typeof v.paintable === 'function') {
      const n = v.paintable(this.paintables);
      for (let i = 0; i < n && out.length < MAX_IN_VIEW; i++) this.consider(this.paintables[i]!);
      this.paintables.length = 0;
    }
    return out;
  }

  private consider(target: MissileTarget): void {
    if (!target.alive) return;
    const c = this.ctx;
    const t = TUNING.quiver;
    const eye = c.player.eye;
    const at = this.v.copy(target.center);
    at.y += target.aimLift ?? 0;
    const angle = angleOff(eye, c.player.forward, at, t.range, Math.cos(t.cone));
    if (angle < 0) return;
    const dir = this.w.subVectors(at, eye);
    const dist = dir.length();
    dir.divideScalar(dist);
    // A painted mark is a line of sight: a wall in the way hides the target, its own hull does not.
    const wall = c.physics.raycast(eye, dir, dist, CG.World);
    if (wall && wall.distance < dist - (target.paintRadius ?? 0.6)) return;
    const k = this.inView.length;
    const slot = this.candidatePool[k] ?? (this.candidatePool[k] = { target, angle });
    slot.target = target;
    slot.angle = angle;
    this.inView.push(slot);
  }

  private fireMissile(s: Slot, index: number): void {
    const c = this.ctx;
    const def = s.def;
    const t = TUNING.quiver;
    const m = this.modifiers;
    // Tubes empty in order, top left, top right, bottom left, bottom right, so the one that fires is the first still loaded.
    const barrel = m.bottomlessMag ? index % 4 : clamp(def.magSize - s.ammo.mag, 0, 3);
    this.consume(s);
    this.shotFeedback(def, false, 1, barrel);
    this.backblast();

    const hell = m.instakillBlast;
    const damage = def.damage * m.damage;
    const p = this.fillProjectile('rocket', def, t.launchSpeed, damage, hell ? 'hellfire' : 'swarm');
    // Each tube points a little off the block's centre, so the four leave in a fan and then turn in.
    const fwd = c.player.forward;
    const right = this.right.crossVectors(fwd, UP).normalize();
    const up = this.w.crossVectors(right, fwd).normalize();
    const sx = barrel % 2 === 0 ? -1 : 1;
    const sy = barrel < 2 ? 1 : -1;
    const dir = this.dir.copy(fwd);
    if (this.salvoDumb) {
      // Centred a touch above the crosshair, so the low pair does not go into the floor a few metres out.
      dir.addScaledVector(right, sx * t.fan * 0.5).addScaledVector(up, (sy + 1) * t.fan * 0.4).normalize();
      randomInCone(dir, t.dumbSpread, dir);
    } else {
      // Aimed missiles climb a touch as they leave, so the swarm arcs onto its marks rather than skimming the floor.
      dir.addScaledVector(right, sx * t.fan).addScaledVector(up, sy * t.fan * 0.7 + t.fan * 0.6).normalize();
    }
    p.velocity.copy(dir).multiplyScalar(t.launchSpeed);
    p.target = this.salvoDumb ? null : this.salvoTargets[index] ?? null;
    p.turnRate = t.turnRate;
    p.steerDelay = t.steerDelay;
    p.weave = t.weave;
    p.accel = t.accel;
    p.topSpeed = t.topSpeed;
    p.size = t.size;
    p.gib = true;
    p.killStop = HIT_STOP.heavyKill;
    p.explosion = {
      radius: t.radius * m.blastRadius, damage: t.blastDamage * m.damage, kind: hell ? 'hellfire' : 'rocket', instakill: hell,
      playerPush: TUNING.rocket.playerPush, scale: t.blastScale, shake: t.blastShake,
    };
    this.combat.spawnProjectile(p);
  }

  /** Each tube vents out of the back of the block: smoke over the shoulder and a spit of sparks, where anyone behind sees it. */
  private backblast(): void {
    const c = this.ctx;
    const { player } = c;
    const right = this.right.crossVectors(player.forward, UP).normalize();
    const at = this.v.copy(player.eye).addScaledVector(player.forward, -0.9).addScaledVector(right, 0.3);
    at.y -= 0.08;
    c.fx.smoke(at, 0xb9b4aa, 0.8, 1.3);
    c.fx.sparks(at, this.w.copy(player.forward).negate(), 5, 0xffa040);
    c.fx.smoke(at.addScaledVector(player.forward, -1.2), 0x989389, 1.3, 1.9);
  }

  // -------------------------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------------------------

  private updateZoom(): void {
    const c = this.ctx;
    const t = TUNING.autocannon;
    if (WEAPONS[this.current].scope && c.input.pressed('aim') && !this.reloading && this.drawLeft <= 0) {
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
    this.stopPaint();
    this.endContinuous();
    this.cancelReload();
    this.clearScope(false);
    this.chargeLevel = 0;
    this.chargeFull = false;
    viewmodel.setCharge(0);
    // The melee key swings whatever key 5 would draw: the knife, if that is the one last held there.
    const blade = this.slotMember(WEAPONS.sword.slot);
    viewmodel.equip(blade, 0.02);
    this.sword.quickStrike(blade);
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
    unguided(p);
    this.combat.spawnProjectile(p);
    if (strength > 0) c.audio.play('grenade_throw');
  }
}

/** Clears what only a guided missile sets, on the one spec every projectile of the player's is filled into. */
function unguided(p: ProjectileSpec): void {
  p.target = undefined;
  p.turnRate = undefined;
  p.steerDelay = undefined;
  p.weave = undefined;
  p.accel = undefined;
  p.topSpeed = undefined;
  p.size = undefined;
}
