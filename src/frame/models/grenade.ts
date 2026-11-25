/**
 * 60 mm Dual-Mode Grenade Launcher arm model (`src/frame/models/grenade.ts`).
 *
 * Native side: right (`-X` inboard toward cockpit, `+X` outboard, `-Z` forward along bore, `+Z` rear elbow).
 * Sculpted Bureau-metal heavy rotary launcher:
 *   - Fixed (`build`): heavy boxy bevelled receiver (`prism`), top carrying rail & armored sight bridge,
 *     underslung hydraulic recoil brace, thick stubby 60 mm rifled barrel with perforated thermal shroud and
 *     wide blast-cup muzzle brake, plus inboard mode telemetry strip.
 *   - Moving (`moving`): exposed 6-chamber fluted revolving cylinder drum with 6 chamber tubes, brass central
 *     ratchet axle, and 6 visible brass 60 mm shell rims — indexes cleanly by `Math.PI / 3` (60°) per shot.
 *   - Extra (`extra`): concentric drum mode-indicator ring that shifts between amber (`HE`, mode 0) and
 *     fiery crimson-orange (`NAPALM`, mode 1).
 */
import * as THREE from 'three';
import type { GunExtra, GunSpec } from '../../vehicles/guns';
import type { ModelMaterials } from '../../progression/modelkit';
import type { FramePalette } from './palette';
import {
  ACROSS, ALONG_Z, AMBER, BRASS, DARK, GUNMETAL, IRON, OBSIDIAN, PLATE, RED, STEEL, ngon, prism,
} from './shared';

const CHAMBERS = 6;
const DRUM_Z = -0.78;
const DRUM_Y = 0.02;
const CHAMBER_RING_R = 0.245;

