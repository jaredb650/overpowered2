/**
 * Character surface. One MeshStandardMaterial per model, shared by every instance: all per-instance state
 * (wounds, blood, burn, frost, hit flash) rides in spare texels at the end of the instance's bone texture,
 * which is already bound and uploaded per skeleton. That keeps a crowd on one program and one material with
 * no per-object uniform traffic.
 *
 * Wounded bodies swap to a second program, so a healthy crowd never pays for any of it.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { mulberry32 } from '../core/math';
import { EXTRA_BLOOD_MAP, EXTRA_FIRE, EXTRA_INFO, EXTRA_PARAMS, WEAR_VERTEX, WOUND_COMMON, WOUND_REGION, WOUND_VERTEX_LOOP } from './anatomy/glsl';

const VERT_PARS = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aMat;
attribute vec4 aSkinQuat;
varying vec4 vColorAO;
varying vec4 vMatV;
varying vec4 vDetailW;
varying vec3 vBind;
varying vec3 vBindN;
varying vec3 vSk0;
varying vec3 vSk1;
varying vec3 vSk2;
#ifdef OP2_ATLAS
varying vec2 vAtlasUv;
#endif
#ifdef OP2_WOUNDS
varying vec3 vWoundTilt;
varying float vWoundNear;
flat varying int vRegion;
#endif
// Wear (anatomy/glsl.ts WEAR_VERTEX): on a body with wounds or worn skin, and on any skinned body far off.
#if defined(OP2_WOUNDS) || (defined(OP2_FAR) && defined(USE_SKINNING))
#define OP2_WEARS
varying vec4 vWear;
#endif
`;

/** Goes after three's skinning declarations, which it reads. */
const VERT_WOUND_PARS = /* glsl */ `
#ifdef OP2_WEARS
uniform int uExtraBase;
${WOUND_COMMON}
${WEAR_VERTEX}
#endif
#ifdef OP2_WOUNDS
${WOUND_REGION}
#endif
`;

const VERT_MAIN = /* glsl */ `
#ifdef OP2_WOUNDS
{
  vec3 op2Push = vec3(0.0), op2Tilt = vec3(0.0);
  float op2Near = -1.0;
  ${WOUND_VERTEX_LOOP}
  vWoundNear = op2Near;
  vWoundTilt = op2Tilt;
  vRegion = op2Region();
  transformed += op2Push;
}
#endif
#ifdef OP2_WEARS
vWear = op2Wear();
#endif
{
  vColorAO = vec4(pow(aColor.rgb, vec3(2.2)), aColor.a);
  float code = floor(aMat.a * 255.0 + 0.5);
  float kind = mod(code, 4.0);
  vMatV = vec4(aMat.rgb, step(3.5, code));
  vDetailW = vec4(kind < 0.5, kind > 0.5 && kind < 1.5, kind > 1.5 && kind < 2.5, kind > 2.5);
  vBind = position;
  vBindN = normal;
  #ifdef OP2_ATLAS
  vAtlasUv = uv;
  #endif
  #ifdef USE_SKINNING
  vSk0 = skinMatrix[0].xyz; vSk1 = skinMatrix[1].xyz; vSk2 = skinMatrix[2].xyz;
  #else
  vec4 q = aSkinQuat;
  vSk0 = vec3(1.0 - 2.0 * (q.y * q.y + q.z * q.z), 2.0 * (q.x * q.y + q.z * q.w), 2.0 * (q.x * q.z - q.y * q.w));
  vSk1 = vec3(2.0 * (q.x * q.y - q.z * q.w), 1.0 - 2.0 * (q.x * q.x + q.z * q.z), 2.0 * (q.y * q.z + q.x * q.w));
  vSk2 = vec3(2.0 * (q.x * q.z + q.y * q.w), 2.0 * (q.y * q.z - q.x * q.w), 1.0 - 2.0 * (q.x * q.x + q.y * q.y));
  #endif
}
`;

/** Metres, in the bind pose, over which a fire walks out from where it caught: a hand to the far foot. */
export const FIRE_REACH = 1.9;
/** How cooked the flesh a fire bares is drawn (`sChar`): dark and dry, but still meat against the black of the skin. */
const FIRE_COOKED = 0.95;

/**
 * Bared flesh (`sBare`) is lit a second time by the brightness of the light on it, so red reads under blue light: this
 * much of that brightness, and no more of it than `most` (a hard lamp does not turn a wound orange).
 */
const BARE = { gain: 0.8, most: 0.55 };
/**
 * The most light a burnt pixel gives back, as radiance before the tone map (lit concrete at night is about 0.05 to 0.1,
 * and under the weapon light several): char and soot, the meat a fire has bared and cooked, and its bone.
 */
const COAL = { most: 0.035, cooked: 0.08, bone: 0.3 };

