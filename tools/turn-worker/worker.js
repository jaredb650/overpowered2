// OVERPOWERED 2 co-op: a Cloudflare Worker that hands out short-lived TURN credentials (Cloudflare Realtime TURN).
// The game calls it once before joining a lobby (src/net/turn.ts). Setup, click by click: docs/notes/coop.md, "TURN setup".
//
// Secrets, set in the Worker's Settings > Variables and Secrets (never in this file, never in the game):
//   TURN_KEY_ID          the TURN key's ID
//   TURN_KEY_API_TOKEN   the TURN key's API token
// Optional plain variable:
//   ALLOWED_ORIGINS      comma-separated pages allowed to ask, e.g. https://you.github.io (empty: any page)
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const ok = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin || '*' : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!ok) return new Response('Forbidden', { status: 403, headers: cors });
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'TURN_KEY_ID or TURN_KEY_API_TOKEN is not set' }, 500, cors);
    const answer = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      // A day: longer than any session. The game asks again after an hour anyway.
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (!answer.ok) return json({ error: `Cloudflare TURN answered ${answer.status}` }, 502, cors);
    return new Response(await answer.text(), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
