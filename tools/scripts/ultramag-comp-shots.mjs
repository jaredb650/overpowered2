// The Ultramag's compensator in the viewmodel sandbox: first person at the hip and aimed, the recoil's peak bare and with it (and
// the muzzle's pitch every 1/120 s for both), close cameras round the comp, and the shop studio.
//   node tools/shot.mjs --port 5207 --dpr 2 --w 1440 --h 900 --wait 4000 \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=ultramag" --script tools/scripts/ultramag-comp-shots.mjs --out tools/out/ucomp/u.png
// UCOMP_ONLY=fp,recoil,close,studio picks the sets.
export default async function compShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(80); await helpers.shot(name); };
  const only = (process.env.UCOMP_ONLY ?? 'fp,recoil,close,studio').split(',');
  const fit = ids => page.evaluate(list => { window.__vm.fakeWeapons.fitted = new Set(list); }, ids);
  await page.evaluate(() => {
    const view = window.__vm;
    view.ctx.render.renderer.setPixelRatio(2);
    view.ammo.magSize = 7;
    view.ammo.mag = 7;
  });
  const equip = async () => {
    await page.evaluate(() => window.__vm.rig.equip('ultramag', 0.01));
    await step(0.6);
  };
  const out = {};
  if (only.includes('fp')) {
    for (const [label, ids] of [['comp', ['ultramagComp']], ['kit', ['ultramagComp', 'ultramagLam', 'ultramagMag', 'ultramagDot']]]) {
      await fit(ids);
      await equip();
      await shot(`fp-hip-${label}`);
      await page.evaluate(() => { window.__vm.rig.setAim(1); window.__vm.step(0.8); });
      await shot(`fp-ads-${label}`);
      await page.evaluate(() => { window.__vm.rig.setAim(0); window.__vm.step(0.8); });
    }
  }
  if (only.includes('recoil')) {
    const pitch = () => page.evaluate(() => {
      const root = window.__vm.rig.allDefs.ultramag.model.root;
      root.updateMatrixWorld(true);
      const e = root.matrixWorld.elements;
      return Math.asin(Math.max(-1, Math.min(1, -e[9] / Math.hypot(e[8], e[9], e[10]))));
    });
    out.pitch = {};
    for (const [label, ids] of [['bare', []], ['comp', ['ultramagComp']]]) {
      await fit(ids);
      await equip();
      const rest = await pitch();
      await page.evaluate(() => { window.__vm.ammo.mag = 6; window.__vm.rig.fire(1); });
      const trace = [];
      for (let i = 0; i <= 36; i++) {
        trace.push(Math.round((await pitch() - rest) * 1000));
        // The peak and the slide hanging open: the stills.
        if (i === 3) await shot(`recoil-${label}-25ms`);
        if (i === 10) await shot(`recoil-${label}-83ms`);
        await step(1 / 120);
      }
      await step(0.4);
      out.pitch[label] = { mradUp: trace, max: Math.max(...trace) };
    }
  }
  if (only.includes('close')) {
    await fit(['ultramagComp', 'ultramagLam']);
    await equip();
    // Cameras in the gun's frame round the comp's middle (eye, target, both model-space metres).
    const CAMS = {
      'close-front-right': [[0.16, 0.12, -0.52], [0, 0.02, -0.33]],
      'close-top': [[0.05, 0.24, -0.26], [0, 0.04, -0.34]],
      'close-left': [[-0.26, 0.05, -0.33], [0, 0.0, -0.31]],
      'close-front': [[0.06, 0.06, -0.62], [0, 0.0, -0.32]],
      'close-rear-right': [[0.14, 0.13, -0.12], [0, 0.03, -0.33]],
    };
    for (const [name, [eye, target]] of Object.entries(CAMS)) {
      await page.evaluate(([e, t]) => {
        const view = window.__vm;
        const root = view.rig.allDefs.ultramag.model.root;
        root.updateMatrixWorld(true);
        const cam = view.ctx.render.viewCamera;
        window.__camSaved ??= { p: cam.position.clone(), q: cam.quaternion.clone(), update: view.rig.update.bind(view.rig) };
        const eyeW = root.localToWorld(root.position.clone().set(...e));
        const targetW = root.localToWorld(root.position.clone().set(...t));
        view.rig.update = () => { window.__camSaved.update(); cam.position.copy(eyeW); cam.lookAt(targetW); cam.updateMatrixWorld(); };
      }, [eye, target]);
      await step(0.05);
      await shot(name);
    }
    // The slide at full travel from the rear-right camera: the comp stays on the barrel.
    await page.evaluate(() => { window.__vm.ammo.mag = 6; window.__vm.rig.fire(1); });
    await step(0.09);
    await shot('close-rear-right-open');
    await step(0.5);
    await page.evaluate(() => {
      const view = window.__vm;
      const s = window.__camSaved;
      if (!s) return;
      view.rig.update = s.update;
      const cam = view.ctx.render.viewCamera;
      cam.position.copy(s.p);
      cam.quaternion.copy(s.q);
      cam.updateMatrixWorld();
      delete window.__camSaved;
    });
  }
  if (only.includes('studio')) {
    await page.evaluate(async () => {
      const view = window.__vm;
      const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
      const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
      stage.active = true;
      stage.update(0);
      const c = stage.camera;
      c.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
      window.__stage = stage;
    });
    const turn = (y, x = 0.12) => page.evaluate(([yaw, p]) => {
      window.__stage.turntable.rotation.set(p, yaw, 0);
      window.__vm.ctx.render.render();
    }, [y, x]);
    for (const [label, ids] of [['comp', ['ultramagComp']], ['kit', ['ultramagComp', 'ultramagDot', 'ultramagLam', 'ultramagMag']]]) {
      await page.evaluate(list => window.__stage.show('ultramag', new Set(list)), ids);
      await turn(Math.PI / 2);
      await shot(`studio-${label}-left`);
      await turn(-Math.PI / 2 + 0.75, 0.42);
      await shot(`studio-${label}-three-quarter`);
      await turn(-Math.PI / 2);
      await shot(`studio-${label}-right`);
    }
  }
  out.cost = await page.evaluate(() => {
    const model = window.__vm.rig.allDefs.ultramag.model;
    return { triangles: model.triangles, draws: model.draws };
  });
  return out;
}
