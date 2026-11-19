// Co-op proof: every Crucible enemy's every attack, as a GUEST sees, hears and takes it.
//
// One enemy at a time is stood in front of the first guest and left with one attack. For each, the guest's page must show, in
// order and close to the host's own times: the wind-up (clip, voice, muzzle star, laser, ring), the shot (flash, sound, swing),
// the projectile's body in flight, and the host's damage. The table at the end of the evidence file is one row per attack.
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 900 --script tools/scripts/coop-attacks-crucible.mjs --out <dir>/crucible.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05   COOP_PLAYERS=2|3   COOP_NET=loop|rtc   ATTACKS=claw,slam (a subset, by attack name)
import { writeFileSync } from 'node:fs';
import { ahead, calm, kit, live, startParty } from './coop-kit.mjs';
import { first, put, readRecord, record, stage, unstage } from './coop-attacks-kit.mjs';

const has = (events, k, test = () => true) => events.some(e => e.k === k && test(e));
const snd = id => e => e.id === id;

/**
 * kind, attack, metres from the guest, and what the guest must get. `begin`/`fire` list [event kind, test] pairs that must
 * appear after the attack's start / its first shot. `hurt` is the damage type the guest must take; `shove` a throw;
 * `proj` the kind of projectile body; `boom` an explosion; `seconds` how long to watch.
 */
