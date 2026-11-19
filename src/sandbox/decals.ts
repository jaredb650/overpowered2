/**
 * The decal sheet, cell by cell, through the real decal shader: a concrete floor and a wall under a plain white light
 * (and, with `?light=cyan`, the game's cold light), every cell laid out in a grid and seen from straight above.
 *
 *   /?sandbox=decals                      every cell, top down
 *   &from=<cell>&count=<n>&cols=<n>       a part of the sheet
 *   &size=<m>                             the edge of each quad (default 1)
 *   &age=<s>                              how old the stains are when drawn (0 wet, 120 dry); &run=1 lets them age on
 *   &view=eye                             the same grid from a standing player's eye
 *   &view=wall                            the grid on the wall
 *   &floor=<material>                     the surface under them (concrete, tile, steel, asphalt...)
 *   &lum=<x>                              the lights, against the default (0.3 is about the game's night)
 *   &raw=1|2                              the atlas itself, albedo or surface, on a panel
 *
 * `window.__decals` has `stamp(cell, x, z, size, rotation)` and the renderer for scripts.
 */
import * as THREE from 'three';
import { createRenderSystem, type Renderer } from '../render';
import { makeCtx, runLoop } from './harness';
import type { BakedLight, WorldMaterialName } from '../core/contracts';

interface Stamper {
  /** Lays one named atlas cell, when the decal system can (the new sheet). */
  stamp?: (cell: number, position: THREE.Vector3, normal: THREE.Vector3, size: number, rotation?: number, age?: number) => void;
  cellCount?: number;
}

