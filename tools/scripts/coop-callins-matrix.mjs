// Co-op proof: every call-in, called by any player, plays on every screen as it does for the caller.
//
// The host calls each call-in while the guests watch; then a guest calls each one while the host and the other guest watch.
// For every call, on every watcher:
//   - a copy of the same call-in exists (the aircraft, the beam, the pod);
//   - it moves along the caller's path: each point the copy was drawn at is within a tolerance of the track the caller's own drew;
//   - it fires: the copy drew rounds, tracers or shells where the caller's fires;
//   - the blasts arrive: every explosion the caller's drew has one on the watcher at the same spot;
//   - the copy hurt nothing: the watcher made no kill of its own.
// And the enemies it killed are the caller's: the caller's kill count goes up, nobody else's does.
// Two screenshots per call, the caller's view and a watcher's at the same moment, 1440x900 at dpr 2.
//
//   OP2_NO_HMR=1 npx vite --port 5370 --strictPort
//   node tools/shot.mjs --port 5370 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 1500 \
//     --script tools/scripts/coop-callins-matrix.mjs --out tools/out/coop/call-ins/matrix.png
//
//   CALLINS=airstrike,nuke       only these (default: all; `ac130seat` is the gunship with the caller on the guns,
//                                `frame` boards and walks the Frame)
//   CALLINS_SIM=lag:120,jitter:40,loss:0.05   the game's network simulator on every page
//   CALLINS_PLAYERS=3            2 to 4 (3: a guest's call is watched by the host and by another guest)
//   CALLINS_WHO=host,guest       which caller phases to run
//   COOP_NET=rtc                 real WebRTC instead of the loopback transport
//   CALLINS_TAG=clean            names the evidence file and the screenshots
import { writeFileSync } from 'node:fs';
import { ahead, calm, give, kit, live, shootLoop, startParty, state, stopShooting } from './coop-kit.mjs';

const ALL = ['airstrike', 'warthog', 'orbital', 'blackSun', 'nuke', 'sentry', 'ac130', 'ac130seat', 'attackChopper', 'doorGunner', 'frame'];
const IDS = (process.env.CALLINS ?? ALL.join(',')).split(',').filter(Boolean);
const SIM = process.env.CALLINS_SIM ?? '';
const PLAYERS = Number(process.env.CALLINS_PLAYERS ?? 3);
const WHO = (process.env.CALLINS_WHO ?? 'host,guest').split(',');
const TAG = process.env.CALLINS_TAG ?? (SIM ? 'lag' : 'clean');

/**
 * Per call-in: how long it is watched (`run`, seconds), when the two screenshots are taken (`shotAt`), how far a copy's path
 * may stray from the caller's (`path`, metres), whether its blasts are matched (`blasts`, metres) and what must have been
 * drawn by the copy (`fires`: a counter of the watcher's mirror that must have grown). `kills`: enemies stood on the mark
 * must die to the caller. `end`: shot down by the caller's own game at the end of the watch (the rest of its sortie is
 * minutes long), which also proves the shoot-down reaches every screen.
 */
const PLAN = {
  airstrike: { run: 9, shotAt: 4.6, path: 0.1, blasts: 3, fires: 'projectiles', kills: true },
  warthog: { run: 10, shotAt: 4.3, path: 6, blasts: 2, fires: 'projectiles', kills: true },
  orbital: { run: 9.5, shotAt: 4, path: 4, blasts: 4, fires: 'blasts', kills: true, steer: true },
  blackSun: { run: 9, shotAt: 3.5, path: 0.1, blasts: 2, fires: 'blasts', kills: true },
  nuke: { run: 14, shotAt: 9.6, path: 0.1, kills: true },
  sentry: { run: 9, shotAt: 7, path: 1.5, blasts: 2, fires: 'blasts', enemy: 'drone', end: true },
  ac130: { run: 34, shotAt: 26, path: 8, blasts: 2.5, fires: 'news', kills: true, end: true, crash: 16, far: true },
  ac130seat: { id: 'ac130', run: 30, shotAt: 22, path: 8, blasts: 2.5, fires: 'news', kills: true, end: true, crash: 16, seat: true, far: true },
  attackChopper: { run: 26, shotAt: 14, path: 9, fires: 'projectiles', kills: true, end: true, crash: 12, far: true },
  doorGunner: { run: 26, shotAt: 15, path: 9, fires: 'rays', kills: true, end: true, crash: 12, far: true },
  frame: { run: 22, shotAt: 17, path: 4, fires: 'rays', kills: true, board: true },
};

