/**
 * Sleek Lightweight Tactical DOM HUD Overlay for the 4-Part "Crossfire" Campaign.
 *
 * Supports two mission-specific readouts:
 *   1. Strait Escort HUD (Parts 2 & 4):
 *      - B-1B Lancer Hull Integrity bar (color-coded cyan -> amber -> flashing critical red)
 *      - Transit progress bar (Halcyon Coastline ETA / CVN-91 Carrier Umbrella) & active bandit count
 *   2. Fortress Halcyon Destruction & Fire-Mission HUD (Part 3):
 *      - % Base Flattened bar
 *      - Priority target badges (SEC-B, MORTARS, SAMs, ARMORY, AIRFIELD, FUEL, RADARS, HQ)
 *      - Live Mercer fire-mission callout strip
 *
 * 100% Node/Vitest-safe (no-ops cleanly when `document` is absent) and self-cleans on `hide()`/`dispose()`.
 */

export interface StraitHudState {
  readonly mode: 'outbound' | 'return';
  readonly lancerHp: number;
  readonly lancerMaxHp: number;
  readonly progress: number;
  readonly etaSeconds: number;
  readonly banditsRemaining: number;
  readonly statusLine?: string;
}

export interface HalcyonHudBadge {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
  readonly active?: boolean;
}

export interface HalcyonHudState {
  readonly flattenedPct: number;
  readonly callout: string;
  readonly badges: readonly HalcyonHudBadge[];
}

const ROOT_ID = 'op2-crossfire-tactical-hud';

export class CrossfireHudOverlay {
  private root: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private subEl: HTMLElement | null = null;
  private barLabelEl: HTMLElement | null = null;
  private barValueEl: HTMLElement | null = null;
  private barFillEl: HTMLElement | null = null;
  private secRowEl: HTMLElement | null = null;
  private secLabelEl: HTMLElement | null = null;
  private secValueEl: HTMLElement | null = null;
  private secFillEl: HTMLElement | null = null;
  private badgeRowEl: HTMLElement | null = null;
  private calloutEl: HTMLElement | null = null;
  private lastMode: 'none' | 'strait' | 'halcyon' = 'none';
  private lastBadgeSignature = '';

