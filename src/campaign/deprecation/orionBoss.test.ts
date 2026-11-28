/**
 * Unit & behavioral tests for ORION-0 / AEGIS-0 Multi-Stage 12 m Mech Boss
 * (`src/campaign/deprecation/orionBoss.ts` & `src/campaign/deprecation/orionModel.ts`).
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx, DestructionManagerLike, RayHit } from '../../core/contracts';
import type { MissileTarget, ProjectileSpec } from '../../core/gameplay';
import { DEFAULT_ORION_ARENA, ORION_CONFIG, OrionBoss, type OrionBossCallbacks, type OrionStage } from './orionBoss';

interface BlastCall {
  center: THREE.Vector3;
  radius: number;
  amount: number;
  source: string;
}

interface RamCall {
  ramClass: string;
  speed: number;
  hitPoint: THREE.Vector3;
  forwardDir: THREE.Vector3;
}

function makeMockCtx() {
  let nextHandle = 1;
  const colliders = new Map<number, { handle: number; pos: THREE.Vector3; rot: THREE.Quaternion; removed: boolean }>();
  const signals: string[] = [];
  const feeds: string[] = [];
  const floatTexts: string[] = [];
  const projectiles: ProjectileSpec[] = [];
  const sounds: string[] = [];
  const playerDamage: { amount: number; source: string; type: string }[] = [];
  const blasts: BlastCall[] = [];
  const rams: RamCall[] = [];
  const damagedColliders: { amount: number; source: string }[] = [];
  const aliveClusters = new Set<string>(['skybridge', 'intersection_nw', 'intersection_ne', 'intersection_sw', 'intersection_se']);
  const scene = new THREE.Scene();

  let raycastStub: ((origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: RayHit) => boolean) | null = null;

  const destruction: DestructionManagerLike = {
    addCluster: vi.fn() as unknown as DestructionManagerLike['addCluster'],
    isClusterAlive: (tag: string) => aliveClusters.has(tag),
    getCluster: (tag: string) =>
      aliveClusters.has(tag)
        ? ({
            id: tag,
            tag,
            kind: 'building',
            label: tag,
            value: 1000,
            center: new THREE.Vector3(),
            radius: 4,
            collapsed: false,
            intactCount: 4,
            destroyedFraction: 0,
          })
        : undefined,
    aliveClusters: () => [],
    nukeSweep: vi.fn(),
    blast: (center: THREE.Vector3, radius: number, amount: number, source: string) => {
      blasts.push({ center: center.clone(), radius, amount, source });
    },
    damageCollider: (_col, amount: number, source: string) => {
      damagedColliders.push({ amount, source });
      return true;
    },
    tryVehicleRam: (_col, ramClass, speed, hitPoint, forwardDir) => {
      rams.push({ ramClass, speed, hitPoint: hitPoint.clone(), forwardDir: forwardDir.clone() });
      return { hit: true, breached: true, speedRetain: 0.9 };
    },
    clear: vi.fn(),
    reset: vi.fn(),
  };

  const ctx = {
    time: { elapsed: 0, dt: 0.016 },
    render: {
      scene,
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
    },
    physics: {
      addStaticBox: (pos: THREE.Vector3) => {
        const handle = nextHandle++;
        const rec = { handle, pos: pos.clone(), rot: new THREE.Quaternion(), removed: false };
        colliders.set(handle, rec);
        return {
          handle,
          setTranslation: (v: THREE.Vector3) => rec.pos.copy(v),
          setRotation: (q: THREE.Quaternion) => rec.rot.copy(q),
        };
      },
      raycastInto: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, _mask: number, out: RayHit) => {
        if (raycastStub) return raycastStub(origin, dir, maxDist, out);
        return false;
      },
      world: {
        removeCollider: (c: { handle: number }) => {
          const rec = colliders.get(c.handle);
          if (rec) rec.removed = true;
        },
      },
    },
    world: {
      objects: {
        destruction,
      },
    },
    player: {
      position: new THREE.Vector3(0, 0, 28),
      eye: new THREE.Vector3(0, 4.2, 28),
      velocity: new THREE.Vector3(0, 0, 0),
      alive: true,
      takeDamage: (d: { amount: number; source: string; type: string }) => playerDamage.push(d),
      push: vi.fn(),
    },
    audio: {
      play: (id: string) => sounds.push(id),
      startLoop: vi.fn(() => ({ alive: true, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn(), stop: vi.fn() })),
    },
    fx: {
      explosion: vi.fn(),
      chips: vi.fn(),
      embers: vi.fn(),
      smoke: vi.fn(),
      dust: vi.fn(),
      slam: vi.fn(),
      ring: vi.fn(),
      sparks: vi.fn(),
      beam: vi.fn(),
      muzzleFlash: vi.fn(),
      tracer: vi.fn(),
    },
    hud: {
      hitMarker: vi.fn(),
      feed: (text: string) => feeds.push(text),
      floatText: (_at: THREE.Vector3, text: string) => floatTexts.push(text),
      follow: () => () => {},
    },
    camera: { addTrauma: vi.fn() },
    campaign: { signal: (s: string) => signals.push(s) },
    progression: { award: vi.fn() },
    combat: {
      spawnProjectile: (spec: ProjectileSpec) =>
        projectiles.push({ ...spec, origin: spec.origin.clone(), velocity: spec.velocity.clone() }),
    },
  } as unknown as Ctx;

  return {
    ctx,
    colliders,
    signals,
    feeds,
    floatTexts,
    projectiles,
    sounds,
    playerDamage,
    blasts,
    rams,
    damagedColliders,
    aliveClusters,
    scene,
    setRaycastStub: (fn: typeof raycastStub) => {
      raycastStub = fn;
    },
  };
}

function stepBoss(boss: OrionBoss, ctx: Ctx, seconds: number, step = 0.05): void {
  const n = Math.ceil(seconds / step);
  for (let i = 0; i < n; i++) {
    ctx.time.elapsed += step;
    boss.update(step);
  }
}

describe('OrionBoss (ORION-0 / AEGIS-0 Multi-Stage 12 m Mech Boss)', () => {
  it('applies 70% frontal Hard-Light Shield DR while relays live and drops DR to 0% once both 900 HP relays shatter', () => {
    const m = makeMockCtx();
    const brokenSides: string[] = [];
    let shieldBrokenCount = 0;
    const boss = new OrionBoss(m.ctx, null, {}, {
      onRelayDestroyed: side => brokenSides.push(side),
      onShieldBroken: () => shieldBrokenCount++,
    });

    boss.startStage('stage1_alignment');
    expect(boss.stage).toBe('stage1_alignment');
    expect(boss.shieldActive).toBe(true);
    expect(boss.getHudState().shieldDR).toBeCloseTo(0.7);

    // Paintable targets include both Shoulder Relay Fins + Hull
    const paintables: MissileTarget[] = [];
    boss.paintable(paintables);
    expect(paintables.length).toBe(3);

    const hullCol = boss.colliderFor('hull')!;
    const relayLCol = boss.colliderFor('relayL')!;
    const relayRCol = boss.colliderFor('relayR')!;
    expect(hullCol).not.toBeNull();
    expect(relayLCol).not.toBeNull();
    expect(relayRCol).not.toBeNull();

    // Frontal hit while shielded takes 30% damage (70% DR)
    const frontPoint = boss.position.clone().add(new THREE.Vector3(Math.sin(boss.torsoYaw) * 3, 6, Math.cos(boss.torsoYaw) * 3));
    const hp0 = boss.health;
    expect(boss.shot(hullCol, frontPoint, 1000, 'frame_40mm')).toBe(true);
    expect(boss.health).toBeCloseTo(hp0 - 300, 4);

    // Destroy Left Relay Fin (900 HP): shield stays active while Right Relay still stands!
    expect(boss.shot(relayLCol, boss.position, 500, 'frame_40mm')).toBe(true);
    expect(boss.relayHealth[0]).toBe(400);
    expect(boss.shieldActive).toBe(true);
    expect(boss.shot(relayLCol, boss.position, 400, 'frame_40mm')).toBe(true);
    expect(boss.relayHealth[0]).toBe(0);
    expect(brokenSides).toEqual(['left']);
    expect(boss.shieldActive).toBe(true);
    expect(shieldBrokenCount).toBe(0);

    // Still 70% frontal DR with 1 relay standing
    const hp1 = boss.health;
    boss.shot(hullCol, frontPoint, 1000, 'frame_40mm');
    expect(boss.health).toBeCloseTo(hp1 - 300, 4);

    // Destroy Right Relay Fin (900 HP): shield breaks -> 0% DR!
    boss.shot(relayRCol, boss.position, 900, 'frame_40mm');
    expect(boss.relayHealth[1]).toBe(0);
    expect(brokenSides).toEqual(['left', 'right']);
    expect(shieldBrokenCount).toBe(1);
    expect(boss.shieldActive).toBe(false);
    expect(boss.getHudState().shieldActive).toBe(false);
    expect(boss.getHudState().shieldDR).toBe(0);

    // Full 100% damage passes through front hull now!
    const hp2 = boss.health;
    boss.shot(hullCol, frontPoint, 1000, 'frame_40mm');
    expect(boss.health).toBeCloseTo(hp2 - 1000, 4);

    boss.dispose();
  });

  it('executes Stage 1 thermal beam (damaging buildings via destruction) and 6-missile painted salvo, then transitions via bridge_smash into Stage 2 at 66% HP', () => {
    const m = makeMockCtx();
    const stages: OrionStage[] = [];
    let skybridgeSmashed = false;
    const boss = new OrionBoss(m.ctx, null, {}, {
      onStageChange: s => stages.push(s),
      onSkybridgeSmash: () => {
        skybridgeSmashed = true;
      },
    });

    boss.startStage('stage1_alignment');
    // Simulate 14 s of Stage 1 combat -> thermal beam + building destruction + 6-missile salvo
    stepBoss(boss, m.ctx, 14.0);
    expect(m.blasts.some(b => b.source === 'aegis_cannon')).toBe(true);
    const missiles = m.projectiles.filter(p => p.source === 'orion_missile');
    expect(missiles.length).toBeGreaterThanOrEqual(ORION_CONFIG.missileCount);

    // Break relays and drive hull down to 66% HP -> triggers bridge_smash!
    const relayLCol = boss.colliderFor('relayL')!;
    const relayRCol = boss.colliderFor('relayR')!;
    const hullCol = boss.colliderFor('hull')!;
    boss.shot(relayLCol, boss.position, 900, 'frame_40mm');
    boss.shot(relayRCol, boss.position, 900, 'frame_40mm');

    const s1Gate = ORION_CONFIG.maxHealth * ORION_CONFIG.stage1To2HpFrac;
    const needed = boss.health - s1Gate + 100;
    boss.shot(hullCol, boss.position, needed, 'frame_40mm');

    expect(boss.stage).toBe('bridge_smash');
    expect(boss.health).toBeCloseTo(s1Gate, 4);
    expect(boss.invulnerable).toBe(true);

    // Step through bridge_smash transition -> skybridge blast + Stage 2 entry!
    stepBoss(boss, m.ctx, ORION_CONFIG.bridgeSmashDuration + 0.2);
    expect(skybridgeSmashed).toBe(true);
    expect(m.signals).toContain('orion:skybridge_smashed');
    expect(
      m.blasts.some(
        b => b.source === 'frame_charge' && b.center.distanceTo(new THREE.Vector3(...DEFAULT_ORION_ARENA.skybridgePos)) < 1,
      ),
    ).toBe(true);
    expect(boss.stage).toBe('stage2_unrestricted');
    expect(stages).toContain('bridge_smash');
    expect(stages).toContain('stage2_unrestricted');
    expect(boss.position.z).toBeGreaterThanOrEqual(DEFAULT_ORION_ARENA.intersectionBounds.minZ);
    expect(boss.position.z).toBeLessThanOrEqual(DEFAULT_ORION_ARENA.intersectionBounds.maxZ);

    boss.dispose();
  });

  it('staggers for 5.0 s when Stage 2 Jet-Charge rams a standing corner column or takes counter-melee, exposing Rear Reactor Core for 2.5x crit damage', () => {
    const m = makeMockCtx();
    const staggerEvents: { reason: string; duration: number }[] = [];
    const droneBursts: number[] = [];
    const boss = new OrionBoss(m.ctx, null, {}, {
      onStaggered: (reason, duration) => staggerEvents.push({ reason, duration }),
      onSpawnDrones: (_at, count) => droneBursts.push(count),
    });

    boss.startStage('stage2_unrestricted');
    const reactorCol = boss.colliderFor('reactor')!;
    expect(reactorCol).not.toBeNull();

    // Outside stagger, reactor is shuttered (1.0x standard damage)
    expect(boss.reactorExposed).toBe(false);
    const hpPre = boss.health;
    boss.shot(reactorCol, boss.position, 200, 'frame_40mm');
    expect(boss.health).toBeCloseTo(hpPre - 200, 4);

    // Aim Jet-Charge straight into NW corner column -> collapses column & triggers 5.0 s stagger!
    const colNW = DEFAULT_ORION_ARENA.cornerColumns[0]!;
    boss.position.set(colNW.pos[0] + 10, 0, colNW.pos[2]);
    boss.triggerJetCharge(new THREE.Vector3(...colNW.pos));
    expect(boss.attack).toBe('jet_charge');

    stepBoss(boss, m.ctx, ORION_CONFIG.chargeWindup + 0.5);

    expect(staggerEvents.length).toBe(1);
    expect(staggerEvents[0]).toEqual({ reason: 'column_collapse', duration: 5.0 });
    expect(boss.staggerLeft).toBeGreaterThan(4.0);
    expect(boss.reactorExposed).toBe(true);
    expect(boss.getHudState().staggered).toBe(true);
    expect(boss.getHudState().reactorExposed).toBe(true);
    expect(
      m.blasts.some(
        b => b.source === 'frame_charge' && Math.hypot(b.center.x - colNW.pos[0], b.center.z - colNW.pos[2]) < 1,
      ),
    ).toBe(true);

    // Rear Reactor Core takes 2.5x crit damage while staggered!
    const hpStag = boss.health;
    boss.shot(reactorCol, boss.position, 400, 'frame_40mm');
    expect(boss.health).toBeCloseTo(hpStag - 1000, 4); // 400 * 2.5 = 1000

    // Let stagger finish -> reactor closes
    stepBoss(boss, m.ctx, 5.2);
    expect(boss.staggerLeft).toBe(0);
    expect(boss.reactorExposed).toBe(false);

    // Counter-melee (`frameBlow`) mid-charge ALSO triggers 5.0 s stagger!
    boss.position.set(0, 0, 108);
    boss.triggerJetCharge(new THREE.Vector3(0, 0, 124));
    expect(boss.attack).toBe('jet_charge');
    expect(boss.frameBlow(boss.position.clone().setY(6.0), 6.0, 200, null, 'frame_melee')).toBe(1);
    expect(staggerEvents.length).toBe(2);
    expect(staggerEvents[1]!.reason).toBe('counter');
    expect(boss.staggerLeft).toBeCloseTo(5.0, 2);

    // Let stagger expire and verify Hunter-Killer Drone burst callback fires during extended Stage 2 combat
    stepBoss(boss, m.ctx, 5.1);
    m.ctx.player.position.set(0, 0, 120);
    stepBoss(boss, m.ctx, 18.0);
    expect(droneBursts.some(c => c === ORION_CONFIG.droneBurstCount)).toBe(true);

    boss.dispose();
  });

  it('transitions Stage 2 -> spire_leap -> Stage 3 at 33% HP, shearing left arm off and deploying 3 Grid Conduits', () => {
    const m = makeMockCtx();
    const stages: OrionStage[] = [];
    const boss = new OrionBoss(m.ctx, null, {}, { onStageChange: s => stages.push(s) });

    boss.startStage('stage2_unrestricted');
    expect(boss.leftArmSheared).toBe(false);

    const hullCol = boss.colliderFor('hull')!;
    const s2Gate = ORION_CONFIG.maxHealth * ORION_CONFIG.stage2To3HpFrac;
    boss.shot(hullCol, boss.position, boss.health - s2Gate + 50, 'frame_40mm');

    expect(boss.stage).toBe('spire_leap');
    expect(boss.health).toBeCloseTo(s2Gate, 4);
    expect(boss.leftArmSheared).toBe(true);
    expect(boss.getHudState().leftArmSheared).toBe(true);

    // Step through parabolic leap to Civic Spire Plaza
    let sawAirborne = false;
    for (let i = 0; i < 45; i++) {
      m.ctx.time.elapsed += 0.05;
      boss.update(0.05);
      if (boss.position.y > 10) sawAirborne = true;
    }
    expect(sawAirborne).toBe(true);
    expect(boss.stage).toBe('stage3_meltdown');
    expect(stages).toEqual(['stage2_unrestricted', 'spire_leap', 'stage3_meltdown']);
    expect(boss.aliveConduitsCount()).toBe(3);
    expect(boss.invulnerable).toBe(true);
    expect(boss.position.z).toBeGreaterThanOrEqual(DEFAULT_ORION_ARENA.spireBounds.minZ);
    expect(boss.position.z).toBeLessThanOrEqual(DEFAULT_ORION_ARENA.spireBounds.maxZ);

    boss.dispose();
  });

  it('enforces Stage 3 Conduit invulnerability, Upload % climb + 10 s pause per shattered conduit, and unlocks hull damage once all 3 shatter', () => {
    const m = makeMockCtx();
    const destroyedConduits: { index: number; remaining: number }[] = [];
    const boss = new OrionBoss(m.ctx, null, {}, {
      onConduitDestroyed: (index, remaining) => destroyedConduits.push({ index, remaining }),
    });

    boss.startStage('stage3_meltdown');
    const hullCol = boss.colliderFor('hull')!;
    const c0 = boss.colliderFor('conduit0')!;
    const c1 = boss.colliderFor('conduit1')!;
    const c2 = boss.colliderFor('conduit2')!;

    // While conduits live, ORION's hull is completely invulnerable
    const hp0 = boss.health;
    boss.shot(hullCol, boss.position, 2000, 'frame_40mm');
    boss.direct(hullCol, boss.position, 2000, 'shell', 'frame_howitzer');
    expect(boss.health).toBe(hp0);
    expect(boss.invulnerable).toBe(true);

    // Upload climbs 0% -> 100% over 90 s: after 9.0 s should be ~10.0%
    stepBoss(boss, m.ctx, 9.0);
    expect(boss.uploadProgress).toBeCloseTo(10.0, 1);

    // Shatter Conduit 0 (750 HP) -> pauses upload for 10.0 s!
    boss.shot(c0, new THREE.Vector3(...DEFAULT_ORION_ARENA.conduitPositions[0]), 750, 'frame_40mm');
    expect(boss.conduitHealth[0]).toBe(0);
    expect(boss.aliveConduitsCount()).toBe(2);
    expect(destroyedConduits).toEqual([{ index: 0, remaining: 2 }]);
    expect(boss.uploadPauseLeft).toBeCloseTo(10.0, 2);
    expect(boss.getHudState().uploadPaused).toBe(true);

    // Advance 6.0 s during pause: upload must NOT climb!
    const uploadAtBreak = boss.uploadProgress;
    stepBoss(boss, m.ctx, 6.0);
    expect(boss.uploadProgress).toBeCloseTo(uploadAtBreak, 4);
    expect(boss.uploadPauseLeft).toBeCloseTo(4.0, 1);

    // Advance 4.0 s (pause ends) + 4.5 s (resumes climbing +5%)
    stepBoss(boss, m.ctx, 8.5);
    expect(boss.uploadProgress).toBeCloseTo(uploadAtBreak + 5.0, 1);

    // Hull is STILL invulnerable with 2 conduits standing
    boss.shot(hullCol, boss.position, 1000, 'frame_40mm');
    expect(boss.health).toBe(hp0);

    // Shatter Conduits 1 & 2 -> all 3 broken -> invulnerability drops & upload halts permanently!
    boss.shot(c1, new THREE.Vector3(...DEFAULT_ORION_ARENA.conduitPositions[1]), 750, 'frame_40mm');
    boss.shot(c2, new THREE.Vector3(...DEFAULT_ORION_ARENA.conduitPositions[2]), 750, 'frame_40mm');
    expect(boss.aliveConduitsCount()).toBe(0);
    expect(boss.invulnerable).toBe(false);
    expect(destroyedConduits.length).toBe(3);

    const uploadFrozen = boss.uploadProgress;
    stepBoss(boss, m.ctx, 35.0);
    expect(boss.uploadProgress).toBeCloseTo(uploadFrozen, 4);

    // Hull now takes full 1.0x damage!
    boss.shot(hullCol, boss.position, 500, 'frame_40mm');
    expect(boss.health).toBeCloseTo(hp0 - 500, 4);

    boss.dispose();
  });

  it('triggers onUploadComplete if Stage 3A Grid Upload reaches 100% before conduits are broken', () => {
    const m = makeMockCtx();
    let uploadDone = 0;
    const boss = new OrionBoss(m.ctx, null, {}, { onUploadComplete: () => uploadDone++ });

    boss.startStage('stage3_meltdown');
    stepBoss(boss, m.ctx, ORION_CONFIG.uploadDurationSeconds + 1.0, 0.25);
    expect(boss.uploadProgress).toBe(100);
    expect(uploadDone).toBe(1);
    expect(m.signals).toContain('orion:upload_complete');

    boss.dispose();
  });

  it('fires 10% HP EMP Nova (onEmpEject), clamps instakills via bossHit (9999 -> 900), and kills ORION via crippled_core Neural Core', () => {
    const m = makeMockCtx();
    let empEjectCount = 0;
    let defeatedCount = 0;
    const boss = new OrionBoss(m.ctx, null, {}, {
      onEmpEject: () => empEjectCount++,
      onDefeated: () => defeatedCount++,
    });

    boss.startStage('stage3_meltdown');
    // Break all 3 conduits first
    for (let i = 0; i < 3; i++) {
      const c = boss.colliderFor(`conduit${i}` as 'conduit0' | 'conduit1' | 'conduit2')!;
      boss.shot(c, new THREE.Vector3(...DEFAULT_ORION_ARENA.conduitPositions[i]!), 750, 'frame_40mm');
    }

    const hullCol = boss.colliderFor('hull')!;

    // Verify bossHit() instakill clamping on shot/direct/blast (>= 9999 -> 900)!
    const hpStart = boss.health; // 3960
    boss.shot(hullCol, boss.position, 99999, 'rail_instakill');
    expect(boss.health).toBeCloseTo(hpStart - 900, 4); // clamped to 900, NOT instakilled!

    const hpAfterShot = boss.health; // 3060
    boss.blast(boss.position.clone().setY(6.2), {
      radius: 12,
      damage: 50000,
      kind: 'shell',
      source: 'nuke',
      team: 'player',
      instakill: true,
    });
    expect(boss.health).toBeCloseTo(hpAfterShot - 900, 4); // clamped to 900!

    // Drive hull to <= 10% HP (1200 HP) -> EMP Nova + crippled_core + onEmpEject!
    boss.shot(hullCol, boss.position, 1500, 'frame_40mm');
    expect(boss.stage).toBe('crippled_core');
    expect(empEjectCount).toBe(1);
    expect(m.signals).toContain('orion:emp_eject');
    expect(boss.coreExposed).toBe(true);
    expect(boss.neuralCoreHealth).toBe(ORION_CONFIG.neuralCoreHealth);
    expect(boss.getHudState().coreExposed).toBe(true);

    // Shoulder grapple anchor is exposed above the kneeling mech
    const anchor = boss.getGrappleAnchorWorld(new THREE.Vector3());
    expect(anchor.y).toBeGreaterThan(5.0);

    // Instakill clamp also holds on Neural Core (9999 -> 900 out of 1200 HP -> survives with 300 HP!)
    const coreCol = boss.colliderFor('neuralCore')!;
    expect(coreCol).not.toBeNull();
    boss.shot(coreCol, boss.position, 9999, 'rail_instakill');
    expect(boss.neuralCoreHealth).toBeCloseTo(300, 4);
    expect(boss.stage).toBe('crippled_core');
    expect(defeatedCount).toBe(0);

    // Finish exposed Neural Core with on-foot air-slam (1.35x bonus: 250 * 1.35 = 337.5 >= 300) -> DEAD!
    boss.shot(coreCol, boss.position, 250, 'air_slam');
    expect(boss.stage).toBe('dead');
    expect(boss.health).toBe(0);
    expect(boss.neuralCoreHealth).toBe(0);
    expect(boss.alive).toBe(false);
    expect(defeatedCount).toBe(1);
    expect(m.signals).toContain('orion:defeated');
    expect(boss.barFraction()).toBe(0);

    boss.dispose();
  });

  it('supports dormant parking, breakout vault breach onto Grand Boulevard, small-arms shield immunity, radarTargets, and highlightMeshes', () => {
    const m = makeMockCtx();
    let breakoutDone = 0;
    const boss = new OrionBoss(m.ctx, null, {}, {
      onBreakoutComplete: () => breakoutDone++,
    });

    boss.parkDormant();
    expect(boss.stage).toBe('dormant');
    expect(boss.alive).toBe(false);
    expect(boss.active).toBe(true);
    expect(boss.barFraction()).toBe(0);

    boss.startBreakout();
    expect(boss.stage).toBe('breakout');
    expect(boss.alive).toBe(true);
    expect(boss.shieldActive).toBe(true);

    // Small arms blocked while shielded during breakout escape
    const hullCol = boss.colliderFor('hull')!;
    const hp0 = boss.health;
    boss.shot(hullCol, boss.position, 40, 'smg');
    expect(boss.health).toBe(hp0);

    // Step through breakout -> vault concrete blast + arrival on Grand Boulevard
    stepBoss(boss, m.ctx, ORION_CONFIG.breakoutDuration + 0.1);
    expect(breakoutDone).toBe(1);
    expect(m.signals).toContain('orion:breakout');
    expect(m.blasts.some(b => b.source === 'frame_charge')).toBe(true);
    expect(boss.position.z).toBeCloseTo(DEFAULT_ORION_ARENA.boulevardStart[2], 1);

    // Radar and highlight meshes populated while active
    const radar: import('../../core/gameplay').VehicleRadarTarget[] = [];
    boss.radarTargets(radar);
    expect(radar.length).toBe(1);
    expect(radar[0]!.label).toBe('ORION-0');

    const meshes: THREE.Object3D[] = [];
    boss.highlightMeshes(meshes);
    expect(meshes.length).toBeGreaterThan(0);

    boss.hide();
    expect(boss.stage).toBe('dormant');
    expect(boss.active).toBe(false);

    boss.dispose();
  });
});
