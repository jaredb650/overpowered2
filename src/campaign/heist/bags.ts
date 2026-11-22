/**
 * Payday-style Gold Bullion Pallets, Encumbered Carry/Throw Duffels &
 * Armored Bureau Getaway Humvee Extraction for Mission 4 ("Bank Run").
 *
 * Gameplay loop:
 *   1. Hold [E] (1.0 s) at any of the 7 GOLD_PALLETS inside the vault to pack a Bureau Recovery Duffel.
 *   2. Carrying encumbers movement speed to 0.76x while leaving weapons fully usable.
 *   3. Press [G] (or dropWeapon) to heave the duffel forward in a real Rapier dynamic ballistic arc.
 *   4. Walk into / press [E] at the Humvee tailgate OR heave a bag directly into the cargo bed to secure it.
 *   5. At 4/4 mandatory bags (`bk:bags_quota`), either haul the 3 bonus bullion pallets (+$2,500 each)
 *      or mount the roof .50 cal turret (`bk:mount_turret`) to trigger the highway escape!
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import { groups } from '../../physics/Physics';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { div, Label, span } from '../../ui/dom';
import { hull } from '../../vehicles/loft';
import {
  BANK_HUB,
  BONUS_BAG_VALUE,
  GOLD_PALLETS,
  HUMVEE_BED_POS,
  HUMVEE_PARK_POS,
  HUMVEE_TURRET_POS,
  MANDATORY_BAGS,
} from '../../world/map/bank/plan';

export const BAG_CARRY_SPEED = 0.76;
export const BAG_PACK_HOLD = 1.0;
export const BAG_INTERACT_REACH = 2.8;
export const BAG_THROW_SPEED = 11.5;
export const BAG_THROW_UP = 4.2;
export const BAG_HALF_EXTENTS = [0.38, 0.22, 0.24] as const;
export const BAG_VOID_Y = -6;
export const HUMVEE_AUTO_DEPOSIT_REACH = 2.4;
export const HUMVEE_PROMPT_DEPOSIT_REACH = 3.2;
export const HUMVEE_BED_CATCH_RADIUS = 2.5;
export const HUMVEE_TURRET_REACH = 3.6;
export const MANDATORY_BAG_SCORE = 1500;

const THROW_PICKUP_GRACE = 0.35;
const FALLBACK_GRAVITY = -19;
const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];

const _bedPos = new THREE.Vector3(HUMVEE_BED_POS[0], HUMVEE_BED_POS[1], HUMVEE_BED_POS[2]);
const _turretPos = new THREE.Vector3(HUMVEE_TURRET_POS[0], HUMVEE_TURRET_POS[1], HUMVEE_TURRET_POS[2]);
const _parkPos = new THREE.Vector3(HUMVEE_PARK_POS[0], HUMVEE_PARK_POS[1], HUMVEE_PARK_POS[2]);
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Neatly stacked positions inside the Getaway Humvee's open cargo bed (local Humvee space, tail at +Z). */
const BED_STACK_SLOTS: readonly (readonly [number, number, number, number])[] = [
  [-0.44, 1.24, 1.48, 0.08],
  [0.44, 1.24, 1.48, -0.06],
  [-0.42, 1.24, 2.02, -0.05],
  [0.42, 1.24, 2.02, 0.09],
  [0.0, 1.56, 1.55, 0.04],
  [-0.32, 1.56, 1.98, -0.1],
  [0.34, 1.56, 1.98, 0.12],
];

export interface PalletState {
  readonly id: string;
  readonly bonus: boolean;
  readonly position: THREE.Vector3;
  packed: boolean;
  readonly root: THREE.Group;
  readonly barsGroup: THREE.Group;
  unmark: (() => void) | null;
}

export interface DroppedBag {
  readonly id: number;
  readonly bonus: boolean;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly mesh: THREE.Group;
  readonly beaconMat: THREE.MeshBasicMaterial;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  unmark: (() => void) | null;
  age: number;
}

interface BagsHudDom {
  counterEl: HTMLElement;
  counterLabel: Label;
  bonusLabel: Label;
  carryEl: HTMLElement;
  carryLabel: Label;
}

function buildPalletBase(): ModelBuilder {
  const b = new ModelBuilder();
  const wood = '#73512f';
  const woodDark = '#52381f';
  const steel = '#2c323a';

  // Industrial wooden/steel pallet deck (1.28 x 0.16 x 1.04 m)
  for (const sz of [-0.42, 0, 0.42]) {
    b.box(1.26, 0.05, 0.2, wood, { at: [0, 0.135, sz] });
  }
  for (const sx of [-0.52, 0, 0.52]) {
    b.box(0.11, 0.11, 1.02, woodDark, { at: [sx, 0.055, 0] });
  }
  // Steel corner reinforcements & straps
  for (const sx of [-0.62, 0.62]) {
    for (const sz of [-0.5, 0.5]) {
      b.box(0.08, 0.16, 0.08, steel, { at: [sx, 0.08, sz] });
    }
  }
  return b;
}

function buildGoldBarsStack(goldMat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  // Gleaming trapezoid-proportioned gold bullion bars stacked in 3 crisp tiers
  const barGeo = new THREE.BoxGeometry(0.22, 0.095, 0.42);
  // Tier 1: 4 x 2 = 8 bars
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const m = new THREE.Mesh(barGeo, goldMat);
      m.position.set(-0.39 + col * 0.26, 0.21, -0.23 + row * 0.46);
      group.add(m);
    }
  }
  // Tier 2: 3 x 2 = 6 bars
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const m = new THREE.Mesh(barGeo, goldMat);
      m.position.set(-0.26 + col * 0.26, 0.31, -0.22 + row * 0.44);
      group.add(m);
    }
  }
  // Tier 3: 2 x 2 = 4 crowning bars
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const m = new THREE.Mesh(barGeo, goldMat);
      m.position.set(-0.13 + col * 0.26, 0.41, -0.2 + row * 0.4);
      group.add(m);
    }
  }
  return group;
}

