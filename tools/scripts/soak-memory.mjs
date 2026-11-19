// Leak soak: plays Crucible waves with a bot that kills everything, and after each wave checks whether GPU memory (textures,
// buffers, render buffers), three.js's own counts and the JS heap came back to where they were. Finds leaks; fixes nothing.
//
//   node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --wait 2000 --timeout 600 \
//     --script tools/scripts/soak-memory.mjs --out tools/out/<you>/soak.png
//
// Settings (environment):
//   SOAK_ROUNDS  waves to play (default 6; the first is warm-up and is not judged)
//   SOAK_SETTLE  seconds of rest after each wave before the reading, so blood, gibs and bodies finish (default 5)
//   SOAK_WARM    rounds left out of the verdict (default 1)
//   SOAK_MODE    "waves" (default): the Crucible's own waves, which grow and bring new enemy kinds, so pools and per-kind
//                caches keep filling for many waves. "fixed": the wave director is held in its break and each round spawns
//                the same crowd (SOAK_CROWD, default 24, of SOAK_ROSTER, default "husk,trooper,brute"); pools fill in the first
//                round or two, so anything still growing after that is a leak. Use "fixed" to tell a leak from a pool.
//
// Each wave the bot kills whatever is alive every 250 ms, cycling a head shot, a blast that gibs and a sword cut, so ragdolls,
// severing, gibs, blood, decals and particles all run. The player cannot be hurt. Writes soak.json beside --out (every reading) and
// returns a short table, the verdict from tools/scripts/lib/glmem.mjs (`holds` is true when nothing is still growing) and
// `grew`: the textures and buffers that multiplied since the first judged round, grouped by size, which names what leaks.
// Waves get bigger, so a count that rises and then holds ("step") is a pool reaching its cap, not a leak.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as glmem from './lib/glmem.mjs';

export const before = page => glmem.inject(page);

