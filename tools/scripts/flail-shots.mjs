// The Flail in the viewmodel sandbox: hip, the reload's frames, close cameras with the arms hidden, the 200 box, the ADS pictures
// with a cross on the screen's centre, and the shop's studio. FLAIL_ONLY=hip,reload,close,ads,studio picks sets.
//   OP2_NO_HMR=1 npx vite --port 5212 --strictPort
//   node tools/shot.mjs --port 5212 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 400 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=flail" --script tools/scripts/flail-shots.mjs --out tools/out/flail/x.png
export default async function flailShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const only = (process.env.FLAIL_ONLY ?? 'hip,reload,close,ads,studio').split(',');
  await page.evaluate(() => window.__vm.ctx.render.renderer.setPixelRatio(2));
  const fit = list => page.evaluate(l => { window.__vm.fakeWeapons.fitted = new Set(l); }, list);
  const equip = async (mag, size) => {
    await page.evaluate(([m, s]) => {
      const v = window.__vm;
      v.ammo.mag = m;
      v.ammo.magSize = s;
      v.rig.equip('flail', 0.01);
    }, [mag, size]);
    await step(0.8);
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
  const close = async (name, eye, target, arms = false) => {
    await page.evaluate(([e, t, keep]) => {
      const view = window.__vm;
      const root = view.rig.allDefs.flail.model.root;
      root.updateMatrixWorld(true);
      const at = root.localToWorld(root.position.clone().set(...t));
      const from = root.localToWorld(root.position.clone().set(...e));
      const cam = view.ctx.render.viewCamera;
      if (!view.__update) view.__update = view.rig.update.bind(view.rig);
      view.rig.update = (...args) => {
        view.__update(...args);
        if (!keep) view.rig.armR.mesh.visible = view.rig.armL.mesh.visible = false;
        cam.position.copy(from); cam.lookAt(at); cam.updateMatrixWorld();
      };
    }, [eye, target, arms]);
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
  const studio = async (mods, name, yaw, pitch = 0) => {
    await page.evaluate(async ([list, y, x]) => {
      const view = window.__vm;
      if (!window.__stage) {
        const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
        const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
        stage.active = true;
        window.__stage = stage;
      }
      const stage = window.__stage;
      stage.show('flail', new Set(list));
      stage.update(0);
      stage.camera.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
      // Closer than the shop's panel frames it, so the still shows the detail.
      stage.camera.zoom = 2.1;
      stage.camera.updateProjectionMatrix();
      stage.turntable.rotation.set(x, y, 0);
      view.ctx.render.render();
    }, [mods, yaw, pitch]);
    await shot(name);
  };
  const cross = on => page.evaluate(v => {
    let el = document.getElementById('flail-cross');
    if (!el) {
      el = document.createElement('div');
      el.id = 'flail-cross';
      el.style.cssText = 'position:fixed;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;pointer-events:none;z-index:99;' +
        'background:linear-gradient(red,red) center/2px 100% no-repeat,linear-gradient(red,red) center/100% 2px no-repeat;opacity:.55';
      document.body.append(el);
    }
    el.style.display = v ? 'block' : 'none';
  }, on);
  const ads = async (mods, name) => {
    await fit(mods);
    await page.evaluate(() => window.__vm.rig.setAim(1));
    await step(0.8);
    await cross(true);
    await shot(name);
    await cross(false);
    await page.evaluate(() => window.__vm.rig.setAim(0));
    await step(0.8);
  };

  const tris = await page.evaluate(() => {
    const d = window.__vm.rig.allDefs;
    return { flail: d.flail.model.triangles, piledriver: d.piledriver.model.triangles, gimlet: d.gimlet.model.triangles, harrow: d.harrow.model.triangles, awl: d.awl.model.triangles };
  });
  if (only.includes('hip')) {
    await fit([]);
    await equip(100, 100);
    await shot('hip');
    await fit(['flailBox']);
    await equip(200, 200);
    await shot('hip-box');
    await fit(['flailAcog']);
    await equip(100, 100);
    await shot('hip-acog');
    await fit(['flailDot', 'flailBox']);
    await equip(60, 200);
    await shot('hip-dot-box');
  }
  if (only.includes('reload')) {
    await fit([]);
    await equip(100, 100);
    await reload('std', 2.8, [0.1, 0.22, 0.42, 0.53, 0.62, 0.72, 0.85]);
    await fit(['flailBox', 'flailDot']);
    await equip(200, 200);
    await reload('box', 3.1, [0.22, 0.45, 0.55]);
  }
  if (only.includes('close')) {
    await fit([]);
    await equip(100, 100);
    await close('close-left', [-0.55, 0.02, -0.15], [0, 0.0, -0.18]);
    await close('close-left-arms', [-0.55, 0.02, -0.15], [0, 0.0, -0.18], true);
    await close('close-feed', [-0.22, 0.12, 0.02], [-0.02, 0.03, -0.1]);
    await close('close-front', [-0.25, 0.08, -0.62], [0, 0.04, -0.4]);
    await close('close-under', [-0.3, -0.25, -0.2], [0, -0.03, -0.2]);
    await fit(['flailBox']);
    await step(0.05);
    await close('close-box', [-0.4, -0.06, -0.12], [0, -0.06, -0.1]);
    await fit(['flailAcog']);
    await step(0.05);
    await close('close-acog', [-0.3, 0.16, 0.1], [0, 0.1, -0.08]);
    await fit(['flailDot']);
    await step(0.05);
    await close('close-dot', [-0.3, 0.16, 0.1], [0, 0.1, -0.08]);
    await free();
  }
  if (only.includes('ads')) {
    await equip(100, 100);
    await ads([], 'ads-irons');
    await ads(['flailDot'], 'ads-dot');
    await ads(['flailAcog'], 'ads-acog');
  }
  if (only.includes('studio')) {
    await studio([], 'studio-std', -Math.PI / 2);
    await studio(['flailBox', 'flailAcog'], 'studio-box-acog', -Math.PI / 2);
    await studio(['flailDot'], 'studio-dot-34', -Math.PI / 2 + 0.6, 0.25);
    await page.evaluate(() => { if (window.__stage) { window.__stage.active = false; window.__stage = null; } });
  }
  return { tris };
}