function buildDuffelMesh(materials: ModelMaterials, goldMat: THREE.Material, includeBeacon: boolean): {
  group: THREE.Group;
  beaconMat: THREE.MeshBasicMaterial | null;
} {
  const b = new ModelBuilder();
  const nylon = '#181c22';
  const nylonLight = '#262c35';
  const crimson = '#a8261e';
  const strap = '#111317';

  // Tactical black-and-gold Bureau Recovery Duffel (~0.76 x 0.44 x 0.48 m)
  b.box(0.72, 0.38, 0.44, nylon, { at: [0, 0, 0] });
  b.box(0.64, 0.42, 0.36, nylonLight, { at: [0, 0.01, 0] });
  // Twin carry straps & Bureau crimson patch
  for (const sx of [-0.18, 0.18]) {
    b.box(0.055, 0.44, 0.46, strap, { at: [sx, 0, 0] });
  }
  b.box(0.24, 0.08, 0.46, crimson, { at: [0, 0.12, 0] });
  // Side zipper pocket tabs
  for (const sx of [-0.37, 0.37]) {
    b.box(0.03, 0.24, 0.32, nylonLight, { at: [sx, -0.02, 0] });
  }
  const group = materials.group(b);

  // Gleaming metallic gold trim stripes & peeking bullion bar under top flap
  const stripeGeo = new THREE.BoxGeometry(0.74, 0.045, 0.46);
  const stripe = new THREE.Mesh(stripeGeo, goldMat);
  stripe.position.set(0, -0.04, 0);
  group.add(stripe);

  const ingotPeek = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.16), goldMat);
  ingotPeek.position.set(0, 0.21, 0);
  group.add(ingotPeek);

  let beaconMat: THREE.MeshBasicMaterial | null = null;
  if (includeBeacon) {
    beaconMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffd447').multiplyScalar(3.2),
      transparent: true,
      opacity: 0.75,
      toneMapped: false,
      fog: false,
    });
    const beacon = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.44, 18), beaconMat);
    beacon.rotation.x = -Math.PI / 2;
    beacon.position.set(0, 0.25, 0);
    group.add(beacon);
  }
  return { group, beaconMat };
}

function addHumveeWheel(b: ModelBuilder, x: number, z: number): void {
  const r = 0.52;
  const w = 0.34;
  b.cyl(r, r, w, 14, '#14171a', { at: [x, r, z], rot: ALONG_X });
  b.cyl(r * 0.54, r * 0.54, w + 0.05, 10, '#2c323a', { at: [x, r, z], rot: ALONG_X });
  b.cyl(r * 0.22, r * 0.22, w + 0.08, 8, '#b82a20', { at: [x, r, z], rot: ALONG_X });
}

/**
 * Builds the Armored Bureau Getaway Humvee in local space where nose is along -Z and open cargo bed
 * + lowered tailgate are along +Z. When placed at HUMVEE_PARK_POS with `yaw = Math.PI`, the nose
 * faces south (+Z) toward the highway escape and the lowered tailgate opens directly onto HUMVEE_BED_POS
 * facing north (-Z) toward the bank front steps!
 */
