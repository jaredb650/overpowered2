/**
 * Brain chips, key T: abilities the player sets off when he likes, with nothing in the fight to earn them. Sonar is issued; Thermal
 * (the AC-130's black-hot view, on foot) and Focus (slow motion on a meter) are bought in Procurement's Implants page. One chip slot
 * to start and a second for sale. With two chips fitted a tap of T works the chip in hand and holding T moves to the next one; with
 * one, T works it on the press, as Sonar always has.
 *
 * `ChipRack` is what a run owns and has fitted, plain data for the shop and the tests. `Chips` is the rack at run time, on
 * `ctx.contracts.chips`: the key, Sonar's clock (sonar.ts, unchanged), the thermal view and the focus meter. Purchases last one
 * run, as guns and implants do. A mission gets Sonar only, unless it calls `chip` (campaign/host.ts).
 */
import * as THREE from 'three';
import type { Ctx, GradeName } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import type { Sonar } from './sonar';
import { KATA } from '../weapons/kata';

export type ChipId = 'sonar' | 'thermal' | 'focus' | 'kata';

export interface ChipDef {
  id: ChipId;
  name: string;
  /** Credits. 0: issued. */
  price: number;
  /** The wave that has to be cleared before it is sold. */
  wave: number;
  /** The badge's colour. */
  color: string;
  /** What T does with it, for the shop's card. */
  does: string;
  lore: string;
}

/** Maximum thermal detection range in metres (smooth falloff from 26 m to 32 m). */
export const THERMAL_RANGE = 32;
/** Distance in metres where thermal signal begins fading smoothly to 0 at `THERMAL_RANGE`. */
export const THERMAL_FALLOFF_START = 26;
/** Seconds a killed enemy's corpse stays visible on thermal while cooling down. */
export const THERMAL_CORPSE_COOL = 20;

const MAX_THERMAL_CORPSES = 24;
const _pos = new THREE.Vector3();

/** Environmental heat sources registered by stealth maps or systems (bulbs, breakers, cameras, alarm panels). */
export interface ThermalSources {
  readonly hot: readonly THREE.Object3D[];
  readonly warm: readonly THREE.Object3D[];
}

export type ThermalSourceProvider = () => ThermalSources;

/** Thermal: modern FLIR thermal optics, worn on foot. No limit: T turns it on and off. */
export const THERMAL = {
  /** Empty: FLIR optics are driven by the 'thermal' post grade and XRay visibleFill, never CSS invert(1). */
  filter: '',
  /** Living bodies glow white-hot with warm gold edges. */
  enemyColor: '#fff2cc',
  /** Distant living bodies in the 26..32 m falloff band cool slightly toward amber. */
  enemyFarColor: '#ffaa33',
  /** Visible-surface heat fill for unoccluded living bodies in pitch-black rooms. */
  visibleFill: 0.88,
  /** Fresh cooling corpses glow hot orange-red. */
  corpseHotColor: '#ff6622',
  /** Older cooling corpses fade toward dull ember red before going cold. */
  corpseCoolColor: '#b82814',
  /** Hot environmental heat sources (live bulbs, heaters, hot machinery). */
  sourceHotColor: '#ffaa33',
  /** Warm environmental heat sources (powered breaker boxes, security cameras, alarm panels). */
  sourceWarmColor: '#44c8e8',
  /** Metres it reads heat at, through cover too. Past it Sonar is still the chip for the whole map. */
  range: THERMAL_RANGE,
  /** Metres at which thermal signal begins fading smoothly to zero at `range`. */
  falloffStart: THERMAL_FALLOFF_START,
  /** Seconds a corpse stays visible on thermal while cooling down. */
  corpseCool: THERMAL_CORPSE_COOL,
  /** Post-processing grade crossfade duration in seconds when toggling thermal. */
  gradeBlend: 0.14,
} as const;

