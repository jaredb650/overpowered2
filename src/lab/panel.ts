/** The dev panel: plain DOM on top of the game, in the HUD's colours. It holds no state of its own. */
import { ON_RANGE } from '../core/devflags';
import type { EnemyId } from '../core/gameplay';
import { ENEMIES } from '../enemies/data';
import type { AiMode, LabSettings } from './settings';

const ORDER: readonly EnemyId[] = [
  'husk', 'trooper', 'gunner', 'brute', 'stalker', 'rocketeer', 'sniper', 'riot',
  'leaper', 'bomber', 'burner', 'warden', 'skitter', 'drone', 'juggernaut', 'titan',
];
const AI_MODES: readonly (readonly [AiMode, string])[] = [['off', 'AI off'], ['patrol', 'Walking'], ['on', 'AI on']];
const SPEEDS = [1, 0.5, 0.25, 0.1, 0.05] as const;

const CSS = `
.lab-panel { position: fixed; top: 12px; right: 12px; bottom: 12px; width: 344px; box-sizing: border-box; overflow-y: auto;
  padding: 14px; background: var(--plate-solid, #0b1118); color: var(--ink, #eef4f7); border: 1px solid #24303a;
  font: 12px/1.4 var(--mono, ui-monospace, Menlo, monospace); pointer-events: auto; z-index: 9000; display: none; }
.lab-panel.open { display: block; }
.lab-panel h1 { margin: 0 0 2px; font: 400 18px/1.1 var(--display, Impact, sans-serif); letter-spacing: 0.02em; }
.lab-panel h2 { margin: 16px 0 6px; font-size: 11px; font-weight: 600; color: var(--steel, #9db0bd); }
.lab-status { color: var(--steel, #9db0bd); min-height: 2.8em; white-space: pre-wrap; }
.lab-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.lab-grid button { font-size: 11px; }
.lab-row { display: flex; gap: 3px; margin-top: 3px; }
.lab-row > * { flex: 1; }
.lab-panel button { padding: 5px 2px; background: #161f27; color: inherit; border: 1px solid #2b3945; font: inherit; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lab-panel button:hover { background: #20303b; }
.lab-panel button:focus-visible, .lab-panel input:focus-visible { outline: 1px solid var(--cold, #39e0ff); }
.lab-panel button.on { background: var(--cold, #39e0ff); border-color: var(--cold, #39e0ff); color: #06222b; }
.lab-check { display: flex; align-items: center; gap: 7px; padding: 2px 0; cursor: pointer; }
.lab-check input { margin: 0; accent-color: var(--cold, #39e0ff); }
.lab-slider { display: grid; grid-template-columns: 1fr auto; column-gap: 8px; margin-top: 6px; }
.lab-slider input { grid-column: 1 / -1; width: 100%; margin: 2px 0 0; accent-color: var(--cold, #39e0ff); }
.lab-keys { margin-top: 16px; color: var(--dim, #5b6b77); white-space: pre-wrap; }
.lab-aim { position: fixed; right: calc(50% + 44px); top: calc(50% + 44px); margin: 0; padding: 6px 8px; max-width: 42vw;
  background: rgba(7, 10, 14, 0.74); color: var(--ink, #eef4f7); font: 11px/1.4 var(--mono, ui-monospace, Menlo, monospace);
  white-space: pre-wrap; pointer-events: none; z-index: 8000; display: none; }
.lab-aim:empty { visibility: hidden; }
.lab-hint { position: fixed; left: 50%; bottom: 22%; transform: translateX(-50%); padding: 6px 12px; background: rgba(7, 10, 14, 0.74);
  color: var(--ink, #eef4f7); font: 12px/1.4 var(--mono, ui-monospace, Menlo, monospace); pointer-events: none; z-index: 8000; }
`;

export interface PanelActions {
  changed(): void;
  spawn(count: number): void;
  killAll(): void;
  clearBodies(): void;
  togglePause(): void;
  step(frames: number): void;
  setSpeed(speed: number): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export class LabPanel {
  readonly el = el('aside', 'lab-panel');
  private readonly status = el('div', 'lab-status');
  private readonly pauseButton = el('button', '', 'Pause');
  private readonly speedLabel = el('span');
  private readonly speedSlider = el('input');
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly typeButtons = new Map<EnemyId, HTMLButtonElement>();
  private readonly aiButtons = new Map<AiMode, HTMLButtonElement>();

  constructor(private readonly s: LabSettings, private readonly on: PanelActions) {
    const style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el.setAttribute('aria-label', 'Dev panel');
    this.el.append(el('h1', '', ON_RANGE ? 'TEST RANGE' : 'DEV PANEL'), this.status);
    this.spawnSection();
    this.playerSection();
    this.timeSection();
    this.bodySection();
    this.el.append(el('div', 'lab-keys', 'F1 or ` panel   P pause   . step\n[ ] slower, faster   O spawn\nK kill all   L clear bodies'));
    // The game listens on window. What happens on the panel stays on the panel, or a click would also fire the gun.
    for (const type of ['mousedown', 'wheel', 'keydown'] as const) this.el.addEventListener(type, e => e.stopPropagation());
    document.body.appendChild(this.el);
    this.syncSpawn();
  }

  private button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  }

