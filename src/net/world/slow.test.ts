import { describe, expect, it } from 'vitest';
import { FOCUS } from '../../contracts/chips';
import { EFFECTS } from '../../progression/data';
import { Later } from './context';
import { SLOW, SlowBoard, TEAM_SLOW, isSlowKind, slowLine } from './slow';

/** Runs the board for `seconds` at 10 steps a second, as the host's frames would. */
const run = (board: SlowBoard, from: number, seconds: number, each?: (now: number) => void): number => {
  let now = from;
  for (let i = 0; i < seconds * 10; i++) { now += 100; each?.(now); board.update(now); }
  return now;
};

describe("the team's slow-mo rules (the host's board)", () => {
  it("keeps single player's scales and blend-ins, and blends out over half a second or more", () => {
    expect(SLOW.focus.scale).toBe(FOCUS.scale);
    expect(SLOW.focus.fadeIn).toBe(FOCUS.fadeIn);
    expect([SLOW.slowmo.scale, SLOW.timeWarp.scale]).toEqual([0.25, 0.25]);
    for (const kind of ['focus', 'slowmo', 'timeWarp', 'bossDeath'] as const) expect(SLOW[kind].fadeOut).toBeGreaterThanOrEqual(0.5);
    // A request outlives what single player gives it by half a second at most: a dropped player cannot hold the world slow.
    expect(SLOW.focus.cap).toBe(FOCUS.seconds + 0.5);
    expect(SLOW.slowmo.cap).toBe(EFFECTS.slowmo.seconds + 0.5);
    expect(SLOW.timeWarp.cap).toBe(EFFECTS.timeWarp.seconds + 0.5);
  });

  it('lets any player slow the world, names each, and lets the deepest scale win', () => {
    const board = new SlowBoard();
    expect(board.request(1000, 1, 'focus', true)).toBeNull();
    expect(board.scale).toBe(0.35);
    expect(board.request(1500, 0, 'slowmo', true)).toBeNull();
    expect(board.scale).toBe(0.25);
    expect(board.list.map(e => [e.slot, e.kind])).toEqual([[1, 'focus'], [0, 'slowmo']]);
    board.release(0, 'slowmo');
    expect(board.scale).toBe(0.35);
    board.release(1, 'focus');
    expect(board.list).toEqual([]);
    expect(board.scale).toBe(1);
  });

  it('ends a request at its cap, and at the length its owner asked for when that is shorter', () => {
    const board = new SlowBoard();
    board.request(0, 1, 'focus', true);
    board.update(SLOW.focus.cap * 1000 - 1);
    expect(board.list).toHaveLength(1);
    board.update(SLOW.focus.cap * 1000);
    expect(board.list).toHaveLength(0);
    // A quarter-full Focus meter: one second and a bit, not the cap.
    board.request(10_000, 1, 'focus', true, 1.25);
    expect(board.list[0]!.until).toBe(11_250);
    expect(board.list[0]!.total).toBe(1250);
    // A guest cannot ask for longer than the cap.
    board.request(20_000, 2, 'slowmo', true, 600);
    expect(board.list.find(e => e.slot === 2)!.until).toBe(20_000 + SLOW.slowmo.cap * 1000);
  });

  it('resets a request that is asked again; it never adds', () => {
    const board = new SlowBoard();
    board.request(0, 2, 'timeWarp', true, 5.25);
    board.request(4000, 2, 'timeWarp', true, 5.25);
    expect(board.list).toHaveLength(1);
    expect(board.list[0]!.until).toBe(9250);
    // Two players' requests are two entries, each with its own end: the second does not lengthen the first.
    board.request(4500, 3, 'timeWarp', true, 5.25);
    expect(board.list.map(e => e.until)).toEqual([9250, 9750]);
  });

  it('refuses a player who is down or dead, and drops what they had running', () => {
    const board = new SlowBoard();
    expect(board.request(0, 1, 'focus', false)).toBe('down');
    expect(board.list).toHaveLength(0);
    board.request(0, 1, 'focus', true);
    board.request(0, 1, 'slowmo', true);
    board.request(0, 2, 'slowmo', true);
    board.drop(1);
    expect(board.list.map(e => e.slot)).toEqual([2]);
  });

  it(`caps the team at ${TEAM_SLOW.bank} s in a row, then holds the world at full speed until ${TEAM_SLOW.restart} s are back`, () => {
    const board = new SlowBoard();
    let refused = 0;
    board.update(0);
    // Four players keep asking, as fast as they can.
    let now = run(board, 0, 11.9, t => { for (let slot = 0; slot < 4; slot++) if (board.request(t, slot, 'focus', true)) refused++; });
    expect(refused).toBe(0);
    expect(board.scale).toBe(0.35);
    now = run(board, now, 0.3, t => { for (let slot = 0; slot < 4; slot++) board.request(t, slot, 'focus', true); });
    expect(board.list).toHaveLength(0);
    expect(board.locked).toBe(true);
    expect(board.request(now, 0, 'focus', true)).toBe('spent');
    expect(board.request(now, 1, 'slowmo', true)).toBe('spent');
    expect(board.lockMs).toBeGreaterThan(2500);
    now = run(board, now, TEAM_SLOW.restart - 0.5);
    expect(board.request(now, 0, 'focus', true)).toBe('spent');
    now = run(board, now, 0.7);
    expect(board.locked).toBe(false);
    expect(board.lockMs).toBe(0);
    expect(board.request(now, 0, 'focus', true)).toBeNull();
    // Three seconds were back, so three seconds is what they get.
    now = run(board, now, 2.8, t => board.request(t, 0, 'focus', true));
    expect(board.list).toHaveLength(1);
    run(board, now, 1, t => board.request(t, 0, 'focus', true));
    expect(board.locked).toBe(true);
  });

  it('refills the budget at one second for each second at full speed, and a normal fight never meets the cap', () => {
    const board = new SlowBoard();
    board.update(0);
    board.request(0, 0, 'focus', true, 4);
    let now = run(board, 0, 4);
    expect(board.list).toHaveLength(0);
    expect(board.bank).toBeGreaterThan(TEAM_SLOW.bank - 4.05);
    expect(board.bank).toBeLessThan(TEAM_SLOW.bank - 3.7);
    now = run(board, now, 2);
    expect(board.bank).toBeGreaterThan(TEAM_SLOW.bank - 2.05);
    expect(board.bank).toBeLessThan(TEAM_SLOW.bank - 1.7);
    run(board, now, 30);
    expect(board.bank).toBe(TEAM_SLOW.bank);
  });

  it("never refuses a boss's death, never charges it to the budget, and names the boss and its killer", () => {
    const board = new SlowBoard();
    board.update(0);
    let now = run(board, 0, 12.5, t => board.request(t, 0, 'focus', true));
    expect(board.locked).toBe(true);
    expect(board.request(now, -1, 'bossDeath', true, Infinity, 0.45)).toBeNull();
    expect(board.scale).toBe(0.45);
    board.name(2, 'Titan');
    expect(board.list[0]).toMatchObject({ key: 'boss', slot: 2, label: 'Titan' });
    const bank = board.bank;
    now = run(board, now, 2);
    // The world's own slow-mo does not spend the team's budget, and does not stop it filling.
    expect(board.bank).toBeGreaterThan(bank);
    board.release(-1, 'bossDeath');
    expect(board.list).toHaveLength(0);
    // It ends by itself too, if the boss's own end is lost.
    board.request(now, -1, 'bossDeath', true);
    board.update(now + SLOW.bossDeath.cap * 1000);
    expect(board.list).toHaveLength(0);
  });

  it('counts a change only when something changed, so the host sends the state when it must', () => {
    const board = new SlowBoard();
    board.update(0);
    const v0 = board.version;
    run(board, 0, 2);
    expect(board.version).toBe(v0);
    board.request(2000, 0, 'focus', true);
    expect(board.version).toBe(v0 + 1);
    board.release(0, 'focus');
    board.release(0, 'focus');
    expect(board.version).toBe(v0 + 2);
  });

  it('survives a stalled host: a long gap neither spends nor banks the whole stall', () => {
    const board = new SlowBoard();
    board.update(0);
    board.request(0, 0, 'focus', true);
    board.update(60_000);
    expect(board.list).toHaveLength(0);
    expect(board.bank).toBeGreaterThan(TEAM_SLOW.bank - 0.5);
  });
});

