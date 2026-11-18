/**
 * The Tachi: a long curved blade, because a weapon with no ammo has to earn its slot by looking dangerous. Shinogi
 * cross-section with crisp facets, a fuller, a temper line in the shader, ray-skin hilt under real diamond wrap.
 * The blade lies along -Z with the edge on -Y, and the origin is the middle of the hilt.
 *
 * Timings are the first game's (docs/original/04, section 8). The arcs are not: each move runs along the direction
 * melee/Melee.ts cuts in, so what the blade does, the crescent it draws and the plane it slices on all agree.
 *
 * The energy blade (weapons/mods.ts `swordEnergy`) is part `energy`, in place of the steel sword (`steel`): an emitter hilt on
 * the tsuka's line, so the hands hold it as they hold the katana, and a curved blade of light in part `beam`, a white core and
 * an added halo round it that flicker. It ignites out of the emitter on the draw, and leaves a trail of light on a swing.
 */
import * as THREE from 'three';
import { Kit } from '../kit/kit';
import { Model } from '../kit/model';
import { F } from '../kit/finishes';
import { Kind, type Finish, type Mesher } from '../kit/mesher';
import { circle, type V2 } from '../kit/shapes';
import { rivet } from '../kit/details';
import { clamp, damp, lerp } from '../../../core/math';
import { inCubic, inOut, outBack, outCubic, outQuad, seg } from '../curves';
import type { Anim, ViewDef } from '../def';
import { HANDS } from '../poses';

const GUARD_Z = -0.112;
const BLADE_LEN = 0.86;
const TIP_START = 0.8;
const POMMEL_Z = 0.158;
const BLADE: Finish = { color: 0xb0b4ba, rough: 0.2, metal: 1, wear: 1, heat: 1, kind: Kind.blade };

/** Curve of the blade: the back rises toward the tip, so the edge sits on the outside of the bow. */
const sori = (s: number) => 0.03 * s * s;
const halfHeight = (s: number) => lerp(0.0162, 0.0118, s / BLADE_LEN);
const thick = (s: number) => lerp(0.0042, 0.0024, s / BLADE_LEN);

function spineY(s: number): number {
  return sori(s) + halfHeight(s);
}

function edgeY(s: number): number {
  const base = sori(s) - halfHeight(s);
  if (s <= TIP_START) return base;
  // The point: the edge sweeps up to meet the back in one long arc.
  const t = (s - TIP_START) / (BLADE_LEN - TIP_START);
  return lerp(base, spineY(BLADE_LEN), 1 - Math.sqrt(1 - t * t));
}

function blade(m: Mesher): void {
  m.use(BLADE);
  const nv = 56;
  const at = (v: number) => {
    const t = v * v * 0.16 + v * 0.84;
    return t * BLADE_LEN;
  };
  const taper = (s: number) => (s < TIP_START ? 1 : 1 - ((s - TIP_START) / (BLADE_LEN - TIP_START)) ** 2 * 0.98);
  const ridge = (s: number) => lerp(spineY(s), edgeY(s), 0.32);
  for (const side of [-1, 1] as const) {
    // Ji: ridge line down to the edge. Flat, polished, where the temper line lives.
    m.surface(4, nv, (u, v, o) => {
      const s = at(v);
      o.set(side * thick(s) * taper(s) * (1 - u) ** 1.25, lerp(ridge(s), edgeY(s), u), GUARD_Z - 0.008 - s);
    }, { flip: side < 0, edge: u => 0.32 + 0.68 * u });
    // Shinogi-ji: ridge line up to the back, with a fuller run along most of it.
    m.surface(6, nv, (u, v, o) => {
      const s = at(v);
      const groove = s < TIP_START - 0.1 ? Math.sin(u * Math.PI) ** 2 * 0.52 * clamp(s / 0.03) : 0;
      o.set(side * thick(s) * taper(s) * lerp(1, 0.62, u) * (1 - groove), lerp(ridge(s), spineY(s) - halfHeight(s) * 0.16, u), GUARD_Z - 0.008 - s);
    }, { flip: side > 0, edge: u => 0.32 * (1 - u) });
    // Mune: the roof of the back.
    m.surface(1, nv, (u, v, o) => {
      const s = at(v);
      o.set(side * thick(s) * taper(s) * 0.62 * (1 - u), lerp(spineY(s) - halfHeight(s) * 0.16, spineY(s), u), GUARD_Z - 0.008 - s);
    }, { flip: side > 0, edge: () => 0 });
  }
}

