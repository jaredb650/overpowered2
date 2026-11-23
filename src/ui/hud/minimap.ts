/**
 * Minimap: player-up, centred on the player, range widening with speed so you see further when you cover it faster.
 *
 * The first game's 80% alpha clear left accidental radar trails behind every dot. They read as motion, so they are
 * kept on purpose here, as real short position histories rather than a smeared buffer, which would smear the
 * whole map once it rotates.
 */
import { ALLY_DOWN_COLOR, ALLY_TEXT } from '../../allies/data';
import { SHOPS, SHOP_ORDER } from '../../contracts/defense/data';
import type { Ctx } from '../../core/contracts';
import { clamp, damp } from '../../core/math';
import { MOVE } from '../../player/tuning';
import { div, h } from '../dom';
import type { HudState } from '../state';
import { REVEAL_AT, REVEALS } from './stragglers';
import type { WorldLayer } from './worldlayer';

const REDRAW = 1 / 30;
const TRAIL_SAMPLE = 0.09;
const TRAIL_LEN = 3;
const MAX_TRACKED = 48;
const NEAR_RANGE = 62;
const FAR_RANGE = 120;
/** Speed at which the map has opened all the way, about the strafing ceiling. */
const FAR_SPEED = 27;
/** Seconds per sweep of the ring around a revealed straggler. */
const PING_PERIOD = 1.1;

const ENEMY = '#ff3b3b';
const ELITE = '#ff9a2e';
/** A man carrying a charge (Outpost Defense): a round bomb with a lit fuse, held on the rim when off the map. */
const CARRIER = '#ff1e10';
const FUSE = '#ffd54a';
const NORTH = '#eef4f7';
/** Friendlies: the cyan of their helmet band, amber while down like their beacon. Never enemy red, never husk green. */
const ALLY = ALLY_TEXT;
const ALLY_DOWN = `#${ALLY_DOWN_COLOR.toString(16)}`;
const SHOP_LOST = '#6b737c';
/** A co-op teammate who is down: the red of their tag (net/team.ts). */
const MATE_DOWN = '#ff3b3b';

