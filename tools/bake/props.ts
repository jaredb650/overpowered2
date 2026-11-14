/**
 * Baked props. Authored with the grip at the origin, barrel along +Z and up along +Y, so every weapon mounts
 * on a hand socket the same way. `muzzle` and `foregrip` sockets tell the runtime where the shot leaves and
 * where the off hand goes.
 */
import { archetypeById, unitRigFor, type ArchetypeDef } from '../../src/characters/archetypes';
import type { Socket } from '../../src/characters/format';
import { Model, type Mat } from './model';
import {
  blend, capsule, cone, cut, cyl, ellipsoid, fbm, frustum, hexBolt, rbox, rows, sphere, spline, torus, tube,
  type V3,
} from './sdf';
import { gunnerHelmet, riotHelmet, rocketeerHelmet, trooperHelmet } from './archetypes/soldiers';
import { B, Sk } from './parts/skeleton';
import { darkSteel, glass, glow, hazard, hexc, leather, paintedMetal, rubber, rust, steel } from './parts/materials';

export interface PropDef {
  build(m: Model): Record<string, Socket>;
  tris: number;
  voxelScale?: number;
  scale?: number;
  atlas?: number;
  accent?: readonly [number, number, number];
}

const sock = (pos: V3): Socket => ({ bone: 0, pos, rot: [0, 0, 0, 1] });
const gun = paintedMetal(0x181b20, 0.45, 1);
const gunLight = paintedMetal(0x2c3036, 0.5, 1);
const grip = leather(0x141414);

function vents(m: Model, z0: number, z1: number, y: number, x: number, n: number): void {
  const step = (z1 - z0) / n;
  m.cut(rows(rbox([0, y, z0], [x, 0.012, step * 0.26], 0.002), 2, step, n), { detail: true, mat: darkSteel });
}

function pistolGrip(m: Model, mat: Mat = grip): void {
  m.add(rbox([0, -0.02, -0.012], [0.017, 0.058, 0.024], 0.012), mat, 0);
  m.cut(rows(rbox([0, -0.06, 0.016], [0.02, 0.0018, 0.012], 0.001), 1, 0.012, 6), { detail: true });
}

const smg: PropDef = {
  tris: 2600,
  atlas: 512,
  build(m) {
    m.add(rbox([0, 0.052, 0.09], [0.024, 0.036, 0.16], 0.008), gun, 0);
    m.add(rbox([0, 0.09, 0.09], [0.012, 0.006, 0.13], 0.003), darkSteel, 0);
    m.cut(rows(rbox([0, 0.097, -0.03], [0.016, 0.0028, 0.0034], 0.001), 2, 0.012, 20), { detail: true });
    m.add(cyl([0, 0.056, 0.22], [0, 0.056, 0.4], 0.02, 0.003), gunLight, 0);
    vents(m, 0.25, 0.38, 0.056, 0.03, 8);
    m.add(cyl([0, 0.056, 0.39], [0, 0.056, 0.44], 0.013, 0.003), darkSteel, 0);
    pistolGrip(m);
    m.add(rbox([0, -0.06, 0.08], [0.015, 0.09, 0.024], 0.006), gunLight, 0);
    m.add(rbox([0, 0.006, 0.09], [0.012, 0.018, 0.04], 0.004), darkSteel, 0);
    m.add(rbox([0, 0.005, 0.25], [0.012, 0.012, 0.03], 0.005), gun, 0);
    m.add(cone([0, -0.005, 0.255], [0, -0.078, 0.265], 0.016, 0.013), grip, 0);
    m.add(tube(spline([[0.02, 0.06, -0.06], [0.02, 0.066, -0.16], [0.02, 0.05, -0.24]], 10), 0.0065), darkSteel, 0);
    m.add(tube(spline([[-0.02, 0.06, -0.06], [-0.02, 0.066, -0.16], [-0.02, 0.05, -0.24]], 10), 0.0065), darkSteel, 0);
    m.add(rbox([0, 0.04, -0.245], [0.026, 0.05, 0.012], 0.006), grip, 0);
    m.add(rbox([0, 0.104, 0.14], [0.013, 0.012, 0.03], 0.004), gunLight, 0);
    m.add(rbox([0.026, 0.05, 0.03], [0.002, 0.008, 0.05], 0.0015), glow([0.15, 0.85, 1], 1), 0, { detail: true });
    return { muzzle: sock([0, 0.056, 0.445]), foregrip: sock([0, -0.03, 0.258]) };
  },
};

