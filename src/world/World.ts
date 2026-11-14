/** The map as a system: runs the build pipeline for the selected map, then ticks objects and the nav flow field. */
import * as THREE from 'three';
import type {
  Ctx, MapZone, MinimapData, NavQuery, SpawnPoint, WorldMaterialName, WorldSystem,
} from '../core/contracts';
import { Kit } from './kit/kit';
import type { Mat } from './kit/geo';
import { buildSignMaterial } from './kit/signs';
import { buildPlywoodMaterial, buildStencilMaterial } from './kit/stencil';
import { type MapDef, selectMap } from './map/maps';
import { MapSpec } from './map/spec';
import { NavGraph, type NavBuildStats } from './nav';
import { Objects } from './objects';
import { buildSpawns } from './spawns';
import { drawMinimap } from './minimap';

/** Plain stand-ins so a sandbox with a stubbed renderer still gets a usable world. */
const FALLBACK: Partial<Record<Mat, [number, number?, number?, number?]>> = {
  concrete: [0x6f7782], concreteDark: [0x444b55], asphalt: [0x2c3036], steel: [0x7c8894, 0.7, 0.45], steelDark: [0x39414b, 0.7, 0.5],
  rust: [0x4f4640, 0.4], grate: [0x3b4249, 0.7], hazard: [0x8a8f97], panel: [0x59626e, 0.3], tile: [0x77808c, 0.1, 0.25], dirt: [0x3d3b39],
  glass: [0x8fb5c9, 0.1, 0.1], rubber: [0x17191c], paintRed: [0xa32a24], paintYellow: [0xa38a24], paintWhite: [0xb9c1cc],
};
const FALLBACK_EMISSIVE: Partial<Record<Mat, number>> = {
  emissiveCyan: 0x4fd7ff, emissiveMagenta: 0xe24bff, emissiveOrange: 0xff7a26, emissiveRed: 0xff2a24, emissiveWhite: 0xdce9ff, lava: 0xff5a14,
};

export class World implements WorldSystem {
  readonly def: MapDef = selectMap();
  readonly bounds = this.def.bounds;
  zones: MapZone[] = [];
  playerSpawns: { position: THREE.Vector3; yaw: number }[] = [];
  spawnPoints: SpawnPoint[] = [];
  pickupSpots: THREE.Vector3[] = [];
  readonly navGraph: NavGraph;
  minimap!: MinimapData;
  readonly spec = new MapSpec();
  objects!: Objects;
  /** Build timings and sizes, for the sandbox. */
  readonly report: Record<string, number | string> = {};
  group: THREE.Group | null = null;
  private kit!: Kit;
  private readonly materials = new Map<Mat, THREE.Material>();

  constructor(private readonly ctx: Ctx) {
    this.navGraph = new NavGraph(ctx.physics);
  }

  get nav(): NavQuery {
    return this.navGraph;
  }

  private material = (name: Mat): THREE.Material => {
    let m = this.materials.get(name);
    if (m) return m;
    if (name === 'signs') m = buildSignMaterial(this.ctx);
    else if (name === 'stencil') m = buildStencilMaterial(this.ctx);
    else if (name === 'plywood') m = buildPlywoodMaterial(this.ctx);
    else {
      const lib = this.ctx.render.materials?.world?.(name as WorldMaterialName);
      if (lib instanceof THREE.MeshStandardMaterial) {
        // A private variant: baked AO lives in vertex colours, but other systems put the shared library
        // materials on geometry with no colour attribute, which would render black if the flag were global.
        const variant = lib.clone();
        const key = lib.customProgramCacheKey;
        variant.onBeforeCompile = lib.onBeforeCompile;
        variant.customProgramCacheKey = () => `${key.call(lib)}:baked`;
        m = variant;
      } else {
        const e = FALLBACK_EMISSIVE[name];
        const f = FALLBACK[name] ?? [0x888888];
        m = e !== undefined
          ? new THREE.MeshBasicMaterial({ color: new THREE.Color(e).multiplyScalar(3), toneMapped: false })
          : new THREE.MeshStandardMaterial({ color: f[0], metalness: f[1] ?? 0, roughness: f[2] ?? 0.85 });
      }
      (m as THREE.MeshStandardMaterial).vertexColors = true;
      m.needsUpdate = true;
    }
    this.materials.set(name, m);
    return m;
  };

