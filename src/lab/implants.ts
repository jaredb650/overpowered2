/**
 * The lab's implant rows (docs/proposals/implants.md): hand an implant over, and fit or take it off, anywhere and at any time, so
 * an implant is tried without the shop. Fitting opens every slot first: the panel ignores slots, but not the one-a-class rule.
 */
import type { ImplantId, Loadout } from '../progression/implants';

export type ImplantCheat = 'grant' | 'fit';

/** `grant` hands it over unfitted; `fit` fits it (replacing its class), or takes it off when it is on. */
export function implantCheat(l: Loadout, id: ImplantId, act: ImplantCheat): void {
  if (act === 'grant') {
    l.grant(id);
    return;
  }
  if (l.fitted.has(id)) {
    l.fit(id, false);
    return;
  }
  while (l.openSlot());
  l.fit(id, true);
}
