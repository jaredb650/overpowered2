import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/contracts';
import { COMMON_VERT } from '../gpu/glsl';
import { InstanceRing } from '../gpu/ring';
import { BLOOD } from '../palette';
import { ORDER, type FxUniforms } from './shared';

/**
 * Blood in the air. The first game's opaque chips are right for explosions and wrong for liquid, so this
 * is the one particle class that is lit: a patched standard material, the same light volume, moon shadow,
 * dynamic lights and fog as the wall behind it. Blood goes black in a dark tunnel and catches a muzzle
 * flash, and it cannot glow.
 *
 * One record is a whole strand, not a droplet. The vertex shader walks the strand down its own path,
 * head at `age` and tail `trail` seconds behind it, so a single instance is a curved arc that bends under
 * gravity. The fragment shader rounds the head, tapers the tail and pinches it into beads, the way a real
 * stream breaks up. That is why a jet needs thirteen of these where it used to need thirty-five chips and puffs.
 *
 * Motion is linear drag, so fine strands stall and drop while heavy drops carry. `stop` is the landing
 * time worked out at emission: the head sticks there and the rest of the strand runs into it.
 *
 *   aP  origin xyz, birth          aV  velocity xyz, life
 *   aC  tone 0 venous 1 arterial, half width, trail seconds (negative: an impact puff), opacity (negative is mist or a puff)
 *   aF  gravity, drag, stop time, seed
 *
 * The impact puff (`puff`) is the third kind of record: the cloud a round knocks out of flesh, facing the camera. It is
 * there whole on its first frame and leaves by being eaten from its outline inward, never by fading (DESIGN.md, pillar 2).
 */
const ATTRS = ['aP', 'aV', 'aC', 'aF'] as const;

const SEGMENTS = 7;
/** An impact puff grows with distance from the eye past this many metres, by this much a metre, to this much more at most. */
const PUFF_FAR_FROM = 5;
const PUFF_FAR_GAIN = 0.06;
const PUFF_FAR_MOST = 1.3;
/** Never smaller than this many pixels, half across. */
const PUFF_MIN_PX = 9;
/** Room around the strand for the antialiased edge. */
const PAD = 1.4;

const VERT_PARS = /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aF;
uniform float uMinPx;
varying vec4 vStrand;
varying vec4 vLook;
varying vec3 vSide;
${COMMON_VERT}
`;

const VERT_NORMAL = /* glsl */ `
float bAge = uTime - aP.w;
bool bDead = bAge < 0.0 || bAge >= aV.w;
bool bMist = aC.w < 0.0;
bool bSplash = bMist && aC.z <= -1.5;
bool bPuff = bMist && aC.z < -0.5 && aC.z > -1.5;
bool bCloud = bPuff || bSplash;
vec3 bGravity = vec3(0.0, aF.x, 0.0);
float bU = position.y;
float bTime = bMist ? min(bAge, aF.z) : clamp(bAge - bU * aC.z, 0.0, aF.z);
vec3 bVel;
vec3 bPos = dragged(aP.xyz, aV.xyz, bGravity, aF.y, bTime, bVel);

float bSpeed = length(bVel);
vec3 bAlong = bSpeed > 0.01 ? bVel / bSpeed : vec3(0.0, -1.0, 0.0);
vec3 bToEye = normalize(cameraPosition - bPos);
vec3 bSide = cross(bAlong, bToEye);
float bSideLen = length(bSide);
bSide = bSideLen > 0.001 ? bSide / bSideLen : normalize(cross(vec3(0.0, 1.0, 0.0), bToEye));

