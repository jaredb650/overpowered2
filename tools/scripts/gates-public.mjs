// Proves, on a **production build**, that the test-only switches cannot be reached from the public site, and that the two
// switches a player may use (`?netsim=`, `?dev=1`) behave as documented. docs/notes/coop.md, "Testing".
//
// The game takes a page for "ours" (a dev build, or served from this computer) by its host name: localhost, 127.0.0.1 or
// [::1]. So one built `dist/` served on two addresses gives both cases, with no hosts file and no network:
//
//   npm run build
//   python3 -m http.server 5475 --bind 127.0.0.2 -d dist &     # a public address as far as the game can tell
//   python3 -m http.server 5476 --bind 127.0.0.1 -d dist &     # this computer: the switches are allowed (the control)
//   GATES=public node tools/shot.mjs --port 5475 --url "http://127.0.0.2:5475/" --wait 0 --timeout 240 --script tools/scripts/gates-public.mjs --out tools/out/<you>/gates-public.png
//   GATES=local  node tools/shot.mjs --port 5476 --url "http://127.0.0.1:5476/" --wait 0 --timeout 240 --script tools/scripts/gates-public.mjs --out tools/out/<you>/gates-local.png
//
// (--port only keeps shot.mjs off the owner's 5173: nothing is started on it when --url is a full address that answers.)
// GATES=public expects every test switch off; GATES=local expects them on, which shows the checks can see them.
// Checked: the loopback transport (`?net=loop`: the one-tab rule still applies, and an opened lobby says which transport it
// is on), proof mode (`window.__op2Proof`: every frame is still drawn), the pretend pointer lock and the silenced audio (the
// test kit's own page scripts: nothing in the bundle), `?netsim=` (allowed everywhere), `?dev=1` (the lab loads) and no `dev`
// (the lab is never downloaded).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const expectPublic = (process.env.GATES ?? 'public') !== 'local';

/** As the test kit asks for fast mode (coop-kit.mjs `proofSwitch`): no frame drawn, the loop on a timer. */
export const before = async page => {
  await page.addInitScript(() => {
    window.__op2Proof = { draw: 0, clock: 60 };
    try { localStorage.setItem('op2.played.v1', '1'); localStorage.setItem('op2.settings.v1', JSON.stringify({ music: 0 })); } catch { /* storage off */ }
  });
};

