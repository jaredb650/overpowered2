// Shared steps for the session proofs (tools/scripts/coop-session-*.mjs): the life of a co-op session, from a lobby opening
// to everyone back in it. They sit on the co-op kit (coop-kit.mjs) and add what only these proofs need: reading the lobby
// from any page (in a match or on the lobby screen), the deploy gate by a real click, a page whose boot is held back, and a
// link that goes silent for a while.
//
//   COOP_SIM='lag:120,jitter:40,loss:0.05' runs any of them on a bad network (the game's own simulator on every page).
//   COOP_NET=rtc runs them over real WebRTC and the public relays instead of the loopback transport.
import { kit, setNet } from './coop-kit.mjs';

export const SIM = process.env.COOP_SIM || undefined;
/** A bad network makes everything later; proofs scale their patience by this. */
export const SLOW = SIM ? 2 : 1;

/** What a page knows about the session, in a match or on the lobby screen. Plain JSON. */
export const snap = page => page.evaluate(() => {
  const op = window.__op2;
  if (!op?.ctx?.hud) return { booted: false, url: location.search };
  const { ctx, game } = op;
  const coop = ctx.coop ?? null;
  const lobby = coop?.lobby ?? ctx.hud.screens?.screens?.coop?.lobby ?? null;
  const shown = selector => { const el = document.querySelector(selector); return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0; };
  const gate = document.querySelector('.cs-gate');
  const wallet = ctx.contracts?.wallet;
  return {
    booted: true, url: location.search, state: game.state, coop: !!coop, begun: coop?.begun === true, holding: coop ? coop.holding : null,
    hosting: lobby?.hosting ?? null, phase: lobby?.phase ?? null, error: lobby?.error ?? null, live: lobby?.live ?? null, where: lobby?.where ?? null,
    page: lobby?.page ?? null, match: lobby?.match?.id ?? null, mode: lobby?.match?.mode ?? null, awayFrom: lobby?.awayFrom?.id ?? null,
    reconnecting: lobby?.reconnecting ? lobby.reconnectIn : 0, holdLeft: lobby?.holdLeft ?? 0, pick: lobby?.pick ?? null,
    players: (lobby?.players ?? []).map(p => ({ name: p.name, slot: p.slot, seat: p.seat ?? '', state: p.state ?? '', away: !!p.away, host: !!p.host, me: p.id === lobby.you, ready: !!p.ready })),
    chat: (lobby?.chat ?? []).map(c => c.text),
    wave: ctx.waves.wave, wavePhase: ctx.waves.phase, waveRunning: ctx.waves.running === true, enemies: ctx.enemies.alive.length, time: ctx.time.elapsed,
    credits: wallet?.credits ?? null, kills: ctx.progression.kills, weapon: ctx.weapons.current, locked: ctx.input.locked === true,
    remotes: coop ? coop.remotes.size : 0, bodies: coop ? [...coop.remotes.values()].filter(r => r.char.root.visible).length : 0,
    gate: !!gate, gateReady: gate?.dataset.ready === '1', gateText: gate?.textContent ?? '',
    line: shown('.cs-line') ? document.querySelector('.cs-line').textContent : '',
    pause: shown('.scr-pause'), lobbyScreen: shown('.scr-coop'), splash: shown('.scr-splash'), crumb: document.querySelector('.scr-coop .mm-crumb')?.textContent ?? '',
    note: shown('.co-back') ? document.querySelector('.co-back').textContent : '', err: shown('.scr-coop') && !document.querySelector('.scr-coop .co-players')?.isConnected ? document.querySelector('.scr-coop .co-panel')?.textContent ?? '' : '',
    status: document.querySelector('.scr-coop .nt-ref')?.textContent ?? '',
    lost: document.querySelector('.cs-lost .cq-big')?.textContent ?? '', lostFoot: document.querySelector('.cs-lost .cq-foot')?.textContent ?? '',
    code: document.querySelector('.co-code')?.textContent ?? '',
  };
});

