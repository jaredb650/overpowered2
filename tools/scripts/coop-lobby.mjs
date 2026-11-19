// Co-op lobby proof: what two players do in the lobby before any match. One hosts, one joins by the invite link; both are
// in the same room by its code; a rename, a chat line each way and the ready flag reach the other screen; the host is told who
// it is waiting for when the guest is not ready; and when the host leaves, the guest is told so and is out of the room.
// (A wrong password, a double join and a guest leaving are coop-session-password.mjs.)
//
// Rewritten on the kit in the last pass: the first version was two hand-made pages over the real relays that waited for a
// splash screen an invite link no longer shows, and it asserted nothing (it only took pictures).
//
//   node tools/shot.mjs --port <port> --w 1280 --h 720 --wait 500 --timeout 300 --script tools/scripts/coop-lobby.mjs --out tools/out/coop/<you>/lobby.png
//   COOP_NET=rtc for real WebRTC and the public relays; COOP_SIM=lag:120,jitter:40,loss:0.05 for a bad network.
import { button, startParty } from './coop-kit.mjs';
import { SIM, proof, snap, until } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-lobby', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM, out, progress, sleep, startNow: false });
    const guest = party.guest;
    const h = await until(host, s => s.players.length === 2 && s.players.every(p => p.host || p.ready), 'the host lists the guest as ready', 30000);
    const g = await snap(guest);
    out.start = { host: h.players, guest: g.players, code: h.code };
    check(/^[A-Z0-9]{6}$/.test(h.code) && g.code === h.code, 'Both pages are in the same room, by its code', [h.code, g.code]);
    check(party.invite.includes(h.code), 'The invite link carries the code', party.invite);
    check(h.players.map(p => p.name).join() === 'HOST-ONE,GUEST-TWO' && g.players.map(p => p.name).join() === 'HOST-ONE,GUEST-TWO', 'Both list the same two players, host first', [h.players, g.players]);
    check(g.players.find(p => p.me)?.name === 'GUEST-TWO' && h.players.find(p => p.me)?.host, 'Each page knows which player it is', [h.players, g.players]);
    await shot(host, 'host-lobby', true);

    progress('a rename, chat both ways');
    const name = guest.locator('.co-field input').first();
    await name.fill('GUEST-7'); await name.press('Enter');
    const renamed = await until(host, s => s.players.some(p => p.name === 'GUEST-7'), 'the host sees the new callsign', 20000);
    check(!renamed.players.some(p => p.name === 'GUEST-TWO') && renamed.players.length === 2, 'A rename replaces the name on the host: no second player appears', renamed.players);
    await guest.locator('.co-chat + .co-input').fill('hello from the guest'); await guest.keyboard.press('Enter');
    await host.locator('.co-chat + .co-input').fill('welcome in'); await host.keyboard.press('Enter');
    const hostChat = await until(host, s => s.chat.some(t => t.includes('hello from the guest')), "the guest's line on the host", 20000);
    const guestChat = await until(guest, s => s.chat.some(t => t.includes('welcome in')), "the host's line on the guest", 20000);
    check(hostChat.chat.filter(t => t.includes('hello from the guest')).length === 1 && guestChat.chat.filter(t => t.includes('welcome in')).length === 1, 'Each chat line arrives once on the other screen', [hostChat.chat, guestChat.chat]);
    check(guestChat.chat.filter(t => t.includes('hello from the guest')).length === 1, 'The sender sees their own line once', guestChat.chat);

    progress('ready off and on');
    await guest.locator('.co-readybtn.on').click();
    const waiting = await until(host, s => s.players.some(p => !p.host && !p.ready), 'the host sees the guest not ready', 20000);
    const guide = await host.evaluate(() => document.querySelector('.co-guide')?.textContent ?? '');
    check(/Waiting for GUEST-7 to ready up/.test(guide), 'The host is told who it is waiting for', guide);
    check(waiting.phase === 'open' && waiting.match === null, 'Nothing has started');
    await guest.locator('.co-readybtn:not(.on)').click();
    await until(host, s => s.players.every(p => p.host || p.ready), 'the host sees the guest ready again', 20000);
    check(/Everyone is ready/.test(await host.evaluate(() => document.querySelector('.co-guide')?.textContent ?? '')), 'With the guest ready the host reads "Everyone is ready"');
    await shot(guest, 'guest-lobby', true);

    progress('the host leaves');
    await button(host, 'Leave').click();
    const left = await until(guest, s => s.phase !== 'open' || s.players.length < 2, 'the guest out of the room', 30000);
    await sleep(600);
    const told = await snap(guest);
    out.hostLeft = { phase: told.phase, error: told.error, err: told.err, note: told.note, status: told.status };
    check(told.phase !== 'open', 'When the host leaves the guest is out of the room at once (a deliberate leave has no grace)', out.hostLeft);
    check(/host/i.test(`${told.err} ${told.note} ${told.status} ${told.error}`), 'and is told the host left', out.hostLeft);
    check(told.state === 'menu' && told.lobbyScreen, 'They are on the multiplayer screen, not in a match or a blank page', [told.state, told.lobbyScreen]);
    await shot(guest, 'guest-host-left', true);
    void left;
  }, () => party);
};
