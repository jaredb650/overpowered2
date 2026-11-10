/**
 * What a swing can touch, as geometry alone: reach, arc, the slab's width, a thrust's cone, point blank, and that nothing
 * behind the eye is ever struck. Every swing of every weapon on key 5 is held to its own reach here.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KATANA, MELEE, REACH_DOWN, type MeleeId, type MeleeSwing } from './data';
import { swingTouches, sweepDirection, type BodyShape, type SwingFrame, type SwingShape } from './sweep';

const EYE_Y = 1.6;
const RADIUS = 0.35;
const out = new THREE.Vector3();

function frame(sx: number, sy: number, forward = new THREE.Vector3(0, 0, -1)): SwingFrame {
  const f = forward.clone().normalize();
  return { eye: new THREE.Vector3(0, EYE_Y, 0), forward: f, sweep: sweepDirection(f, sx, sy, new THREE.Vector3()) };
}

function shapeOf(s: MeleeSwing, pointBlank = 0.5, dip = 0): SwingShape {
  return { reach: s.reach, arc: s.arc, width: s.width, pointBlank, thrust: s.thrust === true, dip };
}

/** A man-sized body whose front is `surface` meters from the eye, `side` meters to the right, `ahead` the way the eye looks. */
function body(surface: number, side = 0, height = 1.8): BodyShape {
  // The eye is 1.6 up and the closest point of the body is level with it, so the body's axis is `surface + r` out.
  return { base: new THREE.Vector3(side, 0, -(surface + RADIUS)), height, radius: RADIUS };
}

const FLAT: SwingShape = { reach: 2.2, arc: 2.5, width: 0.5, pointBlank: 0.5 };
const DOWN: SwingShape = { reach: 2.1, arc: 2.0, width: 0.5, pointBlank: 0.5 };

describe('reach', () => {
  it('strikes a body up to its reach and not a hand past it', () => {
    const f = frame(-1, 0.06);
    expect(swingTouches(FLAT, f, body(1.0), out)).toBeGreaterThanOrEqual(0);
    expect(swingTouches(FLAT, f, body(2.15), out)).toBeGreaterThanOrEqual(0);
    expect(swingTouches(FLAT, f, body(2.3), out)).toBe(-1);
    expect(swingTouches(FLAT, f, body(5), out)).toBe(-1);
  });

  it('reports the distance to the surface, not to the middle', () => {
    const d = swingTouches(FLAT, frame(-1, 0), body(1.5), out);
    expect(d).toBeCloseTo(1.5, 1);
  });

  it('never strikes behind the eye, however close', () => {
    const f = frame(-1, 0);
    const behind: BodyShape = { base: new THREE.Vector3(0, 0, 0.6), height: 1.8, radius: RADIUS };
    expect(swingTouches(FLAT, f, behind, out)).toBe(-1);
    const backRight: BodyShape = { base: new THREE.Vector3(0.6, 0, 0.6), height: 1.8, radius: RADIUS };
    expect(swingTouches(FLAT, f, backRight, out)).toBe(-1);
  });

  it('strikes anything right in front of the eye, whatever the swing', () => {
    // A thin overhead cut and a body off to its side, but in the player's face.
    const narrow: SwingShape = { reach: 2, arc: 0.4, width: 0.05, pointBlank: 0.5 };
    const f = frame(0, -1);
    const close: BodyShape = { base: new THREE.Vector3(0.5, 0, -0.5), height: 1.8, radius: RADIUS };
    expect(swingTouches(narrow, f, close, out)).toBeGreaterThanOrEqual(0);
  });
});

describe('arc and width', () => {
  it('a flat swing covers its arc either side of the crosshair, and no more', () => {
    const f = frame(-1, 0);
    // 1.8 m out, at angles inside and outside 1.25 rad (half of 2.5) plus the body's own width.
    const at = (deg: number): BodyShape => {
      const a = (deg * Math.PI) / 180;
      const d = 1.8 + RADIUS;
      return { base: new THREE.Vector3(Math.sin(a) * d, 0, -Math.cos(a) * d), height: 1.8, radius: RADIUS };
    };
    expect(swingTouches(FLAT, f, at(0), out)).toBeGreaterThanOrEqual(0);
    expect(swingTouches(FLAT, f, at(60), out)).toBeGreaterThanOrEqual(0);
    expect(swingTouches(FLAT, f, at(-75), out)).toBeGreaterThanOrEqual(0);
    expect(swingTouches(FLAT, f, at(95), out)).toBe(-1);
    expect(swingTouches(FLAT, f, at(-100), out)).toBe(-1);
  });

  it('a downward cut is a slab: wide up and down, as wide as the blade and the arm across', () => {
    const f = frame(0, -1);
    expect(swingTouches(DOWN, f, body(1.5, 0), out)).toBeGreaterThanOrEqual(0);
    expect(swingTouches(DOWN, f, body(1.5, 0.75), out)).toBeGreaterThanOrEqual(0);
    expect(swingTouches(DOWN, f, body(1.5, 1.0), out)).toBe(-1);
    // A crouching one-meter body under the crosshair is still under the blade.
    expect(swingTouches(DOWN, f, body(1.2, 0, 1.0), out)).toBeGreaterThanOrEqual(0);
  });

  it('the struck point is where the blade passes, so a flat swing at eye height meets the head', () => {
    swingTouches(FLAT, frame(-1, 0), body(1.5), out);
    expect(out.y).toBeGreaterThan(1.4);
    const looking = frame(-1, 0, new THREE.Vector3(0, -0.45, -1));
    swingTouches(FLAT, looking, body(1.2), out);
    expect(out.y).toBeLessThan(1.3);
  });

  it('a cut straight down a body lands where the crosshair is, not at its feet', () => {
    swingTouches(DOWN, frame(-0.2, -1), body(1.4), out);
    expect(out.y).toBeGreaterThan(1.3);
    swingTouches(DOWN, frame(0, -1, new THREE.Vector3(0, -0.35, -1)), body(1.4), out);
    expect(out.y).toBeGreaterThan(0.7);
    expect(out.y).toBeLessThan(1.4);
  });

  it('a thrust is a narrow cone along the crosshair', () => {
    const jab: SwingShape = { reach: 1.8, arc: 0.5, width: 0.3, pointBlank: 0.5, thrust: true };
    const f = frame(0, -1);
    expect(swingTouches(jab, f, body(1.6, 0), out)).toBeGreaterThanOrEqual(0);
    expect(swingTouches(jab, f, body(1.6, 1.2), out)).toBe(-1);
    expect(swingTouches(jab, f, body(2.0, 0), out)).toBe(-1);
  });
});

