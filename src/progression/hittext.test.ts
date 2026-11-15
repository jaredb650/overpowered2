import { afterEach, describe, expect, it } from 'vitest';
import { HitText, hitText } from './data';

describe('hit text setting', () => {
  afterEach(() => { HitText.level = 0; });

  it('Full shows points and label, and a label alone', () => {
    expect(hitText('HEADSHOT', 700)).toBe('+700 HEADSHOT');
    expect(hitText('', 350)).toBe('+350');
    expect(hitText('FEMORAL')).toBe('FEMORAL');
  });

  it('Points shows the number only, and nothing for a label with no points', () => {
    HitText.level = 1;
    expect(hitText('HEADSHOT', 700)).toBe('+700');
    expect(hitText('', 350)).toBe('+350');
    expect(hitText('FEMORAL')).toBeNull();
  });

  it('Off shows nothing', () => {
    HitText.level = 2;
    expect(hitText('HEADSHOT', 700)).toBeNull();
    expect(hitText('FEMORAL')).toBeNull();
  });
});
