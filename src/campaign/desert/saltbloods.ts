/**
 * Saltblood Visual Styler — gives every bandit in Surplus a distinct desert raider silhouette:
 *   - Ochre / rust / sand desert scarf collar + hanging cloth tail
 *   - Brass-rimmed amber dust goggles across the visor
 *   - Welded sheet-metal scrap chest plate & asymmetrical shoulder pauldron
 *   - Heavier double-plated welded armor + dual pauldrons + brow guard for Plane guards
 *
 * Uses shared BufferGeometries & MeshStandardMaterials for negligible per-enemy cost,
 * attaches once per enemy `uid`, and safely cleans up pooled rigs before restyling.
 */
import * as THREE from 'three';
import { HumanoidBone } from '../../characters/rig';
import type { Ctx } from '../../core/contracts';
import type { EnemyId, EnemyInstance } from '../../core/gameplay';
import { DESERT_Z } from '../../world/map/desert/plan';

const GEAR_NAME = 'saltblood-gear';
export const QUIST_GEAR_NAME = 'quist-gear';

const HEAVY_ROLES: ReadonlySet<EnemyId> = new Set<EnemyId>(['warden', 'brute', 'riot', 'juggernaut']);

const SCARF_HEXES = ['#b86d2e', '#8f4324', '#c98842'] as const;

/** Handle to interactive weapon/cuff props mounted onto the real Hadrek Quist Enemy rig. */
export interface QuistNpcProps {
  readonly root: THREE.Object3D;
  readonly groups: readonly THREE.Group[];
  readonly pistolHolstered: THREE.Group;
  readonly pistolInHand: THREE.Group;
  readonly grenadeInHand: THREE.Group;
  readonly redGlint: THREE.Mesh;
  readonly redGlintMat: THREE.MeshBasicMaterial;
  readonly zipTie: THREE.Group;
  setCuffed(cuffed: boolean): void;
}

interface SharedAssets {
  scarfCollarGeo: THREE.BufferGeometry;
  scarfTailGeo: THREE.BufferGeometry;
  goggleStrapGeo: THREE.BufferGeometry;
  goggleLensGeo: THREE.BufferGeometry;
  goggleRimGeo: THREE.BufferGeometry;
  browGuardGeo: THREE.BufferGeometry;
  chestPlateGeo: THREE.BufferGeometry;
  chestBoltGeo: THREE.BufferGeometry;
  heavyCuirassGeo: THREE.BufferGeometry;
  pauldronGeo: THREE.BufferGeometry;
  heavyPauldronGeo: THREE.BufferGeometry;
  scarfMats: THREE.MeshStandardMaterial[];
  strapMat: THREE.MeshStandardMaterial;
  rimMat: THREE.MeshStandardMaterial;
  lensMat: THREE.MeshStandardMaterial;
  scrapMat: THREE.MeshStandardMaterial;
  heavyScrapMat: THREE.MeshStandardMaterial;
  boltMat: THREE.MeshStandardMaterial;
}

function isPlaneGuard(enemy: EnemyInstance): boolean {
  if (HEAVY_ROLES.has(enemy.id)) return true;
  return enemy.position.z <= DESERT_Z.planeForecourt + 6;
}

/** Strips any Quist custom gear and clears the `desertQuist` marker (safe before recycling a rig). */
export function stripQuistGear(enemy: EnemyInstance | null | undefined): void {
  const char = enemy?.char;
  if (!char?.root) return;
  delete char.root.userData.desertQuist;
  const stripFrom = (parent: THREE.Object3D | undefined): void => {
    if (!parent) return;
    for (let i = parent.children.length - 1; i >= 0; i--) {
      const child = parent.children[i]!;
      if (child.name === QUIST_GEAR_NAME || child.name === GEAR_NAME) {
        parent.remove(child);
      }
    }
  };
  stripFrom(char.root);
  for (const b of char.bones ?? []) stripFrom(b);
}

