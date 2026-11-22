/**
 * Unit tests for Mission 3 ("Quiet Title") security, stealth takedown, and bunker breach systems:
 * - CameraSystem (src/world/cameras.ts)
 * - AlarmSystem (src/world/alarms.ts)
 * - StealthTakedown (src/world/stealthTakedown.ts)
 * - Tier-3 bunker blast door breach & player credit rules (destruction.ts, structures.ts, credit.ts)
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx, DamageInfo, GameEvents } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { EventBus } from '../core/events';
import { creditRule } from '../net/world/credit';
import { Physics } from '../physics/Physics';
import {
  ALARM_DESTROY_SOUND_RADIUS,
  AlarmSystem,
} from './alarms';
import {
  CAMERA_DESTROY_SOUND_RADIUS,
  CameraSystem,
  LOCK_DECAY,
  LOCK_SECONDS,
} from './cameras';
import {
  canDamageTier,
  damageMultiplierFor,
  DestructionManager,
} from './destruction';
import {
  StealthTakedown,
  TAKEDOWN_DAMAGE,
  TAKEDOWN_FORCE,
  TAKEDOWN_NOISE_RADIUS,
} from './stealthTakedown';
import { SOURCE_MULT, Structures } from './structures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let physics: Physics;

beforeAll(async () => {
  physics = await Physics.create();
  physics.addStaticBox(V(0, -0.5, 0), V(200, 0.5, 200), null, 'concrete');
  physics.flushQueries();
}, 60000);

function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  const audioPlay = vi.fn();
  const sparks = vi.fn();
  const smoke = vi.fn();
  const bloodHit = vi.fn();
  const kick = vi.fn();
  const fovPunch = vi.fn();
  const addTrauma = vi.fn();
  const applyDamage = vi.fn(() => ({
    dealt: TAKEDOWN_DAMAGE,
    killed: true,
    headshot: false,
    severed: [],
    blocked: false,
  }));

  const ctx = {
    physics,
    events: new EventBus<GameEvents>(),
    fx: { sparks, smoke, bloodHit, dust: vi.fn(), chips: vi.fn() },
    audio: { play: audioPlay, playOneOf: vi.fn(), startLoop: vi.fn(), has: (id: string) => id === 'knife_flesh' || id === 'sword_hit' },
    render: { lights: { flash: vi.fn() }, sweep: vi.fn() },
    hud: { feed: vi.fn(), hitMarker: vi.fn() },
    camera: { kick, fovPunch, addTrauma },
    player: { position: V(0, 0, 0), eye: V(0, 1.6, 0), forward: V(0, 0, -1), alive: true },
    enemies: { applyDamage, query: () => 0 },
    ...overrides,
  } as unknown as Ctx;

  return { ctx, audioPlay, sparks, smoke, bloodHit, kick, fovPunch, addTrauma, applyDamage };
}

function makeGuard(overrides: Partial<EnemyInstance> = {}): EnemyInstance {
  const pos = overrides.position ?? V(0, 0, 0);
  return {
    uid: 101,
    id: 'trooper',
    char: {} as EnemyInstance['char'],
    position: pos,
    velocity: V(0, 0, 0),
    yaw: 0, // Faces +Z in EnemyManager convention
    health: 100,
    maxHealth: 100,
    armor: 80,
    alive: true,
    score: 100,
    center: pos.clone().add(V(0, 1.1, 0)),
    isBoss: false,
    frozen: 0,
    burning: 0,
    machine: false,
    ...overrides,
  };
}

describe('CameraSystem', () => {
  it('sweeps smoothly back and forth over time with pauses at arc ends', () => {
    const { ctx } = makeCtx();
    const cams = new CameraSystem(ctx, [
      { id: 'cam_sweep', position: [0, 4, 0], yaw: 0, pitch: 0.35, sweepAngle: 0.5, sweepSpeed: 0.5, range: 20 },
    ]);

    const farPlayer = V(0, 1.6, 100);
    const startYaw = cams.getCamera('cam_sweep')!.currentYaw;
    expect(startYaw).toBeCloseTo(0);

    // Step 0.5 s -> should advance by +0.25 rad
    cams.update(0.5, farPlayer, 1);
    expect(cams.getCamera('cam_sweep')!.currentYaw).toBeCloseTo(0.25, 3);

    // Reach +0.5 rad end of arc
    cams.update(0.5, farPlayer, 1);
    expect(cams.getCamera('cam_sweep')!.currentYaw).toBeCloseTo(0.5, 3);

    // Pause briefly at arc end (0.8 s pause)
    cams.update(0.4, farPlayer, 1);
    expect(cams.getCamera('cam_sweep')!.currentYaw).toBeCloseTo(0.5, 3);

    // After pause expires, sweeps back toward -0.5 rad
    cams.update(0.45, farPlayer, 1);
    cams.update(0.5, farPlayer, 1);
    expect(cams.getCamera('cam_sweep')!.currentYaw).toBeLessThan(0.5);

    cams.dispose();
  });

  it('locks onto player in cone over 2.0 s and fires onAlert, then decays when out of cone or occluded', () => {
    const { ctx } = makeCtx();
    const onAlert = vi.fn();
    // Camera at (50, 4, 0) facing -Z with downward pitch 0.35 rad
    const cams = new CameraSystem(
      ctx,
      [{ id: 'cam_gate', position: [50, 4, 0], yaw: 0, pitch: 0.35, sweepAngle: 0.65, sweepSpeed: 0.45, range: 22 }],
      { onAlert },
    );

    // Player standing directly in front along -Z at distance ~8 m, eye y=1.6
    // Delta from head (50, 3.86, 0) to (50, 1.6, -7) is (0, -2.26, -7) -> pitch ~0.31 rad (right inside cone!)
    const visiblePlayer = V(50, 1.6, -7);

    // After 1.0 s -> 50% lock, no alert yet
    for (let i = 0; i < 10; i++) cams.update(0.1, visiblePlayer, 1);
    expect(cams.maxLock()).toBeCloseTo(1.0 / LOCK_SECONDS, 2);
    expect(onAlert).not.toHaveBeenCalled();

    // Another 1.05 s -> reaches 1.0 and fires onAlert once
    for (let i = 0; i < 11; i++) cams.update(0.1, visiblePlayer, 1);
    expect(cams.maxLock()).toBe(1);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledWith('cam_gate', expect.any(THREE.Vector3));

    // Place a solid concrete wall directly between camera and player -> occluded, lock decays at 0.6 / s
    const wall = physics.addStaticBox(V(50, 2.5, -3.5), V(3, 3, 0.4), null, 'concrete');
    physics.flushQueries();

    cams.update(0.5, visiblePlayer, 1);
    expect(cams.maxLock()).toBeCloseTo(1 - 0.5 * LOCK_DECAY, 2);

    // Remove temporary wall so other tests stay clean
    physics.world.removeCollider(wall, false);
    physics.flushQueries();

    // Also test out-of-cone decay (player behind camera)
    const lockBefore = cams.maxLock();
    cams.update(0.5, V(50, 1.6, 10), 1);
    expect(cams.maxLock()).toBeCloseTo(Math.max(0, lockBefore - 0.5 * LOCK_DECAY), 2);

    cams.dispose();
  });

  it('scales detection range gently with lightLevel (min 60% in pitch dark)', () => {
    const { ctx } = makeCtx();
    const cams = new CameraSystem(ctx, [
      { id: 'cam_dark', position: [-60, 4, 0], yaw: 0, pitch: 0.15, sweepAngle: 0, range: 20 },
    ]);

    // 15 m away: within 20 m bright range, but beyond 12 m (60% of 20 m) pitch-dark range
    const midPlayer = V(-60, 1.6, -15);
    cams.update(0.5, midPlayer, 0);
    expect(cams.maxLock()).toBe(0);

    // Same position in full light -> detected
    cams.update(0.5, midPlayer, 1);
    expect(cams.maxLock()).toBeGreaterThan(0);

    // 10 m away in pitch dark (within 12 m 60% floor) -> detected
    cams.reset();
    cams.update(0.5, V(-60, 2.4, -10), 0);
    expect(cams.maxLock()).toBeGreaterThan(0);

    cams.dispose();
  });

  it('1 shot destroys a camera with sparks and 10 m sound, and breaker power disables/restores it', () => {
    const { ctx, sparks } = makeCtx();
    const onDestroyed = vi.fn();
    const onAlert = vi.fn();
    const cams = new CameraSystem(
      ctx,
      [
        { id: 'cam_a', position: [20, 4, 20], yaw: 0, pitch: 0.35, group: 'north_wing' },
        { id: 'cam_b', position: [30, 4, 20], yaw: 0, pitch: 0.35, group: 'north_wing' },
      ],
      { onAlert, onDestroyed },
    );

    expect(cams.thermalMeshes().length).toBe(2);

    // Cut breaker power to north_wing -> disables both cameras, hides from thermal
    cams.setGroupPower('north_wing', false);
    expect(cams.getCamera('cam_a')!.powered).toBe(false);
    expect(cams.thermalMeshes().length).toBe(0);
    cams.update(3.0, V(20, 1.6, 13), 1);
    expect(cams.maxLock()).toBe(0);
    expect(onAlert).not.toHaveBeenCalled();

    // Restore breaker power -> active again
    cams.setGroupPower('north_wing', true);
    expect(cams.thermalMeshes().length).toBe(2);

    // 1 shot to cam_a's collider destroys it
    const collider = cams.getCamera('cam_a')!.collider;
    expect(collider).not.toBeNull();
    expect(cams.isCollider(collider)).toBe(true);

    expect(cams.damageCollider(collider, 1)).toBe(true);
    expect(cams.getCamera('cam_a')!.destroyed).toBe(true);
    expect(cams.getCamera('cam_a')!.collider).toBeNull();
    expect(cams.thermalMeshes().length).toBe(1);
    expect(sparks).toHaveBeenCalled();
    expect(onDestroyed).toHaveBeenCalledWith(expect.any(THREE.Vector3), 'cam_a', CAMERA_DESTROY_SOUND_RADIUS);

    // Second shot returns false
    expect(cams.damageCollider(collider, 1)).toBe(false);

    // Reset brings both back online
    cams.reset();
    expect(cams.getCamera('cam_a')!.destroyed).toBe(false);
    expect(cams.thermalMeshes().length).toBe(2);

    cams.dispose();
  });
});

describe('AlarmSystem', () => {
  it('lists active wall panels, supports silent [E] disable, gunfire destruction, breaker power, and Security Hub override', () => {
    const { ctx, sparks } = makeCtx();
    const onHubOverride = vi.fn();
    const onPanelDestroyed = vi.fn();
    const onPanelDisabled = vi.fn();

    const alarms = new AlarmSystem(
      ctx,
      [
        { id: 'panel_west', position: [0, 1.4, -10], yaw: 0, group: 'west_wing' },
        { id: 'panel_east', position: [12, 1.4, -10], yaw: 0, group: 'east_wing' },
        { id: 'security_hub', position: [6, 0, -20], yaw: Math.PI, isHub: true },
      ],
      { onHubOverride, onPanelDestroyed, onPanelDisabled },
    );

    // Only wall panels appear in activePanelPositions (not the Hub console)
    expect(alarms.activePanelPositions().length).toBe(2);
    expect(alarms.thermalMeshes().length).toBe(3);

    // Nearest interactable near panel_west
    const nearWest = alarms.nearestInteractable(V(0, 1.4, -8.8), 2.5);
    expect(nearWest).not.toBeNull();
    expect(nearWest!.id).toBe('panel_west');
    expect(nearWest!.isHub).toBe(false);

    // Silent [E] disable removes from activePanelPositions without gunfire destruction event
    expect(alarms.interact('panel_west')).toBe(true);
    expect(alarms.activePanelPositions().length).toBe(1);
    expect(onPanelDisabled).toHaveBeenCalledTimes(1);
    expect(onPanelDestroyed).not.toHaveBeenCalled();
    expect(alarms.nearestInteractable(V(0, 1.4, -8.8), 2.5)).toBeNull();
    expect(alarms.interact('panel_west')).toBe(false);

    // Breaker power cuts panel_east offline, restoring brings it back
    alarms.setGroupPower('east_wing', false);
    expect(alarms.activePanelPositions().length).toBe(0);
    alarms.setGroupPower('east_wing', true);
    expect(alarms.activePanelPositions().length).toBe(1);

    // Shooting panel_east destroys it with sparks and 10 m sound
    const eastCol = alarms.getPanel('panel_east')!.collider;
    expect(eastCol).not.toBeNull();
    expect(alarms.damageCollider(eastCol, 25)).toBe(true);
    expect(alarms.activePanelPositions().length).toBe(0);
    expect(sparks).toHaveBeenCalled();
    expect(onPanelDestroyed).toHaveBeenCalledWith(expect.any(THREE.Vector3), 'panel_east', ALARM_DESTROY_SOUND_RADIUS);

    // Shooting the Security Hub sparks harmlessly without disabling [E] override
    const hubCol = alarms.getPanel('security_hub')!.collider;
    expect(alarms.damageCollider(hubCol, 25)).toBe(true);
    expect(alarms.hubOverridden).toBe(false);

    // Security Hub [E] override fires onHubOverride once
    const nearHub = alarms.nearestInteractable(V(6, 1.0, -18.5), 2.6);
    expect(nearHub).not.toBeNull();
    expect(nearHub!.id).toBe('security_hub');
    expect(nearHub!.isHub).toBe(true);

    expect(alarms.interact('security_hub')).toBe(true);
    expect(alarms.hubOverridden).toBe(true);
    expect(onHubOverride).toHaveBeenCalledTimes(1);
    expect(alarms.interact('security_hub')).toBe(false);
    expect(alarms.nearestInteractable(V(6, 1.0, -18.5), 2.6)).toBeNull();

    // Reset restores all panels and hub
    alarms.reset();
    expect(alarms.activePanelPositions().length).toBe(2);
    expect(alarms.hubOverridden).toBe(false);

    alarms.dispose();
  });
});

describe('StealthTakedown', () => {
  it('selects unaware guard from behind within 2.2 m, rejects front, distant, alert, or robotic targets', () => {
    const alertIds = new Set<number>([202]);
    const takedown = new StealthTakedown(uid => !alertIds.has(uid));

    const unawareGuard = makeGuard({ uid: 101, position: V(0, 0, 0), yaw: 0 }); // Facing +Z
    const alertGuard = makeGuard({ uid: 202, position: V(0, 0, 0), yaw: 0 });
    const drone = makeGuard({ uid: 303, id: 'drone', position: V(0, 0, 0), yaw: 0, machine: true });

    // Behind unaware guard (-Z relative to guard facing +Z), player looking +Z toward guard, dist 1.5 m -> eligible
    expect(takedown.findTarget(V(0, 0, -1.5), V(0, 0, 1), [unawareGuard])).toBe(unawareGuard);

    // Flanking from side (+X), dot(enemyForward, dirToPlayer) = 0 < 0.15, player looking -X -> eligible
    expect(takedown.findTarget(V(1.6, 0, 0), V(-1, 0, 0), [unawareGuard])).toBe(unawareGuard);

    // Directly in front (+Z), dot = +1 >= 0.15 -> rejected
    expect(takedown.findTarget(V(0, 0, 1.5), V(0, 0, -1), [unawareGuard])).toBeNull();

    // Out of range (2.6 m > 2.2 m) -> rejected
    expect(takedown.findTarget(V(0, 0, -2.6), V(0, 0, 1), [unawareGuard])).toBeNull();

    // Behind guard, but player facing away (-Z) -> rejected
    expect(takedown.findTarget(V(0, 0, -1.5), V(0, 0, -1), [unawareGuard])).toBeNull();

    // Alert guard -> rejected by eligibility predicate
    expect(takedown.findTarget(V(0, 0, -1.5), V(0, 0, 1), [alertGuard])).toBeNull();

    // Machine enemy -> rejected
    expect(takedown.findTarget(V(0, 0, -1.5), V(0, 0, 1), [drone])).toBeNull();
  });

  it('executes lethal 9999 armor-piercing stealth_takedown damage with quiet 3 m noise radius', () => {
    const { ctx, applyDamage, audioPlay, kick } = makeCtx();
    const takedown = new StealthTakedown();
    const guard = makeGuard({ uid: 404, position: V(4, 0, -6), yaw: 0, armor: 150 });
    ctx.player.position.set(4, 0, -7.4);

    const res = takedown.execute(guard, ctx);
    expect(res.noiseRadius).toBe(TAKEDOWN_NOISE_RADIUS);
    expect(res.position.x).toBeCloseTo(4);
    expect(res.position.z).toBeCloseTo(-6);

    expect(applyDamage).toHaveBeenCalledTimes(1);
    const dmg = (applyDamage.mock.calls[0] as unknown as [EnemyInstance, DamageInfo])[1];
    expect(dmg.amount).toBe(TAKEDOWN_DAMAGE);
    expect(dmg.source).toBe('stealth_takedown');
    expect(dmg.pierces).toBe(true);
    expect(dmg.armorPiercing).toBe(true);
    expect(dmg.force).toBe(TAKEDOWN_FORCE);
    expect(audioPlay).toHaveBeenCalled();
    expect(kick).toHaveBeenCalled();
  });
});

describe('Tier-3 bunker blast door breach & player credit rules', () => {
  it('allows breach_charge and hydraulic_overload to penetrate and shatter Tier-3 structures', () => {
    expect(canDamageTier(3, 'breach_charge')).toBe(true);
    expect(canDamageTier(3, 'hydraulic_overload')).toBe(true);
    expect(damageMultiplierFor(3, 'breach_charge')).toBeCloseTo(2.5);
    expect(damageMultiplierFor(3, 'hydraulic_overload')).toBeCloseTo(3.0);
    expect(SOURCE_MULT.breach_charge).toBeCloseTo(2.5);
    expect(SOURCE_MULT.hydraulic_overload).toBeCloseTo(3.0);

    // Verify DestructionManager actually shatters a Tier-3 ferro-crete bunker door node
    const { ctx } = makeCtx();
    const dm = new DestructionManager(ctx, () => new THREE.MeshBasicMaterial());
    const doorCluster = dm.addCluster({
      id: 'bunker_blast_door',
      kind: 'bunker_door',
      nodes: [
        { id: 'door_a', pos: [100, 2, 100], half: [2, 2, 0.5], mat: 'concreteDark', hp: 500, tier: 3, anchored: true, kind: 'wall' },
        { id: 'door_b', pos: [120, 2, 100], half: [2, 2, 0.5], mat: 'concreteDark', hp: 600, tier: 3, anchored: true, kind: 'wall' },
      ],
    });

    // breach_charge (2.5x * 250 = 625 > 500) breaks door_a
    dm.blast(V(100, 2, 100), 4, 250, 'breach_charge');
    expect(doorCluster.getNode('door_a')!.state).not.toBe('intact');

    // hydraulic_overload (3.0x * 250 = 750 > 600) breaks door_b
    dm.blast(V(120, 2, 100), 4, 250, 'hydraulic_overload');
    expect(doorCluster.getNode('door_b')!.state).not.toBe('intact');

    // Verify Structures Tier-3 gate is breached by breach_charge
    const structures = new Structures(
      ctx,
      [{ kind: 'gate', x: -100, y: 0, z: -100, yaw: 0, length: 4, tier: 3 }],
      () => new THREE.MeshBasicMaterial(),
    );
    structures.attach(null);
    const gate = structures.all.find(p => p.kind === 'gate')!;
    expect(gate.stage).toBe('intact');
    structures.blast(V(-100, 1.5, -100), 5, 250, 'breach_charge');
    expect(gate.stage).toBe('breached');

    dm.dispose();
  });

  it('classifies breach_charge, hydraulic_overload, and stealth_takedown as player credit sources', () => {
    expect(creditRule('breach_charge')).toBe('player');
    expect(creditRule('hydraulic_overload')).toBe('player');
    expect(creditRule('stealth_takedown')).toBe('player');
  });
});