const pistol: PropDef = {
  tris: 1400,
  atlas: 256,
  build(m) {
    m.add(rbox([0, 0.044, 0.07], [0.016, 0.02, 0.1], 0.005), gun, 0);
    m.cut(rows(rbox([0, 0.064, -0.02], [0.02, 0.008, 0.0016], 0.001), 2, 0.007, 6), { detail: true });
    m.add(rbox([0, 0.018, 0.07], [0.014, 0.011, 0.08], 0.004), darkSteel, 0);
    m.add(cyl([0, 0.046, 0.16], [0, 0.046, 0.18], 0.0095, 0.002), darkSteel, 0);
    pistolGrip(m);
    return { muzzle: sock([0, 0.046, 0.185]) };
  },
};

const shotgun: PropDef = {
  tris: 3000,
  atlas: 512,
  build(m) {
    const wood = leather(0x2a1f18);
    m.add(rbox([0, 0.058, 0.06], [0.026, 0.038, 0.12], 0.009), gun, 0);
    m.add(cyl([0, 0.076, 0.14], [0, 0.076, 0.62], 0.0185, 0.003), gunLight, 0);
    m.add(cyl([0, 0.036, 0.14], [0, 0.036, 0.56], 0.0165, 0.003), darkSteel, 0);
    m.add(cyl([0, 0.076, 0.6], [0, 0.076, 0.64], 0.024, 0.003), darkSteel, 0);
    m.add(rbox([0, 0.036, 0.31], [0.03, 0.03, 0.07], 0.012), wood, 0);
    m.cut(rows(rbox([0, 0.036, 0.25], [0.034, 0.034, 0.002], 0.001), 2, 0.012, 11), { detail: true });
    m.add(torus([0, 0.06, 0.54], [0, 0, 1], 0.03, 0.006), steel, 0);
    pistolGrip(m, wood);
    m.add(blend(0.02, rbox([0, 0.03, -0.11], [0.02, 0.03, 0.08], 0.01), rbox([0, 0.014, -0.23], [0.024, 0.056, 0.06], 0.02)), wood, 0);
    for (let i = 0; i < 5; i++) m.add(cyl([0.03, 0.03 + i * 0, -0.17 + i * 0.024], [0.04, 0.03, -0.17 + i * 0.024], 0.0096), hazard(0xb02010, 0xb02010), 0);
    return { muzzle: sock([0, 0.076, 0.645]), foregrip: sock([0, 0.005, 0.31]) };
  },
};

const minigun: PropDef = {
  tris: 5200,
  atlas: 512,
  build(m) {
    const red = glow(hexc(0xff2a1a), 1);
    m.add(rbox([0, 0.04, 0.02], [0.07, 0.076, 0.19], 0.02), gun, 0);
    m.add(cyl([0, 0.04, 0.2], [0, 0.04, 0.33], 0.082, 0.01), gunLight, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 0.046, y = 0.04 + Math.sin(a) * 0.046;
      m.add(cyl([x, y, 0.3], [x, y, 0.92], 0.0145, 0.002), darkSteel, 0);
      m.cut(cyl([x, y, 0.9], [x, y, 0.95], 0.008, 0.001), { mat: rubber });
    }
    for (const z of [0.56, 0.86]) m.add(cyl([0, 0.04, z], [0, 0.04, z + 0.03], 0.074, 0.006), gunLight, 0);
    m.add(cyl([0, 0.04, 0.33], [0, 0.04, 0.9], 0.018, 0.002), steel, 0);
    pistolGrip(m);
    m.add(tube(spline([[0, 0.11, -0.05], [0, 0.17, 0.05], [0, 0.17, 0.2], [0, 0.11, 0.3]], 12), 0.012), grip, 0);
    const drum = cyl([-0.14, 0.02, -0.06], [-0.14, 0.02, 0.14], 0.13, 0.012);
    m.add(drum, paintedMetal(0x3a1412, 0.5, 1), 0);
    m.add(rbox([-0.08, 0.02, 0.04], [0.03, 0.05, 0.08], 0.01), gun, 0);
    m.add(cyl([-0.14, 0.02, 0.14], [-0.14, 0.02, 0.155], 0.05), red, 0, { k: 0.002 });
    m.add(tube(spline([[-0.14, 0.15, 0.02], [-0.06, 0.18, 0.04], [0, 0.128, 0.14]], 18), 0.016, { ribs: 90, ribDepth: 0.004 }), steel, 0);
    return { muzzle: sock([0, 0.04, 0.93]), foregrip: sock([0, 0.17, 0.12]) };
  },
};

