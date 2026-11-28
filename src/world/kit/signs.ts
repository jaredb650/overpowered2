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
  'BARRACKS', 'ARMOURY', 'INFIRMARY', 'MAGAZINE',
  'GATE 1', 'GATE 2', 'GATE 3', 'GATE 4', 'GATE 5', 'GATE 6', 'GATE 7', 'GATE 8',
  'MOTOR POOL', 'FUEL POINT', 'NO SMOKING', 'MESS HALL', 'COMMS', 'AMMO DUMP', 'CHECKPOINT', 'HALT', 'HQ', 'MINES',
  'HOLDFAST', 'PORT OFFICE', 'DRY DOCK', 'CANNERY', 'SALT PANS', 'NOODLES', 'QUAY', 'FERRY',
  'RECEPTION', 'NOW SERVING 0000', 'PLEASE TAKE A NUMBER', 'SERVER ROOM', 'BREAK ROOM', 'COPY ROOM', 'RECORDS', 'WAITING AREA',
  'DIRECTOR', 'EXECUTIVE SUITE', 'MEETING A', 'MEETING B', 'STAIRS', 'THE LIFT IS UNDER REVIEW', 'IT', 'SUPPLY',
  'EXIT', 'CAR PARK', 'LOADING', 'COMPLIANCE IS MANDATORY', 'SMILE: YOU ARE BEING AUDITED', 'FILE IN TRIPLICATE',
  'MORALE IS MONITORED', 'REGIONAL OFFICE 9', 'SOCIETAL COMPLIANCE', 'NO LOITERING', 'APPEALS: TAKE A NUMBER', 'ROOF',
  'P1', 'P2', 'PRINT ROOM', 'OPEN OFFICE', 'BREAKAGES ARE ITEMISED', 'THANK YOU FOR YOUR COMPLIANCE', 'PLEASE QUEUE', 'FIRE ESCAPE',
  // The Retraining Annex (world/map/annex).
  'EXIT · VOLUNTARY', 'RETRAINING', 'CROUCH', 'SLIDE', 'DASH', 'WALL RUN', 'CHIMNEY', 'SLAM',
  'ROCKET JUMP', 'THE GALLERY', 'STANDARD ISSUE', 'THE YARD', 'JUMP JET',
] as const;

export type SignName = (typeof SIGNS)[number];
export const signId = (name: SignName): number => SIGNS.indexOf(name);

const activeSigns: number[] = [];
const activeSlot = new Map<number, number>();
let signRows = Math.ceil(SIGNS.length / COLS);

/** Clears the active sign set before authoring a new map. */
export function resetSignAtlas(): void {
  activeSigns.length = 0;
  activeSlot.clear();
  signRows = Math.ceil(SIGNS.length / COLS);
}

/** UV rectangle of a sign. Stores unnormalized row indices when active atlas tracking is used; finalized in Geo.finish. */
export function signRect(id: number): [number, number, number, number] {
  let slot = activeSlot.get(id);
  if (slot === undefined) {
    slot = activeSigns.length;
    activeSigns.push(id);
    activeSlot.set(id, slot);
  }
  const c = slot % COLS, r = Math.floor(slot / COLS);
  // Store r + 1 and r as raw row numbers; finalizeSignUVs converts them to [0, 1] once all signs are known.
  return [c / COLS, r + 1, (c + 1) / COLS, r];
}

/** Converts raw row numbers written by signRect() into normalized V coordinates for the compacted atlas. */
export function finalizeSignUVs(uv: Float32Array, nv: number): void {
  signRows = Math.max(1, Math.ceil(activeSigns.length / COLS));
  const invRows = 1 / signRows;
  for (let i = 0; i < nv; i++) {
    const o = i * 2 + 1;
    uv[o] = 1 - uv[o]! * invRows;
  }
}

function paint(): HTMLCanvasElement {
  const list = activeSigns.length > 0 ? activeSigns : SIGNS.map((_, i) => i);
  const rows = Math.max(1, Math.ceil(list.length / COLS));
  signRows = rows;
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLS;
  canvas.height = CELL_H * rows;
  const c = canvas.getContext('2d')!;
  c.textBaseline = 'middle';
  for (let i = 0; i < list.length; i++) {
    const text = SIGNS[list[i]!]!;
    const x = (i % COLS) * CELL_W, y = Math.floor(i / COLS) * CELL_H;
    const warn = /DANGER|VOLTAGE|CRUSH|NO ENTRY|EVACUATE|GAP|NO SMOKING|HALT|MINES|AMMO|MANDATORY|AUDITED|MONITORED|UNDER REVIEW|LOITERING|ITEMISED|EXIT|FIRE ESCAPE/.test(text);
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
      continue;
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
  }
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
