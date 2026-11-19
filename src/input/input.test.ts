import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/** The few DOM globals Input touches, so its edge logic runs under plain Node. */
class FakeElement extends EventTarget {}
const pointer = { element: null as unknown };
const storage = new Map<string, string>();

beforeAll(() => {
  const win = new EventTarget();
  const doc = new EventTarget();
  Object.defineProperty(doc, 'pointerLockElement', { get: () => pointer.element });
  Object.assign(doc, { hidden: false, fullscreenElement: null, exitPointerLock: () => { pointer.element = null; } });
  Object.assign(globalThis, {
    window: win,
    document: doc,
    HTMLElement: FakeElement,
    WheelEvent: { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
});

async function make() {
  const { createInput } = await import('./index');
  const canvas = new FakeElement() as unknown as HTMLCanvasElement;
  Object.assign(canvas, {
    requestPointerLock: () => {
      pointer.element = canvas;
      return Promise.resolve();
    },
  });
  return { input: createInput(canvas), canvas };
}

function key(type: 'keydown' | 'keyup', code: string, repeat = false): void {
  const e = new Event(type) as Event & { code: string; repeat: boolean };
  e.code = code;
  e.repeat = repeat;
  window.dispatchEvent(e);
}

function mouseMove(x: number, y: number): void {
  const e = new Event('mousemove') as Event & { movementX: number; movementY: number; isTrusted2: boolean };
  e.movementX = x;
  e.movementY = y;
  document.dispatchEvent(e);
}

beforeEach(() => {
  storage.clear();
  pointer.element = null;
});

describe('edges', () => {
  it('pressed lasts one frame and held stays until release', async () => {
    const { input } = await make();
    key('keydown', 'KeyW');
    expect(input.pressed('forward')).toBe(true);
    expect(input.isDown('forward')).toBe(true);
    input.endFrame();
    expect(input.pressed('forward')).toBe(false);
    expect(input.isDown('forward')).toBe(true);
    key('keyup', 'KeyW');
    expect(input.released('forward')).toBe(true);
    input.endFrame();
    expect(input.released('forward')).toBe(false);
    input.dispose();
  });

  it('keeps a tap that starts and ends between two frames', async () => {
    const { input } = await make();
    key('keydown', 'Space');
    key('keyup', 'Space');
    expect(input.pressed('jump')).toBe(true);
    expect(input.isDown('jump')).toBe(false);
    input.dispose();
  });

  it('ignores key repeat, and a second key on the same action makes no new edge', async () => {
    const { input } = await make();
    key('keydown', 'KeyC');
    input.endFrame();
    key('keydown', 'KeyC', true);
    expect(input.pressed('slide')).toBe(false);
    key('keydown', 'ControlLeft');
    expect(input.pressed('slide')).toBe(false);
    key('keyup', 'KeyC');
    expect(input.released('slide')).toBe(false);
    expect(input.isDown('slide')).toBe(true);
    key('keyup', 'ControlLeft');
    expect(input.released('slide')).toBe(true);
    input.dispose();
  });

  it('blur clears held keys but leaves bot input alone', async () => {
    const { input } = await make();
    key('keydown', 'KeyW');
    input.simulate('jump', true);
    window.dispatchEvent(new Event('blur'));
    expect(input.isDown('forward')).toBe(false);
    expect(input.released('forward')).toBe(true);
    expect(input.isDown('jump')).toBe(true);
    input.dispose();
  });
});

describe('look and wheel', () => {
  it('accumulates every mouse event between frames', async () => {
    const { input } = await make();
    input.requestLock();
    mouseMove(99, 99); // the first event after locking is the warp, and is dropped
    mouseMove(3, -1);
    mouseMove(4, -2);
    const look = input.consumeLook();
    expect(look).toEqual({ x: 7, y: -3 });
    expect(input.frameLook).toEqual({ x: 7, y: -3 });
    expect(input.consumeLook()).toEqual({ x: 0, y: 0 });
    input.dispose();
  });

  it('simulateLook works without pointer lock', async () => {
    const { input } = await make();
    input.simulateLook(10, 5);
    expect(input.consumeLook()).toEqual({ x: 10, y: 5 });
    input.dispose();
  });

  it('turns wheel pixels into notches and fires the weapon actions', async () => {
    const { input } = await make();
    const wheel = (deltaY: number) => {
      const e = new Event('wheel') as Event & { deltaY: number; deltaMode: number };
      e.deltaY = deltaY;
      e.deltaMode = 0;
      window.dispatchEvent(e);
    };
    wheel(40);
    expect(input.consumeWheel()).toBe(0);
    wheel(70);
    expect(input.pressed('weaponNext')).toBe(true);
    expect(input.isDown('weaponNext')).toBe(false);
    expect(input.consumeWheel()).toBe(1);
    input.dispose();
  });

  it('treats losing pointer lock as a pause press', async () => {
    const { input } = await make();
    input.requestLock();
    key('keydown', 'KeyW');
    input.endFrame();
    pointer.element = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(input.pressed('pause')).toBe(true);
    expect(input.isDown('forward')).toBe(false);
    input.dispose();
  });
});

describe('rebinding', () => {
  it('defaults to Q for stims, leaves Y free, and keeps last weapon unbound but bindable', async () => {
    const { input } = await make();
    expect(input.bindingsFor('stim')).toEqual(['KeyQ']);
    expect(input.labelFor('stim')).toBe('Q');
    expect(input.bindingsFor('weaponLast')).toEqual([]);
    expect(input.labelFor('weaponLast')).toBe('');
    expect(input.conflicts('KeyQ')).toEqual(['stim']);
    expect(input.conflicts('KeyY')).toEqual([]);
    key('keydown', 'KeyQ');
    expect(input.pressed('stim')).toBe(true);
    expect(input.isDown('weaponLast')).toBe(false);
    expect(input.pressed('weaponLast')).toBe(false);
    expect(input.released('weaponLast')).toBe(false);
    key('keyup', 'KeyQ');
    input.endFrame();
    key('keydown', 'KeyY');
    expect(input.pressed('stim')).toBe(false);
    input.rebind('weaponLast', ['KeyK']);
    key('keydown', 'KeyK');
    expect(input.pressed('weaponLast')).toBe(true);
    input.rebind('weaponLast', []);
    expect(input.labelFor('weaponLast')).toBe('');
    expect(input.isDown('weaponLast')).toBe(false);
    input.dispose();
    const restored = await make();
    expect(restored.input.bindingsFor('weaponLast')).toEqual([]);
    restored.input.dispose();
  });

  it.each([false, true])('migrates untouched legacy pairs, full map: %s', async full => {
    const { DEFAULT_BINDINGS } = await import('./bindings');
    storage.set('op2.bindings.v1', JSON.stringify(full
      ? { ...DEFAULT_BINDINGS, stim: ['KeyY'], weaponLast: ['KeyQ'], jump: ['KeyK'] }
      : { jump: ['KeyK'] }));
    const { input } = await make();
    expect(input.bindingsFor('stim')).toEqual(['KeyQ']);
    expect(input.bindingsFor('weaponLast')).toEqual([]);
    expect(input.bindingsFor('jump')).toEqual(['KeyK']);
    input.rebind('reload', ['KeyU']);
    expect(JSON.parse(storage.get('op2.bindings.v2')!)).toMatchObject({ stim: ['KeyQ'], weaponLast: [] });
    input.resetBindings();
    expect(storage.has('op2.bindings.v1')).toBe(false);
    expect(storage.has('op2.bindings.v2')).toBe(false);
    input.dispose();
  });

  it.each([
    { stim: ['KeyU'], weaponLast: ['KeyQ'] },
    { stim: ['KeyY'], weaponLast: ['KeyK'] },
    { stim: [], weaponLast: ['KeyQ'] },
    { stim: ['KeyY', 'KeyU'], weaponLast: [] },
  ])('preserves customized legacy pairs: %j', async pair => {
    storage.set('op2.bindings.v1', JSON.stringify(pair));
    const { input } = await make();
    expect(input.bindingsFor('stim')).toEqual(pair.stim);
    expect(input.bindingsFor('weaponLast')).toEqual(pair.weaponLast);
    input.dispose();
  });

  it('preserves deliberately rebound legacy keys after a v2 save', async () => {
    storage.set('op2.bindings.v1', JSON.stringify({ stim: ['KeyU'], weaponLast: [] }));
    const first = await make();
    first.input.rebind('stim', ['KeyY']);
    first.input.rebind('weaponLast', ['KeyQ']);
    first.input.dispose();
    const second = await make();
    expect(second.input.bindingsFor('stim')).toEqual(['KeyY']);
    expect(second.input.bindingsFor('weaponLast')).toEqual(['KeyQ']);
    second.input.dispose();
  });

  it.each(['null', '[]', 'broken'])('uses new defaults for corrupt legacy storage: %s', async raw => {
    storage.set('op2.bindings.v1', raw);
    const { input } = await make();
    expect(input.bindingsFor('stim')).toEqual(['KeyQ']);
    expect(input.bindingsFor('weaponLast')).toEqual([]);
    input.dispose();
  });

  it('the co-op ping never lands on a key a saved map already uses', async () => {
    // Saved before the ping existed, with quick melee on the middle button and reload on P.
    storage.set('op2.bindings.v2', JSON.stringify({ melee: ['Mouse1'], reload: ['KeyP'] }));
    const both = await make();
    expect(both.input.bindingsFor('ping')).toEqual([]);
    expect(both.input.conflicts('Mouse1')).toEqual(['melee']);
    expect(both.input.conflicts('KeyP')).toEqual(['reload']);
    both.input.dispose();

    // One of its keys taken: it keeps the other.
    storage.set('op2.bindings.v2', JSON.stringify({ melee: ['Mouse1'] }));
    const one = await make();
    expect(one.input.bindingsFor('ping')).toEqual(['KeyP']);
    one.input.dispose();

    // A saved map that touches neither, and no saved map at all: both defaults.
    storage.set('op2.bindings.v2', JSON.stringify({ jump: ['KeyJ'] }));
    const free = await make();
    expect(free.input.bindingsFor('ping')).toEqual(['Mouse1', 'KeyP']);
    free.input.dispose();
    storage.clear();
    const fresh = await make();
    expect(fresh.input.bindingsFor('ping')).toEqual(['Mouse1', 'KeyP']);
    fresh.input.dispose();

    // Once the player has saved a ping key of their own, it is theirs, clash or not.
    storage.set('op2.bindings.v2', JSON.stringify({ melee: ['Mouse1'], ping: ['Mouse1'] }));
    const chosen = await make();
    expect(chosen.input.bindingsFor('ping')).toEqual(['Mouse1']);
    chosen.input.dispose();
  });

  it('rebinds, persists, and restores defaults', async () => {
    const first = await make();
    first.input.rebind('jump', ['KeyJ']);
    key('keydown', 'KeyJ');
    expect(first.input.pressed('jump')).toBe(true);
    key('keyup', 'KeyJ');
    first.input.dispose();

    const second = await make();
    expect(second.input.bindingsFor('jump')).toEqual(['KeyJ']);
    expect(second.input.labelFor('jump')).toBe('J');
    expect(second.input.conflicts('KeyW')).toEqual(['forward']);
    second.input.resetBindings();
    expect(second.input.bindingsFor('jump')).toEqual(['Space']);
    second.input.dispose();
  });

  it('captures the next key for a press-a-key prompt, and Esc cancels', async () => {
    const { input } = await make();
    const got: (string | null)[] = [];
    input.captureNext(c => got.push(c));
    key('keydown', 'KeyK');
    input.captureNext(c => got.push(c));
    key('keydown', 'Escape');
    expect(got).toEqual(['KeyK', null]);
    expect(input.pressed('pause')).toBe(false);
    input.dispose();
  });
});
