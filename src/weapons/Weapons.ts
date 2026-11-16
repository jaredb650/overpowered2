/**
 * The player's arsenal. Input in, shots out. All timing runs on ctx.time.playerDt, so SLOWMO leaves the
 * player at full cadence and a hit-stop pauses the gun with the world.
 *
 * Fire rate is a time accumulator: a shot's cooldown carries its remainder into the next one, so 20
 * rps is 20 rps at any frame rate rather than rounding up to whole frames.
 */
import * as THREE from 'three';
import { ACTIVE } from '../contracts/select';
import { survivalLoadout } from '../contracts/loadouts';
import { CG, type Ctx, type ExplosionKind, type LoopHandle } from '../core/contracts';
import type {
  AmmoState, EnemyInstance, MissileTarget, ModId, PaintView, ProjectileSpec, ProjectileTrail, ShotSpec, SmartAimView, WeaponId,
  WeaponModifiers, WeaponSystem,
} from '../core/gameplay';
import { clamp, damp, invLerp, lerp, randomInCone, smoothstep, wrapAngle } from '../core/math';
import { MOVE } from '../player/tuning';
import type { Combat, Guard, GuardResult } from './Combat';
import { ISSUED, MODS, MOD_ORDER, moddedDef } from './mods';
import { HIT_STOP, LAUNCHER, SWORD, TUNING, WEAPONS, WEAPON_ORDER, type FireSelect, type SoundLayer, type WeaponDef } from './data';
import { Fan, type FanHooks, type FanLock } from './fan';
import { familyOf, familyOfSlot, membersOf, pressSlot, wheelSlot } from './families';
import { Handling, holdSpeed } from './handling';
import { PIERCE_ON } from './penetration';
import { Raufoss } from './raufoss';
import { helixOffset } from './helix';
import { Painter, angleOff, type PaintCandidate } from './swarm';
import { isMelee } from './melee/data';
import { Melee } from './melee/Melee';
import { LANCE_ON, Lance } from './lance';
import { ROCKET_LASER } from './laser';
import { SmartAim, type SmartHooks } from './smartaim';

interface Slot {
  def: WeaponDef;
  /** Seconds until the next shot. Goes negative within a frame so the remainder carries. */
  cooldown: number;
  ammo: AmmoState;
}

/** The selector's click, a step higher for each mode further from full auto. */
const SELECT_PITCH: Readonly<Record<FireSelect, number>> = { auto: 0.92, burst: 1.12, semi: 1.25 };

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
/** The Judge's fanning: its key on the world clock's slow motion, and the share of a shot's kick each fanned round gives. */
const FAN_SLOWMO = 'judgeFan';
const FAN_KICK = 0.6;
/** Seconds between two reports in `minigun_fire_loop`: a gun firing faster than that (`?slot8=old`) plays it faster. */
const FIRE_LOOP_STEP = 0.04;

const STARTING_LOADOUT = survivalLoadout(ACTIVE.def.id);

export class Weapons implements WeaponSystem, Guard {
  current: WeaponId = STARTING_LOADOUT[0]!;
  readonly owned = new Set<WeaponId>();
  /** Weapon mods held (bought at the Crucible's shop, or the lab's), and the ones fitted now. A run starts with none. */
  readonly mods = new Set<ModId>();
  readonly fitted = new Set<ModId>();
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
  private lastGun: WeaponId = STARTING_LOADOUT[0]!;
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
  /** A bolt gun's shot took it out of its scope: back in when the bolt closes, unless aim was let go meanwhile. */
  private rescope = false;
  private zoom = 0;
  private scopeShown = false;

  /** Aim down sights. Settings write the first two: right click toggles it unless `aimHold`, and the mouse share while aimed. */
  aimHold = false;
  aimSensitivity: number = TUNING.ads.sensitivity;
  /** The toggle's state. A reload, a quick melee or a draw suspends it; a dash, a slide or a switch drops it. */
  private aimOn = false;
  /** 0 to 1, linear over the gun's `ads.time`. `aim` is it eased. */
  private aimT = 0;

  private cooking = false;
  private cookLeft = 0;
  private cookCue = 0;

  private akimboOn = false;
  private quickReturn = 0;
  /** Rounds left in a burst under way (`pullBurst`, or a `select` gun's). */
  private burstLeft = 0;
  /** The guns with their `altAmmo` loaded. A new run starts on the standard rounds. */
  private readonly altLoaded = new Set<WeaponId>();
  private raufossRounds: Raufoss | null = null;
  /** The Gimlet's under-barrel launcher: its own magazine of one, and whether it is up (hold R). */
  private readonly glSlot: Slot = {
    def: LAUNCHER, cooldown: 0, ammo: { mag: 1, magSize: 1, reserve: LAUNCHER.reserve, maxReserve: LAUNCHER.maxReserve },
  };
  private glUp = false;
  /** What each `select` gun's selector is on (hold R), unset for its first mode. Kept across a switch, cleared by a reset. */
  private readonly selector = new Map<WeaponId, FireSelect>();
  /** Seconds R has been held on a `select` or `smart` gun, or -1: a press shorter than its `hold` is a reload on the release. */
  private rHeld = -1;
  /** The Autoraffica's smart aim (hold R): switched on, kept across a switch, off at a reset; and its lock. See smartaim.ts. */
  private smartOn = false;
  private readonly smart = new SmartAim();
  private readonly smartHooks: SmartHooks = {
    look: (cone, skip) => this.headNear(cone, WEAPONS[this.current].smart!.range, skip),
    holds: (e, cone) => this.headSeen(e, WEAPONS[this.current].smart!.range, Math.cos(cone)) >= 0,
    head: (e, out) => this.combat.headOf(e, out),
    locked: () => this.ctx.audio.play('judge_fan_lock', { pitch: 1.7, volume: 0.45 }),
  };
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

