/**
 * Everything on the map that moves or reacts: jump pads, launch ramps, explosives, lava, crushers, electrified
 * floors, the crane gantry and the reactor. Static parts of these objects go into the merged map geometry and only
 * the moving parts stay separate, so the whole set costs about a dozen draw calls.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { clamp, lerp, smoothstep, TAU } from '../core/math';
import type { Ctx, HazardKind, HazardState, ReactorState, WorldObjects } from '../core/contracts';
import { FACE, Geo, type Mat } from './kit/geo';
import type { Kit } from './kit/kit';
import { ballistic, type CrusherSpec, type ElectricSpec, type GantrySpec, type LaunchRampSpec, type MapSpec, type PadSpec, type ReactorSpec } from './map/spec';

const PLAYER_GRAVITY = 28;
const PAD_COOLDOWN = 0.5;
const BARREL = { hp: 40, radius: 7, damage: 110, respawn: 45 } as const;
const TANK = { hp: 90, radius: 13, damage: 240, respawn: 70 } as const;
const MAX_CHAIN = 64;
const ELECTRIC_DPS = 45;
const CRUSH_KILL_HEIGHT = 2.2;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Geometry per material from a throwaway Geo, for things that need their own transform. */
function extract(geo: Geo): { mat: Mat; geometry: THREE.BufferGeometry }[] {
  const out: { mat: Mat; geometry: THREE.BufferGeometry }[] = [];
  const merged = new Map<Mat, THREE.BufferGeometry>();
  for (const b of geo.buckets.values()) {
    if (b.ni === 0 || merged.has(b.mat)) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.p.slice(0, b.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.n.slice(0, b.nv * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(b.c.slice(0, b.nv * 4), 4, true));
    g.setIndex(new THREE.BufferAttribute(b.idx.slice(0, b.ni), 1));
    g.computeBoundingSphere();
    merged.set(b.mat, g);
    out.push({ mat: b.mat, geometry: g });
  }
  return out;
}

class Instances {
  readonly meshes: THREE.InstancedMesh[] = [];
  constructor(root: THREE.Object3D, parts: { mat: Mat; geometry: THREE.BufferGeometry }[], count: number, material: (m: Mat) => THREE.Material) {
    for (const p of parts) {
      const mesh = new THREE.InstancedMesh(p.geometry, material(p.mat), Math.max(1, count));
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = count;
      root.add(mesh);
      this.meshes.push(mesh);
    }
  }
  set(i: number, m: THREE.Matrix4): void {
    for (const mesh of this.meshes) {
      mesh.setMatrixAt(i, m);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

interface Pad extends PadSpec {
  velocity: THREE.Vector3;
  cooldown: number;
  pulse: number;
}

interface Explosive {
  kind: 'barrel' | 'tank';
  pos: THREE.Vector3;
  hp: number;
  alive: boolean;
  respawnIn: number;
  index: number;
  collider: RAPIER.Collider | null;
}

interface ChainEntry { e: Explosive; at: number; source: string }

interface Crusher extends CrusherSpec {
  collider: RAPIER.Collider;
  /** Bottom face of the head. */
  y: number;
  slammed: boolean;
  index: number;
  warned: boolean;
}

interface Electric extends ElectricSpec {
  mesh: THREE.Mesh;
  live: boolean;
  nextSpark: number;
}

interface Gantry extends GantrySpec {
  group: THREE.Group;
  colliders: { c: RAPIER.Collider; dx: number; y: number; z: number }[];
  x: number;
  deckY: number;
  /** m/s along X this frame. */
  vx: number;
}

export class Objects implements WorldObjects {
  readonly root = new THREE.Group();
  readonly pads: Pad[] = [];
  readonly ramps: (LaunchRampSpec & { cooldown: number })[];
  readonly explosives: Explosive[] = [];
  private readonly byCollider = new Map<number, Explosive>();
  private readonly chain: ChainEntry[] = [];
  private barrels!: Instances;
  private tanks!: Instances;
  private readonly crushers: Crusher[] = [];
  private crusherHeads!: Instances;
  private crusherShafts!: Instances;
  private readonly electric: Electric[] = [];
  private readonly gantries: Gantry[] = [];
  private lava: THREE.Box3[];
  private ringMesh!: THREE.InstancedMesh;
  private readonly hazard: HazardState = { kind: 'lava', dps: 0, lethal: false };
  private reactorState: ReactorState = 'stable';
  private reactorHeat = 0;
  private reactorTarget = 0;
  /** Maps without a reactor keep these null, and waves can still ask it to change state. */
  private reactor: { u: { uTime: { value: number }; uHeat: { value: number }; uPulse: { value: number } }; gyroA: THREE.Group; gyroB: THREE.Group } | null = null;
  private playerReal = false;
  private hazardTick = 0;

  constructor(private readonly ctx: Ctx, spec: MapSpec, private readonly kit: Kit, private readonly material: (m: Mat) => THREE.Material) {
    this.root.name = 'world-objects';
    this.lava = spec.lava;
    this.ramps = spec.ramps.map(r => ({ ...r, cooldown: 0 }));
    this.buildPads(spec);
    this.buildExplosives(spec);
    this.buildCrushers(spec);
    this.buildElectric(spec);
    this.buildGantries(spec);
    if (spec.reactor) this.buildReactor(spec.reactor);
  }

  // ---- jump pads ---------------------------------------------------------------------------------------------

  private buildPads(spec: MapSpec): void {
    const k = this.kit;
    const g = k.geo;
    for (const p of spec.pads) {
      const velocity = ballistic(p.pos, p.target, p.arc, PLAYER_GRAVITY, new THREE.Vector3());
      this.pads.push({ ...p, velocity, cooldown: 0, pulse: 0 });
      const yaw = Math.atan2(-(p.target.z - p.pos.z), p.target.x - p.pos.x);
      const r = p.radius;
      k.push(p.pos.x, p.pos.y, p.pos.z, yaw);
      g.use('steelDark').lathe([r + 0.7, 0, r + 0.5, 0.2, r + 0.1, 0.22, r, 0.1], 0, 0, 0, 24, false);
      g.use('panel').tint(0.55).lathe([r, 0.1, 0.8, 0.1], 0, 0, 0, 24, false);
      g.tint(1);
      g.use('emissiveCyan').lathe([r + 0.09, 0.225, r - 0.12, 0.13], 0, 0, 0, 24, false);
      g.lathe([0.85, 0.13, 0.55, 0.13], 0, 0, 0, 16, false);
      // Chevrons on the plate show where it will throw you.
      for (let i = 0; i < 3; i++) {
        const u = 0.75 + i * 0.5, w = 0.72 - i * 0.12, t = 0.14;
        g.quad(u, 0.14, w, u + t, 0.14, w, u + t + 0.34, 0.14, 0, u + 0.34, 0.14, 0);
        g.quad(u + 0.34, 0.14, 0, u + t + 0.34, 0.14, 0, u + t, 0.14, -w, u, 0.14, -w);
      }
      k.pop();
      k.light(p.pos.x, p.pos.y + 1.6, p.pos.z, 'cyan', 14, 9);
    }
    const ring = new THREE.RingGeometry(0.72, 1, 28, 1);
    ring.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.2, 1.4, 2.2), transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.ringMesh = new THREE.InstancedMesh(ring, m, Math.max(1, this.pads.length * 3));
    this.ringMesh.frustumCulled = false;
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ringMesh.count = this.pads.length * 3;
    this.root.add(this.ringMesh);
  }

  private animatePads(now: number, dt: number): void {
    const n = this.pads.length;
    for (let i = 0; i < n; i++) {
      const p = this.pads[i]!;
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.pulse = Math.max(0, p.pulse - dt * 2.5);
      for (let j = 0; j < 3; j++) {
        const t = (now * 0.55 + j / 3 + i * 0.13) % 1;
        const size = p.radius * lerp(1, 0.55, t) * (1 + p.pulse * 0.8);
        // Rings climb and shrink: an upward-pulling read at any distance.
        _v.set(p.pos.x, p.pos.y + 0.25 + t * t * (2.6 + p.pulse * 3), p.pos.z);
        _s.set(size, 1, size);
        this.ringMesh.setMatrixAt(i * 3 + j, _m.compose(_v, _q.identity(), _s));
      }
    }
    this.ringMesh.instanceMatrix.needsUpdate = true;
  }

  padAt(position: THREE.Vector3, out: THREE.Vector3): boolean {
    for (const p of this.pads) {
      const dx = position.x - p.pos.x, dz = position.z - p.pos.z, dy = position.y - p.pos.y;
      if (dx * dx + dz * dz < p.radius * p.radius && dy > -0.6 && dy < 1.6) {
        out.copy(p.velocity);
        return true;
      }
    }
    return false;
  }

  private triggerPads(): void {
    const { player, audio, fx, events } = this.ctx;
    const pos = player.position;
    for (const p of this.pads) {
      if (p.cooldown > 0) continue;
      const dx = pos.x - p.pos.x, dz = pos.z - p.pos.z, dy = pos.y - p.pos.y;
      if (dx * dx + dz * dz >= p.radius * p.radius || dy < -0.6 || dy > 1.6) continue;
      p.cooldown = PAD_COOLDOWN;
      p.pulse = 1;
      // launch() adds horizontal speed, so subtract what the player has: pads must land where they point.
      _v.set(p.velocity.x - player.velocity.x, p.velocity.y, p.velocity.z - player.velocity.z);
      player.launch(_v);
      audio.play('jump_pad', { position: p.pos });
      fx.ring(p.pos, UP, 0x59d8ff, p.radius * 1.6);
      events.emit('world:pad', { position: p.pos, velocity: p.velocity });
    }
  }

  private triggerRamps(dt: number): void {
    const { player, audio } = this.ctx;
    const pos = player.position;
    for (const r of this.ramps) {
      r.cooldown = Math.max(0, r.cooldown - dt);
      if (r.cooldown > 0) continue;
      const dx = pos.x - r.pos.x, dz = pos.z - r.pos.z, dy = pos.y - r.pos.y;
      if (Math.abs(dy) > 2.5) continue;
      const along = dx * r.dir.x + dz * r.dir.z;
      const across = -dx * r.dir.z + dz * r.dir.x;
      if (along > 0.8 || along < -r.length || Math.abs(across) > r.halfWidth) continue;
      const v = player.velocity;
      if (v.x * r.dir.x + v.z * r.dir.z < 7) continue;
      r.cooldown = 1;
      _v.set(r.dir.x * r.boost, r.lift + Math.max(0, v.y), r.dir.z * r.boost);
      player.launch(_v);
      audio.play('jump_pad', { position: r.pos, pitch: 0.75 });
    }
  }

  // ---- explosives --------------------------------------------------------------------------------------------

  private buildExplosives(spec: MapSpec): void {
    const barrel = new Geo();
    barrel.use('paintRed').lathe([0.4, 0, 0.42, 0.05, 0.42, 1.1, 0.4, 1.16, 0.3, 1.18, 0, 1.19], 0, 0, 0, 14, false);
    barrel.use('steelDark');
    for (const y of [0.34, 0.76]) barrel.lathe([0.42, y - 0.03, 0.45, y - 0.02, 0.45, y + 0.02, 0.42, y + 0.03], 0, 0, 0, 14, false);
    barrel.use('paintYellow').lathe([0.425, 0.46, 0.425, 0.64], 0, 0, 0, 14, false);
    // A hot band keeps barrels readable in the darkest alleys. Warm colour means "shoot this" everywhere on the map.
    barrel.use('emissiveRed').lathe([0.43, 1.0, 0.43, 1.05], 0, 0, 0, 14, false);

    const tank = new Geo();
    const prof: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = -Math.PI / 2 + (i / 8) * Math.PI;
      const c = 1.5 + Math.sin(t) * (Math.sin(t) > 0 ? 1.2 : 0) + Math.sin(t) * (Math.sin(t) < 0 ? 1.2 : 0);
      prof.push(Math.max(0.01, Math.cos(t) * 0.95), c + 0.5);
    }
    tank.use('paintRed').lathe([0.95, 1, 0.95, 2.1], 0, 0, 0, 16, false);
    tank.lathe(prof.slice(0, 10), 0, 0, 0, 16, true);
    tank.lathe(prof.slice(8), 0, 0, 0, 16, true);
    tank.use('steelDark');
    tank.bevel(0, 0.25, 0, 1.15, 0.25, 0.6, 0.05);
    tank.bevel(0, 0.25, 0, 0.6, 0.25, 1.15, 0.05);
    tank.lathe([0.95, 1.45, 1, 1.47, 1, 1.63, 0.95, 1.65], 0, 0, 0, 16, false);
    tank.cyl(0, 3.1, 0, 0, 3.4, 0, 0.13, 0.13, 8);
    tank.use('emissiveRed').lathe([0.97, 2.0, 0.97, 2.08], 0, 0, 0, 16, false);

    const specs = spec.explosives;
    const nb = specs.filter(e => e.kind === 'barrel').length, nt = specs.length - nb;
    this.barrels = new Instances(this.root, extract(barrel), nb, this.material);
    this.tanks = new Instances(this.root, extract(tank), nt, this.material);
    let bi = 0, ti = 0;
    for (const s of specs) {
      const e: Explosive = {
        kind: s.kind, pos: s.pos, hp: 0, alive: false, respawnIn: 0, index: s.kind === 'barrel' ? bi++ : ti++, collider: null,
      };
      this.explosives.push(e);
      this.restore(e);
    }
  }

  private restore(e: Explosive): void {
    const barrel = e.kind === 'barrel';
    e.hp = barrel ? BARREL.hp : TANK.hp;
    e.alive = true;
    _v.set(e.pos.x, e.pos.y + (barrel ? 0.58 : 1.6), e.pos.z);
    _v2.set(barrel ? 0.42 : 1, barrel ? 0.58 : 1.6, barrel ? 0.42 : 1);
    const c = this.ctx.physics.addStaticBox(_v, _v2, null, 'metal');
    e.collider = c;
    if (c) this.byCollider.set(c.handle, e);
    _m.makeRotationY(e.index * 2.1).setPosition(e.pos);
    (barrel ? this.barrels : this.tanks).set(e.index, _m);
  }

  private retire(e: Explosive): void {
    e.alive = false;
    if (e.collider) {
      this.byCollider.delete(e.collider.handle);
      this.ctx.physics.world.removeCollider(e.collider, false);
      e.collider = null;
    }
    _m.makeScale(0, 0, 0).setPosition(e.pos);
    (e.kind === 'barrel' ? this.barrels : this.tanks).set(e.index, _m);
    e.respawnIn = e.kind === 'barrel' ? BARREL.respawn : TANK.respawn;
  }

  isExplosive(collider: RAPIER.Collider | null): boolean {
    return !!collider && this.byCollider.has(collider.handle);
  }

  damageExplosive(collider: RAPIER.Collider | null, amount: number, source: string): boolean {
    if (!collider) return false;
    const e = this.byCollider.get(collider.handle);
    if (!e) return false;
    this.hurt(e, amount, source);
    return true;
  }

  damageExplosivesInRadius(center: THREE.Vector3, radius: number, amount: number, source: string): void {
    for (const e of this.explosives) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(center);
      if (d <= radius) this.hurt(e, amount * (1 - (d / radius) * 0.6), source);
    }
  }

  private hurt(e: Explosive, amount: number, source: string): void {
    if (!e.alive) return;
    e.hp -= amount;
    if (e.hp <= 0) this.detonate(e, source);
  }

  private detonate(e: Explosive, source: string): void {
    const { fx, render, audio, camera, events, player } = this.ctx;
    const barrel = e.kind === 'barrel';
    const spec = barrel ? BARREL : TANK;
    const c = _v.set(e.pos.x, e.pos.y + (barrel ? 0.6 : 1.6), e.pos.z).clone();
    this.retire(e);
    fx.explosion(c, { radius: spec.radius, kind: 'barrel', scale: barrel ? 1 : 1.8 });
    render.lights.flash(c, 0xff8a30, barrel ? 40 : 90, spec.radius * 2.4, barrel ? 0.35 : 0.6);
    render.decals.add('scorch', e.pos, UP, spec.radius * 0.55);
    audio.play(barrel ? 'explosion_barrel' : 'explosion_tank', { position: c });
    if (this.playerReal) {
      const d = player.position.distanceTo(c);
      camera.addTrauma(clamp(1 - d / (spec.radius * 4)) * (barrel ? 0.5 : 0.9));
    }
    events.emit('world:explosion', { position: c, radius: spec.radius, damage: spec.damage, kind: e.kind, source });

    // Neighbours go a beat later, so a row of barrels ripples instead of popping at once.
    const now = this.ctx.time.elapsed;
    for (const o of this.explosives) {
      if (!o.alive || o === e) continue;
      const d = o.pos.distanceTo(e.pos);
      if (d > spec.radius) continue;
      if (this.chain.length >= MAX_CHAIN) this.chain.shift();
      this.chain.push({ e: o, at: now + 0.09 + d * 0.025, source });
    }
  }

  private tickExplosives(dt: number, now: number): void {
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const c = this.chain[i]!;
      if (now < c.at) continue;
      this.chain.splice(i, 1);
      this.hurt(c.e, 1e6, c.source);
    }
    for (const e of this.explosives) {
      if (e.alive) continue;
      e.respawnIn -= dt;
      if (e.respawnIn > 0) continue;
      if (this.playerReal && this.ctx.player.position.distanceTo(e.pos) < 20) { e.respawnIn = 4; continue; }
      this.restore(e);
    }
  }

  // ---- crushers ----------------------------------------------------------------------------------------------

  private buildCrushers(spec: MapSpec): void {
    const head = new Geo();
    const shaft = new Geo();
    const specs = spec.crushers;
    if (specs.length === 0) { this.crusherHeads = new Instances(this.root, [], 0, this.material); this.crusherShafts = this.crusherHeads; return; }
    const hx = specs[0]!.halfX, hz = specs[0]!.halfZ;
    head.use('steelDark').bevel(0, 1.4, 0, hx, 1.4, hz, 0.14);
    head.use('hazard').box(0, 0.4, 0, hx + 0.02, 0.22, hz + 0.02, FACE.sides);
    head.use('emissiveRed').box(0, 2.4, 0, hx + 0.03, 0.06, hz + 0.03, FACE.sides);
    head.use('steel').bevel(0, 3.2, 0, hx * 0.5, 0.5, hz * 0.5, 0.08);
    shaft.use('steel').cyl(0, 0, 0, 0, 24, 0, 0.7, 0.7, 14, false, false);
    for (const u of [-1, 1]) {
      shaft.use('steelDark').cyl(u * hx * 0.5, 0, 0, u * hx * 0.5, 24, 0, 0.26, 0.26, 8, false, false);
    }
    this.crusherHeads = new Instances(this.root, extract(head), specs.length, this.material);
    this.crusherShafts = new Instances(this.root, extract(shaft), specs.length, this.material);
    specs.forEach((s, index) => {
      const collider = this.ctx.physics.addStaticBox(_v.set(s.x, s.topY + 1.4, s.z), _v2.set(s.halfX, 1.4, s.halfZ), null, 'metal');
      this.crushers.push({ ...s, collider, y: s.topY, slammed: false, index, warned: false });
    });
  }

  private crusherHeight(c: Crusher, now: number): number {
    const t = ((now + c.phase) % c.period) / c.period;
    // Long lift, a held breath at the top, then a very short fall, a pause at the bottom.
    if (t < 0.5) return lerp(c.floorY, c.topY, smoothstep(0, 0.5, t));
    if (t < 0.82) return c.topY;
    if (t < 0.87) { const f = (t - 0.82) / 0.05; return lerp(c.topY, c.floorY, f * f); }
    return c.floorY;
  }

  private tickCrushers(now: number): void {
    const { fx, audio, camera, events } = this.ctx;
    for (const c of this.crushers) {
      const y = this.crusherHeight(c, now);
      const atFloor = y <= c.floorY + 0.01;
      if (atFloor && !c.slammed) {
        c.slammed = true;
        _v.set(c.x, c.floorY + 0.1, c.z);
        audio.play('crusher_slam', { position: _v });
        fx.sparks(_v, UP, 18, 0xffa040);
        fx.smoke(_v, 0x8a8f96, 3.5, 1.2);
        if (this.playerReal) camera.addTrauma(clamp(1 - this.ctx.player.position.distanceTo(_v) / 28) * 0.55);
        events.emit('world:hazard', { kind: 'crusher', position: _v.clone() });
      } else if (!atFloor) {
        if (c.slammed) audio.play('crusher_rise', { position: _v.set(c.x, c.floorY + 2, c.z) });
        c.slammed = false;
      }
      c.y = y;
      c.collider?.setTranslation({ x: c.x, y: y + 1.4, z: c.z });
      _m.makeTranslation(c.x, y, c.z);
      this.crusherHeads.set(c.index, _m);
      _m.makeTranslation(c.x, y + 3.6, c.z);
      this.crusherShafts.set(c.index, _m);
    }
  }

  // ---- electrified floors ------------------------------------------------------------------------------------

  private buildElectric(spec: MapSpec): void {
    for (const s of spec.electric) {
      const geo = new Geo();
      const { min, max } = s.box;
      geo.use('emissiveCyan');
      const y = min.y + 0.05;
      // Jagged arcs across the plate, read as current rather than a flat glow.
      for (let i = 0; i < 26; i++) {
        let x = min.x + this.kit.rng() * (max.x - min.x), z = min.z + this.kit.rng() * (max.z - min.z);
        const a = this.kit.rng() * TAU;
        const pts: number[] = [];
        for (let j = 0; j < 7; j++) {
          pts.push(x, y, z);
          x = clamp(x + Math.cos(a + (this.kit.rng() - 0.5) * 2.4) * 1.2, min.x, max.x);
          z = clamp(z + Math.sin(a + (this.kit.rng() - 0.5) * 2.4) * 1.2, min.z, max.z);
        }
        for (let j = 0; j < 6; j++) {
          const ax = pts[j * 3]!, az = pts[j * 3 + 2]!, bx = pts[j * 3 + 3]!, bz = pts[j * 3 + 5]!;
          const nx = -(bz - az), nz = bx - ax, l = Math.hypot(nx, nz) || 1, w = 0.05;
          geo.quad(ax + (nx / l) * w, y, az + (nz / l) * w, bx + (nx / l) * w, y, bz + (nz / l) * w, bx - (nx / l) * w, y, bz - (nz / l) * w, ax - (nx / l) * w, y, az - (nz / l) * w);
        }
      }
      const part = extract(geo)[0]!;
      const mesh = new THREE.Mesh(part.geometry, this.material('emissiveCyan'));
      mesh.visible = false;
      this.root.add(mesh);
      this.electric.push({ ...s, mesh, live: false, nextSpark: 0 });
    }
  }

  private tickElectric(now: number): void {
    const { fx, audio } = this.ctx;
    for (const e of this.electric) {
      const t = ((now + e.phase) % e.period);
      const warn = t > e.period - 0.9;
      const live = t < e.onTime;
      if (live && !e.live) audio.play('electric_zap', { position: e.box.getCenter(_v) });
      e.live = live;
      // Flicker warns before the plate goes live, flicker continues while it is hot.
      e.mesh.visible = live ? (now * 37) % 1 > 0.25 : warn ? (now * 9) % 1 > 0.7 : false;
      if (live && now > e.nextSpark) {
        e.nextSpark = now + 0.09;
        const { min, max } = e.box;
        _v.set(lerp(min.x, max.x, Math.random()), min.y + 0.1, lerp(min.z, max.z, Math.random()));
        fx.sparks(_v, UP, 3, 0x7fe6ff);
      }
    }
  }

  // ---- gantry ------------------------------------------------------------------------------------------------

  private buildGantries(spec: MapSpec): void {
    for (const s of spec.gantries) {
      const group = new THREE.Group();
      const geo = new Geo();
      const zc = (s.z0 + s.z1) / 2, half = (s.z1 - s.z0) / 2;
      const w = 3.2;
      // Bridge: twin box girders and a deck, end trucks on the rails, a trolley with a hanging ladle.
      geo.use('steelDark');
      for (const u of [-w, w]) geo.bevel(u, 0, 0, 0.6, 1, half, 0.08);
      geo.use('grate').slab(0, 1.03, 0, w + 0.5, 0.04, half, 3, FACE.py | FACE.ny);
      geo.use('steelDark');
      for (const s2 of [-1, 1]) {
        geo.bevel(0, 0.2, s2 * half, w + 3, 1.2, 1.1, 0.1);
        geo.use('paintYellow').tint(0.42, 0.4, 0.34).box(0, 0.2, s2 * (half - 0.9), w + 3.02, 0.5, 0.3, FACE.sides);
        geo.tint(1).use('steelDark');
      }
      for (const z of [-half + 12, half - 12]) geo.box(0, -0.9, z, w - 0.5, 0.12, 0.4, FACE.all);
      geo.use('panel').tint(0.7).bevel(0, 2.4, -6, 2.6, 1.3, 3.2, 0.12);
      geo.tint(1).use('steel');
      for (const u of [-1.4, 1.4]) geo.cyl(u, -0.2, 2, u, -9.4, 2, 0.05, 0.05, 6, false, false);
      geo.use('rust').lathe([2.6, -13.4, 3.4, -9.8, 3.6, -9.5, 3.2, -9.3], 0, 0, 2, 20, false);
      geo.use('steelDark').lathe([3.62, -9.8, 3.62, -9.2], 0, 0, 2, 20, false);
      geo.use('lava').lathe([3.15, -9.5, 0.01, -9.45], 0, 0, 2, 16, false);
      geo.use('emissiveOrange').box(0, -0.25, 0, w - 0.8, 0.04, half - 3, FACE.ny);
      for (const part of extract(geo)) {
        const m = new THREE.Mesh(part.geometry, this.material(part.mat));
        m.castShadow = true;
        group.add(m);
      }
      group.position.set(s.x0, s.y, zc);
      this.root.add(group);
      const colliders: Gantry['colliders'] = [];
      const add = (dx: number, y: number, z: number, hx: number, hy: number, hz: number, kind: 'grate' | 'metal') => {
        const c = this.ctx.physics.addStaticBox(_v.set(s.x0 + dx, y, z), _v2.set(hx, hy, hz), null, kind);
        if (c) colliders.push({ c, dx, y, z });
      };
      add(0, s.y + 0.55, zc, w + 0.5, 0.5, half, 'grate');
      this.gantries.push({ ...s, group, colliders, x: s.x0, deckY: s.y + 1.05, vx: 0 });
    }
  }

  private tickGantries(now: number, dt: number): void {
    for (const g of this.gantries) {
      const t = (Math.sin((now / g.period) * TAU) + 1) / 2;
      const x = lerp(g.x0, g.x1, smoothstep(0.02, 0.98, t));
      g.vx = dt > 0 ? (x - g.x) / dt : 0;
      g.x = x;
      g.group.position.x = x;
      for (const c of g.colliders) c.c.setTranslation({ x: x + c.dx, y: c.y, z: c.z });
    }
  }

  platformVelocity(position: THREE.Vector3, out: THREE.Vector3): boolean {
    for (const g of this.gantries) {
      if (Math.abs(position.y - g.deckY) < 0.7 && Math.abs(position.x - g.x) < 4.2 && position.z > g.z0 && position.z < g.z1) {
        out.set(g.vx, 0, 0);
        return true;
      }
    }
    return false;
  }

  // ---- reactor -----------------------------------------------------------------------------------------------

  private buildReactor(reactor: ReactorSpec): void {
    const u = { uTime: { value: 0 }, uHeat: { value: 0 }, uPulse: { value: 0 } };
    const vert = /* glsl */`
      varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main() {
        vP = position;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vW = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`;
    const frag = /* glsl */`
      uniform float uTime; uniform float uHeat; uniform float uPulse;
      varying vec3 vP; varying vec3 vN; varying vec3 vW;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float a = atan(vP.z, vP.x) * 3.0;
        vec2 q = vec2(a, vP.y * 0.32 - uTime * 1.3);
        float n = noise(q) * 0.55 + noise(q * 2.3 + 7.0) * 0.3 + noise(q * 5.1 - uTime) * 0.15;
        float bands = pow(0.5 + 0.5 * sin(vP.y * 3.0 - uTime * 7.0), 3.0);
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vW))), 1.6);
        float e = 0.8 + n * 3.2 + bands * 1.1 + rim * 2.0 + uPulse * 2.4;
        vec3 cold = vec3(0.18, 0.85, 1.25);
        vec3 hot = vec3(2.1, 0.5, 0.12);
        gl_FragColor = vec4(mix(cold, hot, uHeat) * e, 1.0);
      }`;
    const coreMat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, toneMapped: false });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 12.5, 32, 6, true), coreMat);
    core.position.y = 30;
    this.root.add(core);

    // Beam from the crown: a soft additive cone that marks the centre of the map from any zone.
    const beamVert = /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    const beamFrag = /* glsl */`
      uniform float uTime; uniform float uHeat; uniform float uPulse;
      varying vec2 vUv;
      void main() {
        float f = pow(1.0 - vUv.y, 1.4);
        float s = 0.65 + 0.35 * sin(vUv.y * 40.0 - uTime * 6.0);
        vec3 c = mix(vec3(0.25, 0.85, 1.2), vec3(2.0, 0.55, 0.15), uHeat);
        gl_FragColor = vec4(c * f * s * (0.9 + uPulse), 1.0);
      }`;
    const beamMat = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 0.7, 150, 16, 1, true), beamMat);
    beam.position.y = reactor.topY + 75 - 16;
    this.root.add(beam);

    const gyro = (r: number, tube: number, mat: Mat) => {
      const geo = new Geo();
      geo.use(mat);
      const seg = 56;
      const pts: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        pts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      geo.tube(pts, tube, 8);
      geo.use('steelDark');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        geo.push(Math.cos(a) * r, 0, Math.sin(a) * r, -a);
        geo.bevel(0, 0, 0, tube * 1.6, tube * 1.6, tube * 2.4, 0.06);
        geo.pop();
      }
      geo.use('emissiveCyan').tube(pts.map((v, i) => (i % 3 === 1 ? tube * 1.04 : v)), tube * 0.1, 4);
      const group = new THREE.Group();
      for (const part of extract(geo)) group.add(new THREE.Mesh(part.geometry, this.material(part.mat)));
      group.position.y = 30;
      this.root.add(group);
      return group;
    };
    this.reactor = { u, gyroA: gyro(9.8, 0.34, 'steel'), gyroB: gyro(8.6, 0.26, 'steel') };
  }

  setReactorState(state: ReactorState): void {
    this.reactorState = state;
    this.reactorTarget = state === 'critical' ? 1 : state === 'unstable' ? 0.35 : 0;
  }

  private tickReactor(dt: number, now: number): void {
    const reactor = this.reactor;
    if (!reactor) return;
    this.reactorHeat += (this.reactorTarget - this.reactorHeat) * (1 - Math.exp(-dt * 1.8));
    const speed = this.reactorState === 'critical' ? 2.4 : this.reactorState === 'unstable' ? 1.5 : 1;
    const u = reactor.u;
    u.uTime.value = now * speed;
    u.uHeat.value = this.reactorHeat;
    const flicker = this.reactorState === 'stable' ? 0 : Math.max(0, Math.sin(now * 23) * Math.sin(now * 7.1));
    u.uPulse.value = 0.5 * (0.5 + 0.5 * Math.sin(now * 1.6)) * 0.4 + flicker;
    reactor.gyroA.rotation.set(0.42, now * 0.37 * speed, Math.sin(now * 0.19) * 0.22);
    reactor.gyroB.rotation.set(-0.5, -now * 0.53 * speed, 0.3 + Math.cos(now * 0.23) * 0.2);
  }

  // ---- hazards -----------------------------------------------------------------------------------------------

  hazardAt(position: THREE.Vector3): HazardState | null {
    for (const b of this.lava) if (b.containsPoint(position)) return this.setHazard('lava', 0, true);
    for (const c of this.crushers) {
      if (Math.abs(position.x - c.x) > c.halfX || Math.abs(position.z - c.z) > c.halfZ) continue;
      if (position.y >= c.floorY - 0.5 && position.y <= c.y && c.y < c.floorY + CRUSH_KILL_HEIGHT) return this.setHazard('crusher', 0, true);
    }
    for (const e of this.electric) {
      if (e.live && e.box.containsPoint(position)) return this.setHazard('electric', ELECTRIC_DPS, false);
    }
    return null;
  }

  private setHazard(kind: HazardKind, dps: number, lethal: boolean): HazardState {
    const h = this.hazard;
    h.kind = kind; h.dps = dps; h.lethal = lethal;
    return h;
  }

  private tickPlayerHazards(dt: number): void {
    const { player, events, audio } = this.ctx;
    const h = this.hazardAt(player.position);
    if (!h) return;
    if (h.lethal) {
      player.takeDamage({ amount: 1e6, type: 'hazard', source: h.kind });
      audio.play(h.kind === 'lava' ? 'lava_burn' : 'crusher_slam', { position: player.position });
      events.emit('world:hazard', { kind: h.kind, position: player.position.clone() });
      return;
    }
    player.takeDamage({ amount: h.dps * dt, type: 'hazard', source: h.kind });
    this.hazardTick -= dt;
    if (this.hazardTick <= 0) {
      this.hazardTick = 0.35;
      audio.play('electric_zap', { position: player.position });
      events.emit('world:hazard', { kind: h.kind, position: player.position.clone() });
    }
  }

  // ---- frame -------------------------------------------------------------------------------------------------

  update(): void {
    const { dt, elapsed } = this.ctx.time;
    // The world is built before the player exists, and sandboxes may run it with a stub, so ask every frame.
    this.playerReal = this.ctx.player?.position instanceof THREE.Vector3;
    this.animatePads(elapsed, dt);
    this.tickExplosives(dt, elapsed);
    this.tickCrushers(elapsed);
    this.tickElectric(elapsed);
    this.tickGantries(elapsed, dt);
    this.tickReactor(dt, elapsed);
    if (this.playerReal && this.ctx.player.alive) {
      this.triggerPads();
      this.triggerRamps(dt);
      this.tickPlayerHazards(dt);
    }
  }

  reset(): void {
    this.chain.length = 0;
    for (const e of this.explosives) {
      if (!e.alive) this.restore(e);
      else e.hp = e.kind === 'barrel' ? BARREL.hp : TANK.hp;
    }
    this.setReactorState('stable');
    this.reactorHeat = 0;
  }
}
