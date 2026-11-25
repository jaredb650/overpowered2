/**
 * The Distraint Frame's Bureau Hangar Garage (`src/ui/screens/frameLoadout.ts`):
 *
 *   Left bay     Compact 9-slot category selector (Chassis & Look, Weapons with dynamic 1–3 shoulders, Systems)
 *                and scrollable part cards (or 4-swatch livery cards for Paint).
 *   Center stage Quick-Build Presets bar (6 showcase rigs + Reset), full-height 3D turntable preview (`FramePreview`),
 *                live 4-channel custom color pickers when Paint is active, and Frame keybinding reference.
 *   Right panel  Live comparative chassis telemetry bars (Hull HP, Walk Speed, Boost/Fuel, Energy Power, Lock Range,
 *                Shoulder Slots, Core Expansion Q) and detailed numerical technical specs for the focused part.
 *
 * Reached from the main menu (Frame), the pause menu (Frame loadout), and Procurement's Frame tab; Esc or Back returns
 * to whichever opened it and disposes the preview WebGL context cleanly.
 */
import '../css/frameGarage.css';
import type { Ctx } from '../../core/contracts';
import { clamp } from '../../core/math';
import { FRAME } from '../../frame/data';
import {
  ALL_SINGLE_SLOTS, FRAME_PARTS, FRAME_PRESETS, defaultLoadout, fitPart, frameStats,
  loadFrameLoadout, normalizeLoadout, paintOf, partsFor, sameLoadout, saveFrameLoadout, shoulderSlots,
  type AnySingleSlot, type ArmKind, type CustomFrameColors, type DriveKind, type ExpansionKind,
  type FrameLoadout, type FramePart, type FrameSlot, type GaitKind, type HeadKind, type ShoulderKind,
} from '../../frame/loadout';
import { FRAME_PALETTES, resolvePalette } from '../../frame/models/palette';
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

/** Comparative horizontal stat bar rendered in the right-hand telemetry panel. */
export interface StatBar {
  label: string;
  value: string;
  /** Normalized fill ratio in `0..1`. */
  ratio: number;
  accent?: 'amber' | 'cyan' | 'green' | 'hot';
}

/** Live total mech stat summary for the currently fitted loadout. */
export interface LoadoutSummary {
  rows: PartStatRow[];
  bars: StatBar[];
  traits: string[];
  shoulderCount: number;
  expansionName: string;
  expansionMeta: string;
}

/** Display labels for all 9 modular Frame slots. */
export const SLOT_LABEL: Readonly<Record<FrameSlot, string>> = {
  cockpit: 'Chassis',
  head: 'Head',
  legs: 'Legs',
  paint: 'Paint',
  leftArm: 'Left Arm',
  rightArm: 'Right Arm',
  shoulder: 'Shoulder',
  engine: 'Engine',
  expansion: 'Expansion',
};

/** Short key / role tags displayed on each slot button. */
export const SLOT_KEY: Readonly<Record<FrameSlot, string>> = {
  cockpit: 'CORE',
  head: 'OPTIC',
  legs: 'GAIT',
  paint: 'LIVERY',
  leftArm: 'LMB / 1',
  rightArm: 'RMB / 2',
  shoulder: 'G / V / B',
  engine: 'SPACE / SHIFT',
  expansion: 'Q',
};

const SHOULDER_KEYS = ['G', 'V', 'B'] as const;
const SHOULDER_CYCLE_KEYS = ['3', '4', '5'] as const;

/** Role copy for each slot on the inspector card. */
const SLOT_ROLE: Readonly<Record<FrameSlot, string>> = {
  cockpit: 'Chassis / Core. Replaces the full torso silhouette, hardpoints, shoulder slots (1–3), canopy and core traits.',
  head: 'Head / Sensor Crown. Sculpts the crown silhouette and adds tracking, thermal optics, lock range or head armour.',
  legs: 'Legs. Sets walk speed, jump launch, gait style, stomp / crush power, leg armour and weapon stability.',
  paint: 'Paint & Thruster Livery. Repaints every armour plate, optic and thruster flame with zero extra draw calls.',
  leftArm: 'Left Arm Weapon. LMB fires; tap 1 to cycle left arm mode or round type.',
  rightArm: 'Right Arm Weapon. RMB fires; tap 2 to cycle right arm mode or round type.',
  shoulder: 'Shoulder Ordnance. G / V / B fire slots 1–3; tap 3 / 4 / 5 to cycle shoulder rounds.',
  engine: 'Engine / Thruster Drive. Sets movement speed, flight / hover / dash mode, fuel tank and Shift boost.',
  expansion: 'Core Expansion (Q). High-impact defensive or offensive overdrive triggered on Q (or automatically on Last-Stand).',
};

/** Exact Frame controls shown on the Garage screen. */
export const FRAME_KEY_LINES: readonly (readonly [string, string])[] = [
  ['LMB / 1', 'Left Arm · Cycle Mode'],
  ['RMB / 2', 'Right Arm · Cycle Mode'],
  ['G / V / B', 'Shoulders 1 / 2 / 3'],
  ['3 / 4 / 5', 'Cycle Shoulder Round'],
  ['R · Q · F', 'R Reload · Core Expansion · Melee'],
  ['Space · Shift', 'Jets / Flight · Boost / Charge'],
  ['C / Ctrl · E', 'Stomp / Pulse · Exit Frame'],
];

/** Human-readable labels for all 8 leg gaits. */
export const GAIT_LABEL: Readonly<Record<GaitKind, string>> = {
  walker: 'Reverse-Joint Walker',
  sprinter: 'Light Sprinter',
  heavy: 'Pile-Driver Heavy',
  treads: 'Armoured Treads',
  spider: 'Quad Spider',
  hover: 'Mag-Skiff Repulsor',
  wheels: 'Drift-Wheel Sled',
  aeroQuad: 'Aero-Quad Glide',
};

/** Human-readable labels for all 9 engine drives. */
export const DRIVE_LABEL: Readonly<Record<DriveKind, string>> = {
  jets: 'Jump-Jets',
  flight: 'True Flight',
  hover: 'Rotor Hover',
  afterburner: 'Afterburner Jet',
  overcharge: 'Overcharge Boost',
  diesel: 'Long-Haul Drive',
  blink: 'Blink-Step QB',
  redline: 'Redline Surge',
  assault: 'Assault-Ram',
};

