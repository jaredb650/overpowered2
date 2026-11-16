const ids = (process.env.HAND_IDS ?? 'smg,harrow,shotgun,buzzsaw').split(',');

export default async function hands(page, h) {
  await page.waitForFunction(() => !!window.__vm);
  const captures = [];
  for (const id of ids) {
    await page.evaluate(id => {
      const v = window.__vm;
      const weapon = id === 'gimlet-launcher' ? 'gimlet' : id;
      v.fakeWeapons.fitted = new Set(id === 'gimlet-launcher' ? ['gimletGl'] : []);
      v.fakeWeapons.launcherUp = id === 'gimlet-launcher';
      v.cam(0, 0, 0, 0, 0, -1);
      v.rig.equip(weapon, 0.01);
      v.step(0.5);
      if (v.rig.currentDef?.id !== weapon) throw new Error(`No viewmodel for ${id}`);
    }, id);
    await h.sleep(100);
    await h.shot(`${id}-fp`);
    captures.push(await page.evaluate(() => {
      const v = window.__vm;
      const hand = v.rig.armL.bones[3];
      const at = hand.getWorldPosition(v.player.position.clone());
      v.cam(at.x - 0.36, at.y + 0.09, at.z + 0.09, at.x, at.y + 0.02, at.z - 0.08);
      return { id: v.rig.currentDef.id, wrist: at.toArray(), rotation: hand.quaternion.toArray() };
    }));
    await h.sleep(100);
    await h.shot(`${id}-side`);
    await page.evaluate(() => {
      const v = window.__vm;
      const at = v.rig.armL.bones[3].getWorldPosition(v.player.position.clone());
      v.cam(at.x + 0.36, at.y + 0.12, at.z - 0.04, at.x, at.y + 0.02, at.z - 0.08);
    });
    await h.sleep(100);
    await h.shot(`${id}-far`);
  }
  await page.evaluate(() => {
    const v = window.__vm;
    v.fakeWeapons.fitted = new Set();
    v.fakeWeapons.launcherUp = false;
    v.cam(0, 0, 0, 0, 0, -1);
    v.rig.equip('smg', 0.01);
    v.step(0.5);
  });
  for (const implant of ['bloodthirst', 'hellfire', 'berserk']) {
    await page.evaluate(async implant => {
      const { wearOnViewmodel } = await import('/src/characters/implants.ts');
      const v = window.__vm;
      v.ctx.viewmodel = v.rig;
      wearOnViewmodel(v.ctx, implant);
      v.step(0.1);
    }, implant);
    await h.sleep(100);
    await h.shot(`smg-${implant}`);
  }
  await page.evaluate(async () => {
    const { wearOnViewmodel } = await import('/src/characters/implants.ts');
    wearOnViewmodel(window.__vm.ctx, null);
  });
  await page.evaluate(() => {
    const v = window.__vm;
    v.cam(0, 0, 0, 0, 0, -1);
    v.rig.equip('smg', 0.01);
    v.step(0.5);
    v.rig.offhand.tap();
  });
  let elapsed = 0;
  for (const time of [0.1, 0.2, 0.3, 0.42]) {
    await page.evaluate(dt => window.__vm.step(dt), time - elapsed);
    elapsed = time;
    await h.sleep(100);
    await h.shot(`tap-${time}`);
    if (time === 0.2) {
      await page.evaluate(() => window.__vm.cam(-0.18, 0.04, 0.2, -0.18, 0.04, -0.3));
      await h.sleep(100);
      await h.shot('tap-palm-inspect');
      await page.evaluate(() => window.__vm.cam(0, 0, 0, 0, 0, -1));
    }
  }
  if (process.env.HAND_MENU !== '0') {
    await page.goto('http://127.0.0.1:5271/?sandbox=backdrop&hand=0&look=0&exhale=0&ember=1&shift=0');
    await page.waitForFunction(() => !!window.__bd?.body, { timeout: 60000 });
    await h.sleep(500);
    await h.shot('heli-rest');
    for (const hand of [0, 0.5, 1]) {
      await page.evaluate(hand => { window.__bd.poseOverride = { hand, look: 0, exhale: 0, ember: 1, shift: 0 }; }, hand);
      await h.sleep(150);
      await h.shot(`heli-${hand}`);
      await page.evaluate(() => {
        const bd = window.__bd;
        const hand = bd.body.bones[7];
        const at = hand.getWorldPosition(bd.camera.position.clone());
        bd.camera.position.copy(at).add(bd.camera.position.clone().set(0.55, 0.23, -0.1));
        bd.camera.lookAt(at);
        bd.camera.fov = 36;
        bd.camera.updateProjectionMatrix();
        bd.camera.updateMatrixWorld();
        bd.update = () => {};
      });
      await h.sleep(150);
      await h.shot(`heli-wrist-${hand}`);
      if (hand === 0) {
        await page.evaluate(() => {
          const bd = window.__bd;
          const at = bd.body.bones[10].getWorldPosition(bd.camera.position.clone());
          bd.camera.position.copy(at).add(bd.camera.position.clone().set(0.45, 0.2, -0.2));
          bd.camera.lookAt(at);
          bd.camera.updateMatrixWorld();
        });
        await h.sleep(150);
        await h.shot('heli-right-wrist');
      }
      await page.reload();
      await page.waitForFunction(() => !!window.__bd?.body, { timeout: 60000 });
    }
  }
  return captures;
}
