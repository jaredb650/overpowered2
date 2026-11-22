/**
 * The gunner's overlay. It takes the place of the on-foot widgets while the player is in a seat, and it runs after the
 * camera, so the brackets are on this frame's picture and not the last one. Everything here is a transform or a guarded
 * write, as in the rest of the HUD.
 */
import * as THREE from 'three';
import type { Action, Ctx } from '../core/contracts';
import type { MissileTarget, SeatPanel } from '../core/gameplay';
import { Flag, Label, Meter, Num, Shown, div, markup, span } from '../ui/dom';
import type { GunnerSeat, SeatRig } from './seat';
import './gunner.css';

/**
 * `mount` is a gun on the ground: no clock, no sensor readouts, and the bar under the sight is heat. `gunship` is the
 * AC-130's fire control: four guns on number keys, each with its own magazine. `frame` is the Distraint Frame's cockpit
 * (src/frame): heat under the sight, a row a clock, where the legs point, and the pod's marks.
 */
export type GunnerTone = 'thermal' | 'door' | 'mount' | 'gunship' | 'frame';

export interface GunnerWeapon {
  name: string;
  ammo: number;
  max: number;
  /** 0..1 through a reload, or -1 with none running. Left out for a gun that never reloads. */
  reload?: number;
  /** The gun the trigger fires, where there is a choice. */
  selected?: boolean;
}

/** One for every enemy the game allows at once. */
const MAX_TAGS = 48;
/** The Frame's Metal Storm Pod paints up to eight targets (the six-tube pod paints six). */
const MAX_MARKS = 8;
/** The Frame can carry two arms, up to three shoulders, smoke, and jets (7 rows; gunship uses 5). */
const MAX_WEAPONS = 8;
/** The body's tag pins to this share of the half-screen, so it is findable when it is out of shot. */
const EDGE = 0.92;

const RETICLES: Readonly<Record<GunnerTone, string>> = {
  thermal: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-62-62h20M-62-62v20M62-62h-20M62-62v20M-62 62h20M-62 62v-20M62 62h-20M62 62v-20M-30 0h-16M30 0h16M0-30v-16M0 30v16"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  gunship: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-90 0h-40M90 0h40M0-90v-40M0 90v40M-14 0h-40M14 0h40M0-14v-40M0 14v40M-62-62h16M-62-62v16M62-62h-16M62-62v16M-62 62h16M-62 62v-16M62 62h-16M62 62v-16"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  door: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="34"/><path d="M-46 0h-14M46 0h14M0-46v-14M0 46v14"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  mount: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-30 0h-18M30 0h18M0 30v18"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  frame: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-44-20v-12h12M44-20v-12h-12M-44 20v12h12M44 20v12h-12M-22 0h-10M22 0h10M0 14v10"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
};

const _p = new THREE.Vector3();
const NONE: readonly never[] = [];

class Tag {
  readonly el: HTMLElement;
  private shown: Shown;
  private held: Flag;
  private boss: Flag;
  private x = NaN;
  private y = NaN;

  constructor() {
    this.el = div('gn-tag');
    this.shown = new Shown(this.el, 'block');
    this.held = new Flag(this.el, 'held');
    this.boss = new Flag(this.el, 'boss');
    this.shown.set(false);
  }

  place(x: number, y: number, held: boolean, boss: boolean): void {
    this.shown.set(true);
    this.held.set(held);
    this.boss.set(boss);
    const px = Math.round(x);
    const py = Math.round(y);
    if (px === this.x && py === this.y) return;
    this.x = px;
    this.y = py;
    this.el.style.transform = `translate3d(${px}px,${py}px,0)`;
  }

  hide(): void {
    this.shown.set(false);
  }
}

/** A painted mark: a diamond on the target, until the salvo leaves. */
class Mark {
  readonly el = div('gn-mark');
  private readonly shown = new Shown(this.el, 'block');

