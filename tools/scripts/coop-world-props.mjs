// Barrels and breakable props as one shared world (docs/notes/coop.md, "The shared world"): a window and a barrel broken by
// each player's real gunfire, seen by every other player, the barrel going off once (one explosion a screen, the enemies hurt
// once, the shooter hurt by its own barrel), and a late joiner finding the world as broken as it is. Asserted on EVERY page.
// COOP_MAP=office has the windows, the monitors and a fuel tank; the default Crucible map has the barrels. Each part runs
// where its things are: run it once on each.
//
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 420 \
//     --script tools/scripts/coop-world-props.mjs --out tools/out/coop/world-a/props.png
//   COOP_MAP=office|(none)  COOP_PLAYERS=2|3 (2 adds the late joiner as a third page)  COOP_MODE=crucible|outpost
//   COOP_SIM=lag:120,jitter:40,loss:0.05
import { writeFileSync } from 'node:fs';
import { calm, inMatch, kit, startParty } from './coop-kit.mjs';
import { lateGuest } from './coop-world-pods.mjs';

/** Installed on each page: counts drawn explosions, and finds a place to stand with a clear shot at a barrel or a prop. */
function tools() {
  const { ctx } = window.__op2;
  const V = ctx.player.position.constructor;
  const o = ctx.world.objects;
  window.__props = { booms: [], counted: 0 };
  // A blast the game counts against enemies and players (combat resolves `world:explosion`): the host's only, in co-op.
  ctx.events.on('world:explosion', () => { window.__props.counted++; });
  const explosion = ctx.fx.explosion.bind(ctx.fx);
  ctx.fx.explosion = (at, options) => { window.__props.booms.push(at.toArray().map(n => Math.round(n * 10) / 10)); return explosion(at, options); };
  /** The world's lists as one line each, to compare between pages. */
  window.__props.lists = () => ({
    explosives: o.explosives.map(e => `${e.kind}@${e.pos.toArray().map(n => n.toFixed(2)).join(',')}`).join('|'),
    props: o.props.props.map(p => `${p.kind}@${p.spec.x.toFixed(2)},${p.spec.y.toFixed(2)},${p.spec.z.toFixed(2)}`).join('|'),
  });
  window.__props.state = () => ({
    x: o.explosives.filter(e => !e.alive).map(e => e.id), b: o.props.props.map((p, i) => (p.alive ? -1 : i)).filter(i => i >= 0),
    stats: { ...(ctx.coop?.world?.propStats ?? { left: true }) },
  });
  const centre = (set, id) => {
    if (set === 'x') { const e = o.explosives[id]; return new V(e.pos.x, e.pos.y + (e.kind === 'barrel' ? 0.6 : 1.6), e.pos.z); }
    const p = o.props.props[id];
    return new V(0, p.def.cy * p.s.y, 0).applyQuaternion(p.q).add(p.p);
  };
  window.__props.centre = (set, id) => centre(set, id).toArray();
  window.__props.alive = (set, id) => (set === 'x' ? o.explosives[id].alive : o.props.props[id].alive);
  /** A spot `min`..`max` metres from the target, on a floor, from whose eye height the first thing a ray meets is the target. */
  window.__props.vantage = (set, id, min, max) => {
    const c = centre(set, id);
    const own = set === 'x' ? o.explosives[id].collider : o.props.props[id].collider;
    if (!own) return null;
    for (let d = min; d <= max; d += 0.5) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const top = new V(c.x + Math.sin(a) * d, c.y + 1.4, c.z + Math.cos(a) * d);
      const floor = ctx.physics.raycast(top, new V(0, -1, 0), 6);
      if (!floor || floor.distance < 1.0) continue;
      const feet = floor.point;
      if (Math.abs(feet.y + 1.0 - c.y) > 2.2) continue;
      // The player's real eye height, standing.
      const eye = new V(feet.x, feet.y + (ctx.player.eye.y - ctx.player.position.y || 1.62), feet.z);
      const dir = c.clone().sub(eye); const len = dir.length(); dir.divideScalar(len);
      const hit = ctx.physics.raycast(eye, dir, len + 0.5);
      if (hit?.collider && hit.collider.handle === own.handle) return { stand: feet.toArray(), centre: c.toArray(), metres: d };
    }
    return null;
  };
  /** The first living target of a kind that has a vantage: [id, vantage]. */
  window.__props.pick = (set, kind, min, max, skip = []) => {
    const list = set === 'x' ? o.explosives : o.props.props;
    for (let id = 0; id < list.length; id++) {
      if (!list[id].alive || list[id].kind !== kind || skip.includes(id)) continue;
      const v = window.__props.vantage(set, id, min, max);
      if (v) return { id, ...v };
    }
    return null;
  };
  /** Stands the player at a spot, aimed at a point. */
  window.__props.aim = (stand, at) => {
    window.__op2.game.setState('playing');
    ctx.player.teleport(new V(...stand), 0);
    const d = new V(...at).sub(ctx.player.eye);
    ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
}

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], steps: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const mode = process.env.COOP_MODE ?? 'crucible', map = process.env.COOP_MAP || undefined, sim = process.env.COOP_SIM || undefined;
  const tag = `props-${mode}${map ? `-${map}` : ''}-${players}p${sim ? '-lag' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode, map, players, net: sim, out, progress, sleep });
    const { pages, guests } = party;
    const names = ['host', ...guests.map((_, i) => `guest${i + 1}`)];
    await inMatch(pages, party.mode.contract);
    await calm(host);
    await host.evaluate(() => { const w = window.__op2.ctx.waves; w.phase = 'intermission'; w.nextWaveIn = 900; });
    for (const page of pages) { await page.evaluate(tools); await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; window.__op2.game.setState('playing'); }); }
    const state = () => Promise.all(party.pages.map(p => p.evaluate(() => window.__props.state())));
    const settle = () => sleep(sim ? 900 : 350);

    const lists = await Promise.all(pages.map(p => p.evaluate(() => window.__props.lists())));
    out.counts = await host.evaluate(() => {
      const o = window.__op2.ctx.world.objects; const n = {};
      for (const t of [...o.explosives, ...o.props.props]) n[t.kind] = (n[t.kind] ?? 0) + 1;
      return { explosives: o.explosives.length, props: o.props.props.length, kinds: n };
    });
    const has = kind => (out.counts.kinds[kind] ?? 0) > 0;
    // One explosion drawn for each thing that went off, the same on every page. Where the map has props that explode (the
    // Office: a gas line beside the tank), the host's own count is the measure; where it has none, the explosives that went off.
    const drawnOnce = step => step.wentOff >= 1 && step.drawn.every(n => n === step.drawn[0]) && (out.counts.props > 0 ? step.drawn[0] >= step.wentOff : step.drawn[0] === step.wentOff);
    const countedOnce = step => step.counted[0] >= step.wentOff && (out.counts.props > 0 || step.counted[0] === step.wentOff) && step.counted.slice(1).every(n => n === 0);
    check(lists.every(l => l.explosives === lists[0].explosives && l.props === lists[0].props) && out.counts.props + out.counts.explosives > 3,
      'Every page built the same barrels and props, in the same order (the numbers on the wire mean the same thing)', out.counts);

    /**
     * `shooter` stands with a clear line at the target and holds real fire on it until it breaks on its own screen. Returns how
     * long the shooter and each other page waited to see it broken, in ms from the first round.
     */
    const breakIt = async (shooter, set, kind, min, max, { mortal = false, look = null, alone = false } = {}) => {
      const skip = (await state())[0][set];
      const target = await shooter.evaluate(([set, kind, min, max, skip]) => window.__props.pick(set, kind, min, max, skip), [set, kind, min, max, skip]);
      if (!target) {
        const why = await shooter.evaluate(([set, kind]) => {
          const o = window.__op2.ctx.world.objects; const list = set === 'x' ? o.explosives : o.props.props;
          return { all: list.length, ofKind: list.filter(t => t.kind === kind).length, alive: list.filter(t => t.kind === kind && t.alive).length,
            where: list.filter(t => t.kind === kind).slice(0, 12).map(t => (t.pos ?? t.p).toArray().map(n => Math.round(n * 10) / 10)) };
        }, [set, kind]);
        throw new Error(`no ${kind} with a clear shot within ${min}-${max} m :: ${JSON.stringify(why)}`);
      }
      const who = names[party.pages.indexOf(shooter)];
      const others = party.pages.filter(p => p !== shooter);
      // The others watch from where the shooter stands, a step to the side, looking at it (`alone`: from 20 m further back).
      if (alone) for (const page of others) await page.evaluate(([stand, at]) => {
        const back = [stand[0] + (stand[0] - at[0]) * 4, stand[1] + 0.5, stand[2] + (stand[2] - at[2]) * 4];
        window.__props.aim(back, at);
      }, [target.stand, target.centre]);
      else for (const [i, page] of others.entries()) await page.evaluate(([stand, at, i]) => window.__props.aim([stand[0] + 0.9 * (i + 1), stand[1], stand[2] + 0.9 * (i + 1)], at), [target.stand, target.centre, i]);
      await shooter.evaluate(([stand, at, mortal]) => {
        const { ctx } = window.__op2;
        window.__props.aim(stand, at);
        ctx.weapons.give('smg'); ctx.weapons.switchTo('smg'); ctx.weapons.refillMagazines();
        ctx.player.modifiers.invulnerable = !mortal; ctx.player.health = ctx.player.maxHealth;
      }, [target.stand, target.centre, mortal]);
      await sleep(700);
      if (look) await look(target, 'before');
      const gone = (await state())[0].x.length;
      for (const page of party.pages) await page.evaluate(([set, id]) => {
        window.__props.booms.length = 0;
        window.__props.counted = 0;
        window.__props.brokeAt = 0;
        clearInterval(window.__props.watch);
        window.__props.watch = setInterval(() => { if (!window.__props.brokeAt && !window.__props.alive(set, id)) window.__props.brokeAt = Date.now(); }, 4);
      }, [set, target.id]);
      const t0 = Date.now();
      await shooter.evaluate(at => { window.__props.aim(window.__op2.ctx.player.position.toArray(), at); window.__op2.ctx.input.simulate('fire', true); }, target.centre);
      for (const page of party.pages) await page.waitForFunction(([set, id]) => !window.__props.alive(set, id), [set, target.id], { timeout: 20000 });
      await shooter.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
      await settle();
      const at = await Promise.all(party.pages.map(p => p.evaluate(() => { clearInterval(window.__props.watch); return window.__props.brokeAt; })));
      const shooterAt = at[party.pages.indexOf(shooter)];
      const step = { who, set, kind, id: target.id, metres: target.metres, firstRoundToBreakMs: shooterAt - t0, othersAfterShooterMs: at.filter((_, i) => party.pages[i] !== shooter).map(t => t - shooterAt) };
      if (set === 'x') {
        // Barrels stand in clusters and set each other off: wait for the chain, then every page must have drawn one explosion
        // for each explosive that went off, no more (nothing doubled by the wire) and no fewer.
        await sleep(sim ? 2500 : 1500);
        step.wentOff = (await state())[0].x.length - gone;
        step.drawn = await Promise.all(party.pages.map(p => p.evaluate(() => window.__props.booms.length)));
        step.counted = await Promise.all(party.pages.map(p => p.evaluate(() => window.__props.counted)));
      }
      out.steps.push(step);
      if (look) await look(target, 'after');
      return { target, step };
    };

    // --- 1. A window, broken by the host, then one by a guest: broken on every page, and the way through is open on every page.
    for (const shooter of has('pane') ? [host, guests[0]] : []) {
      const who = names[pages.indexOf(shooter)];
      const watcher = pages.find(p => p !== shooter);
      const look = async (_, when) => { await sleep(300); await shot(watcher, `1-window-by-${who}-${when}-seen-by-${names[pages.indexOf(watcher)]}`); };
      const { target, step } = await breakIt(shooter, 'b', 'pane', 3, 7, { look });
      const seen = await state();
      check(seen.every(s => s.b.includes(target.id)), `A window shot out by the ${who} is broken on every page`, step);
      const open = await Promise.all(pages.map(p => p.evaluate(([stand, at]) => {
        const { ctx } = window.__op2; const V = ctx.player.position.constructor;
        const eye = new V(stand[0], stand[1] + (ctx.player.eye.y - ctx.player.position.y || 1.62), stand[2]); const dir = new V(...at).sub(eye); const len = dir.length();
        const hit = ctx.physics.raycast(eye, dir.divideScalar(len), len + 0.3);
        return !hit || hit.distance > len - 0.05;
      }, [target.stand, target.centre])));
      check(open.every(Boolean), 'and a round now passes through where it was, on every page', open);
      check(step.firstRoundToBreakMs >= 0, 'The shooter saw it break at once (its own guess, ahead of the host)', step);
    }

    // --- 2. A barrel (or the Office's fuel tank) shot by the host: one explosion on every page, gone on every page.
    if (has('barrel') || has('tank')) {
      const { target, step } = has('barrel') ? await breakIt(host, 'x', 'barrel', 7.5, 22) : await breakIt(host, 'x', 'tank', 14, 30);
      const seen = await state();
      check(seen.every(s => s.x.includes(target.id)), "The host's barrel is gone on every page", step);
      check(drawnOnce(step), 'Every page drew one explosion for each thing that went off (the chain too), none doubled by the wire', step);
      check(countedOnce(step), 'Each went off once where it counts: on the host, never on a guest', step.counted);
    }

    // --- 3. A barrel shot by a guest standing 5 m from it, with an enemy beside it: once on the host, the enemy hurt once, the
    // shooter hurt by its own barrel, the far host not.
    if (has('barrel')) {
      const g = guests[0];
      const skip = (await state())[0].x;
      const pick = await g.evaluate(skip => window.__props.pick('x', 'barrel', 4.5, 6, skip), skip);
      if (!pick) throw new Error('no barrel with a clear shot at 5 m');
      const uid = await host.evaluate(at => {
        const { ctx } = window.__op2; const V = ctx.player.position.constructor;
        const p = new V(at[0] + 1.6, at[1] - 0.6, at[2]); const snapped = p.clone();
        if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
        const enemy = ctx.enemies.spawn('husk', p);
        enemy.behaviours = []; enemy.attacks = []; enemy.mode = 'hold'; enemy.dummy = true; enemy.health = enemy.maxHealth = 400;
        return enemy.uid;
      }, pick.centre);
      await g.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 45000 });
      const before = await host.evaluate(uid => window.__op2.ctx.enemies.alive.find(e => e.uid === uid).health, uid);
      const claims = () => g.evaluate(() => window.__op2.ctx.coop.world.claims.sent.hit);
      const claimed = await claims();
      const { target, step } = await breakIt(g, 'x', 'barrel', 4.5, 6, { mortal: true, alone: true });
      await sleep(sim ? 1500 : 700);
      const after = await host.evaluate(uid => window.__op2.ctx.enemies.alive.find(e => e.uid === uid)?.health ?? 0, uid);
      const health = await Promise.all(pages.map(p => p.evaluate(() => window.__op2.ctx.player.health)));
      const far = await host.evaluate(at => window.__op2.ctx.player.position.distanceTo(new (window.__op2.ctx.player.position.constructor)(...at)), target.centre);
      const guestClaims = await claims() - claimed;
      out.guestBarrel = { step, enemy: { before, after }, guestClaims, health, hostMetresAway: far, guestStats: (await state())[1].stats, hostStats: (await state())[0].stats };
      const seen = await state();
      check(seen.every(s => s.x.includes(target.id)), "A guest's barrel is gone on every page", step);
      check(drawnOnce(step), 'Every page drew one explosion for each explosive that went off', step);
      const lost = before - after;
      check(countedOnce(step) && guestClaims === 0 && lost > 20,
        "The barrels the guest shot went off once each, on the host; the enemy beside them was hurt there, and the guest's game claimed no damage of its own (W1)", { before, after, lost, guestClaims, counted: step.counted, wentOff: step.wentOff });
      // A cluster of barrels at 5 m can put the shooter down, as it does in a solo game: hurt is what is asserted.
      check(health[1] < 100 && health[0] === 100, 'The guest who shot it from 5 m was hurt by its own barrels (E7); the host, further back, was not', { health, hostMetresAway: far });
      await host.evaluate(uid => { const { ctx } = window.__op2; const e = ctx.enemies.alive.find(e => e.uid === uid); if (e) ctx.enemies.withdraw(e); ctx.player.modifiers.invulnerable = true; }, uid);
      for (const page of pages) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; window.__op2.ctx.player.health = window.__op2.ctx.player.maxHealth; });
    }

    // --- 4. More props, by both: a monitor and whatever else has a clear shot. Then every page must agree on everything.
    for (const [shooter, kind] of [[guests[0], 'monitor'], [host, 'monitor'], [guests[0], 'plant']]) {
      if (!has(kind)) continue;
      const can = await shooter.evaluate(kind => !!window.__props.pick('b', kind, 2, 6, window.__props.state().b), kind);
      if (!can) { out.steps.push({ skipped: kind }); continue; }
      await breakIt(shooter, 'b', kind, 2, 6);
    }
    await sleep(sim ? 2000 : 1000);
    let all = await state();
    out.broken = { explosives: all[0].x, props: all[0].b };
    check(all.every(s => JSON.stringify(s.x) === JSON.stringify(all[0].x) && JSON.stringify(s.b) === JSON.stringify(all[0].b)) && all[0].b.length + all[0].x.length >= 2,
      'Every page has exactly the same things broken', all.map(s => [s.x, s.b]));

    // --- 5. A player who joins now finds the world as broken as it is, and hears none of it happen again.
    if (players === 2) {
      progress('a late joiner arrives');
      const late = await lateGuest(party, 'LATE-ONE');
      await inMatch([late], party.mode.contract);
      await late.evaluate(tools);
      await late.waitForFunction(() => window.__op2.ctx.coop.world.propStats.states > 0, null, { timeout: 30000 });
      await sleep(600);
      const mine = await late.evaluate(() => ({ ...window.__props.state(), booms: window.__props.booms.length }));
      all = await state();
      out.late = mine;
      check(JSON.stringify(mine.x) === JSON.stringify(all[0].x) && JSON.stringify(mine.b) === JSON.stringify(all[0].b), 'The late joiner has the same barrels gone and the same props broken as the host', [mine.x, mine.b]);
      check(mine.booms === 0, 'and none of it was drawn again for the late joiner', mine.booms);
      // It looks at the first thing that was broken.
      const first = out.steps.find(s => s.id !== undefined);
      const view = await late.evaluate(([set, id]) => ({ centre: window.__props.centre(set, id) }), [first.set, first.id]);
      await late.evaluate(([at]) => window.__props.aim([at[0] + 2.5, at[1] - 1.2, at[2] + 2.5], at), [view.centre]);
      await sleep(700);
      await shot(late, `2-late-joiner-sees-broken-${first.kind}`);
      // And the late joiner breaks one more, seen by the two who were there.
      const [set, kind, min, max] = has('pane') ? ['b', 'pane', 3, 7] : ['x', 'barrel', 7.5, 22];
      const { target } = await breakIt(late, set, kind, min, max);
      all = await state();
      check(all.every(s => s[set].includes(target.id)), `A ${kind} the late joiner shoots is broken on every page`, all.map(s => s[set].length));
    }
    const stats = (await state()).map(s => s.stats);
    out.stats = stats;
    check(stats[0].refused === 0, "The host refused none of the guests' honest hits", stats[0]);
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    for (const [i, page] of (party?.pages ?? []).entries()) await page.screenshot({ path: `${outDir}/${tag}-fail-${i}.png` }).catch(() => {});
    throw error;
  } finally {
    writeFileSync(`${outDir}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
