/** Unit & behavioral tests for destructible emplaced machine guns (`Emplacement` & `Emplacements`). */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import type { ExtraTarget } from '../enemies/vehicles';
import { ModelMaterials } from '../progression/modelkit';
import { Emplacements, MOUNT_LEVELS } from './emplacement';
import type { SeatRig } from './seat';

function makeMockEnv() {
  let nextHandle = 1;
  const colliders = new Map<number, { handle: number; pos: THREE.Vector3; rot: THREE.Quaternion; half: THREE.Vector3 }>();
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const liquidated: { label: string; value: number; kind: string; position: THREE.Vector3 }[] = [];
  const enemyDamage: { enemy: EnemyInstance; amount: number; source: string }[] = [];
  const addedExtras: ExtraTarget[] = [];
  const explosions: THREE.Vector3[] = [];
  const sounds: string[] = [];
  const feeds: string[] = [];
  const scene = new THREE.Scene();

  let supportHit = true;
  let interactPressed = false;
  let seatOccupied = false;

  const ctx = {
    time: { elapsed: 0, dt: 0.016 },
    render: {
      scene,
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
    },
    physics: {
      addStaticBox: (pos: THREE.Vector3, half: THREE.Vector3) => {
        const handle = nextHandle++;
        const rec = { handle, pos: pos.clone(), rot: new THREE.Quaternion(), half: half.clone() };
        colliders.set(handle, rec);
        return {
          handle,
          setTranslation: (v: THREE.Vector3) => rec.pos.copy(v),
          setRotation: (q: THREE.Quaternion) => rec.rot.copy(q),
          setHalfExtents: (h: THREE.Vector3) => rec.half.copy(h),
        };
      },
      raycast: () => (supportHit ? { distance: 0.12, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) } : null),
      world: {},
    },
    player: {
      position: new THREE.Vector3(0, 0, 0),
      eye: new THREE.Vector3(0, 1.6, 0),
      velocity: new THREE.Vector3(),
      alive: true,
      parked: false,
      park: vi.fn(),
      unpark: vi.fn(),
      teleport: vi.fn(),
    },
    input: {
      pressed: (k: string) => k === 'interact' && interactPressed,
      isDown: () => false,
      labelFor: () => 'E',
    },
    audio: {
      play: (id: string) => sounds.push(id),
      startLoop: vi.fn(() => ({ alive: true, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn(), stop: vi.fn() })),
    },
    fx: {
      explosion: (p: THREE.Vector3) => explosions.push(p.clone()),
      chips: vi.fn(),
      embers: vi.fn(),
      sparks: vi.fn(),
      smoke: vi.fn(),
      muzzleFlash: vi.fn(),
      tracer: vi.fn(),
      shellCasing: vi.fn(),
    },
    hud: {
      hitMarker: vi.fn(),
      feed: (t: string) => feeds.push(t),
      follow: () => () => {},
    },
    camera: {
      addTrauma: vi.fn(),
      kick: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
      snap: vi.fn(),
      setFov: vi.fn(),
      camera: new THREE.PerspectiveCamera(),
    },
    events: {
      on: (type: string, fn: (e: unknown) => void) => {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
        return () => {};
      },
      emit: (type: string, payload: unknown) => {
        if (type === 'world:liquidated') {
          liquidated.push(payload as { label: string; value: number; kind: string; position: THREE.Vector3 });
        }
        for (const fn of listeners.get(type) ?? []) fn(payload);
      },
    },
    enemies: {
      vehicles: {
        addExtra: (extra: ExtraTarget) => addedExtras.push(extra),
        removeExtra: vi.fn(),
      },
      applyDamage: (enemy: EnemyInstance, dmg: { amount: number; source: string }) => {
        enemyDamage.push({ enemy, amount: dmg.amount, source: dmg.source });
      },
    },
    combat: { fireRay: vi.fn() },
  } as unknown as Ctx;

  const rig = {
    get occupied() {
      return seatOccupied;
    },
    claim: () => {
      seatOccupied = true;
    },
    release: () => {
      seatOccupied = false;
    },
    hud: {
      open: vi.fn(),
      close: vi.fn(),
      update: vi.fn(),
    },
    onLeave: vi.fn(),
  } as unknown as SeatRig;

  const materials = new ModelMaterials(ctx);
  const emplacements = new Emplacements(ctx, materials, rig, vi.fn());

  return {
    ctx,
    rig,
    emplacements,
    colliders,
    liquidated,
    enemyDamage,
    addedExtras,
    explosions,
    sounds,
    feeds,
    setSupportHit: (v: boolean) => { supportHit = v; },
    setInteractPressed: (v: boolean) => { interactPressed = v; },
    isSeatOccupied: () => seatOccupied,
  };
}

