/**
 * Viewmodel materials.
 *
 * One MeshStandardMaterial carries every opaque surface. Albedo, roughness, metalness, wear and heat are vertex
 * attributes, and all texture detail is triplanar in object space, so no model needs UVs and a part with six
 * different finishes is one draw call. The shader turns the edge tag into chipped paint, adds roughness breakup
 * and scratches, and hosts the perk looks (heat, berserk, frost) as shared uniforms.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../../core/math';

export interface Patcher {
  patch<T extends THREE.MeshStandardMaterial>(material: T): T;
}

export interface VmUniforms {
  /** 0..1 gun heat from sustained fire. Lights surfaces with a heat tag. */
  uGunHeat: { value: number };
  /** 0..1 Hellfire. Lights the whole gun from the edges in. */
  uPerkHeat: { value: number };
  /** 0..1 Berserk pulse, driven by the rig. */
  uBerserk: { value: number };
  /** 0..1 frost cover. */
  uFrost: { value: number };
  /** Seconds, for crawling heat. */
  uClock: { value: number };
}

// --- Detail textures -----------------------------------------------------------------------------

function lattice(size: number, period: number, rng: () => number): Float32Array {
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const out = new Float32Array(size * size);
  const s = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * s;
    const y0 = Math.floor(fy);
    let ty = fy - y0;
    ty = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % period) * period;
    const r1 = ((y0 + 1) % period) * period;
    for (let x = 0; x < size; x++) {
      const fx = x * s;
      const x0 = Math.floor(fx);
      let tx = fx - x0;
      tx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % period;
      const c1 = (x0 + 1) % period;
      const a = grid[r0 + c0]! + (grid[r0 + c1]! - grid[r0 + c0]!) * tx;
      const b = grid[r1 + c0]! + (grid[r1 + c1]! - grid[r1 + c0]!) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function fbm(size: number, base: number, octaves: number, gain: number, rng: () => number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const period = Math.min(base << o, size);
    const layer = lattice(size, period, rng);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + layer[i]! * amp;
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total;
  return stretch(out);
}

/** Histogram stretch to 0..1, so shader thresholds mean the same thing for every noise. */
function stretch(a: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < lo) lo = a[i]!;
    if (a[i]! > hi) hi = a[i]!;
  }
  const k = 1 / (hi - lo || 1);
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! - lo) * k;
  return a;
}

function scratches(size: number, rng: () => number): Float32Array {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.lineCap = 'round';
  const line = (x: number, y: number, dx: number, dy: number, w: number, a: number) => {
    g.strokeStyle = `rgba(255,255,255,${a})`;
    g.lineWidth = w;
    for (let ox = -size; ox <= size; ox += size) {
      for (let oy = -size; oy <= size; oy += size) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + dx * 0.5 + dy * 0.05, y + oy + dy * 0.5 - dx * 0.05, x + ox + dx, y + oy + dy);
        g.stroke();
      }
    }
  };
  for (let i = 0; i < 520; i++) {
    const a = rng() * Math.PI * 2;
    const l = 8 + rng() * rng() * size * 0.5;
    line(rng() * size, rng() * size, Math.cos(a) * l, Math.sin(a) * l, 0.5 + rng() * 0.9, 0.15 + rng() * 0.6);
  }
  // Clusters of near-parallel marks read as handling wear rather than random hairs.
  for (let k = 0; k < 14; k++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const a = rng() * Math.PI * 2;
    for (let i = 0; i < 14; i++) {
      const l = 14 + rng() * 44;
      const aa = a + (rng() - 0.5) * 0.25;
      line(cx + (rng() - 0.5) * 36, cy + (rng() - 0.5) * 36, Math.cos(aa) * l, Math.sin(aa) * l, 0.6 + rng() * 0.6, 0.3 + rng() * 0.5);
    }
  }
  const px = g.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4]! / 255;
  return out;
}

function dataTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeDetail(): { detail: THREE.DataTexture; normal: THREE.DataTexture } {
  const size = 512;
  const rng = mulberry32(0x0b5e55ed);
  const grunge = fbm(size, 4, 6, 0.55, rng);
  const scr = scratches(size, rng);
  const grain = fbm(size, 96, 3, 0.7, rng);
  const chip = fbm(size, 12, 6, 0.62, rng);
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = grunge[i]! * 255;
    px[i * 4 + 1] = scr[i]! * 255;
    px[i * 4 + 2] = grain[i]! * 255;
    px[i * 4 + 3] = chip[i]! * 255;
  }
  // Normal from a height of casting grain with scratches cut into it.
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = grain[i]! * 0.55 + chip[i]! * 0.35 - scr[i]! * 0.5;
  const nx = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yu = ((y + size - 1) % size) * size;
    const yd = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xl = (x + size - 1) % size;
      const xr = (x + 1) % size;
      const dx = (h[y * size + xr]! - h[y * size + xl]!) * 2.2;
      const dy = (h[yd + x]! - h[yu + x]!) * 2.2;
      const i = (y * size + x) * 4;
      nx[i] = Math.max(0, Math.min(255, 127.5 - dx * 127.5));
      nx[i + 1] = Math.max(0, Math.min(255, 127.5 - dy * 127.5));
      nx[i + 2] = 255;
      nx[i + 3] = 255;
    }
  }
  return { detail: dataTexture(px, size), normal: dataTexture(nx, size) };
}

// --- Decal atlas ---------------------------------------------------------------------------------

type Region = readonly [number, number, number, number];

function makeDecals(): { texture: THREE.CanvasTexture; regions: Record<string, Region> } {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const regions: Record<string, Region> = {};
  let x = 8;
  let y = 8;
  let rowH = 0;
  const place = (name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
    if (x + w > S - 8) {
      x = 8;
      y += rowH + 8;
      rowH = 0;
    }
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    g.fillStyle = g.strokeStyle = '#fff';
    draw(g, w, h);
    g.restore();
    regions[name] = [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S];
    x += w + 8;
    rowH = Math.max(rowH, h);
  };
  const text = (s: string, font: string, spacing = 0) => (g2: CanvasRenderingContext2D, w: number, h: number) => {
    g2.font = font;
    g2.textBaseline = 'middle';
    g2.textAlign = 'center';
    (g2 as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
    g2.fillText(s, w / 2, h / 2 + 1);
  };
  const STENCIL = '800 44px "Courier New", monospace';
  const TECH = '700 26px "Courier New", monospace';
  place('op2', 256, 64, text('OP-2', STENCIL, 8));
  place('crucible', 320, 48, text('CRUCIBLE ARMS', TECH, 3));
  place('cal9', 256, 40, text('9x25 CASELESS', TECH, 2));
  place('cal12', 256, 40, text('12 GA  3.5"', TECH, 2));
  place('cal30', 256, 40, text('30x173 HE-I', TECH, 2));
  place('cal50', 256, 40, text('.500 JUDGE', TECH, 3));
  place('hv', 320, 48, text('!! 40 kV !!', TECH, 3));
  place('lance', 320, 64, text('LANCE MK IV', STENCIL, 5));
  place('kiln', 256, 64, text('KILN', STENCIL, 12));
  place('flam', 320, 48, text('FLAMMABLE', TECH, 5));
  place('stake', 320, 48, text('REBAR 16 MM', TECH, 3));
  place('press', 320, 48, text('MAX 300 BAR', TECH, 3));
  place('saw', 320, 64, text('BUZZSAW', STENCIL, 6));
  place('judge', 256, 64, text('JUDGE', STENCIL, 8));
  place('he', 128, 48, text('HE', STENCIL, 4));
  place('serial', 320, 36, text('SN 0451-77-OP2', TECH, 2));
  place('fire', 192, 40, text('SAFE  SEMI  AUTO', '700 20px "Courier New", monospace', 1));
  place('hazard', 256, 64, (g2, w, h) => {
    for (let i = -2; i < 12; i++) {
      g2.beginPath();
      g2.moveTo(i * 40, h);
      g2.lineTo(i * 40 + 20, h);
      g2.lineTo(i * 40 + 20 + h, 0);
      g2.lineTo(i * 40 + h, 0);
      g2.closePath();
      g2.fill();
    }
    void w;
  });
  place('warn', 96, 96, (g2, w, h) => {
    g2.lineWidth = 7;
    g2.lineJoin = 'round';
    g2.beginPath();
    g2.moveTo(w / 2, 8);
    g2.lineTo(w - 8, h - 10);
    g2.lineTo(8, h - 10);
    g2.closePath();
    g2.stroke();
    g2.font = '800 48px "Courier New", monospace';
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    g2.fillText('!', w / 2, h / 2 + 10);
  });
  place('arrow', 96, 64, (g2, w, h) => {
    g2.beginPath();
    g2.moveTo(4, h / 2 - 9);
    g2.lineTo(w - 36, h / 2 - 9);
    g2.lineTo(w - 36, 6);
    g2.lineTo(w - 4, h / 2);
    g2.lineTo(w - 36, h - 6);
    g2.lineTo(w - 36, h / 2 + 9);
    g2.lineTo(4, h / 2 + 9);
    g2.closePath();
    g2.fill();
  });
  place('ticks', 256, 32, (g2, w, h) => {
    for (let i = 0; i <= 25; i++) g2.fillRect(i * (w - 3) / 25, 0, 3, i % 5 === 0 ? h : h * 0.55);
  });
  place('dial', 128, 128, (g2, w, h) => {
    g2.lineWidth = 4;
    g2.beginPath();
    g2.arc(w / 2, h / 2, w / 2 - 5, Math.PI * 0.75, Math.PI * 2.25);
    g2.stroke();
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      const r0 = w / 2 - (i % 5 === 0 ? 24 : 16);
      g2.lineWidth = i % 5 === 0 ? 5 : 3;
      g2.beginPath();
      g2.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
      g2.lineTo(w / 2 + Math.cos(a) * (w / 2 - 6), h / 2 + Math.sin(a) * (w / 2 - 6));
      g2.stroke();
    }
    g2.font = '700 18px "Courier New", monospace';
    g2.textAlign = 'center';
    g2.fillText('BAR', w / 2, h - 20);
  });
  // Stencil paint is never clean. Knock specks out of everything drawn so far.
  const rng = mulberry32(77);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9000; i++) {
    g.globalAlpha = 0.3 + rng() * 0.7;
    const r = 0.4 + rng() * rng() * 2.6;
    g.beginPath();
    g.arc(rng() * S, rng() * S, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: t, regions };
}

