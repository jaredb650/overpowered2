/**
 * Black Sun. A singularity opens over the target and everything near it gets dragged in: the living by their feet,
 * corpses and severed limbs as rigid bodies by impulses. Then it collapses and everything it swallowed comes back out.
 */
import * as THREE from 'three';
import { CG, type DamageInfo, type LoopHandle } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { lerp, smoothstep } from '../../core/math';
import { BLACK_SUN as B } from '../data';
import { GroundRing } from './ground';
import type { Strike, StrikeKit, StrikeOrder } from './shared';

const BODY_MASK = CG.Ragdoll | CG.Gib | CG.Debris;
const BODY_FILTER = (0xffff << 16) | BODY_MASK;
const STREAKS = 260;

const DISC_VERT = /* glsl */ `
varying vec2 vPolar;
void main() {
  vPolar = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DISC_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPower;
varying vec2 vPolar;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vPolar * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || r < 0.28) discard;
  float a = atan(p.y, p.x);
  // Log spiral: bands wind tighter toward the centre and rotate faster there, as a disc should.
  float swirl = a * 3.0 + log(r) * 9.0 + uTime * (5.0 / (r + 0.25));
  float bands = noise(vec2(cos(swirl), sin(swirl)) * 2.2 + r * 5.0);
  bands = pow(bands, 1.6) * 1.8;
  float inner = smoothstep(0.28, 0.34, r);
  float outer = smoothstep(1.0, 0.45, r);
  vec3 hot = mix(vec3(1.0, 0.86, 0.72) * 6.0, vec3(0.95, 0.15, 0.32) * 2.6, smoothstep(0.3, 0.62, r));
  hot = mix(hot, vec3(0.42, 0.12, 1.0) * 1.6, smoothstep(0.58, 0.95, r));
  gl_FragColor = vec4(hot * bands * inner * outer * uPower, 1.0);
}`;

const RIM_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const RIM_FRAG = /* glsl */ `
precision highp float;
uniform float uPower;
varying vec3 vN;
varying vec3 vView;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  float photon = pow(f, 7.0) * 9.0 + pow(f, 2.5) * 0.5;
  gl_FragColor = vec4(vec3(0.95, 0.72, 1.0) * photon * uPower, 1.0);
}`;

