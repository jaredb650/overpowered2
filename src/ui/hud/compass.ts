/**
 * Minimal top-of-screen tactical compass strip.
 *
 * Replaces always-on 3D screen waypoints with a slim horizontal bearing tape so big maps with many objectives,
 * turrets, vehicles and caches never clutter the player's view. Pressing the objective-markers key (default R Shift)
 * reveals the full 3D markers temporarily while the compass stays up at all times, on foot and in vehicles.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp, wrapAngle } from '../../core/math';
import { Flag, Label, Meter, Shown, div, h, span } from '../dom';
import type { MapMarker, WorldLayer } from './worldlayer';

/** Half of the horizontal angle spanned across the compass tape (radians): ±90° = 180° visible arc. */
export const COMPASS_HALF_FOV = Math.PI * 0.5;
/** Angular window around center within which the closest waypoint shows its single-line micro-label. */
export const COMPASS_FOCUS_RAD = (11 * Math.PI) / 180;
/** Vertical delta (m) above which a waypoint pip gains a tiny up/down elevation tick. */
const ELEVATION_THRESHOLD = 12;
/** Edge clamp fraction on the tape (leaves room for edge chevrons). */
const EDGE_CLAMP = 0.955;

const CARDINALS: readonly [deg: number, label: string, major: boolean][] = [
  [0, 'N', true],
  [45, 'NE', false],
  [90, 'E', true],
  [135, 'SE', false],
  [180, 'S', true],
  [225, 'SW', false],
  [270, 'W', true],
  [315, 'NW', false],
];

const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _origin = new THREE.Vector3();

/** Clockwise azimuth in radians where 0 = North (-Z), +π/2 = East (+X), π = South (+Z), -π/2 = West (-X). */
export function bearingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/** Signed shortest angular offset from `heading` to `targetBearing`, in (-π, π]. Positive = right of center. */
export function relativeBearing(targetBearing: number, heading: number): number {
  return wrapAngle(targetBearing - heading);
}

/** Normalized integer degrees 0..359 from a bearing in radians. */
export function headingDegrees(heading: number): number {
  const deg = Math.round((heading * 180) / Math.PI);
  return ((deg % 360) + 360) % 360;
}

/** Cardinal / intercardinal name for an exact 45° multiple, or empty string otherwise. */
export function cardinalLabel(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  for (const [d, lbl] of CARDINALS) if (d === norm) return lbl;
  return '';
}

export interface FocusedMarker {
  marker: MapMarker;
  absAngle: number;
  distance: number;
}

/** Picks the live compass-managed waypoint closest to the center bearing within `focusRad`, if any. */
export function selectFocusedMarker(
  markers: readonly MapMarker[],
  ox: number,
  oy: number,
  oz: number,
  heading: number,
  focusRad = COMPASS_FOCUS_RAD,
): FocusedMarker | null {
  let best: MapMarker | null = null;
  let bestAngle = focusRad;
  let bestDist = Infinity;
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i]!;
    if (!m.live || m.alwaysWorld) continue;
    const dx = m.pos.x - ox;
    const dy = m.pos.y - oy;
    const dz = m.pos.z - oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) continue;
    const absA = Math.abs(relativeBearing(bearingOf(dx, dz), heading));
    if (absA > focusRad) continue;
    if (absA < bestAngle - 0.015 || (Math.abs(absA - bestAngle) <= 0.015 && dist < bestDist)) {
      best = m;
      bestAngle = absA;
      bestDist = dist;
    }
  }
  return best ? { marker: best, absAngle: bestAngle, distance: bestDist } : null;
}

export class Compass {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly hdgText: Label;
  private readonly focusEl: HTMLElement;
  private readonly focusShown: Shown;
  private readonly focusDot: HTMLElement;
  private readonly focusLabel: Label;
  private readonly hintEl: HTMLElement;
  private readonly hintShown: Shown;
  private readonly hintLabel: Label;
  private readonly revealFlag: Flag;
  private readonly timerShown: Shown;
  private readonly timerBar: Meter;
  private width = 480;
  private height = 34;
  private dpr = 1;
  private majorFont = '800 12px ui-monospace, Menlo, monospace';
  private minorFont = '700 10px ui-monospace, Menlo, monospace';
  private lastFocusColor = '';

