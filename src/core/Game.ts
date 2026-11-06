/**
 * Composition root and main loop.
 *
 * Systems are found by convention: src/<dir>/index.ts exports a factory. A missing module becomes a
 * no-op stub, so the game boots with whatever has been built so far.
 */
import { EventBus } from './events';
import { GameTime } from './time';
import { noop } from './stubs';
import { Physics } from '../physics/Physics';
import type { Ctx, GameEvents, GameState, GameSystem } from './contracts';
import './gameplay';

type Factory = (...args: never[]) => unknown;
const modules = import.meta.glob<Record<string, Factory>>(['../*/index.ts', '../*/*/index.ts']);

async function factory(dir: string, name: string): Promise<Factory | null> {
  const load = modules[`../${dir}/index.ts`];
  if (!load) return null;
  const mod = await load();
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
  private fps = 0;
  private cpuMs = 0;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  /** Update order from docs/DESIGN.md section 4. */
  private frameOrder(): GameSystem[] {
    const c = this.ctx;
    return [
      c.player, c.weapons, c.viewmodel, c.enemies, c.waves, c.combat, c.world, c.gore, c.progression, c.camera, c.fx, c.audio, c.hud,
    ];
  }

  async init(onProgress: (fraction: number, label: string) => void): Promise<void> {
    const c = this.ctx;
    this.ordered = this.frameOrder();
    for (const sys of [c.render, c.physics, c.input, ...this.ordered]) await sys.init?.(c);
    onProgress(0.1, 'Building the Crucible');
    await c.world.build?.((f, label) => onProgress(0.1 + f * 0.7, label));
    onProgress(0.85, 'Waking the army');
    await c.characters.load?.();
    onProgress(1, 'Ready');
  }

  setState(to: GameState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    this.ctx.time.paused = to !== 'playing';
    this.ctx.events.emit('game:state', { from, to });
  }

  /** Starts a fresh run. */
  newRun(): void {
    const c = this.ctx;
    c.time.clearScales();
    for (const sys of this.ordered) sys.reset?.();
    c.events.emit('run:start', {});
    c.waves.start?.();
    this.setState('playing');
  }

  private frame(): void {
    const c = this.ctx;
    if (this.state === 'playing') {
      for (const sys of this.ordered) {
        if (sys === c.gore) c.physics.step(c.time.dt);
        sys.update?.();
      }
    } else {
      c.camera.update?.();
      c.fx.update?.();
      c.audio.update?.();
      c.hud.update?.();
    }
    c.render.render();
    c.input.endFrame?.();
  }

  run(): void {
    let last = performance.now();
    let windowStart = last;
    let frames = 0;
    const tick = (now: number) => {
      requestAnimationFrame(tick);
      this.ctx.time.tick((now - last) / 1000);
      last = now;
      const t0 = performance.now();
      this.frame();
      this.cpuMs = performance.now() - t0;
      frames++;
      if (now - windowStart >= 500) {
        this.fps = (frames * 1000) / (now - windowStart);
        windowStart = now;
        frames = 0;
      }
    };
    requestAnimationFrame(tick);
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

export async function createCtx(canvas: HTMLCanvasElement): Promise<Ctx> {
  const ctx = {
    time: new GameTime(),
    events: new EventBus<GameEvents>(),
    physics: await Physics.create(),
  } as unknown as Ctx;
  ctx.render = await build('render', 'createRenderSystem', 'render', canvas);
  ctx.input = await build('input', 'createInput', 'input', canvas);
  ctx.audio = await build('audio', 'createAudio', 'audio', ctx);
  ctx.fx = await build('fx', 'createFx', 'fx', ctx);
  ctx.world = await build('world', 'createWorld', 'world', ctx);
  ctx.characters = await build('characters', 'createCharacterLibrary', 'characters', ctx);
  ctx.gore = await build('gore', 'createGoreSystem', 'gore', ctx);
  ctx.player = await build('player', 'createPlayer', 'player', ctx);
  ctx.camera = await build('player', 'createCameraRig', 'camera', ctx);
  ctx.combat = await build('weapons', 'createCombat', 'combat', ctx);
  ctx.viewmodel = await build('weapons/viewmodels', 'createViewmodels', 'viewmodel', ctx);
  ctx.weapons = await build('weapons', 'createWeapons', 'weapons', ctx);
  ctx.enemies = await build('enemies', 'createEnemies', 'enemies', ctx);
  ctx.waves = await build('enemies', 'createWaves', 'waves', ctx);
  ctx.progression = await build('progression', 'createProgression', 'progression', ctx);
  ctx.hud = await build('ui', 'createHud', 'hud', ctx);
  return ctx;
}

/**
 * URL flags: ?autostart=1 skips the menus. Bots read window.__op2.
 */
export async function startGame(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = await createCtx(canvas);
  const game = new Game(ctx);
  (window as unknown as { __op2: unknown }).__op2 = { ctx, game, stats: () => game.stats() };
  await game.init((f, label) => ctx.hud.loading?.(f, label));
  game.run();
  if (params.get('autostart')) game.newRun();
  else {
    game.setState('menu');
    ctx.hud.showScreen?.('splash');
  }
}