interface QuistGeos {
  helmDome: THREE.SphereGeometry;
  helmBrim: THREE.CylinderGeometry;
  spike: THREE.ConeGeometry;
  nape: THREE.BoxGeometry;
  strap: THREE.TorusGeometry;
  goggleRim: THREE.TorusGeometry;
  goggleLens: THREE.CylinderGeometry;
  collar: THREE.TorusGeometry;
  tailFront: THREE.BoxGeometry;
  tailBack: THREE.BoxGeometry;
  backMantle: THREE.BoxGeometry;
  lapel: THREE.BoxGeometry;
  bandolier: THREE.BoxGeometry;
  clasp: THREE.BoxGeometry;
  belt: THREE.BoxGeometry;
  buckle: THREE.BoxGeometry;
  coatBack: THREE.BoxGeometry;
  coatSide: THREE.BoxGeometry;
  holster: THREE.BoxGeometry;
  holGrip: THREE.BoxGeometry;
  holCyl: THREE.CylinderGeometry;
  pauldronPlate: THREE.BoxGeometry;
  pauldronTrim: THREE.BoxGeometry;
  pauldronSpike: THREE.ConeGeometry;
  pGrip: THREE.BoxGeometry;
  pBarrel: THREE.BoxGeometry;
  pCylinder: THREE.CylinderGeometry;
  grBody: THREE.CylinderGeometry;
  grFuse: THREE.BoxGeometry;
  redGlint: THREE.OctahedronGeometry;
  cuff: THREE.TorusGeometry;
  zipStrap: THREE.BoxGeometry;
}

interface QuistMats {
  dusterMat: THREE.MeshStandardMaterial;
  dusterDarkMat: THREE.MeshStandardMaterial;
  crimsonMat: THREE.MeshStandardMaterial;
  crimsonFoldMat: THREE.MeshStandardMaterial;
  helmRustMat: THREE.MeshStandardMaterial;
  steelMat: THREE.MeshStandardMaterial;
  brassMat: THREE.MeshStandardMaterial;
  leatherMat: THREE.MeshStandardMaterial;
  amberLensMat: THREE.MeshStandardMaterial;
  gunSteelMat: THREE.MeshStandardMaterial;
  gripWoodMat: THREE.MeshStandardMaterial;
  grenadeMat: THREE.MeshStandardMaterial;
  zipTieMat: THREE.MeshStandardMaterial;
  redGlintMat: THREE.MeshBasicMaterial;
}

let _quistGeos: QuistGeos | null = null;
const _quistMatsByStore = new WeakMap<object, QuistMats>();
let _defaultQuistMats: QuistMats | null = null;

function getQuistGeos(): QuistGeos {
  if (!_quistGeos) {
    _quistGeos = {
      helmDome: new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
      helmBrim: new THREE.CylinderGeometry(0.142, 0.15, 0.035, 12),
      spike: new THREE.ConeGeometry(0.018, 0.09, 5),
      nape: new THREE.BoxGeometry(0.2, 0.15, 0.06),
      strap: new THREE.TorusGeometry(0.122, 0.014, 5, 14),
      goggleRim: new THREE.TorusGeometry(0.038, 0.009, 6, 10),
      goggleLens: new THREE.CylinderGeometry(0.035, 0.035, 0.022, 10),
      collar: new THREE.TorusGeometry(0.125, 0.042, 6, 14),
      tailFront: new THREE.BoxGeometry(0.14, 0.26, 0.032),
      tailBack: new THREE.BoxGeometry(0.16, 0.34, 0.028),
      backMantle: new THREE.BoxGeometry(0.42, 0.44, 0.05),
      lapel: new THREE.BoxGeometry(0.14, 0.4, 0.045),
      bandolier: new THREE.BoxGeometry(0.06, 0.48, 0.32),
      clasp: new THREE.BoxGeometry(0.14, 0.1, 0.035),
      belt: new THREE.BoxGeometry(0.42, 0.08, 0.29),
      buckle: new THREE.BoxGeometry(0.09, 0.085, 0.03),
      coatBack: new THREE.BoxGeometry(0.44, 0.62, 0.045),
      coatSide: new THREE.BoxGeometry(0.05, 0.56, 0.22),
      holster: new THREE.BoxGeometry(0.09, 0.2, 0.12),
      holGrip: new THREE.BoxGeometry(0.045, 0.11, 0.065),
      holCyl: new THREE.CylinderGeometry(0.028, 0.028, 0.06, 8),
      pauldronPlate: new THREE.BoxGeometry(0.18, 0.14, 0.24),
      pauldronTrim: new THREE.BoxGeometry(0.19, 0.045, 0.25),
      pauldronSpike: new THREE.ConeGeometry(0.02, 0.085, 5),
      pGrip: new THREE.BoxGeometry(0.04, 0.11, 0.06),
      pBarrel: new THREE.BoxGeometry(0.042, 0.055, 0.24),
      pCylinder: new THREE.CylinderGeometry(0.028, 0.028, 0.06, 8),
      grBody: new THREE.CylinderGeometry(0.052, 0.052, 0.12, 10),
      grFuse: new THREE.BoxGeometry(0.038, 0.045, 0.038),
      redGlint: new THREE.OctahedronGeometry(0.16, 0),
      cuff: new THREE.TorusGeometry(0.056, 0.014, 6, 12),
      zipStrap: new THREE.BoxGeometry(0.24, 0.042, 0.055),
    };
  }
  return _quistGeos;
}

