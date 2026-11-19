/** The Gun Kata brain chip: who it shoots (kata.ts), the guns firing it (Weapons.kata), the akimbo gate, and the host letting it through. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../core/contracts';
import type { KataResult } from '../core/gameplay';
import { GameTime } from '../core/time';
import { CHIPS, CHIP_ORDER, Chips } from '../contracts/chips';
import { modWares } from '../contracts/shop/data';
import { lockWave } from '../contracts/shop/data';
import { Sonar } from '../contracts/sonar';
import { FINAL_WAVE } from '../enemies/commander/adaptations';
import { ClaimValidator } from '../net/authority';
import { WEAPONS } from './data';
import { KATA, kataTargets } from './kata';
import { makeRange, type Range } from './testkit';

const eye = new THREE.Vector3(0, 1, 0);
const ahead = new THREE.Vector3(0, 0, -1);

describe('who a kata shoots', () => {
  const at = (p: THREE.Vector3) => p;
  const all = () => true;

  it('takes every man in reach all the way round, in one clockwise sweep from straight ahead', () => {
    const front = new THREE.Vector3(1, 1, -10);
    const right = new THREE.Vector3(10, 1, 0);
    const behind = new THREE.Vector3(0, 1, 12);
    const left = new THREE.Vector3(-8, 1, -1);
    const frontLeft = new THREE.Vector3(-3, 1, -9);
    expect(kataTargets(eye, ahead, [left, behind, frontLeft, right, front], at, all)).toEqual([front, right, behind, left, frontLeft]);
  });

  it('leaves out a man past the radius, and one out of sight', () => {
    const near = new THREE.Vector3(0, 1, -5);
    const far = new THREE.Vector3(0, 1, -(KATA.radius + 1));
    const hidden = new THREE.Vector3(5, 1, 0);
    expect(kataTargets(eye, ahead, [near, far, hidden], at, (_f, to) => to !== hidden)).toEqual([near]);
  });

  it('keeps the nearest when there are more than it takes', () => {
    const men = Array.from({ length: KATA.most + 4 }, (_, i) => new THREE.Vector3(Math.sin(i) * (3 + i), 1, Math.cos(i) * (3 + i)));
    const got = kataTargets(eye, ahead, men, at, all);
    expect(got.length).toBe(KATA.most);
    for (const kept of got) expect(men.indexOf(kept)).toBeLessThan(KATA.most);
  });
});

describe('Gun Kata in the hands', () => {
  let r: Range;
  let hands: boolean[];
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
    hands = [];
    (r.ctx.viewmodel as unknown as Record<string, unknown>).fire = (_s: number, left = false) => hands.push(left);
  });

  it('does nothing and spends nothing without two guns', () => {
    r.weapons.give('ultramag');
    r.weapons.switchTo('ultramag');
    r.run(0.6);
    r.enemies.add(0, -8);
    const mag = r.weapons.ammo('ultramag').mag;
    expect(r.weapons.kata()).toBe('noAkimbo');
    r.run(1.5);
    expect(r.weapons.ammo('ultramag').mag).toBe(mag);
  });

  it('shoots every man round the player in the head, a gun at a time, from the magazine, in about a second', () => {
    r.weapons.give('ultramag');
    r.weapons.switchTo('ultramag');
    r.weapons.grantMod('ultramagAkimbo');
    r.weapons.fitMod('ultramagAkimbo', true);
    r.run(0.6);
    r.wall(-14, 1, 'concrete', 20, 2);
    const men = [r.enemies.add(0, -8), r.enemies.add(9, 2), r.enemies.add(-2, 10), r.enemies.add(-12, -3)];
    const far = r.enemies.add(0, 30);
    const walled = r.enemies.add(20, -18);
    const mag = r.weapons.ammo('ultramag').mag;
    expect(r.weapons.kata()).toBe('go');
    // A second kata cannot start inside the first.
    expect(r.weapons.kata()).toBe('busy');
    r.run(KATA.step * men.length + 0.1);
    for (const m of men) {
      expect(m.hits.length, `man at ${m.position.x}, ${m.position.z}`).toBe(1);
      expect(m.hits[0]!.region).toBe('head');
    }
    expect(far.hits.length).toBe(0);
    expect(walled.hits.length).toBe(0);
    expect(r.weapons.ammo('ultramag').mag).toBe(mag - men.length);
    expect(hands).toEqual([false, true, false, true]);
    expect(KATA.step * KATA.most).toBeLessThanOrEqual(1.5);
  });

  it('shoots exactly the men the charge lit red', () => {
    r.weapons.give('rivet');
    r.weapons.switchTo('rivet');
    r.weapons.grantMod('rivetAkimbo');
    r.weapons.fitMod('rivetAkimbo', true);
    r.run(0.6);
    r.wall(-14, 1, 'concrete', 20, 2);
    const all = [r.enemies.add(3, -6), r.enemies.add(-7, 4), r.enemies.add(0, 30), r.enemies.add(20, -18), r.enemies.add(5, 9)];
    const lit = [...r.weapons.kataTargets([])];
    expect(lit.length).toBe(3);
    expect(r.weapons.kata()).toBe('go');
    r.run(1);
    expect(all.filter(m => m.hits.length > 0)).toEqual(expect.arrayContaining(lit));
    expect(all.filter(m => m.hits.length > 0).length).toBe(lit.length);
  });

  it('says so when nobody is in reach, and spends nothing', () => {
    r.weapons.give('rivet');
    r.weapons.switchTo('rivet');
    r.weapons.grantMod('rivetAkimbo');
    r.weapons.fitMod('rivetAkimbo', true);
    r.run(0.6);
    r.enemies.add(0, -40);
    expect(r.weapons.kata()).toBe('noTargets');
  });
});

describe('the Gun Kata brain chip', () => {
  /** Stand-in men, with the meshes the highlight lights. */
  const men = [0, 1, 2].map(i => ({ alive: true, char: { mesh: new THREE.Object3D() }, id: i }));
  /**
   * The chip on T with a stand-in arsenal that answers `answer`, and a second brain chip (Sonar) fitted when `two`. `inReach` is
   * who the guns say a kata would shoot now.
   */
  function chipRig(answer: KataResult, two = false, inReach: unknown[] = men) {
    const pressed = new Set<string>(), down = new Set<string>(), released = new Set<string>();
    const sounds: string[] = [], callouts: string[] = [], events: string[] = [], flashes: unknown[] = [];
    const lit: unknown[][] = [];
    let asked = 0;
    const weapons = {
      akimbo: answer !== 'noAkimbo',
      kata: () => (asked++, answer),
      kataTargets: (out: unknown[]) => { out.length = 0; out.push(...inReach); return out; },
    };
    const ctx = {
      time: new GameTime(),
      input: { pressed: (a: string) => pressed.has(a), isDown: (a: string) => down.has(a), released: (a: string) => released.has(a), labelFor: () => 'T' },
      events: { on: () => {}, emit: (k: string) => events.push(k) },
      audio: { play: (id: string) => sounds.push(id) },
      hud: { callout: (t: string) => callouts.push(t) },
      player: { alive: true, parked: false, eye: new THREE.Vector3(), position: new THREE.Vector3() },
      enemies: { remaining: 10, alive: [] },
      world: { bounds: new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50)) },
      render: {
        renderer: { domElement: { style: { filter: '' } } }, sweep: () => {},
        highlight: (meshes: unknown[]) => lit.push([...meshes]),
        post: { flash: (...a: unknown[]) => flashes.push(a), chromatic: () => {} },
      },
      progression: { holdGrade: () => {} },
      weapons,
    } as unknown as Ctx;
    const chips = new Chips(ctx, new Sonar(ctx));
    if (two) chips.rack.openSlot();
    chips.rack.fit('kata', true);
    chips.index = chips.rack.fitted.indexOf('kata');
    const frame = (t: 'down' | 'held' | 'up' | 'none' = 'none') => {
      pressed.clear();
      released.clear();
      if (t === 'down') { pressed.add('sonar'); down.add('sonar'); }
      if (t === 'up') { released.add('sonar'); down.delete('sonar'); }
      ctx.time.tick(1 / 60);
      chips.update();
    };
    /** T down for `seconds` (held on after when `keep`), then up. */
    const hold = (seconds: number, keep = false) => {
      frame('down');
      for (let i = 1; i < Math.round(seconds * 60); i++) frame('held');
      if (!keep) frame('up');
    };
    return { chips, frame, hold, sounds, callouts, events, flashes, lit, weapons, asked: () => asked };
  }

  it('is sold, priced and locked to land by the break after wave 9 in Endless Humans', () => {
    expect(CHIP_ORDER).toContain('kata');
    expect(CHIPS.kata.price).toBeGreaterThan(CHIPS.focus.price);
    expect(lockWave('outpost', CHIPS.kata.wave)).toBeLessThanOrEqual(FINAL_WAVE - 1);
    // After the cheapest akimbo it needs.
    expect(CHIPS.kata.wave).toBeGreaterThanOrEqual(Math.min(...['smgAkimbo', 'rivetAkimbo'].map(id => modWares('crucible')[id as 'smgAkimbo'].wave)));
    expect(CHIPS.kata.does).toMatch(/akimbo/i);
    expect(CHIPS.kata.does).toMatch(/Hold T/);
    expect(KATA.charge).toBeGreaterThanOrEqual(1);
    expect(KATA.charge).toBeLessThanOrEqual(1.5);
  });

  it('says it needs akimbo, and keeps its charge, with one gun in hand', () => {
    const c = chipRig('noAkimbo');
    c.hold(0.5);
    expect(c.callouts).toContain('NEEDS AKIMBO');
    expect(c.sounds).toContain('ui_error');
    expect(c.chips.kataCharge).toBe(-1);
    expect(c.chips.kataWait).toBe(0);
    expect(c.chips.badge.text).toBe('AKIMBO');
    expect(c.asked()).toBe(0);
    expect(c.events).not.toContain('chip:kata');
  });

  it('charges while T is held and goes by itself at full charge, not a frame before', () => {
    const c = chipRig('go');
    c.hold(KATA.charge - 0.05, true);
    expect(c.asked()).toBe(0);
    expect(c.chips.kataCharge).toBeGreaterThan(0.9);
    expect(c.chips.badge.fill).toBeCloseTo(c.chips.kataCharge);
    expect(c.chips.kataFocus).toBeCloseTo(c.chips.kataCharge);
    expect(c.sounds.filter(s => s === 'heartbeat').length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 6; i++) c.frame('held');
    expect(c.asked()).toBe(1);
    expect(c.chips.kataCharge).toBe(-1);
    expect(c.chips.kataWait).toBeCloseTo(KATA.cooldown, 1);
    expect(c.callouts).toContain('GUN KATA');
    expect(c.flashes.length).toBe(1);
    expect(c.events).toContain('chip:kata');
    // Holding on after it went does nothing more, nor does a new hold while it recharges.
    c.frame('held');
    c.frame('up');
    c.hold(KATA.charge + 0.2);
    expect(c.asked()).toBe(1);
  });

  it('is called off with nothing spent when T is let go early', () => {
    const c = chipRig('go');
    c.hold(KATA.charge * 0.6);
    expect(c.asked()).toBe(0);
    expect(c.chips.kataCharge).toBe(-1);
    expect(c.chips.kataWait).toBe(0);
    expect(c.chips.kataFocus).toBe(0);
    // And a full hold right after works.
    c.hold(KATA.charge + 0.1);
    expect(c.asked()).toBe(1);
  });

  it('is called off if the second gun goes mid-charge', () => {
    const c = chipRig('go');
    c.hold(0.4, true);
    c.weapons.akimbo = false;
    c.frame('held');
    expect(c.chips.kataCharge).toBe(-1);
    expect(c.callouts).toContain('NEEDS AKIMBO');
    c.hold(KATA.charge + 0.1);
    expect(c.asked()).toBe(0);
  });

  it('lights red exactly the men the burst would shoot, every frame of the charge', () => {
    const c = chipRig('go', false, men.slice(0, 2));
    c.hold(0.3, true);
    expect(c.lit.length).toBeGreaterThan(10);
    for (const frame of c.lit) expect(frame).toEqual(men.slice(0, 2).map(m => m.char.mesh));
    // One walks out of reach: the next frame lights only the other.
    (c.weapons as { kataTargets: (out: unknown[]) => unknown[] }).kataTargets = out => { out.length = 0; out.push(men[0]); return out; };
    c.frame('held');
    expect(c.lit.at(-1)).toEqual([men[0]!.char.mesh]);
  });

  it('with two brain chips: a tap moves on to the next, a hold charges', () => {
    const c = chipRig('go', true);
    c.hold(0.1);
    expect(c.chips.current).not.toBe('kata');
    c.chips.index = c.chips.rack.fitted.indexOf('kata');
    c.hold(KATA.charge + 0.1);
    expect(c.chips.current).toBe('kata');
    expect(c.asked()).toBe(1);
  });
});

