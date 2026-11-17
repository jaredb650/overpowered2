import { describe, expect, it } from 'vitest';
import { classifyError, coopErrorCode, ERRORS } from './errors';
import { AssetError } from './fetchAsset';

describe('error catalog', () => {
  it('maps fetch, missing asset, device and programming failures', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('ASSET_FETCH_FAILED');
    expect(classifyError(new AssetError('a', 'HTTP 503', true))).toBe('ASSET_FETCH_FAILED');
    expect(classifyError(new AssetError('a', 'HTTP 404', false))).toBe('ASSET_404');
    expect(classifyError(new Error('Error creating WebGL context'))).toBe('WEBGL_UNAVAILABLE');
    expect(classifyError(new Error('out of memory'))).toBe('OUT_OF_MEMORY');
    expect(classifyError(new Error('shader compile failed'))).toBe('SHADER_COMPILE');
    expect(classifyError(new Error('oops'))).toBe('UNCAUGHT_EXCEPTION');
  });
  it('separates ICE, relay, lobby and user failures', () => {
    expect(coopErrorCode('connect')).toBe('COOP_ICE_FAILED_NO_TURN');
    expect(coopErrorCode('connect', true)).toBe('COOP_SAME_LAN_BLOCKED');
    expect(coopErrorCode('connect', false, true)).toBe('COOP_CONNECT_FAILED');
    expect(coopErrorCode('relays')).toBe('COOP_RELAYS_UNREACHABLE');
    expect(coopErrorCode('no-host')).toBe('COOP_LOBBY_NOT_FOUND');
    expect(coopErrorCode('password')).toBe('COOP_WRONG_PASSWORD');
    expect(coopErrorCode('kicked')).toBe('COOP_KICKED');
    for (const [message, fault] of Object.values(ERRORS)) { expect(message.length).toBeGreaterThan(8); expect(fault).toBeTruthy(); }
  });
});