  constructor(private readonly ctx: Ctx, private readonly world: WorldLayer) {
    this.canvas = h('canvas', 'cp-canvas');
    this.g = this.canvas.getContext('2d', { alpha: true })!;
    const hdgEl = span('cp-hdg', '000');
    this.hdgText = new Label(hdgEl);

    const timerFill = div('cp-tfill');
    const timerEl = div('cp-timer', timerFill);
    this.timerShown = new Shown(timerEl, 'block');
    this.timerBar = new Meter(timerFill);

    this.focusDot = span('cp-dot');
    const focusTxt = span('cp-ftxt');
    this.focusEl = div('cp-focus', this.focusDot, focusTxt);
    this.focusShown = new Shown(this.focusEl, 'inline-flex');
    this.focusLabel = new Label(focusTxt);

    this.hintEl = span('cp-hint');
    this.hintShown = new Shown(this.hintEl, 'inline-block');
    this.hintLabel = new Label(this.hintEl);

    this.el = div('compass',
      div('cp-bar', this.canvas, div('cp-caret')),
      timerEl,
      div('cp-sub', hdgEl, this.focusEl, this.hintEl),
    );
    this.revealFlag = new Flag(this.el, 'revealing');
    this.timerShown.set(false);
    this.focusShown.set(false);
    this.hintShown.set(false);
    this.measure();
  }

  measure(): void {
    const cssW = this.canvas.clientWidth || 480;
    const cssH = this.canvas.clientHeight || 38;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = Math.max(120, Math.round(cssW * this.dpr));
    this.height = Math.max(24, Math.round(cssH * this.dpr));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const majorPx = Math.max(9, Math.round(Math.min(11 * this.dpr, this.height * 0.34)));
    const minorPx = Math.max(8, Math.round(Math.min(9 * this.dpr, this.height * 0.27)));
    this.majorFont = `800 ${majorPx}px ui-monospace, Menlo, monospace`;
    this.minorFont = `700 ${minorPx}px ui-monospace, Menlo, monospace`;
  }

  update(): void {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (
      (cw > 0 && Math.abs(this.width - Math.round(cw * this.dpr)) > 2) ||
      (ch > 0 && Math.abs(this.height - Math.round(ch * this.dpr)) > 2)
    ) {
      this.measure();
    }
    const camera = this.ctx.render.camera;
    let heading = 0;
    let ox = 0;
    let oy = 0;
    let oz = 0;

    if (camera instanceof THREE.Camera) {
      camera.getWorldPosition(_origin);
      camera.getWorldDirection(_dir);
      ox = _origin.x;
      oy = _origin.y;
      oz = _origin.z;
      let fx = _dir.x;
      let fz = _dir.z;
      if (fx * fx + fz * fz < 0.0025) {
        // Looking nearly straight up/down (e.g. AC-130 nadir): fall back to camera up projected on XZ.
        _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
        fx = _up.x;
        fz = _up.z;
      }
      heading = bearingOf(fx, fz);
    } else {
      const pos = this.ctx.player.position;
      const fwd = this.ctx.player.forward;
      if (typeof pos?.x === 'number') { ox = pos.x; oy = pos.y; oz = pos.z; }
      if (typeof fwd?.x === 'number') heading = bearingOf(fwd.x, fwd.z);
    }

    const deg = headingDegrees(heading);
    this.hdgText.set(String(deg).padStart(3, '0'));

    this.draw(heading, ox, oy, oz);

    const wpCount = this.world.waypointCount;
    const revealActive = this.world.reveal.active && wpCount > 0;
    this.revealFlag.set(revealActive);
    this.timerShown.set(revealActive);
    if (revealActive) this.timerBar.set(this.world.reveal.fraction);

    const focused = wpCount > 0 ? selectFocusedMarker(this.world.markers, ox, oy, oz, heading) : null;
    if (focused) {
      this.focusShown.set(true);
      this.hintShown.set(false);
      const name = focused.marker.labelText.trim() || 'OBJECTIVE';
      this.focusLabel.set(`${name} · ${Math.round(focused.distance)}m`);
      if (focused.marker.color !== this.lastFocusColor) {
        this.lastFocusColor = focused.marker.color;
        this.focusDot.style.background = focused.marker.color;
      }
    } else {
      this.focusShown.set(false);
      if (wpCount > 0) {
        this.hintShown.set(true);
        const raw = this.ctx.input?.labelFor?.('showMarkers');
        const key = raw && raw !== 'showMarkers' ? raw : 'R Shift';
        this.hintLabel.set(revealActive ? `[${key}] HIDE MARKERS` : `[${key}] MARKERS (${wpCount})`);
      } else {
        this.hintShown.set(false);
      }
    }
  }

  private draw(heading: number, ox: number, oy: number, oz: number): void {
    const { g, width, height, dpr } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, width, height);