/** Focus: on-demand slow motion, on a meter that drains while it runs and fills again after. */
export const FOCUS = {
  /** The world's speed while it runs. SLOWMO is 0.25; this is a little less, as it is the player's to call. */
  scale: 0.35,
  /** Seconds of the player's own time a full meter lasts. */
  seconds: 4,
  /** Seconds from empty to full. */
  refill: 18,
  /** Seconds after it stops before the meter starts filling again. */
  delay: 1.5,
  /** The share of the meter it needs to start, so a dry meter cannot flicker it on and off. */
  start: 0.25,
  fadeIn: 0.12,
  fadeOut: 0.25,
} as const;

/** Seconds T has to be held, with two chips fitted, to move to the next. Shorter is a tap. */
export const HOLD_SWITCH = 0.32;

export const CHIPS: Readonly<Record<ChipId, ChipDef>> = {
  sonar: {
    id: 'sonar', name: 'Sonar', price: 0, wave: 0, color: 'var(--cold)',
    does: 'Tap: a ring goes out and shows every enemy on the map through walls for 4 s. 8 s to recharge, 3 s with 3 or fewer left.',
    lore: 'Issued. A tap on the helmet and the whole site answers. The Council calls it situational awareness and bills it as overtime.',
  },
  thermal: {
    id: 'thermal', name: 'Thermal', price: 1400, wave: 3, color: '#ff6a2c',
    does: `Tap: FLIR thermal vision, on or off, for as long as you like. Living targets glow white-hot and cooling bodies and powered hardware show through cover out to ${THERMAL.range} m.`,
    lore: 'Military FLIR microbolometers fitted behind the optic nerve. Cold concrete drops to midnight slate while every pulse, filament and fresh corpse burns white-orange.',
  },
  focus: {
    id: 'focus', name: 'Focus', price: 2200, wave: 6, color: '#ffc14a',
    does: `Tap: the world at ${FOCUS.scale}x while you move at full speed, on a ${FOCUS.seconds} s meter that refills in ${FOCUS.refill} s. Tap again to stop.`,
    lore: 'A brain chip that makes everyone else slow. It cannot make them stupid; the Council sells that separately, to the other side.',
  },
  kata: {
    id: 'kata', name: 'Gun Kata', price: 2600, wave: 10, color: '#ff3d6e',
    does: `Hold T, with two guns in hand (akimbo): every man within ${KATA.radius} m and in sight, all the way round, lights red, and at full charge (${KATA.charge} s) each gets a head shot, in about a second, from your magazines. Let go early and nothing is spent. ${KATA.cooldown} s to recharge. With two brain chips fitted, a tap moves on to the next.`,
    lore: 'Statistical analysis of ten thousand firefights, written behind the eyes. Every angle is covered, which the Council regards as the whole of management. Requires two guns. The Council requires two signatures.',
  },
};

export const CHIP_ORDER: readonly ChipId[] = ['sonar', 'thermal', 'focus', 'kata'];

/** The second chip slot, for sale. The first is issued. */
export const CHIP_SLOT = {
  price: 1600, wave: 4,
  lore: 'A second socket behind the ear. Hold T to change brain chips. The Council notes that two brain chips are twice as productive and asks that you do not reach for both at once.',
} as const;

export const CHIP_SLOTS = 2;

