import { describe, expect, it } from 'vitest';
import { readCombo, type ComboInput } from './combo';

/** Feeds `inputs` one at a time, the way the katana does, and lists the moves they fired. */
function play(inputs: string): (string | null)[] {
  let chain = '';
  return [...inputs].map(k => {
    const read = readCombo(chain, k as ComboInput);
    chain = read.chain;
    return read.move;
  });
}

describe('katana combo inputs', () => {
  it('reads each move on its last input', () => {
    expect(play('sst')).toEqual([null, null, 'cleave']);
    expect(play('ssst')).toEqual([null, null, null, 'tornado']);
    expect(play('tts')).toEqual([null, null, 'wave']);
    expect(play('stt')).toEqual([null, null, 'flurry']);
  });

  it('the longest move wins: three slashes and a stab is the tornado, not the cleave', () => {
    expect(play('sssst').at(-1)).toBe('tornado');
    expect(play('tsst').at(-1)).toBe('cleave');
  });

  it('a move empties the chain, so its inputs never count twice', () => {
    // The cleave's stab does not start a flurry with the next stab.
    expect(play('sstt')).toEqual([null, null, 'cleave', null]);
    expect(play('ssttts')).toEqual([null, null, 'cleave', null, null, 'wave']);
  });

  it('slashes alone and stabs alone spell nothing', () => {
    expect(play('ssssssss').every(m => m === null)).toBe(true);
    expect(play('tttttttt').every(m => m === null)).toBe(true);
    // Alternating is not a move either.
    expect(play('st').every(m => m === null)).toBe(true);
    expect(play('ts').every(m => m === null)).toBe(true);
  });
});
