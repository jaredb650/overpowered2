// Every mode from a guest's seat: one scripted session per mode, the nearest thing a script gets to a playtest. Three pages
// by default: the host, guest A (the seat every picture is taken from) and guest B (who watches). In order:
//
//   fight     a real fight: enemy attacks are played on A's screen (wind-ups, flashes, sounds), and the host's damage reaches A
//   kills     A kills an enemy: A is paid and scored, nobody else; then the host kills one: the host is, A is not. The other
//             screens' kill feeds name the killer. Gore: every screen wounds and drops the body A shot
//   slowmo    A's Focus slows every screen, and every screen says who ("GUEST-TWO used Focus")
//   callin    A calls an airstrike: the host flies a copy of it, draws its blasts, and the kills are A's
//   gun       the host drops a modded Deuce: A sees it with its marker, takes it with E, holds it with its mods and rounds
//   revive    A goes down, every screen says so; the host holds E on them and A gets up where they lay
//   break     survival modes: the wave is cleared for real, every screen is in the break with the same supply pod at the same
//             spot, and each player buys from their own purse (Outpost Defense: its own shop screen). Missions: a weapon cache,
//             the same on every screen, a share each
//   rejoin    A's page reloads and comes back into the same match with its guns, credits and kills
//   ending    survival: the whole team goes down and every screen gets the team board. Missions: the mission is won and
//             every screen gets MISSION COMPLETE
//
// A step that fails is written down and the session goes on, so one run says everything that is wrong in a mode; the run
// fails at the end. A picture from A's eyes at each step, at the owner's screen size, with the page as a player has it.
//
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 1500 \
//     --script tools/scripts/coop-guest-seat.mjs --out tools/out/coop/<you>/seat.png
//   COOP_MODE=crucible|outpost|defense|campaign|foreclosure   COOP_MAP=office   COOP_PLAYERS=2|3|4
//   COOP_SIM=lag:120,jitter:40,loss:0.05   COOP_NET=rtc   SEAT_ONLY=fight,kills (some steps)   SEAT_FAST=1 (fast mode, no pictures drawn between shots)
import { writeFileSync } from 'node:fs';
import { button, give, inMatch, kit, live, startParty, state, teleport } from './coop-kit.mjs';
import { record as recordAttacks } from './coop-attacks-kit.mjs';
import { down, ending, hudText, recorder as recordSaid } from './coop-team-kit.mjs';

const MODE = process.env.COOP_MODE ?? 'crucible', MAP = process.env.COOP_MAP || undefined;
const PLAYERS = Number(process.env.COOP_PLAYERS ?? 3);
const SIM = process.env.COOP_SIM || undefined;
const ONLY = process.env.SEAT_ONLY ? new Set(process.env.SEAT_ONLY.split(',')) : null;
const MISSION = MODE === 'campaign' || MODE === 'foreclosure';
/** Where the host's mission starts (a dev server's switch): a section with a fight in it and the sky still open. */
const SECTION = { campaign: 'softskins', foreclosure: 'market' }[MODE];
const SLOW = SIM ? 2 : 1;

/** Runs in each page: what its gore, blood and blasts were asked to do, by enemy. */
function recordGore() {
  if (window.__seat) return;
  const { ctx } = window.__op2;
  const log = [];
  const uids = new WeakMap();
  const uidOf = char => { for (const e of ctx.enemies.alive) uids.set(e.char, e.uid); return uids.get(char) ?? -1; };
  const wrap = (object, name, tell) => {
    const real = object[name];
    if (typeof real !== 'function') return;
    object[name] = function (...args) { try { tell(...args); } catch { /* never the game's problem */ } return real.apply(this, args); };
  };
  wrap(ctx.gore, 'wound', char => log.push({ k: 'wound', uid: uidOf(char) }));
  for (const death of ['ragdoll', 'collapse', 'headshot', 'gib', 'slice', 'vaporize']) wrap(ctx.gore, death, char => log.push({ k: 'death', uid: uidOf(char), how: death }));
  for (const fx of ['bloodPuff', 'bloodHit', 'bloodSpray', 'bloodMist']) wrap(ctx.fx, fx, () => log.push({ k: 'blood' }));
  wrap(ctx.fx, 'explosion', at => log.push({ k: 'boom', at: [at.x, at.y, at.z] }));
  ctx.events.on('enemy:killed', e => log.push({ k: 'killed', uid: e.enemy.uid, mine: !ctx.coop.world.notMine(e.enemy), source: e.damage?.source }));
  window.__seat = { log };
}
const goreMark = page => page.evaluate(() => window.__seat.log.length);
const goreSince = (page, from, uid) => page.evaluate(([from, uid]) => {
  const log = window.__seat.log.slice(from);
  const count = (k, own) => log.filter(e => e.k === k && (!own || e.uid === uid)).length;
  return { wounds: count('wound', true), deaths: count('death', true), blood: count('blood'), booms: count('boom'), killed: log.filter(e => e.k === 'killed').map(e => [e.uid, e.mine, e.source]) };
}, [from, uid]);

/** A page's player as the game holds it. */
const me = page => page.evaluate(() => {
  const { ctx, game } = window.__op2;
  const w = ctx.weapons;
  return { state: game.state, slot: ctx.coop.lobby.me.slot, name: ctx.coop.lobby.me.name, at: ctx.player.position.toArray(), alive: ctx.player.alive, downed: ctx.player.downed === true,
    health: Math.round(ctx.player.health), kills: ctx.progression.kills, credits: ctx.contracts?.wallet?.credits ?? null, guns: [...w.owned].sort(), current: w.current,
    wave: ctx.waves.wave, phase: ctx.waves.phase, enemies: ctx.enemies.alive.length, parked: !!ctx.player.parked };
});

/** The enemy nearest a page's player that is alive on the host too, and a spot `metres` from it with a clear line. */
const nearest = (host, page, metres = 9) => page.evaluate(async metres => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  let best = null, bestD = Infinity;
  for (const e of ctx.enemies.alive) {
    if (e.dummy || e.health <= 0) continue;
    const d = e.position.distanceToSquared(ctx.player.position);
    if (d < bestD) { best = e; bestD = d; }
  }
  if (!best) return null;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const at = new V(best.position.x + Math.cos(a) * metres, best.position.y, best.position.z + Math.sin(a) * metres);
    const snapped = at.clone();
    if (ctx.world.nav.nearest?.(at, 3, snapped)) at.copy(snapped);
    if (Math.abs(at.y - best.position.y) > 1.5) continue;
    const eye = at.clone(); eye.y += 1.6;
    const dir = best.center.clone().sub(eye); const range = dir.length();
    if (!ctx.physics.raycast(eye, dir.divideScalar(range), range - 1, 1)) return { uid: best.uid, kind: best.kind ?? best.def?.id ?? '', at: at.toArray(), enemy: best.position.toArray() };
  }
  return { uid: best.uid, kind: best.kind ?? best.def?.id ?? '', at: null, enemy: best.position.toArray() };
}, metres);

