// Session fixes, proof 2: reloads and rejoins that used to lose the room (fix-session item 5; checklist C10, C11).
//
//   FIX_CASE=lobby     three players on the lobby page, between matches. A guest reloads: it is back in the lobby in its own
//                      seat by itself. The host reloads: the guests wait on "Reconnecting to host…", the host's lobby opens
//                      again on the same code with the same seats, and a match starts from it for all three.
//   FIX_CASE=defense   Outpost Defense. A guest deploys from its loadout screen, changes its kit, and reloads mid-match:
//                      the kit it left with is back and the loadout screen does not open again. A new player still gets it.
//   FIX_CASE=hostlate  three players mid-wave. The host reloads and its new page takes longer to arrive than the guests
//                      wait: they get the board, regroup under GUEST-TWO, and then the old host's page comes up hosting a
//                      new match for a team that has moved on. It gives way and joins their lobby as a guest: one room,
//                      one host, three players, and a match starts from it.
//
//   COOP_SIM='lag:120,jitter:40,loss:0.05' for the bad network, COOP_NET=rtc for real WebRTC (coop-session-kit.mjs).
//   node tools/shot.mjs --port 5510 --w 1280 --h 720 --wait 500 --timeout 900 \
//     --script tools/scripts/coop-fixsession-reload.mjs --out tools/out/coop/fix-session/reload.png
import { button, give, live, readyUp, startParty } from './coop-kit.mjs';
import { SIM, acceptLeave, atGate, clickDeploy, immortal, linesAbout, pressStart, proof, seats, snap, until } from './coop-session-kit.mjs';

const CASE = process.env.FIX_CASE ?? 'lobby';

const kitOf = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  const w = ctx.weapons;
  return { guns: [...w.owned].sort(), current: w.current, grenades: w.grenades, credits: ctx.contracts.wallet?.credits ?? null,
    loadout: !!document.querySelector('.scr-loadout') && getComputedStyle(document.querySelector('.scr-loadout')).display !== 'none' && document.querySelector('.scr-loadout').getClientRects().length > 0,
    seated: ctx.coop?.world?.team.seated ?? null, needLoadout: ctx.contracts.defense?.needLoadout ?? null };
});

