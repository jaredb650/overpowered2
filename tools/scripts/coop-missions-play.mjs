// Plays a campaign mission in co-op from the first line to the team board, on 2 or 3 pages, and checks at every section that
// each guest's screen has what the host's has: the section's title, the objectives, the lines said (in order, in step), the
// doors, the lights, the sky, the kit, the racks, the enemies, and that nobody is left behind.
//
// A bot drives it. The ACTOR (the host, or the first guest) does everything a trigger waits on: walks into the zones, takes the
// guns off the racks, fires, presses skip. Enemies are killed with a dev kill on the host a few seconds after they appear, so
// every wave, set piece, film and ride still runs. Extras, each proved on the guests' screens:
//   restart   everyone is put down in a named section: the whole team goes back to the checkpoint
//   rejoin    the first guest's page is closed in a named section and joins again by the invite link
//   skip      every player votes to skip the films (without it they play to the end)
//
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 1500 \
//     --script tools/scripts/coop-missions-play.mjs --out tools/out/coop/missions/<name>.png
//   COOP_MISSION=campaign|foreclosure   COOP_ACTOR=host|guest   COOP_PLAYERS=2|3   COOP_SIM=lag:120,jitter:40,loss:0.05
//   COOP_EXTRAS=skip,restart:softskins,rejoin:barracks   COOP_TAG=<name for the evidence and screenshots>
//   Pages run in the kit's fast mode (no picture between screenshots, no sound mixed) with the loop on a 30 Hz timer
//   (COOP_CLOCK), so a busy machine's GPU cannot hold a guest's window back. COOP_LOOK=1 is the page as a player has it.
//   COOP_STOP=<section id>   ends the proof as that section opens (a short run for one extra)
//   COOP_BEAT=<section id>   starts the host's mission there (dev servers only), to prove a late section without the early ones
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { button, inMatch, kit, openGuest, startParty } from './coop-kit.mjs';

const MISSION = process.env.COOP_MISSION ?? 'campaign';
const ACTOR = process.env.COOP_ACTOR ?? 'host';
const PLAYERS = Number(process.env.COOP_PLAYERS ?? 2);
const SIM = process.env.COOP_SIM || undefined;
const EXTRAS = Object.fromEntries((process.env.COOP_EXTRAS ?? '').split(',').filter(Boolean).map(e => { const [k, v] = e.split(':'); return [k, v ?? true]; }));
const BEAT = process.env.COOP_BEAT || null;
const STOP = process.env.COOP_STOP || null;
const TAG = process.env.COOP_TAG ?? `${MISSION}-${ACTOR}-${PLAYERS}p${SIM ? '-sim' : ''}`;
/** Seconds an enemy lives before the dev kill, and a section runs before the actor walks to its zones. */
const KILL_AFTER = 4;
const ZONE_AFTER = 7;
const ZONE_DWELL = 5;
/** The longest a section may take before the proof gives up, and the whole mission. */
const BEAT_LIMIT = 260;

/** Runs in every page once the match is up: the bot's eyes on what the mission says and shows there. */
function install() {
  const op = window.__op2;
  const { ctx, campaign } = op;
  const bot = (window.__bot = { lines: [], hints: [], banners: [], saved: 0, comms: 0, feed: [], god: true, born: new Map() });
  setInterval(() => { const p = op.ctx.player; if (bot.god && p?.modifiers) p.modifiers.invulnerable = true; }, 100);
  const ui = campaign.ui;
  const speak = ui.speak.bind(ui);
  ui.speak = (line, done) => { bot.lines.push([line.id, Date.now()]); return speak(line, done); };
  const hint = ui.hint.bind(ui);
  ui.hint = (text, seconds) => { bot.hints.push(text); return hint(text, seconds); };
  const saved = ui.saved.bind(ui);
  ui.saved = () => { bot.saved++; return saved(); };
  // The mission's own banners (a perk's banner is that player's own and goes straight to the HUD).
  const banner = campaign.host.banner.bind(campaign.host);
  campaign.host.banner = (...a) => { bot.banners.push(String(a[0])); return banner(...a); };
  const feed = ctx.hud.feed.bind(ctx.hud);
  ctx.hud.feed = (...a) => { bot.feed.push(String(a[0])); if (bot.feed.length > 400) bot.feed.shift(); return feed(...a); };
  ctx.events.on('comms:line', () => { bot.comms++; });
  // The mission's own lights, as last called here. The colour grade itself is also a perk's and a seat's to change.
  bot.lights = 'normal';
  const call = campaign.host.call.bind(campaign.host);
  campaign.host.call = (name, arg) => {
    const out = call(name, arg);
    // After the call: the grade it has just set is the one to hold this screen to.
    if (name === 'lights') { bot.lights = arg ?? 'normal'; bot.gradeAtLights = JSON.stringify(ctx.render.post.to ?? null); }
    return out;
  };
  ctx.events.on('run:start', () => { bot.lights = 'normal'; });
  // The longest this page's main thread went without running, and how often for over two seconds: a stall is the first thing to
  // rule out when a screen falls behind. A timer, not a frame: a guest's page may be hidden and drawing nothing.
  // What was running when a page stalled: the longest single run of each system, each kind of arriving event and each frame.
  bot.blame = {};
  const timed = (obj, key, name) => {
    if (!obj || typeof obj[key] !== 'function') return;
    const real = obj[key];
    obj[key] = function (...a) {
      const t = performance.now();
      try { return real.apply(this, a); } finally {
        const ms = performance.now() - t;
        const label = typeof name === 'function' ? name(a) : name;
        if (ms > (bot.blame[label] ?? 0)) bot.blame[label] = Math.round(ms);
      }
    };
  };
  for (const k of ['player', 'weapons', 'viewmodel', 'enemies', 'allies', 'waves', 'combat', 'world', 'gore', 'progression', 'contracts', 'campaign', 'camera', 'fx', 'audio', 'hud', 'coop']) timed(ctx[k], 'update', k);
  timed(ctx.render, 'render', 'render'); timed(ctx.physics, 'step', 'physics');
  timed(ctx.coop?.world?.w?.router, 'dispatch', a => `event:${a[0]?.t}${a[0]?.t === 'mission' ? `:${a[0].op}${a[0].op === 'cue' || a[0].op === 'call' ? `:${a[0].args?.[0]}` : ''}` : ''}`);
  timed(ctx.coop?.world?.w, 'onSnapshot', 'snapshot');
  bot.gap = { worst: 0, at: 0, over2s: 0 };
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const gap = now - last - 50;
    last = now;
    if (gap > bot.gap.worst) { bot.gap.worst = Math.round(gap); bot.gap.at = Date.now(); }
    if (gap > 2000) bot.gap.over2s++;
  }, 50);
}

