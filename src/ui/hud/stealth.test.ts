import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StealthArc, StealthHudSnapshot } from '../../enemies/outpost/stealth';
import { MAX_ARCS, StealthHud, lightTier } from './stealth';

class FakeClassList {
  private readonly set = new Set<string>();

  constructor(initial = '') {
    this.resetFrom(initial);
  }

  resetFrom(cls: string): void {
    this.set.clear();
    for (const part of cls.split(/\s+/)) {
      if (part) this.set.add(part);
    }
  }

  contains(cls: string): boolean {
    return this.set.has(cls);
  }

  toggle(cls: string, force?: boolean): boolean {
    const next = force !== undefined ? force : !this.set.has(cls);
    if (next) this.set.add(cls);
    else this.set.delete(cls);
    return next;
  }

  toString(): string {
    return [...this.set].join(' ');
  }
}

class FakeStyle {
  display = '';
  transform = '';
  opacity = '';
  private readonly props = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.props.get(name) ?? '';
  }
}

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attrs = new Map<string, string>();
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList();
  textContent = '';
  removed = false;

  constructor(tag: string) {
    this.tagName = tag;
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList.resetFrom(val);
    this.attrs.set('class', val);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === 'class') this.classList.resetFrom(value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const n of nodes) {
      if (typeof n === 'string') this.textContent += n;
      else this.children.push(n);
    }
  }

  remove(): void {
    this.removed = true;
  }

  findByClass(cls: string): FakeElement | null {
    if (this.classList.contains(cls)) return this;
    for (const child of this.children) {
      const hit = child.findByClass(cls);
      if (hit) return hit;
    }
    return null;
  }

  findAllByClass(cls: string, out: FakeElement[] = []): FakeElement[] {
    if (this.classList.contains(cls)) out.push(this);
    for (const child of this.children) child.findAllByClass(cls, out);
    return out;
  }
}

let createElementSpy: ReturnType<typeof vi.fn>;
let createElementNSSpy: ReturnType<typeof vi.fn>;

function asFake(el: unknown): FakeElement {
  return el as FakeElement;
}

function makeSnapshot(over: Partial<StealthHudSnapshot> = {}): StealthHudSnapshot {
  return {
    globalState: 'unaware',
    lightLevel: 0.05,
    arcs: [],
    alarmCountdown: null,
    lockdown: false,
    ...over,
  };
}

