/**
 * Test double for the gore lane's part of the enemy manager, for unit tests that mock the manager (not shipped: only
 * `*.test.ts` files and their kits import it). The host's hit and kill events read what the damage model found
 * (`model.found`, `model.foundKill`); a guest's own hit is drawn through `predictDamage`, and what the host decided through
 * `showDamage`, `showSever`, `showReaction` and `rouseReplica`. Spread it into the mocked manager:
 * `{ alive, spawn, applyDamage: vi.fn(), ...goreDoubles() }`. The real thing is tested in src/enemies/damage.coop.test.ts.
 */
import { vi } from 'vitest';
import type { DamageResult } from '../../core/gameplay';
import { newFacts, type KillFacts } from '../../enemies/damage';

const drawn = (): DamageResult => ({ dealt: 0, killed: false, headshot: false, severed: [], blocked: false });

export const goreDoubles = () => ({
  model: { found: newFacts(), foundKill: { blast: null, shatter: false, heavyHead: false, wound: 0 } as KillFacts },
  predictDamage: vi.fn(drawn), showDamage: vi.fn(drawn), showSever: vi.fn(), showReaction: vi.fn(), rouseReplica: vi.fn(),
});
