/**
 * Mission 5: DESERT RAID — Runtime Setpieces & Hadrek Quist ("the Salt King") Finale.
 *
 * Owns:
 *   1. Loudspeaker PA poles (`LOUDSPEAKER_POLES`) with twin megaphone horns, amber/red beacons & expanding wave rings.
 *   2. Solid Bulldozer-Blade Main Gate (`MAIN_GATE`) with metallic ricochet feedback & Warthog shatter debris.
 *   3. Pump Yard 18.5 m riveted Water Tower (`PUMP_YARD`) — leg squibs, 1.8 s northward collapse onto z = -52,
 *      permanent surface rubble blockers, surging brown-white flood wave with knockback, and pulsing Sewer Grate flare.
 *   4. Hadrek Quist sculpted warlord actor inside the Cargo Plane — Phase A cowardly bulkhead retreat & Phase B
 *      17.5-second cornered last speech with all 5 exact outcomes:
 *        - Outcome 1: Hold [E] 1.5 s (<= 3.8 m) -> Captured (+$2,500)
 *        - Outcome 2: Tap [E] (< 0.4 s, <= 14 m) -> Cycles interactive draft replies without aborting speech
 *        - Outcome 3: Shoot / damage once cornered (or during warning/suicide) -> Killed immediately
 *        - Outcome 4: Speech ends & dist <= 8 m -> 1.5 s red-glint GRENADE warning + lethal blast (survived / killed)
 *        - Outcome 5: Speech ends & dist > 8 m -> Pistol suicide sequence (0.55 s draw + 0.85 s 'temple' pose -> shot)
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PostureName } from '../../characters/animation/postures';
import { HumanoidBone } from '../../characters/rig';
import type { Ctx, DamageInfo, DamageType } from '../../core/contracts';
import { clamp, lerp, rand, TAU } from '../../core/math';
import type { Enemy } from '../../enemies/Enemy';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { div, Label, span } from '../../ui/dom';
import {
  CARGO_PLANE,
  LOUDSPEAKER_POLES,
  MAIN_GATE,
  PUMP_YARD,
} from '../../world/map/desert/plan';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import { stripQuistGear, styleQuistNpc, type QuistNpcProps } from './saltbloods';
import type { QuistHooks, QuistOutcome, SetpiecesController } from './types';

// -------------------------------------------------------------------------------------------------
// Public timing & spatial constants
// -------------------------------------------------------------------------------------------------

export const TOWER_TRIGGER_Z = -28;
export const TOWER_FALL_DURATION = 1.8;
export const TOWER_FLOOD_DURATION = 2.6;

/** Cargo Plane chase trigger Z thresholds derived directly from `CARGO_PLANE` in `plan.ts`. */
export const QUIST_RAMP_TRIGGER_Z = CARGO_PLANE.rampZ - 2;
export const QUIST_DOOR2_TRIGGER_Z = CARGO_PLANE.door1Z - 6;
export const QUIST_TAIL_TRIGGER_Z = CARGO_PLANE.door2Z - 1;

export const QUIST_SPEECH_DURATION = 17.5;
export const QUIST_SPEECH_BEATS: readonly { readonly at: number; readonly key: string }[] = [
  { at: 0.0, key: 'quist.speech.1' },
  { at: 4.4, key: 'quist.speech.2' },
  { at: 8.8, key: 'quist.speech.3' },
  { at: 13.2, key: 'quist.speech.4' },
];

export const QUIST_REPLY_KEYS: readonly string[] = [
  'quist.reply.1',
  'quist.reply.2',
  'quist.reply.3',
];

export const QUIST_NPC_MAX_HP = 160;
export const QUIST_CAPTURE_RANGE = 3.8;
export const QUIST_CAPTURE_HOLD = 1.2;
export const QUIST_CAPTURE_BONUS = 2500;
export const QUIST_TALK_RANGE = 14.0;
export const QUIST_TAP_MAX = 0.4;
export const QUIST_GRENADE_RANGE = 8.0;
export const QUIST_GRENADE_WINDOW = 1.5;
export const QUIST_GRENADE_RADIUS = 7.5;
export const QUIST_SUICIDE_DRAW = 0.55;
export const QUIST_SUICIDE_TEMPLE = 0.85;

export const QUIST_ESCORT_STOP_DIST = 2.8;
export const QUIST_ESCORT_TRAIL_DIST = 3.2;
export const QUIST_ESCORT_JOG_DIST = 6.0;
export const QUIST_ESCORT_TELEPORT_DIST = 32.0;

export type QuistState =
  | 'inactive'
  | 'wait_ramp'
  | 'sprint_mid'
  | 'wait_mid'
  | 'sprint_tail'
  | 'wait_tail'
  | 'speech'
  | 'grenade_warning'
  | 'suicide_draw'
  | 'suicide_temple'
  | 'captured_escort'
  | 'captured'
  | 'dead';

/** Enemy weapon / role damage sources blocked by Quist's damageFilter so strays never steal kill/capture. */
const ENEMY_DAMAGE_SOURCES: ReadonlySet<string> = new Set([
  'husk', 'trooper', 'gunner', 'brute', 'stalker', 'rocketeer', 'sniper', 'riot',
  'leaper', 'bomber', 'burner', 'warden', 'skitter', 'drone', 'juggernaut', 'titan',
  'tank_cannon', 'flak_gun', 'rival_rotary', 'enemy', 'bandit', 'saltblood',
]);

function isAllyDamageSource(source: string): boolean {
  return source.startsWith('ally');
}

function isEnemyDamageSource(source: string): boolean {
  if (!source) return false;
  if (ENEMY_DAMAGE_SOURCES.has(source)) return true;
  return (
    source.startsWith('enemy_') ||
    source.startsWith('bandit_') ||
    source.startsWith('saltblood_') ||
    source.startsWith('rival_') ||
    source.startsWith('chopper_')
  );
}

// -------------------------------------------------------------------------------------------------
// Scratch objects (zero per-frame heap allocations)
// -------------------------------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _south = new THREE.Vector3(0, 0, 1);

const ALONG_Z: readonly [number, number, number] = [Math.PI / 2, 0, 0];

// -------------------------------------------------------------------------------------------------
// Internal helper interfaces
// -------------------------------------------------------------------------------------------------

interface LoudspeakerPole {
  readonly index: number;
  readonly pos: THREE.Vector3;
  readonly hornPos: THREE.Vector3;
  readonly group: THREE.Group;
  readonly beaconMat: THREE.MeshBasicMaterial;
  readonly beaconMesh: THREE.Mesh;
  pulseTimer: number;
}

interface AudioWaveRing {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  age: number;
  delay: number;
  duration: number;
  active: boolean;
}

interface DebrisChunk {
  readonly mesh: THREE.Mesh;
  readonly vel: THREE.Vector3;
  readonly angVel: THREE.Vector3;
  settled: boolean;
}

interface QuistRig {
  readonly root: THREE.Group;
  readonly pelvis: THREE.Group;
  readonly torso: THREE.Group;
  readonly head: THREE.Group;
  readonly armL: THREE.Group;
  readonly forearmL: THREE.Group;
  readonly armR: THREE.Group;
  readonly forearmR: THREE.Group;
  readonly legL: THREE.Group;
  readonly legR: THREE.Group;
  readonly pistolInHand: THREE.Group;
  readonly pistolHolstered: THREE.Group;
  readonly grenadeInHand: THREE.Group;
  readonly redGlint: THREE.Mesh;
  readonly redGlintMat: THREE.MeshBasicMaterial;
  readonly zipTie: THREE.Group;
}

interface QuistHudDom {
  readonly root: HTMLElement;
  readonly badge: Label;
  readonly text: Label;
  readonly track: HTMLElement;
  readonly fill: HTMLElement;
}

// -------------------------------------------------------------------------------------------------
// Procedural Model Builders
// -------------------------------------------------------------------------------------------------

function createWaterTowerStencilTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const g = canvas.getContext('2d');
  if (!g) return null;

  // Rusted dark steel plate backing with vertical salt streaks
  g.fillStyle = '#382a22';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#4e3628';
  g.fillRect(8, 8, 496, 144);
  for (let i = 0; i < 18; i++) {
    g.fillStyle = i % 2 === 0 ? 'rgba(130, 74, 38, 0.25)' : 'rgba(20, 14, 10, 0.22)';
    g.fillRect(16 + i * 27, 8, 12, 144);
  }
  // Riveted border & stenciled lettering
  g.strokeStyle = '#7e5a3d';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 492, 140);
  g.fillStyle = '#ddd3be';
  g.font = 'bold 54px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SURPLUS WATER', 256, 82);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildLoudspeakerPole(materials: ModelMaterials, matWood: THREE.Material, pos: readonly [number, number, number], index: number): LoudspeakerPole {
  const group = new THREE.Group();
  group.name = `desert.loudspeaker.${index}`;
  group.position.set(pos[0], pos[1], pos[2]);

  const woodB = new ModelBuilder();
  // Concrete plinth & tall weathered timber/steel pole
  woodB.box(0.85, 0.55, 0.85, '#6e6456', { at: [0, 0.275, 0] });
  woodB.cyl(0.14, 0.22, 9.4, 8, '#5a412d', { at: [0, 4.7, 0] });
  group.add(materials.group(woodB, matWood));

  const metalB = new ModelBuilder();
  // Steel reinforcement bands, climbing rungs & junction box
  for (const y of [1.6, 4.2, 6.8, 8.5]) {
    metalB.cyl(0.19, 0.19, 0.18, 8, '#4a3528', { at: [0, y, 0] });
  }
  for (let y = 1.4; y <= 7.8; y += 0.65) {
    const side = Math.round(y * 2) % 2 === 0 ? 1 : -1;
    metalB.box(0.28, 0.05, 0.05, '#3b322b', { at: [side * 0.22, y, 0] });
  }
  metalB.box(0.42, 0.58, 0.26, '#3c4045', { at: [0, 2.5, 0.24] });
  // Top steel crossbar
  metalB.box(1.9, 0.12, 0.12, '#4e3c2e', { at: [0, 8.75, 0] });
  // Twin flared megaphone horns facing opposite directions, angled slightly downward
  for (const side of [-1, 1] as const) {
    const hx = side * 0.72;
    metalB.box(0.14, 0.24, 0.16, '#39322c', { at: [hx, 8.95, 0] });
    // Driver housing + flared megaphone bell
    metalB.cyl(0.14, 0.18, 0.32, 10, '#5a4d3f', {
      at: [hx, 9.1, -side * 0.14],
      rot: [Math.PI / 2 + side * 0.22, 0, 0],
    });
    metalB.cyl(0.14, 0.44, 0.68, 12, '#8b7355', {
      at: [hx, 9.0, side * 0.26],
      rot: [Math.PI / 2 + side * 0.22, 0, 0],
    });
    metalB.cyl(0.08, 0.1, 0.22, 8, '#26211d', {
      at: [hx, 8.96, side * 0.45],
      rot: [Math.PI / 2 + side * 0.22, 0, 0],
    });
  }
  // Top beacon housing cage
  metalB.cyl(0.16, 0.18, 0.22, 8, '#2c2927', { at: [0, 9.52, 0] });
  group.add(materials.group(metalB));

  // Pulsing amber/red indicator beacon bulb
  const beaconMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff6b22').multiplyScalar(1.3),
    toneMapped: false,
  });
  const beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), beaconMat);
  beaconMesh.position.set(0, 9.75, 0);
  group.add(beaconMesh);

  return {
    index,
    pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
    hornPos: new THREE.Vector3(pos[0], pos[1] + 9.0, pos[2]),
    group,
    beaconMat,
    beaconMesh,
    pulseTimer: 0,
  };
}

function buildMainGateModel(materials: ModelMaterials): THREE.Group {
  const root = new THREE.Group();
  root.name = 'desert.mainGate';
  root.position.set(MAIN_GATE.x, MAIN_GATE.y, MAIN_GATE.z);

  const W = MAIN_GATE.width;
  const H = MAIN_GATE.height;
  const b = new ModelBuilder();

  const plateDark = '#2d3238';
  const plateMid = '#3d434a';
  const plateRust = '#5e3c26';
  const beamSteel = '#22262b';
  const bladeYellow = '#d29e24';
  const bladeYellowDark = '#b47f1c';
  const bladeRust = '#733e1f';
  const edgeSteel = '#4a4e54';

  // Left & right battleship steel gate leaves meeting at center welded seam
  b.box(W * 0.49, H, 1.35, plateMid, { at: [-W * 0.252, H * 0.5, 0] });
  b.box(W * 0.49, H, 1.35, plateMid, { at: [W * 0.252, H * 0.5, 0] });
  // Center lock post & vertical seam overlap
  b.box(0.42, H + 0.2, 1.65, beamSteel, { at: [0, H * 0.5, 0.08] });
  // Heavy outer armored steel jamb pillars & upper lintel crossbeam
  for (const sx of [-1, 1] as const) {
    b.box(0.85, H + 0.5, 1.95, plateDark, { at: [sx * (W * 0.5 - 0.2), (H + 0.5) * 0.5, 0] });
  }
  b.box(W + 1.0, 0.78, 2.0, plateDark, { at: [0, H + 0.15, 0] });
  // Horizontal & diagonal steel I-beam crossbeams bolted across both sides
  for (const y of [1.2, 3.8, 6.2]) {
    b.box(W - 0.4, 0.34, 1.65, beamSteel, { at: [0, y, 0] });
  }
  for (const sx of [-1, 1] as const) {
    b.box(0.28, 5.8, 1.55, plateRust, { at: [sx * 3.5, 4.1, 0], rot: [0, 0, sx * 0.52] });
    b.box(0.28, 5.8, 1.55, plateRust, { at: [sx * 3.5, 4.1, 0], rot: [0, 0, -sx * 0.52] });
  }
  // Welded patch plates & rust armor scraps on upper doors
  b.box(2.4, 1.5, 0.14, plateRust, { at: [-3.8, 5.3, 0.74], rot: [0, 0, 0.04] });
  b.box(2.8, 1.3, 0.14, plateDark, { at: [3.6, 5.4, 0.74], rot: [0, 0, -0.03] });

  // Huge curved yellow-and-rust BULLDOZER BLADE bolted across the south front (+Z) face!
  const bladeW = 12.6;
  // 4 concave curved moldboard segments forming the iconic scoop profile
  b.box(bladeW, 0.95, 0.38, edgeSteel, { at: [0, 0.52, 1.58], rot: [-0.46, 0, 0] });
  b.box(bladeW, 1.15, 0.36, bladeYellowDark, { at: [0, 1.48, 1.24], rot: [-0.18, 0, 0] });
  b.box(bladeW, 1.18, 0.36, bladeYellow, { at: [0, 2.58, 1.14], rot: [0.12, 0, 0] });
  b.box(bladeW, 0.88, 0.34, bladeYellowDark, { at: [0, 3.54, 1.36], rot: [0.42, 0, 0] });
  // Top spill guard lip & curved end-bit side cheeks
  b.box(bladeW + 0.4, 0.32, 0.42, bladeRust, { at: [0, 4.02, 1.62], rot: [0.65, 0, 0] });
  for (const sx of [-1, 1] as const) {
    b.box(0.32, 3.8, 1.25, bladeRust, { at: [sx * (bladeW * 0.5 + 0.08), 2.15, 1.35] });
  }
  // Rust wear patches & vertical structural ribs welded onto the curved blade
  b.box(2.6, 1.25, 0.12, bladeRust, { at: [-3.4, 2.2, 1.35], rot: [0.05, 0, 0.04] });
  b.box(2.2, 1.05, 0.12, bladeRust, { at: [2.8, 1.8, 1.4], rot: [-0.08, 0, -0.05] });
  for (let i = -2; i <= 2; i++) {
    const rx = i * 2.4;
    b.box(0.24, 3.4, 0.55, beamSteel, { at: [rx, 2.15, 1.08] });
  }
  // Serrated steel ripper teeth along the bottom cutting edge
  for (let i = -5; i <= 5; i++) {
    b.box(0.42, 0.32, 0.52, '#5a5f66', { at: [i * 1.12, 0.22, 1.88], rot: [-0.35, 0, 0] });
  }
  // Twin hydraulic push-arm brackets bolting the bulldozer blade into the battleship plates
  for (const sx of [-1, 1] as const) {
    b.box(0.55, 0.52, 1.35, beamSteel, { at: [sx * 4.4, 1.1, 0.9] });
    b.box(0.55, 0.52, 1.35, beamSteel, { at: [sx * 4.4, 3.1, 0.9] });
  }

  root.add(materials.group(b));
  return root;
}

