/**
 * The gunner's overlay. It takes the place of the on-foot widgets while the player is in a seat, and it runs after the
 * camera, so the brackets are on this frame's picture and not the last one. Everything here is a transform or a guarded
 * write, as in the rest of the HUD.
 */
import * as THREE from 'three';
import type { Action, Ctx } from '../core/contracts';
import type { MissileTarget, SeatPanel } from '../core/gameplay';
import { Flag, Label, Meter, Num, Shown, div, markup, span } from '../ui/dom';
import type { HudViewMode } from './drive/types';
import type { GunnerSeat, SeatRig } from './seat';
import './gunner.css';

export type GunnerTone = 'thermal' | 'door' | 'mount' | 'gunship' | 'frame' | 'vehicle';

export interface GunnerWeapon {
  name: string;
  ammo: number;
  max: number;
  /** 0..1 through a reload, or -1 with none running. Left out for a gun that never reloads. */
  reload?: number;
  /** The gun the trigger fires, where there is a choice. */
  selected?: boolean;
}

const MAX_TAGS = 48;
const MAX_MARKS = 8;
const MAX_WEAPONS = 8;
const MAX_LEADS = 6;
const EDGE = 0.92;

const RETICLES: Readonly<Record<GunnerTone, string>> = {
  thermal: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-62-62h20M-62-62v20M62-62h-20M62-62v20M-62 62h20M-62 62v-20M62 62h-20M62 62v-20M-30 0h-16M30 0h16M0-30v-16M0 30v16"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  gunship: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-90 0h-40M90 0h40M0-90v-40M0 90v40M-14 0h-40M14 0h40M0-14v-40M0 14v40M-62-62h16M-62-62v16M62-62h-16M62-62v16M-62 62h16M-62 62v-16M62 62h-16M62 62v-16"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  door: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="34"/><path d="M-46 0h-14M46 0h14M0-46v-14M0 46v14"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  mount: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-30 0h-18M30 0h18M0 30v18"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  frame: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-44-20v-12h12M44-20v-12h-12M-44 20v12h12M44 20v12h-12M-22 0h-10M22 0h10M0 14v10"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  vehicle: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="24" stroke-dasharray="10 8"/><path d="M-42 0h-14M42 0h14M0-42v-14M0 42v14"/><rect x="-1.8" y="-1.8" width="3.6" height="3.6"/></svg>`,
};

/** Calibrated per-seat reticles for driveable vehicles (Fighter HUD, MBT mil-dot, AA radar, Mortar, FLIR, Mount). */
const VEHICLE_RETICLES: Readonly<Record<HudViewMode, string>> = {
  standard: RETICLES.vehicle,
  emplacement: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="18"/><path d="M-34 0h-10M34 0h10M0 24v12"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  thermal: RETICLES.thermal,
  tank: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-86 0h66M20 0h66M0-60v44M0 14v72M-16 28h32M-11 46h22M-7 64h14M-62-44v-16h16M62-44v-16h-16M-62 44v16h16M62 44v16h-16"/><polygon points="0,-6 6,6 -6,6"/></svg>`,
  aa: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="48" stroke-dasharray="8 6"/><circle r="20"/><path d="M-68 0h16M52 0h16M0-68v16M0 52v16"/><rect x="-1.8" y="-1.8" width="3.6" height="3.6"/></svg>`,
  mortar: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-64 0h44M20 0h44M0-72v52M0 20v56M-26-36a44 44 0 0 1 52 0M-38-18h14M24-18h14M-20 34h40M-12 52h24"/><circle r="6"/></svg>`,
  fighter: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="14"/><path d="M-34 0h16M18 0h16M0-32v14M0 18v14M-44-6l10 6-10 6M44-6l-10 6 10 6"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  passenger: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"></svg>`,
};

const PITCH_LADDER_SVG = `<svg class="gn-jet-svg" viewBox="-140 -140 280 280" aria-hidden="true">
  <path d="M-110 0h72M38 0h72"/>
  <path d="M-64-32h32v8M32-32h32v8M-64-64h32v8M32-64h32v8M-64-96h32v8M32-96h32v8"/>
  <path stroke-dasharray="6 5" d="M-64 32h32v-8M32 32h32v-8M-64 64h32v-8M32 64h32v-8M-64 96h32v-8M32 96h32v-8"/>
</svg>`;

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

class LeadPip {
  readonly el = div('gn-lead');
  private readonly shown = new Shown(this.el, 'block');

