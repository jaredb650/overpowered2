/**
 * Map-hugging overlays: the blast ring and the gun-run corridor, and the probe strikes use to find open air.
 *
 * Each overlay is projected from this frame's depth, so what the player sees on a ramp or across a stack of containers
 * is the true footprint at every pixel. A draped grid cannot do that: a thin post under one vertex stands the whole
 * ring up into a cone. Patterns are drawn from polar or strip coordinates, so one draw covers ring, ticks and chevrons.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';

/** Rapier filter word that hits only `mask`. Same layout as Physics.groups. */
const queryWord = (mask: number): number => ((0xffff & 0xffff) << 16) | (mask & 0xffff);
const WORLD_FILTER = queryWord(CG.World);

/** Allocation-free height probe. physics.raycast builds result vectors, which this runs hundreds of times a frame. */
export class GroundProbe {
  private readonly ray: RAPIER.Ray;

  constructor(private readonly ctx: Ctx) {
    const R = ctx.physics.R;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  /** Height of the first floor below (x, fromY, z), or NaN within `maxDrop`. */
  heightAt(x: number, fromY: number, z: number, maxDrop: number): number {
    const o = this.ray.origin;
    o.x = x;
    o.y = fromY;
    o.z = z;
    const hit = this.ctx.physics.world.castRay(this.ray, maxDrop, true, undefined, WORLD_FILTER);
    return hit ? fromY - hit.timeOfImpact : NaN;
  }

  /** Clear height above a point, capped at `limit`. */
  headroom(x: number, y: number, z: number, limit: number): number {
    return this.clearance(x, y, z, 0, 1, 0, limit);
  }

  /** Open distance from a point along a unit direction, capped at `limit`. */
  clearance(x: number, y: number, z: number, dx: number, dy: number, dz: number, limit: number): number {
    const o = this.ray.origin;
    const d = this.ray.dir;
    o.x = x;
    o.y = y;
    o.z = z;
    d.x = dx;
    d.y = dy;
    d.z = dz;
    const hit = this.ctx.physics.world.castRay(this.ray, limit, true, undefined, WORLD_FILTER);
    d.x = 0;
    d.y = -1;
    d.z = 0;
    return hit ? hit.timeOfImpact : limit;
  }
}

/** Below this the depth buffer holds the viewmodel, which the renderer keeps in a sliver of the range. */
const VIEW_DEPTH = 0.02;

const VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Finds the surface behind this pixel. Every overlay is a volume drawn from the inside, so a pixel runs once however
 * the camera stands, and the pattern lands on the real map: ramps, crates, walls and anyone standing in the blast.
 */
const SURFACE = /* glsl */ `
uniform highp sampler2D tDepth;
uniform mat4 uClipToWorld;
uniform vec3 uColor;
uniform vec3 uCenter;
uniform float uTime;
uniform float uOpacity;
uniform vec2 uBand;

// World position in xyz. w is 0 for sky and the player's own hands.
vec4 surface() {
  float d = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;
  vec2 ndc = gl_FragCoord.xy / vec2(textureSize(tDepth, 0)) * 2.0 - 1.0;
  vec4 w = uClipToWorld * vec4(ndc, d * 2.0 - 1.0, 1.0);
  float seen = step(${VIEW_DEPTH}, d) * step(d, 0.99999);
  return vec4(w.xyz / w.w, seen);
}

// Fades out above and below the target, so a blast on the ground does not paint the roof over it. A wall inside the
// footprint keeps a trace: the rim's ticks extrude straight up one, and at full strength they read as bars of light.
float band(vec3 p) {
  float rise = p.y - uCenter.y;
  float level = abs(normalize(cross(dFdx(p), dFdy(p))).y);
  return (1.0 - smoothstep(uBand.x * 0.8, uBand.x, rise)) * smoothstep(-uBand.y, -uBand.y * 0.8, rise) * mix(0.3, 1.0, smoothstep(0.25, 0.7, level));
}

// Crisp line of half-width metres around m. Depth edges make the derivative jump, so it is capped.
float line(float m, float width) {
  float aa = clamp(fwidth(m), 0.001, 0.5);
  return 1.0 - smoothstep(width, width + aa * 1.5, abs(m));
}
`;

const RING_FRAG = /* glsl */ `
precision highp float;
${SURFACE}
uniform float uRadius;
uniform float uInner;

void main() {
  vec4 s = surface();
  vec2 d = s.xz - uCenter.xz;
  float meters = length(d);
  float r = meters / uRadius;
  float turn = atan(d.y, d.x) / 6.2831853 + 0.5;
  float toRim = uRadius - meters;
  float weight = clamp(uRadius * 0.012, 0.12, 0.8);

  float rim = line(toRim, weight);
  // Rim ticks: fixed count, so a 90 m nuke ring and a 6 m beam ring read as the same instrument.
  float tick = step(fract(turn * 72.0), 0.28) * step(toRim, weight * 6.0) * step(weight, toRim);
  float inner = uInner > 0.0 ? line(meters - uInner, weight * 0.6) : 0.0;

  // Crosshair at the centre, sized in metres, with a gap around the exact point.
  float crossLen = clamp(uRadius * 0.12, 1.2, 8.0);
  float cross = (line(d.x, weight * 0.5) + line(d.y, weight * 0.5)) * step(meters, crossLen) * step(crossLen * 0.25, meters);

  // A pulse walks outward so the size of the blast is felt, not just drawn.
  float scan = fract(uTime * 0.5);
  float sweep = line(r - scan, 0.012) * (1.0 - scan) * 0.5;

  float fill = 0.06 * clamp(24.0 / uRadius, 0.35, 1.0);
  float a = rim + tick * 0.55 + inner * 0.6 + cross * 0.9 + sweep + fill;
  a *= step(r, 1.0) * s.w * band(s.xyz);
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;

const STRIP_FRAG = /* glsl */ `
precision highp float;
${SURFACE}
uniform vec2 uHeading;
uniform vec2 uSize;
uniform float uCore;

void main() {
  vec4 s = surface();
  vec2 d = s.xz - uCenter.xz;
  float along = dot(d, uHeading) / uSize.x + 0.5;
  float across = abs(dot(d, vec2(-uHeading.y, uHeading.x))) / (uSize.y * 0.5);
  float inside = step(across, 1.0) * step(0.0, along) * step(along, 1.0);

  float edge = smoothstep(0.93, 0.975, across);
  float core = 1.0 - smoothstep(uCore * 0.92, uCore, across);
  float chevron = step(0.72, fract(along * uSize.x * 0.14 - uTime * 2.4 + across * 0.9)) * core;
  float ends = 1.0 - smoothstep(0.0, 0.01, min(along, 1.0 - along));
  float a = edge * 0.8 + core * 0.16 + chevron * 0.75 + ends * 0.9 + 0.05;
  a *= inside * s.w * band(s.xyz);
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;

function overlayMaterial(fragmentShader: string, extra: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader,
    uniforms: {
      tDepth: { value: null },
      uClipToWorld: { value: new THREE.Matrix4() },
      uColor: { value: new THREE.Color('#ffffff') },
      uCenter: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uBand: { value: new THREE.Vector2(8, 16) },
      ...extra,
    },
    transparent: true,
    depthWrite: false,
    // It reads depth itself, and the camera is usually inside the volume.
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    toneMapped: false,
    fog: false,
  });
}

