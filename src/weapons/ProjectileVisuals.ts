/**
 * Projectile bodies. One InstancedMesh per shape, so a Warthog run costs the same draw calls as one
 * shell. All unlit and HDR so bloom heats them, per the FX language in DESIGN section 3.
 */
import * as THREE from 'three';
import type { Ctx, TracerKind } from '../core/contracts';
import { clamp } from '../core/math';
import { TUNING } from './data';
import type { Projectile, ProjectileKind } from './Projectiles';

const CAPACITY: Record<ProjectileKind, number> = {
  rocket: 48, shell: 64, grenade: 32, bullet: 192, plasma: 64, stake: 24,
};

/** Per tracer kind: enemy bullets and bolts read by colour alone. */
const BULLET_TINT: Partial<Record<TracerKind, number>> = {
  enemy: 0xff2a1a, plasma: 0x35c8ff, heavy: 0xffc040, hellfire: 0xff6a00, bloodthirst: 0xff1020, berserk: 0xff0040, rail: 0x80e0ff,
};

function hdr(hex: number, gain: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(gain);
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const g of parts) {
    vertices += g.getAttribute('position').count;
    indices += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const position = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  let vo = 0;
  let io = 0;
  for (const g of parts) {
    const pos = g.getAttribute('position');
    position.set(pos.array as Float32Array, vo * 3);
    const n = g.index ? g.index.count : pos.count;
    for (let i = 0; i < n; i++) index[io + i] = (g.index ? g.index.getX(i) : i) + vo;
    vo += pos.count;
    io += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** Merge geometries preserving vertex normals so lit MeshStandardMaterial projectiles shade cleanly. */
function mergedLit(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const g of parts) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    vertices += g.getAttribute('position').count;
    indices += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  let vo = 0;
  let io = 0;
  for (const g of parts) {
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    position.set(pos.array as Float32Array, vo * 3);
    normal.set(nrm.array as Float32Array, vo * 3);
    const n = g.index ? g.index.count : pos.count;
    for (let i = 0; i < n; i++) index[io + i] = (g.index ? g.index.getX(i) : i) + vo;
    vo += pos.count;
    io += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

const rotated = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry => {
  if (rx) g.rotateX(rx);
  return g.translate(x, y, z);
};

/** Nose along +Y, origin at the centre of mass. */
function rocketBody(): THREE.BufferGeometry {
  const fin = (a: number): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(0.012, 0.11, 0.09);
    g.translate(0, -0.13, 0.09);
    g.rotateY(a);
    return g;
  };
  return merged([
    new THREE.CylinderGeometry(0.075, 0.075, 0.34, 6),
    rotated(new THREE.ConeGeometry(0.075, 0.14, 6), 0, 0.24, 0),
    rotated(new THREE.CylinderGeometry(0.05, 0.065, 0.06, 6), 0, -0.2, 0),
    fin(0), fin(Math.PI / 2), fin(Math.PI), fin(-Math.PI / 2),
  ]);
}

/** Mk-82 / Mk-84 general-purpose aerial iron bomb: streamlined low-drag teardrop body (nose along +Y). */
function bombHeBody(): THREE.BufferGeometry {
  return mergedLit([
    rotated(new THREE.CylinderGeometry(0.21, 0.23, 0.72, 12), 0, 0.08, 0),
    rotated(new THREE.CylinderGeometry(0.115, 0.21, 0.38, 12), 0, 0.63, 0),
    rotated(new THREE.ConeGeometry(0.115, 0.22, 12), 0, 0.93, 0),
    rotated(new THREE.CylinderGeometry(0.23, 0.115, 0.56, 12), 0, -0.56, 0),
    rotated(new THREE.CylinderGeometry(0.115, 0.085, 0.26, 10), 0, -0.97, 0),
  ]);
}

/** Mk-82 / Mk-84 dark steel hardware: nose impact fuze, dorsal suspension lugs, cruciform fins, and box-tail shroud. */
function bombHeFins(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    rotated(new THREE.CylinderGeometry(0.032, 0.052, 0.16, 8), 0, 1.07, 0),
    rotated(new THREE.CylinderGeometry(0.075, 0.075, 0.035, 8), 0, 1.01, 0),
    rotated(new THREE.BoxGeometry(0.05, 0.09, 0.08), 0, 0.26, 0.23),
    rotated(new THREE.BoxGeometry(0.05, 0.09, 0.08), 0, -0.14, 0.24),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const fin = new THREE.BoxGeometry(0.034, 0.54, 0.34);
    fin.translate(0, -0.84, 0.20);
    fin.rotateY(a);
    parts.push(fin);

    // Box-tail stabilizer shroud plate connecting adjacent fin tips.
    const plate = new THREE.BoxGeometry(0.51, 0.19, 0.032);
    plate.translate(0, -0.96, 0.255);
    plate.rotateY(a + Math.PI / 4);
    parts.push(plate);
  }
  return mergedLit(parts);
}

/** Mk-82 / Mk-84 ordnance yellow high-explosive warhead bands. */
function bombHeBand(): THREE.BufferGeometry {
  return mergedLit([
    rotated(new THREE.CylinderGeometry(0.184, 0.214, 0.12, 12), 0, 0.52, 0),
    rotated(new THREE.CylinderGeometry(0.228, 0.232, 0.06, 12), 0, 0.22, 0),
  ]);
}

/** BLU-27 incendiary napalm firebomb canister: brushed aluminum tank, blunt tapered cones, stub tail strakes. */
function bombNapalmBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.23, 0.23, 1.34, 12),
    rotated(new THREE.CylinderGeometry(0.095, 0.23, 0.38, 12), 0, 0.86, 0),
    rotated(new THREE.ConeGeometry(0.095, 0.16, 10), 0, 1.13, 0),
    rotated(new THREE.CylinderGeometry(0.23, 0.095, 0.38, 12), 0, -0.86, 0),
    rotated(new THREE.CylinderGeometry(0.095, 0.055, 0.14, 10), 0, -1.12, 0),
    rotated(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 8), 0, 0.15, 0.24, Math.PI / 2),
  ];
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.BoxGeometry(0.028, 0.34, 0.20);
    fin.translate(0, -0.92, 0.17);
    fin.rotateY((i * Math.PI) / 2);
    parts.push(fin);
  }
  return mergedLit(parts);
}