// --- Shader injection ----------------------------------------------------------------------------

const VERT_DECL = /* glsl */`
attribute vec4 aAlb;
attribute vec4 aSurf;
attribute float aKind;
varying vec4 vAlb;
varying vec4 vSurf;
varying float vKind;
varying vec3 vOP;
varying vec3 vON;
`;

const VERT_BODY = /* glsl */`
vAlb = aAlb;
vSurf = aSurf;
vKind = aKind;
vOP = position;
vON = normal;
`;

const FRAG_DECL = /* glsl */`
uniform sampler2D tDetail;
uniform sampler2D tDetailN;
uniform float uGunHeat;
uniform float uPerkHeat;
uniform float uBerserk;
uniform float uFrost;
uniform float uClock;
varying vec4 vAlb;
varying vec4 vSurf;
varying float vKind;
varying vec3 vOP;
varying vec3 vON;

vec4 vmTri(sampler2D t, vec3 p, vec3 w, float s) {
  return texture2D(t, p.zy * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, p.xy * s) * w.z;
}
vec3 vmHeatRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  return vec3(t * 2.6, t * t * 1.15, t * t * t * t * 0.55) * (0.5 + t * 2.6);
}
`;

const FRAG_SURFACE = /* glsl */`
vec3 vmN = normalize(vON);
vec3 vmW = abs(vmN);
vmW = vmW * vmW * vmW * vmW;
vmW /= (vmW.x + vmW.y + vmW.z);
vec4 vmFine = vmTri(tDetail, vOP, vmW, 7.0);
vec4 vmBig = vmTri(tDetail, vOP, vmW, 1.5);
float vmKindId = floor(vKind + 0.5);

vec3 vmAlb = pow(vAlb.rgb, vec3(2.2));
float vmRough = vSurf.x;
float vmMetal = vSurf.y;
float vmEdge = vSurf.z;
float vmAo = vAlb.a;
float vmBump = 0.16;
float vmBumpScale = 9.0;
float vmHeatShape = 1.0;

if (vmKindId > 0.5 && vmKindId < 1.5) {
  // Wood: long grain along the stock with a warped ring pattern.
  float warp = vmBig.a * 0.05 + vmBig.r * 0.02;
  float rings = sin((vOP.y * 1.3 + vOP.x * 0.8 + warp) * 240.0);
  float fibre = vmTri(tDetail, vOP * vec3(14.0, 14.0, 0.8), vmW, 3.0).b;
  vmAlb *= 0.72 + 0.34 * (0.5 + 0.5 * rings) + (fibre - 0.5) * 0.5;
  vmRough += (fibre - 0.5) * 0.2;
} else if (vmKindId > 1.5 && vmKindId < 2.5) {
  vmBump = 0.75;
  vmBumpScale = 34.0;
  vmAlb *= 0.9 + 0.3 * vmTri(tDetail, vOP, vmW, 30.0).b;
} else if (vmKindId > 2.5 && vmKindId < 3.5) {
  // Brushed: grain stretched along the barrel axis.
  float b = vmTri(tDetail, vOP * vec3(30.0, 30.0, 1.0), vmW, 3.0).b;
  vmRough += (b - 0.5) * 0.28;
  vmAlb *= 0.9 + b * 0.2;
} else if (vmKindId > 3.5 && vmKindId < 4.5) {
  // Carbon twill.
  vec2 cp = (vmW.x > vmW.y && vmW.x > vmW.z) ? vOP.zy : ((vmW.y > vmW.z) ? vOP.xz : vOP.xy);
  cp *= 190.0;
  vec2 cell = floor(cp);
  float twill = mod(cell.x + cell.y, 4.0) < 2.0 ? 1.0 : 0.0;
  vec2 f = fract(cp) - 0.5;
  float along = twill > 0.5 ? f.x : f.y;
  vmAlb *= 0.55 + 0.9 * twill * (0.65 + 0.35 * cos(along * 3.14));
  vmRough += (twill - 0.5) * 0.1;
  vmBump = 0.05;
} else if (vmKindId > 4.5 && vmKindId < 5.5) {
  vmBump = 0.32;
  vmBumpScale = 18.0;
} else if (vmKindId > 5.5 && vmKindId < 6.5) {
  // Cordura: a visible over-under weave, with grime in the threads.
  vec2 wp = (vmW.x > vmW.y && vmW.x > vmW.z) ? vOP.zy : ((vmW.y > vmW.z) ? vOP.xz : vOP.xy);
  wp *= 900.0;
  // The weave fades out before it can alias: a moire on a sleeve looks like a rendering bug.
  float vmWeaveFade = 1.0 - smoothstep(0.5, 1.4, length(fwidth(wp)));
  float warp = sin(wp.x) * sin(wp.y);
  vmAlb *= 1.0 + vmWeaveFade * 0.28 * (smoothstep(-0.7, 0.7, warp) - 0.5);
  vmRough += 0.1;
  vmBump = 0.42;
  vmBumpScale = 42.0;
} else if (vmKindId > 6.5 && vmKindId < 7.5) {
  // Glove leather: a fine pebbled grain.
  vmBump = 0.3;
  vmBumpScale = 26.0;
  vmAlb *= 0.92 + 0.2 * vmBig.r;
} else if (vmKindId > 7.5) {
  // Polished blade. The wear tag carries position across the blade here, 0 at the spine and 1 on the edge, so the
  // temper line can follow the curve of the sword. Mist above the line, mirror below it.
  float across = vSurf.z;
  vmEdge = 0.0;
  float grainAlong = vmTri(tDetail, vOP * vec3(26.0, 26.0, 0.9), vmW, 3.0).b;
  float line = 0.6 + 0.055 * sin(vOP.z * 46.0 + vmBig.a * 5.0) + (vmFine.a - 0.5) * 0.1;
  float temper = smoothstep(-0.018, 0.03, across - line);
  float mist = 1.0 - smoothstep(0.0, 0.05, abs(across - line));
  vmAlb = mix(vec3(0.34, 0.35, 0.38), vec3(0.8, 0.82, 0.85), temper) * (0.92 + grainAlong * 0.16) + mist * 0.18;
  vmRough = mix(0.4, 0.22, temper) + (grainAlong - 0.5) * 0.12;
  vmMetal = 1.0;
  vmBump = 0.03;
  vmHeatShape = across * across;
}

// Paint chips where the edge tag and the noise agree, and only there.
float vmChipNoise = vmFine.a * 0.62 + vmBig.a * 0.55 + vmFine.g * 0.2;
float vmChip = smoothstep(0.86, 0.93, vmEdge * 0.55 + vmChipNoise) * step(0.004, vmEdge);
float vmScuff = smoothstep(0.55, 0.9, vmBig.a) * smoothstep(0.25, 0.7, vmFine.g);
float vmPaint = (1.0 - vmMetal) * step(vmKindId, 4.5);
vmAlb = mix(vmAlb, vmAlb * 1.7 + 0.03, vmScuff * vmPaint * 0.5);
vec3 vmBare = vec3(0.46, 0.47, 0.49) * (0.8 + 0.4 * vmFine.b);
vmAlb = mix(vmAlb, vmBare, vmChip);
vmMetal = mix(vmMetal, 1.0, vmChip);
vmRough = mix(vmRough, 0.3 + vmFine.b * 0.24, vmChip);

vmRough += (vmBig.r - 0.5) * 0.26 + (vmFine.b - 0.5) * 0.12 - vmFine.g * 0.08 * vmMetal;

// Grime settles in cavities, and takes the shine with it.
vmAlb *= mix(0.42, 1.0, vmAo);
vmRough = mix(min(vmRough + 0.35, 1.0), vmRough, vmAo);

// Perk looks. A buffed gun has to stay a detailed gun, so none of these replace the surface: emission lives in thin
// veins and broken edge lines, and everything between them keeps its own albedo, wear and reflections.
float vmVeinN = vmFine.a * 0.72 + vmBig.a * 0.28;
// Hard surfaces only, and only in patches: cracks everywhere read as a marble texture, not as a hot gun.
float vmVeinMask = step(vmKindId, 4.5) * smoothstep(0.5, 0.64, vmBig.r);
float vmVein = vmVeinMask * (1.0 - smoothstep(0.0, 0.011, abs(vmVeinN - 0.5 - 0.05 * sin(uClock * 0.8 + vmBig.r * 6.0))));
float vmEdgeLine = step(vmKindId, 4.5) * smoothstep(0.35, 0.7, vmEdge) * smoothstep(0.5, 0.62, vmVeinN);

float vmFrost = uFrost * smoothstep(0.46, 0.66, vmBig.r * 0.5 + vmFine.a * 0.3 + max(vmN.y, 0.0) * 0.18 + vmEdge * 0.2 + (uFrost - 0.5) * 0.35);
vmAlb = mix(vmAlb, vec3(0.62, 0.76, 0.9) * (0.75 + 0.5 * vmFine.b), vmFrost * 0.8);
vmMetal *= 1.0 - vmFrost * 0.8;
vmRough = mix(vmRough, 0.42 + vmFine.a * 0.25, vmFrost);

vec3 vmEmis = vec3(0.03, 0.1, 0.18) * vmFrost * vmFine.a;
float vmHeatMask = vSurf.w;
float vmHot = max(uGunHeat * vmHeatMask * vmHeatShape * (0.72 + vmFine.a * 0.4), uPerkHeat * vmHeatMask * 0.2);
vmEmis += vmHeatRamp(vmHot);
vmAlb *= 1.0 - clamp(vmHot * 0.5, 0.0, 0.5);
vmEmis += vec3(1.9, 0.52, 0.1) * uPerkHeat * (vmVein * (0.8 + 0.3 * sin(uClock * 3.1 + vmBig.a * 9.0)) + vmEdgeLine * 0.35);
vmEmis += vec3(2.4, 0.07, 0.05) * uBerserk * (vmVein * 0.9 + vmEdgeLine * 0.4);

diffuseColor.rgb = vmAlb;
`;

