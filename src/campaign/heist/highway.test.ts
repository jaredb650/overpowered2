import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { lookup } from '../../audio/catalog';
import type { Ctx, PlayerDamage, SeatView } from '../../core/contracts';
import { HIGHWAY_LANES, HIGHWAY_ORIGIN, LV } from '../../world/map/bank/plan';
import { HIGHWAY_CONSTANTS, HighwayChase } from './highway';

function createMockCtx() {
  const scene = new THREE.Scene();
  const downActions = new Set<string>();
  const pressedActions = new Set<string>();
  let lookX = 0;
  let lookY = 0;
  const frameLook = { x: 0, y: 0 };

  const playedSounds: string[] = [];
  const startedLoops: string[] = [];
  const stoppedLoops: string[] = [];
  const feeds: string[] = [];
  const hitMarkers: string[] = [];
  const explosions: { pos: THREE.Vector3; radius: number }[] = [];
  const tracers: { from: THREE.Vector3; to: THREE.Vector3; kind: string }[] = [];

  let seat: SeatView | null = null;
  let zoomFov: number | null = null;
  let holstered = false;
  let parked = false;
  let parkedExposed = false;
  let unparkCalls = 0;
  let playerHealth = 100;
  const lethalHits: PlayerDamage[] = [];

  const player = {
    position: new THREE.Vector3(),
    eye: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
    yaw: 0,
    pitch: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    alive: true,
    sensitivity: 0.0025,
    invertY: false,
    lookScale: 1,
    get parked() { return parked; },
    interceptor: null as ((d: PlayerDamage) => boolean) | null,
    park(feet: THREE.Vector3, exposed = false) {
      parked = true;
      parkedExposed = exposed;
      player.position.copy(feet);
    },
    unpark(_grace: number) {
      parked = false;
      parkedExposed = false;
      unparkCalls++;
    },
    carry(feet: THREE.Vector3) {
      if (parked) player.position.copy(feet);
    },
    takeDamage(dmg: PlayerDamage) {
      if (parked && !parkedExposed) return;
      if (player.interceptor?.(dmg)) return;
      playerHealth = Math.max(0, playerHealth - dmg.amount);
      player.health = playerHealth;
      if (playerHealth <= 0) {
        player.alive = false;
        lethalHits.push(dmg);
      }
    },
  };

  const ctx = {
    render: {
      scene,
      materials: {
        patch: <T extends THREE.MeshStandardMaterial>(m: T) => m,
      },
      lights: {
        flash: vi.fn(),
      },
      post: {
        flash: vi.fn(),
        damageDirection: vi.fn(),
      },
    },
    camera: {
      setSeat(v: SeatView | null) { seat = v; },
      syncSeat: vi.fn(),
      setZoom(fov: number | null) { zoomFov = fov; },
      kick: vi.fn(),
      addTrauma: vi.fn(),
    },
    input: {
      isDown: (a: string) => downActions.has(a),
      pressed: (a: string) => pressedActions.has(a),
      released: () => false,
      frameLook,
      consumeLook() {
        const out = { x: lookX, y: lookY };
        frameLook.x = lookX;
        frameLook.y = lookY;
        lookX = 0;
        lookY = 0;
        return out;
      },
      simulateLook(dx: number, dy: number) {
        lookX += dx;
        lookY += dy;
      },
    },
    player,
    weapons: {
      setHolstered(h: boolean) { holstered = h; },
    },
    fx: {
      muzzleFlash: vi.fn(),
      tracer: (from: THREE.Vector3, to: THREE.Vector3, kind: string) => {
        tracers.push({ from: from.clone(), to: to.clone(), kind });
      },
      shellCasing: vi.fn(),
      explosion: (pos: THREE.Vector3, opts: { radius: number }) => {
        explosions.push({ pos: pos.clone(), radius: opts.radius });
      },
      sparks: vi.fn(),
      smoke: vi.fn(),
      chips: vi.fn(),
      embers: vi.fn(),
    },
    audio: {
      play: (id: string) => { playedSounds.push(id); },
      startLoop: (id: string) => {
        startedLoops.push(id);
        return {
          alive: true,
          setVolume: vi.fn(),
          setPitch: vi.fn(),
          setPosition: vi.fn(),
          stop: () => { stoppedLoops.push(id); },
        };
      },
    },
    hud: {
      feed: (text: string) => { feeds.push(text); },
      hitMarker: (kind: string) => { hitMarkers.push(kind); },
    },
  } as unknown as Ctx;

  return {
    ctx,
    scene,
    downActions,
    pressedActions,
    playedSounds,
    startedLoops,
    stoppedLoops,
    feeds,
    hitMarkers,
    explosions,
    tracers,
    lethalHits,
    getSeat: () => seat,
    getZoomFov: () => zoomFov,
    isHolstered: () => holstered,
    isParked: () => parked,
    isParkedExposed: () => parkedExposed,
    getUnparkCalls: () => unparkCalls,
    setLook: (dx: number, dy: number) => { lookX = dx; lookY = dy; },
  };
}

