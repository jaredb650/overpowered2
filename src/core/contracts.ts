/**
 * Cross-system contracts for OVERPOWERED 2.
 *
 * Systems talk to each other through these interfaces and through typed events, never through each
 * other's concrete classes. A system owner may ADD to its own interface. Changing an existing
 * signature means updating every caller.
 */
import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from './events';
import type { GameTime } from './time';
import type { GoreRegion, RigDef } from '../characters/rig';

// ---------------------------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------------------------

export type SurfaceKind = 'concrete' | 'metal' | 'grate' | 'dirt' | 'glass' | 'flesh' | 'armor' | 'energy' | 'lava';

export type DamageType =
  | 'bullet' | 'pellet' | 'explosive' | 'melee' | 'slash' | 'fire' | 'shock' | 'crush' | 'true';

/**
 * Newton-seconds a hit pushes with when its `force` is 0. One table, because the living and the dead reading different
 * numbers is how a corpse came to fly further from a bullet than the body it had been.
 */
export const DEFAULT_FORCE: Record<DamageType, number> = {
  bullet: 20, pellet: 30, explosive: 130, melee: 90, slash: 60, fire: 5, shock: 15, crush: 200, true: 10,
};

/** A single application of damage to an enemy. */
export interface DamageInfo {
  amount: number;
  type: DamageType;
  /** World-space hit position. */
  point: THREE.Vector3;
  /** Normalized travel direction of the attack at the hit point. */
  dir: THREE.Vector3;
  /** Push in newton-seconds on ragdolls and severed parts. 0 uses a default for the type. */
  force: number;
  /** Which weapon or call-in caused it, e.g. 'smg', 'rocket', 'airstrike'. */
  source: string;
  /** Set by hit detection when a specific region was struck. */
  region?: GoreRegion;
  /** Bone index that was struck. */
  bone?: number;
  /** Sword only: the plane of the cut, used for slice kills. */
  slicePlaneNormal?: THREE.Vector3;
  /** Forces a full gib on a lethal hit (a rocket's own contact, a crusher, and the like). */
  gib?: boolean;
  /** Multiplier on limb sever damage. Shotguns and swords are > 1. */
  severMult?: number;
  /** A blast's splash: how far out the body stood, as a share of the radius. Rings in src/enemies/blast.ts read it. */
  reach?: number;
  blastKind?: ExplosionKind;
  /** Goes through armour plates as if they were not there. A shaped charge's direct hit. */
  pierces?: boolean;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  surface: SurfaceKind;
  collider: RAPIER.Collider | null;
}

/** Collision membership bits. Combine with `|`. */
export const CG = {
  World: 1 << 0,
  Player: 1 << 1,
  Enemy: 1 << 2,
  Ragdoll: 1 << 3,
  Gib: 1 << 4,
  Debris: 1 << 5,
  Projectile: 1 << 6,
  Trigger: 1 << 7,
  /** Stops the player and nothing else. Bullets, bodies, nav and light pass through: see Site.barrier in world/map/outpost. */
  Barrier: 1 << 8,
} as const;

