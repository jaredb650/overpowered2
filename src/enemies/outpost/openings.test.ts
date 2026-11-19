/**
 * Co-op: an opening is the player's who gave it. A flashbang's goes by whose eyes it caught: the host's own on the host's
 * screen, a guest's by that guest's word (crowd.ts, note 'blind'), and only the squads fighting that player go in.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlayerSystem } from '../../core/contracts';
import type { CrowdPlayer, Note } from './crowd';
import { Outpost } from './index';

const player = (name: string) => ({ name } as unknown as PlayerSystem);

/** The Outpost's own `seizeOpening` over stand-in squads: each is in contact and after `quarry`. */
function side(quarries: (PlayerSystem | null)[], me: PlayerSystem) {
  const squads = quarries.map(quarry => ({ inContact: true, directed: false, leader: {}, quarry, opening: vi.fn() }));
  const o = {
    squads, comms: { say: vi.fn() },
    quarryOf: (q: { quarry: PlayerSystem | null }) => q.quarry,
    w: { ctx: { coop: { world: { me } } } },
  };
  const seize = (...args: Parameters<Outpost['seizeOpening']>) => Outpost.prototype.seizeOpening.apply(o as unknown as Outpost, args);
  return { squads, o, seize };
}

describe('whose opening it is', () => {
  it('a guest blinded by a flashbang is the men\'s opening on that guest', () => {
    const seizeOpening = vi.fn();
    const guest = player('guest');
    const note = { kind: 'blind', n: 1, what: '', left: 1 } as unknown as Note;
    Outpost.prototype.told.call({ seizeOpening, commander: { learn: vi.fn() }, noise: vi.fn() } as unknown as Outpost, { id: 'g', slot: 1, player: guest, own: false } as CrowdPlayer, note);
    expect(seizeOpening).toHaveBeenCalledTimes(1);
    const [kind, seconds, flags, whose] = seizeOpening.mock.calls[0]!;
    expect(kind).toBe('opening');
    expect(seconds).toBeGreaterThan(0);
    expect(flags).toEqual({ blind: true });
    expect(whose).toBe(guest);
  });

  it('only the squads fighting the blinded player go in; a squad with nobody in its sights counts as after the host', () => {
    const host = player('host'), guest = player('guest');
    const s = side([host, guest, null], host);
    s.seize('opening', 3, { blind: true }, guest);
    expect(s.squads.map(q => q.opening.mock.calls.length)).toEqual([0, 1, 0]);
    s.seize('opening', 3, { blind: true }, host);
    expect(s.squads.map(q => q.opening.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('alone there is no "whose": every squad in contact takes it, as it always did', () => {
    const me = player('me');
    const s = side([null, null], me);
    s.seize('opening', 3, { blind: true }, undefined);
    expect(s.squads.map(q => q.opening.mock.calls.length)).toEqual([1, 1]);
    expect(s.o.comms.say).toHaveBeenCalledTimes(1);
  });
});
