// Co-op proof: the small things the fix pass left, each on a real match with three players.
//
// SMALL_PART=crucible (default), in The Crucible:
//   tags      two friends in the same direction: their name tags are two lines, not one printed over the other
//   playing   the "now playing" tag is not drawn over the teammates strip
//   corpse    a friend's rounds into a body on the floor mark the body on the watcher's own screen (both ways round)
// SMALL_PART=humans, in Endless Humans:
//   bang      a flashbang's opening is the blinded player's: a guest blinded tells the host, and only the squads
//             fighting that guest go in; the host blinded, only the squads fighting the host
//   hook      a player who gets the skyhook's pass after the hook has its man sees him on the line where he is
//
//   OP2_NO_HMR=1 npx vite --port 5520 --strictPort
//   node tools/shot.mjs --port 5520 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-fixtail-small.mjs --out tools/out/coop/fix-tail/small.png
//
//   SMALL_ONLY=tags,corpse   some parts;  COOP_SIM=lag:120,jitter:40,loss:0.05;  SMALL_TAG names the evidence
import { writeFileSync } from 'node:fs';
import { ahead, calm, dummy, give, kit, live, startParty, teleport } from './coop-kit.mjs';

const PART = process.env.SMALL_PART ?? 'crucible';
const ONLY = (process.env.SMALL_ONLY ?? '').split(',').filter(Boolean);
const SIM = process.env.COOP_SIM ?? '';
const TAG = process.env.SMALL_TAG ?? `${PART}-${SIM ? 'lag' : 'clean'}`;
const part = name => ONLY.length === 0 || ONLY.includes(name);

const overlap = (a, b) => !!a && !!b && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && a.left < b.right - 0.5 && b.left < a.right - 0.5;
const box = r => ({ top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1) });
/** Turns a player (where they stand) to face `target`. */
const face = (page, target) => page.evaluate(target => {
  const { ctx } = window.__op2; const V = ctx.player.position.constructor;
  const d = new V(...target).sub(ctx.player.eye);
  ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(d.y, Math.hypot(d.x, d.z))));
  ctx.player.velocity.set(0, 0, 0);
}, target);
const until = async (read, test, sleep, ms = 20000) => {
  const end = Date.now() + ms * (SIM ? 2 : 1);
  for (;;) {
    const value = await read();
    if (test(value) || Date.now() > end) return value;
    await sleep(150);
  }
};

