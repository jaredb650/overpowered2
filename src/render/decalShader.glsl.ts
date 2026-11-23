/**
 * What the decal material adds to the patched PBR shader: where a cell sits on the sheet, and how blood is drawn from
 * the fields a blood cell stores (`materials/decalAtlas.glsl.ts` says what they are). `Decals.ts` owns the instances.
 *
 *   aDecal.x  cell, plus (fraction / 0.9) how full the stain is: 0.5 is the outline as drawn
 *   aDecal.y  world time it was laid
 *   aDecal.z  kind (0 mark, 1 blood, 2 run, 3 growing blood, 4 a floor tile of old blood) + 8 if mirrored in X + 16 if mirrored
 *             in Y, plus (fraction) its own seed
 *   aDecal.w  blood: the wet lip's width in field units. A run: its length over its width.
 */
import { MapTuning } from './BloodMap';
import { CELL, SHEET, SMALL_CELLS } from './decalSheet';

const rows = SHEET.smallRows + SHEET.bigRows * 2;
const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export const DECAL_VERT_PARS = /* glsl */ `
attribute vec4 aDecal;
varying vec2 vOpUv;
flat varying vec4 vOpDecal;
flat varying vec4 vOpRect;
flat varying vec2 vOpSize;
varying vec3 vOpT;
varying vec3 vOpB;
`;

export const DECAL_VERT_MAIN = /* glsl */ `
vOpDecal = aDecal;
float opCell = floor(aDecal.x);
vOpRect = opCell < ${f(SMALL_CELLS)}
  ? vec4(mod(opCell, ${f(SHEET.smallCols)}) / ${f(SHEET.smallCols)}, floor(opCell / ${f(SHEET.smallCols)}) / ${f(rows)}, 1.0 / ${f(SHEET.smallCols)}, 1.0 / ${f(rows)})
  : vec4(
      mod(opCell - ${f(SMALL_CELLS)}, ${f(SHEET.bigCols)}) / ${f(SHEET.bigCols)},
      (${f(SHEET.smallRows)} + floor((opCell - ${f(SMALL_CELLS)}) / ${f(SHEET.bigCols)}) * 2.0) / ${f(rows)},
      1.0 / ${f(SHEET.bigCols)}, 2.0 / ${f(rows)});
// A stain may be laid mirrored, so the few shapes on the sheet go further. The tangents turn with it.
float opBits = floor(aDecal.z / 8.0);
vec2 opFlip = vec2(mod(opBits, 2.0) > 0.5 ? -1.0 : 1.0, opBits > 1.5 ? -1.0 : 1.0);
vOpUv = (uv - 0.5) * opFlip + 0.5;
if (mod(floor(aDecal.z), 8.0) > 3.5) {
  // A floor tile: its "cell" is its place in the blood map, inside the guard band.
  vOpRect = vec4(
    (mod(opCell, ${f(MapTuning.side)}) * ${f(MapTuning.tilePx)} + ${f(MapTuning.guard)}) / ${f(MapTuning.side * MapTuning.tilePx)},
    (floor(opCell / ${f(MapTuning.side)}) * ${f(MapTuning.tilePx)} + ${f(MapTuning.guard)}) / ${f(MapTuning.side * MapTuning.tilePx)},
    vec2(${f(MapTuning.tilePx - 2 * MapTuning.guard)} / ${f(MapTuning.side * MapTuning.tilePx)}));
}
vOpSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
vOpT = mat3(viewMatrix) * instanceMatrix[0].xyz * opFlip.x;
vOpB = mat3(viewMatrix) * instanceMatrix[1].xyz * opFlip.y;
`;

const detail = [(CELL.detail % SHEET.smallCols) / SHEET.smallCols, Math.floor(CELL.detail / SHEET.smallCols) / rows, 1 / SHEET.smallCols, 1 / rows];

