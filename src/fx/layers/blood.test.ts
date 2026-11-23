import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialLibrary } from '../../core/contracts';
import type { FxCore } from '../core';
import { BLOOD_PUFF_SCALE, bloodMist, bloodPuff, PUFF } from '../recipes/blood';
import { BloodLayer, crossing } from './blood';
import { makeUniforms } from './shared';

/** Euler steps of the same motion the vertex shader evaluates in closed form. */
function simulate(h: number, hv: number, ha: number, k: number): number {
  const dt = 1e-4;
  let v = hv;
  for (let t = 0; t < 5; t += dt) {
    v += (ha - k * v) * dt;
    h += v * dt;
    if (h <= 0) return t;
  }
  return Infinity;
}

describe('crossing', () => {
  it('lands where the dragged path really lands', () => {
    expect(crossing(1.4, 3, -14, 1.5, 3)).toBeCloseTo(simulate(1.4, 3, -14, 1.5), 2);
    expect(crossing(0.6, 9, -14, 0.6, 3)).toBeCloseTo(simulate(0.6, 9, -14, 0.6), 2);
  });

  it('returns the limit when drag stops the strand short of a wall', () => {
    expect(crossing(8, -6, 0, 2, 1.6)).toBe(1.6);
  });

  it('never reports a landing for a start behind the plane', () => {
    expect(crossing(-0.1, 5, -14, 1, 1.6)).toBe(1.6);
  });
});

