/**
 * Tactical Nuke. Siren, a white streak from orbit, the screen goes to white, and a shock front crosses the whole map
 * killing whatever it reaches. It does not end there: the mushroom cloud stands for over a minute and the sky stays
 * burnt, so the player keeps fighting inside what they did.
 *
 * The aftermath outlives the strike, so it belongs to NukeAftermath, which the manager keeps across strikes.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo, LoopHandle } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp, lerp, rand, smoothstep, TAU } from '../../core/math';
import { NUKE as N } from '../data';
import { BodyQuery } from './bodies';
import { GroundRing } from './ground';
import type { Strike, StrikeKit, StrikeOrder } from './shared';

const NOISE = /* glsl */ `
float nHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 53.3))) * 43758.5453); }
float nNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(nHash(i), nHash(i + vec3(1, 0, 0)), f.x), mix(nHash(i + vec3(0, 1, 0)), nHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(nHash(i + vec3(0, 0, 1)), nHash(i + vec3(1, 0, 1)), f.x), mix(nHash(i + vec3(0, 1, 1)), nHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float nFbm(vec3 p) { return nNoise(p) * 0.55 + nNoise(p * 2.1) * 0.3 + nNoise(p * 4.3) * 0.15; }
`;

const CLOUD_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vView;
varying float vLump;
${NOISE}
void main() {
  vec3 p = position;
  // Billows boil upward along the column, then the whole shape rolls slowly.
  vec3 q = p * 0.055 + vec3(0.0, -uTime * 0.28, 0.0);
  float lump = nFbm(q);
  vLump = lump;
  p += normal * (lump - 0.42) * 26.0;
  vLocal = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const CLOUD_FRAG = /* glsl */ `
precision highp float;
uniform float uHeat;
uniform float uFade;
uniform float uTime;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vView;
varying float vLump;
float bayer(vec2 p) {
  vec2 i = mod(floor(p), 4.0);
  float v = mod(i.x * 2.0 + i.y * 3.0, 4.0) + mod(i.x + i.y * 2.0, 2.0) * 4.0 + mod(i.x * 3.0 + i.y, 3.0) * 2.0;
  return fract(v / 11.0);
}
void main() {
  // Dissolves with a screen-door so it can stay opaque and sort correctly against everything else.
  if (uFade < 1.0 && bayer(gl_FragCoord.xy) > uFade) discard;
  float h = clamp(vLocal.y / 170.0, 0.0, 1.0);
  float crease = smoothstep(0.34, 0.62, vLump);
  // Fire lives in the folds and at the base of the cap. It cools from white to rust to soot.
  vec3 white = vec3(1.0, 0.94, 0.82) * 14.0;
  vec3 orange = vec3(1.0, 0.36, 0.06) * 7.0;
  vec3 rust = vec3(0.32, 0.075, 0.03);
  vec3 soot = vec3(0.045, 0.036, 0.04);
  float cool = clamp(1.0 - uHeat, 0.0, 1.0);
  vec3 fire = mix(white, orange, smoothstep(0.0, 0.3, cool));
  fire = mix(fire, rust, smoothstep(0.25, 0.75, cool));
  vec3 c = mix(soot + rust * 0.4 * (1.0 - h), fire, (1.0 - crease) * (1.0 - cool * 0.72) + uHeat * 0.4);
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.0);
  c += vec3(1.0, 0.4, 0.15) * rim * (0.6 * uHeat + 0.04);
  gl_FragColor = vec4(c, 1.0);
}`;

const FRONT_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying float vY;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  vY = position.y;
  gl_Position = projectionMatrix * mv;
}`;

const FRONT_FRAG = /* glsl */ `
precision highp float;
uniform float uPower;
varying vec3 vN;
varying vec3 vView;
varying float vY;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  float wall = pow(f, 3.0) * 3.5;
  float base = smoothstep(0.32, 0.0, vY) * 2.6;
  vec3 c = mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.95, 0.88), f) * (wall + base);
  gl_FragColor = vec4(c * uPower, 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform float uAmount;
uniform vec3 uZero;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 horizon = vec3(0.62, 0.17, 0.045);
  vec3 band = vec3(0.26, 0.055, 0.03);
  vec3 zenith = vec3(0.045, 0.012, 0.016);
  vec3 c = mix(horizon, band, 1.0 - exp(-h * 6.0));
  c = mix(c, zenith, 1.0 - exp(-h * 2.1));
  // Hotter under ground zero, so the sky points at what happened.
  float toward = pow(max(dot(normalize(d.xz + 1e-4), uZero.xz), 0.0), 3.0);
  c += vec3(0.5, 0.14, 0.02) * toward * exp(-h * 5.0);
  gl_FragColor = vec4(c, uAmount);
}`;

const ASH_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform float uAmount;
varying float vGlow;
void main() {
  // Wraps around the player, so a few hundred flakes fill the whole map.
  const float BOX = 70.0;
  vec3 p = aSeed * BOX;
  p.y -= uTime * (2.2 + aSeed.x * 1.7);
  p.x += sin(uTime * 0.6 + aSeed.y * 12.0) * 2.5;
  p.z += cos(uTime * 0.5 + aSeed.z * 12.0) * 2.5;
  p = mod(p - uCenter + BOX * 0.5, BOX) - BOX * 0.5 + uCenter;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vGlow = fract(aSeed.x * 7.3) > 0.82 ? 1.0 : 0.0;
  gl_PointSize = clamp(180.0 / -mv.z, 1.0, 9.0) * uAmount;
  gl_Position = projectionMatrix * mv;
}`;

