// Co-op time proof: one player slows everyone, with a notice on every screen (owner decision 3). Two or three pages.
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 420 --script tools/scripts/coop-time-team.mjs --out tools/out/coop/time/team.png
//   COOP_PLAYERS=2|3, COOP_SIM=lag:120,jitter:40,loss:0.05, COOP_NET=rtc, COOP_SHOTS=1 (keep the notice screenshots; use --dpr 2 --w 1440 --h 900)
//
// On EVERY page, for each cause (a guest's Focus, the host's Focus, two at once, a perk, a boss's death):
//   - the world clock slows to the cause's scale (the host's enemies are measured too, and the guests' copies of them);
//   - the notice names who and what, no later than the slow-mo itself, within NOTICE_MS of the cause;
//   - the player's own clock, movement speed and fire rate stay what they are at full speed (what single-player slow-mo
//     gives: coop-time-solo.mjs measures that on a solo page);
//   - when it ends the world is back at 1 and the notice goes.
// Then: a late joiner arriving mid-slow-mo, a dropped end (host to guests, and guest to host), a downed player refused,
// and the team's 12-second budget.
import { writeFileSync } from 'node:fs';
import { calm, give, inMatch, kit, live, openGuest, spawn, startParty, teleport } from './coop-kit.mjs';

const read = page => page.evaluate(() => {
  const { ctx } = window.__op2, w = ctx.coop.world;
  return { slowmo: +ctx.time.slowmo.toFixed(3), slows: w.slows.map(e => ({ kind: e.kind, slot: e.slot, scale: e.scale, label: e.label })), notice: w.slowNotice,
    callout: document.querySelector('.callout-name')?.textContent ?? '', grade: ctx.progression.perks.grade, me: ctx.coop.lobby.me.slot, name: ctx.coop.lobby.me.name };
});

/** Starts a watcher on the page: when the world first slowed, when the notice first showed, when both were gone (epoch ms). */
const watch = page => page.evaluate(() => {
  const { ctx } = window.__op2, w = ctx.coop.world;
  clearInterval(window.__tw?.timer);
  // `stall`: ms this page's main thread was blocked beyond 50 ms at a time since the watch began (a starved page on a
  // shared machine); `stallNotice` and `stallFull` are its value when the notice showed and when the world was back at 1.
  // `bare`: ms the world was slow on this page with no notice up at all (the owner's rule says never). The notice is up while
  // it has a line (who, with what) or says "WORLD BACK TO FULL SPEED", which it does through the blend back.
  const tw = window.__tw = { slowAt: 0, noticeAt: 0, fullAt: 0, goneAt: 0, min: 1, timer: 0, stall: 0, stallNotice: 0, stallFull: 0, bare: 0, last: performance.now() };
  tw.timer = setInterval(() => {
    const at = performance.now(), now = performance.timeOrigin + at, lines = w.slowNotice.lines.length;
    const up = lines > 0 || !!w.slowNotice.state;
    if (ctx.time.slowmo < 0.995 && !up) tw.bare += Math.min(50, at - tw.last);
    tw.stall += Math.max(0, at - tw.last - 50); tw.last = at;
    if (!tw.slowAt && ctx.time.slowmo < 0.995) tw.slowAt = now;
    if (!tw.noticeAt && lines > 0) { tw.noticeAt = now; tw.stallNotice = tw.stall; }
    tw.min = Math.min(tw.min, ctx.time.slowmo);
    if (tw.slowAt && !tw.fullAt && ctx.time.slowmo >= 1 && w.slows.length === 0) { tw.fullAt = now; tw.stallFull = tw.stall; }
    // When the notice went, whether or not the world was back by then (it used to be noted only after the world was back,
    // so the check that it outlasts the slow-mo could not fail).
    if (tw.noticeAt && !tw.goneAt && !up) tw.goneAt = now;
  }, 4);
});
const watched = page => page.evaluate(() => ({ ...window.__tw, timer: 0 }));
const epoch = page => page.evaluate(() => performance.timeOrigin + performance.now());

/**
 * One measuring window on a page: holds forward and fire from a fixed spot and reports, per real second, the world clock, the
 * player's own clock, metres walked, shots fired and the median speed of the tracked enemies.
 */