function buildWaterTowerModel(materials: ModelMaterials): {
  pivot: THREE.Group;
  rubbleGroup: THREE.Group;
} {
  const pivot = new THREE.Group();
  pivot.name = 'desert.waterTower';
  pivot.position.set(PUMP_YARD.towerBase[0], PUMP_YARD.towerBase[1], PUMP_YARD.towerBase[2]);

  const b = new ModelBuilder();
  const legRust = '#593c2a';
  const legDark = '#3a2b22';
  const tankSteel = '#4a4e54';
  const tankRust = '#6b4731';
  const hoopDark = '#272a2e';
  const catwalkSteel = '#3d4147';
  const roofColor = '#5e4637';

  // 4 heavy splayed riveted steel truss legs from y = 0..10.6 m
  const legCorners: readonly (readonly [number, number])[] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  for (const [sx, sz] of legCorners) {
    // Concrete anchor footing
    b.box(1.15, 0.65, 1.15, '#7a7062', { at: [sx * 3.0, 0.325, sz * 3.0] });
    // Tapered diagonal leg column
    b.box(0.44, 10.9, 0.44, legRust, {
      at: [sx * 2.7, 5.4, sz * 2.7],
      rot: [sz * 0.056, 0, -sx * 0.056],
    });
    // Gusset brackets at base and top
    b.box(0.72, 0.72, 0.72, legDark, { at: [sx * 2.95, 0.85, sz * 2.95] });
    b.box(0.72, 0.72, 0.72, legDark, { at: [sx * 2.42, 10.2, sz * 2.42] });
  }

  // Horizontal girder rings & X-bracing cross struts across all 4 faces at 3 height tiers
  for (const y of [3.2, 6.6, 10.0]) {
    const t = y / 10.6;
    const span = lerp(6.0, 4.8, t);
    const half = span * 0.5;
    b.box(span, 0.24, 0.24, legDark, { at: [0, y, -half] });
    b.box(span, 0.24, 0.24, legDark, { at: [0, y, half] });
    b.box(0.24, 0.24, span, legDark, { at: [-half, y, 0] });
    b.box(0.24, 0.24, span, legDark, { at: [half, y, 0] });
  }
  for (const tierY of [1.8, 5.0, 8.3]) {
    const half = lerp(2.9, 2.5, tierY / 10.6);
    for (const s of [-1, 1] as const) {
      b.box(0.14, 5.6, 0.14, legRust, { at: [0, tierY, s * half], rot: [0, 0, 0.88] });
      b.box(0.14, 5.6, 0.14, legRust, { at: [0, tierY, s * half], rot: [0, 0, -0.88] });
      b.box(0.14, 5.6, 0.14, legRust, { at: [s * half, tierY, 0], rot: [0.88, 0, 0] });
      b.box(0.14, 5.6, 0.14, legRust, { at: [s * half, tierY, 0], rot: [-0.88, 0, 0] });
    }
  }

  // Central riser water standpipe & external overflow drain pipe
  b.cyl(0.58, 0.62, 10.7, 10, '#3e4248', { at: [0, 5.35, 0] });
  b.cyl(0.16, 0.16, 15.8, 8, '#6e4933', { at: [3.7, 7.9, 0.4] });
  b.box(0.85, 0.18, 0.18, '#6e4933', { at: [3.35, 15.7, 0.4] });

  // Cylindrical riveted steel tank (y = 10.6 .. 16.8, radius 3.45 m)
  b.cyl(3.45, 3.45, 6.2, 20, tankSteel, { at: [0, 13.7, 0] });
  // Lower rust-stained belly & conical bottom hopper
  b.cyl(3.46, 2.6, 1.2, 20, tankRust, { at: [0, 10.1, 0] });
  // Heavy riveted iron tension hoops encircling the tank
  for (const hy of [11.0, 12.1, 13.3, 14.5, 15.7, 16.6]) {
    b.cyl(3.54, 3.54, 0.16, 20, hoopDark, { at: [0, hy, 0] });
  }
  // Conical corrugated roof cap up to 18.5 m total height + vent finial
  b.cyl(0.35, 3.72, 1.65, 20, roofColor, { at: [0, 17.62, 0] });
  b.cyl(0.28, 0.35, 0.28, 10, hoopDark, { at: [0, 18.42, 0] });

  // Catwalk platform & encircling guardrail at y = 10.45 m
  b.cyl(4.25, 4.25, 0.18, 20, catwalkSteel, { at: [0, 10.45, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const x = Math.cos(a) * 4.18;
    const z = Math.sin(a) * 4.18;
    b.box(0.08, 1.15, 0.08, hoopDark, { at: [x, 11.05, z] });
    const na = ((i + 1) / 12) * TAU;
    const mx = (x + Math.cos(na) * 4.18) * 0.5;
    const mz = (z + Math.sin(na) * 4.18) * 0.5;
    const segLen = Math.hypot(Math.cos(na) * 4.18 - x, Math.sin(na) * 4.18 - z);
    const yaw = Math.atan2(Math.cos(na) * 4.18 - x, Math.sin(na) * 4.18 - z);
    b.box(0.07, 0.07, segLen, hoopDark, { at: [mx, 11.58, mz], rot: [0, yaw, 0] });
    b.box(0.06, 0.06, segLen, hoopDark, { at: [mx, 11.1, mz], rot: [0, yaw, 0] });
  }

  // Maintenance ladder climbing the east-south leg up to the catwalk
  for (const s of [-0.22, 0.22]) {
    b.box(0.06, 10.6, 0.06, hoopDark, { at: [2.85 + s, 5.3, 2.85] });
  }
  for (let y = 0.8; y <= 10.2; y += 0.45) {
    b.box(0.46, 0.04, 0.04, hoopDark, { at: [2.85, y, 2.85] });
  }

  pivot.add(materials.group(b));

  // "SURPLUS WATER" stencil plate on the south (+Z) face of the tank
  const stencilTex = createWaterTowerStencilTexture();
  const plateMat = new THREE.MeshStandardMaterial({
    color: stencilTex ? '#ffffff' : '#523828',
    ...(stencilTex ? { map: stencilTex } : {}),
    roughness: 0.82,
    metalness: 0.25,
  });
  const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.45), plateMat);
  plateMesh.name = 'desert.waterTower.stencilPlate';
  plateMesh.position.set(0, 13.7, 3.58);
  pivot.add(plateMesh);

  // Fallen permanent street-sealing wreckage pile placed around PUMP_YARD.blockedStreetCenter
  const rb = new ModelBuilder();
  rb.box(7.8, 3.4, 4.6, tankSteel, { at: [0, 1.65, 0], rot: [0.08, 0.14, -0.12] });
  rb.box(5.4, 2.6, 3.8, tankRust, { at: [-5.6, 1.25, 0.8], rot: [-0.14, 0.42, 0.22] });
  rb.box(5.2, 2.4, 3.6, legRust, { at: [5.8, 1.15, -0.6], rot: [0.18, -0.35, -0.25] });
  rb.box(8.5, 0.55, 0.55, legDark, { at: [-2.4, 2.9, 2.1], rot: [0.12, 0.28, -0.22] });
  rb.box(7.2, 0.48, 0.48, hoopDark, { at: [3.2, 2.6, 1.9], rot: [-0.2, -0.4, 0.3] });
  rb.box(3.8, 1.6, 2.8, '#5f564a', { at: [-8.6, 0.8, 0.4], rot: [0.08, 0.3, -0.15] });
  rb.box(3.8, 1.6, 2.8, '#5f564a', { at: [8.6, 0.8, -0.4], rot: [-0.1, -0.22, 0.14] });
  const rubbleGroup = materials.group(rb);
  rubbleGroup.name = 'desert.waterTower.rubble';
  rubbleGroup.position.set(
    PUMP_YARD.blockedStreetCenter[0],
    PUMP_YARD.blockedStreetCenter[1],
    PUMP_YARD.blockedStreetCenter[2],
  );
  rubbleGroup.visible = false;

  return { pivot, rubbleGroup };
}

function buildQuistActor(materials: ModelMaterials, matCloth: THREE.Material): QuistRig {
  const root = new THREE.Group();
  root.name = 'desert.quist';

  // Color palette matching Hadrek Quist's portrait in src/ui/commander/portrait.ts
  const DUSTER = '#3b2b20';
  const DUSTER_DARK = '#2a1e16';
  const PAULDRON_L = '#5a4636';
  const PAULDRON_R = '#523f30';
  const SCARF = '#9c7244';
  const SCARF_FOLD = '#74512e';
  const SKIN = '#b58460';
  const HEADWRAP = '#6c5238';
  const STRAP = '#2a2018';
  const BRASS_LENS = '#c8832c';
  const BOOT = '#261c15';
  const GUN_STEEL = '#1e2228';

  const pelvis = new THREE.Group();
  pelvis.position.set(0, 0.96, 0);
  root.add(pelvis);

  // Pelvis belt & hip sidearm holster
  const pelvB = new ModelBuilder();
  pelvB.box(0.44, 0.2, 0.28, DUSTER_DARK);
  pelvB.box(0.47, 0.08, 0.31, '#5e4328', { at: [0, 0.05, 0] });
  pelvB.box(0.11, 0.22, 0.14, '#322319', { at: [0.26, -0.08, 0.04] }); // left-hip holster
  pelvis.add(materials.group(pelvB, matCloth));

  const pistolHolstered = new THREE.Group();
  const holB = new ModelBuilder();
  holB.box(0.06, 0.18, 0.09, GUN_STEEL, { at: [0.27, -0.02, 0.06], rot: [0.2, 0, 0] });
  pistolHolstered.add(materials.group(holB));
  pelvis.add(pistolHolstered);

  // Torso, tattered long duster coat, welded shoulder pauldrons & ochre scarf
  const torso = new THREE.Group();
  torso.position.set(0, 0.1, 0);
  pelvis.add(torso);

  const torsoB = new ModelBuilder();
  // Tall gaunt chest & coat upper
  torsoB.box(0.48, 0.58, 0.28, DUSTER, { at: [0, 0.3, 0] });
  // Tattered open duster coat skirts hanging down back & flanks
  torsoB.box(0.48, 0.72, 0.08, DUSTER, { at: [0, -0.26, -0.14], rot: [0.08, 0, 0] });
  torsoB.box(0.14, 0.68, 0.24, DUSTER_DARK, { at: [-0.22, -0.24, -0.02], rot: [0, 0, -0.08] });
  torsoB.box(0.14, 0.68, 0.24, DUSTER_DARK, { at: [0.22, -0.24, -0.02], rot: [0, 0, 0.08] });
  // Heavy ochre scarf draped around collar & chest
  torsoB.box(0.42, 0.17, 0.34, SCARF, { at: [0, 0.56, 0.02] });
  torsoB.box(0.22, 0.34, 0.09, SCARF_FOLD, { at: [-0.1, 0.38, 0.16], rot: [0.06, 0, 0.15] });
  torso.add(materials.group(torsoB, matCloth));

  // Welded scrap steel shoulder pauldrons (metallic finish)
  const pauldB = new ModelBuilder();
  pauldB.box(0.24, 0.18, 0.34, PAULDRON_L, { at: [0.33, 0.54, 0], rot: [0, 0, -0.22] });
  pauldB.box(0.24, 0.18, 0.34, PAULDRON_R, { at: [-0.33, 0.54, 0], rot: [0, 0, 0.22] });
  pauldB.box(0.12, 0.08, 0.3, '#6d4b2d', { at: [0.39, 0.61, 0], rot: [0, 0, -0.3] });
  pauldB.box(0.12, 0.08, 0.3, '#6d4b2d', { at: [-0.39, 0.61, 0], rot: [0, 0, 0.3] });
  torso.add(materials.group(pauldB));

  // Neck, gaunt weathered head, headwrap & pushed-up brass forehead goggles
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0);
  torso.add(head);

  const headClothB = new ModelBuilder();
  headClothB.cyl(0.08, 0.09, 0.12, 8, SKIN, { at: [0, 0.06, 0] });
  headClothB.box(0.23, 0.28, 0.24, SKIN, { at: [0, 0.22, 0.01] });
  // Cheek scar & beard stubble
  headClothB.box(0.02, 0.11, 0.02, '#6d3b2b', { at: [-0.07, 0.2, 0.135], rot: [0, 0, -0.2] });
  headClothB.box(0.21, 0.09, 0.1, '#5c4636', { at: [0, 0.12, 0.1] });
  // Desert headwrap / hood framing top & sides of skull
  headClothB.box(0.27, 0.14, 0.28, HEADWRAP, { at: [0, 0.34, -0.01] });
  headClothB.box(0.27, 0.24, 0.14, HEADWRAP, { at: [0, 0.23, -0.08] });
  head.add(materials.group(headClothB, matCloth));

  const gogB = new ModelBuilder();
  gogB.box(0.28, 0.06, 0.26, STRAP, { at: [0, 0.32, 0.01] });
  for (const sx of [-0.065, 0.065]) {
    gogB.cyl(0.048, 0.048, 0.055, 10, STRAP, { at: [sx, 0.32, 0.135], rot: ALONG_Z });
    gogB.cyl(0.036, 0.036, 0.06, 10, BRASS_LENS, { at: [sx, 0.32, 0.145], rot: ALONG_Z });
  }
  head.add(materials.group(gogB));

  // Left arm (+ sidearm pistol for the 'temple' suicide pose)
  const armL = new THREE.Group();
  armL.position.set(0.32, 0.52, 0);
  torso.add(armL);
  const armLB = new ModelBuilder();
  armLB.box(0.14, 0.34, 0.14, DUSTER, { at: [0, -0.15, 0] });
  armL.add(materials.group(armLB, matCloth));

  const forearmL = new THREE.Group();
  forearmL.position.set(0, -0.32, 0);
  armL.add(forearmL);
  const foreLB = new ModelBuilder();
  foreLB.box(0.12, 0.3, 0.12, DUSTER_DARK, { at: [0, -0.13, 0] });
  foreLB.box(0.09, 0.1, 0.1, SKIN, { at: [0, -0.3, 0] });
  forearmL.add(materials.group(foreLB, matCloth));

  // Heavy desert sidearm pistol held in left hand during suicide sequence
  const pistolInHand = new THREE.Group();
  pistolInHand.position.set(0, -0.32, 0.08);
  const pisB = new ModelBuilder();
  pisB.box(0.05, 0.12, 0.07, '#3c2a1e', { at: [0, -0.04, 0], rot: [0.22, 0, 0] });
  pisB.box(0.048, 0.065, 0.26, GUN_STEEL, { at: [0, 0.03, 0.09] });
  pistolInHand.add(materials.group(pisB));
  pistolInHand.visible = false;
  forearmL.add(pistolInHand);

  // Right arm (+ concealed grenade & bright red glint telegraph)
  const armR = new THREE.Group();
  armR.position.set(-0.32, 0.52, 0);
  torso.add(armR);
  const armRB = new ModelBuilder();
  armRB.box(0.14, 0.34, 0.14, DUSTER, { at: [0, -0.15, 0] });
  armR.add(materials.group(armRB, matCloth));

  const forearmR = new THREE.Group();
  forearmR.position.set(0, -0.32, 0);
  armR.add(forearmR);
  const foreRB = new ModelBuilder();
  foreRB.box(0.12, 0.3, 0.12, DUSTER_DARK, { at: [0, -0.13, 0] });
  foreRB.box(0.09, 0.1, 0.1, SKIN, { at: [0, -0.3, 0] });
  forearmR.add(materials.group(foreRB, matCloth));

  const grenadeInHand = new THREE.Group();
  grenadeInHand.position.set(0, -0.32, 0.06);
  const grB = new ModelBuilder();
  grB.cyl(0.055, 0.055, 0.13, 10, '#445238');
  grB.box(0.04, 0.05, 0.04, '#b88f34', { at: [0, 0.08, 0] });
  grenadeInHand.add(materials.group(grB));
  grenadeInHand.visible = false;
  forearmR.add(grenadeInHand);

  // Bright red glint telegraph for grenade warning
  const redGlintMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff2010').multiplyScalar(5.0),
    transparent: true,
    opacity: 0.92,
    toneMapped: false,
    depthWrite: false,
  });
  const redGlint = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), redGlintMat);
  redGlint.position.set(0, -0.3, 0.12);
  redGlint.visible = false;
  forearmR.add(redGlint);

  // Zip-tie cuffs visible behind Quist's wrists when captured
  const zipTie = new THREE.Group();
  const ztB = new ModelBuilder();
  ztB.box(0.24, 0.045, 0.06, '#e2e6ec', { at: [0, 0.14, -0.2] });
  zipTie.add(materials.group(ztB, matCloth));
  zipTie.visible = false;
  torso.add(zipTie);

  // Articulated legs + desert boots
  const makeLeg = (sx: number): THREE.Group => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.14, -0.05, 0);
    const lb = new ModelBuilder();
    lb.box(0.17, 0.52, 0.18, '#42362a', { at: [0, -0.26, 0] });
    lb.box(0.16, 0.36, 0.21, BOOT, { at: [0, -0.7, 0.02] });
    leg.add(materials.group(lb, matCloth));
    return leg;
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);
  pelvis.add(legL, legR);

  root.visible = false;

  return {
    root,
    pelvis,
    torso,
    head,
    armL,
    forearmL,
    armR,
    forearmR,
    legL,
    legR,
    pistolInHand,
    pistolHolstered,
    grenadeInHand,
    redGlint,
    redGlintMat,
    zipTie,
  };
}

