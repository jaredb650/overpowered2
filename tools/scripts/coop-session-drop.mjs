// Session proof, real WebRTC only (COOP_NET=rtc): a dropped connection comes back by itself. Mid-wave the guest's peer
// connections are closed under it, as a network change does. The guest waits on "Reconnecting to host…", the host keeps
// the seat ("lost connection"), the transport finds the peer again, and the same page is back in the same match in its own
// seat ("is back") with its credits and gun, inside the thirty-second grace.
import { live, startParty } from './coop-kit.mjs';
import { SIM, immortal, lineLog, linesAbout, proof, seats, snap, until, watchLine } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-drop', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM, out, progress, sleep, transport: 'rtc' });
    const guest = party.guest;
    await live(party);
    await immortal(party.pages);
    const before = { host: await snap(host), guest: await snap(guest) };
    const mine = seats(before.host);
    await watchLine(guest);

    progress('the guest\'s peer connections are closed under it');
    const cut = Date.now();
    const closed = await guest.evaluate(() => { let n = 0; for (const pc of window.__coopPeers ?? []) if (pc.connectionState !== 'closed') { pc.close(); n++; } return n; });
    check(closed >= 1, 'a live peer connection was cut', closed);
    const lost = await until(host, s => s.players.find(p => p.name === 'GUEST-TWO')?.state === 'lost', 'the host keeping the lost guest\'s seat', 30000);
    check(lost.players.length === 2 && lost.chat.at(-1) === 'GUEST-TWO lost connection.', 'the host says "lost connection" and keeps the row', lost.chat);
    out.hostNoticedAfter = (Date.now() - cut) / 1000;
    const back = await until(host, s => s.players.every(p => !p.state && !p.away) && s.bodies === 1, 'the guest back in the world on the host', 45000);
    out.backAfter = (Date.now() - cut) / 1000;
    check(JSON.stringify(seats(back)) === JSON.stringify(mine), 'in its own seat and slot', [seats(back), mine]);
    check(JSON.stringify(linesAbout(back, 'GUEST-TWO').slice(-2)) === JSON.stringify(['GUEST-TWO lost connection.', 'GUEST-TWO is back.']), 'told as lost connection, then is back', linesAbout(back, 'GUEST-TWO'));
    const g = await until(guest, s => !s.reconnecting && s.phase === 'open' && !s.players.find(p => p.me)?.state, 'the guest\'s link back', 20000);
    check(g.match === before.guest.match && g.begun && g.url === before.guest.url, 'the same page in the same match (no reload)', [g.match, g.url]);
    check(g.credits === before.guest.credits && g.weapon === before.guest.weapon, 'credits and gun unchanged', [g.credits, g.weapon]);
    const lines = await lineLog(guest);
    check(lines.some(t => /^Reconnecting to host… \d+$/.test(t)), 'the guest showed "Reconnecting to host…" meanwhile', lines);
    const wave = (await snap(host)).wave;
    await until(guest, s => s.wave === wave && s.enemies > 0 && s.bodies === 1, 'the guest getting the world again', 30000);
    await shot(host, 'back');
  }, () => party);
};
