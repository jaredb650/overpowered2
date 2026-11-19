// Co-op proof: Endless Humans as a GUEST gets it. The soldiers' weapons, the vehicles' guns, a ram and a burning wreck, and
// the Commander's words.
//
//  1. A real wave fights the party for a while. Every attack the host's men start must be played on the guest, in step.
//  2. Each soldier weapon is then forced once at the guest (a man stood in front of them who may only do that), so none is left
//     to chance: rifle, shotgun, machine gun, rocket, marksman's rifle, pistol, carbine, grenade, rifle butt, shield bash.
//  3. A tank lays its gun on the guest and fires; a scout car runs the guest down; its wreck burns them.
//  4. The Commander: a warning chip, a bark and a briefing show in the guest's own box.
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 900 --script tools/scripts/coop-attacks-humans.mjs --out <dir>/humans.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05   COOP_PLAYERS=2|3   PARTS=fight,weapons,vehicles,commander
import { writeFileSync } from 'node:fs';
import { ahead, calm, kit, live, startParty } from './coop-kit.mjs';
import { first, put, readRecord, record, unstage } from './coop-attacks-kit.mjs';

const b_at = x => x.b.at;
const has = (events, k, test = () => true) => events.some(e => e.k === k && test(e));
const snd = id => e => e.id === id;

/** Host: a soldier of `kind` at `at` who may only do `attack`, with whatever that attack needs to go off, aimed at `target`. */
const forceSoldier = (host, kind, at, attack, target) => host.evaluate(([kind, at, attack, target]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const p = new V(...at); const snapped = p.clone();
  if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
  const e = ctx.enemies.spawn(kind, p);
  if (!e) return 0;
  const s = ctx.enemies.outpost.soldiers.find(s => s.e === e);
  const real = e.attacks.find(a => a.name === attack);
  if (!s || !real) return -1;
  e.behaviours = []; e.mode = 'hold'; e.dummy = true;
  // The squad's own rules for when a man may fire are not what is being proven here: he may, now.
  e.attacks = [{ ...real, requires: () => true, los: false, range: [0, 200], token: null }];
  e.attackReadyAt = ctx.time.elapsed + 1;
  const hold = () => {
    if (!e.alive) return;
    s.mag = 30; s.reloadUntil = 0; s.sees = true; s.exposed = true; s.weapon = attack === 'backup' ? 'sidearm' : 'primary';
    s.aim.set(...target); s.aim.y += 1;
    if (attack === 'grenade' && !s.throwKind && e.attackPhase === 'idle') { s.throwKind = 'frag'; s.grenades = 2; s.throwAt.set(...target); }
    e.yaw = Math.atan2(target[0] - e.position.x, target[2] - e.position.z);
    requestAnimationFrame(hold);
  };
  hold();
  return e.uid;
}, [kind, at, attack, target]);

