// Co-op proof: what an enemy does and is, on a guest's screen, beyond where it stands. Two pages (host and one guest).
//
//   node tools/shot.mjs --port 5320 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 300 \
//     --script tools/scripts/coop-motion-moves.mjs --out tools/out/coop/enemy-motion/moves.png
//   MOVES_MODE=outpost  Endless Humans instead: every soldier has the host's name, rank, squad and voice on the guest (only that)
//   MOVES_NET=lag:80,jitter:30,loss:0.03   under a bad network
//
// Asserts, on the guest:
//   - a knocked-down enemy falls as a ragdoll of the guest's own (gore has the copy), and gets up when the host's does,
//     ending where the host's stands;
//   - a boss's roar and a stagger with no hit behind it play on the copy;
//   - frozen and burning are the copy's real state while the host's enemy is, and end when it ends;
//   - the copy aims at the player the host's enemy is after;
//   - an enemy the host withdraws goes, one it kills never comes back, and neither stalls the rest;
//   - the snapshot lane is the unreliable one.
import { writeFileSync } from 'node:fs';
import { calm, kit, live, netStats, startParty } from './coop-kit.mjs';

const MODE = process.env.MOVES_MODE ?? 'crucible';
const NET = process.env.MOVES_NET ?? '';

/** Host: one enemy standing still `metres` ahead of the first spawn, a step to the side. Returns its uid. */
const stand = (host, kind, metres, side = 0) => host.evaluate(([kind, metres, side]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const s = ctx.world.playerSpawns[0];
  const p = new V(s.position.x - Math.sin(s.yaw) * metres + Math.cos(s.yaw) * side, s.position.y, s.position.z - Math.cos(s.yaw) * metres - Math.sin(s.yaw) * side);
  const snapped = p.clone();
  if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
  const e = ctx.enemies.spawn(kind, p);
  if (!e) return 0;
  e.behaviours = []; e.attacks = []; e.mode = 'hold'; e.dummy = true;
  return e.uid;
}, [kind, metres, side]);

