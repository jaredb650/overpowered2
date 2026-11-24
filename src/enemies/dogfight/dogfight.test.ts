import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { MissileTarget, VehicleRadarTarget } from '../../core/gameplay';
import { pickContract } from '../../contracts/select';
import { ModelMaterials } from '../../progression/modelkit';
import {
  CARRIER_AIRCRAFT_TERMINAL,
  CARRIER_CATAPULT_PAD,
  CARRIER_CIWS_MOUNTS,
  CARRIER_DECK_RECT,
  CARRIER_DECK_Y,
  CARRIER_DEFENSE_TERMINAL,
  CARRIER_SAM_MOUNTS,
  DOGFIGHT_BOUNDS,
  DOGFIGHT_LIGHT_BOUNDS,
  DOGFIGHT_LIGHT_CELL,
  DOGFIGHT_PLAYER_SPAWN,
  DOGFIGHT_SKY_SPAWNS,
} from '../../world/map/dogfight/plan';
import { SURVIVAL_MAPS, modesOn } from '../../ui/screens/mainmenu';
import { AiCombatJet } from './aiJet';
import { CARRIER_BASE_HP, CARRIER_START_CREDITS, CarrierDefenseSystem } from './carrier';
import { HANGAR_AIRCRAFT } from './terminalUi';
import { dogfightWaveRoster, dogfightWaveSkill } from './waves';

function mockCtx(): Ctx {
  const scene = new THREE.Scene();
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    events: {
      on: vi.fn((ev: string, fn: (...args: unknown[]) => void) => {
        const arr = listeners.get(ev) ?? [];
        arr.push(fn);
        listeners.set(ev, arr);
        return () => {};
      }),
      emit: vi.fn(),
    },
    render: { scene, materials: { patch: (m: unknown) => m } },
    audio: { play: vi.fn() },
    fx: { sparks: vi.fn(), explosion: vi.fn() },
    hud: {
      feed: vi.fn(),
      hitMarker: vi.fn(),
      follow: vi.fn(() => vi.fn()),
    },
    physics: {
      addStaticBox: vi.fn(() => ({
        handle: Math.floor(Math.random() * 100_000) + 1,
        setTranslation: vi.fn(),
        setRotation: vi.fn(),
      })),
      world: { removeCollider: vi.fn() },
    },
  } as unknown as Ctx;
}

describe('Dogfight Map Plan & Registration', () => {
  it('keeps LightVolume voxel dimensions strictly inside the 200x48 cell budget', () => {
    const nx = Math.ceil((DOGFIGHT_LIGHT_BOUNDS.x1 - DOGFIGHT_LIGHT_BOUNDS.x0) / DOGFIGHT_LIGHT_CELL);
    const ny = Math.ceil((DOGFIGHT_LIGHT_BOUNDS.y1 - DOGFIGHT_LIGHT_BOUNDS.y0) / DOGFIGHT_LIGHT_CELL);
    const nz = Math.ceil((DOGFIGHT_LIGHT_BOUNDS.z1 - DOGFIGHT_LIGHT_BOUNDS.z0) / DOGFIGHT_LIGHT_CELL);
    expect(nx).toBeLessThanOrEqual(200);
    expect(nz).toBeLessThanOrEqual(200);
    expect(ny).toBeLessThanOrEqual(48);
  });

  it('places player spawn, catapult pad, and deck terminals cleanly on the flight deck', () => {
    for (const pt of [DOGFIGHT_PLAYER_SPAWN, CARRIER_CATAPULT_PAD, CARRIER_AIRCRAFT_TERMINAL, CARRIER_DEFENSE_TERMINAL]) {
      expect(pt[1]).toBe(CARRIER_DECK_Y);
      expect(pt[0]).toBeGreaterThanOrEqual(CARRIER_DECK_RECT.x0);
      expect(pt[0]).toBeLessThanOrEqual(CARRIER_DECK_RECT.x1);
      expect(pt[2]).toBeGreaterThanOrEqual(CARRIER_DECK_RECT.z0);
      expect(pt[2]).toBeLessThanOrEqual(CARRIER_DECK_RECT.z1);
    }
    expect(CARRIER_CIWS_MOUNTS.length).toBe(4);
    expect(CARRIER_SAM_MOUNTS.length).toBe(3);
  });

  it('places all sky spawns inside Dogfight airspace bounds', () => {
    for (const [x, y, z] of DOGFIGHT_SKY_SPAWNS) {
      expect(x).toBeGreaterThan(DOGFIGHT_BOUNDS.x0);
      expect(x).toBeLessThan(DOGFIGHT_BOUNDS.x1);
      expect(y).toBeGreaterThan(CARRIER_DECK_Y + 20);
      expect(y).toBeLessThan(DOGFIGHT_BOUNDS.y1);
      expect(z).toBeGreaterThan(DOGFIGHT_BOUNDS.z0);
      expect(z).toBeLessThan(DOGFIGHT_BOUNDS.z1);
    }
  });

  it('registers Dogfight in contracts, Survival menu, and hangar roster', () => {
    const picked = pickContract('dogfight', null);
    expect(picked.def.id).toBe('dogfight');
    expect(picked.map).toBe('dogfight');
    expect(picked.ranked).toBe(true);
    expect(SURVIVAL_MAPS.some(m => m.map === 'dogfight' && m.name === 'Dogfight')).toBe(true);
    expect(modesOn('dogfight').map(c => c.id)).toContain('dogfight');
    expect(HANGAR_AIRCRAFT.map(a => a.id)).toEqual(['hornet', 'raptor', 'lancer', 'harrier', 'warthog', 'kestrel']);
  });
});

