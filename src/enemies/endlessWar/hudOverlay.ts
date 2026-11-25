/**
 * Tactical War-Front HUD Overlay & 4-Second FOB Redeploy Screen (`EndlessWarHud`).
 *
 * Compact top-center war ticker showing:
 *   - Uncapped THREAT LEVEL + continuous escalation bar + elapsed war clock
 *   - Frontline sector status & 3 River Bridgehead control pips (W / C / E)
 *   - 5 Enemy Strategic Facility status pips (online vs sabotaged + rebuild timer)
 *   - Active MOMENTUM SURGE / TOTAL MOBILIZATION banner
 *   - FOB Vanguard Core HP alert (calm when safe, pulsing crimson when breached/damaged)
 *   - Crisp 4-second REDEPLOYING TO FOB VANGUARD overlay on player death
 */
import type { FacilityStateSnapshot } from './facilities';
import type { WarLaneId } from '../../world/map/endlessWar/plan';

export type BridgeOwner = 'friendly' | 'contested' | 'enemy';

export interface EndlessWarHudState {
  readonly elapsedSec: number;
  readonly threatLevel: number;
  readonly threatProgress: number;
  readonly frontlineStage: number; // 0..4
  readonly bridges: Readonly<Record<WarLaneId, BridgeOwner>>;
  readonly facilities: readonly FacilityStateSnapshot[];
  readonly fobHpFrac: number;
  readonly fobUnderAttack: boolean;
  readonly fobBreached: boolean;
  readonly momentumLeft: number;
  readonly mobilizeLeft: number;
  readonly credits: number;
  readonly redeployLeft: number; // > 0 while dead & respawning at FOB
}

const STAGE_NAMES = [
  'FOB DEFENSE',
  'SOUTH TRENCHES',
  'RIVER CROSSINGS',
  'NORTH DEFENSE BELT',
  'IRON BASTION ASSAULT',
] as const;

