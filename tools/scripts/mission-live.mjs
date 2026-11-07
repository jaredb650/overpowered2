// Plays the real Outpost mission in real Chrome, in stretches, and reads it back. MISSION_STEP picks the stretch. Bot only: what it
// proves is that every beat runs on the real map, not that any of it is any good.
//
//   MISSION_STEP=film node tools/shot.mjs --url "/?contract=campaign&autostart=1" --script tools/scripts/mission-live.mjs --out tools/out/ms.png --wait 500 --timeout 170
//   add --dpr 2 --w 1440 --h 900 for the owner's screen, and &beat=<id> for anywhere
const STEP = process.env.MISSION_STEP ?? 'film';

export default async function missionLive(page, h) {
  const log = [];
  const read = () => page.evaluate(() => window.__op2?.campaign?.runner.describe() ?? null);
  const note = async label => {
    const d = await read();
    log.push({ label, beat: d?.beat, state: d?.state, deaths: d?.deaths, objectives: d?.objectives, tags: d?.tags });
    return d;
  };
  const until = async (test, seconds, label) => {
    for (let t = 0; t < seconds * 4; t++) {
      const d = await read();
      if (d && test(d)) return d;
      await h.sleep(250);
    }
    throw new Error(`timed out waiting for ${label}: ${JSON.stringify(await read())}`);
  };
  const press = action => page.evaluate(async a => {
    const { input } = window.__op2.ctx;
    input.simulate(a, true);
    await new Promise(r => setTimeout(r, 120));
    input.simulate(a, false);
  }, action);
  /** Moves the film on, so a stretch does not have to sit through it. */
  const seek = (index, clock) => page.evaluate(([i, c]) => {
    const film = window.__op2.campaign.host.film;
    film.index = i;
    film.clock = c;
    film.cut();
  }, [index, clock]);
  const hud = () => page.evaluate(() => ({
    radio: document.querySelector('.ms-radio.on')?.textContent ?? null,
    hint: document.querySelector('.ms-hint.on')?.textContent ?? null,
    objectives: [...document.querySelectorAll('.ms-obj')].map(e => e.textContent),
    beat: document.querySelector('.ms-beat')?.textContent ?? null,
  }));
  const steps = {
    async film() {
      await until(d => d.beat === 'briefing', 60, 'briefing');
      await h.sleep(700);
      await h.shot('film-0');
      for (const [i, c, name] of [[0, 11, 'film-1'], [1, 6, 'film-2'], [2, 6, 'film-3'], [3, 2, 'film-4'], [3, 7, 'film-5']]) {
        await seek(i, c);
        await h.sleep(500);
        await h.shot(name);
        log.push({ name, hud: await hud() });
      }
      await press('interact');
      await until(d => d.beat === 'insertion', 8, 'insertion');
      await h.sleep(400);
      await h.shot('film-after');
      await h.sleep(5000);
      await h.shot('ride-0');
      await note('in the seat');
    },
  };
  await steps[STEP]();
  return { step: STEP, log };
}