function getQuistMats(ctx?: Ctx): QuistMats {
  const store = ctx?.render?.materials;
  if (store) {
    const cached = _quistMatsByStore.get(store);
    if (cached) {
      cached.redGlintMat.opacity = 0.92;
      return cached;
    }
  } else if (_defaultQuistMats) {
    _defaultQuistMats.redGlintMat.opacity = 0.92;
    return _defaultQuistMats;
  }

  const patch = <T extends THREE.MeshStandardMaterial>(m: T): T =>
    store?.patch ? store.patch(m) : m;

  const mats: QuistMats = {
    dusterMat: patch(new THREE.MeshStandardMaterial({ color: '#3b291d', roughness: 0.9, metalness: 0.06 })),
    dusterDarkMat: patch(new THREE.MeshStandardMaterial({ color: '#271b13', roughness: 0.92, metalness: 0.08 })),
    crimsonMat: patch(new THREE.MeshStandardMaterial({ color: '#9e2620', roughness: 0.88, metalness: 0.05 })),
    crimsonFoldMat: patch(new THREE.MeshStandardMaterial({ color: '#751a16', roughness: 0.9, metalness: 0.04 })),
    helmRustMat: patch(new THREE.MeshStandardMaterial({ color: '#5c3c27', roughness: 0.62, metalness: 0.72 })),
    steelMat: patch(new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.82 })),
    brassMat: patch(new THREE.MeshStandardMaterial({ color: '#9e7c3c', roughness: 0.38, metalness: 0.78 })),
    leatherMat: patch(new THREE.MeshStandardMaterial({ color: '#2b1f16', roughness: 0.86, metalness: 0.1 })),
    amberLensMat: patch(
      new THREE.MeshStandardMaterial({
        color: '#ffae2b',
        emissive: '#ff8c12',
        emissiveIntensity: 1.85,
        roughness: 0.15,
        metalness: 0.25,
      }),
    ),
    gunSteelMat: patch(new THREE.MeshStandardMaterial({ color: '#22262c', roughness: 0.42, metalness: 0.85 })),
    gripWoodMat: patch(new THREE.MeshStandardMaterial({ color: '#4c3220', roughness: 0.82, metalness: 0.08 })),
    grenadeMat: patch(new THREE.MeshStandardMaterial({ color: '#455438', roughness: 0.65, metalness: 0.35 })),
    zipTieMat: patch(
      new THREE.MeshStandardMaterial({
        color: '#eef3f8',
        emissive: '#587868',
        emissiveIntensity: 0.25,
        roughness: 0.45,
        metalness: 0.15,
      }),
    ),
    redGlintMat: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff2010').multiplyScalar(5.0),
      transparent: true,
      opacity: 0.92,
      toneMapped: false,
      depthWrite: false,
    }),
  };

  if (store) _quistMatsByStore.set(store, mats);
  else _defaultQuistMats = mats;
  return mats;
}

/**
 * Attaches Hadrek Quist ("the Salt King") custom desert warlord gear directly onto a real
 * humanoid `Enemy`'s skeleton bones so everything moves with real animations and detaches
 * naturally if his head or limbs get blown off.
 */
