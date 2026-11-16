import { describe, expect, it } from 'vitest';
import type { Action } from '../../core/contracts';
import { DEFAULT_BINDINGS } from '../../input/bindings';
import { KEY_GROUPS } from '../data';
import { SettingsScreen } from './settingsScreen';

describe('settings key labels', () => {
  it('keeps last weapon selectable and displays its empty default as Unbound', () => {
    const screen = Object.assign(Object.create(SettingsScreen.prototype), {
      ctx: { input: { bindingsFor: (action: Action) => DEFAULT_BINDINGS[action] } },
    }) as { keyLabel(action: Action): string };
    expect(KEY_GROUPS.flatMap(group => group.rows).some(([action]) => action === 'weaponLast')).toBe(true);
    expect(screen.keyLabel('weaponLast')).toBe('Unbound');
    expect(screen.keyLabel('stim')).toBe('Q');
  });
});
