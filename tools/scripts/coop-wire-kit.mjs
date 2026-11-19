// Shared steps of the wire lane's proofs (coop-wire-heavy.mjs, coop-wire-stall.mjs, coop-wire-relay.mjs): the heaviest fight
// the game can make, on any party the co-op kit started.

/** Host: keeps `count` enemies alive, in a ring round the players' spawn, a mix of what the mode can spawn. Returns the kinds. */
export const fill = (host, count = 48) => host.evaluate(count => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const spawnAt = ctx.world.playerSpawns[0].position;
  const kinds = [];
  // Whatever this mode has the bodies for: the swarm, and a few that shoot.
  for (const kind of ['husk', 'stalker', 'leaper', 'trooper', 'gunner', 'rocketeer']) {
    try {
      const probe = ctx.enemies.spawn(kind, spawnAt.clone().add(new V(18, 0, 0)));
      if (probe) { kinds.push(kind); ctx.enemies.withdraw(probe); }
    } catch { /* this mode has no such body */ }
  }
  let n = 0;
  clearInterval(window.__wireFill);
  window.__wireFill = setInterval(() => {
    for (let tries = 0; tries < 12 && ctx.enemies.alive.length < count; tries++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 14;
      const p = new V(spawnAt.x + Math.cos(a) * r, spawnAt.y, spawnAt.z + Math.sin(a) * r);
      const snapped = p.clone();
      if (ctx.world.nav.nearest?.(p, 6, snapped)) p.copy(snapped);
      // Three of the swarm to each one that shoots.
      const kind = n++ % 4 === 3 && kinds.length > 1 ? kinds[1 + (n >> 2) % (kinds.length - 1)] : kinds[0];
      try { ctx.enemies.spawn(kind, p); } catch { /* skip */ }
    }
  }, 250);
  return kinds;
}, count);

export const stopFill = host => host.evaluate(() => clearInterval(window.__wireFill));

/**
 * A scripted shooter for any gun: keeps the nearest enemy in the sight and works the trigger as the gun wants it. `hold`
 * keeps it down (an automatic), `tap` presses it again and again (a pump shotgun, a rocket), `lance` charges to full, lets
 * go and lets the beam pour before charging again. Stop it with the kit's `stopShooting`.
 */
export const gunLoop = (page, weapon, how = 'hold') => page.evaluate(([weapon, how]) => {
  const { ctx, game } = window.__op2;
  ctx.weapons.give(weapon); ctx.weapons.switchTo(weapon); ctx.weapons.refillMagazines();
  clearInterval(window.__coopShooter);
  let tick = 0;
  window.__coopShooter = setInterval(() => {
    if (game.state !== 'playing') game.setState('playing');
    let best = null, bestD = 3600;
    for (const enemy of ctx.enemies.alive) {
      const d = enemy.center.distanceToSquared(ctx.player.eye);
      if (d < bestD) { best = enemy; bestD = d; }
    }
    if (best) {
      const delta = best.center.clone().sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
    }
    ctx.weapons.refillMagazines();
    tick++;
    // A trigger already down while the gun is still coming up is not a press: wait for the draw.
    const down = ctx.weapons.drawLeft > 0 ? false : how === 'hold' ? true : how === 'tap' ? tick % 2 === 0 : !ctx.weapons.lance.beaming && ctx.weapons.charge < 1;
    ctx.input.simulate('fire', !!best && down);
  }, 50);
}, [weapon, how]);

/** The host's gun, then each guest's: the rotary cannon, a pump shotgun, rockets, a held Lance beam. */
export const GUNS = [['buzzsaw', 'hold'], ['shotgun', 'tap'], ['rocket', 'tap'], ['lance', 'lance']];

/** Every page: no combo, perk or drop from kills, so no slow-mo comes and goes under a measurement. */
export const steady = page => page.evaluate(async () => { (await import('/src/core/devflags.ts')).DevFlags.progression = false; });

/** Host: a gunship over the fight, flown by itself. */
export const gunship = host => host.evaluate(() => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const s = ctx.world.playerSpawns[0].position;
  ctx.progression.callinLink.callAt('ac130', new V(s.x + 8, s.y, s.z + 6), new V(1, 0, 0.35), true);
});

/** The whole heavy fight on a live party: 48 enemies kept alive, everyone firing. */
export async function heavyFight(party, { enemies = 48, fire = true } = {}) {
  const kinds = await fill(party.host, enemies);
  for (const page of party.pages) await steady(page);
  if (fire) for (const [i, page] of party.pages.entries()) await gunLoop(page, ...GUNS[i]);
  return kinds;
}