/** Turns a player to a point. */
const face = (page, target) => page.evaluate(target => {
  const { ctx } = window.__op2; const V = ctx.player.position.constructor;
  const d = new V(...target).sub(ctx.player.eye);
  ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(d.y, Math.hypot(d.x, d.z))));
}, target);

/** A point `metres` in front of where a page's player stands now, on the nav mesh, level with them. */
const front = (page, metres, side = 0) => page.evaluate(([metres, side]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const p = ctx.player.position, yaw = ctx.player.yaw;
  const at = new V(p.x - Math.sin(yaw) * metres + Math.cos(yaw) * side, p.y, p.z - Math.cos(yaw) * metres - Math.sin(yaw) * side);
  const snapped = at.clone();
  if (ctx.world.nav.nearest?.(at, 4, snapped)) at.copy(snapped);
  return at.toArray();
}, [metres, side]);

/** Host: a still, harmless enemy at a point (the kit's `dummy`, for any mode). */
const still = (host, at, kind = 'husk') => host.evaluate(([at, kind]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const enemy = ctx.enemies.spawn(kind, new V(...at));
  if (!enemy) return -1;
  enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true;
  return enemy.uid;
}, [at, kind]);

/** Holds fire at one enemy until the host says it is dead, re-aiming. True if it died. */
async function kill(shooter, host, uid, sleep, seconds = 20) {
  await shooter.evaluate(() => { const { ctx, game } = window.__op2; if (game.state !== 'playing') game.setState('playing'); ctx.weapons.refillMagazines(); });
  for (const end = Date.now() + seconds * 1000; Date.now() < end;) {
    if (await host.evaluate(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid)) break;
    const there = await shooter.evaluate(uid => {
      const { ctx } = window.__op2; const enemy = ctx.enemies.alive.find(e => e.uid === uid);
      if (!enemy) { ctx.input.simulate('fire', false); return false; }
      const d = enemy.center.clone().sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      ctx.weapons.refillMagazines(); ctx.input.simulate('fire', true);
      return true;
    }, uid);
    await sleep(there ? 80 : 150);
  }
  await shooter.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  return host.evaluate(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid);
}

/** One press of an action until `done` holds on the page. */
async function press(page, action, sleep, done, arg, tries = 20) {
  for (let i = 0; i < tries; i++) {
    await page.evaluate(a => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate(a, true); }, action);
    await sleep(120);
    await page.evaluate(a => window.__op2.ctx.input.simulate(a, false), action);
    await sleep(250);
    if (await page.evaluate(done, arg)) return true;
  }
  return false;
}

const pods = page => page.evaluate(() => {
  const set = window.__op2.ctx.progression.pods;
  return set.pods.filter(p => p.phase !== 'spent').map(p => ({ id: p.id, phase: p.phase, at: p.entry.position.toArray(), supply: set.supply, taken: !!p.taken }));
});