/** What a run owns and has fitted, slot by slot. */
export class ChipRack {
  readonly owned = new Set<ChipId>();
  /** In slot order. Never longer than `slots`. */
  readonly fitted: ChipId[] = [];
  slots = 1;
  private thermalSourcesProvider: ThermalSourceProvider | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.owned.clear();
    this.owned.add('sonar');
    this.fitted.length = 0;
    this.fitted.push('sonar');
    this.slots = 1;
  }

  /** Registers (or clears) a provider of environmental thermal heat sources (live bulbs, breakers, cameras, alarms). */
  setThermalSources(provider: ThermalSourceProvider | null): void {
    this.thermalSourcesProvider = provider;
  }

  get thermalSources(): ThermalSourceProvider | null {
    return this.thermalSourcesProvider;
  }

  grant(id: ChipId): void {
    this.owned.add(id);
  }

  /** The chip fitting `id` would take out: none with a free slot, else the one in the last slot. */
  replaces(id: ChipId): ChipId | null {
    if (this.fitted.includes(id) || this.fitted.length < this.slots) return null;
    return this.fitted[this.slots - 1] ?? null;
  }

  /** Fits `id` (granting it), into a free slot or in place of the last slot's; or takes it out. */
  fit(id: ChipId, on: boolean): void {
    const at = this.fitted.indexOf(id);
    if (!on) {
      if (at >= 0) this.fitted.splice(at, 1);
      return;
    }
    this.owned.add(id);
    if (at >= 0) return;
    if (this.fitted.length >= this.slots) this.fitted[this.slots - 1] = id;
    else this.fitted.push(id);
  }

  openSlot(): boolean {
    if (this.slots >= CHIP_SLOTS) return false;
    this.slots++;
    return true;
  }
}

/** What the HUD's T badge shows. */
export interface ChipBadge {
  name: string;
  color: string;
  /** Lit: ready to use, or running. A dark plate otherwise. */
  lit: boolean;
  /** Seconds, a percentage, ON or OFF. */
  text: string;
  /** 0..1 along the bottom: a cooldown refilling, or the focus meter. */
  fill: number;
  /** Chips fitted, and which is in hand, for the pips. */
  count: number;
  index: number;
}

/** Progression's grade hold (perks.ts), which the interface does not carry. Seats use the same hold. */
type Grades = { holdGrade?(grade: GradeName | null): void };

interface ThermalCorpse {
  mesh: THREE.Object3D | null;
  diedAt: number;
  readonly pos: THREE.Vector3;
  active: boolean;
}

/** Smoothstep distance attenuation: 1 out to `falloffStart`, fading cleanly to 0 at `range`. */
function thermalFalloff(dist: number): number {
  if (dist <= THERMAL.falloffStart) return 1;
  if (dist >= THERMAL.range) return 0;
  const u = (dist - THERMAL.falloffStart) / (THERMAL.range - THERMAL.falloffStart);
  return 1 - u * u * (3 - 2 * u);
}

/** Pushes a mesh (or a Group's visible child meshes, or a bare Object3D) into `out` without allocating. */
function pushThermalObject(obj: THREE.Object3D, out: THREE.Object3D[]): void {
  if ((obj as THREE.Mesh).isMesh || obj.children.length === 0) {
    out.push(obj);
    return;
  }
  const before = out.length;
  for (let i = 0; i < obj.children.length; i++) {
    const child = obj.children[i]!;
    if (child.visible && (child as THREE.Mesh).isMesh) out.push(child);
  }
  if (out.length === before) out.push(obj);
}

export class Chips {
  readonly rack: ChipRack;
  /** The slot in hand. */
  index = 0;
  thermal = false;
  focus = false;
  /** 0..1. */
  meter = 1;
  /** Seconds until the meter refills. */
  private rest = 0;
  /** Seconds until Gun Kata works again. */
  kataWait = 0;
  /** Gun Kata's charge while T is held, 0 to 1; -1 when it is not charging. */
  kataCharge = -1;
  /** Why a press of T on Gun Kata could not start a charge, said once the hold is past a tap; null when it could. */
  private kataNo: string | null = null;
  /** Heartbeats played this charge. */
  private beats = 0;
  /** The men it would shoot now, lit red while it charges. */
  readonly kataLit: EnemyInstance[] = [];
  private readonly kataMeshes: THREE.Object3D[] = [];
  /** Seconds T has been held, and whether this hold has moved chips already. */
  private held = 0;
  private switched = false;
  /** Thermal's grade is held on progression's hold, until the view goes. */
  private graded = false;
  private readonly lit: THREE.Object3D[] = [];
  private readonly litMid: THREE.Object3D[] = [];
  private readonly litFar: THREE.Object3D[] = [];
  private readonly corpseWarm: THREE.Object3D[] = [];
  private readonly corpseCold: THREE.Object3D[] = [];
  private readonly sourceHot: THREE.Object3D[] = [];
  private readonly sourceWarm: THREE.Object3D[] = [];
  private readonly aliveMeshes = new Set<THREE.Object3D>();
  private readonly corpses: ThermalCorpse[] = Array.from({ length: MAX_THERMAL_CORPSES }, () => ({
    mesh: null, diedAt: 0, pos: new THREE.Vector3(), active: false,
  }));
  private corpseCursor = 0;
  readonly badge: ChipBadge = { name: 'Sonar', color: CHIPS.sonar.color, lit: true, text: '', fill: 0, count: 1, index: 0 };