export const DECAL_FRAG_PARS = /* glsl */ `
uniform sampler2D opDecalA;
uniform sampler2D opDecalS;
uniform sampler2D opBloodMap;
uniform highp sampler2D opDepth;
uniform vec2 opProj;
uniform float opWorldTime;
varying vec2 vOpUv;
flat varying vec4 vOpDecal;
flat varying vec4 vOpRect;
flat varying vec2 vOpSize;
varying vec3 vOpT;
varying vec3 vOpB;

// Blood as the light sees it. The hue is its own; the brightness comes from the light (see LIGHT below).
const vec3 OP_THIN = vec3(0.22, 0.002, 0.006);
const vec3 OP_THICK = vec3(0.125, 0.0, 0.004);
const vec3 OP_DRY_RIM = vec3(0.05, 0.002, 0.002);
const vec3 OP_DRY_MID = vec3(0.115, 0.01, 0.007);
const vec4 OP_DETAIL = vec4(${detail.map(f).join(', ')});

/** The detail tile, repeated: m in tiles. r cracks, g blotches, b specks. */
vec3 opDetailGrad(vec2 m, vec2 dmx, vec2 dmy) {
  vec2 t = fract(m) * (1.0 - 2.0 / 256.0) + 1.0 / 256.0;
  return textureGrad(opDecalA, OP_DETAIL.xy + t * OP_DETAIL.zw, dmx * OP_DETAIL.zw, dmy * OP_DETAIL.zw).rgb;
}
`;

/**
 * Decals test depth themselves against this frame's depth texture instead of using the hardware
 * test. A fragment survives only if the surface there lies within a few millimetres of the decal
 * plane, so nothing can z-fight, nothing hangs off a ledge, and anything in front hides it.
 */
