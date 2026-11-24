/**
 * Co-op sync for Dogfight mode (`src/enemies/dogfight/`):
 *   - Host streams live AI enemy & allied jets over the unreliable side channel (`SIDE.jets`, 10 Hz)
 *     and authoritative USS Sovereign carrier / wave state over `dfstate` (2 Hz + on change + catchUp).
 *   - Guests render smoothly interpolated 3D jet puppets (`GuestAiJet`) registered with `VehicleSystem.addExtra`
 *     so guest fighter cannons, AIM-9X / AIM-120D homing missiles, flak shells, blasts, AA Lead Pips,
 *     and HUD bandit diamonds work identically to solo Dogfight.
 *   - Guest hits forward to the host via `dfhit` (validated and applied to the real `AiCombatJet`),
 *     splashed jets broadcast `dfshatter` so every browser plays the 7-piece breakup + ejected pilot fate,
 *     guest Carrier Defense Terminal upgrades/wave calls ride `dfbuy` / `dfnext`, and guest RWR lock
 *     warnings / air-to-air damage / IR flares ride `dfrwr` / `dfdmg` / `dfflare`.
 *
 * Zero overhead on non-Dogfight maps: exits immediately when `ctx.waves` is not `DogfightWaves`.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ExplosionKind } from '../../core/contracts';
import type { ExplosionSpec, MissileTarget, VehicleRadarTarget, WavePhase } from '../../core/gameplay';
import { clamp, damp, dampAngle } from '../../core/math';
import { AI_JET_PROFILES, type AiCombatJet, type AiJetKind, type AiJetTeam } from '../../enemies/dogfight/aiJet';
import type { CarrierUpgradeId } from '../../enemies/dogfight/carrier';
import type { DogfightNetBridge, DogfightWaves } from '../../enemies/dogfight/waves';
import type { ExtraTarget, VehicleSystem } from '../../enemies/vehicles';
import { ModelMaterials } from '../../progression/modelkit';
import { buildVehicleModel, type VehicleModelRig } from '../../vehicles/drive/models';
import type { WireClasses } from '../pressure';
import type { WorldContext, WorldModule } from './context';
import { ListParts, SIDE, sendList } from './sideList';
import { validVec, type Vec } from './wire';

class Rate {
  private at = 0;
  private used = 0;
  take(now: number, max: number): boolean {
    if (now - this.at >= 1000) { this.at = now; this.used = 0; }
    if (this.used >= max) return false;
    this.used++;
    return true;
  }
}

export type DogfightEvent =
  /** Host -> guests: authoritative USS Sovereign carrier hull, credits, upgrade levels, and wave state. */
  | { t: 'dfstate'; w: number; ph: WavePhase; rem: number; nxt: number; hp: number; mhp: number; cr: number; dead: 0 | 1; lv: [number, number, number, number] }
  /** Guest -> host: cannon, missile, or blast hit claim against a host AI jet (`id`). */
  | { t: 'dfhit'; id: number; dmg: number; at: Vec; src: string; hvy?: 1 }
  /** Host -> guests: explosive 7-piece jet breakup + pilot fate when an AI jet is splashed. */
  | { t: 'dfshatter'; id: number; k: AiJetKind; tm: 0 | 1; p: Vec; v: Vec; r: Vec; src: string; hvy?: 1 }
  /** Guest -> host: buy a Carrier Defense Terminal upgrade on USS Sovereign. */
  | { t: 'dfbuy'; id: CarrierUpgradeId }
  /** Guest -> host: request early start of the next Dogfight wave during intermission. */
  | { t: 'dfnext' }
  /** Guest -> host: guest popped [Q] IR flares to break enemy locks & decoy Fox-2 missiles. */
  | { t: 'dfflare' }
  /** Host -> specific guest: cockpit RWR lock / Fox-2 inbound warning state. */
  | { t: 'dfrwr'; lk: 0 | 1; s: number; m: 0 | 1; lb: string }
  /** Host -> specific guest: enemy air-to-air gunfire / missile damage against guest aircraft/player. */
  | { t: 'dfdmg'; amt: number; from: Vec };

