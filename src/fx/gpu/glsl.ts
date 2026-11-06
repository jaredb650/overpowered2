/** GLSL shared by the particle classes. */

export const COMMON_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
/** World size of one pixel at one meter of view depth. */
uniform float uPixelWorld;
uniform float uFogDensity;
uniform float uFogAmount;
uniform vec3 uFogColor;

float hash11(float n) { return fract(sin(n) * 43758.5453123); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }

/** A distant effect should drift toward the haze, but much more slowly than the world so violence stays legible. */
vec3 applyFog(vec3 c, float viewDepth) {
  float f = 1.0 - exp(-uFogDensity * uFogDensity * viewDepth * viewDepth);
  return mix(c, uFogColor, f * uFogAmount);
}

vec3 rotateAxis(vec3 v, vec3 axis, float a) {
  float s = sin(a), c = cos(a);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

/**
 * Exact ballistic path with up to four floor bounces, gravity g < 0. Velocity and the time spent
 * moving come back out so spin can stop when the particle does. This is what lets chips land
 * without the CPU ever touching them after emission.
 */
vec3 ballistic(vec3 p, vec3 v, float g, float floorY, float e, float fr, float t,
               out vec3 vel, out float moved, out float rest) {
  float tr = t;
  rest = 0.0;
  moved = t;
  for (int i = 0; i < 4; i++) {
    float h = p.y - floorY;
    float disc = v.y * v.y - 2.0 * g * h;
    if (h < 0.0 || disc < 0.0) break;
    float tc = (-v.y - sqrt(disc)) / g;
    if (tr < tc) break;
    p += v * tc;
    p.y = floorY;
    float vy = v.y + g * tc;
    v.y = -vy * e;
    v.xz *= fr;
    tr -= tc;
    if (v.y < 1.2) {
      rest = 1.0;
      moved = t - tr;
      vel = vec3(0.0);
      return p;
    }
  }
  vel = vec3(v.x, v.y + g * tr, v.z);
  return p + v * tr + vec3(0.0, 0.5 * g * tr * tr, 0.0);
}

/** Exponential drag with constant acceleration a, closed form. */
vec3 dragged(vec3 p, vec3 v, vec3 a, float k, float t, out vec3 vel) {
  float kk = max(k, 0.001);
  float ex = exp(-kk * t);
  float f = (1.0 - ex) / kk;
  vel = v * ex + a * f;
  return p + v * f + a * (t - f) / kk;
}
`;

/** Depth fade for soft particles. Compiled in only when the renderer publishes a depth texture. */
export const SOFT_FRAG = /* glsl */ `
#ifdef SOFT_DEPTH
#include <packing>
uniform sampler2D uDepth;
uniform vec2 uNearFar;
uniform vec2 uDepthRes;
float softFade(float viewZ, float dist) {
  float d = texture2D(uDepth, gl_FragCoord.xy / uDepthRes).r;
  float sceneZ = perspectiveDepthToViewZ(d, uNearFar.x, uNearFar.y);
  return clamp((viewZ - sceneZ) / dist, 0.0, 1.0);
}
#else
float softFade(float viewZ, float dist) { return 1.0; }
#endif
`;

export const OUTPUT_FRAG = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
