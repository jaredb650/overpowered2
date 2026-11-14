/**
 * AC-130: two minutes of a gunship holding a left-hand circle (a pylon turn) over the spot it was called to. It never
 * flies anywhere smart: the circle's centre is fixed for the whole sortie.
 *
 * Tapped, the player takes fire control: four guns on 1 to 4, a second press of 2 or 3 for the round, RMB zoom, R for
 * the view (TV with boxes, white-hot, black-hot), E to hand it to the crew. Held, the crew has it from the start. Either
 * way every round leaves through one Battery, so the crew fires the same guns, magazines and reloads as the player, and
 * switches rounds where it can be seen from the ground. Once handed over there is no way back in.
 *
 * Nothing it fires can touch the player. Every blast takes selfDamage 0 and playerPush 0. It also goes through combat
 * as a `worldObject`, which is the one way to keep a shell from setting off a map barrel, since the barrel's own blast
 * would hurt. That flag leaves the look and the sound to the caller, so each round gets its own, and no ExplosionKind
 * had to be added for them. White phosphorus sets enemies alight and nothing else; the flak's pellets are player rays.
 */
import * as THREE from 'three';
import type { Action, Ctx, ExplosionKind, ExplosionOptions, PlayOptions } from '../../core/contracts';
import type { EnemyInstance, ExplosionSpec, KillEvent, ShotSpec } from '../../core/gameplay';
import { clamp, rand, TAU } from '../../core/math';
import type { GunnerWeapon } from '../../vehicles/hud';
import { GunnerSeat, type SeatRig } from '../../vehicles/seat';
import { CALLINS } from '../data';
import type { ModelMaterials } from '../modelkit';
import { Airframe, EngineSound, OrbitPath } from './airframe';
import { AC130 as A } from './ac130Data';
import { Battery, FireControl, GUN_ORDER } from './ac130Guns';
import { AC130_AIRFRAME, type Ac130Mount } from './ac130Model';
import { Crash } from './crash';
import { AIR, Ac130Rounds, flakCone, type ImpactKind } from './ac130Rounds';
import { GroundProbe, GroundRing } from './ground';
import { Radio } from './radio';
import { FLARE_LOCKOUT, type Aircraft, type StrikeKit, type StrikeOrder } from './shared';

const UP = new THREE.Vector3(0, 1, 0);
/** Metres a blast stands off a wall, so its line-of-sight rays do not start inside it. */
const WALL_STANDOFF = 0.5;
/** How far the ring is lifted over its resting glow on arrival, and how fast that dies away. */
const RING_REST = 0.22;
const RING_PULSE = 0.45;
const RING_DECAY = 1.6;
/** Where the camera rides behind the ship while it flies in, in the airframe's own units. */
const CHASE: readonly [number, number, number] = [26, 14, -70];
/** Seconds into the flight in that the view cuts from the chase to the sensor, a few before the ship is on station. */
const SIT_AT = 5;
/** Share of the way from the sensor to the spot that the drawn laser starts. */
const LASER_START = 0.15;
/** How far from the bomb the ground still feels it. */
const BOMB_FELT = 160;
const WEAPON_KEYS: readonly Action[] = ['weapon1', 'weapon2', 'weapon3', 'weapon4'];

const G = A.gatling;
const B = A.bofors;
const H = A.howitzer;
const M = A.bomb;
const WP = H.wp;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _at = new THREE.Vector3();
const _side = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _chase = new THREE.Vector3();
const _sound: PlayOptions = {};
const _look: ExplosionOptions = { radius: 1 };
const _pellets = Array.from({ length: B.flak.pellets }, () => new THREE.Vector3());
const _near: EnemyInstance[] = [];

/** The blast each round leaves. `kind` here sets damage falloff, gibbing and shake. Looks are in `Ac130.impact`. */
function blast(kind: ExplosionKind, source: string, radius: number, damage: number, shake: number): ExplosionSpec {
  return { kind, source, radius, damage, shake, team: 'player', selfDamage: 0, playerPush: 0, worldObject: true };
}

