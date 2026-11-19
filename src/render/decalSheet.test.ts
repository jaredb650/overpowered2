import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Decals } from './Decals';
import {
  BIG_CELLS, CELL, CELL_COUNT, DRAG_ASPECT, Flag, KIND_CELLS, MAX_STRETCH, SHEET, SMALL_CELLS, SPLASH_FROM, cellRect, chooseSplat, flagOf, flipsOf,
  isBloodCell, lipOf, shapeOf, type BigKind,
} from './decalSheet';
import { DECAL_FRAG_MAIN, DECAL_VERT_MAIN } from './decalShader.glsl';
import { DECAL_GLSL } from './materials/decalAtlas.glsl';
import type { MaterialPatcher } from './materials/patch';
import type { BakedSet } from './materials/TextureBaker';
import type { DecalKind } from '../core/contracts';

const patcher = { apply: (m: THREE.MeshStandardMaterial) => m } as unknown as MaterialPatcher;
const atlas = { albedo: null, surface: null } as unknown as BakedSet;
const floor = new THREE.Vector3(0, 1, 0);
const wall = new THREE.Vector3(0, 0, 1);

/** What a slot holds, unpacked the way the shader unpacks it. */
function slot(d: Decals, ring: 'blood' | 'big' | 'mark' | 'scorch', n = 0) {
  const i = d.base(ring) + n;
  const data = (d.mesh.geometry.getAttribute('aDecal') as THREE.InstancedBufferAttribute).array as Float32Array;
  const m = d.mesh.instanceMatrix.array as Float32Array;
  const whole = Math.floor(data[i * 4 + 2]!);
  return {
    cell: Math.floor(data[i * 4]!),
    thin: (data[i * 4]! % 1) / 0.9,
    kind: whole % 8,
    flips: Math.floor(whole / 8),
    w: data[i * 4 + 3]!,
    x: new THREE.Vector3(m[i * 16]!, m[i * 16 + 1]!, m[i * 16 + 2]!),
    y: new THREE.Vector3(m[i * 16 + 4]!, m[i * 16 + 5]!, m[i * 16 + 6]!),
    at: new THREE.Vector3(m[i * 16 + 12]!, m[i * 16 + 13]!, m[i * 16 + 14]!),
  };
}

