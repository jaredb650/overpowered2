// Co-op proof: how well a guest's enemies follow the host's. Two pages, a crowd that never stops moving, and a recorder on
// each page. Every frame the guest notes where it drew each enemy; every frame the host notes where each one really was.
// Afterwards each drawn position is compared with where the host had that enemy at the moment being drawn.
//
//   OP2_NO_HMR=1 npx vite --port 5320 --strictPort          (your own port)
//   MOTION_ENEMIES=48 MOTION_NET=lag:80,jitter:30,loss:0.03 MOTION_HOST_FPS=20 MOTION_TAG=after \
//     node tools/shot.mjs --port 5320 --w 1280 --h 720 --wait 500 --timeout 300 \
//       --script tools/scripts/coop-motion-measure.mjs --out tools/out/coop/enemy-motion/measure.png
//
//   MOTION_ENEMIES   how many enemies (default 20; 48 is the cap)
//   MOTION_NET       the game's network simulator on both pages, e.g. lag:80,jitter:30,loss:0.03 (default: a clean network)
//   MOTION_HOST_FPS  cap the host's frame rate (default 0: none; 20 is the slow-host case)
//   MOTION_SECONDS   how long to record (default 20)
//   MOTION_TAG       a word for the evidence file's name (e.g. baseline, after)
//   MOTION_SHOTS     take this many screenshots of the guest's view, 120 ms apart, after recording
//   MOTION_STRICT    1: fail unless the motion is inside the limits at the end of this file
//
// What it reports (written to motion-<tag>-<enemies>e-<fps>-<net>.json beside --out, and returned):
//   delay       how far in the past the guest draws, ms: the one delay that fits the whole run best
//   error       metres between where an enemy is drawn and where the host had it that long ago: p50, p95, max
//   declared    the same against the moment the guest itself says it is drawing (its playhead), where it has one
//   yaw         the same for facing, degrees
//   stalls      frames an enemy stood still on the guest while its host twin moved (over 0.5 m/s), and how many times
//               a minute that began, for the whole crowd and per enemy
//   step        how far a frame's movement on the guest is from the host's over the same moment, metres: stepping and darts
//   bytes       what the host sent this guest a second: snapshots, and everything
import { writeFileSync } from 'node:fs';
import { calm, kit, live, netStats, resetNet, startParty } from './coop-kit.mjs';

/** One run's settings, from the environment unless the caller (coop-motion-matrix.mjs) gives its own. */
const fromEnv = () => ({ enemies: Number(process.env.MOTION_ENEMIES ?? 20), net: process.env.MOTION_NET ?? '', hostFps: Number(process.env.MOTION_HOST_FPS ?? 0),
  seconds: Number(process.env.MOTION_SECONDS ?? 20), tag: process.env.MOTION_TAG ?? 'run', shots: Number(process.env.MOTION_SHOTS ?? 0), strict: process.env.MOTION_STRICT === '1' });
/** With MOTION_STRICT: what the new netcode must hold on any of the networks this proof is run on. */
const LIMITS = { errorP50: 0.08, errorP95: 0.35, stallsPerEnemyMinute: 1, snapshotBytes: 30_000 };

/** In the host page before anything loads: its frames capped, the guests' left alone. */
function capFrames(fps) {
  if (!fps || window.__motionCap) return;
  window.__motionCap = true;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    const deadline = performance.now() + 1000 / fps - 8;
    const tick = now => (now >= deadline ? callback(now) : raf(tick));
    return raf(tick);
  };
}

