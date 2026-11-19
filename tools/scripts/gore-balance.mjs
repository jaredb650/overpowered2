// Did the gore update make the game easier? One seeded bot plays the game's own waves on a frozen clock and the script
// counts what the two rules that change how enemies FIGHT did: the damage the player took ("a hit spoils his aim") and how
// soon squads lost their nerve (burning comrades chip morale).
//
//   BAL_LABEL=on node tools/shot.mjs --port <yours> --url "/?contract=crucible&autostart=1" --wait 0 --timeout 1500 --quiet \
//     --script tools/scripts/gore-balance.mjs --out tools/out/<you>/bal.png
//   BAL_LABEL=off ... --url "/?contract=crucible&autostart=1&aimspoil=0" ...
//
// The bot is the single-player comparison's fighter (tools/scripts/lib/solo-scenarios.mjs): it aims at the nearest enemy
// in sight, holds the trigger, walks a fixed pattern and dashes. It is healed to full when under a third (counted: a heal
// is about one death), its magazine is bottomless and it buys nothing, so the same fight is asked of every run.
//
// Settings: BAL_WAVES (stop when this wave is cleared: default 6; Endless Humans ends itself at round 10), BAL_FRAMES (cap,
// default 70000), BAL_SEED, BAL_WEAPON (give and hold this gun: `kiln` for the fire rule), BAL_EVAL (JS run in the page
// first: `nofear` zeroes the three morale costs of fire, to tell that rule from the rest), BAL_LABEL.
// Writes <outDir>/balance.<label>.json: per wave the frames it took, damage taken, heals, kills; and for men (Endless
// Humans) how many ever panicked or broke, and how many seconds after they were first seen.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as steady from './lib/steady.mjs';

const WAVES = Number(process.env.BAL_WAVES ?? 6);
const FRAMES = Number(process.env.BAL_FRAMES ?? 70000);
const SEED = Number(process.env.BAL_SEED ?? 1);
const LABEL = process.env.BAL_LABEL ?? 'run';

export const before = async page => {
  await steady.install(page, { seed: SEED });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('bal.set')) return;
    sessionStorage.setItem('bal.set', '1');
    localStorage.clear();
    localStorage.setItem('op2.settings.v1', JSON.stringify({ music: 0 }));
    localStorage.setItem('op2.played.v1', '1');
  });
  await page.route(/\/audio\/(voice|chatter)\//, route => route.abort());
};

