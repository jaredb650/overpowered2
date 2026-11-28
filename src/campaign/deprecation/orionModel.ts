/**
 * Procedural 12 m AEGIS-0 siege mech model (`OrionModel`) and Grid Umbilical Conduit
 * substation pylons (`GridConduitMesh`) for the Deprecation (`Form 7742-A`) campaign boss.
 *
 * Built exclusively with `ModelBuilder` / `ModelMaterials` using sculpted bevelled armor
 * plates, tapered cowls, reverse-jointed heavy legs, floating geometric halo sensor head,
 * shoulder relay fins, hexagonal hard-light shield, sweeping thermal beam cannon, deployable
 * twin plasma cleavers, opening rear reactor slats, and cracking chest neural core.
 */
import * as THREE from 'three';
import { clamp, damp } from '../../core/math';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';

// ---- AEGIS-0 Corporate Siege Palette -----------------------------------------------------------------------------

const OBSIDIAN_DEEP = '#10141b';
const OBSIDIAN_MID = '#1c232f';
const OBSIDIAN_SLATE = '#2b3545';
const CORP_WHITE = '#e8eef5';
const CORP_WHITE_SHADE = '#c7d2df';
const CORP_WHITE_BRIGHT = '#f5f8fc';
const TITANIUM = '#4d5866';
const CHARRED_METAL = '#241e1c';

const CYAN_SEAM = '#1ce8ff';
const CYAN_BRIGHT = '#8cf8ff';
const ORANGE_REACTOR = '#ff7818';
const ORANGE_HOT = '#ffd27a';
const GRAPPLE_ORANGE = '#ff7b1c';

const HALO_COLORS = {
  cyan: new THREE.Color('#22ecff').multiplyScalar(4.4),
  amber: new THREE.Color('#ffaa22').multiplyScalar(4.6),
  crimson: new THREE.Color('#ff223a').multiplyScalar(4.8),
  dead: new THREE.Color('#16202a').multiplyScalar(0.35),
} as const;

export type OrionHaloMode = keyof typeof HALO_COLORS;
export type OrionBeamVisualMode = 'off' | 'telegraph' | 'fire';

// Module-level zero-allocation scratch math objects.
const _v0 = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _col = new THREE.Color();

// ---- Sculpted Procedural Geometry Helpers ------------------------------------------------------------------------

/** Extruded chamfered armor block — never raw un-bevelled boxes for primary armor plates. */
function chamferBox(w: number, h: number, d: number, bevel = 0.12): THREE.BufferGeometry {
  const b = Math.min(bevel, w * 0.28, h * 0.28, d * 0.28);
  const hw = Math.max(0.01, w / 2 - b);
  const hh = Math.max(0.01, h / 2 - b);
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.03, d - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  geo.center();
  return geo;
}

/** Tapered trapezoidal bevelled armor cowl / pauldron / chest glacis. */
function taperedPlate(wBot: number, wTop: number, h: number, d: number, bevel = 0.1): THREE.BufferGeometry {
  const b = Math.min(bevel, Math.min(wBot, wTop) * 0.25, h * 0.25, d * 0.28);
  const hb = Math.max(0.02, wBot / 2 - b);
  const ht = Math.max(0.02, wTop / 2 - b);
  const hh = Math.max(0.02, h / 2 - b);
  const shape = new THREE.Shape();
  shape.moveTo(-hb, -hh);
  shape.lineTo(hb, -hh);
  shape.lineTo(ht, hh);
  shape.lineTo(-ht, hh);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.03, d - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  geo.center();
  return geo;
}

/** Swept angular corporate wing-fin or plasma cleaver blade profile. */
function sweptBlade(length: number, baseW: number, tipOffset: number, thickness: number, bevel = 0.04): THREE.BufferGeometry {
  const b = Math.min(bevel, baseW * 0.2, thickness * 0.35);
  const shape = new THREE.Shape();
  shape.moveTo(0, -baseW * 0.5);
  shape.lineTo(length * 0.72, -baseW * 0.36 + tipOffset * 0.45);
  shape.lineTo(length, tipOffset);
  shape.lineTo(length * 0.68, baseW * 0.32 + tipOffset * 0.45);
  shape.lineTo(0, baseW * 0.48);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, thickness - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  geo.translate(-length * 0.1, 0, -(thickness - b * 2) * 0.5);
  return geo;
}

/** Curved faceted hexagonal-panelled Hard-Light Shield shell wrapping the front torso. */
function buildShieldArcGeometry(radius: number, height: number, arcRad: number, cols = 9, rows = 5): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius, radius * 0.92, height, cols, rows, true, -arcRad * 0.5, arcRad);
  // Subtle outward dome curvature for an architectural hard-light barrier silhouette.
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const yn = y / (height * 0.5);
    const bulge = 1 + (1 - yn * yn) * 0.18;
    pos.setXYZ(i, x * bulge, y, z * bulge);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Updates a Y-axis unit cylinder mesh so it spans cleanly from `a` to `b` with zero allocations. */
function orientBeamSpan(obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
  _dir.subVectors(b, a);
  const len = _dir.length();
  if (len < 0.01) {
    obj.visible = false;
    return;
  }
  _mid.addVectors(a, b).multiplyScalar(0.5);
  _dir.multiplyScalar(1 / len);
  _quat.setFromUnitVectors(_up, _dir);
  obj.position.copy(_mid);
  obj.quaternion.copy(_quat);
  obj.scale.set(radius, len, radius);
  obj.visible = true;
}

// ---- Grid Umbilical Conduit Substation Pylon (Stage 3A) ----------------------------------------------------------

export class GridConduitMesh {
  readonly root = new THREE.Group();
  readonly tetherGroup = new THREE.Group();
  readonly highlightMeshes: THREE.Object3D[] = [];

  private readonly intactParts: THREE.Group;
  private readonly brokenParts: THREE.Group;
  private readonly topRing: THREE.Group;
  private readonly tetherCore: THREE.Mesh;
  private readonly tetherSheath: THREE.Mesh;
  private readonly tetherCoreMat: THREE.MeshBasicMaterial;
  private readonly tetherSheathMat: THREE.MeshBasicMaterial;
  private readonly emitterLocal = new THREE.Vector3(0, 5.15, 0);
  private destroyed = false;

  constructor(materials: ModelMaterials, scene: THREE.Scene) {
    // Sculpted 5.4 m corporate power substation pylon (obsidian octagonal plinth + white fins + glowing capacitor core).
    const baseB = new ModelBuilder()
      .cyl(1.45, 1.85, 0.72, 8, OBSIDIAN_DEEP, { at: [0, 0.36, 0] })
      .cyl(1.18, 1.38, 0.55, 8, CORP_WHITE_SHADE, { at: [0, 0.92, 0] })
      .cyl(0.62, 0.84, 3.65, 8, OBSIDIAN_MID, { at: [0, 2.85, 0] });
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      const sx = Math.sin(ang) * 1.12;
      const sz = Math.cos(ang) * 1.12;
      baseB
        .solid(taperedPlate(0.68, 0.38, 3.4, 0.32, 0.06), CORP_WHITE, { at: [sx, 2.5, sz], rot: [0, ang, 0] })
        .solid(chamferBox(0.32, 0.55, 0.52, 0.05), OBSIDIAN_SLATE, { at: [sx * 0.85, 1.15, sz * 0.85], rot: [0, ang, 0] });
    }
    this.root.add(materials.group(baseB));

