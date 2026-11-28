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
  'SALLY', 'GALLERY', 'MESS', 'ARMOURY', 'STACK', 'WAR ROOM',
] as const;

export type StencilName = (typeof GLYPHS)[number] | (typeof WORDS)[number];

interface Cell { u0: number; v0: number; u1: number; v1: number; aspect: number }
interface StencilLayout {
  height: number;
  glyphs: { name: StencilName; x: number; y: number }[];
  words: { name: StencilName; x: number; y: number }[];
  rects: Cell[];
}

const GLYPH_SET = new Set<string>(GLYPHS);
const activeNames: StencilName[] = [];
const activeSlot = new Map<StencilName, number>();
let cachedLayout: StencilLayout | null = null;

/** Clears active stencil tracking before authoring a new map. */
export function resetStencilAtlas(): void {
  activeNames.length = 0;
  activeSlot.clear();
  cachedLayout = null;
}

function getStencilLayout(): StencilLayout {
  if (cachedLayout) return cachedLayout;
  const list: readonly StencilName[] = activeNames.length > 0 ? activeNames : [...GLYPHS, ...WORDS];
  const glyphNames: StencilName[] = [];
  const wordNames: StencilName[] = [];
  for (const name of list) {
    if (GLYPH_SET.has(name)) glyphNames.push(name);
    else wordNames.push(name);
  }
  const glyphRows = Math.ceil(glyphNames.length / COLS);
  const wordTop = glyphRows * CELL;
  const wordRows = Math.ceil(wordNames.length / 2);
  const rawHeight = Math.max(128, wordTop + wordRows * WORD_H);
  // Round up to a power-of-two height (max 2048) for clean mipmapping on all GPUs.
  let height = 128;
  while (height < rawHeight && height < SIZE) height <<= 1;

  const glyphs: { name: StencilName; x: number; y: number }[] = [];
  const words: { name: StencilName; x: number; y: number }[] = [];
  const byName = new Map<StencilName, Cell>();

  glyphNames.forEach((name, i) => {
    const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
    glyphs.push({ name, x, y });
    byName.set(name, {
      u0: x / SIZE, v0: 1 - (y + CELL) / height, u1: (x + CELL) / SIZE, v1: 1 - y / height, aspect: 1,
    });
  });
  wordNames.forEach((name, i) => {
    const x = (i % 2) * WORD_W, y = wordTop + Math.floor(i / 2) * WORD_H;
    words.push({ name, x, y });
    byName.set(name, {
      u0: x / SIZE, v0: 1 - (y + WORD_H) / height, u1: (x + WORD_W) / SIZE, v1: 1 - y / height, aspect: WORD_W / WORD_H,
    });
  });

  const rects = list.map(name => byName.get(name)!);
  cachedLayout = { height, glyphs, words, rects };
  return cachedLayout;
}

/** Converts encoded slot UVs written by stencil() into finalized atlas UVs for the compacted stencil sheet. */
export function finalizeStencilUVs(uv: Float32Array, nv: number): void {
  const layout = getStencilLayout();
  for (let i = 0; i + 3 < nv; i += 4) {
    const slot = Math.round(uv[i * 2]!);
    const cell = layout.rects[slot];
    if (!cell) continue;
    const o = i * 2;
    uv[o] = cell.u0; uv[o + 1] = cell.v0;
    uv[o + 2] = cell.u1; uv[o + 3] = cell.v0;
    uv[o + 4] = cell.u1; uv[o + 5] = cell.v1;
    uv[o + 6] = cell.u0; uv[o + 7] = cell.v1;
  }
}

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
  const layout = getStencilLayout();
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = layout.height;
  const c = canvas.getContext('2d')!;
  c.fillStyle = c.strokeStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const { name, x, y } of layout.glyphs) {
    if (name.length > 1) {
      drawSymbol(c, name as (typeof SYMBOLS)[number], x, y);
      continue;
    }
    c.font = `${CELL * 0.98}px ${FONT}`;
    c.fillText(name, x + CELL / 2, y + CELL / 2 + 8);
  }
  for (const { name, x, y } of layout.words) {
    c.font = `${WORD_H * 0.84}px ${FONT}`;
    const w = c.measureText(name).width;
    c.save();
    c.translate(x + WORD_W / 2, y + WORD_H / 2 + 4);
    c.scale(Math.min(1, (WORD_W - 24) / w), 1);
    c.fillText(name, 0, 0);
    c.restore();
  }
  // The bridges a real stencil needs, then wear: paint sprayed through a plate is never a clean print.
  c.globalCompositeOperation = 'destination-out';
  const glyphRows = Math.ceil(layout.glyphs.length / COLS);
  for (let i = 0; i < glyphRows; i++) {
    for (let col = 0; col < COLS; col++) c.fillRect(col * CELL, i * CELL + CELL / 2 - 3, CELL, 6);
  }
  const rng = mulberry32(0x57e9c11);
  const speckles = Math.round(30000 * (layout.height / SIZE));
  for (let i = 0; i < speckles; i++) {
    const r = 0.6 + rng() * rng() * rng() * 6;
    c.beginPath();
    c.arc(rng() * SIZE, rng() * layout.height, r, 0, Math.PI * 2);
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
  let slot = activeSlot.get(name);
  if (slot === undefined) {
    slot = activeNames.length;
    activeNames.push(name);
    activeSlot.set(name, slot);
    cachedLayout = null;
  }
  const aspect = GLYPH_SET.has(name) ? 1 : WORD_W / WORD_H;
  const w = h * aspect;
  k.geo.use('stencil').tint(rgb[0], rgb[1], rgb[2]);
  // Encode slot index in u0; finalizeStencilUVs() remaps each quad to its compacted atlas cell in Geo.finish().
  k.geo.quadRect(x - w / 2, y - h / 2, z, x + w / 2, y + h / 2, slot, 0, slot + 1, 1);
  k.geo.tint(1);
}

/** Same, laid flat on the floor at (x, z). `yaw` 0 reads upright to someone looking north. */
export function floorStencil(k: Kit, name: StencilName, x: number, z: number, yaw: number, h: number, rgb: readonly [number, number, number], y = 0.02): void {
  k.push(x, y, z, yaw, 0, -Math.PI / 2);
  stencil(k, name, 0, 0, 0, h, rgb);
  k.pop();
}
