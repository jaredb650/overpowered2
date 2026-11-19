// The co-op test kit: shared steps for every multi-page co-op proof (tools/scripts/coop-*.mjs). Run a proof through shot.mjs:
//
//   OP2_NO_HMR=1 npx vite --port <your port> --strictPort            (once, your own port, never 5173)
//   node tools/shot.mjs --port <your port> --w 1280 --h 720 --wait 500 --timeout 300 \
//     --script tools/scripts/coop-smoke.mjs --out tools/out/coop/<you>/smoke.png
//
// A proof is `export default async (host, { sleep, outDir }) => {...}`; `host` is the page shot.mjs opened.
//
// STARTING A MATCH
//   const party = await startParty(host, { transport, players, mode, map, net, fps, out, progress, sleep });
//     transport  'loop' (default): every page is a window of one browser profile and they talk through the game's loopback
//                transport (src/net/loopback.ts). No WebRTC, no Nostr relays, a lobby in about a second, and runs never
//                meet each other (shot.mjs's slot queue decides how many run at once). 'rtc': each page its own profile over real trystero/WebRTC and the public relays;
//                slower to connect, and the only way to prove the real transport. COOP_NET=rtc|loop overrides.
//     players    2 to 4 (the host and 1 to 3 guests).
//     mode       'crucible' | 'outpost' (Endless Humans) | 'defense' | 'campaign' (mission 1) | 'foreclosure' (mission 2),
//                with map: 'office' for the first two on the Office. A lobby button's label also works ('Crucible mode').
//     net        the game's network simulator on every page from the start: { lag, jitter, loss, stall, kbps } or the text
//                'lag:80,jitter:30,loss:0.03' (src/net/netsim.ts). setNet(page, ...) changes one page while it runs.
//     fps        frame-rate cap per page; 0 or absent is no cap (60 on the dev box). Proofs about a slow host pass 15.
//     startNow   false stops in the lobby with everyone ready.
//   Returns { host, guests, pages, guest (the first), invite, password, mode: { label, contract, map }, transport }.
//   startPair(host, opts) is startParty with two players.
//   openGuest(party, { name, late }) adds one more page (a fourth player, or with late: true a join or rejoin into a
//   running match, then inMatch([guest], ...)). A guest leaves by page.close().
//
// GETTING TO A FIGHT
//   await inMatch(party.pages, party.mode.contract)    every page in the match, world up, the other bodies drawn
//   await live(party, { enemies: 6 })                  a running wave on every screen, fast: skips the first break in the
//                                                      survival modes, presses Deploy in Outpost Defense, and in the two
//                                                      missions puts `enemies` husks in front of the host instead of
//                                                      waiting out the briefing. Players are made invulnerable.
//   await calm(host)                                   clears the host's wave, for one-enemy-at-a-time steps
//   await dummy(host, at, kind)                        a still enemy at a point, returns its uid
//   await spawn(host, kind, n, { ahead, hold })        n enemies in front of the host's spawn, returns their uids
//   await ahead(host, metres)                          a point that far in front of the first player spawn
//   await give(page, 'smg')                            a weapon in hand, magazines full
//   await aimAt(page, uid), await fireAt(page, uid, ms)   one target
//   await shootLoop(page) / await stopShooting(page)   keeps aiming at the nearest enemy and holding fire, ammo topped up
//
// READING
//   await state(page)        game state, wave, health, credits, kills, enemies, team cards, world.stats
//   await netStats(page)     window.__op2.net.snapshot(): per-lane bytes and packets, gaps, loss, round trips, fps, sim
//   await resetNet(pages)    starts a measuring window on each page
//   await measure(party, seconds)   reset, wait, and return { host, guests: [...] } snapshots with frame rates and enemy counts
//   await rtcChannels(page)  rtc only: the browser's own per-data-channel counts (`data` reliable, `op2-fast` unreliable)
//   await traffic(page)      the older meter: world.stats and, on rtc, the browser's own data-channel byte counts
//   kit(outDir, prefix, out, sleep) gives { check, progress, shot } writing into `out` ({ errors, checks, screenshots }).

