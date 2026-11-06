/**
 * Through-wall silhouettes and the ring that sweeps the world. Both land on the HDR image after the transparent pass,
 * so bloom gives them heat and nothing in front of them can hide them, except the player's own gun.
 *
 * Silhouettes are immediate: `add` lasts for one rendered frame. That is what keeps them safe around pooled characters,
 * and it means an idle frame pays for one branch and no GPU work at all. A batch is one more walk of the scene with an
 * override material, so a frame with nothing lit never pays for it.
 */
import * as THREE from 'three';
import { VIEW_DEPTH_MAX } from './engine';
import { FullscreenPass } from './fullscreen';

/** One pass each. Sonar and a gunner's HUD are two. */
const MAX_BATCHES = 4;
/** Metres a body must be behind what the depth buffer holds to count as hidden. Its own surface sits at zero. */
const HIDDEN_BIAS = 0.15;

const SILHOUETTE_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vNormalView;
varying vec3 vToEye;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vNormalView = transformedNormal;
  vToEye = -mvPosition.xyz;
}`;

/**
 * Hidden pixels get the full silhouette. Pixels in plain sight only get an edge, so the wounds on a body in the open stay
 * readable. Output is premultiplied, and the fill is near opaque, so a body reads the same over a dark wall and a lit one.
 */
const SILHOUETTE_FRAG = /* glsl */ `
uniform highp sampler2D tDepth;
uniform vec2 uClip;
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vNormalView;
varying vec3 vToEye;

float eyeDepth(float d) {
  return uClip.x * uClip.y / (uClip.y - d * (uClip.y - uClip.x));
}

void main() {
  float scene = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;
  if (scene < ${VIEW_DEPTH_MAX.toFixed(4)}) discard;
  float hidden = step(eyeDepth(scene) + ${HIDDEN_BIAS.toFixed(2)}, eyeDepth(gl_FragCoord.z));
  float facing = abs(dot(normalize(vNormalView), normalize(vToEye)));
  float rim = pow(1.0 - facing, 2.5);
  float cover = mix(rim * 0.6, 0.85, hidden);
  vec3 edge = uColor * rim * mix(1.1, 5.0, hidden) + rim * hidden * 0.3;
  gl_FragColor = vec4((uColor * cover * 0.8 + edge) * uStrength, cover * uStrength);
}`;

/** A hard crest with a wake behind it. Sky and the viewmodel are skipped: the ring runs over the world's surfaces only. */
const SWEEP_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tDepth;
uniform mat4 uClipToWorld;
uniform vec3 uOrigin;
uniform vec3 uColor;
uniform float uRadius;
uniform float uFade;

void main() {
  outColor = vec4(0.0);
  float d = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;
  if (d < ${VIEW_DEPTH_MAX.toFixed(4)} || d > 0.99999) return;
  vec4 w = uClipToWorld * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  float behind = uRadius - distance(w.xyz / w.w, uOrigin);
  if (behind < 0.0) return;
  float crest = smoothstep(0.0, 0.08, behind) * exp(-behind * 4.0) * 4.0;
  float wake = exp(-behind * 0.3) * 0.05;
  outColor = vec4(uColor * (crest + wake) * uFade, 0.0);
}`;

interface Batch {
  readonly lit: Set<THREE.Object3D>;
  readonly color: THREE.Color;
  strength: number;
}

export class XRay {
  readonly material: THREE.ShaderMaterial;
  /** The meshes of the batch being drawn, for the render list filter. */
  current: ReadonlySet<THREE.Object3D> | null = null;
  private readonly batches: Batch[] = Array.from({ length: MAX_BATCHES }, () => ({ lit: new Set(), color: new THREE.Color(), strength: 1 }));
  private count = 0;
  private cursor = 0;

  private readonly sweepPass: FullscreenPass;
  private sweeping = false;
  private radius = 0;
  private speed = 0;
  private reach = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SILHOUETTE_VERT,
      fragmentShader: SILHOUETTE_FRAG,
      uniforms: {
        tDepth: { value: null },
        uClip: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color() },
        uStrength: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      toneMapped: false,
    });
    this.sweepPass = new FullscreenPass(SWEEP_FRAG, {
      tDepth: { value: null },
      uClipToWorld: { value: new THREE.Matrix4() },
      uOrigin: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color() },
      uRadius: { value: 0 },
      uFade: { value: 0 },
    });
    const { material } = this.sweepPass;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
  }

  /** True when this frame has anything to draw. */
  get busy(): boolean {
    return this.count > 0 || this.sweeping;
  }

  add(meshes: readonly THREE.Object3D[], color: THREE.ColorRepresentation, strength: number): void {
    if (meshes.length === 0 || strength <= 0 || this.count === MAX_BATCHES) return;
    const batch = this.batches[this.count++]!;
    for (let i = 0; i < meshes.length; i++) batch.lit.add(meshes[i]!);
    batch.color.set(color);
    batch.strength = strength;
  }

  sweep(origin: THREE.Vector3, color: THREE.ColorRepresentation, speed: number, reach: number): void {
    const u = this.sweepPass.uniforms;
    (u.uOrigin!.value as THREE.Vector3).copy(origin);
    (u.uColor!.value as THREE.Color).set(color);
    this.radius = 0;
    this.speed = speed;
    this.reach = reach;
    this.sweeping = true;
  }

  drawSweep(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, depth: THREE.Texture, camera: THREE.Camera, realDt: number): void {
    if (!this.sweeping) return;
    this.radius += this.speed * realDt;
    if (this.radius >= this.reach) {
      this.sweeping = false;
      return;
    }
    const u = this.sweepPass.uniforms;
    const left = 1 - this.radius / this.reach;
    u.tDepth!.value = depth;
    u.uRadius!.value = this.radius;
    u.uFade!.value = left * left;
    (u.uClipToWorld!.value as THREE.Matrix4).multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    this.sweepPass.render(renderer, target, true);
  }

  /** Loads the next batch for a scene render, or returns false and empties the list once they are all drawn. */
  next(depth: THREE.Texture, camera: THREE.PerspectiveCamera): boolean {
    if (this.cursor === this.count) {
      for (let i = 0; i < this.count; i++) this.batches[i]!.lit.clear();
      this.count = this.cursor = 0;
      this.current = null;
      return false;
    }
    const batch = this.batches[this.cursor++]!;
    const u = this.material.uniforms;
    u.tDepth!.value = depth;
    (u.uClip!.value as THREE.Vector2).set(camera.near, camera.far);
    (u.uColor!.value as THREE.Color).copy(batch.color);
    u.uStrength!.value = batch.strength;
    this.current = batch.lit;
    return true;
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) this.batches[i]!.lit.clear();
    this.count = this.cursor = 0;
    this.current = null;
    this.sweeping = false;
  }
}
