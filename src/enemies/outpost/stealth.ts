/**
 * Four-state stealth AI brain (Unaware -> Suspicious -> Alert -> Lockdown) with patrol routes,
 * local-squad alerting, alarm-caller interrupt window, corpse discovery, and reusable HUD snapshot.
 *
 * Pure TypeScript / Three.js math only (no WebGL), fully testable in Vitest.
 */
import * as THREE from 'three';
import { CG, type PhysicsSystem, type RayHit } from '../../core/contracts';
import { clamp, wrapAngle } from '../../core/math';
import { effectiveSoundRadius } from './acoustics';

export type StealthState = 'unaware' | 'suspicious' | 'alert' | 'lockdown';

export type PatrolPoint = {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  wait?: number;
};

export type PatrolRoute = {
  points: readonly PatrolPoint[];
  loop?: boolean;
};

export type AlarmCallerState = {
  enemyId: number;
  startedAt: number;
  duration: number;
  targetPanel?: THREE.Vector3;
  mode: 'radio' | 'panel';
};

export type StealthArc = {
  angle: number;
  fill: number;
  state: StealthState;
  callingAlarm: boolean;
};

export type StealthHudSnapshot = {
  globalState: StealthState;
  lightLevel: number;
  arcs: readonly StealthArc[];
  alarmCountdown: number | null;
  lockdown: boolean;
};

export type StealthMoveGoal = 'patrol' | 'investigate' | 'alarm_panel' | 'alarm_radio' | 'combat' | 'idle';

export const STEALTH_TUNING = {
  /** Notice threshold (0..1) that moves an unaware guard into suspicious investigation. */
  suspiciousNotice: 0.35,
  /** Notice threshold (0..1) that escalates a guard to local-squad alert. */
  alertNotice: 1.0,
  /** Seconds a suspicious guard investigates before returning to patrol. */
  investigateSeconds: 7.5,
  /** Horizontal distance in metres considered "arrived" at an investigate point. */
  investigateArriveDist: 1.8,
  /** Horizontal distance in metres considered "arrived" at a patrol waypoint. */
  patrolArriveDist: 1.0,
  /** Radius in metres for local-squad alert propagation (plus same squadId). */
  localSquadRadius: 18,
  /** Distance in metres within which a guard with LOS discovers a corpse. */
  corpseDiscoverRadius: 11,
  /** Horizontal view cone cosine for corpse discovery. */
  corpseFovCos: 0.2,
  /** Seconds between periodic corpse LOS checks in update(). */
  corpseCheckInterval: 0.35,
  /** Maximum distance in metres for an alarm caller to sprint to an active wall panel. */
  alarmPanelRange: 28,
  /** Distance in metres at which an alarm caller presses a wall panel. */
  alarmPanelReach: 1.6,
  /** Assumed sprint speed (m/s) used to estimate panel countdown for HUD. */
  alarmPanelSprintSpeed: 5.5,
  /** Seconds an alarm caller must channel their radio call to trigger lockdown. */
  alarmRadioSeconds: 3.5,
  /** Cooldown in seconds before another squad member can pick up an interrupted alarm call. */
  alarmCallerCooldown: 4.0,
  /** Base sound radius (m) at or above which sounds are treated as loud by default. */
  loudSoundThreshold: 30,
  /** Minimum notice level to emit a directional awareness arc on the HUD. */
  hudArcNoticeThreshold: 0.08,
  /** Default sector radius (m) when a nearby light is extinguished. */
  lightOutSectorRadius: 14,
} as const;

export interface StealthAgent {
  readonly enemyId: number;
  squadId: number;
  tag: string;
  alive: boolean;
  staggered: boolean;
  readonly position: THREE.Vector3;
  yaw: number;
  state: Exclude<StealthState, 'lockdown'>;
  notice: number;
  route: PatrolRoute | null;
  patrolIndex: number;
  patrolDir: 1 | -1;
  patrolWaiting: boolean;
  patrolWait: number;
  hasInvestigateTarget: boolean;
  readonly investigateTarget: THREE.Vector3;
  investigateTimer: number;
  investigateReached: boolean;
  hasLastKnownPos: boolean;
  readonly lastKnownPos: THREE.Vector3;
  lastSeenAt: number;
}

