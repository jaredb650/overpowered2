/**
 * Sculpted 3D dorsal backpack engine models for Overhaul v2 drives (`blink`, `redline`, `assault`):
 * - `blink`: 6-nozzle omnidirectional vector-thruster array (central spine core + 4 angled lateral micro-verniers
 *   + twin upper dorsal jump nozzles with crisp cyan glow cones that flare on dash/jets opposite `dashDir`).
 * - `redline`: Twin exposed glowing crimson-amber plasma reactor coils inside a ribbed skeletal heat-radiator cage
 *   with articulated flared vent wings that visibly blaze bright crimson when `extra?.redline > 0`.
 * - `assault`: Massive twin over-the-shoulder armoured ram-jet turbine pods + central dorsal afterburner pike with
 *   flared intake cowls and huge blazing exhaust plumes when `extra?.charging` or `jetMode` is active.
 */
import * as THREE from 'three';
import { clamp, lerp } from '../../core/math';
import type { ModelMaterials } from '../../progression/modelkit';
import type { DriveKind } from '../loadout';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  frameBuilder, ngon, prism, type EngineVisual, type FramePalette,
} from './shared';

const CYAN_OUTER = '#2ae6ff';
const CYAN_INNER = '#e6fdff';
const CRIMSON_OUTER = '#ff2238';
const CRIMSON_INNER = '#ffd8cc';

/** Nested translucent HDR exhaust cones pointing along local `-Y`. */
function makePlume(
  outerRadius: number,
  outerLen: number,
  outerColor: string,
  innerColor: string,
  outerBoost = 3.8,
  innerBoost = 5.0,
): THREE.Group {
  const root = new THREE.Group();
  const outerGeo = new THREE.ConeGeometry(outerRadius, outerLen, 10, 1, true);
  outerGeo.translate(0, -outerLen * 0.5, 0);
  const outerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(outerColor).multiplyScalar(outerBoost),
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
  });
  root.add(new THREE.Mesh(outerGeo, outerMat));

  const innerGeo = new THREE.ConeGeometry(outerRadius * 0.5, outerLen * 0.65, 8, 1, true);
  innerGeo.translate(0, -outerLen * 0.325, 0);
  const innerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(innerColor).multiplyScalar(innerBoost),
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: false,
  });
  root.add(new THREE.Mesh(innerGeo, innerMat));
  root.visible = false;
  return root;
}

/**
 * Blink-Step Booster (`blink`):
 * 6-nozzle omnidirectional vector-thruster array: central spine core + 4 angled lateral micro-verniers
 * + twin upper dorsal jump nozzles with crisp cyan glow cones that flare dynamically on dash/jets.
 */
