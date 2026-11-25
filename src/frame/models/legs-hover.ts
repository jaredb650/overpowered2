/**
 * Mag-Skiff Hover Hull 3D model (`legsHover`):
 * Sculpted wide flared armoured hover-skirt boat chassis (octagonal/hexagonal armoured apron with angled
 * reactive skirts), 4 gimballed vectored plasma hover-thruster bells underneath, glowing cyan hover-ring
 * glow bands & undercarriage steering vanes that tilt smoothly into movement/dash direction and pulse live.
 */
import * as THREE from 'three';
import { clamp, lerp } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism, type FramePalette, type LegsVisual,
} from './shared';

const HOVER_CYAN = '#38e8ff';
const HOVER_CORE = '#d8fbff';

const THRUSTER_CORNERS: readonly (readonly [number, number, number, number])[] = [
  [-1.26, 0.56, -1.42, -1],
  [1.26, 0.56, -1.42, 1],
  [-1.38, 0.56, 1.38, -1],
  [1.38, 0.56, 1.38, 1],
];

function buildTurretPedestal(b: ModelBuilder, hipsY: number): void {
  // Heavy octagonal waist bearing ring flush with the torso belly.
  b.solid(prism(ngon(1.18, 8, Math.PI / 8), 0.28, 0.04), STEEL, { at: [0, hipsY, 0.14], rot: FLAT });
  b.cyl(1.24, 1.32, 0.14, 16, BRASS, { at: [0, hipsY - 0.16, 0.14] });
  // Tapered armoured turret neck connecting waist down into the wide skiff deck.
  b.solid(prism([
    [-1.46, 1.98], [1.52, 1.98], [1.18, hipsY - 0.24], [-1.14, hipsY - 0.24],
  ], 2.08, 0.065), OBSIDIAN, { at: [0, 0, 0.12], rot: ACROSS });
  b.solid(prism([
    [0.64, 2.04], [1.62, 2.0], [1.26, hipsY - 0.3], [0.6, hipsY - 0.28],
  ], 1.66, 0.045), PLATE, { at: [0, 0, 0.12], rot: ACROSS });
  // Four diagonal hydraulic recoil stabilizer struts bracing pedestal onto the hover deck.
  for (const s of [-1, 1]) {
    for (const zOff of [-0.66, 0.88]) {
      b.cyl(0.095, 0.095, 1.32, 10, STEEL, { at: [s * 1.18, 2.48, zOff], rot: [0, 0, s * 0.58] });
      b.cyl(0.135, 0.135, 0.42, 10, BRASS, { at: [s * 1.12, 2.58, zOff], rot: [0, 0, s * 0.58] });
    }
  }
}