const ASH_FRAG = /* glsl */ `
precision highp float;
uniform float uAmount;
varying float vGlow;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  vec3 c = mix(vec3(0.05, 0.045, 0.05), vec3(3.2, 0.8, 0.2), vGlow);
  gl_FragColor = vec4(c, uAmount);
}`;

const EMBER_LIGHT = new THREE.Color(1, 0.3, 0.09);

function cloudGeometry(): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [66, 0], [44, 3], [26, 8], [17, 18], [14, 36], [13, 60], [14, 82], [20, 100], [36, 112], [58, 118], [76, 128],
    [83, 142], [78, 156], [62, 167], [38, 174], [14, 178], [0, 179],
  ];
  const points = profile.map(([x, y]) => new THREE.Vector2(x, y));
  const curve = new THREE.SplineCurve(points);
  const geo = new THREE.LatheGeometry(curve.getPoints(72), 56);
  geo.computeVertexNormals();
  return geo;
}

/** Things a nuke leaves behind: the cloud, the sky, the ash. Survives the strike, not the run. */
export class NukeAftermath {
  private readonly cloud: THREE.Mesh;
  private readonly cloudMat: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly ash: THREE.Points;
  private readonly ashMat: THREE.ShaderMaterial;
  /** The world's directional light, on the renderer but not in its contract. Absent in headless sandboxes. */
  private readonly moon: THREE.DirectionalLight | undefined;
  private readonly moonColor = new THREE.Color();
  private moonIntensity = 1;
  private age = -1;

