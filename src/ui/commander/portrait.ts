/**
 * Who is talking, drawn on a small canvas and shown big, so it reads as a bad video link from a man in a bunker. It is the only face
 * the player ever gets for the Commander, and it has to carry the arc on its own: section 18's smug, irritated, rattled and cracked
 * are four different men by the end. The Council gets a seal, because it does not have a face. The intercept gets a signal.
 *
 * Plain canvas shapes at 96 pixels, so nothing is loaded and nothing costs anything while nobody is speaking.
 */
import type { Tone } from '../../enemies/commander/adaptations';
import type { Speaker } from '../../enemies/commander/lines';

const SIZE = 96;
/** Frames a second while talking. Low, because a low frame rate is what sells the video link. */
const FPS = 9;

const SKIN: Record<Tone, string> = { smug: '#c79a7b', irritated: '#cc8469', rattled: '#c2a98f', cracked: '#b9a27f' };
const SHADE: Record<Tone, string> = { smug: '#8e6a52', irritated: '#94503f', rattled: '#8c7a66', cracked: '#7d6a4d' };
const WALL: Record<Tone, string> = { smug: '#1b2a30', irritated: '#2a2622', rattled: '#26222a', cracked: '#2c1417' };
const COAT = '#2c3a2c';
const COAT_DARK = '#1c261d';
const CAP = '#1a2128';
const GOLD = '#c9a13e';
const HAIR = '#8a8f93';

export class Portrait {
  readonly el: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private clock = 0;
  private frame = 0;
  private speaker: Speaker = 'commander';
  private tone: Tone = 'smug';

  constructor(className: string) {
    this.el = document.createElement('canvas');
    this.el.className = className;
    this.el.width = this.el.height = SIZE;
    this.g = this.el.getContext('2d', { alpha: false })!;
  }

  set(speaker: Speaker, tone: Tone): void {
    this.speaker = speaker;
    this.tone = tone;
    this.draw(false);
  }

  /** `talking` moves the mouth. A quiet man only blinks. */
  update(dt: number, talking: boolean): void {
    this.clock += dt;
    if (this.clock < 1 / FPS) return;
    this.clock = 0;
    this.frame++;
    this.draw(talking);
  }

  private draw(talking: boolean): void {
    const { g } = this;
    if (this.speaker === 'commander') this.commander(talking);
    else if (this.speaker === 'council') this.seal(talking);
    else this.signal();
    this.scan();
    g.globalAlpha = 1;
  }

  private rect(x: number, y: number, w: number, h: number, c: string): void {
    this.g.fillStyle = c;
    this.g.fillRect(x, y, w, h);
  }

  private blob(x: number, y: number, rx: number, ry: number, c: string): void {
    const { g } = this;
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }

  private poly(c: string, ...pts: number[]): void {
    const { g } = this;
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
    g.closePath();
    g.fill();
  }

  private line(c: string, w: number, ...pts: number[]): void {
    const { g } = this;
    g.strokeStyle = c;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
    g.stroke();
  }

  private commander(talking: boolean): void {
    const t = this.tone;
    const f = this.frame;
    // By the end the head will not hold still.
    const shake = t === 'cracked' ? ((f * 7) % 3) - 1 : t === 'rattled' ? ((f * 5) % 2) * 0.6 : 0;
    const cx = 48 + shake;
    this.rect(0, 0, SIZE, SIZE, WALL[t]);
    // A map on the wall behind him, losing pins as the run goes on.
    this.rect(6, 8, 30, 22, '#2d3b38');
    this.line('#3e514c', 1, 8, 16, 34, 14);
    this.line('#3e514c', 1, 14, 9, 18, 29);
    if (t === 'smug' || t === 'irritated') {
      this.rect(12, 13, 2, 2, '#d33');
      this.rect(26, 22, 2, 2, '#d33');
      this.rect(20, 18, 2, 2, '#d33');
    }
    if (t === 'cracked') this.line('#b01818', 2, 8, 10, 34, 28, 12, 26, 32, 12);

    // Shoulders, tunic, medals.
    this.poly(COAT, 8, 96, 14, 72, 34, 64, 62, 64, 82, 72, 88, 96);
    this.poly(COAT_DARK, 40, 64, 48, 78, 56, 64, 56, 96, 40, 96);
    this.rect(18, 74, 3, 8, GOLD);
    this.rect(23, 74, 3, 8, '#b5462e');
    this.rect(28, 74, 3, 8, '#4a7a9a');
    if (t === 'rattled' || t === 'cracked') this.line('#d8d2c0', 2, 42, 66, 48, 76, 54, 66);

    // Neck and head.
    this.rect(cx - 8, 56, 16, 12, SHADE[t]);
    this.blob(cx, 40, 19, 23, SKIN[t]);
    this.blob(cx - 18, 41, 3, 5, SHADE[t]);
    this.blob(cx + 18, 41, 3, 5, SHADE[t]);
    this.poly(SHADE[t], cx - 16, 52, cx, 63, cx + 16, 52, cx + 10, 60, cx, 64, cx - 10, 60);

    this.eyes(cx, t, f);
    this.mouth(cx, t, f, talking);
    this.hat(cx, t, f);
  }

