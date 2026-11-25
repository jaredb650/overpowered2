/**
 * Root of the HUD and menus.
 *
 * Owns the run's UI flow, because Game.ts only knows states: splash to menu, menu to run, pausing on lost pointer
 * lock, the death beat, and game over. Widgets are plain objects updated from one HudState read per frame; anything
 * that can run on realDt does, so hit-stop and slow-mo never stutter the interface.
 */
import * as THREE from 'three';
import type { Ctx, GameState } from '../core/contracts';
import type { HudSystem, PickupKind, SeatPanel } from '../core/gameplay';
import { cheatsOn, onCheats } from '../core/cheats';
import { div, span } from './dom';
import { HudState } from './state';
import { RunReport } from './runreport';
import { applyQuality, applySettings, CHATTER_BUBBLES, CHATTER_OFF, loadSettings, type Settings } from './settings';
import { CALLINS, WEAPONS, sourceName } from './data';
import { pickupColor } from './icons';
import { Vitals } from './hud/vitals';
import { Arms } from './hud/arms';
import { Tach } from './hud/tach';
import { Tally } from './hud/tally';
import { Combo } from './hud/combo';
import { Perks } from './hud/perks';
import { CallIns } from './hud/callins';
import { CommsFeed, KillFeed, StyleLane } from './hud/feed';
import { Crosshair, type HitKind } from './hud/crosshair';
import { WorldLayer } from './hud/worldlayer';
import { Bubbles } from './hud/bubbles';
import { ChatterVoices } from './hud/voices';
import { BossBar } from './hud/boss';
import { Banner } from './hud/banner';
import { LowFrame, Scope, Targeting } from './hud/overlays';
import { DebugOverlays } from './hud/debug';
import { Minimap, type MinimapPoint } from './hud/minimap';
import { Scoreboard } from './hud/scoreboard';
import { SonarChip } from './hud/sonar';
import { Stragglers } from './hud/stragglers';
import { NowPlaying } from './hud/nowplaying';
import { Callout } from './hud/callout';
import { HoldRing } from './hud/holdRing';
import { GrenadeWarn } from './hud/grenadeWarn';
import { Screens, type ScreenName } from './screens/Screens';
import { Flythrough } from './screens/flythrough';
import { MenuBackdrop } from './backdrop/MenuBackdrop';
import { backdropMode } from './backdrop/rhythm';
import { isTitanWave } from '../enemies/waves';
import type { CommsKind } from '../enemies/outpost/events';
import { MISSION_ID } from '../campaign/select';
import { crucibleRules, refreshRules } from '../contracts/crucible';
import { ACTIVE } from '../contracts/select';
import { CommanderHud } from './commander';
import { DefenseHud } from './hud/defense';
import { ShopHud } from './hud/shop';
import { SHOP_ON } from '../contracts/shop/data';
import type { ShopId } from '../contracts/defense/data';

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