const sample = (page, spot, uids, ms) => page.evaluate(async ([spot, uids, ms]) => {
  const { ctx, game } = window.__op2, V = ctx.player.position.constructor;
  if (game.state !== 'playing') game.setState('playing');
  ctx.player.teleport(new V(...spot.at), spot.yaw);
  // Guns up: the fire rate is measured into the sky, so no round staggers the enemies whose speed is being measured.
  ctx.player.pitch = 1.1;
  ctx.weapons.refillMagazines();
  await new Promise(r => setTimeout(r, 120));
  let shots = 0;
  const off = ctx.events.on('weapon:fired', () => shots++);
  ctx.input.simulate('forward', true); ctx.input.simulate('fire', true);
  // Both ends of the window are read on a frame, after the game's own update: positions and clocks only change there.
  const frameEnd = () => new Promise(r => requestAnimationFrame(r));
  // The run-up: until the player is at a steady speed (a slow page takes more wall time to get there), a second at most.
  for (let i = 0, last = -1, steady = 0; i < 120 && steady < 3; i++) {
    await frameEnd();
    const v = Math.hypot(ctx.player.velocity.x, ctx.player.velocity.z);
    steady = v > 1 && Math.abs(v - last) < 0.01 * v ? steady + 1 : 0;
    last = v;
  }
  // Rates are per second of the game's own real clock (`realElapsed`), read at frame boundaries, so a loaded machine's long
  // frames do not smear the window's edges. `fps` says how the page was running.
  const from = ctx.player.position.clone(), t0 = performance.now(), r0 = ctx.time.realElapsed, f0 = ctx.time.frame, w0 = ctx.time.elapsed, p0 = ctx.time.playerElapsed; shots = 0;
  // Each tracked enemy, frame by frame: how far it really moved on this screen, and how far its own speed says it should
  // have at full speed (its velocity, the host's figure on every screen, times the wall time of the frame).
  const tracks = uids.map(() => ({ path: 0, due: 0, last: null }));
  let tracking = true, lastAt = performance.now();
  const follow = () => {
    const now = performance.now(), dt = (now - lastAt) / 1000; lastAt = now;
    uids.forEach((u, i) => {
      const e = ctx.enemies.alive.find(e => e.uid === u), w = tracks[i];
      if (!e) { w.last = null; return; }
      if (w.last) { w.path += Math.hypot(e.position.x - w.last[0], e.position.z - w.last[1]); w.due += Math.hypot(e.velocity.x, e.velocity.z) * dt; }
      w.last = [e.position.x, e.position.z];
    });
    if (tracking) requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  const top = setInterval(() => ctx.weapons.refillMagazines(), 200);
  await new Promise(r => setTimeout(r, ms));
  await frameEnd();
  const seconds = ctx.time.realElapsed - r0, wall = (performance.now() - t0) / 1000, fps = (ctx.time.frame - f0) / wall;
  const walked = ctx.player.position.distanceTo(from), fired = shots;
  clearInterval(top); off(); tracking = false;
  ctx.input.simulate('forward', false); ctx.input.simulate('fire', false);
  // 1 at full speed, the world's scale in slow-mo, whatever the enemy was doing (turning, stopping, starting).
  const speeds = tracks.filter(w => w.due > 0.6).map(w => w.path / w.due).sort((x, y) => x - y);
  return { world: (ctx.time.elapsed - w0) / seconds, own: (ctx.time.playerElapsed - p0) / seconds, walk: walked / seconds, fire: fired / seconds,
    enemy: speeds.length ? speeds[Math.floor(speeds.length / 2)] : null, fps };
}, [spot, uids, ms]);

const tapChip = async (page, sleep) => {
  const at = await page.evaluate(() => {
    const { ctx, game } = window.__op2, chips = ctx.contracts.chips;
    if (game.state !== 'playing') game.setState('playing');
    if (!chips.rack.fitted.includes('focus')) chips.rack.fit('focus', true);
    ctx.input.simulate('sonar', true);
    return performance.timeOrigin + performance.now();
  });
  await sleep(60);
  await page.evaluate(() => window.__op2.ctx.input.simulate('sonar', false));
  return at;
};
const grant = (page, id) => page.evaluate(id => { window.__op2.ctx.progression.grant(id); return performance.timeOrigin + performance.now(); }, id);
const fillFocus = page => page.evaluate(() => { const chips = window.__op2.ctx.contracts.chips; chips.rack.fit('focus', true); chips.meter = 1; chips.rest = 0; });
const fillBudget = host => host.evaluate(() => { window.__op2.ctx.coop.world.slowBoard.bank = 12; });

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], scenarios: {} };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const net = process.env.COOP_SIM || undefined;
  // A partial run (COOP_ONLY) and a screenshot run keep their own evidence files: they never overwrite a full run's.
  const tag = `time-team-${players}p${net ? '-badnet' : ''}${process.env.COOP_ONLY ? '-part' : ''}${process.env.COOP_SHOTS ? '-shots' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const shots = !!process.env.COOP_SHOTS;
  // How soon after the cause every screen must show the notice, and how soon after the end it must be at full speed.
  const NOTICE_MS = net ? 900 : 300, FULL_MS = net ? 2200 : 1300;
  out.bounds = { NOTICE_MS, FULL_MS, net: net ?? 'clean' };
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players, net, out, progress, sleep });
    await live(party, { enemies: 4 });
    const pages = party.pages;
    for (const page of pages) { await give(page, 'smg'); await fillFocus(page); }
    const names = await Promise.all(pages.map(page => read(page).then(r => r.name)));
    const base = await host.evaluate(() => { const s = window.__op2.ctx.world.playerSpawns[0]; return { at: s.position.toArray(), yaw: s.yaw }; });
    // Each player's own spot, a few metres apart across the spawn's facing, so nobody walks into anybody.
    const spots = pages.map((_, i) => ({ yaw: base.yaw, at: [base.at[0] + Math.cos(base.yaw) * (i - (pages.length - 1) / 2) * 3, base.at[1], base.at[2] - Math.sin(base.yaw) * (i - (pages.length - 1) / 2) * 3] }));
    const fresh = async () => {
      await calm(host);
      const uids = await spawn(host, 'husk', 4, { ahead: 34, spacing: 2.5 });
      for (const page of party.guests) await page.waitForFunction(uids => uids.every(u => window.__op2.ctx.enemies.alive.some(e => e.uid === u)), uids, { timeout: 15000 });
      await sleep(900);
      return uids;
    };
    const measure = uids => Promise.all(pages.map((page, i) => sample(page, spots[i], uids, 900)));
    const near = (value, want, tolerance) => Math.abs(value - want) <= tolerance;
    // COOP_ONLY=late,budget runs only those parts (guest-focus, host-focus, both, perk, boss, dropped, late, budget, down).
    const only = process.env.COOP_ONLY?.split(',');
    const want = key => !only || only.includes(key);
    out.only = only ?? 'all';
    /** Nothing is slowing the world on any page, and each is back at full speed. */
    const quiet = list => Promise.all(list.map(page => page.waitForFunction(() => window.__op2.ctx.time.slowmo === 1 && window.__op2.ctx.coop.world.slows.length === 0, null, { timeout: 15000 })));
    /** Every page has blended down to a slowed world. */
    const allSlow = list => Promise.all(list.map(page => page.waitForFunction(() => window.__op2.ctx.time.slowmo < 0.5, null, { timeout: 6000 })));
    const round = m => ({ world: +m.world.toFixed(3), own: +m.own.toFixed(3), walk: +m.walk.toFixed(2), fire: +m.fire.toFixed(1), enemy: m.enemy === null ? null : +m.enemy.toFixed(2), fps: Math.round(m.fps) });

    /**
     * Waits until every page is drawing at 15 fps or better (the dev box is shared: a starved page proves nothing about timing).
     * Gives up after two minutes and lets the scenario run and say what it saw.
     */
    const healthy = async list => {
      const started = Date.now();
      for (;;) {
        const fps = await Promise.all(list.map(page => page.evaluate(async () => {
          const f0 = window.__op2.ctx.time.frame, t0 = performance.now();
          await new Promise(r => setTimeout(r, 500));
          return (window.__op2.ctx.time.frame - f0) / ((performance.now() - t0) / 1000);
        })));
        if (fps.every(f => f >= 15) || Date.now() - started > 120000) { (out.waits ??= []).push({ waitedMs: Date.now() - started, fps: fps.map(Math.round) }); return; }
        await sleep(2000);
      }
    };

    /** One cause, start to end, asserted on every page. */
    const scenario = async (key, { title, cause, end, scale, lines, grade, hold = 0 }) => {
      if (!want(key)) return;
      progress(title);
      await fillBudget(host);
      await healthy(pages);
      const before = await measure(await fresh());
      const uids = await fresh();
      await healthy(pages);
      for (const page of pages) await watch(page);
      const t0 = await cause();
      await Promise.all(pages.map(page => page.waitForFunction(() => window.__tw.noticeAt > 0 && window.__tw.slowAt > 0, null, { timeout: 8000 }))).catch(async error => {
        // Nothing slowed: say what each page had, so the failure explains itself.
        out.stuck = await Promise.all(pages.map(page => page.evaluate(() => {
          const { ctx, game } = window.__op2, chips = ctx.contracts.chips, w = ctx.coop.world;
          return { state: game.state, fps: window.__op2.stats().fps, focus: chips.focus, meter: chips.meter, fitted: [...chips.rack.fitted], current: chips.current, alive: ctx.player.alive, downed: ctx.player.downed,
            slows: w.slows.length, board: { list: w.slowBoard.list.length, bank: w.slowBoard.bank, locked: w.slowBoard.locked }, effects: ctx.progression.effects.map(e => e.id),
            callout: document.querySelector('.callout-name')?.textContent ?? '', tw: { ...window.__tw, timer: 0 }, slowmo: ctx.time.slowmo, hidden: document.hidden };
        })));
        throw new Error(`${title}: no slow-mo within 8 s of the cause :: ${JSON.stringify(out.stuck)} :: ${error.message}`);
      });
      // What every screen reads, the moment they all show it (every line of it, when two causes start a moment apart); then
      // the blend in, then the measuring window.
      await Promise.all(pages.map(page => page.waitForFunction(n => window.__op2.ctx.coop.world.slowNotice.lines.length >= n, lines.length, { timeout: 5000 }))).catch(() => {});
      const [seen, states] = await Promise.all([Promise.all(pages.map(watched)), Promise.all(pages.map(read))]);
      await sleep(250);
      const during = await measure(uids);
      if (shots) for (let i = 0; i < pages.length; i++) await shot(pages[i], `${key}-${i === 0 ? 'host' : `guest${i}`}`);
      // A page's frame, ms: every bound below allows three of them on top (a slow page reacts a frame late, not a second late).
      const frame = before.map((m, i) => 1000 / Math.max(5, Math.min(m.fps, during[i].fps)));
      if (hold) await sleep(hold);
      const tEnd = end ? await end() : await epoch(host);
      for (const page of pages) await page.waitForFunction(() => window.__tw.fullAt > 0 && window.__tw.goneAt > 0, null, { timeout: 12000 });
      const after = await Promise.all(pages.map(watched));
      const result = out.scenarios[key] = { scale,
        noticeMs: seen.map(s => Math.round(s.noticeAt - t0)), slowMs: seen.map(s => Math.round(s.slowAt - t0)),
        fullMs: after.map(s => Math.round(s.fullAt - tEnd)), noticeGoneMs: after.map(s => Math.round(s.goneAt - tEnd)), min: after.map(s => +s.min.toFixed(3)),
        lines: states.map(s => s.notice.lines), state: states.map(s => s.notice.state), grade: states.map(s => s.grade),
        before: before.map(round), during: during.map(round) };
      result.fps = before.map((m, i) => [m.fps, during[i].fps]);
      // Time a page's main thread was blocked does not count against it (`stall`, from the watcher): the machine is shared.
      result.stallMs = after.map((s, i) => [Math.round(seen[i].stallNotice), Math.round(s.stallFull - seen[i].stallNotice)]);
      check(seen.every((s, i) => s.noticeAt > 0 && s.noticeAt - t0 <= NOTICE_MS + 3 * frame[i] + s.stallNotice), `${title}: the notice is on every screen within ${NOTICE_MS} ms of the cause (plus three of that page's frames)`, [result.noticeMs, result.fps, result.stallMs]);
      // No slow-mo without a notice: the notice is never later than the slowing (two watcher ticks of slack).
      check(seen.every(s => s.slowAt > 0 && s.noticeAt <= s.slowAt + 40), `${title}: no screen slows before its notice shows`, [result.noticeMs, result.slowMs]);
      for (const want of lines) check(states.every((s, i) => s.notice.lines.some(l => l === want(i))), `${title}: every screen reads "${want(-1)}"`, result.lines);
      check(states.every(s => s.notice.lines.length === lines.length), `${title}: ${lines.length} line${lines.length > 1 ? 's' : ''} on the notice, no more`, result.lines);
      check(states.every(s => s.notice.state === `WORLD AT ${scale.toFixed(2)}x · YOU AT FULL SPEED`), `${title}: the notice gives the world's speed (${scale}x)`, result.state);
      check(during.every(m => near(m.world, scale, 0.06)), `${title}: every screen's world clock runs at ${scale}x`, result.during.map(m => m.world));
      check(during.every(m => near(m.own, 1, 0.04)), `${title}: every player's own clock stays at full speed`, result.during.map(m => m.own));
      // Before: a sanity figure only (a guest's copies hold still for a moment whenever a snapshot is late, more so on a loaded box).
      check(before.every(m => m.enemy !== null && m.enemy > 0.5 && m.enemy < 1.3) && during.every(m => m.enemy !== null && near(m.enemy, scale, m.fps >= 30 ? 0.12 : 0.2)), `${title}: the host's enemies, and every guest's copies, move at ${scale}x their own speed (1x before)`,
        [result.before.map(m => m.enemy), result.during.map(m => m.enemy)]);
      check(during.every((m, i) => near(m.walk / before[i].walk, 1, 0.1)), `${title}: every player walks as fast as at full speed (single-player slow-mo gives the same)`, [result.before.map(m => m.walk), result.during.map(m => m.walk)]);
      // A gun fires on whole frames, so its measured rate moves with the frame rate: the tight bound needs a steady 40 fps.
      const steady = before.every(m => m.fps >= 40) && during.every(m => m.fps >= 40);
      result.steady = steady;
      check(during.every((m, i) => near(m.fire / before[i].fire, 1, steady ? 0.12 : 0.3)), `${title}: every player's gun fires as fast as at full speed${steady ? '' : ' (loose bound: a page ran below 40 fps)'}`,
        [result.before.map(m => m.fire), result.during.map(m => m.fire), result.fps]);
      if (grade !== undefined) check(states.every(s => s.grade === grade), `${title}: every screen has the ${grade} look`, result.grade);
      // The blend out runs on each page's own clamped clock: below 20 fps it takes that much longer.
      check(after.every((s, i) => s.fullAt - tEnd <= FULL_MS * Math.max(1, frame[i] / 50) + 3 * frame[i] + (s.stallFull - seen[i].stallNotice)), `${title}: every screen is back at full speed within ${FULL_MS} ms of the end (at 20 fps or better)`, [result.fullMs, result.fps, result.stallMs]);
      check(after.every(s => s.goneAt > s.fullAt - 50), `${title}: the notice stays until the world is at full speed, then goes`, result.noticeGoneMs);
      check(after.every(s => s.bare <= 60), `${title}: no screen was slow at any moment with no notice up`, after.map(s => Math.round(s.bare)));
      const rest = await Promise.all(pages.map(read));
      check(rest.every(s => s.slowmo === 1 && s.slows.length === 0 && s.notice.lines.length === 0), `${title}: afterwards nothing is slow anywhere`, rest.map(s => s.slowmo));
      await sleep(400);
    };
    const you = (name, text) => i => `${name}${i >= 0 && names[i] === name ? ' (you)' : ''} ${text}`;
    const guest = pages[1], last = pages[pages.length - 1];

    await scenario('guest-focus', { title: "A guest's Focus", scale: 0.35, grade: 'default', lines: [you(names[1], 'used Focus')],
      cause: () => tapChip(guest, sleep), end: () => tapChip(guest, sleep) });
    if (want('guest-focus')) check(await guest.evaluate(() => { const c = window.__op2.ctx.contracts.chips; return c.meter < 0.9 && !c.focus; }), "The guest's Focus spent its own meter, as alone");
    for (const page of pages) await fillFocus(page);

    await scenario('host-focus', { title: "The host's Focus", scale: 0.35, grade: 'default', lines: [you(names[0], 'used Focus')],
      cause: () => tapChip(host, sleep), end: () => tapChip(host, sleep) });
    for (const page of pages) await fillFocus(page);

    await scenario('both', { title: "Two at once (the host's Focus and a guest's SLOWMO)", scale: 0.25, grade: 'slowmo',
      lines: [you(names[0], 'used Focus'), you(names[pages.length - 1], 'earned SLOWMO')],
      cause: async () => { const t = await tapChip(host, sleep); await grant(last, 'slowmo'); return t; },
      end: async () => { await last.evaluate(() => window.__op2.ctx.progression.perks.stop('slowmo')); return tapChip(host, sleep); } });
    for (const page of pages) await fillFocus(page);

    await scenario('perk', { title: "A guest's Time Warp", scale: 0.25, grade: 'slowmo', lines: [you(names[1], 'took Time Warp')],
      cause: () => grant(guest, 'timeWarp'), end: async () => { const t = await epoch(guest); await guest.evaluate(() => window.__op2.ctx.progression.perks.stop('timeWarp')); return t; } });

    // A boss's death: the host kills a Juggernaut. Its death runs 1.8 s of world time at 0.4x, then the world eases back.
    await scenario('boss', { title: "A boss's death", scale: 0.4, lines: [you(names[0], 'killed the JUGGERNAUT')],
      cause: async () => {
        const uid = await host.evaluate(() => {
          const { ctx } = window.__op2, V = ctx.player.position.constructor, s = ctx.world.playerSpawns[0];
          // Ahead and well to the side: out of the lane the players walk for the measure.
          const p = s.position.clone().add(new V(-Math.sin(s.yaw) * 22 + Math.cos(s.yaw) * 12, 0, -Math.cos(s.yaw) * 22 - Math.sin(s.yaw) * 12)); const snapped = p.clone();
          if (ctx.world.nav.nearest?.(p, 6, snapped)) p.copy(snapped);
          const boss = ctx.enemies.spawn('juggernaut', p);
          boss.behaviours = []; boss.attacks = []; boss.mode = 'hold';
          return boss.uid;
        });
        for (const page of party.guests) await page.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 15000 });
        await sleep(600);
        return host.evaluate(uid => {
          const { ctx } = window.__op2, boss = ctx.enemies.alive.find(e => e.uid === uid), V = ctx.player.position.constructor;
          boss.immune = 0; boss.entering = 0;
          for (let i = 0; i < 400 && boss.alive && !(boss.dying > 0); i++) {
            ctx.enemies.applyDamage(boss, { amount: 900, type: 'bullet', source: 'smg', point: boss.center.clone(), dir: new V(0, 0, -1), force: 1 });
          }
          return performance.timeOrigin + performance.now();
        }, uid);
      },
      // It ends by itself when the boss has finished dying; the measure of "back to full speed" starts when the host lets go.
      end: async () => { await host.waitForFunction(() => window.__op2.ctx.coop.world.slows.length === 0, null, { timeout: 12000 }); return epoch(host); } });

    if (want('dropped')) {
      // --- a dropped end: the host's word is lost, and each guest lets go by its own deadline ---------------------------------
      progress('a dropped end (host to guests)');
      await healthy(party.pages);
      await fillBudget(host); for (const page of pages) await fillFocus(page);
      await host.evaluate(() => {
        const w = window.__op2.ctx.coop.world.w, send = w.send.bind(w);
        window.__lose = false; window.__lost = 0;
        w.send = (event, to) => { if (window.__lose && event.t === 'slowstate') { window.__lost++; return; } send(event, to); };
      });
      for (const page of pages) await watch(page);
      await tapChip(host, sleep);
      await allSlow(pages);
      check((await Promise.all(pages.map(read))).every(s => s.slowmo < 0.5), 'Dropped end: the world is slow on every screen first');
      const left = await guest.evaluate(() => window.__op2.ctx.coop.world.slows[0].until - performance.now());
      await host.evaluate(() => { window.__lose = true; });
      const dropAt = await tapChip(host, sleep);
      for (const page of party.guests) await page.waitForFunction(() => window.__tw.fullAt > 0, null, { timeout: 15000 });
      const dropped = await Promise.all(party.guests.map(watched));
      const lost = await host.evaluate(() => { window.__lose = false; return window.__lost; });
      out.scenarios['dropped-end'] = { lost, leftMs: Math.round(left), fullMs: dropped.map(s => Math.round(s.fullAt - dropAt)) };
      check(lost >= 1, "Dropped end: the host's end (and every repeat after it) was lost", lost);
      // The entry's own deadline, half a second of grace, the blend out, and slack for a loaded page.
      check(dropped.every(s => s.fullAt - dropAt <= left + 500 + 500 + 1200), 'Dropped end: every guest is back at full speed by its own deadline, without a word from the host', out.scenarios['dropped-end']);
      check(dropped.every(s => s.fullAt - dropAt >= 1000), 'Dropped end: (control) the guests did not hear the end: they ran on past it', out.scenarios['dropped-end'].fullMs);
      await sleep(2300);
      check((await Promise.all(pages.map(read))).every(s => s.slowmo === 1 && s.slows.length === 0), "Dropped end: the host's next state agrees: nothing is slow");

      progress('a dropped end (guest to host)');
      await healthy(party.pages);
      await fillBudget(host); for (const page of pages) await fillFocus(page);
      await guest.evaluate(() => {
        const w = window.__op2.ctx.coop.world.w, send = w.send.bind(w);
        w.send = (event, to) => { if (event.t === 'slow' && event.on === false && !window.__lostOff) { window.__lostOff = 1; return; } send(event, to); };
      });
      for (const page of pages) await watch(page);
      const onAt = await tapChip(guest, sleep);
      await allSlow(pages);
      const offAt = await tapChip(guest, sleep);
      for (const page of pages) await page.waitForFunction(() => window.__tw.fullAt > 0, null, { timeout: 15000 });
      const capped = await Promise.all(pages.map(watched));
      out.scenarios['dropped-off'] = { lost: await guest.evaluate(() => window.__lostOff), sinceOnMs: capped.map(s => Math.round(s.fullAt - onAt)), sinceOffMs: capped.map(s => Math.round(s.fullAt - offAt)) };
      check(out.scenarios['dropped-off'].lost === 1, "Dropped off: the guest's \"I let go\" never reached the host");
      // The guest says it again 0.7 s later (when the host's state still lists it); then the host's answer and the blend out.
      check(capped.every(s => s.fullAt - offAt <= 700 + 250 + FULL_MS + (s.stallFull - s.stallNotice)), 'Dropped off: the guest says it again, and every screen is back at full speed about a second later (not at the 4.5 s cap)', out.scenarios['dropped-off']);
      check(capped[0].fullAt - offAt >= 600, 'Dropped off: (control) the host did not hear the first one: it ran on past it', out.scenarios['dropped-off'].sinceOffMs);
      await sleep(600);
    }

    if (want('late')) {
      // --- a late joiner arrives while the world is slow -----------------------------------------------------------------------
      progress('a late joiner mid-slow-mo');
      // The join takes longer than any one slow-mo, so the host keeps a Time Warp up for the length of it (the budget topped up).
      await host.evaluate(() => {
        const { ctx } = window.__op2;
        window.__keepSlow = setInterval(() => { ctx.coop.world.slowBoard.bank = 12; ctx.progression.grant('timeWarp'); }, 1000);
        ctx.progression.grant('timeWarp');
      });
      const late = await openGuest(party, { name: 'LATE-ONE', late: true });
      await inMatch([late], party.mode.contract);
      // The world has begun on the late page: from here, how long until it is slow and says who?
      const arrived = await late.evaluate(async () => {
        const { ctx } = window.__op2, w = ctx.coop.world, t0 = performance.now();
        while (performance.now() - t0 < 3000 && !(w.slows.length > 0 && w.slowNotice.lines.length > 0)) await new Promise(r => setTimeout(r, 10));
        const noticeMs = performance.now() - t0;
        await new Promise(r => setTimeout(r, 500));
        return { noticeMs, slowmo: ctx.time.slowmo, lines: w.slowNotice.lines, slows: w.slows.length };
      });
      out.scenarios.late = arrived;
      check(arrived.slows === 1 && arrived.lines[0] === `${names[0]} took Time Warp`, 'Late joiner: its screen says who slowed the world', arrived);
      check(arrived.noticeMs <= 600, 'Late joiner: the notice is up within 600 ms of its world being up (the state repeats four times a second)', arrived.noticeMs);
      check(Math.abs(arrived.slowmo - 0.25) < 0.03, 'Late joiner: its world runs at the same 0.25x as everyone', arrived.slowmo);
      if (shots) await shot(late, 'late-joiner');
      await host.evaluate(() => { clearInterval(window.__keepSlow); window.__op2.ctx.progression.perks.stop('timeWarp'); });
      await late.waitForFunction(() => window.__op2.ctx.time.slowmo === 1 && window.__op2.ctx.coop.world.slows.length === 0, null, { timeout: 8000 });
      check(true, 'Late joiner: back at full speed with everyone when it ends');
      await sleep(500);
    }

    if (want('budget')) {
      // --- the team's budget: 12 s in a row, then full speed until 3 s are back ------------------------------------------------
      progress("the team's budget (12 s in a row)");
      await healthy(party.pages);
      await fillBudget(host);
      const all = party.pages;
      for (const page of all) await watch(page);
      const chainAt = await epoch(host);
      for (const page of all) await page.evaluate(() => {
        const { ctx } = window.__op2;
        window.__chain = setInterval(() => ctx.progression.grant('timeWarp'), 700);
        ctx.progression.grant('timeWarp');
      });
      await Promise.all(all.map(page => page.waitForFunction(() => window.__tw.fullAt > 0, null, { timeout: 30000 }))).catch(async error => {
        out.stuck = await Promise.all(all.map(page => page.evaluate(() => {
          const { ctx, game } = window.__op2, w = ctx.coop.world;
          return { state: game.state, fps: window.__op2.stats().fps, slowmo: ctx.time.slowmo, slows: w.slows.map(e => [e.key, Math.round(e.until - performance.now())]),
            board: { list: w.slowBoard.list.map(e => e.key), bank: w.slowBoard.bank, locked: w.slowBoard.locked }, effects: ctx.progression.effects.map(e => [e.id, +e.remaining.toFixed(1)]),
            held: w.slowHeld('timeWarp'), callout: document.querySelector('.callout-name')?.textContent ?? '', tw: { ...window.__tw, timer: 0 } };
        })));
        throw new Error(`Budget: a screen never came back to full speed :: ${JSON.stringify(out.stuck)} :: ${error.message}`);
      });
      const chain = await Promise.all(all.map(watched));
      const locked = await host.evaluate(() => ({ locked: window.__op2.ctx.coop.world.slowBoard.locked, lockMs: window.__op2.ctx.coop.world.slowBoard.lockMs }));
      await sleep(800);
      const calls = await Promise.all(all.map(read));
      for (const page of all) await page.evaluate(() => { clearInterval(window.__chain); window.__op2.ctx.progression.perks.stop('timeWarp'); });
      out.scenarios.budget = { slowForMs: chain.map(s => Math.round(s.fullAt - chainAt)), locked, callouts: calls.map(s => s.callout) };
      // 12 s of budget, then the half-second blend out.
      check(chain.every(s => s.fullAt - chainAt > 11500 && s.fullAt - chainAt < 12000 + FULL_MS), 'Budget: with every player chaining Time Warps the world is slow for 12 s, then at full speed on every screen', out.scenarios.budget.slowForMs);
      check(locked.locked, 'Budget: the host holds the world at full speed until 3 s are back', locked);
      check(calls.every(s => /^TEAM SLOW-MO SPENT · \d S$/.test(s.callout)), 'Budget: every player who asked is told the team\'s slow-mo is spent, and for how long', out.scenarios.budget.callouts);
      await sleep(3300);
      for (const page of all) { await fillFocus(page); await watch(page); }
      await tapChip(guest, sleep);
      await allSlow(all);
      check((await Promise.all(all.map(read))).every(s => s.slowmo < 0.5 && s.slows.length === 1), 'Budget: three seconds later a Focus is granted again');
      // Off, whatever state it is in by now (only three seconds were back, and the host may have ended it already).
      await guest.evaluate(() => window.__op2.ctx.contracts.chips.setFocus(false));
      await quiet(all);
    }

    if (want('down')) {
      // --- a downed player is refused ----------------------------------------------------------------------------------------
      const all = party.pages;
      progress('a downed player is refused');
      await healthy(party.pages);
      await fillBudget(host); for (const page of all) await fillFocus(page);
      await quiet(all);
      await guest.evaluate(() => { const { ctx } = window.__op2; ctx.player.modifiers.invulnerable = false; (w => { w.receivingDamage = true; ctx.player.takeDamage({ amount: 500, type: 'bullet', source: 'trooper' }); w.receivingDamage = false; })(ctx.coop.world); });
      const seat = (await read(guest)).me;
      await host.waitForFunction(seat => window.__op2.ctx.coop.world.team.life([...window.__op2.ctx.coop.lobby.players].find(p => p.slot === seat).id).state !== 'up', seat, { timeout: 15000 });
      for (const page of all) await watch(page);
      // Straight to the clock, past the chip's own "alive" check: the request a downed player's game could still make.
      await guest.evaluate(() => window.__op2.ctx.time.pushScale('focus', 0.35, 0.12, 0.25));
      await sleep(NOTICE_MS + 400);
      const down = await Promise.all(all.map(read)), downSeen = await Promise.all(all.map(watched));
      out.scenarios.down = { callout: down[1].callout, min: downSeen.map(s => s.min) };
      check(down.every(s => s.slows.length === 0) && downSeen.every(s => s.min === 1), 'Downed: a downed player cannot slow the world: no screen slowed', out.scenarios.down);
      check(down[1].callout === 'NO SLOW-MO WHILE DOWN', 'Downed: the player is told why', down[1].callout);
      // And the host says no to a request that reaches it anyway (a guest whose own screen has not caught up with being down).
      const hostNo = await host.evaluate(seat => {
        const w = window.__op2.ctx.coop.world;
        return { refused: w.slowBoard.request(performance.now(), seat, 'focus', w.team.life([...window.__op2.ctx.coop.lobby.players].find(p => p.slot === seat).id).state === 'up'), list: w.slowBoard.list.length };
      }, seat);
      check(hostNo.refused === 'down' && hostNo.list === 0, "Downed: the host's own rule refuses it too", hostNo);
    }

    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const page of party?.guests ?? []) await page.close().catch(() => {});
  }
}
