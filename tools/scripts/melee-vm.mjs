// Key 5's viewmodels on the viewmodel sandbox's stepped clock: rest, the draw, and each swing at fixed shares.
//
//   MELEE_IDS=knife,crowbar node tools/shot.mjs --url "/?sandbox=viewmodels&manual=1" \
//     --script tools/scripts/melee-vm.mjs --wait 1200 --dpr 2 --w 1440 --h 900 --out tools/out/melee/vm.png
//
// Screenshots: <out>-<id>-<move>-<n>.png. Swing lengths are the rows' in src/weapons/melee/data.ts.
const ids = (process.env.MELEE_IDS ?? 'knife,crowbar,shovel,baton').split(',').filter(Boolean);
const MOVES = {
  knife: [['light1', 0.17], ['light2', 0.18], ['heavy', 0.3]],
  crowbar: [['light1', 0.4], ['light2', 0.44], ['heavy', 0.62]],
  shovel: [['light1', 0.58], ['light2', 0.62], ['heavy', 0.72]],
  baton: [['light1', 0.23], ['light2', 0.23], ['light3', 0.3], ['heavy', 0.36]],
  sword: [['light1', 0.25], ['light2', 0.3], ['light3', 0.35]],
};
const DRAW = { knife: 0.08, crowbar: 0.2, shovel: 0.3, baton: 0.12, sword: 0.14 };
const SHARES = (process.env.MELEE_SHARES ?? '0.02,0.2,0.4,0.6,0.8,1.0').split(',').map(Number);

export default async function melee(page, h) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!window.__vm)) break;
    await h.sleep(300);
  }
  const step = s => page.evaluate(v => window.__vm.step(v), s);
  const snap = async n => {
    await h.sleep(60);
    await h.shot(n);
  };
  const only = process.env.MELEE_MODE;
  for (const id of ids) {
    await page.evaluate(w => window.__vm.rig.equip(w, 0.01), id);
    await step(0.4);
    await snap(`${id}-rest`);
    if (!only || only === 'draw') {
      const T = Math.max(DRAW[id], 0.1) * 3;
      await page.evaluate(([w, t]) => window.__vm.rig.equip(w, t), [id, T]);
      let at = 0;
      for (const [i, p] of [0.15, 0.35, 0.55, 0.8].entries()) {
        await step((p - at) * T);
        at = p;
        await snap(`${id}-draw-${i}`);
      }
      await step(T);
    }
    if (only === 'draw') continue;
    for (const [move, T] of MOVES[id] ?? []) {
      await page.evaluate(([m, t]) => window.__vm.rig.swing(m, t), [move, T]);
      let at = 0;
      for (const [i, p] of SHARES.entries()) {
        await step((p - at) * T);
        at = p;
        await snap(`${id}-${move}-${i}`);
      }
      await step(0.3);
    }
  }
  return true;
}
