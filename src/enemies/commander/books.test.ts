/**
 * The Commander's notebooks in co-op (books.ts): one a player on the host. Alone it is the one notebook, number for number.
 */
import { describe, expect, it } from 'vitest';
import { pickAdaptation } from './director';
import { Books } from './books';
import { StyleTracker } from './tracker';

const doors = [{ x: 0, z: 0, dx: 1, dz: 0 }, { x: 20, z: 0, dx: 1, dz: 0 }, { x: 40, z: 0, dx: 1, dz: 0 }];
const noDice = () => 0;

/** A player who stands at one spot through a fight. */
const camp = (t: StyleTracker, seconds = 120): void => { for (let i = 0; i < seconds * 4; i++) t.sample(0.25, 5, 0.1, 5, 0, true, 'CRATES'); };
/** A player who runs a wide loop, never still, at `speed`. */
const roam = (t: StyleTracker, seconds = 120, speed = 5): void => { for (let i = 0; i < seconds * 4; i++) t.sample(0.25, Math.sin(i / 8) * 30, 0.1, 60 + Math.cos(i / 8) * 30, speed, true, 'YARD'); };
/** A player who walks back and forth through door `d`. */
const cross = (t: StyleTracker, d: number, seconds = 60): void => { for (let i = 0; i < seconds * 4; i++) t.sample(0.25, doors[d]!.x + (i % 16 < 8 ? -2 : 2), 0.1, 0, 5, true, null); };

describe('alone: the one notebook, as it always was', () => {
  it('every answer is the host notebook\'s own', () => {
    const books = new Books();
    books.setDoors(doors);
    const plain = new StyleTracker();
    plain.setDoors(doors);
    for (const t of [books.own, plain]) {
      camp(t, 30);
      cross(t, 1, 30);
      for (let i = 0; i < 40; i++) t.shot('smg', 20, 1);
      t.kill('smg', 30, true);
    }
    expect(books.shared).toBe(false);
    expect(books.habits()).toEqual(plain.habits());
    expect(books.hotDoors(3)).toEqual(plain.hotDoors(3));
    expect(books.hotCells(5)).toEqual(plain.hotCells(5));
    expect(books.closeRound(2)).toEqual(plain.closeRound(2));
    expect(books.report(null)).toEqual(books.report('nobody'));
    expect(books.leader.size).toBe(0);
  });
});

describe('co-op: a habit is one player\'s', () => {
  it('a guest who camps is the camper, though the host never stands still: the mortars come, and he is named', () => {
    const books = new Books();
    books.setDoors(doors);
    roam(books.own);
    camp(books.of('guest'));
    const habits = books.habits();
    expect(books.own.habits().camping).toBeLessThan(0.1);
    expect(habits.camping).toBe(1);
    expect(books.leader.get('camping')).toBe('guest');
    expect(pickAdaptation(habits, new Set(), 3, noDice)).toBe('mortars');
  });

  it('the host\'s own habit still counts when the guests have none', () => {
    const books = new Books();
    books.setDoors(doors);
    camp(books.own);
    roam(books.of('guest'));
    expect(books.habits().camping).toBe(1);
    expect(books.leader.has('camping')).toBe(false);
  });

  it('nothing is added up: four players who each ping now and then are not one sonar addict', () => {
    const books = new Books();
    const each = (t: StyleTracker): void => { roam(t, 60); t.round.pings = 2; };
    each(books.own);
    for (const id of ['a', 'b', 'c']) each(books.of(id));
    // Two pings a minute each: half the habit. Summed it would be eight a minute and the jammers would come.
    expect(books.habits().sonar).toBeCloseTo(books.own.habits().sonar, 6);
    expect(books.habits().sonar).toBeLessThan(0.6);
  });

  it('routes are everyone\'s, weighted by who uses them: the door three players use outranks the one a single player lives in', () => {
    const books = new Books();
    books.setDoors(doors);
    cross(books.own, 0, 40);
    for (const id of ['a', 'b', 'c']) cross(books.of(id), 2, 20);
    expect(books.own.hotDoors(1)).toEqual([0]);
    expect(books.hotDoors(2)).toEqual([2, 0]);
  });

  it('the squares the team stands in are added up too', () => {
    const books = new Books();
    for (let i = 0; i < 6; i++) { books.own.sample(0.25, 1, 0, 1, 5, true, null); books.own.sample(0.25, 41, 0, 1, 5, true, null); }
    for (const id of ['a', 'b']) for (let i = 0; i < 5; i++) { books.of(id).sample(0.25, 81, 0, 1, 5, true, null); books.of(id).sample(0.25, 121, 0, 1, 5, true, null); }
    const hot = books.hotCells(1)[0]!;
    // Ten visits between two guests beat the host's six.
    expect(hot.visits).toBe(10);
    expect([81, 121]).toContain(hot.x);
  });

  it('the box quotes one player\'s round, never a blend', () => {
    const books = new Books();
    books.setDoors(doors);
    for (let i = 0; i < 30; i++) books.own.shot('smg', 0, 1);
    for (let i = 0; i < 90; i++) books.of('guest').shot('shotgun', 20, 1);
    books.of('guest').kill('shotgun', 4, false);
    const own = books.closeRound(4);
    expect(own.shots).toBe(30);
    expect(own.favouriteWeapon).toBe('smg');
    expect(books.report('guest')).toMatchObject({ shots: 90, favouriteWeapon: 'shotgun', kills: 1, wave: 4 });
    expect(books.report(null)).toBe(own);
    // Every notebook starts the next round clean.
    expect(books.of('guest').round.shots).toBe(0);
  });

  it('a player who leaves takes their habits with them, and a new run starts with the one notebook', () => {
    const books = new Books();
    camp(books.of('gone'));
    roam(books.own);
    expect(books.habits().camping).toBe(1);
    books.keep(new Set(['someone-else']));
    expect(books.habits().camping).toBeLessThan(0.1);
    camp(books.of('guest'));
    books.reset();
    expect(books.shared).toBe(false);
  });
});