  constructor(private readonly ctx: Ctx, readonly sonar: Sonar, rack = new ChipRack()) {
    this.rack = rack;
    ctx.events.on('player:died', () => this.drop());
    ctx.events.on('enemy:killed', e => this.recordCorpse(e));
    // The shop's studio and the menus draw on the same canvas: they get it back clean, and the next frame of play puts it up again.
    ctx.events.on('game:state', e => {
      if (e.to !== 'playing') this.view(false);
    });
  }

  /** Convenience passthrough to `rack.setThermalSources`. */
  setThermalSources(provider: ThermalSourceProvider | null): void {
    this.rack.setThermalSources(provider);
  }

  get current(): ChipId | null {
    return this.rack.fitted[this.index] ?? null;
  }

  update(): void {
    const { input, time } = this.ctx;
    const n = this.rack.fitted.length;
    if (this.index >= n) this.index = 0;
    // A chip the shop took out stops.
    if (this.thermal && !this.rack.fitted.includes('thermal')) this.thermal = false;
    if (this.focus && !this.rack.fitted.includes('focus')) this.setFocus(false);
    let tap = false;
    if (this.kataCharge >= 0 && this.current !== 'kata') this.kataCharge = -1;
    if (this.current === 'kata') {
      // Gun Kata is held, not tapped: holding charges it, and with two brain chips a tap moves on.
      this.kataKey(n);
    } else if (n < 2) {
      tap = input.pressed('sonar');
    } else {
      if (input.pressed('sonar')) {
        this.held = 0;
        this.switched = false;
      }
      if (input.isDown('sonar')) {
        this.held += time.realDt;
        if (!this.switched && this.held >= HOLD_SWITCH) {
          this.switched = true;
          this.next();
        }
      }
      if (input.released('sonar') && !this.switched) tap = true;
    }
    const cur = this.current;
    if (tap && cur === null) this.ctx.audio.play('ui_error');
    if (tap && cur === 'thermal') this.setThermal(!this.thermal);
    if (tap && cur === 'focus') this.setFocus(!this.focus);
    this.kataWait = Math.max(0, this.kataWait - time.playerDt);
    this.sonar.update(tap && cur === 'sonar');
    this.updateThermal();
    this.updateFocus(time.playerDt);
    this.updateBadge();
  }

  /** Hold T: the next chip in hand, called out with a click. */
  private next(): void {
    const n = this.rack.fitted.length;
    if (n < 2) return;
    this.index = (this.index + 1) % n;
    this.ctx.audio.play('ui_click');
    this.ctx.hud.callout?.(`${CHIPS[this.current!].name.toUpperCase()} BRAIN CHIP`);
  }

  setThermal(on: boolean): void {
    if (on && !this.ctx.player.alive) return;
    this.thermal = on;
    if (!on) this.view(false);
    this.ctx.audio.play('ui_toggle');
  }