function buildBlinkVisual(materials: ModelMaterials, palette?: FramePalette): EngineVisual {
  const group = new THREE.Group();
  group.name = 'engine.blink';

  const b = frameBuilder(palette);
  // Compact central dorsal capacitor spine core.
  b.solid(prism([
    [-0.46, 0.72], [0.42, 0.72], [0.54, 1.38], [0.36, 2.36], [-0.28, 2.48], [-0.56, 1.72],
  ], 1.12, 0.045), OBSIDIAN, { at: [0, 0, 1.72], rot: ACROSS });
  b.solid(prism([
    [-0.26, 1.02], [0.32, 1.02], [0.22, 2.44], [-0.2, 2.52],
  ], 0.64, 0.03), PLATE, { at: [0, 0, 1.78], rot: ACROSS });
  b.cyl(0.16, 0.16, 1.66, 10, BRASS, { at: [0, 1.66, 1.82], rot: [0, 0, Math.PI / 2] });
  b.glow(new THREE.BoxGeometry(0.08, 1.24, 0.06), CYAN_OUTER, 4.4, { at: [0, 1.68, 2.28] });

  // Twin upper dorsal jump-nozzle cowls (nozzles 1 & 2).
  for (const s of [-1, 1]) {
    b.solid(prism([
      [-0.36, -0.22], [0.34, -0.22], [0.44, 0.24], [-0.32, 0.34],
    ], 0.44, 0.03), GUNMETAL, { at: [s * 0.86, 2.18, 1.84], rot: [0.24, 0, s * -0.28] });
    b.cyl(0.18, 0.28, 0.42, 10, IRON, { at: [s * 0.96, 1.84, 1.98], rot: [0.34, 0, s * -0.28] });
    b.glow(new THREE.CylinderGeometry(0.14, 0.2, 0.05, 10), CYAN_OUTER, 4.8, { at: [s * 1.01, 1.65, 2.04], rot: [0.34, 0, s * -0.28] });
  }

  // 4 angled lateral micro-vernier thruster housings (FL-side, FR-side, RL-side, RR-side = nozzles 3..6).
  const vernierSpecs: readonly {
    pos: readonly [number, number, number];
    rot: readonly [number, number, number];
    /** Dash direction component that fires this vernier (opposite exhaust thrust!). */
    fireX: number;
    fireZ: number;
  }[] = [
    // Left upper lateral vernier (fires when blinking right or forward-right)
    { pos: [-1.18, 1.62, 1.56], rot: [0.22, 0, 1.18], fireX: 1, fireZ: -0.4 },
    // Right upper lateral vernier (fires when blinking left or forward-left)
    { pos: [1.18, 1.62, 1.56], rot: [0.22, 0, -1.18], fireX: -1, fireZ: -0.4 },
    // Left lower aft vernier (fires when blinking forward or right)
    { pos: [-0.94, 1.02, 2.14], rot: [-1.22, 0, 0.48], fireX: 0.5, fireZ: -1 },
    // Right lower aft vernier (fires when blinking forward or left)
    { pos: [0.94, 1.02, 2.14], rot: [-1.22, 0, -0.48], fireX: -0.5, fireZ: -1 },
  ];

  for (const spec of vernierSpecs) {
    b.cyl(0.12, 0.19, 0.34, 8, STEEL, { at: spec.pos, rot: spec.rot });
    b.cyl(0.16, 0.19, 0.08, 8, BRASS, { at: spec.pos, rot: spec.rot });
  }
  group.add(materials.group(b));

  const outerCyan = palette ? new THREE.Color(CYAN_OUTER).lerp(new THREE.Color(palette.thruster), 0.25).getStyle() : CYAN_OUTER;
  const jumpPlumes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const p = makePlume(0.26, 1.85, outerCyan, CYAN_INNER, 4.0, 5.2);
    p.position.set(s * 1.02, 1.62, 2.06);
    p.rotation.set(0.34, 0, s * -0.28);
    group.add(p);
    jumpPlumes.push(p);
  }

  const vernierPlumes: THREE.Group[] = [];
  for (const spec of vernierSpecs) {
    const p = makePlume(0.18, 1.35, outerCyan, CYAN_INNER, 4.4, 5.6);
    p.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    p.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
    group.add(p);
    vernierPlumes.push(p);
  }

  let clock = 0;

  return {
    group,
    pose(dt, jets, flying, hovering, jetMode, _stride, inside, extra): void {
      clock += Math.max(0, dt);
      const jumpBurn = (jets || flying || hovering || jetMode) && !inside;
      const charging = extra?.charging === true;
      const dx = extra?.dashDirX ?? 0;
      const dz = extra?.dashDirZ ?? 0;
      const dashMag = Math.hypot(dx, dz);

      for (let i = 0; i < jumpPlumes.length; i++) {
        const p = jumpPlumes[i]!;
        p.visible = jumpBurn || (charging && !inside);
        if (p.visible) {
          const flick = 0.88 + Math.sin(clock * 54 + i * 2.1) * 0.16;
          p.scale.set(1, (charging ? 1.35 : 0.95) * flick, 1);
        }
      }

      for (let i = 0; i < vernierPlumes.length; i++) {
        const spec = vernierSpecs[i]!;
        const p = vernierPlumes[i]!;
        const align = dashMag > 0.05 ? (dx * spec.fireX + dz * spec.fireZ) / dashMag : 0;
        const flare = !inside && ((charging && align > -0.15) || (dashMag > 0.15 && align > 0.2));
        p.visible = flare;
        if (flare) {
          const flick = 0.9 + Math.sin(clock * 64 + i * 1.7) * 0.18;
          const strength = clamp(0.65 + align * 0.85, 0.45, 1.65) * flick;
          p.scale.set(0.95, strength, 0.95);
        }
      }
    },
  };
}

/**
 * Redline Surge Reactor (`redline`):
 * Twin exposed glowing crimson-amber plasma reactor coils cradled inside a ribbed skeletal heat-radiator cage
 * with articulated flared vent wings that visibly blaze bright crimson during Redline Surge (`extra?.redline > 0`).
 */
