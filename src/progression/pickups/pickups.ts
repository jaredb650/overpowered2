/**
 * Pickups: kill drops, map items with respawn, the ambient supply drip and timed powerup capsules.
 *
 * Everything is instanced, one InstancedMesh pair per kind plus one halo pass, so the cost stays flat however many are
 * out. They run on realDt, as in the first game, so SLOWMO leaves them spinning at full speed.
 *
 * Three first-game faults are fixed by construction: drops land on the floor instead of keeping the enemy's height,
 * they expire instead of stacking forever, and a health pack is not eaten at full health.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { KillEvent, PickupKind, PowerupId } from '../../core/gameplay';
import { chance, clamp, pick, rand, TAU } from '../../core/math';
import { GroundProbe } from '../callins/ground';
import { CAPSULE, MEGA, PICKUP as P, PICKUP_LOOK, POWERUPS, type EffectId } from '../data';
import type { ModelMaterials } from '../modelkit';
import { pickupModel } from './models';

type ModelKind = Exclude<PickupKind, 'weaponCache'>;
export type PickupSource = 'drop' | 'supply' | 'map' | 'capsule';

/** The HUD minimap reads kind, position and active. */
export interface Pickup {
  kind: ModelKind;
  position: THREE.Vector3;
  active: boolean;
  source: PickupSource;
  /** Bobbing centre. `position` is the base; the mesh rides above it. */
  age: number;
  life: number;
  phase: number;
  fall: number;
  floor: number;
  drift: THREE.Vector3;
  marker: (() => void) | null;
  slot: MapSlot | null;
}

interface MapSlot {
  kind: 'megaHealth' | 'heavyArmor';
  position: THREE.Vector3;
  respawn: number;
  timer: number;
  live: boolean;
}

const MAX_LIVE = 64;
const INSTANCE_CAP: Readonly<Partial<Record<ModelKind, number>>> = {
  health: P.maxDrops, ammo: P.maxDrops, armor: P.maxDrops, megaHealth: 4, heavyArmor: 4,
};
const POWERUP_CAP = 3;

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = instanceColor;
  // Billboard: instance origin in view space, quad offset in view axes.
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = length(instanceMatrix[0].xyz);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}`;

const HALO_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float glow = pow(max(1.0 - r, 0.0), 2.4);
  gl_FragColor = vec4(vColor * glow, 1.0);
}`;

const COLUMN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float a = pow(across, 3.0) * pow(1.0 - vUv.y, 2.0);
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = instanceColor;
  vec4 origin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // Cylindrical billboard: keeps its height, turns to face the camera around Y.
  vec3 toCam = normalize(cameraPosition - origin.xyz);
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
  float width = length(instanceMatrix[0].xyz);
  float height = length(instanceMatrix[1].xyz);
  vec3 world = origin.xyz + right * position.x * width + vec3(0.0, 1.0, 0.0) * position.y * height;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

class KindMeshes {
  readonly solid: THREE.InstancedMesh | null;
  readonly glow: THREE.InstancedMesh | null;
  count = 0;

  constructor(ctx: Ctx, kind: ModelKind, materials: ModelMaterials, cap: number) {
    const b = pickupModel(kind);
    const solid = b.solidGeometry();
    const glow = b.glowGeometry();
    this.solid = solid ? new THREE.InstancedMesh(solid, materials.solid, cap) : null;
    this.glow = glow ? new THREE.InstancedMesh(glow, materials.glow, cap) : null;
    for (const m of [this.solid, this.glow]) {
      if (!m) continue;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      ctx.render.scene.add(m);
    }
  }

  push(matrix: THREE.Matrix4): void {
    const cap = (this.solid ?? this.glow)!.instanceMatrix.count;
    if (this.count >= cap) return;
    this.solid?.setMatrixAt(this.count, matrix);
    this.glow?.setMatrixAt(this.count, matrix);
    this.count++;
  }

