/**
 * Everything that warns the player: laser sights, muzzle glints, ground rings, charge lanes, ward bubbles.
 * All pooled with hard caps. Colours are above 1 on purpose so bloom picks them out of the blue-hour murk.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { clamp, TAU } from '../core/math';

const MAX_LASERS = 12;
const MAX_GLINTS = 16;
const MAX_ZONES = 14;
const MAX_LANES = 4;
const MAX_WARDS = 12;
/** Metres outside a ward shell at which it starts to fade for the camera. */
const WARD_FADE = 2.5;

/** Lasers thicken with distance from the camera so they stay visible as a line, not a flicker, at sniper range. */
const LASER_BASE_WIDTH = 0.012;
const LASER_WIDTH_PER_METER = 0.0011;

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _pos = new THREE.Vector3();

interface Laser {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  color: THREE.Color;
  strength: number;
  active: boolean;
}

interface Glint {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  color: THREE.Color;
  life: number;
  total: number;
  size: number;
  follow: THREE.Object3D | null;
}

interface Zone {
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  fillMaterial: THREE.MeshBasicMaterial;
  life: number;
  total: number;
  radius: number;
}

interface Lane {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  total: number;
  length: number;
  width: number;
}

interface Ward {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  active: boolean;
  flash: number;
  spin: number;
}

function starTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  const glow = g.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.18, 'rgba(255,255,255,0.65)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.moveTo(c, 0);
  g.lineTo(c + 2, c - 2);
  g.lineTo(size, c);
  g.lineTo(c + 2, c + 2);
  g.lineTo(c, size);
  g.lineTo(c - 2, c + 2);
  g.lineTo(0, c);
  g.lineTo(c - 2, c - 2);
  g.closePath();
  g.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const additive = (color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
  });

export class Telegraphs {
  private lasers: Laser[] = [];
  private glints: Glint[] = [];
  private zones: Zone[] = [];
  private lanes: Lane[] = [];
  private wards: Ward[] = [];
  private nextGlint = 0;
  private nextZone = 0;
  private nextLane = 0;

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    const scene = this.ctx.render.scene;
    const beam = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    beam.translate(0, 0.5, 0);
    for (let i = 0; i < MAX_LASERS; i++) {
      const material = additive(0xffffff, 1);
      const mesh = new THREE.Mesh(beam, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.lasers.push({ mesh, material, color: new THREE.Color(), strength: 1, active: false });
    }

    const star = starTexture();
    for (let i = 0; i < MAX_GLINTS; i++) {
      const material = new THREE.SpriteMaterial({
        map: star, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 6;
      scene.add(sprite);
      this.glints.push({ sprite, material, color: new THREE.Color(), life: 0, total: 1, size: 1, follow: null });
    }

    const ringGeometry = new THREE.RingGeometry(0.965, 1, 72).rotateX(-Math.PI / 2);
    const discGeometry = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_ZONES; i++) {
      const ringMaterial = additive(0xff3010, 1);
      const fillMaterial = additive(0xff3010, 0.22);
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      const fill = new THREE.Mesh(discGeometry, fillMaterial);
      ring.visible = fill.visible = false;
      ring.renderOrder = fill.renderOrder = 4;
      scene.add(ring, fill);
      this.zones.push({ ring, fill, ringMaterial, fillMaterial, life: 0, total: 1, radius: 1 });
    }

    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    for (let i = 0; i < MAX_LANES; i++) {
      const material = additive(0xff3010, 0.3);
      const mesh = new THREE.Mesh(plane, material);
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.lanes.push({ mesh, material, life: 0, total: 1, length: 1, width: 1 });
    }

    const shell = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < MAX_WARDS; i++) {
      const material = additive(new THREE.Color(1.3, 1.1, 0.55), 0.55);
      material.wireframe = true;
      const mesh = new THREE.Mesh(shell, material);
      mesh.visible = false;
      scene.add(mesh);
      this.wards.push({ mesh, material, active: false, flash: 0, spin: i });
    }
  }

  /** Reserves a laser. Returns -1 when the pool is full, and every other call accepts -1 as a no-op. */
  acquireLaser(color: THREE.ColorRepresentation, strength: number): number {
    for (let i = 0; i < this.lasers.length; i++) {
      const l = this.lasers[i]!;
      if (l.active) continue;
      l.active = true;
      l.color.set(color);
      this.setLaserStrength(i, strength);
      return i;
    }
    return -1;
  }

  setLaserStrength(handle: number, strength: number): void {
    const l = this.lasers[handle];
    if (!l) return;
    l.strength = strength;
    l.material.color.copy(l.color).multiplyScalar(3 * strength);
  }

  aimLaser(handle: number, from: THREE.Vector3, to: THREE.Vector3): void {
    const l = this.lasers[handle];
    if (!l) return;
    _dir.subVectors(to, from);
    const length = _dir.length();
    if (length < 0.01) return;
    _dir.multiplyScalar(1 / length);
    const m = l.mesh;
    m.visible = true;
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(UP, _dir);
    _mid.copy(from).addScaledVector(_dir, length * 0.5);
    const width = (LASER_BASE_WIDTH + _mid.distanceTo(this.ctx.render.camera.position) * LASER_WIDTH_PER_METER) * Math.sqrt(l.strength);
    m.scale.set(width, length, width);
  }

  releaseLaser(handle: number): void {
    const l = this.lasers[handle];
    if (!l) return;
    l.active = false;
    l.mesh.visible = false;
  }