  private eyes(cx: number, t: Tone, f: number): void {
    const blink = f % 31 === 0 || f % 31 === 1;
    const wide = t === 'rattled' || t === 'cracked';
    const y = 37;
    for (const side of [-1, 1]) {
      const x = cx + side * 8;
      if (blink && t !== 'cracked') {
        this.line('#3a2a22', 1.5, x - 4, y, x + 4, y);
      } else {
        const big = t === 'cracked' && side > 0 ? 5.5 : wide ? 4.2 : 3.2;
        this.blob(x, y, big + 0.6, wide ? big : 2.2, '#e9e3d4');
        const drift = t === 'cracked' ? ((f >> 2) % 3) - 1 : side * 0.3;
        this.blob(x + drift, y, 1.4, wide ? 1.4 : 1.8, '#14181c');
      }
      // Brows do most of the acting.
      if (t === 'smug') this.line('#55585b', 2.2, x - 5, y - (side > 0 ? 8 : 5), x + 5, y - (side > 0 ? 7 : 6));
      else if (t === 'irritated') this.line('#55585b', 2.6, x - side * 5, y - 7, x + side * 5, y - 3);
      else if (t === 'rattled') this.line('#55585b', 2.2, x - side * 5, y - 5, x + side * 5, y - 9);
      else this.line('#55585b', 2.2, x - 5, y - 8 + side * 2, x + 5, y - 6 - side * 2);
    }
    if (t === 'irritated') this.line('#7a3226', 1.2, cx + 10, 26, cx + 13, 22, cx + 16, 25);
    if (t === 'rattled' || t === 'cracked') {
      const drip = (f >> 1) % 6;
      this.blob(cx - 17, 30 + drip * 2, 1.2, 2, '#9fd0e6');
      this.blob(cx + 16, 34 + ((drip + 3) % 6) * 2, 1, 1.8, '#9fd0e6');
    }
    if (t === 'cracked') this.line('#8d2c20', 1, cx - 14, 26, cx - 8, 30, cx - 12, 33);
  }

  private mouth(cx: number, t: Tone, f: number, talking: boolean): void {
    const open = talking && f % 2 === 0 ? (t === 'cracked' ? 5 : 3.2) : 0;
    const y = 52;
    if (t === 'cracked') {
      // The smile from the first box, come back wrong.
      this.poly('#4a1a18', cx - 11, y - 1, cx + 11, y - 2, cx + 8, y + 3 + open, cx - 8, y + 3 + open);
      for (let i = -9; i < 10; i += 3) this.rect(cx + i, y - 1, 2, 2.4, '#e9e3d4');
    } else {
      this.blob(cx, y + 1, 6, 1 + open, open > 0 ? '#3a1712' : '#74463a');
      if (t === 'smug' && open === 0) this.line('#74463a', 1.5, cx + 3, y + 1, cx + 8, y - 1);
      if (t === 'rattled' && open === 0) this.line('#74463a', 1.5, cx - 5, y + 2, cx - 1, y, cx + 3, y + 2, cx + 6, y);
    }
    // The moustache rides on top of whatever the mouth is doing, and it goes last.
    if (t !== 'cracked') {
      this.poly(HAIR, cx - 11, y - 1 - open * 0.3, cx - 2, y - 5, cx, y - 4, cx + 2, y - 5, cx + 11, y - 1 - open * 0.3, cx + 5, y - 2, cx, y - 2.6, cx - 5, y - 2);
    }
    if (t === 'smug' && open === 0) {
      // The cigar goes out after the first few waves. He never lights another.
      this.line('#6b4a2c', 3, cx + 7, y + 1, cx + 19, y + 4);
      this.rect(cx + 18, y + 3, 2.6, 2.6, '#d96a2c');
      const puff = (f >> 1) % 7;
      this.blob(cx + 22 + puff * 0.6, y - 3 - puff * 2, 1.6 + puff * 0.4, 1.4 + puff * 0.3, '#5e6a6c');
    }
  }

