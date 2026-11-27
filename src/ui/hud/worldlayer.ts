/** Things anchored to world positions: floating score text, and caches or powerups with an off-screen arrow. */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import { Num, div, span } from '../dom';

const MAX_FLOATS = 24;
const FLOAT_LIFE = 1.05;
const MAX_MARKERS = 32;
/**
 * Markers pin to a ring around the crosshair, as a fraction of the half-screen. Inside it they sit on their world
 * position. The ring keeps them near where you are looking and clear of the HUD columns, and because the pin is a
 * clamp rather than a mode switch, nothing jumps as a marker slides off the ring.
 */
const RING_X = 0.5;
const RING_Y = 0.56;

/** Seconds a tap on the objective-markers key reveals 3D world waypoints before fading back to the compass. */
export const MARKER_REVEAL_SECONDS = 5.0;
/** Holding the key at least this long switches to hold-to-peek, fading out smoothly on release. */
export const MARKER_HOLD_THRESHOLD = 0.35;
/** Smooth fade-out tail in seconds when temporary markers hide again. */
export const MARKER_FADE_SECONDS = 0.75;
/** Seconds a newly placed waypoint pulses on the top compass. */
const COMPASS_PULSE_SECONDS = 1.5;

const _v = new THREE.Vector3();
const _view = new THREE.Vector3();

/** A name tag's line of text, in rem: how far the next tag's line is set under it. */
export const TAG_ROW = 1.45;
/** Half the width of a tag's text, in rem, from its characters: the plate's padding, the distance and its unit included. */
export const tagHalfWidth = (chars: number): number => (chars + 5) * 0.31 + 0.5;

/**
 * True when a `follow()` marker is a close-range interaction prompt (e.g. `[E] BOARD`, `HOLD [E] ...`, `E MAN GUN`),
 * which should stay visible in the 3D world rather than being tucked into the compass.
 */
export function isInteractivePrompt(label: string, target: THREE.Vector3 | null, interactKey = 'E'): boolean {
  if (!target) return false;
  const up = label.trim().toUpperCase();
  if (!up) return false;
  const k = (interactKey || 'E').trim().toUpperCase();
  if (k) {
    if (up.includes(`[${k}]`)) return true;
    if (up.startsWith(`${k} `)) return true;
    if (up.includes(`HOLD ${k}`) || up.includes(`TAP ${k}`) || up.includes(`PRESS ${k}`) || up.includes(`  ${k} `)) return true;
  }
  return up.startsWith('REVIVING') || up.startsWith('REPAIRING') || up.includes('NO STIMS TO REVIVE') || up.includes('KEEP HIM ALIVE');
}

/** True when a marker always renders in 3D space (teammate name tags, live co-op pings, or close-range interact prompts). */
export function isAlwaysVisibleMarker(label: string, target: THREE.Vector3 | null, tag: boolean, interactKey = 'E'): boolean {
  if (tag) return true;
  if (label === 'YOUR PING' || label.startsWith('PING · ')) return true;
  return isInteractivePrompt(label, target, interactKey);
}

/**
 * Pure controller for the temporary 3D objective-marker reveal button:
 * - Tap when hidden: reveals all world waypoints for `MARKER_REVEAL_SECONDS` (5 s), fading out over the last 0.75 s.
 * - Hold (>= 0.35 s): keeps waypoints fully visible while held, fading out smoothly on release.
 * - Tap again while already revealed from a prior tap: dismisses smoothly right away.
 */
export class MarkerReveal {
  private left = 0;
  private held = 0;
  private holding = false;

  /** Current 0..1 opacity for temporary 3D waypoint markers. */
  get opacity(): number {
    if (this.left <= 0) return 0;
    if (this.left >= MARKER_FADE_SECONDS) return 1;
    return this.left / MARKER_FADE_SECONDS;
  }

  /** Remaining fraction 0..1 of the reveal window, for the compass countdown bar. */
  get fraction(): number {
    return clamp(this.left / MARKER_REVEAL_SECONDS, 0, 1);
  }

  /** True while waypoints are currently visible or fading out. */
  get active(): boolean {
    return this.left > 0;
  }

  update(pressed: boolean, isDown: boolean, released: boolean, dt: number): void {
    if (pressed) {
      if (this.left > MARKER_FADE_SECONDS && !this.holding) {
        // Already revealed from an earlier tap: dismiss cleanly.
        this.left = MARKER_FADE_SECONDS * 0.5;
        this.holding = false;
        this.held = 0;
      } else {
        this.left = MARKER_REVEAL_SECONDS;
        this.holding = true;
        this.held = 0;
      }
    }
    if (this.holding) {
      if (isDown && !released) {
        this.held += dt;
        if (this.left < MARKER_FADE_SECONDS + 0.25) this.left = MARKER_FADE_SECONDS + 0.25;
        return;
      }
      if (this.held >= MARKER_HOLD_THRESHOLD) {
        this.left = Math.min(this.left, MARKER_FADE_SECONDS);
      }
      this.holding = false;
      this.held = 0;
    }
    if (this.left > 0) this.left = Math.max(0, this.left - dt);
  }

