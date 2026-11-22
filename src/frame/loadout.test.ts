/** The Frame's loadout (loadout.ts): the default is the Frame as it was, each slot holds only its own parts, it is kept, and it travels. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../core/contracts';
import type { Ac130Rounds } from '../progression/callins/ac130Rounds';
import {
  armsOf, DEFAULT_FRAME_LOADOUT, defaultLoadout, FRAME_LOADOUT_KEY, FRAME_PART_ORDER, FRAME_PARTS, fitPart, frameStats, KIT_LENGTH, kitFrom,
  kitIds, loadFrameLoadout, normalizeLoadout, partsFor, sameLoadout, saveFrameLoadout, shoulderSlots, type FramePart,
} from './loadout';
import { FrameGuns, type Arm, type Sight } from './weapons';

const DT = 1 / 60;

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('the default loadout', () => {
  it('is the Frame as it always was: the rotary left, the 40 mm right, the pod, the standard legs, cockpit and engine', () => {
    expect(DEFAULT_FRAME_LOADOUT).toEqual({
      leftArm: 'rotaryL', rightArm: 'cannonR', shoulders: ['pod6'], legs: 'legsStandard', cockpit: 'cockpitStandard', engine: 'engineStandard',
    });
    expect(armsOf(defaultLoadout())).toEqual({ left: 'rotary', right: 'cannon40' });
    // Every multiplier is exactly 1, so nothing walks, jumps or stomps differently.
    expect(frameStats(defaultLoadout())).toEqual({ walk: 1, jump: 1, stomp: 1, dash: 1, gait: 'walker', drive: 'jets', shoulders: 1, pod: true });
  });

  it('builds the same guns and panel as the Frame before loadouts', () => {
    const guns = makeGuns().guns;
    const arms = armsOf(defaultLoadout());
    guns.fitArms(arms.left, arms.right);
    expect(guns.left.kind).toBe('rotary');
    expect(guns.right.kind).toBe('cannon40');
    expect(guns.rows[0]!.name).toBe('LMB ROTARY [STD] // HOLD 1');
    expect(guns.rows[1]!.name).toBe('RMB 40MM HE // R');
    expect(guns.armWeapon).toBe('cannon40');
  });
});

describe('slots', () => {
  it('lists each part only in its own slot, and an arm only on its own side', () => {
    expect(partsFor('leftArm').map(p => p.id)).toEqual(['rotaryL', 'cannonL', 'howitzerL']);
    expect(partsFor('rightArm').map(p => p.id)).toEqual(['rotaryR', 'cannonR', 'howitzerR']);
    expect(partsFor('shoulder').map(p => p.id)).toEqual(['pod6']);
    for (const slot of ['legs', 'cockpit', 'engine'] as const) expect(partsFor(slot)).toHaveLength(1);
    // A right arm in the left slot, an unknown id, a shoulder part as legs: each falls back to the default's part.
    const l = normalizeLoadout({ leftArm: 'cannonR', rightArm: 'nonsense', legs: 'pod6', shoulders: ['rotaryL'] });
    expect(l).toEqual(defaultLoadout());
  });

  it('fits a part in its slot and nowhere else', () => {
    let l = fitPart(defaultLoadout(), 'howitzerL');
    expect(l.leftArm).toBe('howitzerL');
    expect(l.rightArm).toBe('cannonR');
    l = fitPart(l, 'rotaryR');
    expect(armsOf(l)).toEqual({ left: 'howitzer105', right: 'rotary' });
    expect(sameLoadout(l, defaultLoadout())).toBe(false);
    expect(sameLoadout(fitPart(fitPart(l, 'rotaryL'), 'cannonR'), defaultLoadout())).toBe(true);
  });

  it('gives as many shoulder slots as the cockpit says: one for the standard, two for a cockpit that says two', () => {
    expect(shoulderSlots(defaultLoadout())).toBe(1);
    expect(normalizeLoadout({ shoulders: ['pod6', 'pod6', 'pod6'] }).shoulders).toEqual(['pod6']);
    // A cockpit to come: two shoulders. The loadout grows a slot, filled with the pod, and shrinks back with the standard one.
    const upgraded: FramePart = { id: 'cockpitStandard', slot: 'cockpit', name: 'Upgraded', does: '', lore: '', cockpit: { shoulders: 2 } };
    const parts = { ...FRAME_PARTS, cockpitPlus: { ...upgraded, id: 'cockpitPlus' as never } };
    const two = normalizeLoadout({ cockpit: 'cockpitPlus' }, parts);
    expect(two.cockpit).toBe('cockpitPlus');
    expect(shoulderSlots(two, parts)).toBe(2);
    expect(two.shoulders).toEqual(['pod6', 'pod6']);
    expect(frameStats(two, parts).shoulders).toBe(2);
    const back = fitPart(two, 'cockpitStandard', 0, parts);
    expect(back.shoulders).toEqual(['pod6']);
  });
});

describe('kept between runs', () => {
  it('saves and loads the same loadout', () => {
    const s = memory();
    const l = fitPart(fitPart(defaultLoadout(), 'cannonL'), 'howitzerR');
    saveFrameLoadout(l, s);
    expect(s.map.has(FRAME_LOADOUT_KEY)).toBe(true);
    expect(loadFrameLoadout(s)).toEqual(l);
  });

  it('reads nothing, junk, or a part that no longer exists as the default', () => {
    const s = memory();
    expect(loadFrameLoadout(s)).toEqual(defaultLoadout());
    s.setItem(FRAME_LOADOUT_KEY, '{not json');
    expect(loadFrameLoadout(s)).toEqual(defaultLoadout());
    s.setItem(FRAME_LOADOUT_KEY, JSON.stringify({ leftArm: 'laserL', rightArm: 'howitzerR' }));
    expect(loadFrameLoadout(s)).toEqual({ ...defaultLoadout(), rightArm: 'howitzerR' });
    expect(loadFrameLoadout(null)).toEqual(defaultLoadout());
  });
});

describe('on the wire', () => {
  it('is one short list of part numbers that reads back as the same loadout', () => {
    const l = fitPart(fitPart(defaultLoadout(), 'howitzerL'), 'rotaryR');
    const ids = kitIds(l);
    expect(ids).toHaveLength(KIT_LENGTH);
    expect(ids.every(n => Number.isInteger(n))).toBe(true);
    expect(kitFrom(ids)).toEqual(l);
    expect(kitIds(defaultLoadout())).toEqual([0, 3, 7, 8, 9, 6, -1]);
    // Numbers nobody knows are the default's parts, never a crash.
    expect(kitFrom([99, -5, Number.NaN, 2, 1, 1e9, 0])).toEqual(defaultLoadout());
    // The order is append-only: these places must never move.
    expect(FRAME_PART_ORDER.slice(0, 10)).toEqual(['rotaryL', 'rotaryR', 'cannonL', 'cannonR', 'howitzerL', 'howitzerR', 'pod6', 'legsStandard', 'cockpitStandard', 'engineStandard']);
  });
});

/** FrameGuns on stand-ins: which arm fired what, and from where. */
function makeGuns() {
  const down = new Set<string>();
  const pressed = new Set<string>();
  const fired: { kind: string; from: THREE.Vector3 }[] = [];
  const rays: THREE.Vector3[] = [];
  const turned = { left: 0, right: 0 };
  const ctx = {
    input: { isDown: (a: string) => down.has(a), pressed: (a: string) => pressed.has(a) },
    audio: { play: () => undefined, startLoop: () => ({ stop: () => undefined, setPitch: () => undefined }) },
    hud: { callout: () => undefined },
    fx: { muzzleFlash: () => undefined, ring: () => undefined, smoke: () => undefined, sparks: () => undefined, shellCasing: () => undefined, tracer: () => undefined, vaporRing: () => undefined },
    camera: { addTrauma: () => undefined, kick: () => undefined },
    combat: { fireRay: (_o: THREE.Vector3, _d: THREE.Vector3, spec: { tracerFrom?: THREE.Vector3 }) => rays.push(spec.tracerFrom!.clone()), explode: () => undefined, spawnProjectile: () => undefined },
    enemies: { alive: [], query: () => 0, vehicles: null },
    physics: { raycast: () => null, raycastInto: () => false },
    render: { lights: { flash: () => undefined } },
  } as unknown as Ctx;
  const rounds = {
    onImpact: null,
    fire: (kind: string, from: THREE.Vector3) => fired.push({ kind, from: from.clone() }),
    flash: () => undefined,
    update: () => undefined,
    clear: () => undefined,
  } as unknown as Ac130Rounds;
  const arm = (x: number, side: 'left' | 'right'): Arm => ({
    muzzle: out => out.set(x, 3, -2),
    bore: out => out.set(0, 0, -1),
    turn: r => { turned[side] += r; },
    recoil: () => undefined,
  });
  const sight: Sight = {
    view: { position: new THREE.Vector3(0, 5, 0) } as Sight['view'],
    aim: new THREE.Vector3(0, 0, -1),
    point: new THREE.Vector3(0, 1, -40),
    range: 40,
  };
  const guns = new FrameGuns(ctx, rounds, arm(-1.75, 'left'), arm(1.75, 'right'), out => out.set(1, 5, 0));
  const run = (n: number) => { for (let i = 0; i < n; i++) guns.update(DT, sight); };
  return { guns, down, pressed, fired, rays, turned, run };
}

