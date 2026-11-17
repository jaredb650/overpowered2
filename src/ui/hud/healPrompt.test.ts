import { describe, expect, it } from 'vitest';
import { HEAL_BELOW, healPrompt } from './healPrompt';

const base = { health: 20, maxHealth: 100, stims: 2, stimInjecting: -1, alive: true };

describe('the low-health heal prompt', () => {
  it('names the bound key', () => {
    expect(healPrompt(base, 'Q')).toBe('Press [Q] to heal');
    expect(healPrompt(base, 'F')).toBe('Press [F] to heal');
  });
  it('waits for low health, a stim, and a free hand', () => {
    expect(HEAL_BELOW).toBe(0.35);
    expect(healPrompt({ ...base, health: 35 }, 'Q')).toBeNull();
    expect(healPrompt({ ...base, health: 34 }, 'Q')).not.toBeNull();
    expect(healPrompt({ ...base, stims: 0 }, 'Q')).toBeNull();
    expect(healPrompt({ ...base, stimInjecting: 0.4 }, 'Q')).toBeNull();
    expect(healPrompt({ ...base, alive: false }, 'Q')).toBeNull();
    expect(healPrompt(base, '')).toBeNull();
  });
});
