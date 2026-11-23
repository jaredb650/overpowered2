/** Lane G (Key 4 & Awl crosshair): autocannon longer barrel viewmodel part + Awl black CS-style duplex reticle. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModId } from '../core/gameplay';
import { RETICLES } from '../ui/hud/overlays';
import { Kit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import { autocannonDef } from './viewmodels/models/autocannon';
import { dressModel, restingModel } from './viewmodels/rest';

let kit: Kit;

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect() {},
        fillText() {},
        createRadialGradient: () => ({ addColorStop() {} }),
      }),
    }),
  });
  const material = new THREE.MeshStandardMaterial();
  kit = new Kit({
    hard: material,
    glass: material,
    decal: material,
    decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
    glow(color: number, intensity: number) {
      const glow = new THREE.MeshBasicMaterial({ color });
      glow.color.multiplyScalar(intensity);
      glow.userData.base = glow.color.clone();
      return glow;
    },
  } as unknown as VmMaterials);
});

afterAll(() => vi.unstubAllGlobals());

describe('Lane G: autocannon longer barrel', () => {
  it('registers autocannonBarrel in autocannonDef.mods with part, hidden standard brake, and moved muzzle socket', () => {
    const def = autocannonDef(kit);
    const look = def.mods?.autocannonBarrel;
    expect(look).toBeDefined();
    expect(look!.part).toBe('longBarrel');
    expect(look!.hides).toBe('stdBrake');
    expect(look!.muzzle).toBe('muzzleLong');

    const { parts, sockets } = def.model;
    expect(parts.barrel).toBeDefined();
    expect(parts.longBarrel).toBeDefined();
    expect(parts.stdBrake).toBeDefined();
    // Both barrel tips live inside `barrel` so long-recoil animates them together.
    expect(parts.longBarrel!.parent).toBe(parts.barrel);
    expect(parts.stdBrake!.parent).toBe(parts.barrel);
    expect(parts.longBarrel!.children.length).toBeGreaterThan(0);

    expect(sockets.muzzle).toBeDefined();
    expect(sockets.muzzleLong).toBeDefined();
    expect(sockets.muzzleLong!.position.y).toBeCloseTo(sockets.muzzle!.position.y, 5);
    expect(sockets.muzzleLong!.position.z).toBeLessThan(sockets.muzzle!.position.z - 0.2);
  });

  it('toggles stdBrake and longBarrel cleanly on the shop/resting model and stacks with flak', () => {
    const def = autocannonDef(kit);
    const { root } = restingModel('autocannon', def);

    dressModel(root, def, new Set<ModId>());
    expect(root.getObjectByName('stdBrake')?.visible).toBe(true);
    expect(root.getObjectByName('longBarrel')?.visible).toBe(false);

    dressModel(root, def, new Set<ModId>(['autocannonBarrel']));
    expect(root.getObjectByName('stdBrake')?.visible).toBe(false);
    expect(root.getObjectByName('longBarrel')?.visible).toBe(true);
    expect(root.getObjectByName('heRounds')?.visible).toBe(true);
    expect(root.getObjectByName('flakRounds')?.visible).toBe(false);

    dressModel(root, def, new Set<ModId>(['autocannonBarrel', 'autocannonFlak']));
    expect(root.getObjectByName('stdBrake')?.visible).toBe(false);
    expect(root.getObjectByName('longBarrel')?.visible).toBe(true);
    expect(root.getObjectByName('heRounds')?.visible).toBe(false);
    expect(root.getObjectByName('flakRounds')?.visible).toBe(true);
  });
});

describe('Lane G: Awl black CS-style duplex crosshair', () => {
  it('uses thin continuous centre crosshairs and thick outer posts with no centre dot or range ticks', () => {
    const awl = RETICLES.awl;
    expect(awl).toBeDefined();
    const svg = awl!.svg;
    expect(svg).not.toContain('<circle');
    const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map(m => m[0]);
    expect(paths).toHaveLength(2);
    // Thin continuous crosshair crossing cleanly through (0, 0).
    expect(paths[0]).toMatch(/stroke-width="1(?:\.\d+)?"/);
    expect(paths[0]).toContain('M-300 0H300');
    expect(paths[0]).toContain('M0 -300V300');
    // Thick outer duplex posts toward the rim on all four axes.
    expect(paths[1]).toMatch(/stroke-width="[5-8](?:\.\d+)?"/);
    expect(paths[1]).toContain('M-300 0H-180');
    expect(paths[1]).toContain('M180 0H300');
    expect(paths[1]).toContain('M0 -300V-180');
    expect(paths[1]).toContain('M0 180V300');
  });

  it('styles the Awl reticle in crisp black in overlays.css', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/ui/css/overlays.css'), 'utf8');
    const match = css.match(/\.scope\[data-reticle="awl"\]\s*\.sc-ret\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const block = match![1]!;
    expect(block).not.toContain('#e0e6cb');
    expect(block).toMatch(/color:\s*#0[0-9a-f]{5}\b/i);
  });
});
