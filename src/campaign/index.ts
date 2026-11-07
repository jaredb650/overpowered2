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
import type { CampaignSystem, MissionResult } from './events';
import './events';
import { GameHost } from './host';
import { CampaignHud } from './hud';
import { MISSIONS } from './missions';
import { MissionRunner } from './runner';
import { MISSION_ID, START_BEAT } from './select';
import type { MissionHost } from './types';
import { validateMission } from './validate';

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

class Campaign implements CampaignSystem {
  readonly active = true;
  readonly runner: MissionRunner;
  private readonly ui: CampaignHud;
  private readonly host: GameHost;
  /** Set between a run being rebuilt and its first frame, when every other system has finished clearing itself. */
  private opening: 'fresh' | 'redeploy' | null = null;
  private banked: ReturnType<GameHost['bank']> | null = null;
  private vehicles = 0;
  result: MissionResult | null = null;

  constructor(private readonly ctx: Ctx, id: string) {
    const mission = MISSIONS[id];
    if (!mission) throw new Error(`no mission ${id}`);
    for (const problem of validateMission(mission)) console.warn(`[campaign] ${mission.id}: ${problem}`);
    this.ui = new CampaignHud(ctx);
    this.host = new GameHost(ctx, this.ui);
    this.runner = new MissionRunner(mission, this.host);
    this.host.runner = this.runner;
  }

  init(): void {
    const { events } = this.ctx;
    document.querySelector('.hud')?.append(this.ui.el);
    document.querySelector('.hud .col-left > :first-child')?.after(this.ui.objectiveList);
    events.on('run:start', () => {
      this.opening ??= 'fresh';
    });
    events.on('player:died', () => this.runner.down());
    events.on('vehicle:destroyed', () => {
      this.vehicles++;
    });
    events.on('campaign:complete', () => this.complete());
    events.on('game:state', e => this.ui.setPaused(e.to !== 'playing'));
    const page = (window as unknown as { __op2?: { campaign?: unknown } }).__op2;
    if (page) page.campaign = this;
  }

  provide(parts: Partial<MissionHost>): void {
    Object.assign(this.host, parts);
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
    (window as unknown as { __op2: { game: GameHandle } }).__op2.game.newRun();
    return true;
  }

  restart(): boolean {
    this.runner.down();
    return this.redeploy();
  }

  /** A test that started halfway has beaten nothing. */
  private complete(): void {
    const { runner, vehicles } = this;
    const { mission, elapsed, deaths } = runner;
    this.result = { title: mission.title, seconds: elapsed, deaths, vehicles, unlocked: mission.unlocks === true && !START_BEAT && recordCampaignBeaten() };
  }

  update(): void {
    const dt = this.ctx.time.dt;
    if (this.opening) this.open();
    this.host.update(dt);
    this.runner.update(dt);
    this.ui.beat(this.runner.beat?.title ?? '');
    this.ui.update(this.ctx.time.realDt);
  }

  private open(): void {
    const redeploying = this.opening === 'redeploy';
    this.opening = null;
    this.host.clear();
    this.ui.reset();
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
    this.ui.reset();
  }
}

export function createCampaign(ctx: Ctx): CampaignSystem {
  return MISSION_ID ? new Campaign(ctx, MISSION_ID) : new Idle();
}