export interface MinimapPoint {
  x: number;
  y: number;
  z: number;
  color: string;
}

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private size = 240;
  private shopFont = '800 10px ui-monospace, Menlo, monospace';
  private northFont = '800 12px ui-monospace, Menlo, monospace';
  private clock = 0;
  private trailClock = 0;
  private range = NEAR_RANGE;
  /** Ring of past XZ per enemy slot, oldest overwritten. */
  private trail = new Float32Array(MAX_TRACKED * TRAIL_LEN * 2);
  private trailHead = 0;
  private trailCount = 0;
  private trackIds = new Int32Array(MAX_TRACKED).fill(-1);
  private ping = 0;

  constructor(private readonly ctx: Ctx, private readonly world: WorldLayer) {
    this.canvas = h('canvas', 'mm-canvas');
    this.el = div('minimap', this.canvas);
    this.g = this.canvas.getContext('2d', { alpha: true })!;
    this.measure();
  }

  measure(): void {
    const cssSize = this.canvas.clientWidth || 240;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.size = Math.max(64, Math.round(cssSize * dpr));
    this.canvas.width = this.canvas.height = this.size;
    const u = this.size / 240;
    this.shopFont = `800 ${Math.round(10 * u)}px ui-monospace, Menlo, monospace`;
    this.northFont = `800 ${Math.round(12 * u)}px ui-monospace, Menlo, monospace`;
  }

  private sampleTrails(s: HudState): void {
    this.trailHead = (this.trailHead + 1) % TRAIL_LEN;
    this.trailCount = Math.min(this.trailCount + 1, TRAIL_LEN);
    const n = Math.min(s.enemies.length, MAX_TRACKED);
    for (let i = 0; i < n; i++) {
      const e = s.enemies[i]!;
      if (this.trackIds[i] !== e.uid) {
        // A slot changing hands must not draw a streak across the map, so seed the whole history in place.
        this.trackIds[i] = e.uid;
        for (let k = 0; k < TRAIL_LEN; k++) {
          this.trail[(i * TRAIL_LEN + k) * 2] = e.position.x;
          this.trail[(i * TRAIL_LEN + k) * 2 + 1] = e.position.z;
        }
      }
      const o = (i * TRAIL_LEN + this.trailHead) * 2;
      this.trail[o] = e.position.x;
      this.trail[o + 1] = e.position.z;
    }
  }

  update(s: HudState, dt: number, pickups: readonly MinimapPoint[] | (() => readonly MinimapPoint[])): void {
    const open = clamp((s.speed - MOVE.runSpeed) / (FAR_SPEED - MOVE.runSpeed));
    this.range = damp(this.range, NEAR_RANGE + open * (FAR_RANGE - NEAR_RANGE), 2.2, dt);
    this.ping = (this.ping + dt / PING_PERIOD) % 1;
    this.trailClock -= dt;
    if (this.trailClock <= 0) {
      this.trailClock = TRAIL_SAMPLE;
      this.sampleTrails(s);
    }
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = REDRAW;
    this.draw(s, typeof pickups === 'function' ? pickups() : pickups);
  }

  private draw(s: HudState, pickups: readonly MinimapPoint[]): void {
    const { g, size } = this;
    const { player, world } = this.ctx;
    const pos = player.position;
    const fwd = player.forward;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    if (typeof pos?.x !== 'number' || typeof fwd?.x !== 'number') return;

    const px = pos.x;
    const pz = pos.z;
    const half = size / 2;
    const scale = half / this.range;
    const heading = Math.atan2(fwd.x, -fwd.z);
    const cos = Math.cos(-heading);
    const sin = Math.sin(-heading);

    const map = world.minimap;
    const image = map?.image;
    if (image instanceof HTMLCanvasElement) {
      const b = map.bounds;
      g.save();
      g.translate(half, half);
      g.rotate(-heading);
      g.scale(scale, scale);
      g.translate(-px, -pz);
      g.globalAlpha = 0.9;
      g.drawImage(image, b.min.x, b.min.z, b.max.x - b.min.x, b.max.z - b.min.z);
      g.restore();
    }

    const u = size / 240;

    for (const p of pickups) {
      const rx = p.x - px;
      const rz = p.z - pz;
      const x = half + (rx * cos - rz * sin) * scale;
      const y = half + (rx * sin + rz * cos) * scale;
      if (x < 0 || y < 0 || x > size || y > size) continue;
      g.fillStyle = p.color;
      g.fillRect(x - 3 * u, y - 3 * u, 6 * u, 6 * u);
    }

    for (const m of this.world.markers) {
      if (!m.live || m.target) continue;
      const rx = m.pos.x - px;
      const rz = m.pos.z - pz;
      const x = clamp(half + (rx * cos - rz * sin) * scale, 8 * u, size - 8 * u);
      const y = clamp(half + (rx * sin + rz * cos) * scale, 8 * u, size - 8 * u);
      g.fillStyle = m.color;
      g.beginPath();
      g.moveTo(x, y - 7 * u);
      g.lineTo(x + 7 * u, y);
      g.lineTo(x, y + 7 * u);
      g.lineTo(x - 7 * u, y);
      g.closePath();
      g.fill();
    }

    // Shops: a lettered tile in the shop's colour, grey while lost, held on the rim when off the map so it still points the way.
    const defense = this.ctx.contracts?.defense;
    if (defense) {
      g.font = this.shopFont;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const id of SHOP_ORDER) {
        const p = defense.anchors[id].position;
        const rx = p.x - px;
        const rz = p.z - pz;
        const x = clamp(half + (rx * cos - rz * sin) * scale, 9 * u, size - 9 * u);
        const y = clamp(half + (rx * sin + rz * cos) * scale, 9 * u, size - 9 * u);
        const color = defense.shops[id].lost ? SHOP_LOST : SHOPS[id].color;
        g.fillStyle = '#05090e';
        g.fillRect(x - 8 * u, y - 8 * u, 16 * u, 16 * u);
        g.strokeStyle = color;
        g.lineWidth = 2 * u;
        g.strokeRect(x - 7 * u, y - 7 * u, 14 * u, 14 * u);
        g.fillStyle = color;
        g.fillText(SHOPS[id].name[0]!, x, y + u);
      }
    }

    const n = Math.min(s.enemies.length, MAX_TRACKED);
    const reveal = s.sonarLive > 0 || (REVEALS && s.phase !== 'intermission' && s.remaining <= REVEAL_AT);
    if (this.trailCount > 1) {
      g.fillStyle = ENEMY;
      for (let k = 1; k < this.trailCount; k++) {
        g.globalAlpha = 0.42 - k * 0.14;
        const slot = (this.trailHead - k + TRAIL_LEN) % TRAIL_LEN;
        for (let i = 0; i < n; i++) {
          const o = (i * TRAIL_LEN + slot) * 2;
          const rx = this.trail[o]! - px;
          const rz = this.trail[o + 1]! - pz;
          const x = half + (rx * cos - rz * sin) * scale;
          const y = half + (rx * sin + rz * cos) * scale;
          g.fillRect(x - 1.5 * u, y - 1.5 * u, 3 * u, 3 * u);
        }
      }
      g.globalAlpha = 1;
    }

    const carriers = defense?.carriers;
    for (let i = 0; i < s.enemies.length; i++) {
      const e = s.enemies[i]!;
      const rx = e.position.x - px;
      const rz = e.position.z - pz;
      const x = half + (rx * cos - rz * sin) * scale;
      const y = half + (rx * sin + rz * cos) * scale;
      if (carriers?.has(e.uid)) {
        this.bomb(clamp(x, 7 * u, size - 7 * u), clamp(y, 7 * u, size - 7 * u), u);
        continue;
      }
      const inside = x >= 0 && y >= 0 && x <= size && y <= size;
      const cx = inside ? x : clamp(x, 3 * u, size - 3 * u);
      const cy = inside ? y : clamp(y, 3 * u, size - 3 * u);
      const big = e.isBoss;
      const r = (big ? 6 : inside ? 3.2 : 2) * u;
      g.fillStyle = big ? ELITE : ENEMY;
      // Height matters on this map: above you is a wedge up, below is a wedge down, level is a square.
      const dy = e.position.y - pos.y;
      if (dy > 4 || dy < -4) {
        const dir = dy > 0 ? -1 : 1;
        g.beginPath();
        g.moveTo(cx, cy + dir * r * 1.3);
        g.lineTo(cx + r * 1.2, cy - dir * r);
        g.lineTo(cx - r * 1.2, cy - dir * r);
        g.closePath();
        g.fill();
      } else {
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      if (reveal) {
        g.strokeStyle = ENEMY;
        g.globalAlpha = 1 - this.ping;
        g.lineWidth = 2 * u;
        g.strokeRect(cx - r - this.ping * 14 * u, cy - r - this.ping * 14 * u, (r + this.ping * 14 * u) * 2, (r + this.ping * 14 * u) * 2);
        g.globalAlpha = 1;
      }
    }

    // Friendlies: round, where enemies are square. The dead are off the roster already.
    const allies = this.ctx.allies?.allies;
    if (allies) {
      g.strokeStyle = '#000000';
      g.lineWidth = 1.5 * u;
      for (const a of allies) {
        const p = a.body.position;
        const rx = p.x - px;
        const rz = p.z - pz;
        const x = half + (rx * cos - rz * sin) * scale;
        const y = half + (rx * sin + rz * cos) * scale;
        if (x < 0 || y < 0 || x > size || y > size) continue;
        const down = a.state === 'down';
        g.fillStyle = down ? ALLY_DOWN : ALLY;
        g.globalAlpha = down ? 0.55 + 0.45 * (1 - this.ping) : 1;
        g.beginPath();
        g.arc(x, y, (down ? 4.5 : 3.6) * u, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // Co-op: teammates, round like the friendlies, in the colour of their tag, with a tick the way they face. Held on the rim
    // when off the map, so a friend can always be found. The dead are not drawn; the downed pulse red.
    const coop = this.ctx.coop;
    if (coop?.world) {
      const lives = coop.world.team.lives;
      for (const [id, remote] of coop.remotes) {
        const root = remote.char.root;
        const state = lives.get(id)?.state ?? 'up';
        if (!root.visible || state === 'dead') continue;
        const p = root.position;
        const rx = p.x - px;
        const rz = p.z - pz;
        const x = clamp(half + (rx * cos - rz * sin) * scale, 7 * u, size - 7 * u);
        const y = clamp(half + (rx * sin + rz * cos) * scale, 7 * u, size - 7 * u);
        const down = state === 'down';
        if (down) {
          g.strokeStyle = MATE_DOWN;
          g.globalAlpha = 1 - this.ping;
          g.lineWidth = 2 * u;
          g.beginPath();
          g.arc(x, y, (6 + this.ping * 9) * u, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        } else {
          // The body faces +Z (net/remote.ts): its heading on the map, turned with the map.
          const fx = Math.sin(root.rotation.y), fz = Math.cos(root.rotation.y);
          const dx = fx * cos - fz * sin, dy = fx * sin + fz * cos;
          g.fillStyle = remote.color;
          g.beginPath();
          g.moveTo(x + dx * 10 * u, y + dy * 10 * u);
          g.lineTo(x - dy * 4 * u, y + dx * 4 * u);
          g.lineTo(x + dy * 4 * u, y - dx * 4 * u);
          g.closePath();
          g.fill();
        }
        g.fillStyle = down ? MATE_DOWN : remote.color;
        g.strokeStyle = '#000000';
        g.lineWidth = 1.5 * u;
        g.beginPath();
        g.arc(x, y, 5 * u, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }

    // North rides the rim, so a player-up map still gives a fixed bearing to call out.
    const nx = half + Math.sin(-heading) * (half - 9 * u);
    const ny = half - Math.cos(-heading) * (half - 9 * u);
    g.fillStyle = '#000000';
    g.fillRect(nx - 7 * u, ny - 7 * u, 14 * u, 14 * u);
    g.fillStyle = NORTH;
    g.font = this.northFont;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + u);

    // Player: fixed at the centre, always pointing up.
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000000';
    g.lineWidth = 2 * u;
    g.beginPath();
    g.moveTo(half, half - 10 * u);
    g.lineTo(half + 7 * u, half + 8 * u);
    g.lineTo(half, half + 4 * u);
    g.lineTo(half - 7 * u, half + 8 * u);
    g.closePath();
    g.stroke();
    g.fill();
  }

  private bomb(x: number, y: number, u: number): void {
    const { g } = this;
    g.strokeStyle = CARRIER;
    g.globalAlpha = 1 - this.ping;
    g.lineWidth = 2 * u;
    g.beginPath();
    g.arc(x, y, (6 + this.ping * 10) * u, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = CARRIER;
    g.strokeStyle = '#000000';
    g.lineWidth = 1.5 * u;
    g.beginPath();
    g.arc(x, y, 5.5 * u, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.strokeStyle = FUSE;
    g.beginPath();
    g.moveTo(x + 3.5 * u, y - 3.5 * u);
    g.lineTo(x + 6.5 * u, y - 6.5 * u);
    g.stroke();
    if (this.ping < 0.5) {
      g.fillStyle = FUSE;
      g.fillRect(x + 5.5 * u, y - 8.5 * u, 3 * u, 3 * u);
    }
  }

  reset(): void {
    this.trackIds.fill(-1);
    this.trailCount = 0;
  }
}