async function lobbyCase(host, { out, check, progress, shot, sleep }, hold) {
  const party = hold.party = await startParty(host, { mode: 'crucible', players: 3, net: SIM, out, progress, sleep, startNow: false });
  const [a, b] = party.guests;
  acceptLeave(party.pages);
  const code = new URL(party.invite).searchParams.get('join');
  const before = await until(host, s => s.lobbyScreen && s.players.length === 3, 'three players in the lobby', 30000);
  const mine = seats(before);

  progress('a guest has cheats on: the lobby list tags them on every screen');
  const tags = page => page.evaluate(() => [...document.querySelectorAll('.scr-coop .co-player')].filter(row => row.querySelector('.co-cheats')).map(row => row.textContent));
  await b.evaluate(() => { window.__op2.ctx.hud.screens.screens.coop.lobby.setCheats(true); });
  for (const page of party.pages) {
    await page.waitForFunction(() => document.querySelectorAll('.scr-coop .co-cheats').length === 1, null, { timeout: 15000, polling: 200 });
    const rows = await tags(page);
    check(rows.length === 1 && /GUEST-THREE/.test(rows[0]) && /Cheats on/.test(rows[0]), 'the player with cheats on is tagged in the lobby list', rows);
  }
  await shot(host, 'cheats-tag', true);
  await b.evaluate(() => { window.__op2.ctx.hud.screens.screens.coop.lobby.setCheats(false); });
  await host.waitForFunction(() => document.querySelectorAll('.scr-coop .co-cheats').length === 0, null, { timeout: 15000, polling: 200 });

  progress('a guest reloads on the lobby page');
  await a.reload({ waitUntil: 'commit' });
  const lost = await until(host, s => s.players.find(p => p.name === 'GUEST-TWO')?.state === 'lost' || s.chat.includes('GUEST-TWO reconnected.'), 'the host keeping the reloading guest\'s seat', 30000);
  check(lost.players.length === 3, 'the seat is kept while the guest\'s page reloads', lost.players);
  const back = await until(a, s => s.lobbyScreen && s.phase === 'open' && s.hosting === false && s.players.length === 3, 'the guest back in the lobby by itself', 90000);
  check(back.code === code, 'on the same code, with nothing typed', [back.code, code]);
  check(sameSeats(seats(back), mine), 'every slot and seat as before the reload', [seats(back), mine]);
  check(/reloaded/.test(back.note), 'it is told why it is here', back.note);
  const told = await until(b, s => s.chat.includes('GUEST-TWO reconnected.'), 'the other guest told once', 20000);
  check(JSON.stringify(linesAbout(told, 'GUEST-TWO').slice(-2)) === JSON.stringify(['GUEST-TWO lost connection.', 'GUEST-TWO reconnected.']), 'told as lost connection, then reconnected', linesAbout(told, 'GUEST-TWO'));
  const hostSees = await until(host, s => s.players.length === 3 && s.players.every(p => !p.state && !p.away), 'the host listing all three as in the lobby', 20000);
  check(sameSeats(seats(hostSees), mine), 'the host has every seat as it was', seats(hostSees));
  await shot(a, 'guest-back', true);

  progress('the host reloads on the lobby page');
  const reloadAt = Date.now();
  await host.reload({ waitUntil: 'commit' });
  const waiting = await until(b, s => /Reconnecting to host… \d+/.test(s.status) || (s.phase === 'open' && !s.reconnecting && s.players.length === 3 && Date.now() > 0 && s.players.some(p => p.host)), 'the guest waiting for its host', 20000);
  out.guestStatusDuringHostReload = waiting.status;
  const again = await until(host, s => s.lobbyScreen && s.phase === 'open' && s.hosting === true && s.players.length === 3 && s.players.every(p => !p.state), 'the host\'s lobby open again with all three', 120000);
  out.hostBackAfter = (Date.now() - reloadAt) / 1000;
  check(again.code === code, 'on the same code', [again.code, code]);
  check(sameSeats(seats(again), mine), 'every slot and seat as before the host\'s reload', [seats(again), mine]);
  check(/reloaded/.test(again.note), 'the host is told its lobby is open again', again.note);
  for (const page of [a, b]) {
    const s = await until(page, x => x.lobbyScreen && x.phase === 'open' && !x.reconnecting && x.players.length === 3, 'the guest back with its host, never having left the lobby page', 30000);
    check(s.hosting === false && s.players.find(p => p.host)?.name === 'HOST-ONE', 'the same host is the host', s.players);
    check(sameSeats(seats(s), mine), 'the guest sees the same seats', seats(s));
  }
  await shot(host, 'host-back', true);

  progress('a match starts from the reopened lobby');
  for (const page of [a, b]) if (!(await snap(page)).players.find(p => p.me).ready) await readyUp(page);
  await pressStart(host);
  for (const page of party.pages) await atGate(page, 180000);
  for (const page of party.pages) await clickDeploy(page);
  for (const page of party.pages) {
    const s = await until(page, x => x.live && x.bodies === 2, 'in the match with both other bodies', 90000);
    check(sameSeats(seats(s), mine), 'seats kept into the match', seats(s));
  }
  await shot(host, 'playing');
}

async function defenseCase(host, { out, check, progress, shot, sleep }, hold) {
  const party = hold.party = await startParty(host, { mode: 'defense', players: 2, net: SIM, out, progress, sleep });
  const guest = party.guest;
  acceptLeave(party.pages);
  await live(party);
  await immortal(party.pages);
  const first = await kitOf(guest);
  check(first.seated === true && !first.loadout && first.needLoadout === false, 'the guest deployed from its loadout screen, once', first);

  progress('the guest changes its kit, then reloads mid-match');
  await give(guest, 'rocket');
  await guest.evaluate(() => { window.__op2.ctx.contracts.defense.credits = 777; });
  // The host keeps a guest's kit as the guest reports it, at most every two seconds.
  await host.waitForFunction(() => {
    const { world } = window.__op2.ctx.coop;
    return [...world.team.seats.values()].some(seat => seat.kit?.guns.some(g => g.weapon === 'rocket') && seat.purse?.credits === 777);
  }, null, { timeout: 30000, polling: 250 });
  const before = await kitOf(guest);
  await guest.reload({ waitUntil: 'commit' });
  await atGate(guest);
  await clickDeploy(guest);
  const settled = await until(guest, () => true, 'the reloaded page', 1000).then(() => guest.waitForFunction(() => window.__op2.ctx.coop?.world?.team.seated === true, null, { timeout: 40000, polling: 100 }));
  void settled;
  await sleep(2500);
  const after = await kitOf(guest);
  check(!after.loadout && after.needLoadout === false, 'the loadout screen does not open for a returning player', after);
  check(JSON.stringify(after.guns) === JSON.stringify(before.guns) && after.guns.includes('rocket'), 'the guns they left with are the guns they have', [before.guns, after.guns]);
  check(after.current === before.current && after.credits === 777, 'the gun in hand and the credits too', [after.current, after.credits]);
  const state = await snap(guest);
  check(state.state === 'playing' || state.state === 'paused', 'they are in the fight, not in a menu', state.state);
  await shot(guest, 'defense-back');
  const hostSees = await until(host, s => s.players.every(p => !p.state && !p.away) && s.bodies === 1, 'the host with the guest back in the world', 30000);
  check(hostSees.chat.includes('GUEST-TWO is back.'), 'announced as back', hostSees.chat.slice(-4));
}

