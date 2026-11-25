/**
 * Halo Seraph Crown (`headHalo`): tall ornate high-tech faceless sensor monolith head split by a vertical glowing
 * optic seam, twin backward-sweeping curved horn fins, and a hovering segmented geometric Halo Ring / dual-arc sensor
 * crown that gently rotates and bobs above the crown in `pose(...)`.
 */
import * as THREE from 'three';
import { clamp, TAU } from '../../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../../progression/modelkit';
import {
  ACROSS, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism,
  type FramePalette, type HeadVisual,
} from '../shared';

const _yAxis = new THREE.Vector3(0, 1, 0);
function acrossRot(roll = 0, yaw = 0, pitch = 0): [number, number, number] {
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(pitch, yaw, -roll, 'YXZ'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(_yAxis, Math.PI / 2));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

function buildMonolith(b: ModelBuilder): void {
  // Sleek tall collared neck base.
  b.solid(prism(ngon(0.3, 10), 0.16, 0.02), STEEL, { at: [0, 0.08, 0], rot: FLAT });

  // Tall sculpted faceless geometric sensor monolith (swept curved prow).
  b.solid(prism([
    [-0.4, 0.14], [0.28, 0.12], [0.46, 0.42], [0.32, 0.88], [0.06, 1.06],
    [-0.36, 0.96], [-0.52, 0.54],
  ], 0.52, 0.045), PLATE, { rot: ACROSS });

  // Smooth obsidian faceless visor mask plate with recessed central vertical seam.
  b.solid(prism([
    [0.14, 0.18], [0.48, 0.34], [0.36, 0.84], [0.12, 0.94],
  ], 0.44, 0.025), OBSIDIAN, { rot: ACROSS });
  b.box(0.11, 0.62, 0.12, DARK, { at: [0, 0.56, -0.43], rot: [-0.16, 0, 0] });
  // Vertical glowing optic seam splitting the faceless monolith!
  b.glow(new THREE.BoxGeometry(0.05, 0.56, 0.04), RED, 5.0, { at: [0, 0.56, -0.49], rot: [-0.16, 0, 0] });
  // Brass forehead geometric diamond insignia above the seam.
  b.solid(prism([
    [0, -0.08], [0.065, 0], [0, 0.1], [-0.065, 0],
  ], 0.06, 0.01), BRASS, { at: [0, 0.88, -0.37], rot: [-0.26, 0, 0] });

  for (const s of [-1, 1]) {
    // Sleek sweeping cheek blades flanking the monolith face.
    b.solid(prism([
      [-0.22, 0.16], [0.36, 0.24], [0.24, 0.64], [-0.34, 0.72],
    ], 0.09, 0.016), GUNMETAL, { at: [s * 0.3, 0, 0], rot: [0, Math.PI / 2 + s * -0.14, 0] });

    // Twin backward-sweeping curved seraph horn fins rising aft from the temples.
    b.solid(prism([
      [-0.56, -0.12], [0.28, -0.2], [0.16, 0.02], [-0.42, 0.42], [-0.74, 0.3],
    ], 0.065, 0.014), PLATE, { at: [s * 0.32, 0.76, 0.24], rot: acrossRot(s * 0.22, s * -0.16) });
    b.glow(new THREE.BoxGeometry(0.03, 0.035, 0.48), AMBER, 3.8, {
      at: [s * 0.42, 0.94, 0.46],
      rot: [0.46, s * -0.16, s * -0.22],
    });
  }

  // Slender magnetic emitter spire projecting upward beneath the floating Halo ring.
  b.cyl(0.04, 0.065, 0.22, 10, IRON, { at: [0, 1.08, -0.02] });
  b.glow(new THREE.OctahedronGeometry(0.055, 0), RED, 4.6, { at: [0, 1.22, -0.02] });
}

function buildHaloRing(b: ModelBuilder): void {
  // Segmented geometric dual-arc Halo Ring (8 bevelled metallic compass segments + inner glowing energy arcs!).
  const rOuter = 0.58;
  const rInner = 0.47;
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    const cx = Math.cos(a) * rOuter;
    const cz = Math.sin(a) * rOuter;
    b.solid(prism([
      [-0.17, -0.032], [0.17, -0.032], [0.14, 0.036], [-0.14, 0.036],
    ], 0.05, 0.01), i % 2 === 0 ? BRASS : PLATE, {
      at: [cx, 0, cz],
      rot: [Math.PI / 2, -a + Math.PI / 2, 0],
    });
    // Glowing inner energy arc segment floating inside the geometric halo crown.
    const gx = Math.cos(a) * rInner;
    const gz = Math.sin(a) * rInner;
    b.glow(new THREE.BoxGeometry(0.28, 0.032, 0.032), i % 2 === 0 ? RED : AMBER, 4.6, {
      at: [gx, 0, gz],
      rot: [0, -a + Math.PI / 2, 0],
    });
  }
  // Four cardinal geometric diamond compass nodes around the outer rim.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    b.solid(prism([
      [0, -0.075], [0.05, 0], [0, 0.075], [-0.05, 0],
    ], 0.05, 0.01), STEEL, {
      at: [Math.cos(a) * (rOuter + 0.09), 0.02, Math.sin(a) * (rOuter + 0.09)],
      rot: [0, -a + Math.PI / 2, 0],
    });
  }
}

export function buildHaloHead(materials: ModelMaterials, palette?: FramePalette): HeadVisual {
  const monoB = frameBuilder(palette);
  buildMonolith(monoB);
  const haloB = frameBuilder(palette);
  buildHaloRing(haloB);

  const haloRing = materials.group(haloB);
  haloRing.name = 'head.halo.ring';
  haloRing.position.set(0, 1.32, -0.02);
  haloRing.rotation.x = 0.14;

  const headPivot = new THREE.Group();
  headPivot.name = 'head.halo.pivot';
  headPivot.add(materials.group(monoB), haloRing);

  const group = new THREE.Group();
  group.name = 'head.halo';
  group.add(headPivot);

  let clock = 0;
  let smoothPitch = 0;
  let smoothYaw = 0;
  return {
    group,
    pose(aimYawDelta: number, aimPitch: number, dt: number, standby: boolean) {
      clock += dt * (standby ? 0.35 : 1);
      const k = Math.min(1, dt * 7);
      const targetPitch = standby ? -0.1 : clamp(aimPitch * 0.38, -0.28, 0.28);
      const targetYaw = standby ? 0 : clamp(aimYawDelta * 0.45, -0.4, 0.4);
      smoothPitch += (targetPitch - smoothPitch) * k;
      smoothYaw += (targetYaw - smoothYaw) * k;
      headPivot.rotation.set(smoothPitch, smoothYaw, 0);

      // Gentle serene rotation and float/pulse on the geometric Halo Ring!
      haloRing.rotation.y = clock * 0.72;
      haloRing.position.y = 1.32 + Math.sin(clock * 2.2) * 0.045;
      const pulse = standby ? 0.94 : 1 + Math.sin(clock * 3.4) * 0.03;
      haloRing.scale.setScalar(pulse);
    },
  };
}
