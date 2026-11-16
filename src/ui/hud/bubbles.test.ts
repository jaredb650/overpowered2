import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import type { CommsKind, CommsLine } from '../../enemies/outpost/events';
import { airtime, Bubbles, BUBBLE_RANGE, MAX_BUBBLES } from './bubbles';

class FakeElement {
  className = '';
  textContent = '';
  style = { setProperty: vi.fn() } as Record<string, unknown>;
  classList = { toggle: vi.fn(), add: vi.fn() };
  offsetWidth = 120;
  offsetHeight = 24;
  append = vi.fn();
  animate = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const camera = new THREE.PerspectiveCamera(90, 1440 / 900, 0.1, 500);
  camera.position.set(0, 1.6, 0);
  camera.updateMatrixWorld();
  const ctx = { render: { camera }, physics: { raycast: vi.fn(() => null) } } as unknown as Ctx;
  return { ctx, bubbles: new Bubbles(ctx) };
}

/** A man `z` metres in front of the camera, `x` to the side. */
function man(x: number, z: number, hasLos = true): EnemyInstance {
  const root = new THREE.Object3D();
  root.position.set(x, 1.6, -z);
  root.updateMatrixWorld();
  return { alive: true, hasLos, center: root.position.clone(), char: { bones: [], root } } as unknown as EnemyInstance;
}

const line = (enemy: EnemyInstance | null, kind: CommsKind = 'contact', text = 'Contact. Tango in the open.'): CommsLine =>
  ({ kind, text, squad: 'Alpha', speaker: 'Cpl Marsh · Alpha', enemy, position: new THREE.Vector3(), row: -1 });

it('hangs a line over a man in sight and within range, and keeps it feed-only otherwise', () => {
  const { bubbles } = setup();
  expect(bubbles.say(line(man(0, BUBBLE_RANGE + 5)), 'var(--cold)')).toBe(false);
  expect(bubbles.say(line(man(0, 12, false)), 'var(--cold)')).toBe(false);
  expect(bubbles.say(line(man(0, -12)), 'var(--cold)')).toBe(false);
  expect(bubbles.say(line(null), 'var(--cold)')).toBe(false);
  expect(bubbles.say(line(man(0, 20)), 'var(--cold)')).toBe(true);
  expect(bubbles.live).toBe(1);
});

it('holds three at most: a fourth takes the oldest that is not urgent', () => {
  const { bubbles } = setup();
  const men = [man(-3, 12), man(-1, 12), man(1, 12), man(3, 12)];
  bubbles.say(line(men[0]!, 'frag', 'Frag out.'), 'var(--cold)');
  bubbles.update(0.1);
  bubbles.say(line(men[1]!), 'var(--cold)');
  bubbles.update(0.1);
  bubbles.say(line(men[2]!), 'var(--cold)');
  bubbles.update(0.1);
  expect(bubbles.live).toBe(MAX_BUBBLES);
  bubbles.say(line(men[3]!), 'var(--cold)');
  expect(bubbles.live).toBe(MAX_BUBBLES);
  const speakers = bubbles.pool.map(b => b.enemy);
  // The urgent frag call stays; the oldest plain line made the room.
  expect(speakers).toContain(men[0]);
  expect(speakers).not.toContain(men[1]);
  expect(speakers).toContain(men[3]);
});

it('gives a man one bubble, which his next line takes over', () => {
  const { bubbles } = setup();
  const marsh = man(0, 15);
  bubbles.say(line(marsh), 'var(--cold)');
  bubbles.say(line(marsh, 'moving', 'Moving.'), 'var(--cold)');
  expect(bubbles.live).toBe(1);
  expect(bubbles.pool.find(b => b.enemy === marsh)!.full).toBe('Moving.');
});

it('types the words at speaking pace, and a cut stops them mid-word with a dash, held where he fell', () => {
  const { bubbles } = setup();
  const marsh = man(0, 15);
  bubbles.say(line(marsh, 'contact', 'Bravo, he is heading north.'), 'var(--cold)');
  const b = bubbles.pool.find(x => x.enemy === marsh)!;
  bubbles.update(0.3);
  expect(b.text.textContent).toBe('Bravo,');
  bubbles.cut(marsh, 12);
  expect(b.text.textContent).toBe('Bravo, he is—');
  (marsh as { alive: boolean }).alive = false;
  bubbles.update(0.5);
  expect(bubbles.live).toBe(1);
  bubbles.update(1);
  expect(bubbles.live).toBe(0);
});

it('lasts as long as the line takes to say, and goes when he does', () => {
  const { bubbles } = setup();
  const text = 'Contact. Tango in the open.';
  bubbles.say(line(man(0, 15), 'contact', text), 'var(--cold)');
  bubbles.update(airtime(text) - 0.05);
  expect(bubbles.live).toBe(1);
  bubbles.update(0.1);
  expect(bubbles.live).toBe(0);
  const novak = man(0, 15);
  bubbles.say(line(novak), 'var(--cold)');
  (novak as { alive: boolean }).alive = false;
  bubbles.update(0.016);
  expect(bubbles.live).toBe(0);
});

it('stacks bubbles that would overlap', () => {
  const { bubbles } = setup();
  bubbles.say(line(man(0, 15)), 'var(--cold)');
  bubbles.say(line(man(0.05, 15.2)), 'var(--cold)');
  const [a, b] = bubbles.pool.filter(x => x.enemy);
  expect(Math.abs(a!.y - b!.y)).toBeGreaterThanOrEqual(24 * 1.1 - 0.01);
});

it('shows a critical warning under the crosshair, with an arrow to where it came from, and lets it go', () => {
  const { bubbles } = setup();
  bubbles.warn(new THREE.Vector3(5, 1.6, -10), 'FLASH INCOMING');
  bubbles.update(0.1);
  expect(bubbles.warnEl.style.visibility).toBe('');
  bubbles.update(2);
  expect(bubbles.warnEl.style.visibility).toBe('hidden');
});