interface CorpseSlot {
  active: boolean;
  discovered: boolean;
  readonly position: THREE.Vector3;
}

const MAX_CORPSES = 32;

const _rayFrom = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _rayHit: RayHit = {
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
  collider: null,
};

function createAgent(enemyId: number, squadId: number, position: THREE.Vector3, yaw: number, tag: string): StealthAgent {
  return {
    enemyId,
    squadId,
    tag,
    alive: true,
    staggered: false,
    position: position.clone(),
    yaw,
    state: 'unaware',
    notice: 0,
    route: null,
    patrolIndex: 0,
    patrolDir: 1,
    patrolWaiting: false,
    patrolWait: 0,
    hasInvestigateTarget: false,
    investigateTarget: new THREE.Vector3(),
    investigateTimer: 0,
    investigateReached: false,
    hasLastKnownPos: false,
    lastKnownPos: new THREE.Vector3(),
    lastSeenAt: -99,
  };
}

export class StealthDirector {
  private readonly agents = new Map<number, StealthAgent>();
  private readonly agentList: StealthAgent[] = [];
  private readonly corpses: CorpseSlot[] = Array.from({ length: MAX_CORPSES }, () => ({
    active: false,
    discovered: false,
    position: new THREE.Vector3(),
  }));
  private corpseCursor = 0;
  private corpseCheckAt = 0;

  private alarmPanels: (() => readonly THREE.Vector3[]) | null = null;
  private readonly callerPanelTarget = new THREE.Vector3();
  private readonly callerObj: AlarmCallerState = {
    enemyId: -1,
    startedAt: 0,
    duration: STEALTH_TUNING.alarmRadioSeconds,
    mode: 'radio',
  };

  /** Reusable HUD snapshot and arc pool (zero per-frame allocations). */
  private readonly arcPool: StealthArc[] = [];
  private readonly arcsOut: StealthArc[] = [];
  private readonly snapshot: {
    globalState: StealthState;
    lightLevel: number;
    arcs: readonly StealthArc[];
    alarmCountdown: number | null;
    lockdown: boolean;
  } = {
    globalState: 'unaware',
    lightLevel: 1,
    arcs: this.arcsOut,
    alarmCountdown: null,
    lockdown: false,
  };

  private clock = 0;
  private alarmCooldownUntil = 0;

  lockdown = false;
  lockdownReason: string | null = null;
  alarmCaller: AlarmCallerState | null = null;

  /** Invoked once when compound Lockdown is triggered. */
  onLockdown: ((reason: string) => void) | null = null;
  /** Invoked when a guard begins calling in an alarm (radio or panel). */
  onAlarmStarted: ((caller: AlarmCallerState) => void) | null = null;
  /** Invoked when an active alarm caller is killed or interrupted before completing the call. */
  onAlarmInterrupted: ((enemyId: number) => void) | null = null;
  /** Invoked when an individual guard transitions between unaware / suspicious / alert. */
  onGuardStateChange: ((agent: StealthAgent, prev: Exclude<StealthState, 'lockdown'>) => void) | null = null;

  reset(): void {
    this.agents.clear();
    this.agentList.length = 0;
    for (let i = 0; i < this.corpses.length; i++) {
      this.corpses[i]!.active = false;
      this.corpses[i]!.discovered = false;
    }
    this.corpseCursor = 0;
    this.corpseCheckAt = 0;
    this.clock = 0;
    this.alarmCooldownUntil = 0;
    this.lockdown = false;
    this.lockdownReason = null;
    this.alarmCaller = null;
    this.arcsOut.length = 0;
  }