/** In a page: the player runs in a wide circle for ever, so whatever is after them never arrives. */
function runInCircles(turn) {
  const { ctx } = window.__op2;
  ctx.input.simulate('forward', true);
  let last = performance.now();
  const step = now => {
    ctx.player.yaw += turn * Math.min(0.1, (now - last) / 1000);
    last = now;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** In a page: records every enemy every frame. Host: where it is. Guest: where it is drawn, and the playhead if it has one. */
function record(seconds) {
  const { ctx } = window.__op2;
  const world = ctx.coop.world;
  const hosting = ctx.coop.hosting;
  const fields = hosting ? 5 : 6;
  const data = new Float64Array(Math.ceil(seconds * 130) * (2 + 48 * fields));
  let at = 0, frames = 0;
  const rec = () => {
    if (at + 2 + 48 * fields > data.length) return;
    const head = at;
    data[at++] = performance.timeOrigin + performance.now();
    at++;
    let n = 0;
    if (hosting) {
      for (const e of ctx.enemies.alive) {
        if (n === 48) break;
        data[at++] = e.uid; data[at++] = e.position.x; data[at++] = e.position.y; data[at++] = e.position.z; data[at++] = e.yaw; n++;
      }
    } else {
      for (const [uid, r] of world.replicas) {
        if (n === 48) break;
        const e = r.enemy;
        data[at++] = uid; data[at++] = e.position.x; data[at++] = e.position.y; data[at++] = e.position.z; data[at++] = e.yaw;
        data[at++] = r.motion ? r.motion.playhead : NaN; n++;
      }
    }
    data[head + 1] = n;
    frames++;
  };
  // The host is read as its snapshot would read it (before the world's update sends); the guest as it has just been drawn.
  if (hosting) { const update = world.update.bind(world); world.update = () => { rec(); update(); }; }
  else { const update = world.updateGuests.bind(world); world.updateGuests = () => { update(); rec(); }; }
  window.__motion = { read: () => ({ origin: performance.timeOrigin, fields, frames, data: Array.from(data.subarray(0, at)) }) };
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN);
const spread = values => {
  const sorted = Float64Array.from(values).sort();
  const r = v => Math.round(v * 10000) / 10000;
  return { n: sorted.length, p50: r(quantile(sorted, 0.5)), p95: r(quantile(sorted, 0.95)), p99: r(quantile(sorted, 0.99)), max: r(sorted.at(-1) ?? NaN) };
};
const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The two recordings compared. */
export function analyse(hostRec, guestRec) {
  // The host's truth, per enemy, as tracks over wall time.
  const truth = new Map();
  for (let at = 0; at < hostRec.data.length;) {
    const t = hostRec.data[at++], n = hostRec.data[at++];
    for (let i = 0; i < n; i++, at += 5) {
      const uid = hostRec.data[at];
      let track = truth.get(uid);
      if (!track) truth.set(uid, track = { t: [], x: [], y: [], z: [], yaw: [] });
      track.t.push(t); track.x.push(hostRec.data[at + 1]); track.y.push(hostRec.data[at + 2]); track.z.push(hostRec.data[at + 3]); track.yaw.push(hostRec.data[at + 4]);
    }
  }
  // Where the host itself moved an enemy in one frame (a stranded one re-entering through a spawn point, a leap's landing
  // correction): no netcode can draw that as motion, so half a second either side of it is left out of the comparison.
  let teleports = 0;
  for (const track of truth.values()) {
    track.jumps = [];
    for (let i = 1; i < track.t.length; i++) {
      if (Math.hypot(track.x[i] - track.x[i - 1], track.y[i] - track.y[i - 1], track.z[i] - track.z[i - 1]) > 3) { track.jumps.push(track.t[i]); teleports++; }
    }
  }
  const out = { x: 0, y: 0, z: 0, yaw: 0 };
  const where = (uid, t) => {
    const track = truth.get(uid);
    if (!track || t < track.t[0] || t > track.t.at(-1)) return null;
    for (const jump of track.jumps) if (Math.abs(t - jump) < 500) return null;
    let lo = 0, hi = track.t.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track.t[mid] <= t) lo = mid; else hi = mid; }
    // A gap in the host's own record (the enemy was not alive in between) is not a place.
    if (track.t[hi] - track.t[lo] > 400) return null;
    const k = track.t[hi] === track.t[lo] ? 0 : (t - track.t[lo]) / (track.t[hi] - track.t[lo]);
    out.x = track.x[lo] + (track.x[hi] - track.x[lo]) * k; out.y = track.y[lo] + (track.y[hi] - track.y[lo]) * k; out.z = track.z[lo] + (track.z[hi] - track.z[lo]) * k;
    out.yaw = track.yaw[lo] + Math.atan2(Math.sin(track.yaw[hi] - track.yaw[lo]), Math.cos(track.yaw[hi] - track.yaw[lo])) * k;
    return out;
  };
  // The guest's drawing, per enemy.
  const drawn = new Map();
  const frameTimes = [];
  for (let at = 0; at < guestRec.data.length;) {
    const t = guestRec.data[at++], n = guestRec.data[at++];
    frameTimes.push(t);
    for (let i = 0; i < n; i++, at += 6) {
      const uid = guestRec.data[at];
      let track = drawn.get(uid);
      if (!track) drawn.set(uid, track = []);
      track.push({ t, x: guestRec.data[at + 1], y: guestRec.data[at + 2], z: guestRec.data[at + 3], yaw: guestRec.data[at + 4], playhead: guestRec.data[at + 5] });
    }
  }
  // The one delay that fits best: the guest draws the past, and how far back is not an error.
  const cost = delay => {
    let sum = 0, n = 0;
    for (const [uid, track] of drawn) for (let i = 0; i < track.length; i += 3) {
      const s = track[i], h = where(uid, s.t - delay);
      if (h) { sum += Math.min(2, Math.hypot(s.x - h.x, s.y - h.y, s.z - h.z)); n++; }
    }
    return n ? sum / n : Infinity;
  };
  let delay = 0, best = Infinity;
  for (let d = 0; d <= 700; d += 10) { const c = cost(d); if (c < best) { best = c; delay = d; } }
  for (let d = Math.max(0, delay - 10); d <= delay + 10; d += 1) { const c = cost(d); if (c < best) { best = c; delay = d; } }

  const error = [], yaw = [], declared = [], declaredYaw = [], step = [], behind = [];
  let frames = 0, moving = 0, stallFrames = 0, stalls = 0, enemySeconds = 0;
  for (const [uid, track] of drawn) {
    let stalled = false, previous = null, previousHost = null;
    for (const s of track) {
      const h = where(uid, s.t - delay);
      if (!h) { previous = previousHost = null; stalled = false; continue; }
      frames++;
      error.push(Math.hypot(s.x - h.x, s.y - h.y, s.z - h.z));
      yaw.push(turn(s.yaw, h.yaw) * 180 / Math.PI);
      const host = { x: h.x, y: h.y, z: h.z };
      if (Number.isFinite(s.playhead)) {
        const d = where(uid, hostRec.origin + s.playhead);
        if (d) { declared.push(Math.hypot(s.x - d.x, s.y - d.y, s.z - d.z)); declaredYaw.push(turn(s.yaw, d.yaw) * 180 / Math.PI); behind.push(s.t - (hostRec.origin + s.playhead)); }
      }
      if (previous && s.t - previous.t < 120) {
        const dt = (s.t - previous.t) / 1000;
        enemySeconds += dt;
        const guestMove = Math.hypot(s.x - previous.x, s.y - previous.y, s.z - previous.z);
        const hostMove = Math.hypot(host.x - previousHost.x, host.y - previousHost.y, host.z - previousHost.z);
        step.push(Math.abs(guestMove - hostMove));
        if (hostMove / dt > 0.5) {
          moving++;
          const still = guestMove < 0.0005;
          if (still) { stallFrames++; if (!stalled) stalls++; }
          stalled = still;
        } else stalled = false;
      } else stalled = false;
      previous = s; previousHost = host;
    }
  }
  const seconds = (frameTimes.at(-1) - frameTimes[0]) / 1000;
  const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
  return {
    seconds: round(seconds, 1), enemies: drawn.size, samples: frames, hostTeleports: teleports, guestFps: round(guestRec.frames / seconds, 1), hostFps: round(hostRec.frames / seconds, 1),
    delay, error: spread(error), yaw: spread(yaw),
    declared: declared.length ? { behindMs: spread(behind), error: spread(declared), yaw: spread(declaredYaw) } : null,
    stalls: { frames: stallFrames, movingFrames: moving, percent: round(100 * stallFrames / Math.max(1, moving)), perMinute: round(stalls / seconds * 60, 1),
      perEnemyMinute: round(stalls / Math.max(0.001, enemySeconds) * 60, 2) },
    step: spread(step),
  };
}

