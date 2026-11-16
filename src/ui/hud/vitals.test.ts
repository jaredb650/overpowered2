import { afterEach, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { HudState } from '../state';
import { Vitals } from './vitals';

class FakeElement {
  className = '';
  textContent = '';
  style = {};
  classList = { toggle: vi.fn() };
  append = vi.fn();
}

afterEach(() => vi.unstubAllGlobals());

it('refreshes the stim hint after rebinding or unbinding without a new run', () => {
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
  let label = 'Q';
  const ctx = { input: { labelFor: () => label } } as unknown as Ctx;
  const vitals = new Vitals(ctx);
  const key = (vitals as unknown as { stimKey: { el: HTMLElement } }).stimKey.el;
  const state = {
    health: 100, maxHealth: 100, armor: 0, maxArmor: 100, stims: 0, stimInjecting: -1, alive: true,
  } as HudState;
  vitals.reset(state);
  expect(key.textContent).toBe('Q');
  label = 'U';
  vitals.update(state, 0.016);
  expect(key.textContent).toBe('U');
  label = '';
  vitals.update(state, 0.016);
  expect(key.textContent).toBe('');
});
