// Prisoners for guests exactly as designed (world-b, finding V4). Endless Humans, a host and two guests. Men surrender on the
// host; on a guest the prompt reads "Tap [E] to question · Hold [E] to capture"; a guest's tap questions him and every screen
// gets what he gave up; a second tap lets him go; another guest's 0.4 s hold, with the fill ring, cuffs him and the bounty
// (about 300) lands in that guest's purse and nobody else's; two guests holding E on one man at once are settled by the host;
// and with the human shield switched on for the test (it is off in the game), a guest takes a man by the collar, he follows
// the guest on every screen, and a tap lets him go.
//   node tools/shot.mjs --port 5390 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 900 --script tools/scripts/coop-worldb-prisoners.mjs --out tools/out/coop/world-b/prisoners.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05 for the bad network; COOP_PLAYERS=2 for one guest (the two-at-once step is skipped).
import { writeFileSync } from 'node:fs';
import { ahead, kit, live, startParty, teleport } from './coop-kit.mjs';
import { lookAt, waits } from './coop-worldb-kit.mjs';

const PROMPT = 'Tap [E] to question · Hold [E] to capture';

/** Host: `n` troopers in a row in front of the spawn, every one of them on his knees with his hands up. Returns [uid, x, y, z]. */
const surrender = (host, base, n, offset = 0) => host.evaluate(([b, n, offset]) => {
  const { ctx } = window.__op2; const V = ctx.player.position.constructor; const o = ctx.enemies.outpost;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = new V(b[0] + (i - (n - 1) / 2) * 3.2, b[1], b[2] + offset); ctx.world.nav.nearest?.(p, 4, p);
    const e = ctx.enemies.spawn('trooper', p);
    const s = o.soldiers.find(x => x.e === e);
    if (!s) continue;
    o.collapse(s, 'surrender');
    out.push([e.uid, p.x, p.y, p.z]);
  }
  return out;
}, [base, n, offset]);

