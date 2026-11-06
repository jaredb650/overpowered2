/**
 * Painted surfaces for The Kill House. Spray-through stencils: numerals, words, arrows and paper targets, cut out of one
 * alpha-tested atlas, lit like the wall they sit on, and tinted per vertex so one material paints every room's colour.
 * Plywood: the one surface the procedural library has no texture for.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/math';
import type { Ctx } from '../../core/contracts';
import type { Kit } from './kit';

const SIZE = 2048;
const CELL = 256;
const COLS = SIZE / CELL;
const WORD_W = 1024;
const WORD_H = 128;
const WORD_TOP = CELL * 2;

const SYMBOLS = ['ARROW', 'CHEVRON', 'BULLSEYE', 'TARGET'] as const;
const GLYPHS = [...'0123456789', ...SYMBOLS] as const;
const WORDS = [
  'TYRES', 'LANES', 'CRATES', 'STREET', 'SANDBAGS', 'PLYWOOD', 'TILES', 'PLANT', 'COURT', 'GATE',
  'LIVE FIRE', 'CLEAR LEFT', 'CLEAR RIGHT', 'KEEP MOVING', 'EYES UP', 'WATCH MUZZLE', 'CATWALK', 'NO ENTRY',
] as const;

export type StencilName = (typeof GLYPHS)[number] | (typeof WORDS)[number];

interface Cell { u0: number; v0: number; u1: number; v1: number; aspect: number }

const cells = new Map<string, Cell>();
GLYPHS.forEach((name, i) => {
  const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
  cells.set(name, { u0: x / SIZE, v0: 1 - (y + CELL) / SIZE, u1: (x + CELL) / SIZE, v1: 1 - y / SIZE, aspect: 1 });
});
WORDS.forEach((name, i) => {
  const x = (i % 2) * WORD_W, y = WORD_TOP + Math.floor(i / 2) * WORD_H;
  cells.set(name, { u0: x / SIZE, v0: 1 - (y + WORD_H) / SIZE, u1: (x + WORD_W) / SIZE, v1: 1 - y / SIZE, aspect: WORD_W / WORD_H });
});

const FONT = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';

function drawSymbol(c: CanvasRenderingContext2D, name: (typeof SYMBOLS)[number], x: number, y: number): void {
  const m = CELL / 2;
  c.save();
  c.translate(x + m, y + m);
  c.beginPath();
  switch (name) {
    case 'ARROW':
      c.moveTo(0, -104); c.lineTo(84, -12); c.lineTo(34, -12); c.lineTo(34, 104); c.lineTo(-34, 104); c.lineTo(-34, -12); c.lineTo(-84, -12);
      c.closePath();
      c.fill();
      break;
    case 'CHEVRON':
      for (const o of [-62, 42]) {
        c.moveTo(0, o - 42); c.lineTo(100, o + 34); c.lineTo(100, o + 72); c.lineTo(0, o - 4); c.lineTo(-100, o + 72); c.lineTo(-100, o + 34);
        c.closePath();
      }
      c.fill();
      break;
    case 'BULLSEYE':
      c.lineWidth = 16;
      c.arc(0, 0, 112, 0, Math.PI * 2);
      c.stroke();
      break;
    case 'TARGET':
      // Head, shoulders and torso of a range silhouette, with the scoring rings cut through it.
      c.arc(0, -82, 34, 0, Math.PI * 2);
      c.moveTo(-76, 124); c.lineTo(-76, -6); c.quadraticCurveTo(-76, -38, -40, -42); c.lineTo(40, -42); c.quadraticCurveTo(76, -38, 76, -6); c.lineTo(76, 124);
      c.closePath();
      c.fill();
      c.globalCompositeOperation = 'destination-out';
      c.lineWidth = 7;
      for (const r of [22, 46]) {
        c.beginPath();
        c.arc(0, 30, r, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
      break;
  }
  c.restore();
}

function paint(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const c = canvas.getContext('2d')!;
  c.fillStyle = c.strokeStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  GLYPHS.forEach((name, i) => {
    const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
    if (name.length > 1) {
      drawSymbol(c, name as (typeof SYMBOLS)[number], x, y);
      return;
    }
    c.font = `${CELL * 0.98}px ${FONT}`;
    c.fillText(name, x + CELL / 2, y + CELL / 2 + 8);
  });
  WORDS.forEach((name, i) => {
    const x = (i % 2) * WORD_W, y = WORD_TOP + Math.floor(i / 2) * WORD_H;
    c.font = `${WORD_H * 0.84}px ${FONT}`;
    const w = c.measureText(name).width;
    c.save();
    c.translate(x + WORD_W / 2, y + WORD_H / 2 + 4);
    c.scale(Math.min(1, (WORD_W - 24) / w), 1);
    c.fillText(name, 0, 0);
    c.restore();
  });
  // The bridges a real stencil needs, then wear: paint sprayed through a plate is never a clean print.
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2; i++) {
    for (let col = 0; col < COLS; col++) c.fillRect(col * CELL, i * CELL + CELL / 2 - 3, CELL, 6);
  }
  const rng = mulberry32(0x57e9c11);
  for (let i = 0; i < 30000; i++) {
    const r = 0.6 + rng() * rng() * rng() * 6;
    c.beginPath();
    c.arc(rng() * SIZE, rng() * SIZE, r, 0, Math.PI * 2);
    c.fill();
  }
  return canvas;
}

export function buildStencilMaterial(ctx: Ctx): THREE.Material {
  const tex = new THREE.CanvasTexture(paint());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.82, metalness: 0, vertexColors: true });
  const patched = ctx.render.materials?.patch?.(m);
  return patched instanceof THREE.Material ? patched : m;
}

const PLY_METERS = 4.8;

function paintPlywood(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d')!;
  const rng = mulberry32(0x91a7);
  c.fillStyle = '#a89a84';
  c.fillRect(0, 0, 1024, 1024);
  // Veneer: long wavering streaks, with a few broad patches where one sheet's face differs from the next.
  for (let i = 0; i < 26; i++) {
    c.fillStyle = `rgba(${rng() < 0.5 ? '70,56,40' : '205,190,165'},${0.03 + rng() * 0.06})`;
    c.fillRect(0, rng() * 1024, 1024, 12 + rng() * 90);
  }
  for (let i = 0; i < 900; i++) {
    const y = rng() * 1024, wave = (rng() - 0.5) * 16;
    c.strokeStyle = `rgba(62,48,34,${0.05 + rng() * 0.16})`;
    c.lineWidth = 0.6 + rng() * 1.8;
    c.beginPath();
    c.moveTo(0, y);
    c.bezierCurveTo(340, y + wave, 680, y - wave, 1024, y);
    c.stroke();
  }
  for (let i = 0; i < 26; i++) {
    const x = rng() * 1024, y = rng() * 1024, r = 3 + rng() * 9;
    for (let ring = 3; ring >= 1; ring--) {
      c.fillStyle = `rgba(52,38,26,${0.16 + ring * 0.04})`;
      c.beginPath();
      c.ellipse(x, y, r * ring * 1.9, r * ring * 0.7, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  return canvas;
}

export function buildPlywoodMaterial(ctx: Ctx): THREE.Material {
  const tex = new THREE.CanvasTexture(paintPlywood());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // Geometry carries world-space UVs in meters.
  tex.repeat.set(1 / PLY_METERS, 1 / PLY_METERS);
  tex.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0, vertexColors: true });
  const patched = ctx.render.materials?.patch?.(m);
  return patched instanceof THREE.Material ? patched : m;
}

/** Paints `name` in the local XY plane facing +Z, centred on (x, y). `h` is the height of the cell in meters. */
export function stencil(k: Kit, name: StencilName, x: number, y: number, z: number, h: number, rgb: readonly [number, number, number]): void {
  const cell = cells.get(name)!;
  const w = h * cell.aspect;
  k.geo.use('stencil').tint(rgb[0], rgb[1], rgb[2]);
  k.geo.quadRect(x - w / 2, y - h / 2, z, x + w / 2, y + h / 2, cell.u0, cell.v0, cell.u1, cell.v1);
  k.geo.tint(1);
}

/** Same, laid flat on the floor at (x, z). `yaw` 0 reads upright to someone looking north. */
export function floorStencil(k: Kit, name: StencilName, x: number, z: number, yaw: number, h: number, rgb: readonly [number, number, number], y = 0.02): void {
  k.push(x, y, z, yaw, 0, -Math.PI / 2);
  stencil(k, name, 0, 0, 0, h, rgb);
  k.pop();
}
