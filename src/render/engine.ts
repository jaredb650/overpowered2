import * as THREE from 'three';

/**
 * Uniform objects shared by reference between every patched material and post pass. Writing `.value`
 * once updates all of them, which is what makes the light volume and shadows O(1) to hook up.
 */
export function createEngineUniforms() {
  return {
    /** Main camera world matrix. Fragment shaders derive world position from this plus vViewPosition, so the viewmodel pass needs no special case. */
    opCamToWorld: { value: new THREE.Matrix4() },
    opVol0: { value: null as THREE.Texture | null },
    opVol1: { value: null as THREE.Texture | null },
    opVol2: { value: null as THREE.Texture | null },
    opVol3: { value: null as THREE.Texture | null },
    opVolOrigin: { value: new THREE.Vector3(-1, -1, -1) },
    opVolInvSize: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    /** x: cell size in meters, y: surface bias in meters. */
    opVolInfo: { value: new THREE.Vector2(1, 0.75) },
    opShadowS: { value: null as THREE.Texture | null },
    opShadowD: { value: null as THREE.Texture | null },
    opShadowMatS: { value: new THREE.Matrix4() },
    opShadowMatD: { value: new THREE.Matrix4() },
    /** x: static texel, y: dynamic texel, z: static world texel size, w: dynamic world texel size. */
    opShadowInfo: { value: new THREE.Vector4(1 / 2048, 1 / 1024, 0.2, 0.05) },
    /** 1 applies moon shadows, 0 ignores them. For the pass toggles. */
    opShadowAmount: { value: 1 },
    opMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    opMoonColor: { value: new THREE.Color(0, 0, 0) },
    /** Least irradiance anywhere, so an unlit tunnel stays readable instead of going black. */
    opAmbientFloor: { value: new THREE.Vector3(0.05, 0.065, 0.09) },
    opTime: { value: 0 },
    /** Finished fog, for patched transparent surfaces. rgb in-scatter, a transmittance. */
    opFogTex: { value: null as THREE.Texture | null },
    /** Size of the scene target in pixels. */
    opTargetSize: { value: new THREE.Vector2(1, 1) },
    /** 1 while the viewmodel scene renders. */
    opViewPass: { value: 0 },
    opNoise: { value: null as THREE.Texture | null },
  };
}

export type EngineUniforms = ReturnType<typeof createEngineUniforms>;

/**
 * The viewmodel shares the world's depth buffer. It is drawn first, squeezed into this slice of the
 * depth range, so one MSAA target and one resolve serve both passes and nothing in the world can
 * clip through it. Any depth under this value is a viewmodel pixel.
 */
export const VIEW_DEPTH_MAX = 0.02;
