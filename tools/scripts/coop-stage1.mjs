// Two pages, one Chrome, actual Nostr/WebRTC. Run with tools/shot.mjs on the private port 5268.
// --port 5268 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 420 --script tools/scripts/coop-stage1.mjs --out tools/out/coop/stage1-final.png
import { writeFileSync } from 'node:fs';
export default async function (host, { sleep, outDir }) {
  const out = { errors: [] };
  const progress = step => console.error(`[coop-stage1] ${step}`);
  progress('booting host');
  const check = (value, message) => { if (!value) throw new Error(message); };
  const button = (p, name) => p.getByRole('button', { name, exact: true });
  const shot = async (p, name) => {
    const path = `${outDir}/stage1-${name}.png`;
    await p.screenshot({ path, timeout: 45000 });
    (out.screenshots ??= []).push(path);
  };
  const splash = async p => {
    await p.locator('.scr-splash').waitFor({ state: 'visible', timeout: 120000 });
    await p.locator('.scr-splash').click();
  };
  const state = p => p.evaluate(() => {
    const { ctx, game } = window.__op2;
    return { state: game.state, map: ctx.world.def.id, mode: ctx.contracts.def.id, paused: ctx.time.paused,
      time: ctx.time.elapsed, enemies: ctx.enemies.alive.length, wave: ctx.waves.wave,
      local: ctx.player.position.toArray(), weapon: ctx.weapons.current,
      remotes: [...ctx.coop.remotes.values()].map(r => ({ name: r.player.name, position: r.char.root.position.toArray(), visible: r.char.root.visible,
        weapon: r.char.root.userData.weapon, yaw: r.char.root.rotation.y, geometry: r.char.mesh.geometry.type })) };
  });
  const live = async p => {
    await p.waitForFunction(() => window.__op2?.ctx.coop?.remotes.size === 1
      && [...window.__op2.ctx.coop.remotes.values()][0].char.root.visible, null, { timeout: 120000 });
    // A real click can take pointer lock after the asynchronous deployment.
    if (await button(p, 'Resume').isVisible()) await button(p, 'Resume').click();
    await sleep(400);
    await p.evaluate(() => window.__op2.game.setState('playing'));
  };
  try {
  await host.waitForFunction(() => !!window.__op2?.ctx.render, null, { timeout: 120000 });
  await host.evaluate(() => { localStorage.setItem('op2.settings.v1', JSON.stringify({ quality: 0, music: 0 })); window.__op2.ctx.render.setQuality(0); });
  await splash(host);
  await button(host, 'Play').click();
  await button(host, 'Multiplayer').click();
  await button(host, 'Back').click();
  out.backCrumb = await host.locator('.mm-crumb:visible').textContent();
  check(out.backCrumb === 'Play', 'Multiplayer Back did not land on PLAY');
  await button(host, 'Multiplayer').click();
  await button(host, 'Host a lobby').click();
  await host.locator('input[type=password]').fill('coop-stage1-private');
  await button(host, 'Open lobby').click();
  await host.locator('.co-code').waitFor({ state: 'visible' });
  const link = await host.locator('.co-link').textContent();
  await host.locator('.co-field input').first().fill('HOST-ONE');
  await host.locator('.co-field input').first().press('Enter');

  const guest = await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: 2 });
  guest.on('pageerror', e => out.errors.push(e.message));
  await guest.addInitScript(() => localStorage.setItem('op2.settings.v1', JSON.stringify({ quality: 0, music: 0 })));
  await guest.goto(link.replace(/^https?:\/\/[^/]+/, new URL(host.url()).origin));
  await splash(guest);
  await guest.locator('input[type=password]').fill('coop-stage1-private');
  await button(guest, 'Join').click();
  await guest.locator('.co-player').nth(1).waitFor({ state: 'visible', timeout: 60000 });
  await guest.locator('.co-field input').first().fill('GUEST-TWO');
  await guest.locator('.co-field input').first().press('Enter');
  await guest.locator('.co-readybtn:not(.on)').click();
  await sleep(600);
  progress('both in lobby');
  await shot(host, 'lobby');
  await button(host, process.env.COOP_MODE ?? 'Crucible mode').click();
  await button(host, 'Start').click();
  await host.waitForURL(/contract=/, { timeout: 60000 });
  await guest.waitForURL(/contract=/, { timeout: 60000 });
  await live(host);
  await live(guest);
  await host.locator('.mk-label', { hasText: 'GUEST-TWO' }).waitFor({ state: 'visible' });
  progress('both in match');
  out.loaded = { host: await state(host), guest: await state(guest) };
  check(out.loaded.host.map === out.loaded.guest.map, 'Maps differ');
  check(out.loaded.host.mode === out.loaded.guest.mode, 'Modes differ');

  if (process.env.COOP_SMOKE === '1') {
    const mode = out.loaded.host.mode;
    check(out.loaded.host.enemies === 0 && out.loaded.guest.enemies === 0 && out.loaded.host.wave === 0 && out.loaded.guest.wave === 0, 'Free roam spawned enemies');
    await shot(host, `${mode}-host`); await shot(guest, `${mode}-guest`);
    await host.evaluate(() => window.__op2.ctx.hud.quitToMenu());
    await guest.locator('.co-err').waitFor({ state: 'visible', timeout: 30000 });
    out.hostLeft = await guest.locator('.co-err').textContent();
    await guest.close();
    return out;
  }

  // Put the two real local controllers on a common open spawn, 6m apart, looking at one another.
  const spawn = await host.evaluate(() => {
    const s = window.__op2.ctx.world.playerSpawns[0];
    return { at: s.position.toArray(), yaw: s.yaw };
  });
  await host.evaluate(s => {
    const { ctx, game } = window.__op2; const V = ctx.player.position.constructor;
    game.setState('playing'); ctx.player.teleport(new V(...s.at), s.yaw); ctx.player.pitch = -0.04;
  }, spawn);
  const guestAt = await host.evaluate(() => {
    const p = window.__op2.ctx.player;
    return { at: [p.position.x - Math.sin(p.yaw) * 6, p.position.y + 0.15, p.position.z - Math.cos(p.yaw) * 6], yaw: p.yaw + Math.PI };
  });
  await guest.evaluate(s => {
    const { ctx, game } = window.__op2; const V = ctx.player.position.constructor;
    game.setState('playing'); ctx.player.teleport(new V(...s.at), s.yaw); ctx.player.pitch = -0.04;
  }, guestAt);
  await sleep(1000);
  out.before = { host: await state(host), guest: await state(guest) };
  await shot(host, 'host-before');
  await shot(guest, 'guest-before');
  await guest.keyboard.down('KeyD');
  await sleep(500);
  await guest.keyboard.up('KeyD');
  await sleep(650);
  progress('guest moved');
  out.after = { host: await state(host), guest: await state(guest) };
  const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
  out.moved = distance(out.before.guest.local, out.after.guest.local);
  out.remoteMoved = distance(out.before.host.remotes[0].position, out.after.host.remotes[0].position);
  out.poseError = distance(out.after.guest.local, out.after.host.remotes[0].position);
  check(out.moved > 0.5 && out.remoteMoved > 0.5, 'Guest did not move on both screens');
  check(out.poseError < 0.5, 'Interpolated body did not settle at guest position');
  await shot(host, 'host-after');
  await shot(guest, 'guest-after');

  // Switch roles: move the host, and assert the guest's copy follows too.
  const beforeHost = await state(guest);
  await host.keyboard.down('KeyD'); await sleep(400); await host.keyboard.up('KeyD'); await sleep(600);
  out.hostMovedOnGuest = distance(beforeHost.remotes[0].position, (await state(guest)).remotes[0].position);
  check(out.hostMovedOnGuest > 0.5, 'Host pose did not reach guest');

  progress('checking Esc');
  await host.keyboard.press('Escape');
  await host.locator('.scr-pause').waitFor({ state: 'visible' });
  const pauseBefore = await state(host);
  await guest.keyboard.down('KeyA'); await sleep(450); await guest.keyboard.up('KeyA'); await sleep(500);
  out.menu = { before: pauseBefore, after: await state(host), title: await host.locator('.pz-title').textContent() };
  check(out.menu.after.state === 'paused' && !out.menu.after.paused, 'Esc froze the co-op clock');
  check(out.menu.after.time > out.menu.before.time, 'World time did not advance under Esc');
  check(distance(out.menu.before.remotes[0].position, out.menu.after.remotes[0].position) > 0.5, 'Remote froze under Esc');
  check(out.menu.after.enemies === 0 && out.menu.after.wave === 0, 'Enemies/waves running in free roam');
  await shot(host, 'esc-world-live');
  await button(host, 'Resume').click(); await sleep(500);

  // Guest departure removes the actual mesh and produces a feed line.
  await guest.keyboard.press('Escape');
  await guest.locator('.scr-pause').waitFor({ state: 'visible' });
  await button(guest, 'Quit to menu').click();
  await host.waitForFunction(() => window.__op2.ctx.coop.remotes.size === 0, null, { timeout: 30000 });
  out.guestLeftFeed = await host.locator('.feed').textContent().catch(() => host.locator('body').textContent());
  check(out.guestLeftFeed.includes('GUEST-TWO left.'), 'No leave feed');
  await shot(host, 'guest-left');

  // Rejoin a running match through its lobby; it receives the host's current start descriptor.
  await button(guest, 'Play').click(); await button(guest, 'Multiplayer').click(); await button(guest, 'Join a lobby').click();
  const code = new URL(link).searchParams.get('join');
  await guest.locator('.co-field input').first().fill(code);
  await guest.locator('input[type=password]').fill('coop-stage1-private');
  await button(guest, 'Join').click();
  await live(guest); await live(host);
  await host.keyboard.press('Escape'); await host.locator('.scr-pause').waitFor({ state: 'visible' });
  await button(host, 'Quit to menu').click();
  await guest.locator('.co-err').waitFor({ state: 'visible', timeout: 30000 });
  progress('host left');
  out.hostLeft = await guest.locator('.co-err').textContent();
  check(out.hostLeft.includes('host left'), 'Guest not returned to menu after host left');
  await shot(guest, 'host-left');
  await host.evaluate(() => window.__op2.game.newRun());
  await sleep(1200);
  out.soloAfterCoop = await host.evaluate(() => ({ coop: !!window.__op2.ctx.coop, wave: window.__op2.ctx.waves.wave, state: window.__op2.game.state }));
  check(!out.soloAfterCoop.coop && out.soloAfterCoop.wave > 0, 'Solo systems were not restored after co-op');
  await guest.close();
  return out;
  } finally { writeFileSync(`${outDir}/stage1-evidence${process.env.COOP_SMOKE ? '-' + out.loaded?.host.mode + '-smoke' : ''}.json`, JSON.stringify(out, null, 2)); }
}
