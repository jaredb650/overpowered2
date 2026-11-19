// The wire's heavy scene: what co-op sends, and what it costs the host, in the worst fight the game can make. The host keeps
// 48 enemies alive and fires the rotary cannon; the guests fire a shotgun, rockets and a held Lance beam; the host calls a
// gunship. Measured per lane and per event type on every page, with the host's own CPU spent in co-op code.
//
//   node tools/shot.mjs --port <port> --w 960 --h 540 --wait 500 --timeout 420 \
//     --script tools/scripts/coop-wire-heavy.mjs --out tools/out/coop/<you>/heavy.png
//   WIRE_PLAYERS=4 (2 to 4)   WIRE_SECONDS=30   WIRE_ENEMIES=48   WIRE_TAG=before   COOP_NET=rtc for real WebRTC
//   WIRE_SIM=lag:60,jitter:20,loss:0.02 for a bad network on every page   WIRE_PROFILE=0 skips the host's CPU profile
//   WIRE_QUIET=1: nobody fires (the cost of the world alone)
//
// Writes heavy-<tag>-<transport>-<players>p.json and .md beside --out. The .md is the table for docs/notes/coop.md.
// Numbers taken while the machine is overloaded (load far above its cores) prove nothing: the load is in the JSON.
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { kit, live, measure, rtcChannels, setNet, skipBreak, startParty, stopShooting } from './coop-kit.mjs';

const PLAYERS = Number(process.env.WIRE_PLAYERS ?? 4);
const SECONDS = Number(process.env.WIRE_SECONDS ?? 30);
const ENEMIES = Number(process.env.WIRE_ENEMIES ?? 48);
const TAG = process.env.WIRE_TAG ?? 'run';
const SIM = process.env.WIRE_SIM ?? '';
const PROFILE = process.env.WIRE_PROFILE !== '0';
const QUIET = process.env.WIRE_QUIET === '1';
/** The host's gun, then each guest's. */
const GUNS = [['buzzsaw', 'hold'], ['shotgun', 'tap'], ['rocket', 'tap'], ['lance', 'lance']];

/** Host: keeps `count` enemies alive, in a ring round the players' spawn, a mix of what the mode can spawn. */
const fill = host => host.evaluate(count => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const spawnAt = ctx.world.playerSpawns[0].position;
  const kinds = [];
  // Whatever this mode has the bodies for: the swarm, and a few that shoot.
  for (const kind of ['husk', 'stalker', 'leaper', 'trooper', 'gunner', 'rocketeer']) {
    try {
      const probe = ctx.enemies.spawn(kind, spawnAt.clone().add(new V(18, 0, 0)));
      if (probe) { kinds.push(kind); ctx.enemies.withdraw(probe); }
    } catch { /* this mode has no such body */ }
  }
  window.__wireKinds = kinds;
  let n = 0;
  clearInterval(window.__wireFill);
  window.__wireFill = setInterval(() => {
    for (let tries = 0; tries < 12 && ctx.enemies.alive.length < count; tries++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 14;
      const p = new V(spawnAt.x + Math.cos(a) * r, spawnAt.y, spawnAt.z + Math.sin(a) * r);
      const snapped = p.clone();
      if (ctx.world.nav.nearest?.(p, 6, snapped)) p.copy(snapped);
      // Three of the swarm to each one that shoots.
      const kind = n++ % 4 === 3 && kinds.length > 1 ? kinds[1 + (n >> 2) % (kinds.length - 1)] : kinds[0];
      try { ctx.enemies.spawn(kind, p); } catch { /* skip */ }
    }
  }, 250);
  return kinds;
}, ENEMIES);

/**
 * A scripted shooter for any gun: keeps the nearest enemy in the sight and works the trigger as the gun wants it. `hold`
 * keeps it down (an automatic), `tap` presses it again and again (a pump shotgun, a rocket), `lance` charges to full, lets
 * go and lets the beam pour before charging again.
 */
