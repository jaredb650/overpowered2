import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CLEAR_BYTES, Pressure, SLOW_BYTES, STALLED_BYTES, STALLED_MS } from './pressure';
import { droppable, eventClasses } from './worldProtocol';

describe('backpressure on the reliable lane', () => {
  it('a healthy peer is ok; past the slow mark cosmetics are left out until the queue is back under the clear mark', () => {
    const p = new Pressure();
    expect(p.of('g')).toBe('ok');
    expect(p.drops('g')).toBe(false);
    expect(p.judge('g', SLOW_BYTES, 0, 0)).toBe('ok');
    expect(p.judge('g', SLOW_BYTES + 1, 0, 100)).toBe('slow');
    expect(p.drops('g')).toBe(true);
    // Under the slow mark but not yet clear: still slow, so the peer does not flap at the mark.
    expect(p.judge('g', SLOW_BYTES - 1, 0, 200)).toBe('slow');
    expect(p.judge('g', CLEAR_BYTES - 1, 0, 300)).toBe('ok');
    expect(p.drops('g')).toBe(false);
    expect(p.stats).toEqual({ dropped: 1, stalls: 0 });
  });

  it('slow for too long without a break, too much queued, or a message lost: stalled', () => {
    const p = new Pressure();
    p.judge('long', SLOW_BYTES + 1, 0, 0);
    expect(p.judge('long', SLOW_BYTES + 1, 0, STALLED_MS)).toBe('slow');
    expect(p.judge('long', CLEAR_BYTES, 0, STALLED_MS + 1)).toBe('stalled');
    expect(p.judge('big', STALLED_BYTES + 1, 0, 5)).toBe('stalled');
    expect(p.judge('hole', 0, 1, 5)).toBe('stalled');
    // The same count of lost messages again is old news.
    expect(p.judge('hole', 0, 1, 6)).toBe('ok');
    expect(p.judge('hole', 0, 2, 7)).toBe('stalled');
    expect(p.stats.stalls).toBe(4);
    // A stalled peer starts again only once its queue has drained.
    expect(p.clear('big', CLEAR_BYTES)).toBe(false);
    expect(p.of('big')).toBe('stalled');
    expect(p.clear('big', CLEAR_BYTES - 1)).toBe(true);
    expect(p.of('big')).toBe('ok');
    p.forget('long');
    expect(p.of('long')).toBe('ok');
  });

  it('by property: a peer whose queue never passes the slow mark and loses nothing is never slow, and one over the stalled mark always is stalled', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: SLOW_BYTES }), fc.integer({ min: 0, max: 5000 })), { maxLength: 60 }), steps => {
      const p = new Pressure();
      let now = 0;
      for (const [queued, dt] of steps) expect(p.judge('g', queued, 0, now += dt)).toBe('ok');
      expect(p.stats).toEqual({ dropped: 0, stalls: 0 });
    }));
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: STALLED_BYTES * 2 }), fc.integer({ min: 0, max: 5000 })), { maxLength: 60 }), steps => {
      const p = new Pressure();
      let now = 0;
      for (const [queued, dt] of steps) {
        const verdict = p.judge('g', queued, 0, now += dt);
        if (queued > STALLED_BYTES) expect(verdict).toBe('stalled');
        if (queued < CLEAR_BYTES) expect(verdict).toBe('ok');
      }
    }));
  });
});

describe('every event type is classed', () => {
  it('facts are never left out; the pictures, the sounds and the states sent again are', () => {
    const classes = eventClasses();
    // What may be left out for a peer that is behind, in full: a new entry here is a decision, not an accident.
    const left = [...classes.keys()].filter(droppable).sort();
    expect(left).toEqual(['allies', 'ashot', 'boom', 'card', 'chatcut', 'chatter', 'efx', 'fire', 'hitfx', 'mfx', 'pfx', 'ray', 'round', 'say', 'shock', 'team', 'vehicles']);
    for (const fact of ['hit', 'status', 'vhit', 'ack', 'kill', 'sever', 'hurt', 'shove', 'wave', 'over', 'up', 'life', 'revive', 'loop', 'held', 'slowstate', 'cin', 'cnews', 'move', 'who', 'mission', 'worldsync', 'pod', 'gun', 'prop', 'restore', 'kit']) {
      expect(classes.get(fact), fact).toBe('fact');
      expect(droppable(fact)).toBe(false);
    }
    expect(droppable('no-such-event')).toBe(false);
    expect(droppable('constructor')).toBe(false);
  });
});