export default async function (page, { sleep, outDir }) {
  const origin = new URL(page.url()).origin;
  const out = { origin, expect: expectPublic ? 'public: every test switch off' : 'this computer: test switches allowed', checks: [], failed: [] };
  const check = (ok, text, detail) => { (ok ? out.checks : out.failed).push(detail === undefined ? text : `${text} :: ${JSON.stringify(detail)}`); };
  const playing = p => p.waitForFunction(() => window.__op2?.game?.state === 'playing', null, { timeout: 120000 });

  // 1. A solo run asked for on the loopback transport, in proof mode.
  await page.goto(`${origin}/?net=loop&netsim=lag:80,jitter:30&contract=crucible&autostart=1`, { waitUntil: 'load', timeout: 60000 });
  await playing(page);
  const drawn = await page.evaluate(() => new Promise(done => {
    const { ctx, game } = window.__op2;
    const render = ctx.render.render.bind(ctx.render);
    let frames = 0;
    ctx.render.render = (...a) => { frames++; return render(...a); };
    const from = ctx.time.frame;
    setTimeout(() => done({ drawn: frames, stepped: ctx.time.frame - from, proof: window.__op2.proof !== undefined, gate: game.proof != null }), 2000);
  }));
  if (expectPublic) {
    check(!drawn.proof && !drawn.gate, 'proof mode: window.__op2Proof is ignored (no draw gate on the game)', drawn);
    check(drawn.drawn >= drawn.stepped - 2 && drawn.drawn > 20, 'proof mode: every frame is drawn', drawn);
  } else {
    check(drawn.proof && drawn.gate, 'control: proof mode is on here', drawn);
    check(drawn.drawn === 0 && drawn.stepped > 20, 'control: no frame is drawn while the loop runs', drawn);
  }
  const lock = await page.evaluate(() => ({
    kit: typeof window.__coopLock, audio: typeof window.__coopAudio,
    native: /\[native code\]/.test(String(Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement')?.get)),
    request: /\[native code\]/.test(String(Element.prototype.requestPointerLock)),
  }));
  check(lock.kit === 'undefined' && lock.audio === 'undefined' && lock.native && lock.request, "the pointer lock and the audio are the browser's own (the pretend lock and the silence are the test kit's page scripts)", lock);
  // The lab is there when its own elements are (its hint line, its panel): the build does not name its file "lab".
  const lab = () => page.evaluate(() => ({ chunk: performance.getEntriesByType('resource').some(r => /\/assets\/lab-/.test(r.name)), hint: !!document.querySelector('.lab-hint, .lab-panel, [class^="lab-"]') }));
  const noLab = await lab();
  check(!noLab.chunk && !noLab.hint, 'without ?dev=1 the lab is never downloaded', noLab);

  // 2. A second tab on the same address: the one-tab rule is skipped only on the loopback transport.
  const second = await page.context().newPage();
  await second.addInitScript(() => { try { localStorage.setItem('op2.played.v1', '1'); } catch { /* storage off */ } });
  await second.goto(`${origin}/?net=loop&contract=crucible&autostart=1`, { waitUntil: 'load', timeout: 60000 });
  await sleep(6000);
  const tab = await second.evaluate(() => ({ notice: /already open in another tab/i.test(document.body.textContent ?? ''), booted: !!window.__op2 }));
  if (expectPublic) check(tab.notice && !tab.booted, '?net=loop is ignored: a second tab is held by the one-tab rule', tab);
  else check(!tab.notice && tab.booted, 'control: on the loopback transport a second tab runs', tab);
  await second.close();

  // 3. ?dev=1 is the one switch the public site keeps: the lab loads.
  await page.goto(`${origin}/?dev=1&contract=crucible&autostart=1`, { waitUntil: 'load', timeout: 60000 });
  await playing(page);
  await sleep(1500);
  const withLab = await lab();
  check(withLab.chunk || withLab.hint, '?dev=1 loads the lab, as documented', withLab);
  await page.goto(`${origin}/?dev=0&contract=crucible&autostart=1`, { waitUntil: 'load', timeout: 60000 });
  await playing(page);
  await sleep(1000);
  const dev0 = await lab();
  check(!dev0.chunk && !dev0.hint, '?dev=0 does not', dev0);

  // 4. A lobby opened with ?net=loop says which transport it is really on, and ?netsim= is honoured.
  await page.goto(`${origin}/?net=loop&netsim=lag:80,jitter:30`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__op2?.ctx?.render, null, { timeout: 120000 });
  let net = null;
  try {
    // The page has not been clicked: the menu is driven through the DOM, not the mouse (no pointer lock is asked for).
    const press = name => page.evaluate(n => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === n); if (!b) throw new Error(`no button "${n}"`); b.click(); }, name);
    await page.locator('.scr-splash').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('.scr-splash').click();
    await sleep(400);
    for (const name of ['Play', 'Multiplayer', 'Host a lobby']) { await page.getByRole('button', { name, exact: true }).click(); await sleep(250); }
    await page.locator('input[type=password]').fill('gates');
    await press('Open lobby');
    await page.waitForFunction(() => !!window.__op2?.net, null, { timeout: 30000 });
    net = await page.evaluate(() => ({ transport: window.__op2.net.transport, sim: window.__op2.net.sim.get() }));
  } catch (e) {
    out.failed.push(`the lobby could not be opened to read its transport: ${String(e.message ?? e).slice(0, 160)}`);
  }
  if (net) {
    check(net.transport === (expectPublic ? 'rtc' : 'loop'), expectPublic ? "?net=loop is ignored: the lobby is on the real transport ('rtc')" : "control: the lobby is on the loopback transport ('loop')", net.transport);
    check(net.sim.lag === 80 && net.sim.jitter === 30, '?netsim= is honoured, as documented', net.sim);
  }
  await page.screenshot({ path: join(outDir, `gates-${expectPublic ? 'public' : 'local'}-lobby.png`) }).catch(() => {});

  // 5. The bundle itself: the kit's page scripts are not in it.
  const dist = resolve('dist/assets');
  let kitWords = [];
  try {
    for (const file of readdirSync(dist)) if (file.endsWith('.js')) { const text = readFileSync(join(dist, file), 'utf8'); for (const word of ['__coopLock', '__coopAudio', '__coopHarness', '__coopHide']) if (text.includes(word)) kitWords.push(`${file}: ${word}`); }
    check(kitWords.length === 0, 'the built scripts hold none of the test kit\'s page switches', kitWords);
  } catch { out.checks.push('(dist/assets not found beside the tool: the bundle was not read)'); }
  out.ok = out.failed.length === 0;
  return out;
}