const BLASTS: Readonly<Record<ImpactKind, ExplosionSpec>> = {
  g25: blast('hellfireBullet', 'ac130_25mm', G.radius, G.damage, 0.005),
  g40: blast('shell', 'ac130_40mm', B.he.radius, B.he.damage, 0.02),
  ap: blast('shell', 'ac130_40mm_ap', B.ap.radius, B.ap.damage, 0.02),
  flak: blast('shell', 'ac130_flak', B.flak.radius, B.flak.damage, 0.02),
  g105: blast('finisher', 'ac130_105mm', H.radius, H.damage, 0.2),
  wp: blast('shell', 'ac130_wp', WP.radius, WP.damage, 0.08),
  bomb: { ...blast('finisher', 'ac130_bomb', M.radius, M.damage, M.shake), instakill: true },
};

const PELLET: ShotSpec = {
  damage: B.flak.pelletDamage, source: 'ac130_flak', team: 'player', maxDistance: B.flak.reach, force: 14, severMult: 2.2, impactScale: 1.4,
};

interface View {
  name: string;
  grade: 'thermal' | null;
  filter: string;
  enemyColor: string;
  boxes: boolean;
}

/** The views only change the look. Every one shows every enemy: by the boxes, or by the heat through the walls. */
const VIEWS: readonly View[] = [
  { name: 'TV', grade: null, filter: '', enemyColor: A.seat.enemyColor, boxes: true },
  { name: 'WHITE HOT', grade: 'thermal', filter: 'grayscale(1) contrast(1.3)', enemyColor: '#ffffff', boxes: false },
  { name: 'BLACK HOT', grade: 'thermal', filter: 'grayscale(1) contrast(1.3) invert(1)', enemyColor: '#ffffff', boxes: false },
];

/** The one airframe and the rounds in flight, built at load like the Warthog's jet. */
export class Ac130Rig {
  readonly airframe: Airframe<Ac130Mount>;
  readonly rounds: Ac130Rounds;
  /** The ground as the guns see it from outside the map: through its invisible containment, as the rounds go. */
  readonly probe: GroundProbe;
  /**
   * Men with their hands up, by uid. The crew holds fire on them: killing a prisoner pays the player a perk, and that
   * has to stay the player's own decision. Kept here because some will have surrendered before the ship was called.
   */
  readonly prisoners = new Set<number>();

  constructor(ctx: Ctx, materials: ModelMaterials) {
    this.airframe = new Airframe(materials, ctx.render.scene, AC130_AIRFRAME);
    this.rounds = new Ac130Rounds(ctx, materials);
    this.probe = new GroundProbe(ctx, AIR);
    ctx.events.on('enemy:surrendered', e => this.prisoners.add(e.enemy.uid));
    ctx.events.on('run:start', () => this.prisoners.clear());
  }

  get shaders(): readonly THREE.Material[] {
    return this.airframe.shaders;
  }
}

interface Cloud {
  point: THREE.Vector3;
  age: number;
  puffIn: number;
}

/**
 * White phosphorus: a cloud that burns where the shell landed. Anyone who walks into it is set alight, as by the
 * Burner's fire, and burns on after leaving it. It never looks for the player: the player can walk through it.
 */
export class Phosphorus {
  private readonly clouds: Cloud[] = [];

  constructor(private readonly ctx: Ctx) {}

  add(point: THREE.Vector3): void {
    this.clouds.push({ point: point.clone(), age: 0, puffIn: 0 });
  }

  get count(): number {
    return this.clouds.length;
  }

