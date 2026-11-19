// Blood on the weapon and the hands (src/weapons/viewmodels/blood.ts), on the viewmodel sandbox's stepped clock:
//
//   VB_IDS=smg,judge,sword node tools/shot.mjs --port <yours> --url "/?sandbox=viewmodels&manual=1&engine=1" \
//     --script tools/scripts/vm-blood.mjs --dpr 2 --w 1440 --h 900 --wait 1500 --out tools/out/<you>/vb.png
//
// Per weapon: `<out>-<id>-clean.png`, `-fresh` (one close kill from VB_FROM), `-dried` (the same, 80 s on), `-soaked` (three
// more kills from other sides on top, the last one fresh) and `-ads` (aimed, soaked: the sights must stay readable).
//   VB_FROM   where the blood comes from in the view, "x,y,z" (default "0.25,0.1,-1": ahead and a little right)
//   VB_AMOUNT 0..1 (default 0.8)
//   VB_BLADE  1: as a blow of the blade (melee weapons default to it)
//   VB_STEPS  which pictures, e.g. "clean,fresh" (default all)
const ids = (process.env.VB_IDS ?? 'smg').split(',').filter(Boolean);
const from = (process.env.VB_FROM ?? '0.25,0.1,-1').split(',').map(Number);
const amount = Number(process.env.VB_AMOUNT ?? 0.8);
const steps = (process.env.VB_STEPS ?? 'clean,fresh,dried,soaked,ads').split(',');
const BLADES = ['sword', 'knife', 'crowbar', 'shovel', 'baton'];

export default async function blood(page, h) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!window.__vm?.rig)) break;
    await h.sleep(300);
  }
  const step = s => page.evaluate(v => window.__vm.step(v), s);
  const snap = async n => {
    await h.sleep(90);
    await h.shot(n);
  };
  const report = {};
  for (const id of ids) {
    const blade = process.env.VB_BLADE === '1' || BLADES.includes(id);
    await page.evaluate(w => {
      const v = window.__vm;
      v.rig.cleanBlood();
      v.rig.setAim(0);
      v.rig.equip(w, 0.01);
    }, id);
    await step(0.4);
    if (steps.includes('clean')) await snap(`${id}-clean`);
    const hit = (dir, a) => page.evaluate(([d, amt, b]) => window.__vm.rig.spatterView({ x: d[0], y: d[1], z: d[2] }, amt, b), [dir, a, blade]);
    const age = s => page.evaluate(v => { window.__vm.rig.bloodClock += v; }, s);
    await hit(from, amount);
    await step(0.05);
    if (steps.includes('fresh')) await snap(`${id}-fresh`);
    await age(80);
    await step(0.05);
    if (steps.includes('dried')) await snap(`${id}-dried`);
    await hit([-0.6, 0.2, -0.8], 0.7);
    await age(30);
    await hit([0.7, -0.1, -0.7], 0.6);
    await age(12);
    await hit([0, 0.3, -1], 0.9);
    await step(0.05);
    if (steps.includes('soaked')) await snap(`${id}-soaked`);
    if (steps.includes('ads')) {
      await page.evaluate(() => window.__vm.rig.setAim(1));
      await step(0.6);
      await snap(`${id}-ads`);
      await page.evaluate(() => window.__vm.rig.setAim(0));
    }
    report[id] = await page.evaluate(() => {
      const b = window.__vm.rig.mats.blood;
      return { gun: b.gun.uBloodOn.value, handR: b.handR.uBloodOn.value, handL: b.handL.uBloodOn.value };
    });
  }
  return report;
}
