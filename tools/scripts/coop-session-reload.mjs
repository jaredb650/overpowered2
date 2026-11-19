// Session proof: a page reload during a match rejoins it and never becomes a solo run.
//
// Three players mid-wave. A guest presses reload: its new page stops at the deploy gate of the same match, and after the
// click it is back in its own seat (same slot, same colour), with the others told "lost connection" then "is back". At no
// point is it playing without a co-op session. Then the host reloads. Its page was the world, so it opens a new match of
// the same mode for the same players: the guests wait on "Reconnecting to host…", follow it to a fresh map page, and all
// three are in again with their seats.
import { live, startParty } from './coop-kit.mjs';
import { SIM, acceptLeave, atGate, clickDeploy, immortal, lineLog, linesAbout, proof, seats, snap, until, watchLine } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-reload', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 3, net: SIM, out, progress, sleep });
    const [a, b] = party.guests;
    acceptLeave(party.pages);
    await live(party);
    await immortal(party.pages);
    const before = await snap(host);
    const mine = seats(before);
    const match = before.match;

    progress('guest reloads mid-wave');
    let solo = null;
    let watch = true;
    const watching = (async () => { while (watch) { const s = await snap(a).catch(() => null); if (s?.booted && s.state === 'playing' && !s.coop) solo = s; await sleep(100); } })();
    await a.reload({ waitUntil: 'commit' });
    const lostOnHost = await until(host, s => s.players.find(p => p.name === 'GUEST-TWO')?.state !== '', 'the host keeping the reloading guest\'s seat', 20000);
    check(lostOnHost.players.length === 3 && lostOnHost.players.find(p => p.name === 'GUEST-TWO').slot === 1, 'the seat and slot are kept while the guest is away', lostOnHost.players);
    const gate = await atGate(a);
    check(gate.match === match && gate.live, 'the reloaded page is at the gate of the same, running match', [gate.match, match, gate.live]);
    await clickDeploy(a);
    watch = false; await watching;
    check(solo === null, 'the reloading guest was never playing without a co-op session', solo);
    const back = await until(a, s => s.live && s.bodies === 2 && s.enemies > 0, 'the guest back in the wave with both other bodies', 40000);
    check(JSON.stringify(seats(back)) === JSON.stringify(mine), 'every slot and seat as before the reload', [seats(back), mine]);
    const told = await until(b, s => s.chat.includes('GUEST-TWO is back.') && s.bodies === 2, 'the other guest seeing them return', 20000);
    check(JSON.stringify(linesAbout(told, 'GUEST-TWO')) === JSON.stringify(['GUEST-TWO lost connection.', 'GUEST-TWO is back.']), 'told once each: lost connection, is back', linesAbout(told, 'GUEST-TWO'));
    await shot(host, 'guest-back');

    progress('host reloads mid-wave');
    await watchLine(b);
    await host.reload({ waitUntil: 'commit' });
    // On the loopback transport the host's new page is back within a second or two, so the line may never get a frame;
    // whatever the guest did show is kept in the result. The proof of the line itself is coop-session-hostquit.
    out.guestLinesDuringHostReload = await lineLog(b).catch(() => []);
    // Everyone ends up at the gate of a new match, on the same room.
    for (const page of party.pages) await atGate(page, 180000);
    const again = await snap(host);
    check(again.match && again.match !== match && again.mode === 'crucible', 'the host is hosting a new match of the same mode', [again.match, match]);
    for (const page of party.pages) await clickDeploy(page);
    for (const page of party.pages) {
      const s = await until(page, x => x.live && x.bodies === 2 && x.match === again.match, 'in the new match with both other bodies', 60000);
      check(JSON.stringify(seats(s)) === JSON.stringify(mine), `seats kept through the host's reload on ${s.players.find(p => p.me).name}`, [seats(s), mine]);
    }
    await until(a, s => s.wave >= 1 && s.enemies > 0, 'a wave on the guest in the new match', 60000);
    await shot(host, 'host-back');
  }, () => party);
};
