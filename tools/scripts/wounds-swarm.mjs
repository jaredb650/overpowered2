// The swarm with the wound work in the build: nothing of it may reach here. Wave 1 as it always was, and a shot leg on a husk is
// still only a shot leg: no condition, no bleed unless a limb is off, no panic, and a rocket still gibs.
//   node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/wounds-swarm.mjs --wait 500 --timeout 90 --out tools/out/wounds-swarm.png
export default async function swarm(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await h.sleep(9000);
  return page.evaluate(async () => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    const heard = [];
    for (const t of ['enemy:wounded', 'enemy:condition', 'comms:line']) ctx.events.on(t, () => heard.push(t));
    let killed = [];
    ctx.events.on('enemy:killed', k => killed.push({ id: k.enemy.id, gibbed: k.gibbed, source: k.damage.source }));
    ctx.player.modifiers.invulnerable = true;
    const roster = {};
    for (const e of ctx.enemies.alive) roster[e.id] = (roster[e.id] ?? 0) + 1;
    const out = {
      outpost: ctx.enemies.outpost === null, waves: ctx.waves.constructor.name, wave: ctx.waves.wave, phase: ctx.waves.phase, remaining: ctx.enemies.remaining, alive: ctx.enemies.alive.length, roster,
    };
    const husk = ctx.enemies.alive.find(e => e.id === 'husk');
    if (husk) {
      const hit = (region, amount, type = 'bullet') => ctx.enemies.applyDamage(husk, { amount, type, point: husk.center.clone(), dir: new V(1, 0, 0), force: 0, source: 'test', region, bone: 11 });
      hit('legL', 10);
      out.afterLegHit = { hp: husk.health, bleed: husk.bleed, legs: husk.maim.legs, burning: husk.burning, speed: +husk.speedMul.toFixed(3) };
      // Two SMG rounds' worth takes a husk's thigh pool, as it always has.
      hit('legL', 25);
      hit('legL', 25);
      out.limbGone = husk.char.severed.size;
      out.afterSever = { alive: husk.alive, bleed: +husk.bleed.toFixed(2), legs: husk.maim.legs };
    }
    const far = ctx.enemies.alive.find(e => e !== husk);
    if (far) {
      ctx.combat.explode(far.center.clone(), { radius: 8, damage: 100, kind: 'rocket', source: 'test', team: 'player' });
      await new Promise(r => setTimeout(r, 200));
    }
    out.killed = killed.slice(0, 6);
    out.heard = heard;
    return out;
  });
}