const FRAG_PARS = /* glsl */ `
#define OP2_BARE_GAIN ${BARE.gain.toFixed(2)}
#define OP2_BARE_MOST ${BARE.most.toFixed(2)}
#define OP2_COAL_MOST ${COAL.most.toFixed(3)}
#define OP2_COOKED_MOST ${COAL.cooked.toFixed(3)}
#define OP2_BONE_MOST ${COAL.bone.toFixed(3)}
#define OP2_FIRE_REACH ${FIRE_REACH.toFixed(2)}
#define OP2_FIRE_COOKED ${FIRE_COOKED.toFixed(2)}
varying vec4 vColorAO;
varying vec4 vMatV;
varying vec4 vDetailW;
varying vec3 vBind;
varying vec3 vBindN;
varying vec3 vSk0;
varying vec3 vSk1;
varying vec3 vSk2;
uniform mat3 normalMatrix;
uniform sampler2D tDetail;
uniform float uEmissive;
uniform float uRim;
uniform float uFill;
#ifdef OP2_ATLAS
varying vec2 vAtlasUv;
uniform sampler2D tAtlasA;
uniform sampler2D tAtlasB;
#endif
#ifdef OP2_BLOOD_MAP
uniform highp sampler2DArray tBloodMap;
#endif
#ifdef OP2_SKINNED
uniform highp sampler2D boneTexture;
uniform int uExtraBase;
${WOUND_COMMON}
#endif
#if defined(OP2_WOUNDS) || (defined(OP2_FAR) && defined(OP2_SKINNED))
#define OP2_WEARS
varying vec4 vWear;
#endif
#ifdef OP2_WOUNDS
varying vec3 vWoundTilt;
varying float vWoundNear;
flat varying int vRegion;
// A crater as big as a partial head wound tears out in a few lobes round its line, so it is not a round hole. A share
// of its radius, from where it sits, so each wound keeps its own shape.
float op2Lobes(vec3 off, vec3 axis, vec3 at) {
  vec3 b1 = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  float a = atan(dot(off, cross(axis, b1)), dot(off, b1));
  float ph = dot(at, vec3(371.0, 917.0, 533.0));
  return sin(a * 3.0 + ph) * 0.22 + sin(a * 5.0 + ph * 1.7) * 0.14 + sin(a * 9.0 + ph * 2.3) * 0.07;
}
#endif
vec4 op2Tri(vec3 p, vec3 w) {
  return texture2D(tDetail, p.zy) * w.x + texture2D(tDetail, p.xz) * w.y + texture2D(tDetail, p.xy) * w.z;
}
// Thin connected lines, from where noise crosses its middle value: the shape of mud drying out. That noise sits close
// to its middle almost everywhere, so the band has to be narrow to come out as a line at all.
float op2Crack(vec4 macro, vec4 micro) {
  #ifdef OP2_FAR
  return 0.0;
  #else
  return 1.0 - smoothstep(0.006, 0.02, abs(macro.a - 0.5 + (micro.a - 0.5) * 0.05));
  #endif
}
// The same, wide: the warm skin either side of a split that is still hot.
float op2CrackWide(vec4 macro, vec4 micro) {
  #ifdef OP2_FAR
  return 0.0;
  #else
  return 1.0 - smoothstep(0.012, 0.075, abs(macro.a - 0.5 + (micro.a - 0.5) * 0.05));
  #endif
}
// Height in meters to a bent normal. Unnormalized screen derivatives keep the strength independent of distance.
vec3 op2Bump(vec3 pos, vec3 n, float h, float face) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * face;
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}
`;

/**
 * Wear you can see: how far through its skin a pixel is, from how much of its region's health pool is spent (`vWear`,
 * anatomy/glsl.ts). The skin goes by a threshold walking through noise, so it tears in patches, and the noise is the kind
 * of damage: rounds and blows leave ragged patches with pits, a blade opens long cuts across the limb, a blast strips it in
 * sheets and scorches what it leaves. At the joint the region comes off at, the last of the pool takes the skin all the way
 * round. Far off there is no noise to read: the vertex's own wear is the depth.
 */
const WEAR_DRIVER = /* glsl */ `
    if (vWear.x > 0.01) {
      #ifdef OP2_FAR
      sThrough = vWear.x * 0.9 + vWear.y * 0.4 - 0.42;
      #else
      float wide = texture2D(tDetail, vBind.xy * 0.31 + vBind.z * 0.23 + 0.11).a;
      // Spread out to fill 0..1, so about the share of the skin that is torn is the share of the pool that is spent.
      float patches = clamp((wide * 0.7 + macro.a * 0.22 + micro.r * 0.08 - 0.5) * 3.0 + 0.5, 0.0, 1.0);
      // Long thin lines slanting across the body: noise read slowly one way and fast the other, taken where it crosses its middle.
      vec2 across = vec2(vBind.x * 0.8 + vBind.y * 0.6 + vBind.z * 0.55, vBind.y * 0.8 - vBind.x * 0.6 + vBind.z * 0.3);
      float cuts = clamp(abs(texture2D(tDetail, vec2(across.x * 0.16, across.y * 1.1)).a - 0.5) * 6.5 + (micro.r - 0.5) * 0.04, 0.0, 1.0);
      float sheets = clamp((wide * 0.8 + macro.a * 0.2 - 0.5) * 3.4 + 0.5, 0.0, 1.0);
      float field = mix(mix(patches, cuts, vWear.z), sheets, vWear.w);
      sThrough = pow(vWear.x, 1.15) * 0.97 + vWear.y * 0.8 - field;
      #endif
      sChar = vWear.w * 0.5;
    }
`;

/**
 * Fire's burn-through, the second driver of SKIN_GONE (the gore update's F2: "fire should eat skin down to muscle and
 * bone"). `eaten` 0..1 (Character.setBurnThrough) walks a threshold through big patches of noise and through the distance
 * from where the fire caught, so the skin goes first and deepest there: raw edge, charred muscle, then slivers of bone.
 * What it bares is cooked, not wet: `sChar`. Plate does not burn through. Not while the Lance is dissolving the body.
 */
const FIRE_DRIVER = /* glsl */ `
    float sEaten = op2Extra(${EXTRA_FIRE + 1}).y;
    float sFireDepth = -1.0;
    if (sEaten > 0.004 && ex.z <= 1.0) {
      vec4 fireAt = op2Extra(${EXTRA_FIRE});
      float from = fireAt.w > 0.5 ? clamp(distance(vBind, fireAt.xyz) / OP2_FIRE_REACH, 0.0, 1.0) : 0.45;
      #ifdef OP2_FAR
      float patches = 0.35;
      #else
      float wide = texture2D(tDetail, vBind.xy * 0.31 + vBind.z * 0.23 + 0.11).a;
      // Spread out to fill 0..1, so the share of the skin that has gone is the number below.
      float patches = clamp((wide * 0.7 + macro.a * 0.22 + micro.r * 0.08 - 0.5) * 3.0 + 0.5, 0.0, 1.0);
      #endif
      // Burnt right through, 0.8 of the skin has gone where the fire caught and 0.4 at the far end of the body. The depth
      // is steep, so the middle of a bared patch is down to bone while its edge is still raw.
      sFireDepth = sPlate > 0.5 ? -1.0 : (sEaten * 0.8 - from * 0.4 - patches) * 1.3;
      if (sFireDepth > sThrough) {
        sThrough = sFireDepth;
        sChar = OP2_FIRE_COOKED;
      }
    }
`;

