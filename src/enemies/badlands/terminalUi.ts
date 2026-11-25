/**
 * Badlands Motor Pool & Distraint Frame Requisition Terminal (`BadlandsTerminalUi` + `BadlandsTerminalController`).
 *
 * Replaces the old 13-vehicle desert clutter with an on-demand sandbox requisition terminal right on
 * the concrete staging pad (mirroring Dogfight's Flight Deck Hangar terminal):
 *   - DISTRAINT FRAME: inspects your live saved Frame loadout (`loadFrameLoadout()`), highlights when
 *     new parts are ready from Procurement / Pause / Customize Loadout, opens the 3D Frame Loadout
 *     studio directly, or deploys/boards a fresh full-HP mech with your latest gear on demand.
 *   - GROUND & ARMOR: Jackal Technical, Nomad Quad ATV, Razor Moto, Viper Skiff, Aegis MBT, Bastion 6×6.
 *   - ROTORCRAFT: Kestrel Attack Gunship, Valkyrie Door-Gunner.
 *   - AIRCRAFT: AV-8B Harrier, A-10 Warthog, F/A-18E Super Hornet, F-22 Raptor, B-1B Lancer.
 *
 * All requisitions are currently FREE sandbox spawns. Releases pointer lock & pauses solo runs cleanly.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import {
  FRAME_PARTS,
  frameStats,
  loadFrameLoadout,
  sameLoadout,
  type FrameLoadout,
} from '../../frame/loadout';
import { FRAME_PARTS as PART_HP } from '../../frame/parts';
import { FRAME } from '../../frame/data';
import type { DriveVehicleId } from '../../vehicles/drive/types';
import { BADLANDS_TERMINAL } from '../../world/map/badlands/plan';

declare module '../../core/contracts' {
  interface GameEvents {
    /** Badlands Motor Pool & Frame Terminal opened/closed — pauses solo runs cleanly without showing Pause menu. */
    'badlands:modal': { open: boolean };
    /** Badlands Terminal spawns (and optionally boards) a player-driveable vehicle on the staging pad or runway. */
    'badlands:spawn_vehicle': { id: DriveVehicleId; board?: boolean };
    /** Badlands Terminal deploys (and optionally boards) a fresh Distraint Frame with the latest saved loadout. */
    'badlands:spawn_frame': { board?: boolean };
    /** Badlands Terminal clears unoccupied vehicles left around the basin. */
    'badlands:clear_vehicles': Record<string, never>;
    /** Badlands Terminal opens the 3D Frame Loadout studio and returns to the terminal on Back. */
    'badlands:customize_frame': { onDone: () => void };
  }
}

export type BadlandsTerminalTab = 'frame' | 'ground' | 'rotorcraft' | 'aircraft';

export interface BadlandsVehicleChoice {
  readonly id: DriveVehicleId;
  readonly tab: Exclude<BadlandsTerminalTab, 'frame'>;
  readonly name: string;
  readonly role: string;
  readonly weapons: string;
  readonly highlight: string;
  readonly stageLabel: string;
  readonly boardLabel: string;
}