const launcher: PropDef = {
  tris: 3600,
  atlas: 512,
  build(m) {
    const tubeMat = paintedMetal(0x2e3d36, 0.55, 1);
    const teal = glow(hexc(0x10ffb0), 1);
    m.add(cut(cyl([0, 0.1, -0.5], [0, 0.1, 0.62], 0.072, 0.008), cyl([0, 0.1, 0.46], [0, 0.1, 0.7], 0.058, 0.002), 0.004), tubeMat, 0);
    m.add(frustum([0, 0.1, -0.52], [0, 0.1, -0.68], 0.066, 0.1, 0.006), darkSteel, 0);
    m.cut(frustum([0, 0.1, -0.56], [0, 0.1, -0.72], 0.05, 0.09, 0.004), { mat: rubber });
    m.add(cyl([0, 0.1, 0.56], [0, 0.1, 0.64], 0.082, 0.008), darkSteel, 0);
    m.add(cyl([0, 0.1, 0.1], [0, 0.1, 0.14], 0.082, 0.006), darkSteel, 0);
    m.add(cyl([0, 0.1, -0.3], [0, 0.1, -0.26], 0.082, 0.006), darkSteel, 0);
    pistolGrip(m);
    m.add(rbox([0, 0.03, 0.02], [0.02, 0.03, 0.06], 0.008), gun, 0);
    m.add(rbox([0, 0.006, 0.28], [0.014, 0.05, 0.02], 0.008), grip, 0);
    m.add(rbox([0.084, 0.13, 0.08], [0.014, 0.024, 0.06], 0.006), gun, 0);
    m.add(cyl([0.084, 0.13, 0.14], [0.084, 0.13, 0.145], 0.018), teal, 0);
    m.add(sphere([0, 0.1, 0.5], 0.05), hazard(0xd8d8d0, 0x10a070, 0.03), 0);
    return { muzzle: sock([0, 0.1, 0.65]), foregrip: sock([0, -0.02, 0.28]) };
  },
};

const sniperRifle: PropDef = {
  tris: 3400,
  atlas: 512,
  build(m) {
    const red = glow(hexc(0xff1060), 0.35);
    m.add(rbox([0, 0.06, 0.06], [0.021, 0.034, 0.17], 0.008), gun, 0);
    m.add(cyl([0, 0.066, 0.2], [0, 0.066, 1.02], 0.014, 0.002), darkSteel, 0);
    m.add(cyl([0, 0.066, 0.2], [0, 0.066, 0.62], 0.024, 0.004), gunLight, 0);
    vents(m, 0.24, 0.6, 0.066, 0.034, 16);
    m.add(cyl([0, 0.066, 0.98], [0, 0.066, 1.08], 0.024, 0.005), gun, 0);
    m.cut(rows(rbox([0, 0.066, 1.0], [0.03, 0.006, 0.006], 0.001), 2, 0.02, 4), { detail: true });
    pistolGrip(m);
    m.add(rbox([0, 0.0, 0.05], [0.012, 0.05, 0.02], 0.006), gunLight, 0);
    m.add(blend(0.02, rbox([0, 0.05, -0.16], [0.018, 0.03, 0.11], 0.012), rbox([0, 0.024, -0.3], [0.022, 0.066, 0.04], 0.016)), gun, 0);
    m.add(cyl([0, 0.14, -0.06], [0, 0.14, 0.26], 0.026, 0.004), darkSteel, 0);
    m.add(frustum([0, 0.14, 0.24], [0, 0.14, 0.32], 0.026, 0.038, 0.003), gun, 0);
    m.add(cyl([0, 0.14, 0.3], [0, 0.14, 0.325], 0.03, 0.002), red, 0);
    m.add(rbox([0, 0.104, 0.06], [0.012, 0.012, 0.03], 0.004), gun, 0);
    m.add(cone([0, 0.03, 0.6], [0.05, -0.16, 0.66], 0.008, 0.005), darkSteel, 0);
    m.add(cone([0, 0.03, 0.6], [-0.05, -0.16, 0.66], 0.008, 0.005), darkSteel, 0);
    return { muzzle: sock([0, 0.066, 1.085]), foregrip: sock([0, 0.03, 0.42]), laser: sock([0, 0.14, 0.33]) };
  },
};

