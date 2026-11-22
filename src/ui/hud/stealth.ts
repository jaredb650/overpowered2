/**
 * Mission 3 ("Quiet Title") stealth tactical HUD overlay:
 * - Faceted Light / Shadow Visibility Gem (`SHADOW` / `DIM` / `LIT` / `EXPOSED`) with smooth `--lum`.
 * - Pre-allocated fixed pool of `MAX_ARCS = 8` radial directional awareness arcs around the reticle
 *   (white filling -> amber suspicious -> crimson alert + pulsing radio badge when calling alarm).
 * - Top-center industrial Alert / Lockdown / Camera Lock status banner with live countdown bar.
 * - Contextual `[E]` interact prompt pill below the reticle.
 *
 * Strictly zero per-frame DOM node creation or heap allocations inside `update()`.
 */
import { clamp } from '../../core/math';
import { STEALTH_TUNING, type StealthArc, type StealthHudSnapshot, type StealthState } from '../../enemies/outpost/stealth';
import { Flag, Label, Meter, Shown, div, span } from '../dom';

export const MAX_ARCS = 8;

export type LightTier = 'SHADOW' | 'DIM' | 'LIT' | 'EXPOSED';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARC_RADIUS = 120;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;
const ARC_MIN_DEG = 8;
const ARC_MAX_DEG = 46;
const RAD_TO_DEG = 180 / Math.PI;
const CAMERA_LOCK_SHOW = 0.05;

type BannerMode = 'hidden' | 'suspicious' | 'alert' | 'caller' | 'camera' | 'lockdown' | 'overridden';

export function lightTier(lightLevel: number): LightTier {
  const l = clamp(lightLevel, 0, 1);
  if (l < 0.14) return 'SHADOW';
  if (l < 0.45) return 'DIM';
  if (l < 0.78) return 'LIT';
  return 'EXPOSED';
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...kids: Element[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  }
  for (const k of kids) el.append(k);
  return el;
}

interface ArcSlot {
  readonly el: HTMLElement;
  readonly rim: SVGCircleElement;
  readonly stroke: SVGCircleElement;
  readonly shown: Shown;
  readonly unaware: Flag;
  readonly suspicious: Flag;
  readonly alert: Flag;
  readonly calling: Flag;
  angleDegQ: number;
  fillQ: number;
  opacityQ: number;
}

export interface StealthHudUpdateOptions {
  prompt?: string | null;
  cameraLock?: number;
  hubOverridden?: boolean;
}

function arcPriority(arc: StealthArc): number {
  let score = arc.fill;
  if (arc.callingAlarm) score += 100;
  else if (arc.state === 'alert' || arc.state === 'lockdown') score += 20;
  else if (arc.state === 'suspicious') score += 5;
  return score;
}

export class StealthHud {
  readonly el: HTMLElement;

  private readonly activeShown: Shown;

  // Light / Shadow Visibility Gem
  private readonly gemEl: HTMLElement;
  private readonly gemLabel: Label;
  private readonly gemShadow: Flag;
  private readonly gemDim: Flag;
  private readonly gemLit: Flag;
  private readonly gemExposed: Flag;
  private lastLumQ = -1;

  // Pre-allocated pool of directional awareness arcs
  private readonly arcsLayer: HTMLElement;
  private readonly arcSlots: readonly ArcSlot[];
  private readonly pickedIndices = new Int32Array(MAX_ARCS);
  private readonly pickedScores = new Float32Array(MAX_ARCS);

  // Alert / Lockdown / Camera status banner
  private readonly statusEl: HTMLElement;
  private readonly statusShown: Shown;
  private readonly statusText: Label;
  private readonly statusTime: Label;
  private readonly statusTimeShown: Shown;
  private readonly statusBarShown: Shown;
  private readonly statusBarFill: Meter;
  private readonly modeSuspicious: Flag;
  private readonly modeAlert: Flag;
  private readonly modeCaller: Flag;
  private readonly modeCamera: Flag;
  private readonly modeLockdown: Flag;
  private readonly modeOverridden: Flag;
  private alarmPeak = 0;

  // Contextual [E] interact prompt
  private readonly promptEl: HTMLElement;
  private readonly promptShown: Shown;
  private readonly promptText: Label;

