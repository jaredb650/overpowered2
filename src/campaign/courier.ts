/**
 * A courier going down (Foreclosure's beat 6, docs/proposals/mission-2-plan.md): the Bureau's Packmule, crewed, on a fixed flight across
 * the town, the flak tower's guns walking their fire onto it, the hit (a `hit` mark: it burns from there), and at the last mark the
 * crash takes it into the ground. A column of smoke stands over the wreck after, the goal for the next six minutes.
 *
 * Raises `war:hit` at the hit and `war:downed` once it is in the ground. Everything it draws is a look: the flak hurts nobody.
 */
import * as THREE from 'three';
import type { Ctx, EmitterHandle } from '../core/contracts';
import { rand } from '../core/math';
import type { Flight } from '../vehicles/flight';
import type { Mark } from './types';

/** Seconds between a gun's rounds, and between airbursts round the courier. The aim closes from `miss` metres to a third of it. */
const FLAK = { gap: 0.14, burst: 0.45, miss: 26, lead: 0.5 } as const;
/** Seconds the fall is given before the wreck is called down whatever the crash is doing. */
const FALL = 6;
/** Seconds the smoke column stands: long enough for the stacks and the quay. */
const SMOKE_SECONDS = 900;

interface Ship {
  down(): void;
  readonly position: THREE.Vector3;
}

interface Courierable {
  flyFlight(flight: Flight): Ship;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Courier {
  private ship: Ship | null = null;
  private guns: THREE.Vector3[] = [];
  private wreck = new THREE.Vector3();
  private clock = 0;
  private gunIn = 0;
  private burstIn = 0;
  private fallAt = -1;
  private hit = false;
  private readonly last = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private smoke: EmitterHandle | null = null;
  private readonly smokeAt = new THREE.Object3D();

  constructor(private readonly ctx: Ctx, private readonly signal: (name: string) => void) {}

  /** Off along `route`, shot at from `flak`, down onto `wreck`. */
  fly(route: readonly Mark[], flak: readonly Mark[], wreck: Mark): void {
    this.clear();
    const names = route.map((_, i) => `courier${i}`);
    const end = names[names.length - 1];
    this.guns = flak.map(m => new THREE.Vector3(m.at[0], m.at[1] + 1.6, m.at[2]));
    this.wreck.set(...wreck.at);
    this.ship = (this.ctx.progression as unknown as Courierable).flyFlight({
      marks: route.map((m, i) => ({ x: m.at[0], y: m.at[1], z: m.at[2], hold: 0, name: names[i]!, hit: m.hit ?? false })),
      reached: name => {
        if (route[names.indexOf(name)]?.hit) {
          this.hit = true;
          this.signal('war:hit');
        }
        // `down` waits a frame: the aircraft is in the middle of its own update here.
        if (name === end) this.fallAt = this.clock;
      },
    });
    this.last.copy(this.ship.position);
  }

  /** The column of smoke over the wreck, for a beat that opens after it fell. */
  burn(at: Mark): void {
    if (this.smoke) return;
    this.smokeAt.position.set(at.at[0], at.at[1] + 1, at.at[2]);
    this.ctx.render.scene.add(this.smokeAt);
    this.smoke = this.ctx.fx.attachEmitter(this.smokeAt, 'fireTrail', undefined, SMOKE_SECONDS);
  }

  update(dt: number): void {
    const ship = this.ship;
    if (!ship) return;
    this.clock += dt;
    if (dt > 0) this.velocity.subVectors(ship.position, this.last).divideScalar(dt);
    this.last.copy(ship.position);
    if (this.fallAt >= 0) {
      if (this.clock - dt <= this.fallAt) ship.down();
      if (this.clock - this.fallAt >= FALL) this.landed();
      return;
    }
    this.flak(dt);
  }

  /** The tower's four guns, walking onto it, and airbursts round it. */
  private flak(dt: number): void {
    const { audio, fx } = this.ctx;
    const ship = this.ship!;
    // The miss closes as it crosses; once it is hit, the guns have it.
    const miss = this.hit ? FLAK.miss * 0.15 : FLAK.miss * Math.max(0.33, 1 - this.clock / 14);
    this.gunIn -= dt;
    if (this.gunIn <= 0 && this.guns.length > 0) {
      this.gunIn = FLAK.gap;
      const gun = this.guns[Math.floor(rand(0, this.guns.length))]!;
      _a.copy(ship.position).addScaledVector(this.velocity, FLAK.lead);
      _a.x += rand(-miss, miss);
      _a.y += rand(-miss, miss) * 0.5;
      _a.z += rand(-miss, miss);
      fx.tracer(gun, _a, 'heavy');
      audio.play('cannon', { position: gun, volume: 0.55, pitchJitter: 0.08 });
    }
    this.burstIn -= dt;
    if (this.burstIn <= 0) {
      this.burstIn = FLAK.burst * rand(0.6, 1.4);
      _b.copy(ship.position).addScaledVector(this.velocity, rand(0, 0.6));
      _b.x += rand(-miss, miss);
      _b.y += rand(-miss, miss) * 0.4;
      _b.z += rand(-miss, miss);
      fx.explosion(_b, { radius: 2.5, kind: 'shell', scale: 0.7 });
      audio.play('flak', { position: _b, volume: 0.8, pitchJitter: 0.1 });
    }
  }

  private landed(): void {
    this.ship = null;
    this.fallAt = -1;
    this.burn({ at: [this.wreck.x, this.wreck.y, this.wreck.z] });
    this.ctx.camera.addTrauma(0.5);
    this.ctx.audio.play('explosion_distant', { position: this.wreck, volume: 1 });
    this.signal('war:downed');
  }

  clear(): void {
    this.ship = null;
    this.clock = this.gunIn = this.burstIn = 0;
    this.fallAt = -1;
    this.hit = false;
    this.smoke?.stop();
    this.smoke = null;
    this.smokeAt.removeFromParent();
  }
}