/** Lifecycle shared by all systems. `update` is called by Game once per frame. */
export interface GameSystem {
  init?(ctx: Ctx): void | Promise<void>;
  /** Called once per frame. Pick the clock you need from ctx.time. */
  update?(): void;
  /** Called when a new run starts. Clear all transient state. */
  reset?(): void;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

export type GradeName = 'default' | 'bloodthirst' | 'hellfire' | 'berserk' | 'slowmo' | 'adrenaline' | 'overdrive' | 'death' | 'thermal' | 'blackout';

export interface PostFx {
  /** Crossfades the colour grade. */
  setGrade(name: GradeName, blendSeconds?: number): void;
  /** Additive full-screen flash that decays over `seconds`. */
  flash(color: THREE.ColorRepresentation, intensity: number, seconds: number): void;
  /** Short chromatic aberration pulse. */
  chromatic(amount: number, seconds: number): void;
  /** Short radial zoom blur pulse centred on the screen. */
  radialBlur(amount: number, seconds: number): void;
  /** 0..1 continuous speed effect (edge smear and speed lines). */
  setSpeed(amount: number): void;
  /** 0..1 continuous low-health effect (red vignette, desaturation, pulse). */
  setLowHealth(amount: number): void;
  /** 0..1 continuous softening of the whole image, the middle of it included: under fire, or still seeing stars. */
  setSuppression?(amount: number): void;
  /** Directional hit marker: a red bloom on the screen edge. `angle` is radians, 0 = ahead, clockwise. */
  damageDirection(angle: number, intensity: number): void;
}

export interface DynamicLights {
  /** A short-lived point light from a pool. The brightest few are live at once. */
  flash(position: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, radius: number, seconds: number): void;
}

export type DecalKind = 'bullet' | 'scorch' | 'blood' | 'bloodPool' | 'bloodSmear' | 'slash' | 'crack';

export interface DecalSystem {
  add(kind: DecalKind, position: THREE.Vector3, normal: THREE.Vector3, size: number, rotation?: number): void;
  clear(): void;
}

/** A static coloured light that gets baked into the light volume. */
export interface BakedLight {
  position: THREE.Vector3;
  color: THREE.ColorRepresentation;
  intensity: number;
  radius: number;
}

export interface LightVolumeBakeInput {
  bounds: THREE.Box3;
  lights: BakedLight[];
  /** Solid-space test used for occlusion, in world coordinates. */
  isSolid(x: number, y: number, z: number): boolean;
  /** Target voxel edge in meters. Defaults to 1.5. Dimensions are capped at 200 x 48 x 200. */
  voxelSize?: number;
}

export type WorldMaterialName =
  | 'concrete' | 'concreteDark' | 'asphalt' | 'steel' | 'steelDark' | 'rust' | 'grate' | 'hazard' | 'panel' | 'tile'
  | 'dirt' | 'glass' | 'rubber' | 'paintRed' | 'paintYellow' | 'paintWhite'
  | 'emissiveCyan' | 'emissiveMagenta' | 'emissiveOrange' | 'emissiveRed' | 'emissiveWhite' | 'lava';

export interface MaterialLibrary {
  /** Shared PBR world material. World-space UVs at 1 unit = 1 meter, per the tiling in the texture set. */
  world(name: WorldMaterialName): THREE.Material;
  /** Injects the engine's lighting (light volume, fog) into a custom MeshStandardMaterial. Call before first use. */
  patch<T extends THREE.MeshStandardMaterial>(material: T): T;
}

export interface RenderSystem extends GameSystem {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** First-person weapon scene. Drawn after the world with a cleared depth buffer and its own FOV. */
  viewScene: THREE.Scene;
  viewCamera: THREE.PerspectiveCamera;
  materials: MaterialLibrary;
  post: PostFx;
  lights: DynamicLights;
  decals: DecalSystem;
  /** Bakes static lights. Call once after the map is built. */
  bakeLightVolume(input: LightVolumeBakeInput): Promise<void>;
  /** Scene depth from this frame, for soft particles. Null until the first render or when unavailable. */
  readonly depthTexture: THREE.DepthTexture | null;
  /** Render one frame. Reads the camera as left by CameraRig. */
  render(): void;
  /**
   * X-ray: draws these meshes as silhouettes through anything in front of them, for the next rendered frame only.
   * Call it every frame they should show, so a pooled character can never stay lit. `strength` 0..1 fades them.
   */
  highlight(meshes: readonly THREE.Object3D[], color: THREE.ColorRepresentation, strength?: number): void;
  /** A ring that sweeps out from `origin` at `speed` m/s over every surface in view, and dies out at `reach` metres. */
  sweep(origin: THREE.Vector3, color: THREE.ColorRepresentation, speed: number, reach: number): void;
  /** Quality preset 0 (low) to 3 (ultra). */
  setQuality(level: number): void;
  drawCalls(): number;
  triangles(): number;
}

// ---------------------------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------------------------

export interface PhysicsSystem extends GameSystem {
  readonly R: typeof RAPIER;
  readonly world: RAPIER.World;
  /** Steps the simulation by world time. Runs fixed sub-steps with `scale` applied to the timestep. */
  step(dt: number): void;
  /** Blocking world raycast. `mask` is a CG combination; default is CG.World. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask?: number): RayHit | null;
  /** Sweep a vertical capsule through the world. Returns the first hit, or null. */
  sweepCapsule(
    from: THREE.Vector3, radius: number, halfHeight: number, motion: THREE.Vector3, mask?: number,
  ): { fraction: number; point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider } | null;
  /** True when a vertical capsule at `center` overlaps anything in `mask`. */
  overlapCapsule(center: THREE.Vector3, radius: number, halfHeight: number, mask?: number): boolean;
  /** Static world geometry. */
  addStaticBox(center: THREE.Vector3, halfExtents: THREE.Vector3, rotation: THREE.Quaternion | null, surface: SurfaceKind): RAPIER.Collider;
  addStaticMesh(vertices: Float32Array, indices: Uint32Array, surface: SurfaceKind): RAPIER.Collider;
  /** Surface kind stored on a collider. */
  surfaceOf(collider: RAPIER.Collider): SurfaceKind;
  /** Applies a radial impulse to every dynamic body in range (ragdolls, gibs, debris). */
  radialImpulse(center: THREE.Vector3, radius: number, strength: number): void;
  /** Run before every sub-step with the timestep. Ragdoll joint limits live here. */
  readonly preStep: Set<(dt: number) => void>;
  /** Told about every radialImpulse before it is applied, so frozen corpses can wake up and take it. */
  readonly radialListeners: Set<(center: THREE.Vector3, radius: number, strength: number) => void>;
  /** Allocation-free raycast for hot paths. Writes into `out`, whose vectors must already exist. */
  raycastInto(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask: number, out: RayHit): boolean;
  /** One fixed body at the origin, used as the far side of world-anchored joints such as stakes. */
  readonly anchorBody: RAPIER.RigidBody;
  /** Wall time of the last step() in milliseconds. Diagnostic only. */
  readonly stepMs: number;
}

// ---------------------------------------------------------------------------------------------
// Characters and gore
// ---------------------------------------------------------------------------------------------

/** High-level locomotion state fed to a character's animation each frame. */
export interface LocomotionInput {
  /** Horizontal speed in m/s. */
  speed: number;
  /** Movement direction in character space, unit length when moving. */
  moveX: number;
  moveZ: number;
  /** Aim offset relative to the body, in radians. */
  aimYaw: number;
  aimPitch: number;
  /** 0 = upright, 1 = fully crawling. Set automatically once legs are lost. */
  grounded: boolean;
}

export type AnimAction =
  | 'attackMelee' | 'attackHeavy' | 'shoot' | 'throw' | 'leap' | 'land' | 'roar' | 'stagger' | 'block' | 'deathStumble';

export interface CharacterAnimation {
  setLocomotion(input: LocomotionInput): void;
  /** Plays an action layer on top of locomotion. Returns its duration in seconds. */
  play(action: AnimAction, speed?: number): number;
  /** Additive spring impulse on one bone in response to a hit (world-space direction). */
  flinch(bone: number, worldDir: THREE.Vector3, magnitude: number): void;
  /** Advance by world dt. `lod` 0 is full rate; higher values skip work. */
  update(dt: number, lod: number): void;
}

/** One live character mesh: skinned model, skeleton, animation and gore state. Pooled per archetype. */
export interface CharacterInstance {
  readonly archetype: string;
  readonly rig: RigDef;
  /** Add this to the scene. Set its position and rotation.y for placement. */
  readonly root: THREE.Object3D;
  /** Index-aligned with rig.bones. */
  readonly bones: readonly THREE.Bone[];
  readonly mesh: THREE.SkinnedMesh;
  readonly anim: CharacterAnimation;
  /** Regions cut off so far. */
  readonly severed: ReadonlySet<GoreRegion>;
  /** Hides a bone and all its children and shows the stump cap. Pure visual; GoreSystem does the rest. */
  hideLimb(boneIndex: number): void;
  /** Paints blood and bruising at a world point on a bone. It sticks to the skin and takes nothing away. */
  addWound(boneIndex: number, worldPoint: THREE.Vector3, radius: number): void;
  /** Damages the body itself. Near wounds merge into one bigger wound. Survives into ragdolls, corpses and limbs. */
  wound(hit: WoundHit): void;
  /** Snaps the limb at this bone's joint. It stays broken in animation, and as a ragdoll. False if already broken. */
  fracture(boneIndex: number, style: 'hyper' | 'limp', skew?: number): boolean;
  isFractured(boneIndex: number): boolean;
  /** What a world-space copy of this body should be drawn with. */
  readonly skinMaterial: THREE.Material;
  /** Geometry and material detail, 0 to 3. */
  setLod?(level: number): void;
  /** Hits per bone that broke nothing yet. Gore's to read and write. Reset with the instance. */
  readonly stress: Float32Array;
  /** 0..1 overall blood coverage on the skin. */
  setBloodiness(amount: number): void;
  /** Emissive flash on hit. */
  hitFlash(intensity: number): void;
  /** Attaches a prop (gun, shield) to a bone. Falls with the bone when severed. */
  attachProp(boneIndex: number, prop: THREE.Object3D): void;
  /**
   * A second skinned mesh showing only the chain from `boneIndex` down, with the child-side stump cap
   * visible, posed exactly like this instance right now. GoreSystem drives its bones from rigid bodies.
   */
  spawnSevered(boneIndex: number): SeveredLimb;
  /** CPU-skinned copy of the current pose in world space, for plane slicing. Caller owns the geometry. */
  bakePose(): THREE.BufferGeometry;
  /** Returns the instance to its pool, restored to pristine state. */
  release(): void;
}

export interface SeveredLimb {
  readonly root: THREE.Object3D;
  readonly mesh: THREE.SkinnedMesh;
  /** Same indexing as the source rig. Only the severed chain is meaningful. */
  readonly bones: readonly THREE.Bone[];
  /** A loose limb keeps taking wounds. */
  wound(hit: WoundHit): void;
  isFractured(boneIndex: number): boolean;
  release(): void;
}

/** One wound, in world space. `WoundKind` in `characters/anatomy/wounds.ts` lists the kinds. */
export interface WoundHit {
  kind: number;
  bone: number;
  point: THREE.Vector3;
  /** Into the body. A wound is a slot along this line. */
  dir: THREE.Vector3;
  radius: number;
  /** How far under the skin it goes. */
  depth: number;
  /** 0 a clean edge, 1 torn. */
  ragged: number;
  /** A gash: which way it runs, and half its length. */
  along?: THREE.Vector3;
  length?: number;
  /** Metres past touching at which this merges with a wound already there. */
  reach?: number;
}

export interface CharacterLibrary extends GameSystem {
  /** Loads baked models. Safe to call repeatedly. */
  load(archetypes?: string[]): Promise<void>;
  spawn(archetype: string): CharacterInstance;
  rig(archetype: string): RigDef;
  archetypes(): string[];
}

export interface CapsuleHit {
  /** Distance along the ray. */
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  bone: number;
  region: GoreRegion;
}

export interface SeverResult {
  /** Regions removed, including the requested one. */
  regions: GoreRegion[];
  /** World position of the stump, for AI and effects. */
  stump: THREE.Vector3;
  /** Set by a cut through the spine: the top half, dragging itself along the floor. */
  torso?: TorsoHalf;
}

/** The top half of a character cut at the waist. Gore drives it. It claws at the player unless told otherwise. */
export interface TorsoHalf {
  readonly position: THREE.Vector3;
  /** False once it has bled out or been shot dead. */
  readonly alive: boolean;
  setTarget(point: THREE.Vector3): void;
  /** Stops it. It goes limp and settles like any corpse. */
  kill(): void;
}

export interface RagdollOptions {
  /** World-space impulses to apply on spawn. */
  impulses?: { bone: number; point: THREE.Vector3; impulse: THREE.Vector3 }[];
  /** Linear velocity the character already had. */
  velocity?: THREE.Vector3;
}

export interface GoreSystem extends GameSystem {
  /** Ray test against a character's bone capsules. */
  raycastCharacter(char: CharacterInstance, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): CapsuleHit | null;
  /**
   * Cuts off a limb. Spawns the physics part, blood trail and stump spray. Works alive or dead.
   * `velocity` is how fast the character was moving, which the limb keeps.
   */
  sever(char: CharacterInstance, region: GoreRegion, damage: DamageInfo, velocity?: THREE.Vector3): SeverResult | null;
  /** Hands the character to physics. The instance stays owned by GoreSystem until it despawns. */
  ragdoll(char: CharacterInstance, options?: RagdollOptions): void;
  /** Blows the character into limbs, chunks and mist. Releases the instance. */
  gib(char: CharacterInstance, center: THREE.Vector3, force: number): void;
  /** Bisects the character along a world plane into two physics halves. Releases the instance. */
  slice(char: CharacterInstance, point: THREE.Vector3, normal: THREE.Vector3, damage: DamageInfo): void;
  /**
   * The signature head kill. Takes ownership of the character, like ragdoll, and the body goes limp on this frame.
   * Bursts at high damage, pops the head off whole at low damage.
   */
  headshot(char: CharacterInstance, damage: DamageInfo, velocity?: THREE.Vector3): void;
  /** Nearest ragdoll, corpse or severed limb along a ray. Bodies stay shootable after death. */
  raycastCorpses(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): CorpseHit | null;
  /** Pushes, wounds and possibly cuts up a dead body. */
  damageCorpse(hit: CorpseHit, damage: DamageInfo): void;
  /**
   * Leaves the mark of a hit on the body: holes, craters, gashes, burns, broken limbs. `severity` is the share of the
   * body's health this hit took. Call it for lethal hits too, before the body is handed over. True if a limb broke.
   */
  wound(char: CharacterInstance, damage: DamageInfo, severity: number): boolean;
  /** Pins a corpse or limb to the world at a point, for the Stakegun. */
  pin(hit: CorpseHit, anchor: THREE.Vector3): void;
  clear(): void;
}

export interface CorpseHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Opaque handle owned by GoreSystem. */
  handle: unknown;
  /** Bone struck, or -1 on a sliced half, which has no bones left. */
  bone: number;
  region: GoreRegion;
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

export type MuzzleKind = 'smg' | 'rifle' | 'shotgun' | 'rocket' | 'autocannon' | 'plasma' | 'railgun' | 'minigun' | 'revolver' | 'flame' | 'enemy';
export type TracerKind = 'bullet' | 'heavy' | 'hellfire' | 'bloodthirst' | 'berserk' | 'plasma' | 'rail' | 'enemy';
export type ExplosionKind = 'rocket' | 'grenade' | 'hellfire' | 'hellfireBullet' | 'shell' | 'plasma' | 'enemy' | 'barrel' | 'nuke' | 'finisher';
export type BeamKind = 'rail' | 'lance' | 'laser' | 'sniper' | 'heal';
export type SlashKind = 'light' | 'heavy' | 'sweep' | 'finisher';
export type EmitterPreset =
  | 'stumpSpray' | 'bloodTrail' | 'rocketTrail' | 'smokeTrail' | 'fireTrail' | 'sparkTrail'
  | 'shellTrail' | 'hellfireTrail' | 'airstrikeTrail' | 'burning';

export interface ExplosionOptions {
  radius: number;
  kind?: ExplosionKind;
  /** Multiplies particle counts and sizes. */
  scale?: number;
  /** Surface normal when the blast is on a wall, so the scorch lands there. */
  normal?: THREE.Vector3;
}

export interface EmitterHandle {
  stop(): void;
  readonly alive: boolean;
}

export interface FxSystem extends GameSystem {
  /** `view` draws it in the view scene with the weapon. Pass the muzzle in view-scene coordinates then. */
  muzzleFlash(position: THREE.Vector3, dir: THREE.Vector3, kind: MuzzleKind, view?: boolean): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, kind: TracerKind): void;
  impact(position: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceKind, scale?: number): void;
  shellCasing(position: THREE.Vector3, velocity: THREE.Vector3, kind: 'pistol' | 'rifle' | 'shotgun' | 'cannon'): void;
  explosion(position: THREE.Vector3, options: ExplosionOptions): void;
  /** Wireframe shock ring, the original's signature accent. */
  ring(position: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation, size?: number): void;
  sparks(position: THREE.Vector3, dir: THREE.Vector3, count: number, color?: THREE.ColorRepresentation): void;
  smoke(position: THREE.Vector3, color?: THREE.ColorRepresentation, size?: number, seconds?: number): void;

