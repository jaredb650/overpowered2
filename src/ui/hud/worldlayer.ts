/** Things anchored to world positions: floating score text, and caches or powerups with an off-screen arrow. */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import { Num, div, span } from '../dom';

const MAX_FLOATS = 24;
const FLOAT_LIFE = 1.05;
const MAX_MARKERS = 24;
/**
 * Markers pin to a ring around the crosshair, as a fraction of the half-screen. Inside it they sit on their world
 * position. The ring keeps them near where you are looking and clear of the HUD columns, and because the pin is a
 * clamp rather than a mode switch, nothing jumps as a marker slides off the ring.
 */
const RING_X = 0.5;
const RING_Y = 0.56;

const _v = new THREE.Vector3();
const _view = new THREE.Vector3();

interface FloatText {
  el: HTMLElement;
  text: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  live: boolean;
  drift: number;
}

export interface MapMarker {
  pos: THREE.Vector3;
  color: string;
  live: boolean;
}

interface Marker extends MapMarker {
  el: HTMLElement;
  arrow: HTMLElement;
  label: HTMLElement;
  dist: Num;
  clock: number;
  offscreen: boolean | null;
}

export class WorldLayer {
  readonly el: HTMLElement;
  readonly markers: Marker[] = [];
  private floats: FloatText[] = [];
  private nextFloat = 0;
  private width = 1;
  private height = 1;
  private rem = 16;

  constructor(private readonly ctx: Ctx) {
    this.el = div('wl');
    for (let i = 0; i < MAX_FLOATS; i++) {
      const text = span('ft-t');
      const el = div('ft', text);
      el.style.display = 'none';
      this.el.append(el);
      this.floats.push({ el, text, pos: new THREE.Vector3(), age: 0, live: false, drift: 0 });
    }
    for (let i = 0; i < MAX_MARKERS; i++) {
      const arrow = div('mk-arrow');
      const label = span('mk-label');
      const dist = span('mk-dist');
      const el = div('mk', div('mk-pin'), arrow, div('mk-text', label, dist));
      el.style.display = 'none';
      this.el.append(el);
      this.markers.push({ el, arrow, label, dist: new Num(dist), pos: new THREE.Vector3(), color: '', live: false, clock: 0, offscreen: null });
    }
    this.measure();
  }

  measure(): void {
    this.width = innerWidth;
    this.height = innerHeight;
    this.rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  float(position: THREE.Vector3, text: string, color?: string): void {
    const f = this.floats[this.nextFloat]!;
    this.nextFloat = (this.nextFloat + 1) % MAX_FLOATS;
    f.pos.copy(position);
    f.age = 0;
    f.live = true;
    f.drift = (Math.random() - 0.5) * 2.4;
    f.text.textContent = text;
    f.el.style.setProperty('--c', color ?? 'var(--ink)');
    f.el.style.display = '';
  }

  marker(position: THREE.Vector3, label: string, color?: string): () => void {
    const m = this.markers.find(x => !x.live) ?? this.markers[0]!;
    m.pos.copy(position);
    m.color = color ?? '#39e0ff';
    m.live = true;
    m.offscreen = null;
    m.clock = 0;
    m.label.textContent = label;
    m.el.style.setProperty('--c', m.color);
    m.el.style.display = '';
    return () => {
      m.live = false;
      m.el.style.display = 'none';
    };
  }

  update(dt: number): void {
    const camera = this.ctx.render.camera;
    if (!(camera instanceof THREE.Camera)) return;
    const w = this.width / 2;
    const h = this.height / 2;

    for (const f of this.floats) {
      if (!f.live) continue;
      f.age += dt;
      if (f.age >= FLOAT_LIFE) {
        f.live = false;
        f.el.style.display = 'none';
        continue;
      }
      _v.copy(f.pos).applyMatrix4(camera.matrixWorldInverse);
      if (_v.z > -0.2) {
        f.el.style.opacity = '0';
        continue;
      }
      const depth = clamp(14 / -_v.z, 0.62, 1.25);
      _v.applyMatrix4(camera.projectionMatrix);
      const u = f.age / FLOAT_LIFE;
      // Peak on the first frame, settle, then shrink out; no fade-in anywhere.
      const pop = u < 0.09 ? 1.7 - (u / 0.09) * 0.7 : u > 0.72 ? 1 - ((u - 0.72) / 0.28) * 0.55 : 1;
      const x = _v.x * w + w + f.drift * this.rem * u * 2;
      const y = -_v.y * h + h - this.rem * 4.5 * Math.sqrt(u);
      f.el.style.opacity = '1';
      f.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${(pop * depth).toFixed(3)})`;
    }

    const eye = this.ctx.player.eye;
    for (const m of this.markers) {
      if (!m.live) continue;
      _view.copy(m.pos).applyMatrix4(camera.matrixWorldInverse);
      _v.copy(_view).applyMatrix4(camera.projectionMatrix);
      const behind = _view.z > -0.1;
      const rx = RING_X * w;
      const ry = RING_Y * h;
      let x = _v.x * w;
      let y = -_v.y * h;
      const reach = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      const off = behind || reach > 1;
      if (off) {
        // Directions behind the camera project mirrored, so pin by view-space bearing there.
        const dx = behind ? _view.x : x;
        const dy = behind ? -_view.y : y;
        const k = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) || 1);
        x = dx * k;
        y = dy * k;
        m.arrow.style.transform = `rotate(${Math.atan2(x, -y).toFixed(3)}rad)`;
      }
      if (off !== m.offscreen) {
        m.offscreen = off;
        m.el.classList.toggle('off', off);
      }
      m.el.style.transform = `translate3d(${(x + w).toFixed(1)}px,${(y + h).toFixed(1)}px,0)`;
      m.clock -= dt;
      if (m.clock <= 0 && eye) {
        m.clock = 0.2;
        m.dist.set(Math.round(eye.distanceTo(m.pos)));
      }
    }
  }

  reset(): void {
    for (const f of this.floats) {
      f.live = false;
      f.el.style.display = 'none';
    }
    for (const m of this.markers) {
      m.live = false;
      m.el.style.display = 'none';
    }
  }
}