const CASES = [
  { kind: 'husk', attack: 'claw', d: 1.5, begin: [['clip', e => e.clip === 'attackMelee'], ['snd', snd('vox_husk_snarl')]], fire: [['snd', snd('enemy_swing')]], hurt: 'melee' },
  { kind: 'husk', attack: 'lurch', d: 3.4, begin: [['clip', e => e.clip === 'attackHeavy']], fire: [['clip', e => e.clip === 'leap'], ['snd', snd('enemy_lunge')]], hurt: 'melee' },
  { kind: 'trooper', attack: 'burst', d: 12, begin: [['glint']], fire: [['flash', e => e.kind === 'enemy'], ['snd', snd('enemy_smg')], ['clip', e => e.clip === 'shoot']], proj: 'bullet', hurt: 'bullet' },
  { kind: 'gunner', attack: 'blast', d: 7, begin: [['glint'], ['snd', snd('smg_reload')]], fire: [['flash', e => e.kind === 'shotgun'], ['snd', snd('enemy_shotgun')]], proj: 'bullet', projCount: 6, hurt: 'bullet' },
  { kind: 'brute', attack: 'minigun', d: 12, begin: [['glint'], ['snd', snd('autocannon_zoom')]], fire: [['flash', e => e.kind === 'minigun'], ['loop', snd('enemy_minigun_loop')]], proj: 'bullet', projCount: 20, hurt: 'bullet', seconds: 7 },
  { kind: 'brute', attack: 'smash', d: 2.2, begin: [['clip', e => e.clip === 'attackHeavy']], fire: [['snd', snd('enemy_swing')]], hurt: 'melee', shove: true },
  { kind: 'stalker', attack: 'twinSlash', d: 1.8, begin: [['clip', e => e.clip === 'attackMelee']], fire: [['snd', snd('enemy_blade')]], hurt: 'melee', fires: 2 },
  { kind: 'stalker', attack: 'gapClose', d: 8, begin: [['clip', e => e.clip === 'attackHeavy']], fire: [['clip', e => e.clip === 'leap'], ['snd', snd('enemy_lunge')]] },
  { kind: 'rocketeer', attack: 'rocket', d: 18, begin: [['laser'], ['clip', e => e.clip === 'throw'], ['snd', snd('autocannon_zoom')]], fire: [['flash', e => e.kind === 'rocket'], ['snd', snd('enemy_rocket_fire')]], proj: 'rocket', boom: true, gone: true, hurt: 'explosive', seconds: 6 },
  { kind: 'sniper', attack: 'snipe', d: 30, begin: [['laser'], ['snd', snd('sniper_charge')], ['loop', snd('sniper_laser_loop')], ['laserSolid']], fire: [['tracer', e => e.kind === 'snipe'], ['flash', e => e.kind === 'snipe'], ['snd', snd('sniper_fire')]], hurt: 'bullet', together: true, seconds: 6 },
  { kind: 'riot', attack: 'bash', d: 2, begin: [['clip', e => e.clip === 'attackHeavy']], fire: [['snd', snd('enemy_swing')]], hurt: 'melee', shove: true },
  { kind: 'riot', attack: 'pistol', d: 10, begin: [['glint']], fire: [['flash'], ['snd', snd('enemy_pistol')]], proj: 'bullet' },
  { kind: 'leaper', attack: 'pounce', d: 10, setup: 'pinned', begin: [['clip', e => e.clip === 'roar'], ['glint']], fire: [['clip', e => e.clip === 'leap'], ['snd', snd('leaper_pounce')]], hurt: 'melee', seconds: 6 },
  { kind: 'leaper', attack: 'rake', d: 1.8, begin: [['clip', e => e.clip === 'attackMelee']], fire: [['snd', snd('enemy_swing')]], hurt: 'melee' },
  { kind: 'leaper', attack: 'lowLeap', d: 6, begin: [['clip', e => e.clip === 'attackHeavy']], fire: [['clip', e => e.clip === 'leap']] },
  // Its shot is the blast itself: the host's kill and explosion, with nothing of the attack's own to show.
  { kind: 'bomber', attack: 'fuse', d: 2.6, begin: [['glint'], ['snd', snd('bomber_beep')], ['loop', snd('bomber_tank_hiss_loop')]], fire: [], noFire: true, boom: true, hurt: 'explosive' },
  { kind: 'burner', attack: 'flame', d: 5, begin: [['glint'], ['snd', snd('vox_burner_breath')]], fire: [['loop', snd('burner_flame_loop')]], flames: true, hurt: 'fire', seconds: 6 },
  { kind: 'warden', attack: 'staffBolt', d: 10, begin: [['glint']], fire: [['flash', e => e.kind === 'plasma'], ['snd', snd('enemy_pistol')]], proj: 'bullet' },
  { kind: 'skitter', attack: 'skitterPounce', d: 3, begin: [['glint'], ['snd', snd('skitter_chirp')]], fire: [], boom: true },
  { kind: 'drone', attack: 'droneBurst', d: 10, setup: 'fly', seconds: 7, begin: [['glint'], ['laser']], fire: [['flash'], ['snd', snd('drone_gun')]], proj: 'bullet' },
  { kind: 'juggernaut', attack: 'slam', d: 6, begin: [['clip', e => e.clip === 'attackHeavy'], ['snd', snd('vox_juggernaut_roar')]], zone: 10.5, fire: [['snd', snd('juggernaut_slam')]], hurt: 'crush', shove: true, together: true },
  { kind: 'juggernaut', attack: 'pummel', d: 2.8, begin: [['clip', e => e.clip === 'attackHeavy']], fire: [['snd', snd('enemy_swing')]], hurt: 'melee', shove: true },
  { kind: 'juggernaut', attack: 'charge', d: 18, begin: [['lane'], ['clip', e => e.clip === 'roar'], ['snd', snd('juggernaut_charge')]], fire: [], hurt: 'melee', seconds: 7 },
  { kind: 'juggernaut', attack: 'salvo', d: 20, setup: 'phase2', begin: [['laser'], ['snd', snd('autocannon_zoom')]], fire: [['flash', e => e.kind === 'rocket'], ['snd', snd('enemy_rocket_fire')]], proj: 'rocket', projCount: 4, boom: true, seconds: 7 },
  { kind: 'titan', attack: 'stomp', d: 10, begin: [['clip', e => e.clip === 'attackHeavy'], ['snd', snd('titan_roar')]], zone: 15, fire: [['snd', snd('titan_stomp')]], hurt: 'crush', shove: true, together: true },
  { kind: 'titan', attack: 'sweep', d: 10, begin: [['lane'], ['clip', e => e.clip === 'attackMelee']], fire: [], hurt: 'melee', shove: true },
  { kind: 'titan', attack: 'barrage', d: 30, begin: [['glint'], ['snd', snd('titan_charge')], ['clip', e => e.clip === 'throw']], zone: 4.6, fire: [['flash', e => e.kind === 'rocket'], ['snd', snd('enemy_rocket_fire')]], strike: true, boom: true, seconds: 8 },
  { kind: 'titan', attack: 'beam', d: 30, begin: [['laser'], ['snd', snd('titan_charge')], ['clip', e => e.clip === 'roar']], fire: [['laserSolid'], ['loop', snd('titan_beam_loop')]], hurt: 'fire', seconds: 8 },
  { kind: 'titan', attack: 'groundPound', d: 10, setup: 'legless', begin: [['clip', e => e.clip === 'attackHeavy']], zone: 17, fire: [['snd', snd('titan_stomp')]], hurt: 'crush', shove: true, together: true },
];

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], rows: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const sim = process.env.COOP_SIM || '';
  const tag = `attacks-crucible-${players}p${sim ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  // How far behind the host a guest may show a step: a couple of frames on a clean line; the lag and jitter on a bad one.
  const lagMs = Number(/lag:(\d+)/.exec(sim)?.[1] ?? 0), jitterMs = Number(/jitter:(\d+)/.exec(sim)?.[1] ?? 0);
  const BEHIND = 150 + lagMs + jitterMs * 2 + (sim ? 250 : 0);
  const only = process.env.ATTACKS ? new Set(process.env.ATTACKS.split(',')) : null;
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players, net: sim || undefined, out, progress, sleep });
    await live(party, { enemies: 1 });
    await calm(host);
    const guest = party.guest;
    for (const page of party.pages) await page.evaluate(record);
    const spot = await ahead(host, 0);
    // The guest stands at the spawn; the host and any other guest well behind it, so the enemy goes for the guest.
    await put(guest, spot.at, spot.yaw);
    await put(host, (await ahead(host, -16)).at, spot.yaw);
    for (let i = 1; i < party.guests.length; i++) await put(party.guests[i], (await ahead(host, -16 - i * 3)).at, spot.yaw);
    await sleep(700);
    out.fps = await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps)));
    // (Over real WebRTC a public relay that is down logs a console error of its own: that is the relay's, not the game's.)
    for (const page of party.pages) page.on('console', m => { if ((m.type() === 'error' || /\[coop\]/.test(m.text())) && !/WebSocket connection to 'wss:/.test(m.text())) out.errors.push(`console: ${m.text().slice(0, 300)}`); });
    for (const page of party.pages) page.on('crash', () => out.errors.push('PAGE CRASHED'));
    for (const page of party.pages) page.on('close', () => out.errors.push('PAGE CLOSED'));

    // One attack, staged and watched. Returns its row.
    const play = async c => {
      await calm(host);
      await put(guest, spot.at, spot.yaw);
      await sleep(350);
      // A page starved by a busy machine says nothing about the network: its timings are recorded and not judged.
      const fps = Math.min(...await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps))));
      const timed = fps >= 40;
      const since = Date.now();
      const uid = await stage(host, c.kind, (await ahead(host, c.d)).at, c.attack, c.setup);
      const limit = (c.seconds ?? 4.5) * 1000 + lagMs * 4;
      // Watch until the guest has played the attack to its end (or the enemy is gone), then a little longer for what follows.
      let g, h;
      for (let waited = 0; waited < limit; waited += 150) {
        await sleep(150);
        g = await readRecord(guest, since);
        if (g.log.some(e => e.uid === uid && e.p === 'end') && waited > 1200) break;
      }
      await sleep(c.boom || c.proj ? 1200 : 400);
      g = await readRecord(guest, since); h = await readRecord(host, since);
      await unstage(host, uid);

      const hostBegin = first(h.log, e => e.uid === uid && e.p === 'begin'), hostFire = first(h.log, e => e.uid === uid && e.p === 'fire');
      const begin = first(g.log, e => e.uid === uid && e.p === 'begin'), fire = first(g.log, e => e.uid === uid && e.p === 'fire');
      // A shock or a ring rides its own event, which can land a little before the attack's on a jittery link.
      const slack = 5 + (sim ? 150 + jitterMs * 2 : 0);
      const after = at => g.ev.filter(e => at !== undefined && e.at >= at - slack);
      const hurt = g.ev.find(e => e.k === 'hurt' && (!c.hurt || e.type === c.hurt));
      const row = { kind: c.kind, attack: c.attack, uid, hostBegin: hostBegin ? hostBegin - since : null, beginBehind: begin && hostBegin ? begin - hostBegin : null,
        fireBehind: fire && hostFire ? fire - hostFire : null, windupHost: hostBegin && hostFire ? hostFire - hostBegin : null, windupGuest: begin && fire ? fire - begin : null,
        fires: g.log.filter(e => e.uid === uid && e.p === 'fire').length, hostFires: h.log.filter(e => e.uid === uid && e.p === 'fire').length,
        projectiles: g.ev.filter(e => e.k === 'proj').length, hurtAfterFire: hurt && fire ? hurt.at - fire : null, hurt: hurt?.amount ?? null,
        shove: has(g.ev, 'shove'), boom: has(g.ev, 'boom'), missing: [] };
      const need = (ok, what) => { if (!ok) row.missing.push(what); };
      need(hostBegin !== undefined, 'the host never started it');
      need(begin !== undefined, 'begin');
      for (const [k, test] of c.begin) need(has(after(begin), k, test), `wind-up ${k}`);
      if (c.zone) need(has(g.ev, 'zone', e => Math.abs(e.r - c.zone) < 0.1), `ring ${c.zone} m`);
      if (!c.noFire && (hostFire !== undefined || c.fire.length)) need(fire !== undefined, 'fire');
      for (const [k, test] of c.fire) need(has(after(fire), k, test), `shot ${k}`);
      if (c.proj) need(g.ev.filter(e => e.k === 'proj' && e.kind === c.proj).length >= (c.projCount ?? 1), `${c.projCount ?? 1} ${c.proj} bodies`);
      if (c.fires) need(row.fires >= c.fires, `${c.fires} strikes`);
      if (c.boom) need(row.boom, 'explosion');
      if (c.gone) need(has(g.ev, 'projGone'), 'the copy was removed when the host blew it up');
      if (c.strike) need(g.seen.warnings.strikes > 0 && has(g.ev, 'tracer', e => e.kind === 'heavy'), 'the shell coming down');
      if (c.flames) need(await guest.evaluate(() => window.__op2.ctx.coop.world.attacks.seen.fired > 0), 'flames');
      if (c.hurt) need(!!hurt, `hurt (${c.hurt})`);
      if (c.shove) need(row.shove, 'thrown');
      // In step with the host: each step no more than BEHIND ms after the host's, never before it.
      row.fps = fps; row.timed = timed;
      if (timed && begin && hostBegin) need(begin - hostBegin >= -20 && begin - hostBegin <= BEHIND, `begin ${begin - hostBegin} ms behind`);
      if (timed && fire && hostFire) need(fire - hostFire >= -20 && fire - hostFire <= BEHIND, `fire ${fire - hostFire} ms behind`);
      // In order on the guest: the warning before the shot, and for an instant hit the damage with the shot.
      if (begin && fire) need(fire >= begin, 'fire before begin');
      if (timed && c.together && hurt && fire) need(Math.abs(hurt.at - fire) <= 120 + jitterMs * 2, `hurt ${hurt.at - fire} ms from the shot`);
      row.failed = g.seen.attacks.failed;
      return row;
    };
    for (const c of CASES) {
      if (only && !only.has(c.attack)) continue;
      let row = await play(c);
      // A stall on a busy machine makes one step late and says nothing about the link: a row that failed on timing alone is
      // played once more, and says so.
      if (row.missing.length && row.missing.every(m => /ms behind|ms from the shot/.test(m))) { const first = row.missing; row = await play(c); row.retried = first; }
      out.rows.push(row);
      progress(`${c.kind} ${c.attack}: ${row.missing.length ? `MISSING ${row.missing.join('; ')}` : 'ok'}  begin +${row.beginBehind} fire +${row.fireBehind} windup ${row.windupHost}/${row.windupGuest} hurt ${row.hurt}`);
    }
    const bad = out.rows.filter(r => r.missing.length);
    const timedRows = out.rows.filter(r => r.timed);
    out.summary = { cases: out.rows.length, passed: out.rows.length - bad.length, retried: out.rows.filter(r => r.retried).length, timed: timedRows.length, fpsLow: Math.min(...out.rows.map(r => r.fps)),
      worstBegin: Math.max(0, ...timedRows.map(r => r.beginBehind ?? 0)), worstFire: Math.max(0, ...timedRows.map(r => r.fireBehind ?? 0)), allowed: BEHIND };
    progress(`summary ${JSON.stringify(out.summary)}`);
    await shot(guest, 'guest-end');
    check(bad.length === 0, `Every attack reaches the guest whole (${out.rows.length} attacks)`, bad.map(r => `${r.kind} ${r.attack}: ${r.missing.join('; ')}`));
    check(out.rows.every(r => !r.failed), 'No attack code threw on a copy', out.rows.filter(r => r.failed).map(r => r.attack));
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
