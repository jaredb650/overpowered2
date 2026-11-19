/**
 * The decal atlas, generated at load on one Surf: 48 small cells (8 across, 6 down) over 20 big ones (4 across, 5 down).
 * The layout and which cell is what are in `render/decalSheet.ts`. Inside a cell `p` runs -1.08..1.08 and every shape
 * stays inside 0.93, so mipmaps do not bleed from one cell into the next.
 *
 * Marks (bullet holes, scorches, cuts, cracks) are pictures: albedo, coverage, and a height that becomes the normal.
 *
 * Blood is not a picture. A blood cell stores three fields and the decal shader (`render/decalShader.glsl.ts`) draws
 * the liquid from them at any size:
 *   coverage (albedo alpha)  the outline, as distance to the stain's edge: 0.5 is the edge, `gain` units a cell
 *                            half-width. The shader thresholds it, so an edge is crisp however big the decal is drawn,
 *                            a pool can spread by moving the threshold, and no two stains need the same outline.
 *   albedo red               thickness, 0..1: thin blood is bright and lets the floor show, thick blood is dark,
 *                            glossy and dries last.
 *   albedo green             haze: the mist of specks too fine to draw one by one, round the stain.
 *   height                   the same distance, so the baked normal points out of the stain everywhere: the shader
 *                            uses it as the direction of the wet lip.
 * Shapes follow how blood lands: a drop that falls is round with a scalloped edge; one that arrives at an angle is an
 * oval with a tail pointing the way it was going; what is thrown from a burst leaves as spines and long satellite drops.
 *
 * The sheet is drawn in parts (`DECAL_PARTS`), each a shader that holds a few of the shapes and leaves the rest of the
 * sheet alone. One shader with every shape in it took 2.7 s to compile; five small ones compile in the background, one
 * after another, and nothing waits on them (`TextureBaker.bakeParts`).
 */
const COMMON = /* glsl */ `
float angularNoise(float a, int cycles, uint seed) {
  // Gradient noise around a circle, so it closes on itself.
  return gnoise(vec2(a / 6.2831853 + 0.5, 0.5), ivec2(cycles, 1), seed);
}

// ---- Blood -------------------------------------------------------------------------------------------------------

// d: distance to the edge, positive inside, in p units. t: thickness. haze: mist round it.
struct Blood { float d; float t; float haze; };

float bSmax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

// Adds a body of liquid: thick as t once you are rise inside its edge, so small drops stay thin.
void wet(inout Blood b, float d, float t, float rise) {
  // The thin rim is narrow: a drop is as dark at its edge as in its middle, bar a hair.
  b.t = max(b.t, t * clamp(d / (rise * 0.4), 0.0, 1.0));
  b.d = max(b.d, d);
}

// A drop at c, r across, k times as long along the unit vector dir.
float bOval(vec2 p, vec2 c, vec2 dir, float r, float k) {
  vec2 d = p - c;
  return r - length(vec2(dot(d, dir) / k, dot(d, vec2(-dir.y, dir.x))));
}

// A drop that landed moving along dir: an oval body at c, r across and k times as long, and the thin tail it drew out
// ahead of itself, len long, bending a little.
float bTear(vec2 p, vec2 c, vec2 dir, float r, float k, float len) {
  vec2 d = p - c;
  float a = dot(d, dir);
  float s = dot(d, vec2(-dir.y, dir.x));
  float body = r - length(vec2(a / k, s));
  float from = r * k * 0.55;
  float t = clamp((a - from) / len, 0.0, 1.0);
  s -= r * 0.5 * t * t * sin(c.x * 37.0 + c.y * 91.0);
  float tail = r * 0.46 * pow(1.0 - t, 1.25) - length(vec2(a - clamp(a, from, from + len), s));
  return bSmax(body, tail, r * 0.3);
}

// A drop seen from above: r its radius, wob how far out of round, n scallops of depth sc round its edge
// (fwd 1 keeps them to the side facing +X, where a moving drop breaks up).
float bRound(vec2 p, vec2 c, float r, float wob, int n, float sc, float fwd, uint seed) {
  vec2 d = p - c;
  float a = atan(d.y, d.x);
  float edge = r * (1.0 + wob * (angularNoise(a, 3, seed) * 0.6 + angularNoise(a, 7, seed + 1u) * 0.4));
  if (n > 0) {
    // Uneven: some of the edge stays smooth, the scallops are no two the same width, and a few stand out as points.
    float ph = a * float(n) * 0.5 + angularNoise(a, 4, seed + 2u) * 3.2;
    float some = smoothstep(-0.35, 0.3, angularNoise(a, 3, seed + 3u));
    float amp = sc * some * (0.5 + 0.9 * abs(angularNoise(a, 11, seed + 4u))) * mix(1.0, smoothstep(-0.3, 0.7, cos(a)), fwd);
    float bump = abs(sin(ph));
    edge += r * amp * (bump * bump * (1.0 + 0.8 * angularNoise(a, 6, seed + 5u)) - 0.4);
  }
  return edge - length(d);
}

// How much is thrown along dir: a cone of half angle cone about lobeDir when cone > 0, else lobe more that way than back.
float thrown(vec2 dir, vec2 lobeDir, float lobe, float cone) {
  float c = dot(dir, lobeDir);
  return cone > 0.0 ? smoothstep(cos(cone), cos(cone * 0.55), c) : max(1.0 + lobe * c, 0.0);
}

// Rays thrown out from o, m round the circle: each starts inside r0 and reaches a length of its own, a few as far as r1
// (skew: how few), w wide at the root and tapering, some with a bead or two flung past the tip.
float spines(vec2 p, vec2 o, int m, float r0, float r1, float w, float skew, float beads, vec2 lobeDir, float lobe, float cone, uint seed) {
  vec2 q = p - o;
  float fm = float(m);
  // From a turn of 0..1, so no number here is ever negative: the remainder of a negative int is not defined.
  int k0 = int(floor(fract(atan(q.y, q.x) / 6.2831853 + 1.0) * fm));
  float best = -1.0;
  for (int i = -1; i <= 1; i++) {
    int k = (k0 + i + m) % m;
    vec2 h = hash2(ivec2(k, 0), seed);
    vec2 h2 = hash2(ivec2(k, 1), seed);
    float a = (float(k) + 0.5 + (h.x - 0.5) * 0.8) / fm * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a));
    float len = r0 + (r1 - r0) * pow(h.y, skew) * thrown(dir, lobeDir, lobe, cone);
    if (len < r0 + 0.015) continue;
    float along = dot(q, dir);
    float across = dot(q, vec2(-dir.y, dir.x));
    float root = r0 * 0.6;
    float t = clamp((along - root) / (len - root), 0.0, 1.0);
    float rad = w * (0.55 + 0.9 * h2.x) * mix(1.0, 0.2, pow(t, 0.7));
    best = max(best, rad - length(vec2(along - clamp(along, root, len), across)));
    if (h2.y < beads) {
      float br = w * (0.45 + 0.55 * h2.x);
      float gap = len + br * 2.4 + (r1 - r0) * 0.07 * h.x;
      best = max(best, bOval(q, dir * gap, dir, br, 2.0));
      if (h2.y < beads * 0.5) best = max(best, bOval(q, dir * (gap + br * 4.6), dir, br * 0.6, 1.7));
    }
  }
  return best;
}

// Droplets flung from o, one to a cell of an n-cell grid. How many: amp at the middle of the ellipse (dc, dr), none
// inside hole (0..1 of it) or past its edge. Each up to rad across, and drawn out along its flight by up to k the
// further it went.
void spatter(inout Blood b, vec2 p, vec2 o, vec2 dc, vec2 dr, float hole, int n, float amp, float rad, float k, vec2 lobeDir, float lobe, float cone, uint seed) {
  float fn = float(n);
  ivec2 ci = ivec2(floor((p * 0.5 + 0.5) * fn));
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 c = ci + ivec2(x, y);
      vec2 h = hash2(c, seed);
      vec2 h2 = hash2(c, seed + 71u);
      vec2 cp = (vec2(c) + 0.2 + 0.6 * h) / fn * 2.0 - 1.0;
      float u = (length((cp - dc) / dr) - hole) / (1.0 - hole);
      if (u < 0.0 || u > 1.0) continue;
      vec2 rel = cp - o;
      vec2 dir = rel / max(length(rel), 1e-4);
      if (h2.x > amp * pow(1.0 - u, 1.1) * thrown(dir, lobeDir, lobe, cone)) continue;
      float kk = 1.0 + (k - 1.0) * (0.3 + 0.7 * u);
      float size = min(rad * (0.35 + 0.65 * h2.y * h2.y) * (1.0 - 0.45 * u), 1.5 / fn / kk);
      wet(b, bOval(p, cp, dir, size, kk), 0.6, 0.05);
    }
  }
}

// The middle of a burst: gouts that ran together, uneven in depth.
float gouts(vec2 p, vec2 o, float R, int n, uint seed) {
  float d = bRound(p, o, R, 0.22, 0, 0.0, 0.0, seed);
  for (int i = 0; i < 7; i++) {
    if (i >= n) break;
    vec2 h = hash2(ivec2(i, 2), seed);
    vec2 h2 = hash2(ivec2(i, 3), seed);
    float a = h.x * 6.2831853;
    d = bSmax(d, bRound(p, o + vec2(cos(a), sin(a)) * R * (0.7 + 0.6 * h.y), R * (0.3 + 0.3 * h2.x), 0.12, 0, 0.0, 0.0, seed + uint(i) + 7u), 0.06);
  }
  return d;
}

const vec2 BX = vec2(1.0, 0.0);

void bloodOut(Blood b, float gain, vec2 p, inout Surf s) {
  float edge = max(abs(p.x), abs(p.y));
  float d = min(b.d, 0.97 - edge);
  float f = clamp(0.5 + d * gain, 0.0, 1.0);
  s.albedo = vec3(clamp(b.t, 0.0, 1.0), clamp(b.haze, 0.0, 1.0) * (1.0 - smoothstep(0.86, 0.98, edge)), 0.0);
  s.height = clamp(d, -0.3, 0.3) * 10.0;
  s.rough = 0.0;
  s.metal = 0.0;
  s.extra = f;
}
`;

