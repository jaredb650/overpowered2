/** Pieces more than one weapon shares: trigger timing, ammo readouts, and the rounds themselves. */
import { clamp } from '../../../core/math';
import type { Anim } from '../def';
import { F } from '../kit/finishes';
import type { Finish, Mesher } from '../kit/mesher';

/** Pulls the trigger and the finger with it for the first moments of a shot. */
export function pullTrigger(a: Anim, hold = 0.07, angle = 0.32): void {
  const pull = a.sinceFire < hold ? 1 : 0;
  a.parts.trigger!.rotation.x -= pull * angle;
  a.right.trigger = pull;
}

/** Fraction of the magazine left. */
export const fill = (a: Anim) => clamp(a.mag / Math.max(a.magSize, 1));

/** Big digits and a segmented bar, the one readout style every gun shares. */
export function drawCount(a: Anim, name: string, digits: number, segments: number, color = '#35e8ff'): void {
  const s = a.model!.screens[name];
  if (!s) return;
  const { g, canvas, texture } = s;
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = '#031014';
  g.fillRect(0, 0, w, h);
  g.fillStyle = a.mag <= a.magSize * 0.25 ? '#ff3a2a' : color;
  g.font = `800 ${Math.round(h * 0.82)}px "Courier New", monospace`;
  g.textBaseline = 'middle';
  g.fillText(String(a.mag).padStart(digits, '0'), h * 0.14, h / 2 + 2);
  const x0 = h * 0.14 + digits * h * 0.54;
  const lit = Math.ceil(fill(a) * segments);
  const step = (w - x0 - 4) / segments;
  for (let i = 0; i < segments; i++) {
    g.globalAlpha = i < lit ? 1 : 0.16;
    g.fillRect(x0 + i * step, h * 0.17, step * 0.72, h * 0.66);
  }
  g.globalAlpha = 1;
  texture.needsUpdate = true;
}

/** A 12 gauge shell lying along Z, head at the origin and the crimp toward -Z. */
export function shell12(m: Mesher, hull: Finish = F.red): void {
  m.use(F.brass);
  m.lathe([[0, 0.0005, 0], [0.0108, 0.0005], [0.0108, -0.0012], [0.0098, -0.0016], [0.0098, -0.014, 0]], 14, { chamfer: 0.0003 });
  m.use(hull);
  m.lathe([[0.0098, -0.014, 0], [0.0094, -0.0145], [0.0094, -0.059], [0.0072, -0.062], [0.0035, -0.062], [0, -0.0605, 0]], 14, { chamfer: 0.0004 });
}

/** A straight-walled pistol round along Z, head at the origin. */
export function round(m: Mesher, r: number, caseLength: number, bullet: number, jacket: Finish = F.copper): void {
  m.use(F.brass);
  m.lathe([[0, 0.0002, 0], [r * 1.1, 0.0002], [r * 1.1, -r * 0.2], [r * 0.96, -r * 0.28], [r, -r * 0.4], [r, -caseLength, 0]], 12, { chamfer: r * 0.05 });
  m.use(jacket);
  m.lathe([[r * 0.96, -caseLength, 0], [r * 0.96, -caseLength - bullet * 0.35], [r * 0.7, -caseLength - bullet * 0.8], [r * 0.3, -caseLength - bullet], [0, -caseLength - bullet, 0]], 12, { chamfer: 0 });
}
