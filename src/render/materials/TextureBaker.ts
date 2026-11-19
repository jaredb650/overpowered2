import * as THREE from 'three';
import { FullscreenPass } from '../fullscreen';
import { SURFACE_HEAD, SURFACES_GLSL } from './surfaces.glsl';
import { NOISE_GLSL } from './noise.glsl';

export interface BakedSet {
  /** RGB albedo (sRGB), A height or coverage. */
  albedo: THREE.Texture;
  /** RG tangent normal, B roughness, A metalness (or heat for lava). */
  surface: THREE.Texture;
}

/** Height differences per texel turn into normals here. Higher is bumpier. */
const NORMAL_PASS = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform vec2 uTexel;
uniform float uStrength;
uniform float uMetalFromExtra;
in vec2 vUv;
layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outSurface;
float h(vec2 o) { return texture(tA, vUv + o * uTexel).a; }
void main() {
  float l = h(vec2(-1.0, 0.0)), r = h(vec2(1.0, 0.0)), d = h(vec2(0.0, -1.0)), u = h(vec2(0.0, 1.0));
  float ld = h(vec2(-1.0, -1.0)), rd = h(vec2(1.0, -1.0)), lu = h(vec2(-1.0, 1.0)), ru = h(vec2(1.0, 1.0));
  float dx = (r * 2.0 + ru + rd - l * 2.0 - lu - ld) * 0.25;
  float dy = (u * 2.0 + ru + lu - d * 2.0 - ld - rd) * 0.25;
  vec3 n = normalize(vec3(-dx * uStrength, -dy * uStrength, 1.0));
  vec4 a = texture(tA, vUv);
  vec4 b = texture(tB, vUv);
  outAlbedo = vec4(a.rgb, mix(a.a, b.b, uMetalFromExtra));
  outSurface = vec4(n.xy * 0.5 + 0.5, b.r, mix(b.g, b.b, step(1.5, uMetalFromExtra)));
}`;

function surfacePass(name: string): FullscreenPass {
  return new FullscreenPass(/* glsl */ `
${SURFACES_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
void main() {
  Surf s = surface_${name}(vUv);
  outA = vec4(s.albedo, s.height);
  outB = vec4(s.rough, s.metal, s.extra, 1.0);
}`, {});
}

/** Generates every texture on the GPU at load. Render targets stay alive because their textures are in use. */
export class TextureBaker {
  private scratch: THREE.WebGLRenderTarget | null = null;
  private readonly normalPass = new FullscreenPass(NORMAL_PASS, {
    tA: { value: null }, tB: { value: null }, uTexel: { value: new THREE.Vector2() }, uStrength: { value: 1 }, uMetalFromExtra: { value: 0 },
  });

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly anisotropy: number) {}

  private scratchFor(size: number, height = size): THREE.WebGLRenderTarget {
    if (this.scratch?.width !== size || this.scratch.height !== height) {
      this.scratch?.dispose();
      // Heights need more than 8 bits or the derived normals stair-step.
      this.scratch = new THREE.WebGLRenderTarget(size, height, {
        count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      });
      for (const t of this.scratch.textures) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }
    return this.scratch;
  }

  /**
   * `extraMode`: 0 puts height in albedo alpha, 1 puts extra (coverage) there, 2 puts extra in the
   * metal channel for surfaces that use it as a separate signal. Normals always come from height. `height` is for a
   * sheet that is not square (the decal atlas); texels stay square.
   */
  bake(name: string, size: number, normalStrength: number, extraMode: 0 | 1 | 2 = 0, height = size): BakedSet {
    const scratch = this.scratchFor(size, height);
    const pass = surfacePass(name);
    pass.render(this.renderer, scratch);
    pass.dispose();
    return this.finish(scratch, size, height, normalStrength, extraMode);
  }

  /** Heights to normals, and the two finished textures. */
  private finish(scratch: THREE.WebGLRenderTarget, size: number, height: number, normalStrength: number, extraMode: 0 | 1 | 2): BakedSet {
    const out = new THREE.WebGLRenderTarget(size, height, {
      count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: this.anisotropy,
    });
    out.textures[0]!.colorSpace = THREE.SRGBColorSpace;
    for (const t of out.textures) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const u = this.normalPass.uniforms;
    u.tA!.value = scratch.textures[0];
    u.tB!.value = scratch.textures[1];
    (u.uTexel!.value as THREE.Vector2).set(1 / size, 1 / height);
    u.uStrength!.value = normalStrength;
    u.uMetalFromExtra!.value = extraMode;
    this.normalPass.render(this.renderer, out);
    return { albedo: out.textures[0]!, surface: out.textures[1]! };
  }

  /**
   * A sheet drawn in parts: each `parts[i]` is a whole surface shader but for the prelude, with a `surface_decals` that
   * returns `extra` below zero for the pixels that are another part's, which are left as they are. Each part is
   * compiled in the background and drawn when it is ready, so a sheet too big to compile in one go holds nothing up.
   * `timed`: wait for the GPU and log what each part cost.
   */
  async bakeParts(parts: readonly string[], size: number, normalStrength: number, extraMode: 0 | 1 | 2, height: number, timed = false): Promise<BakedSet> {
    const scratch = this.scratchFor(size, height);
    const gl = this.renderer.getContext();
    const wait = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    // `?bakeTime=cold`: a line that changes every load, so the browser's shader cache cannot answer and the compile is timed.
    const cold = timed && location.search.includes('bakeTime=cold') ? `#define OP_COLD ${Math.random()}` : '';
    const passes = parts.map(part => new FullscreenPass(/* glsl */ `
${cold}
${SURFACE_HEAD}
${part}
in vec2 vUv;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
void main() {
  Surf s = surface_decals(vUv);
  if (s.extra < -0.5) discard;
  outA = vec4(s.albedo, s.height);
  outB = vec4(s.rough, s.metal, s.extra, 1.0);
}`, {}));
    const t0 = performance.now();
    // All at once: the browser compiles them side by side, so the wait is the slowest one's and not their sum.
    await Promise.all(passes.map(pass => pass.compile(this.renderer, scratch)));
    const t1 = performance.now();
    passes.forEach((pass, i) => {
      // The first part clears what the scratch target last held; the rest draw over it.
      pass.render(this.renderer, scratch, i > 0);
      pass.dispose();
    });
    if (timed) {
      wait();
      console.log(`[bake] sheet: ${parts.length} parts compiled in ${(t1 - t0).toFixed(0)} ms (in the background), drawn in ${(performance.now() - t1).toFixed(0)} ms`);
    }
    return this.finish(scratch, size, height, normalStrength, extraMode);
  }

  /** R, G, B: fBm at three scales. A: white noise. Tiles at 256 px. Used for macro variation and clouds. */
  noiseTexture(): THREE.Texture {
    const pass = new FullscreenPass(/* glsl */ `
${NOISE_GLSL}
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = vec4(fbm(vUv, ivec2(4), 6, 1u), fbm(vUv, ivec2(9), 5, 2u), fbm(vUv, ivec2(22), 4, 3u), hash1(ivec2(gl_FragCoord.xy), 4u));
}`, {});
    const target = new THREE.WebGLRenderTarget(256, 256, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    target.texture.wrapS = target.texture.wrapT = THREE.RepeatWrapping;
    pass.render(this.renderer, target);
    pass.dispose();
    return target.texture;
  }

  dispose(): void {
    this.scratch?.dispose();
    this.scratch = null;
    this.normalPass.dispose();
  }
}