float bDepth = max(-(viewMatrix * vec4(bPos, 1.0)).z, 0.05);
float bFloor = uPixelWorld * bDepth * uMinPx;
float bHalf = aC.y;
float bK = clamp(bAge / max(aV.w, 0.001), 0.0, 1.0);
float bOpacity = abs(aC.w);
// Small bullet hits get a distance boost so they read at range; already-huge gib clouds keep true world scale.
float bFarScale = 1.0 + clamp((bDepth - ${PUFF_FAR_FROM.toFixed(1)}) * ${PUFF_FAR_GAIN.toFixed(3)}, 0.0, ${PUFF_FAR_MOST.toFixed(2)}) * clamp(0.55 / max(aC.y, 0.2), 0.18, 1.0);
if (bSplash) {
  // Fast violent snap-open on frame 1 (0.48 -> 1.18), then coasting outward as tendrils tear into droplets.
  float bS = 1.0 - min(bK * 3.8, 1.0);
  float bSnap = 1.0 - bS * bS * bS;
  bHalf *= (0.48 + 0.72 * bSnap + 0.28 * bK) * bFarScale;
  bOpacity *= clamp((bDepth - 0.30) / 0.55, 0.0, 1.0);
} else if (bPuff) {
  // Billowing crimson aerosol: blooms rapidly then swells broadly as it curls and dissolves into wispy mist.
  float bS = 1.0 - min(bK * 5.0, 1.0);
  float bSnap = 1.0 - bS * bS * bS;
  bHalf *= (0.52 + 0.54 * bSnap + 0.88 * bK) * bFarScale;
  bOpacity *= clamp((bDepth - 0.35) / 0.75, 0.0, 1.0);
} else if (bMist) {
  // Velocity-stretched directional splatter plume & aerosol wake.
  bHalf *= (0.85 + 1.35 * bK) * bFarScale;
  bOpacity *= (1.0 - bK * 0.82) * clamp((bDepth - 0.45) / 0.85, 0.0, 1.0);
}
// Thinner than the pixel floor it gets paler, not fatter: a far spurt stays fine instead of turning to confetti.
float bWidth = max(bHalf, bCloud ? uPixelWorld * bDepth * ${PUFF_MIN_PX.toFixed(1)} : bFloor);
if (!bCloud) bOpacity *= sqrt(bHalf / bWidth);

