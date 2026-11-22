import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { lookup } from '../../audio/catalog';
import type { Ctx, PlayerDamage, SeatView } from '../../core/contracts';
import { HIGHWAY_ORIGIN, LV } from '../../world/map/bank/plan';
import { GUNSHIP_BOSS_CONSTANTS, GunshipBoss } from './gunshipBoss';
import { HighwayChase } from './highway';

function createBossMockCtx() {
  const scene = new THREE.Scene();
  const playedSounds: string[] = [];
  const startedLoops: string[] = [];
  const stoppedLoops: string[] = [];
  const emittersAttached: string[] = [];
  const emittersStopped: string[] = [];
  const feeds: string[] = [];
  const hitMarkers: string[] = [];
  const explosions: { pos: THREE.Vector3; radius: number }[] = [];
  const humveeDamageLog: { amount: number; source?: string }[] = [];

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
      setSeat: vi.fn((_v: SeatView | null) => {}),
      syncSeat: vi.fn(),
      setZoom: vi.fn(),
      kick: vi.fn(),
      addTrauma: vi.fn(),
    },
    input: {
      isDown: () => false,
      pressed: () => false,
      released: () => false,
      frameLook: { x: 0, y: 0 },
      consumeLook: () => ({ x: 0, y: 0 }),
    },
    player: {
      position: new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway, HIGHWAY_ORIGIN[2]),
      sensitivity: 0.0022,
      invertY: false,
      lookScale: 1,
      alive: true,
      parked: false,
      interceptor: null as ((d: PlayerDamage) => boolean) | null,
      park: vi.fn(),
      unpark: vi.fn(),
      carry: vi.fn(),
      takeDamage(d: PlayerDamage) {
        if (this.interceptor?.(d)) return;
        humveeDamageLog.push({ amount: d.amount, source: d.source });
      },
    },
    weapons: {
      setHolstered: vi.fn(),
    },
    fx: {
      muzzleFlash: vi.fn(),
      tracer: vi.fn(),
      shellCasing: vi.fn(),
      explosion: (pos: THREE.Vector3, opts: { radius: number }) => {
        explosions.push({ pos: pos.clone(), radius: opts.radius });
      },
      sparks: vi.fn(),
      smoke: vi.fn(),
      chips: vi.fn(),
      embers: vi.fn(),
      attachEmitter: (_target: THREE.Object3D, preset: string) => {
        emittersAttached.push(preset);
        return {
          alive: true,
          stop: () => { emittersStopped.push(preset); },
        };
      },
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
    playedSounds,
    startedLoops,
    stoppedLoops,
    emittersAttached,
    emittersStopped,
    feeds,
    hitMarkers,
    explosions,
    humveeDamageLog,
  };
}

/** Aims a ray from `origin` directly at `target` and calls `boss.hitRay`. */
function shootPoint(boss: GunshipBoss, origin: THREE.Vector3, target: THREE.Vector3, damage: number) {
  const dir = target.clone().sub(origin).normalize();
  return boss.hitRay(origin, dir, 220, damage);
}

