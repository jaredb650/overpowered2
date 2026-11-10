/**
 * Viewmodel test page.
 *   ?weapon=<id>                 smg harrow shotgun thresher rocket quiver sabot autocannon sword judge rivet lance buzzsaw kiln stakegun walkie designator grenade
 *   ?view=inspect                model on its own at inspection scale. &yaw= &pitch= &dist= &fx= &fy= &fz= aim the camera at a point
 *   ?view=fp (default)           real first-person rig. &pose=idle|fire|reload|draw
 *   &engine=1 real renderer and baked hall, &manual=1 stepped clock. window.__vm exposes the rig and that clock.
 */
import * as THREE from 'three';
import { createRenderSystem, type Renderer } from '../render';
import { makeCtx, runLoop } from './harness';
import type { BakedLight, Ctx, WorldMaterialName } from '../core/contracts';
import type { WeaponId } from '../core/gameplay';
import { createViewmodels } from '../weapons/viewmodels';
import type { Rig } from '../weapons/viewmodels/rig';
import { Kit } from '../weapons/viewmodels/kit/kit';
import type { Model } from '../weapons/viewmodels/kit/model';
import { buildOffhand } from '../weapons/viewmodels/models';

interface Box { c: [number, number, number]; h: [number, number, number]; m: WorldMaterialName; }

function hall(): Box[] {
  const b: Box[] = [];
  b.push({ c: [0, -0.5, 0], h: [30, 0.5, 30], m: 'concrete' });
  b.push({ c: [0, 5, -24], h: [30, 6, 1], m: 'concrete' });
  b.push({ c: [0, 5, 24], h: [30, 6, 1], m: 'concreteDark' });
  b.push({ c: [-24, 5, 0], h: [1, 6, 30], m: 'concrete' });
  b.push({ c: [24, 5, 0], h: [1, 6, 30], m: 'concrete' });
  b.push({ c: [-14, 11.5, 0], h: [10, 0.5, 30], m: 'concreteDark' });
  b.push({ c: [14, 11.5, 0], h: [10, 0.5, 30], m: 'concreteDark' });
  for (const x of [-12, 12]) for (const z of [-12, 0, 12]) b.push({ c: [x, 5, z], h: [0.9, 6, 0.9], m: 'concrete' });
  b.push({ c: [-6, 1, -9], h: [1.5, 1, 1.5], m: 'steelDark' });
  b.push({ c: [6, 1.4, -11], h: [2, 1.4, 1.2], m: 'panel' });
  b.push({ c: [0, 7.5, -22.9], h: [16, 0.06, 0.06], m: 'emissiveCyan' });
  b.push({ c: [0, 3.5, -22.9], h: [16, 0.06, 0.06], m: 'emissiveCyan' });
  return b;
}

const LIGHTS: { p: [number, number, number]; c: number; i: number; r: number }[] = [
  { p: [0, 7, -20], c: 0x4fd8ff, i: 80, r: 26 },
  { p: [-10, 5, -4], c: 0x6fa0ff, i: 40, r: 22 },
  { p: [10, 5, 2], c: 0xbdd4ff, i: 40, r: 22 },
  { p: [0, 3, 8], c: 0x87b6ff, i: 40, r: 20 },
];

