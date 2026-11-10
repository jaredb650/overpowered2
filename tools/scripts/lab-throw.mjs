// Measures how far every weapon throws a body, in the real game on the Test Range.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-throw.mjs --wait 500 --timeout 280 --out tools/out/throw.png
// THROW_CASES=shotgun,rocket reruns cases whose name contains one of those words, THROW_REPS=5 repeats each. Distances are hips at rest from
// where the enemy stood, so a body that falls where it was measures about 1 m: its own length.
const only = (process.env.THROW_CASES ?? '').split(',').filter(Boolean);
const reps = Number(process.env.THROW_REPS ?? 1);

export default async function throwTest(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const boot = await page.evaluate(() => Math.round(performance.now()));
  const results = await page.evaluate(async ({ only, reps }) => {
    const lab = window.__lab;
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    lab.settings.gibbing = false;
    lab.settings.progression = false;
    lab.settings.god = true;
    lab.settings.arsenal = true;
    lab.flags.gibbing = false;
    lab.flags.progression = false;
    ctx.player.modifiers.invulnerable = true;
    for (const id of ['smg', 'shotgun', 'rocket', 'autocannon', 'sword', 'judge', 'lance', 'buzzsaw', 'kiln', 'stakegun']) {
      if (!ctx.weapons.owned.has(id)) ctx.weapons.give(id);
    }
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const until = async (test, seconds) => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end && !test()) await frame();
    };
    const hipsOf = (c, out) => out.setFromMatrixPosition(c.bones[0].matrixWorld);
    const look = t => {
      const d = new V().subVectors(t, ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z);
      ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
    const home = new V(0, 0.1, 12);
    const fresh = async () => {
      lab.spawner.clearBodies();
      ctx.enemies.killAll('lab');
      lab.spawner.clearBodies();
      ctx.player.teleport(home, 0);
      await until(() => false, 0.1);
    };
    const place = (id, x, z, ai = 'off') => lab.spawner.place(id, new V(x, 0, z), ai);

    /** Follows these bodies until they stop, and returns distance at rest, peak speed and peak height. */
    const track = async (chars, starts) => {
      const now = chars.map(() => new V());
      const was = chars.map((c, i) => hipsOf(c, new V()));
      const peak = chars.map(() => 0);
      const high = chars.map(() => 0);
      let quiet = 0;
      const end = ctx.time.elapsed + 4.5;
      while (ctx.time.elapsed < end && quiet < 0.5) {
        const t0 = ctx.time.elapsed;
        await frame();
        const dt = ctx.time.elapsed - t0;
        if (dt <= 0) continue;
        let fastest = 0;
        chars.forEach((c, i) => {
          hipsOf(c, now[i]);
          const speed = now[i].distanceTo(was[i]) / dt;
          if (speed < 60) peak[i] = Math.max(peak[i], speed);
          high[i] = Math.max(high[i], now[i].y);
          fastest = Math.max(fastest, speed);
          was[i].copy(now[i]);
        });
        quiet = fastest < 0.25 ? quiet + dt : 0;
      }
      return chars.map((c, i) => ({
        dist: +Math.hypot(now[i].x - starts[i].x, now[i].z - starts[i].z).toFixed(2),
        peak: +peak[i].toFixed(1),
        up: +high[i].toFixed(2),
      }));
    };

    const gun = async (weapon, dist, hold = 6) => {
      await fresh();
      const e = place('trooper', 0, home.z - dist);
      const start = e.position.clone();
      await frame();
      ctx.weapons.switchTo(weapon);
      await until(() => false, 0.45);
      look(new V(0, 1.15, start.z));
      ctx.input.simulate('fire', true);
      if (weapon === 'lance') {
        // A charge weapon fires on release.
        await until(() => false, 1.3);
        ctx.input.simulate('fire', false);
        await until(() => !e.alive, 0.4);
      } else {
        await until(() => !e.alive, hold);
        ctx.input.simulate('fire', false);
      }
      if (e.alive) return { note: 'survived', hp: e.health };
      // Measured from where it died too: a dummy that takes several shots has already been knocked back by the rest.
      const died = lab.overlay.from.clone();
      const row = (await track([e.char], [start]))[0];
      const hips = hipsOf(e.char, new V());
      row.fromDeath = +Math.hypot(hips.x - died.x, hips.z - died.z).toFixed(2);
      return row;
    };

    const near = async (kind, radius, damage, dist, corpse) => {
      await fresh();
      // Further apart than a blast reaches, so each body feels only its own.
      const bodies = [[0, 0], [22, 0], [-22, 0]].map(([x, z]) => place('trooper', x, z));
      const starts = bodies.map(e => e.position.clone());
      const chars = bodies.map(e => e.char);
      await until(() => false, 0.15);
      if (corpse) {
        ctx.enemies.killAll('lab');
        await until(() => false, 1.6);
        for (let i = 0; i < 3; i++) hipsOf(chars[i], starts[i]);
      }
      for (let i = 0; i < 3; i++) {
        ctx.combat.explode(new V(starts[i].x, 0.3, starts[i].z + dist), { radius, damage, kind, source: 'test', team: 'player' });
      }
      const out = await track(chars, starts);
      const left = bodies.filter(e => e.alive).length;
      return { dist: +(out.reduce((a, r) => a + r.dist, 0) / 3).toFixed(2), most: Math.max(...out.map(r => r.dist)), peak: Math.max(...out.map(r => r.peak)), up: Math.max(...out.map(r => r.up)), survived: left };
    };

    const corpseSpray = async (weapon, seconds) => {
      await fresh();
      const e = place('trooper', 0, home.z - 7);
      await until(() => false, 0.1);
      ctx.enemies.killAll('lab');
      ctx.weapons.switchTo(weapon);
      await until(() => false, 1.5);
      const start = hipsOf(e.char, new V());
      const hips = new V();
      ctx.input.simulate('fire', true);
      const end = ctx.time.elapsed + seconds;
      let peak = 0, prev = start.clone();
      while (ctx.time.elapsed < end) {
        const t0 = ctx.time.elapsed;
        look(hipsOf(e.char, hips));
        await frame();
        const dt = ctx.time.elapsed - t0;
        if (dt > 0) peak = Math.max(peak, hipsOf(e.char, hips).distanceTo(prev) / dt);
        prev.copy(hips);
      }
      ctx.input.simulate('fire', false);
      hipsOf(e.char, hips);
      return { moved: +Math.hypot(hips.x - start.x, hips.z - start.z).toFixed(2), peak: +peak.toFixed(1) };
    };

    /** How far and how fast the pieces of a gibbed body go. Gibbing is on for this one. */
    const gibs = async () => {
      await fresh();
      lab.flags.gibbing = true;
      const e = place('trooper', 0, home.z - 10);
      await until(() => false, 0.1);
      const from = e.position.clone();
      ctx.weapons.switchTo('rocket');
      await until(() => false, 0.5);
      look(new V(0, 1.15, from.z));
      ctx.input.simulate('fire', true);
      await until(() => !e.alive, 2);
      ctx.input.simulate('fire', false);
      let limbSpeed = 0;
      let chunkSpeed = 0;
      const end = ctx.time.elapsed + 3;
      while (ctx.time.elapsed < end) {
        await frame();
        limbSpeed = Math.max(limbSpeed, ctx.gore.stats().limbSpeed);
        chunkSpeed = Math.max(chunkSpeed, ctx.gore.chunks.fastest);
      }
      const far = Math.max(0, ...ctx.gore.limbs.map(l => Math.hypot(l.rag.center.x - from.x, l.rag.center.z - from.z)));
      const limbs = ctx.gore.limbs.length;
      // A rocket beside what is left, to see that resting limbs take the blast without leaving the map.
      const at = new V(from.x + 1, 0.3, from.z);
      const before = ctx.gore.limbs.map(l => l.rag.center.clone());
      ctx.combat.explode(at, { radius: 8, damage: 100, kind: 'rocket', source: 'test', team: 'player' });
      let second = 0;
      let secondChunk = 0;
      const stop = ctx.time.elapsed + 2.5;
      while (ctx.time.elapsed < stop) {
        await frame();
        second = Math.max(second, ctx.gore.stats().limbSpeed);
        secondChunk = Math.max(secondChunk, ctx.gore.chunks.fastest);
      }
      const moved = Math.max(0, ...ctx.gore.limbs.map((l, i) => (before[i] ? l.rag.center.distanceTo(before[i]) : 0)));
      lab.flags.gibbing = false;
      return { limbs, farthestLimb: +far.toFixed(1), limbSpeed: +limbSpeed.toFixed(1), chunkSpeed: +chunkSpeed.toFixed(1), secondBlastLimbSpeed: +second.toFixed(1), secondBlastChunk: +secondChunk.toFixed(1), secondBlastMoved: +moved.toFixed(1) };
    };

    const cases = {
      'gibs from a rocket': gibs,
      'smg kill at 8 m': () => gun('smg', 8),
      'shotgun point blank 2 m': () => gun('shotgun', 2),
      'shotgun at 8 m': () => gun('shotgun', 8),
      'judge at 8 m': () => gun('judge', 8),
      'buzzsaw kill at 8 m': () => gun('buzzsaw', 8),
      'autocannon at 10 m': () => gun('autocannon', 10),
      'lance at 8 m': () => gun('lance', 8),
      'stakegun at 8 m': () => gun('stakegun', 8),
      'rocket direct at 10 m': () => gun('rocket', 10),
      'rocket floor 2 m away': () => near('rocket', 8, 100, 2),
      'rocket floor 4 m away': () => near('rocket', 8, 100, 4),
      'rocket floor 6 m away': () => near('rocket', 8, 100, 6),
      'grenade floor 2 m away': () => near('grenade', 7, 190, 2),
      'grenade floor 5 m away': () => near('grenade', 7, 190, 5),
      'rocket 2 m from a corpse': () => near('rocket', 8, 100, 2, true),
      'smg 1.5 s on a corpse': () => corpseSpray('smg', 1.5),
      'buzzsaw 1.5 s on a corpse': () => corpseSpray('buzzsaw', 1.5),
    };
    const out = {};
    for (const [name, run] of Object.entries(cases)) {
      if (only.length && !only.some(o => name.includes(o))) continue;
      try {
        const runs = [];
        for (let i = 0; i < reps; i++) runs.push(await run());
        out[name] = reps === 1 ? runs[0] : { dist: runs.map(r => r.dist ?? r.moved ?? r.note), fromDeath: runs.map(r => r.fromDeath), peak: Math.max(...runs.map(r => r.peak ?? 0)), up: Math.max(...runs.map(r => r.up ?? 0)), survived: runs.reduce((a, r) => a + (r.survived ?? 0), 0) };
      } catch (err) {
        out[name] = { error: String(err) };
      }
    }
    return out;
  }, { only, reps });
  return { boot, results };
}