  update(dt: number): void {
    const { enemies, fx } = this.ctx;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i]!;
      c.age += dt;
      if (c.age >= WP.seconds) {
        this.clouds.splice(i, 1);
        continue;
      }
      // It thins out over its last third, and so does the fire in it.
      const left = clamp((WP.seconds - c.age) / (WP.seconds / 3));
      const r = WP.cloud * (0.6 + 0.4 * Math.min(1, c.age / 1.5));
      c.puffIn -= dt;
      if (c.puffIn <= 0) {
        c.puffIn = WP.puffEvery;
        _at.set(c.point.x + rand(-r, r) * 0.6, c.point.y + rand(0.5, 3), c.point.z + rand(-r, r) * 0.6);
        fx.smoke(_at, 0xf4f6f8, r * rand(0.75, 1.1) * (0.4 + 0.6 * left), rand(2.5, 4));
        if (Math.random() < left) fx.embers(_at, 3, r * 0.4);
      }
      const n = enemies.query(c.point, r * left + 0.5, _near) || 0;
      for (let k = 0; k < n; k++) {
        const e = _near[k]!;
        if (e.alive && Math.abs(e.position.y - c.point.y) < r) e.burning = Math.max(e.burning, WP.burn);
      }
    }
  }

  clear(): void {
    this.clouds.length = 0;
  }
}

export class Ac130 implements Aircraft {
  readonly sources = 'ac130';
  readonly drawsFlares = true;
  hits: number = A.armour.hits;
  flares: number = A.armour.flares;
  rounds = 0;
  private flareLock = 0;
  private readonly flareRow: GunnerWeapon = { name: 'FLARES', ammo: A.armour.flares, max: A.armour.flares, reload: -1 };
  private crash: Crash | null = null;
  private t = 0;
  private countdownAt = 0;
  private pairsLeft = A.flares.pairs;
  private flareIn = 0;
  private pulse = 1;
  private confirmed = 0;
  private recentKills = 0;
  private killWindow = 0;
  private praiseIn = 0;
  private onStation = false;
  private offStation = false;
  private view = 0;
  /** The crew has the guns. Once true it stays true. */
  private ai: boolean;

  private readonly path = new OrbitPath(A.orbit);
  private readonly ring: GroundRing;
  private readonly radio: Radio;
  private readonly engines: EngineSound;
  private readonly battery: Battery;
  private readonly crew: FireControl;
  private readonly phosphorus: Phosphorus;
  private readonly seat: GunnerSeat;
  private readonly stopListening: () => void;
  private readonly radius = CALLINS.ac130.radius;
  private readonly color = CALLINS.ac130.color;

  constructor(private readonly kit: StrikeKit, order: StrikeOrder, private readonly rig: Ac130Rig, private readonly seats: SeatRig, ai: boolean) {
    const { ctx } = kit;
    this.ai = ai;
    this.path.begin(order.point, this.arrivalAngle(order.point));
    this.ring = new GroundRing(ctx);
    this.ring.setColor(this.color, 1.6);
    this.radio = new Radio(ctx, A.callsign, this.color);
    this.engines = new EngineSound(ctx, A.engine);
    this.battery = new Battery(ctx, rig.probe, rig.airframe, rig.rounds);
    this.crew = new FireControl(ctx, this.battery, rig.airframe, this.path.center, this.radius, this.radio, rig.prisoners);
    this.phosphorus = new Phosphorus(ctx);
    this.seat = new GunnerSeat(ctx, seats, A.seat);
    this.seat.weapons.push(...this.battery.weapons, this.flareRow);
    rig.rounds.onImpact = (kind, point, normal, dir) => this.impact(kind, point, normal, dir);
    this.stopListening = ctx.events.on('enemy:killed', e => this.onKill(e));
    this.engines.start(3);
    ctx.audio.play('walkietalkie_fire');
    this.radio.say(ai ? 'COPY YOUR MARK. INBOUND. WE HAVE THE GUNS.' : 'INBOUND. FIRE CONTROL IS YOURS.');
    this.fly();
    if (!ai) {
      this.seat.board();
      this.chase();
    }
  }

  /** Joins the circle on the far side of the mark from the player, in front of them as they look at it. */
  private arrivalAngle(point: THREE.Vector3): number {
    const { player } = this.kit.ctx;
    const dx = point.x - player.position.x;
    const dz = point.z - player.position.z;
    return dx * dx + dz * dz > 1 ? Math.atan2(dz, dx) : Math.atan2(player.forward.z, player.forward.x);
  }

