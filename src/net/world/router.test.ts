import { describe, expect, it, vi } from 'vitest';
import type { WorldEvent } from '../worldProtocol';
import { Router } from './router';

describe('the world event router', () => {
  const fire: WorldEvent = { t: 'fire', weapon: 'smg', origin: [0, 0, 0], dir: [0, 0, -1] };
  it('hands an event to the handler of the side that hears it, with who sent it and when', () => {
    const router = new Router();
    const host = vi.fn(), guest = vi.fn();
    router.host('fire', host); router.guest('fire', guest);
    router.dispatch(fire, 'peer', true, 5);
    expect(host).toHaveBeenCalledWith(fire, 'peer', 5); expect(guest).not.toHaveBeenCalled();
    router.dispatch(fire, 'host-peer', false, 6);
    expect(guest).toHaveBeenCalledWith(fire, 'host-peer', 6); expect(host).toHaveBeenCalledOnce();
  });
  it('gives `both` to either side and drops what nobody registered for', () => {
    const router = new Router();
    const boom = vi.fn();
    router.both('boom', boom);
    const event: WorldEvent = { t: 'boom', at: [0, 0, 0], kind: 'rocket', radius: 4 };
    router.dispatch(event, 'a', true, 0); router.dispatch(event, 'b', false, 0);
    expect(boom).toHaveBeenCalledTimes(2);
    // A host-only event is nothing to a guest, and a type no module knows is nothing to anyone.
    router.host('kata', vi.fn());
    expect(() => router.dispatch({ t: 'kata' }, 'a', false, 0)).not.toThrow();
    expect(() => router.dispatch({ t: 'constructor' } as unknown as WorldEvent, 'a', true, 0)).not.toThrow();
  });
  it('refuses a second handler for the same event on the same side', () => {
    const router = new Router();
    router.guest('kill', vi.fn());
    expect(() => router.guest('kill', vi.fn())).toThrow(/Two handlers/);
    expect(() => router.both('kill', vi.fn())).toThrow(/Two handlers/);
    expect(() => router.host('hit', vi.fn())).not.toThrow();
  });
});
