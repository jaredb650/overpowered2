/** One canvas atlas for all map signage: zone names, sector numbers, warnings and arrows, in a single draw call. */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';

const CELL_W = 512;
const CELL_H = 128;
const COLS = 4;

export const SIGNS = [
  'CRUCIBLE CORE', 'FOUNDRY', 'REFINERY', 'SCRAPYARD', 'TRANSIT', 'RING ROAD', 'SECTOR 01', 'SECTOR 02',
  'SECTOR 03', 'SECTOR 04', 'SECTOR 05', 'SECTOR 06', 'DANGER: MOLTEN', 'HIGH VOLTAGE', 'CRUSH ZONE', 'NO ENTRY',
  'REACTOR ACCESS', 'PLATFORM 1', 'PLATFORM 2', 'EVACUATE', 'LINE 7 CENTRAL', 'SLAG YARD', 'TANK FARM', 'RAIL YARD',
  'ARROW L', 'ARROW R', 'ARROW U', 'GAP AHEAD', 'LAUNCH', 'BLAST DOOR', 'COOLANT', 'CRANE 04',
] as const;

export type SignName = (typeof SIGNS)[number];
export const signId = (name: SignName): number => SIGNS.indexOf(name);

/** UV rectangle of a sign. */
export function signRect(id: number): [number, number, number, number] {
  const rows = Math.ceil(SIGNS.length / COLS);
  const c = id % COLS, r = Math.floor(id / COLS);
  return [c / COLS, 1 - (r + 1) / rows, (c + 1) / COLS, 1 - r / rows];
}

function paint(): HTMLCanvasElement {
  const rows = Math.ceil(SIGNS.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLS;
  canvas.height = CELL_H * rows;
  const c = canvas.getContext('2d')!;
  c.textBaseline = 'middle';
  SIGNS.forEach((text, i) => {
    const x = (i % COLS) * CELL_W, y = Math.floor(i / COLS) * CELL_H;
    const warn = /DANGER|VOLTAGE|CRUSH|NO ENTRY|EVACUATE|GAP/.test(text);
    c.fillStyle = warn ? '#3a0d10' : '#08141f';
    c.fillRect(x, y, CELL_W, CELL_H);
    c.strokeStyle = warn ? '#ff4d3a' : '#62d9ff';
    c.lineWidth = 6;
    c.strokeRect(x + 7, y + 7, CELL_W - 14, CELL_H - 14);
    c.fillStyle = warn ? '#ffb2a4' : '#dff5ff';
    if (text.startsWith('ARROW')) {
      const dir = text.endsWith('L') ? -1 : text.endsWith('R') ? 1 : 0;
      c.save();
      c.translate(x + CELL_W / 2, y + CELL_H / 2);
      c.rotate(dir === 0 ? -Math.PI / 2 : dir < 0 ? Math.PI : 0);
      c.beginPath();
      for (const off of [-90, 0, 90]) {
        c.moveTo(off - 28, -40); c.lineTo(off + 22, 0); c.lineTo(off - 28, 40); c.lineTo(off - 8, 40); c.lineTo(off + 42, 0); c.lineTo(off - 8, -40); c.closePath();
      }
      c.fill();
      c.restore();
      return;
    }
    c.font = '700 62px ui-monospace, Menlo, monospace';
    const w = c.measureText(text).width;
    const scale = Math.min(1, (CELL_W - 48) / w);
    c.save();
    c.translate(x + CELL_W / 2, y + CELL_H / 2 + 3);
    c.scale(scale, 1);
    c.textAlign = 'center';
    c.fillText(text, 0, 0);
    c.restore();
  });
  return canvas;
}

export function buildSignMaterial(ctx: Ctx): THREE.Material {
  const tex = new THREE.CanvasTexture(paint());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.5, metalness: 0,
  });
  const patched = ctx.render.materials?.patch?.(m);
  return patched instanceof THREE.Material ? patched : m;
}
