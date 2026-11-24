/**
 * Dogfight HUD Carrier Status Strip & Interactive Deck Terminal Modal (`DogfightTerminalUi`).
 *
 * Provides:
 *   1. Sleek top-center Carrier Integrity + Credits + Wave/Defense status strip (visible during play).
 *   2. Interactive two-tab Deck Terminal overlay (`aircraft` | `defenses`):
 *        - FLIGHT DECK HANGAR: select any playable aircraft (F/A-18E Super Hornet, F-22 Raptor,
 *          B-1 Lancer, AV-8B Harrier, A-10 Warthog, Kestrel Attack Chopper) and spawn or launch!
 *        - CARRIER DEFENSES: spend combat credits on CIWS Phalanx, SeaRAM SAMs, Hull Armor &
 *          Auto-Repair, Allied AI Wingman Escort, Emergency Repair, or Call Next Wave early.
 *
 * Releases pointer lock cleanly when opened and restores lock seamlessly on close.
 */
import type { Ctx } from '../../core/contracts';
import type { DriveVehicleId } from '../../vehicles/drive/types';
import type { CarrierDefenseSystem, CarrierUpgradeId } from './carrier';

declare module '../../core/contracts' {
  interface GameEvents {
    /** Dogfight Deck Command Terminal opened/closed — pauses gameplay cleanly without showing the Pause menu. */
    'dogfight:modal': { open: boolean };
  }
}

export type TerminalTab = 'aircraft' | 'defenses';

export interface HangarAircraftChoice {
  readonly id: DriveVehicleId;
  readonly name: string;
  readonly role: string;
  readonly weapons: string;
  readonly highlight: string;
}

export const HANGAR_AIRCRAFT: readonly HangarAircraftChoice[] = [
  {
    id: 'hornet',
    name: 'F/A-18E SUPER HORNET',
    role: 'All-Rounder Carrier Fighter',
    weapons: 'M61A2 Vulcan · AIM-9X / AIM-120D · Flare Burst',
    highlight: 'Balanced carrier agility, sharp radar pip & 2-seat WSO pod',
  },
  {
    id: 'raptor',
    name: 'F-22 RAPTOR',
    role: 'Air-Superiority Dogfighter',
    weapons: 'M61A2 Vulcan · Internal AIM-9X/120D · [Q] Cobra Turn',
    highlight: '2D thrust vectoring, extreme turn rate & Cobra AoA snap-turn',
  },
  {
    id: 'lancer',
    name: 'B-1 LANCER',
    role: 'Supersonic Swing-Wing Bomber',
    weapons: 'Rotary Cluster / Parachute Bombs · [Q] Dump-and-Burn',
    highlight: 'Swept-wing Mach sprint & massive area ordnance',
  },
  {
    id: 'harrier',
    name: 'AV-8B HARRIER',
    role: 'VTOL / STOL Jump-Jet',
    weapons: '25mm GAU-12 · AIM-9X / Hydra Pods · [Q] VTOL Hover',
    highlight: 'Effortless carrier hover landings & nimble turn fights',
  },
  {
    id: 'warthog',
    name: 'A-10 WARTHOG',
    role: 'Armored Gunfighter',
    weapons: '30mm GAU-8 BRRRT · Heavy Rocket Pods · Heavy Armor',
    highlight: 'Devastating rotary cannon & massive airframe durability',
  },
  {
    id: 'kestrel',
    name: 'KESTREL ATTACK CHOPPER',
    role: 'Hovering Gunship',
    weapons: '30mm Chain Gun · Homing Hellfires · 360° Hover',
    highlight: 'Hover right over USS Sovereign as a mobile flak gunship',
  },
];

export interface TerminalUiCallbacks {
  onSelectAircraft(id: DriveVehicleId, boardNow: boolean): void;
  onBuyUpgrade(id: CarrierUpgradeId): void;
  onCallNextWave(): void;
  canCallNextWave(): boolean;
  waveSummary(): string;
}

