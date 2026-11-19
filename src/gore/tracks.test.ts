import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeCtx } from '../sandbox/harness';
import { printThin } from '../render/decalSheet';
import { BloodField, BloodTuning } from './blood';
import { Tracks, TrackTuning, printFade } from './tracks';

/** A flat floor at y 0, a pool laid at the origin, and every print and smear recorded. */
function stage() {
  const prints: { at: THREE.Vector3; dir: THREE.Vector3; left: boolean; fade: number }[] = [];
  const wipes: { at: THREE.Vector3; size: number; thin: number }[] = [];
  const time = { elapsed: 0 };
  const player = { position: new THREE.Vector3(0, 0, 3), velocity: new THREE.Vector3(), yaw: 0, grounded: true, sliding: false, stridePhase: 0 };
  const ctx = makeCtx({
    time: time as unknown as ReturnType<typeof makeCtx>['time'],
    player: player as unknown as ReturnType<typeof makeCtx>['player'],
    fx: { bloodSpray() {}, bloodDrip() {}, bloodPuff() {}, bloodHit() {} } as unknown as ReturnType<typeof makeCtx>['fx'],
    physics: {
      raycastInto(o: THREE.Vector3, d: THREE.Vector3, max: number, _g: number, hit: { point: THREE.Vector3; normal: THREE.Vector3; distance: number }) {
        if (!(d.y < 0 && o.y > 0) || -o.y / d.y > max) return false;
        hit.point.copy(o).addScaledVector(d, -o.y / d.y);
        hit.normal.set(0, 1, 0);
        hit.distance = -o.y / d.y;
        return true;
      },
    } as unknown as ReturnType<typeof makeCtx>['physics'],
    render: {
      decals: {
        add() {}, splat() {}, clear() {}, big() {},
        print: (at: THREE.Vector3, _n: THREE.Vector3, _size: number, dir: THREE.Vector3, left: boolean, fade: number) =>
          prints.push({ at: at.clone(), dir: dir.clone(), left, fade }),
        wipe: (at: THREE.Vector3, _n: THREE.Vector3, size: number, _rot: number, thin: number) => wipes.push({ at: at.clone(), size, thin }),
      },
    } as unknown as ReturnType<typeof makeCtx>['render'],
  });
  const blood = new BloodField(ctx);
  const tracks = new Tracks(ctx, blood);
  const run = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      time.elapsed += 1 / 60;
      each?.();
      blood.update(1 / 60);
      tracks.update(1 / 60);
    }
  };
  blood.pool(new THREE.Vector3(0, 0.1, 0), 2, 3);
  run(0.1);
  return { blood, tracks, prints, wipes, run, player, time };
}

