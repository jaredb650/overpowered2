import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * Thin solid annuli. The first game's 30mm pulses are octagons that accelerate outward and tint
 * toward white in their last frames; the round variant is for ground shock fronts and pads.
 *
 *   aP  centre xyz, birth    aN  normal xyz, life
 *   aC  HDR colour rgb, alpha
 *   aS  final radius, band (fraction of radius), curve (0 original accelerating, 1 ease-out), white tint
 */
const ATTRS = ['aP', 'aN', 'aC', 'aS'] as const;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aN;
attribute vec4 aC;
attribute vec4 aS;
varying vec3 vColor;
${COMMON_VERT}

void main() {
  float age = uTime - aP.w;
  float life = aN.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  float accel = pow(1.0 + k * 25.0, 1.5) / 132.6;
  float inv = 1.0 - k;
  float ease = 1.0 - inv * inv * inv;
  float r = aS.x * mix(accel, ease, aS.z);

  vec3 n = aN.xyz;
  vec3 ref = abs(n.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(ref, n));
  vec3 v = cross(n, u);

  float depth = max(-(viewMatrix * vec4(aP.xyz, 1.0)).z, 0.05);
  float band = max(r * aS.y, uPixelWorld * depth * 1.3);
  // position.xy is the unit direction, position.z is 0 for the outer edge and 1 for the inner.
  float radius = r - band * position.z;
  vec3 world = aP.xyz + (u * position.x + v * position.y) * radius;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

  // Holds full strength for 80% of life, then pops off, as the original did.
  float fade = clamp((1.0 - k) / 0.2, 0.0, 1.0);
  vec3 c = mix(aC.rgb, vec3(max(aC.r, max(aC.g, aC.b))), k * aS.w);
  vColor = c * aC.a * fade;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 0.0);
  ${OUTPUT_FRAG}
}
`;

function annulus(segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2 + Math.PI / segments;
    const x = Math.cos(a);
    const y = Math.sin(a);
    pos.push(x, y, 0, x, y, 1);
    const n = (i + 1) % segments;
    idx.push(i * 2, n * 2, i * 2 + 1, i * 2 + 1, n * 2, n * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class RingLayer {
  readonly ring: InstanceRing;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, segments: number, cap: number, name: string) {
    this.ring = new InstanceRing(annulus(segments), cap, ATTRS);
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
    mesh.renderOrder = ORDER.rings;
    mesh.name = name;
    this.ring.object = mesh;
    scene.add(mesh);
  }

  add(
    x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Rgb, alpha: number,
    birth: number, life: number, radius: number, band = 0.1, curve = 0, whiten = 1,
  ): void {
    const d = this.ring.data;
    const o = this.ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = nx;
    d[o + 5] = ny;
    d[o + 6] = nz;
    d[o + 7] = life;
    d[o + 8] = color.r;
    d[o + 9] = color.g;
    d[o + 10] = color.b;
    d[o + 11] = alpha;
    d[o + 12] = radius;
    d[o + 13] = band;
    d[o + 14] = curve;
    d[o + 15] = whiten;
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
