import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { quad } from '../gpu/shapes';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * Tracers and beams share one draw call: both are a hot needle between two points.
 *
 * A tracer has a head that races from A to B and a tail `len` behind it, tapered to a point. Its
 * travel is a function of age, so slow-mo slows tracers and a shot hanging in the air is real. A beam
 * spans A to B at once and leaves by narrowing.
 *
 *   aA  from xyz, birth     aB  to xyz, life
 *   aC  rim colour rgb, width
 *   aS  speed (0 = beam), length, core gain, min pixels
 */
const ATTRS = ['aA', 'aB', 'aC', 'aS'] as const;

const VERT = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute vec4 aS;
varying vec3 vColor;
varying vec3 vUv;
varying float vCore;
varying float vPixel;
${COMMON_VERT}

void main() {
  float age = uTime - aA.w;
  float life = aB.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  vec3 span = aB.xyz - aA.xyz;
  float dist = length(span);
  vec3 dir = span / max(dist, 1e-4);
  bool beam = aS.x <= 0.0;
  float head = beam ? dist : min(aS.x * age, dist);
  float tail = beam ? 0.0 : clamp(aS.x * age - aS.y, 0.0, dist);
  float width = aC.w * (beam ? 1.0 - k * k : 1.0);

  vec4 va = viewMatrix * vec4(aA.xyz + dir * tail, 1.0);
  vec4 vb = viewMatrix * vec4(aA.xyz + dir * head, 1.0);
  const float nearZ = -0.12;
  if (va.z > nearZ && vb.z > nearZ) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (va.z > nearZ) va = mix(va, vb, (nearZ - va.z) / (vb.z - va.z));
  else if (vb.z > nearZ) vb = mix(vb, va, (nearZ - vb.z) / (va.z - vb.z));
  vec4 ca = projectionMatrix * va;
  vec4 cb = projectionMatrix * vb;

  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * aspect;
  float dl = length(d);
  d = dl > 1e-6 ? d / dl : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);

  float along = position.y * 0.5 + 0.5;
  vec4 c = mix(ca, cb, along);
  float depth = c.w;
  // Thin world width holds at close range; the pixel floor keeps a far tracer legible as a line.
  float w = max(width, uPixelWorld * depth * aS.w);
  float px = w / (uPixelWorld * depth);
  // One spare pixel each side, so the tapered tail can thin out below a pixel without breaking into dashes.
  float quadPx = px + 1.0;
  c.xy += n * position.x * (quadPx * 2.0 / uRes.y) / aspect * c.w;
  gl_Position = c;

  vColor = applyFog(aC.rgb, depth);
  vUv = vec3(position.x * quadPx / px, along, beam ? 0.0 : 1.0);
  vCore = aS.z;
  vPixel = 1.0 / px;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying vec3 vUv;
varying float vCore;
varying float vPixel;
void main() {
  // Tracers: a point at the tail widening to the head. Beams: constant with pinched ends.
  float taper = mix(smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.97, vUv.y), pow(vUv.y, 1.3), vUv.z);
  float x = abs(vUv.x);
  // Below a pixel wide a line loses brightness, not coverage.
  float edge = max(taper, vPixel * 0.6);
  float a = (1.0 - smoothstep(edge - vPixel * 0.5, edge + vPixel * 0.5, x)) * min(taper / (vPixel * 0.6), 1.0);
  if (a <= 0.003) discard;
  float core = 1.0 - smoothstep(taper * 0.26, taper * 0.5, x);
  vec3 col = mix(vColor, vec3(vCore), core);
  gl_FragColor = vec4(col * a, 0.0);
  ${OUTPUT_FRAG}
}
`;

export class LineLayer {
  readonly ring: InstanceRing;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, cap = 512) {
    this.ring = new InstanceRing(quad(), cap, ATTRS);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(this.ring.geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = ORDER.tracers;
    mesh.name = 'fx.lines';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  private write(
    from: THREE.Vector3, to: THREE.Vector3, color: Rgb, width: number, birth: number, life: number,
    speed: number, length: number, coreGain: number, minPx: number,
  ): void {
    const d = this.ring.data;
    const o = this.ring.alloc(birth + life);
    d[o] = from.x;
    d[o + 1] = from.y;
    d[o + 2] = from.z;
    d[o + 3] = birth;
    d[o + 4] = to.x;
    d[o + 5] = to.y;
    d[o + 6] = to.z;
    d[o + 7] = life;
    d[o + 8] = color.r;
    d[o + 9] = color.g;
    d[o + 10] = color.b;
    d[o + 11] = width;
    d[o + 12] = speed;
    d[o + 13] = length;
    d[o + 14] = coreGain;
    d[o + 15] = minPx;
  }

  tracer(
    from: THREE.Vector3, to: THREE.Vector3, color: Rgb, width: number, birth: number,
    speed: number, length: number, coreGain: number, minPx = 1.3,
  ): void {
    const dist = from.distanceTo(to);
    this.write(from, to, color, width, birth, (dist + length) / speed, speed, length, coreGain, minPx);
  }

  beam(
    from: THREE.Vector3, to: THREE.Vector3, color: Rgb, width: number, birth: number, life: number,
    coreGain: number, minPx = 1.5,
  ): void {
    this.write(from, to, color, width, birth, life, 0, 0, coreGain, minPx);
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
