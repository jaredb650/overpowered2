/**
 * What the allies tell the rest of the game. Nothing listens yet: these are what a voice bank, a roster on the HUD and the
 * Outpost Defense economy will key on. Allies have no lines of their own (hive-mission-plan.md, rules for every stage).
 */
import type { Ally, Order } from './ally';

declare module '../core/contracts' {
  interface GameEvents {
    'ally:order': { ally: Ally; order: Order };
    'ally:down': { ally: Ally };
    'ally:revived': { ally: Ally };
    'ally:dead': { ally: Ally };
    /** The player's round went through him. */
    'ally:checkFire': { ally: Ally };
  }
}