  flush(): void {
    for (const m of [this.solid, this.glow]) {
      if (!m) continue;
      m.count = this.count;
      m.instanceMatrix.needsUpdate = this.count > 0;
    }
    this.count = 0;
  }
}

export class Pickups {
  /** Live pickups, oldest first. The minimap walks this list. */
  readonly live: Pickup[] = [];
  private readonly free: Pickup[] = [];
  private readonly slots: MapSlot[] = [];
  private readonly meshes = new Map<ModelKind, KindMeshes>();
  private readonly halos: THREE.InstancedMesh;
  private readonly columns: THREE.InstancedMesh;
  private readonly probe: GroundProbe;
  private readonly bag: PowerupId[] = [];
  private clock = 0;
  private supplyIn: number = P.supplyEvery;
  private capsuleIn: number = CAPSULE.firstAt;
  private grantEffect: (id: EffectId) => void = () => undefined;

  constructor(private readonly ctx: Ctx, materials: ModelMaterials) {
    this.probe = new GroundProbe(ctx);
    for (const kind of Object.keys(PICKUP_LOOK) as PickupKind[]) {
      if (kind !== 'weaponCache') this.meshes.set(kind, new KindMeshes(ctx, kind, materials, INSTANCE_CAP[kind] ?? POWERUP_CAP));
    }

    const billboard = (vertexShader: string, fragmentShader: string, geometry: THREE.BufferGeometry, cap: number) => {
      const mesh = new THREE.InstancedMesh(geometry, new THREE.ShaderMaterial({
        vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      }), cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _c.set('#ffffff'));
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 12;
      ctx.render.scene.add(mesh);
      return mesh;
    };
    this.halos = billboard(HALO_VERT, HALO_FRAG, new THREE.PlaneGeometry(1, 1), MAX_LIVE);
    const columnGeo = new THREE.PlaneGeometry(1, 1);
    columnGeo.translate(0, 0.5, 0);
    this.columns = billboard(COLUMN_VERT, COLUMN_FRAG, columnGeo, 16);
    for (let i = 0; i < MAX_LIVE; i++) {
      this.free.push({
        kind: 'health', position: new THREE.Vector3(), active: false, source: 'drop', age: 0, life: 0, phase: 0, fall: 0, floor: 0,
        drift: new THREE.Vector3(), marker: null, slot: null,
      });
    }
  }

  /** The powerup effects go through this, so the module does not need to know about perks. */
  onGrant(fn: (id: EffectId) => void): void {
    this.grantEffect = fn;
  }

  /** Called at the start of a run, once the map exists. */
  layout(): void {
    this.slots.length = 0;
    const spots = this.ctx.world.pickupSpots;
    if (!spots || spots.length === 0) return;
    // Spread items over the list so they do not cluster in whichever zone was generated first.
    const stride = Math.max(1, Math.floor(spots.length / (P.megaSpots + P.armorSpots)));
    for (let i = 0; i < P.megaSpots + P.armorSpots; i++) {
      const spot = spots[(i * stride) % spots.length]!;
      const mega = i % 2 === 0;
      const slot: MapSlot = {
        kind: mega ? 'megaHealth' : 'heavyArmor', position: spot.clone(), respawn: mega ? P.megaRespawn : P.armorRespawn, timer: 0, live: false,
      };
      this.slots.push(slot);
      this.spawnSlot(slot);
    }
  }

  private spawnSlot(slot: MapSlot): void {
    const p = this.spawn(slot.kind, slot.position, 'map');
    if (!p) return;
    slot.live = true;
    p.slot = slot;
  }