  setFocus(on: boolean): void {
    const { audio, time } = this.ctx;
    if (on === this.focus) return;
    // A co-op lobby walk (a session with no world yet): there is no host clock to ask and nobody to tell, and no slow-mo may
    // start on any screen without the team's notice. So none starts, as before Focus worked in co-op.
    const lobbyWalk = !!this.ctx.coop && !this.ctx.coop.world;
    if (on && (lobbyWalk || !this.ctx.player.alive || this.meter < FOCUS.start)) {
      audio.play('ui_error');
      if (lobbyWalk) this.ctx.hud.callout?.('NO FOCUS BRAIN CHIP IN THE LOBBY');
      return;
    }
    this.focus = on;
    if (on) {
      // Co-op: the request goes to the host, who slows the world for the whole team and names this player on every screen
      // (net/world/clock.ts). The meter, the start share and the refill stay this player's own, as alone.
      time.pushScale('focus', FOCUS.scale, FOCUS.fadeIn, FOCUS.fadeOut);
      const world = this.ctx.coop?.world;
      if (world && !world.slowHeld('focus')) {
        // Refused on the spot (down, or the team's slow-mo budget is spent): the clock has said why. Nothing is spent.
        world.slowRefusal('focus');
        this.focus = false;
        return;
      }
      audio.play('ui_toggle');
    } else {
      time.popScale('focus');
      this.rest = FOCUS.delay;
    }
  }

  /** Gun Kata: the guns do it (weapons/kata.ts). Only a burst that went spends the charge; else the reason, and nothing spent. */
  /** T on Gun Kata: a press starts the charge (or says why not), a release calls it off, a quick one moves to the next chip. */
  private kataKey(n: number): void {
    const { input, time } = this.ctx;
    if (input.pressed('sonar')) {
      this.held = 0;
      this.kataNo = this.kataWhyNot();
      if (this.kataNo === null) this.startKata();
      else if (n < 2) this.refuseKata();
    }
    if (input.isDown('sonar')) {
      this.held += time.realDt;
      // With two brain chips a short press is the switch, so the refusal waits until it is plainly a hold.
      if (this.kataNo !== null && this.held >= HOLD_SWITCH) this.refuseKata();
    }
    if (input.released('sonar')) {
      if (this.kataCharge >= 0) this.kataCharge = -1;
      if (n >= 2 && this.held < HOLD_SWITCH) this.next();
      this.kataNo = null;
    }
    if (this.kataCharge >= 0) this.chargeKata(time.realDt);
  }

  private kataWhyNot(): string | null {
    if (!this.ctx.player.alive) return 'NOT NOW';
    if (this.kataWait > 0) return `GUN KATA ${Math.ceil(this.kataWait)} S`;
    return this.ctx.weapons.akimbo ? null : 'NEEDS AKIMBO';
  }

  private refuseKata(): void {
    this.ctx.audio.play('ui_error');
    this.ctx.hud.callout?.(this.kataNo ?? 'NOT NOW');
    this.kataNo = null;
  }

  private startKata(): void {
    this.kataCharge = 0;
    this.beats = 0;
  }

  /**
   * One frame of the charge: the men it would shoot lit red, a heartbeat that quickens, the edges of the screen closing in and the
   * colour going (player/feedback.ts reads `kataFocus`), and at full charge the burst. Two guns gone, or the player, calls it off.
   */
  private chargeKata(dt: number): void {
    const { audio, render, weapons } = this.ctx;
    if (!weapons.akimbo || !this.ctx.player.alive) {
      this.kataCharge = -1;
      this.kataNo = weapons.akimbo ? 'NOT NOW' : 'NEEDS AKIMBO';
      this.refuseKata();
      return;
    }
    this.kataCharge = Math.min(1, this.kataCharge + dt / KATA.charge);
    if (this.kataCharge >= this.beats * 0.4) {
      audio.play('heartbeat', { pitch: 1 + this.beats * 0.18, volume: 0.6 + this.beats * 0.2 });
      this.beats++;
    }
    const lit = weapons.kataTargets?.(this.kataLit) ?? this.kataLit;
    const meshes = this.kataMeshes;
    meshes.length = 0;
    for (const e of lit) meshes.push(e.char.mesh);
    render.highlight(meshes, KATA.red, 0.45 + 0.55 * this.kataCharge);
    if (this.kataCharge >= 1) {
      this.kataCharge = -1;
      this.kata();
    }
  }

