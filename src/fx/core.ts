import * as THREE from 'three';
import { CG, type Ctx, type RayHit } from '../core/contracts';
import { buildPuffAtlas } from './gpu/atlas';
import { ArcLayer } from './layers/arcs';
import { ChipLayer } from './layers/chips';
import { FlashLayer } from './layers/flashes';
import { LensLayer } from './layers/lens';
import { LineLayer } from './layers/lines';
import { PuffLayer } from './layers/puffs';
import { RingLayer } from './layers/rings';
import { hot, makeUniforms, type FxUniforms } from './layers/shared';
import { ShimmerLayer } from './layers/shimmer';
import { ShockLayer } from './layers/shock';
import { SlashLayer } from './layers/slashes';
import { SmokeLayer } from './layers/smoke';
import { StreakLayer } from './layers/streaks';

/**
 * One frame of pre-roll. The first game's particles got a physics step before their first render, so
 * frame one is already an open burst with every piece at full size, instead of a dot at the origin.
 */
const PRE_ROLL = 1 / 60;

const NO_FLOOR = -1e6;
const FLOOR_SEARCH = 60;

const EVENT_CAP = 256;

/** A casing that has yet to land. Its whole arc is known at emission, so the sound can be booked. */
interface Tinkle {
  at: number;
  live: boolean;
  x: number;
  y: number;
  z: number;
  /** Packed casing kind and strength, see Fx.onTinkle. */
  value: number;
}

/** Everything a recipe needs: the layers plus clock and floor helpers. */
export class FxCore {
  readonly uniforms: FxUniforms;
  readonly chips: ChipLayer;
  readonly streaks: StreakLayer;
  readonly smoke: SmokeLayer;
  readonly puffs: PuffLayer;
  readonly flashes: FlashLayer;
  /** On the player clock, so a gun fired in SLOWMO still flashes for one or two real frames. */
  readonly muzzle: FlashLayer;
  /** Same, but drawn with the weapon in the view scene so the viewmodel cannot hide it. */
  readonly muzzleView: FlashLayer | null;
  readonly trailRings: RingLayer;
  readonly waves: RingLayer;
  readonly shock: ShockLayer;
  readonly lines: LineLayer;
  readonly arcs: ArcLayer;
  readonly slashes: SlashLayer;
  readonly lens: LensLayer | null;
  readonly shimmer: ShimmerLayer;

  /** Colours the layers use on every shock or ring, kept here so recipes do not build one. */
  readonly shockColor = hot(0xdfeeff, 0.22);
  readonly ringColor = hot(0xffff00, 3.5);
  readonly waveColor = hot(0xdfeeff, 2.2);

  /** Sub-frame remainder of the flame stream, so the emission rate is independent of frame rate. */
  flameAccum = 0;

  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly probe = new THREE.Vector3();
  private readonly hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
  private epoch = 0;
  private playerEpoch = 0;
  private readonly events: Tinkle[] = [];
  private eventHead = 0;
  private booked = 0;

  constructor(readonly ctx: Ctx) {
    const { scene, viewScene } = ctx.render;
    for (let i = 0; i < EVENT_CAP; i++) this.events.push({ at: 0, live: false, x: 0, y: 0, z: 0, value: 0 });
    const u = (this.uniforms = makeUniforms());
    const atlas = buildPuffAtlas();

    this.chips = new ChipLayer(scene, u);
    this.streaks = new StreakLayer(scene, u);
    this.smoke = new SmokeLayer(scene, u, atlas);
    this.puffs = new PuffLayer(scene, u);
    this.flashes = new FlashLayer(scene, u, 256, 'fx.flashes');
    const playerClock = { ...u, uTime: u.uTimePlayer };
    this.muzzle = new FlashLayer(scene, playerClock, 128, 'fx.muzzle');
    this.trailRings = new RingLayer(scene, u, 8, 256, 'fx.trailRings');
    this.waves = new RingLayer(scene, u, 48, 48, 'fx.waves');
    this.shock = new ShockLayer(scene, u);
    this.lines = new LineLayer(scene, u);
    this.arcs = new ArcLayer(scene, u);
    this.slashes = new SlashLayer(scene, u);
    this.shimmer = new ShimmerLayer(scene, u);

    // A stubbed render has a proxy here. Only a real scene can hold objects.
    const hasView = viewScene instanceof THREE.Scene;
    this.muzzleView = hasView ? new FlashLayer(viewScene, playerClock, 64, 'fx.muzzleView') : null;
    this.lens = hasView ? new LensLayer(viewScene, atlas) : null;
  }

