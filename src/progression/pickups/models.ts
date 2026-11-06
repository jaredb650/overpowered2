/**
 * Pickup and capsule models. Every kind has its own silhouette, because in a fight the shape is what gets read
 * first. All of them are built around the origin, roughly a metre tall, so one hover height fits all.
 */
import * as THREE from 'three';
import type { PickupKind, PowerupId } from '../../core/gameplay';
import { PICKUP_LOOK } from '../data';
import { ModelBuilder } from '../modelkit';

const STEEL = '#59636e';
const DARK = '#2b3138';
const LIGHT = '#8b96a2';

function health(): ModelBuilder {
  const c = PICKUP_LOOK.health.color;
  const b = new ModelBuilder();
  b.box(0.72, 0.5, 0.26, '#d8dee5');
  b.box(0.76, 0.1, 0.3, DARK, { at: [0, 0.24, 0] });
  b.box(0.2, 0.06, 0.12, DARK, { at: [0, 0.3, 0] });
  for (const s of [1, -1]) {
    b.glow(new THREE.BoxGeometry(0.34, 0.1, 0.02), c, 3, { at: [0, 0, s * 0.14] });
    b.glow(new THREE.BoxGeometry(0.1, 0.34, 0.02), c, 3, { at: [0, 0, s * 0.14] });
    b.box(0.06, 0.1, 0.03, STEEL, { at: [s * 0.26, 0.17, 0.14] });
  }
  return b;
}

function ammo(): ModelBuilder {
  const c = PICKUP_LOOK.ammo.color;
  const b = new ModelBuilder();
  b.box(0.62, 0.42, 0.36, '#3d4a35');
  b.box(0.66, 0.06, 0.4, DARK, { at: [0, 0.2, 0] });
  b.box(0.3, 0.05, 0.08, LIGHT, { at: [0, 0.26, 0] });
  b.glow(new THREE.BoxGeometry(0.64, 0.05, 0.38), c, 2.6, { at: [0, -0.06, 0] });
  // Belt of rounds fed out of the lid: the only pickup with a bright top edge.
  for (let i = 0; i < 6; i++) {
    b.cyl(0.03, 0.03, 0.2, 6, '#caa24a', { at: [-0.22 + i * 0.09, 0.36, 0], rot: [0, 0, 0.12] });
    b.solid(new THREE.ConeGeometry(0.03, 0.07, 6), '#d9b87a', { at: [-0.21 + i * 0.09, 0.49, 0], rot: [0, 0, 0.12] });
  }
  return b;
}

function armor(): ModelBuilder {
  const c = PICKUP_LOOK.armor.color;
  const b = new ModelBuilder();
  const shield = new THREE.Shape();
  shield.moveTo(-0.34, 0.34);
  shield.lineTo(0.34, 0.34);
  shield.lineTo(0.34, -0.05);
  shield.lineTo(0, -0.42);
  shield.lineTo(-0.34, -0.05);
  shield.closePath();
  const plate = new THREE.ExtrudeGeometry(shield, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
  b.solid(plate, STEEL, { at: [0, 0, -0.05] });
  for (const s of [1, -1]) {
    b.glow(new THREE.BoxGeometry(0.42, 0.05, 0.02), c, 3, { at: [0, 0.14, s * 0.09] });
    b.glow(new THREE.BoxGeometry(0.28, 0.05, 0.02), c, 3, { at: [0, 0.0, s * 0.09] });
  }
  return b;
}

function megaHealth(): ModelBuilder {
  const c = PICKUP_LOOK.megaHealth.color;
  const b = new ModelBuilder();
  b.glow(new THREE.IcosahedronGeometry(0.34, 1), c, 3.4);
  for (let i = 0; i < 3; i++) {
    b.solid(new THREE.TorusGeometry(0.5, 0.03, 5, 20), STEEL, { rot: [(i * Math.PI) / 3, i * 1.1, 0] });
  }
  b.cyl(0.14, 0.2, 0.14, 8, DARK, { at: [0, -0.52, 0] });
  b.cyl(0.2, 0.14, 0.14, 8, DARK, { at: [0, 0.52, 0] });
  return b;
}

function heavyArmor(): ModelBuilder {
  const c = PICKUP_LOOK.heavyArmor.color;
  const b = new ModelBuilder();
  // Chest rig: breastplate, pauldrons, collar.
  b.box(0.62, 0.72, 0.2, STEEL);
  b.box(0.42, 0.34, 0.26, LIGHT, { at: [0, 0.12, 0] });
  b.box(0.46, 0.12, 0.24, DARK, { at: [0, -0.28, 0] });
  for (const s of [1, -1]) {
    b.solid(new THREE.SphereGeometry(0.2, 6, 4), STEEL, { at: [s * 0.42, 0.28, 0], scale: [1, 0.72, 1.1] });
    b.box(0.14, 0.34, 0.2, DARK, { at: [s * 0.36, -0.08, 0] });
    b.glow(new THREE.BoxGeometry(0.12, 0.04, 0.02), c, 3, { at: [s * 0.14, 0.2, 0.14] });
    b.glow(new THREE.BoxGeometry(0.2, 0.04, 0.02), c, 3, { at: [s * 0.14, 0.08, 0.14] });
  }
  b.glow(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 8), c, 5, { at: [0, -0.04, 0.14], rot: [Math.PI / 2, 0, 0] });
  return b;
}