describe('Dogfight Wave Scaling & Pilot Skill', () => {
  it('starts gentle on Wave 1 and escalates through Lancer bombers and Raptor Aces', () => {
    expect(dogfightWaveRoster(1)).toEqual(['hornet', 'hornet']);
    expect(dogfightWaveRoster(2)).toContain('harrier');
    expect(dogfightWaveRoster(3)).toContain('warthog');
    expect(dogfightWaveRoster(4)).toContain('lancer');
    expect(dogfightWaveRoster(5)).toContain('raptor');
    expect(dogfightWaveRoster(10).filter(k => k === 'raptor').length).toBeGreaterThanOrEqual(2);
  });

  it('smoothly scales pilot skill from rookie to elite ace', () => {
    expect(dogfightWaveSkill(1)).toBeCloseTo(0.35, 2);
    expect(dogfightWaveSkill(5)).toBeGreaterThan(dogfightWaveSkill(1));
    expect(dogfightWaveSkill(10)).toBe(1.0);
  });
});

describe('CarrierDefenseSystem', () => {
  it('handles credit upgrades for CIWS, SAM, Hull Armor, Wingmen, and Emergency Repair', () => {
    const ctx = mockCtx();
    const onCiwsShot = vi.fn();
    const onSamLaunch = vi.fn();
    const onSpawnWingman = vi.fn();
    const onCarrierDestroyed = vi.fn();

    const carrier = new CarrierDefenseSystem(ctx, {
      onCiwsShot,
      onSamLaunch,
      onSpawnWingman,
      onCarrierDestroyed,
    });

    expect(carrier.hp).toBe(CARRIER_BASE_HP);
    expect(carrier.credits).toBe(CARRIER_START_CREDITS);

    // Buy CIWS Lv 1 with starting credits (250 CR)
    expect(carrier.purchase('ciws').ok).toBe(true);
    expect(carrier.ciwsLevel).toBe(1);
    expect(carrier.credits).toBe(CARRIER_START_CREDITS - 250);

    // Insufficient credits for SAM Lv 1 (300 CR)
    expect(carrier.purchase('sam').ok).toBe(false);

    // Add credits and buy SAM Lv 1, Hull Armor Lv 1, and Wingman Lv 1
    carrier.addCredits(2000);
    expect(carrier.purchase('sam').ok).toBe(true);
    expect(carrier.samLevel).toBe(1);

    expect(carrier.purchase('armor').ok).toBe(true);
    expect(carrier.armorLevel).toBe(1);
    expect(carrier.maxHp).toBe(CARRIER_BASE_HP + 1000);

    expect(carrier.purchase('wingman').ok).toBe(true);
    expect(carrier.wingmanLevel).toBe(1);
    expect(onSpawnWingman).toHaveBeenCalledWith('hornet');

    // Damage hull & verify auto-repair + emergency repair
    carrier.damageHull(600, new THREE.Vector3(0, 10, 0), 'B-1 LANCER');
    const hpAfterHit = carrier.hp;
    carrier.update(1.0, []);
    expect(carrier.hp).toBeGreaterThan(hpAfterHit);

    expect(carrier.purchase('repair').ok).toBe(true);
    expect(carrier.hp).toBe(carrier.maxHp);

    // Fatal hull damage triggers carrier destruction callback
    carrier.damageHull(99_999, new THREE.Vector3(0, 10, 0), 'B-1 LANCER');
    expect(carrier.destroyed).toBe(true);
    expect(onCarrierDestroyed).toHaveBeenCalledTimes(1);
  });
});

describe('AiCombatJet Combat & ExtraTarget Integration', () => {
  it('flies smoothly, exposes paintable & radarTargets for AA Lead Pips, takes damage, and triggers kill callback', () => {
    const ctx = mockCtx();
    const materials = new ModelMaterials(ctx);
    const onKilled = vi.fn();
    const onCarrierStrike = vi.fn();

    const jet = new AiCombatJet(
      ctx,
      materials,
      'raptor',
      'enemy',
      new THREE.Vector3(0, 75, -140),
      0,
      0.85,
      {
        onGunShot: vi.fn(),
        onMissileLaunch: vi.fn(),
        onCarrierStrike,
        onKilled,
      },
    );

    const paintList: MissileTarget[] = [];
    jet.paintable(paintList);
    expect(paintList).toHaveLength(1);
    expect(paintList[0]).toBe(jet);

    const radarList: VehicleRadarTarget[] = [];
    jet.radarTargets(radarList);
    expect(radarList).toHaveLength(1);
    expect(radarList[0]!.airborne).toBe(true);

    // Step flight forward and verify movement + dogfight state acquisition when player is airborne
    const startZ = jet.position.z;
    for (let i = 0; i < 30; i++) {
      jet.update(1 / 30, new THREE.Vector3(20, 65, -40), new THREE.Vector3(0, 0, -45), true, []);
    }
    expect(jet.position.z).toBeGreaterThan(startZ);
    expect(['dogfight', 'carrier_run', 'extend', 'evade']).toContain(jet.state);

    // Deal lethal blast damage and confirm death spiral + kill callback
    const caught = jet.blast(jet.position.clone(), {
      radius: 15,
      damage: 2500,
      kind: 'rocket',
      source: 'aim9x',
      team: 'player',
      scale: 1,
    });
    expect(caught).toBe(1);
    expect(jet.alive).toBe(false);
    expect(jet.state).toBe('dying');
    expect(onKilled).toHaveBeenCalledTimes(1);

    // Dead jet must no longer expose paintable or radar target
    paintList.length = 0;
    radarList.length = 0;
    jet.paintable(paintList);
    jet.radarTargets(radarList);
    expect(paintList).toHaveLength(0);
    expect(radarList).toHaveLength(0);

    jet.dispose();
  });
});
