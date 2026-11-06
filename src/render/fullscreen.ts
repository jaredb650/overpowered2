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
    if (!keepContents && target) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, INVALIDATE_COLOR);
    }
    renderer.render(this.scene, dummyCamera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

const INVALIDATE_COLOR = [0x8ce0 /* COLOR_ATTACHMENT0 */];
