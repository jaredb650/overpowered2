/**
 * Helpers for sandboxes: isolated test pages at /?sandbox=<name>.
 * makeCtx builds a Ctx where anything you do not pass in is a no-op stub, so you can run
 * one real system with the rest absent. Install the systems you need in the order they depend on each other.
 */
import { EventBus } from '../core/events';
import { GameTime } from '../core/time';
import { noop } from '../core/stubs';
import type { Ctx, GameEvents } from '../core/contracts';

export function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  const ctx = {
    time: new GameTime(),
    events: new EventBus<GameEvents>(),
    input: noop('input'),
    render: noop('render'),
    physics: noop('physics'),
    world: noop('world'),
    characters: noop('characters'),
    gore: noop('gore'),
    fx: noop('fx'),
    audio: noop('audio'),
    player: noop('player'),
    camera: noop('camera'),
    ...overrides,
  } as Ctx;
  return ctx;
}

export interface SandboxStats {
  fps: number;
  frameMs: number;
  frames: number;
  [key: string]: unknown;
}

/**
 * Runs `frame` every animation frame after ticking the clock, and publishes window.__op2 so
 * tools/shot.mjs can read stats. `extra` may add fields to the stats object.
 */
export function runLoop(ctx: Ctx, frame: () => void, extra?: () => Record<string, unknown>): void {
  let last = performance.now();
  let frames = 0;
  let windowStart = last;
  let windowFrames = 0;
  let fps = 0;
  let frameMs = 0;
  (window as unknown as { __op2: unknown }).__op2 = {
    ctx,
    stats: (): SandboxStats => ({ fps, frameMs, frames, ...(extra?.() ?? {}) }),
  };
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    ctx.time.tick((now - last) / 1000);
    last = now;
    const t0 = performance.now();
    frame();
    frameMs = performance.now() - t0;
    frames++;
    windowFrames++;
    if (now - windowStart >= 500) {
      fps = (windowFrames * 1000) / (now - windowStart);
      windowStart = now;
      windowFrames = 0;
    }
  };
  requestAnimationFrame(tick);
}
