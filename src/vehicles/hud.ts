/**
 * The gunner's overlay. It takes the place of the on-foot widgets while the player is in a seat, and it runs after the
 * camera, so the brackets are on this frame's picture and not the last one. Everything here is a transform or a guarded
 * write, as in the rest of the HUD.
 */
import * as THREE from 'three';
import type { Action, Ctx } from '../core/contracts';
import type { SeatPanel } from '../core/gameplay';
import { Flag, Label, Meter, Num, Shown, div, markup, span } from '../ui/dom';
import type { GunnerSeat, SeatRig } from './seat';
import './gunner.css';

/** `mount` is a gun on the ground: no clock, no sensor readouts, and the bar under the sight is heat. */
export type GunnerTone = 'thermal' | 'door' | 'mount';

export interface GunnerWeapon {
  name: string;
  ammo: number;
  max: number;
}

/** One for every enemy the game allows at once. */
const MAX_TAGS = 48;
const MAX_WEAPONS = 2;
/** The body's tag pins to this share of the half-screen, so it is findable when it is out of shot. */
const EDGE = 0.92;

const RETICLES: Readonly<Record<GunnerTone, string>> = {
  thermal: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-62-62h20M-62-62v20M62-62h-20M62-62v20M-62 62h20M-62 62v-20M62 62h-20M62 62v-20M-30 0h-16M30 0h16M0-30v-16M0 30v16"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  door: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="34"/><path d="M-46 0h-14M46 0h14M0-46v-14M0 46v14"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
  mount: `<svg class="gn-ret" viewBox="-100 -100 200 200" aria-hidden="true"><path d="M-30 0h-18M30 0h18M0 30v18"/><rect x="-1.6" y="-1.6" width="3.2" height="3.2"/></svg>`,
};

const _p = new THREE.Vector3();

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

class WeaponRow {
  readonly el: HTMLElement;
  private name: Label;
  private ammo: Num;
  private bar: Meter;
  private dry: Flag;
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
    this.shown = new Shown(this.el, 'grid');
  }

  update(w: GunnerWeapon | undefined): void {
    this.shown.set(!!w);
    if (!w) return;
    this.name.set(w.name);
    this.ammo.set(w.ammo);
    this.bar.set(w.ammo / w.max);
    this.dry.set(w.ammo <= 0);
  }
}

export class GunnerHud implements SeatPanel {
  readonly el: HTMLElement;
  private readonly tags: Tag[] = [];
  private readonly body: HTMLElement;
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

    for (let i = 0; i < MAX_WEAPONS; i++) this.rows.push(new WeaponRow());

    const label = span('gn-label');
    const seconds = span('gn-sec');
    const timeFill = div('gn-tfill');
    const range = span('gn-val');
    const altitude = span('gn-val');
    const heading = span('gn-val');
    const zoom = span('gn-val');
    const hint = div('gn-hint');
    const spinFill = div('gn-sfill');
    const spin = div('gn-spin', spinFill);
    this.reticleHost = div('gn-reticle');

    this.el = div('gn',
      div('gn-corner gn-tl'), div('gn-corner gn-tr'), div('gn-corner gn-bl'), div('gn-corner gn-br'),
      tags,
      this.reticleHost,
      spin,
      div('gn-top', label, div('gn-time', div('gn-tbar', timeFill), seconds)),
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
    this.spin = new Meter(spinFill);
    this.spinShown = new Shown(spin, 'block');
    this.boarding = new Flag(this.el, 'boarding');
    this.warning = new Flag(this.el, 'warning');
    this.hot = new Flag(this.el, 'hot');
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
    const out = seat.noWayOut ? '' : ` // ${this.key('interact')} ${plan.tone === 'mount' ? 'LEAVE' : 'BAIL OUT'}`;
    this.hint.set(plan.aimZooms
      ? `${this.key('fire')} FIRE // ${this.key('aim')} ZOOM${out}`
      : `${this.key('fire')} CANNON // ${this.key('aim')} ROCKETS // WHEEL ZOOM${out}`);
    this.el.style.setProperty('--gn-hot', plan.enemyColor);
    this.spinShown.set(plan.tone !== 'thermal');
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
    this.seconds.set(Math.ceil(seat.left));
    this.timeBar.set(seat.left / plan.seconds);
    this.warning.set(seat.left <= 10);
    this.range.set(Math.round(seat.range));
    this.altitude.set(Math.round(seat.altitude));
    this.heading.set(Math.round((((-seat.yaw * 180) / Math.PI) % 360 + 360) % 360));
    this.zoom.set(seat.zoomed ? `x${(plan.fov / plan.zoomFov).toFixed(1)}` : 'x1.0');
    this.spin.set(plan.tone === 'mount' ? seat.heat : seat.spin);
    this.hot.set(seat.overheated);
    for (let i = 0; i < MAX_WEAPONS; i++) this.rows[i]!.update(seat.weapons[i]);
  }

  private tagEnemies(): void {
    const { enemies, render } = this.ctx;
    const { prisoners } = this.rig;
    const camera = render.camera;
    let used = 0;
    for (const e of enemies.alive) {
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