const DROPS = /* glsl */ `
void cellDrop(vec2 p, uint seed, int v, inout Blood b) {
  vec2 o = vec2(0.0);
  if (v == 0) {
    // It only fell: nearly round, a speck or two beside it.
    wet(b, bRound(p, o, 0.6, 0.035, 0, 0.0, 0.0, seed), 1.0, 0.16);
    spatter(b, p, o, o, vec2(0.95), 0.7, 9, 0.2, 0.03, 1.0, BX, 0.0, 0.0, seed + 5u);
  } else if (v == 1) {
    // From waist height: a scalloped edge and a ring of satellites.
    wet(b, bRound(p, o, 0.5, 0.05, 18, 0.11, 0.0, seed), 1.0, 0.15);
    spatter(b, p, o, o, vec2(0.95), 0.58, 13, 0.55, 0.04, 1.5, BX, 0.0, 0.0, seed + 5u);
    spatter(b, p, o, o, vec2(0.95), 0.56, 24, 0.35, 0.018, 1.6, BX, 0.0, 0.0, seed + 6u);
  } else if (v == 2) {
    // Hard and square on: a small body, a crown of spines, long satellites thrown clear.
    wet(b, bRound(p, o, 0.36, 0.07, 26, 0.13, 0.0, seed), 1.0, 0.13);
    wet(b, spines(p, o, 27, 0.33, 0.76, 0.024, 2.2, 0.6, BX, 0.0, 0.0, seed + 4u), 0.7, 0.05);
    spatter(b, p, o, o, vec2(0.95), 0.45, 15, 0.6, 0.035, 2.3, BX, 0.0, 0.0, seed + 5u);
    spatter(b, p, o, o, vec2(0.95), 0.42, 28, 0.4, 0.016, 2.4, BX, 0.0, 0.0, seed + 6u);
    b.haze = 0.4 * (1.0 - smoothstep(0.36, 0.9, length(p)));
  } else {
    // A gout: several drops that ran together.
    vec2 c0 = vec2(-0.08, 0.04);
    float d = bRound(p, c0, 0.4, 0.1, 14, 0.07, 0.0, seed);
    for (int i = 0; i < 4; i++) {
      vec2 h = hash2(ivec2(i, 2), seed);
      vec2 h2 = hash2(ivec2(i, 3), seed);
      float a = h.x * 6.2831853;
      d = bSmax(d, bRound(p, c0 + vec2(cos(a), sin(a)) * (0.3 + 0.2 * h.y), 0.14 + 0.13 * h2.x, 0.08, 12, 0.07, 0.0, seed + uint(i) + 7u), 0.07);
    }
    wet(b, d, 1.0, 0.16);
    spatter(b, p, c0, o, vec2(0.95), 0.6, 12, 0.5, 0.04, 1.4, BX, 0.0, 0.0, seed + 5u);
    spatter(b, p, c0, o, vec2(0.95), 0.6, 22, 0.3, 0.018, 1.5, BX, 0.0, 0.0, seed + 6u);
  }
}

void cellOval(vec2 p, uint seed, int v, inout Blood b) {
  if (v == 0) {
    // About 45 degrees: a fat oval whose far edge has broken into scallops and short spines.
    vec2 c = vec2(-0.14, 0.0);
    vec2 q = vec2((p.x - c.x) / 1.45, p.y - c.y);
    wet(b, bRound(q, vec2(0.0), 0.36, 0.05, 16, 0.12, 1.0, seed), 1.0, 0.14);
    wet(b, spines(p, c, 44, 0.34, 0.95, 0.022, 1.8, 0.7, BX, 0.0, 0.6, seed + 4u), 0.7, 0.05);
    spatter(b, p, c, vec2(0.3, 0.0), vec2(0.65, 0.5), 0.0, 16, 0.5, 0.03, 2.2, BX, 0.0, 0.8, seed + 5u);
  } else if (v == 1) {
    // About 20 degrees: a tadpole, and the drop its tail threw off.
    wet(b, bTear(p, vec2(-0.42, 0.0), BX, 0.2, 2.1, 0.62), 1.0, 0.11);
    wet(b, bOval(p, vec2(0.6, 0.008), BX, 0.04, 2.3), 0.7, 0.04);
    wet(b, bOval(p, vec2(0.77, -0.006), BX, 0.024, 2.0), 0.6, 0.04);
    wet(b, bOval(p, vec2(0.88, 0.004), BX, 0.014, 1.6), 0.5, 0.04);
    spatter(b, p, vec2(-3.0, 0.0), vec2(0.2, 0.0), vec2(0.75, 0.3), 0.0, 18, 0.22, 0.02, 2.4, BX, 0.0, 0.0, seed + 5u);
  } else if (v == 2) {
    // Glancing: a long streak that breaks into beads.
    wet(b, bTear(p, vec2(-0.42, 0.0), BX, 0.105, 4.6, 0.62), 0.9, 0.08);
    for (int i = 0; i < 5; i++) {
      float f = float(i);
      wet(b, bOval(p, vec2(0.47 + f * 0.105 + f * f * -0.004, (hash1(ivec2(i, 9), seed) - 0.5) * 0.02), BX, 0.036 - f * 0.005, 2.2), 0.6, 0.04);
    }
  } else {
    // A spray arriving together: streaks side by side, each with its bead.
    for (int i = 0; i < 6; i++) {
      vec2 h = hash2(ivec2(i, 4), seed);
      vec2 h2 = hash2(ivec2(i, 5), seed);
      float turn = (h2.y - 0.5) * 0.22;
      vec2 dir = vec2(cos(turn), sin(turn));
      float r = 0.045 + 0.08 * h2.x * h2.x;
      float k = 2.0 + 2.4 * h.y;
      float len = r * (2.5 + 4.0 * h.y);
      vec2 c = vec2(-0.5 + 0.55 * h.x, (float(i) - 2.5) * 0.19 + (h.y - 0.5) * 0.12);
      wet(b, bTear(p, c, dir, r, k, len), 0.9, 0.08);
      wet(b, bOval(p, c + dir * (r * k * 0.55 + len + r * 1.4), dir, r * 0.3, 2.0), 0.6, 0.04);
    }
    spatter(b, p, vec2(-3.0, 0.0), vec2(0.0), vec2(0.9, 0.7), 0.0, 20, 0.3, 0.02, 2.4, BX, 0.0, 0.0, seed + 6u);
    b.haze = 0.3 * (1.0 - smoothstep(0.3, 0.9, length(p * vec2(1.0, 1.3))));
  }
}

void cellMist(vec2 p, uint seed, int v, inout Blood b) {
  // High-speed spatter: specks too fine to count, a few just big enough to see.
  vec2 q = v == 0 ? p : vec2(p.x, p.y / 0.55);
  float cloud = fbm(p * 0.5 + 0.5, ivec2(5), 4, seed);
  b.haze = (1.0 - smoothstep(0.1, 0.92, length(q) + (cloud - 0.5) * 0.5)) * (0.5 + 0.5 * cloud);
  vec2 o = v == 0 ? vec2(0.0) : vec2(-4.0, 0.0);
  vec2 dr = v == 0 ? vec2(0.94) : vec2(0.94, 0.52);
  spatter(b, p, o, vec2(0.0), dr, 0.0, 20, 0.5, 0.028, v == 0 ? 1.3 : 2.6, BX, 0.0, 0.0, seed + 5u);
  spatter(b, p, o, vec2(0.0), dr, 0.0, 34, 0.45, 0.016, v == 0 ? 1.3 : 2.6, BX, 0.0, 0.0, seed + 6u);
}
`;