  setAlarmPanels(fn: (() => readonly THREE.Vector3[]) | null): void {
    this.alarmPanels = fn;
  }

  get globalState(): StealthState {
    if (this.lockdown) return 'lockdown';
    let best: StealthState = 'unaware';
    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (!a.alive) continue;
      if (a.state === 'alert') return 'alert';
      if (a.state === 'suspicious') best = 'suspicious';
    }
    return best;
  }

  get cooldownRemaining(): number {
    return Math.max(0, this.alarmCooldownUntil - this.clock);
  }

  register(enemyId: number, squadId: number, position: THREE.Vector3, yaw = 0, tag = ''): StealthAgent {
    const existing = this.agents.get(enemyId);
    if (existing) {
      existing.squadId = squadId;
      existing.tag = tag;
      existing.alive = true;
      existing.staggered = false;
      existing.position.copy(position);
      existing.yaw = yaw;
      if (this.lockdown) {
        existing.state = 'alert';
        existing.notice = 1;
      }
      return existing;
    }
    const agent = createAgent(enemyId, squadId, position, yaw, tag);
    if (this.lockdown) {
      agent.state = 'alert';
      agent.notice = 1;
    }
    this.agents.set(enemyId, agent);
    this.agentList.push(agent);
    return agent;
  }

  unregister(enemyId: number, now?: number): void {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    const agent = this.agents.get(enemyId);
    if (!agent) return;
    agent.alive = false;
    agent.notice = 0;
    if (this.alarmCaller && this.alarmCaller.enemyId === enemyId) {
      this.cancelAlarmCaller(t);
    }
    this.agents.delete(enemyId);
    const idx = this.agentList.indexOf(agent);
    if (idx >= 0) this.agentList.splice(idx, 1);
  }

  getAgent(enemyId: number): StealthAgent | undefined {
    return this.agents.get(enemyId);
  }

  assignPatrol(enemyId: number, route: PatrolRoute): boolean {
    const agent = this.agents.get(enemyId);
    if (!agent) return false;
    agent.route = route;
    agent.patrolIndex = 0;
    agent.patrolDir = 1;
    agent.patrolWaiting = false;
    agent.patrolWait = 0;
    return true;
  }

  assignPatrolByTag(tag: string, route: PatrolRoute): number {
    let count = 0;
    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (a.tag === tag || a.tag.startsWith(`${tag}-`)) {
        a.route = route;
        a.patrolIndex = 0;
        a.patrolDir = 1;
        a.patrolWaiting = false;
        a.patrolWait = 0;
        count++;
      }
    }
    return count;
  }

  syncBody(enemyId: number, position: THREE.Vector3, yaw: number, staggered = false): void {
    const agent = this.agents.get(enemyId);
    if (!agent || !agent.alive) return;
    agent.position.copy(position);
    agent.yaw = yaw;
    agent.staggered = staggered;
    if (staggered && this.alarmCaller && this.alarmCaller.enemyId === enemyId) {
      this.cancelAlarmCaller(this.clock);
    }
  }

  /**
   * Synchronizes perception output (`notice` 0..1 and `sees`) into the stealth state machine.
   */
  syncPerception(enemyId: number, notice: number, sees: boolean, playerPos: THREE.Vector3, now?: number): void {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    const agent = this.agents.get(enemyId);
    if (!agent || !agent.alive) return;

    const prevNotice = agent.notice;
    const clamped = clamp(notice, 0, 1);
    agent.notice = clamped;

    if (sees || clamped >= STEALTH_TUNING.alertNotice) {
      agent.lastKnownPos.copy(playerPos);
      agent.hasLastKnownPos = true;
      agent.lastSeenAt = t;
      this.alertGuard(agent, playerPos, t);
      return;
    }

    if (clamped >= STEALTH_TUNING.suspiciousNotice) {
      if (agent.state === 'unaware') {
        this.makeSuspicious(agent, playerPos, t);
      } else if (agent.state === 'suspicious' && clamped > prevNotice) {
        agent.investigateTarget.copy(playerPos);
        agent.hasInvestigateTarget = true;
        agent.investigateTimer = STEALTH_TUNING.investigateSeconds;
        agent.investigateReached = false;
      }
    }
  }

  /**
   * Propagates a sound emitted at `pos` with `baseRadius`. Applies single-ray wall attenuation
   * via `effectiveSoundRadius`. Soft sounds trigger `suspicious` investigation; loud sounds trigger
   * local-squad `alert`. Returns the number of guards that heard the sound.
   */
  hearSound(
    pos: THREE.Vector3,
    baseRadius: number,
    loud: boolean,
    physics: PhysicsSystem | null,
    now?: number,
  ): number {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    if (baseRadius <= 0) return 0;
    const maxR2 = baseRadius * baseRadius;
    let heard = 0;

    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (!a.alive) continue;
      const d2 = a.position.distanceToSquared(pos);
      if (d2 > maxR2) continue;

      const eff = effectiveSoundRadius(physics, pos, a.position, baseRadius);
      if (d2 > eff * eff) continue;

      heard++;
      if (loud) {
        this.alertGuard(a, pos, t);
      } else if (a.state === 'unaware' || a.state === 'suspicious') {
        this.makeSuspicious(a, pos, t);
        if (a.notice < STEALTH_TUNING.suspiciousNotice) a.notice = STEALTH_TUNING.suspiciousNotice;
      } else {
        a.lastKnownPos.copy(pos);
        a.hasLastKnownPos = true;
      }
    }
    return heard;
  }

  /**
   * Called when a light in a sector goes out (shot out or breaker tripped): sends the closest
   * unaware/suspicious guard in that sector to investigate without alerting other squads.
   */
  reportLightOut(pos: THREE.Vector3, sectorRadius = STEALTH_TUNING.lightOutSectorRadius, now?: number): number {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    const r2 = sectorRadius * sectorRadius;
    let best: StealthAgent | null = null;
    let bestD2 = r2;

    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (!a.alive || a.state === 'alert') continue;
      const d2 = a.position.distanceToSquared(pos);
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = a;
      }
    }
    if (!best) return 0;
    this.makeSuspicious(best, pos, t);
    if (best.notice < STEALTH_TUNING.suspiciousNotice) best.notice = STEALTH_TUNING.suspiciousNotice;
    return 1;
  }

  registerCorpse(pos: THREE.Vector3): void {
    const slot = this.corpses[this.corpseCursor]!;
    this.corpseCursor = (this.corpseCursor + 1) % MAX_CORPSES;
    slot.active = true;
    slot.discovered = false;
    slot.position.copy(pos);
  }

  /** Checks whether any living unaware/suspicious guard sees an undiscovered corpse within 11 m in LOS. */
  checkCorpses(physics: PhysicsSystem | null, now?: number): number {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    const maxR2 = STEALTH_TUNING.corpseDiscoverRadius * STEALTH_TUNING.corpseDiscoverRadius;
    let discoveries = 0;

    for (let c = 0; c < this.corpses.length; c++) {
      const corpse = this.corpses[c]!;
      if (!corpse.active || corpse.discovered) continue;

      for (let i = 0; i < this.agentList.length; i++) {
        const a = this.agentList[i]!;
        if (!a.alive || a.state === 'alert') continue;

        const dx = corpse.position.x - a.position.x;
        const dz = corpse.position.z - a.position.z;
        const dy = corpse.position.y - a.position.y;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxR2) continue;

        const flat = Math.hypot(dx, dz) || 1;
        const facing = (dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw)) / flat;
        if (flat > 2.5 && facing <= STEALTH_TUNING.corpseFovCos) continue;

        if (physics) {
          _rayFrom.set(a.position.x, a.position.y + 1.5, a.position.z);
          _rayDir.set(corpse.position.x - _rayFrom.x, corpse.position.y + 0.4 - _rayFrom.y, corpse.position.z - _rayFrom.z);
          const dist = _rayDir.length();
          if (dist > 0.1) {
            _rayDir.multiplyScalar(1 / dist);
            _rayHit.distance = 0;
            if (physics.raycastInto(_rayFrom, _rayDir, dist - 0.05, CG.World, _rayHit)) continue;
          }
        }

        corpse.discovered = true;
        discoveries++;
        this.alertGuard(a, corpse.position, t);
        break;
      }
    }
    return discoveries;
  }

  /** Non-lethal hit immediately alerts the guard and their local squad. */
  onGuardDamaged(enemyId: number, threatPos: THREE.Vector3, now?: number): void {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    const agent = this.agents.get(enemyId);
    if (!agent || !agent.alive) return;
    this.alertGuard(agent, threatPos, t);
  }

  /** Staggering/concussing an active alarm caller interrupts their call and starts the 4.0 s cooldown. */
  onGuardStaggered(enemyId: number, now?: number): void {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    const agent = this.agents.get(enemyId);
    if (agent) agent.staggered = true;
    if (this.alarmCaller && this.alarmCaller.enemyId === enemyId) {
      this.cancelAlarmCaller(t);
    }
  }

  /** Killing an active alarm caller prevents Lockdown and starts the 4.0 s cooldown. */
  onGuardKilled(enemyId: number, now?: number): void {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    const agent = this.agents.get(enemyId);
    if (agent) {
      agent.alive = false;
      agent.notice = 0;
    }
    if (this.alarmCaller && this.alarmCaller.enemyId === enemyId) {
      this.cancelAlarmCaller(t);
    }
  }

  /** Explicitly interrupts the current alarm caller (if any), preventing Lockdown and starting the 4.0 s cooldown. */
  interruptAlarm(now?: number): boolean {
    const t = now !== undefined ? (this.clock = now) : this.clock;
    if (!this.alarmCaller) return false;
    this.cancelAlarmCaller(t);
    return true;
  }

  /** Escalates the entire compound to permanent Lockdown (from completed alarm call, camera, or external trigger). */
  triggerLockdown(reason = 'alarm'): void {
    if (this.lockdown) return;
    this.lockdown = true;
    this.lockdownReason = reason;
    this.alarmCaller = null;

    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (!a.alive) continue;
      const prev = a.state;
      a.state = 'alert';
      a.notice = 1;
      a.hasInvestigateTarget = false;
      if (prev !== 'alert') this.onGuardStateChange?.(a, prev);
    }
    this.onLockdown?.(reason);
  }

  /** True if Lockdown is active or at least one living member of `squadId` is in `alert`. */
  isSquadAlert(squadId: number): boolean {
    if (this.lockdown) return true;
    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (a.alive && a.squadId === squadId && a.state === 'alert') return true;
    }
    return false;
  }

  /** Writes the guard's current movement target into `outPos` and returns their active movement goal. */
  getDesiredMove(enemyId: number, outPos: THREE.Vector3): StealthMoveGoal {
    const a = this.agents.get(enemyId);
    if (!a || !a.alive) return 'idle';

    if (this.alarmCaller && this.alarmCaller.enemyId === enemyId) {
      if (this.alarmCaller.mode === 'panel' && this.alarmCaller.targetPanel) {
        outPos.copy(this.alarmCaller.targetPanel);
        return 'alarm_panel';
      }
      outPos.copy(a.position);
      return 'alarm_radio';
    }

    if (this.lockdown || a.state === 'alert') {
      if (a.hasLastKnownPos) outPos.copy(a.lastKnownPos);
      else outPos.copy(a.position);
      return 'combat';
    }

    if (a.state === 'suspicious' && a.hasInvestigateTarget) {
      outPos.copy(a.investigateTarget);
      return 'investigate';
    }

    if (a.route && a.route.points.length > 0) {
      const pt = a.route.points[a.patrolIndex]!;
      outPos.set(pt.x, pt.y, pt.z);
      return a.patrolWaiting ? 'idle' : 'patrol';
    }

    return 'idle';
  }

  /** Optional facing yaw for an idle patrolling guard waiting at a waypoint. */
  getDesiredYaw(enemyId: number): number | null {
    const a = this.agents.get(enemyId);
    if (!a || !a.alive || a.state !== 'unaware' || !a.route || a.route.points.length === 0) return null;
    if (!a.patrolWaiting) return null;
    const pt = a.route.points[a.patrolIndex]!;
    return pt.yaw !== undefined ? pt.yaw : null;
  }

  /** Advances patrol timers, investigation expiry, corpse discovery checks, and alarm caller progress. */
  update(dt: number, now?: number, physics: PhysicsSystem | null = null): void {
    const t = now !== undefined ? (this.clock = now) : (this.clock += dt);

    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (!a.alive) continue;

      if (a.state === 'unaware') {
        this.tickPatrol(a, dt);
      } else if (a.state === 'suspicious') {
        if (a.hasInvestigateTarget) {
          const dx = a.investigateTarget.x - a.position.x;
          const dz = a.investigateTarget.z - a.position.z;
          if (dx * dx + dz * dz <= STEALTH_TUNING.investigateArriveDist * STEALTH_TUNING.investigateArriveDist) {
            a.investigateReached = true;
          }
        }
        a.investigateTimer -= dt;
        if (a.investigateTimer <= 0) {
          const prev = a.state;
          a.state = 'unaware';
          a.hasInvestigateTarget = false;
          a.investigateReached = false;
          a.investigateTimer = 0;
          a.notice = Math.min(a.notice, 0.05);
          this.onGuardStateChange?.(a, prev);
        }
      }
    }

    if (t >= this.corpseCheckAt) {
      this.corpseCheckAt = t + STEALTH_TUNING.corpseCheckInterval;
      this.checkCorpses(physics, t);
    }

    this.tickAlarmCaller(t);
  }

  /**
   * Fills and returns a reusable `StealthHudSnapshot` with directional awareness arcs relative
   * to the player's heading (`0 = ahead`, `+PI/2 = right`, `-PI/2 = left`, `±PI = behind`).
   */
  getSnapshot(playerPos: THREE.Vector3, playerYaw: number, lightLevel: number): StealthHudSnapshot {
    this.arcsOut.length = 0;
    let poolIdx = 0;
    let globalState: StealthState = this.lockdown ? 'lockdown' : 'unaware';
    const callerId = this.alarmCaller ? this.alarmCaller.enemyId : -1;

    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (!a.alive) continue;

      if (!this.lockdown) {
        if (a.state === 'alert') globalState = 'alert';
        else if (a.state === 'suspicious' && globalState === 'unaware') globalState = 'suspicious';
      }

      if (a.notice <= STEALTH_TUNING.hudArcNoticeThreshold && a.state === 'unaware') continue;

      let arc = this.arcPool[poolIdx];
      if (!arc) {
        arc = { angle: 0, fill: 0, state: 'unaware', callingAlarm: false };
        this.arcPool.push(arc);
      }
      poolIdx++;

      const dx = a.position.x - playerPos.x;
      const dz = a.position.z - playerPos.z;
      arc.angle = wrapAngle(Math.atan2(dx, -dz) + playerYaw);
      arc.fill = clamp(this.lockdown || a.state === 'alert' ? 1 : a.notice, 0, 1);
      arc.state = this.lockdown ? 'lockdown' : a.state;
      arc.callingAlarm = a.enemyId === callerId;
      this.arcsOut.push(arc);
    }

    let alarmCountdown: number | null = null;
    if (this.alarmCaller && !this.lockdown) {
      if (this.alarmCaller.mode === 'radio') {
        alarmCountdown = Math.max(0, this.alarmCaller.duration - (this.clock - this.alarmCaller.startedAt));
      } else if (this.alarmCaller.targetPanel) {
        const caller = this.agents.get(this.alarmCaller.enemyId);
        if (caller) {
          const dist = Math.hypot(
            this.alarmCaller.targetPanel.x - caller.position.x,
            this.alarmCaller.targetPanel.z - caller.position.z,
          );
          alarmCountdown = Math.max(0, dist / STEALTH_TUNING.alarmPanelSprintSpeed);
        }
      }
    }

    this.snapshot.globalState = globalState;
    this.snapshot.lightLevel = clamp(lightLevel, 0, 1);
    this.snapshot.arcs = this.arcsOut;
    this.snapshot.alarmCountdown = alarmCountdown;
    this.snapshot.lockdown = this.lockdown;
    return this.snapshot;
  }

  // -------------------------------------------------------------------------------------------
  // Internal transitions
  // -------------------------------------------------------------------------------------------

  private makeSuspicious(agent: StealthAgent, targetPos: THREE.Vector3, _now: number): void {
    if (agent.state === 'alert') return;
    const prev = agent.state;
    agent.state = 'suspicious';
    agent.investigateTarget.copy(targetPos);
    agent.hasInvestigateTarget = true;
    agent.investigateTimer = STEALTH_TUNING.investigateSeconds;
    agent.investigateReached = false;
    if (prev !== 'suspicious') this.onGuardStateChange?.(agent, prev);
  }

  private alertGuard(source: StealthAgent, threatPos: THREE.Vector3, now: number): void {
    const localR2 = STEALTH_TUNING.localSquadRadius * STEALTH_TUNING.localSquadRadius;
    const squadId = source.squadId;

    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i]!;
      if (!a.alive) continue;
      const inLocalSquad = a === source || a.squadId === squadId || a.position.distanceToSquared(source.position) <= localR2;
      if (!inLocalSquad) continue;

      const prev = a.state;
      a.state = 'alert';
      a.notice = 1;
      a.hasInvestigateTarget = false;
      a.investigateTimer = 0;
      a.hasLastKnownPos = true;
      a.lastKnownPos.copy(threatPos);
      if (prev !== 'alert') this.onGuardStateChange?.(a, prev);
    }

    if (!this.lockdown) {
      this.maybeAssignAlarmCaller(squadId, now);
    }
  }

  private tickPatrol(a: StealthAgent, dt: number): void {
    const route = a.route;
    if (!route || route.points.length === 0) return;

    const pt = route.points[a.patrolIndex]!;
    const dx = pt.x - a.position.x;
    const dz = pt.z - a.position.z;
    const arrived = dx * dx + dz * dz <= STEALTH_TUNING.patrolArriveDist * STEALTH_TUNING.patrolArriveDist;
    if (!arrived) return;

    if (!a.patrolWaiting) {
      a.patrolWaiting = true;
      a.patrolWait = pt.wait ?? 0;
      if (a.patrolWait > 0) return;
    } else if (a.patrolWait > 0) {
      a.patrolWait = Math.max(0, a.patrolWait - dt);
      if (a.patrolWait > 0) return;
    }

    // Advance waypoint
    const len = route.points.length;
    if (len > 1) {
      if (route.loop !== false) {
        a.patrolIndex = (a.patrolIndex + 1) % len;
      } else {
        const next = a.patrolIndex + a.patrolDir;
        if (next >= len || next < 0) {
          a.patrolDir = a.patrolDir === 1 ? -1 : 1;
          a.patrolIndex = clamp(a.patrolIndex + a.patrolDir, 0, len - 1);
        } else {
          a.patrolIndex = next;
        }
      }
      a.patrolWaiting = false;
    }
  }

  private maybeAssignAlarmCaller(preferredSquadId: number, now: number): void {
    if (this.lockdown || this.alarmCaller !== null || now < this.alarmCooldownUntil) return;

    const panels = this.alarmPanels?.() ?? null;
    const panelRange2 = STEALTH_TUNING.alarmPanelRange * STEALTH_TUNING.alarmPanelRange;

    let chosenPanelGuardId = -1;
    let chosenPanel: THREE.Vector3 | null = null;
    let bestPanelD2 = panelRange2;
    let fallbackRadioGuardId = -1;

    // First pass: prefer guards in `preferredSquadId`; if none eligible, fall back to any alert guard.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.agentList.length; i++) {
        const a = this.agentList[i]!;
        if (!a.alive || a.staggered || a.state !== 'alert') continue;
        if (pass === 0 && a.squadId !== preferredSquadId) continue;

        if (fallbackRadioGuardId < 0) fallbackRadioGuardId = a.enemyId;

        if (panels && panels.length > 0) {
          for (let p = 0; p < panels.length; p++) {
            const panel = panels[p]!;
            const d2 = a.position.distanceToSquared(panel);
            if (d2 <= bestPanelD2) {
              bestPanelD2 = d2;
              chosenPanelGuardId = a.enemyId;
              chosenPanel = panel;
            }
          }
        }
      }
      if (chosenPanelGuardId >= 0 || fallbackRadioGuardId >= 0) break;
    }

    if (chosenPanelGuardId >= 0 && chosenPanel) {
      this.callerPanelTarget.copy(chosenPanel);
      this.callerObj.enemyId = chosenPanelGuardId;
      this.callerObj.startedAt = now;
      this.callerObj.duration = Math.max(0.5, Math.sqrt(bestPanelD2) / STEALTH_TUNING.alarmPanelSprintSpeed);
      this.callerObj.targetPanel = this.callerPanelTarget;
      this.callerObj.mode = 'panel';
      this.alarmCaller = this.callerObj;
      this.onAlarmStarted?.(this.alarmCaller);
      return;
    }

    if (fallbackRadioGuardId >= 0) {
      this.callerObj.enemyId = fallbackRadioGuardId;
      this.callerObj.startedAt = now;
      this.callerObj.duration = STEALTH_TUNING.alarmRadioSeconds;
      this.callerObj.targetPanel = undefined;
      this.callerObj.mode = 'radio';
      this.alarmCaller = this.callerObj;
      this.onAlarmStarted?.(this.alarmCaller);
    }
  }

  private cancelAlarmCaller(now: number): void {
    if (!this.alarmCaller) return;
    const enemyId = this.alarmCaller.enemyId;
    this.alarmCaller = null;
    this.alarmCooldownUntil = now + STEALTH_TUNING.alarmCallerCooldown;
    this.onAlarmInterrupted?.(enemyId);
  }

  private tickAlarmCaller(now: number): void {
    if (this.lockdown) {
      this.alarmCaller = null;
      return;
    }

    if (this.alarmCaller) {
      const caller = this.agents.get(this.alarmCaller.enemyId);
      if (!caller || !caller.alive || caller.staggered) {
        this.cancelAlarmCaller(now);
        return;
      }

      if (this.alarmCaller.mode === 'radio') {
        if (now - this.alarmCaller.startedAt >= this.alarmCaller.duration) {
          this.alarmCaller = null;
          this.triggerLockdown('radio');
        }
      } else if (this.alarmCaller.targetPanel) {
        const dx = this.alarmCaller.targetPanel.x - caller.position.x;
        const dz = this.alarmCaller.targetPanel.z - caller.position.z;
        if (dx * dx + dz * dz <= STEALTH_TUNING.alarmPanelReach * STEALTH_TUNING.alarmPanelReach) {
          this.alarmCaller = null;
          this.triggerLockdown('panel');
        }
      }
      return;
    }

    // No active caller — if cooldown elapsed and an alert guard is still alive, pick up the call.
    if (now >= this.alarmCooldownUntil) {
      for (let i = 0; i < this.agentList.length; i++) {
        const a = this.agentList[i]!;
        if (a.alive && !a.staggered && a.state === 'alert') {
          this.maybeAssignAlarmCaller(a.squadId, now);
          break;
        }
      }
    }
  }
}