describe('the decal sheet', () => {
  it('is 48 small cells over 20 big ones, and every cell has its own square of it', () => {
    expect(SMALL_CELLS).toBe(48);
    expect(CELL_COUNT).toBe(68);
    const seen = new Set<string>();
    const r: [number, number, number, number] = [0, 0, 0, 0];
    for (let c = 0; c < CELL_COUNT; c++) {
      cellRect(c, r);
      expect(r[0]).toBeGreaterThanOrEqual(0);
      expect(r[1]).toBeGreaterThanOrEqual(0);
      expect(r[0] + r[2]).toBeLessThanOrEqual(1 + 1e-9);
      expect(r[1] + r[3]).toBeLessThanOrEqual(1 + 1e-9);
      // Square in pixels, 256 small and 512 big.
      expect(r[2] * SHEET.width).toBeCloseTo(c < SMALL_CELLS ? 256 : 512);
      expect(r[3] * SHEET.height).toBeCloseTo(c < SMALL_CELLS ? 256 : 512);
      const key = `${Math.round(r[0] * 64)},${Math.round(r[1] * 64)}`;
      expect(seen.has(key), `cell ${c}`).toBe(false);
      seen.add(key);
    }
    // The small rows end where the big ones begin.
    expect(cellRect(SMALL_CELLS - 1, r)[1] + r[3]).toBeCloseTo(cellRect(SMALL_CELLS, [0, 0, 0, 0])[1]);
  });

  it('is laid out the same in the shader that draws it, the shader that reads it and this table', () => {
    // The atlas shader's dispatcher: which cells are blood, and where each group starts.
    expect(DECAL_GLSL).toContain(`(cell >= ${CELL.drop} && cell < ${CELL.slash}) || (cell >= ${CELL.burst} && cell < ${CELL.scorch})`);
    expect(DECAL_GLSL).toContain(`if (cell == ${CELL.detail})`);
    for (const [name, next] of [['cellDrop', CELL.oval], ['cellOval', CELL.mist], ['cellMist', CELL.cast], ['cellCast', CELL.arc], ['cellArc', CELL.trail],
      ['cellTrail', CELL.wipe], ['cellBurst', CELL.fan], ['cellFan', CELL.soak], ['cellSoak', CELL.sheet], ['cellSheet', CELL.drag]] as const) {
      expect(DECAL_GLSL, name).toMatch(new RegExp(`cell < ${next}\\) ${name}\\(`));
    }
    expect(DECAL_GLSL).toMatch(new RegExp(`cell < ${CELL.pool}\\) cellWipe\\(`));
    expect(DECAL_GLSL).toMatch(new RegExp(`cell < ${CELL.print}\\) \\{ cellPool\\(`));
    expect(DECAL_GLSL).toMatch(new RegExp(`cell < ${CELL.slash}\\) cellPrint\\(`));
    expect(DECAL_GLSL).toMatch(new RegExp(`cell < ${CELL.ring}\\) cellWipe\\(`));
    // The decal shader finds a cell by the same sum as `cellRect`.
    expect(DECAL_VERT_MAIN).toContain(`opCell < ${SMALL_CELLS}.0`);
    expect(DECAL_VERT_MAIN).toContain(`floor(opCell / ${SHEET.smallCols}.0) / 16.0`);
    // A cell number is never interpolated: a rounding error there striped every first-column cell of the old sheet.
    expect(DECAL_FRAG_MAIN).not.toMatch(/mod\(opCell|opCell \/ /);
    for (let c = 0; c < CELL_COUNT; c++) expect(isBloodCell(c), `cell ${c}`).toBe((c >= CELL.drop && c < CELL.slash) || (c >= CELL.burst && c < CELL.scorch));
  });

  it('gives every kind cells of its own, inside the sheet', () => {
    const kinds: DecalKind[] = ['bullet', 'bulletMetal', 'bulletGlass', 'scorch', 'soot', 'blood', 'bloodPool', 'bloodSmear', 'slash', 'crack', 'exit'];
    for (const k of kinds) {
      const [first, n] = KIND_CELLS[k];
      expect(n, k).toBeGreaterThan(0);
      expect(first + n, k).toBeLessThanOrEqual(CELL_COUNT);
      for (let c = first; c < first + n; c++) expect(isBloodCell(c), `${k} ${c}`).toBe(flagOf(k) !== Flag.Mark);
    }
    // A round leaves a different mark in stone, plate and glass, and a fire's soot is not a blast's scorch.
    const firsts = (['bullet', 'bulletMetal', 'bulletGlass', 'exit', 'soot', 'scorch'] as DecalKind[]).map(k => KIND_CELLS[k][0]);
    expect(new Set(firsts).size).toBe(firsts.length);
    // Sixteen and more blood stains where there were four blots, and three variants of each big one but the drag.
    expect(CELL.slash - CELL.drop).toBeGreaterThanOrEqual(16);
    for (const k of Object.keys(BIG_CELLS) as BigKind[]) {
      const [first, n] = BIG_CELLS[k];
      expect(first).toBeGreaterThanOrEqual(SMALL_CELLS);
      expect(n, k).toBeGreaterThanOrEqual(k === 'drag' ? 2 : 3);
      expect(first + n, k).toBeLessThanOrEqual(CELL.scorch);
    }
  });
});

describe('the shape a drop leaves', () => {
  const cells = (size: number, speed: number, into: number, n = 40) => {
    const out = new Set<number>();
    for (let i = 0; i < n; i++) out.add(chooseSplat(size, speed, into, (i + 0.5) / n).cell);
    return out;
  };

  it('is round when it lands square on: clean if it only fell, broken up the harder it hits', () => {
    for (const c of cells(0.06, 0, 0)) expect(c).toBeGreaterThanOrEqual(CELL.drop);
    for (const c of cells(0.06, 0, 0)) expect(c).toBeLessThan(CELL.oval);
    // A slow drip is never the crown of spines; a hard hit is never the clean drop.
    expect(cells(0.05, 1.5, 1.5).has(CELL.drop + 2)).toBe(false);
    expect(cells(0.05, 1.5, 1.5).has(CELL.drop)).toBe(true);
    expect(cells(0.15, 12, 12).has(CELL.drop)).toBe(false);
    expect(cells(0.15, 12, 12).has(CELL.drop + 2)).toBe(true);
    const s = chooseSplat(0.1, 3, 3, 0.2);
    expect(s.long).toBeCloseTo(s.wide);
  });

  it('is an oval with its tail along the travel when it arrives at an angle, longer the more it glances', () => {
    // 45 degrees: the short oval. 20 degrees: the tadpole. 8 degrees: the streak.
    expect(chooseSplat(0.1, 8, 8 * Math.sin(Math.PI / 4), 0.2).cell).toBe(CELL.oval);
    expect(chooseSplat(0.1, 8, 8 * Math.sin((20 * Math.PI) / 180), 0.2).cell).toBe(CELL.oval + 1);
    expect(chooseSplat(0.1, 8, 8 * Math.sin((8 * Math.PI) / 180), 0.2).cell).toBe(CELL.oval + 2);
    // The stain's own length over its width is one over the sine of the angle, whatever cell drew it, up to the cap.
    for (const deg of [50, 35, 25, 18, 12]) {
      const sin = Math.sin((deg * Math.PI) / 180);
      const s = chooseSplat(0.1, 8, 8 * sin, 0.2);
      const drawn = (s.long / s.wide) * shapeOf(s.cell).aspect;
      expect(drawn, `${deg} degrees`).toBeGreaterThan(Math.min(1 / sin, MAX_STRETCH) * 0.74);
      expect(drawn, `${deg} degrees`).toBeLessThan(Math.min(1 / sin, MAX_STRETCH) * 1.3);
    }
    // And as wide as a round stain of the same blood, within a half.
    const round = chooseSplat(0.1, 8, 8, 0.2);
    const oval = chooseSplat(0.1, 8, 8 * 0.4, 0.2);
    const body = (oval.wide * shapeOf(oval.cell).half) / (round.wide * shapeOf(round.cell).half);
    expect(body).toBeGreaterThan(0.6);
    expect(body).toBeLessThan(1.6);
  });

  it('is a whole composition once it is a splash: a burst square on, a fan thrown on from where it hit', () => {
    for (const c of cells(SPLASH_FROM + 0.2, 9, 9)) {
      expect(c).toBeGreaterThanOrEqual(CELL.burst);
      expect(c).toBeLessThan(CELL.fan);
    }
    expect(cells(0.8, 9, 9).size).toBe(3);
    const fan = chooseSplat(0.8, 9, 3, 0.5);
    expect(fan.cell).toBeGreaterThanOrEqual(CELL.fan);
    expect(fan.cell).toBeLessThan(CELL.soak);
    expect(fan.lead).toBeGreaterThan(0.3);
    expect(fan.long).toBeGreaterThan(fan.wide);
    expect(chooseSplat(SPLASH_FROM - 0.05, 9, 9, 0.5).cell).toBeLessThan(CELL.oval);
  });

  it('is a mist, or a pattern along the travel, when the caller says what made it', () => {
    expect(chooseSplat(0.3, 12, 12, 0.5, 'mist').cell).toBe(CELL.mist);
    expect(chooseSplat(0.3, 12, 5, 0.5, 'mist').cell).toBe(CELL.mist + 1);
    for (const [how, first] of [['cast', CELL.cast], ['arc', CELL.arc], ['trail', CELL.trail]] as const) {
      // One shared object comes back: read it before asking again.
      const a = chooseSplat(1, 5, 0.5, 0.1, how).cell;
      const b = chooseSplat(1, 5, 0.5, 0.9, how).cell;
      expect([a, b].sort()).toEqual([first, first + 1].sort());
    }
  });

  it('may be mirrored only the ways its shape allows', () => {
    // A footprint is left or right by the caller's word; a wall sheet's runs stay down; what points along +X only flips across it.
    expect(flipsOf(CELL.print)).toBe(0);
    for (let c = CELL.sheet; c < CELL.drag; c++) expect(flipsOf(c)).toBe(1);
    for (const c of [CELL.oval, CELL.oval + 3, CELL.mist + 1, CELL.cast, CELL.arc, CELL.trail, CELL.wipe, CELL.fan, CELL.drag, CELL.slash]) expect(flipsOf(c), `cell ${c}`).toBe(2);
    for (const c of [CELL.drop, CELL.mist, CELL.pool, CELL.burst, CELL.soak, CELL.ring, CELL.bulletConcrete, CELL.crack, CELL.scorch]) expect(flipsOf(c), `cell ${c}`).toBe(3);
  });

  it('keeps a wet lip a few millimetres wide whatever the size of the stain', () => {
    // Narrower in the field's units as the stain is drawn bigger, inside what eight bits can hold.
    expect(lipOf(CELL.drop, 0.1)).toBeGreaterThan(lipOf(CELL.drop, 0.4));
    for (const size of [0.03, 0.2, 1, 3]) {
      expect(lipOf(CELL.burst, size)).toBeGreaterThanOrEqual(0.035);
      expect(lipOf(CELL.burst, size)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('stains in the buffer', () => {
  it('go where they belong: small ones and single rounds with the blood, a kill\'s big ones in their own ring', () => {
    const d = new Decals(patcher, atlas);
    d.splat(new THREE.Vector3(), floor, 0.1, new THREE.Vector3(0, -3, 0));
    d.splat(new THREE.Vector3(), floor, 0.9, new THREE.Vector3(0, -9, 0));
    expect(d.live('blood')).toBe(2);
    expect(d.live('big')).toBe(0);
    d.big('burst', new THREE.Vector3(), floor, 2.4);
    expect(d.live('big')).toBe(1);
    d.big('fan', new THREE.Vector3(), floor, 0.7, new THREE.Vector3(1, 0, 0), true);
    expect(d.live('big')).toBe(1);
    expect(d.live('blood')).toBe(3);
    expect(slot(d, 'big').kind).toBe(Flag.Blood);
    expect(slot(d, 'big').cell).toBeGreaterThanOrEqual(CELL.burst);
  });

  it('turn a fan and a drag along the throw, starting where they were laid', () => {
    const d = new Decals(patcher, atlas);
    const dir = new THREE.Vector3(0, 0, -1);
    d.big('fan', new THREE.Vector3(5, 0, 5), floor, 2, dir);
    const fan = slot(d, 'big');
    expect(fan.x.clone().normalize().dot(dir)).toBeCloseTo(1);
    expect(fan.x.length()).toBeCloseTo(2);
    // Its middle is ahead of the point, so its root is near it.
    expect(fan.at.z).toBeLessThan(5 - 0.5);
    d.big('drag', new THREE.Vector3(), floor, 3, dir);
    const drag = slot(d, 'big', 1);
    expect(drag.x.length() / drag.y.length()).toBeCloseTo(DRAG_ASPECT);
    // Facing up off the floor, or it would be culled.
    expect(new THREE.Vector3().crossVectors(drag.x, drag.y).normalize().dot(floor)).toBeCloseTo(1);
  });

  it('hang a wall sheet with its runs down, whichever way the shot went, and never mirror it top to bottom', () => {
    const d = new Decals(patcher, atlas);
    for (let i = 0; i < 20; i++) d.big('sheet', new THREE.Vector3(0, 1.5, 0), wall, 1.5, new THREE.Vector3(Math.sin(i), Math.cos(i), -1));
    for (let i = 0; i < 20; i++) {
      const s = slot(d, 'big', i);
      expect(s.y.clone().normalize().y).toBeCloseTo(1);
      expect(s.flips & 2).toBe(0);
    }
  });

  it('pack the cell, how full it is, what it is and how it is mirrored where the shader looks for them', () => {
    const d = new Decals(patcher, atlas);
    d.stamp(CELL.pool + 1, new THREE.Vector3(), floor, 1, 0, 0, 0.5);
    const s = slot(d, 'blood');
    expect(s.cell).toBe(CELL.pool + 1);
    expect(s.thin).toBeCloseTo(0.5);
    expect(s.kind).toBe(Flag.Blood);
    expect(s.flips).toBe(0);
    d.add('bloodPool', new THREE.Vector3(), floor, 2);
    expect(slot(d, 'blood', 1).kind).toBe(Flag.Grow);
    d.add('bullet', new THREE.Vector3(), floor, 0.1);
    expect(slot(d, 'mark').kind).toBe(Flag.Mark);
    d.run(new THREE.Vector3(0, 1, 0), wall, 0.4);
    expect(slot(d, 'blood', 2).kind).toBe(Flag.Run);
  });
});
