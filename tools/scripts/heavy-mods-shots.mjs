// The heavy guns' mods and fixes in the viewmodel sandbox: the Trommel's 12 mm rechamber, the Sabot's T brake, the
// autocannon's sight on the left flank (hip, scope coming up, reload). First person, close cameras with the arms hidden,
// and the shop's studio. HEAVY_ONLY=trommel,sabot,cannon picks sets.
//   OP2_NO_HMR=1 npx vite --port 5282 --strictPort
//   node tools/shot.mjs --port 5282 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 400 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=buzzsaw" --script tools/scripts/heavy-mods-shots.mjs --out tools/out/mods-e/x.png
export default async function heavyShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const only = (process.env.HEAVY_ONLY ?? 'trommel,sabot,cannon').split(',');
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
  /** A close camera in the model's frame, arms hidden, until `free`. */
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

  if (only.includes('trommel')) {
    await fit([]);
    await equip('buzzsaw', 120, 120);
    await shot('trommel-hip-six');
    await fit(['trommel12']);
    await step(0.05);
    await shot('trommel-hip-three');
    await page.evaluate(() => { window.__vm.rig.setCharge(1); });
    await step(0.5);
    await page.evaluate(() => window.__vm.rig.fire(1));
    await step(0.03);
    await shot('trommel-firing-three');
    await page.evaluate(() => window.__vm.rig.setCharge(0));
    await step(0.8);
    await close('buzzsaw', 'trommel-close-muzzle', [0.32, 0.2, -1.2], [0, 0.08, -0.85]);
    await close('buzzsaw', 'trommel-close-front', [0.05, 0.12, -1.45], [0, 0.08, -0.9]);
    await close('buzzsaw', 'trommel-close-left', [-0.8, 0.12, -0.35], [0, 0.08, -0.4]);
    await free();
    await studio('buzzsaw', [], 'trommel-studio-six', -Math.PI / 2);
    await studio('buzzsaw', ['trommel12'], 'trommel-studio-three', -Math.PI / 2);
    await studio('buzzsaw', ['trommel12'], 'trommel-studio-three-quarter', -Math.PI / 2 + 0.75, 0.3);
    await stopStage();
  }
  if (only.includes('sabot')) {
    await fit(['sabotBrake']);
    await equip('sabot', 5, 5);
    await shot('sabot-hip-brake');
    await close('sabot', 'sabot-close-brake', [0.3, 0.16, -1.05], [0, 0.05, -1.2]);
    await close('sabot', 'sabot-close-top', [0.02, 0.45, -1.15], [0, 0.05, -1.16]);
    await free();
    await studio('sabot', [], 'sabot-studio-bare', -Math.PI / 2);
    await studio('sabot', ['sabotBrake'], 'sabot-studio-brake', -Math.PI / 2);
    await studio('sabot', ['sabotBrake'], 'sabot-studio-three-quarter', -Math.PI / 2 + 0.75, 0.42);
    await stopStage();
    await fit([]);
  }
  if (only.includes('cannon')) {
    await fit([]);
    await equip('autocannon', 3, 3);
    await shot('cannon-hip');
    // The scope coming up: its weight eases at 18 a second, so these are part way.
    await page.evaluate(() => window.__vm.rig.setScoped(true));
    for (const t of [0.04, 0.08, 0.12]) {
      await step(0.04);
      await shot(`cannon-scope-${String(Math.round(t * 1000)).padStart(3, '0')}`);
    }
    await page.evaluate(() => window.__vm.rig.setScoped(false));
    await step(0.6);
    await page.evaluate(() => { const v = window.__vm; v.ammo.mag = 0; v.rig.reload(1.0); });
    let previous = 0;
    for (const t of [0.08, 0.2, 0.3, 0.45, 0.6, 0.76, 0.9]) {
      await step(t - previous);
      previous = t;
      await shot(`cannon-reload-${String(Math.round(t * 100)).padStart(2, '0')}`);
    }
    await step(0.4);
    await close('autocannon', 'cannon-close-left', [-0.8, 0.2, 0.0], [0, 0.12, -0.1]);
    await close('autocannon', 'cannon-close-eye', [-0.05, 0.3, 0.55], [-0.1, 0.15, 0.0]);
    await free();
  }
  return page.evaluate(() => {
    const d = window.__vm.rig.allDefs;
    return { dpr: devicePixelRatio, trommel: d.buzzsaw.model.triangles, sabot: d.sabot.model.triangles };
  });
}
