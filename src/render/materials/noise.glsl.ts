/** Tileable noise for texture generation. Every function takes uv in 0..1 and integer frequencies, so outputs wrap. */
export const NOISE_GLSL = /* glsl */ `
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
uint hash2u(ivec2 p, uint seed) { return pcg(uint(p.x) + pcg(uint(p.y) + seed * 2654435761u)); }
float hash1(ivec2 p, uint seed) { return float(hash2u(p, seed)) * (1.0 / 4294967295.0); }
vec2 hash2(ivec2 p, uint seed) {
  uint a = hash2u(p, seed);
  return vec2(float(a), float(pcg(a))) * (1.0 / 4294967295.0);
}
ivec2 wrapCell(ivec2 p, ivec2 per) { return ((p % per) + per) % per; }

// Gradient noise, range about -1..1.
float gnoise(vec2 uv, ivec2 freq, uint seed) {
  vec2 p = uv * vec2(freq);
  ivec2 i = ivec2(floor(p));
  vec2 f = p - floor(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = hash2(wrapCell(i, freq), seed) * 2.0 - 1.0;
  vec2 g10 = hash2(wrapCell(i + ivec2(1, 0), freq), seed) * 2.0 - 1.0;
  vec2 g01 = hash2(wrapCell(i + ivec2(0, 1), freq), seed) * 2.0 - 1.0;
  vec2 g11 = hash2(wrapCell(i + ivec2(1, 1), freq), seed) * 2.0 - 1.0;
  float a = dot(g00, f), b = dot(g10, f - vec2(1.0, 0.0));
  float c = dot(g01, f - vec2(0.0, 1.0)), d = dot(g11, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}

// fBm normalized to about 0..1.
float fbm(vec2 uv, ivec2 freq, int octaves, uint seed) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    sum += gnoise(uv, freq, seed + uint(i) * 17u) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return clamp(sum / norm * 0.75 + 0.5, 0.0, 1.0);
}

float ridged(vec2 uv, ivec2 freq, int octaves, uint seed) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    sum += (1.0 - abs(gnoise(uv, freq, seed + uint(i) * 31u))) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Worley: x = F1, y = F2 in cell units, z = id hash of the nearest cell.
vec3 worley(vec2 uv, ivec2 freq, uint seed) {
  vec2 p = uv * vec2(freq);
  ivec2 i = ivec2(floor(p));
  vec2 f = p - floor(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 c = ivec2(x, y);
      ivec2 w = wrapCell(i + c, freq);
      vec2 o = hash2(w, seed);
      float d = length(vec2(c) + o - f);
      if (d < f1) { f2 = f1; f1 = d; id = hash1(w, seed + 5u); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(f1, f2, id);
}

// Random line segments on a jittered grid. Returns 0..1 scratch coverage.
float scratches(vec2 uv, ivec2 grid, float lengthCells, float width, uint seed) {
  vec2 p = uv * vec2(grid);
  ivec2 i = ivec2(floor(p));
  float best = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      ivec2 cell = i + ivec2(x, y);
      ivec2 w = wrapCell(cell, grid);
      vec2 r = hash2(w, seed);
      vec2 r2 = hash2(w, seed + 91u);
      if (r2.y > 0.6) continue;
      vec2 a = vec2(cell) + r;
      float ang = r2.x * 6.2831853;
      vec2 dir = vec2(cos(ang), sin(ang)) * lengthCells * (0.4 + r.x);
      vec2 pa = p - a;
      float h = clamp(dot(pa, dir) / dot(dir, dir), 0.0, 1.0);
      float d = length(pa - dir * h);
      float taper = sin(h * 3.14159);
      best = max(best, (1.0 - smoothstep(0.0, width, d)) * taper * (0.4 + 0.6 * r2.y / 0.6));
    }
  }
  return best;
}
`;
