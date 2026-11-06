/**
 * Wound maths shared by the skin and by what lies under it. The skin decides where it stops. The inside decides how
 * dark it is, and which layer shows.
 */
import { MAX_WOUNDS, STAIN_MARGIN, STAIN_RADII, WOUND_TEXELS, WoundKind } from './wounds';

/** Extra texels after the bone matrices. */
export const EXTRA_PARAMS = 0;
export const EXTRA_INFO = 1;
export const EXTRA_WOUNDS = 2;
export const EXTRA_TEXELS = EXTRA_WOUNDS + MAX_WOUNDS * WOUND_TEXELS;
/** One size for every rig. 37 bones and all the wounds fit in it with nothing to spare to speak of. */
export const BONE_TEXTURE_SIZE = 16;

const K = WoundKind;

/** Needs `boneTexture` and `uExtraBase`, so it goes after both in either stage. */
export const WOUND_COMMON = /* glsl */ `
#define OP2_MAX_WOUNDS ${MAX_WOUNDS}
#define OP2_WOUND_BASE ${EXTRA_WOUNDS}
#define OP2_WOUND_TEXELS ${WOUND_TEXELS}
#define OP2_INFO ${EXTRA_INFO}
#define OP2_HOLE ${K.hole}
#define OP2_EXIT ${K.exit}
#define OP2_CRATER ${K.crater}
#define OP2_GASH ${K.gash}
#define OP2_BURN ${K.burn}
#define OP2_GRAZE ${K.graze}
#define OP2_DENT ${K.dent}
#define OP2_STAIN_RADII ${STAIN_RADII.toFixed(3)}
#define OP2_STAIN_MARGIN ${STAIN_MARGIN.toFixed(3)}
// Every model's bone texture is the same size, which spares each fetch an integer divide.
vec4 op2Extra(int i) {
  int t = uExtraBase + i;
  return texelFetch(boneTexture, ivec2(t & ${BONE_TEXTURE_SIZE - 1}, t >> ${Math.log2(BONE_TEXTURE_SIZE)}), 0);
}
// Blood runs down the body, so it reaches further below a wound than above it. Bind space keeps that on a corpse too,
// as a stain it had while it stood.
float op2Run(vec3 d) {
  return length(vec3(d.x, d.y < 0.0 ? d.y * 0.42 : d.y, d.z));
}
// Distance from the wound's line, in metres and measured square to its axis, so that a gash follows a curved body
// when its two ends are only a chord across it. Writes how far below the entry point p lies, and the offset from
// the line. The radius narrows to nothing at the ends of a gash.
float op2Slot(vec3 p, vec4 t0, vec4 t1, vec3 axis, out float along, out vec3 off, out float radius) {
  vec3 d = p - t0.xyz;
  along = dot(d, axis);
  vec3 flatD = d - axis * along;
  float h2 = dot(t1.xyz, t1.xyz);
  float t = h2 > 1e-8 ? clamp(dot(flatD, t1.xyz) / h2, -1.0, 1.0) : 0.0;
  off = flatD - t1.xyz * t;
  radius = h2 > 1e-8 ? t1.w * sqrt(max(1.0 - t * t, 0.0)) + 0.0015 : t1.w;
  return length(off);
}
// How far a point lies past either end of a slot. The ends of a slot are what keep a wound on the near side of a body.
float op2SlotEnds(float along, float front, float back) {
  return max(max(-along - front, along - back), 0.0);
}
// Where the skin can be, measured from a hit point on a capsule: gear stands well proud of the capsule, and thin parts
// lie a little inside it. It has nothing to do with how deep the wound goes, or a big exit would cut the skin on the far
// side, where the round went in.
#define OP2_SKIN_ABOVE 0.14
float op2SkinBelow(float radius) {
  return max(0.07, radius * 0.6);
}
`;

/** Which part of the body a vertex belongs to, as a WoundRegion bit, from its heaviest bone. */
export const WOUND_REGION = /* glsl */ `
attribute float aEdge;
int op2Region() {
  float bone = skinIndex.x, weight = skinWeight.x;
  if (skinWeight.y > weight) { bone = skinIndex.y; weight = skinWeight.y; }
  if (skinWeight.z > weight) { bone = skinIndex.z; weight = skinWeight.z; }
  if (skinWeight.w > weight) { bone = skinIndex.w; }
  // The rig's order: trunk and head, left arm, right arm, left leg, right leg, then stump caps, which go anywhere.
  return bone < 4.5 ? 1 : bone < 7.5 ? 2 : bone < 10.5 ? 4 : bone < 13.5 ? 8 : bone < 16.5 ? 16 : 31;
}
`;

/**
 * Sinks the surface round heavy wounds and bends the normal to match, before skinning. Also works out whether a wound
 * is anywhere near this vertex, which saves almost all of the skin from looking at the wound list per pixel.
 * Expects `vec3 op2Push`, `vec3 op2Tilt` and `float op2Near`, and fills them.
 */
export const WOUND_VERTEX_LOOP = /* glsl */ `
{
  int op2Count = int(op2Extra(OP2_INFO).x);
  int op2Bit = op2Region();
  for (int i = 0; i < OP2_MAX_WOUNDS; i++) {
    if (i >= op2Count) break;
    int base = OP2_WOUND_BASE + i * OP2_WOUND_TEXELS;
    vec4 t0 = op2Extra(base);
    float reach = t0.w + aEdge * 0.01 - op2Run(transformed - t0.xyz);
    if (reach <= 0.0) continue;
    op2Near = max(op2Near, reach);
    vec4 t2 = op2Extra(base + 2);
    int code = int(t2.w);
    if (((code >> 3) & op2Bit) == 0) continue;
    int kind = code & 7;
    float depth = length(t2.xyz);
    vec3 axis = t2.xyz / max(depth, 1e-4);
    vec4 t1 = op2Extra(base + 1);
    float along, radius;
    vec3 off;
    float dist = op2Slot(transformed, t0, t1, axis, along, off, radius);
    float past = op2SlotEnds(along, OP2_SKIN_ABOVE, op2SkinBelow(t1.w));
    if (kind == OP2_CRATER || kind == OP2_DENT || kind == OP2_EXIT) {
      // Wider than the hole, so the surface is already falling away where the tear begins.
      float span = t1.w * 1.7;
      float k = clamp(1.0 - dist / span, 0.0, 1.0) * step(past, 0.001);
      float s = k * k * (3.0 - 2.0 * k);
      // An exit wound bursts outward.
      float sink = (kind == OP2_EXIT ? -0.28 : 1.0) * min(depth, t1.w * 1.4);
      op2Push += axis * (sink * s);
      op2Tilt += (off / max(dist, 1e-4)) * (6.0 * k * (1.0 - k) * sink / span);
    }
  }
}
`;
