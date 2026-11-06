/**
 * Keyboard and mouse input.
 *
 * Actions are polled, so game code never sees a raw key. Edges (`pressed`, `released`) live for exactly one
 * frame and are cleared by `endFrame`, which means a key tapped and released between two frames still reads as
 * pressed for one frame. Bots write through `simulate`, into state the blur handler leaves alone, so a headless
 * page that loses focus keeps playing.
 */
import type { Action, InputSystem } from '../core/contracts';
import {
  ACTIONS, DEFAULT_BINDINGS, WHEEL_DOWN, WHEEL_UP, clearStoredBindings, labelForCode, loadBindings, saveBindings,
  type Bindings,
} from './bindings';

export * from './bindings';

/** One wheel notch in pixels. Trackpads report small deltas that add up to notches over a swipe. */
const WHEEL_NOTCH_PIXELS = 100;
/** Chrome occasionally reports a jump of thousands of pixels when the pointer warps. No hand moves that fast. */
const MAX_LOOK_PER_EVENT = 1500;
const KEYBOARD_LOCK_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Tab', 'ControlLeft', 'AltLeft', 'Escape'];

interface KeyboardLock {
  lock(codes?: string[]): Promise<void>;
  unlock(): void;
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export class Input implements InputSystem {
  /** Look motion handed out by the last consumeLook, for sway and directional sword input. */
  readonly frameLook = { x: 0, y: 0 };

  private bindings: Bindings = loadBindings();
  /** Code to the action indices it drives. */
  private codeActions = new Map<string, number[]>();
  private actionIndex = new Map<Action, number>(ACTIONS.map((a, i) => [a, i]));
  /** How many physical keys are holding each action. A second key on the same action makes no new edge. */
  private held = new Uint8Array(ACTIONS.length);
  private simulated = new Uint8Array(ACTIONS.length);
  private pressedNow = new Uint8Array(ACTIONS.length);
  private releasedNow = new Uint8Array(ACTIONS.length);
  private codesDown = new Set<string>();

  private lookX = 0;
  private lookY = 0;
  private lookOut = { x: 0, y: 0 };
  private wheelPixels = 0;
  private wheelNotches = 0;
  private lockIntended = false;
  private skipNextMove = false;
  private capture: ((code: string | null) => void) | null = null;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.rebuildCodeMap();
    this.listen(window, 'keydown', e => this.onKeyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', e => this.onKeyUp(e as KeyboardEvent));
    this.listen(document, 'mousemove', e => this.onMouseMove(e as MouseEvent));
    this.listen(window, 'mousedown', e => this.onMouseDown(e as MouseEvent));
    this.listen(window, 'mouseup', e => this.onMouseUp(e as MouseEvent));
    this.listen(window, 'wheel', e => this.onWheel(e as WheelEvent), { passive: false });
    this.listen(window, 'contextmenu', e => e.preventDefault());
    this.listen(window, 'blur', () => this.clearPhysical());
    this.listen(document, 'visibilitychange', () => { if (document.hidden) this.clearPhysical(); });
    this.listen(document, 'pointerlockchange', () => this.onLockChange());
    // Ctrl is the slide key and Ctrl+W closes a tab on Windows and Linux. A page cannot cancel that shortcut,
    // but it can ask before leaving, which saves the run.
    this.listen(window, 'beforeunload', e => { if (this.locked) e.preventDefault(); });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  isDown(action: Action): boolean {
    const i = this.actionIndex.get(action)!;
    return this.held[i]! > 0 || this.simulated[i]! > 0;
  }

  pressed(action: Action): boolean {
    return this.pressedNow[this.actionIndex.get(action)!] === 1;
  }

  released(action: Action): boolean {
    return this.releasedNow[this.actionIndex.get(action)!] === 1;
  }

  consumeLook(): { x: number; y: number } {
    this.lookOut.x = this.frameLook.x = this.lookX;
    this.lookOut.y = this.frameLook.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return this.lookOut;
  }

  consumeWheel(): number {
    const n = this.wheelNotches;
    this.wheelNotches = 0;
    return n;
  }

  requestLock(): void {
    this.lockIntended = true;
    this.skipNextMove = true;
    const canvas = this.canvas;
    // Raw motion skips OS acceleration. It is not available everywhere, and Safari returns no promise at all.
    const attempt = canvas.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
    attempt?.catch(() => {
      const fallback = canvas.requestPointerLock() as Promise<void> | undefined;
      fallback?.catch(() => { this.lockIntended = false; });
    });
    if (document.fullscreenElement) this.keyboard()?.lock(KEYBOARD_LOCK_CODES).catch(() => undefined);
  }

  releaseLock(): void {
    this.lockIntended = false;
    this.keyboard()?.unlock();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  simulate(action: Action, down: boolean): void {
    const i = this.actionIndex.get(action)!;
    const was = this.held[i]! > 0 || this.simulated[i]! > 0;
    this.simulated[i] = down ? 1 : 0;
    this.edge(i, was);
  }

  simulateLook(dx: number, dy: number): void {
    this.lookX += dx;
    this.lookY += dy;
  }

  endFrame(): void {
    this.pressedNow.fill(0);
    this.releasedNow.fill(0);
    this.frameLook.x = 0;
    this.frameLook.y = 0;
  }

  reset(): void {
    this.clearPhysical();
    this.simulated.fill(0);
    this.lookX = this.lookY = 0;
    this.wheelPixels = this.wheelNotches = 0;
    this.endFrame();
  }

  // --- Rebinding ---------------------------------------------------------------------------------------------

  /** The codes bound to an action, in menu order. */
  bindingsFor(action: Action): readonly string[] {
    return this.bindings[action];
  }

  /** Text for the first binding of an action, for prompts such as "[X] AIRSTRIKE". */
  labelFor(action: Action): string {
    const code = this.bindings[action][0];
    return code ? labelForCode(code) : '';
  }

  /** Replaces an action's bindings and saves them. Conflicts are allowed; use `conflicts` to warn about them. */
  rebind(action: Action, codes: readonly string[]): void {
    this.bindings[action] = [...codes];
    this.rebuildCodeMap();
    saveBindings(this.bindings);
  }

  /** Actions other than `except` that already use `code`. */
  conflicts(code: string, except?: Action): Action[] {
    return ACTIONS.filter(a => a !== except && this.bindings[a].includes(code));
  }

  /** Restores every default. */
  resetBindings(): void {
    this.bindings = { ...DEFAULT_BINDINGS } as Bindings;
    clearStoredBindings();
    this.rebuildCodeMap();
  }

  /**
   * The next key, button or wheel notch goes to `callback` instead of the game, for a "press a key" prompt.
   * Escape cancels and calls back with null.
   */
  captureNext(callback: (code: string | null) => void): void {
    this.capture = callback;
  }

  /** Removes every listener. For tests and for sandboxes that rebuild the page. */
  dispose(): void {
    for (const [target, type, fn, options] of this.listeners) target.removeEventListener(type, fn, options);
    this.listeners.length = 0;
  }

  // --- Internals ---------------------------------------------------------------------------------------------

  private listen(target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, options);
    this.listeners.push([target, type, fn, options]);
  }

  private keyboard(): KeyboardLock | undefined {
    return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
  }

  private rebuildCodeMap(): void {
    this.clearPhysical();
    this.codeActions.clear();
    ACTIONS.forEach((action, i) => {
      for (const code of this.bindings[action]) {
        let list = this.codeActions.get(code);
        if (!list) this.codeActions.set(code, (list = []));
        list.push(i);
      }
    });
  }

  private edge(i: number, was: boolean): void {
    const now = this.held[i]! > 0 || this.simulated[i]! > 0;
    if (now && !was) this.pressedNow[i] = 1;
    else if (!now && was) this.releasedNow[i] = 1;
  }

  private codeDown(code: string): void {
    if (this.codesDown.has(code)) return;
    this.codesDown.add(code);
    const actions = this.codeActions.get(code);
    if (!actions) return;
    for (const i of actions) {
      const was = this.held[i]! > 0 || this.simulated[i]! > 0;
      this.held[i] = this.held[i]! + 1;
      this.edge(i, was);
    }
  }

  private codeUp(code: string): void {
    if (!this.codesDown.delete(code)) return;
    const actions = this.codeActions.get(code);
    if (!actions) return;
    for (const i of actions) {
      const was = this.held[i]! > 0 || this.simulated[i]! > 0;
      this.held[i] = Math.max(0, this.held[i]! - 1);
      this.edge(i, was);
    }
  }

  /** A wheel notch has no release, so it is a press and a release inside one frame. */
  private tapCode(code: string): void {
    this.codeDown(code);
    this.codeUp(code);
  }

  private clearPhysical(): void {
    for (const code of [...this.codesDown]) this.codeUp(code);
  }

  private takeCapture(code: string | null): boolean {
    const capture = this.capture;
    if (!capture) return false;
    this.capture = null;
    capture(code);
    return true;
  }

  /** Our keys must not scroll the page or move focus, but Ctrl+R still has to work in the menus. */
  private blockDefault(e: KeyboardEvent): void {
    if (this.codeActions.has(e.code) && (this.locked || !(e.ctrlKey || e.metaKey))) e.preventDefault();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) {
      this.blockDefault(e);
      return;
    }
    if (isTextField(e.target)) return;
    if (this.takeCapture(e.code === 'Escape' ? null : e.code)) {
      e.preventDefault();
      return;
    }
    this.blockDefault(e);
    this.codeDown(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.codeUp(e.code);
    // macOS sends no keyup for anything released while Cmd is down, which would leave those keys stuck.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') this.clearPhysical();
  }

  private onMouseMove(e: MouseEvent): void {
    // Harness scripts dispatch untrusted events without pointer lock. Real motion only counts while locked.
    if (e.isTrusted && !this.locked) return;
    if (this.skipNextMove) {
      this.skipNextMove = false;
      return;
    }
    if (Math.abs(e.movementX) > MAX_LOOK_PER_EVENT || Math.abs(e.movementY) > MAX_LOOK_PER_EVENT) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  }

  private onMouseDown(e: MouseEvent): void {
    if (isTextField(e.target)) return;
    const code = `Mouse${e.button}`;
    if (this.takeCapture(code)) return;
    this.codeDown(code);
  }

  private onMouseUp(e: MouseEvent): void {
    this.codeUp(`Mouse${e.button}`);
  }

  private onWheel(e: WheelEvent): void {
    if (this.locked) e.preventDefault();
    const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? WHEEL_NOTCH_PIXELS : 1;
    this.wheelPixels += e.deltaY * scale;
    let notches = Math.trunc(this.wheelPixels / WHEEL_NOTCH_PIXELS);
    if (notches === 0) return;
    this.wheelPixels -= notches * WHEEL_NOTCH_PIXELS;
    if (this.takeCapture(notches > 0 ? WHEEL_DOWN : WHEEL_UP)) return;
    this.wheelNotches += notches;
    const code = notches > 0 ? WHEEL_DOWN : WHEEL_UP;
    for (notches = Math.abs(notches); notches > 0; notches--) this.tapCode(code);
  }

  private onLockChange(): void {
    if (this.locked) return;
    this.clearPhysical();
    // Chrome swallows the Esc keydown that ends pointer lock, so losing the lock has to act as the pause key.
    if (this.lockIntended) {
      this.lockIntended = false;
      const i = this.actionIndex.get('pause')!;
      this.pressedNow[i] = 1;
      this.releasedNow[i] = 1;
    }
    this.keyboard()?.unlock();
  }
}

export function createInput(canvas: HTMLCanvasElement): Input {
  return new Input(canvas);
}