describe('blood on feet', () => {
  it('a pool is wet to step in, for a while, and the floor beside it is not', () => {
    const { blood, time } = stage();
    expect(blood.wetAt(0.3, 0, 0.2)).toBe(true);
    expect(blood.wetAt(3, 0, 0)).toBe(false);
    // Not the floor above or below it.
    expect(blood.wetAt(0, 3, 0)).toBe(false);
    time.elapsed += BloodTuning.wetFor + 1;
    expect(blood.wetAt(0.3, 0, 0.2)).toBe(false);
  });

  it('the player walks through a pool and leaves a dozen prints, left and right, each fainter, then none', () => {
    const { tracks, prints, run, player } = stage();
    // Walking along -Z (yaw 0), through the pool and four metres on, a stride every 0.7 m.
    let walked = 0;
    run(3.2, () => {
      player.position.z -= 5 / 60;
      walked += 5 / 60;
      player.stridePhase = walked / 0.7;
    });
    expect(prints.length).toBe(TrackTuning.steps);
    expect(tracks.playerSteps).toBe(0);
    // None inside the pool; the first is just past its edge.
    for (const p of prints) expect(Math.hypot(p.at.x, p.at.z)).toBeGreaterThan(0.6);
    // Left, right, left: either side of the line he walks, toes forward.
    for (let i = 1; i < prints.length; i++) {
      expect(prints[i]!.left).toBe(!prints[i - 1]!.left);
      expect(Math.sign(prints[i]!.at.x)).toBe(-Math.sign(prints[i - 1]!.at.x));
      expect(prints[i]!.fade).toBeGreaterThan(prints[i - 1]!.fade);
      expect(prints[i]!.dir.z).toBeCloseTo(-1);
    }
    // Facing -Z, his left is -X.
    for (const p of prints) expect(p.at.x < 0).toBe(p.left);
    expect(prints[0]!.fade).toBe(0);
    expect(prints[prints.length - 1]!.fade).toBeCloseTo(printFade(1));
  });

  it('feet that never touched blood leave nothing, and a jump leaves none either', () => {
    const { prints, run, player } = stage();
    player.position.set(6, 0, 3);
    let walked = 0;
    run(2, () => {
      player.position.z -= 5 / 60;
      walked += 5 / 60;
      player.stridePhase = walked / 0.7;
    });
    expect(prints).toHaveLength(0);
    const air = stage();
    air.player.grounded = false;
    walked = 0;
    air.run(2, () => {
      air.player.position.z -= 5 / 60;
      walked += 5 / 60;
      air.player.stridePhase = walked / 0.7;
    });
    expect(air.prints).toHaveLength(0);
  });

  it('a slide through a pool leaves long smears after it, fainter as it goes, and no prints', () => {
    const { wipes, prints, run, player, tracks } = stage();
    player.sliding = true;
    run(1.4, () => { player.position.z -= 6 / 60; });
    expect(prints).toHaveLength(0);
    expect(wipes.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < wipes.length; i++) expect(wipes[i]!.thin).toBeGreaterThan(wipes[i - 1]!.thin);
    // Each is longer than the stretch it covers, so they run together.
    for (const w of wipes) expect(w.size).toBeGreaterThan(TrackTuning.slideEvery);
    expect(tracks.playerSteps).toBeLessThan(TrackTuning.steps);
  });

  it('an enemy that steps in it leaves prints the way it faces, and one that did not costs nothing', () => {
    const { tracks, prints, run } = stage();
    const man = {};
    const dry = {};
    for (let i = 0; i < 6; i++) tracks.footfall(dry, 5, 0, -i * 0.6, 0, -1);
    expect(tracks.stepsOf(dry)).toBe(0);
    tracks.footfall(man, 0.1, 0, 0, 1, 0);
    expect(tracks.stepsOf(man)).toBe(TrackTuning.steps);
    for (let i = 1; i <= 15; i++) {
      tracks.footfall(man, 0.9 + i * 0.6, 0, i % 2 ? 0.1 : -0.1, 1, 0);
      run(1 / 30);
    }
    expect(prints.length).toBe(TrackTuning.steps);
    for (const p of prints) expect(p.dir.x).toBeCloseTo(1);
    expect(tracks.stepsOf(man)).toBe(0);
  });

  it('a crowd running through blood is rationed, and far from the player it leaves none', () => {
    const { tracks, prints, run } = stage();
    const men = Array.from({ length: 30 }, () => ({}));
    for (const m of men) tracks.footfall(m, 0, 0, 0, 1, 0);
    // All thirty step out of the pool in one frame.
    for (const m of men) tracks.footfall(m, 1.5, 0, 0, 1, 0);
    run(0.1);
    expect(prints.length).toBeLessThanOrEqual(TrackTuning.perSecond);
    expect(prints.length).toBeGreaterThan(0);
    const before = prints.length;
    run(1);
    const far = {};
    tracks.footfall(far, 0, 0, 0, 1, 0);
    tracks.footfall(far, 0, 0, 0, 1, 0);
    // He is wet, and walks off 40 m away.
    expect(tracks.stepsOf(far)).toBe(TrackTuning.steps);
    for (let i = 0; i < 4; i++) tracks.footfall(far, 0, 0, -40 - i, 0, -1);
    run(0.1);
    expect(prints.length).toBe(before);
    expect(tracks.stepsOf(far)).toBe(TrackTuning.steps - 4);
  });

  it('a print thins as the blood runs out', () => {
    expect(printFade(TrackTuning.steps)).toBe(0);
    expect(printFade(0)).toBe(1);
    expect(printThin(0)).toBeLessThan(0.5);
    expect(printThin(1)).toBeGreaterThan(printThin(0.5));
    expect(printThin(1)).toBeLessThanOrEqual(0.85);
    expect(printThin(0)).toBeGreaterThanOrEqual(0.3);
  });
});