interface JetWireRow {
  id: number;
  k: AiJetKind;
  tm: 0 | 1; // 0 = enemy, 1 = ally
  p: Vec;
  v: Vec;
  r: Vec; // [yaw, pitch, roll]
  hp: number;
  mhp: number;
}

const JET_SEND_MS = 100; // 10 Hz
const STATE_SEND_MS = 500; // 2 Hz
const HITS_PER_SECOND = 40;
const BUY_PER_SECOND = 4;
const FLARE_PER_SECOND = 3;
const VALID_KINDS: ReadonlySet<string> = new Set(['hornet', 'harrier', 'warthog', 'lancer', 'raptor']);
const VALID_UPGRADES: ReadonlySet<string> = new Set(['ciws', 'sam', 'armor', 'wingman', 'repair']);
const VALID_PHASES: ReadonlySet<string> = new Set(['intermission', 'spawning', 'clearing', 'boss']);

const _q = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _half = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();

const mm = (n: number): number => Math.round(n * 100) / 100;
const rad = (n: number): number => Math.round(n * 1000) / 1000;

function dogfightWavesOf(w: WorldContext): DogfightWaves | null {
  const waves = w.ctx.waves as unknown as Partial<DogfightWaves> | undefined;
  if (!waves || typeof waves.setNetBridge !== 'function' || !waves.carrier || !waves.wreckage) return null;
  return waves as DogfightWaves;
}

function vehicleSystemOf(w: WorldContext): VehicleSystem | null {
  return (w.ctx.enemies?.vehicles as VehicleSystem | null | undefined) ?? null;
}

/**
 * Guest-side shootable & lockable puppet of a host `AiCombatJet`.
 * Implements `ExtraTarget` and `MissileTarget` so guest fighter cannons, AIM-9X/AIM-120D homing missiles,
 * AA Lead Pips, and HUD markers behave identically to solo Dogfight.
 */
class GuestAiJet implements ExtraTarget, MissileTarget {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly targetPos = new THREE.Vector3();
  readonly targetVel = new THREE.Vector3();
  readonly rig: VehicleModelRig;
  readonly collider: RAPIER.Collider | null;
  readonly name: string;

  alive = true;
  yaw = 0;
  pitch = 0;
  roll = 0;
  targetYaw = 0;
  targetPitch = 0;
  targetRoll = 0;
  hp: number;
  maxHp: number;
  lastSeenAt: number;
  private unmark: (() => void) | null = null;
  private smokeTimer = 0;

  constructor(
    private readonly w: WorldContext,
    readonly id: number,
    readonly kind: AiJetKind,
    readonly team: AiJetTeam,
    materials: ModelMaterials,
    row: JetWireRow,
    now: number,
    private readonly onClaimHit: (id: number, dmg: number, at: THREE.Vector3, src: string, heavy: boolean) => void,
  ) {
    const profile = AI_JET_PROFILES[kind];
    this.name = team === 'ally' ? `ALLY ${profile.name}` : profile.name;
    this.hp = row.hp;
    this.maxHp = Math.max(1, row.mhp);
    this.lastSeenAt = now;

    this.position.set(row.p[0], row.p[1], row.p[2]);
    this.targetPos.copy(this.position);
    this.velocity.set(row.v[0], row.v[1], row.v[2]);
    this.targetVel.copy(this.velocity);
    this.yaw = this.targetYaw = row.r[0];
    this.pitch = this.targetPitch = row.r[1];
    this.roll = this.targetRoll = row.r[2];

    this.rig = buildVehicleModel(kind, materials);
    if (this.rig.landingGear) this.rig.landingGear.visible = false;
    for (const g of this.rig.boostGlow) g.visible = true;
    this.w.ctx.render?.scene?.add(this.rig.root);
    this.syncVisual(0.016);

    const h = profile.hitboxHalf;
    this.collider = team === 'enemy' && this.w.ctx.physics?.addStaticBox
      ? this.w.ctx.physics.addStaticBox(this.position, _half.set(h[0], h[1], h[2]), null, 'metal')
      : null;

    this.unmark = this.w.ctx.hud?.follow?.(
      this.position,
      this.name,
      team === 'ally' ? '#56f0ff' : kind === 'raptor' ? '#ff3864' : '#ff5a3a',
    ) ?? null;
  }

