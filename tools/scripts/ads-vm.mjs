// Aim down sights on the viewmodel sandbox: each ADS gun fully aimed, with a red cross on the screen centre, so the sight
// can be checked against the eye line. Also prints where each model's `glow:sight` meshes sit, in the model's frame.
//
//   ADS_IDS=smg,judge node tools/shot.mjs --port 5191 --url "/?sandbox=viewmodels&manual=1" \
//     --script tools/scripts/ads-vm.mjs --wait 1500 --dpr 2 --w 1440 --h 900 --out tools/out/ads/vm.png
//
// ADS_MODE=hip also shoots each gun at the hip. ADS_SIGHT='{"smg":[0,0.1,0,0.2]}' overrides sight x, y, z and relief live,
// and three more numbers override the rear sight.
// Screenshots: <out>-<id>-ads.png (and -hip.png).
const ids = (process.env.ADS_IDS ?? 'smg,harrow,shotgun,thresher,rocket,judge,rivet,piledriver,stakegun').split(',').filter(Boolean);
const over = JSON.parse(process.env.ADS_SIGHT ?? '{}');

export default async function ads(page, h) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!window.__vm)) break;
    await h.sleep(300);
  }
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:50%;top:50%;width:21px;height:21px;margin:-10px 0 0 -10px;pointer-events:none;z-index:99;'
      + 'background:linear-gradient(red,red) center/1px 100% no-repeat,linear-gradient(red,red) center/100% 1px no-repeat;opacity:0.8';
    document.body.append(el);
  });
  const report = {};
  for (const id of ids) {
    report[id] = await page.evaluate(([w, o]) => {
      const vm = window.__vm;
      const def = vm.rig.defs?.[w] ?? vm.rig.allDefs?.[w];
      if (o) {
        def.sight = [o[0], o[1], o[2]];
        def.relief = o[3];
        if (o.length > 4) def.rear = [o[4], o[5], o[6]];
      }
      vm.rig.equip(w, 0.01);
      const root = def.model.root;
      root.updateMatrixWorld(true);
      const inv = root.matrixWorld.clone().invert();
      const glow = def.model.glows.sight;
      const boxes = [];
      root.traverse(n => {
        if (!n.isMesh || n.material !== glow) return;
        n.geometry.computeBoundingBox();
        const b = n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld.clone().premultiply(inv));
        boxes.push([b.min.toArray().map(v => +v.toFixed(4)), b.max.toArray().map(v => +v.toFixed(4))]);
      });
      return { sight: def.sight, rear: def.rear, relief: def.relief, glow: boxes };
    }, [id, over[id]]);
    for (const mode of process.env.ADS_MODE === 'hip' ? ['hip', 'ads'] : ['ads']) {
      await page.evaluate(k => window.__vm.rig.setAim(k), mode === 'ads' ? 1 : 0);
      await page.evaluate(() => window.__vm.step(0.6));
      await h.sleep(80);
      await h.shot(`${id}-${mode}`);
    }
  }
  return report;
}
