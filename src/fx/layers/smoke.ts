import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG, SOFT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { quad } from '../gpu/shapes';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * Everything soft: smoke, dust, mist and fire, in one draw call through premultiplied blending.
 * Spawn order is the sort order, so a recipe layers by emitting back to front.
 *
 * These do not fade. Each sprite thresholds the atlas density and the threshold climbs with age, so
 * a puff is eaten away from its outline inward. That keeps a hard silhouette on a soft class and is
 * the same "exit by shrinking" the chips do. A low `soft` gives flat cel-shaded fire, a high one mist.
 *
 *   aP  origin xyz, birth      aV  velocity xyz, life
 *   aC  HDR colour rgb, alpha  aF  start size, end size, drag, buoyancy
 *   aR  rotation, spin, edge softness, mode (see SmokeMode)
 */
const ATTRS = ['aP', 'aV', 'aC', 'aF', 'aR'] as const;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aF;
attribute vec4 aR;
varying vec4 vColor;
varying vec2 vUv;
varying vec2 vCell;
varying vec2 vRot;
varying vec3 vErode;
varying float vViewZ;
${COMMON_VERT}

void main() {
  float age = uTime - aP.w;
  float life = aV.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  vec3 vel;
  vec3 pos = dragged(aP.xyz, aV.xyz, vec3(0.0, aF.w, 0.0), aF.z, age, vel);

  // Fast at first, then settled: no attack time, the sprite is already big on frame one.
  float inv = 1.0 - k;
  float size = mix(aF.x, aF.y, 1.0 - inv * inv * inv);

  float rot = aR.x + aR.y * age;
  float c = cos(rot), s = sin(rot);
  vec2 corner = position.xy;
  vec2 q = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * size;

  if (aR.w > 2.5) {
    // Fast fire pulls into tongues along its motion instead of flying as round balls.
    vec3 moving = mat3(viewMatrix) * vel;
    float across = length(moving.xy);
    if (across > 1.0) {
      vec2 along = moving.xy / across;
      q += along * dot(q, along) * min(across * 0.07, 1.3);
    }
  }

  vec4 view = viewMatrix * vec4(pos, 1.0);
  view.xy += q;
  vViewZ = view.z;
  gl_Position = projectionMatrix * view;

  // Fire takes the torn row of the atlas, everything else the billows.
  float column = floor(hash11(float(gl_InstanceID) * 0.73 + aP.w) * 2.0);
  vCell = vec2(column, aR.w > 2.5 ? 1.0 : 0.0) * 0.5;
  vUv = (corner * 0.5 + 0.5);
  vRot = vec2(c, s);
  // Eases in slowly so the body holds, then collapses at the end of life.
  vErode = vec3(mix(0.03, 1.0, k * k * (0.45 + 0.55 * k)), aR.z, aR.w);
  // Slight per-sprite value shift, so overlapping lobes separate instead of merging into one cut-out.
  float vary = aR.w > 2.5 ? 0.9 + 0.2 * hash11(float(gl_InstanceID) * 1.31) : 1.0;
  // Fades as the camera enters it: smoke must never turn into a grey screen over the player's eyes.
  float near = clamp((-view.z - 0.4) / 1.6, 0.0, 1.0);
  vColor = vec4(applyFog(aC.rgb * vary, -view.z), aC.a * near);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec4 vColor;
varying vec2 vUv;
varying vec2 vCell;
varying vec2 vRot;
varying vec3 vErode;
varying float vViewZ;
${SOFT_FRAG}

void main() {
  // Half a texel inset keeps the bilinear footprint inside the cell.
  vec2 uv = vCell + (0.004 + vUv * 0.492);
  vec4 t = texture2D(uAtlas, uv);
  float density = t.r + (t.a - 0.5) * 0.1 * (1.0 - t.r);
  float thr = vErode.x;
  float soft = vErode.y;
  float a = smoothstep(thr, thr + soft, density);
  // A glow is the one round thing here. A billow outline would read as a dull red cloud.
  if (vErode.z > 1.5 && vErode.z < 2.5) {
    float r = max(1.0 - length(vUv * 2.0 - 1.0), 0.0);
    a = r * r * (1.0 - thr);
  }
  if (a <= 0.004) discard;

  vec3 col = vColor.rgb;
  if (vErode.z < 0.5) {
    vec2 slope = (t.gb - 0.5) * 2.0;
    vec2 world = vec2(slope.x * vRot.x - slope.y * vRot.y, slope.x * vRot.y + slope.y * vRot.x);
    // Cold overhead light on the billows, so the smoke keeps volume without any colour shift.
    float lit = clamp(0.8 - world.y * 1.05 + world.x * 0.3, 0.42, 1.5);
    col *= lit;
  } else if (vErode.z > 2.5) {
    // Cel-painted heat: each lobe has flat bands that step toward yellow at its core. The bands are
    // in space, not time, so this is still no colour over life, and the core is what drives the bloom.
    float aa = fwidth(density) * 1.2 + 0.004;
    float band1 = smoothstep(thr + 0.2 - aa, thr + 0.2 + aa, density);
    float band2 = smoothstep(thr + 0.46 - aa, thr + 0.46 + aa, density);
    float top = max(col.r, col.b);
    col.g = min(col.g + abs(col.r - col.b) * (0.22 * band1 + 0.5 * band2), top * 0.85);
    col *= 1.0 + 0.55 * band2;
  }

  a *= vColor.a * softFade(vViewZ, 0.5);
  gl_FragColor = vec4(col * a, vErode.z > 1.5 && vErode.z < 2.5 ? 0.0 : a);
  ${OUTPUT_FRAG}
}
`;

export enum SmokeMode {
  /** Billows lit from above. Smoke and dust. */
  Lit = 0,
  /** One unlit colour. Mist. */
  Flat = 1,
  /** Additive. Hand-made bloom that stays saturated. */
  Glow = 2,
  /** Torn outline with hot cel bands. Everything that burns. */
  Fire = 3,
}

export class SmokeLayer {
  readonly ring: InstanceRing;
  readonly material: THREE.ShaderMaterial;

  private birth = 0;
  private life = 1;
  private cr = 0.1;
  private cg = 0.1;
  private cb = 0.1;
  private ca = 1;
  private s0 = 1;
  private s1 = 2;
  private drag = 1;
  private buoyancy = 0;
  private soft = 0.08;
  private mode = 0;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, atlas: THREE.Texture, cap = 2000) {
    this.ring = new InstanceRing(quad(), cap, ATTRS);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...uniforms, uAtlas: { value: atlas } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(this.ring.geometry, this.material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = ORDER.smoke;
    mesh.name = 'fx.smoke';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  /** Called once the renderer publishes a depth texture. */
  enableSoftDepth(): void {
    if (this.material.defines!.SOFT_DEPTH) return;
    this.material.defines!.SOFT_DEPTH = 1;
    this.material.needsUpdate = true;
  }

  begin(
    color: Rgb, alpha: number, birth: number, life: number, size0: number, size1: number,
    drag: number, buoyancy: number, soft: number, mode: SmokeMode,
  ): this {
    this.cr = color.r;
    this.cg = color.g;
    this.cb = color.b;
    this.ca = alpha;
    this.birth = birth;
    this.life = life;
    this.s0 = size0;
    this.s1 = size1;
    this.drag = drag;
    this.buoyancy = buoyancy;
    this.soft = soft;
    this.mode = mode;
    return this;
  }

  setLife(life: number): void {
    this.life = life;
  }

  setSize(size0: number, size1: number): void {
    this.s0 = size0;
    this.s1 = size1;
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, spin = 0): void {
    const ring = this.ring;
    const d = ring.data;
    const o = ring.alloc(this.birth + this.life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = this.birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = this.life;
    d[o + 8] = this.cr;
    d[o + 9] = this.cg;
    d[o + 10] = this.cb;
    d[o + 11] = this.ca;
    d[o + 12] = this.s0;
    d[o + 13] = this.s1;
    d[o + 14] = this.drag;
    d[o + 15] = this.buoyancy;
    d[o + 16] = Math.random() * 6.2832;
    d[o + 17] = spin;
    d[o + 18] = this.soft;
    d[o + 19] = this.mode;
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
