// Scenarios for tools/scripts/solo-trace.mjs. Each is a page, and a bot that runs **in the page** before every frame as
// bot(ctx, game, frame, memo); `memo` is the bot's own notebook and is saved with the trace. `setup(ctx, game)` runs once when the
// page is ready, `after(ctx, game)` once at the end (its return value is saved), `probe(ctx, game)` every frame (a short value
// saved with the frame). A bot may return 'stop'. `until` is the page's "ready" test (default: the game is in play).
// Everything here must exist on the old build too: only window.__op2, ctx, input.simulate and the game's own entry points.
// A bot is turned into text and rebuilt in the page, so each must stand alone: no helper from this file inside one.

/** Keeps the game in play, aims at the nearest enemy in sight and holds fire, walks a fixed pattern, shortens breaks. */
const fighter = (ctx, game, f, m) => {
  if (game.state !== 'playing') { m.menus = (m.menus || 0) + 1; game.setState('playing'); }
  const p = ctx.player;
  if (!p.alive) { m.died = m.died ?? f; return; }
  if (p.health < p.maxHealth * 0.35) { m.heals = (m.heals || 0) + 1; p.heal(p.maxHealth); }
  const w = ctx.waves;
  if (w && w.phase === 'intermission') { m.rest = (m.rest || 0) + 1; if (m.rest > 240 && w.nextWaveIn > 1) w.nextWaveIn = 1; } else m.rest = 0;
  let best = null, bd = 1e9;
  for (const e of ctx.enemies.alive) {
    const d = e.center.distanceToSquared(p.eye);
    if (d < bd && (e.hasLos || d < 144)) { best = e; bd = d; }
  }
  ctx.input.simulate('fire', !!best);
  if (best) {
    const dx = best.center.x - p.eye.x, dy = best.center.y - p.eye.y, dz = best.center.z - p.eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  const leg = Math.floor(f / 90) % 4;
  ctx.input.simulate('left', leg === 0);
  ctx.input.simulate('back', leg === 1);
  ctx.input.simulate('right', leg === 2);
  ctx.input.simulate('forward', leg === 3);
  ctx.input.simulate('dash', f % 240 === 200);
  ctx.input.simulate('jump', f % 300 === 150);
  // Indoors the bot's own grenade comes back at it (`m.noGrenades`).
  ctx.input.simulate('grenade', !m.noGrenades && f % 600 === 420);
  ctx.input.simulate('melee', bd < 9 && f % 40 === 0);
  // Human soldiers who give up: a tap questions, a hold captures (0.4 s), in turn.
  const hold = f % 400;
  ctx.input.simulate('interact', (hold >= 100 && hold < 104) || (hold >= 300 && hold < 340));
  // Call-ins roll their scatter from a generator of their own on the new build, so a run that uses them parts ways at the
  // first strike: they are compared by their own scenario. `m.streak` turns them on.
  if (m.streak) ctx.input.simulate('streak', f % 120 === 60);
};

/**
 * Gets through waves fast: cannot be hurt, and every 12 frames kills up to four of the living through the game's own damage
 * entry (a head shot, a blast, a cut, in turn). For rosters, spawn timing, score, pay, streaks and unlocks wave after wave.
 * With `m.shop` it also reads the whole shop at each break (every row's price, lock and reason), then is given credits and buys
 * every row that can be bought, in the shop's own order.
 */
const reaper = (ctx, game, f, m) => {
  if (game.state !== 'playing') { m.menus = (m.menus || 0) + 1; m.lastMenu = game.state; if (game.state === 'gameover') return 'stop'; game.setState('playing'); }
  const p = ctx.player;
  p.modifiers.invulnerable = true;
  const w = ctx.waves;
  if (w && w.phase === 'intermission') {
    m.rest = (m.rest || 0) + 1;
    const shop = ctx.contracts && ctx.contracts.shop;
    if (m.shop && shop && m.rest === 60) {
      const rows = [];
      for (const list of ['weaponOffers', 'modOffers', 'implantOffers', 'chipOffers', 'supplyOffers']) {
        if (!shop[list]) continue;
        for (const o of shop[list]()) rows.push(`${o.act.kind}:${o.act.id} ${o.ware ? o.ware.price : '?'} ${o.locked ? 'locked' : 'open'} ${o.owned ? 'owned' : ''} ${o.why || ''}`);
      }
      (m.shops = m.shops || {})[w.wave] = rows;
      m.creditsAtBreak = m.creditsAtBreak || {};
      m.creditsAtBreak[w.wave] = shop.view().credits;
    }
    if (m.shop && shop && m.rest === 70) {
      shop.earn(200000);
      const bought = [];
      for (const list of ['weaponOffers', 'modOffers', 'implantOffers', 'chipOffers', 'supplyOffers']) {
        if (!shop[list]) continue;
        for (const o of shop[list]()) { if (o.locked || o.owned) continue; const why = shop.buy(o.act); bought.push(`${o.act.kind}:${o.act.id} ${why === null ? 'ok' : why}`); }
      }
      (m.bought = m.bought || {})[w.wave] = bought;
      m.creditsAfter = m.creditsAfter || {};
      m.creditsAfter[w.wave] = shop.view().credits;
    }
    if (m.rest > 120 && w.nextWaveIn > 1) w.nextWaveIn = 1;
  } else m.rest = 0;
  if (f % 12 !== 0) return;
  const kinds = [
    { amount: 9999, type: 'bullet', source: 'smg', region: 'head', force: 10 },
    { amount: 9999, type: 'explosive', source: 'rocket', force: 900, gib: true },
    { amount: 9999, type: 'slash', source: 'sword', region: 'armL', force: 60, severMult: 4 },
  ];
  m.turn = m.turn || 0;
  const living = [...ctx.enemies.alive].sort((a, b) => a.uid - b.uid).slice(0, 4);
  for (const e of living) {
    const dir = e.center.clone().sub(p.eye).normalize();
    ctx.enemies.applyDamage(e, { ...kinds[m.turn++ % kinds.length], point: e.center.clone(), dir });
  }
};

/**
 * Outpost Defense: deploys from the loadout screen with Enter, is given credits, buys a mortar team and three hires, boards up
 * the first damaged wall it is offered every 5 s, and fights from where it stands.
 */
const defender = (ctx, game, f, m) => {
  const d = window.__defense;
  if (!m.deployed) {
    if (game.state === 'playing') m.deployed = f;
    else if (f % 20 === 5) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return;
  }
  if (game.state !== 'playing') { m.menus = (m.menus || 0) + 1; if (game.state === 'gameover') return 'stop'; game.setState('playing'); }
  const p = ctx.player;
  if (p.alive && p.health < p.maxHealth * 0.35) { m.heals = (m.heals || 0) + 1; p.heal(p.maxHealth); }
  const since = f - m.deployed;
  if (since === 30) {
    d.earn(6000);
    m.buys = [d.buy('barracks', { kind: 'mortar' }), ...['rifleman', 'gunner', 'riot'].map(type => d.buy('barracks', { kind: 'ally', type })), d.buy('infirmary', { kind: 'stim' })];
    m.offers = {};
    for (const shop of ['barracks', 'armoury', 'infirmary']) m.offers[shop] = d.offers(shop).map(o => `${o.act.kind}:${o.act.id ?? o.act.type ?? o.act.index ?? ''} ${o.price ?? (o.ware && o.ware.price) ?? '?'} ${o.why || ''}`);
  }
  if (since > 30 && since % 300 === 0) {
    const fix = d.offers('barracks').find(o => o.act.kind === 'repair' && !o.why);
    if (fix) (m.repairs = m.repairs || []).push(`${f} ${fix.act.index} ${d.buy('barracks', fix.act)}`);
  }
  const w = ctx.waves;
  if (w.phase === 'intermission') { m.rest = (m.rest || 0) + 1; m.fight = 0; if (m.rest === 240) d.skipBreak(); } else { m.rest = 0; m.fight = (m.fight || 0) + 1; }
  // The siege gets 10 s to reach the walls and set its charges; then one attacker falls every 1.5 s, so waves go by.
  if (m.fight > 600 && m.fight % 90 === 0) {
    const e = [...ctx.enemies.alive].sort((a, b) => a.uid - b.uid)[0];
    if (e) ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', source: 'smg', region: 'head', force: 10, point: e.center.clone(), dir: e.center.clone().sub(p.eye).normalize() });
  }
  let best = null, bd = 95 * 95;
  for (const e of ctx.enemies.alive) {
    const dist = e.center.distanceToSquared(p.eye);
    if (dist < bd && e.hasLos) { best = e; bd = dist; }
  }
  ctx.input.simulate('fire', !!best);
  if (best) {
    const dx = best.center.x - p.eye.x, dy = best.center.y - p.eye.y, dz = best.center.z - p.eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  // E now and then: an order to the hires, a board on a wall in reach.
  ctx.input.simulate('interact', f % 400 >= 100 && f % 400 < 150);
};
/**
 * Outpost Defense, the walls: deploys, is given credits, knocks one wall piece down a stage through the fort's own damage
 * entry and buys its repair at the Barracks; then knocks a second down, stands at it and holds E to board it up by hand.
 */
const mason = (ctx, game, f, m) => {
  const d = window.__defense;
  if (!m.deployed) {
    if (game.state === 'playing') m.deployed = f;
    else if (f % 20 === 5) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return;
  }
  if (game.state !== 'playing') { if (game.state === 'gameover') return 'stop'; game.setState('playing'); }
  const p = ctx.player, V = p.position.constructor, walls = ctx.world.objects.walls, since = f - m.deployed;
  p.modifiers.invulnerable = true;
  ctx.waves.nextWaveIn = Math.max(ctx.waves.nextWaveIn, 30);
  const pieces = ctx.world.objects.structures.filter(q => q.kind !== 'shack');
  const knock = piece => { const from = piece.stage; for (let k = 0; k < 400 && piece.stage === from; k++) walls.damage(piece, 20); return `${from} -> ${piece.stage}`; };
  if (since === 30) d.earn(6000);
  if (since === 100) m.first = knock(pieces[0]);
  if (since === 200) { const fix = d.offers('barracks').find(o => o.act.kind === 'repair' && !o.why); m.offer = fix ? `${fix.act.index} ${fix.price ?? ''}` : 'none'; m.bought = fix ? String(d.buy('barracks', fix.act)) : 'no offer'; }
  if (since === 700) m.afterRepair = pieces[0].stage;
  if (since === 800) m.second = knock(pieces[1]);
  if (since >= 820 && since < 1600) {
    // At the second piece, a step inside the fort from it, facing it, E held.
    if (since === 820) {
      const at = pieces[1].toWorld(0, 0, 0, new V());
      const inward = new V(-at.x, 0, -at.z).normalize();
      p.teleport(at.clone().addScaledVector(inward, 1.6), Math.atan2(inward.x, inward.z));
    }
    ctx.input.simulate('interact', since >= 860 && since < 1500);
  }
  if (since === 1700) m.afterHands = pieces[1].stage;
};
const defenseProbe = ctx => {
  const d = window.__defense;
  if (!d) return null;
  const pieces = ctx.world.objects.structures ?? [];
  return [d.credits, Object.values(d.shops).map(s => Math.round(s.health * 10) / 10).join('/'), pieces.filter(q => q.stage === 'damaged').length, pieces.filter(q => q.stage === 'breached').length,
    ctx.allies?.allies.length ?? 0, d.mortars?.fired ?? 0];
};

/**
 * A mission: cannot be hurt; lets the film and the radio play; every 2 s goes to the first open objective that has a place and,
 * every 20 frames, kills two of the living. It gets as far as that gets it: the same on both builds.
 */
const agent = (ctx, game, f, m) => {
  if (game.state === 'paused') game.setState('playing');
  const p = ctx.player;
  // `m.dieAt`: the player is killed on that frame, and 240 frames into the screen that follows takes the checkpoint.
  if (game.state === 'gameover') {
    if (!m.dieAt || m.restarted) return 'stop';
    m.over = (m.over || 0) + 1;
    if (m.over === 240) { m.restarted = f; m.restartSaid = ctx.hud.restartCheckpoint ? String(ctx.hud.restartCheckpoint()) : 'no restartCheckpoint'; }
    return;
  }
  p.modifiers.invulnerable = !(m.dieAt && f >= m.dieAt && !m.restarted);
  if (m.dieAt && f === m.dieAt) p.takeDamage({ amount: 99999, type: 'bullet', source: 'test', from: p.position.clone() });
  const runner = window.__op2.campaign && window.__op2.campaign.runner;
  if (!runner || game.state !== 'playing') return;
  if (f % 120 === 100) {
    const goal = runner.objectives.find(o => !o.done && o.at);
    if (goal) { const V = p.position.constructor; p.teleport(new V(goal.at.at[0], goal.at.at[1], goal.at.at[2]), goal.at.yaw); m.goals = (m.goals || 0) + 1; }
  }
  ctx.input.simulate('forward', f % 120 > 100 && f % 120 < 118);
  ctx.input.simulate('interact', f % 60 >= 20 && f % 60 < 50);
  if (f % 20 === 0) {
    const living = [...ctx.enemies.alive].sort((a, b) => a.uid - b.uid).slice(0, 2);
    for (const e of living) ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', source: 'smg', region: 'head', force: 10, point: e.center.clone(), dir: e.center.clone().sub(p.eye).normalize() });
  }
};
const missionProbe = () => {
  const runner = window.__op2.campaign && window.__op2.campaign.runner;
  if (!runner) return null;
  const d = runner.describe();
  return [d.mission, d.state, d.beat, d.saved, d.radio, d.objectives.join(' / '), JSON.stringify(d.tags), JSON.stringify(d.doors), window.__op2.ctx.hud.screens?.name ?? ''];
};
const missionAfter = () => (window.__op2.campaign && window.__op2.campaign.runner ? window.__op2.campaign.runner.describe() : null);

/**
 * Every weapon in turn (`m.list`, set by the scenario's setup), 420 frames each, at a standing brute 14 m off and six husks
 * round it, none of which fight back: held fire, a pause, held fire again, then aimed fire with a dash held (the focus zoom),
 * then the alternate fire, a melee blow and a grenade.
 */
const armourer = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  const SPAN = 420;
  const i = Math.floor(f / SPAN), t = f % SPAN;
  if (!m.list || i >= m.list.length) return 'stop';
  const p = ctx.player, V = p.position.constructor, id = m.list[i];
  p.modifiers.invulnerable = true;
  if (ctx.waves && ctx.waves.phase === 'intermission') ctx.waves.nextWaveIn = 1e9;
  if (t === 0) {
    for (const k of ['fire', 'aim', 'dash', 'melee', 'grenade', 'reload']) ctx.input.simulate(k, false);
    for (const e of [...ctx.enemies.alive]) ctx.enemies.applyDamage(e, { amount: 99999, type: 'true', source: 'test', point: e.center.clone(), dir: new V(0, 0, 1), force: 0 });
    p.teleport(new V(m.at[0], m.at[1], m.at[2]), m.yaw);
    p.pitch = 0;
    return;
  }
  if (t === 2) {
    const fwd = new V(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)), side = new V(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
    const put = (kind, ahead, across) => {
      const at = p.position.clone().addScaledVector(fwd, ahead).addScaledVector(side, across);
      const e = ctx.enemies.spawn(kind, at);
      if (e) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true; }
      return e;
    };
    put('brute', 14, 0);
    for (let k = 0; k < 6; k++) put('husk', 16 + (k % 2) * 1.5, (k - 2.5) * 1.3);
    ctx.weapons.give(id);
    ctx.weapons.switchTo(id);
    ctx.weapons.refillMagazines();
    ctx.weapons.addGrenades(2);
    return;
  }
  // Level at the brute's chest, every frame: recoil and climb would otherwise walk the view off it.
  if (t > 20) { p.yaw = m.yaw; p.pitch = 0.02; }
  ctx.input.simulate('fire', (t >= 30 && t < 130) || (t >= 150 && t < 230) || (t >= 250 && t < 300) || (t >= 330 && t < 345));
  ctx.input.simulate('aim', (t >= 240 && t < 310) || (t >= 320 && t < 350));
  ctx.input.simulate('dash', t >= 260 && t < 300);
  ctx.input.simulate('reload', t === 232);
  ctx.input.simulate('melee', t >= 360 && t < 364);
  ctx.input.simulate('grenade', t >= 380 && t < 384);
};
const gunProbe = ctx => {
  const w = ctx.weapons;
  let ammo = null;
  try { ammo = w.ammo(); } catch { /* nothing in hand */ }
  const r = v => Math.round(v * 1000) / 1000;
  return [w.current, ammo && (ammo.mag ?? null), ammo && (ammo.reserve ?? null), r(w.charge ?? 0), r(w.spread ?? 0), r(w.aim ?? 0), !!w.scoped, r(ctx.render.camera?.fov ?? 0)];
};

