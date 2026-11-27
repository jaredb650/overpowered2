import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PhysicsSystem, RayHit } from '../../core/contracts';
import type { AiWorld } from '../aiWorld';
import { Smoke } from '../commander/smoke';
import type { Commander } from '../commander/index';
import { Enemy } from '../Enemy';
import { EnemyManager } from '../EnemyManager';
import { SOLDIER_BEHAVIOURS } from './behaviours';
import { CoverMap, type SpotQuery, type SpotReading } from './cover';
import { Outpost } from './index';
import { Prisoners } from './prisoners';
import type { NavGrid } from './routes';
import { discharge, enlist, Soldier } from './soldier';
import { OutpostSquad } from './squad';
import { soldierAttacks } from './weapons';

function makeEnemy(uid: number, x = 0, y = 0, z = 0): Enemy {
  const e = new Enemy();
  e.uid = uid;
  e.id = 'trooper';
  e.alive = true;
  e.health = e.maxHealth = 100;
  e.position.set(x, y, z);
  e.center.set(x, y + 1, z);
  e.char = {
    anim: {
      setPosture: vi.fn(),
      play: vi.fn(),
    },
    release: vi.fn(),
    root: { position: new THREE.Vector3(x, y, z), rotation: new THREE.Euler() },
    bones: {},
  } as unknown as Enemy['char'];
  return e;
}

function makeSoldier(uid: number, squad: OutpostSquad, x = 0, z = 0): Soldier {
  const e = makeEnemy(uid, x, 0, z);
  const s = new Soldier();
  s.e = e;
  s.squad = squad;
  s.role = 'rifle';
  s.rank = 'regular';
  enlist(e, s);
  squad.join(s);
  return s;
}

function makeFlatGrid(size: number, solid: (x: number, z: number) => boolean): NavGrid {
  const px: number[] = [];
  const pz: number[] = [];
  const clearance: number[] = [];
  const colStart = new Int32Array(size * size + 1);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const c = z * size + x;
      colStart[c + 1] = colStart[c]!;
      if (solid(x, z)) continue;
      px.push(x + 0.5);
      pz.push(z + 0.5);
      clearance.push(solid(x + 1, z) || solid(x - 1, z) || solid(x, z + 1) || solid(x, z - 1) ? 0 : 3);
      colStart[c + 1]!++;
    }
  }
  const n = px.length;
  return {
    nodeCount: n,
    px: Float32Array.from(px),
    py: new Float32Array(n),
    pz: Float32Array.from(pz),
    slopeX: new Float32Array(n),
    slopeZ: new Float32Array(n),
    clearance: Uint8Array.from(clearance),
    minX: 0,
    minZ: 0,
    nx: size,
    nz: size,
    colStart,
    locate(p) {
      const ix = Math.floor(p.x);
      const iz = Math.floor(p.z);
      if (ix < 0 || iz < 0 || ix >= size || iz >= size) return -1;
      const c = iz * size + ix;
      return colStart[c] !== colStart[c + 1] ? colStart[c]! : -1;
    },
  };
}

