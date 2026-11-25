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
  readonly holdingOrbit?: boolean;
  readonly statusLine?: string;
  readonly repairBanner?: { readonly text: string; readonly tone: 'repair' | 'hint' } | null;
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
  private repairEl: HTMLElement | null = null;
  private lastMode: 'none' | 'strait' | 'halcyon' = 'none';
  private lastBadgeSignature = '';

  private anchorToObjectives(root: HTMLElement): void {
    const objs = document.querySelector('.hud .col-left .ms-objs');
    const colLeft = document.querySelector('.hud .col-left');
    if (objs && objs.parentElement) {
      if (root.previousElementSibling !== objs) objs.after(root);
      Object.assign(root.style, {
        position: 'relative',
        top: '',
        left: '',
        transform: '',
        width: '100%',
        maxWidth: '24rem',
        marginTop: '-0.3rem',
      });
      return;
    }
    if (colLeft) {
      if (root.parentElement !== colLeft) colLeft.appendChild(root);
      Object.assign(root.style, {
        position: 'relative',
        top: '',
        left: '',
        transform: '',
        width: '100%',
        maxWidth: '24rem',
        marginTop: '0',
      });
      return;
    }
    const fallback = document.querySelector('.hud') ?? document.body;
    if (root.parentElement !== fallback) fallback.appendChild(root);
    Object.assign(root.style, {
      position: 'fixed',
      top: '10rem',
      left: '2rem',
      transform: '',
      width: 'min(24rem, 42vw)',
      maxWidth: '24rem',
      marginTop: '0',
    });
  }

  private ensureDom(): boolean {
    if (typeof document === 'undefined' || !document.body) return false;
    if (this.root && this.root.isConnected) {
      this.anchorToObjectives(this.root);
      return true;
    }

    document.getElementById(ROOT_ID)?.remove();

    const root = document.createElement('div');
    root.id = ROOT_ID;
    Object.assign(root.style, {
      zIndex: '4',
      pointerEvents: 'none',
      userSelect: 'none',
      boxSizing: 'border-box',
      fontFamily: 'var(--mono, "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace)',
      letterSpacing: '0.04em',
      color: 'var(--ink, #e8eef5)',
      background: 'var(--plate, rgba(10, 14, 20, 0.82))',
      borderLeft: '2px solid var(--amber, #f4b238)',
      boxShadow: '0.14rem 0.14rem 0 #000',
      padding: '6px 9px',
      display: 'none',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: '8px',
      marginBottom: '4px',
    });

    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize: '10px',
      fontWeight: '700',
      color: 'var(--amber, #f4b238)',
      textTransform: 'uppercase',
    });

    const sub = document.createElement('div');
    Object.assign(sub.style, {
      fontSize: '9px',
      fontWeight: '600',
      color: '#9bb4cc',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    });

    header.appendChild(title);
    header.appendChild(sub);
    root.appendChild(header);

    // Primary meter row
    const barHeader = document.createElement('div');
    Object.assign(barHeader.style, {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '10px',
      marginBottom: '2px',
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
      height: '5px',
      background: 'rgba(255, 255, 255, 0.1)',
      border: '1px solid rgba(255, 255, 255, 0.14)',
      overflow: 'hidden',
      marginBottom: '4px',
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
    Object.assign(secRow.style, { display: 'none', marginTop: '3px' });
    const secHead = document.createElement('div');
    Object.assign(secHead.style, {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '9px',
      color: '#9bb4cc',
      marginBottom: '2px',
    });
    const secLabel = document.createElement('span');
    const secValue = document.createElement('span');
    secHead.appendChild(secLabel);
    secHead.appendChild(secValue);
    const secTrack = document.createElement('div');
    Object.assign(secTrack.style, {
      width: '100%',
      height: '4px',
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
      gap: '4px',
      marginTop: '4px',
    });
    root.appendChild(badgeRow);

    // Live callout strip
    const callout = document.createElement('div');
    Object.assign(callout.style, {
      display: 'none',
      marginTop: '4px',
      paddingTop: '4px',
      borderTop: '1px solid rgba(255, 255, 255, 0.12)',
      fontSize: '9px',
      lineHeight: '1.3',
      color: '#ffd25a',
      textTransform: 'uppercase',
    });
    root.appendChild(callout);

    // Formation repair status strip (Strait Parts 2 & 4)
    const repair = document.createElement('div');
    Object.assign(repair.style, {
      display: 'none',
      marginTop: '4px',
      padding: '3px 6px',
      borderRadius: '2px',
      fontSize: '9px',
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    });
    root.appendChild(repair);

    this.anchorToObjectives(root);

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
    this.repairEl = repair;
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
    if (state.holdingOrbit) {
      this.secValueEl!.textContent = `${pct}% · HOLDING ORBIT`;
    } else {
      const eta = Math.max(0, Math.ceil(state.etaSeconds));
      const mins = Math.floor(eta / 60);
      const secs = String(eta % 60).padStart(2, '0');
      this.secValueEl!.textContent = `${pct}% · ${mins}:${secs}`;
    }
    this.secFillEl!.style.width = `${pct}%`;

    this.badgeRowEl!.style.display = 'none';
    if (state.statusLine) {
      this.calloutEl!.style.display = 'block';
      this.calloutEl!.textContent = state.statusLine;
    } else {
      this.calloutEl!.style.display = 'none';
    }

    const repair = this.repairEl!;
    if (state.repairBanner) {
      repair.style.display = 'block';
      repair.textContent = state.repairBanner.text;
      if (state.repairBanner.tone === 'repair') {
        repair.style.color = '#7dffb0';
        repair.style.background = 'rgba(22, 92, 56, 0.72)';
        repair.style.border = '1px solid rgba(84, 255, 157, 0.78)';
      } else {
        repair.style.color = '#8ce8ff';
        repair.style.background = 'rgba(18, 52, 74, 0.62)';
        repair.style.border = '1px solid rgba(56, 232, 255, 0.42)';
      }
    } else {
      repair.style.display = 'none';
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
    this.repairEl!.style.display = 'none';
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
    this.repairEl = null;
  }

  get mode(): 'none' | 'strait' | 'halcyon' {
    return this.lastMode;
  }
}
