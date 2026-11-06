import * as THREE from 'three';
import { FullscreenPass } from '../fullscreen';

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
vec3 tap(vec2 o) { return texture(tSrc, vUv + o * uTexel).rgb; }
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
in vec2 vUv;
out vec4 outColor;
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 tap(vec2 o) { return min(texture(tSrc, vUv + o * uTexel).rgb, vec3(64000.0)); }
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
in vec2 vUv;
out vec4 outColor;
// 3x3 tent over the lower level, added to this level. Wide bloom comes from the stack of levels, not
// from a big kernel.
void main() {
  vec3 s = texture(tLow, vUv).rgb * 4.0;
  s += (texture(tLow, vUv + vec2(uTexel.x, 0.0)).rgb + texture(tLow, vUv - vec2(uTexel.x, 0.0)).rgb
      + texture(tLow, vUv + vec2(0.0, uTexel.y)).rgb + texture(tLow, vUv - vec2(0.0, uTexel.y)).rgb) * 2.0;
  s += texture(tLow, vUv + uTexel).rgb + texture(tLow, vUv - uTexel).rgb
     + texture(tLow, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture(tLow, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
  outColor = vec4(texture(tHigh, vUv).rgb + s * (uWeight / 16.0), 1.0);
}`;

/** Physically shaped bloom pyramid. Output is half resolution, and the final pass samples it bilinearly. */
export class Bloom {
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private readonly first = new FullscreenPass(PREFILTER, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 }, uKnee: { value: 0.55 },
  });
  private readonly downPass = new FullscreenPass(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  private readonly upPass = new FullscreenPass(UP, {
    tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 },
  });
  levels = 6;

  get output(): THREE.Texture {
    return (this.up[0] ?? this.down[0]!).texture;
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

  render(renderer: THREE.WebGLRenderer, src: THREE.Texture, srcWidth: number, srcHeight: number): void {
    const f = this.first.uniforms;
    f.tSrc!.value = src;
    (f.uTexel!.value as THREE.Vector2).set(1 / srcWidth, 1 / srcHeight);
    this.first.render(renderer, this.down[0]!);
    const d = this.downPass.uniforms;
    for (let i = 1; i < this.levels; i++) {
      const prev = this.down[i - 1]!;
      d.tSrc!.value = prev.texture;
      (d.uTexel!.value as THREE.Vector2).set(1 / prev.width, 1 / prev.height);
      this.downPass.render(renderer, this.down[i]!);
    }
    const u = this.upPass.uniforms;
    let low = this.down[this.levels - 1]!;
    for (let i = this.levels - 2; i >= 0; i--) {
      u.tLow!.value = low.texture;
      u.tHigh!.value = this.down[i]!.texture;
      (u.uTexel!.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
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
