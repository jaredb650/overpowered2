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
import type { BastionGateSnapshot } from './bastionDefense';
import type { FacilityStateSnapshot } from './facilities';
import type { WarLaneId } from '../../world/map/endlessWar/plan';

export type BridgeOwner = 'friendly' | 'contested' | 'enemy';

export interface EndlessWarHudState {
  readonly elapsedSec: number;
  readonly threatLevel: number;
  readonly threatProgress: number;
  readonly frontlineStage: number; // 0..4
  readonly bridges: Readonly<Record<WarLaneId, BridgeOwner>>;
  readonly gates?: readonly BastionGateSnapshot[];
  readonly facilities: readonly FacilityStateSnapshot[];
  readonly fobHpFrac: number;
  readonly fobUnderAttack: boolean;
  readonly fobBreached: boolean;
  readonly momentumLeft: number;
  readonly mobilizeLeft: number;
  readonly credits: number;
  readonly redeployLeft: number; // > 0 while dead & respawning at FOB
  readonly tacticalAlert?: { readonly text: string; readonly tone: 'danger' | 'warn' | 'ally' } | null;
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
  display: flex; align-items: center; gap: 11px;
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
.ew-gates { display: flex; align-items: center; gap: 3px; }
.ew-gate-lbl { font-size: 0.58rem; font-weight: 800; letter-spacing: 0.08em; color: #b6c4d4; margin-right: 2px; }
.ew-gate {
  font-size: 0.58rem; font-weight: 800; letter-spacing: 0.06em;
  padding: 2px 4px; border-radius: 3px;
}
.ew-gate.sealed { background: rgba(255, 92, 52, 0.22); color: #ff9c82; border: 1px solid rgba(255, 92, 52, 0.5); }
.ew-gate.open { background: rgba(56, 232, 255, 0.22); color: #7ef2ff; border: 1px solid rgba(56, 232, 255, 0.65); }
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
.ew-alert {
  padding: 3px 12px; border-radius: 4px;
  font-size: 0.7rem; font-weight: 800; letter-spacing: 0.13em;
}
.ew-alert.danger {
  background: rgba(255, 44, 36, 0.32); border: 1px solid #ff473d; color: #ffd3cf;
  animation: ew-pulse 0.75s infinite alternate;
}
.ew-alert.warn {
  background: rgba(255, 152, 46, 0.26); border: 1px solid rgba(255, 168, 56, 0.75); color: #ffd996;
}
.ew-alert.ally {
  background: rgba(46, 216, 255, 0.22); border: 1px solid rgba(56, 232, 255, 0.7); color: #8af4ff;
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
  private redeploySubEl: HTMLDivElement | null = null;
  private threatLblEl: HTMLSpanElement | null = null;
  private clockEl: HTMLSpanElement | null = null;
  private threatFillEl: HTMLDivElement | null = null;
  private stageEl: HTMLDivElement | null = null;
  private bridgeWEl: HTMLSpanElement | null = null;
  private bridgeCEl: HTMLSpanElement | null = null;
  private bridgeEEl: HTMLSpanElement | null = null;
  private gateSepEl: HTMLDivElement | null = null;
  private gatesWrapEl: HTMLDivElement | null = null;
  private gateEls: HTMLSpanElement[] = [];
  private facsWrapEl: HTMLDivElement | null = null;
  private facEls: HTMLSpanElement[] = [];
  private fobEl: HTMLDivElement | null = null;
  private radioEl: HTMLDivElement | null = null;
  private alertEl: HTMLDivElement | null = null;
  private surgeEl: HTMLDivElement | null = null;

  private updateAccum = 0;
  private lastRedeployShown = false;
  private lastRedeployText = '';
  private lastThreat = -1;
  private lastClockSec = -1;
  private lastThreatPct = -1;
  private lastStage = -1;
  private lastBridgeW = '';
  private lastBridgeC = '';
  private lastBridgeE = '';
  private lastFobText = '';
  private lastFobDanger = false;
  private lastCredits = -1;
  private lastAlertKey = '';
  private lastSurgeText = '';

  mount(): void {
    if (typeof document === 'undefined' || this.el) return;
    ensureStyles();
    const el = document.createElement('div');
    el.className = 'ew-hud';

    const bar = document.createElement('div');
    bar.className = 'ew-bar';

    const threat = document.createElement('div');
    threat.className = 'ew-threat';
    const threatTop = document.createElement('div');
    threatTop.className = 'ew-threat-top';
    const threatLbl = document.createElement('span');
    const clock = document.createElement('span');
    threatTop.append(threatLbl, clock);
    const threatTrack = document.createElement('div');
    threatTrack.className = 'ew-threat-track';
    const threatFill = document.createElement('div');
    threatFill.className = 'ew-threat-fill';
    threatTrack.appendChild(threatFill);
    threat.append(threatTop, threatTrack);

    const sep1 = document.createElement('div');
    sep1.className = 'ew-sep';

    const front = document.createElement('div');
    front.className = 'ew-front';
    const stage = document.createElement('div');
    stage.className = 'ew-stage';
    const bridges = document.createElement('div');
    bridges.className = 'ew-bridges';
    const bW = document.createElement('span');
    bW.textContent = 'W BRIDGE';
    const bC = document.createElement('span');
    bC.textContent = 'C VIADUCT';
    const bE = document.createElement('span');
    bE.textContent = 'E DAM';
    bridges.append(bW, bC, bE);
    front.append(stage, bridges);

    const gateSep = document.createElement('div');
    gateSep.className = 'ew-sep';
    gateSep.style.display = 'none';
    const gatesWrap = document.createElement('div');
    gatesWrap.className = 'ew-gates';
    gatesWrap.style.display = 'none';
    const gateLbl = document.createElement('span');
    gateLbl.className = 'ew-gate-lbl';
    gateLbl.textContent = 'GATES';
    gatesWrap.appendChild(gateLbl);

    const sep2 = document.createElement('div');
    sep2.className = 'ew-sep';

    const facsWrap = document.createElement('div');
    facsWrap.className = 'ew-facs';

    const sep3 = document.createElement('div');
    sep3.className = 'ew-sep';

    const fob = document.createElement('div');
    fob.className = 'ew-fob';

    const radio = document.createElement('div');
    radio.className = 'ew-radio';

    bar.append(threat, sep1, front, gateSep, gatesWrap, sep2, facsWrap, sep3, fob, radio);

    const alertEl = document.createElement('div');
    alertEl.className = 'ew-alert';
    alertEl.style.display = 'none';

    const surgeEl = document.createElement('div');
    surgeEl.className = 'ew-surge';
    surgeEl.style.display = 'none';

    el.append(bar, alertEl, surgeEl);
    document.body.appendChild(el);

    const redeployEl = document.createElement('div');
    redeployEl.className = 'ew-redeploy';
    redeployEl.style.display = 'none';
    const redeployTitle = document.createElement('div');
    redeployTitle.className = 'ew-redeploy-title';
    redeployTitle.textContent = 'KIA — REDEPLOYING TO FOB VANGUARD';
    const redeploySub = document.createElement('div');
    redeploySub.className = 'ew-redeploy-sub';
    redeployEl.append(redeployTitle, redeploySub);
    document.body.appendChild(redeployEl);

    this.el = el;
    this.redeployEl = redeployEl;
    this.redeploySubEl = redeploySub;
    this.threatLblEl = threatLbl;
    this.clockEl = clock;
    this.threatFillEl = threatFill;
    this.stageEl = stage;
    this.bridgeWEl = bW;
    this.bridgeCEl = bC;
    this.bridgeEEl = bE;
    this.gateSepEl = gateSep;
    this.gatesWrapEl = gatesWrap;
    this.facsWrapEl = facsWrap;
    this.fobEl = fob;
    this.radioEl = radio;
    this.alertEl = alertEl;
    this.surgeEl = surgeEl;
  }

  update(dt: number, state: EndlessWarHudState): void {
    if (!this.el || !this.redeployEl) return;

    const showRedeploy = state.redeployLeft > 0;
    if (showRedeploy !== this.lastRedeployShown) {
      this.lastRedeployShown = showRedeploy;
      this.redeployEl.style.display = showRedeploy ? 'flex' : 'none';
    }
    if (showRedeploy) {
      const txt = `RETURNING TO THE FRONT IN ${state.redeployLeft.toFixed(1)}s`;
      if (txt !== this.lastRedeployText) {
        this.lastRedeployText = txt;
        this.redeploySubEl!.textContent = txt;
      }
    }

    this.updateAccum += dt;
    if (this.updateAccum < 0.2) return;
    this.updateAccum = 0;

    if (state.threatLevel !== this.lastThreat) {
      this.lastThreat = state.threatLevel;
      this.threatLblEl!.textContent = `THREAT ${state.threatLevel}`;
    }
    const clockSec = Math.max(0, Math.floor(state.elapsedSec));
    if (clockSec !== this.lastClockSec) {
      this.lastClockSec = clockSec;
      this.clockEl!.textContent = formatTime(clockSec);
    }
    const threatPct = Math.round(state.threatProgress * 100);
    if (threatPct !== this.lastThreatPct) {
      this.lastThreatPct = threatPct;
      this.threatFillEl!.style.width = `${threatPct}%`;
    }

    const stageIdx = Math.max(0, Math.min(STAGE_NAMES.length - 1, state.frontlineStage));
    if (stageIdx !== this.lastStage) {
      this.lastStage = stageIdx;
      this.stageEl!.textContent = STAGE_NAMES[stageIdx] ?? 'FRONT';
    }
    if (state.bridges.west !== this.lastBridgeW) {
      this.lastBridgeW = state.bridges.west;
      this.bridgeWEl!.className = `ew-pip ${state.bridges.west}`;
    }
    if (state.bridges.center !== this.lastBridgeC) {
      this.lastBridgeC = state.bridges.center;
      this.bridgeCEl!.className = `ew-pip ${state.bridges.center}`;
    }
    if (state.bridges.east !== this.lastBridgeE) {
      this.lastBridgeE = state.bridges.east;
      this.bridgeEEl!.className = `ew-pip ${state.bridges.east}`;
    }

    const gates = state.gates;
    const hasGates = Boolean(gates && gates.length > 0);
    const gateDisp = hasGates ? '' : 'none';
    if (this.gateSepEl!.style.display !== gateDisp) {
      this.gateSepEl!.style.display = gateDisp;
      this.gatesWrapEl!.style.display = gateDisp;
    }
    if (hasGates && gates) {
      while (this.gateEls.length < gates.length) {
        const sp = document.createElement('span');
        this.gatesWrapEl!.appendChild(sp);
        this.gateEls.push(sp);
      }
      for (let i = 0; i < this.gateEls.length; i++) {
        const sp = this.gateEls[i]!;
        if (i >= gates.length) {
          if (sp.style.display !== 'none') sp.style.display = 'none';
          continue;
        }
        if (sp.style.display === 'none') sp.style.display = '';
        const g = gates[i]!;
        const cls = g.sealed ? 'ew-gate sealed' : 'ew-gate open';
        const lbl = g.lane[0]!.toUpperCase();
        if (sp.className !== cls) sp.className = cls;
        if (sp.textContent !== lbl) sp.textContent = lbl;
      }
    }

    const facs = state.facilities;
    while (this.facEls.length < facs.length) {
      const sp = document.createElement('span');
      this.facsWrapEl!.appendChild(sp);
      this.facEls.push(sp);
    }
    for (let i = 0; i < this.facEls.length; i++) {
      const sp = this.facEls[i]!;
      if (i >= facs.length) {
        if (sp.style.display !== 'none') sp.style.display = 'none';
        continue;
      }
      if (sp.style.display === 'none') sp.style.display = '';
      const f = facs[i]!;
      const cls = f.alive ? 'ew-fac up' : 'ew-fac down';
      const firstWord = f.shortName.split(' ')[0]!;
      const lbl = f.alive ? firstWord : `${firstWord} ${f.rebuildLeft}s`;
      if (sp.className !== cls) sp.className = cls;
      if (sp.textContent !== lbl) sp.textContent = lbl;
    }

    const fobPct = Math.ceil(state.fobHpFrac * 100);
    const fobDanger = state.fobUnderAttack || state.fobBreached || fobPct < 80;
    const fobText = `FOB ${fobPct}%`;
    if (fobText !== this.lastFobText) {
      this.lastFobText = fobText;
      this.fobEl!.textContent = fobText;
    }
    if (fobDanger !== this.lastFobDanger) {
      this.lastFobDanger = fobDanger;
      this.fobEl!.className = fobDanger ? 'ew-fob danger' : 'ew-fob';
    }

    const credits = Math.floor(state.credits);
    if (credits !== this.lastCredits) {
      this.lastCredits = credits;
      this.radioEl!.textContent = `[O] WAR CMD · ${credits.toLocaleString()} CR`;
    }

    const alertKey = state.tacticalAlert ? `${state.tacticalAlert.tone}:${state.tacticalAlert.text}` : '';
    if (alertKey !== this.lastAlertKey) {
      this.lastAlertKey = alertKey;
      if (state.tacticalAlert) {
        this.alertEl!.style.display = '';
        this.alertEl!.className = `ew-alert ${state.tacticalAlert.tone}`;
        this.alertEl!.textContent = state.tacticalAlert.text;
      } else {
        this.alertEl!.style.display = 'none';
      }
    }

    let surgeText = '';
    if (state.momentumLeft > 0) surgeText = `MOMENTUM SURGE ${Math.ceil(state.momentumLeft)}s (+60% ALLY PUSH)`;
    if (state.mobilizeLeft > 0) {
      const m = `TOTAL MOBILIZATION ${Math.ceil(state.mobilizeLeft)}s (2x ALLY TEMPO)`;
      surgeText = surgeText ? `${surgeText}  ·  ${m}` : m;
    }
    if (surgeText !== this.lastSurgeText) {
      this.lastSurgeText = surgeText;
      if (surgeText) {
        this.surgeEl!.style.display = '';
        this.surgeEl!.textContent = surgeText;
      } else {
        this.surgeEl!.style.display = 'none';
      }
    }
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
    this.redeployEl?.remove();
    this.redeployEl = null;
    this.gateEls.length = 0;
    this.facEls.length = 0;
  }
}