describe('HighwayChase (Act 4 On-Rails .50 cal Humvee Escape)', () => {
  it('mounts and dismounts cleanly, restoring camera seat, zoom, player park/interceptor, and weapon holster', () => {
    const env = createMockCtx();
    const signals: string[] = [];
    const chase = new HighwayChase(env.ctx, sig => signals.push(sig));

    chase.start(1);
    expect(chase.active).toBe(true);
    expect(chase.mounted).toBe(true);
    expect(chase.phase).toBe('wave1');
    expect(chase.hull).toBe(HIGHWAY_CONSTANTS.maxHull);
    expect(env.getSeat()).not.toBeNull();
    expect(env.getZoomFov()).toBe(HIGHWAY_CONSTANTS.turretFov);
    expect(env.isParked()).toBe(true);
    expect(env.isParkedExposed()).toBe(true);
    expect(env.isHolstered()).toBe(true);
    expect(env.ctx.player.interceptor).not.toBeNull();
    expect(env.startedLoops).toContain('truck_engine_loop');

    // Look & RMB tactical zoom
    env.setLook(120, -40);
    env.downActions.add('aim');
    chase.update(0.016);
    expect(chase.zoomed).toBe(true);
    expect(env.getZoomFov()).toBe(HIGHWAY_CONSTANTS.turretZoomFov);
    expect(chase.yaw).not.toBeCloseTo(Math.PI, 4);
    expect(chase.pitch).toBeGreaterThanOrEqual(HIGHWAY_CONSTANTS.pitchMin);
    expect(chase.pitch).toBeLessThanOrEqual(HIGHWAY_CONSTANTS.pitchMax);

    // Clear restores everything cleanly
    chase.clear();
    expect(chase.active).toBe(false);
    expect(chase.mounted).toBe(false);
    expect(env.getSeat()).toBeNull();
    expect(env.getZoomFov()).toBeNull();
    expect(env.isParked()).toBe(false);
    expect(env.isHolstered()).toBe(false);
    expect(env.ctx.player.interceptor).toBeNull();
    expect(env.getUnparkCalls()).toBe(1);
    expect(env.stoppedLoops).toContain('truck_engine_loop');
    expect(chase.pursuers.length).toBe(0);
    expect(chase.wrecks.length).toBe(0);
  });

  it('tracks barrel heat, triggers overheat lockout, and vents back to zero', () => {
    const env = createMockCtx();
    const chase = new HighwayChase(env.ctx, () => {});
    chase.start(1);
    env.downActions.add('fire');

    // Hold trigger until overheat (72 shots @ 10 rps = 7.2 s)
    let elapsed = 0;
    while (!chase.heat.overheated && elapsed < 10) {
      chase.update(0.05);
      elapsed += 0.05;
    }
    expect(chase.heat.overheated).toBe(true);
    expect(chase.heat.value).toBeLessThanOrEqual(1);
    expect(env.playedSounds).toContain('hmg_shot');
    expect(env.playedSounds).toContain('steam_burst');

    // While locked out, holding fire does not add shots and heat vents down at 0.40/s
    const tracersBefore = env.tracers.length;
    chase.update(0.5);
    expect(env.tracers.length).toBe(tracersBefore);
    expect(chase.heat.value).toBeLessThan(1);

    // Vent completely (~2.5 s at 0.40/s)
    env.downActions.delete('fire');
    for (let i = 0; i < 60; i++) chase.update(0.05);
    expect(chase.heat.overheated).toBe(false);
    expect(chase.heat.value).toBe(0);
  });

  it('supports Wave 1 locational destruction (tire spin-out, engine flip, driver swerve ram) and emits bk:highway_wave1_done', () => {
    const env = createMockCtx();
    const signals: string[] = [];
    const chase = new HighwayChase(env.ctx, sig => signals.push(sig));
    chase.start(1);

    // Verify initial pack spawned
    expect(chase.pursuers.length).toBe(3);
    expect(chase.remainingPursuers).toBe(HIGHWAY_CONSTANTS.wave1Count);

    // 1. Tire pop -> tire_flip spin-out wreck
    const c1 = chase.pursuers[0]!;
    const tireZone = c1.zones.find(z => z.kind === 'tire')!;
    chase.damagePursuerZone(c1, tireZone, 55);
    expect(c1.alive).toBe(false);
    expect(chase.wrecks.some(w => w.id === c1.id && w.mode === 'tire_flip')).toBe(true);

    // 2. Engine shred -> engine_flip airborne nose-flip wreck
    const c2 = chase.pursuers[0]!;
    const engineZone = c2.zones.find(z => z.kind === 'engine')!;
    chase.damagePursuerZone(c2, engineZone, 110);
    expect(c2.alive).toBe(false);
    const engWreck = chase.wrecks.find(w => w.id === c2.id && w.mode === 'engine_flip')!;
    expect(engWreck).toBeDefined();
    expect(engWreck.velocity.y).toBeGreaterThan(8);

    // 3. Driver snipe -> driver_swerve sideways swerve ramming a neighboring cruiser!
    const victimA = chase.pursuers[0]!;
    const victimB = chase.spawnPursuer('cruiser', 2, 16);
    victimA.position.set(HIGHWAY_LANES[1]!, LV.highway, 16);
    victimB.position.set(HIGHWAY_LANES[2]!, LV.highway, 16);
    const cabZone = victimA.zones.find(z => z.kind === 'cab')!;
    chase.damagePursuerZone(victimA, cabZone, 90);
    expect(victimA.alive).toBe(false);
    expect(chase.wrecks.some(w => w.id === victimA.id && w.mode === 'driver_swerve')).toBe(true);

    // Step simulation so swerving cruiser rams neighbor victimB
    for (let i = 0; i < 12 && victimB.alive; i++) chase.update(0.05);
    expect(victimB.alive).toBe(false);

    // Clear all remaining Wave 1 cruisers and verify bk:highway_wave1_done signal
    let guard = 0;
    while (chase.remainingPursuers > 0 && guard < 100) {
      guard++;
      for (const p of [...chase.pursuers]) {
        const ch = p.zones.find(z => z.kind === 'chassis')!;
        chase.damagePursuerZone(p, ch, 200);
      }
      chase.update(0.5);
    }
    expect(chase.remainingPursuers).toBe(0);
    expect(signals).toContain('bk:highway_wave1_done');
  });

  it('detonates Wave 2 fuel tankers in a 16 m chain fireball wiping cruisers and damaging BearCats, then emits bk:highway_wave2_done', () => {
    const env = createMockCtx();
    const signals: string[] = [];
    const chase = new HighwayChase(env.ctx, sig => signals.push(sig));
    chase.start(1);
    chase.damageHumvee(120);
    const hullBeforeWave2 = chase.hull;

    chase.startWave2();
    expect(chase.phase).toBe('wave2');
    // Brief +90 auto-weld breather
    expect(chase.hull).toBe(Math.min(chase.maxHull, hullBeforeWave2 + HIGHWAY_CONSTANTS.wave2Heal));

    // Place a Fuel Tanker next to a Police Cruiser and a SWAT BearCat within 16 m
    const tanker = chase.spawnPursuer('tanker', 1, 18);
    const cruiserNear = chase.spawnPursuer('cruiser', 2, 18);
    const bearcatNear = chase.spawnPursuer('bearcat', 0, 19);
    const bearcatStartHp = bearcatNear.hp;

    // Shoot the tanker's crimson fuel tank weakpoint (110 HP -> 2 shots of 55)
    const tankZone = tanker.zones.find(z => z.kind === 'tank')!;
    chase.damagePursuerZone(tanker, tankZone, 55);
    expect(tanker.alive).toBe(true);
    chase.damagePursuerZone(tanker, tankZone, 55);

    expect(tanker.alive).toBe(false);
    // Nearby police cruiser obliterated instantly
    expect(cruiserNear.alive).toBe(false);
    // Nearby SWAT BearCat takes 220 heavy blast damage
    expect(bearcatNear.hp).toBe(bearcatStartHp - HIGHWAY_CONSTANTS.tankerBearcatDamage);
    expect(env.playedSounds).toContain('explosion_tank');
    expect(env.explosions.some(e => e.radius === HIGHWAY_CONSTANTS.tankerBlastRadius)).toBe(true);

    // Clear all remaining Wave 2 convoy -> emits bk:highway_wave2_done
    let guard = 0;
    while (chase.remainingPursuers > 0 && guard < 120) {
      guard++;
      for (const p of [...chase.pursuers]) {
        const ch = p.zones.find(z => z.kind === 'chassis')!;
        chase.damagePursuerZone(p, ch, 400);
      }
      chase.update(0.5);
    }
    expect(chase.remainingPursuers).toBe(0);
    expect(signals).toContain('bk:highway_wave2_done');
  });

  it('intercepts incoming player damage into Humvee hull and delivers lethal damage when hull reaches 0', () => {
    const env = createMockCtx();
    const chase = new HighwayChase(env.ctx, () => {});
    chase.start(1);

    // Incoming enemy damage goes to Humvee hull, NOT player health
    env.ctx.player.takeDamage({ amount: 100, type: 'bullet', source: 'cruiser', from: new THREE.Vector3(128, 12, 20) });
    expect(chase.hull).toBe(HIGHWAY_CONSTANTS.maxHull - 100);
    expect(env.ctx.player.alive).toBe(true);
    expect(env.ctx.player.health).toBe(100);

    // Enter boss phase patches +110 hull and routes turret shots to extraShotHandler
    const extraHits: number[] = [];
    chase.enterBossPhase();
    expect(chase.phase).toBe('boss');
    expect(chase.hull).toBe(HIGHWAY_CONSTANTS.maxHull);
    chase.registerExtraShotHandler((_o, _d, _m, dmg) => {
      extraHits.push(dmg);
      return { distance: 25, point: new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway + 10, 25) };
    });
    expect(chase.fireSingleShot()).toBe(true);
    expect(extraHits).toEqual([HIGHWAY_CONSTANTS.turretDamage]);

    // Destroying Humvee hull dismounts and delivers lethal player damage
    chase.damageHumvee(HIGHWAY_CONSTANTS.maxHull + 50, undefined, 'auditor1_rocket');
    expect(chase.hull).toBe(0);
    expect(chase.mounted).toBe(false);
    expect(env.ctx.player.interceptor).toBeNull();
    expect(env.ctx.player.alive).toBe(false);
    expect(env.lethalHits.length).toBe(1);
  });

  it('plays the Extraction Tunnel sprint, cleanly dismounts, and emits bk:tunnel_complete', () => {
    const env = createMockCtx();
    const signals: string[] = [];
    const chase = new HighwayChase(env.ctx, sig => signals.push(sig));
    chase.start(1);
    chase.enterBossPhase();
    chase.playExtractionTunnel();
    expect(chase.phase).toBe('tunnel');

    for (let i = 0; i < 30; i++) chase.update(0.1);
    expect(signals).toContain('bk:tunnel_complete');
    expect(chase.mounted).toBe(false);
    expect(env.getSeat()).toBeNull();
    expect(env.ctx.player.interceptor).toBeNull();

    // Every single audio ID played during the highway chase exists in the real audio catalog
    const allIds = [...env.playedSounds, ...env.startedLoops];
    expect(allIds.length).toBeGreaterThan(0);
    for (const id of allIds) {
      expect(lookup(id), `Unknown audio id '${id}'`).toBeDefined();
    }
  });
});