  private check(parent: HTMLElement, label: string, key: 'god' | 'arsenal' | 'overlay' | 'gibbing' | 'explosiveDeaths' | 'progression' | 'muscles'): void {
    const row = el('label', 'lab-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = this.s[key];
    box.addEventListener('change', () => {
      this.s[key] = box.checked;
      this.on.changed();
    });
    row.append(box, label);
    parent.appendChild(row);
  }

  private slider(parent: HTMLElement, label: string, input: HTMLInputElement, value: HTMLElement, min: number, max: number, step: number): void {
    const row = el('label', 'lab-slider');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    row.append(label, value, input);
    parent.appendChild(row);
  }

  private spawnSection(): void {
    this.el.append(el('h2', '', 'SPAWN AT CROSSHAIR'));
    const grid = el('div', 'lab-grid');
    for (const id of ORDER) {
      this.typeButtons.set(id, this.button(grid, ENEMIES[id].name, () => {
        this.s.spawn = id;
        this.syncSpawn();
        this.on.changed();
      }));
    }
    const modes = el('div', 'lab-row');
    for (const [mode, label] of AI_MODES) {
      this.aiButtons.set(mode, this.button(modes, label, () => {
        this.s.ai = mode;
        this.syncSpawn();
        this.on.changed();
      }));
    }
    const go = el('div', 'lab-row');
    this.button(go, 'Spawn one', () => this.on.spawn(1));
    const rowButton = this.button(go, '', () => this.on.spawn(this.s.row));
    const count = el('input');
    const countLabel = el('span');
    const sync = () => {
      rowButton.textContent = `Spawn row of ${this.s.row}`;
      countLabel.textContent = String(this.s.row);
      count.value = String(this.s.row);
    };
    const size = el('div');
    this.slider(size, 'Row size', count, countLabel, 2, 12, 1);
    count.addEventListener('input', () => {
      this.s.row = Number(count.value);
      sync();
      this.on.changed();
    });
    sync();
    const clear = el('div', 'lab-row');
    this.button(clear, 'Kill all', () => this.on.killAll());
    this.button(clear, 'Clear bodies', () => this.on.clearBodies());
    this.el.append(grid, modes, go, size, clear);
  }

  private playerSection(): void {
    this.el.append(el('h2', '', 'PLAYER'));
    this.check(this.el, 'Every weapon, infinite ammo', 'arsenal');
    this.check(this.el, 'God mode', 'god');
  }

  private timeSection(): void {
    this.el.append(el('h2', '', 'TIME'));
    const speeds = el('div', 'lab-row');
    for (const speed of SPEEDS) this.speedButtons.push(this.button(speeds, `${speed}x`, () => this.on.setSpeed(speed)));
    const box = el('div');
    this.slider(box, 'World speed', this.speedSlider, this.speedLabel, 0.05, 1, 0.01);
    this.speedSlider.addEventListener('input', () => this.on.setSpeed(Number(this.speedSlider.value)));
    const stepping = el('div', 'lab-row');
    this.pauseButton.type = 'button';
    this.pauseButton.addEventListener('click', () => this.on.togglePause());
    stepping.appendChild(this.pauseButton);
    this.button(stepping, 'Step 1', () => this.on.step(1));
    this.button(stepping, 'Step 10', () => this.on.step(10));
    this.el.append(speeds, box, stepping);
    this.syncTime(false);
  }

  private bodySection(): void {
    this.el.append(el('h2', '', 'BODIES'));
    this.check(this.el, 'Gibbing', 'gibbing');
    this.check(this.el, 'Explosive deaths', 'explosiveDeaths');
    this.check(this.el, 'Combos and perks', 'progression');
    this.check(this.el, 'Muscles', 'muscles');
    this.check(this.el, 'Aim readout', 'overlay');
    const force = el('input');
    const value = el('span');
    const box = el('div');
    this.slider(box, 'Ragdoll force', force, value, 0, 3, 0.05);
    const sync = () => {
      value.textContent = `${this.s.force.toFixed(2)}x`;
      force.value = String(this.s.force);
    };
    force.addEventListener('input', () => {
      this.s.force = Number(force.value);
      sync();
      this.on.changed();
    });
    sync();
    const reset = el('div', 'lab-row');
    this.button(reset, 'Force back to 1x', () => {
      this.s.force = 1;
      sync();
      this.on.changed();
    });
    this.el.append(box, reset);
  }

  private syncSpawn(): void {
    for (const [id, b] of this.typeButtons) b.classList.toggle('on', id === this.s.spawn);
    for (const [mode, b] of this.aiButtons) b.classList.toggle('on', mode === this.s.ai);
  }

  syncTime(paused: boolean): void {
    this.speedLabel.textContent = `${this.s.speed.toFixed(2)}x`;
    this.speedSlider.value = String(this.s.speed);
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
    this.pauseButton.classList.toggle('on', paused);
    this.speedButtons.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === this.s.speed));
  }

  setStatus(text: string): void {
    if (this.status.textContent !== text) this.status.textContent = text;
  }
}