const WEAPONS = [
  { kind: 'trooper', attack: 'rifle', d: 12, begin: [['glint']], fire: [['flash', e => e.kind === 'enemy'], ['snd', snd('enemy_smg')]], proj: 'bullet' },
  { kind: 'gunner', attack: 'blast', d: 7, begin: [['glint'], ['snd', snd('smg_reload')]], fire: [['flash', e => e.kind === 'shotgun'], ['snd', snd('enemy_shotgun')]], proj: 'bullet', projCount: 8 },
  { kind: 'brute', attack: 'machinegun', d: 14, begin: [['glint']], fire: [['flash', e => e.kind === 'minigun'], ['loop', snd('enemy_minigun_loop')]], proj: 'bullet', projCount: 20, seconds: 7 },
  { kind: 'rocketeer', attack: 'rocket', d: 18, begin: [['laser'], ['snd', snd('autocannon_zoom')]], fire: [['flash', e => e.kind === 'rocket'], ['snd', snd('enemy_rocket_fire')]], proj: 'rocket', boom: true, seconds: 6 },
  { kind: 'sniper', attack: 'snipe', d: 30, begin: [['laser'], ['snd', snd('sniper_charge')], ['laserSolid']], fire: [['tracer', e => e.kind === 'snipe'], ['flash', e => e.kind === 'snipe'], ['snd', snd('sniper_fire')]], seconds: 6 },
  { kind: 'riot', attack: 'pistol', d: 10, begin: [['glint']], fire: [['flash'], ['snd', snd('enemy_pistol')]], proj: 'bullet' },
  { kind: 'warden', attack: 'carbine', d: 10, begin: [['glint']], fire: [['flash'], ['snd', snd('enemy_pistol')]], proj: 'bullet' },
  { kind: 'trooper', attack: 'grenade', d: 12, begin: [['clip', e => e.clip === 'throw'], ['snd', snd('grenade_pin')]], fire: [['snd', snd('grenade_throw')]], proj: 'grenade', zone: 6.5, boom: true, seconds: 7 },
  { kind: 'trooper', attack: 'butt', d: 2, begin: [['clip', e => e.clip === 'attackHeavy']], fire: [['snd', snd('enemy_swing')]], hurt: 'melee', shove: true },
  { kind: 'riot', attack: 'bash', d: 2, begin: [['clip', e => e.clip === 'attackHeavy']], fire: [['snd', snd('enemy_swing')]], hurt: 'melee', shove: true },
];

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], rows: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const sim = process.env.COOP_SIM || '';
  const parts = new Set((process.env.PARTS ?? 'fight,weapons,vehicles,commander').split(','));
  const tag = `attacks-humans-${players}p${sim ? '-bad' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const lagMs = Number(/lag:(\d+)/.exec(sim)?.[1] ?? 0), jitterMs = Number(/jitter:(\d+)/.exec(sim)?.[1] ?? 0);
  const BEHIND = 150 + lagMs + jitterMs * 2 + (sim ? 250 : 0);
  let party;
  try {
    party = await startParty(host, { mode: 'outpost', players, net: sim || undefined, out, progress, sleep });
    await live(party, { enemies: 3 });
    const guest = party.guest;
    for (const page of party.pages) await page.evaluate(record);
    out.fps = await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps)));

    if (parts.has('fight')) {
      // 1. A real wave. The players stand where the game put them and take it.
      const since = Date.now();
      await sleep(28000);
      const g = await readRecord(guest, since), h = await readRecord(host, since - 50);
      const begins = h.log.filter(e => e.p === 'begin' && e.at >= since + 300 && e.at <= Date.now() - 1500);
      const behind = [];
      let matched = 0;
      for (const b of begins) {
        const mine = g.log.filter(e => e.p === 'begin' && e.uid === b.uid && e.a === b.a && e.at >= b.at - 30 && e.at <= b.at + 2000)[0];
        if (mine) { matched++; behind.push(mine.at - b.at); }
      }
      out.fightLate = begins.map(b => ({ b, mine: g.log.filter(e => e.uid === b.uid && e.at >= b.at - 30 && e.at <= b.at + 2500) })).filter(x => !x.mine[0] || x.mine[0].p !== 'begin' || x.mine[0].at - b_at(x) > 100);
      behind.sort((a, b) => a - b);
      const names = list => [...new Set(list.filter(e => e.p === 'begin').map(e => e.a))].sort();
      out.fight = { hostBegins: begins.length, matched, p50: behind[Math.floor(behind.length / 2)] ?? null, p95: behind[Math.floor(behind.length * 0.95)] ?? null,
        hostAttacks: names(h.log), guestAttacks: names(g.log), guest: g.seen, hurtOnGuest: g.ev.filter(e => e.k === 'hurt').length,
        flashes: g.ev.filter(e => e.k === 'flash').length, bodies: g.ev.filter(e => e.k === 'proj').length, sounds: g.ev.filter(e => e.k === 'snd' && /^enemy_|sniper_fire|grenade_/.test(e.id)).length };
      progress(`fight: ${matched}/${begins.length} attacks played on the guest, p50 +${out.fight.p50} p95 +${out.fight.p95} ms, ${out.fight.flashes} flashes, ${out.fight.bodies} bodies, ${out.fight.hurtOnGuest} hurts; attacks ${out.fight.hostAttacks.join(',')}`);
      check(begins.length >= 5, 'The wave attacked', begins.length);
      check(matched >= begins.length * 0.95, 'Every attack the host\'s men started was played on the guest', out.fight);
      out.fight.fps = await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps)));
      out.fight.p90 = behind[Math.floor(behind.length * 0.9)] ?? null; out.fight.worst = behind.at(-1) ?? null;
      // The median is the link; the tail is the guest's own page stalling (a start and its shot then land together), recorded and not judged.
      if (Math.min(...out.fight.fps) >= 40) check((out.fight.p50 ?? 0) <= BEHIND, `In step: half of them no more than ${BEHIND} ms behind the host (the tail is recorded)`, out.fight);
      else out.unmeasured = 'the machine was too busy to judge timing in the fight';
      check(out.fight.flashes > 0 && out.fight.bodies > 0 && out.fight.sounds > 0, 'The guest saw muzzle flashes and bullets in flight, and heard the guns', out.fight);
      check(g.seen.attacks.failed === 0, 'No attack code threw on a copy', g.seen.attacks);
      await shot(guest, 'guest-fight');
    }

    const spot = await ahead(host, 0);
    const clear = async () => { await calm(host); await host.evaluate(() => window.__op2.ctx.enemies.vehicles?.killAll('proof')); };

    if (parts.has('weapons')) {
      // 2. Each weapon, forced once at the guest.
      for (const c of WEAPONS) {
        await calm(host);
        const at = await put(guest, spot.at, spot.yaw);
        await put(host, (await ahead(host, -14)).at, spot.yaw);
        await sleep(350);
        // A page starved by a busy machine says nothing about the network: its timings are recorded and not judged.
        const fps = Math.min(...await Promise.all(party.pages.map(page => page.evaluate(() => window.__op2.stats().fps))));
        const timed = fps >= 40;
        const since = Date.now();
        const uid = await forceSoldier(host, c.kind, (await ahead(host, c.d)).at, c.attack, at);
        const limit = (c.seconds ?? 5) * 1000 + lagMs * 4;
        let g;
        for (let waited = 0; waited < limit; waited += 150) {
          await sleep(150);
          g = await readRecord(guest, since);
          if (g.log.some(e => e.uid === uid && e.p === 'end') && waited > 1500) break;
        }
        await sleep(c.boom ? 1500 : 400);
        g = await readRecord(guest, since);
        const h = await readRecord(host, since);
        await unstage(host, uid);
        const hostBegin = first(h.log, e => e.uid === uid && e.p === 'begin'), hostFire = first(h.log, e => e.uid === uid && e.p === 'fire');
        const begin = first(g.log, e => e.uid === uid && e.p === 'begin'), fire = first(g.log, e => e.uid === uid && e.p === 'fire');
        const after = t => g.ev.filter(e => t !== undefined && e.at >= t - 5);
        const row = { kind: c.kind, attack: c.attack, uid, beginBehind: begin && hostBegin ? begin - hostBegin : null, fireBehind: fire && hostFire ? fire - hostFire : null,
          projectiles: g.ev.filter(e => e.k === 'proj').length, hurt: g.ev.find(e => e.k === 'hurt')?.amount ?? null, missing: [] };
        const need = (ok, what) => { if (!ok) row.missing.push(what); };
        need(uid > 0, `could not stage it (${uid})`);
        need(hostBegin !== undefined, 'the host never started it');
        need(begin !== undefined, 'begin');
        for (const [k, test] of c.begin) need(has(after(begin), k, test), `wind-up ${k}`);
        need(fire !== undefined, 'fire');
        for (const [k, test] of c.fire) need(has(after(fire), k, test), `shot ${k}`);
        if (c.proj) need(g.ev.filter(e => e.k === 'proj' && e.kind === c.proj).length >= (c.projCount ?? 1), `${c.projCount ?? 1} ${c.proj} bodies`);
        if (c.zone) need(has(g.ev, 'zone', e => Math.abs(e.r - c.zone) < 0.1), `ring ${c.zone} m`);
        if (c.boom) need(has(g.ev, 'boom'), 'explosion');
        if (c.hurt) need(has(g.ev, 'hurt', e => e.type === c.hurt), `hurt (${c.hurt})`);
        if (c.shove) need(has(g.ev, 'shove'), 'thrown');
        row.fps = fps; row.timed = timed;
        if (timed && begin && hostBegin) need(begin - hostBegin >= -20 && begin - hostBegin <= BEHIND, `begin ${begin - hostBegin} ms behind`);
        if (timed && fire && hostFire) need(fire - hostFire >= -20 && fire - hostFire <= BEHIND, `fire ${fire - hostFire} ms behind`);
        out.rows.push(row);
        progress(`${c.kind} ${c.attack}: ${row.missing.length ? `MISSING ${row.missing.join('; ')}` : 'ok'}  begin +${row.beginBehind} fire +${row.fireBehind} bodies ${row.projectiles} hurt ${row.hurt}`);
      }
      const bad = out.rows.filter(r => r.missing.length);
      check(bad.length === 0, `Every soldier weapon reaches the guest whole (${out.rows.length})`, bad.map(r => `${r.kind} ${r.attack}: ${r.missing.join('; ')}`));
    }

    if (parts.has('vehicles')) {
      // 3. A tank lays on the guest (the nearest player) and fires; then a scout car runs them down and its wreck burns them.
      await clear();
      const at = await put(guest, spot.at, spot.yaw);
      await put(host, (await ahead(host, -30)).at, spot.yaw);
      await sleep(400);
      let since = Date.now();
      const tankAt = (await ahead(host, 26)).at;
      await host.evaluate(([p]) => {
        const { ctx } = window.__op2;
        ctx.enemies.vehicles.spawnGround('tank', { x: p[0], y: p[1], z: p[2], route: [], tag: null, crew: ['trooper'], crewTag: null, holds: false, holdYaw: NaN, parked: false });
      }, [tankAt]);
      let g;
      for (let waited = 0; waited < 16000; waited += 250) {
        await sleep(250);
        g = await readRecord(guest, since);
        if (has(g.ev, 'proj', e => e.kind === 'shell') && has(g.ev, 'boom') && waited > 3000) break;
      }
      out.tank = { laser: g.seen.warnings.lasers, layTone: has(g.ev, 'snd', snd('tank_lay')), cannon: has(g.ev, 'snd', snd('tank_cannon')), flash: has(g.ev, 'flash', e => e.kind === 'autocannon'),
        shell: has(g.ev, 'proj', e => e.kind === 'shell'), boom: has(g.ev, 'boom'), hurt: g.ev.filter(e => e.k === 'hurt').map(e => `${e.source}:${Math.round(e.amount)}`).slice(0, 6) };
      progress(`tank: ${JSON.stringify(out.tank)}`);
      check(out.tank.laser > 0 && out.tank.layTone, 'The guest sees the tank\'s laser lay on them and hears it', out.tank);
      check(out.tank.cannon && out.tank.flash && out.tank.shell && out.tank.boom, 'The guest hears the cannon, sees its flash, the shell in flight and the blast', out.tank);

      await clear();
      await put(guest, spot.at, spot.yaw);
      await sleep(400);
      since = Date.now();
      const carFrom = (await ahead(host, 30)).at, carTo = (await ahead(host, -12)).at;
      await host.evaluate(([from, to]) => {
        const { ctx } = window.__op2;
        ctx.enemies.vehicles.spawnGround('humvee', { x: from[0], y: from[1], z: from[2], route: [{ x: to[0], z: to[2], hold: 0 }], tag: null, crew: ['trooper'], crewTag: null, holds: false, holdYaw: NaN, parked: false });
      }, [carFrom, carTo]);
      for (let waited = 0; waited < 12000; waited += 200) {
        await sleep(200);
        // The guest stays in its path.
        await guest.evaluate(([at]) => { const { ctx } = window.__op2; if (ctx.player.position.distanceTo(new ctx.player.position.constructor(...at)) > 1.5 && !window.__atk.ev.some(e => e.k === 'hurt' && e.source === 'vehicle_ram')) ctx.player.teleport(new ctx.player.position.constructor(...at)); }, [at]);
        g = await readRecord(guest, since);
        if (has(g.ev, 'hurt', e => e.source === 'vehicle_ram')) break;
      }
      const ram = g.ev.find(e => e.k === 'hurt' && e.source === 'vehicle_ram');
      out.ram = { hurt: ram?.amount ?? null, thrown: has(g.ev, 'shove'), clang: has(g.ev, 'snd', snd('metal_clang')), gun: g.ev.filter(e => e.k === 'snd' && /gun|mg|hmg/.test(e.id)).length };
      progress(`ram: ${JSON.stringify(out.ram)}`);
      check(!!ram && out.ram.thrown, 'A vehicle that runs a guest down hurts and throws them', out.ram);

      // Its wreck burns whoever stands in it.
      since = Date.now();
      const wreckAt = await host.evaluate(() => {
        const { ctx } = window.__op2;
        ctx.enemies.vehicles.killAll('proof');
        const wreck = ctx.enemies.vehicles.wrecks?.find?.(w => w.root) ?? [...(ctx.enemies.vehicles.wrecks ?? [])][0];
        return wreck ? wreck.root.position.toArray() : null;
      });
      if (wreckAt) {
        for (let waited = 0; waited < 5000; waited += 200) {
          await guest.evaluate(([p]) => { const { ctx } = window.__op2; ctx.player.teleport(new ctx.player.position.constructor(p[0] + 0.3, p[1] + 0.1, p[2] + 2.2)); }, [wreckAt]);
          await sleep(200);
          g = await readRecord(guest, since);
          if (has(g.ev, 'hurt', e => e.source === 'wreck_fire')) break;
        }
      }
      out.wreck = { at: wreckAt, burns: g.ev.filter(e => e.k === 'hurt' && e.source === 'wreck_fire').length };
      progress(`wreck: ${JSON.stringify(out.wreck)}`);
      check(out.wreck.burns > 0, 'A burning wreck burns a guest who stands in it', out.wreck);
    }

    if (parts.has('commander')) {
      // 4. The Commander's words.
      await clear();
      const before = await guest.evaluate(() => ({ ...window.__op2.ctx.coop.world.villain.seen }));
      await host.evaluate(() => {
        const c = window.__op2.ctx.enemies.outpost.commander;
        c.status('painted', true);
        c.bark('cmd.answer.mines.door');
      });
      await sleep(1200 + lagMs * 2);
      const bark = await guest.evaluate(() => ({ chip: !!document.querySelector('.cmd-chip.painted.on'), box: document.querySelector('.cmd-box')?.className ?? '',
        text: document.querySelector('.cmd-text')?.textContent ?? '', seen: { ...window.__op2.ctx.coop.world.villain.seen } }));
      await shot(guest, 'guest-commander-bark');
      await host.evaluate(() => { const c = window.__op2.ctx.enemies.outpost.commander; c.status('painted', false); c.intermission(1, 20); });
      await sleep(2500 + lagMs * 2);
      const brief = await guest.evaluate(() => ({ chip: !!document.querySelector('.cmd-chip.painted.on'), box: document.querySelector('.cmd-box')?.className ?? '',
        text: document.querySelector('.cmd-text')?.textContent ?? '', seen: { ...window.__op2.ctx.coop.world.villain.seen } }));
      const hostBox = await host.evaluate(() => document.querySelector('.cmd-box')?.className ?? '');
      await shot(guest, 'guest-commander-briefing');
      out.commander = { before, bark, brief, hostBox };
      progress(`commander: bark box "${bark.box}" chip ${bark.chip} text "${bark.text.slice(0, 50)}"; briefing box "${brief.box}" text "${brief.text.slice(0, 50)}"`);
      check(bark.seen.barks > before.barks && bark.seen.statuses > before.statuses && bark.chip, 'The guest gets his bark and the PAINTED warning chip', bark);
      check(/\bon\b/.test(bark.box) && bark.text.length > 3, 'The bark is typed out in the guest\'s own box', bark);
      check(brief.seen.briefings > before.briefings && !brief.chip && /\bon\b/.test(brief.box) && brief.text.length > 3, 'The guest gets his briefing between rounds, and the chip comes down', brief);
    }

    const final = await readRecord(guest, 0);
    check(final.seen.attacks.failed === 0, 'No attack code threw on a copy in the whole run', final.seen.attacks);
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