  private hat(cx: number, t: Tone, f: number): void {
    if (t === 'cracked') {
      // The cap went some time ago.
      for (let i = -16; i <= 16; i += 4) this.line(HAIR, 2, cx + i, 24, cx + i * 1.3 + (((f + i) % 3) - 1) * 2, 11 + Math.abs(i) * 0.3);
      this.rect(cx - 15, 22, 13, 4, '#d8d2c0');
      this.rect(cx - 10, 21, 2, 6, '#a0382a');
      return;
    }
    const tilt = t === 'rattled' ? 3 : 0;
    this.poly(CAP, cx - 24, 22 + tilt, cx - 15, 8, cx + 15, 8 - tilt * 0.4, cx + 24, 22 - tilt * 0.4, cx + 20, 26 - tilt * 0.4, cx - 20, 26 + tilt);
    this.poly('#0d1216', cx - 21, 26 + tilt, cx + 21, 26 - tilt * 0.4, cx + 16, 30 - tilt * 0.4, cx - 16, 30 + tilt);
    this.rect(cx - 19, 22 + tilt * 0.4, 38, 2, GOLD);
    this.blob(cx, 15, 4, 4.4, GOLD);
    this.blob(cx, 15, 1.8, 2, CAP);
  }

  /** The Council's mark: three bars of a form, and an eye that has never once blinked. */
  private seal(talking: boolean): void {
    const f = this.frame;
    this.rect(0, 0, SIZE, SIZE, '#0a1a22');
    const ring = '#39e0ff';
    const { g } = this;
    g.strokeStyle = ring;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(48, 48, 40, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
    g.beginPath();
    g.arc(48, 48, 34, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + f * 0.01;
      this.rect(48 + Math.sin(a) * 37 - 0.7, 48 + Math.cos(a) * 37 - 0.7, 1.4, 1.4, ring);
    }
    this.poly('#123642', 48, 18, 76, 66, 20, 66);
    g.strokeStyle = ring;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(48, 18);
    g.lineTo(76, 66);
    g.lineTo(20, 66);
    g.closePath();
    g.stroke();
    this.blob(48, 50, 13, 7, '#d5f6ff');
    this.blob(48, 50, 5, 5.6, talking && f % 2 === 0 ? '#ff4030' : '#0a1a22');
    this.rect(30, 70, 36, 2, ring);
    this.rect(35, 74, 26, 2, ring);
    this.rect(40, 78, 16, 2, ring);
  }

  /** A signal on a scope, which is all anyone knows about where this came from. */
  private signal(): void {
    const f = this.frame;
    this.rect(0, 0, SIZE, SIZE, '#120c02');
    for (let i = 0; i < SIZE; i += 12) {
      this.rect(i, 0, 1, SIZE, '#2a1d06');
      this.rect(0, i, SIZE, 1, '#2a1d06');
    }
    const { g } = this;
    g.strokeStyle = '#ffb400';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x < SIZE; x += 2) {
      const y = 48 + Math.sin(x * 0.21 + f * 0.9) * 13 * Math.sin(x * 0.04 + f * 0.13) + Math.sin(x * 1.3 + f * 2.1) * 3;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    this.rect(6, 6, f % 8 < 4 ? 8 : 0, 8, '#ff3010');
  }

  private scan(): void {
    const { g } = this;
    g.globalAlpha = 0.22;
    for (let y = 0; y < SIZE; y += 2) this.rect(0, y, SIZE, 1, '#000');
    g.globalAlpha = 1;
    if (this.speaker === 'commander' && this.tone === 'cracked' && this.frame % 11 < 2) {
      const y = (this.frame * 13) % 80;
      g.drawImage(this.el, 0, y, SIZE, 10, 4, y, SIZE, 10);
    }
  }
}
