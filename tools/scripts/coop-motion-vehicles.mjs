// Co-op proof: enemy vehicles and the garrison on a guest's screen move as the host's do, with no steps, and end where the
// host's are. Both ride the same motion buffer as the enemies (world/motion.ts), fed 5 times a second on the reliable lane.
// Outpost Defense, a host and a guest, pages drawn (this is about what is seen).
//
//   OP2_NO_HMR=1 npx vite --port 5450 --strictPort          (your own port)
//   node tools/shot.mjs --port 5450 --w 1280 --h 720 --wait 500 --timeout 400 \
//     --script tools/scripts/coop-motion-vehicles.mjs --out tools/out/coop/verify-motion/vehicles.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05 for the bad network.
//
// 1. The garrison is told to follow the host, who runs about for 20 s: every man's copy on the guest is recorded each frame
//    against the host's man. The host stops: each copy ends where its man stands.
// 2. The garrison is sent home. A scout car is driven round a block of the north field and a tank along it for 25 s,
//    recorded the same way. They stop: each copy ends where the host's machine is, hull and turret.
//
// The recordings are measured by coop-motion-measure.mjs's yardstick (`analyse`): how old the picture really is, how far
// off the host's path the copy is drawn, frames it stood still while the host's moved, frames it darted. It writes
// motion-vehicles-<net>.json beside --out, with the two recordings (.raw.json.gz).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { kit, live, startParty, teleport } from './coop-kit.mjs';
import { analyse } from './coop-motion-measure.mjs';
import { lookAt } from './coop-worldb-kit.mjs';

/** What "without steps" and "where the host's are" mean here; the bad network gets the second set. */
const LIMITS = {
  clean: { jumps: 0, stoodStill: 1, offPathP95: 0.15, endM: 0.08, endDeg: 2 },
  bad: { jumps: 0, stoodStill: 3, offPathP95: 0.35, endM: 0.08, endDeg: 2 },
};

