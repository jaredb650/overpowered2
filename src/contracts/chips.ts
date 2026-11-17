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
import type * as THREE from 'three';
import type { Ctx, GradeName } from '../core/contracts';
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

/** Thermal: the AC-130's black-hot sensor (callins/ac130.ts VIEWS), worn on foot. No limit: T turns it on and off. */
export const THERMAL = {
  /**
   * The AC-130's black-hot picture, over the canvas only, so the HUD keeps its colours. Dimmed: from the ground the night sky
   * inverts to white, and the HUD's white text has to read over it.
   */
  filter: 'grayscale(1) invert(1) brightness(0.6) contrast(1.3)',
  /** Bodies glow this through the filter: white, inverted to black. Black is hot. */
  enemyColor: '#ffffff',
  /** Metres it reads heat at, through cover too. Past it Sonar is still the chip for the whole map. */
  range: 40,
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
    does: `Tap: the gunship's black-hot view, on or off, for as long as you like. Bodies read black through cover out to ${THERMAL.range} m.`,
    lore: 'The gunship\'s sensor, refitted behind the eyes. The world goes grey and everyone in it goes black. The Council insists this is not a metaphor.',
  },
  focus: {
    id: 'focus', name: 'Focus', price: 2200, wave: 6, color: '#ffc14a',
    does: `Tap: the world at ${FOCUS.scale}x while you move at full speed, on a ${FOCUS.seconds} s meter that refills in ${FOCUS.refill} s. Tap again to stop.`,
    lore: 'A brain chip that makes everyone else slow. It cannot make them stupid; the Council sells that separately, to the other side.',
  },
  kata: {
    id: 'kata', name: 'Gun Kata', price: 2600, wave: 10, color: '#ff3d6e',
    does: `Tap, with two guns in hand (akimbo): a head shot into every man within ${KATA.radius} m and in sight, all the way round, in about a second, from your magazines. ${KATA.cooldown} s to recharge.`,
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
  /** Seconds T has been held, and whether this hold has moved chips already. */
  private held = 0;
  private switched = false;
  /** Thermal's grade is held on progression's hold, until the view goes. */
  private graded = false;
  private readonly lit: THREE.Object3D[] = [];
  readonly badge: ChipBadge = { name: 'Sonar', color: CHIPS.sonar.color, lit: true, text: '', fill: 0, count: 1, index: 0 };

  constructor(private readonly ctx: Ctx, readonly sonar: Sonar, rack = new ChipRack()) {
    this.rack = rack;
    ctx.events.on('player:died', () => this.drop());
    // The shop's studio and the menus draw on the same canvas: they get it back clean, and the next frame of play puts it up again.
    ctx.events.on('game:state', e => {
      if (e.to !== 'playing') this.view(false);
    });
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
    if (n < 2) {
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
    if (tap && cur === 'kata') this.kata();
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
    this.ctx.audio.play('ui_toggle');
  }

  setFocus(on: boolean): void {
    const { audio, time } = this.ctx;
    if (on === this.focus) return;
    if (on && (this.ctx.coop || !this.ctx.player.alive || this.meter < FOCUS.start)) {
      // Co-op: one player's clock cannot slow the other's (docs/notes/coop.md), so Focus does nothing there.
      audio.play('ui_error');
      if (this.ctx.coop) this.ctx.hud.callout?.('NO FOCUS BRAIN CHIP IN CO-OP');
      return;
    }
    this.focus = on;
    if (on) {
      time.pushScale('focus', FOCUS.scale, FOCUS.fadeIn, FOCUS.fadeOut);
      audio.play('ui_toggle');
    } else {
      time.popScale('focus');
      this.rest = FOCUS.delay;
    }
  }

  /** Gun Kata: the guns do it (weapons/kata.ts). Only a burst that went spends the charge; else the reason, and nothing spent. */
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

  /** The canvas filter and the grade while on, and on foot; bodies in range lit. A gunner's seat has its own view. */
  private updateThermal(): void {
    const { player, render } = this.ctx;
    if (!this.view(this.thermal && player.alive && !player.parked)) return;
    const { lit } = this;
    lit.length = 0;
    const r2 = THERMAL.range * THERMAL.range;
    for (const e of this.ctx.enemies.alive) if (e.position.distanceToSquared(player.position) <= r2) lit.push(e.char.mesh);
    render.highlight(lit, THERMAL.enemyColor, 1);
  }

  /** Puts the black-hot picture up or takes it down. Returns `on`. */
  private view(on: boolean): boolean {
    const style = this.ctx.render.renderer.domElement.style;
    if (on) {
      if (style.filter !== THERMAL.filter) style.filter = THERMAL.filter;
      if (!this.graded) this.grades.holdGrade?.('thermal');
      this.graded = true;
      return true;
    }
    // Only our own filter: a seat's view sets its own.
    if (style.filter === THERMAL.filter) style.filter = '';
    // A dead man's screen is the death grade's; the hold goes when he is back, or at the next run.
    if (this.graded && this.ctx.player.alive) {
      this.graded = false;
      this.grades.holdGrade?.(null);
    }
    return false;
  }

  private updateFocus(dt: number): void {
    if (this.focus) {
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
    } else if (cur === 'kata') {
      b.lit = this.kataWait <= 0 && this.ctx.weapons.akimbo === true;
      b.text = this.kataWait > 0 ? String(Math.ceil(this.kataWait)) : this.ctx.weapons.akimbo ? '' : 'AKIMBO';
      b.fill = this.kataWait > 0 ? 1 - this.kataWait / KATA.cooldown : 0;
    } else {
      b.lit = this.focus || this.meter >= FOCUS.start;
      b.text = this.ctx.coop ? 'CO-OP' : `${Math.floor(this.meter * 100)}`;
      b.fill = this.meter;
    }
  }

  /** Death: the toggles go off. */
  private drop(): void {
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
    this.held = 0;
    this.switched = false;
    this.view(false);
    if (this.graded) this.grades.holdGrade?.(null);
    this.graded = false;
    this.sonar.reset();
  }

  private get grades(): Grades {
    return this.ctx.progression as unknown as Grades;
  }
}