  get position(): THREE.Vector3 {
    return this.rig.airframe.root.position;
  }

  get flown(): boolean {
    return !this.ai && this.seat.stage !== 'left';
  }

  get autoFlares(): boolean {
    return !this.flown;
  }

  get huntable(): boolean {
    return !this.crash && !this.offStation;
  }

  hit(): boolean {
    if (this.crash) return false;
    if (--this.hits > 0) {
      this.radio.say(this.hits === 1 ? 'HIT AGAIN. WE CANNOT TAKE ANOTHER.' : 'WE ARE HIT. NUMBER TWO ENGINE IS OUT.');
      if (this.flown) this.kit.ctx.camera.addTrauma(0.6);
      return false;
    }
    this.down();
    return true;
  }

  /** Bullets cannot reach it up here. */
  shot(): boolean {
    return false;
  }

  /** Shot down: the seat is empty at once, and the ship noses over and falls in toward the circle's middle. */
  down(): void {
    if (this.crash) return;
    const { path, rig, seats } = this;
    const C = A.crash;
    this.hits = 0;
    this.offStation = true;
    this.seat.leave();
    this.battery.silence();
    this.engines.stop(3);
    this.ring.hide();
    rig.rounds.laserOn = false;
    this.radio.say('MAYDAY. MAYDAY. SPECTRE IS GOING DOWN.');
    const { position } = rig.airframe.root;
    _vel.subVectors(path.center, position).setY(0).normalize().multiplyScalar(C.inward);
    path.heading(this.t, _fwd);
    _vel.addScaledVector(_fwd, C.along);
    this.crash = new Crash(this.kit.ctx, rig.airframe.root, _vel, (x, z) => seats.skyline.ground(x, z), C, 'ac130_crash');
  }

  /** The flare key: a pair of fans of flares, if there are any left and the last pop is far enough behind. */
  popFlares(): boolean {
    if (this.crash || this.flares <= 0 || this.flareLock > 0) return false;
    this.flares--;
    this.flareLock = FLARE_LOCKOUT;
    this.dropFlares();
    this.kit.ctx.audio.play('flame_ignite', { volume: 0.8, pitch: 1.3, position: this.flown ? undefined : this.position });
    return true;
  }

  private fly(): void {
    const { path, rig, t } = this;
    path.at(t, _pos);
    path.heading(t, _fwd);
    rig.airframe.fly(_pos, _fwd, path.roll(t));
  }

  update(dt: number): boolean {
    if (this.crash) {
      this.radio.update(dt);
      this.rig.airframe.update(dt * 0.4);
      this.rig.rounds.update(this.kit.ctx.time.dt);
      this.phosphorus.update(this.kit.ctx.time.dt);
      this.throwFlares(dt);
      return this.crash.update(dt) && this.rig.rounds.idle && this.phosphorus.count === 0;
    }
    this.t += dt;
    this.flareLock = Math.max(0, this.flareLock - dt);
    this.flareRow.ammo = this.flares;
    this.flareRow.reload = this.flareLock > 0 ? 1 - this.flareLock / FLARE_LOCKOUT : -1;
    const { path, rig, t, seat, battery } = this;
    this.fly();
    rig.airframe.update(dt);
    this.engines.update(_pos, this.swell(t), dt, this.kit.ctx.render.camera.position);
    this.radio.update(dt);
    rig.rounds.update(this.kit.ctx.time.dt);
    this.phosphorus.update(this.kit.ctx.time.dt);

    if (!this.ai && seat.stage === 'left') this.handOver();
    if (t >= path.holdsFrom && !this.onStation) this.arrive();
    battery.seated = seat.stage === 'seated';
    battery.update(dt);
    if (this.onStation && !this.offStation) {
      if (t >= path.holdsUntil) this.leave();
      else this.station(dt, t - path.holdsFrom);
    }
    if (!this.ai && seat.stage !== 'left') this.ride(dt);
    // From a little way down the beam: a line that starts at the seat's own eye clips the near plane into a streak.
    rig.airframe.mount('sensor', rig.rounds.laserFrom).lerp(rig.rounds.laser, LASER_START);
    rig.rounds.laserOn = battery.guiding;
    this.drawRing(dt);
    this.throwFlares(dt);
    return t >= path.ends && rig.rounds.idle && this.phosphorus.count === 0;
  }

