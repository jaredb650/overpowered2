// Exact animation frames from the viewmodel sandbox, on a stepped clock:
//
//   VM_IDS=shotgun,judge VM_MODE=reload node tools/shot.mjs --url "/?sandbox=viewmodels&manual=1" \
//     --script tools/scripts/viewmodel-anim.mjs --wait 1200 --out tools/out/vm/a.png
//
// VM_MODE: reload (default), fire, draw, or sword. Screenshots: <out>-<id>-<n>.png.
const ids = (process.env.VM_IDS ?? 'smg').split(',').filter(Boolean);
const mode = process.env.VM_MODE ?? 'reload';
const RELOAD = { smg: 1, shotgun: 1.25, rocket: 1.5, autocannon: 1, judge: 1.5, lance: 1.7, buzzsaw: 2.2, kiln: 1.8, stakegun: 1.6 };
const MAGS = { smg: 30, shotgun: 6, rocket: 1, autocannon: 5, judge: 6, lance: 4, buzzsaw: 200, kiln: 150, stakegun: 5 };
const DRAW = { smg: 0.16, shotgun: 0.2, rocket: 0.26, autocannon: 0.28, sword: 0.14, judge: 0.22, lance: 0.3, buzzsaw: 0.34, kiln: 0.26, stakegun: 0.24 };

export default async function anim(page, h) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!window.__vm)) break;
    await h.sleep(300);
  }
  const step = s => page.evaluate(v => window.__vm.step(v), s);
  const snap = async n => {
    await h.sleep(70);
    await h.shot(n);
  };
  for (const id of ids) {
    await page.evaluate(([w, mag]) => {
      const v = window.__vm;
      v.rig.equip(w, 0.01);
      v.ammo.magSize = mag ?? 0;
      v.ammo.mag = Math.ceil((mag ?? 0) * 0.5);
    }, [id, MAGS[id]]);
    await step(0.3);
    if (mode === 'reload') {
      const T = RELOAD[id];
      await page.evaluate(t => window.__vm.rig.reload(t), T);
      let at = 0;
      for (const [i, p] of [0.06, 0.16, 0.26, 0.36, 0.46, 0.58, 0.7, 0.8, 0.9].entries()) {
        await step((p - at) * T);
        at = p;
        await snap(`${id}-${i}`);
      }
      await step((1 - at) * T + 0.1);
    } else if (mode === 'fire') {
      await snap(`${id}-0`);
      await page.evaluate(() => window.__vm.rig.fire(1));
      let at = 0;
      for (const [i, t] of [0.012, 0.04, 0.08, 0.14, 0.2, 0.3].entries()) {
        await step(t - at);
        at = t;
        await snap(`${id}-${i + 1}`);
      }
      await step(0.5);
    } else if (mode === 'draw') {
      const T = DRAW[id];
      await page.evaluate(([w, t]) => window.__vm.rig.equip(w, t), [id, T]);
      let at = 0;
      for (const [i, p] of [0.1, 0.3, 0.5, 0.7, 0.9, 1.05].entries()) {
        await step((p - at) * T);
        at = p;
        await snap(`${id}-${i}`);
      }
    } else if (mode === 'sword') {
      const moves = JSON.parse(process.env.VM_MOVES ?? '[["light1",0.25],["light2",0.3],["light3",0.35],["area",0.4],["finisher",0.35]]');
      for (const [move, T] of moves) {
        await page.evaluate(([m, t]) => window.__vm.rig.swing(m, t), [move, T]);
        let at = 0;
        for (const [i, p] of [0.02, 0.15, 0.3, 0.45, 0.57, 0.75, 1.0, 1.3].entries()) {
          await step((p - at) * T);
          at = p;
          await snap(`${move}-${i}`);
        }
        await step(0.05);
      }
    }
  }
  return true;
}
