import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * The wireframe shock sphere: the first game's only real wireframe and its "something passed through
 * you" beat. Lines are drawn as screen-space quads so they stay about one CSS pixel at any pixel
 * ratio, which GL lines cannot do, and every edge of a 16x8 sphere is kept.
 *
 *   aP  centre xyz, birth    aC  HDR colour rgb, life
 *   aS  start radius, end radius, opacity, how far along the fade curve life ends
 */
const ATTRS = ['aP', 'aC', 'aS'] as const;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aC;
attribute vec4 aS;
attribute vec3 aEdgeB;
attribute vec2 aSide;
varying vec3 vColor;
varying float vX;
uniform float uLinePx;
${COMMON_VERT}

void main() {
  float age = uTime - aP.w;
  float life = aC.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  float r = mix(aS.x, aS.y, k);
  vec4 va = viewMatrix * vec4(aP.xyz + position * r, 1.0);
  vec4 vb = viewMatrix * vec4(aP.xyz + aEdgeB * r, 1.0);

  // From inside the sphere, edges cross the near plane. Clip them in view space before the divide.
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
  vec4 c = mix(ca, cb, aSide.x);
  c.xy += n * aSide.y * (uLinePx / uRes.y) / aspect * c.w * 2.0;
  gl_Position = c;

  float q = aS.w * k;
  vColor = aC.rgb * aS.z * (1.0 - q * q);
  vX = aSide.y;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vX;
void main() {
  float a = 1.0 - smoothstep(0.45, 1.0, abs(vX));
  gl_FragColor = vec4(vColor * a, 0.0);
  ${OUTPUT_FRAG}
}
`;

function wireSphere(): THREE.BufferGeometry {
  const wire = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 16, 8));
  const src = wire.getAttribute('position');
  const seen = new Set<string>();
  const a: number[] = [];
  const b: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  const key = (i: number) => `${src.getX(i).toFixed(3)},${src.getY(i).toFixed(3)},${src.getZ(i).toFixed(3)}`;
  for (let i = 0; i < src.count; i += 2) {
    const ka = key(i);
    const kb = key(i + 1);
    if (ka === kb) continue;
    const id = ka < kb ? ka + kb : kb + ka;
    if (seen.has(id)) continue;
    seen.add(id);
    const base = a.length / 3;
    for (const [end, s] of [[0, -1], [0, 1], [1, 1], [1, -1]] as const) {
      a.push(src.getX(i), src.getY(i), src.getZ(i));
      b.push(src.getX(i + 1), src.getY(i + 1), src.getZ(i + 1));
      side.push(end, s);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
  g.setAttribute('aEdgeB', new THREE.Float32BufferAttribute(b, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 2));
  g.setIndex(idx);
  return g;
}

export class ShockLayer {
  readonly ring: InstanceRing;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, cap = 24) {
    this.ring = new InstanceRing(wireSphere(), cap, ATTRS);
    this.ring.lifeAt = 7;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...uniforms, uLinePx: { value: 1.5 } },
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
    mesh.renderOrder = ORDER.shock;
    mesh.name = 'fx.shock';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  add(
    x: number, y: number, z: number, color: Rgb, birth: number, life: number,
    r0: number, r1: number, opacity: number, fadeEnd: number,
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
    d[o + 8] = r0;
    d[o + 9] = r1;
    d[o + 10] = opacity;
    d[o + 11] = fadeEnd;
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
