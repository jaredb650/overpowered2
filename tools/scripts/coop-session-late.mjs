// Session proof: late joiners, and a match that ends while someone is still loading it.
//
// Two players are mid-wave when a third opens the invite link: the lobby sends them straight on to the match, they stop at
// the deploy gate ("already running"), and after the click they have the wave and its enemies. The others read exactly
// "is joining…" then "joined.". The host ends the match and starts another; this time the third's map page is slow, and the
// host ends that match while it is still loading: the third lands on the lobby page with everyone else, told why, never in
// a dead run.
import { button, live, openGuest, readyUp, startParty } from './coop-kit.mjs';
import { SIM, atGate, clickDeploy, endMatch, immortal, linesAbout, proof, slowBoot, snap, until } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-late', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM, out, progress, sleep });
    await live(party);
    await immortal(party.pages);
    const before = await snap(host);

    progress('a third player opens the invite link mid-wave');
    const pagesBefore = host.context().pages().length;
    // The lobby page sends a late joiner on at once, so the kit's wait for the lobby list may lose the race: that is the point.
    const opened = await openGuest(party, { name: 'GUEST-THREE', ready: false }).catch(() => null);
    const third = opened ?? host.context().pages()[pagesBefore];
    if (!party.guests.includes(third)) { party.guests.push(third); party.pages.push(third); }
    const gate = await atGate(third);
    check(gate.match === before.match && /already running/.test(gate.gateText), 'the late joiner is at the gate of the running match', gate.gateText);
    await clickDeploy(third);
    const joined = await until(third, s => s.live && s.enemies > 0 && s.bodies === 2 && s.wave >= 1, 'the late joiner in the wave with both bodies', 40000);
    check(joined.players.find(p => p.me)?.slot === 2, 'in the next free slot', joined.players);
    for (const page of [host, party.guest]) {
      const s = await until(page, x => x.chat.includes('GUEST-THREE joined.') && x.bodies === 2, 'the others seeing the late joiner', 20000);
      check(JSON.stringify(linesAbout(s, 'GUEST-THREE')) === JSON.stringify(['GUEST-THREE is joining…', 'GUEST-THREE joined.']), 'exactly "is joining…" then "joined."', linesAbout(s, 'GUEST-THREE'));
    }
    await shot(host, 'three-in');

    progress('next match: the third loads slowly and the host ends it meanwhile');
    await endMatch(host);
    for (const page of party.pages) await until(page, s => s.lobbyScreen && !s.coop && s.players.length === 3 && s.phase === 'open', 'back on the lobby page with three listed', 40000);
    const code = (await snap(host)).code;
    for (const guest of party.guests) await readyUp(guest);
    await slowBoot(third, 25000);
    await button(host, 'Start').click();
    await atGate(host, 240000); await atGate(party.guest, 240000);
    await clickDeploy(host);
    const waiting = await until(host, s => /Waiting for .*GUEST-THREE/.test(s.line), 'the host waiting for the slow third', 20000);
    check(waiting.players.find(p => p.name === 'GUEST-THREE')?.state === 'loading', 'listed as loading', waiting.players);
    await endMatch(host);
    for (const page of [host, party.guest]) await until(page, s => s.lobbyScreen && !s.coop && s.phase === 'open' && !s.match, 'the two who were in are back on the lobby page', 40000);
    const landed = await until(third, s => s.booted && s.lobbyScreen && !s.coop && !!s.note, 'the third on the lobby page once its map has loaded', 150000);
    check(/ended while you were loading/.test(landed.note), 'told the match ended while loading', landed.note);
    check(landed.state === 'menu' && landed.phase === 'open' && landed.players.length === 3 && !landed.match && !landed.gate, 'in the open lobby with everyone, not in a run', landed);
    check(landed.code === code, 'the same lobby code', [landed.code, code]);
    await shot(third, 'third-landed', true);
    const all = await until(host, s => s.players.length === 3 && s.players.every(p => !p.state && !p.away), 'the host listing all three in the lobby', 20000);
    check(all.phase === 'open', 'the room is ready for the next match', all.players);
  }, () => party);
};
