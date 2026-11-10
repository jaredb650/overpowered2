/**
 * What the open door looks out on: a dusk sky, a cloud deck far below sliding aft, ground showing dark through the gaps,
 * a ring of peaks standing out of the deck at the horizon, cloud heads standing up out of the deck, and scraps of cloud
 * going past close by. Four draws, all shader, no textures.
 *
 * Everything is in the aircraft's frame (nose +Z, door +X). The aircraft does not move; the world slides past it, so the
 * deck's pattern runs toward -Z at the airspeed and the peaks turn slowly as if flown past.
 *
 * The deck is deliberately soft, with no fine octave: it is 70 m and more from a lens focused at three, and the softness
 * is the depth of field this scene gets for free.
 */
import * as THREE from 'three';

/** Linear colours. Cold blue hour, with one band of low sun on the horizon. */
export const SKY = {
  zenith: new THREE.Color(0.004, 0.009, 0.028),
  high: new THREE.Color(0.016, 0.032, 0.085),
  horizon: new THREE.Color(0.075, 0.085, 0.13),
  sunBand: new THREE.Color(0.85, 0.36, 0.16),
  sun: new THREE.Color(1.0, 0.7, 0.48),
} as const;

/** Toward the sun, from the aircraft: out of the door and a little behind, low. It is behind the camera's left shoulder, so it lights his face and the door shows the cold side of the sky. */
export const SUN_DIR = new THREE.Vector3(0.9, 0.13, -0.42).normalize();
/** Metres per second the world goes by. */
export const AIRSPEED = 46;
/** How far below the cabin floor the tops of the cloud deck lie. */
const DECK_DEPTH = 85;
const DECK_SIZE = 5200;
const RIDGE_RADIUS = 2300;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSun, uZenith, uHigh, uHorizon, uBand, uSunCol;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float s = max(dot(d, uSun), 0.0);
  vec3 c = mix(uHorizon, uHigh, smoothstep(0.0, 0.22, h));
  c = mix(c, uZenith, smoothstep(0.18, 0.75, h));
  // The warm band hugs the horizon and only on the sun's side of the sky.
  float band = exp(-abs(h - 0.012) * 16.0) * pow(s, 2.5);
  c += uBand * band * 0.75;
  c += uSunCol * (pow(s, 28.0) * 0.55 + pow(s, 400.0) * 3.0 + smoothstep(0.99955, 0.9997, s) * 14.0);
  // Below the horizon: haze over the deck, darker straight down.
  c = mix(c, uHorizon * 0.55 + uBand * band * 0.3, smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(c, 1.0);
}`;

const NOISE = /* glsl */ `
float op2h(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float op2n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(op2h(i), op2h(i + vec2(1, 0)), u.x), mix(op2h(i + vec2(0, 1)), op2h(i + vec2(1, 1)), u.x), u.y);
}
float op2fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * op2n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}`;

const DECK_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const DECK_FRAG = /* glsl */ `
uniform float uTravel;
uniform vec3 uSun, uHorizon, uBand, uSunCol, uHigh;
varying vec3 vWorld;
${NOISE}
float op2deck(vec2 p) {
  float big = op2fbm(p * 0.0011);
  return big * 0.72 + op2fbm(p * 0.0036 + big * 2.2) * 0.42;
}
void main() {
  vec2 p = vWorld.xz + vec2(0.0, uTravel);
  float dist = length(vWorld.xz);
  // Big rounded masses with billows on them. No fine octave: seen at a grazing angle it streaks into ripples, and the
  // deck reads as water.
  float h = op2deck(p);
  float dens = smoothstep(0.4, 0.55, h);
  // Lit where the cloud rises toward the low sun: compare with a sample a step sunward.
  vec2 toSun = normalize(uSun.xz);
  float hs = op2deck(p + toSun * 70.0);
  float facing = clamp((h - hs) * 7.0 + 0.45, 0.0, 1.0);
  float thick = smoothstep(0.46, 0.8, h);
  vec3 shade = uHigh * 2.2 + vec3(0.025, 0.026, 0.04);
  vec3 lit = uSunCol * 0.36 + uBand * 0.12 + vec3(0.03, 0.03, 0.06);
  vec3 cloud = mix(shade, lit, facing * (0.35 + 0.65 * thick));
  // Thin edges let the dark show through, so each mass has a soft rim rather than a hard line.
  cloud *= 0.55 + 0.45 * smoothstep(0.4, 0.62, h);
  // Ground through the gaps, far below and darker still, with the lights of a town here and there.
  vec2 g = vWorld.xz + vec2(0.0, uTravel * 0.4);
  vec3 land = mix(vec3(0.003, 0.004, 0.008), vec3(0.012, 0.016, 0.024), op2fbm(g * 0.004 + 31.0));
  vec2 cell = floor(g / 70.0);
  vec2 f = fract(g / 70.0) - 0.5 - (vec2(op2h(cell + 1.3), op2h(cell + 7.7)) - 0.5) * 0.6;
  float town = smoothstep(0.55, 0.75, op2fbm(g * 0.0016 + 5.0));
  float lamp = step(0.5, op2h(cell)) * town * smoothstep(0.14, 0.02, length(f));
  land += vec3(1.0, 0.55, 0.22) * lamp * 0.9 * exp(-dist * 0.0014);
  vec3 c = mix(land, cloud, dens);
  // Toward the horizon everything goes to the sky's haze, warmer on the sun's side.
  vec3 dir = normalize(vec3(vWorld.x, -${DECK_DEPTH.toFixed(1)}, vWorld.z));
  float s = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 3.0);
  vec3 haze = uHorizon * 0.9 + uBand * s * 0.2;
  c = mix(c, haze, 1.0 - exp(-dist * 0.00062));
  gl_FragColor = vec4(c, 1.0);
}`;

const RIDGE_FRAG = /* glsl */ `
uniform float uTurn;
uniform vec3 uHorizon, uBand, uSun;
varying vec3 vWorld;
varying vec2 vUv;
${NOISE}
void main() {
  float a = vUv.x * 64.0 + uTurn;
  float peaks = pow(op2fbm(vec2(a, 3.1)), 2.2) * 1.5 - 0.12;
  if (vUv.y > peaks) discard;
  vec3 d = normalize(vWorld);
  float s = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 3.0);
  // Silhouettes in haze: barely darker than the sky behind, and lit at their crests on the sun side.
  vec3 c = uHorizon * 0.42 + uBand * s * 0.08;
  c += uBand * s * smoothstep(peaks - 0.03, peaks, vUv.y) * 0.25;
  gl_FragColor = vec4(c, 1.0);
}`;

const RIDGE_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;

/**
 * Cloud heads standing up out of the deck, and scraps of cloud the aircraft passes close by. Soft billboards, lit warm
 * on top and cold underneath, all in one draw: the shader places them and slides them aft. Without them the flat deck
 * reads as a sea at dusk.
 */
const HEADS = 64;
const WISPS = 12;
const PUFF_SPAN = 3200;

const PUFF_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aShape;
uniform float uTravel;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vHaze;
void main() {
  vUv = position.xy;
  vSeed = aShape.w;
  float span = ${PUFF_SPAN.toFixed(1)};
  vec3 c = aPos;
  c.z = mod(aPos.z - uTravel, span) - span * 0.3;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * aShape.x * vec2(1.0, aShape.y);
  // In at the far end of the run, out before they wrap round.
  vAlpha = aShape.z * smoothstep(-span * 0.3, -span * 0.2, c.z) * (1.0 - smoothstep(span * 0.55, span * 0.7, c.z));
  vHaze = 1.0 - exp(-length(c.xz) * 0.00062);
  gl_Position = projectionMatrix * mv;
}`;