export default async function (host, { sleep, outDir }) {
  const out = { tag: TAG, part: PART, sim: SIM || 'off', transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [] };
  const { check: hard, progress } = kit(outDir, `small-${TAG}`, out, sleep);
  out.failed = [];
  const check = (condition, message, detail) => {
    if (condition) out.checks.push(message);
    else { out.failed.push({ message, detail }); progress(`FAILED: ${message} :: ${JSON.stringify(detail)?.slice(0, 500)}`); }
  };
  const picture = async (page, name) => {
    const path = `${outDir}/small-${TAG}-${name}.png`;
    await page.screenshot({ path, timeout: 120000 });
    out.screenshots.push(path);
  };
  let party;
  try {
    party = await startParty(host, { mode: PART === 'humans' ? 'outpost' : 'crucible', players: 3, net: SIM || undefined, out, progress, sleep });
    const [a, b] = party.guests;
    await live(party, { enemies: 1 });
    await host.evaluate(() => { window.__op2.ctx.waves.update = () => {}; });
    const spot = async metres => (await ahead(host, metres)).at;
    const yaw = (await ahead(host, 0)).yaw;

    if (PART !== 'humans') {
      await calm(host);
      // ---- tags ------------------------------------------------------------------------------------------------
      if (part('tags')) {
        progress('tags: two friends one behind the other, from the host\'s eyes');
        await teleport(host, await spot(0), yaw);
        await teleport(a, await spot(9), yaw); await teleport(b, await spot(20), yaw);
        await face(host, [...(await spot(14)).slice(0, 1), (await spot(14))[1] + 1.2, (await spot(14))[2]]);
        const tags = () => host.evaluate(() => [...document.querySelectorAll('.mk')].filter(el => el.style.display !== 'none' && /GUEST/.test(el.querySelector('.mk-label')?.textContent ?? ''))
          .map(el => { const r = el.querySelector('.mk-text').getBoundingClientRect(); return { label: el.querySelector('.mk-label').textContent, row: el.style.getPropertyValue('--row') || '0', top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
        // Both bodies are drawn where their players stand, and a frame has laid the tags out.
        const seen = await until(tags, t => t.length === 2 && t.some(tag => tag.row !== '0'), sleep, 15000);
        out.tags = seen.map(t => ({ label: t.label, row: t.row, ...box(t) }));
        check(seen.length === 2, 'tags: the host sees both friends\' name tags', out.tags);
        // Where the two would have been printed with no stacking: one on the other.
        const apart = seen.length === 2 && Math.abs((seen[0].left + seen[0].right) / 2 - (seen[1].left + seen[1].right) / 2);
        check(seen.length === 2 && apart < (seen[0].right - seen[0].left), `tags: the two friends are in the same direction (their tags ${Math.round(apart)} px apart sideways, each ${Math.round(seen[0]?.right - seen[0]?.left)} px wide)`, out.tags);
        check(seen.length === 2 && !overlap(seen[0], seen[1]), 'tags: neither tag is printed over the other', out.tags);
        check(seen.some(t => t.row !== '0') && seen.some(t => t.row === '0'), 'tags: one keeps its place and the other is set on the line under it', out.tags);
        await picture(host, 'tags');
        // Apart again: both back on their own line.
        await teleport(b, [(await spot(12))[0] + Math.cos(yaw) * 9, (await spot(12))[1], (await spot(12))[2] - Math.sin(yaw) * 9], yaw);
        const back = await until(tags, t => t.length === 2 && t.every(tag => tag.row === '0'), sleep, 15000);
        check(back.length === 2 && back.every(t => t.row === '0'), 'tags: apart again, both are where they would be anyway', back.map(t => ({ label: t.label, row: t.row })));
      }
      // ---- now playing --------------------------------------------------------------------------------------------
      if (part('playing')) {
        progress('playing: the track name comes up while the teammates strip is on');
        await host.evaluate(() => window.__op2.ctx.hud.nowPlaying.show('CLERICAL VIOLENCE (LONG TITLE FOR THE PROOF)', true));
        await sleep(900);
        const boxes = await host.evaluate(() => {
          const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width }; };
          return { np: [...document.querySelectorAll('.np > *')].map(rect).filter(r => r.w > 0), mates: [...document.querySelectorAll('.cq-mate')].map(rect), opacity: getComputedStyle(document.querySelector('.np')).opacity };
        });
        out.playing = { np: boxes.np.map(box), mates: boxes.mates.map(box), opacity: boxes.opacity };
        check(boxes.np.length >= 2 && Number(boxes.opacity) > 0.9, 'playing: the tag is up', out.playing);
        check(boxes.mates.length === 2, 'playing: the strip has both friends on it', out.playing.mates);
        check(boxes.np.every(n => boxes.mates.every(m => !overlap(n, m))), 'playing: no part of the tag is drawn over a teammate\'s card', out.playing);
        check(boxes.np.every(n => n.top >= -0.5), 'playing: and the tag is whole on the screen', out.playing.np);
        await picture(host, 'playing');
      }
      // ---- a friend's rounds into a corpse --------------------------------------------------------------------------
      if (part('corpse')) {
        for (const [who, shooter, watcher] of [['a guest', a, host], ['the host', host, a]]) {
          progress(`corpse: ${who} shoots a body on the floor; the other watches`);
          await calm(host);
          const at = await spot(11);
          const stand = await spot(6);
          for (const [i, page] of [host, a, b].entries()) await teleport(page, [stand[0] + Math.cos(yaw) * (i * 2 - 2), stand[1], stand[2] - Math.sin(yaw) * (i * 2 - 2)], yaw);
          const uid = await dummy(host, at);
          for (const page of party.pages) await page.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 20000 });
          for (const page of party.pages) await page.evaluate(() => {
            const { ctx } = window.__op2;
            if (window.__corpse) { window.__corpse.hits.length = 0; return; }
            const rec = window.__corpse = { hits: [] };
            const hit = ctx.gore.damageCorpse.bind(ctx.gore);
            ctx.gore.damageCorpse = (h, d) => { rec.hits.push(d.source); return hit(h, d); };
          });
          await host.evaluate(uid => {
            const { ctx } = window.__op2; const e = ctx.enemies.alive.find(x => x.uid === uid); const V = e.position.constructor;
            ctx.enemies.applyDamage(e, { amount: 99999, type: 'bullet', point: e.center.clone(), dir: new V(0, 0, -1), force: 1, source: 'lab' });
          }, uid);
          // Every screen has a body of its own on the floor (each screen's ragdoll falls its own way), at rest.
          const bodies = page => page.evaluate(() => window.__op2.ctx.gore.bodies.filter(x => x.sinking < 0 && !x.down).map(x => { const m = x.char.bones[0].matrixWorld.elements; return [m[12], m[13], m[14]]; }));
          for (const page of party.pages) await until(() => bodies(page), list => list.length >= 1, sleep, 15000);
          await sleep(3200);
          const lying = (await bodies(watcher)).at(-1);
          check(!!lying, `corpse: the watcher has the body on its floor (${who} shooting)`, await bodies(watcher));
          if (!lying) continue;
          // The shooter stands close and puts rounds through the spot where the body lies on the WATCHER's screen.
          const from = [lying[0] + Math.sin(yaw) * 3.5, stand[1], lying[2] + Math.cos(yaw) * 3.5];
          await teleport(shooter, from, yaw);
          await give(shooter, 'smg');
          await sleep(SIM ? 900 : 500);
          const before = await watcher.evaluate(() => window.__corpse.hits.length);
          await face(shooter, [lying[0], lying[1] + 0.05, lying[2]]);
          await shooter.evaluate(() => { const { ctx } = window.__op2; ctx.weapons.refillMagazines(); ctx.input.simulate('fire', true); });
          for (let i = 0; i < 12; i++) { await sleep(100); await face(shooter, [lying[0], lying[1] + 0.05, lying[2]]); }
          await shooter.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
          await sleep(SIM ? 1200 : 500);
          const hits = await watcher.evaluate(() => [...window.__corpse.hits]);
          out[`corpse ${who}`] = { lying, from, before, hits: hits.length, sources: [...new Set(hits)] };
          check(before === 0, `corpse: nothing had touched the body before ${who} fired`, before);
          check(hits.length - before >= 3 && hits.every(source => source === 'smg'), `corpse: ${who}'s rounds mark the body on the watcher's own screen (${hits.length - before} rounds into it)`, out[`corpse ${who}`]);
          await picture(watcher, `corpse-${who === 'the host' ? 'host-shoots' : 'guest-shoots'}`);
        }
      }
    } else {
      // =================================================== Endless Humans ============================================
      for (const page of party.pages) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
      const outpost = fn => host.evaluate(fn);
      // ---- a flashbang's opening is the blinded player's ----------------------------------------------------------------
      if (part('bang')) {
        progress('bang: squads set on each player, then a flashbang in a guest\'s eyes');
        await calm(host);
        const here = await spot(0);
        // The host far from the guest, each with a squad of their own in front of them.
        // An open spot for the guest: level with the spawn, 16 to 26 m from it, with clear air for 4 m back toward it.
        const guestAt = await host.evaluate(([from, yaw]) => {
          const { ctx } = window.__op2, V = ctx.player.position.constructor;
          let best = null, bestScore = Infinity;
          for (let d = 16; d <= 26; d += 2) for (let a = -1.3; a <= 1.3; a += 0.1) {
            const p = new V(from[0] - Math.sin(yaw + a) * d, from[1], from[2] - Math.cos(yaw + a) * d);
            const snapped = p.clone();
            if (!ctx.world.nav.nearest?.(p, 3, snapped) || Math.abs(snapped.y - from[1]) > 0.5) continue;
            const eye = new V(snapped.x, snapped.y + 1.6, snapped.z);
            const back = new V(from[0] - snapped.x, 0, from[2] - snapped.z).normalize();
            if (ctx.physics.raycast(eye, back, 9, 1) || ctx.physics.raycast(eye, back.clone().negate(), 10, 1)) continue;
            const score = Math.abs(a) * 10 + Math.abs(d - 20);
            if (score < bestScore) { bestScore = score; best = snapped.toArray(); }
          }
          return best;
        }, [here, yaw]);
        if (!guestAt) throw new Error('No open ground 16 to 26 m from the spawn for the flashbang');
        // The third player well out of both bangs.
        const aside = [here[0] + Math.sin(yaw) * 16, here[1], here[2] + Math.cos(yaw) * 16];
        await teleport(host, here, yaw); await teleport(a, guestAt, yaw + Math.PI); await teleport(b, aside, yaw);
        await sleep(SIM ? 1200 : 600);
        // Two squads of three, one in sight of each player; every squad's `opening` is counted, with whom it is after.
        const staged = await host.evaluate(([hostAt, guestAt, yaw]) => {
          const { ctx } = window.__op2; const o = ctx.enemies.outpost; const V = ctx.player.position.constructor;
          const crowd = o.crowd.players();
          const host = crowd.find(p => p.own), guest = crowd.find(p => p.slot === 1);
          const squads = [];
          for (const [who, at, sign] of [[host, hostAt, -1], [guest, guestAt, 1]]) {
            o.formSquad(3);
            for (let i = 0; i < 3; i++) {
              // Eight metres from its player, toward the other one.
              const to = new V(guestAt[0] - hostAt[0], 0, guestAt[2] - hostAt[2]).normalize().multiplyScalar(-sign);
              const p = new V(at[0] + to.x * 8 + to.z * (i - 1) * 1.6, at[1], at[2] + to.z * 8 - to.x * (i - 1) * 1.6);
              ctx.world.nav.nearest?.(p, 4, p);
              const e = ctx.enemies.spawn('trooper', p);
              e.quarry = who.own ? null : who.player;
              e.behaviours = []; e.attacks = []; e.mode = 'hold';
            }
            const q = o.squads.at(-1);
            Object.defineProperty(q, 'inContact', { get: () => true, configurable: true });
            squads.push({ q, after: who.own ? 'host' : 'guest' });
          }
          o.forming = null;
          window.__openings = [];
          for (const { q, after } of squads) { const opening = q.opening.bind(q); q.opening = seconds => { window.__openings.push(after); return opening(seconds); }; }
          return { squads: squads.map(s => ({ after: s.after, men: s.q.members.length, quarry: o.quarryOf(s.q) ? 'guest' : 'host' })), notes: { ...ctx.coop.world.notes } };
        }, [here, guestAt, yaw]);
        out.bangStaged = staged;
        check(staged.squads.length === 2 && staged.squads[0].quarry === 'host' && staged.squads[1].quarry === 'guest', 'bang: one squad is fighting the host and one the guest', staged);
        const bangAt = async (page, at) => {
          const eye = await page.evaluate(() => { const { ctx } = window.__op2; return [ctx.player.eye.toArray(), ctx.player.forward.toArray()]; });
          const spot = [eye[0][0] + eye[1][0] * 3, eye[0][1] - 0.6, eye[0][2] + eye[1][2] * 3];
          await host.evaluate(([spot]) => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; window.__openings.length = 0; ctx.enemies.outpost.flashbang(new V(...spot), 0.25); }, [spot]);
          void at;
        };
        const blind = page => page.evaluate(() => window.__op2.ctx.enemies.outpost.suppression.blinded === true);
        // In the guest's eyes.
        await face(a, [here[0], here[1] + 1.6, here[2]]);
        await face(host, [here[0] - Math.sin(yaw) * 5, here[1] + 1.6, here[2] - Math.cos(yaw) * 5]);
        await sleep(300);
        await bangAt(a);
        const guestBlind = await until(() => blind(a), v => v === true, sleep, 8000);
        const noted = await until(() => host.evaluate(() => window.__op2.ctx.coop.world.notes.blind ?? 0), n => n >= 1, sleep, 8000);
        await sleep(SIM ? 900 : 400);
        const first = await host.evaluate(() => ({ openings: [...window.__openings], hostBlind: window.__op2.ctx.enemies.outpost.suppression.blinded === true }));
        out.bangGuest = { guestBlind, noted, ...first };
        check(guestBlind === true, 'bang: the flashbang blinds the guest on the guest\'s own screen', out.bangGuest);
        check(first.hostBlind === false, 'bang: the host, over 13 m away, is not blinded', out.bangGuest);
        check(noted >= 1, 'bang: the guest says so, and the host takes the word', out.bangGuest);
        check(first.openings.includes('guest'), 'bang: the squad fighting the guest takes the opening', out.bangGuest);
        check(!first.openings.includes('host'), 'bang: the squad fighting the host does not', out.bangGuest);
        await picture(a, 'bang-guest');
        // In the host's eyes: the host's squad goes in, the guest's does not, and the guest sends nothing.
        await sleep(6500);
        await bangAt(host);
        const hostBlind = await until(() => blind(host), v => v === true, sleep, 8000);
        await sleep(SIM ? 900 : 500);
        const second = await host.evaluate(() => ({ openings: [...window.__openings], notes: window.__op2.ctx.coop.world.notes.blind ?? 0 }));
        out.bangHost = { hostBlind, ...second };
        check(hostBlind === true, 'bang: a flashbang in the host\'s eyes blinds the host', out.bangHost);
        check(second.openings.includes('host') && !second.openings.includes('guest'), 'bang: then the squad fighting the host goes in and the one fighting the guest does not', out.bangHost);
        check(second.notes === noted, 'bang: and no guest sent word of it (each is out of its reach)', out.bangHost);
      }
      // ---- the skyhook, for a player told after the hook has its man ---------------------------------------------------
      if (part('hook')) {
        progress('hook: the host cuffs a man; one guest is told of the pass only after the hook has him');
        await calm(host);
        const base = await spot(0);
        for (const [i, page] of party.pages.entries()) await teleport(page, [base[0] + Math.cos(yaw) * (i * 2 - 2), base[1], base[2] - Math.sin(yaw) * (i * 2 - 2)], yaw);
        const man = await host.evaluate(at => {
          const { ctx } = window.__op2; const V = ctx.player.position.constructor; const o = ctx.enemies.outpost;
          const p = new V(...at); ctx.world.nav.nearest?.(p, 4, p);
          const e = ctx.enemies.spawn('trooper', p);
          const s = o.soldiers.find(x => x.e === e);
          o.collapse(s, 'surrender');
          return e.uid;
        }, await spot(10));
        for (const page of party.guests) await page.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), man, { timeout: 20000 });
        await sleep(400);
        await host.evaluate(uid => { const o = window.__op2.ctx.enemies.outpost; o.captives.cuffFor(o.soldiers.find(x => x.e.uid === uid), null); }, man);
        const flown = page => page.evaluate(uid => {
          const { ctx } = window.__op2; const hook = ctx.coop.world.skyhook; const e = ctx.enemies.alive.find(x => x.uid === uid);
          const pass = hook.copy?.passes.find(p => p.uid === uid);
          return { flying: hook.flying, s: pass ? pass.s : null, drone: pass ? pass.drone.pos.toArray() : null, man: e ? e.position.toArray() : null, carried: e?.carried === true };
        }, man);
        // Both guests fly the drone in. B then forgets the pass, as a page that had only just arrived would have none.
        for (const page of party.guests) await until(() => flown(page), f => f.flying >= 1, sleep, 90000);
        const bId = await b.evaluate(() => window.__op2.ctx.coop.lobby.you);
        await until(() => flown(a), f => f.s !== null && f.s > -1.5, sleep, 90000);
        await b.evaluate(uid => window.__op2.ctx.coop.world.skyhook.copy.cancel(uid), man);
        // The hook takes him on A's screen; half a second on, the host's catch-up for an arriving player runs for B.
        const hooked = await until(() => flown(a), f => f.s !== null && f.s > 0.5, sleep, 30000);
        check(hooked.carried === true, 'hook: the guest who watched it whole has the man on the line', hooked);
        const none = await flown(b);
        check(none.flying === 0, 'hook: the other guest has no pass (it is the page that was not there)', none);
        await host.evaluate(id => window.__op2.ctx.coop.world.hook.catchUp(id), bId);
        const caught = await until(() => flown(b), f => f.flying >= 1 && f.carried, sleep, 4000);
        const [whole, late] = await Promise.all([flown(a), flown(b)]);
        out.hook = { hooked, caught, whole, late };
        check(caught.flying >= 1 && caught.s > 0, `hook: told after the hook, it joins the pass past the hook (${caught.s?.toFixed(2)} s past)`, caught);
        check(caught.carried === true, 'hook: and its copy of the man is on the line', caught);
        const gap = whole.drone && late.drone ? Math.hypot(whole.drone[0] - late.drone[0], whole.drone[1] - late.drone[1], whole.drone[2] - late.drone[2]) : Infinity;
        const speed = whole.s !== null ? Math.hypot(22, 44 * whole.s) : 0;
        // The two were read a few frames apart and the drone is climbing fast by now: within a quarter second of its flight.
        check(gap <= Math.max(6, speed * (SIM ? 0.6 : 0.3)), `hook: its drone is where the other guest's is (${gap.toFixed(1)} m apart at ${speed.toFixed(0)} m/s)`, { whole, late });
        check(late.man && late.man[1] > base[1] + 3, `hook: the man is off the floor on its screen (${late.man ? (late.man[1] - base[1]).toFixed(1) : '?'} m up)`, late);
      }
    }
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    hard(out.failed.length === 0, 'Every check passed', out.failed.map(f => f.message));
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/small-${TAG}-evidence.json`, JSON.stringify(out, null, 2));
    for (const page of party?.guests ?? []) await page.close().catch(() => {});
  }
}
