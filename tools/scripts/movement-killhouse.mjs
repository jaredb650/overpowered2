// The Kill House with the real Player in real Chrome: 6 degree leans along long plain walls, the capsule sweep of every
// door and wall, and random hands. One run. OP2_RUNS_ONLY=1 stops after the wall runs.
//   node tools/shot.mjs --url "/?sandbox=map&map=killhouse" --script tools/scripts/movement-killhouse.mjs --out tools/out/kh-move.png --wait 1500 --timeout 280

const RUNS = {
  // The corridor around the court: 5 m wide and 29 m long, with the wall on the left and then on the right.
  ringWall: [-13, -13.9, 1, -0.105, 1.8],
  courtWall: [-13, -10.6, 1, 0.105, 1.8],
  // Almost head-on into a yard T-wall: the speed left is the sine of the angle, 1.24 m/s, then a corner stops it.
  yardTWall: [-26.7, -33.2, 1, -0.1, 1],
};

/** Rows are [t, x, y, z, speed, state], one per 0.1 s. Compares ground covered with the speed reported over it. */
function summarise(rows) {
  const out = { real: [], reported: [] };
  for (let i = 4; i < rows.length; i++) {
    const [t0, x0, , z0] = rows[i - 1];
    const [t1, x1, , z1, speed] = rows[i];
    out.real.push(Math.round(Math.hypot(x1 - x0, z1 - z0) / (t1 - t0) * 10) / 10);
    out.reported.push(speed);
  }
  return out;
}

export default async function run(page, h) {
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(() => !!window.__op2?.view)) break;
    await h.sleep(500);
  }
  const walls = {};
  for (const [name, args] of Object.entries(RUNS)) {
    const rows = await page.evaluate(a => window.__op2.debugRun(...a), args);
    walls[name] = { ...summarise(rows), end: rows.at(-1).slice(1, 4) };
  }
  if (process.env.OP2_RUNS_ONLY) return { walls };
  const sweep = await page.evaluate(() => window.__op2.sweep());
  const fuzz = await page.evaluate(() => window.__op2.fuzz(60));
  return { walls, sweep, fuzz };
}
