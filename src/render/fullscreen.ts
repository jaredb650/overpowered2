import * as THREE from 'three';

const triangle = new THREE.BufferGeometry();
triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const dummyCamera = new THREE.Camera();

export const FULLSCREEN_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export type Uniforms = Record<string, THREE.IUniform>;

/**
 * Dynamic resolution renders into the corner of a target allocated at full size, so changing resolution
 * allocates nothing. Reading such a target takes two numbers: `scale` turns 0..1 across the used area into
 * texture uv, and `edge` is the last uv a bilinear tap can use without pulling in stale pixels from past the
 * area. The viewport is the area.
 */
export function readArea(target: THREE.WebGLRenderTarget, scale: THREE.Vector2, edge: THREE.Vector2): void {
  const { z, w } = target.viewport;
  scale.set(z / target.width, w / target.height);
  edge.set((z - 0.5) / target.width, (w - 0.5) / target.height);
}

/** One full-screen triangle with a raw GLSL3 fragment shader. Writes straight to whatever target it is given. */
export class FullscreenPass {
  readonly material: THREE.RawShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly scene = new THREE.Scene();

  constructor(fragmentShader: string, uniforms: Uniforms, defines: Record<string, string | number> = {}) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `precision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler3D;\nprecision highp sampler2DShadow;\n${fragmentShader}`,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(triangle, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.scene.matrixWorldAutoUpdate = false;
  }

  get uniforms(): Uniforms {
    return this.material.uniforms;
  }

  /**
   * Draws into `target`. The previous contents are invalidated first: without this a tiler reloads
   * the whole target from memory before the pass overwrites every pixel of it.
   */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, keepContents = false): void {
    renderer.setRenderTarget(target);
    if (!keepContents) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, target ? INVALIDATE_COLOR : INVALIDATE_DEFAULT_COLOR);
    }
    renderer.render(this.scene, dummyCamera);
  }

  /**
   * Compiles the shader without holding the page up for it, where the browser can (KHR_parallel_shader_compile; else it
   * compiles at once). `target` must be what `render` will draw into: the program is keyed on it.
   */
  async compile(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): Promise<void> {
    renderer.setRenderTarget(target);
    await renderer.compileAsync(this.scene, dummyCamera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

const INVALIDATE_COLOR = [0x8ce0 /* COLOR_ATTACHMENT0 */];
const INVALIDATE_DEFAULT_COLOR = [0x1800 /* COLOR */];