const FRAG_NORMAL = /* glsl */`
{
  vec2 nX = texture2D(tDetailN, vOP.zy * vmBumpScale).xy * 2.0 - 1.0;
  vec2 nY = texture2D(tDetailN, vOP.xz * vmBumpScale).xy * 2.0 - 1.0;
  vec2 nZ = texture2D(tDetailN, vOP.xy * vmBumpScale).xy * 2.0 - 1.0;
  vec3 vmD = vec3(0.0, nX.y, nX.x) * vmW.x + vec3(nY.x, 0.0, nY.y) * vmW.y + vec3(nZ.x, nZ.y, 0.0) * vmW.z;
  normal = normalize(normal + normalMatrix * (vmD * vmBump));
}
`;

/**
 * The baked light runs from nothing to a trapped-corridor glare, and the gun fills a quarter of the screen through all
 * of it. So its ambient is squeezed into a band where forms always read: a soft ceiling, and a floor that keeps the
 * local hue, so a gun in the dark of the foundry is dim and orange rather than a black cut-out.
 */
const LIGHT_BAND = /* glsl */`
{
  float vmPeak = max(max(iblIrradiance.r, iblIrradiance.g), iblIrradiance.b);
  vec3 vmHue = (iblIrradiance + 0.012) / (vmPeak + 0.012);
  iblIrradiance = iblIrradiance / (1.0 + vmPeak * 0.5) + vmHue * 0.2;
  float vmPeakR = max(max(radiance.r, radiance.g), radiance.b);
  radiance = radiance / (1.0 + vmPeakR * 0.5) + vmHue * 0.07;
}
`;

