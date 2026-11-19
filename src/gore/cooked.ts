/**
 * Cooked flesh. A loose piece of a burnt body is drawn as an instance whose colour says how burnt it is (`burnTint`,
 * gore/fire.ts: white is not at all), and three darkens a plain material by that colour by itself. That is not enough for
 * the wet materials gore's flesh is made of: a cut face or a lump of meat kept its shine and the breath of red it glows
 * with, so a charred piece still had a wet red face. `cookable` teaches such a material the rest: by how burnt its piece
 * is, the flesh goes to dry brown-black meat, matt, with no clearcoat and no glow of its own.
 */
import type * as THREE from 'three';
import { DevFlags } from '../core/devflags';

/**
 * Flesh dries, as the blood on the floor does (render/decalShader.glsl.ts: thin blood in seconds, a pool in a minute and
 * a half). A piece's instance colour carries the world time it was thrown in its green (`burnTint`), and from `from`
 * seconds after that to `over` more its wet faces dull: darker, browner, less shine, less of their own red. Tacky, not
 * matt: meat does not dry out like a film of blood. Without it a floor of dark dried stains was strewn with meat as wet
 * and bright as the second it landed. `DevFlags.dryFlesh` (`?dryflesh=0`) turns it off.
 */
export const DryTuning = { from: 14, over: 75 };

/** World time, for every material that dries: set by gore each frame (`Gore.update`). Negative: nothing dries. */
export const FleshClock = { value: -1 };

/** Sets the clock: the world's time, or the switch off. */
export function tickFlesh(now: number): void {
  FleshClock.value = DevFlags.dryFlesh ? now : -1;
}

/** Makes `material` (a standard or physical material, with or without vertex colours) cook by its instance colour. */
export function cookable<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = shader => {
    shader.uniforms.uFleshNow = FleshClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCooked;\nvarying float vBorn;')
      // three's own chunk, but for an instance's colour: only its red is a colour here (how burnt the piece is). Its green
      // is the time the piece was thrown, which is not something to multiply a colour by.
      .replace('#include <color_vertex>', `
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
        vColor = vec4( 1.0 );
        #endif
        #ifdef USE_COLOR_ALPHA
        vColor *= color;
        #elif defined( USE_COLOR )
        vColor.rgb *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
        vColor.rgb *= instanceColor.r;
        vCooked = clamp((1.0 - instanceColor.r) / 0.94, 0.0, 1.0);
        vBorn = instanceColor.g;
        #else
        vCooked = 0.0;
        vBorn = 1.0e9;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCooked;\nvarying float vBorn;\nuniform float uFleshNow;\nfloat fleshDry = 0.0;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // What three's own darkening left, put back to its brightness, then cooked: dark, brown, and a little paler where
          // the flesh was pale (fat, bone).
          float lum = dot(diffuseColor.rgb, vec3(0.5, 0.3, 0.2)) / max(1.0 - 0.94 * vCooked, 0.06);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.05, 0.034) * (0.35 + lum * 2.2), vCooked);
          // And drying: what is cooked is dry already.
          fleshDry = uFleshNow < 0.0 ? 0.0 : clamp((uFleshNow - vBorn - ${DryTuning.from.toFixed(1)}) / ${DryTuning.over.toFixed(1)}, 0.0, 1.0) * (1.0 - vCooked);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.58, 0.42, 0.42), fleshDry);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.56, fleshDry), 0.86, vCooked);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= (1.0 - vCooked) * (1.0 - 0.75 * fleshDry);\n#endif')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= (1.0 - vCooked) * (1.0 - 0.6 * fleshDry);');
  };
  return material;
}