  constructor() {
    // --- 1. Faceted Light / Shadow Visibility Gem ---
    const gemSvg = svgEl(
      'svg',
      { class: 'stealth-gem-svg', viewBox: '-24 -24 48 48', 'aria-hidden': 'true' },
      svgEl('polygon', { class: 'stealth-gem-rim', points: '0,-21 18,0 0,21 -18,0' }),
      svgEl('polygon', { class: 'stealth-gem-facet-tl', points: '0,-18 0,0 -15,0' }),
      svgEl('polygon', { class: 'stealth-gem-facet-tr', points: '0,-18 15,0 0,0' }),
      svgEl('polygon', { class: 'stealth-gem-facet-bl', points: '-15,0 0,0 0,18' }),
      svgEl('polygon', { class: 'stealth-gem-facet-br', points: '0,0 15,0 0,18' }),
      svgEl('polygon', { class: 'stealth-gem-core', points: '0,-9 7.5,0 0,9 -7.5,0' }),
    );
    const gemTextEl = span('stealth-gem-label', 'SHADOW');
    this.gemEl = div('stealth-gem vis-shadow', gemSvg, gemTextEl);
    this.gemLabel = new Label(gemTextEl);
    this.gemShadow = new Flag(this.gemEl, 'vis-shadow');
    this.gemDim = new Flag(this.gemEl, 'vis-dim');
    this.gemLit = new Flag(this.gemEl, 'vis-lit');
    this.gemExposed = new Flag(this.gemEl, 'vis-exposed');

    // --- 2. Pre-allocated Radial Directional Awareness Arcs ---
    const slots: ArcSlot[] = [];
    const slotEls: HTMLElement[] = [];
    for (let i = 0; i < MAX_ARCS; i++) {
      const rim = svgEl('circle', {
        class: 'stealth-arc-rim',
        cx: '0',
        cy: '0',
        r: String(ARC_RADIUS),
        'stroke-dasharray': `0 ${ARC_CIRCUMFERENCE.toFixed(2)}`,
      });
      const stroke = svgEl('circle', {
        class: 'stealth-arc-stroke',
        cx: '0',
        cy: '0',
        r: String(ARC_RADIUS),
        'stroke-dasharray': `0 ${ARC_CIRCUMFERENCE.toFixed(2)}`,
      });
      const radioBadge = svgEl(
        'g',
        { class: 'stealth-arc-radio', transform: `translate(0, ${-(ARC_RADIUS + 14)})` },
        svgEl('circle', { class: 'stealth-arc-radio-ring', cx: '0', cy: '0', r: '9' }),
        svgEl('circle', { class: 'stealth-arc-radio-dot', cx: '0', cy: '0', r: '3' }),
        svgEl('path', { class: 'stealth-arc-radio-wave', d: 'M-6,-4 A7,7 0 0,1 6,-4' }),
        svgEl('path', { class: 'stealth-arc-radio-wave', d: 'M-9,-7 A11,11 0 0,1 9,-7' }),
      );
      const svg = svgEl(
        'svg',
        { class: 'stealth-arc-svg', viewBox: '-156 -156 312 312', 'aria-hidden': 'true' },
        rim,
        stroke,
        radioBadge,
      );
      const el = div('stealth-arc', svg);
      const shown = new Shown(el);
      shown.set(false);
      slots.push({
        el,
        rim,
        stroke,
        shown,
        unaware: new Flag(el, 'st-unaware'),
        suspicious: new Flag(el, 'st-suspicious'),
        alert: new Flag(el, 'st-alert'),
        calling: new Flag(el, 'calling'),
        angleDegQ: Number.NaN,
        fillQ: -1,
        opacityQ: -1,
      });
      slotEls.push(el);
    }
    this.arcSlots = slots;
    this.arcsLayer = div('stealth-arcs', ...slotEls);

    // --- 3. Top-center Alert / Lockdown Status Banner ---
    const statusTextEl = span('stealth-status-text');
    const statusTimeEl = span('stealth-status-time');
    const statusRow = div('stealth-status-row', statusTextEl, statusTimeEl);
    const barFillEl = div('stealth-status-bar-fill');
    const barTrackEl = div('stealth-status-bar', barFillEl);
    this.statusEl = div('stealth-status', statusRow, barTrackEl);
    this.statusShown = new Shown(this.statusEl);
    this.statusText = new Label(statusTextEl);
    this.statusTime = new Label(statusTimeEl);
    this.statusTimeShown = new Shown(statusTimeEl);
    this.statusBarShown = new Shown(barTrackEl);
    this.statusBarFill = new Meter(barFillEl);
    this.modeSuspicious = new Flag(this.statusEl, 'mode-suspicious');
    this.modeAlert = new Flag(this.statusEl, 'mode-alert');
    this.modeCaller = new Flag(this.statusEl, 'mode-caller');
    this.modeCamera = new Flag(this.statusEl, 'mode-camera');
    this.modeLockdown = new Flag(this.statusEl, 'mode-lockdown');
    this.modeOverridden = new Flag(this.statusEl, 'mode-overridden');

    // --- 4. Contextual [E] Interact Prompt ---
    const promptTextEl = span('stealth-prompt-text');
    this.promptEl = div('stealth-prompt', promptTextEl);
    this.promptShown = new Shown(this.promptEl);
    this.promptText = new Label(promptTextEl);

    // --- Root ---
    this.el = div('stealth-hud', this.statusEl, this.arcsLayer, this.promptEl, this.gemEl);
    this.activeShown = new Shown(this.el);
    this.activeShown.set(false);
    this.reset();
  }