const gunLoop = (page, weapon, how) => page.evaluate(([weapon, how]) => {
  const { ctx, game } = window.__op2;
  ctx.weapons.give(weapon); ctx.weapons.switchTo(weapon); ctx.weapons.refillMagazines();
  clearInterval(window.__coopShooter);
  let tick = 0;
  window.__coopShooter = setInterval(() => {
    if (game.state !== 'playing') game.setState('playing');
    let best = null, bestD = 3600;
    for (const enemy of ctx.enemies.alive) {
      const d = enemy.center.distanceToSquared(ctx.player.eye);
      if (d < bestD) { best = enemy; bestD = d; }
    }
    if (best) {
      const delta = best.center.clone().sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
    }
    ctx.weapons.refillMagazines();
    tick++;
    // A trigger already down while the gun is still coming up is not a press: wait for the draw.
    const down = ctx.weapons.drawLeft > 0 ? false : how === 'hold' ? true : how === 'tap' ? tick % 2 === 0 : !ctx.weapons.lance.beaming && ctx.weapons.charge < 1;
    ctx.input.simulate('fire', !!best && down);
  }, 50);
}, [weapon, how]);

/** Every page: no combo, perk or drop from kills, so no slow-mo comes and goes under the measurement. */
const steady = page => page.evaluate(async () => { (await import('/src/core/devflags.ts')).DevFlags.progression = false; });

/** What a page's shooter has done, to show the scene was the one asked for. */
const shooter = page => page.evaluate(() => {
  const { ctx } = window.__op2, fx = ctx.coop.world.weaponFx;
  return { weapon: ctx.weapons.current, kills: ctx.progression.kills, sent: { ...fx.sent }, drawn: { ...fx.drawn }, state: window.__op2.game.state };
});

/** Host: a gunship over the fight, flown by itself. */
const gunship = host => host.evaluate(() => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const s = ctx.world.playerSpawns[0].position;
  ctx.progression.callinLink.callAt('ac130', new V(s.x + 8, s.y, s.z + 6), new V(1, 0, 0.35), true);
});

/** V8's sampling profile, boiled down: self time by file and function, and the time under co-op's own code (`src/net`). */
function profileSummary(profile, frames) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  const fileOf = node => (node.callFrame.url || '').replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+\//, '').replace(/^.*\/node_modules\//, 'node_modules/');
  const isNet = node => /^src\/net\//.test(fileOf(node)) || /node_modules\/(\.vite\/deps\/)?(@trystero|trystero)/.test(fileOf(node));
  const inclusive = new Map();
  const total = node => {
    let sum = self.get(node.id) ?? 0;
    for (const child of node.children ?? []) sum += total(nodes.get(child));
    inclusive.set(node.id, sum);
    return sum;
  };
  const root = profile.nodes[0];
  total(root);
  let busy = 0, idle = 0;
  for (const node of profile.nodes) {
    const ms = self.get(node.id) ?? 0;
    if (node.callFrame.functionName === '(idle)') idle += ms; else busy += ms;
  }
  // Time under the topmost co-op frame of each stack: everything co-op code did or asked for (handlers it ran included).
  let under = 0;
  const byEntry = new Map();
  const walk = node => {
    if (isNet(node)) {
      const ms = inclusive.get(node.id) ?? 0;
      under += ms;
      const key = `${node.callFrame.functionName || '(anonymous)'} (${fileOf(node)}:${node.callFrame.lineNumber + 1})`;
      byEntry.set(key, (byEntry.get(key) ?? 0) + ms);
      return;
    }
    for (const child of node.children ?? []) walk(nodes.get(child));
  };
  walk(root);
  const byFile = new Map(), byFn = new Map();
  let netSelf = 0;
  for (const node of profile.nodes) {
    const ms = self.get(node.id) ?? 0;
    if (!ms || !isNet(node)) continue;
    netSelf += ms;
    const file = fileOf(node);
    byFile.set(file, (byFile.get(file) ?? 0) + ms);
    const key = `${node.callFrame.functionName || '(anonymous)'} (${file}:${node.callFrame.lineNumber + 1})`;
    byFn.set(key, (byFn.get(key) ?? 0) + ms);
  }
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, ms]) => ({ name, ms: Math.round(ms * 10) / 10, msPerFrame: Math.round((ms / frames) * 1000) / 1000 }));
  const r = ms => Math.round(ms * 10) / 10;
  return { frames, busyMs: r(busy), idleMs: r(idle), busyMsPerFrame: Math.round((busy / frames) * 100) / 100,
    coopSelfMs: r(netSelf), coopSelfMsPerFrame: Math.round((netSelf / frames) * 1000) / 1000,
    coopInclusiveMs: r(under), coopInclusiveMsPerFrame: Math.round((under / frames) * 1000) / 1000,
    files: top(byFile, 14), functions: top(byFn, 24), entries: top(byEntry, 14) };
}