/**
 * A muzzle flash sits centimetres from the barrel, so its inverse-square light would burn the whole gun to one flat
 * colour on every shot. Limiting the light before it meets the surface keeps albedo and wear readable under the flash.
 */
const POINT_ATTENUATION = 'light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );';
const POINT_LIMITED = THREE.ShaderChunk.lights_pars_begin.replace(POINT_ATTENUATION, `${POINT_ATTENUATION}
\tlight.color /= 1.0 + max( max( light.color.r, light.color.g ), light.color.b ) * 0.4;`);

function lightBand(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_pars_begin>', POINT_LIMITED)
    .replace('#include <lights_fragment_end>', `${LIGHT_BAND}\n#include <lights_fragment_end>`);
}

function inject(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>): void {
  Object.assign(shader.uniforms, uniforms);
  lightBand(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform mat3 normalMatrix;\n${FRAG_DECL}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vmRough, 0.05, 1.0);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(vmMetal, 0.0, 1.0);')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vmEmis;');
}

// --- Library -------------------------------------------------------------------------------------

export class VmMaterials {
  readonly hard: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly decal: THREE.MeshStandardMaterial;
  readonly uniforms: VmUniforms;
  readonly decalRegions: Record<string, Region>;
  readonly detail: THREE.DataTexture;
  readonly detailNormal: THREE.DataTexture;
  private readonly patcher: Patcher;