  /** World-clock birth time for something spawned now, pre-rolled by one frame. */
  get birth(): number {
    return this.now - PRE_ROLL;
  }

  /** World time on the rebased clock the shaders see. */
  get now(): number {
    return this.ctx.time.elapsed - this.epoch;
  }

  get playerNow(): number {
    return this.ctx.time.playerElapsed - this.playerEpoch;
  }

  /** Books a casing hit `delay` seconds from now. The queue is fixed; a full queue drops the oldest. */
  bookTinkle(delay: number, x: number, y: number, z: number, value: number): void {
    const e = this.events[this.eventHead]!;
    if (!e.live) this.booked++;
    this.eventHead = (this.eventHead + 1) % EVENT_CAP;
    e.at = this.ctx.time.elapsed + delay;
    e.live = true;
    e.x = x;
    e.y = y;
    e.z = z;
    e.value = value;
  }

  /** One ray per burst. Everything in the burst bounces or lands on that height. */
  floorAt(x: number, y: number, z: number): number {
    this.probe.set(x, y + 0.25, z);
    return this.ctx.physics.raycastInto(this.probe, this.down, FLOOR_SEARCH, CG.World, this.hit) ? this.hit.point.y : NO_FLOOR;
  }

  syncFrame(): void {
    const now = this.now;
    const u = this.uniforms;
    u.uTime.value = now;
    u.uTimePlayer.value = this.playerNow;

    const r = this.ctx.render;
    const cam = r.camera;
    const canvas = r.renderer.domElement;
    const h = canvas.height || 720;
    const w = canvas.width || 1280;
    u.uRes.value.set(w, h);
    u.uPixelWorld.value = 2 / (h * (cam.projectionMatrix.elements[5] ?? 1));
    u.uNearFar.value.set(cam.near, cam.far);

    const depth = r.depthTexture;
    if (depth) {
      u.uDepth.value = depth;
      const image = depth.image as { width: number; height: number };
      u.uDepthRes.value.set(image.width, image.height);
      this.smoke.enableSoftDepth();
      this.shimmer.enableSoftDepth();
    }

    this.chips.sync(now);
    this.streaks.sync(now);
    this.smoke.sync(now);
    this.puffs.sync(now);
    this.flashes.sync(now);
    this.trailRings.sync(now);
    this.waves.sync(now);
    this.shock.sync(now);
    this.lines.sync(now);
    this.arcs.sync(now);
    this.slashes.sync(now);
    this.shimmer.sync(now);
    const pn = u.uTimePlayer.value;
    this.muzzle.sync(pn);
    this.muzzleView?.sync(pn);
    this.lens?.sync(this.ctx.time.realDt, w / h);
  }

  /** Fires every booked hit that came due this frame. */
  runTinkles(handler: (x: number, y: number, z: number, value: number) => void): void {
    if (this.booked === 0) return;
    const now = this.ctx.time.elapsed;
    for (let i = 0; i < EVENT_CAP; i++) {
      const e = this.events[i]!;
      if (e.live && now >= e.at) {
        e.live = false;
        this.booked--;
        handler(e.x, e.y, e.z, e.value);
      }
    }
  }

  /** Live particle count. Scans the rings, so debug use only. */
  countParticles(): number {
    const now = this.now;
    return (
      this.chips.countLive(now) + this.streaks.ring.countLive(now) +
      this.smoke.ring.countLive(now) + this.puffs.ring.countLive(now)
    );
  }

  clear(): void {
    this.chips.clear();
    this.streaks.ring.clear();
    this.smoke.ring.clear();
    this.puffs.ring.clear();
    this.flashes.ring.clear();
    this.muzzle.ring.clear();
    this.muzzleView?.ring.clear();
    this.trailRings.ring.clear();
    this.waves.ring.clear();
    this.shock.ring.clear();
    this.lines.ring.clear();
    this.arcs.ring.clear();
    this.slashes.ring.clear();
    this.shimmer.ring.clear();
    this.lens?.clear();
    for (const e of this.events) e.live = false;
    this.booked = 0;
    // Nothing is alive now, so float32 can start fresh.
    this.epoch = this.ctx.time.elapsed;
    this.playerEpoch = this.ctx.time.playerElapsed;
  }
}
