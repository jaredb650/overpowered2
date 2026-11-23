/**
 * The Distraint Frame's loadout screen (`src/frame/loadout.ts`): left rail lists active slot boxes and every standard-issue
 * part grouped by slot (dynamically showing 1, 2, or 3 shoulder slots based on the fitted cockpit); right side presents
 * a live rotating 3D studio preview (`FramePreview`), live total chassis stat readout, detailed numbers for the focused
 * part, and the full Frame controls keybinding reference.
 *
 * Reached from the main menu (Frame), the pause menu (Frame loadout), and Procurement's Frame tab; Esc or Back returns
 * to whichever opened it and disposes the preview WebGL context cleanly.
 */
import type { Ctx } from '../../core/contracts';
import { FRAME } from '../../frame/data';
import {
  FRAME_PARTS, SINGLE_SLOTS, fitPart, frameStats, loadFrameLoadout, partsFor, saveFrameLoadout, shoulderSlots,
  type ArmKind, type FrameLoadout, type FramePart, type FrameSlot, type ShoulderKind,
} from '../../frame/loadout';
import { FRAME_PARTS as PART_HP } from '../../frame/parts';
import { Label, div, h, span } from '../dom';
import type { Hud } from '../Hud';
import { FramePreview } from './framePreview';
import type { Nav, NavItem } from './nav';
import { menuButton } from './parts';
import type { Screen } from './Screens';

/** A single structured stat row (`label` + concise numerical `value`). */
export interface PartStatRow {
  label: string;
  value: string;
}

/** Live total mech stat summary for the currently fitted loadout. */
export interface LoadoutSummary {
  rows: PartStatRow[];
  traits: string[];
}

/** The slots as the screen names them. */
const SLOT_NAMES: Readonly<Record<FrameSlot, string>> = {
  leftArm: 'Left arm', rightArm: 'Right arm', shoulder: 'Shoulder', legs: 'Legs', cockpit: 'Cockpit', engine: 'Engine',
};

const SHOULDER_KEYS = ['G', 'V', 'B'] as const;
const SHOULDER_CYCLE_KEYS = ['3', '4', '5'] as const;

/** What each slot is for, on the inspector card. */
const SLOT_ROLE: Readonly<Record<FrameSlot, string>> = {
  leftArm: 'Left arm weapon. LMB fires; tap 1 to cycle left arm ammo.',
  rightArm: 'Right arm weapon. RMB fires; tap 2 to cycle right arm ammo.',
  shoulder: 'Shoulder ordnance. G / V / B fire slots 1–3; tap 3 / 4 / 5 to cycle shoulder rounds.',
  legs: 'Legs. Set walk speed, jump launch, stomp power, armour and weapon stability.',
  cockpit: 'Cockpit. Sets shoulder slots (1–3), canopy durability, seat protection and wall-seeing optics.',
  engine: 'Engine. Sets speed, jump-jets / flight / hover / jet mode, fuel capacity and Shift charge.',
};

/** Exact Frame controls shown on the loadout screen. */
export const FRAME_KEY_LINES: readonly (readonly [string, string])[] = [
  ['LMB / 1', 'Left Arm · Cycle Left Ammo'],
  ['RMB / 2', 'Right Arm · Cycle Right Ammo'],
  ['G / V / B', 'Shoulders 1 / 2 / 3'],
  ['3 / 4 / 5', 'Cycle Shoulder Round'],
  ['R · Q · F', 'Manual Reload · Smoke · Melee'],
  ['Space · Shift', 'Jets / Flight · Charge'],
  ['C / Ctrl · E', 'Stomp · Exit Frame'],
];

