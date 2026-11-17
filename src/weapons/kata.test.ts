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
  /** The chip on T with a stand-in arsenal that answers `answer`. */
  function chipRig(answer: KataResult) {
    const pressed = new Set<string>();
    const sounds: string[] = [], callouts: string[] = [], events: string[] = [], flashes: unknown[] = [];
    let asked = 0;
    const ctx = {
      time: new GameTime(),
      input: { pressed: (a: string) => pressed.has(a), isDown: () => false, released: () => false, labelFor: () => 'T' },
      events: { on: () => {}, emit: (k: string) => events.push(k) },
      audio: { play: (id: string) => sounds.push(id) },
      hud: { callout: (t: string) => callouts.push(t) },
      player: { alive: true, parked: false, eye: new THREE.Vector3(), position: new THREE.Vector3() },
      enemies: { remaining: 10, alive: [] },
      world: { bounds: new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50)) },
      render: { renderer: { domElement: { style: { filter: '' } } }, highlight: () => {}, sweep: () => {}, post: { flash: (...a: unknown[]) => flashes.push(a), chromatic: () => {} } },
      progression: { holdGrade: () => {} },
      weapons: { akimbo: answer !== 'noAkimbo', kata: () => (asked++, answer) },
    } as unknown as Ctx;
    const chips = new Chips(ctx, new Sonar(ctx));
    chips.rack.fit('kata', true);
    const tap = () => {
      pressed.add('sonar');
      ctx.time.tick(1 / 60);
      chips.update();
      pressed.clear();
    };
    return { chips, tap, sounds, callouts, events, flashes, asked: () => asked };
  }

  it('is sold, priced and locked to land by the break after wave 9 in Endless Humans', () => {
    expect(CHIP_ORDER).toContain('kata');
    expect(CHIPS.kata.price).toBeGreaterThan(CHIPS.focus.price);
    expect(lockWave('outpost', CHIPS.kata.wave)).toBeLessThanOrEqual(FINAL_WAVE - 1);
    // After the cheapest akimbo it needs.
    expect(CHIPS.kata.wave).toBeGreaterThanOrEqual(Math.min(...['smgAkimbo', 'rivetAkimbo'].map(id => modWares('crucible')[id as 'smgAkimbo'].wave)));
    expect(CHIPS.kata.does).toMatch(/akimbo/i);
  });

  it('says it needs akimbo, and keeps its charge, with one gun in hand', () => {
    const c = chipRig('noAkimbo');
    c.tap();
    expect(c.callouts).toContain('NEEDS AKIMBO');
    expect(c.sounds).toContain('ui_error');
    expect(c.chips.kataWait).toBe(0);
    expect(c.chips.badge.text).toBe('AKIMBO');
    expect(c.events).not.toContain('chip:kata');
  });

  it('goes with two: the charge is spent, the screen is tinted, the name called out and the host told', () => {
    const c = chipRig('go');
    c.tap();
    expect(c.chips.kataWait).toBeCloseTo(KATA.cooldown, 1);
    expect(c.callouts).toContain('GUN KATA');
    expect(c.flashes.length).toBe(1);
    expect(c.events).toContain('chip:kata');
    // Recharging: a tap does not reach the guns.
    c.tap();
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

  it('turns down a burst faster than the gun without a kata, and takes it all inside the kata window', () => {
    const gap = KATA.step * 1000;
    expect(WEAPONS.ultramag.interval * 650).toBeGreaterThan(gap);
    expect(burst(new ClaimValidator(), 'ultramag', gap, 8, 0)).toBeLessThan(8);
    const v = new ClaimValidator();
    expect(v.kata('guest', 1000)).toBe(true);
    expect(burst(v, 'ultramag', gap, 14, 1000)).toBe(14);
    // Past the window the gun's own rate holds again.
    expect(burst(v, 'ultramag', gap, 6, 1000 + KATA.window * 1000 + 100)).toBeLessThan(6);
  });

  it('opens the window once a charge: a guest cannot keep it open', () => {
    const v = new ClaimValidator();
    expect(v.kata('guest', 0)).toBe(true);
    expect(v.kata('guest', 3000)).toBe(false);
    expect(v.kata('guest', KATA.cooldown * 1000)).toBe(true);
  });

  it('lets akimbo through at twice the gun\'s rate, on a gun that takes it only', () => {
    const gap = WEAPONS.ultramag.interval * 1000 / 2;
    expect(burst(new ClaimValidator(), 'ultramag', gap, 6, 0, true)).toBe(6);
    expect(burst(new ClaimValidator(), 'ultramag', gap, 6, 0, false)).toBeLessThan(6);
    expect(burst(new ClaimValidator(), 'awl', WEAPONS.awl.interval * 1000 / 2, 4, 0, true)).toBeLessThan(4);
  });
});
