import * as THREE from 'three';
import { FullscreenPass, readArea } from '../fullscreen';

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uScale;
uniform vec2 uEdge;
in vec2 vUv;
out vec4 outColor;
vec3 tap(vec2 o) { return texture(tSrc, min(vUv * uScale + o * uTexel, uEdge)).rgb; }
// 13-tap Call of Duty downsample: no box artefacts, so the halo stays round at every level.
void main() {
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0, 0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0));
  vec3 l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
  outColor = vec4(e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125, 1.0);
}`;

/**
 * First level: four bilinear taps, each already averaging a 2x2 block of the full-resolution image.
 * This pass is by far the most bandwidth in the chain. Weighting each block by inverse brightness
 * (Karis) stops a single sub-pixel spark from pumping the pyramid and flickering.
 */
const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform vec2 uScale;
uniform vec2 uEdge;
in vec2 vUv;
out vec4 outColor;
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 tap(vec2 o) { return min(texture(tSrc, min(vUv * uScale + o * uTexel, uEdge)).rgb, vec3(64000.0)); }
// Soft-knee threshold: anything under the threshold contributes nothing, so only hot pixels glow.
vec3 hot(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  float soft = clamp(peak - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  return c * (max(soft, peak - uThreshold) / max(peak, 1e-4));
}
void main() {
  vec3 a = tap(vec2(-1.0, -1.0)), b = tap(vec2(1.0, -1.0)), c = tap(vec2(-1.0, 1.0)), d = tap(vec2(1.0, 1.0));
  float wa = karis(a), wb = karis(b), wc = karis(c), wd = karis(d);
  outColor = vec4(hot((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd)), 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
uniform float uWeight;
uniform vec2 uLowScale;
uniform vec2 uLowEdge;
uniform vec2 uHighScale;
uniform vec2 uHighEdge;
in vec2 vUv;
out vec4 outColor;
vec3 low(vec2 o) { return texture(tLow, min(vUv * uLowScale + o * uTexel, uLowEdge)).rgb; }
// Four bilinear taps over the lower level, added to this level. 0.707 texels out gives the spread of a 3x3 tent
// for under half the fetches, and the top of this chain is the most expensive part of bloom. Wide bloom comes
// from the stack of levels, not from a big kernel.
void main() {
  vec3 s = low(vec2(-0.707, -0.707)) + low(vec2(0.707, -0.707)) + low(vec2(-0.707, 0.707)) + low(vec2(0.707, 0.707));
  outColor = vec4(texture(tHigh, min(vUv * uHighScale, uHighEdge)).rgb + s * (uWeight * 0.25), 1.0);
}`;

/** Physically shaped bloom pyramid. Output is half resolution, and the final pass samples it bilinearly. */
export class Bloom {
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private readonly first = new FullscreenPass(PREFILTER, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 }, uKnee: { value: 0.55 },
    uScale: { value: new THREE.Vector2(1, 1) }, uEdge: { value: new THREE.Vector2(1, 1) },
  });
  private readonly downPass = new FullscreenPass(DOWN, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uScale: { value: new THREE.Vector2(1, 1) }, uEdge: { value: new THREE.Vector2(1, 1) },
  });
  private readonly upPass = new FullscreenPass(UP, {
    tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 },
    uLowScale: { value: new THREE.Vector2(1, 1) }, uLowEdge: { value: new THREE.Vector2(1, 1) },
    uHighScale: { value: new THREE.Vector2(1, 1) }, uHighEdge: { value: new THREE.Vector2(1, 1) },
  });
  levels = 6;

  /** The finished bloom, for reading with `readArea`. */
  get outputTarget(): THREE.WebGLRenderTarget {
    return this.up[0] ?? this.down[0]!;
  }

  get output(): THREE.Texture {
    return this.outputTarget.texture;
  }

  resize(width: number, height: number, levels: number): void {
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = [];
    this.up = [];
    this.levels = levels;
    let w = width;
    let h = height;
    for (let i = 0; i < levels; i++) {
      w = Math.max(2, Math.ceil(w / 2));
      h = Math.max(2, Math.ceil(h / 2));
      // Packed float halves the bandwidth of every level, and bloom never needs alpha or 16-bit precision.
      const options = { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
      this.down.push(new THREE.WebGLRenderTarget(w, h, options));
      if (i < levels - 1) this.up.push(new THREE.WebGLRenderTarget(w, h, options));
    }
  }

  setArea(width: number, height: number): void {
    let w = width;
    let h = height;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(2, Math.ceil(w / 2));
      h = Math.max(2, Math.ceil(h / 2));
      this.down[i]!.viewport.set(0, 0, w, h);
      this.up[i]?.viewport.set(0, 0, w, h);
    }
  }

  render(renderer: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget): void {
    const f = this.first.uniforms;
    f.tSrc!.value = src.texture;
    (f.uTexel!.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
    readArea(src, f.uScale!.value as THREE.Vector2, f.uEdge!.value as THREE.Vector2);
    this.first.render(renderer, this.down[0]!);
    const d = this.downPass.uniforms;
    for (let i = 1; i < this.levels; i++) {
      const prev = this.down[i - 1]!;
      d.tSrc!.value = prev.texture;
      (d.uTexel!.value as THREE.Vector2).set(1 / prev.width, 1 / prev.height);
      readArea(prev, d.uScale!.value as THREE.Vector2, d.uEdge!.value as THREE.Vector2);
      this.downPass.render(renderer, this.down[i]!);
    }
    const u = this.upPass.uniforms;
    let low = this.down[this.levels - 1]!;
    for (let i = this.levels - 2; i >= 0; i--) {
      u.tLow!.value = low.texture;
      u.tHigh!.value = this.down[i]!.texture;
      (u.uTexel!.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
      readArea(low, u.uLowScale!.value as THREE.Vector2, u.uLowEdge!.value as THREE.Vector2);
      readArea(this.down[i]!, u.uHighScale!.value as THREE.Vector2, u.uHighEdge!.value as THREE.Vector2);
      // Lower levels carry the wide halo. Weights over 1 fatten it without raising the core.
      u.uWeight!.value = 1.0 + i * 0.06;
      this.upPass.render(renderer, this.up[i]!);
      low = this.up[i]!;
    }
  }

  dispose(): void {
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.first.dispose();
    this.downPass.dispose();
    this.upPass.dispose();
  }
}