  /** Around each lap the drone comes and goes. Wind and the turn do this to a real one, and it says "circling" with the eyes shut. */
  private swell(t: number): number {
    return 1 + A.engine.swell * Math.sin(t * A.orbit.rate);
  }

  private chase(): void {
    const { root } = this.rig.airframe;
    _chase.set(CHASE[0], CHASE[1], CHASE[2]).applyQuaternion(root.quaternion).add(root.position);
    this.seat.chase(_chase, root.position);
  }

  /** The seat, while the player is in it: the view rides the sensor, and the clock is the time left on station. */
  private ride(dt: number): void {
    const { seat, rig, path } = this;
    rig.airframe.mount('sensor', _pivot);
    if (seat.stage === 'boarding') {
      this.chase();
      if (this.t < SIT_AT) return;
      seat.sit(path.center, _pivot);
      this.setView(0);
    }
    seat.update(dt, rig.airframe.root.quaternion, _pivot);
    seat.left = Math.max(0, path.holdsUntil - this.t);
    seat.altitude = _pivot.y - path.center.y;
    if (seat.stage === 'seated') this.control();
  }

  private control(): void {
    const { audio, input } = this.kit.ctx;
    const { battery, seat } = this;
    if (input.pressed('interact')) {
      seat.leave();
      return;
    }
    if (input.pressed('jump')) this.popFlares();
    for (let i = 0; i < WEAPON_KEYS.length; i++) {
      if (!input.pressed(WEAPON_KEYS[i]!)) continue;
      const gun = GUN_ORDER[i]!;
      if (battery.selected !== gun) {
        battery.selected = gun;
        audio.play('reload_bolt', { volume: 0.5, pitch: 1.2 });
      } else if (battery.cycle(gun)) {
        audio.play('ui_toggle');
      }
    }
    if (input.pressed('reload')) {
      this.setView((this.view + 1) % VIEWS.length);
      audio.play('ui_click');
    }
    if (input.isDown('fire')) {
      switch (battery.selected) {
        case 'g25': battery.fire25(seat.point, G.spread); break;
        case 'g40': battery.fire40(seat.point, B.spread); break;
        case 'g105': battery.fire105(seat.point); break;
        case 'bomb': if (input.pressed('fire') && battery.dropBomb(seat.point)) this.radio.say('BOMB AWAY. STEER IT IN.'); break;
      }
    }
    // The laser is the middle of the screen, all the way down.
    if (battery.guiding) battery.laser.copy(seat.point);
  }

  private setView(index: number): void {
    const v = VIEWS[index]!;
    this.view = index;
    this.seat.look(v.grade, v.filter, v.enemyColor);
    this.seat.boxes = v.boxes;
    this.seat.status = v.name;
  }

  /** The seat is empty with time left on station: the crew takes the guns. */
  private handOver(): void {
    this.ai = true;
    this.battery.silence();
    if (!this.offStation) this.radio.say('COPY. WE HAVE THE GUNS.');
  }

  private arrive(): void {
    this.onStation = true;
    if (this.ai) this.kit.ctx.hud.banner('SPECTRE ON STATION', 'TWO MINUTES OVER THE MARK', this.color);
    this.kit.ctx.audio.play('airstrike_activate', { volume: 0.7 });
    this.radio.say('ON STATION. GUNS HOT.');
    this.dropFlares();
  }

  private station(dt: number, seconds: number): void {
    const { countdown } = A;
    const left = A.orbit.holdSeconds - seconds;
    if (this.countdownAt < countdown.length && left <= countdown[this.countdownAt]![0]) {
      this.radio.say(countdown[this.countdownAt++]![1]);
    }
    if (this.ai) this.crew.update(dt, seconds);
    this.killWindow -= dt;
    this.praiseIn -= dt;
    if (this.killWindow <= 0) this.recentKills = 0;
  }