export function styleQuistNpc(enemy: EnemyInstance, ctx?: Ctx): QuistNpcProps {
  const char = enemy.char;
  const root = char?.root ?? new THREE.Group();
  const bones = char?.bones ?? [];

  stripQuistGear(enemy);
  root.userData.desertQuist = true;

  const geos = getQuistGeos();
  const {
    dusterMat,
    dusterDarkMat,
    crimsonMat,
    crimsonFoldMat,
    helmRustMat,
    steelMat,
    brassMat,
    leatherMat,
    amberLensMat,
    gunSteelMat,
    gripWoodMat,
    grenadeMat,
    zipTieMat,
    redGlintMat,
  } = getQuistMats(ctx);

  const hasRig = bones.length > HumanoidBone.handR;
  const hipsParent = hasRig ? bones[HumanoidBone.hips]! : root;
  const chestParent = hasRig ? bones[HumanoidBone.chest]! : root;
  const neckParent = hasRig ? bones[HumanoidBone.neck]! : root;
  const headParent = hasRig ? bones[HumanoidBone.head]! : root;
  const armLParent = hasRig ? bones[HumanoidBone.upperArmL]! : root;
  const armRParent = hasRig ? bones[HumanoidBone.upperArmR]! : root;
  const foreLParent = hasRig ? bones[HumanoidBone.foreArmL]! : root;
  const foreRParent = hasRig ? bones[HumanoidBone.foreArmR]! : root;
  const handLParent = hasRig ? bones[HumanoidBone.handL]! : root;
  const handRParent = hasRig ? bones[HumanoidBone.handR]! : root;

  const groups: THREE.Group[] = [];
  const mount = (parent: THREE.Object3D, group: THREE.Group): THREE.Group => {
    group.name = QUIST_GEAR_NAME;
    parent.add(group);
    groups.push(group);
    return group;
  };

  // 1. HEAD: Spiked / crowned rusty desert warlord helmet + glowing amber goggles
  const headGroup = new THREE.Group();
  const hy = hasRig ? 0.11 : 1.66;
  const helmDome = new THREE.Mesh(geos.helmDome, helmRustMat);
  helmDome.position.set(0, hy + 0.02, -0.005);
  headGroup.add(helmDome);

  const helmBrim = new THREE.Mesh(geos.helmBrim, steelMat);
  helmBrim.position.set(0, hy + 0.032, 0.005);
  headGroup.add(helmBrim);

  // Welded jagged Salt King crown spikes circling the helmet rim
  const spikeAngles = [-1.1, -0.55, 0, 0.55, 1.1, 2.2, -2.2];
  for (let i = 0; i < spikeAngles.length; i++) {
    const a = spikeAngles[i]!;
    const isCenter = Math.abs(a) < 0.01;
    const spike = new THREE.Mesh(geos.spike, isCenter ? brassMat : steelMat);
    spike.position.set(Math.sin(a) * 0.125, hy + (isCenter ? 0.115 : 0.095), Math.cos(a) * 0.125);
    spike.scale.setScalar(isCenter ? 1.3 : 1.0);
    spike.rotation.set(Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22);
    headGroup.add(spike);
  }

  // Headwrap nape drape under back of helmet
  const nape = new THREE.Mesh(geos.nape, dusterDarkMat);
  nape.position.set(0, hy - 0.035, -0.105);
  headGroup.add(nape);

  // Glowing amber dust goggles across brow/eyes
  const strap = new THREE.Mesh(geos.strap, leatherMat);
  strap.rotation.x = Math.PI / 2;
  strap.position.set(0, hy - 0.005, 0.01);
  headGroup.add(strap);
  for (const side of [-1, 1] as const) {
    const lx = side * 0.048;
    const rim = new THREE.Mesh(geos.goggleRim, brassMat);
    rim.position.set(lx, hy - 0.005, 0.126);
    const lens = new THREE.Mesh(geos.goggleLens, amberLensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(lx, hy - 0.005, 0.118);
    headGroup.add(rim, lens);
  }
  mount(headParent, headGroup);

  // 2. NECK: Crimson warlord scarf collar & hanging front drape
  const scarfGroup = new THREE.Group();
  const ny = hasRig ? 0.02 : 1.48;
  const collar = new THREE.Mesh(geos.collar, crimsonMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, ny, 0.01);
  const tailFront = new THREE.Mesh(geos.tailFront, crimsonFoldMat);
  tailFront.position.set(-0.06, ny - 0.14, 0.13);
  tailFront.rotation.set(-0.18, 0.12, 0.14);
  const tailBack = new THREE.Mesh(geos.tailBack, crimsonMat);
  tailBack.position.set(0.05, ny - 0.16, -0.13);
  tailBack.rotation.set(0.16, -0.08, -0.1);
  scarfGroup.add(collar, tailFront, tailBack);
  mount(neckParent, scarfGroup);

  // 3. CHEST: Desert warlord duster coat mantle, lapels & cross-chest bandolier
  const chestGroup = new THREE.Group();
  const cy = hasRig ? 0.1 : 1.24;
  const backMantle = new THREE.Mesh(geos.backMantle, dusterMat);
  backMantle.position.set(0, cy, -0.14);
  const lapelL = new THREE.Mesh(geos.lapel, dusterDarkMat);
  lapelL.position.set(0.14, cy + 0.01, 0.145);
  lapelL.rotation.y = 0.18;
  const lapelR = new THREE.Mesh(geos.lapel, dusterDarkMat);
  lapelR.position.set(-0.14, cy + 0.01, 0.145);
  lapelR.rotation.y = -0.18;
  const bandolier = new THREE.Mesh(geos.bandolier, leatherMat);
  bandolier.position.set(0, cy + 0.02, 0);
  bandolier.rotation.z = -0.58;
  const clasp = new THREE.Mesh(geos.clasp, brassMat);
  clasp.position.set(0, cy + 0.08, 0.165);
  chestGroup.add(backMantle, lapelL, lapelR, bandolier, clasp);
  mount(chestParent, chestGroup);

  // 4. HIPS: Flowing duster coat tails, heavy warlord belt & holstered desert revolver
  const hipsGroup = new THREE.Group();
  const hipY = hasRig ? 0 : 0.96;
  const belt = new THREE.Mesh(geos.belt, leatherMat);
  belt.position.set(0, hipY + 0.04, 0);
  const buckle = new THREE.Mesh(geos.buckle, brassMat);
  buckle.position.set(0, hipY + 0.04, 0.155);
  const coatBack = new THREE.Mesh(geos.coatBack, dusterMat);
  coatBack.position.set(0, hipY - 0.28, -0.145);
  coatBack.rotation.x = 0.1;
  const coatSideL = new THREE.Mesh(geos.coatSide, dusterDarkMat);
  coatSideL.position.set(0.21, hipY - 0.25, -0.02);
  coatSideL.rotation.z = 0.08;
  const coatSideR = new THREE.Mesh(geos.coatSide, dusterDarkMat);
  coatSideR.position.set(-0.21, hipY - 0.25, -0.02);
  coatSideR.rotation.z = -0.08;
  const holster = new THREE.Mesh(geos.holster, leatherMat);
  holster.position.set(0.23, hipY - 0.07, 0.04);
  hipsGroup.add(belt, buckle, coatBack, coatSideL, coatSideR, holster);

  const pistolHolstered = new THREE.Group();
  pistolHolstered.position.set(0.24, hipY - 0.01, 0.06);
  const holGrip = new THREE.Mesh(geos.holGrip, gripWoodMat);
  holGrip.rotation.x = 0.35;
  const holCyl = new THREE.Mesh(geos.holCyl, gunSteelMat);
  holCyl.position.set(0, -0.04, 0.02);
  pistolHolstered.add(holGrip, holCyl);
  hipsGroup.add(pistolHolstered);
  mount(hipsParent, hipsGroup);

  // 5. SHOULDERS: Heavy welded steel pauldrons with spikes on upperArmL & upperArmR
  const addPauldron = (parent: THREE.Object3D, side: 1 | -1): void => {
    const pGroup = new THREE.Group();
    const ox = hasRig ? side * 0.055 : side * 0.28;
    const oy = hasRig ? 0.02 : 1.44;
    const plate = new THREE.Mesh(geos.pauldronPlate, helmRustMat);
    plate.position.set(ox, oy, 0);
    plate.rotation.z = -side * 0.28;
    const trim = new THREE.Mesh(geos.pauldronTrim, steelMat);
    trim.position.set(ox + side * 0.02, oy - 0.05, 0);
    trim.rotation.z = -side * 0.28;
    const pauldronSpike = new THREE.Mesh(geos.pauldronSpike, brassMat);
    pauldronSpike.position.set(ox + side * 0.05, oy + 0.095, 0);
    pauldronSpike.rotation.z = -side * 0.45;
    pGroup.add(plate, trim, pauldronSpike);
    mount(parent, pGroup);
  };
  addPauldron(armLParent, 1);
  addPauldron(armRParent, -1);

  // Disarm the trooper archetype so Quist stands unarmed (not clutching a rifle) and left-hand draw/temple postures drive freely.
  (char?.anim as { disarm?: () => void } | undefined)?.disarm?.();
  if (hasRig) {
    for (const child of handRParent.children) {
      if (child.name !== QUIST_GEAR_NAME && !(child instanceof THREE.Bone)) {
        child.visible = false;
      }
    }
  }

  // 6. LEFT HAND: Heavy revolver for suicide_draw / suicide_temple (hidden initially)
  const pistolInHand = new THREE.Group();
  pistolInHand.position.set(0, hasRig ? -0.05 : 1.0, hasRig ? 0.06 : 0.1);
  pistolInHand.scale.setScalar(1.35);
  const pGrip = new THREE.Mesh(geos.pGrip, gripWoodMat);
  pGrip.position.set(0, -0.03, 0);
  pGrip.rotation.x = 0.24;
  const pBarrel = new THREE.Mesh(geos.pBarrel, gunSteelMat);
  pBarrel.position.set(0, 0.03, 0.085);
  const pCylinder = new THREE.Mesh(geos.pCylinder, brassMat);
  pCylinder.rotation.x = Math.PI / 2;
  pCylinder.position.set(0, 0.025, 0.04);
  pistolInHand.add(pGrip, pBarrel, pCylinder);
  pistolInHand.visible = false;
  mount(handLParent, pistolInHand);

  // 7. RIGHT HAND: Concealed grenade + flashing red glint telegraph (hidden initially)
  const grenadeInHand = new THREE.Group();
  grenadeInHand.position.set(0, hasRig ? -0.04 : 1.0, hasRig ? 0.05 : 0.1);
  const grBody = new THREE.Mesh(geos.grBody, grenadeMat);
  const grFuse = new THREE.Mesh(geos.grFuse, brassMat);
  grFuse.position.set(0, 0.075, 0);
  grenadeInHand.add(grBody, grFuse);
  grenadeInHand.visible = false;
  mount(handRParent, grenadeInHand);

  const redGlint = new THREE.Mesh(geos.redGlint, redGlintMat);
  redGlint.position.set(0, hasRig ? -0.02 : 1.05, hasRig ? 0.1 : 0.18);
  redGlint.visible = false;
  const glintWrap = new THREE.Group();
  glintWrap.add(redGlint);
  mount(handRParent, glintWrap);

  // 8. ZIP-TIE CUFFS: Visible heavy white/silver zip-ties on both wrists + binder (hidden until captured)
  const zipTie = new THREE.Group();
  const cuffL = new THREE.Mesh(geos.cuff, zipTieMat);
  cuffL.rotation.x = Math.PI / 2;
  cuffL.position.set(0, hasRig ? -0.22 : 0.98, 0);
  const cuffLGroup = new THREE.Group();
  cuffLGroup.add(cuffL);
  cuffLGroup.visible = false;
  mount(foreLParent, cuffLGroup);

  const cuffR = new THREE.Mesh(geos.cuff, zipTieMat);
  cuffR.rotation.x = Math.PI / 2;
  cuffR.position.set(0, hasRig ? -0.22 : 0.98, 0);
  const cuffRGroup = new THREE.Group();
  cuffRGroup.add(cuffR);
  cuffRGroup.visible = false;
  mount(foreRParent, cuffRGroup);

  const zipStrap = new THREE.Mesh(geos.zipStrap, zipTieMat);
  zipStrap.position.set(0, hasRig ? 0.04 : 0.98, 0.18);
  zipTie.add(zipStrap);
  zipTie.visible = false;
  mount(hipsParent, zipTie);

  const setCuffed = (cuffed: boolean): void => {
    zipTie.visible = cuffed;
    cuffLGroup.visible = cuffed;
    cuffRGroup.visible = cuffed;
  };

  return {
    root,
    groups,
    pistolHolstered,
    pistolInHand,
    grenadeInHand,
    redGlint,
    redGlintMat,
    zipTie,
    setCuffed,
  };
}

export class SaltbloodStyler {
  private readonly styledUids = new Set<number>();
  private readonly attached = new Set<THREE.Object3D>();
  private assets: SharedAssets | null = null;

  constructor(private readonly ctx: Ctx) {}

  get styledCount(): number {
    return this.styledUids.size;
  }

  isStyled(uid: number): boolean {
    return this.styledUids.has(uid);
  }

  private ensureAssets(): SharedAssets {
    if (this.assets) return this.assets;

    const patch = <T extends THREE.MeshStandardMaterial>(m: T): T =>
      this.ctx.render?.materials?.patch ? this.ctx.render.materials.patch(m) : m;

    const scarfMats = SCARF_HEXES.map(color =>
      patch(new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.04 })),
    );
    const strapMat = patch(new THREE.MeshStandardMaterial({ color: '#2b241d', roughness: 0.88, metalness: 0.1 }));
    const rimMat = patch(new THREE.MeshStandardMaterial({ color: '#6b5a3e', roughness: 0.45, metalness: 0.72 }));
    const lensMat = patch(
      new THREE.MeshStandardMaterial({
        color: '#e89c28',
        emissive: '#4d2a04',
        emissiveIntensity: 0.75,
        roughness: 0.18,
        metalness: 0.35,
      }),
    );
    const scrapMat = patch(new THREE.MeshStandardMaterial({ color: '#6e4c36', roughness: 0.72, metalness: 0.62 }));
    const heavyScrapMat = patch(new THREE.MeshStandardMaterial({ color: '#47423d', roughness: 0.58, metalness: 0.78 }));
    const boltMat = patch(new THREE.MeshStandardMaterial({ color: '#a8967c', roughness: 0.4, metalness: 0.85 }));

    this.assets = {
      scarfCollarGeo: new THREE.TorusGeometry(0.105, 0.036, 6, 12),
      scarfTailGeo: new THREE.BoxGeometry(0.11, 0.19, 0.025),
      goggleStrapGeo: new THREE.TorusGeometry(0.112, 0.014, 5, 14),
      goggleLensGeo: new THREE.CylinderGeometry(0.034, 0.034, 0.022, 10),
      goggleRimGeo: new THREE.TorusGeometry(0.036, 0.008, 6, 10),
      browGuardGeo: new THREE.BoxGeometry(0.19, 0.055, 0.04),
      chestPlateGeo: new THREE.BoxGeometry(0.27, 0.23, 0.035),
      chestBoltGeo: new THREE.BoxGeometry(0.24, 0.025, 0.018),
      heavyCuirassGeo: new THREE.BoxGeometry(0.34, 0.29, 0.055),
      pauldronGeo: new THREE.BoxGeometry(0.13, 0.11, 0.15),
      heavyPauldronGeo: new THREE.BoxGeometry(0.16, 0.15, 0.19),
      scarfMats,
      strapMat,
      rimMat,
      lensMat,
      scrapMat,
      heavyScrapMat,
      boltMat,
    };
    return this.assets;
  }

  private unregisterGroup(group: THREE.Object3D): void {
    const unreg = this.ctx.render?.unregisterBatchedProp;
    if (!unreg) return;
    group.traverse(o => {
      if ((o as THREE.Mesh).isMesh) unreg.call(this.ctx.render, o as THREE.Mesh);
    });
  }

  /** Strips any leftover Saltblood or Quist cosmetics on a recycled character rig before applying fresh gear. */
  private stripExisting(root: THREE.Object3D, bones: readonly THREE.Bone[]): void {
    const stripFrom = (parent: THREE.Object3D | undefined): void => {
      if (!parent) return;
      for (let i = parent.children.length - 1; i >= 0; i--) {
        const child = parent.children[i]!;
        if (child.name === GEAR_NAME || child.name === QUIST_GEAR_NAME) {
          this.unregisterGroup(child);
          parent.remove(child);
          this.attached.delete(child);
        }
      }
    };
    stripFrom(root);
    for (const b of bones) stripFrom(b);
  }

  private mount(parent: THREE.Object3D, group: THREE.Group): void {
    group.name = GEAR_NAME;
    parent.add(group);
    this.attached.add(group);
    const reg = this.ctx.render?.registerBatchedProp;
    if (reg) {
      for (const child of group.children) {
        if ((child as THREE.Mesh).isMesh) reg.call(this.ctx.render, child as THREE.Mesh);
      }
    }
  }

  private styleEnemy(enemy: EnemyInstance): void {
    const char = enemy.char;
    if (!char?.root) return;
    const bones = char.bones ?? [];
    this.stripExisting(char.root, bones);

    const a = this.ensureAssets();
    const heavy = isPlaneGuard(enemy);
    const scarfMat = a.scarfMats[Math.abs(enemy.uid) % a.scarfMats.length]!;
    const hasRig = bones.length > HumanoidBone.upperArmR;

    const neckParent = hasRig ? bones[HumanoidBone.neck]! : char.root;
    const headParent = hasRig ? bones[HumanoidBone.head]! : char.root;
    const chestParent = hasRig ? bones[HumanoidBone.chest]! : char.root;
    const armLParent = hasRig ? bones[HumanoidBone.upperArmL]! : char.root;
    const armRParent = hasRig ? bones[HumanoidBone.upperArmR]! : char.root;
    const fallbackY = hasRig ? 0 : 1.35;

    // 1. Desert scarf collar + hanging dusty tail
    const scarf = new THREE.Group();
    const collar = new THREE.Mesh(a.scarfCollarGeo, scarfMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, hasRig ? 0.03 : fallbackY + 0.18, 0.01);
    const tail = new THREE.Mesh(a.scarfTailGeo, scarfMat);
    tail.position.set(0.045, hasRig ? -0.09 : fallbackY + 0.06, 0.115);
    tail.rotation.set(-0.22, 0.14, -0.18);
    scarf.add(collar, tail);
    this.mount(neckParent, scarf);

    // 2. Amber dust goggles (+ welded brow guard on heavy Plane guards)
    const goggles = new THREE.Group();
    const headY = hasRig ? 0.095 : fallbackY + 0.32;
    const strap = new THREE.Mesh(a.goggleStrapGeo, a.strapMat);
    strap.rotation.x = Math.PI / 2;
    strap.position.set(0, headY, 0.015);
    goggles.add(strap);

    for (const side of [-1, 1]) {
      const lx = side * 0.044;
      const lens = new THREE.Mesh(a.goggleLensGeo, a.lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(lx, headY, 0.112);
      const rim = new THREE.Mesh(a.goggleRimGeo, a.rimMat);
      rim.position.set(lx, headY, 0.122);
      goggles.add(lens, rim);
    }
    if (heavy) {
      const brow = new THREE.Mesh(a.browGuardGeo, a.heavyScrapMat);
      brow.position.set(0, headY + 0.055, 0.118);
      brow.rotation.x = 0.18;
      goggles.add(brow);
    }
    this.mount(headParent, goggles);

    // 3. Welded scrap chest armor
    const chest = new THREE.Group();
    const plate = new THREE.Mesh(heavy ? a.heavyCuirassGeo : a.chestPlateGeo, heavy ? a.heavyScrapMat : a.scrapMat);
    plate.position.set(0, hasRig ? 0.11 : fallbackY - 0.05, 0.168);
    plate.rotation.z = heavy ? 0 : (enemy.uid % 2 === 0 ? 0.08 : -0.08);
    const weldStrip = new THREE.Mesh(a.chestBoltGeo, a.boltMat);
    weldStrip.position.set(0, hasRig ? 0.16 : fallbackY, 0.195);
    chest.add(plate, weldStrip);
    if (heavy) {
      const lowerStrip = new THREE.Mesh(a.chestBoltGeo, a.boltMat);
      lowerStrip.position.set(0, hasRig ? 0.04 : fallbackY - 0.12, 0.2);
      chest.add(lowerStrip);
    }
    this.mount(chestParent, chest);

    // 4. Welded scrap shoulder pauldrons (single asymmetrical for raiders, dual heavy for Plane guards)
    const addPauldron = (parent: THREE.Object3D, side: 1 | -1): void => {
      const pGrp = new THREE.Group();
      const pad = new THREE.Mesh(heavy ? a.heavyPauldronGeo : a.pauldronGeo, heavy ? a.heavyScrapMat : a.scrapMat);
      pad.position.set(hasRig ? side * 0.055 : side * 0.24, hasRig ? 0.015 : fallbackY + 0.05, 0.01);
      pad.rotation.z = -side * 0.34;
      pGrp.add(pad);
      this.mount(parent, pGrp);
    };

    if (heavy) {
      addPauldron(armLParent, 1);
      addPauldron(armRParent, -1);
    } else if (enemy.uid % 2 === 0) {
      addPauldron(armLParent, 1);
    } else {
      addPauldron(armRParent, -1);
    }
  }

  /** Inspects currently alive enemies and attaches Saltblood cosmetics once per `uid`. */
  update(): void {
    const alive = this.ctx.enemies?.alive;
    if (!alive) return;
    for (const enemy of alive) {
      if (!enemy.alive || enemy.machine) continue;
      // Never overwrite Hadrek Quist's custom Salt King NPC model with generic raider gear.
      if (enemy.char?.root?.userData?.desertQuist === true) continue;
      if (this.styledUids.has(enemy.uid)) continue;
      this.styledUids.add(enemy.uid);
      this.styleEnemy(enemy);
    }
  }

  clear(): void {
    for (const grp of this.attached) {
      this.unregisterGroup(grp);
      grp.parent?.remove(grp);
    }
    this.attached.clear();
    this.styledUids.clear();
  }
}