beforeEach(() => {
  createElementSpy = vi.fn((tag: string) => new FakeElement(tag));
  createElementNSSpy = vi.fn((_ns: string, tag: string) => new FakeElement(tag));
  vi.stubGlobal('document', {
    createElement: createElementSpy,
    createElementNS: createElementNSSpy,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StealthHud', () => {
  it('starts hidden by default and activates/deactivates cleanly', () => {
    const hud = new StealthHud();
    const root = asFake(hud.el);
    expect(root.classList.contains('stealth-hud')).toBe(true);
    expect(root.style.display).toBe('none');

    hud.setActive(true);
    expect(root.style.display).toBe('');

    hud.setActive(false);
    expect(root.style.display).toBe('none');
  });

  it('switches Light Gem across SHADOW / DIM / LIT / EXPOSED and updates --lum', () => {
    expect(lightTier(0)).toBe('SHADOW');
    expect(lightTier(0.139)).toBe('SHADOW');
    expect(lightTier(0.14)).toBe('DIM');
    expect(lightTier(0.449)).toBe('DIM');
    expect(lightTier(0.45)).toBe('LIT');
    expect(lightTier(0.779)).toBe('LIT');
    expect(lightTier(0.78)).toBe('EXPOSED');
    expect(lightTier(1)).toBe('EXPOSED');

    const hud = new StealthHud();
    const root = asFake(hud.el);
    const gem = root.findByClass('stealth-gem')!;
    const label = root.findByClass('stealth-gem-label')!;

    hud.update(makeSnapshot({ lightLevel: 0.05 }));
    expect(label.textContent).toBe('SHADOW');
    expect(gem.classList.contains('vis-shadow')).toBe(true);
    expect(gem.style.getPropertyValue('--lum')).toBe('0.050');

    hud.update(makeSnapshot({ lightLevel: 0.3 }));
    expect(label.textContent).toBe('DIM');
    expect(gem.classList.contains('vis-dim')).toBe(true);
    expect(gem.classList.contains('vis-shadow')).toBe(false);
    expect(gem.style.getPropertyValue('--lum')).toBe('0.300');

    hud.update(makeSnapshot({ lightLevel: 0.62 }));
    expect(label.textContent).toBe('LIT');
    expect(gem.classList.contains('vis-lit')).toBe(true);
    expect(gem.style.getPropertyValue('--lum')).toBe('0.620');

    hud.update(makeSnapshot({ lightLevel: 0.92 }));
    expect(label.textContent).toBe('EXPOSED');
    expect(gem.classList.contains('vis-exposed')).toBe(true);
    expect(gem.style.getPropertyValue('--lum')).toBe('0.920');
  });

  it('toggles and color-codes directional arcs without allocating any per-frame DOM nodes', () => {
    const hud = new StealthHud();
    const root = asFake(hud.el);
    const arcs = root.findAllByClass('stealth-arc');
    expect(arcs.length).toBe(MAX_ARCS);

    const htmlCallsAfterInit = createElementSpy.mock.calls.length;
    const svgCallsAfterInit = createElementNSSpy.mock.calls.length;

    const sampleArcs: StealthArc[] = [
      { angle: 0, fill: 0.25, state: 'unaware', callingAlarm: false },
      { angle: Math.PI / 2, fill: 0.6, state: 'suspicious', callingAlarm: false },
      { angle: -Math.PI / 2, fill: 1, state: 'alert', callingAlarm: false },
      { angle: Math.PI, fill: 1, state: 'alert', callingAlarm: true },
    ];

    hud.update(makeSnapshot({ globalState: 'alert', arcs: sampleArcs, alarmCountdown: 2.8 }));

    // Strictly zero per-frame DOM node creation.
    expect(createElementSpy.mock.calls.length).toBe(htmlCallsAfterInit);
    expect(createElementNSSpy.mock.calls.length).toBe(svgCallsAfterInit);

    // First 4 slots active, remaining 4 hidden.
    expect(arcs[0]!.style.display).toBe('');
    expect(arcs[0]!.style.transform).toBe('rotate(0.0deg)');
    expect(arcs[0]!.classList.contains('st-unaware')).toBe(true);
    expect(arcs[0]!.classList.contains('calling')).toBe(false);

    expect(arcs[1]!.style.display).toBe('');
    expect(arcs[1]!.style.transform).toBe('rotate(90.0deg)');
    expect(arcs[1]!.classList.contains('st-suspicious')).toBe(true);

    expect(arcs[2]!.style.display).toBe('');
    expect(arcs[2]!.style.transform).toBe('rotate(-90.0deg)');
    expect(arcs[2]!.classList.contains('st-alert')).toBe(true);
    expect(arcs[2]!.classList.contains('calling')).toBe(false);

    expect(arcs[3]!.style.display).toBe('');
    expect(arcs[3]!.style.transform).toBe('rotate(180.0deg)');
    expect(arcs[3]!.classList.contains('st-alert')).toBe(true);
    expect(arcs[3]!.classList.contains('calling')).toBe(true);

    for (let i = 4; i < MAX_ARCS; i++) {
      expect(arcs[i]!.style.display).toBe('none');
    }

    // Overflow (> MAX_ARCS) keeps the alarm caller and still creates zero DOM nodes.
    const crowded: StealthArc[] = Array.from({ length: 12 }, (_, i) => ({
      angle: i * 0.2,
      fill: 0.2,
      state: 'unaware' as const,
      callingAlarm: i === 11,
    }));
    hud.update(makeSnapshot({ globalState: 'alert', arcs: crowded, alarmCountdown: 1.5 }));
    expect(createElementSpy.mock.calls.length).toBe(htmlCallsAfterInit);
    expect(createElementNSSpy.mock.calls.length).toBe(svgCallsAfterInit);
    expect(arcs.some(a => a.style.display === '' && a.classList.contains('calling'))).toBe(true);
  });

  it('displays SUSPICIOUS, STOP ALARM CALLER, CAMERA LOCKING, COMPOUND LOCKDOWN, and ALARM GRID OVERRIDDEN banners', () => {
    const hud = new StealthHud();
    const root = asFake(hud.el);
    const status = root.findByClass('stealth-status')!;
    const text = root.findByClass('stealth-status-text')!;
    const time = root.findByClass('stealth-status-time')!;
    const bar = root.findByClass('stealth-status-bar')!;
    const fill = root.findByClass('stealth-status-bar-fill')!;

    // Hidden when unaware, not in lockdown, camera lock == 0.
    hud.update(makeSnapshot({ globalState: 'unaware', lockdown: false }), { cameraLock: 0 });
    expect(status.style.display).toBe('none');

    // SUSPICIOUS
    hud.update(makeSnapshot({ globalState: 'suspicious' }));
    expect(status.style.display).toBe('');
    expect(text.textContent).toBe('SUSPICIOUS');
    expect(status.classList.contains('mode-suspicious')).toBe(true);
    expect(bar.style.display).toBe('none');

    // CAMERA LOCKING
    hud.update(makeSnapshot({ globalState: 'unaware' }), { cameraLock: 0.65 });
    expect(status.style.display).toBe('');
    expect(text.textContent).toBe('CAMERA LOCKING');
    expect(status.classList.contains('mode-camera')).toBe(true);
    expect(bar.style.display).toBe('');
    expect(fill.style.transform).toBe('scaleX(0.65)');

    // ALERT — STOP ALARM CALLER with live countdown bar
    hud.update(makeSnapshot({ globalState: 'alert', alarmCountdown: 1.75 }));
    expect(status.style.display).toBe('');
    expect(text.textContent).toBe('ALERT — STOP ALARM CALLER');
    expect(time.textContent).toBe('1.8s');
    expect(status.classList.contains('mode-caller')).toBe(true);
    expect(bar.style.display).toBe('');
    expect(fill.style.transform).toBe('scaleX(0.5)');

    // COMPOUND LOCKDOWN
    hud.update(makeSnapshot({ globalState: 'lockdown', lockdown: true }));
    expect(status.style.display).toBe('');
    expect(text.textContent).toBe('COMPOUND LOCKDOWN');
    expect(status.classList.contains('mode-lockdown')).toBe(true);
    expect(status.classList.contains('mode-overridden')).toBe(false);

    // LOCKDOWN · ALARM GRID OVERRIDDEN
    hud.update(makeSnapshot({ globalState: 'lockdown', lockdown: true }), { hubOverridden: true });
    expect(status.style.display).toBe('');
    expect(text.textContent).toBe('LOCKDOWN · ALARM GRID OVERRIDDEN');
    expect(status.classList.contains('mode-overridden')).toBe(true);
    expect(status.classList.contains('mode-lockdown')).toBe(false);
  });

  it('shows and hides contextual [E] prompts cleanly and supports reset/dispose', () => {
    const hud = new StealthHud();
    const root = asFake(hud.el);
    const promptEl = root.findByClass('stealth-prompt')!;
    const promptText = root.findByClass('stealth-prompt-text')!;

    expect(promptEl.style.display).toBe('none');

    hud.setActive(true);
    hud.update(makeSnapshot(), { prompt: '[E] SILENT TAKEDOWN' });
    expect(promptEl.style.display).toBe('');
    expect(promptText.textContent).toBe('[E] SILENT TAKEDOWN');

    hud.update(makeSnapshot(), { prompt: '[E] FLIP BREAKER — WEST WING' });
    expect(promptText.textContent).toBe('[E] FLIP BREAKER — WEST WING');

    hud.update(makeSnapshot(), { prompt: null });
    expect(promptEl.style.display).toBe('none');

    hud.update(makeSnapshot({ globalState: 'suspicious', lightLevel: 0.9 }), { prompt: '[E] OVERRIDE SECURITY HUB' });
    hud.reset();
    expect(promptEl.style.display).toBe('none');
    expect(root.findByClass('stealth-status')!.style.display).toBe('none');
    expect(root.findByClass('stealth-gem-label')!.textContent).toBe('SHADOW');

    hud.dispose();
    expect(root.removed).toBe(true);
    expect(root.style.display).toBe('none');
  });
});