  private leave(): void {
    const { audio, hud } = this.kit.ctx;
    this.offStation = true;
    this.seat.leave();
    this.battery.silence();
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
    this.pairsLeft = A.flares.pairs;
    this.flareIn = 0;
  }

  /** A pair at a time, thrown out and down from both sides, the wings of flame that every gunship photo is of. */
  private throwFlares(dt: number): void {
    if (this.pairsLeft <= 0) return;
    this.flareIn -= dt;
    if (this.flareIn > 0) return;
    this.flareIn = A.flares.gap;
    this.pairsLeft--;
    const { airframe, rounds } = this.rig;
    _side.set(_fwd.z, 0, -_fwd.x).normalize();
    for (const s of [1, -1]) {
      airframe.mount(s > 0 ? 'flareLeft' : 'flareRight', _at);
      _vel.copy(_fwd).multiplyScalar(14).addScaledVector(_side, s * A.flares.speed * rand(0.75, 1.1));
      _vel.y -= rand(4, 10);
      rounds.flare(_at, _vel);
    }
  }

  private impact(kind: ImpactKind, point: THREE.Vector3, normal: THREE.Vector3 | null, dir: THREE.Vector3): void {
    const { combat } = this.kit.ctx;
    _at.copy(point);
    if (normal) _at.addScaledVector(normal, WALL_STANDOFF);
    // Over the walls of the room it lands in, so they do not shelter the men round it.
    if (kind === 'g105' || kind === 'bomb') _at.y += H.burstHeight;
    combat.explode(_at, BLASTS[kind]);
    switch (kind) {
      case 'g25': this.hit25(point, normal); break;
      case 'g40': this.hit40(point, normal); break;
      case 'ap': this.hitAp(point, normal); break;
      case 'flak': this.hitFlak(point, dir); break;
      case 'g105': this.hit105(point, normal); break;
      case 'wp': this.hitWp(point, normal); break;
      case 'bomb': this.hitBomb(point, normal); break;
    }
  }

  private boom(point: THREE.Vector3, normal: THREE.Vector3 | null, kind: ExplosionKind, radius: number, scale: number): void {
    _look.kind = kind;
    _look.radius = radius;
    _look.scale = scale;
    _look.normal = normal ?? undefined;
    this.kit.ctx.fx.explosion(point, _look);
  }

  private playAt(id: string, point: THREE.Vector3, volume: number, pitch = 1): void {
    _sound.position = point;
    _sound.volume = volume;
    _sound.pitch = pitch;
    this.kit.ctx.audio.play(id, _sound);
  }

  private hit25(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    this.boom(point, normal, 'hellfireBullet', G.radius, 0.7);
    this.playAt('hellfirebullet_explode', point, 0.8);
  }

  private hit40(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { fx } = this.kit.ctx;
    this.boom(point, normal, 'shell', B.he.radius, 1);
    fx.ring(point, normal ?? UP, '#ffb040', B.he.radius * 1.5);
    this.playAt('30mmshell_explode', point, 0.9);
  }

  /** Small where it stops: the work was getting there. */
  private hitAp(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { fx } = this.kit.ctx;
    this.boom(point, normal, 'hellfireBullet', B.ap.radius, 1.1);
    fx.sparks(point, normal ?? UP, 24, '#cfe4ff');
    this.playAt('30mmshell_explode', point, 0.8, 1.25);
  }

  /** An air burst, and a cone of heavy pellets thrown on down the line it was flying. */
  private hitFlak(point: THREE.Vector3, dir: THREE.Vector3): void {
    const { combat, fx } = this.kit.ctx;
    this.boom(point, null, 'shell', B.flak.radius, 0.8);
    fx.ring(point, dir, '#ff7030', B.flak.radius * 2);
    this.playAt('30mmshell_explode', point, 1, 0.8);
    this.playAt('shotgun_fire', point, 0.7, 0.6);
    flakCone(dir, B.flak.cone, _pellets);
    for (let i = 0; i < _pellets.length; i++) {
      PELLET.tracer = i % 3 === 0 ? 'heavy' : undefined;
      combat.fireRay(point, _pellets[i]!, PELLET);
    }
  }

