/**
 * Movement test course on the real renderer, with an on-screen speedometer.
 *
 * Click to capture the mouse and play: WASD, Space, Shift dash, Ctrl or C slide and slam. Keys 1-9 and 0 jump to a
 * lane, R restarts the lane, T runs the chain bot.
 *
 * URL: ?bot=<name> runs one bot on load, ?lane=<name> starts in that lane, ?q=0..3 sets quality, ?map=1 plays on the
 * real Crucible instead of the course and adds the `mapstress` bot.
 *
 * tools/scripts/movement-bot.mjs drives this page through window.__movement.
 */
import * as THREE from 'three';
import { createRenderSystem, type Renderer } from '../render';
import { Physics } from '../physics/Physics';
import { createInput } from '../input';
import { createCameraRig, createPlayer, MOVE } from '../player';
import { BOTS, stressBot, type Bot, type BotApi, type BotStep } from '../player/testkit/bots';
import { LANES, addCourseToPhysics, boxRotation, buildCourse } from '../player/testkit/course';
import { createFx } from '../fx';
import { createWorld } from '../world';
import { makeCtx, runLoop } from './harness';
import type { BakedLight, Ctx } from '../core/contracts';

type LaneName = keyof typeof LANES;
const LANE_KEYS: LaneName[] = ['strafe', 'wall', 'ramp', 'stairs', 'gaps', 'mantle', 'pad', 'low', 'corner', 'curbs'];
const TRAIL_SECONDS = 12;

function buildWorld(render: Renderer, course: ReturnType<typeof buildCourse>): void {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const q = new THREE.Quaternion();
  for (const b of course.boxes) {
    const mesh = new THREE.Mesh(unit, render.materials.world(b.material));
    mesh.position.set(...b.center);
    mesh.scale.set(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2);
    const r = boxRotation(b, q);
    if (r) mesh.quaternion.copy(r);
    mesh.castShadow = !b.decor;
    mesh.receiveShadow = true;
    render.scene.add(mesh);
  }
  for (const m of course.meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, render.materials.world(m.material));
    mesh.castShadow = true;
    render.scene.add(mesh);
  }
  for (const s of course.signs) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const c = canvas.getContext('2d')!;
    c.font = 'bold 84px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#9fe8ff';
    c.fillText(s.text, 256, 64);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
    sprite.position.set(...s.position);
    sprite.scale.set(8, 2, 1);
    render.scene.add(sprite);
  }
}

/** Speedometer, state, dash pips and a rolling speed trace. Plain DOM over the canvas. */
class Readout {
  private root = document.createElement('div');
  private speed = document.createElement('div');
  private state = document.createElement('div');
  private detail = document.createElement('div');
  private graph = document.createElement('canvas');
  private trail = new Float32Array(240);
  private head = 0;
  private sampleT = 0;

  constructor() {
    this.root.style.cssText = 'position:fixed;left:20px;bottom:20px;font:13px ui-monospace,Menlo,monospace;color:#cfeeff;text-shadow:0 1px 2px #000;pointer-events:none;z-index:10';
    this.speed.style.cssText = 'font:700 56px ui-monospace,Menlo,monospace;line-height:1';
    this.state.style.cssText = 'font:700 18px ui-monospace,Menlo,monospace;letter-spacing:2px;margin:4px 0;color:#40e0ff';
    this.detail.style.cssText = 'white-space:pre;opacity:.85';
    this.graph.width = 360;
    this.graph.height = 80;
    this.graph.style.cssText = 'display:block;margin-top:8px;background:rgba(0,10,20,.45)';
    this.root.append(this.speed, this.state, this.detail, this.graph);
    document.body.appendChild(this.root);
  }

