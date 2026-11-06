/** Pre-rendered top-down map, painted from the nav graph so it shows exactly where you can go at every level. */
import * as THREE from 'three';
import type { MinimapData } from '../core/contracts';
import type { Kit } from './kit/kit';
import type { MapPlan, MapSpec } from './map/spec';
import type { NavGraph } from './nav';

const SIZE = 1024;

const css = (rgb: readonly [number, number, number], a: number, lift = 0) =>
  `rgba(${rgb.map(v => Math.round((v + (1 - v) * lift) * 255)).join(',')},${a})`;

/** A crisp vector chart for maps that carry a plan. Walls are the brightest thing on it, because the HUD draws it small. */
function drawPlan(plan: MapPlan, extent: number): MinimapData {
  const scale = SIZE / (extent * 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const c = canvas.getContext('2d')!;
  c.scale(scale, scale);
  c.translate(extent, extent);
  c.fillStyle = '#0c141d';
  c.fillRect(-extent, -extent, extent * 2, extent * 2);
  for (const f of plan.fills) {
    c.fillStyle = css(f.rgb, 0.16);
    c.fillRect(f.x0, f.z0, f.x1 - f.x0, f.z1 - f.z0);
  }
  c.fillStyle = 'rgba(190, 215, 235, 0.13)';
  for (const d of plan.decks) c.fillRect(d.x0, d.z0, d.x1 - d.x0, d.z1 - d.z0);
  c.fillStyle = 'rgba(190, 225, 245, 0.6)';
  for (const b of plan.blocks) c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  c.strokeStyle = '#d9f2ff';
  c.lineCap = 'butt';
  for (const w of plan.walls) {
    c.lineWidth = Math.max(w.half * 2, 1.1);
    c.beginPath();
    c.moveTo(w.ax, w.az);
    c.lineTo(w.bx, w.bz);
    c.stroke();
  }
  c.strokeStyle = '#ff4a3a';
  c.lineWidth = 1.5;
  for (const g of plan.gates) {
    const sx = Math.sin(g.yaw) * g.w / 2, sz = Math.cos(g.yaw) * g.w / 2;
    c.beginPath();
    c.moveTo(g.x - sx, g.z - sz);
    c.lineTo(g.x + sx, g.z + sz);
    c.stroke();
  }
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '700 8px ui-monospace, Menlo, monospace';
  for (const f of plan.fills) {
    if (!f.label) continue;
    c.fillStyle = css(f.rgb, 0.95, 0.35);
    c.fillText(f.label, (f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2);
  }
  return {
    image: canvas,
    bounds: new THREE.Box3(new THREE.Vector3(-extent, -20, -extent), new THREE.Vector3(extent, 120, extent)),
  };
}

export function drawMinimap(nav: NavGraph, spec: MapSpec, kit: Kit, EXTENT: number): MinimapData {
  if (spec.plan) return drawPlan(spec.plan, EXTENT);
  const scale = SIZE / (EXTENT * 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#060b12';
  c.fillRect(0, 0, SIZE, SIZE);

  // Solid mass, lightly, for anything that is not floor.
  const img = c.getImageData(0, 0, SIZE, SIZE);
  const px = img.data;
  for (let j = 0; j < SIZE; j++) {
    const z = (j + 0.5) / scale - EXTENT;
    for (let i = 0; i < SIZE; i++) {
      const x = (i + 0.5) / scale - EXTENT;
      if (kit.vox.isSolid(x, 4, z) || kit.vox.isSolid(x, 12, z)) {
        const o = (j * SIZE + i) * 4;
        px[o] = 22; px[o + 1] = 34; px[o + 2] = 46; px[o + 3] = 255;
      }
    }
  }
  // Floor colour by height, painted lowest first so upper levels sit on top.
  const put = (x: number, z: number, r: number, g: number, b: number) => {
    const i0 = Math.floor((x - 0.5 + EXTENT) * scale), j0 = Math.floor((z - 0.5 + EXTENT) * scale);
    const span = Math.ceil(scale) + 1;
    for (let j = j0; j < j0 + span; j++) for (let i = i0; i < i0 + span; i++) {
      if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) continue;
      const o = (j * SIZE + i) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  };
  const ids = Array.from({ length: nav.nodeCount }, (_, i) => i).sort((a, b) => nav.py[a]! - nav.py[b]!);
  for (const n of ids) {
    const y = nav.py[n]!;
    const t = Math.max(0, Math.min(1, (y + 8) / 24));
    const edge = nav.clearance[n] === 0 ? 1.45 : 1;
    put(nav.px[n]!, nav.pz[n]!, (20 + t * 40) * edge, (40 + t * 90) * edge, (58 + t * 120) * edge);
  }
  c.putImageData(img, 0, 0);

  // Lava and pads are the two things worth reading at a glance.
  c.fillStyle = '#ff6420';
  for (const b of spec.lava) {
    c.fillRect((b.min.x + EXTENT) * scale, (b.min.z + EXTENT) * scale, (b.max.x - b.min.x) * scale, (b.max.z - b.min.z) * scale);
  }
  c.fillStyle = '#7fe6ff';
  for (const p of spec.pads) {
    c.beginPath();
    c.arc((p.pos.x + EXTENT) * scale, (p.pos.z + EXTENT) * scale, 4, 0, Math.PI * 2);
    c.fill();
  }
  c.font = '600 19px ui-monospace, Menlo, monospace';
  c.textAlign = 'center';
  c.fillStyle = 'rgba(210, 240, 255, 0.75)';
  for (const z of spec.zones) {
    if (z.id === 'ring') continue;
    const m = z.bounds.getCenter(new THREE.Vector3());
    c.fillText(z.name.toUpperCase(), (m.x + EXTENT) * scale, (m.z + EXTENT) * scale);
  }
  return {
    image: canvas,
    bounds: new THREE.Box3(new THREE.Vector3(-EXTENT, -20, -EXTENT), new THREE.Vector3(EXTENT, 120, EXTENT)),
  };
}
