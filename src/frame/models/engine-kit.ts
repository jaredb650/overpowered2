/**
 * Procedural animated 3D engine visuals mounted to the Distraint Frame's exterior `hull` (`cockpit.ts`).
 * Every drive except standard `'jets'` (which returns `null` so the default Frame stays unchanged) builds distinct
 * Bureau-metal bevelled `prism()` hardware with zero per-frame allocations in `pose(...)`.
 */
import * as THREE from 'three';
import { clamp, lerp, TAU } from '../../core/math';
import { ModelBuilder, type ModelMaterials } from '../../progression/modelkit';
import type { DriveKind } from '../loadout';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, FLAT, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL,
  ngon, prism, type EngineVisual,
} from './shared';

/** Helper: creates a pair of nested translucent HDR exhaust cones pointing along `-Y` from the local origin. */
function makePlume(
  outerRadius: number,
  outerLen: number,
  outerColor: string,
  innerColor: string,
  outerBoost = 3.6,
  innerBoost = 4.6,
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

  const innerGeo = new THREE.ConeGeometry(outerRadius * 0.52, outerLen * 0.68, 8, 1, true);
  innerGeo.translate(0, -outerLen * 0.34, 0);
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
 * Jump-Jet Engine (`flight`):
 * Twin canted vectoring jet thruster pods on the back shoulders with gimballed OBSIDIAN/STEEL nozzles
 * and flaring AMBER plasma flame cones.
 */
function buildFlightVisual(materials: ModelMaterials): EngineVisual {
  const group = new THREE.Group();
  group.name = 'engine.flight';

  // Central dorsal fuel manifold & vectoring yoke spanning the upper back.
  const base = new ModelBuilder();
  base.solid(prism([[-0.5, -0.22], [0.46, -0.22], [0.56, 0.24], [0.22, 0.44], [-0.42, 0.44], [-0.58, 0.14]], 1.95, 0.05), GUNMETAL, { at: [0, 1.92, 1.56], rot: ACROSS });
  base.solid(prism([[-0.38, 0.28], [0.36, 0.28], [0.26, 0.5], [-0.28, 0.5]], 1.5, 0.035), PLATE, { at: [0, 1.92, 1.52], rot: ACROSS });
  base.cyl(0.22, 0.22, 2.55, 12, IRON, { at: [0, 1.98, 1.48], rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) {
    base.cyl(0.25, 0.25, 0.14, 12, BRASS, { at: [s * 0.98, 1.98, 1.48], rot: [0, 0, Math.PI / 2] });
    // Canted shoulder thruster nacelle housing.
    base.solid(prism([
      [-0.64, -0.28], [0.48, -0.24], [0.72, 0.08], [0.58, 0.44], [-0.36, 0.5], [-0.72, 0.18],
    ], 0.68, 0.055), OBSIDIAN, { at: [s * 1.56, 1.98, 1.46], rot: [0.16, s * -0.18, s * -0.24] });
    base.solid(prism([
      [-0.48, 0.24], [0.44, 0.24], [0.56, 0.46], [-0.36, 0.54],
    ], 0.54, 0.035), PLATE, { at: [s * 1.58, 2.04, 1.44], rot: [0.16, s * -0.18, s * -0.24] });
    // Forward intake scoop on each thruster pod.
    base.solid(prism(ngon(0.24, 6, Math.PI / 6), 0.22, 0.025), DARK, { at: [s * 1.54, 2.1, 0.96], rot: [0.16, s * -0.18, 0] });
    base.glow(new THREE.BoxGeometry(0.05, 0.05, 0.62), AMBER, 3.8, { at: [s * 1.9, 2.02, 1.44], rot: [0.16, s * -0.18, s * -0.24] });
  }
  base.glow(new THREE.BoxGeometry(1.16, 0.04, 0.04), AMBER, 3.6, { at: [0, 2.28, 1.98] });
  group.add(materials.group(base));

  const gimbals: THREE.Group[] = [];
  const plumes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const gimbal = new THREE.Group();
    gimbal.position.set(s * 1.64, 1.58, 1.72);
    gimbal.rotation.set(0.32, 0, s * -0.22);

    const nb = new ModelBuilder();
    nb.solid(prism(ngon(0.32, 8, Math.PI / 8), 0.26, 0.03), STEEL, { at: [0, 0.04, 0], rot: FLAT });
    nb.cyl(0.26, 0.36, 0.52, 12, OBSIDIAN, { at: [0, -0.26, 0] });
    nb.cyl(0.31, 0.35, 0.09, 12, STEEL, { at: [0, -0.5, 0] });
    nb.glow(new THREE.CylinderGeometry(0.19, 0.24, 0.06, 10), AMBER, 4.8, { at: [0, -0.44, 0] });
    gimbal.add(materials.group(nb));

    const plume = makePlume(0.34, 2.1, AMBER, '#fff0b8', 3.8, 5.0);
    plume.position.set(0, -0.52, 0);
    gimbal.add(plume);

    group.add(gimbal);
    gimbals.push(gimbal);
    plumes.push(plume);
  }

  let clock = 0;
  let gimbalBlend = 0;

  return {
    group,
    pose(dt, jets, flying, _hovering, _jetMode, _stride, inside) {
      clock += Math.max(0, dt);
      const active = jets || flying;
      gimbalBlend += ((active ? 1 : 0) - gimbalBlend) * (1 - Math.exp(-10 * Math.max(0, dt)));
      for (let i = 0; i < gimbals.length; i++) {
        const s = i === 0 ? -1 : 1;
        gimbals[i]!.rotation.set(lerp(0.58, 0.14, gimbalBlend), 0, s * lerp(-0.24, -0.16, gimbalBlend));
        const plume = plumes[i]!;
        plume.visible = active && !inside;
        if (plume.visible) {
          const flick = 0.88 + Math.sin(clock * 48 + i * 2.3) * 0.18 + Math.cos(clock * 29 + i) * 0.1;
          plume.scale.set(0.95 + flick * 0.1, (flying ? 1.25 : 0.95) * flick, 0.95 + flick * 0.1);
        }
      }
    },
  };
}

/**
 * Rotor Engine (`hover`):
 * Dorsal turbine mast + coaxial 4-blade heavy gunship rotor head spinning smoothly.
 * Hidden when `inside` is true so blades never obscure interior cockpit sightlines.
 */
function buildHoverVisual(materials: ModelMaterials): EngineVisual {
  const group = new THREE.Group();
  group.name = 'engine.hover';

  // Dorsal twin-turbine housing & armored mast pylon (positioned aft at z = 1.25 to clear dorsal shoulder mounts).
  const housing = new ModelBuilder();
  housing.solid(prism([[-0.74, 0], [0.68, 0], [0.82, 0.42], [0.48, 0.82], [-0.52, 0.82], [-0.82, 0.36]], 1.48, 0.055), GUNMETAL, { at: [0, 2.08, 1.32], rot: ACROSS });
  housing.solid(prism([[-0.44, 0.68], [0.42, 0.68], [0.28, 1.06], [-0.34, 1.06]], 0.96, 0.04), PLATE, { at: [0, 2.08, 1.28], rot: ACROSS });
  for (const s of [-1, 1]) {
    // Twin side turboshaft nacelles + angled exhaust ducts.
    housing.cyl(0.24, 0.28, 1.28, 12, OBSIDIAN, { at: [s * 0.72, 2.46, 1.34], rot: ALONG_Z });
    housing.cyl(0.22, 0.25, 0.16, 12, STEEL, { at: [s * 0.72, 2.46, 0.68], rot: ALONG_Z });
    housing.cyl(0.18, 0.22, 0.36, 10, IRON, { at: [s * 0.88, 2.42, 1.98], rot: [Math.PI / 2, 0, s * -0.45] });
    housing.glow(new THREE.BoxGeometry(0.04, 0.04, 0.72), AMBER, 3.2, { at: [s * 0.94, 2.52, 1.3] });
  }
  // Vertical rotor mast column + swashplate rings.
  housing.cyl(0.19, 0.26, 1.05, 12, STEEL, { at: [0, 3.22, 1.25] });
  housing.solid(prism(ngon(0.36, 8, Math.PI / 8), 0.14, 0.025), BRASS, { at: [0, 3.04, 1.25], rot: FLAT });
  housing.solid(prism(ngon(0.3, 8, Math.PI / 8), 0.12, 0.02), OBSIDIAN, { at: [0, 3.54, 1.25], rot: FLAT });
  group.add(materials.group(housing));

  // Coaxial 4-blade heavy gunship rotor head (two counter-rotating 4-blade tiers).
  const makeHub = (bladeLen: number, hubRadius: number, y: number): THREE.Group => {
    const hub = new THREE.Group();
    hub.position.set(0, y, 1.25);
    const b = new ModelBuilder();
    b.solid(prism(ngon(hubRadius, 8, Math.PI / 8), 0.22, 0.03), OBSIDIAN, { rot: FLAT });
    b.cyl(hubRadius * 0.55, hubRadius * 0.72, 0.14, 10, STEEL, { at: [0, 0.14, 0] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Blade root pitch cuff.
      b.cyl(0.08, 0.09, 0.36, 8, BRASS, { at: [ca * (hubRadius + 0.14), 0, -sa * (hubRadius + 0.14)], rot: [0, a, Math.PI / 2] });
      // Tapered bevelled airfoil blade extruded flat.
      const r0 = hubRadius + 0.22;
      const r1 = r0 + bladeLen;
      b.solid(
        prism([[r0, -0.11], [r1, -0.07], [r1 + 0.12, 0.01], [r1, 0.09], [r0, 0.12]], 0.055, 0.014),
        OBSIDIAN,
        { rot: [Math.PI / 2 + 0.12, 0, -a] },
      );
      b.solid(
        prism([[r0 + 0.1, 0.03], [r1 - 0.12, 0.02], [r1 - 0.12, 0.09], [r0 + 0.1, 0.11]], 0.06, 0.01),
        PLATE,
        { rot: [Math.PI / 2 + 0.12, 0, -a] },
      );
      b.glow(
        new THREE.BoxGeometry(0.28, 0.04, 0.12),
        AMBER,
        3.4,
        { at: [ca * (r1 - 0.16), 0.01, -sa * (r1 - 0.16)], rot: [0, a, 0] },
      );
    }
    hub.add(materials.group(b));
    return hub;
  };

  const rotorHead = new THREE.Group();
  const lowerHub = makeHub(3.15, 0.36, 3.38);
  const upperHub = makeHub(2.75, 0.3, 3.74);
  upperHub.rotation.y = Math.PI / 4;
  rotorHead.add(lowerHub, upperHub);
  group.add(rotorHead);

  let spinRate = 4.2;

  return {
    group,
    pose(dt, jets, flying, hovering, _jetMode, _stride, inside) {
      const h = Math.max(0, dt);
      const targetSpin = hovering || jets || flying ? 26 : 4.2;
      spinRate += (targetSpin - spinRate) * (1 - Math.exp(-5 * h));
      lowerHub.rotation.y = (lowerHub.rotation.y + spinRate * h) % TAU;
      upperHub.rotation.y = (upperHub.rotation.y - spinRate * 1.06 * h) % TAU;
      rotorHead.visible = !inside;
      group.visible = !inside;
    },
  };
}

/**
 * Afterburner (`afterburner`):
 * Twin swept variable-geometry fighter wings + twin heavy vectoring afterburner cans with AMBER/RED exhaust plumes.
 * Wings sweep backward dynamically in `jetMode` and fold compactly when walking.
 */
function buildAfterburnerVisual(materials: ModelMaterials): EngineVisual {
  const group = new THREE.Group();
  group.name = 'engine.afterburner';

  // Central variable-geometry wingbox + twin heavy rear vectoring afterburner cans.
  const core = new ModelBuilder();
  core.solid(prism([
    [-0.95, 1.38], [0.62, 1.42], [0.88, 1.88], [0.56, 2.34], [-0.74, 2.32], [-1.06, 1.82],
  ], 1.72, 0.06), OBSIDIAN, { at: [0, 0, 1.44], rot: ACROSS });
  core.solid(prism([[-0.76, 2.12], [0.54, 2.14], [0.36, 2.48], [-0.58, 2.46]], 1.24, 0.04), PLATE, { at: [0, 0, 1.44], rot: ACROSS });
  for (const s of [-1, 1]) {
    // Wing pivot knuckle drum.
    core.cyl(0.28, 0.28, 0.42, 12, STEEL, { at: [s * 1.08, 1.86, 1.26], rot: [0, 0, Math.PI / 2] });
    core.cyl(0.32, 0.32, 0.12, 12, BRASS, { at: [s * 0.94, 1.86, 1.26], rot: [0, 0, Math.PI / 2] });
    // Heavy rearward afterburner turbine housing + segmented vectoring nozzle petals.
    core.solid(prism(ngon(0.42, 8, Math.PI / 8), 0.95, 0.04), GUNMETAL, { at: [s * 0.86, 1.18, 1.98] });
    core.solid(prism(ngon(0.38, 8, Math.PI / 8), 0.34, 0.03), OBSIDIAN, { at: [s * 0.86, 1.18, 2.52] });
    core.solid(prism(ngon(0.34, 8, Math.PI / 8), 0.16, 0.02), STEEL, { at: [s * 0.86, 1.18, 2.74] });
    core.glow(new THREE.CylinderGeometry(0.26, 0.28, 0.08, 12), RED, 4.6, { at: [s * 0.86, 1.18, 2.66], rot: ALONG_Z });
  }
  group.add(materials.group(core));

  // Variable-geometry fighter wings (pivot at shoulder-back knuckles).
  const wings: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 1.16, 1.88, 1.26);

    const wb = new ModelBuilder();
    // Main swept delta airfoil slab (in local X outward along `s`, Z aft).
    const pts: [number, number][] = s > 0
      ? [[0, -0.58], [0.5, -0.52], [3.05, 0.72], [3.12, 1.14], [1.65, 1.18], [0, 0.68]]
      : [[0, -0.58], [-0.5, -0.52], [-3.05, 0.72], [-3.12, 1.14], [-1.65, 1.18], [0, 0.68]];
    wb.solid(prism(pts, 0.14, 0.025), OBSIDIAN, { rot: [Math.PI / 2, 0, 0] });

    // Layered upper wing strake fairing.
    const strake: [number, number][] = s > 0
      ? [[0.15, -0.44], [2.45, 0.56], [2.35, 0.88], [0.15, 0.42]]
      : [[-0.15, -0.44], [-2.45, 0.56], [-2.35, 0.88], [-0.15, 0.42]];
    wb.solid(prism(strake, 0.09, 0.02), PLATE, { at: [0, 0.08, 0], rot: [Math.PI / 2, 0, 0] });

    // Wingtip vertical stabilizer fin & crimson Bureau trim stripe.
    wb.solid(prism([[-0.42, 0], [0.36, 0], [0.18, 0.64], [-0.28, 0.52]], 0.08, 0.015), GUNMETAL, { at: [s * 2.98, 0.24, 0.92], rot: ACROSS });
    wb.glow(new THREE.BoxGeometry(2.1, 0.035, 0.045), RED, 4.0, { at: [s * 1.48, 0.11, 0.14], rot: [0, s * -0.42, 0] });
    wb.glow(new THREE.BoxGeometry(0.08, 0.06, 0.12), AMBER, 4.2, { at: [s * 3.06, 0.08, 0.92] });

    pivot.add(materials.group(wb));
    group.add(pivot);
    wings.push(pivot);
  }

  // Twin rear afterburner exhaust plumes oriented along `+Z` (local `-Y` rotated +90° around X).
  const plumes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const plume = makePlume(0.36, 2.8, RED, AMBER, 4.2, 5.2);
    plume.position.set(s * 0.86, 1.18, 2.8);
    plume.rotation.set(-Math.PI / 2, 0, 0);
    group.add(plume);
    plumes.push(plume);
  }

  let clock = 0;
  let deploy = 0;

  return {
    group,
    pose(dt, jets, flying, _hovering, jetMode, _stride, inside) {
      const h = Math.max(0, dt);
      clock += h;
      const target = jetMode ? 1 : 0;
      deploy += (target - deploy) * (1 - Math.exp(-7 * h));

      for (let i = 0; i < wings.length; i++) {
        const s = i === 0 ? -1 : 1;
        // Walking (deploy=0): folded compactly upward & swept behind back. Jet mode (deploy=1): wide swept fighter delta!
        wings[i]!.rotation.set(
          lerp(0.24, 0.04, deploy),
          s * lerp(0.68, 0.34, deploy),
          s * lerp(1.08, -0.06, deploy),
        );
      }

      const burn = jetMode || jets || flying;
      for (let i = 0; i < plumes.length; i++) {
        const plume = plumes[i]!;
        plume.visible = burn && !inside;
        if (plume.visible) {
          const pulse = 0.9 + Math.sin(clock * 60 + i * 1.9) * 0.16;
          const lengthScale = jetMode ? 1.55 * pulse : 0.75 * pulse;
          const widthScale = jetMode ? 1.12 : 0.78;
          plume.scale.set(widthScale, lengthScale, widthScale);
        }
      }
    },
  };
}