  private spawn(kind: ModelKind, position: THREE.Vector3, source: PickupSource): Pickup | null {
    if (this.free.length === 0) this.evictOldestDrop();
    const p = this.free.pop();
    if (!p) return null;
    p.kind = kind;
    p.position.copy(position);
    p.active = true;
    p.source = source;
    p.age = 0;
    p.phase = rand(0, TAU);
    p.life = source === 'capsule' ? CAPSULE.life : source === 'map' ? 0 : P.dropLife;
    p.fall = 0;
    p.drift.set(0, 0, 0);
    p.marker = null;
    p.slot = null;
    p.floor = this.floorBelow(position);
    if (source === 'drop') {
      // Pops out of the body and falls, instead of appearing at its feet.
      p.fall = rand(5, 8);
      p.drift.set(rand(-3, 3), 0, rand(-3, 3));
    } else {
      p.position.y = p.floor;
    }
    this.live.push(p);
    if (source === 'drop' && this.countDrops() > P.maxDrops) this.evictOldestDrop();
    return p;
  }

  private floorBelow(at: THREE.Vector3): number {
    const h = this.probe.heightAt(at.x, at.y + 1.5, at.z, 60);
    return Number.isNaN(h) ? at.y : h;
  }

  private countDrops(): number {
    let n = 0;
    for (const p of this.live) if (p.source === 'drop') n++;
    return n;
  }

  private evictOldestDrop(): void {
    const i = this.live.findIndex(p => p.source === 'drop' || p.source === 'supply');
    if (i >= 0) this.remove(i);
  }

  private remove(index: number): void {
    const p = this.live[index]!;
    p.active = false;
    p.marker?.();
    p.marker = null;
    this.live.splice(index, 1);
    this.free.push(p);
  }

  /** Public drop: the contract's spawnPickup. */
  drop(kind: ModelKind, position: THREE.Vector3): void {
    if (POWERUPS.includes(kind as PowerupId)) this.spawnCapsule(kind as PowerupId, position);
    else this.spawn(kind, position, 'drop');
  }

  /** 30% per kill, weighted by what the player is short of. */
  onKill(e: KillEvent): void {
    if (!chance(P.dropChance)) return;
    const { player, weapons } = this.ctx;
    const ammo = weapons.ammo();
    const hurt = 1 - clamp(player.health / player.maxHealth);
    const dry = ammo.maxReserve > 0 ? 1 - clamp(ammo.reserve / ammo.maxReserve) : 0;
    const wHealth = 1 + hurt * 2.5;
    const wAmmo = 1 + dry * 2.5;
    const wArmor = 0.7;
    const r = rand(0, wHealth + wAmmo + wArmor);
    this.spawn(r < wHealth ? 'health' : r < wHealth + wAmmo ? 'ammo' : 'armor', e.enemy.center, 'drop');
  }

