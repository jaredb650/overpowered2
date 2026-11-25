/**
 * War Command Console UI (`WarCommandUi`) for Endless War.
 *
 * Lets the player spend combat & sabotage credits on big allied momentum boosts without
 * micromanaging their autonomous friendly army:
 *   - Armored Spearhead (3 Aegis MBTs + 2 Bastion guntrucks)
 *   - Airborne Platoon Drop (2 Valkyries fast-roping 10 veteran soldiers onto the frontline)
 *   - Fighter & Bomber Strike Wing (Allied F-22 Raptors + Kestrel gunship sweep)
 *   - Rolling Artillery Barrage (14 heavy 155 mm howitzer shells pounding enemy frontline)
 *   - Total Mobilization (2x autonomous friendly infantry & armor tempo for 60 s)
 *   - FOB Repair & Defense Overdrive (+25% FOB Core HP + CIWS/SAM overdrive for 45 s)
 *
 * Accessible via [E] at the amber War Command Console inside Friendly FOB Vanguard OR
 * via [O] Field Radio anywhere on the battlefield.
 */
import type { Ctx } from '../../core/contracts';

export type WarBoostId =
  | 'spearhead'
  | 'airborne'
  | 'air_wing'
  | 'artillery'
  | 'mobilize'
  | 'fob_overdrive';

export interface WarBoostSpec {
  readonly id: WarBoostId;
  readonly name: string;
  readonly tag: string;
  readonly cost: number;
  readonly cooldown: number;
  readonly summary: string;
  readonly hotkey: string;
}

export const WAR_BOOSTS: readonly WarBoostSpec[] = [
  {
    id: 'spearhead',
    name: 'Armored Spearhead',
    tag: 'ARMOR COLUMN',
    cost: 2000,
    cooldown: 75,
    summary: 'Launches 3 friendly Aegis MBTs + 2 Bastion guntrucks straight up the Center Highway Bridge.',
    hotkey: '1',
  },
  {
    id: 'airborne',
    name: 'Airborne Platoon Drop',
    tag: 'FAST-ROPE',
    cost: 1500,
    cooldown: 60,
    summary: '2 Valkyrie transports drop 10 veteran allies (rocketeers, gunners, shields, medics) on the front.',
    hotkey: '2',
  },
  {
    id: 'air_wing',
    name: 'Fighter & Gunship Wing',
    tag: 'AIR SUPERIORITY',
    cost: 2500,
    cooldown: 90,
    summary: 'Deploys 2 allied F-22 Raptors + 1 Kestrel attack gunship to clear hostile aircraft and North armor.',
    hotkey: '3',
  },
  {
    id: 'artillery',
    name: 'Rolling Artillery Barrage',
    tag: 'FIRE SUPPORT',
    cost: 1800,
    cooldown: 65,
    summary: 'Calls 14 heavy 155 mm howitzer salvos across enemy bridgeheads, tanks, and clustered infantry.',
    hotkey: '4',
  },
  {
    id: 'mobilize',
    name: 'Total Mobilization',
    tag: '60s SURGE',
    cost: 2200,
    cooldown: 90,
    summary: 'Doubles autonomous friendly infantry and armor spawn cadence across West, Center, and East lanes.',
    hotkey: '5',
  },
  {
    id: 'fob_overdrive',
    name: 'FOB Repair & Overdrive',
    tag: 'BASE DEFENSE',
    cost: 2000,
    cooldown: 90,
    summary: 'Restores +25% FOB Command Core HP and overclocks all 4 perimeter CIWS/SAM bastions for 45 s.',
    hotkey: '6',
  },
];

export interface WarCommandCallbacks {
  getCredits(): number;
  getCooldown(id: WarBoostId): number;
  getFobHpPct(): number;
  getThreatLevel(): number;
  onOrder(id: WarBoostId): boolean;
  onClose?: () => void;
}