function hilt(m: Mesher): void {
  const zs = GUARD_Z + 0.012;
  const ze = POMMEL_Z - 0.012;
  const a = 0.0142;
  const b = 0.0176;
  const ellipse = (k: number): V2[] => {
    const out: [number, number][] = [];
    for (let i = 0; i < 24; i++) out.push([Math.cos((i / 24) * Math.PI * 2) * a * k, Math.sin((i / 24) * Math.PI * 2) * b * k]);
    return out;
  };
  // Pale ray skin under the wrap, so the diamonds of the binding read.
  m.use({ color: 0xc8c2b0, rough: 0.6, metal: 0, wear: 0.1, kind: Kind.stipple });
  m.at([0, 0, (zs + ze) / 2], null, () => m.front(ellipse(0.97), ze - zs, { bevel: 0.0006, smooth: 50 }));
  // The binding: flat cord crossing from side to side, one over the other.
  m.use({ color: 0x1b1d22, rough: 0.72, metal: 0, wear: 0, kind: Kind.fabric });
  const pitch = 0.0272;
  const n = Math.floor((ze - zs) / pitch);
  const band = 0.0052;
  for (let i = 0; i < n; i++) {
    const z0 = zs + 0.004 + i * pitch;
    for (const dir of [-1, 1] as const) {
      for (const face of [0, Math.PI] as const) {
        m.surface(2, 10, (u, v, o) => {
          const ang = face + v * Math.PI;
          const lift = 0.0009 + 0.0009 * Math.sin(u * Math.PI);
          const rise = dir > 0 ? v : 1 - v;
          o.set(Math.cos(ang) * (a + lift), Math.sin(ang) * (b + lift), z0 + rise * pitch + (u - 0.5) * band * 2);
        }, { flip: true });
      }
    }
  }
  // Fuchi, kashira and the peg through the tang.
  m.use(F.blued);
  m.at([0, 0, zs - 0.006], null, () => m.front(ellipse(1.09), 0.016, { bevel: 0.0012, smooth: 50 }));
  m.at([0, 0, ze + 0.008], null, () => m.front(ellipse(1.1), 0.022, { bevel: 0.002, smooth: 50 }));
  m.use(F.brass);
  m.at([0, 0, POMMEL_Z + 0.0015], null, () => m.lathe([[0.008, 0.0015, 0], [0.008, -0.002], [0, -0.002, 0]].reverse() as never, 16));
  m.mirror(() => m.at([0.0165, 0, -0.03], [0, Math.PI / 2, 0], () => rivet(m, 0.0022, F.brass)));
  // Red cord through the pommel, for the sake of the silhouette.
  m.use({ color: 0x8a1712, rough: 0.7, metal: 0, wear: 0, kind: Kind.fabric });
  m.tube([[0.004, -0.012, POMMEL_Z + 0.002], [0.016, -0.03, POMMEL_Z + 0.022], [0.012, -0.06, POMMEL_Z + 0.026], [0.018, -0.082, POMMEL_Z + 0.014]], 0.0016, { seg: 6, samples: 18 });
}