  /** How far into a Gun Kata charge the player is, 0 to 1: the screen closes in with it. */
  get kataFocus(): number {
    return Math.max(0, this.kataCharge);
  }

  kata(): void {
    const { audio, hud, render } = this.ctx;
    if (this.kataWait > 0 || !this.ctx.player.alive) {
      audio.play('ui_error');
      return;
    }
    const got = this.ctx.weapons.kata?.() ?? 'noAkimbo';
    if (got !== 'go') {
      audio.play('ui_error');
      hud.callout?.(got === 'noAkimbo' ? 'NEEDS AKIMBO' : got === 'noTargets' ? 'NO TARGETS IN SIGHT' : 'NOT NOW');
      return;
    }
    this.kataWait = KATA.cooldown;
    // A red breath over the screen and the brain chip's name: the burst itself is the tracers.
    render.post.flash(CHIPS.kata.color, 0.28, 0.5);
    render.post.chromatic(0.5, 0.35);
    audio.play('ui_toggle', { pitch: 0.7 });
    hud.callout?.('GUN KATA');
    this.ctx.events.emit('chip:kata', {});
  }

  /** Records a non-gibbed enemy corpse into the 24-slot ring buffer for thermal cooling decay. */
  private recordCorpse(e: { enemy?: EnemyInstance; gibbed?: boolean; sliced?: boolean }): void {
    if (e.gibbed || e.sliced) return;
    const enemy = e.enemy;
    const mesh = enemy?.char?.mesh;
    if (!mesh) return;
    const slot = this.corpses[this.corpseCursor]!;
    this.corpseCursor = (this.corpseCursor + 1) % MAX_THERMAL_CORPSES;
    slot.mesh = mesh;
    slot.diedAt = this.ctx.time.elapsed;
    if (enemy.position) slot.pos.copy(enemy.position);
    else mesh.getWorldPosition(slot.pos);
    slot.active = true;
  }

  private clearCorpses(): void {
    for (let i = 0; i < MAX_THERMAL_CORPSES; i++) {
      const slot = this.corpses[i]!;
      slot.active = false;
      slot.mesh = null;
      slot.diedAt = 0;
    }
    this.corpseCursor = 0;
  }