const ARM_SPECS: Readonly<Record<ArmKind, readonly PartStatRow[]>> = {
  rotary: [
    { label: 'Fire rate', value: `${FRAME.rotary.rate} rds/s (0.25 s spin)` },
    { label: 'Damage', value: `${FRAME.rotary.damage} / rd · 6.7 s heat` },
    { label: 'Modes', value: '20 mm AP / Airburst (tap 1 or 2)' },
  ],
  cannon40: [
    { label: 'Magazine', value: `${FRAME.cannon.magazine} shells · ${FRAME.cannon.reload} s reload` },
    { label: 'Fire rate', value: `${(1 / FRAME.cannon.interval).toFixed(1)} rds/s` },
    { label: 'Rounds', value: 'HE / AP / Flak (tap 1 or 2)' },
  ],
  howitzer105: [
    { label: 'Magazine', value: `1 shell · ${FRAME.howitzer.reload} s reload` },
    { label: 'Blast', value: `${FRAME.howitzer.blastRadius} m (${FRAME.howitzer.blastDamage} dmg)` },
    { label: 'Shockwave', value: `${FRAME.howitzer.shockRadius} m knockdown` },
  ],
  vulcan30: [
    { label: 'Fire rate', value: '24.5 shells/s (0.35 s spin)' },
    { label: 'Thermal', value: '~5.0 s burst · 2.5 s vent' },
    { label: 'Rounds', value: '30 mm HE / AP / Flak (tap 1 or 2)' },
  ],
  beam: [
    { label: 'Charge', value: '1.6 s (60% walk) · 9.0 s cooldown' },
    { label: 'Beam', value: '1.0 s · 1.4 m wide · 180 m range' },
    { label: 'Special', value: 'Pierces 3 walls · Vaporizes targets' },
  ],
  cluster: [
    { label: 'Magazine', value: '1 standoff shell · 3.6 s reload' },
    { label: 'Carpet', value: '28 bomblets over 14 × 9 m patch' },
    { label: 'Bomblet', value: '2.4 m blast · 70 dmg · 7 m fuze' },
  ],
  shotgun: [
    { label: 'Magazine', value: '6-shell tube · 0.45 s/shell reload' },
    { label: 'Salvo', value: '26 pellets · 85 dmg · 5.5° spread' },
    { label: 'Fire rate', value: '0.42 s semi-auto · Interruptible' },
  ],
};

const SHOULDER_SPECS: Readonly<Record<ShoulderKind, readonly PartStatRow[]>> = {
  pod6: [
    { label: 'Salvo', value: `${FRAME.pod.tubes} lock-on missiles (${FRAME.pod.range} m)` },
    { label: 'Blast', value: `${FRAME.pod.radius} m · ${FRAME.pod.damage + FRAME.pod.blast} dmg` },
    { label: 'Reload', value: `${FRAME.pod.reload} s` },
  ],
  storm: [
    { label: 'Lock-on', value: 'Up to 8 painted targets (0.5 s ea)' },
    { label: 'Burst', value: '120 rds × 30 dmg / target (0.7 s chg)' },
    { label: 'Reload', value: '7.5 s · Snapping LOS sweep' },
  ],
  mirv: [
    { label: 'Profile', value: '70 m climb · Split at 25 m (200 m)' },
    { label: 'Warheads', value: '8 homing × 220 dmg (5 m blast)' },
    { label: 'Reload', value: '11.0 s' },
  ],
  wire: [
    { label: 'Guidance', value: '16 m/s laser-steered to crosshair' },
    { label: 'Blast', value: '26 m kill radius · 70 m shockwave' },
    { label: 'Reload', value: '28.0 s' },
  ],
  mortar: [
    { label: 'Rack', value: '6 shells · 25–180 m · 6.5 s reload' },
    { label: 'Rounds', value: 'HE (6 m) / WP (14 s) / Cluster (32)' },
    { label: 'Cycle', value: 'Tap 3 / 4 / 5 for round type' },
  ],
  fpv: [
    { label: 'Drones', value: '4 autonomous kamikaze (28 m/s)' },
    { label: 'Blast', value: '4 m · 200 dmg · 60 m search' },
    { label: 'Rebuild', value: '1 drone every 4.0 s' },
  ],
  pointdef: [
    { label: 'Mode', value: 'Passive auto-intercept (no key)' },
    { label: 'Intercept', value: '15 m radius · 6 charges (3 s ea)' },
    { label: 'Close-in', value: 'Clips infantry inside 6 m (36 dps)' },
  ],
  flares: [
    { label: 'Smoke (Q)', value: '6 charges · 7 s refill (+50% wall)' },
    { label: 'Auto-flare', value: 'Intercepts locks every 5.0 s (free)' },
    { label: 'Role', value: 'Passive defensive upgrade' },
  ],
};

const fmtMult = (v: number): string => `×${v.toFixed(2).replace(/\.00$/, '.0')}`;

