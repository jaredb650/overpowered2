/**
 * The decal atlas: a 4x4 grid of cells on one Surf, generated at load. Cell order is fixed in
 * Decals.ts. Everything fades to zero coverage before the cell border, so mipmaps do not bleed.
 * Inside a cell `p` runs -1..1. Height drives the normal: blood gets a true meniscus from it.
 */
export const DECAL_GLSL = /* glsl */ `
const vec3 BLOOD_THIN = vec3(0.66, 0.008, 0.016);
const vec3 BLOOD_THICK = vec3(0.27, 0.0, 0.006);

float angularNoise(float a, int cycles, uint seed) {
  // Gradient noise around a circle, so it closes on itself.
  return gnoise(vec2(a / 6.2831853 + 0.5, 0.5), ivec2(cycles, 1), seed);
}

// Height-field blob: the centre mass, its fingers, and flung droplets merged as metaballs.
float bloodField(vec2 p, uint seed, float spread, int drops) {
  float ang = atan(p.y, p.x);
  float r = length(p);
  float lobes = angularNoise(ang, 5, seed) * 0.16 + angularNoise(ang, 13, seed + 1u) * 0.1;
  float fingers = pow(max(angularNoise(ang, 22, seed + 2u) * 0.5 + 0.5, 0.0), 7.0) * 0.5;
  float core = spread * (1.0 + lobes + fingers);
  float field = clamp(1.0 - r / max(core, 1e-3), 0.0, 1.0) * 1.2;
  for (int i = 0; i < 40; i++) {
    if (i >= drops) break;
    vec2 h = hash2(ivec2(i, 3), seed + 9u);
    vec2 h2_ = hash2(ivec2(i, 7), seed + 10u);
    float a = h.x * 6.2831853;
    float rr = spread * (1.15 + pow(h.y, 1.8) * 1.5);
    vec2 c = vec2(cos(a), sin(a)) * rr;
    float size = (0.012 + 0.05 * pow(h2_.x, 3.0)) * (1.2 - h.y * 0.5);
    // Droplets stretch along their flight line.
    vec2 d = p - c;
    vec2 along = normalize(c);
    vec2 q = vec2(dot(d, along) / (1.0 + h2_.y * 1.6), dot(d, vec2(-along.y, along.x)));
    field = max(field, clamp(1.0 - length(q) / size, 0.0, 1.0) * 1.1);
  }
  return field;
}

// A pool is several pours that ran together: metaballs give it necks and bays instead of an oval.
float poolField(vec2 p, uint seed) {
  float m = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 h = hash2(ivec2(i, 11), seed);
    float r = 0.13 + 0.2 * hash1(ivec2(i, 13), seed);
    vec2 d = p - (h - 0.5) * 1.05;
    m += r * r / (dot(d, d) + 0.004);
  }
  m *= 1.0 + (fbm(p * 0.5 + 0.5, ivec2(7), 5, seed + 3u) - 0.5) * 0.8;
  // Falls away before the cell border, or the pool would end in a straight cut.
  m *= 1.0 - smoothstep(0.52, 0.92, length(p));
  return clamp((m - 1.0) * 0.5, 0.0, 1.0);
}

void bloodSurf(float f, vec2 p, inout Surf s, float depth) {
  float cover = smoothstep(0.03, 0.09, f);
  // Surface tension: flat on top, sharply rounded at the rim.
  float dome = 1.0 - pow(1.0 - clamp(f / 0.42, 0.0, 1.0), 2.4);
  float clots = fbm(p * 0.5 + 0.5, ivec2(18), 4, 151u);
  s.height = dome * depth + (clots - 0.5) * 0.015 * dome;
  float thick = clamp(f * 1.05 + (clots - 0.5) * 0.3, 0.0, 1.0);
  s.albedo = mix(BLOOD_THIN, BLOOD_THICK, smoothstep(0.1, 0.8, thick));
  s.rough = mix(0.34, 0.09, smoothstep(0.08, 0.32, f));
  s.metal = 0.0;
  s.extra = cover;
}

void bulletHole(vec2 p, uint seed, inout Surf s) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float wob = angularNoise(ang, 9, seed) * 0.2;
  float hole = 1.0 - smoothstep(0.09, 0.13, r * (1.0 + wob));
  float crater = 1.0 - smoothstep(0.13, 0.38, r * (1.0 + wob * 1.6));
  float rim = exp(-pow((r - 0.2) / 0.06, 2.0));
  float spokes = pow(max(angularNoise(ang, 26, seed + 2u) * 0.5 + 0.5, 0.0), 5.0);
  float cracks = spokes * (1.0 - smoothstep(0.2, 0.7, r));
  float soot = (1.0 - smoothstep(0.2, 0.86, r + fbm(p * 0.5 + 0.5, ivec2(10), 4, seed + 3u) * 0.3 - 0.15));
  s.height = 0.5 - hole * 0.46 - crater * 0.18 + rim * 0.05 - cracks * 0.1;
  s.albedo = mix(vec3(0.02), vec3(0.004), max(hole, crater * 0.7));
  s.rough = 0.86;
  s.metal = 0.0;
  s.extra = clamp(max(max(hole, crater * 0.96), max(cracks * 0.9, soot * 0.62)), 0.0, 1.0);
}

// Where a round came out of a wall. The far face spalls: a ragged crater of freshly broken material several times the
// width of the hole, with flakes thrown out past its edge. It is pale on purpose, the only light mark in the atlas, so it
// reads on a wall in shadow where the other marks are black on black.
void exitHole(vec2 p, uint seed, inout Surf s) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float wob = angularNoise(ang, 7, seed) * 0.24 + angularNoise(ang, 19, seed + 1u) * 0.12;
  float hole = 1.0 - smoothstep(0.1, 0.14, r * (1.0 + wob * 0.5));
  float reach = 0.46 * (1.0 + wob);
  float spall = 1.0 - smoothstep(reach * 0.78, reach, r);
  float grit = fbm(p * 0.5 + 0.5, ivec2(34), 4, seed + 2u);
  // Flakes past the rim, thinning with distance.
  float flakes = smoothstep(0.6, 0.72, fbm(p * 0.5 + 0.5, ivec2(22), 3, seed + 3u)) * (1.0 - smoothstep(reach, reach + 0.36, r));
  float rim = exp(-pow((r - reach) / 0.05, 2.0));
  s.height = 0.5 - hole * 0.46 - spall * (0.14 + grit * 0.08) + rim * 0.04;
  vec3 broken = vec3(0.5, 0.48, 0.45) * (0.72 + grit * 0.5);
  s.albedo = mix(broken, vec3(0.004), max(hole, (1.0 - smoothstep(0.1, 0.24, r)) * 0.7));
  s.rough = 0.9;
  s.metal = 0.0;
  s.extra = clamp(max(max(hole, spall * 0.97), flakes * 0.85), 0.0, 1.0);
}

void scorchMark(vec2 p, uint seed, inout Surf s) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float edge = fbm(p * 0.5 + 0.5, ivec2(6), 6, seed);
  float rays = pow(max(angularNoise(ang, 18, seed + 1u) * 0.5 + 0.5, 0.0), 2.0);
  float reach = 0.42 + rays * 0.42 + (edge - 0.5) * 0.3;
  float burn = 1.0 - smoothstep(reach * 0.45, reach, r);
  float grit = fbm(p * 0.5 + 0.5, ivec2(70), 3, seed + 2u);
  s.height = 0.5 - burn * 0.05 + (grit - 0.5) * 0.08 * burn;
  s.albedo = mix(vec3(0.02, 0.019, 0.018), vec3(0.0035), burn) * (0.7 + grit * 0.6);
  s.rough = 0.95 - burn * 0.12;
  s.metal = 0.0;
  s.extra = burn * burn * (3.0 - 2.0 * burn) * 0.97;
}

void smearMark(vec2 p, uint seed, inout Surf s) {
  // Something bloody was dragged along +X: a heavy start, a body of soft bands, then a broken tail.
  float y = p.y * 0.5 + 0.5;
  float bands = fbm(vec2(0.3, y), ivec2(2, 9), 4, seed);
  float runout = 0.28 + bands * 1.05;
  float t = (p.x + 0.86) / 1.72;
  float warp = (fbm(p * 0.5 + 0.5, ivec2(6), 4, seed + 1u) - 0.5) * 0.26;
  float along = (1.0 - smoothstep(runout * 0.55, runout, t + warp)) * smoothstep(0.0, 0.05, t + warp * 0.3);
  float width = 1.0 - smoothstep(0.34, 0.72, abs(p.y) + warp * 0.6);
  float drag = fbm(vec2(p.x * 0.12 + 0.4, y), ivec2(3, 46), 3, seed + 2u);
  float thin = mix(1.0, smoothstep(0.32, 0.6, drag), smoothstep(0.1, 0.8, t));
  float f = along * width * thin * (1.0 - t * 0.55);
  float lump = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.1, 0.34, t)) * 0.45 * width;
  float v = f + lump * along;
  s.height = v * 0.34;
  s.albedo = mix(BLOOD_THIN, BLOOD_THICK, smoothstep(0.18, 0.9, v));
  s.rough = mix(0.4, 0.13, smoothstep(0.12, 0.44, v));
  s.metal = 0.0;
  s.extra = smoothstep(0.06, 0.24, v);
}

// Sword cut: narrow lens gouges with a torn rim, running along +X.
void slashMark(vec2 p, uint seed, inout Surf s) {
  float gouge = 0.0;
  float rim = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 h = hash2(ivec2(i, 1), seed);
    float off = (float(i) - 1.0) * 0.24 + (h.x - 0.5) * 0.1;
    float slope = (h.y - 0.5) * 0.12;
    float y = p.y - off - slope * p.x;
    float reach = 0.92 - float(i == 1 ? 0 : 1) * (0.1 + h.y * 0.3);
    float taper = clamp(1.0 - pow(abs(p.x) / reach, 2.2), 0.0, 1.0);
    float w = 0.058 * taper * (i == 1 ? 1.0 : 0.62);
    float wob = (fbm(vec2(p.x * 0.5 + 0.5, 0.2), ivec2(30, 1), 3, seed + uint(i)) - 0.5) * 0.02;
    float d = abs(y + wob);
    gouge = max(gouge, (1.0 - smoothstep(w * 0.45, w, d)) * step(0.001, taper));
    rim = max(rim, exp(-pow((d - w) / 0.016, 2.0)) * taper);
  }
  float chips = fbm(p * 0.5 + 0.5, ivec2(60), 3, seed + 5u);
  s.height = 0.5 - gouge * 0.42 + rim * 0.1 * chips;
  s.albedo = mix(vec3(0.05), vec3(0.008), gouge);
  s.rough = 0.72;
  s.metal = 0.0;
  s.extra = clamp(max(gouge, rim * 0.5 * smoothstep(0.35, 0.6, chips)), 0.0, 1.0);
}

void crackMark(vec2 p, uint seed, inout Surf s) {
  float r = length(p);
  vec2 warp = vec2(fbm(p * 0.5 + 0.5, ivec2(6), 4, seed), fbm(p * 0.5 + 0.7, ivec2(6), 4, seed + 1u)) - 0.5;
  float ang = atan(p.y, p.x) + warp.x * 1.1;
  vec3 w = worley(vec2(ang / 6.2831853 + 0.5, 0.5 + r * 0.32), ivec2(9, 4), seed + 2u);
  float line = 1.0 - smoothstep(0.0, 0.05 * (1.2 - r), w.y - w.x);
  vec3 w2 = worley(p * 0.5 + 0.5 + warp * 0.08, ivec2(7), seed + 3u);
  float web = (1.0 - smoothstep(0.0, 0.035, w2.y - w2.x)) * (1.0 - smoothstep(0.12, 0.62, r));
  float crush = (1.0 - smoothstep(0.06, 0.2, r + warp.y * 0.1));
  float fade = 1.0 - smoothstep(0.55, 0.92, r);
  float c = max(line, web) * fade;
  s.height = 0.5 - c * 0.4 - crush * 0.2;
  s.albedo = vec3(0.012);
  s.rough = 0.92;
  s.metal = 0.0;
  s.extra = clamp(max(c, crush * 0.9), 0.0, 1.0);
}

Surf surface_decals(vec2 uv) {
  Surf s;
  s.albedo = vec3(0.0); s.height = 0.0; s.rough = 1.0; s.metal = 0.0; s.extra = 0.0;
  vec2 g = uv * 4.0;
  ivec2 c = ivec2(floor(g));
  int cell = c.x + c.y * 4;
  // Margin keeps every shape away from the cell border.
  vec2 p = (fract(g) * 2.0 - 1.0) * 1.08;
  uint seed = uint(cell) * 13u + 200u;
  if (cell < 1) bulletHole(p, seed, s);
  else if (cell < 2) exitHole(p, seed, s);
  else if (cell < 4) scorchMark(p, seed, s);
  else if (cell < 8) {
    float f = bloodField(p, seed, cell == 4 ? 0.26 : cell == 5 ? 0.34 : cell == 6 ? 0.2 : 0.3, 38);
    bloodSurf(f, p, s, 0.7);
  } else if (cell < 10) {
    float f = max(poolField(p, seed), bloodField(p, seed + 40u, 0.0, 16) * 0.7);
    bloodSurf(f, p, s, 0.9);
  } else if (cell < 12) smearMark(p, seed, s);
  else if (cell < 14) slashMark(p, seed, s);
  else crackMark(p, seed, s);
  float edge = max(abs(p.x), abs(p.y));
  s.extra *= 1.0 - smoothstep(0.94, 1.0, edge);
  return s;
}
`;
