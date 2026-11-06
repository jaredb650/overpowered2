/**
 * The Crucible sandbox. Fly camera, ?view=<name> presets, nav and traversal checks.
 *   window.__op2.view(name)   jump to a preset
 *   window.__op2.views()      list preset names
 *   window.__op2.world        the World
 */
import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { createRenderSystem } from '../render';
import { createWorld } from '../world';
import type { World } from '../world';
import { KICKER_ANGLE } from '../world/map/core';
import { verifyMap } from '../world/verify';
import { fuzzPlayer, sweepPlayer, type SweepRig, verifyKillHouse } from '../world/verify-killhouse';
import { createInput } from '../input';
import { createCameraRig, createPlayer } from '../player';
import { makeCtx, runLoop } from './harness';
import type { RenderSystem } from '../core/contracts';

export default async function map(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render: RenderSystem = await createRenderSystem(canvas);
  const physics = await Physics.create();
  const ctx = makeCtx({ physics, render });
  const world = createWorld(ctx) as World;
  ctx.world = world;
  const progress = document.createElement('div');
  progress.style.cssText = 'position:fixed;left:16px;bottom:16px;font:13px ui-monospace,monospace;color:#9fe;z-index:5';
  document.body.appendChild(progress);
  await world.build((f, label) => { progress.textContent = `${(f * 100).toFixed(0)}% ${label}`; });
  progress.remove();
  console.log('world report', JSON.stringify(world.report));

  // A real player, driven only by the tests below. The fly camera stays in charge otherwise.
  const input = createInput(canvas);
  ctx.input = input;
  const player = createPlayer(ctx);
  ctx.player = player;
  player.init();
  const rig = createCameraRig(ctx);
  ctx.camera = rig;
  rig.init();
  let simulating = false;

  const camera = render.camera;
  camera.far = 2000;
  camera.updateProjectionMatrix();
  const views = world.spec.views;
  const span = world.bounds.max.x;
  views.top = { pos: [0, span * 1.42, 1], look: [0, 0, 0] };
  views.bird = { pos: [span * 0.87, span * 0.76, span * 1.22], look: [0, 0, -10] };
  const setView = (name: string) => {
    const v = views[name];
    if (!v) return false;
    camera.position.set(...v.pos);
    camera.lookAt(...v.look);
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    return true;
  };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  setView(params.get('view') ?? 'bird');

  const keys = new Set<string>();
  addEventListener('keydown', e => keys.add(e.code));
  addEventListener('keyup', e => keys.delete(e.code));
  canvas.addEventListener('click', () => canvas.requestPointerLock());
  addEventListener('mousemove', e => {
    if (document.pointerLockElement !== canvas) return;
    euler.y -= e.movementX * 0.0022;
    euler.x = Math.max(-1.55, Math.min(1.55, euler.x - e.movementY * 0.0022));
    camera.quaternion.setFromEuler(euler);
  });
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const flyStep = (dt: number) => {
    const speed = keys.has('ShiftLeft') ? 70 : 22;
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    if (keys.has('KeyW')) camera.position.addScaledVector(fwd, speed * dt);
    if (keys.has('KeyS')) camera.position.addScaledVector(fwd, -speed * dt);
    if (keys.has('KeyA')) camera.position.addScaledVector(right, -speed * dt);
    if (keys.has('KeyD')) camera.position.addScaledVector(right, speed * dt);
  };

  if (params.get('minimap')) {
    const img = world.minimap.image;
    img.style.cssText = 'position:fixed;inset:0;margin:auto;height:100vh;z-index:9';
    document.body.appendChild(img);
  }
  runLoop(ctx, () => {
    if (simulating) return;
    flyStep(ctx.time.realDt);
    world.update();
    physics.step(ctx.time.dt);
    render.render();
  }, () => ({ ...world.report, draws: render.drawCalls(), tris: render.triangles() }));
  const op2 = (window as unknown as { __op2: Record<string, unknown> }).__op2;
  op2.world = world;
  op2.view = setView;
  op2.views = () => Object.keys(views);
  op2.verify = () => (world.def.id === 'killhouse' ? verifyKillHouse(world, physics) : verifyMap(world, physics));
  /** Pure movement steps for the Kill House sweeps: the nav and the map objects have no part in a capsule test. */
  const sweepRig = (): SweepRig => {
    const dt = 1 / 60;
    return {
      player, input,
      step: () => {
        ctx.time.tick(dt);
        player.update();
        input.endFrame();
      },
    };
  };
  const sweeping = <T>(run: () => T): T => {
    simulating = true;
    const result = run();
    simulating = false;
    return result;
  };
  op2.sweep = () => sweeping(() => sweepPlayer(world, physics, sweepRig()));
  op2.debugRun = (x: number, z: number, dx: number, dz: number, seconds: number) => sweeping(() => {
    const rig = sweepRig();
    input.simulate('forward', false);
    player.reset();
    player.teleport(new THREE.Vector3(x, 0.05, z), Math.atan2(-dx, -dz));
    rig.step();
    input.simulate('forward', true);
    const log: unknown[] = [];
    for (let i = 0; i < seconds * 60; i++) {
      rig.step();
      if (i % 6 === 0) log.push([+(i / 60).toFixed(2), +player.position.x.toFixed(2), +player.position.y.toFixed(2), +player.position.z.toFixed(2), +player.speed.toFixed(1), player.state]);
    }
    input.simulate('forward', false);
    return log;
  });
  op2.fuzz = (seconds = 120, seed = 7) => sweeping(() => fuzzPlayer(world, physics, sweepRig(), seconds, seed));
  /** Exercises explosives and timed hazards through the public API. */
  op2.testObjects = () => {
    const o = world.objects;
    const events: unknown[] = [];
    ctx.events.on('world:explosion', e => events.push({ kind: e.kind, radius: e.radius, source: e.source }));
    const first = o.explosives[0]!;
    const collider = first.collider;
    const isExplosive = o.isExplosive(collider);
    const partial = o.damageExplosive(collider, 5, 'test');
    o.damageExplosive(collider, 1000, 'test');
    return { isExplosive, partial, aliveAfter: first.alive, events, explosives: o.explosives.length };
  };
  /** Average main-thread cost of nav with a moving target, and of 48 steering queries. */
  op2.navCost = () => {
    const nav = world.navGraph;
    const p = new THREE.Vector3(), out = new THREE.Vector3();
    const enemies = world.spawnPoints.filter(s => s.kind === 'ground').slice(0, 48).map(s => s.position);
    let update = 0, steer = 0, valid = 0;
    const frames = 240;
    for (let i = 0; i < frames; i++) {
      p.set(Math.cos(i * 0.02) * 56, 0.1, Math.sin(i * 0.02) * 56);
      nav.setTarget(p);
      const t0 = performance.now();
      nav.update();
      const t1 = performance.now();
      for (const e of enemies) if (nav.flowDirection(e, out)) valid++;
      steer += performance.now() - t1;
      update += t1 - t0;
    }
    return { updateMs: update / frames, steer48Ms: steer / frames, validRatio: valid / (frames * enemies.length), budget: nav.budget };
  };
  /** Real Player, real input, fixed steps. Proves the routes with the actual movement code. */
  op2.playerTests = () => {
    simulating = true;
    const dt = 1 / 60;
    const step = () => {
      ctx.time.tick(dt);
      player.update();
      world.update();
      physics.step(dt);
      input.endFrame();
    };
    const reset = (x: number, y: number, z: number, yaw: number) => {
      input.simulate('forward', false);
      input.simulate('jump', false);
      player.reset();
      player.teleport(new THREE.Vector3(x, y, z), yaw);
      step();
    };
    const tap = (a: 'jump') => { input.simulate(a, true); step(); input.simulate(a, false); step(); };
    const r = (n: number) => Math.round(n * 10) / 10;

    const pads: string[] = [];
    let padOk = 0;
    for (const pad of world.spec.pads) {
      reset(pad.pos.x, pad.pos.y + 0.15, pad.pos.z, 0);
      let t = 0, launched = false;
      while (t < 7) {
        step();
        t += dt;
        if (!player.grounded) launched = true;
        if (launched && player.grounded) break;
      }
      const miss = Math.hypot(player.position.x - pad.target.x, player.position.z - pad.target.z);
      const dy = player.position.y - pad.target.y;
      if (launched && miss < 5 && Math.abs(dy) < 2) padOk++;
      else pads.push(`[${pad.pos.toArray().map(Math.round)}] -> [${pad.target.toArray().map(Math.round)}] ended [${player.position.toArray().map(r)}] launched ${launched}`);
    }

    const run = (x: number, y: number, z: number, yaw: number, seconds: number, each?: (t: number) => void) => {
      reset(x, y, z, yaw);
      input.simulate('forward', true);
      let t = 0, top = 0;
      while (t < seconds) {
        step();
        t += dt;
        top = Math.max(top, Math.hypot(player.velocity.x, player.velocity.z));
        each?.(t);
      }
      input.simulate('forward', false);
      return { at: player.position.toArray().map(r), top: r(top), grounded: player.grounded };
    };
    /** Runs at a gap, jumps at the lip and double jumps at the top of the arc. */
    const leap = (x: number, y: number, z: number, yaw: number, lip: (p: THREE.Vector3) => boolean, seconds: number) => {
      let jumped = -1;
      return run(x, y, z, yaw, seconds, t => {
        if (jumped < 0 && lip(player.position)) { jumped = t; tap('jump'); }
        else if (jumped >= 0 && Math.abs(t - jumped - 0.38) < dt) tap('jump');
      });
    };
    const a = KICKER_ANGLE;
    const result = {
      pads: { ok: padOk, of: world.spec.pads.length, bad: pads },
      ringGap: leap(44, 14.1, 147, Math.PI / 2, p => p.x < 11, 4.5),
      lavaGap: leap(34, 0.1, -86, 0, p => p.z < -101, 3.6),
      rimKicker: (() => {
        const path: number[][] = [];
        const end = run(Math.cos(a) * 66, 0.1, Math.sin(a) * 66, Math.PI / 2 - a, 4, t => {
          if (Math.abs((t * 4) % 1) < dt * 4) path.push([r(t), r(Math.hypot(player.position.x, player.position.z)), r(player.position.y), r(player.velocity.y)]);
        });
        return { ...end, path };
      })(),
      viaductUp: run(52, 0.1, -52, -Math.PI / 4, 9.5),
      ringStraight: run(150, 14.1, -70, Math.PI, 8.6),
      stairs: run(-54, 0.1, -77.6, -Math.PI / 2, 1.6),
      tunnel: run(0, -7.9, 50, Math.PI, 3),
    };
    player.teleport(new THREE.Vector3(0, 0.1, 62), 0);
    simulating = false;
    return result;
  };
  op2.objectState = () => {
    const o = world.objects;
    return {
      time: ctx.time.elapsed,
      alive: o.explosives.filter(e => e.alive).length,
      total: o.explosives.length,
      hazardOnCrusher: o.hazardAt(new THREE.Vector3(38, 0.4, -130))?.kind ?? null,
      hazardInLava: o.hazardAt(new THREE.Vector3(10, -8.3, -112))?.kind ?? null,
      hazardElectric: o.hazardAt(new THREE.Vector3(112, -6.5, -20))?.kind ?? null,
      gantry: o.platformVelocity(new THREE.Vector3(0, 0, 0), new THREE.Vector3()),
    };
  };
}