/** Infall streaks live entirely on the GPU: each is a seed and a phase, spiralling in on a fixed path. */
const STREAK_VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aTail;
uniform float uTime;
uniform float uRadius;
varying float vHeat;
void main() {
  float phase = fract(uTime * (0.22 + aSeed.x * 0.3) + aSeed.y);
  phase -= aTail * 0.02;
  float r = uRadius * (1.0 - phase) * (1.0 - phase) + 1.8;
  float ang = aSeed.y * 6.2831 + phase * phase * 9.0;
  float y = (aSeed.z - 0.5) * r * 0.5 * (1.0 - phase);
  vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
  vHeat = phase;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const STREAK_FRAG = /* glsl */ `
precision highp float;
uniform float uPower;
varying float vHeat;
void main() {
  vec3 c = mix(vec3(0.5, 0.2, 1.0) * 1.5, vec3(1.0, 0.8, 0.7) * 6.0, vHeat * vHeat);
  gl_FragColor = vec4(c * uPower, 1.0);
}`;

const additive = {
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false,
} as const;

const _pull = new THREE.Vector3();
const _swirl = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();

export class BlackSun implements Strike {
  private t = 0;
  private detonated = false;
  private opened = false;
  private crushIn = 0;
  private readonly center = new THREE.Vector3();
  private readonly ground = new THREE.Vector3();
  private readonly group = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly rim: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly streaks: THREE.LineSegments;
  private readonly discMat: THREE.ShaderMaterial;
  private readonly rimMat: THREE.ShaderMaterial;
  private readonly streakMat: THREE.ShaderMaterial;
  private readonly ring: GroundRing;
  private readonly ball: InstanceType<StrikeKit['ctx']['physics']['R']['Ball']>;
  private readonly identity = { x: 0, y: 0, z: 0, w: 1 };
  private readonly near: EnemyInstance[] = [];
  private loop: LoopHandle | null = null;
  private strength = 0;
  private bodyDt = 0;
  private readonly crush: DamageInfo = {
    amount: 0, type: 'true', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 10, source: 'black_sun', severMult: 6,
  };
  private readonly pullBody: (collider: Parameters<Parameters<StrikeKit['ctx']['physics']['world']['intersectionsWithShape']>[3]>[0]) => boolean;

  constructor(private readonly kit: StrikeKit, order: StrikeOrder) {
    const { ctx, probe } = kit;
    this.ground.copy(order.point);
    this.center.copy(order.point);
    const room = probe.headroom(order.point.x, order.point.y + 0.5, order.point.z, B.height + 3);
    this.center.y += Math.min(B.height, room - 3);
    this.ball = new ctx.physics.R.Ball(B.pullRadius);
    this.ring = new GroundRing(ctx);
    this.ring.setColor('#a56bff', 1.6);

    this.core = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false }));
    this.rimMat = new THREE.ShaderMaterial({ vertexShader: RIM_VERT, fragmentShader: RIM_FRAG, uniforms: { uPower: { value: 0 } }, ...additive });
    this.rim = new THREE.Mesh(this.core.geometry, this.rimMat);
    this.rim.scale.setScalar(1.12);
    this.discMat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, uniforms: { uTime: { value: 0 }, uPower: { value: 0 } }, ...additive,
    });
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.discMat);
    this.disc.rotation.set(-Math.PI / 2 + 0.34, 0, 0.2);

    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(STREAKS * 2 * 3);
    const tails = new Float32Array(STREAKS * 2);
    for (let i = 0; i < STREAKS; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      for (let v = 0; v < 2; v++) {
        seeds.set(s, (i * 2 + v) * 3);
        tails[i * 2 + v] = v;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAKS * 2 * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aTail', new THREE.BufferAttribute(tails, 1));
    this.streakMat = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uRadius: { value: B.pullRadius } }, ...additive,
    });
    this.streaks = new THREE.LineSegments(geo, this.streakMat);

    for (const m of [this.core, this.rim, this.disc, this.streaks]) m.frustumCulled = false;
    this.group.add(this.disc, this.streaks, this.core, this.rim);
    this.group.position.copy(this.center);
    this.group.scale.setScalar(0.001);
    ctx.render.scene.add(this.group);

    this.pullBody = collider => {
      const body = collider.parent();
      if (!body || !body.isDynamic()) return true;
      const p = body.translation();
      _pull.set(this.center.x - p.x, this.center.y - p.y, this.center.z - p.z);
      const d = Math.max(_pull.length(), 0.5);
      _pull.divideScalar(d);
      // Rises toward the centre and keeps a tangent, so the debris forms a disc instead of a clot.
      const k = this.strength * B.bodyAccel * (0.35 + 0.65 * (1 - d / B.pullRadius)) * body.mass() * this.bodyDt;
      _swirl.crossVectors(_up, _pull);
      body.applyImpulse({ x: _pull.x * k + _swirl.x * k * 0.45, y: _pull.y * k + 0.2 * k, z: _pull.z * k + _swirl.z * k * 0.45 }, true);
      return true;
    };

    ctx.audio.play('walkietalkie_fire');
    ctx.audio.play('blacksun_open', { position: this.center });
    ctx.render.post.chromatic(0.8, 0.5);
  }

  update(dt: number): boolean {
    this.t += dt;
    const { render } = this.kit.ctx;
    const collapseAt = B.growTime + B.pullTime;
    const endAt = collapseAt + B.collapseTime;

    let size = 0;
    if (this.t < B.growTime) size = smoothstep(0, B.growTime, this.t) * 3.4;
    else if (this.t < collapseAt) size = 3.4 + Math.sin(this.t * 12) * 0.08 + (this.t - B.growTime) * 0.14;
    else size = lerp(4.1, 0.05, smoothstep(collapseAt, endAt, this.t));

    this.core.scale.setScalar(size);
    this.rim.scale.setScalar(size * 1.14);
    this.disc.scale.setScalar(size * 4.8);
    this.group.scale.setScalar(1);
    this.group.rotation.y += dt * 0.4;

    const power = Math.min(1, this.t / 0.5);
    this.discMat.uniforms.uTime!.value = this.t;
    this.discMat.uniforms.uPower!.value = power;
    this.rimMat.uniforms.uPower!.value = power;
    this.streakMat.uniforms.uTime!.value = this.t;
    this.streakMat.uniforms.uPower!.value = power;

    this.strength = smoothstep(0, B.growTime, this.t);
    if (this.t >= collapseAt) this.strength = 1.6;
    if (!this.detonated) {
      if (!this.opened && this.t >= 0.4) {
        this.opened = true;
        this.loop = this.kit.ctx.audio.startLoop('blacksun_loop', { position: this.center });
      }
      this.drag(dt);
      render.lights.flash(this.center, '#7a3cff', 14, 34, 0.09);
      this.ring.show(this.ground, B.pullRadius, B.implodeRadius);
      this.ring.setOpacity(0.28 + Math.sin(this.t * 6) * 0.1);
      this.ring.tick(this.t);
    }
    if (!this.detonated && this.t >= endAt) this.implode();
    return this.detonated && this.t >= endAt + 0.1;
  }

  private drag(dt: number): void {
    const { camera, enemies, player, physics, render } = this.kit.ctx;
    const world = this.kit.ctx.time.dt;

    this.bodyDt = world;
    physics.world.intersectionsWithShape(this.center, this.identity, this.ball, this.pullBody, undefined, BODY_FILTER);

    this.crushIn -= dt;
    const crushing = this.crushIn <= 0;
    if (crushing) this.crushIn = 0.15;

    const count = enemies.query(this.center, B.pullRadius, this.near);
    for (let i = 0; i < count; i++) {
      const e = this.near[i]!;
      if (!e.alive) continue;
      _pull.subVectors(this.center, e.position).setY(0);
      const d = _pull.length();
      if (d < 1e-3) continue;
      _pull.divideScalar(d);
      const closeness = 1 - d / B.pullRadius;
      const speed = lerp(B.pullMin, B.pullMax, closeness * closeness) * this.strength;
      if (!e.isBoss) {
        _swirl.crossVectors(_up, _pull);
        e.position.addScaledVector(_pull, speed * world).addScaledVector(_swirl, speed * world * 0.3);
      }
      if (crushing && d < B.crushRadius * 2.2) {
        this.crush.amount = B.crushDamagePerSecond * 0.15 * (d < B.crushRadius ? 3 : 1);
        this.crush.point.copy(e.center);
        this.crush.dir.copy(_pull);
        enemies.applyDamage(e, this.crush);
      }
    }

    // A gentle hand on the player: enough to feel, never enough to stop a dash.
    _pull.subVectors(this.center, player.position);
    const pd = _pull.length();
    if (pd < B.pullRadius && pd > 1) {
      const closeness = 1 - pd / B.pullRadius;
      player.velocity.addScaledVector(_pull.divideScalar(pd), B.playerTug * closeness * this.strength * dt);
      camera.addTrauma(closeness * 0.35 * dt * 6);
      if (Math.random() < 0.25) render.post.radialBlur(closeness * 0.22, 0.2);
    }
  }

  private implode(): void {
    const { audio, camera, combat, fx, physics, render, time, player } = this.kit.ctx;
    this.detonated = true;
    this.group.visible = false;
    this.loop?.stop(0.05);
    this.loop = null;
    this.ring.hide();
    audio.play('blacksun_implode', { position: this.center });
    combat.explode(this.center, {
      radius: B.implodeRadius, damage: 99999, kind: 'nuke', source: 'black_sun', team: 'player',
      instakill: true, selfDamage: 0, playerPush: 30,
    });
    physics.radialImpulse(this.center, B.pullRadius * 1.4, B.implodeImpulse);
    fx.ring(this.center, _up, '#c9a8ff', B.implodeRadius * 2);
    fx.ring(this.center, _pos.set(0.4, 1, 0.2).normalize(), '#ffffff', B.implodeRadius * 1.3);
    fx.heatShimmer(this.center, B.implodeRadius, 1.2);
    render.post.flash('#e8d8ff', 2.2, 0.8);
    render.post.chromatic(1.6, 0.8);
    render.post.radialBlur(0.9, 0.7);
    render.lights.flash(this.center, '#c9a8ff', 140, 90, 0.7);
    render.decals.add('scorch', this.ground, _up, B.implodeRadius * 0.8, 0);
    render.decals.add('crack', this.ground, _up, B.implodeRadius * 0.6, 1);
    camera.fovPunch(-16, 0.18);
    camera.addTrauma(1);
    time.hitStop(0.14, 0.02);
    const d = player.position.distanceTo(this.center);
    if (d < B.pullRadius) camera.kick(0.05, 0, 0.04);
  }

  dispose(): void {
    const { render } = this.kit.ctx;
    this.loop?.stop(0.1);
    this.loop = null;
    render.scene.remove(this.group);
    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
    this.disc.geometry.dispose();
    this.streaks.geometry.dispose();
    this.discMat.dispose();
    this.rimMat.dispose();
    this.streakMat.dispose();
    this.ring.dispose();
  }
}