const HEAD_LABEL: Readonly<Record<HeadKind, string>> = {
  standard: 'Flush Integrated Brow',
  duelist: 'V-Crest Duelist Helm',
  cyclops: 'Cyclops Recon Dome',
  stealth: 'Flat Arrowhead Hood',
  bunker: 'Demolition Roll-Cage',
  halo: 'Seraph Sensor Crown',
};

const EXPANSION_EFFECT: Readonly<Record<ExpansionKind, string>> = {
  smoke: 'Smoke screen + flares · 6.5 m concussive push',
  nova: '18 m energy shockwave · 480 dmg · Deletes rockets',
  aegis: '1,500 HP mobile hex-shield · 8.0 s · Strips sappers',
  dome: '10 m stationary dome · 3,000 HP · 12.0 s one-way cover',
  terminal: 'Clamps at 1 HP · 4.5 s invulnerable · 10 m blast',
};

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
  grenade: [
    { label: 'Drum', value: '6 rounds · 0.55 s cadence · 3.2 s reload' },
    { label: 'HE Mode', value: '7.5 m blast · 290 dmg (62 m/s arc)' },
    { label: 'Napalm', value: '10 m burning pool carpet · 12 s (tap 1 or 2)' },
  ],
  sword: [
    { label: '3-Hit Combo', value: '9.5 m arc · 420 / 480 / 680 dmg + lunge' },
    { label: 'Charge (0.85 s)', value: 'Wave Cleave (65 m) or Impale Lunge (18 m)' },
    { label: 'Modes', value: 'Tap 1 or 2 · Real gore & armour slicing' },
  ],
  bunker: [
    { label: 'Quick Tap', value: '4.5 m piston punch · 320 dmg (0.65 s cd)' },
    { label: 'Charge (0.9 s)', value: '6.5 m supersonic spike · 900 dmg' },
    { label: 'Reload', value: '4.0 s · Launches vehicles & breaks bosses' },
  ],
  flamer: [
    { label: 'Reach', value: '26 m pressurized twin-nozzle napalm stream' },
    { label: 'Thermal', value: '~7.0 s sustained burn · 2.8 s vent' },
    { label: 'Effect', value: 'Coats floors in fire · Panics human squads' },
  ],
  plasma: [
    { label: 'Tap Fire', value: '85 m/s orb · 4.5 m crackling dome (1.8 s DoT)' },
    { label: 'Charge (0.8 s)', value: '3-orb horizontal fan volley' },
    { label: 'Cadence', value: '0.65 s · Heat-cycled magnetic emitter' },
  ],
  rail: [
    { label: 'Tap Slug', value: '0.35 s · 190 dmg · 0° spread (2 bodies)' },
    { label: 'Charge (1.1 s)', value: '650 dmg hypersonic slug · Pierces 2 walls' },
    { label: 'Role', value: 'Zero-spread long-range anti-armour' },
  ],
  shield: [
    { label: 'Barrier', value: '4.5 × 3.5 m hex wall · 80% frontal DR' },
    { label: 'Perfect Guard', value: 'First 0.5 s · 95% DR + reflects rockets' },
    { label: 'Utility', value: 'Fire other arm freely · F Shield Bash' },
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
  twinGrenade: [
    { label: 'Salvo', value: '2 × 80 mm shells · 0.14 s apart (120 m/s)' },
    { label: 'Blast', value: '6.0 m radius · 260 dmg ea · High stagger' },
    { label: 'Reload', value: '6.5 s · Direct-fire shoulder cannon' },
  ],
  laserOrbit: [
    { label: 'Drones', value: '2 hovering gun-orbits · 45 m auto-zap' },
    { label: 'Duration', value: '14.0 s active · Both arms stay free' },
    { label: 'Cooldown', value: '10.0 s' },
  ],
  arcNeedle: [
    { label: 'Harpoon', value: '240 m/s rail spike · 380 impact dmg' },
    { label: 'Arc Detonate', value: '0.45 s delay · 9 m chain (5 targets · 220 dmg)' },
    { label: 'Reload', value: '7.0 s' },
  ],
  plasmaMissiles: [
    { label: 'Salvo', value: '6 vertical-launch missiles (arcs over roofs)' },
    { label: 'Impact', value: '5.0 m lingering plasma domes (160 dmg + DoT)' },
    { label: 'Reload', value: '9.0 s' },
  ],
  shoulderGatling: [
    { label: 'Fire rate', value: '22 rds/s · 48 dmg (4-barrel rotary)' },
    { label: 'Thermal', value: '4.5 s burst · 2.4 s vent' },
    { label: 'Synergy', value: 'Fires alongside both arm weapons' },
  ],
};

const DRIVE_SPEC: Readonly<Record<DriveKind, (fuelSec: number) => { drive: string; shift: string }>> = {
  jets: fuel => ({
    drive: `Jump-jets (${fuel.toFixed(1)} s fuel)`,
    shift: `${FRAME.charge.speed} m/s · ${FRAME.charge.count} chg (${FRAME.charge.refill} s)`,
  }),
  flight: fuel => ({
    drive: `True flight · 14 m/s air (${fuel.toFixed(1)} s fuel)`,
    shift: '32 m/s 3D jet blast (1.0 s fuel)',
  }),
  hover: () => ({
    drive: 'Rotor hover · 14 m cap · 9 m/s air (infinite)',
    shift: 'Disabled (Hover drive)',
  }),
  afterburner: fuel => ({
    drive: `Jet mode · 48 m/s forward (${fuel.toFixed(1)} s fuel)`,
    shift: 'Hold Shift airborne: Jet mode (×1.5 dive stomp)',
  }),
  overcharge: fuel => ({
    drive: `Weak hop (${fuel.toFixed(1)} s fuel)`,
    shift: '26 m/s · 3 charges (2.5 s refill)',
  }),
  diesel: fuel => ({
    drive: `Long-haul jets (${fuel.toFixed(1)} s fuel)`,
    shift: '11 m/s run up to 12 s · Tramples (4 s refill)',
  }),
  blink: fuel => ({
    drive: `Jump-jets (${fuel.toFixed(1)} s fuel) · 6 radial verniers`,
    shift: '30 m/s omni Quick-Boost (WASD · 4 chg · 1.3 s)',
  }),
  redline: fuel => ({
    drive: `Redline tank (${fuel.toFixed(1)} s fuel · ×0.5 normal regen)`,
    shift: 'Empty 0% → 1.4 s whine → 75% instant surge (+25% EN 4 s)',
  }),
  assault: fuel => ({
    drive: `Twin ram-jets (${fuel.toFixed(1)} s fuel)`,
    shift: 'Hold Shift: 28 m/s rush (30% frontal DR) · F Boost Kick (550 dmg)',
  }),
};

