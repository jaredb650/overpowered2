/**
 * Root of the HUD and menus.
 *
 * Owns the run's UI flow, because Game.ts only knows states: splash to menu, menu to run, pausing on lost pointer
 * lock, the death beat, and game over. Widgets are plain objects updated from one HudState read per frame; anything
 * that can run on realDt does, so hit-stop and slow-mo never stutter the interface.
 */
import * as THREE from 'three';
import type { Ctx, GameState } from '../core/contracts';
import type { HudSystem, PickupKind } from '../core/gameplay';
import { div } from './dom';
import { HudState } from './state';
import { RunReport } from './runreport';
import { applyQuality, applySettings, loadSettings, type Settings } from './settings';
import { CALLINS, WEAPONS, sourceName } from './data';
import { pickupColor } from './icons';
import { Vitals } from './hud/vitals';
import { Arms } from './hud/arms';
import { Tach } from './hud/tach';
import { Tally } from './hud/tally';
import { Combo } from './hud/combo';
import { Perks } from './hud/perks';
import { CallIns } from './hud/callins';
import { KillFeed, StyleLane } from './hud/feed';
import { Crosshair, type HitKind } from './hud/crosshair';
import { WorldLayer } from './hud/worldlayer';
import { BossBar } from './hud/boss';
import { Banner } from './hud/banner';
import { LowFrame, Scope, Targeting } from './hud/overlays';
import { DebugOverlays } from './hud/debug';
import { Minimap, type MinimapPoint } from './hud/minimap';
import { Scoreboard } from './hud/scoreboard';
import { Stragglers } from './hud/stragglers';
import { Screens, type ScreenName } from './screens/Screens';
import { Flythrough } from './screens/flythrough';
import { isTitanWave } from '../enemies/waves';

/** What the HUD needs from core/Game.ts. Read lazily, because Game publishes itself after systems are built. */
export interface GameHost {
  state: GameState;
  setState(to: GameState): void;
  newRun(): void;
  clearRun(): void;
}

interface PickupSource {
  pickups?: readonly { kind: PickupKind; position: THREE.Vector3; active?: boolean }[];
}

/** Long enough to see what killed you, short enough to still be angry about it. */
const DEATH_BEAT = 1.5;
/** Chrome refuses a lock for about 1.25 s after Esc, so a resume keeps asking for a little longer than that. */
const LOCK_RETRY_FOR = 1.7;
const LOCK_RETRY_EVERY = 0.3;
/** A burst of fire or a jump press at the moment of death must not land on Run again before the report is read. */
const GAME_OVER_HOLD = 0.8;

export class Hud implements HudSystem {
  readonly state = new HudState();
  readonly settings: Settings = loadSettings();
  readonly report: RunReport;
  readonly screens: Screens;

  private root: HTMLElement;
  private hud: HTMLElement;
  private vitals: Vitals;
  private arms: Arms;
  private tach: Tach;
  private tally: Tally;
  private combo: Combo;
  private perks: Perks;
  private callIns: CallIns;
  private feedLane: KillFeed;
  private styleLane: StyleLane;
  private crosshair: Crosshair;
  private worldLayer: WorldLayer;
  private boss: BossBar;
  private bannerLanes: Banner;
  private scope: Scope;
  private targeting: Targeting;
  private lowFrame: LowFrame;
  private debug: DebugOverlays;
  private minimap: Minimap;
  private scoreboard: Scoreboard;
  private stragglers: Stragglers;
  private flythrough: Flythrough;

  private pickupPoints: MinimapPoint[] = [];
  private deathClock = 0;
  private pauseGuard = 0;
  private lockClock = 0;
  private lockRetry = 0;
  private lockAfter: 'run' | 'resume' | null = null;
  /** True while the last frame saw the lock, so any way of losing it can be noticed. */
  private lockHeld = false;
  private lockEverHeld = false;

