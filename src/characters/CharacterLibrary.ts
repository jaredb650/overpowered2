/** Loads baked models and pools skinned instances per archetype, all sharing geometry. */
import * as THREE from 'three';
import type { CharacterInstance, CharacterLibrary, Ctx } from '../core/contracts';
import { CAST, archetypeById, rigFor, type ArchetypeDef } from './archetypes';
import { Character, FAR_LOD, SeveredPart, type ArchetypeData } from './Character';
import { buildInterior } from './anatomy/build';
import { BloodSurfacePool, buildWalkMesh } from './anatomy/bloodSurface';
import { createInteriorMaterial } from './anatomy/interior';
import { createBackingMaterial } from './anatomy/backing';
import { WoundKind } from './anatomy/wounds';
import { createCharacterMaterial, createDetailTexture, type SurfaceOptions } from './material';
import { parseModel, type LoadedModel } from './model';
import type { HumanoidAnimator } from './animation/index';
import type { Manifest, Socket } from './format';
import { ACTIVE } from '../contracts/select';
import { fetchAsset } from '../core/fetchAsset';

const BASE = 'assets/characters/';
/**
 * Foreclosure fights Holdfast's militia, and nothing else does (docs/notes/characters.md, The militia): on its page these
 * load their bake in `militia/` instead, and the Riot carries `militiaShield` (the Bailiffs' `riotShield` stays dark).
 */
const MILITIA: ReadonlySet<string> = new Set(ACTIVE.def.id !== 'foreclosure' ? [] : [
  'trooper', 'gunner', 'brute', 'rocketeer', 'sniper', 'riot', 'warden', 'trooperHelmet', 'gunnerHelmet', 'rocketeerHelmet', 'riotHelmet',
  'trooperHeadPartialSide', 'trooperHeadPartialTop', 'gunnerHeadPartialSide', 'gunnerHeadPartialTop', 'bruteHeadPartialSide', 'bruteHeadPartialTop',
  'minigun', 'sniperRifle', 'militiaShield',
]);
const kitOf = (def: ArchetypeDef) => (MILITIA.has(def.id) ? def.props.map(p => (p.model === 'riotShield' ? { ...p, model: 'militiaShield' } : p)) : def.props);
/** Enough for the 48 live enemies with room for corpses held by gore. */
const MAX_INSTANCES_PER_ARCHETYPE = 96;
const MAX_LIMBS_PER_ARCHETYPE = 24;
/** Far enough under the world that nothing can see it. */
const WARM_DEPTH = -2000;

interface Loaded {
  model: LoadedModel;
  material: THREE.Material;
  woundMaterial: THREE.Material;
  woundDiscardMaterial: THREE.Material;
  farMaterial: THREE.Material;
  surface: SurfaceOptions;
  /** The same surface without the engine's lighting, made on request. */
  plain: THREE.Material | null;
}

interface Entry extends ArchetypeData {
  free: Character[];
  active: Set<Character>;
  freeLimbs: SeveredPart[];
  activeLimbs: SeveredPart[];
}