/** BLU-27 napalm canister bright red-orange incendiary hazard stripes & igniter collar. */
function bombNapalmBand(): THREE.BufferGeometry {
  return mergedLit([
    rotated(new THREE.CylinderGeometry(0.236, 0.236, 0.18, 12), 0, 0.46, 0),
    rotated(new THREE.CylinderGeometry(0.236, 0.236, 0.16, 12), 0, -0.44, 0),
    rotated(new THREE.CylinderGeometry(0.115, 0.145, 0.08, 12), 0, 0.98, 0),
  ]);
}

function stakeBody(): THREE.BufferGeometry {
  return merged([
    new THREE.CylinderGeometry(0.018, 0.018, 0.86, 5),
    rotated(new THREE.ConeGeometry(0.03, 0.12, 5), 0, 0.49, 0),
    rotated(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 5), 0, -0.4, 0),
  ]);
}

/** 40mm sticky bomb: flat magnetic base at -Y, chunky ribbed canister, dome nose at +Y. */
function stickyBody(): THREE.BufferGeometry {
  return merged([
    rotated(new THREE.CylinderGeometry(0.095, 0.105, 0.035, 8), 0, -0.03, 0),
    rotated(new THREE.CylinderGeometry(0.072, 0.082, 0.12, 8), 0, 0.045, 0),
    rotated(new THREE.CylinderGeometry(0.052, 0.072, 0.04, 8), 0, 0.12, 0),
  ]);
}

/** Demolition satchel charge: flat backing at -Y, canvas-olive pack + twin charge blocks + straps + detonator puck at +Y. */
function satchelBody(): THREE.BufferGeometry {
  return merged([
    rotated(new THREE.BoxGeometry(0.32, 0.11, 0.22), 0, 0.015, 0),
    rotated(new THREE.BoxGeometry(0.11, 0.04, 0.17), -0.075, 0.08, 0),
    rotated(new THREE.BoxGeometry(0.11, 0.04, 0.17), 0.075, 0.08, 0),
    rotated(new THREE.BoxGeometry(0.34, 0.135, 0.032), 0, 0.02, -0.058),
    rotated(new THREE.BoxGeometry(0.34, 0.135, 0.032), 0, 0.02, 0.058),
    rotated(new THREE.CylinderGeometry(0.042, 0.048, 0.048, 8), 0, 0.105, 0),
  ]);
}

interface Layer {
  mesh: THREE.InstancedMesh;
  count: number;
}

function layer(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): Layer {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, count: 0 };
}

const basic = (color: THREE.Color, extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });

const metal = (color: number, roughness: number, metalness: number, emissive = 0x000000): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive });

interface StuckStake {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  until: number;
}

const Y = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

