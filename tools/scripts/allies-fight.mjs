// A squad of allies against an enemy squad on the Test Range, the player standing back in god mode: a timeline of who is up,
// who is shooting whom, and the kills, with a picture every 10 s.
//   node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/allies-fight.mjs --wait 500 --timeout 150 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/allies/fight.png      (ALLIES=8 FOES=6 SECONDS=40)
export default async function alliesFight(page, h) {
  const allies = Number(process.env.ALLIES ?? 6);
  const foes = Number(process.env.FOES ?? 5);
  const seconds = Number(process.env.SECONDS ?? 40);
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__allies && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.mouse.click(300, 400);
  if (process.env.BREACH) await page.evaluate(() => { window.breach = true; });
  await page.evaluate(([n, f]) => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    window.__lab.settings.god = true;
    window.__lab.changed();
    ctx.player.teleport(new V(0, 0.1, 15));
    ctx.player.yaw = 0;
    ctx.player.pitch = 0;
    window.__allies.squad(n);
    window.__allies.foes(f);
    if (window.breach) window.__allies.breachAhead();
    ctx.player.teleport(new V(0, 0.1, 22));
    ctx.player.pitch = -0.05;
    window.kills = { ally: 0, other: 0, by: {} };
    ctx.events.on('enemy:killed', k => { if (/^ally_/.test(k.damage.source)) window.kills.ally++; else window.kills.other++; window.kills.by[k.damage.source] = (window.kills.by[k.damage.source] ?? 0) + 1; });
    window.ev = [];
    for (const e of ['ally:down', 'ally:revived', 'ally:dead']) ctx.events.on(e, x => window.ev.push(`${Math.round(ctx.time.elapsed)}s ${e.slice(5)} ${x.ally.type}`));
    window.ms = [];
  }, [allies, foes]);
  const line = [];
  for (let t = 0; t < seconds; t += 2) {
    await h.sleep(2000);
    line.push(await page.evaluate(() => {
      const { ctx } = window.__op2;
      const A = window.__allies.system;
      const s = n => A.allies.filter(a => a.state === n).length;
      return {
        up: s('up'), down: s('down'), enemies: ctx.enemies.alive.length, onAllies: (ctx.enemies.outpost?.soldiers ?? []).filter(x => x.foe).length,
        firing: A.allies.filter(a => a.target || a.hasArmour).length, inCover: A.allies.filter(a => a.spot).length, kills: window.kills.ally, other: window.kills.other,
        ms: +A.cpuMs.toFixed(2), score: ctx.progression.score ?? null,
        who: A.allies.map(a => `${a.type.slice(0, 4)}:${a.state[0]}${a.target ? '>' + a.target.id.slice(0, 4) : a.hasArmour ? '>car' : ''}${a.spot ? '@' : ''}${a.patient ? '+' : ''}`).join(' '),
      };
    }));
    if (t % 10 === 8) await h.shot(`t${t + 2}`);
  }
  return { line, events: await page.evaluate(() => window.ev), by: await page.evaluate(() => window.kills.by) };
}
