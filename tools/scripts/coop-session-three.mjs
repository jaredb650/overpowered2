// Session proof: three matches in a row in one room, three players, and the third guest's page hitches for 3 s at every
// start (the case that used to throw a fast guest out from the second match on). Everyone reaches every match with the
// seat they had in the lobby, the host's mode pick is still the one just played after each match, and the room and its
// code never change.
import { button, readyUp, startParty } from './coop-kit.mjs';
import { SIM, atGate, clickDeploy, endMatch, immortal, proof, seats, snap, stall, until } from './coop-session-kit.mjs';

const ROUNDS = [
  { label: 'Crucible mode', mode: 'crucible', map: undefined },
  { label: 'Office — Endless Humans mode', mode: 'outpost', map: 'office' },
  { label: 'Crucible mode', mode: 'crucible', map: undefined },
];

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-three', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 3, net: SIM, out, progress, sleep, startNow: false });
    const [fast, hitchy] = party.guests;
    const lobby = await snap(host);
    const mine = seats(lobby);
    const code = lobby.code;
    const matches = [];
    for (const [i, round] of ROUNDS.entries()) {
      progress(`match ${i + 1}: ${round.label}`);
      await button(host, round.label).click();
      await button(host, 'Start').click();
      // The countdown is five seconds: the hitch lands on the start itself.
      await sleep(4300);
      await stall(hitchy, 3000);
      for (const page of party.pages) await atGate(page, 240000);
      for (const page of party.pages) await clickDeploy(page);
      for (const page of party.pages) {
        const s = await until(page, x => x.live && x.bodies === 2, `match ${i + 1} live with both other bodies`, 90000);
        check(s.mode === round.mode && s.phase === 'open', `match ${i + 1}: in ${round.mode}`, [s.mode, s.phase, s.error]);
        check(JSON.stringify(seats(s)) === JSON.stringify(mine), `match ${i + 1}: seats are the lobby's on ${s.players.find(p => p.me).name}`, [seats(s), mine]);
      }
      await immortal(party.pages);
      const playing = await until(fast, s => s.wave >= 1 && s.enemies > 0, `match ${i + 1}: a wave on a guest`, 90000);
      check(!matches.includes(playing.match), `match ${i + 1} is a new match`, [playing.match, matches]);
      matches.push(playing.match);
      if (i === 1) await shot(host, 'second-match');
      await endMatch(host);
      for (const page of party.pages) {
        const s = await until(page, x => x.lobbyScreen && !x.coop && x.phase === 'open' && x.players.length === 3 && !x.match, `after match ${i + 1}: back in the lobby`, 40000);
        check(s.code === code && JSON.stringify(seats(s)) === JSON.stringify(mine), `after match ${i + 1}: the same code and seats`, [s.code, seats(s)]);
        check(s.players.every(p => !p.state && !p.away), `after match ${i + 1}: everyone listed as in the lobby`, s.players);
      }
      const back = await snap(host);
      check(back.pick?.mode === round.mode && back.pick?.map === round.map, `after match ${i + 1}: the host's picker is still on the mode just played`, back.pick);
      const picked = await host.evaluate(() => document.querySelector('.co-mode.on')?.textContent ?? '');
      check(picked === round.label, `after match ${i + 1}: and its button is the lit one`, picked);
      for (const guest of party.guests) await readyUp(guest);
    }
    out.matches = matches;
    await shot(host, 'lobby-after-three', true);
  }, () => party);
};
