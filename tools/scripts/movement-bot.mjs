// Movement bot for the real browser. Runs every mechanic through input.simulate on the /?sandbox=movement page and
// prints the numbers, then runs the headline chain live for screenshots.
//
//   node tools/shot.mjs --url "/?sandbox=movement" --script tools/scripts/movement-bot.mjs --out tools/out/movement.png --wait 8000
//
// BOT_FAST=name,name limits the fast pass. BOT_SHOTS=0 skips the screenshot pass.

const ready = page => page.waitForFunction(() => window.__movement !== undefined, undefined, { timeout: 90000 });

/** Steps a bot to each moment and holds there for the shot. `moments` are [name, expression over p and c]. */
async function moments(page, helpers, bot, list) {
  await page.evaluate(name => window.__movement.startBot(name), bot);
  for (const [name, expression] of list) {
    const hit = await page.evaluate(e => window.__movement.advanceUntil(e), expression);
    await helpers.sleep(150);
    if (hit) await helpers.shot(`${bot}-${name}`);
    else console.error(`moment not reached: ${bot} ${name}`);
  }
  await page.evaluate(() => window.__movement.release());
}

/** The real DOM path: keyboard events, mouse events and pointer lock rather than input.simulate. */
async function realInput(page, helpers) {
  const read = () => page.evaluate(() => {
    const { player, input } = window.__movement;
    return { speed: player.speed, y: player.position.y, state: player.state, yaw: player.yaw, locked: input.locked };
  });
  await page.evaluate(() => window.__movement.respawn('strafe'));
  await helpers.sleep(300);
  const out = {};
  await helpers.keyDown('KeyW');
  await helpers.sleep(500);
  out.w_held = await read();
  await helpers.press('Space', 60);
  await helpers.sleep(120);
  out.after_space = await read();
  await helpers.keyUp('KeyW');
  await helpers.sleep(900);
  const before = (await read()).yaw;
  await helpers.mouseMove(100, 0);
  await helpers.mouseMove(100, 0);
  await helpers.sleep(200);
  out.yaw_turned = before - (await read()).yaw;
  await page.mouse.click(640, 360);
  await helpers.sleep(400);
  out.locked_after_click = (await read()).locked;
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.exitPointerLock());
  await helpers.sleep(200);
  return out;
}

export default async function run(page, helpers) {
  await ready(page);
  const out = {};
  out.real_input = await realInput(page, helpers);

  const fast = process.env.BOT_FAST?.split(',').filter(Boolean);
  const names = fast ?? (await page.evaluate(() => window.__movement.BOTS));
  for (const fps of [60, 30, 144]) {
    for (const name of names) {
      // The full suite runs at 60. Frame-rate spot checks only need the bots that integrate speed.
      if (fps !== 60 && !['feel', 'strafe', 'slide', 'wall', 'chain'].includes(name)) continue;
      out[`${name}@${fps}`] = await page.evaluate(([n, f]) => window.__movement.runFast(n, f), [name, fps]);
    }
  }

  if (process.env.BOT_SHOTS !== '0') {
    await moments(page, helpers, 'chain', [
      ['slide', 'p.sliding && p.speed > 13'],
      ['wallrun', 'p.wallRunning && p.wallRunT > 0.35'],
      ['dash', 'p.dashing'],
      ['slam', 'p.slamming'],
      ['landslide', 'p.sliding && p.speed > 16'],
    ]);
    await moments(page, helpers, 'strafe', [
      ['18', 'p.speed > 18'],
      ['26', 'p.speed > 26'],
    ]);
    await moments(page, helpers, 'edge', [
      ['tunnel', 'p.sliding && p.position.z < -30'],
      ['corner', 'p.wallRunning && p.position.x > 490'],
    ]);
  }
  return out;
}