/** Runs in every page once: counts what is drawn, and records where each strike and each copy is, every frame. */
function recorder() {
  if (window.__rec) return;
  const { ctx } = window.__op2;
  const rec = window.__rec = { on: false, blasts: [], tracers: 0, flashes: 0, tracks: {}, kills: [] };
  const { fx } = ctx;
  const explosion = fx.explosion.bind(fx);
  fx.explosion = (at, options) => { if (rec.on) rec.blasts.push([at.x, at.y, at.z, options?.radius ?? 0]); return explosion(at, options); };
  const tracer = fx.tracer.bind(fx);
  fx.tracer = (...args) => { if (rec.on) rec.tracers++; return tracer(...args); };
  const flash = fx.muzzleFlash.bind(fx);
  fx.muzzleFlash = (...args) => { if (rec.on) rec.flashes++; return flash(...args); };
  // Every kill this page saw, with what did it and whether it is credited to this player.
  ctx.events.on('enemy:killed', e => { if (rec.on) rec.kills.push([e.damage.source, !ctx.coop.world.notMine(e.enemy)]); });
  const link = ctx.progression.callinLink;
  const push = (key, p) => { if (Number.isFinite(p.x)) (rec.tracks[key] ??= []).push([p.x, p.y, p.z]); };
  const tick = () => {
    if (rec.on) {
      const own = link.running.at(-1);
      if (own) push('own', own.where);
      for (let slot = 0; slot < 4; slot++) for (const copy of link.mirror.copies(slot)) push(`${slot}:${copy.n}`, copy.strike.where);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** What a call-in's damage is called (net/authority.ts). */
const CALLIN_SOURCE = /^(airstrike|warthog|chopper|door_gun|orbital|ac130|black_sun|nuke|sentry|drop_pod|frame)/;

const begin = page => page.evaluate(() => {
  const rec = window.__rec; const { ctx } = window.__op2;
  rec.blasts.length = 0; rec.tracers = rec.flashes = 0; rec.kills = []; rec.tracks = {}; rec.on = true;
  const world = ctx.coop.world;
  world.callins.measure = true;
  for (const key of Object.keys(world.callins.cost)) delete world.callins.cost[key];
  return { mirror: { ...ctx.progression.callinLink.mirror.stats }, kills: ctx.progression.kills, slot: ctx.coop.lobby.me.slot, clock: ctx.time.realElapsed,
    books: JSON.parse(JSON.stringify(world.claimBooks)),
    foes: ctx.enemies.alive.map(e => [e.uid, +e.position.x.toFixed(1), +e.position.y.toFixed(1), +e.position.z.toFixed(1), Math.round(e.health), Math.round(e.owed ?? 0)]) };
});

const read = page => page.evaluate(() => {
  const rec = window.__rec; const { ctx } = window.__op2;
  const link = ctx.progression.callinLink;
  const copies = [];
  for (let slot = 0; slot < 4; slot++) for (const copy of link.mirror.copies(slot)) copies.push({ slot, n: copy.n, id: copy.id, where: copy.strike.where.toArray() });
  return { mirror: { ...link.mirror.stats }, kills: ctx.progression.kills, blasts: rec.blasts, tracers: rec.tracers, flashes: rec.flashes, killed: rec.kills,
    tracks: rec.tracks, copies, running: link.running.length, cost: JSON.parse(JSON.stringify(ctx.coop.world.callins.cost)), enemies: ctx.enemies.alive.length,
    accepted: ctx.coop.world.stats.accepted, rejected: ctx.coop.world.stats.rejected, dropped: ctx.coop.world.boomsDropped, fps: window.__op2.stats().fps,
    // The claims' books (what this page sent, what the host received and refused), and every enemy as this page has it.
    books: JSON.parse(JSON.stringify(ctx.coop.world.claimBooks)),
    foes: ctx.enemies.alive.map(e => [e.uid, +e.position.x.toFixed(1), +e.position.y.toFixed(1), +e.position.z.toFixed(1), Math.round(e.health), Math.round(e.owed ?? 0)]) };
});

/** Metres from `p` to the nearest point of the polyline `track`. */
function offTrack(p, track) {
  let best = Infinity;
  for (let i = 0; i < track.length; i++) {
    const a = track[i], b = track[Math.min(i + 1, track.length - 1)];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const len = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = len > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len)) : 0;
    best = Math.min(best, Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t));
  }
  return best;
}

