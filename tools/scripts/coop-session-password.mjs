// Session proof: other people's trouble is not yours, and one press is one lobby. A host is alone in its lobby (its first
// guest has left again). Someone opens the invite link and types the wrong password; while they are still trying, the
// friend joins by code with the right one, pressing Enter twice and Join as well, and gets in at once, listed once. The one
// with the typo is told "Wrong password", fixes it, and gets in too. Half a minute later everyone is still in, each once.
import { button, joinFromSplash, ownWindow, startParty } from './coop-kit.mjs';
import { SIM, proof, snap, until } from './coop-session-kit.mjs';

export default async (host, { sleep, outDir }) => {
  const { out, run, check, progress, shot } = proof('coop-session-password', outDir, sleep);
  let party = null;
  return run(async () => {
    party = await startParty(host, { mode: 'crucible', players: 2, net: SIM, out, progress, sleep, startNow: false });
    const friend = party.guest;
    const code = (await snap(host)).code;
    // The friend steps out, so they can be the one who joins while someone else fails.
    await button(friend, 'Leave').click();
    const gone = await until(host, s => s.players.length === 1, 'the host alone again', 20000);
    check(gone.chat.at(-1) === 'GUEST-TWO left.', 'a deliberate leave reads "left" at once', gone.chat);

    const typo = party.transport === 'loop' ? await ownWindow(host) : await host.context().browser().newPage({ viewport: host.viewportSize() });
    typo.on('pageerror', error => out.errors.push(`typo: ${error.message}`));
    await typo.addInitScript(() => { localStorage.setItem('op2.settings.v1', JSON.stringify({ quality: 0, music: 0 })); localStorage.setItem('op2.played.v1', '1'); });
    await typo.addInitScript(() => { if (!sessionStorage.getItem('named')) { localStorage.setItem('op2_coop_name', 'TYPO'); sessionStorage.setItem('named', '1'); } });
    party.guests.push(typo); party.pages.push(typo);
    await typo.goto(party.invite);
    await typo.locator('input[type=password]').waitFor({ state: 'visible', timeout: 300000 });

    progress('one player types the wrong password while the friend joins');
    await button(friend, 'Join a lobby').click();
    await friend.locator('.co-field input').first().fill(code);
    await friend.locator('input[type=password]').fill(party.password);
    await typo.locator('input[type=password]').fill('not-the-password');
    await button(typo, 'Join lobby').click();
    // Enter twice, and the menu's Join as well: one lobby.
    await friend.locator('input[type=password]').press('Enter');
    await friend.locator('input[type=password]').press('Enter').catch(() => {});
    await button(friend, 'Join').click({ timeout: 800 }).catch(() => {});
    const joined = await until(friend, s => s.phase === 'open' && s.players.length === 2, 'the friend in the lobby', 40000);
    check(joined.players.filter(p => p.me).length === 1 && joined.players.find(p => p.me).slot === 1, 'listed once, in their old seat', joined.players);
    const refused = await until(typo, s => /Wrong password/.test(s.err), 'the typo told "Wrong password"', 45000);
    check(refused.phase !== 'open', 'and not in the lobby', refused.phase);
    await shot(typo, 'wrong-password', true);
    const still = await snap(friend);
    check(still.phase === 'open' && still.error === null, 'the friend was not thrown out by it', still);
    const hostSees = await snap(host);
    check(hostSees.players.map(p => p.name).join() === 'HOST-ONE,GUEST-TWO', 'the host lists the friend and not the typo', hostSees.players);

    progress('the typo is fixed');
    await joinFromSplash(typo, party.password);
    await until(host, s => s.players.length === 3 && s.players.some(p => p.name === 'TYPO'), 'three in the lobby', 30000);
    // Half a minute on (a second, leaked lobby used to take the first one down by then): everyone still in, each once.
    await sleep(34000);
    for (const p of party.pages) {
      const s = await snap(p);
      check(s.phase === 'open' && s.players.length === 3 && new Set(s.players.map(x => x.name)).size === 3, `still three, each once, on ${s.players.find(x => x.me)?.name}`, s.players);
    }
    await shot(host, 'three-in-lobby', true);
  }, () => party);
};
