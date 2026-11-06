/**
 * AC-130: two minutes of a gunship circling a marked box while the player keeps fighting underneath it. Where the other
 * strikes are one event, this one is a siege, so it opens with a single gun and adds the next every half minute or so
 * until everything is firing at once. See ac130Data.ts for the timeline.
 *
 * Nothing it fires can touch the player. Every blast takes selfDamage 0 and playerPush 0. It also goes through combat
 * as a `worldObject`, which is the one way to keep a shell from setting off a map barrel, since the barrel's own blast
 * would hurt. That flag leaves the look and the sound to the caller, so each gun gets its own, and no ExplosionKind had
 * to be added for them.
 */
import * as THREE from 'three';
import type { Ctx, ExplosionKind, ExplosionOptions, PlayOptions } from '../../core/contracts';
import type { ExplosionSpec, KillEvent } from '../../core/gameplay';
import { clamp, rand, TAU } from '../../core/math';
import { CALLINS } from '../data';
import type { ModelMaterials } from '../modelkit';
import { Airframe, EngineSound, OrbitPath } from './airframe';
import { AC130 as A, type SiegePhase } from './ac130Data';
import { FireControl } from './ac130Guns';
import { AC130_AIRFRAME, type Ac130Mount } from './ac130Model';
import { Ac130Rounds, type ImpactKind } from './ac130Rounds';
import { GroundRing } from './ground';
import { Radio } from './radio';
import type { Strike, StrikeKit, StrikeOrder } from './shared';

const UP = new THREE.Vector3(0, 1, 0);
/** Metres a blast stands off a wall, so its line-of-sight rays do not start inside it. */
const WALL_STANDOFF = 0.5;
/** How far the ring is lifted over its resting glow by a new stage of the siege, and how fast that dies away. */
const RING_REST = 0.14;
const RING_PULSE = 0.5;
const RING_DECAY = 1.6;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _at = new THREE.Vector3();
const _side = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _sound: PlayOptions = {};
const _look: ExplosionOptions = { radius: 1 };

/** The blast each weapon leaves. `kind` here sets damage falloff, gibbing and shake. Looks are in `Ac130.impact`. */
function blast(kind: ExplosionKind, source: string, radius: number, damage: number, shake: number): ExplosionSpec {
  return { kind, source, radius, damage, shake, team: 'player', selfDamage: 0, playerPush: 0, worldObject: true };
}

const BLASTS: Readonly<Record<ImpactKind, ExplosionSpec>> = {
  g25: blast('hellfireBullet', 'ac130_25mm', A.gatling.radius, A.gatling.damage, 0.005),
  g40: blast('shell', 'ac130_40mm', A.bofors.radius, A.bofors.damage, 0.02),
  g105: blast('finisher', 'ac130_105mm', A.howitzer.radius, A.howitzer.damage, 0.2),
  hellfire: blast('finisher', 'ac130_hellfire', A.hellfire.radius, A.hellfire.damage, 0.1),
};

/** The one airframe and the rounds in flight, built at load like the Warthog's jet. */
export class Ac130Rig {
  readonly airframe: Airframe<Ac130Mount>;
  readonly rounds: Ac130Rounds;
  /**
   * Men with their hands up, by uid. The crew holds fire on them: killing a prisoner pays the player a perk, and that
   * has to stay the player's own decision. Kept here because some will have surrendered before the ship was called.
   */
  readonly prisoners = new Set<number>();

  constructor(ctx: Ctx, materials: ModelMaterials) {
    this.airframe = new Airframe(materials, ctx.render.scene, AC130_AIRFRAME);
    this.rounds = new Ac130Rounds(ctx, materials);
    ctx.events.on('enemy:surrendered', e => this.prisoners.add(e.enemy.uid));
    ctx.events.on('run:start', () => this.prisoners.clear());
  }

  get shaders(): readonly THREE.Material[] {
    return this.airframe.shaders;
  }
}

export class Ac130 implements Strike {
  private t = 0;
  private phaseAt = -1;
  private phase: SiegePhase = A.phases[0]!;
  private countdownAt = 0;
  private flareClock = 0;
  private flaresLeft = A.flares.pairs;
  private flareIn = 0;
  private pulse = 1;
  private confirmed = 0;
  private recentKills = 0;
  private killWindow = 0;
  private praiseIn = 0;
  private onStation = false;
  private offStation = false;