async function install({ weapon, evalText, waves }) {
  const { ctx, game } = window.__op2;
  const p = ctx.player;
  if (evalText === 'nofear') {
    const m = await import('/src/enemies/outpost/morale.ts');
    m.FEAR.burning = 0;
    m.FEAR.pyre = 0;
    m.FEAR.burnedAlive = 0;
  } else if (evalText) await (0, eval)(`(async () => { ${evalText} })()`);
  ctx.weapons.modifiers.bottomlessMag = true;
  if (weapon && !ctx.weapons.owned.has(weapon)) ctx.weapons.give(weapon);
  if (weapon) ctx.weapons.switchTo(weapon);
  const rec = { waves: [], damage: 0, heals: 0, kills: 0, forced: 0, done: false, why: '', frame: 0, men: {}, deaths: {}, lastKill: 0, wave: null };
  const open = n => {
    rec.wave = { wave: n, from: rec.frame, frames: 0, damage: 0, heals: 0, kills: 0 };
  };
  ctx.events.on('player:damaged', ev => {
    rec.damage += ev.amount;
    if (rec.wave) rec.wave.damage += ev.amount;
  });
  ctx.events.on('enemy:killed', ev => {
    rec.kills++;
    rec.lastKill = rec.frame;
    if (rec.wave) rec.wave.kills++;
    const d = ev?.damage ?? {};
    const key = `${d.type ?? '?'}/${d.source ?? '?'}`;
    rec.deaths[key] = (rec.deaths[key] ?? 0) + 1;
  });
  ctx.events.on('wave:start', ev => open(ev.wave));
  ctx.events.on('wave:clear', ev => {
    if (rec.wave) {
      rec.wave.frames = rec.frame - rec.wave.from;
      rec.waves.push(rec.wave);
      rec.wave = null;
    }
    if (ev.wave >= waves) {
      rec.done = true;
      rec.why = `wave ${ev.wave} cleared`;
    }
  });
  if (ctx.waves?.phase && ctx.waves.phase !== 'intermission' && ctx.waves.wave) open(ctx.waves.wave);
  const bot = f => {
    if (rec.done) return;
    if (game.state === 'gameover' || game.state === 'victory') {
      rec.done = true;
      rec.why = game.state;
      return;
    }
    if (game.state !== 'playing') game.setState('playing');
    if (!p.alive) {
      rec.done = true;
      rec.why = 'died';
      return;
    }
    if (p.health < p.maxHealth * 0.35) {
      rec.heals++;
      if (rec.wave) rec.wave.heals++;
      p.heal(p.maxHealth);
    }
    const w = ctx.waves;
    if (w && w.phase === 'intermission') {
      rec.rest = (rec.rest || 0) + 1;
      if (rec.rest > 120 && w.nextWaveIn > 1) w.nextWaveIn = 1;
    } else rec.rest = 0;
    if (weapon && ctx.weapons.current !== weapon && f % 30 === 0) ctx.weapons.switchTo(weapon);
    let best = null;
    let bd = 1e9;
    let oldest = null;
    for (const e of ctx.enemies.alive) {
      const d = e.center.distanceToSquared(p.eye);
      if (d < bd && (e.hasLos || d < 144)) {
        best = e;
        bd = d;
      }
      if (!oldest || e.uid < oldest.uid) oldest = e;
    }
    // The Kiln reaches about a dozen metres: its bot walks at whoever it is after instead of pacing.
    const chase = weapon === 'kiln' && best && bd > 64;
    ctx.input.simulate('fire', !!best && (weapon !== 'kiln' || bd < 170));
    if (best) {
      const dx = best.center.x - p.eye.x, dy = best.center.y - p.eye.y, dz = best.center.z - p.eye.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    const leg = Math.floor(f / 90) % 4;
    ctx.input.simulate('left', !chase && leg === 0);
    ctx.input.simulate('back', !chase && leg === 1);
    ctx.input.simulate('right', !chase && leg === 2);
    ctx.input.simulate('forward', chase || leg === 3);
    ctx.input.simulate('dash', f % 240 === 200);
    // Nobody killed for 40 s of a wave: one hiding where the bot cannot see is put down, or the run never ends.
    if (w && w.phase !== 'intermission' && oldest && f - rec.lastKill > 2500) {
      ctx.enemies.applyDamage(oldest, { amount: 99999, type: 'true', point: oldest.center.clone(), dir: oldest.center.clone().sub(p.eye).normalize(), force: 0, source: 'smg' });
      rec.forced++;
      rec.lastKill = f;
    }
    // Men's nerve, twice a second: when each was first seen, and when he first panicked or broke.
    const soldiers = ctx.enemies.outpost?.soldiers;
    if (soldiers && f % 30 === 0) {
      for (const s of soldiers) {
        const uid = s.e?.uid ?? s.enemy?.uid ?? s.uid;
        if (uid === undefined) continue;
        const m = rec.men[uid] ?? (rec.men[uid] = { seen: f, panicked: -1, broken: -1, low: 100 });
        if (typeof s.morale === 'number' && s.morale < m.low) m.low = Math.round(s.morale);
        if (m.panicked < 0 && (s.state === 'panicked' || s.state === 'broken')) m.panicked = f;
        if (m.broken < 0 && s.state === 'broken') m.broken = f;
      }
    }
  };
  const inner = game.frame.bind(game);
  game.frame = (...a) => {
    bot(rec.frame);
    const out = inner(...a);
    rec.frame++;
    return out;
  };
  window.__bal = rec;
  return { wave: ctx.waves?.wave, phase: ctx.waves?.phase, outpost: !!ctx.enemies.outpost };
}

export default async function (page, { outDir }) {
  await steady.ready(page, { until: "window.__op2?.game?.state === 'playing'", timeout: 180000 });
  const setup = await page.evaluate(install, { weapon: process.env.BAL_WEAPON ?? null, evalText: process.env.BAL_EVAL ?? null, waves: WAVES });
  let state = null;
  const t0 = Date.now();
  for (let done = 0; done < FRAMES;) {
    await steady.frames(page, 300);
    done += 300;
    state = await page.evaluate(() => ({ done: window.__bal.done, why: window.__bal.why, frame: window.__bal.frame, waves: window.__bal.waves.length }));
    if (state.done) break;
  }
  const rec = await page.evaluate(() => window.__bal);
  const men = Object.values(rec.men);
  const secs = list => (list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length / 62.5 * 10) / 10 : null);
  const med = list => (list.length ? Math.round([...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] / 62.5 * 10) / 10 : null);
  const panicked = men.filter(m => m.panicked >= 0);
  const broken = men.filter(m => m.broken >= 0);
  const result = {
    label: LABEL, url: new URL(page.url()).search, seed: SEED, weapon: process.env.BAL_WEAPON ?? 'default', eval: process.env.BAL_EVAL ?? null, setup,
    ended: rec.why || 'frame cap', frames: rec.frame, gameSeconds: Math.round(rec.frame / 62.5), realSeconds: Math.round((Date.now() - t0) / 1000),
    wavesCleared: rec.waves.length, damage: Math.round(rec.damage), heals: rec.heals, kills: rec.kills, forced: rec.forced,
    damagePerMinute: Math.round(rec.damage / (rec.frame / 62.5 / 60)), deaths: rec.deaths,
    waves: rec.waves.map(w => ({ wave: w.wave, seconds: Math.round(w.frames / 62.5), damage: Math.round(w.damage), heals: w.heals, kills: w.kills })),
    men: men.length ? {
      seen: men.length, panicked: panicked.length, broken: broken.length,
      panickedShare: Math.round(panicked.length / men.length * 100) / 100, brokenShare: Math.round(broken.length / men.length * 100) / 100,
      secondsToPanicMean: secs(panicked.map(m => m.panicked - m.seen)), secondsToPanicMedian: med(panicked.map(m => m.panicked - m.seen)),
      secondsToBreakMean: secs(broken.map(m => m.broken - m.seen)), secondsToBreakMedian: med(broken.map(m => m.broken - m.seen)),
      lowestMoraleMean: Math.round(men.reduce((s, m) => s + m.low, 0) / men.length),
    } : null,
  };
  writeFileSync(join(outDir, `balance.${LABEL}.json`), JSON.stringify(result, null, 1));
  return result;
}