/** Everything the proof compares, read from one page. */
function look() {
  const op = window.__op2;
  const { ctx, campaign, game } = op;
  const host = campaign.host;
  const world = ctx.coop?.world;
  const p = ctx.player;
  const round = n => Math.round(n * 100) / 100;
  const shown = selector => { const el = document.querySelector(selector); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const doors = {};
  for (const [id, door] of host.doors.doors) doors[id] = round(door.target);
  const uids = ctx.enemies.alive.map(e => e.uid).sort((a, b) => a - b);
  return {
    hosting: !!ctx.coop?.hosting, state: game.state,
    beat: campaign.runner.beat?.id ?? null, runner: campaign.runner.state, deaths: campaign.runner.deaths,
    title: document.querySelector('.ms-beat')?.textContent ?? '',
    objectives: [...document.querySelectorAll('.ms-obj:not(.done) .ms-obj-text')].map(e => e.textContent),
    doors, lights: window.__bot?.lights ?? 'normal', dark: JSON.stringify(ctx.render.post.to ?? null) === window.__bot?.gradeAtLights && window.__bot?.lights === 'emergency',
    sky: !!ctx.progression.callInsManager?.shut,
    weapons: [...ctx.weapons.owned].sort(), grenades: ctx.weapons.grenades, current: ctx.weapons.current,
    racks: host.racks.racks.map(r => r.weapon).sort(),
    pos: [round(p.position.x), round(p.position.y), round(p.position.z)], parked: !!p.parked, alive: !!p.alive, downed: !!p.downed, health: Math.round(p.health),
    film: host.film.playing, riding: host.riding,
    enemies: uids, vehicles: ctx.coop?.hosting ? (ctx.enemies.vehicles?.live ?? []).filter(v => v.alive && ['humvee', 'truck', 'tank'].includes(v.def.kind)).length : world?.vehicles?.puppets?.size ?? 0,
    allies: ctx.coop?.hosting ? ctx.allies?.allies.length ?? 0 : world?.allyBodies?.size ?? world?.allyBodies?.length ?? 0,
    lines: window.__bot?.lines ?? [], hints: window.__bot?.hints.length ?? 0, banners: window.__bot?.banners ?? [], saved: window.__bot?.saved ?? 0, comms: window.__bot?.comms ?? 0,
    mirrored: world?.mission?.mirrored ?? 0, result: world?.mission?.result ?? null,
    board: shown('.cq-end'), complete: shown('.scr-complete'),
    tags: [...document.querySelectorAll('.hud .wl-tag, .hud .world-label')].length,
    gap: window.__bot?.gap ?? null, blame: Object.fromEntries(Object.entries(window.__bot?.blame ?? {}).filter(e => e[1] >= 250)), lobby: ctx.coop?.lobby?.phase ?? null, lobbyError: ctx.coop?.lobby?.error ?? null,
    corpses: ctx.gore.stats?.().corpses ?? null, score: Math.round(ctx.progression.score), fps: op.stats().fps,
  };
}

/** Host: the mission as data the bot needs: per beat, the zones the actor walks to, in the script's order. */
function plan() {
  const { runner } = window.__op2.campaign;
  const { mission } = runner;
  const out = { id: mission.id, beats: [], zones: {} };
  const arrivals = t => {
    if (!t) return [];
    if ('zone' in t) return t.outside ? [] : [t.zone];
    if ('all' in t) return t.all.flatMap(arrivals);
    if ('any' in t) return t.any.flatMap(arrivals);
    return [];
  };
  for (const beat of mission.beats) {
    const zones = [];
    // A cue that waits on a zone alone is a place to go. One that also waits on a clock is a nudge for a stuck player.
    for (const cue of beat.cues ?? []) {
      const when = cue.when;
      if ('zone' in when && !when.outside) zones.push(when.zone);
      else if ('any' in when) for (const t of when.any) if ('zone' in t && !t.outside) zones.push(t.zone);
    }
    for (const z of arrivals(beat.until)) zones.push(z);
    const steps = [...(beat.start ?? []), ...(beat.cues ?? []).flatMap(c => c.run)];
    // Lines that wait on a player's shot: the actor fires for them before walking on.
    const waitsOnShot = t => !!t && ('event' in t ? t.event === 'weapon:fired' : 'all' in t ? t.all.some(waitsOnShot) : 'any' in t ? t.any.some(waitsOnShot) : false);
    const shotLines = (beat.cues ?? []).filter(c => waitsOnShot(c.when)).flatMap(c => c.run.filter(s => s.do === 'say').map(s => s.line));
    out.beats.push({ id: beat.id, title: beat.title, checkpoint: beat.checkpoint ?? null, zones: [...new Set(zones)], arrival: arrivals(beat.until),
      shotLines, film: steps.some(s => s.do === 'cutscene'), ride: steps.some(s => s.do === 'ride' || s.do === 'sortie'), boss: steps.filter(s => s.do === 'boss').map(s => s.tag) });
  }
  for (const [id, z] of Object.entries(mission.zones)) out.zones[id] = z;
  out.marks = mission.marks;
  return out;
}

/** Host: the dev kill. Everything that has been on the map for `after` seconds dies; a boss is brought down in steps so his set piece plays. */
function reap([after, bossTags]) {
  const { ctx, campaign } = window.__op2;
  const bot = window.__bot;
  const now = performance.now();
  const tagOf = campaign.host.tagOf;
  let killed = 0;
  for (const e of [...ctx.enemies.alive]) {
    if (!bot.born.has(e.uid)) bot.born.set(e.uid, now);
    const age = (now - bot.born.get(e.uid)) / 1000;
    if (age < after) continue;
    const damage = amount => ctx.enemies.applyDamage(e, { amount, type: 'true', point: e.center.clone(), dir: e.center.clone().set(0, 0, 1), force: 0, source: 'smg' });
    if (bossTags.includes(tagOf.get(e.uid))) {
      // A boss takes only so much from one hit, and his plates first. Many small hits bring him to just under 60% (he runs for
      // the roof), a wait, to 20%, a wait, then down: time between for his set piece and its lines.
      const stage = (bot.bossStage ??= { n: 0, until: 0 });
      if (now < stage.until) continue;
      const floor = [0.56, 0.2, -1][stage.n] ?? -1;
      for (let i = 0; i < 40 && e.alive && e.health / e.maxHealth > floor; i++) damage(floor < 0 ? 1e6 : 120);
      if (e.alive && e.health / e.maxHealth <= floor) { stage.n++; stage.until = now + (stage.n === 1 ? 14000 : 7000); }
      continue;
    }
    damage(1e6);
    killed++;
  }
  for (const v of [...(ctx.enemies.vehicles?.live ?? [])]) {
    if (!v.alive || v.tag === null) continue;
    const key = `v${v.tag}`;
    if (!bot.born.has(key)) bot.born.set(key, now);
    if ((now - bot.born.get(key)) / 1000 < after + 4) continue;
    v.take(1e6, null, 'rocket', v.position);
    killed++;
  }
  const chopper = ctx.enemies.vehicles?.chopper;
  if (chopper?.alive !== false && chopper?.take) {
    if (!bot.born.has('chopper')) bot.born.set('chopper', now);
    if ((now - bot.born.get('chopper')) / 1000 > after + 6) { try { chopper.take(1e6, null, 'rocket', chopper.position); killed++; } catch { /* not that kind */ } }
  } else bot.born.delete('chopper');
  return killed;
}

/** Actor: stands in the middle of a zone, on its floor. */
function goTo(zone) {
  const { ctx } = window.__op2;
  const p = ctx.player;
  if (p.parked) return false;
  const at = p.position.clone().set((zone.min[0] + zone.max[0]) / 2, zone.min[1] + 0.3, (zone.min[2] + zone.max[2]) / 2);
  const snapped = at.clone();
  // The floor under the zone's middle, if the nav has one inside the box.
  if (ctx.world.nav.nearest?.(at, 6, snapped) && snapped.x >= zone.min[0] && snapped.x <= zone.max[0] && snapped.z >= zone.min[2] && snapped.z <= zone.max[2]
    && snapped.y >= zone.min[1] - 0.5 && snapped.y <= zone.max[1]) at.copy(snapped);
  at.y = Math.max(at.y, zone.min[1] + 0.05);
  p.teleport(at, p.yaw);
  return true;
}

/** Actor: walks over the first rack standing on this screen. */
function takeRack() {
  const { ctx, campaign } = window.__op2;
  const rack = campaign.host.racks.racks[0];
  if (!rack || ctx.player.parked) return null;
  const at = rack.mesh.position.clone();
  at.y -= 0.9;
  ctx.player.teleport(at, ctx.player.yaw);
  return rack.weapon;
}

const tapKey = (page, key, ms = 220) => page.evaluate(([key, ms]) => {
  const { input } = window.__op2.ctx;
  input.simulate(key, true);
  setTimeout(() => input.simulate(key, false), ms);
}, [key, ms]);

export default async function (host, { sleep, outDir }) {
  const out = { tag: TAG, mission: MISSION, actor: ACTOR, players: PLAYERS, sim: SIM ?? null, extras: EXTRAS, errors: [], checks: [], screenshots: [], beats: [], soft: [], timeline: [] };
  const { check, progress } = kit(outDir, TAG, out, sleep);
  // JPEG: a 2880x1800 PNG takes a page's main thread for a second or more, and a stalled page is a late screen.
  const shot = async (page, name) => {
    // COOP_SHOTS=0: none while the mission runs (a capture can stall a page on a busy machine); the end and a failure still get theirs.
    if (process.env.COOP_SHOTS === '0' && !/^(end|failure|restart|rejoin)/.test(name)) return;
    const path = `${outDir}/${TAG}-${name}.jpg`;
    // The kit draws fresh frames for any screenshot of a fast page.
    await page.screenshot({ path, type: 'jpeg', quality: 88, timeout: 120000 });
    out.screenshots.push(path);
  };
  /** A difference worth writing down that is another lane's to close, or a matter of a frame: recorded, not failed. */
  const note = (ok, message, detail) => { if (ok) out.checks.push(message); else out.soft.push({ message, detail }); };
  let party;
  const started = Date.now();
  const write = () => writeFileSync(`${outDir}/${TAG}-evidence.json`, JSON.stringify(out, null, 2));
  try {
    if (BEAT) await host.addInitScript(beat => { try { sessionStorage.setItem('op2.dev.beat', beat); } catch { /* no storage: from the top */ } }, BEAT);
    party = await startParty(host, { mode: MISSION, players: PLAYERS, net: SIM, clock: process.env.COOP_LOOK === '1' ? 0 : Number(process.env.COOP_CLOCK ?? 30), startNow: false, out, progress, sleep });
    // Start only once the host has every guest's "ready": under a simulated lag it arrives late, and the host refuses a Start before it.
    await host.waitForFunction(n => document.querySelectorAll('.co-player').length >= n && /Everyone is ready/.test(document.body.textContent ?? ''), PLAYERS, { timeout: 60000 });
    await button(host, party.mode.label).click();
    await sleep(300);
    await button(host, 'Start').click();
    progress(`countdown to ${party.mode.label}`);
    await inMatch(party.pages, party.mode.contract, true);
    for (const page of party.pages) await page.evaluate(install);
    // What each screen's console says about co-op, and every error.
    out.console = [];
    const listen = (page, name) => page.on('console', m => {
      const text = m.text();
      if ((m.type() === 'error' || text.includes('[coop]') || text.includes('[campaign]')) && !text.includes('LOOPBACK') && out.console.length < 200) out.console.push(`${name} ${Math.round((Date.now() - started) / 1000)}s: ${text.slice(0, 300)}`);
    });
    listen(host, 'host'); party.guests.forEach((g, i) => listen(g, `guest${i + 1}`));
    let guests = [...party.guests];
    const actor = () => (ACTOR === 'guest' ? guests[0] : host);
    const data = await host.evaluate(plan);
    out.plan = data.beats.map(b => [b.id, b.zones.join('+')]);
    progress(`in ${data.id}: ${data.beats.length} sections; the ${ACTOR} acts; ${PLAYERS} players${SIM ? `; ${SIM}` : ''}`);

    const all = async () => Promise.all([host, ...guests].map(page => page.evaluate(look).catch(error => ({ error: String(error) }))));
    const dist = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
    /** One guest's screen against the host's, now. */
    const compare = (h, g, where, name) => {
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check(g.title === h.title, `${where}: ${name} sees the section "${h.title}"`, [h.title, g.title]);
      check(same(g.objectives, h.objectives), `${where}: ${name}'s objectives are the host's`, [h.objectives, g.objectives]);
      check(same(g.doors, h.doors), `${where}: ${name}'s doors stand as the host's`, [h.doors, g.doors]);
      check(g.lights === h.lights, `${where}: ${name}'s lights are the host's (${h.lights})`, [h.lights, g.lights]);
      // A perk or a seat may have its own grade over the mission's: written down, not failed.
      if (h.lights === 'emergency') note(g.dark, `${where}: ${name}'s picture is in the blackout grade`, g.dark);
      check(g.sky === h.sky, `${where}: the sky is ${h.sky ? 'shut' : 'open'} for ${name} too`, [h.sky, g.sky]);
      check(same(g.weapons, h.weapons), `${where}: ${name} carries the kit the host carries`, [h.weapons, g.weapons]);
      check(same(g.racks, h.racks), `${where}: ${name} has the racks the host has`, [h.racks, g.racks]);
      check(g.runner !== 'running', `${where}: ${name}'s own runner is idle`, g.runner);
    };
    /** The lines each guest has heard against the host's: the same ids in the same order, each within a second and a half. */
    const linesInStep = (h, g, where, name) => {
      // The same ids in the same order on both screens. In a proof that starts mid-mission either screen may hold a line or two
      // at the head that was said as the watching began (the other's watch started a moment later), and the host may be one ahead
      // at the tail (still crossing).
      const hAll = h.lines.map(l => l[0]), gAll = g.lines.map(l => l[0]);
      let lead = null;
      for (let ho = 0; ho <= 2 && !lead; ho++) for (let go = 0; go <= 2 && !lead; go++) {
        const a = hAll.slice(ho), b = gAll.slice(go);
        if (a.length - b.length >= 0 && a.length - b.length <= 1 && JSON.stringify(a.slice(0, b.length)) === JSON.stringify(b)) lead = [ho, go];
      }
      check(!!lead, `${where}: ${name} heard the host's ${hAll.length} lines in order`, [hAll, gAll]);
      h = { ...h, lines: h.lines.slice(lead[0]) };
      g = { ...g, lines: g.lines.slice(lead[1]) };
      const hi = h.lines.map(l => l[0]), gi = g.lines.map(l => l[0]);
      const upTo = Math.min(hi.length, gi.length);
      // In step: the typical line starts within half a second of the host's. A screenshot stalls a page for a second or two, so
      // the odd line that crossed one is late on that screen alone: those are counted and written down, never hidden.
      const lags = [];
      for (let i = 0; i < upTo; i++) lags.push([Math.abs(g.lines[i][1] - h.lines[i][1]), gi[i]]);
      const sorted = lags.map(l => l[0]).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const late = lags.filter(l => l[0] >= 1500);
      const worst = sorted.at(-1) ?? 0;
      // Timing is the game's only when the pages were running: a page the machine froze for a second or more says nothing about
      // the wire. Then the numbers are written down and the section is marked not measured.
      const stalled = Math.max(h.gap?.worst ?? 0, g.gap?.worst ?? 0) >= 1000;
      (out.lineLags ??= {})[where] = { median, worst, late, stalled, gaps: [h.gap?.worst, g.gap?.worst] };
      if (stalled) out.soft.push({ message: `${where}: line timing not measured for ${name}: a page stalled`, detail: { median, worst, gaps: [h.gap?.worst, g.gap?.worst] } });
      else {
        check(median < 500, `${where}: ${name}'s lines start with the host's (median ${median} ms apart)`, { median, worst, late });
        check(late.length <= 2, `${where}: at most two of ${name}'s ${upTo} lines were over 1.5 s late (${late.length})`, late);
      }
      return worst;
    };

    let beat = null, beatAt = 0, zoneIndex = 0, zoneAt = 0, lastFire = 0, lastReap = 0, restarted = false, rejoined = false, votes = 0, row = null;
    let filmSeen = 0, rideSeen = 0, lineLag = 0, unread = 0, arrived = null, won = null, stopped = false;
    let rejoinCounts = { saved: 0, hints: 0, banners: 0 }, rejoinIndex = -1;
    const deadline = Date.now() + (Number(process.env.COOP_LIMIT ?? 1400)) * 1000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`the mission did not end in time: ${JSON.stringify(row)}`);
      const [h, ...gs] = await all();
      if (h.error || gs.some(g => g.error)) {
        if (++unread > 20) throw new Error(`a page stopped answering: ${JSON.stringify([h.error, gs.map(g => g.error)])}`);
        await sleep(500); continue;
      }
      unread = 0;
      // Won: the last section's row is closed and the end is read while the board is up (15 s later everyone is in the lobby).
      if (h.runner === 'won' || h.board) {
        if (row) {
          row.seconds = Math.round((Date.now() - beatAt) / 100) / 10;
          row.load = Math.round(loadavg()[0]);
          out.beats.push(row);
          for (const [i, g] of gs.entries()) lineLag = Math.max(lineLag, linesInStep(h, g, row.id, `guest ${i + 1}`));
        }
        won = { h, gs };
        break;
      }
      for (const [i, g] of gs.entries()) if (g.lobby !== 'open') throw new Error(`guest ${i + 1} lost the match in ${beat}: ${JSON.stringify({ lobby: g.lobby, error: g.lobbyError, gap: g.gap, blame: g.blame, hostGap: h.gap, hostBlame: h.blame })}`);
      if (row) {
        row.gaps = [h.gap?.worst, ...gs.map(g => g.gap?.worst)];
        row.fpsLeast = [h, ...gs].map((p, i) => Math.min(row.fpsLeast?.[i] ?? 999, p.fps));
        row.blame = [h.blame, ...gs.map(g => g.blame)];
      }
      const now = Date.now();
      // ---- A new section: close the last one's row, open this one's.
      if (h.beat !== beat) {
        if (row) {
          row.seconds = Math.round((now - beatAt) / 100) / 10;
          row.load = Math.round(loadavg()[0]);
          out.beats.push(row);
          write();
          for (const line of data.beats.find(b => b.id === row.id)?.shotLines ?? []) {
            const heard = [h, ...gs].map(p => p.lines.some(l => l[0] === line));
            check(heard.every(Boolean), `${row.id}: "${line}" waits on a shot, and the ${ACTOR}'s shot brought it on every screen`, heard);
          }
          for (const [i, g] of gs.entries()) {
            lineLag = Math.max(lineLag, linesInStep(h, g, row.id, `guest ${i + 1}`));
          }
        }
        if (h.runner === 'won' || h.beat === null && beat !== null) break;
        if (STOP && h.beat === STOP) { stopped = true; break; }
        // The section ended with the actor in the zone that ends it: the others are due beside them.
        if (row?.arrivedAt) arrived = { from: row.id, at: now };
        beat = h.beat; beatAt = now; zoneIndex = 0; zoneAt = 0;
        row = { id: beat, title: h.title, at: Math.round((now - started) / 1000), checked: false, regrouped: null, enemiesMost: 0, guestEnemiesMost: 0, vehiclesMost: [0, 0] };
        progress(`section ${beat} (${h.title}) at ${row.at}s`);
        // Each section's stalls are its own.
        for (const page of [host, ...guests]) await page.evaluate(() => { if (window.__bot?.gap) { window.__bot.gap.worst = 0; window.__bot.gap.over2s = 0; window.__bot.blame = {}; } }).catch(() => {});
      }
      const info = data.beats.find(b => b.id === beat);
      const age = (now - beatAt) / 1000;
      if (age > BEAT_LIMIT) throw new Error(`stuck in ${beat} for ${Math.round(age)}s: ${JSON.stringify({ h: { ...h, lines: h.lines.length }, tags: await host.evaluate(() => window.__op2.campaign.runner.describe()) })}`);
      row.enemiesMost = Math.max(row.enemiesMost, h.enemies.length);
      row.guestEnemiesMost = Math.max(row.guestEnemiesMost, ...gs.map(g => g.enemies.length));
      row.vehiclesMost = [Math.max(row.vehiclesMost[0], h.vehicles), Math.max(row.vehiclesMost[1], ...gs.map(g => g.vehicles))];

      // ---- Films and rides: on every screen while they are on the host's.
      if (h.film) {
        filmSeen++;
        if (filmSeen === 6) {
          for (const [i, g] of gs.entries()) check(g.film, `${beat}: the film plays on guest ${i + 1}'s screen`, g.film);
          await shot(guests[0], `${beat}-film-guest`, true);
        }
        if (EXTRAS.skip && filmSeen > 8 && votes < party.pages.length) {
          // One vote at a time, the actor's first: it must take every player's to end it.
          const order = [actor(), ...[host, ...guests].filter(p => p !== actor())];
          await tapKey(order[votes], 'interact');
          votes++;
          await sleep(700);
          const [h2, ...g2] = await all();
          if (votes < order.length) check(h2.film && g2.every(g => g.film), `${beat}: ${votes} of ${order.length} votes do not skip the film`, votes);
          else {
            check(!h2.film && g2.every(g => !g.film), `${beat}: every player voted, and the film ended on every screen`, [h2.film, g2.map(g => g.film)]);
            row.skipped = true;
          }
        }
      } else { if (filmSeen > 0) { for (const [i, g] of gs.entries()) note(!g.film, `${beat}: the film ended on guest ${i + 1}'s screen with the host's`, g.film); } filmSeen = 0; votes = 0; }
      if (h.riding && h.parked) {
        rideSeen++;
        if (rideSeen === 8) {
          for (const [i, g] of gs.entries()) check(g.parked && g.riding, `${beat}: guest ${i + 1} is in the ride too`, [g.parked, g.riding]);
          await shot(guests[0], `${beat}-ride-guest`, true);
        }
      } else if (rideSeen > 0 && !h.riding) {
        rideSeen = 0;
        await sleep(1500);
        const [, ...g2] = await all();
        for (const [i, g] of g2.entries()) check(!g.riding, `${beat}: the ride ended for guest ${i + 1} when the host's did`, [g.riding, g.parked]);
        row.rideEnded = true;
      }

      // ---- The section's checks on every guest, once its opening has had time to cross.
      if (!row.checked && age > 3 && !h.film) {
        row.checked = true;
        for (const [i, g] of gs.entries()) compare(h, g, beat, `guest ${i + 1}`);
        row.host = { objectives: h.objectives, doors: h.doors, weapons: h.weapons, sky: h.sky, racks: h.racks, pos: h.pos };
        row.guest = { objectives: gs[0].objectives, weapons: gs[0].weapons, pos: gs[0].pos, mirrored: gs[0].mirrored };
        if (!(h.riding && h.parked)) await shot(guests[0], `${beat}-guest`, true);
      }
      // Enemies: every one of the host's is on each guest's screen within a snapshot or two.
      if (age > 3 && h.enemies.length > 0 && !row.enemiesChecked && now - lastReap > 800) {
        const missing = gs.map(g => h.enemies.filter(uid => !g.enemies.includes(uid)).length);
        if (missing.every(m => m <= Math.max(1, Math.floor(h.enemies.length * 0.25)))) {
          row.enemiesChecked = [h.enemies.length, gs.map(g => g.enemies.length)];
          out.checks.push(`${beat}: the host's ${h.enemies.length} enemies are on every guest's screen`);
        }
      }

      // ---- Extras.
      if (EXTRAS.restart === beat && !restarted && age > 12 && !h.film && !h.parked) {
        restarted = true;
        progress(`restart: everyone down in ${beat}`);
        const before = await all();
        for (const page of [host, ...guests]) await page.evaluate(() => {
          const { ctx } = window.__op2;
          window.__bot.god = false;
          ctx.player.modifiers.invulnerable = false;
          // A hazard: the one kind of damage a guest's own screen may deal itself (the rest is the host's word).
          ctx.player.takeDamage({ amount: 1e6, type: 'hazard', source: 'test' });
        });
        // Down, not dead: the wipe is at once when nobody is up.
        await sleep(2500);
        for (const page of [host, ...guests]) await page.evaluate(() => { window.__bot.god = true; });
        await sleep(3500);
        const [h2, ...g2] = await all();
        check(h2.deaths === before[0].deaths + 1 && h2.runner === 'running', 'restart: the host went back to the checkpoint', [h2.deaths, h2.runner, h2.beat]);
        const cp = data.beats.slice(0, data.beats.findIndex(b => b.id === h2.beat) + 1).reverse().find(b => b.checkpoint);
        const mark = cp ? data.marks[cp.checkpoint.at].at : null;
        for (const [i, g] of g2.entries()) {
          const name = `guest ${i + 1}`;
          check(g.alive && !g.downed && g.health > 50, `restart: ${name} is on their feet`, [g.alive, g.downed, g.health]);
          if (mark) check(Math.hypot(g.pos[0] - mark[0], g.pos[2] - mark[2]) < 8, `restart: ${name} stands at the checkpoint`, [g.pos, mark]);
          compare(h2, g, 'restart', name);
          check(g.grenades === h2.grenades, `restart: ${name} has the checkpoint's grenades`, [h2.grenades, g.grenades]);
          // The run was rebuilt six seconds ago: what lies there now fell since (a war goes on beside the team), as on the host's.
          check(g.corpses === null || g.corpses <= (h2.corpses ?? 0) + 2, `restart: ${name}'s screen has no corpses from before (${before[i + 1].corpses} before, ${g.corpses} now, the host ${h2.corpses})`, [before[i + 1].corpses, g.corpses, h2.corpses]);
          check(g.score <= before[i + 1].score, `restart: the Council took its cut of ${name}'s score too`, [before[i + 1].score, g.score]);
          check(g.enemies.every(uid => h2.enemies.includes(uid)) , `restart: ${name} has no enemies the host does not`, [h2.enemies.length, g.enemies.length]);
        }
        const feeds = await Promise.all([host, ...guests].map(p => p.evaluate(() => window.__bot.feed.filter(f => f.includes('CHECKPOINT')))));
        check(feeds.every(f => f.length > 0), 'restart: every screen was told the team went back to the checkpoint', feeds);
        await shot(guests[0], 'restart-guest', true); await shot(host, 'restart-host', true);
        out.restart = { beat, host: { pos: h2.pos, weapons: h2.weapons, deaths: h2.deaths }, guests: g2.map(g => ({ pos: g.pos, weapons: g.weapons, score: g.score })) };
        beat = null; row = null;
        continue;
      }
      if (EXTRAS.rejoin === beat && !rejoined && age > 10 && !h.film && !h.parked) {
        rejoined = true;
        progress(`rejoin: guest 1 leaves in ${beat} and comes back by the link`);
        const gone = guests[0];
        await gone.close();
        party.guests.splice(party.guests.indexOf(gone), 1); party.pages.splice(party.pages.indexOf(gone), 1);
        await sleep(2500);
        // The same player comes back (their callsign is their seat), into a match that is running.
        const back = await openGuest(party, { name: 'GUEST-TWO', late: true });
        await inMatch([back], party.mode.contract, true);
        await back.evaluate(install);

        guests = [...party.guests];
        await sleep(3000);
        const [h2, ...g2] = await all();
        const g = g2[guests.indexOf(back)];
        compare(h2, g, 'rejoin', 'the returning guest');
        check(dist(h2, g) < 12, 'rejoin: the returning guest is put beside the host', [h2.pos, g.pos]);
        check(g.grenades >= 0 && g.weapons.length >= 2, 'rejoin: the returning guest has the mission\'s kit', g.weapons);
        await shot(back, 'rejoin-guest', true);
        out.rejoin = { beat, host: { pos: h2.pos, weapons: h2.weapons, doors: h2.doors, sky: h2.sky }, guest: { pos: g.pos, weapons: g.weapons, doors: g.doors, sky: g.sky } };
        rejoinCounts = { saved: h2.saved, hints: h2.hints, banners: h2.banners.length };
        rejoinIndex = guests.indexOf(back);
        // The lines said before they came back are not theirs to have heard.
        await host.evaluate(() => { window.__bot.lines.length = 0; });
        for (const page of guests) await page.evaluate(() => { window.__bot.lines.length = 0; });
        continue;
      }

      // ---- The bot plays.
      if (!h.film && !h.parked) {
        const a = actor();
        // A gun on a rack, as soon as the section has opened.
        if (age > 5 && h.racks.length > 0) {
          const took = await a.evaluate(takeRack);
          if (took) {
            await sleep(1200);
            const [h2, ...g2] = await all();
            check(h2.weapons.includes(took) && g2.every(g => g.weapons.includes(took)), `${beat}: the ${ACTOR} took the ${took} off its rack and every player has one`, [h2.weapons, g2.map(g => g.weapons)]);
            check(!h2.racks.includes(took) && g2.every(g => !g.racks.includes(took)), `${beat}: the ${took}'s rack is gone from every screen`, [h2.racks, g2.map(g => g.racks)]);
            continue;
          }
        }
        // A shot now and then: some lines wait on one.
        if (now - lastFire > (info.shotLines.length ? 2500 : 6000)) { lastFire = now; await tapKey(a, 'fire', 250); }
        // The section's zones, in the script's order, a few seconds in each.
        if (info.zones.length > 0 && age > (info.shotLines.length ? 30 : ZONE_AFTER) && now - zoneAt > ZONE_DWELL * 1000) {
          const zone = info.zones[zoneIndex % info.zones.length];
          if (await a.evaluate(goTo, data.zones[zone])) {
            zoneAt = now; zoneIndex++;
            row.walked = [...(row.walked ?? []), zone];
            if (info.arrival.includes(zone)) row.arrivedAt = now;
          }
        }
      }
      // Nobody is left behind: the section changed with the actor standing in the zone that ends it; ten seconds (and a little)
      // later every player is with them, wherever the mission has got to since.
      if (arrived && now - arrived.at > 13500 && !h.parked && !h.film) {
        const lead = ACTOR === 'guest' ? gs[0] : h;
        const apart = [h, ...gs].map(p => Math.round(dist(p, lead)));
        (out.regroups ??= []).push({ from: arrived.from, apart });
        check(apart.every(d => d < 40), `${arrived.from}: nobody was left behind: ten seconds after the ${ACTOR} reached the next section every player is with them`, apart);
        arrived = null;
      }
      // The dev kill, on the host, of whatever has had its few seconds.
      if (now - lastReap > 1000) { lastReap = now; row.killed = (row.killed ?? 0) + await host.evaluate(reap, [KILL_AFTER, info.boss]); }
      await sleep(400);
    }

    if (stopped) {
      out.seconds = Math.round((Date.now() - started) / 1000);
      check(out.errors.length === 0, 'no page exceptions on any screen', out.errors);
      progress(`stopped at ${STOP} after ${out.seconds}s: ${out.checks.length} checks, ${out.soft.length} notes`);
      return { tag: TAG, checks: out.checks.length, soft: out.soft, seconds: out.seconds };
    }
    // ---- The end: the board on every screen, with the mission's numbers.
    await sleep(1500);
    const [h, ...gs] = await all();
    if (h.error || gs.some(g => g.error)) throw new Error(`a page stopped answering at the end: ${JSON.stringify([h.error, gs.map(g => g.error)])}`);
    const due = data.beats.length - Math.max(0, data.beats.findIndex(b => b.id === BEAT));
    check(out.beats.length >= due - 1, `every section${BEAT ? ` from ${BEAT}` : ''} was played: ${out.beats.map(b => b.id).join(', ')}`, [out.beats.length, due]);
    for (const [i, g] of gs.entries()) {
      check(g.board, `the end: guest ${i + 1} has the team board`, [g.board, g.complete]);
      check(!!g.result && g.result.title === h.result?.title, `the end: guest ${i + 1} has the mission's result for the board`, [h.result, g.result]);
      // A page that joined part way (the rejoin) has only what was shown since: counted from then on both screens.
      const since = rejoined && i === rejoinIndex ? rejoinCounts : { saved: 0, hints: 0, banners: 0 };
      check(g.saved === h.saved - since.saved && g.saved > 0, `guest ${i + 1} saw every checkpoint notice (${h.saved - since.saved})`, [h.saved, since.saved, g.saved]);
      note(g.banners.length === h.banners.length - since.banners, `guest ${i + 1} saw the host's ${h.banners.length - since.banners} banners`, [h.banners, g.banners]);
      check(g.hints >= h.hints - since.hints - 1, `guest ${i + 1} saw the host's ${h.hints - since.hints} hints`, [h.hints, since.hints, g.hints]);
      if (MISSION === 'foreclosure') note(g.comms > 0, `guest ${i + 1}'s comms feed had the war's call-outs`, [h.comms, g.comms]);
    }
    note(h.board && !h.complete, 'the end: the host has the team board, not the solo screen (the team lane\'s D2)', [h.board, h.complete]);
    out.end = { host: { result: h.result, lines: h.lines.length, hints: h.hints, saved: h.saved, banners: h.banners.length, fps: h.fps }, guests: gs.map(g => ({ result: g.result, lines: g.lines.length, hints: g.hints, saved: g.saved, mirrored: g.mirrored, fps: g.fps })), lineLagMs: lineLag };
    await shot(guests[0], 'end-guest', true); await shot(host, 'end-host', true);
    out.seconds = Math.round((Date.now() - started) / 1000);
    check(out.errors.length === 0, 'no page exceptions on any screen', out.errors);
    progress(`done in ${out.seconds}s: ${out.checks.length} checks, ${out.soft.length} notes`);
    return { tag: TAG, checks: out.checks.length, soft: out.soft, seconds: out.seconds, beats: out.beats.map(b => [b.id, b.seconds]) };
  } catch (error) {
    out.failure = error.stack ?? String(error);
    try { await shot(host, 'failure-host', true); if (party?.guests[0]) await shot(party.guests[0], 'failure-guest', true); } catch { /* the page is gone */ }
    throw error;
  } finally {
    write();
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