describe('the notice’s words', () => {
  it('names who and what, in the words of each cause', () => {
    expect(slowLine('focus', 'KESTREL', '')).toEqual({ who: 'KESTREL', what: 'used Focus' });
    expect(slowLine('slowmo', 'VIPER-27', '')).toEqual({ who: 'VIPER-27', what: 'earned SLOWMO' });
    expect(slowLine('timeWarp', 'KESTREL', '')).toEqual({ who: 'KESTREL', what: 'took Time Warp' });
    expect(slowLine('bossDeath', 'KESTREL', 'Juggernaut')).toEqual({ who: 'KESTREL', what: 'killed the JUGGERNAUT' });
    expect(slowLine('bossDeath', '', 'Titan')).toEqual({ who: '', what: 'The TITAN is dead' });
  });
  it('knows a kind from junk', () => {
    expect(['focus', 'slowmo', 'timeWarp', 'bossDeath'].every(isSlowKind)).toBe(true);
    expect([undefined, 'judgeFan', 'hud-death', 7, null].some(isSlowKind)).toBe(false);
  });
});

describe("the host's delayed work (T2)", () => {
  it("burns an enemy's fuse on the world clock, so shared slow-mo stretches the blast with the grenade", () => {
    let dt = 1 / 16;
    const later = new Later(() => dt);
    let fired = 0;
    later.after(1, () => fired++);
    for (let i = 0; i < 15; i++) later.update(0);
    expect(fired).toBe(0);
    later.update(0);
    expect(fired).toBe(1);
    // At quarter speed the same fuse takes four times as many frames.
    dt = 1 / 64;
    later.after(1, () => fired++);
    for (let i = 0; i < 63; i++) later.update(0);
    expect(fired).toBe(1);
    later.update(0);
    expect(fired).toBe(2);
    // Work on the real clock is untouched.
    later.push(500, () => fired++);
    later.update(499);
    expect(fired).toBe(2);
    later.update(500);
    expect(fired).toBe(3);
  });
});
