/**
 * Cooked flesh. A loose piece of a burnt body is drawn as an instance whose colour says how burnt it is (`burnTint`,
 * gore/fire.ts: white is not at all), and three darkens a plain material by that colour by itself. That is not enough for
 * the wet materials gore's flesh is made of: a cut face or a lump of meat kept its shine and the breath of red it glows
 * with, so a charred piece still had a wet red face. `cookable` teaches such a material the rest: by how burnt its piece
 * is, the flesh goes to dry brown-black meat, matt, with no clearcoat and no glow of its own.
 */
import type * as THREE from 'three';

/** Makes `material` (a standard or physical material, with or without vertex colours) cook by its instance colour. */
export function cookable<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCooked;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
        vCooked = clamp((1.0 - instanceColor.r) / 0.94, 0.0, 1.0);
        #else
        vCooked = 0.0;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCooked;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // What three's own darkening left, put back to its brightness, then cooked: dark, brown, and a little paler where
          // the flesh was pale (fat, bone).
          float lum = dot(diffuseColor.rgb, vec3(0.5, 0.3, 0.2)) / max(1.0 - 0.94 * vCooked, 0.06);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.05, 0.034) * (0.35 + lum * 2.2), vCooked);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.86, vCooked);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - vCooked;\n#endif')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 - vCooked;');
  };
  return material;
}
