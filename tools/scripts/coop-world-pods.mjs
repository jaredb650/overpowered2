// The shared supply pod (docs/notes/coop.md, "The shared world"): a real wave clear, then on EVERY page the same pod at the
// same spot, landing and opening together, each player shopping at it with their own purse; a guest who joins in the break
// gets the pod already standing; the pod goes for everyone when the host's break ends.
//
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 420 \
//     --script tools/scripts/coop-world-pods.mjs --out tools/out/coop/world-a/pods.png
//   COOP_MODE=crucible|outpost  COOP_MAP=office  COOP_PLAYERS=2|3  COOP_SIM=lag:120,jitter:40,loss:0.05  COOP_NET=rtc
import { writeFileSync } from 'node:fs';
import { button, harness, inMatch, kit, live, ownWindow, quiet, returning, startParty, state, teleport } from './coop-kit.mjs';

/**
 * A guest who joins a match already running: the invite link and the password take them straight into the match (the kit's
 * `openGuest` waits for the lobby list, which such a guest never sees).
 */
export async function lateGuest(party, name) {
  const { host, transport, fps, out, password } = party;
  const guest = transport === 'loop' ? await ownWindow(host)
    : await host.context().browser().newPage({ viewport: host.viewportSize(), deviceScaleFactor: await host.evaluate(() => window.devicePixelRatio) });
  guest.on('pageerror', error => out?.errors.push(`${name}: ${error.message}`));
  await guest.addInitScript(harness, fps); await guest.addInitScript(quiet); await guest.addInitScript(returning);
  await guest.addInitScript(name => { if (!sessionStorage.getItem('coopKitNamed')) { localStorage.setItem('op2_coop_name', name); sessionStorage.setItem('coopKitNamed', '1'); } }, name);
  await guest.goto(party.invite);
  await guest.locator('input[type=password]').waitFor({ state: 'visible', timeout: 300000 });
  await guest.locator('input[type=password]').fill(password); await button(guest, 'Join lobby').click();
  party.guests.push(guest); party.pages.push(guest);
  return guest;
}

/** The pods a page has out now, as plain data. */
const pods = page => page.evaluate(() => {
  const set = window.__op2.ctx.progression.pods;
  return set.pods.filter(p => p.phase !== 'spent').map(p => ({ id: p.id, phase: p.phase, at: p.entry.position.toArray(), yaw: p.yaw,
    y: p.group.position.y, visible: p.group.visible, doors: p.doors[0].rotation.x, age: p.age, supply: set.supply }));
});

/**
 * Host: kills what is alive, one enemy at a time, until the director itself calls the wave clear. One at a time because forty
 * deaths in one frame stall a page for a second, which is a test's doing and not the game's.
 */
