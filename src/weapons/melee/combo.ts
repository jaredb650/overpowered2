/**
 * The katana's combo inputs: a chain of slashes (`s`, left click) and stabs (`t`, right click). A move fires when the chain
 * ends with its input, the longest first, and empties the chain, so no input counts toward two moves. Slashes alone and
 * stabs alone never spell anything: held fire and mashed stabs stay plain swings.
 */
export type KatanaMove = 'cleave' | 'tornado' | 'wave' | 'flurry';
export type ComboInput = 's' | 't';

export const COMBOS: Readonly<Record<string, KatanaMove>> = {
  sst: 'cleave',
  ssst: 'tornado',
  tts: 'wave',
  stt: 'flurry',
};

const LONGEST = Math.max(...Object.keys(COMBOS).map(k => k.length));

/** Adds `input` to `chain`: the move it completes, or none and the chain to keep. */
export function readCombo(chain: string, input: ComboInput): { chain: string; move: KatanaMove | null } {
  const next = (chain + input).slice(-LONGEST);
  for (let n = next.length; n >= 2; n--) {
    const move = COMBOS[next.slice(-n)];
    if (move) return { chain: '', move };
  }
  return { chain: next, move: null };
}
