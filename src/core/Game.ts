import { reportSolo } from './report';
import { createFrameGuard } from './capture';
/**
 * Composition root and main loop.
 *
 * Systems are found by convention: src/<dir>/index.ts exports a factory. A missing module becomes a
 * no-op stub, so the game boots with whatever has been built so far.
 */
import { loadingScreen, showLoading } from '../ui/boot';
import type { Crawl } from '../ui/screens/loading';
import { DEV_TOOLS, ON_RANGE } from './devflags';
import { EventBus } from './events';
import { GameTime } from './time';
import { noop } from './stubs';
import { cheatsOn, onCheats } from './cheats';
import { importRetry } from './chunkRetry';
import { clockDue, drawGate, proofSwitches } from './proofmode';
import type { Ctx, GameEvents, GameState, GameSystem } from './contracts';
import './gameplay';
import type { Regroup, Room } from '../net';
import { forgetRoom, handoffUsed, reconnectMatch, resumeFailed, resumedLobby, resumedMatch, roomToRejoin } from '../net/session';

type Factory = (...args: never[]) => unknown;
type Progress = (fraction: number, label: string, crawl?: Crawl) => void;

const modules = import.meta.glob<Record<string, Factory>>(['../*/index.ts', '../*/*/index.ts']);

/**
 * Lets the loading screen paint between boot steps that would otherwise run back to back. A hidden tab never fires
 * animation frames, so a timer backs it up.
 */
const breathe = () => new Promise<void>(done => {
  const timer = setTimeout(done, 40);
  requestAnimationFrame(() => {
    clearTimeout(timer);
    setTimeout(done, 0);
  });
});

async function factory(dir: string, name: string): Promise<Factory | null> {
  const load = modules[`../${dir}/index.ts`];
  if (!load) return null;
  const mod = await importRetry(load);
  return mod[name] ?? null;
}

async function build<T extends object>(dir: string, name: string, label: string, ...args: unknown[]): Promise<T> {
  const make = await factory(dir, name);
  if (!make) {
    console.warn(`[boot] ${label}: not built yet, using a stub`);
    return noop<T>(label);
  }
  return (await (make as unknown as (...a: unknown[]) => T | Promise<T>)(...args)) as T;
}