// -------------------------------------------------------------------------------------------------
// DesertSetpieces Controller
// -------------------------------------------------------------------------------------------------

export class DesertSetpieces implements SetpiecesController {
  // Public SetpiecesController flags
  quistOutcome: QuistOutcome | null = null;
  gateBreached = false;
  towerDropped = false;

  private built = false;

  // Loudspeaker poles & expanding wave rings
  private readonly poles: LoudspeakerPole[] = [];
  private readonly waveRings: AudioWaveRing[] = [];
  private waveRingCursor = 0;
  private _lastPulsedPoleIndex = -1;

  // Solid Bulldozer Main Gate
  private gateGroup: THREE.Group | null = null;
  private gateCollider: RAPIER.Collider | null = null;
  private readonly gateDebris: DebrisChunk[] = [];
  private gateSmokeTimer = 0;
  private gateSmokeTick = 0;
  private _gateRicochetCount = 0;

  // Pump Yard Water Tower, rubble blockers, flood wave & Sewer Grate flare
  private towerPivot: THREE.Group | null = null;
  private towerRubbleGroup: THREE.Group | null = null;
  private readonly towerLegColliders: RAPIER.Collider[] = [];
  private readonly rubbleColliders: RAPIER.Collider[] = [];
  private towerArmed = false;
  private towerCollapsing = false;
  private towerImpacted = false;
  private towerFallElapsed = 0;
  private towerCreakPlayed = false;

  private floodWaveGroup: THREE.Group | null = null;
  private floodWaveMat: THREE.MeshBasicMaterial | null = null;
  private floodFoamMat: THREE.MeshBasicMaterial | null = null;
  private floodActive = false;
  private floodElapsed = 0;
  private floodKnockedPlayer = false;
  private floodSprayTick = 0;
  private readonly floodKnockedEnemies = new Set<number>();

  private sewerBeaconGroup: THREE.Group | null = null;
  private sewerFlareLight: THREE.PointLight | null = null;
  private sewerRingMesh: THREE.Mesh | null = null;
  private sewerBeaconOn = false;
  private sewerBeaconSuppressed = false;
  private sewerUnmark: (() => void) | null = null;

  // Hadrek Quist ("the Salt King") — real goreable Enemy NPC with custom Salt King bone gear + headless fallback rig
  private quistEnemy: Enemy | null = null;
  private quistNpcProps: QuistNpcProps | null = null;
  private lastAllowedDamageType: DamageType = 'bullet';
  private quistRig: QuistRig | null = null;
  private quistCollider: RAPIER.Collider | null = null;
  private quistHooks: QuistHooks | null = null;
  private _quistState: QuistState = 'inactive';
  private readonly quistPos = new THREE.Vector3(...CARGO_PLANE.quistWaitPos);
  private quistYaw = 0;
  private quistAnimPhase = 0;
  private quistDoor1Slammed = false;
  private quistDoor2Slammed = false;
  private _speechElapsed = 0;
  private nextSpeechBeat = 0;
  private quistReplyIndex = 0;
  private interactHeld = false;
  private interactHoldTime = 0;
  private captureHoldTime = 0;
  private grenadeElapsed = 0;
  private grenadeFlashTick = 0;
  private suicideElapsed = 0;
  private quistUnmark: (() => void) | null = null;
  private quistHud: QuistHudDom | null = null;