async function hostLateCase(host, { out, check, progress, shot, sleep }, hold) {
  const party = hold.party = await startParty(host, { mode: 'crucible', players: 3, net: SIM, out, progress, sleep });
  const [a, b] = party.guests;
  acceptLeave(party.pages);
  await live(party);
  await immortal(party.pages);
  const code = new URL(party.invite).searchParams.get('join');

  progress('the host\'s page goes away, and comes back only after its guests have given it up and regrouped');
  // A reload whose new page takes longer to arrive than the guests wait: the tab leaves the game for a plain file of the
  // same site (its match handoff stays in the tab), and goes back to the match's address once the others have regrouped.
  const matchUrl = host.url();
  const reloadAt = Date.now();
  await host.goto(`${party.base}/audio/music/manifest.json`);
  for (const page of [a, b]) await until(page, x => /Reconnecting to host… \d+/.test(x.line), 'the guest showing "Reconnecting to host…"', 20000);
  for (const page of [a, b]) await until(page, x => x.lost === 'HOST LOST', 'the team board after the grace', 60000);
  const newHost = await until(a, s => s.lobbyScreen && s.hosting === true && s.phase === 'open' && s.players.length === 2, 'GUEST-TWO hosting the regrouped lobby with GUEST-THREE in it', 90000);
  out.regroupedAfter = (Date.now() - reloadAt) / 1000;
  check(newHost.code === code, 'the regrouped lobby is on the same code', [newHost.code, code]);
  await shot(a, 'regrouped', true);

  progress('the old host\'s page arrives');
  await host.goto(matchUrl, { waitUntil: 'commit' });
  // It boots as the host of a new match for its old roster, meets the regrouped lobby, gives way and joins it.
  const joined = await until(host, s => s.lobbyScreen && s.hosting === false && s.phase === 'open' && s.players.length === 3, 'the old host in the regrouped lobby, as a guest', 240000);
  out.oldHostJoinedAfter = (Date.now() - reloadAt) / 1000;
  check(joined.code === code, 'on the same code', joined.code);
  check(/regrouped while this page was away/.test(joined.note) && /GUEST-TWO is hosting now/.test(joined.note), 'it is told what happened and who hosts', joined.note);
  for (const page of [a, b]) {
    const s = await until(page, x => x.lobbyScreen && x.phase === 'open' && x.players.length === 3, 'three players in the one lobby', 30000);
    check(s.players.filter(p => p.host).length === 1 && s.players.find(p => p.host).name === 'GUEST-TWO', 'one host, the regroup\'s', s.players);
    check(!s.match, 'nobody was pulled into the old host\'s abandoned match', s.match);
  }
  const hostList = await snap(a);
  check(hostList.players.map(p => p.name).sort().join() === 'GUEST-THREE,GUEST-TWO,HOST-ONE', 'nobody is left out', hostList.players.map(p => p.name));
  await shot(host, 'old-host-joined', true); await shot(a, 'one-room', true);

  progress('a match starts from the one room, with all three');
  for (const page of [host, b]) if (!(await snap(page)).players.find(p => p.me).ready) await readyUp(page);
  await pressStart(a);
  for (const page of party.pages) await atGate(page, 180000);
  for (const page of party.pages) await clickDeploy(page);
  for (const page of party.pages) await until(page, s => s.live && s.bodies === 2, 'all three in the new match', 90000);
  await shot(a, 'playing-again');
}

/** The same players in the same slots and seats, in whatever order the page's list has them (the screen draws them by slot). */
const sameSeats = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof(`coop-fixsession-reload-${CASE}`, outDir, sleep);
  const hold = { party: null };
  const tools = { out, check, progress, shot, sleep };
  out.case = CASE;
  return run(async () => {
    if (CASE === 'lobby') await lobbyCase(host, tools, hold);
    else if (CASE === 'defense') await defenseCase(host, tools, hold);
    else if (CASE === 'hostlate') await hostLateCase(host, tools, hold);
    else throw new Error(`Unknown FIX_CASE ${CASE}`);
    void button;
  }, () => hold.party);
};
