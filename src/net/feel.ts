/**
 * Co-op switches for how the game feels on a guest, each one the player's own and never sent.
 *
 * `predictKills`: a guest's own hit that its numbers say is clearly a kill starts the death on the frame of the shot, in
 * place of waiting one round trip for the host's word (net/world/hits.ts, enemies/damage.ts `sureKill`). Read, in order, from
 * the address (`?predictKills=0` or `1`), from what was stored by `setPredictKills`, then the default.
 */
const KEY = 'op2.coop.predictKills';
/** On by default: the long noisy proof (tools/scripts/coop-fixhits-predict.mjs) saw no wrong resurrection. */
export const PREDICT_KILLS_DEFAULT = true;

function read(): boolean {
  try {
    const asked = new URLSearchParams(globalThis.location?.search ?? '').get('predictKills');
    if (asked === '0' || asked === '1') return asked === '1';
    const stored = globalThis.localStorage?.getItem(KEY);
    if (stored === '0' || stored === '1') return stored === '1';
  } catch {
    // No address or no store (a test, a locked-down browser): the default.
  }
  return PREDICT_KILLS_DEFAULT;
}

export const COOP_FEEL = { predictKills: read() };

/** Turns kill prediction on or off for this browser, now and for later visits. */
export function setPredictKills(on: boolean): void {
  COOP_FEEL.predictKills = on;
  try { globalThis.localStorage?.setItem(KEY, on ? '1' : '0'); } catch { /* it still holds for this visit */ }
}
