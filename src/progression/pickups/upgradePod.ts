/**
 * Airdrop 105mm Howitzer Upgrade Pod: falls from orbit in the same 3-petal armoured drop-pod silhouette as
 * `pods.ts`, slams down with dust/sparks/shake, opens its petals to reveal a gold-lit 105mm Howitzer barrel
 * module, and installs onto the Distraint Frame via a press-and-hold `E` interaction (reachable from inside
 * the Frame within 9.5 m or on foot within 5 m).
 */
import * as THREE from 'three';
import type { Ctx, EmitterHandle } from '../../core/contracts';
import { clamp, lerp, rand, smoothstep, TAU } from '../../core/math';
import { GroundProbe, GroundRing } from '../callins/ground';
import { ModelBuilder, ModelMaterials } from '../modelkit';

export type UpgradePodPhase = 'idle' | 'warning' | 'falling' | 'opening' | 'open' | 'installed';

export interface UpgradePodOptions {
  /** Waypoint label shown on the HUD. Defaults to `'105MM HOWITZER POD'`. */
  label?: string;
  /** Seconds the player must hold `interact` (`E`) to complete installation. Defaults to `1.4`. */
  holdSeconds?: number;
  /** Invoked once installation reaches 100%. */
  onInstalled?: () => void;
}

export const UPGRADE_POD = {
  color: '#ffb400',
  gold: '#ffd447',
  defaultLabel: '105MM HOWITZER POD',
  warnSeconds: 1.2,
  dropHeight: 110,
  dropSpeed: 135,
  openDelay: 0.22,
  openSeconds: 1.05,
  doorOpenAngle: 1.5,
  impactRadius: 6.5,
  beaconHeight: 74,
  frameReach: 9.5,
  footReach: 5.0,
  defaultHoldSeconds: 1.4,
  tickInterval: 0.28,
} as const;

const DOOR_ANGLES: readonly number[] = [0, TAU / 3, (2 * TAU) / 3];
const _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();