/** How far a copy strayed from the caller's own path: the worst point, and the 95th centile. */
function stray(copy, own) {
  if (!copy?.length || !own?.length) return { worst: Infinity, p95: Infinity, points: copy?.length ?? 0 };
  const off = copy.map(p => offTrack(p, own)).sort((a, b) => a - b);
  return { worst: +off.at(-1).toFixed(2), p95: +off[Math.floor(off.length * 0.95)].toFixed(2), points: copy.length, length: +own.reduce((s, p, i) => s + (i ? Math.hypot(p[0] - own[i - 1][0], p[1] - own[i - 1][1], p[2] - own[i - 1][2]) : 0), 0).toFixed(1) };
}

/** Of the caller's blasts, how many have one of the watcher's within `tol` metres. */
function matched(mine, theirs, tol) {
  let hit = 0, worst = 0;
  for (const a of mine) {
    let best = Infinity;
    for (const b of theirs) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    if (best <= tol) hit++;
    if (Number.isFinite(best)) worst = Math.max(worst, best);
  }
  return { of: mine.length, matched: hit, worst: +worst.toFixed(2), theirs: theirs.length };
}

/** Puts a player at `at` looking at `target`. */
const look = (page, at, target) => page.evaluate(([at, target]) => {
  const { ctx } = window.__op2; const V = ctx.player.position.constructor;
  if (!ctx.player.parked) ctx.player.teleport(new V(...at));
  const d = new V(...target).sub(ctx.player.eye);
  ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(d.y, Math.hypot(d.x, d.z))));
  ctx.player.velocity.set(0, 0, 0);
}, [at, target]);

/** Turns a player (without moving them) to face `target`. */
const face = (page, target) => page.evaluate(target => {
  const { ctx } = window.__op2; const V = ctx.player.position.constructor;
  if (ctx.player.parked) return;
  const d = new V(...target).sub(ctx.player.eye);
  ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(d.y, Math.hypot(d.x, d.z))));
}, target);