function buildSkiffHull(b: ModelBuilder): void {
  // Primary wide flared octagonal boat-like hover hull (`y = 0.72 .. 2.06`, prow pointing -Z).
  b.solid(prism([
    [-2.42, 0.84], [1.96, 0.76], [2.88, 1.28], [2.46, 1.88], [1.62, 2.08], [-1.96, 2.08], [-2.68, 1.54],
  ], 3.12, 0.09), OBSIDIAN, { at: [0, 0, 0.0], rot: ACROSS });

  // Sculpted upper sloped glacis prow plate & dorsal intake cowling.
  b.solid(prism([
    [1.12, 1.82], [2.82, 1.34], [2.52, 1.94], [1.46, 2.16],
  ], 2.58, 0.055), PLATE, { at: [0, 0, 0.0], rot: ACROSS });
  // Lower prow splitter chin & ramming bumper.
  b.solid(prism([
    [1.76, 0.68], [2.86, 1.12], [2.72, 1.3], [1.68, 0.92],
  ], 2.14, 0.04), GUNMETAL, { at: [0, 0, 0.0], rot: ACROSS });

  // Wide flared hexagonal armoured hover-skirt apron wrapping both flanks.
  for (const s of [-1, 1]) {
    // Angled flared side sponson skirt hull.
    b.solid(prism([
      [-2.38, 0.48], [2.28, 0.48], [2.62, 1.12], [2.04, 1.66], [-2.08, 1.66], [-2.62, 1.16],
    ], 0.64, 0.05), GUNMETAL, { at: [s * 1.72, 0.08, 0.04], rot: [0, Math.PI / 2, s * -0.24] });

    // Layered outer reactive armour skirt plates along each flank.
    for (let p = 0; p < 4; p++) {
      const pz = -1.52 + p * 1.02;
      b.solid(prism([
        [-0.44, -0.34], [0.44, -0.34], [0.38, 0.34], [-0.38, 0.34],
      ], 0.14, 0.025), p % 2 === 0 ? PLATE : OBSIDIAN, { at: [s * 2.04, 1.06, pz], rot: [0, Math.PI / 2, s * -0.28] });
    }

    // Dark recessed repulsor intake grilles mounted on the flared forward/rear shoulders.
    for (const iz of [-1.22, 1.12]) {
      b.solid(prism(ngon(0.46, 8, Math.PI / 8), 0.16, 0.02), DARK, { at: [s * 1.48, 1.94, iz], rot: FLAT });
      b.solid(prism(ngon(0.52, 8, Math.PI / 8), 0.08, 0.015), STEEL, { at: [s * 1.48, 2.0, iz], rot: FLAT });
      b.glow(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 10), HOVER_CYAN, 3.6, { at: [s * 1.48, 1.9, iz] });
    }

    // Forward amber bow navigation lamps + cyan edge trim strip along skirt lip.
    b.box(0.34, 0.16, 0.16, IRON, { at: [s * 1.06, 1.68, -2.52] });
    b.glow(new THREE.BoxGeometry(0.26, 0.075, 0.04), AMBER, 4.0, { at: [s * 1.06, 1.68, -2.61] });
    b.glow(new THREE.BoxGeometry(0.05, 0.055, 3.72), HOVER_CYAN, 4.2, { at: [s * 2.12, 0.56, 0.04] });

    // Swept rear stabilization stern fins & thruster louver vanes.
    b.solid(prism([
      [-0.86, 0.0], [0.24, -0.14], [0.28, 0.58], [-0.62, 0.72],
    ], 0.14, 0.025), PLATE, { at: [s * 1.44, 1.64, 2.26], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.04, 0.04, 0.68), RED, 3.6, { at: [s * 1.44, 2.28, 2.48] });
  }

  // Lower recessed rubberized hover-cushion plenum rim (sits cleanly at y = 0.24..0.64 above ground pad).
  b.solid(prism(ngon(2.26, 8, Math.PI / 8), 0.34, 0.04), DARK, { at: [0, 0.46, 0.0], rot: FLAT });
  // Undercarriage longitudinal stability skids (bottom flush at y = 0.02 when parked).
  for (const s of [-1, 1]) {
    b.solid(prism([
      [-1.78, 0.02], [1.86, 0.02], [2.04, 0.24], [-1.96, 0.24],
    ], 0.24, 0.02), IRON, { at: [s * 1.18, 0, 0], rot: ACROSS });
  }
  // Undercarriage vectored steering louver vanes across the belly plenum.
  for (let i = -2; i <= 2; i++) {
    b.box(1.92, 0.12, 0.07, STEEL, { at: [0, 0.36, i * 0.62], rot: [0.35, 0, 0] });
  }
}

function buildThrusterBell(b: ModelBuilder): void {
  // Gimballed repulsor bell housing pointing downward (-Y).
  b.solid(prism(ngon(0.46, 8, Math.PI / 8), 0.24, 0.03), STEEL, { at: [0, 0.04, 0], rot: FLAT });
  b.cyl(0.34, 0.5, 0.44, 12, OBSIDIAN, { at: [0, -0.22, 0] });
  b.cyl(0.44, 0.5, 0.08, 12, BRASS, { at: [0, -0.42, 0] });
  b.glow(new THREE.CylinderGeometry(0.28, 0.38, 0.06, 12), HOVER_CYAN, 4.8, { at: [0, -0.36, 0] });
}

