/**
 * A friend's weapons on this screen (co-op): the remote FX table, and the Watcher that draws a shot from it with the shooter's
 * own code. On the test range the player fires a gun and a Watcher is handed the same shot: it must draw the same thing, and
 * hurt nothing.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FireNote, ModId, ProjectileSpec, WeaponId } from '../core/gameplay';
import { TUNING, WEAPONS, WEAPON_ORDER } from './data';
import { MODS, MOD_ORDER } from './mods';
import { makeRange, type Dummy, type Range } from './testkit';
import { REMOTE_FX, REMOTE_MODS, WATCHED, Watcher, plainNote, type Shooter } from './watch';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const BEAM = TUNING.lance.beam;
const GIANT = TUNING.lance.giant;

describe('the remote FX table', () => {
  it('has a row for every weapon, of the kind that weapon\'s own row fires', () => {
    for (const id of WEAPON_ORDER) {
      const def = WEAPONS[id];
      const want = def.mode === 'melee' ? 'melee' : def.mode === 'stream' ? 'hose' : def.mode === 'charge' ? 'lance'
        : def.round || def.mode === 'paint' ? 'projectile' : def.pellets > 1 ? 'pellets' : 'rounds';
      expect(REMOTE_FX[id], id).toBeDefined();
      expect(REMOTE_FX[id].kind, id).toBe(want);
      expect(REMOTE_FX[id].sees.length, id).toBeGreaterThan(10);
    }
    expect(Object.keys(REMOTE_FX).sort()).toEqual([...Object.keys(WEAPONS)].sort());
  });

  it('says what a watcher sees of every mod', () => {
    expect(Object.keys(REMOTE_MODS).sort()).toEqual([...MOD_ORDER].sort());
    for (const id of MOD_ORDER) {
      const row = REMOTE_MODS[id];
      const patch = MODS[id].patch;
      expect(row.sees.length, id).toBeGreaterThan(5);
      // A mod that changes the flash, the report, the tracer or the load is one a watcher sees or hears.
      if (patch.muzzle || patch.tracer || patch.load || patch.raufoss || patch.flak || patch.akimbo) expect(row.look, id).not.toBe('none');
    }
  });
});

/** A friend standing where the range's player stands, their gun a little ahead and to the right. */
function friend(at = v(0, 1, 0)): Shooter & { gestures: string[] } {
  const gestures: string[] = [];
  return {
    eye: at.clone(), forward: v(0, 0, -1), velocity: v(0, 0, 0), gestures, seat: 1,
    muzzle: (out: THREE.Vector3) => out.copy(at).add(v(0.2, -0.2, -0.5)),
    gesture: kind => { gestures.push(kind); },
  };
}

/** Counts every fx call by name on top of the range's own recorder. */
function count(r: Range): Record<string, number> {
  const calls: Record<string, number> = {};
  const fx = r.ctx.fx;
  r.ctx.fx = new Proxy(fx, {
    get: (t, k) => {
      const value = Reflect.get(t, k);
      if (typeof k !== 'string' || typeof value !== 'function') return value;
      return (...args: unknown[]) => { calls[k] = (calls[k] ?? 0) + 1; return (value as (...a: unknown[]) => unknown)(...args); };
    },
  });
  return calls;
}