describe('Destructible Emplaced Machine Guns (Emplacement & Emplacements)', () => {
  it('assigns per-level maxHp (240 / 320 / 450) and registers as an ExtraTarget on VehicleSystem', () => {
    const env = makeMockEnv();
    expect(MOUNT_LEVELS[0]!.maxHp).toBe(240);
    expect(MOUNT_LEVELS[1]!.maxHp).toBe(320);
    expect(MOUNT_LEVELS[2]!.maxHp).toBe(450);
    expect(env.addedExtras).toContain(env.emplacements);

    const e1 = env.emplacements.place({ pos: new THREE.Vector3(0, 0, 0), yaw: 0, arc: 1.2, level: 1 });
    const e2 = env.emplacements.place({ pos: new THREE.Vector3(10, 0, 0), yaw: 0, arc: 1.2, level: 2 });
    const e3 = env.emplacements.place({ pos: new THREE.Vector3(20, 0, 0), yaw: 0, arc: 1.2, level: 3 });
    expect(e1.maxHp).toBe(240);
    expect(e1.hp).toBe(240);
    expect(e2.maxHp).toBe(320);
    expect(e3.maxHp).toBe(450);
  });

  it('breaks from gunfire & heavy ordnance, kills hostile gunner, emits world:liquidated, disables interaction, and restores on clear()', () => {
    const env = makeMockEnv();
    const gun = env.emplacements.place({ pos: new THREE.Vector3(4, 0, 4), yaw: 0, arc: 1.2, level: 1 });
    const shieldCol = gun.colliderFor('shield');
    const bodyCol = gun.colliderFor('body');

    const hostileGunner = { uid: 99, alive: true, position: gun.standAt.clone() } as unknown as EnemyInstance;
    expect(gun.occupy(hostileGunner, true)).toBe(true);
    expect(gun.hostile).toBe(true);

    // Light rifle round on shield deals 0.85x; heavy round on body deals 1.0x.
    expect(env.emplacements.shot(shieldCol, gun.pivot, 40, 'smg')).toBe(true);
    expect(gun.hp).toBe(240 - 34);
    expect(gun.destroyed).toBe(false);

    expect(env.emplacements.shot(bodyCol, gun.pivot, 60, 'sabot')).toBe(true);
    expect(gun.hp).toBe(240 - 34 - 60);

    // Enemy gunner's own shots don't hurt their own gun.
    expect(env.emplacements.shot(shieldCol, gun.pivot, 50, 'enemy_emplacement')).toBe(true);
    expect(gun.hp).toBe(240 - 34 - 60);

    // Direct rocket hit on body finishes the emplacement!
    expect(env.emplacements.direct(bodyCol, gun.pivot, 160, 'rocket', 'rocket')).toBe(true);
    expect(gun.destroyed).toBe(true);
    expect(gun.hp).toBe(0);
    expect(gun.occupant).toBeNull();
    expect(gun.hostile).toBe(false);

    // Hostile gunner was blasted/killed off the gun.
    expect(env.enemyDamage.length).toBe(1);
    expect(env.enemyDamage[0]!.enemy).toBe(hostileGunner);
    expect(env.enemyDamage[0]!.source).toBe('emplacement_blast');

    // Both colliders parked far underground so nothing blocks shots or movement.
    expect(env.colliders.get(shieldCol.handle)!.pos.y).toBeLessThan(-500);
    expect(env.colliders.get(bodyCol.handle)!.pos.y).toBeLessThan(-500);

    // Emitted world:liquidated for Bureau Asset Liquidation ticker.
    expect(env.liquidated).toHaveLength(1);
    expect(env.liquidated[0]!.label).toBe('EMPLACED HMG');
    expect(env.liquidated[0]!.value).toBe(12000);
    expect(env.liquidated[0]!.kind).toBe('emplacement');

    // Permanently disabled while destroyed: cannot be occupied or manned by player/AI.
    expect(gun.occupy({ id: 'ally' }, false)).toBe(false);
    env.ctx.player.position.copy(gun.standAt);
    env.setInteractPressed(true);
    env.emplacements.update(0.05, true);
    expect(gun.occupant).toBeNull();
    expect(env.isSeatOccupied()).toBe(false);

    // clear() for a new run/checkpoint restores intact state cleanly.
    env.setInteractPressed(false);
    env.emplacements.clear();
    expect(gun.destroyed).toBe(false);
    expect(gun.hp).toBe(gun.maxHp);
    expect(env.colliders.get(bodyCol.handle)!.pos.y).toBeCloseTo(0.68, 2);
    expect(gun.occupy({ id: 'ally2' }, false)).toBe(true);
  });

  it('destroys via explosion blast and cleanly ejects an ally occupant', () => {
    const env = makeMockEnv();
    const gun = env.emplacements.place({ pos: new THREE.Vector3(12, 0, -6), yaw: 0.5, arc: 1.0, level: 2 });
    const ally = { uid: 7 };
    expect(gun.occupy(ally, false)).toBe(true);

    const hits = env.emplacements.blast(new THREE.Vector3(13, 1, -6), {
      radius: 7,
      damage: 280,
      kind: 'shell',
      source: 'frame_howitzer',
      team: 'player',
    });
    expect(hits).toBe(1);
    expect(gun.destroyed).toBe(true);
    expect(gun.occupant).toBeNull();
    // Ally was NOT dealt enemy damage — simply vacated so ally AI dismounts cleanly.
    expect(env.enemyDamage.length).toBe(0);
    expect(env.explosions.length).toBeGreaterThanOrEqual(1);
  });

  it('collapses elevated emplacements when their supporting structure is liquidated or disappears', () => {
    const env = makeMockEnv();
    const towerGun = env.emplacements.place({ pos: new THREE.Vector3(40, 6.2, -12), yaw: Math.PI, arc: 1.4, level: 1 });

    // Initial tick confirms solid platform beneath the elevated tripod.
    env.setSupportHit(true);
    env.emplacements.update(0.05, true);
    expect(towerGun.destroyed).toBe(false);

    // Supporting watchtower collapses -> downward raycast returns null and world:liquidated fires nearby.
    env.setSupportHit(false);
    env.ctx.events.emit('world:liquidated', {
      label: 'WATCHTOWER',
      value: 45000,
      kind: 'watchtower',
      position: new THREE.Vector3(41, 0, -12),
    });

    expect(towerGun.destroyed).toBe(true);
    expect(env.liquidated.some(l => l.kind === 'emplacement')).toBe(true);
  });

  it('destroys via Frame blow (stomp/charge) and simulates scrap without throwing', () => {
    const env = makeMockEnv();
    const gun = env.emplacements.place({ pos: new THREE.Vector3(-8, 0, 10), yaw: 0, arc: 1.0, level: 3 });

    const hits = env.emplacements.frameBlow(new THREE.Vector3(-8, 1, 10), 4, 340);
    expect(hits).toBe(1);
    expect(gun.destroyed).toBe(true);
    expect(gun.hp).toBe(0);

    // Stepping update advances flying scrap pieces and lingering wreck smoke cleanly.
    for (let i = 0; i < 30; i++) {
      env.emplacements.update(0.1, true);
    }
    expect(env.ctx.fx.smoke).toHaveBeenCalled();
  });
});

