import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * Sword trails. A crescent on the swing plane: its head wipes through the arc fast, its tail chases
 * it, and the blade's outer edge stays a hot hairline while the sheet behind it is thin colour.
 *
 *   aP  centre xyz, birth      aU  start direction * radius xyz, life
 *   aV  in-plane perpendicular * radius xyz, arc radians
 *   aC  HDR colour rgb, width as a fraction of radius
 *   aS  sheet opacity, wipe fraction of life, edge gain, unused
 */
const ATTRS = ['aP', 'aU', 'aV', 'aC', 'aS'] as const;
const STATIONS = 32;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aU;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aS;
varying vec3 vColor;
varying vec2 vUv;
varying vec2 vSheet;
${COMMON_VERT}

void main() {
  float age = uTime - aP.w;
  float life = aU.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  float head = min(k / aS.y, 1.0);
  head = 1.0 - (1.0 - head) * (1.0 - head);
  float tail = clamp((k - aS.y * 0.5) / (1.0 - aS.y * 0.5), 0.0, 1.0);
  tail = tail * tail;

  // position.y spans the visible part of the arc, so every station is used at every moment.
  float t = mix(tail, head, position.y);
  float env = sin(position.y * 3.14159265);
  env = pow(max(env, 0.0), 0.6);
  float a = t * aV.w;
  float radial = 1.0 - position.x * aC.w * env * (1.0 - k * 0.4);
  vec3 world = aP.xyz + (aU.xyz * cos(a) + aV.xyz * sin(a)) * radial;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vColor = aC.rgb;
  vUv = vec2(position.x, position.y);
  vSheet = vec2(aS.x * (1.0 - k), aS.z);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying vec2 vUv;
varying vec2 vSheet;
void main() {
  float aa = fwidth(vUv.x) * 1.5;
  float edge = 1.0 - smoothstep(0.05, 0.05 + aa + 0.03, vUv.x);
  float sheet = pow(1.0 - vUv.x, 2.0) * vSheet.x;
  vec3 col = vColor * sheet + vec3(vSheet.y) * edge;
  gl_FragColor = vec4(col, 0.0);
  ${OUTPUT_FRAG}
}
`;

function strip(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    pos.push(0, t, 0, 1, t, 0);
    if (i < STATIONS) {
      const b = i * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class SlashLayer {
  readonly ring: InstanceRing;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, cap = 48) {
    this.ring = new InstanceRing(strip(), cap, ATTRS);
    this.ring.lifeAt = 7;
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
    mesh.renderOrder = ORDER.slashes;
    mesh.name = 'fx.slashes';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  add(
    centre: THREE.Vector3, startDir: THREE.Vector3, perp: THREE.Vector3, radius: number, arc: number,
    color: Rgb, width: number, birth: number, life: number, sheet: number, wipe: number, edgeGain: number,
  ): void {
    const d = this.ring.data;
    const o = this.ring.alloc(birth + life);
    d[o] = centre.x;
    d[o + 1] = centre.y;
    d[o + 2] = centre.z;
    d[o + 3] = birth;
    d[o + 4] = startDir.x * radius;
    d[o + 5] = startDir.y * radius;
    d[o + 6] = startDir.z * radius;
    d[o + 7] = life;
    d[o + 8] = perp.x * radius;
    d[o + 9] = perp.y * radius;
    d[o + 10] = perp.z * radius;
    d[o + 11] = arc;
    d[o + 12] = color.r;
    d[o + 13] = color.g;
    d[o + 14] = color.b;
    d[o + 15] = width;
    d[o + 16] = sheet;
    d[o + 17] = wipe;
    d[o + 18] = edgeGain;
    d[o + 19] = 0;
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