/** Stand-in for RenderSystem while the engine renderer is unavailable. Same camera setup as the view pass. */
function localStudio(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const viewScene = new THREE.Scene();
  viewScene.background = new THREE.Color(0x1a2029);
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x5a6a7c);
  const panel = (c: number, i: number, x: number, y: number, z: number, w: number, h: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  panel(0xcfe4ff, 7, 0, 10, 2, 14, 5);
  panel(0x5fd8ff, 9, -9, 2, -6, 2, 12);
  panel(0x7fa0ff, 5, 9, 3, 5, 4, 10);
  panel(0xe8f0ff, 12, 3, 6, -9, 8, 1);
  panel(0x202830, 1, 0, -8, 0, 40, 40);
  const pm = new THREE.PMREMGenerator(renderer);
  viewScene.environment = pm.fromScene(env, 0.02).texture;
  const key = new THREE.DirectionalLight(0xe4ecff, 3.4);
  key.position.set(-2, 3, 2);
  viewScene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd4ff, 1.6);
  rim.position.set(3, 1, -2);
  viewScene.add(rim);
  viewScene.add(new THREE.AmbientLight(0x9fb4cc, 1.1));
  const viewCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 12);
  return {
    renderer, viewScene, viewCamera,
    materials: { patch: <T extends THREE.MeshStandardMaterial>(m: T): T => m },
    render: () => renderer.render(viewScene, viewCamera),
    drawCalls: () => renderer.info.render.calls,
    triangles: () => renderer.info.render.triangles,
  };
}

async function engineStage(canvas: HTMLCanvasElement, q: number): Promise<Renderer> {
  const render = (await createRenderSystem(canvas)) as Renderer;
  render.init(makeCtx({ render }));
  render.setQuality(q);
  const boxes = hall();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (const b of boxes) {
    const mesh = new THREE.Mesh(unit, render.materials.world(b.m));
    mesh.position.set(...b.c);
    mesh.scale.set(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2);
    mesh.castShadow = true;
    render.scene.add(mesh);
  }
  const lights: BakedLight[] = LIGHTS.map(l => ({ position: new THREE.Vector3(...l.p), color: l.c, intensity: l.i, radius: l.r }));
  const solids = boxes.filter(b => !b.m.startsWith('emissive'));
  await render.bakeLightVolume({
    bounds: new THREE.Box3(new THREE.Vector3(-25, -1, -25), new THREE.Vector3(25, 13, 25)),
    lights,
    isSolid: (x, y, z) => solids.some(b => Math.abs(x - b.c[0]) <= b.h[0] && Math.abs(y - b.c[1]) <= b.h[1] && Math.abs(z - b.c[2]) <= b.h[2]),
  });
  render.camera.position.set(0, 1.7, 6);
  render.camera.lookAt(0, 2.2, -20);
  return render;
}

/** A player that scripts can steer without a world. */
function fakePlayer() {
  return {
    position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.7, 6), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    yaw: 0, pitch: 0, health: 87, maxHealth: 100, armor: 40, grounded: true, sliding: false, wallRunning: false, dashing: false, alive: true,
    stridePhase: 0, wallSide: 0, state: 'ground',
  };
}