/** In a page: the host runs in a wide circle. */
function runInCircles(turn) {
  const { ctx } = window.__op2;
  ctx.input.simulate('forward', true);
  let last = performance.now();
  const step = now => {
    if (window.__stopCircles) { ctx.input.simulate('forward', false); return; }
    ctx.player.yaw += turn * Math.min(0.1, (now - last) / 1000);
    last = now;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * In a page: records the vehicles and the garrison every frame, in the layout coop-motion-measure.mjs's `analyse` reads.
 * Host: where each really is. Guest: where its copy is drawn (and the copy's playhead and send interval). A vehicle's
 * "yaw" is its hull's heading. Ids: a vehicle's is the host's id for it, a garrison man's that plus 1000.
 */
function record(seconds) {
  const { ctx } = window.__op2;
  const world = ctx.coop.world, hosting = ctx.coop.hosting;
  const fields = hosting ? 7 : 8, header = hosting ? 2 : 9, MAX = 40;
  const data = new Float64Array(Math.ceil(seconds * 130) * (header + MAX * fields));
  let at = 0, frames = 0, on = true;
  const V = ctx.player.position.constructor;
  const ahead = new V();
  const heading = quaternion => { ahead.set(0, 0, 1).applyQuaternion(quaternion); return Math.atan2(ahead.x, ahead.z); };
  const rec = () => {
    if (!on || at + header + MAX * fields > data.length) return;
    const head = at;
    data[at++] = performance.timeOrigin + performance.now();
    at++;
    if (!hosting) {
      const camera = ctx.render.camera;
      data[at++] = ctx.player.eye.x; data[at++] = ctx.player.eye.y; data[at++] = ctx.player.eye.z; data[at++] = ctx.player.yaw;
      data[at++] = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
      data[at++] = world.enemies?.clock?.jitter ?? NaN; data[at++] = world.enemies?.clock?.offset ?? NaN;
    }
    let n = 0;
    if (hosting) {
      for (const v of ctx.enemies.vehicles?.live ?? []) {
        const id = world.vehicles.ids.get(v);
        if (id === undefined || !v.alive || n === MAX) continue;
        data[at++] = id; data[at++] = v.position.x; data[at++] = v.position.y; data[at++] = v.position.z; data[at++] = heading(v.quaternion); data[at++] = 0; data[at++] = 0; n++;
      }
      for (const a of ctx.allies?.allies ?? []) {
        const id = world.garrison.ids.get(a);
        if (id === undefined || a.state === 'dead' || n === MAX) continue;
        const p = a.body.position;
        data[at++] = 1000 + id; data[at++] = p.x; data[at++] = p.y; data[at++] = p.z; data[at++] = a.body.yaw; data[at++] = 0; data[at++] = a.state === 'down' ? 1 : 0; n++;
      }
    } else {
      for (const [id, p] of world.vehicles.puppets) {
        if (n === MAX) break;
        const root = p.model.root;
        data[at++] = id; data[at++] = root.position.x; data[at++] = root.position.y; data[at++] = root.position.z; data[at++] = heading(root.quaternion);
        data[at++] = p.motion.playhead; data[at++] = p.motion.interval; data[at++] = 0; n++;
      }
      for (const [id, b] of world.garrison.bodies) {
        if (n === MAX) break;
        const root = b.char.root;
        data[at++] = 1000 + id; data[at++] = root.position.x; data[at++] = root.position.y; data[at++] = root.position.z; data[at++] = root.rotation.y;
        data[at++] = b.motion.playhead; data[at++] = b.motion.interval; data[at++] = b.state === 1 ? 1 : 0; n++;
      }
    }
    data[head + 1] = n;
    frames++;
  };
  // The host is read as it sends (before the world's update); the guest once both of its drawing steps have run.
  if (!window.__motionHooked) {
    window.__motionHooked = true;
    const update = world.update.bind(world), updateGuests = world.updateGuests.bind(world);
    let drawn = 0;
    if (hosting) world.update = () => { window.__motionRec?.(); update(); };
    else {
      world.update = () => { update(); if (++drawn >= 2) { drawn = 0; window.__motionRec?.(); } };
      world.updateGuests = () => { updateGuests(); if (++drawn >= 2) { drawn = 0; window.__motionRec?.(); } };
    }
  }
  window.__motionRec = rec;
  window.__motion = { read: () => { on = false; return { origin: performance.timeOrigin, fields, header, frames, data: Array.from(data.subarray(0, at)) }; } };
}

/** Host: every living vehicle and garrison man, as the guests know them. Guest: its copies. For the end of each part. */
const places = page => page.evaluate(() => {
  const { ctx } = window.__op2, world = ctx.coop.world;
  const r = n => Math.round(n * 1e5) / 1e5;
  const out = { vehicles: {}, men: {} };
  if (ctx.coop.hosting) {
    for (const v of ctx.enemies.vehicles?.live ?? []) { const id = world.vehicles.ids.get(v); if (id !== undefined && v.alive) out.vehicles[id] = { at: v.position.toArray().map(r), q: v.quaternion.toArray().map(r), turret: r(v.turretYaw ?? 0) }; }
    for (const a of ctx.allies?.allies ?? []) { const id = world.garrison.ids.get(a); if (id !== undefined && a.state !== 'dead') out.men[id] = { at: a.body.position.toArray().map(r), yaw: r(a.body.yaw) }; }
  } else {
    for (const [id, p] of world.vehicles.puppets) out.vehicles[id] = { at: p.model.root.position.toArray().map(r), q: p.model.root.quaternion.toArray().map(r), turret: r(p.model.turret?.rotation.y ?? 0) };
    for (const [id, b] of world.garrison.bodies) out.men[id] = { at: b.char.root.position.toArray().map(r), yaw: r(b.char.root.rotation.y) };
  }
  return out;
});

const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const turned = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180 / Math.PI;
/** Degrees between two attitudes (as read: rounded, so not quite unit length). */
const tilted = (p, q) => 2 * Math.acos(Math.min(1, Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]) / (Math.hypot(...p) * Math.hypot(...q)))) * 180 / Math.PI;
const order = (kind, x, z, route) => ({ kind, order: { x, y: 0, z, route, tag: null, crew: [], crewTag: null, holds: false, holdYaw: NaN, parked: false } });

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const sim = process.env.COOP_SIM || undefined;
  const limits = sim ? LIMITS.bad : LIMITS.clean;
  const name = `motion-vehicles-${sim ? sim.replace(/[^a-z0-9.]+/gi, '_') : 'clean'}`;
  const { check, progress, shot } = kit(outDir, name, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'defense', net: sim, look: true, out, progress, sleep });
    await live(party, { enemies: 3 });
    const { guest } = party;
    // The wave's own men and machines are sent home: this proof brings its own.
    await host.evaluate(() => {
      const { ctx } = window.__op2; ctx.waves.running = false; ctx.waves.nextWaveIn = 1e9;
      for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e);
      for (const v of [...(ctx.enemies.vehicles?.live ?? [])]) v.remove();
    });

    /** Records `seconds` on both pages while `during` runs, and measures the two recordings. */
    const measure = async (label, seconds, during) => {
      await host.evaluate(record, seconds + 2); await guest.evaluate(record, seconds + 2);
      await during?.();
      await sleep(seconds * 1000);
      const [hostRec, guestRec] = [await host.evaluate(() => window.__motion.read()), await guest.evaluate(() => window.__motion.read())];
      writeFileSync(`${outDir}/${name}-${label}.raw.json.gz`, gzipSync(JSON.stringify({ host: hostRec, guest: guestRec })));
      const r = analyse(hostRec, guestRec);
      const k = r.common.all;
      const result = { things: r.enemies, hostFps: r.hostFps, guestFps: r.guestFps, frames: r.frames, lagMs: k.lagMs, nowError: k.nowError, offPath: k.offPath, yaw: k.yaw, speedError: k.speedError,
        stall: k.stall, jumps: k.jumps, backsteps: k.backsteps, declared: r.declared, events: r.common.events.slice(0, 40) };
      progress(`${label}: ${r.enemies} things, pages ${r.hostFps} / ${r.guestFps} fps, ${Math.round(k.lagMs.p50)} ms old, off its path ${(k.offPath.p50 * 100).toFixed(1)} / ${(k.offPath.p95 * 100).toFixed(1)} cm, stood still ${k.stall.percent}% (${k.stall.events} times, longest ${Math.round(k.stall.ms.max || 0)} ms), jumps ${k.jumps.count}`);
      return result;
    };
    const judge = (what, r) => {
      check(r.things >= 1 && r.stall.movingFrames > 300, `${what}: they were moving while recorded`, { things: r.things, moving: r.stall.movingFrames });
      check(r.guestFps >= 40 && r.hostFps >= 40, `${what}: the pages really ran (40 fps or more)`, { host: r.hostFps, guest: r.guestFps });
      check(r.jumps.count <= limits.jumps, `${what}: no copy darts (a frame over 10 cm further than the host's speed explains)`, { jumps: r.jumps, events: r.events.filter(e => e.kind === 'jump').slice(0, 6) });
      check(r.stall.percent <= limits.stoodStill, `${what}: no copy stands still while the host's moves (at most ${limits.stoodStill}% of frames)`, { stall: r.stall, events: r.events.filter(e => e.kind === 'stall').slice(0, 6) });
      check(r.offPath.p95 <= limits.offPathP95, `${what}: copies are drawn on the host's path (within ${limits.offPathP95 * 100} cm, 95% of frames)`, r.offPath);
    };

    // --- 1. The garrison follows the host --------------------------------------------------------------------------------
    const men = await host.evaluate(() => {
      const { ctx } = window.__op2;
      for (const a of ctx.allies.allies) if (a.state !== 'dead') ctx.allies.setOrder(a, 'follow');
      return ctx.allies.allies.filter(a => a.state !== 'dead').length;
    });
    check(men >= 2, 'The fort has a garrison', men);
    await guest.waitForFunction(n => window.__op2.ctx.coop.world.garrison.bodies.size >= n, men, { timeout: 30000 });
    const hostAt = await host.evaluate(() => window.__op2.ctx.player.position.toArray());
    await lookAt(guest, [hostAt[0], 1.2, hostAt[2]]);
    out.garrison = await measure('garrison', 20, () => host.evaluate(runInCircles, 0.5));
    await shot(guest, 'guest-garrison');
    judge('The garrison', out.garrison);
    await host.evaluate(() => { window.__stopCircles = true; });
    // They close up on the host and stand; then each copy is where its man is. A man counts as standing when two looks at
    // him a second apart are the same.
    let standing = {};
    for (const until = Date.now() + 45000; Date.now() < until;) {
      const first = (await places(host)).men;
      await sleep(1000);
      const second = (await places(host)).men;
      standing = Object.fromEntries(Object.keys(second).map(id => [id, !!first[id] && apart(first[id].at, second[id].at) < 0.01 && turned(first[id].yaw, second[id].yaw) < 0.5]));
      if (Object.values(standing).every(Boolean)) break;
    }
    await sleep(2500);
    const menEnd = { host: await places(host), guest: await places(guest) };
    const menOff = Object.keys(menEnd.host.men).map(id => ({ id, standing: !!standing[id], m: menEnd.guest.men[id] ? apart(menEnd.host.men[id].at, menEnd.guest.men[id].at) : Infinity, deg: menEnd.guest.men[id] ? turned(menEnd.host.men[id].yaw, menEnd.guest.men[id].yaw) : 180 }));
    out.garrisonEnd = menOff;
    const stood = menOff.filter(o => o.standing);
    check(stood.length >= 2, 'The garrison has come to a stand (at least two of them)', menOff);
    check(stood.every(o => o.m <= limits.endM), `Standing again, every man's copy is where the host's man is (within ${limits.endM * 100} cm)`, menOff);
    check(stood.every(o => o.deg <= 5), 'and faces the same way (within 5 degrees)', menOff);

    // --- 2. A scout car and a tank on the north field ----------------------------------------------------------------------
    await host.evaluate(() => { const { ctx } = window.__op2; for (const a of [...ctx.allies.allies]) ctx.allies.dismiss?.(a); });
    // Everyone out on the north field, the host off to the side so the machines are the guest's to watch.
    await teleport(host, [60, 0, -100], 0);
    await teleport(guest, [0, 0, -78], Math.PI);
    const spawn = async o => {
      await host.evaluate(o => { window.__spawned = window.__op2.ctx.enemies.vehicles.spawnGround(o.kind, o.order); }, o);
      await host.waitForFunction(() => window.__op2.ctx.coop.world.vehicles.ids.get(window.__spawned) !== undefined, null, { timeout: 60000 });
      return host.evaluate(() => window.__op2.ctx.coop.world.vehicles.ids.get(window.__spawned));
    };
    const car = await spawn(order('humvee', -40, -98, [{ x: 40, z: -98, hold: 0 }, { x: 40, z: -116, hold: 0 }, { x: -40, z: -116, hold: 0 }, { x: -40, z: -98, hold: 0 }, { x: 30, z: -98, hold: 0 }]));
    const tank = await spawn(order('tank', -30, -130, [{ x: 30, z: -130, hold: 0 }, { x: 30, z: -124, hold: 0 }, { x: -20, z: -124, hold: 0 }]));
    await guest.waitForFunction(ids => ids.every(id => window.__op2.ctx.coop.world.vehicles.puppets.has(id)), [car, tank], { timeout: 60000 });
    check(true, 'The scout car and the tank are on the guest');
    await lookAt(guest, [0, 1.4, -110]);
    out.vehicles = await measure('vehicles', 25);
    await shot(guest, 'guest-vehicles');
    judge('The vehicles', out.vehicles);
    // At the end of their roads they stop: each copy is then where the host's machine is, hull and turret. A machine counts
    // as stopped when two looks at it a second apart are the same (a tank that goes on hunting never is, and is only said so).
    const still = (a, b) => apart(a.at, b.at) < 0.01 && tilted(a.q, b.q) < 0.2;
    let rest = {};
    for (const until = Date.now() + 60000; Date.now() < until;) {
      const first = (await places(host)).vehicles;
      await sleep(1000);
      const second = (await places(host)).vehicles;
      rest = Object.fromEntries(Object.keys(second).map(id => [id, !!first[id] && still(first[id], second[id])]));
      if (Object.values(rest).every(Boolean)) break;
    }
    out.atRest = rest;
    await sleep(2500);
    // The two pages are read one after the other: a turret still tracking moves a little in between, so it gets more room.
    const end = { host: await places(host), guest: await places(guest) };
    const off = Object.keys(end.host.vehicles).map(id => { const h = end.host.vehicles[id], g = end.guest.vehicles[id]; return { id, atRest: !!rest[id], m: g ? apart(h.at, g.at) : Infinity, deg: g ? tilted(h.q, g.q) : 180, turretDeg: g ? turned(h.turret, g.turret) : 180 }; });
    out.vehiclesEnd = { off, end };
    const rested = off.filter(o => o.atRest);
    check(rested.length >= 1, 'At least the scout car has come to rest', off);
    check(rested.every(o => o.m <= limits.endM), `Stopped, each copy is where the host's machine is (within ${limits.endM * 100} cm)`, off);
    check(rested.every(o => o.deg <= limits.endDeg), `with its hull the same way up and round (within ${limits.endDeg} degrees)`, off);
    check(rested.every(o => o.turretDeg <= 12), 'and its turret round where the host\'s is (within 12 degrees)', off);
    for (const o of off.filter(o => !o.atRest)) progress(`vehicle ${o.id} never came to rest (it goes on hunting): it is ${Math.round(o.m * 100)} cm from the host's, which is ${Math.round((out.vehicles.lagMs.p50 || 0))} ms ahead of it`);
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