const PATTERNS = /* glsl */ `
void cellCast(vec2 p, uint seed, int v, inout Blood b) {
  // Flung off something swung: drops in a line, evenly spaced, each a little smaller and pointing along the swing.
  int n = v == 0 ? 8 : 11;
  float gap = 1.72 / float(n - 1);
  float bend = v == 0 ? 0.22 : -0.13;
  for (int i = 0; i < 11; i++) {
    if (i >= n) break;
    vec2 h = hash2(ivec2(i, 4), seed);
    float x = -0.86 + float(i) * gap + (h.x - 0.5) * gap * 0.18;
    float u = x / 0.86;
    vec2 dir = normalize(vec2(1.0, bend * 2.0 * u / 0.86));
    float r = (v == 0 ? 0.064 : 0.044) * (1.0 - 0.055 * float(i)) * (0.8 + 0.4 * h.y);
    wet(b, bTear(p, vec2(x, bend * (u * u - 0.4) + (h.y - 0.5) * 0.04), dir, r * 0.85, 1.35 + 0.5 * h.x, r * (0.9 + 1.4 * h.y)), 0.85, 0.07);
  }
  spatter(b, p, vec2(-3.0, 0.0), vec2(0.0, -bend * 0.1), vec2(0.93, 0.34), 0.0, 20, 0.2, 0.018, 2.0, BX, 0.0, 0.0, seed + 6u);
}

void cellArc(vec2 p, uint seed, int v, inout Blood b) {
  // An artery: the stream rises and falls with the heart, so it lands along a wave. Each beat is a heavy splash that
  // breaks forward into spines; between beats the stream thins to a broken line of drops.
  float ph = v == 0 ? 0.6 : 3.4;
  float amp = v == 0 ? 0.3 : 0.2;
  float frq = v == 0 ? 3.3 : 4.6;
  float slope = amp * frq * cos(p.x * frq + ph);
  float dl = abs(p.y - amp * sin(p.x * frq + ph)) / sqrt(1.0 + slope * slope);
  float brk = fbm(vec2(p.x * 0.5 + 0.5, 0.3), ivec2(13, 1), 3, seed);
  wet(b, min(0.07 * (brk - 0.5) - dl + 0.008, 0.88 - abs(p.x)), 0.6, 0.05);
  int n = v == 0 ? 4 : 5;
  for (int i = 0; i < 5; i++) {
    if (i >= n) break;
    vec2 h = hash2(ivec2(i, 4), seed);
    vec2 h2 = hash2(ivec2(i, 5), seed);
    float x = -0.72 + float(i) * (1.36 / float(n - 1)) + (h.x - 0.5) * 0.12;
    vec2 c = vec2(x, amp * sin(x * frq + ph));
    float r = 0.07 + 0.09 * h.y * h.y + (i == 1 ? 0.04 : 0.0);
    vec2 q = vec2((p.x - c.x) / (1.25 + 0.4 * h2.x), p.y - c.y);
    wet(b, bRound(q, vec2(0.0), r, 0.16, 11, 0.2, 1.0, seed + uint(i) * 3u + 9u), 1.0, 0.1);
    wet(b, spines(p, c, 26, r * 0.9, r * (2.6 + 1.6 * h2.y), 0.02, 1.5, 0.7, BX, 0.0, 0.75, seed + uint(i) * 7u + 20u), 0.7, 0.05);
    spatter(b, p, c, c + vec2(r * 1.6, 0.0), vec2(r * 3.6, r * 2.4), 0.0, 22, 0.55, 0.02, 2.2, BX, 0.0, 0.9, seed + uint(i) + 30u);
  }
  spatter(b, p, vec2(-3.0, 0.0), vec2(0.0), vec2(0.93, amp + 0.3), 0.0, 14, 0.2, 0.03, 1.9, BX, 0.0, 0.0, seed + 6u);
}

void cellTrail(vec2 p, uint seed, int v, inout Blood b) {
  // Drips from someone walking along +X: round drops, unevenly spaced, each with a speck or two thrown ahead.
  int n = v == 0 ? 6 : 5;
  for (int i = 0; i < 6; i++) {
    if (i >= n) break;
    vec2 h = hash2(ivec2(i, 4), seed);
    vec2 h2 = hash2(ivec2(i, 5), seed);
    vec2 c = vec2(-0.8 + float(i) * (1.6 / float(n - 1)) + (h.x - 0.5) * 0.14, (h.y - 0.5) * (v == 0 ? 0.2 : 0.42));
    float r = 0.055 + 0.055 * h2.x;
    vec2 q = vec2((p.x - c.x) / 1.18, p.y - c.y);
    wet(b, bRound(q, vec2(0.0), r, 0.06, 14, 0.12, 1.0, seed + uint(i) * 5u), 0.95, 0.07);
    wet(b, bOval(p, c + vec2(r * (1.9 + h2.y), (h.x - 0.5) * r), BX, r * 0.2, 1.6), 0.5, 0.04);
    if (h2.y > 0.4) wet(b, bOval(p, c + vec2(r * (2.9 + h.y), (h2.x - 0.5) * r * 1.4), BX, r * 0.13, 1.5), 0.5, 0.04);
  }
}

// Something bloody dragged along +X. v 0: a body or a hand, heavy where it first pressed. v 1: a light curved swipe,
// feathered at both ends. v 2: a few broad finger tracks. v 3: a long drag with stutters, drawn to be laid two and a half
// times as long as it is wide.
// A smear has no outline of its own. It is fine streaks, as many as the cloth or skin had blood to give: solid along the
// lanes where the wound pressed, sparse between them, thinning to nothing as the blood runs out. So the edge is ragged
// everywhere and nothing is ruled.
void cellWipe(vec2 p, uint seed, int v, inout Blood b) {
  float t = clamp((p.x + 0.92) / 1.84, 0.0, 1.0);
  float bend = v == 1 ? 0.32 : 0.07;
  float yc = bend * ((t - 0.5) * (t - 0.5) * 2.0 - 0.2) + (fbm(vec2(t * 0.5, 0.1), ivec2(2, 1), 3, seed) - 0.5) * 0.16;
  float W = (v == 1 ? 0.26 : v == 2 ? 0.4 : v == 3 ? 0.5 : 0.46) * (0.8 + 0.4 * fbm(vec2(t * 0.5 + 0.25, 0.6), ivec2(3, 1), 3, seed + 1u));
  float vq = (p.y - yc) / W;
  float across = vq * 0.25 + 0.5;
  int fr = v == 1 ? 26 : 20;
  // Streaks: long along the stroke, fine across it.
  float fine = fbm(vec2(t * 0.25 + 0.1, across), ivec2(2, fr * 2), 3, seed + 2u);
  // Lanes: where there was most blood to leave.
  float lanes = v == 2
    ? smoothstep(0.3, 0.9, 0.5 + 0.5 * cos(vq * 10.5 + 1.3 + 3.0 * fbm(vec2(t * 0.5, 0.2), ivec2(3, 1), 2, seed + 9u))) * (0.6 + 0.6 * fbm(vec2(0.4, across), ivec2(1, 4), 2, seed + 10u))
    : fbm(vec2(t * 0.12 + 0.2, across), ivec2(1, v == 1 ? 9 : 6), 3, seed + 3u);
  lanes *= 1.0 - smoothstep(0.55, 1.0, abs(vq));
  // How much is left to give: all of it where it began, less and less after, with a stutter where the drag caught.
  // It starts round and ragged, never on a ruled line.
  float t0 = 0.02 + 0.16 * vq * vq + 0.12 * fbm(vec2(0.7, across), ivec2(1, 7), 3, seed + 4u);
  float left = v == 1
    ? 0.95 * smoothstep(t0, t0 + 0.3, t) * (1.0 - smoothstep(0.45, 1.0, t))
    : (1.45 - 1.2 * pow(t, 0.8)) * smoothstep(t0, t0 + 0.09, t) * (1.0 - smoothstep(0.9, 1.0, t));
  float stutter = fbm(vec2(t * 0.5 + 0.5, 0.4), ivec2(v == 3 ? 7 : 4, 1), 2, seed + 8u);
  left *= 0.72 + 0.56 * stutter;
  float give = lanes * left * (v == 2 ? 1.05 : 1.6);
  float d = (fine - (1.02 - give)) * 0.11;
  d = min(d, 0.9 - abs(p.x));
  float thick = clamp(0.1 + 1.3 * (give - 0.55), 0.06, 0.85);
  b.t = max(b.t, thick * clamp(d / 0.03, 0.0, 1.0));
  b.d = max(b.d, d);
  if (v == 0 || v == 3) {
    // Where it lay before it was moved.
    float sx = v == 3 ? 0.42 : 1.0;
    float lump = gouts(vec2((p.x + 0.66) / sx, p.y - yc), vec2(0.0), v == 3 ? 0.26 : 0.17, 5, seed + 6u);
    wet(b, lump * (v == 3 ? 0.6 : 1.0), 1.0, 0.1);
  }
  b.haze = 0.5 * lanes * clamp(left, 0.0, 1.0);
}

void cellPool(vec2 p, uint seed, inout Blood b) {
  // Several pours that ran together: necks and bays, not an oval. The field keeps rising toward the middle, so the
  // shader can spread the pool from where it started.
  float m = 0.05 / (dot(p, p) + 0.006);
  for (int i = 0; i < 8; i++) {
    vec2 h = hash2(ivec2(i, 11), seed);
    float r = 0.13 + 0.2 * hash1(ivec2(i, 13), seed);
    vec2 d = p - (h - 0.5) * 1.05;
    m += r * r / (dot(d, d) + 0.004);
  }
  m *= 1.0 + (fbm(p * 0.5 + 0.5, ivec2(6), 4, seed + 3u) - 0.5) * 0.7;
  float d = min(0.11 * log(max(m, 0.02)), 0.9 - length(p));
  wet(b, d, 1.0, 0.1);
}

void cellPrint(vec2 p, uint seed, int v, inout Blood b) {
  // A boot sole, toe toward +X. Only the lugs touch: bars across the forefoot set in a chevron, blocks round its edge,
  // a heel of straight bars. Blood never prints the whole of it. v 1: the foot slid as it came down.
  vec2 q = vec2(p.x, p.y + 0.04 * sin(p.x * 1.9 + 0.4));
  if (v == 1) q.x += 0.16 * fbm(vec2(0.5, q.y * 0.25 + 0.5), ivec2(1, 14), 3, seed + 2u) - 0.05;
  float taper = 1.0 - 0.14 * clamp(0.5 - q.x, 0.0, 1.0);
  float fore = 0.24 - boxDist(vec2(q.x - 0.36, q.y / taper), vec2(0.26, 0.07));
  float heel = 0.2 - boxDist(q - vec2(-0.6, 0.0), vec2(0.07, 0.04));
  float sole = max(fore, heel);
  // Inside: bars, broken down the middle. At the edge: a row of blocks.
  float inner = q.x > -0.3
    ? min((cos((q.x + 0.4 * abs(q.y)) * 40.0) - 0.15) * 0.018, (abs(q.y) - 0.022) * 0.7)
    : (cos(q.x * 46.0) - 0.1) * 0.016;
  inner = min(inner, sole - 0.07);
  float blocks = min(0.026 - abs(sole - 0.03), (cos(atan(q.y, q.x - (q.x > -0.3 ? 0.36 : -0.6)) * (q.x > -0.3 ? 15.0 : 11.0)) - 0.2) * 0.03);
  float press = fbm(q * 0.5 + 0.5, ivec2(4), 3, seed);
  float d = max(inner, blocks) - (0.55 - press) * (v == 1 ? 0.22 : 0.1);
  if (v == 1) d = max(d, (fbm(vec2(q.x * 0.2 + 0.5, q.y * 0.5 + 0.5), ivec2(2, 24), 2, seed + 4u) - 0.72) * 0.1 + min(sole, 0.0));
  b.t = max(b.t, 0.4 * clamp(d / 0.02, 0.0, 1.0));
  b.d = max(b.d, d);
}
`;