/** The screens that show the helicopter behind them. The rest of the menu keeps the map: the Crucible's rules are about it. */
const HELI_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>(['splash', 'menu', 'guide', 'settings', 'coop']);
const MENU_BG = new URLSearchParams(location.search).get('menubg');
const REDUCED_MOTION = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Long enough to see what killed you, short enough to still be angry about it. */
const DEATH_BEAT = 1.5;
/** Long enough to read the band. */
const FULFILLED_BEAT = 2.6;
const MISSION_BEAT = 0.5;
/** Chrome refuses a lock for about 1.25 s after Esc, so a resume keeps asking for a little longer than that. */
const LOCK_RETRY_FOR = 1.7;
const LOCK_RETRY_EVERY = 0.3;
/** A burst of fire or a jump press at the moment of death must not land on Run again before the report is read. */
const GAME_OVER_HOLD = 0.8;
/** Radio that has stopped being professional reads warm, so a breaking squad shows on the feed before anyone counts it. */
const COMMS_FEAR: ReadonlySet<CommsKind> = new Set<CommsKind>(['fear', 'panic', 'surrender', 'squadGone']);

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
  private comms: CommsFeed;
  private sonar: SonarChip;
  private crosshair: Crosshair;
  private callouts: Callout;
  private holdRing = new HoldRing();
  private worldLayer: WorldLayer;
  private bubbles: Bubbles;
  private grenadeWarn: GrenadeWarn;
  private voices: ChatterVoices;
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
  /** The contractor in the helicopter, behind the first menu screens. `?menubg=map` puts the flythrough back. */
  readonly backdrop: MenuBackdrop;
  private nowPlaying = new NowPlaying();
  /** The Outpost's enemy has things to say. Null everywhere else. */
  private commander: CommanderHud | null;
  /** Outpost Defense's credits and shops. Null on every other contract. */
  private defense: DefenseHud | null;
  /** The Crucible shop's credits, where this page's Crucible sells its guns. */
  private shop: ShopHud | null;

  private seatPanel: SeatPanel | null = null;
  private pickupPoints: MinimapPoint[] = [];
  private deathClock = 0;
  private contractDone = false;
  private pauseGuard = 0;
  private lockClock = 0;
  private lockRetry = 0;
  private lockAfter: 'run' | 'resume' | null = null;
  /** True while the last frame saw the lock, so any way of losing it can be noticed. */
  private lockHeld = false;
  private lockEverHeld = false;
  /**
   * Esc backed out of the pause menu or a shop, but the browser will not hand the mouse back without a click or a key: the menu
   * is gone and the run waits under a one-line prompt for the next click or key, which takes the mouse back. Esc there opens
   * the pause menu again. `touchArmed` keeps the press that got here from also answering it.
   */
  private touching = false;
  private touchArmed = false;
  private readonly touchHint: HTMLElement;

  constructor(private readonly ctx: Ctx) {
    this.report = new RunReport(ctx);
    this.root = document.getElementById('ui') ?? document.body.appendChild(div());
    this.root.classList.add('op');

    this.worldLayer = new WorldLayer(ctx);
    this.bubbles = new Bubbles(ctx);
    this.grenadeWarn = new GrenadeWarn(ctx);
    this.voices = new ChatterVoices(ctx, this.settings);
    this.stragglers = new Stragglers(this.worldLayer);
    this.vitals = new Vitals(ctx);
    this.arms = new Arms(ctx);
    this.tach = new Tach();
    this.tally = new Tally();
    this.combo = new Combo();
    this.perks = new Perks();
    this.callIns = new CallIns(ctx);
    this.feedLane = new KillFeed();
    this.styleLane = new StyleLane();
    this.comms = new CommsFeed();
    this.sonar = new SonarChip(ctx);
    this.crosshair = new Crosshair(ctx);
    this.crosshair.el.append(this.holdRing.el);
    this.callouts = new Callout();
    this.boss = new BossBar();
    this.bannerLanes = new Banner();
    this.scope = new Scope(ctx, this.settings);
    this.targeting = new Targeting(ctx);
    this.lowFrame = new LowFrame();
    this.debug = new DebugOverlays(ctx);
    this.minimap = new Minimap(ctx, this.worldLayer);
    this.scoreboard = new Scoreboard(this.report);
    this.commander = ACTIVE.def.ai === 'outpost' && !ACTIVE.def.noCommander ? new CommanderHud(ctx, this.settings) : null;
    this.defense = ACTIVE.def.economy ? new DefenseHud(ctx) : null;
    this.shop = SHOP_ON ? new ShopHud(ctx) : null;
    // A mission has an ending of its own to get through after he falls.
    if (this.commander) this.commander.onFulfilled = () => { if (!MISSION_ID) this.fulfilled(); };

    // A reminder while the cheats are on: every run is unranked (core/cheats.ts).
    const cheatTag = div('hud-cheats', 'CHEATS');
    cheatTag.classList.toggle('on', cheatsOn());
    onCheats(on => cheatTag.classList.toggle('on', on));
    // Tag every HUD widget with its visibility group so players can hide individual parts or the entire HUD.
    const tagPart = (el: HTMLElement | undefined, part: string) => { if (el) el.dataset.hudPart = part; };
    tagPart(this.crosshair.el, 'crosshair');
    tagPart(this.callouts.el, 'crosshair');
    tagPart(this.vitals.el, 'vitals');
    tagPart(this.lowFrame.el, 'vitals');
    tagPart(this.tach.el, 'vitals');
    tagPart(this.arms.el, 'weapons');
    tagPart(this.callIns.el, 'weapons');
    tagPart(this.perks.el, 'weapons');
    tagPart(this.minimap.el, 'minimap');
    tagPart(this.sonar.el, 'minimap');
    tagPart(this.tally.el, 'score');
    tagPart(this.combo.el, 'score');
    tagPart(this.styleLane.el, 'score');
    tagPart(this.boss.el, 'score');
    tagPart(this.bannerLanes.el, 'score');
    tagPart(this.defense?.el, 'score');
    tagPart(this.shop?.el, 'score');
    tagPart(this.commander?.el, 'score');
    tagPart(this.feedLane.el, 'feeds');
    tagPart(this.comms.el, 'feeds');
    tagPart(this.worldLayer.el, 'markers');
    tagPart(this.bubbles.el, 'markers');
    tagPart(this.defense?.ring, 'markers');

    this.hud = div('hud',
      this.lowFrame.el,
      this.worldLayer.el,
      this.bubbles.el,
      this.grenadeWarn.el,
      this.scope.el,
      this.targeting.el,
      this.crosshair.el,
      this.callouts.el,
      this.defense?.ring,
      div('col-left',
        this.tally.el,
        this.defense?.el,
        this.shop?.el,
        this.perks.el,
        div('fill'),
        this.comms.el,
        this.sonar.el,
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
      this.commander?.el,
      this.debug.el,
      cheatTag,
    );
    this.hud.style.display = 'none';
    this.applyHudSettings(this.settings);
    this.root.append(this.hud);

    this.flythrough = new Flythrough(ctx);
    this.backdrop = new MenuBackdrop(ctx);
    this.screens = new Screens(ctx, this, this.settings);
    this.root.append(this.screens.el);
    // Last, so the track name shows over the menu as well as the HUD.
    this.root.append(this.nowPlaying.el);
    this.screens.show('loading');
    this.touchHint = div('touch-hint', span('touch-t', 'Click or press any key to resume'), span('touch-s', 'Esc: pause menu'));
    this.touchHint.style.display = 'none';
    this.root.append(this.touchHint);

    addEventListener('resize', this.onResize);
    addEventListener('keydown', e => {
      if (!this.touching || !this.touchArmed || e.repeat) return;
      e.preventDefault();
      this.endTouch();
      if (e.code === 'Escape') this.screens.show('pause');
      else this.requestLock('resume');
    });
    // A click, not a mousedown: by the time the run is back the button is up, so the click cannot fire too.
    addEventListener('click', () => {
      if (!this.touching || !this.touchArmed) return;
      this.endTouch();
      this.requestLock('resume');
    });
  }

  /** Game.ts publishes itself on window once systems exist. Sandboxes publish a stand-in the same way. */
  get game(): GameHost | null {
    return (window as unknown as { __op2?: { game?: GameHost } }).__op2?.game ?? null;
  }

  private onResize = (): void => {
    this.worldLayer.measure();
    this.minimap.measure();
    this.bubbles.measure();
    this.crosshair.measure();
  };

  private readonly readPickupsBound = (): readonly MinimapPoint[] => this.readPickups();

  init(): void {
    const { events } = this.ctx;
    events.on('game:state', e => this.onState(e.from, e.to));
    events.on('run:start', () => this.onRunStart());
    events.on('player:damaged', e => {
      this.vitals.hit(e.amount);
      this.crosshair.damaged(e.amount, e.from);
    });
    events.on('player:died', () => this.onDeath());
    events.on('campaign:complete', () => this.fulfilled());
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
    events.on('music:track', e => this.nowPlaying.show(e.title, e.original));
    events.on('defense:open', e => this.openDefense(e.screen));
    events.on('shop:open', () => this.openDefense('procurement'));
    events.on('dogfight:modal', e => this.setDogfightModal(e.open));
    events.on('badlands:modal', e => this.setDogfightModal(e.open));
    events.on('badlands:customize_frame', e => this.openFrameFromTerminal(e.onDone));
    events.on('comms:line', e => {
      const isAlly = e.kind === 'ally' || e.ally === true;
      const chatter = isAlly ? 0 : this.settings.chatter;
      if (chatter === CHATTER_OFF) return;
      const color = isAlly ? 'var(--friend)' : COMMS_FEAR.has(e.kind) ? 'var(--amber)' : 'var(--cold)';
      this.comms.push(e.text, color, e.speaker ?? e.squad, e.enemy ?? e.speaker);
      if (chatter === CHATTER_BUBBLES) this.bubbles.say(e, color);
      if (!isAlly || (e.row !== undefined && e.row >= 0) || Boolean(e.clip)) this.voices.say(e);
      // A critical warning gets a cue whatever the setting: the player has to act on it.
      if (e.kind === 'flash' && e.enemy) this.bubbles.warn(e.position, 'FLASH INCOMING');
      if (e.kind === 'fakeOut' && e.enemy) this.bubbles.warn(e.position, 'GRENADE', 1.4);
      this.debug.chatter(e);
    });
    events.on('comms:cut', e => {
      this.comms.cut(e.enemy ?? e.speaker, e.at, e.radio);
      this.voices.cut(e.enemy, e.speaker);
      if (e.enemy) this.bubbles.cut(e.enemy, e.at, e.radio);
    });
    applySettings(this.ctx, this.settings);
    applyQuality(this.ctx, this.settings);
  }

  dazzle(amount: number): void {
    this.hud.style.opacity = amount > 0 ? String(1 - amount) : '';
  }

  /** Applies master and per-part HUD visibility toggles from player settings. */
  applyHudSettings(s: Settings): void {
    this.hud.classList.toggle('hud-off', !s.hud);
    this.hud.classList.toggle('hud-no-crosshair', !s.hudCrosshair);
    this.hud.classList.toggle('hud-no-vitals', !s.hudVitals);
    this.hud.classList.toggle('hud-no-weapons', !s.hudWeapons);
    this.hud.classList.toggle('hud-no-minimap', !s.hudMinimap);
    this.hud.classList.toggle('hud-no-score', !s.hudScore);
    this.hud.classList.toggle('hud-no-feeds', !s.hudFeeds);
    this.hud.classList.toggle('hud-no-markers', !s.hudMarkers);
  }

  seat(panel: SeatPanel | null): void {
    this.seatPanel?.el.remove();
    this.seatPanel = panel;
    this.hud.classList.toggle('seated', panel !== null);
    if (panel) this.hud.append(panel.el);
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
    this.commander?.setPaused(to !== 'playing');
    if (to === 'playing') {
      this.screens.show('none');
      this.minimap.measure();
    }
  }

  private onRunStart(): void {
    this.state.read(this.ctx);
    // A checkpoint is the same mission going on, and the bill at the end is for all of it.
    if (this.ctx.campaign?.returning) this.report.killedBy = '';
    else this.report.begin(this.state.highScore, this.state.customRules);
    this.deathClock = 0;
    this.vitals.reset(this.state);
    this.tach.reset();
    this.tally.reset();
    this.tally.el.style.display = this.ctx.coop?.freeRoam ? 'none' : '';
    if (this.shop) this.shop.el.style.display = this.ctx.coop?.freeRoam ? 'none' : '';
    if (this.defense) this.defense.el.style.display = this.ctx.coop?.freeRoam ? 'none' : '';
    this.combo.reset();
    this.perks.reset();
    this.feedLane.clear();
    this.styleLane.clear();
    this.comms.clear();
    this.bubbles.reset();
    this.voices.reset();
    this.sonar.reset();
    this.crosshair.reset();
    this.worldLayer.reset();
    this.boss.reset();
    this.bannerLanes.reset();
    this.minimap.reset();
    this.stragglers.reset();
    this.arms.invalidate();
    this.callIns.reset();
    this.scoreboard.setHeld(false);
    this.commander?.reset();
  }

  private onWaveStart(wave: number, total: number, boss: boolean): void {
    const hard = wave >= 10;
    // Co-op: the wave is the host's, and so is the boss the host's rules send (a guest's own saved rules may differ).
    const team = this.ctx.coop?.world?.team;
    const sub = boss ? `${(team ? team.titanWave : isTitanWave(wave, crucibleRules())) ? 'titan' : 'juggernaut'} inbound` : `${total} hostile`;
    this.bannerLanes.showBand(boss ? 'boss' : hard ? 'hard' : 'wave', `WAVE ${wave}`, sub);
  }

  private onWaveClear(wave: number, bonus: number): void {
    this.bannerLanes.showBand('clear', `WAVE ${wave} CLEAR`, bonus > 0 ? `+${bonus.toLocaleString('en-US')}` : '');
  }

  private onDeath(): void {
    if (this.ctx.coop?.world) return;
    if (this.deathClock > 0) return;
    this.deathClock = DEATH_BEAT;
    this.ctx.time.pushScale('hud-death', 0.3, 0.08, 0.2);
    this.bannerLanes.showBand('dead', 'DEAD', this.report.killedBy ? `killed by ${this.killerName(this.report.killedBy)}` : '');
  }

  /** The Commander is dead and the Council has signed it off. The run ends the way a death does, with a better headline. */
  private fulfilled(): void {
    // Co-op: a run only ever ends on the team's board (net/team.ts `finish`), never on the solo screens, and the world stays
    // live. The host says the contract is fulfilled; a mission's win reaches the team from `campaign:complete` itself.
    const coop = this.ctx.coop;
    if (coop?.world) {
      if (coop.hosting && !MISSION_ID) coop.world.team.finish('fulfilled');
      return;
    }
    if (this.deathClock > 0) return;
    this.contractDone = true;
    // A mission has already faded out on its own ending, and has a screen of its own to say so.
    this.deathClock = MISSION_ID ? MISSION_BEAT : FULFILLED_BEAT;
    if (!MISSION_ID) this.bannerLanes.showBand('clear', 'CONTRACT FULFILLED', '');
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
    // Before the reset, so the score, the HUD and the waves all start the run on the same rules.
    refreshRules();
    game.newRun();
    this.pauseGuard = 2;
  }

  /** From the pause menu in a mission. The mouse comes back the way it does for a new run. */
  restartCheckpoint(): void {
    this.ctx.audio.unlock?.();
    this.ctx.input.endFrame?.();
    this.requestLock('run');
    // Co-op: the host's alone, and the whole team goes back with it and is told (net/team.ts).
    const team = this.ctx.coop?.world?.team;
    if (team) team.restartCheckpoint();
    else this.ctx.campaign.restart();
    this.pauseGuard = 2;
  }

  /**
   * From Resume. The game stays paused until the mouse is really back, unless this browser has never given it. False when
   * the browser will not hand the mouse back without a click or a key.
   */
  resume(): boolean {
    const game = this.game;
    if (!game || game.state !== 'paused') return false;
    this.pauseGuard = 2;
    // Chrome does not count Esc as a gesture, and after the player's own Esc it wants one to take the mouse back, so a request
    // from Esc can only fail. Then the menu still goes, as Esc means, and the next click or key resumes (`awaitTouch`). A lock the
    // page let go itself (a shop opened with E) comes back without one.
    if (this.lockEverHeld && navigator.userActivation?.isActive === false && this.ctx.input.relockFree !== true) {
      this.awaitTouch();
      return true;
    }
    this.requestLock('resume');
    return true;
  }

  /** The menu goes and the run waits for a click or a key (see `touching`). */
  private awaitTouch(): void {
    this.lockAfter = null;
    this.touching = true;
    this.touchArmed = false;
    this.screens.show('none');
    this.touchHint.style.display = '';
  }

  private endTouch(): void {
    this.touching = this.touchArmed = false;
    this.touchHint.style.display = 'none';
  }

  /** Outpost Defense's loadout or a shop: the run waits under it, as under pause, and Resume brings it back. */
  private openDefense(screen: 'loadout' | ShopId | 'procurement'): void {
    // Co-op: each player's own shops and loadout, and none of them pauses (setState keeps a co-op world live).
    if (this.ctx.coop && !this.ctx.coop.world) return;
    const game = this.game;
    if (!game || this.deathClock > 0 || (game.state !== 'playing' && game.state !== 'paused')) return;
    game.setState('paused');
    this.lockAfter = null;
    this.ctx.input.releaseLock?.();
    this.scoreboard.setHeld(false);
    if (screen === 'loadout' || screen === 'procurement') this.screens.show(screen);
    else this.screens.shop(screen);
  }

  private setDogfightModal(open: boolean): void {
    const game = this.game;
    if (!game || this.deathClock > 0) return;
    if (open) {
      if (game.state !== 'playing' && game.state !== 'paused') return;
      game.setState('paused');
      this.lockAfter = null;
      this.lockHeld = false;
      this.ctx.input.releaseLock?.();
      this.scoreboard.setHeld(false);
      this.screens.show('none');
    } else if (game.state === 'paused') {
      this.resume();
    }
  }

  private openFrameFromTerminal(onDone: () => void): void {
    const game = this.game;
    if (!game || this.deathClock > 0) return;
    if (game.state !== 'playing' && game.state !== 'paused') return;
    game.setState('paused');
    this.lockAfter = null;
    this.lockHeld = false;
    this.ctx.input.releaseLock?.();
    this.scoreboard.setHeld(false);
    this.screens.showAside('frame', onDone);
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
    // Co-op lands back in its lobby: the host ends the match for everyone, a guest steps out while the others play on.
    const room = this.ctx.coop?.leave(true) ?? null;
    this.game?.clearRun();
    this.ctx.coop = undefined;
    this.game?.setState('menu');
    this.screens.show('menu');
    if (room) this.screens.coopEnded('', room);
  }

  /** Co-op's own HUD (net/coopHud.ts) goes in with the rest, and hides with it. */
  mount(el: HTMLElement): void {
    this.hud.append(el);
  }

  /**
   * Co-op: the run is over and the team's board is up (net/coopHud.ts). It goes over everything, the mouse is let go for its
   * buttons, and the world stays live under it: the co-op "paused" state releases controls and never stops the clock. No solo
   * ending can follow it.
   */
  teamBoard(el: HTMLElement): void {
    const game = this.game;
    this.root.append(el);
    this.deathClock = 0;
    this.contractDone = false;
    this.ctx.time.popScale('hud-death');
    this.lockAfter = null;
    this.lockHeld = false;
    if (game?.state === 'playing') game.setState('paused');
    this.ctx.input.releaseLock?.();
    this.scoreboard.setHeld(false);
    this.screens.show('none');
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
        // Refused (Chrome's cooldown just after an Esc, or no gesture): wait for the next click or key rather than leave a menu up.
        this.pause();
        if (this.lockEverHeld) this.awaitTouch();
        else this.screens.pauseHint('Click Resume to take the mouse back.');
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
    // A mission brings the player back at a checkpoint, and Endless War redeploys at FOB Vanguard while the FOB Core stands.
    if (this.ctx.campaign?.redeploy()) return;
    if ((this.ctx.waves as { redeploy?: () => boolean } | undefined)?.redeploy?.()) return;
    this.lockAfter = null;
    this.ctx.input.releaseLock?.();
    this.ctx.events.emit('run:end', { score: this.report.score, wave: this.report.wave, kills: this.report.kills });
    game?.setState('gameover');
    this.screens.show(this.contractDone && MISSION_ID ? 'complete' : 'gameover');
    this.screens.holdInput(GAME_OVER_HOLD);
    if (this.contractDone) {
      const by = this.screens.el.querySelector('.go-by');
      if (by) by.textContent = 'Contract fulfilled';
      this.contractDone = false;
    }
  }

  // --- Frame ---------------------------------------------------------------------------------------------------

  update(): void {
    const ctx = this.ctx;
    const dt = ctx.time.realDt;
    const game = this.game;
    const playing = game?.state === 'playing';

    this.updateBackdrop(dt, game?.state);
    this.flythrough.update(dt);
    this.screens.update(dt);
    this.updateLock(dt);
    // The prompt answers presses from the next frame on, and lapses if anything else took over (a death, a screen, the run back).
    if (this.touching) {
      if (game?.state !== 'paused' || this.screens.name !== 'none') this.endTouch();
      else this.touchArmed = true;
    }

    const input = ctx.input;
    if (input.pressed?.('debugFps') === true) this.debug.toggleFps();
    if (input.pressed?.('debugOverlay') === true) this.debug.toggleInfo();

    if (this.pauseGuard > 0) this.pauseGuard--;
    else if (playing && input.pressed?.('pause') === true) this.pause();

    if (game && game.state !== 'playing' && game.state !== 'paused') return;

    const camera = ctx.render.camera;
    // CameraRig updates the camera's world matrix right before the HUD during play; refresh only if stale or paused.
    if (camera instanceof THREE.Camera && (!playing || ctx.time.paused || camera.matrixWorldNeedsUpdate)) camera.updateMatrixWorld();

    const s = this.state;
    s.read(ctx);
    if (playing) this.report.sample(dt, s.speed, s.multiplier, s.score, s.kills, s.wave);
    if (playing && MISSION_ID) this.report.mission(ctx.campaign.runner?.beat?.title ?? '', ctx.campaign.runner?.deaths ?? 0);

    this.vitals.update(s, dt);
    this.arms.update(s, dt);
    this.tach.update(s, dt);
    this.tally.update(s, dt);
    this.combo.update(s, dt);
    this.perks.update(s, dt);
    this.callIns.update(s, dt);
    if (playing) this.commander?.update(dt);
    this.feedLane.update(dt);
    this.styleLane.update(dt);
    this.comms.update(dt);
    this.sonar.update(s);
    this.crosshair.update(s, dt, this.combo.tier);
    this.holdRing.update(dt);
    this.seatPanel?.update();
    this.worldLayer.update(dt);
    this.bubbles.update(playing ? dt : 0);
    this.grenadeWarn.update(playing);
    this.voices.update(dt, !playing);
    this.boss.update(s, dt);
    this.commander?.nameBoss(this.boss.el);
    if (!ctx.coop?.freeRoam) {
      this.defense?.update();
      this.shop?.update();
    }
    this.bannerLanes.update(dt);
    this.scope.update(s, dt);
    this.targeting.update(s, dt);
    this.lowFrame.update(s);
    this.debug.update(s, dt);
    const seen = s.enemies;
    if (this.commander) s.enemies = this.commander.radar(seen);
    this.minimap.update(s, dt, this.readPickupsBound);
    s.enemies = seen;
    this.stragglers.update(s);
    this.scoreboard.update(input.isDown?.('scoreboard') === true && playing === true, dt);
    this.updateDeath(dt);
  }

  /** The helicopter on the first menu screens, the flythrough on the others, and neither in a run, which frees the helicopter. */
  private updateBackdrop(dt: number, state: GameState | undefined): void {
    if (state === 'playing' && !this.backdrop.built && !this.flythrough.active) return;
    const screen = this.screens.name;
    const menu = state === 'menu';
    const heli = menu && HELI_SCREENS.has(screen);
    const mode = backdropMode(MENU_BG, REDUCED_MOTION?.matches ?? false, this.settings.quality);
    // The splash click is what lets audio start, so the cabin is heard from the menu on.
    this.backdrop.update(dt, heli, mode, screen !== 'splash', screen === 'splash' ? 'splash' : 'menu');
    this.flythrough.active = menu && !(heli && mode !== 'map');
    if (state === 'playing' && this.backdrop.built) this.backdrop.dispose();
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

  hold(fill: number): void {
    this.holdRing.ask(fill);
  }

  callout(text: string): void {
    this.callouts.show(text);
  }

  floatText(position: THREE.Vector3, text: string, color?: string): void {
    this.worldLayer.float(position, text, color);
  }

  marker(position: THREE.Vector3, label: string, color?: string): () => void {
    return this.worldLayer.marker(position, label, color);
  }

  follow(target: THREE.Vector3, label: string, color?: string, tag?: boolean): () => void {
    return this.worldLayer.follow(target, label, color, tag);
  }

  loading(fraction: number, label: string): void {
    this.screens.loading(fraction, label);
  }

  showScreen(screen: ScreenName): void {
    this.screens.show(screen);
  }
}