export function buildHoverLegs(materials: ModelMaterials, hipsY: number, palette?: FramePalette): LegsVisual {
  const group = new THREE.Group();
  group.name = 'frame.legs.hover';

  const hullGroup = new THREE.Group();
  const baseB = frameBuilder(palette);
  buildTurretPedestal(baseB, hipsY);
  buildSkiffHull(baseB);
  hullGroup.add(materials.group(baseB));

  // 4 angled vectored plasma hover-thruster bells + dynamic glowing cyan hover rings underneath.
  const bells: THREE.Group[] = [];
  const rings: THREE.Mesh[] = [];
  const ringMats: THREE.MeshBasicMaterial[] = [];
  const ringGeo = new THREE.TorusGeometry(0.48, 0.065, 8, 20);
  ringGeo.rotateX(Math.PI / 2);

  const glowColor = palette ? palette.thruster : HOVER_CYAN;
  const cyanTint = new THREE.Color(HOVER_CYAN).lerp(new THREE.Color(glowColor), 0.35);

  for (let i = 0; i < THRUSTER_CORNERS.length; i++) {
    const [tx, ty, tz, side] = THRUSTER_CORNERS[i]!;
    const bell = new THREE.Group();
    bell.position.set(tx, ty, tz);
    bell.rotation.set(tz < 0 ? -0.14 : 0.14, 0, side * 0.16);

    const bb = frameBuilder(palette);
    buildThrusterBell(bb);
    bell.add(materials.group(bb));

    const rMat = new THREE.MeshBasicMaterial({
      color: cyanTint.clone().multiplyScalar(3.6),
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeo, rMat);
    ring.position.set(0, -0.48, 0);
    bell.add(ring);

    hullGroup.add(bell);
    bells.push(bell);
    rings.push(ring);
    ringMats.push(rMat);
  }

  // Central wide glowing hover cushion ring beneath the hull apron.
  const cushionGeo = new THREE.RingGeometry(1.55, 2.18, 24);
  cushionGeo.rotateX(-Math.PI / 2);
  const cushionMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(HOVER_CORE).lerp(cyanTint, 0.6).multiplyScalar(2.4),
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const cushionRing = new THREE.Mesh(cushionGeo, cushionMat);
  cushionRing.position.set(0, 0.08, 0);
  hullGroup.add(cushionRing);

  group.add(hullGroup);

  let clock = 0;
  let pitchTilt = 0;
  let rollTilt = 0;

  return {
    group,
    pose(_stride, walk, effectiveSink, kneel, collapse, limpSide, parked, jetMode, extra): void {
      const dt = Math.max(0, extra?.dt ?? 1 / 60);
      clock += dt;

      const w = clamp(walk);
      const speed = extra?.speed ?? w * 7;
      const turnRate = extra?.turnRate ?? 0;
      const dashExtra = extra as { dashDirX?: number; dashDirZ?: number } | undefined;
      const dashX = dashExtra?.dashDirX ?? 0;
      const dashZ = dashExtra?.dashDirZ ?? 0;

      const active = !parked && collapse < 0.3;
      const sinkY = clamp(effectiveSink * 0.45, -0.8, 0.35);
      hullGroup.position.y = sinkY - kneel * 0.25 - collapse * 0.32;

      // Smooth chassis tilt into movement, dash direction, and turn banking.
      const targetPitch = jetMode
        ? -0.26
        : active
          ? clamp(-Math.min(1, speed / 12) * 0.14 + dashZ * 0.16, -0.24, 0.24) + collapse * 0.18
          : 0.04;
      const targetRoll = active
        ? clamp(-turnRate * 0.12 - dashX * 0.18, -0.26, 0.26) + limpSide * 0.05
        : collapse * 0.12;

      const smooth = 1 - Math.exp(-8 * dt);
      pitchTilt = lerp(pitchTilt, targetPitch, smooth);
      rollTilt = lerp(rollTilt, targetRoll, smooth);
      hullGroup.rotation.set(pitchTilt, 0, rollTilt);

      // Pulse hover-thruster glow bands and vector the 4 thruster bells subtly into thrust direction.
      const pulse = 0.85 + Math.sin(clock * 14) * 0.15;
      const power = active ? (extra?.hovering || extra?.flying || jetMode ? 1.25 : 0.72 + clamp(speed / 12) * 0.45) : 0.08;

      cushionRing.visible = active;
      if (active) {
        const s = 0.96 + Math.sin(clock * 9) * 0.05;
        cushionRing.scale.set(s, 1, s);
        cushionMat.opacity = clamp(0.28 * power * pulse, 0.1, 0.65);
      }

      for (let i = 0; i < bells.length; i++) {
        const [, , tz, side] = THRUSTER_CORNERS[i]!;
        const bell = bells[i]!;
        bell.rotation.set(
          (tz < 0 ? -0.14 : 0.14) + pitchTilt * 1.4,
          0,
          side * 0.16 - rollTilt * 1.3,
        );
        const ring = rings[i]!;
        ring.visible = active;
        if (active) {
          const rScale = (0.88 + Math.sin(clock * 22 + i * 1.4) * 0.12) * (0.9 + power * 0.22);
          ring.scale.set(rScale, 1, rScale);
          ringMats[i]!.opacity = clamp(0.62 * power * pulse, 0.15, 0.95);
        }
      }
    },
  };
}
