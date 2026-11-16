/** Brain chips on key T (chips.ts): tap and hold, the slots, Thermal's view, Focus's meter, Sonar as it was, and the shop. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../core/contracts';
import { GameTime } from '../core/time';
import { Loadout } from '../progression/implants';
import { CHIPS, CHIP_SLOT, ChipRack, Chips, FOCUS, HOLD_SWITCH, THERMAL } from './chips';
import { SONAR } from './data';
import { CrucibleShop } from './shop';
import { chipOffers, type ShopView } from './shop/rules';
import { Sonar } from './sonar';

const FPS = 60;

/** Just enough of the game for the chips: a key, the clocks, the canvas's style and a record of what was played and called. */
function rig() {
  const down = new Set<string>(), pressed = new Set<string>(), released = new Set<string>();
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const sounds: string[] = [], callouts: string[] = [], grades: (string | null)[] = [], events: string[] = [];
  const lit: number[] = [];
  const style = { filter: '' };
  const near = { position: new THREE.Vector3(0, 0, -10), char: { mesh: new THREE.Object3D() } };
  const far = { position: new THREE.Vector3(0, 0, -(THERMAL.range + 10)), char: { mesh: new THREE.Object3D() } };
  const player = { alive: true, parked: false, eye: new THREE.Vector3(0, 1.6, 0), position: new THREE.Vector3() };
  const ctx = {
    time: new GameTime(),
    input: {
      pressed: (a: string) => pressed.has(a), isDown: (a: string) => down.has(a), released: (a: string) => released.has(a),
      labelFor: () => 'T',
    },
    events: {
      on: (k: string, fn: (e: unknown) => void) => handlers.set(k, [...(handlers.get(k) ?? []), fn]),
      emit: (k: string, e: unknown) => {
        events.push(k);
        for (const fn of handlers.get(k) ?? []) fn(e);
      },
    },
    audio: { play: (id: string) => sounds.push(id) },
    hud: { callout: (t: string) => callouts.push(t) },
    player,
    enemies: { remaining: 10, alive: [near, far] },
    world: { bounds: new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50)) },
    render: {
      renderer: { domElement: { style } },
      highlight: (meshes: unknown[]) => lit.push(meshes.length),
      sweep: () => {},
    },
    progression: { holdGrade: (g: string | null) => grades.push(g) },
  } as unknown as Ctx & { coop?: unknown };
  const sonar = new Sonar(ctx);
  const chips = new Chips(ctx, sonar);
  /** One frame, with T going down, held, or coming up. */
  const frame = (t: 'down' | 'held' | 'up' | 'none' = 'none'): void => {
    pressed.clear();
    released.clear();
    if (t === 'down') {
      pressed.add('sonar');
      down.add('sonar');
    }
    if (t === 'up') {
      released.add('sonar');
      down.delete('sonar');
    }
    ctx.time.tick(1 / FPS);
    chips.update();
  };
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * FPS); i++) frame();
  };
  /** T down for `seconds`, then up. */
  const hold = (seconds: number): void => {
    frame('down');
    for (let i = 1; i < Math.round(seconds * FPS); i++) frame('held');
    frame('up');
  };
  return { ctx, chips, sonar, frame, run, hold, sounds, callouts, grades, events, lit, style, player };
}

let r: ReturnType<typeof rig>;
beforeEach(() => {
  r = rig();
});

describe('one chip: Sonar as it was', () => {
  it('starts on Sonar alone in one slot, pings on the press, and holds its cooldown', () => {
    expect(r.chips.rack.fitted).toEqual(['sonar']);
    expect(r.chips.rack.slots).toBe(1);
    r.frame('down');
    expect(r.events).toContain('sonar:tap');
    r.run(SONAR.tapLead + 0.05);
    expect(r.events).toContain('sonar:ping');
    expect(r.sonar.live).toBeGreaterThan(0);
    expect(r.sonar.wait).toBeGreaterThan(SONAR.cooldown - 0.3);
    r.frame('up');
    r.frame('down');
    expect(r.sounds).toContain('ui_error');
    expect(r.chips.badge).toMatchObject({ name: 'Sonar', lit: false, count: 1 });
    r.run(SONAR.cooldown);
    expect(r.sonar.wait).toBe(0);
    expect(r.chips.badge.lit).toBe(true);
  });

  it('a long hold with one chip is just a press: nothing to switch to', () => {
    r.hold(1);
    expect(r.events.filter(e => e === 'sonar:tap')).toHaveLength(1);
    expect(r.callouts).toEqual([]);
  });
});

