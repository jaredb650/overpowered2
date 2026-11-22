/**
 * Lane F (Weapons Wishlist — Riot shield):
 * - Shared sculptural ballistic riot shield viewmodel sub-assembly wired into all 4 pistols
 *   (`rivet`, `ultramag`, `judge`, `autoraffica`) with narrow armoured viewing slit and raise/fatigue/impact clip.
 * - Zero-allocation `RiotShield` gameplay state machine (hold-RMB raise, arm fatigue, involuntary drop cooldown,
 *   AP/explosive/melee/flank bypasses) and co-op teammate shield blocking geometry (`checkTeammateShieldHit`).
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModId } from '../core/gameplay';
import { MODS, SHIELD_GUNS, shieldOf } from './mods';
import { RIOT_SHIELD, RiotShield, checkTeammateShieldHit } from './shield';
import { Anim, type ViewDef } from './viewmodels/def';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { buildDefs } from './viewmodels/models';
import { SHIELD_SLIT } from './viewmodels/models/shield';
import { dressModel, restingModel } from './viewmodels/rest';

let kit: Kit;
let defs: Record<string, ViewDef>;
let hardMat: THREE.MeshStandardMaterial;
let glassMat: THREE.MeshStandardMaterial;

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
    }),
  });
  hardMat = new THREE.MeshStandardMaterial({ name: 'hard' });
  glassMat = new THREE.MeshStandardMaterial({ name: 'glass', transparent: true, opacity: 0.22 });
  kit = new Kit({
    hard: hardMat,
    glass: glassMat,
    decal: hardMat,
    decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials);
  defs = buildDefs(kit);
});

afterAll(() => vi.unstubAllGlobals());

describe('Wishlist Lane F — Riot shield viewmodels', () => {
  it('wires ${gun}Shield into all 4 pistols with finite geometry, glass viewport, and clear central viewing slit', () => {
    expect([...SHIELD_GUNS]).toEqual(['rivet', 'ultramag', 'judge', 'autoraffica']);

    for (const gun of SHIELD_GUNS) {
      const modId = shieldOf(gun);
      const def = defs[gun]!;
      expect(MODS[modId].slot).toBe('sight');
      expect(MODS[modId].patch.shield).toBe(true);
      expect(def.mods?.[modId], gun).toBeDefined();
      expect(def.mods![modId]!.part, gun).toBe('shield');

      const shield = def.model.parts.shield;
      expect(shield, `${gun}.parts.shield`).toBeDefined();
      expect(def.model.sockets.shieldGripL, `${gun}.sockets.shieldGripL`).toBeDefined();
      expect(def.model.sockets.shieldGripL!.parent, `${gun}.shieldGripL.parent`).toBe(shield);

      let opaqueMeshCount = 0;
      let glassMeshCount = 0;
      let totalTris = 0;

      shield!.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const pos = mesh.geometry.getAttribute('position');
        const norm = mesh.geometry.getAttribute('normal');
        expect(pos, `${gun}.shield.position`).toBeDefined();
        expect(norm, `${gun}.shield.normal`).toBeDefined();
        for (let i = 0; i < pos.array.length; i++) {
          expect(Number.isFinite(pos.array[i]), `${gun}.shield.pos[${i}]`).toBe(true);
        }
        for (let i = 0; i < norm.array.length; i++) {
          expect(Number.isFinite(norm.array[i]), `${gun}.shield.norm[${i}]`).toBe(true);
        }
        totalTris += (mesh.geometry.index?.count ?? 0) / 3;

        if (mesh.material === glassMat) {
          glassMeshCount++;
        } else {
          opaqueMeshCount++;
          // Verify no opaque vertex intrudes into the clear central viewing slit aperture.
          const clearW = SHIELD_SLIT.halfWidth - 0.008;
          const clearH = SHIELD_SLIT.halfHeight - 0.005;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const insideSlit = Math.abs(x) < clearW && Math.abs(y) < clearH;
            expect(insideSlit, `${gun}.shield opaque vertex inside viewing slit at (${x.toFixed(4)}, ${y.toFixed(4)})`).toBe(false);
          }
        }
      });

      expect(opaqueMeshCount, gun).toBeGreaterThan(0);
      expect(glassMeshCount, gun).toBeGreaterThan(0);
      expect(totalTris, gun).toBeGreaterThan(200);
    }
  });

  it('toggles shield visibility cleanly in dressModel on all 4 pistols', () => {
    for (const gun of SHIELD_GUNS) {
      const def = defs[gun]!;
      const modId = shieldOf(gun);
      const { root } = restingModel(gun, def);

      dressModel(root, def, new Set<ModId>());
      expect(root.getObjectByName('shield')?.visible, `${gun} unfitted`).toBe(false);

      dressModel(root, def, new Set<ModId>([modId]));
      expect(root.getObjectByName('shield')?.visible, `${gun} fitted`).toBe(true);
    }
  });

  it('animates smoothly from lowered hip pose (aim=0) to raised viewport pose (aim=1) with impact jolt and fatigue sag, zero gun roll/yaw', () => {
    for (const gun of SHIELD_GUNS) {
      const def = defs[gun]!;
      const modId = shieldOf(gun);
      const a = new Anim();
      a.parts = def.model.parts;
      a.model = def.model;
      a.mods = new Set<ModId>([modId]);
      a.mag = 10;
      a.magSize = 15;
      a.dt = 1 / 60;
      a.time = 1.2;

      // Lowered hip pose (aim = 0): low and off to the left.
      a.aim = 0;
      a.charge = 0;
      a.parry = -1;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      a.left.begin(def.left);
      def.model.resetParts();
      def.animate(a);

      const shield = def.model.parts.shield!;
      const loweredX = shield.position.x;
      const loweredY = shield.position.y;
      expect(loweredX, `${gun} lowered x`).toBeCloseTo(SHIELD_SLIT.loweredPos[0], 4);
      expect(loweredY, `${gun} lowered y`).toBeCloseTo(SHIELD_SLIT.loweredPos[1], 4);
      expect(a.left.base, `${gun} left hand on shield`).toBe('shieldGripL');
      expect(a.gunR.y, `${gun} zero yaw`).toBe(0);
      expect(a.gunR.z, `${gun} zero roll`).toBe(0);

      // Raised viewport pose (aim = 1): rises into centre viewing slit alignment, square rotation.
      a.aim = 1;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      a.left.begin(def.left);
      def.model.resetParts();
      def.animate(a);

      const raisedX = shield.position.x;
      const raisedY = shield.position.y;
      const raisedZ = shield.position.z;
      expect(raisedY, `${gun} raised above lowered`).toBeGreaterThan(loweredY + 0.12);
      expect(raisedX, `${gun} raised moves inward toward centre`).toBeGreaterThan(loweredX + 0.12);
      expect(shield.rotation.x, `${gun} square rx`).toBeCloseTo(0, 4);
      expect(shield.rotation.y, `${gun} square ry`).toBeCloseTo(0, 4);
      expect(shield.rotation.z, `${gun} square rz`).toBeCloseTo(0, 4);
      expect(a.gunR.y, `${gun} raised zero yaw`).toBe(0);
      expect(a.gunR.z, `${gun} raised zero roll`).toBe(0);

      // Bullet impact jolt (parry >= 0): crisp straight-back recoil on shield, zero roll/yaw on gun.
      a.parry = 0.3;
      a.gunP.set(0, 0, 0);
      a.gunR.set(0, 0, 0);
      def.model.resetParts();
      def.animate(a);
      expect(shield.position.z, `${gun} impact pushes shield back`).toBeGreaterThan(raisedZ + 0.015);
      expect(a.gunR.y, `${gun} impact zero gun yaw`).toBe(0);
      expect(a.gunR.z, `${gun} impact zero gun roll`).toBe(0);

      // Exhausted fatigue (charge = 1): shield sags down; Judge must NOT fan-hammer with shield fitted.
      a.parry = -1;
      a.charge = 1;
      a.left.begin(def.left);
      def.model.resetParts();
      def.animate(a);
      expect(shield.position.y, `${gun} exhausted sag`).toBeLessThan(raisedY - 0.03);
      if (gun === 'judge') {
        expect(a.left.names.slice(0, a.left.steps)).not.toContain('fanHold');
      }
    }
  });
});

describe('Wishlist Lane F — RiotShield gameplay controller', () => {
  const forward = new THREE.Vector3(0, 0, -1);
  const frontIncoming = new THREE.Vector3(0, 0, 1);

  it('stays lowered by default and does NOT block unless RMB is held', () => {
    const shield = new RiotShield();
    const s0 = shield.update(0.5, true, false, false);
    expect(s0.fitted).toBe(true);
    expect(s0.raise).toBe(0);
    expect(s0.active).toBe(false);
    expect(shield.moveSpeedMult).toBe(1);

    const hit = shield.tryBlock(frontIncoming, forward, 20);
    expect(hit.blocked).toBe(false);
    expect(hit.fatigue).toBe(0);
  });

  it('raises smoothly on held RMB, blocks frontal fire, builds fatigue, and slows movement', () => {
    const shield = new RiotShield();
    // Partial raise below threshold does not block yet.
    const partial = shield.update(0.05, true, true, false);
    expect(partial.raise).toBeGreaterThan(0);
    expect(partial.raise).toBeLessThan(RIOT_SHIELD.activeThreshold);
    expect(partial.active).toBe(false);
    expect(shield.tryBlock(frontIncoming, forward, 15).blocked).toBe(false);

    // Finish raising to 1.0.
    const raised = shield.update(0.3, true, true, false);
    expect(raised.raise).toBe(1);
    expect(raised.active).toBe(true);
    expect(shield.moveSpeedMult).toBe(RIOT_SHIELD.moveSpeedMult);

    // Frontal bullet blocked and adds fatigue.
    const b1 = shield.tryBlock(frontIncoming, forward, 20);
    expect(b1.blocked).toBe(true);
    expect(b1.exhaustedNow).toBe(false);
    const f1 = b1.fatigue;
    expect(f1).toBeCloseTo(20 * RIOT_SHIELD.fatiguePerDamage, 6);

    // Low-damage hit still adds minFatiguePerHit floor (reuses pre-allocated result object cleanly).
    const b2 = shield.tryBlock(frontIncoming, forward, 2);
    expect(b2.blocked).toBe(true);
    expect(b2.fatigue).toBeCloseTo(f1 + RIOT_SHIELD.minFatiguePerHit, 6);
  });

  it('forces an involuntary drop and cooldown when arm fatigue reaches 1.0, then recovers', () => {
    const shield = new RiotShield();
    shield.update(0.5, true, true, false);
    expect(shield.active).toBe(true);

    // Heavy barrage pushes fatigue to 1.0.
    let exhaustedHit = false;
    for (let i = 0; i < 10; i++) {
      const res = shield.tryBlock(frontIncoming, forward, 30);
      if (res.exhaustedNow) {
        exhaustedHit = true;
        break;
      }
    }
    expect(exhaustedHit).toBe(true);
    expect(shield.exhausted).toBe(true);
    expect(shield.cooldown).toBeCloseTo(RIOT_SHIELD.exhaustCooldown, 5);
    expect(shield.active).toBe(false);

    // Immediate follow-up hit cannot be blocked while exhausted.
    expect(shield.tryBlock(frontIncoming, forward, 20).blocked).toBe(false);

    // Holding RMB during cooldown cannot raise the shield; it drops cleanly to 0.
    const mid = shield.update(RIOT_SHIELD.exhaustCooldown * 0.5, true, true, false);
    expect(mid.exhausted).toBe(true);
    expect(mid.raise).toBe(0);
    expect(mid.active).toBe(false);
    expect(mid.cooldown).toBeCloseTo(RIOT_SHIELD.exhaustCooldown * 0.5, 4);

    // Once cooldown finishes, exhaustion clears and RMB raises the shield again.
    const cleared = shield.update(RIOT_SHIELD.exhaustCooldown * 0.5 + 0.05, true, true, false);
    expect(cleared.exhausted).toBe(false);
    expect(cleared.cooldown).toBe(0);
    expect(cleared.fatigue).toBe(0);

    const reraised = shield.update(0.3, true, true, false);
    expect(reraised.raise).toBe(1);
    expect(reraised.active).toBe(true);
  });

  it('recovers fatigue steadily when lowered or idle without hits, and lowers when busy', () => {
    const shield = new RiotShield();
    shield.update(0.4, true, true, false);
    shield.tryBlock(frontIncoming, forward, 50);
    const afterHit = shield.fatigue;
    expect(afterHit).toBeGreaterThan(0.3);

    // Lowering drains fatigue immediately.
    shield.update(0.5, true, false, false);
    expect(shield.raise).toBe(0);
    expect(shield.fatigue).toBeCloseTo(Math.max(0, afterHit - 0.5 * RIOT_SHIELD.drainRate), 5);

    // Raising while busy (e.g. reload/dash) keeps the shield down.
    shield.update(0.4, true, true, true);
    expect(shield.raise).toBe(0);
    expect(shield.active).toBe(false);

    // Unfitting resets everything immediately.
    shield.update(0.4, true, true, false);
    shield.tryBlock(frontIncoming, forward, 40);
    shield.update(0.016, false, true, false);
    expect(shield.fitted).toBe(false);
    expect(shield.raise).toBe(0);
    expect(shield.fatigue).toBe(0);
  });

  it('bypasses on armour-piercing, explosives, melee, and flank/rear hits outside the frontal arc', () => {
    const shield = new RiotShield();
    shield.update(0.5, true, true, false);

    // AP, explosive, and melee bypasses even dead-on from the front.
    expect(shield.tryBlock(frontIncoming, forward, 40, { armorPiercing: true }).blocked).toBe(false);
    expect(shield.tryBlock(frontIncoming, forward, 80, { explosive: true }).blocked).toBe(false);
    expect(shield.tryBlock(frontIncoming, forward, 35, { melee: true }).blocked).toBe(false);
    expect(shield.fatigue).toBe(0);

    // 55° off-axis (within ~68° half-angle) is still blocked.
    const deg55 = (55 * Math.PI) / 180;
    const angledFront = new THREE.Vector3(Math.sin(deg55), 0, Math.cos(deg55));
    expect(shield.tryBlock(angledFront, forward, 15).blocked).toBe(true);

    // 78° flank (outside ~68° half-angle) bypasses.
    const deg78 = (78 * Math.PI) / 180;
    const flank = new THREE.Vector3(Math.sin(deg78), 0, Math.cos(deg78));
    expect(shield.tryBlock(flank, forward, 20).blocked).toBe(false);

    // Direct rear hit (same direction as player forward) bypasses.
    const rear = new THREE.Vector3(0, 0, -1);
    expect(shield.tryBlock(rear, forward, 20).blocked).toBe(false);
  });
});

describe('Wishlist Lane F — Co-op teammate shield blocking geometry', () => {
  const matePos = new THREE.Vector3(0, 0, 0);
  const mateFwd = new THREE.Vector3(0, 0, -1);

  it('stops frontal enemy rays intersecting the teammate raised shield slab', () => {
    const origin = new THREE.Vector3(0, RIOT_SHIELD.coop.centerY, -8);
    const dir = new THREE.Vector3(0, 0, 1);
    const hit = checkTeammateShieldHit(origin, dir, 20, matePos, mateFwd, true);
    expect(hit).not.toBeNull();
    expect(hit!.hit).toBe(true);
    expect(hit!.distance).toBeCloseTo(8 - RIOT_SHIELD.coop.forwardOffset, 4);
    expect(hit!.point.z).toBeCloseTo(-RIOT_SHIELD.coop.forwardOffset, 4);
    expect(hit!.normal.z).toBeCloseTo(-1, 5);
  });

  it('misses when teammate shield is lowered, out of slab bounds, or struck from flank/rear', () => {
    const origin = new THREE.Vector3(0, RIOT_SHIELD.coop.centerY, -8);
    const dir = new THREE.Vector3(0, 0, 1);

    // Shield lowered.
    expect(checkTeammateShieldHit(origin, dir, 20, matePos, mateFwd, false)).toBeNull();

    // Ray misses wide past shield edge.
    const wideOrigin = new THREE.Vector3(RIOT_SHIELD.coop.halfWidth + 0.2, RIOT_SHIELD.coop.centerY, -8);
    expect(checkTeammateShieldHit(wideOrigin, dir, 20, matePos, mateFwd, true)).toBeNull();

    // Ray passes over the top of the shield.
    const highOrigin = new THREE.Vector3(0, RIOT_SHIELD.coop.centerY + RIOT_SHIELD.coop.halfHeight + 0.15, -8);
    expect(checkTeammateShieldHit(highOrigin, dir, 20, matePos, mateFwd, true)).toBeNull();

    // Flank ray (90° side shot) bypasses.
    const flankOrigin = new THREE.Vector3(-8, RIOT_SHIELD.coop.centerY, -RIOT_SHIELD.coop.forwardOffset);
    const flankDir = new THREE.Vector3(1, 0, 0);
    expect(checkTeammateShieldHit(flankOrigin, flankDir, 20, matePos, mateFwd, true)).toBeNull();

    // Rear ray (shooting into teammate's back) bypasses.
    const rearOrigin = new THREE.Vector3(0, RIOT_SHIELD.coop.centerY, 8);
    const rearDir = new THREE.Vector3(0, 0, -1);
    expect(checkTeammateShieldHit(rearOrigin, rearDir, 20, matePos, mateFwd, true)).toBeNull();
  });
});