const fmtMult = (v: number): string => `×${v.toFixed(2).replace(/\.00$/, '.0')}`;

/** Structured numerical stat rows for any single `FramePart` on the inspector card (all 87 catalogued parts). */
export function partSpecs(part: FramePart): PartStatRow[] {
  if (part.arm) return [...ARM_SPECS[part.arm]];
  if (part.shoulder) return [...SHOULDER_SPECS[part.shoulder]];
  if (part.legs) {
    const l = part.legs;
    const traits: string[] = [];
    if (l.hoverHeight && l.hoverHeight > 0) traits.push(`Floats ${l.hoverHeight.toFixed(2)} m`);
    if (l.repulsorPulse) traits.push('Repulsor Crush (10 m · 180 dmg)');
    if (l.driftRig) traits.push('High-speed powerslide drift');
    if (l.aeroHover) traits.push('14 m/s Flat Hover-Glide (½ fuel)');
    if (l.immuneKnockback) traits.push('Knockback immune');
    if (l.noSway) traits.push('Zero aim sway');
    if (l.crushOnDrive) traits.push(l.driftRig ? 'Drive crush (240 dmg)' : 'Drive crush (300 dmg)');
    if (l.noRecoil) traits.push('Zero view recoil');
    if (l.legSweep) traits.push('360° 5 m leg sweep');
    if ((l.strafe ?? 1) !== 1) traits.push(`Strafe ${fmtMult(l.strafe!)}`);
    if ((l.turnRate ?? 1) !== 1) traits.push(`Turn ${fmtMult(l.turnRate!)}`);
    const legHp = Math.round(PART_HP.leg * (l.legArmor ?? 1));
    const stompText = l.repulsorPulse ? '10 m Repulsor Pulse (180 dmg)'
      : l.crushOnDrive ? `None (Drive crush ${l.driftRig ? 240 : 300})`
      : l.legSweep ? '360° Leg Sweep (5 m)'
      : `${Math.round(FRAME.stomp.radius * l.stomp)} m · ${Math.round(FRAME.stomp.center * (l.stompPower ?? l.stomp))} dmg`;
    const rows: PartStatRow[] = [
      { label: 'Gait', value: GAIT_LABEL[l.gait] },
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
      : (c.canopyScale ?? 1) > 1 ? `${Math.round(c.canopyScale! * 100)}% (Reinforced slit)`
      : '100% armoured glass';
    const keys = SHOULDER_KEYS.slice(0, c.shoulders).join(' / ');
    const rows: PartStatRow[] = [
      { label: 'Shoulders', value: `${c.shoulders} slot${c.shoulders > 1 ? 's' : ''} (${keys})` },
      { label: 'Canopy', value: canopy },
      { label: 'Hull mult', value: `${fmtMult(c.hullScale ?? 1)} (${Math.round(FRAME.hull.maxHealth * (c.hullScale ?? 1))} HP base)` },
    ];
    const mods: string[] = [];
    if (c.walkScale && c.walkScale !== 1) mods.push(`Walk ${fmtMult(c.walkScale)}`);
    if (c.dashScale && c.dashScale !== 1) mods.push(`Dash ${fmtMult(c.dashScale)}`);
    if (c.recoilScale && c.recoilScale !== 1) mods.push(`View recoil ${Math.round((c.recoilScale - 1) * 100)}%`);
    if (c.energyChargeMult && c.energyChargeMult !== 1) mods.push(`Energy charge +${Math.round((c.energyChargeMult - 1) * 100)}%`);
    if (c.fuelRegenScale && c.fuelRegenScale !== 1) mods.push(`Fuel regen +${Math.round((c.fuelRegenScale - 1) * 100)}%`);
    if (mods.length > 0) rows.push({ label: 'Core Mods', value: mods.join(' · ') });
    if (c.sensorRange && c.sensorRange > 0) {
      rows.push({ label: 'Optics', value: `${c.sensorRange} m Thermal brain chip outlines · Co-op shared` });
    } else if (c.openSeat) {
      rows.push({ label: 'Risk', value: 'Front / overhead seat hits hurt pilot directly' });
    }
    return rows;
  }
  if (part.head) {
    const hStat = part.head;
    const bonuses: string[] = [];
    if (hStat.armTrackMult && hStat.armTrackMult !== 1) bonuses.push(`Arm tracking +${Math.round((hStat.armTrackMult - 1) * 100)}%`);
    if (hStat.lockRangeMult && hStat.lockRangeMult !== 1) bonuses.push(`Lock range +${Math.round((hStat.lockRangeMult - 1) * 100)}%`);
    if (hStat.canopyScale && hStat.canopyScale !== 1) bonuses.push(`Canopy armour +${Math.round((hStat.canopyScale - 1) * 100)}%`);
    if (hStat.crackDamageMult && hStat.crackDamageMult !== 1) bonuses.push(`Crack build-up ${Math.round((hStat.crackDamageMult - 1) * 100)}%`);
    const optics = hStat.sensorRange && hStat.sensorRange > 0
      ? `${hStat.sensorRange} m Thermal brain chip outlines · Co-op shared`
      : 'Standard optical reticle (0 m wall-scan)';
    return [
      { label: 'Crown', value: HEAD_LABEL[hStat.head] },
      { label: 'Optics', value: optics },
      { label: 'Trait', value: bonuses.length > 0 ? bonuses.join(' · ') : 'Baseline ×1.00 handling' },
    ];
  }
  if (part.engine) {
    const e = part.engine;
    const fuelSec = FRAME.jet.fuel * (e.fuelScale ?? 1);
    const spec = DRIVE_SPEC[e.drive](fuelSec);
    const rows: PartStatRow[] = [
      { label: 'Walk mult', value: fmtMult(e.speed) },
      { label: 'Drive', value: spec.drive },
      { label: 'Shift', value: spec.shift },
    ];
    if ((e.fuelRegenScale ?? 1) !== 1) {
      rows.push({ label: 'Fuel regen', value: `${fmtMult(e.fuelRegenScale!)} passive rate` });
    }
    if ((e.airborneDamageMult ?? 1) !== 1) {
      rows.push({ label: 'Risk', value: `${fmtMult(e.airborneDamageMult!)} hull damage while airborne` });
    }
    return rows;
  }
  if (part.expansion) {
    const ex = part.expansion;
    return [
      { label: 'Trigger', value: ex.passive ? 'Passive auto-save (triggers at 1 HP)' : 'Active press (Q key)' },
      { label: 'Charges', value: `${ex.charges} charge${ex.charges > 1 ? 's' : ''} · ${ex.refill} s cooldown` },
      { label: 'Output', value: EXPANSION_EFFECT[ex.expansion] },
    ];
  }
  if (part.paint) {
    const pal = FRAME_PALETTES[part.paint];
    return [
      { label: 'Armour', value: `${pal.primary.toUpperCase()} / ${pal.secondary.toUpperCase()}` },
      { label: 'Trim', value: `${pal.accent.toUpperCase()} · Plate ${pal.plate.toUpperCase()}` },
      { label: 'Optics / Jets', value: `${pal.glow.toUpperCase()} / ${pal.thruster.toUpperCase()}` },
    ];
  }
  return [];
}

/** Computes the live combined chassis stat summary and comparative bars for `loadout`. */
export function loadoutSummary(loadout: FrameLoadout): LoadoutSummary {
  const s = frameStats(loadout);
  const hullHp = Math.round(FRAME.hull.maxHealth * s.hullScale);
  const legHp = Math.round(PART_HP.leg * s.legArmor);
  const walkVal = FRAME.walk.forward * s.walk;
  const walkMs = walkVal.toFixed(1);
  const fuelVal = FRAME.jet.fuel * s.fuelScale;
  const fuelSec = fuelVal.toFixed(1);

  const canopyText = s.openSeat ? 'OPEN (Exposed)'
    : s.canopyScale < 1 ? `${Math.round(s.canopyScale * 100)}% (Thin)`
    : s.canopyScale > 1 ? `${Math.round(s.canopyScale * 100)}% (Armoured)`
    : '100%';

  const driveText = s.drive === 'hover' ? 'Hover (14 m · ∞)'
    : `${DRIVE_LABEL[s.drive]} (${fuelSec} s)`;

  const chargeText = s.drive === 'hover' ? 'None'
    : s.drive === 'flight' ? '32 m/s blast'
    : s.drive === 'afterburner' ? '48 m/s Jet'
    : s.drive === 'overcharge' ? '26 m/s · 3 chg'
    : s.drive === 'diesel' ? '11 m/s · 12 s'
    : s.drive === 'blink' ? '30 m/s · 4 QB'
    : s.drive === 'redline' ? '75% Redline Surge'
    : s.drive === 'assault' ? '28 m/s Ram · Kick'
    : `${Math.round(FRAME.charge.speed * s.dash)} m/s · ${FRAME.charge.count} chg`;

  const stompText = s.repulsorPulse ? '10 m Repulsor (180)'
    : s.crushOnDrive ? `Drive Crush ${s.driftRig ? 240 : 300}`
    : s.legSweep ? '360° Sweep 5 m'
    : `${Math.round(FRAME.stomp.radius * s.stomp)} m · ${Math.round(FRAME.stomp.center * s.stompPower)} dmg`;

  const expPart = FRAME_PARTS[loadout.expansion] ?? FRAME_PARTS.expSmoke;
  const expSpec = expPart.expansion!;
  const expansionMeta = expSpec.passive
    ? `Passive · ${expSpec.refill} s cd`
    : `${expSpec.charges}× Q · ${expSpec.refill} s`;

  const traits: string[] = [];
  if (s.sensorRange > 0) traits.push(`${s.sensorRange} m Wall-Seeing Optics`);
  if (s.openSeat) traits.push('Exposed Pilot Seat');
  if (s.immuneKnockback) traits.push('Knockback Immune');
  if (s.noRecoil) traits.push('Zero View Recoil');
  else if (s.recoilScale < 1) traits.push(`-${Math.round((1 - s.recoilScale) * 100)}% Recoil`);
  if (s.noSway) traits.push('Zero Aim Sway');
  if (s.hoverHeight > 0) traits.push(`Hover ${s.hoverHeight.toFixed(2)} m`);
  if (s.driftRig) traits.push('Drift Powerslide');
  if (s.aeroHover) traits.push('Aero Hover-Glide');
  if (s.blinkBoost) traits.push('4× Blink-Step QB');
  if (s.redlineSurge) traits.push('Redline 75% Surge');
  if (s.assaultRam) traits.push('Assault-Ram + Kick');
  if (s.energyChargeMult > 1) traits.push(`+${Math.round((s.energyChargeMult - 1) * 100)}% Energy Power`);
  if (s.fuelRegenScale > 1.05) traits.push(`+${Math.round((s.fuelRegenScale - 1) * 100)}% Fuel Regen`);
  if (s.armTrackMult > 1.01) traits.push(`+${Math.round((s.armTrackMult - 1) * 100)}% Arm Tracking`);
  if (s.lockRangeMult > 1.01) traits.push(`+${Math.round((s.lockRangeMult - 1) * 100)}% Lock Range`);
  if (s.crackDamageMult < 1) traits.push(`-${Math.round((1 - s.crackDamageMult) * 100)}% Crack Wear`);
  if (s.airborneDamageMult > 1) traits.push(`×${s.airborneDamageMult} Airborne Dmg`);
  if (loadout.shoulders.includes('flareRack')) traits.push('6× Smoke + Auto-Flares');
  if (loadout.shoulders.includes('pointDefence')) traits.push('Active Point Defence');

  const bars: StatBar[] = [
    { label: 'Hull HP', value: `${hullHp} HP`, ratio: clamp(hullHp / 6500, 0.08, 1), accent: 'amber' },
    { label: 'Walk Speed', value: `${walkMs} m/s`, ratio: clamp(walkVal / 15, 0.08, 1), accent: 'cyan' },
    {
      label: 'Boost / Fuel',
      value: s.drive === 'hover' ? '∞ (14 m)' : `${fuelSec} s · ${DRIVE_LABEL[s.drive]}`,
      ratio: s.drive === 'hover' ? 1 : clamp(fuelVal / 8.5, 0.08, 1),
      accent: 'hot',
    },
    {
      label: 'Energy Power',
      value: `${Math.round(s.energyChargeMult * 100)}%`,
      ratio: clamp(s.energyChargeMult / 1.4, 0.1, 1),
      accent: 'cyan',
    },
    {
      label: 'Lock Range',
      value: `${Math.round(s.lockRangeMult * 100)}%${s.sensorRange > 0 ? ` · ${s.sensorRange} m` : ''}`,
      ratio: clamp(s.lockRangeMult / 1.4, 0.1, 1),
      accent: 'green',
    },
  ];

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
    bars,
    traits,
    shoulderCount: s.shoulders,
    expansionName: expPart.name,
    expansionMeta,
  };
}

