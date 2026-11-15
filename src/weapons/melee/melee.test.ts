/**
 * Key 5 on the real Weapons and Combat, on real Rapier: the katana's reach, its step and its dash, a wall between, and
 * what each of the four new weapons sends into the damage model. The player's feet are moved here by hand from its
 * velocity, with the real stop rate, as the range sandbox does.
 */
import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WeaponId } from '../../core/gameplay';
import { MOVE } from '../../player/tuning';
import { WEAPONS } from '../data';
import { makeRange, type Dummy, type Range } from '../testkit';
import { KATANA, MELEE } from './data';

let r: Range;

beforeAll(async () => {
  r = await makeRange();
});

/** Draws `id` and waits out the draw. */
function hold(id: WeaponId): void {
  r.reset();
  r.player.position.set(0, 0, 0);
  r.player.eye.set(0, 1.6, 0);
  r.player.forward.set(0, 0, -1);
  r.player.velocity.set(0, 0, 0);
  r.weapons.give(id);
  r.weapons.switchTo(id);
  r.run(0.5);
}

/** A body whose front is `surface` meters ahead of the eye, along -Z. */
function ahead(surface: number, x = 0): Dummy {
  return r.enemies.add(x, -(surface + 0.35));
}

/** Runs `seconds`, moving the player by its velocity and slowing it as the ground does. */
function walk(seconds: number, fps = 60): void {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    r.run(1 / fps, fps);
    const v = r.player.velocity;
    const speed = Math.hypot(v.x, v.z);
    const next = Math.max(0, speed - MOVE.stopDecel / fps);
    if (speed > 0) v.multiplyScalar(next / speed);
    r.player.position.addScaledVector(v, 1 / fps);
    r.player.eye.set(r.player.position.x, 1.6, r.player.position.z);
  }
}

function click(action: 'fire' | 'aim' = 'fire'): void {
  r.input.simulate(action, true);
  r.run(1 / 60);
  r.input.simulate(action, false);
}

/** A click, and the swing's wind-up waited out: a heavy blow lands some way into its swing. */
function blow(action: 'fire' | 'aim' = 'fire'): void {
  click(action);
  r.run(0.3);
}

