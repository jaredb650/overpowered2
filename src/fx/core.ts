import * as THREE from 'three';
import { CG, type Ctx, type RayHit } from '../core/contracts';
import { buildPuffAtlas } from './gpu/atlas';
import { ArcLayer } from './layers/arcs';
import { BloodLayer, type BloodWall } from './layers/blood';
import { ChipLayer, type ChipShape } from './layers/chips';
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
import { StainQueue } from './stains';

/**
 * One frame of pre-roll. The first game's particles got a physics step before their first render, so
 * frame one is already an open burst with every piece at full size, instead of a dot at the origin.
 */
const PRE_ROLL = 1 / 60;

const NO_FLOOR = -1e6;
const FLOOR_SEARCH = 60;
/** Past this a jet has lost its pressure, so it can only fall short of a wall. */
const WALL_SEARCH = 6;

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
  readonly blood: BloodLayer;
  readonly stains = new StainQueue();
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
  private readonly along = new THREE.Vector3();
  private readonly hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null };
  private readonly wall: BloodWall = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  private warmed = false;
  /**
   * Blood flies through hit-stop. Everything else freezes for those two or three frames, and a spurt that
   * starts, stops dead and starts again is exactly what a dropped frame looks like. Slow-mo still applies.
   */
  bloodNow = 0;
  private epoch = 0;
  private playerEpoch = 0;
  private readonly events: Tinkle[] = [];
  private eventHead = 0;
  private booked = 0;

  constructor(readonly ctx: Ctx) {
    const { scene, viewScene, materials } = ctx.render;
    for (let i = 0; i < EVENT_CAP; i++) this.events.push({ at: 0, live: false, x: 0, y: 0, z: 0, value: 0 });
    const u = (this.uniforms = makeUniforms());
    const atlas = buildPuffAtlas();

    this.chips = new ChipLayer(scene, u);
    this.blood = new BloodLayer(scene, { ...u, uTime: u.uTimeBlood }, materials);
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

  /** The surface straight ahead of a jet, if it is a wall close enough to reach. One ray per burst. */
  wallAlong(x: number, y: number, z: number, dx: number, dy: number, dz: number): BloodWall | null {
    this.probe.set(x, y, z);
    this.along.set(dx, dy, dz);
    if (!this.ctx.physics.raycastInto(this.probe, this.along, WALL_SEARCH, CG.World, this.hit)) return null;
    const { point, normal } = this.hit;
    if (normal.y > 0.7) return null;
    const w = this.wall;
    w.x = point.x;
    w.y = point.y;
    w.z = point.z;
    w.nx = normal.x;
    w.ny = normal.y;
    w.nz = normal.z;
    return w;
  }

  /**
   * First use of a material stalls the frame twice over. three asks the browser about the program on its
   * first draw, and that question waits for the whole GPU queue to drain, even for a program linked long
   * ago. Then the driver builds a pipeline for that exact blend and target. Left alone this lands on the
   * first blood of a run and every new kind of blood after it, 70 to 300 ms each. So the questions all get
   * asked now, for every program the renderer has, and every layer draws once, empty.
   */
  private warm(): void {
    this.warmed = true;
    for (const program of this.ctx.render.renderer.info.programs ?? []) {
      program.getUniforms();
      program.getAttributes();
    }
    for (const k in this.chips.rings) this.chips.rings[k as ChipShape].warm();
    this.blood.ring.warm();
    this.streaks.ring.warm();
    this.smoke.ring.warm();
    this.puffs.ring.warm();
    this.flashes.ring.warm();
    this.muzzle.ring.warm();
    this.muzzleView?.ring.warm();
    this.trailRings.ring.warm();
    this.waves.ring.warm();
    this.shock.ring.warm();
    this.lines.ring.warm();
    this.arcs.ring.warm();
    this.slashes.ring.warm();
    this.shimmer.ring.warm();
    this.lens?.warm();
    // A decal of no size: there is nothing to see, but the pass and its program run.
    this.ctx.render.decals.add('blood', this.probe.set(0, -1e4, 0), this.down, 0);
  }

  syncFrame(): void {
    const now = this.now;
    const u = this.uniforms;
    u.uTime.value = now;
    u.uTimePlayer.value = this.playerNow;
    const { paused, realDt, slowmo } = this.ctx.time;
    if (!paused) this.bloodNow += realDt * slowmo;
    u.uTimeBlood.value = this.bloodNow;

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
      if (!this.warmed) this.warm();
    }

    this.chips.sync(now);
    this.blood.sync(this.bloodNow);
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

  /** Puts down every stain whose drop arrived this frame. */
  runStains(): void {
    this.stains.run(this.bloodNow, this.ctx.render.decals);
  }

  /** Live particle count. Scans the rings, so debug use only. */
  countParticles(): number {
    const now = this.now;
    return (
      this.chips.countLive(now) + this.blood.ring.countLive(this.bloodNow) + this.streaks.ring.countLive(now) +
      this.smoke.ring.countLive(now) + this.puffs.ring.countLive(now)
    );
  }

  clear(): void {
    this.chips.clear();
    this.blood.ring.clear();
    this.stains.clear();
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
    this.bloodNow = 0;
  }
}
