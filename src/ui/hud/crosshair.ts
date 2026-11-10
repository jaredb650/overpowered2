/**
 * Crosshair per weapon, hit markers, damage arcs and the two ticks that flank the reticle.
 *
 * Everything that moves here is a transform on a small element. Arms sit in four wrappers shared by all weapons;
 * a weapon switch swaps their markup, and spread only ever writes four translates.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { WeaponId } from '../../core/gameplay';
import { clamp, damp, wrapAngle } from '../../core/math';
import { Flag, Label, Meter, Shown, div, markup, span } from '../dom';
import type { HudState } from '../state';
import { LockMarkers } from './locks';

const poly = (pts: string) => `<polygon points="${pts}"/>`;
/** Rotates one arm around the centre so a shape is only drawn once. */
const turned = (shape: string, deg: number) => (deg ? `<g transform="rotate(${deg})">${shape}</g>` : shape);

interface Reticle {
  core: string;
  /** Shapes for N, E, S, W, or NE, SE, SW, NW when `diagonal`. */
  arms: readonly [string, string, string, string];
  diagonal?: boolean;
  /** Arm offset at rest, in reticle units (1 unit is 1 px at 1080p). */
  gap: number;
  /** Added per shot, then decays. */
  kick: number;
  /** Extra offset at SPEED_FULL, so the reticle breathes with speed without lying about accuracy. */
  speedGap: number;
  /** Arms spin with the charge value. */
  spins?: boolean;
  /** Reticle draws the real pellet cone instead of a fixed gap. */
  trueCone?: boolean;
}

const tick = (len: number, w: number, r = 0) => poly(`${-w},${-r - len} ${w},${-r - len} ${w},${-r} ${-w},${-r}`);
const four = (shape: string) => [turned(shape, 0), turned(shape, 90), turned(shape, 180), turned(shape, 270)] as const;
const DOT = '<rect x="-1.6" y="-1.6" width="3.2" height="3.2"/>';
const DIAMOND = poly('0,-3.2 3.2,0 0,3.2 -3.2,0');

const ARC_E = poly('23,-17 26,-18.5 31,-9 32.4,0 31,9 26,18.5 23,17 27.6,8.6 29,0 27.6,-8.6');
const ARC_W = turned(ARC_E, 180);