/** A fixed set of keys on an empty map: run, dash, slide, bunny hops, a strafe, a turn, a slam. Speeds are in every frame. */
const runnerBot = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  if (ctx.waves && ctx.waves.phase === 'intermission') ctx.waves.nextWaveIn = 1e9;
  const p = ctx.player, i = ctx.input;
  p.modifiers.invulnerable = true;
  if (f === 0) p.pitch = 0;
  i.simulate('forward', (f >= 20 && f < 700) || f >= 900);
  i.simulate('dash', f === 120 || f === 121 || f === 420 || f === 421 || f === 1000 || f === 1001);
  // Bunny hops: jump held from the frame of each landing.
  i.simulate('jump', (f >= 300 && f < 600 && p.grounded) || f === 640 || f === 660 || f === 1100);
  i.simulate('right', f >= 330 && f < 480);
  i.simulate('left', f >= 480 && f < 600);
  if (f >= 700 && f < 900) { p.yaw += 0.02; i.simulate('back', f >= 760 && f < 820); }
  i.simulate('slide', (f >= 200 && f < 260) || (f >= 1010 && f < 1060) || (f >= 665 && f < 690));
};

/**
 * Brain chips on a break that never ends, with a crowd that does not fight: Sonar tapped twice, then Thermal fitted and tapped
 * on and off, then Focus fitted and held to its limit, tapped off, tapped during its cooldown, and used again; then a stim.
 */