/** Structured numerical stat rows for any single `FramePart` on the inspector card. */
export function partSpecs(part: FramePart): PartStatRow[] {
  if (part.arm) return [...ARM_SPECS[part.arm]];
  if (part.shoulder) return [...SHOULDER_SPECS[part.shoulder]];
  if (part.legs) {
    const l = part.legs;
    const traits: string[] = [];
    if (l.immuneKnockback) traits.push('Knockback immune');
    if (l.noSway) traits.push('Zero aim sway');
    if (l.crushOnDrive) traits.push('Drive crush (300 dmg)');
    if (l.noRecoil) traits.push('Zero view recoil');
    if (l.legSweep) traits.push('360° 5 m leg sweep');
    if ((l.strafe ?? 1) !== 1) traits.push(`Strafe ${fmtMult(l.strafe!)}`);
    if ((l.turnRate ?? 1) !== 1) traits.push(`Turn ${fmtMult(l.turnRate!)}`);
    const legHp = Math.round(PART_HP.leg * (l.legArmor ?? 1));
    const stompText = l.crushOnDrive ? 'None (Drive crush 300)'
      : l.legSweep ? '360° Leg Sweep (5 m)'
      : `${Math.round(FRAME.stomp.radius * l.stomp)} m · ${Math.round(FRAME.stomp.center * (l.stompPower ?? l.stomp))} dmg`;
    const rows: PartStatRow[] = [
      { label: 'Walk / Jump', value: `${fmtMult(l.walk)} walk · ${l.jump > 0 ? `${fmtMult(l.jump)} jump` : 'No hop'}` },
      { label: 'Armour', value: `Legs ${legHp} HP${(l.hullScale ?? 1) !== 1 ? ` · Hull ${fmtMult(l.hullScale!)}` : ''}` },
      { label: 'Stomp', value: stompText },
    ];
    if (traits.length > 0) rows.push({ label: 'Traits', value: traits.join(' · ') });
    return rows;
  }
  if (part.cockpit) {
    const c = part.cockpit;
    const canopy = (c.canopyScale ?? 1) <= 0 ? 'None (Exposed pilot seat)'
      : (c.canopyScale ?? 1) < 1 ? `${Math.round(c.canopyScale! * 100)}% (Thinner glass)`
      : '100% armoured glass';
    const keys = SHOULDER_KEYS.slice(0, c.shoulders).join(' / ');
    const rows: PartStatRow[] = [
      { label: 'Shoulders', value: `${c.shoulders} slot${c.shoulders > 1 ? 's' : ''} (${keys})` },
      { label: 'Canopy', value: canopy },
      { label: 'Hull mult', value: `${fmtMult(c.hullScale ?? 1)} (${Math.round(FRAME.hull.maxHealth * (c.hullScale ?? 1))} HP base)` },
    ];
    if (c.sensorRange && c.sensorRange > 0) {
      rows.push({ label: 'Optics', value: `${c.sensorRange} m Thermal brain chip outlines · Co-op shared` });
    } else if (c.openSeat) {
      rows.push({ label: 'Risk', value: 'Front / overhead seat hits hurt pilot directly' });
    }
    return rows;
  }
  if (part.engine) {
    const e = part.engine;
    const fuelSec = FRAME.jet.fuel * (e.fuelScale ?? 1);
    const driveDesc: Record<typeof e.drive, string> = {
      jets: `Jump-jets (${fuelSec.toFixed(1)} s fuel)`,
      flight: `True flight · 14 m/s air (${fuelSec.toFixed(1)} s fuel)`,
      hover: 'Hover · 14 m cap · 9 m/s air (infinite)',
      afterburner: `Jet mode · 48 m/s forward (${fuelSec.toFixed(1)} s fuel)`,
      overcharge: `Weak hop (${fuelSec.toFixed(1)} s fuel)`,
      diesel: `Long-haul jets (${fuelSec.toFixed(1)} s fuel)`,
    };
    const chargeDesc: Record<typeof e.drive, string> = {
      jets: `${FRAME.charge.speed} m/s · ${FRAME.charge.count} chg (${FRAME.charge.refill} s)`,
      flight: '32 m/s 3D jet blast (1.0 s fuel)',
      hover: 'Disabled (Hover drive)',
      afterburner: 'Hold Shift airborne: Jet mode (×1.5 dive stomp)',
      overcharge: '26 m/s · 3 charges (2.5 s refill)',
      diesel: '11 m/s run up to 12 s · Tramples (4 s refill)',
    };
    const rows: PartStatRow[] = [
      { label: 'Walk mult', value: fmtMult(e.speed) },
      { label: 'Drive', value: driveDesc[e.drive] },
      { label: 'Shift', value: chargeDesc[e.drive] },
    ];
    if ((e.airborneDamageMult ?? 1) !== 1) {
      rows.push({ label: 'Risk', value: `${fmtMult(e.airborneDamageMult!)} hull damage while airborne` });
    }
    return rows;
  }
  return [];
}

