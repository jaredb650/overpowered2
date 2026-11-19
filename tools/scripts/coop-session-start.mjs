// Session proof: the load barrier and the deploy gate, three players, one of them slow to load.
//
// The host and the fast guest stop at "Click to deploy" and click for real. Nobody lands in the pause menu. The host's world
// is held (no wave, no enemies) and every screen says who it is waiting for, by name, while the slow guest's map page has
// not even arrived. When that guest clicks, the world starts for all three. Slots are the ones each player had in the lobby,
// and nobody is announced as joined or left on the way.
import { startParty } from './coop-kit.mjs';
import { SIM, atGate, clickDeploy, proof, seats, slowBoot, snap, until } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-start', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: process.env.COOP_MODE ?? 'crucible', players: 3, net: SIM, out, progress, sleep, startNow: false });
    const [fast, slow] = party.guests;
    const lobby = await snap(host);
    check(lobby.players.length === 3, 'three players in the lobby', lobby.players);
    const lobbySeats = seats(lobby);
    // The third player's map page is held back 25 s: a slow connection.
    const release = await slowBoot(slow, 25000);
    await host.getByRole('button', { name: party.mode.label, exact: true }).click();
    await host.getByRole('button', { name: 'Start', exact: true }).click();
    progress('started; the slow guest is held back');

    await atGate(host); await atGate(fast);
    const gate = await snap(host);
    check(gate.state === 'menu' && !gate.begun && gate.wave === 0 && gate.enemies === 0, 'at the gate nothing has started on the host', gate);
    check(/GUEST-THREE/.test(gate.gateText) && /loading/.test(gate.gateText), 'the gate lists the slow guest as loading', gate.gateText);
    await shot(host, 'gate-host', true);

    const clicked = Date.now();
    await clickDeploy(host); await clickDeploy(fast);
    progress('host and fast guest clicked Deploy');
    // Ten seconds on: both are playing (walking the map), neither in the pause menu, and the world is still held.
    let worst = { pause: false };
    while (Date.now() - clicked < 10000) {
      for (const page of [host, fast]) { const s = await snap(page); if (s.pause || s.state !== 'playing') worst = s; }
      await sleep(400);
    }
    check(!worst.pause, 'nobody is in the pause menu in the first ten seconds after their deploy click', worst);
    const held = await snap(host), heldGuest = await snap(fast);
    check(held.holding && !held.live && held.wave === 0 && held.enemies === 0 && !held.waveRunning, 'the host holds its world: no wave, no enemies', held);
    check(/Waiting for GUEST-THREE/.test(held.line) && /Waiting for GUEST-THREE/.test(heldGuest.line), 'both screens say "Waiting for GUEST-THREE"', [held.line, heldGuest.line]);
    check(heldGuest.enemies === 0 && heldGuest.bodies >= 1, 'the fast guest is in the map with the host\'s body, and no enemies', heldGuest);
    check(held.time > 3, 'the host\'s clock runs meanwhile (the player can move)', held.time);
    await shot(host, 'waiting-host'); await shot(fast, 'waiting-guest');

    await release();
    progress('slow guest released');
    await clickDeploy(slow);
    const live = await until(host, s => s.live && s.waveRunning, 'the host\'s world live once all three are in', 30000);
    check(!/Waiting/.test(live.line), 'the waiting line is gone', live.line);
    for (const page of party.pages) {
      const s = await until(page, x => x.live && x.bodies === 2, 'live with both other bodies drawn', 60000);
      check(JSON.stringify(seats(s)) === JSON.stringify(lobbySeats), `slot and seat are the lobby's on ${s.players.find(p => p.me).name}`, [seats(s), lobbySeats]);
      check(s.players.every(p => !p.state && !p.away), 'everyone is listed as in', s.players);
      check(!s.chat.some(t => /joined|left|lost connection|is back/.test(t)), 'no join or leave lines for the players who started the match', s.chat);
    }
    // The wave the barrier held now comes, on every screen.
    for (const page of party.pages) await until(page, s => s.wave >= 1 && s.enemies > 0, 'wave 1 with enemies', 60000);
    out.waveAfter = (await snap(host)).wave;
    await shot(host, 'live-host'); await shot(slow, 'live-slow-guest');
  }, () => party);
};