  get center(): THREE.Vector3 {
    return this.position;
  }

  ingest(row: JetWireRow, now: number): void {
    this.targetPos.set(row.p[0], row.p[1], row.p[2]);
    this.targetVel.set(row.v[0], row.v[1], row.v[2]);
    this.targetYaw = row.r[0];
    this.targetPitch = row.r[1];
    this.targetRoll = row.r[2];
    this.hp = row.hp;
    this.maxHp = Math.max(1, row.mhp);
    this.lastSeenAt = now;
  }

  step(dt: number): void {
    // Predict gently between 10 Hz host packets and ease onto authoritative target pose.
    this.targetPos.addScaledVector(this.targetVel, dt * 0.45);
    const distSq = this.position.distanceToSquared(this.targetPos);
    if (distSq > 90 * 90) {
      this.position.copy(this.targetPos);
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
      this.roll = this.targetRoll;
    } else {
      this.position.x = damp(this.position.x, this.targetPos.x, 14, dt);
      this.position.y = damp(this.position.y, this.targetPos.y, 14, dt);
      this.position.z = damp(this.position.z, this.targetPos.z, 14, dt);
      this.yaw = dampAngle(this.yaw, this.targetYaw, 14, dt);
      this.pitch = damp(this.pitch, this.targetPitch, 14, dt);
      this.roll = damp(this.roll, this.targetRoll, 14, dt);
    }
    this.velocity.lerp(this.targetVel, clamp(dt * 12, 0, 1));
    this.syncVisual(dt);
  }

  private syncVisual(dt: number): void {
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.set(0, this.yaw, 0);
    this.rig.body.rotation.set(this.pitch, 0, this.roll);

    if (this.rig.wingsLeft && this.rig.wingsRight) {
      const spd = this.velocity.length();
      const sweep = clamp((spd - 35) / 55, 0, 1) * 0.78;
      this.rig.wingsLeft.rotation.y = sweep;
      this.rig.wingsRight.rotation.y = -sweep;
    }

    if (this.collider) {
      _q.setFromEuler(_euler.set(this.pitch, this.yaw, this.roll));
      this.collider.setTranslation(this.position);
      this.collider.setRotation(_q);
    }

    if (this.hp / this.maxHp < 0.45) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.08;
        this.w.ctx.fx?.smoke?.(this.position, 0x22252a, 1.35, 1.3);
      }
    }
  }

  // ---- ExtraTarget implementation (forwards guest gunfire/missiles/blasts to host!) ----

  shot(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, source: string): boolean {
    if (!this.alive || !this.collider || collider.handle !== this.collider.handle) return false;
    this.onClaimHit(this.id, amount, point, source, false);
    this.w.ctx.hud?.hitMarker?.('body');
    this.w.ctx.audio?.play?.('hit_marker', { volume: 0.7 });
    return true;
  }

  direct(collider: RAPIER.Collider, point: THREE.Vector3, amount: number, _kind: ExplosionKind, source: string): boolean {
    if (!this.alive || !this.collider || collider.handle !== this.collider.handle) return false;
    this.onClaimHit(this.id, amount, point, source, true);
    this.w.ctx.hud?.hitMarker?.('armorThrough');
    this.w.ctx.audio?.play?.('armour_through', { volume: 0.85 });
    return true;
  }

  blast(center: THREE.Vector3, spec: ExplosionSpec): number {
    if (!this.alive || this.team !== 'enemy') return 0;
    const dist = center.distanceTo(this.position);
    const reach = spec.radius + 7.5;
    if (dist > reach) return 0;
    const falloff = clamp(1 - (dist / reach) * 0.55, 0.35, 1);
    const dmg = Math.round(spec.damage * falloff);
    if (dmg > 0) {
      this.onClaimHit(this.id, dmg, this.position, spec.source ?? 'blast', true);
      this.w.ctx.hud?.hitMarker?.('armorThrough');
    }
    return dmg > 0 ? 1 : 0;
  }

  paintable(out: MissileTarget[]): void {
    if (this.alive && this.team === 'enemy') out.push(this);
  }

  radarTargets(out: VehicleRadarTarget[]): void {
    if (!this.alive || this.team !== 'enemy') return;
    out.push({
      id: this.id,
      kind: 'chopper',
      label: this.name,
      position: this.position,
      velocity: this.velocity,
      airborne: true,
    });
  }

  highlightMeshes(out: THREE.Object3D[]): void {
    if (!this.alive || this.team !== 'enemy') return;
    for (const m of this.rig.meshes) out.push(m);
  }

  dispose(): void {
    this.alive = false;
    this.unmark?.();
    this.unmark = null;
    this.rig.root.removeFromParent();
    if (this.collider) {
      this.w.ctx.physics?.world?.removeCollider?.(this.collider, true);
    }
  }
}

