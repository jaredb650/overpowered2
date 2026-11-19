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
//
// Each wave the bot kills whatever is alive every 250 ms, cycling a head shot, a blast that gibs and a sword cut, so ragdolls,
// severing, gibs, blood, decals and particles all run. The player cannot be hurt. Writes soak.json beside --out (every reading) and
// returns a short table plus the verdict from tools/scripts/lib/glmem.mjs: `holds` is true when nothing is still growing.
// Waves get bigger, so a count that rises and then holds ("step") is a pool reaching its cap, not a leak.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as glmem from './lib/glmem.mjs';

export const before = page => glmem.inject(page);

export default async function (page, { sleep, outDir }) {
  const rounds = Number(process.env.SOAK_ROUNDS ?? 6);
  const settle = Number(process.env.SOAK_SETTLE ?? 5) * 1000;
  await page.waitForFunction(() => globalThis.__op2?.game?.state === 'playing' && globalThis.__op2.ctx.waves, null, { timeout: 120000 });
  await page.evaluate(() => { globalThis.__op2.ctx.player.modifiers.invulnerable = true; });

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

  const log = [await read('start')];
  for (let round = 1; round <= rounds; round++) {
    // Skip what is left of the break, then fight the wave until it clears.
    await page.evaluate(() => { const w = globalThis.__op2.ctx.waves; if (w.phase === 'intermission') w.nextWaveIn = Math.min(w.nextWaveIn, 0.2); });
    await page.waitForFunction(() => globalThis.__op2.ctx.waves.phase !== 'intermission' || globalThis.__op2.game.state !== 'playing', null, { timeout: 60000 });
    for (let turn = 0, started = Date.now(); ; turn++) {
      const now = await state();
      if (now.state !== 'playing') {
        // A shop or a pause went up over the run: put the game back.
        await page.evaluate(() => globalThis.__op2.game.setState('playing')).catch(() => {});
      }
      if (now.phase === 'intermission') break;
      if (Date.now() - started > 180000) throw new Error(`soak: wave ${now.wave} did not clear in 180 s (${now.alive} alive, phase ${now.phase})`);
      kills += await cull(turn);
      await sleep(250);
    }
    await sleep(settle);
    log.push(await read(`after round ${round}`));
  }

  // The first reading is before any wave, so it counts as warm-up too.
  const result = glmem.verdict(samples, { warm: 1 + Number(process.env.SOAK_WARM ?? 1) });
  const changed = Object.fromEntries(Object.entries(result.metrics).filter(([, m]) => m.verdict !== 'flat')
    .map(([name, m]) => [name, `${m.verdict}: ${/^(gpu|heap)/.test(name) ? `${glmem.mb(m.first)} -> ${glmem.mb(m.last)}` : `${m.first} -> ${m.last}`}`]));
  writeFileSync(join(outDir, 'soak.json'), JSON.stringify({ rounds, settleMs: settle, log, verdict: result }, null, 2));
  return { rounds, kills, holds: result.holds, growing: result.growing, notFlat: changed, table, json: join(outDir, 'soak.json') };
}