const RETICLES: Record<WeaponId, Reticle> = {
  // Pixel-accurate, so the tightest reticle in the game: the gap barely moves.
  smg: { core: DOT, arms: four(tick(8, 1.25)), gap: 5, kick: 1.1, speedGap: 3 },
  // The SMG's cross with heavier, longer arms set wider: the same family, a bigger round.
  harrow: { core: DOT, arms: four(tick(11, 1.6)), gap: 8, kick: 3.2, speedGap: 3 },
  shotgun: {
    core: DOT,
    arms: four(poly('3,-14 14,-14 14,-3 11.6,-3 11.6,-11.6 3,-11.6')),
    diagonal: true, gap: 1, kick: 7, speedGap: 0, trueCone: true,
  },
  // The pump's corner brackets turned into four short bars: the same cone, a busier gun.
  thresher: {
    core: DOT,
    arms: four(poly('-1.3,-17 1.3,-17 1.3,-5 -1.3,-5')),
    diagonal: true, gap: 1, kick: 4.5, speedGap: 0, trueCone: true,
  },
  rocket: {
    core: poly('0,-7 8,3 5,5 0,-1.6 -5,5 -8,3'),
    arms: ['', poly('14,-1.25 34,-1.25 34,1.25 14,1.25'), turned(`${tick(2, 7, 12)}${tick(2, 5, 19)}${tick(2, 3, 26)}`, 180), poly('-14,-1.25 -34,-1.25 -34,1.25 -14,1.25')],
    gap: 0, kick: 6, speedGap: 2,
  },
  // A seeker's box: four corners around a dot, wide enough to read as "put them in here".
  quiver: {
    core: `${DOT}${poly('-16,-16 -9,-16 -9,-14 -14,-14 -14,-9 -16,-9')}${poly('16,-16 9,-16 9,-14 14,-14 14,-9 16,-9')}` +
      `${poly('-16,16 -9,16 -9,14 -14,14 -14,9 -16,9')}${poly('16,16 9,16 9,14 14,14 14,9 16,9')}`,
    arms: ['', poly('22,-1.25 30,-1.25 30,1.25 22,1.25'), '', poly('-22,-1.25 -30,-1.25 -30,1.25 -22,1.25')],
    gap: 0, kick: 4, speedGap: 2,
  },
  autocannon: {
    core: '<path fill-rule="evenodd" d="M-5 -5H5V5H-5Z M-3 -3V3H3V-3Z"/>',
    arms: ['', poly('10,-1.5 40,-1.5 40,1.5 10,1.5'), turned(tick(10, 1.5, 10), 180), poly('-10,-1.5 -40,-1.5 -40,1.5 -10,1.5')],
    gap: 0, kick: 8, speedGap: 2,
  },
  // The autocannon's frame with the box opened into a pair of brackets: nothing to blast, only a line to thread.
  sabot: {
    core: `${DOT}${poly('-7,-7 -3,-7 -3,-5.4 -5.4,-5.4 -5.4,5.4 -3,5.4 -3,7 -7,7')}${poly('7,-7 3,-7 3,-5.4 5.4,-5.4 5.4,5.4 3,5.4 3,7 7,7')}`,
    arms: [tick(26, 0.9, 12), poly('12,-1.5 40,-1.5 40,1.5 12,1.5'), turned(tick(26, 0.9, 12), 180), poly('-12,-1.5 -40,-1.5 -40,1.5 -12,1.5')],
    gap: 0, kick: 9, speedGap: 2,
  },
  sword: { core: DIAMOND, arms: ['', ARC_E, '', ARC_W], gap: 0, kick: 0, speedGap: 0 },
  // Key 5's family: the sword's arcs, closer in for the short ones, wider for the spade's swing.
  knife: { core: DIAMOND, arms: ['', ARC_E, '', ARC_W], gap: -9, kick: 0, speedGap: 0 },
  crowbar: { core: DIAMOND, arms: ['', ARC_E, '', ARC_W], gap: -4, kick: 0, speedGap: 0 },
  shovel: { core: DIAMOND, arms: ['', ARC_E, '', ARC_W], gap: 5, kick: 0, speedGap: 0 },
  baton: { core: DOT, arms: ['', ARC_E, '', ARC_W], gap: -6, kick: 0, speedGap: 0 },
  judge: {
    core: `${DOT}<path fill-rule="evenodd" d="M0 -13L11.5 7H-11.5Z M0 -8.4L-7.4 4.6H7.4Z"/>`,
    arms: ['', poly('17,-1.25 27,-1.25 27,1.25 17,1.25'), turned(tick(10, 1.25, 11), 180), poly('-17,-1.25 -27,-1.25 -27,1.25 -17,1.25')],
    gap: 0, kick: 9, speedGap: 2,
  },
  // Small and open: a dot in a ring of four short ticks.
  rivet: { core: DOT, arms: four(tick(4, 1.25, 2)), gap: 5, kick: 3.6, speedGap: 2 },
  lance: {
    core: DOT,
    arms: ['', poly('9,-1 62,-1 62,1 9,1'), '', poly('-9,-1 -62,-1 -62,1 -9,1')],
    gap: 0, kick: 12, speedGap: 0,
  },
  buzzsaw: {
    core: DOT,
    arms: four(poly('-8,-17 -4,-19 4,-19 8,-17 7,-14.6 3,-16 -3,-16 -7,-14.6')),
    gap: 2, kick: 1.2, speedGap: 3, spins: true,
  },
  kiln: {
    core: DOT,
    arms: ['', poly('10,12 12.4,10.8 30,42 27.6,43.4'), '', poly('-10,12 -12.4,10.8 -30,42 -27.6,43.4')],
    gap: 0, kick: 0.6, speedGap: 2,
  },
  stakegun: {
    core: DIAMOND,
    arms: [poly('-1.25,-30 1.25,-30 1.25,-9 -1.25,-9'), poly('9,-1.25 15,-1.25 15,1.25 9,1.25'), poly('-1.25,9 1.25,9 1.25,30 -1.25,30'), poly('-9,-1.25 -15,-1.25 -15,1.25 -9,1.25')],
    gap: 0, kick: 5, speedGap: 1,
  },
};