describe('two slots: tap uses, hold switches', () => {
  beforeEach(() => {
    r.chips.rack.openSlot();
    r.chips.rack.fit('thermal', true);
  });

  it('a tap works the chip in hand on the release; a hold moves to the next, with a callout and a click, and uses nothing', () => {
    expect(r.chips.rack.fitted).toEqual(['sonar', 'thermal']);
    r.frame('down');
    expect(r.events).not.toContain('sonar:tap');
    r.frame('up');
    expect(r.events).toContain('sonar:tap');
    r.hold(HOLD_SWITCH + 0.1);
    expect(r.chips.current).toBe('thermal');
    expect(r.callouts).toEqual(['THERMAL BRAIN CHIP']);
    expect(r.sounds).toContain('ui_click');
    expect(r.chips.thermal).toBe(false);
    expect(r.chips.badge).toMatchObject({ name: 'Thermal', text: 'OFF', count: 2, index: 1 });
    r.hold(HOLD_SWITCH + 0.1);
    expect(r.chips.current).toBe('sonar');
  });

  it('a hold just short of the switch is still a tap', () => {
    r.hold(HOLD_SWITCH - 0.1);
    expect(r.chips.current).toBe('sonar');
    expect(r.events).toContain('sonar:tap');
  });
});

describe('the rack', () => {
  it('one slot: a new chip takes Sonar\'s place; the second slot opens once, and then both fit', () => {
    const rack = new ChipRack();
    expect(rack.replaces('thermal')).toBe('sonar');
    rack.fit('thermal', true);
    expect(rack.fitted).toEqual(['thermal']);
    expect(rack.owned.has('sonar')).toBe(true);
    expect(rack.openSlot()).toBe(true);
    expect(rack.openSlot()).toBe(false);
    expect(rack.replaces('sonar')).toBeNull();
    rack.fit('sonar', true);
    expect(rack.fitted).toEqual(['thermal', 'sonar']);
    rack.fit('focus', true);
    expect(rack.fitted).toEqual(['thermal', 'focus']);
    rack.fit('thermal', false);
    expect(rack.fitted).toEqual(['focus']);
    rack.reset();
    expect([rack.fitted, rack.slots, [...rack.owned]]).toEqual([['sonar'], 1, ['sonar']]);
  });
});

describe('Thermal', () => {
  beforeEach(() => r.chips.rack.fit('thermal', true));

  it('toggles the black-hot view on a tap: the canvas filter, the thermal grade, and bodies in range lit', () => {
    r.frame('down');
    expect(r.chips.thermal).toBe(true);
    expect(r.style.filter).toBe(THERMAL.filter);
    expect(r.grades).toEqual(['thermal']);
    expect(r.lit.at(-1)).toBe(1);
    expect(r.chips.badge).toMatchObject({ name: 'Thermal', text: 'ON', lit: true });
    r.run(30);
    expect(r.chips.thermal).toBe(true);
    r.frame('up');
    r.frame('down');
    expect(r.chips.thermal).toBe(false);
    expect(r.style.filter).toBe('');
    expect(r.grades).toEqual(['thermal', null]);
  });

  it('lets a gunner\'s seat have the screen, comes back on foot, and goes off at death', () => {
    r.frame('down');
    r.player.parked = true;
    r.frame('up');
    expect(r.style.filter).toBe('');
    expect(r.grades.at(-1)).toBeNull();
    r.style.filter = 'seat';
    r.frame();
    expect(r.style.filter).toBe('seat');
    r.player.parked = false;
    r.frame();
    expect(r.style.filter).toBe(THERMAL.filter);
    r.player.alive = false;
    r.ctx.events.emit('player:died', { source: 'x' });
    expect(r.chips.thermal).toBe(false);
    expect(r.style.filter).toBe('');
  });
});