  /** The Judge's fanning: bars charged on right click, heads painted while it is held, a shot a bar on release. See fan.ts. */
  private readonly fan = new Fan();
  private fanSlot: Slot | null = null;
  /** A round has left in this fan, so the gun recovers when it ends. */
  private fanFired = false;
  /** Seconds the off hand stays up on the hammer after the last fanned shot. */
  private fanHand = 0;
  private readonly fanHooks: FanHooks = {
    look: () => this.fanLook(),
    head: (e, out) => this.combat.headOf(e, out),
    bar: n => this.fanBar(n),
    lock: (_n, onHim) => this.ctx.audio.play('judge_fan_lock', { pitch: 1 + (onHim - 1) * 0.18 }),
    release: () => this.fanRelease(),
    shoot: lock => this.fanShot(lock),
    end: () => this.fanEnd(),
  };

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
    for (const id of STARTING_LOADOUT) this.own(id);
    this.issueMods();
  }

  /** The mods every run starts with held and fitted (mods.ts `ISSUED`). */
  private issueMods(): void {
    for (const id of ISSUED) {
      this.grantMod(id);
      this.fitMod(id, true);
    }
  }

  /** Adds a weapon, and only that one: a family member is its own unlock. Returns true when the weapon is new. */
  private own(id: WeaponId): boolean {
    const fresh = !this.owned.has(id);
    this.owned.add(id);
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
    // Outpost Defense sells ammunition, so a wave's end gives none.
    events.on('wave:clear', () => { if (!ACTIVE.def.economy) this.liftReserves(); });
    this.ctx.viewmodel.equip?.(this.current, 0.01);
  }

  reset(): void {
    this.stopEverything();
    this.owned.clear();
    this.slotLast.clear();
    for (const id of STARTING_LOADOUT) this.own(id);
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
    this.current = STARTING_LOADOUT[0]!;
    this.lastWeapon = 'shotgun';
    this.lastGun = STARTING_LOADOUT[0]!;
    this.pendingSwitch = null;
    this.holstered = false;
    this.occupied = 0;
    this.sword.reset();
    this.lance.reset();
    this.altLoaded.clear();
    this.mods.clear();
    for (const id of MOD_ORDER) this.fitMod(id, false);
    this.issueMods();
    this.glUp = this.smartOn = false;
    this.selector.clear();
    this.smart.drop();
    this.rHeld = -1;
    this.glSlot.cooldown = 0;
    this.glSlot.ammo.mag = LAUNCHER.magSize;
    this.glSlot.ammo.reserve = LAUNCHER.reserve;
    ROCKET_LASER.sight = ROCKET_LASER.on = false;
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

  /** 0..1 how far the gun is up at the eye, eased. */
  get aim(): number {
    return smoothstep(0, 1, this.aimT);
  }

  get charge(): number {
    if (WEAPONS[this.current].altFan) return this.fan.bar;
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
    return clamp(this.coneOf(def) / 0.06);
  }

  /** The gun's cone, tightened by aiming down its sights. */
  private coneOf(def: WeaponDef): number {
    return def.spread * lerp(1, TUNING.ads.spread, this.aim);
  }

  get swordStep(): number {
    return this.sword.step;
  }

  /** The Autoraffica's smart aim: on, its circle and its lock. The HUD and the viewmodel read it. */
  get smartAim(): SmartAimView {
    return this.smart;
  }

  /** The Gimlet's launcher is up: its shots, its reload and its count on the HUD. */
  get launcherUp(): boolean {
    return this.glUp;
  }

  /** What the trigger and R work now: the gun in hand, or its launcher while that is up. */
  private get held(): Slot {
    return this.glUp ? this.glSlot : this.slots[this.current];
  }

  /** A gun's selector: its first mode until hold R steps it on; full auto with a launcher fitted, whose hold R raises it. */
  private selectOf(def: WeaponDef): FireSelect {
    return def.select && !def.launcher ? this.selector.get(def.id) ?? def.select.modes[0]! : 'auto';
  }

  /**
   * The `altAmmo` label of the gun in hand while it is loaded, else '': the HUD wears it on the gun's name. The Gimlet's is
   * its launcher or its bursts; an ammo mod's is AP or HP.
   */
  get ammoMode(): string {
    const def = this.slots[this.current].def;
    const alt = WEAPONS[this.current].altAmmo;
    if (this.glUp) return 'LAUNCHER';
    // An ammo mod (AP or HP) comes first, beside the Gimlet's bursts.
    const load = def.load === 'plusP' ? '+P' : def.load ? def.load.toUpperCase() : '';
    const sel = this.selectOf(def);
    if (sel !== 'auto') return load ? `${load} · ${sel.toUpperCase()}` : sel.toUpperCase();
    // The Autoraffica: its bursts, or the smart aim and whether it holds a head.
    if (def.smart) {
      const mode = this.smart.on ? (this.smart.target ? 'SMART · LOCK' : 'SMART') : 'BURST';
      return load ? `${load} · ${mode}` : mode;
    }
    if (def.raufoss) return 'RAUFOSS';
    return load || (alt && this.altLoaded.has(this.current) ? alt.label : '');
  }

  /** Hands over a mod, unfitted. */
  grantMod(id: ModId): void {
    this.mods.add(id);
  }

  /**
   * Fits a mod held (`on`) or takes it off, and the gun fires its patched row (mods.ts) from the next shot. Returns whether it is
   * fitted now. The rule that it never changes in a fight is the shop's: the lab fits one anywhere.
   */
  fitMod(id: ModId, on: boolean): boolean {
    const weapon = MODS[id].weapon;
    if (on && this.mods.has(id)) {
      // One optic and one kind of round to a gun: fitting one takes the other of its slot off.
      const slot = MODS[id].slot;
      if (slot) for (const m of MOD_ORDER) if (m !== id && MODS[m].weapon === weapon && MODS[m].slot === slot) this.fitted.delete(m);
      this.fitted.add(id);
    } else this.fitted.delete(id);
    this.slots[weapon].def = moddedDef(weapon, this.fitted);
    // A magazine mod changes what the gun holds: rounds over the new size go back to the reserve.
    const a = this.slots[weapon].ammo;
    if (a.magSize !== this.slots[weapon].def.magSize) {
      a.magSize = this.slots[weapon].def.magSize;
      if (a.mag > a.magSize) {
        a.reserve += a.mag - a.magSize;
        a.mag = a.magSize;
      }
    }
    // Fitting or taking off the launcher puts the rifle back on full auto.
    if (MODS[id].patch.launcher) this.selector.delete(weapon);
    if (weapon === this.current) this.clearScope(false);
    if (!this.slots[this.current].def.launcher) this.glUp = false;
    return this.fitted.has(id);
  }

  /** Right click on a gun with two kinds of round: the other kind, a click, and its name under the crosshair. */
  private toggleAmmo(id: WeaponId, label: string): void {
    const c = this.ctx;
    const on = !this.altLoaded.has(id);
    if (on) this.altLoaded.add(id);
    else this.altLoaded.delete(id);
    const o = this.playOptions;
    o.position = undefined;
    o.volume = 1;
    o.pitch = on ? 1.25 : 0.9;
    o.pitchJitter = 0;
    c.audio.play('reload_bolt', o);
    c.hud.callout?.(on ? label : 'STANDARD');
  }

  /** The Quiver's marks while it is in hand, or the Judge's locks. */
  get paint(): PaintView | undefined {
    const def = WEAPONS[this.current];
    return def.mode === 'paint' ? this.painter : def.altFan ? this.fan : undefined;
  }

  /** The gun's rounds; with no id, what the trigger works now, which is the launcher's while it is up. */
  ammo(id?: WeaponId): AmmoState {
    return id === undefined ? this.held.ammo : this.slots[id].ammo;
  }

  give(id: WeaponId): void {
    if (this.owned.has(id)) {
      this.addReserve(this.slots[id], 0.5);
      return;
    }
    this.own(id);
    const s = this.slots[id];
    s.ammo.mag = s.def.magSize;
    s.ammo.reserve = s.def.reserve;
    this.ctx.events.emit('weapon:unlocked', { weapon: id });
    // A weapon that lands on a key already in use (the autocannon beside the Sabot) says how to reach it.
    const family = familyOfSlot(s.def.slot);
    if (family.some(other => other !== id && this.owned.has(other))) {
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
    this.addReserve(this.glSlot, fraction);
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
    const g = this.glSlot.ammo;
    if (this.fitted.has('gimletGl')) g.reserve = Math.max(g.reserve, Math.ceil(g.maxReserve * TUNING.ammo.waveFloor));
  }

  refillMagazines(): void {
    for (const id of WEAPON_ORDER) this.slots[id].ammo.mag = this.slots[id].def.magSize;
    this.glSlot.ammo.mag = LAUNCHER.magSize;
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
    this.aimOn = false;
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
    this.burstLeft = 0;
    this.rHeld = -1;
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
    // Guidance is on only on a frame the launcher is up with its sight on, so a holster, a death or a switch lets go.
    ROCKET_LASER.on = false;
    this.smart.on = this.smartOn && WEAPONS[this.current].smart !== undefined && !this.holstered && c.player.alive !== false;
    if (!this.smart.on) this.smart.drop();
    this.sword.tick(dt);
    this.updateAim(dt);
    if (c.player.alive === false) return;

    for (const id of WEAPON_ORDER) {
      const s = this.slots[id];
      if (s.cooldown > 0) s.cooldown -= dt;
    }
    if (this.glSlot.cooldown > 0) this.glSlot.cooldown -= dt;
    this.syncAkimbo();

    if (this.holstered) return;
    if (this.occupied > 0) {
      this.occupied -= dt;
      return;
    }
    this.readSwitch();
    this.updateGrenade(dt);
    this.updateZoom();
    this.updateLaser();
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
    const alt = WEAPONS[this.current].altAmmo;
    if (alt && !alt.hold && c.input.pressed('aim')) this.toggleAmmo(this.current, alt.label);
    this.updateReload(dt);
    if (this.smart.on) this.smart.update(dt, WEAPONS[this.current].smart!, this.smartHooks);
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
    this.aimOn = false;
    this.aimT = 0;
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
    this.burstLeft = 0;
    this.rHeld = -1;
    this.glUp = false;
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
    const s = this.held;
    const a = s.ammo;
    if (s.def.mode === 'melee' || this.reloading || a.mag >= a.magSize || a.reserve <= 0) return false;
    if (s.def.cycleTime && s.cooldown > 0) return false;
    if (this.modifiers.bottomlessMag) return false;
    // A salvo in the air finishes before the tubes are opened.
    if (this.salvoLeft > 0 || this.fan.phase === 'fire') return false;
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
    while (this.cycleCue < cues.length && this.cycleAt >= cues[this.cycleCue]![0]) {
      // The pull-back cue ejects: the first rack cue by default, or the bolt gun's chosen cue.
      if (this.cycleCue === (WEAPONS[this.current].cycleEject ?? 0) && WEAPONS[this.current].casing) this.eject(WEAPONS[this.current]);
      this.ctx.audio.play(cues[this.cycleCue++]![1]);
    }
  }

  private updateReload(dt: number): void {
    this.updateCycle(dt);
    const { input } = this.ctx;
    const def = WEAPONS[this.current];
    // A `select`, `smart` or held `altAmmo` gun reads R on its release: held past `hold` it switches (`select`), let go sooner it
    // reloads.
    const hold = (def.select ?? def.smart ?? def.altAmmo)?.hold;
    let tap = false;
    if (hold !== undefined) {
      if (input.pressed('reload') && !this.reloading) this.rHeld = 0;
      if (this.rHeld >= 0) {
        if (!input.isDown('reload')) {
          this.rHeld = -1;
          tap = true;
        } else if ((this.rHeld += dt) >= hold) {
          this.rHeld = -1;
          this.select();
        }
      }
    } else tap = input.pressed('reload');
    if (this.reloading) {
      // A bottomless mag makes the wait pointless. The first game made you sit through it.
      if (this.modifiers.bottomlessMag) {
        this.endReload(true);
        return;
      }
      this.reloadLeft -= dt;
      const held = this.held.def;
      const progress = this.reloadProgress;
      while (this.reloadCue < held.reloadFoley.length && progress >= held.reloadFoley[this.reloadCue]![0]) {
        this.ctx.audio.play(held.reloadFoley[this.reloadCue]![1]);
        this.reloadCue++;
      }
      if (this.reloadLeft <= 0) this.endReload(true);
      return;
    }
    if (tap) {
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
    const s = this.held;
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
    return Math.max(def.cycleTime ?? 0, def.interval / Math.max(this.modifiers.fireRate, 0.01));
  }

  /**
   * R held on a `select` gun: with a launcher fitted it is raised or lowered, else the gun switches between bursts and full
   * auto. A click, and the mode called out under the crosshair.
   */
  private select(): void {
    const alt = WEAPONS[this.current].altAmmo;
    if (alt) {
      this.toggleAmmo(this.current, alt.label);
      return;
    }
    if (WEAPONS[this.current].smart) {
      this.smartOn = !this.smartOn;
      this.burstLeft = 0;
      this.ctx.audio.play('fire_select', { pitch: this.smartOn ? 1.3 : 0.92 });
      this.ctx.hud.callout?.(this.smartOn ? 'SMART' : 'BURST');
      return;
    }
    const def = this.slots[this.current].def;
    if (def.launcher) {
      this.raiseLauncher(!this.glUp);
      return;
    }
    const modes = def.select!.modes;
    const next = modes[(modes.indexOf(this.selectOf(def)) + 1) % modes.length]!;
    this.selector.set(def.id, next);
    this.burstLeft = 0;
    this.ctx.audio.play('fire_select', { pitch: SELECT_PITCH[next] });
    this.ctx.hud.callout?.(next.toUpperCase());
  }

  /** Brings the launcher to bear, or back to the rifle: a moment's handling (`LAUNCHER.drawTime`), never during a reload. */
  private raiseLauncher(up: boolean): void {
    if (this.glUp === up) return;
    const g = this.glSlot.ammo;
    if (up && g.mag === 0 && g.reserve === 0 && !this.modifiers.bottomlessMag) {
      this.ctx.audio.play('weapon_dry');
      this.ctx.hud.callout?.('NO GRENADES');
      return;
    }
    this.glUp = up;
    this.burstLeft = 0;
    this.pressBuffer = 0;
    this.aimOn = false;
    this.drawLeft = Math.max(this.drawLeft, LAUNCHER.drawTime);
    this.autoReload = this.held.ammo.mag === 0 && this.held.ammo.reserve > 0 ? LAUNCHER.drawTime + TUNING.autoReloadDelay : -1;
    this.ctx.audio.play('fire_select', { pitch: up ? 0.8 : 1 });
    this.ctx.hud.callout?.(up ? 'LAUNCHER' : 'RIFLE');
  }

  private updateGun(dt: number): void {
    const { input } = this.ctx;
    const s = this.held;
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

    if (def.altFan && this.updateFan(s, dt)) return;
    switch (def.mode) {
      case 'auto': this.updateAuto(s, held); break;
      case 'semi': this.updateSemi(s, held); break;
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
    if (s.ammo.reserve > 0) this.autoReload = Math.max(TUNING.autoReloadDelay, s.def.cycleTime ?? 0);
    // The last grenade gone: back on the rifle, which still has rounds.
    else if (s === this.glSlot) this.raiseLauncher(false);
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
    const sel = this.selectOf(s.def);
    if (sel === 'burst') {
      this.updateBurst(s, s.def.select!.burst!);
      return;
    }
    if (sel === 'semi') {
      this.updateSemi(s, held);
      return;
    }
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

  /** A pull fires `rounds` at the row's rate, then waits `recover`. Letting go does not cut a burst short. */
  private updateBurst(s: Slot, burst: { readonly rounds: number; readonly recover: number }): void {
    if (this.burstLeft === 0) {
      if (this.pressBuffer <= 0 || s.cooldown > 0) return;
      if (!this.canShoot(s)) {
        this.dryFire();
        this.pressBuffer = 0;
        return;
      }
      this.pressBuffer = 0;
      this.burstLeft = burst.rounds;
      s.cooldown = Math.min(s.cooldown, 0);
    }
    while (this.burstLeft > 0 && s.cooldown <= 0 && this.canShoot(s)) {
      this.shootGun(s, false);
      this.burstLeft--;
      s.cooldown += this.burstLeft > 0 ? this.interval(s.def) : burst.recover / Math.max(this.modifiers.fireRate, 0.01);
    }
    if (!this.canShoot(s)) this.burstLeft = 0;
  }

  private updateSemi(s: Slot, held: boolean): void {
    if (s.def.smart && this.smart.on) {
      if (this.updateSmartFire(s, held)) return;
    } else if (s.def.pullBurst) {
      this.updateBurst(s, s.def.pullBurst);
      return;
    }
    // Right click on a double gun pulls both triggers. On the Deuce's last shell it is one barrel, as a left click.
    const both = s.def.altBoth !== undefined && this.ctx.input.pressed('aim');
    if ((this.pressBuffer <= 0 && !both) || s.cooldown > 0) return;
    if (!this.canShoot(s)) {
      if (both) {
        if (!this.startReload()) this.wentDry();
      } else this.dryFire();
      this.pressBuffer = 0;
      return;
    }
    this.pressBuffer = 0;
    this.shootGun(s, false, both);
    s.cooldown = this.interval(s.def);
  }

  /**
   * Smart aim with a head locked: the trigger held is full auto at the smart aim's `interval`, each round into the locked
   * head, the lock handing on as each man dies, until no head is left in the circle. Unlocked it is the semi-auto trigger
   * (false: `updateSemi` fires one round a pull).
   */
  private updateSmartFire(s: Slot, held: boolean): boolean {
    if (!this.smart.target) return false;
    if (!held && this.pressBuffer <= 0) {
      if (s.cooldown < 0) s.cooldown = 0;
      return true;
    }
    if (s.cooldown > 0) return true;
    if (!this.canShoot(s)) {
      this.dryFire();
      this.pressBuffer = 0;
      return true;
    }
    this.pressBuffer = 0;
    const interval = s.def.smart!.interval / Math.max(this.modifiers.fireRate, 0.01);
    while (s.cooldown <= 0 && this.canShoot(s) && this.smart.target?.alive) {
      this.shootGun(s, false);
      s.cooldown += interval;
    }
    return true;
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
    this.ctx.audio.play('minigun_fire', { pitch: this.slots[this.current].def.loopPitch ?? 1 });
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
    this.loop?.setPitch(lerp(SPIN_PITCH, 1, this.spin) * (s.def.loopPitch ?? 1), 0.04);
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
    this.fireLoop?.setPitch(clamp(((s.def.loopPitch ?? 1) * rate * this.modifiers.fireRate * FIRE_LOOP_STEP) / s.def.interval, 0.4, 2), 0.05);
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
      this.setLoop('flame_hose_loop');
    }
    // The stream itself is the napalm's hose, drawn by Flames from the globs.
    this.muzzle(false);
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
  private shotFeedback(def: WeaponDef, left: boolean, shot = 1, barrel = 0): void {
    const c = this.ctx;
    // Aimed, the gun is in the shoulder: less kick, climb and shake. The flash and the sound are the same gun.
    const steady = lerp(1, TUNING.ads.recoil, this.aim);
    const strength = shot * steady;
    const { player } = c;
    const fwd = player.forward;
    const at = this.muzzle(left, barrel);
    c.fx.muzzleFlash(this.flashPoint(at), this.flashDir.set(0, 0, -1).applyQuaternion(c.render.camera.quaternion), def.muzzle);
    this.layerSounds(def.sounds);
    if (def.cycleFoley) {
      if (def.cycleTime) {
        const was = this.zoomed;
        this.clearScope(false);
        this.rescope = was;
      }
      this.cycleAt = 0;
      this.cycleCue = 0;
      this.cycleGun = def.id;
    }
    c.viewmodel.fire(def.recoil * strength, left);
    if (def.kick > 0) {
      const side = left ? -1 : 1;
      c.camera.kick(def.kick * strength, (Math.random() - 0.5) * def.kick * 0.6 * side * steady, 0);
    }
    this.combat.feel.shake(def.shake * strength);
    if (def.fovPunch > 0) c.camera.fovPunch(def.fovPunch * strength, 0.12);
    // A hand-cycled gun's shell stays in the chamber until the pump comes back (updateCycle).
    if (def.casing && !def.cycleFoley) this.eject(def);

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
    s.load = def.load;
    s.falloff = REACH_ON ? def.falloff : undefined;
    s.cleave = 0;
    return s;
  }

  private shootGun(s: Slot, left: boolean, both = false): void {
    const def = s.def;
    // A break-open gun fires its barrels in turn, from the next one loaded; `both` fires every loaded one together (the
    // Deuce's two, the quad's four). The launcher's flash leaves its own tube: the viewmodel's `muzzle1`.
    const barrel = def.altBoth ? Math.max(0, def.magSize - s.ammo.mag) : def.round === 'grenade' ? 1 : 0;
    const loaded = both && def.altBoth ? (this.modifiers.bottomlessMag ? def.magSize : s.ammo.mag) : 1;
    const two = loaded >= 2 ? def.altBoth : undefined;
    const barrels = two ? loaded : 1;
    this.consume(s, barrels);
    this.shotFeedback(def, left, two ? 1 + (two.kick - 1) * (barrels - 1) : 1, barrel);
    if (def.slow !== undefined) this.handling.shot();
    if (def.climb && CLIMB_ON) this.climb(def.climb, lerp(1, TUNING.ads.climb, this.aim));
    // By what the row says leaves the barrel, never by which gun it is: a family member picks its own.
    switch (def.round) {
      case 'rocket': this.shootRocket(def); return;
      case 'shell': this.shootShell(def); return;
      case 'stake': this.shootStake(def); return;
      case 'grenade': this.shootGrenade(def); return;
    }
    const c = this.ctx;
    const eye = c.player.eye;
    const fwd = c.player.forward;
    const m = this.modifiers;
    const shot = this.fillShot(def, def.damage * m.damage);
    const scatter = def.pellets > 1;
    const pellets = Math.round(def.pellets * barrels * (scatter ? m.pellets : 1));
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
    let next = 1;
    for (let i = 0; i < pellets; i++) {
      // Barrels together: each one's share of the pellets leaves it, with its own flash, report and shove.
      if (two && next < barrels && i >= (pellets * next) / barrels) this.secondBarrel(def, two, barrel + next, next++);
      const dir = def.spread > 0 ? randomInCone(fwd, this.coneOf(def), this.dir) : fwd;
      if (def.raufoss || this.altLoaded.has(def.id)) (this.raufossRounds ??= new Raufoss(c, this.combat)).fire(eye, dir, shot);
      // The smart aim's lock: the round into his head, as the Judge's fanned shot (cover in the line takes it).
      else if (this.smart.target) this.combat.fireAtHead(eye, this.smart.target, shot);
      else this.combat.fireRay(eye, dir, shot);
    }
  }

  /** The `k`th barrel after the first of a barrels-together shot: its flash, the shot heard again `k` echoes late, the shove. */
  private secondBarrel(def: WeaponDef, two: NonNullable<WeaponDef['altBoth']>, barrel: number, k: number): void {
    const c = this.ctx;
    const at = this.muzzle(false, barrel);
    c.fx.muzzleFlash(this.flashPoint(at), this.flashDir.set(0, 0, -1).applyQuaternion(c.render.camera.quaternion), def.muzzle);
    c.audio.play(def.sounds[0]!.id, { delay: two.echo * k, pitch: two.echoPitch, pitchJitter: 0.02 });
    this.shoveBack(two.push, two.ground);
  }

  /**
   * Shoves the player back along the aim at `push` m/s: all of it in the air, where it steers a jump; on the ground
   * `ground` of it along the floor, so a shot at your feet does not lift you.
   */
  private shoveBack(push: number, ground: number): void {
    const { player } = this.ctx;
    const f = player.forward;
    if (player.grounded) {
      player.velocity.x -= f.x * push * ground;
      player.velocity.z -= f.z * push * ground;
    } else {
      player.velocity.addScaledVector(f, -push);
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
    p.wired = undefined;
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
    p.wired = def.laser === true;
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
    this.shoveBack(t.push, t.groundPush);
  }

  /** The launcher's 40 mm: an arcing round that goes off on whatever it touches, a hit on a man first. TUNING.launcher. */
  private shootGrenade(def: WeaponDef): void {
    const t = TUNING.launcher;
    const m = this.modifiers;
    const p = this.fillProjectile('shell', def, t.speed, def.damage * m.damage, 'smoke');
    p.gravity = t.gravity;
    p.lifetime = t.life;
    p.gib = true;
    p.killStop = HIT_STOP.heavyKill;
    p.explosion = { radius: t.radius * m.blastRadius, damage: t.blast * m.damage, kind: 'grenade' };
    this.combat.spawnProjectile(p);
  }

  private shootStake(def: WeaponDef): void {
    const t = TUNING.stake;
    const damage = def.damage * this.modifiers.damage;
    const p = this.fillProjectile('stake', def, t.speed, damage, 'none');
    p.gravity = t.gravity;
    p.killStop = HIT_STOP.stakeKill;
    if (this.altLoaded.has(def.id)) {
      // The exploding bolt: a fuse makes it stick where it lands and go off, as a grenade, `fuse` s later.
      const b = t.bomb;
      p.damage = b.direct * this.modifiers.damage;
      p.force = b.force;
      p.fuse = b.fuse;
      p.explosion = { radius: b.radius * this.modifiers.blastRadius, damage: b.damage * this.modifiers.damage, kind: 'grenade' };
    } else if (this.modifiers.explosiveRounds) p.explosion = { radius: TUNING.hellfireRounds.radius, damage, kind: 'hellfireBullet' };
    this.combat.spawnProjectile(p);
  }

  private shootFlame(s: Slot): void {
    const c = this.ctx;
    const def = s.def;
    const k = TUNING.napalm;
    this.consume(s);
    const p = this.fillProjectile('flame', def, k.speed, def.damage * this.modifiers.damage, 'none');
    p.velocity.addScaledVector(c.player.velocity, 0.6);
    p.lifetime = k.life;
    p.gravity = k.gravity;
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
    // Aimed, the player walks. The same clamp, so a dash, a slide or a wall run is never cut by it.
    holdSpeed(this.ctx.player, Math.min(cap, lerp(1, TUNING.ads.speed, this.aim)), dt, this.handling);
  }

  /**
   * Real climb, on a gun whose row has it: the aim itself moves, up and to a random side, and stays there until the player
   * pulls it back. The camera's kick is on top and springs back as usual.
   */
  private climb(c: { readonly pitch: number; readonly yaw: number }, k: number): void {
    const p = this.ctx.player;
    p.pitch = clamp(p.pitch + c.pitch * k * (0.85 + Math.random() * 0.3), -1.55, 1.55);
    p.yaw += (Math.random() - 0.5) * 2 * c.yaw * k;
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
      if (input.pressed('aim') && s.cooldown <= 0) {
        this.squareSalvo(s);
        return;
      }
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

  private squareSalvo(s: Slot): void {
    if (!this.canShoot(s)) {
      if (!this.startReload()) this.wentDry();
      return;
    }
    const n = this.salvoRounds(s);
    for (let i = 0; i < n; i++) this.fireMissile(s, i, true);
    s.cooldown = TUNING.quiver.recover;
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
    if (this.painter.painting || this.salvoLeft > 0 || this.fan.busy) this.ctx.viewmodel.setCharge(0);
    this.fan.cancel();
    this.ctx.time.popScale(FAN_SLOWMO);
    this.fanFired = false;
    this.fanHand = 0;
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

  private fireMissile(s: Slot, index: number, square = false): void {
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
    if (square) {
      const wall = c.physics.raycast(p.origin, fwd, t.range, CG.World);
      const body = c.enemies.raycast(p.origin, fwd, wall?.distance ?? t.range);
      p.helix = {
        phase: Math.atan2(sy, sx), reach: Math.max(0.1, body?.distance ?? wall?.distance ?? t.range),
        radius: t.helixRadius, pitch: t.helixPitch, startRadius: t.square / Math.SQRT2, convergence: t.helixConvergence,
      };
      p.origin.add(helixOffset(this.dir, right, up, p.helix, 0));
      dir.copy(fwd);
    } else if (this.salvoDumb) {
      // Centred a touch above the crosshair, so the low pair does not go into the floor a few metres out.
      dir.addScaledVector(right, sx * t.fan * 0.5).addScaledVector(up, (sy + 1) * t.fan * 0.4).normalize();
      randomInCone(dir, t.dumbSpread, dir);
    } else {
      // Aimed missiles climb a touch as they leave, so the swarm arcs onto its marks rather than skimming the floor.
      dir.addScaledVector(right, sx * t.fan).addScaledVector(up, sy * t.fan * 0.7 + t.fan * 0.6).normalize();
    }
    p.velocity.copy(dir).multiplyScalar(t.launchSpeed);
    p.target = square || this.salvoDumb ? null : this.salvoTargets[index] ?? null;
    p.turnRate = t.turnRate;
    p.steerDelay = t.steerDelay;
    p.weave = square ? 0 : t.weave;
    if (!square) p.helix = undefined;
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
  // The Judge: hold right click to charge, paint a head a bar, fan the hammer
  // -------------------------------------------------------------------------------------------

  /** True while the fan has the gun (charging, painting, firing): a left click does nothing then. */
  private updateFan(s: Slot, dt: number): boolean {
    const { input, viewmodel } = this.ctx;
    const t = s.def.altFan!;
    this.fanSlot = s;
    const loaded = this.modifiers.bottomlessMag ? t.bars : s.ammo.mag;
    this.fan.update(dt, t, input.pressed('aim'), input.isDown('aim'), loaded, s.cooldown <= 0, this.fanHooks);
    if (this.fanHand > 0) this.fanHand -= dt;
    // The off hand comes up over the hammer at the press and stays there through the last slap.
    viewmodel.setCharge(this.fan.busy || this.fanHand > 0 ? 1 : 0);
    return this.fan.busy;
  }

  /** The head nearest the crosshair inside the fan's cone, with nothing solid between it and the eye. */
  private fanLook(): FanLock['enemy'] | null {
    const t = WEAPONS[this.current].altFan!;
    return this.headNear(t.cone, t.range, null);
  }

  /** The head nearest the crosshair inside `cone` and `range` with nothing solid between it and the eye, but `skip`'s. */
  private headNear(cone: number, range: number, skip: EnemyInstance | null): EnemyInstance | null {
    const cos = Math.cos(cone);
    const alive = this.ctx.enemies.alive;
    let best: EnemyInstance | null = null;
    let bestAngle = Infinity;
    for (let i = 0; i < alive.length; i++) {
      const e = alive[i]!;
      if (e === skip) continue;
      const angle = this.headSeen(e, range, cos);
      if (angle < 0 || angle >= bestAngle) continue;
      best = e;
      bestAngle = angle;
    }
    return best;
  }

  /** His head's angle off the crosshair while he lives, is inside the cone (`cos`) and `range` and in plain sight; else -1. */
  private headSeen(e: EnemyInstance, range: number, cos: number): number {
    if (!e.alive) return -1;
    const c = this.ctx;
    const eye = c.player.eye;
    const head = this.combat.headOf(e, this.v);
    const angle = angleOff(eye, c.player.forward, head, range, cos);
    if (angle < 0) return -1;
    const dir = this.w.subVectors(head, eye);
    const dist = dir.length();
    return c.physics.raycast(eye, dir.divideScalar(dist), dist, CG.World) ? -1 : angle;
  }

  /** A bar charged: a tick, and the tension under the hold, a step higher each bar. */
  private fanBar(n: number): void {
    this.ctx.audio.play('judge_fan_tick', { pitch: 1 + (n - 1) * 0.14 });
    this.setLoop('judge_fan_tension');
    this.loop?.setPitch(1 + (n - 1) * 0.35, 0.08);
  }

  /** Let go: the world slows for the dump, but only for a fan with someone painted. A blind dump runs at normal speed. */
  private fanRelease(): void {
    if (this.fan.marks.length > 0) this.ctx.time.pushScale(FAN_SLOWMO, this.fanSlot!.def.altFan!.slow, 0.05, 0.15);
  }

  /** One slap of the hammer: a round into the lock's head from the eye, or down the crosshair with the gun's own cone. */
  private fanShot(lock: FanLock | null): void {
    const c = this.ctx;
    const s = this.fanSlot!;
    const def = s.def;
    // The tension breaks on the first shot.
    if (this.loopKind === 'judge_fan_tension') this.endContinuous();
    this.fanFired = true;
    this.consume(s);
    this.shotFeedback(def, false, FAN_KICK);
    const shot = this.fillShot(def, def.damage * this.modifiers.damage);
    const eye = c.player.eye;
    if (lock) this.combat.fireAtHead(eye, lock.enemy, shot);
    else this.combat.fireRay(eye, def.spread > 0 ? randomInCone(c.player.forward, this.coneOf(def), this.dir) : c.player.forward, shot);
  }

  /** The fan is over, fired or let go of: the slow motion and the tension end here, whatever ended it. */
  private fanEnd(): void {
    this.ctx.time.popScale(FAN_SLOWMO);
    if (this.loopKind === 'judge_fan_tension') this.endContinuous();
    if (!this.fanFired) return;
    this.fanFired = false;
    const t = this.fanSlot!.def.altFan!;
    this.fanSlot!.cooldown = t.recover / Math.max(this.modifiers.fireRate, 0.01);
    this.fanHand = t.recover;
  }

  // -------------------------------------------------------------------------------------------
  // Aim down sights
  // -------------------------------------------------------------------------------------------

  /**
   * Right click on a gun with `ads` in its row: toggled, or held with `aimHold`. A gun that uses the button for something
   * else (a scope, the Lance's charge, the Quiver's marks, the cannon's spin, a blade's block) has no `ads` and never reads
   * it here. Runs every frame, dead or holstered too, so the weight always falls back and hands the camera back its view.
   */
  private updateAim(dt: number): void {
    const c = this.ctx;
    // The row as fitted: an optic changes the zoom.
    const def = this.slots[this.current].def;
    const p = c.player;
    const busy = this.holstered || this.occupied > 0 || p.alive === false;
    // A press while holstered is a call-in's cancel, not ours.
    if (def.ads && !busy && !this.aimHold && c.input.pressed('aim')) this.aimOn = !this.aimOn;
    const moving = p.dashing === true || p.sliding === true;
    if (moving) this.aimOn = false;
    const wants = this.aimHold ? c.input.isDown('aim') : this.aimOn;
    // The launcher is fired from the shoulder over its own leaf, not through the rifle's sight.
    const blocked = busy || moving || !def.ads || this.glUp || this.reloading || this.drawLeft > 0 || this.akimboOn
      || this.sword.inQuickStrike || this.quickReturn > 0 || (!!def.cycleTime && this.held.cooldown > 0);
    const up = wants && !blocked;
    this.aimT = clamp(this.aimT + (up ? dt : -dt) / (def.ads?.time ?? 0.2));
    const w = this.aim;
    c.camera.setAim?.(1 - (def.ads?.zoom ?? 0) * w, lerp(1, this.aimSensitivity, w));
    c.viewmodel.setAim?.(w);
  }

  // -------------------------------------------------------------------------------------------
  // Laser sight
  // -------------------------------------------------------------------------------------------

  /**
   * The Rocket's right click toggles its laser. While it is up, the dot sits where the crosshair points (the first wall or
   * body on the eye line) and every rocket it fired steers for it; it is drawn as a thin red line from the muzzle. The dot is
   * the crosshair's (ui/hud/crosshair.ts), so it holds one size at any range.
   */
  private updateLaser(): void {
    const c = this.ctx;
    if (!WEAPONS[this.current].laser) return;
    const L = ROCKET_LASER;
    if (c.input.pressed('aim')) {
      L.sight = !L.sight;
      c.audio.play('rocket_laser', { pitch: L.sight ? 1.15 : 0.85 });
    }
    if (!L.sight) return;
    const { eye, forward } = c.player;
    let reach: number = TUNING.rocket.laserRange;
    const wall = c.physics.raycast(eye, forward, reach, CG.World);
    if (wall) reach = wall.distance;
    const body = c.enemies.raycast(eye, forward, reach);
    if (body) reach = body.distance;
    // A hair short of the surface, so the dot is not inside it.
    L.at.copy(eye).addScaledVector(forward, Math.max(0, reach - 0.04));
    L.on = true;
    c.fx.beam(this.muzzle(false), L.at, 'laser');
  }

  // -------------------------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------------------------

  private updateZoom(): void {
    const c = this.ctx;
    const t = TUNING.autocannon;
    const def = this.held.def;
    if (this.rescope) {
      // Aim pressed (toggle) or let go (hold) during the cycle keeps it out; otherwise it is back in as the bolt locks.
      if (!def.scope || (!this.aimHold && c.input.pressed('aim')) || (this.aimHold && !c.input.isDown('aim'))) this.rescope = false;
      else if (!(def.cycleTime && this.held.cooldown > 0) && !this.reloading && this.drawLeft <= 0) {
        this.rescope = false;
        this.zoomed = true;
        c.audio.play('autocannon_zoom');
        c.camera.setZoom(def.scopeFov ?? t.scopeFov);
      }
    }
    if (def.scope && (this.aimHold || c.input.pressed('aim')) && !this.reloading && this.drawLeft <= 0 && !(def.cycleTime && this.held.cooldown > 0)) {
      const zoomed = this.aimHold ? c.input.isDown('aim') : !this.zoomed;
      if (zoomed !== this.zoomed) {
        this.zoomed = zoomed;
        c.audio.play('autocannon_zoom');
        c.camera.setZoom(this.zoomed ? (def.scopeFov ?? t.scopeFov) : null);
      }
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
    this.rescope = false;
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
  p.helix = undefined;
  p.target = undefined;
  p.turnRate = undefined;
  p.steerDelay = undefined;
  p.weave = undefined;
  p.accel = undefined;
  p.topSpeed = undefined;
  p.size = undefined;
}
