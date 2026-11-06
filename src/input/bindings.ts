/**
 * Action bindings. A binding is a KeyboardEvent.code, or one of the pseudo codes below for the mouse.
 * Codes are layout-independent, so WASD stays under the left hand on AZERTY and Dvorak.
 */
import type { Action } from '../core/contracts';

export const MOUSE_LEFT = 'Mouse0';
export const MOUSE_MIDDLE = 'Mouse1';
export const MOUSE_RIGHT = 'Mouse2';
export const WHEEL_UP = 'WheelUp';
export const WHEEL_DOWN = 'WheelDown';

export type Bindings = Record<Action, readonly string[]>;

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  slide: ['ControlLeft', 'KeyC'],
  fire: [MOUSE_LEFT],
  aim: [MOUSE_RIGHT],
  reload: ['KeyR'],
  melee: ['KeyF'],
  grenade: ['KeyG'],
  interact: ['KeyE'],
  weaponNext: [WHEEL_DOWN],
  weaponPrev: [WHEEL_UP],
  weaponLast: ['KeyQ'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  weapon5: ['Digit5'],
  weapon6: ['Digit6'],
  weapon7: ['Digit7'],
  weapon8: ['Digit8'],
  weapon9: ['Digit9'],
  weapon0: ['Digit0'],
  streak: ['KeyX'],
  callinWarthog: ['KeyZ'],
  callinOrbital: ['KeyV'],
  callinBlackSun: ['KeyB'],
  callinNuke: ['KeyN'],
  pause: ['Escape'],
  scoreboard: ['Tab'],
  debugFps: ['F3'],
  debugOverlay: ['F4'],
};

export const ACTIONS = Object.keys(DEFAULT_BINDINGS) as Action[];

const STORAGE_KEY = 'op2.bindings.v1';

/** Stored bindings merged over the defaults, so actions added in a later version still get a key. */
export function loadBindings(): Bindings {
  const merged = { ...DEFAULT_BINDINGS } as Bindings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return merged;
    const stored = JSON.parse(raw) as Partial<Record<string, unknown>>;
    for (const action of ACTIONS) {
      const codes = stored[action];
      if (Array.isArray(codes) && codes.every(c => typeof c === 'string')) merged[action] = codes as string[];
    }
  } catch {
    // Blocked storage or a corrupt entry falls back to defaults.
  }
  return merged;
}

export function saveBindings(bindings: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Rebinding still works for the session when storage is unavailable.
  }
}

export function clearStoredBindings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

const LABELS: Record<string, string> = {
  [MOUSE_LEFT]: 'LMB', [MOUSE_MIDDLE]: 'MMB', [MOUSE_RIGHT]: 'RMB', Mouse3: 'MB4', Mouse4: 'MB5',
  [WHEEL_UP]: 'Wheel Up', [WHEEL_DOWN]: 'Wheel Down',
  Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace',
};

/** Short text for a binding, for menus and on-screen prompts. */
export function labelForCode(code: string): string {
  const fixed = LABELS[code];
  if (fixed) return fixed;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
