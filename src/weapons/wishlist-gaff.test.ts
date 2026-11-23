import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CorpseHit, Ctx, DamageInfo, RayHit } from '../core/contracts';
import type { DamageResult, EnemyId, EnemyInstance, EnemyRayHit } from '../core/gameplay';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { gaffDef } from './viewmodels/models/gaff';
import { HANDS } from './viewmodels/poses';
import { Anim } from './viewmodels/def';
import { HARPOON, Harpoon } from './harpoon';
import { WEAPONS } from './data';
import { lookup } from '../audio/catalog';
import { makeRange } from './testkit';

function makeKit(): Kit {
  const material = new THREE.MeshStandardMaterial();
  return new Kit({
    hard: material,
    glass: material,
    decal: material,
    decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials);
}

function makeAnim(def: ReturnType<typeof gaffDef>): Anim {
  const a = new Anim();
  a.model = def.model;
  a.parts = def.model.parts;
  a.mag = 1;
  a.magSize = 1;
  a.draw = 1;
  a.reload = -1;
  a.sinceFire = 10;
  return a;
}

interface MockEnemy extends EnemyInstance {
  health: number;
  maxHealth: number;
  alive: boolean;
}

function makeEnemy(
  uid: number,
  x: number,
  y: number,
  z: number,
  hp: number,
  opts: { id?: EnemyId; maxHealth?: number; isBoss?: boolean; armor?: number; machine?: boolean } = {},
): MockEnemy {
  const pos = new THREE.Vector3(x, y, z);
  const center = new THREE.Vector3(x, y + 1.1, z);
  const root = new THREE.Group();
  root.position.copy(pos);
  const hipBone = new THREE.Object3D();
  hipBone.position.copy(center);
  hipBone.updateMatrixWorld(true);
  return {
    uid,
    id: opts.id ?? 'trooper',
    char: { root, bones: [hipBone] } as unknown as EnemyInstance['char'],
    position: pos,
    velocity: new THREE.Vector3(),
    yaw: 0,
    health: hp,
    maxHealth: opts.maxHealth ?? hp,
    armor: opts.armor ?? 0,
    alive: true,
    score: 100,
    center,
    isBoss: opts.isBoss ?? false,
    frozen: 0,
    burning: 0,
    machine: opts.machine ?? false,
  };
}

interface MockHarness {
  ctx: Ctx;
  scene: THREE.Scene;
  playerVel: THREE.Vector3;
  playerEye: THREE.Vector3;
  pushSpy: ReturnType<typeof vi.fn>;
  pinSpy: ReturnType<typeof vi.fn>;
  applyDamageSpy: ReturnType<typeof vi.fn>;
  damageLog: Array<{ uid: number; amount: number; type: string; armorPiercing?: boolean }>;
  wallAt: { z: number; normal: THREE.Vector3 } | null;
  enemies: MockEnemy[];
  corpses: Array<{ handle: object; point: THREE.Vector3 }>;
}

function makeHarness(
  enemies: MockEnemy[] = [],
  wallZ: number | null = -30,
): MockHarness {
  const scene = new THREE.Scene();
  const playerVel = new THREE.Vector3();
  const playerEye = new THREE.Vector3(0, 1.7, 0);
  const damageLog: MockHarness['damageLog'] = [];
  const corpses: MockHarness['corpses'] = [];
  const wallAt = wallZ !== null ? { z: wallZ, normal: new THREE.Vector3(0, 0, 1) } : null;

  const pushSpy = vi.fn((dv: THREE.Vector3) => {
    playerVel.add(dv);
  });

  const pinSpy = vi.fn((_hit: CorpseHit, _anchor: THREE.Vector3) => {});

  const applyDamageSpy = vi.fn((enemy: EnemyInstance, damage: DamageInfo): DamageResult => {
    damageLog.push({
      uid: enemy.uid,
      amount: damage.amount,
      type: damage.type,
      armorPiercing: damage.armorPiercing,
    });
    const dealt = damage.region === 'head' ? damage.amount * (damage.headshotMult ?? 2) : damage.amount;
    enemy.health -= dealt;
    const killed = enemy.health <= 0;
    if (killed) {
      enemy.alive = false;
      corpses.push({ handle: { corpseOf: enemy.uid }, point: damage.point.clone() });
    }
    return {
      dealt,
      killed,
      headshot: damage.region === 'head',
      severed: [],
      blocked: false,
    };
  });

  const physicsRaycast = vi.fn((origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null => {
    if (!harness.wallAt) return null;
    if (Math.abs(dir.z) < 1e-6) return null;
    const t = (harness.wallAt.z - origin.z) / dir.z;
    if (t < 0 || t > maxDist) return null;
    return {
      point: origin.clone().addScaledVector(dir, t),
      normal: harness.wallAt.normal.clone(),
      distance: t,
      surface: 'concrete',
      collider: null,
    };
  });

  const enemyRaycastAll = vi.fn(
    (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, limit: number): EnemyRayHit[] => {
      const hits: EnemyRayHit[] = [];
      for (const e of enemies) {
        if (!e.alive) continue;
        const rel = e.center.clone().sub(origin);
        const along = rel.dot(dir);
        if (along < 0 || along > maxDist) continue;
        const closest = origin.clone().addScaledVector(dir, along);
        if (closest.distanceTo(e.center) <= 1.0) {
          hits.push({
            enemy: e,
            distance: along,
            point: closest,
            normal: dir.clone().negate(),
            bone: 1,
            region: 'chest',
          });
        }
      }
      hits.sort((a, b) => a.distance - b.distance);
      return hits.slice(0, limit);
    },
  );

  const raycastCorpses = vi.fn((origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): CorpseHit | null => {
    let best: { dist: number; entry: { handle: object; point: THREE.Vector3 } } | null = null;
    for (const c of corpses) {
      const rel = c.point.clone().sub(origin);
      const along = rel.dot(dir);
      if (along < 0 || along > maxDist) continue;
      const closest = origin.clone().addScaledVector(dir, along);
      if (closest.distanceTo(c.point) <= 1.2 && (!best || along < best.dist)) {
        best = { dist: along, entry: c };
      }
    }
    if (!best) return null;
    return {
      distance: best.dist,
      point: best.entry.point.clone(),
      normal: dir.clone().negate(),
      handle: best.entry.handle,
      bone: 1,
      region: 'chest',
    };
  });

  const ctx = {
    render: {
      scene,
      materials: { patch: <T>(m: T) => m },
      decals: { add: vi.fn(), clear: vi.fn() },
    },
    physics: {
      raycast: physicsRaycast,
    },
    enemies: {
      raycastAll: enemyRaycastAll,
      applyDamage: applyDamageSpy,
    },
    gore: {
      raycastCorpses,
      pin: pinSpy,
    },
    player: {
      eye: playerEye,
      position: new THREE.Vector3(0, 0, 0),
      velocity: playerVel,
      push: pushSpy,
      alive: true,
    },
    audio: {
      play: vi.fn(),
    },
    fx: {
      impact: vi.fn(),
      bloodHit: vi.fn(),
      sparks: vi.fn(),
    },
  } as unknown as Ctx;

  const harness: MockHarness = {
    ctx,
    scene,
    playerVel,
    playerEye,
    pushSpy,
    pinSpy,
    applyDamageSpy,
    damageLog,
    wallAt,
    enemies,
    corpses,
  };
  return harness;
}

describe('Gaff viewmodel (src/weapons/viewmodels/models/gaff.ts)', () => {
  it('builds with required hero parts, sockets, and HANDS.support grip', () => {
    const def = gaffDef(makeKit());
    const { model } = def;

    expect(model.parts.spear).toBeDefined();
    expect(model.parts.winch).toBeDefined();
    expect(model.parts.ram).toBeDefined();
    expect(model.parts.lever).toBeDefined();
    expect(model.parts.trigger).toBeDefined();

    expect(model.sockets.muzzle).toBeDefined();
    expect(model.sockets.fairlead).toBeDefined();
    expect(model.sockets.gripR).toBeDefined();
    expect(model.sockets.gripL).toBeDefined();
    expect(model.sockets.spearHold).toBeDefined();
    expect(model.sockets.leverHold).toBeDefined();

    expect(def.left?.pose).toBe(HANDS.support);
    expect(def.recoil.roll).toBe(0);
    expect(def.recoil.yaw).toBe(0);
  });

  it('enforces zero roll and zero yaw twist across draw, fire, and reload animations', () => {
    const def = gaffDef(makeKit());
    const a = makeAnim(def);

    for (let i = 0; i <= 20; i++) {
      const t = i / 20;

      // Draw
      def.model.resetParts();
      a.draw = t;
      a.sinceFire = 10;
      a.reload = -1;
      a.mag = 1;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      def.animate?.(a);
      expect(a.gunR.z).toBe(0);
      expect(a.gunR.y).toBe(0);

      // Fire
      def.model.resetParts();
      a.draw = 1;
      a.sinceFire = t * 0.7;
      a.reload = -1;
      a.mag = 0;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      def.animate?.(a);
      expect(a.gunR.z).toBe(0);
      expect(a.gunR.y).toBe(0);

      // Reload
      def.model.resetParts();
      a.draw = 1;
      a.sinceFire = 10;
      a.reload = t;
      a.mag = 0;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      def.animate?.(a);
      expect(a.gunR.z).toBe(0);
      expect(a.gunR.y).toBe(0);
    }
  });

  it('hides the loaded spear while out, returns it during reload, and spins the winch drum', () => {
    const def = gaffDef(makeKit());
    const a = makeAnim(def);

    // Loaded idle: spear visible.
    def.model.resetParts();
    a.mag = 1;
    a.sinceFire = 10;
    a.reload = -1;
    def.animate?.(a);
    expect(def.model.parts.spear!.visible).toBe(true);

    // Fired & away (mag === 0, not reloading): spear hidden and winch spins during launch.
    def.model.resetParts();
    a.mag = 0;
    a.sinceFire = 0.2;
    a.reload = -1;
    def.animate?.(a);
    expect(def.model.parts.spear!.visible).toBe(false);
    expect(Math.abs(def.model.parts.winch!.rotation.x)).toBeGreaterThan(0.5);

    // Mid-reload: spear returns to visibility and slides into trough while winch winds cable.
    def.model.resetParts();
    a.mag = 0;
    a.sinceFire = 10;
    a.reload = 0.5;
    def.animate?.(a);
    expect(def.model.parts.spear!.visible).toBe(true);
    expect(Math.abs(def.model.parts.winch!.rotation.x)).toBeGreaterThan(0.5);

    // Reeling input (`charge > 0`): winch spins even while idle with rope out.
    def.model.resetParts();
    a.mag = 0;
    a.sinceFire = 10;
    a.reload = -1;
    a.time = 1.0;
    a.charge = 1;
    def.animate?.(a);
    expect(Math.abs(def.model.parts.winch!.rotation.x)).toBeGreaterThan(0.5);
  });
});

describe('Harpoon controller (src/weapons/harpoon.ts)', () => {
  const origin = new THREE.Vector3(0, 1.7, 0);
  const muzzle = new THREE.Vector3(0.2, 1.55, -0.4);
  const forward = new THREE.Vector3(0, 0, -1);

  it('enforces one active harpoon at a time and tracks flight with gravity and 3D rope visuals', () => {
    const h = makeHarness([], -80);
    const harpoon = new Harpoon(h.ctx);

    expect(harpoon.state).toBe('ready');
    expect(harpoon.ropeOut).toBe(false);

    expect(harpoon.fire(origin, forward, muzzle)).toBe(true);
    expect(harpoon.state).toBe('flying');
    expect(harpoon.ropeOut).toBe(true);
    // Second fire while harpoon is already out must be rejected.
    expect(harpoon.fire(origin, forward, muzzle)).toBe(false);

    // Scene now contains the active spear mesh, embedded InstancedMesh, and steel rope mesh.
    expect(h.scene.children.length).toBeGreaterThanOrEqual(3);

    harpoon.update(0.1, false, false, muzzle, h.playerEye, forward);
    expect(harpoon.state).toBe('flying');
    // Moved ~9.5 m forward along -Z with mild downward gravity drop.
    expect(harpoon.position.z).toBeLessThan(-9.0);
    expect(harpoon.position.y).toBeLessThan(origin.y);
  });

  it('pierces 3 lined-up enemies (550 dmg each, no explosion) and pins all 3 to the wall behind', () => {
    const e1 = makeEnemy(1, 0, 0.6, -8, 200);
    const e2 = makeEnemy(2, 0, 0.6, -14, 200);
    const e3 = makeEnemy(3, 0, 0.6, -20, 200);
    const h = makeHarness([e1, e2, e3], -28);
    const harpoon = new Harpoon(h.ctx);

    expect(harpoon.fire(origin, forward, muzzle)).toBe(true);

    // Step until it traverses 28 m at 95 m/s (~0.35 s).
    for (let i = 0; i < 30 && harpoon.state === 'flying'; i++) {
      harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    }

    expect(harpoon.state).toBe('anchored_wall');
    expect(harpoon.skeweredCount).toBe(3);
    expect(e1.alive).toBe(false);
    expect(e2.alive).toBe(false);
    expect(e3.alive).toBe(false);

    expect(h.damageLog).toHaveLength(3);
    for (const d of h.damageLog) {
      expect(d.amount).toBe(HARPOON.damage);
      expect(d.type).toBe('bullet');
      expect(d.armorPiercing).toBe(true);
    }

    // All 3 skewered bodies pinned to the wall with stacked offsets along the shaft.
    expect(h.pinSpy).toHaveBeenCalledTimes(3);
    const anchor0 = h.pinSpy.mock.calls[0]![1] as THREE.Vector3;
    const anchor1 = h.pinSpy.mock.calls[1]![1] as THREE.Vector3;
    const anchor2 = h.pinSpy.mock.calls[2]![1] as THREE.Vector3;
    expect(anchor1.z).toBeGreaterThan(anchor0.z);
    expect(anchor2.z).toBeGreaterThan(anchor1.z);
  });

  it('caps multi-body skewer at 6 bodies and still nails those 6 to the wall', () => {
    const line: MockEnemy[] = [];
    for (let i = 0; i < 8; i++) {
      line.push(makeEnemy(10 + i, 0, 0.6, -5 - i * 3, 180));
    }
    const h = makeHarness(line, -34);
    const harpoon = new Harpoon(h.ctx);

    harpoon.fire(origin, forward, muzzle);
    for (let i = 0; i < 40 && harpoon.state === 'flying'; i++) {
      harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    }

    expect(harpoon.state).toBe('anchored_wall');
    expect(harpoon.skeweredCount).toBe(HARPOON.maxSkewer);
    expect(h.pinSpy).toHaveBeenCalledTimes(HARPOON.maxSkewer);
    // 7th and 8th enemies were not skewered past the 6-body cap.
    expect(line[6]!.alive).toBe(true);
    expect(line[7]!.alive).toBe(true);
  });

  it('slings player toward wall anchor on reelHeld, preserves momentum on release, and auto-releases within pullMinDist', () => {
    const h = makeHarness([], -20);
    const harpoon = new Harpoon(h.ctx);
    harpoon.fire(origin, forward, muzzle);
    for (let i = 0; i < 30 && harpoon.state === 'flying'; i++) {
      harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    }
    expect(harpoon.state).toBe('anchored_wall');

    // Reel in for 10 frames: strong forward pull + slight upward lift.
    for (let i = 0; i < 10; i++) {
      const res = harpoon.update(1 / 60, true, false, muzzle, h.playerEye, forward);
      expect(res.velocityDelta).not.toBeNull();
      expect(res.reloading).toBe(false);
    }
    expect(h.pushSpy).toHaveBeenCalledTimes(10);
    expect(h.playerVel.z).toBeLessThan(-7);
    expect(h.playerVel.y).toBeGreaterThan(0.5);

    // Release reelHeld: velocity is preserved untouched in the air.
    const speedAfterReel = h.playerVel.clone();
    const idleRes = harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    expect(idleRes.velocityDelta).toBeNull();
    expect(h.playerVel.distanceTo(speedAfterReel)).toBeLessThan(1e-6);

    // Move player within pullMinDist (~2.2 m) while reeling -> auto-releases and preserves velocity.
    h.playerEye.set(0, harpoon.anchor.y, harpoon.anchor.z + HARPOON.pullMinDist - 0.3);
    const autoRes = harpoon.update(1 / 60, true, false, muzzle, h.playerEye, forward);
    expect(harpoon.state).toBe('ready');
    expect(harpoon.ropeOut).toBe(false);
    expect(autoRes.reloading).toBe(true);
    expect(harpoon.embeddedCount).toBe(1);
    expect(h.playerVel.distanceTo(speedAfterReel)).toBeLessThan(1e-6);
  });

  it('lodges into a surviving heavy/boss enemy and mutually reels enemy and player together', () => {
    const boss = makeEnemy(99, 0, 0.6, -15, 1600, { id: 'brute', maxHealth: 1600, isBoss: true });
    const h = makeHarness([boss], -40);
    const harpoon = new Harpoon(h.ctx);

    harpoon.fire(origin, forward, muzzle);
    for (let i = 0; i < 20 && harpoon.state === 'flying'; i++) {
      harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    }

    expect(harpoon.state).toBe('anchored_enemy');
    expect(boss.alive).toBe(true);
    expect(boss.health).toBe(1600 - HARPOON.damage);

    const startBossZ = boss.position.z;
    const res = harpoon.update(0.1, true, false, muzzle, h.playerEye, forward);
    // Heavy enemy is pulled closer to the player AND player is slung toward the heavy enemy.
    expect(boss.position.z).toBeGreaterThan(startBossZ + 0.5);
    expect(res.velocityDelta).not.toBeNull();
    expect(h.playerVel.z).toBeLessThan(-2);

    // If the heavy enemy dies while tethered, the harpoon detaches cleanly and starts reload.
    boss.alive = false;
    const afterDeath = harpoon.update(1 / 60, true, false, muzzle, h.playerEye, forward);
    expect(harpoon.state).toBe('ready');
    expect(afterDeath.reloading).toBe(true);
  });

  it('pulls a non-heavy surviving enemy rapidly toward the player without slinging the player', () => {
    // Surviving regular enemy with maxHealth < heavyHpThreshold (e.g. armored/buffed survival).
    const light = makeEnemy(42, 0, 0.6, -14, 700, { id: 'trooper', maxHealth: 350, isBoss: false });
    const h = makeHarness([light], -40);
    const harpoon = new Harpoon(h.ctx);

    harpoon.fire(origin, forward, muzzle);
    for (let i = 0; i < 20 && harpoon.state === 'flying'; i++) {
      harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    }
    expect(harpoon.state).toBe('anchored_enemy');

    const startZ = light.position.z;
    const res = harpoon.update(0.1, true, false, muzzle, h.playerEye, forward);
    expect(light.position.z).toBeGreaterThan(startZ + 1.5);
    expect(res.velocityDelta).toBeNull();
    expect(h.pushSpy).not.toHaveBeenCalled();
  });

  it('cuts the steel rope cleanly on tap-to-cut, leaves wall harpoon embedded, and blocks re-fire until reload completes', () => {
    const h = makeHarness([], -15);
    const harpoon = new Harpoon(h.ctx);

    harpoon.fire(origin, forward, muzzle);
    for (let i = 0; i < 25 && harpoon.state === 'flying'; i++) {
      harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    }
    expect(harpoon.state).toBe('anchored_wall');

    // Reel briefly so player has momentum.
    harpoon.update(0.1, true, false, muzzle, h.playerEye, forward);
    const momentum = h.playerVel.clone();

    // Tap cut: rope detaches, embedded harpoon stays in wall, momentum preserved, reload starts.
    const cutRes = harpoon.update(1 / 60, false, true, muzzle, h.playerEye, forward);
    expect(harpoon.state).toBe('ready');
    expect(harpoon.ropeOut).toBe(false);
    expect(harpoon.embeddedCount).toBe(1);
    expect(cutRes.reloading).toBe(true);
    expect(h.playerVel.distanceTo(momentum)).toBeLessThan(1e-6);

    // Cannot fire again while reload is in progress.
    expect(harpoon.fire(origin, forward, muzzle)).toBe(false);

    // Advance past HARPOON.reloadTime -> reload completes and firing works again.
    const doneRes = harpoon.update(HARPOON.reloadTime + 0.05, false, false, muzzle, h.playerEye, forward);
    expect(doneRes.reloading).toBe(false);
    expect(harpoon.fire(origin, forward, muzzle)).toBe(true);
  });

  it('supports cosmetic mode with zero damage, zero pins, and zero player push', () => {
    const e1 = makeEnemy(7, 0, 0.6, -10, 200);
    const h = makeHarness([e1], -20);
    const harpoon = new Harpoon(h.ctx);

    expect(harpoon.fire(origin, forward, muzzle, 'gaff', true)).toBe(true);
    for (let i = 0; i < 30 && harpoon.state === 'flying'; i++) {
      harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    }
    expect(harpoon.state).toBe('anchored_wall');
    expect(e1.alive).toBe(true);
    expect(h.applyDamageSpy).not.toHaveBeenCalled();
    expect(h.pinSpy).not.toHaveBeenCalled();

    const reelRes = harpoon.update(0.1, true, false, muzzle, h.playerEye, forward);
    expect(reelRes.velocityDelta).toBeNull();
    expect(h.pushSpy).not.toHaveBeenCalled();

    harpoon.reset();
    expect(harpoon.state).toBe('ready');
    expect(harpoon.embeddedCount).toBe(0);
    expect(harpoon.reloading).toBe(false);
  });

  it('fires untethered harpoons without rope or reeling while still skewering, pinning, and embedding in walls', () => {
    const e1 = makeEnemy(11, 0, 0.6, -8, 200);
    const e2 = makeEnemy(12, 0, 0.6, -14, 200);
    const h = makeHarness([e1, e2], -24);
    const harpoon = new Harpoon(h.ctx);

    expect(harpoon.fire(origin, forward, muzzle, 'gaff', false, false)).toBe(true);
    expect(harpoon.state).toBe('ready');
    expect(harpoon.ropeOut).toBe(false);
    expect(harpoon.freeFlightCount).toBe(1);

    for (let i = 0; i < 30 && harpoon.freeFlightCount > 0; i++) {
      const res = harpoon.update(1 / 60, true, false, muzzle, h.playerEye, forward);
      expect(res.velocityDelta).toBeNull();
    }

    expect(harpoon.freeFlightCount).toBe(0);
    expect(harpoon.ropeOut).toBe(false);
    expect(e1.alive).toBe(false);
    expect(e2.alive).toBe(false);
    expect(h.pinSpy).toHaveBeenCalledTimes(2);
    expect(harpoon.embeddedCount).toBe(1);
    expect(h.pushSpy).not.toHaveBeenCalled();
  });

  it('releases the rope cleanly mid-flight and lets the harpoon finish flying untethered', () => {
    const e1 = makeEnemy(21, 0, 0.6, -18, 200);
    const h = makeHarness([e1], -26);
    const harpoon = new Harpoon(h.ctx);

    expect(harpoon.fire(origin, forward, muzzle, 'gaff', false, true)).toBe(true);
    harpoon.update(0.05, true, false, muzzle, h.playerEye, forward);
    expect(harpoon.state).toBe('flying');

    // Release RMB mid-flight -> rope detaches, reload begins, spear keeps flying to skewer & embed.
    const cutRes = harpoon.update(1 / 60, false, true, muzzle, h.playerEye, forward);
    expect(harpoon.ropeOut).toBe(false);
    expect(cutRes.reloading).toBe(true);
    expect(harpoon.freeFlightCount).toBe(1);

    for (let i = 0; i < 40 && harpoon.freeFlightCount > 0; i++) {
      harpoon.update(1 / 60, false, false, muzzle, h.playerEye, forward);
    }
    expect(e1.alive).toBe(false);
    expect(h.pinSpy).toHaveBeenCalledTimes(1);
    expect(harpoon.embeddedCount).toBe(1);
  });
});

describe('Gaff Weapons integration (gaff_shot, LMB untethered, RMB hold-to-reel)', () => {
  it('wires gaff_shot sample and separates untethered LMB fire from RMB click-and-hold grapple', async () => {
    const def = lookup('gaff_shot');
    expect(def?.kind).toBe('sample');
    expect(def?.file).toBe('guns/gaff_shot.mp3');
    expect(WEAPONS.gaff.sounds[0]!.id).toBe('gaff_shot');

    const r = await makeRange();
    r.wall(-18, 2);
    r.weapons.give('gaff');
    r.weapons.switchTo('gaff');
    r.run(0.6);

    // 1) Regular LMB fire: plays gaff_shot, launches untethered (no rope), auto-reloads normally.
    r.record.sounds.length = 0;
    r.input.simulate('fire', true);
    r.run(1 / 60);
    r.input.simulate('fire', false);
    expect(r.record.sounds).toContain('gaff_shot');
    expect(r.weapons.harpoon.ropeOut).toBe(false);
    expect(r.weapons.harpoon.freeFlightCount).toBe(1);

    // Wait for reload to finish (0.2s auto-reload delay + 1.9s reload).
    r.run(2.4);
    expect(r.weapons.ammo().mag).toBe(1);
    expect(r.weapons.harpoon.embeddedCount).toBe(1);

    // 2) Click-and-hold RMB: plays gaff_shot, launches WITH rope, reels player once anchored until released.
    const pushSpy = vi.fn((dv: THREE.Vector3) => {
      r.player.velocity.add(dv);
    });
    r.ctx.player.push = pushSpy;
    r.record.sounds.length = 0;
    r.input.simulate('aim', true);
    r.run(1 / 60);
    expect(r.record.sounds).toContain('gaff_shot');
    expect(r.weapons.harpoon.ropeOut).toBe(true);

    // Hold RMB while harpoon flies 18 m (~0.2 s) and reels for several frames.
    r.run(0.4);
    expect(r.weapons.harpoon.state).toBe('anchored_wall');
    expect(r.weapons.harpoon.reeling).toBe(true);
    expect(pushSpy).toHaveBeenCalled();

    // Release RMB: immediately cuts the rope, embeds the harpoon, and starts reloading.
    r.input.simulate('aim', false);
    r.run(1 / 60);
    expect(r.weapons.harpoon.ropeOut).toBe(false);
    expect(r.weapons.harpoon.reeling).toBe(false);
    expect(r.weapons.reloading).toBe(true);
  });
});
