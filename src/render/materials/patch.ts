import * as THREE from 'three';
import type { EngineUniforms } from '../engine';

/**
 * Injects the engine's lighting into MeshStandardMaterial programs: baked light volume, moon shadow,
 * reflection occlusion and baked specular. Everything is derived in the fragment shader from
 * vViewPosition and opCamToWorld, which is why the same patch works in the viewmodel scene, on skinned
 * meshes and on instanced meshes without any vertex-shader changes.
 */

const PARS_COMMON = /* glsl */ `
uniform mat4 opCamToWorld;
#ifndef OPAQUE
uniform highp sampler2D opFogTex;
uniform vec2 opTargetSize;
uniform float opViewPass;
#endif
`;

const PARS_LIGHTING = /* glsl */ `
uniform highp sampler3D opVol0;
uniform highp sampler3D opVol1;
uniform highp sampler3D opVol2;
uniform highp sampler3D opVol3;
uniform vec3 opVolOrigin;
uniform vec3 opVolInvSize;
uniform vec2 opVolInfo;
uniform highp sampler2DShadow opShadowS;
uniform highp sampler2DShadow opShadowD;
uniform mat4 opShadowMatS;
uniform mat4 opShadowMatD;
uniform vec4 opShadowInfo;
uniform float opShadowAmount;
uniform vec3 opAmbientFloor;
uniform vec3 opMoonDir;
uniform int opActiveLights;
uniform int opPoolLights;

const vec2 OP_PCF[8] = vec2[8](
  vec2(-0.326, -0.406), vec2(0.422, -0.312), vec2(-0.840, 0.074), vec2(0.962, 0.195),
  vec2(-0.203, 0.621), vec2(0.385, 0.757), vec2(-0.521, -0.857), vec2(0.185, -0.893)
);

float opPcf(highp sampler2DShadow map, vec3 c, float radius) {
#if OP_SHADOW_TAPS <= 1
  return texture(map, c);
#else
  float sum = 0.0;
  for (int i = 0; i < OP_SHADOW_TAPS; i++) {
    sum += texture(map, vec3(c.xy + OP_PCF[i] * radius, c.z));
  }
  return sum * (1.0 / float(OP_SHADOW_TAPS));
#endif
}

float opMoonVisibility(vec3 wp, vec3 wn) {
  float vis = 1.0;
  vec3 s = (opShadowMatS * vec4(wp + wn * (opShadowInfo.z * 1.6), 1.0)).xyz;
  if (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0 && s.z < 1.0) vis = opPcf(opShadowS, s, opShadowInfo.x * 1.6);
  // Already in full shadow, or dynamic shadow map disabled, so skip the dynamic lookup.
  if (vis > 0.0 && opShadowInfo.y > 0.0) {
    vec3 d = (opShadowMatD * vec4(wp + wn * (opShadowInfo.w * 1.6), 1.0)).xyz;
    if (d.x > 0.0 && d.x < 1.0 && d.y > 0.0 && d.y < 1.0 && d.z < 1.0) vis = min(vis, opPcf(opShadowD, d, opShadowInfo.y * 1.6));
  }
  return mix(1.0, vis, opShadowAmount);
}
`;

/** Runs before three's light loop, where geometryPosition is not yet declared. */
const WORLD_POSITION = /* glsl */ `
vec3 opWP = (opCamToWorld * vec4(-vViewPosition, 1.0)).xyz;
vec3 opWN = mat3(opCamToWorld) * normal;
// A surface turned away from the moon gets none of its light, so the answer cannot matter. That is a third of
// the pixels on most views, and shadow lookups are the dearest thing here.
float opMoonVis = receiveShadow && opShadowAmount > 0.0 && dot(opWN, opMoonDir) > 0.0 ? opMoonVisibility(opWP, opWN) : 1.0;
`;

