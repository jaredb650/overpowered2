// Co-op look-check: the team's slow-mo notice must not sit on the wave banner, nor on the break's ready-vote chip
// (checklist C18). Two pages on the Crucible, drawn as a player sees them. Both are up at once in three cases:
//
//  1. A wave banner while one player's slow-mo runs.
//  2. A wave banner while two players' slow-mos run (the notice is two lines tall).
//  3. The break's "NEXT WAVE IN / READY UP" chip while a slow-mo runs.
//
// For each, on the host and on the guest: the boxes the three things draw in must not overlap, and a picture is kept.
// Look at dpr 2, 1440x900:
//
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 400 --script tools/scripts/coop-fixgame-notice.mjs --out <dir>/notice.png
import { writeFileSync } from 'node:fs';
import { calm, kit, live, startParty } from './coop-kit.mjs';

/** The boxes on this page, in CSS pixels, of whatever is showing. */
const boxes = page => page.evaluate(() => {
  const box = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } : null;
  };
  return { notice: box(document.querySelector('.ct')), band: box(document.querySelector('.banners .band')), rest: box(document.querySelector('.cq-rest')), strip: box(document.querySelector('.cq-strip')),
    rows: document.querySelectorAll('.ct-row').length, lines: [...document.querySelectorAll('.ct-line')].map(n => n.textContent) };
});
const overlap = (a, b) => !!a && !!b && a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right;

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], rows: {} };
  const { check, progress, shot } = kit(outDir, 'fixgame-notice', out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: 2, look: true, out, progress, sleep });
    await live(party, { enemies: 1 });
    const guest = party.guest;
    await calm(host);
    await sleep(800);
    /** A slow-mo of this player's, as a capsule would start it. */
    const slow = page => page.evaluate(() => window.__op2.ctx.time.pushScale('timeWarp', 0.25, 0.1, 0.5));
    const free = page => page.evaluate(() => window.__op2.ctx.time.popScale('timeWarp'));
    const banner = page => page.evaluate(() => window.__op2.ctx.hud.banner('WAVE 7', '24 HOSTILES'));
    const both = async (name, want) => {
      for (const [i, page] of party.pages.entries()) {
        // The banner is up for a couple of seconds: it is shown on each page just before that page is read.
        if (want.includes('band')) { await banner(page); await sleep(600); }
        const b = await boxes(page);
        out.rows[`${name}-${i === 0 ? 'host' : 'guest'}`] = b;
        await shot(page, `${name}-${i === 0 ? 'host' : 'guest'}`);
        for (const key of want) check(!!b[key], `${name}: the ${key} is showing on the ${i === 0 ? 'host' : 'guest'}`, b);
        check(!overlap(b.notice, b.band), `${name}: the slow-mo notice is clear of the wave banner on the ${i === 0 ? 'host' : 'guest'}`, b);
        check(!overlap(b.notice, b.rest), `${name}: the slow-mo notice is clear of the ready-vote chip on the ${i === 0 ? 'host' : 'guest'}`, b);
        check(!overlap(b.notice, b.strip), `${name}: the slow-mo notice is clear of the teammates strip on the ${i === 0 ? 'host' : 'guest'}`, b);
        check(!overlap(b.rest, b.band), `${name}: the ready-vote chip is clear of the wave banner on the ${i === 0 ? 'host' : 'guest'}`, b);
      }
    };

    // 1. One slow-mo, and the wave banner.
    await slow(host);
    await guest.waitForFunction(() => document.querySelectorAll('.ct-row').length === 1, null, { timeout: 15000 });
    await both('one', ['notice', 'band']);
    progress('1. one slow-mo and the wave banner');

    // 2. Two players' slow-mos: the notice is two lines tall.
    await slow(guest);
    await host.waitForFunction(() => document.querySelectorAll('.ct-row').length === 2, null, { timeout: 15000 });
    await both('two', ['notice', 'band']);
    progress('2. two slow-mos and the wave banner');
    await free(host);
    await free(guest);
    await sleep(2500);

    // 3. The break, with its ready-vote chip, and a slow-mo. The field is empty and the director is told its wave is clear,
    // which is what opens the team's break (net/teamBreak.ts) on every screen.
    await host.evaluate(() => {
      const { ctx } = window.__op2;
      ctx.waves.wave = 3; ctx.waves.phase = 'intermission'; ctx.waves.nextWaveIn = 40;
      ctx.events.emit('wave:clear', { wave: 3, bonus: 0 });
    });
    for (const page of party.pages) await page.waitForFunction(() => { const el = document.querySelector('.cq-rest'); return !!el && el.getBoundingClientRect().height > 0; }, null, { timeout: 30000 });
    await slow(host);
    await guest.waitForFunction(() => document.querySelectorAll('.ct-row').length >= 1, null, { timeout: 15000 });
    await sleep(700);
    await both('break', ['notice', 'rest']);
    const rest = out.rows['break-host'].rest;
    check(!!rest, 'the break\'s ready-vote chip was showing with the notice', out.rows['break-host']);
    progress('3. the break chip and a slow-mo');
    await free(host);
  } catch (error) {
    out.errors.push(String(error?.stack ?? error));
    if (party) for (const [i, page] of party.pages.entries()) await page.screenshot({ path: `${outDir}/fixgame-notice-fail-${i}.png`, timeout: 60000 }).catch(() => {});
  }
  writeFileSync(`${outDir}/fixgame-notice.json`, JSON.stringify(out, null, 2));
  return out;
}
