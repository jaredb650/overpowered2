/**
 * Renderer showcase: a brutalist hall with every world material, baked coloured lights, moon shafts
 * through roof slots, wet floor, chrome sphere, decals and hot emissives.
 *
 * Keys: G cycles grades, 1-6 toggle AO, fog, bloom, shadows, decals, SSR, Q cycles quality, F fires a flash.
 * URL: ?cam=0..n picks a camera, ?grade=<name> starts on a grade, ?orbit=1 moves the camera.
 */
import * as THREE from 'three';
import { createRenderSystem, type Renderer } from '../render';
import { makeCtx, runLoop } from './harness';
import type { BakedLight, GradeName, WorldMaterialName } from '../core/contracts';
import { GRADE_ORDER } from '../render/post/grades';

interface Box {
  c: [number, number, number];
  h: [number, number, number];
  m: WorldMaterialName;
  solid?: boolean;
}

const CAMERAS: { p: [number, number, number]; t: [number, number, number]; fov?: number }[] = [
  { p: [-15.5, 1.75, 10.5], t: [6, 2.2, -4] },
  { p: [0, 1.6, -13], t: [0, 3, 8] },
  { p: [4.2, 1.2, 3.6], t: [0.2, 0.9, -1.2] },
  { p: [0.5, 1.5, 11.5], t: [0.8, 0, 6.2] },
  { p: [-6.5, 1.6, -4.5], t: [-13.5, 1.2, -13] },
  { p: [12, 1.5, -3], t: [15, 1.0, -13] },
  { p: [0, 16, 0], t: [-34, 22, -60] },
  { p: [0, 16, 0], t: [60, 18, 50] },
];

function buildRoom(): Box[] {
  const boxes: Box[] = [];
  const wall = (c: Box['c'], h: Box['h'], m: WorldMaterialName) => boxes.push({ c, h, m, solid: true });
  const W = 20, D = 16, H = 11;
  // Shell. The floor is a single wet slab so the reflections run unbroken down the hall.
  wall([0, -0.5, 0], [W + 1, 0.5, D + 1], 'concrete');
  wall([-W - 0.5, H / 2, 0], [0.5, H / 2 + 0.5, D + 1], 'concrete');
  wall([W + 0.5, H / 2, 0], [0.5, H / 2 + 0.5, D + 1], 'concrete');
  wall([0, H / 2, -D - 0.5], [W + 1, H / 2 + 0.5, 0.5], 'concrete');
  wall([0, H / 2, D + 0.5], [W + 1, H / 2 + 0.5, 0.5], 'concreteDark');
  // Roof with four slots that let the moon in.
  for (let i = 0; i < 5; i++) {
    const x = -W + 4 + i * 8;
    wall([x, H + 0.5, 0], [2.5, 0.5, D + 1], 'concreteDark');
  }
  wall([0, H + 0.5, -D + 1], [W + 1, 0.5, 2], 'concreteDark');
  wall([0, H + 0.5, D - 1], [W + 1, 0.5, 2], 'concreteDark');
  // Columns.
  for (const x of [-12, -4, 4, 12]) {
    for (const z of [-9, 9]) wall([x, H / 2, z], [0.7, H / 2, 0.7], 'concrete');
  }
  // Material swatches along the back wall, in a raised plinth row.
  const names: WorldMaterialName[] = ['steel', 'steelDark', 'rust', 'hazard', 'panel', 'tile', 'dirt', 'rubber', 'paintRed', 'paintYellow', 'paintWhite', 'asphalt', 'concreteDark'];
  names.forEach((m, i) => {
    const x = -18 + i * 3;
    wall([x, 1.5, -14.8], [1.3, 1.5, 0.6], m);
  });
  // A hazard-striped ledge, a rusty tank block and a catwalk with real grating.
  wall([-8, 0.6, 2], [2.5, 0.6, 1.2], 'hazard');
  wall([9, 1.3, 4], [1.4, 1.3, 2.2], 'rust');
  wall([-14, 0.9, -4], [1.6, 0.9, 1.6], 'steelDark');
  wall([14, 0.9, -5], [1.8, 0.9, 1.8], 'panel');
  boxes.push({ c: [0, 4.4, 9], h: [16, 0.04, 1.6], m: 'grate' });
  wall([-16, 2.2, 9], [0.15, 2.2, 0.15], 'steel');
  wall([16, 2.2, 9], [0.15, 2.2, 0.15], 'steel');
  // Hot strips for bloom.
  boxes.push({ c: [0, 6.2, -15.92], h: [14, 0.05, 0.05], m: 'emissiveCyan' });
  boxes.push({ c: [0, 9.2, -15.92], h: [14, 0.05, 0.05], m: 'emissiveCyan' });
  boxes.push({ c: [-19.92, 3.2, 0], h: [0.05, 0.08, 7], m: 'emissiveMagenta' });
  boxes.push({ c: [19.92, 3.2, 0], h: [0.05, 0.08, 7], m: 'emissiveOrange' });
  boxes.push({ c: [0, 0.03, -5], h: [8, 0.03, 0.06], m: 'emissiveWhite' });
  boxes.push({ c: [-2.5, 2.4, 15.92], h: [1.1, 2.4, 0.06], m: 'emissiveRed' });
  boxes.push({ c: [2.5, 2.4, 15.92], h: [1.1, 2.4, 0.06], m: 'glass' });
  return boxes;
}

