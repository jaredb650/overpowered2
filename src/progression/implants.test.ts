/** Implants (docs/proposals/implants.md): the loadout's rules, the gating, the caps and the toned Berserk. */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import type { KillEvent, ProgressionSystem } from '../core/gameplay';
import { noop } from '../core/stubs';
import { makeCtx } from '../sandbox/harness';
import { makeRange } from '../weapons/testkit';
import { STACK } from './data';
import { CAPS, CORE, DEFAULT_FITTED, IMPLANTS, IMPLANTS_ON, Loadout, SLOT_WARES, rungShown } from './implants';
import { implantCheat } from '../lab/implants';
import { createProgression } from './index';
import { PerkRunner } from './perks';

describe('the loadout', () => {
  it('starts on the default: Blood Thirst in the one open slot', () => {
    const l = new Loadout();
    expect(IMPLANTS_ON).toBe(true);
    expect([...l.fitted]).toEqual([...DEFAULT_FITTED]);
    expect(l.fitted.has('bloodthirst')).toBe(true);
    expect(l.slots).toBe(1);
    expect(SLOT_WARES.map(s => [s.price, s.wave])).toEqual([[0, 0], [1500, 5], [3000, 12]]);
  });

  it('holds one implant a class: a second of the class replaces the first', () => {
    const l = new Loadout();
    l.openSlot();
    l.openSlot();
    expect(l.replaces('berserk')).toBe('bloodthirst');
    expect(l.fit('berserk', true)).toBe(true);
    expect([...l.fitted]).toEqual(['berserk']);
    expect(l.fit('hellfire', true)).toBe(true);
    expect([...l.fitted]).toEqual(['hellfire']);
    expect(l.fit('butcher', true) && l.fit('skyfall', true)).toBe(true);
    expect(l.fit('chainStorm', true)).toBe(true);
    expect(new Set(l.fitted)).toEqual(new Set(['hellfire', 'chainStorm', 'skyfall']));
    const classes = [...l.fitted].map(id => IMPLANTS[id].class);
    expect(new Set(classes).size).toBe(classes.length);
  });

  it('needs a free slot for a new class, and three slots at most', () => {
    const l = new Loadout();
    expect(l.whyNotFit('butcher')).toBe('No free slot');
    expect(l.fit('butcher', true)).toBe(false);
    expect(l.fitted.has('butcher')).toBe(false);
    // A replacement needs no free slot.
    expect(l.fit('hellfire', true)).toBe(true);
    expect(l.openSlot()).toBe(true);
    expect(l.fit('butcher', true)).toBe(true);
    expect(l.openSlot()).toBe(true);
    expect(l.openSlot()).toBe(false);
    expect(l.slots).toBe(3);
    expect(l.fit('overdrive', true)).toBe(true);
    expect(l.fitted.size).toBe(3);
  });

  it('allows the core always, an implant only fitted, and a capsule always', () => {
    const l = new Loadout();
    for (const id of CORE) expect(l.allows(id)).toBe(true);
    expect(l.allows('bloodthirst')).toBe(true);
    expect(l.allows('berserk')).toBe(false);
    expect(l.allows('quad')).toBe(true);
    l.fit('bloodthirst', false);
    expect(l.allows('bloodthirst')).toBe(false);
    expect(l.allows('slowmo')).toBe(true);
  });

  it('shows Berserk and Chain Storm on the combo ladder only when fitted', () => {
    const l = new Loadout();
    expect(rungShown('Berserk')).toBe(false);
    expect(rungShown('Chain Storm')).toBe(false);
    expect(rungShown('Airstrike')).toBe(true);
    l.fit('berserk', true);
    expect(rungShown('Berserk')).toBe(true);
    l.reset();
    expect(rungShown('Berserk')).toBe(false);
  });

  it('lets the cheat panel grant, and fit past the slots but not past the class rule', () => {
    const l = new Loadout();
    implantCheat(l, 'chainStorm', 'grant');
    expect(l.owned.has('chainStorm')).toBe(true);
    expect(l.fitted.has('chainStorm')).toBe(false);
    implantCheat(l, 'chainStorm', 'fit');
    implantCheat(l, 'overdrive', 'fit');
    implantCheat(l, 'berserk', 'fit');
    expect(new Set(l.fitted)).toEqual(new Set(['chainStorm', 'overdrive', 'berserk']));
    implantCheat(l, 'berserk', 'fit');
    expect(l.fitted.has('berserk')).toBe(false);
  });

  it('goes back to the default on reset', () => {
    const l = new Loadout();
    l.openSlot();
    l.fit('berserk', true);
    l.fit('skyfall', true);
    l.reset();
    expect([...l.fitted]).toEqual(['bloodthirst']);
    expect([...l.owned]).toEqual(['bloodthirst']);
    expect(l.slots).toBe(1);
  });
});