  /** FLIR grade while active and on foot; highlights living enemies, cooling corpses, and registered heat sources. */
  private updateThermal(): void {
    const { player, render, time } = this.ctx;
    if (!this.view(this.thermal && player.alive && !player.parked)) return;

    const origin = player.position ?? player.eye;
    const { lit, litMid, litFar, corpseWarm, corpseCold, sourceHot, sourceWarm, aliveMeshes } = this;
    lit.length = 0;
    litMid.length = 0;
    litFar.length = 0;
    corpseWarm.length = 0;
    corpseCold.length = 0;
    sourceHot.length = 0;
    sourceWarm.length = 0;
    aliveMeshes.clear();

    const r2 = THERMAL.range * THERMAL.range;
    const falloff2 = THERMAL.falloffStart * THERMAL.falloffStart;
    let midFadeSum = 0;
    let farFadeSum = 0;

    for (const e of this.ctx.enemies.alive) {
      aliveMeshes.add(e.char.mesh);
      const d2 = e.position.distanceToSquared(origin);
      if (d2 >= r2) continue;
      if (d2 <= falloff2) {
        lit.push(e.char.mesh);
      } else {
        const fade = thermalFalloff(Math.sqrt(d2));
        if (fade >= 0.5) {
          litMid.push(e.char.mesh);
          midFadeSum += fade;
        } else if (fade > 0) {
          litFar.push(e.char.mesh);
          farFadeSum += fade;
        }
      }
    }

    if (lit.length > 0) render.highlight(lit, THERMAL.enemyColor, 1, THERMAL.visibleFill);
    if (litMid.length > 0) {
      const fade = midFadeSum / litMid.length;
      render.highlight(litMid, THERMAL.enemyColor, fade, THERMAL.visibleFill * fade);
    }
    if (litFar.length > 0) {
      const fade = farFadeSum / litFar.length;
      render.highlight(litFar, THERMAL.enemyFarColor, fade, THERMAL.visibleFill * fade);
    }

    // Cooling corpses (fading orange-red over THERMAL_CORPSE_COOL seconds)
    const now = time.elapsed;
    let corpseWarmSum = 0;
    let corpseColdSum = 0;
    for (let i = 0; i < MAX_THERMAL_CORPSES; i++) {
      const slot = this.corpses[i]!;
      if (!slot.active || !slot.mesh) continue;
      const age = now - slot.diedAt;
      if (age < 0 || age >= THERMAL.corpseCool) {
        slot.active = false;
        slot.mesh = null;
        continue;
      }
      if (aliveMeshes.has(slot.mesh)) {
        // Pooled character recycled for a live enemy after roster flush.
        if (age > 0.5) {
          slot.active = false;
          slot.mesh = null;
        }
        continue;
      }
      if (!slot.mesh.visible) continue;
      if (slot.mesh.parent) slot.mesh.getWorldPosition(_pos);
      else _pos.copy(slot.pos);
      const d2 = _pos.distanceToSquared(origin);
      if (d2 >= r2) continue;
      const distFade = d2 <= falloff2 ? 1 : thermalFalloff(Math.sqrt(d2));
      if (distFade <= 0) continue;
      const cool = 1 - age / THERMAL.corpseCool;
      const heat = Math.pow(cool, 1.3) * distFade;
      if (cool > 0.45) {
        corpseWarm.push(slot.mesh);
        corpseWarmSum += heat;
      } else {
        corpseCold.push(slot.mesh);
        corpseColdSum += heat;
      }
    }

    if (corpseWarm.length > 0) {
      const heat = corpseWarmSum / corpseWarm.length;
      render.highlight(corpseWarm, THERMAL.corpseHotColor, heat * 0.85, 0.65 * heat);
    }
    if (corpseCold.length > 0) {
      const heat = corpseColdSum / corpseCold.length;
      render.highlight(corpseCold, THERMAL.corpseCoolColor, heat * 0.7, 0.45 * heat);
    }

    // Registered environmental heat sources (bulbs, breakers, security cameras, alarm panels)
    const sources = this.rack.thermalSources?.();
    if (sources) {
      let hotFadeSum = 0;
      for (let i = 0; i < sources.hot.length; i++) {
        const obj = sources.hot[i]!;
        if (!obj.visible) continue;
        obj.getWorldPosition(_pos);
        const d2 = _pos.distanceToSquared(origin);
        if (d2 >= r2) continue;
        const fade = d2 <= falloff2 ? 1 : thermalFalloff(Math.sqrt(d2));
        if (fade <= 0) continue;
        const before = sourceHot.length;
        pushThermalObject(obj, sourceHot);
        hotFadeSum += fade * (sourceHot.length - before);
      }
      if (sourceHot.length > 0) {
        const fade = hotFadeSum / sourceHot.length;
        render.highlight(sourceHot, THERMAL.sourceHotColor, 0.85 * fade, 0.72 * fade);
      }

      let warmFadeSum = 0;
      for (let i = 0; i < sources.warm.length; i++) {
        const obj = sources.warm[i]!;
        if (!obj.visible) continue;
        obj.getWorldPosition(_pos);
        const d2 = _pos.distanceToSquared(origin);
        if (d2 >= r2) continue;
        const fade = d2 <= falloff2 ? 1 : thermalFalloff(Math.sqrt(d2));
        if (fade <= 0) continue;
        const before = sourceWarm.length;
        pushThermalObject(obj, sourceWarm);
        warmFadeSum += fade * (sourceWarm.length - before);
      }
      if (sourceWarm.length > 0) {
        const fade = warmFadeSum / sourceWarm.length;
        render.highlight(sourceWarm, THERMAL.sourceWarmColor, 0.65 * fade, 0.52 * fade);
      }
    }
  }