const kb = n => (n / 1024).toFixed(2);

/** One page's side of the table. */
function side(read) {
  const lanes = Object.fromEntries(Object.entries(read.lanes).map(([name, lane]) => [name, {
    kind: lane.unreliable ? 'unreliable' : 'reliable',
    out: { bytesPerSecond: lane.out.bytesPerSecond, perSecond: lane.out.packetsPerSecond, bytesEach: lane.out.packets ? Math.round(lane.out.bytes / lane.out.packets) : 0 },
    in: { bytesPerSecond: lane.in.bytesPerSecond, perSecond: lane.in.packetsPerSecond, bytesEach: lane.in.packets ? Math.round(lane.in.bytes / lane.in.packets) : 0 },
    skipped: lane.skipped, fallback: lane.fallback,
  }]));
  const events = Object.entries(read.events ?? {}).map(([t, e]) => ({ t, ...e })).sort((a, b) => b.out.bytesPerSecond - a.out.bytesPerSecond || b.in.perSecond - a.in.perSecond);
  const frames = read.costs?.['coop.update']?.n ?? 0;
  const perFrame = name => frames && read.costs?.[name] ? Math.round((read.costs[name].ms / frames) * 1000) / 1000 : 0;
  return { fps: read.fps, enemies: read.enemies, lanes, events, totals: read.totals, coopMs: read.coopMs, frames,
    costMsPerFrame: { update: perFrame('coop.update'), send: perFrame('coop.send'), receive: perFrame('coop.receive'), flush: perFrame('coop.flush') },
    costs: read.costs, peers: read.peers, sim: read.sim };
}

