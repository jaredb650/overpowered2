/**
 * Speech bubbles over the men who talk (docs/proposals/squad-chatter.md, 6.1). Three pooled DOM boxes moved by transform: no
 * draw calls, and nothing is built while they talk. A man gets one only if the player can see him when he speaks, within 35 m;
 * the feed has every line either way. The fourth line takes the oldest bubble that is not an urgent one.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { HumanoidBone as B } from '../../characters/rig';
import { RULES } from '../../enemies/outpost/chatter/lines';
import { URGENT } from '../../enemies/outpost/chatter/rules';
import type { CommsLine } from '../../enemies/outpost/events';
import { div, span } from '../dom';

export const MAX_BUBBLES = 3;
export const BUBBLE_RANGE = 35;
/** Full size this close, shrinking to SMALLEST at BUBBLE_RANGE. */
const NEAR = 10;
const SMALLEST = 0.75;
const LIFT = 0.35;
/** The radio's own rule for how long a line takes to say. */
export const airtime = (text: string): number => 0.9 + 0.06 * text.length;

interface Bubble {
  el: HTMLElement;
  box: HTMLElement;
  text: HTMLElement;
  enemy: EnemyInstance | null;
  life: number;
  urgent: boolean;
  bornAt: number;
  /** Laid out this frame, in px: bottom centre, and the box's size. */
  x: number;
  y: number;
  w: number;
  h: number;
  shown: boolean;
  /** Co-op only: when the next sight ray is due, and what the last one said. */
  rayAt: number;
  seen: boolean;
}

const _v = new THREE.Vector3();
const _view = new THREE.Vector3();
const _dir = new THREE.Vector3();
/** The camera's world position: it rides inside the player's rig, so its own `position` is local. */
const _eye = new THREE.Vector3();

export class Bubbles {
  readonly el: HTMLElement;
  readonly pool: Bubble[] = [];
  private clock = 0;

  constructor(private readonly ctx: Ctx) {
    this.el = div('bb-layer');
    for (let i = 0; i < MAX_BUBBLES; i++) {
      const text = span('bb-t');
      const box = div('bb-box', text);
      const el = div('bb', box);
      el.style.visibility = 'hidden';
      this.el.append(el);
      this.pool.push({ el, box, text, enemy: null, life: 0, urgent: false, bornAt: 0, x: 0, y: 0, w: 0, h: 0, shown: false, rayAt: 0, seen: false });
    }
  }

  get live(): number {
    let n = 0;
    for (const b of this.pool) if (b.enemy) n++;
    return n;
  }

  /** A line said aloud. Returns false when it stays feed-only: nobody to hang it on, out of sight, too far, or no room. */
  say(line: CommsLine, color: string): boolean {
    const enemy = line.enemy;
    if (!enemy || !enemy.alive) return false;
    const camera = this.ctx.render.camera;
    if (!(camera instanceof THREE.Camera)) return false;
    // Sight is checked now and again every frame, so a man out of view when he speaks never gets one.
    const probe = this.pool.find(b => b.enemy === enemy) ?? null;
    if (!this.visible(enemy, camera, probe, true)) return false;
    const urgent = URGENT.has(line.kind);
    let b = probe ?? this.pool.find(x => !x.enemy) ?? null;
    if (!b) {
      for (const x of this.pool) if (!x.urgent && (!b || x.bornAt < b.bornAt)) b = x;
    }
    if (!b) for (const x of this.pool) if (!b || x.bornAt < b.bornAt) b = x;
    const bubble = b!;
    const row = line.row !== undefined && line.row >= 0 ? RULES[line.row] : undefined;
    bubble.enemy = enemy;
    bubble.urgent = urgent;
    bubble.life = airtime(line.text);
    bubble.bornAt = this.clock;
    bubble.rayAt = 0;
    bubble.text.textContent = line.text;
    bubble.el.classList.toggle('scream', row?.channel === 'scream');
    bubble.el.style.setProperty('--c', color);
    bubble.el.style.visibility = '';
    // One layout read per line said, never per frame.
    bubble.w = bubble.box.offsetWidth;
    bubble.h = bubble.box.offsetHeight;
    bubble.box.animate?.([{ transform: 'scale(1.18)', easing: 'cubic-bezier(.1,.9,.2,1)' }, { transform: 'none' }], 140);
    bubble.shown = true;
    this.update(0);
    return true;
  }