function addDecals(render: Renderer): void {
  const up = new THREE.Vector3(0, 1, 0);
  const wall = new THREE.Vector3(0, 0, 1);
  const p = new THREE.Vector3();
  const floor = (x: number, z: number, kind: Parameters<Renderer['decals']['add']>[0], size: number, rot?: number) =>
    render.decals.add(kind, p.set(x, 0, z), up, size, rot);
  floor(1.2, 7.6, 'bloodPool', 3.2, 0.4);
  floor(-1.1, 6.6, 'blood', 1.8, 1.1);
  floor(2.6, 5.6, 'blood', 1.2, 2.4);
  floor(-2.4, 8.4, 'blood', 2.2, 4.4);
  floor(4.2, 7.8, 'bloodSmear', 3.4, 0.3);
  floor(-4.4, 5.4, 'bloodSmear', 2.6, 2.9);
  floor(0.4, 3.8, 'scorch', 3.6, 1.0);
  floor(-3.6, 2.6, 'crack', 2.0, 0.2);
  floor(5.8, 2.4, 'slash', 1.7, 0.7);
  // The back wall of the swatch row takes gunfire and a sword.
  for (let i = 0; i < 14; i++) {
    render.decals.add('bullet', p.set(-13.3 + (i % 7) * 0.5 + Math.sin(i * 7) * 0.2, 4.6 + Math.floor(i / 7) * 0.7, -16 + 0.0), wall, 0.3, i);
  }
  render.decals.add('slash', p.set(-7.4, 5, -16), wall, 2.2, 0.5);
  render.decals.add('crack', p.set(-3.6, 4.8, -16), wall, 1.8, 0);
  render.decals.add('blood', p.set(-1.2, 5, -16), wall, 2.4, 1);
  render.decals.add('scorch', p.set(2.6, 5, -16), wall, 3, 2);
  // Hanging over the plinth edge, to prove overhang rejection.
  render.decals.add('bloodPool', p.set(-5.2, 1.2, 2.6), up, 2.2, 0.3);
}

const LIGHTS: { p: [number, number, number]; c: number; i: number; r: number }[] = [
  { p: [-17, 3.2, 0], c: 0xff1ea8, i: 60, r: 18 },
  { p: [17, 3.2, 0], c: 0xff6a10, i: 60, r: 18 },
  { p: [0, 7.5, -14], c: 0x28e0ff, i: 90, r: 22 },
  { p: [-2.5, 2.4, 14.5], c: 0xff1810, i: 40, r: 14 },
  { p: [-8, 2.6, -6], c: 0x4a8cff, i: 26, r: 14 },
  { p: [8, 2.6, 6], c: 0x35ffd0, i: 26, r: 14 },
  // Neutral work light on the swatches, so the materials can be judged by eye.
  { p: [-9, 3.4, -10.5], c: 0xf0f4ff, i: 22, r: 12 },
  { p: [6, 3.4, -10.5], c: 0xf0f4ff, i: 22, r: 12 },
];

const PASS_KEYS = ['ao', 'fog', 'bloom', 'shadows', 'decals', 'ssr'] as const;