const VOLUME_LIGHTING = /* glsl */ `
{
  vec3 opUvw = (opWP + opWN * opVolInfo.y - opVolOrigin) * opVolInvSize;
  vec4 opV0 = texture(opVol0, opUvw);
  vec3 opC0 = opV0.rgb;
  // L1 volumes are stored normalized to [-1, 1] over 2 * c0 as RGBA8 (127 = exact zero).
  vec3 opL1Scale = opC0 * (2.0 / 127.0);
  vec3 opCr = (texture(opVol1, opUvw).xyz * 255.0 - 127.0) * opL1Scale.r;
  vec3 opCg = (texture(opVol2, opUvw).xyz * 255.0 - 127.0) * opL1Scale.g;
  vec3 opCb = (texture(opVol3, opUvw).xyz * 255.0 - 127.0) * opL1Scale.b;

  // Non-linear L1 reconstruction (Geomerics), shared across both normal (diffuse) and reflection lookups.
  vec3 opShLen = vec3(length(opCr), length(opCg), length(opCb));
  vec3 opShInvLen = 1.0 / max(opShLen, vec3(1e-5));
  vec3 opShR = min(opShLen / (2.0 * max(opC0, vec3(1e-6))), vec3(0.98));
  vec3 opShP = 1.0 + 2.0 * opShR;
  vec3 opShA = (1.0 - opShR) / (1.0 + opShR);
  vec3 opShScale = (1.0 - opShA) * (opShP + 1.0);
  vec3 opShValid = step(vec3(1e-5), opShLen) * step(vec3(1e-6), opC0);
  vec3 opShFallback = max(opC0, vec3(0.0));

  vec3 opQn = max(0.5 + 0.5 * vec3(dot(opWN, opCr), dot(opWN, opCg), dot(opWN, opCb)) * opShInvLen, vec3(0.0));
  vec3 opDiffIrr = mix(opShFallback, opC0 * (opShA + opShScale * pow(opQn, opShP)), opShValid);

  // iblIrradiance rather than irradiance: it passes through three's multi-scatter split, so diffuse
  // gives up exactly the energy the specular lobe took.
  iblIrradiance = max(opDiffIrr, opAmbientFloor);

  vec3 opR = mat3(opCamToWorld) * reflect(-geometryViewDir, geometryNormal);
  vec3 opQr = max(0.5 + 0.5 * vec3(dot(opR, opCr), dot(opR, opCg), dot(opR, opCb)) * opShInvLen, vec3(0.0));
  vec3 opReflIrr = mix(opShFallback, opC0 * (opShA + opShScale * pow(opQr, opShP)), opShValid);

  float opSkyVis = opV0.a;
  // The sky is only reflected where the sky is visible. The rest of the reflection comes from the
  // volume itself, so metal indoors picks up the colour of the nearby lights instead of going black.
  // A smooth surface at a grazing angle would mirror the whole bright horizon, which turns wet
  // ground into pale sheets. Screen-space reflections fill in what is actually there.
  radiance *= smoothstep(0.02, 0.7, opSkyVis) * mix(0.42, 1.0, smoothstep(0.05, 0.3, material.roughness));
  radiance += opReflIrr * RECIPROCAL_PI;

  // Treats the volume's dominant direction as one soft light, which gives wet floors a real sheen
  // toward whatever lights the room.
  const vec3 opLuma = vec3(0.2126, 0.7152, 0.0722);
  vec3 opC1 = opCr * opLuma.r + opCg * opLuma.g + opCb * opLuma.b;
  float opLen = length(opC1);
  if (opLen > 1e-4) {
    vec3 opDom = opC1 / opLen;
    vec3 opDomView = opDom * mat3(opCamToWorld);
    float opNdL = saturate(dot(geometryNormal, opDomView));
    if (opNdL > 0.0) {
      // Capped, because the volume peaks right next to a lamp and glossy tile turns that into a hot spot.
      vec3 opDomCol = min(max(vec3(dot(opCr, opDom), dot(opCg, opDom), dot(opCb, opDom)) * 1.3, vec3(0.0)), vec3(3.0));
      PhysicalMaterial opSoft = material;
      opSoft.roughness = max(material.roughness, 0.22);
      reflectedLight.directSpecular += opDomCol * opNdL * BRDF_GGX(opDomView, geometryViewDir, geometryNormal, opSoft);
    }
  }
}
`;

