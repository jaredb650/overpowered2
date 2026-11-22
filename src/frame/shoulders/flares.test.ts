/** Tests for the Countermeasure Rack shoulder plug-in and its 3D model. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { Ac130Rounds } from '../../progression/callins/ac130Rounds';
import { ModelBuilder } from '../../progression/modelkit';
import type { GunnerWeapon } from '../../vehicles/hud';
import { buildFlareRack, SHOULDER_FLARES } from '../models/shoulder-flares';
import { FrameGuns, type Arm, type Sight } from '../weapons';
import {
  FLARES_AUTO_COOLDOWN,
  FLARES_PLUGIN,
  FLARES_SMOKE_MODIFIER,
  FlaresShoulder,
} from './flares';
import type { ShoulderUpdateContext } from './types';

const DT = 1 / 60;

function makeHarness(incomingMissile: () => boolean) {
  let freeFlaresPopped = 0;
  const sounds: string[] = [];

  const ctx = {
    input: { isDown: () => false, pressed: () => false },
    combat: {
      hasIncomingEnemyMissile: () => incomingMissile(),
      fireRay: () => undefined,
      explode: () => undefined,
      spawnProjectile: () => undefined,
    },
    audio: {
      play: (id: string) => sounds.push(id),
      startLoop: () => ({ stop: () => undefined, setPitch: () => undefined }),
    },
    fx: {
      smoke: () => undefined,
      sparks: () => undefined,
      ring: () => undefined,
      muzzleFlash: () => undefined,
      shellCasing: () => undefined,
      tracer: () => undefined,
    },
    camera: { addTrauma: () => undefined, kick: () => undefined },
    enemies: { alive: [], query: () => 0, vehicles: null },
    physics: { raycast: () => null, raycastInto: () => false },
    render: { lights: { flash: () => undefined } },
    hud: { callout: () => undefined },
  } as unknown as Ctx;

  const makeUpdate = (online = true): ShoulderUpdateContext => ({
    ctx,
    rounds: null as unknown as ShoulderUpdateContext['rounds'],
    slot: 0,
    keyLabel: 'G',
    cycleKeyLabel: '3',
    sight: {
      view: { position: new THREE.Vector3(0, 5, 0) } as ShoulderUpdateContext['sight']['view'],
      aim: new THREE.Vector3(0, 0, -1),
      point: new THREE.Vector3(0, 1, -40),
      range: 40,
    },
    mountPos: out => out.set(1.5, 6.2, -0.5),
    feet: new THREE.Vector3(0, 0, 0),
    torsoYaw: 0,
    held: false,
    pressed: false,
    cyclePressed: false,
    online,
    gatherTargets: () => [],
    onMissile: null,
    onNews: null,
    popFreeFlares: () => { freeFlaresPopped++; },
  });

  return { ctx, sounds, getPopped: () => freeFlaresPopped, makeUpdate };
}

describe('Countermeasure Rack shoulder plug-in', () => {
  it('exposes smokeModifier (6 maxCharges, 7 s refillSeconds, 1.5x screenScale) and upgrades FrameGuns smoke', () => {
    const h = makeHarness(() => false);
    const rack = FLARES_PLUGIN.create(h.ctx) as FlaresShoulder;

    expect(rack.smokeModifier).toEqual({
      maxCharges: 6,
      refillSeconds: 7,
      screenScale: 1.5,
    });
    expect(rack.smokeModifier).toBe(FLARES_SMOKE_MODIFIER);

    // Wire into FrameGuns to confirm Q smoke upgrades automatically.
    const rounds = {
      onImpact: null,
      fire: () => undefined,
      flare: () => undefined,
      flash: () => undefined,
      update: () => undefined,
      clear: () => undefined,
    } as unknown as Ac130Rounds;
    const arm: Arm = {
      muzzle: out => out.set(1, 3, 0),
      bore: out => out.set(0, 0, -1),
      turn: () => undefined,
      recoil: () => undefined,
    };
    const guns = new FrameGuns(h.ctx, rounds, arm, arm, out => out.set(1, 5, 0));
    guns.fitShoulders(['flares']);
    expect(guns.smoke.maxCount).toBe(6);
    expect(guns.smoke.count).toBe(6);
    expect(guns.smoke.refillSeconds).toBe(7);
    expect(guns.smoke.screenScale).toBe(1.5);
  });

  it('auto-pops free flares on incoming enemy missile with a 5.0 s cooldown and spends zero Q smoke charges', () => {
    let missileIncoming = false;
    const h = makeHarness(() => missileIncoming);
    const rack = FLARES_PLUGIN.create(h.ctx) as FlaresShoulder;
    const row: GunnerWeapon = { name: '', ammo: 0, max: 0, reload: -1 };

    // No missile -> no pop, HUD shows READY (ammo 1/1, reload -1).
    rack.update(DT, h.makeUpdate());
    expect(h.getPopped()).toBe(0);
    rack.fillRow(row, 'G', '3', true);
    expect(row.name).toBe('CM RACK AUTO-FLARE');
    expect(row.ammo).toBe(1);
    expect(row.max).toBe(1);
    expect(row.reload).toBe(-1);

    // Incoming enemy missile -> pops free flares immediately and starts 5.0 s cooldown.
    missileIncoming = true;
    rack.update(DT, h.makeUpdate());
    expect(h.getPopped()).toBe(1);
    expect(rack.ready).toBe(false);
    expect(rack.cooldownRemaining).toBeCloseTo(FLARES_AUTO_COOLDOWN, 3);

    // Still locked out for the next 4.8 s even with missiles incoming.
    for (let t = 0; t < 4.8; t += DT) rack.update(DT, h.makeUpdate());
    expect(h.getPopped()).toBe(1);
    rack.fillRow(row, 'G', '3', true);
    expect(row.ammo).toBe(0);
    expect(row.reload).toBeGreaterThan(0.9);
    expect(row.reload).toBeLessThan(1.0);

    // Once 5.0 s elapses, triggers again on incoming missile.
    for (let t = 0; t < 0.3; t += DT) rack.update(DT, h.makeUpdate());
    expect(h.getPopped()).toBe(2);

    // Verify Q smoke count is untouched when FrameGuns runs auto-flares.
    let flaresDrawn = 0;
    const rounds = {
      onImpact: null,
      fire: () => undefined,
      flare: () => { flaresDrawn++; },
      flash: () => undefined,
      update: () => undefined,
      clear: () => undefined,
    } as unknown as Ac130Rounds;
    const arm: Arm = {
      muzzle: out => out.set(1, 3, 0),
      bore: out => out.set(0, 0, -1),
      turn: () => undefined,
      recoil: () => undefined,
    };
    const sight: Sight = {
      view: { position: new THREE.Vector3(0, 5, 0) } as Sight['view'],
      aim: new THREE.Vector3(0, 0, -1),
      point: new THREE.Vector3(0, 1, -40),
      range: 40,
    };
    const guns = new FrameGuns(h.ctx, rounds, arm, arm, out => out.set(1, 5, 0));
    guns.fitShoulders(['flares']);
    guns.update(DT, sight);
    expect(flaresDrawn).toBeGreaterThan(0);
    expect(guns.smoke.count).toBe(6);
  });

  it('builds a valid 3D Countermeasure Rack model with solid and glow geometry', () => {
    const b = new ModelBuilder();
    SHOULDER_FLARES(b);
    expect(SHOULDER_FLARES).toBe(buildFlareRack);
    expect(b.solidGeometry()).not.toBeNull();
    expect(b.glowGeometry()).not.toBeNull();
  });
});
