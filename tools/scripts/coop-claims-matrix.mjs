// The claims matrix, in the browser. For every weapon, mod load, melee weapon, grenade, call-in and perk that can be scripted,
// two trials on the same still targets from the same spot: first the HOST fires (its damage goes straight into the damage model:
// the single-player path), then the GUEST fires (every hit a claim the host checks). The guest's trial must lose nothing:
// every claim it sent is applied on the host, none refused, none cut, and each hit deals what the host's own identical hit
// dealt: the host notes every hit by round, region and load, its own and the guest's, with what the damage model made of it
// (dealt over claimed), and where both made the same hit that must be the same number. (Per shot the two differ a little by where on the body the rounds land: the guest hits
// what is on its own screen, and the still targets breathe.) Damage per shot is reported side by side; the guest far under the host (40%) fails,
// except at arm's length (melee, the Kiln), where a target a hit has shoved back is in or out of reach by luck on either page.
// A trial runs until the row's shots are fired, not for a fixed time, so a starved page proves the same thing more slowly.
// `gone` is a claim on a man the host had already killed: nobody lost a hit, so it is counted, not failed.
// Targets: a column of five husks, a boss (a Juggernaut), and a parked truck. Endless Humans, the one survival mode with vehicles.
//
//   OP2_NO_HMR=1 npx vite --port 5350 --strictPort
//   node tools/shot.mjs --port 5350 --w 1280 --h 720 --wait 500 --timeout 1500 --script tools/scripts/coop-claims-matrix.mjs --out tools/out/coop/claims/matrix.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05   the game's network simulator on both pages
//   CLAIMS_HITCH=1                         the host capped to about 15 frames a second with a 300 ms stall every 2 s, during the guest's trials
//   CLAIMS_ONLY=smg,judge                  only the rows whose name starts with one of these
//   CLAIMS_TAG=bad                         names the evidence file: claims-matrix-<tag>-evidence.json
import { writeFileSync } from 'node:fs';
import { inMatch, kit, startParty, state } from './coop-kit.mjs';

