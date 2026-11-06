import * as THREE from 'three';
import type { GradeName, PostFx } from '../../core/contracts';
import { GRADES, cloneGrade, lerpGrade, type Grade } from './grades';

export const MAX_DAMAGE_MARKS = 6;
const MAX_FLASHES = 4;

interface Pulse {
  amount: number;
  left: number;
  total: number;
}

const newPulse = (): Pulse => ({ amount: 0, left: 0, total: 1 });

function pulseValue(p: Pulse): number {
  if (p.left <= 0) return 0;
  const t = p.left / p.total;
  return p.amount * t * t;
}

/**
 * The gameplay-facing side of the post stack. Pure state on real time, so effects keep decaying
 * through hit-stop and slow-mo and a pause cannot strand a red screen.
 */
export class PostState implements PostFx {
  readonly grade = cloneGrade(GRADES.default);
  private readonly from = cloneGrade(GRADES.default);
  private to: Grade = GRADES.default;
  private blend = 1;
  private blendRate = 1;

  private readonly chroma = newPulse();
  private readonly radial = newPulse();
  private readonly flashes = Array.from({ length: MAX_FLASHES }, () => ({ color: new THREE.Color(), intensity: 0, left: 0, total: 1 }));
  private flashCursor = 0;

  speed = 0;
  lowHealth = 0;
  suppression = 0;
  /** x: angle, y: current intensity. Oldest is replaced first. */
  readonly damage = Array.from({ length: MAX_DAMAGE_MARKS }, () => new THREE.Vector2(0, 0));
  private damageCursor = 0;

  readonly flashColor = new THREE.Color(0, 0, 0);
  chromaNow = 0;
  radialNow = 0;

  setGrade(name: GradeName, blendSeconds = 0.35): void {
    const target = GRADES[name] ?? GRADES.default;
    if (target === this.to) return;
    Object.assign(this.from, cloneGrade(this.grade));
    this.to = target;
    if (blendSeconds <= 0) {
      this.blend = 1;
      lerpGrade(this.grade, this.from, this.to, 1);
      return;
    }
    this.blend = 0;
    this.blendRate = 1 / blendSeconds;
  }

  flash(color: THREE.ColorRepresentation, intensity: number, seconds: number): void {
    const f = this.flashes[this.flashCursor]!;
    this.flashCursor = (this.flashCursor + 1) % MAX_FLASHES;
    f.color.set(color);
    f.intensity = intensity;
    f.left = f.total = Math.max(seconds, 1e-3);
  }

  chromatic(amount: number, seconds: number): void {
    if (amount < pulseValue(this.chroma)) return;
    this.chroma.amount = amount;
    this.chroma.left = this.chroma.total = Math.max(seconds, 1e-3);
  }

  radialBlur(amount: number, seconds: number): void {
    if (amount < pulseValue(this.radial)) return;
    this.radial.amount = amount;
    this.radial.left = this.radial.total = Math.max(seconds, 1e-3);
  }

  setSpeed(amount: number): void {
    this.speed = Math.min(Math.max(amount, 0), 1);
  }

  setLowHealth(amount: number): void {
    this.lowHealth = Math.min(Math.max(amount, 0), 1);
  }

  setSuppression(amount: number): void {
    this.suppression = Math.min(Math.max(amount, 0), 1);
  }

  damageDirection(angle: number, intensity: number): void {
    const d = this.damage[this.damageCursor]!;
    this.damageCursor = (this.damageCursor + 1) % MAX_DAMAGE_MARKS;
    d.set(angle, Math.min(intensity, 1.5));
  }

  update(realDt: number): void {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + realDt * this.blendRate);
      // Smoothstep so a perk snaps in without a visible linear ramp.
      const t = this.blend * this.blend * (3 - 2 * this.blend);
      lerpGrade(this.grade, this.from, this.to, t);
    }
    this.chroma.left -= realDt;
    this.radial.left -= realDt;
    this.chromaNow = pulseValue(this.chroma);
    this.radialNow = pulseValue(this.radial);

    this.flashColor.setRGB(0, 0, 0);
    for (const f of this.flashes) {
      if (f.left <= 0) continue;
      f.left -= realDt;
      const t = Math.max(f.left, 0) / f.total;
      const k = f.intensity * t * t;
      this.flashColor.r += f.color.r * k;
      this.flashColor.g += f.color.g * k;
      this.flashColor.b += f.color.b * k;
    }
    const fade = Math.exp(-realDt * 3.2);
    for (const d of this.damage) d.y = d.y < 0.01 ? 0 : d.y * fade;
  }
}
