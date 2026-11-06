// Captures an animation as exact frames. VM_ACT is JS run on the sandbox API `v` at t=0, VM_TIMES is a list of
// game-time stamps in seconds. Needs ?manual in the URL.
export default async function (page, h) {
  const act = process.env.VM_ACT ?? 'v.rig.reload(1)';
  const times = (process.env.VM_TIMES ?? '0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1').split(',').map(Number);
  const pre = process.env.VM_PRE ?? '';
  await page.evaluate(`(() => { const v = window.__vm; ${pre}; v.step(0.5); })()`);
  await page.evaluate(`(() => { const v = window.__vm; ${act} })()`);
  let t = 0;
  for (const stamp of times) {
    const d = stamp - t;
    if (d > 0) await page.evaluate(s => window.__vm.step(s), d);
    t = stamp;
    await h.sleep(60);
    await h.shot(`t${String(Math.round(stamp * 1000)).padStart(4, '0')}`);
  }
}