function guard(m: Mesher): void {
  // Tsuba: a pierced steel disc. Thin spacers and a brass collar seat it on the blade.
  const out = curveDisc();
  const holes: V2[][] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    holes.push(circle(Math.cos(a) * 0.0285, Math.sin(a) * 0.0285, 0.0062, 12));
  }
  m.use(F.steelDark);
  m.at([0, 0, GUARD_Z], null, () => m.front(out, 0.0056, { bevel: 0.0012, holes, smooth: 40 }));
  m.use(F.brass);
  m.at([0, 0, GUARD_Z - 0.0035], null, () => m.front(ellipseRect(0.0048, 0.019), 0.0018, { bevel: 0.0004 }));
  m.at([0, 0, GUARD_Z + 0.0036], null, () => m.front(ellipseRect(0.0115, 0.0185), 0.0016, { bevel: 0.0004 }));
  m.at([0, sori(0.012), GUARD_Z - 0.019], null, () => m.front(ellipseRect(0.0056, 0.0185), 0.029, { bevel: 0.0007, smooth: 40 }));
}

function ellipseRect(a: number, b: number): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < 16; i++) out.push([Math.cos((i / 16) * Math.PI * 2) * a, Math.sin((i / 16) * Math.PI * 2) * b]);
  return out;
}

function curveDisc(): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 0.041 + 0.0014 * Math.cos(a * 4);
    out.push([Math.cos(a) * r * 0.94, Math.sin(a) * r]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The energy blade
// ---------------------------------------------------------------------------------------------

/** Where the light leaves the emitter, and how far it runs: to the steel blade's tip. */
const EMIT_Z = GUARD_Z - 0.034;
const BEAM_LEN = BLADE_LEN - 0.03;
/** The beam's curve, its core's half height and half thickness, and the halo's, by meters out of the emitter. */
const beamY = (s: number) => sori(s + 0.03);
const beamTaper = (s: number) => (s < BEAM_LEN * 0.88 ? 1 : Math.sqrt(Math.max(0, 1 - ((s - BEAM_LEN * 0.88) / (BEAM_LEN * 0.12)) ** 2)));
const CORE = { h: 0.0105, t: 0.0024 } as const;
const HALO = { h: 0.03, t: 0.025 } as const;
/** Linear colour of the halo, past 1 for the bloom, and of the core glow and the trim. */
const HALO_COLOR = [0.2, 0.95, 4.2] as const;
const GLOWS = { core: [0xc8f4ff, 6], trim: [0x4fd4ff, 3.5] } as const;
/** The hilt's gunmetal: a machined body that has not been dropped yet, so little chipped edge. */
const GUNMETAL: Finish = { color: 0x2c3036, rough: 0.38, metal: 0.7, wear: 0.12 };

/** An oval of half widths `a`, `b`. */
function oval(a: number, b: number, n = 24): V2[] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([Math.cos((i / n) * Math.PI * 2) * a, Math.sin((i / n) * Math.PI * 2) * b]);
  return out;
}