  private readonly path = new OrbitPath(A.orbit);
  private readonly ring: GroundRing;
  private readonly radio: Radio;
  private readonly engines: EngineSound;
  private readonly guns: FireControl;
  private readonly stopListening: () => void;
  private readonly radius = CALLINS.ac130.radius;
  private readonly color = CALLINS.ac130.color;

  constructor(private readonly kit: StrikeKit, order: StrikeOrder, private readonly rig: Ac130Rig) {
    const { ctx } = kit;
    this.path.begin(order.point, this.arrivalAngle(order.point));
    this.ring = new GroundRing(ctx);
    this.ring.setColor(this.color, 1.6);
    this.radio = new Radio(ctx, A.callsign, this.color);
    this.engines = new EngineSound(ctx, A.engine);
    this.guns = new FireControl(ctx, kit.probe, rig.airframe, rig.rounds, this.path.center, this.radius, this.radio, rig.prisoners);
    rig.rounds.onImpact = (kind, point, normal) => this.impact(kind, point, normal);
    this.stopListening = ctx.events.on('enemy:killed', e => this.onKill(e));
    this.engines.start(3);
    ctx.audio.play('walkietalkie_fire');
    this.radio.say('COPY YOUR MARK. INBOUND.');
  }

  /** Joins the circle on the far side of the mark from the player, in front of them as they look at it. */
  private arrivalAngle(point: THREE.Vector3): number {
    const { player } = this.kit.ctx;
    const dx = point.x - player.position.x;
    const dz = point.z - player.position.z;
    return dx * dx + dz * dz > 1 ? Math.atan2(dz, dx) : Math.atan2(player.forward.z, player.forward.x);
  }

  update(dt: number): boolean {
    this.t += dt;
    const { path, rig, t } = this;
    path.at(t, _pos);
    path.heading(t, _fwd);
    rig.airframe.fly(_pos, _fwd, path.roll(t));
    rig.airframe.update(dt);
    this.engines.update(_pos, this.swell(t), dt);
    this.radio.update(dt);
    rig.rounds.update(this.kit.ctx.time.dt);

    if (t >= path.holdsFrom && !this.onStation) this.arrive();
    if (this.onStation && !this.offStation) {
      if (t >= path.holdsUntil) this.leave();
      else this.siege(dt, t - path.holdsFrom);
    }
    this.drawRing(dt);
    this.flares(dt);
    return t >= path.ends && rig.rounds.idle;
  }

  /** Around each lap the drone comes and goes. Wind and the turn do this to a real one, and it says "circling" with the eyes shut. */
  private swell(t: number): number {
    return 1 + A.engine.swell * Math.sin(t * A.orbit.rate);
  }

  private arrive(): void {
    this.onStation = true;
    this.kit.ctx.hud.banner('SPECTRE ON STATION', 'TWO MINUTES OVER THE MARK', this.color);
    this.kit.ctx.audio.play('airstrike_activate', { volume: 0.7 });
    this.dropFlares();
  }

  private siege(dt: number, seconds: number): void {
    const { phases, countdown } = A;
    while (this.phaseAt + 1 < phases.length && seconds >= phases[this.phaseAt + 1]!.at) {
      this.phase = phases[++this.phaseAt]!;
      this.radio.say(this.phase.line);
      this.pulse = 1;
    }
    const left = A.orbit.holdSeconds - seconds;
    if (this.countdownAt < countdown.length && left <= countdown[this.countdownAt]![0]) {
      this.radio.say(countdown[this.countdownAt++]![1]);
    }
    this.guns.update(dt, this.phase);

    this.killWindow -= dt;
    this.praiseIn -= dt;
    if (this.killWindow <= 0) this.recentKills = 0;
    this.flareClock += dt;
    if (this.flareClock >= A.flares.every) {
      this.flareClock = 0;
      this.dropFlares();
    }
  }

  private leave(): void {
    const { audio, hud } = this.kit.ctx;
    this.offStation = true;
    this.guns.ceaseFire();
    this.dropFlares();
    this.radio.say('WINCHESTER. RETURNING TO BASE.');
    audio.play('walkietalkie_fire', { volume: 0.7 });
    hud.banner('SPECTRE OFF STATION', `${this.confirmed} CONFIRMED`, this.color);
  }

  private onKill(e: KillEvent): void {
    if (!e.damage.source.startsWith('ac130')) return;
    this.confirmed++;
    this.recentKills++;
    this.killWindow = A.praise.window;
    if (this.recentKills >= A.praise.kills && this.praiseIn <= 0) {
      this.praiseIn = A.praise.every;
      this.radio.say('GOOD EFFECT ON TARGET.');
    }
  }

