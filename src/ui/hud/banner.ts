/**
 * Two lanes of announcement.
 *  - The band: full-bleed plate for waves, bosses and death. It lands on the stinger's first sample, with a white
 *    frame on top, because a stinger has no attack and neither should its picture.
 *  - Stamps: compact plates under the band for perk and call-in announcements. They stack, which fixes the first
 *    game's popups landing on top of each other.
 */
import { COLLAPSE, div, span } from '../dom';

export type BandKind = 'wave' | 'hard' | 'clear' | 'boss' | 'dead';

const BAND_HOLD: Record<BandKind, number> = { wave: 1.7, hard: 1.9, clear: 1.5, boss: 2.6, dead: 1.6 };
const BAND_LEAVE = 0.13;
const MAX_STAMPS = 3;
const STAMP_LIFE = 1.9;
const STAMP_LEAVE = 0.1;

interface Stamp {
  el: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  life: number;
  live: boolean;
  leaving: boolean;
  key: string;
}

export class Banner {
  readonly el: HTMLElement;
  private band: HTMLElement;
  private flash: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private bandLife = 0;
  private bandKind: BandKind = 'wave';
  private bandLeaving = false;
  private lastBand = '';
  private stampHost: HTMLElement;
  private stamps: Stamp[] = [];

  constructor() {
    this.title = span('band-t');
    this.sub = span('band-s');
    this.flash = div('band-flash');
    this.band = div('band', div('band-in', this.title, this.sub), this.flash);
    this.band.style.display = 'none';
    this.stampHost = div('stamps');
    for (let i = 0; i < MAX_STAMPS; i++) {
      const title = span('st-t');
      const sub = span('st-s');
      const el = div('stamp', title, sub);
      el.style.display = 'none';
      this.stamps.push({ el, title, sub, life: 0, live: false, leaving: false, key: '' });
    }
    this.el = div('banners', this.band, this.stampHost);
  }

  showBand(kind: BandKind, text: string, sub = '', color?: string): void {
    // Events and direct calls can both announce the same wave; the second one must not restart the slam.
    if (text === this.lastBand && this.bandLife > 0) return;
    this.lastBand = text;
    this.bandKind = kind;
    this.bandLife = BAND_HOLD[kind];
    this.bandLeaving = false;
    this.title.textContent = text;
    this.sub.textContent = sub;
    this.band.className = `band band-${kind}`;
    if (color) this.band.style.setProperty('--c', color);
    else this.band.style.removeProperty('--c');
    this.band.style.display = '';
    this.band.animate(
      [{ transform: 'scaleX(1.06) scaleY(1.5)', easing: 'cubic-bezier(.08,.9,.2,1)' }, { transform: 'none' }],
      200,
    );
    this.flash.animate([{ opacity: 1 }, { opacity: 0 }], 170);
  }

  stamp(text: string, sub = '', color?: string): void {
    for (const s of this.stamps) if (s.live && s.key === text && !s.leaving) return;
    const stamp = this.stamps.find(s => !s.live) ?? this.oldestStamp();
    stamp.live = true;
    stamp.leaving = false;
    stamp.life = STAMP_LIFE;
    stamp.key = text;
    stamp.title.textContent = text;
    stamp.sub.textContent = sub;
    stamp.el.style.setProperty('--c', color ?? 'var(--ink)');
    stamp.el.style.display = '';
    this.stampHost.append(stamp.el);
    stamp.el.animate(
      [{ transform: 'scale(1.5)', easing: 'cubic-bezier(.08,.9,.2,1)' }, { transform: 'none' }],
      170,
    );
  }

  private oldestStamp(): Stamp {
    let oldest = this.stamps[0]!;
    for (const s of this.stamps) if (s.life < oldest.life) oldest = s;
    return oldest;
  }

  update(dt: number): void {
    if (this.bandLife > 0) {
      this.bandLife -= dt;
      if (!this.bandLeaving && this.bandLife <= BAND_LEAVE) {
        this.bandLeaving = true;
        this.band.animate(COLLAPSE as unknown as Keyframe[], BAND_LEAVE * 1000);
      }
      if (this.bandLife <= 0) this.band.style.display = 'none';
    }
    for (const s of this.stamps) {
      if (!s.live) continue;
      s.life -= dt;
      if (!s.leaving && s.life <= STAMP_LEAVE) {
        s.leaving = true;
        s.el.animate(COLLAPSE as unknown as Keyframe[], STAMP_LEAVE * 1000);
      }
      if (s.life <= 0) {
        s.live = false;
        s.el.style.display = 'none';
        s.el.remove();
      }
    }
  }

  reset(): void {
    this.bandLife = 0;
    this.band.style.display = 'none';
    this.lastBand = '';
    for (const s of this.stamps) {
      s.live = false;
      s.el.style.display = 'none';
      s.el.remove();
    }
  }
}
