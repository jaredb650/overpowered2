/** Loads baked models and pools skinned instances per archetype, all sharing geometry. */
import * as THREE from 'three';
import type { CharacterInstance, CharacterLibrary, Ctx } from '../core/contracts';
import { ARCHETYPES, archetypeById, rigFor } from './archetypes';
import { Character, SeveredPart, type ArchetypeData } from './Character';
import { buildInterior } from './anatomy/build';
import { createInteriorMaterial } from './anatomy/interior';
import { createShadowMaterial } from './anatomy/shadow';
import { WoundKind } from './anatomy/wounds';
import { createCharacterMaterial, createDetailTexture } from './material';
import { parseModel, type LoadedModel } from './model';
import type { HumanoidAnimator } from './animation/index';
import type { Manifest, Socket } from './format';

const BASE = 'assets/characters/';
/** Enough for the 48 live enemies with room for corpses held by gore. */
const MAX_INSTANCES_PER_ARCHETYPE = 96;
const MAX_LIMBS_PER_ARCHETYPE = 24;
/** Far enough under the world that nothing can see it. */
const WARM_DEPTH = -2000;

interface Loaded {
  model: LoadedModel;
  material: THREE.Material;
  woundMaterial: THREE.Material;
  farMaterial: THREE.Material;
}

interface Entry extends ArchetypeData {
  free: Character[];
  active: Set<Character>;
  freeLimbs: SeveredPart[];
  activeLimbs: SeveredPart[];
}

