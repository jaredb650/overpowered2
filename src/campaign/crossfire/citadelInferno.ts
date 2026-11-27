/**
 * Unique Finale Spectacle for Crossfire Part 3 ("Fortress Halcyon"):
 * Violent, whole-HQ volcanic napalm firestorm erupting out of General Halvorsen's cracked
 * Tier-3 Citadel Command HQ (`HALCYON_CITADEL_HQ_POS = [0, 0, -30]`) when BLU-27 Napalm hits.
 *
 * Combines:
 *   - Towering multi-layer volumetric 3D flame columns visible from 120 m bomber altitude
 *   - 10 pressurized perimeter fire geysers blowing out of every corner buttress & wall vent
 *   - Molten napalm ground fire sea blanketing the entire 36 m x 31 m HQ plaza
 *   - 12 staggered secondary magazine/vault cook-off fireballs, hellfire debris & shockwave rings
 *   - Continuous skyward flame jets, ember showers, black funeral-pyre smoke, thermal flashes & rumble
 */
import * as THREE from 'three';
import type { Ctx, ExplosionKind } from '../../core/contracts';
import { clamp, rand } from '../../core/math';

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();

interface FlamePlumePart {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseOpacity: number;
  baseScaleY: number;
  baseScaleXZ: number;
  phase: number;
  speed: number;
  spinSpeed: number;
}

interface PendingCookoff {
  offset: readonly [number, number, number];
  delay: number;
  radius: number;
  scale: number;
  kind: ExplosionKind;
  ring: boolean;
}

const VENT_OFFSETS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  // [dx, y, dz, height, tiltRad] — rings the entire 36 m x 31 m Tier-1 & Tier-2 HQ structure
  [-17.2, 3.5, -14.5, 38, 0.24],
  [0, 4.0, -15.5, 44, 0.18],
  [17.2, 3.5, -14.5, 38, 0.24],
  [-18.0, 3.5, 0, 42, 0.22],
  [18.0, 3.5, 0, 42, 0.22],
  [-17.2, 3.5, 14.5, 38, 0.24],
  [0, 4.0, 15.5, 44, 0.18],
  [17.2, 3.5, 14.5, 38, 0.24],
  [-10.5, 10.5, -6.0, 48, 0.14],
  [10.5, 10.5, 6.0, 48, 0.14],
];

const STAGGERED_COOKOFFS: readonly PendingCookoff[] = [
  { offset: [0, 6, 0], delay: 0.22, radius: 30, scale: 3.4, kind: 'thermobaric', ring: true },
  { offset: [-15, 5, -12], delay: 0.55, radius: 22, scale: 2.6, kind: 'barrel', ring: false },
  { offset: [15, 5, 12], delay: 0.90, radius: 22, scale: 2.6, kind: 'barrel', ring: false },
  { offset: [14, 10, -11], delay: 1.35, radius: 24, scale: 2.8, kind: 'barrel', ring: true },
  { offset: [-14, 10, 11], delay: 1.80, radius: 24, scale: 2.8, kind: 'barrel', ring: false },
  { offset: [0, 16, -6], delay: 2.35, radius: 28, scale: 3.2, kind: 'thermobaric', ring: true },
  { offset: [-17, 4, 0], delay: 2.95, radius: 20, scale: 2.4, kind: 'barrel', ring: false },
  { offset: [17, 4, 0], delay: 3.55, radius: 20, scale: 2.4, kind: 'barrel', ring: false },
  { offset: [0, 17, 7], delay: 4.20, radius: 26, scale: 3.0, kind: 'barrel', ring: true },
  { offset: [-9, 12, -9], delay: 5.05, radius: 22, scale: 2.5, kind: 'barrel', ring: false },
  { offset: [9, 12, 9], delay: 5.95, radius: 22, scale: 2.5, kind: 'barrel', ring: false },
  { offset: [0, 10, 0], delay: 7.00, radius: 34, scale: 3.6, kind: 'thermobaric', ring: true },
];