const THROWN = /* glsl */ `
void cellBurst(vec2 p, uint seed, int v, inout Blood b) {
  // A body came apart here. v 0: thrown every way. v 1: more one way than the other. v 2: wetter and heavier.
  vec2 lobeDir = normalize(vec2(1.0, 0.15));
  float lobe = v == 1 ? 0.5 : 0.0;
  vec2 o = v == 1 ? vec2(-0.2, -0.02) : vec2(0.0);
  float R = v == 2 ? 0.4 : 0.32;
  float d = gouts(p, o, R, v == 2 ? 7 : 6, seed);
  float depth = fbm(p * 0.5 + 0.5, ivec2(7), 4, seed + 11u);
  b.t = max(b.t, (0.5 + 0.5 * smoothstep(0.3, 0.62, depth)) * clamp(d / 0.12, 0.0, 1.0));
  b.d = max(b.d, d);
  wet(b, spines(p, o, 17, R * 0.8, 0.9, v == 2 ? 0.07 : 0.055, 0.8, 0.75, lobeDir, lobe, 0.0, seed + 20u), 0.85, 0.08);
  wet(b, spines(p, o, 46, R * 0.9, 0.95, 0.018, 1.4, 0.7, lobeDir, lobe, 0.0, seed + 30u), 0.6, 0.05);
  vec2 dr = vec2(0.95);
  float hole = R * 0.8;
  spatter(b, p, o, o * 0.5, dr, hole, 9, 0.85, 0.075, 2.2, lobeDir, lobe, 0.0, seed + 40u);
  spatter(b, p, o, o * 0.5, dr, hole, 18, 0.8, 0.034, 3.0, lobeDir, lobe, 0.0, seed + 41u);
  spatter(b, p, o, o * 0.5, dr, hole, 34, 0.75, 0.017, 3.2, lobeDir, lobe, 0.0, seed + 42u);
  float r = length(p - o);
  b.haze = (1.0 - smoothstep(R, 0.93, r)) * (0.45 + 0.55 * fbm(p * 0.5 + 0.5, ivec2(5), 4, seed + 12u));
}

void cellFan(vec2 p, uint seed, int v, inout Blood b) {
  // Thrown one way, along +X, from the left edge: a wedge of long drops, thick near where it left and thinning as it
  // opens. Fingers near the root, which part; beyond them every drop is drawn out along its flight.
  vec2 o = vec2(-0.88, 0.0);
  float cone = v == 0 ? 0.5 : v == 1 ? 0.72 : 0.36;
  vec2 q = p - o;
  wet(b, bRound(vec2(q.x / 1.5, q.y), vec2(0.09, 0.0), v == 1 ? 0.13 : 0.1, 0.3, 9, 0.3, 1.0, seed), 1.0, 0.1);
  wet(b, spines(p, o, 64, 0.12, 1.7, 0.05, 1.7, 0.85, BX, 0.0, cone, seed + 20u), 0.8, 0.07);
  wet(b, spines(p, o, 140, 0.2, 1.8, 0.016, 2.0, 0.8, BX, 0.0, cone * 1.2, seed + 30u), 0.6, 0.05);
  vec2 dc = vec2(0.05, 0.0);
  vec2 dr = vec2(1.0, 0.96);
  spatter(b, p, o, dc, dr, 0.0, 10, 1.0, 0.08, 3.4, BX, 0.0, cone * 1.2, seed + 40u);
  spatter(b, p, o, dc, dr, 0.0, 13, 0.9, 0.06, 3.8, BX, 0.0, cone * 1.25, seed + 43u);
  spatter(b, p, o, dc, dr, 0.0, 19, 0.9, 0.034, 3.6, BX, 0.0, cone * 1.3, seed + 41u);
  spatter(b, p, o, dc, dr, 0.0, 34, 0.85, 0.017, 3.6, BX, 0.0, cone * 1.45, seed + 42u);
  float along = clamp(length(q) / 1.8, 0.0, 1.0);
  b.haze = thrown(q / max(length(q), 1e-3), BX, 0.0, cone * 1.3) * (1.0 - smoothstep(0.4, 1.0, along)) * (0.4 + 0.6 * fbm(p * 0.5 + 0.5, ivec2(5), 4, seed + 12u));
}
`;

