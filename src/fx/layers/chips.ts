import * as THREE from 'three';
import { COMMON_VERT, OUTPUT_FRAG } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import * as shapes from '../gpu/shapes';
import { ORDER, type FxUniforms, type Rgb } from './shared';

/**
 * Opaque faceted chips: the first game's whole visual identity.
 *
 * Each shape is one draw call with its own ring. Records are five vec4s:
 *   aP  origin xyz, birth      aV  velocity xyz, life
 *   aC  HDR colour rgb, size   aF  gravity, floor height, restitution, horizontal friction
 *   aR  spin axis * rate xyz, shrink start (0 = linear from birth, 0.7 = holds size then shrinks)
 */
const ATTRS = ['aP', 'aV', 'aC', 'aF', 'aR'] as const;

const VERT = /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aF;
attribute vec4 aR;
varying vec3 vColor;
uniform float uFacet;
uniform float uMinPx;
uniform float uGlint;
uniform float uGlintGain;
uniform float uEject;
${COMMON_VERT}

void main() {
  float age = uTime - aP.w;
  float life = aV.w;
  if (age < 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = age / life;
  // Exit by shrink: linear scale means area falls with the square, a free ease-out with no translucent phase.
  float sh = 1.0 - clamp((k - aR.w) / max(1.0 - aR.w, 0.001), 0.0, 1.0);

  // Blast warp: flight time runs ahead for the first few frames, so a chip leaves the origin far
  // faster than it travels later. Closed-form, so bounces still work, and it is the difference
  // between a burst that cracks open and one that merely expands.
  float flight = age + uEject * (1.0 - exp(-age * 30.0));
  vec3 vel;
  float moved, rest;
  vec3 pos = ballistic(aP.xyz, aV.xyz, aF.x, aF.y, aF.z, aF.w, flight, vel, moved, rest);

  vec4 viewCentre = viewMatrix * vec4(pos, 1.0);
  float depth = max(-viewCentre.z, 0.01);
  // Keeps a chip from sub-pixel flicker at range. Scaled by sh so it still shrinks away on time.
  float s = max(aC.w, uPixelWorld * depth * uMinPx) * sh;

  vec3 local = position * s;
  vec3 n = normal;
  float rate = length(aR.xyz);
  if (rate > 0.0) {
    vec3 axis = aR.xyz / rate;
    float phase = hash21(aP.xz + aP.w + float(gl_InstanceID) * 0.37) * 6.2831853;
    float angle = phase + rate * moved;
    local = rotateAxis(local, axis, angle);
    n = rotateAxis(n, axis, angle);
  }
  vec3 world = pos + local;
  world.y = max(world.y, aF.y + s * 0.15);

  // One flat value per face: facets read, but there is still no gradient inside any of them.
  float shade = 1.0 + uFacet * dot(n, vec3(0.267, 0.802, 0.535));
  vec3 col = aC.rgb * shade;
  // Hot chips light whichever facet faces the eye. That keeps the rim saturated, gives the bloom
  // something to work with, and makes a tumbling chip glitter.
  float peak = max(aC.r, max(aC.g, aC.b));
  float faces = dot(n, normalize(cameraPosition - pos));
  vec3 heated = col * uGlintGain;
  heated.g = min(heated.g + abs(col.r - col.b) * 0.6, max(heated.r, heated.b) * 0.85);
  col = mix(col, heated, smoothstep(1.02, 1.08, peak) * step(uGlint, faces));
  vColor = applyFog(col, depth);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  ${OUTPUT_FRAG}
}
`;

export type ChipShape = 'gem' | 'cube' | 'shard' | 'plate' | 'rod' | 'casing';

/** Sum with the other particle classes must stay at or below the 30k budget. */
const CAPS: Record<ChipShape, number> = {
  gem: 9000,
  cube: 2500,
  shard: 2500,
  plate: 800,
  rod: 200,
  casing: 500,
};

export class ChipLayer {
  readonly rings: Record<ChipShape, InstanceRing>;

  // Burst state: set once by `begin`, read per particle by `add`.
  private ring!: InstanceRing;
  private birth = 0;
  private life = 1;
  private death = 0;
  private cr = 0;
  private cg = 0;
  private cb = 0;
  private gravity = -20;
  private floor = -1e6;
  private restitution = 0.35;
  private friction = 0.6;
  private shrinkStart = 0;

  constructor(scene: THREE.Scene, uniforms: FxUniforms) {
    const shared = {
      ...uniforms,
      uFacet: { value: 0.16 },
      uMinPx: { value: 1.6 },
      uGlint: { value: 0.8 },
      // Peak stays near 1.4: higher and Neutral lifts blue enough to turn a big close chip salmon.
      uGlintGain: { value: 1.2 },
      uEject: { value: 0.09 },
    };
    // Opaque output, but drawn in the transparent pass: fire sprites do not write depth, so this
    // puts chips on top of the fireball they burst out of, and after the fog so heat stays legible.
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: shared, transparent: true, depthWrite: true, blending: THREE.NoBlending,
    });

    const make = (shape: ChipShape, geometry: THREE.BufferGeometry) => {
      const ring = new InstanceRing(geometry, CAPS[shape], ATTRS);
      const mesh = new THREE.Mesh(ring.geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = ORDER.chips;
      mesh.name = `fx.chips.${shape}`;
      ring.object = mesh;
      scene.add(mesh);
      return ring;
    };

    this.rings = {
      gem: make('gem', shapes.gem()),
      cube: make('cube', shapes.cube()),
      shard: make('shard', shapes.shard()),
      plate: make('plate', shapes.plate()),
      rod: make('rod', shapes.rod()),
      casing: make('casing', shapes.casing()),
    };
  }

  /**
   * Starts a burst. Everything that stays constant across the burst is set once here, so a fixed
   * life gives the original's clean cut-off where a whole burst reaches zero on one frame.
   * `birth` is pre-aged by the caller so frame one already shows the burst opening.
   */
  begin(
    shape: ChipShape, color: Rgb, birth: number, life: number, gravity: number,
    floor: number, restitution = 0.35, friction = 0.6, shrinkStart = 0,
  ): this {
    this.ring = this.rings[shape];
    this.birth = birth;
    this.life = life;
    this.death = birth + life;
    this.cr = color.r;
    this.cg = color.g;
    this.cb = color.b;
    this.gravity = gravity > -0.01 ? -0.01 : gravity;
    this.floor = floor;
    this.restitution = restitution;
    this.friction = friction;
    this.shrinkStart = shrinkStart;
    return this;
  }

  /** Overrides life for one particle without breaking the rest of the burst state. */
  setLife(life: number): void {
    this.life = life;
    this.death = this.birth + life;
  }

  setColor(color: Rgb): void {
    this.cr = color.r;
    this.cg = color.g;
    this.cb = color.b;
  }

  add(
    x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number,
    spinX = 0, spinY = 0, spinZ = 0,
  ): void {
    const ring = this.ring;
    const d = ring.data;
    const o = ring.alloc(this.death);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = this.birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = this.life;
    d[o + 8] = this.cr;
    d[o + 9] = this.cg;
    d[o + 10] = this.cb;
    d[o + 11] = size;
    d[o + 12] = this.gravity;
    d[o + 13] = this.floor;
    d[o + 14] = this.restitution;
    d[o + 15] = this.friction;
    d[o + 16] = spinX;
    d[o + 17] = spinY;
    d[o + 18] = spinZ;
    d[o + 19] = this.shrinkStart;
  }

  sync(now: number): void {
    const r = this.rings;
    r.gem.sync(now);
    r.cube.sync(now);
    r.shard.sync(now);
    r.plate.sync(now);
    r.rod.sync(now);
    r.casing.sync(now);
  }

  clear(): void {
    for (const k in this.rings) this.rings[k as ChipShape].clear();
  }

  countLive(now: number): number {
    let n = 0;
    for (const k in this.rings) n += this.rings[k as ChipShape].countLive(now);
    return n;
  }
}
