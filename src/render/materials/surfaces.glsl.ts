import { NOISE_GLSL } from './noise.glsl';
import { DECAL_GLSL } from './decalAtlas.glsl';

/**
 * Procedural PBR surfaces, evaluated once at load into textures. Each `surface_*` writes albedo
 * (linear), a height in 0..1, roughness, metalness and `extra`. For a masked material, extra is coverage.
 * For lava it is the emissive heat. Physical size of one tile is in SET_TILE in MaterialLibrary.
 */
export const SURFACES_GLSL = /* glsl */ `
${NOISE_GLSL}

struct Surf { vec3 albedo; float height; float rough; float metal; float extra; };

float boxDist(vec2 p, vec2 half_) { vec2 d = abs(p) - half_; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

// Poured concrete. Tile is 4 m: board-formed panels, tie holes with rust drips, aggregate, pits, water marks.
Surf concreteBase(vec2 uv, vec3 tintA, vec3 tintB, float dirt) {
  Surf s;
  // Panels are 2 m x 1 m on a running bond.
  vec2 pc = uv * vec2(2.0, 4.0);
  float row = floor(pc.y);
  pc.x += mod(row, 2.0) * 0.5;
  ivec2 pid = wrapCell(ivec2(floor(pc)), ivec2(2, 4));
  vec2 pf = fract(pc);
  vec2 pm = vec2(min(pf.x, 1.0 - pf.x) * 2.0, min(pf.y, 1.0 - pf.y));
  float seamD = min(pm.x, pm.y);
  float seamWob = (fbm(uv, ivec2(24), 3, 21u) - 0.5) * 0.006;
  float seam = 1.0 - smoothstep(0.003, 0.012, seamD + seamWob);
  float panelTint = hash1(pid, 3u);

  // Four tie holes per panel.
  vec2 holeCell = vec2(fract(pf.x * 2.0) - 0.5, fract(pf.y * 2.0) - 0.5) * vec2(1.0, 0.5);
  float holeD = length(holeCell);
  float hole = 1.0 - smoothstep(0.016, 0.022, holeD);
  float holeRim = (1.0 - smoothstep(0.022, 0.042, holeD)) * (1.0 - hole);

  float big = fbm(uv, ivec2(5), 6, 11u);
  float mid = fbm(uv, ivec2(40), 5, 12u);
  float fine = fbm(uv, ivec2(180), 3, 13u);
  vec3 wa = worley(uv, ivec2(150), 14u);
  float stone = (1.0 - smoothstep(0.1, 0.42, wa.x)) * step(0.45, wa.z);
  vec3 wb = worley(uv, ivec2(62), 15u);
  float pitR = 0.1 + 0.2 * wb.z;
  float pit = (1.0 - smoothstep(pitR * 0.55, pitR, wb.x)) * step(0.86, hash1(ivec2(wb.z * 999.0), 16u));
  // Board grain inside each panel, running along the pour.
  float board = gnoise(uv + vec2(0.0, big * 0.01), ivec2(3, 64), 17u);

  s.height = 0.56 + (big - 0.5) * 0.1 + (mid - 0.5) * 0.14 + (fine - 0.5) * 0.08 + board * 0.018
    + stone * 0.035 - pit * 0.16 - seam * 0.3 - hole * 0.5 + holeRim * 0.04 + (panelTint - 0.5) * 0.05;

  // Water ran down the wall for decades: streaks from seams and holes, darker near the bottom of a pour.
  float streak = pow(fbm(uv, ivec2(48, 3), 4, 18u), 2.2);
  float blotch = smoothstep(0.42, 0.72, fbm(uv + big * 0.04, ivec2(7), 6, 19u));
  float dripX = 1.0 - smoothstep(0.0, 0.022, abs(holeCell.x) + (mid - 0.5) * 0.012);
  float dripY = step(holeCell.y, 0.0) * smoothstep(-0.24, -0.02, holeCell.y);
  float rustDrip = dripX * dripY * (0.35 + 0.65 * streak) * step(0.3, panelTint + mid * 0.3);
  vec3 col = mix(tintA, tintB, big * 0.55 + panelTint * 0.3 + mid * 0.15);
  col *= 0.8 + mid * 0.34 + (fine - 0.5) * 0.16;
  col *= 1.0 + stone * 0.14;
  col *= 1.0 - streak * 0.34 * dirt;
  col *= 1.0 - blotch * 0.26 * dirt;
  col *= 1.0 - pit * 0.55;
  col *= 1.0 - seam * 0.5;
  col = mix(col, vec3(0.02), hole);
  col *= 1.0 - holeRim * 0.22;
  col = mix(col, vec3(0.16, 0.085, 0.05), rustDrip * 0.62 * dirt);
  s.albedo = col;
  s.rough = clamp(0.78 + (mid - 0.5) * 0.24 - blotch * 0.18 * dirt + pit * 0.1, 0.42, 1.0);
  s.metal = 0.0;
  s.extra = 1.0;
  return s;
}

Surf surface_concrete(vec2 uv) { return concreteBase(uv, vec3(0.26, 0.27, 0.285), vec3(0.42, 0.435, 0.45), 1.0); }
Surf surface_concreteDark(vec2 uv) { return concreteBase(uv + 0.37, vec3(0.085, 0.092, 0.105), vec3(0.17, 0.18, 0.195), 1.25); }

// Asphalt. Tile 4 m: dense aggregate, tar seal patches, cracks, worn low spots that hold water.
Surf surface_asphalt(vec2 uv) {
  Surf s;
  vec3 w1 = worley(uv, ivec2(210), 31u);
  vec3 w2 = worley(uv, ivec2(95), 32u);
  float stone = (1.0 - smoothstep(0.18, 0.62, w1.x));
  float stone2 = (1.0 - smoothstep(0.2, 0.55, w2.x));
  float low = fbm(uv, ivec2(4), 6, 33u);
  vec2 warp = vec2(fbm(uv, ivec2(9), 4, 34u), fbm(uv, ivec2(9), 4, 35u)) - 0.5;
  vec3 c = worley(uv + warp * 0.07, ivec2(5), 36u);
  float crackLine = c.y - c.x;
  float crack = (1.0 - smoothstep(0.012, 0.03, crackLine)) * smoothstep(0.45, 0.6, fbm(uv, ivec2(6), 3, 37u));
  float seal = smoothstep(0.55, 0.6, fbm(uv + warp * 0.03, ivec2(3), 5, 38u));
  float fine = fbm(uv, ivec2(320), 2, 39u);

  s.height = 0.45 + stone * 0.26 * (0.4 + w1.z * 0.6) + stone2 * 0.16 + (low - 0.5) * 0.26 - crack * 0.32 + seal * 0.03;
  vec3 tar = vec3(0.022, 0.023, 0.026);
  vec3 rock = mix(vec3(0.075, 0.078, 0.085), vec3(0.17, 0.17, 0.175), w1.z);
  vec3 col = mix(tar, rock, stone * 0.55 + stone2 * 0.3);
  col = mix(col, vec3(0.012, 0.012, 0.014), seal * 0.82);
  col *= 1.0 - crack * 0.72;
  col *= 0.85 + fine * 0.3;
  s.albedo = col;
  float puddle = 1.0 - smoothstep(0.34, 0.5, low);
  s.rough = clamp(mix(0.84, 0.3, puddle) - seal * 0.28 + stone * 0.06, 0.16, 1.0);
  s.metal = 0.0;
  s.extra = 1.0;
  return s;
}

// Brushed plate. Tile 2 m: grain along U, fine scratches, thumb-smudged roughness, very shallow dents.
Surf brushed(vec2 uv, vec3 tint, float baseRough, float wear) {
  Surf s;
  float grain = fbm(uv, ivec2(5, 420), 4, 41u);
  float grain2 = fbm(uv, ivec2(14, 900), 2, 42u);
  float smudge = fbm(uv, ivec2(5), 6, 43u);
  float dent = fbm(uv, ivec2(4), 4, 44u);
  float sc = scratches(uv, ivec2(40), 3.0, 0.02, 45u);
  float sc2 = scratches(uv + 0.31, ivec2(14), 2.4, 0.012, 46u);
  float deep = scratches(uv + 0.67, ivec2(6), 2.0, 0.008, 47u);
  s.height = 0.5 + (dent - 0.5) * 0.08 + (grain - 0.5) * 0.04 + (grain2 - 0.5) * 0.02 - sc * 0.09 - sc2 * 0.14 - deep * 0.3;
  vec3 col = tint * (0.86 + grain * 0.2 + (smudge - 0.5) * 0.18);
  col = mix(col, tint * 1.35 + 0.04, max(sc * 0.4, deep * 0.8) * wear);
  float stain = smoothstep(0.55, 0.8, fbm(uv, ivec2(6), 6, 48u));
  col *= 1.0 - stain * 0.3 * wear;
  s.albedo = col;
  s.rough = clamp(baseRough + (smudge - 0.5) * 0.3 + (grain - 0.5) * 0.14 + stain * 0.2 + deep * 0.1 - sc * 0.08, 0.1, 0.95);
  s.metal = 1.0 - stain * 0.2;
  s.extra = 1.0;
  return s;
}
Surf surface_steel(vec2 uv) { return brushed(uv, vec3(0.56, 0.58, 0.6), 0.34, 0.7); }
Surf surface_steelDark(vec2 uv) { return brushed(uv + 0.23, vec3(0.13, 0.14, 0.155), 0.46, 1.2); }

// Flaking rust over old paint. Tile 3 m. The colour stays dark and dry, so it never reads as set-dressing orange.
Surf surface_rust(vec2 uv) {
  Surf s;
  vec2 warp = vec2(fbm(uv, ivec2(6), 5, 51u), fbm(uv, ivec2(6), 5, 52u)) - 0.5;
  vec2 q = uv + warp * 0.12;
  float m = fbm(q, ivec2(5), 7, 53u);
  float front = smoothstep(0.4, 0.58, m);
  vec3 fl = worley(q, ivec2(26), 54u);
  float flakeEdge = 1.0 - smoothstep(0.0, 0.09, fl.y - fl.x);
  float flakeLift = fl.z;
  vec3 fl2 = worley(q, ivec2(70), 55u);
  float scale = 1.0 - smoothstep(0.0, 0.14, fl2.y - fl2.x);
  float pit = pow(fbm(q, ivec2(40), 6, 56u), 2.0);
  float grit = fbm(uv, ivec2(200), 3, 57u);

  float rustH = 0.46 + flakeLift * 0.2 * front - flakeEdge * 0.16 - scale * 0.07 + (pit - 0.25) * 0.38 + (grit - 0.5) * 0.14;
  float paintH = 0.7 + (grit - 0.5) * 0.02;
  s.height = mix(paintH, rustH, front);
  vec3 dark = vec3(0.07, 0.038, 0.024);
  vec3 mid = vec3(0.19, 0.092, 0.047);
  vec3 hot = vec3(0.34, 0.14, 0.05);
  vec3 rust = mix(dark, mid, pit * 1.7 + flakeLift * 0.3);
  rust = mix(rust, hot, smoothstep(0.55, 0.85, grit * 0.5 + flakeLift * 0.5) * 0.6);
  rust *= 1.0 - flakeEdge * 0.5;
  vec3 paint = vec3(0.11, 0.135, 0.15) * (0.8 + grit * 0.3);
  float bare = (1.0 - smoothstep(0.34, 0.4, m)) * smoothstep(0.26, 0.34, m);
  s.albedo = mix(paint, rust, front);
  s.albedo = mix(s.albedo, vec3(0.3, 0.31, 0.32), bare * 0.7);
  s.rough = mix(0.5, 0.92 - pit * 0.1, front);
  s.metal = bare * 0.9;
  s.extra = 1.0;
  return s;
}

// Bar grating with real holes. Tile 1 m: 16 bearing bars crossed by 8 twisted rods.
Surf surface_grate(vec2 uv) {
  Surf s;
  vec2 c = uv * vec2(16.0, 8.0);
  vec2 f = abs(fract(c) - 0.5);
  float barW = 0.09;
  float rodW = 0.05;
  float bar = 1.0 - smoothstep(barW - 0.012, barW + 0.012, 0.5 - f.x);
  float rod = 1.0 - smoothstep(rodW - 0.008, rodW + 0.008, 0.5 - f.y);
  float cover = max(bar, rod);
  float grit = fbm(uv, ivec2(48), 4, 61u);
  float rustM = smoothstep(0.5, 0.74, fbm(uv, ivec2(5), 6, 62u));
  float ridge = 0.5 - f.x;
  s.height = 0.3 + bar * (0.5 + 0.3 * sin(clamp(ridge / barW, 0.0, 1.0) * 1.57)) + rod * 0.65;
  vec3 steel = vec3(0.24, 0.255, 0.27) * (0.75 + grit * 0.5);
  vec3 rusty = vec3(0.13, 0.07, 0.04);
  s.albedo = mix(steel, rusty, rustM * 0.8);
  // Boots polish the top of the bars.
  s.rough = mix(0.36, 0.84, rustM);
  s.metal = 1.0 - rustM * 0.8;
  s.extra = cover;
  return s;
}

// Chevron hazard paint over plate. Tile 2 m. Worn through at the edges and in a band where people walk.
Surf surface_hazard(vec2 uv) {
  Surf s;
  float x = abs(fract(uv.x * 2.0) - 0.5);
  float band = fract(uv.y * 4.0 + x * 2.0);
  float stripe = step(0.5, band);
  float edgeD = min(abs(band - 0.5), min(band, 1.0 - band));
  float grit = fbm(uv, ivec2(120), 4, 71u);
  float wearField = fbm(uv, ivec2(6), 7, 72u);
  float chipField = fbm(uv, ivec2(34), 5, 73u);
  float wear = smoothstep(0.56, 0.66, wearField * 0.72 + chipField * 0.28 + (0.06 - min(edgeD, 0.06)) * 0.6);
  float sc = scratches(uv, ivec2(22), 2.6, 0.03, 74u);
  float grime = smoothstep(0.4, 0.75, fbm(uv, ivec2(8), 6, 75u));
  vec3 yellow = vec3(0.62, 0.42, 0.035);
  vec3 black = vec3(0.016, 0.017, 0.019);
  vec3 paint = mix(yellow, black, stripe);
  paint *= 0.82 + grit * 0.3;
  paint = mix(paint, paint * vec3(0.5, 0.48, 0.46), grime * 0.75);
  vec3 steel = vec3(0.32, 0.33, 0.345) * (0.7 + grit * 0.5);
  float bare = max(wear, sc * 0.9);
  s.albedo = mix(paint, steel, bare);
  s.height = 0.62 + (grit - 0.5) * 0.04 - bare * 0.14 - sc * 0.05;
  s.rough = mix(0.5 + grime * 0.24, 0.42 + grit * 0.2, bare);
  s.metal = bare;
  s.extra = 1.0;
  return s;
}

// Hull panels with seams and bolts. Tile 4 m. Cells of a 4x4 grid are merged by hash into larger plates.
Surf surface_panel(vec2 uv) {
  Surf s;
  vec2 g = uv * 4.0;
  ivec2 cell = wrapCell(ivec2(floor(g)), ivec2(4));
  vec2 f = fract(g);
  // Merge pairs: even columns may extend right, even rows may extend up.
  bool mergeX = hash1(ivec2(cell.x / 2, cell.y), 81u) > 0.55;
  bool mergeY = hash1(ivec2(cell.x, cell.y / 2), 82u) > 0.6;
  vec2 size = vec2(mergeX ? 2.0 : 1.0, mergeY ? 2.0 : 1.0);
  vec2 local = vec2(mergeX ? (float(cell.x % 2) + f.x) : f.x, mergeY ? (float(cell.y % 2) + f.y) : f.y);
  vec2 centred = (local - size * 0.5) * 1.0;
  float d = boxDist(centred, size * 0.5 - 0.012);
  float seam = smoothstep(-0.012, 0.0, d);
  float bevel = smoothstep(-0.05, -0.012, d);
  ivec2 plate = ivec2(mergeX ? cell.x / 2 * 2 : cell.x, mergeY ? cell.y / 2 * 2 : cell.y);
  float tint = hash1(plate, 83u);
  float inset = hash1(plate, 84u);

  // Bolts sit in the corners of each plate.
  vec2 bc = abs(centred) - (size * 0.5 - 0.075);
  float bd = length(bc);
  float bolt = 1.0 - smoothstep(0.018, 0.024, bd);
  float boltRing = (1.0 - smoothstep(0.024, 0.036, bd)) * (1.0 - bolt);
  float hex = max(abs(bc.x) * 0.866 + abs(bc.y) * 0.5, abs(bc.y));
  float boltHead = 1.0 - smoothstep(0.009, 0.012, hex);

  // Some plates carry a louvre.
  float hasVent = step(0.74, hash1(plate, 85u));
  vec2 vc = centred / max(size * 0.5, vec2(0.01));
  float inVent = hasVent * (1.0 - step(0.62, abs(vc.x))) * (1.0 - step(0.5, abs(vc.y)));
  float slot = smoothstep(0.32, 0.4, abs(fract(vc.y * 7.0) - 0.5));
  float vent = inVent * slot;

  float grit = fbm(uv, ivec2(160), 4, 86u);
  float smear = fbm(uv, ivec2(7), 6, 87u);
  float sc = scratches(uv, ivec2(26), 2.8, 0.02, 88u);
  float wearEdge = smoothstep(-0.05, -0.008, d) * smoothstep(0.5, 0.72, grit * 0.4 + smear * 0.6);

  s.height = 0.58 + (inset - 0.5) * 0.09 - seam * 0.44 - bevel * 0.04 + bolt * 0.14 + boltHead * 0.08 + boltRing * 0.015
    - vent * 0.38 + (grit - 0.5) * 0.015 - sc * 0.04;
  vec3 paint = mix(vec3(0.115, 0.135, 0.155), vec3(0.2, 0.225, 0.245), tint);
  paint *= 0.85 + grit * 0.26;
  paint *= 1.0 - smoothstep(0.45, 0.78, smear) * 0.3;
  vec3 steel = vec3(0.46, 0.47, 0.49);
  float bare = clamp(wearEdge + sc * 0.8 + bolt * 0.6, 0.0, 1.0);
  s.albedo = mix(paint, steel, bare);
  s.albedo *= 1.0 - seam * 0.85;
  s.albedo *= 1.0 - vent * 0.9;
  s.rough = mix(0.46 + smear * 0.16, 0.34, bare);
  s.metal = max(bare, 0.25);
  s.extra = 1.0;
  return s;
}

// Glazed tile. Tile 2 m, 25 cm squares, dirty grout, a few cracked or chipped.
Surf surface_tile(vec2 uv) {
  Surf s;
  vec2 g = uv * 8.0;
  ivec2 id = wrapCell(ivec2(floor(g)), ivec2(8));
  vec2 f = fract(g) - 0.5;
  float d = boxDist(f, vec2(0.47));
  float grout = smoothstep(-0.008, 0.012, d);
  float bevel = smoothstep(-0.05, -0.006, d);
  float tint = hash1(id, 91u);
  float grit = fbm(uv, ivec2(140), 3, 92u);
  float smear = fbm(uv, ivec2(6), 6, 93u);
  vec3 w = worley(uv, ivec2(9), 94u);
  float crack = (1.0 - smoothstep(0.0, 0.016, w.y - w.x)) * step(0.7, hash1(id, 95u));
  float chipN = fbm(uv, ivec2(40), 4, 96u);
  float chip = smoothstep(0.44, 0.47, d + chipN * 0.09 - 0.04) * step(0.6, hash1(id, 97u)) * (1.0 - grout);
  s.height = 0.7 - grout * 0.32 - bevel * 0.07 + (tint - 0.5) * 0.05 - crack * 0.2 - chip * 0.24 + (grit - 0.5) * 0.01;
  vec3 glaze = mix(vec3(0.27, 0.31, 0.33), vec3(0.38, 0.42, 0.43), tint);
  glaze *= 1.0 - smoothstep(0.42, 0.78, smear) * 0.3;
  vec3 mud = vec3(0.06, 0.06, 0.06) * (0.6 + grit);
  s.albedo = mix(glaze, mud, max(grout, max(chip, crack * 0.7)));
  s.rough = mix(0.1 + smear * 0.24, 0.88, max(grout, chip));
  s.metal = 0.0;
  s.extra = 1.0;
  return s;
}

// Packed dirt and grit. Tile 4 m.
Surf surface_dirt(vec2 uv) {
  Surf s;
  float big = fbm(uv, ivec2(5), 7, 101u);
  float mid = fbm(uv, ivec2(30), 5, 102u);
  vec3 p1 = worley(uv, ivec2(70), 103u);
  vec3 p2 = worley(uv, ivec2(170), 104u);
  float pebble = (1.0 - smoothstep(0.12, 0.42, p1.x)) * step(0.55, p1.z);
  float grit = (1.0 - smoothstep(0.1, 0.45, p2.x)) * step(0.4, p2.z);
  s.height = 0.38 + (big - 0.5) * 0.46 + (mid - 0.5) * 0.2 + pebble * 0.32 + grit * 0.1;
  vec3 soil = mix(vec3(0.034, 0.03, 0.027), vec3(0.1, 0.087, 0.074), big * 0.6 + mid * 0.4);
  vec3 stone = mix(vec3(0.09, 0.09, 0.09), vec3(0.2, 0.2, 0.2), p1.z);
  s.albedo = mix(soil, stone, pebble * 0.85 + grit * 0.2);
  s.rough = 0.92 - pebble * 0.2;
  s.metal = 0.0;
  s.extra = 1.0;
  return s;
}

// Diamond tread. Tile 1 m.
Surf surface_rubber(vec2 uv) {
  Surf s;
  vec2 g = uv * 20.0;
  vec2 f = fract(g) - 0.5;
  float odd = mod(floor(g.x) + floor(g.y), 2.0);
  vec2 r = odd > 0.5 ? vec2(f.x + f.y, f.x - f.y) : vec2(f.x - f.y, f.x + f.y);
  float pill = boxDist(r, vec2(0.32, 0.07));
  float tread = 1.0 - smoothstep(-0.02, 0.03, pill);
  float grit = fbm(uv, ivec2(100), 4, 111u);
  float scuff = smoothstep(0.5, 0.72, fbm(uv, ivec2(9), 6, 112u));
  s.height = 0.4 + tread * 0.42 + (grit - 0.5) * 0.04;
  s.albedo = vec3(0.018, 0.019, 0.021) * (0.8 + grit * 0.6) + scuff * tread * 0.022;
  s.rough = 0.74 - scuff * tread * 0.22;
  s.metal = 0.0;
  s.extra = 1.0;
  return s;
}

// Enamel paint over steel. Albedo is near white so material.color picks the hue, chips stay dark. Tile 2 m.
Surf surface_paint(vec2 uv) {
  Surf s;
  float peel = fbm(uv, ivec2(90), 3, 121u);
  float field = fbm(uv, ivec2(8), 7, 122u);
  float chipN = fbm(uv, ivec2(50), 4, 123u);
  float chip = smoothstep(0.665, 0.68, field * 0.7 + chipN * 0.3);
  float chipEdge = smoothstep(0.64, 0.665, field * 0.7 + chipN * 0.3) * (1.0 - chip);
  float sc = scratches(uv, ivec2(28), 2.6, 0.022, 124u);
  float grime = smoothstep(0.45, 0.8, fbm(uv, ivec2(6), 6, 125u));
  s.height = 0.66 + (peel - 0.5) * 0.024 - chip * 0.2 + chipEdge * 0.03 - sc * 0.06;
  vec3 paint = vec3(0.93) * (1.0 - grime * 0.38);
  vec3 under = vec3(0.09, 0.095, 0.1);
  s.albedo = mix(paint, under, max(chip, sc * 0.7));
  s.rough = mix(0.32 + grime * 0.3 + (peel - 0.5) * 0.08, 0.62, chip);
  s.metal = chip * 0.85;
  s.extra = 1.0;
  return s;
}

// Basalt crust over magma. Tile 6 m. Extra is heat: 1 in open cracks, falling to 0 under the plates.
Surf surface_lava(vec2 uv) {
  Surf s;
  vec2 warp = vec2(fbm(uv, ivec2(5), 5, 131u), fbm(uv, ivec2(5), 5, 132u)) - 0.5;
  vec2 q = uv + warp * 0.1;
  vec3 c = worley(q, ivec2(7), 133u);
  vec3 c2 = worley(q, ivec2(19), 134u);
  float gap = c.y - c.x;
  float gap2 = c2.y - c2.x;
  float crack = 1.0 - smoothstep(0.02, 0.3, gap);
  float crack2 = (1.0 - smoothstep(0.0, 0.1, gap2)) * 0.55;
  float grit = fbm(q, ivec2(60), 5, 135u);
  s.height = 0.3 + smoothstep(0.0, 0.3, gap) * 0.5 + (grit - 0.5) * 0.28 - crack2 * 0.18;
  s.albedo = vec3(0.026, 0.022, 0.021) * (0.6 + grit * 1.1);
  s.rough = 0.86;
  s.metal = 0.0;
  s.extra = clamp(max(crack, crack2 * 0.7) + (1.0 - smoothstep(0.0, 0.62, gap)) * 0.3, 0.0, 1.0);
  return s;
}

${DECAL_GLSL}
`;