    const half = width * 0.5;
    const pxPerRad = half / COMPASS_HALF_FOV;
    const degCenter = (heading * 180) / Math.PI;
    const startTick = Math.floor((degCenter - 95) / 15) * 15;
    const endTick = Math.ceil((degCenter + 95) / 15) * 15;

    // 1. Degree ticks along bottom and cardinal/intercardinal labels in upper lane.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const baseY = height - 1 * dpr;
    const labelY = height * 0.27;

    for (let d = startTick; d <= endTick; d += 15) {
      const rad = (d * Math.PI) / 180;
      const rel = relativeBearing(rad, heading);
      const x = half + rel * pxPerRad;
      if (x < -12 * dpr || x > width + 12 * dpr) continue;
      const norm = ((d % 360) + 360) % 360;
      const isMajor = norm % 90 === 0;
      const isInter = norm % 45 === 0;
      const tickH = (isMajor ? 5 : isInter ? 3.8 : 2.4) * dpr;

      g.fillStyle = isMajor ? 'rgba(238, 244, 247, 0.72)' : 'rgba(157, 176, 189, 0.34)';
      g.fillRect(Math.round(x) - 0.5 * dpr, baseY - tickH, 1 * dpr, tickH);

      if (isInter) {
        const lbl = cardinalLabel(norm);
        g.font = isMajor ? this.majorFont : this.minorFont;
        g.fillStyle = norm === 0 ? '#39e0ff' : isMajor ? 'rgba(238, 244, 247, 0.92)' : 'rgba(157, 176, 189, 0.65)';
        g.fillText(lbl, x, labelY);
      }
    }

    // 2. Minimal waypoint pips from WorldLayer in the dedicated lower-middle lane.
    const markers = this.world.markers;
    const pipY = height * 0.7;
    const pipR = Math.min(4.4 * dpr, height * 0.16);
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i]!;
      if (!m.live || m.alwaysWorld) continue;
      const dx = m.pos.x - ox;
      const dy = m.pos.y - oy;
      const dz = m.pos.z - oz;
      const rel = relativeBearing(bearingOf(dx, dz), heading);
      const frac = rel / COMPASS_HALF_FOV;
      const off = Math.abs(frac) > EDGE_CLAMP;
      const clamped = clamp(frac, -EDGE_CLAMP, EDGE_CLAMP);
      const x = half + clamped * half;

      // Pulse ring when a new waypoint just appeared.
      if (m.pulse > 0) {
        const p = 1 - clamp(m.pulse / 1.5, 0, 1);
        const pr = (pipR + p * 8 * dpr);
        g.save();
        g.strokeStyle = m.color;
        g.globalAlpha = (1 - p) * 0.85;
        g.lineWidth = 1.4 * dpr;
        g.beginPath();
        g.arc(x, pipY, pr, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }

      if (off) {
        // Outward-pointing chevron clamped to the tape edge.
        const dir = frac > 0 ? 1 : -1;
        const r = pipR * 0.92;
        g.save();
        g.globalAlpha = 0.86;
        g.fillStyle = m.color;
        g.strokeStyle = '#000000';
        g.lineWidth = 1.2 * dpr;
        g.beginPath();
        g.moveTo(x + dir * r, pipY);
        g.lineTo(x - dir * r * 0.7, pipY - r * 0.85);
        g.lineTo(x - dir * r * 0.7, pipY + r * 0.85);
        g.closePath();
        g.stroke();
        g.fill();
        g.restore();
      } else {
        // Crisp diamond pip on the bearing tape.
        const r = pipR;
        g.fillStyle = m.color;
        g.strokeStyle = '#000000';
        g.lineWidth = 1.3 * dpr;
        g.beginPath();
        g.moveTo(x, pipY - r);
        g.lineTo(x + r, pipY);
        g.lineTo(x, pipY + r);
        g.lineTo(x - r, pipY);
        g.closePath();
        g.stroke();
        g.fill();

        // Subtle elevation caret for targets well above or below.
        if (Math.abs(dy) > ELEVATION_THRESHOLD) {
          const up = dy > 0 ? -1 : 1;
          const ey = pipY + up * (r + 2.4 * dpr);
          g.beginPath();
          g.moveTo(x, ey + up * 2.0 * dpr);
          g.lineTo(x + 2.2 * dpr, ey);
          g.lineTo(x - 2.2 * dpr, ey);
          g.closePath();
          g.fill();
        }
      }
    }
  }

  reset(): void {
    this.lastFocusColor = '';
    this.revealFlag.set(false);
    this.timerShown.set(false);
    this.focusShown.set(false);
    this.hintShown.set(false);
  }
}