const SOAKED = /* glsl */ `
void cellSoak(vec2 p, uint seed, int v, inout Blood b) {
  // Under a body: a patch soaked into the floor, longer than wide, ragged where it wicked outward.
  float m = 0.0;
  for (int i = 0; i < 10; i++) {
    vec2 h = hash2(ivec2(i, 11), seed);
    float r = 0.12 + 0.17 * hash1(ivec2(i, 13), seed);
    vec2 d = p - (h - 0.5) * vec2(1.05, v == 2 ? 0.85 : 0.6);
    m += r * r / (dot(d, d) + 0.004);
  }
  float rag = fbm(p * 0.5 + 0.5, ivec2(9), 5, seed + 3u);
  m *= 1.0 + (rag - 0.5) * 1.1;
  // Held inside a rounded edge, or the cell's border would rule a straight line across it.
  float d = min(0.11 * log(max(m, 0.02)), (0.92 - length(p * vec2(0.92, 1.0)) + (rag - 0.5) * 0.2) * 0.6);
  float depth = fbm(p * 0.5 + 0.5, ivec2(6), 4, seed + 5u);
  b.t = max(b.t, (0.42 + 0.58 * smoothstep(0.3, 0.6, depth)) * clamp(d / 0.1, 0.0, 1.0));
  b.d = max(b.d, d);
  spatter(b, p, vec2(0.0), vec2(0.0), vec2(0.95), 0.35, 11, 0.3, 0.05, 1.3, BX, 0.0, 0.0, seed + 40u);
  spatter(b, p, vec2(0.0), vec2(0.0), vec2(0.95), 0.3, 24, 0.3, 0.02, 1.3, BX, 0.0, 0.0, seed + 41u);
  b.haze = 0.6 * smoothstep(-0.16, 0.0, d) * (0.4 + 0.6 * rag);
}

// Runs down a wall from a line at height top: n columns between x0 and x1, the longest lenMax, each with its bead.
float runsDown(vec2 p, float x0, float x1, int n, float top, float topJit, float lenMax, float w, uint seed) {
  float span = x1 - x0;
  int k0 = int(floor((p.x - x0) / span * float(n)));
  float best = -1.0;
  for (int i = -1; i <= 1; i++) {
    int k = k0 + i;
    if (k < 0 || k >= n) continue;
    vec2 h = hash2(ivec2(k, 5), seed);
    vec2 h2 = hash2(ivec2(k, 6), seed);
    if (h2.y > 0.88) continue;
    float cx = x0 + (float(k) + 0.25 + 0.5 * h.x) / float(n) * span;
    float mid = 1.0 - abs((cx - (x0 + x1) * 0.5) / (span * 0.5));
    float yt = top + (h2.x - 0.5) * topJit;
    float len = lenMax * pow(h.y, 1.15) * (0.35 + 0.65 * mid);
    float yb = max(yt - len, -0.9);
    float yy = clamp(p.y, yb, yt);
    float tt = (yt - yy) / max(yt - yb, 1e-3);
    float rad = w * (0.6 + 0.8 * h2.x) * mix(1.0, 0.55, tt);
    float sway = 0.012 * sin(yy * 17.0 + h.x * 40.0) * tt;
    best = max(best, rad - length(vec2(p.x - cx - sway, p.y - yy)));
    float bx = cx + 0.012 * sin(yb * 17.0 + h.x * 40.0);
    best = max(best, rad * 1.5 - length(vec2(p.x - bx, (p.y - yb) * 0.8)));
  }
  return best;
}

void cellSheet(vec2 p, uint seed, int v, inout Blood b) {
  // The wall behind a kill. -Y is down: the impact up high, spatter thrown out and up from it, runs hanging below.
  vec2 o = vec2(v == 1 ? -0.12 : 0.0, v == 2 ? 0.42 : 0.34);
  float R = v == 2 ? 0.22 : 0.3;
  vec2 q = vec2((p.x - o.x) / (v == 1 ? 1.5 : 1.25), p.y - o.y);
  float d = gouts(q, vec2(0.0), R, 6, seed);
  float depth = fbm(p * 0.5 + 0.5, ivec2(7), 4, seed + 11u);
  b.t = max(b.t, (0.45 + 0.55 * smoothstep(0.3, 0.62, depth)) * clamp(d / 0.12, 0.0, 1.0));
  b.d = max(b.d, d);
  vec2 upward = vec2(0.0, 1.0);
  wet(b, spines(p, o, 15, R * 0.8, 0.66, 0.042, 1.2, 0.7, upward, 0.55, 0.0, seed + 20u), 0.8, 0.07);
  wet(b, spines(p, o, 40, R * 0.9, 0.78, 0.016, 1.7, 0.7, upward, 0.55, 0.0, seed + 30u), 0.6, 0.05);
  vec2 dc = vec2(o.x, 0.2);
  vec2 dr = vec2(0.93, 0.72);
  spatter(b, p, o, dc, dr, 0.25, 10, 0.5, 0.055, 2.0, upward, 0.3, 0.0, seed + 40u);
  spatter(b, p, o, dc, dr, 0.2, 19, 0.5, 0.03, 2.6, upward, 0.3, 0.0, seed + 41u);
  spatter(b, p, o, dc, dr, 0.2, 34, 0.5, 0.016, 2.8, upward, 0.3, 0.0, seed + 42u);
  float wide = R * (v == 1 ? 1.5 : 1.25);
  wet(b, runsDown(p, o.x - wide * 1.15, o.x + wide * 1.15, v == 2 ? 14 : 22, o.y - R * 0.35, R * 0.5, 1.3, 0.027, seed + 50u), 0.8, 0.04);
  b.haze = (1.0 - smoothstep(R, 0.9, length((p - dc) / vec2(1.0, 0.8)))) * (0.45 + 0.55 * fbm(p * 0.5 + 0.5, ivec2(5), 4, seed + 12u));
}

void cellRing(vec2 p, uint seed, int v, inout Blood b) {
  // Round a blast where several died: nothing in the middle, everything thrown outward from it.
  // v 0: a full ring. v 1: a star of a few long arms. v 2: thrown mostly one way, a crescent.
  vec2 o = vec2(0.0);
  vec2 lobeDir = normalize(vec2(0.8, 0.6));
  float lobe = v == 2 ? 0.85 : 0.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float r0 = 0.3 * (1.0 + 0.2 * angularNoise(a, 5, seed));
  // The inner edge: an arc of gouts, broken.
  float band = 0.11 * (angularNoise(a, 6, seed + 1u) + 0.22) * thrown(p / max(r, 1e-3), lobeDir, lobe, 0.0) - abs(r - r0 - 0.04);
  wet(b, band, 0.9, 0.06);
  wet(b, spines(p, o, v == 1 ? 7 : 15, r0 * 1.6, 0.94, v == 1 ? 0.075 : 0.05, v == 1 ? 0.5 : 1.0, 0.8, lobeDir, lobe, 0.0, seed + 20u), 0.85, 0.08);
  wet(b, spines(p, o, 46, r0 * 1.5, 0.95, 0.018, 1.6, 0.7, lobeDir, lobe, 0.0, seed + 30u), 0.6, 0.05);
  spatter(b, p, o, o, vec2(0.95), 0.3, 10, 0.6, 0.06, 2.6, lobeDir, lobe, 0.0, seed + 40u);
  spatter(b, p, o, o, vec2(0.95), 0.3, 19, 0.6, 0.03, 3.2, lobeDir, lobe, 0.0, seed + 41u);
  spatter(b, p, o, o, vec2(0.95), 0.3, 34, 0.55, 0.016, 3.4, lobeDir, lobe, 0.0, seed + 42u);
  b.haze = smoothstep(r0 * 0.8, r0 * 1.3, r) * (1.0 - smoothstep(0.5, 0.94, r)) * thrown(p / max(r, 1e-3), lobeDir, lobe * 0.8, 0.0)
    * (0.45 + 0.55 * fbm(p * 0.5 + 0.5, ivec2(5), 4, seed + 12u));
}
`;