describe('GunshipBoss (AUDITOR-1 Pursuit Helicopter Boss)', () => {
  it('supports all 4 destructible subsystems (chin, podL, podR, tail) with 1.35x bonus hull damage and tail signal', () => {
    const env = createBossMockCtx();
    const signals: string[] = [];
    const boss = new GunshipBoss(env.ctx, sig => signals.push(sig));
    const hvPos = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway, HIGHWAY_ORIGIN[2]);
    boss.spawn(() => hvPos);

    expect(boss.active).toBe(true);
    expect(boss.alive).toBe(true);
    expect(boss.hp).toBe(GUNSHIP_BOSS_CONSTANTS.maxHp);
    expect(boss.phase).toBe('strafe');
    expect(boss.salvoSize).toBe(4);

    // 1. Shoot CHIN TURRET during strafe -> deals 1.35x bonus hull damage, staggers at >=90 dmg, destroys at 260
    const chinCenter = boss.getSubsystemWorldCenter('chin');
    const chinShot1 = shootPoint(boss, hvPos, chinCenter, 100);
    expect(chinShot1?.kind).toBe('chin');
    expect(boss.staggered).toBe(true);
    expect(boss.hp).toBe(GUNSHIP_BOSS_CONSTANTS.maxHp - Math.round(100 * GUNSHIP_BOSS_CONSTANTS.subsystemBonusMult));

    shootPoint(boss, hvPos, chinCenter, 170);
    expect(boss.subsystems.chin.destroyed).toBe(true);
    expect(env.feeds.some(f => f.includes('CHIN TURRET'))).toBe(true);

    // 2. Destroy PORT POD -> cuts rocket salvo from 4 -> 2
    const podLCenter = boss.getSubsystemWorldCenter('podL');
    const podLHit = shootPoint(boss, hvPos, podLCenter, 230);
    expect(podLHit?.kind).toBe('podL');
    expect(boss.subsystems.podL.destroyed).toBe(true);
    expect(boss.salvoSize).toBe(2);

    // 3. Destroy STBD POD -> cuts rocket salvo from 2 -> 0
    const podRCenter = boss.getSubsystemWorldCenter('podR');
    const podRHit = shootPoint(boss, hvPos, podRCenter, 230);
    expect(podRHit?.kind).toBe('podR');
    expect(boss.subsystems.podR.destroyed).toBe(true);
    expect(boss.salvoSize).toBe(0);

    // 4. Destroy TAIL ROTOR -> emits bk:boss_tail_damaged & attaches smoke/fire trail emitters
    const tailCenter = boss.getSubsystemWorldCenter('tail');
    // Aim from a side angle so fuselage doesn't sit in front of the tail rotor
    const sideOrigin = tailCenter.clone().add(new THREE.Vector3(20, 0, 0));
    const tailHit = shootPoint(boss, sideOrigin, tailCenter, 270);
    expect(tailHit?.kind).toBe('tail');
    expect(boss.subsystems.tail.destroyed).toBe(true);
    expect(signals).toContain('bk:boss_tail_damaged');
    expect(env.emittersAttached).toContain('smokeTrail');
    expect(env.emittersAttached).toContain('fireTrail');
  });

  it('launches shootable rocket salvos during overpass and prioritizes mid-air .50 cal rocket interception', () => {
    const env = createBossMockCtx();
    const boss = new GunshipBoss(env.ctx, () => {});
    const hvPos = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway, HIGHWAY_ORIGIN[2]);
    const dealt: number[] = [];
    boss.spawn(() => hvPos, amt => dealt.push(amt));

    boss.setPhase('overpass');
    // Advance past the 1.2 s lock-on delay so AUDITOR-1 fires its 4-rocket salvo
    for (let i = 0; i < 16; i++) boss.update(0.1);
    expect(boss.rockets.length).toBe(4);
    expect(env.playedSounds).toContain('aa_lock');
    expect(env.playedSounds).toContain('aa_launch');

    // Intercept 2 of the 4 rockets mid-air with .50 cal shots (including slightly off-center within 1.35 m radius!)
    const r0 = boss.rockets[0]!;
    const slightlyOff = r0.position.clone().add(new THREE.Vector3(0.75, 0.35, 0));
    const intercept0 = shootPoint(boss, hvPos, slightlyOff, 55);
    expect(intercept0?.kind).toBe('rocket');
    expect(boss.rockets.filter(r => !r.alive).length).toBe(1);
    expect(env.feeds.some(f => f.includes('ROCKET INTERCEPTED'))).toBe(true);

    // Shoot a second surviving rocket directly
    const nextAlive = boss.rockets.find(r => r.alive)!;
    const intercept1 = shootPoint(boss, hvPos, nextAlive.position, 55);
    expect(intercept1?.kind).toBe('rocket');
    expect(boss.rockets.filter(r => !r.alive).length).toBe(2);

    // Let the remaining 2 un-intercepted rockets fly in and impact the Humvee
    for (let i = 0; i < 40; i++) boss.update(0.1);
    expect(boss.rockets.length).toBe(0);
    expect(dealt.filter(d => d === GUNSHIP_BOSS_CONSTANTS.rocketDamage).length).toBe(2);
  });

  it('cycles smoothly through strafe -> broadside -> overpass -> strafe tracking the Humvee', () => {
    const env = createBossMockCtx();
    const boss = new GunshipBoss(env.ctx, () => {});
    const hvPos = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway, HIGHWAY_ORIGIN[2]);
    boss.spawn(() => hvPos);

    expect(boss.phase).toBe('strafe');
    // Advance through strafe (6.5 s) -> broadside
    for (let i = 0; i < 66; i++) boss.update(0.1);
    expect(boss.phase).toBe('broadside');
    // Let it swoop down to broadside flanking position (x ≈ ±16, y ≈ +4)
    for (let i = 0; i < 20; i++) boss.update(0.1);
    expect(Math.abs(boss.position.x - hvPos.x)).toBeGreaterThan(8);
    expect(boss.position.y).toBeLessThan(hvPos.y + 8);

    // Finish broadside -> overpass
    for (let i = 0; i < 45; i++) boss.update(0.1);
    expect(boss.phase).toBe('overpass');
    // Advance so it overtakes Humvee ahead (z < hvPos.z)
    for (let i = 0; i < 25; i++) boss.update(0.1);
    expect(boss.position.z).toBeLessThan(hvPos.z);

    // Finish overpass -> cycles back to strafe
    for (let i = 0; i < 45; i++) boss.update(0.1);
    expect(boss.phase).toBe('strafe');
  });

  it('runs the 2.8 s death spiral on 0 HP, emits bk:boss_dying then bk:boss_dead, and cleans up cleanly', () => {
    const env = createBossMockCtx();
    const signals: string[] = [];
    const boss = new GunshipBoss(env.ctx, sig => signals.push(sig));
    const hvPos = new THREE.Vector3(HIGHWAY_ORIGIN[0], LV.highway, HIGHWAY_ORIGIN[2]);
    boss.spawn(() => hvPos);

    // Pour heavy hull shots until 0 HP
    const hit = shootPoint(boss, hvPos, boss.position, GUNSHIP_BOSS_CONSTANTS.maxHp + 100);
    expect(hit).not.toBeNull();
    expect(boss.hp).toBe(0);
    expect(boss.phase).toBe('dying');
    expect(signals).toContain('bk:boss_dying');
    expect(signals).not.toContain('bk:boss_dead');

    // Midway through the 2.8 s spiral, still dying and losing altitude
    const startY = boss.position.y;
    for (let i = 0; i < 14; i++) boss.update(0.1);
    expect(boss.phase).toBe('dying');
    expect(boss.position.y).toBeLessThan(startY);

    // Finish the 2.8 s death spiral -> massive gantry fireball & bk:boss_dead
    for (let i = 0; i < 16; i++) boss.update(0.1);
    expect(boss.phase).toBe('dead');
    expect(boss.active).toBe(false);
    expect(signals).toContain('bk:boss_dead');
    expect(env.explosions.some(e => e.radius >= 12)).toBe(true);
    expect(env.stoppedLoops).toContain('gunship_rotor_loop');

    // Clear / reset leaves zero active state
    boss.reset();
    expect(boss.phase).toBe('idle');
    expect(boss.rockets.length).toBe(0);

    // Verify every audio ID played resolves cleanly in the audio catalog
    const allIds = [...env.playedSounds, ...env.startedLoops];
    expect(allIds.length).toBeGreaterThan(0);
    for (const id of allIds) {
      expect(lookup(id), `Unknown audio id '${id}'`).toBeDefined();
    }
  });

  it('integrates seamlessly with HighwayChase.registerExtraShotHandler for .50 cal turret fire', () => {
    const env = createBossMockCtx();
    const signals: string[] = [];
    const chase = new HighwayChase(env.ctx, sig => signals.push(sig));
    const boss = new GunshipBoss(env.ctx, sig => signals.push(sig));

    chase.start(1);
    chase.enterBossPhase();
    boss.spawn(
      () => chase.humveePosition,
      (amt, from, src) => chase.damageHumvee(amt, from, src),
    );
    chase.registerExtraShotHandler((origin, dir, maxDist, dmg) => boss.hitRay(origin, dir, maxDist, dmg));

    const chinWorld = boss.getSubsystemWorldCenter('chin');
    const toChin = chinWorld.clone().sub(chase.turretMuzzle).normalize();
    const hit = chase.fireSingleShot(chase.turretMuzzle, toChin);
    expect(hit).toBe(true);
    expect(boss.subsystems.chin.hp).toBeLessThan(boss.subsystems.chin.maxHp);
    expect(boss.hp).toBeLessThan(boss.maxHp);

    boss.clear();
    chase.clear();
  });
});