    // Intact glowing capacitor core & emitter array (hidden when shattered).
    this.intactParts = new THREE.Group();
    const intactB = new ModelBuilder()
      .glow(new THREE.CylinderGeometry(0.44, 0.44, 2.95, 8), CYAN_SEAM, 3.8, { at: [0, 3.05, 0] })
      .glow(new THREE.OctahedronGeometry(0.62, 0), CYAN_BRIGHT, 5.0, { at: [0, 5.15, 0] });
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      intactB.glow(new THREE.BoxGeometry(0.14, 2.8, 0.14), CYAN_SEAM, 3.6, {
        at: [Math.sin(ang) * 1.24, 2.65, Math.cos(ang) * 1.24],
        rot: [0, ang, 0],
      });
    }
    this.intactParts.add(materials.group(intactB));
    this.root.add(this.intactParts);

    // Floating rotating emitter halo at pylon apex.
    this.topRing = new THREE.Group();
    this.topRing.position.set(0, 5.15, 0);
    const ringB = new ModelBuilder()
      .solid(new THREE.TorusGeometry(0.95, 0.09, 6, 8), CORP_WHITE_BRIGHT)
      .glow(new THREE.TorusGeometry(0.76, 0.05, 6, 8), CYAN_SEAM, 4.4);
    this.topRing.add(materials.group(ringB));
    this.intactParts.add(this.topRing);

    // Scorched fractured pylon stump revealed when shattered.
    this.brokenParts = new THREE.Group();
    this.brokenParts.visible = false;
    const brokenB = new ModelBuilder()
      .solid(chamferBox(0.92, 1.35, 0.88, 0.08), CHARRED_METAL, { at: [0, 1.85, 0], rot: [0.18, 0.4, -0.12] })
      .glow(new THREE.OctahedronGeometry(0.26, 0), ORANGE_REACTOR, 2.6, { at: [0.1, 2.55, 0] });
    this.brokenParts.add(materials.group(brokenB));
    this.root.add(this.brokenParts);

    // World-space umbilical energy tether connecting pylon emitter -> ORION's dorsal socket.
    this.tetherCoreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#aefaff').multiplyScalar(3.4),
      toneMapped: false,
      fog: false,
    });
    this.tetherSheathMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#1ce8ff').multiplyScalar(2.4),
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.tetherCore = new THREE.Mesh(unitCyl, this.tetherCoreMat);
    this.tetherSheath = new THREE.Mesh(unitCyl, this.tetherSheathMat);
    this.tetherGroup.add(this.tetherCore);
    this.tetherGroup.add(this.tetherSheath);
    this.tetherGroup.visible = false;

    this.root.visible = false;
    scene.add(this.root);
    scene.add(this.tetherGroup);

    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) this.highlightMeshes.push(o);
    });
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (!visible) this.tetherGroup.visible = false;
  }

  setDestroyed(destroyed: boolean): void {
    this.destroyed = destroyed;
    this.intactParts.visible = !destroyed;
    this.brokenParts.visible = destroyed;
    if (destroyed) this.tetherGroup.visible = false;
  }

  /** Animates the floating capacitor ring and stretches the umbilical tether to `orionAnchorWorld`. */
  updateTether(orionAnchorWorld: THREE.Vector3, time: number, showTether: boolean): void {
    if (!this.root.visible || this.destroyed) {
      this.tetherGroup.visible = false;
      return;
    }
    this.topRing.rotation.x = Math.PI * 0.5 + Math.sin(time * 2.4) * 0.18;
    this.topRing.rotation.z = time * 1.9;
    this.topRing.position.y = 5.15 + Math.sin(time * 3.2) * 0.14;

    if (!showTether) {
      this.tetherGroup.visible = false;
      return;
    }

    _v0.copy(this.root.position).add(this.emitterLocal);
    const pulse = 1 + Math.sin(time * 18 + this.root.position.x) * 0.22;
    this.tetherGroup.visible = true;
    orientBeamSpan(this.tetherCore, _v0, orionAnchorWorld, 0.11 * pulse);
    orientBeamSpan(this.tetherSheath, _v0, orionAnchorWorld, 0.34 * pulse);
    this.tetherSheathMat.opacity = 0.34 + Math.sin(time * 22) * 0.12;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.tetherGroup.removeFromParent();
    this.tetherCoreMat.dispose();
    this.tetherSheathMat.dispose();
  }
}

// ---- 12 m AEGIS-0 Sculpted Procedural Mech Rig -------------------------------------------------------------------

export class OrionModel {
  readonly root = new THREE.Group();
  readonly highlightMeshes: THREE.Object3D[] = [];

  // Articulated rig nodes
  readonly pelvis = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly headGroup = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();

  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private readonly shinL = new THREE.Group();
  private readonly shinR = new THREE.Group();

  // Stage 1: Shoulder Relay Fins & Hexagonal Hard-Light Shield
  private readonly relayLIntact = new THREE.Group();
  private readonly relayLBroken = new THREE.Group();
  private readonly relayRIntact = new THREE.Group();
  private readonly relayRBroken = new THREE.Group();
  private readonly shieldGroup = new THREE.Group();
  private readonly shieldFillMat: THREE.MeshBasicMaterial;
  private readonly shieldWireMat: THREE.MeshBasicMaterial;
  private shieldHitFlash = 0;

  // Halo Sensor Head dynamic glowing parts
  private readonly haloRingOuter = new THREE.Group();
  private readonly haloRingInner = new THREE.Group();
  private readonly headGlowMat: THREE.MeshBasicMaterial;
  private haloMode: OrionHaloMode = 'cyan';

  // Stage 1/3 Weapons: Right-arm Thermal Beam Cannon & world-space beam spans
  private readonly beamMuzzleGlow: THREE.Mesh;
  private readonly beamWorldRoot = new THREE.Group();
  private readonly telegraphLine: THREE.Mesh;
  private readonly thermalBeamCore: THREE.Mesh;
  private readonly thermalBeamSheath: THREE.Mesh;
  private readonly spireBeamCoreA: THREE.Mesh;
  private readonly spireBeamSheathA: THREE.Mesh;
  private readonly spireBeamCoreB: THREE.Mesh;
  private readonly spireBeamSheathB: THREE.Mesh;
  private readonly telegraphMat: THREE.MeshBasicMaterial;
  private readonly beamCoreMat: THREE.MeshBasicMaterial;
  private readonly beamSheathMat: THREE.MeshBasicMaterial;

  // Stage 2 Weapons & Shear State: Twin Plasma Cleavers + Sheared Left Arm Stump
  private readonly cleaverL = new THREE.Group();
  private readonly cleaverR = new THREE.Group();
  private readonly armLStump = new THREE.Group();
  private readonly cleaverMat: THREE.MeshBasicMaterial;

  // Stage 2 Stagger: Rear Reactor Core & Opening Slats
  private readonly reactorShutterL = new THREE.Group();
  private readonly reactorShutterR = new THREE.Group();
  private readonly reactorCoreGroup = new THREE.Group();
  private readonly reactorGlowMat: THREE.MeshBasicMaterial;

  // Stage 3B Finisher: Chest Neural Core, Cracking Shutters, Shoulder Grapple Ring
  private readonly chestShutterL = new THREE.Group();
  private readonly chestShutterR = new THREE.Group();
  private readonly neuralCoreGroup = new THREE.Group();
  private readonly neuralCoreMat: THREE.MeshBasicMaterial;
  private readonly grappleRingGroup = new THREE.Group();

  // Dorsal Thrusters
  private readonly jetFlames = new THREE.Group();
  private readonly jetLight: THREE.PointLight;