const chipper = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  if (ctx.waves && ctx.waves.phase === 'intermission') ctx.waves.nextWaveIn = 1e9;
  const chips = ctx.contracts.chips, rack = chips.rack, i = ctx.input, p = ctx.player;
  if (f === 5) {
    const V = p.position.constructor;
    const fwd = new V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    for (let k = 0; k < 6; k++) { const e = ctx.enemies.spawn('trooper', p.position.clone().addScaledVector(fwd, 10 + k)); if (e) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true; } }
  }
  const tap = at => f === at || f === at + 1;
  if (f === 600) { rack.fit('sonar', false); rack.fit('thermal', true); }
  if (f === 900) { rack.fit('thermal', false); rack.fit('focus', true); }
  i.simulate('sonar', tap(60) || tap(200) || tap(620) || tap(760) || tap(920) || tap(1400) || tap(1420) || tap(1500) || tap(1700) || tap(2300) || tap(2330));
  // A stim with health missing.
  if (f === 2500) p.takeDamage({ amount: 60, type: 'bullet', source: 'test', from: p.position.clone() });
  i.simulate('stim', tap(2520));
  // Focus while firing, so its feel in a fight is in the trace too.
  i.simulate('fire', f >= 1700 && f < 2000);
};
const chipProbe = ctx => {
  const b = ctx.contracts.chips.badge, r = v => Math.round(v * 1000) / 1000;
  return [b.name, b.lit, b.text, r(b.fill), r(ctx.time.scale), r(ctx.time.slowmo), ctx.progression.stims?.count ?? null];
};

