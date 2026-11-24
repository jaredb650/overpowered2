/**
 * Dogfight Physical Wreckage Breakup, Ejected Pilot Fates (Parachute / Burning / Mangled / Gibbed),
 * and Real 3D Falling Bomber Ordnance (`DogfightWreckageSystem`).
 *
 * Replaces single-mesh falling planes with explosive multi-piece aircraft shatter, authentic
 * GoreSystem pilot ragdolls/dismemberment/gibs, shootable unarmed parachuting pilots (reusing
 * the procedural canopy pattern from `rooftop/paratroopers.ts`), and real gravity-driven
 * Mk-84 / Mk-82 / parachute-retarded bombs dropped by B-1 Lancers and A-10 Warthogs.
 */
import * as THREE from 'three';
import { HumanoidBone, type GoreRegion } from '../../characters/rig';
import type { CharacterInstance, Ctx, DamageInfo, EmitterHandle } from '../../core/contracts';
import { clamp, rand } from '../../core/math';
import { CARRIER_DECK_RECT, CARRIER_DECK_Y } from '../../world/map/dogfight/plan';
import type { Enemy } from '../Enemy';
import type { EnemyManager } from '../EnemyManager';
import type { AiJetKind } from './aiJet';

export type PilotFate = 'eject_chute' | 'burning_ragdoll' | 'mangled_ragdoll' | 'gibbed';
export type BombKind = 'mk84' | 'para' | 'mk82' | 'cluster';

export interface WreckageCallbacks {
  onBombHitCarrier(hitPt: THREE.Vector3, damage: number, attackerName: string, heavy: boolean): void;
}

const GRAVITY = 26;
const EJECT_BOOST_SECONDS = 0.55;
const CHUTE_DESCENT_SPEED = 5.6;
const CANOPY_COLLAPSE_SECONDS = 1.45;
const MAX_WRECK_CHUNKS = 56;
const MAX_BOMBS = 40;
const SEVERABLE_LIMBS: readonly GoreRegion[] = ['armL', 'armR', 'legL', 'legR', 'head'];

const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

interface WreckChunk {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  burning: boolean;
  smokeCd: number;
  bounced: boolean;
  emitter: EmitterHandle | null;
}

interface ActiveEjectedPilot {
  enemy: Enemy;
  canopy: THREE.Group;
  canopyOpen: boolean;
  ejectTimer: number;
  vel: THREE.Vector3;
  phase: number;
  age: number;
  unmark: (() => void) | null;
  markerPos: THREE.Vector3;
}

interface FallingCanopy {
  canopy: THREE.Group;
  vel: THREE.Vector3;
  age: number;
  duration: number;
}

interface FallingBomb {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  kind: BombKind;
  damage: number;
  attackerName: string;
  life: number;
  smokeCd: number;
}

/** Weighted randomized fate for a splashed enemy pilot (deterministic when `roll` is supplied). */
export function choosePilotFate(kind: AiJetKind, heavyKill: boolean, roll = Math.random()): PilotFate {
  // Fighters/aces punch out a bit more often; heavy missile/flak overkills lean harder toward gibbing!
  const ejectCutoff = heavyKill ? 0.28 : (kind === 'raptor' || kind === 'hornet' ? 0.44 : 0.36);
  if (roll < ejectCutoff) return 'eject_chute';

  const rem = (roll - ejectCutoff) / Math.max(0.01, 1 - ejectCutoff);
  if (heavyKill) {
    if (rem < 0.44) return 'gibbed';
    if (rem < 0.74) return 'burning_ragdoll';
    return 'mangled_ragdoll';
  }
  if (rem < 0.38) return 'burning_ragdoll';
  if (rem < 0.74) return 'mangled_ragdoll';
  return 'gibbed';
}

function hidePilotWeapon(char: CharacterInstance): void {
  const handR = char.bones?.[HumanoidBone.handR];
  if (!handR) return;
  for (const name of ['smg', 'shotgun', 'minigun', 'sniperRifle', 'flamer']) {
    const obj = handR.getObjectByName(name);
    if (obj) obj.visible = false;
  }
}

function isOverCarrierDeck(p: THREE.Vector3, pad = 4.5): boolean {
  return (
    p.x >= CARRIER_DECK_RECT.x0 - pad &&
    p.x <= CARRIER_DECK_RECT.x1 + pad &&
    p.z >= CARRIER_DECK_RECT.z0 - pad &&
    p.z <= CARRIER_DECK_RECT.z1 + pad
  );
}

