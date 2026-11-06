// Shoots the first-person rig from outside. VM_CAMS: "name:px,py,pz,tx,ty,tz;..."
export default async function (page, h) {
  const pre = process.env.VM_PRE ?? '';
  await page.evaluate(`(() => { const v = window.__vm; ${pre}; v.step(0.6); })()`);
  await h.shot('fp');
  const cams = (process.env.VM_CAMS ?? 'left:-0.55,0.0,-0.4,0.1,-0.15,-0.45;right:0.8,-0.05,-0.42,0.1,-0.16,-0.45;under:0.1,-0.65,-0.5,0.1,-0.15,-0.5;front:0.14,-0.1,-1.3,0.12,-0.14,-0.4').split(';');
  for (const c of cams) {
    const [name, v] = c.split(':');
    const n = v.split(',').map(Number);
    await page.evaluate(a => window.__vm.cam(...a), n);
    await h.sleep(120);
    await h.shot(name);
  }
}