  /** A star at a muzzle that swells until the shot. `follow` keeps it on a moving hand. */
  glint(position: THREE.Vector3, color: THREE.ColorRepresentation, size: number, seconds: number, follow: THREE.Object3D | null = null): void {
    const g = this.glints[this.nextGlint]!;
    this.nextGlint = (this.nextGlint + 1) % MAX_GLINTS;
    g.color.set(color);
    g.life = g.total = Math.max(seconds, 0.05);
    g.size = size;
    g.follow = follow;
    g.sprite.position.copy(position);
    g.sprite.visible = true;
  }

  /** A ground circle that fills from the middle, landing exactly when the attack does. */
  zone(position: THREE.Vector3, radius: number, seconds: number, color: THREE.ColorRepresentation = 0xff3010): void {
    const z = this.zones[this.nextZone]!;
    this.nextZone = (this.nextZone + 1) % MAX_ZONES;
    z.life = z.total = Math.max(seconds, 0.05);
    z.radius = radius;
    z.ring.position.copy(position);
    z.fill.position.copy(position);
    z.ring.position.y += 0.09;
    z.fill.position.y += 0.07;
    z.ring.scale.setScalar(radius);
    z.fill.scale.setScalar(0.01);
    z.ringMaterial.color.set(color).multiplyScalar(3);
    z.fillMaterial.color.set(color).multiplyScalar(1.5);
    z.ring.visible = z.fill.visible = true;
  }

  /** The strip a charge will run down. Returns a handle so it can turn with the attacker while it winds up. */
  lane(from: THREE.Vector3, yaw: number, length: number, width: number, seconds: number, color: THREE.ColorRepresentation = 0xff3010): number {
    const handle = this.nextLane;
    const l = this.lanes[handle]!;
    this.nextLane = (this.nextLane + 1) % MAX_LANES;
    l.life = l.total = Math.max(seconds, 0.05);
    l.length = length;
    l.width = width;
    l.mesh.position.copy(from);
    l.mesh.position.y += 0.08;
    l.mesh.rotation.set(0, yaw, 0);
    l.mesh.scale.set(width, 1, 0.01);
    l.material.color.set(color).multiplyScalar(2);
    l.mesh.visible = true;
    return handle;
  }

  aimLane(handle: number, from: THREE.Vector3, yaw: number): void {
    const l = this.lanes[handle];
    if (!l || l.life <= 0) return;
    l.mesh.position.copy(from);
    l.mesh.position.y += 0.08;
    l.mesh.rotation.y = yaw;
  }

  releaseLane(handle: number): void {
    const l = this.lanes[handle];
    if (!l) return;
    l.life = 0;
    l.mesh.visible = false;
  }

  acquireWard(): number {
    for (let i = 0; i < this.wards.length; i++) {
      const w = this.wards[i]!;
      if (w.active) continue;
      w.active = true;
      w.flash = 1;
      w.mesh.visible = true;
      return i;
    }
    return -1;
  }

  placeWard(handle: number, position: THREE.Vector3, radius: number, strength: number): void {
    const w = this.wards[handle];
    if (!w) return;
    w.mesh.position.copy(position);
    w.mesh.scale.setScalar(radius);
    // From inside, a wire shell is lines across the whole screen. It fades as the body closes on the camera.
    const near = clamp((position.distanceTo(this.ctx.render.camera.position) - radius) / WARD_FADE);
    w.material.opacity = (0.2 + 0.5 * clamp(strength) + w.flash * 0.6) * near;
  }

  flashWard(handle: number): void {
    const w = this.wards[handle];
    if (w) w.flash = 1;
  }

  releaseWard(handle: number): void {
    const w = this.wards[handle];
    if (!w) return;
    w.active = false;
    w.mesh.visible = false;
  }

  update(dt: number): void {
    for (const g of this.glints) {
      if (g.life <= 0) continue;
      g.life -= dt;
      if (g.life <= 0) {
        g.sprite.visible = false;
        g.follow = null;
        continue;
      }
      if (g.follow) g.sprite.position.copy(g.follow.getWorldPosition(_pos));
      const t = 1 - g.life / g.total;
      g.sprite.scale.setScalar(g.size * (0.35 + 0.65 * t * t));
      g.sprite.material.rotation = t * TAU * 0.25;
      g.material.color.copy(g.color).multiplyScalar(3 + 5 * t);
    }
    for (const z of this.zones) {
      if (z.life <= 0) continue;
      z.life -= dt;
      if (z.life <= 0) {
        z.ring.visible = z.fill.visible = false;
        continue;
      }
      z.fill.scale.setScalar(z.radius * (1 - z.life / z.total));
    }
    for (const l of this.lanes) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) {
        l.mesh.visible = false;
        continue;
      }
      l.mesh.scale.z = l.length * Math.min(1, (1 - l.life / l.total) * 2.5);
    }
    for (const w of this.wards) {
      if (!w.active) continue;
      w.flash = Math.max(0, w.flash - dt * 4);
      w.spin += dt * 0.7;
      w.mesh.rotation.y = w.spin;
      w.mesh.rotation.x = w.spin * 0.6;
    }
  }

  clear(): void {
    for (const l of this.lasers) {
      l.active = false;
      l.mesh.visible = false;
    }
    for (const g of this.glints) {
      g.life = 0;
      g.follow = null;
      g.sprite.visible = false;
    }
    for (const z of this.zones) {
      z.life = 0;
      z.ring.visible = z.fill.visible = false;
    }
    for (const l of this.lanes) {
      l.life = 0;
      l.mesh.visible = false;
    }
    for (const w of this.wards) {
      w.active = false;
      w.mesh.visible = false;
    }
  }
}