/**
 * While the flames are on it, what the fire has bared glows a little along its fibres, and brightest at the edge where the
 * skin is still going. Once it only smoulders (heat 0.6 and under) the bared flesh is dark: the glow left is the skin's.
 */
const FIRE_GLOW = /* glsl */ `
    if (sFireDepth > -0.06) {
      float flames = clamp(op2Extra(${EXTRA_FIRE + 1}).x * 2.5 - 1.5, 0.0, 1.0);
      float rim = smoothstep(-0.06, 0.0, sFireDepth) * (1.0 - smoothstep(0.0, 0.05, sFireDepth));
      float fibres = smoothstep(0.55, 0.8, texture2D(tDetail, vec2(vBind.x * 13.0 + vBind.z * 9.0, vBind.y * 2.4)).a) * smoothstep(0.0, 0.1, sFireDepth);
      sGlow += vec3(1.0, 0.24, 0.03) * flames * (rim * 2.5 + fibres * 0.3);
    }
`;

/**
 * What a pixel looks like with its skin gone to `sThrough`, whatever took it (the comment where it is used has the scale):
 * bruised just outside the tear, a raw edge, then muscle with its fibres running the length of the body and fat near the
 * edge, then bone with blood standing on it. Painted on the skin and sunk by the bump, at every level of detail, with no
 * extra draw. `sChar` burns it: black meat, grey bone.
 */
const SKIN_GONE = /* glsl */ `
    if (sThrough > -0.1) {
      float bruise = smoothstep(-0.1, 0.0, sThrough);
      float raw = smoothstep(0.0, 0.028, sThrough);
      float meat = smoothstep(0.12, 0.24, sThrough);
      // Bone shows as long slivers down the length of the body, where the meat is thinnest over it, not as blots.
      float shaft = texture2D(tDetail, vec2(vBind.x * 2.6 + vBind.z * 2.1, vBind.y * 0.42)).a;
      float bone = smoothstep(0.5, 0.57, sThrough - abs(shaft - 0.5) * 1.5);
      float streak = texture2D(tDetail, vec2(vBind.x * 13.0 + vBind.z * 9.0, vBind.y * 2.4)).a * 0.65 + micro.r * 0.35;
      vec3 under = mix(vec3(0.3, 0.032, 0.03), vec3(0.1, 0.007, 0.011), smoothstep(0.3, 0.7, streak));
      // Fat under the skin, in clumps, where the tear is shallow.
      under = mix(under, vec3(0.42, 0.27, 0.13), smoothstep(0.66, 0.76, macro.a * 0.7 + micro.a * 0.3) * 0.22 * (1.0 - meat));
      under = mix(under, under * 0.55, meat * 0.5);
      // Bone is never clean: blood sits on it in a film and it shows through where that has run off.
      float film = smoothstep(0.36, 0.64, macro.a * 0.55 + micro.a * 0.45);
      under = mix(under, mix(vec3(0.66, 0.6, 0.48) * (0.72 + micro.r * 0.36), vec3(0.13, 0.012, 0.01), film * 0.6), bone);
      // Cooked: dark, and brown more than red (under a hard light the red of it read as salmon).
      under = mix(under, mix(under * 0.16, vec3(0.05, 0.026, 0.016), 0.55 * (1.0 - bone)) + vec3(0.006, 0.005, 0.004), sChar * (1.0 - bone * 0.45));
      // Dried: not for bone, which only loses the wet on it.
      under *= mix(vec3(1.0), sDried, 1.0 - bone * 0.6);
      sAlb = mix(sAlb, vec3(0.04, 0.005, 0.009), bruise * 0.72 * (1.0 - sMetal * 0.5));
      sAlb = mix(sAlb, under, raw);
      sRough = mix(sRough, mix(mix(mix(0.24, 0.4, streak), 0.46, bone), 0.62, sDry * 0.8), raw);
      sMetal *= 1.0 - raw;
      sEmis *= 1.0 - raw;
      sH *= 1.0 - raw * 0.8;
      // Sunk below the skin's torn edge, deeper in the meat, the bone standing back up out of it.
      sWoundH -= raw * 0.003 + meat * 0.0045 - bone * 0.0025 + (streak - 0.5) * 0.0012 * raw;
      sBare = raw * (1.0 - sChar);
      // What a fire bared is burnt too: cooked meat gives back a little more than char, and bone more again, so both
      // show through the black. What a round or a blade bared is not burnt at all.
      sCoal = mix(sCoal, sChar, raw);
      sMost = mix(sMost, mix(OP2_COOKED_MOST, OP2_BONE_MOST, bone), raw);
      // And dry: cooked meat does not shine.
      sRough = mix(sRough, 0.82, raw * sChar * (1.0 - bone));
    }
`;

/**
 * What fire does to a surface, for a body (per instance, from its texels) and for the kit it carries (`charred`, below).
 * Reads `burn` 0..1, `heat` 0..1 and the noise `n`; `behind` is how long ago the fire's edge passed this pixel, in the
 * noise's own units: under 0 not yet, 0 the glowing edge, 0.4 and up burnt the longest.
 * Ahead of the edge the skin scalds red. Behind it: burnt brown, then black with flecks of pale ash, splitting as it
 * shrinks. The splits glow while it is hot and go dark and dry as it cools. Plate does not split: it is sooted black and
 * keeps a little of its shine.
 */