async function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  // Metalness and emissive live in alpha, so the browser must not premultiply it into the colour.
  const bitmap = await createImageBitmap(await fetchAsset(url, r => r.blob()), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export class CharacterLibraryImpl implements CharacterLibrary {
  readonly bloodPool = new BloodSurfacePool();
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly models = new Map<string, Promise<Loaded>>();
  private detail: THREE.Texture | null = null;
  private manifest: Promise<Manifest> | null = null;
  private warmed = false;

  constructor(private readonly ctx: Ctx) {}

  private getManifest(): Promise<Manifest> {
    this.manifest ??= fetchAsset(`${BASE}manifest.json`, r => r.json() as Promise<Manifest>);
    return this.manifest;
  }

  private async loadModel(id: string): Promise<Loaded> {
    let p = this.models.get(id);
    if (!p) {
      p = (async () => {
        const manifest = await this.getManifest();
        const file = MILITIA.has(id) ? `militia/${id}.bin` : manifest.models[id]?.file;
        if (!file) throw new Error(`Model "${id}" is not baked. Run tools/bake/bake.ts ${id}`);
        const model = parseModel(await fetchAsset(`${BASE}${file}`, r => r.arrayBuffer()));
        this.detail ??= createDetailTexture();
        const atlas = model.meta.atlas;
        const dir = BASE + file.slice(0, file.lastIndexOf('/') + 1);
        const [atlasA, atlasB] = atlas
          ? await Promise.all([loadTexture(dir + atlas.albedo, true), loadTexture(dir + atlas.normal, false)])
          : [null, null];
        const character = model.meta.kind === 'character';
        const surface: SurfaceOptions = {
          detail: this.detail, atlasA, atlasB,
          bloodMap: character ? this.bloodPool.texture : null,
          extraBase: model.meta.skeleton.length * 4,
        };
        const material = createCharacterMaterial(this.ctx, surface);
        const farMaterial = character ? createCharacterMaterial(this.ctx, { ...surface, far: true }) : material;
        const woundMaterial = character ? createCharacterMaterial(this.ctx, { ...surface, wounds: true }) : material;
        const woundDiscardMaterial = character ? createCharacterMaterial(this.ctx, { ...surface, wounds: true, woundDiscard: true }) : material;
        return { model, material, woundMaterial, woundDiscardMaterial, farMaterial, surface, plain: null };
      })();
      this.models.set(id, p);
    }
    return p;
  }

  async load(archetypes?: string[]): Promise<void> {
    const ids = archetypes ?? CAST.map(a => a.id);
    await Promise.all(ids.map(id => {
      let p = this.loading.get(id);
      if (!p) {
        p = this.loadOne(id);
        this.loading.set(id, p);
      }
      return p;
    }));
    this.warmWounds();
  }

  /**
   * Compiles the wound programs before anyone is shot. Left to first use, the stall lands on the first hit of the game.
   * It needs a real draw, because a program depends on the target and the lights of the pass it runs in, so a wounded
   * body is put out of sight for the first frame the renderer draws.
   */
  private warmWounds(): void {
    if (this.warmed) return;
    const entry = [...this.entries.values()].find(e => e.interior && e.def.props.length > 0)
      ?? [...this.entries.values()].find(e => e.interior);
    const scene = this.ctx.render.scene as THREE.Scene | undefined;
    if (!entry || !scene?.isScene) return;
    this.warmed = true;
    // Open wound (OP2_WOUNDS + OP2_WOUND_DISCARD + interior + backing).
    const body = this.spawn(entry.id) as Character;
    const hit = { kind: WoundKind.crater, bone: 0, point: new THREE.Vector3(0, 1, 0.1), dir: new THREE.Vector3(0, 0, -1), radius: 0.05, depth: 0.05, ragged: 1 };
    body.wound(hit);
    body.root.position.y = WARM_DEPTH;
    body.root.traverse(o => { o.frustumCulled = false; });
    scene.add(body.root);
    // Non-discard wound shader (OP2_WOUNDS without discard) plus charredVariant on its attached kit.
    const graze = this.spawn(entry.id) as Character;
    graze.wound({ ...hit, kind: WoundKind.graze });
    graze.setBurn(1);
    // A body nobody has shot, and one seen from far off, are two more programs (the plain and the far material): left to
    // first use they link as the first wave walks in. They stand beside the wounded ones for that frame.
    const plain = this.spawn(entry.id) as Character;
    const far = this.spawn(entry.id) as Character;
    far.setLod(FAR_LOD, true);
    for (const extra of [graze, plain, far]) {
      extra.root.position.y = WARM_DEPTH;
      extra.root.traverse(o => { o.frustumCulled = false; });
      scene.add(extra.root);
    }
    body.inside!.onAfterRender = () => {
      body.inside!.onAfterRender = () => {};
      queueMicrotask(() => {
        for (const warm of [body, graze, plain, far]) {
          warm.root.traverse(o => { o.frustumCulled = true; });
          warm.release();
        }
      });
    };
  }

  private async loadOne(id: string): Promise<void> {
    const def = archetypeById(id);
    const { model, material, woundMaterial, woundDiscardMaterial, farMaterial } = await this.loadModel(id);
    await Promise.all(kitOf(def).map(async p => {
      this.propCache.set(p.model, await this.loadModel(p.model));
    }));
    const bindPositions = model.meta.skeleton.map(b => new THREE.Vector3(...b.pos));
    const bindInverses = bindPositions.map(p => new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    const n = model.meta.skeleton.length;
    const children: number[][] = Array.from({ length: n }, () => []);
    model.meta.skeleton.forEach((b, i) => {
      if (b.parent >= 0 && i < model.meta.rigBoneCount) children[b.parent]!.push(i);
    });
    const rig = rigFor(def);
    // Flesh on a person's skeleton. Anything else takes dents, not holes.
    const fleshy = def.rig === 'humanoid' && def.stumps === 'flesh';
    const interior = fleshy ? buildInterior(model, rig, bindPositions, id.length * 977 + n) : null;
    const walkMesh = fleshy ? buildWalkMesh(model) : null;
    const interiorMaterial = fleshy ? createInteriorMaterial(this.ctx, this.detail!, n * 4) : null;
    const backingMaterial = fleshy ? createBackingMaterial(n * 4) : null;
    const entry: Entry = {
      id, def, rig, model, material, woundMaterial, woundDiscardMaterial, farMaterial, interior, walkMesh, bloodPool: this.bloodPool, interiorMaterial, backingMaterial, time: this.ctx.time, boneCount: n, bindInverses, bindPositions, children,
      free: [], active: new Set(), freeLimbs: [], activeLimbs: [],
      acquireLimb: () => this.acquireLimb(entry),
    };
    this.entries.set(id, entry);
  }

  private acquireLimb(e: Entry): SeveredPart {
    let part = e.freeLimbs.pop();
    if (!part) {
      if (e.activeLimbs.length >= MAX_LIMBS_PER_ARCHETYPE) {
        // Oldest-out: the limb most likely to have settled and be out of view.
        e.activeLimbs[0]!.release();
        part = e.freeLimbs.pop()!;
      } else {
        part = new SeveredPart(e);
        part.releaseHook = p => {
          p.live = false;
          const i = e.activeLimbs.indexOf(p);
          if (i >= 0) e.activeLimbs.splice(i, 1);
          e.freeLimbs.push(p);
        };
      }
    }
    part.live = true;
    e.activeLimbs.push(part);
    return part;
  }

  private makeProp(id: string, name: string): THREE.Mesh | null {
    const loaded = this.propCache.get(id);
    if (!loaded) return null;
    const mesh = new THREE.Mesh(loaded.model.lods[0]!, loaded.material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private readonly propCache = new Map<string, Loaded>();

  /** A new mesh of a baked prop, for props that live outside a character such as dropped weapons. */
  async prop(id: string): Promise<THREE.Mesh> {
    const loaded = await this.loadModel(id);
    this.propCache.set(id, loaded);
    return this.makeProp(id, id)!;
  }

  spawn(archetype: string): CharacterInstance {
    const e = this.entries.get(archetype);
    if (!e) throw new Error(`Archetype "${archetype}" is not loaded. Call load() first.`);
    let c = e.free.pop();
    if (!c) {
      if (e.active.size >= MAX_INSTANCES_PER_ARCHETYPE) {
        const oldest = e.active.values().next().value!;
        oldest.release();
        c = e.free.pop()!;
      } else {
        c = new Character(e);
        this.fitProps(e, c);
        this.wireGround(e, c);
        c.releaseHook = inst => {
          if (!inst.live) return;
          inst.live = false;
          inst.root.removeFromParent();
          inst.reset();
          e.active.delete(inst);
          e.free.push(inst);
        };
      }
    }
    c.live = true;
    e.active.add(c);
    return c;
  }

  /** Foot plants sample the real floor, and heavy bodies shake the camera and kick up dust as they land. */
  private wireGround(e: Entry, c: Character): void {
    const { ctx } = this;
    c.anim.groundAt = (x, y, z) => ctx.world.nav?.groundHeight?.(x, y, z) ?? Number.NaN;
    // Every foot plant goes to gore: a foot that has stepped in blood leaves prints.
    c.anim.onFootstep = (x, y, z, strength) => ctx.gore.footfall?.(c, x, y, z, strength);
    if (e.def.weight < 0.7) return;
    const reach = e.rig.height * 6;
    const dust = new THREE.Vector3();
    c.anim.onFootstep = (x, y, z, strength) => {
      ctx.gore.footfall?.(c, x, y, z, strength);
      dust.set(x, y + 0.05, z);
      ctx.fx.smoke?.(dust, 0x8894a4, 0.5 * e.def.proportions.scale, 0.5);
      const p = ctx.player.position;
      const d = p ? Math.hypot(p.x - x, p.z - z) : Number.NaN;
      if (d < reach) ctx.camera.addTrauma?.(e.def.weight * strength * 0.3 * (1 - d / reach));
    };
  }

  /** Mounts the archetype's baked props and tells the animator how they are held. */
  private fitProps(e: Entry, c: Character): void {
    for (const p of kitOf(e.def)) this.mount(e, c, p, e.def.stance, false);
  }

  /**
   * Fits baked props to a body for as long as it is out, as if its archetype carried them, and sets how they are held: for one
   * body that carries different kit per wearer (the allies' Bailiffs). Whatever the last `arm` fitted is replaced. Load the props
   * first (`prop(id)`). Humanoids only.
   */
  arm(char: CharacterInstance, kit: readonly { model: string; socket: string }[], stance: ArchetypeDef['stance']): void {
    const c = char as Character;
    const e = this.entries.get(c.archetype);
    if (!e || e.def.rig !== 'humanoid') return;
    const anim = c.anim as unknown as HumanoidAnimator;
    for (let i = c.props.length - 1; i >= 0; i--) {
      const p = c.props[i]!;
      if (!p.object.userData.armed) continue;
      p.object.removeFromParent();
      c.props.splice(i, 1);
    }
    c.muzzle = null;
    anim.setGrip(null);
    anim.setShield(null);
    anim.setStance(stance);
    for (const p of kit) this.mount(e, c, p, stance, true);
  }

  private mount(e: Entry, c: Character, p: { model: string; socket: string }, stance: ArchetypeDef['stance'], armed: boolean): void {
    const sock = e.model.meta.sockets[p.socket];
    const loaded = this.propCache.get(p.model);
    if (!sock || !loaded) return;
    const mesh = this.makeProp(p.model, p.model)!;
    mesh.position.set(sock.pos[0], sock.pos[1], sock.pos[2]);
    mesh.quaternion.set(sock.rot[0], sock.rot[1], sock.rot[2], sock.rot[3]);
    if (armed) mesh.userData.armed = true;
    c.attachProp(sock.bone, mesh);
    const scale = e.def.proportions.scale;
    const muzzle = loaded.model.meta.sockets.muzzle;
    if (muzzle && !c.muzzle) {
      c.muzzle = new THREE.Object3D();
      c.muzzle.position.set(muzzle.pos[0], muzzle.pos[1], muzzle.pos[2]);
      mesh.add(c.muzzle);
    }
    if (e.def.rig !== 'humanoid') return;
    const anim = c.anim as unknown as HumanoidAnimator;
    if (p.socket === 'handR' && stance !== 'blades') {
      const fg = loaded.model.meta.sockets.foregrip;
      anim.setGrip({
        socketPos: new THREE.Vector3(sock.pos[0], sock.pos[1], sock.pos[2]),
        socketRot: new THREE.Quaternion(sock.rot[0], sock.rot[1], sock.rot[2], sock.rot[3]),
        foregrip: fg ? new THREE.Vector3(fg.pos[0], fg.pos[1], fg.pos[2]).multiplyScalar(scale) : null,
      });
      mesh.scale.setScalar(scale);
    } else if (p.socket === 'handL' && stance === 'shield') {
      anim.setShield(new THREE.Quaternion(sock.rot[0], sock.rot[1], sock.rot[2], sock.rot[3]));
      mesh.scale.setScalar(scale);
    } else {
      mesh.scale.setScalar(scale);
    }
  }

  /**
   * The archetype's skin without the engine's light volume and moon shadow, for a scene the world renderer does not
   * light: the main menu's background lights itself with ordinary three.js lights. Load the archetype first.
   */
  async plainMaterial(archetype: string): Promise<THREE.Material> {
    const loaded = await this.loadModel(archetype);
    loaded.plain ??= createCharacterMaterial({ render: {} } as Ctx, loaded.surface);
    return loaded.plain;
  }

  /**
   * Frees an archetype nothing is using: geometry, atlases, materials and the pooled instances. For the ones loaded on
   * request, like the menu's contractor. Returns false, and frees nothing, while any instance or limb is still out.
   */
  unload(archetype: string): boolean {
    const e = this.entries.get(archetype);
    const p = this.models.get(archetype);
    if (!e || !p) return false;
    if (e.active.size > 0 || e.activeLimbs.length > 0) return false;
    for (const c of e.free) c.skeleton.dispose();
    for (const l of e.freeLimbs) l.skeleton.dispose();
    e.interior?.dispose();
    e.interiorMaterial?.dispose();
    e.backingMaterial?.dispose();
    this.entries.delete(archetype);
    this.loading.delete(archetype);
    this.models.delete(archetype);
    void p.then(l => {
      const { model } = l;
      for (const g of [...model.lods, ...model.lodsWithCaps, ...model.chains.values()]) g.dispose();
      for (const m of new Set([l.material, l.woundMaterial, l.woundDiscardMaterial, l.farMaterial, l.plain])) m?.dispose();
      l.surface.atlasA?.dispose();
      l.surface.atlasB?.dispose();
    });
    return true;
  }

  rig(archetype: string) {
    return this.entries.get(archetype)?.rig ?? rigFor(archetypeById(archetype));
  }

  archetypes(): string[] {
    return CAST.map(a => a.id);
  }

  sockets(archetype: string): Record<string, Socket> {
    return this.entries.get(archetype)?.model.meta.sockets ?? {};
  }
}