/** One selectable slot tab in the left Garage bay. */
interface SlotTab {
  slot: FrameSlot;
  at: number;
  label: string;
  bind: string;
  partId: FramePart['id'];
}

/** One part row in the currently selected slot list. */
interface Row {
  part: FramePart;
  slot: FrameSlot;
  at: number;
}

const CUSTOM_CHANNELS: readonly { key: keyof CustomFrameColors; label: string }[] = [
  { key: 'primary', label: 'PRIMARY' },
  { key: 'secondary', label: 'SECONDARY' },
  { key: 'accent', label: 'ACCENT' },
  { key: 'glow', label: 'GLOW' },
];

export class FrameLoadoutScreen implements Screen {
  readonly el: HTMLElement;
  readonly preview = new FramePreview();
  private nav: Nav | null = null;
  private loadout: FrameLoadout = loadFrameLoadout();
  private currentSlot: FrameSlot = 'cockpit';
  private currentAt = 0;

  private readonly slotBay: HTMLElement;
  private readonly listTitle: Label;
  private readonly list: HTMLElement;
  private readonly presetsBar: HTMLElement;
  private readonly stageWrap: HTMLElement;
  private readonly stageChassis: Label;
  private readonly stageSub: Label;
  private readonly paintBar: HTMLElement;
  private readonly pickers: Record<keyof CustomFrameColors, { input: HTMLInputElement; hex: Label }>;
  private readonly summaryBars: HTMLElement;
  private readonly summaryBadges: HTMLElement;
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
    // --- Left Bay ---
    this.slotBay = div('fg-slot-bay');
    const listTitleEl = span('fg-list-title');
    this.listTitle = new Label(listTitleEl);
    this.list = div('fg-list');
    const noteEl = span('fg-note');
    this.note = new Label(noteEl);
    this.back = menuButton('Back', () => this.hud.screens.back());
    this.back.el.classList.add('mi-small');