  constructor(private readonly ctx: Ctx) {
    this.report = new RunReport(ctx);
    this.root = document.getElementById('ui') ?? document.body.appendChild(div());
    this.root.classList.add('op');

    this.worldLayer = new WorldLayer(ctx);
    this.stragglers = new Stragglers(this.worldLayer);
    this.vitals = new Vitals();
    this.arms = new Arms(ctx);
    this.tach = new Tach();
    this.tally = new Tally();
    this.combo = new Combo();
    this.perks = new Perks();
    this.callIns = new CallIns(ctx);
    this.feedLane = new KillFeed();
    this.styleLane = new StyleLane();
    this.crosshair = new Crosshair(ctx);
    this.boss = new BossBar();
    this.bannerLanes = new Banner();
    this.scope = new Scope(ctx, this.settings);
    this.targeting = new Targeting(ctx);
    this.lowFrame = new LowFrame();
    this.debug = new DebugOverlays(ctx);
    this.minimap = new Minimap(ctx, this.worldLayer);
    this.scoreboard = new Scoreboard(this.report);

    this.hud = div('hud',
      this.lowFrame.el,
      this.worldLayer.el,
      this.scope.el,
      this.targeting.el,
      this.crosshair.el,
      div('col-left',
        this.tally.el,
        this.perks.el,
        div('fill'),
        this.callIns.el,
        this.vitals.el,
      ),
      div('col-right',
        this.minimap.el,
        this.feedLane.el,
        this.combo.el,
        this.styleLane.el,
        div('fill'),
        this.arms.el,
      ),
      this.tach.el,
      this.boss.el,
      this.bannerLanes.el,
      this.scoreboard.el,
      this.debug.el,
    );
    this.hud.style.display = 'none';
    this.root.append(this.hud);

    this.flythrough = new Flythrough(ctx);
    this.screens = new Screens(ctx, this, this.settings);
    this.root.append(this.screens.el);
    this.screens.show('loading');

    addEventListener('resize', this.onResize);
  }

  /** Game.ts publishes itself on window once systems exist. Sandboxes publish a stand-in the same way. */
  get game(): GameHost | null {
    return (window as unknown as { __op2?: { game?: GameHost } }).__op2?.game ?? null;
  }

  private onResize = (): void => {
    this.worldLayer.measure();
    this.minimap.measure();
  };

  init(): void {
    const { events } = this.ctx;
    events.on('game:state', e => this.onState(e.from, e.to));
    events.on('run:start', () => this.onRunStart());
    events.on('player:damaged', e => {
      this.vitals.hit(e.amount);
      this.crosshair.damaged(e.amount, e.from);
    });
    events.on('player:died', () => this.onDeath());
    events.on('weapon:fired', () => this.crosshair.fired());
    events.on('weapon:unlocked', e => {
      this.arms.unlocked(e.weapon);
      this.arms.invalidate();
      this.bannerLanes.stamp(WEAPONS[e.weapon].name.toUpperCase(), `slot ${WEAPONS[e.weapon].key} unlocked`, 'var(--hot)');
    });
    events.on('wave:start', e => this.onWaveStart(e.wave, e.total, e.boss));
    events.on('wave:clear', e => this.onWaveClear(e.wave, e.bonus));
    events.on('callin:ready', e => {
      const info = CALLINS[e.id];
      this.bannerLanes.stamp(`${info.name.toUpperCase()} READY`, `press ${this.keyLabel(info.action)}`, info.color);
    });
    events.on('score:gain', e => {
      if (e.reason === 'kill' || e.reason === 'wave') return;
      this.styleLane.push(`+${e.points.toLocaleString('en-US')} ${e.reason}`, undefined);
    });
    applySettings(this.ctx, this.settings);
    applyQuality(this.ctx, this.settings);
  }

  private keyLabel(action: Parameters<Ctx['input']['isDown']>[0]): string {
    const input = this.ctx.input as unknown as { labelFor?: (a: string) => unknown };
    const label = typeof input.labelFor === 'function' ? input.labelFor(action) : '';
    return typeof label === 'string' ? label : '';
  }

  private onState(_from: GameState, to: GameState): void {
    // The HUD hides for pause too: the stats table must not fight a dimmed copy of itself.
    this.hud.style.display = to === 'playing' ? '' : 'none';
    // The gun must not hang in the flythrough, or over the body on the game over screen.
    const view = this.ctx.render.viewScene;
    if (view instanceof THREE.Object3D) view.visible = to === 'playing' || to === 'paused';
    this.flythrough.active = to === 'menu';
    if (to === 'playing') {
      this.screens.show('none');
      this.minimap.measure();
    }
  }

