/**
 * Desert Raid (Mission 5 — Surplus) runtime director.
 *
 * Orchestrates all `dr.*` calls from `src/campaign/missions/desertRaid.ts` across the four
 * modular subsystems:
 *   - `DesertConvoy`      (`src/campaign/desert/convoy.ts`)      — 3-truck ally convoy, side-gate trucks, bandit chases
 *   - `DesertAirAndSquads`(`src/campaign/desert/airAndSquads.ts`)— escort gunships, Warthog breach, friendly squads, ending cutscene
 *   - `DesertSetpieces`   (`src/campaign/desert/setpieces.ts`)   — loudspeaker poles, bulldozer gate, water tower flood, Quist 5-outcome finale
 *   - `SaltbloodStyler`   (`src/campaign/desert/saltbloods.ts`)  — scarves, amber dust goggles & welded scrap armor
 *
 * Also places the optional Warren rooftop rotary Minigun emplacement, pulses loudspeaker poles
 * whenever Quist speaks over the PA, handles bulkhead door breach-override fail-safes, and
 * tracks `quistCaptured` into Exfil and the town-flattening ending.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { Line } from '../enemies/commander/lines';
import type { Emplacement, Emplacements } from '../vehicles/emplacement';
import { CARGO_PLANE, DESERT_Z, WARREN_MINIGUN } from '../world/map/desert/plan';
import { DesertAirAndSquads } from './desert/airAndSquads';
import { DesertConvoy } from './desert/convoy';
import { SaltbloodStyler } from './desert/saltbloods';
import { DesertSetpieces } from './desert/setpieces';
import type {
  AirAndSquadsController,
  ConvoyController,
  QuistHooks,
  QuistOutcome,
  SetpiecesController,
} from './desert/types';
import type { CampaignHud } from './hud';
import type { MissionRunner } from './runner';

/** Every `dr.*` script call supported by `DesertRaid.call`. */
export const DESERT_RAID_CALLS: ReadonlySet<string> = new Set([
  'dr.approachStart',
  'dr.escortStart',
  'dr.banditsApproach',
  'dr.wallLoop',
  'dr.sideTruckWest',
  'dr.sideTruckEast',
  'dr.warthogGate',
  'dr.dropSquads',
  'dr.dismount',
  'dr.warrenStart',
  'dr.pumpStart',
  'dr.planeStart',
  'dr.planeAdvanceTail',
  'dr.exfilArrive',
  'dr.exfilChase',
  'dr.endingCutscene',
]);

/** Fallback aliases for keys Lane 4 (`setpieces.ts`) might pass into `QuistHooks.onLine`. */
const LINE_KEY_ALIASES: Readonly<Record<string, string>> = {
  'quist.pistol': 'quist.suicide',
  'quist.capture': 'quist.captured',
  'quist.speech1': 'quist.speech.1',
  'quist.speech2': 'quist.speech.2',
  'quist.speech3': 'quist.speech.3',
  'quist.speech4': 'quist.speech.4',
  'quist.reply1': 'quist.reply.1',
  'quist.reply2': 'quist.reply.2',
};

interface CallinsAccess {
  callInsManager?: {
    emplacements?: Emplacements;
  };
}

type DirectorPhase = 'idle' | 'approach' | 'wall' | 'warren' | 'pump' | 'plane' | 'exfil_arrive' | 'exfil_chase' | 'ending';

const _v = new THREE.Vector3();

export class DesertRaid {
  readonly convoy: ConvoyController;
  readonly airAndSquads: AirAndSquadsController;
  readonly setpieces: SetpiecesController;
  readonly saltbloods: SaltbloodStyler;

  private built = false;
  private speakWrapped = false;
  private phase: DirectorPhase = 'idle';
  private readonly emitted = new Set<string>();
  private readonly deferredSignals: string[] = [];
  private readonly directorQueue: Line[] = [];
  private directorSpeaking = false;

  // Optional Warren rooftop M134 rotary minigun emplacement
  private warrenMinigun: Emplacement | null = null;

  // Plane bulkhead breach-override tracking (prevents any softlock)
  private door1Slammed = false;
  private door1Opened = false;
  private door1ClearClock = 0;
  private door2Slammed = false;
  private door2Opened = false;
  private door2ClearClock = 0;

