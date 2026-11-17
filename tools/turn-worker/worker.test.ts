import { describe, expect, it, vi } from 'vitest';
// Worker is plain JS so it can be pasted into Cloudflare's dashboard without a build step.
// @ts-expect-error standalone Worker JavaScript
import worker, { handleRequest, validateEvent } from './worker.js';
const event = { session: 'test-session', at: Date.now(), build: 'abc1234', mode: 'crucible', role: 'solo', lobby: '', browser: 'Chromium', os: 'macOS', memory: 'unknown', code: 'BOOT_OK', message: 'Game loaded.', stack: '', detail: '' };
function env() {
  const statements: { sql: string; values: unknown[] }[] = [];
  const db = { prepare(sql: string) { return { bind(...values: unknown[]) { const stmt = { sql, values, all: async () => ({ results: [] }), run: vi.fn() }; statements.push(stmt); return stmt; } }; }, batch: vi.fn(async () => []) };
  return { LOG_DB: db, LOG_READ_KEY: 'test-only-read-secret', statements };
}
const request = (body: unknown, headers: Record<string, string> = {}) => new Request('https://worker.test/log', { method: 'POST', headers: { Origin: 'https://jaredb650.github.io', 'CF-Connecting-IP': Math.random().toString(), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
describe('log worker', () => {
  it('validates fields and rejects unexpected or oversized fields', () => {
    expect(validateEvent(event)).toBe(true);
    for (const bad of [{ ...event, ip: 'private' }, { ...event, detail: 'x'.repeat(301) }, { ...event, at: NaN }, { ...event, role: 'admin' }, { ...event, lobby: 'ABC234' }, { ...event, browser: 'full user agent' }, { ...event, message: '\u001b[2J' }]) expect(validateEvent(bad)).toBe(false);
  });
  it('caps real streamed bytes even when Content-Length is absent or false', async () => {
    for (const headers of [{}, { 'Content-Length': '1' }, { 'Content-Length': '9000' }] as Record<string, string>[]) {
      expect((await handleRequest(request('x'.repeat(8193), headers), env())).status).toBe(413);
    }
    expect((await handleRequest(request('{'), env())).status).toBe(400);
    expect((await handleRequest(request({ events: Array(6).fill(event) }), env())).status).toBe(400);
    expect((await handleRequest(request({ events: [{ ...event, password: 'x' }] }), env())).status).toBe(400);
  });
  it('stores only the validated event and applies retention without TURN credentials', async () => {
    const e = env(); const response = await handleRequest(request({ events: [event] }), e);
    expect(response.status).toBe(202); expect(e.LOG_DB.batch).toHaveBeenCalledOnce();
    expect(e.statements[0]!.sql).toContain('DELETE');
    expect(e.statements[1]!.values[1]).toBe(JSON.stringify(event));
    expect(JSON.stringify(e.statements)).not.toContain('CF-Connecting-IP');
    await worker.scheduled({}, e); expect(e.statements.at(-1)!.sql).toContain('DELETE');
  });
  it('requires a read secret, bounds reads, filters expired records, and restricts origins', async () => {
    const e = env();
    expect((await handleRequest(new Request('https://worker.test/logs'), e)).status).toBe(401);
    const auth = { Authorization: `Bearer ${e.LOG_READ_KEY}` };
    expect((await handleRequest(new Request('https://worker.test/logs?limit=1001', { headers: auth }), e)).status).toBe(400);
    expect((await handleRequest(new Request('https://worker.test/logs?since=bad', { headers: auth }), e)).status).toBe(400);
    expect((await handleRequest(new Request('https://worker.test/logs?limit=2', { headers: auth }), e)).status).toBe(200);
    expect(e.statements.at(-1)!.sql).toContain('received_at >= ? AND received_at >= ?');
    expect((await handleRequest(request({ events: [event] }, { Origin: 'https://evil.test' }), e)).status).toBe(403);
    expect((await handleRequest(request({ events: [event] }, { Origin: 'http://localhost:5193' }), e)).status).toBe(202);
  });
  it('limits repeated writes per IP digest', async () => {
    const e = env(); let response;
    for (let i = 0; i < 31; i++) response = await handleRequest(request({ events: [event] }, { 'CF-Connecting-IP': 'rate-limit-test' }), e);
    expect(response.status).toBe(429); expect(e.LOG_DB.batch).toHaveBeenCalledTimes(30);
  });
});
