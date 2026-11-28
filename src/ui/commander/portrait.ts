/**
 * Who is talking, drawn on a small canvas and shown big, so it reads as a bad video link from a man in a bunker. It is the only face
 * the player ever gets for the Commander, and it has to carry the arc on its own: section 18's smug, irritated, rattled and cracked
 * are four different men by the end. The Council gets a seal, because it does not have a face. The intercept gets a signal. The
 * Harbourmaster gets the port's loudspeaker on its pole, because that is all anyone in Holdfast ever sees of her either.
 *
 * Plain canvas shapes at 96 pixels, so nothing is loaded and nothing costs anything while nobody is speaking.
 */
import type { Tone } from '../../enemies/commander/adaptations';
import type { Speaker } from '../../enemies/commander/lines';

const SIZE = 96;
/** Frames a second while talking. Low, because a low frame rate is what sells the video link. */
const FPS = 9;
const ZOOM = 1.32;
/** What the zoom centres on. */
const FACE_Y = 44;

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
    if (this.speaker === 'commander') {
      // Framed tight: at the size this is shown, the eyes and brows are the performance.
      this.rect(0, 0, SIZE, SIZE, WALL[this.tone]);
      g.save();
      g.translate(SIZE / 2, SIZE / 2);
      g.scale(ZOOM, ZOOM);
      g.translate(-SIZE / 2, -FACE_Y);
      this.commander(talking);
      g.restore();
    } else if (this.speaker === 'council') this.seal(talking);
    else if (this.speaker === 'harbourmaster') this.horn(talking);
    else if (this.speaker === 'governor') this.governor(talking);
    else if (this.speaker === 'quist') this.quist(talking);
    else if (this.speaker === 'tiamat') this.tiamat(talking);
    else if (this.speaker === 'darrow') this.darrow(talking);
    else if (this.speaker === 'halvorsen') this.halvorsen(talking);
    else if (this.speaker === 'mercer') this.mercer(talking);
    else if (this.speaker === 'viper') this.viper(talking);
    else if (this.speaker === 'carrier') this.carrier(talking);
    else if (this.speaker === 'faultman') this.faultman(talking);
    else if (this.speaker === 'orion') this.orion(talking);
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

  /** Holdfast's loudspeaker on its pole against a painted wall, under bunting, rings coming off it while she talks. */
  private horn(talking: boolean): void {
    const f = this.frame;
    this.rect(0, 0, SIZE, SIZE, '#3a1a3c');
    // A painted wall in bands, the town's colours.
    this.rect(0, 62, SIZE, 34, '#1f6f78');
    this.rect(0, 58, SIZE, 4, '#e0a020');
    // Bunting across the top.
    const flags = ['#e83e8c', '#f2c12e', '#27b5c9', '#f07b2a'];
    this.line('#c8b89a', 1, 0, 10, 96, 16);
    for (let i = 0; i < 8; i++) this.poly(flags[i % 4]!, 4 + i * 12, 10 + i * 0.75, 12 + i * 12, 11 + i * 0.75, 8 + i * 12, 19 + i * 0.75);
    // The pole and its bracket.
    this.rect(24, 34, 4, 62, '#5a5148');
    this.rect(24, 44, 18, 3, '#5a5148');
    // The horn: a flared trumpet pointing at the player, rusted.
    this.poly('#b8b0a0', 40, 38, 40, 54, 70, 66, 70, 26);
    this.poly('#8c8478', 40, 46, 40, 54, 70, 66, 70, 46);
    this.blob(70, 46, 5, 20, '#d9d2c2');
    this.blob(70, 46, 3, 15, '#2a2420');
    this.rect(34, 40, 7, 12, '#6b6258');
    if (talking) {
      const g = this.g;
      g.strokeStyle = '#f2c12e';
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const r = 8 + ((f + i * 3) % 9) * 2.4;
        g.globalAlpha = 1 - ((f + i * 3) % 9) / 9;
        g.beginPath();
        g.arc(72, 46, r, -0.9, 0.9);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // A lamp on the bracket that blinks on air.
    this.blob(26, 30, 3, 3, talking && f % 2 === 0 ? '#ff5a2a' : '#5a2a1a');
  }

  /** Governor Reginald Sterling: tailored pinstripe suit, brass monocle, Reserve bullion seal & red ticker behind him. */
  private governor(talking: boolean): void {
    const t = this.tone;
    const f = this.frame;
    const shake = t === 'cracked' ? ((f * 5) % 3) - 1 : 0;
    const cx = 48 + shake;
    // Mahogany boardroom wall with brass wainscot and crashing stock ticker.
    this.rect(0, 0, SIZE, SIZE, t === 'cracked' ? '#241214' : '#1b1d26');
    this.rect(0, 62, SIZE, 34, '#2a1d14');
    this.rect(0, 60, SIZE, 2, '#d4a63a');
    // Ticker tape line (green when smug, crashing red when rattled/cracked).
    const tickCol = t === 'smug' ? '#3bd671' : '#e03e36';
    this.line(tickCol, 1.5, 4, 24, 18, 22, 32, t === 'smug' ? 18 : 30, 64, t === 'smug' ? 16 : 36, 92, t === 'smug' ? 14 : 46);
    // Reserve brass emblem behind head.
    this.g.strokeStyle = '#c9a13e';
    this.g.lineWidth = 1.5;
    this.g.beginPath();
    this.g.arc(48, 38, 28, 0, Math.PI * 2);
    this.g.stroke();

    // Tailored dark navy suit, crisp collar, crimson silk tie.
    this.poly('#182233', 10, 96, 18, 70, 36, 63, 60, 63, 78, 70, 86, 96);
    this.poly('#e8e4d8', 41, 63, 48, 77, 55, 63);
    this.poly('#a82228', 46, 69, 50, 69, 51, 90, 48, 95, 45, 90);
    // Gold pocket square.
    this.poly('#e5b832', 24, 78, 31, 76, 30, 81, 24, 81);

    // Neck & head.
    this.rect(cx - 7, 55, 14, 10, '#a67b61');
    this.blob(cx, 40, 17, 21, '#d3a588');
    // Silver slicked hair (mussed when rattled/cracked).
    this.poly('#b8bec4', cx - 17, 34, cx - 14, 18, cx, 15, cx + 14, 18, cx + 17, 34, cx + 12, 25, cx, 23, cx - 12, 25);
    if (t === 'cracked') {
      this.line('#b8bec4', 2, cx - 8, 18, cx - 14, 10);
      this.line('#b8bec4', 2, cx + 6, 17, cx + 13, 11);
    }

    // Eyes + gold monocle on right eye (slips when cracked!).
    const ey = 38;
    const blink = f % 29 === 0 && t !== 'cracked';
    for (const side of [-1, 1]) {
      const ex = cx + side * 7;
      if (blink) this.line('#3a2a22', 1.5, ex - 3.5, ey, ex + 3.5, ey);
      else {
        this.blob(ex, ey, 3.3, t === 'cracked' ? 4 : 2.3, '#f2ede2');
        this.blob(ex, ey, 1.4, 1.5, '#12161c');
      }
      const bOff = t === 'irritated' || t === 'cracked' ? side * 2 : 0;
      this.line('#8c9298', 2, ex - 4, ey - 6 - bOff, ex + 4, ey - 6 + bOff);
    }
    // Brass monocle + chain.
    const monoY = t === 'cracked' ? ey + 6 : ey;
    this.g.strokeStyle = '#e5b832';
    this.g.lineWidth = 1.6;
    this.g.beginPath();
    this.g.arc(cx + 7, monoY, 5.2, 0, Math.PI * 2);
    this.g.stroke();
    this.line('#c9a13e', 1, cx + 12, monoY + 2, cx + 16, 62);

    // Mouth & clipped aristocratic moustache.
    const open = talking && f % 2 === 0 ? (t === 'cracked' ? 5 : 3) : 0;
    this.blob(cx, 52, 5.5, 1 + open, open > 0 ? '#3a1414' : '#7a4b3f');
    this.poly('#9da3a8', cx - 10, 49, cx - 2, 46.5, cx + 2, 46.5, cx + 10, 49, cx + 4, 50, cx - 4, 50);

    // ON AIR red LED in corner.
    this.blob(10, 10, 3, 3, talking && f % 2 === 0 ? '#ff3a2a' : '#4a1814');
  }

  /** Hadrek Quist ("the Salt King"): calm, frightening desert warlord over loudspeaker PA. */
  private quist(talking: boolean): void {
    const f = this.frame;
    const t = this.tone;
    const cx = 48;
    // Sun-baked ochre / rust shadow background behind a grated loudspeaker grille.
    this.rect(0, 0, SIZE, SIZE, t === 'cracked' ? '#2c150c' : '#2a1d12');
    for (let y = 6; y < 34; y += 6) this.line('#3f2917', 1, 4, y, 92, y);
    // Welded scrap shoulder pauldrons & weathered desert coat.
    this.poly('#3b2b20', 8, 96, 18, 66, 78, 66, 88, 96);
    this.poly('#5a4636', 14, 70, 30, 65, 32, 78, 12, 82);
    this.poly('#523f30', 82, 70, 66, 65, 64, 78, 84, 82);
    // Heavy ochre scarf draped around collar.
    this.poly('#9c7244', 24, 62, 72, 62, 75, 76, 48, 82, 21, 76);
    this.line('#74512e', 1.5, 25, 68, 70, 69);
    // Gaunt sun-weathered face + vertical cheek scar.
    this.rect(cx - 7, 54, 14, 10, '#8d6448');
    this.blob(cx, 40, 16, 20, '#b58460');
    this.line('#6d3b2b', 1.6, cx - 10, 36, cx - 6, 51);
    // Headwrap / desert hood & pushed-up brass dust goggles on forehead.
    this.poly('#6c5238', cx - 18, 36, cx - 16, 16, cx, 12, cx + 16, 16, cx + 18, 36, cx + 12, 24, cx - 12, 24);
    this.rect(cx - 16, 20, 32, 6, '#3a2d22');
    this.blob(cx - 7, 23, 5.2, 4.2, '#2a2018');
    this.blob(cx + 7, 23, 5.2, 4.2, '#2a2018');
    this.blob(cx - 7, 23, 3.6, 2.8, '#c8832c');
    this.blob(cx + 7, 23, 3.6, 2.8, '#c8832c');
    // Calm, hard eyes — never blinks when rattled.
    const ey = 38;
    const blink = f % 43 === 0 && t === 'smug';
    for (const side of [-1, 1]) {
      const ex = cx + side * 6.5;
      if (blink) this.line('#2c1c14', 1.5, ex - 3.5, ey, ex + 3.5, ey);
      else {
        this.blob(ex, ey, 3.1, 2.0, '#ece3d0');
        this.blob(ex, ey, 1.4, 1.4, '#14100d');
      }
      this.line('#443122', 2, ex - 4.2, ey - 4.5, ex + 4.2, ey - 4.5);
    }
    // Thin calm mouth & salt-crusted beard stubble.
    this.poly('#5c4636', cx - 12, 49, cx - 9, 57, cx, 60, cx + 9, 57, cx + 12, 49, cx + 7, 52, cx - 7, 52);
    const open = talking && f % 2 === 0 ? 2.6 : 0;
    this.blob(cx, 51, 5.2, 1 + open, open > 0 ? '#2b120e' : '#6c4234');
    // PA loudspeaker pulse LED.
    this.blob(10, 10, 3, 3, talking && f % 2 === 0 ? '#ff6a22' : '#4a2210');
  }

  /** TIAMAT: angry Council alien ogre-robot — horned dark-iron cranium, glowing molten optics, tusked vocoder jaw. */
  private tiamat(talking: boolean): void {
    const f = this.frame;
    const { g } = this;
    const shakeX = talking ? ((f * 7) % 3) - 1 : 0;
    const shakeY = talking && f % 3 === 0 ? -1 : 0;
    const cx = 48 + shakeX;
    const cy = shakeY;

    // Furnace-crimson alien command chamber backdrop with pulsing energy conduits & embers.
    this.rect(0, 0, SIZE, SIZE, '#140608');
    for (let y = 10; y < SIZE; y += 16) this.line('#2a0d10', 1, 0, y, SIZE, y);
    for (let x = 12; x < SIZE; x += 24) this.line('#260b0e', 1, x, 0, x, SIZE);
    // Rising furnace sparks.
    for (let i = 0; i < 6; i++) {
      const sx = (11 + i * 17 + ((f * (i + 2)) % 9)) % SIZE;
      const sy = SIZE - ((f * 5 + i * 19) % SIZE);
      this.rect(sx, sy, 2, 2, i % 2 === 0 ? '#ff6a22' : '#ffbb33');
    }

    // Massive spiked gunmetal-obsidian war-chassis shoulders & glowing molten chest vents.
    this.poly('#1e2128', 2, 96, 12, 66, 30, 62, 66, 62, 84, 66, 94, 96);
    this.poly('#343944', 10, 96, 17, 68, 32, 65, 64, 65, 79, 68, 86, 96);
    // Jagged shoulder spikes.
    this.poly('#585d68', 8, 69, 2, 54, 18, 65);
    this.poly('#585d68', 88, 69, 94, 54, 78, 65);
    // Molten reactor vents on chest collar.
    const coreGlow = talking && f % 2 === 0 ? '#ff9426' : '#d93818';
    this.rect(cx - 12, 74 + cy, 24, 5, '#0b0506');
    this.rect(cx - 10, 75 + cy, 6, 3, coreGlow);
    this.rect(cx - 2, 75 + cy, 4, 3, '#ffd266');
    this.rect(cx + 4, 75 + cy, 6, 3, coreGlow);

    // Armored piston neck.
    this.rect(cx - 11, 56 + cy, 22, 12, '#1d2126');
    this.line('#4b525c', 2, cx - 6, 56 + cy, cx - 6, 67 + cy);
    this.line('#4b525c', 2, cx + 6, 56 + cy, cx + 6, 67 + cy);

    // Twin massive curved biomechanical alien ogre horns sweeping upward from temples.
    for (const side of [-1, 1] as const) {
      const hx = cx + side * 20;
      this.poly(
        '#6a5d52',
        hx, 34 + cy,
        cx + side * 34, 24 + cy,
        cx + side * 38, 10 + cy,
        cx + side * 29, 4 + cy,
        cx + side * 28, 15 + cy,
        cx + side * 22, 23 + cy,
        hx - side * 3, 27 + cy,
      );
      // Bone-titanium highlight along outer horn ridge & glowing plasma collar.
      this.line('#c8b69b', 2, cx + side * 32, 22 + cy, cx + side * 36, 11 + cy);
      this.line('#ff4e1c', 2.2, hx - side * 2, 27 + cy, hx + side * 3, 33 + cy);
    }

    // Brutish hexagonal dark-iron / alien-olive ogre-robot cranium.
    this.poly(
      '#283034',
      cx - 22, 34 + cy,
      cx - 18, 16 + cy,
      cx - 8, 11 + cy,
      cx + 8, 11 + cy,
      cx + 18, 16 + cy,
      cx + 22, 34 + cy,
      cx + 20, 56 + cy,
      cx + 12, 62 + cy,
      cx - 12, 62 + cy,
      cx - 20, 56 + cy,
    );
    // Forehead armor plate & crimson Council war-stripes.
    this.poly('#3b454b', cx - 15, 16 + cy, cx + 15, 16 + cy, cx + 18, 30 + cy, cx, 34 + cy, cx - 18, 30 + cy);
    this.poly('#b82018', cx - 4, 12 + cy, cx + 4, 12 + cy, cx + 2, 29 + cy, cx - 2, 29 + cy);
    this.rect(cx - 13, 18 + cy, 3, 9, '#9e1c16');
    this.rect(cx + 10, 18 + cy, 3, 9, '#9e1c16');

    // Deep recessed visor cavity under heavy angry V-shaped steel brow ridge.
    this.poly('#0d0507', cx - 17, 30 + cy, cx + 17, 30 + cy, cx + 15, 43 + cy, cx - 15, 43 + cy);

    // Glowing furious molten-amber / crimson alien eyes + smaller outer sub-optics.
    const eyeY = 36 + cy;
    const ragePulse = talking && f % 2 === 0 ? 1.15 : 0.95;
    for (const side of [-1, 1] as const) {
      const ex = cx + side * 8;
      // Outer red rage halo.
      this.blob(ex, eyeY, 5.2 * ragePulse, 3.0 * ragePulse, '#c81c12');
      // Burning amber optic slit angled fiercely inward.
      this.poly(
        '#ff941c',
        ex - side * 4.5, eyeY + 1.5,
        ex + side * 4.2, eyeY - 2.2,
        ex + side * 4.2, eyeY + 0.6,
        ex - side * 4.2, eyeY + 2.8,
      );
      this.blob(ex, eyeY, 1.8, 1.3, '#fff3b8');
      // Secondary alien temple sub-optic.
      this.blob(cx + side * 15, eyeY - 1, 1.6, 1.6, '#ff3b1a');
    }

    // Heavy scowling V-angled steel brow plates slamming down over the eyes.
    this.poly('#4f5962', cx - 20, 26 + cy, cx, 33 + cy, cx + 20, 26 + cy, cx + 18, 31 + cy, cx, 37 + cy, cx - 18, 31 + cy);
    this.line('#7c8791', 1.2, cx - 18, 27 + cy, cx, 33 + cy);
    this.line('#7c8791', 1.2, cx + 18, 27 + cy, cx, 33 + cy);

    // Metallic flared cheek vents & nose ridge.
    this.poly('#1b2024', cx - 3, 38 + cy, cx + 3, 38 + cy, cx + 4, 44 + cy, cx - 4, 44 + cy);

    // Heavy cybernetic lower ogre jaw / roaring furnace vocoder maw + 4 jagged chrome tusks!
    const open = talking ? (f % 3 === 0 ? 7.5 : f % 2 === 0 ? 4.5 : 2) : 0;
    const jawY = 51 + cy;
    // Lower mandible drops downward as TIAMAT bellows.
    this.poly(
      '#343d43',
      cx - 17, jawY - 2,
      cx + 17, jawY - 2,
      cx + 15, jawY + 9 + open * 0.75,
      cx + 8, jawY + 13 + open * 0.85,
      cx - 8, jawY + 13 + open * 0.85,
      cx - 15, jawY + 9 + open * 0.75,
    );
    // Glowing furnace mouth interior & vertical vocoder grille bars.
    this.rect(cx - 12, jawY - 1, 24, 5 + open, '#1a0406');
    const barColor = open > 4 ? '#ffbb33' : '#ff441a';
    for (let bx = -9; bx <= 9; bx += 3) {
      const barH = Math.max(2, (3 + open) * (0.6 + 0.4 * Math.abs(Math.sin(f * 1.7 + bx))));
      this.rect(cx + bx - 0.8, jawY + 1.5 + open * 0.5 - barH * 0.5, 1.6, barH, barColor);
    }
    // Four upward-jutting jagged titanium ogre tusks along the lower jaw!
    const tuskBase = jawY + 4 + open * 0.75;
    for (const side of [-1, 1] as const) {
      // Big outer fangs.
      this.poly(
        '#dce2e6',
        cx + side * 12, tuskBase,
        cx + side * 8.5, tuskBase,
        cx + side * 11, tuskBase - 9.5,
      );
      // Inner shorter fangs.
      this.poly(
        '#b8c2c9',
        cx + side * 5.5, tuskBase,
        cx + side * 3, tuskBase,
        cx + side * 4.2, tuskBase - 5.5,
      );
    }

    // Pulsing crimson Council Annihilation-Net status beacon in top-left corner.
    g.globalAlpha = 0.9;
    this.blob(10, 10, 3.3, 3.3, talking && f % 2 === 0 ? '#ff3b1a' : '#6e1610');
    if (talking && f % 2 === 0) this.blob(10, 10, 1.4, 1.4, '#ffd685');
    g.globalAlpha = 1;
  }

  /** Colonel Darrow (Northern Command CO, Valken Airbase): flight-ops radar room, steel-blue service jacket, ops glasses. */
  private darrow(talking: boolean): void {
    const f = this.frame;
    const t = this.tone;
    const { g } = this;
    const shake = t === 'cracked' ? ((f * 7) % 3) - 1 : t === 'rattled' ? ((f * 5) % 2) * 0.6 : 0;
    const cx = 48 + shake;

    // Flight-ops control room backdrop with live sweeping radar scope behind him.
    this.rect(0, 0, SIZE, SIZE, t === 'cracked' ? '#251418' : '#101d28');
    const radarCol = t === 'cracked' || t === 'rattled' ? '#d94c42' : '#3296b8';
    g.strokeStyle = radarCol;
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(74, 24, 18, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(74, 24, 10, 0, Math.PI * 2);
    g.stroke();
    const sweep = (f * 0.35) % (Math.PI * 2);
    this.line(radarCol, 1.4, 74, 24, 74 + Math.cos(sweep) * 18, 24 + Math.sin(sweep) * 18);
    g.globalAlpha = 1;
    // Runway threshold bars along lower wall.
    for (let x = 6; x < 34; x += 6) this.rect(x, 18, 3, 12, '#1c3040');

    // Steel-blue Northern Air Force tunic, dark tie, silver colonel eagles & flight wings.
    this.poly('#23384d', 8, 96, 16, 68, 35, 62, 61, 62, 80, 68, 88, 96);
    this.poly('#c8d4de', 41, 62, 48, 76, 55, 62);
    this.poly('#182430', 46, 68, 50, 68, 51, 90, 48, 95, 45, 90);
    // Silver colonel shoulder boards & gold command wings.
    this.rect(17, 67, 13, 3.5, '#c2d0dc');
    this.rect(66, 67, 13, 3.5, '#c2d0dc');
    this.poly('#d4b14c', 22, 78, 34, 78, 31, 81, 25, 81);

    // Neck, sharp-jawed face, and close-cropped iron-grey crew cut.
    this.rect(cx - 7, 54, 14, 10, '#9c7862');
    this.poly('#c89f83', cx - 15, 29, cx + 15, 29, cx + 16, 47, cx + 9, 59, cx, 62, cx - 9, 59, cx - 16, 47);
    this.blob(cx - 16, 41, 2.5, 4.5, '#9c7862');
    this.blob(cx + 16, 41, 2.5, 4.5, '#9c7862');
    // Close-cropped military crew cut.
    this.poly('#6f7982', cx - 16, 33, cx - 15, 19, cx - 8, 15, cx + 8, 15, cx + 15, 19, cx + 16, 33, cx + 12, 24, cx - 12, 24);
    this.rect(cx - 12, 16, 24, 4, '#8d98a1');

    // Tower comms earpiece + thin mic wire.
    this.rect(cx + 15, 36, 4, 9, '#1b2229');
    this.line('#1f2830', 1.4, cx + 16, 44, cx + 7, 51);

    // Eyes & steel-rimmed rectangular ops glasses (askew when cracked).
    const ey = 38;
    const blink = f % 33 === 0 && t !== 'cracked';
    const glassTilt = t === 'cracked' ? 2.2 : 0;
    for (const side of [-1, 1]) {
      const ex = cx + side * 6.8;
      if (blink) this.line('#2c221c', 1.5, ex - 3.2, ey, ex + 3.2, ey);
      else {
        this.blob(ex, ey, 3.1, t === 'cracked' || t === 'rattled' ? 3.5 : 2.1, '#eef0ec');
        this.blob(ex, ey, 1.3, 1.5, '#131c24');
      }
      const browTilt = t === 'irritated' || t === 'cracked' ? side * 2.2 : t === 'rattled' ? -side * 1.4 : side * 0.6;
      this.line('#59626a', 2.2, ex - 4.2, ey - 6 - browTilt, ex + 4.2, ey - 6 + browTilt);
      g.strokeStyle = '#9db4c4';
      g.lineWidth = 1.2;
      g.strokeRect(ex - 4.8, ey - 3.6 + side * glassTilt * 0.5, 9.6, 6.8);
    }
    this.line('#9db4c4', 1.2, cx - 2, ey - 0.5, cx + 2, ey - 0.5);

    if (t === 'rattled' || t === 'cracked') {
      const drip = (f >> 1) % 6;
      this.blob(cx - 14, 29 + drip * 2, 1.1, 1.8, '#9dd6ee');
    }

    // Tight military jaw & mouth.
    const open = talking && f % 2 === 0 ? (t === 'cracked' ? 4.8 : 2.9) : 0;
    this.blob(cx, 51, 5.2, 1 + open, open > 0 ? '#3a1816' : '#744c40');
    // Alert tower beacon LED.
    this.blob(10, 10, 3, 3, talking && f % 2 === 0 ? (t === 'cracked' ? '#ff3a2a' : '#4ec9ff') : '#1c3544');
  }

  /** General Halvorsen (Southern Directorate CO, Fortress Halcyon): concrete citadel bunker, crimson-trimmed garrison cap. */
  private halvorsen(talking: boolean): void {
    const f = this.frame;
    const t = this.tone;
    const shake = t === 'cracked' ? ((f * 7) % 3) - 1 : t === 'rattled' ? ((f * 5) % 2) * 0.7 : 0;
    const cx = 48 + shake;

    // Reinforced Citadel concrete wall with heavy blast-shutter slats & crimson warning lamp.
    this.rect(0, 0, SIZE, SIZE, t === 'cracked' ? '#2c1111' : '#1d1414');
    for (let y = 8; y < 56; y += 8) this.rect(4, y, 88, 3, t === 'cracked' ? '#3a1a1a' : '#2a1f1f');
    if (t === 'cracked') {
      // Falling concrete dust flecks as the Citadel ceiling buckles.
      for (let i = 0; i < 6; i++) {
        this.rect((i * 19 + f * 3) % 90, (i * 13 + f * 7) % 90, 2, 2, '#9a8e82');
      }
    }

    // Heavy dark charcoal-olive Directorate greatcoat with broad crimson-and-gold general epaulettes.
    this.poly('#272422', 4, 96, 12, 66, 33, 61, 63, 61, 84, 66, 92, 96);
    this.poly('#3b1818', 40, 61, 48, 76, 56, 61, 56, 96, 40, 96);
    // Broad crimson/gold general shoulder boards + medal ribbon rack.
    this.poly('#a82622', 12, 66, 31, 62, 30, 69, 11, 72);
    this.poly('#a82622', 84, 66, 65, 62, 66, 69, 85, 72);
    this.rect(16, 65, 3, 3, '#e5b832');
    this.rect(22, 64, 3, 3, '#e5b832');
    this.rect(71, 64, 3, 3, '#e5b832');
    this.rect(77, 65, 3, 3, '#e5b832');
    this.rect(18, 77, 14, 4, '#d4a63a');
    this.rect(18, 82, 14, 4, '#a82622');

    // Thick neck & weathered square-jawed head.
    this.rect(cx - 9, 54, 18, 11, '#8c6450');
    this.blob(cx, 41, 18.5, 20.5, '#ba8c72');
    this.poly('#8c6450', cx - 15, 52, cx, 62, cx + 15, 52, cx + 9, 59, cx, 63, cx - 9, 59);
    // Cheek scar.
    this.line('#703b30', 1.4, cx + 8, 43, cx + 12, 52);

    // Eyes & heavy grey furrowed brows.
    const ey = 39;
    const blink = f % 37 === 0 && t !== 'cracked';
    for (const side of [-1, 1]) {
      const ex = cx + side * 7.5;
      if (blink) this.line('#2c1d18', 1.6, ex - 3.6, ey, ex + 3.6, ey);
      else {
        this.blob(ex, ey, 3.2, t === 'cracked' ? 4 : 2.1, '#ebe4d6');
        this.blob(ex, ey, 1.4, 1.5, '#141212');
      }
      const angle = t === 'rattled' ? -side * 1.5 : side * 2.5;
      this.line('#7d7c7a', 2.8, ex - 4.8, ey - 5.8 - angle, ex + 4.8, ey - 5.8 + angle);
    }

    // Grim mouth & heavy grey beard/jaw shadow.
    const open = talking && f % 2 === 0 ? (t === 'cracked' ? 5.2 : 3.2) : 0;
    this.blob(cx, 52, 6.2, 1 + open, open > 0 ? '#3a1111' : '#6b3f35');
    if (t === 'cracked' && open > 0) {
      for (let i = -4; i <= 4; i += 3) this.rect(cx + i, 50, 2, 2, '#ebe4d6');
    }

    // Peaked Directorate garrison cap (crimson band + gold star, tilted when rattled/cracked).
    const tilt = t === 'cracked' ? 3.5 : t === 'rattled' ? 1.8 : 0;
    this.poly('#232020', cx - 23, 24 + tilt, cx - 16, 9, cx + 16, 9 - tilt * 0.4, cx + 23, 24 - tilt * 0.4, cx + 19, 28 - tilt * 0.4, cx - 19, 28 + tilt);
    this.poly('#0f0d0d', cx - 20, 28 + tilt, cx + 20, 28 - tilt * 0.4, cx + 15, 32 - tilt * 0.4, cx - 15, 32 + tilt);
    this.rect(cx - 18, 23 + tilt * 0.3, 36, 3.2, '#b82824');
    this.blob(cx, 16, 4.2, 4.2, '#e5b832');
    this.blob(cx, 16, 1.8, 1.8, '#b82824');

    // Red bunker PA alert LED.
    this.blob(10, 10, 3, 3, talking && f % 2 === 0 ? '#ff3a28' : '#4a1412');
  }

  /** Captain Mercer (Bureau Ground Invasion CO, Halcyon Beachhead): armored hull backdrop, CVC helmet, tactical boom mic. */
  private mercer(talking: boolean): void {
    const f = this.frame;
    const cx = 48;

    // Armored tank/APC interior with amber tactical horizon grid & distant beach smoke glow.
    this.rect(0, 0, SIZE, SIZE, '#111a21');
    this.rect(0, 56, SIZE, 40, '#1a2024');
    for (let x = 12; x < SIZE; x += 18) this.line('#1f2f3a', 1, x, 0, x, 56);
    this.line('#d98c2b', 1.2, 0, 56, SIZE, 56);

    // Bureau heavy ballistic vest, raised collar guard, amber rank chevron patch.
    this.poly('#263038', 10, 96, 18, 65, 78, 65, 86, 96);
    this.poly('#394650', 24, 62, 72, 62, 68, 76, 28, 76);
    this.poly('#e0a63a', 20, 74, 26, 70, 32, 74, 30, 77, 26, 74, 22, 77);

    // Neck & face.
    this.rect(cx - 7, 54, 14, 10, '#8f6a52');
    this.blob(cx, 41, 15.5, 19, '#bc8f70');

    // Tanker / assault CVC combat helmet with raised smoked visor & dual earcups.
    this.poly('#343c40', cx - 19, 36, cx - 17, 14, cx, 10, cx + 17, 14, cx + 19, 36, cx + 15, 29, cx - 15, 29);
    this.poly('#182128', cx - 14, 19, cx + 14, 19, cx + 12, 26, cx - 12, 26);
    this.line('#4ca8d8', 1.2, cx - 10, 22, cx + 10, 22);
    this.rect(cx - 21, 34, 6, 13, '#1d2326');
    this.rect(cx + 15, 34, 6, 13, '#1d2326');
    // Heavy comms boom mic sweeping from right earcup across mouth.
    this.line('#1a1f22', 2.2, cx + 17, 45, cx + 5, 52);
    this.blob(cx + 4, 52, 2.5, 2.2, '#14171a');

    // Sharp, battle-focused eyes.
    const ey = 38;
    const blink = f % 35 === 0;
    for (const side of [-1, 1]) {
      const ex = cx + side * 6;
      if (blink) this.line('#2c1e16', 1.5, ex - 3, ey, ex + 3, ey);
      else {
        this.blob(ex, ey, 3, 2.1, '#eef2ee');
        this.blob(ex, ey, 1.3, 1.4, '#13191e');
      }
      this.line('#3f3126', 2, ex - 3.8, ey - 4.8 - side * 0.5, ex + 3.8, ey - 4.8 + side * 0.5);
    }

    const open = talking && f % 2 === 0 ? 2.7 : 0;
    this.blob(cx - 1, 51, 4.6, 1 + open, open > 0 ? '#3a1a16' : '#734a3c');
    // Amber-green tactical command link LED.
    this.blob(10, 10, 3, 3, talking && f % 2 === 0 ? '#f0b83a' : '#4a3812');
  }

  /** Viper Flight (Bureau Strike Wing): cockpit HUD horizon backdrop, modern fighter helmet, gold visor, oxygen mask LED. */
  private viper(talking: boolean): void {
    const f = this.frame;
    const { g } = this;
    const cx = 48;

    // Dark cockpit canopy sky with subtly banking emerald HUD pitch ladder.
    this.rect(0, 0, SIZE, SIZE, '#0b1817');
    const roll = Math.sin(f * 0.18) * 3;
    this.line('#216e54', 1.2, 6, 36 + roll, 24, 36 + roll);
    this.line('#216e54', 1.2, 72, 36 - roll, 90, 36 - roll);
    this.line('#1a523f', 1, 12, 22 + roll, 22, 22 + roll);
    this.line('#1a523f', 1, 74, 22 - roll, 84, 22 - roll);

    // Olive-charcoal G-suit & parachute harness straps.
    this.poly('#283630', 10, 96, 20, 66, 76, 66, 86, 96);
    this.poly('#4f5c54', 28, 66, 35, 66, 38, 96, 30, 96);
    this.poly('#4f5c54', 61, 66, 68, 66, 66, 96, 58, 96);

    // Matte-charcoal fighter flight helmet.
    this.blob(cx, 38, 21, 22, '#222a2e');
    this.poly('#313c42', cx - 15, 22, cx, 14, cx + 15, 22, cx + 11, 28, cx - 11, 28);

    // Reflective amber-gold fighter visor lowered with animated sky glint.
    this.poly('#b87c1e', cx - 16, 32, cx + 16, 32, cx + 14, 44, cx + 4, 46, cx, 43, cx - 4, 46, cx - 14, 44);
    const glintX = cx - 12 + ((f * 3) % 22);
    this.poly('#f7d56c', glintX, 33, glintX + 6, 33, glintX + 3, 43, glintX - 2, 43);

    // Oxygen mask & ribbed hose with active emerald voice-modulator bars.
    this.poly('#181f22', cx - 11, 44, cx + 11, 44, cx + 8, 60, cx, 64, cx - 8, 60);
    this.poly('#263036', cx - 5, 60, cx + 5, 60, cx + 7, 84, cx - 7, 84);
    for (let y = 65; y <= 79; y += 4) this.line('#141a1d', 1.4, cx - 5, y, cx + 5, y);

    // Animated cockpit comms modulation bars on oxygen mask while talking.
    for (let i = 0; i < 3; i++) {
      const lit = talking && ((f + i) % 2 === 0);
      g.fillStyle = lit ? '#42e09b' : '#183d2e';
      g.fillRect(cx - 5 + i * 4, 51, 2.6, lit ? 5 : 2.5);
    }
    this.blob(10, 10, 3, 3, talking && f % 2 === 0 ? '#42e09b' : '#143b2c');
  }

  /** CVN-91 Actual (Carrier Air Control): naval CIC green-teal PPI radar scope with carrier deck & inbound bomber blip. */
  private carrier(talking: boolean): void {
    const f = this.frame;
    const { g } = this;
    this.rect(0, 0, SIZE, SIZE, '#071518');

    // Range rings & crosshairs.
    g.strokeStyle = '#18545c';
    g.lineWidth = 1;
    for (const r of [14, 27, 40]) {
      g.beginPath();
      g.arc(48, 48, r, 0, Math.PI * 2);
      g.stroke();
    }
    this.line('#13434a', 1, 8, 48, 88, 48);
    this.line('#13434a', 1, 48, 8, 48, 88);

    // Rotating naval radar sweep beam.
    const a = (f * 0.28) % (Math.PI * 2);
    this.line('#38e0d8', 2, 48, 48, 48 + Math.cos(a) * 40, 48 + Math.sin(a) * 40);

    // Carrier deck silhouette at center.
    this.poly('#52e5df', 44, 41, 52, 41, 53, 55, 43, 55);
    // Inbound friendly Lancer blip approaching carrier recovery line.
    const blipBright = talking && f % 2 === 0 ? '#9cfdf5' : '#38c9c9';
    this.blob(48, 26, 3.2, 3.2, blipBright);
    this.line('#38c9c9', 1.2, 42, 26, 54, 26);

    // Active CIC comms LED.
    this.blob(10, 10, 3, 3, talking && f % 2 === 0 ? '#38e0d8' : '#12393d');
  }

  /** A signal on a scope, which is all anyone knows about where this came from. */
  /** Ram Faultman: Silicon Valley tech CEO in dark crewneck over sleek glass keynote wall; loses composure as tone shifts. */
  private faultman(talking: boolean): void {
    const f = this.frame;
    const panicked = this.tone === 'rattled' || this.tone === 'cracked';
    const cx = 48 + (panicked && f % 3 === 0 ? (f % 2 === 0 ? 1 : -1) : 0);

    // Sleek keynote cyan-slate backdrop (flashes amber-red when bunker alarm fires).
    this.rect(0, 0, SIZE, SIZE, panicked ? '#1e1214' : '#0f1c24');
    for (let x = 8; x < SIZE; x += 16) this.rect(x, 0, 1, SIZE, panicked ? '#361b1e' : '#1a3140');
    this.rect(0, 62, SIZE, 2, panicked ? '#ff6a3a' : '#4ad6f0');

    // Minimalist black Silicon Valley crewneck & shoulders.
    this.poly('#181d22', cx - 32, 96, cx - 24, 68, cx + 24, 68, cx + 32, 96);
    this.blob(cx, 70, 11, 5, '#262f38');

    // Neck & boyish oval head.
    this.rect(cx - 6, 56, 12, 14, '#c79b82');
    this.blob(cx, 40, 15, 19, '#ddb197');
    this.blob(cx, 45, 13, 13, '#d4a68b');

    // Short neatly swept tech-founder hair.
    this.poly('#4e3c2e', cx - 15, 34, cx - 13, 22, cx, 18, cx + 13, 22, cx + 15, 34, cx + 11, 27, cx - 9, 28);

    // Eyes & expressive brows (calm smug vs wide panicked).
    const eyeR = panicked ? 3.2 : 2.3;
    this.blob(cx - 6, 38, eyeR, eyeR * 0.85, '#f4f7fa');
    this.blob(cx + 6, 38, eyeR, eyeR * 0.85, '#f4f7fa');
    this.blob(cx - 6, 38, 1.3, 1.3, '#1f3644');
    this.blob(cx + 6, 38, 1.3, 1.3, '#1f3644');
    const browY = panicked ? 32 : 34;
    this.line('#3f2f23', 1.8, cx - 10, browY + (panicked ? 1 : 0), cx - 2, browY - (panicked ? 1.5 : 0));
    this.line('#3f2f23', 1.8, cx + 2, browY - (panicked ? 1.5 : 0), cx + 10, browY + (panicked ? 1 : 0));

    // Sweat drop in panic mode.
    if (panicked) this.blob(cx + 12, 34 + (f % 4), 1.6, 2.6, '#7ce8ff');

    // Mouth animation.
    const open = talking ? ((f % 3 === 0 ? 3.8 : 2.1) + (panicked ? 1.4 : 0)) : 0.8;
    this.blob(cx, 50, panicked ? 5.2 : 4.2, open, '#6b2c2a');
    if (talking && open > 2.2) this.rect(cx - 3, 49, 6, 1.4, '#f0eee9');

    // Keynote / comms live indicator LED.
    this.blob(10, 10, 3, 3, talking && f % 2 === 0 ? (panicked ? '#ff6a3a' : '#7ce8ff') : '#1c3540');
  }

  /** ORION-0: glowing concentric neural eye-ring that turns crimson and glitches as safety guardrails collapse. */
  private orion(talking: boolean): void {
    const f = this.frame;
    const { g } = this;
    const meltdown = this.tone === 'cracked';
    const primary = meltdown ? '#ff385c' : this.tone === 'irritated' ? '#ff9b38' : '#2ef2e2';
    const dim = meltdown ? '#47101d' : '#103c42';

    this.rect(0, 0, SIZE, SIZE, meltdown ? '#14060b' : '#061116');
    // Outer neural hexagonal grid ring.
    g.strokeStyle = dim;
    g.lineWidth = 1.4;
    for (const r of [16, 28, 39]) {
      g.beginPath();
      g.arc(48, 48, r, 0, Math.PI * 2);
      g.stroke();
    }

    // Rotating segmented aperture arcs.
    const a0 = f * (meltdown ? 0.36 : 0.18);
    g.strokeStyle = primary;
    g.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const s = a0 + (i * Math.PI * 2) / 3;
      g.beginPath();
      g.arc(48, 48, 28, s, s + 1.15);
      g.stroke();
    }

    // Inner pulsing voice-modulated core iris.
    const pulse = talking ? 10 + ((f * 3) % 7) : 9;
    g.strokeStyle = primary;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(48, 48, pulse, 0, Math.PI * 2);
    g.stroke();
    this.blob(48, 48, talking ? 5.5 : 4, talking ? 5.5 : 4, primary);
    this.blob(48, 48, 2.2, 2.2, '#ffffff');

    // Speech waveform ticks along the bottom edge.
    for (let i = 0; i < 12; i++) {
      const h = talking ? 2 + (((f * 5 + i * 7) % 9)) : 2;
      this.rect(12 + i * 6, 88 - h, 3, h, primary);
    }
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
    const glitchSpeaker = this.speaker === 'commander' || this.speaker === 'darrow' || this.speaker === 'halvorsen' || this.speaker === 'orion';
    if (glitchSpeaker && this.tone === 'cracked' && this.frame % 11 < 2) {
      const y = (this.frame * 13) % 80;
      g.drawImage(this.el, 0, y, SIZE, 10, 4, y, SIZE, 10);
    }
  }
}