describe('Batch C behavior audit', () => {
  it('EnemyManager.despawn detaches from outpost, releases director slots, and releases gore before char.release', () => {
    const order: string[] = [];
    const e = makeEnemy(1);
    (e.char.release as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('char.release'));

    const fakeManager = {
      alive: [e],
      stopEffects: vi.fn(() => order.push('stopEffects')),
      director: { releaseAll: vi.fn(() => order.push('director.releaseAll')) },
      outpost: { onDetach: vi.fn(() => order.push('outpost.onDetach')) },
      ctx: { gore: { releaseChar: vi.fn(() => order.push('gore.releaseChar')) } },
      pool: { release: vi.fn(() => order.push('pool.release')) },
      grid: { dirty: false },
    };

    EnemyManager.prototype.despawn.call(fakeManager as unknown as EnemyManager, e);

    expect(fakeManager.alive).toHaveLength(0);
    expect(e.alive).toBe(false);
    expect(fakeManager.director.releaseAll).toHaveBeenCalledWith(e);
    expect(fakeManager.outpost.onDetach).toHaveBeenCalledWith(e);
    expect(fakeManager.ctx.gore.releaseChar).toHaveBeenCalledWith(e.char);
    expect(e.char.release).toHaveBeenCalledTimes(1);
    expect(fakeManager.pool.release).toHaveBeenCalledWith(e);
    expect(fakeManager.grid.dirty).toBe(true);
    expect(order.indexOf('outpost.onDetach')).toBeLessThan(order.indexOf('char.release'));
    expect(order.indexOf('gore.releaseChar')).toBeLessThan(order.indexOf('char.release'));
  });

  it('stealth updateStealth writes per-guard watch without clobbering squad.watch, and hold.think reads s.watch', () => {
    const w = { now: 10, ctx: { physics: null } } as unknown as AiWorld;
    const squad = new OutpostSquad(1, 'Alpha', { w } as unknown as Outpost);
    squad.watch.set(99, 1, 99);
    const s1 = makeSoldier(11, squad, 0, 0);
    const s2 = makeSoldier(12, squad, 5, 0);

    const stealth = {
      syncBody: vi.fn(),
      update: vi.fn(),
      getDesiredMove: vi.fn((uid: number, out: THREE.Vector3) => {
        if (uid === 11) {
          out.set(10, 0, 2);
          return 'patrol';
        }
        out.set(-15, 0, 8);
        return 'investigate';
      }),
      getAgent: vi.fn(() => undefined),
      getDesiredYaw: vi.fn(() => null),
    };

    const fakeOutpost = {
      w,
      soldiers: [s1, s2],
      stealth,
      stealthTarget: new THREE.Vector3(),
      order: vi.fn(),
    };

    (Outpost.prototype as unknown as { updateStealth(dt: number, now: number): void }).updateStealth.call(fakeOutpost, 0.016, 10);

    expect(s1.hasWatch).toBe(true);
    expect(s1.watch).toEqual(new THREE.Vector3(10, 0, 2));
    expect(s2.hasWatch).toBe(true);
    expect(s2.watch).toEqual(new THREE.Vector3(-15, 0, 8));
    expect(squad.watch).toEqual(new THREE.Vector3(99, 1, 99));

    const hold = SOLDIER_BEHAVIOURS.find(b => b.name === 'hold')!;
    hold.think!(s1.e, w);
    hold.think!(s2.e, w);
    expect(s1.aim).toEqual(new THREE.Vector3(10, 0, 2));
    expect(s2.aim).toEqual(new THREE.Vector3(-15, 0, 8));

    discharge(s1.e);
    discharge(s2.e);
  });

  it('setDowned re-registers a revived lone leader squad in Outpost.squads', () => {
    const w = { now: 5 } as unknown as AiWorld;
    const squad = new OutpostSquad(2, 'Bravo', { w } as unknown as Outpost);
    const leader = makeSoldier(21, squad, 0, 0);
    expect(squad.leader).toBe(leader);

    const fakeOutpost = {
      w,
      squads: [squad],
      comms: { say: vi.fn() },
    };

    Outpost.prototype.setDowned.call(fakeOutpost as unknown as Outpost, leader.e, true);
    expect(squad.members).toHaveLength(0);

    // Simulate flushLeaving pruning the empty squad while the lone leader was downed.
    fakeOutpost.squads.length = 0;

    Outpost.prototype.setDowned.call(fakeOutpost as unknown as Outpost, leader.e, false);
    expect(squad.members).toContain(leader);
    expect(fakeOutpost.squads).toContain(squad);

    discharge(leader.e);
  });

  it('surrender.enter resets s.stage to peek so kneeling proceeds after KNEEL_DELAY', () => {
    const surrender = SOLDIER_BEHAVIOURS.find(b => b.name === 'surrender')!;
    const setPosture = vi.fn();
    const squad = new OutpostSquad(3, 'Charlie', { w: { now: 10 } } as unknown as Outpost);
    const s = makeSoldier(31, squad, 0, 0);
    (s.e.char.anim as unknown as { setPosture: ReturnType<typeof vi.fn> }).setPosture = setPosture;
    // Soldier was hiding behind cover right before surrendering.
    s.stage = 'hide';
    s.e.dist = 20;

    const fakeOutpost = {
      onSurrender: vi.fn(),
      comms: { say: vi.fn() },
      captives: { look: vi.fn() },
    };
    const w = {
      now: 10,
      enemies: { outpost: fakeOutpost },
    } as unknown as AiWorld;

    surrender.enter!(s.e, w);
    expect(s.stage).toBe('peek');
    expect(s.peekUntil).toBeGreaterThan(10);
    expect(setPosture).toHaveBeenLastCalledWith('handsUp');

    w.now = s.peekUntil + 0.05;
    surrender.think!(s.e, w);
    expect(s.stage).toBe('hide');
    expect(setPosture).toHaveBeenLastCalledWith('kneel');

    discharge(s.e);
  });

  it('shieldBash requires shield, legs > 0, fighting, and not silent', () => {
    const bash = soldierAttacks('riot').find(a => a.name === 'bash')!;
    expect(bash).toBeDefined();

    const squad = new OutpostSquad(4, 'Delta', { w: { now: 0 } } as unknown as Outpost);
    const s = makeSoldier(41, squad, 0, 0);
    const e = s.e;

    e.shield = true;
    e.maim.legs = 2;
    s.silent = false;
    expect(bash.requires!(e)).toBe(true);

    e.shield = false;
    expect(bash.requires!(e)).toBe(false);
    e.shield = true;

    e.maim.legs = 0;
    expect(bash.requires!(e)).toBe(false);
    e.maim.legs = 2;

    s.downed = true;
    expect(bash.requires!(e)).toBe(false);
    s.downed = false;

    s.fate = 'surrender';
    expect(bash.requires!(e)).toBe(false);
    s.fate = 'none';

    s.silent = true;
    expect(bash.requires!(e)).toBe(false);

    discharge(e);
  });

  it('OutpostSquad.obey returns false non-destructively without cancelling active drill or plan', () => {
    const w = {
      now: 20,
      player: { airborne: false, heavyArmor: false, chest: new THREE.Vector3(10, 1, 0) },
      ctx: { events: { emit: vi.fn() } },
    } as unknown as AiWorld;
    const fakeOutpost = {
      w,
      dread: { value: 0 },
      stillFor: 0,
      track: { speed: 0, velocity: new THREE.Vector3() },
      captives: { held: null },
      doctrine: { stacks: false },
      pinnedByAnother: () => false,
    } as unknown as Outpost;

    const squad = new OutpostSquad(5, 'Echo', fakeOutpost);
    const s = makeSoldier(51, squad, 0, 0);
    s.grenades = 0;
    squad.knownAt = 19;
    squad.seenAt = 19;
    squad.goal = 'waylay';
    squad.drill = 'lieInWait';
    s.silent = true;
    // Seed an active plan state to ensure obey(false) leaves it intact.
    const internals = squad as unknown as { planLength: number; planStep: number; waiting: boolean };
    internals.planLength = 2;
    internals.planStep = 1;
    internals.waiting = true;

    const accepted = squad.obey('frag', 10);
    expect(accepted).toBe(false);
    expect(squad.goal).toBe('waylay');
    expect(squad.drill).toBe('lieInWait');
    expect(s.silent).toBe(true);
    expect(internals.planLength).toBe(2);
    expect(internals.planStep).toBe(1);
    expect(internals.waiting).toBe(true);

    discharge(s.e);
  });

  it('CoverMap.spaced enforces r = 7m across multiple 4m spatial grid cells', () => {
    // Wall along z = 10 across x = 2..16 so cover spots exist along z = 9 at x = 2.5, 4.5, 6.5, 8.5, ...
    const nav = makeFlatGrid(20, (x, z) => x === 0 || z === 0 || x === 19 || z === 19 || (z === 10 && x >= 2 && x <= 16));
    const physics = {
      raycastInto(o: THREE.Vector3, d: THREE.Vector3, max: number, _mask: number, out: RayHit): boolean {
        if (Math.abs(d.z) < 1e-6 || o.y > 4) return false;
        const t = (10 - o.z) / d.z;
        if (t < 0 || t > max) return false;
        const x = o.x + d.x * t;
        if (x < 2 || x > 17) return false;
        out.distance = t;
        return true;
      },
    } as unknown as PhysicsSystem;

    const map = new CoverMap(physics);
    map.build(nav);
    expect(map.spots.length).toBeGreaterThanOrEqual(4);

    // Find a spot near the left side of the wall and another spot ~5.5-6.8m away (crossing > 1 GRID=4 cell boundary).
    const first = map.spots.find(sp => sp.position.x <= 4.5 && sp.position.z < 10)!;
    expect(first).toBeDefined();
    first.claimedBy = 101;

    const targetSpot = map.spots.find(
      sp => sp !== first && sp.position.z < 10 && sp.position.distanceTo(first.position) > 5.0 && sp.position.distanceTo(first.position) < 6.8,
    );
    expect(targetSpot).toBeDefined();

    const reading: SpotReading = { hidden: false, canShoot: false, side: 0 };
    const q: SpotQuery = {
      anchor: targetSpot!.position.clone(),
      radius: 0.5,
      threat: new THREE.Vector3(targetSpot!.position.x, 0, 18),
      near: 1,
      far: 30,
      bearing: NaN,
      bearingSlack: 0.4,
      needShot: false,
      spacing: 7,
      uid: 202,
      from: targetSpot!.position.clone(),
      height: 0,
      anyFloor: true,
    };

    // Distance is < 7m (crossing 2 spatial cells of size 4): must be rejected at spacing = 7.
    expect(map.pick(q, reading)).toBeNull();

    // At spacing = 4, it is > 4m away from the claimed spot so it is accepted.
    q.spacing = 4;
    expect(map.pick(q, reading)).toBe(targetSpot);
  });

  it('Prisoners.look does not let failed rearm cooldown block friendsFiring rescue or 45s timeout release', () => {
    const w = { now: 10, player: { position: new THREE.Vector3(50, 0, 50) } } as unknown as AiWorld;
    const squad = new OutpostSquad(6, 'Foxtrot', { w } as unknown as Outpost);
    const prisoner = makeSoldier(61, squad, 0, 0);
    const friend = makeSoldier(62, squad, 4, 0);
    squad.leave(prisoner);

    prisoner.fate = 'surrender';
    prisoner.surrendered = true;
    prisoner.surrenderedAt = 0;
    prisoner.watchedAt = 0;
    prisoner.judgeAt = 4;
    prisoner.droppedAt = new THREE.Vector3(1, 0, 0);
    prisoner.e.dist = 30;
    prisoner.e.hasLos = false;

    const fakeOutpost = {
      w,
      soldiers: [prisoner, friend],
      prisoners: 1,
      release: vi.fn(),
      rejoin: vi.fn(),
      reclaimWeapon: vi.fn(),
      comms: { say: vi.fn() },
    } as unknown as Outpost;

    const captives = new Prisoners(w, fakeOutpost);
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      // Failed rearm check at t = 10 sets rearmCheckAt = 14, while judgeAt advances only by JUDGE_EVERY (1s -> 11s).
      captives.look(prisoner, 10);
      expect(prisoner.rearmCheckAt).toBeGreaterThan(13);
      expect(prisoner.judgeAt).toBeLessThanOrEqual(11);
      expect(prisoner.surrendered).toBe(true);

      // Well before rearmCheckAt (t = 11), friends open fire nearby -> prisoner is freed immediately (bolts with rand=0.99).
      friend.firedAt = 10.8;
      captives.look(prisoner, 11);
      expect(prisoner.surrendered).toBe(false);
      expect(prisoner.fate).toBe('flee');
      expect(prisoner.rearmCheckAt).toBe(0);

      // Second prisoner: failed rearm check at t = 44 must not block PRISONER_SECONDS (45s) release at t = 45.5.
      const p2 = makeSoldier(63, squad, 2, 0);
      squad.leave(p2);
      p2.fate = 'surrender';
      p2.surrendered = true;
      p2.surrenderedAt = 0;
      p2.watchedAt = 0;
      p2.judgeAt = 4;
      p2.droppedAt = new THREE.Vector3(2.5, 0, 0);
      p2.e.dist = 30;
      p2.e.hasLos = false;
      friend.firedAt = -99;
      fakeOutpost.soldiers.push(p2);

      captives.look(p2, 44);
      expect(p2.rearmCheckAt).toBeGreaterThan(45.5);
      expect(fakeOutpost.release).not.toHaveBeenCalled();

      captives.look(p2, 45.5);
      expect(fakeOutpost.release).toHaveBeenCalledWith(p2);
      discharge(p2.e);
    } finally {
      randSpy.mockRestore();
      discharge(prisoner.e);
      discharge(friend.e);
    }
  });

  it('Smoke.blocks checks 3D cloud height so rays high above or far below a cloud are not blocked', () => {
    const fakeCommander = {
      w: {
        now: 10,
        ctx: {
          fx: { smoke: vi.fn() },
          audio: { play: vi.fn() },
        },
      },
    } as unknown as Commander;

    const smoke = new Smoke(fakeCommander);
    smoke.pop(new THREE.Vector3(0, 0, 0));

    // Ground/chest height ray straight through cloud -> blocked.
    expect(smoke.blocks(new THREE.Vector3(-12, 1.5, 0), new THREE.Vector3(12, 1.5, 0))).toBe(true);
    // High over the cloud (y = 12 > 6.5) -> NOT blocked.
    expect(smoke.blocks(new THREE.Vector3(-12, 12, 0), new THREE.Vector3(12, 12, 0))).toBe(false);
    // Far below cloud (y = -4 < -1) -> NOT blocked.
    expect(smoke.blocks(new THREE.Vector3(-12, -4, 0), new THREE.Vector3(12, -4, 0))).toBe(false);
    // Vertical segment inside radius overlapping height -> blocked; above cloud -> NOT blocked.
    expect(smoke.blocks(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 10, 0))).toBe(true);
    expect(smoke.blocks(new THREE.Vector3(0, 8, 0), new THREE.Vector3(0, 20, 0))).toBe(false);
  });

  it('Outpost.order respects priority lock while allowing equal/higher priority or expired locks', () => {
    const w = { now: 10 } as unknown as AiWorld;
    const squad = new OutpostSquad(7, 'Golf', { w } as unknown as Outpost);
    const s = makeSoldier(71, squad, 0, 0);
    const fakeOutpost = { w } as unknown as Outpost;

    const destA = new THREE.Vector3(10, 0, 0);
    const destB = new THREE.Vector3(20, 0, 0);
    const destC = new THREE.Vector3(30, 0, 0);
    const destD = new THREE.Vector3(40, 0, 0);

    Outpost.prototype.order.call(fakeOutpost, s, destA, null, 2, 0, 2, 3);
    expect(s.dest).toEqual(destA);
    expect(s.orderPriority).toBe(2);
    expect(s.orderLockUntil).toBe(13);

    // Lower priority while locked -> ignored.
    w.now = 11;
    Outpost.prototype.order.call(fakeOutpost, s, destB, null, 1, 0, 1, 0);
    expect(s.dest).toEqual(destA);

    // Equal priority while locked -> succeeds.
    Outpost.prototype.order.call(fakeOutpost, s, destC, null, 2, 0, 2, 2);
    expect(s.dest).toEqual(destC);
    expect(s.orderLockUntil).toBe(13);

    // Expired lock -> lower priority now succeeds.
    w.now = 13.5;
    Outpost.prototype.order.call(fakeOutpost, s, destD, null, 0, 0, 0, 0);
    expect(s.dest).toEqual(destD);

    discharge(s.e);
  });

  it('Outpost.radio requires live radiomen on both ends beyond 22m while still relaying shouts within 22m', () => {
    const w = { now: 10 } as unknown as AiWorld;
    const intel = { report: vi.fn() };
    const sender = new OutpostSquad(8, 'Alpha', { w } as unknown as Outpost);
    const nearSquad = new OutpostSquad(9, 'Bravo', { w } as unknown as Outpost);
    const farWithRadio = new OutpostSquad(10, 'Charlie', { w } as unknown as Outpost);
    const farNoRadio = new OutpostSquad(11, 'Delta', { w } as unknown as Outpost);

    const sSender = makeSoldier(81, sender, 0, 0);
    const sNear = makeSoldier(82, nearSquad, 15, 0); // 15m <= 22m
    const sFarRadio = makeSoldier(83, farWithRadio, 60, 0); // 60m > 22m
    const sFarMute = makeSoldier(84, farNoRadio, 60, 10); // 60m > 22m

    nearSquad.radioman = null;
    farNoRadio.radioman = null;
    expect(sender.radioman).toBe(sSender);
    expect(farWithRadio.radioman).toBe(sFarRadio);

    const fakeOutpost = {
      w,
      stealthMode: false,
      stealth: { lockdown: false },
      intel,
      squads: [sender, nearSquad, farWithRadio, farNoRadio],
      radioAt: -1,
      radioSeen: false,
      radioFrom: null,
      radioPosition: new THREE.Vector3(),
      radioOrigin: new THREE.Vector3(),
      hasLiveRadio: (Outpost.prototype as unknown as { hasLiveRadio: (q: OutpostSquad) => boolean }).hasLiveRadio,
      squadOrigin: (Outpost.prototype as unknown as { squadOrigin: (q: OutpostSquad, out: THREE.Vector3) => boolean }).squadOrigin,
    };

    const target = new THREE.Vector3(5, 1, 5);
    Outpost.prototype.radio.call(fakeOutpost as unknown as Outpost, target, true, sender);
    w.now = 12;
    (Outpost.prototype as unknown as { updateRadio(now: number): void }).updateRadio.call(fakeOutpost, 12);

    expect(intel.report).toHaveBeenCalledTimes(1);
    expect(nearSquad.knownAt).toBe(12);
    expect(farWithRadio.knownAt).toBe(12);
    expect(farNoRadio.knownAt).toBe(-99);

    // Now sender loses its radioman: remote squads must NOT hear, but near squad (<= 22m) still hears shouts.
    intel.report.mockClear();
    sender.radioman = null;
    nearSquad.knownAt = farWithRadio.knownAt = farNoRadio.knownAt = -99;

    w.now = 20;
    Outpost.prototype.radio.call(fakeOutpost as unknown as Outpost, target, true, sender);
    w.now = 22;
    (Outpost.prototype as unknown as { updateRadio(now: number): void }).updateRadio.call(fakeOutpost, 22);

    expect(intel.report).not.toHaveBeenCalled();
    expect(nearSquad.knownAt).toBe(22);
    expect(farWithRadio.knownAt).toBe(-99);
    expect(farNoRadio.knownAt).toBe(-99);

    discharge(sSender.e);
    discharge(sNear.e);
    discharge(sFarRadio.e);
    discharge(sFarMute.e);
  });
});