  update(ctx: Ctx, dt: number, bot: string | null): void {
    const p = ctx.player;
    const s = p.speed;
    this.speed.textContent = s.toFixed(1);
    this.speed.style.color = s > MOVE.softCap ? '#ff5040' : s > 30 ? '#ffb020' : s > MOVE.runSpeed + 0.5 ? '#ffe9a0' : '#cfeeff';
    this.state.textContent = `${p.state.toUpperCase()}${p.crouched ? ' +CROUCH' : ''}`;
    const pips = '#'.repeat(Math.floor(p.dashCharges)) + '.'.repeat(MOVE.dashCharges - Math.floor(p.dashCharges));
    this.detail.textContent =
      `m/s  fov ${ctx.camera.fov.toFixed(1)}  dash [${pips}]\n` +
      `vy ${p.velocity.y.toFixed(1).padStart(6)}  y ${p.position.y.toFixed(2)}  hp ${p.health.toFixed(0)}/${p.armor.toFixed(0)}\n` +
      (bot ? `bot: ${bot}` : 'click to capture the mouse');
    this.sampleT += dt;
    if (this.sampleT >= TRAIL_SECONDS / this.trail.length) {
      this.sampleT = 0;
      this.trail[this.head] = s;
      this.head = (this.head + 1) % this.trail.length;
      this.draw();
    }
  }