/** Waits until `test(snapshot)` holds on the page, and returns that snapshot. Fails with the last one in the message. */
export async function until(page, test, what, timeout = 60000, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  const end = Date.now() + timeout * SLOW;
  let last = null;
  for (;;) {
    try { last = await snap(page); } catch (error) { last = { booted: false, navigating: String(error.message ?? error).slice(0, 80) }; }
    if (last.booted !== false || what.startsWith('!')) { let ok = false; try { ok = test(last); } catch { ok = false; } if (ok) return last; }
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what} :: ${JSON.stringify(last).slice(0, 1500)}`);
    await sleep(150);
  }
}

/** The page is at "Click to deploy" and may click. */
export const atGate = (page, timeout = 180000) => until(page, s => s.gate && s.gateReady, 'the deploy gate, ready', timeout);

/** A real click on the gate: the gesture that takes the mouse and starts this player's run. */
export async function clickDeploy(page) {
  await atGate(page);
  await page.locator('.cs-gate').click({ position: { x: 300, y: 200 } });
  return until(page, s => s.begun && !s.gate, 'the run begun after the deploy click', 20000);
}

/**
 * Holds back this page's next map page: its document does not arrive for `ms`, the way a slow connection or a cold cache
 * keeps a friend on a blank page while the others are already in. Returns the function that lets it through early.
 */
export async function slowBoot(page, ms) {
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  const timer = setTimeout(release, ms);
  const pattern = url => url.searchParams.has('contract') && (url.pathname === '/' || url.pathname.endsWith('/index.html'));
  await page.route(pattern, async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    await gate;
    await route.continue().catch(() => {});
  });
  return async () => { clearTimeout(timer); release(); await page.unroute(pattern).catch(() => {}); };
}

/**
 * The link between these pages goes silent for `ms`, both ways: everything sent meanwhile on the reliable lanes arrives
 * late (after the gap), and nearly all of the unreliable is lost. Then the network is what it was.
 */
export async function blip(pages, ms, sleep) {
  for (const page of pages) await setNet(page, { lag: Math.min(10000, ms), loss: 0.95, stall: 300 });
  await sleep(ms);
  for (const page of pages) await setNet(page, SIM ?? 'off');
}

/**
 * Records every distinct text the session's status line shows on this page from now on, so a line that is up for two
 * seconds is not missed by a script that looks every so often. Read them back with `lineLog(page)`.
 */
export const watchLine = page => page.evaluate(() => {
  window.__lineLog = [];
  clearInterval(window.__lineTimer);
  window.__lineTimer = setInterval(() => {
    const el = document.querySelector('.cs-line');
    const text = el && el.style.display !== 'none' ? el.textContent : '';
    if (text && window.__lineLog.at(-1) !== text) window.__lineLog.push(text);
  }, 50);
});
export const lineLog = page => page.evaluate(() => window.__lineLog ?? []);

/** Stalls the page's main thread for `ms` (a long hitch, a debugger pause). */
export const stall = (page, ms) => page.evaluate(ms => { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } }, ms).catch(() => {});

/** Slot and seat by name, as one page lists them. */
export const seats = s => Object.fromEntries(s.players.map(p => [p.name, `${p.slot}/${p.seat}`]));

export function proof(name, outDir, sleep) {
  const out = { proof: name, sim: SIM ?? 'none', transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [] };
  const tools = kit(outDir, name, out, sleep);
  /** Runs the proof's body; whatever happens, the pages it opened are closed and the result says what was checked. */
  const run = async (body, party = () => null) => {
    try { await body(); out.ok = true; }
    catch (error) { out.ok = false; out.failed = String(error.stack ?? error).slice(0, 3000); }
    finally {
      for (const guest of party()?.guests ?? []) await guest.close().catch(() => {});
    }
    out.errors = out.errors.filter(e => !/net::ERR_ABORTED|Failed to load resource/.test(e));
    if (!out.ok) throw new Error(`${name} FAILED after ${out.checks.length} checks: ${out.failed}`);
    return out;
  };
  return { out, run, ...tools };
}

/** Closing or reloading a tab mid-match asks "leave?" (index.ts). A script says yes. */
export const acceptLeave = pages => { for (const page of [pages].flat()) page.on('dialog', dialog => { dialog.accept().catch(() => {}); }); };

/** Host: "End match (all to lobby)", as the pause menu does it. */
export const endMatch = host => host.evaluate(() => window.__op2.ctx.hud.quitToMenu());

/** Nobody dies while a proof watches the session, not the fight. */
export const immortal = pages => Promise.all([pages].flat().map(page => page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; }).catch(() => {})));

/** The lobby's own lines that name `who`, in order. */
export const linesAbout = (s, who) => s.chat.filter(t => t.includes(who));