const MARKS = /* glsl */ `
// What the decal shader repeats at real size. Red: the cracks dried blood breaks into. Green: blotches. Blue: specks,
// each as bright as the density it first shows at, so one threshold thins or thickens a mist.
void detailTile(vec2 uv, inout Surf s) {
  vec3 w = worley(uv, ivec2(7), 901u);
  vec3 w2 = worley(uv, ivec2(17), 902u);
  float crack = max(1.0 - smoothstep(0.0, 0.07, w.y - w.x), (1.0 - smoothstep(0.0, 0.09, w2.y - w2.x)) * 0.55);
  float blotch = fbm(uv, ivec2(4), 5, 903u);
  float speck = 0.0;
  for (int pass = 0; pass < 2; pass++) {
    int n = pass == 0 ? 22 : 37;
    vec2 g = uv * float(n);
    ivec2 ci = ivec2(floor(g));
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec2 c = ci + ivec2(x, y);
        ivec2 wc = wrapCell(c, ivec2(n));
        vec2 h = hash2(wc, 904u + uint(pass));
        vec2 h2 = hash2(wc, 906u + uint(pass));
        float r = 0.16 + 0.26 * h2.x * h2.x;
        float dot_ = 1.0 - smoothstep(r * 0.55, r, length(g - (vec2(c) + 0.25 + 0.5 * h)));
        speck = max(speck, dot_ * (0.2 + 0.8 * h2.y));
      }
    }
  }
  s.albedo = vec3(crack, blotch, speck);
  s.height = 0.5;
  s.rough = 1.0;
  s.metal = 0.0;
  s.extra = 1.0;
}

// ---- Marks -------------------------------------------------------------------------------------------------------

// A round into concrete: a chipped crater of pale broken stone round a dark hole, flakes knocked off past its rim, a few
// hairline cracks and a ring of dust. Pale, like the exit crater, so it reads on a wall in shadow.
void bulletConcrete(vec2 p, uint seed, inout Surf s) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec3 w = worley(p * 0.5 + 0.5, ivec2(7), seed);
  float wob = angularNoise(ang, 7, seed) * 0.22 + angularNoise(ang, 15, seed + 1u) * 0.1;
  // Each chip came off whole, so the rim is in facets.
  float reach = 0.34 * (1.0 + wob) + (w.z - 0.5) * 0.12;
  float crater = 1.0 - smoothstep(reach - 0.035, reach, r);
  float hole = 1.0 - smoothstep(0.075, 0.105, r * (1.0 + wob * 0.6));
  float bowl = smoothstep(0.0, reach, r);
  float grit = fbm(p * 0.5 + 0.5, ivec2(40), 4, seed + 2u);
  float past = step(reach, r);
  float flakes = smoothstep(0.62, 0.72, fbm(p * 0.5 + 0.5, ivec2(26), 3, seed + 3u)) * (1.0 - smoothstep(reach, reach + 0.3, r)) * past;
  float dust = (1.0 - smoothstep(reach * 0.8, 0.9, r)) * (0.35 + 0.65 * fbm(p * 0.5 + 0.5, ivec2(9), 4, seed + 4u));
  float spokes = pow(max(angularNoise(ang, 22, seed + 5u) * 0.5 + 0.5, 0.0), 9.0) * (1.0 - smoothstep(reach, reach + 0.35, r)) * past;
  s.height = 0.5 - hole * 0.45 - crater * (0.2 - 0.12 * bowl) * (0.8 + 0.4 * grit) + past * exp(-pow((r - reach) / 0.03, 2.0)) * 0.03
    - spokes * 0.06 - flakes * 0.05;
  vec3 broken = vec3(0.46, 0.45, 0.43) * (0.6 + 0.6 * grit) * mix(0.55, 1.0, bowl);
  vec3 col = mix(vec3(0.5, 0.49, 0.47), broken, max(crater, flakes));
  col = mix(col, vec3(0.03), spokes * (1.0 - crater));
  s.albedo = mix(col, vec3(0.006), max(hole, (1.0 - smoothstep(0.08, 0.2, r)) * 0.6));
  s.rough = 0.92;
  s.metal = 0.0;
  s.extra = clamp(max(max(hole, crater * 0.97), max(max(flakes * 0.85, spokes * 0.7), dust * 0.3)), 0.0, 1.0);
}

// A round into steel plate: a dished dent with a raised rim, the paint burst off round it to bare bright metal in
// petals, scratches thrown out, a smudge of soot. v 0 went through; v 1 only dented it.
void bulletMetal(vec2 p, uint seed, int v, inout Surf s) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float wob = angularNoise(ang, 6, seed) * 0.12;
  float edge = 0.2 * (1.0 + wob);
  float dent = 1.0 - smoothstep(0.0, edge, r);
  float hole = v == 0 ? 1.0 - smoothstep(0.045, 0.07, r) : 0.0;
  float petal = pow(max(angularNoise(ang, 11, seed + 1u) * 0.5 + 0.5, 0.0), 1.5);
  float bare = 1.0 - smoothstep(0.2 + 0.16 * petal, 0.24 + 0.2 * petal, r);
  float scratch = pow(max(angularNoise(ang, 40, seed + 2u) * 0.5 + 0.5, 0.0), 6.0) * (1.0 - smoothstep(0.25, 0.62, r));
  float soot = (1.0 - smoothstep(0.25, 0.8, r + (fbm(p * 0.5 + 0.5, ivec2(8), 3, seed + 3u) - 0.5) * 0.3)) * 0.45;
  float rim = exp(-pow((r - edge) / 0.035, 2.0));
  float shine = max(bare, scratch) * (1.0 - hole);
  s.height = 0.5 - dent * dent * 0.4 + rim * 0.07;
  s.albedo = mix(mix(vec3(0.02), vec3(0.62, 0.64, 0.66) * (0.75 + 0.5 * petal), max(bare, scratch)), vec3(0.008), hole);
  s.rough = mix(0.8, 0.28, shine);
  s.metal = shine;
  s.extra = clamp(max(max(bare, hole), max(scratch * 0.9, soot)), 0.0, 1.0);
}

// A round through glass: a crushed white eye, long kinked cracks out from it and a broken ring or two between them.
void bulletGlass(vec2 p, uint seed, inout Surf s) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float eye = 1.0 - smoothstep(0.03, 0.07, r * (1.0 + angularNoise(ang, 9, seed) * 0.3));
  float line = 0.0;
  const int m = 13;
  int k0 = int(floor(fract(ang / 6.2831853 + 1.0) * float(m)));
  for (int i = -1; i <= 1; i++) {
    int k = (k0 + i + m) % m;
    vec2 h = hash2(ivec2(k, 0), seed);
    float a = (float(k) + 0.5 + (h.x - 0.5) * 0.9) / float(m) * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a));
    float along = dot(p, dir);
    float across = dot(p, vec2(-dir.y, dir.x)) + 0.03 * sin(along * 14.0 + h.x * 30.0) * along;
    float len = 0.35 + 0.58 * h.y;
    float wide = 0.008 * (1.0 - 0.6 * clamp(along / len, 0.0, 1.0));
    line = max(line, (1.0 - smoothstep(wide * 0.5, wide * 1.6, abs(across))) * step(0.0, along) * (1.0 - smoothstep(len * 0.9, len, along)));
  }
  float ring = 0.0;
  for (int j = 0; j < 2; j++) {
    float rr = 0.2 + 0.2 * float(j) + 0.05 * angularNoise(ang, 5, seed + 3u + uint(j));
    ring = max(ring, (1.0 - smoothstep(0.004, 0.012, abs(r - rr))) * step(0.1, angularNoise(ang, 3, seed + 6u + uint(j))));
  }
  float c = max(eye, max(line, ring * 0.8));
  s.height = 0.5 - c * 0.2;
  s.albedo = vec3(0.78, 0.84, 0.88);
  s.rough = 0.35;
  s.metal = 0.0;
  s.extra = clamp(max(c * 0.9, (1.0 - smoothstep(0.05, 0.22, r)) * 0.35), 0.0, 1.0);
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

// A burn. v 0: the plain scorch. v 1: with a burnt-out middle of pale ash where it was hottest. v 2: thrown one way,
// along +X. All three throw long thin streaks of soot out past the burn.
void scorchMark(vec2 p, uint seed, int v, inout Surf s) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float edge = fbm(p * 0.5 + 0.5, ivec2(6), 6, seed);
  float rays = pow(max(angularNoise(ang, 18, seed + 1u) * 0.5 + 0.5, 0.0), 2.0);
  float streak = pow(max(angularNoise(ang, 31, seed + 4u) * 0.5 + 0.5, 0.0), 5.0);
  float lean = v == 2 ? 0.55 * max(p.x / max(r, 1e-3), -0.5) : 0.0;
  float reach = (0.36 + rays * 0.3 + (edge - 0.5) * 0.3) * (1.0 + lean);
  float burn = 1.0 - smoothstep(reach * 0.45, reach, r);
  float soot = streak * (1.0 - smoothstep(reach * 0.8, min(reach * 2.3, 0.94), r)) * 0.8;
  float grit = fbm(p * 0.5 + 0.5, ivec2(70), 3, seed + 2u);
  float ash = v == 0 ? 0.0 : (1.0 - smoothstep(0.06, 0.2 + 0.1 * edge, r)) * (0.5 + 0.5 * grit);
  s.height = 0.5 - burn * 0.05 + (grit - 0.5) * 0.08 * burn - ash * 0.03;
  s.albedo = mix(vec3(0.02, 0.019, 0.018), vec3(0.0035), max(burn, soot)) * (0.7 + grit * 0.6);
  s.albedo = mix(s.albedo, vec3(0.16, 0.15, 0.14) * (0.6 + 0.8 * grit), ash * 0.8);
  s.rough = 0.95 - burn * 0.12;
  s.metal = 0.0;
  s.extra = max(burn * burn * (3.0 - 2.0 * burn) * 0.97, soot);
}

// Soot with no blast in it: what a fire leaves under what burned. v 0: a blotch. v 1: drawn out along +X.
void sootMark(vec2 p, uint seed, int v, inout Surf s) {
  vec2 q = v == 1 ? vec2(p.x * 0.62, p.y * 1.5) : p;
  float cloud = fbm(p * 0.5 + 0.5, ivec2(5), 5, seed);
  float fine = fbm(p * 0.5 + 0.5, ivec2(22), 4, seed + 1u);
  float body = 1.0 - smoothstep(0.2, 0.86, length(q) + (cloud - 0.5) * 0.7);
  s.height = 0.5 + (fine - 0.5) * 0.04 * body;
  s.albedo = vec3(0.012, 0.011, 0.01) * (0.6 + 0.8 * fine);
  s.rough = 0.97;
  s.metal = 0.0;
  s.extra = body * (0.55 + 0.45 * fine) * 0.92;
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
`;