  constructor(private readonly materials: ModelMaterials, scene: THREE.Scene) {
    // Dynamic emissive materials for state-driven color shifts & pulses.
    this.headGlowMat = new THREE.MeshBasicMaterial({
      color: HALO_COLORS.cyan.clone(),
      toneMapped: false,
      fog: false,
    });
    this.shieldFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#22ecff'),
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.shieldWireMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#6cf6ff').multiplyScalar(2.4),
      wireframe: true,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.cleaverMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#30f0ff').multiplyScalar(4.2),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.reactorGlowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(ORANGE_REACTOR).multiplyScalar(4.5),
      toneMapped: false,
      fog: false,
    });
    this.neuralCoreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#9afcff').multiplyScalar(5.0),
      toneMapped: false,
      fog: false,
    });
    this.telegraphMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#42f4ff').multiplyScalar(3.6),
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.beamCoreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#e8ffff').multiplyScalar(5.2),
      toneMapped: false,
      fog: false,
    });
    this.beamSheathMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#1ce8ff').multiplyScalar(3.4),
      transparent: true,
      opacity: 0.56,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });

    // Build all articulated mech sub-assemblies.
    this.buildPelvisAndLegs();
    this.buildTorso();
    this.buildHaloHead();
    this.buildShoulderRelaysAndShield();
    this.buildRearReactorAndThrusters();
    this.buildChestNeuralCoreAndGrapple();
    this.beamMuzzleGlow = this.buildArmsAndWeapons();

    // World-space thermal & spire beam cylinder meshes (reused with zero per-frame allocations).
    const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this.telegraphLine = new THREE.Mesh(unitCyl, this.telegraphMat);
    this.thermalBeamCore = new THREE.Mesh(unitCyl, this.beamCoreMat);
    this.thermalBeamSheath = new THREE.Mesh(unitCyl, this.beamSheathMat);
    this.spireBeamCoreA = new THREE.Mesh(unitCyl, this.beamCoreMat);
    this.spireBeamSheathA = new THREE.Mesh(unitCyl, this.beamSheathMat);
    this.spireBeamCoreB = new THREE.Mesh(unitCyl, this.beamCoreMat);
    this.spireBeamSheathB = new THREE.Mesh(unitCyl, this.beamSheathMat);

    this.telegraphLine.visible = false;
    this.thermalBeamCore.visible = false;
    this.thermalBeamSheath.visible = false;
    this.spireBeamCoreA.visible = false;
    this.spireBeamSheathA.visible = false;
    this.spireBeamCoreB.visible = false;
    this.spireBeamSheathB.visible = false;

    this.beamWorldRoot.add(
      this.telegraphLine,
      this.thermalBeamCore,
      this.thermalBeamSheath,
      this.spireBeamCoreA,
      this.spireBeamSheathA,
      this.spireBeamCoreB,
      this.spireBeamSheathB,
    );

    this.jetLight = new THREE.PointLight(0x28e4ff, 0, 56, 1.5);
    this.jetLight.position.set(0, -1.8, -0.6);
    this.jetFlames.add(this.jetLight);

    scene.add(this.root);
    scene.add(this.beamWorldRoot);

    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh && o !== this.shieldGroup) {
        this.highlightMeshes.push(o);
      }
    });
  }

  // ---- Rig Construction ------------------------------------------------------------------------------------------

  private buildPelvisAndLegs(): void {
    const mat = this.materials;
    this.pelvis.position.set(0, 5.45, 0);

    const pelvisB = new ModelBuilder()
      // Core obsidian pelvic block + bevelled white corporate groin glacis
      .solid(chamferBox(3.6, 1.15, 2.75, 0.18), OBSIDIAN_DEEP, { at: [0, 0, 0] })
      .solid(taperedPlate(1.55, 2.35, 1.38, 1.15, 0.12), CORP_WHITE, { at: [0, -0.15, 1.12], rot: [0.16, 0, 0] })
      .solid(taperedPlate(1.75, 2.25, 1.12, 0.85, 0.1), OBSIDIAN_MID, { at: [0, 0.05, -1.18], rot: [-0.14, 0, 0] })
      // Angled hip armor skirts
      .solid(taperedPlate(1.25, 1.65, 1.1, 2.2, 0.1), CORP_WHITE_SHADE, { at: [-2.15, -0.1, 0], rot: [0, 0, 0.28] })
      .solid(taperedPlate(1.25, 1.65, 1.1, 2.2, 0.1), CORP_WHITE_SHADE, { at: [2.15, -0.1, 0], rot: [0, 0, -0.28] })
      // Thin cyan telemetry trim seams
      .glow(new THREE.BoxGeometry(0.14, 0.82, 0.12), CYAN_SEAM, 3.6, { at: [-0.52, -0.18, 1.72] })
      .glow(new THREE.BoxGeometry(0.14, 0.82, 0.12), CYAN_SEAM, 3.6, { at: [0.52, -0.18, 1.72] });
    this.pelvis.add(mat.group(pelvisB));
    this.root.add(this.pelvis);

    const buildReverseLeg = (sx: number, hip: THREE.Group, knee: THREE.Group, shin: THREE.Group): void => {
      hip.position.set(sx * 1.78, -0.1, 0);
      // Heavy upper thigh angled slightly forward into reverse knee
      const thighB = new ModelBuilder()
        .cyl(0.58, 0.58, 0.95, 12, TITANIUM, { at: [0, 0, 0], rot: [0, 0, Math.PI / 2] })
        .solid(taperedPlate(1.28, 1.58, 2.25, 1.55, 0.14), CORP_WHITE, { at: [0, -0.95, 0.28], rot: [-0.24, 0, 0] })
        .solid(chamferBox(1.42, 1.65, 1.12, 0.12), OBSIDIAN_MID, { at: [0, -1.05, 0.12], rot: [-0.24, 0, 0] })
        .solid(chamferBox(0.32, 1.45, 0.95, 0.06), CORP_WHITE_BRIGHT, { at: [sx * 0.78, -0.82, 0.25], rot: [-0.24, 0, sx * -0.08] })
        .glow(new THREE.BoxGeometry(0.12, 1.25, 0.12), CYAN_SEAM, 3.8, { at: [sx * 0.72, -0.92, 0.82], rot: [-0.24, 0, 0] })
        // Hydraulic rear piston strut
        .cyl(0.18, 0.18, 1.75, 8, TITANIUM, { at: [0, -1.02, -0.58], rot: [-0.15, 0, 0] });
      hip.add(mat.group(thighB));

      // Reverse-jointed middle calf / hock assembly (angles rearward!)
      knee.position.set(0, -2.0, 0.55);
      const kneeB = new ModelBuilder()
        .cyl(0.54, 0.54, 1.42, 12, OBSIDIAN_DEEP, { at: [0, 0, 0], rot: [0, 0, Math.PI / 2] })
        .solid(taperedPlate(1.05, 1.42, 0.95, 0.72, 0.1), CORP_WHITE_BRIGHT, { at: [0, 0.12, 0.58], rot: [0.22, 0, 0] })
        .solid(taperedPlate(0.95, 1.22, 1.92, 1.18, 0.12), OBSIDIAN_MID, { at: [0, -0.84, -0.44], rot: [0.46, 0, 0] })
        .solid(chamferBox(1.12, 1.25, 0.36, 0.08), CORP_WHITE_SHADE, { at: [0, -0.78, -0.96], rot: [0.46, 0, 0] })
        .glow(new THREE.BoxGeometry(0.68, 0.12, 0.12), CYAN_SEAM, 3.8, { at: [0, 0.22, 0.96] });
      knee.add(mat.group(kneeB));
      hip.add(knee);

      // Lower digitigrade shin + heavy 3-claw splayed siege foot (reaches y = -1.70 -> ground y = 0!)
      shin.position.set(0, -1.65, -0.85);
      const shinB = new ModelBuilder()
        .cyl(0.42, 0.42, 1.18, 10, TITANIUM, { at: [0, 0, 0], rot: [0, 0, Math.PI / 2] })
        .solid(taperedPlate(0.84, 1.08, 1.48, 1.05, 0.1), CORP_WHITE, { at: [0, -0.72, 0.22], rot: [-0.26, 0, 0] })
        .solid(chamferBox(0.95, 0.92, 0.42, 0.08), OBSIDIAN_SLATE, { at: [0, -0.64, 0.68], rot: [-0.26, 0, 0] })
        .glow(new THREE.BoxGeometry(0.14, 0.78, 0.1), CYAN_SEAM, 3.6, { at: [0, -0.62, 0.92], rot: [-0.26, 0, 0] })
        // Heavy splayed 3-toe mechanical siege foot (sole at y = -1.70)
        .solid(chamferBox(1.75, 0.48, 2.05, 0.09), OBSIDIAN_DEEP, { at: [0, -1.46, 0.36] })
        .solid(taperedPlate(0.62, 0.46, 0.42, 1.15, 0.06), CORP_WHITE_SHADE, { at: [-0.58, -1.5, 1.48], rot: [0, 0.22, 0] })
        .solid(taperedPlate(0.62, 0.46, 0.42, 1.15, 0.06), CORP_WHITE_SHADE, { at: [0.58, -1.5, 1.48], rot: [0, -0.22, 0] })
        // Rear stabilizer heel spur
        .solid(taperedPlate(0.68, 0.44, 0.38, 1.05, 0.06), TITANIUM, { at: [0, -1.52, -0.92] });
      shin.add(mat.group(shinB));
      knee.add(shin);
      this.pelvis.add(hip);
    };

    buildReverseLeg(-1, this.legL, this.kneeL, this.shinL);
    buildReverseLeg(1, this.legR, this.kneeR, this.shinR);
  }

  private buildTorso(): void {
    const mat = this.materials;
    this.torso.position.set(0, 0.55, 0);
    this.pelvis.add(this.torso);

    const torsoB = new ModelBuilder()
      // Waist hydraulic turntable ring & obsidian ribbed abdomen
      .cyl(1.42, 1.58, 0.72, 14, OBSIDIAN_DEEP, { at: [0, 0.32, 0] })
      .solid(chamferBox(2.85, 1.05, 2.35, 0.14), OBSIDIAN_MID, { at: [0, 0.96, 0] })
      // Sculpted obsidian inner chassis skeleton (visible through chest seam & collar cutouts)
      .solid(chamferBox(4.35, 2.65, 3.15, 0.22), OBSIDIAN_DEEP, { at: [0, 2.45, -0.1] })
      // Broad corporate-white upper clavicles & beveled angled chest flank plates
      .solid(taperedPlate(1.55, 2.15, 2.25, 1.15, 0.14), CORP_WHITE, { at: [-1.82, 2.52, 1.02], rot: [0.12, -0.26, 0.12] })
      .solid(taperedPlate(1.55, 2.15, 2.25, 1.15, 0.14), CORP_WHITE, { at: [1.82, 2.52, 1.02], rot: [0.12, 0.26, -0.12] })
      // Sculpted upper corporate-white shoulder deck & beveled armored collar shroud
      .solid(taperedPlate(4.95, 4.15, 0.92, 3.15, 0.16), CORP_WHITE_BRIGHT, { at: [0, 3.72, -0.08] })
      .solid(taperedPlate(2.65, 2.05, 0.78, 1.75, 0.12), OBSIDIAN_SLATE, { at: [0, 4.18, -0.15] })
      // Inset electric-cyan corporate accent seams along flanks & collar
      .glow(new THREE.BoxGeometry(0.14, 1.75, 0.14), CYAN_SEAM, 4.0, { at: [-2.32, 2.55, 1.48], rot: [0.12, -0.26, 0.12] })
      .glow(new THREE.BoxGeometry(0.14, 1.75, 0.14), CYAN_SEAM, 4.0, { at: [2.32, 2.55, 1.48], rot: [0.12, 0.26, -0.12] })
      .glow(new THREE.BoxGeometry(2.85, 0.12, 0.12), CYAN_SEAM, 3.8, { at: [0, 3.75, 1.52] })
      // Heavy sculpted corporate-white outer shoulder pauldrons
      .solid(taperedPlate(1.55, 2.05, 1.85, 3.1, 0.16), CORP_WHITE, { at: [-3.05, 3.15, 0.05], rot: [0, 0, 0.22] })
      .solid(taperedPlate(1.55, 2.05, 1.85, 3.1, 0.16), CORP_WHITE, { at: [3.05, 3.15, 0.05], rot: [0, 0, -0.22] })
      .solid(chamferBox(0.45, 1.45, 2.65, 0.08), OBSIDIAN_SLATE, { at: [-3.82, 3.05, 0.05], rot: [0, 0, 0.22] })
      .solid(chamferBox(0.45, 1.45, 2.65, 0.08), OBSIDIAN_SLATE, { at: [3.82, 3.05, 0.05], rot: [0, 0, -0.22] });
    this.torso.add(mat.group(torsoB));
  }

  private buildHaloHead(): void {
    const mat = this.materials;
    // Centered at torso local y = 4.95 -> ~10.95 m world, outer halo crest reaches ~12.0 m!
    this.headGroup.position.set(0, 4.95, 0.18);
    this.torso.add(this.headGroup);

    // Sleek floating split-chevron obsidian/white geometric head shell (no neck stalk — mag-levitated!)
    const shellB = new ModelBuilder()
      .solid(taperedPlate(1.15, 1.58, 0.88, 1.65, 0.1), CORP_WHITE_BRIGHT, { at: [0, 0.16, 0], rot: [0.08, 0, 0] })
      .solid(chamferBox(1.38, 0.56, 1.42, 0.08), OBSIDIAN_DEEP, { at: [0, -0.18, 0.05] })
      .solid(sweptBlade(1.05, 0.34, 0.42, 0.14, 0.03), CORP_WHITE, { at: [-0.62, 0.42, -0.12], rot: [0, 0.25, 0.92] })
      .solid(sweptBlade(1.05, 0.34, 0.42, 0.14, 0.03), CORP_WHITE, { at: [0.62, 0.42, -0.12], rot: [0, -0.25, Math.PI - 0.92] });
    this.headGroup.add(mat.group(shellB));

    // Glowing optical visor & floating prism eye driven by `headGlowMat` (shifts cyan -> amber -> crimson!)
    const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.22, 0.18), this.headGlowMat);
    visorMesh.position.set(0, 0.02, 0.86);
    this.headGroup.add(visorMesh);

    const eyePrism = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), this.headGlowMat);
    eyePrism.position.set(0, 0.02, 1.05);
    this.headGroup.add(eyePrism);

    // Outer floating geometric Halo Ring (reaches ~12.0 m world height!)
    this.haloRingOuter.position.set(0, 0.28, -0.15);
    const outerMesh = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.065, 6, 8), this.headGlowMat);
    this.haloRingOuter.add(outerMesh);
    this.headGroup.add(this.haloRingOuter);

    // Counter-rotating inner Halo Sensor Ring
    this.haloRingInner.position.set(0, 0.28, -0.15);
    const innerMesh = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.045, 6, 6), this.headGlowMat);
    this.haloRingInner.add(innerMesh);
    this.headGroup.add(this.haloRingInner);
  }

  private buildShoulderRelaysAndShield(): void {
    const mat = this.materials;

    const buildRelay = (sx: number, intactGroup: THREE.Group, brokenGroup: THREE.Group): void => {
      intactGroup.position.set(sx * 3.15, 3.85, -0.25);
      brokenGroup.position.set(sx * 3.15, 3.85, -0.25);
      brokenGroup.visible = false;

      // Swept corporate-white pylon fin + glowing cyan crystalline energy array
      const finB = new ModelBuilder()
        .solid(taperedPlate(1.05, 0.56, 2.35, 0.72, 0.1), CORP_WHITE_BRIGHT, {
          at: [sx * 0.42, 1.05, -0.1],
          rot: [0, 0, sx * -0.26],
        })
        .solid(chamferBox(0.88, 0.52, 0.92, 0.08), OBSIDIAN_MID, { at: [0, 0.15, 0] })
        .glow(new THREE.BoxGeometry(0.28, 1.95, 0.42), CYAN_SEAM, 4.4, {
          at: [sx * 0.65, 1.15, 0.12],
          rot: [0, 0, sx * -0.26],
        })
        .glow(new THREE.OctahedronGeometry(0.42, 0), CYAN_BRIGHT, 5.2, {
          at: [sx * 0.85, 2.25, 0.05],
        });
      intactGroup.add(mat.group(finB));

      // Charred sparking stub left after relay shatters
      const stubB = new ModelBuilder()
        .solid(chamferBox(0.84, 0.56, 0.82, 0.08), CHARRED_METAL, { at: [0, 0.22, 0], rot: [0.15, 0.2, sx * -0.2] })
        .glow(new THREE.BoxGeometry(0.22, 0.26, 0.22), ORANGE_REACTOR, 2.8, { at: [sx * 0.12, 0.56, 0.05] });
      brokenGroup.add(mat.group(stubB));

      this.torso.add(intactGroup);
      this.torso.add(brokenGroup);
    };

    buildRelay(-1, this.relayLIntact, this.relayLBroken);
    buildRelay(1, this.relayRIntact, this.relayRBroken);

    // Translucent cyan hexagonal Hard-Light Shield shell around the front torso
    this.shieldGroup.position.set(0, 2.35, 0.35);
    const shieldGeo = buildShieldArcGeometry(4.15, 4.65, Math.PI * 0.82, 10, 5);
    const fillMesh = new THREE.Mesh(shieldGeo, this.shieldFillMat);
    const wireMesh = new THREE.Mesh(shieldGeo, this.shieldWireMat);
    wireMesh.scale.setScalar(1.008);
    this.shieldGroup.add(fillMesh, wireMesh);
    this.torso.add(this.shieldGroup);
  }

  private buildRearReactorAndThrusters(): void {
    const mat = this.materials;

    // Dorsal thruster nacelles & exhaust louvers
    const thrustB = new ModelBuilder()
      .solid(taperedPlate(1.25, 1.55, 2.35, 1.35, 0.14), CORP_WHITE, { at: [-1.45, 2.65, -1.95], rot: [0.16, 0, 0.1] })
      .solid(taperedPlate(1.25, 1.55, 2.35, 1.35, 0.14), CORP_WHITE, { at: [1.45, 2.65, -1.95], rot: [0.16, 0, -0.1] })
      .cyl(0.48, 0.68, 1.05, 10, OBSIDIAN_DEEP, { at: [-1.45, 1.35, -2.28], rot: [0.28, 0, 0] })
      .cyl(0.48, 0.68, 1.05, 10, OBSIDIAN_DEEP, { at: [1.45, 1.35, -2.28], rot: [0.28, 0, 0] })
      .glow(new THREE.BoxGeometry(0.14, 1.55, 0.14), CYAN_SEAM, 3.6, { at: [-2.02, 2.75, -2.35], rot: [0.16, 0, 0.1] })
      .glow(new THREE.BoxGeometry(0.14, 1.55, 0.14), CYAN_SEAM, 3.6, { at: [2.02, 2.75, -2.35], rot: [0.16, 0, -0.1] });
    this.torso.add(mat.group(thrustB));

    // Dorsal Jump-Jet Flame Cones
    this.jetFlames.position.set(0, 1.05, -2.42);
    this.jetFlames.visible = false;
    const flameB = new ModelBuilder()
      .glow(new THREE.ConeGeometry(0.68, 4.2, 10), CYAN_SEAM, 4.2, { at: [-1.45, -2.05, -0.42], rot: [Math.PI + 0.28, 0, 0] })
      .glow(new THREE.ConeGeometry(0.68, 4.2, 10), CYAN_SEAM, 4.2, { at: [1.45, -2.05, -0.42], rot: [Math.PI + 0.28, 0, 0] })
      .glow(new THREE.ConeGeometry(0.36, 2.7, 8), '#e8ffff', 5.4, { at: [-1.45, -1.4, -0.25], rot: [Math.PI + 0.28, 0, 0] })
      .glow(new THREE.ConeGeometry(0.36, 2.7, 8), '#e8ffff', 5.4, { at: [1.45, -1.4, -0.25], rot: [Math.PI + 0.28, 0, 0] });
    this.jetFlames.add(mat.group(flameB));
    this.torso.add(this.jetFlames);

    // Rear Reactor Core (glowing slatted back core that opens & pulses bright orange during Stage 2 stagger!)
    this.reactorCoreGroup.position.set(0, 2.25, -1.78);
    const coreSphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.76, 1), this.reactorGlowMat);
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.1, 6, 12), this.reactorGlowMat);
    this.reactorCoreGroup.add(coreSphere, coreRing);
    this.torso.add(this.reactorCoreGroup);

    // Slatted hinged dorsal armor doors covering the rear reactor
    this.reactorShutterL.position.set(-0.88, 2.25, -1.96);
    this.reactorShutterR.position.set(0.88, 2.25, -1.96);
    const slatLB = new ModelBuilder()
      .solid(chamferBox(0.88, 1.82, 0.28, 0.06), OBSIDIAN_SLATE, { at: [0.44, 0, 0] })
      .solid(chamferBox(0.72, 0.24, 0.16, 0.04), CORP_WHITE_SHADE, { at: [0.44, 0.55, -0.14] })
      .solid(chamferBox(0.72, 0.24, 0.16, 0.04), CORP_WHITE_SHADE, { at: [0.44, 0, -0.14] })
      .solid(chamferBox(0.72, 0.24, 0.16, 0.04), CORP_WHITE_SHADE, { at: [0.44, -0.55, -0.14] });
    const slatRB = new ModelBuilder()
      .solid(chamferBox(0.88, 1.82, 0.28, 0.06), OBSIDIAN_SLATE, { at: [-0.44, 0, 0] })
      .solid(chamferBox(0.72, 0.24, 0.16, 0.04), CORP_WHITE_SHADE, { at: [-0.44, 0.55, -0.14] })
      .solid(chamferBox(0.72, 0.24, 0.16, 0.04), CORP_WHITE_SHADE, { at: [-0.44, 0, -0.14] })
      .solid(chamferBox(0.72, 0.24, 0.16, 0.04), CORP_WHITE_SHADE, { at: [-0.44, -0.55, -0.14] });
    this.reactorShutterL.add(mat.group(slatLB));
    this.reactorShutterR.add(mat.group(slatRB));
    this.torso.add(this.reactorShutterL, this.reactorShutterR);
  }

  private buildChestNeuralCoreAndGrapple(): void {
    const mat = this.materials;

    // Bright pulsing cyan/white Neural Sphere recessed inside the chest
    this.neuralCoreGroup.position.set(0, 2.35, 1.52);
    this.neuralCoreGroup.visible = false;
    const coreOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 2), this.neuralCoreMat);
    const coreHalo = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.075, 6, 12), this.neuralCoreMat);
    this.neuralCoreGroup.add(coreOrb, coreHalo);
    this.torso.add(this.neuralCoreGroup);

    // Armored interlocking chest shutter doors that crack open in Stage 3B (`crippled_core`)
    this.chestShutterL.position.set(-0.98, 2.35, 1.65);
    this.chestShutterR.position.set(0.98, 2.35, 1.65);
    const chestLB = new ModelBuilder()
      .solid(taperedPlate(0.95, 1.15, 2.05, 0.42, 0.1), CORP_WHITE_BRIGHT, { at: [0.46, 0, 0] })
      .glow(new THREE.BoxGeometry(0.1, 1.55, 0.12), CYAN_SEAM, 3.8, { at: [0.88, 0, 0.2] });
    const chestRB = new ModelBuilder()
      .solid(taperedPlate(0.95, 1.15, 2.05, 0.42, 0.1), CORP_WHITE_BRIGHT, { at: [-0.46, 0, 0] })
      .glow(new THREE.BoxGeometry(0.1, 1.55, 0.12), CYAN_SEAM, 3.8, { at: [-0.88, 0, 0.2] });
    this.chestShutterL.add(mat.group(chestLB));
    this.chestShutterR.add(mat.group(chestRB));
    this.torso.add(this.chestShutterL, this.chestShutterR);

    // High-visibility grappling ring & anchor bars on ORION's shoulders for Stage 3B Gaff climbs!
    this.grappleRingGroup.position.set(0, 4.18, 0.88);
    this.grappleRingGroup.visible = false;
    const grapB = new ModelBuilder()
      .solid(chamferBox(2.4, 0.22, 0.26, 0.05), GRAPPLE_ORANGE, { at: [0, 0.35, 0] })
      .cyl(0.12, 0.12, 0.65, 8, TITANIUM, { at: [-1.08, 0.05, 0] })
      .cyl(0.12, 0.12, 0.65, 8, TITANIUM, { at: [1.08, 0.05, 0] })
      .glow(new THREE.TorusGeometry(0.55, 0.075, 6, 12), GRAPPLE_ORANGE, 4.4, { at: [0, 0.55, 0.12] });
    this.grappleRingGroup.add(mat.group(grapB));
    this.torso.add(this.grappleRingGroup);
  }

  private buildArmsAndWeapons(): THREE.Mesh {
    const mat = this.materials;

    // ---- Left Arm + Deployable Left Plasma Cleaver + Sheared Stump (Stage 2 -> 3) ----
    this.armL.position.set(-3.18, 2.45, 0.25);
    const armLB = new ModelBuilder()
      .cyl(0.52, 0.52, 0.95, 10, TITANIUM, { at: [0, 0, 0], rot: [0, 0, Math.PI / 2] })
      .solid(taperedPlate(0.95, 1.25, 2.05, 1.15, 0.12), OBSIDIAN_MID, { at: [-0.25, -1.05, 0.15] })
      .solid(chamferBox(1.18, 1.18, 2.55, 0.14), CORP_WHITE, { at: [-0.25, -1.65, 1.35] })
      .solid(chamferBox(0.88, 0.42, 2.15, 0.08), OBSIDIAN_SLATE, { at: [-0.25, -1.08, 1.55] })
      .glow(new THREE.BoxGeometry(0.14, 0.16, 1.95), CYAN_SEAM, 3.8, { at: [-0.84, -1.65, 1.45] });
    this.armL.add(mat.group(armLB));

    // Deployable Left Plasma Cleaver blade
    this.cleaverL.position.set(-0.25, -1.65, 2.45);
    this.cleaverL.visible = false;
    const bladeGeoL = sweptBlade(4.2, 0.92, 0.35, 0.16, 0.03);
    bladeGeoL.rotateY(-Math.PI * 0.5);
    const bladeMeshL = new THREE.Mesh(bladeGeoL, this.cleaverMat);
    this.cleaverL.add(bladeMeshL);
    this.armL.add(this.cleaverL);
    this.torso.add(this.armL);

    // Sheared sparking left-arm shoulder stump (shown from Stage 3 `spire_leap` onward)
    this.armLStump.position.set(-3.18, 2.45, 0.25);
    this.armLStump.visible = false;
    const stumpB = new ModelBuilder()
      .solid(chamferBox(0.92, 0.95, 0.96, 0.09), CHARRED_METAL, { at: [-0.15, -0.15, 0.05], rot: [0.22, 0.18, -0.35] })
      .cyl(0.12, 0.12, 0.72, 6, TITANIUM, { at: [-0.45, -0.58, 0.18], rot: [0.4, 0, 0.45] })
      .cyl(0.1, 0.1, 0.68, 6, TITANIUM, { at: [-0.18, -0.62, -0.16], rot: [-0.35, 0, 0.22] })
      .glow(new THREE.OctahedronGeometry(0.28, 0), ORANGE_HOT, 4.4, { at: [-0.35, -0.45, 0.08] });
    this.armLStump.add(mat.group(stumpB));
    this.torso.add(this.armLStump);

    // ---- Right Arm: Heavy Sculpted Thermal Beam Cannon + Underslung Right Plasma Cleaver ----
    this.armR.position.set(3.18, 2.45, 0.25);
    const armRB = new ModelBuilder()
      .cyl(0.56, 0.56, 0.98, 10, TITANIUM, { at: [0, 0, 0], rot: [0, 0, Math.PI / 2] })
      .solid(taperedPlate(1.05, 1.35, 2.05, 1.25, 0.12), OBSIDIAN_MID, { at: [0.25, -1.02, 0.15] })
      // Triple-shroud heavy Thermal Beam Cannon housing
      .solid(chamferBox(1.42, 1.48, 3.15, 0.16), CORP_WHITE, { at: [0.28, -1.55, 1.65] })
      .solid(taperedPlate(0.88, 0.58, 0.52, 2.95, 0.08), CORP_WHITE_BRIGHT, { at: [0.28, -0.78, 2.75] })
      .solid(taperedPlate(0.88, 0.58, 0.52, 2.95, 0.08), OBSIDIAN_SLATE, { at: [0.28, -2.18, 2.55] })
      // Central focusing rail & glowing accelerator rings
      .cyl(0.32, 0.42, 3.45, 10, OBSIDIAN_DEEP, { at: [0.28, -1.52, 2.95], rot: [Math.PI * 0.5, 0, 0] })
      .glow(new THREE.TorusGeometry(0.46, 0.06, 6, 10), CYAN_SEAM, 4.2, { at: [0.28, -1.52, 2.85] })
      .glow(new THREE.TorusGeometry(0.42, 0.06, 6, 10), CYAN_SEAM, 4.2, { at: [0.28, -1.52, 3.65] })
      .glow(new THREE.TorusGeometry(0.38, 0.06, 6, 10), CYAN_BRIGHT, 4.8, { at: [0.28, -1.52, 4.45] });
    this.armR.add(mat.group(armRB));

    // Right-arm underslung deployable Plasma Cleaver (ignites in Stage 2!)
    this.cleaverR.position.set(0.28, -2.35, 2.85);
    this.cleaverR.visible = false;
    const bladeGeoR = sweptBlade(4.2, 0.92, -0.35, 0.16, 0.03);
    bladeGeoR.rotateY(-Math.PI * 0.5);
    const bladeMeshR = new THREE.Mesh(bladeGeoR, this.cleaverMat);
    this.cleaverR.add(bladeMeshR);
    this.armR.add(this.cleaverR);

    // Muzzle charge orb at tip of Thermal Beam Cannon
    const glowB = new ModelBuilder()
      .glow(new THREE.SphereGeometry(0.62, 10, 8), CYAN_SEAM, 4.6)
      .glow(new THREE.SphereGeometry(0.34, 8, 6), '#ffffff', 5.6);
    const muzzleGlow = new THREE.Mesh(glowB.glowGeometry()!, mat.glow);
    muzzleGlow.position.set(0.28, -1.52, 4.78);
    muzzleGlow.visible = false;
    this.armR.add(muzzleGlow);
    this.torso.add(this.armR);

    return muzzleGlow;
  }

  // ---- Dynamic Visual Controls -----------------------------------------------------------------------------------

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    if (!visible) {
      this.hideAllBeams();
    }
  }

  setRelayIntact(side: 'left' | 'right', intact: boolean): void {
    if (side === 'left') {
      this.relayLIntact.visible = intact;
      this.relayLBroken.visible = !intact;
    } else {
      this.relayRIntact.visible = intact;
      this.relayRBroken.visible = !intact;
    }
  }

  setShieldActive(active: boolean): void {
    this.shieldGroup.visible = active;
  }

  pulseShield(): void {
    this.shieldHitFlash = 1.0;
  }

  setCleaversActive(active: boolean): void {
    this.cleaverL.visible = active && this.armL.visible;
    this.cleaverR.visible = active;
  }

  setLeftArmSheared(sheared: boolean): void {
    this.armL.visible = !sheared;
    this.armLStump.visible = sheared;
    if (sheared) this.cleaverL.visible = false;
  }

  setThrusters(active: boolean, intensity = 1, time = 0): void {
    this.jetFlames.visible = active;
    if (active) {
      const flick = 0.88 + Math.sin(time * 42) * 0.18;
      this.jetFlames.scale.set(intensity * flick, intensity * (1.1 + Math.cos(time * 36) * 0.22), intensity * flick);
      this.jetLight.intensity = 42 * intensity * flick;
    } else {
      this.jetLight.intensity = 0;
    }
  }

  setHaloMode(mode: OrionHaloMode): void {
    this.haloMode = mode;
  }

  /** Animates Halo Sensor Head rotation, floating bob, glitch color flicker, and shield shimmer. */
  updateVisualFx(dt: number, time: number, reactorExposed: boolean, coreExposed: boolean): void {
    // Floating geometric halo head animation
    this.headGroup.position.y = 4.95 + Math.sin(time * 2.6) * 0.14;
    this.haloRingOuter.rotation.z = time * (this.haloMode === 'crimson' ? 2.4 : this.haloMode === 'amber' ? 1.5 : 0.85);
    this.haloRingOuter.rotation.x = Math.sin(time * 1.3) * 0.22;
    this.haloRingInner.rotation.z = -time * 1.9;
    this.haloRingInner.rotation.y = time * 1.25;

    // Color & glitch flicker across Stages 1 / 2 / 3
    const base = HALO_COLORS[this.haloMode];
    if (this.haloMode === 'amber') {
      const glitch = Math.sin(time * 37) > 0.82 ? 0.55 : 1.0;
      this.headGlowMat.color.copy(base).multiplyScalar(glitch);
    } else if (this.haloMode === 'crimson') {
      const glitch = Math.sin(time * 53) > 0.78 ? 0.35 : 1.0 + Math.sin(time * 14) * 0.15;
      this.headGlowMat.color.copy(base).multiplyScalar(glitch);
    } else {
      this.headGlowMat.color.copy(base);
    }

    // Hard-Light Shield shimmer & impact flash decay
    if (this.shieldGroup.visible) {
      this.shieldHitFlash = Math.max(0, this.shieldHitFlash - dt * 4.5);
      const shimmer = Math.sin(time * 6.5) * 0.04;
      this.shieldFillMat.opacity = 0.15 + shimmer + this.shieldHitFlash * 0.34;
      this.shieldWireMat.opacity = 0.56 + shimmer * 1.5 + this.shieldHitFlash * 0.4;
    }

    // Rear Reactor slats open wide & pulse hot orange during Stage 2 stagger
    const targetShutterAngle = reactorExposed ? 1.22 : 0;
    this.reactorShutterL.rotation.y = damp(this.reactorShutterL.rotation.y, -targetShutterAngle, 10, dt);
    this.reactorShutterR.rotation.y = damp(this.reactorShutterR.rotation.y, targetShutterAngle, 10, dt);
    const reactorPulse = reactorExposed ? 1.15 + Math.sin(time * 22) * 0.28 : 0.45;
    _col.set(reactorExposed ? ORANGE_HOT : ORANGE_REACTOR).multiplyScalar(reactorExposed ? 5.2 * reactorPulse : 2.2);
    this.reactorGlowMat.color.copy(_col);
    this.reactorCoreGroup.scale.setScalar(reactorExposed ? 1.18 + Math.sin(time * 18) * 0.12 : 0.85);

    // Chest Neural Core shutters crack open during Stage 3B (`crippled_core`)
    const targetChestOpen = coreExposed ? 1.18 : 0;
    this.chestShutterL.rotation.y = damp(this.chestShutterL.rotation.y, -targetChestOpen, 8, dt);
    this.chestShutterR.rotation.y = damp(this.chestShutterR.rotation.y, targetChestOpen, 8, dt);
    this.neuralCoreGroup.visible = coreExposed;
    this.grappleRingGroup.visible = coreExposed;
    if (coreExposed) {
      const pulse = 1.0 + Math.sin(time * 14) * 0.16;
      this.neuralCoreGroup.scale.setScalar(pulse);
      this.neuralCoreGroup.rotation.y = time * 2.4;
    }

    // Plasma Cleaver energy shimmer
    if (this.cleaverR.visible || this.cleaverL.visible) {
      const cPulse = 3.8 + Math.sin(time * 28) * 0.65;
      _col.set(this.haloMode === 'crimson' ? '#ff4460' : '#32f2ff').multiplyScalar(cPulse);
      this.cleaverMat.color.copy(_col);
    }
  }

  /** Updates the Thermal Beam Cannon telegraph or sweeping beam span in world space (zero allocations). */
  updateBeamVisual(
    mode: OrionBeamVisualMode,
    startWorld: THREE.Vector3,
    endWorld: THREE.Vector3,
    time: number,
    crimson = false,
  ): void {
    if (mode === 'off') {
      this.beamMuzzleGlow.visible = false;
      this.telegraphLine.visible = false;
      this.thermalBeamCore.visible = false;
      this.thermalBeamSheath.visible = false;
      return;
    }

    this.beamMuzzleGlow.visible = true;
    const pulse = 0.9 + Math.sin(time * 32) * 0.2;
    this.beamMuzzleGlow.scale.setScalar(mode === 'fire' ? 1.65 * pulse : 0.95 * pulse);

    if (mode === 'telegraph') {
      this.thermalBeamCore.visible = false;
      this.thermalBeamSheath.visible = false;
      this.telegraphMat.color.set(crimson ? '#ff3a52' : '#3cf2ff').multiplyScalar(3.8);
      this.telegraphMat.opacity = 0.55 + Math.sin(time * 34) * 0.25;
      orientBeamSpan(this.telegraphLine, startWorld, endWorld, 0.14);
      return;
    }

    // Active sweeping high-energy beam
    this.telegraphLine.visible = false;
    this.beamSheathMat.color.set(crimson ? '#ff2442' : '#1ce8ff').multiplyScalar(3.6);
    orientBeamSpan(this.thermalBeamCore, startWorld, endWorld, 0.42 * pulse);
    orientBeamSpan(this.thermalBeamSheath, startWorld, endWorld, 1.08 * pulse);
  }

  /** Updates Stage 3A dual crisscrossing Spire Beams in world space (zero allocations). */
  updateSpireBeamsVisual(
    mode: OrionBeamVisualMode,
    startA: THREE.Vector3,
    endA: THREE.Vector3,
    startB: THREE.Vector3,
    endB: THREE.Vector3,
    time: number,
  ): void {
    if (mode === 'off') {
      this.spireBeamCoreA.visible = false;
      this.spireBeamSheathA.visible = false;
      this.spireBeamCoreB.visible = false;
      this.spireBeamSheathB.visible = false;
      return;
    }
    const pulse = 0.9 + Math.sin(time * 36) * 0.22;
    this.beamSheathMat.color.set('#ff2648').multiplyScalar(3.8);
    if (mode === 'telegraph') {
      orientBeamSpan(this.spireBeamSheathA, startA, endA, 0.16);
      orientBeamSpan(this.spireBeamSheathB, startB, endB, 0.16);
      this.spireBeamCoreA.visible = false;
      this.spireBeamCoreB.visible = false;
      return;
    }
    orientBeamSpan(this.spireBeamCoreA, startA, endA, 0.36 * pulse);
    orientBeamSpan(this.spireBeamSheathA, startA, endA, 0.92 * pulse);
    orientBeamSpan(this.spireBeamCoreB, startB, endB, 0.36 * pulse);
    orientBeamSpan(this.spireBeamSheathB, startB, endB, 0.92 * pulse);
  }

  hideAllBeams(): void {
    this.beamMuzzleGlow.visible = false;
    this.telegraphLine.visible = false;
    this.thermalBeamCore.visible = false;
    this.thermalBeamSheath.visible = false;
    this.spireBeamCoreA.visible = false;
    this.spireBeamSheathA.visible = false;
    this.spireBeamCoreB.visible = false;
    this.spireBeamSheathB.visible = false;
  }

  // ---- Articulated Poses -----------------------------------------------------------------------------------------

  applyWalkPose(stridePhase: number, speedNorm: number, dt: number): void {
    const swing = Math.sin(stridePhase) * clamp(speedNorm, 0, 1);
    this.legL.rotation.x = damp(this.legL.rotation.x, swing * 0.44, 12, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, -swing * 0.44, 12, dt);
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, Math.max(0, -swing) * 0.38, 12, dt);
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, Math.max(0, swing) * 0.38, 12, dt);
    this.shinL.rotation.x = damp(this.shinL.rotation.x, -this.kneeL.rotation.x * 0.55, 12, dt);
    this.shinR.rotation.x = damp(this.shinR.rotation.x, -this.kneeR.rotation.x * 0.55, 12, dt);
    this.pelvis.position.y = damp(this.pelvis.position.y, 5.45 + Math.abs(Math.cos(stridePhase)) * 0.28 * speedNorm, 10, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, 0.06 * speedNorm, 8, dt);
    this.torso.rotation.z = damp(this.torso.rotation.z, 0, 8, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, -swing * 0.24, 10, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, 0, 10, dt);
  }

  applyIdlePose(dt: number): void {
    this.pelvis.position.y = damp(this.pelvis.position.y, 5.45, 8, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, 0, 8, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, 0, 8, dt);
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, 0, 8, dt);
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, 0, 8, dt);
    this.shinL.rotation.x = damp(this.shinL.rotation.x, 0, 8, dt);
    this.shinR.rotation.x = damp(this.shinR.rotation.x, 0, 8, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, 0, 8, dt);
    this.torso.rotation.z = damp(this.torso.rotation.z, 0, 8, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, 0, 8, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, 0, 8, dt);
  }

  applyChargePose(dt: number): void {
    this.pelvis.position.y = damp(this.pelvis.position.y, 4.95, 12, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, 0.34, 12, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, -0.32, 12, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, 0.28, 12, dt);
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, 0.45, 12, dt);
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, 0.35, 12, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, -0.45, 12, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, -0.45, 12, dt);
  }

  applyAirbornePose(t: number, dt: number): void {
    const brace = clamp((t - 0.65) / 0.35);
    this.pelvis.position.y = damp(this.pelvis.position.y, THREE.MathUtils.lerp(5.55, 4.7, brace), 10, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, THREE.MathUtils.lerp(0.26, 0.14, brace), 10, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, THREE.MathUtils.lerp(-0.46, -0.28, brace), 10, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, THREE.MathUtils.lerp(0.24, -0.24, brace), 10, dt);
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, 0.68, 10, dt);
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, 0.56, 10, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, -0.32, 10, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, -0.28, 10, dt);
  }

  /** Stage 2 concrete-buried stagger pose: hunched forward exposing the glowing orange Rear Reactor Core! */
  applyStaggerPose(time: number, dt: number): void {
    const tremor = Math.sin(time * 26) * 0.04;
    this.pelvis.position.y = damp(this.pelvis.position.y, 3.85, 8, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, -0.68, 8, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, -0.42, 8, dt);
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, 1.05, 8, dt);
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, 0.78, 8, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, 0.48 + tremor, 8, dt);
    this.torso.rotation.z = damp(this.torso.rotation.z, 0.12 + tremor, 8, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, 0.62, 8, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, 0.74, 8, dt);
  }

  /** Stage 3B crippled kneel pose: legs blown/sparking, chest Neural Core cracked open facing sky/player! */
  applyCrippledKneelPose(time: number, dt: number): void {
    const shudder = Math.sin(time * 18) * 0.025;
    this.pelvis.position.y = damp(this.pelvis.position.y, 2.85, 7, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, -0.95, 7, dt);
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, 1.48, 7, dt);
    this.shinL.rotation.x = damp(this.shinL.rotation.x, -0.45, 7, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, -0.58, 7, dt);
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, 1.12, 7, dt);
    this.shinR.rotation.x = damp(this.shinR.rotation.x, -0.35, 7, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, -0.18 + shudder, 7, dt);
    this.torso.rotation.z = damp(this.torso.rotation.z, -0.08, 7, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, 0.85, 7, dt);
  }

  /** Final collapsed wreck pose after Neural Core detonation. */
  applyDeadPose(): void {
    this.hideAllBeams();
    this.setThrusters(false);
    this.setShieldActive(false);
    this.setCleaversActive(false);
    this.setHaloMode('dead');
    this.pelvis.position.y = 2.15;
    this.legL.rotation.x = -1.1;
    this.kneeL.rotation.x = 1.65;
    this.legR.rotation.x = -0.82;
    this.kneeR.rotation.x = 1.38;
    this.torso.rotation.x = 0.62;
    this.torso.rotation.z = -0.24;
    this.armR.rotation.x = 1.05;
    this.neuralCoreGroup.visible = false;
    this.grappleRingGroup.visible = false;
  }

  resetPoseImmediate(): void {
    this.pelvis.position.y = 5.45;
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.kneeL.rotation.set(0, 0, 0);
    this.kneeR.rotation.set(0, 0, 0);
    this.shinL.rotation.set(0, 0, 0);
    this.shinR.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
  }

  /** Computes the world position of the Right-Arm Thermal Beam Cannon muzzle into `out`. */
  getBeamMuzzleWorld(rootPos: THREE.Vector3, torsoYaw: number, out: THREE.Vector3): THREE.Vector3 {
    // ArmR mount (3.18, 2.45, 0.25) + muzzle (0.28, -1.52, 4.78) + torso (0, 0.55, 0) + pelvis.y
    return out
      .set(3.46, this.pelvis.position.y + 1.48, 5.03)
      .applyAxisAngle(_up, torsoYaw)
      .add(rootPos);
  }

  /** Computes the world position of ORION's dorsal power socket (tether target for Grid Conduits). */
  getDorsalSocketWorld(rootPos: THREE.Vector3, torsoYaw: number, out: THREE.Vector3): THREE.Vector3 {
    return out
      .set(0, this.pelvis.position.y + 3.45, -1.55)
      .applyAxisAngle(_up, torsoYaw)
      .add(rootPos);
  }

  /** Computes the world position of ORION's Stage 3B shoulder grapple ring into `out`. */
  getGrappleAnchorWorld(rootPos: THREE.Vector3, torsoYaw: number, out: THREE.Vector3): THREE.Vector3 {
    return out
      .set(0, this.pelvis.position.y + 4.7, 0.88)
      .applyAxisAngle(_up, torsoYaw)
      .add(rootPos);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.beamWorldRoot.removeFromParent();
    this.headGlowMat.dispose();
    this.shieldFillMat.dispose();
    this.shieldWireMat.dispose();
    this.cleaverMat.dispose();
    this.reactorGlowMat.dispose();
    this.neuralCoreMat.dispose();
    this.telegraphMat.dispose();
    this.beamCoreMat.dispose();
    this.beamSheathMat.dispose();
  }
}
