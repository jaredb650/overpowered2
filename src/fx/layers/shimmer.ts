import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG, SOFT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { quad } from '../gpu/shapes';
import { ORDER, type FxUniforms } from './shared';

/**
 * Screen-space distortion: rising heat and the refraction ring of a shock front. Both read the frame
 * so far from a copy taken mid-pass, right before this draw call. The copy happens in onBeforeRender,
 * which only runs while something is alive, so an idle frame pays nothing.
 *
 *   aP  centre xyz, birth     aS  radius, life, strength, kind (0 heat, 1 shock front)
 */
const ATTRS = ['aP', 'aS'] as const;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aS;
varying vec2 vUv;
varying vec4 vP;
varying float vViewZ;
${COMMON_VERT}

void main() {
  float age = uTime - aP.w;
  float life = aS.y;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  // Heat rises off what made it. A shock front grows from nothing to its radius.
  float grow = aS.w > 0.5 ? 1.0 - (1.0 - k) * (1.0 - k) : 1.0;
  vec3 centre = aP.xyz + vec3(0.0, aS.w > 0.5 ? 0.0 : aS.x * 0.35 + age * 1.5, 0.0);
  vec4 view = viewMatrix * vec4(centre, 1.0);
  view.xy += position.xy * aS.x * grow;
  vViewZ = view.z;
  gl_Position = projectionMatrix * view;
  vUv = position.xy;
  vP = vec4(k, aS.z, aS.w, aP.x * 3.1 + aP.z * 1.7);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uGrab;
uniform float uClock;
uniform vec2 uGrabRes;
varying vec2 vUv;
varying vec4 vP;
varying float vViewZ;
${SOFT_FRAG}

void main() {
  float k = vP.x;
  float r = length(vUv);
  vec2 off;
  float mask;
  if (vP.z < 0.5) {
    mask = (1.0 - smoothstep(0.35, 1.0, r)) * min((1.0 - k) * 3.0, 1.0);
    float t = uClock + vP.w;
    off = vec2(
      sin(vUv.y * 13.0 + t * 8.0) + 0.5 * sin(vUv.y * 29.0 - t * 12.0 + vUv.x * 7.0),
      sin(vUv.x * 11.0 - t * 6.5) * 0.6
    ) * 0.0035 * vP.y * mask;
  } else {
    float band = 1.0 - smoothstep(0.0, 0.2, abs(r - 0.82));
    mask = band * (1.0 - k);
    off = (vUv / max(r, 1e-3)) * 0.022 * vP.y * mask;
  }
  if (mask <= 0.003) discard;
  float m = min(mask * 4.0, 1.0) * softFade(vViewZ, 0.6);
  vec2 uv = gl_FragCoord.xy / uGrabRes;
  vec3 col = texture2D(uGrab, uv + off).rgb;
  gl_FragColor = vec4(col * m, m);
  ${OUTPUT_FRAG}
}
`;

export class ShimmerLayer {
  readonly ring: InstanceRing;
  private readonly material: THREE.ShaderMaterial;
  private grab: THREE.FramebufferTexture | null = null;

  constructor(scene: THREE.Scene, private readonly uniforms: FxUniforms, cap = 24) {
    this.ring = new InstanceRing(quad(), cap, ATTRS);
    this.ring.lifeAt = 5;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...uniforms,
        uGrab: { value: null },
        uGrabRes: { value: new THREE.Vector2(1, 1) },
        uClock: uniforms.uTime,
      },
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
    mesh.renderOrder = ORDER.shimmer;
    mesh.name = 'fx.shimmer';
    mesh.onBeforeRender = this.copyFrame;
    this.ring.object = mesh;
    scene.add(mesh);
  }

  private readonly copyFrame = (renderer: THREE.WebGLRenderer): void => {
    const res = this.uniforms.uDepthRes.value;
    if (!this.grab || this.grab.image.width !== res.x || this.grab.image.height !== res.y) {
      this.grab?.dispose();
      const t = new THREE.FramebufferTexture(res.x, res.y);
      // The HDR target is half float, and a framebuffer copy needs matching formats.
      t.type = THREE.HalfFloatType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      this.grab = t;
      this.material.uniforms.uGrab!.value = t;
      (this.material.uniforms.uGrabRes!.value as THREE.Vector2).copy(res);
    }
    renderer.copyFramebufferToTexture(this.grab);
  };

  /** Compiled in once the renderer publishes depth, so distortion stops at walls in front of it. */
  enableSoftDepth(): void {
    if (this.material.defines!.SOFT_DEPTH) return;
    this.material.defines!.SOFT_DEPTH = 1;
    this.material.needsUpdate = true;
  }

  add(x: number, y: number, z: number, radius: number, birth: number, life: number, strength: number, kind: 0 | 1): void {
    const d = this.ring.data;
    const o = this.ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = radius;
    d[o + 5] = life;
    d[o + 6] = strength;
    d[o + 7] = kind;
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