/** A PerkRunner on stand-ins: what it writes to the weapons and the player is all these tests read. */
function runner(current = 'harrow') {
  const weapons = { current, modifiers: { shotLayers: [] as string[] } as Record<string, unknown> };
  const player = { modifiers: { speed: 1, invulnerable: false }, velocity: new THREE.Vector3() };
  const ctx = makeCtx({
    weapons: weapons as unknown as Ctx['weapons'], player: player as unknown as Ctx['player'],
    hud: noop('hud'), render: noop('render'), camera: noop('camera'), audio: noop('audio'),
  });
  const perks = new PerkRunner(ctx);
  return { perks, w: weapons.modifiers, p: player.modifiers, weapons };
}

describe('Berserk, toned down', () => {
  it('is 2x damage, 1.5x fire rate, 1.4x speed and no extra pellets, and still cannot die', () => {
    const { perks, w, p } = runner();
    perks.grant('berserk');
    perks.update(0.016);
    expect(w.damage).toBe(2);
    expect(w.fireRate).toBe(1.5);
    expect(w.pellets).toBe(1);
    expect(p.speed).toBeCloseTo(1.4);
    expect(p.invulnerable).toBe(true);
    expect(w.akimbo).toBe(true);
    expect(w.bottomlessMag).toBe(true);
    expect(w.explosiveRounds).toBe(false);
    expect(STACK.damage.berserk).toBe(2);
  });

  it('counts akimbo as 2x against the fire-rate cap on the SMG', () => {
    const { perks, w } = runner('smg');
    perks.grant('berserk');
    perks.update(0.016);
    // 1.5 x akimbo's 2 would be 3x: held at 2x, so the rate the guns read is 1.
    expect((w.fireRate as number) * 2).toBe(CAPS.fireRate);
  });
});

describe('the caps', () => {
  it('holds damage at 6x, fire rate at 2x and pellets at 2x', () => {
    const { perks, w } = runner();
    perks.grant('bloodthirst');
    perks.grant('quad');
    perks.grant('berserk');
    for (let i = 0; i < 5; i++) perks.grant('geneva');
    perks.update(0.016);
    // 2 x 4 x 2 x 2 = 32x uncapped.
    expect(w.damage).toBe(CAPS.damage);
    expect(w.fireRate).toBe(CAPS.fireRate);
    expect(w.pellets).toBe(2);
  });

  it('runs one capsule at a time: a new one ends the old, silently', () => {
    const { perks } = runner();
    perks.grant('quad');
    perks.grant('haste');
    expect(perks.isActive('quad')).toBe(false);
    expect(perks.isActive('haste')).toBe(true);
    // A perk is not a capsule, and a one-shot capsule never runs, so neither ends the one running.
    perks.grant('bloodthirst');
    perks.grant('frostNova');
    expect(perks.isActive('haste')).toBe(true);
    expect(perks.effects.map(e => e.id).sort()).toEqual(['bloodthirst', 'haste']);
  });

  it('puts at most six bullet blasts in a frame, and the rest hit as plain rounds', async () => {
    const r = await makeRange();
    r.reset();
    r.wall(-6, 1);
    (r.weapons.owned as Set<string>).add('shotgun');
    r.weapons.switchTo('shotgun');
    r.run(0.6);
    // Hellfire with Blood Thirst's pellets: twelve pellets into the wall in one pull.
    r.weapons.modifiers.explosiveRounds = true;
    r.weapons.modifiers.pellets = 2;
    r.record.explosions = 0;
    r.input.simulate('fire', true);
    r.run(1 / 60);
    r.input.simulate('fire', false);
    expect(r.record.impacts.length).toBeGreaterThanOrEqual(12);
    expect(r.record.explosions).toBe(CAPS.blastsPerFrame);
    // The next frame has its own six.
    r.run(0.6);
    r.record.explosions = 0;
    r.input.simulate('fire', true);
    r.run(1 / 60);
    expect(r.record.explosions).toBe(CAPS.blastsPerFrame);
  });
});

// The systems that hang off progression and build DOM, physics probes or models: stand-ins, as nothing here reads them.
const { stand } = vi.hoisted(() => ({
  stand: (name: string) => async () => {
    const { noop: stub } = await import('../core/stubs');
    return { [name]: class { constructor() { return stub(name); } } };
  },
}));
vi.mock('./callins/manager', stand('CallInManager'));
vi.mock('./sentinels', stand('Sentinels'));
vi.mock('./pickups/pickups', stand('Pickups'));
vi.mock('./pickups/pods', stand('DropPods'));
vi.mock('./frost', stand('FrostNova'));