const man = (host, uid) => host.evaluate(uid => {
  const o = window.__op2.ctx.enemies.outpost; const s = o.soldiers.find(x => x.e.uid === uid);
  return s ? { surrendered: s.surrendered, questioned: s.questioned, released: s.released, cuffed: s.cuffed, collared: s.collared, alive: s.e.alive, at: s.e.position.toArray() } : null;
}, uid);
const credits = page => page.evaluate(() => window.__op2.ctx.contracts.wallet?.credits ?? 0);
const hudText = page => page.evaluate(() => document.querySelector('.hud')?.textContent ?? document.body.textContent ?? '');
const e = (page, down) => page.evaluate(down => window.__op2.ctx.input.simulate('interact', down), down);

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 3);
  const sim = process.env.COOP_SIM || undefined;
  const tag = `prisoners-${process.env.COOP_NET ?? 'loop'}-${players}p${sim ? '-badnet' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  const { until } = waits({ check, sleep });
  let party;
  try {
    party = await startParty(host, { mode: 'outpost', players, net: sim, out, progress, sleep });
    await live(party, { enemies: 1 });
    const { guests, pages } = party, guest = guests[0], other = guests[1] ?? guests[0];
    await host.evaluate(() => { const { ctx } = window.__op2; ctx.waves.reset?.(); for (const x of [...ctx.enemies.alive]) ctx.enemies.withdraw(x); });
    const base = await ahead(host, 10);
    for (const page of pages) await teleport(page, base.spawn, base.yaw);
    /** Stands a guest two metres in front of a man, looking at his chest. */
    const face = async (page, m) => {
      const toward = [base.spawn[0] - m[1], base.spawn[2] - m[3]]; const len = Math.hypot(...toward) || 1;
      await teleport(page, [m[1] + (toward[0] / len) * 2, m[2], m[3] + (toward[1] / len) * 2], 0);
      await lookAt(page, [m[1], m[2] + 1.0, m[3]]);
    };
    const kneelingOn = (page, uid) => until(page, uid => { const r = window.__op2.ctx.coop.world.replicas.get(uid); return !!r && (r.to.flags & 128) !== 0; }, uid, 'The guest sees him on his knees, hands up, and capturable');

    // --- Question, and let go -------------------------------------------------------------------------------------------
    // A squad still fighting somewhere, so there is something for him to give up.
    await host.evaluate(([b]) => { const { ctx } = window.__op2; const V = ctx.player.position.constructor; for (let i = 0; i < 2; i++) { const p = new V(b[0] + 14 + i * 2, b[1], b[2] + 14); ctx.world.nav.nearest?.(p, 6, p); const x = ctx.enemies.spawn('trooper', p); x.behaviours = []; x.attacks = []; x.mode = 'hold'; } }, [base.at]);
    let men = await surrender(host, base.at, 1);
    const a = men[0];
    await kneelingOn(guest, a[0]);
    await face(guest, a);
    await until(guest, text => (document.querySelector('.hud')?.textContent ?? '').includes(text), PROMPT, `The guest's prompt reads "${PROMPT}"`);
    await sleep(400);
    await shot(guest, 'guest-prompt');
    const before = await Promise.all(pages.map(credits));
    await e(guest, true); await sleep(90); await e(guest, false);
    await until(host, uid => window.__op2.ctx.enemies.outpost.soldiers.find(x => x.e.uid === uid)?.questioned === true, a[0], "The guest's tap questions him on the host");
    for (const g of guests) await until(g, () => /questioned a prisoner|[A-Z][a-z]+ \d|SQUAD\?/.test(document.querySelector('.hud')?.textContent ?? ''), null, 'What he gave up is on a guest\'s screen');
    out.afterQuestion = { host: (await hudText(host)).slice(0, 400), other: (await hudText(other)).slice(0, 400) };
    await until(guest, () => (document.querySelector('.hud')?.textContent ?? '').includes('Tap [E] to release'), null, 'The prompt now offers to release him');
    await sleep(300);
    await shot(guest, 'guest-questioned');
    await e(guest, true); await sleep(90); await e(guest, false);
    await until(host, uid => { const s = window.__op2.ctx.enemies.outpost.soldiers.find(x => x.e.uid === uid); return !s || s.released === true; }, a[0], "The guest's second tap lets him go on the host");
    check((await Promise.all(pages.map(credits))).every((c, i) => c === before[i]), 'Questioning and releasing paid nobody', [before, await Promise.all(pages.map(credits))]);

    // --- Capture: a 0.4 s hold, the ring, the bounty -------------------------------------------------------------------------
    men = await surrender(host, base.at, 1, 3);
    const b = men[0];
    await kneelingOn(other, b[0]);
    await face(other, b);
    await until(other, text => (document.querySelector('.hud')?.textContent ?? '').includes(text), PROMPT, 'Another guest gets the same prompt');
    const purse = await Promise.all(pages.map(credits));
    // Short of 0.4 s: the ring is filling and he is not cuffed yet.
    await other.evaluate(() => { const { ctx } = window.__op2; window.__ring = 0; const hold = ctx.hud.hold.bind(ctx.hud); ctx.hud.hold = f => { window.__ring = Math.max(window.__ring, f); hold(f); }; });
    // For the picture only, this guest's own clock runs slow while the key is down, so the ring is caught part full.
    await other.evaluate(() => { const t = window.__op2.ctx.time; window.__slow = setInterval(() => t.share('proof-shot', 0.02, 0, 0), 4); t.share('proof-shot', 0.02, 0, 0); });
    await e(other, true);
    await until(other, () => window.__ring > 0.2, null, 'The fill ring is filling under the held key');
    await shot(other, 'guest-ring');
    out.ringAtShot = await other.evaluate(() => window.__ring);
    await other.evaluate(() => { clearInterval(window.__slow); window.__op2.ctx.time.unshare('proof-shot'); });
    await until(host, uid => window.__op2.ctx.enemies.outpost.soldiers.find(x => x.e.uid === uid)?.cuffed === true, b[0], "The guest's held E cuffs him on the host");
    await e(other, false);
    const ring = await other.evaluate(() => window.__ring);
    check(ring > 0.2 && ring <= 1, 'The ring filled toward the 0.4 s mark', ring);
    await until(other, () => (document.querySelector('.hud')?.textContent ?? '').includes('PRISONER CUFFED'), null, 'The captor reads PRISONER CUFFED');
    await until(guest, () => /cuffed a prisoner/.test(document.querySelector('.hud')?.textContent ?? ''), null, 'The other guest is told who cuffed him');
    const captor = pages.indexOf(other);
    await until(other, c => (window.__op2.ctx.contracts.wallet?.credits ?? 0) >= c + 200, purse[captor], 'The drone takes him and the bounty lands in the captor\'s purse', 240000);
    const paid = await Promise.all(pages.map(credits));
    out.bounty = paid[captor] - purse[captor];
    check(out.bounty >= 250 && out.bounty <= 450, 'The bounty is about 300', out.bounty);
    check(paid.every((c, i) => i === captor || c === purse[i]), 'Nobody else was paid, the host included', [purse, paid]);

    // --- Two guests on one man at once ---------------------------------------------------------------------------------------
    if (guests.length >= 2) {
      men = await surrender(host, base.at, 1, 6);
      const c = men[0];
      for (const g of guests) { await kneelingOn(g, c[0]); }
      await face(guests[0], c);
      await teleport(guests[1], [c[1] + 1.6, c[2], c[3] + 1.2], 0); await lookAt(guests[1], [c[1], c[2] + 1.0, c[3]]);
      for (const g of guests) await until(g, text => (document.querySelector('.hud')?.textContent ?? '').includes(text), PROMPT, 'Both guests have the prompt on the same man');
      const both = await Promise.all(pages.map(credits));
      await Promise.all(guests.map(g => e(g, true)));
      await until(host, uid => window.__op2.ctx.enemies.outpost.soldiers.find(x => x.e.uid === uid)?.cuffed === true, c[0], 'Two guests hold E on one man: the host cuffs him once');
      await Promise.all(guests.map(g => e(g, false)));
      await until(host, uid => !window.__op2.ctx.enemies.alive.some(x => x.uid === uid), c[0], 'The drone takes him away', 240000);
      await sleep(1500);
      const after = await Promise.all(pages.map(credits));
      const winners = after.map((v, i) => v - both[i]).filter(d => d >= 200).length;
      check(winners === 1 && after[0] === both[0], 'Exactly one of the two guests is paid the bounty, and not the host', [both, after]);
    }

    // --- The human shield, switched on for this test only (it is off in the game) ----------------------------------------------
    for (const page of pages) await page.evaluate(async () => { (await import('/src/enemies/outpost/prisoners.ts')).HOSTAGES.on = true; });
    men = await surrender(host, base.at, 1, -3);
    const d = men[0];
    await kneelingOn(guest, d[0]);
    await face(guest, d);
    await until(guest, () => (document.querySelector('.hud')?.textContent ?? '').includes('Hold [E] to grab'), null, 'With the shield on, the hold reads "grab"');
    await e(guest, true);
    await until(host, uid => window.__op2.ctx.enemies.outpost.soldiers.find(x => x.e.uid === uid)?.collared === true, d[0], "The guest's hold takes him by the collar on the host");
    await e(guest, false);
    await until(guest, () => (document.querySelector('.hud')?.textContent ?? '').includes('let go'), null, 'The guest holding him is offered "let go"');
    // He goes where the guest goes, on every screen.
    const far = [base.spawn[0] + 4, base.spawn[1], base.spawn[2] + 4];
    await teleport(guest, far, base.yaw);
    const slot = await guest.evaluate(() => window.__op2.ctx.coop.lobby.me.slot);
    await until(host, ([uid, at]) => { const s = window.__op2.ctx.enemies.outpost.soldiers.find(x => x.e.uid === uid); return !!s && Math.hypot(s.e.position.x - at[0], s.e.position.z - at[2]) < 2.5; }, [d[0], far], 'On the host the held man is in front of the guest wherever they go');
    await until(other, ([uid, at]) => { const r = window.__op2.ctx.coop.world.replicas.get(uid); return !!r && Math.hypot(r.enemy.position.x - at[0], r.enemy.position.z - at[2]) < 3; }, [d[0], far], 'Another guest sees him held in front of the first');
    await teleport(other, [far[0] + 3.5, far[1], far[2] + 1.5], 0); await lookAt(other, [far[0], far[1] + 1.2, far[2]]);
    await sleep(800);
    await shot(other, 'guest-sees-shield');
    out.shieldSlot = slot;
    await e(guest, true); await sleep(90); await e(guest, false);
    await until(host, uid => { const s = window.__op2.ctx.enemies.outpost.soldiers.find(x => x.e.uid === uid); return !s || (!s.collared && s.released); }, d[0], "The guest's tap lets him go on the host");
    await until(guest, () => !(document.querySelector('.hud')?.textContent ?? '').includes('let go'), null, 'The guest\'s hands are empty again');
    for (const page of pages) await page.evaluate(async () => { (await import('/src/enemies/outpost/prisoners.ts')).HOSTAGES.on = false; });

    out.final = await man(host, d[0]);
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
