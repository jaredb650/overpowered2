import * as THREE from 'three';
import type { Ctx, DecalSystem, DynamicLights, LightVolumeBakeInput, MaterialLibrary, PostFx, RenderSystem } from '../core/contracts';
import { createEngineUniforms, VIEW_DEPTH_MAX, type EngineUniforms } from './engine';
import { DEFAULT_QUALITY, QUALITY, type QualityPreset } from './quality';
import { MaterialPatcher } from './materials/patch';
import { WorldMaterials } from './materials/MaterialLibrary';
import type { BakedSet } from './materials/TextureBaker';
import { DynamicLightPool } from './DynamicLightPool';
import { Decals } from './Decals';
import { Sky } from './Sky';
import { MoonShadows, type ShadowPassKind } from './MoonShadows';
import { PostState } from './post/PostState';
import { Bloom } from './post/Bloom';
import { Composite } from './post/Composite';
import { Gtao } from './post/Gtao';
import { Fog, type FogSettings } from './post/Fog';
import { Combine } from './post/Combine';
import { Ssr } from './post/Ssr';
import { LightVolume } from './lightvolume/LightVolume';
import { FullscreenPass } from './fullscreen';
import { DynamicResolution } from './DynamicResolution';
import { EmissiveLines } from './EmissiveLines';
import { XRay } from './XRay';

type ListMode = 'all' | 'opaque' | 'decals' | 'transparent' | 'shadowStatic' | 'shadowDynamic' | 'xray';

interface RenderItem {
  object: THREE.Object3D;
}
interface RenderList {
  opaque: RenderItem[];
  transmissive: RenderItem[];
  transparent: RenderItem[];
  sort(a: unknown, b: unknown): void;
}

/** Device pixels per canvas pixel that stretch without a visible beat, cheapest last. */
const STRETCHES = [1, 1.5, 2, 3, 4] as const;

/** Sizes stay even so half-resolution targets line up exactly with the area they cover. */
const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2);

