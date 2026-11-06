import * as THREE from 'three';
import { FullscreenPass, readArea } from '../fullscreen';
import { VIEW_DEPTH_MAX } from '../engine';

const FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tHalfDepth;
uniform sampler2D tAo;
uniform sampler2D tFog;
uniform sampler2D tSsr;
uniform vec2 uProj;
uniform float uAo;
uniform float uFog;
uniform float uSsr;
uniform vec2 uHalfScale;
uniform vec2 uHalfEdge;
uniform vec2 uHalfSize;
in vec2 vUv;
out vec4 outColor;

float linear(float d) { return d >= 1.0 ? 1e5 : uProj.y / (d * 2.0 - 1.0 + uProj.x); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 sceneTexel = texelFetch(tScene, p, 0);
  vec3 c = sceneTexel.rgb;
  float d = texelFetch(tDepth, p, 0).r;
  if (d < ${VIEW_DEPTH_MAX.toFixed(4)}) { outColor = vec4(c, 1.0); return; }
  float z = linear(d);

  // Depth-aware upsample. Where all four half-res neighbours agree with this pixel, one hardware
  // bilinear tap per texture is exact, and that is nearly every pixel. On a silhouette it takes the
  // single neighbour closest in depth, so fog and AO stop exactly at the edge.
  ivec2 h = (p - 1) >> 1;
  ivec2 hiBound = ivec2(uHalfSize) - 1;
  ivec2 q0 = clamp(h, ivec2(0), hiBound);
  ivec2 q1 = clamp(h + ivec2(1, 0), ivec2(0), hiBound);
  ivec2 q2 = clamp(h + ivec2(0, 1), ivec2(0), hiBound);
  ivec2 q3 = clamp(h + ivec2(1, 1), ivec2(0), hiBound);
  float e0 = abs(texelFetch(tHalfDepth, q0, 0).r - z);
  float e1 = abs(texelFetch(tHalfDepth, q1, 0).r - z);
  float e2 = abs(texelFetch(tHalfDepth, q2, 0).r - z);
  float e3 = abs(texelFetch(tHalfDepth, q3, 0).r - z);
  float ao;
  vec4 fog;
  vec4 ssr = vec4(0.0);
  if (max(max(e0, e1), max(e2, e3)) < z * 0.025) {
    vec2 uv = min(vUv * uHalfScale, uHalfEdge);
    ao = texture(tAo, uv).r;
    fog = texture(tFog, uv);
    if (uSsr > 0.0) ssr = texture(tSsr, uv);
  } else {
    ivec2 q = q0;
    float best = e0;
    if (e1 < best) { best = e1; q = q1; }
    if (e2 < best) { best = e2; q = q2; }
    if (e3 < best) { q = q3; }
    ao = texelFetch(tAo, q, 0).r;
    fog = texelFetch(tFog, q, 0);
    if (uSsr > 0.0) ssr = texelFetch(tSsr, q, 0);
  }
  float hot = smoothstep(1.0, 3.5, max(c.r, max(c.g, c.b)));
  c *= mix(1.0, ao, uAo * (1.0 - hot));
  // ssr.rgb is premultiplied by nothing, a is ray confidence. The reflection replaces part of what the
  // forward pass guessed from the volume, so it only adds where it finds something brighter.
  float reflectivity = (1.0 - sceneTexel.a) * ssr.a * uSsr;
  c = mix(c, max(c, c * (1.0 - reflectivity) + ssr.rgb * reflectivity), min(reflectivity * 8.0, 1.0));
  c = mix(c, c * fog.a + fog.rgb, uFog);
  outColor = vec4(c, 1.0);
}`;

export class Combine {
  private readonly pass = new FullscreenPass(FRAG, {
    tScene: { value: null }, tDepth: { value: null }, tHalfDepth: { value: null }, tAo: { value: null }, tFog: { value: null }, tSsr: { value: null },
    uProj: { value: new THREE.Vector2() }, uAo: { value: 1 }, uFog: { value: 1 }, uSsr: { value: 0 },
    uHalfScale: { value: new THREE.Vector2(1, 1) }, uHalfEdge: { value: new THREE.Vector2(1, 1) }, uHalfSize: { value: new THREE.Vector2(1, 1) },
  });

  /** Takes any half-resolution target, because they all share an area. */
  setArea(half: THREE.WebGLRenderTarget): void {
    const u = this.pass.uniforms;
    readArea(half, u.uHalfScale!.value as THREE.Vector2, u.uHalfEdge!.value as THREE.Vector2);
    (u.uHalfSize!.value as THREE.Vector2).set(half.viewport.z, half.viewport.w);
  }

  render(
    renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, scene: THREE.Texture, depth: THREE.Texture, halfDepth: THREE.Texture,
    ao: THREE.Texture, fog: THREE.Texture, ssr: THREE.Texture, camera: THREE.PerspectiveCamera, aoAmount: number, fogAmount: number, ssrAmount: number,
  ): void {
    const u = this.pass.uniforms;
    const e = camera.projectionMatrix.elements;
    u.tScene!.value = scene;
    u.tDepth!.value = depth;
    u.tHalfDepth!.value = halfDepth;
    u.tAo!.value = ao;
    u.tFog!.value = fog;
    u.tSsr!.value = ssr;
    (u.uProj!.value as THREE.Vector2).set(e[10]!, e[14]!);
    u.uAo!.value = aoAmount;
    u.uFog!.value = fogAmount;
    u.uSsr!.value = ssrAmount;
    this.pass.render(renderer, target);
  }

  dispose(): void {
    this.pass.dispose();
  }
}
