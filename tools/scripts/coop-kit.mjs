// Shared steps for the two-page co-op browser proofs (coop-stage3.mjs, coop-robust.mjs, coop-modes.mjs).
// One browser, two pages, real trystero/WebRTC over the public Nostr relays.

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
    await page.screenshot({ path, timeout: 45000 });
    out.screenshots.push(path);
  };
  return { check, progress, shot };
}

/** Caps a test page at 15 frames a second (two full worlds on an 8 GB machine) and meters its data channels. */
export function harness() {
  const requestFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    const deadline = performance.now() + 1000 / 15;
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
  // Simulated bad network: every outgoing message waits `lag` ms plus up to `jitter`, in order, and `stall` of them wait a
  // further 400 ms, as a reliable channel does when it resends a lost packet.
  window.__coopNet = { lag: 0, jitter: 0, stall: 0 };
  const size = value => typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.byteLength ?? value.size ?? 0;
  const meter = channel => {
    if (channel.__coopMetered) return channel;
    channel.__coopMetered = true;
    const send = channel.send.bind(channel);
    let due = 0;
    channel.send = value => {
      window.__coopWire.sent += size(value);
      const net = window.__coopNet;
      if (!net.lag && !net.jitter && !net.stall) return send(value);
      const copy = typeof value === 'string' ? value : value.slice ? value.slice(0) : value;
      const at = Math.max(due, performance.now() + net.lag + Math.random() * net.jitter + (Math.random() < net.stall ? 400 : 0));
      due = at;
      setTimeout(() => { try { if (channel.readyState === 'open') send(copy); } catch { /* closed */ } }, at - performance.now());
    };
    channel.addEventListener('message', event => { window.__coopWire.received += size(event.data); });
    return channel;
  };
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) { super(...args); window.__coopPeers.push(this); this.addEventListener('datachannel', event => meter(event.channel)); }
    createDataChannel(...args) { return meter(super.createDataChannel(...args)); }
  };
}

export const quiet = () => localStorage.setItem('op2.settings.v1', JSON.stringify({ quality: 0, music: 0 }));

/** Host and one guest in a lobby, on the mode button `mode`, started with the countdown. Returns the guest page and invite link. */
export async function startPair(host, { mode, password, out, progress, sleep, startNow = true }) {
  await host.waitForFunction(() => !!window.__op2?.ctx.render, null, { timeout: 120000 });
  await host.addInitScript(harness); await host.evaluate(harness);
  await host.addInitScript(quiet); await host.evaluate(() => window.__op2.ctx.render.setQuality(0));
  host.on('pageerror', error => out.errors.push(`host: ${error.message}`));
  await host.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 });
  await host.locator('.scr-splash').click();
  await button(host, 'Play').click(); await button(host, 'Multiplayer').click(); await button(host, 'Host a lobby').click();
  await host.locator('input[type=password]').fill(password); await button(host, 'Open lobby').click();
  await host.locator('.co-code').waitFor({ state: 'visible' });
  const link = await host.locator('.co-link').textContent();
  await host.locator('.co-field input').first().fill('HOST-ONE'); await host.locator('.co-field input').first().press('Enter');
  progress('host lobby open; guest joining by link');
  const guest = await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: 2 });
  guest.on('pageerror', error => out.errors.push(`guest: ${error.message}`));
  await guest.addInitScript(harness); await guest.addInitScript(quiet);
  const invite = link.replace(/^https?:\/\/[^/]+/, new URL(host.url()).origin);
  await guest.goto(invite);
  await joinFromSplash(guest, password);
  await guest.locator('.co-field input').first().fill('GUEST-TWO'); await guest.locator('.co-field input').first().press('Enter');
  if (!startNow) return { guest, invite };
  await sleep(600);
  await button(host, mode).click(); await button(host, 'Start').click();
  progress(`countdown to ${mode}`);
  return { guest, invite };
}

export async function joinFromSplash(page, password) {
  await page.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 }); await page.locator('.scr-splash').click();
  await page.locator('input[type=password]').fill(password); await button(page, 'Join').click();
  await page.locator('.co-player').nth(1).waitFor({ state: 'visible', timeout: 90000 });
}

/** Both pages in the match with the world and the other player's body up. */
export async function inMatch(pages, contract, play = true) {
  for (const page of pages) {
    await page.waitForURL(new RegExp(`contract=${contract}`), { timeout: 90000 });
    await page.waitForFunction(() => window.__op2?.ctx.coop?.world && window.__op2.ctx.coop.remotes.size >= 1
      && [...window.__op2.ctx.coop.remotes.values()].some(r => r.char.root.visible), null, { timeout: 150000 });
    if (play) await page.evaluate(() => { window.__op2.game.setState('playing'); });
  }
}

export const state = page => page.evaluate(() => {
  const { ctx, game } = window.__op2;
  const wallet = ctx.contracts?.wallet;
  return { state: game.state, host: ctx.coop?.hosting, wave: ctx.waves.wave, phase: ctx.waves.phase, health: ctx.player.health, alive: ctx.player.alive,
    downed: ctx.player.downed, credits: wallet?.credits ?? null, kills: ctx.progression.kills, score: ctx.progression.score,
    enemies: ctx.enemies.alive.length, time: ctx.time.elapsed, stats: ctx.coop?.world ? { ...ctx.coop.world.stats } : null,
    team: ctx.coop?.world ? [...ctx.coop.world.team.cards.values()] : null };
});

export async function traffic(page) {
  return page.evaluate(async () => {
    const world = window.__op2.ctx.coop.world;
    let sent = 0, received = 0;
    for (const peer of window.__coopPeers ?? []) {
      const stats = await peer.getStats();
      stats.forEach(stat => { if (stat.type === 'data-channel') { sent += stat.bytesSent ?? 0; received += stat.bytesReceived ?? 0; } });
    }
    return { time: performance.now(), world: { ...world.stats }, sent: window.__coopWire.sent, received: window.__coopWire.received,
      rtcSent: sent, rtcReceived: received, enemies: window.__op2.ctx.enemies.alive.length };
  });
}

/** A husk that stands still at `at` (host), for controlled kills and damage. */
export const dummy = (host, at, kind = 'husk') => host.evaluate(([at, kind]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const p = new V(...at); const snapped = p.clone();
  if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
  const enemy = ctx.enemies.spawn(kind, p);
  enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true;
  return enemy.uid;
}, [at, kind]);

/** Clears the host's wave so the next steps meet one enemy at a time. */
export const calm = host => host.evaluate(() => {
  const { ctx } = window.__op2;
  const wave = ctx.waves.wave;
  ctx.waves.reset(); ctx.waves.wave = wave;
  for (const enemy of [...ctx.enemies.alive]) ctx.enemies.withdraw(enemy);
});

export const aimAt = (page, uid) => page.evaluate(uid => {
  const { ctx } = window.__op2; const enemy = ctx.enemies.alive.find(e => e.uid === uid);
  if (!enemy) return false;
  const delta = enemy.center.clone().sub(ctx.player.eye);
  ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  window.__op2.game.setState('playing');
  return true;
}, uid);