  private hit105(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { audio, fx, player, render } = this.kit.ctx;
    const R = H.radius;
    this.boom(point, normal, 'hellfire', R, 0.55);
    fx.ring(point, normal ?? UP, '#ffaa00', R * 2.4);
    fx.heatShimmer(point, R, 1.6);
    // A column of smoke that stays, so the box looks more wrecked with every shell.
    fx.smoke(point, 0x2c3036, R * 0.8, 16);
    render.lights.flash(point, '#ffa040', 70, 55, 0.5);
    render.decals.add('crack', point, normal ?? UP, R * 0.8, rand(0, TAU));
    audio.layer([{ id: 'hellfirerocket_explode' }, { id: 'explosion_tank', volume: 0.8 }], { position: point });
    const near = clamp(1 - player.position.distanceTo(point) / 70);
    if (near > 0) render.post.flash('#ffc890', 0.4 * near * near, 0.2);
  }

  /** A smaller blast, white streamers arcing out of it, and the cloud that burns on. */
  private hitWp(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { fx, render } = this.kit.ctx;
    this.boom(point, normal, 'shell', WP.radius, 1.2);
    fx.ring(point, normal ?? UP, '#ffffff', WP.radius * 2);
    render.lights.flash(point, '#f4f8ff', 40, 30, 0.6);
    for (let i = 0; i < WP.streamers; i++) {
      const a = (i / WP.streamers) * TAU + rand(-0.2, 0.2);
      const out = rand(8, 15);
      _vel.set(Math.cos(a) * out, rand(9, 17), Math.sin(a) * out);
      _at.copy(point).addScaledVector(normal ?? UP, 0.6);
      this.rig.rounds.flare(_at, _vel, 2.4);
    }
    this.phosphorus.add(_at.copy(point).addScaledVector(normal ?? UP, 0.3));
    this.playAt('hellfirebullet_explode', point, 1, 0.7);
    this.playAt('flame_ignite', point, 1);
    this.playAt('char_sizzle', point, 0.8);
  }

  /** One of the biggest blasts in the game, felt across the map. */
  private hitBomb(point: THREE.Vector3, normal: THREE.Vector3 | null): void {
    const { audio, camera, fx, player, render } = this.kit.ctx;
    const R = M.radius;
    this.boom(point, normal, 'finisher', R, 1.6);
    this.boom(point, normal, 'hellfire', R * 0.6, 1);
    fx.ring(point, normal ?? UP, '#ffd080', R * 2.6);
    fx.ring(point, UP, '#ff8a30', R * 1.6);
    fx.heatShimmer(point, R, 3);
    fx.smoke(point, 0x2a2e33, R * 1.1, 22);
    fx.chips(point, '#ffb050', 60, true);
    render.lights.flash(point, '#ffb060', 140, 110, 0.9);
    render.decals.add('scorch', point, normal ?? UP, R * 0.9, rand(0, TAU));
    audio.layer([{ id: 'hellfirerocket_explode' }, { id: 'explosion_tank' }, { id: 'explosion_distant', volume: 0.9, pitch: 0.7 }], { position: point });
    const near = clamp(1 - player.position.distanceTo(point) / BOMB_FELT);
    camera.addTrauma(this.seat.stage === 'seated' ? 0.9 : 0.25 + near);
    if (near > 0) render.post.flash('#ffe0b0', 0.7 * near, 0.3);
    this.radio.say('SPLASH ONE. GOOD HIT.');
  }

  dispose(): void {
    const { rig } = this;
    this.seat.leave(true);
    this.battery.silence();
    this.engines.stop(1.2);
    this.stopListening();
    this.ring.dispose();
    this.phosphorus.clear();
    this.crash?.dispose();
    rig.airframe.hide();
    rig.rounds.clear();
  }
}
