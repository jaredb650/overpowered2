import * as THREE from 'three';
import type { MaterialLibrary, WorldMaterialName } from '../../core/contracts';
import type { MaterialPatcher } from './patch';
import { TextureBaker, type BakedSet } from './TextureBaker';
import { worldSurfaceHook } from './worldSurface';
import { SHEET } from '../decalSheet';
import { DECAL_PARTS } from './decalAtlas.glsl';

type SetName = 'concrete' | 'concreteDark' | 'asphalt' | 'steel' | 'steelDark' | 'rust' | 'grate' | 'hazard' | 'panel' | 'tile' | 'dirt' | 'rubber' | 'paint' | 'lava';

interface SetSpec {
  size: number;
  tile: number;
  /** Height-to-normal strength, in texel units. */
  bump: number;
  extraMode?: 0 | 1 | 2;
}

const SETS: Record<SetName, SetSpec> = {
  concrete: { size: 1024, tile: 4, bump: 6.5 },
  concreteDark: { size: 1024, tile: 4, bump: 6.5 },
  asphalt: { size: 1024, tile: 4, bump: 8 },
  steel: { size: 1024, tile: 2, bump: 3 },
  steelDark: { size: 1024, tile: 2, bump: 3 },
  rust: { size: 1024, tile: 3, bump: 12 },
  grate: { size: 1024, tile: 1, bump: 7, extraMode: 1 },
  hazard: { size: 1024, tile: 2, bump: 4 },
  panel: { size: 1024, tile: 4, bump: 7 },
  tile: { size: 1024, tile: 2, bump: 5 },
  dirt: { size: 512, tile: 4, bump: 9 },
  rubber: { size: 512, tile: 1, bump: 7 },
  paint: { size: 512, tile: 2, bump: 3 },
  lava: { size: 1024, tile: 6, bump: 11, extraMode: 2 },
};

interface MaterialSpec {
  set?: SetName;
  color?: number;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  wet?: number;
  macro?: number;
  normalScale?: number;
}

const MATERIALS: Record<WorldMaterialName, MaterialSpec> = {
  concrete: { set: 'concrete', wet: 0.55, macro: 0.5 },
  concreteDark: { set: 'concreteDark', wet: 0.6, macro: 0.5 },
  asphalt: { set: 'asphalt', wet: 0.75, macro: 0.4 },
  steel: { set: 'steel', macro: 0.22 },
  steelDark: { set: 'steelDark', macro: 0.3 },
  rust: { set: 'rust', macro: 0.35 },
  grate: { set: 'grate', macro: 0.2 },
  hazard: { set: 'hazard', macro: 0.3, wet: 0.3 },
  panel: { set: 'panel', macro: 0.25 },
  tile: { set: 'tile', macro: 0.3, wet: 0.45 },
  dirt: { set: 'dirt', macro: 0.5, wet: 0.5 },
  rubber: { set: 'rubber', macro: 0.2 },
  paintRed: { set: 'paint', color: 0x9c1014, macro: 0.25 },
  paintYellow: { set: 'paint', color: 0xb88c12, macro: 0.25 },
  paintWhite: { set: 'paint', color: 0xb8bcc0, macro: 0.25 },
  glass: { color: 0x9ab4c4, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16 },
  emissiveCyan: { color: 0x030405, roughness: 0.35, metalness: 0, emissive: 0x38d8ff, emissiveIntensity: 9 },
  emissiveMagenta: { color: 0x050305, roughness: 0.35, metalness: 0, emissive: 0xff2aa8, emissiveIntensity: 9 },
  emissiveOrange: { color: 0x050403, roughness: 0.35, metalness: 0, emissive: 0xff6a10, emissiveIntensity: 9 },
  emissiveRed: { color: 0x050303, roughness: 0.35, metalness: 0, emissive: 0xff1810, emissiveIntensity: 9 },
  emissiveWhite: { color: 0x050505, roughness: 0.35, metalness: 0, emissive: 0xe8f2ff, emissiveIntensity: 12 },
  lava: { set: 'lava', macro: 0.1 },
  // Clean office surfaces: painted drywall with no texture to stain it, and a low-pile carpet. Both take their colour from vertex tint.
  plaster: { color: 0xdcdcd8, roughness: 0.92, metalness: 0 },
  carpet: { set: 'rubber', color: 0x9aa0a8, macro: 0.12, normalScale: 0.35, roughness: 1, metalness: 0 },
  // Low glows for what should read as lit without blooming: far windows, monitors, still water.
  emissiveDim: { color: 0x050505, roughness: 0.4, metalness: 0, emissive: 0xffd9a8, emissiveIntensity: 1.4 },
  screen: { color: 0x030405, roughness: 0.2, metalness: 0, emissive: 0x8fdcff, emissiveIntensity: 2.2 },
};