function hullBuilder(): ModelBuilder {
  const b = new ModelBuilder();
  const steel = '#4a535d';
  const dark = '#262b31';
  const burnt = '#1a1715';
  const trim = '#8f6a20';
  // Three-sided armoured drop-pod column on a heavy retro-thruster skirt.
  b.cyl(1.08, 1.55, 0.62, 6, burnt, { at: [0, 0.31, 0] });
  b.cyl(0.54, 0.62, 0.45, 6, dark, { at: [0, 0.72, 0] });
  b.cyl(0.28, 1.18, 1.05, 6, steel, { at: [0, 4.18, 0] });
  b.cyl(0.16, 0.16, 0.62, 6, dark, { at: [0, 4.98, 0] });
  b.cyl(0.86, 0.86, 0.16, 6, trim, { at: [0, 3.64, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 6;
    b.box(0.16, 2.05, 0.92, steel, { at: [Math.cos(a) * 1.32, 1.02, Math.sin(a) * 1.32], rot: [0, -a, 0] });
    b.box(0.26, 0.32, 0.44, burnt, { at: [Math.cos(a) * 1.48, 0.16, Math.sin(a) * 1.48], rot: [0, -a, 0] });
    b.glow(new THREE.BoxGeometry(0.035, 1.65, 0.06), UPGRADE_POD.color, 3.2, {
      at: [Math.cos(a) * 1.41, 1.05, Math.sin(a) * 1.41],
      rot: [0, -a, 0],
    });
  }
  // Base mounting ring under the payload.
  b.glow(new THREE.CylinderGeometry(0.74, 0.78, 0.08, 12), UPGRADE_POD.gold, 3.4, { at: [0, 0.94, 0] });
  return b;
}

function doorBuilder(): ModelBuilder {
  const b = new ModelBuilder();
  // Hinged at its base so all three doors fall open like heavy petals on impact.
  b.box(1.1, 3.05, 0.13, '#59636e', { at: [0, 1.52, 0] });
  b.box(0.88, 2.62, 0.045, '#333a42', { at: [0, 1.52, 0.08] });
  b.box(0.94, 0.1, 0.15, '#9d7624', { at: [0, 2.92, 0] });
  b.glow(new THREE.BoxGeometry(0.56, 0.06, 0.025), UPGRADE_POD.color, 3.4, { at: [0, 2.52, 0.105] });
  b.glow(new THREE.BoxGeometry(0.42, 0.05, 0.025), UPGRADE_POD.gold, 2.6, { at: [0, 0.55, 0.105] });
  return b;
}

function howitzerModuleBuilder(): ModelBuilder {
  const b = new ModelBuilder();
  const gunmetal = '#2a2f36';
  const armor = '#474f59';
  const brass = '#b88928';
  // Heavy 105mm armored breech housing & Frame shoulder-adapter cradle.
  b.box(0.84, 0.56, 0.96, armor, { at: [0, 0.36, -0.08] });
  b.box(0.68, 0.36, 0.78, gunmetal, { at: [0, 0.68, -0.1] });
  b.box(0.94, 0.16, 0.62, brass, { at: [0, 0.24, -0.05] });
  // Twin hydraulic recoil recuperator cylinders flanking the barrel.
  for (const sx of [-0.28, 0.28]) {
    b.cyl(0.085, 0.095, 1.15, 8, '#626b75', { at: [sx, 0.72, 0.32], rot: [1.18, 0, 0] });
  }
  // Thick 105mm rifled cannon barrel tilted upward inside the open bay + slotted muzzle brake.
  b.cyl(0.18, 0.22, 0.85, 10, gunmetal, { at: [0, 0.84, 0.16], rot: [1.18, 0, 0] });
  b.cyl(0.145, 0.175, 1.45, 10, '#1f2329', { at: [0, 1.24, 0.62], rot: [1.18, 0, 0] });
  b.cyl(0.21, 0.21, 0.36, 10, '#5a4e3c', { at: [0, 1.56, 0.99], rot: [1.18, 0, 0] });
  // Glowing gold energy bands & optical interlocks signalling an active ordnance upgrade.
  b.glow(new THREE.BoxGeometry(0.88, 0.06, 0.98), UPGRADE_POD.gold, 4.2, { at: [0, 0.52, -0.08] });
  b.glow(new THREE.CylinderGeometry(0.195, 0.195, 0.12, 12), UPGRADE_POD.gold, 4.6, { at: [0, 1.05, 0.4], rot: [1.18, 0, 0] });
  b.glow(new THREE.CylinderGeometry(0.165, 0.165, 0.09, 12), UPGRADE_POD.color, 4.0, { at: [0, 1.4, 0.8], rot: [1.18, 0, 0] });
  return b;
}

export class UpgradePod {
  readonly position = new THREE.Vector3();
  private readonly group: THREE.Group;
  private readonly doors: THREE.Group[] = [];
  private readonly payload: THREE.Group;
  private readonly beacon: THREE.Mesh;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly ring: GroundRing;
  private readonly probe: GroundProbe | null;

  private _phase: UpgradePodPhase = 'idle';
  private timer = 0;
  private pulseClock = 0;
  private label: string = UPGRADE_POD.defaultLabel;
  private holdSeconds: number = UPGRADE_POD.defaultHoldSeconds;
  private onInstalled: (() => void) | null = null;
  private holdProgress = 0;
  private tickClock = 0;
  private near = false;
  private openSoundPlayed = false;

  private trail: EmitterHandle | null = null;
  private marker: (() => void) | null = null;
  private unprompt: (() => void) | null = null;

  constructor(private readonly ctx: Ctx, materials?: ModelMaterials) {
    const mats = materials ?? new ModelMaterials(ctx);
    this.probe = ctx.physics?.R?.Ray ? new GroundProbe(ctx) : null;
    this.ring = new GroundRing(ctx);
    this.ring.setColor(UPGRADE_POD.color, 2.2);

    this.group = mats.group(hullBuilder());
    this.group.visible = false;

    for (const angle of DOOR_ANGLES) {
      const pivot = new THREE.Group();
      pivot.rotation.y = angle;
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.46, 0.84);
      hinge.add(mats.group(doorBuilder()));
      pivot.add(hinge);
      this.group.add(pivot);
      this.doors.push(hinge);
    }

    this.payload = mats.group(howitzerModuleBuilder());
    this.payload.position.set(0, 0.96, 0);
    this.group.add(this.payload);

    this.beaconMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(UPGRADE_POD.color).multiplyScalar(2.6),
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.68, UPGRADE_POD.beaconHeight, 10, 1, true),
      this.beaconMat,
    );
    this.beacon.visible = false;

    ctx.render.scene.add(this.group);
    ctx.render.scene.add(this.beacon);
  }

  /** True while the pod is inbound, landing, opening, or waiting to be installed. */
  get active(): boolean {
    return this._phase !== 'idle' && this._phase !== 'installed';
  }

  /** True once the player has completed the hold-to-install sequence. */
  get installed(): boolean {
    return this._phase === 'installed';
  }

  /** Current drop-pod lifecycle phase. */
  get phase(): UpgradePodPhase {
    return this._phase;
  }

  /** Current hold-to-install completion ratio (0..1). */
  get progress(): number {
    return this.holdProgress;
  }

  /** Current petal door opening angle in radians. */
  get doorAngle(): number {
    return this.doors[0]?.rotation.x ?? 0;
  }

  /** Calls the 105mm Howitzer upgrade pod down onto `pos`. */
  drop(pos: THREE.Vector3, opts?: UpgradePodOptions): void {
    this.clearTransient();
    this.label = opts?.label ?? UPGRADE_POD.defaultLabel;
    this.holdSeconds = Math.max(0.1, opts?.holdSeconds ?? UPGRADE_POD.defaultHoldSeconds);
    this.onInstalled = opts?.onInstalled ?? null;
    this.holdProgress = 0;
    this.tickClock = 0;
    this.near = false;
    this.openSoundPlayed = false;

    this.position.copy(pos);
    if (this.probe) {
      const floor = this.probe.heightAt(pos.x, pos.y + 4, pos.z, 40);
      if (!Number.isNaN(floor)) this.position.y = floor;
    }

    this._phase = 'warning';
    this.timer = 0;
    this.group.visible = false;
    this.payload.visible = true;
    this.payload.position.set(0, 0.96, 0);
    this.payload.rotation.set(0, 0, 0);
    for (const d of this.doors) d.rotation.x = 0;

    this.beacon.position.set(this.position.x, this.position.y + UPGRADE_POD.beaconHeight / 2 + 1, this.position.z);
    this.beacon.visible = true;

    this.ring.setColor(UPGRADE_POD.color, 2.2);
    this.ring.show(this.position, UPGRADE_POD.impactRadius);

    this.marker = this.ctx.hud.marker(
      _p.copy(this.position).setY(this.position.y + 3.2),
      this.label,
      UPGRADE_POD.color,
    );
    this.ctx.audio.play('cache_incoming', { position: this.position });
    this.ctx.hud.feed(`${this.label} INBOUND`, UPGRADE_POD.color);
  }

  update(dt: number): void {
    if (this._phase === 'idle' || this._phase === 'installed') return;
    this.pulseClock += dt;
    this.timer += dt;

    switch (this._phase) {
      case 'warning':
        this.ring.show(this.position, UPGRADE_POD.impactRadius);
        this.ring.setOpacity(0.6 + Math.sin(this.timer * 10) * 0.3);
        this.ring.tick(this.timer);
        this.beaconMat.opacity = 0.28 + Math.sin(this.pulseClock * 7) * 0.1;
        if (this.timer >= UPGRADE_POD.warnSeconds) this.startFall();
        break;

      case 'falling': {
        const fallDuration = UPGRADE_POD.dropHeight / UPGRADE_POD.dropSpeed;
        const frac = Math.min(1, this.timer / fallDuration);
        const y = lerp(this.position.y + UPGRADE_POD.dropHeight, this.position.y, frac);
        this.group.position.set(this.position.x, y, this.position.z);
        this.ring.show(this.position, UPGRADE_POD.impactRadius);
        this.ring.setOpacity(0.95);
        this.ring.tick(this.timer);
        if (this.timer >= fallDuration) this.land();
        break;
      }

      case 'opening': {
        const open = smoothstep(UPGRADE_POD.openDelay, UPGRADE_POD.openSeconds, this.timer);
        const swing = open * UPGRADE_POD.doorOpenAngle + Math.sin(open * Math.PI) * 0.14;
        for (const d of this.doors) d.rotation.x = swing;
        if (!this.openSoundPlayed && this.timer >= UPGRADE_POD.openDelay) {
          this.openSoundPlayed = true;
          this.ctx.audio.play('cache_open', { position: this.position });
        }
        if (this.timer >= UPGRADE_POD.openSeconds) {
          for (const d of this.doors) d.rotation.x = UPGRADE_POD.doorOpenAngle;
          this._phase = 'open';
          this.timer = 0;
        }
        break;
      }

      case 'open':
        this.updateOpen(dt);
        break;
    }
  }

  private startFall(): void {
    this._phase = 'falling';
    this.timer = 0;
    this.group.visible = true;
    for (const d of this.doors) d.rotation.x = 0;
    this.group.rotation.y = rand(0, TAU);
    this.group.position.set(this.position.x, this.position.y + UPGRADE_POD.dropHeight, this.position.z);
    const fallDuration = UPGRADE_POD.dropHeight / UPGRADE_POD.dropSpeed;
    this.trail = this.ctx.fx.attachEmitter(this.group, 'hellfireTrail', new THREE.Vector3(0, 0.25, 0), fallDuration + 0.2);
    this.ctx.audio.play('missile_incoming', { position: this.position });
  }

  private land(): void {
    const { audio, camera, fx, player, render } = this.ctx;
    this._phase = 'opening';
    this.timer = 0;
    this.group.position.copy(this.position);
    this.ring.hide();
    this.trail?.stop();
    this.trail = null;

    audio.play('explosion_debris', { position: this.position, volume: 0.95 });
    audio.play('cache_land', { position: this.position, volume: 0.9 });
    fx.dust(this.position, _up, 4.4);
    fx.sparks(this.position, _up, 28, UPGRADE_POD.gold);
    fx.ring(this.position, _up, UPGRADE_POD.color, UPGRADE_POD.impactRadius * 2.1);
    fx.slam?.(this.position, 0.85);
    render.lights.flash(_p.copy(this.position).setY(this.position.y + 1.8), UPGRADE_POD.gold, 24, 34, 0.45);
    render.decals?.add('crack', this.position, _up, UPGRADE_POD.impactRadius * 1.15, rand(0, TAU));

    const d = player.position.distanceTo(this.position);
    camera.addTrauma(Math.max(0.1, 0.72 - d / 95));
  }

  private isInReach(): boolean {
    const { player } = this.ctx;
    if (!player.alive) return false;
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const dy = Math.abs(player.position.y - this.position.y);
    const horiz = Math.hypot(dx, dz);
    if (player.parked) {
      // Inside the Distraint Frame: cockpit sits ~3.5 m above feet, generous 9.5 m reach.
      return horiz <= UPGRADE_POD.frameReach && dy <= 8.5;
    }
    return horiz <= UPGRADE_POD.footReach && dy <= 4.0;
  }

  private updateOpen(dt: number): void {
    const { audio, fx, hud, input, render } = this.ctx;

    // Gentle hover & golden glow pulse on the exposed 105mm Howitzer module.
    this.payload.position.y = 0.96 + Math.sin(this.pulseClock * 3.2) * 0.09;
    this.payload.rotation.y += dt * 0.65;
    this.beaconMat.opacity = 0.24 + Math.sin(this.pulseClock * 5) * 0.08;
    render.lights.flash(_p.copy(this.position).setY(this.position.y + 2.1), UPGRADE_POD.gold, 7, 14, 0.1);

    const inReach = this.isInReach();
    if (inReach !== this.near) {
      this.near = inReach;
      this.clearPrompt();
      if (inReach) {
        const key = (typeof input.labelFor === 'function' ? input.labelFor('interact') : '') || 'E';
        const text = `HOLD [${key}] — INSTALL 105MM HOWITZER`;
        this.unprompt = hud.follow(_p.copy(this.position).setY(this.position.y + 2.5).clone(), text, UPGRADE_POD.gold);
      }
    }

    if (inReach && input.isDown('interact')) {
      this.holdProgress = clamp(this.holdProgress + dt / this.holdSeconds, 0, 1);
      hud.hold?.(this.holdProgress);
      this.tickClock += dt;
      if (this.tickClock >= UPGRADE_POD.tickInterval) {
        this.tickClock -= UPGRADE_POD.tickInterval;
        const pitch = 0.92 + this.holdProgress * 0.55;
        audio.play('metal_clang', { position: this.position, pitch, volume: 0.45 });
        audio.play('metal_groan', { position: this.position, pitch: 1.25 + this.holdProgress * 0.35, volume: 0.32 });
        _dir.set(rand(-0.5, 0.5), 1, rand(-0.5, 0.5)).normalize();
        fx.sparks(_p.copy(this.position).setY(this.position.y + 1.5), _dir, 10, UPGRADE_POD.gold);
      }
      if (this.holdProgress >= 1) {
        this.completeInstall();
      }
    } else if (this.holdProgress > 0) {
      this.holdProgress = 0;
      this.tickClock = 0;
    }
  }

  private completeInstall(): void {
    const { audio, campaign, fx, hud, render } = this.ctx;
    this._phase = 'installed';
    this.holdProgress = 1;
    this.near = false;
    this.payload.visible = false;
    this.beacon.visible = false;
    this.clearPrompt();
    this.clearMarker();

    const p = _p.copy(this.position).setY(this.position.y + 1.6);
    hud.hold?.(1);
    fx.sparks(p, _up, 42, UPGRADE_POD.gold);
    fx.pickupSparkle?.(p, UPGRADE_POD.gold);
    fx.ring(p, _up, UPGRADE_POD.color, 9);
    render.lights.flash(p, UPGRADE_POD.gold, 28, 30, 0.45);
    render.post?.flash(UPGRADE_POD.color, 0.32, 0.28);
    audio.play('weapon_unlock');
    audio.play('metal_clang', { position: this.position, pitch: 0.72, volume: 0.95 });

    hud.feed('105MM HOWITZER MODULE INSTALLED', UPGRADE_POD.gold);
    hud.callout?.('105MM HOWITZER MODULE INSTALLED');

    const cb = this.onInstalled;
    this.onInstalled = null;
    cb?.();
    campaign?.signal?.('upgrade:howitzer');
  }

  private clearPrompt(): void {
    this.unprompt?.();
    this.unprompt = null;
  }

  private clearMarker(): void {
    this.marker?.();
    this.marker = null;
  }

  private clearTransient(): void {
    this.clearPrompt();
    this.clearMarker();
    this.trail?.stop();
    this.trail = null;
    this.ring.hide();
  }

  /** Resets the pod back to dormant/idle state for checkpoint redeploy or fresh run. */
  reset(): void {
    this.clearTransient();
    this._phase = 'idle';
    this.timer = 0;
    this.pulseClock = 0;
    this.holdProgress = 0;
    this.tickClock = 0;
    this.near = false;
    this.openSoundPlayed = false;
    this.onInstalled = null;
    this.group.visible = false;
    this.beacon.visible = false;
    this.payload.visible = true;
    for (const d of this.doors) d.rotation.x = 0;
  }

  /** Frees scene objects and GPU resources owned by this pod. */
  dispose(): void {
    this.reset();
    this.ring.dispose();
    this.group.removeFromParent();
    this.beacon.removeFromParent();
    this.beacon.geometry.dispose();
    this.beaconMat.dispose();
  }
}