  place(x: number, y: number): void {
    this.shown.set(true);
    this.el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
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
  private readonly leads: LeadPip[] = [];
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
  private readonly vehBox: Shown;
  private readonly vehSpd: Num;
  private readonly vehBoost: Meter;
  private readonly vehBoosting: Flag;
  private readonly vehSeat: Label;
  private readonly vehSpecial: Label;
  private readonly vehSpecialActive: Flag;
  private readonly vehSpecialCool: Flag;
  private readonly vehCam: Label;
  private readonly chargeBox: Shown;
  private readonly chargeBar: Meter;
  private readonly mslWarn: Shown;
  private readonly jetBox: Shown;
  private readonly jetLadder: HTMLElement;
  private readonly jetSpdVal: Num;
  private readonly jetAltVal: Num;
  private readonly jetModeBadge: Label;
  private readonly ccipEl: HTMLElement;
  private readonly ccipShown: Shown;
  private readonly lockEl: HTMLElement;
  private readonly lockShown: Shown;
  private readonly lockLabel: Label;
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
  private vMode: HudViewMode | null = null;

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
    for (let i = 0; i < MAX_LEADS; i++) {
      const pip = new LeadPip();
      this.leads.push(pip);
      tags.append(pip.el);
    }

    // Fighter Jet CCIP Bomb Impact Reticle & Lock-On Target Diamond (projected in screen space).
    this.ccipEl = div('gn-ccip', span('gn-ccip-lbl', 'CCIP'));
    const lockLbl = span('gn-lock-lbl');
    this.lockEl = div('gn-lock', lockLbl);
    tags.append(this.ccipEl, this.lockEl);

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

    // Viper Particle Lance Charge Bar & Incoming Missile Lock Warning!
    const chargeFill = div('gn-charge-fill');
    const chargeEl = div('gn-charge', span('gn-charge-lbl', 'LANCE CHARGE'), div('gn-charge-bar', chargeFill));
    const mslWarnEl = div('gn-msl-warn', '⚠ MISSILE LOCK // POP [Q] FLARES');

    // Green Military Fighter Jet HUD (pitch ladder, left airspeed tape, right altitude tape, VTOL/JET badge).
    this.jetLadder = div('gn-jet-ladder', markup(PITCH_LADDER_SVG));
    const jetSpdNum = span('gn-jet-num');
    const jetAltNum = span('gn-jet-num');
    const jetModeEl = div('gn-jet-mode');
    const jetEl = div('gn-jet',
      div('gn-jet-clip', this.jetLadder),
      div('gn-jet-tape gn-jet-spd', span('gn-jet-tag', 'IAS'), jetSpdNum, span('gn-jet-tag', 'KMH')),
      div('gn-jet-tape gn-jet-alt', span('gn-jet-tag', 'ALT'), jetAltNum, span('gn-jet-tag', 'M')),
      jetModeEl,
    );

    // Driveable vehicle telemetry strip.
    const vehSpdNum = span('gn-veh-num');
    const vehBoostFill = div('gn-veh-bfill');
    const vehSeatEl = span('gn-veh-pill');
    const vehSpecialEl = span('gn-veh-pill');
    const vehCamEl = span('gn-veh-pill');
    const vehEl = div('gn-veh',
      div('gn-veh-spd', vehSpdNum, span('gn-veh-unit', 'KM/H')),
      div('gn-veh-boost', span('gn-key', 'BOOST'), div('gn-veh-bbar', vehBoostFill)),
      div('gn-veh-meta', vehSeatEl, vehSpecialEl, vehCamEl),
    );

    this.el = div('gn',
      div('gn-corner gn-tl'), div('gn-corner gn-tr'), div('gn-corner gn-bl'), div('gn-corner gn-br'),
      tags,
      jetEl,
      this.reticleHost,
      spin,
      chargeEl,
      mslWarnEl,
      div('gn-top', label, div('gn-time', div('gn-tbar', timeFill), seconds), hull, legs),
      hullEl,
      hullWarn,
      this.bootEl,
      vehEl,
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
    this.vehBox = new Shown(vehEl, 'flex');
    this.vehSpd = new Num(vehSpdNum);
    this.vehBoost = new Meter(vehBoostFill);
    this.vehBoosting = new Flag(vehEl, 'boosting');
    this.vehSeat = new Label(vehSeatEl);
    this.vehSpecial = new Label(vehSpecialEl);
    this.vehSpecialActive = new Flag(vehSpecialEl, 'active');
    this.vehSpecialCool = new Flag(vehSpecialEl, 'cool');
    this.vehCam = new Label(vehCamEl);
    this.chargeBox = new Shown(chargeEl, 'flex');
    this.chargeBar = new Meter(chargeFill);
    this.mslWarn = new Shown(mslWarnEl, 'block');
    this.jetBox = new Shown(jetEl, 'block');
    this.jetSpdVal = new Num(jetSpdNum);
    this.jetAltVal = new Num(jetAltNum);
    this.jetModeBadge = new Label(jetModeEl);
    this.ccipShown = new Shown(this.ccipEl, 'block');
    this.lockShown = new Shown(this.lockEl, 'block');
    this.lockLabel = new Label(lockLbl);

    this.fHullBox.set(false);
    this.hullWarnShown.set(false);
    this.bootShown.set(false);
    this.vehBox.set(false);
    this.chargeBox.set(false);
    this.mslWarn.set(false);
    this.jetBox.set(false);
    this.ccipShown.set(false);
    this.lockShown.set(false);
    addEventListener('resize', this.measure);
  }

  private measure = (): void => {
    this.width = this.el.clientWidth || innerWidth;
    this.height = this.el.clientHeight || innerHeight;
  };

  private key(action: Action): string {
    return this.ctx.input.labelFor(action);
  }

  open(seat: GunnerSeat): void {
    const { plan } = seat;
    if (this.tone !== plan.tone) {
      if (this.tone) this.el.classList.remove(`tone-${this.tone}`);
      this.tone = plan.tone;
      this.el.classList.add(`tone-${plan.tone}`);
      this.vMode = null;
      this.el.removeAttribute('data-vmode');
      this.reticleHost.replaceChildren(markup(RETICLES[plan.tone]));
    }
    this.label.set(plan.label);
    const out = seat.noWayOut ? '' : ` // ${this.key('interact')} ${plan.tone === 'mount' ? 'LEAVE' : plan.tone === 'frame' || plan.tone === 'vehicle' ? 'EXIT' : 'HAND TO AI'}`;
    const flares = plan.tone === 'gunship' || plan.tone === 'thermal' ? ` // ${this.key('jump')} FLARES` : '';
    this.hint.set(seat.hintText
      ? seat.hintText
      : plan.tone === 'gunship'
        ? `${this.key('fire')} FIRE // 1-4 GUN, AGAIN FOR ROUND // ${this.key('aim')} ZOOM // ${this.key('reload')} VIEW${flares}${out}`
        : plan.tone === 'frame'
          ? `${this.key('jump')} JETS // ${this.key('slide')} STOMP // ${this.key('dash')} CHARGE // ${this.key('melee')} MELEE // WHEEL ZOOM${out}`
          : plan.tone === 'vehicle'
            ? `WASD DRIVE // SHIFT BOOST // F SEAT // C VIEW // Q SPECIAL${out}`
            : plan.aimZooms
              ? `${this.key('fire')} FIRE // ${this.key('aim')} ZOOM${out}`
              : `${this.key('fire')} CANNON // ${this.key('aim')} ROCKETS // WHEEL ZOOM${flares}${out}`);
    this.el.style.setProperty('--gn-hot', plan.enemyColor);
    this.spinShown.set(plan.tone !== 'thermal' && plan.tone !== 'gunship');
  }

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
    if (seat.hintText) this.hint.set(seat.hintText);
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
    this.spin.set(plan.tone === 'mount' || plan.tone === 'frame' || plan.tone === 'vehicle' ? seat.heat : seat.spin);
    this.hot.set(seat.overheated);
    this.inverted.set(seat.inverted);
    for (let i = 0; i < MAX_WEAPONS; i++) this.rows[i]!.update(seat.weapons[i]);
    this.legsShown.set(Number.isFinite(seat.legs));
    if (Number.isFinite(seat.legs)) this.legs.style.transform = `translateX(${(-seat.legs / plan.arcHalf) * 8}rem)`;
    this.updateHull(seat);
    this.updateVehicle(seat);
    this.markTargets(seat.marks);
  }