describe('a friend\'s shots, drawn here', () => {
  let r: Range;
  let notes: { weapon: WeaponId; origin: THREE.Vector3; dir: THREE.Vector3; note: FireNote }[];
  let off: () => void;

  beforeEach(async () => {
    r = await makeRange();
    notes = [];
    off = r.ctx.events.on('weapon:fired', e => notes.push({
      weapon: e.weapon, origin: e.origin.clone(), dir: e.dir.clone(), note: { ...e.note!, to: e.note!.to.clone() },
    }));
    return () => off();
  });

  const draw = (weapon: WeaponId, give = true): void => {
    if (give) r.weapons.give(weapon);
    r.weapons.switchTo(weapon);
    r.run(1);
    notes.length = 0;
  };
  const pull = (seconds = 0.05): void => {
    r.input.simulate('fire', true);
    r.run(seconds);
    r.input.simulate('fire', false);
    r.run(0.05);
  };
  const ends = (): string[] => r.record.tracers.map(t => t.to.toArray().map(n => n.toFixed(3)).join(',')).sort();

  it('a single player\'s spread is not seeded: nothing changes off the wire', () => {
    r.wall(-10, 1);
    draw('shotgun');
    pull();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.note.rays).toBe(WEAPONS.shotgun.pellets);
    expect(notes[0]!.note.seed).toBe(0);
  });

  it('shotgun pellets land where the shooter\'s did, from the seed, and strike nobody', () => {
    (r.ctx as unknown as { coop?: unknown }).coop = {};
    r.wall(-10, 1);
    const man = r.enemies.add(3, -6) as Dummy;
    draw('shotgun');
    pull();
    const shot = notes[0]!;
    expect(shot.note.seed).not.toBe(0);
    expect(shot.note.cone).toBeCloseTo(WEAPONS.shotgun.spread, 6);
    const mine = ends();
    const impacts = r.record.impacts.length;
    expect(mine).toHaveLength(WEAPONS.shotgun.pellets);

    r.record.tracers.length = r.record.impacts.length = 0;
    const body = friend();
    const watcher = new Watcher(r.ctx, body);
    // The man now stands in the pattern: a watcher's pellets stop on him, and he takes nothing.
    man.position.set(0, 0, -6);
    man.center.set(0, 1.2, -6);
    const before = WATCHED.rays;
    watcher.fire('shotgun', shot.origin, shot.dir, shot.note);
    expect(WATCHED.rays - before).toBe(WEAPONS.shotgun.pellets);
    expect(man.hits).toHaveLength(0);
    expect(man.health).toBe(man.maxHealth);
    expect(body.gestures).toEqual(['shoot']);
    // Every tracer leaves their muzzle, not their eye.
    for (const t of r.record.tracers) expect(t.from.distanceTo(v(0.2, 0.8, -0.5))).toBeLessThan(1e-6);

    // With nobody in the way the same pellets land on the same spots of the wall.
    man.position.set(30, 0, -6);
    man.center.set(30, 1.2, -6);
    r.record.tracers.length = r.record.impacts.length = 0;
    watcher.fire('shotgun', shot.origin, shot.dir, shot.note);
    expect(ends()).toEqual(mine);
    expect(r.record.impacts).toHaveLength(impacts);
    expect(r.record.decals.length).toBeGreaterThanOrEqual(0);
  });

  it('flechettes: more darts from the same seed, the needle tracer, needles in the wall', () => {
    (r.ctx as unknown as { coop?: unknown }).coop = {};
    r.wall(-10, 1);
    draw('shotgun');
    r.weapons.grantMod('shotgunFlechette');
    r.weapons.fitMod('shotgunFlechette', true);
    pull();
    const shot = notes[0]!;
    const darts = Math.round(WEAPONS.shotgun.pellets * 3.5);
    expect(shot.note.rays).toBe(darts);
    const mine = ends();
    r.record.tracers.length = 0;
    const watcher = new Watcher(r.ctx, friend());
    watcher.hold('shotgun', ['shotgunFlechette']);
    expect(watcher.has('shotgunFlechette')).toBe(true);
    const stick = vi.spyOn(r.combat.needles, 'stick');
    watcher.fire('shotgun', shot.origin, shot.dir, shot.note);
    expect(ends()).toEqual(mine);
    expect(r.record.tracers.every(t => t.kind === 'flechette')).toBe(true);
    expect(stick).toHaveBeenCalledTimes(darts);
  });

  it('a kit names a suppressor: the flash and the report are the suppressed ones', () => {
    const watcher = new Watcher(r.ctx, friend());
    const flash = vi.fn();
    const fx = r.ctx.fx;
    r.ctx.fx = new Proxy(fx, { get: (t, k) => (k === 'muzzleFlash' ? flash : Reflect.get(t, k)) });
    r.record.sounds.length = 0;
    watcher.fire('smg', v(0, 1, 0), v(0, 0, -1), { ...plainNote({ to: v(0, 0, 0) } as FireNote), rays: 1 });
    expect(flash.mock.calls.at(-1)![2]).toBe(WEAPONS.smg.muzzle);
    expect(r.record.sounds).toContain(WEAPONS.smg.sounds[0]!.id);
    watcher.hold('smg', ['suppressor', 'notAMod', 'gimletCan']);
    expect(watcher.has('suppressor')).toBe(true);
    expect(watcher.has('gimletCan' as ModId)).toBe(false);
    r.record.sounds.length = 0;
    watcher.fire('smg', v(0, 1, 0), v(0, 0, -1), { ...plainNote({ to: v(0, 0, 0) } as FireNote), rays: 1 });
    expect(flash.mock.calls.at(-1)![2]).toBe('suppressed');
    expect(r.record.sounds).toContain('smg_suppressed_shot');
  });

  it('a round that goes through cover goes through it for the watcher: entry, exit crater and the tracer beyond', () => {
    r.wall(-10, 0.3);
    r.wall(-20, 4);
    const watcher = new Watcher(r.ctx, friend());
    watcher.fire('harrow', v(0, 1, 0), v(0, 0, -1), { ...plainNote({ to: v(0, 0, 0) } as FireNote), rays: 1 });
    expect(r.record.tracers.length).toBe(2);
    expect(r.record.decals.some(d => d.kind === 'exit')).toBe(true);
    expect(r.record.tracers[1]!.to.z).toBeCloseTo(-20, 2);
  });

  it('Raufoss bursts and throws its pellets for the watcher, and nothing is blown up', () => {
    r.wall(-10, 0.3);
    const man = r.enemies.add(0, -14) as Dummy;
    const calls = count(r);
    const watcher = new Watcher(r.ctx, friend());
    watcher.hold('sabot', ['raufoss']);
    watcher.fire('sabot', v(0, 1, 0), v(0, 0, -1), { ...plainNote({ to: v(0, 0, 0) } as FireNote), rays: 1 });
    expect(r.record.tracers[0]!.kind).toBe('raufoss');
    expect(r.record.tracers.length).toBe(1 + TUNING.raufoss.pellets);
    expect(calls.burst).toBeGreaterThan(0);
    expect(calls.ring).toBeGreaterThan(0);
    expect(r.record.sounds).toContain('cannon_burst');
    expect(r.record.explosions).toBe(0);
    expect(man.hits).toHaveLength(0);
  });

  it('the Lance\'s rail: the line, a burst at each body, and not a scratch on them', () => {
    const men = [r.enemies.add(0, -8), r.enemies.add(0, -12), r.enemies.add(0, -16)] as Dummy[];
    const calls = count(r);
    const body = friend();
    const watcher = new Watcher(r.ctx, body);
    const blast = vi.spyOn(r.combat, 'explode');
    watcher.fire('lance', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'rail'));
    expect(calls.beam).toBeGreaterThanOrEqual(2);
    expect(r.record.sounds).toContain('lance_thunder');
    expect(r.record.sounds).toContain('railgun_fire');
    for (let i = 0; i < 60; i++) { r.ctx.time.tick(1 / 60); watcher.update(1 / 60); r.combat.update(); }
    // A burst booked at each body the line crossed: its bolt and its ring. The blast itself is the shooter's to send.
    expect(calls.arc).toBeGreaterThanOrEqual(1 + men.length);
    expect(calls.ring).toBeGreaterThanOrEqual(men.length);
    expect(blast).toHaveBeenCalledTimes(men.length);
    expect(r.record.explosions).toBe(0);
    for (const man of men) {
      expect(man.hits).toHaveLength(0);
      expect(man.health).toBe(man.maxHealth);
    }
    expect(r.combat.watching).toBe(0);
    // Nothing of the one who pulled the trigger: no shove, and the player's own cell is untouched.
    expect(r.player.velocity.length()).toBe(0);
    watcher.dispose();
  });

  it('the Lance\'s beam pours down their aim for its second, follows it, burns nobody, and stops when told', () => {
    r.wall(-30, 1);
    const man = r.enemies.add(0, -10) as Dummy;
    const calls = count(r);
    const body = friend();
    const watcher = new Watcher(r.ctx, body);
    const loops: string[] = [];
    (r.ctx.audio as unknown as { startLoop: (id: string, o?: { position?: THREE.Vector3 }) => unknown }).startLoop = (id, o) => {
      loops.push(`${id}:${o?.position ? 'placed' : 'flat'}`);
      return { alive: true, setVolume() {}, setPitch() {}, setPosition() {}, stop() {} };
    };
    const flash = vi.fn();
    (r.ctx.render as unknown as { post: unknown }).post = { flash, chromatic: flash, radialBlur: flash };
    watcher.fire('lance', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'beam'));
    expect(watcher.beaming).toBe(true);
    // Heard from their gun, not in this player's head.
    expect(loops).toEqual(['lance_beam_loop:placed', 'orbital_beam_loop:placed']);
    const step = (seconds: number): void => {
      for (let i = 0; i < Math.round(seconds * 60); i++) { r.ctx.time.tick(1 / 60); watcher.update(1 / 60); r.combat.update(); }
    };
    step(0.3);
    expect(watcher.beaming).toBe(true);
    expect(calls.sparks).toBeGreaterThan(0);
    expect(r.record.decals.some(d => d.kind === 'scorch' && Math.abs(d.at.z + 30) < 0.01)).toBe(true);
    // They swing it: the end of it goes where they now look.
    body.forward.set(Math.sin(0.3), 0, -Math.cos(0.3));
    r.record.decals.length = 0;
    step(0.3);
    expect(r.record.decals.some(d => d.kind === 'scorch' && d.at.x > 3)).toBe(true);
    // No screen effects, no hit on the man in it, and he is not set alight here.
    expect(flash).not.toHaveBeenCalled();
    expect(man.hits).toHaveLength(0);
    expect(man.burning).toBe(0);
    step(BEAM.seconds);
    expect(watcher.beaming).toBe(false);

    watcher.fire('lance', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'beam'));
    step(0.2);
    expect(watcher.beaming).toBe(true);
    watcher.loop('beam', null, null);
    expect(watcher.beaming).toBe(false);
    expect(r.combat.watching).toBe(0);
    watcher.dispose();
  });

  it('the giant ball flies their line and goes off where their game says, harming nothing', () => {
    r.wall(-40, 1);
    const man = r.enemies.add(0, -6) as Dummy;
    const watcher = new Watcher(r.ctx, friend());
    watcher.fire('lance', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'giant'));
    const step = (seconds: number): void => {
      for (let i = 0; i < Math.round(seconds * 60); i++) { r.ctx.time.tick(1 / 60); watcher.update(1 / 60); r.combat.update(); }
    };
    step(0.5);
    // It passes the man it would have gone off on: whom it touches is the shooter's game's to say.
    expect(watcher.giantAt).not.toBeNull();
    expect(watcher.giantAt!.z).toBeLessThan(-6);
    step(0.2);
    watcher.loop('giant', v(0, 1, -6), null);
    expect(watcher.giantAt).toBeNull();
    expect(r.record.sounds).toContain('lance_nova');
    expect(r.record.blasts.length).toBeGreaterThan(0);
    for (const at of r.record.blasts) expect(at.distanceTo(v(0, 1, -6))).toBeLessThan(GIANT.blast);
    expect(man.hits).toHaveLength(0);

    // With no word from their game it waits at the wall a moment, then goes off there.
    r.record.blasts.length = 0;
    watcher.fire('lance', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'giant'));
    step(40 / GIANT.speed + 1);
    expect(watcher.giantAt).toBeNull();
    expect(r.record.blasts.some(at => at.z < -30)).toBe(true);
    expect(man.hits).toHaveLength(0);
    watcher.dispose();
  });

  it('a friend\'s rocket flies and ends on the wall with no blast of its own; a stake stands in the wall', () => {
    r.wall(-20, 1);
    const man = r.enemies.add(4, -10) as Dummy;
    const watcher = new Watcher(r.ctx, friend());
    const spec: ProjectileSpec = {
      origin: v(0, 1, -0.25), velocity: v(0, 0, -TUNING.rocket.speed), kind: 'rocket', team: 'player', damage: 1, source: 'rocket',
      trail: 'smoke', explosion: { radius: 1, damage: 0, kind: 'rocket' },
    };
    watcher.launch(spec);
    expect(r.combat.projectiles.count).toBe(1);
    expect(r.combat.projectiles.active[0]!.cosmetic).toBe(true);
    r.run(0.1);
    expect(r.record.puffs.length).toBeGreaterThan(0);
    r.run(2);
    expect(r.combat.projectiles.count).toBe(0);
    expect(r.record.explosions).toBe(0);
    expect(man.hits).toHaveLength(0);

    // A copy that is still flying when the shooter's own goes off ends there, by its number.
    watcher.launch({ ...spec, origin: v(0, 1, -0.25), velocity: v(0, 0, -TUNING.rocket.speed), tag: 5 });
    r.run(0.05);
    expect(r.combat.projectiles.count).toBe(1);
    watcher.landed(4, v(0, 1, -9));
    expect(r.combat.projectiles.count).toBe(1);
    watcher.landed(5, v(0, 1, -9));
    expect(r.combat.projectiles.count).toBe(0);
    expect(r.record.explosions).toBe(0);

    const stick = vi.spyOn(r.combat.projectiles.visuals, 'stick');
    watcher.launch({ origin: v(0, 1, -0.25), velocity: v(0, 0, -TUNING.stake.speed), kind: 'stake', team: 'player', damage: 1, source: 'stakegun', trail: 'none' });
    r.run(1);
    expect(stick).toHaveBeenCalledOnce();
    expect(r.record.sounds).toContain('stake_hit_wall');
    // Aimed at the man, a friend's stake stops on him and he takes nothing.
    watcher.launch({ origin: v(0, 1, -0.25), velocity: v(4, 0.2, -9.75).normalize().multiplyScalar(TUNING.stake.speed), kind: 'stake', team: 'player', damage: 1, source: 'stakegun', trail: 'none' });
    r.run(1);
    expect(man.hits).toHaveLength(0);
    expect(r.combat.projectiles.count).toBe(0);
    expect(r.combat.watching).toBe(0);
  });

  it('the Kiln: their napalm pours from their nozzle down their aim, pools and scorches, and burns nobody', () => {
    r.wall(-8, 1);
    const man = r.enemies.add(0, -4) as Dummy;
    const calls = count(r);
    const body = friend();
    const watcher = new Watcher(r.ctx, body);
    const afflict = vi.fn();
    (r.ctx.enemies as unknown as { afflict: unknown }).afflict = afflict;
    const step = (seconds: number): void => {
      for (let i = 0; i < Math.round(seconds * 60); i++) { r.ctx.time.tick(1 / 60); watcher.update(1 / 60); r.combat.update(); }
    };
    watcher.fire('kiln', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'hose'));
    expect(watcher.pouring).toBe(true);
    expect(r.record.sounds).toContain('flame_ignite');
    step(0.3);
    expect(r.combat.flames.watched).toBeGreaterThan(2);
    expect(calls.hose).toBeGreaterThan(0);
    // Kept on by their word a few times a second; it lands, splashes and leaves a burning patch.
    for (let i = 0; i < 8; i++) {
      watcher.fire('kiln', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'hose'));
      step(0.12);
    }
    expect(calls.napalmSplash).toBeGreaterThan(0);
    expect(r.combat.flames.burning).toBeGreaterThan(0);
    expect(r.combat.flames.patches.filter(p => p.live).every(p => p.cosmetic)).toBe(true);
    expect(r.record.decals.some(d => d.kind === 'scorch')).toBe(true);
    step(1);
    // The man stood in the stream and in the pool: not a hit on him, and nothing set him alight here.
    expect(man.hits).toHaveLength(0);
    expect(afflict).not.toHaveBeenCalled();
    watcher.fire('kiln', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'hose'));
    watcher.loop('hose', null, null);
    expect(watcher.pouring).toBe(false);
    expect(r.record.sounds).toContain('flame_stop');
    // With no word at all it stops by itself.
    watcher.fire('kiln', v(0, 1, 0), v(0, 0, -1), plainNote({ to: v(0, 0, 0) } as FireNote, 'hose'));
    step(0.9);
    expect(watcher.pouring).toBe(false);
    watcher.dispose();
  });

  it('a swing: the clip on their body, its sound from them, and the slash their game drew where it drew it', () => {
    const calls = count(r);
    const body = friend();
    const watcher = new Watcher(r.ctx, body);
    const note = { ...plainNote({ to: v(0, 0, 0) } as FireNote, 'swing'), swing: { sound: 'sword_swing', pitch: 1.1, heavy: false, energy: true } };
    watcher.fire('sword', v(0, 1, 0), v(0, 0, -1), note);
    expect(body.gestures).toEqual(['swing']);
    expect(r.record.sounds).toEqual(['sword_swing', 'lance_plasma']);
    watcher.fire('sword', v(0, 1, 0), v(0, 0, -1), { ...note, swing: { sound: 'not_a_sound', pitch: 1, heavy: true, energy: false } });
    expect(body.gestures).toEqual(['swing', 'heavy']);
    expect(r.record.sounds).toHaveLength(2);
    const fx = { kind: 'slash' as const, a: v(0, 1, -1), b: v(0, 1, 0), c: v(1, 0, 0), x: 2, y: 2.5, look: 'heavy' };
    watcher.meleeFx(fx);
    watcher.meleeFx({ ...fx, look: 'nonsense' });
    expect(calls.slash).toBe(1);
    watcher.meleeFx({ ...fx, kind: 'ring', x: 0x88ccff, y: 3 });
    watcher.meleeFx({ ...fx, kind: 'streaks' });
    watcher.meleeFx({ ...fx, kind: 'slam', x: 0.65 });
    expect(calls.ring).toBe(1);
    expect(calls.dashStreaks).toBe(1);
    expect(calls.slam).toBe(1);
    expect(r.record.sounds).toContain('katana_cleave_land');
    // The player's own swings are told to the others only in co-op.
    const told = vi.fn();
    r.ctx.events.on('melee:fx', told);
    draw('sword', false);
    pull();
    r.run(0.5);
    expect(told).not.toHaveBeenCalled();
    (r.ctx as unknown as { coop?: unknown }).coop = {};
    pull();
    r.run(0.5);
    expect(told).toHaveBeenCalled();
    expect(notes.at(-1)!.note.kind).toBe('swing');
  });

  it('what their pose says they are doing: a reload\'s cues, a stim, the laser a wired rocket steers for, the weapon light', () => {
    r.wall(-30, 1);
    const calls = count(r);
    const body = friend();
    const watcher = new Watcher(r.ctx, body);
    const torch = new THREE.SpotLight(0xffffff, 0);
    watcher.torch = torch;
    const idle = { reload: false, stim: false, laser: false, charge: false, ball: false };
    watcher.hold('smg', []);
    watcher.doing({ ...idle, reload: true }, 1 / 60);
    watcher.doing({ ...idle, reload: true }, 1 / 60);
    expect(body.gestures).toEqual(['reload']);
    expect(r.record.sounds).toEqual(WEAPONS.smg.reloadFoley.map(c => c[1]));
    watcher.doing({ ...idle, stim: true }, 1 / 60);
    expect(body.gestures).toEqual(['reload', 'stim']);
    expect(r.record.sounds).toContain('stim_click');
    expect(watcher.lit).toBe(false);
    // The light is the gun's mod: on while it is in hand, down their aim.
    watcher.hold('smg', ['smgLight']);
    watcher.doing(idle, 1 / 60);
    expect(watcher.lit).toBe(true);
    expect(torch.target.position.z).toBeLessThan(-10);
    watcher.hold('rocket', []);
    watcher.doing(idle, 1 / 60);
    expect(watcher.lit).toBe(false);
    // The rocket's sight: the line is drawn to the dot, and a wired rocket of theirs turns for it.
    expect(calls.beam ?? 0).toBe(0);
    body.forward.set(Math.sin(0.5), 0, -Math.cos(0.5));
    watcher.doing({ ...idle, laser: true }, 1 / 60);
    expect(calls.beam).toBe(1);
    expect(watcher.laser.on).toBe(true);
    expect(watcher.laser.at.x).toBeGreaterThan(5);
    watcher.launch({ origin: v(0, 1, -0.25), velocity: v(0, 0, -TUNING.rocket.speed), kind: 'rocket', team: 'player', damage: 1, source: 'rocket', wired: true, explosion: { radius: 1, damage: 0, kind: 'rocket' } });
    const rocket = r.combat.projectiles.active[0]!;
    r.run(0.25);
    expect(rocket.velocity.x).toBeGreaterThan(1);
    // A Lance charge pulls its slivers into their muzzle.
    watcher.hold('lance', []);
    for (let i = 0; i < 30; i++) watcher.doing({ ...idle, charge: true }, 1 / 60);
    expect(calls.inhale).toBeGreaterThan(0);
    watcher.doing(idle, 1 / 60);
    watcher.dispose();
    expect(torch.intensity).toBe(0);
  });

  it('the player\'s own shots are not softened by a watcher having drawn', () => {
    const man = r.enemies.add(0, -8, 500) as Dummy;
    const watcher = new Watcher(r.ctx, friend());
    watcher.fire('smg', v(0, 1, 0), v(0, 0, -1), { ...plainNote({ to: v(0, 0, 0) } as FireNote), rays: 1 });
    expect(man.hits).toHaveLength(0);
    draw('smg');
    pull();
    expect(man.hits.length).toBeGreaterThan(0);
    expect(r.combat.watching).toBe(0);
  });
});