  setActive(active: boolean): void {
    this.activeShown.set(active);
  }

  update(snapshot: StealthHudSnapshot, opts?: StealthHudUpdateOptions): void {
    this.updateGem(snapshot.lightLevel);
    this.updateArcs(snapshot.arcs);
    this.updateStatus(
      snapshot.globalState,
      snapshot.lockdown,
      snapshot.alarmCountdown,
      opts?.cameraLock ?? 0,
      opts?.hubOverridden ?? false,
    );
    this.updatePrompt(opts?.prompt ?? null);
  }

  reset(): void {
    this.alarmPeak = 0;
    this.lastLumQ = -1;
    this.updateGem(0);

    for (let i = 0; i < this.arcSlots.length; i++) {
      const slot = this.arcSlots[i]!;
      slot.shown.set(false);
      slot.unaware.set(false);
      slot.suspicious.set(false);
      slot.alert.set(false);
      slot.calling.set(false);
      slot.angleDegQ = Number.NaN;
      slot.fillQ = -1;
      slot.opacityQ = -1;
    }

    this.setBannerMode('hidden');
    this.statusShown.set(false);
    this.statusText.set('');
    this.statusTime.set('');
    this.statusTimeShown.set(false);
    this.statusBarShown.set(false);
    this.statusBarFill.set(0);

    this.promptShown.set(false);
    this.promptText.set('');
  }

  dispose(): void {
    this.reset();
    this.activeShown.set(false);
    this.el.remove();
  }

  // ---------------------------------------------------------------------------
  // Internal updaters (strictly zero allocations)
  // ---------------------------------------------------------------------------

  private updateGem(lightLevel: number): void {
    const lum = clamp(lightLevel, 0, 1);
    const q = Math.round(lum * 1000);
    if (q !== this.lastLumQ) {
      this.lastLumQ = q;
      this.gemEl.style.setProperty('--lum', (q / 1000).toFixed(3));
    }
    const tier = lightTier(lum);
    this.gemLabel.set(tier);
    this.gemShadow.set(tier === 'SHADOW');
    this.gemDim.set(tier === 'DIM');
    this.gemLit.set(tier === 'LIT');
    this.gemExposed.set(tier === 'EXPOSED');
  }

  private updateArcs(arcs: readonly StealthArc[]): void {
    const total = arcs.length;
    let count = total;

    if (total > MAX_ARCS) {
      count = MAX_ARCS;
      // Select the highest-priority MAX_ARCS entries into pre-allocated typed arrays (zero allocations).
      for (let i = 0; i < MAX_ARCS; i++) {
        this.pickedIndices[i] = -1;
        this.pickedScores[i] = -1;
      }
      for (let i = 0; i < total; i++) {
        const score = arcPriority(arcs[i]!);
        let minSlot = 0;
        let minScore = this.pickedScores[0]!;
        for (let j = 1; j < MAX_ARCS; j++) {
          if (this.pickedScores[j]! < minScore) {
            minScore = this.pickedScores[j]!;
            minSlot = j;
          }
        }
        if (score > minScore) {
          this.pickedIndices[minSlot] = i;
          this.pickedScores[minSlot] = score;
        }
      }
    }

    for (let i = 0; i < MAX_ARCS; i++) {
      const slot = this.arcSlots[i]!;
      if (i >= count) {
        slot.shown.set(false);
        slot.calling.set(false);
        continue;
      }

      const arc = total > MAX_ARCS ? arcs[this.pickedIndices[i]!]! : arcs[i]!;
      slot.shown.set(true);

      const degQ = Math.round(arc.angle * RAD_TO_DEG * 10);
      if (degQ !== slot.angleDegQ) {
        slot.angleDegQ = degQ;
        slot.el.style.transform = `rotate(${(degQ / 10).toFixed(1)}deg)`;
      }

      const fill = clamp(arc.fill, 0, 1);
      const fillQ = Math.round(fill * 200);
      if (fillQ !== slot.fillQ) {
        slot.fillQ = fillQ;
        const f = fillQ / 200;
        const spanDeg = ARC_MIN_DEG + f * (ARC_MAX_DEG - ARC_MIN_DEG);
        const arcLen = ARC_CIRCUMFERENCE * (spanDeg / 360);
        const dash = `${arcLen.toFixed(1)} ${(ARC_CIRCUMFERENCE - arcLen).toFixed(1)}`;
        const rot = `rotate(${(-90 - spanDeg * 0.5).toFixed(1)})`;
        slot.rim.setAttribute('stroke-dasharray', dash);
        slot.rim.setAttribute('transform', rot);
        slot.stroke.setAttribute('stroke-dasharray', dash);
        slot.stroke.setAttribute('transform', rot);
      }

      const isAlert = arc.state === 'alert' || arc.state === 'lockdown';
      const isSuspicious = arc.state === 'suspicious';
      const isUnaware = !isAlert && !isSuspicious;
      slot.unaware.set(isUnaware);
      slot.suspicious.set(isSuspicious);
      slot.alert.set(isAlert);
      slot.calling.set(arc.callingAlarm);

      const opacity = isAlert || arc.callingAlarm ? 1 : isSuspicious ? 0.72 + 0.28 * fill : 0.28 + 0.72 * fill;
      const opacityQ = Math.round(opacity * 100);
      if (opacityQ !== slot.opacityQ) {
        slot.opacityQ = opacityQ;
        slot.el.style.opacity = (opacityQ / 100).toFixed(2);
      }
    }
  }

