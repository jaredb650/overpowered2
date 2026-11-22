/**
 * Pooled GPU shader meshes for `megaBlast` (docs/proposals/mech-parts.md section 3).
 *
 * Four distinct visual layers per pooled blast slot, sharing static geometries across the entire pool:
 *   1. High-energy bloom flash core (t = 0.0..0.20 s) — crisp world-space bloom, NO full-screen white-out.
 *   2. Sharp-edged spherical condensation dome + screen-space refraction shell (t = 0.02..0.90 s) expanding to 70 m * scale.
 *   3. Ground-hugging turbulent dust & debris torus rolling outward behind the pressure front (t = 0.08..2.60 s).
 *   4. Short, fat, squat fireball column that boils upward and collapses into a dirty dark cloud (t = 0.05..3.80 s) —
 *      explicitly NO stem and NO mushroom cap (those belong to the Tactical Nuke).
 *
 * Zero per-frame allocations; all meshes stay hidden (`visible = false`) when idle.
 */
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU } from '../../core/math';
import { ORDER } from '../layers/shared';

const NOISE_GLSL = /* glsl */ `
float mbHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 53.3))) * 43758.5453); }
float mbNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(mbHash(i), mbHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(mbHash(i + vec3(0.0, 1.0, 0.0)), mbHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(mbHash(i + vec3(0.0, 0.0, 1.0)), mbHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(mbHash(i + vec3(0.0, 1.0, 1.0)), mbHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}
float mbFbm(vec3 p) {
  return mbNoise(p) * 0.55 + mbNoise(p * 2.07) * 0.30 + mbNoise(p * 4.21) * 0.15;
}
`;

// ---------------------------------------------------------------------------------------------
// Stage 1: Crisp world-space bloom flash core (no full-screen white-out)
// ---------------------------------------------------------------------------------------------

const FLASH_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FLASH_FRAG = /* glsl */ `
uniform float uPower;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float halo = pow(ndv, 1.7);
  float core = pow(ndv, 5.0);
  vec3 warm = vec3(1.0, 0.62, 0.22) * 3.8;
  vec3 hotCore = vec3(1.0, 0.96, 0.88) * 12.0;
  vec3 c = mix(warm, hotCore, core) * halo * uPower;
  gl_FragColor = vec4(c, halo * uPower);
}
`;

// ---------------------------------------------------------------------------------------------
// Stage 2A: Screen-space refraction shell behind the pressure wave leading edge
// ---------------------------------------------------------------------------------------------