/** Computes the live combined chassis stat summary for `loadout`. */
export function loadoutSummary(loadout: FrameLoadout): LoadoutSummary {
  const s = frameStats(loadout);
  const hullHp = Math.round(FRAME.hull.maxHealth * s.hullScale);
  const legHp = Math.round(PART_HP.leg * s.legArmor);
  const walkMs = (FRAME.walk.forward * s.walk).toFixed(1);
  const fuelSec = (FRAME.jet.fuel * s.fuelScale).toFixed(1);

  const canopyText = s.openSeat ? 'OPEN (Exposed)'
    : s.canopyScale < 1 ? `${Math.round(s.canopyScale * 100)}% (Thin)`
    : '100%';

  const driveText = s.drive === 'hover' ? 'Hover (14 m · ∞)'
    : s.drive === 'flight' ? `Flight (${fuelSec} s)`
    : s.drive === 'afterburner' ? `Jet Mode (${fuelSec} s)`
    : s.drive === 'overcharge' ? `Overcharge (${fuelSec} s)`
    : s.drive === 'diesel' ? `Long-Haul (${fuelSec} s)`
    : `Jets (${fuelSec} s)`;

  const chargeText = s.drive === 'hover' ? 'None'
    : s.drive === 'flight' ? '32 m/s blast'
    : s.drive === 'afterburner' ? '48 m/s Jet'
    : s.drive === 'overcharge' ? '26 m/s · 3 chg'
    : s.drive === 'diesel' ? '11 m/s · 12 s'
    : `${Math.round(FRAME.charge.speed * s.dash)} m/s · ${FRAME.charge.count} chg`;

  const stompText = s.crushOnDrive ? 'Drive Crush 300'
    : s.legSweep ? '360° Sweep 5 m'
    : `${Math.round(FRAME.stomp.radius * s.stomp)} m · ${Math.round(FRAME.stomp.center * s.stompPower)} dmg`;

  const traits: string[] = [];
  if (s.sensorRange > 0) traits.push(`${s.sensorRange} m Wall-Seeing Optics`);
  if (s.openSeat) traits.push('Exposed Pilot Seat');
  if (s.immuneKnockback) traits.push('Knockback Immune');
  if (s.noRecoil) traits.push('Zero View Recoil');
  if (s.noSway) traits.push('Zero Aim Sway');
  if (s.airborneDamageMult > 1) traits.push(`×${s.airborneDamageMult} Airborne Dmg`);
  if (loadout.shoulders.includes('flareRack')) traits.push('6× Smoke + Auto-Flares');
  if (loadout.shoulders.includes('pointDefence')) traits.push('Active Point Defence');

  return {
    rows: [
      { label: 'Hull', value: `${hullHp} HP` },
      { label: 'Legs', value: `${legHp} HP` },
      { label: 'Canopy', value: canopyText },
      { label: 'Walk', value: `${walkMs} m/s` },
      { label: 'Drive', value: driveText },
      { label: 'Shift', value: chargeText },
      { label: 'Stomp', value: stompText },
      { label: 'Shoulders', value: `${s.shoulders} / 3` },
    ],
    traits,
  };
}

/** One row: a part, for one slot (a shoulder part for one shoulder slot). */
interface Row {
  part: FramePart;
  slot: FrameSlot;
  /** Which shoulder slot, for a shoulder part. */
  at: number;
}