/**
 * Overcharge Engine (`overcharge`):
 * Twin glowing high-voltage capacitor spines + flared heat-radiator louvers (OBSIDIAN/BRASS/RED glow bars).
 */
function buildOverchargeVisual(materials: ModelMaterials): EngineVisual {
  const group = new THREE.Group();
  group.name = 'engine.overcharge';

  const base = new ModelBuilder();
  // Central armored busbar manifold bridging the back torso.
  base.solid(prism([[-0.42, 0.6], [0.46, 0.6], [0.52, 2.08], [-0.36, 2.14]], 1.42, 0.05), OBSIDIAN, { at: [0, 0, 1.78], rot: ACROSS });
  base.cyl(0.14, 0.14, 1.92, 10, BRASS, { at: [0, 1.84, 1.92], rot: [0, 0, Math.PI / 2] });
  base.cyl(0.14, 0.14, 1.92, 10, BRASS, { at: [0, 0.96, 1.92], rot: [0, 0, Math.PI / 2] });

  for (const s of [-1, 1]) {
    // Twin vertical high-voltage capacitor spines rising above the back shoulders.
    base.solid(prism([
      [-0.24, 0.56], [0.28, 0.56], [0.34, 2.42], [0.16, 2.86], [-0.14, 2.86], [-0.3, 2.32],
    ], 0.44, 0.04), OBSIDIAN, { at: [s * 0.98, 0, 1.96], rot: ACROSS });
    // Ribbed BRASS induction coil rings along each spine.
    for (let k = 0; k < 5; k++) {
      base.solid(prism(ngon(0.28, 6, Math.PI / 6), 0.1, 0.02), BRASS, { at: [s * 0.98, 0.92 + k * 0.36, 1.98], rot: FLAT });
    }
    // Surge arrestor horn tips.
    base.cyl(0.06, 0.11, 0.48, 8, STEEL, { at: [s * 1.02, 2.98, 1.94], rot: [-0.22, 0, s * -0.14] });
    // Thin inset RED high-voltage capacitor glow bar along each spine.
    base.glow(new THREE.BoxGeometry(0.06, 1.78, 0.06), RED, 4.6, { at: [s * 0.98, 1.72, 2.28] });
    base.glow(new THREE.BoxGeometry(0.05, 1.56, 0.05), RED, 4.0, { at: [s * 1.21, 1.66, 2.02] });
  }
  group.add(materials.group(base));

  // Articulated flared heat-radiator louver banks on each side of the back torso.
  const louvers: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const bank = new THREE.Group();
    bank.position.set(s * 1.24, 1.48, 1.88);
    const lb = new ModelBuilder();
    for (let i = 0; i < 4; i++) {
      const y = -0.52 + i * 0.34;
      const pts: [number, number][] = s > 0
        ? [[0, -0.08], [0.68, -0.04], [0.76, 0.06], [0, 0.1]]
        : [[0, -0.08], [-0.68, -0.04], [-0.76, 0.06], [0, 0.1]];
      lb.solid(prism(pts, 0.48, 0.02), i % 2 === 0 ? OBSIDIAN : PLATE, { at: [0, y, 0], rot: [0.32, 0, s * -0.18] });
      lb.glow(new THREE.BoxGeometry(0.46, 0.03, 0.04), RED, 4.2, { at: [s * 0.34, y - 0.04, 0.22], rot: [0, 0, s * -0.18] });
    }
    lb.cyl(0.07, 0.07, 1.28, 8, BRASS, { at: [s * 0.12, 0, 0.1] });
    bank.add(materials.group(lb));
    group.add(bank);
    louvers.push(bank);
  }

  let clock = 0;
  let flare = 0;

  return {
    group,
    pose(dt, jets, flying, _hovering, _jetMode, stride, inside) {
      const h = Math.max(0, dt);
      clock += h;
      const target = jets || flying ? 1 : 0;
      flare += (target - flare) * (1 - Math.exp(-8 * h));
      const pulse = Math.sin(clock * 6 + stride * 2) * 0.04;
      for (let i = 0; i < louvers.length; i++) {
        const s = i === 0 ? -1 : 1;
        louvers[i]!.rotation.y = s * (0.28 + flare * 0.38 + pulse);
        louvers[i]!.visible = !inside;
      }
    },
  };
}