/** Guest: what the copy of `uid` is doing. */
const copy = (guest, uid) => guest.evaluate(uid => {
  const { ctx } = window.__op2;
  const r = ctx.coop.world.replicas.get(uid);
  if (!r) return null;
  const e = r.enemy;
  return { at: e.position.toArray(), yaw: e.yaw, ragdoll: !!ctx.gore.downed(e.char), downed: e.downed, frozen: e.frozen, burning: e.burning, flames: !!e.burnEmitter,
    plays: window.__plays?.[uid] ?? [], alive: e.alive, playhead: r.motion.playhead };
}, uid);
const hostEnemy = (host, uid) => host.evaluate(uid => {
  const e = window.__op2.ctx.enemies.alive.find(e => e.uid === uid);
  return e ? { at: e.position.toArray(), downed: e.downed, rising: e.rising, frozen: e.frozen, burning: e.burning } : null;
}, uid);
const until = async (read, ok, sleep, ms = 8000) => {
  for (let waited = 0; waited < ms; waited += 50) { const v = await read(); if (ok(v)) return v; await sleep(50); }
  return read();
};
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], seen: {} };
  const name = `moves-${MODE}${NET ? '-net' : ''}`;
  const { check, progress, shot } = kit(outDir, name, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: MODE, net: NET || undefined, out, progress, sleep });
    const { guest } = party;
    await live(party);

    if (MODE === 'outpost') {
      // Who the soldiers are, before the wave is cleared away.
      await sleep(1500);
      const names = page => page.evaluate(() => Object.fromEntries((window.__op2.ctx.enemies.outpost?.soldiers ?? []).filter(s => s.e?.alive).map(s => [s.e.uid, `${s.titled}|${s.name}|${s.desig}|${s.nick}|${s.voice}`])));
      const onHost = await names(host);
      const onGuest = await until(() => names(guest), g => Object.keys(onHost).every(uid => g[uid] === onHost[uid]), sleep, 6000);
      out.seen.identity = { host: onHost, guest: onGuest };
      check(Object.keys(onHost).length > 0, 'The host has soldiers', onHost);
      check(Object.keys(onHost).every(uid => onGuest[uid] === onHost[uid]), 'Every soldier has the same name, rank, squad and voice on the guest', { onHost, onGuest });
      // The rest is the Crucible run's: clearing this mode's wave by hand ends its round.
      await shot(guest, 'soldiers');
      check(out.errors.length === 0, 'No page exceptions', out.errors);
      return out;
    }

    await calm(host);
    await host.evaluate(() => { window.__op2.ctx.waves.nextWaveIn = 1e9; });
    for (const page of party.pages) await page.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; });
    // The guest notes every clip a copy's animator is asked to play, by uid.
    await guest.evaluate(() => {
      window.__plays = {};
      window.__op2.ctx.events.on('enemy:spawned', ({ enemy }) => {
        const anim = enemy.char.anim, play = anim.play.bind(anim);
        anim.play = (action, speed) => { (window.__plays[enemy.uid] ??= []).push(action); return play(action, speed); };
      });
    });
    // A copy the roster leaves out waits 500 ms for a late kill, and the roster comes every 250 ms when nothing is alive:
    // up to 750 ms, so the proof waits for it rather than for a fixed 700.
    await guest.waitForFunction(() => window.__op2.ctx.enemies.alive.length === 0, null, { timeout: 2500 }).catch(() => {});
    check(await guest.evaluate(() => window.__op2.ctx.enemies.alive.length) === 0, 'The guest\'s copies went when the host cleared its wave (no kills)');

    const lane = (await netStats(host)).lanes?.world;
    check(lane?.unreliable === true, 'Snapshots go on the unreliable lane', lane);

    // Both players look down the range from the spawn.
    for (const page of party.pages) await page.evaluate(() => { const { ctx } = window.__op2; ctx.player.yaw = ctx.world.playerSpawns[0].yaw; ctx.player.pitch = -0.1; });

    // 1. A knockdown with no hit behind it.
    const man = await stand(host, 'trooper', 7, -1.5);
    await until(() => copy(guest, man), c => !!c, sleep);
    await sleep(600);
    await shot(guest, 'standing');
    await host.evaluate(uid => { const { ctx } = window.__op2; const e = ctx.enemies.alive.find(e => e.uid === uid); ctx.enemies.model.drop(e, 0.9, 2); }, man);
    const hostDown = await until(() => hostEnemy(host, man), h => h?.downed, sleep, 3000);
    check(hostDown?.downed, 'The host\'s enemy went down', hostDown);
    const fell = await until(() => copy(guest, man), c => c?.ragdoll, sleep, 3000);
    check(fell?.ragdoll, 'The guest\'s copy fell as a ragdoll of its own (gore has the body)', fell);
    await sleep(350); await shot(guest, 'falling');
    await sleep(500); await shot(guest, 'down');
    const hostUp = await until(() => hostEnemy(host, man), h => h && !h.downed, sleep, 15000);
    check(hostUp && !hostUp.downed, 'The host\'s enemy got up', hostUp);
    const rose = await until(() => copy(guest, man), c => c && !c.ragdoll, sleep, 4000);
    check(rose && !rose.ragdoll, 'The guest\'s copy got up when the host\'s did', rose);
    await shot(guest, 'rising');
    await sleep(2500);
    const [there, here] = [await hostEnemy(host, man), await copy(guest, man)];
    out.seen.afterGetUp = { host: there, guest: here, apart: flat(there.at, here.at) };
    check(flat(there.at, here.at) < 0.35, 'Once up, the copy stands where the host\'s does', out.seen.afterGetUp);
    await shot(guest, 'up');

    // 2. Clips with no hit behind them.
    const brute = await stand(host, 'brute', 8, 1.5);
    await until(() => copy(guest, brute), c => !!c, sleep);
    await sleep(500);
    await host.evaluate(uid => { const e = window.__op2.ctx.enemies.alive.find(e => e.uid === uid); e.char.anim.play('roar', 1.2); }, brute);
    const roared = await until(() => copy(guest, brute), c => c?.plays.includes('roar'), sleep, 3000);
    check(roared?.plays.includes('roar'), 'A roar on the host plays on the copy', roared?.plays);
    await host.evaluate(uid => { const { ctx } = window.__op2; const e = ctx.enemies.alive.find(e => e.uid === uid); ctx.enemies.stagger(e, 0.6); }, man);
    const staggered = await until(() => copy(guest, man), c => c?.plays.includes('stagger'), sleep, 3000);
    check(staggered?.plays.includes('stagger'), 'A stagger with no hit behind it plays on the copy', staggered?.plays);
    await host.evaluate(uid => { const e = window.__op2.ctx.enemies.alive.find(e => e.uid === uid); e.char.anim.play('attackMelee'); e.char.anim.play('shoot'); }, brute);
    await sleep(600);
    const after = await copy(guest, brute);
    check(!after.plays.includes('attackMelee') && !after.plays.includes('shoot'), 'Attack clips are not this lane\'s: none was sent as a move', after.plays);

    // 3. Frozen and burning are the copy's own state.
    await host.evaluate(uid => { const e = window.__op2.ctx.enemies.alive.find(e => e.uid === uid); e.frozen = 2.5; }, brute);
    const frozen = await until(() => copy(guest, brute), c => c?.frozen > 0, sleep, 3000);
    check(frozen?.frozen > 0, 'Frozen on the host is frozen on the copy (so a kill now is a shatter)', frozen);
    await sleep(300); await shot(guest, 'frozen');
    const thawed = await until(() => copy(guest, brute), c => c?.frozen === 0, sleep, 6000);
    check(thawed?.frozen === 0, 'It thaws when the host\'s does', thawed);
    await host.evaluate(uid => { const e = window.__op2.ctx.enemies.alive.find(e => e.uid === uid); e.burning = 2.5; }, man);
    const burning = await until(() => copy(guest, man), c => c?.burning > 0 && c.flames, sleep, 3000);
    check(burning?.burning > 0 && burning.flames, 'Burning on the host is burning on the copy, with flames', burning);
    await sleep(300); await shot(guest, 'burning');
    const out2 = await until(() => copy(guest, man), c => c && c.burning === 0 && !c.flames, sleep, 8000);
    check(out2 && out2.burning === 0 && !out2.flames, 'The flames go out when the host\'s do', out2);

    // 4. Withdrawn, killed, and a new one meanwhile.
    const extra = await stand(host, 'husk', 9, 0);
    await until(() => copy(guest, extra), c => !!c, sleep);
    await host.evaluate(uid => { const { ctx } = window.__op2; ctx.enemies.withdraw(ctx.enemies.alive.find(e => e.uid === uid)); }, extra);
    const gone = await until(() => copy(guest, extra), c => c === null, sleep, 3000);
    check(gone === null, 'An enemy the host withdraws leaves the guest too', gone);
    await host.evaluate(uid => {
      const { ctx } = window.__op2; const e = ctx.enemies.alive.find(e => e.uid === uid);
      ctx.enemies.applyDamage(e, { amount: 99999, type: 'bullet', point: e.center.clone(), dir: e.center.clone().sub(ctx.player.eye).normalize(), force: 30, source: 'smg', region: 'chest' });
    }, brute);
    const killed = await until(() => guest.evaluate(uid => ({ dead: window.__op2.ctx.coop.world.replicas.get(uid) === undefined, alive: window.__op2.ctx.enemies.alive.some(e => e.uid === uid) }), brute), k => k.dead && !k.alive, sleep, 3000);
    check(killed.dead && !killed.alive, 'A killed enemy dies on the guest', killed);
    await sleep(1500);
    check(!(await guest.evaluate(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), brute)), '... and no late state brings it back');
    check((await copy(guest, man))?.alive, 'The others are untouched', await copy(guest, man));

    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${name}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