const BURN_SURFACE = /* glsl */ `
    float edge = burn * 1.45 - 0.2;
    float behind = edge - n;
    float charred = smoothstep(-0.1, 0.08, behind);
    float flesh = 1.0 - sMetal;
    float ember = smoothstep(0.035, 0.0, abs(behind)) * step(burn, 0.995);
    float crack = op2Crack(macro, micro) * charred * flesh;
    float scald = smoothstep(-0.36, -0.1, behind) * (1.0 - charred) * flesh;
    sAlb = mix(sAlb, vec3(0.2, 0.03, 0.018) + sAlb * vec3(0.4, 0.1, 0.06), scald * 0.75);
    sRough = mix(sRough, 0.3, scald * 0.5);
    vec3 coal = mix(vec3(0.05, 0.024, 0.012), vec3(0.011, 0.01, 0.01), smoothstep(0.04, 0.38, behind));
    float ash = smoothstep(0.6, 0.76, micro.a * 0.55 + macro.r * 0.45) * smoothstep(0.25, 0.65, behind) * (1.0 - heat * 0.7);
    coal = mix(coal, vec3(0.2, 0.195, 0.185), ash * 0.6);
    // Soot on plate: black, but still plate under it.
    coal = mix(sAlb * 0.07 + vec3(0.008), coal, flesh);
    sAlb = mix(sAlb, coal, charred);
    sRough = mix(sRough, mix(0.72, 0.95, flesh), charred);
    sMetal *= 1.0 - charred * 0.6;
    sCoal = charred;
    sEmis *= 1.0 - charred;
    // The char splits as it shrinks. What shows in the splits is raw while the fire is on it, dry and dark once it is cold.
    float live = max(heat, 1.0 - step(0.995, burn));
    sAlb = mix(sAlb, mix(vec3(0.028, 0.007, 0.005), vec3(0.13, 0.01, 0.006), live), crack);
    sRough = mix(sRough, mix(0.7, 0.34, live), crack);
    // As it cools, fewer of the splits still glow: the light goes out patch by patch.
    float lit = heat * smoothstep(1.0 - heat * 1.2, 1.25 - heat * 1.2, macro.r * 0.55 + micro.a * 0.45);
    sGlow += vec3(1.0, 0.24, 0.03) * (ember * 3.5 + crack * (burn * (1.0 - burn) * 1.2 + lit * 2.6) + op2CrackWide(macro, micro) * charred * flesh * lit * 0.3);
    #ifdef OP2_FAR
    sGlow += vec3(1.0, 0.24, 0.03) * (charred * flesh * heat * 0.1);
    #endif
`;