export default async function (page, { sleep, outDir }) {
  const rounds = Number(process.env.SOAK_ROUNDS ?? 6);
  const settle = Number(process.env.SOAK_SETTLE ?? 5) * 1000;
  await page.waitForFunction(() => globalThis.__op2?.game?.state === 'playing' && globalThis.__op2.ctx.waves, null, { timeout: 120000 });
  await page.evaluate(hold => {
    globalThis.__op2.ctx.player.modifiers.invulnerable = true;
    if (hold) globalThis.__op2.ctx.waves.nextWaveIn = 1e9;
  }, process.env.SOAK_MODE === 'fixed');

  const state = () => page.evaluate(() => {
    const { ctx, game } = globalThis.__op2;
    const gore = ctx.gore?.stats?.() ?? {};
    return { state: game.state, wave: ctx.waves.wave, phase: ctx.waves.phase, alive: ctx.enemies.alive.length,
      ragdolls: gore.ragdolls ?? null, corpses: gore.corpses ?? null, limbs: gore.limbs ?? null,
      drawCalls: ctx.render.drawCalls?.() ?? null, triangles: ctx.render.triangles?.() ?? null };
  });
  /** Kills up to 6 of the living, each a different way. Returns how many it hit. */
  const cull = turn => page.evaluate(n => {
    const { ctx } = globalThis.__op2;
    ctx.player.modifiers.invulnerable = true;
    const kinds = [
      { amount: 9999, type: 'bullet', source: 'smg', region: 'head', force: 10 },
      { amount: 9999, type: 'explosive', source: 'rocket', force: 900, gib: true },
      { amount: 9999, type: 'slash', source: 'sword', region: 'armL', force: 60, severMult: 4 },
    ];
    let hit = 0;
    for (const e of [...ctx.enemies.alive].slice(0, 6)) {
      const dir = e.center.clone().sub(ctx.player.eye).normalize();
      ctx.enemies.applyDamage(e, { ...kinds[(n + hit) % kinds.length], point: e.center.clone(), dir });
      hit++;
    }
    return hit;
  }, turn);

  const samples = [];
  const table = [];
  let kills = 0;
  const read = async label => {
    const [s, game] = [await glmem.sample(page), await state()];
    samples.push(s);
    table.push(`${label}: wave ${game.wave}, kills ${kills} | GPU ${glmem.mb(s.gpuTotal)} (tex ${glmem.mb(s.gpuTexture)}, buf ${glmem.mb(s.gpuBuffer)}, rb ${glmem.mb(s.gpuRenderbuffer)})`
      + ` | objects tex ${s.nTexture} buf ${s.nBuffer} vao ${s.nVertexArray} fbo ${s.nFramebuffer} prog ${s.nProgram}`
      + ` | three geo ${s.threeGeometries} tex ${s.threeTextures} prog ${s.threePrograms} | heap ${glmem.mb(s.heap)} | corpses ${game.corpses} limbs ${game.limbs}`);
    return { ...s, ...game, kills, label };
  };

  const warm = 1 + Number(process.env.SOAK_WARM ?? 1); // the reading before any wave is warm-up too
  const fixed = process.env.SOAK_MODE === 'fixed';
  const crowd = Number(process.env.SOAK_CROWD ?? 24);
  const roster = (process.env.SOAK_ROSTER ?? 'husk,trooper,brute').split(',');
  /** Fixed mode: keeps the wave director in its break and puts the same crowd in a ring round the player. */
  const muster = () => page.evaluate(([n, kinds]) => {
    const { ctx } = globalThis.__op2;
    ctx.waves.nextWaveIn = 1e9;
    const V = ctx.player.position.constructor;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const angle = i / n * Math.PI * 2, reach = 7 + (i % 3) * 2;
      const p = new V(ctx.player.position.x + Math.cos(angle) * reach, ctx.player.position.y, ctx.player.position.z + Math.sin(angle) * reach);
      const snapped = p.clone();
      if (ctx.world.nav.nearest?.(p, 6, snapped)) p.copy(snapped);
      if (ctx.enemies.spawn(kinds[i % kinds.length], p)) made++;
    }
    return made;
  }, [crowd, roster]);
  const log = [await read('start')];
  let groupsAtBase = null;
  for (let round = 1; round <= rounds; round++) {
    if (fixed) {
      if (await muster() === 0) throw new Error('soak: fixed mode could not spawn anyone');
    } else {
      // Skip what is left of the break, then fight the wave until it clears.
      await page.evaluate(() => { const w = globalThis.__op2.ctx.waves; if (w.phase === 'intermission') w.nextWaveIn = Math.min(w.nextWaveIn, 0.2); });
      await page.waitForFunction(() => globalThis.__op2.ctx.waves.phase !== 'intermission' || globalThis.__op2.game.state !== 'playing', null, { timeout: 60000 });
    }
    for (let turn = 0, started = Date.now(); ; turn++) {
      const now = await state();
      if (now.state !== 'playing') {
        // A shop or a pause went up over the run: put the game back.
        await page.evaluate(() => globalThis.__op2.game.setState('playing')).catch(() => {});
      }
      if (fixed ? now.alive === 0 : now.phase === 'intermission') break;
      if (Date.now() - started > 180000) throw new Error(`soak: wave ${now.wave} did not clear in 180 s (${now.alive} alive, phase ${now.phase})`);
      kills += await cull(turn);
      await sleep(250);
    }
    await sleep(settle);
    log.push(await read(`after round ${round}`));
    if (samples.length === warm + 1) groupsAtBase = await glmem.groups(page);
  }

  const result = glmem.verdict(samples, { warm });
  // What grew since the first judged round, by the size of the thing: the group that keeps growing names the leak.
  const grew = groupsAtBase ? glmem.grown(groupsAtBase, await glmem.groups(page)).map(g =>
    `${g.kind}s of ${g.bytesEach >= 1048576 ? glmem.mb(g.bytesEach) : `${g.bytesEach} bytes`} each: ${g.was} -> ${g.now} (+${glmem.mb(g.grewBytes)})`) : [];
  const changed = Object.fromEntries(Object.entries(result.metrics).filter(([, m]) => m.verdict !== 'flat')
    .map(([name, m]) => [name, `${m.verdict}: ${/^(gpu|heap)/.test(name) ? `${glmem.mb(m.first)} -> ${glmem.mb(m.last)}` : `${m.first} -> ${m.last}`}`]));
  writeFileSync(join(outDir, 'soak.json'), JSON.stringify({ mode: fixed ? 'fixed' : 'waves', rounds, settleMs: settle, log, verdict: result, grew }, null, 2));
  return { mode: fixed ? `fixed: ${crowd} of ${roster.join(', ')} each round` : 'waves', rounds, kills, holds: result.holds, growing: result.growing, notFlat: changed, grew, table, json: join(outDir, 'soak.json') };
}