const riotShield: PropDef = {
  tris: 2600,
  atlas: 512,
  build(m) {
    const blue = glow(hexc(0x2a6cff), 1);
    const face = paintedMetal(0x20262e, 0.5, 1);
    // Authored with the face toward +Z and the handle at the origin. About chin to shin on a soldier.
    const shell = cut(ellipsoid([0, 0.06, -0.26], [0.4, 0.74, 0.36]), ellipsoid([0, 0.06, -0.285], [0.4, 0.74, 0.36]));
    const trimmed = cut(cut(shell, rbox([0, 0.06, -0.55], [1, 1, 0.5], 0.002)), rbox([0, -0.68, 0.1], [0.6, 0.12, 0.6], 0.03));
    const clipped = cut(cut(trimmed, rbox([0.54, 0.06, 0], [0.24, 1, 0.6], 0.02)), rbox([-0.54, 0.06, 0], [0.24, 1, 0.6], 0.02));
    m.add(clipped, face, 0);
    m.add(rbox([0, 0.34, 0.08], [0.13, 0.04, 0.03], 0.012), glass, 0);
    m.add(rbox([0, 0.34, 0.095], [0.14, 0.05, 0.02], 0.012), darkSteel, 0, { detail: true });
    for (const x of [-0.19, 0.19]) m.add(rbox([x, -0.02, 0.07], [0.0055, 0.34, 0.012], 0.004), blue, 0);
    for (let i = 0; i < 4; i++) m.add(rbox([0, -0.34 + i * 0.13, 0.085], [0.12, 0.01, 0.01], 0.005), darkSteel, 0, { detail: true });
    m.add(rbox([0, 0, -0.02], [0.016, 0.1, 0.012], 0.006), grip, 0);
    m.add(rbox([0, 0.09, 0.02], [0.03, 0.012, 0.03], 0.006), gun, 0);
    m.add(rbox([0, -0.09, 0.02], [0.03, 0.012, 0.03], 0.006), gun, 0);
    return {};
  },
};

const blade: PropDef = {
  tris: 1400,
  atlas: 256,
  build(m) {
    const violet = glow(hexc(0xa040ff), 1);
    const edge: Mat = {
      albedo: [0.72, 0.74, 0.8], rough: 0.2, metal: 1, detail: 2, wear: 0,
      paint: (x, y, z, o) => {
        const n = fbm(x * 90, y * 90, z * 12, 3);
        o.rough += n * 0.1;
      },
    };
    pistolGrip(m, leather(0x18121c));
    m.add(rbox([0, 0.044, 0.012], [0.045, 0.012, 0.02], 0.006), darkSteel, 0);
    const b = blend(0.002, rbox([0, 0.34, 0.012], [0.0075, 0.3, 0.036], 0.002), cone([0, 0.6, 0.016], [0, 0.86, 0.055], 0.016, 0.002));
    m.add(cut(b, rbox([0, 0.36, 0.066], [0.02, 0.31, 0.016], 0.002), 0.002), edge, 0);
    m.add(rbox([0, 0.34, 0.002], [0.0086, 0.26, 0.0036], 0.001), violet, 0);
    return { tip: sock([0, 0.86, 0.055]) };
  },
};