const FRAG_SURFACE = /* glsl */ `
vec3 sAlb = vColorAO.rgb;
float sRough = vMatV.x;
float sMetal = vMatV.y;
float sEmis = vMatV.z;
vec3 sN = normalize(vBindN);
#ifdef OP2_ATLAS
if (vMatV.w > 0.5) {
  vec4 ta = texture2D(tAtlasA, vAtlasUv);
  vec4 tb = texture2D(tAtlasB, vAtlasUv);
  sAlb = ta.rgb;
  sMetal = clamp(ta.a * 2.0, 0.0, 1.0);
  sEmis = clamp(ta.a * 2.0 - 1.0, 0.0, 1.0);
  if (sEmis > 0.0) sMetal = 0.0;
  sN = normalize(tb.xyz * 2.0 - 1.0);
  sRough = tb.a;
}
#endif

// Authored albedo is true to the materials, which is too dark for a world this dim. This curve lifts the
// darks about 2.8x and leaves the brights alone, so gear keeps its detail in a shadowed underpass.
// It scales by peak channel, so hue survives and flesh stays saturated red. Bare metal keeps more of its true
// value, because albedo is its reflectance and a lift reads as chrome.
sAlb *= mix(3.0 / (1.0 + max(sAlb.r, max(sAlb.g, sAlb.b)) * 2.4), 1.0, sMetal * 0.6);

#ifdef OP2_FAR
vec4 micro = vec4(0.5);
vec4 macro = vec4(0.5);
float sH = 0.0;
#else
vec3 tw = pow(abs(sN), vec3(4.0));
tw /= tw.x + tw.y + tw.z;
vec4 micro = op2Tri(vBind * 7.0, tw);
vec4 macro = op2Tri(vBind * 0.9 + 0.37, tw);
float sH = dot(micro, vDetailW) - 0.5;
sAlb *= 1.0 + sH * 0.22;
sRough = clamp(sRough + sH * 0.26, 0.05, 1.0);
#endif
float sBumpScale = dot(vDetailW, vec4(0.00035, 0.0005, 0.00011, 0.0004));
vec3 sGlow = vec3(0.0);
float sWoundH = 0.0;
// How much of this pixel is raw flesh laid bare (SKIN_GONE): it is lit warm from the eye, or red would be black here.
float sBare = 0.0;
// How much of this pixel is burnt (char, soot, cooked flesh), and the most light such a pixel gives back whatever is
// shone on it (FRAG_AO): char is black under a weapon light too.
float sCoal = 0.0, sMost = OP2_COAL_MOST;

#ifdef OP2_SKINNED
{
  vec4 ex = op2Extra(${EXTRA_PARAMS});
  vec4 info = op2Extra(${EXTRA_INFO});
  float blood = ex.x, flash = ex.y, burn = ex.z, frost = ex.w;
  // Drying (Character.setDry; gore dries the dead where they lie): the blood on the skin and the flesh a wound or wear
  // has bared go darker, browner and dull, as the blood on the floor round the body does.
  float sDry = op2Extra(${EXTRA_FIRE + 1}).w;
  vec3 sDried = mix(vec3(1.0), vec3(0.58, 0.44, 0.44), sDry);
  float seed = info.y;
  float grain = macro.r * 0.6 + macro.a * 0.4;
  // Plate, as it was before anything charred it: it soots, but it does not burn through.
  float sPlate = sMetal;

  if (burn > 0.001) {
    float n = grain * 0.7 + micro.b * 0.3;
    // Past 1 the body is vaporizing (Gore.vaporize): fully charred, lit from inside, and eaten away from 1 to 2.
    float vapor = clamp(burn - 1.0, 0.0, 1.0);
    burn = min(burn, 1.0);
    if (vapor > 0.0) {
      float hole = vapor * 1.2 - 0.12;
      if (n < hole) discard;
      float rim = smoothstep(0.09, 0.0, n - hole);
      float hot = 1.0 - smoothstep(0.0, 0.5, vapor);
      sGlow += vec3(0.45, 0.8, 1.0) * hot * (1.4 + 1.2 * micro.g) + vec3(1.0, 0.42, 0.08) * rim * 9.0;
    }
    // How hot the char still is: 1 alight, fading to 0 cold (Character.setEmber, kept by gore/fire.ts).
    float heat = op2Extra(${EXTRA_FIRE + 1}).x;
    // Where the fire caught (Character.setBurnOrigin): with one, the threshold is mostly how far a pixel is from it, so
    // the burn walks out across the body from there with a ragged edge, and is whole by about 0.75. Without one (a
    // blast's burn, lava) it comes up through the noise everywhere at once, as it always did.
    vec4 fireAt = op2Extra(${EXTRA_FIRE});
    if (fireAt.w > 0.5) n = n * 0.42 + clamp(distance(vBind, fireAt.xyz) / OP2_FIRE_REACH, 0.0, 1.0) * 0.72;
    ${BURN_SURFACE}
  }

  #ifdef OP2_WEARS
  {
    // Skin gone: one look for everything that takes the skin off a body without cutting a hole in it. Runs BEFORE
    // blood maps and 3D bullet holes so localized blood trails and punctures always read cleanly on top of torn flesh.
    float sThrough = -1.0, sChar = 0.0;
    ${WEAR_DRIVER}
    ${FIRE_DRIVER}
    ${SKIN_GONE}
    ${FIRE_GLOW}
  }
  #endif

  bool hasBloodMap = false;
  #ifdef OP2_BLOOD_MAP
  vec4 bmInfo = op2Extra(${EXTRA_BLOOD_MAP});
  hasBloodMap = bmInfo.x > 0.5;
  #endif

  float gBlood = hasBloodMap ? blood * 0.35 : blood;
  if (gBlood > 0.001) {
    // Coverage grows out of the creases: the threshold walks down through the noise as blood rises.
    // When a character owns a live dynamic UV blood map, global blotches step back so localized wound bleeding leads.
    float t = mix(0.9, 0.7, gBlood);
    float m = smoothstep(t, t + 0.2, grain * 0.7 + macro.a * 0.14 + micro.r * 0.16 + (1.0 - vColorAO.a) * 0.3);
    sAlb = mix(sAlb, mix(vec3(0.15, 0.004, 0.005), vec3(0.07, 0.002, 0.004), macro.a) * sDried, m * 0.9);
    sRough = mix(sRough, mix(0.2, 0.62, sDry), m);
    sMetal *= 1.0 - m;
  }

  #ifdef OP2_BLOOD_MAP
  if (hasBloodMap) {
    vec2 bm = texture(tBloodMap, vec3(vAtlasUv, bmInfo.x - 1.0)).rg;
    float bCov = bm.r;
    if (bCov > 0.01) {
      float bFresh = bm.g * (1.0 - sDry);
      float edgeNoise = (grain - 0.5) * 0.22 + (micro.g - 0.5) * 0.14;
      float soak = smoothstep(0.02, 0.42, bCov + edgeNoise * (1.0 - bCov));
      float thick = smoothstep(0.32, 0.85, bCov + edgeNoise * 0.35);
      float damp = soak * (1.0 - sCoal * 0.75);
      // Pure stain: thin edges absorb into fabric/skin; thicker collars & rivulets pool dark glossy crimson,
      // with actively pumping arterial blood reading slightly brighter and wetter until bleeding stops.
      vec3 absorbed = sAlb * vec3(0.45, 0.10, 0.10) + vec3(0.085, 0.004, 0.005);
      vec3 pooled = mix(vec3(0.20, 0.007, 0.008), vec3(0.105, 0.003, 0.004), thick);
      vec3 arterial = vec3(0.32, 0.012, 0.013);
      vec3 stainCol = mix(absorbed, mix(pooled, arterial, bFresh * 0.68), thick) * sDried;
      sAlb = mix(sAlb, stainCol, damp * mix(0.80, 0.97, thick));
      float wetRough = mix(0.32, mix(0.13, 0.08, bFresh), thick);
      sRough = mix(sRough, mix(wetRough, 0.62, sDry), damp);
      sMetal *= 1.0 - damp * 0.88;
      sH *= 1.0 - thick * 0.82;
      sBare = max(sBare, damp * mix(0.34, 0.78, thick) * (1.0 - sDry * 0.65) * (1.0 - sCoal));
    }
  }
  #endif

  #ifdef OP2_WOUNDS
  if (vWoundNear > 0.0) {
    int wounds = int(info.x);
    // When the dynamic UV blood walker is active, keep the wound shader's own stain tight to the puncture rim
    // instead of smearing a coarse vertical stripe over the gravity-accurate rivulets.
    float runBlood = hasBloodMap ? 0.0 : blood;
    float stainScale = hasBloodMap ? 0.55 : 1.0;
    // Metres outside the nearest cut, and how much of each kind of damage this pixel is in.
    float edge = 1.0, rimWidth = 0.01, funnel = 0.0, bruise = 0.0, stain = 0.0, scorch = 0.0, pit = 0.0, torn = 0.0;
    // Skin tears along a few long lines, not at every grain of it. Big wounds wander on a big noise, and only the finest
    // grain reaches the very edge, in millimetres, or the edge breaks up into islands. One tap, skewed so that no face of
    // the body lies flat to it, because this is only ever the wobble in an edge.
    float tearBig = (texture2D(tDetail, vBind.xy * 0.31 + vBind.z * 0.23 + 0.11).a - 0.5) * 2.6;
    float tear = (macro.a - 0.5) * 2.0;
    float tearFine = (micro.r - 0.5) * 0.0075;
    for (int i = 0; i < OP2_MAX_WOUNDS; i++) {
      if (i >= wounds) break;
      int base = OP2_WOUND_BASE + i * OP2_WOUND_TEXELS;
      vec4 t0 = op2Extra(base);
      float run = op2RunWet(vBind - t0.xyz, runBlood);
      if (run > t0.w) continue;
      vec4 t2 = op2Extra(base + 2);
      float coded = t2.w;
      int code = int(coded);
      if (((code >> 3) & vRegion) == 0) continue;
      float ragged = fract(coded);
      int kind = code & 7;
      vec4 t1 = op2Extra(base + 1);
      float depth = length(t2.xyz);
      vec3 axis = t2.xyz / max(depth, 1e-4);
      float along, radius;
      vec3 off;
      float dist = op2Slot(vBind, t0, t1, axis, along, off, radius);
      float past = op2SlotEnds(along, OP2_SKIN_ABOVE, op2SkinBelow(t1.w));
      if (past > t0.w) continue;
      // Fire seals what it burns.
      if (kind != OP2_DENT && kind != OP2_BURN) {
        // Below the wound it runs in rivulets on fallback bodies without a dynamic UV blood map.
        float below = smoothstep(0.0, 0.05, -off.y) * runBlood;
        float rivulet = texture2D(tDetail, vec2(vBind.x * 4.1 + vBind.z * 3.3, vBind.y * 0.11 + t0.x)).a - 0.5;
        float stainReach = (t1.w * OP2_STAIN_RADII + OP2_STAIN_MARGIN) * stainScale;
        stain = max(stain, smoothstep(1.0, 0.25, (op2RunWet(off, runBlood) + past * 2.0) / stainReach + (tear + tearBig) * 0.2 * (1.0 - below) - rivulet * 1.6 * below));
      }
      if (kind == OP2_BURN) {
        scorch = max(scorch, smoothstep(1.15, 0.55, (dist + past * 2.0) / t1.w + tear * 0.35));
      } else if (kind == OP2_GRAZE) {
        bruise = max(bruise, smoothstep(1.2, 0.3, (dist + past * 2.0) / t1.w + tear * 0.4));
      } else if (kind == OP2_DENT) {
        float m = dist + past * 2.0 - radius * (1.0 + tear * 0.3);
        pit = max(pit, smoothstep(0.003, -0.002, m));
        torn = max(torn, smoothstep(radius * 0.5, 0.0, abs(m)));
      } else {
        float wander = mix(tear, tearBig, smoothstep(0.02, 0.06, t1.w));
        float m = dist + past * 2.0 - radius * (1.0 + wander * mix(0.1, 0.55, ragged)) + tearFine * mix(0.3, 1.0, ragged);
        if (kind == OP2_CRATER) m -= radius * op2Lobes(off, axis, t0.xyz) * smoothstep(0.035, 0.055, radius);
        if (m < edge) {
          edge = m;
          rimWidth = kind == OP2_GASH ? 0.007 : clamp(radius * 0.45, 0.006, 0.03);
          funnel = min(radius * 0.6, 0.022);
        }
      }
    }
    // Flesh lies a few centimetres behind gear and a hole is narrow, so from most angles a small hole would look past it
    // to the dark. The last of the skin inside the tear is drawn as the wall of the wound instead, falling away into it.
    #ifdef OP2_WOUND_DISCARD
    if (edge < -funnel) discard;
    #endif

    if (scorch > 0.0) {
      // Only flesh and cloth split. Plate just blackens.
      float split = op2Crack(macro, micro) * scorch * (1.0 - sMetal);
      sAlb = mix(sAlb, vec3(0.012, 0.009, 0.008), scorch);
      sRough = mix(sRough, 0.9, scorch);
      sMetal *= 1.0 - scorch;
      sAlb = mix(sAlb, vec3(0.13, 0.01, 0.006), split);
      sRough = mix(sRough, 0.34, split);
    }
    float bare = 1.0 - sMetal;
    if (stain > 0.0) {
      // Dark where it is thick. Bright paint is what made the old wounds look drawn on.
      float wet = stain * (0.8 + grain * 0.2) * (hasBloodMap ? 0.65 : 1.0);
      sAlb = mix(sAlb, mix(vec3(0.17, 0.006, 0.007), vec3(0.075, 0.002, 0.003), stain * stain) * sDried, wet * 0.94);
      sRough = mix(sRough, mix(0.2, 0.62, sDry), wet);
      sMetal *= 1.0 - wet;
      // Blood fills the weave. A glossy surface over fine bumps just sparkles.
      sH *= 1.0 - wet * 0.85;
    }
    if (bruise > 0.0) {
      sAlb = mix(sAlb, vec3(0.05, 0.012, 0.03), bruise * 0.8 * bare);
      sRough = mix(sRough, 0.3, bruise);
    }
    float ring = 1.0 - smoothstep(0.0, rimWidth * 3.0, edge);
    float rim = 1.0 - smoothstep(0.0, rimWidth, edge);
    if (edge < 0.0) {
      float inner = -edge / funnel;
      float streak = macro.a * 0.5 + micro.a * 0.5;
      sAlb = mix(mix(vec3(0.3, 0.04, 0.035), vec3(0.12, 0.009, 0.012), smoothstep(0.38, 0.62, streak)), vec3(0.02, 0.0015, 0.002), pow(inner, 1.4));
      sRough = 0.34;
      sMetal = 0.0;
      sWoundH -= rimWidth * 0.5 + inner * funnel * 0.45;
      sBare = max(sBare, (1.0 - inner * 0.6) * 0.65 * (1.0 - sDry * 0.55) * (1.0 - sCoal));
    } else if (ring > 0.0) {
      // Bruised, then torn.
      sAlb = mix(sAlb, vec3(0.035, 0.004, 0.008), ring * 0.8);
      vec3 raw = mix(vec3(0.19, 0.02, 0.016), vec3(0.042, 0.003, 0.003), smoothstep(0.35, 1.0, rim + (micro.g - 0.5) * 0.5));
      sAlb = mix(sAlb, raw, rim);
      sRough = mix(sRough, 0.26, ring);
      sMetal *= 1.0 - rim;
      sWoundH -= rim * rim * rimWidth * 0.7;
      sBare = max(sBare, rim * 0.45 * (1.0 - sDry * 0.55) * (1.0 - sCoal));
    }
    if (pit > 0.0 || torn > 0.0) {
      sAlb = mix(sAlb, vec3(0.3, 0.3, 0.32), torn);
      sMetal = mix(sMetal, 1.0, torn);
      sRough = mix(sRough, 0.3, torn);
      sAlb = mix(sAlb, vec3(0.006), pit);
      sMetal *= 1.0 - pit;
      sRough = mix(sRough, 0.8, pit);
      sWoundH -= pit * 0.012;
    }
  }
  #endif

  if (frost > 0.001) {
    float f = smoothstep(1.0 - frost * 1.1, 1.05 - frost * 0.9, grain + 0.25);
    sAlb = mix(sAlb, vec3(0.62, 0.8, 0.95), f * 0.85);
    sRough = mix(sRough, 0.14, f);
    sMetal *= 1.0 - f;
    sGlow += vec3(0.1, 0.3, 0.55) * f * 0.25;
  }

  // A dull red pulse: a bright full-body flash read as cartoonish. Hit markers carry the confirmation.
  sGlow += vec3(0.5, 0.05, 0.03) * flash * 0.45;
}
#endif
#ifdef OP2_CHARRED
{
  // Kit on a burnt body (a helmet, a rifle, a pack): burnt black with it, cold.
  float grain = macro.r * 0.6 + macro.a * 0.4;
  float n = grain * 0.7 + micro.b * 0.3;
  float burn = 1.0, heat = 0.0;
  ${BURN_SURFACE}
}
#endif
#if defined(USE_COLOR) && !defined(OP2_SKINNED) && !defined(OP2_CHARRED)
{
  // A rigid piece of a burnt body (a slab, a part of a limb, a blade's half, a piece of a burst trunk): it is drawn as
  // an instance, and its instance colour says how burnt it is (gore/fire.ts, burnTint: white is not at all). It burns
  // as the body did, through the same noise, cold: a piece has no texels to keep an ember in.
  float burn = clamp((1.0 - vColor.r) / 0.94, 0.0, 1.0);
  if (burn > 0.02) {
    float grain = macro.r * 0.6 + macro.a * 0.4;
    float n = grain * 0.7 + micro.b * 0.3;
    float heat = 0.0;
    ${BURN_SURFACE}
  }
}
#endif
#ifdef OP2_WOUNDS
sN = normalize(sN + vWoundTilt);
#endif
diffuseColor.rgb = sAlb;
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec3 op2Obj = mat3(vSk0, vSk1, vSk2) * sN;
  normal = normalize(normalMatrix * op2Obj);
  #ifndef OP2_FAR
  normal = op2Bump(-vViewPosition, normal, sH * sBumpScale + sWoundH, faceDirection);
  #endif
}
`;