  /** Pressurised directional blood jet. */
  bloodJet(position: THREE.Vector3, dir: THREE.Vector3, intensity?: number): void;
  /** Bullet-hit puff of blood. */
  bloodHit(position: THREE.Vector3, dir: THREE.Vector3, intensity?: number): void;
  /** Hanging red mist. */
  bloodMist(position: THREE.Vector3, size?: number): void;
  /** Chunks and droplets used by a head bursting. */
  headBurst(position: THREE.Vector3, dir: THREE.Vector3): void;
  /** Whole-body gore burst used by gibs. */
  gibBurst(position: THREE.Vector3, dir: THREE.Vector3, force: number): void;

  /** Continuous emitter that follows `target`. `preset` picks the look. */
  attachEmitter(target: THREE.Object3D, preset: EmitterPreset, offset?: THREE.Vector3, seconds?: number): EmitterHandle;
  clear(): void;

  /** The first game's createExplosion: `count` opaque one-colour chips from a point, in a dome. */
  chips(position: THREE.Vector3, color: THREE.ColorRepresentation, count: number, hellfire?: boolean): void;
  /** Rail lines, the Orbital Lance, sniper lasers. Leaves by narrowing. */
  beam(from: THREE.Vector3, to: THREE.Vector3, kind: BeamKind, width?: number, seconds?: number): void;
  /** One lightning bolt with forks. */
  arc(from: THREE.Vector3, to: THREE.Vector3, color?: THREE.ColorRepresentation, seconds?: number, width?: number): void;
  /** Sword crescent on the plane through `center` with `normal`, sweeping `arc` radians from `startDir`. */
  slash(center: THREE.Vector3, normal: THREE.Vector3, startDir: THREE.Vector3, arc: number, radius: number, kind?: SlashKind): void;
  /** One frame of flamethrower stream. Call every frame while firing. */
  flame(position: THREE.Vector3, dir: THREE.Vector3, intensity?: number): void;
  /** A frozen body breaking apart. */
  frostShatter(position: THREE.Vector3, dir: THREE.Vector3, scale?: number): void;
  /** Hot flakes that rise and wander. */
  embers(position: THREE.Vector3, count: number, spread?: number): void;
  /** Low cold dust. Landing, slides and footfalls. */
  dust(position: THREE.Vector3, normal: THREE.Vector3, scale?: number): void;
  /** Ground slam shockwave. `impact` is about 0..1. */
  slam(position: THREE.Vector3, impact: number): void;
  dashStreaks(position: THREE.Vector3, dir: THREE.Vector3): void;
  jumpPad(position: THREE.Vector3, normal: THREE.Vector3, color?: THREE.ColorRepresentation): void;
  pickupSparkle(position: THREE.Vector3, color?: THREE.ColorRepresentation): void;
  spawnIn(position: THREE.Vector3, color?: THREE.ColorRepresentation, height?: number): void;
  wallSparks(position: THREE.Vector3, normal: THREE.Vector3, along: THREE.Vector3): void;
  /** Blood drops on the camera lens for a point-blank kill. `amount` is 0..1. */
  lensBlood(amount: number): void;
  /** Hot-air distortion over a point for `seconds`. */
  heatShimmer(position: THREE.Vector3, radius: number, seconds: number): void;
}

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------

