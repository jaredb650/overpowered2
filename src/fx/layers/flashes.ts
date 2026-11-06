import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { quad } from '../gpu/shapes';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * Short hot shapes: muzzle stars, explosion cores, impact pops. A flash is a hard-edged polygon star
 * with a flat white-hot inner star, not a soft sprite, so one frame of it already reads as a shape.
 * Bloom supplies the softness around it.
 *
 *   aP  position xyz, birth         aC  HDR colour rgb, life
 *   aS  size, rotation, points (0 = disc), inner radius
 *   aD  axis xyz, axial length (0 = camera-facing; > 0 = a petal along the axis)
 *   aE  scale at end of life, white core size, core gain, seed
 */
const ATTRS = ['aP', 'aC', 'aS', 'aD', 'aE'] as const;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aC;
attribute vec4 aS;
attribute vec4 aD;
attribute vec4 aE;
varying vec3 vColor;
varying vec2 vUv;
varying vec4 vShape;
varying vec2 vCore;
${COMMON_VERT}

void main() {
  float age = uTime - aP.w;
  float life = aC.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  float s = aS.x * mix(1.0, aE.x, k);
  vec2 corner = position.xy;

  vec4 view;
  if (aD.w > 0.0) {
    vec3 axis = aD.xyz;
    vec3 toCam = normalize(cameraPosition - aP.xyz);
    vec3 side = normalize(cross(axis, toCam) + vec3(1e-4, 0.0, 0.0));
    vec3 world = aP.xyz + axis * (corner.y * 0.5 + 0.5) * aD.w * mix(1.0, aE.x, k) + side * corner.x * s;
    view = viewMatrix * vec4(world, 1.0);
  } else {
    float c = cos(aS.y), sn = sin(aS.y);
    view = viewMatrix * vec4(aP.xyz, 1.0);
    view.xy += vec2(corner.x * c - corner.y * sn, corner.x * sn + corner.y * c) * s;
  }
  gl_Position = projectionMatrix * view;
  vUv = corner;
  vColor = aC.rgb;
  vShape = vec4(aS.z, aS.w, aD.w > 0.0 ? 1.0 : 0.0, aE.w);
  vCore = aE.yz;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying vec2 vUv;
varying vec4 vShape;
varying vec2 vCore;

float hash(float n) { return fract(sin(n) * 43758.5453); }

/** Signed distance to a straight-edged star whose spike lengths vary by sector. Negative inside. */
float star(vec2 p, float n, float inner, float seed) {
  float seg = 6.2831853 / n;
  float ang = atan(p.y, p.x) + 3.14159265;
  float sector = floor(ang / seg + 0.5);
  float a = ang - sector * seg;
  float tipLen = 0.56 + 0.44 * hash(mod(sector, n) * 7.13 + seed * 31.7);
  float r = length(p);
  vec2 q = r * vec2(cos(a), abs(sin(a)));
  vec2 tip = vec2(tipLen, 0.0);
  vec2 notch = inner * vec2(cos(seg * 0.5), sin(seg * 0.5));
  vec2 e = notch - tip;
  return ((q.x - tip.x) * e.y - (q.y - tip.y) * e.x) / length(e);
}

float shape(vec2 p, float scale) {
  vec2 q = p / scale;
  float d;
  if (vShape.z > 0.5) {
    // Flame petal: fat near the root, tapering to a sharp tip.
    float y = q.y * 0.5 + 0.5;
    float half_ = sqrt(max(y, 0.0)) * (1.0 - y) * 2.1;
    d = (abs(q.x) - half_) * 0.5;
    if (y < 0.0 || y > 1.0) d = 1.0;
  } else if (vShape.x < 0.5) {
    d = length(q) - 0.98;
  } else {
    d = star(q, vShape.x, vShape.y, vShape.w);
  }
  return d * scale;
}

void main() {
  float d = shape(vUv, 1.0);
  float aa = max(fwidth(d), 1e-4);
  float a = 1.0 - smoothstep(-aa, aa * 0.5, d);
  if (a <= 0.003) discard;
  float dc = shape(vUv, max(vCore.x, 0.001));
  float ac = 1.0 - smoothstep(-aa, aa * 0.5, dc);
  vec3 col = mix(vColor, vec3(vCore.y), ac);
  gl_FragColor = vec4(col * a, 0.0);
  ${OUTPUT_FRAG}
}
`;

export interface FlashOpts {
  points?: number;
  inner?: number;
  rotation?: number;
  endScale?: number;
  core?: number;
  coreGain?: number;
  delay?: number;
}

export class FlashLayer {
  readonly ring: InstanceRing;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, cap = 256, name = 'fx.flashes') {
    this.ring = new InstanceRing(quad(), cap, ATTRS);
    this.ring.lifeAt = 7;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(this.ring.geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = ORDER.flashes;
    mesh.name = name;
    this.ring.object = mesh;
    scene.add(mesh);
  }

  /** A camera-facing star or disc. `points` 0 is a disc. */
  star(
    x: number, y: number, z: number, color: Rgb, size: number, birth: number, life: number,
    points: number, inner: number, endScale = 0.6, core = 0.5, coreGain = 8,
  ): void {
    const d = this.ring.data;
    const o = this.ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = color.r;
    d[o + 5] = color.g;
    d[o + 6] = color.b;
    d[o + 7] = life;
    d[o + 8] = size;
    d[o + 9] = Math.random() * 6.2832;
    d[o + 10] = points;
    d[o + 11] = inner;
    d[o + 12] = 0;
    d[o + 13] = 0;
    d[o + 14] = 0;
    d[o + 15] = 0;
    d[o + 16] = endScale;
    d[o + 17] = core;
    d[o + 18] = coreGain;
    d[o + 19] = Math.random();
  }

  /** A flame petal from the point along `dir`. `width` is half the root width. */
  petal(
    x: number, y: number, z: number, dx: number, dy: number, dz: number, color: Rgb, length: number,
    width: number, birth: number, life: number, endScale = 0.7, core = 0.55, coreGain = 8,
  ): void {
    const d = this.ring.data;
    const o = this.ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = color.r;
    d[o + 5] = color.g;
    d[o + 6] = color.b;
    d[o + 7] = life;
    d[o + 8] = width;
    d[o + 9] = 0;
    d[o + 10] = 0;
    d[o + 11] = 0;
    d[o + 12] = dx;
    d[o + 13] = dy;
    d[o + 14] = dz;
    d[o + 15] = length;
    d[o + 16] = endScale;
    d[o + 17] = core;
    d[o + 18] = coreGain;
    d[o + 19] = Math.random();
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