export const GRENADE_ARM: GunSpec = {
  name: 'frame-grenade',

  build: b => {
    // Heavy boxy sculpted rear receiver & drum cradle yoke (+u forward along -Z).
    b.solid(
      prism(
        [[-1.16, -0.38], [-0.12, -0.38], [0.18, -0.44], [1.46, -0.42], [1.56, -0.22], [1.34, -0.18], [-0.14, -0.2], [-0.24, 0.36], [1.46, 0.36], [1.56, 0.48], [1.26, 0.56], [-0.94, 0.56], [-1.24, 0.28]],
        0.74,
        0.045,
      ),
      OBSIDIAN,
      { rot: ACROSS },
    );

    // Rear breech reinforcement block behind the revolving drum.
    b.solid(
      prism([[-1.04, -0.32], [-0.26, -0.32], [-0.22, 0.44], [-0.92, 0.48], [-1.12, 0.2]], 0.88, 0.04),
      GUNMETAL,
      { rot: ACROSS },
    );

    // Sculpted upper carrying rail & elevated sighting bridge spanning over the open drum bay.
    b.solid(
      prism([[-0.72, 0.52], [1.62, 0.52], [1.82, 0.42], [1.68, 0.68], [-0.56, 0.72], [-0.82, 0.62]], 0.34, 0.025),
      PLATE,
      { rot: ACROSS },
    );
    // Rail stanchions & grenade ladder sight leaf.
    for (const z of [-0.18, -1.42]) {
      b.solid(prism([[-0.08, 0], [0.1, 0], [0.08, 0.22], [-0.08, 0.22]], 0.28, 0.015), STEEL, { at: [0, 0.42, z], rot: ACROSS });
    }
    b.solid(prism([[-0.06, 0], [0.06, 0], [0.05, 0.28], [-0.05, 0.28]], 0.22, 0.012), IRON, { at: [0, 0.68, -1.52], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.14, 0.024, 0.024), AMBER, 4.2, { at: [0, 0.86, -1.52] });

    // Thick stubby 60 mm rifled barrel extending ahead of the drum yoke.
    b.cyl(0.185, 0.205, 1.05, 14, STEEL, { at: [0, DRUM_Y, -1.78], rot: ALONG_Z });
    // Deep recessed dark 60 mm bore cavity at the muzzle.
    b.cyl(0.125, 0.125, 0.24, 14, DARK, { at: [0, DRUM_Y, -2.32], rot: ALONG_Z });

    // Perforated octagonal barrel heat shroud & forward clamp rings.
    b.solid(prism(ngon(0.285, 8, Math.PI / 8), 0.74, 0.028), GUNMETAL, { at: [0, DRUM_Y, -1.72] });
    for (const s of [-1, 1]) {
      // Dark heat-vent perforation slots along both flanks of the shroud.
      for (let i = 0; i < 4; i++) {
        b.box(0.05, 0.075, 0.11, DARK, { at: [s * 0.265, DRUM_Y + 0.06, -1.46 - i * 0.16] });
        b.box(0.05, 0.075, 0.11, DARK, { at: [s * 0.265, DRUM_Y - 0.08, -1.46 - i * 0.16] });
      }
    }
    // Wide flared conical blast-cup muzzle brake with brass locking collar.
    b.cyl(0.245, 0.245, 0.08, 12, BRASS, { at: [0, DRUM_Y, -2.14], rot: ALONG_Z });
    b.cyl(0.275, 0.21, 0.24, 14, OBSIDIAN, { at: [0, DRUM_Y, -2.3], rot: ALONG_Z });
    b.solid(prism(ngon(0.29, 8, Math.PI / 8), 0.08, 0.015), PLATE, { at: [0, DRUM_Y, -2.38] });

    // Underbarrel heavy recoil brace & twin hydraulic buffer rods.
    b.solid(
      prism([[0.18, -0.44], [2.05, -0.38], [2.2, -0.24], [0.24, -0.24]], 0.42, 0.03),
      PLATE,
      { rot: ACROSS },
    );
    for (const s of [-1, 1]) {
      b.cyl(0.072, 0.072, 0.96, 10, IRON, { at: [s * 0.17, -0.34, -1.62], rot: ALONG_Z });
      b.cyl(0.082, 0.082, 0.06, 10, BRASS, { at: [s * 0.17, -0.34, -2.06], rot: ALONG_Z });
    }

    // Side drum latch lever & rear elbow gimbal.
    b.solid(prism([[-0.42, -0.14], [0.32, -0.1], [0.36, 0.08], [-0.36, 0.1]], 0.12, 0.02), STEEL, { at: [0.46, 0.14, 0.24], rot: ACROSS });
    b.cyl(0.31, 0.31, 0.58, 12, STEEL, { at: [0, 0.16, 0.98], rot: [0, 0, Math.PI / 2] });
    b.cyl(0.21, 0.21, 0.68, 10, IRON, { at: [0, 0.16, 0.98], rot: [0, 0, Math.PI / 2] });

    // Inboard cockpit telemetry glow strip & side mode indicator channel.
    b.solid(prism([[-0.48, 0.12], [0.24, 0.12], [0.24, 0.26], [-0.48, 0.26]], 0.06, 0.01), DARK, { at: [-0.46, 0, 0.1], rot: ACROSS });
    b.glow(new THREE.BoxGeometry(0.03, 0.04, 0.62), AMBER, 4.4, { at: [-0.475, 0.19, 0.22] });
    b.glow(new THREE.BoxGeometry(0.03, 0.035, 0.44), RED, 3.8, { at: [-0.475, 0.04, 0.22] });
  },

  moving: b => {
    // Central revolving ratchet drum axle (rotates cleanly around Z by Math.PI / 3 per shot).
    b.cyl(0.115, 0.115, 0.96, 12, BRASS, { at: [0, DRUM_Y, DRUM_Z], rot: ALONG_Z });
    b.cyl(0.17, 0.17, 0.82, 12, IRON, { at: [0, DRUM_Y, DRUM_Z], rot: ALONG_Z });

    // Front & rear hexagonal drum end-plates.
    b.solid(prism(ngon(0.365, 6, Math.PI / 6), 0.075, 0.018), PLATE, { at: [0, DRUM_Y, DRUM_Z - 0.38] });
    b.solid(prism(ngon(0.365, 6, Math.PI / 6), 0.075, 0.018), PLATE, { at: [0, DRUM_Y, DRUM_Z + 0.38] });

    // 6 fluted 60 mm chambers + exposed brass shell rims visible at the breech end.
    for (let i = 0; i < CHAMBERS; i++) {
      const a = (i / CHAMBERS) * Math.PI * 2;
      const cx = Math.cos(a) * CHAMBER_RING_R;
      const cy = DRUM_Y + Math.sin(a) * CHAMBER_RING_R;
      // Heavy fluted chamber cylinder.
      b.cyl(0.128, 0.128, 0.82, 10, i % 2 === 0 ? GUNMETAL : OBSIDIAN, { at: [cx, cy, DRUM_Z], rot: ALONG_Z });
      // Recessed dark muzzle mouth of each chamber.
      b.cyl(0.088, 0.088, 0.06, 10, DARK, { at: [cx, cy, DRUM_Z - 0.4], rot: ALONG_Z });
      // Brass 60 mm cartridge rim + primer cap seated at the rear of each chamber.
      b.cyl(0.105, 0.105, 0.07, 10, BRASS, { at: [cx, cy, DRUM_Z + 0.42], rot: ALONG_Z });
      b.cyl(0.036, 0.036, 0.08, 8, STEEL, { at: [cx, cy, DRUM_Z + 0.43], rot: ALONG_Z });
    }
  },

  extra: (_materials: ModelMaterials, palette: FramePalette): GunExtra => {
    const group = new THREE.Group();
    const heColor = new THREE.Color(palette.secondaryGlow || '#ffaa30');
    const napalmColor = new THREE.Color('#ff3410');

    const ringMat = new THREE.MeshBasicMaterial({
      color: heColor.clone().multiplyScalar(2.6),
      toneMapped: false,
      fog: false,
    });
    const ringGeo = new THREE.TorusGeometry(0.39, 0.022, 8, 24);
    const frontRing = new THREE.Mesh(ringGeo, ringMat);
    frontRing.position.set(0, DRUM_Y, DRUM_Z - 0.36);
    const rearRing = new THREE.Mesh(ringGeo, ringMat);
    rearRing.position.set(0, DRUM_Y, DRUM_Z + 0.36);
    group.add(frontRing, rearRing);

    return {
      group,
      setActive(amount: number, mode = 0): void {
        const base = mode === 1 ? napalmColor : heColor;
        const boost = 1.6 + Math.max(0, Math.min(1, amount)) * 2.4;
        ringMat.color.copy(base).multiplyScalar(boost);
      },
    };
  },

  muzzle: [0, DRUM_Y, -2.52],
  follow: 22,
  return: 14,
};