/** About the strafing ceiling. */
const SPEED_FULL = 30;

const svgWrap = (inner: string) => `<svg class="xh-svg" viewBox="-80 -80 160 160" aria-hidden="true">${inner}</svg>`;

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const DIAGS = [[0.707, -0.707], [0.707, 0.707], [-0.707, 0.707], [-0.707, -0.707]] as const;

export type HitKind = 'body' | 'head' | 'kill' | 'armor';

const stroke = (r: number, len: number, w: number) =>
  [45, 135, 225, 315].map(a => turned(poly(`${-w},${-r - len} ${w},${-r - len} ${w},${-r} ${-w},${-r}`), a)).join('');

const HITS: Record<HitKind, { shape: string; life: number; scale: number }> = {
  body: { shape: stroke(8, 9, 1.4), life: 0.15, scale: 1.45 },
  armor: { shape: stroke(8, 7, 2.2) + '<path fill-rule="evenodd" d="M-6 -6H6V6H-6Z M-4.4 -4.4V4.4H4.4V-4.4Z" transform="rotate(45)"/>', life: 0.16, scale: 1.4 },
  head: { shape: stroke(9, 15, 2.2), life: 0.26, scale: 1.7 },
  kill: { shape: stroke(11, 22, 3.6) + poly('0,-5 5,0 0,5 -5,0'), life: 0.36, scale: 1.9 },
};

class HitMarker {
  readonly el: HTMLElement;
  private t = 0;
  private active = false;
  private q = -1;
  constructor(readonly kind: HitKind) {
    this.el = div(`hm hm-${kind}`, markup(svgWrap(HITS[kind].shape)));
    this.el.style.opacity = '0';
  }

  fire(): void {
    this.t = 0;
    this.active = true;
  }

  cut(): void {
    if (!this.active) return;
    this.active = false;
    this.el.style.opacity = '0';
  }

  update(dt: number): void {
    if (!this.active) return;
    const { life, scale } = HITS[this.kind];
    const u = this.t / life;
    this.t += dt;
    if (u >= 1) {
      this.active = false;
      this.el.style.opacity = '0';
      return;
    }
    // First frame at peak size. It snaps to rest in a quarter of its life, holds, then shrinks away.
    const s = u < 0.25 ? 1 + (scale - 1) * (1 - u / 0.25) : u < 0.65 ? 1 : 1 - ((u - 0.65) / 0.35) * 0.4;
    const q = Math.round(s * 100);
    if (q !== this.q) {
      this.q = q;
      this.el.style.transform = `scale(${q / 100})`;
    }
    this.el.style.opacity = u < 0.65 ? '1' : '0.75';
  }
}

const ARC_LIFE = 1.15;
const MAX_ARCS = 8;

class DamageArc {
  readonly el: HTMLElement;
  readonly from = new THREE.Vector3();
  life = 0;
  size = 1;
  directional = false;
  constructor() {
    this.el = div('arc', markup(`<svg viewBox="-100 -22 200 30" aria-hidden="true"><path d="M-96 2Q0 -36 96 2L84 8Q0 -18 -84 8Z"/></svg>`));
    this.el.style.opacity = '0';
  }
}

const _toSource = new THREE.Vector3();

export class Crosshair {
  readonly el: HTMLElement;
  private armsHost: HTMLElement;
  private arms: HTMLElement[] = [];
  private core: HTMLElement;
  private hits: Record<HitKind, HitMarker>;
  private arcs: DamageArc[] = [];
  private nextArc = 0;
  private weapon: WeaponId | null = null;
  private def: Reticle = RETICLES.smg;
  private bloom = 0;
  private gapQ = NaN;
  private spin = 0;
  private spinQ = NaN;
  private hide: Flag;
  private hostile: Flag;
  private comboTick: Meter;
  private comboShown: Shown;
  private magTick: Meter;
  private magShown: Shown;
  private prompt: Label;
  private promptShown: Shown;
  private charge: Meter;
  private chargeShown: Shown;
  private comboHost: HTMLElement;
  private heat = -1;
  private aimClock = 0;
  private locks: LockMarkers;

