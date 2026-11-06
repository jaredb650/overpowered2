import * as THREE from 'three';
import { FullscreenPass } from '../fullscreen';
import { SURFACES_GLSL } from './surfaces.glsl';
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

  private scratchFor(size: number): THREE.WebGLRenderTarget {
    if (this.scratch?.width !== size) {
      this.scratch?.dispose();
      // Heights need more than 8 bits or the derived normals stair-step.
      this.scratch = new THREE.WebGLRenderTarget(size, size, {
        count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      });
      for (const t of this.scratch.textures) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }
    return this.scratch;
  }

  /**
   * `extraMode`: 0 puts height in albedo alpha, 1 puts extra (coverage) there, 2 puts extra in the
   * metal channel for surfaces that use it as a separate signal. Normals always come from height.
   */
  bake(name: string, size: number, normalStrength: number, extraMode: 0 | 1 | 2 = 0): BakedSet {
    const scratch = this.scratchFor(size);
    const pass = surfacePass(name);
    pass.render(this.renderer, scratch);
    pass.dispose();
    const out = new THREE.WebGLRenderTarget(size, size, {
      count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: this.anisotropy,
    });
    out.textures[0]!.colorSpace = THREE.SRGBColorSpace;
    for (const t of out.textures) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const u = this.normalPass.uniforms;
    u.tA!.value = scratch.textures[0];
    u.tB!.value = scratch.textures[1];
    (u.uTexel!.value as THREE.Vector2).set(1 / size, 1 / size);
    u.uStrength!.value = normalStrength;
    u.uMetalFromExtra!.value = extraMode;
    this.normalPass.render(this.renderer, out);
    return { albedo: out.textures[0]!, surface: out.textures[1]! };
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
