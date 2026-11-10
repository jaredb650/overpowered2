/**
 * One clip for every swung weapon on key 5 but the katana, which keeps its own (sword.ts). A swing is three poses of the
 * weapon in view space, start, middle and end, run through as one curve; a heavy one first winds up to its start pose
 * over the share of the swing that its row in MELEE says the blow waits (`impact`), so the model and the hit agree.
 *
 * Poses are position, then Euler X, Y, Z, as the sword's: X near 1 stands the head of the weapon up, Y leans it across the
 * screen, Z rolls it about its own length. The weapon's length runs along -Z from the right hand.
 */
import type { SwordMove } from '../../../core/gameplay';
import { clamp } from '../../../core/math';
import { MELEE, type MeleeId } from '../../melee/data';
import { inOut, outCubic, outQuad } from '../curves';
import type { Anim } from '../def';

export type Pose = readonly [number, number, number, number, number, number];

export interface MeleeClip {
  rest: Pose;
  /** Each move's start, middle and end. Only the moves the weapon has. */
  moves: Partial<Record<SwordMove, readonly [Pose, Pose, Pose]>>;
  /** Radians it is rolled and meters it is dropped at the start of the draw. */
  drawRoll: number;
  drawDrop: number;
  /** Runs last, for moving parts: `draw` is 0..1 through the draw. */
  after?(a: Anim): void;
}

const N = 6;

function set(out: Float64Array, a: Pose): void {
  for (let i = 0; i < N; i++) out[i] = a[i]!;
}

function mix(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>, t: number): void {
  for (let i = 0; i < N; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
}

/** The quadratic through all three poses, so the middle one is a pose the weapon actually reaches. */
function arc(out: Float64Array, c: readonly [Pose, Pose, Pose], t: number): void {
  const u = 1 - t;
  for (let i = 0; i < N; i++) {
    const mid = 2 * c[1][i]! - (c[0][i]! + c[2][i]!) / 2;
    out[i] = u * u * c[0][i]! + 2 * u * t * mid + t * t * c[2][i]!;
  }
}

/** Share of each move spent winding up before the blow, from the weapon's own swings. */
function windOf(id: MeleeId): Partial<Record<SwordMove, number>> {
  const m = MELEE[id];
  const out: Partial<Record<SwordMove, number>> = {};
  for (const s of m.chain) out[s.move] = s.impact ?? 0;
  if (m.heavy) out[m.heavy.move] = m.heavy.impact ?? 0;
  return out;
}

/** A clip for `id`. Each call has its own state, so two weapons never share a pose. */
export function meleeClip(id: MeleeId, spec: MeleeClip): (a: Anim) => void {
  const cur = new Float64Array(N);
  const from = new Float64Array(N);
  const hold = { move: null as Anim['swing'], p: 0 };
  const wind = windOf(id);
  set(cur, spec.rest);

  return (a: Anim): void => {
    const move = a.swing;
    // A new move starts from wherever the weapon is, so a chain flows instead of popping back to guard.
    if (move !== hold.move || a.swingP < hold.p) {
      from.set(cur);
      hold.move = move;
    }
    hold.p = a.swingP;
    const p = a.swingP;
    const path = move ? spec.moves[move] : undefined;
    if (path) {
      const w = wind[move!] ?? 0;
      const back = p > 1 ? clamp((p - 1) / (a.recover / a.swingSeconds)) : 0;
      if (w > 0 && p < w) {
        // Gathering: back to the start of the blow, slower at the end so the weight reads.
        mix(cur, from, path[0], outCubic(p / w));
      } else {
        // Fastest at the start: the blow lands as it begins, so it cannot be seen arriving late.
        const t = w > 0 ? (Math.min(p, 1) - w) / (1 - w) : Math.min(p, 1);
        arc(cur, path, outQuad(clamp(t)));
        if (w === 0 && p < 0.14) {
          const k = inOut(p / 0.14);
          for (let i = 0; i < N; i++) cur[i] = from[i]! + (cur[i]! - from[i]!) * k;
        }
      }
      if (back > 0) mix(cur, cur, spec.rest, inOut(back));
    } else {
      set(cur, spec.rest);
    }

    if (a.draw < 1) {
      const k = 1 - outCubic(a.draw);
      cur[5] = cur[5]! - k * spec.drawRoll;
      cur[1] = cur[1]! - k * spec.drawDrop;
    }

    const r = spec.rest;
    a.gunP.x += cur[0]! - r[0];
    a.gunP.y += cur[1]! - r[1];
    a.gunP.z += cur[2]! - r[2];
    a.gunR.x += cur[3]! - r[3];
    a.gunR.y += cur[4]! - r[4];
    a.gunR.z += cur[5]! - r[5];
    spec.after?.(a);
  };
}