export default async function (host, { sleep, outDir }, options = fromEnv()) {
  const { enemies: ENEMIES, net: NET, hostFps: HOST_FPS, seconds: SECONDS, tag: TAG, shots: SHOTS, strict: STRICT } = { ...fromEnv(), ...options };
  const out = { errors: [], checks: [], screenshots: [] };
  const name = `motion-${TAG}-${ENEMIES}e-${HOST_FPS || 60}fps-${NET ? NET.replace(/[^a-z0-9.]+/gi, '_') : 'clean'}`;
  const { check, progress, shot } = kit(outDir, name, out, sleep);
  let party;
  try {
    await host.addInitScript(capFrames, HOST_FPS);
    party = await startParty(host, { mode: 'crucible', net: NET || undefined, out, progress, sleep });
    const { guest } = party;
    await live(party);
    // The wave director off, and a crowd of our own: melee chasers, gunmen who keep their distance, fast ones.
    await calm(host);
    await host.evaluate(() => { window.__op2.ctx.waves.nextWaveIn = 1e9; });
    const spawned = await host.evaluate(count => {
      const { ctx } = window.__op2, V = ctx.player.position.constructor;
      const s = ctx.world.playerSpawns[0];
      const kinds = ['husk', 'husk', 'trooper', 'husk', 'stalker'];
      let made = 0;
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2, radius = 9 + (i % 4) * 2.5;
        const p = new V(s.position.x + Math.sin(angle) * radius, s.position.y, s.position.z + Math.cos(angle) * radius);
        const snapped = p.clone();
        if (ctx.world.nav.nearest?.(p, 6, snapped)) p.copy(snapped);
        if (ctx.enemies.spawn(kinds[i % kinds.length], p)) made++;
      }
      return made;
    }, ENEMIES);
    check(spawned === ENEMIES, `The host has its ${ENEMIES} enemies`, spawned);
    await host.evaluate(runInCircles, 0.55);
    await guest.evaluate(runInCircles, -0.4);
    await guest.waitForFunction(n => window.__op2.ctx.enemies.alive.length >= n, ENEMIES, { timeout: 30000 });
    // Players cannot die, enemies cannot either: the crowd stays whole for the recording.
    for (const page of party.pages) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    await sleep(4000);

    progress(`recording ${SECONDS} s: ${ENEMIES} enemies, host ${HOST_FPS || 'uncapped'} fps, net ${NET || 'clean'}`);
    await host.evaluate(record, SECONDS + 2); await guest.evaluate(record, SECONDS + 2);
    await resetNet(party.pages);
    const before = await host.evaluate(() => ({ ...window.__op2.ctx.coop.world.stats, at: performance.now() }));
    await sleep(SECONDS * 1000);
    const after = await host.evaluate(() => ({ ...window.__op2.ctx.coop.world.stats, at: performance.now() }));
    const hostNet = await netStats(host), guestNet = await netStats(guest);
    const [hostRec, guestRec] = [await host.evaluate(() => window.__motion.read()), await guest.evaluate(() => window.__motion.read())];
    const result = analyse(hostRec, guestRec);
    const windowSeconds = (after.at - before.at) / 1000;
    const lanes = Object.entries(hostNet.lanes ?? {});
    result.bytes = {
      snapshotsPerSecond: Math.round((after.snapshotBytes - before.snapshotBytes) / windowSeconds),
      snapshotPacketsPerSecond: Math.round((after.snapshotPackets - before.snapshotPackets) / windowSeconds),
      eventsPerSecond: Math.round((after.eventBytes - before.eventBytes) / windowSeconds),
      hostAllLanesPerSecond: lanes.reduce((sum, [, lane]) => sum + (lane.out?.bytesPerSecond ?? 0), 0),
      worldLane: hostNet.lanes?.world ? { unreliable: hostNet.lanes.world.unreliable, out: hostNet.lanes.world.out, fallback: hostNet.lanes.world.fallback, skipped: hostNet.lanes.world.skipped } : null,
      guestWorldLane: guestNet.lanes?.world ? { in: guestNet.lanes.world.in, lossPercent: guestNet.lanes.world.lossPercent, late: guestNet.lanes.world.late, gap: guestNet.lanes.world.gap } : null,
    };
    result.run = { tag: TAG, enemies: ENEMIES, hostFpsCap: HOST_FPS, net: NET || 'clean', transport: party.transport, coopMs: hostNet.coopMs,
      guestClock: await guest.evaluate(() => { const r = window.__op2.ctx.coop.world.motion?.(); return r ?? null; }).catch(() => null) };
    out.result = result;
    check(result.enemies >= ENEMIES * 0.9, 'The guest drew the crowd', result.enemies);
    check(result.stalls.movingFrames > 1000, 'The crowd was moving', result.stalls);
    if (SHOTS) for (let i = 0; i < SHOTS; i++) { await shot(guest, `guest-${i}`); await sleep(120); }
    if (STRICT) {
      const measured = result.declared?.error ?? result.error;
      check(measured.p50 <= LIMITS.errorP50, `An enemy is drawn within ${LIMITS.errorP50} m of the host's, half the time`, measured);
      check(measured.p95 <= LIMITS.errorP95, `... and within ${LIMITS.errorP95} m 95% of the time`, measured);
      check(result.stalls.perEnemyMinute <= LIMITS.stallsPerEnemyMinute, `An enemy stalls at most ${LIMITS.stallsPerEnemyMinute} time a minute`, result.stalls);
      check(result.bytes.snapshotsPerSecond <= LIMITS.snapshotBytes, `Snapshots stay under ${LIMITS.snapshotBytes} bytes a second for this guest`, result.bytes);
    }
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${name}.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