export class WorldMaterials implements MaterialLibrary {
  private readonly cache = new Map<WorldMaterialName, THREE.MeshStandardMaterial>();
  private readonly sets = new Map<SetName, BakedSet>();
  private readonly baker: TextureBaker;
  /** Multiplies every set's resolution. 0.5 on the lowest preset saves three quarters of the memory. */
  private readonly sizeScale: number;
  /** The decal sheet's own scale on top of that (`QualityPreset.decalSheet`): 1 is 2048 x 4096, 0.5 a quarter of the memory. */
  sheetScale = 1;

  private readonly renderer: THREE.WebGLRenderer;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly patcher: MaterialPatcher,
    private readonly shared: { opNoise: THREE.IUniform; opViewPass: THREE.IUniform; opTime: THREE.IUniform },
    sizeScale = 1,
  ) {
    this.sizeScale = sizeScale;
    this.renderer = renderer;
    this.baker = new TextureBaker(renderer, Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
    shared.opNoise.value = this.baker.noiseTexture();
  }

  /** Bakes every texture set, then the decal atlas, and frees the scratch targets. */
  async bakeAll(): Promise<BakedSet> {
    for (const name of Object.keys(SETS) as SetName[]) {
      this.set(name);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const decals = await this.sheet(this.baker);
    this.baker.dispose();
    return decals;
  }

  private async sheet(baker: TextureBaker): Promise<BakedSet> {
    // `?bakeTime` logs what each part of the sheet cost to compile and to draw.
    const timed = typeof location !== 'undefined' && location.search.includes('bakeTime');
    const t0 = performance.now();
    const scale = this.sizeScale * this.sheetScale;
    const decals = await baker.bakeParts(DECAL_PARTS, Math.round(SHEET.width * scale), 9 * scale, 1, Math.round(SHEET.height * scale), timed);
    if (timed) console.log(`[bake] decal sheet ${(performance.now() - t0).toFixed(0)} ms in all, ${Math.round(SHEET.width * scale)} x ${Math.round(SHEET.height * scale)}`);
    return decals;
  }

  /**
   * The decal sheet baked again at `scale` (a quality change that crosses the line). The caller swaps it in and frees the
   * old one. Its five shaders are compiled in the background as at load, from the browser's cache when it has them.
   */
  async bakeSheet(scale: number): Promise<BakedSet> {
    this.sheetScale = scale;
    const baker = new TextureBaker(this.renderer, Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8));
    try {
      return await this.sheet(baker);
    } finally {
      baker.dispose();
    }
  }

  private set(name: SetName): BakedSet {
    let set = this.sets.get(name);
    if (!set) {
      const s = SETS[name];
      set = this.baker.bake(name, Math.round(s.size * this.sizeScale), s.bump * this.sizeScale, s.extraMode ?? 0);
      this.sets.set(name, set);
    }
    return set;
  }

  world(name: WorldMaterialName): THREE.Material {
    let m = this.cache.get(name);
    if (m) return m;
    const s = MATERIALS[name];
    const masked = name === 'grate';
    m = new THREE.MeshStandardMaterial({
      name: `world:${name}`,
      color: s.color ?? 0xffffff,
      roughness: s.roughness ?? 1,
      metalness: s.metalness ?? 1,
      emissive: s.emissive ?? 0,
      emissiveIntensity: s.emissiveIntensity ?? 1,
      transparent: s.transparent ?? false,
      opacity: s.opacity ?? 1,
      depthWrite: !s.transparent,
      alphaTest: masked ? 0.5 : 0,
      alphaToCoverage: masked,
      side: masked ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (s.set) {
      const tex = this.set(s.set);
      const hook = worldSurfaceHook({
        albedo: tex.albedo,
        surface: tex.surface,
        tile: SETS[s.set].tile,
        normalScale: s.normalScale ?? 1,
        wetness: s.wet ?? 0,
        macro: s.macro ?? 0,
        lava: s.set === 'lava',
        masked,
      }, this.shared);
      this.patcher.apply(m, hook, `world:${name}`);
    } else {
      this.patcher.apply(m);
    }
    this.cache.set(name, m);
    return m;
  }

  patch<T extends THREE.MeshStandardMaterial>(material: T): T {
    return this.patcher.apply(material);
  }
}