const STYLE_ID = 'op2-endless-war-hud-css';

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.ew-hud {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
  z-index: 26; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #edf2f7;
}
.ew-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 14px;
  background: rgba(11, 14, 18, 0.78);
  border: 1px solid rgba(180, 198, 218, 0.22);
  border-radius: 5px;
  backdrop-filter: blur(4px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.ew-threat { display: flex; flex-direction: column; gap: 2px; min-width: 96px; }
.ew-threat-top { display: flex; justify-content: space-between; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.1em; color: #ff7e5f; }
.ew-threat-track { width: 100%; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; overflow: hidden; }
.ew-threat-fill { height: 100%; background: linear-gradient(90deg, #ff9944, #ff3d3d); }
.ew-sep { width: 1px; height: 22px; background: rgba(255,255,255,0.14); }
.ew-front { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.ew-stage { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.12em; color: #dbe7f5; }
.ew-bridges { display: flex; gap: 5px; }
.ew-pip {
  font-size: 0.62rem; font-weight: 800; letter-spacing: 0.08em;
  padding: 1px 6px; border-radius: 3px; border: 1px solid transparent;
}
.ew-pip.friendly { background: rgba(46, 216, 255, 0.22); border-color: rgba(56, 232, 255, 0.65); color: #7ef2ff; }
.ew-pip.contested { background: rgba(255, 196, 62, 0.22); border-color: rgba(255, 196, 62, 0.65); color: #ffd470; }
.ew-pip.enemy { background: rgba(255, 68, 56, 0.20); border-color: rgba(255, 68, 56, 0.55); color: #ff8a80; }
.ew-facs { display: flex; gap: 4px; }
.ew-fac {
  font-size: 0.6rem; font-weight: 800; letter-spacing: 0.06em;
  padding: 2px 5px; border-radius: 3px;
}
.ew-fac.up { background: rgba(255, 64, 52, 0.22); color: #ff8f85; border: 1px solid rgba(255, 72, 60, 0.45); }
.ew-fac.down { background: rgba(74, 240, 152, 0.18); color: #7ef5b4; border: 1px solid rgba(74, 240, 152, 0.55); }
.ew-fob {
  font-size: 0.7rem; font-weight: 800; letter-spacing: 0.08em;
  padding: 3px 8px; border-radius: 4px;
  background: rgba(56, 224, 255, 0.14); border: 1px solid rgba(56, 224, 255, 0.4); color: #7cecff;
}
.ew-fob.danger {
  background: rgba(255, 48, 38, 0.3); border-color: #ff473d; color: #ffd3cf;
  animation: ew-pulse 0.8s infinite alternate;
}
@keyframes ew-pulse { from { opacity: 0.72; } to { opacity: 1; } }
.ew-surge {
  padding: 3px 12px; border-radius: 4px;
  font-size: 0.7rem; font-weight: 800; letter-spacing: 0.13em;
  background: rgba(255, 178, 46, 0.24); border: 1px solid rgba(255, 198, 72, 0.7); color: #ffe08a;
}
.ew-radio {
  font-size: 0.66rem; font-weight: 700; letter-spacing: 0.09em; color: #ffca6b;
  background: rgba(16, 18, 22, 0.7); padding: 2px 8px; border-radius: 3px;
  border: 1px solid rgba(255, 190, 79, 0.35);
}
.ew-redeploy {
  position: fixed; inset: 0; z-index: 54; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: radial-gradient(circle, rgba(16, 10, 10, 0.42), rgba(8, 6, 8, 0.78));
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}
.ew-redeploy-title { font-size: 1.8rem; font-weight: 900; letter-spacing: 0.18em; color: #ff6c5c; text-shadow: 0 2px 18px rgba(0,0,0,0.9); }
.ew-redeploy-sub { font-size: 1rem; font-weight: 700; letter-spacing: 0.12em; color: #d8e6f5; }
`;
  document.head.appendChild(s);
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export class EndlessWarHud {
  private el: HTMLDivElement | null = null;
  private redeployEl: HTMLDivElement | null = null;
  private updateAccum = 0;

  mount(): void {
    if (typeof document === 'undefined' || this.el) return;
    ensureStyles();
    this.el = document.createElement('div');
    this.el.className = 'ew-hud';
    document.body.appendChild(this.el);

    this.redeployEl = document.createElement('div');
    this.redeployEl.className = 'ew-redeploy';
    this.redeployEl.style.display = 'none';
    document.body.appendChild(this.redeployEl);
  }

  update(dt: number, state: EndlessWarHudState): void {
    if (!this.el || !this.redeployEl) return;

    if (state.redeployLeft > 0) {
      this.redeployEl.style.display = 'flex';
      this.redeployEl.innerHTML = `
        <div class="ew-redeploy-title">KIA — REDEPLOYING TO FOB VANGUARD</div>
        <div class="ew-redeploy-sub">RETURNING TO THE FRONT IN ${state.redeployLeft.toFixed(1)}s</div>
      `;
    } else {
      this.redeployEl.style.display = 'none';
    }

    this.updateAccum += dt;
    if (this.updateAccum < 0.2) return;
    this.updateAccum = 0;

    const stageName = STAGE_NAMES[Math.max(0, Math.min(STAGE_NAMES.length - 1, state.frontlineStage))] ?? 'FRONT';
    const fobPct = Math.ceil(state.fobHpFrac * 100);
    const fobDanger = state.fobUnderAttack || state.fobBreached || fobPct < 80;
    const facPips = state.facilities.map(f => {
      const label = f.alive ? f.shortName.split(' ')[0] : `${f.shortName.split(' ')[0]} ${f.rebuildLeft}s`;
      return `<span class="ew-fac ${f.alive ? 'up' : 'down'}">${label}</span>`;
    }).join('');

    const banners: string[] = [];
    if (state.momentumLeft > 0) banners.push(`MOMENTUM SURGE ${Math.ceil(state.momentumLeft)}s (+60% ALLY PUSH)`);
    if (state.mobilizeLeft > 0) banners.push(`TOTAL MOBILIZATION ${Math.ceil(state.mobilizeLeft)}s (2x ALLY TEMPO)`);

    this.el.innerHTML = `
      <div class="ew-bar">
        <div class="ew-threat">
          <div class="ew-threat-top">
            <span>THREAT ${state.threatLevel}</span>
            <span>${formatTime(state.elapsedSec)}</span>
          </div>
          <div class="ew-threat-track">
            <div class="ew-threat-fill" style="width:${Math.round(state.threatProgress * 100)}%"></div>
          </div>
        </div>
        <div class="ew-sep"></div>
        <div class="ew-front">
          <div class="ew-stage">${stageName}</div>
          <div class="ew-bridges">
            <span class="ew-pip ${state.bridges.west}">W BRIDGE</span>
            <span class="ew-pip ${state.bridges.center}">C VIADUCT</span>
            <span class="ew-pip ${state.bridges.east}">E DAM</span>
          </div>
        </div>
        <div class="ew-sep"></div>
        <div class="ew-facs">${facPips}</div>
        <div class="ew-sep"></div>
        <div class="ew-fob ${fobDanger ? 'danger' : ''}">FOB ${fobPct}%</div>
        <div class="ew-radio">[O] WAR CMD · ${Math.floor(state.credits).toLocaleString()} CR</div>
      </div>
      ${banners.length > 0 ? `<div class="ew-surge">${banners.join('  ·  ')}</div>` : ''}
    `;
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
    this.redeployEl?.remove();
    this.redeployEl = null;
  }
}