export class FrameLoadoutScreen implements Screen {
  readonly el: HTMLElement;
  readonly preview = new FramePreview();
  private nav: Nav | null = null;
  private loadout: FrameLoadout = loadFrameLoadout();
  private readonly strip: HTMLElement;
  private readonly list: HTMLElement;
  private readonly stageWrap: HTMLElement;
  private readonly summaryGrid: HTMLElement;
  private readonly summaryTraits: HTMLElement;
  private readonly back: NavItem;
  private readonly note: Label;
  private readonly card: {
    name: Label;
    role: Label;
    does: Label;
    lore: Label;
    price: Label;
    state: Label;
    stats: HTMLElement;
    buy: HTMLElement;
  };
  private rows: Row[] = [];

  constructor(private readonly ctx: Ctx, private readonly hud: Hud) {
    this.strip = div('pc-slots fl-slots');
    this.list = div('pc-list');
    const note = span('pc-note');
    this.note = new Label(note);
    this.back = menuButton('Back', () => this.hud.screens.back());
    this.back.el.classList.add('mi-small');

    this.stageWrap = div('fl-viewport');
    this.summaryGrid = div('fl-sum-grid');
    this.summaryTraits = div('fl-sum-traits');
    const summaryPanel = div('fl-summary',
      span('fl-sum-h', 'Chassis telemetry'),
      this.summaryGrid,
      this.summaryTraits,
    );
    const stage = div('fl-stage',
      this.stageWrap,
      summaryPanel,
      span('fl-stage-hint', 'Live custom chassis · Drag to rotate'),
    );

    const name = span('pc-name fl-name');
    const role = span('pc-role fl-role');
    const does = h('p', 'fl-does');
    const lore = h('p', 'pc-lore fl-lore');
    const price = span('pc-price');
    const state = span('pc-state');
    const stats = div('pc-stats fl-stats');
    const buy = div('pc-buy', price, state);

    const keysBar = div('fl-keys',
      ...FRAME_KEY_LINES.map(([k, v]) => div('fl-key', span('fl-key-k', k), span('fl-key-v', v))),
    );

    this.card = {
      name: new Label(name),
      role: new Label(role),
      does: new Label(does),
      lore: new Label(lore),
      price: new Label(price),
      state: new Label(state),
      stats,
      buy,
    };

    const rightPane = div('fl-right',
      stage,
      div('pc-card fl-card',
        div('fl-card-main', name, role, does, lore),
        div('fl-card-side', stats, buy),
        keysBar,
      ),
    );

    this.el = div('scr scr-proc scr-frame',
      div('pc-side fl-side',
        span('pc-form', 'Form 7742-F · Walker configuration'),
        span('pc-title', 'Distraint Frame'),
        span('pc-phase', 'Loadout. The next Frame called in is built to it; one already standing keeps its own.'),
        this.strip,
        this.list,
        note,
        span('pc-terms', 'All parts listed are standard issue. Brain chip optics and extra hardpoints are covered under Rider 12.'),
        this.back.el,
      ),
      rightPane,
    );
  }

  /** Currently selected loadout in this screen. */
  get currentLoadout(): FrameLoadout {
    return this.loadout;
  }

  open(nav: Nav): void {
    this.nav = nav;
    this.loadout = loadFrameLoadout();
    this.note.set('');
    nav.back = () => this.hud.screens.back();
    nav.left = nav.right = null;
    this.preview.mount(this.stageWrap, this.loadout);
    this.refresh();
  }

  update(dt: number): void {
    this.preview.update(dt);
  }

  closed(): void {
    this.preview.dispose();
  }

