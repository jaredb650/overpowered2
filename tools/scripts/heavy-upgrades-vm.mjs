// The autocannon's flak clip and the Piledriver's red dot and ACOG in the viewmodel sandbox: first person at the hip and aimed
// (a red cross on the screen centre to check the reticle against), close cameras with the arms hidden, and the shop's studio.
//   OP2_NO_HMR=1 npx vite --port 5209 --strictPort
//   node tools/shot.mjs --port 5209 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 400 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=autocannon" --script tools/scripts/heavy-upgrades-vm.mjs --out tools/out/heavy-up/x.png
// UP_ONLY=flak,hmg picks sets.
export default async function heavyUpgrades(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const only = (process.env.UP_ONLY ?? 'flak,hmg').split(',');
  await page.evaluate(() => window.__vm.ctx.render.renderer.setPixelRatio(2));
  const fit = list => page.evaluate(l => { window.__vm.fakeWeapons.fitted = new Set(l); }, list);
  const cross = on => page.evaluate(v => {
    let el = document.getElementById('cross');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cross';
      el.style.cssText = 'position:fixed;left:50%;top:50%;width:41px;height:41px;margin:-20px 0 0 -20px;pointer-events:none;z-index:99;'
        + 'background:linear-gradient(#0f0,#0f0) center/1px 100% no-repeat,linear-gradient(#0f0,#0f0) center/100% 1px no-repeat;opacity:0.7';
      document.body.append(el);
    }
    el.style.display = v ? 'block' : 'none';
  }, on);
  const equip = async (id, mag, size) => {
    await page.evaluate(([w, m, s]) => {
      const v = window.__vm;
      v.ammo.mag = m;
      v.ammo.magSize = s;
      v.rig.equip(w, 0.01);
    }, [id, mag, size]);
    await step(0.6);
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

  if (only.includes('flak')) {
    await fit(['autocannonFlak']);
    await equip('autocannon', 3, 3);
    await shot('flak-hip');
    await close('autocannon', 'flak-clip-close', [-0.42, 0.3, -0.12], [0, 0.22, -0.06]);
    await close('autocannon', 'flak-clip-top', [-0.18, 0.5, 0.05], [0, 0.22, -0.07]);
    await fit([]);
    await step(0.05);
    await close('autocannon', 'he-clip-close', [-0.42, 0.3, -0.12], [0, 0.22, -0.06]);
    await free();
    await studio('autocannon', ['autocannonFlak'], 'flak-studio', -Math.PI / 2 + 0.5, 0.3);
    await studio('autocannon', [], 'he-studio', -Math.PI / 2 + 0.5, 0.3);
    await stopStage();
  }
  if (only.includes('hmg')) {
    const optics = (process.env.UP_OPTIC ?? 'dot,acog').split(',');
    for (const [mod, tag] of [['piledriverDot', 'dot'], ['piledriverAcog', 'acog']].filter(([, t]) => optics.includes(t))) {
      await fit([mod]);
      await equip('piledriver', 50, 50);
      await shot(`hmg-${tag}-hip`);
      await page.evaluate(() => { window.__vm.rig.setAim(1); });
      await step(0.8);
      await cross(true);
      await shot(`hmg-${tag}-ads`);
      await cross(false);
      await page.evaluate(() => { window.__vm.rig.setAim(0); });
      await step(0.8);
      await close('piledriver', `hmg-${tag}-close-left`, [-0.45, 0.22, 0.12], [0, 0.13, 0.06]);
      await close('piledriver', `hmg-${tag}-close-right`, [0.42, 0.25, -0.05], [0, 0.13, 0.06]);
      await close('piledriver', `hmg-${tag}-close-back`, [0.08, 0.3, 0.55], [0, 0.13, 0.0]);
      await free();
      // The reload with the optic on: the cover opens past it.
      await page.evaluate(() => { const v = window.__vm; v.ammo.mag = 0; v.rig.reload(3); });
      await step(0.5);
      await shot(`hmg-${tag}-reload-cover`);
      await step(3);
      await studio('piledriver', [mod], `hmg-${tag}-studio`, -Math.PI / 2 + 0.5, 0.3);
      await studio('piledriver', [mod], `hmg-${tag}-studio-side`, -Math.PI / 2, 0);
      await stopStage();
    }
    await fit([]);
    await equip('piledriver', 50, 50);
    await page.evaluate(() => { window.__vm.rig.setAim(1); });
    await step(0.8);
    await cross(true);
    await shot('hmg-irons-ads');
    await cross(false);
    await page.evaluate(() => { window.__vm.rig.setAim(0); });
  }
  return page.evaluate(() => {
    const d = window.__vm.rig.allDefs;
    return { dpr: devicePixelRatio, piledriver: d.piledriver.model.triangles, autocannon: d.autocannon.model.triangles };
  });
}