  private setBannerMode(mode: BannerMode): void {
    this.modeSuspicious.set(mode === 'suspicious');
    this.modeAlert.set(mode === 'alert');
    this.modeCaller.set(mode === 'caller');
    this.modeCamera.set(mode === 'camera');
    this.modeLockdown.set(mode === 'lockdown');
    this.modeOverridden.set(mode === 'overridden');
  }

  private updateStatus(
    globalState: StealthState,
    lockdown: boolean,
    alarmCountdown: number | null,
    cameraLock: number,
    hubOverridden: boolean,
  ): void {
    if (lockdown) {
      this.alarmPeak = 0;
      const mode: BannerMode = hubOverridden ? 'overridden' : 'lockdown';
      this.setBannerMode(mode);
      this.statusShown.set(true);
      this.statusText.set(hubOverridden ? 'LOCKDOWN · ALARM GRID OVERRIDDEN' : 'COMPOUND LOCKDOWN');
      this.statusTimeShown.set(false);
      this.statusTime.set('');
      this.statusBarShown.set(false);
      return;
    }

    if (alarmCountdown !== null) {
      const remaining = Math.max(0, alarmCountdown);
      if (remaining > this.alarmPeak || this.alarmPeak <= 0) {
        this.alarmPeak = Math.max(STEALTH_TUNING.alarmRadioSeconds, remaining);
      }
      const ratio = this.alarmPeak > 0 ? clamp(remaining / this.alarmPeak, 0, 1) : 0;
      this.setBannerMode('caller');
      this.statusShown.set(true);
      this.statusText.set('ALERT — STOP ALARM CALLER');
      this.statusTimeShown.set(true);
      this.statusTime.set(`${remaining.toFixed(1)}s`);
      this.statusBarShown.set(true);
      this.statusBarFill.set(ratio);
      return;
    }

    this.alarmPeak = 0;

    if (cameraLock > CAMERA_LOCK_SHOW) {
      this.setBannerMode('camera');
      this.statusShown.set(true);
      this.statusText.set('CAMERA LOCKING');
      this.statusTimeShown.set(false);
      this.statusTime.set('');
      this.statusBarShown.set(true);
      this.statusBarFill.set(clamp(cameraLock, 0, 1));
      return;
    }

    if (globalState === 'alert') {
      this.setBannerMode('alert');
      this.statusShown.set(true);
      this.statusText.set('ALERT');
      this.statusTimeShown.set(false);
      this.statusTime.set('');
      this.statusBarShown.set(false);
      return;
    }

    if (globalState === 'suspicious') {
      this.setBannerMode('suspicious');
      this.statusShown.set(true);
      this.statusText.set('SUSPICIOUS');
      this.statusTimeShown.set(false);
      this.statusTime.set('');
      this.statusBarShown.set(false);
      return;
    }

    this.setBannerMode('hidden');
    this.statusShown.set(false);
    this.statusTimeShown.set(false);
    this.statusBarShown.set(false);
  }

  private updatePrompt(prompt: string | null): void {
    const visible = prompt !== null && prompt.length > 0;
    this.promptShown.set(visible);
    if (visible) this.promptText.set(prompt);
  }
}