  constructor(private readonly ctx: Ctx) {
    this.armsHost = div('xh-arms');
    for (let i = 0; i < 4; i++) {
      const arm = div('xh-arm');
      this.arms.push(arm);
      this.armsHost.append(arm);
    }
    this.core = div('xh-core');
    const comboFill = div('xh-tick-fill');
    this.comboHost = div('xh-tick xh-tick-combo', comboFill);
    const magFill = div('xh-tick-fill');
    const magHost = div('xh-tick xh-tick-mag', magFill);
    const prompt = span('xh-prompt-t');
    const promptHost = div('xh-prompt', prompt);
    const chargeFill = div('xh-charge-fill');
    const chargeHost = div('xh-charge', chargeFill);

    this.hits = {
      body: new HitMarker('body'),
      armor: new HitMarker('armor'),
      head: new HitMarker('head'),
      kill: new HitMarker('kill'),
    };
    const reticle = div('xh-reticle', this.armsHost, this.core);
    this.el = div('xh',
      reticle,
      this.comboHost,
      magHost,
      chargeHost,
      promptHost,
      this.hits.body.el, this.hits.armor.el, this.hits.head.el, this.hits.kill.el,
    );
    for (let i = 0; i < MAX_ARCS; i++) {
      const arc = new DamageArc();
      this.arcs.push(arc);
      this.el.append(arc.el);
    }
    this.hide = new Flag(reticle, 'hidden');
    this.hostile = new Flag(reticle, 'hostile');
    this.comboTick = new Meter(comboFill, 'Y');
    this.comboShown = new Shown(this.comboHost);
    this.magTick = new Meter(magFill, 'Y');
    this.magShown = new Shown(magHost);
    this.prompt = new Label(prompt);
    this.promptShown = new Shown(promptHost);
    this.charge = new Meter(chargeFill);
    this.chargeShown = new Shown(chargeHost);
    this.locks = new LockMarkers(ctx);
    this.el.append(this.locks.el);
  }

  /** Reads a fired weapon: the reticle jumps on the frame of the shot. */
  fired(): void {
    this.bloom = Math.min(this.bloom + this.def.kick, 26);
  }

  hit(kind: HitKind): void {
    if (kind === 'kill') {
      this.hits.body.cut();
      this.hits.armor.cut();
    }
    this.hits[kind].fire();
  }

  damaged(amount: number, from: THREE.Vector3 | undefined): void {
    if (!from) return;
    const arc = this.arcs[this.nextArc]!;
    this.nextArc = (this.nextArc + 1) % MAX_ARCS;
    arc.from.copy(from);
    arc.life = ARC_LIFE;
    arc.size = clamp(0.75 + amount / 45, 0.75, 1.6);
    arc.directional = true;
  }

  private setWeapon(id: WeaponId): void {
    this.weapon = id;
    const def = RETICLES[id];
    this.def = def;
    this.core.replaceChildren(markup(svgWrap(def.core)));
    for (let i = 0; i < 4; i++) {
      const shape = def.arms[i]!;
      this.arms[i]!.replaceChildren(...(shape ? [markup(svgWrap(shape))] : []));
    }
    this.gapQ = NaN;
    this.bloom = 0;
  }

  /** Radius of a real cone on screen, in reticle units, from the camera's actual FOV. */
  private coneUnits(s: HudState): number {
    const fov = this.ctx.render.camera?.fov;
    if (typeof fov !== 'number' || s.spread <= 0) return 0;
    const half = Math.tan((fov * Math.PI) / 360);
    return (Math.tan(s.spread) / half) * 540;
  }

  private aimCheck(dt: number): void {
    this.aimClock -= dt;
    if (this.aimClock > 0) return;
    this.aimClock = 1 / 12;
    const { physics, player, enemies } = this.ctx;
    const hit = typeof enemies.raycast === 'function' ? enemies.raycast(player.eye, player.forward, 250) : null;
    if (!hit || hit.enemy?.alive !== true) {
      this.hostile.set(false);
      return;
    }
    // A reticle that reddens through a wall would be a wallhack.
    const wall = typeof physics.raycast === 'function' ? physics.raycast(player.eye, player.forward, hit.distance) : null;
    this.hostile.set(!wall);
  }