/**
 * Call-ins, one every 900 frames at a ring of men who do not fight: each is granted and called on its own key, and the trace
 * holds what it did (rounds, blasts, hits, kills, how long). The scatter of a strike is random, so builds are compared by the
 * totals, not frame by frame.
 */
const caller = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  if (ctx.waves && ctx.waves.phase === 'intermission') ctx.waves.nextWaveIn = 1e9;
  const SPAN = 900, LIST = [['airstrike', 'streak'], ['warthog', 'callinWarthog'], ['doorGunner', 'callinDoorGunner'], ['sentry', 'callinSentry'], ['attackChopper', 'callinChopper'],
    ['orbital', 'callinOrbital'], ['blackSun', 'callinBlackSun'], ['ac130', 'streak'], ['frame', 'callinFrame'], ['nuke', 'callinNuke']];
  const n = Math.floor(f / SPAN), t = f % SPAN;
  if (n >= LIST.length) return 'stop';
  const p = ctx.player, V = p.position.constructor, [id, key] = LIST[n];
  p.modifiers.invulnerable = true;
  if (t === 0) {
    for (const k of ['streak', 'fire', 'interact', 'callinWarthog', 'callinDoorGunner', 'callinSentry', 'callinChopper', 'callinOrbital', 'callinBlackSun', 'callinFrame', 'callinNuke']) ctx.input.simulate(k, false);
    for (const e of [...ctx.enemies.alive]) ctx.enemies.applyDamage(e, { amount: 99999, type: 'true', source: 'test', point: e.center.clone(), dir: new V(0, 0, 1), force: 0 });
    p.teleport(new V(m.at[0], m.at[1], m.at[2]), m.yaw);
    p.pitch = -0.25;
  }
  if (t === 5) {
    const fwd = new V(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)), side = new V(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
    for (let k = 0; k < 12; k++) {
      const at = p.position.clone().addScaledVector(fwd, 16 + (k % 3) * 2.5).addScaledVector(side, (Math.floor(k / 3) - 1.5) * 3);
      const e = ctx.enemies.spawn(k % 4 === 3 ? 'brute' : 'husk', at);
      if (e) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true; }
    }
    ctx.progression.grantCallIn(id);
    (m.called = m.called || []).push(id);
  }
  if (t > 5 && t < 60) { p.yaw = m.yaw; p.pitch = -0.25; }
  ctx.input.simulate(key, t === 20 || t === 21);
  // The mark is placed with fire where a call-in asks for one; a seat's guns are fired later, and a Frame is boarded.
  ctx.input.simulate('fire', (t >= 40 && t < 44) || (t >= 70 && t < 74) || (t >= 420 && t < 560));
  ctx.input.simulate('interact', (t >= 330 && t < 334) || (t >= 700 && t < 704));
  ctx.input.simulate('forward', t >= 240 && t < 330 && id === 'frame');
};

