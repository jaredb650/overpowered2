/**
 * Character sandbox on the real renderer: a cold concrete hall with baked light.
 *
 *   /?sandbox=models                                  line-up of the whole cast
 *   /?sandbox=models&archetype=husk&view=front        one character. view: front, three, side, back, close, face, feet
 *   &anim=idle|run|<AnimAction>&speed=<m/s>           locomotion on a treadmill, or an action on a loop
 *   &cut=armL,legR,head                               severs regions and lays the parts out beside the body
 *   &bench=48                                         crowd for measuring animation cost
 *   &q=0..3                                           render quality
 *
 * window.__m exposes pause(), step(dt), camera(view) and the character, for frame-by-frame gait captures.
 */
import * as THREE from 'three';
import { createRenderSystem, type Renderer } from '../render';
import { makeCtx, runLoop } from './harness';
import { createCharacterLibrary, ARCHETYPES } from '../characters/index';
import type { Character } from '../characters/Character';
import type { AnimAction, BakedLight, LocomotionInput } from '../core/contracts';
import type { GoreRegion } from '../characters/rig';

const ACTIONS: readonly string[] = ['attackMelee', 'attackHeavy', 'shoot', 'throw', 'leap', 'land', 'roar', 'stagger', 'block', 'deathStumble'];

const REGION_BONE = (c: Character, r: GoreRegion): number => {
  // The severable bone nearest the top of the region's chain.
  let found = -1;
  c.rig.bones.forEach((b, i) => {
    if (found < 0 && b.severable && b.region === r) found = i;
  });
  return found;
};

