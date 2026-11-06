/**
 * Terrain-hugging overlays: the blast ring and the gun-run corridor.
 *
 * Both are grids whose vertices are dropped onto the map with raycasts, so what the player sees on a ramp or across a
 * stack of containers is the true footprint. Patterns are drawn in the fragment shader from polar or strip
 * coordinates, so one mesh covers ring, ticks, hatching and chevrons.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, type Ctx } from '../../core/contracts';

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
    const o = this.ray.origin;
    const d = this.ray.dir;
    o.x = x;
    o.y = y;
    o.z = z;
    d.y = 1;
    const hit = this.ctx.physics.world.castRay(this.ray, limit, true, undefined, WORLD_FILTER);
    d.y = -1;
    return hit ? hit.timeOfImpact : limit;
  }
}

const VERT = /* glsl */ `
attribute vec2 aGrid;
varying vec2 vGrid;
void main() {
  vGrid = aGrid;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RING_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uRadius;
uniform float uInner;
varying vec2 vGrid;

// Crisp line of width metres around m.
float line(float m, float width) {
  float aa = max(fwidth(m), 0.001);
  return 1.0 - smoothstep(width, width + aa * 1.5, abs(m));
}

void main() {
  float r = vGrid.y;
  float meters = r * uRadius;
  float toRim = uRadius - meters;
  float weight = clamp(uRadius * 0.012, 0.12, 0.8);

  float rim = line(toRim, weight);
  // Rim ticks: fixed count, so a 90 m nuke ring and a 6 m beam ring read as the same instrument.
  float tick = step(fract(vGrid.x * 72.0), 0.28) * step(toRim, weight * 6.0) * step(weight, toRim);
  float inner = uInner > 0.0 ? line(meters - uInner, weight * 0.6) : 0.0;

  // Crosshair at the centre, sized in metres, with a gap around the exact point.
  float angle = fract(vGrid.x * 4.0);
  float arm = min(angle, 1.0 - angle) * 6.2831 * meters * 0.25;
  float crossLen = clamp(uRadius * 0.12, 1.2, 8.0);
  float cross = line(arm, weight * 0.5) * step(meters, crossLen) * step(crossLen * 0.25, meters);

  // A pulse walks outward so the size of the blast is felt, not just drawn.
  float scan = fract(uTime * 0.5);
  float sweep = line(r - scan, 0.012) * (1.0 - scan) * 0.5;

  float a = rim + tick * 0.55 + inner * 0.6 + cross * 0.9 + sweep + 0.028;
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;

const STRIP_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uLength;
uniform float uCore;
varying vec2 vGrid;

void main() {
  float across = abs(vGrid.y - 0.5) * 2.0;
  float edge = smoothstep(0.93, 0.975, across);
  float core = 1.0 - smoothstep(uCore * 0.92, uCore, across);
  float along = vGrid.x * uLength * 0.14 - uTime * 2.4;
  float chevron = step(0.72, fract(along + across * 0.9)) * core;
  float ends = 1.0 - smoothstep(0.0, 0.01, min(vGrid.x, 1.0 - vGrid.x));
  float a = edge * 0.55 + core * 0.09 + chevron * 0.6 + ends * 0.8 + 0.022;
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;

function overlayMaterial(fragmentShader: string, extra: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color('#ffffff') },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      ...extra,
    },
    transparent: true,
    depthWrite: false,
    // Seen through walls on purpose: a marker that hides behind a crate is a marker that lies.
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
}

/** Grid of `nu` x `nv` cells lying on the ground. */
abstract class GroundPatch {
  readonly mesh: THREE.Mesh;
  protected readonly positions: Float32Array;
  protected readonly material: THREE.ShaderMaterial;
  protected readonly attr: THREE.BufferAttribute;
  private readonly lastCenter = new THREE.Vector3(NaN, 0, 0);

  protected constructor(
    protected readonly ctx: Ctx,
    protected readonly probe: GroundProbe,
    protected readonly nu: number,
    protected readonly nv: number,
    material: THREE.ShaderMaterial,
  ) {
    const count = (nu + 1) * (nv + 1);
    this.positions = new Float32Array(count * 3);
    const grid = new Float32Array(count * 2);
    const index: number[] = [];
    for (let v = 0; v <= nv; v++) {
      for (let u = 0; u <= nu; u++) {
        const i = v * (nu + 1) + u;
        grid[i * 2] = u / nu;
        grid[i * 2 + 1] = v / nv;
        if (u < nu && v < nv) {
          const a = i;
          const b = i + 1;
          const c = i + nu + 1;
          const d = c + 1;
          index.push(a, c, b, b, c, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.positions, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
    geo.setIndex(index);
    this.material = material;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    ctx.render.scene.add(this.mesh);
  }

  protected abstract vertexXZ(u: number, v: number, out: THREE.Vector2): void;

  private static readonly xz = new THREE.Vector2();

  /** Drops every vertex onto the map. Skipped unless the patch moved, which is why aiming is the only cost. */
  protected drape(center: THREE.Vector3, force: boolean): void {
    if (!force && this.lastCenter.distanceToSquared(center) < 0.01) return;
    this.lastCenter.copy(center);
    const { nu, nv, positions, probe } = this;
    const xz = GroundPatch.xz;
    for (let v = 0; v <= nv; v++) {
      for (let u = 0; u <= nu; u++) {
        this.vertexXZ(u / nu, v / nv, xz);
        const h = probe.heightAt(xz.x, center.y + 4.5, xz.y, 22);
        const i = (v * (nu + 1) + u) * 3;
        positions[i] = xz.x;
        positions[i + 1] = (Number.isNaN(h) ? center.y : h) + 0.08;
        positions[i + 2] = xz.y;
      }
    }
    this.attr.needsUpdate = true;
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
    this.lastCenter.x = NaN;
  }

  dispose(): void {
    this.ctx.render.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Polar patch: `radius` is the true blast radius. */
export class GroundRing extends GroundPatch {
  private center = new THREE.Vector3();
  private radius = 1;

  constructor(ctx: Ctx, probe: GroundProbe, segments = 56, rings = 5) {
    super(ctx, probe, segments, rings, overlayMaterial(RING_FRAG, { uRadius: { value: 1 }, uInner: { value: 0 } }));
  }

  protected vertexXZ(u: number, v: number, out: THREE.Vector2): void {
    const a = u * Math.PI * 2;
    const r = v * this.radius;
    out.set(this.center.x + Math.cos(a) * r, this.center.z + Math.sin(a) * r);
  }

  /** `inner` draws a second ring, e.g. the rocket scatter inside the finale's radius. */
  show(center: THREE.Vector3, radius: number, inner = 0): void {
    const changed = radius !== this.radius;
    this.center.copy(center);
    this.radius = radius;
    this.material.uniforms.uRadius!.value = radius;
    this.material.uniforms.uInner!.value = inner;
    this.mesh.visible = true;
    this.drape(center, changed);
  }
}

/** Strip patch: a corridor with a direction. */
export class GroundStrip extends GroundPatch {
  private center = new THREE.Vector3();
  private readonly heading = new THREE.Vector3(1, 0, 0);
  private length = 1;
  private width = 1;

  constructor(ctx: Ctx, probe: GroundProbe, segments = 32, across = 4) {
    super(ctx, probe, segments, across, overlayMaterial(STRIP_FRAG, { uLength: { value: 1 }, uCore: { value: 0.3 } }));
  }

  protected vertexXZ(u: number, v: number, out: THREE.Vector2): void {
    const along = (u - 0.5) * this.length;
    const side = (v - 0.5) * this.width;
    out.set(
      this.center.x + this.heading.x * along - this.heading.z * side,
      this.center.z + this.heading.z * along + this.heading.x * side,
    );
  }

  /** `core` is the fraction of the width the shells fall in. The rest is blast. */
  show(center: THREE.Vector3, heading: THREE.Vector3, length: number, width: number, core: number): void {
    const turned = this.heading.distanceToSquared(heading) > 1e-5;
    this.center.copy(center);
    this.heading.copy(heading);
    this.length = length;
    this.width = width;
    this.material.uniforms.uLength!.value = length;
    this.material.uniforms.uCore!.value = core;
    this.mesh.visible = true;
    this.drape(center, turned);
  }
}