export class DogfightSync implements WorldModule {
  private readonly jetIds = new WeakMap<AiCombatJet, number>();
  private readonly idToJet = new Map<number, AiCombatJet>();
  private jetSerial = 0;
  private readonly puppets = new Map<number, GuestAiJet>();
  private readonly parts = new ListParts();
  private readonly rates = new Map<string, { hit: Rate; buy: Rate; flare: Rate }>();
  private materials: ModelMaterials | null = null;
  private pluggedWaves: DogfightWaves | null = null;
  private nextJetSend = 0;
  private nextStateSend = 0;
  private emptyLeft = 0;
  private lastFrame = 0;

  constructor(private readonly w: WorldContext) {
    w.side(SIDE.jets, (value, now) => {
      const whole = this.parts.take(value);
      if (whole) this.onJetsSnapshot(whole.list as JetWireRow[], now);
    });
    w.router.guest('dfstate', v => this.onState(v));
    w.router.host('dfhit', (v, from, now) => this.onGuestHit(v, from, now));
    w.router.guest('dfshatter', v => this.onShatter(v));
    w.router.host('dfbuy', (v, from, now) => this.onBuyRequest(v, from, now));
    w.router.host('dfnext', (_v, from, now) => this.onNextWaveRequest(from, now));
    w.router.host('dfflare', (_v, from, now) => this.onGuestFlare(from, now));
    w.router.guest('dfrwr', v => this.onRwr(v));
    w.router.guest('dfdmg', v => this.onGuestDamage(v));
  }

  /** Number of replicated AI jet puppets on a co-op guest (for unit tests & proofs). */
  get puppetCount(): number {
    return this.puppets.size;
  }

  private rate(from: string) {
    let r = this.rates.get(from);
    if (!r) this.rates.set(from, r = { hit: new Rate(), buy: new Rate(), flare: new Rate() });
    return r;
  }

  private ensureBridge(waves: DogfightWaves): void {
    if (this.pluggedWaves === waves) return;
    this.pluggedWaves = waves;
    const bridge: DogfightNetBridge = {
      onJetKilled: (jet, source, heavyKill) => {
        if (!this.w.hosting || !this.w.ready) return;
        const id = this.jetIds.get(jet) ?? 0;
        this.idToJet.delete(id);
        this.w.send({
          t: 'dfshatter',
          id,
          k: jet.kind,
          tm: jet.team === 'enemy' ? 0 : 1,
          p: [mm(jet.position.x), mm(jet.position.y), mm(jet.position.z)],
          v: [mm(jet.velocity.x), mm(jet.velocity.y), mm(jet.velocity.z)],
          r: [rad(jet.yaw), rad(jet.pitch), rad(jet.roll)],
          src: source.slice(0, 32),
          ...(heavyKill ? { hvy: 1 as const } : {}),
        });
        this.sendState(waves);
      },
      onBuyUpgrade: id => {
        if (!this.w.hosting && this.w.ready) this.w.send({ t: 'dfbuy', id });
      },
      onCallNextWave: () => {
        if (!this.w.hosting && this.w.ready) this.w.send({ t: 'dfnext' });
      },
      onPlayerFlares: () => {
        if (!this.w.hosting && this.w.ready) this.w.send({ t: 'dfflare' });
      },
      onGuestDamage: (peerId, amount, from) => {
        if (!this.w.hosting || !this.w.ready) return;
        this.w.send({ t: 'dfdmg', amt: Math.round(amount), from: [mm(from.x), mm(from.y), mm(from.z)] }, peerId);
      },
      onGuestRwr: (peerId, locking, lockStrength, missileInbound, label) => {
        if (!this.w.hosting || !this.w.ready) return;
        this.w.send({
          t: 'dfrwr',
          lk: locking ? 1 : 0,
          s: mm(lockStrength),
          m: missileInbound ? 1 : 0,
          lb: label.slice(0, 48),
        }, peerId);
      },
    };
    waves.setNetBridge(bridge);
  }