function buildGetawayHumvee(materials: ModelMaterials): {
  root: THREE.Group;
  beaconRotor: THREE.Group;
  beaconMat: THREE.MeshBasicMaterial;
} {
  const b = new ModelBuilder();
  const black = '#181c22';
  const charcoal = '#252b34';
  const gunmetal = '#363e4a';
  const crimson = '#b82a20';
  const hazard = '#d9a422';
  const glass = '#0a1118';

  // Lower armored tub & chassis
  b.box(2.14, 0.46, 5.0, black, { at: [0, 0.82, 0] });
  // Sloped armored hood toward nose (-Z)
  b.solid(
    hull([
      { z: -2.48, w: 0.98, top: 1.28, bottom: 0.98 },
      { z: -1.6, w: 1.06, top: 1.5, bottom: 0.98 },
      { z: -0.72, w: 1.08, top: 1.62, bottom: 0.98 },
    ]),
    charcoal,
  );
  // Front slatted armored grille, heavy push-bar bumper & glowing headlights at nose (-Z)
  for (let i = 0; i < 5; i++) {
    b.box(1.4, 0.03, 0.025, gunmetal, { at: [0, 1.04 + i * 0.05, -2.5] });
  }
  b.box(2.12, 0.14, 0.12, gunmetal, { at: [0, 0.68, -2.64] });
  for (const s of [-1, 1]) {
    b.box(0.08, 0.72, 0.08, gunmetal, { at: [s * 0.86, 1.02, -2.6] });
    b.box(0.32, 0.12, 0.06, crimson, { at: [s * 0.74, 0.68, -2.7] });
    b.glow(new THREE.CircleGeometry(0.11, 10), '#ffe4a8', 3.4, {
      at: [s * 0.7, 1.2, -2.52],
      rot: [0, Math.PI, 0],
    });
  }
  b.box(1.86, 0.06, 0.06, gunmetal, { at: [0, 1.36, -2.6] });

  // Armored cab with Bureau crimson livery stripes & tinted ballistic glass
  b.box(2.18, 0.62, 1.52, charcoal, { at: [0, 1.32, -0.02] });
  for (const s of [-1, 1]) {
    b.box(0.04, 0.14, 4.4, crimson, { at: [s * 1.09, 1.18, 0.1] });
    b.box(0.04, 0.44, 0.6, black, { at: [s * 1.1, 1.36, -0.34] });
    b.box(0.04, 0.44, 0.6, black, { at: [s * 1.1, 1.36, 0.34] });
    b.box(0.05, 0.34, 0.56, glass, { at: [s * 1.08, 1.8, -0.1] });
    b.box(0.12, 0.06, 0.16, black, { at: [s * 1.16, 1.78, -0.72] });
  }
  b.solid(
    hull([
      { z: -0.84, w: 1.03, top: 1.92, bottom: 1.6 },
      { z: -0.36, w: 1.06, top: 2.04, bottom: 1.6 },
      { z: 0.72, w: 1.06, top: 2.04, bottom: 1.6 },
    ]),
    black,
  );
  b.box(1.82, 0.36, 0.05, glass, { at: [0, 1.76, -0.86], rot: [0.28, 0, 0] });

  // Open rear cargo bed (+Z) with side rails and lowered tailgate ramp facing bank steps!
  for (const s of [-1, 1]) {
    b.box(0.11, 0.54, 1.9, charcoal, { at: [s * 1.05, 1.28, 1.66] });
    b.box(0.12, 0.08, 0.36, hazard, { at: [s * 1.06, 1.06, 2.52] });
    // Rear amber/red tail lamps flanking the open cargo bed
    b.glow(new THREE.BoxGeometry(0.12, 0.22, 0.05), '#ff3b28', 2.6, { at: [s * 0.98, 1.24, 2.62] });
  }
  b.box(1.98, 0.06, 1.86, gunmetal, { at: [0, 1.04, 1.66] });
  // Lowered open tailgate ramp protruding toward +Z (toward bank steps)
  b.box(2.04, 0.08, 0.68, charcoal, { at: [0, 0.98, 2.9], rot: [0.22, 0, 0] });
  b.box(1.88, 0.04, 0.12, hazard, { at: [0, 0.94, 3.16], rot: [0.22, 0, 0] });

  // Roof .50 cal turret ring & pintle-mounted heavy machine gun
  b.solid(new THREE.TorusGeometry(0.52, 0.07, 6, 18), gunmetal, {
    at: [0, 2.08, 0.15],
    rot: [Math.PI / 2, 0, 0],
  });
  b.cyl(0.06, 0.08, 0.42, 8, gunmetal, { at: [0, 2.28, 0.15] });
  // .50 cal armored gun shield & long perforated barrel
  b.box(0.68, 0.42, 0.06, black, { at: [0, 2.52, 0.36] });
  b.box(0.64, 0.06, 0.08, crimson, { at: [0, 2.7, 0.36] });
  b.box(0.2, 0.22, 0.66, gunmetal, { at: [0, 2.48, 0.16] });
  b.cyl(0.045, 0.055, 1.28, 8, '#1a1e24', { at: [0, 2.5, 0.96], rot: [Math.PI / 2, 0, 0] });
  b.box(0.18, 0.24, 0.26, '#3c4a2e', { at: [0.22, 2.46, 0.12] });

  // 4 armored off-road tires
  addHumveeWheel(b, -1.1, -1.68);
  addHumveeWheel(b, 1.1, -1.68);
  addHumveeWheel(b, -1.1, 1.62);
  addHumveeWheel(b, 1.1, 1.62);

  const root = materials.group(b);
  root.position.copy(_parkPos);
  root.rotation.y = Math.PI;

  // Spinning/flashing amber roof load beacon above the cab
  const beaconRotor = new THREE.Group();
  beaconRotor.position.set(-0.62, 2.14, -0.32);
  const beaconBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, 0.08, 10),
    materials.solid,
  );
  beaconRotor.add(beaconBase);
  const beaconMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffb400').multiplyScalar(3.6),
    toneMapped: false,
    fog: false,
  });
  const beaconLens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.14, 10), beaconMat);
  beaconLens.position.y = 0.11;
  beaconRotor.add(beaconLens);
  const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.04), beaconMat);
  reflector.position.set(0, 0.11, 0.05);
  beaconRotor.add(reflector);
  root.add(beaconRotor);

  return { root, beaconRotor, beaconMat };
}

export class LootBags {
  private readonly materials: ModelMaterials;
  private readonly goldMat: THREE.MeshStandardMaterial;
  private readonly pallets: PalletState[] = [];
  private readonly droppedBags: DroppedBag[] = [];
  private readonly humveeRoot: THREE.Group;
  private readonly humveeBeaconRotor: THREE.Group;
  private readonly humveeBeaconMat: THREE.MeshBasicMaterial;
  private readonly bedStackMeshes: THREE.Group[] = [];

  private hudDom: BagsHudDom | null = null;

  private _active = false;
  private _carrying = false;
  private _carryingBonus = false;
  private _secured = 0;
  private _bonusSecured = 0;
  private _packedCount = 0;
  private _holdProgress = 0;
  private _turretMounted = false;

  private savedSpeedMod: number | null = null;
  private firstPackSignalled = false;
  private quotaSignalled = false;
  private nextBagId = 1;
  private pulseClock = 0;
  private packingPalletId: string | null = null;
  private throwKeyLatched = false;