  private onRunStart(): void {
    this.state.read(this.ctx);
    this.report.begin(this.state.highScore);
    this.deathClock = 0;
    this.vitals.reset(this.state);
    this.tach.reset();
    this.tally.reset();
    this.combo.reset();
    this.perks.reset();
    this.feedLane.clear();
    this.styleLane.clear();
    this.crosshair.reset();
    this.worldLayer.reset();
    this.boss.reset();
    this.bannerLanes.reset();
    this.minimap.reset();
    this.stragglers.reset();
    this.arms.invalidate();
    this.callIns.reset();
    this.scoreboard.setHeld(false);
  }

  private onWaveStart(wave: number, total: number, boss: boolean): void {
    const hard = wave >= 10;
    const sub = boss ? `${isTitanWave(wave) ? 'titan' : 'juggernaut'} inbound` : `${total} hostile`;
    this.bannerLanes.showBand(boss ? 'boss' : hard ? 'hard' : 'wave', `WAVE ${wave}`, sub);
  }

  private onWaveClear(wave: number, bonus: number): void {
    this.bannerLanes.showBand('clear', `WAVE ${wave} CLEAR`, bonus > 0 ? `+${bonus.toLocaleString('en-US')}` : '');
  }

  private onDeath(): void {
    if (this.deathClock > 0) return;
    this.deathClock = DEATH_BEAT;
    this.ctx.time.pushScale('hud-death', 0.3, 0.08, 0.2);
    this.bannerLanes.showBand('dead', 'DEAD', this.report.killedBy ? `killed by ${this.killerName(this.report.killedBy)}` : '');
  }

  killerName(source: string): string {
    return sourceName(source).toLowerCase();
  }

  // --- Flow ----------------------------------------------------------------------------------------------------

  /** From a real click on Play or Run again. Starts immediately; the lock lands a moment later. */
  startRun(): void {
    const game = this.game;
    if (!game) return;
    this.ctx.audio.unlock?.();
    // The press that chose this button must not also jump or fire on the first frame of the run.
    this.ctx.input.endFrame?.();
    this.requestLock('run');
    game.newRun();
    this.pauseGuard = 2;
  }

  /** From Resume. The game stays paused until the mouse is really back, unless this browser has never given it. */
  resume(): void {
    const game = this.game;
    if (!game || game.state !== 'paused') return;
    this.pauseGuard = 2;
    // Chrome does not count Esc as a gesture, so a request from it can only fail. Say so now rather than after the retries.
    if (this.lockEverHeld && navigator.userActivation?.isActive === false) {
      this.screens.pauseHint('The browser wants a click. Click Resume or press Enter.');
      return;
    }
    this.requestLock('resume');
  }

  pause(): void {
    const game = this.game;
    // The death beat is already on its way to the game over screen.
    if (!game || game.state !== 'playing' || this.deathClock > 0) return;
    this.lockAfter = null;
    game.setState('paused');
    this.ctx.input.releaseLock?.();
    this.scoreboard.setHeld(false);
    this.screens.show('pause');
  }

  quitToMenu(): void {
    this.lockAfter = null;
    this.ctx.input.releaseLock?.();
    this.game?.clearRun();
    this.game?.setState('menu');
    this.screens.show('menu');
  }

  private requestLock(after: 'run' | 'resume'): void {
    this.lockAfter = after;
    this.lockClock = LOCK_RETRY_FOR;
    this.lockRetry = LOCK_RETRY_EVERY;
    this.ctx.input.requestLock?.();
  }

  private updateLock(dt: number): void {
    const { input } = this.ctx;
    const game = this.game;
    if (input.locked === true) {
      this.lockHeld = this.lockEverHeld = true;
      if (this.lockAfter === 'resume') game?.setState('playing');
      this.lockAfter = null;
      // A request still in flight when the player paused lands here, and a pause screen with no cursor is a trap.
      if (game && game.state !== 'playing') input.releaseLock?.();
      return;
    }
    if (this.lockHeld) {
      // Esc, Alt-Tab, a closed laptop: however the mouse went, the run stops.
      this.lockHeld = false;
      this.pause();
    }
    if (!this.lockAfter) return;
    this.lockClock -= dt;
    this.lockRetry -= dt;
    if (this.lockClock <= 0) {
      const after = this.lockAfter;
      this.lockAfter = null;
      // A browser that will not hand over the mouse at all still gets a game on the second ask.
      if (after === 'resume' && !this.lockEverHeld) game?.setState('playing');
      else {
        this.pause();
        this.screens.pauseHint('Click Resume to take the mouse back.');
      }
      return;
    }
    if (this.lockRetry <= 0) {
      this.lockRetry = LOCK_RETRY_EVERY;
      input.requestLock?.();
    }
  }