    const leftBay = div('fg-left',
      div('fg-head',
        span('fg-form', 'Form 7742-F · Bureau Hangar Garage'),
        div('fg-title-row',
          span('fg-title', 'Distraint Frame'),
          span('fg-ver', 'MK.II'),
        ),
      ),
      this.slotBay,
      div('fg-list-head',
        listTitleEl,
        span('fg-list-hint', '← / → Switch Slot'),
      ),
      this.list,
      div('fg-left-foot',
        noteEl,
        div('fg-foot-row',
          span('fg-terms', 'Standard-issue hardware. Thermal brain chip optics covered under Rider 12.'),
          this.back.el,
        ),
      ),
    );

    // --- Center Stage (Presets Bar + 3D Turntable + Custom Paint Pickers + Keys) ---
    this.presetsBar = div('fg-presets');
    this.stageWrap = div('fl-viewport');
    const stageChassisEl = span('fg-stage-chassis');
    const stageSubEl = span('fg-stage-sub');
    this.stageChassis = new Label(stageChassisEl);
    this.stageSub = new Label(stageSubEl);

    const pickerEls: HTMLElement[] = [];
    const pickersMap = {} as Record<keyof CustomFrameColors, { input: HTMLInputElement; hex: Label }>;
    for (const ch of CUSTOM_CHANNELS) {
      const input = h('input', 'fg-color-input') as HTMLInputElement;
      input.type = 'color';
      input.setAttribute('aria-label', `${ch.label} custom paint color`);
      input.setAttribute('data-channel', ch.key);
      const hexEl = span('fg-picker-hex');
      const hexLabel = new Label(hexEl);
      const onColor = () => this.setCustomPaintColor(ch.key, input.value);
      input.addEventListener('input', onColor);
      input.addEventListener('change', onColor);
      pickersMap[ch.key] = { input, hex: hexLabel };
      pickerEls.push(
        h('label', 'fg-picker',
          input,
          div('fg-picker-meta', span('fg-picker-k', ch.label), hexEl),
        ),
      );
    }
    this.pickers = pickersMap;

    const clearTintBtn = h('button', 'fg-clear-paint', 'Clear Tint');
    clearTintBtn.type = 'button';
    clearTintBtn.addEventListener('click', () => this.clearCustomPaint());

    this.paintBar = div('fg-paint-bar hidden',
      span('fg-paint-bar-title', 'Custom Swatches'),
      div('fg-pickers', ...pickerEls),
      clearTintBtn,
    );

    const stage = div('fl-stage',
      this.stageWrap,
      div('fg-stage-badge', stageChassisEl, stageSubEl),
      this.paintBar,
      span('fl-stage-hint', 'Drag to orbit · Scroll to zoom · Double-click to reset view'),
    );

    const keysBar = div('fl-keys',
      ...FRAME_KEY_LINES.map(([k, v]) => div('fl-key', span('fl-key-k', k), span('fl-key-v', v))),
    );

    const centerStage = div('fg-center',
      this.presetsBar,
      stage,
      keysBar,
    );

