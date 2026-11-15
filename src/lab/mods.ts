/**
 * The lab's weapon mod rows (weapons-update plan section 10): hand a mod over, and fit or take it off, anywhere and at any time,
 * so a mod can be tried without the Crucible's shop. Fitting one not held grants it first.
 */
import type { ModId } from '../core/gameplay';

export interface ModHands {
  readonly mods: ReadonlySet<ModId>;
  readonly fitted: ReadonlySet<ModId>;
  grantMod(id: ModId): void;
  fitMod(id: ModId, on: boolean): boolean;
}

export type ModCheat = 'grant' | 'fit';

/** `grant` hands it over unfitted; `fit` fits it, or takes it off when it is on. */
export function modCheat(w: ModHands, id: ModId, act: ModCheat): void {
  if (act === 'grant') {
    w.grantMod(id);
    return;
  }
  if (!w.mods.has(id)) w.grantMod(id);
  w.fitMod(id, !w.fitted.has(id));
}
