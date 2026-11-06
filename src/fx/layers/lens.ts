import * as THREE from 'three';
import { OUTPUT_FRAG } from '../gpu/glsl';
import { quad } from '../gpu/shapes';
import { rand } from '../../core/math';

/**
 * Blood on the lens after a point-blank kill. Drawn straight in clip space inside the view scene, so it
 * rides with the camera and costs nothing until something triggers it. Kept small and to the edges
 * of the view on purpose: this is a seasoning, and it must never block the crosshair. It runs on real
 * time so SLOWMO does not leave the screen dirty for four times as long.
 */
const CAP = 32;
const STRIDE = 8;

const VERT = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
varying vec2 vUv;
varying vec2 vCell;
varying float vErode;
uniform float uClock;
uniform float uAspect;

float hash11(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  float age = uClock - aA.w;
  float life = aB.x;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  vec2 c = aA.xy;
  // Sticks for a moment, then the heavy drops creep down the glass.
  c.y -= aB.y * max(age - 0.25, 0.0) * max(age - 0.25, 0.0);
  float stretch = 1.0 + aB.y * 3.0 * k;
  vec2 q = position.xy * aA.z * vec2(1.0 / uAspect, stretch);
  gl_Position = vec4(c + q, 0.0, 1.0);
  vCell = vec2(floor(hash11(aB.z * 3.7) * 2.0) * 0.5, 0.0);
  vUv = position.xy * 0.5 + 0.5;
  vErode = mix(0.2, 0.95, k * k);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec2 vCell;
varying float vErode;
void main() {
  vec4 t = texture2D(uAtlas, vCell + 0.004 + vUv * 0.492);
  float a = smoothstep(vErode, vErode + 0.05, t.r);
  if (a <= 0.004) discard;
  vec2 slope = (t.gb - 0.5) * 2.0;
  // A wet bead: darker body, a sharp highlight where the surface tilts toward the light.
  float spec = smoothstep(0.42, 0.62, slope.y - slope.x * 0.4);
  vec3 col = vec3(0.14, 0.002, 0.005) + vec3(0.34, 0.07, 0.07) * spec;
  float alpha = a * 0.72;
  gl_FragColor = vec4(col * alpha, alpha);
  ${OUTPUT_FRAG}
}
`;

export class LensLayer {
  private readonly data = new Float32Array(CAP * STRIDE);
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private head = 0;
  private high = 0;
  private clock = 0;
  private lastDeath = -1;
  private dirty = false;

  constructor(viewScene: THREE.Scene, atlas: THREE.Texture) {
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    const base = quad();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('aA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0, false));
    g.setAttribute('aB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4, false));
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uAtlas: { value: atlas }, uClock: { value: 0 }, uAspect: { value: 16 / 9 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 100;
    this.mesh.name = 'fx.lens';
    viewScene.add(this.mesh);
  }

  /** Draws one dead record, so the first splatter does not pay for the program. See FxCore.warm. */
  warm(): void {
    this.geometry.instanceCount = 1;
    this.mesh.visible = true;
  }

  /** `amount` 0..1 sets how many drops land. */
  splatter(amount: number): void {
    // Mostly fine spray with the odd heavy drop: a thrown pattern rather than a few big blots.
    const n = Math.round(4 + amount * 12);
    for (let i = 0; i < n; i++) {
      const slot = this.head;
      this.head = (slot + 1) % CAP;
      if (slot >= this.high) this.high = slot + 1;
      const o = slot * STRIDE;
      // Biased to the rim of the view so the crosshair stays clean.
      const ang = rand(0, Math.PI * 2);
      const rad = rand(0.62, 1.1);
      const heavy = Math.random() < 0.14;
      const life = heavy ? rand(1.2, 2.2) : rand(0.5, 1.1);
      const d = this.data;
      d[o] = Math.cos(ang) * rad;
      d[o + 1] = Math.sin(ang) * rad * 0.9;
      d[o + 2] = heavy ? rand(0.022, 0.042) : rand(0.005, 0.014);
      d[o + 3] = this.clock;
      d[o + 4] = life;
      d[o + 5] = heavy ? rand(0.04, 0.14) : 0;
      d[o + 6] = Math.random() * 97;
      d[o + 7] = 0;
      if (this.clock + life > this.lastDeath) this.lastDeath = this.clock + life;
    }
    this.dirty = true;
  }

  sync(realDt: number, aspect: number): void {
    if (this.dirty) {
      this.buffer.needsUpdate = true;
      this.dirty = false;
      this.geometry.instanceCount = this.high;
      this.mesh.visible = true;
    }
    if (!this.mesh.visible) return;
    this.clock += realDt;
    this.material.uniforms.uClock!.value = this.clock;
    this.material.uniforms.uAspect!.value = aspect;
    if (this.clock >= this.lastDeath) {
      this.mesh.visible = false;
      this.geometry.instanceCount = 0;
      this.high = 0;
      this.head = 0;
    }
  }

  clear(): void {
    this.mesh.visible = false;
    this.geometry.instanceCount = 0;
    this.high = 0;
    this.head = 0;
    this.dirty = false;
    this.lastDeath = -1;
  }
}