  place(x: number, y: number): void {
    this.shown.set(true);
    this.el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) rotate(45deg)`;
  }

  hide(): void {
    this.shown.set(false);
  }
}

class WeaponRow {
  readonly el: HTMLElement;
  private name: Label;
  private ammo: Num;
  private bar: Meter;
  private dry: Flag;
  private selected: Flag;
  private loading: Flag;
  private shown: Shown;

  constructor() {
    const name = span('gn-wname');
    const ammo = span('gn-wammo');
    const fill = div('gn-wfill');
    this.el = div('gn-weapon', name, ammo, div('gn-wbar', fill));
    this.name = new Label(name);
    this.ammo = new Num(ammo);
    this.bar = new Meter(fill);
    this.dry = new Flag(this.el, 'dry');
    this.selected = new Flag(this.el, 'sel');
    this.loading = new Flag(this.el, 'loading');
    this.shown = new Shown(this.el, 'grid');
  }

  update(w: GunnerWeapon | undefined): void {
    this.shown.set(!!w);
    if (!w) return;
    const loading = (w.reload ?? -1) >= 0;
    this.name.set(w.name);
    this.ammo.set(w.ammo);
    // A reloading gun's bar is the reload filling, so the juggle between guns can be read at a glance.
    this.bar.set(loading ? w.reload! : w.ammo / w.max);
    this.dry.set(w.ammo <= 0 && !loading);
    this.loading.set(loading);
    this.selected.set(w.selected === true);
  }
}

export class GunnerHud implements SeatPanel {
  readonly el: HTMLElement;
  private readonly tags: Tag[] = [];
  private readonly marks: Mark[] = [];
  private readonly body: HTMLElement;
  private readonly legs: HTMLElement;
  private readonly legsShown: Shown;
  private readonly hullShown: Shown;
  private readonly hullBar: Meter;
  private readonly hullText: Label;
  private readonly hullLow: Flag;
  private readonly hullCrit: Flag;
  private readonly fHullBox: Shown;
  private readonly fHullHp: Num;
  private readonly fHullBar: Meter;
  private readonly fHullLow: Flag;
  private readonly partTorso: SVGElement;
  private readonly partLeftLeg: SVGElement;
  private readonly partRightLeg: SVGElement;
  private readonly partPod: SVGElement;
  private readonly hullWarn: Label;
  private readonly hullWarnShown: Shown;
  private readonly bootEl: HTMLElement;
  private readonly bootShown: Shown;
  private readonly bootLabel: Label;
  private readonly rows: WeaponRow[] = [];
  private readonly reticleHost: HTMLElement;
  private readonly label: Label;
  private readonly seconds: Num;
  private readonly range: Num;
  private readonly altitude: Num;
  private readonly heading: Num;
  private readonly zoom: Label;
  private readonly hint: Label;
  private readonly timeBar: Meter;
  private readonly spin: Meter;
  private readonly spinShown: Shown;
  private readonly boarding: Flag;
  private readonly warning: Flag;
  private readonly hot: Flag;
  private readonly inverted: Flag;
  private width = 1;
  private height = 1;
  private tone: GunnerTone | null = null;

  constructor(private readonly ctx: Ctx, private readonly rig: SeatRig) {
    const tags = div('gn-tags');
    for (let i = 0; i < MAX_TAGS; i++) {
      const tag = new Tag();
      this.tags.push(tag);
      tags.append(tag.el);
    }
    this.body = div('gn-body', span('', 'YOU'));
    tags.append(this.body);
    for (let i = 0; i < MAX_MARKS; i++) {
      const mark = new Mark();
      this.marks.push(mark);
      tags.append(mark.el);
    }

    for (let i = 0; i < MAX_WEAPONS; i++) this.rows.push(new WeaponRow());

    const label = span('gn-label');
    const seconds = span('gn-sec');
    const timeFill = div('gn-tfill');
    const hullFill = div('gn-hfill');
    const hullVal = span('gn-hval');
    const hull = div('gn-hull', span('gn-hkey', 'HULL'), div('gn-hbar', hullFill), hullVal);
    const range = span('gn-val');
    const altitude = span('gn-val');
    const heading = span('gn-val');
    const zoom = span('gn-val');
    const hint = div('gn-hint');
    const spinFill = div('gn-sfill');
    const spin = div('gn-spin', spinFill);
    this.reticleHost = div('gn-reticle');
    this.legs = div('gn-legtick');
    const legs = div('gn-legs', this.legs);

    // Distraint Frame hull integrity + schematic diagram + warnings + boot sequence.
    const fHullHp = span('gn-hull-num');
    const fHullFill = div('gn-hull-fill');
    const hullWarn = div('gn-hull-warn');
    const mechSvg = markup(
      `<svg class="gn-mech" viewBox="0 0 80 96" aria-hidden="true">`
      + `<polygon class="gn-p-pod" points="54,8 72,8 72,22 54,22"/>`
      + `<polygon class="gn-p-torso" points="22,16 58,16 64,28 56,50 24,50 16,28"/>`
      + `<rect class="gn-p-visor" x="28" y="26" width="24" height="4"/>`
      + `<polygon class="gn-p-lleg" points="20,54 34,54 30,74 34,90 16,90 18,72"/>`
      + `<polygon class="gn-p-rleg" points="46,54 60,54 62,72 64,90 46,90 50,74"/>`
      + `</svg>`,
    );
    const hullEl = div('gn-fhull',
      mechSvg,
      div('gn-hull-meta',
        div('gn-hull-head', span('gn-key', 'HULL'), fHullHp),
        div('gn-hull-bar', fHullFill),
      ),
    );
    const bootLabel = div('gn-boot-line');
    this.bootEl = div('gn-boot', div('gn-boot-title', 'DISTRAINT 4 // BUREAU COMPLIANCE'), bootLabel);

    this.el = div('gn',
      div('gn-corner gn-tl'), div('gn-corner gn-tr'), div('gn-corner gn-bl'), div('gn-corner gn-br'),
      tags,
      this.reticleHost,
      spin,
      div('gn-top', label, div('gn-time', div('gn-tbar', timeFill), seconds), hull, legs),
      hullEl,
      hullWarn,
      this.bootEl,
      div('gn-arms', ...this.rows.map(r => r.el)),
      div('gn-read',
        div('gn-row', span('gn-key', 'RNG'), range),
        div('gn-row', span('gn-key', 'ALT'), altitude),
        div('gn-row', span('gn-key', 'HDG'), heading),
        div('gn-row', span('gn-key', 'MAG'), zoom),
      ),
      hint,
      div('gn-uplink', 'UPLINK'),
    );
    this.label = new Label(label);
    this.seconds = new Num(seconds);
    this.range = new Num(range);
    this.altitude = new Num(altitude);
    this.heading = new Num(heading);
    this.zoom = new Label(zoom);
    this.hint = new Label(hint);
    this.timeBar = new Meter(timeFill);
    this.hullBar = new Meter(hullFill);
    this.hullText = new Label(hullVal);
    this.hullShown = new Shown(hull, 'grid');
    this.hullLow = new Flag(this.el, 'hull-low');
    this.hullCrit = new Flag(this.el, 'hull-crit');
    this.spin = new Meter(spinFill);
    this.spinShown = new Shown(spin, 'block');
    this.boarding = new Flag(this.el, 'boarding');
    this.warning = new Flag(this.el, 'warning');
    this.hot = new Flag(this.el, 'hot');
    this.inverted = new Flag(this.el, 'inverted');
    this.legsShown = new Shown(legs, 'block');
    this.fHullBox = new Shown(hullEl, 'flex');
    this.fHullHp = new Num(fHullHp);
    this.fHullBar = new Meter(fHullFill);
    this.fHullLow = new Flag(hullEl, 'low');
    this.partTorso = hullEl.querySelector('.gn-p-torso') as SVGElement;
    this.partLeftLeg = hullEl.querySelector('.gn-p-lleg') as SVGElement;
    this.partRightLeg = hullEl.querySelector('.gn-p-rleg') as SVGElement;
    this.partPod = hullEl.querySelector('.gn-p-pod') as SVGElement;
    this.hullWarn = new Label(hullWarn);
    this.hullWarnShown = new Shown(hullWarn, 'block');
    this.bootShown = new Shown(this.bootEl, 'flex');
    this.bootLabel = new Label(bootLabel);
    this.fHullBox.set(false);
    this.hullWarnShown.set(false);
    this.bootShown.set(false);
    addEventListener('resize', this.measure);
  }

  private measure = (): void => {
    this.width = this.el.clientWidth || innerWidth;
    this.height = this.el.clientHeight || innerHeight;
  };

  private key(action: Action): string {
    return this.ctx.input.labelFor(action);
  }

  /** Setting up for a new seat. Bindings can change between runs, so the hint is written here. */
  open(seat: GunnerSeat): void {
    const { plan } = seat;
    if (this.tone !== plan.tone) {
      if (this.tone) this.el.classList.remove(`tone-${this.tone}`);
      this.tone = plan.tone;
      this.el.classList.add(`tone-${plan.tone}`);
      this.reticleHost.replaceChildren(markup(RETICLES[plan.tone]));
    }
    this.label.set(plan.label);
    const out = seat.noWayOut ? '' : ` // ${this.key('interact')} ${plan.tone === 'mount' ? 'LEAVE' : plan.tone === 'frame' ? 'EXIT' : 'HAND TO AI'}`;
    // The door gunner's pilot throws his own; the chopper (thermal) and gunship seats have the key.
    const flares = plan.tone === 'gunship' || plan.tone === 'thermal' ? ` // ${this.key('jump')} FLARES` : '';
    this.hint.set(plan.tone === 'gunship'
      ? `${this.key('fire')} FIRE // 1-4 GUN, AGAIN FOR ROUND // ${this.key('aim')} ZOOM // ${this.key('reload')} VIEW${flares}${out}`
      : plan.tone === 'frame'
        ? `${this.key('jump')} JETS // ${this.key('slide')} STOMP // ${this.key('dash')} CHARGE // ${this.key('melee')} MELEE // WHEEL ZOOM${out}`
      : plan.aimZooms
        ? `${this.key('fire')} FIRE // ${this.key('aim')} ZOOM${out}`
        : `${this.key('fire')} CANNON // ${this.key('aim')} ROCKETS // WHEEL ZOOM${flares}${out}`);
    this.el.style.setProperty('--gn-hot', plan.enemyColor);
    this.spinShown.set(plan.tone !== 'thermal' && plan.tone !== 'gunship');
  }

  /** Called by the HUD while a seat is up. */
  update(): void {
    const seat = this.rig.seat;
    if (!seat) return;
    if (this.width <= 1) this.measure();
    this.boarding.set(seat.stage !== 'seated');
    this.tagEnemies();
    this.tagBody();
    if (seat.stage !== 'seated') return;
    const { plan } = seat;
    this.label.set(seat.status ? `${plan.label} // ${seat.status}` : plan.label);
    this.seconds.set(Math.ceil(seat.left));
    this.timeBar.set(seat.left / plan.seconds);
    this.warning.set(seat.left <= 10);
    const hasHull = Number.isFinite(seat.hull);
    this.hullShown.set(hasHull && !seat.frameHud);
    if (hasHull && !seat.frameHud) {
      this.hullBar.set(seat.hull);
      this.hullText.set(seat.hullText);
      this.hullLow.set(seat.hull <= 0.35 && seat.hull > 0.2);
      this.hullCrit.set(seat.hull <= 0.2);
    } else {
      this.hullLow.set(false);
      this.hullCrit.set(false);
    }
    this.range.set(Math.round(seat.range));
    this.altitude.set(Math.round(seat.altitude));
    this.heading.set(Math.round((((-seat.yaw * 180) / Math.PI) % 360 + 360) % 360));
    this.zoom.set(seat.zoomed ? `x${(plan.fov / plan.zoomFov).toFixed(1)}` : 'x1.0');
    this.spin.set(plan.tone === 'mount' || plan.tone === 'frame' ? seat.heat : seat.spin);
    this.hot.set(seat.overheated);
    this.inverted.set(seat.inverted);
    for (let i = 0; i < MAX_WEAPONS; i++) this.rows[i]!.update(seat.weapons[i]);
    this.legsShown.set(Number.isFinite(seat.legs));
    // The legs against the view: the middle of the strip is where the view looks, its ends the arc either side.
    if (Number.isFinite(seat.legs)) this.legs.style.transform = `translateX(${(-seat.legs / plan.arcHalf) * 8}rem)`;
    this.updateHull(seat);
    this.markTargets(seat.marks);
  }

  private updateHull(seat: GunnerSeat): void {
    const h = seat.frameHud;
    this.fHullBox.set(h !== null);
    if (!h) {
      this.hullWarnShown.set(false);
      this.bootShown.set(false);
      return;
    }
    const frac = h.hp / h.max;
    this.fHullHp.set(h.hp);
    this.fHullBar.set(frac);
    this.fHullLow.set(frac < 0.3);
    const state = (v: number) => (v <= 0 ? 'dead' : v < 0.55 ? 'dmg' : 'ok');
    this.partTorso.setAttribute('data-s', h.rearFlash > 0.1 ? 'dead' : state(frac));
    this.partLeftLeg.setAttribute('data-s', state(h.leftLeg));
    this.partRightLeg.setAttribute('data-s', state(h.rightLeg));
    this.partPod.setAttribute('data-s', state(h.pod));

    // Urgent cockpit warning line: breach > sapper > reactor hit > crippled leg.
    const warn = h.breach ? 'HULL BREACH // EJECT SEQUENCE ARMED'
      : h.sapper ? 'CHARGE ON LEG // STOMP OR BACKHAND TO CLEAR'
      : h.rearFlash > 0.15 ? 'REAR REACTOR HIT // CRITICAL EXPOSURE'
      : h.leftLeg <= 0 && h.rightLeg <= 0 ? 'BOTH LEGS CRIPPLED // PACE REDUCED'
      : h.leftLeg <= 0 ? 'LEFT LEG CRIPPLED'
      : h.rightLeg <= 0 ? 'RIGHT LEG CRIPPLED'
      : '';
    this.hullWarnShown.set(warn.length > 0);
    if (warn) this.hullWarn.set(warn);

    // Cockpit startup self-test overlay while kneeling-to-standing boot completes.
    const booting = h.boot < 0.99;
    this.bootShown.set(booting);
    if (booting) {
      this.bootLabel.set(
        h.boot < 0.28 ? 'HYDRAULICS PRESSURIZING...'
        : h.boot < 0.56 ? '20MM ROTARY // 40MM CANNON // 6-TUBE POD OK'
        : h.boot < 0.82 ? 'COMPLIANCE TELEMETRY LINKED'
        : 'ALL SYSTEMS ONLINE // WALK',
      );
    }
  }

  private markTargets(marks: readonly MissileTarget[]): void {
    const camera = this.ctx.render.camera;
    let used = 0;
    for (let i = 0; i < marks.length && used < MAX_MARKS; i++) {
      const t = marks[i]!;
      // A target marked again shows each mark stacked over the last.
      let before = 0;
      for (let j = 0; j < i; j++) if (marks[j] === t) before++;
      _p.copy(t.center);
      _p.y += (t.aimLift ?? 0) + before * 0.7;
      _p.project(camera);
      if (_p.z > 1) continue;
      this.marks[used++]!.place((_p.x * 0.5 + 0.5) * this.width, (0.5 - _p.y * 0.5) * this.height);
    }
    for (let i = used; i < MAX_MARKS; i++) this.marks[i]!.hide();
  }

  private tagEnemies(): void {
    const { enemies, render } = this.ctx;
    const { prisoners } = this.rig;
    const camera = render.camera;
    let used = 0;
    for (const e of this.rig.seat?.boxes === false ? NONE : enemies.alive) {
      if (used >= MAX_TAGS) break;
      _p.copy(e.center).project(camera);
      if (_p.z > 1 || Math.abs(_p.x) > 1 || Math.abs(_p.y) > 1) continue;
      this.tags[used++]!.place((_p.x * 0.5 + 0.5) * this.width, (0.5 - _p.y * 0.5) * this.height, prisoners.has(e.uid), e.isBoss);
    }
    for (let i = used; i < MAX_TAGS; i++) this.tags[i]!.hide();
  }

  private tagBody(): void {
    const { player, render } = this.ctx;
    _p.copy(player.position).project(render.camera);
    // Past the camera the projection comes back mirrored, and the tag should still point the honest way.
    const flip = _p.z > 1 ? -1 : 1;
    const x = THREE.MathUtils.clamp(_p.x * flip, -EDGE, EDGE);
    const y = THREE.MathUtils.clamp(_p.y * flip, -EDGE, EDGE);
    this.body.style.transform = `translate3d(${Math.round((x * 0.5 + 0.5) * this.width)}px,${Math.round((0.5 - y * 0.5) * this.height)}px,0)`;
  }
}
