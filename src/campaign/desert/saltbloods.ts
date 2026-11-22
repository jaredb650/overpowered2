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

const HEAVY_ROLES: ReadonlySet<EnemyId> = new Set<EnemyId>(['warden', 'brute', 'riot', 'juggernaut']);

const SCARF_HEXES = ['#b86d2e', '#8f4324', '#c98842'] as const;

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

  /** Strips any leftover Saltblood cosmetics on a recycled character rig before applying fresh gear. */
  private stripExisting(root: THREE.Object3D, bones: readonly THREE.Bone[]): void {
    const stripFrom = (parent: THREE.Object3D | undefined): void => {
      if (!parent) return;
      for (let i = parent.children.length - 1; i >= 0; i--) {
        const child = parent.children[i]!;
        if (child.name === GEAR_NAME) {
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
      if (this.styledUids.has(enemy.uid)) continue;
      this.styledUids.add(enemy.uid);
      this.styleEnemy(enemy);
    }
  }

  clear(): void {
    for (const grp of this.attached) {
      grp.parent?.remove(grp);
    }
    this.attached.clear();
    this.styledUids.clear();
  }
}