/** The emitter hilt: a ribbed grip on the tsuka's oval, a vented shroud where the tsuba was, a slot the light leaves by. */
function emitterHilt(m: Mesher): void {
  const zs = GUARD_Z + 0.012;
  const ze = POMMEL_Z - 0.012;
  const a = 0.0142;
  const b = 0.0176;
  // The body under the grip, gunmetal.
  m.use(GUNMETAL);
  m.at([0, 0, (zs + ze) / 2], null, () => m.front(oval(a * 0.93, b * 0.93), ze - zs, { bevel: 0.0005, smooth: 50 }));
  // Rubber rings: where the fingers go.
  m.use(F.rubber);
  const pitch = 0.031;
  const n = Math.floor((ze - zs - 0.02) / pitch);
  for (let i = 0; i < n; i++) m.at([0, 0, zs + 0.022 + i * pitch], null, () => m.front(oval(a, b), 0.022, { bevel: 0.0018, smooth: 50 }));
  // A collar each end, brushed, and the pommel cap.
  m.use(F.steel);
  m.at([0, 0, zs - 0.002], null, () => m.front(oval(a * 1.12, b * 1.1), 0.012, { bevel: 0.0014, smooth: 50 }));
  m.at([0, 0, ze + 0.004], null, () => m.front(oval(a * 1.1, b * 1.08), 0.014, { bevel: 0.0014, smooth: 50 }));
  m.use(F.blued);
  m.at([0, 0, ze + 0.018], null, () => m.front(oval(a * 1.02, b * 1.0), 0.016, { bevel: 0.003, smooth: 50 }));
  // The cell's charge, a thin line round the pommel.
  m.glow('trim', () => m.at([0, 0, ze + 0.0105], null, () => m.front(oval(a * 1.035, b * 1.025), 0.0014, { bevel: 0.0002, smooth: 50 })));
  // The switch on the spine, by the right thumb, and its light.
  m.use(F.steelDark);
  m.at([0, b * 0.93 + 0.0012, GUARD_Z + 0.042], null, () => m.box(0.0075, 0.004, 0.016, 0.0012));
  m.glow('trim', () => m.at([0, b * 0.93 + 0.0006, GUARD_Z + 0.056], null, () => m.box(0.0028, 0.0022, 0.0028, 0.0006)));

  // The shroud where the tsuba was: a heavy oval with vents through it and fins down each side.
  const vents: V2[][] = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + Math.PI / 6;
    vents.push(circle(Math.cos(t) * 0.0215, Math.sin(t) * 0.025, 0.0028, 10));
  }
  m.use(F.blued);
  m.at([0, 0, GUARD_Z + 0.002], null, () => m.front(oval(0.0285, 0.0335, 32), 0.012, { bevel: 0.0022, holes: vents, smooth: 40 }));
  m.use(F.steel);
  m.at([0, 0, GUARD_Z - 0.0065], null, () => m.front(oval(0.0235, 0.028, 32), 0.006, { bevel: 0.0012, smooth: 40 }));
  m.use(GUNMETAL);
  m.mirror(() => m.at([0.026, 0, GUARD_Z + 0.004], null, () => m.box(0.005, 0.03, 0.03, 0.0016)));
  m.glow('trim', () => m.mirror(() => m.at([0.0287, 0, GUARD_Z + 0.004], null, () => m.box(0.0008, 0.018, 0.0012, 0.0002))));
  // The emitter: a tapered block with the slot in its face, and the light inside the slot.
  m.use(F.steel);
  m.at([0, beamY(0) * 0.5, GUARD_Z - 0.019], null, () => m.front(ellipseRect(0.0105, 0.021), 0.02, { bevel: 0.0024, holes: [ellipseRect(0.0042, 0.0135)], smooth: 40 }));
  m.use(F.black);
  m.at([0, beamY(0) * 0.5, GUARD_Z - 0.016], null, () => m.front(ellipseRect(0.0046, 0.014), 0.014, { bevel: 0.0003 }));
  m.glow('core', () => m.at([0, beamY(0) * 0.5, EMIT_Z + 0.006], null, () => m.front(ellipseRect(0.0038, 0.0128), 0.002, { bevel: 0.0003 })));
}

/** The core of the beam: a flat curved lens of light, the katana's curve, to a point. Its own part, so it can ignite. */
function beamCore(m: Mesher): void {
  m.glow('core', () => m.surface(12, 48, (u, v, o) => {
    const s = v * BEAM_LEN;
    const ang = u * Math.PI * 2;
    const k = beamTaper(s);
    o.set(Math.cos(ang) * CORE.t * k, beamY(s) + Math.sin(ang) * CORE.h * k, -s);
  }, { wrapU: true }));
}