/** One branch of the sheet's dispatcher: the cells below `below` (and not below the branch before it) are drawn by `call`. */
interface Branch {
  below: number;
  call: string;
  part: number;
}

/** Every blood cell, in the order of the sheet. `q` is the cell's point pushed a little out of true, `p` as ruled. */
const BLOOD: readonly Branch[] = [
  { below: 12, call: 'cellDrop(q, seed, cell - 8, b);', part: 0 },
  { below: 16, call: 'cellOval(q, seed, cell - 12, b);', part: 0 },
  { below: 18, call: 'cellMist(q, seed, cell - 16, b);', part: 0 },
  { below: 20, call: 'cellCast(q, seed, cell - 18, b);', part: 1 },
  { below: 22, call: 'cellArc(q, seed, cell - 20, b);', part: 1 },
  { below: 24, call: 'cellTrail(q, seed, cell - 22, b);', part: 1 },
  { below: 27, call: 'cellWipe(q, seed, cell - 24, b);', part: 1 },
  { below: 30, call: '{ cellPool(q, seed, b); gain = 1.5; }', part: 1 },
  { below: 32, call: 'cellPrint(p, seed, cell - 30, b);', part: 1 },
  { below: 51, call: 'cellBurst(q, seed, cell - 48, b);', part: 2 },
  { below: 54, call: 'cellFan(q, seed, cell - 51, b);', part: 2 },
  { below: 57, call: 'cellSoak(q, seed, cell - 54, b);', part: 3 },
  { below: 60, call: 'cellSheet(q, seed, cell - 57, b);', part: 3 },
  { below: 62, call: 'cellWipe(q, seed, 3, b);', part: 1 },
  { below: 65, call: 'cellRing(q, seed, cell - 62, b);', part: 3 },
];
const MARK_PART = 4;