  reset(): void {
    this.left = 0;
    this.held = 0;
    this.holding = false;
  }
}

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
  opacity: number;
  qx: number;
  qy: number;
  qs: number;
}

export interface MapMarker {
  pos: THREE.Vector3;
  color: string;
  live: boolean;
  /** Set on a marker riding something that moves. The minimap already draws those. */
  target: THREE.Vector3 | null;
  /** Raw text label, read by the top compass without touching the DOM. */
  labelText: string;
  /** True for teammate name tags, co-op pings and close-range interact prompts that always stay in 3D space. */
  alwaysWorld: boolean;
  /** Seconds left on the new-waypoint pulse ring on the top compass. */
  pulse: number;
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
  shown: boolean;
  opacity: number;
  qx: number;
  qy: number;
  qa: number;
}

/** Most name tags stacked at once: three friends. */
const MAX_TAGS = 4;

export class WorldLayer {
  readonly el: HTMLElement;
  readonly markers: Marker[] = [];
  readonly reveal = new MarkerReveal();
  private floats: FloatText[] = [];
  private nextFloat = 0;
  private activeFloats = 0;
  private activeMarkers = 0;
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
      this.floats.push({ el, text, pos: new THREE.Vector3(), age: 0, live: false, drift: 0, opacity: -1, qx: NaN, qy: NaN, qs: NaN });
    }
    for (let i = 0; i < MAX_MARKERS; i++) {
      const arrow = div('mk-arrow');
      const label = span('mk-label');
      const dist = span('mk-dist');
      const el = div('mk', div('mk-pin'), arrow, div('mk-text', label, dist));
      el.style.display = 'none';
      this.el.append(el);
      this.markers.push({
        el, arrow, label, dist: new Num(dist), pos: new THREE.Vector3(), color: '', live: false, target: null,
        labelText: '', alwaysWorld: false, pulse: 0,
        clock: 0, offscreen: null, use: 0, tag: false, chars: 0, row: 0, shown: false, opacity: -1,
        qx: NaN, qy: NaN, qa: NaN,
      });
    }
    this.measure();
  }

  measure(): void {
    this.width = innerWidth;
    this.height = innerHeight;
    this.rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  /** Number of live compass-managed objective/waypoint markers (excludes interact prompts and friend tags). */
  get waypointCount(): number {
    if (this.activeMarkers === 0) return 0;
    let n = 0;
    for (const m of this.markers) if (m.live && !m.alwaysWorld) n++;
    return n;
  }

  /** Feeds the show-markers key state into the temporary reveal controller. */
  updateReveal(pressed: boolean, isDown: boolean, released: boolean, dt: number): void {
    const wasActive = this.reveal.active;
    this.reveal.update(pressed, isDown, released, dt);
    if (pressed && !wasActive && this.reveal.active && this.waypointCount > 0) {
      this.ctx.audio?.play?.('ui_click');
    }
  }

  float(position: THREE.Vector3, text: string, color?: string): void {
    const f = this.floats[this.nextFloat]!;
    this.nextFloat = (this.nextFloat + 1) % MAX_FLOATS;
    if (!f.live) this.activeFloats++;
    f.pos.copy(position);
    f.age = 0;
    f.live = true;
    f.drift = (Math.random() - 0.5) * 2.4;
    f.opacity = -1;
    f.qx = f.qy = f.qs = NaN;
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
    if (!m.live) this.activeMarkers++;
    const interactKey = this.ctx.input?.labelFor?.('interact') || 'E';
    const alwaysWorld = isAlwaysVisibleMarker(label, target, tag, interactKey);
    m.pos.copy(position);
    m.target = target;
    m.color = color ?? '#39e0ff';
    m.live = true;
    m.labelText = label;
    m.alwaysWorld = alwaysWorld;
    m.pulse = alwaysWorld ? 0 : COMPASS_PULSE_SECONDS;
    m.offscreen = null;
    m.clock = 0;
    m.tag = tag;
    m.chars = label.length;
    m.qx = m.qy = m.qa = NaN;
    if (m.row !== 0) { m.row = 0; m.el.style.removeProperty('--row'); }
    m.label.textContent = label;
    m.el.style.setProperty('--c', m.color);
    const visibleNow = alwaysWorld || this.reveal.opacity > 0;
    m.shown = visibleNow;
    m.opacity = visibleNow ? (alwaysWorld ? 1 : this.reveal.opacity) : 0;
    m.el.style.opacity = visibleNow ? m.opacity.toFixed(2) : '';
    m.el.style.display = visibleNow ? '' : 'none';
    return () => {
      if (m.use !== use) return;
      if (m.live) this.activeMarkers--;
      m.live = false;
      m.shown = false;
      m.pulse = 0;
      m.el.style.display = 'none';
    };
  }

  update(dt: number): void {
    if (this.activeFloats === 0 && this.activeMarkers === 0) return;
    const camera = this.ctx.render.camera;
    if (!(camera instanceof THREE.Camera)) return;
    const w = this.width / 2;
    const h = this.height / 2;

    if (this.activeFloats > 0) {
      for (const f of this.floats) {
        if (!f.live) continue;
        f.age += dt;
        if (f.age >= FLOAT_LIFE) {
          f.live = false;
          this.activeFloats--;
          f.el.style.display = 'none';
          continue;
        }
        _v.copy(f.pos).applyMatrix4(camera.matrixWorldInverse);
        if (_v.z > -0.2) {
          if (f.opacity !== 0) {
            f.opacity = 0;
            f.el.style.opacity = '0';
          }
          continue;
        }
        const depth = clamp(14 / -_v.z, 0.62, 1.25);
        _v.applyMatrix4(camera.projectionMatrix);
        const u = f.age / FLOAT_LIFE;
        // Peak on the first frame, settle, then shrink out; no fade-in anywhere.
        const pop = u < 0.09 ? 1.7 - (u / 0.09) * 0.7 : u > 0.72 ? 1 - ((u - 0.72) / 0.28) * 0.55 : 1;
        const x = _v.x * w + w + f.drift * this.rem * u * 2;
        const y = -_v.y * h + h - this.rem * 4.5 * Math.sqrt(u);
        if (f.opacity !== 1) {
          f.opacity = 1;
          f.el.style.opacity = '1';
        }
        const qx = Math.round(x * 10);
        const qy = Math.round(y * 10);
        const qs = Math.round(pop * depth * 1000);
        if (qx !== f.qx || qy !== f.qy || qs !== f.qs) {
          f.qx = qx;
          f.qy = qy;
          f.qs = qs;
          f.el.style.transform = `translate3d(${(qx / 10).toFixed(1)}px,${(qy / 10).toFixed(1)}px,0) scale(${(qs / 1000).toFixed(3)})`;
        }
      }
    }

    if (this.activeMarkers === 0) return;
    const eye = this.ctx.player.eye;
    const revealAlpha = this.reveal.opacity;
    const revealQ = Math.round(revealAlpha * 100);
    let tags = 0;
    for (const m of this.markers) {
      if (!m.live) continue;
      if (m.target) m.pos.copy(m.target);
      if (m.pulse > 0) m.pulse = Math.max(0, m.pulse - dt);
      const show = m.alwaysWorld || revealQ > 0;
      if (show !== m.shown) {
        m.shown = show;
        m.el.style.display = show ? '' : 'none';
      }
      if (!show) continue;
      const alphaQ = m.alwaysWorld ? 100 : revealQ;
      if (alphaQ !== m.opacity) {
        m.opacity = alphaQ;
        m.el.style.opacity = alphaQ === 100 ? '1' : (alphaQ / 100).toFixed(2);
      }
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
        const qa = Math.round(Math.atan2(x, -y) * 1000);
        if (qa !== m.qa) {
          m.qa = qa;
          m.arrow.style.transform = `rotate(${(qa / 1000).toFixed(3)}rad)`;
        }
      }
      if (off !== m.offscreen) {
        m.offscreen = off;
        m.el.classList.toggle('off', off);
      }
      const qx = Math.round((x + w) * 10);
      const qy = Math.round((y + h) * 10);
      if (qx !== m.qx || qy !== m.qy) {
        m.qx = qx;
        m.qy = qy;
        m.el.style.transform = `translate3d(${(qx / 10).toFixed(1)}px,${(qy / 10).toFixed(1)}px,0)`;
      }
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
    this.reveal.reset();
    this.activeFloats = 0;
    this.activeMarkers = 0;
    for (const f of this.floats) {
      f.live = false;
      f.opacity = -1;
      f.qx = f.qy = f.qs = NaN;
      f.el.style.display = 'none';
    }
    for (const m of this.markers) {
      m.live = false;
      m.tag = false;
      m.alwaysWorld = false;
      m.labelText = '';
      m.pulse = 0;
      m.shown = false;
      m.opacity = -1;
      m.qx = m.qy = m.qa = NaN;
      m.el.style.display = 'none';
    }
  }
}