  /** Puts the FLIR thermal grade up or takes it down. Never uses CSS invert(1). Returns `on`. */
  private view(on: boolean): boolean {
    const style = this.ctx.render.renderer?.domElement?.style;
    if (on) {
      if (style && style.filter !== THERMAL.filter) style.filter = THERMAL.filter;
      if (!this.graded) {
        this.ctx.render.post?.setGrade('thermal', THERMAL.gradeBlend);
        this.grades?.holdGrade?.('thermal');
        this.graded = true;
      }
      return true;
    }
    // A dead man's screen is the death grade's; the hold goes when he is back, or at the next run.
    if (this.graded && this.ctx.player.alive) {
      this.graded = false;
      this.ctx.render.post?.setGrade('default', THERMAL.gradeBlend);
      this.grades?.holdGrade?.(null);
    }
    return false;
  }

  private updateFocus(dt: number): void {
    if (this.focus) {
      const world = this.ctx.coop?.world;
      if (world && !world.slowHeld('focus')) {
        // Co-op: the host refused or ended it (this player went down, or the team's budget ran out). The chip goes off with it.
        world.slowRefusal('focus');
        this.focus = false;
        this.rest = FOCUS.delay;
        return;
      }
      this.meter = Math.max(0, this.meter - dt / FOCUS.seconds);
      if (this.meter <= 0) this.setFocus(false);
      return;
    }
    if (this.rest > 0) {
      this.rest -= dt;
      return;
    }
    this.meter = Math.min(1, this.meter + dt / FOCUS.refill);
  }

  private updateBadge(): void {
    const b = this.badge;
    const cur = this.current;
    b.count = this.rack.fitted.length;
    b.index = this.index;
    if (cur === null) {
      Object.assign(b, { name: 'No brain chip', color: 'var(--dim)', lit: false, text: '', fill: 0 });
      return;
    }
    b.name = CHIPS[cur].name;
    b.color = CHIPS[cur].color;
    if (cur === 'sonar') {
      const wait = this.sonar.wait;
      b.lit = wait <= 0;
      b.text = b.lit ? '' : String(Math.ceil(wait));
      b.fill = b.lit ? 0 : 1 - wait / Math.max(this.sonar.limit, 0.001);
    } else if (cur === 'thermal') {
      b.lit = this.thermal;
      b.text = this.thermal ? 'ON' : 'OFF';
      b.fill = 0;
    } else if (cur === 'kata' && this.kataCharge >= 0) {
      b.lit = true;
      b.text = 'HOLD';
      b.fill = this.kataCharge;
    } else if (cur === 'kata') {
      b.lit = this.kataWait <= 0 && this.ctx.weapons.akimbo === true;
      b.text = this.kataWait > 0 ? String(Math.ceil(this.kataWait)) : this.ctx.weapons.akimbo ? '' : 'AKIMBO';
      b.fill = this.kataWait > 0 ? 1 - this.kataWait / KATA.cooldown : 0;
    } else {
      b.lit = this.focus || this.meter >= FOCUS.start;
      b.text = `${Math.floor(this.meter * 100)}`;
      b.fill = this.meter;
    }
  }

  /** Death: the toggles go off. */
  private drop(): void {
    this.kataCharge = -1;
    this.thermal = false;
    this.setFocus(false);
    this.view(false);
  }

  reset(): void {
    this.rack.reset();
    this.index = 0;
    this.thermal = false;
    if (this.focus) this.ctx.time.popScale('focus');
    this.focus = false;
    this.meter = 1;
    this.rest = 0;
    this.kataWait = 0;
    this.kataCharge = -1;
    this.kataNo = null;
    this.held = 0;
    this.switched = false;
    this.view(false);
    if (this.graded) {
      this.ctx.render.post?.setGrade('default', THERMAL.gradeBlend);
      this.grades?.holdGrade?.(null);
    }
    this.graded = false;
    this.clearCorpses();
    this.sonar.reset();
  }

  private get grades(): Grades {
    return this.ctx.progression as unknown as Grades;
  }
}
