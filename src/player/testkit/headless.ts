/** Runs the real player on real Rapier without a browser, for vitest and for quick tuning from the shell. */
import { EventBus } from '../../core/events';
import { GameTime } from '../../core/time';
import { noop } from '../../core/stubs';
import type { Action, Ctx, GameEvents, InputSystem } from '../../core/contracts';
import { Physics } from '../../physics/Physics';
import { CameraRigSystem } from '../CameraRig';
import { Player } from '../Player';
import type { Bot, BotApi } from './bots';
import { addCourseToPhysics, buildCourse } from './course';
import * as THREE from 'three';

/** The InputSystem contract with no DOM behind it. */
export class HeadlessInput implements Partial<InputSystem> {
  private down = new Set<Action>();
  private pressedSet = new Set<Action>();
  private releasedSet = new Set<Action>();
  private lx = 0;
  private ly = 0;
  private out = { x: 0, y: 0 };
  frameLook = { x: 0, y: 0 };
  locked = false;
  isDown(a: Action): boolean { return this.down.has(a); }
  pressed(a: Action): boolean { return this.pressedSet.has(a); }
  released(a: Action): boolean { return this.releasedSet.has(a); }
  consumeLook(): { x: number; y: number } {
    this.out.x = this.lx;
    this.out.y = this.ly;
    this.lx = this.ly = 0;
    return this.out;
  }
  consumeWheel(): number { return 0; }
  simulate(a: Action, down: boolean): void {
    const was = this.down.has(a);
    if (down && !was) { this.down.add(a); this.pressedSet.add(a); }
    if (!down && was) { this.down.delete(a); this.releasedSet.add(a); }
  }
  simulateLook(dx: number, dy: number): void { this.lx += dx; this.ly += dy; }
  endFrame(): void { this.pressedSet.clear(); this.releasedSet.clear(); }
}

export interface HeadlessGame {
  ctx: Ctx;
  player: Player;
  camera: CameraRigSystem;
  input: InputSystem;
  frame(dt: number): void;
  run(bot: Bot, fps: number, metrics?: Record<string, unknown>): Record<string, unknown>;
}

export async function createHeadlessGame(build?: (physics: Physics) => void): Promise<HeadlessGame> {
  const physics = await Physics.create();
  const camera3 = new THREE.PerspectiveCamera(90, 16 / 9, 0.05, 2000);
  const view3 = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 10);
  const input = new HeadlessInput() as unknown as InputSystem;
  const ctx = {
    time: new GameTime(),
    events: new EventBus<GameEvents>(),
    input,
    physics,
    render: Object.assign(noop('render'), {}) as Ctx['render'],
    world: noop('world'),
    characters: noop('characters'),
    gore: noop('gore'),
    fx: noop('fx'),
    audio: noop('audio'),
  } as unknown as Ctx;
  // noop proxies swallow writes, so the render stand-in has to be a plain object carrying real cameras.
  ctx.render = { camera: camera3, viewCamera: view3, post: noop('post'), lights: noop('lights') } as unknown as Ctx['render'];
  if (build) build(physics);
  else addCourseToPhysics(physics, buildCourse());
  physics.flushQueries();

  const player = new Player(ctx);
  ctx.player = player;
  const camera = new CameraRigSystem(ctx);
  ctx.camera = camera;
  player.init();
  camera.init();

  const frame = (dt: number) => {
    ctx.time.tick(dt);
    player.update();
    camera.update();
    input.endFrame();
  };

  const run = (bot: Bot, fps: number, metrics: Record<string, unknown> = {}) => {
    const dt = 1 / fps;
    const api: BotApi = {
      ctx, player, input,
      frameDt: () => dt,
      metric: (k, v) => { metrics[k] = v; },
    };
    const gen = bot(api);
    for (let i = 0; i < fps * 300; i++) {
      if (gen.next().done) break;
      frame(dt);
    }
    return metrics;
  };

  return { ctx, player, camera, input, frame, run };
}