/**
 * Long-Haul Engine (`diesel`):
 * Industrial twin vertical exhaust stacks with heat cages + heavy armoured diesel drum pack (GUNMETAL/PLATE/BRASS).
 */
function buildDieselVisual(materials: ModelMaterials): EngineVisual {
  const group = new THREE.Group();
  group.name = 'engine.diesel';

  const pack = new ModelBuilder();
  // Heavy armoured lower diesel engine block & structural cradle frame.
  pack.solid(prism([[-0.66, 0.42], [0.44, 0.42], [0.56, 1.72], [-0.46, 1.82], [-0.74, 1.38]], 2.18, 0.06), GUNMETAL, { at: [0, 0, 1.98], rot: ACROSS });
  pack.solid(prism([[-0.52, 0.34], [0.28, 0.34], [0.28, 0.64], [-0.58, 0.64]], 2.34, 0.04), OBSIDIAN, { at: [0, 0, 2.08], rot: ACROSS });

  // Twin heavy horizontal armoured diesel fuel drums strapped to the back.
  for (const dy of [0.84, 1.54]) {
    pack.solid(prism(ngon(0.36, 10, Math.PI / 10), 1.96, 0.04), PLATE, { at: [0, dy, 2.36], rot: ACROSS });
    for (const sx of [-0.66, 0, 0.66]) {
      pack.solid(prism(ngon(0.39, 10, Math.PI / 10), 0.14, 0.025), GUNMETAL, { at: [sx, dy, 2.36], rot: ACROSS });
    }
    // Brass end filler caps & pressure manifold line.
    for (const s of [-1, 1]) {
      pack.cyl(0.14, 0.14, 0.12, 10, BRASS, { at: [s * 1.02, dy, 2.36], rot: [0, 0, Math.PI / 2] });
    }
  }
  pack.cyl(0.065, 0.065, 0.78, 8, BRASS, { at: [-0.36, 1.18, 2.74] });
  pack.cyl(0.065, 0.065, 0.78, 8, BRASS, { at: [0.36, 1.18, 2.74] });
  pack.glow(new THREE.BoxGeometry(0.42, 0.045, 0.04), AMBER, 3.2, { at: [0, 1.18, 2.76] });

  // Twin industrial vertical exhaust stacks with ribbed BRASS/PLATE heat cages.
  for (const s of [-1, 1]) {
    const sx = s * 1.18;
    const sz = 2.16;
    // Elbow feed from engine pack into vertical stack base.
    pack.cyl(0.18, 0.2, 0.42, 10, IRON, { at: [s * 1.02, 1.24, sz], rot: [0, 0, Math.PI / 2] });
    // Main heavy vertical stack pipe.
    pack.cyl(0.15, 0.17, 2.12, 12, IRON, { at: [sx, 2.28, sz] });
    pack.cyl(0.17, 0.17, 0.14, 12, STEEL, { at: [sx, 3.3, sz] });
    // Heat cage: 4 standoff rings + 4 vertical guard rails around the hot mid-section.
    for (let r = 0; r < 4; r++) {
      pack.solid(prism(ngon(0.24, 8, Math.PI / 8), 0.06, 0.015), r % 2 === 0 ? BRASS : PLATE, { at: [sx, 1.62 + r * 0.42, sz], rot: FLAT });
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      pack.cyl(0.026, 0.026, 1.42, 6, PLATE, { at: [sx + Math.cos(a) * 0.23, 2.25, sz + Math.sin(a) * 0.23] });
    }
  }
  const packGroup = materials.group(pack);
  group.add(packGroup);

  // Articulated hinged exhaust rain-flapper caps on top of each stack.
  const flappers: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(s * 1.18, 3.38, 2.02);
    const fb = new ModelBuilder();
    fb.solid(prism(ngon(0.19, 8, Math.PI / 8), 0.05, 0.01), STEEL, { at: [0, 0.02, 0.14], rot: FLAT });
    fb.cyl(0.03, 0.03, 0.16, 6, BRASS, { at: [0, 0.01, 0], rot: [0, 0, Math.PI / 2] });
    hinge.add(materials.group(fb));
    group.add(hinge);
    flappers.push(hinge);
  }

  let clock = 0;

  return {
    group,
    pose(dt, jets, flying, _hovering, _jetMode, stride, inside) {
      clock += Math.max(0, dt);
      const load = jets || flying ? 1 : 0;
      const chug = Math.abs(Math.sin(clock * 14 + stride * Math.PI));
      const openAngle = clamp(0.18 + load * 0.72 + chug * 0.24, 0.12, 1.1);
      for (let i = 0; i < flappers.length; i++) {
        flappers[i]!.rotation.x = -openAngle * (i === 0 ? 1 : 0.94);
        flappers[i]!.visible = !inside;
      }
      packGroup.position.y = Math.sin(clock * 28) * (0.006 + load * 0.008);
    },
  };
}

/** Builds the animated exterior engine visual for `drive`, or `null` for standard `'jets'`. */
export function buildEngineVisual(drive: DriveKind, materials: ModelMaterials): EngineVisual | null {
  switch (drive) {
    case 'jets': return null;
    case 'flight': return buildFlightVisual(materials);
    case 'hover': return buildHoverVisual(materials);
    case 'afterburner': return buildAfterburnerVisual(materials);
    case 'overcharge': return buildOverchargeVisual(materials);
    case 'diesel': return buildDieselVisual(materials);
  }
}