/**
 * The scene target's alpha is unused by opaque geometry, so it carries 1 - reflectivity to the
 * screen-space reflection pass. Unpatched materials write 1 and stay out of it.
 */
const REFLECTIVITY = /* glsl */ `
#ifdef OPAQUE
if (material.roughness < 0.4) {
  float opNV = saturate(dot(geometryNormal, geometryViewDir));
  float opF0 = max(material.specularColorBlended.r, max(material.specularColorBlended.g, material.specularColorBlended.b));
  float op1m = 1.0 - opNV;
  float op1m2 = op1m * op1m;
  float opFres = opF0 + (1.0 - opF0) * (op1m2 * op1m2 * op1m);
  gl_FragColor.a = 1.0 - opFres * (1.0 - smoothstep(0.06, 0.4, material.roughness));
} else {
  gl_FragColor.a = 1.0;
}
#endif
`;

/**
 * Post fog runs before transparent surfaces are drawn, so glass would otherwise stay crisp at any
 * distance. It takes the veil from the fog result behind it.
 */
const TRANSPARENT_FOG = /* glsl */ `
#ifndef OPAQUE
if (opViewPass < 0.5) {
  vec4 opFog = texture(opFogTex, gl_FragCoord.xy / opTargetSize);
  gl_FragColor.rgb *= opFog.a;
}
#endif
`;

function replaceRequired(source: string, anchor: string, replacement: string, label: string): string {
  if (!source.includes(anchor)) {
    console.warn(`[render] patch: anchor ${anchor} missing in ${label}; an earlier onBeforeCompile removed it`);
    return source;
  }
  return source.replace(anchor, replacement);
}

/**
 * The pool keeps a constant light count so shaders never recompile, and most slots are idle at zero colour.
 * three unrolls this loop, which puts eight copies of the BRDF in every lit shader. Kept as a real loop, a uniform
 * test skips idle slots before any per-pixel work and the program stays small enough to run with useful occupancy.
 */
const POINT_LIGHT_LOOP = /* glsl */ `
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
  if ( i >= opActiveLights && i < opPoolLights ) {
    if ( NUM_POINT_LIGHTS <= opPoolLights ) break;
    continue;
  }
  if ( pointLights[ i ].color == vec3( 0.0 ) ) continue;
  getPointLightInfo( pointLights[ i ], geometryPosition, directLight );
  if ( directLight.visible ) RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
#endif
`;

/** three's light loops with the moon shadow, and the point loop above in place of its own. */
function lightLoopChunk(): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= opMoonVis;',
  );
  const start = chunk.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  const end = chunk.indexOf('#endif', chunk.indexOf('#pragma unroll_loop_end', start)) + '#endif'.length;
  // The weapon light is one spotlight, dark or out of its cone for most pixels: skip the BRDF there, as the point loop does.
  const call = chunk.indexOf('RE_Direct(', chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'));
  const spot = `${chunk.slice(end, call)}if ( directLight.visible ) ${chunk.slice(call)}`;
  return `${chunk.slice(0, start)}${POINT_LIGHT_LOOP}${spot}`;
}

function envChunk(): string {
  // The viewmodel camera sits at its own origin, so three's viewMatrix would freeze reflections on
  // the gun. opCamToWorld is the main camera in both passes.
  return THREE.ShaderChunk.envmap_physical_pars_fragment
    .replaceAll('transformDirectionByInverseViewMatrix( reflectVec, viewMatrix )', '( mat3( opCamToWorld ) * reflectVec )')
    .replaceAll('transformDirectionByInverseViewMatrix( retroVec, viewMatrix )', '( mat3( opCamToWorld ) * retroVec )')
    .replaceAll('transformNormalByInverseViewMatrix( normal, viewMatrix )', '( mat3( opCamToWorld ) * normal )');
}