function buildRedlineVisual(materials: ModelMaterials, palette?: FramePalette): EngineVisual {
  const group = new THREE.Group();
  group.name = 'engine.redline';

  const cage = frameBuilder(palette);
  // Heavy dorsal containment backbone & upper/lower collector manifolds.
  cage.solid(prism([
    [-0.52, 0.56], [0.44, 0.56], [0.52, 2.24], [-0.38, 2.34], [-0.62, 1.54],
  ], 1.68, 0.055), OBSIDIAN, { at: [0, 0, 1.74], rot: ACROSS });
  cage.solid(prism(ngon(0.36, 8, Math.PI / 8), 2.18, 0.03), GUNMETAL, { at: [0, 2.24, 2.02], rot: ACROSS });
  cage.solid(prism(ngon(0.34, 8, Math.PI / 8), 2.18, 0.03), GUNMETAL, { at: [0, 0.72, 2.02], rot: ACROSS });

  for (const s of [-1, 1]) {
    const cx = s * 0.78;
    const cz = 2.08;
    // Ribbed skeletal radiator cage bars framing each exposed vertical plasma coil.
    for (let r = 0; r < 5; r++) {
      cage.solid(prism(ngon(0.36, 6, Math.PI / 6), 0.075, 0.016), r % 2 === 0 ? BRASS : STEEL, {
        at: [cx, 0.92 + r * 0.28, cz],
        rot: FLAT,
      });
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      cage.cyl(0.035, 0.035, 1.44, 6, IRON, { at: [cx + Math.cos(a) * 0.33, 1.48, cz + Math.sin(a) * 0.33] });
    }
    // Lower plasma surge exhaust nozzle under each reactor coil.
    cage.cyl(0.24, 0.34, 0.44, 12, OBSIDIAN, { at: [cx, 0.42, cz + 0.08], rot: [0.22, 0, s * -0.1] });
  }
  group.add(materials.group(cage));

  // Dynamic glowing exposed plasma reactor coils (shift from warm amber-red to blazing crimson on Redline Surge!).
  const coilGeo = new THREE.CylinderGeometry(0.21, 0.21, 1.38, 12);
  const coilMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(AMBER).multiplyScalar(3.2),
    toneMapped: false,
  });
  const baseCoilColor = new THREE.Color('#ff6a24');
  const redlineCoilColor = new THREE.Color(CRIMSON_OUTER);
  const coilColorScratch = new THREE.Color();

  const coils: THREE.Mesh[] = [];
  const plumes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const mesh = new THREE.Mesh(coilGeo, coilMat);
    mesh.position.set(s * 0.78, 1.48, 2.08);
    group.add(mesh);
    coils.push(mesh);

    const plume = makePlume(0.32, 2.2, CRIMSON_OUTER, CRIMSON_INNER, 4.4, 5.4);
    plume.position.set(s * 0.78, 0.22, 2.14);
    plume.rotation.set(0.22, 0, s * -0.1);
    group.add(plume);
    plumes.push(plume);
  }

  // Articulated flared radiator vent wings flanking the reactor cage.
  const wings: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 1.18, 1.56, 1.98);

    const wb = frameBuilder(palette);
    for (let i = 0; i < 3; i++) {
      const y = -0.44 + i * 0.42;
      const pts: [number, number][] = s > 0
        ? [[0, -0.1], [0.88, 0.06], [0.96, 0.22], [0, 0.14]]
        : [[0, -0.1], [-0.88, 0.06], [-0.96, 0.22], [0, 0.14]];
      wb.solid(prism(pts, 0.42, 0.025), i === 1 ? PLATE : OBSIDIAN, { at: [0, y, 0], rot: [0.24, 0, s * -0.16] });
      wb.glow(new THREE.BoxGeometry(0.62, 0.04, 0.05), RED, 4.4, { at: [s * 0.44, y + 0.02, 0.22], rot: [0, 0, s * -0.12] });
    }
    pivot.add(materials.group(wb));
    group.add(pivot);
    wings.push(pivot);
  }

  let clock = 0;
  let redlineBlend = 0;

  return {
    group,
    pose(dt, jets, flying, hovering, jetMode, _stride, inside, extra): void {
      const h = Math.max(0, dt);
      clock += h;
      const redline = clamp(extra?.redline ?? 0, 0, 1);
      redlineBlend += (redline - redlineBlend) * (1 - Math.exp(-8 * h));

      const pulse = 0.88 + Math.sin(clock * (10 + redlineBlend * 22)) * (0.12 + redlineBlend * 0.14);
      coilColorScratch.copy(baseCoilColor).lerp(redlineCoilColor, redlineBlend);
      coilMat.color.copy(coilColorScratch).multiplyScalar((3.0 + redlineBlend * 3.2) * pulse);

      const scalePulse = 1 + redlineBlend * 0.12 * Math.sin(clock * 24);
      for (let i = 0; i < coils.length; i++) {
        coils[i]!.scale.set(scalePulse, 1, scalePulse);
        coils[i]!.visible = !inside;
      }

      const ventOpen = redlineBlend * 0.62 + (jets || flying ? 0.26 : 0);
      for (let i = 0; i < wings.length; i++) {
        const s = i === 0 ? -1 : 1;
        wings[i]!.rotation.y = s * (0.24 + ventOpen);
        wings[i]!.rotation.z = s * (-0.12 - redlineBlend * 0.24);
        wings[i]!.visible = !inside;
      }

      const burn = (jets || flying || hovering || jetMode || redlineBlend > 0.15) && !inside;
      for (let i = 0; i < plumes.length; i++) {
        const p = plumes[i]!;
        p.visible = burn;
        if (burn) {
          const flick = 0.88 + Math.sin(clock * 52 + i * 2.0) * 0.16;
          p.scale.set(0.95 + redlineBlend * 0.25, (0.75 + redlineBlend * 0.85 + (jets || flying ? 0.35 : 0)) * flick, 0.95 + redlineBlend * 0.25);
        }
      }
    },
  };
}

