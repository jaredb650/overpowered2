/**
 * The campaign: a mission played as data over the game's own systems. Game.ts finds `createCampaign` by convention. On a page with no
 * mission this builds nothing and costs an empty call a frame.
 *
 *   types.ts        what a mission is made of
 *   runner.ts       plays one, touching only MissionHost
 *   watch.ts        triggers
 *   validate.ts     checks a mission for dangling names, before anyone plays it
 *   host.ts         MissionHost on the real game
 *   doors.ts, racks.ts, cutscene.ts, hud.ts   the parts of the host that are new
 *   missions/       the missions
 *
 * docs/campaign/MISSION.md has the plan, the map and how to use this.
 */
import type { Ctx } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { recordCampaignBeaten } from '../contracts/unlocks';
import { selectedStarter } from '../contracts/starter';
import { missionWithStarter } from './starter';
import { GoreTuning } from '../gore';
import type { CampaignSystem, MissionResult } from './events';
import './events';
import { Chancery } from './chancery';
import { Foreclosure } from './foreclosure';
import { GameHost } from './host';
import { CampaignHud } from './hud';
import { MISSIONS } from './missions';
import { Retraining } from './retraining';
import { MissionRunner } from './runner';
import { MISSION_ID, START_BEAT } from './select';
import type { MissionHost } from './types';
import { validateMission } from './validate';
import { isGuest } from '../core/coop';

export type { CampaignSystem } from './events';

/** Starts the next run. Game publishes itself after the systems are built, so it is read when needed. */
interface GameHandle {
  newRun(): void;
}

class Idle implements CampaignSystem {
  readonly active = false;
  readonly runner = null;
  readonly returning = false;
  readonly result = null;
  readonly talking = false;
  provide(): void {}
  signal(): void {}
  unitGone(): void {}
  enlist(): void {}
  redeploy(): boolean {
    return false;
  }
  restart(): boolean {
    return false;
  }
}

/** What co-op reaches a running campaign through (net/mission.ts): its host and HUD, and the two steps of a team's checkpoint. */
export type { Campaign };

class Campaign implements CampaignSystem {
  readonly active = true;
  readonly runner: MissionRunner;
  readonly ui: CampaignHud;
  readonly host: GameHost;
  /** Set between a run being rebuilt and its first frame, when every other system has finished clearing itself. */
  private opening: 'fresh' | 'redeploy' | null = null;
  private banked: ReturnType<GameHost['bank']> | null = null;
  private vehicles = 0;
  /** The tutorial's own parts (retraining.ts), on its page only. */
  private readonly retraining: Retraining | null = null;
  /** Foreclosure's set pieces (foreclosure.ts): FlakTower, Old Mother, Slip wreck/boot, sappers, surrender. */
  private readonly foreclosure: Foreclosure | null = null;
  /** Quiet Title's Chancery Estate runtime director (chancery.ts): stealth systems, Vane, bunker breach, QRF. */
  private readonly chancery: Chancery | null = null;
  result: MissionResult | null = null;

  constructor(private readonly ctx: Ctx, id: string) {
    const source = MISSIONS[id];
    const mission = source && (id === 'outpost' || id === 'foreclosure' ? missionWithStarter(source, selectedStarter(id === 'outpost' ? 'campaign' : 'foreclosure')) : source);
    if (!mission) throw new Error(`no mission ${id}`);
    for (const problem of validateMission(mission)) console.warn(`[campaign] ${mission.id}: ${problem}`);
    this.ui = new CampaignHud(ctx);
    this.host = new GameHost(ctx, this.ui, mission.calls, mission.fronts);
    this.runner = new MissionRunner(mission, this.host);
    this.host.runner = this.runner;
    if (mission.id === 'retraining') {
      const tut = (this.retraining = new Retraining(ctx, this.runner, this.ui));
      const call = this.host.call.bind(this.host);
      this.host.call = (name, arg) => (name.startsWith('tut.') ? tut.call(name, arg) : call(name, arg));
    } else if (mission.id === 'foreclosure') {
      const fc = (this.foreclosure = new Foreclosure(ctx, this.runner, this.ui));
      this.host.foreclosureCall = (name, arg) => fc.call(name, arg);
    } else if (mission.id === 'quiet_title') {
      const ch = (this.chancery = new Chancery(ctx, this.runner, this.ui));
      this.host.chanceryCall = (name, arg) => ch.call(name, arg);
    }
    // A mission with Bailiffs in it (Foreclosure) loads their bodies now; on a cold load its first squad would land in enemy bodies.
    if (/"do":"(roster|battle)"/.test(JSON.stringify(mission.beats))) void ctx.allies?.preload();
  }