describe('katana reach', () => {
  beforeEach(() => hold('sword'));

  it('cuts on the frame of the click inside its reach', () => {
    const d = ahead(1.8);
    click();
    expect(d.hits.length).toBe(1);
    expect(d.hits[0]!.amount).toBe(WEAPONS.sword.damage);
    expect(d.hits[0]!.slicePlaneNormal).toBeDefined();
  });

  it('steps in for a body just out of reach, and cuts it', () => {
    const d = ahead(2.6);
    r.input.simulate('fire', true);
    walk(1 / 60);
    r.input.simulate('fire', false);
    expect(d.hits.length).toBe(0);
    expect(r.player.velocity.z).toBeLessThan(-3);
    walk(0.3);
    expect(d.hits.length).toBe(1);
    // A step, not a dash.
    expect(-r.player.position.z).toBeLessThan(MELEE.sword.step + 0.2);
  });

  it('standing still, nothing 4 m away is cut and nothing pulls the player there', () => {
    const d = ahead(4);
    r.input.simulate('fire', true);
    walk(0.9);
    r.input.simulate('fire', false);
    walk(0.3);
    expect(d.hits.length).toBe(0);
    expect(-r.player.position.z).toBeLessThan(0.05);
  });

  it('nothing behind a wall is cut, even inside reach', () => {
    // Off to the side of the range, where no other test stands: the range is shared and a wall stays.
    const x = 60;
    r.wall(-0.8, 0.3, 'concrete', x, 2);
    r.player.position.set(x, 0, 0);
    r.player.eye.set(x, 1.6, 0);
    const d = ahead(1.6, x);
    click();
    walk(0.3);
    expect(d.hits.length).toBe(0);
    const open = ahead(1.6, x + 5);
    r.player.position.set(x + 5, 0, 0);
    r.player.eye.set(x + 5, 1.6, 0);
    click();
    expect(open.hits.length).toBe(1);
  });

  it('nothing behind the player is cut', () => {
    const d = r.enemies.add(0, 1.2);
    click();
    walk(0.3);
    expect(d.hits.length).toBe(0);
  });

  it('dashes out of a run, to its own range and no further', () => {
    const d = ahead(5.5);
    r.player.velocity.set(0, 0, -12.5);
    r.input.simulate('fire', true);
    walk(1 / 60);
    r.input.simulate('fire', false);
    expect(-r.player.velocity.z).toBeGreaterThan(20);
    walk(0.35);
    expect(d.hits.length).toBe(1);

    hold('sword');
    const far = ahead(KATANA.dash.range + 2);
    r.player.velocity.set(0, 0, -12.5);
    click();
    expect(-r.player.velocity.z).toBeLessThan(13);
    walk(0.4);
    expect(far.hits.length).toBe(0);
  });

  it('the stab on right click: no charge, a meter past a slash, and no dash from idle', () => {
    const d = ahead(3.0);
    click('aim');
    expect(d.hits.length).toBe(1);
    expect(d.hits[0]!.source).toBe('sword_stab');
    expect(d.hits[0]!.amount).toBeCloseTo(WEAPONS.sword.damage * KATANA.stab.mult, 5);
    // A stab goes in, it does not split.
    expect(d.hits[0]!.slicePlaneNormal).toBeUndefined();

    hold('sword');
    const slashed = ahead(3.0);
    click();
    walk(0.4);
    expect(slashed.hits.length).toBe(0);

    hold('sword');
    const far = ahead(4.5);
    click('aim');
    walk(0.4);
    expect(far.hits.length).toBe(0);
    expect(-r.player.position.z).toBeLessThan(0.05);
  });

  it('a stab in a chain locks on to a body just past the slashes, dashes at him and stabs him', () => {
    // Off the crosshair, but inside the lock's cone: the stab goes at him, not where the crosshair points.
    const d = ahead(4.5, 0.6);
    click();
    walk(0.28);
    expect(d.hits.length).toBe(0);
    click('aim');
    expect(-r.player.velocity.z).toBeGreaterThan(15);
    walk(0.4);
    expect(d.hits.length).toBe(1);
    expect(d.hits[0]!.source).toBe('sword_stab');
    expect(-r.player.position.z).toBeGreaterThan(2);
    expect(-r.player.position.z).toBeLessThan(4.5);

    // Past the lock's range, or outside its cone, nothing pulls.
    hold('sword');
    const past = ahead(KATANA.lock.range + 1);
    const wide = ahead(4, 3);
    click();
    walk(0.28);
    click('aim');
    walk(0.4);
    expect(past.hits.length + wide.hits.length).toBe(0);
    expect(Math.hypot(r.player.position.x, r.player.position.z)).toBeLessThan(0.5);
  });

  it('a stab between slashes keeps the chain going', () => {
    click();
    walk(0.3);
    click('aim');
    walk(0.3);
    expect(r.weapons.swordStep).toBe(1);
    click();
    walk(0.05);
    expect(r.weapons.swordStep).toBe(2);
  });

  /** Presses `inputs` in order, `s` a slash and `t` a stab, each as the last swing ends. Returns the moves the HUD called. */
  function combo(inputs: string): string[] {
    const called: string[] = [];
    r.ctx.hud.callout = name => called.push(name);
    try {
      for (const k of inputs) {
        click(k === 's' ? 'fire' : 'aim');
        walk(0.3);
      }
      walk(0.6);
    } finally {
      r.ctx.hud.callout = undefined;
    }
    return called;
  }

  it('slash, slash, stab is the cleave: a heavy blow straight down', () => {
    const d = ahead(1.6);
    expect(combo('sst')).toEqual(['CLEAVE']);
    const blow = d.hits.find(h => h.source === 'sword_cleave');
    expect(blow?.amount).toBeCloseTo(WEAPONS.sword.damage * KATANA.moves.cleave.swing.mult, 5);
    // Down through him: the cut plane is upright.
    expect(Math.abs(blow!.slicePlaneNormal!.y)).toBeLessThan(0.1);
  });

  it('three slashes and a stab is the tornado: everything all round, cut across', () => {
    const front = ahead(1.0);
    const back = r.enemies.add(0, 1.8);
    const side = r.enemies.add(2.2, 0);
    expect(combo('ssst')).toEqual(['TORNADO']);
    for (const d of [back, side]) {
      const h = d.hits.find(x => x.source === 'sword_tornado');
      expect(h, 'struck by the tornado').toBeDefined();
      expect(Math.abs(h!.slicePlaneNormal!.y)).toBeGreaterThan(0.99);
    }
    expect(front.hits.some(h => h.source === 'sword_tornado')).toBe(true);
  });

  it('stab, stab, slash is the flying slash: it cuts everyone down its line and bursts on the wall', () => {
    const x = 80;
    r.player.position.set(x, 0, 0);
    r.player.eye.set(x, 1.6, 0);
    r.wall(-20, 0.5, 'concrete', x, 4);
    const line = [8, 12, 16].map(z => r.enemies.add(x + (z === 12 ? 1 : 0), -z));
    const off = r.enemies.add(x + 4, -10);
    const blasts = r.record.explosions;
    expect(combo('tts')).toEqual(['FLYING SLASH']);
    walk(0.4);
    for (const d of line) expect(d.hits.filter(h => h.source === 'sword_wave').length).toBeGreaterThan(0);
    expect(off.hits.length).toBe(0);
    expect(r.record.explosions).toBe(blasts + 1);
    expect(r.record.blasts.at(-1)!.z).toBeGreaterThan(-20.5);
  });

  it('slash, stab, stab is the flurry: six stabs on one body', () => {
    const d = ahead(2.0);
    expect(combo('stt')).toEqual(['FLURRY']);
    expect(d.hits.filter(h => h.source === 'sword_flurry').length).toBe(KATANA.flurryStabs);
  });

  it('held fire and mashed stabs never spell a move', () => {
    ahead(1.5);
    expect(combo('ssssss')).toEqual([]);
    hold('sword');
    ahead(1.5);
    expect(combo('tttt')).toEqual([]);
  });

  it('right click held past the stab is the guard: a parry as it comes up, a block after', () => {
    r.input.simulate('aim', true);
    walk(0.4);
    expect(r.weapons.guard(new THREE.Vector3(0, 0, 1))).toBe('parry');
    walk(0.4);
    expect(r.weapons.guard(new THREE.Vector3(0, 0, 1))).toBe('block');
    r.input.simulate('aim', false);
    walk(0.05);
    expect(r.weapons.guard(new THREE.Vector3(0, 0, 1))).toBe('none');
  });
});

