import * as THREE from 'three';
import { FullscreenPass } from '../fullscreen';

/**
 * Screen-space reflections at half resolution. The scene target's alpha is a free G-buffer channel:
 * patched materials write 1 - reflectivity there, so only wet and polished pixels trace. The ray
 * samples last frame's finished HDR image, which is why explosions and tracers show up in puddles.
 */
const FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform vec2 uTanHalf;
uniform mat4 uCurToPrev;
uniform float uViewCut;
in vec2 vUv;
out vec4 outColor;

vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z); }
float depthAt(vec2 uv) { return textureLod(tDepth, uv, 0.0).r; }
vec3 posAt(vec2 uv) { return viewPos(uv, depthAt(uv)); }
vec2 project(vec3 p) { return vec2(p.x / (-p.z * uTanHalf.x), p.y / (-p.z * uTanHalf.y)) * 0.5 + 0.5; }

void main() {
  outColor = vec4(0.0);
  float refl = 1.0 - textureLod(tScene, vUv, 0.0).a;
  if (refl < 0.02) return;
  float z = depthAt(vUv);
  if (z > 2e4 || z < uViewCut) return;
  vec3 P = viewPos(vUv, z);
  vec3 l = posAt(vUv - vec2(uTexel.x, 0.0)), r = posAt(vUv + vec2(uTexel.x, 0.0));
  vec3 d = posAt(vUv - vec2(0.0, uTexel.y)), u = posAt(vUv + vec2(0.0, uTexel.y));
  // Gratings and silhouettes have no usable normal. Tracing them only scatters noise.
  float spread = max(abs(l.z - r.z), abs(d.z - u.z));
  if (spread > z * 0.06 + 0.02) return;
  vec3 dx = abs(P.z - l.z) < abs(r.z - P.z) ? P - l : r - P;
  vec3 dy = abs(P.z - d.z) < abs(u.z - P.z) ? P - d : u - P;
  vec3 N = normalize(cross(dx, dy));
  vec3 V = normalize(P);
  vec3 R = reflect(V, N);
  if (R.z > 0.45) return;

  // Clip the ray to the near plane, then walk it in screen space, interpolating 1/z so the march
  // stays perspective-correct.
  float maxLen = min(z * 2.5 + 16.0, 90.0);
  float len = R.z > 0.0 ? min(maxLen, (-0.2 - P.z) / R.z) : maxLen;
  vec3 E = P + R * len;
  vec2 uv0 = vUv;
  vec2 uv1 = project(E);
  float iz0 = 1.0 / -P.z;
  float iz1 = 1.0 / -E.z;
  vec2 span = uv1 - uv0;
  // Stop at the screen edge. Anything beyond it has nothing to sample.
  vec2 lim = vec2(span.x > 0.0 ? (1.0 - uv0.x) / span.x : span.x < 0.0 ? -uv0.x / span.x : 1e3,
                  span.y > 0.0 ? (1.0 - uv0.y) / span.y : span.y < 0.0 ? -uv0.y / span.y : 1e3);
  float tMax = min(1.0, min(lim.x, lim.y));

  ivec2 c = ivec2(gl_FragCoord.xy) & 3;
  float jitter = float((c.x + c.y * 4) * 7 % 16) / 16.0;
  float tLast = 0.0;
  float hit = -1.0;
  for (int i = 0; i < STEPS; i++) {
    float f = (float(i) + 0.5 + jitter * 0.8) / float(STEPS);
    float t = f * f * tMax;
    vec2 uv = uv0 + span * t;
    float rayZ = 1.0 / mix(iz0, iz1, t);
    float sceneZ = depthAt(uv);
    float thickness = 0.25 + rayZ * 0.05;
    if (rayZ > sceneZ && rayZ - sceneZ < thickness && sceneZ > uViewCut) {
      float lo = tLast, hi = t;
      for (int b = 0; b < 4; b++) {
        float m = (lo + hi) * 0.5;
        vec2 um = uv0 + span * m;
        float rz = 1.0 / mix(iz0, iz1, m);
        if (rz > depthAt(um)) hi = m; else lo = m;
      }
      hit = hi;
      break;
    }
    tLast = t;
  }
  if (hit < 0.0) return;
  vec2 uvHit = uv0 + span * hit;
  float zHit = depthAt(uvHit);
  if (zHit > 2e4) return;
  vec3 pHit = viewPos(uvHit, zHit);
  // Last frame's image, so the hit point has to be carried through last frame's camera.
  vec4 prev = uCurToPrev * vec4(pHit, 1.0);
  vec2 uvPrev = prev.xy / prev.w * 0.5 + 0.5;
  vec2 edge = min(uvPrev, 1.0 - uvPrev);
  float fade = smoothstep(0.0, 0.07, min(edge.x, edge.y));
  fade *= smoothstep(0.45, 0.05, R.z);
  fade *= 1.0 - smoothstep(0.75, 1.0, hit / max(tMax, 1e-3));
  outColor = vec4(min(texture(tPrev, uvPrev).rgb, vec3(24.0)), fade);
}`;

export class Ssr {
  private pass: FullscreenPass | null = null;
  private target!: THREE.WebGLRenderTarget;
  private width = 1;
  private height = 1;
  private readonly prevViewProj = new THREE.Matrix4();

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  configure(steps: number): void {
    this.pass?.dispose();
    this.pass = new FullscreenPass(FRAG, {
      tDepth: { value: null }, tScene: { value: null }, tPrev: { value: null },
      uTexel: { value: new THREE.Vector2() }, uTanHalf: { value: new THREE.Vector2() },
      uCurToPrev: { value: new THREE.Matrix4() }, uViewCut: { value: 0.16 },
    }, { STEPS: steps });
  }

  resize(fullWidth: number, fullHeight: number): void {
    this.target?.dispose();
    this.width = Math.ceil(fullWidth / 2);
    this.height = Math.ceil(fullHeight / 2);
    this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
  }

  render(renderer: THREE.WebGLRenderer, depth: THREE.Texture, scene: THREE.Texture, previous: THREE.Texture, camera: THREE.PerspectiveCamera, tanHalf: THREE.Vector2): void {
    const u = this.pass!.uniforms;
    u.tDepth!.value = depth;
    u.tScene!.value = scene;
    u.tPrev!.value = previous;
    (u.uTexel!.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    (u.uTanHalf!.value as THREE.Vector2).copy(tanHalf);
    (u.uCurToPrev!.value as THREE.Matrix4).multiplyMatrices(this.prevViewProj, camera.matrixWorld);
    this.pass!.render(renderer, this.target);
  }

  /** Call after the frame's image is finished, so next frame can reproject into it. */
  endFrame(camera: THREE.PerspectiveCamera): void {
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  dispose(): void {
    this.pass?.dispose();
    this.target?.dispose();
  }
}