export default async function viewmodelSandbox(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render = params.get('engine') ? await engineStage(canvas, Number(params.get('q') ?? 2)) : localStudio(canvas);
  const weapon = params.get('weapon') ?? 'smg';
  const view = params.get('view') ?? 'fp';
  const pose = params.get('pose') ?? 'idle';
  const manual = params.has('manual');
  const player = fakePlayer();
  const ammo = { mag: Number(params.get('mag') ?? 24), magSize: 30, reserve: 90, maxReserve: 200 };
  const fakeWeapons = { ammo: () => ammo, grenades: 3, reloading: true };
  const fakeProgression = { targeting: null as string | null };
  const inputDown = { grenade: false };
  const ctx = makeCtx({
    render: render as unknown as Ctx['render'],
    player: player as unknown as Ctx['player'],
    weapons: fakeWeapons as unknown as Ctx['weapons'],
    progression: fakeProgression as unknown as Ctx['progression'],
    input: { isDown: (k: string) => k === 'grenade' && inputDown.grenade } as unknown as Ctx['input'],
  });
  if (!params.get('engine')) {
    const r = render as unknown as { camera: THREE.PerspectiveCamera };
    r.camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, 0.1, 1000);
    r.camera.position.copy(player.eye);
    r.camera.updateMatrixWorld();
  }

  const t0 = performance.now();
  const rig = createViewmodels(ctx) as Rig;
  await rig.init(ctx);
  console.log(`[vm] rig built in ${(performance.now() - t0).toFixed(0)} ms`);

  if (view === 'inspect') {
    const kit = new Kit(rig.mats);
    const off = buildOffhand(kit);
    const devices: Record<string, Model> = { walkie: off.walkie, designator: off.designator, grenade: off.grenade };
    const pivot = new THREE.Group();
    rig.root.visible = false;
    render.viewScene.add(pivot);
    let shown: Model | null = null;
    /** Puts one model on the turntable. A script can walk the whole arsenal without reloading the page. */
    const show = (id: string): { triangles: number; draws: number } => {
      const model = devices[id] ?? rig.allDefs[id]?.model;
      if (!model) throw new Error(`no model ${id}`);
      if (shown) pivot.remove(shown.root);
      shown = model;
      model.root.visible = true;
      model.root.parent?.remove(model.root);
      pivot.add(model.root);
      const def = rig.allDefs[id];
      if (def?.readout) {
        rig.a.model = model;
        rig.a.mag = ammo.mag;
        rig.a.magSize = ammo.magSize;
        def.readout(rig.a);
      }
      return { triangles: model.triangles, draws: model.draws };
    };
    const aim = (yawDeg: number, pitchDeg: number, dist: number, fx: number, fy: number, fz: number) => {
      pivot.position.set(0, 0, -dist);
      pivot.rotation.set(pitchDeg * Math.PI / 180, yawDeg * Math.PI / 180, 0, 'XYZ');
      shown?.root.position.set(-fx, -fy, -fz);
    };
    const info = show(weapon);
    aim(Number(params.get('yaw') ?? 150), Number(params.get('pitch') ?? 10), Number(params.get('dist') ?? 0.75),
      Number(params.get('fx') ?? 0), Number(params.get('fy') ?? 0.02), Number(params.get('fz') ?? -0.08));
    (window as unknown as { __vm: unknown }).__vm = { rig, pivot, show, aim, ids: () => [...Object.keys(rig.allDefs), ...Object.keys(devices)] };
    runLoop(ctx, () => render.render(), () => ({ calls: render.drawCalls(), tris: render.triangles(), ...info }));
    return;
  }

  rig.equip(weapon as WeaponId, pose === 'draw' ? 0.25 : 0.01);
  if (pose === 'reload') rig.reload(1.2);
  if (pose === 'fire') rig.fire(1);

  const api = {
    rig, ctx, player, ammo, fakeWeapons, fakeProgression, inputDown,
    /** Advances exactly `seconds` of game time in 1/120 s steps. Only meaningful with ?manual. */
    step(seconds: number): void {
      const n = Math.max(1, Math.round(seconds * 120));
      for (let i = 0; i < n; i++) {
        ctx.time.tick(1 / 120);
        player.stridePhase += (player.velocity.length() / 120) * 0.42;
        rig.update();
      }
    },
    perk(id: string, on: boolean): void {
      ctx.events.emit(on ? 'perk:start' : 'perk:end', { id, seconds: 5, label: id, color: '#fff' } as never);
    },
    /** Moves the view camera to look at the rig from outside. */
    cam(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
      render.viewCamera.position.set(px, py, pz);
      render.viewCamera.lookAt(tx, ty, tz);
      render.viewCamera.updateMatrixWorld();
    },
    muzzleCheck() {
      const w = new THREE.Vector3();
      rig.muzzle(w);
      return w.toArray();
    },
  };
  (window as unknown as { __vm: unknown }).__vm = api;

  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (!manual) {
      ctx.time.tick(1 / 60);
      player.stridePhase += (player.velocity.length() / 60) * 0.42;
      rig.update();
    }
    render.render();
    void now;
  };
  requestAnimationFrame(loop);
  (window as unknown as { __op2: unknown }).__op2 = { ctx, stats: () => ({ calls: render.drawCalls(), tris: render.triangles() }) };
}