describe('Focus', () => {
  beforeEach(() => r.chips.rack.fit('focus', true));

  it('slows the world, drains its meter at full, stops itself dry, and refills after its delay', () => {
    r.frame('down');
    expect(r.chips.focus).toBe(true);
    r.run(0.5);
    expect(r.ctx.time.slowmo).toBeCloseTo(FOCUS.scale, 2);
    r.run(FOCUS.seconds / 2 - 0.5);
    expect(r.chips.meter).toBeCloseTo(0.5, 1);
    r.run(FOCUS.seconds / 2 + 0.1);
    expect(r.chips.focus).toBe(false);
    expect(r.chips.meter).toBe(0);
    r.run(FOCUS.delay - 0.1);
    expect(r.chips.meter).toBe(0);
    r.run(1 + 0.2);
    expect(r.chips.meter).toBeCloseTo(1 / FOCUS.refill, 1);
    r.run(1);
    expect(r.ctx.time.slowmo).toBe(1);
  });

  it('needs a quarter of the meter to start, stops on a second tap, and does nothing in co-op', () => {
    r.chips.meter = FOCUS.start - 0.01;
    r.frame('down');
    expect(r.chips.focus).toBe(false);
    expect(r.sounds).toContain('ui_error');
    expect(r.chips.badge.lit).toBe(false);
    r.chips.meter = 1;
    r.frame('up');
    r.frame('down');
    expect(r.chips.focus).toBe(true);
    r.frame('up');
    r.frame('down');
    expect(r.chips.focus).toBe(false);
    r.ctx.coop = {} as never;
    r.frame('up');
    r.run(FOCUS.delay + 1);
    r.frame('down');
    expect(r.chips.focus).toBe(false);
    expect(r.callouts).toContain('NO FOCUS BRAIN CHIP IN CO-OP');
  });
});

describe('the shop', () => {
  const view = (over: Partial<ShopView> = {}): ShopView => ({
    credits: 100_000, inBreak: true, cleared: 10, owned: new Set(), mods: new Set(), fitted: new Set(),
    implants: new Set(), implantsFitted: new Set(), slots: 1, chips: new Set(['sonar']), chipsFitted: ['sonar'], chipSlots: 1, ...over,
  });

  it('sells the second slot, Thermal and Focus at their waves and prices; Sonar is issued', () => {
    const rows = chipOffers(view({ cleared: 0 }));
    expect(rows.map(o => o.act.kind === 'chip' ? o.act.id : 'slot')).toEqual(['slot', 'sonar', 'thermal', 'focus']);
    expect(rows.map(o => o.locked)).toEqual([true, false, true, true]);
    expect(rows[1]!.fitted && rows[1]!.ware.price === 0).toBe(true);
    const open = chipOffers(view());
    expect(open.map(o => o.why)).toEqual([null, null, null, null]);
    expect(open[2]!.replacesChip).toBe('sonar');
    expect(chipOffers(view({ cleared: CHIPS.thermal.wave - 1 }))[2]!.why).toMatch(/after wave/);
  });

  it('buys and fits through the rack, charges once, refits free, and opens the slot', () => {
    const rack = new ChipRack();
    const ctx = {
      waves: { wave: 10, phase: 'intermission' },
      weapons: { owned: new Set(), mods: new Set(), fitted: new Set() },
      progression: { loadout: new Loadout() },
    } as unknown as Ctx;
    const shop = new CrucibleShop(ctx, rack);
    shop.credits = 100;
    expect(shop.buy({ kind: 'chip', id: 'focus' })).toMatch(/^Need/);
    shop.credits = CHIP_SLOT.price + CHIPS.thermal.price;
    expect(shop.buy({ kind: 'chipSlot', id: 2 })).toBeNull();
    expect(rack.slots).toBe(2);
    expect(shop.buy({ kind: 'chip', id: 'thermal' })).toBeNull();
    expect(rack.fitted).toEqual(['sonar', 'thermal']);
    expect(shop.credits).toBe(0);
    expect(shop.buy({ kind: 'chip', id: 'thermal' })).toBeNull();
    expect(rack.fitted).toEqual(['sonar']);
    expect(shop.buy({ kind: 'chip', id: 'thermal' })).toBeNull();
    expect(rack.fitted).toEqual(['sonar', 'thermal']);
    expect(shop.credits).toBe(0);
    (ctx.waves as { phase: string }).phase = 'active';
    expect(shop.buy({ kind: 'chip', id: 'thermal' })).toBe('Between waves only');
  });
});