/** Jet-proportional part sizes so each shattered aircraft blows into recognizable chunks! */
export function jetPartProfile(kind: AiJetKind): {
  hullLen: number;
  hullW: number;
  wingSpan: number;
  wingChord: number;
  tailH: number;
  color: number;
  chunkScale: number;
} {
  switch (kind) {
    case 'lancer':
      // Massive strategic bomber (~1.8x larger than original placeholder dimensions!)
      return { hullLen: 13.4, hullW: 3.3, wingSpan: 15.5, wingChord: 4.3, tailH: 5.5, color: 0x3b4047, chunkScale: 1.8 };
    case 'warthog':
      return { hullLen: 5.2, hullW: 1.55, wingSpan: 6.4, wingChord: 1.9, tailH: 2.1, color: 0x4b535a, chunkScale: 1 };
    case 'raptor':
      return { hullLen: 5.8, hullW: 1.75, wingSpan: 5.4, wingChord: 2.8, tailH: 2.2, color: 0x363d46, chunkScale: 1 };
    case 'harrier':
      return { hullLen: 4.8, hullW: 1.45, wingSpan: 4.5, wingChord: 1.7, tailH: 2.0, color: 0x454d55, chunkScale: 1 };
    case 'hornet':
    default:
      return { hullLen: 5.4, hullW: 1.6, wingSpan: 5.2, wingChord: 2.1, tailH: 2.2, color: 0x4a525c, chunkScale: 1 };
  }
}

export class DogfightWreckageSystem {
  private readonly chunks: WreckChunk[] = [];
  private readonly pilots: ActiveEjectedPilot[] = [];
  private readonly collapsedCanopies: FallingCanopy[] = [];
  private readonly bombs: FallingBomb[] = [];

  /** Telemetry counters useful for HUD/testing. */
  shatteredJets = 0;
  ejectedPilotsSpawned = 0;
  ejectedPilotsShot = 0;
  ragdollPilotsSpawned = 0;
  gibbedPilotsSpawned = 0;
  bombsDropped = 0;

  // Shared procedural meshes & materials
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly noseConeGeo = new THREE.ConeGeometry(0.75, 2.6, 6);
  private readonly domeGeo = new THREE.SphereGeometry(2.0, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  private readonly dragChuteGeo = new THREE.SphereGeometry(0.95, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52);
  private readonly shroudGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 4, 1, true);
  private readonly bombBodyGeo = new THREE.CylinderGeometry(0.24, 0.3, 2.3, 8);
  private readonly bombNoseGeo = new THREE.ConeGeometry(0.24, 0.65, 8);

