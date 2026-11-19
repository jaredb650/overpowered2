// Co-op look-check: four pictures from a GUEST's eyes of what it never had before. Run at the owner's screen size:
//
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 400 --script tools/scripts/coop-attacks-shots.mjs --out <dir>/shots.png
//
//   sniper-laser   the marksman's laser on the guest, gone solid
//   rocket         an enemy rocket in flight toward the guest
//   slam-ring      the Juggernaut's warning ring under the guest as it jumps
//   muzzle-flash   a gunner's shotgun flash, with its pellets leaving
//
// Each picture is of one exact frame: the guest's page stops drawing on the frame the thing happens (the kit's frame gate),
// the picture is taken, and it carries on.
import { writeFileSync } from 'node:fs';
import { ahead, aimAt, calm, kit, live, startParty } from './coop-kit.mjs';
import { put, readRecord, record, stage, unstage } from './coop-attacks-kit.mjs';

/** Guest: stops the page's frames the first time `when` (a test over the recorder's events since `since`) is true after a draw. */
const freezeWhen = (page, since, when, delayMs) => page.evaluate(([since, when, delayMs]) => {
  const { ctx } = window.__op2;
  const test = new Function('ev', `return ${when}`);
  window.__frozen = false;
  let seenAt = 0;
  if (!window.__realRender) {
    window.__realRender = ctx.render.render.bind(ctx.render);
    ctx.render.render = () => { window.__realRender(); window.__afterDraw?.(); };
  }
  window.__afterDraw = () => {
    const ev = window.__atk.ev.filter(e => e.at >= since);
    if (!seenAt && test(ev)) seenAt = performance.now();
    if (seenAt && performance.now() - seenAt >= delayMs) { window.__coopHidden = true; window.__frozen = true; window.__afterDraw = null; }
  };
}, [since, when, delayMs]);

const thaw = page => page.evaluate(() => { window.__coopHidden = false; window.__frozen = false; window.__afterDraw = null; });

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], shots: {} };
  const tag = 'attacks-shots';
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let party;
  try {
    // A look-check: the page as a player has it. Each picture is of the frame the page stopped drawing on, and in the kit's
    // fast mode a page draws no frame at all, so nothing ever froze.
    party = await startParty(host, { mode: 'crucible', players: 2, look: true, out, progress, sleep });
    await live(party, { enemies: 1 });
    await calm(host);
    const guest = party.guest;
    for (const page of party.pages) await page.evaluate(record);
    await guest.evaluate(() => window.__op2.ctx.render.setQuality?.(2));
    const spot = await ahead(host, 0);

    const take = async (name, kind, attack, d, when, delayMs, setup, prep) => {
      await calm(host);
      await put(guest, spot.at, spot.yaw);
      await put(host, (await ahead(host, -18)).at, spot.yaw);
      await sleep(500);
      const since = Date.now();
      const uid = await stage(host, kind, (await ahead(host, d)).at, attack, setup);
      await guest.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 40000, polling: 100 });
      await aimAt(guest, uid);
      if (prep) await prep(uid);
      await freezeWhen(guest, since, when, delayMs);
      // Polled on a timer: the page's own frames are what the freeze stops.
      const frozen = await guest.waitForFunction(() => window.__frozen === true, null, { timeout: 20000, polling: 100 }).then(() => true).catch(() => false);
      await sleep(150);
      const path = `${outDir}/${tag}-${name}.png`;
      await guest.screenshot({ path, timeout: 120000 });
      out.screenshots.push(path);
      const r = await readRecord(guest, since);
      await thaw(guest);
      await unstage(host, uid);
      out.shots[name] = { frozen, path, copies: r.copies, events: [...new Set(r.ev.map(e => e.k))] };
      progress(`${name}: ${frozen ? 'taken' : 'NOT FROZEN (taken anyway)'} ${path}`);
      return frozen;
    };

    const ok = [];
    const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
    const realTake = take;
    const takeIf = (name, ...rest) => (only && !only.has(name) ? Promise.resolve(true) : realTake(name, ...rest));
    ok.push(await takeIf('sniper-laser', 'sniper', 'snipe', 22, "ev.some(e => e.k === 'laserSolid') || ev.some(e => e.k === 'laser' && Date.now() - e.at > 1500)", 60));
    // Seen from beside its path: once the rocket is in the air the guest steps 5 m off its line, 18 m along it, and watches it come.
    const beside = (await ahead(host, 16)).at;
    beside[0] += Math.cos(spot.yaw) * 5; beside[2] -= Math.sin(spot.yaw) * 5;
    const watchRocket = () => guest.evaluate(([p]) => {
      const { ctx } = window.__op2; const V = ctx.player.position.constructor;
      let moved = false;
      const tick = () => {
        const copy = (ctx.combat.projectiles?.active ?? []).find(q => q.cosmetic && q.kind === 'rocket');
        if (copy) {
          if (!moved) { moved = true; ctx.player.teleport(new V(...p)); }
          const d = copy.position.clone().sub(ctx.player.eye);
          ctx.player.yaw = Math.atan2(-d.x, -d.z); ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        }
        if (!window.__frozen) requestAnimationFrame(tick);
      };
      tick();
    }, [beside]);
    ok.push(await takeIf('rocket', 'rocketeer', 'rocket', 34, "ev.some(e => e.k === 'proj' && e.kind === 'rocket')", 520, undefined, watchRocket));
    ok.push(await takeIf('slam-ring', 'juggernaut', 'slam', 9, "ev.some(e => e.k === 'zone')", 550));
    ok.push(await takeIf('muzzle-flash', 'gunner', 'blast', 6, "ev.some(e => e.k === 'flash')", 0));
    check(ok.every(Boolean), 'Each picture is of the frame it names', out.shots);
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
