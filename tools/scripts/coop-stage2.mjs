import { writeFileSync } from 'node:fs';

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  const check = (condition, message) => { if (!condition) throw new Error(message); out.checks.push(message); };
  const progress = message => console.error(`[coop-stage2] ${message}`);
  const shot = async (page, name) => {
    const path = `${outDir}/stage2-${name}.png`;
    if (name !== 'esc-world-live') await page.evaluate(() => {
      if (window.__op2.game.state === 'paused') window.__op2.game.setState('playing');
    });
    await sleep(150);
    await page.screenshot({ path, timeout: 45000 }); out.screenshots.push(path);
  };
  const trackConnections = () => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const deadline = performance.now() + 1000 / 15;
      const tick = now => now >= deadline ? callback(now) : requestFrame(tick);
      return requestFrame(tick);
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
    window.RTCPeerConnection = class extends Peer {
      constructor(...args) { super(...args); window.__coopPeers.push(this); this.addEventListener('datachannel', event => meter(event.channel)); }
      createDataChannel(...args) { return meter(super.createDataChannel(...args)); }
    };
  };
  const traffic = page => page.evaluate(async () => {
    const world = window.__op2.ctx.coop.world;
    let sent = 0, received = 0;
    for (const peer of window.__coopPeers ?? []) {
      const stats = await peer.getStats();
      stats.forEach(stat => { if (stat.type === 'data-channel') { sent += stat.bytesSent ?? 0; received += stat.bytesReceived ?? 0; } });
    }
    return { time: performance.now(), world: { ...world.stats }, sent: window.__coopWire.sent, received: window.__coopWire.received,
      rtcSent: sent, rtcReceived: received, enemies: window.__op2.ctx.enemies.alive.length };
  });
  const state = page => page.evaluate(() => {
    const { ctx, game } = window.__op2;
    return { state: game.state, host: ctx.coop.hosting, freeRoam: ctx.coop.freeRoam, wave: ctx.waves.wave, health: ctx.player.health,
      alive: ctx.player.alive, enemies: ctx.enemies.alive.map(enemy => ({ uid: enemy.uid, id: enemy.id, health: enemy.health, at: enemy.position.toArray() })),
      time: ctx.time.elapsed, traffic: ctx.coop.world.stats };
  });
  let guest;
  try {
    progress('booting host');
    await host.waitForFunction(() => !!window.__op2?.ctx.render, null, { timeout: 120000 });
    await host.addInitScript(trackConnections); await host.evaluate(trackConnections);
    await host.evaluate(() => { localStorage.setItem('op2.settings.v1', JSON.stringify({ quality: 0, music: 0 })); window.__op2.ctx.render.setQuality(0); });
    await host.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 });
    await host.locator('.scr-splash').click();
    // A fresh browser profile's first Play goes to Retraining (contracts/firstLaunch.ts); this page is a returning player.
    await host.evaluate(() => localStorage.setItem('op2.played.v1', '1'));
    await button(host, 'Play').click(); await button(host, 'Multiplayer').click(); await button(host, 'Host a lobby').click();
    await host.locator('input[type=password]').fill('coop-stage2-private'); await button(host, 'Open lobby').click();
    await host.locator('.co-code').waitFor({ state: 'visible' });
    const link = await host.locator('.co-link').textContent();
    progress('host lobby open; joining guest');
    await host.locator('.co-field input').first().fill('HOST-ONE'); await host.locator('.co-field input').first().press('Enter');
    guest = await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: 2 });
    guest.on('pageerror', error => out.errors.push(error.message));
    await guest.addInitScript(trackConnections);
    await guest.addInitScript(() => localStorage.setItem('op2.settings.v1', JSON.stringify({ quality: 0, music: 0 })));
    await guest.goto(link.replace(/^https?:\/\/[^/]+/, new URL(host.url()).origin));
    progress('guest page opened');
    await guest.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 }); await guest.locator('.scr-splash').click();
    await guest.locator('input[type=password]').fill('coop-stage2-private'); await button(guest, 'Join').click();
    progress('guest entered password; waiting for roster');
    await guest.locator('.co-player').nth(1).waitFor({ state: 'visible', timeout: 60000 });
    await guest.locator('.co-field input').first().fill('GUEST-TWO'); await guest.locator('.co-field input').first().press('Enter');
    await guest.locator('.co-readybtn:not(.on)').click();
    progress('both in lobby; starting Crucible');
    await sleep(600); await button(host, 'Crucible mode').click(); await button(host, 'Start').click();
    await host.waitForURL(/contract=crucible/, { timeout: 60000 }); await guest.waitForURL(/contract=crucible/, { timeout: 60000 });
    progress('both loading Crucible');
    for (const page of [host, guest]) {
      await page.waitForFunction(() => window.__op2?.ctx.coop?.world && window.__op2.ctx.coop.remotes.size === 1, null, { timeout: 120000 });
      await page.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.player.modifiers.invulnerable = true; });
    }
    progress('measuring live wave traffic');
    await host.waitForFunction(() => window.__op2.ctx.enemies.alive.length >= 16, null, { timeout: 60000 });
    await guest.waitForFunction(() => window.__op2.ctx.enemies.alive.length >= 16, null, { timeout: 30000 });
    out.loaded = { host: await state(host), guest: await state(guest) };
    check(out.loaded.host.host && !out.loaded.guest.host && !out.loaded.host.freeRoam, 'Crucible uses host world and guest replicas');
    await host.evaluate(() => {
      const { ctx, game } = window.__op2;
      const enemy = ctx.enemies.alive[0];
      const delta = enemy.center.clone().sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
      game.setState('playing'); ctx.input.simulate('fire', true);
    });
    const start = { host: await traffic(host), guest: await traffic(guest) };
    await sleep(10000);
    await host.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
    const end = { host: await traffic(host), guest: await traffic(guest) };
    const seconds = (end.host.time - start.host.time) / 1000;
    out.bandwidth = { seconds, enemiesBefore: start.host.enemies, enemiesAfter: end.host.enemies,
      snapshotBytesPerSecond: (end.host.world.snapshotBytes - start.host.world.snapshotBytes) / seconds,
      eventBytesPerSecond: (end.host.world.eventBytes - start.host.world.eventBytes) / seconds,
      hostDataChannelBytesPerSecond: (end.host.sent - start.host.sent) / seconds,
      guestDataChannelBytesPerSecond: (end.guest.sent - start.guest.sent) / seconds,
      snapshotsPerSecond: (end.host.world.snapshotPackets - start.host.world.snapshotPackets) / seconds };
    check(out.bandwidth.snapshotBytesPerSecond > 0 && out.bandwidth.snapshotBytesPerSecond < 25000, 'Measured snapshot traffic is bounded at a live wave');
    check(out.bandwidth.eventBytesPerSecond > 0, 'Wave bandwidth includes actual host shooting events');
    await shot(host, 'wave-host'); await shot(guest, 'wave-guest');

    progress('arranging a real guest trigger pull');
    const layout = await host.evaluate(() => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const wave = ctx.waves.wave;
      ctx.waves.reset(); ctx.waves.wave = wave;
      for (const enemy of [...ctx.enemies.alive]) ctx.enemies.withdraw(enemy);
      const spawn = ctx.world.playerSpawns[0];
      const forward = new V(-Math.sin(spawn.yaw), 0, -Math.cos(spawn.yaw));
      const enemyAt = spawn.position.clone().addScaledVector(forward, 7);
      const snapped = enemyAt.clone();
      if (ctx.world.nav.nearest(enemyAt, 4, snapped)) enemyAt.copy(snapped);
      ctx.player.teleport(spawn.position.clone().addScaledVector(forward, -6), spawn.yaw);
      const enemy = ctx.enemies.spawn('husk', enemyAt);
      enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true;
      return { spawn: spawn.position.toArray(), yaw: spawn.yaw, uid: enemy.uid, at: enemyAt.toArray() };
    });
    await guest.evaluate(layout => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      ctx.player.teleport(new V(...layout.spawn), layout.yaw);
      ctx.weapons.give('smg'); ctx.weapons.switchTo('smg'); ctx.weapons.refillMagazines();
      window.__coopProof = { fired: 0, damaged: 0 };
      ctx.events.on('weapon:fired', () => window.__coopProof.fired++);
      ctx.events.on('player:damaged', () => window.__coopProof.damaged++);
    }, layout);
    await guest.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(enemy => enemy.uid === uid), layout.uid, { timeout: 15000 });
    await sleep(800);
    await guest.evaluate(uid => {
      const { ctx } = window.__op2; const enemy = ctx.enemies.alive.find(enemy => enemy.uid === uid);
      const delta = enemy.center.clone().sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
      window.__op2.game.setState('playing');
    }, layout.uid);
    await sleep(350); await shot(guest, 'guest-aiming');
    await guest.mouse.down(); await sleep(950); await guest.mouse.up();
    await host.waitForFunction(uid => !window.__op2.ctx.enemies.alive.some(enemy => enemy.uid === uid), layout.uid, { timeout: 15000 });
    await guest.waitForFunction(uid => !window.__op2.ctx.enemies.alive.some(enemy => enemy.uid === uid), layout.uid, { timeout: 15000 });
    out.guestShooting = { host: await state(host), guest: await state(guest), local: await guest.evaluate(() => window.__coopProof) };
    check(out.guestShooting.local.fired > 0 && out.guestShooting.host.traffic.accepted > 0, 'Guest mouse fire reaches normal host damage and kills the same enemy on both screens');
    await shot(host, 'guest-kill-host'); await shot(guest, 'guest-kill-guest');

    progress('enemy targets and hurts guest');
    await guest.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = false; });
    const guestAt = await guest.evaluate(() => window.__op2.ctx.player.position.toArray());
    const attacker = await host.evaluate(at => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const position = new V(...at).add(new V(1.5, 0, 0));
      const enemy = ctx.enemies.spawn('husk', position);
      enemy.behaviours = []; enemy.mode = 'hold'; enemy.face = 'player'; enemy.dummy = true;
      enemy.yaw = -Math.PI / 2; enemy.thinkAt = 0;
      return enemy.uid;
    }, guestAt);
    const healthBefore = await guest.evaluate(() => window.__op2.ctx.player.health);
    await guest.waitForFunction(before => window.__op2.ctx.player.health < before, healthBefore, { timeout: 30000 });
    out.guestDamage = { before: healthBefore, after: await guest.evaluate(() => window.__op2.ctx.player.health),
      local: await guest.evaluate(() => window.__coopProof), host: await state(host) };
    check(out.guestDamage.local.damaged > 0, 'Host enemy AI selects guest and guest takes authoritative damage');
    await shot(guest, 'guest-damaged'); await shot(host, 'enemy-targets-guest');
    await host.evaluate(uid => { const enemy = window.__op2.ctx.enemies.alive.find(enemy => enemy.uid === uid); if (enemy) enemy.damageMul = 100; }, attacker);
    await guest.waitForFunction(() => !window.__op2.ctx.player.alive, null, { timeout: 30000 });
    out.guestDeath = { host: await state(host), guest: await state(guest) };
    await host.evaluate(uid => { const { ctx } = window.__op2; const enemy = ctx.enemies.alive.find(enemy => enemy.uid === uid); if (enemy) ctx.enemies.withdraw(enemy); }, attacker);
    await shot(guest, 'guest-dead-world-live');
    await guest.waitForFunction(() => window.__op2.ctx.player.alive, null, { timeout: 12000 });
    out.guestRespawn = { host: await state(host), guest: await state(guest) };
    check(out.guestDeath.host.state !== 'gameover' && out.guestRespawn.host.time > out.guestDeath.host.time && out.guestRespawn.guest.alive, 'Guest death keeps host world live and guest respawns');
    await guest.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await shot(guest, 'guest-respawned');
    progress('host respawn and live Esc');
    const hostAttacker = await host.evaluate(() => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      ctx.player.modifiers.invulnerable = false;
      const enemy = ctx.enemies.spawn('husk', ctx.player.position.clone().add(new V(1.5, 0, 0)));
      enemy.behaviours = []; enemy.mode = 'hold'; enemy.face = 'player'; enemy.dummy = true;
      enemy.damageMul = 100; enemy.yaw = -Math.PI / 2; enemy.thinkAt = 0;
      return enemy.uid;
    });
    await host.waitForFunction(() => !window.__op2.ctx.player.alive, null, { timeout: 30000 });
    const beforeHostRespawn = await state(guest);
    await host.evaluate(uid => { const { ctx } = window.__op2; const enemy = ctx.enemies.alive.find(enemy => enemy.uid === uid); if (enemy) ctx.enemies.withdraw(enemy); }, hostAttacker);
    await host.waitForFunction(() => window.__op2.ctx.player.alive, null, { timeout: 12000 });
    out.hostRespawn = { host: await state(host), guest: await state(guest) };
    check(out.hostRespawn.guest.time > beforeHostRespawn.time && out.hostRespawn.host.state !== 'gameover', 'Host death also respawns without freezing guest');
    await host.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; window.__op2.game.setState('playing'); });
    await host.keyboard.press('Escape');
    await host.locator('.scr-pause').waitFor({ state: 'visible' });
    const menuTime = await host.evaluate(() => window.__op2.ctx.time.elapsed); await sleep(600);
    check(await host.evaluate(before => !window.__op2.ctx.time.paused && window.__op2.ctx.time.elapsed > before, menuTime), 'Esc keeps Crucible enemies and clock live');
    await shot(host, 'esc-world-live'); await host.evaluate(() => window.__op2.game.setState('playing'));
    out.final = { host: await state(host), guest: await state(guest) };
    check(out.errors.length === 0, 'Guest reports no page exceptions');
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/stage2-evidence.json`, JSON.stringify(out, null, 2));
    await guest?.close();
  }
}