  private updateDeath(dt: number): void {
    if (this.deathClock <= 0) return;
    this.deathClock -= dt;
    if (this.deathClock > 0) return;
    const game = this.game;
    this.ctx.time.popScale('hud-death');
    this.lockAfter = null;
    this.ctx.input.releaseLock?.();
    this.ctx.events.emit('run:end', { score: this.report.score, wave: this.report.wave, kills: this.report.kills });
    game?.setState('gameover');
    this.screens.show('gameover');
    this.screens.holdInput(GAME_OVER_HOLD);
  }

  // --- Frame ---------------------------------------------------------------------------------------------------

  update(): void {
    const ctx = this.ctx;
    const dt = ctx.time.realDt;
    const game = this.game;
    const playing = game?.state === 'playing';

    this.flythrough.update(dt);
    this.screens.update(dt);
    this.updateLock(dt);

    const input = ctx.input;
    if (input.pressed?.('debugFps') === true) this.debug.toggleFps();
    if (input.pressed?.('debugOverlay') === true) this.debug.toggleInfo();

    if (this.pauseGuard > 0) this.pauseGuard--;
    else if (playing && input.pressed?.('pause') === true) this.pause();

    if (game && game.state !== 'playing' && game.state !== 'paused') return;

    const camera = ctx.render.camera;
    // The rig moved the camera this frame, but the matrix only refreshes at render, and at 40 m/s a frame of lag is
    // visible on anchored text.
    if (camera instanceof THREE.Camera) camera.updateMatrixWorld();

    const s = this.state;
    s.read(ctx);
    if (playing) this.report.sample(dt, s.speed, s.multiplier, s.score, s.kills, s.wave);

    this.vitals.update(s, dt);
    this.arms.update(s, dt);
    this.tach.update(s, dt);
    this.tally.update(s, dt);
    this.combo.update(s, dt);
    this.perks.update(s, dt);
    this.callIns.update(s, dt);
    this.feedLane.update(dt);
    this.styleLane.update(dt);
    this.crosshair.update(s, dt, this.combo.tier);
    this.worldLayer.update(dt);
    this.boss.update(s, dt);
    this.bannerLanes.update(dt);
    this.scope.update(s, dt);
    this.targeting.update(s, dt);
    this.lowFrame.update(s);
    this.debug.update(s, dt);
    this.minimap.update(s, dt, this.readPickups());
    this.stragglers.update(s);
    this.scoreboard.update(input.isDown?.('scoreboard') === true && playing === true, dt);
    this.updateDeath(dt);
  }

  private readPickups(): readonly MinimapPoint[] {
    const out = this.pickupPoints;
    const source = (this.ctx.progression as unknown as PickupSource).pickups;
    if (!Array.isArray(source)) {
      out.length = 0;
      return out;
    }
    let n = 0;
    for (const p of source) {
      if (p.active === false) continue;
      const point = out[n] ?? (out[n] = { x: 0, y: 0, z: 0, color: '' });
      point.x = p.position.x;
      point.y = p.position.y;
      point.z = p.position.z;
      point.color = pickupColor(p.kind);
      n++;
    }
    out.length = n;
    return out;
  }

  reset(): void {
    // Game.newRun resets every system before emitting run:start, which is where this HUD does its clearing.
  }

  // --- HudSystem -----------------------------------------------------------------------------------------------

  banner(text: string, subtext?: string, color?: string): void {
    if (/^WAVE\b/.test(text)) this.bannerLanes.showBand('wave', text, subtext, color);
    else this.bannerLanes.stamp(text, subtext, color);
  }

  feed(text: string, color?: string): void {
    this.feedLane.push(text, color);
  }

  hitMarker(kind: HitKind): void {
    this.crosshair.hit(kind);
  }

  floatText(position: THREE.Vector3, text: string, color?: string): void {
    this.worldLayer.float(position, text, color);
  }

  marker(position: THREE.Vector3, label: string, color?: string): () => void {
    return this.worldLayer.marker(position, label, color);
  }

  loading(fraction: number, label: string): void {
    this.screens.loading(fraction, label);
  }

  showScreen(screen: ScreenName): void {
    this.screens.show(screen);
  }
}
