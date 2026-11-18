// The Awl's extended barrel and greased bolt in the viewmodel sandbox: the long barrel at the hip, the greased bolt's cycle
// frame by frame (a quarter sooner than awl-shots.mjs's), a close look at the film on the bolt, and the shop's studio.
//   OP2_NO_HMR=1 npx vite --port 5210 --strictPort
//   node tools/shot.mjs --port 5210 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 300 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=awl" --script tools/scripts/awl-mods-shots.mjs --out tools/out/awl-mods/awl.png
const GREASE = 0.75;
const BOLT = [0, 0.09, 0.14, 0.205, 0.3, 0.42, 0.5, 0.58, 0.66].map(t => t * GREASE);

export default async function awlModsShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const fit = list => page.evaluate(mods => { window.__vm.fakeWeapons.fitted = new Set(mods); }, list);
  await page.evaluate(() => {
    const view = window.__vm;
    view.ctx.render.renderer.setPixelRatio(2);
    view.ammo.magSize = 5;
    view.ammo.mag = 5;
  });
  await fit(['awlBarrel']);
  await page.evaluate(() => window.__vm.rig.equip('awl', 0.01));
  await step(0.6);
  await shot('fp-hip-barrel');
  await fit(['awlBarrel', 'awlCan']);
  await step(0.05);
  await shot('fp-hip-barrel-can');
  await fit(['awlBarrel', 'awlBolt']);
  await step(0.05);
  await page.evaluate(() => { window.__vm.ammo.mag = 4; window.__vm.rig.fire(1); });
  let previous = 0;
  for (const time of BOLT) {
    await step(time - previous);
    previous = time;
    await shot(`bolt-greased-${String(Math.round(time * 1000)).padStart(3, '0')}`);
  }
  await step(0.5);
  // Close cameras on the model, arms hidden: the action with the film, the muzzle end.
  const cams = [
    ['close-action', [0.2, 0.1, 0.1], [0, 0.04, -0.02]],
    ['close-muzzle', [0.16, 0.06, -0.62], [0, 0.045, -0.7]],
    ['close-right', [0.9, 0.02, -0.18], [0, 0.0, -0.18]],
  ];
  for (const [name, eye, target] of cams) {
    await page.evaluate(([e, t]) => {
      const view = window.__vm;
      const root = view.rig.allDefs.awl.model.root;
      root.updateMatrixWorld(true);
      const at = root.localToWorld(root.position.clone().set(...t));
      const from = root.localToWorld(root.position.clone().set(...e));
      const cam = view.ctx.render.viewCamera;
      if (!view.__update) view.__update = view.rig.update.bind(view.rig);
      view.rig.update = (...args) => { view.__update(...args); view.rig.armR.mesh.visible = view.rig.armL.mesh.visible = false; cam.position.copy(from); cam.lookAt(at); cam.updateMatrixWorld(); };
    }, [eye, target]);
    await step(0.02);
    await shot(name);
  }
  await page.evaluate(() => { const view = window.__vm; if (view.__update) view.rig.update = view.__update; });

  const show = mods => page.evaluate(async list => {
    const view = window.__vm;
    if (!window.__stage) {
      const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
      const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
      stage.active = true;
      window.__stage = stage;
    }
    const stage = window.__stage;
    stage.show('awl', new Set(list));
    stage.update(0);
    stage.camera.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
  }, mods);
  const turn = (y, x = 0.12) => page.evaluate(([yaw, pitch]) => {
    window.__stage.turntable.rotation.set(pitch, yaw, 0);
    window.__vm.ctx.render.render();
  }, [y, x]);
  await show(['awlBarrel', 'awlBolt']);
  await turn(-Math.PI / 2, 0);
  await shot('studio-barrel-right');
  await turn(-Math.PI / 2 + 0.75, 0.42);
  await shot('studio-barrel-three-quarter');
  await show(['awlBarrel', 'awlCan', 'awlAcog']);
  await turn(-Math.PI / 2, 0);
  await shot('studio-barrel-can-acog');
  return page.evaluate(() => {
    const model = window.__vm.rig.allDefs.awl.model;
    return { dpr: devicePixelRatio, triangles: model.triangles, draws: model.draws };
  });
}