  async build(onProgress?: (fraction: number, label: string) => void): Promise<void> {
    const { ctx } = this;
    const t0 = performance.now();
    let lastYield = t0;
    /** Lets the browser paint progress, without paying a macrotask for every small step. */
    const report = async (f: number, label: string) => {
      onProgress?.(f, label);
      const now = performance.now();
      if (now - lastYield > 60) {
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
      }
    };

    const kit = (this.kit = new Kit(ctx.physics));
    const spec = this.spec;
    await report(0.01, 'Pouring concrete');
    const { def } = this;
    for (let i = 0; i < def.stages.length; i++) {
      const stage = def.stages[i]!;
      await report(0.02 + (i / def.stages.length) * 0.25, stage.label);
      const s0 = performance.now();
      stage.run(kit, spec);
      this.report[`stage:${stage.label}`] = Math.round(performance.now() - s0);
    }
    this.report.authorMs = Math.round(performance.now() - t0);
    def.author(kit, spec);

    // Interactive objects add colliders and static trim, so they go before the AO bake and the nav sample.
    this.objects = new Objects(ctx, spec, kit, this.material);
    ctx.physics.step(1 / 60);

    const t1 = performance.now();
    await kit.vox.bake(kit.geo, f => report(0.27 + f * 0.13, 'Weathering steel'));
    this.report.bakeMs = Math.round(performance.now() - t1);

    const group = kit.geo.finish(this.material);
    this.group = group;
    if (ctx.render.scene instanceof THREE.Scene) ctx.render.scene.add(group, this.objects.root);
    this.report.triangles = kit.geo.triangles();
    this.report.vertices = kit.geo.vertices();
    this.report.meshes = group.children.length;
    this.report.colliders = kit.colliders;
    this.report.lights = kit.lights.length;

    // The light bake runs in a worker, so start it first and let nav use the main thread in the meantime.
    const t3 = performance.now();
    const bake = ctx.render.bakeLightVolume?.({
      bounds: def.lightBounds,
      lights: kit.lights,
      isSolid: (x, y, z) => kit.vox.isSolid(x, y, z),
      voxelSize: def.lightCell,
    });

    const stats: NavBuildStats = await this.navGraph.build(this.bounds, spec.jumpLinks, def.navHub, f => report(0.42 + f * 0.4, 'Walking the floors'), def.nav);
    this.report.navNodes = stats.nodes;
    this.report.navLinks = stats.links;
    this.report.navRemoved = stats.removed;
    this.report.navMs = Math.round(stats.ms);
    this.objects.walls.attach(this.navGraph);

    this.zones = spec.zones;
    this.playerSpawns = spec.playerSpawns;
    this.pickupSpots = spec.pickupSpots;
    const t2 = performance.now();
    this.spawnPoints = buildSpawns(ctx.physics, this.navGraph, spec, p => this.zoneAt(p));
    this.report.spawnMs = Math.round(performance.now() - t2);
    this.report.spawns = this.spawnPoints.length;

    await report(0.85, 'Charting');
    this.minimap = drawMinimap(this.navGraph, spec, kit, def.minimapExtent);
    this.report.buildMs = Math.round(performance.now() - t0);

    await report(0.87, def.readyLabel);
    if (bake instanceof Promise) await bake;
    this.report.lightBakeMs = Math.round(performance.now() - t3);
    this.report.totalMs = Math.round(performance.now() - t0);
    await report(1, 'Ready');
  }

  zoneAt(p: THREE.Vector3): MapZone | null {
    const zones = this.zones;
    const override = this.def.zoneOverride?.(p, zones);
    if (override) return override;
    for (let i = 0; i < zones.length; i++) if (zones[i]!.bounds.containsPoint(p)) return zones[i]!;
    return null;
  }

  update(): void {
    this.objects.update();
    // Every enemy chases the player, so the flow field follows them without anyone having to ask.
    const p = this.ctx.player?.position;
    if (p instanceof THREE.Vector3) this.navGraph.setTarget(p);
    this.navGraph.update();
  }

  reset(): void {
    this.objects.reset();
  }
}