  private humveeMarker: (() => void) | null = null;
  private turretMarker: (() => void) | null = null;
  private promptRemover: (() => void) | null = null;
  private promptKey = '';

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this._active || !this._carrying || e.repeat) return;
    if (e.code !== 'KeyG') return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    this.throwKeyLatched = true;
  };

  constructor(
    private readonly ctx: Ctx,
    private readonly onSignal: (sig: string) => void,
  ) {
    this.materials = new ModelMaterials(ctx);
    this.goldMat = ctx.render.materials.patch(
      new THREE.MeshStandardMaterial({
        color: '#e5b832',
        metalness: 0.92,
        roughness: 0.18,
        emissive: '#382504',
        emissiveIntensity: 0.22,
      }),
    );

    // 1. Build all 7 Gold Bullion Pallets inside the Planetary Bullion Vault
    const baseProto = buildPalletBase();
    for (const spec of GOLD_PALLETS) {
      const root = new THREE.Group();
      root.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      root.add(this.materials.group(baseProto));
      const barsGroup = buildGoldBarsStack(this.goldMat);
      root.add(barsGroup);
      ctx.render.scene.add(root);

      this.pallets.push({
        id: spec.id,
        bonus: spec.bonus,
        position: new THREE.Vector3(spec.pos[0], spec.pos[1], spec.pos[2]),
        packed: false,
        root,
        barsGroup,
        unmark: null,
      });
    }

    // 2. Build Armored Bureau Getaway Humvee (hidden until activate())
    const humvee = buildGetawayHumvee(this.materials);
    this.humveeRoot = humvee.root;
    this.humveeBeaconRotor = humvee.beaconRotor;
    this.humveeBeaconMat = humvee.beaconMat;
    this.humveeRoot.visible = false;

    // Pre-build 7 stacked gold-striped duffel visuals in the Humvee's open cargo bed
    for (const [bx, by, bz, ry] of BED_STACK_SLOTS) {
      const { group } = buildDuffelMesh(this.materials, this.goldMat, false);
      group.position.set(bx, by, bz);
      group.rotation.y = ry;
      group.visible = false;
      this.humveeRoot.add(group);
      this.bedStackMeshes.push(group);
    }
    ctx.render.scene.add(this.humveeRoot);

    this.hudDom = this.buildHudDom();

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }
  }

  // ---------------------------------------------------------------------------
  // Public Getters
  // ---------------------------------------------------------------------------

  get active(): boolean {
    return this._active;
  }

  get carrying(): boolean {
    return this._carrying;
  }

  get carryingBonus(): boolean {
    return this._carryingBonus;
  }

  get secured(): number {
    return this._secured;
  }

  get bonusSecured(): number {
    return this._bonusSecured;
  }

  get packedCount(): number {
    return this._packedCount;
  }

  get holdProgress(): number {
    return this._holdProgress;
  }

  get quotaMet(): boolean {
    return this._secured >= MANDATORY_BAGS;
  }

  get turretMounted(): boolean {
    return this._turretMounted;
  }

  get dropped(): readonly DroppedBag[] {
    return this.droppedBags;
  }

  get humveeYaw(): number {
    return this.humveeRoot.rotation.y;
  }

  get humveeVisible(): boolean {
    return this.humveeRoot.visible;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Enables gold pallet packing, reveals the Getaway Humvee, and opens the loot HUD. */
  activate(): void {
    if (this._active) return;
    this._active = true;
    this.humveeRoot.visible = true;
    this.setHudVisible(true);

    for (const p of this.pallets) {
      if (!p.packed && !p.unmark && this.ctx.hud?.marker) {
        p.unmark = this.ctx.hud.marker(
          new THREE.Vector3(p.position.x, p.position.y + 1.25, p.position.z),
          p.bonus ? 'BONUS GOLD' : 'GOLD BULLION',
          p.bonus ? '#7ee787' : '#ffd447',
        );
      }
    }

    if (!this.humveeMarker && this.ctx.hud?.marker) {
      this.humveeMarker = this.ctx.hud.marker(
        new THREE.Vector3(_bedPos.x, _bedPos.y + 1.4, _bedPos.z),
        'HUMVEE CARGO',
        '#ffb400',
      );
    }

    this.updateHud();
  }

  /** Programmatically heaves the currently carried gold duffel forward in a ballistic arc. */
  throwBag(): DroppedBag | null {
    if (!this._active || !this._carrying) return null;
    const isBonus = this._carryingBonus;
    this.setCarrying(false);

    const player = this.ctx.player;
    if (player.forward && player.forward.lengthSq() > 0.001) {
      _fwd.copy(player.forward).normalize();
    } else {
      const yaw = player.yaw ?? 0;
      _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    }

    const eye = player.eye ?? _v.set(player.position.x, player.position.y + 1.55, player.position.z);
    const spawnPos = new THREE.Vector3(
      eye.x + _fwd.x * 0.85,
      eye.y + _fwd.y * 0.45 - 0.1,
      eye.z + _fwd.z * 0.85,
    );
    const launchVel = new THREE.Vector3(
      _fwd.x * BAG_THROW_SPEED,
      _fwd.y * BAG_THROW_SPEED + BAG_THROW_UP,
      _fwd.z * BAG_THROW_SPEED,
    );

    const { group, beaconMat } = buildDuffelMesh(this.materials, this.goldMat, true);
    group.position.copy(spawnPos);
    this.ctx.render.scene.add(group);

    let body: RAPIER.RigidBody | null = null;
    let collider: RAPIER.Collider | null = null;
    const phys = this.ctx.physics;
    if (
      phys?.R?.RigidBodyDesc &&
      phys?.R?.ColliderDesc &&
      phys?.world &&
      typeof phys.world.createRigidBody === 'function' &&
      typeof phys.world.createCollider === 'function'
    ) {
      const rbDesc = phys.R.RigidBodyDesc.dynamic()
        .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
        .setLinvel(launchVel.x, launchVel.y, launchVel.z)
        .setAngvel({ x: rand(-3.5, 3.5), y: rand(-2.5, 2.5), z: rand(-3.5, 3.5) })
        .setLinearDamping(0.32)
        .setAngularDamping(0.55);
      body = phys.world.createRigidBody(rbDesc);

      const colDesc = phys.R.ColliderDesc.cuboid(
        BAG_HALF_EXTENTS[0],
        BAG_HALF_EXTENTS[1],
        BAG_HALF_EXTENTS[2],
      )
        .setCollisionGroups(groups(CG.Debris, CG.World | CG.Debris))
        .setRestitution(0.26)
        .setFriction(0.85)
        .setDensity(3.8);
      collider = phys.world.createCollider(colDesc, body);
    }

    const livePos = spawnPos.clone();
    const bag: DroppedBag = {
      id: this.nextBagId++,
      bonus: isBonus,
      position: livePos,
      velocity: launchVel.clone(),
      mesh: group,
      beaconMat: beaconMat!,
      body,
      collider,
      unmark: this.ctx.hud?.follow
        ? this.ctx.hud.follow(livePos, 'GOLD DUFFEL', '#ffd447')
        : null,
      age: 0,
    };

    this.droppedBags.push(bag);
    this.playSafe('sword_swing', { position: spawnPos, pitch: 0.72, volume: 0.55 });
    this.updateHud();
    return bag;
  }

  /** Frame tick. */
  update(dt: number): void {
    if (!this._active || dt <= 0) return;
    this.pulseClock += dt;

    // Spin & pulse the Getaway Humvee's amber roof load beacon
    this.humveeBeaconRotor.rotation.y += dt * 7.5;
    const beaconPulse = 2.6 + Math.sin(this.pulseClock * 11) * 1.1;
    this.humveeBeaconMat.color.set('#ffb400').multiplyScalar(beaconPulse);

    // 1. Update thrown dynamic bags (sync Rapier / fallback arc, void safety net, cargo-bed catch)
    this.updateDroppedBags(dt);

    if (this._turretMounted) return;

    // 2. Check player carry actions (auto-deposit, tailgate load, [G] heave, or turret mount)
    const throwPressed = this.consumeThrowInput();
    if (this._carrying) {
      const handled = this.updateCarrying(throwPressed);
      if (handled) {
        this.updateHud();
        return;
      }
    } else {
      // 3. Not carrying: check turret mount (if quota met), dropped bag pickup, or gold pallet hold-pack
      if (this.updateTurretMountPrompt()) {
        this.updateHud();
        return;
      }
      if (this.updateDroppedPickup()) {
        this.updateHud();
        return;
      }
      this.updatePalletPacking(dt);
    }

    this.updateHud();
  }

  /** Cleanly disposes dynamic bodies, clears markers/HUD, resets pallets, and restores speed modifier. */
  clear(): void {
    this._active = false;
    this.throwKeyLatched = false;
    this.clearPrompt();
    this.clearDroppedBags();
    this.restoreSpeedModifier();

    for (const p of this.pallets) {
      p.unmark?.();
      p.unmark = null;
      p.packed = false;
      p.barsGroup.visible = true;
    }

    this.humveeMarker?.();
    this.humveeMarker = null;
    this.turretMarker?.();
    this.turretMarker = null;

    this.humveeRoot.visible = false;
    for (const m of this.bedStackMeshes) m.visible = false;

    this._carrying = false;
    this._carryingBonus = false;
    this._secured = 0;
    this._bonusSecured = 0;
    this._packedCount = 0;
    this._holdProgress = 0;
    this._turretMounted = false;
    this.packingPalletId = null;
    this.firstPackSignalled = false;
    this.quotaSignalled = false;
    this.pulseClock = 0;

    this.setHudVisible(false);
  }

  /** Resets all loot bag & Humvee state back to initial clean values. */
  reset(): void {
    this.clear();
  }

  /** Removes meshes, listeners, and HUD DOM nodes permanently. */
  dispose(): void {
    this.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    for (const p of this.pallets) {
      p.root.removeFromParent();
    }
    this.humveeRoot.removeFromParent();
    this.humveeBeaconMat.dispose();
    this.goldMat.dispose();
    this.hudDom?.counterEl.remove();
    this.hudDom?.carryEl.remove();
    this.hudDom = null;
  }

  // ---------------------------------------------------------------------------
  // Carrying, Throwing & Depositing
  // ---------------------------------------------------------------------------

  private consumeThrowInput(): boolean {
    const keyG = this.throwKeyLatched;
    this.throwKeyLatched = false;
    const dropPressed =
      typeof this.ctx.input?.pressed === 'function' && this.ctx.input.pressed('dropWeapon');
    return keyG || dropPressed;
  }

  private setCarrying(on: boolean, bonus = false): void {
    if (on) {
      if (!this._carrying) {
        if (this.savedSpeedMod === null && this.ctx.player?.modifiers) {
          this.savedSpeedMod = this.ctx.player.modifiers.speed;
        }
        if (this.ctx.player?.modifiers) {
          this.ctx.player.modifiers.speed = BAG_CARRY_SPEED;
        }
      }
      this._carrying = true;
      this._carryingBonus = bonus;
    } else {
      this._carrying = false;
      this._carryingBonus = false;
      this.restoreSpeedModifier();
    }
  }

  private restoreSpeedModifier(): void {
    if (!this.ctx.player?.modifiers) {
      this.savedSpeedMod = null;
      return;
    }
    if (this.savedSpeedMod !== null) {
      this.ctx.player.modifiers.speed = this.savedSpeedMod;
      this.savedSpeedMod = null;
    } else if (this.ctx.player.modifiers.speed === BAG_CARRY_SPEED) {
      this.ctx.player.modifiers.speed = 1;
    }
  }

  private updateCarrying(throwPressed: boolean): boolean {
    const p = this.ctx.player;
    if (!p?.alive) {
      this.clearPrompt();
      return false;
    }

    const bedDist = p.position.distanceTo(_bedPos);
    const bedHoriz = Math.hypot(p.position.x - _bedPos.x, p.position.z - _bedPos.z);

    // 1. Auto-deposit when walking right up to the lowered tailgate (< 2.4 m)
    if (bedDist <= HUMVEE_AUTO_DEPOSIT_REACH || (bedHoriz <= HUMVEE_AUTO_DEPOSIT_REACH && Math.abs(p.position.y - _bedPos.y) <= 2.2)) {
      const isBonus = this._carryingBonus;
      this.setCarrying(false);
      this.clearPrompt();
      this.recordSecuredBag(isBonus);
      return true;
    }

    // 2. If quota is already met and player stands at the roof turret while carrying, [E] auto-deposits & mounts!
    if (this.quotaMet && this.isNearTurret()) {
      const key = this.interactKey();
      this.setPrompt('mount_carry', `[${key}] MOUNT .50 CAL & GO`, '#7ee787', _turretPos);
      if (this.ctx.input.pressed('interact')) {
        const isBonus = this._carryingBonus;
        this.setCarrying(false);
        this.recordSecuredBag(isBonus);
        this.mountTurret();
        return true;
      }
    } else if (bedDist <= HUMVEE_PROMPT_DEPOSIT_REACH || (bedHoriz <= HUMVEE_PROMPT_DEPOSIT_REACH && Math.abs(p.position.y - _bedPos.y) <= 2.4)) {
      // 3. Close to tailgate (2.4..3.2 m): [E] or [G] tosses straight into the cargo bed!
      const key = this.interactKey();
      this.setPrompt('load_bed', `[${key}] LOAD GOLD INTO HUMVEE`, '#ffd447', _bedPos);
      if (this.ctx.input.pressed('interact') || throwPressed) {
        const isBonus = this._carryingBonus;
        this.setCarrying(false);
        this.clearPrompt();
        this.recordSecuredBag(isBonus);
        return true;
      }
      return true;
    } else {
      this.clearPrompt();
    }

    // 4. Heave bag forward on [G] / dropWeapon
    if (throwPressed) {
      this.throwBag();
      return true;
    }

    return false;
  }

  private updateDroppedBags(dt: number): void {
    for (let i = this.droppedBags.length - 1; i >= 0; i--) {
      const bag = this.droppedBags[i]!;
      bag.age += dt;

      if (bag.body) {
        const t = bag.body.translation();
        const r = bag.body.rotation();
        bag.position.set(t.x, t.y, t.z);
        bag.mesh.position.copy(bag.position);
        bag.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      } else {
        // Deterministic ballistic fallback when Rapier WASM is not present (e.g. unit tests)
        bag.velocity.y += FALLBACK_GRAVITY * dt;
        bag.position.addScaledVector(bag.velocity, dt);
        const navY = this.ctx.world?.nav?.groundHeight?.(bag.position.x, bag.position.y + 1, bag.position.z);
        const floorY = Number.isFinite(navY) ? navY! : bag.position.z < -20 ? -1.5 : 0;
        if (bag.position.y < floorY + BAG_HALF_EXTENTS[1] && bag.position.y > BAG_VOID_Y) {
          bag.position.y = floorY + BAG_HALF_EXTENTS[1];
          if (bag.velocity.y < -1.5) {
            bag.velocity.y = -bag.velocity.y * 0.25;
            bag.velocity.x *= 0.65;
            bag.velocity.z *= 0.65;
          } else {
            bag.velocity.set(bag.velocity.x * Math.max(0, 1 - dt * 6), 0, bag.velocity.z * Math.max(0, 1 - dt * 6));
          }
        }
        bag.mesh.position.copy(bag.position);
      }

      // Pulse gold beacon on dropped floor duffel
      const pulse = 0.55 + Math.sin(this.pulseClock * 7 + bag.id) * 0.3;
      bag.beaconMat.opacity = pulse;

      // Void safety net: teleport lost bags safely back onto BANK_HUB
      if (bag.position.y < BAG_VOID_Y) {
        bag.position.set(BANK_HUB.x, BANK_HUB.y + 0.45, BANK_HUB.z);
        bag.velocity.set(0, 0, 0);
        if (bag.body) {
          bag.body.setTranslation({ x: bag.position.x, y: bag.position.y, z: bag.position.z }, true);
          bag.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          bag.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        bag.mesh.position.copy(bag.position);
        this.ctx.hud.feed('BULLION BAG RECOVERED TO BANKING HALL', '#ffd447');
      }

      // Cargo-bed catch: any thrown duffel entering within 2.5 m of HUMVEE_BED_POS secures instantly!
      if (bag.position.distanceTo(_bedPos) <= HUMVEE_BED_CATCH_RADIUS) {
        const isBonus = bag.bonus;
        this.removeDroppedBagAt(i);
        this.recordSecuredBag(isBonus);
      }
    }
  }

  private updateDroppedPickup(): boolean {
    const p = this.ctx.player;
    if (!p?.alive || p.parked) return false;

    let nearestIdx = -1;
    let nearestDist = BAG_INTERACT_REACH;

    for (let i = 0; i < this.droppedBags.length; i++) {
      const bag = this.droppedBags[i]!;
      if (bag.age < THROW_PICKUP_GRACE) continue;
      const d = p.position.distanceTo(bag.position);
      if (d <= nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    if (nearestIdx < 0) return false;
    const bag = this.droppedBags[nearestIdx]!;
    const key = this.interactKey();
    this.setPrompt(`pickup:${bag.id}`, `[${key}] PICK UP GOLD BULLION`, '#ffd447', bag.position);

    if (this.ctx.input.pressed('interact')) {
      const isBonus = bag.bonus;
      this.removeDroppedBagAt(nearestIdx);
      this.clearPrompt();
      this.setCarrying(true, isBonus);
      this.playSafe('pickup_generic', { position: p.position, pitch: 0.95, volume: 0.7 });
    }
    return true;
  }

  private updatePalletPacking(dt: number): void {
    const p = this.ctx.player;
    if (!p?.alive || p.parked) {
      this.resetPackHold();
      this.clearPrompt();
      return;
    }

    let nearest: PalletState | null = null;
    let nearestDist = BAG_INTERACT_REACH;
    for (const pallet of this.pallets) {
      if (pallet.packed) continue;
      const dx = p.position.x - pallet.position.x;
      const dz = p.position.z - pallet.position.z;
      const dy = Math.abs(p.position.y - pallet.position.y);
      const d = Math.hypot(dx, dz);
      if (d <= nearestDist && dy <= 2.8) {
        nearestDist = d;
        nearest = pallet;
      }
    }

    if (!nearest) {
      this.resetPackHold();
      this.clearPrompt();
      return;
    }

    if (this.packingPalletId !== nearest.id) {
      this.packingPalletId = nearest.id;
      this._holdProgress = 0;
    }

    const key = this.interactKey();
    const pct = Math.round(this._holdProgress * 100);
    const kindLabel = nearest.bonus ? 'BONUS GOLD BULLION' : 'GOLD BULLION';
    const text =
      this._holdProgress > 0
        ? `PACKING ${kindLabel} (${pct}%)`
        : `HOLD [${key}] PACK ${kindLabel}`;
    this.setPrompt(`pack:${nearest.id}:${pct}`, text, nearest.bonus ? '#7ee787' : '#ffd447', nearest.position);

    if (this.ctx.input.isDown('interact')) {
      this._holdProgress = clamp(this._holdProgress + dt / BAG_PACK_HOLD, 0, 1);
      this.ctx.hud.hold?.(this._holdProgress);
      if (this._holdProgress >= 1) {
        this.completePack(nearest);
      }
    } else if (this._holdProgress > 0) {
      this._holdProgress = 0;
    }
  }

  private completePack(pallet: PalletState): void {
    pallet.packed = true;
    pallet.barsGroup.visible = false;
    pallet.unmark?.();
    pallet.unmark = null;

    this._packedCount++;
    this.resetPackHold();
    this.clearPrompt();
    this.setCarrying(true, pallet.bonus);

    this.ctx.hud.hold?.(1);
    this.playSafe('pickup_generic', { position: pallet.position, pitch: 1.08, volume: 0.75 });
    this.ctx.fx.pickupSparkle?.(
      _v.set(pallet.position.x, pallet.position.y + 0.5, pallet.position.z),
      '#ffd447',
    );
    this.ctx.hud.feed(
      pallet.bonus
        ? 'BONUS GOLD PACKED — HAUL TO GETAWAY HUMVEE!'
        : 'GOLD BULLION PACKED — PRESS [G] TO HEAVE OR CARRY TO HUMVEE',
      '#ffd447',
    );

    if (!this.firstPackSignalled) {
      this.firstPackSignalled = true;
      this.onSignal('bk:bag_packed');
    }
  }

  private recordSecuredBag(isBonusBag: boolean): void {
    this._secured++;
    const countsAsBonus = this._secured > MANDATORY_BAGS;
    if (countsAsBonus) {
      this._bonusSecured++;
    }

    // Reveal the next stacked black-and-gold duffel in the Humvee's open cargo bed
    const slot = this.bedStackMeshes[this._secured - 1];
    if (slot) slot.visible = true;

    const reward = countsAsBonus ? BONUS_BAG_VALUE : MANDATORY_BAG_SCORE;
    const reason = countsAsBonus ? 'BONUS BULLION SECURED' : 'GOLD DUFFEL SECURED';
    this.ctx.progression?.award?.(reward, reason, _bedPos);
    this.playSafe('pickup_weaponCache', { position: _bedPos, pitch: countsAsBonus ? 1.15 : 1.0, volume: 0.85 });
    this.playSafe('ui_confirm', { volume: 0.7 });
    this.ctx.fx.pickupSparkle?.(_bedPos, countsAsBonus ? '#7ee787' : '#ffd447');
    this.ctx.fx.sparks(_bedPos, _up, 12, '#ffd447');

    if (countsAsBonus) {
      this.ctx.hud.feed(
        `BONUS BULLION SECURED (+$${BONUS_BAG_VALUE.toLocaleString('en-US')})`,
        '#7ee787',
      );
    } else {
      const tag = isBonusBag ? 'BONUS ' : '';
      this.ctx.hud.feed(
        `${tag}GOLD DUFFEL SECURED (${this._secured}/${MANDATORY_BAGS})`,
        '#ffd447',
      );
    }

    if (this._secured >= MANDATORY_BAGS && !this.quotaSignalled) {
      this.quotaSignalled = true;
      this.enableTurretMarker();
      this.ctx.hud.feed(
        'QUOTA MET (4/4) — MOUNT .50 CAL ON HUMVEE OR GRAB BONUS GOLD!',
        '#7ee787',
      );
      this.onSignal('bk:bags_quota');
    }
  }

  private isNearTurret(): boolean {
    const p = this.ctx.player;
    if (!p?.alive || p.parked) return false;
    const horiz = Math.hypot(p.position.x - _turretPos.x, p.position.z - _turretPos.z);
    const dy = Math.abs(p.position.y - HUMVEE_PARK_POS[1]);
    return horiz <= HUMVEE_TURRET_REACH && dy <= 3.8;
  }

  private updateTurretMountPrompt(): boolean {
    if (!this.quotaMet || this._turretMounted) return false;
    if (!this.isNearTurret()) return false;

    const key = this.interactKey();
    this.setPrompt('mount_turret', `[${key}] MOUNT .50 CAL & GO`, '#7ee787', _turretPos);
    if (this.ctx.input.pressed('interact')) {
      this.mountTurret();
    }
    return true;
  }

  private mountTurret(): void {
    if (this._turretMounted) return;
    this._turretMounted = true;
    this.clearPrompt();
    this.humveeMarker?.();
    this.humveeMarker = null;
    this.turretMarker?.();
    this.turretMarker = null;
    this.restoreSpeedModifier();
    this.setHudVisible(false);
    this.playSafe('metal_clang', { position: _turretPos, pitch: 0.9, volume: 0.85 });
    this.ctx.hud.feed('MOUNTING HUMVEE .50 CAL — PUNCH IT!', '#7ee787');
    this.onSignal('bk:mount_turret');
  }

  // ---------------------------------------------------------------------------
  // Cleanup & Helpers
  // ---------------------------------------------------------------------------

  private removeDroppedBagAt(index: number): void {
    const bag = this.droppedBags[index];
    if (!bag) return;
    this.droppedBags.splice(index, 1);

    bag.unmark?.();
    bag.unmark = null;
    bag.mesh.removeFromParent();
    bag.beaconMat.dispose();

    const world = this.ctx.physics?.world;
    if (world) {
      if (bag.body && typeof world.removeRigidBody === 'function') {
        world.removeRigidBody(bag.body);
      } else if (bag.collider && typeof world.removeCollider === 'function') {
        world.removeCollider(bag.collider, true);
      }
    }
    bag.body = null;
    bag.collider = null;
  }

  private clearDroppedBags(): void {
    while (this.droppedBags.length > 0) {
      this.removeDroppedBagAt(this.droppedBags.length - 1);
    }
  }

  private resetPackHold(): void {
    this._holdProgress = 0;
    this.packingPalletId = null;
  }

  private enableTurretMarker(): void {
    if (this.turretMarker || !this.ctx.hud?.marker) return;
    this.turretMarker = this.ctx.hud.marker(
      new THREE.Vector3(_turretPos.x, _turretPos.y + 1.2, _turretPos.z),
      'MOUNT .50 CAL',
      '#7ee787',
    );
  }

  private interactKey(): string {
    return (typeof this.ctx.input?.labelFor === 'function' ? this.ctx.input.labelFor('interact') : '') || 'E';
  }

  private setPrompt(key: string, label: string, color: string, pos: THREE.Vector3): void {
    if (this.promptKey === key) return;
    this.clearPrompt();
    this.promptKey = key;
    if (this.ctx.hud?.follow) {
      this.promptRemover = this.ctx.hud.follow(
        new THREE.Vector3(pos.x, pos.y + 1.0, pos.z),
        label,
        color,
      );
    }
  }

  private clearPrompt(): void {
    this.promptRemover?.();
    this.promptRemover = null;
    this.promptKey = '';
  }

  private playSafe(id: string, opts?: { position?: THREE.Vector3; pitch?: number; volume?: number }): void {
    const audio = this.ctx.audio;
    if (!audio?.play) return;
    if (typeof audio.has === 'function' && !audio.has(id)) return;
    audio.play(id, opts);
  }

  // ---------------------------------------------------------------------------
  // Compact Bottom-Center Carry Badge & Bag Quota Counter HUD
  // ---------------------------------------------------------------------------

  private buildHudDom(): BagsHudDom | null {
    if (typeof document === 'undefined') return null;

    const counterLabelEl = span('bk-bags-count', `BAGS LOADED: 0 / ${MANDATORY_BAGS}`);
    const bonusLabelEl = span('bk-bags-bonus', '');
    bonusLabelEl.style.cssText = 'margin-left:0.65rem;color:#7ee787;font-size:0.85rem;';
    const counterEl = div('bk-bags-counter', counterLabelEl, bonusLabelEl);
    counterEl.style.cssText =
      'position:absolute;left:50%;top:3.4rem;transform:translateX(-50%);display:none;align-items:baseline;' +
      'padding:0.35rem 0.9rem;background:rgba(9,11,14,0.82);border-top:0.15rem solid #e5b832;' +
      'box-shadow:0.16rem 0.16rem 0 #000;font:700 1rem/1.2 var(--mono,monospace);letter-spacing:0.06em;' +
      'color:#ffd447;z-index:5;pointer-events:none;';

    const carryLabelEl = span('bk-carry-text', 'CARRYING GOLD BULLION — PRESS [G] TO HEAVE BAG');
    const carryEl = div('bk-carry-badge', carryLabelEl);
    carryEl.style.cssText =
      'position:absolute;left:50%;bottom:10.4rem;transform:translateX(-50%);display:none;' +
      'padding:0.4rem 1.05rem;background:rgba(20,16,6,0.88);border:0.12rem solid #e5b832;' +
      'box-shadow:0 0 1rem rgba(229,184,50,0.35),0.16rem 0.16rem 0 #000;' +
      'font:700 0.92rem/1.25 var(--mono,monospace);letter-spacing:0.07em;color:#fff3c4;' +
      'z-index:5;pointer-events:none;white-space:nowrap;';

    const mount = document.querySelector('.hud') ?? document.getElementById('ui') ?? document.body;
    mount?.append(counterEl, carryEl);

    return {
      counterEl,
      counterLabel: new Label(counterLabelEl),
      bonusLabel: new Label(bonusLabelEl),
      carryEl,
      carryLabel: new Label(carryLabelEl),
    };
  }

  private setHudVisible(on: boolean): void {
    if (!this.hudDom) return;
    this.hudDom.counterEl.style.display = on ? 'flex' : 'none';
    if (!on) {
      this.hudDom.carryEl.style.display = 'none';
    }
  }

  private updateHud(): void {
    const dom = this.hudDom;
    if (!dom) return;

    const mandatoryDone = Math.min(this._secured, MANDATORY_BAGS);
    dom.counterLabel.set(`BAGS LOADED: ${mandatoryDone} / ${MANDATORY_BAGS}`);
    dom.bonusLabel.set(
      this._bonusSecured > 0
        ? `+${this._bonusSecured} BONUS (+$${(this._bonusSecured * BONUS_BAG_VALUE).toLocaleString('en-US')})`
        : '',
    );

    if (this._carrying) {
      dom.carryEl.style.display = 'block';
      dom.carryLabel.set(
        this._carryingBonus
          ? 'CARRYING BONUS BULLION — PRESS [G] TO HEAVE BAG'
          : 'CARRYING GOLD BULLION — PRESS [G] TO HEAVE BAG',
      );
    } else {
      dom.carryEl.style.display = 'none';
    }
  }
}
