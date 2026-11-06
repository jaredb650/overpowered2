import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import * as shapes from '../gpu/shapes';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * The first game's dotted trail: translucent, axis-aligned cubes that are never rotated. Spacing
 * between them is the look, so they stay discrete rather than being blended into a ribbon.
 *
 *   aP  origin xyz, birth      aV  velocity xyz, life
 *   aC  colour rgb, alpha      aF  size, end scale, drag, unused
 */
const ATTRS = ['aP', 'aV', 'aC', 'aF'] as const;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aF;
varying vec4 vColor;
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
  vec3 pos = dragged(aP.xyz, aV.xyz, vec3(0.0), aF.z, age, vel);
  float s = aF.x * 0.5 * mix(1.0, aF.y, k);
  vec4 view = viewMatrix * vec4(pos + position * s, 1.0);
  gl_Position = projectionMatrix * view;

  float shade = 0.82 + 0.3 * dot(normal, vec3(0.267, 0.802, 0.535));
  float a = aC.a * (1.0 - k);
  vColor = vec4(applyFog(aC.rgb * shade, -view.z) * a, a);
}
`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
  ${OUTPUT_FRAG}
}
`;

export class PuffLayer {
  readonly ring: InstanceRing;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, cap = 1500) {
    this.ring = new InstanceRing(shapes.cube(), cap, ATTRS);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(this.ring.geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = ORDER.puffs;
    mesh.name = 'fx.puffs';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  add(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    color: Rgb, alpha: number, birth: number, life: number, size: number, endScale = 2.5, drag = 1.21,
  ): void {
    const ring = this.ring;
    const d = ring.data;
    const o = ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = life;
    d[o + 8] = color.r;
    d[o + 9] = color.g;
    d[o + 10] = color.b;
    d[o + 11] = alpha;
    d[o + 12] = size;
    d[o + 13] = endScale;
    d[o + 14] = drag;
    d[o + 15] = 0;
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