    // --- Right Inspector (Telemetry Bars + Focused Part Spec Sheet) ---
    this.summaryBars = div('fg-bars');
    this.summaryBadges = div('fg-badges');
    this.summaryGrid = div('fl-sum-grid');
    this.summaryTraits = div('fl-sum-traits');
    const summaryPanel = div('fl-summary',
      div('fg-sum-top',
        span('fl-sum-h', 'Chassis Telemetry'),
        span('fg-sum-tag', 'Live Output'),
      ),
      this.summaryBars,
      this.summaryBadges,
      this.summaryGrid,
      this.summaryTraits,
    );

    const nameEl = span('pc-name fl-name');
    const roleEl = span('pc-role fl-role');
    const doesEl = h('p', 'fl-does');
    const loreEl = h('p', 'pc-lore fl-lore');
    const priceEl = span('pc-price');
    const stateEl = span('pc-state');
    const statsEl = div('pc-stats fl-stats');
    const buyEl = div('pc-buy', priceEl, stateEl);

    this.card = {
      name: new Label(nameEl),
      role: new Label(roleEl),
      does: new Label(doesEl),
      lore: new Label(loreEl),
      price: new Label(priceEl),
      state: new Label(stateEl),
      stats: statsEl,
      buy: buyEl,
    };

    const inspector = div('fl-card',
      div('fg-card-head', nameEl, roleEl),
      doesEl,
      loreEl,
      statsEl,
      buyEl,
    );

    const rightInspector = div('fg-right',
      summaryPanel,
      inspector,
    );