export interface PlayOptions {
  /** World position for 3D sound. Omit for a 2D sound. */
  position?: THREE.Vector3;
  volume?: number;
  /** Multiplies pitch. Use `pitchJitter` for random variation. */
  pitch?: number;
  pitchJitter?: number;
  /** When true, the sound ignores slow-mo pitch changes. */
  unaffectedByTime?: boolean;
  /** Seconds to skip at the start of the sample. */
  offset?: number;
  /** Seconds to wait before starting, scheduled on the audio clock. */
  delay?: number;
  /** Cuts the sound after this many seconds with a short fade. */
  duration?: number;
}

export type MusicState = 'menu' | 'easy' | 'hard';

export interface LoopOptions {
  /** World position for 3D sound. Omit for a 2D sound. */
  position?: THREE.Vector3;
  volume?: number;
  pitch?: number;
  /** Seconds to fade in. Defaults to the catalogue's value for the id. */
  fadeIn?: number;
  unaffectedByTime?: boolean;
  /** Bends pitch as the sound moves relative to the listener. For fast things driven by setPosition. */
  doppler?: boolean;
}

/** A running looped sound. Every method is safe after it stops, or if it was evicted. */
export interface LoopHandle {
  readonly alive: boolean;
  setVolume(volume: number, seconds?: number): void;
  setPitch(pitch: number, seconds?: number): void;
  setPosition(position: THREE.Vector3): void;
  /** Fades out over `seconds`, then frees the voice. */
  stop(seconds?: number): void;
}