  constructor(private readonly ctx: Ctx) {
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
      uniforms: { uTime: { value: 0 }, uHeat: { value: 1 }, uFade: { value: 1 }, uScale: { value: 1 } },
      toneMapped: false, fog: false, side: THREE.DoubleSide,
    });
    this.cloud = new THREE.Mesh(cloudGeometry(), this.cloudMat);
    this.cloud.frustumCulled = false;
    this.cloud.visible = false;
    ctx.render.scene.add(this.cloud);

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { uAmount: { value: 0 }, uZero: { value: new THREE.Vector3(1, 0, 0) } },
      side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.visible = false;
    this.sky.renderOrder = -10;
    ctx.render.scene.add(this.sky);

    const count = 700;
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.ashMat = new THREE.ShaderMaterial({
      vertexShader: ASH_VERT, fragmentShader: ASH_FRAG,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uAmount: { value: 0 } },
      transparent: true, depthWrite: false, toneMapped: false, fog: false,
    });
    this.ash = new THREE.Points(geo, this.ashMat);
    this.ash.frustumCulled = false;
    this.ash.visible = false;
    ctx.render.scene.add(this.ash);

    this.moon = (ctx.render as unknown as { moon?: THREE.DirectionalLight }).moon;
    if (this.moon) {
      this.moonColor.copy(this.moon.color);
      this.moonIntensity = this.moon.intensity;
    }
  }

  /** The blast. Everything starts at full heat, on this frame. */
  begin(zero: THREE.Vector3): void {
    this.age = 0;
    this.cloud.position.copy(zero);
    this.cloud.scale.set(0.2, 0.05, 0.2);
    this.cloud.visible = true;
    this.sky.visible = true;
    this.ash.visible = true;
    const z = this.skyMat.uniforms.uZero!.value as THREE.Vector3;
    z.subVectors(zero, this.ctx.player.position).setY(0).normalize();
  }

  update(dt: number): void {
    if (this.age < 0) return;
    this.age += dt;
    const t = this.age;
    const u = this.cloudMat.uniforms;
    u.uTime!.value = t;
    // Fast out of the ground, then the stem keeps climbing slowly for the rest of its life.
    const rise = 1 - Math.exp(-t * 0.5);
    const grow = 0.05 + 0.95 * rise;
    const wide = 0.2 + 0.8 * (1 - Math.exp(-t * 0.75));
    this.cloud.scale.set(wide * 1.25, grow * 1.5, wide * 1.25);
    this.cloud.rotation.y = t * 0.015;
    u.uHeat!.value = Math.exp(-t * 0.1);
    u.uFade!.value = 1 - smoothstep(N.cloudLife - 15, N.cloudLife, t);

    const sky = 1 - smoothstep(N.skyHold, N.skyHold + N.skyFade, t);
    this.skyMat.uniforms.uAmount!.value = 0.92 * smoothstep(0, 1.5, t) * sky;
    this.ashMat.uniforms.uTime!.value = t;
    this.ashMat.uniforms.uAmount!.value = smoothstep(2, 6, t) * sky;
    (this.ashMat.uniforms.uCenter!.value as THREE.Vector3).copy(this.ctx.player.position);
    this.burnMoon(smoothstep(0, 1.5, t) * sky);

    if (t >= N.cloudLife && sky <= 0) this.clear();
  }

  /** The moonlight turns the colour of the sky, so the map itself looks burnt and not just the air above it. */
  private burnMoon(amount: number): void {
    if (!this.moon) return;
    this.moon.color.copy(this.moonColor).lerp(EMBER_LIGHT, amount);
    this.moon.intensity = this.moonIntensity * (1 + amount * 0.5);
  }

  clear(): void {
    this.age = -1;
    this.burnMoon(0);
    this.cloud.visible = false;
    this.sky.visible = false;
    this.ash.visible = false;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _from = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();

/** How long the visible streak is in the sky before impact. */
const MISSILE_SECONDS = 2.8;
const MISSILE_SPEED = 170;

export class Nuke implements Strike {
  private t = 0;
  private launched = false;
  private detonatedAt = -1;
  private frontRadius = 0;
  private lastCount = 7;
  private done = false;
  private playerHit = false;
  private readonly zero = new THREE.Vector3();
  private readonly ring: GroundRing;
  private siren: LoopHandle | null = null;
  private readonly front: THREE.Mesh;
  private readonly frontMat: THREE.ShaderMaterial;
  private readonly near: EnemyInstance[] = [];
  private readonly blast: DamageInfo = {
    amount: 999999, type: 'true', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 90, source: 'nuke',
  };
  private readonly bodies: BodyQuery;
  private wakeIn = 0;

  constructor(private readonly kit: StrikeKit, order: StrikeOrder, private readonly aftermath: NukeAftermath) {
    const { ctx, probe } = kit;
    this.zero.copy(order.point);
    this.ring = new GroundRing(ctx);
    this.ring.setColor('#ff3020', 1.8);
    this.frontMat = new THREE.ShaderMaterial({
      vertexShader: FRONT_VERT, fragmentShader: FRONT_FRAG, uniforms: { uPower: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    this.front = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 16, 0, TAU, 0, Math.PI / 2), this.frontMat);
    this.front.frustumCulled = false;
    this.front.visible = false;
    ctx.render.scene.add(this.front);
    this.bodies = new BodyQuery(ctx);

    ctx.audio.play('walkietalkie_fire');
    this.siren = ctx.audio.startLoop('siren_loop', { unaffectedByTime: true });
    ctx.audio.play('nuke_siren', { unaffectedByTime: true });
    ctx.hud.banner('TACTICAL NUKE INBOUND', `DETONATION IN ${N.sirenTime}`, '#ff2a2a');
  }

  update(dt: number): boolean {
    this.t += dt;
    const { audio, hud } = this.kit.ctx;

    if (this.detonatedAt < 0) {
      const left = Math.ceil(N.sirenTime - this.t);
      if (left !== this.lastCount && left > 0) {
        this.lastCount = left;
        audio.play('wave_tick', { unaffectedByTime: true });
        hud.banner('TACTICAL NUKE INBOUND', `DETONATION IN ${left}`, '#ff2a2a');
      }
      this.ring.show(this.zero, 90);
      this.ring.setOpacity(0.5 + Math.sin(this.t * 10) * 0.4);
      this.ring.tick(this.t);
      if (!this.launched && this.t >= N.sirenTime - MISSILE_SECONDS) this.launch();
      // World time could stall the missile in SLOWMO, so the blast keeps its appointment.
      if (this.t >= N.sirenTime + 0.5) this.detonate(this.zero);
      return false;
    }

    return this.expand(dt);
  }

  private launch(): void {
    this.launched = true;
    this.kit.ctx.audio.play('nuke_incoming', { unaffectedByTime: true });
    _from.copy(this.zero).setY(this.zero.y + MISSILE_SECONDS * MISSILE_SPEED);
    _vel.set(0, -MISSILE_SPEED, 0);
    this.kit.ordnance.launch('nuke', _from, _vel, p => this.detonate(p));
  }

  private detonate(p: THREE.Vector3): void {
    if (this.detonatedAt >= 0) return;
    const { audio, camera, fx, render, time } = this.kit.ctx;
    this.detonatedAt = this.t;
    this.zero.copy(p);
    this.kit.ordnance.clear();
    this.siren?.stop(0.05);
    this.siren = null;
    this.ring.hide();

    audio.play('nuke_blast', { unaffectedByTime: true });
    audio.play('nuke_tail', { unaffectedByTime: true, delay: 0.4 });
    render.post.flash('#ffffff', N.whiteout, N.whiteoutSeconds);
    render.post.chromatic(2, 1.6);
    render.post.radialBlur(1, 1.1);
    render.lights.flash(p, '#ffe8c0', 400, 260, 1.4);
    camera.fovPunch(24, 1.4);
    camera.addTrauma(1);
    time.hitStop(0.16, 0.02);
    fx.explosion(p, { radius: 60, kind: 'nuke', scale: 4 });
    fx.ring(p, _up, '#ffffff', 120);
    fx.heatShimmer(p, 90, 6);
    render.decals.add('scorch', p, _up, 44, 0);
    render.decals.add('crack', p, _up, 34, 1.3);
    this.front.position.copy(p);
    this.front.visible = true;
    this.aftermath.begin(p);
  }

  /** Drives the shock front. Everything dies as it arrives, not on the same frame. */
  private expand(dt: number): boolean {
    const { enemies, fx, player, render } = this.kit.ctx;
    const prev = this.frontRadius;
    this.frontRadius = Math.min(N.maxRadius, this.frontRadius + N.frontSpeed * dt);
    const r = this.frontRadius;
    this.front.scale.set(r, r * 0.26, r);
    this.frontMat.uniforms.uPower!.value = clamp(1.3 - r / N.maxRadius);

    const count = enemies.query(this.zero, r, this.near);
    for (let i = 0; i < count; i++) {
      const e = this.near[i]!;
      if (!e.alive) continue;
      const d = e.center.distanceTo(this.zero);
      this.blast.point.copy(e.center);
      this.blast.dir.subVectors(e.center, this.zero).setY(0).normalize().setY(0.55).normalize();
      this.blast.gib = d < N.gibRadius;
      // A ragdoll inherits the feet's velocity, which is the one throw that moves the whole body as a body.
      e.velocity.copy(this.blast.dir).multiplyScalar(lerp(N.throwNear, N.throwFar, clamp(d / N.throwFalloff)));
      enemies.applyDamage(e, this.blast);
    }
    this.launchBodies(prev, r, dt);

    if (!this.playerHit && player.position.distanceTo(this.zero) <= r) {
      this.playerHit = true;
      this.hitPlayer();
    }

    // Scattered dust and scorch along the ring as it passes.
    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU);
      _p.set(this.zero.x + Math.cos(a) * r, this.zero.y, this.zero.z + Math.sin(a) * r);
      const h = this.kit.probe.heightAt(_p.x, this.zero.y + 40, _p.z, 90);
      if (Number.isNaN(h)) continue;
      _p.y = h;
      fx.smoke(_p, '#3a2a26', rand(6, 12), 2.4);
      if (i === 0) render.decals.add('scorch', _p, _up, rand(6, 12), a);
    }

    if (r >= N.maxRadius) {
      this.front.visible = false;
      this.done = true;
    }
    return this.done;
  }

  /** Corpses and limbs take their shove from a band that travels with the front. */
  private launchBodies(prev: number, r: number, dt: number): void {
    this.wakeIn -= dt;
    if (this.wakeIn <= 0) {
      this.wakeIn = 0.1;
      this.bodies.wake(this.zero, r + N.wakeAhead, 1);
    }
    for (const body of this.bodies.run(this.zero, r)) {
      const p = body.translation();
      _dir.set(p.x - this.zero.x, 0, p.z - this.zero.z);
      const d = _dir.length();
      // Only what the front is passing right now. The ball query returns the whole disc.
      if (d < prev) continue;
      _dir.divideScalar(Math.max(d, 0.1));
      const k = lerp(N.throwNear, N.throwFar, clamp(d / N.throwFalloff)) * body.mass();
      body.applyImpulse({ x: _dir.x * k, y: k * 0.6, z: _dir.z * k }, true);
    }
  }

  private hitPlayer(): void {
    const { audio, camera, player, render } = this.kit.ctx;
    _dir.subVectors(player.position, this.zero).setY(0);
    const d = _dir.length();
    _dir.divideScalar(Math.max(d, 0.1));
    const shove = 34 - Math.min(d, 200) * 0.09;
    player.launch(_vel.set(_dir.x * shove, 15, _dir.z * shove));
    camera.addTrauma(1);
    camera.kick(0.08, 0, 0.06);
    render.post.flash('#ffb060', 1.2, 0.8);
    audio.play('explosion_debris');
  }

  dispose(): void {
    const { render } = this.kit.ctx;
    this.siren?.stop(0.1);
    this.siren = null;
    render.scene.remove(this.front);
    this.front.geometry.dispose();
    this.frontMat.dispose();
    this.ring.dispose();
  }
}