  /** The slots across the top: dynamically shows 1, 2, or 3 shoulder slots based on the fitted cockpit. */
  private slots(): void {
    const l = this.loadout;
    const count = shoulderSlots(l);
    const box = (n: string, id: string) =>
      div('pc-slot open worn', span('pc-slot-n', n), span('pc-slot-v', FRAME_PARTS[id as keyof typeof FRAME_PARTS].name));
    const shoulderBoxes: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const id = l.shoulders[i] ?? 'pod6';
      shoulderBoxes.push(box(`Shoulder ${i + 1} (${SHOULDER_KEYS[i]})`, id));
    }
    this.strip.replaceChildren(
      box('Left arm (LMB)', l.leftArm),
      box('Right arm (RMB)', l.rightArm),
      ...shoulderBoxes,
      box('Legs', l.legs),
      box('Cockpit', l.cockpit),
      box('Engine', l.engine),
    );
  }

  /** Updates the live total mech stat readout overlaid on the 3D studio. */
  private renderSummary(): void {
    const sum = loadoutSummary(this.loadout);
    this.summaryGrid.replaceChildren(
      ...sum.rows.map(r => div('fl-sum-row', span('fl-sum-k', r.label), span('fl-sum-v', r.value))),
    );
    this.summaryTraits.replaceChildren(
      ...sum.traits.map(t => span('fl-trait', t)),
    );
  }

  private fitted(r: Row): boolean {
    const l = this.loadout;
    return r.slot === 'shoulder' ? l.shoulders[r.at] === r.part.id : l[r.slot as (typeof SINGLE_SLOTS)[number]] === r.part.id;
  }

  private refresh(keep?: { id: FramePart['id']; slot: FrameSlot; at: number }): void {
    this.slots();
    this.renderSummary();
    this.preview.setLoadout(this.loadout);
    this.rows = [];
    const kids: HTMLElement[] = [];
    const items: NavItem[] = [];
    const group = (title: string, slot: FrameSlot, at = 0): void => {
      kids.push(span('pc-group', title));
      for (const part of partsFor(slot)) {
        const r: Row = { part, slot, at };
        const on = this.fitted(r);
        const tag = slot === 'shoulder' ? `SHLD ${at + 1}` : SLOT_NAMES[slot];
        const el = div('pc-row', span('pc-ico pc-cls', tag), span('pc-k', part.name), span('pc-v', on ? 'Fitted' : 'Fit'));
        el.classList.toggle('fitted', on);
        el.classList.toggle('owned', !on);
        const item: NavItem = { el, hover: true, activate: () => this.fit(r), focused: () => this.select(r) };
        this.rows.push(r);
        items.push(item);
        kids.push(el);
      }
    };
    group('Left arm · LMB / 1', 'leftArm');
    group('Right arm · RMB / 2', 'rightArm');
    const count = shoulderSlots(this.loadout);
    for (let i = 0; i < count; i++) {
      group(`Shoulder ${i + 1} · ${SHOULDER_KEYS[i]} / ${SHOULDER_CYCLE_KEYS[i]}`, 'shoulder', i);
    }
    group('Legs', 'legs');
    group('Cockpit', 'cockpit');
    group('Engine', 'engine');

    this.list.replaceChildren(...kids);
    items.push(this.back);

    let at = 0;
    if (keep) {
      const found = this.rows.findIndex(r => r.part.id === keep.id && r.slot === keep.slot && r.at === keep.at);
      if (found >= 0) at = found;
    }
    this.nav?.set(items, at);
    if (this.rows[at]) this.select(this.rows[at]!);
  }

  private select(r: Row): void {
    const c = this.card;
    const on = this.fitted(r);
    const line = (k: string, v: string) => div('pc-line', span('pc-stat-k', k), span('pc-line-v', v));
    c.name.set(r.part.name);
    c.role.set(SLOT_ROLE[r.slot]);
    c.does.set(r.part.does);
    c.lore.set(r.part.lore);
    const slotLabel = r.slot === 'shoulder'
      ? `Shoulder ${r.at + 1} (${SHOULDER_KEYS[r.at]})`
      : SLOT_NAMES[r.slot];
    const specRows = partSpecs(r.part).map(s => line(s.label, s.value));
    c.stats.replaceChildren(line('Slot', slotLabel), ...specRows);
    c.price.set('Issued');
    c.state.set(on ? 'Fitted' : 'Click / Enter: Fit');
    c.buy.classList.toggle('ready', !on);
    c.buy.classList.toggle('locked', false);
    c.buy.classList.toggle('poor', false);
  }

  /** Fits the part, saves it, rebuilds the live 3D mech, and preserves cursor focus on the fitted row. */
  private fit(r: Row): void {
    if (this.fitted(r)) {
      this.note.set(`${r.part.name} is already fitted.`);
      return;
    }
    this.loadout = fitPart(this.loadout, r.part.id, r.at);
    saveFrameLoadout(this.loadout);
    const where = r.slot === 'shoulder' ? `shoulder ${r.at + 1} (${SHOULDER_KEYS[r.at]})` : SLOT_NAMES[r.slot].toLowerCase();
    this.note.set(`Fitted: ${r.part.name} on ${where}.`);
    this.ctx.audio.play?.('ui_confirm');
    this.refresh({ id: r.part.id, slot: r.slot, at: r.at });
  }
}
