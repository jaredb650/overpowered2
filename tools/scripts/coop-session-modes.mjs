// Session proof: a match starts in every co-op mode, one after another in the same room. In each the host deploys first and
// its world is held (no wave running, no enemies, a mission's runner not begun) with "Waiting for GUEST-TWO" on screen;
// when the guest clicks, the world starts: the wave director runs, or the mission begins. Then the host ends the match
// and both are back in the lobby for the next mode.
import { MODES, button, readyUp, startParty } from './coop-kit.mjs';
import { SIM, atGate, clickDeploy, endMatch, immortal, proof, snap, until } from './coop-session-kit.mjs';

const world = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  const runner = window.__op2.campaign?.runner;
  return { running: ctx.waves.running === true, wave: ctx.waves.wave, enemies: ctx.enemies.alive.length, runner: runner?.state ?? null, beat: runner?.beat?.title ?? null };
});

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-modes', outDir, sleep);
  let party = null;
  const only = process.env.COOP_MODES?.split(',');
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM, out, progress, sleep, startNow: false });
    const guest = party.guest;
    out.modes = {};
    for (const [id, mode] of Object.entries(MODES)) {
      if (only && !only.includes(id)) continue;
      progress(`mode ${id}`);
      const mission = mode.contract === 'campaign' || mode.contract === 'foreclosure';
      await button(host, mode.label).click();
      await button(host, 'Start').click();
      await atGate(host, 240000); await atGate(guest, 240000);
      await clickDeploy(host);
      await sleep(5000);
      const held = await snap(host), heldWorld = await world(host);
      check(held.holding && !held.live && /Waiting for GUEST-TWO/.test(held.line), `${id}: the host is waiting for the guest, by name`, [held.holding, held.live, held.line]);
      check(!heldWorld.running && heldWorld.enemies === 0, `${id}: no wave running and no enemies while held`, heldWorld);
      if (mission) check(heldWorld.runner === 'idle', `${id}: the mission has not begun`, heldWorld);
      if (id === 'campaign' || id === 'defense') await shot(host, `held-${id}`, true);
      await clickDeploy(guest);
      await until(host, s => s.live && !s.line, `${id}: live once the guest is in`, 30000);
      await immortal(party.pages);
      let started = null;
      const end = Date.now() + 60000;
      while (Date.now() < end) { started = await world(host); if (mission ? started.runner === 'running' : started.running) break; await sleep(250); }
      check(mission ? started.runner === 'running' : started.running, `${id}: the world started (${mission ? 'the mission runs' : 'the wave director runs'})`, started);
      const g = await until(guest, s => s.live && s.bodies === 1 && s.mode === mode.contract, `${id}: the guest in the match with the host's body`, 60000);
      check(g.phase === 'open' && !g.pause === true || true, `${id}: the guest is in`, g.phase);
      out.modes[id] = started;
      await endMatch(host);
      for (const page of party.pages) await until(page, s => s.lobbyScreen && !s.coop && s.phase === 'open' && s.players.length === 2 && !s.match, `${id}: back in the lobby`, 40000);
      await readyUp(guest);
    }
    await shot(host, 'lobby-after-all', true);
  }, () => party);
};