// The rim is a readability cheat: the world is dark on purpose, and a body has to separate from it at 40 m.
const FRAG_EMISSIVE = /* glsl */ `
{
  float op2Rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
  totalEmissiveRadiance += sAlb * sEmis * uEmissive + sGlow + vec3(0.32, 0.48, 0.72) * (op2Rim * uRim * vColorAO.a);
}
`;

const FRAG_AO = /* glsl */ `
{
  float op2Ao = vColorAO.a;
  op2Ao = mix(1.0, op2Ao, 0.85);
  reflectedLight.indirectDiffuse *= op2Ao;
  reflectedLight.indirectSpecular *= op2Ao;
  // A floor under the baked light. Enemies must stay legible where the map itself goes black.
  reflectedLight.indirectDiffuse += material.diffuseColor * vec3(0.5, 0.62, 0.8) * (uFill * RECIPROCAL_PI * op2Ao);
  // Bare flesh keeps its red under this map's blue light, which would turn it black: it is lit again by the brightness of
  // what reaches it, whatever colour that is, as blood on the floor is (render/Decals.ts, opTint). By the light, and not
  // by a fixed amount: with a fixed fill a torn limb in a dark corner was the brightest thing on the screen at 20 m, a
  // glowing orange where the blood on the floor under it was nearly black (the fit pass's night check). The light is read
  // back out of what the surface reflected, its own colour divided out, floor and all, and levels off under a hard lamp.
  // Burnt things are dark whatever is shone on them. Char's albedo is a hundredth, but a weapon light at two metres is
  // bright enough to turn even that pale: a burnt-through corpse under it read as tan skin with wet red patches, raw and
  // not burnt (the fit pass's night check). So what a burnt pixel gives back levels off at \`sMost\`: char near black,
  // cooked meat a dark red-brown, bone a sooty grey. A glow of its own (embers) is not light given back, and is not held.
  if (sCoal > 0.0) {
    vec3 op2All = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular;
    float op2Bright = dot(op2All, vec3(0.2126, 0.7152, 0.0722));
    float op2Keep = mix(1.0, sMost * (1.0 - exp(-op2Bright / sMost)) / max(op2Bright, 1e-5), sCoal);
    reflectedLight.directDiffuse *= op2Keep;
    reflectedLight.indirectDiffuse *= op2Keep;
    reflectedLight.directSpecular *= op2Keep;
    reflectedLight.indirectSpecular *= op2Keep;
  }
  if (sBare > 0.0) {
    vec3 op2Lit = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(material.diffuseColor, vec3(0.004));
    float op2Lum = min(dot(op2Lit, vec3(0.2126, 0.7152, 0.0722)), OP2_BARE_MOST);
    reflectedLight.indirectDiffuse += material.diffuseColor * vec3(1.0, 0.8, 0.78) * (op2Lum * sBare * OP2_BARE_GAIN);
  }
}
`;