  constructor(patcher: Patcher) {
    this.patcher = patcher;
    const { detail, normal } = makeDetail();
    this.detail = detail;
    this.detailNormal = normal;
    const { texture, regions } = makeDecals();
    this.decalRegions = regions;
    this.uniforms = {
      uGunHeat: { value: 0 },
      uPerkHeat: { value: 0 },
      uBerserk: { value: 0 },
      uFrost: { value: 0 },
      uClock: { value: 0 },
    };

    const hardUniforms = { ...this.uniforms, tDetail: { value: detail }, tDetailN: { value: normal } } as unknown as Record<string, THREE.IUniform>;
    const hard = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.5, name: 'vm-hard' });
    // The engine's patch wraps whatever hook is present, so this has to be set first.
    hard.onBeforeCompile = shader => inject(shader, hardUniforms);
    hard.customProgramCacheKey = () => 'vm-hard';
    this.hard = this.patched(hard);

    const glass = new THREE.MeshStandardMaterial({
      color: 0x8fb4c8, roughness: 0.06, metalness: 0.85, transparent: true, opacity: 0.22, depthWrite: false, name: 'vm-glass',
    });
    glass.onBeforeCompile = lightBand;
    glass.customProgramCacheKey = () => 'vm-glass';
    this.glass = this.patched(glass);

    const decal = new THREE.MeshStandardMaterial({
      map: texture, transparent: true, depthWrite: false, roughness: 0.65, metalness: 0, vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: 'vm-decal',
    });
    decal.onBeforeCompile = lightBand;
    decal.customProgramCacheKey = () => 'vm-decal';
    this.decal = this.patched(decal);
  }

  private patched<T extends THREE.MeshStandardMaterial>(m: T): T {
    return this.patcher.patch(m);
  }

  /** HDR emissive for sights and readouts. Bloom wants values above 1, so the colour is pre-multiplied. */
  glow(color: THREE.ColorRepresentation, intensity: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color });
    m.color.multiplyScalar(intensity);
    m.userData.base = m.color.clone();
    return m;
  }
}