/** mode: how the trigger is worked. target: what stands in front. `tol`: set for a row that rolls dice (reported, loosely held); unset is exact. */
const gun = (name, weapon, extra = {}) => ({ name, weapon, mode: 'hold', target: 'line', seconds: 2, ...extra });
const ROWS = [
  gun('smg', 'smg'), gun('smg + suppressor + AP', 'smg', { mods: ['suppressor', 'smgAp'] }), gun('smg akimbo', 'smg', { mods: ['smgAkimbo'] }),
  gun('smg under Berserk and Haste', 'smg', { perks: ['berserk', 'haste'] }),
  gun('smg + shock rounds', 'smg', { perks: ['shock'], tol: 0.35 }), gun('smg + ricochet', 'smg', { perks: ['ricochet'], tol: 0.35 }),
  gun('smg + Hellfire rounds', 'smg', { perks: ['hellfire'], tol: 0.4 }),
  gun('gimlet', 'gimlet'), gun('gimlet + short barrel + HP', 'gimlet', { mods: ['gimletShort', 'gimletHp'] }),
  gun('harrow', 'harrow'), gun('harrow + API', 'harrow', { mods: ['harrowApi'], tol: 0.1, burns: 'maybe' }), gun('flail', 'flail'), gun('flail + +P', 'flail', { mods: ['flailPlusP'] }),
  gun('shotgun', 'shotgun', { mode: 'tap', tol: 0.35 }), gun('shotgun + flechettes', 'shotgun', { mode: 'tap', mods: ['shotgunFlechette'], tol: 0.35 }),
  gun('thresher', 'thresher', { tol: 0.35 }), gun('deuce (both barrels)', 'deuce', { mode: 'both', tol: 0.35 }), gun('deuce quad + flechettes', 'deuce', { mode: 'both', mods: ['deuceQuad', 'deuceFlechette'], tol: 0.35 }),
  gun('rocket', 'rocket', { mode: 'tap', tol: 0.4 }), gun('autocannon', 'autocannon', { mode: 'tap', tol: 0.4 }), gun('autocannon + flak', 'autocannon', { mode: 'tap', mods: ['autocannonFlak'], tol: 0.5 }),
  gun('sabot', 'sabot', { mode: 'tap' }), gun('sabot + brake + Raufoss', 'sabot', { mode: 'tap', mods: ['sabotBrake', 'raufoss'], tol: 0.4 }),
  gun('awl', 'awl', { mode: 'tap' }), gun('awl + bolt + AP + barrel', 'awl', { mode: 'tap', mods: ['awlBolt', 'awlAp', 'awlBarrel'] }),
  gun('judge', 'judge', { mode: 'tap', tol: 0.35 }), gun('judge fan', 'judge', { mode: 'fan', seconds: 5, tol: 0.35 }),
  gun('judge fan of six', 'judge', { mode: 'fan', seconds: 6, mods: ['judgeHammer', 'judgeGrip'], tol: 0.35 }), gun('judge akimbo', 'judge', { mode: 'tap', mods: ['judgeAkimbo'], tol: 0.35 }),
  gun('rivet', 'rivet', { mode: 'tap' }), gun('rivet akimbo', 'rivet', { mode: 'tap', mods: ['rivetAkimbo'] }),
  gun('ultramag + laser + compensator', 'ultramag', { mode: 'tap', mods: ['ultramagLam', 'ultramagComp'] }), gun('ultramag akimbo under Berserk and Haste', 'ultramag', { mode: 'tap', mods: ['ultramagAkimbo'], perks: ['berserk', 'haste'] }),
  gun('autoraffica', 'autoraffica', { mode: 'tap' }), gun('autoraffica akimbo', 'autoraffica', { mode: 'tap', mods: ['autorafficaAkimbo'] }),
  gun('gun kata (rivet akimbo)', 'rivet', { mode: 'kata', mods: ['rivetAkimbo'], seconds: 4, tol: 0.5 }),
  gun('lance rail', 'lance', { mode: 'charge', seconds: 5, tol: 0.4 }),
  gun('buzzsaw', 'buzzsaw', { tol: 0.35 }), gun('buzzsaw 12 mm', 'buzzsaw', { mods: ['trommel12'], tol: 0.1 }), gun('piledriver', 'piledriver'),
  gun('kiln', 'kiln', { tol: 0.5, burns: true, near: 3, smooth: true }), gun('stakegun', 'stakegun', { mode: 'tap', tol: 0.1 }),
  gun('sword', 'sword', { near: 1.6, tol: 0.5 }), gun('knife', 'knife', { near: 1.3, tol: 0.5 }), gun('crowbar', 'crowbar', { near: 1.3, tol: 0.5 }),
  gun('shovel', 'shovel', { near: 1.3, tol: 0.5 }), gun('baton', 'baton', { near: 1.3, tol: 0.5 }),
  gun('sword under Berserk and Haste', 'sword', { near: 1.6, perks: ['berserk', 'haste'], tol: 0.5 }),
  gun('grenade', 'smg', { mode: 'grenade', seconds: 4, tol: 0.6, near: 5 }),
  gun('frost nova', 'smg', { mode: 'idle', perks: ['frostNova'], seconds: 2, freezes: true, tol: 9 }),
  gun('airstrike', 'smg', { mode: 'callin', callin: 'airstrike', seconds: 9, tol: 9 }),
  gun('black sun', 'smg', { mode: 'callin', callin: 'blackSun', seconds: 9, tol: 9 }),
  // A boss: an instakill is a 900 hit for host and guest alike; plates and phases are the host's damage model either way.
  gun('smg on a boss', 'smg', { target: 'boss', tol: 0.1 }), gun('sabot on a boss', 'sabot', { mode: 'tap', target: 'boss', tol: 0.1 }),
  gun('autocannon on a boss (instakill shell)', 'autocannon', { mode: 'tap', target: 'boss', tol: 0.4 }), gun('sword on a boss', 'sword', { target: 'boss', near: 2.4, tol: 0.5 }),
  // A vehicle: lives on the host; the guest has its hit boxes.
  gun('smg on a truck', 'smg', { target: 'truck' }), gun('harrow on a truck', 'harrow', { target: 'truck' }), gun('sabot on a truck', 'sabot', { mode: 'tap', target: 'truck' }),
  gun('shotgun on a truck', 'shotgun', { mode: 'tap', target: 'truck', tol: 0.35 }), gun('rocket on a truck', 'rocket', { mode: 'tap', target: 'truck', tol: 0.4 }),
  gun('autocannon on a truck', 'autocannon', { mode: 'tap', target: 'truck', tol: 0.4 }), gun('grenade on a truck', 'smg', { mode: 'grenade', target: 'truck', seconds: 4, tol: 0.6 }),
];

