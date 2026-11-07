/** When a wave is down to its last few, each one gets a tracked marker, so nobody has to hunt a lost body around the map. */
import { ACTIVE } from '../../contracts/select';
import type { EnemyInstance } from '../../core/gameplay';
import { ENEMY_NAMES } from '../data';
import type { HudState } from '../state';
import type { WorldLayer } from './worldlayer';

/** At or under this many left in the wave, every one of them is shown. */
export const REVEAL_AT = 3;
const COLOR = '#ff3b3b';
/** Among the humans the heavy suit has one man in it, and the boss bar already calls him by name. */
const nameOf = (e: EnemyInstance): string => (e.id === 'juggernaut' && ACTIVE.def.ai === 'outpost' ? 'The Commander' : ENEMY_NAMES[e.id] ?? 'Hostile');

interface Slot {
  enemy: EnemyInstance | null;
  release: (() => void) | null;
}

export class Stragglers {
  private slots: Slot[] = Array.from({ length: REVEAL_AT }, () => ({ enemy: null, release: null }));

  constructor(private readonly world: WorldLayer) {}

  private clear(slot: Slot): void {
    slot.release?.();
    slot.release = null;
    slot.enemy = null;
  }

  update(s: HudState): void {
    const reveal = s.phase !== 'intermission' && s.remaining <= REVEAL_AT && s.enemies.length >= s.remaining;
    for (const slot of this.slots) {
      if (slot.enemy && (!reveal || !slot.enemy.alive)) this.clear(slot);
    }
    if (!reveal) return;
    for (const e of s.enemies) {
      if (!e.alive || this.slots.some(slot => slot.enemy === e)) continue;
      const slot = this.slots.find(x => x.enemy === null);
      if (!slot) break;
      slot.enemy = e;
      slot.release = this.world.follow(e.center, nameOf(e), COLOR);
    }
  }

  reset(): void {
    for (const slot of this.slots) this.clear(slot);
  }
}