const STYLE_ID = 'op2-dogfight-terminal-css';

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .df-hud {
      position: fixed;
      top: 0.45rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 32;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 1.2rem;
      padding: 0.34rem 0.95rem;
      background: rgba(7, 13, 20, 0.8);
      border: 1px solid rgba(56, 232, 255, 0.34);
      border-top: 2px solid #38e8ff;
      color: #e8f3fa;
      font-family: var(--mono, ui-monospace, monospace);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
      min-width: 31rem;
    }
    body:has(.df-hud) .gn-top { top: 4.75rem; }
    .df-hud.hit {
      border-color: rgba(255, 77, 61, 0.85);
      border-top-color: #ff4d3d;
      background: rgba(34, 10, 12, 0.86);
    }
    .df-hull { flex: 1 1 auto; min-width: 21.5rem; }
    .df-hull-top {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1.15rem;
      white-space: nowrap;
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      margin-bottom: 0.25rem;
      color: #9dc3d8;
    }
    .df-hull-top strong { color: #e8f7ff; font-weight: 700; }
    .df-bar {
      height: 0.52rem;
      background: rgba(255, 255, 255, 0.14);
      overflow: hidden;
    }
    .df-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #27d7ff, #54ff9d);
      transition: width 120ms ease-out;
    }
    .df-bar-fill.warn { background: linear-gradient(90deg, #ff9922, #ffda44); }
    .df-bar-fill.crit { background: linear-gradient(90deg, #ff2a2a, #ff7043); }
    .df-stat {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      white-space: nowrap;
    }
    .df-stat-k { font-size: 0.68rem; letter-spacing: 0.09em; color: #8da9bc; }
    .df-stat-v { font-size: 1.08rem; font-weight: 800; color: #ffd166; }
    .df-stat-v.cyan { color: #38e8ff; font-size: 0.86rem; }

    .df-modal-wrap {
      position: fixed;
      inset: 0;
      z-index: 95;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(4, 9, 15, 0.74);
      backdrop-filter: blur(4px);
      font-family: var(--mono, ui-monospace, monospace);
      color: #eaf5fc;
    }
    .df-modal-wrap.open { display: flex; }
    .df-modal {
      width: min(64rem, 94vw);
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      background: rgba(9, 15, 23, 0.96);
      border: 1px solid rgba(56, 232, 255, 0.35);
      border-top: 3px solid #38e8ff;
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.72);
      overflow: hidden;
    }
    .df-mhead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.95rem 1.35rem;
      background: rgba(15, 24, 36, 0.95);
      border-bottom: 1px solid rgba(157, 176, 189, 0.2);
    }
    .df-mtitle {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      color: #ffffff;
    }
    .df-mmeta {
      display: flex;
      align-items: center;
      gap: 1.2rem;
      font-size: 0.95rem;
    }
    .df-mcred { color: #ffd166; font-weight: 800; }
    .df-mhull { color: #54ff9d; font-weight: 700; }
    .df-tabs {
      display: flex;
      gap: 0.35rem;
      padding: 0.7rem 1.35rem 0;
      border-bottom: 1px solid rgba(157, 176, 189, 0.18);
    }
    .df-tab {
      appearance: none;
      border: 1px solid transparent;
      border-bottom: none;
      background: rgba(255, 255, 255, 0.04);
      color: #93afc2;
      padding: 0.55rem 1.15rem;
      font: 700 0.88rem/1 var(--mono, ui-monospace, monospace);
      letter-spacing: 0.08em;
      cursor: pointer;
    }
    .df-tab.active {
      background: rgba(56, 232, 255, 0.14);
      border-color: rgba(56, 232, 255, 0.45);
      color: #ffffff;
    }
    .df-mbody {
      padding: 1.15rem 1.35rem;
      overflow-y: auto;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.85rem;
    }
    .df-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 0.65rem;
      padding: 0.9rem 1rem;
      background: rgba(18, 28, 40, 0.78);
      border: 1px solid rgba(157, 176, 189, 0.22);
    }
    .df-card.selected {
      border-color: #38e8ff;
      background: rgba(18, 44, 58, 0.82);
    }
    .df-card-h {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.5rem;
    }
    .df-card-name { font-size: 1.05rem; font-weight: 800; color: #ffffff; letter-spacing: 0.04em; }
    .df-card-tag { font-size: 0.75rem; color: #38e8ff; font-weight: 700; white-space: nowrap; }
    .df-card-tag.amber { color: #ffd166; }
    .df-card-sub { font-size: 0.8rem; color: #9eb7c7; line-height: 1.38; }
    .df-card-wep { font-size: 0.76rem; color: #cfe2ee; }
    .df-actions { display: flex; gap: 0.5rem; margin-top: 0.2rem; }
    .df-btn {
      appearance: none;
      border: 1px solid rgba(56, 232, 255, 0.5);
      background: rgba(56, 232, 255, 0.16);
      color: #ffffff;
      padding: 0.48rem 0.85rem;
      font: 700 0.8rem/1 var(--mono, ui-monospace, monospace);
      letter-spacing: 0.06em;
      cursor: pointer;
    }
    .df-btn:hover:not(:disabled) { background: #38e8ff; color: #051018; }
    .df-btn.primary {
      border-color: #ff9f1c;
      background: rgba(255, 159, 28, 0.2);
      color: #ffe7b8;
    }
    .df-btn.primary:hover:not(:disabled) { background: #ff9f1c; color: #080a0d; }
    .df-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .df-mfoot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.8rem 1.35rem;
      background: rgba(12, 20, 30, 0.94);
      border-top: 1px solid rgba(157, 176, 189, 0.18);
      font-size: 0.82rem;
      color: #93afc2;
    }
  `;
  document.head.appendChild(style);
}

export class DogfightTerminalUi {
  open = false;
  activeTab: TerminalTab = 'aircraft';
  selectedAircraft: DriveVehicleId = 'hornet';

  private hudEl: HTMLElement | null = null;
  private hullTextEl: HTMLElement | null = null;
  private hullFillEl: HTMLElement | null = null;
  private credEl: HTMLElement | null = null;
  private defEl: HTMLElement | null = null;
  private waveEl: HTMLElement | null = null;

  private wrapEl: HTMLElement | null = null;
  private modalCredEl: HTMLElement | null = null;
  private modalHullEl: HTMLElement | null = null;
  private tabAircraftBtn: HTMLButtonElement | null = null;
  private tabDefensesBtn: HTMLButtonElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private nextWaveBtn: HTMLButtonElement | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return;
    if (e.code === 'Escape' || e.code === 'KeyB') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  constructor(
    private readonly ctx: Ctx,
    private readonly carrier: CarrierDefenseSystem,
    private readonly cb: TerminalUiCallbacks,
  ) {
    if (typeof document === 'undefined') return;
    ensureStyles();
    this.buildDom();
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  private buildDom(): void {
    // 1. Always-visible top-center USS Sovereign Carrier Status Strip
    const hud = document.createElement('div');
    hud.className = 'df-hud';
    hud.style.display = 'none';
    hud.innerHTML = `
      <div class="df-hull">
        <div class="df-hull-top"><span>USS SOVEREIGN · CVN-88</span><strong class="df-hp-val">2500 / 2500</strong></div>
        <div class="df-bar"><div class="df-bar-fill" style="width:100%"></div></div>
      </div>
      <div class="df-stat"><span class="df-stat-k">CREDITS</span><span class="df-stat-v df-cr-val">350 CR</span></div>
      <div class="df-stat"><span class="df-stat-k">DEFENSES</span><span class="df-stat-v cyan df-def-val">CIWS 0 · SAM 0 · WING 0</span></div>
      <div class="df-stat"><span class="df-stat-k">AIRSPACE</span><span class="df-stat-v cyan df-wv-val">STANDBY</span></div>
    `;
    document.body.appendChild(hud);
    this.hudEl = hud;
    this.hullTextEl = hud.querySelector('.df-hp-val');
    this.hullFillEl = hud.querySelector('.df-bar-fill');
    this.credEl = hud.querySelector('.df-cr-val');
    this.defEl = hud.querySelector('.df-def-val');
    this.waveEl = hud.querySelector('.df-wv-val');

    // 2. Interactive Deck Terminal Modal
    const wrap = document.createElement('div');
    wrap.className = 'df-modal-wrap';
    wrap.innerHTML = `
      <div class="df-modal">
        <div class="df-mhead">
          <div class="df-mtitle">USS SOVEREIGN // DECK COMMAND TERMINAL</div>
          <div class="df-mmeta">
            <span class="df-mhull">HULL 2500/2500</span>
            <span class="df-mcred">350 CR</span>
            <button class="df-btn df-close-btn" type="button">CLOSE [ESC]</button>
          </div>
        </div>
        <div class="df-tabs">
          <button class="df-tab df-tab-air" type="button">FLIGHT DECK HANGAR</button>
          <button class="df-tab df-tab-def" type="button">CARRIER DEFENSES</button>
        </div>
        <div class="df-mbody"></div>
        <div class="df-mfoot">
          <span>Land back on the flight deck anytime to repair your jet, switch aircraft, or upgrade carrier defenses.</span>
          <button class="df-btn primary df-next-wave" type="button" style="display:none">CALL NEXT WAVE NOW</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    this.wrapEl = wrap;
    this.modalCredEl = wrap.querySelector('.df-mcred');
    this.modalHullEl = wrap.querySelector('.df-mhull');
    this.tabAircraftBtn = wrap.querySelector('.df-tab-air');
    this.tabDefensesBtn = wrap.querySelector('.df-tab-def');
    this.bodyEl = wrap.querySelector('.df-mbody');
    this.nextWaveBtn = wrap.querySelector('.df-next-wave');

    wrap.querySelector('.df-close-btn')?.addEventListener('click', () => this.close());
    this.tabAircraftBtn?.addEventListener('click', () => {
      this.activeTab = 'aircraft';
      this.renderModal();
    });
    this.tabDefensesBtn?.addEventListener('click', () => {
      this.activeTab = 'defenses';
      this.renderModal();
    });
    this.nextWaveBtn?.addEventListener('click', () => {
      this.cb.onCallNextWave();
      this.close();
    });
  }

  setHudVisible(visible: boolean): void {
    if (this.hudEl) this.hudEl.style.display = visible ? 'flex' : 'none';
  }

  openTab(tab: TerminalTab): void {
    if (!this.wrapEl) return;
    this.activeTab = tab;
    this.open = true;
    this.wrapEl.classList.add('open');
    this.ctx.events.emit('dogfight:modal', { open: true });
    this.renderModal();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.wrapEl?.classList.remove('open');
    this.ctx.events.emit('dogfight:modal', { open: false });
    this.ctx.input.endFrame?.();
  }

  updateHud(): void {
    if (!this.hudEl) return;
    const hp = Math.ceil(this.carrier.hp);
    const maxHp = Math.max(1, Math.round(this.carrier.maxHp));
    const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));

    this.hudEl.classList.toggle('hit', this.carrier.underAttack);
    if (this.hullTextEl) this.hullTextEl.textContent = `${hp.toLocaleString('en-US')} / ${maxHp.toLocaleString('en-US')} (${Math.round(pct)}%)`;
    if (this.hullFillEl) {
      this.hullFillEl.style.width = `${pct.toFixed(1)}%`;
      this.hullFillEl.classList.toggle('warn', pct <= 55 && pct > 25);
      this.hullFillEl.classList.toggle('crit', pct <= 25);
    }
    if (this.credEl) this.credEl.textContent = `${this.carrier.credits.toLocaleString('en-US')} CR`;
    if (this.defEl) this.defEl.textContent = `CIWS ${this.carrier.ciwsLevel} · SAM ${this.carrier.samLevel} · WING ${this.carrier.wingmanLevel}`;
    if (this.waveEl) this.waveEl.textContent = this.cb.waveSummary();

    if (this.open) {
      if (this.modalCredEl) this.modalCredEl.textContent = `${this.carrier.credits.toLocaleString('en-US')} CR`;
      if (this.modalHullEl) this.modalHullEl.textContent = `HULL ${hp}/${maxHp}`;
      if (this.nextWaveBtn) this.nextWaveBtn.style.display = this.cb.canCallNextWave() ? '' : 'none';
    }
  }

  renderModal(): void {
    if (!this.bodyEl) return;
    this.tabAircraftBtn?.classList.toggle('active', this.activeTab === 'aircraft');
    this.tabDefensesBtn?.classList.toggle('active', this.activeTab === 'defenses');
    if (this.nextWaveBtn) this.nextWaveBtn.style.display = this.cb.canCallNextWave() ? '' : 'none';

    this.bodyEl.replaceChildren();

    if (this.activeTab === 'aircraft') {
      for (const a of HANGAR_AIRCRAFT) {
        const card = document.createElement('div');
        card.className = `df-card${this.selectedAircraft === a.id ? ' selected' : ''}`;
        card.innerHTML = `
          <div>
            <div class="df-card-h">
              <span class="df-card-name">${a.name}</span>
              <span class="df-card-tag">${a.role}</span>
            </div>
            <div class="df-card-wep" style="margin-top:0.35rem">${a.weapons}</div>
            <div class="df-card-sub" style="margin-top:0.3rem">${a.highlight}</div>
          </div>
          <div class="df-actions">
            <button class="df-btn df-spawn-btn" type="button">STAGE ON CATAPULT</button>
            <button class="df-btn primary df-launch-btn" type="button">LAUNCH NOW</button>
          </div>
        `;
        card.querySelector('.df-spawn-btn')?.addEventListener('click', () => {
          this.selectedAircraft = a.id;
          this.cb.onSelectAircraft(a.id, false);
          this.close();
        });
        card.querySelector('.df-launch-btn')?.addEventListener('click', () => {
          this.selectedAircraft = a.id;
          this.cb.onSelectAircraft(a.id, true);
          this.close();
        });
        this.bodyEl.appendChild(card);
      }
      return;
    }

    // Carrier Defenses tab
    for (const u of this.carrier.upgradeCatalog()) {
      const canAfford = !u.maxed && this.carrier.credits >= u.nextCost;
      const lvlText = u.id === 'repair' ? 'REPEATABLE' : `LV ${u.level} / ${u.maxLevel}`;
      const btnText = u.maxed ? 'MAXED OUT' : `BUY · ${u.nextCost} CR`;
      const card = document.createElement('div');
      card.className = 'df-card';
      card.innerHTML = `
        <div>
          <div class="df-card-h">
            <span class="df-card-name">${u.name}</span>
            <span class="df-card-tag amber">${lvlText}</span>
          </div>
          <div class="df-card-sub" style="margin-top:0.35rem">${u.summary}</div>
        </div>
        <div class="df-actions">
          <button class="df-btn primary df-buy-btn" type="button" ${canAfford ? '' : 'disabled'}>${btnText}</button>
        </div>
      `;
      card.querySelector('.df-buy-btn')?.addEventListener('click', () => {
        this.cb.onBuyUpgrade(u.id);
        this.renderModal();
        this.updateHud();
      });
      this.bodyEl.appendChild(card);
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown, true);
    }
    this.hudEl?.remove();
    this.wrapEl?.remove();
    this.hudEl = null;
    this.wrapEl = null;
  }
}