const flamer: PropDef = {
  tris: 3000,
  atlas: 512,
  build(m) {
    const fire = glow(hexc(0xff8a20), 1);
    const brass: Mat = { albedo: [0.55, 0.38, 0.18], rough: 0.4, metal: 1, detail: 2, wear: 0.5 };
    m.add(cyl([0, 0.06, -0.14], [0, 0.06, 0.22], 0.034, 0.006), gun, 0);
    m.add(frustum([0, 0.06, 0.22], [0, 0.06, 0.5], 0.03, 0.018, 0.002), steel, 0);
    m.add(frustum([0, 0.06, 0.5], [0, 0.06, 0.62], 0.024, 0.042, 0.003), darkSteel, 0);
    m.cut(frustum([0, 0.06, 0.56], [0, 0.06, 0.66], 0.014, 0.034, 0.002), { mat: rubber });
    for (let i = 0; i < 6; i++) m.add(torus([0, 0.06, 0.26 + i * 0.04], [0, 0, 1], 0.03 - i * 0.002, 0.0032), brass, 0);
    m.add(cyl([0, 0.024, 0.6], [0, 0.024, 0.64], 0.007), fire, 0);
    pistolGrip(m);
    m.add(rbox([0, -0.024, 0.28], [0.014, 0.05, 0.02], 0.008), grip, 0);
    m.add(cyl([0.04, 0.1, 0.0], [0.04, 0.1, 0.18], 0.028, 0.006), hazard(0xc04810, 0x181818, 0.04), 0);
    m.add(tube(spline([[0, 0.02, -0.14], [0, -0.06, -0.24], [0.02, -0.18, -0.26]], 14), 0.012, { ribs: 120, ribDepth: 0.002 }), rubber, 0);
    return { muzzle: sock([0, 0.06, 0.64]), foregrip: sock([0, -0.05, 0.28]), pilot: sock([0, 0.024, 0.645]) };
  },
};

const wardenStaff: PropDef = {
  tris: 3000,
  atlas: 512,
  build(m) {
    const gold = glow(hexc(0xffe9a0), 1);
    const iron = paintedMetal(0x2a2622, 0.5, 1);
    // Staff runs along +Y through the fist. Socket handling rotates it to stand upright.
    m.add(cyl([0, -1.05, 0], [0, 0.95, 0], 0.016, 0.003), iron, 0);
    for (const y of [-0.3, 0.12, 0.5]) m.add(cyl([0, y, 0], [0, y + 0.05, 0], 0.024, 0.004), darkSteel, 0);
    m.add(cone([0, -1.05, 0], [0, -1.18, 0], 0.016, 0.003), steel, 0);
    m.add(torus([0, 1.08, 0], [0, 0, 1], 0.16, 0.014), iron, 0);
    m.add(sphere([0, 1.08, 0], 0.06), gold, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      m.add(cone([Math.cos(a) * 0.17, 1.08 + Math.sin(a) * 0.17, 0], [Math.cos(a) * 0.25, 1.08 + Math.sin(a) * 0.25, 0], 0.014, 0.002), iron, 0);
    }
    m.add(capsule([0, 0.95, 0], [0, 1.0, 0], 0.03), darkSteel, 0);
    return { emitter: sock([0, 1.08, 0]) };
  },
};

/** Backpack fuel tank for the bomber. Shootable, so it is a separate model that can vanish on detonation. */
const fuelTank: PropDef = {
  tris: 2600,
  atlas: 512,
  voxelScale: 1,
  build(m) {
    const yellow = hazard(0xe0b800, 0x141414, 0.11);
    m.add(capsule([0, -0.2, 0], [0, 0.32, 0], 0.17), yellow, 0);
    for (const y of [-0.16, 0.06, 0.28]) m.add(cyl([0, y, 0], [0, y + 0.03, 0], 0.178, 0.004), darkSteel, 0);
    m.add(cyl([0, 0.46, 0], [0, 0.54, 0], 0.05), steel, 0);
    m.add(hexBolt([0, 0.56, 0], [0, 1, 0], 0.036, 0.012), rust, 0);
    m.add(sphere([0.12, 0.18, 0.12], 0.02), glow(hexc(0xffd800), 1), 0);
    m.add(tube(spline([[0, 0.54, 0], [0.1, 0.6, 0.02], [0.2, 0.42, 0.06]], 12), 0.012, { ribs: 100, ribDepth: 0.002 }), rubber, 0);
    m.paint(rbox([0, 0.1, 0.17], [0.09, 0.05, 0.03], 0.002), { albedo: [0.05, 0.05, 0.05], rough: 0.5, detail: 2 });
    return {};
  },
};

