// Session proof: the host is gone for good. Three players mid-wave; the host's tab closes. Both guests wait on "Reconnecting
// to host…" for the grace, then get the team board ("HOST LOST") with their numbers, then regroup by themselves in a new
// lobby on the same code and password: the lowest slot hosts, the other joins it. From there they start a match again.
import { button, live, readyUp, startParty } from './coop-kit.mjs';
import { SIM, acceptLeave, atGate, clickDeploy, immortal, pressStart, proof, snap, until } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-hostquit', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 3, net: SIM, out, progress, sleep });
    const [a, b] = party.guests;
    acceptLeave(party.pages);
    await live(party);
    await immortal(party.pages);
    const before = await snap(a);
    const code = new URL(party.invite).searchParams.get('join');
    check(before.wave >= 1 && before.bodies === 2, 'three players in a live wave', before);

    progress('the host\'s tab closes');
    const closed = Date.now();
    // Away to a plain file of the same site: the game page unloads, as a closed tab does.
    await host.goto(`${party.base}/audio/music/manifest.json`);
    for (const page of [a, b]) {
      const s = await until(page, x => /Reconnecting to host… \d+/.test(x.line), 'the guest showing "Reconnecting to host…"', 15000);
      check(s.phase === 'open' && s.begun, 'the room is still open during the grace', s);
    }
    await shot(a, 'reconnecting');
    for (const page of [a, b]) {
      const s = await until(page, x => x.lost === 'HOST LOST', 'the team board after the grace', 50000);
      check(/hosts? the new lobby|Regrouping in GUEST-TWO's lobby/.test(s.lostFoot) || s.lostFoot === '', 'the board says what happens next', s.lostFoot);
    }
    const boardAfter = (Date.now() - closed) / 1000;
    check(boardAfter > 25 && boardAfter < 50, 'the board came after the thirty-second grace', boardAfter);
    await shot(a, 'board'); await shot(b, 'board-other');
    const boardText = await a.evaluate(() => document.querySelector('.cs-lost')?.textContent ?? '');
    check(/GUEST-TWO/.test(boardText) && /GUEST-THREE/.test(boardText) && /KILLS/.test(boardText), 'the board lists the team with their numbers', boardText.slice(0, 300));

    const hostNow = await until(a, s => s.lobbyScreen && s.hosting === true && s.phase === 'open' && s.players.length === 2, 'GUEST-TWO hosting the new lobby with both in it', 60000);
    const guestNow = await until(b, s => s.lobbyScreen && s.hosting === false && s.phase === 'open' && s.players.length === 2, 'GUEST-THREE in that lobby', 60000);
    out.regroupedAfter = (Date.now() - closed) / 1000;
    check(hostNow.code === code && guestNow.code === code, 'on the same code', [hostNow.code, guestNow.code, code]);
    check(/hosting this lobby now/.test(hostNow.note) && /GUEST-TWO is hosting now/.test(guestNow.note), 'each is told who hosts', [hostNow.note, guestNow.note]);
    check(hostNow.players.map(p => p.name).join() === 'GUEST-TWO,GUEST-THREE' && hostNow.players[0].host, 'the lowest slot is the host', hostNow.players);
    check(out.regroupedAfter < 75, 'regrouped within the grace, the board and a few seconds', out.regroupedAfter);
    await shot(a, 'regrouped-host', true); await shot(b, 'regrouped-guest', true);

    progress('the regrouped lobby starts a match');
    await readyUp(b);
    await pressStart(a);
    for (const page of [a, b]) await atGate(page, 180000);
    for (const page of [a, b]) await clickDeploy(page);
    for (const page of [a, b]) await until(page, s => s.live && s.bodies === 1 && s.wave >= 1 && s.enemies > 0, 'a live wave in the regrouped room', 60000);
    await shot(a, 'playing-again');
    // shot.mjs takes its last picture of the first page.
    await host.goto(party.base).catch(() => {});
  }, () => party);
};