  private readonly charMetalMat = new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.88, metalness: 0.35 });
  private readonly hotEdgeMat = new THREE.MeshBasicMaterial({ color: 0xff6b24 });
  private readonly seatMat = new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.75, metalness: 0.4 });
  private readonly canopyOrangeMat = new THREE.MeshStandardMaterial({
    color: 0xff6e1a,
    roughness: 0.78,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  private readonly canopyStripeMat = new THREE.MeshStandardMaterial({
    color: 0xf4f6f8,
    roughness: 0.82,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  private readonly shroudMat = new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.9 });
  private readonly bombMat = new THREE.MeshStandardMaterial({ color: 0x3b4432, roughness: 0.65, metalness: 0.4 });
  private readonly bombYellowBandMat = new THREE.MeshBasicMaterial({ color: 0xf4c430 });
  private readonly hullMats = new Map<AiJetKind, THREE.MeshStandardMaterial>();

  constructor(
    private readonly ctx: Ctx,
    private readonly manager: EnemyManager,
    private readonly cb: WreckageCallbacks,
    private readonly surfaceMode: 'ocean' | 'desert' = 'ocean',
  ) {
    this.noseConeGeo.rotateX(Math.PI / 2);
    this.bombBodyGeo.rotateX(Math.PI / 2);
    this.bombNoseGeo.rotateX(Math.PI / 2);
  }

  private getHullMat(kind: AiJetKind, color: number): THREE.MeshStandardMaterial {
    let mat = this.hullMats.get(kind);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.42 });
      this.hullMats.set(kind, mat);
    }
    return mat;
  }

  get activeChunkCount(): number {
    return this.chunks.length;
  }

  get activePilotCount(): number {
    return this.pilots.length;
  }

  get activeBombCount(): number {
    return this.bombs.length;
  }

  // -------------------------------------------------------------------------------------------
  // 1. Multi-Piece Explosive Jet Shatter
  // -------------------------------------------------------------------------------------------

  /** Blows a destroyed jet into 7 tumbling physical wreckage chunks with fire & smoke trails! */
  shatterJet(
    kind: AiJetKind,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    yaw: number,
    pitch: number,
    roll: number,
  ): void {
    this.shatteredJets++;
    const prof = jetPartProfile(kind);
    const hullMat = this.getHullMat(kind, prof.color);
    const baseQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));

    const cs = prof.chunkScale;
    const specs: Array<{
      offset: [number, number, number];
      scale: [number, number, number];
      burst: [number, number, number];
      burning: boolean;
      isNose?: boolean;
    }> = [
      // 1. Flaming Center Fuselage Core
      { offset: [0, 0, -0.5 * cs], scale: [prof.hullW, 1.25 * cs, prof.hullLen * 0.62], burst: [rand(-5, 5), rand(2, 7), rand(-5, 5)], burning: true },
      // 2. Torn Left Wing
      { offset: [-prof.wingSpan * 0.45, 0, -0.4 * cs], scale: [prof.wingSpan * 0.68, 0.24 * cs, prof.wingChord], burst: [-rand(14, 24), rand(4, 12), rand(-6, 6)], burning: true },
      // 3. Torn Right Wing
      { offset: [prof.wingSpan * 0.45, 0, -0.4 * cs], scale: [prof.wingSpan * 0.68, 0.24 * cs, prof.wingChord], burst: [rand(14, 24), rand(4, 12), rand(-6, 6)], burning: false },
      // 4. Blown-off Vertical Tail / Stabilizer
      { offset: [0, prof.tailH * 0.45, -prof.hullLen * 0.55], scale: [0.3 * cs, prof.tailH, 1.9 * cs], burst: [rand(-8, 8), rand(10, 19), -rand(10, 18)], burning: false },
      // 5. Shattered Nose / Cockpit Section
      { offset: [0, 0.1 * cs, prof.hullLen * 0.52], scale: [1.1 * cs, 1.0 * cs, 1.2 * cs], burst: [rand(-6, 6), rand(7, 15), rand(10, 19)], burning: false, isNose: true },
      // 6. Left Engine Nacelle / Armor Chunk
      { offset: [-1.1 * cs, -0.3 * cs, -1.6 * cs], scale: [0.85 * cs, 0.75 * cs, 2.2 * cs], burst: [-rand(9, 17), -rand(2, 7), -rand(6, 14)], burning: true },
      // 7. Jagged Hull Plate Shard
      { offset: [1.0 * cs, 0.4 * cs, 0.6 * cs], scale: [1.3 * cs, 0.18 * cs, 2.1 * cs], burst: [rand(10, 20), rand(8, 18), rand(-8, 8)], burning: false },
    ];

    for (const s of specs) {
      if (this.chunks.length >= MAX_WRECK_CHUNKS) {
        const old = this.chunks.shift()!;
        this.disposeChunk(old);
      }

      const grp = new THREE.Group();
      const bodyMesh = new THREE.Mesh(s.isNose ? this.noseConeGeo : this.unitBox, s.burning ? this.charMetalMat : hullMat);
      bodyMesh.scale.set(s.scale[0], s.scale[1], s.scale[2]);
      grp.add(bodyMesh);

      // Glowing molten break seam along one edge so shattered pieces read vividly against the sky!
      if (s.burning) {
        const ember = new THREE.Mesh(this.unitBox, this.hotEdgeMat);
        ember.scale.set(s.scale[0] * 0.65, Math.max(0.18, s.scale[1] * 0.55), s.scale[2] * 0.45);
        grp.add(ember);
      }

      _v.set(s.offset[0], s.offset[1], s.offset[2]).applyQuaternion(baseQuat).add(pos);
      grp.position.copy(_v);
      grp.quaternion.copy(baseQuat);
      this.ctx.render?.scene?.add(grp);

      _v2.set(s.burst[0], s.burst[1], s.burst[2]).applyQuaternion(baseQuat).add(vel);
      const emitter = s.burning
        ? (this.ctx.fx?.attachEmitter?.(grp, 'burning', new THREE.Vector3(0, 0.2, 0), 7.0) ?? null)
        : null;

      this.chunks.push({
        mesh: grp,
        vel: _v2.clone(),
        spin: new THREE.Vector3(rand(-6.5, 6.5), rand(-5.5, 5.5), rand(-7.5, 7.5)),
        life: rand(6.0, 8.5),
        burning: s.burning,
        smokeCd: rand(0, 0.08),
        bounced: false,
        emitter,
      });
    }

    // Immediate dramatic multi-burst fireball + shrapnel sparks at breakup center!
    this.ctx.fx?.explosion?.(pos, { radius: kind === 'lancer' ? 20 : 13, scale: kind === 'lancer' ? 3.2 : 1.75 });
    this.ctx.fx?.sparks?.(pos, _up, kind === 'lancer' ? 42 : 28, 0xffaa33);
    this.ctx.audio?.play?.('veh_destroyed', { position: pos, volume: 1.0, pitch: rand(0.94, 1.08) });
    this.ctx.audio?.play?.('explosion_tank', { position: pos, volume: 0.55, pitch: rand(0.92, 1.12) });
  }

  // -------------------------------------------------------------------------------------------
  // 2. Pilot Fate on Jet Kill (Eject + Parachute / Burning Ragdoll / Mangled / Gibbed!)
  // -------------------------------------------------------------------------------------------

  /** Spawns the pilot out of the exploding cockpit with randomized survival or gore trauma! */
  spawnPilotFate(
    kind: AiJetKind,
    cockpitPos: THREE.Vector3,
    jetVel: THREE.Vector3,
    source: string,
    heavyKill: boolean,
    forcedFate?: PilotFate,
  ): PilotFate {
    const fate = forcedFate ?? choosePilotFate(kind, heavyKill);

    if (fate === 'eject_chute') {
      const ok = this.spawnEjectedParachuter(cockpitPos, jetVel);
      if (ok) return 'eject_chute';
      // Fallback to burning ragdoll if enemy cap reached or spawn unavailable.
      this.spawnDeadPilotGore('burning_ragdoll', cockpitPos, jetVel, source);
      return 'burning_ragdoll';
    }

    this.spawnDeadPilotGore(fate, cockpitPos, jetVel, source);
    return fate;
  }

  private spawnEjectedParachuter(cockpitPos: THREE.Vector3, jetVel: THREE.Vector3): boolean {
    if (!this.manager?.spawn) return false;
    const startPos = cockpitPos.clone().add(new THREE.Vector3(0, 2.2, 0));
    const enemy = this.manager.spawn('trooper', startPos);
    if (!enemy) return false;

    // Configure as 100% unarmed, non-attacking ejected pilot dangling from a chute!
    enemy.scriptedNpc = true;
    enemy.pinned = true;
    enemy.mode = 'hold';
    enemy.face = 'move';
    enemy.attacks = [];
    enemy.behaviours = [];
    enemy.maxHealth = 45;
    enemy.health = 45;
    enemy.score = 150;
    enemy.position.copy(startPos);
    enemy.groundY = 0;
    enemy.velocity.set(0, 0, 0);
    hidePilotWeapon(enemy.char);

    // Spawn tumbling ejection seat rocket chunk & bright rocket flare!
    this.spawnEjectionSeatDebris(cockpitPos, jetVel);
    this.ctx.fx?.sparks?.(startPos, _up, 20, 0xffd27a);
    this.ctx.audio?.play?.('veh_flare_pop', { position: startPos, volume: 0.72, pitch: 0.92 });

    // Pre-build high-vis orange/white rescue parachute (hidden during the 0.55 s seat rocket pop!).
    const canopy = this.buildRescueCanopy();
    canopy.visible = false;
    canopy.position.copy(startPos);
    this.ctx.render?.scene?.add(canopy);

    const markerPos = startPos.clone();
    const unmark = this.ctx.hud?.follow?.(markerPos, 'EJECTED PILOT', '#ffaa33') ?? null;

    // Inherit partial horizontal jet momentum + crisp +23 m/s upward ejection-seat impulse!
    const initVel = new THREE.Vector3(
      jetVel.x * 0.35 + rand(-5, 5),
      23,
      jetVel.z * 0.35 + rand(-5, 5),
    );

    this.pilots.push({
      enemy,
      canopy,
      canopyOpen: false,
      ejectTimer: EJECT_BOOST_SECONDS,
      vel: initVel,
      phase: rand(0, Math.PI * 2),
      age: 0,
      unmark,
      markerPos,
    });
    this.ejectedPilotsSpawned++;
    this.ctx.hud?.feed?.('BANDIT PILOT EJECTED — CHUTE DEPLOYING!', '#ffaa33');
    return true;
  }

  private spawnEjectionSeatDebris(pos: THREE.Vector3, vel: THREE.Vector3): void {
    const seat = new THREE.Group();
    const back = new THREE.Mesh(this.unitBox, this.seatMat);
    back.scale.set(0.75, 1.35, 0.3);
    seat.add(back);
    const pan = new THREE.Mesh(this.unitBox, this.seatMat);
    pan.scale.set(0.75, 0.25, 0.75);
    pan.position.set(0, -0.55, 0.25);
    seat.add(pan);
    seat.position.copy(pos);
    this.ctx.render?.scene?.add(seat);

    this.chunks.push({
      mesh: seat,
      vel: new THREE.Vector3(vel.x * 0.4 + rand(-8, 8), 16, vel.z * 0.4 + rand(-8, 8)),
      spin: new THREE.Vector3(rand(-8, 8), rand(-6, 6), rand(-8, 8)),
      life: 5.5,
      burning: false,
      smokeCd: 0,
      bounced: false,
      emitter: null,
    });
  }

  private spawnDeadPilotGore(
    fate: Exclude<PilotFate, 'eject_chute'>,
    cockpitPos: THREE.Vector3,
    jetVel: THREE.Vector3,
    source: string,
  ): void {
    const gore = this.ctx.gore;
    const chars = this.ctx.characters;
    if (!gore || !chars) {
      if (fate === 'gibbed') this.gibbedPilotsSpawned++;
      else this.ragdollPilotsSpawned++;
      return;
    }

    const char = chars.spawn('trooper');
    const spawnPos = cockpitPos.clone().add(new THREE.Vector3(0, 1.4, 0));
    char.root.position.copy(spawnPos);
    char.root.rotation.set(rand(-0.5, 0.5), rand(0, Math.PI * 2), rand(-0.5, 0.5));
    char.root.updateMatrixWorld(true);
    this.ctx.render?.scene?.add(char.root);
    hidePilotWeapon(char);

    const blastDir = new THREE.Vector3(rand(-0.6, 0.6), rand(0.55, 1.15), rand(-0.6, 0.6)).normalize();
    const pilotVel = new THREE.Vector3(
      jetVel.x * 0.48 + blastDir.x * rand(14, 24),
      Math.max(8, jetVel.y * 0.4 + blastDir.y * rand(14, 24)),
      jetVel.z * 0.48 + blastDir.z * rand(14, 24),
    );

    const dmg: DamageInfo = {
      amount: 260,
      type: 'explosive',
      point: spawnPos.clone(),
      dir: blastDir.clone(),
      force: 195,
      source,
      blastKind: 'rocket',
      reach: 0.25,
    };

    if (fate === 'gibbed') {
      this.gibbedPilotsSpawned++;
      if (Math.random() < 0.45) {
        char.setBurn?.(0.5);
        gore.burnOn?.(char);
      }
      gore.gib(char, spawnPos, 210, dmg);
      return;
    }

    const blastImpulse = blastDir.clone().multiplyScalar(28);
    const ragdollOpts = {
      velocity: pilotVel,
      impulses: [{ bone: HumanoidBone.chest, point: spawnPos.clone(), impulse: blastImpulse }],
    };

    this.ragdollPilotsSpawned++;
    if (fate === 'burning_ragdoll') {
      char.setBurn?.(0.65);
      char.setBloodiness?.(0.45);
      gore.burnOn?.(char);
      gore.ragdoll(char, ragdollOpts);
      return;
    }

    // `'mangled_ragdoll'`: sever 1-2 random limbs mid-air (with flying limbs + blood spray!) then launch ragdoll!
    char.setBloodiness?.(0.85);
    const limbCount = Math.random() < 0.55 ? 2 : 1;
    const pool = [...SEVERABLE_LIMBS];
    for (let i = 0; i < limbCount && pool.length > 0; i++) {
      const pickIdx = Math.floor(Math.random() * pool.length);
      const region = pool.splice(pickIdx, 1)[0]!;
      gore.sever(char, region, dmg, pilotVel);
    }
    if (Math.random() < 0.4) {
      char.setBurn?.(0.45);
      gore.burnOn?.(char);
    }
    gore.ragdoll(char, ragdollOpts);
  }

  private buildRescueCanopy(): THREE.Group {
    const group = new THREE.Group();

    // High-vis international rescue orange dome + crisp white signal cap so pilots stand out in the sky!
    const dome = new THREE.Mesh(this.domeGeo, this.canopyOrangeMat);
    dome.position.set(0, 3.4, 0);
    group.add(dome);

    const cap = new THREE.Mesh(this.domeGeo, this.canopyStripeMat);
    cap.position.set(0, 3.46, 0);
    cap.scale.set(0.62, 0.62, 0.62);
    group.add(cap);

    // Four shroud lines linking the dome rim down to the pilot's harness.
    const rimY = 3.45;
    const harnessY = 1.45;
    const rimR = 1.85;
    const bot = new THREE.Vector3(0, harnessY, 0);
    const top = new THREE.Vector3();
    const diff = new THREE.Vector3();
    for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
      top.set(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR);
      diff.subVectors(top, bot);
      const len = diff.length();
      const line = new THREE.Mesh(this.shroudGeo, this.shroudMat);
      line.position.copy(bot).addScaledVector(diff, 0.5);
      line.scale.set(1, len, 1);
      line.quaternion.setFromUnitVectors(_up, diff.normalize());
      group.add(line);
    }
    return group;
  }

  // -------------------------------------------------------------------------------------------
  // 3. Real 3D Falling Heavy / Parachute-Retarded Bombs (Lancer & Warthog!)
  // -------------------------------------------------------------------------------------------

  /** Releases a real 3D gravity-driven bomb from an enemy bomber/attacker belly! */
  spawnBomb(
    from: THREE.Vector3,
    initVel: THREE.Vector3,
    kind: BombKind,
    damage: number,
    attackerName: string,
  ): void {
    this.bombsDropped++;
    if (this.bombs.length >= MAX_BOMBS) {
      const old = this.bombs.shift()!;
      this.ctx.render?.scene?.remove(old.mesh);
    }

    const grp = new THREE.Group();
    const scale = kind === 'mk84' || kind === 'para' ? 1.28 : 0.92;
    const body = new THREE.Mesh(this.bombBodyGeo, this.bombMat);
    body.scale.setScalar(scale);
    grp.add(body);

    const nose = new THREE.Mesh(this.bombNoseGeo, this.bombMat);
    nose.scale.setScalar(scale);
    nose.position.z = 1.45 * scale;
    grp.add(nose);

    const band = new THREE.Mesh(this.unitBox, this.bombYellowBandMat);
    band.scale.set(0.56 * scale, 0.56 * scale, 0.24 * scale);
    band.position.z = 0.75 * scale;
    grp.add(band);

    // Cruciform tail fins
    const finH = new THREE.Mesh(this.unitBox, this.bombMat);
    finH.scale.set(1.1 * scale, 0.08 * scale, 0.7 * scale);
    finH.position.z = -1.05 * scale;
    grp.add(finH);
    const finV = new THREE.Mesh(this.unitBox, this.bombMat);
    finV.scale.set(0.08 * scale, 1.1 * scale, 0.7 * scale);
    finV.position.z = -1.05 * scale;
    grp.add(finV);

    // Parachute-retarded bomb: visible white/orange drag canopy trailing behind the tail fins!
    if (kind === 'para') {
      const dragChute = new THREE.Mesh(this.dragChuteGeo, this.canopyStripeMat);
      dragChute.rotation.x = Math.PI / 2;
      dragChute.position.z = -2.6 * scale;
      grp.add(dragChute);
    }

    grp.position.copy(from);
    _v.copy(initVel).normalize();
    if (_v.lengthSq() > 0.01) {
      _quat.setFromUnitVectors(_zAxis, _v);
      grp.quaternion.copy(_quat);
    }
    this.ctx.render?.scene?.add(grp);

    this.bombs.push({
      mesh: grp,
      pos: from.clone(),
      vel: initVel.clone(),
      kind,
      damage,
      attackerName,
      life: 12.0,
      smokeCd: 0,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Per-Frame Simulation Update
  // -------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (dt <= 0) return;
    this.updateChunks(dt);
    this.updatePilots(dt);
    this.updateCollapsedCanopies(dt);
    this.updateBombs(dt);
  }

  private updateChunks(dt: number): void {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i]!;
      c.life -= dt;
      c.vel.y -= GRAVITY * dt;
      const drag = Math.exp(-0.28 * dt);
      c.vel.x *= drag;
      c.vel.z *= drag;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;

      if (c.burning) {
        c.smokeCd -= dt;
        if (c.smokeCd <= 0) {
          c.smokeCd = 0.065;
          this.ctx.fx?.sparks?.(c.mesh.position, _up, 3, 0xff7722);
        }
      }

      // Bounce once with sparks if a wreckage chunk slams onto USS Sovereign's steel deck (ocean mode) or desert floor!
      if (this.surfaceMode === 'ocean') {
        if (!c.bounced && c.vel.y < 0 && c.mesh.position.y <= CARRIER_DECK_Y + 0.5 && isOverCarrierDeck(c.mesh.position, 0)) {
          c.bounced = true;
          c.mesh.position.y = CARRIER_DECK_Y + 0.5;
          c.vel.y = Math.abs(c.vel.y) * 0.28;
          c.vel.x *= 0.55;
          c.vel.z *= 0.55;
          this.ctx.fx?.sparks?.(c.mesh.position, _up, 12, 0xffaa33);
          this.ctx.audio?.play?.('metal_clang', { position: c.mesh.position, volume: 0.45, pitch: rand(0.75, 1.05) });
        }
      } else if (!c.bounced && c.vel.y < 0 && c.mesh.position.y <= 0.45) {
        c.bounced = true;
        c.mesh.position.y = 0.45;
        c.vel.y = Math.abs(c.vel.y) * 0.3;
        c.vel.x *= 0.55;
        c.vel.z *= 0.55;
        this.ctx.fx?.sparks?.(c.mesh.position, _up, 12, c.burning ? 0xff8822 : 0xd8be94);
        this.ctx.audio?.play?.('metal_clang', { position: c.mesh.position, volume: 0.45, pitch: rand(0.75, 1.05) });
        if (c.burning) {
          this.ctx.fx?.explosion?.(c.mesh.position, { radius: 6, scale: 1.0 });
        }
        continue;
      }

      // Ocean splashdown / desert final rest or lifetime expired!
      if (c.mesh.position.y <= 0.35 || c.life <= 0) {
        if (c.mesh.position.y <= 0.35) {
          c.mesh.position.y = 0.35;
          this.ctx.fx?.sparks?.(c.mesh.position, _up, c.burning ? 14 : 8, this.surfaceMode === 'desert' ? 0xd8be94 : 0xd8f0ff);
          if (c.burning) {
            this.ctx.fx?.explosion?.(c.mesh.position, { radius: 6, scale: 0.9 });
          }
        }
        this.disposeChunk(c);
        this.chunks.splice(i, 1);
      }
    }
  }

  private updatePilots(dt: number): void {
    for (let i = this.pilots.length - 1; i >= 0; i--) {
      const p = this.pilots[i]!;
      const e = p.enemy;
      p.age += dt;

      // Shot out of the sky by the player (or carrier / blast)!
      if (!e.alive) {
        e.pinned = false;
        e.scriptedNpc = false;
        p.unmark?.();
        p.unmark = null;
        this.ejectedPilotsShot++;
        if (p.canopyOpen) {
          this.detachCanopy(p.canopy, CANOPY_COLLAPSE_SECONDS);
        } else {
          p.canopy.removeFromParent();
        }
        this.ctx.progression?.award?.(150, 'EJECTED PILOT SPLASHED', e.position);
        this.pilots.splice(i, 1);
        continue;
      }

      if (!p.canopyOpen) {
        // Phase 1: Ejection-seat rocket arc upward out of the fireball!
        p.ejectTimer -= dt;
        p.vel.y -= GRAVITY * 0.72 * dt;
        e.position.addScaledVector(p.vel, dt);
        if (Math.random() < dt * 18) {
          this.ctx.fx?.sparks?.(e.position, _up, 2, 0xffd27a);
        }
        if (p.ejectTimer <= 0 || p.vel.y <= 1) {
          p.canopyOpen = true;
          p.canopy.visible = true;
          p.vel.multiplyScalar(0.18);
          this.ctx.fx?.sparks?.(e.position.clone().add(new THREE.Vector3(0, 3.2, 0)), _up, 8, 0xffffff);
        }
      } else {
        // Phase 2: Slow, shootable descent under open high-vis rescue parachute!
        p.vel.x *= Math.exp(-1.8 * dt);
        p.vel.z *= Math.exp(-1.8 * dt);
        const swayX = Math.sin(p.age * 1.9 + p.phase) * 1.4;
        const swayZ = Math.cos(p.age * 1.5 + p.phase) * 1.4;
        e.position.x += (p.vel.x + swayX * 0.45) * dt;
        e.position.z += (p.vel.z + swayZ * 0.45) * dt;
        e.position.y -= CHUTE_DESCENT_SPEED * dt;

        p.canopy.position.copy(e.position);
        p.canopy.rotation.z = Math.sin(p.age * 1.9 + p.phase) * 0.16;
        p.canopy.rotation.x = Math.cos(p.age * 1.5 + p.phase) * 0.13;
      }

      e.groundY = 0;
      p.markerPos.set(e.position.x, e.position.y + 4.8, e.position.z);

      // Touched down in the sea or desert floor — despawn cleanly so they never block wave progression!
      if (e.position.y <= 0.8 || p.age > 35) {
        this.ctx.fx?.sparks?.(new THREE.Vector3(e.position.x, 0.5, e.position.z), _up, 12, this.surfaceMode === 'desert' ? 0xd8be94 : 0xd8f0ff);
        p.unmark?.();
        p.unmark = null;
        if (p.canopyOpen) {
          this.detachCanopy(p.canopy, 0.75);
        } else {
          p.canopy.removeFromParent();
        }
        this.manager.despawn?.(e);
        this.pilots.splice(i, 1);
      }
    }
  }

  private detachCanopy(canopy: THREE.Group, duration: number): void {
    this.collapsedCanopies.push({
      canopy,
      vel: new THREE.Vector3(rand(-2.2, 2.2), -2.8, rand(-2.2, 2.2)),
      age: 0,
      duration,
    });
  }

  private updateCollapsedCanopies(dt: number): void {
    for (let i = this.collapsedCanopies.length - 1; i >= 0; i--) {
      const f = this.collapsedCanopies[i]!;
      f.age += dt;
      const t = clamp(f.age / f.duration, 0, 1);
      f.canopy.position.addScaledVector(f.vel, dt);
      f.canopy.rotation.z += 1.6 * dt;
      const s = Math.max(0.05, 1 - t * 0.92);
      f.canopy.scale.set(s, Math.max(0.05, 1 - t * 0.85), s);
      if (f.age >= f.duration) {
        f.canopy.removeFromParent();
        this.collapsedCanopies.splice(i, 1);
      }
    }
  }

  private updateBombs(dt: number): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]!;
      b.life -= dt;

      if (b.kind === 'para') {
        // Parachute-retarded bomb slows horizontal speed & stabilizes at steady terminal fall!
        b.vel.x *= Math.exp(-1.4 * dt);
        b.vel.z *= Math.exp(-1.4 * dt);
        b.vel.y = Math.max(-17.5, b.vel.y - GRAVITY * 0.75 * dt);
      } else {
        b.vel.y -= GRAVITY * dt;
      }

      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);

      const spdSq = b.vel.lengthSq();
      if (spdSq > 0.25) {
        _v.copy(b.vel).normalize();
        _quat.setFromUnitVectors(_zAxis, _v);
        b.mesh.quaternion.copy(_quat);
      }

      b.smokeCd -= dt;
      if (b.smokeCd <= 0) {
        b.smokeCd = 0.06;
        this.ctx.fx?.sparks?.(b.pos, _up, 2, b.kind === 'para' ? 0xdde6ee : 0x8a9099);
      }

      if (this.surfaceMode === 'desert') {
        const hitGround = b.pos.y <= 0.45;
        if (hitGround || b.life <= 0) {
          if (hitGround) {
            const hitPt = b.pos.clone().setY(0.5);
            const heavy = b.kind === 'mk84' || b.kind === 'para';
            this.ctx.fx?.explosion?.(hitPt, { radius: heavy ? 16 : 11, scale: heavy ? 2.4 : 1.6 });
            this.ctx.audio?.play?.(heavy ? 'explosion_tank' : 'explosion_barrel', {
              position: hitPt,
              volume: 0.95,
              pitch: rand(0.8, 1.0),
            });
            this.cb.onBombHitCarrier(hitPt, b.damage, b.attackerName, heavy);
          }
          this.ctx.render?.scene?.remove(b.mesh);
          this.bombs.splice(i, 1);
        }
        continue;
      }

      // 1. Check physical impact onto USS Sovereign's flight deck!
      const onDeck = isOverCarrierDeck(b.pos, 5.5) && b.pos.y <= CARRIER_DECK_Y + 0.9;
      const hitSea = b.pos.y <= 0.35;

      if (onDeck) {
        const hitPt = b.pos.clone().setY(CARRIER_DECK_Y + 0.6);
        const heavy = b.kind === 'mk84' || b.kind === 'para';
        this.ctx.fx?.explosion?.(hitPt, { radius: heavy ? 16 : 11, scale: heavy ? 2.4 : 1.6 });
        this.ctx.audio?.play?.(heavy ? 'explosion_tank' : 'explosion_barrel', {
          position: hitPt,
          volume: 0.95,
          pitch: rand(0.8, 1.0),
        });
        this.cb.onBombHitCarrier(hitPt, b.damage, b.attackerName, heavy);
        this.ctx.render?.scene?.remove(b.mesh);
        this.bombs.splice(i, 1);
      } else if (hitSea || b.life <= 0) {
        if (hitSea) {
          const splashPt = b.pos.clone().setY(0.5);
          this.ctx.fx?.sparks?.(splashPt, _up, 24, 0xd8f4ff);
          this.ctx.fx?.explosion?.(splashPt, { radius: 9, scale: 1.25 });
          this.ctx.audio?.play?.('explosion_barrel', { position: splashPt, volume: 0.65, pitch: 0.72 });
        }
        this.ctx.render?.scene?.remove(b.mesh);
        this.bombs.splice(i, 1);
      }
    }
  }

  private disposeChunk(c: WreckChunk): void {
    c.emitter?.stop?.();
    this.ctx.render?.scene?.remove(c.mesh);
  }

  reset(): void {
    for (const c of this.chunks) this.disposeChunk(c);
    this.chunks.length = 0;

    for (const p of this.pilots) {
      p.unmark?.();
      p.canopy.removeFromParent();
      if (p.enemy.alive) this.manager.despawn?.(p.enemy);
    }
    this.pilots.length = 0;

    for (const f of this.collapsedCanopies) f.canopy.removeFromParent();
    this.collapsedCanopies.length = 0;

    for (const b of this.bombs) this.ctx.render?.scene?.remove(b.mesh);
    this.bombs.length = 0;

    this.shatteredJets = 0;
    this.ejectedPilotsSpawned = 0;
    this.ejectedPilotsShot = 0;
    this.ragdollPilotsSpawned = 0;
    this.gibbedPilotsSpawned = 0;
    this.bombsDropped = 0;
  }

  dispose(): void {
    this.reset();
    this.unitBox.dispose();
    this.noseConeGeo.dispose();
    this.domeGeo.dispose();
    this.dragChuteGeo.dispose();
    this.shroudGeo.dispose();
    this.bombBodyGeo.dispose();
    this.bombNoseGeo.dispose();
    this.charMetalMat.dispose();
    this.hotEdgeMat.dispose();
    this.seatMat.dispose();
    this.canopyOrangeMat.dispose();
    this.canopyStripeMat.dispose();
    this.shroudMat.dispose();
    this.bombMat.dispose();
    this.bombYellowBandMat.dispose();
    for (const mat of this.hullMats.values()) mat.dispose();
    this.hullMats.clear();
  }
}