export class Game {
  readonly ctx: Ctx;
  state: GameState = 'boot';
  private ordered: GameSystem[] = [];
  private orderedSource: GameSystem[] | null = null;
  private orderedNames: string[] = [];
  private orderedRunners: (() => void)[] = [];
  private fps = 0;
  private deferredCoopInit: GameSystem[] = [];
  private cpuMs = 0;
  private guard = createFrameGuard();
  private readonly runPhysics: () => void;
  private readonly runCamera: () => void;
  private readonly runFx: () => void;
  private readonly runAudio: () => void;
  private readonly runHud: () => void;
  private readonly runCoop: () => void;
  private readonly runSettle: () => void;
  private readonly runRender: () => void;
  private readonly runInput: () => void;
  private readonly runCoopClock: () => void;
  private readonly runFrameDraw: () => void;
  private readonly runFrameStep: () => void;
  /** Test pages only (core/proofmode.ts): decides which frames are drawn. Null on every real player's page. */
  readonly proof = drawGate();

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.runPhysics = () => this.ctx.physics.step(this.ctx.time.dt);
    this.runCamera = () => this.ctx.camera.update?.();
    this.runFx = () => this.ctx.fx.update?.();
    this.runAudio = () => this.ctx.audio.update?.();
    this.runHud = () => this.ctx.hud.update?.();
    this.runCoop = () => this.ctx.coop?.update();
    this.runSettle = () => this.ctx.render.settle?.();
    this.runRender = () => this.ctx.render.render();
    this.runInput = () => this.ctx.input.endFrame?.();
    this.runCoopClock = () => this.ctx.coop?.world?.clock();
    this.runFrameDraw = () => this.frame(true);
    this.runFrameStep = () => this.frame(false);
  }

  /** Update order from docs/DESIGN.md section 4. */
  private frameOrder(): GameSystem[] {
    const c = this.ctx;
    return [
      c.player, c.weapons, c.viewmodel, c.enemies, c.allies ?? {}, c.waves, c.combat, c.world, c.gore, c.progression, c.contracts, c.campaign, c.camera, c.fx, c.audio, c.hud,
    ];
  }

  async init(onProgress: Progress): Promise<void> {
    const c = this.ctx;
    this.ordered = this.frameOrder();
    onProgress(BOOT.systems, 'Wiring the systems');
    await breathe();
    for (const sys of [c.render, c.physics, c.input, ...this.ordered]) {
      if (!this.freeRoamSkips(sys)) await sys.init?.(c);
      else this.deferredCoopInit.push(sys);
    }
    onProgress(BOOT.world, 'Surveying the site');
    await breathe();
    await c.world.build?.((f, label) => {
      // World's fractions follow its steps, not the clock, and its last step takes two thirds of the whole boot.
      if (f < WORLD_LIGHT_STEP) onProgress(BOOT.world + (f / WORLD_LIGHT_STEP) * (BOOT.light - BOOT.world), label);
      else if (f < 1) onProgress(BOOT.light, label, { to: BOOT.army, seconds: LIGHT_SECONDS });
    });
    onProgress(BOOT.army, 'Waking the army');
    await breathe();
    await c.characters.load?.();
    // Gore cuts each body's trunk into the pieces it breaks into now, not on the first gib of a fight.
    c.gore.warm?.();
    await c.coop?.init();
    onProgress(1, 'Ready');
    await breathe();
  }

  private freeRoamSkips(sys: GameSystem): boolean {
    const c = this.ctx;
    if (!c.coop) return false;
    // The shop and its credits are each player's own, so a world-running mode keeps its contract on every browser.
    // The allies are the host's: it runs them, and guests draw them (net/world.ts).
    // A mission runs on the host; a guest's campaign only draws what the host's mirrors to it (net/mission.ts).
    if ((sys === c.campaign && (c.coop.freeRoam || !c.coop.world)) || (sys === c.allies && (c.coop.freeRoam || !c.coop.hosting))
      || (sys === c.contracts && (c.coop.freeRoam || !c.coop.world))) return true;
    if (c.coop.freeRoam) return sys === c.enemies || sys === c.waves;
    return sys === c.waves && !c.coop.hosting;
  }

  setState(to: GameState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    if (this.ctx.coop) this.ctx.coop.localPaused = to !== 'playing';
    this.ctx.time.paused = to !== 'playing' && !(to === 'paused' && this.ctx.coop);
    this.ctx.events.emit('game:state', { from, to });
  }

  /** Empties the map, so nothing a run left behind stands frozen in the menu's flythrough. */
  clearRun(): void {
    const c = this.ctx;
    c.time.clearScales();
    for (const sys of this.ordered) if (!this.freeRoamSkips(sys)) sys.reset?.();
    c.render.reset?.();
  }

  /** Starts a fresh run. */
  newRun(): void {
    const c = this.ctx;
    if (!c.coop) reportSolo();
    // A solo run after leaving co-op gets the normal systems, initialized once against the already-built map.
    if (!c.coop && this.deferredCoopInit.length) {
      for (const sys of this.deferredCoopInit) sys.init?.(c);
      this.deferredCoopInit.length = 0;
    }
    c.time.clearScales();
    for (const sys of this.ordered) if (!this.freeRoamSkips(sys)) sys.reset?.();
    c.events.emit('run:start', {});
    // Co-op's load barrier: the host's waves (and directors, which the waves drive) wait until every player is in (net/index.ts `holding`).
    if (!c.coop || (!c.coop.freeRoam && c.coop.hosting && !c.coop.holding)) c.waves.start?.();
    this.setState('playing');
  }

  /** Rebuilds cached guard names and runners whenever `ordered` is replaced (including in tests). */
  private syncOrderedCache(): void {
    const ordered = this.ordered;
    if (this.orderedSource === ordered && this.orderedNames.length === ordered.length) return;
    this.orderedSource = ordered;
    this.orderedNames.length = ordered.length;
    this.orderedRunners.length = ordered.length;
    for (let i = 0; i < ordered.length; i++) {
      const sys = ordered[i]!;
      this.orderedNames[i] = `system-${i}-${sys.constructor.name}`;
      this.orderedRunners[i] = () => sys.update?.();
    }
  }

  /** One world step. `draw` is false on the extra steps a co-op host takes to catch up on a long frame (time.ts `split`). */
  private frame(draw = true): void {
    const c = this.ctx;
    if (this.state === 'playing' || (this.state === 'paused' && c.coop)) {
      this.syncOrderedCache();
      const ordered = this.ordered;
      const names = this.orderedNames;
      const runners = this.orderedRunners;
      for (let i = 0; i < ordered.length; i++) {
        const sys = ordered[i]!;
        if (this.freeRoamSkips(sys)) continue;
        // The load barrier holds the host's mission too: its runner opens on the campaign's first update.
        if (sys === c.campaign && c.coop?.hosting && c.coop.holding) continue;
        // Menus release local controls while the room, bodies, world and physics keep ticking.
        if (this.state === 'paused' && c.coop
          && (sys === c.player || sys === c.weapons || sys === c.viewmodel || (!c.coop.world && (sys === c.combat || sys === c.progression)))) continue;
        if (sys === c.gore) this.guard('physics', this.runPhysics);
        this.guard(names[i]!, runners[i]!);
      }
    } else {
      this.guard('camera', this.runCamera);
      this.guard('fx', this.runFx);
      this.guard('audio', this.runAudio);
      this.guard('hud', this.runHud);
    }
    this.guard('coop', this.runCoop);
    // Behind a screen nothing moves but a slow dolly, so a laptop sitting on the menu should not pay for full rate.
    // A screen with a moving picture of its own (the Crucible shop's turning gun) gets the menu's rate.
    const moving = (c.render as { backdrop?: { still: boolean } | null }).backdrop?.still === false;
    // A hidden co-op tab is ticked by a worker (run) and draws nothing: there is nobody to see it.
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (draw && !hidden && (this.state === 'playing' || c.coop || c.time.frame % (this.state === 'menu' || moving ? 2 : 4) === 0)) {
      // A proof page between its drawn frames: the scene is brought up to date for the game's own reads, and nothing is drawn.
      if (this.proof && !this.proof.due(c.time.realElapsed)) this.guard('settle', this.runSettle);
      else this.guard('render', this.runRender);
    }
    this.guard('input', this.runInput);
  }

  run(): void {
    let last = performance.now();
    let windowStart = last;
    let frames = 0;
    const step = (now: number) => {
      const raw = Math.max(0, (now - last) / 1000);
      last = Math.max(last, now);
      const t0 = performance.now();
      // One step, except on a co-op host below 20 fps: its world is everyone's, so a long frame is played out in several steps
      // and drawn once, instead of being clamped (which would run the world slow on every screen). The first step takes the
      // frame's input; `input.endFrame` at the end of each step leaves the later ones only what is still held.
      const steps = this.ctx.time.split(raw, this.cpuMs);
      for (let i = 1; i <= steps; i++) {
        // Co-op: the team's slow-mo, as the host has it, goes onto this screen's clock (net/world/clock.ts).
        this.guard('coop-clock', this.runCoopClock);
        this.ctx.time.tick(raw / steps);
        this.guard('frame', i === steps ? this.runFrameDraw : this.runFrameStep);
      }
      this.cpuMs = performance.now() - t0;
      frames++;
      if (now - windowStart >= 500) {
        this.fps = (frames * 1000) / (now - windowStart);
        windowStart = now;
        frames = 0;
      }
    };
    // Test pages only (core/proofmode.ts): the loop on a timer, so a busy GPU process cannot hold it back. False for a player.
    const clocked = tickOnProofClock(proofSwitches()?.clock ?? 0, step);
    const tick = (now: number) => {
      requestAnimationFrame(tick);
      if (!clocked) step(now);
    };
    requestAnimationFrame(tick);
    keepTickingWhenHidden(() => !!this.ctx.coop, () => step(performance.now()));
  }

  stats(): Record<string, unknown> {
    const c = this.ctx;
    return {
      fps: Math.round(this.fps),
      cpuMs: Number(this.cpuMs.toFixed(2)),
      state: this.state,
      drawCalls: c.render.drawCalls?.(),
      triangles: c.render.triangles?.(),
      enemies: c.enemies.alive?.length,
    };
  }
}