describe('the four beside it', () => {
  it('are switched off: key 5 is the katana alone', () => {
    hold('sword');
    for (const id of ['knife', 'crowbar', 'shovel', 'baton'] as const) r.weapons.give(id);
    const seen: WeaponId[] = [];
    for (let i = 0; i < 2; i++) {
      r.tap('weapon5');
      r.run(0.4);
      seen.push(r.weapons.current);
    }
    expect(seen).toEqual(['sword', 'sword']);
  });

  it('the knife: short, and three times the cut from behind', () => {
    hold('knife');
    const front = ahead(1.2);
    click();
    expect(front.hits[0]?.amount).toBe(WEAPONS.knife.damage);
    expect(front.hits[0]?.type).toBe('slash');
    expect(front.hits[0]?.slicePlaneNormal).toBeUndefined();

    hold('knife');
    const back = ahead(1.2);
    back.yaw = Math.PI;
    click();
    expect(back.hits[0]?.amount).toBeCloseTo(WEAPONS.knife.damage * MELEE.knife.bonus!.mult, 5);

    hold('knife');
    const out = ahead(2.6);
    click();
    walk(0.3);
    expect(out.hits.length).toBe(0);
  });

  it('the knife thrust on right click', () => {
    hold('knife');
    const back = ahead(1.4);
    back.yaw = Math.PI;
    blow('aim');
    expect(back.hits[0]?.amount).toBeCloseTo(WEAPONS.knife.damage * MELEE.knife.heavy!.mult * MELEE.knife.bonus!.mult, 5);
  });

  it('the crowbar: a blow, no limb off, through plate for half again', () => {
    hold('crowbar');
    const d = ahead(1.4);
    blow();
    const h = d.hits[0]!;
    expect(h.type).toBe('melee');
    expect(h.severMult).toBe(0);
    expect(h.force).toBe(WEAPONS.crowbar.force);
    expect(h.amount).toBe(WEAPONS.crowbar.damage);

    hold('crowbar');
    const plated = ahead(1.4);
    plated.armor = 50;
    blow();
    expect(plated.hits[0]!.pierces).toBe(true);
    expect(plated.hits[0]!.amount).toBeCloseTo(WEAPONS.crowbar.damage * MELEE.crowbar.armour!.direct, 5);
  });

  it('the spade: the face is a heavy blow that takes nothing off, the edge is a cut', () => {
    hold('shovel');
    const d = ahead(2.0);
    blow();
    const flat = d.hits[0]!;
    expect(flat.type).toBe('melee');
    expect(flat.severMult).toBe(0);
    expect(flat.force).toBe(WEAPONS.shovel.force);

    hold('shovel');
    const e = ahead(1.8);
    blow('aim');
    const edge = e.hits[0]!;
    expect(edge.type).toBe('slash');
    expect(edge.severMult).toBe(WEAPONS.shovel.severMult);
    expect(edge.amount).toBeCloseTo(WEAPONS.shovel.damage * MELEE.shovel.heavy!.mult, 5);
  });

  it('the baton: three light blows to a chain, all push and little damage', () => {
    hold('baton');
    const d = ahead(1.3);
    r.input.simulate('fire', true);
    r.run(0.95);
    r.input.simulate('fire', false);
    const amounts = d.hits.map(h => h.amount);
    const b = WEAPONS.baton.damage;
    expect(amounts.slice(0, 3)).toEqual(MELEE.baton.chain.map(s => expect.closeTo(b * s.mult, 5)));
    expect(d.hits.every(h => h.type === 'melee' && h.severMult === 0)).toBe(true);
    expect(d.hits[0]!.force / d.hits[0]!.amount).toBeGreaterThan(5);
  });

  it('every new one stops at its own reach, standing still', () => {
    for (const id of ['knife', 'crowbar', 'shovel', 'baton'] as const) {
      hold(id);
      const m = MELEE[id];
      const longest = Math.max(...m.chain.map(s => s.reach));
      const past = ahead(longest + m.step + 0.6);
      r.input.simulate('fire', true);
      walk(1);
      r.input.simulate('fire', false);
      walk(0.4);
      expect(past.hits.length, id).toBe(0);
    }
  });

  it('the knife pays its bonus on a body reeling or on the floor, not only on a back', () => {
    hold('knife');
    const reeling = ahead(1.2) as Dummy & { stagger: number };
    reeling.stagger = 0.4;
    click();
    expect(reeling.hits[0]?.amount).toBeCloseTo(WEAPONS.knife.damage * MELEE.knife.bonus!.mult, 5);

    // On the floor, a body is low: the cut reaches down for it at a level look.
    hold('knife');
    const down = ahead(0.9) as Dummy & { downed: boolean };
    down.downed = true;
    click();
    expect(down.hits.length).toBe(1);
    expect(down.hits[0]!.amount).toBeCloseTo(WEAPONS.knife.damage * MELEE.knife.bonus!.mult, 5);
  });

  it('every one of the five meets a Skitter at the feet at a walking look', () => {
    for (const id of ['sword', 'knife', 'crowbar', 'shovel', 'baton'] as const) {
      hold(id);
      r.player.forward.set(0, -Math.sin(0.12), -Math.cos(0.12));
      const low = r.enemies.add(0, -1.0);
      (low.char as { rig: { height: number } }).rig = { ...low.char.rig, height: 0.72 };
      blow();
      expect(low.hits.length, id).toBeGreaterThan(0);
    }
  });

  it('under Butcher a blade takes everything and a club still takes nothing', () => {
    /** Draws `id` with Butcher on: a reset turns it off. */
    const butcher = (id: WeaponId): void => {
      hold(id);
      r.weapons.modifiers.alwaysSever = true;
    };
    try {
      butcher('crowbar');
      const club = ahead(1.4);
      blow();
      expect(club.hits[0]!.severMult).toBe(0);
      butcher('shovel');
      const face = ahead(1.8);
      blow();
      expect(face.hits[0]!.severMult).toBe(0);
      butcher('shovel');
      const edge = ahead(1.8);
      blow('aim');
      expect(edge.hits[0]!.severMult).toBe(1000);
      butcher('knife');
      const cut = ahead(1.2);
      click();
      expect(cut.hits[0]!.severMult).toBe(1000);
    } finally {
      r.weapons.modifiers.alwaysSever = false;
    }
  });

  it('the melee key swings what key 5 last drew', () => {
    // The four are off key 5, so the knife is drawn by hand, as the lab would with `?melee=four`.
    hold('knife');
    expect(r.weapons.current).toBe('knife');
    r.weapons.switchTo('smg');
    r.run(0.4);
    const d = ahead(1.2);
    click('melee' as 'fire');
    expect(d.hits[0]?.source).toBe('knife');
    r.run(0.6);
    expect(r.weapons.current).toBe('smg');
  });
});