const PUFF_FRAG = /* glsl */ `
uniform vec3 uLit, uShade, uHaze;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vHaze;
${NOISE}
void main() {
  float n = op2fbm(vUv * 2.4 + vSeed * 31.0);
  // Billows round the edge: a few big lobes and smaller ones on them.
  float lobes = op2fbm(vec2(atan(vUv.y, vUv.x) * 2.0, vSeed * 9.0)) * 0.5 + op2fbm(vUv * 6.0 + vSeed * 3.0) * 0.25;
  // A head is round on top and flat underneath, where it sits in the deck.
  vec2 q = vec2(vUv.x, vUv.y < 0.0 ? vUv.y * 2.2 : vUv.y);
  float r = length(q) + 0.42 - lobes;
  float a = smoothstep(1.0, 0.86, r) * vAlpha;
  if (a < 0.004) discard;
  vec3 c = mix(uShade, uLit, clamp(0.3 + vUv.y * 0.9 + (n - 0.5) * 0.7, 0.0, 1.0));
  gl_FragColor = vec4(mix(c, uHaze, vHaze), a);
}`;

/** Instance data for the heads and the wisps, far ones first so they blend in order. */
function puffInstances(): { pos: Float32Array; shape: Float32Array; count: number } {
  let seed = 41;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const list: number[][] = [];
  const deckY = -1 - DECK_DEPTH;
  for (let i = 0; i < HEADS; i++) {
    // Out of the door side, denser near: the far ones are small on screen and many would be wasted.
    const x = 160 + 1700 * rnd() ** 1.5;
    const size = 40 + rnd() * 90 + x * 0.07;
    list.push([x, deckY + size * 0.1, rnd() * PUFF_SPAN, size, 0.42 + rnd() * 0.12, 0.95, rnd()]);
  }
  for (let i = 0; i < WISPS; i++) {
    const size = 6 + rnd() * 12;
    list.push([9 + rnd() * 60, -4 - rnd() * 26, rnd() * PUFF_SPAN, size, 0.45, 0.4, rnd()]);
  }
  list.sort((a, b) => b[0]! - a[0]!);
  const pos = new Float32Array(list.length * 3);
  const shape = new Float32Array(list.length * 4);
  list.forEach((p, i) => {
    pos.set(p.slice(0, 3), i * 3);
    shape.set(p.slice(3), i * 4);
  });
  return { pos, shape, count: list.length };
}