  // Quist finale state — `quistCaptured` persists across an Exfil checkpoint reload
  quistCaptured = false;
  quistOutcome: QuistOutcome | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly runner: MissionRunner,
    private readonly ui: CampaignHud,
  ) {
    this.convoy = new DesertConvoy(ctx, runner, ui);
    this.airAndSquads = new DesertAirAndSquads(ctx, runner, ui);
    this.setpieces = new DesertSetpieces(ctx, runner, ui);
    this.saltbloods = new SaltbloodStyler(ctx);
  }

  private get emplacements(): Emplacements | undefined {
    return (this.ctx.progression as unknown as CallinsAccess | undefined)?.callInsManager?.emplacements;
  }

  ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    this.setpieces.ensureBuilt();
    this.wrapSpeakForLoudspeakers();

    const op2 = typeof window !== 'undefined'
      ? (window as unknown as { __op2?: Record<string, unknown> }).__op2
      : undefined;
    if (op2) op2.desertRaid = this;
  }

  /** Intercepts CampaignHud.speak once so every Quist PA line pulses the nearest loudspeaker pole. */
  private wrapSpeakForLoudspeakers(): void {
    if (this.speakWrapped || !this.ui || typeof this.ui.speak !== 'function') return;
    this.speakWrapped = true;
    const origSpeak = this.ui.speak.bind(this.ui);
    this.ui.speak = (line: Line, done: () => void) => {
      if (line.speaker === 'quist') {
        this.setpieces.pulseLoudspeaker();
        if (this.ctx.audio?.has?.('walkietalkie_fire')) {
          this.ctx.audio.play('walkietalkie_fire', { pitch: 0.76, volume: 0.28, unaffectedByTime: true });
        }
      }
      origSpeak(line, done);
    };
  }

  private emitOnce(sig: string): void {
    if (this.emitted.has(sig)) return;
    this.emitted.add(sig);
    this.runner.signal(sig);
  }

  private resolveLine(key: string): Line | undefined {
    const normalized = LINE_KEY_ALIASES[key] ?? key;
    const fullId = normalized.startsWith('mission.desert_raid.')
      ? normalized
      : `mission.desert_raid.${normalized}`;
    return this.runner.mission.lines.find(l => l.id === fullId);
  }

  private speakDirectorLine(key: string, now = false): void {
    const line = this.resolveLine(key);
    if (!line || !this.ui || typeof this.ui.speak !== 'function') return;
    if (now) {
      this.directorQueue.length = 0;
      this.directorSpeaking = false;
      this.runner.hush();
      this.playDirectorLineNow(line);
      return;
    }
    if (!this.directorSpeaking && !this.ui.talking) {
      this.playDirectorLineNow(line);
    } else {
      this.directorQueue.push(line);
    }
  }

  private playDirectorLineNow(line: Line): void {
    this.directorSpeaking = true;
    this.ui.speak(line, () => {
      this.directorSpeaking = false;
      const next = this.directorQueue.shift();
      if (next) this.playDirectorLineNow(next);
    });
  }

  private placeWarrenMinigun(): void {
    if (this.warrenMinigun) return;
    const emplacements = this.emplacements;
    if (!emplacements) return;
    // Camera yaw 0 looks down -Z (north); angle slightly northeast (-0.32 rad) from x = -14 down the central Warren avenue.
    const aimNorthYaw = WARREN_MINIGUN.yaw === Math.PI ? -0.32 : WARREN_MINIGUN.yaw;
    this.warrenMinigun = emplacements.place({
      pos: new THREE.Vector3(WARREN_MINIGUN.pos[0], WARREN_MINIGUN.pos[1], WARREN_MINIGUN.pos[2]),
      yaw: aimNorthYaw,
      arc: (140 * Math.PI) / 360,
      level: 3,
    });
  }

  private makeQuistHooks(): QuistHooks {
    return {
      onLine: (key: string, opts?: { now?: boolean }) => {
        this.speakDirectorLine(key, opts?.now === true);
      },
      onOutcome: (outcome: QuistOutcome) => {
        this.handleQuistOutcome(outcome);
      },
      onDoorSlam: (doorId: 'plane.door1' | 'plane.door2') => {
        if (doorId === 'plane.door1') {
          this.door1Slammed = true;
          this.door1ClearClock = 0;
          this.emitOnce('dr:door1_slam');
        } else if (doorId === 'plane.door2') {
          this.door2Slammed = true;
          this.door2ClearClock = 0;
          this.emitOnce('dr:door2_slam');
        }
      },
    };
  }

  private handleQuistOutcome(outcome: QuistOutcome): void {
    if (this.quistOutcome) return;
    this.quistOutcome = outcome;
    this.quistCaptured = outcome === 'captured';

    if (outcome === 'grenade_killed') {
      // Player died to Quist's grenade — checkpoint restarts `the_plane`, do not advance to exfil.
      this.emitOnce('dr:quist_grenade_killed');
      return;
    }

    if (outcome === 'killed') {
      // Cut off Quist's speech mid-word cleanly.
      this.directorQueue.length = 0;
      this.directorSpeaking = false;
      this.runner.hush();
    }

    this.emitOnce(`dr:quist_${outcome}`);
    this.emitOnce('dr:quist_done');
  }

  private countLivingInHull(zMin: number, zMax: number): number {
    const alive = this.ctx.enemies?.alive;
    if (!alive) return 0;
    let count = 0;
    for (const e of alive) {
      if (!e.alive) continue;
      if (Math.abs(e.position.x) <= 6.5 && e.position.z >= zMin && e.position.z <= zMax) {
        count++;
      }
    }
    return count;
  }

  // -----------------------------------------------------------------------------------------------
  // Mission Script Call Dispatch (`dr.*`)
  // -----------------------------------------------------------------------------------------------

  call(name: string, arg?: string): void {
    this.ensureBuilt();
    switch (name) {
      case 'dr.approachStart':
        this.quistCaptured = false;
        this.quistOutcome = null;
        this.phase = 'approach';
        this.convoy.startApproach();
        return;

      case 'dr.escortStart':
        this.airAndSquads.startEscort();
        return;

      case 'dr.banditsApproach': {
        const count = Number(arg);
        this.convoy.spawnBanditWave('approach', Number.isFinite(count) && count > 0 ? count : 3);
        return;
      }

      case 'dr.wallLoop':
        this.phase = 'wall';
        this.convoy.startWallLoop();
        return;

      case 'dr.sideTruckWest':
        this.convoy.spawnSideGateTruck('west');
        return;

      case 'dr.sideTruckEast':
        this.convoy.spawnSideGateTruck('east');
        return;

      case 'dr.warthogGate':
        this.airAndSquads.strikeMainGate(() => {
          this.setpieces.shatterMainGate();
          this.emitDeferred('dr:gate_breached');
        });
        return;

      case 'dr.dropSquads':
        this.airAndSquads.dropWarrenSquads();
        return;

      case 'dr.dismount':
        this.phase = 'warren';
        this.convoy.dismountAtGate();
        return;

      case 'dr.warrenStart':
        this.phase = 'warren';
        if (!this.setpieces.gateBreached) this.setpieces.shatterMainGate();
        this.placeWarrenMinigun();
        this.airAndSquads.advanceSquads('warren');
        return;

      case 'dr.pumpStart':
        this.phase = 'pump';
        if (!this.setpieces.gateBreached) this.setpieces.shatterMainGate();
        this.setpieces.armWaterTower();
        this.airAndSquads.advanceSquads('pumpyard');
        return;

      case 'dr.planeStart':
        this.phase = 'plane';
        this.quistCaptured = false;
        this.quistOutcome = null;
        this.door1Slammed = false;
        this.door1Opened = false;
        this.door1ClearClock = 0;
        this.door2Slammed = false;
        this.door2Opened = false;
        this.door2ClearClock = 0;
        if (!this.setpieces.gateBreached) this.setpieces.shatterMainGate();
        if (!this.setpieces.towerDropped) this.setpieces.triggerWaterTowerDrop();
        this.setpieces.startPlaneChase(this.makeQuistHooks());
        return;

      case 'dr.planeAdvanceTail':
        this.setpieces.advanceQuistToTail();
        return;

      case 'dr.exfilArrive':
        this.phase = 'exfil_arrive';
        this.convoy.arriveForExfil(this.quistCaptured);
        return;

      case 'dr.exfilChase': {
        this.phase = 'exfil_chase';
        this.convoy.startExfilChase(this.quistCaptured);
        const count = Number(arg);
        this.convoy.spawnBanditWave('exfil', Number.isFinite(count) && count > 0 ? count : 4);
        return;
      }

      case 'dr.endingCutscene':
        this.phase = 'ending';
        if (this.quistCaptured) {
          this.emitOnce('dr:ending_quist_captured');
        }
        this.airAndSquads.startEndingCutscene(
          (out: THREE.Vector3) => this.convoy.getTruckPosition(out),
          this.quistCaptured,
          () => {
            this.emitDeferred('dr:ending_done');
          },
        );
        return;

      default:
        console.warn(`[desertRaid] unknown call "${name}"`);
    }
  }

  private emitDeferred(sig: string): void {
    if (this.emitted.has(sig) || this.deferredSignals.includes(sig)) return;
    this.deferredSignals.push(sig);
  }

  // -----------------------------------------------------------------------------------------------
  // Per-frame Update
  // -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.built) return;

    if (this.deferredSignals.length > 0) {
      const pending = this.deferredSignals.splice(0);
      for (const sig of pending) this.emitOnce(sig);
    }

    this.convoy.update(dt);
    this.airAndSquads.update(dt);
    this.setpieces.update(dt);
    this.saltbloods.update();

    // Sync subsystem state -> mission runner signals (fail-safe against missed emits)
    if (this.phase === 'approach') {
      const pos = this.convoy.getTruckPosition(_v);
      if (pos.z <= DESERT_Z.convoyLoop + 6) {
        this.emitOnce('dr:approach_done');
      }
    }

    if (this.setpieces.gateBreached) {
      this.emitOnce('dr:gate_breached');
    }

    if (this.setpieces.towerDropped) {
      this.emitOnce('dr:tower_dropped');
    }

    if (this.setpieces.quistOutcome && !this.quistOutcome) {
      this.handleQuistOutcome(this.setpieces.quistOutcome);
    }

    // Cargo Plane bulkhead override fail-safe: clearing each compartment always unlocks its slammed door
    if (this.phase === 'plane') {
      if (this.door1Slammed && !this.door1Opened) {
        if (this.countLivingInHull(CARGO_PLANE.door1Z - 0.5, CARGO_PLANE.rampZ + 4) === 0) {
          this.door1ClearClock += dt;
          if (this.door1ClearClock >= 1.0) {
            this.door1Opened = true;
            this.emitOnce('dr:door1_open');
          }
        } else {
          this.door1ClearClock = 0;
        }
      }
      if (this.door2Slammed && !this.door2Opened) {
        if (this.countLivingInHull(CARGO_PLANE.door2Z - 0.5, CARGO_PLANE.door1Z + 0.5) === 0) {
          this.door2ClearClock += dt;
          if (this.door2ClearClock >= 1.0) {
            this.door2Opened = true;
            this.emitOnce('dr:door2_open');
          }
        } else {
          this.door2ClearClock = 0;
        }
      }
    }

    if (this.phase === 'exfil_arrive' && this.convoy.isPlayerBoarded()) {
      this.emitOnce('dr:exfil_boarded');
    }

    if (this.phase === 'exfil_chase') {
      const pos = this.convoy.getTruckPosition(_v);
      if (pos.z >= DESERT_Z.wallLine + 34) {
        this.emitOnce('dr:exfil_clear');
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Lifecycle Cleanup
  // -----------------------------------------------------------------------------------------------

  clear(): void {
    this.phase = 'idle';
    this.emitted.clear();
    this.deferredSignals.length = 0;
    this.directorQueue.length = 0;
    this.directorSpeaking = false;
    this.warrenMinigun = null;
    this.door1Slammed = false;
    this.door1Opened = false;
    this.door1ClearClock = 0;
    this.door2Slammed = false;
    this.door2Opened = false;
    this.door2ClearClock = 0;
    this.quistOutcome = null;

    this.convoy.clear();
    this.airAndSquads.clear();
    this.setpieces.clear();
    this.saltbloods.clear();
  }

  reset(): void {
    this.quistCaptured = false;
    this.clear();
    this.convoy.reset();
    this.airAndSquads.reset();
    this.setpieces.reset();
  }
}