/** Twin pressure bottles for the burner. */
const twinTanks: PropDef = {
  tris: 2800,
  atlas: 512,
  voxelScale: 1,
  build(m) {
    const paint = paintedMetal(0x8c2a10, 0.45, 1);
    for (const s of [1, -1]) {
      m.add(capsule([s * 0.1, -0.16, 0], [s * 0.1, 0.22, 0], 0.095), paint, 0);
      m.add(cyl([s * 0.1, 0.32, 0], [s * 0.1, 0.38, 0], 0.03), steel, 0);
      for (const y of [-0.1, 0.1]) m.add(cyl([s * 0.1, y, 0], [s * 0.1, y + 0.022, 0], 0.1, 0.003), darkSteel, 0);
    }
    m.add(rbox([0, 0.02, -0.02], [0.05, 0.24, 0.05], 0.012), darkSteel, 0);
    m.add(tube(spline([[-0.1, 0.38, 0], [0, 0.44, 0], [0.1, 0.38, 0]], 12), 0.012), steel, 0);
    m.add(cyl([0, 0.42, -0.02], [0, 0.42, 0.05], 0.024), glass, 0);
    return {};
  },
};

/** Rack of rockets for the rocketeer's back. Noses rise over the shoulders. */
const rocketPack: PropDef = {
  tris: 3200,
  atlas: 512,
  voxelScale: 1,
  build(m) {
    const frame = paintedMetal(0x2e3d36, 0.55, 1);
    const teal = glow(hexc(0x10ffb0), 1);
    m.add(rbox([0, -0.08, -0.03], [0.21, 0.2, 0.065], 0.016), frame, 0);
    for (let i = 0; i < 4; i++) {
      const x = -0.165 + i * 0.11;
      m.add(cyl([x, -0.26, 0.0], [x, 0.3, 0.0], 0.052, 0.006), frame, 0);
      m.add(cone([x, 0.3, 0], [x, 0.46, 0], 0.044, 0.008), hazard(0xd8d8d0, 0x10a070, 0.04), 0);
      m.add(cyl([x, 0.25, 0], [x, 0.27, 0], 0.056, 0.002), darkSteel, 0);
    }
    m.add(rbox([0, 0.05, -0.1], [0.12, 0.05, 0.018], 0.006), darkSteel, 0);
    m.add(rbox([0, 0.05, -0.12], [0.08, 0.012, 0.004], 0.002), teal, 0);
    return {};
  },
};

/**
 * A soldier's helmet as its own model, so the helmet you see is the plate that gets shot off. Built where it sits on that
 * archetype's head, then moved so the head bone is the origin: it mounts on the `head` socket, which is that origin.
 */
function wornOnHead(archetype: string, build: (m: Model, sk: Sk, def: ArchetypeDef) => void): PropDef {
  return {
    tris: 2400,
    atlas: 512,
    // The body's own voxel, so the shell comes out exactly as it was when it was baked into him.
    voxelScale: 1,
    build(m) {
      const def = archetypeById(archetype);
      const sk = new Sk(unitRigFor(def));
      const on = new Model();
      build(on, sk, def);
      const [hx, hy, hz] = sk.pos[B.head]!;
      const back = (v: V3): V3 => [v[0] - hx, v[1] - hy, v[2] - hz];
      for (const e of on.edits) {
        const { f, lo, hi } = e.shape;
        const paint = e.mat?.paint;
        m.edits.push({
          ...e,
          shape: { f: (x, y, z) => f(x + hx, y + hy, z + hz), lo: back(lo), hi: back(hi) },
          // Paint is placed in world space: sample it where the helmet was, so the wear and chips land where they did.
          mat: e.mat && paint ? { ...e.mat, paint: (x, y, z, o) => paint(x + hx, y + hy, z + hz, o) } : e.mat,
          lo: back(e.lo),
          hi: back(e.hi),
        });
      }
      return {};
    },
  };
}

export const PROPS: Record<string, PropDef> = {
  smg, pistol, shotgun, minigun, launcher, sniperRifle, riotShield, blade, flamer, wardenStaff, fuelTank, twinTanks, rocketPack,
  trooperHelmet: wornOnHead('trooper', trooperHelmet),
  gunnerHelmet: wornOnHead('gunner', gunnerHelmet),
  rocketeerHelmet: wornOnHead('rocketeer', rocketeerHelmet),
  riotHelmet: wornOnHead('riot', riotHelmet),
};