/** The real progression on stand-ins, fed kills by event. */
function progression() {
  // The score keeper saves on pagehide.
  vi.stubGlobal('window', { addEventListener: () => undefined });
  const player = {
    modifiers: { speed: 1, invulnerable: false }, velocity: new THREE.Vector3(), grounded: true, eye: new THREE.Vector3(),
    position: new THREE.Vector3(), heal: () => undefined, alive: true,
  };
  const weapons = { current: 'harrow', modifiers: { shotLayers: [] as string[] }, refillMagazines: () => undefined, addAmmo: () => undefined };
  const waves = { phase: 'combat', wave: 1 };
  const ctx = makeCtx({
    player: player as unknown as Ctx['player'], weapons: weapons as unknown as Ctx['weapons'],
    waves: waves as unknown as Ctx['waves'],
    hud: noop('hud'), enemies: noop('enemies'), combat: noop('combat'), viewmodel: noop('viewmodel'), contracts: noop('contracts'),
  });
  const prog = createProgression(ctx) as ProgressionSystem & { loadout: Loadout; init(): void; reset(): void; update(): void };
  ctx.progression = prog;
  prog.init();
  prog.reset();
  const enemy = { uid: 1, id: 'husk', score: 100, isBoss: false, center: new THREE.Vector3(), position: new THREE.Vector3(), alive: false };
  const kill = (source = 'harrow') => ctx.events.emit('enemy:killed', {
    enemy, damage: { source, type: 'bullet', amount: 50 }, headshot: false, gibbed: false, sliced: false, severedCount: 0,
    playerAirborne: false, playerSliding: false, playerWallRunning: false, playerSpeed: 0, distance: 10, explosionId: null,
  } as unknown as KillEvent);
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.1) {
      ctx.time.realDt = 0.1;
      ctx.time.realElapsed += 0.1;
      prog.update();
    }
  };
  return { prog, kill, step, ctx, waves };
}

describe('progression with implants', () => {
  it('grants only what is core or fitted', () => {
    const { prog, kill } = progression();
    for (let i = 0; i < 15; i++) kill();
    expect(prog.combo).toBe(15);
    expect(prog.isActive('bloodthirst')).toBe(true);
    // Combo 15 is Berserk's rung, but Berserk is not fitted. Ten kills in ten seconds is Hellfire's, not fitted either.
    expect(prog.isActive('berserk')).toBe(false);
    expect(prog.isActive('hellfire')).toBe(false);
    for (let i = 0; i < 3; i++) kill('sword_slash');
    expect(prog.isActive('adrenaline')).toBe(true);
  });

  it('rearms an implant 30 s after it ends, with its window cleared when it fired', () => {
    const { prog, kill, step } = progression();
    for (let i = 0; i < 4; i++) kill();
    expect(prog.isActive('bloodthirst')).toBe(true);
    step(10.2);
    expect(prog.isActive('bloodthirst')).toBe(false);
    // Today a swarm re-armed it on the next kill. Now: four fresh kills inside the 30 s are not enough.
    for (let i = 0; i < 6; i++) kill();
    expect(prog.isActive('bloodthirst')).toBe(false);
    step(30);
    for (let i = 0; i < 4; i++) kill();
    expect(prog.isActive('bloodthirst')).toBe(true);
  });

  it('moves Berserk\'s rung on even while it runs, and takes a removed implant off silently', () => {
    const { prog, kill, step, waves } = progression();
    prog.loadout.fit('berserk', true);
    for (let i = 0; i < 15; i++) kill();
    expect(prog.isActive('berserk')).toBe(true);
    for (let i = 0; i < 16; i++) kill();
    // A wave break holds the combo while Berserk runs out.
    waves.phase = 'intermission';
    step(10.2);
    expect(prog.combo).toBe(31);
    // Combo 31: the rung went on to 30 while it ran, so the next kill is not a free Berserk.
    kill();
    expect(prog.isActive('berserk')).toBe(false);
    prog.loadout.fit('bloodthirst', true);
    for (let i = 0; i < 4; i++) kill();
    expect(prog.isActive('bloodthirst')).toBe(true);
    prog.loadout.fit('bloodthirst', false);
    expect(prog.isActive('bloodthirst')).toBe(false);
  });

  it('starts every run on the default loadout', () => {
    const { prog } = progression();
    prog.loadout.openSlot();
    prog.loadout.fit('hellfire', true);
    prog.loadout.fit('skyfall', true);
    prog.reset();
    expect([...prog.loadout.fitted]).toEqual(['bloodthirst']);
    expect(prog.loadout.slots).toBe(1);
  });
});
