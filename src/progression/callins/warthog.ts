/**
 * Warthog gun run. Shells before the roar: the 30 mm stream lands first, and the jet's own sound arrives after it has
 * already gone past, like a real A-10.
 */
import * as THREE from 'three';
import type { EmitterHandle } from '../../core/contracts';
import { clamp, rand, smoothstep } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../modelkit';
import { CALLINS, WARTHOG as W } from '../data';
import { GroundStrip } from './ground';
import type { Strike, StrikeKit, StrikeOrder } from './shared';

const _aim = new THREE.Vector3();
const _from = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _look = new THREE.Vector3();
const _side = new THREE.Vector3();
const _flare = new THREE.Vector3();

const ALL_AT = 3.4;
const GONE_AT = 8.8;
const NOSE_OFFSET = 7.6;

/** A-10 from primitives, 17 m long and nose along +Z. The gun is what the plane is built around, so it sticks out. */
export function warthogModel(materials: ModelMaterials): THREE.Group {
  const b = new ModelBuilder();
  const grey = '#59626c';
  const dark = '#3a424b';
  const light = '#79838e';

  // Fuselage: a long tapered tube in four sections.
  b.cyl(0.95, 1.1, 5, 10, grey, { at: [0, 0, 1.5], rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.62, 0.95, 4, 10, grey, { at: [0, 0.1, 5.8], rot: [Math.PI / 2, 0, 0] });
  b.cyl(1.1, 0.62, 5.4, 10, grey, { at: [0, 0.05, -3.5], rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.62, 0.3, 2.4, 10, dark, { at: [0, 0.1, -7.2], rot: [Math.PI / 2, 0, 0] });
  // Cockpit.
  b.solid(new THREE.SphereGeometry(0.62, 8, 6), '#1b232b', { at: [0, 0.82, 4.3], scale: [0.86, 0.72, 1.5] });
  // Nose gun: seven barrels under the chin, offset left as on the real aircraft.
  b.cyl(0.2, 0.26, 1.6, 8, dark, { at: [0.12, -0.28, 7.7], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.cyl(0.035, 0.035, 2.3, 4, '#23282e', { at: [0.12 + Math.cos(a) * 0.13, -0.28 + Math.sin(a) * 0.13, 8.3], rot: [Math.PI / 2, 0, 0] });
  }
  // Long, straight, thick wing.
  for (const s of [1, -1]) {
    b.box(8.4, 0.2, 2.6, grey, { at: [s * 4.6, -0.45, 0.5], rot: [0, 0, s * 0.03] });
    b.box(2.2, 0.17, 1.9, light, { at: [s * 9.6, -0.28, 0.35], rot: [0, s * 0.1, s * 0.14] });
    // Landing-gear pods and pylons full of ordnance.
    b.box(0.52, 0.5, 2.6, dark, { at: [s * 2.6, -0.82, 0.8] });
    for (const x of [4.2, 5.8, 7.4]) {
      b.box(0.1, 0.3, 0.6, dark, { at: [s * x, -0.7, 0.8] });
      b.cyl(0.14, 0.14, 2.3, 6, light, { at: [s * x, -0.98, 0.9], rot: [Math.PI / 2, 0, 0] });
      b.solid(new THREE.ConeGeometry(0.14, 0.4, 6), '#a03018', { at: [s * x, -0.98, 2.25], rot: [Math.PI / 2, 0, 0] });
    }
    // Twin engines high on the rear fuselage: the silhouette that makes it a Warthog.
    b.cyl(0.72, 0.72, 3.1, 12, dark, { at: [s * 1.45, 1.05, -3.2], rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.74, 0.74, 0.3, 12, light, { at: [s * 1.45, 1.05, -1.7], rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.46, 0.62, 0.8, 12, '#1a1e23', { at: [s * 1.45, 1.05, -5.1], rot: [Math.PI / 2, 0, 0] });
    b.box(0.32, 0.55, 2.2, grey, { at: [s * 0.86, 0.68, -3.0], rot: [0, 0, s * 0.45] });
    b.glow(new THREE.CircleGeometry(0.44, 12), '#ff9b4a', 2.4, { at: [s * 1.45, 1.05, -5.5], rot: [0, Math.PI, 0] });
    // Twin tail.
    b.box(0.14, 2.7, 1.8, grey, { at: [s * 2.85, 0.5, -7.5] });
    b.box(0.16, 0.4, 0.7, dark, { at: [s * 2.85, 1.95, -7.9] });
  }
  b.box(6.0, 0.14, 1.6, grey, { at: [0, 0.18, -7.6] });
  // Nav lights keep it readable against a dark sky.
  b.glow(new THREE.SphereGeometry(0.12, 6, 4), '#ff2020', 6, { at: [10.7, -0.13, 0.3] });
  b.glow(new THREE.SphereGeometry(0.12, 6, 4), '#20ff60', 6, { at: [-10.7, -0.13, 0.3] });
  return materials.group(b);
}

export class Warthog implements Strike {
  private t = 0;
  private fired = 0;
  private activated = false;
  private roared = false;
  private flares = 0;
  private readonly center = new THREE.Vector3();
  private readonly heading = new THREE.Vector3();
  private readonly strip: GroundStrip;
  private readonly jet: THREE.Group;
  private readonly trails: EmitterHandle[] = [];
  private readonly ceiling: number;

  constructor(private readonly kit: StrikeKit, order: StrikeOrder) {
    const { ctx, probe } = kit;
    this.center.copy(order.point);
    this.heading.copy(order.heading);
    this.strip = new GroundStrip(ctx, probe);
    this.strip.setColor(CALLINS.warthog.color, 2);
    this.ceiling = probe.headroom(this.center.x, this.center.y + 0.5, this.center.z, W.spawnHeight + 2) - 1.5;
    this.jet = kit.jet;
    this.jet.visible = false;
    ctx.audio.play('walkietalkie_fire');
  }

  update(dt: number): boolean {
    this.t += dt;
    const { audio, fx } = this.kit.ctx;
    if (!this.activated && this.t >= W.activateAt) {
      this.activated = true;
      audio.play('airstrike_activate');
    }

    if (this.t >= ALL_AT && this.t < GONE_AT) this.flyJet();
    else if (this.t >= GONE_AT) this.jet.visible = false;

    while (this.fired < W.shells && this.t >= W.shellsAt + this.fired * W.shellGap) this.shell();

    if (!this.roared && this.t >= W.flybyAt) {
      this.roared = true;
      // Pinned to the corridor and not the jet, so the sound arrives from where the violence was.
      audio.play('warthog_flyby', { volume: 1.6 });
      this.kit.ctx.camera.addTrauma(0.35);
    }

    if (this.t < W.markerUntil) {
      const core = W.scatter / (W.scatter + W.shellRadius);
      this.strip.show(this.center, this.heading, W.length, (W.scatter + W.shellRadius) * 2, core);
      // The original's pulse stops once the run is committed, then the marker just waits.
      this.strip.setOpacity(this.t < W.activateAt ? 0.6 + Math.sin(this.t * 8) * 0.3 : 0.7);
      this.strip.tick(this.t);
    } else {
      this.strip.hide();
    }
    if (this.flares < 6 && this.t > W.jetOverheadAt + 0.4 + this.flares * 0.14) {
      this.flares++;
      _flare.copy(this.jet.position);
      fx.sparks(_flare, _dir.set(0, -1, 0), 8, '#ffd9a0');
    }
    return this.t >= GONE_AT + 0.2;
  }

  private jetPosition(t: number, out: THREE.Vector3): THREE.Vector3 {
    const along = (t - W.jetOverheadAt) * W.jetSpeed;
    // A shallow pass that pulls up hard once it is past, the classic breakaway.
    const climb = along > 0 ? along * along * 0.0011 : along * along * 0.00012;
    return out.copy(this.center).addScaledVector(this.heading, along).setY(this.center.y + W.jetAltitude + climb);
  }

  private flyJet(): void {
    const jet = this.jet;
    if (!jet.visible) {
      jet.visible = true;
      this.startTrails();
    }
    this.jetPosition(this.t, jet.position);
    this.jetPosition(this.t + 0.05, _look);
    jet.lookAt(_look);
    // Bank away after the pass.
    jet.rotateZ(smoothstep(W.jetOverheadAt + 0.2, W.jetOverheadAt + 1.4, this.t) * 0.7);
  }

  private startTrails(): void {
    const { fx } = this.kit.ctx;
    for (const side of [-1.45, 1.45]) {
      this.trails.push(fx.attachEmitter(this.jet, 'smokeTrail', new THREE.Vector3(side, 1.05, -5.6), GONE_AT - ALL_AT));
    }
  }

  private shell(): void {
    const { audio, combat, fx } = this.kit.ctx;
    const i = this.fired++;
    const along = (i / (W.shells - 1) - 0.5) * W.length;
    const across = rand(-W.scatter, W.scatter);
    _aim.copy(this.center).addScaledVector(this.heading, along);
    _side.set(-this.heading.z, 0, this.heading.x);
    _aim.addScaledVector(_side, across);
    const h = this.kit.probe.heightAt(_aim.x, this.center.y + 12, _aim.z, 40);
    if (!Number.isNaN(h)) _aim.y = h;

    const height = clamp(W.spawnHeight, 4, this.ceiling);
    _from.copy(_aim).addScaledVector(this.heading, -W.spawnBack).setY(_aim.y + height);
    _vel.subVectors(_aim, _from).normalize().multiplyScalar(W.shellSpeed);
    combat.spawnProjectile({
      origin: _from, velocity: _vel, kind: 'shell', team: 'player', damage: W.shellDamage, source: 'warthog',
      gravity: 0, lifetime: 1.5, tracer: 'heavy',
      explosion: { radius: W.shellRadius, damage: W.shellDamage, kind: 'shell', selfDamage: 0 },
    });
    audio.play('30mmShell_flyBy', { position: _aim });

    // The stream reads as coming from the aircraft, so every other shell draws back to the gun.
    if (this.jet.visible) {
      this.jet.getWorldDirection(_dir);
      _nose.copy(this.jet.position).addScaledVector(_dir, NOSE_OFFSET);
      fx.muzzleFlash(_nose, _dir, 'autocannon');
      if (i % 2 === 0) fx.tracer(_nose, _from, 'heavy');
    }
  }

  dispose(): void {
    this.strip.dispose();
    this.jet.visible = false;
    for (const t of this.trails) t.stop();
  }
}
