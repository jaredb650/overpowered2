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

/** A name tag's line of text, in rem: how far the next tag's line is set under it. */
export const TAG_ROW = 1.45;
/** Half the width of a tag's text, in rem, from its characters: the plate's padding, the distance and its unit included. */
export const tagHalfWidth = (chars: number): number => (chars + 5) * 0.31 + 0.5;

/**
 * Co-op: which line each friend's name tag is printed on, so that two friends in the same direction (one behind the other,
 * or both pinned to the same point of the ring) read as two lines and not one tag printed over the other. `x`, `y`: where
 * each tag is on screen; `half`: half its width; `row`: filled in, 0 for a tag where it would be anyway. In the order
 * given (the caller's: lowest on the screen first, so no pin sits on another tag's text), each tag takes the first line under
 * any earlier tag it would touch. Nothing is made.
 */
export function stackTags(n: number, x: ArrayLike<number>, y: ArrayLike<number>, half: ArrayLike<number>, rowHeight: number, row: { [i: number]: number }): void {
  for (let i = 0; i < n; i++) {
    row[i] = 0;
    for (let j = 0; j < i; j++) {
      if (Math.abs(x[i]! - x[j]!) >= half[i]! + half[j]!) continue;
      const other = y[j]! + row[j]! * rowHeight;
      if (Math.abs(y[i]! + row[i]! * rowHeight - other) >= rowHeight) continue;
      // The first line that is a whole line under the other tag's. Always further down than it was, so this ends.
      const next = Math.ceil((other - y[i]!) / rowHeight - 1e-9) + 1;
      if (next <= row[i]!) continue;
      row[i] = next;
      // Its new line may sit on a tag it had cleared: look at them all again.
      j = -1;
    }
  }
}

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
  /** Set on a marker riding something that moves. The minimap already draws those. */
  target: THREE.Vector3 | null;
}

interface Marker extends MapMarker {
  el: HTMLElement;
  arrow: HTMLElement;
  label: HTMLElement;
  dist: Num;
  clock: number;
  offscreen: boolean | null;
  /** Bumped on each reuse, so a remover held for an old marker cannot take down its replacement. */
  use: number;
  /** A co-op friend's name tag (`stackTags`), the characters in it, and the line its text is on now. */
  tag: boolean;
  chars: number;
  row: number;
}

/** Most name tags stacked at once: three friends. */
const MAX_TAGS = 4;

export class WorldLayer {
  readonly el: HTMLElement;
  readonly markers: Marker[] = [];
  private floats: FloatText[] = [];
  private nextFloat = 0;
  private width = 1;
  private height = 1;
  private rem = 16;
  private readonly tags: Marker[] = [];
  private readonly tagX = new Float32Array(MAX_TAGS);
  private readonly tagY = new Float32Array(MAX_TAGS);
  private readonly tagHalf = new Float32Array(MAX_TAGS);
  private readonly tagRow = new Int8Array(MAX_TAGS);

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
      this.markers.push({
        el, arrow, label, dist: new Num(dist), pos: new THREE.Vector3(), color: '', live: false, target: null, clock: 0, offscreen: null, use: 0, tag: false, chars: 0, row: 0,
      });
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
    return this.place(position, null, label, color);
  }

  /** A marker that tracks `target`, which must stay valid until the returned remover is called. */
  follow(target: THREE.Vector3, label: string, color?: string, tag = false): () => void {
    return this.place(target, target, label, color, tag);
  }

  private place(position: THREE.Vector3, target: THREE.Vector3 | null, label: string, color?: string, tag = false): () => void {
    const m = this.markers.find(x => !x.live) ?? this.markers[0]!;
    const use = ++m.use;
    m.pos.copy(position);
    m.target = target;
    m.color = color ?? '#39e0ff';
    m.live = true;
    m.offscreen = null;
    m.clock = 0;
    m.tag = tag;
    m.chars = label.length;
    if (m.row !== 0) { m.row = 0; m.el.style.removeProperty('--row'); }
    m.label.textContent = label;
    m.el.style.setProperty('--c', m.color);
    m.el.style.display = '';
    return () => {
      if (m.use !== use) return;
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
    let tags = 0;
    for (const m of this.markers) {
      if (!m.live) continue;
      if (m.target) m.pos.copy(m.target);
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
      if (m.tag && tags < MAX_TAGS) {
        this.tags[tags] = m;
        this.tagX[tags] = x; this.tagY[tags] = y; this.tagHalf[tags] = tagHalfWidth(m.chars) * this.rem;
        tags++;
      }
      m.clock -= dt;
      if (m.clock <= 0 && eye) {
        m.clock = 0.2;
        m.dist.set(Math.round(eye.distanceTo(m.pos)));
      }
    }
    // Co-op: friends' name tags that would be printed over each other go on lines of their own. Alone there are none.
    if (tags > 0) {
      // Lowest on the screen first: it keeps its line, right under its own pin, and a tag whose pin is higher has its
      // text set under that. The other way round the lower pin sat on the upper tag's text. A tag that has its own line
      // keeps it while the two are level (half a rem), so two friends side by side do not swap lines every frame.
      const { tagX, tagY, tagHalf } = this;
      for (let i = 1; i < tags; i++) {
        for (let j = i; j > 0 && this.tagKey(j) > this.tagKey(j - 1); j--) {
          const m = this.tags[j]!; this.tags[j] = this.tags[j - 1]!; this.tags[j - 1] = m;
          let t = tagX[j]!; tagX[j] = tagX[j - 1]!; tagX[j - 1] = t;
          t = tagY[j]!; tagY[j] = tagY[j - 1]!; tagY[j - 1] = t;
          t = tagHalf[j]!; tagHalf[j] = tagHalf[j - 1]!; tagHalf[j - 1] = t;
        }
      }
      stackTags(tags, this.tagX, this.tagY, this.tagHalf, TAG_ROW * this.rem, this.tagRow);
      for (let i = 0; i < tags; i++) {
        const m = this.tags[i]!;
        const row = this.tagRow[i]!;
        if (row === m.row) continue;
        m.row = row;
        if (row === 0) m.el.style.removeProperty('--row');
        else m.el.style.setProperty('--row', String(row));
      }
    }
  }

  /** How low on the screen tag `i` is, for the order they are stacked in. */
  private tagKey(i: number): number {
    return this.tagY[i]! + (this.tags[i]!.row === 0 ? this.rem * 0.5 : 0);
  }

  reset(): void {
    for (const f of this.floats) {
      f.live = false;
      f.el.style.display = 'none';
    }
    for (const m of this.markers) {
      m.live = false;
      m.tag = false;
      m.el.style.display = 'none';
    }
  }
}