export default async function renderSandbox(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render = (await createRenderSystem(canvas)) as Renderer;
  const ctx = makeCtx({ render });
  render.init(ctx);
  if (params.get('q')) render.setQuality(Number(params.get('q')));

  const boxes = buildRoom();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (const b of boxes) {
    const mesh = new THREE.Mesh(unit, render.materials.world(b.m));
    mesh.position.set(...b.c);
    mesh.scale.set(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2);
    mesh.castShadow = b.solid ?? false;
    render.scene.add(mesh);
  }

  // Chrome sphere and a rough one, on the wet floor.
  const chrome = render.materials.patch(new THREE.MeshStandardMaterial({ color: 0xe8eef4, metalness: 1, roughness: 0.04 }));
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 40), chrome);
  sphere.position.set(0, 1.1, 0);
  sphere.castShadow = true;
  render.scene.add(sphere);
  const dull = render.materials.patch(new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0, roughness: 0.55 }));
  const sphere2 = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 32), dull);
  sphere2.position.set(3.2, 0.8, -2.2);
  sphere2.castShadow = true;
  render.scene.add(sphere2);

  // A stand-in viewmodel so the viewmodel pass is exercised.
  if (params.get('view')) {
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.55), render.materials.world('steelDark'));
    gun.position.set(0.2, -0.17, -0.42);
    render.viewScene.add(gun);
  }

  const lights: BakedLight[] = LIGHTS.map(l => ({ position: new THREE.Vector3(...l.p), color: l.c, intensity: l.i, radius: l.r }));
  const solids = boxes.filter(b => b.solid);
  const isSolid = (x: number, y: number, z: number): boolean => {
    for (const b of solids) {
      if (Math.abs(x - b.c[0]) <= b.h[0] && Math.abs(y - b.c[1]) <= b.h[1] && Math.abs(z - b.c[2]) <= b.h[2]) return true;
    }
    return false;
  };
  const bounds = new THREE.Box3(new THREE.Vector3(-22, -1, -18), new THREE.Vector3(22, 13, 18));
  await render.bakeLightVolume({ bounds, lights, isSolid, voxelSize: 0.75 });
  console.log("bake", JSON.stringify(render.volume.stats));

  for (const name of (params.get('off') ?? '').split(',')) {
    if (name in render.passes) render.passes[name as keyof typeof render.passes] = false;
  }

  addDecals(render);
  if (params.get('atlas')) {
    const tex = params.get('atlas') === '2' ? render.decalAtlas.surface : render.decalAtlas.albedo;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ map: tex, transparent: params.get('atlas') !== '2', toneMapped: false }));
    panel.position.set(0, 6, 8);
    panel.rotation.y = Math.PI;
    render.scene.add(panel);
  }

  const camIndex = Number(params.get('cam') ?? 0) % CAMERAS.length;
  const setCamera = (i: number) => {
    const c = CAMERAS[i]!;
    render.camera.position.set(...c.p);
    render.camera.lookAt(...c.t);
  };
  setCamera(camIndex);

  let gradeIndex = 0;
  const startGrade = params.get('grade') as GradeName | null;
  if (startGrade) {
    gradeIndex = GRADE_ORDER.indexOf(startGrade);
    render.post.setGrade(startGrade, 0);
  }
  // A showcase hall is small enough to carry thicker air than the open map.
  render.fog.density = 0.011;
  render.fog.moonGain = 5;
  let quality = Number(params.get('q') ?? 2);
  addEventListener('keydown', e => {
    if (e.key === 'g') {
      gradeIndex = (gradeIndex + 1) % GRADE_ORDER.length;
      render.post.setGrade(GRADE_ORDER[gradeIndex]!, 0.4);
    } else if (e.key >= '1' && e.key <= '6') {
      const name = PASS_KEYS[Number(e.key) - 1]!;
      render.passes[name] = !render.passes[name];
    } else if (e.key === 'q') {
      quality = (quality + 1) % 4;
      render.setQuality(quality);
    } else if (e.key === 'f') {
      render.lights.flash(new THREE.Vector3(0, 2, 3), 0xffa030, 6, 16, 0.4);
      render.post.flash(0xffa040, 0.3, 0.2);
    }
  });

  const orbit = params.get('orbit');
  runLoop(ctx, () => {
    if (orbit) {
      const t = ctx.time.realElapsed * 0.25;
      render.camera.position.set(Math.cos(t) * 12, 2.2, Math.sin(t) * 9);
      render.camera.lookAt(0, 1.5, 0);
    }
    render.render();
  }, () => ({ calls: render.drawCalls(), tris: render.triangles() }));
  (window as unknown as { __render: unknown }).__render = render;
}