const ringMaterial = (): THREE.ShaderMaterial => overlayMaterial(RING_FRAG, { uRadius: { value: 1 }, uInner: { value: 0 } });
const stripMaterial = (): THREE.ShaderMaterial => overlayMaterial(STRIP_FRAG, {
  uHeading: { value: new THREE.Vector2(1, 0) }, uSize: { value: new THREE.Vector2(1, 1) }, uCore: { value: 0.3 },
});
export const groundMaterials = (): THREE.ShaderMaterial[] => [ringMaterial(), stripMaterial()];

/** Shared by every overlay, so a strike's ring costs one material and no geometry. */
const RING_VOLUME = new THREE.CylinderGeometry(1.04, 1.04, 1, 40);
const STRIP_VOLUME = new THREE.BoxGeometry(1, 1, 1);

/** A volume that projects its pattern onto whatever the depth buffer says is inside it. */
abstract class GroundPatch {
  protected readonly mesh: THREE.Mesh;
  protected readonly material: THREE.ShaderMaterial;

  protected constructor(protected readonly ctx: Ctx, geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial) {
    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      const u = material.uniforms;
      u.tDepth!.value = ctx.render.depthTexture;
      (u.uClipToWorld!.value as THREE.Matrix4).multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    };
    ctx.render.scene.add(this.mesh);
  }

  /** Places the volume. `up` and `down` are how far from `center` the pattern reaches onto other levels. */
  protected place(center: THREE.Vector3, up: number, down: number): void {
    this.mesh.visible = true;
    this.mesh.position.copy(center);
    this.mesh.position.y += (up - down) / 2;
    this.mesh.scale.y = up + down;
    (this.material.uniforms.uCenter!.value as THREE.Vector3).copy(center);
    (this.material.uniforms.uBand!.value as THREE.Vector2).set(up, down);
  }

  setColor(color: THREE.ColorRepresentation, boost = 2): void {
    (this.material.uniforms.uColor!.value as THREE.Color).set(color).multiplyScalar(boost);
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity!.value = opacity;
  }

  tick(t: number): void {
    this.material.uniforms.uTime!.value = t;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.ctx.render.scene.remove(this.mesh);
    this.material.dispose();
  }
}

/** `radius` is the true blast radius. */
export class GroundRing extends GroundPatch {
  constructor(ctx: Ctx) {
    super(ctx, RING_VOLUME, ringMaterial());
  }

  /** `inner` draws a second ring, e.g. the rocket scatter inside the finale's radius. */
  show(center: THREE.Vector3, radius: number, inner = 0): void {
    this.place(center, clamp(radius * 0.7, 9, 14), clamp(radius * 0.6, 14, 30));
    this.mesh.scale.x = this.mesh.scale.z = radius;
    this.material.uniforms.uRadius!.value = radius;
    this.material.uniforms.uInner!.value = inner;
  }
}

/** A corridor with a direction. */
export class GroundStrip extends GroundPatch {
  constructor(ctx: Ctx) {
    super(ctx, STRIP_VOLUME, stripMaterial());
  }

  /** `core` is the fraction of the width the shells fall in. The rest is blast. */
  show(center: THREE.Vector3, heading: THREE.Vector3, length: number, width: number, core: number): void {
    this.place(center, 9, 18);
    this.mesh.scale.x = length;
    this.mesh.scale.z = width;
    this.mesh.rotation.y = Math.atan2(-heading.z, heading.x);
    (this.material.uniforms.uHeading!.value as THREE.Vector2).set(heading.x, heading.z);
    (this.material.uniforms.uSize!.value as THREE.Vector2).set(length, width);
    this.material.uniforms.uCore!.value = core;
  }
}