export class Renderer implements RenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 1500);
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 12);
  readonly materials: MaterialLibrary;
  readonly post: PostFx;
  readonly lights: DynamicLights;
  decals!: DecalSystem;
  readonly moon = new THREE.DirectionalLight(0xffffff, 1);

  private readonly engine: EngineUniforms & { opShadowTaps: { value: number } };
  private readonly patcher: MaterialPatcher;
  private readonly pool: DynamicLightPool;
  private readonly worldMaterials: WorldMaterials;
  private decalSystem!: Decals;
  private readonly postState = new PostState();
  private sky!: Sky;
  private readonly shadows: MoonShadows;
  private readonly bloom = new Bloom();
  private readonly composite = new Composite();
  private readonly viewMoon = new THREE.DirectionalLight(0xffffff, 1);
  private readonly gtao = new Gtao();
  private readonly fogPass: Fog;
  private readonly combine = new Combine();
  private readonly ssr = new Ssr();
  private readonly emissiveLines = new EmissiveLines();
  private readonly xray = new XRay();
  readonly volume: LightVolume;
  /** Live fog tuning. The world can change this per zone. */
  readonly fog: FogSettings;
  /** Per-pass switches, for measuring each pass and for the sandbox. */
  readonly passes = { ao: true, fog: true, bloom: true, shadows: true, decals: true, ssr: true };
  private readonly tanHalf = new THREE.Vector2();
  /** The baked decal atlas, for inspection. */
  decalAtlas!: BakedSet;
  /** Automatic resolution scaling. Set `.enabled = false` to pin the preset's resolution. */
  readonly dynamicResolution = new DynamicResolution();

  private ctx: Ctx | null = null;
  private sceneTarget!: THREE.WebGLRenderTarget;
  /** Single-sampled colour after the world pass, with the world depth attached for the transparent pass. */
  private hdrTarget!: THREE.WebGLRenderTarget;
  private depthCopy!: THREE.WebGLRenderTarget;
  /** Writes into the resolved scene colour, so decals get AO and fog like the surface under them. */
  private decalTarget!: THREE.WebGLRenderTarget;
  /** Allocated size of the full-resolution targets. */
  private fullWidth = 2;
  private fullHeight = 2;
  /** The part of them in use, which dynamic resolution moves. */
  private width = 2;
  private height = 2;
  private readonly depthRegion = new THREE.Box2(new THREE.Vector2(), new THREE.Vector2());
  private quality: QualityPreset = QUALITY[DEFAULT_QUALITY]!;
  private listMode: ListMode = 'all';
  private frames = 0;
  private lastCalls = 0;
  private lastTriangles = 0;
  private fallbackClock = new THREE.Timer();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x000000, 0);

    this.engine = { ...createEngineUniforms(), opShadowTaps: { value: this.quality.shadowTaps } };
    this.patcher = new MaterialPatcher(this.engine);
    this.worldMaterials = new WorldMaterials(this.renderer, this.patcher, { opNoise: this.engine.opNoise, opViewPass: this.engine.opViewPass, opTime: this.engine.opTime });
    this.materials = this.worldMaterials;
    this.post = this.postState;

    this.pool = new DynamicLightPool(this.scene, this.viewScene);
    this.lights = this.pool;
    this.pool.setCount(this.quality.dynamicLights);

    this.volume = new LightVolume(this.engine);
    this.fogPass = new Fog(this.engine);
    this.fog = this.fogPass.settings;
    this.gtao.configure(this.quality.aoSlices, this.quality.aoSteps);
    this.ssr.configure(this.quality.ssrSteps);
    this.fogPass.configure(this.quality.fogSteps, this.pool.fogPosition, this.pool.fogColor);

    this.shadows = new MoonShadows(this.engine);
    this.shadows.setSizes(this.quality.shadowStatic, this.quality.shadowDynamic);

    this.moon.color.setRGB(0.7, 0.79, 1.0);
    this.moon.intensity = 2.2;
    this.engine.opMoonDir.value.set(-0.42, 0.56, -0.71).normalize();
    this.engine.opMoonColor.value.copy(this.moon.color).multiplyScalar(this.moon.intensity);
    this.moon.position.copy(this.engine.opMoonDir.value).multiplyScalar(100);
    this.scene.add(this.moon, this.moon.target);
    this.viewMoon.color.copy(this.moon.color);
    this.viewMoon.intensity = this.moon.intensity;
    this.viewScene.add(this.viewMoon, this.viewMoon.target);

    // A frame renders these scenes several times. render() updates their matrices once, up front.
    this.scene.matrixWorldAutoUpdate = false;
    this.viewScene.matrixWorldAutoUpdate = false;

    this.hookRenderList(this.scene);
    this.hookRenderList(this.viewScene);

    this.resize();
    addEventListener('resize', this.resize);
  }

  /** Bakes textures, atlas and environment, yielding between sets so a loading screen can paint. */
  async ready(): Promise<void> {
    this.decalAtlas = await this.worldMaterials.bakeAll();
    this.decalSystem = new Decals(this.patcher, this.decalAtlas);
    this.decals = this.decalSystem;
    this.scene.add(this.decalSystem.mesh);

    this.sky = new Sky(this.renderer, this.engine);
    this.scene.add(this.sky.mesh);
    this.scene.environment = this.sky.environment;
    this.viewScene.environment = this.sky.environment;
  }

  init(ctx: Ctx): void {
    this.ctx = ctx;
    // Game resets its update list on a new run, and the renderer is not in that list.
    ctx.events.on('run:start', () => this.reset());
  }

  reset(): void {
    this.decalSystem.clear();
    this.pool.clear();
    this.postState.setGrade('default', 0);
    this.postState.setSpeed(0);
    this.postState.setLowHealth(0);
    this.xray.clear();
  }

  highlight(meshes: readonly THREE.Object3D[], color: THREE.ColorRepresentation, strength = 1): void {
    this.xray.add(meshes, color, strength);
  }

  sweep(origin: THREE.Vector3, color: THREE.ColorRepresentation, speed: number, reach: number): void {
    this.xray.sweep(origin, color, speed, reach);
  }

  /**
   * three sorts its render list once per render() and offers no way to draw a subset, but opaque
   * and transparent must be separate passes here: transparent things need this frame's depth and sit on
   * top of the fog. Wrapping sort() on the cached list gives that split without forking the renderer.
   */
  private hookRenderList(scene: THREE.Scene): void {
    const list = this.renderer.renderLists.get(scene, 0) as unknown as RenderList;
    const sort = list.sort;
    list.sort = (a, b) => {
      this.filterList(list);
      sort(a, b);
    };
  }

  private filterList(list: RenderList): void {
    switch (this.listMode) {
      case 'opaque':
        list.transparent.length = 0;
        list.transmissive.length = 0;
        break;
      case 'decals': {
        list.opaque.length = 0;
        list.transmissive.length = 0;
        const mesh = this.decalSystem.mesh;
        let n = 0;
        for (const item of list.transparent) if (item.object === mesh) list.transparent[n++] = item;
        list.transparent.length = n;
        break;
      }
      case 'transparent': {
        list.opaque.length = 0;
        // Transmission would re-render the opaque list. Glass here is plain alpha blending.
        for (const item of list.transmissive) list.transparent.push(item);
        list.transmissive.length = 0;
        const mesh = this.decalSystem.mesh;
        let n = 0;
        for (const item of list.transparent) if (item.object !== mesh) list.transparent[n++] = item;
        list.transparent.length = n;
        break;
      }
      case 'xray': {
        const lit = this.xray.current!;
        let n = 0;
        for (const item of list.opaque) if (lit.has(item.object)) list.opaque[n++] = item;
        list.opaque.length = n;
        for (const item of list.transparent) if (lit.has(item.object)) list.opaque.push(item);
        list.transparent.length = 0;
        list.transmissive.length = 0;
        break;
      }
      case 'shadowStatic':
      case 'shadowDynamic': {
        list.transparent.length = 0;
        list.transmissive.length = 0;
        const wantStatic = this.listMode === 'shadowStatic';
        let n = 0;
        for (const item of list.opaque) {
          const o = item.object;
          if (o.castShadow && (o.userData.staticShadow === true) === wantStatic) list.opaque[n++] = item;
        }
        list.opaque.length = n;
        break;
      }
      default:
        break;
    }
  }

  private readonly resize = (): void => {
    const cssW = Math.max(innerWidth, 1);
    const cssH = Math.max(innerHeight, 1);
    // The canvas is the preset's pixel budget, not the screen: Retina would otherwise ask an M1 for 5 megapixels.
    // The page compositor stretches it to the display in one step, and each pixel of the final pass stays lined up
    // with the image it reads. Only whole ratios are allowed. At 1.8x, say, the bilinear stretch sharpens and
    // softens in a repeating pattern, which grain and wet floors show as a faint grid.
    const dpr = devicePixelRatio || 1;
    const fits = (d: number) => cssW * cssH * (dpr / d) ** 2 <= this.quality.maxPixels;
    const density = dpr / (STRETCHES.find(fits) ?? STRETCHES[STRETCHES.length - 1]!);
    this.renderer.setDrawingBufferSize(even(cssW * density), even(cssH * density), 1);
    const aspect = cssW / cssH;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
    this.allocateTargets();
  };

  private allocateTargets(): void {
    const { width: w, height: h } = this.renderer.domElement;
    this.fullWidth = w;
    this.fullHeight = h;
    this.engine.opTargetSize.value.set(w, h);
    this.sceneTarget?.dispose();
    this.hdrTarget?.dispose();
    this.depthCopy?.dispose();
    this.decalTarget?.dispose();

    const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const depth = new THREE.DepthTexture(w, h, THREE.FloatType);
    depth.format = THREE.DepthFormat;
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, { ...hdr, samples: this.quality.msaa, depthTexture: depth, depthBuffer: true });
    this.hdrTarget = new THREE.WebGLRenderTarget(w, h, { ...hdr, depthTexture: depth, depthBuffer: true });

    const copy = new THREE.DepthTexture(w, h, THREE.FloatType);
    copy.format = THREE.DepthFormat;
    copy.minFilter = copy.magFilter = THREE.NearestFilter;
    this.depthCopy = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RedFormat, type: THREE.UnsignedByteType, depthTexture: copy, depthBuffer: true, generateMipmaps: false,
    });
    this.decalTarget = new THREE.WebGLRenderTarget(w, h, { ...hdr, depthBuffer: false });
    this.decalTarget.texture.dispose();
    this.decalTarget.texture = this.sceneTarget.texture;
    this.bloom.resize(w, h, this.quality.bloomLevels);
    this.gtao.resize(w, h);
    this.fogPass.resize(w, h);
    this.ssr.resize(w, h);
    // copyTextureToTexture finds framebuffers through the target that owns each depth texture.
    this.renderer.initRenderTarget(this.sceneTarget);
    this.renderer.initRenderTarget(this.hdrTarget);
    this.renderer.initRenderTarget(this.depthCopy);
    this.applyResolution();
  }

  /** Moves every pass to the current dynamic scale. Nothing here touches a GPU resource, so a step cannot hitch. */
  private applyResolution(): void {
    const scale = this.dynamicResolution.scale;
    const w = even(this.fullWidth * scale);
    const h = even(this.fullHeight * scale);
    this.width = w;
    this.height = h;
    for (const t of [this.sceneTarget, this.hdrTarget, this.decalTarget]) t.viewport.set(0, 0, w, h);
    this.depthRegion.max.set(w, h);
    this.bloom.setArea(w, h);
    this.gtao.setArea(w, h);
    this.fogPass.setArea(w, h);
    this.ssr.setArea(w, h);
    this.combine.setArea(this.gtao.depth);
    this.composite.setArea(this.hdrTarget, this.bloom.outputTarget, this.quality.msaa === 0);
  }

  get depthTexture(): THREE.DepthTexture | null {
    return this.frames > 0 ? this.depthCopy.depthTexture : null;
  }

  async bakeLightVolume(input: LightVolumeBakeInput): Promise<void> {
    this.scene.updateMatrixWorld();
    this.scene.traverse(o => {
      if ((o as THREE.Mesh).isMesh && o.castShadow && !(o as THREE.SkinnedMesh).isSkinnedMesh && !o.userData.dynamicShadow) {
        o.userData.staticShadow = true;
      }
    });
    this.shadows.setBounds(input.bounds);
    this.emissiveLines.attach(this.scene, this.quality.msaa === 0);
    // Program linking runs on the driver's threads, so it overlaps the bake worker for free and the
    // first frame does not hitch on twenty big shaders.
    await Promise.all([this.volume.bake(input), this.renderer.compileAsync(this.scene, this.camera)]);
  }

  setQuality(level: number): void {
    const next = QUALITY[Math.min(Math.max(Math.round(level), 0), QUALITY.length - 1)]!;
    if (next === this.quality) return;
    const lightsChanged = next.dynamicLights !== this.quality.dynamicLights;
    this.quality = next;
    this.engine.opShadowTaps.value = next.shadowTaps;
    this.shadows.setSizes(next.shadowStatic, next.shadowDynamic);
    if (lightsChanged) this.pool.setCount(next.dynamicLights);
    this.gtao.configure(next.aoSlices, next.aoSteps);
    this.ssr.configure(next.ssrSteps);
    this.fogPass.configure(next.fogSteps, this.pool.fogPosition, this.pool.fogColor);
    this.emissiveLines.setVisible(next.msaa === 0);
    this.resize();
  }

  /** Internal render size after quality and dynamic resolution. */
  renderSize(): { width: number; height: number; scale: number } {
    return { width: this.width, height: this.height, scale: this.dynamicResolution.scale };
  }

  /** Re-renders the cached whole-map shadow once, after the static world changes. */
  refreshStaticShadows(): void {
    this.shadows.invalidateStatic();
  }

  /**
   * Isolated cost of each post pass in milliseconds: every pass is repeated between GPU syncs and
   * the best round is kept, so it stays usable on a busy machine. Call between frames. Timer queries
   * cannot do this here: under ANGLE on Metal each one reads about 6 ms whatever the pass does.
   */
  measurePasses(rounds = 6, repeats = 8): Record<string, number> {
    const { renderer, camera } = this;
    const px = new Uint8Array(4);
    // Reading a target nothing has touched returns at once, so the sync is a real draw queued behind
    // the work, read back from its own one-pixel target.
    const probe = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const tick = new FullscreenPass('out vec4 c; void main() { c = vec4(1.0); }', {});
    const sync = () => {
      tick.render(renderer, probe);
      renderer.readRenderTargetPixels(probe, 0, 0, 1, 1, px);
    };
    const time = (run: () => void): number => {
      let best = Infinity;
      for (let r = 0; r < rounds; r++) {
        sync();
        const start = performance.now();
        for (let i = 0; i < repeats; i++) run();
        sync();
        best = Math.min(best, (performance.now() - start) / repeats);
      }
      return Number(best.toFixed(3));
    };
    const depth = this.depthCopy.depthTexture!;
    const half = this.gtao.depth.texture;
    const empty = time(() => undefined);
    const results: Record<string, number> = {
      syncFloor: empty,
      depthPrep: time(() => this.gtao.renderDepth(renderer, depth, camera)),
      ao: time(() => this.gtao.renderAo(renderer, this.tanHalf)),
      fog: time(() => this.fogPass.render(renderer, half, camera, this.tanHalf, this.engine.opTime.value)),
      ssr: time(() => this.ssr.render(renderer, half, this.sceneTarget.texture, this.bloom.output, camera, this.tanHalf)),
      combine: time(() => this.combine.render(renderer, this.hdrTarget, this.sceneTarget.texture, depth, half, this.gtao.texture, this.fogPass.texture, this.ssr.texture, camera, 1, 1, 1)),
      bloom: time(() => this.bloom.render(renderer, this.hdrTarget)),
      composite: time(() => this.composite.render(renderer, this.hdrTarget.texture, this.bloom.output, this.width, this.height, 1, this.postState)),
    };
    let post = 0;
    for (const k of Object.keys(results)) if (k !== 'syncFloor') post += results[k]!;
    results.postTotal = Number(post.toFixed(3));
    probe.dispose();
    tick.dispose();
    return results;
  }

  drawCalls(): number {
    return this.lastCalls;
  }

  triangles(): number {
    return this.lastTriangles;
  }

  private drawXRay(realDt: number): void {
    const { renderer, scene, camera, xray } = this;
    const depth = this.depthCopy.depthTexture!;
    xray.drawSweep(renderer, this.hdrTarget, depth, camera, realDt);
    renderer.setRenderTarget(this.hdrTarget);
    scene.overrideMaterial = xray.material;
    this.listMode = 'xray';
    while (xray.next(depth, camera)) renderer.render(scene, camera);
    this.listMode = 'all';
    scene.overrideMaterial = null;
  }

  private drawShadow = (kind: ShadowPassKind, camera: THREE.Camera): void => {
    this.listMode = kind === 'static' ? 'shadowStatic' : 'shadowDynamic';
    this.renderer.render(this.scene, camera);
    this.listMode = 'all';
  };

  render(): void {
    const { renderer, scene, camera, viewScene, viewCamera, engine } = this;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.fallbackClock.update();
    const realDt = this.ctx ? this.ctx.time.realDt : Math.min(this.fallbackClock.getDelta(), 0.05);
    const worldDt = this.ctx ? this.ctx.time.dt : realDt;
    const time = this.ctx ? this.ctx.time.realElapsed : this.fallbackClock.getElapsed();

    if (this.dynamicResolution.update(realDt)) this.applyResolution();

    renderer.info.reset();
    if (camera.parent === null) camera.updateMatrixWorld();
    if (viewCamera.parent === null) viewCamera.updateMatrixWorld();
    scene.updateMatrixWorld();
    viewScene.updateMatrixWorld();
    engine.opCamToWorld.value.copy(camera.matrixWorld);
    engine.opTime.value = time;
    this.sky.update(time);
    this.pool.update(worldDt, camera, viewCamera);
    this.postState.update(realDt);

    // Directional lights are stored in eye space, so the viewmodel's moon must match the world's.
    this.viewMoon.position.copy(engine.opMoonDir.value).transformDirection(camera.matrixWorldInverse).transformDirection(viewCamera.matrixWorld).multiplyScalar(10);
    this.viewMoon.target.position.set(0, 0, 0);
    this.viewMoon.target.position.setFromMatrixPosition(viewCamera.matrixWorld);
    this.viewMoon.position.add(this.viewMoon.target.position);
    this.viewMoon.updateMatrixWorld();
    this.viewMoon.target.updateMatrixWorld();

    engine.opShadowAmount.value = this.passes.shadows ? 1 : 0;
    if (this.passes.shadows) this.shadows.update(renderer, camera, scene, this.drawShadow);

    // Viewmodel first, in a sliver of the depth range, then the world in the same target. One MSAA
    // surface and one resolve serve both, and the tiler never shades world pixels behind the gun.
    const target = this.sceneTarget;
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    this.listMode = 'opaque';
    // three resolves and invalidates at the end of every render(). Hiding the sample count for this
    // one call keeps the multisampled colour alive for the world pass that follows.
    const samples = target.samples;
    target.samples = 0;
    gl.depthRange(0, VIEW_DEPTH_MAX);
    engine.opViewPass.value = 1;
    renderer.render(viewScene, viewCamera);
    engine.opViewPass.value = 0;
    gl.depthRange(0, 1);
    target.samples = samples;
    renderer.render(scene, camera);

    renderer.copyTextureToTexture(this.sceneTarget.depthTexture!, this.depthCopy.depthTexture!, this.depthRegion);

    this.decalSystem.update(this.ctx ? this.ctx.time.elapsed : time, this.depthCopy.depthTexture!, camera);
    if (this.passes.decals && this.decalSystem.mesh.count > 0) {
      renderer.setRenderTarget(this.decalTarget);
      this.listMode = 'decals';
      renderer.render(scene, camera);
    }

    // AO and fog work from depth alone, so they run before anything transparent is drawn.
    const q = this.quality;
    const depth = this.depthCopy.depthTexture!;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    this.tanHalf.set(t * camera.aspect, t);
    this.gtao.renderDepth(renderer, depth, camera);
    const aoOn = q.ao && this.passes.ao;
    const fogOn = q.fog && this.passes.fog;
    if (aoOn) this.gtao.renderAo(renderer, this.tanHalf);
    if (fogOn) this.fogPass.render(renderer, this.gtao.depth.texture, camera, this.tanHalf, time);
    const ssrOn = q.ssrSteps > 0 && this.passes.ssr && this.frames > 0;
    if (ssrOn) this.ssr.render(renderer, this.gtao.depth.texture, this.sceneTarget.texture, this.hdrTarget.texture, camera, this.tanHalf);
    this.combine.render(renderer, this.hdrTarget, this.sceneTarget.texture, depth, this.gtao.depth.texture, this.gtao.texture, this.fogPass.texture, this.ssr.texture, camera, aoOn ? 1 : 0, fogOn ? 1 : 0, ssrOn ? 1 : 0);

    // Transparent pass into the resolved image, against the world's depth.
    engine.opFogTex.value = this.fogPass.texture;
    renderer.setRenderTarget(this.hdrTarget);
    this.listMode = 'transparent';
    renderer.render(scene, camera);
    gl.depthRange(0, VIEW_DEPTH_MAX);
    engine.opViewPass.value = 1;
    renderer.render(viewScene, viewCamera);
    engine.opViewPass.value = 0;
    gl.depthRange(0, 1);
    this.listMode = 'all';

    if (this.xray.busy) this.drawXRay(realDt);

    if (this.passes.bloom) this.bloom.render(renderer, this.hdrTarget);
    this.composite.render(renderer, this.hdrTarget.texture, this.bloom.output, this.width, this.height, time, this.postState);

    this.ssr.endFrame(camera, this.hdrTarget);
    this.frames++;
    this.lastCalls = renderer.info.render.calls;
    this.lastTriangles = renderer.info.render.triangles;
  }
}