  private draw(): void {
    const g = this.graph.getContext('2d')!;
    const { width: w, height: h } = this.graph;
    const scale = h / 60;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,220,255,.25)';
    g.beginPath();
    for (const mark of [MOVE.runSpeed, MOVE.softCap]) {
      g.moveTo(0, h - mark * scale);
      g.lineTo(w, h - mark * scale);
    }
    g.stroke();
    g.strokeStyle = '#40e0ff';
    g.beginPath();
    for (let i = 0; i < this.trail.length; i++) {
      const v = this.trail[(this.head + i) % this.trail.length]!;
      const x = (i / this.trail.length) * w;
      const y = h - v * scale;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

export default async function movementSandbox(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render = (await createRenderSystem(canvas)) as Renderer;
  const physics = await Physics.create();
  const input = createInput(canvas);
  const ctx = makeCtx({ render, physics, input });
  render.init(ctx);
  if (params.get('q')) render.setQuality(Number(params.get('q')));

  ctx.fx = createFx(ctx);
  ctx.fx.init?.(ctx);
  const onMap = params.get('map') !== null;
  const course = buildCourse();
  if (onMap) {
    const world = createWorld(ctx);
    ctx.world = world;
    await world.build();
  } else {
    addCourseToPhysics(physics, course);
    physics.flushQueries();
    buildWorld(render, course);
    const lights: BakedLight[] = [];
    for (let x = -40; x <= 640; x += 60) {
      for (const z of [-30, -120]) lights.push({ position: new THREE.Vector3(x, 12, z), color: 0x9fd8ff, intensity: 90, radius: 70 });
    }
    await render.bakeLightVolume({
      bounds: new THREE.Box3(new THREE.Vector3(-60, -1, -300), new THREE.Vector3(660, 30, 60)),
      lights,
      isSolid: () => false,
    });
  }

  const player = createPlayer(ctx);
  const camera = createCameraRig(ctx);
  ctx.player = player;
  ctx.camera = camera;
  player.init();
  camera.init();

  const startLane = (params.get('lane') as LaneName | null) ?? 'strafe';
  const respawn = (lane: LaneName) => {
    if (onMap) player.reset();
    else player.teleport(new THREE.Vector3(LANES[lane], 0.2, 8), 0);
  };
  respawn(startLane);
  let lastLane = startLane;
  if (onMap) {
    const spots = ctx.world.pickupSpots;
    BOTS.mapstress = stressBot(Number(params.get('seconds') ?? 300), Number(params.get('seed') ?? 11), b => {
      b.input.consumeLook();
      player.modifiers.invulnerable = true;
      const spot = spots[Math.floor(Math.random() * spots.length)]!;
      player.teleport(spot.clone().setY(spot.y + 1), Math.random() * 6.28);
    });
  }

  // A stand-in gun, so shake and landing feel can be judged against something in the viewmodel pass.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.3), render.materials.world('steelDark'));
  gun.position.set(0.16, -0.14, -0.4);
  render.viewScene.add(gun);

  const readout = new Readout();
  const results: Record<string, unknown> = {};
  let running: { name: string; gen: BotStep; done: (m: Record<string, unknown>) => void } | null = null;
  let frameDt = 1 / 60;

  const api: BotApi = {
    ctx,
    player,
    input,
    frameDt: () => frameDt,
    metric: (k, v) => { results[k] = v; },
  };

  const padCooldown = { t: 0 };
  const updatePads = () => {
    padCooldown.t -= ctx.time.playerDt;
    if (padCooldown.t > 0) return;
    for (const pad of course.pads) {
      const dx = player.position.x - pad.center.x;
      const dz = player.position.z - pad.center.z;
      if (Math.hypot(dx, dz) < pad.radius && Math.abs(player.position.y - pad.center.y) < 0.6) {
        player.launch(pad.velocity);
        padCooldown.t = 0.4;
      }
    }
  };

  let held = false;

  const frame = () => {
    if (held) return;
    if (running) {
      frameDt = ctx.time.realDt;
      if (running.gen.next().done) {
        const finished = running;
        running = null;
        finished.done({ ...results });
      }
    }
    player.update();
    updatePads();
    if (onMap) ctx.world.update?.();
    camera.update();
    ctx.fx.update?.();
    readout.update(ctx, ctx.time.realDt, running?.name ?? null);
    render.render();
    input.endFrame();
  };

  /** Runs a bot live, one rendered frame per step. Resolves with its metrics. */
  const runBot = (name: string): Promise<Record<string, unknown>> =>
    new Promise(resolve => {
      for (const k of Object.keys(results)) delete results[k];
      running = { name, gen: (BOTS[name] as Bot)(api), done: resolve };
    });

  /** Runs a bot with no rendering at a fixed frame rate, faster than real time and deterministic. */
  const runFast = (name: string, fps = 60): Record<string, unknown> => {
    for (const k of Object.keys(results)) delete results[k];
    const dt = 1 / fps;
    frameDt = dt;
    const gen = (BOTS[name] as Bot)(api);
    for (let i = 0; i < fps * 1200; i++) {
      if (gen.next().done) break;
      ctx.time.tick(dt);
      player.update();
      updatePads();
      if (onMap) ctx.world.update?.();
      camera.update();
      input.endFrame();
    }
    return { ...results };
  };

  /**
   * Starts a bot paused, for screenshots of exact moments: the harness cannot catch a 0.1 s event in real time.
   * `advanceUntil` then steps it at 60 fps until the expression is true, draws that frame and holds it.
   */
  let stepped: BotStep | null = null;
  const startBot = (name: string) => {
    held = true;
    frameDt = 1 / 60;
    stepped = (BOTS[name] as Bot)(api);
  };
  const advanceUntil = (expression: string, maxFrames = 1200): boolean => {
    const test = new Function('p', 'c', `return (${expression})`) as (p: typeof player, c: typeof camera) => boolean;
    for (let i = 0; i < maxFrames; i++) {
      if (!stepped || stepped.next().done) return false;
      ctx.time.tick(1 / 60);
      player.update();
      updatePads();
      camera.update();
      ctx.fx.update?.();
      input.endFrame();
      if (test(player, camera)) {
        readout.update(ctx, 1 / 60, null);
        render.render();
        return true;
      }
    }
    return false;
  };
  const release = () => { held = false; };

  canvas.addEventListener('click', () => { if (!input.locked) input.requestLock(); });
  addEventListener('keydown', e => {
    if (e.code === 'KeyR') respawn(lastLane);
    if (e.code === 'KeyT') void runBot('chain');
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) {
      const lane = LANE_KEYS[(Number(digit[1]) + 9) % 10];
      if (lane) {
        lastLane = lane;
        respawn(lane);
      }
    }
  });

  Object.assign(window, { __movement: { ctx, player, camera, input, MOVE, LANES, BOTS: Object.keys(BOTS), runBot, runFast, respawn, startBot, advanceUntil, release } });

  runLoop(ctx, frame, () => ({
    speed: player.speed,
    state: player.state,
    y: player.position.y,
    fov: camera.fov,
    calls: render.drawCalls(),
    tris: render.triangles(),
  }));

  const bot = params.get('bot');
  if (bot) void runBot(bot).then(m => console.log('bot', bot, JSON.stringify(m)));
}