const REFRACT_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vLocalY;
void main() {
  vLocalY = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const REFRACT_FRAG = /* glsl */ `
uniform sampler2D uGrab;
uniform vec2 uGrabRes;
uniform float uHasGrab;
uniform float uPower;
varying vec3 vN;
varying vec3 vV;
varying float vLocalY;
void main() {
  if (uHasGrab < 0.5 || uPower <= 0.001) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float fresnel = 1.0 - clamp(abs(dot(N, V)), 0.0, 1.0);
  // Strong compression warp right behind the sharp leading rim, softer spherical lens inside.
  float rimBand = smoothstep(0.32, 0.92, fresnel);
  float groundBoost = smoothstep(0.18, 0.0, vLocalY) * 0.45;
  float mask = clamp((rimBand * 0.92 + fresnel * 0.22 + groundBoost * rimBand) * uPower, 0.0, 1.0);
  if (mask <= 0.005) discard;
  vec2 uv = gl_FragCoord.xy / uGrabRes;
  vec2 shift = N.xy * (0.026 * rimBand + 0.006) * uPower;
  vec2 uvR = clamp(uv + shift * 1.12, vec2(0.001), vec2(0.999));
  vec2 uvG = clamp(uv + shift, vec2(0.001), vec2(0.999));
  vec2 uvB = clamp(uv + shift * 0.86, vec2(0.001), vec2(0.999));
  vec3 col = vec3(
    texture2D(uGrab, uvR).r,
    texture2D(uGrab, uvG).g,
    texture2D(uGrab, uvB).b
  );
  // Subtle pressure-compression brightening along the shock wall.
  col *= 1.0 + rimBand * 0.14 * uPower;
  gl_FragColor = vec4(col * mask, mask);
}
`;

// ---------------------------------------------------------------------------------------------
// Stage 2B: Sharp-edged hemispherical condensation dome (Wilson cloud / shock front)
// ---------------------------------------------------------------------------------------------

const DOME_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const DOME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPower;
uniform float uProgress;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float f = 1.0 - clamp(abs(dot(N, V)), 0.0, 1.0);
  // Crisp outer Mach edge + translucent interior vapor sheet.
  float razorEdge = smoothstep(0.66, 0.96, f);
  float rimShell = pow(f, 2.35);
  // Turbulent condensed atmospheric mist streaks stretched radially over the dome.
  float vapor = mbFbm(vLocal * 5.2 + vec3(0.0, -uTime * 2.4, uProgress * 3.0));
  float mistMod = mix(0.65, 1.32, smoothstep(0.28, 0.72, vapor));
  // Bright Mach-stem ground contact band where the wave shears dust off the floor.
  float groundCollar = smoothstep(0.16, 0.0, vLocal.y) * smoothstep(0.0, 0.03, vLocal.y + 0.02);
  float opacity = clamp((rimShell * 0.58 + razorEdge * 0.78 + groundCollar * 0.42) * mistMod * uPower, 0.0, 0.94);
  if (opacity <= 0.004) discard;
  vec3 iceVapor = vec3(0.90, 0.96, 1.0) * (1.25 + razorEdge * 1.9);
  vec3 warmShear = vec3(1.0, 0.80, 0.52) * (1.5 + razorEdge * 1.4);
  vec3 col = mix(iceVapor, warmShear, clamp(groundCollar * 0.85 + (1.0 - uProgress) * 0.35, 0.0, 1.0));
  // Thin HDR highlight along the sharpest outer rim so bloom catches the leading edge cleanly.
  col += vec3(0.95, 0.98, 1.0) * pow(f, 6.0) * 2.8 * uPower;
  gl_FragColor = vec4(col, opacity);
}
`;

// ---------------------------------------------------------------------------------------------
// Stage 3: Ground-hugging rolling dust & debris torus
// ---------------------------------------------------------------------------------------------

const TORUS_VERT = /* glsl */ `
uniform float uTime;
uniform float uRoll;
uniform float uPuff;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying float vLump;
varying float vInner;
${NOISE_GLSL}
void main() {
  // Torus lies in XZ plane (rotated -PI/2 on X in geometry setup).
  float ang = atan(position.z, position.x);
  vec3 q = vec3(cos(ang) * 3.4, position.y * 4.2 - uRoll, sin(ang) * 3.4);
  float lump = mbFbm(q + vec3(uTime * 0.35, 0.0, -uTime * 0.25));
  vLump = lump;
  vec3 p = position + normal * (lump - 0.42) * uPuff;
  // Flatten the bottom cleanly along the ground plane.
  p.y = max(p.y, -0.02);
  vLocal = p;
  float radial = length(position.xz);
  vInner = clamp(1.15 - radial, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const TORUS_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uFireGlow;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying float vLump;
varying float vInner;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float topLight = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  float billow = smoothstep(0.24, 0.74, vLump);
  vec3 shadowDust = vec3(0.08, 0.072, 0.068);
  vec3 midDust = vec3(0.32, 0.27, 0.22);
  vec3 litDust = vec3(0.54, 0.47, 0.39);
  vec3 c = mix(shadowDust, midDust, billow * 0.7 + topLight * 0.3);
  c = mix(c, litDust, pow(topLight, 1.6) * 0.55);
  // Warm fireball light bouncing onto the inner face of the rolling dust wall early on.
  c += vec3(1.0, 0.44, 0.12) * uFireGlow * (vInner * 0.85 + 0.15) * (0.4 + 0.6 * billow);
  float edgeSoft = smoothstep(0.04, 0.46, ndv);
  float a = clamp(uAlpha * edgeSoft * mix(0.65, 1.0, billow), 0.0, 0.92);
  if (a <= 0.005) discard;
  gl_FragColor = vec4(c, a);
}
`;

// ---------------------------------------------------------------------------------------------
// Stage 4: Short, fat fireball column that rises & collapses into a dirty dark cloud (NO stem/mushroom!)
// ---------------------------------------------------------------------------------------------

const COLUMN_VERT = /* glsl */ `
uniform float uTime;
uniform float uBoil;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vV;
varying float vLump;
${NOISE_GLSL}
void main() {
  vec3 p = position;
  // Churning thermal convection rolling upward and outward across the squat mound.
  vec3 q = p * 2.35 + vec3(0.0, -uTime * 1.45, 0.0);
  float lump = mbFbm(q);
  vLump = lump;
  float basePin = smoothstep(0.0, 0.14, p.y);
  p += normal * (lump - 0.44) * uBoil * basePin;
  p.y = max(p.y, 0.0);
  vLocal = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const COLUMN_FRAG = /* glsl */ `
uniform float uHeat;
uniform float uFade;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vV;
varying float vLump;
float mbBayer(vec2 p) {
  vec2 i = mod(floor(p), 4.0);
  float v = mod(i.x * 2.0 + i.y * 3.0, 4.0)
          + mod(i.x + i.y * 2.0, 2.0) * 4.0
          + mod(i.x * 3.0 + i.y, 3.0) * 2.0;
  return fract(v / 11.0);
}
void main() {
  if (uFade < 1.0 && mbBayer(gl_FragCoord.xy) > uFade) discard;
  float h = clamp(vLocal.y, 0.0, 1.0);
  float crease = smoothstep(0.30, 0.68, vLump);
  // Incandescent yellow-white core cools through hot orange and deep ember into dirty charcoal soot.
  vec3 whiteHot = vec3(1.0, 0.93, 0.72) * 8.5;
  vec3 orangeFire = vec3(1.0, 0.36, 0.05) * 4.8;
  vec3 ember = vec3(0.42, 0.09, 0.025) * 1.6;
  vec3 charcoal = vec3(0.055, 0.048, 0.050);
  vec3 dirtyCrown = vec3(0.14, 0.13, 0.13);

  float cool = clamp(1.0 - uHeat, 0.0, 1.0);
  vec3 fire = mix(whiteHot, orangeFire, smoothstep(0.0, 0.34, cool));
  fire = mix(fire, ember, smoothstep(0.30, 0.78, cool));

  vec3 smoke = mix(charcoal, dirtyCrown, h * 0.55 + (1.0 - crease) * 0.25);
  // Fire glows hottest in deep churning folds and near the wide lower belly; crown goes sooty first.
  float fireMask = clamp((1.0 - crease) * (1.0 - cool * 0.85) * (1.15 - h * 0.55) + uHeat * 0.42 * (1.0 - h * 0.4), 0.0, 1.0);
  vec3 c = mix(smoke, fire, fireMask);
  float rim = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2);
  c += vec3(0.95, 0.38, 0.10) * rim * (0.55 * uHeat + 0.03);
  gl_FragColor = vec4(c, 1.0);
}
`;

function createSquatColumnGeometry(): THREE.BufferGeometry {
  // Short, fat, wide-based fireball mound — NO narrow stem, NO mushroom umbrella!
  const profile: readonly [number, number][] = [
    [1.02, 0.0],
    [1.14, 0.12],
    [1.18, 0.28],
    [1.12, 0.46],
    [1.00, 0.64],
    [0.82, 0.80],
    [0.54, 0.93],
    [0.22, 1.00],
    [0.0, 1.02],
  ];
  const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
  const curve = new THREE.SplineCurve(pts);
  const geo = new THREE.LatheGeometry(curve.getPoints(28), 32);
  geo.computeVertexNormals();
  return geo;
}

interface VisualRig {
  active: boolean;
  readonly flashMesh: THREE.Mesh;
  readonly flashMat: THREE.ShaderMaterial;
  readonly refractMesh: THREE.Mesh;
  readonly refractMat: THREE.ShaderMaterial;
  readonly domeMesh: THREE.Mesh;
  readonly domeMat: THREE.ShaderMaterial;
  readonly torusMesh: THREE.Mesh;
  readonly torusMat: THREE.ShaderMaterial;
  readonly columnMesh: THREE.Mesh;
  readonly columnMat: THREE.ShaderMaterial;
}

export interface MegaBlastVisualFrame {
  readonly age: number;
  readonly scale: number;
  readonly waveRadius: number;
  readonly maxWaveRadius: number;
  readonly waveEndTime: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly floorY: number;
}

/**
 * Pooled visual rigs for up to `cap` simultaneous mega-blasts.
 * Shares all 4 geometries and a single `FramebufferTexture` across all slots so co-op bursts
 * allocate zero GPU resources mid-fight.
 */
export class MegaBlastVisualPool {
  private readonly rigs: VisualRig[] = [];
  private readonly flashGeo: THREE.BufferGeometry;
  private readonly domeGeo: THREE.BufferGeometry;
  private readonly torusGeo: THREE.BufferGeometry;
  private readonly columnGeo: THREE.BufferGeometry;
  private grab: THREE.FramebufferTexture | null = null;
  private readonly grabRes = new THREE.Vector2(1, 1);
  private lastGrabFrame = -1;
  private disposed = false;

  constructor(private readonly scene: THREE.Scene | null, cap: number) {
    this.flashGeo = new THREE.SphereGeometry(1, 24, 16);
    // Slightly below equator so the hemispherical pressure wave bites cleanly into uneven ground.
    this.domeGeo = new THREE.SphereGeometry(1, 56, 28, 0, TAU, 0, Math.PI * 0.54);
    this.torusGeo = new THREE.TorusGeometry(1.0, 0.25, 16, 44);
    this.torusGeo.rotateX(Math.PI / 2);
    this.columnGeo = createSquatColumnGeometry();

    for (let i = 0; i < cap; i++) {
      const flashMat = new THREE.ShaderMaterial({
        vertexShader: FLASH_VERT,
        fragmentShader: FLASH_FRAG,
        uniforms: { uPower: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        toneMapped: false,
        fog: false,
      });
      const flashMesh = new THREE.Mesh(this.flashGeo, flashMat);
      flashMesh.frustumCulled = false;
      flashMesh.visible = false;
      flashMesh.renderOrder = ORDER.flashes;
      flashMesh.name = `fx.megaBlast.flash.${i}`;

      const refractMat = new THREE.ShaderMaterial({
        vertexShader: REFRACT_VERT,
        fragmentShader: REFRACT_FRAG,
        uniforms: {
          uGrab: { value: null },
          uGrabRes: { value: this.grabRes },
          uHasGrab: { value: 0 },
          uPower: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        toneMapped: false,
        fog: false,
      });
      const refractMesh = new THREE.Mesh(this.domeGeo, refractMat);
      refractMesh.frustumCulled = false;
      refractMesh.visible = false;
      refractMesh.renderOrder = ORDER.shimmer;
      refractMesh.name = `fx.megaBlast.refract.${i}`;
      refractMesh.onBeforeRender = this.onBeforeRenderRefract;

      const domeMat = new THREE.ShaderMaterial({
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPower: { value: 0 },
          uProgress: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      });
      const domeMesh = new THREE.Mesh(this.domeGeo, domeMat);
      domeMesh.frustumCulled = false;
      domeMesh.visible = false;
      domeMesh.renderOrder = ORDER.shimmer + 1;
      domeMesh.name = `fx.megaBlast.dome.${i}`;

      const torusMat = new THREE.ShaderMaterial({
        vertexShader: TORUS_VERT,
        fragmentShader: TORUS_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uRoll: { value: 0 },
          uPuff: { value: 0.24 },
          uAlpha: { value: 0 },
          uFireGlow: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        toneMapped: false,
        fog: false,
      });
      const torusMesh = new THREE.Mesh(this.torusGeo, torusMat);
      torusMesh.frustumCulled = false;
      torusMesh.visible = false;
      torusMesh.renderOrder = ORDER.smoke + 2;
      torusMesh.name = `fx.megaBlast.torus.${i}`;

      const columnMat = new THREE.ShaderMaterial({
        vertexShader: COLUMN_VERT,
        fragmentShader: COLUMN_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uBoil: { value: 0.28 },
          uHeat: { value: 1 },
          uFade: { value: 1 },
        },
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      });
      const columnMesh = new THREE.Mesh(this.columnGeo, columnMat);
      columnMesh.frustumCulled = false;
      columnMesh.visible = false;
      columnMesh.renderOrder = ORDER.smoke + 1;
      columnMesh.name = `fx.megaBlast.column.${i}`;

      if (scene) {
        scene.add(flashMesh, refractMesh, domeMesh, torusMesh, columnMesh);
      }

      this.rigs.push({
        active: false,
        flashMesh,
        flashMat,
        refractMesh,
        refractMat,
        domeMesh,
        domeMat,
        torusMesh,
        torusMat,
        columnMesh,
        columnMat,
      });
    }
  }

  private readonly onBeforeRenderRefract = (renderer: THREE.WebGLRenderer): void => {
    if (this.disposed || typeof renderer.copyFramebufferToTexture !== 'function') return;
    const frame = renderer.info?.render?.frame ?? -1;
    const rt = renderer.getRenderTarget();
    const w = rt ? rt.width : renderer.domElement?.width ?? 0;
    const h = rt ? rt.height : renderer.domElement?.height ?? 0;
    if (w <= 0 || h <= 0) return;

    if (!this.grab || this.grab.image.width !== w || this.grab.image.height !== h) {
      this.grab?.dispose();
      const tex = new THREE.FramebufferTexture(w, h);
      // Matches Renderer.hdrTarget half-float format; safe fallback on LDR targets too.
      tex.type = rt ? THREE.HalfFloatType : THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.grab = tex;
      this.grabRes.set(w, h);
      for (let i = 0; i < this.rigs.length; i++) {
        this.rigs[i]!.refractMat.uniforms.uGrab!.value = tex;
      }
    }

    if (frame !== this.lastGrabFrame || frame < 0) {
      this.lastGrabFrame = frame;
      renderer.copyFramebufferToTexture(this.grab);
    }
    for (let i = 0; i < this.rigs.length; i++) {
      this.rigs[i]!.refractMat.uniforms.uHasGrab!.value = 1;
    }
  };

  /** Updates all four stage meshes for slot `slotIndex` without allocating. */
  syncSlot(slotIndex: number, f: MegaBlastVisualFrame): void {
    const rig = this.rigs[slotIndex];
    if (!rig) return;
    rig.active = true;
    const t = f.age;
    const s = f.scale;
    const cx = f.centerX;
    const cy = f.centerY;
    const cz = f.centerZ;
    const floorY = f.floorY;

    // --- Stage 1 (t = 0.0..0.20 s): Flash core (crisp bloom, NO white-out) ---
    if (t >= 0 && t < 0.22) {
      const k = t / 0.22;
      const r = lerp(2.2, 16.5, 1 - (1 - k) * (1 - k)) * s;
      const power = (1 - k) * (1 - k);
      rig.flashMesh.visible = power > 0.01;
      rig.flashMesh.position.set(cx, Math.max(cy, floorY + 1.5 * s), cz);
      rig.flashMesh.scale.set(r, r * 0.85, r);
      rig.flashMat.uniforms.uPower!.value = power;
    } else {
      rig.flashMesh.visible = false;
    }

    // --- Stage 2 (t = 0.02..waveEnd): Visible sharp-edged condensation dome + refraction ---
    const domeEnd = f.waveEndTime + 0.08;
    if (t >= 0.01 && t < domeEnd) {
      const progress = clamp(f.waveRadius / Math.max(f.maxWaveRadius, 1), 0, 1);
      const fadeIn = smoothstep(0.01, 0.06, t);
      const fadeOut = 1 - smoothstep(f.waveEndTime * 0.68, domeEnd, t);
      const power = fadeIn * fadeOut;
      const r = Math.max(2.5 * s, f.waveRadius);
      // Slightly squat hemisphere (0.82 height) so it reads wide and forceful from 60-150 m.
      const domeY = floorY - 0.35 * s;
      const h = r * 0.82;

      rig.refractMesh.visible = power > 0.015;
      rig.refractMesh.position.set(cx, domeY, cz);
      rig.refractMesh.scale.set(r * 0.992, h * 0.992, r * 0.992);
      rig.refractMat.uniforms.uPower!.value = power * 0.9;

      rig.domeMesh.visible = power > 0.01;
      rig.domeMesh.position.set(cx, domeY, cz);
      rig.domeMesh.scale.set(r, h, r);
      rig.domeMat.uniforms.uTime!.value = t;
      rig.domeMat.uniforms.uPower!.value = power;
      rig.domeMat.uniforms.uProgress!.value = progress;
    } else {
      rig.refractMesh.visible = false;
      rig.domeMesh.visible = false;
    }

    // --- Stage 3 (t = 0.08..2.60 s): Ground-hugging dust & debris torus rolling outward ---
    const torusStart = 0.06;
    const torusEnd = 2.65;
    if (t >= torusStart && t < torusEnd) {
      const lt = t - torusStart;
      const span = torusEnd - torusStart;
      const k = clamp(lt / span, 0, 1);
      // Fast surge right behind the condensation dome, decelerating as it rolls out to ~56 m * scale.
      const radius = (4.5 + 52.0 * (1 - Math.exp(-lt * 1.55))) * s;
      const height = (2.8 + 4.4 * Math.sin(clamp(k * 1.4, 0, 1) * Math.PI * 0.5) * (1 - k * 0.35)) * s;
      const alpha = smoothstep(0, 0.14, lt) * (1 - smoothstep(0.55, 1.0, k)) * 0.88;
      rig.torusMesh.visible = alpha > 0.01;
      rig.torusMesh.position.set(cx, floorY + 0.4 * s, cz);
      rig.torusMesh.scale.set(radius, height, radius);
      rig.torusMat.uniforms.uTime!.value = t;
      rig.torusMat.uniforms.uRoll!.value = lt * 3.2;
      rig.torusMat.uniforms.uPuff!.value = 0.22 + k * 0.16;
      rig.torusMat.uniforms.uAlpha!.value = alpha;
      rig.torusMat.uniforms.uFireGlow!.value = Math.exp(-lt * 2.2);
    } else {
      rig.torusMesh.visible = false;
    }

    // --- Stage 4 (t = 0.05..3.80 s): Short, fat fireball column -> collapses into dirty dark cloud ---
    const colStart = 0.04;
    const colEnd = 3.82;
    if (t >= colStart && t < colEnd) {
      const lt = t - colStart;
      const k = clamp(lt / (colEnd - colStart), 0, 1);
      // Rapid initial eruption (0..0.75 s), brief hold, then gravitational collapse/slump (1.6..3.8 s).
      const erupt = 1 - Math.exp(-lt * 3.4);
      const slump = smoothstep(0.38, 1.0, k);
      const width = lerp(6.0, 23.5, erupt) * (1 + slump * 0.24) * s;
      // Short & fat: peak ~28 m * s tall vs ~24 m * s radius (~48 m wide), then slumps down to ~19 m * s!
      const height = lerp(4.0, 28.0, erupt) * (1 - slump * 0.32) * s;
      const heat = Math.exp(-lt * 0.92);
      const fade = 1 - smoothstep(0.68, 1.0, k);

      rig.columnMesh.visible = fade > 0.01;
      rig.columnMesh.position.set(cx, floorY - 0.25 * s, cz);
      rig.columnMesh.scale.set(width, height, width);
      rig.columnMesh.rotation.y = lt * 0.14;
      rig.columnMat.uniforms.uTime!.value = lt;
      rig.columnMat.uniforms.uBoil!.value = 0.22 + 0.16 * (1 - k * 0.4);
      rig.columnMat.uniforms.uHeat!.value = heat;
      rig.columnMat.uniforms.uFade!.value = fade;
    } else {
      rig.columnMesh.visible = false;
    }
  }

  hideSlot(slotIndex: number): void {
    const rig = this.rigs[slotIndex];
    if (!rig) return;
    rig.active = false;
    rig.flashMesh.visible = false;
    rig.refractMesh.visible = false;
    rig.domeMesh.visible = false;
    rig.torusMesh.visible = false;
    rig.columnMesh.visible = false;
  }

  hideAll(): void {
    for (let i = 0; i < this.rigs.length; i++) this.hideSlot(i);
  }

  /** Diagnostic count of currently visible meshes across all pooled rigs (0 when idle). */
  visibleMeshCount(): number {
    let n = 0;
    for (let i = 0; i < this.rigs.length; i++) {
      const r = this.rigs[i]!;
      if (r.flashMesh.visible) n++;
      if (r.refractMesh.visible) n++;
      if (r.domeMesh.visible) n++;
      if (r.torusMesh.visible) n++;
      if (r.columnMesh.visible) n++;
    }
    return n;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = 0; i < this.rigs.length; i++) {
      const r = this.rigs[i]!;
      if (this.scene) {
        this.scene.remove(r.flashMesh, r.refractMesh, r.domeMesh, r.torusMesh, r.columnMesh);
      }
      r.flashMat.dispose();
      r.refractMat.dispose();
      r.domeMat.dispose();
      r.torusMat.dispose();
      r.columnMat.dispose();
    }
    this.flashGeo.dispose();
    this.domeGeo.dispose();
    this.torusGeo.dispose();
    this.columnGeo.dispose();
    this.grab?.dispose();
    this.grab = null;
  }
}
