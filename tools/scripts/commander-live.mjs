// The Commander in real Chrome: forces each tell, photographs it, and reads the state behind it. Run through tools/shot.mjs.
//
//   CMD_CASES=box,mortar node tools/shot.mjs --url "/?map=killhouse&autostart=1&dev=1" --w 1920 --h 1080 --script tools/scripts/commander-live.mjs --out tools/out/cmd.png --wait 500 --timeout 170
//
// Cases: box mortar sniper jammer mines surrender pickups barricade smoke person swarm. Each writes tools/out/cmd-<case>.png.
const cases = (process.env.CMD_CASES ?? 'box,mortar,jammer,mines,surrender').split(',');

export default async function live(page, h) {
  const out = {};
  const shot = name => h.shot(name).catch(e => console.error(`shot ${name} failed: ${e.message.split('\n')[0]}`));
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  out.boot = Math.round((Date.now() - started) / 1000);

  await page.evaluate(() => {
    const { ctx } = window.__op2;
    const c = ctx.enemies.outpost.commander;
    window.__c = c;
    window.__o = ctx.enemies.outpost;
    window.__ctx = ctx;
    ctx.player.maxHealth = ctx.player.health = 1e5;
    ctx.waves.update = () => {};
    window.__clear = () => {
      for (const e of [...ctx.enemies.alive]) ctx.enemies.killAll?.('test');
      c.devices.clear();
    };
    // Stands the camera at `from` looking at `at`.
    window.__look = (from, at, pitch) => {
      const p = ctx.player;
      p.teleport(p.position.clone().set(from[0], from[1], from[2]), Math.atan2(-(at[0] - from[0]), -(at[2] - from[2])));
      p.pitch = pitch ?? Math.atan2(at[1] - from[1] - 1.6, Math.hypot(at[0] - from[0], at[2] - from[2]));
    };
    window.__report = over => ({ ...c.tracker.closeRound(1), kills: 9, damageTaken: 30, seconds: 80, ...over });
  });

  for (const name of cases) {
    const fn = CASES[name];
    if (!fn) continue;
    try {
      out[name] = await fn(page, h, shot);
    } catch (e) {
      out[name] = `failed: ${e.message.split('\n')[0]}`;
    }
  }
  return out;
}

const brief = (page, over) => page.evaluate(o => {
  const c = window.__c;
  const adaptation = o.adaptation ?? null;
  if (adaptation) c.adopt(adaptation);
  window.__ctx.events.emit('commander:briefing', {
    wave: o.wave ?? 3, next: (o.wave ?? 3) + 1, phase: o.phase, report: window.__report(o.report ?? {}), adaptation, tricks: o.tricks ?? [], fielded: c.fielded, seconds: 13,
  });
}, over);

const skim = async (page, h, shot, label, pages) => {
  // Lets the text finish typing, photographs each page in turn.
  for (let i = 0; i < pages; i++) {
    await h.sleep(1900);
    await shot(`${label}-${i + 1}`);
    await page.evaluate(() => window.__ctx.input.simulate('interact', true));
    await h.sleep(60);
    await page.evaluate(() => window.__ctx.input.simulate('interact', false));
    await h.sleep(150);
  }
};

const CASES = {
  async box(page, h, shot) {
    await brief(page, { phase: 'contact', report: { doorShots: 212 }, adaptation: 'mines', wave: 1 });
    await skim(page, h, shot, 'box-smug', 3);
    await h.sleep(300);
    await brief(page, { phase: 'adaptation', report: { stillSeconds: 41 }, adaptation: 'mortars', wave: 3 });
    await skim(page, h, shot, 'box-irritated', 1);
    await page.evaluate(() => { window.__ctx.input.simulate('interact', false); });
    await h.sleep(5500);
    await brief(page, { phase: 'desperation', report: { trapHits: [{ cause: 'mine', hits: 2, damage: 60 }] }, adaptation: 'falseSurrender', tricks: ['dangerClose'], wave: 6 });
    await skim(page, h, shot, 'box-rattled', 2);
    await h.sleep(5500);
    await brief(page, { phase: 'lastStand', report: { fallen: ['Dennis'] }, wave: 9 });
    await skim(page, h, shot, 'box-cracked', 1);
    return page.evaluate(() => document.querySelector('.cmd-box')?.className);
  },
};
