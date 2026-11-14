import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../core/contracts';
import { STIM } from './data';
import { Stims } from './stims';

function rig(health = 50) {
  const pressed = new Set<string>();
  const played: string[] = [];
  let occupied = 0;
  const player = {
    health, maxHealth: 100, alive: true, parked: false, grounded: true, sliding: false,
    velocity: new THREE.Vector3(8, 0, 0), modifiers: { speed: 1 },
    heal(n: number) { this.health = Math.min(this.maxHealth, this.health + n); },
  };
  const ctx = {
    player,
    input: { pressed: (a: string) => pressed.has(a) },
    audio: { play: (id: string) => played.push(id) },
    hud: { feed: () => undefined },
    events: { emit: () => undefined },
    weapons: { occupy: (s: number) => { occupied = s; } },
    render: { post: { flash: () => undefined } },
    progression: { targeting: null },
  } as unknown as Ctx;
  const stims = new Stims(ctx);
  const step = (seconds: number, press = false) => {
    if (press) pressed.add('stim');
    stims.update(seconds);
    pressed.clear();
  };
  return { stims, player, played, step, occupied: () => occupied };
}

describe('stims', () => {
  it('caps the kit and gives back what did not fit', () => {
    const { stims } = rig();
    expect(stims.count).toBe(STIM.start);
    expect(stims.give(10)).toBe(STIM.max - STIM.start);
    expect(stims.count).toBe(STIM.max);
    expect(stims.full).toBe(true);
    expect(stims.give(1)).toBe(0);
  });

  it('spends one from outside, and refuses when there is none', () => {
    const { stims } = rig();
    expect(stims.spend()).toBe(true);
    expect(stims.count).toBe(STIM.start - 1);
    stims.count = 0;
    expect(stims.spend()).toBe(false);
    expect(stims.count).toBe(0);
  });

  it('will not inject at full health', () => {
    const { stims, played, step } = rig(100);
    step(0.016, true);
    expect(stims.count).toBe(STIM.start);
    expect(stims.injecting).toBe(-1);
    expect(played).toContain('ui_error');
  });

  it('injects: weapons held for the whole second, heal at the needle, slow feet, one stim per double press', () => {
    const { stims, player, played, step, occupied } = rig(40);
    stims.give(1);
    step(0.016, true);
    expect(stims.count).toBe(STIM.start);
    expect(occupied()).toBe(STIM.seconds);
    expect(player.health).toBe(40);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeLessThan(8);
    step(0.1, true);
    expect(stims.count).toBe(STIM.start);
    for (let t = 0; t < STIM.injectAt; t += 0.05) step(0.05);
    expect(player.health).toBe(40 + STIM.heal);
    expect(played).toContain('stim_hiss');
    while (stims.injecting >= 0) step(0.01);
    expect(stims.injecting).toBe(-1);
    step(0.016, true);
    expect(stims.count).toBe(STIM.start);
    for (let t = 0; t < STIM.cooldown; t += 0.05) step(0.05);
    step(0.016, true);
    expect(stims.count).toBe(STIM.start - 1);
  });
});