  update(now: number): void {
    const waves = dogfightWavesOf(this.w);
    if (!waves) return;
    this.ensureBridge(waves);

    const dt = this.lastFrame === 0 ? 0.016 : clamp((now - this.lastFrame) / 1000, 0, 0.25);
    this.lastFrame = now;

    if (this.w.hosting) {
      if (this.w.ready && now >= this.nextJetSend) {
        this.nextJetSend = now + JET_SEND_MS;
        this.sendJets(waves);
      }
      if (this.w.ready && now >= this.nextStateSend) {
        this.nextStateSend = now + STATE_SEND_MS;
        this.sendState(waves);
      }
    } else {
      // Guest: tick Carrier HUD, Deck Terminals, ocean hoist, flight deck repair, and interpolated jet puppets.
      waves.tickGuest(dt);
      for (const [id, p] of this.puppets) {
        if (now - p.lastSeenAt > 3500) {
          this.removePuppet(id);
          continue;
        }
        p.step(dt);
      }
    }
  }

  // ---- Host broadcast ----

  private sendJets(waves: DogfightWaves): void {
    const rows: JetWireRow[] = [];
    const pushList = (list: readonly AiCombatJet[], tm: 0 | 1) => {
      for (const j of list) {
        if (!j.alive || j.disposed) continue;
        let id = this.jetIds.get(j);
        if (id === undefined) {
          id = ++this.jetSerial;
          this.jetIds.set(j, id);
        }
        this.idToJet.set(id, j);
        rows.push({
          id,
          k: j.kind,
          tm,
          p: [mm(j.position.x), mm(j.position.y), mm(j.position.z)],
          v: [mm(j.velocity.x), mm(j.velocity.y), mm(j.velocity.z)],
          r: [rad(j.yaw), rad(j.pitch), rad(j.roll)],
          hp: Math.max(0, Math.round(j.health)),
          mhp: Math.max(1, Math.round(j.maxHealth)),
        });
      }
    };
    pushList(waves.enemies, 0);
    pushList(waves.allies, 1);

    // Prune dead entries from idToJet map.
    for (const [id, j] of this.idToJet) {
      if (!j.alive || j.disposed) this.idToJet.delete(id);
    }

    if (rows.length === 0) {
      if (this.emptyLeft <= 0) return;
      this.emptyLeft--;
    } else {
      this.emptyLeft = 5;
    }
    sendList(this.w, SIDE.jets, Math.round(performance.now()), rows);
  }

  private statePacket(waves: DogfightWaves): Extract<DogfightEvent, { t: 'dfstate' }> {
    const c = waves.carrier;
    return {
      t: 'dfstate',
      w: waves.wave,
      ph: waves.phase,
      rem: waves.remaining,
      nxt: Math.round(waves.nextWaveIn * 10) / 10,
      hp: Math.round(c.hp),
      mhp: Math.round(c.maxHp),
      cr: Math.round(c.credits),
      dead: c.destroyed ? 1 : 0,
      lv: [c.ciwsLevel, c.samLevel, c.armorLevel, c.wingmanLevel],
    };
  }

  private sendState(waves: DogfightWaves, to?: string): void {
    this.w.send(this.statePacket(waves), to);
  }