/** Host: a quiet world, and a lane to shoot down: the direction from the spawn with the longest clear run. */
const prepare = host => host.evaluate(() => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  // Every standable point on a 2 m grid, sixteen directions each: the longest run with floor under it and 1.2 m clear either side.
  const base = ctx.world.playerSpawns[0].position, bounds = ctx.world.bounds, nav = ctx.world.nav;
  const floor = (x, z) => { const y = nav.groundHeight(x, base.y, z); return Number.isFinite(y) && Math.abs(y - base.y) < 0.6 ? y : NaN; };
  let best = { yaw: 0, run: 0, from: base.toArray() };
  for (let x = Math.ceil(bounds.min.x) + 1; x < bounds.max.x - 1; x += 2) for (let z = Math.ceil(bounds.min.z) + 1; z < bounds.max.z - 1; z += 2) {
    const y = floor(x, z);
    if (Number.isNaN(y)) continue;
    const spawn = new V(x, y, z);
    for (let i = 0; i < 16; i++) {
      const yaw = i / 16 * Math.PI * 2, dir = new V(-Math.sin(yaw), 0, -Math.cos(yaw));
      let run = 34;
      for (const height of [0.5, 1.2, 1.7]) {
        for (const side of [-1.2, 0, 1.2]) {
          const from = spawn.clone().add(new V(Math.cos(yaw) * side, height, -Math.sin(yaw) * side));
          const hit = ctx.physics.raycast(from, dir, 34, 1);
          run = Math.min(run, hit ? hit.distance : 34);
        }
        if (run <= best.run) break;
      }
      if (run <= best.run) continue;
      for (let d = 2; d < run; d += 2) if (Number.isNaN(floor(x + dir.x * d, z + dir.z * d))) { run = d - 2; break; }
      if (run > best.run) best = { yaw, run, from: [x, y, z] };
    }
  }
  window.__claims = { yaw: best.yaw, run: best.run, from: best.from, mine: {}, theirs: {}, burn: 0, freeze: 0, bolt: 0, dealt: 0, hits: 0, blocked: 0, vehicle: 0, sources: {} };
  // What a refused claim looked like, for the evidence: the first twenty.
  const validator = ctx.coop.world.validator, check = validator.check.bind(validator);
  window.__refusedClaims = [];
  validator.check = (id, value, now, scene) => {
    const verdict = check(id, value, now, scene);
    if (!verdict.ok && window.__refusedClaims.length < 20) {
      const target = ctx.enemies.alive.find(e => e.uid === value?.target);
      window.__refusedClaims.push({ why: verdict.why, uid: value?.target, source: value?.damage?.source, region: value?.damage?.region, point: value?.damage?.point, origin: value?.origin,
        hop: value?.hop, target: scene.target, eye: scene.eye, near: scene.near?.(value?.damage?.point ?? [0, 0, 0]), speed: scene.speed, posture: target?.char?.anim?.posture, downed: target?.downed });
    }
    return verdict;
  };
  // Fire, frost and bolts set on the host, by the host's own weapon or a guest's claim.
  const afflict = ctx.enemies.afflict.bind(ctx.enemies);
  ctx.enemies.afflict = (enemy, kind, seconds) => { const c = window.__claims; c[kind] = (c[kind] ?? 0) + 1; return afflict(enemy, kind, seconds); };
  ctx.events.on('enemy:hit', e => {
    const c = window.__claims;
    if (['burn', 'bleed', 'hazard'].includes(e.damage.source)) return;
    if (e.result.blocked) { c.blocked++; return; }
    c.dealt += e.result.dealt; c.hits++;
    c.sources[e.damage.source] = (c.sources[e.damage.source] ?? 0) + 1;
    // The same hit, by whoever made it: a blast rolls dice and a frozen or plated man is another sum, so those are left out.
    if (e.damage.type === 'explosive' || e.result.armour || e.enemy.frozen > 0) return;
    const d = e.damage, key = [d.source, d.type, d.region ?? '-', d.load ?? '-', d.amount >= 9999 ? 'kill' : '', e.enemy.id].join('|');
    const book = ctx.coop.world.applying ? c.theirs : c.mine;
    // What the damage model made of the round: dealt over claimed (the region's share, the load's, the boss's).
    (book[key] ??= {})[Math.round(e.result.dealt / d.amount * 200) / 200] = true;
  });
  return best;
});