export const DECAL_FRAG_MAIN = /* glsl */ `
float opZ = opProj.y / (texelFetch(opDepth, ivec2(gl_FragCoord.xy), 0).r * 2.0 - 1.0 + opProj.x);
if (abs(opZ - vViewPosition.z) > 0.03 + vViewPosition.z * 0.0025) discard;
vec2 opP = vOpUv;
float opAge = max(opWorldTime - vOpDecal.y, 0.0);
float opSeed = fract(vOpDecal.z);
float opKind = mod(floor(vOpDecal.z), 8.0);
bool opBlood = opKind > 0.5;
vec4 opA;
vec4 opS = vec4(0.5, 0.5, 1.0, 0.0);
vec3 opTint = vec3(0.0);
vec2 opTilt = vec2(0.0);
float opRough = 1.0;
float opThick = 0.0;
float opLip = 0.0;
float opRim = 0.0;
float opCrack = 0.0;
if (opKind > 1.5 && opKind < 2.5) {
  // A run down a wall. +X is down: the top sits in the stain that feeds it. The front creeps down over a second or
  // two and slows, with a bead of blood at its head, and the run thins and wanders on the way.
  float seed = opSeed * 57.0;
  float aspect = vOpDecal.w;
  float reach = 0.55 + 0.45 * fract(seed * 0.37);
  float front = reach * (1.0 - exp(-opAge * (1.3 + fract(seed * 0.71) * 1.2)));
  float x = opP.x;
  float across = (opP.y - 0.5) * 2.0 + (sin(x * 9.0 + seed) * 0.5 + sin(x * 23.0 - seed * 1.7) * 0.25) * 0.3;
  float halfW = mix(0.78, 0.32, x) * (0.85 + 0.15 * sin(x * 31.0 + seed * 3.0));
  float bead = 0.9 - length(vec2((x - front) * aspect * 2.0, across * 0.85));
  float body = x < front ? halfW - abs(across) : -1.0;
  float f = max(body, bead * 0.75);
  float aa = max(fwidth(f), 0.002);
  float cover = clamp(f / aa + 0.5, 0.0, 1.0) * smoothstep(0.0, 0.04, x);
  if (cover < 0.004) discard;
  float round_ = clamp(1.0 - abs(across) / max(halfW, 0.05), 0.0, 1.0);
  // The bead is the thick part; the track it leaves behind is a film.
  opThick = mix(0.3 + 0.3 * round_, 0.95, clamp(bead * 1.4, 0.0, 1.0));
  opLip = 1.0 - round_;
  opA = vec4(1.0, 1.0, 1.0, cover * mix(0.8, 0.98, opThick));
  // A rounded bead of liquid: the normal rolls across it.
  opTilt = vec2(0.0, clamp(across / max(halfW, 0.05), -1.0, 1.0) * 0.3 * round_);
} else if (opKind > 3.5) {
  // A floor tile: every stain that dried on this floor, as one outline field. Drawn dry, under the fresh ones.
  float field = texture2D(opBloodMap, vOpRect.xy + opP * vOpRect.zw).r;
  float aa = max(fwidth(field) * 0.75, 0.003);
  vec2 m = opP * vOpSize * 5.0;
  vec2 dmx = dFdx(m);
  vec2 dmy = dFdy(m);
  if (field + 0.5 * aa <= 0.45) discard;
  vec2 mFw = abs(dmx) + abs(dmy);
  float near = 1.0 - smoothstep(0.08, 0.3, max(mFw.x, mFw.y));
  vec3 det = near > 0.0 ? opDetailGrad(m, dmx, dmy) : vec3(0.0);
  float th = 0.5 + (det.g - 0.5) * 0.1 * near;
  float cover = clamp((field - th) / aa + 0.5, 0.0, 1.0);
  if (cover < 0.004) discard;
  opThick = 0.3 + 0.45 * smoothstep(0.55, 0.95, field);
  opRim = 1.0 - smoothstep(0.0, 0.2, field - th);
  opCrack = det.r * near;
  opA = vec4(1.0, 1.0, 1.0, cover * 0.94);
} else if (opBlood) {
  vec2 q = opP * 2.0 - 1.0;
  // No two stains quite match: each is pulled a little out of shape its own way.
  float seed = opSeed * 57.0;
  q += vec2(
    sin(q.y * 7.0 + seed) + 0.5 * sin(q.y * 17.0 - seed * 1.7),
    sin(q.x * 8.0 - seed * 0.7) + 0.5 * sin(q.x * 19.0 + seed * 1.3)
  ) * 0.012;
  opP = q * 0.5 + 0.5;
  vec2 uvA = vOpRect.xy + opP * vOpRect.zw;
  vec2 uvADx = dFdx(uvA);
  vec2 uvADy = dFdy(uvA);
  vec2 m = vOpUv * vOpSize * 5.0 + seed;
  vec2 dmx = dFdx(m);
  vec2 dmy = dFdy(m);
  if (opP.x < 0.0 || opP.y < 0.0 || opP.x > 1.0 || opP.y > 1.0) discard;
  vec4 a = textureGrad(opDecalA, uvA, uvADx, uvADy);
  float field = a.a;
  float aa = max(fwidth(field) * 0.75, 0.003);
  vec2 mFw = abs(dmx) + abs(dmy);
  float near = 1.0 - smoothstep(0.08, 0.3, max(mFw.x, mFw.y));
  float th = 0.32 + 0.4 * fract(vOpDecal.x);
  // A pool spreads from where it started to its outline, fast and then slowly, and keeps creeping.
  if (opKind > 2.5) th = mix(0.97, th, 1.0 - exp(-opAge * 0.55)) - min(opAge * 0.0006, 0.03);
  if (near <= 0.0 && field + 0.5 * aa <= th && a.g * 0.42 < 0.004) discard;
  // Detail at real size, whatever the stain's: one tile is 20 cm.
  vec3 det = near > 0.0 ? opDetailGrad(m, dmx, dmy) : vec3(0.0);
  // The floor's grain breaks the outline.
  th += (det.g - 0.5) * 0.09 * near;
  float cover = clamp((field - th) / aa + 0.5, 0.0, 1.0);
  float inside = field - th;
  float lipW = vOpDecal.w;
  opThick = max(a.r * smoothstep(0.0, lipW * 1.6, inside), 0.04) * cover;
  // The mist round it: specks at real size, more of them where the haze is dense, a faint film far away.
  float haze = a.g * (1.0 - cover);
  float speck = near > 0.0 ? smoothstep(-0.05, 0.08, det.b - (1.0 - haze * 0.92)) : 0.0;
  float hazeA = mix(haze * 0.42, speck * 0.85 + haze * 0.12, near);
  float alpha = max(cover * mix(0.8, 0.985, smoothstep(0.0, 0.5, opThick)), hazeA);
  if (alpha < 0.004) discard;
  opThick = max(opThick, 0.1 * step(cover, 0.5));
  opLip = cover * (1.0 - smoothstep(0.0, lipW, inside));
  opRim = cover * (1.0 - smoothstep(0.0, min(lipW * 5.0, 0.45), inside));
  opCrack = det.r * near;
  if (opLip > 0.0) {
    vec2 n2 = (textureGrad(opDecalS, uvA, uvADx, uvADy).xy * 2.0 - 1.0) / vOpSize;
    float nl = length(n2);
    // A small drop's lip is slight; a pool's stands up.
    opTilt = nl > 1e-4 ? n2 / nl * pow(opLip, 1.3) * 0.46 * clamp(min(vOpSize.x, vOpSize.y) * 2.2, 0.3, 1.0) : vec2(0.0);
  }
  opA = vec4(1.0, 1.0, 1.0, alpha);
} else {
  vec2 uvA = vOpRect.xy + opP * vOpRect.zw;
  vec2 uvADx = dFdx(uvA);
  vec2 uvADy = dFdy(uvA);
  if (opP.x < 0.0 || opP.y < 0.0 || opP.x > 1.0 || opP.y > 1.0) discard;
  opA = textureGrad(opDecalA, uvA, uvADx, uvADy);
  if (opA.a < 0.004) discard;
  opS = textureGrad(opDecalS, uvA, uvADx, uvADy);
  opTilt = opS.xy * 2.0 - 1.0;
  opRough = opS.z;
}
float opDry = 0.0;
if (opBlood) {
  // Thin blood dries in seconds, a pool's middle stays wet for more than a minute. Wet: deep red where it is thick,
  // bright where it is thin, glossy, with a lip that stands up. Dry: flat and matt, dark at the rim, a paler middle
  // that cracks.
  opDry = smoothstep(0.3, 1.0, opAge / (5.0 + 85.0 * opThick * opThick));
  vec3 wetC = mix(OP_THIN, OP_THICK, smoothstep(0.08, 0.8, opThick));
  vec3 dryC = mix(OP_DRY_MID, OP_DRY_RIM, max(max(opLip, opRim * 0.85), 1.0 - smoothstep(0.12, 0.5, opThick)));
  dryC *= 1.0 - 0.6 * opCrack * smoothstep(0.45, 0.8, opThick);
  opTint = mix(wetC, dryC, opDry);
  opTilt *= 1.0 - 0.85 * opDry;
  opRough = mix(mix(0.34, 0.1, smoothstep(0.1, 0.7, opThick)), 0.82, opDry);
}
diffuseColor = vec4(opBlood ? vec3(1.0) : opA.rgb, opA.a);
`;

