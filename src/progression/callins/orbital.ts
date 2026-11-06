/**
 * Orbital Lance. A pilot laser finds the ground, then a burning beam stands on the map for six seconds and follows the
 * player's aim at a fixed top speed, so it is steered and never teleported.
 */
import * as THREE from 'three';
import type { DamageInfo, LoopHandle } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { rand, TAU } from '../../core/math';
import { CALLINS, ORBITAL as O } from '../data';
import { GroundRing } from './ground';
import { aboveFloor, type Strike, type StrikeKit, type StrikeOrder } from './shared';
import type { Targeting } from './targeting';

const BEAM_VERT = /* glsl */ `
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

const BEAM_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uCore;
uniform vec3 uRim;
uniform float uTime;
uniform float uPower;
varying vec3 vN;
varying vec3 vView;
varying float vY;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float core = pow(facing, 5.0);
  float body = pow(facing, 1.6);
  // Pulses racing down the column sell the energy arriving from orbit.
  float pulse = 0.72 + 0.28 * sin(vY * 0.55 + uTime * 46.0) * sin(vY * 0.17 - uTime * 21.0);
  vec3 c = uRim * body * pulse + uCore * core;
  gl_FragColor = vec4(c * uPower, 1.0);
}`;

const POOL_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uTime;
uniform float uPower;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float ripple = 0.5 + 0.5 * sin(r * 22.0 - uTime * 18.0 + sin(a * 5.0 + uTime * 3.0) * 1.5);
  float fall = smoothstep(1.0, 0.1, r);
  float hot = smoothstep(0.42, 0.0, r);
  vec3 c = uColor * fall * (0.35 + ripple * 0.65) + vec3(1.0, 0.92, 0.85) * hot * 3.0;
  gl_FragColor = vec4(c * uPower, 1.0);
}`;

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function additive(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: false, fog: false,
  });
}

const HOT = new THREE.Color('#ff2fb0').multiplyScalar(3.2);
const WHITE = new THREE.Color('#fff2f8').multiplyScalar(7);
const FIRE = '#ff5a10';

const _up = new THREE.Vector3(0, 1, 0);
const _aim = new THREE.Vector3();
const _step = new THREE.Vector3();
const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Orbital implements Strike {
  private t = 0;
  private ignited = false;
  private finished = false;
  private steered = true;
  private tickIn = 0;
  private scorched = 0;
  private readonly point = new THREE.Vector3();
  private readonly lastScorch = new THREE.Vector3();
  private readonly group = new THREE.Group();
  private readonly column: THREE.Mesh;
  private readonly sheath: THREE.Mesh;
  private readonly pool: THREE.Mesh;
  private readonly columnMat: THREE.ShaderMaterial;
  private readonly poolMat: THREE.ShaderMaterial;
  private readonly ring: GroundRing;
  private hum: LoopHandle | null = null;
  private readonly near: EnemyInstance[] = [];
  private readonly burn: DamageInfo = {
    amount: O.damagePerSecond * O.tick, type: 'fire', point: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0),
    force: 8, source: 'orbital', severMult: 2,
  };

  constructor(private readonly kit: StrikeKit, order: StrikeOrder, private readonly targeting: Targeting) {
    const { ctx, probe } = kit;
    this.point.copy(order.point);
    this.lastScorch.copy(order.point);
    this.ring = new GroundRing(ctx);
    this.ring.setColor(CALLINS.orbital.color, 2);

    this.columnMat = additive(BEAM_VERT, BEAM_FRAG, {
      uCore: { value: WHITE }, uRim: { value: HOT }, uTime: { value: 0 }, uPower: { value: 0 },
    });
    this.poolMat = additive(POOL_VERT, POOL_FRAG, {
      uColor: { value: new THREE.Color(FIRE).multiplyScalar(2.6) }, uTime: { value: 0 }, uPower: { value: 0 },
    });
    const beam = new THREE.CylinderGeometry(1, 1, O.height, 24, 1, true);
    beam.translate(0, O.height / 2, 0);
    this.column = new THREE.Mesh(beam, this.columnMat);
    this.column.scale.set(O.coreRadius, 1, O.coreRadius);
    this.sheath = new THREE.Mesh(beam, this.columnMat);
    this.sheath.scale.set(O.coreRadius * 1.9, 1, O.coreRadius * 1.9);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(CALLINS.orbital.radius * 1.5, 40).rotateX(-Math.PI / 2), this.poolMat);
    this.pool.position.y = 0.14;
    this.column.frustumCulled = this.sheath.frustumCulled = this.pool.frustumCulled = false;
    this.group.add(this.column, this.sheath, this.pool);
    this.group.visible = false;
    ctx.render.scene.add(this.group);
    ctx.audio.play('walkietalkie_fire');
    ctx.audio.play('orbital_charge');
  }

  update(dt: number): boolean {
    this.t += dt;
    const { render, fx } = this.kit.ctx;
    this.steer(dt);
    this.group.position.copy(this.point);

    if (!this.ignited) {
      // The pilot laser: a needle from the sky, thin enough that the ignition feels like a door opening.
      _from.copy(this.point).setY(this.point.y + O.height);
      fx.beam(_from, this.point, 'laser', 0.1, 0.05);
      this.ring.show(this.point, CALLINS.orbital.radius);
      this.ring.setOpacity(0.5 + this.t);
      this.ring.tick(this.t);
      if (this.t >= O.chargeTime) this.ignite();
      return false;
    }

    const burnT = this.t - O.chargeTime;
    const swell = Math.min(1, burnT / 0.12);
    const dying = Math.max(0, burnT - (O.burnTime - 0.4)) / 0.4;
    const power = swell * (1 - dying);
    this.columnMat.uniforms.uTime!.value = this.t;
    this.columnMat.uniforms.uPower!.value = power;
    this.poolMat.uniforms.uTime!.value = this.t;
    this.poolMat.uniforms.uPower!.value = power;
    const width = 1 + Math.sin(this.t * 31) * 0.05 + (1 - swell) * 1.4;
    this.column.scale.set(O.coreRadius * width * (1 - dying * 0.85), 1, O.coreRadius * width * (1 - dying * 0.85));
    this.sheath.scale.set(O.coreRadius * 1.9 * width, 1, O.coreRadius * 1.9 * width);
    this.ring.show(this.point, CALLINS.orbital.radius);
    this.ring.setOpacity(0.5 * power);
    this.ring.tick(this.t);

    render.lights.flash(this.point, '#ff4fb8', 26 * power, 36, 0.09);
    this.tickIn -= dt;
    if (this.tickIn <= 0) {
      this.tickIn += O.tick;
      this.burnTick();
    }
    if (burnT >= O.burnTime && !this.finished) {
      this.finished = true;
      this.extinguish();
    }
    return this.finished;
  }

  /** The player lets go: the beam stays where it stands and burns out on its own. */
  release(): void {
    this.steered = false;
  }

  private steer(dt: number): void {
    // Never slower than the player can run, so a moving target can always be reached.
    if (!this.steered || !this.targeting.solve(_aim)) return;
    _step.subVectors(_aim, this.point);
    const d = _step.length();
    if (d < 1e-3) return;
    const move = Math.min(d, O.steerSpeed * dt);
    this.point.addScaledVector(_step, move / d);
    this.point.y = _aim.y;
  }

  private ignite(): void {
    const { audio, camera, combat, fx, render, time } = this.kit.ctx;
    this.ignited = true;
    this.group.visible = true;
    this.hum = audio.startLoop('orbital_beam_loop', { position: this.point });
    audio.play('orbital_strike', { position: this.point });
    render.post.flash('#ff6ac8', 0.7, 0.35);
    render.post.chromatic(1.1, 0.5);
    render.post.radialBlur(0.35, 0.35);
    camera.fovPunch(8, 0.4);
    camera.addTrauma(0.7);
    time.hitStop(0.06);
    fx.ring(this.point, _up, CALLINS.orbital.color, 22);
    combat.explode(aboveFloor(this.point), {
      radius: CALLINS.orbital.radius * 1.5, damage: 260, kind: 'plasma', source: 'orbital', team: 'player', selfDamage: 0,
    });
  }

  private burnTick(): void {
    const { camera, enemies, fx, physics, render } = this.kit.ctx;
    const radius = CALLINS.orbital.radius;
    const count = enemies.query(this.point, radius, this.near);
    for (let i = 0; i < count; i++) {
      const e = this.near[i]!;
      if (!e.alive) continue;
      e.burning = Math.max(e.burning, O.burnSeconds);
      this.burn.point.copy(e.center);
      this.burn.dir.subVectors(e.center, this.point).setY(0.6).normalize();
      enemies.applyDamage(e, this.burn);
    }
    physics.radialImpulse(this.point, radius * 1.3, 18);
    camera.addTrauma(0.16);
    fx.embers(this.point, 14, 3.5);
    fx.sparks(this.point, _up, 14, FIRE);
    fx.smoke(_from.copy(this.point).setY(this.point.y + rand(0.5, 3)), '#2a1a1e', 4.5, 2.2);
    fx.heatShimmer(this.point, 6, 0.3);
    if (this.point.distanceToSquared(this.lastScorch) > O.scorchSpacing * O.scorchSpacing || this.scorched === 0) {
      this.lastScorch.copy(this.point);
      this.scorched++;
      render.decals.add('scorch', this.point, _up, 5.5, rand(0, TAU));
    }
    this.hum?.setPosition(this.point);
  }

  private extinguish(): void {
    const { audio, fx } = this.kit.ctx;
    this.hum?.stop(0.25);
    this.hum = null;
    fx.ring(this.point, _dir.set(0, 1, 0), CALLINS.orbital.color, 14);
    audio.play('explosion_distant', { position: this.point });
  }

  dispose(): void {
    this.hum?.stop(0.1);
    this.hum = null;
    this.kit.ctx.render.scene.remove(this.group);
    this.column.geometry.dispose();
    this.pool.geometry.dispose();
    this.columnMat.dispose();
    this.poolMat.dispose();
    this.ring.dispose();
  }
}