export type ShaderHook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

export type PatcherUniforms = EngineUniforms & {
  opActiveLights: { value: number };
  opPoolLights: { value: number };
};

export class MaterialPatcher {
  private readonly patched = new WeakSet<THREE.Material>();
  private readonly live = new Set<WeakRef<THREE.Material>>();
  private readonly loopChunk = lightLoopChunk();
  private readonly envPars = envChunk();
  private shadowTaps: number;

  constructor(private readonly uniforms: PatcherUniforms, shadowTaps = 4) {
    this.shadowTaps = Math.max(1, Math.min(8, Math.round(shadowTaps)));
  }

  /** Updates the compiled PCF tap count. Only called on quality preset changes. */
  setShadowTaps(taps: number): void {
    const next = Math.max(1, Math.min(8, Math.round(taps)));
    if (next === this.shadowTaps) return;
    this.shadowTaps = next;
    for (const ref of this.live) {
      const m = ref.deref();
      if (m) m.needsUpdate = true;
      else this.live.delete(ref);
    }
  }

  inject(shader: THREE.WebGLProgramParametersWithUniforms, label: string): void {
    Object.assign(shader.uniforms, this.uniforms);
    let f = shader.fragmentShader;
    f = replaceRequired(f, '#include <common>', `#include <common>\n${PARS_COMMON}`, label);
    f = replaceRequired(f, '#include <envmap_physical_pars_fragment>', this.envPars, label);
    f = replaceRequired(f, '#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n#define OP_SHADOW_TAPS ${this.shadowTaps}\n${PARS_LIGHTING}`, label);
    f = replaceRequired(f, '#include <lights_fragment_begin>', `${WORLD_POSITION}\n${this.loopChunk}`, label);
    f = replaceRequired(f, '#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${VOLUME_LIGHTING}`, label);
    f = replaceRequired(f, '#include <opaque_fragment>', `#include <opaque_fragment>\n${REFLECTIVITY}\n${TRANSPARENT_FOG}`, label);
    shader.fragmentShader = f;
  }

  /**
   * Layers the engine on top of whatever onBeforeCompile the material has, or gets later. Assignments
   * after patch() go through an accessor, so the character agent can set its hook in either order.
   */
  apply<T extends THREE.MeshStandardMaterial>(material: T, surfaceHook?: ShaderHook, key = ''): T {
    if (this.patched.has(material)) return material;
    this.patched.add(material);
    this.live.add(new WeakRef(material));
    let userHook = material.onBeforeCompile;
    let userKey = material.customProgramCacheKey;
    const self = this;
    const wrapped = function (this: unknown, shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) {
      userHook.call(material, shader, renderer);
      surfaceHook?.(shader, renderer);
      self.inject(shader, material.name || material.type);
    };
    // The default key is the hook's source text, and here that would read back `wrapped` for every
    // material. Two different hooks would then share one program, so it has to come from the user's hook.
    const wrappedKey = () => `op2:${self.shadowTaps}:${key}:${userKey === defaultKey ? userHook.toString() : userKey.call(material)}`;
    Object.defineProperty(material, 'onBeforeCompile', {
      configurable: true,
      get: () => wrapped,
      set: (fn: typeof userHook) => {
        userHook = fn;
        material.needsUpdate = true;
      },
    });
    Object.defineProperty(material, 'customProgramCacheKey', {
      configurable: true,
      get: () => wrappedKey,
      set: (fn: typeof userKey) => {
        userKey = fn;
        material.needsUpdate = true;
      },
    });
    material.needsUpdate = true;
    return material;
  }
}

const defaultKey = THREE.Material.prototype.customProgramCacheKey;