/**
 * Endless Humans, the prisoner rules, on the men of the first wave: one made to give up is questioned with a tap and let go
 * with a second tap; the next is held 0.35 s (short of the 0.4 s it takes: a tap) and then held 0.5 s (captured). The prompt
 * over him and the hold ring are in the trace as the HUD was told them.
 */
const jailer = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  const p = ctx.player, o = ctx.enemies.outpost, V = p.position.constructor;
  p.modifiers.invulnerable = true;
  if (!o) return;
  const start = (m.start = m.start ?? (o.soldiers.length >= 3 ? f + 60 : undefined));
  if (start === undefined || f < start) return;
  const t = f - start;
  const pickMan = () => o.soldiers.filter(s => s.e.alive && !m.used.includes(s.e.uid)).sort((a, b) => a.e.uid - b.e.uid)[0];
  m.used = m.used || [];
  const stage = Math.floor(t / 500), u = t % 500;
  if (stage > 2) return 'stop';
  if (u === 0) {
    const s = pickMan();
    if (!s) { m.none = (m.none || 0) + 1; return; }
    m.used.push(s.e.uid);
    m.man = s.e.uid;
    o.collapse(s, 'surrender');
  }
  const man = ctx.enemies.alive.find(e => e.uid === m.man);
  if (man && u >= 100 && u % 5 === 0) {
    // Stand 1.4 m in front of him, facing him, all the time: the others are still fighting.
    const at = new V(man.position.x, man.position.y, man.position.z + 1.4);
    p.teleport(at, 0);
    const dx = man.center.x - p.eye.x, dy = man.center.y - p.eye.y, dz = man.center.z - p.eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  const held = stage === 0 ? (u >= 200 && u < 203) || (u >= 330 && u < 333)   // tap: question; tap: let go
    : stage === 1 ? (u >= 200 && u < 222) || (u >= 330 && u < 362)             // 0.35 s: still a tap; 0.5 s: the cuffs
    : (u >= 200 && u < 232);                                                    // 0.5 s at once
  ctx.input.simulate('interact', held);
};