  private drawRing(dt: number): void {
    if (this.offStation) {
      this.ring.hide();
      return;
    }
    this.pulse = Math.max(0, this.pulse - RING_DECAY * dt);
    this.ring.show(this.path.center, this.radius, 0);
    this.ring.setOpacity(RING_REST + RING_PULSE * this.pulse);
    this.ring.tick(this.t);
  }

  private dropFlares(): void {
    this.flaresLeft = A.flares.pairs;
    this.flareIn = 0;
  }

  /** A pair at a time, thrown out and down from both sides, the wings of flame that every gunship photo is of. */
  private flares(dt: number): void {
    if (this.flaresLeft <= 0) return;
    this.flareIn -= dt;
    if (this.flareIn > 0) return;
    this.flareIn = A.flares.gap;
    this.flaresLeft--;
    const { airframe, rounds } = this.rig;
    _side.set(_fwd.z, 0, -_fwd.x).normalize();
    for (const s of [1, -1]) {
      airframe.mount(s > 0 ? 'flareLeft' : 'flareRight', _at);
      _vel.copy(_fwd).multiplyScalar(14).addScaledVector(_side, s * A.flares.speed * rand(0.75, 1.1));
      _vel.y -= rand(4, 10);
      rounds.flare(_at, _vel);
    }
  }

  private impact(kind: ImpactKind, point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { combat } = this.kit.ctx;
    _at.copy(point);
    if (normal) _at.addScaledVector(normal, WALL_STANDOFF);
    combat.explode(_at, BLASTS[kind]);
    switch (kind) {
      case 'g25': this.hit25(point, normal); break;
      case 'g40': this.hit40(point, normal); break;
      case 'g105': this.hit105(point, normal); break;
      case 'hellfire': this.hitHellfire(point, normal); break;
    }
  }

  private boom(point: THREE.Vector3, normal: THREE.Vector3 | null, kind: ExplosionKind, radius: number, scale: number): void {
    _look.kind = kind;
    _look.radius = radius;
    _look.scale = scale;
    _look.normal = normal ?? undefined;
    this.kit.ctx.fx.explosion(point, _look);
  }

  private playAt(id: string, point: THREE.Vector3, volume: number): void {
    _sound.position = point;
    _sound.volume = volume;
    this.kit.ctx.audio.play(id, _sound);
  }

  private hit25(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    this.boom(point, normal, 'hellfireBullet', A.gatling.radius, 0.7);
    this.playAt('hellfirebullet_explode', point, 0.8);
  }

  private hit40(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { fx } = this.kit.ctx;
    this.boom(point, normal, 'shell', A.bofors.radius, 1);
    fx.ring(point, normal ?? UP, '#ffb040', A.bofors.radius * 1.5);
    this.playAt('30mmshell_explode', point, 0.9);
  }

  private hit105(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { audio, fx, player, render } = this.kit.ctx;
    const R = A.howitzer.radius;
    this.boom(point, normal, 'hellfire', R, 0.55);
    fx.ring(point, normal ?? UP, '#ffaa00', R * 2.4);
    fx.heatShimmer(point, R, 1.6);
    // A column of smoke that stays, so the box looks more wrecked with every salvo.
    fx.smoke(point, 0x2c3036, R * 0.8, 16);
    render.lights.flash(point, '#ffa040', 70, 55, 0.5);
    render.decals.add('crack', point, normal ?? UP, R * 0.8, rand(0, TAU));
    audio.layer([{ id: 'hellfirerocket_explode' }, { id: 'explosion_tank', volume: 0.8 }], { position: point });
    const near = clamp(1 - player.position.distanceTo(point) / 70);
    if (near > 0) render.post.flash('#ffc890', 0.55 * near * near, 0.22);
  }

  private hitHellfire(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { fx, render } = this.kit.ctx;
    this.boom(point, normal, 'rocket', A.hellfire.radius, 1);
    fx.ring(point, normal ?? UP, '#ff8a30', A.hellfire.radius * 2);
    render.lights.flash(point, '#ffa040', 36, 30, 0.35);
    this.playAt('hellfire_rocket_blast', point, 0.9);
  }

  dispose(): void {
    const { rig } = this;
    this.guns.ceaseFire();
    this.engines.stop(1.2);
    this.stopListening();
    this.ring.dispose();
    rig.airframe.hide();
    rig.rounds.clear();
  }
}