function markdown(out) {
  const lines = [];
  const { host, guests } = out;
  lines.push(`Heavy scene, ${out.players} players, ${out.transport}${out.sim ? `, ${out.sim}` : ''}, ${out.seconds} s (${out.tag}). Machine load ${out.machine.load1m} on ${out.machine.cores} cores.`);
  lines.push(`Frames a second: host ${host.fps.mean}, guests ${guests.map(g => g.fps.mean).join(' / ')}. Enemies alive on the host: ${host.enemies.mean}.`);
  lines.push('');
  lines.push('| Lane | Host out: KB/s | msgs/s | bytes each | A guest out (mean): KB/s | msgs/s | bytes each |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  const names = [...new Set([host, ...guests].flatMap(s => Object.keys(s.lanes)))];
  const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  for (const name of names) {
    const h = host.lanes[name]?.out, g = guests.map(s => s.lanes[name]?.out).filter(Boolean);
    lines.push(`| \`${name}\` | ${h ? kb(h.bytesPerSecond) : '-'} | ${h?.perSecond ?? '-'} | ${h?.bytesEach ?? '-'} | ${kb(mean(g.map(x => x.bytesPerSecond)))} | ${Math.round(mean(g.map(x => x.perSecond)) * 10) / 10} | ${Math.round(mean(g.map(x => x.bytesEach)))} |`);
  }
  lines.push(`| **all lanes** | **${kb(host.totals.outBytesPerSecond)}** | | | **${kb(mean(guests.map(g => g.totals.outBytesPerSecond)))}** | | |`);
  lines.push('');
  lines.push(`Host events by type (out, one count per recipient; ${guests.length} guest${guests.length > 1 ? 's' : ''}):`);
  lines.push('');
  lines.push('| Event | per second | bytes each | KB/s all guests | KB/s per guest |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const e of host.events.filter(e => e.out.n).slice(0, 28)) lines.push(`| \`${e.t}\` | ${e.out.perSecond} | ${e.out.bytesEach} | ${kb(e.out.bytesPerSecond)} | ${kb(e.out.bytesPerSecond / guests.length)} |`);
  lines.push('');
  lines.push('Guest events by type (out, summed over the guests):');
  lines.push('');
  lines.push('| Event | per second | bytes each | KB/s |');
  lines.push('|---|---:|---:|---:|');
  const sum = new Map();
  for (const g of guests) for (const e of g.events) {
    const s = sum.get(e.t) ?? { n: 0, bytes: 0, perSecond: 0, bytesPerSecond: 0 };
    s.n += e.out.n; s.bytes += e.out.bytes; s.perSecond += e.out.perSecond; s.bytesPerSecond += e.out.bytesPerSecond;
    sum.set(e.t, s);
  }
  for (const [t, s] of [...sum].filter(([, s]) => s.n).sort((a, b) => b[1].bytesPerSecond - a[1].bytesPerSecond).slice(0, 20)) lines.push(`| \`${t}\` | ${Math.round(s.perSecond * 10) / 10} | ${Math.round(s.bytes / s.n)} | ${kb(s.bytesPerSecond)} |`);
  lines.push('');
  lines.push('| Co-op cost a frame, ms | Host | Guests |');
  lines.push('|---|---:|---:|');
  for (const key of ['update', 'send', 'receive', 'flush']) lines.push(`| ${key} | ${host.costMsPerFrame[key]} | ${guests.map(g => g.costMsPerFrame[key]).join(' / ')} |`);
  if (out.profile) {
    lines.push(`| host profile: all work | ${out.profile.busyMsPerFrame} | |`);
    lines.push(`| host profile: co-op code and what it called | ${out.profile.coopInclusiveMsPerFrame} | |`);
    lines.push(`| host profile: co-op code itself | ${out.profile.coopSelfMsPerFrame} | |`);
    lines.push('');
    lines.push('Host profile, co-op functions by self time (ms a frame): ' + out.profile.functions.slice(0, 10).map(f => `${f.name} ${f.msPerFrame}`).join('; '));
  }
  return lines.join('\n') + '\n';
}

export default async function (host, { sleep, outDir }) {
  const transport = process.env.COOP_NET ?? 'loop';
  const name = `heavy-${TAG}-${transport}-${PLAYERS}p`;
  const out = { tag: TAG, transport, players: PLAYERS, seconds: SECONDS, sim: SIM, quiet: QUIET, date: new Date().toISOString(), errors: [], checks: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, name, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: PLAYERS, out, progress, sleep });
    await live(party, { enemies: 6 });
    out.kinds = await fill(host);
    progress(`the host keeps ${ENEMIES} alive: ${out.kinds.join(', ')}`);
    for (const page of party.pages) await steady(page);
    if (!QUIET) for (const [i, page] of party.pages.entries()) await gunLoop(page, ...GUNS[i]);
    const everySecond = async i => {
      await skipBreak(host);
      if (!QUIET && i % 40 === 0) await gunship(host).catch(() => {});
    };
    // Warm up: pools fill, shaders compile, the first gunship comes on station.
    for (let i = 0; i < 12; i++) { await sleep(1000); await everySecond(i === 0 ? 0 : 1); }
    if (SIM) for (const page of party.pages) await setNet(page, SIM);
    await sleep(1500);

    let cdp = null;
    if (PROFILE) {
      cdp = await host.context().newCDPSession(host);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    progress(`measuring ${SECONDS} s`);
    const window = await measure(party, SECONDS, { everySecond: i => everySecond(i + 1) });
    let profile = null;
    if (cdp) {
      profile = (await cdp.send('Profiler.stop')).profile;
      await cdp.detach().catch(() => {});
    }
    out.machine = { load1m: Math.round(loadavg()[0] * 10) / 10, cores: cpus().length };
    out.host = side(window.host);
    out.guests = window.guests.map(side);
    if (profile) out.profile = profileSummary(profile, Math.max(1, out.host.frames));
    if (transport === 'rtc') out.rtcChannels = { host: await rtcChannels(host), guests: await Promise.all(party.guests.map(rtcChannels)) };
    out.shooters = await Promise.all(party.pages.map(shooter));
    out.world = await host.evaluate(() => ({ ...window.__op2.ctx.coop.world.stats, refused: { ...window.__op2.ctx.coop.world.validator.refused } }));
    await shot(host, 'host');
    await shot(party.guests[0], 'guest');
    for (const page of party.pages) await stopShooting(page).catch(() => {});
    await host.evaluate(() => clearInterval(window.__wireFill));

    check(out.host.enemies.mean >= ENEMIES * 0.6, `The host kept the fight full (about ${ENEMIES} alive)`, out.host.enemies);
    check(out.guests.every(g => g.lanes.world?.in.perSecond > 5), 'Every guest got snapshots', out.guests.map(g => g.lanes.world?.in));
    if (!QUIET) check(out.host.events.some(e => e.t === 'hit' && e.in.n > 0), "The guests' claims reached the host", out.host.events.filter(e => e.t === 'hit'));
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${name}.json`, JSON.stringify(out, null, 2));
    if (out.host) writeFileSync(`${outDir}/${name}.md`, markdown(out));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