export const BADLANDS_TERMINAL_VEHICLES: readonly BadlandsVehicleChoice[] = [
  // --- Ground & Armor ---
  {
    id: 'aegis',
    tab: 'ground',
    name: 'AEGIS MAIN BATTLE TANK',
    role: 'Heavy Armor · 2 Seats',
    weapons: '120mm APFSDS / HE-Frag · Coaxial MG · Commander 20mm AA & TOW-X',
    highlight: 'Neutral-steer tracked armor built to brawl enemy tank columns',
    stageLabel: 'STAGE ON PAD',
    boardLabel: 'DEPLOY & DRIVE',
  },
  {
    id: 'bastion',
    tab: 'ground',
    name: 'BASTION 6×6 GUNTRUCK',
    role: 'Heavy Support · 3 Seats',
    weapons: 'Twin 20mm Autocannon · Radar AA Vulcan · 81mm Rear Mortar',
    highlight: 'Mobile anti-air and indirect-fire platform for solo or co-op crews',
    stageLabel: 'STAGE ON PAD',
    boardLabel: 'DEPLOY & DRIVE',
  },
  {
    id: 'jackal',
    tab: 'ground',
    name: 'JACKAL TECHNICAL',
    role: 'Fast Attack 4WD · 2 Seats',
    weapons: 'Twin 7.62 Bumper MG · Roof .50-Cal Hybrid & 40mm Smart-AGL',
    highlight: 'Drift-tuned dune technical with toggleable [Q] Auto-Turret',
    stageLabel: 'STAGE ON PAD',
    boardLabel: 'DEPLOY & DRIVE',
  },
  {
    id: 'viper',
    tab: 'ground',
    name: 'VIPER LANCE SKIFF',
    role: 'Repulsor Hover · 2 Seats',
    weapons: 'Charged Particle Lance Beam · Concussion Pulse · Rear Shock Gun',
    highlight: 'Glides above sand dunes with [Space] dune-hop & piercing beam',
    stageLabel: 'STAGE ON PAD',
    boardLabel: 'DEPLOY & RIDE',
  },
  {
    id: 'quad',
    tab: 'ground',
    name: 'NOMAD QUAD ATV',
    role: 'Light Recon 4WD · 2 Seats',
    weapons: 'Rear Passenger Keeps Full Hand Weapons · [Q] Turbo Hop',
    highlight: 'Ultra-nimble desert scout with rear gun platform for co-op',
    stageLabel: 'STAGE ON PAD',
    boardLabel: 'DEPLOY & RIDE',
  },
  {
    id: 'moto',
    tab: 'ground',
    name: 'RAZOR COMBAT MOTO',
    role: 'High-Speed Bike · 2 Seats',
    weapons: 'Pillion Rider Keeps Full Hand Weapons · [Q] Wheelie Boost',
    highlight: 'Deep lean-to-turn speedster for tearing across the salt flats',
    stageLabel: 'STAGE ON PAD',
    boardLabel: 'DEPLOY & RIDE',
  },

  // --- Rotorcraft ---
  {
    id: 'kestrel',
    tab: 'rotorcraft',
    name: 'KESTREL ATTACK GUNSHIP',
    role: 'Attack Helicopter · 2 Seats',
    weapons: '30mm M230 Chain Gun · Hydra-70 Rockets · FLIR Chin Gun & Hellfires',
    highlight: '360° hovering gunship built to shred convoys and enemy choppers',
    stageLabel: 'STAGE ON PAD',
    boardLabel: 'DEPLOY & FLY',
  },
  {
    id: 'valkyrie',
    tab: 'rotorcraft',
    name: 'VALKYRIE DOOR-GUNNER',
    role: 'Utility Gunship · 2 Seats',
    weapons: '20mm HEI-AP Left Door Minigun · 360° Auto-Hover Orbit',
    highlight: 'Classic door-gunner gunship for hovering broadsides or co-op crew',
    stageLabel: 'STAGE ON PAD',
    boardLabel: 'DEPLOY & FLY',
  },

  // --- Fixed-Wing Aircraft ---
  {
    id: 'harrier',
    tab: 'aircraft',
    name: 'AV-8B HARRIER',
    role: 'VTOL Jump-Jet · 1 Seat',
    weapons: '25mm GAU-12 · Mk-82 HE / BLU-27 Napalm / Lock Missiles / Hydra',
    highlight: 'Effortless [Q] VTOL hover & vertical takeoff right off the desert',
    stageLabel: 'STAGE ON RUNWAY',
    boardLabel: 'LAUNCH NOW',
  },
  {
    id: 'warthog',
    tab: 'aircraft',
    name: 'A-10 WARTHOG',
    role: 'Armored CAS Striker · 1 Seat',
    weapons: '30mm GAU-8 Avenger BRRRT · Mk-84 / Napalm / AGM-65 Mavericks',
    highlight: 'Heavy titanium bathtub built for low-altitude convoy gun runs',
    stageLabel: 'STAGE ON RUNWAY',
    boardLabel: 'LAUNCH NOW',
  },
  {
    id: 'hornet',
    tab: 'aircraft',
    name: 'F/A-18E SUPER HORNET',
    role: 'Multirole Fighter · 2 Seats',
    weapons: '20mm Vulcan · AIM-9/120 · Mavericks · JDAMs · Zuni Rockets',
    highlight: 'Balanced strike fighter with full air-to-air & air-to-ground suite',
    stageLabel: 'STAGE ON RUNWAY',
    boardLabel: 'LAUNCH NOW',
  },
  {
    id: 'raptor',
    tab: 'aircraft',
    name: 'F-22 RAPTOR',
    role: 'Stealth Air-Superiority · 1 Seat',
    weapons: '20mm M61A2 Vulcan · Internal AIM-9X / AIM-120D · [Q] Cobra Turn',
    highlight: 'Low-observable stealth, thrust vectoring & lethal anti-air agility',
    stageLabel: 'STAGE ON RUNWAY',
    boardLabel: 'LAUNCH NOW',
  },
  {
    id: 'lancer',
    tab: 'aircraft',
    name: 'B-1B LANCER',
    role: 'Swing-Wing Heavy Bomber · 1 Seat',
    weapons: 'Snake-Eye / CBU-105 Cluster / Napalm / Thermobaric · [Q] Dump-and-Burn',
    highlight: 'Supersonic swept-wing carpet bomber that erases entire grid squares',
    stageLabel: 'STAGE ON RUNWAY',
    boardLabel: 'LAUNCH NOW',
  },
];