async function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing ${url}`);
  // Metalness and emissive live in alpha, so the browser must not premultiply it into the colour.
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
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
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly models = new Map<string, Promise<Loaded>>();
  private detail: THREE.Texture | null = null;
  private manifest: Promise<Manifest> | null = null;
  private warmed = false;

  constructor(private readonly ctx: Ctx) {}

  private getManifest(): Promise<Manifest> {
    this.manifest ??= fetch(`${BASE}manifest.json`).then(r => r.json() as Promise<Manifest>);
    return this.manifest;
  }

  private async loadModel(id: string): Promise<Loaded> {
    let p = this.models.get(id);
    if (!p) {
      p = (async () => {
        const manifest = await this.getManifest();
        const file = manifest.models[id]?.file;
        if (!file) throw new Error(`Model "${id}" is not baked. Run tools/bake/bake.ts ${id}`);
        const res = await fetch(`${BASE}${file}`);
        const model = parseModel(await res.arrayBuffer());
        this.detail ??= createDetailTexture();
        const atlas = model.meta.atlas;
        const [atlasA, atlasB] = atlas
          ? await Promise.all([loadTexture(BASE + atlas.albedo, true), loadTexture(BASE + atlas.normal, false)])
          : [null, null];
        const surface = { detail: this.detail, atlasA, atlasB, extraBase: model.meta.skeleton.length * 4 };
        const material = createCharacterMaterial(this.ctx, surface);
        const character = model.meta.kind === 'character';
        const farMaterial = character ? createCharacterMaterial(this.ctx, { ...surface, far: true }) : material;
        const woundMaterial = character ? createCharacterMaterial(this.ctx, { ...surface, wounds: true }) : material;
        return { model, material, woundMaterial, farMaterial };
      })();
      this.models.set(id, p);
    }
    return p;
  }

  async load(archetypes?: string[]): Promise<void> {
    const ids = archetypes ?? ARCHETYPES.map(a => a.id);
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
    const entry = [...this.entries.values()].find(e => e.interior);
    const scene = this.ctx.render.scene as THREE.Scene | undefined;
    if (!entry || !scene?.isScene) return;
    this.warmed = true;
    const body = this.spawn(entry.id) as Character;
    const hit = { kind: WoundKind.crater, bone: 0, point: new THREE.Vector3(0, 1, 0.1), dir: new THREE.Vector3(0, 0, -1), radius: 0.05, depth: 0.05, ragged: 1 };
    body.wound(hit);
    body.root.position.y = WARM_DEPTH;
    body.root.traverse(o => { o.frustumCulled = false; });
    scene.add(body.root);
    body.inside!.onAfterRender = () => {
      body.inside!.onAfterRender = () => {};
      queueMicrotask(() => {
        body.root.traverse(o => { o.frustumCulled = true; });
        body.release();
      });
    };
  }

  private async loadOne(id: string): Promise<void> {
    const def = archetypeById(id);
    const { model, material, woundMaterial, farMaterial } = await this.loadModel(id);
    await Promise.all(def.props.map(async p => {
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
    const interiorMaterial = fleshy ? createInteriorMaterial(this.ctx, this.detail!, n * 4) : null;
    const shadowMaterial = fleshy ? createShadowMaterial(n * 4) : null;
    const entry: Entry = {
      id, def, rig, model, material, woundMaterial, farMaterial, interior, interiorMaterial, shadowMaterial, time: this.ctx.time, boneCount: n, bindInverses, bindPositions, children,
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
    if (e.def.weight < 0.7) return;
    const reach = e.rig.height * 6;
    const dust = new THREE.Vector3();
    c.anim.onFootstep = (x, y, z, strength) => {
      dust.set(x, y + 0.05, z);
      ctx.fx.smoke?.(dust, 0x8894a4, 0.5 * e.def.proportions.scale, 0.5);
      const p = ctx.player.position;
      const d = p ? Math.hypot(p.x - x, p.z - z) : Number.NaN;
      if (d < reach) ctx.camera.addTrauma?.(e.def.weight * strength * 0.3 * (1 - d / reach));
    };
  }

  /** Mounts the archetype's baked props and tells the animator how they are held. */
  private fitProps(e: Entry, c: Character): void {
    const sockets = e.model.meta.sockets;
    for (const p of e.def.props) {
      const sock = sockets[p.socket];
      const loaded = this.propCache.get(p.model);
      if (!sock || !loaded) continue;
      const mesh = this.makeProp(p.model, p.model)!;
      mesh.position.set(sock.pos[0], sock.pos[1], sock.pos[2]);
      mesh.quaternion.set(sock.rot[0], sock.rot[1], sock.rot[2], sock.rot[3]);
      c.attachProp(sock.bone, mesh);
      const scale = e.def.proportions.scale;
      const muzzle = loaded.model.meta.sockets.muzzle;
      if (muzzle && !c.muzzle) {
        c.muzzle = new THREE.Object3D();
        c.muzzle.position.set(muzzle.pos[0], muzzle.pos[1], muzzle.pos[2]);
        mesh.add(c.muzzle);
      }
      if (e.def.rig !== 'humanoid') continue;
      const anim = c.anim as unknown as HumanoidAnimator;
      if (p.socket === 'handR' && e.def.stance !== 'blades') {
        const fg = loaded.model.meta.sockets.foregrip;
        anim.setGrip({
          socketPos: new THREE.Vector3(sock.pos[0], sock.pos[1], sock.pos[2]),
          socketRot: new THREE.Quaternion(sock.rot[0], sock.rot[1], sock.rot[2], sock.rot[3]),
          foregrip: fg ? new THREE.Vector3(fg.pos[0], fg.pos[1], fg.pos[2]).multiplyScalar(scale) : null,
        });
        mesh.scale.setScalar(scale);
      } else if (p.socket === 'handL' && e.def.stance === 'shield') {
        anim.setShield(new THREE.Quaternion(sock.rot[0], sock.rot[1], sock.rot[2], sock.rot[3]));
        mesh.scale.setScalar(scale);
      } else {
        mesh.scale.setScalar(scale);
      }
    }
  }

  rig(archetype: string) {
    return this.entries.get(archetype)?.rig ?? rigFor(archetypeById(archetype));
  }

  archetypes(): string[] {
    return ARCHETYPES.map(a => a.id);
  }

  sockets(archetype: string): Record<string, Socket> {
    return this.entries.get(archetype)?.model.meta.sockets ?? {};
  }
}
