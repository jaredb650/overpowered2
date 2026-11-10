/**
 * Cigar smoke: one draw of soft points. A thin curl rises off the tip, drifts toward the door, and once it is past the
 * sill the slipstream takes it aft in a rush. An exhale is a denser, faster puff from the mouth along the same path.
 *
 * Positions are in the aircraft's frame and moved on the CPU: 160 particles is nothing, and it keeps the shader trivial.
 */
import * as THREE from 'three';

const CAP = 160;
/** Where the inside of the door ends and the slipstream begins, on X. */
const SILL_X = 1.3;

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.05);
  vAlpha = aAlpha;
  vSeed = fract(position.x * 13.1 + position.z * 7.7);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  // A soft blob with a lopsided core, so a stream of them reads as wisps rather than beads.
  float core = exp(-r * 3.2) * (0.75 + 0.25 * sin((p.x + p.y * 0.6) * 5.0 + vSeed * 6.28));
  gl_FragColor = vec4(uColor, vAlpha * core);
}`;

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number; life: number;
  size: number; grow: number;
  alpha: number;
  seed: number;
}

export class Smoke {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos = new Float32Array(CAP * 3);
  private readonly size = new Float32Array(CAP);
  private readonly alpha = new Float32Array(CAP);
  private readonly puffs: Puff[] = [];
  private next = 0;
  private tipCarry = 0;
  private mouthCarry = 0;
  private clock = 0;

  constructor() {
    for (let i = 0; i < CAP; i++) this.puffs.push({ x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 0, size: 0, grow: 0, alpha: 0, seed: i * 0.618 });
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 500 }, uColor: { value: new THREE.Color(0.34, 0.37, 0.42) } },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Pixels per metre at one metre: half the drawing height over tan(fov / 2). */
  setScale(pixelsPerMetre: number): void {
    this.mat.uniforms.uScale!.value = pixelsPerMetre;
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, alpha: number): void {
    const p = this.puffs[this.next]!;
    this.next = (this.next + 1) % CAP;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.age = 0; p.life = life; p.size = size; p.grow = grow; p.alpha = alpha;
  }

  /**
   * `tip` is the lit end, `ember` 0..1 how hot it is. `mouth` and `out` (a unit direction) place an exhale, and
   * `exhale` 0..1 is how hard he is breathing out.
   */
  update(dt: number, tip: THREE.Vector3, ember: number, mouth: THREE.Vector3, out: THREE.Vector3, exhale: number): void {
    this.clock += dt;
    // A hotter tip smokes more.
    this.tipCarry += dt * (9 + ember * 10);
    while (this.tipCarry >= 1) {
      this.tipCarry -= 1;
      const j = Math.random() - 0.5;
      this.emit(tip.x, tip.y + 0.005, tip.z, j * 0.03, 0.09 + Math.random() * 0.05, j * 0.03, 2.6 + Math.random() * 1.2, 0.012, 0.075, 0.5);
    }
    if (exhale > 0.02) {
      this.mouthCarry += dt * 46 * exhale;
      while (this.mouthCarry >= 1) {
        this.mouthCarry -= 1;
        const s = 0.35 + Math.random() * 0.4;
        this.emit(mouth.x, mouth.y, mouth.z, out.x * s + (Math.random() - 0.5) * 0.08, out.y * s + 0.03, out.z * s + (Math.random() - 0.5) * 0.08, 1.8 + Math.random(), 0.03, 0.22, 0.42 * exhale + 0.12);
      }
    } else {
      this.mouthCarry = 0;
    }
    const t = this.clock;
    for (let i = 0; i < CAP; i++) {
      const p = this.puffs[i]!;
      if (p.age >= p.life) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      p.age += dt;
      // Air in the cabin eddies toward the door; past the sill the slipstream takes it aft and away.
      const outside = p.x > SILL_X ? Math.min(1, (p.x - SILL_X) * 4) : 0;
      const ax = 0.22 + outside * 2.5;
      const az = -0.1 - outside * 14;
      const k = 1 - Math.exp(-dt * (1.2 + outside * 2));
      p.vx += (ax - p.vx) * k;
      p.vz += (az - p.vz) * k;
      p.vy += (0.05 - p.vy) * (1 - Math.exp(-dt * 0.8));
      // The curl: a slow sideways wander that grows as the thread rises.
      const w = Math.min(1, p.age * 1.4) * (1 - outside);
      const curlX = Math.sin(t * 1.7 + p.seed * 5 + p.age * 2.3) * 0.07 * w;
      const curlZ = Math.cos(t * 1.3 + p.seed * 3 + p.age * 1.9) * 0.07 * w;
      p.x += (p.vx + curlX) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + curlZ) * dt;
      const u = p.age / p.life;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.size + p.grow * Math.sqrt(p.age) * (1 + outside * 2);
      this.alpha[i] = p.alpha * Math.min(1, p.age * 8) * (1 - u) * (1 - u) * (1 - outside * 0.6);
    }
    for (const name of ['position', 'aSize', 'aAlpha'] as const) this.geo.getAttribute(name).needsUpdate = true;
  }

  /** How many are in the air, for the live check. */
  live(): number {
    let n = 0;
    for (const p of this.puffs) if (p.age < p.life) n++;
    return n;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