  /** In front, on screen, within range, and in sight. Sets `_v` to the head point in view space. */
  private visible(enemy: EnemyInstance, camera: THREE.Camera, b: Bubble | null, now: boolean): boolean {
    (enemy.char.bones[B.head] ?? enemy.char.root).getWorldPosition(_v);
    _v.y += LIFT;
    const dist = _v.distanceTo(_eye.setFromMatrixPosition(camera.matrixWorld));
    if (dist > BUBBLE_RANGE) return false;
    _view.copy(_v).applyMatrix4(camera.matrixWorldInverse);
    if (_view.z > -0.2) return false;
    _v.copy(_view).applyMatrix4(camera.projectionMatrix);
    if (Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) return false;
    return this.inSight(enemy, camera, b, now);
  }

  /**
   * Solo, the director's own sight line to his chest, worked out every frame already. In co-op that line is to whichever player he
   * is after, so the bubble asks the world itself, ten times a second at most.
   */
  private inSight(enemy: EnemyInstance, camera: THREE.Camera, b: Bubble | null, now: boolean): boolean {
    if (!this.ctx.coop?.world) return (enemy as unknown as { hasLos?: boolean }).hasLos === true;
    if (!now && b && this.clock < b.rayAt) return b.seen;
    _dir.copy(enemy.center).sub(_eye);
    const range = _dir.length();
    const seen = range < 0.5 || !this.ctx.physics.raycast(_eye, _dir.divideScalar(range), Math.max(0, range - 0.5), CG.World);
    if (b) {
      b.rayAt = this.clock + 0.1;
      b.seen = seen;
    }
    return seen;
  }

  update(dt: number): void {
    this.clock += dt;
    const camera = this.ctx.render.camera;
    if (!(camera instanceof THREE.Camera)) return;
    const w = innerWidth / 2;
    const h = innerHeight / 2;
    for (const b of this.pool) {
      if (!b.enemy) continue;
      b.life -= dt;
      if (b.life <= 0 || !b.enemy.alive) {
        this.drop(b);
        continue;
      }
      const shown = this.visible(b.enemy, camera, b, false);
      if (shown !== b.shown) {
        b.shown = shown;
        b.el.style.visibility = shown ? '' : 'hidden';
      }
      if (!shown) continue;
      b.x = _v.x * w + w;
      b.y = -_v.y * h + h;
    }
    // Lowest on screen first; each one above it that would overlap steps up by 1.1 boxes.
    const placed = this.pool.filter(b => b.enemy && b.shown).sort((a, c) => c.y - a.y);
    for (let i = 0; i < placed.length; i++) {
      const b = placed[i]!;
      for (let j = 0; j < i; j++) {
        const a = placed[j]!;
        if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) b.y = a.y - 1.1 * Math.max(a.h, b.h);
      }
      const dist = (b.enemy!.char.bones[B.head] ?? b.enemy!.char.root).getWorldPosition(_v).distanceTo(_eye.setFromMatrixPosition(camera.matrixWorld));
      const scale = 1 - (1 - SMALLEST) * THREE.MathUtils.clamp((dist - NEAR) / (BUBBLE_RANGE - NEAR), 0, 1);
      b.el.style.transform = `translate3d(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px,0) scale(${scale.toFixed(3)})`;
    }
  }

  private drop(b: Bubble): void {
    b.enemy = null;
    b.shown = false;
    b.el.style.visibility = 'hidden';
  }

  reset(): void {
    for (const b of this.pool) this.drop(b);
  }
}
