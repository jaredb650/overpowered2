// Extended magazines (SMG, Rivet), the Piledriver's 100-round box and ADS, and the Gimlet's short barrel, in the viewmodel
// sandbox: hip, reload frames, close cameras with the arms hidden, and the shop's studio. MAGS_ONLY=smg,rivet,pd,gimlet picks sets.
//   OP2_NO_HMR=1 npx vite --port 5280 --strictPort
//   node tools/shot.mjs --port 5280 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 400 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=smg" --script tools/scripts/mags-b-shots.mjs --out tools/out/mods-b/x.png
export default async function magsShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const only = (process.env.MAGS_ONLY ?? 'smg,rivet,pd,gimlet').split(',');
  await page.evaluate(() => window.__vm.ctx.render.renderer.setPixelRatio(2));
  const fit = list => page.evaluate(l => { window.__vm.fakeWeapons.fitted = new Set(l); }, list);
  const equip = async (id, mag, size) => {
    await page.evaluate(([w, m, s]) => {
      const v = window.__vm;
      v.ammo.mag = m;
      v.ammo.magSize = s;
      v.rig.equip(w, 0.01);
    }, [id, mag, size]);
    await step(0.6);
  };
  const reload = async (prefix, seconds, marks) => {
    await page.evaluate(s => { const v = window.__vm; v.ammo.mag = 0; v.rig.reload(s); }, seconds);
    let previous = 0;
    for (const t of marks) {
      await step((t - previous) * seconds);
      previous = t;
      await shot(`${prefix}-reload-${String(Math.round(t * 100)).padStart(2, '0')}`);
    }
    await step(seconds);
  };
  const close = async (id, name, eye, target) => {
    await page.evaluate(([w, e, t]) => {
      const view = window.__vm;
      const root = view.rig.allDefs[w].model.root;
      root.updateMatrixWorld(true);
      const at = root.localToWorld(root.position.clone().set(...t));
      const from = root.localToWorld(root.position.clone().set(...e));
      const cam = view.ctx.render.viewCamera;
      if (!view.__update) view.__update = view.rig.update.bind(view.rig);
      view.rig.update = (...args) => { view.__update(...args); view.rig.armR.mesh.visible = view.rig.armL.mesh.visible = false; cam.position.copy(from); cam.lookAt(at); cam.updateMatrixWorld(); };
    }, [id, eye, target]);
    await step(0.02);
    await shot(name);
  };
  const free = () => page.evaluate(() => {
    const view = window.__vm;
    if (view.__update) { view.rig.update = view.__update; view.__update = null; }
    const cam = view.ctx.render.viewCamera;
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    cam.updateMatrixWorld();
  });
  const studio = async (id, mods, name, yaw, pitch = 0) => {
    await page.evaluate(async ([w, list, y, x]) => {
      const view = window.__vm;
      if (!window.__stage) {
        const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
        const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
        stage.active = true;
        window.__stage = stage;
      }
      const stage = window.__stage;
      stage.show(w, new Set(list));
      stage.update(0);
      stage.camera.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
      stage.turntable.rotation.set(x, y, 0);
      view.ctx.render.render();
    }, [id, mods, yaw, pitch]);
    await shot(name);
  };
  const stopStage = () => page.evaluate(() => { if (window.__stage) { window.__stage.active = false; window.__stage = null; } });
  /** A red cross on the screen's centre, for the ADS stills. */
  const cross = on => page.evaluate(v => {
    let el = document.getElementById('mags-cross');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mags-cross';
      el.style.cssText = 'position:fixed;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;pointer-events:none;z-index:99;' +
        'background:linear-gradient(red,red) center/2px 100% no-repeat,linear-gradient(red,red) center/100% 2px no-repeat;opacity:.7';
      document.body.append(el);
    }
    el.style.display = v ? 'block' : 'none';
  }, on);

  if (only.includes('smg')) {
    await fit(['smgMag']);
    await equip('smg', 45, 45);
    await shot('smg-hip-ext');
    await reload('smg', 1.0, [0.2, 0.45, 0.6, 0.7, 0.8]);
    await close('smg', 'smg-close-ext', [-0.45, -0.05, -0.1], [0, -0.07, -0.07]);
    await fit([]);
    await step(0.05);
    await close('smg', 'smg-close-std', [-0.45, -0.05, -0.1], [0, -0.07, -0.07]);
    await free();
    await studio('smg', [], 'smg-studio-std', -Math.PI / 2);
    await studio('smg', ['smgMag'], 'smg-studio-ext', -Math.PI / 2);
    await studio('smg', ['smgMag', 'suppressor'], 'smg-studio-ext-can', -Math.PI / 2 + 0.7, 0.3);
    await stopStage();
  }
  if (only.includes('rivet')) {
    await fit(['rivetMag']);
    await equip('rivet', 22, 22);
    await shot('rivet-hip-ext');
    await reload('rivet', 0.8, [0.15, 0.3, 0.42, 0.5, 0.6]);
    await close('rivet', 'rivet-close-ext', [-0.35, -0.08, 0.05], [0, -0.08, 0.02]);
    await fit([]);
    await step(0.05);
    await close('rivet', 'rivet-close-std', [-0.35, -0.08, 0.05], [0, -0.08, 0.02]);
    await free();
    await studio('rivet', [], 'rivet-studio-std', -Math.PI / 2);
    await studio('rivet', ['rivetMag'], 'rivet-studio-ext', -Math.PI / 2);
    await studio('rivet', ['rivetMag'], 'rivet-studio-ext-34', -Math.PI / 2 + 0.7, 0.25);
    await stopStage();
  }
  if (only.includes('pd')) {
    await fit(['piledriverBox']);
    await equip('piledriver', 100, 100);
    await shot('pd-hip-box');
    await reload('pd', 3, [0.1, 0.22, 0.45, 0.55, 0.62, 0.8]);
    await close('piledriver', 'pd-close-box', [-0.6, 0.0, -0.05], [-0.08, -0.03, -0.1]);
    await fit([]);
    await step(0.05);
    await close('piledriver', 'pd-close-std', [-0.6, 0.0, -0.05], [-0.08, -0.03, -0.1]);
    await free();
    // ADS: the ladder's notch on the post, with a cross on the screen's centre.
    await fit(['piledriverBox']);
    await page.evaluate(() => window.__vm.rig.setAim(1));
    await step(0.6);
    await cross(true);
    await shot('pd-ads');
    await cross(false);
    await page.evaluate(() => window.__vm.rig.setAim(0));
    await step(0.6);
    await studio('piledriver', [], 'pd-studio-std', -Math.PI / 2);
    await studio('piledriver', ['piledriverBox'], 'pd-studio-box', -Math.PI / 2);
    await studio('piledriver', ['piledriverBox'], 'pd-studio-box-34', Math.PI / 2 + 0.6, 0.3);
    await stopStage();
  }
  if (only.includes('gimlet')) {
    const side = [-0.7, 0.05, -0.33];
    const target = [0, 0.04, -0.38];
    await fit(['gimletAcog', 'gimletCan', 'gimletShort']);
    await equip('gimlet', 30, 30);
    await shot('gimlet-hip-short-can');
    await reload('gimlet', 1.02, [0.1, 0.3, 0.5, 0.6, 0.8]);
    await close('gimlet', 'gimlet-close-short-can', side, target);
    await fit(['gimletAcog', 'gimletShort']);
    await step(0.05);
    await close('gimlet', 'gimlet-close-short', side, target);
    await fit(['gimletAcog', 'gimletShort', 'gimletGl']);
    await step(0.05);
    await close('gimlet', 'gimlet-close-short-gl', side, target);
    await fit(['gimletAcog', 'gimletShort', 'gimletGl', 'gimletCan']);
    await step(0.05);
    await close('gimlet', 'gimlet-close-short-gl-can', side, target);
    await fit(['gimletAcog']);
    await step(0.05);
    await close('gimlet', 'gimlet-close-long', side, target);
    await free();
    await fit(['gimletAcog', 'gimletShort']);
    await step(0.05);
    await shot('gimlet-hip-short');
    await studio('gimlet', ['gimletAcog', 'gimletCan'], 'gimlet-studio-long-can', -Math.PI / 2);
    await studio('gimlet', ['gimletAcog', 'gimletShort'], 'gimlet-studio-short', -Math.PI / 2);
    await studio('gimlet', ['gimletAcog', 'gimletCan', 'gimletShort'], 'gimlet-studio-short-can', -Math.PI / 2);
    await studio('gimlet', ['gimletAcog', 'gimletCan', 'gimletShort', 'gimletGl'], 'gimlet-studio-short-can-gl', -Math.PI / 2 + 0.6, 0.25);
    await stopStage();
  }
  return page.evaluate(() => {
    const d = window.__vm.rig.allDefs;
    return { dpr: devicePixelRatio, smg: d.smg.model.triangles, rivet: d.rivet.model.triangles, pd: d.piledriver.model.triangles, gimlet: d.gimlet.model.triangles };
  });
}