const STYLE_ID = 'op2-war-command-css';

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.ew-cmd-backdrop {
  position: fixed; inset: 0; z-index: 62;
  background: rgba(8, 10, 13, 0.72);
  backdrop-filter: blur(5px);
  display: flex; align-items: center; justify-content: center;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #edf2f7;
}
.ew-cmd-panel {
  width: min(860px, 94vw);
  background: linear-gradient(180deg, rgba(22, 25, 30, 0.97), rgba(14, 16, 20, 0.98));
  border: 1px solid rgba(255, 180, 56, 0.45);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 210, 120, 0.14);
  border-radius: 6px;
  overflow: hidden;
}
.ew-cmd-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px;
  background: rgba(255, 174, 46, 0.1);
  border-bottom: 1px solid rgba(255, 180, 56, 0.25);
}
.ew-cmd-title { font-size: 1.05rem; font-weight: 800; letter-spacing: 0.14em; color: #ffbe4f; }
.ew-cmd-sub { font-size: 0.74rem; letter-spacing: 0.08em; color: #a8b3c2; margin-top: 2px; }
.ew-cmd-stats { display: flex; gap: 16px; align-items: center; }
.ew-cmd-cr { font-size: 1.1rem; font-weight: 800; color: #5ef2a8; letter-spacing: 0.05em; }
.ew-cmd-close {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
  color: #e2e8f0; padding: 6px 12px; border-radius: 4px; cursor: pointer;
  font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em;
}
.ew-cmd-close:hover { background: rgba(255,255,255,0.16); }
.ew-cmd-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px; padding: 18px 22px 22px;
}
.ew-cmd-card {
  display: flex; flex-direction: column; justify-content: space-between; gap: 10px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.14s, background 0.14s, transform 0.1s;
}
.ew-cmd-card:hover:not(:disabled) {
  border-color: rgba(255, 190, 79, 0.8);
  background: rgba(255, 180, 56, 0.11);
  transform: translateY(-1px);
}
.ew-cmd-card:disabled { opacity: 0.48; cursor: not-allowed; }
.ew-cmd-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.ew-cmd-name { font-size: 0.94rem; font-weight: 800; color: #f8fafc; letter-spacing: 0.04em; }
.ew-cmd-tag {
  font-size: 0.66rem; font-weight: 700; letter-spacing: 0.1em;
  padding: 2px 7px; border-radius: 3px;
  background: rgba(255, 190, 79, 0.18); color: #ffca6b;
}
.ew-cmd-desc { font-size: 0.79rem; line-height: 1.4; color: #b8c2d0; }
.ew-cmd-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
.ew-cmd-price { font-size: 0.84rem; font-weight: 800; color: #5ef2a8; }
.ew-cmd-price.short { color: #ff7a6b; }
.ew-cmd-cd { font-size: 0.75rem; font-weight: 700; color: #ffb347; letter-spacing: 0.06em; }
.ew-cmd-hint {
  padding: 10px 22px 14px; font-size: 0.74rem; color: #8c98a8;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  display: flex; justify-content: space-between;
}
`;
  document.head.appendChild(s);
}

export class WarCommandUi {
  private root: HTMLDivElement | null = null;
  private isOpen = false;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly cb: WarCommandCallbacks,
  ) {}

  get open(): boolean {
    return this.isOpen;
  }

  show(): void {
    if (this.isOpen || typeof document === 'undefined') return;
    ensureStyles();
    this.isOpen = true;
    this.ctx.input?.releaseLock?.();
    this.ctx.events?.emit?.('badlands:modal', { open: true });

    const backdrop = document.createElement('div');
    backdrop.className = 'ew-cmd-backdrop';
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) this.close();
    });
    this.root = backdrop;
    document.body.appendChild(backdrop);

    this.keyListener = (e: KeyboardEvent) => {
      if (!this.isOpen) return;
      if (e.code === 'Escape' || e.code === 'KeyO') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      const match = WAR_BOOSTS.find(b => `Digit${b.hotkey}` === e.code);
      if (match) {
        e.preventDefault();
        e.stopPropagation();
        if (this.cb.onOrder(match.id)) this.close();
        else this.render();
      }
    };
    window.addEventListener('keydown', this.keyListener, true);
    this.render();
  }

  render(): void {
    if (!this.isOpen || !this.root) return;
    const credits = Math.floor(this.cb.getCredits());
    const fobPct = Math.round(this.cb.getFobHpPct() * 100);
    const threat = this.cb.getThreatLevel();

    const cards = WAR_BOOSTS.map(b => {
      const cd = Math.ceil(this.cb.getCooldown(b.id));
      const canAfford = credits >= b.cost;
      const disabled = cd > 0 || !canAfford;
      const status = cd > 0
        ? `<span class="ew-cmd-cd">REARMING ${cd}s</span>`
        : `<span class="ew-cmd-cd" style="color:#7de2ff">[${b.hotkey}] READY</span>`;
      return `
        <button class="ew-cmd-card" data-boost="${b.id}" ${disabled ? 'disabled' : ''}>
          <div>
            <div class="ew-cmd-row">
              <span class="ew-cmd-name">${b.name}</span>
              <span class="ew-cmd-tag">${b.tag}</span>
            </div>
            <div class="ew-cmd-desc">${b.summary}</div>
          </div>
          <div class="ew-cmd-foot">
            <span class="ew-cmd-price ${canAfford ? '' : 'short'}">${b.cost.toLocaleString()} CR</span>
            ${status}
          </div>
        </button>`;
    }).join('');

    this.root.innerHTML = `
      <div class="ew-cmd-panel">
        <div class="ew-cmd-head">
          <div>
            <div class="ew-cmd-title">WAR COMMAND — REINFORCEMENT DISPATCH</div>
            <div class="ew-cmd-sub">THREAT ${threat} · FOB CORE ${fobPct}% · AUTONOMOUS ARMY ACTIVE</div>
          </div>
          <div class="ew-cmd-stats">
            <span class="ew-cmd-cr">${credits.toLocaleString()} CR</span>
            <button class="ew-cmd-close" data-close="1">CLOSE [ESC]</button>
          </div>
        </div>
        <div class="ew-cmd-grid">${cards}</div>
        <div class="ew-cmd-hint">
          <span>Your friendly army pushes automatically — spend credits here for heavy breakthrough waves.</span>
          <span>Hotkeys [1–6] · Radio [O]</span>
        </div>
      </div>
    `;

    this.root.querySelector('[data-close="1"]')?.addEventListener('click', () => this.close());
    this.root.querySelectorAll<HTMLButtonElement>('[data-boost]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.boost as WarBoostId;
        if (this.cb.onOrder(id)) this.close();
        else this.render();
      });
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener, true);
      this.keyListener = null;
    }
    this.root?.remove();
    this.root = null;
    this.ctx.events?.emit?.('badlands:modal', { open: false });
    this.ctx.input?.requestLock?.();
    this.cb.onClose?.();
  }

  dispose(): void {
    this.close();
  }
}