/** A run that ends: fights for 10 s, is killed, sits on the game-over screen for 5 s, starts again and fights on. */
const mortal = (ctx, game, f, m) => {
  const p = ctx.player;
  if (game.state === 'gameover' || !p.alive) {
    m.over = (m.over || 0) + 1;
    if (m.over === 300) { m.again = f; ctx.hud.startRun(); }
    for (const k of ['fire', 'left', 'right', 'forward', 'back']) ctx.input.simulate(k, false);
    return;
  }
  if (game.state !== 'playing') { m.menus = (m.menus || 0) + 1; game.setState('playing'); }
  if (f === 620 && !m.again) { p.takeDamage({ amount: 99999, type: 'bullet', source: 'test', from: p.position.clone() }); return; }
  if (m.again && p.health < p.maxHealth * 0.35) p.heal(p.maxHealth);
  let best = null, bd = 1e9;
  for (const e of ctx.enemies.alive) { const d = e.center.distanceToSquared(p.eye); if (d < bd && (e.hasLos || d < 144)) { best = e; bd = d; } }
  ctx.input.simulate('fire', !!best);
  if (best) { const dx = best.center.x - p.eye.x, dy = best.center.y - p.eye.y, dz = best.center.z - p.eye.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
  const leg = Math.floor(f / 90) % 4;
  ctx.input.simulate('left', leg === 0); ctx.input.simulate('back', leg === 1); ctx.input.simulate('right', leg === 2); ctx.input.simulate('forward', leg === 3);
};

/**
 * Dropped guns: the gun in hand is thrown down on the flat and taken back with E; thrown down again and walked over (a gun
 * you dropped is never taken by walking); then thrown from the top of a jump, to see where it comes to rest.
 */
const dropper = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  if (ctx.waves && ctx.waves.phase === 'intermission') ctx.waves.nextWaveIn = 1e9;
  const p = ctx.player, i = ctx.input;
  p.modifiers.invulnerable = true;
  if (f < 20) p.pitch = 0;
  const tap = at => f === at || f === at + 1;
  i.simulate('dropWeapon', tap(30) || tap(300) || tap(640));
  i.simulate('interact', tap(200));
  i.simulate('back', f >= 320 && f < 380);
  i.simulate('forward', (f >= 400 && f < 520) || (f >= 700 && f < 760));
  i.simulate('jump', tap(600) || tap(620));
  i.simulate('weaponNext', tap(900));
  i.simulate('fire', f >= 960 && f < 1000);
};
const dropProbe = ctx => {
  const d = ctx.weapons.dropped, r = v => Math.round(v * 1000) / 1000;
  const list = (d && d.drops) || [];
  return [ctx.weapons.current, [...ctx.weapons.owned].sort().join(','), list.map(g => `${g.weapon} tag ${r(g.tag.x)},${r(g.tag.y)},${r(g.tag.z)} root ${g.root ? `${r(g.root.position.x)},${r(g.root.position.y)},${r(g.root.position.z)}` : '-'} age ${r(g.age)}`).join(' | ')];
};
/**
 * The menus a player meets in a run, for their words: the pause menu, the shop over the first break, the guide, the settings
 * and the rules; then the run is ended from the pause menu's last item.
 */
const browser = (ctx, game, f, m) => {
  const hud = ctx.hud, key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true }));
  ctx.player.modifiers.invulnerable = true;
  if (ctx.waves && ctx.waves.phase === 'intermission' && f < 900) ctx.waves.nextWaveIn = Math.max(ctx.waves.nextWaveIn, 30);
  if (f === 60) hud.pause();
  if (f === 130) hud.resume();
  if (f === 200) ctx.events.emit('shop:open', {});
  if (f === 300) { hud.showScreen('none'); game.setState('playing'); }
  if (f === 360) { hud.pause(); }
  if (f === 400) hud.showScreen('guide');
  if (f === 470) hud.showScreen('settings');
  if (f === 540) hud.showScreen('pause');
  if (f === 600) hud.resume();
  // Down the pause menu to its last item and Enter, twice (an "are you sure" takes a second Enter), to see where it leads.
  if (f === 700) hud.pause();
  if (f >= 730 && f < 790 && f % 6 === 0) key('ArrowDown');
  if (f === 800 || f === 840) key('Enter');
};
/** The main menu from the splash: Enter into each level's first item three deep, with Escape back out, for the words. */
const visitor = (ctx, game, f, m) => {
  const key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true }));
  const steps = { 40: 'Enter', 100: 'Enter', 160: 'ArrowDown', 200: 'Enter', 260: 'Escape', 300: 'ArrowDown', 340: 'Enter', 400: 'Escape', 440: 'ArrowDown', 480: 'Enter', 540: 'Escape', 580: 'Escape', 620: 'ArrowDown', 660: 'Enter', 720: 'ArrowDown', 760: 'Enter' };
  if (steps[f]) key(steps[f]);
};
/**
 * Enemies that carry a tank (Skitter, Bomber, Burner, Rocketeer), each shot dead with the SMG and then with the shotgun, a husk
 * standing beside it: a round that sets off the tank must keep its own sound, marker, head-shot effects and hit-stop.
 */