/** Shared capsule frame: two machined end caps and four rails. The glass is the halo around it. */
function capsule(id: PowerupId, core: (b: ModelBuilder, c: string) => void): ModelBuilder {
  const c = PICKUP_LOOK[id].color;
  const b = new ModelBuilder();
  for (const s of [1, -1]) {
    b.cyl(0.26, 0.32, 0.14, 8, STEEL, { at: [0, s * 0.56, 0], rot: s > 0 ? [0, 0, 0] : [Math.PI, 0, 0] });
    b.cyl(0.18, 0.26, 0.08, 8, DARK, { at: [0, s * 0.67, 0], rot: s > 0 ? [0, 0, 0] : [Math.PI, 0, 0] });
    b.glow(new THREE.TorusGeometry(0.27, 0.014, 4, 18), c, 4, { at: [0, s * 0.47, 0], rot: [Math.PI / 2, 0, 0] });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    b.box(0.03, 1, 0.03, LIGHT, { at: [Math.cos(a) * 0.29, 0, Math.sin(a) * 0.29] });
  }
  core(b, c);
  return b;
}

const CORES: Readonly<Record<PowerupId, (b: ModelBuilder, c: string) => void>> = {
  quad: (b, c) => {
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      b.glow(new THREE.OctahedronGeometry(0.12, 0), c, 3.8, { at: [Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0] });
    }
  },
  haste: (b, c) => {
    for (let i = 0; i < 3; i++) {
      for (const s of [1, -1]) {
        b.glow(new THREE.BoxGeometry(0.2, 0.05, 0.05), c, 3.6, { at: [s * 0.08, -0.16 + i * 0.16, 0], rot: [0, 0, s * -0.65] });
      }
    }
  },
  vampire: (b, c) => {
    for (const s of [1, -1]) b.glow(new THREE.ConeGeometry(0.075, 0.34, 5), c, 3.8, { at: [s * 0.1, -0.02, 0], rot: [Math.PI, 0, 0] });
    b.glow(new THREE.BoxGeometry(0.36, 0.06, 0.08), c, 3.8, { at: [0, 0.17, 0] });
  },
  ricochet: (b, c) => {
    const pts: [number, number][] = [[-0.16, 0.24], [0.12, 0.1], [-0.12, -0.06], [0.16, -0.24]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      b.glow(new THREE.BoxGeometry(len, 0.05, 0.05), c, 3.8, { at: [(x0 + x1) / 2, (y0 + y1) / 2, 0], rot: [0, 0, Math.atan2(y1 - y0, x1 - x0)] });
    }
  },
  shock: (b, c) => {
    const bolt = new THREE.Shape();
    bolt.moveTo(0.06, 0.3);
    bolt.lineTo(-0.14, -0.02);
    bolt.lineTo(-0.02, -0.02);
    bolt.lineTo(-0.08, -0.3);
    bolt.lineTo(0.14, 0.06);
    bolt.lineTo(0.02, 0.06);
    bolt.closePath();
    b.glow(new THREE.ExtrudeGeometry(bolt, { depth: 0.05, bevelEnabled: false }), c, 3.8, { at: [0, 0, -0.025] });
  },
  ghost: (b, c) => {
    b.glow(new THREE.SphereGeometry(0.15, 8, 6), c, 2.4, { at: [0, 0.1, 0] });
    b.glow(new THREE.CylinderGeometry(0.15, 0.2, 0.22, 8, 1, true), c, 1.8, { at: [0, -0.1, 0] });
    for (const s of [1, -1]) b.solid(new THREE.SphereGeometry(0.035, 6, 4), '#0a0d10', { at: [s * 0.06, 0.13, 0.13] });
  },
  magnet: (b, c) => {
    b.solid(new THREE.TorusGeometry(0.15, 0.055, 6, 14, Math.PI), '#b0243a', { at: [0, 0.04, 0] });
    for (const s of [1, -1]) {
      b.box(0.11, 0.2, 0.11, '#b0243a', { at: [s * 0.15, -0.06, 0] });
      b.glow(new THREE.BoxGeometry(0.115, 0.07, 0.115), c, 4, { at: [s * 0.15, -0.19, 0] });
    }
  },
  regen: (b, c) => {
    b.glow(new THREE.BoxGeometry(0.4, 0.12, 0.08), c, 3.6);
    b.glow(new THREE.BoxGeometry(0.12, 0.4, 0.08), c, 3.6);
  },
  frostNova: (b, c) => {
    for (let i = 0; i < 3; i++) {
      b.glow(new THREE.BoxGeometry(0.5, 0.035, 0.035), c, 3.6, { rot: [0, 0, (i * Math.PI) / 3] });
    }
    b.glow(new THREE.OctahedronGeometry(0.075, 0), '#ffffff', 3.2);
  },
  timeWarp: (b, c) => {
    b.glow(new THREE.ConeGeometry(0.17, 0.24, 8), c, 3.4, { at: [0, -0.13, 0] });
    b.glow(new THREE.ConeGeometry(0.17, 0.24, 8), c, 3.4, { at: [0, 0.13, 0], rot: [Math.PI, 0, 0] });
    b.solid(new THREE.TorusGeometry(0.19, 0.02, 4, 14), LIGHT, { at: [0, 0.25, 0], rot: [Math.PI / 2, 0, 0] });
    b.solid(new THREE.TorusGeometry(0.19, 0.02, 4, 14), LIGHT, { at: [0, -0.25, 0], rot: [Math.PI / 2, 0, 0] });
  },
};

export function pickupModel(kind: Exclude<PickupKind, 'weaponCache'>): ModelBuilder {
  switch (kind) {
    case 'health': return health();
    case 'ammo': return ammo();
    case 'armor': return armor();
    case 'megaHealth': return megaHealth();
    case 'heavyArmor': return heavyArmor();
    default: return capsule(kind, CORES[kind]);
  }
}