/**
 * A hidden tab gets no animation frames, and its timers are throttled to once a second. In co-op that would freeze the
 * host's world for everyone (and a guest's body and pose for the others). A dedicated worker's timer is not throttled the
 * same way, and its messages wake the page, so while hidden in co-op the game steps at 30 Hz on them, without drawing.
 * Chosen over silent keep-alive audio (unreliable once the audio context suspends, and the game suspends it when hidden)
 * and over pausing everyone (the friends would sit frozen whenever the host alt-tabs).
 */
const HIDDEN_TICK_MS = 33;
function keepTickingWhenHidden(active: () => boolean, step: () => void): void {
  if (typeof document === 'undefined' || typeof Worker === 'undefined') return;
  let worker: Worker | null = null;
  /** When the last step ended. */
  let stepped = 0;
  const sync = () => {
    const want = document.hidden && active();
    if (want && !worker) {
      try {
        const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${HIDDEN_TICK_MS});`], { type: 'text/javascript' }));
        worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = () => {
          if (!(document.hidden && active())) { sync(); return; }
          // A step that took longer than a tick leaves ticks queued behind it. Taking them all would run steps back to back
          // with no end, and the page would never reach its timers or its network (the match then drops as "lost"). The ones
          // that queued are skipped: the world's clock is the real one, so nothing is lost but the frames.
          if (performance.now() - stepped < HIDDEN_TICK_MS * 0.6) return;
          step();
          stepped = performance.now();
        };
      } catch { worker = null; }
    } else if (!want && worker) {
      worker.terminate();
      worker = null;
    }
  };
  document.addEventListener('visibilitychange', sync);
}

/**
 * A test page's loop clock (core/proofmode.ts): `step` runs `hz` times a second on a worker's timer instead of on animation
 * frames. A hidden tab is left to `keepTickingWhenHidden`, as on a player's page. False when not asked for or not possible.
 */
function tickOnProofClock(hz: number, step: (now: number) => void): boolean {
  if (!(hz > 0) || typeof document === 'undefined' || typeof Worker === 'undefined') return false;
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${1000 / hz});`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    let last = 0;
    worker.onmessage = () => {
      const now = performance.now();
      if (document.hidden || !clockDue(now, last, hz)) return;
      last = now;
      step(now);
    };
    return true;
  } catch {
    return false;
  }
}

/** Where each boot stage starts on the loading bar, sized from measured timings so the bar moves at a steady rate. */
const BOOT = { physics: 0.01, render: 0.03, audio: 0.06, gameplay: 0.09, systems: 0.1, world: 0.13, light: 0.32, army: 0.97 };
/** World's progress value for its light bake, and how long that took on an idle machine. Under load the bar waits at the end. */
const WORLD_LIGHT_STEP = 0.87;
const LIGHT_SECONDS = 7;

export async function createCtx(canvas: HTMLCanvasElement, onProgress: Progress = () => {}): Promise<Ctx> {
  const step = async (fraction: number, label: string) => {
    onProgress(fraction, label);
    await breathe();
  };
  await step(BOOT.physics, 'Loading the engine');
  const { Physics } = await importRetry(() => import('../physics/Physics'));
  const ctx = {
    time: new GameTime(),
    events: new EventBus<GameEvents>(),
    physics: await Physics.create(),
  } as unknown as Ctx;
  await step(BOOT.render, 'Mixing materials');
  ctx.render = await build('render', 'createRenderSystem', 'render', canvas);
  ctx.input = await build('input', 'createInput', 'input', canvas);
  await step(BOOT.audio, 'Tuning the mix');
  ctx.audio = await build('audio', 'createAudio', 'audio', ctx);
  ctx.fx = await build('fx', 'createFx', 'fx', ctx);
  ctx.world = await build('world', 'createWorld', 'world', ctx);
  ctx.characters = await build('characters', 'createCharacterLibrary', 'characters', ctx);
  ctx.gore = await build('gore', 'createGoreSystem', 'gore', ctx);
  await step(BOOT.gameplay, 'Loading the armoury');
  ctx.player = await build('player', 'createPlayer', 'player', ctx);
  ctx.camera = await build('player', 'createCameraRig', 'camera', ctx);
  ctx.combat = await build('weapons', 'createCombat', 'combat', ctx);
  ctx.viewmodel = await build('weapons/viewmodels', 'createViewmodels', 'viewmodel', ctx);
  ctx.weapons = await build('weapons', 'createWeapons', 'weapons', ctx);
  ctx.enemies = await build('enemies', 'createEnemies', 'enemies', ctx);
  ctx.waves = await build('enemies', 'createWaves', 'waves', ctx);
  ctx.allies = await build('allies', 'createAllies', 'allies', ctx);
  ctx.progression = await build('progression', 'createProgression', 'progression', ctx);
  ctx.contracts = await build('contracts', 'createContracts', 'contracts', ctx);
  ctx.hud = await build('ui', 'createHud', 'hud', ctx);
  ctx.campaign = await build('campaign', 'createCampaign', 'campaign', ctx);
  if (resumedLobby && resumedMatch) {
    const { CoopSession } = await importRetry(() => import('../net'));
    ctx.coop = new CoopSession(ctx, resumedLobby, resumedMatch);
  }
  return ctx;
}

/**
 * URL flags: ?contract=<id> and ?map=<id> pick the game (contracts/select.ts, which lists the rest), ?autostart=1 skips the
 * menus, ?dev=1 adds the dev panel (the dev server has it on every page unless ?dev=0), ?map=range is the Test Range. Bots
 * read window.__op2.
 */
export async function startGame(params: URLSearchParams): Promise<void> {
  // The loading screen first: reconnecting the room can take seconds (the relay credentials, the relays themselves).
  showLoading();
  await reconnectMatch();
  const report: Progress = (f, label, crawl) => loadingScreen.set(f, label, crawl);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = await createCtx(canvas, report);
  const game = new Game(ctx);
  (window as unknown as { __op2: unknown }).__op2 = { ctx, game, stats: () => game.stats(), ...(game.proof ? { proof: game.proof } : {}) };
  await game.init(report);
  game.run();
  // The lab loads where dev tools are on, and on any page once Settings > Enable cheats has been unlocked (core/cheats.ts).
  let labLoaded = false;
  const loadLab = async () => {
    if (labLoaded) return;
    labLoaded = true;
    await build('lab', 'createLab', 'lab', ctx, game);
  };
  if (DEV_TOOLS || cheatsOn()) await loadLab();
  onCheats(on => { if (on) loadLab().catch(() => { labLoaded = false; }); });
  if (ctx.coop) {
    const hud = ctx.hud as Ctx['hud'] & { startRun(): void; quitToMenu(): void;
      screens: { coopEnded(message: string, room: Room | null): void; coopRegroup(plan: Regroup): void } };
    ctx.coop.onEnded = (message, room, regroup) => {
      hud.quitToMenu();
      if (regroup) hud.screens.coopRegroup(regroup);
      else hud.screens.coopEnded(message, room);
    };
    // The world the host held while players loaded (newRun skipped it) starts now.
    ctx.coop.onGo = () => ctx.waves.start?.();
    // From here a reload of this page is a reload mid-match (net/session.ts).
    handoffUsed();
    // The map is up behind "Click to deploy": the click takes the mouse and starts this player's run, so nobody begins a
    // match in the pause menu, and the host's world waits for every player's click. A room that closed, or a match that
    // ended, during the load is told there with its real reason.
    game.setState('menu');
    ctx.hud.showScreen?.('none');
    ctx.coop.gate(() => hud.startRun());
  } else if (resumeFailed) {
    game.setState('menu');
    (ctx.hud as Ctx['hud'] & { screens: { coopEnded(message: string): void } }).screens.coopEnded(resumeFailed);
  } else if (params.get('autostart') || ON_RANGE) game.newRun();
  else if (!params.get('join') && roomToRejoin()) {
    // Reloaded on the lobby page, between matches: back into the same room (ui/screens/coop.ts `rejoin`).
    game.setState('menu');
    (ctx.hud as Ctx['hud'] & { screens: { coopRejoin(note: NonNullable<ReturnType<typeof roomToRejoin>>): void } }).screens.coopRejoin(roomToRejoin()!);
  } else {
    // An invite link to another lobby, or nothing kept: the tab is in no room.
    if (params.get('join')) forgetRoom();
    game.setState('menu');
    ctx.hud.showScreen?.('splash');
  }
}
