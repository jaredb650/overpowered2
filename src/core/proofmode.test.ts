import { describe, expect, it } from 'vitest';
import { DrawGate, clockDue, drawGate, proofPage, proofSwitches } from './proofmode';

describe('proof mode', () => {
  it('a page the proofs may drive is a dev build or this computer, never the public site', () => {
    expect(proofPage('jaredb650.github.io', false)).toBe(false);
    expect(proofPage('example.com', false)).toBe(false);
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(proofPage(host, false)).toBe(true);
    expect(proofPage('jaredb650.github.io', true)).toBe(true);
  });

  it('is off unless the harness asked, and off on the public site whatever is asked', () => {
    expect(proofSwitches(undefined, '127.0.0.1', true)).toBeNull();
    expect(proofSwitches({ draw: 4 }, 'jaredb650.github.io', false)).toBeNull();
    expect(proofSwitches({ draw: 0 }, 'example.com', false)).toBeNull();
    expect(proofSwitches('draw', '127.0.0.1', true)).toBeNull();
    expect(drawGate(proofSwitches({ draw: 4 }, 'jaredb650.github.io', false))).toBeNull();
  });

  it('is on for a dev build or a page served from this computer', () => {
    expect(proofSwitches({ draw: 4 }, 'jaredb650.github.io', true)).toEqual({ draw: 4 });
    expect(proofSwitches({ draw: 4 }, '127.0.0.1', false)).toEqual({ draw: 4 });
    expect(proofSwitches({ draw: 0 }, 'localhost', false)).toEqual({ draw: 0 });
    expect(proofSwitches({ draw: 4 }, '[::1]', false)).toEqual({ draw: 4 });
  });

  it('takes the loop clock with the same gate, and drops a backlog of ticks', () => {
    expect(proofSwitches({ draw: 0, clock: 60 }, '127.0.0.1', false)).toEqual({ draw: 0, clock: 60 });
    expect(proofSwitches({ clock: 60 }, 'jaredb650.github.io', false)).toBeNull();
    expect(proofSwitches({ clock: 0 }, '127.0.0.1', true)).toEqual({});
    expect(proofSwitches({ clock: 100000 }, '127.0.0.1', true)).toEqual({ clock: 240 });
    expect(clockDue(1016.7, 1000, 60)).toBe(true);
    // Three ticks queued behind a stall arrive within a millisecond: one steps.
    expect(clockDue(1300.2, 1300, 60)).toBe(false);
    expect(clockDue(1300.4, 1300, 60)).toBe(false);
  });

  it('draws every frame when no rate is given', () => {
    expect(drawGate(proofSwitches({}, '127.0.0.1', true))).toBeNull();
    expect(drawGate(proofSwitches({ draw: -1 }, '127.0.0.1', true))).toBeNull();
    expect(drawGate(null)).toBeNull();
  });

  it('draws the asked number of frames a second out of sixty', () => {
    const gate = new DrawGate(4);
    let drawn = 0;
    for (let frame = 0; frame < 600; frame++) if (gate.due(frame / 60)) drawn++;
    expect(drawn).toBeGreaterThanOrEqual(38);
    expect(drawn).toBeLessThanOrEqual(42);
    expect(gate.drawn + gate.skipped).toBe(600);
  });

  it('draws nothing at rate 0 until a picture is asked for', () => {
    const gate = new DrawGate(0);
    for (let frame = 0; frame < 120; frame++) expect(gate.due(frame / 60)).toBe(false);
    gate.show(3);
    expect([gate.due(2), gate.due(2.016), gate.due(2.033), gate.due(2.05)]).toEqual([true, true, true, false]);
  });

  it('does not draw a burst after a long frame', () => {
    const gate = new DrawGate(10);
    expect(gate.due(0)).toBe(true);
    expect(gate.due(5)).toBe(true);
    expect(gate.due(5.016)).toBe(false);
  });

  it('takes a new rate while running', () => {
    const gate = new DrawGate(0);
    gate.rate(60);
    let drawn = 0;
    for (let frame = 0; frame < 60; frame++) if (gate.due(10 + frame / 60)) drawn++;
    expect(drawn).toBe(60);
  });
});