export default async function (host, { sleep, outDir }) {
  const out = { tag: TAG, sim: SIM || 'off', players: PLAYERS, transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [], calls: [] };
  const { check: hard, progress } = kit(outDir, `callins-${TAG}`, out, sleep);
  // A matrix: a failed check is written down and the run goes on, so one run says everything that is wrong. It fails at the end.
  out.failed = [];
  const check = (condition, message, detail) => {
    if (condition) out.checks.push(message);
    else { out.failed.push({ message, detail }); progress(`FAILED: ${message} :: ${JSON.stringify(detail)?.slice(0, 400)}`); }
  };
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: PLAYERS, net: SIM || undefined, out, progress, sleep });
    await live(party, { enemies: 1 });
    const { pages } = party;
    for (const page of pages) await page.evaluate(recorder);
    // The wave is stopped for the whole proof: only what the proof stands on the mark is on the map.
    await host.evaluate(() => { const { waves } = window.__op2.ctx; waves.update = () => {}; });
    await calm(host);
    const spawnAt = (await ahead(host, 0)).at, yaw = (await ahead(host, 0)).yaw;
    // The mark: open sky over it (a strike from above must reach it), level with the spawn, in plain sight of it, 25 to 45 m off.
    const mark = await host.evaluate(([from, yaw]) => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const WORLD = 1, up = new V(0, 1, 0), eye = new V(from[0], from[1] + 1.6, from[2]);
      let best = null, bestScore = Infinity;
      for (let d = 18; d <= 58; d += 4) for (let a = -1.5; a <= 1.5; a += 0.1) {
        const p = new V(from[0] - Math.sin(yaw + a) * d, from[1], from[2] - Math.cos(yaw + a) * d);
        const snapped = p.clone();
        if (!ctx.world.nav.nearest?.(p, 3, snapped) || Math.abs(snapped.y - from[1]) > 0.6) continue;
        let open = true;
        for (const [dx, dz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) {
          if (ctx.physics.raycast(new V(snapped.x + dx, snapped.y + 0.5, snapped.z + dz), up, 140, WORLD)) { open = false; break; }
        }
        if (!open) continue;
        // Level ground all round, 7 m out. The targets stand in a ring on the mark and a strike's rounds land on the real
        // ground: on a walkway over a drop (where this mark once fell) the men float over the pit, the Warthog's shells land
        // 6 to 8 m under them, and whether it kills anyone is the luck of its scatter. That was the "Warthog that dealt no
        // damage": no claim was lost, nothing was in reach of a blast on any screen.
        let level = true;
        const down = new V(0, -1, 0);
        for (let dx = -7; dx <= 7 && level; dx += 3.5) for (let dz = -7; dz <= 7; dz += 3.5) {
          const floor = ctx.physics.raycast(new V(snapped.x + dx, snapped.y + 12, snapped.z + dz), down, 40, WORLD);
          if (!floor || Math.abs(snapped.y + 12 - floor.distance - snapped.y) > 0.7) { level = false; break; }
        }
        if (!level) continue;
        const to = new V(snapped.x, snapped.y + 1.2, snapped.z).sub(eye); const far = to.length();
        if (ctx.physics.raycast(eye, to.divideScalar(far), far - 0.5, WORLD)) continue;
        const score = Math.abs(a) * 10 + Math.abs(d - 34);
        if (score < bestScore) { bestScore = score; best = snapped.toArray(); }
      }
      return best;
    }, [spawnAt, yaw]);
    if (!mark) throw new Error('No open, level ground in sight of the spawn to put the mark on');
    out.mark = mark;
    const side = [Math.cos(yaw), 0, -Math.sin(yaw)];
    // Everyone stands in a row at the spawn, two metres apart, looking at the mark.
    const stand = i => [spawnAt[0] + side[0] * (i - (pages.length - 1) / 2) * 2.5, spawnAt[1], spawnAt[2] + side[2] * (i - (pages.length - 1) / 2) * 2.5];
    const eyes = async target => { for (let i = 0; i < pages.length; i++) await look(pages[i], stand(i), target); };

    for (const who of WHO) {
      const callerIndex = who === 'host' ? 0 : 1;
      const caller = pages[callerIndex];
      const watchers = pages.filter(p => p !== caller);
      for (const key of IDS) {
        const plan = PLAN[key];
        if (!plan) throw new Error(`Unknown call-in "${key}". Known: ${ALL.join(', ')}`);
        const id = plan.id ?? key;
        const name = `${who}-${key}`;
        progress(`${name}: setting up`);
        await calm(host);
        await eyes([mark[0], mark[1] + 1, mark[2]]);
        // What it is to kill, standing still on the mark (the host's world: the guests get copies of them).
        const targets = await host.evaluate(([at, kind]) => {
          const { ctx } = window.__op2, V = ctx.player.position.constructor;
          const uids = [];
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const p = new V(at[0] + Math.cos(a) * 2.2, at[1] + (kind === 'drone' ? 9 : 0), at[2] + Math.sin(a) * 2.2);
            const enemy = ctx.enemies.spawn(kind, p);
            if (!enemy) continue;
            enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true;
            uids.push(enemy.uid);
          }
          return uids;
        }, [mark, plan.enemy ?? 'husk']);
        for (const page of pages) await page.waitForFunction(n => window.__op2.ctx.enemies.alive.length >= n, targets.length, { timeout: 20000 });
        await sleep(400);
        const before = await Promise.all(pages.map(begin));
        const callerSlot = before[callerIndex].slot;

        // Timed on the caller's own game clock, the one strikes run on, so a slow machine stretches the proof and does not break it.
        const clock = () => caller.evaluate(() => window.__op2.ctx.time.realElapsed);
        const started = await clock();
        await caller.evaluate(([id, at, seat]) => {
          const { ctx } = window.__op2, V = ctx.player.position.constructor;
          const link = ctx.progression.callinLink;
          link.callAt(id, new V(...at), new V(1, 0, 0.35), !seat);
        }, [id, mark, plan.seat === true]);
        const elapsed = async () => await clock() - started;
        const until = async seconds => { for (let i = 0; i < 3000 && await elapsed() < seconds; i++) await sleep(80); };

        // The Orbital Lance is steered: the caller walks its aim along the ground, and the beam must follow on every screen.
        const safely = (what, run) => run().catch(error => { check(false, `${name}: ${what}`, String(error).slice(0, 300)); });
        const steering = plan.steer ? safely('the caller steers the beam', async () => {
          for (let t = await elapsed(); t < 8; t = await elapsed()) {
            await face(caller, [mark[0] + Math.sin(t * 0.9) * 3.5, mark[1], mark[2] + Math.sin(t * 0.6) * 2.5]);
            await sleep(60);
          }
        }) : null;
        // The gunship with the caller on the guns: the sight is put on the mark and the trigger held, gun by gun.
        const gunning = plan.seat ? safely('the caller takes the guns', async () => {
          await caller.waitForFunction(() => window.__op2.ctx.progression.callinLink.running.at(-1)?.seat?.stage === 'seated', null, { timeout: 20000 });
          const aim = (gun, ms) => caller.evaluate(async ([at, gun, ms]) => {
            const { ctx } = window.__op2, V = ctx.player.position.constructor;
            const strike = ctx.progression.callinLink.running.at(-1);
            // The sensor holds a spot on the ground (a dead lock): the spot is put on the men, as the mouse would put it.
            const d = new V(...at).sub(strike.seat.view.position);
            strike.seat.yaw = Math.atan2(-d.x, -d.z); strike.seat.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
            strike.seat.spot.set(...at); strike.seat.point.set(...at); strike.seat.spotted = strike.seat.locked = true;
            strike.battery.selected = gun;
            ctx.input.simulate('fire', true);
            await new Promise(r => setTimeout(r, ms));
            ctx.input.simulate('fire', false);
          }, [[mark[0] + 1.1, mark[1], mark[2]], gun, ms]);
          await aim('g25', 2500); await aim('g40', 2200); await aim('g105', 400); await sleep(300); await aim('bomb', 200);
        }) : null;
        // The Frame: the caller boards it where it landed, walks it forward and fires both arms at the mark.
        const piloting = plan.board ? safely('the caller boards and drives the Frame', async () => {
          await caller.waitForFunction(() => window.__op2.ctx.progression.callinLink.running.at(-1)?.phase === 'waiting', null, { timeout: 20000 });
          await caller.evaluate(() => {
            const { ctx } = window.__op2;
            const drop = ctx.progression.callinLink.running.at(-1);
            ctx.player.teleport(drop.feet.clone().add(new ctx.player.position.constructor(1.5, 0, 0)));
          });
          await sleep(250);
          await caller.evaluate(() => window.__op2.ctx.input.simulate('interact', true));
          await sleep(150);
          await caller.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
          await caller.waitForFunction(() => window.__op2.ctx.progression.frame.occupied, null, { timeout: 8000 });
          const keys = (list, down) => caller.evaluate(([list, down]) => { for (const k of list) window.__op2.ctx.input.simulate(k, down); }, [list, down]);
          const sight = () => caller.evaluate(at => {
            const { ctx } = window.__op2, V = ctx.player.position.constructor;
            const seat = ctx.progression.callinLink.seats.seat;
            if (!seat) return;
            const d = new V(...at).sub(seat.view.position);
            seat.yaw = Math.atan2(-d.x, -d.z); seat.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
          }, [mark[0] + 2.2, mark[1] + 1.1, mark[2]]);
          await keys(['forward'], true);
          for (let i = 0; i < 20; i++) { await sight(); await sleep(100); }
          await keys(['forward'], false);
          await keys(['fire', 'aim'], true);
          for (let i = 0; i < 40; i++) { await sight(); await sleep(100); }
          await keys(['fire', 'aim'], false);
          await keys(['slide'], true); await sleep(80); await keys(['slide'], false);
        }) : null;

        // The two screenshots, caller's and a watcher's, at the same moment, looking at where it is.
        await until(plan.shotAt);
        const where = await caller.evaluate(() => window.__op2.ctx.progression.callinLink.running.at(-1)?.where.toArray() ?? null);
        const focus = plan.far && where ? where : [mark[0], mark[1] + (key === 'nuke' ? 30 : 2), mark[2]];
        if (!plan.board) for (const page of pages) await face(page, focus);
        else for (const page of watchers) await face(page, where ?? focus);
        await sleep(120);
        const paths = [`${outDir}/callins-${TAG}-${name}-caller.png`, `${outDir}/callins-${TAG}-${name}-watcher.png`];
        await Promise.all([caller.screenshot({ path: paths[0], timeout: 120000 }), watchers[0].screenshot({ path: paths[1], timeout: 120000 })]);
        out.screenshots.push(...paths);

        await steering; await gunning; await piloting;
        await until(plan.run);
        // The copies run a network's lag behind the caller's, and on a busy machine a page can fall behind the others: every
        // watcher is given the same seconds of its own game clock before what it drew is read.
        for (const page of watchers) {
          const from = before[pages.indexOf(page)].clock;
          await page.waitForFunction(([from, seconds]) => window.__op2.ctx.time.realElapsed - from >= seconds, [from, plan.run + 0.4], { timeout: 240000 });
        }
        const mid = await Promise.all(pages.map(read));
        if (plan.end) {
          // The Commander's missile, as the caller's own game takes it.
          await caller.evaluate(id => window.__op2.ctx.progression.callinLink.shootDown(id), id);
          await until(plan.run + (plan.crash ?? 1.5));
          for (const page of watchers) {
            const from = before[pages.indexOf(page)].clock;
            await page.waitForFunction(([from, seconds]) => window.__op2.ctx.time.realElapsed - from >= seconds, [from, plan.run + (plan.crash ?? 1.5)], { timeout: 240000 });
          }
        }
        if (plan.board) {
          await caller.evaluate(() => window.__op2.ctx.progression.frame.leave());
          await until((await elapsed()) + 1.5);
          for (const page of watchers) {
            const from = await page.evaluate(() => window.__op2.ctx.time.realElapsed);
            await page.waitForFunction(from => window.__op2.ctx.time.realElapsed - from >= 1.2, from, { timeout: 120000 });
          }
        }
        const after = await Promise.all(pages.map(read));
        for (const page of pages) await page.evaluate(() => { window.__rec.on = false; });
        // The nuke's cloud and ash stand for over a minute. Three pages of it on one graphics card would slow every call
        // after it, so the proof clears the sky once the nuke has been judged.
        if (id === 'nuke') for (const page of pages) await page.evaluate(() => window.__op2.ctx.progression.callinLink.aftermath.clear());

        // --- what every watcher saw -------------------------------------------------------------------------------
        const own = mid[callerIndex];
        const call = { name, id, caller: who, seconds: +(await elapsed()).toFixed(1), targets: targets.length, watchers: [], fps: after.map(a => a.fps) };
        out.calls.push(call);
        const ownTrack = after[callerIndex].tracks.own ?? [];
        for (const page of watchers) {
          const i = pages.indexOf(page);
          const key2 = Object.keys(after[i].tracks).filter(k => k.startsWith(`${callerSlot}:`)).at(-1);
          const copyTrack = key2 ? after[i].tracks[key2] : [];
          const grew = k => mid[i].mirror[k] - before[i].mirror[k];
          const path = stray(copyTrack, ownTrack);
          const blasts = plan.blasts ? matched(after[callerIndex].blasts, after[i].blasts, plan.blasts) : null;
          const w = { page: i === 0 ? 'host' : `guest${i}`, copy: grew('orders'), path, blasts, drew: { projectiles: grew('projectiles'), rays: grew('rays'), blasts: grew('blasts'), news: grew('news') },
            tracers: mid[i].tracers, flashes: mid[i].flashes, copiesLeft: after[i].copies.filter(c => c.slot === callerSlot).length,
            // Kills credited to this watcher while it watched. One whose source is the call-in's would be the copy dealing damage.
            // Any other (a man the caller set alight or left bleeding, who died later) is the kill-credit rules', not a copy's.
            ownKills: after[i].killed.filter(k => k[1]).map(k => k[0]), fps: after[i].fps };
          w.killsOfItsOwn = w.ownKills.filter(source => CALLIN_SOURCE.test(source)).length;
          call.watchers.push(w);
          check(w.copy >= 1, `${name}: a copy flies on ${w.page}`, w);
          check(path.points > 10 && path.p95 <= plan.path, `${name}: the copy on ${w.page} keeps to the caller's path (${path.p95} m at the 95th centile, ${plan.path} m allowed)`, path);
          if (plan.fires) check(w.drew[plan.fires] > 0, `${name}: the copy on ${w.page} fires (${plan.fires})`, w.drew);
          if (blasts) check(blasts.of > 0 && blasts.matched >= Math.ceil(blasts.of * 0.9), `${name}: the blasts arrive on ${w.page} (${blasts.matched} of ${blasts.of} within ${plan.blasts} m)`, blasts);
          check(w.killsOfItsOwn === 0, `${name}: the copy on ${w.page} killed nothing of its own`, w.ownKills);
          if (plan.end || plan.board) check(w.copiesLeft === 0 || key === 'ac130' || key === 'ac130seat' || key === 'attackChopper' || key === 'doorGunner',
            `${name}: it is gone from ${w.page} when the caller's is`, after[i].copies);
        }
        // --- whose kills -------------------------------------------------------------------------------------------
        const killed = after[callerIndex].kills - before[callerIndex].kills;
        call.killed = killed;
        call.left = after[0].enemies;
        call.cost = after[callerIndex].cost;
        call.bytes = Object.values(call.cost).reduce((s, c) => s + c.bytes, 0);
        call.messages = Object.values(call.cost).reduce((s, c) => s + c.orders + c.news, 0);
        call.claims = { accepted: after[0].accepted, rejected: after[0].rejected };
        // No honest claim is lost: what the caller sent arrived, and the host refused none of it.
        const sent = after[callerIndex].books.sent, was = before[callerIndex].books?.sent ?? { hit: 0, status: 0, vhit: 0 };
        call.books = { sent: { hit: sent.hit - was.hit, status: sent.status - was.status, vhit: sent.vhit - was.vhit }, host: after[0].books };
        check(after[0].books.refusedTotal === 0, `${name}: the host refused no claim (${after[0].books.refusedTotal})`, after[0].books.refusals.slice(-8));
        check(after[0].books.late.dropped === 0, `${name}: the host dropped no event for want of a body (${after[0].books.late.dropped})`, after[0].books.late);
        // A call-in that killed nothing: what the caller's screen had where, for the diagnosis.
        if (plan.kills && killed < 1) call.lost = { callerFoes: after[callerIndex].foes, hostFoes: after[0].foes, mark, callerMid: mid[callerIndex].foes,
          callerBefore: before[callerIndex].foes, hostBefore: before[0].foes, blasts: after[callerIndex].blasts.slice(0, 60), callerKills: after[callerIndex].killed };
        call.boomsDropped = after.map(a => a.dropped);
        if (plan.kills) check(killed >= 1, `${name}: the enemies it killed are the caller's (${killed} of ${targets.length})`, { killed, left: call.left, own: own.kills });
        progress(`${name}: claims sent ${JSON.stringify(call.books.sent)}, host received ${JSON.stringify(after[0].books.received)}, refused ${after[0].books.refusedTotal}, gone ${after[0].books.refused.gone ?? 0}`);
        progress(`${name}: done, ${killed} kills, ${call.bytes} bytes in ${call.messages} messages, path ${call.watchers.map(w => w.path.p95).join('/')} m`);
        // Let what is left of it leave before the next one.
        await sleep(1500);
      }
    }
    // --- a guest earns a streak, targets it with the real keys and uses it ---------------------------------------------
    if (process.env.CALLINS_STREAK !== '0' && pages.length > 1) {
      const guest = pages[1];
      progress('guest-streak: a guest earns the airstrike from its own combo, aims it and calls it with the keys');
      await calm(host);
      await eyes([mark[0], mark[1] + 1, mark[2]]);
      const near = [spawnAt[0] - Math.sin(yaw) * 12, spawnAt[1], spawnAt[2] - Math.cos(yaw) * 12];
      await host.evaluate(at => {
        const { ctx } = window.__op2, V = ctx.player.position.constructor;
        for (let i = 0; i < 14; i++) {
          const enemy = ctx.enemies.spawn('husk', new V(at[0] + ((i % 7) - 3) * 1.6, at[1], at[2] - Math.floor(i / 7) * 1.8));
          if (enemy) { enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true; }
        }
      }, near);
      await guest.waitForFunction(() => window.__op2.ctx.enemies.alive.length >= 10, null, { timeout: 20000 });
      const had = await guest.evaluate(() => ({ kills: window.__op2.ctx.progression.kills, held: [...window.__op2.ctx.progression.callIns] }));
      await give(guest, 'smg');
      await shootLoop(guest, { range: 40 });
      const earned = await guest.waitForFunction(() => window.__op2.ctx.progression.callIns.has('airstrike'), null, { timeout: 90000 }).then(() => true, () => false);
      await stopShooting(guest);
      const got = await guest.evaluate(() => ({ kills: window.__op2.ctx.progression.kills, combo: window.__op2.ctx.progression.combo, held: [...window.__op2.ctx.progression.callIns] }));
      out.streak = { had, got, earned };
      check(earned, 'guest-streak: a guest earns the airstrike from its own kills (combo 8)', out.streak);
      if (earned) {
        const before = await host.evaluate(() => window.__op2.ctx.progression.callinLink.mirror.stats.orders);
        // The real flow: the call-in key, the aim on the ground, a fresh click.
        await face(guest, [mark[0], mark[1], mark[2]]);
        const tap = async key => { await guest.evaluate(k => window.__op2.ctx.input.simulate(k, true), key); await sleep(120); await guest.evaluate(k => window.__op2.ctx.input.simulate(k, false), key); await sleep(200); };
        await tap('streak');
        const aiming = await guest.evaluate(() => window.__op2.ctx.progression.targeting);
        await face(guest, [mark[0], mark[1], mark[2]]);
        await tap('fire');
        const called = await host.waitForFunction(n => window.__op2.ctx.progression.callinLink.mirror.stats.orders > n, before, { timeout: 15000 }).then(() => true, () => false);
        out.streak.aiming = aiming; out.streak.called = called;
        check(aiming === 'airstrike', 'guest-streak: the key puts the guest into targeting', aiming);
        check(called, "guest-streak: the guest's click calls it, and the host flies a copy", out.streak);
        await sleep(9000);
      }
    }
    out.final = await Promise.all(pages.map(state));
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    hard(out.failed.length === 0, 'Every check passed', out.failed.map(f => f.message));
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/callins-${TAG}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