/** Tileable noise, one kind per channel: skin pores, cloth weave, metal scratches, rubber pebbling. */
export function createDetailTexture(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const rnd = mulberry32(0x0f2ce);
  const lattice = (size: number) => {
    const g = new Float32Array(size * size);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return (x: number, y: number) => {
      const fx = x * size, fy = y * size;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
      const a = g[(ix % size) + (iy % size) * size]!, b = g[((ix + 1) % size) + (iy % size) * size]!;
      const c = g[(ix % size) + ((iy + 1) % size) * size]!, d = g[((ix + 1) % size) + ((iy + 1) % size) * size]!;
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  };
  const l8 = lattice(8), l16 = lattice(16), l32 = lattice(32), l64 = lattice(64), l128 = lattice(128);
  const scratches = new Float32Array(N * N);
  for (let i = 0; i < 900; i++) {
    let x = rnd() * N, y = rnd() * N;
    const a = rnd() * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const len = 8 + rnd() * 70;
    const depth = 0.25 + rnd() * 0.75;
    for (let s = 0; s < len; s++) {
      const px = ((x | 0) + N) % N, py = ((y | 0) + N) % N;
      scratches[px + py * N] = Math.max(scratches[px + py * N]!, depth);
      x += dx; y += dy;
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      const o = (i + j * N) * 4;
      const pores = l32(u, v) * 0.4 + l64(u, v) * 0.34 + l128(u, v) * 0.26;
      const wrinkle = Math.abs(l16(u, v) - 0.5) * 2;
      data[o] = 255 * clampB(pores * 1.1 - (1 - wrinkle) * 0.16 + 0.05);
      const weave = (Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5) * (Math.sin(v * Math.PI * 2 * 64) * 0.5 + 0.5);
      const warp = (Math.sin((u + v) * Math.PI * 2 * 32) * 0.5 + 0.5);
      data[o + 1] = 255 * clampB(weave * 0.6 + warp * 0.1 + l32(u, v) * 0.3);
      data[o + 2] = 255 * clampB(0.56 - scratches[i + j * N]! * 0.5 + (l64(u, v) - 0.5) * 0.2 + (l8(u, v) - 0.5) * 0.12);
      data[o + 3] = 255 * clampB(l64(u, v) * 0.7 + l16(u, v) * 0.3);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const clampB = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface SurfaceOptions {
  detail: THREE.Texture;
  atlasA: THREE.Texture | null;
  atlasB: THREE.Texture | null;
  /** Shared pooled UV blood-stain array texture (flesh humanoids). */
  bloodMap?: THREE.DataArrayTexture | null;
  /** First texel after the bone matrices. */
  extraBase: number;
  emissive?: number;
  /** Distant variant: vertex colours only, no micro detail. */
  far?: boolean;
  /** For bodies with wounds: cut-outs, craters and torn edges. Skinned meshes only. */
  wounds?: boolean;
  /** Enables fragment `discard` for open cutout wounds; omitted for graze/wear-only bodies to preserve Early-Z/HSR. */
  woundDiscard?: boolean;
  /** Burnt black all over: the kit on a burnt body (`charredVariant`). Not for skinned meshes, which burn by instance. */
  charred?: boolean;
}

/** What each character material was made from, so its burnt twin can be made on the day it is first needed. */
const made = new WeakMap<THREE.Material, { ctx: Ctx; o: SurfaceOptions }>();
const burnt = new WeakMap<THREE.Material, THREE.Material>();
/** The other way: the material each burnt twin was made from. */
const unburnt = new WeakMap<THREE.Material, THREE.Material>();

/**
 * The same material burnt black, for the kit a burnt body carries: its helmet, gun and pack are meshes of their own and
 * do not read the body's burn. One per material, made on first use. Anything not made here is returned as it is.
 */
export function charredVariant(material: THREE.Material): THREE.Material {
  let twin = burnt.get(material);
  if (!twin) {
    const from = made.get(material);
    twin = from && !from.o.charred ? createCharacterMaterial(from.ctx, { ...from.o, charred: true }) : material;
    burnt.set(material, twin);
    if (twin !== material) unburnt.set(twin, material);
  }
  return twin;
}

/**
 * The material a burnt twin was made from, or the material itself if it is not one. The twin knows where it came from, so
 * nothing has to be kept on the mesh that wears it: a mesh's `userData` goes through JSON when three clones it, and a
 * material kept there came out as a plain object that could not be drawn (a baked burnt Gunner's minigun, 2026-11-19).
 */
export function unburntVariant(material: THREE.Material): THREE.Material {
  return unburnt.get(material) ?? material;
}

export function createCharacterMaterial(ctx: Ctx, o: SurfaceOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1 });
  const atlas = o.atlasA !== null && !o.far;
  const bloodMap = atlas && !!o.bloodMap && !o.charred;
  if (atlas) material.defines = { ...material.defines, OP2_ATLAS: 1 };
  if (bloodMap) material.defines = { ...material.defines, OP2_BLOOD_MAP: 1 };
  if (o.far) material.defines = { ...material.defines, OP2_FAR: 1 };
  if (o.wounds) material.defines = { ...material.defines, OP2_WOUNDS: 1 };
  if (o.woundDiscard) material.defines = { ...material.defines, OP2_WOUND_DISCARD: 1 };
  if (o.charred) material.defines = { ...material.defines, OP2_CHARRED: 1 };
  material.onBeforeCompile = shader => {
    shader.uniforms.tDetail = { value: o.detail };
    shader.uniforms.uExtraBase = { value: o.extraBase };
    shader.uniforms.uEmissive = { value: o.emissive ?? 7 };
    shader.uniforms.uRim = { value: 0.3 };
    shader.uniforms.uFill = { value: 0.75 };
    if (atlas) {
      shader.uniforms.tAtlasA = { value: o.atlasA };
      shader.uniforms.tAtlasB = { value: o.atlasB };
    }
    if (bloodMap) {
      shader.uniforms.tBloodMap = { value: o.bloodMap };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${VERT_WOUND_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    // three only defines USE_SKINNING for the vertex stage.
    const skinned = (shader as unknown as { skinning: boolean }).skinning;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${skinned ? '#define OP2_SKINNED\n' : ''}${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sMetal;')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
      .replace('#include <aomap_fragment>', FRAG_AO);
  };
  // The bone count is a uniform, so every archetype shares these few programs.
  material.customProgramCacheKey = () => `op2char:${atlas ? 1 : 0}:${o.far ? 1 : 0}:${o.wounds ? 1 : 0}:${o.woundDiscard ? 1 : 0}:${o.charred ? 1 : 0}:${bloodMap ? 1 : 0}`;
  // A stub render system returns undefined here, and the sandbox then lights the material itself.
  const patched = ctx.render.materials?.patch?.(material) ?? material;
  made.set(patched, { ctx, o });
  return patched;
}