describe('every melee swing', () => {
  const ids = Object.keys(MELEE) as MeleeId[];

  it.each(ids)('%s reaches what its row says and not a meter more', id => {
    const m = MELEE[id];
    const swings = [...m.chain, ...(m.heavy ? [m.heavy] : [])];
    for (const s of swings) {
      const f = frame(s.sweep[0], s.sweep[1]);
      const shape = shapeOf(s, m.pointBlank);
      expect(swingTouches(shape, f, body(s.reach - 0.1), out), `${id} ${s.move} at its reach`).toBeGreaterThanOrEqual(0);
      expect(swingTouches(shape, f, body(s.reach + 0.2), out), `${id} ${s.move} past its reach`).toBe(-1);
      expect(swingTouches(shape, f, body(s.reach + 1), out), `${id} ${s.move} a meter past`).toBe(-1);
    }
  });

  it('the katana cuts no further than 3 m to the front of a body, its step included', () => {
    for (const s of MELEE.sword.chain) expect(s.reach + MELEE.sword.step).toBeLessThanOrEqual(3.0 + 1e-9);
    // Its specials have their own reach: the charged sweep a long step, the dash a run.
    expect(KATANA.area.reach).toBeLessThanOrEqual(3.5);
    expect(KATANA.dash.range).toBeLessThan(10);
  });

  it('the knife is the shortest and the spade the longest of the new four', () => {
    const longest = (id: MeleeId) => Math.max(...MELEE[id].chain.map(s => s.reach)) + MELEE[id].step;
    expect(longest('knife')).toBeLessThan(longest('baton'));
    expect(longest('knife')).toBeLessThan(longest('crowbar'));
    expect(longest('shovel')).toBeGreaterThan(longest('crowbar'));
    expect(longest('shovel')).toBeLessThanOrEqual(longest('sword'));
  });
});

describe('reaching down', () => {
  const ids = Object.keys(MELEE) as MeleeId[];
  /** A Skitter: 0.72 m tall, its middle `ahead` meters out along the look. */
  const skitter = (ahead: number, side = 0): BodyShape => ({ base: new THREE.Vector3(side, 0, -ahead), height: 0.72, radius: 0.3 });
  /** A walking look, a little under level. */
  const walking = new THREE.Vector3(0, -Math.sin(0.12), -Math.cos(0.12));

  it('without it, a flat swing passes over a Skitter at the feet', () => {
    const s = MELEE.crowbar.chain[0]!;
    expect(swingTouches(shapeOf(s, MELEE.crowbar.pointBlank), frame(s.sweep[0], s.sweep[1], walking), skitter(1.0), out)).toBe(-1);
  });

  it.each(ids)('every swing of %s meets a Skitter at the feet at a walking look', id => {
    const m = MELEE[id];
    for (const s of [...m.chain, ...(m.heavy ? [m.heavy] : [])]) {
      const shape = shapeOf(s, m.pointBlank, REACH_DOWN);
      for (const at of [0.7, 1.0]) {
        expect(swingTouches(shape, frame(s.sweep[0], s.sweep[1], walking), skitter(at), out), `${id} ${s.move} at ${at}`).toBeGreaterThanOrEqual(0);
        expect(out.y, 'struck on the body').toBeLessThan(0.72);
      }
    }
  });

  it('does not add a centimetre of reach, and does not reach behind or up', () => {
    for (const id of ids) {
      const m = MELEE[id];
      for (const s of m.chain) {
        const shape = shapeOf(s, m.pointBlank, REACH_DOWN);
        const f = frame(s.sweep[0], s.sweep[1], walking);
        // The eye to the near top of a Skitter, past the reach.
        expect(swingTouches(shape, f, skitter(s.reach + 0.6), out), `${id} ${s.move} past reach`).toBe(-1);
        expect(swingTouches(shape, f, { base: new THREE.Vector3(0, 0, 0.9), height: 0.72, radius: 0.3 }, out), `${id} behind`).toBe(-1);
        // A body up on a ledge: whatever the swing does there, reaching down changes nothing.
        const ledge: BodyShape = { base: new THREE.Vector3(0, 2.6, -1.4), height: 0.72, radius: 0.3 };
        expect(swingTouches(shape, f, ledge, out), `${id} above`).toBe(swingTouches(shapeOf(s, m.pointBlank), f, ledge, out));
      }
    }
  });

  it('a level swing at a standing man is the same with or without it', () => {
    const s = MELEE.sword.chain[2]!;
    const a = swingTouches(shapeOf(s, 0.55), frame(s.sweep[0], s.sweep[1]), body(1.5), out);
    const y = out.y;
    expect(swingTouches(shapeOf(s, 0.55, REACH_DOWN), frame(s.sweep[0], s.sweep[1]), body(1.5), out)).toBe(a);
    expect(out.y).toBe(y);
  });
});