describe('a swapped arm', () => {
  it('builds the weapon on the side it was fitted: a 40 mm left on LMB, a rotary right on RMB', () => {
    const t = makeGuns();
    const arms = armsOf(fitPart(fitPart(defaultLoadout(), 'cannonL'), 'rotaryR'));
    t.guns.fitArms(arms.left, arms.right);
    expect(t.guns.rows[0]!.name).toBe('LMB 40MM HE // R');
    expect(t.guns.rows[1]!.name).toBe('RMB ROTARY [STD] // HOLD 1');
    // LMB: a 40 mm shell, from the left arm's muzzle.
    t.down.add('fire');
    t.run(1);
    t.down.delete('fire');
    expect(t.fired).toHaveLength(1);
    expect(t.fired[0]!.kind).toBe('g40');
    expect(t.fired[0]!.from.x).toBeLessThan(0);
    // RMB: the right rotary spins up and fires, its tracers from the right muzzle; no shell.
    t.down.add('aim');
    t.run(60);
    t.down.delete('aim');
    expect(t.fired).toHaveLength(1);
    expect(t.rays.length).toBeGreaterThan(10);
    expect(t.rays.every(p => p.x > 0)).toBe(true);
    expect(t.turned.right).toBeGreaterThan(0);
    expect(t.turned.left).toBe(0);
  });

  it('fires two howitzers, one a button, each with its own breech', () => {
    const t = makeGuns();
    t.guns.fitArms('howitzer105', 'howitzer105');
    t.down.add('fire');
    t.down.add('aim');
    t.run(1);
    expect(t.fired.map(f => f.kind)).toEqual(['g105', 'g105']);
    expect(t.fired[0]!.from.x).toBeLessThan(0);
    expect(t.fired[1]!.from.x).toBeGreaterThan(0);
    expect(t.guns.left.howitzer.mag.ammo).toBe(0);
    expect(t.guns.right.howitzer.mag.ammo).toBe(0);
  });

  it('cycles every cannon\'s round on R, and the 105 mm upgrade replaces only the right arm', () => {
    const t = makeGuns();
    t.guns.fitArms('cannon40', 'cannon40');
    t.pressed.add('reload');
    t.run(1);
    t.pressed.clear();
    expect(t.guns.left.cannon.round).toBe('ap');
    expect(t.guns.right.cannon.round).toBe('ap');
    t.guns.installArmWeapon('howitzer105');
    expect(t.guns.left.kind).toBe('cannon40');
    expect(t.guns.right.kind).toBe('howitzer105');
    // A new Frame is the standard one again.
    t.guns.reset();
    expect([t.guns.left.kind, t.guns.right.kind]).toEqual(['rotary', 'cannon40']);
  });
});
