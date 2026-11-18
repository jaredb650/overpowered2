// The katana's energy blade in the viewmodel sandbox: idle beside the steel katana, igniting on the draw, a swing's trail stepped
// frame by frame, a close look at the emitter hilt, and the shop studio.
//   node tools/shot.mjs --port 5211 --dpr 2 --w 1440 --h 900 --wait 4000 \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=sword" --script tools/scripts/energy-vm.mjs --out tools/out/energy/vm.png
// ENERGY_ONLY=idle,ignite,swing,close,studio picks steps.
const only = (process.env.ENERGY_ONLY ?? 'idle,ignite,swing,studio').split(',');

export default async function energyVm(page, h) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const shot = async name => { await h.sleep(80); await h.shot(name); };
  await page.evaluate(() => {
    const view = window.__vm;
    view.ctx.render.renderer.setPixelRatio(2);
    // One frame of play: the rig steps, then the frame is drawn, so the trail samples as it would in a game.
    window.frames = n => { for (let i = 0; i < n; i++) { view.step(1 / 60); view.ctx.render.render(); } };
    window.fit = on => { view.fakeWeapons.fitted = new Set(on ? ['swordEnergy'] : []); };
  });
  const frames = n => page.evaluate(k => window.frames(k), n);
  const equip = async (on, seconds = 0.01) => {
    await page.evaluate(([e, s]) => { window.fit(e); window.__vm.rig.equip('sword', s); }, [on, seconds]);
  };
  const out = {};
  if (only.includes('idle')) {
    await equip(false);
    await frames(40);
    await shot('idle-steel');
    await equip(true);
    await frames(40);
    await shot('idle-energy');
  }
  if (only.includes('ignite')) {
    await equip(true, 0.14);
    for (const [name, n] of [['0', 1], ['1', 3], ['2', 3], ['3', 6]]) {
      await frames(n);
      await shot(`ignite-${name}`);
    }
  }
  if (only.includes('swing')) {
    for (const [move, seconds] of [['light1', 0.25 / 1.4], ['light3', 0.35 / 1.4]]) {
      await equip(true);
      await frames(30);
      await page.evaluate(([m, s]) => window.__vm.rig.swing(m, s), [move, seconds]);
      for (let i = 1; i <= 4; i++) {
        await frames(2);
        await shot(`swing-${move}-${i}`);
      }
      await frames(30);
    }
  }
  if (only.includes('close')) {
    await equip(true);
    await frames(30);
    await page.evaluate(() => {
      const view = window.__vm;
      const root = view.rig.allDefs.sword.model.root;
      root.updateMatrixWorld(true);
      const target = root.localToWorld(root.position.clone().set(0, 0, -0.08));
      const eye = root.localToWorld(root.position.clone().set(0.16, 0.12, 0.12));
      const cam = view.ctx.render.viewCamera;
      const update = view.rig.update.bind(view.rig);
      view.rig.update = () => { update(); cam.position.copy(eye); cam.lookAt(target); cam.updateMatrixWorld(); };
    });
    await frames(2);
    await shot('close-hilt');
  }
  if (only.includes('studio')) {
    await page.evaluate(async () => {
      const view = window.__vm;
      const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
      const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
      stage.active = true;
      stage.update(0);
      stage.camera.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
      window.__stage = stage;
    });
    const turn = (y, x = 0.12) => page.evaluate(([yaw, pitch]) => {
      window.__stage.turntable.rotation.set(pitch, yaw, 0);
      window.__vm.ctx.render.render();
    }, [y, x]);
    for (const [label, mods] of [['energy', ['swordEnergy']], ['steel', []]]) {
      await page.evaluate(list => window.__stage.show('sword', new Set(list)), mods);
      await turn(Math.PI / 2);
      await shot(`studio-${label}-left`);
      if (label === 'energy') {
        await turn(-Math.PI / 2 + 0.75, 0.42);
        await shot(`studio-${label}-three-quarter`);
        // Close on the hilt: the camera narrowed, the table moved so the emitter is in the middle.
        for (const [name, yaw, pitch] of [['hilt-left', Math.PI / 2 + 0.35, 0.25], ['hilt-front', -0.6, 0.3]]) {
          await page.evaluate(([y, x]) => {
            const stage = window.__stage;
            const table = stage.turntable;
            table.position.set(0, 0, 0);
            table.rotation.set(x, y, 0);
            table.updateMatrixWorld(true);
            const hilt = table.getObjectByName('energy');
            const at = hilt.localToWorld(hilt.position.clone().set(0, 0, 0.0)).sub(table.position);
            table.position.sub(at);
            stage.camera.zoom = 4.5;
            stage.camera.updateProjectionMatrix();
            window.__vm.ctx.render.render();
          }, [yaw, pitch]);
          await shot(`studio-${name}`);
        }
        await page.evaluate(() => {
          const stage = window.__stage;
          stage.turntable.position.set(0, 0, 0);
          stage.camera.zoom = 1;
          stage.camera.updateProjectionMatrix();
        });
      }
    }
  }
  out.cost = await page.evaluate(() => {
    const m = window.__vm.rig.allDefs.sword.model;
    return { triangles: m.triangles, draws: m.draws };
  });
  return out;
}