const tanker = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  if (ctx.waves && ctx.waves.phase === 'intermission') ctx.waves.nextWaveIn = 1e9;
  const KINDS = ['skitter', 'bomber', 'burner', 'rocketeer'], GUNS = ['smg', 'shotgun'], SPAN = 300;
  const n = Math.floor(f / SPAN), t = f % SPAN;
  if (n >= KINDS.length * GUNS.length) return 'stop';
  const p = ctx.player, V = p.position.constructor, kind = KINDS[n % KINDS.length], gun = GUNS[Math.floor(n / KINDS.length)];
  p.modifiers.invulnerable = true;
  if (t === 0) {
    ctx.input.simulate('fire', false);
    for (const e of [...ctx.enemies.alive]) ctx.enemies.applyDamage(e, { amount: 99999, type: 'true', source: 'test', point: e.center.clone(), dir: new V(0, 0, 1), force: 0 });
    p.teleport(new V(m.at[0], m.at[1], m.at[2]), m.yaw);
    return;
  }
  if (t === 40) {
    const fwd = new V(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)), side = new V(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
    const put = (k, ahead, across) => { const e = ctx.enemies.spawn(k, p.position.clone().addScaledVector(fwd, ahead).addScaledVector(side, across)); if (e) { e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true; } return e; };
    const target = put(kind, 9, 0);
    put('husk', 9.5, 1.6);
    m.target = target ? target.uid : -1;
    ctx.weapons.give(gun); ctx.weapons.switchTo(gun); ctx.weapons.refillMagazines();
  }
  const e = ctx.enemies.alive.find(x => x.uid === m.target);
  ctx.input.simulate('fire', t > 70 && !!e);
  if (e && t > 50) {
    // The tank where the model has one (its own hit region), else the middle of the body.
    const dx = e.center.x - p.eye.x, dy = e.center.y - p.eye.y, dz = e.center.z - p.eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
};
/**
 * Aiming down sights with the dash key held: the focus zoom to its 3.5 s limit, let go, asked for again while it cools, and
 * again after. With the SMG, then the Rivet. The view's field of view and the aim blend are in every frame.
 */
const marksman = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  if (ctx.waves && ctx.waves.phase === 'intermission') ctx.waves.nextWaveIn = 1e9;
  const i = ctx.input, t = f % 900;
  ctx.player.modifiers.invulnerable = true;
  if (f === 900) { ctx.weapons.give('rivet'); ctx.weapons.switchTo('rivet'); }
  if (f >= 1800) return 'stop';
  i.simulate('aim', t >= 40 && t < 860);
  i.simulate('dash', (t >= 100 && t < 420) || (t >= 440 && t < 520) || (t >= 760 && t < 840));
  i.simulate('fire', t >= 300 && t < 320);
};
/**
 * For frame times (tools/scripts/solo-perf.mjs), a scene that is the same on every run: thirty men who fight but cannot be
 * killed (their health is topped up every frame and the gun does a fiftieth of its damage), kept at thirty, round a player who
 * cannot be hurt and holds the SMG's trigger on the nearest one.
 */
