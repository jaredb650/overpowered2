// Awl renders in the viewmodel sandbox: first person at the hip, the bolt cycle frame by frame, close cameras on the model
// with the arms hidden, then the shop's studio (side profiles, three-quarter, the ACOG and can fitted). AWL_ONLY picks sets.
//   OP2_NO_HMR=1 npx vite --port 5277 --strictPort   (other agents' saves would otherwise reload the page mid-capture)
//   node tools/shot.mjs --port 5277 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 500 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=awl" --script tools/scripts/awl-shots.mjs --out tools/out/awl2/awl.png
// The strip: ffmpeg crops each awl-bolt-*.png to crop=1500:1000:1200:750, scales to 750x500 and tiles them 3x3.
const BOLT = [0, 0.09, 0.14, 0.205, 0.3, 0.42, 0.5, 0.58, 0.66];

export default async function awlShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const only = (process.env.AWL_ONLY ?? 'fp,bolt,studio').split(',');
  await page.evaluate(() => {
    const view = window.__vm;
    view.ctx.render.renderer.setPixelRatio(2);
    view.ammo.magSize = 5;
    view.ammo.mag = 5;
  });
  await page.evaluate(() => window.__vm.rig.equip('awl', 0.01));
  await step(0.6);
  if (only.includes('fp')) await shot('fp-hip');
  if (only.includes('bolt')) {
    await page.evaluate(() => { window.__vm.ammo.mag = 4; window.__vm.rig.fire(1); });
    let previous = 0;
    for (const time of BOLT) {
      await step(time - previous);
      previous = time;
      await shot(`bolt-${String(Math.round(time * 1000)).padStart(3, '0')}`);
    }
    await step(0.5);
  }
  if (only.includes('close')) {
    // Close cameras on the model itself, for working on its form: [name, eye, target] in the model's frame.
    const cams = [
      ['close-right', [0.75, 0.02, -0.1], [0, 0.0, -0.1]],
      ['close-left', [-0.75, 0.02, -0.1], [0, 0.0, -0.1]],
      ['close-action', [0.22, 0.12, 0.12], [0, 0.03, -0.02]],
      ['close-butt', [0.28, -0.02, 0.3], [0, -0.02, 0.22]],
      ['close-front', [0.3, 0.08, -0.5], [0, 0.04, -0.35]],
      ['close-quarter', [0.5, 0.3, 0.45], [0, 0.0, -0.1]],
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
  }
  if (only.includes('studio')) {
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
    await show([]);
    await turn(-Math.PI / 2, 0);
    await shot('studio-right');
    await turn(Math.PI / 2, 0);
    await shot('studio-left');
    await turn(-Math.PI / 2 + 0.75, 0.42);
    await shot('studio-three-quarter');
    await turn(Math.PI / 2 - 0.6, 0.3);
    await shot('studio-front-left');
    await show(['awlAcog', 'awlCan']);
    await turn(-Math.PI / 2, 0);
    await shot('studio-acog-can');
    await turn(-Math.PI / 2 + 0.75, 0.42);
    await shot('studio-acog-three-quarter');
  }
  return page.evaluate(() => {
    const model = window.__vm.rig.allDefs.awl.model;
    return { dpr: devicePixelRatio, triangles: model.triangles, draws: model.draws };
  });
}