export class ProjectileVisuals {
  private readonly layers: Record<
    ProjectileKind
    | 'cone' | 'coneHot' | 'flare' | 'blink'
    | 'sticky' | 'stickyLed' | 'satchel' | 'satchelLed'
    | 'bombHeBody' | 'bombHeFins' | 'bombHeBand'
    | 'bombNapalmBody' | 'bombNapalmBand',
    Layer
  >;
  private readonly layerList: Layer[];
  private readonly tints = new WeakMap<Projectile, THREE.Color>();
  private readonly stuck: StuckStake[] = [];
  private stuckHead = 0;
  private stuckDirty = false;
  private stuckActive = 0;
  private stuckNextExpire = Infinity;
  private prevStakeLive = 0;
  private hadLive = false;

  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(private readonly ctx: Ctx) {
    this.layers = {
      rocket: layer(rocketBody(), basic(hdr(0xc8d0d8, 0.9)), CAPACITY.rocket),
      flare: layer(new THREE.ConeGeometry(0.1, 0.5, 6), basic(hdr(0xffa030, 5), { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), CAPACITY.rocket),
      shell: layer(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), basic(hdr(0xffff00, 5)), CAPACITY.shell),
      cone: layer(new THREE.ConeGeometry(0.3, 1.2, 12), basic(hdr(0xfff4d6, 1.8), { transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }), CAPACITY.shell),
      coneHot: layer(new THREE.ConeGeometry(0.24, 1.0, 12), basic(hdr(0xffa828, 3.6), { transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }), CAPACITY.shell),
      grenade: layer(new THREE.IcosahedronGeometry(0.11, 1), basic(hdr(0x3a4a3a, 1)), CAPACITY.grenade),
      bullet: layer(new THREE.CapsuleGeometry(0.035, 1, 2, 6), basic(WHITE.clone()), CAPACITY.bullet),
      plasma: layer(new THREE.IcosahedronGeometry(0.2, 0), basic(WHITE.clone()), CAPACITY.plasma),
      stake: layer(stakeBody(), basic(hdr(0x9aa4ad, 1)), CAPACITY.stake + TUNING.stake.maxStuck),
      // An exploding bolt's light, on its tail, lit with each beep.
      blink: layer(new THREE.IcosahedronGeometry(0.07, 1), basic(hdr(0xff1008, 4)), CAPACITY.stake),
      // Milkor MGL sticky bomb: chunky olive-steel 40mm canister + pulsing red-amber armed LED.
      sticky: layer(stickyBody(), basic(hdr(0x4b5642, 1.05)), CAPACITY.shell),
      stickyLed: layer(new THREE.IcosahedronGeometry(0.048, 1), basic(hdr(0xff4210, 5.5)), CAPACITY.shell),
      // Demolition Satchel Charge: canvas-olive demolition pack + bright pulsing red armed beacon light.
      satchel: layer(satchelBody(), basic(hdr(0x556242, 1.05)), CAPACITY.shell),
      satchelLed: layer(new THREE.IcosahedronGeometry(0.058, 1), basic(hdr(0xff1e12, 7.5)), CAPACITY.shell),
      // Modeled aircraft gravity bombs (Mk-82 / Mk-84 HE iron bomb & BLU-27 Napalm firebomb canister).
      bombHeBody: layer(bombHeBody(), metal(0x4a563d, 0.58, 0.28, 0x0b0e08), CAPACITY.shell),
      bombHeFins: layer(bombHeFins(), metal(0x282e36, 0.44, 0.62, 0x07090b), CAPACITY.shell),
      bombHeBand: layer(bombHeBand(), metal(0xf2c62c, 0.46, 0.16, 0x3a2b04), CAPACITY.shell),
      bombNapalmBody: layer(bombNapalmBody(), metal(0xaeb8c2, 0.34, 0.72, 0x161a1e), CAPACITY.shell),
      bombNapalmBand: layer(bombNapalmBand(), metal(0xe83b1c, 0.42, 0.18, 0x3b0c04), CAPACITY.shell),
    };
    this.layerList = Object.values(this.layers);
    for (const k of ['bullet', 'plasma'] as const) {
      this.layers[k].mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY[k] * 3), 3);
      this.layers[k].mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    for (let i = 0; i < TUNING.stake.maxStuck; i++) {
      this.stuck.push({ position: new THREE.Vector3(), rotation: new THREE.Quaternion(), until: 0 });
    }
  }

  init(): void {
    const scene = this.ctx.render.scene;
    for (let i = 0; i < this.layerList.length; i++) scene.add(this.layerList[i]!.mesh);
  }

  clear(): void {
    for (const s of this.stuck) s.until = 0;
    this.stuckDirty = true;
    this.stuckNextExpire = Infinity;
  }

  /** Remembers the colour a projectile draws in. Called once at spawn, so no per-frame lookup logic. */
  tint(p: Projectile, tracer: TracerKind | undefined): void {
    if (p.kind !== 'bullet' && p.kind !== 'plasma') return;
    let color = this.tints.get(p);
    if (!color) this.tints.set(p, (color = new THREE.Color()));
    const hex = (tracer && BULLET_TINT[tracer]) ?? (p.kind === 'plasma' ? 0x35c8ff : 0xffee60);
    color.setHex(hex).multiplyScalar(p.kind === 'plasma' ? 4 : 3.2);
  }

  /** A stake in a wall outlives the fight. Oldest out when the cap is reached. */
  stick(point: THREE.Vector3, dir: THREE.Vector3, seconds: number): void {
    const s = this.stuck[this.stuckHead]!;
    this.stuckHead = (this.stuckHead + 1) % this.stuck.length;
    // Sunk nose-first with most of the shaft showing.
    s.position.copy(point).addScaledVector(dir, -0.28);
    s.rotation.setFromUnitVectors(Y, dir);
    s.until = this.ctx.time.elapsed + seconds;
    this.stuckDirty = true;
    if (s.until < this.stuckNextExpire) this.stuckNextExpire = s.until;
  }

  draw(live: readonly Projectile[], dt: number): void {
    const now = this.ctx.time.elapsed;
    const expired = now >= this.stuckNextExpire;
    if (live.length === 0 && !this.hadLive && !this.stuckDirty && !expired) return;

    const L = this.layers;
    const list = this.layerList;
    for (let i = 0; i < list.length; i++) list[i]!.count = 0;
    for (let i = 0; i < live.length; i++) this.place(live[i]!, dt);

    const stakes = L.stake;
    const liveStakes = stakes.count;
    const writeStakes = liveStakes > 0 || this.prevStakeLive > 0 || this.stuckDirty || expired;
    if (writeStakes) {
      let active = 0;
      let nextExpire = Infinity;
      const maxStakes = stakes.mesh.instanceMatrix.count;
      for (let i = 0; i < this.stuck.length; i++) {
        const s = this.stuck[i]!;
        if (s.until <= now) continue;
        if (s.until < nextExpire) nextExpire = s.until;
        if (stakes.count >= maxStakes) continue;
        this.scale.set(1, 1, 1);
        this.matrix.compose(s.position, s.rotation, this.scale);
        stakes.mesh.setMatrixAt(stakes.count++, this.matrix);
        active++;
      }
      this.stuckActive = active;
      this.stuckNextExpire = nextExpire;
      this.stuckDirty = false;
      this.prevStakeLive = liveStakes;
    } else {
      stakes.count = this.stuckActive;
    }

    for (let i = 0; i < list.length; i++) {
      const l = list[i]!;
      l.mesh.count = l.count;
      if (l.count === 0 || (l === stakes && !writeStakes)) continue;
      l.mesh.instanceMatrix.clearUpdateRanges();
      l.mesh.instanceMatrix.addUpdateRange(0, l.count * 16);
      l.mesh.instanceMatrix.needsUpdate = true;
      if (l.mesh.instanceColor) {
        l.mesh.instanceColor.clearUpdateRanges();
        l.mesh.instanceColor.addUpdateRange(0, l.count * 3);
        l.mesh.instanceColor.needsUpdate = true;
      }
    }
    this.hadLive = live.length > 0;
  }

  private put(l: Layer, position: THREE.Vector3, rotation: THREE.Quaternion, sx: number, sy: number, sz: number): number {
    const at = l.count;
    if (at >= l.mesh.instanceMatrix.count) return -1;
    this.scale.set(sx, sy, sz);
    this.matrix.compose(position, rotation, this.scale);
    l.mesh.setMatrixAt(at, this.matrix);
    l.count++;
    return at;
  }

  private place(p: Projectile, dt: number): void {
    const L = this.layers;
    const pos = this.pos.copy(p.position);
    if (p.visualHold > 0) {
      p.visualHold -= dt;
      pos.addScaledVector(p.visualOffset, clamp(p.visualHold / 0.12));
    }
    const speed = p.velocity.length();
    if (speed > 1e-3) this.dir.copy(p.velocity).divideScalar(speed);
    else this.dir.set(0, 1, 0);
    this.quat.setFromUnitVectors(Y, this.dir);

    switch (p.kind) {
      case 'rocket': {
        // A Quiver missile is the same body, smaller.
        const k = p.size;
        this.put(L.rocket, pos, this.quat, k, k, k);
        // The flare points back along the path, flickering only through its length.
        this.spin.setFromUnitVectors(Y, this.dir.negate());
        this.put(L.flare, pos.addScaledVector(this.dir, 0.4 * k), this.spin, k, (0.8 + Math.random() * 0.7) * k, k);
        break;
      }
      case 'shell':
        if (p.sticky && p.source === 'satchel') {
          if (p.resting) {
            this.put(L.satchel, pos, this.quat, 1, 1, 1);
            // Bright pulsing red armed beacon on top of the detonator puck so planted satchels stand out clearly.
            const ledScale = p.blink > 0 ? 1.45 : 0.55;
            this.put(L.satchelLed, pos.addScaledVector(this.dir, 0.145), this.quat, ledScale, ledScale, ledScale);
          } else {
            p.spin += dt * 7.5;
            this.spin.setFromAxisAngle(this.dir.set(0.85, 0.2, 0.48).normalize(), p.spin);
            this.put(L.satchel, pos, this.spin, 1, 1, 1);
            this.dir.set(0, 0.145, 0).applyQuaternion(this.spin);
            this.put(L.satchelLed, pos.add(this.dir), this.spin, 0.9, 0.9, 0.9);
          }
          break;
        }
        if (p.sticky) {
          this.put(L.sticky, pos, this.quat, 1, 1, 1);
          // Pulsing red-amber armed LED on top of the canister: bright while blinking, dim ember between pulses.
          const ledScale = p.resting ? (p.blink > 0 ? 1.15 : 0.48) : 0.85;
          this.put(L.stickyLed, pos.addScaledVector(this.dir, 0.145), this.quat, ledScale, ledScale, ledScale);
          break;
        }
        if (p.bomb) {
          const k = p.size || 1;
          // Gentle axial roll around the bomb's velocity axis as gravity pitches the nose downward.
          p.spin += dt * 1.4;
          this.spin.setFromAxisAngle(Y, p.spin);
          this.quat.multiply(this.spin);
          if (p.napalm) {
            this.put(L.bombNapalmBody, pos, this.quat, k, k, k);
            this.put(L.bombNapalmBand, pos, this.quat, k, k, k);
          } else {
            this.put(L.bombHeBody, pos, this.quat, k, k, k);
            this.put(L.bombHeFins, pos, this.quat, k, k, k);
            this.put(L.bombHeBand, pos, this.quat, k, k, k);
          }
          break;
        }
        {
          const k = p.size || 1;
          this.put(L.shell, pos, this.quat, k * 0.85, k * 1.35, k * 0.85);
          if (k > 1.3) {
            // Giant supersonic artillery shell: wide translucent outer white-gold Mach bow-shock cone + hot inner shock cone.
            this.put(L.cone, this.w.copy(pos).addScaledVector(this.dir, -1.2 * k), this.quat, 2.6 * k, 2.4 * k, 2.6 * k);
            this.put(L.coneHot, pos.addScaledVector(this.dir, -0.65 * k), this.quat, 1.35 * k, 1.55 * k, 1.35 * k);
          } else {
            // Bow shock: tip forward, base trailing, as in the first game.
            this.put(L.cone, pos.addScaledVector(this.dir, -0.8 * k), this.quat, k, k, k);
          }
        }
        break;
      case 'grenade':
        p.spin += speed * dt * 2;
        this.spin.setFromAxisAngle(this.dir.set(0.6, 0.2, 0.77), p.spin);
        this.put(L.grenade, pos, this.spin, 1, 1, 1);
        break;
      case 'stake':
        this.put(L.stake, pos, this.quat, 1, 1, 1);
        if (p.blink > 0) this.put(L.blink, pos.addScaledVector(this.dir, -0.4), this.quat, 1, 1, 1);
        break;
      case 'bullet': {
        const at = this.put(L.bullet, pos, this.quat, 1, clamp(speed / 60, 0.2, 1.6), 1);
        if (at >= 0) L.bullet.mesh.setColorAt(at, this.tints.get(p) ?? WHITE);
        break;
      }
      case 'plasma': {
        // The Lance's ball sets its own size. Anything else is 1.
        const k = p.size;
        const at = this.put(L.plasma, pos, this.quat, k, 1.6 * k, k);
        if (at >= 0) L.plasma.mesh.setColorAt(at, this.tints.get(p) ?? WHITE);
        break;
      }
    }
  }
}