  update(s: HudState, dt: number, heat: number): void {
    if (s.weapon !== this.weapon) this.setWeapon(s.weapon);

    const hidden = s.scoped || s.targeting !== null;
    this.hide.set(hidden);
    this.aimCheck(dt);

    this.bloom = damp(this.bloom, 0, 13, dt);
    const d = this.def;
    const cone = d.trueCone ? this.coneUnits(s) : 0;
    const gap = d.gap + cone + this.bloom + (Math.min(s.speed, SPEED_FULL) / SPEED_FULL) * d.speedGap;
    const q = Math.round(gap * 4);
    if (q !== this.gapQ) {
      this.gapQ = q;
      const dirs = d.diagonal ? DIAGS : DIRS;
      const g = q / 4 / 16;
      for (let i = 0; i < 4; i++) {
        const [x, y] = dirs[i]!;
        this.arms[i]!.style.transform = `translate3d(${x * g}rem,${y * g}rem,0)`;
      }
    }

    if (d.spins) {
      this.spin += s.charge * 900 * dt;
      const sq = Math.round(this.spin) % 360;
      if (sq !== this.spinQ) {
        this.spinQ = sq;
        this.armsHost.style.transform = `rotate(${sq}deg)`;
      }
    } else if (this.spinQ !== 0) {
      this.spinQ = 0;
      this.armsHost.style.transform = '';
    }

    const comboLive = s.combo >= 2 && !hidden;
    this.comboShown.set(comboLive);
    if (comboLive) {
      this.comboTick.set(s.comboTimer);
      if (heat !== this.heat) {
        if (this.heat >= 0) this.comboHost.classList.remove(`heat-${this.heat}`);
        this.comboHost.classList.add(`heat-${heat}`);
        this.heat = heat;
      }
    }

    const melee = s.magSize === 0;
    const showMag = !hidden && !melee && !s.bottomless && (s.reloading || s.mag / s.magSize <= 0.33);
    this.magShown.set(showMag);
    if (showMag) this.magTick.set(s.reloading ? s.reloadProgress : s.mag / s.magSize);

    const dry = !melee && !s.bottomless && s.mag === 0 && !s.reloading;
    this.promptShown.set(dry && !hidden);
    if (dry) this.prompt.set(s.reserve > 0 ? 'reload' : 'no ammo');

    const charging = s.charge > 0.01 && !hidden;
    this.chargeShown.set(charging);
    if (charging) this.charge.set(s.charge);

    this.hits.body.update(dt);
    this.hits.armor.update(dt);
    this.hits.head.update(dt);
    this.hits.kill.update(dt);
    this.updateArcs(dt);
    this.locks.update(dt, s.targeting !== null);
  }

  private updateArcs(dt: number): void {
    const { player } = this.ctx;
    for (const arc of this.arcs) {
      if (arc.life <= 0) continue;
      arc.life -= dt;
      if (arc.life <= 0) {
        arc.el.style.opacity = '0';
        continue;
      }
      // The arc tracks the source as you turn, so spinning toward it still points the right way.
      _toSource.copy(arc.from).sub(player.position);
      const facing = Math.atan2(player.forward.x, -player.forward.z);
      const source = Math.atan2(_toSource.x, -_toSource.z);
      const angle = wrapAngle(source - facing);
      const u = arc.life / ARC_LIFE;
      const pop = u > 0.92 ? 1.25 : 1;
      arc.el.style.transform = `rotate(${(angle * 180) / Math.PI}deg) translate3d(0,-15.5rem,0) scale(${arc.size * pop})`;
      arc.el.style.opacity = u > 0.45 ? '1' : (u / 0.45).toFixed(2);
    }
  }

  reset(): void {
    for (const arc of this.arcs) {
      arc.life = 0;
      arc.el.style.opacity = '0';
    }
    this.bloom = 0;
    this.locks.reset();
  }
}