  // ---- Guest ingest ----

  private onJetsSnapshot(list: JetWireRow[], now: number): void {
    if (this.w.hosting || !Array.isArray(list)) return;
    const seen = new Set<number>();
    const vs = vehicleSystemOf(this.w);
    for (const row of list.slice(0, 20)) {
      if (
        !row || !Number.isInteger(row.id) || row.id <= 0
        || !VALID_KINDS.has(row.k)
        || (row.tm !== 0 && row.tm !== 1)
        || !validVec(row.p) || !validVec(row.v) || !validVec(row.r)
        || !Number.isFinite(row.hp) || !Number.isFinite(row.mhp)
      ) continue;

      seen.add(row.id);
      const team: AiJetTeam = row.tm === 0 ? 'enemy' : 'ally';
      let puppet = this.puppets.get(row.id);
      if (puppet && (puppet.kind !== row.k || puppet.team !== team)) {
        this.removePuppet(row.id);
        puppet = undefined;
      }
      if (!puppet) {
        this.materials ??= new ModelMaterials(this.w.ctx);
        puppet = new GuestAiJet(this.w, row.id, row.k, team, this.materials, row, now, (id, dmg, at, src, heavy) => {
          if (!this.w.ready) return;
          this.w.send({
            t: 'dfhit',
            id,
            dmg: Math.min(2000, Math.max(1, Math.round(dmg))),
            at: [mm(at.x), mm(at.y), mm(at.z)],
            src: src.slice(0, 32),
            ...(heavy ? { hvy: 1 as const } : {}),
          });
        });
        this.puppets.set(row.id, puppet);
        vs?.addExtra(puppet);
      } else {
        puppet.ingest(row, now);
      }
    }

    for (const id of [...this.puppets.keys()]) {
      if (!seen.has(id)) this.removePuppet(id);
    }
  }

  private removePuppet(id: number): void {
    const p = this.puppets.get(id);
    if (!p) return;
    vehicleSystemOf(this.w)?.removeExtra(p);
    p.dispose();
    this.puppets.delete(id);
  }

  private onState(v: Extract<DogfightEvent, { t: 'dfstate' }>): void {
    if (this.w.hosting) return;
    const waves = dogfightWavesOf(this.w);
    if (!waves) return;
    this.ensureBridge(waves);
    if (
      !Number.isFinite(v.w) || !VALID_PHASES.has(v.ph) || !Number.isFinite(v.rem) || !Number.isFinite(v.nxt)
      || !Number.isFinite(v.hp) || !Number.isFinite(v.mhp) || !Number.isFinite(v.cr)
      || !Array.isArray(v.lv) || v.lv.length !== 4 || !v.lv.every(Number.isFinite)
    ) return;
    waves.applyGuestState(
      Math.max(0, Math.floor(v.w)),
      v.ph,
      Math.max(0, Math.floor(v.rem)),
      Math.max(0, v.nxt),
      v.hp,
      v.mhp,
      v.cr,
      v.dead === 1,
      v.lv[0],
      v.lv[1],
      v.lv[2],
      v.lv[3],
    );
  }

  private onShatter(v: Extract<DogfightEvent, { t: 'dfshatter' }>): void {
    if (this.w.hosting) return;
    if (Number.isInteger(v.id) && v.id > 0) this.removePuppet(v.id);
    const waves = dogfightWavesOf(this.w);
    if (!waves || !VALID_KINDS.has(v.k) || !validVec(v.p) || !validVec(v.v) || !validVec(v.r)) return;
    _pos.set(v.p[0], v.p[1], v.p[2]);
    _vel.set(v.v[0], v.v[1], v.v[2]);
    waves.applyGuestShatter(
      v.k,
      v.tm === 0 ? 'enemy' : 'ally',
      _pos,
      _vel,
      v.r[0],
      v.r[1],
      v.r[2],
      typeof v.src === 'string' ? v.src : 'cannon',
      v.hvy === 1,
    );
  }