export default async function (host, { sleep, outDir }) {
  const tag = `seat-${MODE}${MAP ? `-${MAP}` : ''}-${PLAYERS}p${SIM ? '-bad' : ''}`;
  const out = { mode: MODE, map: MAP ?? '', players: PLAYERS, sim: SIM ?? 'none', transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], failed: [], screenshots: [], steps: {} };
  const tools = kit(outDir, tag, out, sleep);
  const { progress } = tools;
  let stepName = 'start';
  /** A check that is written down and does not stop the session. */
  const check = (condition, message, detail) => {
    const line = `${stepName}: ${message}`;
    if (condition) out.checks.push(line);
    else { out.failed.push({ message: line, detail }); progress(`FAILED ${line} :: ${JSON.stringify(detail)?.slice(0, 500)}`); }
    return !!condition;
  };
  const write = () => writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
  let party, pages = [host], A = null, B = null;
  /** A picture from the guest's eyes (and, where it says so, the host's). */
  const shot = async (name, page = A, keepMenu = false) => { try { await tools.shot(page, name, keepMenu); } catch (error) { out.errors.push(`screenshot ${name}: ${String(error).slice(0, 200)}`); } };
  const step = async (name, run) => {
    if (ONLY && !ONLY.has(name)) return;
    stepName = name;
    const started = Date.now(), before = out.failed.length;
    progress(`--- ${name}`);
    try { out.steps[name] = { ...(await run() ?? {}) }; }
    catch (error) {
      out.failed.push({ message: `${name}: the step broke off: ${String(error?.message ?? error).split('\n')[0].slice(0, 400)}`, detail: String(error?.stack ?? error).slice(0, 1500) });
      progress(`FAILED ${name}: ${String(error?.message ?? error).split('\n')[0].slice(0, 300)}`);
      out.steps[name] = { broke: true };
      for (const [i, page] of pages.entries()) await page.screenshot({ path: `${outDir}/${tag}-broke-${name}-${i}.png`, timeout: 30000 }).catch(() => {});
    }
    out.steps[name].seconds = Math.round((Date.now() - started) / 100) / 10;
    out.steps[name].ok = out.failed.length === before;
    // Whatever a step left behind, the next one starts in play with nobody holding a key.
    for (const page of pages) await page.evaluate(() => { const { ctx, game } = window.__op2; for (const a of ['fire', 'interact', 'forward', 'sonar']) ctx.input.simulate(a, false); if (game.state === 'paused') game.setState('playing'); }).catch(() => {});
    write();
  };
  const everyone = fn => Promise.all(pages.map(fn));
  const invulnerable = on => everyone(page => page.evaluate(v => { window.__op2.ctx.player.modifiers.invulnerable = v; }, on));

  try {
    if (MISSION) await host.addInitScript(beat => { try { sessionStorage.setItem('op2.dev.beat', beat); } catch { /* from the top */ } }, SECTION);
    party = await startParty(host, { mode: MODE, map: MAP, players: PLAYERS, net: SIM, look: process.env.SEAT_FAST !== '1', out, progress, sleep });
    pages = party.pages; [A, B] = party.guests; B ??= host;
    if (MISSION) {
      await inMatch(pages, party.mode.contract, true);
      await invulnerable(true);
    } else await live(party, { enemies: 3 });
    for (const page of pages) { await page.evaluate(recordSaid); await page.evaluate(recordAttacks); await page.evaluate(recordGore); await give(page, 'smg'); }
    for (const page of pages) await page.waitForFunction(() => window.__op2.ctx.coop.world.team.settled === true, null, { timeout: 30000, polling: 250 }).catch(() => {});
    const who = await everyone(me);
    out.who = who.map(w => [w.name, w.slot]);
    const nameA = who[1].name, slotA = who[1].slot;
    progress(`${MODE}${MAP ? ` on ${MAP}` : ''}: ${pages.length} pages in the match, wave ${who[0].wave}, ${who[0].enemies} enemies on the host; the seat is ${nameA}`);

    // ---- fight -------------------------------------------------------------------------------------------------------
    await step('fight', async () => {
      // A mission's section brings its own men; give them a moment to arrive.
      await host.waitForFunction(() => window.__op2.ctx.enemies.alive.length > 0, null, { timeout: 90000, polling: 250 });
      await A.waitForFunction(() => window.__op2.ctx.enemies.alive.length > 0, null, { timeout: 20000, polling: 250 });
      const seenBefore = await A.evaluate(() => ({ ...window.__op2.ctx.coop.world.attacks.seen }));
      const from = await A.evaluate(() => window.__atk.ev.length);
      let got = null;
      // The guest stands near the enemy until it has been attacked: three tries, each beside the nearest living one.
      for (let attempt = 0; attempt < 4 && !got; attempt++) {
        const spot = await nearest(host, A, attempt < 2 ? 7 : 4);
        if (spot?.at) { await teleport(A, spot.at, 0); await face(A, spot.enemy); }
        got = await A.waitForFunction(([from, begun]) => {
          const ev = window.__atk.ev.slice(from), seen = window.__op2.ctx.coop.world.attacks.seen;
          return seen.begun > begun && ev.some(e => e.k === 'hurt') ? true : null;
        }, [from, seenBefore.begun], { timeout: 25000 * SLOW, polling: 200 }).then(() => true, () => null);
      }
      await shot('1-fight');
      const after = await A.evaluate(from => {
        const ev = window.__atk.ev.slice(from), seen = window.__op2.ctx.coop.world.attacks.seen;
        const count = k => ev.filter(e => e.k === k).length;
        return { seen: { ...seen }, clips: count('clip'), sounds: count('snd'), flashes: count('flash'), tracers: count('tracer'), projectiles: count('proj'), hurt: ev.filter(e => e.k === 'hurt').map(e => [Math.round(e.amount), e.source]).slice(0, 6),
          soundIds: [...new Set(ev.filter(e => e.k === 'snd').map(e => e.id))].slice(0, 30) };
      }, from);
      check(after.seen.begun > seenBefore.begun, "Enemy attacks are played on the guest's screen (the attack's own code on its copy)", after.seen);
      check(after.clips + after.flashes + after.tracers + after.projectiles > 0, 'The guest sees them: attack clips, muzzle flashes, tracers or rounds in flight', after);
      check(after.sounds > 0, 'The guest hears the fight', after.soundIds);
      check(after.hurt.length > 0, "The host's damage reaches the guest", after.hurt);
      check(after.seen.failed === 0, 'No attack code threw on a copy', after.seen);
      return after;
    });

    // ---- kills, credit, gore -----------------------------------------------------------------------------------------
    await step('kills', async () => {
      const result = {};
      for (const [label, shooter, index] of [['guest', A, 1], ['host', host, 0]]) {
        await give(shooter, 'smg');
        const before = await everyone(me);
        const marks = await everyone(goreMark);
        // A man may duck behind cover, run or give himself up: after eight seconds on one, the shooter goes for the nearest again.
        let spot = null, dead = false;
        for (let attempt = 0; attempt < 6 && !dead; attempt++) {
          spot = null;
          for (let i = 0; i < 10 && !spot?.at; i++) { spot = await nearest(host, shooter, attempt < 3 ? 9 : 5); if (!spot?.at) await sleep(1500); }
          if (!spot?.at) break;
          await teleport(shooter, spot.at, 0);
          await sleep(500 * SLOW);
          dead = await kill(shooter, host, spot.uid, sleep, 8);
        }
        if (!check(!!spot?.at, `There is an enemy for the ${label} to shoot`, spot)) continue;
        await sleep(1200 * SLOW);
        if (label === 'guest') await shot('2-guest-kill');
        const after = await everyone(me);
        const gore = await Promise.all(pages.map((page, i) => goreSince(page, marks[i], spot.uid)));
        result[label] = { target: spot, dead, kills: after.map((a, i) => a.kills - before[i].kills), credits: after.map((a, i) => (a.credits ?? 0) - (before[i].credits ?? 0)), gore };
        check(dead, `The ${label}'s shots kill the enemy on the host`, spot);
        check(after[index].kills > before[index].kills, `The ${label}'s kill is counted for the ${label}`, result[label].kills);
        if (before[index].credits !== null) check(after[index].credits > before[index].credits, `The ${label} is paid for it`, result[label].credits);
        // The others may have been credited for nothing here: only the shooter fired. (An ally's or the garrison's kill pays nobody.)
        const others = pages.map((_, i) => i).filter(i => i !== index);
        check(others.every(i => gore[i].killed.filter(k => k[0] === spot.uid).every(k => k[1] === false)), `Nobody else's game calls the ${label}'s kill its own`, gore.map(g => g.killed.filter(k => k[0] === spot.uid)));
        check(gore.every(g => g.wounds > 0), `Every screen wounds the body the ${label} shot`, gore.map(g => g.wounds));
        check(gore.every(g => g.deaths > 0), 'Every screen drops it (each its own ragdoll or gib)', gore.map(g => g.deaths));
        check(gore[index].blood > 0, `The ${label} sees blood on its own hits`, gore.map(g => g.blood));
        const feeds = await Promise.all(others.map(i => hudText(pages[i])));
        result[label].feeds = feeds.map(f => f.kills);
        check(feeds.every(f => f.kills.some(line => line.includes(before[index].name))), `The other screens' kill feeds name ${before[index].name}`, feeds.map(f => f.kills));
      }
      return result;
    });

    // ---- slow motion with its notice -----------------------------------------------------------------------------------
    await step('slowmo', async () => {
      const read = page => page.evaluate(() => { const { ctx } = window.__op2, w = ctx.coop.world; return { slowmo: +ctx.time.slowmo.toFixed(3), lines: [...w.slowNotice.lines], state: w.slowNotice.state, slows: w.slows.length }; });
      await A.evaluate(() => { const { ctx, game } = window.__op2, chips = ctx.contracts.chips; if (game.state !== 'playing') game.setState('playing'); chips.rack.fit('focus', true); chips.meter = 1; chips.rest = 0; });
      await sleep(300);
      // Each page notes whether it ever slowed with no notice up.
      await everyone(page => page.evaluate(() => {
        const { ctx } = window.__op2, w = ctx.coop.world;
        // `early`: ms this screen was slow before its notice first showed; `late`: ms it was still slow after the notice went.
        const watch = window.__slowWatch = { slowed: 0, min: 1, early: 0, late: 0, slowAt: 0, noticeAt: 0, goneAt: 0, fullAt: 0, last: performance.now() };
        clearInterval(window.__slowTimer);
        window.__slowTimer = setInterval(() => {
          const now = performance.now(), step = now - watch.last; watch.last = now;
          // The notice is up while it has a line (who, with what) or says the world is back to full speed (the blend back).
          const s = ctx.time.slowmo, notice = w.slowNotice, lines = notice.lines.length || (notice.state ? 1 : 0);
          if (s < 0.95 && !watch.slowAt) watch.slowAt = now;
          if (lines && !watch.noticeAt) watch.noticeAt = now;
          if (watch.noticeAt && !lines && !watch.goneAt) watch.goneAt = now;
          if (watch.slowAt && s >= 0.95 && !watch.fullAt && now - watch.slowAt > 500) watch.fullAt = now;
          if (s < 0.95) { watch.slowed++; if (!lines) { if (watch.noticeAt) watch.late += step; else watch.early += step; } }
          watch.min = Math.min(watch.min, s);
        }, 8);
      }));
      await A.evaluate(() => window.__op2.ctx.input.simulate('sonar', true)); await sleep(80);
      await A.evaluate(() => window.__op2.ctx.input.simulate('sonar', false));
      const slowed = await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.time.slowmo < 0.6 && window.__op2.ctx.coop.world.slowNotice.lines.length > 0, null, { timeout: 8000 * SLOW, polling: 50 }).then(() => true, () => false)));
      const during = await everyone(read);
      await shot('3-slowmo-notice');
      await shot('3-slowmo-notice-host', host);
      check(slowed.every(Boolean), "The guest's Focus slows the world on every screen", during);
      check(during.every((d, i) => d.lines.some(l => l === `${nameA}${i === 1 ? ' (you)' : ''} used Focus`)), `Every screen says who: "${nameA} used Focus"`, during.map(d => d.lines));
      check(during.every(d => /WORLD AT 0\.\d+x · YOU AT FULL SPEED/.test(d.state)), "The notice gives the world's speed", during.map(d => d.state));
      // Focus runs at most 4.5 s; then every screen is back at full speed with no notice left.
      const back = await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.time.slowmo === 1 && window.__op2.ctx.coop.world.slowNotice.lines.length === 0 && !window.__op2.ctx.coop.world.slowNotice.state, null, { timeout: 15000 * SLOW, polling: 100 }).then(() => true, () => false)));
      const watch = await everyone(page => page.evaluate(() => { clearInterval(window.__slowTimer); return window.__slowWatch; }));
      check(back.every(Boolean), 'Afterwards every screen is back at full speed and the notice is gone', await everyone(read));
      const timing = watch.map(w => ({ early: Math.round(w.early), late: Math.round(w.late), noticeAfterSlow: Math.round(w.noticeAt - w.slowAt), noticeGoneBeforeFull: Math.round(w.fullAt - w.goneAt), min: w.min }));
      check(watch.every(w => w.slowed > 0 && w.early <= 50), 'No screen slowed before its notice showed (50 ms of slack)', timing);
      check(watch.every(w => w.late <= 50), 'No screen was still slow after its notice went (50 ms of slack)', timing);
      return { during, timing };
    });

    // ---- a guest's call-in, seen by the host -------------------------------------------------------------------------
    await step('callin', async () => {
      const held = await A.evaluate(() => { const p = window.__op2.ctx.progression; return { held: !!(p.callinLink.held ?? p.callinsHeld), running: p.callinLink.running.length }; });
      // The mark: open sky over level ground, in plain sight of the guest, 22 to 40 m off.
      const mark = await A.evaluate(() => {
        const { ctx } = window.__op2, V = ctx.player.position.constructor;
        const from = ctx.player.position, up = new V(0, 1, 0), eye = ctx.player.eye.clone();
        let best = null, bestScore = Infinity;
        for (let d = 22; d <= 42; d += 4) for (let a = 0; a < Math.PI * 2; a += 0.2) {
          const p = new V(from.x - Math.sin(a) * d, from.y, from.z - Math.cos(a) * d);
          const snapped = p.clone();
          if (!ctx.world.nav.nearest?.(p, 3, snapped) || Math.abs(snapped.y - from.y) > 1.5) continue;
          let open = true;
          for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) if (ctx.physics.raycast(new V(snapped.x + dx, snapped.y + 0.5, snapped.z + dz), up, 140, 1)) { open = false; break; }
          if (!open) continue;
          const to = new V(snapped.x, snapped.y + 1.2, snapped.z).sub(eye); const far = to.length();
          if (ctx.physics.raycast(eye, to.divideScalar(far), far - 0.5, 1)) continue;
          const score = Math.abs(d - 30);
          if (score < bestScore) { bestScore = score; best = snapped.toArray(); }
        }
        return best;
      });
      if (!check(!!mark, 'There is open ground in sight of the guest for the mark', mark)) return { held };
      await face(A, [mark[0], mark[1] + 1, mark[2]]);
      // The host looks at the mark too, from beside the guest, to be the one who watches.
      const beside = await front(A, 0, 3);
      await teleport(host, beside, 0); await face(host, [mark[0], mark[1] + 1, mark[2]]);
      const targets = [];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; targets.push(await still(host, [mark[0] + Math.cos(a) * 2, mark[1], mark[2] + Math.sin(a) * 2])); }
      await A.waitForFunction(uids => uids.every(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid)), targets.filter(u => u > 0), { timeout: 20000 }).catch(() => {});
      const before = await everyone(me);
      const marks = await everyone(goreMark);
      const mirrorBefore = await host.evaluate(() => ({ ...window.__op2.ctx.progression.callinLink.mirror.stats }));
      await A.evaluate(at => { const { ctx } = window.__op2, V = ctx.player.position.constructor; ctx.progression.callinLink.callAt('airstrike', new V(...at), new V(1, 0, 0.35), true); }, mark);
      // The host flies a copy of the guest's strike.
      const copied = await host.waitForFunction(slot => window.__op2.ctx.progression.callinLink.mirror.copies(slot).some(c => c.id === 'airstrike'), slotA, { timeout: 10000 * SLOW, polling: 50 }).then(() => true, () => false);
      check(copied, "The host flies a copy of the guest's airstrike", await host.evaluate(() => ({ ...window.__op2.ctx.progression.callinLink.mirror.stats })));
      await sleep(2500);
      await shot('4-callin-guest'); await shot('4-callin-host', host);
      // A strike's rockets fall where they fall: most of the five men standing on the mark die, as in single player.
      const gone = await host.waitForFunction(uids => uids.filter(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid)).length >= 3, targets.filter(u => u > 0), { timeout: 30000 * SLOW, polling: 200 }).then(() => true, () => false);
      await sleep(4000 * SLOW);
      const after = await everyone(me);
      const seen = await Promise.all(pages.map((page, i) => goreSince(page, marks[i], -1)));
      const mirror = await host.evaluate(() => ({ ...window.__op2.ctx.progression.callinLink.mirror.stats }));
      check(gone, "The guest's strike kills the men on the mark (three of five or more), on the host", { targets, left: await host.evaluate(() => window.__op2.ctx.enemies.alive.filter(e => e.dummy).length) });
      check(mirror.blasts > mirrorBefore.blasts, "The host's copy draws its blasts", { before: mirrorBefore, after: mirror });
      check(seen[0].booms > 0 && seen[1].booms > 0, 'Explosions are drawn on the guest and on the host', seen.map(s => s.booms));
      check(after[1].kills - before[1].kills >= 1, "The kills are the guest's", after.map((a, i) => a.kills - before[i].kills));
      check(after[0].kills === before[0].kills, 'The host, who only watched, is credited with none', after.map((a, i) => a.kills - before[i].kills));
      // Anything left of the targets is cleared so the next steps are not about them.
      await host.evaluate(uids => { const { ctx } = window.__op2; for (const e of [...ctx.enemies.alive]) if (uids.includes(e.uid)) ctx.enemies.withdraw(e); }, targets);
      return { held, mark, kills: after.map((a, i) => a.kills - before[i].kills), mirror, booms: seen.map(s => s.booms) };
    });

    // ---- a dropped gun, shared ---------------------------------------------------------------------------------------
    await step('gun', async () => {
      const drops = page => page.evaluate(() => window.__op2.ctx.weapons.dropped.drops.map(d => ({ id: d.id, weapon: d.weapon, fitted: [...d.fitted], mag: d.mag, reserve: d.reserve, by: d.by, at: [...d.at], marker: !!d.mark?.visible, model: !!d.root?.parent })));
      // Somewhere quiet: beside the guest, away from the mark.
      const spot = await front(A, 6);
      await teleport(host, spot, 0);
      const away = await front(host, 12);
      await teleport(A, away, 0);
      await host.evaluate(() => {
        const w = window.__op2.ctx.weapons;
        w.give('deuce'); w.grantMod('deuceQuad'); w.fitMod('deuceQuad', true);
        const a = w.ammo('deuce'); a.mag = 2; a.reserve = 9;
        w.switchTo('deuce');
      });
      await sleep(1500);
      const dropped = await press(host, 'dropWeapon', sleep, () => window.__op2.ctx.weapons.dropped.list.length >= 1);
      if (!check(dropped, 'The host drops its Deuce')) return {};
      await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.weapons.dropped.drops.some(d => d.weapon === 'deuce' && d.mark?.visible), null, { timeout: 20000 * SLOW }).catch(() => {})));
      const seen = await everyone(drops);
      const gun = seen[0].find(d => d.weapon === 'deuce');
      check(seen.every(s => s.some(d => d.weapon === 'deuce' && d.id === gun?.id && d.marker && d.model && d.by === who[0].name)), "The host's gun lies on every screen with its marker and the name of who dropped it", seen);
      if (!gun) return { seen };
      // The guest looks at it from 5 m, then walks onto it and takes it with E.
      await A.evaluate(at => { const { ctx } = window.__op2, V = ctx.player.position.constructor; ctx.player.teleport(new V(at[0] + 4, at[1], at[2] + 3), 0); const d = new V(at[0], at[1] + 0.5, at[2]).sub(ctx.player.eye); ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }, gun.at);
      await sleep(900);
      await shot('5-dropped-gun');
      await teleport(A, gun.at, 0);
      await sleep(1200);
      const prompt = await A.evaluate(() => [...document.querySelectorAll('body *')].map(e => (e.childElementCount === 0 ? e.textContent : '')).find(t => /Take DEUCE/i.test(t ?? '')) ?? null);
      check(/Take DEUCE \(from /i.test(prompt ?? ''), 'The guest is shown the prompt over it', prompt);
      const took = await press(A, 'interact', sleep, () => window.__op2.ctx.weapons.owned.has('deuce'));
      await Promise.all(pages.map(page => page.waitForFunction(id => !window.__op2.ctx.weapons.dropped.drops.some(d => d.id === id), gun.id, { timeout: 20000 * SLOW }).catch(() => {})));
      const held = await A.evaluate(() => { const w = window.__op2.ctx.weapons; return { owned: w.owned.has('deuce'), fitted: [...w.fitted].filter(m => m.startsWith('deuce')), mag: w.owned.has('deuce') ? w.ammo('deuce').mag : null, reserve: w.owned.has('deuce') ? w.ammo('deuce').reserve : null }; });
      check(took && held.owned && held.fitted.includes('deuceQuad') && held.mag === 2 && held.reserve === 9, "The guest holds the host's Deuce with its mod and its rounds", held);
      check((await everyone(drops)).every(s => !s.some(d => d.id === gun.id)), 'The gun is gone from the ground on every screen');
      check(!await host.evaluate(() => window.__op2.ctx.weapons.owned.has('deuce')), 'The host no longer owns it');
      await shot('5-gun-in-hand');
      return { gun, held };
    });

    // ---- down and revived --------------------------------------------------------------------------------------------
    await step('revive', async () => {
      const card = (page, slot) => page.evaluate(slot => [...window.__op2.ctx.coop.world.team.cards.values()].find(c => c.slot === slot)?.state ?? null, slot);
      await down(A);
      const downOnAll = await Promise.all(pages.filter(p => p !== A).map(page => page.waitForFunction(slot => [...window.__op2.ctx.coop.world.team.cards.values()].some(c => c.slot === slot && c.state === 'down'), slotA, { timeout: 10000 * SLOW }).then(() => true, () => false)));
      const lying = await me(A);
      check(lying.downed && !lying.alive, 'The guest at 0 health is down, not dead', lying);
      check(downOnAll.every(Boolean), 'Every other screen shows the guest as down', await Promise.all(pages.map(p => card(p, slotA))));
      await sleep(600);
      await shot('6-downed');
      await teleport(host, [lying.at[0] + 1, lying.at[1], lying.at[2]], 0);
      await face(host, lying.at);
      await sleep(600);
      await host.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate('interact', true); });
      await sleep(700); await shot('6-being-revived-host', host);
      // Up, and at once out of harm's way: at 40 health in a firefight they would be down again before the next check.
      const up = await A.waitForFunction(() => { const p = window.__op2.ctx.player; if (p.alive && !p.downed) { p.modifiers.invulnerable = true; return true; } return false; }, null, { timeout: 12000 * SLOW, polling: 50 }).then(() => true, () => false);
      await host.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
      const now = await me(A);
      check(up && now.health > 0, 'The host holds E and the guest gets up', now);
      check(Math.hypot(now.at[0] - lying.at[0], now.at[2] - lying.at[2]) < 3, 'They get up where they lay', [lying.at, now.at]);
      await sleep(800 * SLOW);
      check((await Promise.all(pages.map(p => card(p, slotA)))).every(s => s === 'up'), 'Every screen shows them up again', await Promise.all(pages.map(p => card(p, slotA))));
      await shot('6-revived');
      await invulnerable(true);
      return { lying: lying.at, health: now.health };
    });

    // ---- the break: the shared pod and everyone shopping (missions: a weapon cache) --------------------------------------
    await step('break', async () => {
      if (MISSION) {
        const at = await front(host, 12);
        await host.evaluate(at => { const { ctx } = window.__op2; ctx.progression.spawnPickup('weaponCache', new (ctx.player.position.constructor)(...at)); }, at);
        await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase !== 'spent'), null, { timeout: 20000 * SLOW }).catch(() => {})));
        const called = await everyone(pods);
        check(called.every(s => s.length === 1 && s[0].id === called[0][0]?.id && s[0].at.every((n, i) => n === called[0][0].at[i])), "Every screen flies the host's weapon cache at the same spot", called);
        const spot = called[0][0]?.at;
        if (!spot) return { called };
        for (const [i, page] of pages.entries()) await page.evaluate(([at, i]) => { const { ctx } = window.__op2, V = ctx.player.position.constructor; ctx.player.teleport(new V(at[0] + 9 + i * 2, at[1], at[2] + 7), 0); const d = new V(at[0], at[1] + 1, at[2]).sub(ctx.player.eye); ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }, [spot, i]);
        await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase === 'open'), null, { timeout: 40000 * SLOW }).catch(() => {})));
        await sleep(500);
        await shot('7-weapon-cache');
        const before = await everyone(me);
        for (const [i, page] of [[1, A], ...pages.map((p, i) => [i, p]).filter(([, p]) => p !== A)]) {
          await teleport(page, spot, 0);
          const got = await page.waitForFunction(n => window.__op2.ctx.weapons.owned.size > n, before[i].guns.length, { timeout: 20000 * SLOW }).then(() => true, () => false);
          check(got, `Player ${before[i].name} walks in and gets a share`, (await me(page)).guns);
          await teleport(page, [spot[0] + 9 + i * 2, spot[1], spot[2] + 7], 0);
        }
        const gone = await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.every(p => p.phase === 'spent'), null, { timeout: 20000 * SLOW }).then(() => true, () => false)));
        check(gone.every(Boolean), 'Once everyone has had a share the cache is gone on every screen', await everyone(pods));
        return { spot, guns: (await everyone(me)).map(m => m.guns) };
      }
      // Survival: the wave is cleared for real (one enemy at a time, the director calls it).
      const wave = (await me(host)).wave;
      let cleared = false;
      for (let i = 0; i < 2500 && !cleared; i++) {
        cleared = await host.evaluate(() => {
          const { ctx } = window.__op2;
          const enemy = ctx.enemies.alive[0];
          if (ctx.waves.phase !== 'intermission' && enemy) ctx.enemies.applyDamage(enemy, { amount: 99999, type: 'bullet', point: enemy.center.clone(), dir: enemy.center.clone().sub(ctx.player.eye).normalize(), force: 0, source: 'smg' });
          return ctx.waves.phase === 'intermission';
        });
        if (!cleared) await sleep(40);
      }
      if (!check(cleared, `The host's director calls wave ${wave} clear`, await me(host))) return {};
      // A break long enough to walk every page through it (the break's own length is the team proofs').
      await host.evaluate(() => { window.__op2.ctx.waves.nextWaveIn = 400; });
      const inBreak = await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.waves.phase === 'intermission', null, { timeout: 20000 * SLOW }).then(() => true, () => false)));
      check(inBreak.every(Boolean), 'Every screen is in the break', (await everyone(me)).map(m => m.phase));
      const purses = [3000, 1700, 1500, 1300];
      if (MODE === 'defense') {
        // Outpost Defense has no pod: its shops are buildings. Each player walks to the Barracks counter, opens it with E and
        // hires a rifleman with their own credits; the host carries the hire out.
        for (const [i, page] of pages.entries()) await page.evaluate(credits => { window.__op2.ctx.contracts.defense.credits = credits; }, purses[i]);
        const counter = await host.evaluate(() => { const a = window.__op2.ctx.contracts.defense.anchors.barracks; return [a.position.x, a.position.y, a.position.z, a.yaw]; });
        const result = { wave, bought: [] };
        const squad = () => host.evaluate(() => window.__op2.ctx.contracts.defense.view().squad);
        const men = await squad();
        for (const [i, page] of pages.entries()) {
          await teleport(page, counter.slice(0, 3), counter[3] + Math.PI);
          await sleep(500);
          await page.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate('interact', true); }); await sleep(120);
          await page.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
          const opened = await page.locator('.scr-shop:not(.scr-loadout)').waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
          check(opened, `Player ${who[i].name} opens the Barracks with E`);
          await sleep(300);
          if (page === A) await shot('7-guest-shop', A, true);
          const bought = await page.evaluate(() => {
            const d = window.__op2.ctx.contracts.defense, before = d.credits;
            const offer = d.offers('barracks').find(o => o.act.kind === 'ally' && o.act.type === 'rifleman');
            return { before, price: offer?.price ?? null, why: offer ? d.buy('barracks', offer.act) : 'no rifleman on offer' };
          });
          await page.keyboard.press('Escape'); await sleep(300);
          await page.evaluate(() => window.__op2.game.setState('playing'));
          await teleport(page, [counter[0] + 6 + i * 2, counter[1], counter[2] + 6], 0);
          await sleep(1500 * SLOW);
          bought.after = await page.evaluate(() => window.__op2.ctx.contracts.defense.credits);
          result.bought.push(bought);
        }
        check(result.bought.every((b, i) => b.why === null && b.before === purses[i] && b.after === purses[i] - b.price), 'Each player hired a rifleman and paid from their own credits (the host did not refuse and refund)', result.bought);
        const now = await squad();
        check(now === men + pages.length, `The host's garrison grew by ${pages.length} men`, [men, now]);
        return result;
      }
      for (const [i, page] of pages.entries()) await page.evaluate(credits => { const c = window.__op2.ctx.contracts; if (c.shop) c.shop.credits = credits; }, purses[i]);
      const buy = page => page.evaluate(() => {
        const shop = window.__op2.ctx.contracts.shop;
        const before = shop.credits;
        const offers = [...shop.weaponOffers(), ...shop.modOffers(), ...shop.implantOffers()];
        const offer = offers.find(o => !o.why && !o.owned && o.ware.price > 0 && o.ware.price <= before);
        if (!offer) return { before, none: offers.slice(0, 6).map(o => o.why) };
        const why = shop.buy(offer.act);
        return { before, after: shop.credits, price: offer.ware.price, act: offer.act, why, inBreak: shop.inBreak };
      });
      await host.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase !== 'spent'), null, { timeout: 8000 }).catch(() => {});
      const seen = await everyone(pods);
      const result = { wave, pods: seen };
      if (seen[0].length) {
        await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase !== 'spent'), null, { timeout: 15000 * SLOW }).catch(() => {})));
        const all = await everyone(pods);
        check(all.every(s => s.length === 1 && s[0].id === all[0][0].id && s[0].at.every((n, i) => n === all[0][0].at[i])), "Every screen flies the host's supply pod, by its number, at the same spot", all);
        const spot = all[0][0].at;
        for (const [i, page] of pages.entries()) { const a = (i / pages.length) * Math.PI * 2; await teleport(page, [spot[0] + Math.sin(a) * 14, spot[1], spot[2] + Math.cos(a) * 14], a); }
        const open = await Promise.all(pages.map(page => page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase === 'open'), null, { timeout: 40000 * SLOW }).then(() => true, () => false)));
        check(open.every(Boolean), 'It lands and opens on every screen', await everyone(pods));
        await sleep(500);
        await shot('7-shared-pod');
        // Beside the pod, each on ground a player can stand on: a pod may land by a wall or a drop, so a fixed ring of spots
        // can put one of three players inside something.
        for (const [i, page] of pages.entries()) {
          const at = await page.evaluate(([spot, start]) => {
            const { ctx } = window.__op2, V = ctx.player.position.constructor;
            for (let k = 0; k < 16; k++) {
              const a = start + (k / 16) * Math.PI * 2;
              const p = new V(spot[0] + Math.sin(a) * 2.6, spot[1], spot[2] + Math.cos(a) * 2.6), snapped = p.clone();
              if (!ctx.world.nav.nearest?.(p, 1.5, snapped)) continue;
              if (Math.hypot(snapped.x - p.x, snapped.z - p.z) > 0.6 || Math.abs(snapped.y - spot[1]) > 0.8) continue;
              const eye = new V(snapped.x, snapped.y + 1.5, snapped.z), to = new V(spot[0], spot[1] + 1.2, spot[2]).sub(eye), far = to.length();
              if (far > 0.6 && ctx.physics.raycast(eye, to.divideScalar(far), far - 0.5, 1)) continue;
              return [snapped.x, snapped.y, snapped.z, a];
            }
            return [spot[0], spot[1], spot[2] + 2.6, 0];
          }, [spot, (i / pages.length) * Math.PI * 2]);
          await teleport(page, at.slice(0, 3), at[3]);
        }
        await sleep(600);
        check((await everyone(page => page.evaluate(() => window.__op2.ctx.progression.pods.supplyNear))).every(Boolean), 'Every player is offered the shop at the shared pod');
        result.bought = [];
        for (const [i, page] of pages.entries()) {
          await page.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate('interact', true); });
          const opened = await page.locator('.scr-proc').waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
          await page.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
          check(opened, `Player ${who[i].name} opens the shop at the pod with E`);
          if (page === A) await shot('7-guest-shop', A, true);
          result.bought.push(await buy(page));
          await page.keyboard.press('Escape'); await sleep(300);
          await page.evaluate(() => window.__op2.game.setState('playing'));
        }
      } else {
        // Outpost Defense has no pod: each player opens the shop screen of the break.
        check(MODE === 'defense', 'This mode has a supply pod in the break', seen);
        result.bought = [];
        for (const [i, page] of pages.entries()) {
          await page.evaluate(() => window.__op2.ctx.events.emit('shop:open', {}));
          const opened = await page.locator('.scr-proc').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
          check(opened, `Player ${who[i].name} opens the shop in the break`);
          if (page === A) await shot('7-guest-shop', A, true);
          result.bought.push(await buy(page));
          await page.keyboard.press('Escape'); await sleep(300);
          await page.evaluate(() => window.__op2.game.setState('playing'));
        }
      }
      check(result.bought.every((b, i) => b.why === null && b.before === purses[i] && b.after === purses[i] - b.price), 'Each player bought something and paid from their own purse', result.bought);
      const after = await everyone(page => page.evaluate(() => window.__op2.ctx.contracts.shop.credits));
      check(after.every((c, i) => c === result.bought[i].after), "Nobody's purchase touched another player's credits", after);
      const hostTime = [await host.evaluate(() => window.__op2.ctx.time.elapsed)];
      await sleep(1000); hostTime.push(await host.evaluate(() => window.__op2.ctx.time.elapsed));
      check(hostTime[1] > hostTime[0], "The host's world ran on while they shopped", hostTime);
      return result;
    });

    // ---- the guest's page reloads and rejoins with its kit -------------------------------------------------------------
    await step('rejoin', async () => {
      const kitOf = page => page.evaluate(() => {
        const { ctx } = window.__op2, w = ctx.weapons, p = ctx.progression;
        return { guns: [...w.owned].sort(), fitted: [...w.fitted].sort(), ammo: Object.fromEntries([...w.owned].sort().map(id => [id, [w.ammo(id).mag, w.ammo(id).reserve]])), grenades: w.grenades,
          credits: ctx.contracts?.wallet?.credits ?? null, kills: p.kills, score: Math.round(p.score), alive: ctx.player.alive, slot: ctx.coop.lobby.me.slot };
      });
      await A.evaluate(() => { const { ctx } = window.__op2; ctx.input.simulate('fire', false); if (ctx.contracts?.wallet) ctx.contracts.wallet.credits = 2345; });
      // The host keeps a seat's kit as the guest tells it: wait until it has what the guest holds now.
      const before = await kitOf(A);
      await host.waitForFunction(([slot, guns, credits]) => {
        const { lobby, world } = window.__op2.ctx.coop;
        const id = lobby.players.find(p => p.slot === slot)?.id;
        const seat = id && world.team.seats.get(world.team.seatKey(id));
        return !!seat?.kit && guns.every(g => seat.kit.guns.some(k => k.weapon === g)) && (credits === null || seat.purse?.credits === credits);
      }, [slotA, before.guns, before.credits], { timeout: 30000 * SLOW, polling: 250 }).catch(() => {});
      await shot('8-before-rejoin');
      A.on('dialog', dialog => { dialog.accept().catch(() => {}); });
      await A.reload({ waitUntil: 'load', timeout: 120000 });
      await inMatch([A], party.mode.contract, !MISSION && MODE !== 'defense');
      // Outpost Defense opens its loadout screen on a page's way in.
      if (MODE === 'defense' && await A.locator('.scr-loadout').isVisible().catch(() => false)) { out.steps.loadoutOnRejoin = true; await button(A, 'Deploy').click().catch(() => {}); }
      await A.waitForFunction(() => window.__op2.ctx.coop.world.team.settled === true, null, { timeout: 30000 * SLOW, polling: 250 }).catch(() => {});
      await A.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; if (window.__op2.game.state !== 'playing') window.__op2.game.setState('playing'); });
      await A.evaluate(recordSaid); await A.evaluate(recordAttacks); await A.evaluate(recordGore);
      await sleep(1500 * SLOW);
      const after = await kitOf(A);
      for (const key of ['guns', 'fitted', 'ammo', 'grenades', 'credits', 'kills', 'score', 'slot']) check(JSON.stringify(after[key]) === JSON.stringify(before[key]), `After the reload the guest's ${key} are back`, { before: before[key], after: after[key] });
      check(after.alive, 'They left alive, so they are back alive', after);
      const seenByHost = await host.waitForFunction(n => window.__op2.ctx.coop.remotes.size >= n && [...window.__op2.ctx.coop.remotes.values()].every(r => r.char.root.visible), pages.length - 1, { timeout: 60000, polling: 250 }).then(() => true, () => false);
      check(seenByHost, "The host draws the returned guest's body again");
      const told = await A.evaluate(() => window.__op2.ctx.coop.lobby.chat.map(l => l.text).slice(-12));
      const wave = await everyone(me);
      check(wave.every(w => w.wave === wave[0].wave && w.phase === wave[0].phase), 'The returned guest has the wave and its phase', wave.map(w => [w.wave, w.phase]));
      await shot('8-rejoined');
      return { before, after, told, loadoutOnRejoin: out.steps.loadoutOnRejoin === true };
    });

    // ---- the ending, on the team board -------------------------------------------------------------------------------
    await step('ending', async () => {
      const want = MISSION ? 'MISSION COMPLETE' : 'TEAM WIPED';
      if (MISSION) await host.evaluate(() => window.__op2.ctx.events.emit('campaign:complete', {}));
      else {
        await invulnerable(false);
        for (const page of pages.slice(1)) await down(page);
        await host.waitForFunction(n => [...window.__op2.ctx.coop.world.team.cards.values()].filter(c => c.state !== 'up').length >= n, pages.length - 1, { timeout: 30000 * SLOW, polling: 250 }).catch(() => {});
        await down(host);
      }
      const boards = await Promise.all(pages.map(page => page.locator('.cq-over .cq-end').waitFor({ state: 'visible', timeout: 40000 * SLOW }).then(() => true, () => false)));
      await sleep(700);
      const ends = await everyone(ending);
      await shot('9-team-board', A, true); await shot('9-team-board-host', host, true);
      check(boards.every(Boolean), 'Every screen gets the team board', ends.map(e => [e.board, e.big]));
      check(ends.every(e => e.big === want), `It reads ${want} on every screen`, ends.map(e => e.big));
      check(ends.every(e => e.rows === pages.length), `It lists all ${pages.length} players on every screen`, ends.map(e => e.rows));
      check(ends.every(e => !e.soloGameOver && !e.soloComplete), 'No screen shows a solo game-over or "complete" screen', ends.map(e => [e.soloGameOver, e.soloComplete]));
      return { ends: ends.map(e => ({ big: e.big, sub: e.sub, rows: e.rows, buttons: e.buttons })) };
    });

    stepName = 'whole run';
    const quiet = out.errors.filter(e => !/net::ERR_ABORTED|Failed to load resource|screenshot /.test(e));
    check(quiet.length === 0, 'No page exceptions on any screen', quiet.slice(0, 8));
  } catch (error) {
    out.failed.push({ message: `${stepName}: the session broke off: ${String(error?.message ?? error).split('\n')[0].slice(0, 400)}`, detail: String(error?.stack ?? error).slice(0, 2000) });
    for (const [i, page] of pages.entries()) await page.screenshot({ path: `${outDir}/${tag}-broke-${i}.png`, timeout: 30000 }).catch(() => {});
  } finally {
    write();
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
  progress(`${out.checks.length} checks passed, ${out.failed.length} failed${out.failed.length ? `: ${out.failed.map(f => f.message).join(' | ')}` : ''}`);
  return { mode: MODE, map: MAP ?? '', checks: out.checks.length, failed: out.failed.map(f => f.message), steps: out.steps, screenshots: out.screenshots, frames: out.frames };
}