/** The halo round the core: brightest where it faces the eye and gone at its silhouette, added over whatever is behind it. */
function beamHalo(): THREE.Mesh {
  const nu = 16;
  const nv = 40;
  const pos: number[] = [];
  const nrm: number[] = [];
  const along: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const s = (j / nv) * (BEAM_LEN + 0.012);
    const k = beamTaper(Math.min(s, BEAM_LEN));
    for (let i = 0; i <= nu; i++) {
      const ang = (i / nu) * Math.PI * 2;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      pos.push(c * HALO.t * (0.5 + 0.5 * k), beamY(s) + sn * HALO.h * (0.4 + 0.6 * k), -s + 0.006);
      nrm.push(c * HALO.h, sn * HALO.t, 0);
      along.push(j / nv);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i;
    idx.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...HALO_COLOR) }, uPower: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      varying float vFace;
      varying float vAlong;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        vAlong = aAlong;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      varying float vFace;
      varying float vAlong;
      void main() {
        float a = pow(vFace, 3.0) * smoothstep(0.0, 0.03, vAlong) * (1.0 - smoothstep(0.93, 1.0, vAlong));
        gl_FragColor = vec4(uColor * a * uPower, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'halo';
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

/** Seconds a point of the swing trail lasts, and the most it holds. */
const TRAIL = { life: 0.11, max: 18, color: [0.18, 0.7, 2.0] } as const;
const _tw = new THREE.Vector3();

/**
 * The light a swing leaves: a ribbon between where the beam's root and tip have been over the last `TRAIL.life` seconds, in
 * the eye's frame, so it hangs where the blade passed in view. Sampled as it is drawn, from the beam's own place that frame.
 * Kept beside the model, not in it, so the shop's studio clone of the model does not carry it. It ages on the viewmodel's
 * clock (`clock.t`, set each frame), so a pause holds it where it is.
 */
function bladeTrail(beam: THREE.Object3D, clock: { t: number }): THREE.Mesh {
  const n = TRAIL.max;
  const pos = new Float32Array(n * 2 * 3);
  const fade = new Float32Array(n * 2);
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  const pAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const fAttr = new THREE.BufferAttribute(fade, 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pAttr);
  g.setAttribute('aFade', fAttr);
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...TRAIL.color) } },
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vFade;
      void main() { gl_FragColor = vec4(uColor * vFade * vFade, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'bladeTrail';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  // Points kept in the camera's frame, newest first: root, tip, and when.
  const root: THREE.Vector3[] = [];
  const tip: THREE.Vector3[] = [];
  const when: number[] = [];
  const shown = (): boolean => {
    for (let o: THREE.Object3D | null = beam; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  mesh.onBeforeRender = (_r, _s, camera) => {
    const now = clock.t;
    mesh.matrixWorld.copy(camera.matrixWorld);
    // Drawn twice a frame (a shadow or a second pass) is still one sample.
    if (shown() && (when.length === 0 || now - when[0]! > 0.004 || now < when[0]!)) {
      const r = (root.length >= n ? root.pop()! : new THREE.Vector3());
      const t = (tip.length >= n ? tip.pop()! : new THREE.Vector3());
      if (when.length >= n) when.pop();
      r.set(0, beamY(0.12), -0.12).applyMatrix4(beam.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      t.set(0, beamY(BEAM_LEN * 0.97), -BEAM_LEN * 0.97).applyMatrix4(beam.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      root.unshift(r);
      tip.unshift(t);
      when.unshift(now);
    }
    let count = 0;
    for (let i = 0; i < when.length; i++) {
      const age = (now - when[i]!) / TRAIL.life;
      if (age >= 1 || age < 0 || !shown()) break;
      // A blade at rest leaves nothing: only a point the tip has moved well away from shows.
      _tw.subVectors(tip[i]!, tip[0]!);
      const k = (1 - age) * Math.min(1, _tw.length() / 0.12) * (i === 0 ? 0 : 1);
      root[i]!.toArray(pos, i * 6);
      tip[i]!.toArray(pos, i * 6 + 3);
      fade[i * 2] = k * 0.15;
      fade[i * 2 + 1] = k;
      count = i + 1;
    }
    g.setDrawRange(0, Math.max(0, count - 1) * 6);
    pAttr.needsUpdate = true;
    fAttr.needsUpdate = true;
  };
  return mesh;
}

function buildSword(kit: Kit): Model {
  const m = kit.mesher();
  m.part('steel', [0, 0, 0], () => {
    blade(m);
    hilt(m);
    guard(m);
  });
  m.part('energy', [0, 0, 0], () => {
    emitterHilt(m);
    m.part('beam', [0, 0, EMIT_Z], () => beamCore(m));
  });
  const model = new Model(m, kit.mats, { glows: GLOWS });
  model.parts.beam!.add(beamHalo());
  // The core is a thin shell of light: seen from inside as well, its winding cannot hide it.
  model.glows.core!.side = THREE.DoubleSide;
  model.socket('muzzle', [0, spineY(BLADE_LEN), GUARD_Z - BLADE_LEN]);
  model.hand('gripR', [0.0158, 0, -0.052], [0, 0, 1], [-0.32, -0.95, 0]);
  // Both palms on the same side of the hilt and both thumbs toward the blade; the fingers wrap it the opposite way.
  model.grasp('gripL', [0.0158, 0, 0.098], [-0.95, 0.32, 0], [0.32, 0.95, 0]);
  return model;
}

/** Pose of the sword in view space: position, then Euler X, Y, Z. */
type Pose = readonly [number, number, number, number, number, number];

const REST: Pose = [0.2, -0.205, -0.43, 0.88, 0.14, -0.72];
const COCK: Pose = [0.3, -0.13, -0.4, 0.5, -0.5, -0.95];
const PARRY: Pose = [0.08, -0.14, -0.44, 0.72, 0.42, -1.25];

/**
 * Each arc: where it starts, the pose at its midpoint, where it ends. The blade has to stay on screen for the whole
 * cut, so the hilt stays near the bottom edge and it is the blade that crosses the view.
 */
const ARCS: Record<'light1' | 'light2' | 'light3', readonly [Pose, Pose, Pose]> = {
  // Down and a little left, from over the right shoulder. Sweep (-0.3, -1).
  light1: [[0.25, 0.04, -0.45, 1.35, -0.25, -0.1], [0.1, -0.1, -0.56, 0.42, 0.2, -0.3], [-0.06, -0.27, -0.48, -0.45, 1.0, -0.5]],
  // Rising to the right, edge leading, picked up where the first cut ended. Sweep (0.8, 0.6).
  light2: [[-0.08, -0.27, -0.48, -0.4, 0.9, 2.2], [0.1, -0.16, -0.56, 0.55, 0.05, 2.2], [0.3, -0.03, -0.46, 0.95, -0.85, 2.2]],
  // Flat, right to left, the widest of the three. The blade leans up so it crosses the screen as a long line. Sweep (-1, 0.06).
  light3: [[0.34, -0.12, -0.42, 0.36, -1.2, -1.57], [0.04, -0.18, -0.58, 0.5, 0, -1.57], [-0.26, -0.18, -0.46, 0.36, 1.2, -1.57]],
};

/** The tornado: one flat sweep that leaves the screen on the left, then the blade comes round again from the right. */
const SPIN: readonly [Pose, Pose, Pose] = [[0.38, -0.12, -0.36, 0.3, -1.45, -1.57], [0.02, -0.18, -0.62, 0.42, 0.1, -1.57], [-0.42, -0.22, -0.38, 0.3, 1.9, -1.57]];
/** The cleave: over the head, then straight down into the floor. */
const CLEAVE_TOP: Pose = [0.12, 0.2, -0.32, 2.0, -0.1, -0.1];
const CLEAVE_END: Pose = [0.1, -0.11, -0.42, -0.6, 0.15, -0.35];
/** The stab: drawn back at the hip, then out from low right, the point crossing the crosshair, so the blade's length shows. */
const STAB: readonly [Pose, Pose, Pose] = [[0.22, -0.25, -0.28, 0.1, 0.22, -0.3], [0.17, -0.21, -0.5, 0.2, 0.3, -0.2], [0.15, -0.2, -0.6, 0.22, 0.34, -0.15]];
/** Cleave and stab land at these shares of their moves, as their rows in KATANA say. */
const CLEAVE_HIT = 0.36;
const WAVE_HIT = 0.12;

const cur = new Float64Array(6);
const from = new Float64Array(6);
const _hold = { move: null as Anim['swing'], p: 0 };

function set(out: Float64Array, a: Pose): void {
  for (let i = 0; i < 6; i++) out[i] = a[i]!;
}

function mix(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>, t: number): void {
  for (let i = 0; i < 6; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
}

/** The quadratic through all three poses, so the middle one is a pose the blade actually reaches. */
function arc(out: Float64Array, c: readonly [Pose, Pose, Pose], t: number): void {
  const u = 1 - t;
  for (let i = 0; i < 6; i++) {
    const mid = 2 * c[1][i]! - (c[0][i]! + c[2][i]!) / 2;
    out[i] = u * u * c[0][i]! + 2 * u * t * mid + t * t * c[2][i]!;
  }
}

/** The energy blade alive in hand: it ignites out of the emitter on the draw, flickers, and burns brighter through a swing. */
function energize(model: Model, trail: THREE.Mesh, clock: { t: number }, a: Anim): void {
  if (!trail.parent && model.root.parent) model.root.parent.add(trail);
  clock.t = a.time;
  if (!a.mods?.has('swordEnergy')) return;
  const beam = model.parts.beam!;
  beam.scale.z = Math.max(0.02, outCubic(clamp(a.draw)));
  const t = a.time;
  const swinging = a.swing && a.swing !== 'windup' && a.swingP < 1 ? 1 : 0;
  const f = (1 + 0.05 * Math.sin(t * 61) + 0.035 * Math.sin(t * 147 + 1.3) + (Math.random() - 0.5) * 0.05) * (1 + 0.2 * swinging + 0.5 * a.bladeHeat);
  const core = model.glows.core;
  if (core) core.color.copy(core.userData.base as THREE.Color).multiplyScalar(f);
  const halo = beam.getObjectByName('halo') as THREE.Mesh | undefined;
  if (halo) (halo.material as THREE.ShaderMaterial).uniforms.uPower!.value = f;
}

function clip(a: Anim): void {
  const move = a.swing;
  // A new move starts from wherever the blade is, so a chain flows instead of popping back to guard.
  if (move !== _hold.move || a.swingP < _hold.p) {
    from.set(cur);
    _hold.move = move;
  }
  _hold.p = a.swingP;
  const p = a.swingP;
  // Past 1 the move is recovering, over the rig's recover time.
  const back = move && move !== 'windup' && p > 1 ? clamp((p - 1) / (a.recover / a.swingSeconds)) : 0;
  let heat = 0;

  if (move === 'light1' || move === 'light2' || move === 'light3') {
    // Fastest at the start: the hit lands on the frame of the click, so the blade cannot be seen winding up.
    arc(cur, ARCS[move], outQuad(Math.min(p, 1)));
    if (p < 0.14) mix(cur, from, cur, inOut(p / 0.14));
    if (back > 0) mix(cur, cur, REST, inOut(back));
  } else if (move === 'windup') {
    // The guard: across the body while the button is held, and home again when it is let go.
    if (a.charge > 0) mix(cur, from, COCK, outCubic(clamp(p * 1.6)));
    else mix(cur, cur, REST, 1 - Math.exp(-16 * a.dt));
  } else if (move === 'stab') {
    arc(cur, STAB, outQuad(clamp(p * 2.4)));
    if (p < 0.1) mix(cur, from, cur, inOut(p / 0.1));
    if (back > 0) mix(cur, cur, REST, inOut(back));
  } else if (move === 'flurry') {
    // Six stabs, each a little off the last one's line. The last stays out.
    const n = 6;
    const j = Math.min(n - 1, Math.floor(p * n));
    const f = j === n - 1 ? Math.min(1, (p * n - j) / 0.4) : (p * n) % 1;
    const k = f < 0.4 ? outQuad(f / 0.4) : 1 - inOut((f - 0.4) / 0.6);
    mix(cur, STAB[0], STAB[2], k);
    cur[0] = cur[0]! + Math.sin(j * 12.9898) * 0.05;
    cur[1] = cur[1]! + Math.sin(j * 78.233) * 0.035;
    if (p < 0.06) mix(cur, from, cur, inOut(p / 0.06));
    if (back > 0) mix(cur, cur, REST, inOut(back));
  } else if (move === 'spin') {
    if (p < 0.5) arc(cur, SPIN, inOut(p / 0.5));
    else arc(cur, SPIN, Math.min(0.5, ((p - 0.5) / 0.35) * 0.5));
    if (p < 0.08) mix(cur, from, cur, outCubic(p / 0.08));
    heat = 0.5 * (1 - seg(p, 0.5, 1));
    if (back > 0) mix(cur, cur, REST, inOut(back));
  } else if (move === 'wave') {
    // A short gather while the blade fills with light, then the flat cut that throws it.
    if (p < WAVE_HIT) mix(cur, from, ARCS.light3[0], outCubic(p / WAVE_HIT));
    else arc(cur, ARCS.light3, outQuad(seg(p, WAVE_HIT, 1)));
    heat = p < WAVE_HIT ? p / WAVE_HIT : 1 - seg(p, WAVE_HIT, 0.7);
    if (back > 0) mix(cur, cur, REST, inOut(back));
  } else if (move === 'cleave') {
    // Up over the head, down to land exactly on the blow, then the blade stays driven into the floor.
    if (p < 0.22) mix(cur, from, CLEAVE_TOP, outCubic(p / 0.22));
    else mix(cur, CLEAVE_TOP, CLEAVE_END, inCubic(seg(p, 0.22, CLEAVE_HIT)));
    const shudder = p > CLEAVE_HIT ? (1 - seg(p, CLEAVE_HIT, 1)) * 0.012 : 0;
    cur[1] = cur[1]! + Math.sin(a.time * 90) * shudder;
    cur[3] = cur[3]! + Math.sin(a.time * 77) * shudder;
    heat = seg(p, 0.05, CLEAVE_HIT);
    if (back > 0) mix(cur, cur, REST, inOut(back));
  } else {
    set(cur, REST);
  }

  // A blocked shot rides on top of whatever the guard is doing: snap across the body, ring, and settle.
  if (a.parry >= 0) {
    const k = outBack(seg(a.parry, 0, 0.3)) * (1 - seg(a.parry, 0.45, 1));
    for (let i = 0; i < 6; i++) cur[i] = cur[i]! + (PARRY[i]! - cur[i]!) * k * 0.85;
    cur[3] = cur[3]! + Math.sin(a.parry * 40) * 0.02 * (1 - a.parry);
  }

  a.bladeHeat = Math.max(heat, damp(a.bladeHeat, 0, 2.6, a.dt));

  if (a.draw < 1) {
    // Out of the scabbard: the blade rolls over into guard.
    const k = 1 - outCubic(a.draw);
    cur[5] = cur[5]! - k * 1.6;
    cur[0] = cur[0]! + k * 0.09;
  }

  a.gunP.x += cur[0]! - REST[0];
  a.gunP.y += cur[1]! - REST[1];
  a.gunP.z += cur[2]! - REST[2];
  a.gunR.x += cur[3]! - REST[3];
  a.gunR.y += cur[4]! - REST[4];
  a.gunR.z += cur[5]! - REST[5];
}

export function swordDef(kit: Kit): ViewDef {
  set(cur, REST);
  const model = buildSword(kit);
  const clock = { t: 0 };
  const trail = bladeTrail(model.parts.beam!, clock);
  return {
    id: 'sword',
    model,
    pos: [REST[0], REST[1], REST[2]],
    rot: [REST[3], REST[4], REST[5]],
    recoil: { back: 0, lift: 0, pitch: 0, yaw: 0, roll: 0, omega: 40, zeta: 0.7 },
    right: { socket: 'gripR', pose: HANDS.hilt },
    left: { socket: 'gripL', pose: HANDS.hilt },
    mods: { swordEnergy: { part: 'energy', hides: 'steel' } },
    animate: a => {
      clip(a);
      energize(model, trail, clock, a);
    },
  };
}