/** Host: clears the field and stands the row's targets in the lane. Returns what to aim at. */
const stand = (host, target, near, fresh) => host.evaluate(([target, near, fresh]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor, c = window.__claims;
  ctx.waves.reset(); ctx.waves.nextWaveIn = 1e9;
  for (const enemy of [...ctx.enemies.alive]) ctx.enemies.withdraw(enemy);
  for (const v of [...(ctx.enemies.vehicles?.live ?? [])]) v.remove();
  if (ctx.enemies.vehicles) ctx.enemies.vehicles.live.length = 0;
  const spawn = new V(...c.from), dir = new V(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
  const hold = enemy => {
    enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true; enemy.health = enemy.maxHealth = 1e7;
    // The head's and the limbs' own pools too: a still target that dies to its tenth headshot leaves a body, and sixty trials of bodies stall the pages.
    for (const region of [...enemy.limbHp.keys()]) enemy.limbHp.set(region, 1e9);
    return enemy;
  };
  const first = near ?? Math.min(8, c.run * 0.35);
  c.last = c.uids ?? [];
  c.uids = []; c.truck = null;
  ctx.gore.clear();
  if (fresh) { c.mine = {}; c.theirs = {}; }
  if (target === 'truck') {
    const at = spawn.clone().addScaledVector(dir, Math.min(13, c.run - 4));
    const v = ctx.enemies.vehicles.spawnGround('truck', { x: at.x, y: at.y, z: at.z, route: [], tag: null, crew: [], crewTag: null, holds: false, holdYaw: c.yaw + Math.PI / 2, parked: true });
    v.health = 1e7;
    const take = v.take.bind(v);
    v.take = (amount, ...rest) => { c.vehicle += amount; return take(amount, ...rest); };
    c.truck = v;
    return { aim: [at.x, at.y + 1.3, at.z], last: c.last };
  }
  const kinds = target === 'boss' ? ['juggernaut'] : ['husk', 'husk', 'husk', 'husk', 'husk'];
  const step = Math.min(2, (c.run - first - 2) / kinds.length);
  kinds.forEach((kind, i) => {
    const enemy = ctx.enemies.spawn(kind, spawn.clone().addScaledVector(dir, first + i * step));
    if (enemy) { hold(enemy); c.uids.push(enemy.uid); }
  });
  const lead = ctx.enemies.alive.find(e => e.uid === c.uids[0]);
  return { aim: lead ? [lead.center.x, lead.center.y, lead.center.z] : null, uids: c.uids, last: c.last, boss: lead?.isBoss };
}, [target, near ?? null, fresh]);

/** Any page: stands the player at the firing point (or beside it), facing down the lane, with the row's weapon, mods and perks. */
const arm = (page, row, lane, shooting) => page.evaluate(([row, lane, shooting]) => {
  const { ctx, game } = window.__op2, V = ctx.player.position.constructor;
  const spawn = new V(...lane.from);
  const side = shooting ? 0 : 3, back = shooting ? 0 : 3;
  ctx.player.teleport(new V(spawn.x + Math.cos(lane.yaw) * side + Math.sin(lane.yaw) * back, spawn.y, spawn.z - Math.sin(lane.yaw) * side + Math.cos(lane.yaw) * back), lane.yaw);
  ctx.player.modifiers.invulnerable = true;
  game.setState('playing');
  if (!shooting) return;
  const w = ctx.weapons;
  ctx.progression.perks?.clear?.();
  for (const id of [...w.fitted]) w.fitMod(id, false);
  w.give(row.weapon);
  for (const mod of row.mods ?? []) { w.mods.add(mod); w.fitMod(mod, true); }
  w.switchTo(row.weapon); w.refillMagazines();
}, [row, lane, shooting]);

/** The shooter: works the trigger the row's way for its seconds, aiming at `aim`, then lets go. Returns shots fired. */
const shoot = (page, row, aim) => page.evaluate(async ([row, aim]) => {
  const { ctx, game } = window.__op2, V = ctx.player.position.constructor;
  const w = ctx.weapons, input = ctx.input;
  let shots = 0;
  const off = ctx.events.on('weapon:fired', () => { shots++; });
  const point = new V(...aim);
  // A grenade is thrown at their feet, so it stays among them.
  if (row.mode === 'grenade') point.y -= 1.1;
  const face = () => {
    const d = point.clone().sub(ctx.player.eye);
    ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  face();
  // The aim is held dead still for the trial: recoil climb would land the two shooters' rounds on different parts of the body.
  // Put back before every player update (not a locked property: the player's own yaw wrap would spin on one).
  const yaw = ctx.player.yaw, pitch = ctx.player.pitch, update = ctx.player.update;
  ctx.player.update = function (...args) { this.yaw = yaw; this.pitch = pitch; return update.apply(this, args); };
  await wait(250);
  const began = performance.now(), until = began + row.seconds * 1000, gameBegan = ctx.time.elapsed;
  // A strike, a fuse or a perk runs on the game's clock, which a starved page runs slow: wait in that clock.
  const timed = ['idle', 'callin', 'grenade'].includes(row.mode);
  const want = row.want ?? ({ hold: 12, tap: 4, both: 3, fan: 6, charge: 2, kata: 5 }[row.mode] ?? 0), giveUp = began + Math.max(20000, row.seconds * 6000);
  let tick = 0, last = 0;
  if (row.mode === 'callin') {
    const manager = ctx.progression.callInsManager;
    // The player's own call (not the Commander's `ai` one), at the lead target, flown in along the lane.
    manager.callAt(row.callin, point, new V(-Math.sin(ctx.player.yaw), 0, -Math.cos(ctx.player.yaw)), false);
  }
  while (timed ? ctx.time.elapsed - gameBegan < row.seconds && performance.now() < giveUp : performance.now() < until || (shots < want && performance.now() < giveUp)) {
    if (game.state !== 'playing') game.setState('playing');
    // A perk that runs out is given again; a one-off (Frost Nova's ring) is cast once and left to spread.
    for (const perk of row.perks ?? []) if (tick === 0 || (row.mode !== 'idle' && !ctx.progression.perks.isActive(perk))) ctx.progression.grant(perk);
    w.refillMagazines();
    const now = performance.now();
    if (row.mode === 'hold') input.simulate('fire', true);
    else if (row.mode === 'tap') input.simulate('fire', tick % 2 === 0);
    else if (row.mode === 'both') { input.simulate('aim', tick % 4 === 0); }
    else if (row.mode === 'fan') { const phase = (now - began) % 2600; input.simulate('aim', phase < 1900); }
    else if (row.mode === 'charge') { const phase = (now - began) % 1400; input.simulate('fire', phase < 1150); }
    else if (row.mode === 'kata' && now - last > 2200) { last = now; w.kata(); }
    else if (row.mode === 'grenade') { w.grenades = 4; input.simulate('grenade', now - last > 900 ? (last = now, true) : false); }
    tick++;
    await frame();
  }
  for (const action of ['fire', 'aim', 'grenade']) input.simulate(action, false);
  delete ctx.player.update;
  off();
  return { shots, frames: tick, fps: Math.round(tick / ((performance.now() - began) / 1000)), state: game.state, focus: document.hasFocus(), hidden: document.hidden };
}, [row, aim]);

/** Host: totals so far, and how the targets stand. */
const read = host => host.evaluate(() => {
  const { ctx } = window.__op2, c = window.__claims, world = ctx.coop.world;
  const targets = ctx.enemies.alive.filter(e => c.uids.includes(e.uid));
  return { burn: c.burn, freeze: c.freeze, bolt: c.bolt, dealt: c.dealt, hits: c.hits, blocked: c.blocked, vehicle: c.vehicle, sources: { ...c.sources }, accepted: world.stats.accepted, rejected: world.stats.rejected,
    refused: { ...world.validator.refused }, clamped: world.validator.clamped, doubted: world.validator.doubted,
    same: Object.keys(c.theirs).filter(k => c.mine[k]).length,
    differ: Object.keys(c.theirs).filter(k => c.mine[k] && !Object.keys(c.theirs[k]).every(v => c.mine[k][v])).map(k => [k, Object.keys(c.mine[k]), Object.keys(c.theirs[k])]),
    burning: targets.filter(e => e.burning > 0).length, frozen: targets.filter(e => e.frozen > 0).length, alive: targets.length };
});
const sentBy = page => page.evaluate(() => ({ ...window.__op2.ctx.coop.world.claims.sent }));
const delta = (after, before) => Object.fromEntries(Object.keys(after).filter(k => typeof after[k] === 'number').map(k => [k, after[k] - (before[k] ?? 0)]));
const sum = object => Object.values(object ?? {}).reduce((a, b) => a + b, 0);

/** Host: about 15 frames a second, with a 300 ms stall every two seconds, while `on`. */
const hitch = (host, on) => host.evaluate(on => {
  window.__hitch = on;
  if (!on || window.__hitching) return;
  window.__hitching = true;
  let last = performance.now(), stallAt = last + 2000;
  const burn = () => {
    if (!window.__hitch) { window.__hitching = false; return; }
    const now = performance.now();
    const until = now > stallAt ? (stallAt = now + 2000, now + 300) : last + 62;
    while (performance.now() < until);
    last = performance.now();
    requestAnimationFrame(burn);
  };
  requestAnimationFrame(burn);
}, on);

export default async function (host, { sleep, outDir }) {
  const tag = `claims-matrix-${process.env.CLAIMS_TAG ?? (process.env.CLAIMS_HITCH ? 'hitch' : process.env.COOP_SIM ? 'bad' : 'clean')}`;
  const out = { errors: [], checks: [], screenshots: [], rows: [], net: process.env.COOP_SIM ?? 'clean', hitch: !!process.env.CLAIMS_HITCH };
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const only = process.env.CLAIMS_ONLY?.split(',').map(s => s.trim()).filter(Boolean);
  const rows = only ? ROWS.filter(row => only.some(name => row.name.startsWith(name))) : ROWS;
  let party;
  try {
    party = await startParty(host, { mode: 'outpost', players: 2, net: process.env.COOP_SIM, out, progress, sleep });
    const guest = party.guest;
    await inMatch(party.pages, party.mode.contract);
    const lane = await prepare(host);
    progress(`lane: ${lane.run.toFixed(1)} m clear at yaw ${lane.yaw.toFixed(2)}`);
    check(lane.run > 10, 'There is a clear lane to shoot down', lane);
    // The guest's lag before anything is read back: the simulator's delay, its resends, and the host's stalls.
    const settle = (process.env.COOP_SIM ? 1400 : 500) + (process.env.CLAIMS_HITCH ? 900 : 0);
    let failures = 0;

    for (const row of rows) {
      // A trial on a starved page is void (flames skip past bodies at 4 frames a second, alone as well): it is run again.
      let result;
      for (let attempt = 1; attempt <= 3; attempt++) {
        result = { name: row.name, attempt };
        for (const who of ['host', 'guest']) {
          const page = who === 'host' ? host : guest, other = who === 'host' ? guest : host;
          const stood = await stand(host, row.target, row.near, who === 'host');
          if (!stood.aim) { result.skipped = 'no target'; break; }
          // Every guest must have the targets (and the truck's hit boxes) before a round is fired.
await guest.waitForFunction(([uids, last, truck]) => {
            const { ctx } = window.__op2;
            const mine = ctx.enemies.alive.map(e => e.uid);
            // These targets, and none of the last trial's: those stay on the guest's screen for a moment after the host withdrew them.
            return uids.every(uid => mine.includes(uid)) && !last.some(uid => mine.includes(uid)) && (!truck || ctx.coop.world.claims.vehicleHits.fleet.size === 1);
          }, [stood.uids ?? [], stood.last ?? [], row.target === 'truck'], { timeout: 90000 });
          await guest.evaluate(() => window.__op2.ctx.gore.clear());
          await sleep(row.target === 'boss' ? 2500 : 700);
          await arm(other, row, lane, false); await arm(page, row, lane, true);
          // The window in front gets the frames when the machine is short of them: the shooter's.
          await page.bringToFront().catch(() => {});
          await sleep(350);
          const before = await read(host), sentBefore = await sentBy(guest);
          if (who === 'guest' && process.env.CLAIMS_HITCH) await hitch(host, true);
          const fired = await shoot(page, row, stood.aim), shots = fired.shots;
          await sleep(settle + (row.mode === 'grenade' || row.weapon === 'kiln' ? 2500 : 0));
          // Every claim the guest sent is in the host's books (applied, refused, or on a man already dead) before they are read:
          // on a slow link and a starved page the last of them are still on their way.
          const allIn = async () => {
            const now = await read(host), sent = sum(delta(await sentBy(guest), sentBefore));
            return now.accepted - before.accepted + now.rejected - before.rejected + (now.refused.gone ?? 0) - (before.refused.gone ?? 0) >= sent;
          };
          for (let waited = 0; who === 'guest' && waited < 20000 && !await allIn(); waited += 400) await sleep(400);
          await hitch(host, false);
          const after = await read(host), sentAfter = await sentBy(guest);
          const perf = await page.evaluate(() => { const st = window.__op2.stats(), { ctx } = window.__op2; return { fps: st.fps, cpuMs: st.cpuMs, draws: st.drawCalls, tris: st.triangles, enemies: ctx.enemies.alive.length, dying: ctx.enemies.dying?.length, scene: ctx.render.scene.children.length }; });
          const d = delta(after, before), sent = delta(sentAfter, sentBefore);
          const dealt = row.target === 'truck' ? d.vehicle : d.dealt;
          result[who] = { shots, frames: fired.frames, shooterFps: fired.fps, perf, dealt: Math.round(dealt), perShot: shots ? Math.round(dealt / shots * 10) / 10 : 0, hits: d.hits, blocked: d.blocked,
            burning: d.burn, frozen: d.freeze, bolted: d.bolt, same: after.same, differ: after.differ,
            ...(who === 'guest' ? { sent, accepted: d.accepted, rejected: d.rejected, clamped: d.clamped, doubted: d.doubted,
              refused: Object.fromEntries(Object.entries(after.refused).map(([k, v]) => [k, v - (before.refused[k] ?? 0)]).filter(([, v]) => v)) } : {}) };
        }
        if (result.guest && result.host) {
          const g = result.guest, h = result.host;
          const claims = sum(g.sent);
          const problems = [];
          const gone = g.refused.gone ?? 0;
          delete g.refused.gone;
          g.gone = gone;
          if (claims === 0 && h.dealt > 0) problems.push('the guest sent no claims');
          if (g.accepted + gone !== claims) problems.push(`${claims} claims sent, ${g.accepted} applied, ${gone} on men already dead`);
          if (g.rejected) problems.push(`${g.rejected} rejected`);
          if (sum(g.refused)) problems.push(`refused ${JSON.stringify(g.refused)}`);
          if (g.clamped) problems.push(`${g.clamped} cut to the cap`);
          const fires = !['idle', 'callin', 'grenade'].includes(row.mode);
          if (fires && h.shots === 0) problems.push('the host fired nothing');
          if (fires && g.shots === 0) problems.push('the guest fired nothing');
          const ratio = h.perShot > 0 && g.shots > 0 ? g.perShot / h.perShot : h.dealt > 0 ? g.dealt / h.dealt : 1;
          result.ratio = Math.round(ratio * 1000) / 1000;
          result.exact = row.tol === undefined;
          if (h.dealt > 0 && g.dealt === 0) problems.push('the guest dealt nothing');
          else if (g.differ.length) problems.push(`the same hit dealt different damage: ${JSON.stringify(g.differ.slice(0, 3))}`);
          else if (h.dealt > 0 && fires && h.shots >= 3 && g.shots >= 3 && ratio < 0.4 && !row.near) problems.push(`the guest's damage per shot is far under the host's: guest ${g.perShot}, host ${h.perShot}`);
          if (row.burns === true && h.burning > 0 && g.burning === 0) problems.push('the host set them alight, the guest did not');
          if (row.freezes && h.frozen > 0 && g.frozen === 0) problems.push('the host froze them, the guest did not');
          result.problems = problems;
        } else progress(`skip ${row.name}: ${result.skipped}`);
        const starved = Math.min(result.host?.shooterFps ?? 99, result.guest?.shooterFps ?? 99) < (row.smooth ? 20 : 8);
        if (!result.problems?.length || !starved || attempt === 3) break;
        progress(`again ${row.name}: a page ran at ${Math.min(result.host?.shooterFps ?? 99, result.guest?.shooterFps ?? 99)} frames a second (${result.problems.join('; ')})`);
      }
      if (result.problems?.length) failures++;
      if (result.problems) {
        const g = result.guest, h = result.host, problems = result.problems, claims = sum(g.sent);
          progress(`${problems.length ? 'FAIL' : 'ok  '} ${row.name}: host ${h.shots} shots ${h.perShot}/shot, guest ${g.shots} shots ${g.perShot}/shot, ${claims} claims ${g.accepted} applied, ${g.same} kinds of hit compared${g.gone ? ` (${g.gone} on the dead)` : ''}${problems.length ? ` :: ${problems.join('; ')}` : ''}`);
      }
      out.rows.push(result);
    }
    out.refusedClaims = await host.evaluate(() => window.__refusedClaims);
    out.states = await Promise.all(party.pages.map(state));
    await shot(host, 'host'); await shot(guest, 'guest');
    check(failures === 0, 'Every row: the guest lost nothing and dealt what the host\'s own shots deal', out.rows.filter(r => r.problems?.length).map(r => [r.name, r.problems]));
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