const crowdFight = (ctx, game, f, m) => {
  if (game.state !== 'playing') game.setState('playing');
  if (ctx.waves) ctx.waves.nextWaveIn = 1e9;
  const p = ctx.player, V = p.position.constructor;
  p.modifiers.invulnerable = true;
  ctx.weapons.modifiers.damage = 0.02;
  ctx.weapons.modifiers.bottomlessMag = true;
  const KINDS = ['husk', 'husk', 'trooper', 'husk', 'brute', 'trooper', 'husk', 'trooper', 'husk', 'brute'];
  for (let i = ctx.enemies.alive.length; i < 30; i++) {
    m.made = (m.made || 0) + 1;
    const a = m.made * 2.399, r = 12 + (m.made % 4) * 2;
    const at = new V(p.position.x + Math.cos(a) * r, p.position.y, p.position.z + Math.sin(a) * r);
    const snapped = at.clone();
    if (ctx.world.nav.nearest && ctx.world.nav.nearest(at, 6, snapped)) at.copy(snapped);
    ctx.enemies.spawn(KINDS[m.made % KINDS.length], at);
  }
  let best = null, bd = 1e9;
  for (const e of ctx.enemies.alive) {
    e.health = e.maxHealth;
    const d = e.center.distanceToSquared(p.eye);
    if (d < bd) { best = e; bd = d; }
  }
  ctx.input.simulate('fire', !!best);
  if (best) { const dx = best.center.x - p.eye.x, dy = best.center.y - p.eye.y, dz = best.center.z - p.eye.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
};
const dieAt = frame => new Function(`window.__solo.memo.dieAt = ${frame};`);

const snapshotRun = (ctx, game) => ({
  state: game.state, wave: ctx.waves?.wave, phase: ctx.waves?.phase, score: ctx.progression?.score, kills: ctx.progression?.kills,
  credits: ctx.contracts?.wallet?.credits ?? null, owned: ctx.weapons ? [...ctx.weapons.owned].sort() : null,
  callIns: ctx.progression ? [...ctx.progression.callIns].sort() : null, health: ctx.player.health,
  mods: ctx.weapons?.fitted ? [...ctx.weapons.fitted].sort() : null, chips: ctx.contracts?.chips?.rack ? [...ctx.contracts.chips.rack.fitted] : null,
  screen: ctx.hud?.screens?.name ?? null,
});
/** The character pool: spare and live bodies per archetype. */
const pool = ctx => Object.fromEntries([...ctx.characters.entries].map(([id, e]) => [id, [e.free.length, e.active.size]]).filter(([, v]) => v[0] + v[1] > 0));
/** Where the player stands and faces at the start, for a bot that comes back to it. */
const home = ctx => { const p = ctx.player, m = window.__solo.memo; m.at = [p.position.x, p.position.y, p.position.z]; m.yaw = p.yaw; };
/** `home`, plus the list of every weapon id, read from the game's own table. */
const armoury = async ctx => {
  const p = ctx.player, m = window.__solo.memo;
  m.at = [p.position.x, p.position.y, p.position.z];
  m.yaw = p.yaw;
  const data = await import('/src/weapons/data.ts');
  m.list = Object.keys(data.WEAPONS).sort();
};
const shopOn = () => { window.__solo.memo.shop = true; };
const streakOn = () => { window.__solo.memo.streak = true; };
const noGrenades = () => { window.__solo.memo.noGrenades = true; };

const CRUCIBLE = '/?contract=crucible&autostart=1';
const HUMANS = '/?contract=outpost&autostart=1';
const OFFICE = '/?contract=outpost&map=office&autostart=1';
const LOADOUT = "window.__op2?.ctx?.hud?.screens?.name === 'loadout' || window.__op2?.game?.state === 'playing'";
const mission = (contract, beat, frames = 3000) => ({ url: `/?contract=${contract}&autostart=1${beat ? `&beat=${beat}` : ''}`, bot: agent, probe: missionProbe, frames, after: missionAfter });

export const SCENARIOS = {
  /** Nothing happens: the game left alone in a Crucible break. */
  idle: { url: CRUCIBLE, frames: 120, after: pool },
  /** A real fight: the Crucible's first waves with the starting kit. */
  crucible: { url: CRUCIBLE, bot: fighter, frames: 5400, after: snapshotRun },
  /** The same fight with the streak key pressed: parts ways at the first strike (its scatter), compared by totals. */
  'crucible-streaks': { url: CRUCIBLE, bot: fighter, setup: streakOn, frames: 5400, after: snapshotRun },
  /** Many waves, fast: rosters, timing, pay, a boss wave. */
  'crucible-waves': { url: CRUCIBLE, bot: reaper, frames: 9000, after: snapshotRun },
  /** Many waves with the whole shop read and bought at every break. */
  'crucible-shop': { url: CRUCIBLE, bot: reaper, setup: shopOn, frames: 9000, after: snapshotRun },
  humans: { url: HUMANS, bot: fighter, frames: 5400, after: snapshotRun },
  /** Endless Humans to its ending at round 10. */
  'humans-waves': { url: HUMANS, bot: reaper, frames: 40000, after: snapshotRun },
  'humans-shop': { url: HUMANS, bot: reaper, setup: shopOn, frames: 40000, after: snapshotRun },
  office: { url: OFFICE, bot: fighter, setup: noGrenades, frames: 5400, after: snapshotRun },
  'office-waves': { url: OFFICE, bot: reaper, frames: 40000, after: snapshotRun },
  defense: { url: '/?contract=defense&autostart=1', until: LOADOUT, bot: defender, probe: defenseProbe, frames: 14000, after: snapshotRun },
  'defense-walls': { url: '/?contract=defense&autostart=1', until: LOADOUT, bot: mason, probe: defenseProbe, frames: 2000, after: snapshotRun },
  /** The Outpost from its film, and from three later sections. */
  campaign: mission('campaign', null, 4500),
  'campaign-softskins': mission('campaign', 'softskins'),
  'campaign-heavy': mission('campaign', 'heavy'),
  'campaign-breach': mission('campaign', 'breach'),
  foreclosure: mission('foreclosure', null, 4500),
  'foreclosure-landing': mission('foreclosure', 'landing'),
  'foreclosure-market': mission('foreclosure', 'market'),
  'foreclosure-courier': mission('foreclosure', 'courier'),
  retraining: mission('retraining', null, 3600),
  /** A death in a mission and the checkpoint it gives back. */
  'campaign-softskins-die': { ...mission('campaign', 'softskins', 2400), setup: dieAt(700) },
  'foreclosure-landing-die': { ...mission('foreclosure', 'landing', 2400), setup: dieAt(700) },
  menus: { url: CRUCIBLE, bot: browser, frames: 1000, after: snapshotRun },
  'menus-humans': { url: HUMANS, bot: browser, frames: 1000, after: snapshotRun },
  'menus-campaign': { url: '/?contract=campaign&autostart=1&beat=softskins', bot: browser, frames: 1000, after: snapshotRun },
  /** A returning player on the bare address: the splash and the main menu's levels. */
  'menu-tree': { url: '/', until: "window.__op2?.game?.state === 'menu'", bot: visitor, frames: 900, after: snapshotRun },
  'perf-crowd': { url: CRUCIBLE, bot: crowdFight, frames: 3600 },
  adszoom: { url: CRUCIBLE, bot: marksman, probe: gunProbe, frames: 1800 },
  tanks: { url: CRUCIBLE, bot: tanker, setup: home, frames: 2400, after: snapshotRun },
  capture: { url: HUMANS, bot: jailer, frames: 2400, after: snapshotRun },
  death: { url: CRUCIBLE, bot: mortal, frames: 2100, after: snapshotRun },
  drops: { url: CRUCIBLE, bot: dropper, probe: dropProbe, frames: 1100 },
  weapons: { url: CRUCIBLE, bot: armourer, setup: armoury, probe: gunProbe, frames: 420 * 60 },
  movement: { url: CRUCIBLE, bot: runnerBot, setup: home, frames: 1300 },
  'movement-office': { url: OFFICE, bot: runnerBot, setup: home, frames: 1300 },
  chips: { url: CRUCIBLE, bot: chipper, probe: chipProbe, frames: 2700 },
  callins: { url: CRUCIBLE, bot: caller, setup: home, frames: 9000, after: snapshotRun },
};
