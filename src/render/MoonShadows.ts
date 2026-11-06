import * as THREE from 'three';
import type { EngineUniforms } from './engine';

const LIGHT_DEPTH = 900;
const DYNAMIC_HALF = 34;

const _center = new THREE.Vector3();
const _target = new THREE.Vector3();
const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _light = new THREE.Vector3();

function makeMap(size: number): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedShortType);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.compareFunction = THREE.LessEqualCompare;
  depthTexture.magFilter = depthTexture.minFilter = THREE.LinearFilter;
  // three always attaches a colour buffer, so it may as well be the smallest one there is.
  return new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RedFormat, type: THREE.UnsignedByteType, depthTexture, depthBuffer: true,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
  });
}

export type ShadowPassKind = 'static' | 'dynamic';

/**
 * Moon shadows in two layers. The whole map is rendered once into a big static map and never again.
 * Every frame, only things that move are drawn into a small map that follows the player, and shaders
 * take the darker of the two. World geometry therefore costs nothing per frame.
 */
export class MoonShadows {
  private staticMap: THREE.WebGLRenderTarget | null = null;
  private dynamicMap: THREE.WebGLRenderTarget | null = null;
  private readonly staticCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, LIGHT_DEPTH);
  private readonly dynamicCamera = new THREE.OrthographicCamera(-DYNAMIC_HALF, DYNAMIC_HALF, DYNAMIC_HALF, -DYNAMIC_HALF, 1, LIGHT_DEPTH);
  private readonly depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
  private bounds = new THREE.Box3(new THREE.Vector3(-170, -10, -170), new THREE.Vector3(170, 60, 170));
  private staticDirty = false;

  constructor(private readonly engine: EngineUniforms) {}

  /** Static shadow map as a comparison sampler, for the fog march. */
  get staticTexture(): THREE.DepthTexture | null {
    return this.staticMap?.depthTexture ?? null;
  }

  setSizes(staticSize: number, dynamicSize: number): void {
    if (this.staticMap?.width !== staticSize) {
      this.staticMap?.dispose();
      this.staticMap = makeMap(staticSize);
      this.staticDirty = true;
    }
    if ((this.dynamicMap?.width ?? 0) !== dynamicSize) {
      this.dynamicMap?.dispose();
      this.dynamicMap = dynamicSize > 0 ? makeMap(dynamicSize) : null;
    }
    this.engine.opShadowS.value = this.staticMap!.depthTexture;
    this.engine.opShadowD.value = this.dynamicMap?.depthTexture ?? null;
  }

  setBounds(bounds: THREE.Box3): void {
    this.bounds.copy(bounds);
    this.staticDirty = true;
  }

  /** Requests one re-render of the static layer, after the map changes. */
  invalidateStatic(): void {
    this.staticDirty = true;
  }

  private place(cam: THREE.OrthographicCamera, center: THREE.Vector3): void {
    _light.copy(this.engine.opMoonDir.value);
    cam.position.copy(center).addScaledVector(_light, LIGHT_DEPTH * 0.5);
    cam.up.set(0, 1, 0);
    cam.lookAt(center);
    cam.updateMatrixWorld();
  }

  /** Runs the passes this frame needs. `draw` renders the scene with a caster filter into the current target. */
  update(renderer: THREE.WebGLRenderer, mainCamera: THREE.Camera, scene: THREE.Scene, draw: (kind: ShadowPassKind, camera: THREE.Camera) => void): void {
    if (this.staticDirty && this.staticMap) {
      this.staticDirty = false;
      const size = this.bounds.getSize(_target);
      const half = Math.hypot(size.x, size.y, size.z) * 0.5;
      this.bounds.getCenter(_center);
      const cam = this.staticCamera;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
      this.place(cam, _center);
      renderer.setRenderTarget(this.staticMap);
      renderer.clear(true, true, false);
      scene.overrideMaterial = this.depthMaterial;
      draw('static', cam);
      scene.overrideMaterial = null;
      this.engine.opShadowMatS.value.copy(_bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      const texel = (half * 2) / this.staticMap.width;
      this.engine.opShadowInfo.value.x = 1 / this.staticMap.width;
      this.engine.opShadowInfo.value.z = texel;
    }

    if (this.dynamicMap) {
      const cam = this.dynamicCamera;
      // Snap the centre to whole texels in light space, or moving the camera crawls every shadow edge.
      const texel = (DYNAMIC_HALF * 2) / this.dynamicMap.width;
      _center.setFromMatrixPosition(mainCamera.matrixWorld);
      this.place(cam, _center);
      _target.copy(_center).applyMatrix4(cam.matrixWorldInverse);
      _target.x = Math.round(_target.x / texel) * texel;
      _target.y = Math.round(_target.y / texel) * texel;
      _target.applyMatrix4(cam.matrixWorld);
      this.place(cam, _target);
      renderer.setRenderTarget(this.dynamicMap);
      renderer.clear(true, true, false);
      scene.overrideMaterial = this.depthMaterial;
      draw('dynamic', cam);
      scene.overrideMaterial = null;
      this.engine.opShadowMatD.value.copy(_bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      this.engine.opShadowInfo.value.y = 1 / this.dynamicMap.width;
      this.engine.opShadowInfo.value.w = texel;
    } else {
      // A zero matrix puts every point outside the map, so the shader's range check fails.
      this.engine.opShadowMatD.value.set(0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, 1);
    }
  }

  dispose(): void {
    this.staticMap?.dispose();
    this.dynamicMap?.dispose();
    this.depthMaterial.dispose();
  }
}