export default async function decalsSandbox(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const t0 = performance.now();
  const render = (await createRenderSystem(canvas)) as Renderer;
  // Every texture is drawn by then; reading one pixel back waits for the GPU, so this is the whole cost of the bake.
  const gl = render.renderer.getContext() as WebGL2RenderingContext;
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const loadMs = performance.now() - t0;
  const ctx = makeCtx({ render });
  render.init(ctx);
  if (params.get('q')) render.setQuality(Number(params.get('q')));

  const floorName = (params.get('floor') ?? 'concrete') as WorldMaterialName;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const box = (c: [number, number, number], h: [number, number, number], m: WorldMaterialName) => {
    const mesh = new THREE.Mesh(unit, render.materials.world(m));
    mesh.position.set(...c);
    mesh.scale.set(h[0] * 2, h[1] * 2, h[2] * 2);
    mesh.receiveShadow = true;
    render.scene.add(mesh);
    return { c, h };
  };
  const solids = [
    box([0, -0.5, 0], [16, 0.5, 16], floorName),
    box([0, 6, -12.5], [16, 6, 0.5], floorName),
    // A kerb and a block, for edges and corners.
    box([9, 0.5, 4], [1.5, 0.5, 1.5], floorName),
  ];

  const cyan = params.get('light') === 'cyan';
  const lum = Number(params.get('lum') ?? 1);
  const colour = cyan ? 0x38d8ff : 0xf2f4ff;
  const lights: BakedLight[] = [];
  if ((params.get('view') ?? 'top') === 'eye') {
    for (let x = -12; x <= 12; x += 6) {
      for (let z = -9; z <= 9; z += 6) lights.push({ position: new THREE.Vector3(x, 5.5, z), color: colour, intensity: 40 * lum, radius: 16 });
    }
  } else {
    // Seen from straight above or straight on, a light behind the camera turns every wet patch into a mirror. These
    // rake across from one side, so a wet lip shows as a glint on that side, as it does from the player's eye.
    for (let x = -14; x <= 14; x += 7) {
      lights.push({ position: new THREE.Vector3(x, 3.5, 13), color: colour, intensity: 150 * lum, radius: 30 });
      lights.push({ position: new THREE.Vector3(x, 9, 3), color: colour, intensity: 60 * lum, radius: 30 });
    }
  }
  const isSolid = (x: number, y: number, z: number): boolean => {
    for (const b of solids) {
      if (Math.abs(x - b.c[0]) <= b.h[0] && Math.abs(y - b.c[1]) <= b.h[1] && Math.abs(z - b.c[2]) <= b.h[2]) return true;
    }
    return false;
  };
  await render.bakeLightVolume({
    bounds: new THREE.Box3(new THREE.Vector3(-17, -1, -14), new THREE.Vector3(17, 13, 17)), lights, isSolid, voxelSize: 0.75,
  });
  render.fog.density = 0.0;
  for (const name of (params.get('off') ?? '').split(',')) {
    if (name in render.passes) render.passes[name as keyof typeof render.passes] = false;
  }

  const decals = render.decals as Renderer['decals'] & Stamper;
  const age = Number(params.get('age') ?? 0);
  const up = new THREE.Vector3(0, 1, 0);
  const out = new THREE.Vector3(0, 0, 1);
  const p = new THREE.Vector3();

  /** The old sheet has no way to ask for a cell: its sixteen are reached by fixing the dice for one call. */
  const OLD: [Parameters<Renderer['decals']['add']>[0], number, number][] = [
    ['bullet', 0, 1], ['exit', 0, 1], ['scorch', 0, 2], ['scorch', 1, 2], ['blood', 0, 4], ['blood', 1, 4], ['blood', 2, 4], ['blood', 3, 4],
    ['bloodPool', 0, 2], ['bloodPool', 1, 2], ['bloodSmear', 0, 2], ['bloodSmear', 1, 2], ['slash', 0, 2], ['slash', 1, 2], ['crack', 0, 2], ['crack', 1, 2],
  ];
  const stamp = (cell: number, position: THREE.Vector3, normal: THREE.Vector3, size: number, rotation = 0): void => {
    if (decals.stamp) {
      decals.stamp(cell, position, normal, size, rotation, age);
      return;
    }
    const old = OLD[cell];
    if (!old) return;
    const random = Math.random;
    Math.random = () => (old[1] + 0.5) / old[2];
    try {
      decals.add(old[0], position, normal, size, rotation);
    } finally {
      Math.random = random;
    }
  };

  const total = decals.cellCount ?? OLD.length;
  const from = Number(params.get('from') ?? 0);
  const count = Math.min(Number(params.get('count') ?? total), total - from);
  const cols = Number(params.get('cols') ?? Math.ceil(Math.sqrt(count * 1.6)));
  const rows = Math.ceil(count / cols);
  const size = Number(params.get('size') ?? 1);
  const pitch = size * Number(params.get('pitch') ?? 1.08);
  const view = params.get('view') ?? 'top';
  const onWall = view === 'wall';
  const rot = Number(params.get('rot') ?? 0);
  if (!params.get('raw') && !params.get('empty')) {
    for (let i = 0; i < count; i++) {
      const cx = ((i % cols) - (cols - 1) / 2) * pitch;
      const cy = (Math.floor(i / cols) - (rows - 1) / 2) * pitch;
      if (onWall) stamp(from + i, p.set(cx, 3 - cy, -12), out, size, rot);
      else stamp(from + i, p.set(cx, 0, cy), up, size, rot);
    }
  }

  const raw = params.get('raw');
  if (raw) {
    const tex = raw === '2' ? render.decalAtlas.surface : render.decalAtlas.albedo;
    const image = tex.image as { width: number; height: number };
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(12 * (image.width / image.height), 12),
      new THREE.MeshBasicMaterial({ map: tex, transparent: false, toneMapped: false }),
    );
    panel.position.set(0, 0.01, 0);
    panel.rotation.x = -Math.PI / 2;
    render.scene.add(panel);
  }

  const cam = render.camera;
  const wide = Math.max(cols * pitch, rows * pitch * (innerWidth / innerHeight)) + 0.3;
  if (view === 'top' || raw) {
    cam.fov = 20;
    const span = raw ? 13 * (innerWidth / innerHeight) : wide;
    const dist = span / (2 * Math.tan((cam.fov * Math.PI) / 360) * (innerWidth / innerHeight));
    cam.position.set(0, dist, 0.001);
    cam.lookAt(0, 0, 0);
  } else if (onWall) {
    cam.fov = 30;
    const dist = wide / (2 * Math.tan((cam.fov * Math.PI) / 360) * (innerWidth / innerHeight));
    cam.position.set(0, 3, -12 + dist);
    cam.lookAt(0, 3, -12);
  } else {
    cam.fov = 75;
    cam.position.set(0, 1.7, rows * pitch * 0.5 + Number(params.get('back') ?? 2.2));
    cam.lookAt(0, 0, -rows * pitch * 0.15);
  }
  cam.updateProjectionMatrix();

  (window as unknown as { __decals: unknown }).__decals = {
    render, ctx, loadMs, stamp: (cell: number, x: number, z: number, s = 1, r = 0) => stamp(cell, p.set(x, 0, z), up, s, r),
    wall: (cell: number, x: number, y: number, s = 1, r = 0) => stamp(cell, p.set(x, y, -12), out, s, r),
    camera: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 75) => {
      cam.fov = fov;
      cam.position.set(px, py, pz);
      cam.lookAt(tx, ty, tz);
      cam.updateProjectionMatrix();
    },
  };
  // The decals' clock stands still unless asked (`&run=1`), so a stain is exactly as old as `age` says however long the page took.
  const run = params.get('run');
  runLoop(ctx, () => {
    if (!run) ctx.time.elapsed = 0;
    render.render();
  }, () => ({ calls: render.drawCalls(), tris: render.triangles() }));
}