  private updateVehicle(seat: GunnerSeat): void {
    const v = seat.vehicleHud;
    this.vehBox.set(v !== null);
    if (!v) {
      this.chargeBox.set(false);
      this.mslWarn.set(false);
      this.jetBox.set(false);
      this.ccipShown.set(false);
      this.lockShown.set(false);
      for (const pip of this.leads) pip.hide();
      if (this.vMode !== null) {
        this.vMode = null;
        this.el.removeAttribute('data-vmode');
      }
      return;
    }

    // Switch dedicated calibrated 1P optic/reticle dynamically per seat!
    if (this.vMode !== v.hudMode) {
      this.vMode = v.hudMode;
      this.el.setAttribute('data-vmode', v.hudMode);
      this.reticleHost.replaceChildren(markup(VEHICLE_RETICLES[v.hudMode]));
    }
    this.spinShown.set(v.hudMode !== 'passenger' && v.hudMode !== 'thermal');

    this.vehSpd.set(Math.round(v.speedKmh));
    this.vehBoost.set(v.boost);
    this.vehBoosting.set(v.boosting);
    this.vehSeat.set(`SEAT ${v.seatIndex + 1}/${v.seatCount} ${v.seatName}`);
    this.vehSpecial.set(v.specialActive ? `[Q] ${v.specialLabel} ON` : v.specialReady ? `[Q] ${v.specialLabel}` : `[Q] ${Math.ceil(v.specialFraction * 100)}%`);
    this.vehSpecialActive.set(v.specialActive);
    this.vehSpecialCool.set(!v.specialReady && !v.specialActive);
    this.vehCam.set(v.ammoMode ? `${v.ammoMode} // ${v.cameraLabel}` : `CAM ${v.cameraLabel}`);

    // Viper Particle Lance Charge Bar & Incoming Missile Lock Warning.
    const charging = v.chargeFraction > 0.02;
    this.chargeBox.set(charging);
    if (charging) this.chargeBar.set(v.chargeFraction);
    this.mslWarn.set(v.missileWarning);

    // Green Military Fighter Jet HUD (Harrier & Warthog)!
    const isFighter = v.hudMode === 'fighter';
    this.jetBox.set(isFighter);
    if (isFighter) {
      const pitchPx = Math.round(v.pitchRad * 180);
      const rollDeg = ((-v.rollRad * 180) / Math.PI).toFixed(1);
      this.jetLadder.style.transform = `translate3d(0,${pitchPx}px,0) rotate(${rollDeg}deg)`;
      this.jetSpdVal.set(Math.round(v.speedKmh));
      this.jetAltVal.set(Math.round(v.altitudeM));
      this.jetModeBadge.set(v.vtolMode ? 'VTOL HOVER' : 'MACH JET');
    }

    // Projected 3D tactical reticles (CCIP Bomb Ground Impact Point, Missile Lock Diamond, AA Lead Pips).
    const camera = this.ctx.render.camera;
    if (v.ccipWorld) {
      _p.set(v.ccipWorld[0], v.ccipWorld[1], v.ccipWorld[2]).project(camera);
      if (_p.z <= 1 && Math.abs(_p.x) <= 1.05 && Math.abs(_p.y) <= 1.05) {
        this.ccipShown.set(true);
        this.ccipEl.style.transform = `translate3d(${Math.round((_p.x * 0.5 + 0.5) * this.width)}px,${Math.round((0.5 - _p.y * 0.5) * this.height)}px,0)`;
      } else {
        this.ccipShown.set(false);
      }
    } else {
      this.ccipShown.set(false);
    }

    if (v.lockWorld) {
      _p.set(v.lockWorld[0], v.lockWorld[1], v.lockWorld[2]).project(camera);
      if (_p.z <= 1 && Math.abs(_p.x) <= 1.05 && Math.abs(_p.y) <= 1.05) {
        this.lockShown.set(true);
        this.lockLabel.set(v.lockLabel || 'LOCK');
        this.lockEl.style.transform = `translate3d(${Math.round((_p.x * 0.5 + 0.5) * this.width)}px,${Math.round((0.5 - _p.y * 0.5) * this.height)}px,0)`;
      } else {
        this.lockShown.set(false);
      }
    } else {
      this.lockShown.set(false);
    }

    let usedLeads = 0;
    for (let i = 0; i < v.leadPips.length && usedLeads < MAX_LEADS; i++) {
      const lp = v.leadPips[i]!;
      _p.set(lp[0], lp[1], lp[2]).project(camera);
      if (_p.z > 1 || Math.abs(_p.x) > 1.05 || Math.abs(_p.y) > 1.05) continue;
      this.leads[usedLeads++]!.place((_p.x * 0.5 + 0.5) * this.width, (0.5 - _p.y * 0.5) * this.height);
    }
    for (let i = usedLeads; i < MAX_LEADS; i++) this.leads[i]!.hide();
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

    const warn = h.breach ? 'HULL BREACH // EJECT SEQUENCE ARMED'
      : h.sapper ? 'CHARGE ON LEG // STOMP OR BACKHAND TO CLEAR'
      : h.rearFlash > 0.15 ? 'REAR REACTOR HIT // CRITICAL EXPOSURE'
      : h.leftLeg <= 0 && h.rightLeg <= 0 ? 'BOTH LEGS CRIPPLED // PACE REDUCED'
      : h.leftLeg <= 0 ? 'LEFT LEG CRIPPLED'
      : h.rightLeg <= 0 ? 'RIGHT LEG CRIPPLED'
      : '';
    this.hullWarnShown.set(warn.length > 0);
    if (warn) this.hullWarn.set(warn);

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
    const flip = _p.z > 1 ? -1 : 1;
    const x = THREE.MathUtils.clamp(_p.x * flip, -EDGE, EDGE);
    const y = THREE.MathUtils.clamp(_p.y * flip, -EDGE, EDGE);
    this.body.style.transform = `translate3d(${Math.round((x * 0.5 + 0.5) * this.width)}px,${Math.round((0.5 - y * 0.5) * this.height)}px,0)`;
  }
}
