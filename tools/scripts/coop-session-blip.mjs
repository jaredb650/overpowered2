// Session proof: a network blip is not the end. Mid-wave the link between host and guest goes silent for 8 s. The guest sees
// "Reconnecting to host…", nobody is dropped, and both are in the same match and wave afterwards with the guest's credits
// and gun unchanged. Then the guest's page itself freezes for 22 s (a closed lid, a long hitch): it is still in the match
// when it wakes, and the host says "lost connection" and "is back" rather than throwing it out. Last, the guest opens its
// menu and the tag over its body on the host's screen says so.
import { live, startParty } from './coop-kit.mjs';
import { SIM, blip, immortal, lineLog, linesAbout, proof, snap, stall, until, watchLine } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-blip', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM, out, progress, sleep });
    const guest = party.guest;
    await live(party);
    await immortal(party.pages);
    const before = { host: await snap(host), guest: await snap(guest) };
    check(before.guest.live && before.guest.enemies > 0, 'a live wave on the guest before the blip', before.guest);

    progress('link silent for 8 s');
    await watchLine(guest);
    await blip(party.pages, 8000, sleep);
    await sleep(1500);
    const lines = await lineLog(guest);
    const sawLine = lines.find(t => /^Reconnecting to host… \d+$/.test(t)) ?? '';
    check(!!sawLine, 'the guest showed "Reconnecting to host…" with its countdown', lines);
    const g = await until(guest, s => !s.reconnecting && !s.line && s.phase === 'open', 'the guest\'s link back', 30000);
    const h = await snap(host);
    check(g.match === before.guest.match && h.match === before.host.match, 'both in the same match', [g.match, h.match]);
    check(g.begun && g.state !== 'menu' && h.players.every(p => !p.state && !p.away), 'the guest still in the world, and the host lists it as in', h.players);
    check(g.credits === before.guest.credits && g.weapon === before.guest.weapon, 'the guest\'s credits and gun unchanged', [g.credits, g.weapon]);
    check(!h.chat.some(t => /lost connection|left\./.test(t)) && !g.chat.some(t => /lost connection|left\./.test(t)), 'nobody was announced as lost or gone', h.chat);
    const wave = h.wave;
    await until(guest, s => s.wave === wave && s.enemies > 0, 'the guest on the host\'s wave with its enemies again', 30000);
    out.reconnectLine = sawLine;

    progress('guest page frozen for 22 s');
    await stall(guest, 22000);
    const woke = await until(guest, s => s.phase === 'open' && !s.reconnecting && s.players.find(p => p.me) && !s.players.find(p => p.me).state, 'the guest in the match after its page woke', 40000);
    check(woke.match === before.guest.match && woke.begun, 'still the same match after the freeze', woke);
    const hostAfter = await until(host, s => s.players.every(p => !p.state && !p.away) && s.bodies === 1, 'the host listing the guest as in again', 30000);
    const about = linesAbout(hostAfter, 'GUEST-TWO');
    check(!about.includes('GUEST-TWO left.'), 'the host never said the guest left', about);
    out.afterFreeze = about;
    await until(guest, s => s.enemies > 0 || s.wave > wave, 'the guest still getting the world', 30000);

    progress('guest opens its menu');
    await guest.evaluate(() => window.__op2.ctx.hud.pause());
    await until(host, s => s.players.find(p => p.name === 'GUEST-TWO')?.idle === 'menu', 'the host knowing the guest is in a menu', 15000);
    await sleep(300);
    const tag = await host.evaluate(() => [...window.__op2.ctx.coop.remotes.values()][0]?.tagText ?? '');
    check(tag === 'GUEST-TWO · in a menu', 'the tag over the guest says "in a menu"', tag);
    await guest.evaluate(() => window.__op2.game.setState('playing'));
    await until(host, s => !s.players.find(p => p.name === 'GUEST-TWO')?.idle, 'and stops saying so when the guest is back', 15000);
    await shot(host, 'host-end');
  }, () => party);
};