vec3 objectNormal = bToEye;
`;

const VERT_POSITION = /* glsl */ `
vec3 transformed = bPos + bSide * (position.x * bWidth * ${PAD.toFixed(2)});
float bShear = 0.0;
if (bSplash) {
  // Orient liquid splash crown along its screen-projected flight vector when moving fast so tendrils whip forward.
  vec3 pFlat = aV.xyz - bToEye * dot(aV.xyz, bToEye);
  float pFlatLen = length(pFlat);
  vec3 pRight;
  if (pFlatLen > 0.25) {
    pRight = pFlat / pFlatLen;
    bShear = clamp((pFlatLen - 0.25) * 0.14, 0.0, 0.85);
  } else {
    pRight = cross(vec3(0.0, 1.0, 0.0), bToEye);
    float pLen = length(pRight);
    pRight = pLen > 0.001 ? pRight / pLen : vec3(1.0, 0.0, 0.0);
  }
  vec3 pUp = cross(bToEye, pRight);
  float stretch = 1.0 + bShear * 0.42;
  transformed = bPos + (pRight * (position.x * stretch) + pUp * (bU * 2.0 - 1.0)) * bWidth;
} else if (bPuff) {
  // Camera-facing billowing mist plane, gently stretched along its drift so plumes look wind-sheared, never round.
  vec3 pFlat = aV.xyz - bToEye * dot(aV.xyz, bToEye);
  float pFlatLen = length(pFlat);
  vec3 pRight = cross(vec3(0.0, 1.0, 0.0), bToEye);
  float pLen = length(pRight);
  pRight = pLen > 0.001 ? pRight / pLen : vec3(1.0, 0.0, 0.0);
  if (pFlatLen > 0.35) {
    pRight = pFlat / pFlatLen;
    bShear = clamp((pFlatLen - 0.35) * 0.10, 0.0, 0.55);
  }
  vec3 pUp = cross(bToEye, pRight);
  transformed = bPos + (pRight * (position.x * (1.0 + bShear * 0.38)) + pUp * (bU * 2.0 - 1.0)) * bWidth;
} else if (bMist) {
  transformed += bAlong * (bU * 2.0 - 1.0) * bWidth * (1.15 + min(bSpeed * 0.20, 2.2));
}
vStrand = vec4(bCloud ? position.x : position.x * ${PAD.toFixed(2)}, bU, bSplash ? -3.0 : bPuff ? -2.0 : bMist ? -1.0 : aC.z * length(aV.xyz) / max(aC.y * 7.0, 0.01), aF.w);
vLook = vec4(aC.x, bOpacity, bK, bShear);
vSide = mat3(viewMatrix) * bSide;
`;

const VERT_PROJECT = /* glsl */ `
#include <project_vertex>
if (bDead || bOpacity < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vStrand;
varying vec4 vLook;
varying vec3 vSide;

uniform vec3 uVenous;
uniform vec3 uArterial;
uniform float uLift;
uniform float uPuffRim;
uniform float uPuffEdge;
uniform float uPuffCore;
uniform float uPuffFloor;

float bloodSpeck(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
/** Smooth value noise, 0..1. */
float bloodCloud(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = bloodSpeck(i);
  float b = bloodSpeck(i + vec2(1.0, 0.0));
  float c = bloodSpeck(i + vec2(0.0, 1.0));
  float d = bloodSpeck(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
/** 3-octave rotated fBM, 0..1: organic fluid turbulence with zero grid alignment. */
float bloodFbm(vec2 p) {
  float v = 0.0;
  mat2 m = mat2(0.80, -0.60, 0.60, 0.80);
  v += 0.54 * bloodCloud(p); p = m * p * 2.07 + vec2(13.1, 7.7);
  v += 0.27 * bloodCloud(p); p = m * p * 2.03 + vec2(5.3, 19.4);
  v += 0.135 * bloodCloud(p);
  return v / 0.945;
}
`;

const FRAG_COVER = /* glsl */ `
float bAcross = vStrand.x;
float bU = vStrand.y;
float bSeed = vStrand.w;
float bHalf = 1.0;
float bAlpha;
float bCore = 0.0;
float bLiquid = 0.0;
if (vStrand.z < -2.5) {
  // Sharp liquid blood splash web & tendrils: gnarled branching fluid filaments tearing outward on frame 1,
  // then pinching via surface tension into crisp scattered droplets and flecks. Strictly pow-free (no NaN).
  vec2 q = vec2(bAcross, bU * 2.0 - 1.0);
  float k = clamp(vLook.z, 0.0, 1.0);
  float rem = 1.0 - k;
  float shear = vLook.w;
  // Bias origin slightly behind center when directional so tendrils whip forward along +x.
  vec2 qc = vec2(q.x + shear * 0.22, q.y);
  // Subtle spin when radial; keep aligned along +x when strongly directional.
  float rot = mix(bSeed * 6.2831, (bSeed - 0.5) * 0.75, clamp(shear * 1.4, 0.0, 1.0)) + k * (bSeed > 0.5 ? 0.14 : -0.14);
  float cs = cos(rot), sn = sin(rot);
  vec2 qr = vec2(qc.x * cs - qc.y * sn, qc.x * sn + qc.y * cs);
  float r = length(qr);
  float rEll = length(vec2(qc.x * (1.0 - shear * 0.22), qc.y * (1.0 + shear * 0.18)));
  vec2 sOff = vec2(bSeed * 37.3, bSeed * 71.9);
  // Outward radial tear + fluid domain warp so filaments bend and fork organically.
  vec2 qOut = qr * (1.10 - 0.28 * k);
  vec2 warp = vec2(
    bloodCloud(qOut * 2.7 + sOff),
    bloodCloud(qOut * 2.7 + sOff + vec2(19.3, 41.7))
  ) - 0.5;
  vec2 qw = qOut + warp * (0.44 + 0.22 * k);
  // Ridged branching veins (major + fine forks) -> razor-crisp liquid strands with open gaps between them.
  float n1 = bloodFbm(qw * 3.1 + sOff * 0.5);
  float rg1 = 1.0 - abs(2.0 * n1 - 1.0);
  float r2 = rg1 * rg1;
  float veins = r2 * r2;
  float n2 = bloodCloud(qw * 6.8 + sOff + vec2(8.1, 3.7));
  float rg2 = 1.0 - abs(2.0 * n2 - 1.0);
  float f2 = rg2 * rg2;
  float fineVeins = f2 * f2;
  // Asymmetric radial spokes whipping out to irregular torn tips (never a circular boundary).
  float th = atan(qr.y, qr.x + 1e-5);
  float spoke = bloodCloud(vec2(th * 3.2 + bSeed * 17.0, r * 1.3 - k * 0.8 + bSeed * 9.0));
  float reach = 0.52 + 0.44 * spoke;
  // Torn liquid heart on early frames that hollows out as it tears into whipping tendrils.
  float coreMask = (1.0 - smoothstep(0.06, 0.36 + 0.16 * spoke, rEll)) * (1.0 - smoothstep(0.10, 0.58, k));
  float crownEnv = 1.0 - smoothstep(0.16, reach, rEll);
  float filaments = max(veins * 1.12, fineVeins * 0.84) * crownEnv * (0.42 + 0.78 * spoke);
  // Surface-tension pinch: thin bridges snap first, breaking continuous webs into irregular dark droplets!
  float pinch = bloodCloud(qw * 9.8 + sOff * 1.3);
  float breakup = mix(1.0, smoothstep(0.24, 0.68, pinch), smoothstep(0.12, 0.68, k));
  float webField = max(coreMask * (0.48 + 0.62 * n1), filaments) * breakup;
  // Detached crisp droplets flung outward from the tearing tendrils.
  vec2 qDrop = qw * 11.5 + sOff * 2.1 - qr * (k * 2.4);
  float d1 = bloodCloud(qDrop);
  float d2 = bloodCloud(qDrop * 1.9 + vec2(11.3, 27.9));
  float dropField = (d1 * 0.62 + d2 * 0.38) * (1.0 - smoothstep(0.22, 0.96, rEll));
  float dropAlpha = smoothstep(0.56 + 0.22 * k, 0.63 + 0.21 * k, dropField) * smoothstep(0.0, 0.45, rem);
  float webThresh = 0.23 + 0.34 * k;
  float webAlpha = smoothstep(webThresh, webThresh + 0.055, webField);
  bAlpha = clamp(max(webAlpha, dropAlpha), 0.0, 1.0) * smoothstep(0.0, 0.28, rem);
  bLiquid = max(webField, dropField * dropAlpha);
  bCore = clamp(bLiquid * 1.35, 0.0, 1.0);
} else if (vStrand.z < -1.5) {
  // Billowing volumetric blood aerosol mist: 2-stage domain-warped fBM curling into asymmetric smoky dark-crimson
  // plumes with hollow pockets and feathery translucent wisps. Strictly pow-free (no NaN).
  vec2 q = vec2(bAcross, bU * 2.0 - 1.0);
  float k = clamp(vLook.z, 0.0, 1.0);
  float rem = 1.0 - k;
  float shear = vLook.w;
  float rot = bSeed * 6.2831 + k * (bSeed > 0.5 ? 0.48 : -0.48);
  float cs = cos(rot), sn = sin(rot);
  vec2 qr = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
  vec2 sOff = vec2(bSeed * 43.7, bSeed * 89.3);
  // 2-stage fluid domain warp creates genuine billowing folds & curling wispy arms.
  vec2 adv = vec2(k * 0.34, -k * 0.22);
  vec2 w1 = vec2(
    bloodFbm(qr * 1.85 + sOff - adv),
    bloodFbm(qr * 1.85 + sOff + vec2(17.4, 31.2) + adv * 0.8)
  ) - 0.5;
  vec2 qw = qr + w1 * (0.62 + 0.44 * k);
  float fbmMain = bloodFbm(qw * 2.25 + sOff * 0.6 - adv * 0.6);
  float fbmFine = bloodCloud(qw * 5.6 + sOff * 1.4 + w1 * 1.5);
  float billow = fbmMain * 0.68 + fbmFine * 0.32;
  // Asymmetric domain-warped silhouette with deep ragged bays (never a round cotton ball).
  vec2 qEnv = vec2(q.x * (1.0 - shear * 0.16), q.y) + w1 * 0.52;
  float rWarp = length(qEnv);
  float env = 1.0 - smoothstep(0.06, 0.96, rWarp);
  // Carve internal wispy pockets early and erode cleanly into feathery drifting vapor ribbons over life.
  float density = env * (0.28 + 1.18 * billow) - (0.14 + 0.42 * k);
  float mist = smoothstep(0.0, 0.48 + 0.18 * k, density);
  float softAlpha = mist * (0.42 + 0.58 * mist);
  float fade = smoothstep(0.0, 0.65, rem);
  bAlpha = clamp(softAlpha * fade, 0.0, 1.0);
  // Volumetric fold shading: deep dark crimson interior folds, softer lit wispy outer folds + subtle top light cue.
  float topCue = clamp(q.y * 0.35 + 0.55, 0.25, 1.0);
  bCore = clamp(density * 1.55 * (1.22 - 0.32 * topCue), 0.0, 1.0);
} else if (vStrand.z < 0.0) {
  // Velocity-stretched directional splatter & aerosol spray cone: mist wake near base, elongated blood droplets ahead.
  vec2 q = vec2(bAcross / ${PAD.toFixed(2)}, bU * 2.0 - 1.0);
  float k = clamp(vLook.z, 0.0, 1.0);
  float rem = 1.0 - k;
  // Cone widens downstream along +bU (0 = wound tail, 1 = leading spray front).
  float coneHalf = 0.22 + 0.72 * smoothstep(0.0, 0.82, bU);
  float ax = abs(q.x) / coneHalf;
  float coneMask = (1.0 - smoothstep(0.35, 1.05, ax)) * smoothstep(0.0, 0.14, bU) * (1.0 - smoothstep(0.68, 1.0, bU));
  // Velocity-stretched splatter blotches & streaking droplets flying down +bU.
  vec2 sOff = vec2(bSeed * 41.3, bSeed * 91.7);
  vec2 pDrop = vec2(q.x * 7.2, (bU - k * 0.55) * 3.2) + sOff;
  float streak1 = bloodCloud(pDrop);
  float streak2 = bloodCloud(vec2(q.x * 13.5, (bU - k * 0.75) * 5.4) + sOff * 1.7);
  float drops = smoothstep(0.50 + 0.22 * k, 0.66 + 0.16 * k, streak1 * 0.6 + streak2 * 0.4) * coneMask;
  // Soft directional aerosol mist wake connecting the droplets near the wound side.
  float wakeNoise = bloodFbm(vec2(q.x * 3.0, bU * 2.4 - k * 0.4) + sOff * 0.5);
  float wakeEnv = (1.0 - smoothstep(0.25, 0.95, ax)) * smoothstep(0.0, 0.18, bU) * (1.0 - smoothstep(0.35, 0.88, bU));
  float wake = smoothstep(0.24 + 0.34 * k, 0.72, wakeEnv * (0.4 + 0.9 * wakeNoise)) * 0.58;
  bAlpha = clamp(max(drops * 0.92, wake), 0.0, 1.0) * smoothstep(0.0, 0.45, rem);
  bCore = clamp(drops * 0.85 + wake * 0.35, 0.0, 1.0);
} else {
  float beads = max(vStrand.z, 1.0);
  // The head is a round cap about as long as the strand is wide.
  float cap = sqrt(clamp(bU * beads * 1.6, 0.0, 1.0));
  float taper = pow(max(1.0 - bU, 0.0001), 0.8);
  // Surface tension breaks the tail into beads and leaves the head whole.
  float x = bU * beads + bSeed * 13.0;
  float wave = 0.5 + 0.5 * sin(x * 6.2831 + 2.4 * sin(x * 2.3 + bSeed * 6.0));
  float pinch = mix(1.0, smoothstep(0.2, 0.62, wave), smoothstep(0.12, 0.6, bU));
  bHalf = max(cap * taper * pinch, 0.001);
  float edge = max(fwidth(bAcross), 0.001);
  bAlpha = clamp((bHalf - abs(bAcross)) / edge + 0.5, 0.0, 1.0);
}
bAlpha *= vLook.y;
if (bAlpha < 0.008) discard;
vec3 bTint = mix(uVenous, uArterial, vLook.x);
// Deep dark liquid tendrils vs softly scattered crimson aerosol wisps — never neon glowing red.
if (vStrand.z < -2.5) bTint *= mix(1.38, 0.44, smoothstep(0.15, 0.85, bCore));
else if (vStrand.z < -1.5) bTint *= mix(uPuffEdge, uPuffCore, smoothstep(0.08, 0.82, bCore)) * mix(uPuffRim, 1.0, smoothstep(0.0, 0.25, bAlpha));
else if (vStrand.z < 0.0) bTint *= mix(1.45, 0.68, smoothstep(0.15, 0.85, bCore));
diffuseColor = vec4(vec3(1.0), bAlpha);
`;

/**
 * Red under this map's cyan light reflects nothing, so the correct answer is black, and black blood reads
 * as oil. It takes its brightness from the light and keeps its own hue. It still goes dark where the
 * scene is dark, and it adds no light of its own.
 */
const FRAG_LIGHT = /* glsl */ `
#include <lights_fragment_end>
{
  float bLight = dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
  // Hit feedback stays legible in dark corners while preserving deep crimson fold contrast in full sun.
  if (vStrand.z < -2.5) bLight = clamp(bLight, uPuffFloor * 0.85, 0.75);
  else if (vStrand.z < -1.5) bLight = clamp(bLight, uPuffFloor, 0.72);
  else if (vStrand.z < 0.0) bLight = clamp(bLight, uPuffFloor * 0.88, 0.74);
  reflectedLight.directDiffuse = vec3(0.0);
  reflectedLight.indirectDiffuse = bTint * bLight * uLift;
}
`;

/** A strand is a thin cylinder seen side on; wet liquid splash webs tilt their normal across thickness ridges. */
const FRAG_NORMAL = /* glsl */ `
if (vStrand.z >= 0.0) {
  float bRoll = clamp(bAcross / bHalf, -1.0, 1.0);
  normal = normalize(normalize(vSide) * bRoll + normal * sqrt(1.0 - bRoll * bRoll));
} else if (vStrand.z < -2.5) {
  vec2 bGrad = vec2(dFdx(bLiquid), dFdy(bLiquid));
  normal = normalize(normal + vec3(bGrad * 5.0, 0.0));
}
`;

/** Strands and clouds stay well under the bloom knee so blood always reads as deep saturated crimson, never neon. */
const FRAG_LIMIT = /* glsl */ `
gl_FragColor.rgb = min(gl_FragColor.rgb, vStrand.z < -2.5 ? vec3(0.38, 0.09, 0.10) : vStrand.z < 0.0 ? vec3(0.42, 0.13, 0.14) : vec3(0.5));
#include <tonemapping_fragment>
`;

/**
 * How billowing blood mist is shaded from wispy outer vapor (`edge`) to deep clotted interior folds (`core`),
 * with a subtle `rim` feather and `floor` minimum lighting share in dark corners.
 */
export const PUFF_LOOK = { rim: 0.86, edge: 1.58, core: 0.48, floor: 0.36 };

function strip(): THREE.BufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    position.push(-1, i / SEGMENTS, 0, 1, i / SEGMENTS, 0);
    if (i < SEGMENTS) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  return g;
}

/** Where a dragged path stands against a plane, at time t. Positive is in front of it. */
function height(h: number, hv: number, ha: number, k: number, t: number): number {
  const f = (1 - Math.exp(-k * t)) / k;
  return h + hv * f + (ha * (t - f)) / k;
}

const SCAN_STEP = 0.07;
/** Seconds. Anything still in the air by then is over a drop, and no stain is owed. */
const MAX_FLIGHT = 1.6;

/**
 * First time a dragged path crosses a plane, or `limit` if it never does. `h` is the start height above
 * the plane, `hv` and `ha` the velocity and acceleration along its normal. A coarse scan brackets the
 * crossing and a few bisections pin it down. There is no closed form once drag is in.
 */
export function crossing(h: number, hv: number, ha: number, k: number, limit: number): number {
  if (h <= 0) return limit;
  for (let t = SCAN_STEP; t < limit + SCAN_STEP; t += SCAN_STEP) {
    if (height(h, hv, ha, k, t) > 0) continue;
    let lo = t - SCAN_STEP;
    let hi = t;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) * 0.5;
      if (height(h, hv, ha, k, mid) > 0) lo = mid;
      else hi = mid;
    }
    return hi;
  }
  return limit;
}

/** Plane a burst can land on, in addition to its floor. */
export interface BloodWall {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
}

/** Everything `add` works out about where a strand ends. Reused, so emission makes no garbage. */
export interface Landing {
  /** Seconds in flight. */
  time: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Surface normal, or all zero when the strand ran out of life in the air. */
  nx: number; ny: number; nz: number;
}

export class BloodLayer {
  readonly ring: InstanceRing;
  readonly landing: Landing = { time: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, nx: 0, ny: 0, nz: 0 };

  private birth = 0;
  private gravity = -14;
  private floor = -1e6;
  private wall: BloodWall | null = null;
  private tone = 0;

  constructor(scene: THREE.Scene, uniforms: FxUniforms, materials: MaterialLibrary, cap = 2048) {
    this.ring = new InstanceRing(strip(), cap, ATTRS);
    const material = new THREE.MeshStandardMaterial({
      name: 'fx.blood', roughness: 0.16, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const own = {
      uMinPx: { value: 1.3 },
      uLift: { value: 3.2 },
      uPuffRim: { value: PUFF_LOOK.rim },
      uPuffEdge: { value: PUFF_LOOK.edge },
      uPuffCore: { value: PUFF_LOOK.core },
      uPuffFloor: { value: PUFF_LOOK.floor },
      uVenous: { value: new THREE.Vector3(BLOOD.venous.r, BLOOD.venous.g, BLOOD.venous.b) },
      uArterial: { value: new THREE.Vector3(BLOOD.arterial.r, BLOOD.arterial.g, BLOOD.arterial.b) },
    };
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms, own);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', VERT_NORMAL)
        .replace('#include <begin_vertex>', VERT_POSITION)
        .replace('#include <project_vertex>', VERT_PROJECT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${FRAG_PARS}`)
        .replace('#include <map_fragment>', FRAG_COVER)
        .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
        .replace('#include <lights_fragment_end>', FRAG_LIGHT)
        .replace('#include <tonemapping_fragment>', FRAG_LIMIT);
    };
    const mesh = new THREE.Mesh(this.ring.geometry, materials.patch(material) ?? material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = ORDER.blood;
    mesh.name = 'fx.blood';
    this.ring.object = mesh;
    scene.add(mesh);
  }

  /** Starts a burst. `tone` runs from dark venous at 0 to brighter arterial at 1. */
  begin(birth: number, floor: number, wall: BloodWall | null, tone: number, gravity = -14): this {
    this.birth = birth;
    this.floor = floor;
    this.wall = wall;
    this.tone = tone;
    this.gravity = gravity;
    return this;
  }

  setTone(tone: number): void {
    this.tone = tone;
  }

  /**
   * One strand, `delay` seconds from now. `half` is its half width in meters, `trail` how many seconds of
   * its path it shows, `drag` how fast the air stops it. Returns where it ends, in `this.landing`.
   */
  add(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    half: number, trail: number, drag: number, delay = 0, maxLife = MAX_FLIGHT,
  ): Landing {
    const l = this.landing;
    const g = this.gravity;
    const k = Math.max(drag, 0.001);
    let stop = crossing(y - this.floor, vy, g, k, maxLife);
    l.nx = 0;
    l.ny = stop < maxLife ? 1 : 0;
    l.nz = 0;
    const w = this.wall;
    if (w) {
      const h = (x - w.x) * w.nx + (y - w.y) * w.ny + (z - w.z) * w.nz;
      const t = crossing(h, vx * w.nx + vy * w.ny + vz * w.nz, g * w.ny, k, stop);
      if (t < stop) {
        stop = t;
        l.nx = w.nx;
        l.ny = w.ny;
        l.nz = w.nz;
      }
    }

    const ring = this.ring;
    const d = ring.data;
    const birth = this.birth + delay;
    const life = stop + trail;
    const o = ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = life;
    d[o + 8] = this.tone;
    d[o + 9] = half;
    d[o + 10] = trail;
    d[o + 11] = 1;
    d[o + 12] = g;
    d[o + 13] = k;
    d[o + 14] = stop;
    d[o + 15] = Math.random();

    const e = Math.exp(-k * stop);
    const f = (1 - e) / k;
    l.time = stop;
    l.x = x + vx * f;
    l.y = y + vy * f + (g * (stop - f)) / k;
    l.z = z + vz * f;
    l.vx = vx * e;
    l.vy = vy * e + g * f;
    l.vz = vz * e;
    return l;
  }

  /** A soft puff of very fine drops. It moves with the strands but never lands, it only thins out. */
  mist(x: number, y: number, z: number, vx: number, vy: number, vz: number, half: number, life: number, drag: number, opacity: number, delay = 0): void {
    const ring = this.ring;
    const d = ring.data;
    const birth = this.birth + delay;
    const o = ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = life;
    d[o + 8] = this.tone;
    d[o + 9] = half;
    d[o + 10] = 0;
    d[o + 11] = -opacity;
    d[o + 12] = this.gravity * 0.1;
    d[o + 13] = drag;
    d[o + 14] = life;
    d[o + 15] = Math.random();
  }

  /**
   * An impact puff: the cloud a round knocks out of flesh, `half` metres to its edge, whole on the frame it is added and
   * eaten away over `life` seconds. It drifts with the velocity given and stops within a hand's width. One record.
   */
  puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, half: number, life: number, drag: number, opacity = 1, delay = 0): void {
    const ring = this.ring;
    const d = ring.data;
    const birth = this.birth + delay;
    const o = ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = life;
    d[o + 8] = this.tone;
    d[o + 9] = half;
    d[o + 10] = -1;
    d[o + 11] = -opacity;
    d[o + 12] = this.gravity * 0.08;
    d[o + 13] = drag;
    d[o + 14] = life;
    d[o + 15] = Math.random();
  }

  /**
   * A sharp liquid blood splash web & tendrils (`aC.z = -2`): jagged branching fluid filaments that tear
   * outward on frame 1 and pinch via surface tension into crisp scattered droplets. One record.
   */
  splash(x: number, y: number, z: number, vx: number, vy: number, vz: number, half: number, life: number, drag: number, opacity = 1, delay = 0): void {
    const ring = this.ring;
    const d = ring.data;
    const birth = this.birth + delay;
    const o = ring.alloc(birth + life);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = vx;
    d[o + 5] = vy;
    d[o + 6] = vz;
    d[o + 7] = life;
    d[o + 8] = this.tone;
    d[o + 9] = half;
    d[o + 10] = -2;
    d[o + 11] = -opacity;
    d[o + 12] = this.gravity * 0.22;
    d[o + 13] = drag;
    d[o + 14] = life;
    d[o + 15] = Math.random();
  }

  sync(now: number): void {
    this.ring.sync(now);
  }
}