describe('the impact puff', () => {
  const layer = () => new BloodLayer(new THREE.Scene(), makeUniforms(), { patch: () => null } as unknown as MaterialLibrary, 512);
  const core = (blood: BloodLayer, now = 1) => ({ blood, bloodNow: now } as unknown as FxCore);
  const at = new THREE.Vector3(0, 1.2, 0);
  const dir = new THREE.Vector3(0, 0, -1);

  it('emits an immediate liquid splash web, billowing mist, splatter plume and fast streaks that expire cleanly', () => {
    const blood = layer();
    bloodPuff(core(blood), at, dir, 0.3);
    // 1 splash web + 1 billowing puff + 5 kinetic streaks + 1 directional mist cone = 8 records.
    expect(blood.ring.countLive(1.02)).toBe(8);
    expect(blood.ring.countLive(1 + (PUFF.life + PUFF.lifeHeavy) * 1.3 + 0.05)).toBe(0);
    const d = blood.ring.data;
    // Record 0 is the liquid splash web (aC.z = -2, negative opacity), born now, standing off the skin toward the gun.
    expect(d[10]).toBeLessThan(-1.5);
    expect(d[11]).toBeLessThan(0);
    expect(d[3]).toBe(1);
    expect(d[2]).toBeGreaterThan(at.z);
    // Record 1 is the billowing mist cloud (aC.z = -1, negative opacity).
    expect(d[16 + 10]).toBe(-1);
    expect(d[16 + 11]).toBeLessThan(0);
  });

  it('scales dramatically from light rounds to heavy hits, torso blowouts, and gigantic pasted gib clouds', () => {
    const light = layer();
    const heavy = layer();
    const blowout = layer();
    const gib = layer();
    bloodPuff(core(light), at, dir, 0.2);
    bloodPuff(core(heavy), at, dir, 0.9);
    bloodPuff(core(blowout), at, dir, 1, 1.85, 'blowout');
    bloodPuff(core(gib), at, dir, 1, 1.5, 'gib');
    expect(heavy.ring.data[9]).toBeGreaterThan(light.ring.data[9]! * 1.5);
    expect(heavy.ring.data[7]).toBeGreaterThan(light.ring.data[7]!);
    expect(blowout.ring.data[9]).toBeGreaterThan(heavy.ring.data[9]! * 1.8);
    expect(gib.ring.data[9]).toBeGreaterThan(heavy.ring.data[9]! * 2.5);
    expect(gib.ring.countLive(1.1)).toBeGreaterThan(heavy.ring.countLive(1.1) * 3);
    // Gigantic gib cloud hangs as a billowing crimson mist for over a second.
    expect(gib.ring.countLive(2.2)).toBeGreaterThanOrEqual(12);
  });

  it('has a hard cap a frame, and a new frame has its own', () => {
    const blood = layer();
    for (let i = 0; i < 40; i++) bloodPuff(core(blood, 2), at, dir, 0.3);
    const capped = blood.ring.countLive(2.02);
    // Only PUFF.perFrame bullet pops are admitted on the same frame (8 records each).
    expect(capped).toBe(PUFF.perFrame * 8);
    bloodPuff(core(blood, 2.016), at, dir, 0.3);
    expect(blood.ring.countLive(2.03)).toBe(capped + 8);
  });

  it('compiles splash, puff and mist vertex/fragment shaders without pow(0, y) NaN traps', () => {
    const blood = layer();
    const mat = (blood.ring.object as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const fake = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <project_vertex>',
      fragmentShader: '#include <map_pars_fragment>\n#include <map_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>\n#include <tonemapping_fragment>',
    };
    mat.onBeforeCompile(fake as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, '');
    expect(stripComments(fake.vertexShader)).not.toContain('pow(');
    // Extract the splash, puff, and mist branches of FRAG_COVER and verify none call pow().
    const nonStrand = stripComments(fake.fragmentShader.slice(
      fake.fragmentShader.indexOf('if (vStrand.z < -2.5)'),
      fake.fragmentShader.indexOf('float beads = max(vStrand.z, 1.0);'),
    ));
    expect(nonStrand.length).toBeGreaterThan(200);
    expect(nonStrand).not.toContain('pow(');
  });

  it('scales blood puffs and mists independently per event kind and with the overall multiplier', () => {
    const base = layer();
    const small = layer();
    const big = layer();
    const other = layer();
    const mistBase = layer();
    const mistSmall = layer();
    try {
      bloodPuff(core(base, 10), at, dir, 1, 1.2, 'gib');
      BLOOD_PUFF_SCALE.gib = 0.25;
      bloodPuff(core(small, 11), at, dir, 1, 1.2, 'gib');
      // Adjusting gib does not change bullet puffs.
      bloodPuff(core(other, 12), at, dir, 0.3, 1, 'bullet');
      BLOOD_PUFF_SCALE.gib = 2;
      bloodPuff(core(big, 13), at, dir, 1, 1.2, 'gib');

      expect(small.ring.data[9]!).toBeCloseTo(base.ring.data[9]! * 0.25, 3);
      expect(big.ring.data[9]!).toBeCloseTo(base.ring.data[9]! * 2, 3);

      const bulletRef = layer();
      BLOOD_PUFF_SCALE.gib = 1;
      bloodPuff(core(bulletRef, 14), at, dir, 0.3, 1, 'bullet');
      expect(other.ring.data[9]!).toBeCloseTo(bulletRef.ring.data[9]!, 4);

      // Overall × per-event scales bloodMist as well.
      bloodMist(core(mistBase, 15), at, 1, 'headshot');
      BLOOD_PUFF_SCALE.overall = 0.5;
      BLOOD_PUFF_SCALE.headshot = 0.5;
      bloodMist(core(mistSmall, 16), at, 1, 'headshot');
      expect(mistSmall.ring.data[9]!).toBeCloseTo(mistBase.ring.data[9]! * 0.25, 3);
    } finally {
      BLOOD_PUFF_SCALE.overall = 1;
      BLOOD_PUFF_SCALE.bullet = 1;
      BLOOD_PUFF_SCALE.shotgun = 1;
      BLOOD_PUFF_SCALE.headshot = 1;
      BLOOD_PUFF_SCALE.headburst = 1;
      BLOOD_PUFF_SCALE.limb = 1;
      BLOOD_PUFF_SCALE.blowout = 1;
      BLOOD_PUFF_SCALE.gib = 1;
    }
  });
});