  private ensureDom(): boolean {
    if (typeof document === 'undefined' || !document.body) return false;
    if (this.root && this.root.isConnected) return true;

    document.getElementById(ROOT_ID)?.remove();

    const root = document.createElement('div');
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: 'fixed',
      top: '96px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(480px, 84vw)',
      zIndex: '42',
      pointerEvents: 'none',
      userSelect: 'none',
      fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.07em',
      color: '#e8eef5',
      background: 'linear-gradient(180deg, rgba(10, 16, 24, 0.84) 0%, rgba(8, 12, 18, 0.72) 100%)',
      border: '1px solid rgba(56, 232, 255, 0.34)',
      borderTop: '2px solid #f4b238',
      boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)',
      padding: '8px 12px',
      display: 'none',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: '10px',
      marginBottom: '6px',
    });

    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize: '11px',
      fontWeight: '700',
      color: '#f4b238',
      textTransform: 'uppercase',
    });

    const sub = document.createElement('div');
    Object.assign(sub.style, {
      fontSize: '10px',
      color: '#9bb4cc',
      textTransform: 'uppercase',
    });

    header.appendChild(title);
    header.appendChild(sub);
    root.appendChild(header);

    // Primary meter row
    const barHeader = document.createElement('div');
    Object.assign(barHeader.style, {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '11px',
      marginBottom: '3px',
    });
    const barLabel = document.createElement('span');
    barLabel.style.color = '#d8e6f2';
    const barValue = document.createElement('span');
    barValue.style.fontWeight = '700';
    barHeader.appendChild(barLabel);
    barHeader.appendChild(barValue);
    root.appendChild(barHeader);

    const barTrack = document.createElement('div');
    Object.assign(barTrack.style, {
      width: '100%',
      height: '7px',
      background: 'rgba(255, 255, 255, 0.1)',
      border: '1px solid rgba(255, 255, 255, 0.16)',
      overflow: 'hidden',
      marginBottom: '6px',
    });
    const barFill = document.createElement('div');
    Object.assign(barFill.style, {
      width: '100%',
      height: '100%',
      background: 'linear-gradient(90deg, #28c8ff 0%, #68f0ff 100%)',
      transition: 'width 120ms linear, background 180ms ease',
    });
    barTrack.appendChild(barFill);
    root.appendChild(barTrack);

    // Secondary transit bar (Strait mode)
    const secRow = document.createElement('div');
    Object.assign(secRow.style, { display: 'none', marginTop: '4px' });
    const secHead = document.createElement('div');
    Object.assign(secHead.style, {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '10px',
      color: '#9bb4cc',
      marginBottom: '3px',
    });
    const secLabel = document.createElement('span');
    const secValue = document.createElement('span');
    secHead.appendChild(secLabel);
    secHead.appendChild(secValue);
    const secTrack = document.createElement('div');
    Object.assign(secTrack.style, {
      width: '100%',
      height: '5px',
      background: 'rgba(255, 255, 255, 0.08)',
      overflow: 'hidden',
    });
    const secFill = document.createElement('div');
    Object.assign(secFill.style, {
      width: '0%',
      height: '100%',
      background: 'linear-gradient(90deg, #f4b238 0%, #ffe27a 100%)',
      transition: 'width 160ms linear',
    });
    secTrack.appendChild(secFill);
    secRow.appendChild(secHead);
    secRow.appendChild(secTrack);
    root.appendChild(secRow);

    // Priority target badges (Halcyon mode)
    const badgeRow = document.createElement('div');
    Object.assign(badgeRow.style, {
      display: 'none',
      flexWrap: 'wrap',
      gap: '5px',
      marginTop: '6px',
    });
    root.appendChild(badgeRow);

    // Live callout strip
    const callout = document.createElement('div');
    Object.assign(callout.style, {
      display: 'none',
      marginTop: '6px',
      paddingTop: '5px',
      borderTop: '1px solid rgba(255, 255, 255, 0.12)',
      fontSize: '10px',
      color: '#ffd25a',
      textTransform: 'uppercase',
    });
    root.appendChild(callout);

    const mount = document.querySelector('.hud') ?? document.body;
    mount.appendChild(root);

    this.root = root;
    this.titleEl = title;
    this.subEl = sub;
    this.barLabelEl = barLabel;
    this.barValueEl = barValue;
    this.barFillEl = barFill;
    this.secRowEl = secRow;
    this.secLabelEl = secLabel;
    this.secValueEl = secValue;
    this.secFillEl = secFill;
    this.badgeRowEl = badgeRow;
    this.calloutEl = callout;
    return true;
  }

  updateStrait(state: StraitHudState): void {
    if (!this.ensureDom()) return;
    const root = this.root!;
    root.style.display = 'block';
    this.lastMode = 'strait';

    const maxHp = Math.max(1, Math.round(state.lancerMaxHp));
    const hp = Math.max(0, Math.min(maxHp, Math.round(state.lancerHp)));
    const hpFrac = hp / maxHp;
    const pct = Math.max(0, Math.min(100, Math.round(state.progress * 100)));

    this.titleEl!.textContent = state.mode === 'outbound'
      ? 'B-1B LANCER ESCORT // OUTBOUND'
      : 'B-1B LANCER ESCORT // DUSK EGRESS';
    this.subEl!.textContent = state.banditsRemaining > 0
      ? `BANDITS: ${state.banditsRemaining}`
      : 'AIRSPACE CLEAR';
    this.subEl!.style.color = state.banditsRemaining > 0 ? '#ff6454' : '#54ff9d';

    this.barLabelEl!.textContent = hpFrac < 0.45 ? 'B-1B LANCER HULL (SMOKE)' : 'B-1B LANCER HULL';
    this.barValueEl!.textContent = `${hp.toLocaleString()} / ${maxHp.toLocaleString()}`;
    this.barFillEl!.style.width = `${Math.round(hpFrac * 100)}%`;
    if (hpFrac < 0.3) {
      this.barFillEl!.style.background = 'linear-gradient(90deg, #ff3b2f 0%, #ff7a45 100%)';
      this.barValueEl!.style.color = '#ff5a4f';
    } else if (hpFrac < 0.6) {
      this.barFillEl!.style.background = 'linear-gradient(90deg, #f49b28 0%, #ffd25a 100%)';
      this.barValueEl!.style.color = '#ffd25a';
    } else {
      this.barFillEl!.style.background = 'linear-gradient(90deg, #28c8ff 0%, #68f0ff 100%)';
      this.barValueEl!.style.color = '#7de8ff';
    }

    this.secRowEl!.style.display = 'block';
    this.secLabelEl!.textContent = state.mode === 'outbound'
      ? 'HALCYON COASTLINE ETA'
      : 'CVN-91 CARRIER UMBRELLA';
    const eta = Math.max(0, Math.ceil(state.etaSeconds));
    const mins = Math.floor(eta / 60);
    const secs = String(eta % 60).padStart(2, '0');
    this.secValueEl!.textContent = `${pct}% · ${mins}:${secs}`;
    this.secFillEl!.style.width = `${pct}%`;

    this.badgeRowEl!.style.display = 'none';
    if (state.statusLine) {
      this.calloutEl!.style.display = 'block';
      this.calloutEl!.textContent = state.statusLine;
    } else {
      this.calloutEl!.style.display = 'none';
    }
  }

  updateHalcyon(state: HalcyonHudState): void {
    if (!this.ensureDom()) return;
    const root = this.root!;
    root.style.display = 'block';
    this.lastMode = 'halcyon';

    const pct = Math.max(0, Math.min(100, Math.round(state.flattenedPct)));
    this.titleEl!.textContent = 'FORTRESS HALCYON // COMBINED-ARMS SIEGE';
    this.subEl!.textContent = `${pct}% FLATTENED`;
    this.subEl!.style.color = pct >= 65 ? '#54ff9d' : '#ffd25a';

    this.barLabelEl!.textContent = 'BASE DESTRUCTION';
    this.barValueEl!.textContent = `${pct}%`;
    this.barValueEl!.style.color = pct >= 65 ? '#54ff9d' : '#f4b238';
    this.barFillEl!.style.width = `${pct}%`;
    this.barFillEl!.style.background = pct >= 65
      ? 'linear-gradient(90deg, #28d17c 0%, #7dffb0 100%)'
      : 'linear-gradient(90deg, #e0761b 0%, #ffd25a 100%)';

    this.secRowEl!.style.display = 'none';

    const badgeRow = this.badgeRowEl!;
    badgeRow.style.display = 'flex';
    const sig = state.badges.map(b => `${b.id}:${b.done ? 1 : 0}:${b.active ? 1 : 0}`).join('|');
    if (sig !== this.lastBadgeSignature) {
      this.lastBadgeSignature = sig;
      badgeRow.replaceChildren();
      for (const b of state.badges) {
        const chip = document.createElement('span');
        chip.textContent = b.done ? `✓ ${b.label}` : b.label;
        Object.assign(chip.style, {
          fontSize: '9px',
          padding: '2px 6px',
          borderRadius: '2px',
          border: b.done
            ? '1px solid rgba(84, 255, 157, 0.48)'
            : b.active
              ? '1px solid rgba(255, 92, 66, 0.85)'
              : '1px solid rgba(255, 255, 255, 0.16)',
          background: b.done
            ? 'rgba(32, 92, 62, 0.5)'
            : b.active
              ? 'rgba(130, 34, 22, 0.65)'
              : 'rgba(255, 255, 255, 0.06)',
          color: b.done ? '#7dffb0' : b.active ? '#ffd25a' : '#8fa6bf',
          textDecoration: b.done ? 'line-through' : 'none',
        });
        badgeRow.appendChild(chip);
      }
    }

    if (state.callout) {
      this.calloutEl!.style.display = 'block';
      this.calloutEl!.textContent = state.callout;
    } else {
      this.calloutEl!.style.display = 'none';
    }
  }

  hide(): void {
    this.lastMode = 'none';
    this.lastBadgeSignature = '';
    if (this.root) this.root.style.display = 'none';
  }

  dispose(): void {
    this.hide();
    this.root?.remove();
    this.root = null;
    this.titleEl = null;
    this.subEl = null;
    this.barLabelEl = null;
    this.barValueEl = null;
    this.barFillEl = null;
    this.secRowEl = null;
    this.secLabelEl = null;
    this.secValueEl = null;
    this.secFillEl = null;
    this.badgeRowEl = null;
    this.calloutEl = null;
  }

  get mode(): 'none' | 'strait' | 'halcyon' {
    return this.lastMode;
  }
}
