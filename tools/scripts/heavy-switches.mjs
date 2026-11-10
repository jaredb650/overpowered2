// What key 8's URL switches leave, read from the real game on the Test Range. One page load a set of switches:
//
//   node tools/shot.mjs --url "/?map=range&slot8=old&doorgun=old" --script tools/scripts/heavy-switches.mjs --wait 500 --dpr 2 --w 1440 --h 900 --out tools/out/heavy/sw.png
//   node tools/shot.mjs --url "/?map=range&burst=0&slow=0" --script tools/scripts/heavy-switches.mjs ...
//
// Reports the gun's name, whether the heavy machine gun came with it, its rate once spun, bursts a round, how fast the
// player covers ground while it fires, and what the door gun's panel calls its belt.
export default async function heavySwitches(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const out = await page.evaluate(async () => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const world = async s => { const end = ctx.time.elapsed + s; while (ctx.time.elapsed < end) await frame(); };
    let fired = 0;
    ctx.events.on('weapon:fired', e => { if (e.weapon === 'buzzsaw') fired++; });
    // As a cache hands it over, so what comes with it is what the table says.
    window.__lab.settings.arsenal = false;
    window.__lab.changed();
    ctx.weapons.reset();
    ctx.weapons.give('buzzsaw');
    const r = { withIt: ctx.weapons.owned.has('piledriver') };
    ctx.player.teleport(new V(-26, 0.1, 12), -Math.PI / 2);
    ctx.player.pitch = 0.12;
    ctx.weapons.switchTo('buzzsaw');
    ctx.weapons.modifiers.bottomlessMag = true;
    await world(0.7);
    r.name = document.querySelector('.arm-name, .weapon-name')?.textContent ?? null;
    r.family = document.querySelector('.arm-family')?.textContent ?? null;
    ctx.input.simulate('forward', true);
    ctx.input.simulate('fire', true);
    await world(1.3);
    const f0 = fired;
    const t0 = ctx.time.playerElapsed;
    const from = ctx.player.position.clone();
    ctx.combat.bursts.stats.bursts = 0;
    await world(1);
    r.rps = Number(((fired - f0) / (ctx.time.playerElapsed - t0)).toFixed(1));
    r.burstsPerRound = Number((ctx.combat.bursts.stats.bursts / Math.max(fired - f0, 1)).toFixed(2));
    r.speedFiring = Number((ctx.player.position.distanceTo(from) / (ctx.time.playerElapsed - t0)).toFixed(2));
    ctx.input.simulate('fire', false);
    ctx.input.simulate('forward', false);
    ctx.weapons.modifiers.bottomlessMag = false;
    await world(0.5);
    ctx.progression.boardCallIn('doorGunner');
    for (let i = 0; i < 1200 && ctx.progression.callInsManager.seats.seat?.stage !== 'seated'; i++) await frame();
    const seat = ctx.progression.callInsManager.seats.seat;
    r.belt = seat?.weapons?.[0] ? `${seat.weapons[0].name} ${seat.weapons[0].max}` : null;
    return r;
  });
  return out;
}