  init(): void {
    const { events } = this.ctx;
    document.querySelector('.hud')?.append(this.ui.el);
    document.querySelector('.hud .col-left > :first-child')?.after(this.ui.objectiveList);
    events.on('run:start', () => {
      this.opening ??= 'fresh';
    });
    // Co-op: one player down is the team's to revive; only everyone down goes back to the checkpoint (net/team.ts).
    events.on('player:died', () => { if (!this.ctx.coop?.world) this.runner.down(); });
    events.on('vehicle:destroyed', () => {
      this.vehicles++;
    });
    events.on('campaign:complete', () => this.complete());
    // Co-op: a menu over the live world stops nothing, so the radio keeps time with the other screens.
    events.on('game:state', e => this.ui.setPaused(e.to !== 'playing' && !(e.to === 'paused' && this.ctx.coop)));
    const page = (window as unknown as { __op2?: { campaign?: unknown } }).__op2;
    if (page) page.campaign = this;
  }

  provide(parts: Partial<MissionHost>): void {
    Object.assign(this.host, parts);
    if (parts.frame && this.foreclosure) this.foreclosure.wrapFrame(this.host);
  }

  signal(name: string): void {
    this.runner.signal(name);
  }

  unitGone(tag: string, killed: boolean, source: string): void {
    this.runner.unitGone(tag, killed, source);
  }

  enlist(body: EnemyInstance, tag: string): void {
    this.host.enlist(body, tag);
  }

  get returning(): boolean {
    return this.opening === 'redeploy';
  }

  get talking(): boolean {
    return this.ui.talking;
  }

  redeploy(): boolean {
    if (this.runner.state !== 'down') return false;
    this.banked = this.host.bank();
    this.opening = 'redeploy';
    // Co-op: every screen rebuilds its run with the host's (net/mission.ts), before the host's own.
    this.ctx.coop?.world?.mission.restarting();
    (window as unknown as { __op2: { game: GameHandle } }).__op2.game.newRun();
    return true;
  }

  /**
   * Co-op, on a guest: the host has taken the team back to a checkpoint. This screen's run is rebuilt the way the host's is, with
   * the Council's cut out of this player's own score, and the mission host is cleared now, not on the next frame, so that what the
   * host mirrors next (doors, objectives, the kit) lands on a clean one.
   */
  follow(): void {
    this.banked = this.host.bank();
    this.opening = 'redeploy';
    (window as unknown as { __op2: { game: GameHandle } }).__op2.game.newRun();
    if (this.opening) this.open();
  }

  /** The mission's numbers so far, as the complete screen and the co-op board show them. */
  tally(): MissionResult {
    const { mission, elapsed, deaths } = this.runner;
    return { title: mission.title, seconds: elapsed, deaths, vehicles: this.vehicles, unlocked: false };
  }

  restart(): boolean {
    this.runner.down();
    return this.redeploy();
  }

  /** A test that started halfway has beaten nothing. */
  private complete(): void {
    const { mission } = this.runner;
    this.result = { ...this.tally(), unlocked: mission.unlocks === true && !START_BEAT && recordCampaignBeaten() };
  }

  update(): void {
    const dt = this.ctx.time.dt;
    if (this.opening) this.open();
    this.host.update(dt);
    this.retraining?.update(dt);
    this.foreclosure?.update(dt);
    this.chancery?.update(dt);
    this.runner.update(dt);
    this.ui.beat(this.runner.beat?.title ?? '');
    this.ui.update(this.ctx.time.realDt);
  }

  private open(): void {
    const redeploying = this.opening === 'redeploy';
    this.opening = null;
    this.host.clear();
    this.retraining?.clear();
    this.foreclosure?.ensureBuilt();
    this.foreclosure?.clear();
    this.chancery?.ensureBuilt();
    this.chancery?.clear();
    this.ui.reset();
    // A co-op guest's mission is the host's (net/mission.ts): its own runner never starts.
    if (isGuest(this.ctx)) {
      if (redeploying && this.banked) this.ctx.progression.resume(this.banked.score, this.banked.kills, this.banked.headshots);
      return;
    }
    // shortcut: a mission's corpse cap under the gore setting's, applied each run; a settings change mid-run lifts it until the next.
    const { corpses } = this.runner.mission;
    if (corpses !== undefined) GoreTuning.maxCorpses = Math.min(GoreTuning.maxCorpses, corpses);
    if (redeploying) {
      const { score, kills, headshots } = this.banked!;
      this.ctx.progression.resume(score, kills, headshots);
      this.runner.redeploy();
    } else {
      this.vehicles = 0;
      this.result = null;
      this.runner.start(START_BEAT);
    }
  }

  reset(): void {
    this.runner.hush();
    this.host.clear();
    this.retraining?.clear();
    this.foreclosure?.clear();
    this.chancery?.reset();
    this.ui.reset();
  }
}

export function createCampaign(ctx: Ctx): CampaignSystem {
  return MISSION_ID ? new Campaign(ctx, MISSION_ID) : new Idle();
}