export const button = (page, name) => page.getByRole('button', { name, exact: true });

export function kit(outDir, prefix, out, sleep) {
  const check = (condition, message, detail) => {
    if (!condition) throw new Error(`${message}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
    out.checks.push(message);
  };
  const progress = message => console.error(`[${prefix}] ${message}`);
  const shot = async (page, name, keepMenu = false) => {
    const path = `${outDir}/${prefix}-${name}.png`;
    if (!keepMenu) await page.evaluate(() => { if (window.__op2?.game?.state === 'paused') window.__op2.game.setState('playing'); });
    await sleep(200);
    await page.screenshot({ path, timeout: 120000 });
    out.screenshots.push(path);
  };
  return { check, progress, shot };
}

/** Frames a second a test page is capped at unless the proof says otherwise (COOP_FPS overrides; 0 is no cap). */
export const DEFAULT_FPS = 0;
export const DEFAULT_TRANSPORT = 'loop';

/** What the host can start, by id. `label` is its lobby button, `contract` what the match page's address carries. */
export const MODES = {
  crucible: { label: 'Crucible mode', contract: 'crucible' },
  outpost: { label: 'Endless Humans mode', contract: 'outpost' },
  defense: { label: 'Outpost Defense mode', contract: 'defense' },
  'crucible@office': { label: 'Office — Crucible mode', contract: 'crucible', map: 'office' },
  'outpost@office': { label: 'Office — Endless Humans mode', contract: 'outpost', map: 'office' },
  campaign: { label: 'Mission 1: The Outpost', contract: 'campaign' },
  foreclosure: { label: 'Mission 2: Foreclosure', contract: 'foreclosure' },
};
const SURVIVAL = ['crucible', 'outpost', 'defense'];

/** `mode` as an id (with `map`) or as a lobby button's label. */
export function modeOf(mode = 'crucible', map) {
  const found = MODES[map ? `${mode}@${map}` : mode] ?? Object.values(MODES).find(m => m.label === mode);
  if (!found) throw new Error(`Unknown co-op mode "${mode}"${map ? ` on map "${map}"` : ''}. Known: ${Object.keys(MODES).join(', ')}`);
  return found;
}

/**
 * Runs in each test page: an optional frame-rate cap, the hidden-tab switch, and a meter on its WebRTC data channels.
 * `fps` caps the page's animation frames (0 or absent: no cap). The old kit always capped at 15 for an 8 GB Mac; pass
 * `fps: 15` to a proof that depends on a slow host. Bad networks are the game's own simulator now (setNet).
 */
export function harness(fps = 0) {
  if (window.__coopHarness) return;
  window.__coopHarness = true;
  const requestFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    // Half a display frame of slack, so a 30 cap lands on every second 60 Hz frame instead of every third.
    const deadline = fps > 0 ? performance.now() + 1000 / fps - 8 : 0;
    const tick = now => (window.__coopHidden ? setTimeout(() => requestFrame(tick), 200) : now >= deadline ? callback(now) : requestFrame(tick));
    return requestFrame(tick);
  };
  // A "hidden tab": no frames at all, and document.hidden says so (the game's worker tick takes over).
  window.__coopHide = on => {
    window.__coopHidden = on;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => on });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (on ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  window.__coopPeers = [];
  window.__coopWire = { sent: 0, received: 0 };
  const size = value => typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.byteLength ?? value.size ?? 0;
  const meter = channel => {
    if (channel.__coopMetered) return channel;
    channel.__coopMetered = true;
    const send = channel.send.bind(channel);
    channel.send = value => { window.__coopWire.sent += size(value); return send(value); };
    channel.addEventListener('message', event => { window.__coopWire.received += size(event.data); });
    return channel;
  };
  const Peer = window.RTCPeerConnection;
  if (!Peer) return;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) { super(...args); window.__coopPeers.push(this); this.addEventListener('datachannel', event => meter(event.channel)); }
    createDataChannel(...args) { return meter(super.createDataChannel(...args)); }
  };
}

export const quiet = () => localStorage.setItem('op2.settings.v1', JSON.stringify({ quality: 0, music: 0 }));

/**
 * A fresh browser profile's first Play goes to Retraining (src/contracts/firstLaunch.ts), never to the menu the kit drives.
 * A test page is a returning player: this writes the key the game itself writes on any first run.
 */
export const returning = () => localStorage.setItem('op2.played.v1', '1');

const simText = net => !net ? '' : typeof net === 'string' ? net : Object.entries(net).map(([k, v]) => `${k}:${v}`).join(',');

/** The init scripts every test page gets, before its first load. */
async function prepare(page, { fps, out, tag }) {
  page.on('pageerror', error => out?.errors.push(`${tag}: ${error.message}`));
  // For the evidence file: each page's warnings, errors and co-op lines, and every address it loads (a page that reloads
  // out of a match shows here).
  if (out) {
    const log = (out.console ??= []);
    page.on('console', message => {
      const text = message.text();
      if (log.length < 400 && (message.type() === 'error' || message.type() === 'warning' || /\[coop\]|\[netsim\]/.test(text)) && !/THREE\.|wss:\/\//.test(text)) log.push(`${tag}: ${text.slice(0, 300)}`);
    });
    page.on('framenavigated', frame => { if (frame === page.mainFrame() && log.length < 400) log.push(`${tag}: -> ${frame.url()}`); });
  }
  await page.addInitScript(harness, fps);
  await page.addInitScript(quiet);
  await page.addInitScript(returning);
}

/** The address a test page loads: the game, on the asked transport, with the simulator set. */
function address(base, { transport, net, query = '' }) {
  const params = new URLSearchParams(query);
  if (transport === 'loop') params.set('net', 'loop');
  if (simText(net)) params.set('netsim', simText(net));
  const text = params.toString();
  return `${base}/${text ? `?${text}` : ''}`;
}

const callsign = i => ['HOST-ONE', 'GUEST-TWO', 'GUEST-THREE', 'GUEST-FOUR'][i] ?? `GUEST-${i + 1}`;

/**
 * The host and its guests in one lobby on `mode`, everyone ready, started with the countdown (see the header for options).
 * The host page is reloaded on the asked transport first, so it starts from the splash with the kit's init scripts in.
 */
export async function startParty(host, options) {
  const { mode = 'crucible', map, password = 'coop-kit', out = { errors: [], checks: [], screenshots: [] }, progress = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)),
    startNow = true, players = 2, net, fps = Number(process.env.COOP_FPS ?? DEFAULT_FPS), transport = process.env.COOP_NET ?? DEFAULT_TRANSPORT } = options ?? {};
  if (transport !== 'loop' && transport !== 'rtc') throw new Error(`Unknown transport "${transport}": 'loop' or 'rtc'`);
  if (!(players >= 2 && players <= 4)) throw new Error(`players must be 2 to 4, not ${players}`);
  const picked = modeOf(mode, map);
  const base = new URL(host.url()).origin;
  const party = { host, guests: [], pages: [host], guest: null, invite: '', password, mode: picked, transport, net, fps, out, progress, sleep, base };

  await prepare(host, { fps, out, tag: 'host' });
  await host.goto(address(base, { transport, net }), { waitUntil: 'load', timeout: 120000 });
  await host.waitForFunction(() => !!window.__op2?.ctx.render, null, { timeout: 120000 });
  await host.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 });
  await host.locator('.scr-splash').click();
  await button(host, 'Play').click(); await button(host, 'Multiplayer').click(); await button(host, 'Host a lobby').click();
  await host.locator('input[type=password]').fill(password); await button(host, 'Open lobby').click();
  await host.locator('.co-code').waitFor({ state: 'visible' });
  const link = await host.locator('.co-link').textContent();
  await host.locator('.co-field input').first().fill(callsign(0)); await host.locator('.co-field input').first().press('Enter');
  const invite = new URL(link.replace(/^https?:\/\/[^/]+/, base));
  if (simText(net)) invite.searchParams.set('netsim', simText(net));
  party.invite = invite.toString();
  progress(`host lobby open on ${transport}; ${players - 1} guest${players > 2 ? 's' : ''} joining by link`);

  // Guests join one after another: the lobby list is how the kit knows each is in.
  for (let i = 1; i < players; i++) await openGuest(party, { name: callsign(i) });
  if (!startNow) return party;
  await sleep(transport === 'loop' ? 150 : 600);
  await button(host, picked.label).click(); await button(host, 'Start').click();
  progress(`countdown to ${picked.label}`);
  return party;
}

/** Host and one guest: `startParty` with two players. Returns the party, so `{ guest, invite }` read as before. */
export const startPair = (host, options) => startParty(host, { ...options, players: 2 });

/**
 * One more page into the party's lobby by the invite link, named and ready: a guest at the start, a late joiner or a rejoin
 * later. On loopback it is another window of the host's profile; on rtc it has a profile of its own.
 */
export async function openGuest(party, { name = callsign(party.guests.length + 1), ready = true, late = false } = {}) {
  const { host, transport, fps, out, password } = party;
  const guest = transport === 'loop' ? await ownWindow(host)
    : await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: await host.evaluate(() => window.devicePixelRatio) });
  await prepare(guest, { fps, out, tag: name.toLowerCase() });
  // The same player's browser keeps their callsign; a test page has none stored yet.
  await guest.addInitScript(name => { if (!sessionStorage.getItem('coopKitNamed')) { localStorage.setItem('op2_coop_name', name); sessionStorage.setItem('coopKitNamed', '1'); } }, name);
  await guest.goto(party.invite);
  // `late`: a match is running, so the host sends the newcomer straight into it and the lobby list may never be seen.
  await joinFromSplash(guest, password, !late);
  if (!late) {
    await guest.locator('.co-field input').first().fill(name); await guest.locator('.co-field input').first().press('Enter');
    if (ready) await readyUp(guest);
  }
  party.guests.push(guest);
  party.pages.push(guest);
  party.guest ??= guest;
  return guest;
}

/**
 * A new page in the same browser profile as `page`, in a window of its own. A second tab of one window (context.newPage())
 * is drawn only while it is the front tab: a game page behind another gets about 2 frames a second and never finishes
 * loading. A window opened by the page itself keeps its own 60.
 */
export async function ownWindow(page) {
  const { width, height } = page.viewportSize();
  const [opened] = await Promise.all([
    page.context().waitForEvent('page'),
    page.evaluate(([w, h]) => { window.open('about:blank', '_blank', `noopener,popup,width=${w},height=${h}`); }, [width, height]),
  ]);
  return opened;
}

/** The host's Start waits for every guest to be ready. */
export const readyUp = page => page.locator('.co-readybtn:not(.on)').click();

/** An invite link opens straight on its password page, with no splash. `listed` waits for the lobby's player list. */
export async function joinFromSplash(page, password, listed = true) {
  await page.locator('input[type=password]').waitFor({ state: 'visible', timeout: 300000 });
  await page.locator('input[type=password]').fill(password); await button(page, 'Join lobby').click();
  if (listed) await page.locator('.co-player').nth(1).waitFor({ state: 'visible', timeout: 90000 });
}

/** Every page in the match with the world and the other players' bodies up. */
export async function inMatch(pages, contract, play = true) {
  for (const page of pages) {
    await page.waitForURL(new RegExp(`contract=${contract}`), { timeout: 90000 });
    await page.waitForFunction(() => window.__op2?.ctx.coop?.world && window.__op2.ctx.coop.remotes.size >= 1
      && [...window.__op2.ctx.coop.remotes.values()].some(r => r.char.root.visible), null, { timeout: 150000 });
    if (play) await page.evaluate(() => { window.__op2.game.setState('playing'); });
  }
}

/**
 * A fight on every screen, fast. Survival modes: the first break is skipped and the wave's enemies awaited. Outpost Defense:
 * each page deploys from its loadout first. The missions: `enemies` husks are put in front of the host rather than waiting
 * out the briefing, cutscene and ride (pass `natural: true` to wait for the mission's own instead). Everyone is invulnerable
 * unless `mortal`. Returns each page's state.
 */
export async function live(party, { enemies = 6, natural = false, mortal = false, timeout = 120000 } = {}) {
  const { pages, host, guests, mode, sleep } = party;
  const mission = !SURVIVAL.includes(mode.contract);
  await inMatch(pages, mode.contract, mode.contract !== 'defense' && !mission);
  if (mode.contract === 'defense') {
    // Each player deploys from their own loadout screen; the world does not wait under it.
    for (const page of pages) {
      await page.locator('.scr-loadout').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
      if (await page.locator('.scr-loadout').isVisible().catch(() => false)) await button(page, 'Deploy').click();
    }
  }
  for (const page of pages) await page.evaluate(([mortal, mission]) => {
    const { ctx, game } = window.__op2;
    if (!mortal) ctx.player.modifiers.invulnerable = true;
    if (!mission) game.setState('playing');
  }, [mortal, mission]);
  if (mission && !natural) await spawn(host, 'husk', enemies, { ahead: 8 });
  else if (!mission) await skipBreak(host);
  for (const guest of guests) await guest.waitForFunction(n => window.__op2.ctx.enemies.alive.length >= n, Math.max(1, Math.min(enemies, 6)), { timeout });
  await sleep(300);
  return Promise.all(pages.map(state));
}

/** Host: ends the break before a wave now (every survival mode's director counts `ctx.waves.nextWaveIn` down). */
export const skipBreak = host => host.evaluate(() => {
  const waves = window.__op2.ctx.waves;
  if (waves.phase === 'intermission' && waves.nextWaveIn > 0.2) waves.nextWaveIn = 0.2;
});

export const state = page => page.evaluate(() => {
  const { ctx, game } = window.__op2;
  const wallet = ctx.contracts?.wallet;
  return { state: game.state, host: ctx.coop?.hosting, wave: ctx.waves.wave, phase: ctx.waves.phase, health: ctx.player.health, alive: ctx.player.alive,
    downed: ctx.player.downed, credits: wallet?.credits ?? null, kills: ctx.progression.kills, score: ctx.progression.score,
    enemies: ctx.enemies.alive.length, time: ctx.time.elapsed, stats: ctx.coop?.world ? { ...ctx.coop.world.stats } : null,
    team: ctx.coop?.world ? [...ctx.coop.world.team.cards.values()] : null };
});

/** The game's own network counters and simulator for this page (src/net/debug.ts), with its frame rate. */
export const netStats = page => page.evaluate(() => ({ ...window.__op2.net.snapshot(), fps: window.__op2.stats().fps }));

export const resetNet = async pages => { for (const page of [pages].flat()) await page.evaluate(() => window.__op2.net.metrics.reset()); };

/** Sets the game's network simulator on one page, as text or an object; 'off' clears it. Returns the settings in force. */
export const setNet = (page, net) => page.evaluate(net => window.__op2.net.sim.set(net), typeof net === 'string' ? net : { ...net });

/**
 * A measuring window over the whole party: reset the counters, wait `seconds`, read. Frame rate and enemy count are sampled
 * every second on every page; `everySecond(i)` runs then too (keep a wave going, fire a call-in).
 */
export async function measure(party, seconds, { sleep = party.sleep, everySecond } = {}) {
  const { pages, host, guests } = party;
  await resetNet(pages);
  const fps = pages.map(() => []), enemies = pages.map(() => []);
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    await Promise.all(pages.map(async (page, p) => {
      const now = await page.evaluate(() => [window.__op2.stats().fps, window.__op2.ctx.enemies.alive.length]);
      fps[p].push(now[0]); enemies[p].push(now[1]);
    }));
    await everySecond?.(i);
  }
  const spread = values => ({ mean: Math.round(10 * values.reduce((a, b) => a + b, 0) / values.length) / 10, min: Math.min(...values), max: Math.max(...values) });
  const read = async (page, p) => ({ ...await netStats(page), fps: { ...spread(fps[p]), each: fps[p] }, enemies: spread(enemies[p]) });
  return { seconds, host: await read(host, 0), guests: await Promise.all(guests.map((page, i) => read(page, i + 1))) };
}

/**
 * rtc only: what the browser itself says each WebRTC data channel of this page carried, by label. `data` is trystero's
 * reliable channel, `op2-fast` the game's unreliable one (src/net/fast.ts). Empty on loopback.
 */
export const rtcChannels = page => page.evaluate(async () => {
  const out = {};
  for (const peer of window.__coopPeers ?? []) {
    if (peer.connectionState !== 'connected') continue;
    (await peer.getStats()).forEach(stat => {
      if (stat.type !== 'data-channel') return;
      const sum = (out[stat.label] ??= { channels: 0, state: stat.state, messagesSent: 0, messagesReceived: 0, bytesSent: 0, bytesReceived: 0 });
      sum.channels++;
      for (const key of ['messagesSent', 'messagesReceived', 'bytesSent', 'bytesReceived']) sum[key] += stat[key] ?? 0;
    });
  }
  return out;
});

/** The older meter: the host world's own counters and, on rtc, what the browser says its data channels carried. */
export async function traffic(page) {
  return page.evaluate(async () => {
    const world = window.__op2.ctx.coop.world;
    let sent = 0, received = 0;
    for (const peer of window.__coopPeers ?? []) {
      const stats = await peer.getStats().catch(() => []);
      stats.forEach(stat => { if (stat.type === 'data-channel') { sent += stat.bytesSent ?? 0; received += stat.bytesReceived ?? 0; } });
    }
    const net = window.__op2.net?.snapshot();
    const lanes = Object.values(net?.lanes ?? {});
    // The pages' own count of what they handed to the transport, when there is no WebRTC to ask (loopback).
    const sum = pick => lanes.reduce((total, lane) => total + pick(lane), 0);
    return { time: performance.now(), world: { ...world.stats }, sent: window.__coopWire?.sent || sum(l => l.out.bytes), received: window.__coopWire?.received || sum(l => l.in.bytes),
      rtcSent: sent, rtcReceived: received, enemies: window.__op2.ctx.enemies.alive.length };
  });
}

/** A point `metres` in front of the first player spawn (behind it when negative), and the spawn's yaw. */
export const ahead = (page, metres) => page.evaluate(d => {
  const s = window.__op2.ctx.world.playerSpawns[0];
  return { at: [s.position.x - Math.sin(s.yaw) * d, s.position.y, s.position.z - Math.cos(s.yaw) * d], yaw: s.yaw, spawn: s.position.toArray() };
}, metres);

/** A husk that stands still at `at` (host), for controlled kills and damage. */
export const dummy = (host, at, kind = 'husk') => host.evaluate(([at, kind]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const p = new V(...at); const snapped = p.clone();
  if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
  const enemy = ctx.enemies.spawn(kind, p);
  enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true;
  return enemy.uid;
}, [at, kind]);

/**
 * Host: `count` enemies of `kind` in a row `ahead` metres in front of the first player spawn, snapped to the nav mesh.
 * `hold` makes them stand still and harmless (as `dummy`); otherwise they are the real thing. Returns their uids.
 */
export const spawn = (host, kind = 'husk', count = 1, { ahead: metres = 8, hold = false, spacing = 1.6 } = {}) => host.evaluate(([kind, count, metres, hold, spacing]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const s = ctx.world.playerSpawns[0];
  const forward = new V(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)), side = new V(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
  const uids = [];
  for (let i = 0; i < count; i++) {
    const p = s.position.clone().addScaledVector(forward, metres + Math.floor(i / 8) * spacing).addScaledVector(side, ((i % 8) - 3.5) * spacing);
    const snapped = p.clone();
    if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
    const enemy = ctx.enemies.spawn(kind, p);
    if (!enemy) continue;
    if (hold) { enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true; }
    uids.push(enemy.uid);
  }
  return uids;
}, [kind, count, metres, hold, spacing]);

/** Clears the host's wave so the next steps meet one enemy at a time. */
export const calm = host => host.evaluate(() => {
  const { ctx } = window.__op2;
  const wave = ctx.waves.wave;
  ctx.waves.reset(); ctx.waves.wave = wave;
  for (const enemy of [...ctx.enemies.alive]) ctx.enemies.withdraw(enemy);
});

/** A weapon in the player's hands with full magazines. */
export const give = (page, weapon) => page.evaluate(weapon => {
  const { weapons } = window.__op2.ctx;
  weapons.give(weapon); weapons.switchTo(weapon); weapons.refillMagazines();
}, weapon);

/** Puts a player at a point, facing `yaw`. */
export const teleport = (page, at, yaw = 0) => page.evaluate(([at, yaw]) => {
  const { ctx } = window.__op2; const V = ctx.player.position.constructor;
  ctx.player.teleport(new V(...at), yaw);
}, [at, yaw]);

export const aimAt = (page, uid) => page.evaluate(uid => {
  const { ctx } = window.__op2; const enemy = ctx.enemies.alive.find(e => e.uid === uid);
  if (!enemy) return false;
  const delta = enemy.center.clone().sub(ctx.player.eye);
  ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  window.__op2.game.setState('playing');
  return true;
}, uid);

/** Aims at one enemy and holds fire for `ms` (re-aiming as it moves), then lets go. True if the target was there. */
export async function fireAt(page, uid, ms = 1000, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  if (!await aimAt(page, uid)) return false;
  await page.evaluate(() => { const { ctx } = window.__op2; ctx.weapons.refillMagazines(); ctx.input.simulate('fire', true); });
  for (let waited = 0; waited < ms; waited += 100) { await sleep(Math.min(100, ms - waited)); await aimAt(page, uid); }
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  return true;
}

/**
 * A scripted shooter: until `stopShooting`, the player keeps turning to the nearest living enemy (within `range` metres)
 * and holding fire, magazines topped up. Works on the host and on a guest (whose enemies are the host's replicas).
 */
export const shootLoop = (page, { range = 60, weapon } = {}) => page.evaluate(([range, weapon]) => {
  const { ctx, game } = window.__op2;
  if (weapon) { ctx.weapons.give(weapon); ctx.weapons.switchTo(weapon); }
  clearInterval(window.__coopShooter);
  const aim = () => {
    if (game.state !== 'playing') game.setState('playing');
    let best = null, bestD = range * range;
    for (const enemy of ctx.enemies.alive) {
      const d = enemy.center.distanceToSquared(ctx.player.eye);
      if (d < bestD) { best = enemy; bestD = d; }
    }
    ctx.input.simulate('fire', !!best);
    if (!best) return;
    const delta = best.center.clone().sub(ctx.player.eye);
    ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
    ctx.weapons.refillMagazines();
  };
  window.__coopShooter = setInterval(aim, 50);
  aim();
}, [range, weapon]);

export const stopShooting = page => page.evaluate(() => {
  clearInterval(window.__coopShooter);
  window.__coopShooter = null;
  window.__op2.ctx.input.simulate('fire', false);
});