export interface BadlandsFrameStatus {
  readonly deployed: boolean;
  readonly occupied: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly loadout: FrameLoadout | null;
}

export interface BadlandsTerminalCallbacks {
  onSpawnFrame(boardNow: boolean): void;
  onSpawnVehicle(id: DriveVehicleId, boardNow: boolean): void;
  onCustomizeFrame(onDone: () => void): void;
  onClearVehicles(): void;
  frameStatus(): BadlandsFrameStatus;
  unoccupiedVehicleCount(): number;
}

const STYLE_ID = 'op2-badlands-terminal-css';
const TERMINAL_INTERACT_RANGE = 5.4;

const DRIVE_LABELS: Readonly<Record<string, string>> = {
  jets: 'Jump-Jets',
  flight: 'Flight Thrusters',
  hover: 'Hover Rotor',
  afterburner: 'Afterburner Jet',
  overcharge: 'Overcharge Core',
  diesel: 'Long-Haul Diesel',
};

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bl-modal-wrap {
      position: fixed;
      inset: 0;
      z-index: 95;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(8, 10, 14, 0.76);
      backdrop-filter: blur(4px);
      font-family: var(--mono, ui-monospace, monospace);
      color: #edf4fa;
    }
    .bl-modal-wrap.open { display: flex; }
    .bl-modal {
      width: min(68rem, 94vw);
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      background: rgba(11, 15, 22, 0.97);
      border: 1px solid rgba(56, 232, 255, 0.36);
      border-top: 3px solid #38e8ff;
      box-shadow: 0 22px 64px rgba(0, 0, 0, 0.76);
      overflow: hidden;
    }
    .bl-mhead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.95rem 1.35rem;
      background: rgba(16, 23, 34, 0.96);
      border-bottom: 1px solid rgba(157, 176, 189, 0.22);
    }
    .bl-mtitle {
      font-size: 1.28rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      color: #ffffff;
    }
    .bl-mmeta {
      display: flex;
      align-items: center;
      gap: 0.9rem;
      font-size: 0.86rem;
    }
    .bl-badge {
      padding: 0.24rem 0.6rem;
      border: 1px solid rgba(84, 255, 157, 0.45);
      background: rgba(84, 255, 157, 0.12);
      color: #6affb0;
      font-weight: 800;
      letter-spacing: 0.08em;
      font-size: 0.74rem;
    }
    .bl-badge.amber {
      border-color: rgba(255, 180, 50, 0.65);
      background: rgba(255, 170, 36, 0.18);
      color: #ffd166;
    }
    .bl-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      padding: 0.7rem 1.35rem 0;
      border-bottom: 1px solid rgba(157, 176, 189, 0.18);
    }
    .bl-tab {
      appearance: none;
      border: 1px solid transparent;
      border-bottom: none;
      background: rgba(255, 255, 255, 0.04);
      color: #93afc2;
      padding: 0.56rem 1.1rem;
      font: 700 0.85rem/1 var(--mono, ui-monospace, monospace);
      letter-spacing: 0.08em;
      cursor: pointer;
    }
    .bl-tab.active {
      background: rgba(56, 232, 255, 0.15);
      border-color: rgba(56, 232, 255, 0.48);
      color: #ffffff;
    }
    .bl-mbody {
      padding: 1.15rem 1.35rem;
      overflow-y: auto;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.85rem;
    }
    .bl-mbody.single {
      grid-template-columns: minmax(0, 1fr);
    }
    .bl-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 0.65rem;
      padding: 0.92rem 1.05rem;
      background: rgba(18, 26, 38, 0.82);
      border: 1px solid rgba(157, 176, 189, 0.22);
    }
    .bl-card.selected {
      border-color: #38e8ff;
      background: rgba(18, 42, 56, 0.86);
    }
    .bl-card.frame-hero {
      padding: 1.15rem 1.25rem;
      gap: 0.95rem;
      border-color: rgba(255, 166, 48, 0.48);
      background: linear-gradient(135deg, rgba(24, 30, 42, 0.92), rgba(34, 24, 16, 0.84));
    }
    .bl-card-h {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .bl-card-name { font-size: 1.04rem; font-weight: 800; color: #ffffff; letter-spacing: 0.05em; }
    .bl-card.frame-hero .bl-card-name { font-size: 1.24rem; }
    .bl-card-tag { font-size: 0.74rem; color: #38e8ff; font-weight: 700; white-space: nowrap; }
    .bl-card-tag.free { color: #6affb0; }
    .bl-card-sub { font-size: 0.8rem; color: #9eb7c7; line-height: 1.4; }
    .bl-card-wep { font-size: 0.77rem; color: #d3e5f0; }
    .bl-frame-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.65rem;
    }
    .bl-slot-box {
      padding: 0.62rem 0.75rem;
      background: rgba(8, 13, 20, 0.72);
      border: 1px solid rgba(157, 176, 189, 0.2);
    }
    .bl-slot-k {
      display: block;
      font-size: 0.67rem;
      letter-spacing: 0.09em;
      color: #8da9bc;
      margin-bottom: 0.24rem;
    }
    .bl-slot-v {
      display: block;
      font-size: 0.88rem;
      font-weight: 700;
      color: #f3f9ff;
    }
    .bl-stats-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 1.1rem;
      padding: 0.6rem 0.85rem;
      background: rgba(8, 14, 22, 0.62);
      border: 1px solid rgba(56, 232, 255, 0.22);
      font-size: 0.8rem;
      color: #a8c5d6;
    }
    .bl-stats-bar strong { color: #ffffff; }
    .bl-actions { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-top: 0.15rem; }
    .bl-btn {
      appearance: none;
      border: 1px solid rgba(56, 232, 255, 0.52);
      background: rgba(56, 232, 255, 0.15);
      color: #ffffff;
      padding: 0.5rem 0.9rem;
      font: 700 0.8rem/1 var(--mono, ui-monospace, monospace);
      letter-spacing: 0.06em;
      cursor: pointer;
    }
    .bl-btn:hover:not(:disabled) { background: #38e8ff; color: #051018; }
    .bl-btn.primary {
      border-color: #ff9f1c;
      background: rgba(255, 159, 28, 0.22);
      color: #ffe8bd;
    }
    .bl-btn.primary:hover:not(:disabled) { background: #ff9f1c; color: #080a0d; }
    .bl-btn.ghost {
      border-color: rgba(157, 176, 189, 0.35);
      background: rgba(255, 255, 255, 0.05);
      color: #c7d9e6;
    }
    .bl-btn.ghost:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); color: #ffffff; }
    .bl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .bl-mfoot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.8rem;
      padding: 0.8rem 1.35rem;
      background: rgba(12, 20, 30, 0.95);
      border-top: 1px solid rgba(157, 176, 189, 0.18);
      font-size: 0.8rem;
      color: #93afc2;
    }
  `;
  document.head.appendChild(style);
}

export class BadlandsTerminalUi {
  open = false;
  activeTab: BadlandsTerminalTab = 'frame';
  selectedVehicle: DriveVehicleId = 'aegis';

  private wrapEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private tabBtns: Partial<Record<BadlandsTerminalTab, HTMLButtonElement>> = {};
  private clearBtn: HTMLButtonElement | null = null;
  private suspendedForCustomize = false;
  private ignoreNextEsc = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return;
    if (this.ignoreNextEsc && e.code === 'Escape') {
      this.ignoreNextEsc = false;
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyB') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  constructor(
    private readonly ctx: Ctx,
    private readonly cb: BadlandsTerminalCallbacks,
  ) {
    if (typeof document === 'undefined') return;
    ensureStyles();
    this.buildDom();
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  private buildDom(): void {
    const wrap = document.createElement('div');
    wrap.className = 'bl-modal-wrap';
    wrap.innerHTML = `
      <div class="bl-modal">
        <div class="bl-mhead">
          <div class="bl-mtitle">BADLANDS // MOTOR POOL &amp; FRAME TERMINAL</div>
          <div class="bl-mmeta">
            <span class="bl-badge">SANDBOX · ALL FREE</span>
            <button class="bl-btn bl-close-btn" type="button">CLOSE [ESC]</button>
          </div>
        </div>
        <div class="bl-tabs">
          <button class="bl-tab" data-tab="frame" type="button">DISTRAINT FRAME</button>
          <button class="bl-tab" data-tab="ground" type="button">GROUND &amp; ARMOR (6)</button>
          <button class="bl-tab" data-tab="rotorcraft" type="button">ROTORCRAFT (2)</button>
          <button class="bl-tab" data-tab="aircraft" type="button">AIRCRAFT (5)</button>
        </div>
        <div class="bl-mbody"></div>
        <div class="bl-mfoot">
          <span>Update your Frame in Procurement between waves or via Customize Loadout, then re-deploy anytime for your new gear.</span>
          <button class="bl-btn ghost bl-clear-btn" type="button">CLEAR UNOCCUPIED VEHICLES</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    this.wrapEl = wrap;
    this.bodyEl = wrap.querySelector('.bl-mbody');
    this.clearBtn = wrap.querySelector('.bl-clear-btn');

    wrap.querySelector('.bl-close-btn')?.addEventListener('click', () => this.close());
    this.clearBtn?.addEventListener('click', () => {
      this.cb.onClearVehicles();
      this.renderModal();
    });

    for (const tab of ['frame', 'ground', 'rotorcraft', 'aircraft'] as const) {
      const btn = wrap.querySelector(`.bl-tab[data-tab="${tab}"]`) as HTMLButtonElement | null;
      if (!btn) continue;
      this.tabBtns[tab] = btn;
      btn.addEventListener('click', () => {
        this.activeTab = tab;
        this.renderModal();
      });
    }
  }

  openTab(tab: BadlandsTerminalTab = this.activeTab): void {
    this.activeTab = tab;
    this.open = true;
    this.suspendedForCustomize = false;
    this.wrapEl?.classList.add('open');
    this.ctx.events.emit('badlands:modal', { open: true });
    this.renderModal();
  }

  /** Re-opens the overlay after returning from the 3D Frame Loadout studio without unpausing in between. */
  resumeFromCustomize(): void {
    this.suspendedForCustomize = false;
    this.open = true;
    this.ignoreNextEsc = true;
    queueMicrotask(() => { this.ignoreNextEsc = false; });
    this.wrapEl?.classList.add('open');
    this.renderModal();
  }

  close(silent = false): void {
    if (!this.open && !this.suspendedForCustomize) return;
    this.open = false;
    this.suspendedForCustomize = false;
    this.wrapEl?.classList.remove('open');
    if (!silent) {
      this.ctx.events.emit('badlands:modal', { open: false });
      this.ctx.input.endFrame?.();
    }
  }

  renderModal(): void {
    if (!this.bodyEl) return;
    for (const tab of ['frame', 'ground', 'rotorcraft', 'aircraft'] as const) {
      this.tabBtns[tab]?.classList.toggle('active', this.activeTab === tab);
    }

    const unoccupied = this.cb.unoccupiedVehicleCount();
    if (this.clearBtn) {
      this.clearBtn.disabled = unoccupied <= 0;
      this.clearBtn.textContent = unoccupied > 0
        ? `CLEAR UNOCCUPIED VEHICLES (${unoccupied})`
        : 'CLEAR UNOCCUPIED VEHICLES';
    }

    this.bodyEl.replaceChildren();
    this.bodyEl.classList.toggle('single', this.activeTab === 'frame');

    if (this.activeTab === 'frame') {
      this.renderFrameTab();
      return;
    }

    const choices = BADLANDS_TERMINAL_VEHICLES.filter(v => v.tab === this.activeTab);
    for (const v of choices) {
      const card = document.createElement('div');
      card.className = `bl-card${this.selectedVehicle === v.id ? ' selected' : ''}`;
      card.innerHTML = `
        <div>
          <div class="bl-card-h">
            <span class="bl-card-name">${v.name}</span>
            <span class="bl-card-tag free">FREE · ${v.role}</span>
          </div>
          <div class="bl-card-wep" style="margin-top:0.35rem">${v.weapons}</div>
          <div class="bl-card-sub" style="margin-top:0.28rem">${v.highlight}</div>
        </div>
        <div class="bl-actions">
          <button class="bl-btn bl-stage-btn" type="button">${v.stageLabel}</button>
          <button class="bl-btn primary bl-board-btn" type="button">${v.boardLabel}</button>
        </div>
      `;
      card.querySelector('.bl-stage-btn')?.addEventListener('click', () => {
        this.selectedVehicle = v.id;
        this.cb.onSpawnVehicle(v.id, false);
        this.close();
      });
      card.querySelector('.bl-board-btn')?.addEventListener('click', () => {
        this.selectedVehicle = v.id;
        this.cb.onSpawnVehicle(v.id, true);
        this.close();
      });
      this.bodyEl.appendChild(card);
    }
  }

  private renderFrameTab(): void {
    if (!this.bodyEl) return;
    const saved = loadFrameLoadout();
    const stats = frameStats(saved);
    const status = this.cb.frameStatus();
    const loadoutChanged = Boolean(status.deployed && status.loadout && !sameLoadout(saved, status.loadout));

    const hullHp = Math.round(PART_HP.hull * stats.hullScale);
    const legHp = Math.round(PART_HP.leg * stats.legArmor);
    const walkMs = (FRAME.walk.forward * stats.walk).toFixed(1);
    const driveName = DRIVE_LABELS[stats.drive] ?? stats.drive;
    const shouldersText = saved.shoulders.length > 0
      ? saved.shoulders.map(id => FRAME_PARTS[id].name).join(' · ')
      : 'None';

    const statusLine = !status.deployed
      ? 'NO ACTIVE FRAME ON PAD'
      : `PAD STATUS: ${Math.ceil(status.health).toLocaleString('en-US')} / ${Math.round(status.maxHealth).toLocaleString('en-US')} HP`;

    const card = document.createElement('div');
    card.className = 'bl-card frame-hero';
    card.innerHTML = `
      <div class="bl-card-h">
        <div>
          <div class="bl-card-name">DISTRAINT FRAME // ACTIVE CONFIGURATION</div>
          <div class="bl-card-sub" style="margin-top:0.2rem">${statusLine}</div>
        </div>
        <div style="display:flex;gap:0.45rem;align-items:center;flex-wrap:wrap">
          ${loadoutChanged ? '<span class="bl-badge amber">NEW LOADOUT READY — DEPLOY TO APPLY</span>' : ''}
          <span class="bl-badge">FREE REQUISITION</span>
        </div>
      </div>

      <div class="bl-frame-grid">
        <div class="bl-slot-box"><span class="bl-slot-k">LEFT ARM [LMB]</span><span class="bl-slot-v">${FRAME_PARTS[saved.leftArm].name}</span></div>
        <div class="bl-slot-box"><span class="bl-slot-k">RIGHT ARM [RMB]</span><span class="bl-slot-v">${FRAME_PARTS[saved.rightArm].name}</span></div>
        <div class="bl-slot-box"><span class="bl-slot-k">SHOULDERS (${stats.shoulders} SLOTS)</span><span class="bl-slot-v">${shouldersText}</span></div>
        <div class="bl-slot-box"><span class="bl-slot-k">LEGS</span><span class="bl-slot-v">${FRAME_PARTS[saved.legs].name}</span></div>
        <div class="bl-slot-box"><span class="bl-slot-k">COCKPIT</span><span class="bl-slot-v">${FRAME_PARTS[saved.cockpit].name}</span></div>
        <div class="bl-slot-box"><span class="bl-slot-k">ENGINE</span><span class="bl-slot-v">${FRAME_PARTS[saved.engine].name}</span></div>
      </div>

      <div class="bl-stats-bar">
        <span>HULL <strong>${hullHp.toLocaleString('en-US')} HP</strong></span>
        <span>LEGS <strong>${legHp.toLocaleString('en-US')} HP</strong></span>
        <span>WALK <strong>${walkMs} m/s</strong></span>
        <span>DRIVE <strong>${driveName}</strong></span>
        <span>SHOULDERS <strong>${stats.shoulders} / 3</strong></span>
      </div>

      <div class="bl-actions">
        <button class="bl-btn primary bl-frame-board" type="button">DEPLOY &amp; BOARD NOW</button>
        <button class="bl-btn bl-frame-pad" type="button">DEPLOY FRESH ON PAD</button>
        <button class="bl-btn ghost bl-frame-custom" type="button">CUSTOMIZE FRAME LOADOUT</button>
      </div>
    `;

    card.querySelector('.bl-frame-board')?.addEventListener('click', () => {
      this.cb.onSpawnFrame(true);
      this.close();
    });
    card.querySelector('.bl-frame-pad')?.addEventListener('click', () => {
      this.cb.onSpawnFrame(false);
      this.close();
    });
    card.querySelector('.bl-frame-custom')?.addEventListener('click', () => {
      this.open = false;
      this.suspendedForCustomize = true;
      this.wrapEl?.classList.remove('open');
      this.cb.onCustomizeFrame(() => this.resumeFromCustomize());
    });

    this.bodyEl.appendChild(card);
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown, true);
    }
    this.wrapEl?.remove();
    this.wrapEl = null;
    this.bodyEl = null;
  }
}

/** World interaction controller for the Badlands / Endless War Motor Pool & Frame Terminal kiosk. */
export class BadlandsTerminalController {
  readonly ui: BadlandsTerminalUi;
  private readonly terminalPos: readonly [number, number, number];
  private readonly promptPos: THREE.Vector3;
  private unprompt: (() => void) | null = null;
  private promptKey = '';

  constructor(
    private readonly ctx: Ctx,
    private readonly getFrameStatus: () => BadlandsFrameStatus,
    private readonly getUnoccupiedVehicles: () => number,
    terminalPos: readonly [number, number, number] = BADLANDS_TERMINAL,
  ) {
    this.terminalPos = terminalPos;
    this.promptPos = new THREE.Vector3(terminalPos[0], terminalPos[1] + 2.5, terminalPos[2]);
    this.ui = new BadlandsTerminalUi(ctx, {
      onSpawnFrame: boardNow => {
        ctx.events.emit('badlands:spawn_frame', { board: boardNow });
        ctx.audio?.play?.('ui_confirm');
      },
      onSpawnVehicle: (id, boardNow) => {
        ctx.events.emit('badlands:spawn_vehicle', { id, board: boardNow });
        ctx.audio?.play?.('ui_confirm');
      },
      onCustomizeFrame: onDone => {
        ctx.events.emit('badlands:customize_frame', { onDone });
      },
      onClearVehicles: () => {
        ctx.events.emit('badlands:clear_vehicles', {});
        ctx.audio?.play?.('ui_confirm');
      },
      frameStatus: () => this.getFrameStatus(),
      unoccupiedVehicleCount: () => this.getUnoccupiedVehicles(),
    });
  }

  get open(): boolean {
    return this.ui.open;
  }

  update(canInteract: boolean): void {
    const { input, player } = this.ctx;
    if (!canInteract || !player.alive || player.parked || this.ui.open) {
      this.clearPrompt();
      return;
    }

    const dist = Math.hypot(
      player.position.x - this.terminalPos[0],
      player.position.z - this.terminalPos[2],
    );
    if (dist > TERMINAL_INTERACT_RANGE) {
      this.clearPrompt();
      return;
    }

    const key = input.labelFor?.('interact') ?? 'E';
    this.setPrompt(`[${key}] MOTOR POOL & FRAME TERMINAL`, '#38e8ff');
    if (input.pressed?.('interact')) {
      this.clearPrompt();
      this.ui.openTab(this.ui.activeTab);
    }
  }

  close(): void {
    this.clearPrompt();
    this.ui.close();
  }

  reset(): void {
    this.clearPrompt();
    this.ui.close(true);
  }

  dispose(): void {
    this.clearPrompt();
    this.ui.dispose();
  }

  private setPrompt(label: string, color: string): void {
    const key = `${label}|${color}`;
    if (this.promptKey === key && this.unprompt) return;
    this.clearPrompt();
    this.promptKey = key;
    this.unprompt = this.ctx.hud?.follow?.(this.promptPos, label, color) ?? null;
  }

  private clearPrompt(): void {
    if (this.unprompt) {
      this.unprompt();
      this.unprompt = null;
    }
    this.promptKey = '';
  }
}