  private nextPowerup(): PowerupId {
    if (this.bag.length === 0) {
      this.bag.push(...POWERUPS);
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j]!, this.bag[i]!];
      }
    }
    return this.bag.pop()!;
  }

  private farSpot(minDistance: number): THREE.Vector3 | null {
    const spots = this.ctx.world.pickupSpots;
    if (!spots || spots.length === 0) return null;
    const me = this.ctx.player.position;
    for (let i = 0; i < 12; i++) {
      const spot = pick(spots);
      if (spot.distanceTo(me) >= minDistance) return spot;
    }
    return pick(spots);
  }

  private spawnCapsule(id: PowerupId, at: THREE.Vector3): void {
    const { audio, fx, hud } = this.ctx;
    const p = this.spawn(id, at, 'capsule');
    if (!p) return;
    const look = PICKUP_LOOK[id];
    _p.copy(p.position);
    _p.y += P.hover;
    fx.spawnIn(_p, look.color, 3);
    audio.play('powerup_spawn', { position: _p });
    p.marker = hud.marker(_p, look.label, look.color);
    hud.feed(`${look.label} SPAWNED`, look.color);
  }

  private countCapsules(): number {
    let n = 0;
    for (const p of this.live) if (p.source === 'capsule') n++;
    return n;
  }

  private countSupplies(): number {
    let n = 0;
    for (const p of this.live) if (p.source === 'supply' || p.source === 'drop') n++;
    return n;
  }

  private schedule(dt: number): void {
    this.supplyIn -= dt;
    if (this.supplyIn <= 0) {
      this.supplyIn += P.supplyEvery;
      if (chance(P.supplyChance) && this.countSupplies() < P.supplyMaxLive) {
        const spots = this.ctx.world.pickupSpots;
        if (spots && spots.length > 0) {
          const me = this.ctx.player.position;
          for (let i = 0; i < 8; i++) {
            const spot = pick(spots);
            if (spot.distanceTo(me) > P.supplyRange) continue;
            this.spawn(chance(0.6) ? 'ammo' : 'health', spot, 'supply');
            break;
          }
        }
      }
    }
    this.capsuleIn -= dt;
    if (this.capsuleIn <= 0) {
      this.capsuleIn = rand(CAPSULE.every[0], CAPSULE.every[1]);
      if (this.countCapsules() < CAPSULE.maxLive) {
        const spot = this.farSpot(CAPSULE.minDistance);
        if (spot) this.spawnCapsule(this.nextPowerup(), spot);
      }
    }
    for (const slot of this.slots) {
      if (slot.live) continue;
      slot.timer -= dt;
      if (slot.timer <= 0) {
        this.spawnSlot(slot);
        _p.copy(slot.position);
        _p.y += 1;
        this.ctx.fx.spawnIn(_p, PICKUP_LOOK[slot.kind].color, 2.5);
        this.ctx.audio.play('powerup_spawn', { position: _p });
      }
    }
  }

  private wants(p: Pickup): boolean {
    const { player } = this.ctx;
    if (p.kind === 'health') return player.health < player.maxHealth;
    return true;
  }

  private collect(index: number): void {
    const p = this.live[index]!;
    const { audio, events, fx, hud, player, render, weapons } = this.ctx;
    const kind = p.kind;
    const look = PICKUP_LOOK[kind];
    _p.copy(p.position);
    _p.y += P.hover;

    switch (kind) {
      case 'health':
        player.heal(P.health);
        hud.feed(`Health restored +${P.health}`, look.color);
        break;
      case 'armor':
        player.addArmor(P.armor);
        hud.feed(`Armor +${P.armor}`, look.color);
        break;
      case 'ammo':
        weapons.addAmmo(P.ammo);
        weapons.addGrenades(P.grenades);
        hud.feed('Ammo collected', look.color);
        break;
      case 'megaHealth':
        player.health = Math.min(player.health + MEGA.heal, player.maxHealth * MEGA.overhealFactor);
        hud.feed(`MEGA HEALTH +${MEGA.heal}`, look.color);
        break;
      case 'heavyArmor':
        player.addArmor(P.heavyArmor);
        hud.feed(`HEAVY ARMOR +${P.heavyArmor}`, look.color);
        break;
      default:
        this.grantEffect(kind);
    }

    audio.play(`pickup_${kind}`);
    fx.pickupSparkle(_p, look.color);
    fx.ring(_p, _up, look.color, p.source === 'drop' || p.source === 'supply' ? 2.5 : 6);
    render.lights.flash(_p, look.color, 8, 8, 0.2);
    render.post.flash(look.color, 0.1, 0.16);
    hud.floatText(_p, look.label, look.color);
    events.emit('pickup:collected', { kind, position: _p });

    if (p.slot) {
      p.slot.live = false;
      p.slot.timer = p.slot.respawn;
    }
    this.remove(index);
  }

  update(dt: number, magnet: boolean): void {
    this.clock += dt;
    this.schedule(dt);
    this.decayOverheal(dt);
    if (this.live.length === 0 && this.halos.count === 0) return;

    const { player } = this.ctx;
    const eyeY = player.position.y + 1;
    let halos = 0;
    let columns = 0;

    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.age += dt;
      if (p.life > 0 && p.age >= p.life) {
        this.remove(i);
        continue;
      }
      if (p.fall !== 0 || p.position.y > p.floor + 0.01) {
        p.fall -= 26 * dt;
        p.position.y += p.fall * dt;
        p.position.addScaledVector(p.drift, dt);
        if (p.position.y <= p.floor && p.fall < 0) {
          p.position.y = p.floor;
          p.fall = 0;
          p.drift.set(0, 0, 0);
        }
      }

      _d.set(player.position.x - p.position.x, eyeY - (p.position.y + P.hover), player.position.z - p.position.z);
      const dist = _d.length();
      const reach = magnet ? P.magnetRadius : P.attractRadius;
      if (dist < reach && this.wants(p) && (magnet || p.source !== 'map')) {
        const speed = magnet ? P.magnetSpeed : P.attractSpeed * (1 - dist / reach) + 4;
        p.position.addScaledVector(_d, Math.min(1, (speed * dt) / Math.max(dist, 0.01)));
        p.floor = Math.min(p.floor, p.position.y);
      }
      if (dist < P.collectRadius && this.wants(p)) {
        this.collect(i);
        continue;
      }

      // Blink through the last seconds, so an expiring drop warns before it vanishes.
      const blinking = p.life > 0 && p.life - p.age < P.blinkAt && Math.sin(p.age * 18) < 0;
      if (blinking) continue;

      const bob = Math.sin(this.clock * P.bobRate + p.phase) * P.bobHeight;
      const scale = p.source === 'drop' ? 1 : p.source === 'capsule' ? 1.25 : 1.15;
      _p.copy(p.position);
      _p.y += P.hover + bob;
      _e.set(0, this.clock * P.spinRate + p.phase, 0);
      _q.setFromEuler(_e);
      _s.setScalar(scale);
      _m.compose(_p, _q, _s);
      this.meshes.get(p.kind)!.push(_m);

      if (halos < MAX_LIVE) {
        _c.set(PICKUP_LOOK[p.kind].color).multiplyScalar(p.source === 'capsule' ? 1.5 : 0.8);
        _s.setScalar(p.source === 'capsule' ? 3.4 : p.source === 'map' ? 3 : 1.9);
        _q.identity();
        _m.compose(_p, _q, _s);
        this.halos.setMatrixAt(halos, _m);
        this.halos.setColorAt(halos, _c);
        halos++;
      }
      if (p.source !== 'drop' && p.source !== 'supply' && columns < 16) {
        // The column of light that says "go get that" from across a zone.
        _c.set(PICKUP_LOOK[p.kind].color).multiplyScalar(1.1);
        _s.set(1.1, 22, 1);
        _m.compose(p.position, _q.identity(), _s);
        this.columns.setMatrixAt(columns, _m);
        this.columns.setColorAt(columns, _c);
        columns++;
      }
    }

    for (const m of this.meshes.values()) m.flush();
    this.halos.count = halos;
    this.halos.instanceMatrix.needsUpdate = halos > 0;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = halos > 0;
    this.columns.count = columns;
    this.columns.instanceMatrix.needsUpdate = columns > 0;
    if (this.columns.instanceColor) this.columns.instanceColor.needsUpdate = columns > 0;
  }

  /** Mega Health overheal bleeds back to max, the same pressure that makes Quake's feel like a loan. */
  private decayOverheal(dt: number): void {
    const { player } = this.ctx;
    if (player.health <= player.maxHealth) return;
    player.health = Math.max(player.maxHealth, player.health - MEGA.decayPerSecond * dt);
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.remove(i);
    this.slots.length = 0;
    this.bag.length = 0;
    this.clock = 0;
    this.supplyIn = P.supplyEvery;
    this.capsuleIn = CAPSULE.firstAt;
    for (const m of this.meshes.values()) m.flush();
    this.halos.count = 0;
    this.columns.count = 0;
  }
}
