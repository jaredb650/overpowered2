import { afterEach, expect, it, vi } from 'vitest';
import type { Lobby } from './lobby';
import { deployMatch } from './session';

afterEach(() => vi.unstubAllGlobals());

it.each(['smg', 'gimlet', 'harrow'])('hands the local %s choice to the next page without copying the host’s gun', gun => {
  const setItem = vi.fn();
  const at = { search: '?starter=smg&map=range&join=CODE&deploy=1&autostart=1', pathname: '/' };
  vi.stubGlobal('sessionStorage', { setItem });
  vi.stubGlobal('location', at);
  const lobby = { me: { name: 'GUEST', starter: gun }, hosting: false } as unknown as Lobby;
  deployMatch('ABC234', 'private', lobby, { id: 'test', mode: 'outpost' });
  const params = new URLSearchParams(at.search);
  expect(params.get('starter')).toBe(gun);
  expect(params.get('contract')).toBe('outpost');
  expect(params.has('map')).toBe(false);
  expect(params.has('autostart')).toBe(false);
  expect(at.search).not.toContain('private');
  expect(JSON.parse(setItem.mock.calls[0]![1])).toMatchObject({ starter: gun, hosting: false });
});