/**
 * Red reflects nothing under cyan light, and this map is lit cyan, so blood would dry to black the moment
 * it landed. It takes its brightness from the light and keeps its own hue. It adds no light of its own.
 */
export const DECAL_LIGHT = /* glsl */ `
#include <lights_fragment_end>
if (opBlood) {
  float opLight = dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
  reflectedLight.directDiffuse = vec3(0.0);
  // Under a hard light blood goes a deeper red, not pink: its brightness levels off.
  reflectedLight.indirectDiffuse = opTint * (opLight * 2.0 / (1.0 + opLight * 0.9));
  // A wet floor mirrors the whole sky at a low angle and blood would go pale with it: it keeps the glints, not the sheen.
  reflectedLight.indirectSpecular *= 0.4;
  // Under a weapon light the floor under a stain is many times white, and the fifth of it that thin blood lets through
  // was enough to wash the stain to pink, and a dried one nearly away (the fit pass's night check). Blood is a filter
  // over what it lies on, not a veil: the harder the light, the less of the floor comes through unreddened. Where there
  // is blood at all, that is; the mist round a stain stays mist.
  float opHard = opLight * 1.6 / (1.0 + opLight * 1.6);
  diffuseColor.a += (1.0 - diffuseColor.a) * smoothstep(0.5, 0.78, diffuseColor.a) * opHard;
  // And every drop's raised lip faces a light held at the eye, so each was ringed in white: the glint levels off too.
  reflectedLight.directSpecular /= 1.0 + opLight * 0.7;
}
`;

export const DECAL_NORMAL = /* glsl */ `
{
  vec3 T = normalize(vOpT);
  vec3 B = normalize(vOpB);
  normal = normalize(T * opTilt.x + B * opTilt.y + normal * sqrt(max(1.0 - dot(opTilt, opTilt), 0.0)));
}
`;

export const DECAL_ROUGHNESS = 'float roughnessFactor = opRough;';
export const DECAL_METALNESS = 'float metalnessFactor = opBlood ? 0.0 : opS.w;';