export const clearWave = async (host, sleep) => {
  for (let i = 0; i < 1500; i++) {
    const phase = await host.evaluate(() => {
      const { ctx } = window.__op2;
      const enemy = ctx.enemies.alive[0];
      if (ctx.waves.phase !== 'intermission' && enemy) {
        ctx.enemies.applyDamage(enemy, { amount: 99999, type: 'bullet', point: enemy.center.clone(), dir: enemy.center.clone().sub(ctx.player.eye).normalize(), force: 0, source: 'smg' });
      }
      return ctx.waves.phase;
    });
    if (phase === 'intermission') return;
    await sleep(40);
  }
  throw new Error('the wave never cleared');
};

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [] };
  const players = Number(process.env.COOP_PLAYERS ?? 2);
  const mode = process.env.COOP_MODE ?? 'crucible', map = process.env.COOP_MAP || undefined, sim = process.env.COOP_SIM || undefined;
  const tag = `pods-${mode}${map ? `-${map}` : ''}-${players}p${sim ? '-lag' : ''}`;
  const { check, progress, shot } = kit(outDir, tag, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode, map, players, net: sim, out, progress, sleep });
    await live(party, { enemies: 3 });
    const { pages, guests } = party;
    const names = ['host', ...guests.map((_, i) => `guest${i + 1}`)];
    const wave = (await state(host)).wave;
    progress(`wave ${wave} is live on ${pages.length} pages; clearing it for real`);

    // Every page logs what its copy of the waves said when it heard the clear, and samples its pods for the next half second.
    for (const page of pages) await page.evaluate(() => {
      const { ctx } = window.__op2;
      window.__podLog = { heard: null, samples: [], when: {} };
      // The machine's clock (the same for every page of this browser) when this page's pod first reached each phase.
      setInterval(() => {
        const pod = ctx.progression.pods.pods.find(p => p.phase !== 'spent');
        if (pod && !(pod.phase in window.__podLog.when)) window.__podLog.when[pod.phase] = Date.now();
      }, 5);
      ctx.events.on('wave:clear', () => {
        const t0 = performance.now();
        window.__podLog.heard = { phase: ctx.waves.phase, wave: ctx.waves.wave, at: Date.now() };
        const timer = setInterval(() => {
          const live = ctx.progression.pods.pods.filter(p => p.phase !== 'spent');
          window.__podLog.samples.push({ t: Math.round(performance.now() - t0), phase: ctx.waves.phase, pods: live.map(p => p.phase) });
          if (performance.now() - t0 > 600) clearInterval(timer);
        }, 40);
      });
    });
    await clearWave(host, sleep);
    // The proof needs a break long enough to walk the pages through it (test only: the break's length is the team lane's).
    await host.evaluate(() => { window.__op2.ctx.waves.nextWaveIn = 240; });
    for (const page of pages) await page.waitForFunction(() => window.__podLog.heard, null, { timeout: 20000 });
    await sleep(900);
    const logs = await Promise.all(pages.map(p => p.evaluate(() => window.__podLog)));
    out.clear = logs;
    out.clearHeardApartMs = Math.max(...logs.map(l => l.heard.at)) - Math.min(...logs.map(l => l.heard.at));
    check(logs.every(l => l.heard?.phase === 'intermission'), 'Every page heard the wave clear already in the break', logs.map(l => l.heard));
    check(logs.every(l => l.samples.length > 0 && l.samples.every(s => s.pods.length === 1)), 'From the clear on, every page has exactly one pod and never loses it',
      logs.map(l => l.samples.map(s => s.pods.join('+') || '-').join(' ')));

    const seen = await Promise.all(pages.map(pods));
    out.called = seen;
    check(seen.every(s => s.length === 1 && s[0].id === seen[0][0].id && s[0].id > 0), "Every page flies the host's pod, by its number", seen.map(s => s.map(p => p.id)));
    check(seen.every(s => s[0].at.every((n, i) => n === seen[0][0].at[i])), 'The pod is at the same spot on every page', seen.map(s => s[0].at));
    check(seen.every(s => s[0].yaw === seen[0][0].yaw), 'It lands turned the same way on every page', seen.map(s => s[0].yaw));
    const spot = seen[0][0].at;

    // Mid-fall: every page at about the same height (a page is behind the host by its lag, at 90 m/s).
    await host.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase === 'falling' && p.timer > 0.3), null, { timeout: 20000 });
    const falling = await Promise.all(pages.map(pods));
    out.falling = falling.map(s => ({ phase: s[0]?.phase, y: s[0]?.y }));
    // Stand everyone 16 m off, facing it, to watch it land.
    for (const [i, page] of pages.entries()) {
      const a = (i / pages.length) * Math.PI * 2;
      await teleport(page, [spot[0] + Math.sin(a) * 16, spot[1], spot[2] + Math.cos(a) * 16], a);
    }
    for (const page of pages) await page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase === 'open'), null, { timeout: 30000 });
    const opened = await Promise.all(pages.map(pods));
    out.opened = opened;
    check(opened.every(s => s.length === 1 && s[0].phase === 'open' && s[0].visible && Math.abs(s[0].y - spot[1]) < 0.01 && s[0].doors > 1.4),
      'The pod is down and open on every page, at the spot', opened.map(s => [s[0].phase, s[0].y, s[0].doors]));
    // The pod's clock on each page, against the machine's one clock: `born` is when this page's pod says it was called. It must
    // be when the page got the call (it heard the clear in the same message burst), however slowly the page is drawing. How far
    // apart the pages are is then only the delivery delay, reported as `clearHeardApartMs` (the wire, the simulator, a busy page).
    const clocks = await Promise.all(pages.map(p => p.evaluate(() => {
      const pod = window.__op2.ctx.progression.pods.pods.find(p => p.phase !== 'spent');
      return { born: Date.now() - pod.age * 1000, heard: window.__podLog.heard.at, when: window.__podLog.when, fps: window.__op2.stats().fps };
    })));
    out.clocks = clocks.map(c => ({ driftMs: Math.round(c.born - c.heard), fps: c.fps, fallMs: c.when.landed - c.when.falling }));
    out.apartMs = Object.fromEntries(['falling', 'landed', 'open'].map(phase => [phase, Math.max(...clocks.map(c => c.when[phase])) - Math.min(...clocks.map(c => c.when[phase]))]));
    check(clocks.every(c => Math.abs(c.born - c.heard) < 250), "Each page's pod runs on the true clock from the moment it got the call (ms off)", out.clocks);
    await sleep(600);
    for (const [i, page] of pages.entries()) await shot(page, `1-pod-open-${names[i]}`);

    // Each player walks up and shops with their own purse.
    const purses = [3000, 900, 1500];
    for (const [i, page] of pages.entries()) {
      const a = (i / pages.length) * Math.PI * 2;
      await teleport(page, [spot[0] + Math.sin(a) * 2.6, spot[1], spot[2] + Math.cos(a) * 2.6], a);
      await page.evaluate(credits => { window.__op2.ctx.contracts.shop.credits = credits; }, purses[i]);
    }
    await sleep(500);
    const near = await Promise.all(pages.map(p => p.evaluate(() => window.__op2.ctx.progression.pods.supplyNear)));
    check(near.every(Boolean), 'Every player is offered the shop at the shared pod', near);
    const bought = [];
    for (const [i, page] of pages.entries()) {
      await page.evaluate(() => { window.__op2.game.setState('playing'); window.__op2.ctx.input.simulate('interact', true); });
      await page.locator('.scr-proc').waitFor({ state: 'visible', timeout: 20000 });
      await page.evaluate(() => window.__op2.ctx.input.simulate('interact', false));
      if (i === 0) await shot(page, `2-shop-${names[i]}`, true);
      bought.push(await page.evaluate(() => {
        const shop = window.__op2.ctx.contracts.shop;
        const before = shop.credits;
        const offers = [...shop.weaponOffers(), ...shop.modOffers(), ...shop.implantOffers()];
        const offer = offers.find(o => !o.why && !o.owned && o.ware.price > 0 && o.ware.price <= before);
        const locked = offers.filter(o => o.why && /wave/i.test(o.why)).length;
        if (!offer) return { before, why: offers.slice(0, 6).map(o => o.why) };
        const why = shop.buy(offer.act);
        return { before, after: shop.credits, price: offer.ware.price, act: offer.act, why, locked, cleared: shop.view().cleared, inBreak: shop.inBreak };
      }));
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.evaluate(() => window.__op2.game.setState('playing'));
    }
    out.bought = bought;
    check(bought.every((b, i) => b.why === null && b.before === purses[i] && b.after === purses[i] - b.price), 'Each player bought something, paid from their own purse', bought);
    check(bought.every(b => b.inBreak && b.cleared === wave), 'Each shop reads the break and the wave just cleared (its own unlocks)', bought.map(b => [b.inBreak, b.cleared]));
    const after = await Promise.all(pages.map(p => p.evaluate(() => window.__op2.ctx.contracts.shop.credits)));
    check(after.every((c, i) => c === bought[i].after), "Nobody's purchase touched another player's credits", after);
    const still = await Promise.all(pages.map(pods));
    check(still.every(s => s.length === 1 && s[0].phase === 'open'), 'The pod stays for everyone while players shop', still.map(s => s.map(p => p.phase)));

    // A player who joins in the break gets the pod where it stands.
    if (players < 4 && !process.env.COOP_NO_LATE) {
      progress('a late joiner arrives in the break');
      const late = await lateGuest(party, 'LATE-ONE');
      await inMatch([late], party.mode.contract);
      await late.waitForFunction(() => window.__op2.ctx.progression.pods.pods.some(p => p.phase !== 'spent'), null, { timeout: 30000 });
      await sleep(400);
      const got = await pods(late);
      out.late = got;
      check(got.length === 1 && got[0].id === seen[0][0].id && got[0].at.every((n, i) => n === spot[i]) && got[0].phase === 'open' && got[0].visible,
        'The late joiner has the same pod, open, at the same spot', got);
      await teleport(late, [spot[0] + 9, spot[1], spot[2] + 9], Math.PI / 4);
      await sleep(600);
      await shot(late, '3-pod-late-joiner');
      await teleport(late, [spot[0] + 2.2, spot[1], spot[2] + 2.2], Math.PI / 4);
      await sleep(400);
      check(await late.evaluate(() => window.__op2.ctx.progression.pods.supplyNear), 'The late joiner is offered the shop there');
    }

    // The break ends on the host: the pod goes on every page, and the next wave is on every page.
    await host.evaluate(() => { window.__op2.ctx.waves.nextWaveIn = 0.2; });
    for (const page of party.pages) await page.waitForFunction(() => window.__op2.ctx.progression.pods.pods.every(p => p.phase === 'spent'), null, { timeout: 20000 });
    const end = await Promise.all(party.pages.map(state));
    check(end.every(s => s.wave === wave + 1), 'The pod is gone on every page as the next wave starts', end.map(s => [s.wave, s.phase]));
    out.gunLog = await host.evaluate(() => window.__coopLog ?? null);
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