/** One sample in a layered sound. All layers start on the same audio frame. */
export interface SoundLayer {
  id: string;
  volume?: number;
  pitch?: number;
  offset?: number;
  delay?: number;
  duration?: number;
}

export interface AudioSystem extends GameSystem {
  /** Plays a sound by its id, e.g. 'smg_fire'. Unknown ids log once and do nothing. */
  play(id: string, options?: PlayOptions): void;
  /** Picks a random id from the list. */
  playOneOf(ids: readonly string[], options?: PlayOptions): void;
  setListener(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void;
  music(state: MusicState): void;
  setVolumes(master: number, sfx: number, music: number): void;
  /** Must be called from a user gesture. */
  unlock(): void;
  /** Starts a controllable looped sound. Unknown ids return a dead handle. */
  startLoop(id: string, options?: LoopOptions): LoopHandle;
  /** Plays several sounds on the same audio frame. `options` apply to the whole stack. */
  layer(layers: readonly SoundLayer[], options?: PlayOptions): void;
  /** Dips the music by `amount` (0..1) for `seconds`. Big sounds already do this themselves. */
  duck(amount: number, seconds: number): void;
  /** True when `id` resolves to a sound. */
  has(id: string): boolean;
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'dash' | 'slide' | 'fire' | 'aim' | 'reload'
  | 'melee' | 'grenade' | 'interact' | 'weaponNext' | 'weaponPrev' | 'weaponLast'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'weapon5' | 'weapon6' | 'weapon7' | 'weapon8' | 'weapon9' | 'weapon0'
  | 'streak' | 'callinWarthog' | 'callinDoorGunner' | 'callinChopper' | 'callinOrbital' | 'callinAc130' | 'callinBlackSun' | 'callinNuke' | 'sonar'
  | 'pause' | 'scoreboard' | 'debugFps' | 'debugOverlay';

export interface InputSystem extends GameSystem {
  isDown(action: Action): boolean;
  /** True for the single frame the action was pressed. */
  pressed(action: Action): boolean;
  released(action: Action): boolean;
  /** Mouse motion since the last call, in pixels, with sensitivity not applied. */
  consumeLook(): { x: number; y: number };
  /** Wheel notches since the last call. */
  consumeWheel(): number;
  requestLock(): void;
  releaseLock(): void;
  readonly locked: boolean;
  /** Bots and tests drive the game through these. They bypass pointer lock. */
  simulate(action: Action, down: boolean): void;
  simulateLook(dx: number, dy: number): void;
  /** Called by Game at the end of each frame. */
  endFrame(): void;
  /**
   * The look motion of this frame, in pixels, for anything other than the player: weapon sway, sword direction.
   * Reading it consumes nothing. PlayerSystem is the only caller of consumeLook, so this is valid after it runs.
   */
  readonly frameLook: { readonly x: number; readonly y: number };
  /** The codes bound to an action, for menus. */
  bindingsFor(action: Action): readonly string[];
  /** Short text for an action's first binding, for prompts. */
  labelFor(action: Action): string;
  /** Replaces an action's bindings and saves them to localStorage. */
  rebind(action: Action, codes: readonly string[]): void;
  /** Other actions already using `code`. */
  conflicts(code: string, except?: Action): Action[];
  resetBindings(): void;
  /** The next key, button or wheel notch goes to `callback` instead of the game. Esc gives null. */
  captureNext(callback: (code: string | null) => void): void;
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

/** A view that is not the player's: a gunner's seat. The owner rewrites it every frame, and the rig adds shake and kicks. */
export interface SeatView {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  /** Multiplies every shake that arrives while this view is up. */
  shake: number;
}

export interface CameraRig extends GameSystem {
  /** Adds shake. Trauma is squared into amplitude and decays over time. */
  addTrauma(amount: number): void;
  /** Instant view kick in radians that springs back. */
  kick(pitch: number, yaw: number, roll?: number): void;
  /** Temporary FOV offset in degrees. */
  fovPunch(degrees: number, seconds: number): void;
  /** Continuous FOV override for scopes; null restores it. */
  setZoom(fov: number | null): void;
  /** The world FOV as last composed, in degrees. */
  readonly fov: number;
  /** Player-facing FOV setting. Speed, punches and zoom are composed on top of it. */
  setBaseFov(degrees: number): void;
  /** Hands the view to a seat. Null gives it back to the player, exactly as it was left. */
  setSeat(view: SeatView | null): void;
  /**
   * Puts the camera on the seat now. A seat moves fast and fires before the rig's turn in the frame, and anything that
   * reads the camera for a shot, as a muzzle flash does, would otherwise get last frame's.
   */
  syncSeat(): void;
}

export interface PlayerDamage {
  amount: number;
  /** Where the damage came from, for the hit indicator. */
  from?: THREE.Vector3;
  type: DamageType | 'contact' | 'hazard';
  source: string;
}

/** One word for what the player is doing, for HUD, animation and style scoring. */
export type PlayerMoveState = 'ground' | 'crouch' | 'air' | 'slide' | 'dash' | 'wallrun' | 'mantle' | 'slam' | 'dead';

export interface PlayerSystem extends GameSystem {
  /** Feet position. */
  readonly position: THREE.Vector3;
  /** Camera position after the view offsets, before shake. */
  readonly eye: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** Unit look direction. */
  readonly forward: THREE.Vector3;
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  armor: number;
  readonly grounded: boolean;
  readonly sliding: boolean;
  readonly wallRunning: boolean;
  readonly dashing: boolean;
  readonly alive: boolean;
  /** Multiplier on move speed. Perks and powerups write to this through `modifiers`. */
  modifiers: PlayerModifiers;
  takeDamage(damage: PlayerDamage): void;
  /** With `overheal` true, health may rise past max, as Mega Health does. */
  heal(amount: number, overheal?: boolean): void;
  addArmor(amount: number): void;
  /** Replaces vertical speed and adds horizontal speed, as jump pads and blasts do. */
  launch(velocity: THREE.Vector3): void;
  /** Places the player, clearing motion. */
  teleport(position: THREE.Vector3, yaw?: number): void;
  /** Adds velocity on all axes, for blasts that should stack with a jump rather than replace it. */
  push(velocity: THREE.Vector3): void;
  /** Horizontal speed in m/s. */
  readonly speed: number;
  readonly state: PlayerMoveState;
  readonly crouched: boolean;
  readonly slamming: boolean;
  readonly mantling: boolean;
  /** 0 to 2, fractional while recharging. */
  readonly dashCharges: number;
  /** What the feet last touched, for footsteps. */
  readonly groundSurface: SurfaceKind;
  /** -1 running on a wall to the left of the view, +1 to the right, 0 not wall running. */
  readonly wallSide: number;
  /** Footstep clock. Whole numbers are foot plants; it only advances with real distance on the ground or a wall. */
  readonly stridePhase: number;
  /** Radians of look per pixel. A player setting. */
  sensitivity: number;
  invertY: boolean;
  /** Multiplier on mouse look. CameraRig writes it so scoped aim keeps the same on-screen speed. */
  lookScale: number;
  /** True while the body waits on the ground for a seat to end. */
  readonly parked: boolean;
  /** Asked before every hit. Returning true means something else took it. */
  interceptor: ((damage: PlayerDamage) => boolean) | null;
  /** Puts the body at `feet` and holds it there: no input, no motion, and nothing can touch it. The view is kept. */
  park(feet: THREE.Vector3): void;
  /** Gives the body back, still untouchable for `grace` seconds, because whatever came for it is standing round it. */
  unpark(grace: number): void;
}

export interface PlayerModifiers {
  speed: number;
  jump: number;
  damageTaken: number;
  invulnerable: boolean;
  /** Skyfall: dashes in the air spend no charge. */
  infiniteDash: boolean;
}

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

export interface SpawnPoint {
  position: THREE.Vector3;
  zone: string;
  /** 'ground' for walkers, 'air' for flyers, 'gate' for scripted entrances. */
  kind: 'ground' | 'air' | 'gate';
}

export interface MapZone {
  id: string;
  name: string;
  bounds: THREE.Box3;
}

export interface NavQuery {
  /** Steering direction from `position` toward the shared target. Writes to `out` and returns false if off the graph. */
  flowDirection(position: THREE.Vector3, out: THREE.Vector3): boolean;
  /** Path distance to the target in meters, or Infinity. */
  pathDistance(position: THREE.Vector3): number;
  /** Sets the point every flow field heads to. Normally the player. Recomputed in time slices. */
  setTarget(position: THREE.Vector3): void;
  /** Nearest walkable point, or null when none is within `maxDist`. */
  nearest(position: THREE.Vector3, maxDist: number, out: THREE.Vector3): boolean;
  /** Ground height below a point, or NaN. */
  groundHeight(x: number, y: number, z: number): number;
  /**
   * First non-walk link within `hops` steps along the flow. Writes its landing point to `out`.
   * 'drop' needs nothing, a walker just runs off the edge. 'jump' and 'pad' need a leap toward `out`.
   */
  linkAhead(position: THREE.Vector3, out: THREE.Vector3, hops?: number): NavLinkKind;
}

/** How a nav link is crossed. */
export type NavLinkKind = 'walk' | 'drop' | 'jump' | 'pad';

export interface MinimapData {
  /** Pre-rendered top-down map. */
  image: HTMLCanvasElement;
  bounds: THREE.Box3;
}

export interface WorldSystem extends GameSystem {
  readonly bounds: THREE.Box3;
  readonly zones: readonly MapZone[];
  readonly playerSpawns: readonly { position: THREE.Vector3; yaw: number }[];
  readonly spawnPoints: readonly SpawnPoint[];
  /** Candidate spots for pickups and powerups. */
  readonly pickupSpots: readonly THREE.Vector3[];
  readonly nav: NavQuery;
  readonly minimap: MinimapData;
  /** Builds everything. Called once at load. `onProgress` gets 0..1. */
  build(onProgress?: (fraction: number, label: string) => void): Promise<void>;
  zoneAt(position: THREE.Vector3): MapZone | null;
  /** Interactive map objects. See WorldObjects. */
  readonly objects: WorldObjects;
}

export type HazardKind = 'lava' | 'crusher' | 'electric';

/** What a position is standing in. Shared object, read it immediately. */
export interface HazardState {
  kind: HazardKind;
  /** Damage per second of world time. */
  dps: number;
  /** True when contact is instant death. */
  lethal: boolean;
}

export type ReactorState = 'stable' | 'unstable' | 'critical';

/**
 * Jump pads, launch ramps, hazards and the player are handled by the world itself. Enemies and the combat system
 * use this interface: they poll hazards and pads, and they report damage to explosives. Explosives never apply
 * damage on their own; they raise 'world:explosion' and the combat system resolves it.
 */
export interface WorldObjects {
  /** True when `collider` belongs to an explosive barrel or tank. */
  isExplosive(collider: RAPIER.Collider | null): boolean;
  /** Damages the explosive owning `collider`. Returns true if the collider was an explosive. */
  damageExplosive(collider: RAPIER.Collider | null, amount: number, source: string): boolean;
  /** Damages every explosive in range, with distance falloff. Rockets and grenades call this so barrels chain. */
  damageExplosivesInRadius(center: THREE.Vector3, radius: number, amount: number, source: string): void;
  /** Hazard at a position, or null. Enemies poll this and apply dps themselves. */
  hazardAt(position: THREE.Vector3): HazardState | null;
  /** If `position` is on a jump pad, writes its launch velocity to `out` and returns true. */
  padAt(position: THREE.Vector3, out: THREE.Vector3): boolean;
  /** If `position` stands on a moving platform, writes its velocity to `out` and returns true. The player adds this while grounded. */
  platformVelocity(position: THREE.Vector3, out: THREE.Vector3): boolean;
  /** Reactor mood: stable cyan, unstable flicker, critical warm. For bosses and the last stand. */
  setReactorState(state: ReactorState): void;
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export type GameState = 'boot' | 'menu' | 'playing' | 'paused' | 'gameover';

export interface GameEvents {
  'game:state': { from: GameState; to: GameState };
  'player:damaged': { amount: number; from?: THREE.Vector3; type: string };
  'player:healed': { amount: number };
  'player:died': { source: string };
  /** `wall` marks a wall kick, `bounce` a slam bounce. */
  'player:jumped': { double: boolean; wall?: boolean; bounce?: boolean };
  'player:landed': { impact: number };
  'player:dashed': { dir: THREE.Vector3 };
  'player:slide': { active: boolean };
  'player:wallrun': { active: boolean };
  /** `impact` is the height fallen in meters. `radius` is the shockwave reach in meters. */
  'player:slam': { impact: number; position: THREE.Vector3; radius: number };
  'player:slamstart': { position: THREE.Vector3 };
  /** `height` is the climb in meters. */
  'player:mantle': { height: number };
  'world:hazard': { kind: string; position: THREE.Vector3 };
  /** An explosive went off. The combat system applies `damage` with falloff over `radius` to enemies and the player. */
  'world:explosion': { position: THREE.Vector3; radius: number; damage: number; kind: 'barrel' | 'tank'; source: string };
  'world:pad': { position: THREE.Vector3; velocity: THREE.Vector3 };
  /** A spent casing hit the floor. `strength` is 0..1, loudest on the first bounce. The payload object is reused. */
  'fx:casing': { position: THREE.Vector3; kind: 'pistol' | 'rifle' | 'shotgun' | 'cannon'; strength: number };
}

// ---------------------------------------------------------------------------------------------
// Root context
// ---------------------------------------------------------------------------------------------

/**
 * Everything a system can reach. Fields are filled in during boot, so systems must read them in
 * `init` or later, never in a constructor. Gameplay systems added later extend this interface.
 */
export interface Ctx {
  time: GameTime;
  events: EventBus<GameEvents>;
  input: InputSystem;
  render: RenderSystem;
  physics: PhysicsSystem;
  world: WorldSystem;
  characters: CharacterLibrary;
  gore: GoreSystem;
  fx: FxSystem;
  audio: AudioSystem;
  player: PlayerSystem;
  camera: CameraRig;
}
