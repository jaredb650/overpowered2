/**
 * Holdfast's four-gun Flak Tower (stage 11 of docs/proposals/mission-2-plan.md).
 *
 * Replaces the static roof geometry from `yard.ts` with four articulated, breakable twin-88 mm flak turrets at `FLAK_GUNS`.
 * Each turret has 500 HP, a Rapier collider registered through `VehicleSystem.addExtra` so every weapon, explosion, and
 * shoulder-pod missile paint works natively, and active flak airburst salvos during the `flak` section.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ctx, ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget } from '../../core/gameplay';
import { clamp, damp, dampAngle, rand } from '../../core/math';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { EXPLOSIONS } from '../../weapons/data';
import { FLAK_GUNS } from '../../world/map/holdfast/plan';
import type { ExtraTarget, VehicleSystem } from './index';

export const FLAK_GUN_HP = 500;
const FIRE_EVERY: readonly [number, number] = [2.6, 3.8];
const FLAK_DAMAGE = 70;
const FLAK_RADIUS = 7.5;
const MARK_COLOR = '#ff3b3b';

const _to = new THREE.Vector3();
const _at = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function chamferBox(w: number, h: number, d: number, bevel = 0.08): THREE.BufferGeometry {
  const b = Math.min(bevel, w * 0.25, h * 0.25, d * 0.25);
  const hw = w / 2 - b;
  const hh = h / 2 - b;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, d - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  geo.center();
  return geo;
}

interface FlakGun {
  readonly index: number;
  readonly position: THREE.Vector3;
  readonly center: THREE.Vector3;
  readonly root: THREE.Group;
  readonly turret: THREE.Group;
  readonly barrels: THREE.Group;
  readonly wreck: THREE.Group;
  readonly collider: RAPIER.Collider;
  readonly meshes: THREE.Object3D[];
  readonly target: MissileTarget;
  hp: number;
  alive: boolean;
  yaw: number;
  pitch: number;
  recoil: number;
  fireIn: number;
  smokeIn: number;
  unmark: (() => void) | null;
}

export class FlakTower implements ExtraTarget {
  readonly guns: FlakGun[] = [];
  private readonly byHandle = new Map<number, FlakGun>();
  private readonly materials: ModelMaterials;
  private active = false;
  private idleClock = 0;

  constructor(private readonly ctx: Ctx, private readonly vehicles: VehicleSystem | null) {
    this.materials = new ModelMaterials(ctx);
    this.build();
    this.vehicles?.addExtra(this);
  }

  get aliveCount(): number {
    let n = 0;
    for (const g of this.guns) if (g.alive) n++;
    return n;
  }

  /** Activates targeting markers and live fire against the player/Frame (during the `flak` section). */
  setActive(on: boolean): void {
    this.active = on;
    for (const g of this.guns) {
      if (on && g.alive && !g.unmark) {
        g.unmark = this.ctx.hud.follow(_at.copy(g.center).setY(g.center.y + 2.6).clone(), `FLAK ${g.index + 1}`, MARK_COLOR);
      } else if (!on && g.unmark) {
        g.unmark();
        g.unmark = null;
      }
    }
  }

  /** Restores all four turrets intact (on checkpoint redeploy or fresh run). */
  reset(): void {
    this.active = false;
    for (const g of this.guns) {
      g.hp = FLAK_GUN_HP;
      g.alive = true;
      g.recoil = 0;
      g.fireIn = rand(FIRE_EVERY[0], FIRE_EVERY[1]) + g.index * 0.55;
      g.turret.visible = true;
      g.wreck.visible = false;
      g.unmark?.();
      g.unmark = null;
    }
  }

  /** Fires a dramatic visual flak burst from all living guns toward `point` (used during the courier shootdown). */
  salvoAt(point: THREE.Vector3): void {
    const { fx, audio } = this.ctx;
    for (const g of this.guns) {
      if (!g.alive) continue;
      _to.subVectors(point, g.center);
      g.yaw = Math.atan2(_to.x, _to.z);
      g.pitch = clamp(Math.atan2(_to.y, Math.hypot(_to.x, _to.z)), 0.1, 1.15);
      g.turret.rotation.y = g.yaw;
      g.barrels.rotation.x = -g.pitch;
      g.recoil = 0.45;
      _at.copy(g.center).addScaledVector(_to.normalize(), 3.6);
      fx.muzzleFlash(_at, _to, 'rocket');
      fx.tracer(_at, point, 'heavy');
    }
    audio.play('tank_cannon', { position: this.guns[0]!.center, pitch: 1.25, volume: 0.7 });
  }

  update(dt: number): void {
    this.idleClock += dt;
    const { player, audio, fx } = this.ctx;
    const quarry = player.eye;

    for (const g of this.guns) {
      if (!g.alive) {
        g.smokeIn -= dt;
        if (g.smokeIn <= 0) {
          g.smokeIn = 0.45;
          fx.smoke(_at.copy(g.center).setY(g.center.y + 0.9), 0x2e2c2a, 1.8, 2.8);
        }
        continue;
      }

      // Smoothly return barrel recoil.
      if (g.recoil > 0) {
        g.recoil = Math.max(0, g.recoil - dt * 2.2);
        g.barrels.position.z = -g.recoil;
      }

      if (this.active && player.alive) {
        _to.subVectors(quarry, g.center);
        const horiz = Math.hypot(_to.x, _to.z) || 1;
        const wantYaw = Math.atan2(_to.x, _to.z);
        const wantPitch = clamp(Math.atan2(_to.y, horiz), -0.42, 1.15);
        g.yaw = dampAngle(g.yaw, wantYaw, 3.2, dt);
        g.pitch = damp(g.pitch, wantPitch, 3.2, dt);
        g.turret.rotation.y = g.yaw;
        g.barrels.rotation.x = -g.pitch;

        g.fireIn -= dt;
        if (g.fireIn <= 0 && horiz < 145) {
          g.fireIn = rand(FIRE_EVERY[0], FIRE_EVERY[1]);
          this.fireGun(g, quarry);
        }
      } else {
        // Scanning the sky over Holdfast before the `flak` beat starts.
        const sweep = Math.sin(this.idleClock * 0.45 + g.index * 1.4) * 0.8 + Math.PI;
        g.yaw = dampAngle(g.yaw, sweep, 1.5, dt);
        g.pitch = damp(g.pitch, 0.72 + Math.sin(this.idleClock * 0.3 + g.index) * 0.14, 1.5, dt);
        g.turret.rotation.y = g.yaw;
        g.barrels.rotation.x = -g.pitch;
      }
    }
    void audio;
  }

  private fireGun(g: FlakGun, target: THREE.Vector3): void {
    const { audio, fx, player, render } = this.ctx;
    g.recoil = 0.55;
    _dir.subVectors(target, g.center).normalize();
    const muzzle = _at.copy(g.center).addScaledVector(_dir, 3.8);
    fx.muzzleFlash(muzzle, _dir, 'rocket');
    audio.play('tank_cannon', { position: muzzle, pitch: 1.25 + rand(-0.06, 0.06), volume: 0.75 });

    // Airburst point with slight scatter so moving/dashing/jetting dodges direct hits.
    const burst = new THREE.Vector3(
      target.x + rand(-4.5, 4.5),
      Math.max(1.2, target.y + rand(-1.5, 3.5)),
      target.z + rand(-4.5, 4.5),
    );
    fx.tracer(muzzle, burst, 'heavy');
    fx.explosion(burst, { radius: 4, kind: 'rocket', scale: 0.85 });
    fx.smoke(burst, 0x262422, 2.8, 2.4);
    render.lights.flash(burst, 0xff9838, 12, 24, 0.18);
    audio.play('rocket_explosion', { position: burst, pitch: 1.15, volume: 0.75 });

    const d = burst.distanceTo(player.eye);
    if (d <= FLAK_RADIUS && player.alive) {
      const falloff = 1 - (d / FLAK_RADIUS) * 0.55;
      player.takeDamage({ amount: Math.round(FLAK_DAMAGE * falloff), from: g.center, type: 'explosive', source: 'flak_gun' });
    }
  }

  // ---- ExtraTarget (damage & missile paint) ----------------------------------------------------------------------

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    const g = this.byHandle.get(collider.handle);
    if (!g) return false;
    if (!g.alive) return true;
    const heavy = source.startsWith('frame_') || source === 'sabot' || source === 'autocannon' || source === 'ac130_25mm' || source === 'warthog' || amount >= 45;
    const dealt = heavy ? amount : amount * 0.35;
    this.damage(g, dealt, point);
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, _source: string): boolean {
    const g = this.byHandle.get(collider.handle);
    if (!g) return false;
    if (!g.alive) return true;
    this.damage(g, amount * 1.15, point);
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (spec.team !== 'player') return 0;
    const def = EXPLOSIONS[spec.kind];
    let hit = 0;
    for (const g of this.guns) {
      if (!g.alive) continue;
      const d = Math.max(0, g.center.distanceTo(center) - 2.0);
      if (d > spec.radius) continue;
      const falloff = 1 - (d / spec.radius) * (1 - def.edgeDamage);
      this.damage(g, spec.instakill ? FLAK_GUN_HP : spec.damage * falloff, center);
      hit++;
    }
    return hit;
  }

  paintable(out: MissileTarget[]): void {
    for (const g of this.guns) if (g.alive) out.push(g.target);
  }

  frameBlow(at: THREE.Vector3, radius: number, damage: number): number {
    let hit = 0;
    for (const g of this.guns) {
      if (!g.alive) continue;
      if (g.center.distanceTo(at) <= radius + 2.2) {
        this.damage(g, damage, at);
        hit++;
      }
    }
    return hit;
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    if (!this.active) return;
    for (const g of this.guns) if (g.alive) for (const m of g.meshes) out.push(m);
  }

  private damage(g: FlakGun, amount: number, point: THREE.Vector3): void {
    if (!g.alive || amount <= 0) return;
    const { audio, hud, fx } = this.ctx;
    g.hp = Math.max(0, g.hp - amount);
    fx.chips(point, 0xffaa44, 6);
    if (g.hp > 0) {
      hud.hitMarker('body');
      audio.play('hit_marker', { pitch: 0.9 });
      return;
    }
    this.destroyGun(g);
  }

  private destroyGun(g: FlakGun): void {
    const { audio, campaign, fx, hud, progression, render } = this.ctx;
    g.alive = false;
    g.turret.visible = false;
    g.wreck.visible = true;
    g.unmark?.();
    g.unmark = null;
    fx.explosion(g.center, { radius: 6, kind: 'rocket', scale: 1.6 });
    fx.chips(g.center, 0xff9030, 32);
    fx.embers(g.center, 24, 3);
    render.lights.flash(g.center, 0xffa040, 22, 42, 0.45);
    audio.play('vehicle_explode', { position: g.center, volume: 1 });
    hud.hitMarker('kill');
    audio.play('hit_marker_kill');
    progression.award(450, 'FLAK GUN', g.center);
    const done = 4 - this.aliveCount;
    hud.feed(`FLAK GUN DESTROYED (${done}/4)`, '#ff7a30');
    campaign.signal('flak:gun');
    if (this.aliveCount === 0) {
      // Secondary magazine detonation across the tower top.
      const roof = new THREE.Vector3(20, 25.5, -105);
      fx.explosion(roof, { radius: 10, kind: 'rocket', scale: 2.4 });
      fx.ring(roof, _up, 0xffa040, 12);
      render.lights.flash(roof, 0xffb050, 28, 60, 0.65);
      audio.play('explosion_debris', { position: roof, volume: 1 });
      hud.feed('FLAK TOWER SILENCED — AIRSPACE OPEN', '#7ee787');
      campaign.signal('flak:cleared');
    }
  }

  // ---- Geometry --------------------------------------------------------------------------------------------------

  private build(): void {
    const { physics, render } = this.ctx;
    const mat = this.materials;

    // Shared pedestal, turret housing, twin barrels, and wrecked ruin builders.
    for (let i = 0; i < FLAK_GUNS.length; i++) {
      const [x, y, z] = FLAK_GUNS[i]!;
      const root = new THREE.Group();
      root.position.set(x, y, z);

      // Base ring + bolted mount.
      const baseB = new ModelBuilder()
        .cyl(1.45, 1.65, 0.65, 12, '#2d3135', { at: [0, 0.32, 0] })
        .cyl(1.2, 1.35, 0.25, 12, '#4c3e32', { at: [0, 0.72, 0] });
      root.add(mat.group(baseB));

      // Rotating turret hood with chamfered armour + side ammo hoppers + amber optic.
      const turret = new THREE.Group();
      turret.position.set(0, 0.85, 0);
      const turB = new ModelBuilder()
        .solid(chamferBox(2.2, 1.35, 2.5, 0.14), '#48523f', { at: [0, 0.68, -0.1] })
        .solid(chamferBox(1.75, 0.55, 1.9, 0.1), '#353d30', { at: [0, 1.48, -0.25] })
        .solid(chamferBox(0.45, 0.75, 1.1, 0.06), '#6b533b', { at: [-1.25, 0.65, -0.2] })
        .solid(chamferBox(0.45, 0.75, 1.1, 0.06), '#6b533b', { at: [1.25, 0.65, -0.2] })
        .solid(chamferBox(1.5, 0.3, 0.2, 0.04), '#8a6b28', { at: [0, 0.9, -1.35] })
        .glow(new THREE.BoxGeometry(0.65, 0.14, 0.12), '#ff9c38', 3.2, { at: [0, 1.25, 1.15] });
      turret.add(mat.group(turB));

      // Pitching twin 88 mm barrels with heavy breech & muzzle brakes.
      const barrels = new THREE.Group();
      barrels.position.set(0, 0.85, 0.85);
      const barB = new ModelBuilder()
        .solid(chamferBox(1.15, 0.55, 0.85, 0.08), '#26292e', { at: [0, 0, 0.1] });
      for (const sx of [-0.34, 0.34]) {
        barB
          .cyl(0.14, 0.18, 1.4, 8, '#2d3136', { at: [sx, 0, 1.0], rot: [Math.PI / 2, 0, 0] })
          .cyl(0.10, 0.13, 2.8, 8, '#1e2126', { at: [sx, 0, 3.0], rot: [Math.PI / 2, 0, 0] })
          .cyl(0.16, 0.16, 0.45, 8, '#3d3f44', { at: [sx, 0, 4.45], rot: [Math.PI / 2, 0, 0] });
      }
      barrels.add(mat.group(barB));
      turret.add(barrels);
      root.add(turret);

      // Scorched broken stump shown once destroyed.
      const wreckB = new ModelBuilder()
        .solid(chamferBox(1.8, 0.65, 1.9, 0.08), '#1c1b1a', { at: [0, 1.1, 0], rot: [0.12, 0.2, -0.18] })
        .cyl(0.11, 0.13, 2.1, 6, '#232220', { at: [-0.3, 1.4, 0.8], rot: [1.3, 0.3, -0.4] });
      const wreck = mat.group(wreckB);
      wreck.visible = false;
      root.add(wreck);

      render.scene.add(root);

      const center = new THREE.Vector3(x, y + 1.65, z);
      const collider = physics.addStaticBox(center, new THREE.Vector3(1.65, 1.65, 1.65), null, 'metal');
      const meshes: THREE.Object3D[] = [];
      turret.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });

      const gun: FlakGun = {
        index: i,
        position: new THREE.Vector3(x, y, z),
        center,
        root,
        turret,
        barrels,
        wreck,
        collider,
        meshes,
        target: {
          center,
          get alive() { return gun.alive; },
          aimLift: 0.4,
          paintRadius: 2.4,
        },
        hp: FLAK_GUN_HP,
        alive: true,
        yaw: Math.PI,
        pitch: 0.65,
        recoil: 0,
        fireIn: rand(FIRE_EVERY[0], FIRE_EVERY[1]) + i * 0.55,
        smokeIn: 0,
        unmark: null,
      };
      this.guns.push(gun);
      this.byHandle.set(collider.handle, gun);
    }
  }

  dispose(): void {
    this.vehicles?.removeExtra(this);
    for (const g of this.guns) {
      g.unmark?.();
      this.ctx.physics.world.removeCollider(g.collider, true);
      g.root.removeFromParent();
    }
    this.guns.length = 0;
    this.byHandle.clear();
  }
}
