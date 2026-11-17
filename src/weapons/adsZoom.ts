import { clamp, smoothstep } from '../core/math';

/**
 * Hold your breath: aimed down sights or scoped, holding the dash key zooms further in place of a dash. One breath holds
 * `hold` seconds and then eases out by itself; a cooldown follows before the next. Letting go early costs the same share of
 * the cooldown as of the breath used, so a quick peek is cheap. Purely the local view: nothing here is sent in co-op, and
 * it never touches the clock, so the Focus brain chip's co-op rule does not reach it. No sway: the gun is as still as ever.
 */
export const ADS_ZOOM = {
  /** Magnification over the aim as it stands, sights or scope, in tan terms as a scope magnifies. */
  factor: 1.5,
  /** Seconds to ease in, and out. */
  ease: 0.15,
  /** Seconds one breath lasts before it eases out on its own. */
  hold: 3.5,
  /** Seconds before the next breath after a full one. */
  cooldown: 2.5,
  /** The narrowest view it reaches, degrees: 12x the 90-degree hip view, so the Awl's 8x scope tops out at 12x. */
  minFov: (2 * Math.atan(1 / 12) * 180) / Math.PI,
  /** "Hold [key] to focus": until the player has used it this many times, and on no more aims than this. */
  hintUses: 3,
  hintShows: 8,
} as const;

const DEG = Math.PI / 180;
const STORE = 'op2_adsZoom';

/** `fov` narrowed `mag` times in tan terms, never past the cap (and never widened, should `fov` already be past it). */
export function adsZoomFov(fov: number, mag: number): number {
  if (mag <= 1) return fov;
  const narrow = (2 * Math.atan(Math.tan((fov * DEG) / 2) / mag)) / DEG;
  return Math.max(narrow, Math.min(fov, ADS_ZOOM.minFov));
}

/** What the "Hold to focus" hint has seen, kept across runs. */
function load(): { uses: number; shows: number } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { uses?: unknown; shows?: unknown };
    return { uses: typeof v.uses === 'number' ? v.uses : 0, shows: typeof v.shows === 'number' ? v.shows : 0 };
  } catch {
    return { uses: 0, shows: 0 };
  }
}

export class AdsZoom {
  /** Seconds into this breath while `on`. */
  held = 0;
  /** Seconds of cooldown left, out of `coolFrom`. */
  cool = 0;
  on = false;
  /** Aimed this frame: the HUD shows the bar and the hint only then. */
  aimed = false;
  private coolFrom = 0;
  /** 0..1 linear through the ease. */
  private t = 0;
  /** The key is still down from a breath that ended: it has to come up before the next. */
  private latch = false;
  private readonly seen = load();

  update(dt: number, aimed: boolean, key: boolean): void {
    // Counted as an aim starts: the aim that takes it past `hintShows` is the first without it.
    if (aimed && !this.aimed && this.hint) this.save('shows');
    this.aimed = aimed;
    this.cool = Math.max(0, this.cool - dt);
    if (!key) this.latch = false;
    const wants = aimed && key;
    if (this.on) {
      this.held += dt;
      if (!wants || this.held >= ADS_ZOOM.hold) {
        this.on = false;
        this.latch = wants;
        this.cool = this.coolFrom = ADS_ZOOM.cooldown * Math.min(1, this.held / ADS_ZOOM.hold);
      }
    } else if (wants && !this.latch && this.cool <= 0) {
      this.on = true;
      this.held = 0;
      this.save('uses');
    }
    this.t = clamp(this.t + (this.on ? dt : -dt) / ADS_ZOOM.ease);
  }

  reset(): void {
    this.on = this.aimed = this.latch = false;
    this.held = this.cool = this.coolFrom = this.t = 0;
  }

  /** The extra magnification, eased: 1 off, `factor` fully in. */
  get mag(): number {
    return 1 + (ADS_ZOOM.factor - 1) * smoothstep(0, 1, this.t);
  }

  /** The bar: breath left while on, the cooldown refilling after. */
  get breath(): number {
    if (this.on) return 1 - this.held / ADS_ZOOM.hold;
    return this.coolFrom > 0 ? 1 - this.cool / this.coolFrom : 1;
  }

  get hint(): boolean {
    return this.seen.uses < ADS_ZOOM.hintUses && this.seen.shows <= ADS_ZOOM.hintShows;
  }

  private save(what: 'uses' | 'shows'): void {
    this.seen[what]++;
    try {
      localStorage.setItem(STORE, JSON.stringify(this.seen));
    } catch {
      // Private mode or no storage: the hint just counts for this session.
    }
  }
}