/**
 * Assault-Ram Drive (`assault`):
 * Massive twin over-the-shoulder armoured ram-jet turbine pods + central dorsal afterburner pike with flared
 * intake cowls and huge blazing exhaust plumes when `extra?.charging` or `jetMode` is active!
 */
function buildAssaultVisual(materials: ModelMaterials, palette?: FramePalette): EngineVisual {
  const group = new THREE.Group();
  group.name = 'engine.assault';

  // Central dorsal afterburner pike & heavy twin-boom mounting spine.
  const spine = frameBuilder(palette);
  spine.solid(prism([
    [-1.12, 1.02], [0.56, 1.02], [0.84, 1.66], [0.48, 2.38], [-0.94, 2.34], [-1.34, 1.66],
  ], 1.42, 0.06), OBSIDIAN, { at: [0, 0, 1.62], rot: ACROSS });
  // Dorsal armoured pike crest jutting aft along +Z.
  spine.solid(prism([
    [-1.68, 1.72], [0.42, 1.88], [0.24, 2.52], [-1.42, 2.26],
  ], 0.56, 0.04), PLATE, { at: [0, 0, 1.78], rot: ACROSS });
  spine.cyl(0.28, 0.36, 0.72, 12, IRON, { at: [0, 1.46, 2.74], rot: ALONG_Z });
  spine.glow(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 12), AMBER, 4.8, { at: [0, 1.46, 3.06], rot: ALONG_Z });
  // Cross-axle boom bar for the massive over-the-shoulder turbine pods.
  spine.cyl(0.26, 0.26, 2.78, 12, STEEL, { at: [0, 2.24, 1.54], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    spine.cyl(0.32, 0.32, 0.16, 12, BRASS, { at: [s * 1.02, 2.24, 1.54], rot: [0, 0, Math.PI / 2] });
  }
  group.add(materials.group(spine));

  const outerCol = palette?.thruster ?? '#ff6e20';
  const innerCol = palette?.thrusterCore ?? '#fff2c4';

  const pikePlume = makePlume(0.34, 3.0, outerCol, innerCol, 4.4, 5.4);
  pikePlume.position.set(0, 1.46, 3.12);
  pikePlume.rotation.set(-Math.PI / 2, 0, 0);
  group.add(pikePlume);

  // Twin massive over-the-shoulder armoured ram-jet turbine pods with flared intake cowls.
  const pods: THREE.Group[] = [];
  const podPlumes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pod = new THREE.Group();
    pod.position.set(s * 1.56, 2.26, 1.54);

    const pb = frameBuilder(palette);
    // Main heavy armoured ram-jet nacelle body running along Z (`-1.45` forward intake -> `+1.48` aft exhaust).
    pb.solid(prism([
      [-1.38, -0.44], [1.34, -0.38], [1.54, 0.08], [1.24, 0.54], [-1.18, 0.58], [-1.52, 0.14],
    ], 0.92, 0.055), OBSIDIAN, { rot: ACROSS });
    pb.solid(prism([
      [-1.12, 0.34], [1.14, 0.36], [0.96, 0.68], [-0.94, 0.68],
    ], 0.74, 0.04), PLATE, { rot: ACROSS });

    // Flared forward bevelled intake cowl + dark compressor throat + steel intake splitter lip.
    pb.solid(prism(ngon(0.54, 8, Math.PI / 8), 0.36, 0.035), PLATE, { at: [0, 0.08, -1.48] });
    pb.solid(prism(ngon(0.42, 8, Math.PI / 8), 0.26, 0.02), DARK, { at: [0, 0.08, -1.62] });
    pb.cyl(0.16, 0.1, 0.34, 10, STEEL, { at: [0, 0.08, -1.56], rot: ALONG_Z });

    // Heavy rear vectoring afterburner exhaust nozzle + crimson/amber stripe accents.
    pb.solid(prism(ngon(0.46, 8, Math.PI / 8), 0.52, 0.03), GUNMETAL, { at: [0, 0.04, 1.56] });
    pb.solid(prism(ngon(0.4, 8, Math.PI / 8), 0.24, 0.02), STEEL, { at: [0, 0.04, 1.88] });
    pb.glow(new THREE.CylinderGeometry(0.3, 0.34, 0.08, 12), RED, 4.8, { at: [0, 0.04, 1.84], rot: ALONG_Z });
    pb.glow(new THREE.BoxGeometry(0.06, 0.06, 1.92), AMBER, 4.0, { at: [s * 0.48, 0.22, 0.04] });

    pod.add(materials.group(pb));

    const plume = makePlume(0.42, 3.6, outerCol, innerCol, 4.4, 5.6);
    plume.position.set(0, 0.04, 1.98);
    plume.rotation.set(-Math.PI / 2, 0, 0);
    pod.add(plume);

    group.add(pod);
    pods.push(pod);
    podPlumes.push(plume);
  }

  let clock = 0;
  let ramBlend = 0;

  return {
    group,
    pose(dt, jets, flying, hovering, jetMode, _stride, inside, extra): void {
      const h = Math.max(0, dt);
      clock += h;

      const assaultActive = extra?.charging === true || jetMode;
      ramBlend += ((assaultActive ? 1 : 0) - ramBlend) * (1 - Math.exp(-9 * h));

      const burn = (assaultActive || jets || flying || hovering) && !inside;
      for (let i = 0; i < pods.length; i++) {
        const s = i === 0 ? -1 : 1;
        // Rest: pods tilted gently upward; Assault Boost: swing wide & lock dead-level forward for ramming!
        pods[i]!.rotation.set(
          lerp(0.28, -0.02, ramBlend),
          s * lerp(-0.16, 0.04, ramBlend),
          s * lerp(-0.14, -0.04, ramBlend),
        );
        pods[i]!.position.x = s * lerp(1.56, 1.84, ramBlend);

        const plume = podPlumes[i]!;
        plume.visible = burn;
        if (burn) {
          const flick = 0.9 + Math.sin(clock * 62 + i * 2.1) * 0.16;
          const length = (assaultActive ? 1.55 : 0.72) * flick;
          const width = assaultActive ? 1.18 : 0.78;
          plume.scale.set(width, length, width);
        }
      }

      pikePlume.visible = burn;
      if (burn) {
        const flick = 0.88 + Math.cos(clock * 56) * 0.16;
        pikePlume.scale.set(assaultActive ? 1.15 : 0.75, (assaultActive ? 1.45 : 0.65) * flick, assaultActive ? 1.15 : 0.75);
      }
    },
  };
}

export function buildEngineV2Visual(drive: DriveKind, materials: ModelMaterials, palette?: FramePalette): EngineVisual | null {
  switch (drive) {
    case 'blink': return buildBlinkVisual(materials, palette);
    case 'redline': return buildRedlineVisual(materials, palette);
    case 'assault': return buildAssaultVisual(materials, palette);
    default: return null;
  }
}