  private onRwr(v: Extract<DogfightEvent, { t: 'dfrwr' }>): void {
    if (this.w.hosting) return;
    this.w.ctx.events.emit('dogfight:rwr', {
      locking: v.lk === 1,
      lockStrength: Number.isFinite(v.s) ? clamp(v.s, 0, 1) : 0,
      missileInbound: v.m === 1,
      label: typeof v.lb === 'string' ? v.lb.slice(0, 48) : '',
    });
  }

  private onGuestDamage(v: Extract<DogfightEvent, { t: 'dfdmg' }>): void {
    if (this.w.hosting || !Number.isFinite(v.amt) || v.amt <= 0 || !validVec(v.from)) return;
    const from = new THREE.Vector3(v.from[0], v.from[1], v.from[2]);
    const dmg = clamp(v.amt, 1, 500);
    if (this.w.ctx.player.parked) {
      this.w.ctx.events.emit('dogfight:damage_player_jet', { amount: dmg, from });
    } else {
      this.w.ctx.player.takeDamage({ amount: dmg, type: 'explosive', from, source: 'enemy_aam' });
    }
  }

  // ---- Host handlers for guest actions ----

  private onGuestHit(v: Extract<DogfightEvent, { t: 'dfhit' }>, from: string, now: number): void {
    if (!this.w.hosting || !Number.isInteger(v.id) || v.id <= 0 || !Number.isFinite(v.dmg) || v.dmg <= 0 || !validVec(v.at)) return;
    if (!this.rate(from).hit.take(now, HITS_PER_SECOND)) return;
    const jet = this.idToJet.get(v.id);
    if (!jet || !jet.alive || jet.team !== 'enemy') return;
    const dmg = clamp(v.dmg, 1, 1500);
    _pos.set(v.at[0], v.at[1], v.at[2]);
    const src = typeof v.src === 'string' && v.src.length > 0 ? v.src.slice(0, 32) : 'coop_jet';
    jet.applyDamage(dmg, _pos, src, v.hvy === 1);
  }

  private onBuyRequest(v: Extract<DogfightEvent, { t: 'dfbuy' }>, from: string, now: number): void {
    if (!this.w.hosting || !VALID_UPGRADES.has(v.id)) return;
    if (!this.rate(from).buy.take(now, BUY_PER_SECOND)) return;
    const waves = dogfightWavesOf(this.w);
    if (!waves) return;
    if (waves.requestBuyUpgrade(v.id)) {
      this.sendState(waves);
    }
  }

  private onNextWaveRequest(from: string, now: number): void {
    if (!this.w.hosting) return;
    if (!this.rate(from).buy.take(now, BUY_PER_SECOND)) return;
    const waves = dogfightWavesOf(this.w);
    if (!waves) return;
    waves.requestNextWave();
    this.sendState(waves);
  }

  private onGuestFlare(from: string, now: number): void {
    if (!this.w.hosting) return;
    if (!this.rate(from).flare.take(now, FLARE_PER_SECOND)) return;
    dogfightWavesOf(this.w)?.triggerGuestFlares();
  }

  /** Host: immediately syncs USS Sovereign carrier/wave state to an arriving guest. */
  catchUp(id: string): void {
    if (!this.w.hosting) return;
    const waves = dogfightWavesOf(this.w);
    if (!waves) return;
    this.ensureBridge(waves);
    this.sendState(waves, id);
  }

  forgetPeer(id: string): void {
    this.rates.delete(id);
  }

  dispose(): void {
    for (const id of [...this.puppets.keys()]) this.removePuppet(id);
    this.puppets.clear();
    this.idToJet.clear();
    this.rates.clear();
    if (this.pluggedWaves) {
      this.pluggedWaves.setNetBridge(null);
      this.pluggedWaves = null;
    }
    this.lastFrame = 0;
  }
}

export const DOGFIGHT_WIRE: WireClasses<DogfightEvent> = {
  dfstate: 'latest',
  dfhit: 'fact',
  dfshatter: 'fact',
  dfbuy: 'fact',
  dfnext: 'fact',
  dfflare: 'fact',
  dfrwr: 'latest',
  dfdmg: 'fact',
};