/**
 * `surface_decals` for one part: the whole sheet's layout, with only this part's cells drawn. A cell that belongs to
 * another part comes back with `extra` below zero, and the baker leaves those pixels as they are.
 */
function dispatcher(part: number): string {
  const mine = BLOOD.map((b, i) => `${i === 0 ? '' : 'else '}if (cell < ${b.below}) ${b.part === part ? b.call : 'skip = true;'}`).join('\n    ');
  return /* glsl */ `
Surf surface_decals(vec2 uv) {
  Surf s;
  s.albedo = vec3(0.0); s.height = 0.0; s.rough = 1.0; s.metal = 0.0; s.extra = 0.0;
  vec2 g;
  int cell;
  if (uv.y < 0.375) {
    g = uv * vec2(8.0, 16.0);
    cell = int(floor(g.x)) + int(floor(g.y)) * 8;
  } else {
    g = vec2(uv.x * 4.0, (uv.y - 0.375) * 8.0);
    cell = 48 + int(floor(g.x)) + int(floor(g.y)) * 4;
  }
  bool blood = (cell >= 8 && cell < 32) || (cell >= 48 && cell < 65);
  if (blood != ${part !== MARK_PART}) {
    s.extra = -1.0;
    return s;
  }
  // Margin keeps every shape away from the cell border.
  vec2 p = (fract(g) * 2.0 - 1.0) * 1.08;
  uint seed = uint(cell) * 13u + 200u;
${part === MARK_PART ? /* glsl */ `
  if (cell == 47) {
    detailTile(fract(g), s);
    return s;
  }
  if (cell < 2) bulletConcrete(p, seed, s);
  else if (cell < 4) bulletMetal(p, seed, cell - 2, s);
  else if (cell < 6) bulletGlass(p, seed, s);
  else if (cell < 8) exitHole(p, seed, s);
  else if (cell < 34) slashMark(p, seed, s);
  else if (cell < 36) crackMark(p, seed, s);
  else if (cell < 38) sootMark(p, seed, cell - 36, s);
  else if (cell < 65) return s;
  else scorchMark(p, seed, cell - 65, s);
  float edge = max(abs(p.x), abs(p.y));
  s.extra *= 1.0 - smoothstep(0.94, 1.0, edge);
  return s;` : /* glsl */ `
  Blood b = Blood(-1.0, 0.0, 0.0);
  float gain = 10.0;
  bool skip = false;
  // Nothing in blood is ruled: every shape is pushed a little out of true.
  vec2 q = p + (vec2(fbm(p * 0.5 + 0.5, ivec2(4), 3, seed + 90u), fbm(p * 0.5 + 0.5, ivec2(4), 3, seed + 91u)) - 0.5) * 0.05
    + (vec2(fbm(p * 0.5 + 0.5, ivec2(13), 2, seed + 92u), fbm(p * 0.5 + 0.5, ivec2(13), 2, seed + 93u)) - 0.5) * 0.022;
    ${mine}
  if (skip) {
    s.extra = -1.0;
    return s;
  }
  bloodOut(b, gain, p, s);
  return s;`}
}
`;
}

const SHAPES = [DROPS, PATTERNS, THROWN, SOAKED];

/** The sheet's shaders, in the order they are drawn. Each is whole but for the surface prelude (`SURFACE_HEAD`). */
export const DECAL_PARTS: readonly string[] = [
  ...SHAPES.map((shapes, part) => `${COMMON}\n${shapes}\n${dispatcher(part)}`),
  `${COMMON.slice(0, COMMON.indexOf('// ---- Blood'))}\n${MARKS}\n${dispatcher(MARK_PART)}`,
];

/** Every part's source in one string, for the tests that check the sheet against its table. */
export const DECAL_GLSL = DECAL_PARTS.join('\n');