export class CitadelInfernoSpectacle {
  private root: THREE.Group | null = null;
  private readonly plumes: FlamePlumePart[] = [];
  private readonly groundPools: { mat: THREE.MeshBasicMaterial; baseOpacity: number; mesh: THREE.Mesh }[] = [];
  private crownBall: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } | null = null;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private readonly center = new THREE.Vector3();
  private readonly queue: PendingCookoff[] = [];
  private _active = false;
  private elapsed = 0;
  private jetCd = 0;
  private smokeCd = 0;
  private lightCd = 0;
  private roarCd = 0;
  private ventCursor = 0;
  private cookoffsFired = 0;

  constructor(private readonly ctx: Ctx) {}

  get active(): boolean {
    return this._active;
  }

  get totalCookoffsFired(): number {
    return this.cookoffsFired;
  }

  /** Ignites the violent whole-HQ inferno at `center` (Citadel Command HQ world center). */
  ignite(center: THREE.Vector3): void {
    this.clear();
    this._active = true;
    this.elapsed = 0;
    this.jetCd = 0;
    this.smokeCd = 0;
    this.lightCd = 0;
    this.roarCd = 0.85;
    this.ventCursor = 0;
    this.cookoffsFired = 0;
    this.center.set(center.x, 0, center.z);
    this.queue.push(...STAGGERED_COOKOFFS);

    // 1. Blow apart remaining Citadel HQ concrete tiers from the inside out
    const blastCenter = _pos.set(this.center.x, 5, this.center.z);
    this.ctx.world?.objects?.destruction?.blast?.(blastCenter, 48, 8000, 'ac130_bomb');

    // 2. Blinding ignition detonation, dual firestorm shockwave rings, hellfire debris & bomber-felt trauma
    this.ctx.fx?.explosion?.(new THREE.Vector3(this.center.x, 6, this.center.z), {
      radius: 42,
      scale: 4.2,
      kind: 'thermobaric',
    });
    this.ctx.fx?.ring?.(new THREE.Vector3(this.center.x, 2.0, this.center.z), _up, 0xff5a14, 66);
    this.ctx.fx?.ring?.(new THREE.Vector3(this.center.x, 12.0, this.center.z), _up, 0xffb833, 44);
    this.ctx.fx?.chips?.(new THREE.Vector3(this.center.x, 8.0, this.center.z), 0xff6b1a, 78, true);
    this.ctx.fx?.embers?.(new THREE.Vector3(this.center.x, 12.0, this.center.z), 90, 28);
    this.ctx.fx?.heatShimmer?.(new THREE.Vector3(this.center.x, 10.0, this.center.z), 34, 4.5);

    this.ctx.render?.post?.flash?.(0xff6b1a, 0.72, 0.65);
    this.ctx.render?.lights?.flash?.(new THREE.Vector3(this.center.x, 18, this.center.z), 0xff6218, 44, 240, 1.4);
    this.ctx.camera?.addTrauma?.(0.95);

    // 3. Layered roaring inferno audio
    this.ctx.audio?.play?.('flame_ignite', { position: blastCenter, volume: 1.0, pitch: 0.62 });
    this.ctx.audio?.play?.('flame_splash', { position: blastCenter, volume: 0.96, pitch: 0.70 });
    this.ctx.audio?.play?.('explosion_tank', { position: blastCenter, volume: 1.0, pitch: 0.60 });
    this.ctx.audio?.play?.('rocket_explosion', { position: blastCenter, volume: 0.98, pitch: 0.56 });

    // 4. Construct towering 3D volumetric inferno rig across the entire HQ footprint
    this.buildVolumetricRig();
  }

  private addFlameCone(
    parent: THREE.Object3D,
    radiusBottom: number,
    radiusTop: number,
    height: number,
    color: number,
    opacity: number,
    x: number,
    y: number,
    z: number,
    phase: number,
    speed: number,
    spinSpeed: number,
    tiltX = 0,
    tiltZ = 0,
  ): void {
    const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 10, 1, true);
    geo.translate(0, height * 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(tiltX, phase, tiltZ);
    parent.add(mesh);

    this.geometries.push(geo);
    this.materials.push(mat);
    this.plumes.push({
      mesh,
      mat,
      baseOpacity: opacity,
      baseScaleY: 1,
      baseScaleXZ: 1,
      phase,
      speed,
      spinSpeed,
    });
  }

  private buildVolumetricRig(): void {
    const scene = this.ctx.render?.scene;
    if (!scene) return;

    const root = new THREE.Group();
    root.name = 'halcyon.citadel.inferno';
    root.position.copy(this.center);

    // Central vault volcanic flame spire (3 counter-rotating additive shells towering up to 84 m!)
    this.addFlameCone(root, 7.2, 2.0, 56, 0xfff0a8, 0.88, 0, 1.0, 0, 0.2, 9.5, 1.8);
    this.addFlameCone(root, 12.2, 3.6, 72, 0xff6e1a, 0.72, 0, 0.6, 0, 1.7, 7.4, -1.3);
    this.addFlameCone(root, 17.0, 5.4, 84, 0xc8240a, 0.48, 0, 0.4, 0, 3.3, 5.8, 0.9);

    // 10 pressurized perimeter flame geysers erupting out of every buttress, wall & command-deck corner
    for (let i = 0; i < VENT_OFFSETS.length; i++) {
      const [dx, y, dz, h, tilt] = VENT_OFFSETS[i]!;
      const len = Math.max(1, Math.hypot(dx, dz));
      const nx = dx / len;
      const nz = dz / len;
      const tiltX = nz * tilt;
      const tiltZ = -nx * tilt;
      // Outer blazing orange flame tongue
      this.addFlameCone(root, 4.4, 1.1, h, 0xff5a12, 0.68, dx, y, dz, i * 0.9, 8.2 + (i % 3) * 1.4, (i % 2 === 0 ? 1 : -1) * 1.5, tiltX, tiltZ);
      // Inner white-gold core jet
      this.addFlameCone(root, 2.2, 0.45, h * 0.68, 0xffdf7a, 0.78, dx, y, dz, i * 1.3 + 0.5, 10.6, (i % 2 === 0 ? -1 : 1) * 2.1, tiltX, tiltZ);
    }

    // Scorching molten napalm ground fire sea blanketing the entire HQ plaza
    const outerPoolGeo = new THREE.CircleGeometry(28.5, 24);
    outerPoolGeo.rotateX(-Math.PI / 2);
    const outerPoolMat = new THREE.MeshBasicMaterial({
      color: 0xe6380a,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const outerPool = new THREE.Mesh(outerPoolGeo, outerPoolMat);
    outerPool.position.y = 0.28;
    root.add(outerPool);
    this.geometries.push(outerPoolGeo);
    this.materials.push(outerPoolMat);
    this.groundPools.push({ mesh: outerPool, mat: outerPoolMat, baseOpacity: 0.62 });

    const innerPoolGeo = new THREE.CircleGeometry(19.5, 24);
    innerPoolGeo.rotateX(-Math.PI / 2);
    const innerPoolMat = new THREE.MeshBasicMaterial({
      color: 0xffa62b,
      transparent: true,
      opacity: 0.74,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerPool = new THREE.Mesh(innerPoolGeo, innerPoolMat);
    innerPool.position.y = 0.42;
    root.add(innerPool);
    this.geometries.push(innerPoolGeo);
    this.materials.push(innerPoolMat);
    this.groundPools.push({ mesh: innerPool, mat: innerPoolMat, baseOpacity: 0.74 });

    // Rising billowing fireball crown bursting upward from the cracked concrete roof
    const crownGeo = new THREE.IcosahedronGeometry(9.5, 1);
    const crownMat = new THREE.MeshBasicMaterial({
      color: 0xff7b1f,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const crownMesh = new THREE.Mesh(crownGeo, crownMat);
    crownMesh.position.set(0, 8, 0);
    root.add(crownMesh);
    this.geometries.push(crownGeo);
    this.materials.push(crownMat);
    this.crownBall = { mesh: crownMesh, mat: crownMat };

    scene.add(root);
    this.root = root;
  }

  update(dt: number): void {
    if (!this._active || dt <= 0) return;
    this.elapsed += dt;

    // 1. Fire staggered secondary vault/buttress cook-off explosions across the HQ
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const ev = this.queue[i]!;
      if (this.elapsed < ev.delay) continue;
      this.queue.splice(i, 1);
      this.cookoffsFired++;

      const p = new THREE.Vector3(
        this.center.x + ev.offset[0],
        ev.offset[1],
        this.center.z + ev.offset[2],
      );
      this.ctx.fx?.explosion?.(p, { radius: ev.radius, scale: ev.scale, kind: ev.kind });
      this.ctx.fx?.chips?.(p, 0xff6e18, 36, true);
      if (ev.ring) {
        this.ctx.fx?.ring?.(p, _up, 0xff7a22, ev.radius * 1.45);
      }
      this.ctx.render?.lights?.flash?.(p, 0xff5e14, 34, 190, 0.55);
      this.ctx.camera?.addTrauma?.(ev.kind === 'thermobaric' ? 0.55 : 0.28);
      this.ctx.audio?.play?.(ev.kind === 'thermobaric' ? 'explosion_tank' : 'rocket_explosion', {
        position: p,
        volume: 0.94,
        pitch: rand(0.56, 0.78),
      });
    }

    // 2. Animate towering 3D flame plumes: violent 0.55s explosive surge -> raging firestorm -> sustained pyre
    const surge = clamp(this.elapsed / 0.55, 0.16, 1.0);
    const surgeOvershoot = this.elapsed < 1.2 ? 1 + Math.sin(clamp(this.elapsed / 1.2, 0, 1) * Math.PI) * 0.28 : 1.0;
    const sustain = this.elapsed < 11.0 ? 1.0 : clamp(1.0 - (this.elapsed - 11.0) * 0.045, 0.55, 1.0);

    for (let i = 0; i < this.plumes.length; i++) {
      const p = this.plumes[i]!;
      const waveA = Math.sin(this.elapsed * p.speed + p.phase);
      const waveB = Math.cos(this.elapsed * (p.speed * 1.63) + p.phase * 1.7);
      const yScale = surge * surgeOvershoot * sustain * (0.86 + waveA * 0.22 + waveB * 0.12);
      const xzScale = surge * (0.90 + waveB * 0.18) * (0.85 + sustain * 0.15);
      p.mesh.scale.set(xzScale * p.baseScaleXZ, Math.max(0.2, yScale * p.baseScaleY), xzScale * p.baseScaleXZ);
      p.mesh.rotation.y += p.spinSpeed * dt;
      p.mat.opacity = clamp(p.baseOpacity * sustain * (0.82 + waveA * 0.18), 0.15, 0.96);
    }

    for (let i = 0; i < this.groundPools.length; i++) {
      const pool = this.groundPools[i]!;
      const pulse = 0.94 + Math.sin(this.elapsed * (6.2 + i * 2.5)) * 0.08;
      const expand = clamp(0.3 + this.elapsed * 1.4, 0.3, 1.08);
      pool.mesh.scale.set(expand * pulse, 1, expand * pulse);
      pool.mat.opacity = clamp(pool.baseOpacity * sustain * pulse, 0.2, 0.9);
    }

    // Rising mushrooming fireball crown over first 4.2 seconds
    if (this.crownBall) {
      const ct = clamp(this.elapsed / 4.2, 0, 1);
      if (ct >= 1) {
        this.crownBall.mesh.visible = false;
      } else {
        const easeOut = 1 - (1 - ct) * (1 - ct);
        this.crownBall.mesh.position.y = 8 + easeOut * 66;
        const s = 0.8 + easeOut * 2.6;
        this.crownBall.mesh.scale.set(s * 1.15, s * 0.88, s * 1.15);
        this.crownBall.mesh.rotation.y += dt * 1.4;
        this.crownBall.mesh.rotation.x += dt * 0.7;
        this.crownBall.mat.opacity = clamp((1 - ct) * 0.88, 0, 0.88);
      }
    }

    // 3. Continuous skyward flame jets, napalm ground pools & splashes across HQ vents
    this.jetCd -= dt;
    if (this.jetCd <= 0) {
      this.jetCd = 0.09;
      const vent = VENT_OFFSETS[this.ventCursor % VENT_OFFSETS.length]!;
      this.ventCursor++;
      const vp = _pos.set(this.center.x + vent[0] + rand(-2, 2), vent[1], this.center.z + vent[2] + rand(-2, 2));
      _dir.set(rand(-0.22, 0.22), 1, rand(-0.22, 0.22)).normalize();
      this.ctx.fx?.flame?.(vp, _dir, 10);

      const gp = new THREE.Vector3(this.center.x + rand(-18, 18), 0.2, this.center.z + rand(-15, 15));
      this.ctx.fx?.napalm?.(gp, _up, 11, sustain);
      if (this.ventCursor % 2 === 0) {
        this.ctx.fx?.napalmSplash?.(gp, _up);
      }
    }

    // 4. Continuous ember storm & towering dark funeral-pyre smoke column
    this.smokeCd -= dt;
    if (this.smokeCd <= 0) {
      this.smokeCd = 0.18;
      const smokePos = new THREE.Vector3(this.center.x + rand(-12, 12), rand(14, 38), this.center.z + rand(-10, 10));
      this.ctx.fx?.smoke?.(smokePos, '#1b1411', 12.0, 5.2);
      const emberPos = new THREE.Vector3(this.center.x + rand(-16, 16), rand(6, 26), this.center.z + rand(-14, 14));
      this.ctx.fx?.embers?.(emberPos, 24, 24);
    }

    // 5. Pulsing orange-red blaze light washing over the entire Citadel plaza
    this.lightCd -= dt;
    if (this.lightCd <= 0) {
      this.lightCd = 0.24;
      const lp = new THREE.Vector3(this.center.x + rand(-8, 8), rand(14, 26), this.center.z + rand(-8, 8));
      this.ctx.render?.lights?.flash?.(lp, 0xff5a12, 34 * sustain, 195, 0.32);
    }

    // 6. Periodic deep roaring flame audio bursts while HQ burns
    this.roarCd -= dt;
    if (this.roarCd <= 0 && this.elapsed < 12) {
      this.roarCd = rand(1.15, 1.75);
      const ap = new THREE.Vector3(this.center.x, 10, this.center.z);
      this.ctx.audio?.play?.('flame_ignite', { position: ap, volume: 0.78 * sustain, pitch: rand(0.58, 0.76) });
    }
  }

  clear(): void {
    this._active = false;
    this.elapsed = 0;
    this.queue.length = 0;
    this.plumes.length = 0;
    this.groundPools.length = 0;
    this.crownBall = null;
    this.cookoffsFired = 0;
    if (this.root) {
      this.ctx.render?.scene?.remove(this.root);
      this.root = null;
    }
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
  }

  dispose(): void {
    this.clear();
  }
}