export class Outside {
  /** Rotated by the caller against the airframe's sway: the cabin is the camera's frame, so the world rolls instead. */
  readonly root = new THREE.Group();
  private readonly deck: THREE.ShaderMaterial;
  private readonly ridge: THREE.ShaderMaterial;
  private readonly puffs: THREE.ShaderMaterial;
  private readonly owned: { dispose(): void }[] = [];

  constructor() {
    const shared = {
      uSun: { value: SUN_DIR },
      uZenith: { value: SKY.zenith },
      uHigh: { value: SKY.high },
      uHorizon: { value: SKY.horizon },
      uBand: { value: SKY.sunBand },
      uSunCol: { value: SKY.sun },
    };
    const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: shared, side: THREE.BackSide, depthWrite: false });
    const skyGeo = new THREE.SphereGeometry(4000, 32, 16);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;

    this.deck = new THREE.ShaderMaterial({ vertexShader: DECK_VERT, fragmentShader: DECK_FRAG, uniforms: { ...shared, uTravel: { value: 0 } } });
    const deckGeo = new THREE.PlaneGeometry(DECK_SIZE, DECK_SIZE, 1, 1).rotateX(-Math.PI / 2);
    const deck = new THREE.Mesh(deckGeo, this.deck);
    deck.position.y = -1 - DECK_DEPTH;
    deck.renderOrder = -9;

    this.ridge = new THREE.ShaderMaterial({ vertexShader: RIDGE_VERT, fragmentShader: RIDGE_FRAG, uniforms: { ...shared, uTurn: { value: 0 } }, side: THREE.BackSide });
    const ridgeGeo = new THREE.CylinderGeometry(RIDGE_RADIUS, RIDGE_RADIUS, 420, 96, 1, true);
    const ridge = new THREE.Mesh(ridgeGeo, this.ridge);
    ridge.position.y = -1 - DECK_DEPTH + 200;
    ridge.renderOrder = -8;

    // One quad per puff, all in one draw; the shader places and moves them.
    const puffGeo = new THREE.InstancedBufferGeometry();
    puffGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    puffGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = puffInstances();
    puffGeo.setAttribute('aPos', new THREE.InstancedBufferAttribute(inst.pos, 3));
    puffGeo.setAttribute('aShape', new THREE.InstancedBufferAttribute(inst.shape, 4));
    puffGeo.instanceCount = inst.count;
    this.puffs = new THREE.ShaderMaterial({
      vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uTravel: { value: 0 },
        uLit: { value: SKY.sun.clone().multiplyScalar(0.4).add(SKY.sunBand.clone().multiplyScalar(0.1)) },
        uShade: { value: SKY.high.clone().multiplyScalar(2.2).add(new THREE.Color(0.02, 0.022, 0.035)) },
        uHaze: { value: SKY.horizon.clone().multiplyScalar(0.9) },
      },
    });
    const puffs = new THREE.Mesh(puffGeo, this.puffs);
    puffs.frustumCulled = false;
    puffs.renderOrder = -7;

    this.root.add(sky, deck, ridge, puffs);
    this.owned.push(skyMat, skyGeo, this.deck, deckGeo, this.ridge, ridgeGeo, this.puffs, puffGeo);
  }

  /** `seconds` of flight so far. */
  update(seconds: number): void {
    this.deck.uniforms.uTravel!.value = (seconds * AIRSPEED) % 100000;
    this.puffs.uniforms.uTravel!.value = (seconds * AIRSPEED) % PUFF_SPAN;
    // The peaks are kilometres off, so they wheel past slowly.
    this.ridge.uniforms.uTurn!.value = seconds * 0.012;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
}
