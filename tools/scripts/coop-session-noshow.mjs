// Session proof: a guest that never arrives. The host deploys, its world waits with a countdown that names the guest, and
// after LOAD_WAIT_MS (90 s) it starts without them and says so. When the guest's page finally loads it is told the match is
// already running, joins it in progress with the wave and its enemies, keeps its lobby slot, and is announced once.
import { startParty } from './coop-kit.mjs';
import { SIM, atGate, clickDeploy, immortal, linesAbout, proof, slowBoot, snap, until } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-noshow', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM, out, progress, sleep, startNow: false });
    const guest = party.guest;
    const release = await slowBoot(guest, 130000);
    await host.getByRole('button', { name: 'Start', exact: true }).click();
    const started = Date.now();
    await clickDeploy(host);
    await immortal(host);
    const first = await until(host, s => /Waiting for GUEST-TWO · starting without them in \d+ s/.test(s.line), 'the waiting line with its countdown', 20000);
    const firstLeft = Number(first.line.match(/in (\d+) s/)[1]);
    check(firstLeft > 60 && firstLeft <= 90, 'the countdown starts near ninety seconds', first.line);
    await sleep(40000);
    const mid = await snap(host);
    const midLeft = Number(mid.line.match(/in (\d+) s/)?.[1] ?? -1);
    check(mid.holding && mid.wave === 0 && mid.enemies === 0 && !mid.waveRunning, 'forty seconds on the world is still held', mid);
    check(midLeft > 0 && midLeft < firstLeft - 30, 'and the countdown has moved', [firstLeft, midLeft]);
    await shot(host, 'waiting');
    const live = await until(host, s => s.live && !s.line, 'the host starting without the guest, the waiting line gone', 70000);
    const waited = (Date.now() - started) / 1000;
    check(waited > 80 && waited < 115, 'it gave up after about ninety seconds', waited);
    check(live.chat.includes('Started without GUEST-TWO: not in yet. They join when they arrive.'), 'and named who it gave up on', live.chat);
    const fighting = await until(host, s => s.wave >= 1 && s.enemies > 0, 'the host fighting wave 1 alone', 40000);
    out.gaveUpAfter = waited;
    progress(`host started alone after ${waited.toFixed(0)} s; releasing the guest`);

    await release();
    const gate = await atGate(guest);
    check(/already running/.test(gate.gateText), 'the late guest is told the match is already running', gate.gateText);
    await clickDeploy(guest);
    const joined = await until(guest, s => s.live && s.enemies > 0 && s.wave >= fighting.wave && s.bodies === 1, 'the late guest in the running wave with the host\'s body', 40000);
    check(joined.players.find(p => p.me)?.slot === 1 && !joined.holding, 'in its lobby slot, nothing held', joined.players);
    const after = await until(host, s => s.chat.includes('GUEST-TWO joined.') && s.bodies === 1, 'the host seeing the guest arrive', 20000);
    check(JSON.stringify(linesAbout(after, 'GUEST-TWO').slice(-2)) === JSON.stringify(['Started without GUEST-TWO: not in yet. They join when they arrive.', 'GUEST-TWO joined.']),
      'announced exactly once', linesAbout(after, 'GUEST-TWO'));
    await shot(host, 'joined-host'); await shot(guest, 'joined-guest');
  }, () => party);
};