export default async function models(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render = (await createRenderSystem(canvas)) as Renderer;
  const ctx = makeCtx({ render });
  render.init(ctx);
  if (params.get('q')) render.setQuality(Number(params.get('q')));
  const lib = createCharacterLibrary(ctx);
  ctx.characters = lib;

  // Stage: floor, back wall, side walls. Colder and darker than anything standing on it.
  const dark = render.materials.world('concreteDark');
  const box = (c: [number, number, number], h: [number, number, number], m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2), m);
    mesh.position.set(...c);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    render.scene.add(mesh);
  };
  box([0, -0.5, 0], [60, 0.5, 40], dark);
  box([0, 12, -16], [60, 12, 0.5], dark);
  const lights: BakedLight[] = [
    { position: new THREE.Vector3(-4, 3.5, 6), color: 0xe8f0ff, intensity: 300, radius: 26 },
    { position: new THREE.Vector3(6, 2.5, 5), color: 0xb4ccff, intensity: 200, radius: 22 },
    { position: new THREE.Vector3(0, 1.2, 8), color: 0xc8d8ff, intensity: 220, radius: 22 },
    { position: new THREE.Vector3(0, 5, -7), color: 0x48e8ff, intensity: 90, radius: 20 },
    { position: new THREE.Vector3(-16, 7, 6), color: 0xd8e6ff, intensity: 130, radius: 28 },
    { position: new THREE.Vector3(16, 7, 6), color: 0xd8e6ff, intensity: 130, radius: 28 },
  ];
  await render.bakeLightVolume({
    bounds: new THREE.Box3(new THREE.Vector3(-30, -1, -16), new THREE.Vector3(30, 20, 20)),
    lights,
    isSolid: (_x, y, z) => y < 0 || z < -15.5,
    voxelSize: 1.5,
  });
  render.passes.fog = false;

  const loco: LocomotionInput = { speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true };
  const live: Character[] = [];
  const single = params.get('archetype');
  const bench = Number(params.get('bench') ?? 0);
  const anim = params.get('anim') ?? 'idle';
  let speed = Number(params.get('speed') ?? (anim === 'run' ? 6 : 0));
  const isAction = ACTIONS.includes(anim);

  const place = (id: string, x: number, z: number, yaw = 0) => {
    const c = lib.spawn(id) as unknown as Character;
    c.root.position.set(x, id === 'drone' ? 1.8 : 0, z);
    c.root.rotation.y = yaw;
    render.scene.add(c.root);
    c.anim.treadmill = true;
    live.push(c);
    return c;
  };

  let focus: Character | null = null;
  if (single) {
    await lib.load([single]);
    focus = place(single, 0, 0);
    const cuts = (params.get('cut') ?? '').split(',').filter(Boolean) as GoreRegion[];
    if (cuts.length) {
      for (let i = 0; i < 3; i++) focus.anim.update(1 / 60, 0);
      render.scene.updateMatrixWorld(true);
      cuts.forEach((r, i) => {
        const bone = REGION_BONE(focus!, r);
        if (bone < 0) return;
        const part = focus!.spawnSevered(bone);
        focus!.hideLimb(bone);
        const b = part.bones[bone]!;
        b.position.set(1 + i * 0.7, 0.5, 0.6 - i * 0.3);
        part.root.updateMatrixWorld(true);
      });
      const baked = params.has('bake') ? focus.bakePose() : null;
      if (baked) {
        const m = new THREE.Mesh(baked, focus.mesh.material as THREE.Material);
        m.position.x = -1.4;
        render.scene.add(m);
      }
    }
    if (params.has('blood')) focus.setBloodiness(Number(params.get('blood')));
    if (params.has('burn')) focus.setBurn(Number(params.get('burn')));
    if (params.has('frost')) focus.setFrost(Number(params.get('frost')));
    if (params.has('wounds')) {
      const r = new THREE.Vector3();
      for (let i = 0; i < 6; i++) focus.addWound(2, r.set(-0.1 + i * 0.05, 1.2 + (i % 3) * 0.1, 0.14), 0.05);
    }
  } else if (bench) {
    await lib.load();
    const ids = ARCHETYPES.filter(a => !a.onRequest && a.id !== 'titan' && a.id !== 'juggernaut').map(a => a.id);
    for (let i = 0; i < bench; i++) place(ids[i % ids.length]!, ((i % 8) - 3.5) * 3, -Math.floor(i / 8) * 3 + 6);
  } else {
    await lib.load();
    // Two ranks with the bosses behind, so a 7 m Titan does not shrink everyone else to a speck.
    const front = ['skitter', 'husk', 'leaper', 'bomber', 'trooper', 'gunner', 'stalker', 'sniper', 'skitter'];
    const rear = ['rocketeer', 'riot', 'burner', 'brute', 'warden', 'drone'];
    front.forEach((id, i) => place(id, (i - (front.length - 1) / 2) * 1.75, 3));
    rear.forEach((id, i) => place(id, (i - (rear.length - 1) / 2) * 2.2 + (i > 2 ? 0.5 : -0.5), 0.6));
    place('juggernaut', -6.6, -1.2, 0.3);
    place('titan', 3, -5.5, -0.2);
  }

  const views: Record<string, (h: number) => [number, number, number, number, number, number, number]> = {
    front: h => [0, h * 0.56, h * 2.4, 0, h * 0.52, 0, 28],
    three: h => [h * 1.3, h * 0.66, h * 2.0, 0, h * 0.52, 0, 28],
    side: h => [h * 2.4, h * 0.56, 0, 0, h * 0.52, 0, 28],
    back: h => [-h * 0.8, h * 0.7, -h * 2.2, 0, h * 0.54, 0, 28],
    close: h => [h * 0.42, h * 0.84, h * 0.72, 0, h * 0.76, 0, 30],
    face: h => [h * 0.14, h * 0.93, h * 0.42, 0, h * 0.92, 0, 28],
    feet: h => [h * 0.5, h * 0.2, h * 0.8, 0, h * 0.14, 0, 28],
  };
  const setCamera = (name: string) => {
    if (!focus) return;
    const h = focus.rig.height;
    const v = views[name] ?? views.three!;
    const [px, py, pz, tx, ty, tz, fov] = v(h);
    render.camera.fov = fov;
    render.camera.updateProjectionMatrix();
    // Machines are wider than they are tall, and the drone flies.
    const wide = focus.archetype === 'skitter' || focus.archetype === 'drone' ? 1.7 : 1;
    const lift = focus.archetype === 'drone' ? focus.root.position.y - h * 0.4 : 0;
    render.camera.position.set(px * wide, py + lift, pz * wide);
    render.camera.lookAt(tx, ty + lift, tz);
  };
  if (focus) setCamera(params.get('view') ?? 'three');
  else if (bench) { render.camera.position.set(0, 7, 24); render.camera.lookAt(0, 1, 0); }
  else {
    // ?far=1 is the 40 m readability check from the brief.
    const p = (params.get('far') ? [0, 1.7, 42] : [0, 2.3, 14.5]) as [number, number, number];
    render.camera.fov = params.get('far') ? 22 : 46;
    render.camera.updateProjectionMatrix();
    render.camera.position.set(...p);
    render.camera.lookAt(0, params.get('far') ? 1.6 : 2.5, 0);
  }

  let paused = false;
  let actionClock = 0;
  let animMs = 0;
  let animSamples = 0;
  const stepAll = (dt: number) => {
    loco.speed = isAction ? 0 : speed;
    const t0 = performance.now();
    for (const c of live) {
      c.anim.setLocomotion(loco);
      c.anim.update(dt, params.has('lod') ? Number(params.get('lod')) : 0);
    }
    animMs = animMs * 0.95 + (performance.now() - t0) * 0.05;
    animSamples++;
    if (isAction && focus) {
      actionClock -= dt;
      if (actionClock <= 0) actionClock = focus.anim.play(anim as AnimAction) + 0.5;
    }
  };

  const fallbackDt = 1 / 60;
  (window as unknown as { __m: unknown }).__m = {
    pause: () => { paused = true; },
    resume: () => { paused = false; },
    step: (dt = fallbackDt) => stepAll(dt),
    camera: setCamera,
    focus,
    render,
    lib,
    archetypes: ARCHETYPES.map(a => a.id),
    /** Swaps the single character in place, which is far cheaper than reloading the renderer. */
    show: async (id: string) => {
      for (const c of live) c.release();
      live.length = 0;
      await lib.load([id]);
      focus = place(id, 0, 0);
      (window as unknown as { __m: { focus: Character } }).__m.focus = focus;
      for (let i = 0; i < 40; i++) stepAll(1 / 60);
    },
    playAction: (a: AnimAction) => focus?.anim.play(a),
    cut: (regions: GoreRegion[]) => {
      if (!focus) return;
      for (const r of regions) {
        const bone = REGION_BONE(focus, r);
        if (bone >= 0) focus.hideLimb(bone);
      }
    },
    hit: (bone: number, x: number, y: number, z: number, mag: number) => focus?.anim.flinch(bone, new THREE.Vector3(x, y, z).normalize(), mag),
    setSpeed: (s: number) => { speed = s; },
  };

  runLoop(ctx, () => {
    if (!paused) stepAll(ctx.time.dt);
    render.render();
  }, () => ({ calls: render.drawCalls(), tris: render.triangles(), animMs: Number(animMs.toFixed(3)), animSamples, count: live.length }));

}
