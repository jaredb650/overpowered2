// One Worker for TURN credentials and anonymous diagnostics. See docs/notes/coop.md.
// Secrets: TURN_KEY_ID, TURN_KEY_API_TOKEN, LOG_READ_KEY. D1 binding: LOG_DB.
// ALLOWED_ORIGINS defaults to the GitHub Pages origin; localhost is also allowed.
const MAX_BYTES = 8192;
const RETENTION_MS = 30 * 86400000;
const counters = new Map(); // short-lived SHA-256 IP digests only, never persisted
const fields = { session: 64, build: 40, mode: 32, role: 5, lobby: 64, browser: 16, os: 16, memory: 8, code: 64, message: 240, stack: 800, detail: 300 };
export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  if (Object.keys(event).some(k => k !== 'at' && !Object.hasOwn(fields, k))) return false;
  if (!Number.isSafeInteger(event.at) || event.at < 0) return false;
  if (!Object.entries(fields).every(([key, max]) => typeof event[key] === 'string' && event[key].length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(event[key]))) return false;
  return /^[a-zA-Z0-9-]{8,64}$/.test(event.session) && /^[A-Z][A-Z0-9_]{1,63}$/.test(event.code)
    && ['solo', 'host', 'guest'].includes(event.role) && /^(?:[a-f0-9]{64})?$/.test(event.lobby)
    && ['Firefox', 'Edge', 'Chromium', 'Safari', 'Other'].includes(event.browser)
    && ['Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Other'].includes(event.os)
    && ['low', 'medium', 'high', 'unknown'].includes(event.memory);
}
async function limitedBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw new RangeError('size');
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new RangeError('size'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(all);
}
function timingSafeEqualStr(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
async function rateLimited(request, bucket = 'log', maxPerMin = 30) {
  const now = Date.now();
  for (const [key, value] of counters) if (now >= value.until) counters.delete(key);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${bucket}:${Math.floor(now / 60000)}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`));
  const key = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  // Bound isolate memory via FIFO eviction rather than locking out all legitimate players globally.
  while (counters.size >= 4096 && !counters.has(key)) counters.delete(counters.keys().next().value);
  const value = counters.get(key) || { n: 0, until: now + 60000 };
  value.n++; counters.set(key, value); return value.n > maxPerMin;
}
export async function handleRequest(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || 'https://jaredb650.github.io').split(',').map(s => s.trim());
  const ok = !origin || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const cors = { 'Access-Control-Allow-Origin': ok ? origin || '*' : 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin', 'Cache-Control': 'no-store' };
  const respond = (body, status = 200) => json(body, status, cors);
  if (!ok) return respond({ error: 'Forbidden' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  try {
    if (url.pathname === '/logs') {
      if (request.method !== 'GET') return respond({ error: 'Method' }, 405);
      const auth = request.headers.get('Authorization') || '';
      if (!env.LOG_READ_KEY || !timingSafeEqualStr(auth, `Bearer ${env.LOG_READ_KEY}`)) return respond({ error: 'Unauthorized' }, 401);
      if (!env.LOG_DB) return respond({ error: 'LOG_DB is not bound' }, 503);
      const since = url.searchParams.get('since');
      const time = since ? (/^\d+$/.test(since) ? Number(since) : Date.parse(since)) : Date.now() - 86400000;
      const limit = Number(url.searchParams.get('limit') || 200);
      if (!Number.isFinite(time) || !Number.isInteger(limit) || limit < 1 || limit > 1000) return respond({ error: 'Invalid since or limit' }, 400);
      const result = await env.LOG_DB.prepare('SELECT id, received_at, event FROM events WHERE received_at >= ? AND received_at >= ? ORDER BY received_at DESC, id DESC LIMIT ?')
        .bind(time, Date.now() - RETENTION_MS, limit).all();
      return respond({ events: result.results.map(row => ({ id: row.id, receivedAt: row.received_at, ...JSON.parse(row.event) })), limit });
    }
    if (url.pathname === '/log') {
      if (request.method !== 'POST') return respond({ error: 'Method' }, 405);
      if (await rateLimited(request, 'log', 30)) return respond({ error: 'Rate limit' }, 429);
      let body;
      try { body = JSON.parse(await limitedBody(request)); }
      catch (error) { return respond({ error: error instanceof RangeError ? 'Request too large' : 'Invalid JSON' }, error instanceof RangeError ? 413 : 400); }
      if (!body || Object.keys(body).some(k => k !== 'events') || !Array.isArray(body.events) || !body.events.length || body.events.length > 5 || !body.events.every(validateEvent)) return respond({ error: 'Invalid events' }, 400);
      if (!env.LOG_DB) return respond({ error: 'LOG_DB is not bound' }, 503);
      const now = Date.now();
      await env.LOG_DB.batch([
        env.LOG_DB.prepare('DELETE FROM events WHERE received_at < ?').bind(now - RETENTION_MS),
        ...body.events.map(event => env.LOG_DB.prepare('INSERT INTO events (received_at, event) VALUES (?, ?)').bind(now, JSON.stringify(event))),
      ]);
      return respond({ accepted: body.events.length }, 202);
    }
    if (url.pathname !== '/') return respond({ error: 'Not found' }, 404);
    if (!['GET', 'POST'].includes(request.method)) return respond({ error: 'Method' }, 405);
    if (await rateLimited(request, 'turn', 20)) return respond({ error: 'Rate limit' }, 429);
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'TURN_KEY_ID or TURN_KEY_API_TOKEN is not set' }, 500, cors);
    const answer = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      // A day: longer than any session. The game asks again after an hour anyway.
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (!answer.ok) return json({ error: `Cloudflare TURN answered ${answer.status}` }, 502, cors);
    return new Response(await answer.text(), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return respond({ error: 'Service unavailable' }, 503); }
}
export default {
  fetch: handleRequest,
  async scheduled(_controller, env) {
    if (env.LOG_DB) await env.LOG_DB.prepare('DELETE FROM events WHERE received_at < ?').bind(Date.now() - RETENTION_MS).run();
  },
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