  // Chained WorldObjects hit/blast hooks & event unsub
  private hooksAttached = false;
  private prevColliderHitHandler: ((collider: RAPIER.Collider, amount: number, source: string) => boolean) | null = null;
  private prevBlastHandler: ((center: THREE.Vector3, radius: number, amount: number, source: string) => void) | null = null;
  private unsubImpact: (() => void) | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly ui: CampaignHud,
  ) {}

  // -----------------------------------------------------------------------------------------------
  // Read-only observability accessors (for diagnostics & unit tests)
  // -----------------------------------------------------------------------------------------------

  get quistState(): QuistState {
    return this._quistState;
  }

  get quistPosition(): THREE.Vector3 {
    return this.quistPos;
  }

  /** Whether the escorted cuffed Quist NPC is currently alive and walking with the player. */
  get quistEscortAlive(): boolean {
    if (this._quistState !== 'captured_escort') return false;
    return this.quistEnemy ? this.quistEnemy.alive : true;
  }

  /** Underlying real Enemy NPC instance for Hadrek Quist (null in headless fallback tests without `enemies.spawn`). */
  get quistNpc(): Enemy | null {
    return this.quistEnemy;
  }

  get speechElapsed(): number {
    return this._speechElapsed;
  }

  get captureProgress(): number {
    return clamp(this.captureHoldTime / QUIST_CAPTURE_HOLD);
  }

  get isTowerArmed(): boolean {
    return this.towerArmed;
  }

  get isTowerImpacted(): boolean {
    return this.towerImpacted;
  }

  get isFloodActive(): boolean {
    return this.floodActive;
  }

  get isSewerBeaconOn(): boolean {
    return this.sewerBeaconOn;
  }

  get rubbleColliderCount(): number {
    return this.rubbleColliders.length;
  }

  get loudspeakerCount(): number {
    return this.poles.length;
  }

  get lastPulsedPoleIndex(): number {
    return this._lastPulsedPoleIndex;
  }

  get activeWaveRingCount(): number {
    let n = 0;
    for (const r of this.waveRings) {
      if (r.active) n++;
    }
    return n;
  }

  get gateRicochetCount(): number {
    return this._gateRicochetCount;
  }

  get mainGateCollider(): RAPIER.Collider | null {
    return this.gateCollider;
  }

  get quistHitCollider(): RAPIER.Collider | null {
    return this.quistCollider;
  }

  // -----------------------------------------------------------------------------------------------
  // Build & World Hook Lifecycle
  // -----------------------------------------------------------------------------------------------

  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    const scene = this.ctx.render.scene;
    const materials = new ModelMaterials(this.ctx);
    const matCloth = this.ctx.render.materials.patch(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        metalness: 0.18,
        roughness: 0.82,
      }),
    );

    // 1. Loudspeaker Poles
    for (let i = 0; i < LOUDSPEAKER_POLES.length; i++) {
      const pole = buildLoudspeakerPole(materials, matCloth, LOUDSPEAKER_POLES[i]!, i);
      scene.add(pole.group);
      this.poles.push(pole);
    }

    // Pre-allocate pooled expanding audio-wave rings
    const ringGeo = new THREE.TorusGeometry(1.0, 0.055, 6, 24);
    ringGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color('#ff8c38').multiplyScalar(2.2),
        transparent: true,
        opacity: 0,
        toneMapped: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.waveRings.push({ mesh, mat, age: 0, delay: 0, duration: 0.95, active: false });
    }

    // 2. Solid Bulldozer-Blade Main Gate
    this.gateGroup = buildMainGateModel(materials);
    scene.add(this.gateGroup);
    this.createMainGateCollider();

    // 3. Pump Yard Water Tower, Rubble Pile, Flood Wave & Sewer Flare Beacon
    const tower = buildWaterTowerModel(materials);
    this.towerPivot = tower.pivot;
    this.towerRubbleGroup = tower.rubbleGroup;
    scene.add(this.towerPivot);
    scene.add(this.towerRubbleGroup);
    this.createTowerLegColliders();
    this.buildFloodWaveVisual(scene);
    this.buildSewerBeacon(scene, materials);

    // 4. Sculpted Hadrek Quist Actor & HUD Prompt
    this.quistRig = buildQuistActor(materials, matCloth);
    scene.add(this.quistRig.root);
    this.buildQuistHudDom();

    // 5. Hook WorldObjects shot/blast callbacks cleanly
    this.attachWorldHooks();
  }

  private createMainGateCollider(): void {
    if (this.gateCollider || !this.ctx.physics?.addStaticBox) return;
    const center = new THREE.Vector3(MAIN_GATE.x, MAIN_GATE.y + MAIN_GATE.height * 0.5, MAIN_GATE.z);
    const half = new THREE.Vector3(MAIN_GATE.width * 0.5, MAIN_GATE.height * 0.5, MAIN_GATE.depth * 0.5);
    this.gateCollider = this.ctx.physics.addStaticBox(center, half, null, 'metal');
    this.ctx.physics.markNoClimb?.(this.gateCollider);
  }

  private removeMainGateCollider(): void {
    if (!this.gateCollider) return;
    this.ctx.physics?.world?.removeCollider(this.gateCollider, false);
    this.gateCollider = null;
  }

  private createTowerLegColliders(): void {
    if (this.towerLegColliders.length > 0 || !this.ctx.physics?.addStaticBox) return;
    const [bx, by, bz] = PUMP_YARD.towerBase;
    const half = new THREE.Vector3(0.55, 5.2, 0.55);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const col = this.ctx.physics.addStaticBox(
        new THREE.Vector3(bx + sx * 2.75, by + 5.2, bz + sz * 2.75),
        half,
        null,
        'metal',
      );
      this.ctx.physics.markNoClimb?.(col);
      this.towerLegColliders.push(col);
    }
  }

  private removeTowerLegColliders(): void {
    for (const col of this.towerLegColliders) {
      this.ctx.physics?.world?.removeCollider(col, false);
    }
    this.towerLegColliders.length = 0;
  }

  private installStreetRubbleColliders(): void {
    if (this.rubbleColliders.length > 0 || !this.ctx.physics?.addStaticBox) return;
    const [cx, cy, cz] = PUMP_YARD.blockedStreetCenter;
    // Main tank & flanking girders completely seal the north surface street arch at z = -52
    const specs: readonly [readonly [number, number, number], readonly [number, number, number]] [] = [
      [[cx, cy + 2.6, cz], [8.5, 2.8, 3.6]],
      [[cx - 9.5, cy + 2.2, cz], [3.5, 2.4, 3.2]],
      [[cx + 9.5, cy + 2.2, cz], [3.5, 2.4, 3.2]],
    ];
    for (const [pos, half] of specs) {
      const col = this.ctx.physics.addStaticBox(
        new THREE.Vector3(pos[0], pos[1], pos[2]),
        new THREE.Vector3(half[0], half[1], half[2]),
        null,
        'metal',
      );
      this.ctx.physics.markNoClimb?.(col);
      this.rubbleColliders.push(col);
    }
  }

  private removeStreetRubbleColliders(): void {
    for (const col of this.rubbleColliders) {
      this.ctx.physics?.world?.removeCollider(col, false);
    }
    this.rubbleColliders.length = 0;
  }

  private buildFloodWaveVisual(scene: THREE.Scene): void {
    const group = new THREE.Group();
    group.name = 'desert.floodWave';

    const waterMat = new THREE.MeshBasicMaterial({
      color: '#7c6244',
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(24, 14), waterMat);
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set(0, 0.35, -7);
    group.add(sheet);

    const foamMat = new THREE.MeshBasicMaterial({
      color: '#ebe3d5',
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    // Surging frothy leading crest wall
    const crest = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.9, 24, 10), foamMat);
    crest.rotation.z = Math.PI / 2;
    crest.position.set(0, 0.72, 0);
    group.add(crest);

    group.visible = false;
    scene.add(group);
    this.floodWaveGroup = group;
    this.floodWaveMat = waterMat;
    this.floodFoamMat = foamMat;
  }

  private buildSewerBeacon(scene: THREE.Scene, materials: ModelMaterials): void {
    const [sx, sy, sz] = PUMP_YARD.sewerDropPos;
    const group = new THREE.Group();
    group.name = 'desert.sewerBeacon';
    group.position.set(sx, sy, sz);

    const b = new ModelBuilder();
    // Emergency road flare tube on rim of the open grate
    b.cyl(0.06, 0.06, 0.42, 8, '#b8281c', { at: [1.35, 0.14, 0.6], rot: [0.35, 0, -0.5] });
    b.glow(new THREE.SphereGeometry(0.18, 8, 6), '#ff5a22', 4.8, { at: [1.5, 0.32, 0.65] });
    group.add(materials.group(b));

    const ringGeo = new THREE.RingGeometry(1.15, 1.48, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff5e22').multiplyScalar(2.6),
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, 0.12, 0);
    group.add(ring);
    this.sewerRingMesh = ring;

    const light = new THREE.PointLight(0xff521b, 0, 26, 1.5);
    light.position.set(0, 1.6, 0);
    group.add(light);
    this.sewerFlareLight = light;

    group.visible = false;
    scene.add(group);
    this.sewerBeaconGroup = group;
  }

  private buildQuistHudDom(): void {
    if (typeof document === 'undefined' || !this.ui?.el) return;
    if (this.quistHud) return;
    const badgeEl = span('fc-nuke-badge', 'HADREK QUIST // CORNERED');
    const textEl = span('fc-nuke-text', '[HOLD E] Capture Quist  ·  [TAP E] Talk  ·  or Shoot');
    const fill = div('fc-fill');
    const track = div('fc-track', fill);
    track.style.width = '100%';
    track.style.marginTop = '0.28rem';
    track.style.display = 'none';
    const root = div('fc-nuke-prompt', badgeEl, textEl, track);
    this.ui.el.append(root);
    this.quistHud = {
      root,
      badge: new Label(badgeEl),
      text: new Label(textEl),
      track,
      fill,
    };
  }

  private attachWorldHooks(): void {
    if (this.hooksAttached) return;
    const objects = this.ctx.world?.objects;
    if (objects) {
      this.prevColliderHitHandler = objects.colliderHitHandler ?? null;
      this.prevBlastHandler = objects.blastHandler ?? null;
      objects.colliderHitHandler = this.onColliderHit;
      objects.blastHandler = this.onBlast;
      this.hooksAttached = true;
    }
    if (this.ctx.events?.on && !this.unsubImpact) {
      this.unsubImpact = this.ctx.events.on('weapon:impact', e => {
        // When real Enemy NPC is spawned, bullets hit his real bone hitboxes directly.
        if (this.quistEnemy) return;
        if (!this.isQuistKillableState()) return;
        const dx = e.position.x - this.quistPos.x;
        const dy = e.position.y - (this.quistPos.y + 0.95);
        const dz = e.position.z - this.quistPos.z;
        if (dx * dx + dy * dy + dz * dz <= 1.05 * 1.05) {
          this.damageQuist(40, e.weapon);
        }
      });
    }
  }

  private detachWorldHooks(): void {
    const objects = this.ctx.world?.objects;
    if (objects && this.hooksAttached) {
      if (objects.colliderHitHandler === this.onColliderHit) {
        objects.colliderHitHandler = this.prevColliderHitHandler;
      }
      if (objects.blastHandler === this.onBlast) {
        objects.blastHandler = this.prevBlastHandler;
      }
    }
    this.hooksAttached = false;
    this.prevColliderHitHandler = null;
    this.prevBlastHandler = null;
    this.unsubImpact?.();
    this.unsubImpact = null;
  }

  private readonly onColliderHit = (collider: RAPIER.Collider, amount: number, source: string): boolean => {
    // Solid Bulldozer Main Gate: metallic ricochet sparks, impervious to small arms
    if (this.gateCollider && !this.gateBreached && collider.handle === this.gateCollider.handle) {
      this.onMainGateRicochet();
      return true;
    }
    // Hadrek Quist fallback target collider (only present when running headless without `enemies.spawn`)
    if (this.quistCollider && collider.handle === this.quistCollider.handle) {
      this.damageQuist(amount, source);
      return true;
    }
    return this.prevColliderHitHandler?.(collider, amount, source) ?? false;
  };

  private readonly onBlast = (center: THREE.Vector3, radius: number, amount: number, source: string): void => {
    this.prevBlastHandler?.(center, radius, amount, source);
    if (radius <= 0 || amount <= 0) return;
    // Real Enemy NPC takes blast damage directly through Combat.explode -> EnemyManager.applyDamage
    if (this.quistEnemy) return;
    if (!this.quistRig?.root.visible) return;
    if (this.quistOutcome !== null || this._quistState === 'inactive') return;
    if (source === 'quist_grenade') return;

    _v.set(this.quistPos.x, this.quistPos.y + 0.95, this.quistPos.z);
    if (_v.distanceTo(center) <= radius + 1.1) {
      this.damageQuist(amount, source);
    }
  };

  // -----------------------------------------------------------------------------------------------
  // 1. Loudspeaker Poles
  // -----------------------------------------------------------------------------------------------

  pulseLoudspeaker(): void {
    this.ensureBuilt();
    if (this.poles.length === 0) return;

    const p = this.ctx.player?.position;
    let best = this.poles[0]!;
    let bestDistSq = Infinity;
    if (p) {
      for (const pole of this.poles) {
        const dx = pole.pos.x - p.x;
        const dz = pole.pos.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          best = pole;
        }
      }
    }

    best.pulseTimer = 1.65;
    this._lastPulsedPoleIndex = best.index;
    best.beaconMat.color.set('#ff3a18').multiplyScalar(4.8);
    best.beaconMesh.scale.setScalar(1.45);
    this.ctx.render.lights?.flash?.(best.hornPos, 0xff7722, 3.8, 18, 0.55);

    // Emit 3 staggered expanding audio-wave rings from the nearest pole's horns
    for (let s = 0; s < 3; s++) {
      const ring = this.waveRings[this.waveRingCursor % this.waveRings.length]!;
      this.waveRingCursor++;
      ring.active = true;
      ring.age = 0;
      ring.delay = s * 0.22;
      ring.duration = 0.95;
      ring.mesh.position.copy(best.hornPos);
      ring.mesh.scale.setScalar(0.5);
      ring.mesh.visible = ring.delay === 0;
      ring.mat.opacity = 0.85;
    }
  }

  private updateLoudspeakers(dt: number): void {
    for (const pole of this.poles) {
      if (pole.pulseTimer > 0) {
        pole.pulseTimer = Math.max(0, pole.pulseTimer - dt);
        const t = pole.pulseTimer / 1.65;
        const blink = 0.72 + 0.28 * Math.sin(pole.pulseTimer * 24);
        pole.beaconMat.color.set('#ff451a').multiplyScalar(1.3 + t * 3.6 * blink);
        pole.beaconMesh.scale.setScalar(1.0 + t * 0.45 * blink);
      } else {
        pole.beaconMat.color.set('#ff7b24').multiplyScalar(1.1);
        pole.beaconMesh.scale.setScalar(1.0);
      }
    }

    for (const ring of this.waveRings) {
      if (!ring.active) continue;
      if (ring.delay > 0) {
        ring.delay -= dt;
        if (ring.delay <= 0) {
          ring.mesh.visible = true;
        }
        continue;
      }
      ring.age += dt;
      const u = ring.age / ring.duration;
      if (u >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        ring.mat.opacity = 0;
        continue;
      }
      const scale = lerp(0.55, 5.8, u);
      ring.mesh.scale.setScalar(scale);
      ring.mat.opacity = (1 - u) * 0.85;
    }
  }

  // -----------------------------------------------------------------------------------------------
  // 2. Solid Bulldozer-Blade Main Gate
  // -----------------------------------------------------------------------------------------------

  private onMainGateRicochet(): void {
    this._gateRicochetCount++;
    const p = this.ctx.player?.position;
    const hitX = p ? clamp(p.x, MAIN_GATE.x - 6.2, MAIN_GATE.x + 6.2) : MAIN_GATE.x;
    _v.set(hitX, MAIN_GATE.y + rand(1.4, 4.2), MAIN_GATE.z + 1.45);
    this.ctx.fx?.sparks?.(_v, _south, 10, 0xffe49e);
    this.ctx.render.lights?.flash?.(_v, 0xffd27a, 2.4, 7, 0.08);
    this.ctx.audio?.play?.('ricochet', { position: _v, volume: 0.78, pitchJitter: 0.14 });
    this.ctx.audio?.play?.('impact_metal', { position: _v, volume: 0.65, pitchJitter: 0.1 });
  }

  shatterMainGate(): void {
    this.ensureBuilt();
    if (this.gateBreached) return;
    this.gateBreached = true;

    this.removeMainGateCollider();
    if (this.gateGroup) this.gateGroup.visible = false;

    const origin = _v.set(MAIN_GATE.x, MAIN_GATE.y + 3.0, MAIN_GATE.z);
    this.ctx.fx?.explosion?.(origin, { radius: 11, kind: 'rocket', scale: 1.5 });
    this.ctx.fx?.smoke?.(origin, 0x2a2420, 4.8, 3.5);
    this.ctx.fx?.embers?.(origin, 42, 6.0);
    this.ctx.fx?.sparks?.(origin, _south, 34, 0xffb84d);
    this.ctx.render.lights?.flash?.(origin, 0xff8022, 8.0, 34, 0.45);
    this.ctx.camera?.addTrauma?.(0.88);
    this.ctx.audio?.play?.('explosion_tank', { position: origin, volume: 1.0 });
    this.ctx.audio?.play?.('explosion_debris', { position: origin, volume: 0.9 });
    this.ctx.audio?.play?.('metal_clang', { position: origin, volume: 0.95, pitch: 0.68 });
    this.ctx.audio?.play?.('wreck_land', { position: origin, volume: 0.85 });

    this.spawnMainGateDebris();
    this.gateSmokeTimer = 12.0;
    this.gateSmokeTick = 0;
  }

  private spawnMainGateDebris(): void {
    this.clearGateDebris();
    const scene = this.ctx.render.scene;
    const colors = ['#d29e24', '#b47f1c', '#733e1f', '#3d434a', '#23272c'];
    const count = 18;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const isBlade = i < 8;
      const w = isBlade ? rand(1.3, 2.4) : rand(0.9, 1.9);
      const h = isBlade ? rand(0.45, 0.9) : rand(0.6, 1.4);
      const d = rand(0.22, 0.45);
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length],
        roughness: 0.72,
        metalness: 0.55,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(
        MAIN_GATE.x + side * rand(0.8, 6.2),
        MAIN_GATE.y + rand(0.8, 5.8),
        MAIN_GATE.z + rand(-0.6, 1.6),
      );
      scene.add(mesh);
      // Launch chunks outward toward flanks & northward so the center convoy road clears
      const vel = new THREE.Vector3(
        side * rand(5.5, 13.5),
        rand(5.0, 12.5),
        rand(-14.0, -4.0),
      );
      const angVel = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
      this.gateDebris.push({ mesh, vel, angVel, settled: false });
    }
  }

  private clearGateDebris(): void {
    for (const chunk of this.gateDebris) {
      chunk.mesh.parent?.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      (chunk.mesh.material as THREE.Material).dispose();
    }
    this.gateDebris.length = 0;
  }

  private updateGateDebris(dt: number): void {
    for (const c of this.gateDebris) {
      if (c.settled) continue;
      c.vel.y -= 24 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.angVel.x * dt;
      c.mesh.rotation.y += c.angVel.y * dt;
      c.mesh.rotation.z += c.angVel.z * dt;
      if (c.mesh.position.y <= 0.28) {
        c.mesh.position.y = 0.28;
        c.vel.y = Math.abs(c.vel.y) * 0.26;
        c.vel.x *= 0.52;
        c.vel.z *= 0.52;
        c.angVel.multiplyScalar(0.5);
        if (Math.abs(c.vel.y) < 0.7 && Math.hypot(c.vel.x, c.vel.z) < 0.8) {
          c.settled = true;
        }
      }
    }

    if (this.gateSmokeTimer > 0) {
      this.gateSmokeTimer = Math.max(0, this.gateSmokeTimer - dt);
      this.gateSmokeTick -= dt;
      if (this.gateSmokeTick <= 0) {
        this.gateSmokeTick = 0.45;
        const side = Math.random() < 0.5 ? -1 : 1;
        _v.set(MAIN_GATE.x + side * rand(4.5, 6.8), MAIN_GATE.y + 0.9, MAIN_GATE.z + rand(-1.5, 1.5));
        this.ctx.fx?.smoke?.(_v, 0x352e28, 2.2, 1.8);
        this.ctx.fx?.embers?.(_v, 5, 1.6);
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // 3. Pump Yard Water Tower Collapse, Flood Wave & Sewer Beacon
  // -----------------------------------------------------------------------------------------------

  armWaterTower(): void {
    this.ensureBuilt();
    this.sewerBeaconSuppressed = false;
    if (this.towerDropped) return;
    this.towerArmed = true;
  }

  triggerWaterTowerDrop(): void {
    this.ensureBuilt();
    if (this.towerDropped) return;

    this.towerDropped = true;
    this.towerArmed = false;
    this.towerCollapsing = true;
    this.towerImpacted = false;
    this.towerFallElapsed = 0;
    this.towerCreakPlayed = false;

    this.removeTowerLegColliders();

    // Explosive squib flashes snap the two north legs!
    const [bx, by, bz] = PUMP_YARD.towerBase;
    for (const sx of [-2.7, 2.7]) {
      _v.set(bx + sx, by + 1.8, bz - 2.7);
      this.ctx.fx?.explosion?.(_v, { radius: 3.5, kind: 'barrel', scale: 0.75 });
      this.ctx.fx?.sparks?.(_v, _up, 20, 0xffaa33);
      this.ctx.render.lights?.flash?.(_v, 0xff7722, 6.5, 18, 0.25);
    }
    _v.set(bx, by + 3.0, bz - 2.5);
    this.ctx.audio?.play?.('explosion_small', { position: _v, volume: 1.0 });
    this.ctx.audio?.play?.('metal_groan', { position: _v, volume: 1.0, pitch: 0.8 });
    this.ctx.camera?.addTrauma?.(0.45);
  }

  private updateWaterTower(dt: number): void {
    // Check player crossing north of z = -28 while armed on Pump Yard surface
    if (this.towerArmed && !this.towerDropped && this.ctx.player) {
      const p = this.ctx.player.position;
      if (p.z < TOWER_TRIGGER_Z && p.y > -3.0 && Math.abs(p.x) < 55) {
        this.triggerWaterTowerDrop();
      }
    }

    if (this.towerCollapsing) {
      this.towerFallElapsed += dt;
      const u = clamp(this.towerFallElapsed / TOWER_FALL_DURATION);
      const angle = -Math.pow(u, 2.2) * (Math.PI * 0.485);
      if (this.towerPivot) {
        this.towerPivot.rotation.x = angle;
      }

      if (!this.towerCreakPlayed && u >= 0.35) {
        this.towerCreakPlayed = true;
        _v.set(PUMP_YARD.towerBase[0], 6, PUMP_YARD.towerBase[2] - 4);
        this.ctx.audio?.play?.('metal_groan', { position: _v, volume: 0.9, pitch: 0.62 });
        this.ctx.fx?.sparks?.(_v, _up, 14, 0xffc86b);
      }

      if (this.towerFallElapsed + 1e-6 >= TOWER_FALL_DURATION) {
        this.onWaterTowerImpact();
      }
    }

    if (this.floodActive) {
      this.updateFloodWave(dt);
    }

    if (this.sewerBeaconOn) {
      this.updateSewerBeacon(dt);
    }
  }

  private onWaterTowerImpact(): void {
    this.towerCollapsing = false;
    this.towerImpacted = true;
    if (this.towerPivot) {
      this.towerPivot.rotation.x = -Math.PI * 0.485;
    }
    if (this.towerRubbleGroup) {
      this.towerRubbleGroup.visible = true;
    }

    const impactAt = _v.set(
      PUMP_YARD.blockedStreetCenter[0],
      PUMP_YARD.blockedStreetCenter[1] + 2.0,
      PUMP_YARD.blockedStreetCenter[2],
    );

    // Huge screen shake & thunderous metallic crash + rushing water audio (skip full-screen jolt if player already passed Pump Yard)
    if (!this.sewerBeaconSuppressed) {
      this.ctx.camera?.addTrauma?.(1.0);
      this.ctx.render.post?.chromatic?.(0.35, 0.45);
      this.ctx.render.post?.radialBlur?.(0.28, 0.35);
    }
    this.ctx.audio?.play?.('crusher_slam', { position: impactAt, volume: 1.0 });
    this.ctx.audio?.play?.('wreck_land', { position: impactAt, volume: 1.0 });
    this.ctx.audio?.play?.('explosion_debris', { position: impactAt, volume: 0.95 });
    this.ctx.audio?.play?.('metal_clang', { position: impactAt, volume: 0.95, pitch: 0.58 });
    this.ctx.audio?.play?.('steam_burst', { position: impactAt, volume: 1.0, pitch: 0.55 });

    // Impact water burst & dust plumes
    this.ctx.fx?.explosion?.(impactAt, { radius: 9, kind: 'barrel', scale: 1.2 });
    this.ctx.fx?.dust?.(impactAt, _up, 3.8);
    this.ctx.fx?.smoke?.(impactAt, 0x8e7c66, 5.2, 3.2);
    this.ctx.fx?.sparks?.(impactAt, _up, 26, 0xffd27a);
    this.ctx.render.lights?.flash?.(impactAt, 0xd8c8b0, 4.5, 28, 0.3);

    // Permanent solid rubble blocker colliders sealing surface street at z = -52
    this.installStreetRubbleColliders();

    // Launch surging brown-white flood wave sweeping south through the Pump Yard
    this.floodActive = true;
    this.floodElapsed = 0;
    this.floodKnockedPlayer = false;
    this.floodSprayTick = 0;
    this.floodKnockedEnemies.clear();
    if (this.floodWaveGroup) {
      this.floodWaveGroup.visible = true;
      this.floodWaveGroup.position.set(0, 0, -50);
      this.floodWaveGroup.scale.set(0.75, 1.0, 0.75);
    }

    // Activate pulsing Sewer Grate Drop beacon & flare light
    this.activateSewerBeacon();

    // Notify mission runner
    this.runner.signal('dr:tower_dropped');
  }

  private updateFloodWave(dt: number): void {
    this.floodElapsed += dt;
    const u = clamp(this.floodElapsed / TOWER_FLOOD_DURATION);
    const waveZ = lerp(-50, -14, u);

    if (this.floodWaveGroup) {
      this.floodWaveGroup.position.set(0, 0, waveZ);
      const widthScale = lerp(0.8, 1.55, u);
      const heightScale = Math.max(0.15, 1.0 - u * 0.75);
      this.floodWaveGroup.scale.set(widthScale, heightScale, lerp(0.75, 1.35, u));
    }
    if (this.floodWaveMat) {
      this.floodWaveMat.opacity = (1 - u * 0.85) * 0.72;
    }
    if (this.floodFoamMat) {
      this.floodFoamMat.opacity = (1 - u * 0.9) * 0.9;
    }

    // Surging spray particles along the wave crest
    this.floodSprayTick -= dt;
    if (this.floodSprayTick <= 0 && u < 0.9) {
      this.floodSprayTick = 0.14;
      for (const sx of [-6, 0, 6]) {
        _v.set(sx + rand(-1.5, 1.5), 0.7, waveZ);
        this.ctx.fx?.dust?.(_v, _up, 1.6);
        this.ctx.fx?.chips?.(_v, 0xd8d0c2, 6);
      }
    }

    // Knockback / stagger impulse knocking the player off their feet as the surge hits them
    const player = this.ctx.player;
    if (
      !this.floodKnockedPlayer &&
      player &&
      player.alive &&
      !player.parked &&
      player.position.y > -2.0 &&
      Math.abs(player.position.x) < 22 &&
      player.position.z <= waveZ + 3.5 &&
      player.position.z >= -56
    ) {
      this.floodKnockedPlayer = true;
      _v.set(rand(-1.5, 1.5), 3.4, 13.5);
      if (typeof player.launch === 'function') player.launch(_v);
      else player.push?.(_v);
      this.ctx.camera?.addTrauma?.(0.55);
      this.ctx.camera?.kick?.(0.18, 0, 0.14);
      this.ctx.audio?.play?.('slam_impact', { position: player.position, volume: 0.75, pitch: 0.8 });
    }

    // Knockback nearby enemies in Pump Yard
    const enemies = this.ctx.enemies?.alive;
    if (enemies) {
      for (const raw of enemies) {
        const e = raw as Enemy;
        if (!e.alive || this.floodKnockedEnemies.has(e.uid)) continue;
        if (
          e.position.y > -2.0 &&
          Math.abs(e.position.x) < 22 &&
          e.position.z <= waveZ + 3.0 &&
          e.position.z >= -56
        ) {
          this.floodKnockedEnemies.add(e.uid);
          if (e.velocity) {
            e.velocity.z += 12.0;
            e.velocity.y += 3.5;
          }
        }
      }
    }
    if (u < 0.75) {
      this.ctx.physics?.radialImpulse?.(_v.set(0, 1.0, waveZ), 9.0, 26);
    }

    if (this.floodElapsed >= TOWER_FLOOD_DURATION) {
      this.floodActive = false;
      if (this.floodWaveGroup) this.floodWaveGroup.visible = false;
    }
  }

  clearSewerBeacon(): void {
    this.sewerBeaconSuppressed = true;
    this.deactivateSewerBeacon();
  }

  private activateSewerBeacon(): void {
    if (this._quistState !== 'inactive' || this.sewerBeaconSuppressed) return;
    const pz = this.ctx.player?.position?.z;
    const py = this.ctx.player?.position?.y;
    if (pz !== undefined && py !== undefined && pz <= -76 && py >= -1.5) return;
    this.sewerBeaconOn = true;
    if (this.sewerBeaconGroup) this.sewerBeaconGroup.visible = true;
    if (this.sewerFlareLight) this.sewerFlareLight.intensity = 5.0;
    if (!this.sewerUnmark && this.ctx.hud?.marker) {
      const [sx, sy, sz] = PUMP_YARD.sewerDropPos;
      this.sewerUnmark = this.ctx.hud.marker(
        new THREE.Vector3(sx, sy + 1.8, sz),
        'SEWER GRATE DROP',
        '#ff6a22',
      );
    }
    this.ctx.hud?.feed?.('NORTH STREET BLOCKED — DROP INTO THE SEWER GRATE!', '#ff9c38');
  }

  private deactivateSewerBeacon(): void {
    this.sewerBeaconOn = false;
    if (this.sewerBeaconGroup) this.sewerBeaconGroup.visible = false;
    if (this.sewerFlareLight) this.sewerFlareLight.intensity = 0;
    this.sewerUnmark?.();
    this.sewerUnmark = null;
  }

  private updateSewerBeacon(dt: number): void {
    const p = this.ctx.player?.position;
    if (p && p.z <= -76 && p.y >= -1.5) {
      this.deactivateSewerBeacon();
      return;
    }
    const t = this.ctx.time?.elapsed ?? 0;
    const pulse = 0.65 + 0.35 * Math.sin(t * 7.5 + dt);
    if (this.sewerFlareLight) {
      this.sewerFlareLight.intensity = 3.2 + pulse * 3.4;
    }
    if (this.sewerRingMesh) {
      const s = 0.92 + 0.24 * Math.sin(t * 4.2);
      this.sewerRingMesh.scale.setScalar(s);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // 4. Hadrek Quist ("the Salt King") — Real Goreable NPC, 5-Outcome Finale & Live Cuffed Follower
  // -----------------------------------------------------------------------------------------------

  private applyEnemyDamage(enemy: Enemy, info: DamageInfo): void {
    const enemies = this.ctx.enemies as
      | (typeof this.ctx.enemies & { damage?: (e: Enemy, d: DamageInfo) => unknown })
      | undefined;
    if (!enemies) return;
    if (typeof enemies.applyDamage === 'function') {
      enemies.applyDamage(enemy, info);
    } else if (typeof enemies.damage === 'function') {
      enemies.damage(enemy, info);
    }
  }

  private setQuistPosture(posture: PostureName): void {
    const anim = this.quistEnemy?.char?.anim as
      | { setPosture?: (p: PostureName) => void }
      | undefined;
    anim?.setPosture?.(posture);
  }

  private retireQuistEnemy(): void {
    const enemy = this.quistEnemy;
    if (!enemy) {
      this.quistNpcProps = null;
      return;
    }
    this.quistEnemy = null;
    this.quistNpcProps = null;

    enemy.damageFilter = null;
    enemy.scriptedNpc = false;
    enemy.nonHostile = false;
    enemy.displayName = undefined;
    stripQuistGear(enemy);

    if (enemy.alive) {
      const mgr = this.ctx.enemies as unknown as { withdraw?: (e: Enemy) => void; alive?: Enemy[] } | undefined;
      if (typeof mgr?.withdraw === 'function') {
        mgr.withdraw(enemy);
      } else {
        enemy.alive = false;
        if (enemy.char?.root) enemy.char.root.visible = false;
        if (Array.isArray(mgr?.alive)) {
          const idx = mgr.alive.indexOf(enemy);
          if (idx >= 0) mgr.alive.splice(idx, 1);
        }
      }
    }
  }

  private filterQuistDamage(d: DamageInfo): boolean {
    // Always allow Quist's own scripted suicide headshot or grenade detonation even as state transitions to 'dead'.
    if (d.source === 'quist_suicide' || d.source === 'quist_grenade') {
      this.lastAllowedDamageType = d.type;
      return true;
    }

    if (this._quistState === 'inactive' || this._quistState === 'dead' || this._quistState === 'captured') {
      return false;
    }

    // Allies must NEVER steal the player's kill/capture or shoot cuffed Quist.
    if (isAllyDamageSource(d.source)) {
      return false;
    }

    // Phase A cowardly retreat through bulkhead doors: shots glance off pauldrons & hurry him along
    // so the bulkhead chase always plays out cleanly until he reaches the tail bay.
    if (
      this._quistState === 'wait_ramp' ||
      this._quistState === 'sprint_mid' ||
      this._quistState === 'wait_mid' ||
      this._quistState === 'sprint_tail'
    ) {
      _v.set(this.quistPos.x, this.quistPos.y + 1.45, this.quistPos.z);
      this.ctx.fx?.sparks?.(_v, _south, 8, 0xffd27a);
      this.ctx.audio?.play?.('impact_metal', { position: _v, volume: 0.7, pitchJitter: 0.1 });
      if (this._quistState === 'wait_ramp') {
        this.triggerBulkhead1Retreat();
      } else if (this._quistState === 'wait_mid') {
        this.triggerBulkhead2Retreat();
      }
      return false;
    }

    // Live cuffed escort mode:
    //   - Immune to ally gunfire & enemy gunfire/stray blasts
    //   - Vulnerable to world structural crushes (`type === 'crush'`, e.g. falling tower/shack!)
    //   - Vulnerable to deliberate player weapon/melee hits
    if (this._quistState === 'captured_escort') {
      if (d.type === 'crush') {
        this.lastAllowedDamageType = 'crush';
        return true;
      }
      if (isEnemyDamageSource(d.source)) {
        return false;
      }
      this.lastAllowedDamageType = d.type;
      return true;
    }

    // Tail bay vulnerable states (`wait_tail`, `speech`, `grenade_warning`, `suicide_draw`, `suicide_temple`):
    // Block stray enemy gunfire; ALLOW all player weapon damage & world crush for full gore/headshots!
    if (this.isQuistKillableState()) {
      if (isEnemyDamageSource(d.source)) {
        return false;
      }
      this.lastAllowedDamageType = d.type;
      return true;
    }

    return false;
  }

  startPlaneChase(hooks: QuistHooks): void {
    this.ensureBuilt();
    this.deactivateSewerBeacon();
    this.retireQuistEnemy();

    this.quistHooks = hooks;
    this.quistOutcome = null;
    this._quistState = 'wait_ramp';
    this.lastAllowedDamageType = 'bullet';
    this.quistDoor1Slammed = false;
    this.quistDoor2Slammed = false;
    this._speechElapsed = 0;
    this.nextSpeechBeat = 0;
    this.quistReplyIndex = 0;
    this.interactHeld = false;
    this.interactHoldTime = 0;
    this.captureHoldTime = 0;
    this.grenadeElapsed = 0;
    this.grenadeFlashTick = 0;
    this.suicideElapsed = 0;
    this.quistAnimPhase = 0;

    this.quistPos.set(
      CARGO_PLANE.quistWaitPos[0],
      CARGO_PLANE.quistWaitPos[1],
      CARGO_PLANE.quistWaitPos[2],
    );
    this.quistYaw = 0; // Facing south (+Z) toward the cargo ramp

    // Spawn a REAL goreable Enemy NPC via ctx.enemies.spawn('trooper', pos);
    // fall back to static QuistRig ONLY in headless unit tests where enemies.spawn is unavailable.
    const spawned =
      typeof this.ctx.enemies?.spawn === 'function'
        ? (this.ctx.enemies.spawn('trooper', this.quistPos) as Enemy | null)
        : null;

    if (spawned) {
      spawned.scriptedNpc = true;
      spawned.nonHostile = true;
      spawned.isBoss = true;
      spawned.displayName = 'HADREK QUIST';
      spawned.health = QUIST_NPC_MAX_HP;
      spawned.maxHealth = QUIST_NPC_MAX_HP;
      spawned.armor = 0;
      if (Array.isArray(spawned.plates)) spawned.plates = [];
      spawned.shield = false;
      spawned.ward = 0;
      spawned.mode = 'hold';
      spawned.face = 'lock';
      spawned.yaw = this.quistYaw;
      spawned.groundY = CARGO_PLANE.floorY;
      spawned.footbound = true;
      spawned.position?.copy?.(this.quistPos);
      spawned.velocity?.set?.(0, 0, 0);
      spawned.center?.set?.(this.quistPos.x, this.quistPos.y + 1.1, this.quistPos.z);
      spawned.damageFilter = (d: DamageInfo) => this.filterQuistDamage(d);

      this.quistEnemy = spawned;
      this.quistNpcProps = styleQuistNpc(spawned, this.ctx);
      this.setQuistPosture('stand');

      if (this.quistRig) this.quistRig.root.visible = false;
      this.removeQuistCollider();
    } else {
      this.quistEnemy = null;
      this.quistNpcProps = null;
      if (this.quistRig) {
        this.quistRig.root.visible = true;
        this.quistRig.root.position.copy(this.quistPos);
        this.quistRig.root.rotation.set(0, this.quistYaw, 0);
        this.quistRig.pistolInHand.visible = false;
        this.quistRig.pistolHolstered.visible = true;
        this.quistRig.grenadeInHand.visible = false;
        this.quistRig.redGlint.visible = false;
        this.quistRig.zipTie.visible = false;
      }
      this.syncQuistCollider();
    }

    this.hideQuistHud();
    this.quistUnmark?.();
    this.quistUnmark = this.ctx.hud?.follow
      ? this.ctx.hud.follow(this.quistPos, 'HADREK QUIST', '#ff9c38')
      : null;
  }

  advanceQuistToTail(): void {
    this.ensureBuilt();
    if (this.quistOutcome !== null) return;
    if (
      this._quistState === 'speech' ||
      this._quistState === 'grenade_warning' ||
      this._quistState === 'suicide_draw' ||
      this._quistState === 'suicide_temple'
    ) {
      return;
    }
    this.quistPos.set(
      CARGO_PLANE.quistCornerPos[0],
      CARGO_PLANE.quistCornerPos[1],
      CARGO_PLANE.quistCornerPos[2],
    );
    this.quistYaw = 0;

    if (this.quistEnemy && this.quistEnemy.alive) {
      this.quistEnemy.position.copy(this.quistPos);
      this.quistEnemy.center?.set?.(this.quistPos.x, this.quistPos.y + 1.1, this.quistPos.z);
      this.quistEnemy.groundY = CARGO_PLANE.floorY;
      this.quistEnemy.yaw = 0;
      this.quistEnemy.mode = 'hold';
      this.quistEnemy.face = 'player';
      this.quistEnemy.velocity?.set?.(0, 0, 0);
      this.setQuistPosture('stand');
    } else if (this.quistRig) {
      this.quistRig.root.visible = true;
      this.quistRig.root.position.copy(this.quistPos);
      this.quistRig.root.rotation.set(0, 0, 0);
      this.syncQuistCollider();
    }

    this.enterCorneredSpeech();
  }

  /**
   * Direct damage entry point for Quist.
   * Forwards into `ctx.enemies.applyDamage` when the real goreable `Enemy` NPC exists, or
   * handles headless fallback rigs in unit tests without `enemies.spawn`.
   */
  damageQuist(amount: number, source = 'weapon'): void {
    if (amount <= 0 || this._quistState === 'inactive' || this._quistState === 'dead' || this._quistState === 'captured') {
      return;
    }

    if (this.quistEnemy && this.quistEnemy.alive) {
      const hitPt = _v.set(this.quistPos.x, this.quistPos.y + 1.25, this.quistPos.z).clone();
      this.applyEnemyDamage(this.quistEnemy, {
        amount,
        type: 'bullet',
        point: hitPt,
        dir: new THREE.Vector3(0, 0, -1),
        force: 30,
        source,
        region: 'chest',
      });
      if (!this.quistEnemy.alive) {
        if (this.quistOutcome === null) {
          this.onRealQuistKilled();
        } else if (this._quistState === 'captured_escort') {
          this.onEscortedQuistDied();
        }
      }
      return;
    }

    // Headless fallback path (when `ctx.enemies.spawn` is absent)
    if (this._quistState === 'captured_escort') {
      if (isAllyDamageSource(source) || isEnemyDamageSource(source)) return;
      this.lastAllowedDamageType = source === 'structural_collapse' ? 'crush' : 'bullet';
      this.onEscortedQuistDied();
      return;
    }

    if (this.quistOutcome !== null) return;
    if (isAllyDamageSource(source) || isEnemyDamageSource(source)) return;

    if (this.isQuistKillableState()) {
      this.killQuist();
      return;
    }

    // Phase A cowardly retreat: shots glance off his welded steel shoulder pauldrons & hurry him along
    _v.set(this.quistPos.x, this.quistPos.y + 1.45, this.quistPos.z);
    this.ctx.fx?.sparks?.(_v, _south, 8, 0xffd27a);
    this.ctx.audio?.play?.('impact_metal', { position: _v, volume: 0.7, pitchJitter: 0.1 });
    if (this._quistState === 'wait_ramp') {
      this.triggerBulkhead1Retreat();
    } else if (this._quistState === 'wait_mid') {
      this.triggerBulkhead2Retreat();
    }
  }

  /**
   * Cleanly retires/hides the live walking cuffed Quist NPC when the player boards the exfil truck
   * (the middle convoy truck bed now carries cuffed Quist for the exfil chase & ending cutscene).
   */
  boardCapturedQuistToConvoy(): void {
    if (this._quistState !== 'captured_escort') return;
    this._quistState = 'captured';
    this.quistUnmark?.();
    this.quistUnmark = null;
    this.hideQuistHud();
    this.removeQuistCollider();
    this.retireQuistEnemy();
    if (this.quistRig) {
      this.quistRig.root.visible = false;
    }
  }

  private isQuistKillableState(): boolean {
    return (
      this._quistState === 'wait_tail' ||
      this._quistState === 'speech' ||
      this._quistState === 'grenade_warning' ||
      this._quistState === 'suicide_draw' ||
      this._quistState === 'suicide_temple'
    );
  }

  private syncQuistCollider(): void {
    const cx = this.quistPos.x;
    const cy = this.quistPos.y + 0.95;
    const cz = this.quistPos.z;
    if (!this.quistCollider) {
      if (!this.ctx.physics?.addStaticBox) return;
      this.quistCollider = this.ctx.physics.addStaticBox(
        new THREE.Vector3(cx, cy, cz),
        new THREE.Vector3(0.55, 0.95, 0.55),
        null,
        'flesh',
      );
      this.ctx.physics.markNoClimb?.(this.quistCollider);
      return;
    }
    const movable = this.quistCollider as unknown as {
      setTranslation?: (v: { x: number; y: number; z: number }) => void;
    };
    if (typeof movable.setTranslation === 'function') {
      movable.setTranslation({ x: cx, y: cy, z: cz });
    }
  }

  private removeQuistCollider(): void {
    if (!this.quistCollider) return;
    this.ctx.physics?.world?.removeCollider(this.quistCollider, false);
    this.quistCollider = null;
  }

  private triggerBulkhead1Retreat(): void {
    if (this.quistDoor1Slammed) return;
    this.quistDoor1Slammed = true;
    this._quistState = 'sprint_mid';
    this.setQuistPosture('flee');
    this.quistHooks?.onLine('quist.chase.1', { now: true });
    this.ctx.audio?.play?.('shutter_slam', {
      position: _v.set(0, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door1Z),
      volume: 0.9,
    });
    this.quistHooks?.onDoorSlam('plane.door1');
  }

  private triggerBulkhead2Retreat(): void {
    if (this.quistDoor2Slammed) return;
    this.quistDoor2Slammed = true;
    this._quistState = 'sprint_tail';
    this.setQuistPosture('flee');
    this.quistHooks?.onLine('quist.chase.2', { now: true });
    this.ctx.audio?.play?.('shutter_slam', {
      position: _v.set(0, CARGO_PLANE.floorY + 1.5, CARGO_PLANE.door2Z),
      volume: 0.9,
    });
    this.quistHooks?.onDoorSlam('plane.door2');
  }

  private enterCorneredSpeech(): void {
    this._quistState = 'speech';
    this._speechElapsed = 0;
    this.nextSpeechBeat = 0;
    this.quistReplyIndex = 0;
    this.interactHeld = false;
    this.interactHoldTime = 0;
    this.captureHoldTime = 0;
    this.quistYaw = 0;
    if (this.quistEnemy && this.quistEnemy.alive) {
      this.quistEnemy.mode = 'hold';
      this.quistEnemy.face = 'player';
      this.quistEnemy.velocity?.set?.(0, 0, 0);
      this.setQuistPosture('stand');
    }
    this.showSpeechHud();
    this.emitDueSpeechBeats();
  }

  private emitDueSpeechBeats(): void {
    while (this.nextSpeechBeat < QUIST_SPEECH_BEATS.length) {
      const beat = QUIST_SPEECH_BEATS[this.nextSpeechBeat]!;
      if (this._speechElapsed + 1e-6 < beat.at) break;
      this.nextSpeechBeat++;
      this.quistHooks?.onLine(beat.key);
    }
  }

  private updateQuist(dt: number): void {
    if (this._quistState === 'inactive') return;
    this.quistAnimPhase += dt;

    // Monitor real Enemy NPC liveness every frame so headshots, dismemberment, blasts, or crushes resolve immediately!
    if (this.quistEnemy) {
      if (!this.quistEnemy.alive) {
        if (this.quistOutcome === null && this._quistState !== 'dead') {
          this.onRealQuistKilled();
        } else if (this._quistState === 'captured_escort') {
          this.onEscortedQuistDied();
        }
        return;
      }
      if (this._quistState === 'captured_escort') {
        this.quistPos.copy(this.quistEnemy.position);
      }
    }

    const player = this.ctx.player;
    const pz = player ? player.position.z : 0;

    switch (this._quistState) {
      case 'wait_ramp':
        this.syncQuistEnemyPose(0, 0);
        if (pz < QUIST_RAMP_TRIGGER_Z) {
          this.triggerBulkhead1Retreat();
        }
        break;

      case 'sprint_mid': {
        const prevX = this.quistPos.x;
        const prevZ = this.quistPos.z;
        const arrived = this.moveQuistToward(
          CARGO_PLANE.quistMidPos[0],
          CARGO_PLANE.quistMidPos[1],
          CARGO_PLANE.quistMidPos[2],
          7.2,
          dt,
        );
        this.syncQuistEnemyPose((this.quistPos.x - prevX) / dt, (this.quistPos.z - prevZ) / dt);
        if (pz < QUIST_DOOR2_TRIGGER_Z) {
          this.triggerBulkhead2Retreat();
        } else if (arrived) {
          this._quistState = 'wait_mid';
          this.quistYaw = 0;
          this.setQuistPosture('stand');
          this.syncQuistEnemyPose(0, 0);
        }
        break;
      }

      case 'wait_mid':
        this.syncQuistEnemyPose(0, 0);
        if (pz < QUIST_DOOR2_TRIGGER_Z) {
          this.triggerBulkhead2Retreat();
        }
        break;

      case 'sprint_tail': {
        const prevX = this.quistPos.x;
        const prevZ = this.quistPos.z;
        const arrived = this.moveQuistToward(
          CARGO_PLANE.quistCornerPos[0],
          CARGO_PLANE.quistCornerPos[1],
          CARGO_PLANE.quistCornerPos[2],
          6.5,
          dt,
        );
        this.syncQuistEnemyPose((this.quistPos.x - prevX) / dt, (this.quistPos.z - prevZ) / dt);
        if (pz < QUIST_TAIL_TRIGGER_Z) {
          this.quistPos.set(
            CARGO_PLANE.quistCornerPos[0],
            CARGO_PLANE.quistCornerPos[1],
            CARGO_PLANE.quistCornerPos[2],
          );
          this.syncQuistEnemyPose(0, 0);
          this.enterCorneredSpeech();
        } else if (arrived) {
          this._quistState = 'wait_tail';
          this.quistYaw = 0;
          this.setQuistPosture('stand');
          this.syncQuistEnemyPose(0, 0);
        }
        break;
      }

      case 'wait_tail':
        this.syncQuistEnemyPose(0, 0);
        if (pz < QUIST_TAIL_TRIGGER_Z) {
          this.enterCorneredSpeech();
        }
        break;

      case 'speech':
        this.updateQuistSpeech(dt);
        this.syncQuistEnemyPose(0, 0);
        break;

      case 'grenade_warning':
        this.updateQuistGrenadeWarning(dt);
        this.syncQuistEnemyPose(0, 0);
        break;

      case 'suicide_draw':
      case 'suicide_temple':
        this.updateQuistSuicide(dt);
        this.syncQuistEnemyPose(0, 0);
        break;

      case 'captured_escort':
        this.updateCapturedEscort(dt);
        break;

      case 'captured':
      case 'dead':
        break;
    }

    if (!this.quistEnemy) {
      this.syncQuistVisuals();
      if (this.quistCollider) {
        this.syncQuistCollider();
      }
    }
  }

  private syncQuistEnemyPose(vx: number, vz: number): void {
    const e = this.quistEnemy;
    if (!e || !e.alive) return;
    e.mode = 'hold';
    e.position.copy(this.quistPos);
    e.groundY = this.quistPos.y;
    e.yaw = this.quistYaw;
    e.velocity?.set?.(vx, 0, vz);
    e.center?.set?.(this.quistPos.x, this.quistPos.y + 1.1, this.quistPos.z);
  }

  private updateCapturedEscort(dt: number): void {
    const player = this.ctx.player;
    if (!player) return;

    const e = this.quistEnemy;
    const curX = e ? e.position.x : this.quistPos.x;
    const curY = e ? e.position.y : this.quistPos.y;
    const curZ = e ? e.position.z : this.quistPos.z;

    const dx = curX - player.position.x;
    const dy = curY - player.position.y;
    const dz = curZ - player.position.z;
    const horizDist = Math.hypot(dx, dz);
    const totalDist = Math.hypot(dx, dy, dz);

    // Teleport catch-up ONLY if > 32 m stuck behind geometry
    if (totalDist > QUIST_ESCORT_TELEPORT_DIST) {
      const fwd = player.forward;
      const backX = fwd ? -fwd.x : 0;
      const backZ = fwd ? -fwd.z : -1;
      const len = Math.hypot(backX, backZ) || 1;
      _v.set(
        player.position.x + (backX / len) * QUIST_ESCORT_TRAIL_DIST,
        player.position.y,
        player.position.z + (backZ / len) * QUIST_ESCORT_TRAIL_DIST,
      );
      const nav = this.ctx.world?.nav;
      if (nav && typeof nav.nearest === 'function' && nav.nearest(_v, 8, _v2)) {
        _v.copy(_v2);
      }
      this.quistPos.copy(_v);
      if (e) {
        e.position.copy(_v);
        e.groundY = _v.y;
        e.velocity?.set?.(0, 0, 0);
        e.center?.set?.(_v.x, _v.y + 1.1, _v.z);
        e.mode = 'hold';
        e.face = 'player';
      }
      return;
    }

    if (horizDist > QUIST_ESCORT_STOP_DIST) {
      // Smoothly trail behind player (~3.2 m), jogging faster if > 6 m away
      const nx = horizDist > 1e-4 ? dx / horizDist : 0;
      const nz = horizDist > 1e-4 ? dz / horizDist : -1;
      const targetX = player.position.x + nx * (QUIST_ESCORT_TRAIL_DIST * 0.78);
      const targetZ = player.position.z + nz * (QUIST_ESCORT_TRAIL_DIST * 0.78);
      const targetY = player.position.y;

      if (e) {
        e.mode = 'point';
        e.face = 'move';
        e.pace = horizDist > QUIST_ESCORT_JOG_DIST ? 1.15 : 0.72;
        e.moveTarget.set(targetX, targetY, targetZ);
        this.setQuistPosture('cuffed');
      } else {
        const speed = horizDist > QUIST_ESCORT_JOG_DIST ? 6.4 : 4.0;
        this.moveQuistToward(targetX, targetY, targetZ, speed, dt);
      }
    } else {
      // Close enough: stop smoothly and face player
      const faceYaw = Math.atan2(player.position.x - curX, player.position.z - curZ);
      this.quistYaw = faceYaw;
      if (e) {
        e.mode = 'hold';
        e.face = 'player';
        e.pace = 0;
        e.yaw = faceYaw;
        e.velocity?.set?.(0, 0, 0);
        this.setQuistPosture('cuffed');
      }
    }
  }

  private moveQuistToward(tx: number, ty: number, tz: number, speed: number, dt: number): boolean {
    const dx = tx - this.quistPos.x;
    const dz = tz - this.quistPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.12) {
      this.quistPos.set(tx, ty, tz);
      return true;
    }
    const step = Math.min(dist, speed * dt);
    this.quistPos.x += (dx / dist) * step;
    this.quistPos.y = ty;
    this.quistPos.z += (dz / dist) * step;
    this.quistYaw = Math.atan2(dx, dz);
    return step >= dist - 1e-4;
  }

  private updateQuistSpeech(dt: number): void {
    const player = this.ctx.player;
    const dist = player ? this.quistPos.distanceTo(player.position) : Infinity;

    // Face calmly toward player while keeping back to tail bulkhead
    if (player) {
      const targetYaw = Math.atan2(player.position.x - this.quistPos.x, player.position.z - this.quistPos.z);
      this.quistYaw = clamp(targetYaw, -0.65, 0.65);
    }

    // Handle [E] Hold (Outcome 1: Capture) vs [E] Tap (Outcome 2: Talk)
    const input = this.ctx.input;
    const down = input?.isDown?.('interact') ?? false;
    const pressed = input?.pressed?.('interact') ?? false;
    const released = input?.released?.('interact') ?? false;

    if (pressed && !down) {
      // Single-frame tap (e.g. instantaneous press pulse)
      if (dist <= QUIST_TALK_RANGE) {
        this.triggerQuistReply();
      }
      this.interactHeld = false;
      this.interactHoldTime = 0;
      this.captureHoldTime = 0;
      this.ctx.hud?.hold?.(0);
    } else if (down) {
      if (!this.interactHeld) {
        this.interactHeld = true;
        this.interactHoldTime = 0;
      }
      this.interactHoldTime += dt;
      if (dist <= QUIST_CAPTURE_RANGE) {
        this.captureHoldTime += dt;
        const progress = clamp(this.captureHoldTime / QUIST_CAPTURE_HOLD);
        this.ctx.hud?.hold?.(progress);
        this.updateSpeechHudProgress(progress);
        if (this.captureHoldTime + 1e-6 >= QUIST_CAPTURE_HOLD) {
          this.captureQuist();
          return;
        }
      } else {
        this.captureHoldTime = 0;
        this.ctx.hud?.hold?.(0);
        this.updateSpeechHudProgress(0);
      }
    } else if (this.interactHeld || released) {
      if (this.interactHeld && this.interactHoldTime < QUIST_TAP_MAX && dist <= QUIST_TALK_RANGE) {
        this.triggerQuistReply();
      }
      this.interactHeld = false;
      this.interactHoldTime = 0;
      this.captureHoldTime = 0;
      this.ctx.hud?.hold?.(0);
      this.updateSpeechHudProgress(0);
    }

    // Advance 17.5-second calm last speech clock (never paused by Tap-E replies!)
    this._speechElapsed += dt;
    this.emitDueSpeechBeats();

    if (this._speechElapsed + 1e-6 >= QUIST_SPEECH_DURATION) {
      this.ctx.hud?.hold?.(0);
      this.interactHeld = false;
      this.interactHoldTime = 0;
      this.captureHoldTime = 0;
      if (dist <= QUIST_GRENADE_RANGE) {
        this.beginGrenadeWarning();
      } else {
        this.beginPistolSuicide();
      }
    }
  }

  private triggerQuistReply(): void {
    let key = QUIST_REPLY_KEYS[this.quistReplyIndex % QUIST_REPLY_KEYS.length]!;
    this.quistReplyIndex++;
    // If mission lines don't define `quist.reply.3`, fall back cleanly to `quist.reply.2`.
    const lines = this.runner?.mission?.lines;
    if (key === 'quist.reply.3' && Array.isArray(lines) && !lines.some(l => l.id === 'mission.desert_raid.quist.reply.3')) {
      key = 'quist.reply.2';
    }
    this.quistHooks?.onLine(key, { now: true });
  }

  private captureQuist(): void {
    if (this.quistOutcome !== null) return;
    this.quistOutcome = 'captured';
    this._quistState = 'captured_escort';
    this.interactHeld = false;
    this.captureHoldTime = QUIST_CAPTURE_HOLD;
    this.ctx.hud?.hold?.(0);
    this.hideQuistHud();
    this.removeQuistCollider();

    // Keep Quist ALIVE in the world as a cuffed follower NPC!
    if (this.quistEnemy && this.quistEnemy.alive) {
      this.quistEnemy.nonHostile = true;
      this.quistEnemy.scriptedNpc = true;
      this.quistEnemy.damageFilter = (d: DamageInfo) => this.filterQuistDamage(d);
      this.setQuistPosture('cuffed');
    }
    if (this.quistNpcProps) {
      this.quistNpcProps.setCuffed(true);
      this.quistNpcProps.pistolInHand.visible = false;
      this.quistNpcProps.grenadeInHand.visible = false;
      this.quistNpcProps.redGlint.visible = false;
    }
    if (this.quistRig) {
      this.quistRig.zipTie.visible = true;
      this.quistRig.pistolInHand.visible = false;
      this.quistRig.grenadeInHand.visible = false;
      this.quistRig.redGlint.visible = false;
    }

    // Update floating HUD marker to live escort status
    this.quistUnmark?.();
    this.quistUnmark = this.ctx.hud?.follow
      ? this.ctx.hud.follow(this.quistPos, 'CAPTURED: HADREK QUIST [ESCORTING]', '#5ce08a')
      : null;

    this.ctx.audio?.play?.('cuff_click', { position: this.quistPos, volume: 0.9 });
    this.ctx.audio?.play?.('style_bonus', { volume: 0.7 });
    this.quistHooks?.onLine('quist.captured', { now: true });
    this.ctx.progression?.award?.(QUIST_CAPTURE_BONUS, 'HADREK QUIST CAPTURED', this.quistPos);
    this.ctx.hud?.feed?.(`HADREK QUIST CAPTURED ALIVE (+$${QUIST_CAPTURE_BONUS.toLocaleString('en-US')} BONUS) — ESCORT TO EXFIL`, '#5ce08a');
    this.quistHooks?.onOutcome('captured');
    this.runner.signal('dr:quist_done');
  }

  /** Called immediately when the real goreable Quist Enemy NPC dies during the tail bay confrontation. */
  private onRealQuistKilled(): void {
    if (this.quistOutcome !== null) return;
    this.quistOutcome = 'killed';
    this._quistState = 'dead';
    this.interactHeld = false;
    this.captureHoldTime = 0;
    this.ctx.hud?.hold?.(0);
    this.hideQuistHud();
    this.removeQuistCollider();
    this.quistUnmark?.();
    this.quistUnmark = null;

    // Cut off his speech mid-word!
    this.ui?.hush?.();

    if (this.quistNpcProps) {
      this.quistNpcProps.grenadeInHand.visible = false;
      this.quistNpcProps.redGlint.visible = false;
      this.quistNpcProps.pistolInHand.visible = false;
    }
    this.ctx.hud?.hitMarker?.('kill');
    this.quistHooks?.onOutcome('killed');
    this.runner.signal('dr:quist_killed');
    this.runner.signal('dr:quist_done');
  }

  /** Called if cuffed Quist is killed (crushed by falling debris or shot by the player) during escort to exfil. */
  private onEscortedQuistDied(): void {
    if (this._quistState !== 'captured_escort') return;
    const reason: 'crushed' | 'shot' = this.lastAllowedDamageType === 'crush' ? 'crushed' : 'shot';
    this._quistState = 'dead';
    this.hideQuistHud();
    this.removeQuistCollider();
    this.quistUnmark?.();
    this.quistUnmark = null;

    if (this.quistNpcProps) {
      this.quistNpcProps.setCuffed(false);
    }

    if (reason === 'crushed') {
      this.ctx.hud?.feed?.('HADREK QUIST CRUSHED BY FALLING DEBRIS!', '#ff6b4a');
    } else {
      this.ctx.hud?.feed?.('PRISONER HADREK QUIST KILLED IN CUSTODY', '#ff6b4a');
    }
    this.quistHooks?.onEscortLost?.(reason);
    this.runner.signal('dr:quist_escort_lost');
  }

  /** Headless fallback kill handler (used only when `ctx.enemies.spawn` was unavailable). */
  private killQuist(): void {
    if (this.quistOutcome !== null) return;
    this.quistOutcome = 'killed';
    this._quistState = 'dead';
    this.interactHeld = false;
    this.captureHoldTime = 0;
    this.ctx.hud?.hold?.(0);
    this.hideQuistHud();
    this.removeQuistCollider();
    this.quistUnmark?.();
    this.quistUnmark = null;

    // Cut off his speech mid-word!
    this.ui?.hush?.();

    if (this.quistRig) {
      this.quistRig.grenadeInHand.visible = false;
      this.quistRig.redGlint.visible = false;
      this.quistRig.pistolInHand.visible = false;
    }

    const hitPt = _v.set(this.quistPos.x, this.quistPos.y + 1.25, this.quistPos.z);
    this.ctx.fx?.bloodHit?.(hitPt, _south, 1.4);
    this.ctx.fx?.bloodMist?.(hitPt, 1.3);
    this.ctx.render.decals?.add?.('bloodPool', _v2.set(this.quistPos.x, this.quistPos.y + 0.02, this.quistPos.z), _up, 1.4);
    this.ctx.audio?.play?.('bullet_body', { position: hitPt, volume: 0.95 });
    this.ctx.audio?.play?.('hit_punch', { position: hitPt, volume: 0.9 });
    this.ctx.audio?.play?.('enemy_die', { position: hitPt, volume: 0.9 });
    this.ctx.audio?.play?.('body_thud', { position: this.quistPos, volume: 0.85 });
    this.ctx.hud?.hitMarker?.('kill');

    this.quistHooks?.onOutcome('killed');
    this.runner.signal('dr:quist_killed');
    this.runner.signal('dr:quist_done');
  }

  private beginGrenadeWarning(): void {
    this._quistState = 'grenade_warning';
    this.grenadeElapsed = 0;
    this.grenadeFlashTick = 0;

    this.setQuistPosture('fumble');
    if (this.quistNpcProps) {
      this.quistNpcProps.grenadeInHand.visible = true;
      this.quistNpcProps.redGlint.visible = true;
    }
    if (this.quistRig) {
      this.quistRig.grenadeInHand.visible = true;
      this.quistRig.redGlint.visible = true;
    }

    const glintPos = _v.set(this.quistPos.x, this.quistPos.y + 1.25, this.quistPos.z + 0.2);
    this.ctx.render.lights?.flash?.(glintPos, 0xff2010, 6.0, 12, QUIST_GRENADE_WINDOW);
    this.ctx.fx?.ring?.(glintPos, _south, 0xff2010, 1.1);
    this.ctx.audio?.play?.('gear_rustle', { position: glintPos, volume: 1.0 });
    this.ctx.audio?.play?.('grenade_pin', { position: glintPos, volume: 1.0 });
    this.quistHooks?.onLine('quist.end.grenade', { now: true });

    this.showGrenadeWarningHud();
    this.ctx.hud?.banner?.('WARNING: GRENADE!', 'SHOOT QUIST OR GET BACK!', '#ff3b30');
  }

  private updateQuistGrenadeWarning(dt: number): void {
    this.grenadeElapsed += dt;
    this.grenadeFlashTick -= dt;

    const pulse = 0.6 + 0.4 * Math.sin(this.grenadeElapsed * 28);
    if (this.quistNpcProps) {
      this.quistNpcProps.redGlint.scale.setScalar(0.85 + pulse * 0.95);
      this.quistNpcProps.redGlintMat.opacity = 0.65 + pulse * 0.35;
    }
    if (this.quistRig) {
      this.quistRig.redGlint.scale.setScalar(0.85 + pulse * 0.95);
      this.quistRig.redGlintMat.opacity = 0.65 + pulse * 0.35;
    }

    if (this.grenadeFlashTick <= 0) {
      this.grenadeFlashTick = 0.25;
      _v.set(this.quistPos.x, this.quistPos.y + 1.25, this.quistPos.z + 0.2);
      this.ctx.render.lights?.flash?.(_v, 0xff2010, 5.2, 10, 0.2);
    }

    if (this.grenadeElapsed + 1e-6 >= QUIST_GRENADE_WINDOW) {
      this.detonateQuistGrenade();
    }
  }

  private detonateQuistGrenade(): void {
    if (this.quistOutcome !== null) return;
    this._quistState = 'dead';
    this.hideQuistHud();
    this.removeQuistCollider();
    this.quistUnmark?.();
    this.quistUnmark = null;

    if (this.quistNpcProps) {
      this.quistNpcProps.grenadeInHand.visible = false;
      this.quistNpcProps.redGlint.visible = false;
    }
    if (this.quistRig) {
      this.quistRig.grenadeInHand.visible = false;
      this.quistRig.redGlint.visible = false;
    }

    const blastAt = _v.set(this.quistPos.x, this.quistPos.y + 0.4, this.quistPos.z).clone();
    this.ctx.fx?.explosion?.(blastAt, { radius: QUIST_GRENADE_RADIUS, kind: 'grenade', scale: 1.35 });
    this.ctx.fx?.smoke?.(blastAt, 0x26201c, 3.6, 2.8);
    this.ctx.fx?.embers?.(blastAt, 28, 3.5);
    this.ctx.render.lights?.flash?.(blastAt, 0xff7b28, 9.0, 24, 0.35);
    this.ctx.render.decals?.add?.('scorch', _v2.set(blastAt.x, this.quistPos.y + 0.02, blastAt.z), _up, 2.6);
    this.ctx.camera?.addTrauma?.(0.95);
    this.ctx.audio?.play?.('grenade_explode', { position: blastAt, volume: 1.0 });
    this.ctx.audio?.play?.('explosion_debris', { position: blastAt, volume: 0.9 });
    this.ctx.audio?.play?.('enemy_die', { position: blastAt, volume: 0.85 });

    // Blast & gib the real Quist Enemy NPC via real Enemy gore!
    if (this.quistEnemy && this.quistEnemy.alive) {
      this.applyEnemyDamage(this.quistEnemy, {
        amount: 9999,
        type: 'explosive',
        point: blastAt.clone(),
        dir: new THREE.Vector3(0, 1, 0),
        force: 220,
        source: 'quist_grenade',
        gib: true,
        region: 'chest',
      });
    }

    // Apply lethal close-range blast damage & knockback to player within 7.5 m
    const player = this.ctx.player;
    if (player && player.alive) {
      const dist = player.position.distanceTo(blastAt);
      if (dist <= QUIST_GRENADE_RADIUS) {
        const dmg = dist <= 3.0 ? 180 : Math.round(160 * (1 - (dist / QUIST_GRENADE_RADIUS) * 0.72));
        player.takeDamage({
          amount: dmg,
          from: blastAt.clone(),
          type: 'explosive',
          source: 'quist_grenade',
        });
        // Knock player back southward away from Quist
        _dir.subVectors(player.position, blastAt);
        _dir.y = 0;
        if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1);
        else _dir.normalize();
        const pushStrength = lerp(16, 6, dist / QUIST_GRENADE_RADIUS);
        _v2.set(_dir.x * pushStrength, 4.2, _dir.z * pushStrength);
        if (typeof player.launch === 'function') player.launch(_v2);
        else player.push?.(_v2);
      }
    }

    const survived = player ? player.alive && player.health > 0 : true;
    this.quistOutcome = survived ? 'grenade_survived' : 'grenade_killed';
    this.quistHooks?.onOutcome(this.quistOutcome);
    this.runner.signal('dr:quist_done');
  }

  private beginPistolSuicide(): void {
    this._quistState = 'suicide_draw';
    this.suicideElapsed = 0;
    this.hideQuistHud();

    this.setQuistPosture('pistol');
    if (this.quistNpcProps) {
      this.quistNpcProps.pistolHolstered.visible = false;
      this.quistNpcProps.pistolInHand.visible = true;
    }
    if (this.quistRig) {
      this.quistRig.pistolHolstered.visible = false;
      this.quistRig.pistolInHand.visible = true;
    }

    this.ctx.audio?.play?.('weapon_draw', { position: this.quistPos, volume: 0.9 });
    this.quistHooks?.onLine('quist.end.pistol', { now: true });
  }

  private updateQuistSuicide(dt: number): void {
    this.suicideElapsed += dt;
    if (this._quistState === 'suicide_draw' && this.suicideElapsed + 1e-6 >= QUIST_SUICIDE_DRAW) {
      this._quistState = 'suicide_temple';
      this.setQuistPosture('temple');
    }
    if (this.suicideElapsed + 1e-6 >= QUIST_SUICIDE_DRAW + QUIST_SUICIDE_TEMPLE) {
      this.executePistolSuicide();
    }
  }

  private executePistolSuicide(): void {
    if (this.quistOutcome !== null) return;
    this.quistOutcome = 'suicide';
    this._quistState = 'dead';
    this.removeQuistCollider();
    this.quistUnmark?.();
    this.quistUnmark = null;

    // Through the temple, left to right (matching src/enemies/outpost/flight.ts `shootSelf`)
    const headPos = _v.set(this.quistPos.x, this.quistPos.y + 1.66, this.quistPos.z).clone();
    const shotDir = _dir.set(-Math.cos(this.quistYaw), 0, Math.sin(this.quistYaw)).clone();

    this.ctx.audio?.play?.('enemy_pistol', { position: headPos, volume: 1.1 });
    this.ctx.audio?.play?.('head_pop', { position: headPos, volume: 0.75 });
    this.ctx.audio?.play?.('body_thud', { position: this.quistPos, volume: 0.85 });
    this.ctx.fx?.muzzleFlash?.(headPos, shotDir, 'pistol');
    this.ctx.render.lights?.flash?.(headPos, 0xffd27a, 4.5, 9, 0.09);
    this.ctx.fx?.bloodHit?.(headPos, shotDir, 1.5);
    this.ctx.fx?.bloodMist?.(headPos, 1.1);
    this.ctx.render.decals?.add?.('blood', _v2.set(this.quistPos.x, this.quistPos.y + 0.02, this.quistPos.z), _up, 1.3);

    // Fire a real lethal headshot through EnemySystem so his head splatters & ragdolls!
    if (this.quistEnemy && this.quistEnemy.alive) {
      this.applyEnemyDamage(this.quistEnemy, {
        amount: 9999,
        type: 'bullet',
        region: 'head',
        bone: HumanoidBone.head,
        point: headPos,
        dir: shotDir,
        force: 55,
        source: 'quist_suicide',
      });
    }

    this.quistHooks?.onOutcome('suicide');
    this.runner.signal('dr:quist_done');
  }

  // -----------------------------------------------------------------------------------------------
  // Quist Fallback Articulated Poses & Animations (headless test rig only)
  // -----------------------------------------------------------------------------------------------

  private syncQuistVisuals(): void {
    const rig = this.quistRig;
    if (!rig) return;

    rig.root.position.copy(this.quistPos);
    rig.root.rotation.set(0, this.quistYaw, 0);

    // Reset default neutral pose before applying state pose
    rig.pelvis.position.set(0, 0.96, 0);
    rig.pelvis.rotation.set(0, 0, 0);
    rig.torso.rotation.set(0, 0, 0);
    rig.head.rotation.set(0, 0, 0);
    rig.armL.rotation.set(0, 0, 0.08);
    rig.forearmL.rotation.set(-0.18, 0, 0);
    rig.armR.rotation.set(0, 0, -0.08);
    rig.forearmR.rotation.set(-0.18, 0, 0);
    rig.legL.rotation.set(0, 0, 0);
    rig.legR.rotation.set(0, 0, 0);

    const t = this.quistAnimPhase;

    switch (this._quistState) {
      case 'sprint_mid':
      case 'sprint_tail': {
        const stride = Math.sin(t * 14);
        rig.pelvis.position.y = 0.94 + Math.abs(Math.cos(t * 14)) * 0.06;
        rig.torso.rotation.x = 0.28;
        rig.legL.rotation.x = stride * 0.78;
        rig.legR.rotation.x = -stride * 0.78;
        rig.armL.rotation.x = -stride * 0.65;
        rig.armR.rotation.x = stride * 0.65;
        rig.forearmL.rotation.x = -0.85;
        rig.forearmR.rotation.x = -0.85;
        break;
      }

      case 'wait_ramp':
      case 'wait_mid':
      case 'wait_tail': {
        rig.torso.rotation.x = Math.sin(t * 2.4) * 0.03;
        rig.armR.rotation.set(-0.35 + Math.sin(t * 3.1) * 0.1, 0, -0.18);
        rig.forearmR.rotation.x = -0.5;
        break;
      }

      case 'speech': {
        rig.pelvis.position.y = 0.9;
        rig.torso.rotation.x = 0.08;
        rig.head.rotation.y = Math.sin(t * 1.4) * 0.1;
        rig.armL.rotation.set(-0.22, 0, 0.16);
        rig.forearmL.rotation.set(-0.45, 0, -0.15);
        rig.armR.rotation.set(-0.26 + Math.sin(t * 2.6) * 0.08, 0, -0.16);
        rig.forearmR.rotation.set(-0.55, 0, 0.12);
        break;
      }

      case 'grenade_warning': {
        const tremble = Math.sin(t * 42) * 0.05;
        rig.pelvis.position.y = 0.84;
        rig.torso.rotation.x = 0.2;
        rig.head.rotation.x = 0.16;
        rig.armR.rotation.set(-1.15, -0.25, -0.2 + tremble);
        rig.forearmR.rotation.set(-0.85, 0.35, 0);
        rig.armL.rotation.set(-0.75, 0.3, 0.25);
        rig.forearmL.rotation.set(-0.9, -0.3, 0);
        break;
      }

      case 'suicide_draw': {
        const u = clamp(this.suicideElapsed / QUIST_SUICIDE_DRAW);
        rig.pelvis.position.y = 0.92;
        rig.torso.rotation.x = 0.08;
        rig.head.rotation.x = lerp(0, 0.22, u);
        rig.armL.rotation.set(lerp(-0.2, -1.65, u), 0, lerp(0.1, 0.65, u));
        rig.forearmL.rotation.set(lerp(-0.3, -1.55, u), 0, lerp(0, 0.55, u));
        break;
      }

      case 'suicide_temple': {
        const tremble = Math.sin(t * 36) * 0.025;
        rig.pelvis.position.y = 0.92;
        rig.torso.rotation.set(0.12, 0, 0.05);
        rig.head.rotation.set(0.28, 0, 0.08);
        rig.armL.rotation.set(-1.68 + tremble, 0.12, 0.72);
        rig.forearmL.rotation.set(-1.62, 0, 0.62 + tremble);
        rig.armR.rotation.set(0.08, 0, -0.14);
        break;
      }

      case 'captured_escort': {
        // Walking cuffed behind player with hands zip-tied
        const stride = Math.sin(t * 9);
        rig.pelvis.position.y = 0.94;
        rig.torso.rotation.x = 0.06;
        rig.head.rotation.x = 0.12;
        rig.legL.rotation.x = stride * 0.45;
        rig.legR.rotation.x = -stride * 0.45;
        rig.armL.rotation.set(0.42, 0, -0.2);
        rig.forearmL.rotation.set(-0.4, 0, -0.4);
        rig.armR.rotation.set(0.42, 0, 0.2);
        rig.forearmR.rotation.set(-0.4, 0, 0.4);
        break;
      }

      case 'captured': {
        rig.pelvis.position.y = 0.44;
        rig.torso.rotation.x = 0.14;
        rig.head.rotation.x = 0.38;
        rig.legL.rotation.x = -1.45;
        rig.legR.rotation.x = -1.45;
        rig.armL.rotation.set(0.55, 0, -0.22);
        rig.forearmL.rotation.set(-0.4, 0, -0.45);
        rig.armR.rotation.set(0.55, 0, 0.22);
        rig.forearmR.rotation.set(-0.4, 0, 0.45);
        break;
      }

      case 'dead': {
        rig.pelvis.position.set(0, 0.18, -0.35);
        rig.pelvis.rotation.set(-Math.PI * 0.48, 0.18, 0.12);
        rig.armL.rotation.set(-0.4, 0, 0.65);
        rig.armR.rotation.set(-0.2, 0, -0.58);
        rig.legL.rotation.set(0.08, 0, 0.14);
        rig.legR.rotation.set(-0.06, 0, -0.18);
        break;
      }

      default:
        break;
    }
  }

  private showSpeechHud(): void {
    if (!this.quistHud) return;
    const key = this.ctx.input?.labelFor?.('interact') ?? 'E';
    this.quistHud.badge.set('HADREK QUIST // CORNERED');
    this.quistHud.text.set(`[HOLD ${key}] Capture Quist  ·  [TAP ${key}] Talk  ·  or Shoot`);
    this.quistHud.track.style.display = 'none';
    this.quistHud.fill.style.transform = 'scaleX(0)';
    this.quistHud.root.classList.add('on');
  }

  private updateSpeechHudProgress(progress: number): void {
    if (!this.quistHud) return;
    if (progress > 0) {
      this.quistHud.track.style.display = 'block';
      this.quistHud.fill.style.transform = `scaleX(${progress.toFixed(4)})`;
    } else {
      this.quistHud.track.style.display = 'none';
      this.quistHud.fill.style.transform = 'scaleX(0)';
    }
  }

  private showGrenadeWarningHud(): void {
    if (!this.quistHud) return;
    this.quistHud.badge.set('LIVE GRENADE!');
    this.quistHud.text.set('WARNING: GRENADE!');
    this.quistHud.track.style.display = 'none';
    this.quistHud.root.classList.add('on');
  }

  private hideQuistHud(): void {
    if (!this.quistHud) return;
    this.quistHud.root.classList.remove('on');
    this.quistHud.track.style.display = 'none';
  }

  // -----------------------------------------------------------------------------------------------
  // Frame Update, Clear & Reset
  // -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.built || dt <= 0) return;
    this.updateLoudspeakers(dt);
    this.updateGateDebris(dt);
    this.updateWaterTower(dt);
    this.updateQuist(dt);
  }

  clear(): void {
    this.clearGateDebris();
    this.gateSmokeTimer = 0;
    this.removeMainGateCollider();
    this.removeTowerLegColliders();
    this.removeStreetRubbleColliders();
    this.removeQuistCollider();
    this.retireQuistEnemy();
    this.sewerUnmark?.();
    this.sewerUnmark = null;
    this.quistUnmark?.();
    this.quistUnmark = null;
    this.hideQuistHud();
    this.ctx.hud?.hold?.(0);

    for (const ring of this.waveRings) {
      ring.active = false;
      ring.mesh.visible = false;
    }
    if (this.floodWaveGroup) this.floodWaveGroup.visible = false;
    if (this.sewerBeaconGroup) this.sewerBeaconGroup.visible = false;
    if (this.sewerFlareLight) this.sewerFlareLight.intensity = 0;
    if (this.quistRig) this.quistRig.root.visible = false;

    this.floodActive = false;
    this.sewerBeaconOn = false;
    this.sewerBeaconSuppressed = false;
    this.towerArmed = false;
    this.towerCollapsing = false;
    this._quistState = 'inactive';
    this.lastAllowedDamageType = 'bullet';
    this.quistHooks = null;
    this.detachWorldHooks();
  }

  reset(): void {
    this.clearGateDebris();
    this.gateSmokeTimer = 0;
    this._gateRicochetCount = 0;
    this.gateBreached = false;

    this.towerDropped = false;
    this.towerArmed = false;
    this.towerCollapsing = false;
    this.towerImpacted = false;
    this.towerFallElapsed = 0;
    this.towerCreakPlayed = false;

    this.floodActive = false;
    this.floodElapsed = 0;
    this.floodKnockedPlayer = false;
    this.floodKnockedEnemies.clear();
    if (this.floodWaveGroup) this.floodWaveGroup.visible = false;

    this.sewerBeaconOn = false;
    this.sewerBeaconSuppressed = false;
    if (this.sewerBeaconGroup) this.sewerBeaconGroup.visible = false;
    if (this.sewerFlareLight) this.sewerFlareLight.intensity = 0;
    this.sewerUnmark?.();
    this.sewerUnmark = null;

    this.removeStreetRubbleColliders();
    if (this.towerRubbleGroup) this.towerRubbleGroup.visible = false;
    if (this.towerPivot) this.towerPivot.rotation.set(0, 0, 0);

    for (const pole of this.poles) {
      pole.pulseTimer = 0;
      pole.beaconMesh.scale.setScalar(1);
    }
    for (const ring of this.waveRings) {
      ring.active = false;
      ring.mesh.visible = false;
      ring.mat.opacity = 0;
    }
    this._lastPulsedPoleIndex = -1;

    this.quistOutcome = null;
    this._quistState = 'inactive';
    this.lastAllowedDamageType = 'bullet';
    this.quistHooks = null;
    this.quistDoor1Slammed = false;
    this.quistDoor2Slammed = false;
    this._speechElapsed = 0;
    this.nextSpeechBeat = 0;
    this.quistReplyIndex = 0;
    this.interactHeld = false;
    this.interactHoldTime = 0;
    this.captureHoldTime = 0;
    this.grenadeElapsed = 0;
    this.suicideElapsed = 0;
    this.removeQuistCollider();
    this.retireQuistEnemy();
    this.quistUnmark?.();
    this.quistUnmark = null;
    this.hideQuistHud();
    this.ctx.hud?.hold?.(0);
    if (this.quistRig) {
      this.quistRig.root.visible = false;
      this.quistRig.pistolInHand.visible = false;
      this.quistRig.pistolHolstered.visible = true;
      this.quistRig.grenadeInHand.visible = false;
      this.quistRig.redGlint.visible = false;
      this.quistRig.zipTie.visible = false;
    }

    if (this.built) {
      if (this.gateGroup) this.gateGroup.visible = true;
      this.createMainGateCollider();
      this.createTowerLegColliders();
      this.attachWorldHooks();
    }
  }
}