    this.el = div('scr scr-frame fg-garage',
      leftBay,
      centerStage,
      rightInspector,
    );
  }

  /** Currently selected loadout in this screen. */
  get currentLoadout(): FrameLoadout {
    return this.loadout;
  }

  /** Currently focused Garage slot and shoulder index. */
  get activeSlot(): { slot: FrameSlot; at: number } {
    return { slot: this.currentSlot, at: this.currentAt };
  }

  open(nav: Nav): void {
    this.nav = nav;
    this.loadout = loadFrameLoadout();
    this.currentSlot = 'cockpit';
    this.currentAt = 0;
    this.note.set('');
    nav.back = () => this.hud.screens.back();
    nav.left = () => this.stepSlot(-1);
    nav.right = () => this.stepSlot(1);
    this.preview.mount(this.stageWrap, this.loadout);
    this.refresh();
  }

  update(dt: number): void {
    this.preview.update(dt);
  }

  closed(): void {
    this.preview.dispose();
  }

  /** Switches the active Garage slot tab and refreshes the part list. */
  selectSlot(slot: FrameSlot, at = 0): void {
    const maxAt = slot === 'shoulder' ? Math.max(0, shoulderSlots(this.loadout) - 1) : 0;
    this.currentSlot = slot;
    this.currentAt = clamp(at, 0, maxAt);
    this.refresh();
  }

  /** Applies one of the 6 quick-build presets from `FRAME_PRESETS`. */
  applyPreset(presetId: string): void {
    const preset = FRAME_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    this.loadout = normalizeLoadout({ ...preset.loadout, shoulders: [...preset.loadout.shoulders] });
    saveFrameLoadout(this.loadout);
    this.clampActiveSlot();
    this.note.set(`Preset loaded: ${preset.name}.`);
    this.ctx.audio.play?.('ui_confirm');
    this.refresh();
  }

  /** Resets the Frame back to the Bureau Standard loadout. */
  resetLoadout(): void {
    this.loadout = defaultLoadout();
    saveFrameLoadout(this.loadout);
    this.clampActiveSlot();
    this.note.set('Reset to Bureau Standard loadout.');
    this.ctx.audio.play?.('ui_confirm');
    this.refresh();
  }

  /** Live-updates one of the 4 custom paint channels and repaints the 3D mech immediately. */
  setCustomPaintColor(channel: keyof CustomFrameColors, hex: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const nextCustom: CustomFrameColors = { ...(this.loadout.customPaint ?? {}), [channel]: hex };
    this.loadout = normalizeLoadout({ ...this.loadout, customPaint: nextCustom });
    saveFrameLoadout(this.loadout);
    this.preview.setLoadout(this.loadout);
    this.syncPaintPickers();
    this.renderStageBadge();
    this.renderPresets();
    this.note.set(`Custom ${channel} tint set to ${hex.toUpperCase()}.`);
  }

  /** Clears custom color overrides and returns to the active preset livery colors. */
  clearCustomPaint(): void {
    if (!this.loadout.customPaint) return;
    const next = { ...this.loadout };
    delete next.customPaint;
    this.loadout = normalizeLoadout(next);
    saveFrameLoadout(this.loadout);
    this.preview.setLoadout(this.loadout);
    this.syncPaintPickers();
    this.renderStageBadge();
    this.renderPresets();
    this.note.set(`Restored ${FRAME_PARTS[this.loadout.paint].name} base livery.`);
  }

  private clampActiveSlot(): void {
    if (this.currentSlot === 'shoulder') {
      const count = shoulderSlots(this.loadout);
      this.currentAt = Math.min(this.currentAt, Math.max(0, count - 1));
    } else {
      this.currentAt = 0;
    }
  }

  private orderedTabs(): SlotTab[] {
    const l = this.loadout;
    const tabs: SlotTab[] = [
      { slot: 'cockpit', at: 0, label: SLOT_LABEL.cockpit, bind: SLOT_KEY.cockpit, partId: l.cockpit },
      { slot: 'head', at: 0, label: SLOT_LABEL.head, bind: SLOT_KEY.head, partId: l.head },
      { slot: 'legs', at: 0, label: SLOT_LABEL.legs, bind: SLOT_KEY.legs, partId: l.legs },
      { slot: 'paint', at: 0, label: SLOT_LABEL.paint, bind: SLOT_KEY.paint, partId: l.paint },
      { slot: 'leftArm', at: 0, label: SLOT_LABEL.leftArm, bind: SLOT_KEY.leftArm, partId: l.leftArm },
      { slot: 'rightArm', at: 0, label: SLOT_LABEL.rightArm, bind: SLOT_KEY.rightArm, partId: l.rightArm },
    ];
    const count = shoulderSlots(l);
    for (let i = 0; i < count; i++) {
      tabs.push({
        slot: 'shoulder',
        at: i,
        label: `Shoulder ${i + 1}`,
        bind: `${SHOULDER_KEYS[i]} / ${SHOULDER_CYCLE_KEYS[i]}`,
        partId: l.shoulders[i] ?? 'pod6',
      });
    }
    tabs.push(
      { slot: 'engine', at: 0, label: SLOT_LABEL.engine, bind: SLOT_KEY.engine, partId: l.engine },
      { slot: 'expansion', at: 0, label: SLOT_LABEL.expansion, bind: SLOT_KEY.expansion, partId: l.expansion },
    );
    return tabs;
  }

  private stepSlot(dir: -1 | 1): void {
    const tabs = this.orderedTabs();
    const cur = tabs.findIndex(t => t.slot === this.currentSlot && t.at === this.currentAt);
    const next = tabs[(cur + dir + tabs.length) % tabs.length]!;
    this.ctx.audio.play?.('ui_hover');
    this.selectSlot(next.slot, next.at);
  }

  private renderSlotBay(): void {
    const l = this.loadout;
    const count = shoulderSlots(l);

    const makeBtn = (tab: SlotTab): HTMLElement => {
      const active = tab.slot === this.currentSlot && tab.at === this.currentAt;
      const btn = h('button', `fg-slot-btn${active ? ' active' : ''}${tab.slot === 'shoulder' ? ' fg-slot-shoulder' : ''}`,
        div('fg-slot-top', span('fg-slot-k', tab.label), span('fg-slot-bind', tab.bind)),
        span('fg-slot-v', FRAME_PARTS[tab.partId].name),
      );
      btn.type = 'button';
      btn.setAttribute('data-slot', tab.slot);
      if (tab.slot === 'shoulder') btn.setAttribute('data-at', String(tab.at));
      btn.addEventListener('click', () => {
        this.ctx.audio.play?.('ui_hover');
        this.selectSlot(tab.slot, tab.at);
      });
      return btn;
    };

    const chassisTabs: SlotTab[] = [
      { slot: 'cockpit', at: 0, label: SLOT_LABEL.cockpit, bind: SLOT_KEY.cockpit, partId: l.cockpit },
      { slot: 'head', at: 0, label: SLOT_LABEL.head, bind: SLOT_KEY.head, partId: l.head },
      { slot: 'legs', at: 0, label: SLOT_LABEL.legs, bind: SLOT_KEY.legs, partId: l.legs },
      { slot: 'paint', at: 0, label: SLOT_LABEL.paint, bind: SLOT_KEY.paint, partId: l.paint },
    ];

    const weaponTabs: SlotTab[] = [
      { slot: 'leftArm', at: 0, label: SLOT_LABEL.leftArm, bind: SLOT_KEY.leftArm, partId: l.leftArm },
      { slot: 'rightArm', at: 0, label: SLOT_LABEL.rightArm, bind: SLOT_KEY.rightArm, partId: l.rightArm },
    ];
    for (let i = 0; i < count; i++) {
      weaponTabs.push({
        slot: 'shoulder',
        at: i,
        label: `Shoulder ${i + 1}`,
        bind: `${SHOULDER_KEYS[i]} / ${SHOULDER_CYCLE_KEYS[i]}`,
        partId: l.shoulders[i] ?? 'pod6',
      });
    }

    const systemTabs: SlotTab[] = [
      { slot: 'engine', at: 0, label: SLOT_LABEL.engine, bind: SLOT_KEY.engine, partId: l.engine },
      { slot: 'expansion', at: 0, label: SLOT_LABEL.expansion, bind: SLOT_KEY.expansion, partId: l.expansion },
    ];

    const weaponCols = weaponTabs.length === 3 ? 'cols-3' : weaponTabs.length === 4 ? 'cols-4' : 'cols-3';

    this.slotBay.replaceChildren(
      div('fg-cat-group',
        span('fg-cat-label', 'Chassis & Look'),
        div('fg-cat-grid cols-4', ...chassisTabs.map(makeBtn)),
      ),
      div('fg-cat-group',
        span('fg-cat-label', `Weapons · ${count} Shoulder Hardpoint${count > 1 ? 's' : ''}`),
        div(`fg-cat-grid ${weaponCols}`, ...weaponTabs.map(makeBtn)),
      ),
      div('fg-cat-group',
        span('fg-cat-label', 'Systems'),
        div('fg-cat-grid cols-2', ...systemTabs.map(makeBtn)),
      ),
    );
  }

  private renderPresets(): void {
    const btns: HTMLElement[] = [span('fg-presets-label', 'Presets')];
    for (const preset of FRAME_PRESETS) {
      const normalized = normalizeLoadout(preset.loadout);
      const active = sameLoadout(this.loadout, normalized);
      const btn = h('button', `fg-preset-btn${active ? ' active' : ''}`, preset.name);
      btn.type = 'button';
      btn.setAttribute('data-preset', preset.id);
      btn.setAttribute('title', preset.summary);
      btn.addEventListener('click', () => this.applyPreset(preset.id));
      btns.push(btn);
    }
    const resetBtn = h('button', 'fg-reset-btn', 'Reset');
    resetBtn.type = 'button';
    resetBtn.setAttribute('data-action', 'reset');
    resetBtn.addEventListener('click', () => this.resetLoadout());
    btns.push(resetBtn);
    this.presetsBar.replaceChildren(...btns);
  }

  private renderStageBadge(): void {
    const chassisName = FRAME_PARTS[this.loadout.cockpit].name;
    const headName = FRAME_PARTS[this.loadout.head].name;
    const paintName = FRAME_PARTS[this.loadout.paint].name;
    this.stageChassis.set(chassisName);
    this.stageSub.set(`${headName} · ${paintName}${this.loadout.customPaint ? ' (Custom)' : ''}`);
  }

  private syncPaintPickers(): void {
    const resolved = resolvePalette(paintOf(this.loadout), this.loadout.customPaint);
    this.pickers.primary.input.value = resolved.primary;
    this.pickers.primary.hex.set(resolved.primary);
    this.pickers.secondary.input.value = resolved.secondary;
    this.pickers.secondary.hex.set(resolved.secondary);
    this.pickers.accent.input.value = resolved.accent;
    this.pickers.accent.hex.set(resolved.accent);
    this.pickers.glow.input.value = resolved.glow;
    this.pickers.glow.hex.set(resolved.glow);
  }

  /** Updates the right-hand comparative stat bars, badges, telemetry grid, and trait pills. */
  private renderSummary(): void {
    const sum = loadoutSummary(this.loadout);
    this.summaryBars.replaceChildren(
      ...sum.bars.map(b => {
        const fill = div(`fg-bar-fill ${b.accent ?? 'amber'}`);
        fill.style.transform = `scaleX(${b.ratio.toFixed(3)})`;
        return div('fg-bar-row',
          span('fg-bar-k', b.label),
          div('fg-bar-track', fill),
          span('fg-bar-v', b.value),
        );
      }),
    );

    const pips: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
      pips.push(div(`fg-pip${i < sum.shoulderCount ? ' on' : ''}`));
    }
    pips.push(span('fg-pip-txt', `${sum.shoulderCount} / 3`));

    this.summaryBadges.replaceChildren(
      div('fg-badge-box',
        span('fg-badge-k', 'Shoulder Slots'),
        div('fg-pips', ...pips),
      ),
      div('fg-badge-box',
        span('fg-badge-k', `Core Expansion · ${sum.expansionMeta}`),
        span('fg-exp-val', sum.expansionName),
      ),
    );

    this.summaryGrid.replaceChildren(
      ...sum.rows.map(r => div('fl-sum-row', span('fl-sum-k', r.label), span('fl-sum-v', r.value))),
    );
    this.summaryTraits.replaceChildren(
      ...sum.traits.map(t => span('fl-trait', t)),
    );
  }

  private fitted(r: Row): boolean {
    const l = this.loadout;
    return r.slot === 'shoulder'
      ? l.shoulders[r.at] === r.part.id
      : l[r.slot as AnySingleSlot] === r.part.id;
  }

  private refresh(keep?: { id: FramePart['id']; slot: FrameSlot; at: number }): void {
    this.clampActiveSlot();
    this.renderSlotBay();
    this.renderPresets();
    this.renderStageBadge();
    this.renderSummary();
    this.syncPaintPickers();
    this.preview.setLoadout(this.loadout);

    const slot = this.currentSlot;
    const at = this.currentAt;
    const isPaint = slot === 'paint';
    this.paintBar.classList.toggle('hidden', !isPaint);
    this.list.classList.toggle('fg-paint-grid', isPaint);

    const heading = slot === 'shoulder'
      ? `Shoulder ${at + 1} · ${SHOULDER_KEYS[at]} / ${SHOULDER_CYCLE_KEYS[at]}`
      : `${SLOT_LABEL[slot]} · ${SLOT_KEY[slot]}`;
    this.listTitle.set(heading);

    this.rows = [];
    const kids: HTMLElement[] = [];
    const items: NavItem[] = [];

    for (const part of partsFor(slot)) {
      const r: Row = { part, slot, at };
      const on = this.fitted(r);
      let el: HTMLElement;

      if (isPaint && part.paint) {
        const pal = FRAME_PALETTES[part.paint];
        const chip = (color: string) => {
          const c = span('fg-swatch-chip');
          c.style.backgroundColor = color;
          return c;
        };
        el = div(`fg-paint-card${on ? ' fitted' : ''}`,
          div('fg-swatches', chip(pal.primary), chip(pal.secondary), chip(pal.accent), chip(pal.glow)),
          div('fg-paint-meta',
            span('fg-paint-name', part.name),
            span('fg-paint-badge', on ? 'Fitted' : 'Apply'),
          ),
        );
      } else {
        const firstSpec = partSpecs(part)[0];
        const sub = firstSpec ? `${firstSpec.label}: ${firstSpec.value}` : part.does;
        el = div(`fg-part-row${on ? ' fitted' : ''}`,
          div('fg-part-main',
            span('fg-part-name', part.name),
            span('fg-part-sub', sub),
          ),
          span('fg-part-tag', on ? 'Fitted' : 'Fit'),
        );
      }

      const item: NavItem = { el, hover: true, activate: () => this.fit(r), focused: () => this.select(r) };
      this.rows.push(r);
      items.push(item);
      kids.push(el);
    }

    this.list.replaceChildren(...kids);
    items.push(this.back);

    let focusIdx = 0;
    if (keep && keep.slot === slot && keep.at === at) {
      const found = this.rows.findIndex(r => r.part.id === keep.id);
      if (found >= 0) focusIdx = found;
    } else {
      const fittedIdx = this.rows.findIndex(r => this.fitted(r));
      if (fittedIdx >= 0) focusIdx = fittedIdx;
    }

    this.nav?.set(items, focusIdx);
    if (this.rows[focusIdx]) this.select(this.rows[focusIdx]!);
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
      : SLOT_LABEL[r.slot];
    const specRows = partSpecs(r.part).map(s => line(s.label, s.value));
    c.stats.replaceChildren(line('Slot', slotLabel), ...specRows);
    c.price.set('Issued');
    c.state.set(on ? 'Fitted' : 'Click / Enter: Fit');
    c.buy.classList.toggle('ready', !on);
    c.buy.classList.toggle('locked', false);
    c.buy.classList.toggle('poor', false);
  }

  /** Fits the part, saves it, rebuilds the live 3D mech, and preserves focus on the fitted row. */
  private fit(r: Row): void {
    if (this.fitted(r) && !(r.slot === 'paint' && this.loadout.customPaint)) {
      this.note.set(`${r.part.name} is already fitted.`);
      return;
    }
    this.loadout = fitPart(this.loadout, r.part.id, r.at);
    saveFrameLoadout(this.loadout);
    const where = r.slot === 'shoulder'
      ? `shoulder ${r.at + 1} (${SHOULDER_KEYS[r.at]})`
      : SLOT_LABEL[r.slot].toLowerCase();
    this.note.set(`Fitted: ${r.part.name} on ${where}.`);
    this.ctx.audio.play?.('ui_confirm');
    this.refresh({ id: r.part.id, slot: r.slot, at: r.at });
  }
}

export { ALL_SINGLE_SLOTS };
