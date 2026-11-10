// The soundtrack in the real game: both manifests merged on this machine, the game's own tracks alone when the
// placeholder list is emptied (which is what the public build does), the order, the level at the deck, and the track
// name on screen.
//
//   node tools/shot.mjs --url "/" --script tools/scripts/music-live.mjs --out tools/out/music/live.png --dpr 2 --w 1440 --h 900 --wait 1000 --timeout 170 --quiet
//
// Writes tools/out/music/live.json and three screenshots. ML_PHASES=local,public,flag picks which parts run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PHASES = (process.env.ML_PHASES ?? 'local,public,flag').split(',');

/** Runs in the page: waits for the splash, and starts recording what plays. The first real click starts the music. */
async function start() {
  const until = async (test, ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const v = test();
      if (v) return v;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  };
  const op = await until(() => (window.__op2?.ctx?.audio?.musicForTests && window.__op2.ctx.hud?.screens?.name === 'splash' ? window.__op2 : null), 90000);
  if (!op) return { error: 'the splash or the music player never appeared' };
  const { ctx } = op;
  const player = ctx.audio.musicForTests;
  window.__tracks = [];
  ctx.events.on('music:track', e => window.__tracks.push({ ...e }));
  await until(() => player.counts, 15000);
  return { counts: player.counts, playingBeforeTheClick: player.current.title };
}

/** Runs in the page: what the live deck is doing now, with its level read from the graph. */
async function sample(seconds) {
  const { ctx } = window.__op2;
  const player = ctx.audio.musicForTests;
  const ac = ctx.audio.contextForTests;
  const end = performance.now() + 12000;
  while (performance.now() < end && !(player.current.title && !player.current.paused && player.current.time > 0.2)) await new Promise(r => setTimeout(r, 100));
  const deck = player.decks[player.active];
  const tap = ac.createAnalyser();
  tap.fftSize = 2048;
  deck.gain.connect(tap);
  const data = new Float32Array(tap.fftSize);
  const t0 = deck.el.currentTime;
  let peak = 0;
  let sum = 0;
  let n = 0;
  const stop = performance.now() + seconds * 1000;
  while (performance.now() < stop) {
    tap.getFloatTimeDomainData(data);
    for (const v of data) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      n++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  deck.gain.disconnect(tap);
  return {
    ...player.current,
    src: deck.el.currentSrc.replace(location.origin, ''),
    duration: deck.el.duration,
    advanced: deck.el.currentTime - t0,
    readyState: deck.el.readyState,
    peak: Number(peak.toFixed(3)),
    rmsDb: n ? Number((10 * Math.log10(sum / n + 1e-12)).toFixed(1)) : null,
    context: ac.state,
    chip: document.querySelector('.np')?.textContent ?? null,
    chipOpacity: document.querySelector('.np') ? getComputedStyle(document.querySelector('.np')).opacity : null,
  };
}

/** Runs in the page: skips to the next track `count` times and lists what came up. */
async function sequence({ state, count }) {
  const { ctx } = window.__op2;
  const player = ctx.audio.musicForTests;
  ctx.audio.music(state);
  await new Promise(r => setTimeout(r, 400));
  const played = [];
  for (let i = 0; i < count; i++) {
    const c = player.current;
    played.push(c.title ? { title: c.title, original: c.original, file: c.file } : null);
    if (!c.title) break;
    player.advance(0.05);
    await new Promise(r => setTimeout(r, 250));
  }
  return played;
}

const check = (played) => {
  const real = played.filter(Boolean);
  let repeats = 0;
  for (let i = 1; i < real.length; i++) if (real[i].file === real[i - 1].file) repeats++;
  return { tracks: real.length, originals: real.filter(t => t.original).length, placeholders: real.filter(t => !t.original).length, immediateRepeats: repeats, order: real.map(t => `${t.original ? 'OST' : 'local'}: ${t.title}`) };
};

export default async function run(page, { sleep, shot, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const report = {};
  const requested = [];
  page.on('request', r => {
    const u = r.url();
    if (/\/audio\/(music|ost)\//.test(u)) requested.push(u.replace(/^https?:\/\/[^/]+/, ''));
  });

  if (PHASES.includes('local')) {
    // The page is already loaded with everything this machine has.
    const boot = await page.evaluate(start);
    report.local = { ...boot };
    if (!boot.error) {
      // The splash takes the first click. After it the menu is up and the name of the track is over it.
      await page.mouse.click(720, 450);
      await sleep(900);
      report.local.first = await page.evaluate(sample, 2.5);
      await shot('local-menu');
      report.local.events = await page.evaluate(() => window.__tracks);
      report.local.menu = check(await page.evaluate(sequence, { state: 'menu', count: 9 }));
      report.local.easy = check(await page.evaluate(sequence, { state: 'easy', count: 4 }));
      report.local.hard = check(await page.evaluate(sequence, { state: 'hard', count: 4 }));
    }
  }

  if (PHASES.includes('public')) {
    // What the Pages build ships: the placeholder list emptied. No placeholder file may even be asked for.
    requested.length = 0;
    await page.route('**/audio/music/manifest.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"menu":[],"easy":[],"hard":[]}' }));
    await page.reload({ waitUntil: 'load' });
    const boot = await page.evaluate(start);
    report.public = { ...boot };
    if (!boot.error) {
      await page.mouse.click(720, 450);
      await sleep(900);
      report.public.first = await page.evaluate(sample, 2.5);
      await shot('public-menu');
      report.public.menu = check(await page.evaluate(sequence, { state: 'menu', count: 7 }));
      report.public.easy = check(await page.evaluate(sequence, { state: 'easy', count: 2 }));
      report.public.hard = check(await page.evaluate(sequence, { state: 'hard', count: 2 }));
      report.public.placeholderRequests = requested.filter(u => u.includes('/audio/music/') && !u.endsWith('manifest.json'));
      report.public.ostRequests = [...new Set(requested.filter(u => u.includes('/audio/ost/')))];
    }
    await page.unroute('**/audio/music/manifest.json');
  }

  if (PHASES.includes('flag')) {
    requested.length = 0;
    await page.goto(page.url().replace(/[?#].*$/, '') + '?music=ost', { waitUntil: 'load' });
    const boot = await page.evaluate(start);
    report.flag = { ...boot, placeholderManifestRequested: requested.some(u => u.includes('/audio/music/manifest.json')) };
  }

  writeFileSync(join(outDir, 'live.json'), JSON.stringify(report, null, 1));
  return report;
}