describe('the host and a guest\'s kata', () => {
  /** Shots `gap` ms apart from one guest on `weapon`: how many the host takes. */
  function burst(v: ClaimValidator, weapon: string, gap: number, n: number, start: number, akimbo = false): number {
    let ok = 0;
    for (let i = 0; i < n; i++) if (v.acceptFire('guest', start + i + 1, weapon, start + i * gap, akimbo)) ok++;
    return ok;
  }

  it('takes a kata\'s whole burst from any akimbo gun, with or without the notice, and still turns down a flood', () => {
    const gap = KATA.step * 1000;
    // The burst outruns the gun's own rate; the host's limit for a gun that takes akimbo already has room for it (authority.ts `limitsOf`).
    expect(WEAPONS.ultramag.interval * 1000).toBeGreaterThan(gap);
    for (const gun of ['smg', 'rivet', 'ultramag', 'judge', 'autoraffica']) {
      expect(burst(new ClaimValidator(), gun, gap, KATA.most, 0), gun).toBe(KATA.most);
      // Every shot of it read by the host in one frame, after a hitch.
      expect(burst(new ClaimValidator(), gun, 0, KATA.most, 0), gun).toBe(KATA.most);
    }
    const v = new ClaimValidator();
    expect(v.kata('guest', 1000)).toBe(true);
    expect(burst(v, 'ultramag', gap, 14, 1000)).toBe(14);
    // A shot a millisecond for two seconds is not a kata.
    expect(burst(new ClaimValidator(), 'ultramag', 1, 2000, 0)).toBeLessThan(1000);
  });

  it('takes the Autoraffica akimbo\'s dual smart fire, a round from each gun in turn at twice the smart rate', () => {
    const gap = WEAPONS.autoraffica.smart!.interval * 1000 / 2;
    expect(burst(new ClaimValidator(), 'autoraffica', gap, 40, 0, true)).toBe(40);
  });

  it('lets akimbo through at twice the gun\'s rate', () => {
    const gap = WEAPONS.ultramag.interval * 1000 / 2;
    expect(burst(new ClaimValidator(), 'ultramag', gap, 40, 0, true)).toBe(40);
    // Under every fire-rate perk at once as well (2x), which the old check threw half of away.
    expect(burst(new ClaimValidator(), 'ultramag', gap / 2, 40, 0, true)).toBe(40);
  });
});
