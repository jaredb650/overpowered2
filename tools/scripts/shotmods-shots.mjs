// Renders for the shotgun and Judge mods in the viewmodel sandbox: the Deuce plain, quad, with the speed loader and both
// (hip, the reload frame by frame, the shop's studio), the pump with and without its choke, the Thresher's drum, and the
// Judge's extended hammer and comfort grip. SHOTS picks sets: deuce,reload,shotgun,thresher,judge,close.
//   OP2_NO_HMR=1 npx vite --port 5281 --strictPort
//   node tools/shot.mjs --port 5281 --dpr 2 --w 1440 --h 900 --wait 4000 --timeout 600 --quiet \
//     --url "/?sandbox=viewmodels&manual=1&engine=1&weapon=deuce" --script tools/scripts/shotmods-shots.mjs --out tools/out/mods-c/m.png
export default async function shotmodsShots(page, helpers) {
  await page.waitForFunction(() => !!window.__vm, { timeout: 60000 });
  const step = seconds => page.evaluate(value => window.__vm.step(value), seconds);
  const shot = async name => { await helpers.sleep(60); await helpers.shot(name); };
  const only = (process.env.SHOTS ?? 'deuce,reload,shotgun,thresher,judge').split(',');
  await page.evaluate(() => window.__vm.ctx.render.renderer.setPixelRatio(2));
  const fit = list => page.evaluate(l => { window.__vm.fakeWeapons.fitted = new Set(l); }, list);
  const equip = async (id, mag, size) => {
    await page.evaluate(([w, m, n]) => {
      const v = window.__vm;
      v.ammo.mag = m;
      v.ammo.magSize = n;
      v.rig.equip(w, 0.01);
    }, [id, mag, size]);
    await step(0.6);
  };
  const reload = async (name, seconds, fractions) => {
    await page.evaluate(s => window.__vm.rig.reload(s), seconds);
    let previous = 0;
    for (const f of fractions) {
      await step((f - previous) * seconds);
      previous = f;
      await shot(`${name}-${String(Math.round(f * 100)).padStart(2, '0')}`);
    }
    await step((1 - previous) * seconds + 0.3);
  };
  // Close cameras on the model with the arms hidden: [name, eye, target] in the model's frame.
  const close = async (id, cams) => {
    for (const [name, eye, target] of cams) {
      await page.evaluate(([w, e, t]) => {
        const view = window.__vm;
        const root = view.rig.allDefs[w].model.root;
        const cam = view.ctx.render.viewCamera;
        if (!view.__update) {
          view.__update = view.rig.update.bind(view.rig);
          view.__cam = [cam.position.clone(), cam.quaternion.clone()];
        }
        view.rig.update = (...args) => {
          view.__update(...args);
          view.rig.armR.mesh.visible = view.rig.armL.mesh.visible = false;
          root.updateMatrixWorld(true);
          cam.position.copy(root.localToWorld(root.position.clone().set(...e)));
          cam.lookAt(root.localToWorld(root.position.clone().set(...t)));
          cam.updateMatrixWorld();
        };
      }, [id, eye, target]);
      await step(0.02);
      await shot(name);
    }
    await page.evaluate(() => {
      const view = window.__vm;
      if (view.__update) view.rig.update = view.__update;
      view.__update = null;
      // The close camera moved the view camera itself: put it back where the sandbox had it.
      const cam = view.ctx.render.viewCamera;
      cam.position.copy(view.__cam[0]);
      cam.quaternion.copy(view.__cam[1]);
      cam.updateMatrixWorld();
    });
    await step(0.02);
  };
  const studio = async (id, mods, views) => {
    await page.evaluate(async ([w, list]) => {
      const view = window.__vm;
      if (!window.__stage) {
        const { GunStage } = await import('/src/ui/backdrop/gunstage.ts');
        const stage = new GunStage({ ...view.ctx, viewmodel: view.rig });
        stage.active = true;
        window.__stage = stage;
      }
      const stage = window.__stage;
      stage.active = true;
      stage.show(w, new Set(list));
      stage.update(0);
      stage.camera.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
    }, [id, mods]);
    for (const [name, yaw, pitch] of views) {
      await page.evaluate(([y, x]) => {
        window.__stage.turntable.rotation.set(x, y, 0);
        window.__vm.ctx.render.render();
      }, [yaw, pitch]);
      await shot(name);
    }
    await page.evaluate(() => { window.__stage.active = false; });
  };
  const SIDE = [['studio-right', -Math.PI / 2, 0], ['studio-quarter', -Math.PI / 2 + 0.75, 0.42], ['studio-front', Math.PI / 2 - 0.6, 0.3]];
  const wave = { deuce: [], quad: ['deuceQuad'], loader: ['deuceLoader'], both: ['deuceQuad', 'deuceLoader'] };

  if (only.includes('deuce')) {
    for (const [k, mods] of Object.entries(wave)) {
      await fit(mods);
      await equip('deuce', mods.includes('deuceQuad') ? 4 : 2, mods.includes('deuceQuad') ? 4 : 2);
      await shot(`deuce-${k}-hip`);
    }
    // The plain gun's both barrels (recoil 1.15 x 1.8) beside the quad's four (1.15 x 2.2), 50 and 120 ms after.
    for (const [k, mods, strength] of [['both', [], 2.07], ['quad', ['deuceQuad'], 2.53]]) {
      await fit(mods);
      await equip('deuce', 4, 4);
      await page.evaluate(v => window.__vm.rig.fire(v), strength);
      await step(0.05);
      await shot(`deuce-${k}-fire050`);
      await step(0.07);
      await shot(`deuce-${k}-fire120`);
      await step(0.5);
    }
  }
  if (only.includes('reload')) {
    // Seconds as weapons/data.ts breakLoad gives them: plain 1.5, loader 1.26, quad 1.98, both 1.5.
    const T = { deuce: 1.5, loader: 1.26, quad: 1.98, both: 1.5 };
    const F = (process.env.FRAMES ?? '0.12,0.22,0.3,0.36,0.42,0.5,0.58,0.66,0.8').split(',').map(Number);
    for (const k of (process.env.RELOADS ?? 'deuce,loader,quad,both').split(',')) {
      await fit(wave[k]);
      await equip('deuce', 0, wave[k].includes('deuceQuad') ? 4 : 2);
      await reload(`deuce-${k}-reload`, T[k], F);
    }
  }
  if (only.includes('deuce')) {
    for (const [k, mods] of Object.entries(wave)) await studio('deuce', mods, SIDE.map(([n, y, x]) => [`deuce-${k}-${n}`, y, x]));
  }
  if (only.includes('close')) {
    await fit(['deuceQuad', 'deuceLoader']);
    await equip('deuce', 4, 4);
    await close('deuce', [
      ['deuce-close-breech', [-0.16, 0.14, 0.2], [0, 0.05, -0.02]],
      ['deuce-close-muzzle', [-0.12, 0.08, -0.7], [0, 0.05, -0.45]],
      ['deuce-close-left', [-0.5, 0.06, -0.05], [0, 0.03, -0.12]],
      ['deuce-close-stock', [-0.32, 0.02, 0.2], [0, -0.01, 0.18]],
    ]);
  }
  if (only.includes('shotgun')) {
    for (const [k, mods] of [['pump', []], ['choke', ['shotgunChoke']]]) {
      await fit(mods);
      await equip('shotgun', 6, 6);
      await shot(`shotgun-${k}-hip`);
      await close('shotgun', [[`shotgun-${k}-close`, [-0.12, 0.08, -0.86], [0, 0.03, -0.66]]]);
      await studio('shotgun', mods, SIDE.slice(0, 2).map(([n, y, x]) => [`shotgun-${k}-${n}`, y, x]));
    }
  }
  if (only.includes('thresher')) {
    await fit([]);
    await equip('thresher', 20, 20);
    await shot('thresher-hip');
    await reload('thresher-reload', 2.7, [0.04, 0.12, 0.2, 0.4, 0.48, 0.56, 0.7, 0.8, 0.95]);
    await close('thresher', [
      ['thresher-close-left', [-0.5, -0.04, -0.15], [0, -0.06, -0.15]],
      ['thresher-close-back', [-0.12, -0.02, 0.35], [0, -0.08, -0.13]],
    ]);
    await studio('thresher', [], SIDE.map(([n, y, x]) => [`thresher-${n}`, y, x]));
  }
  if (only.includes('judge')) {
    for (const [k, mods] of [['judge', []], ['hammer', ['judgeHammer']], ['grip', ['judgeGrip']], ['both', ['judgeHammer', 'judgeGrip']]]) {
      await fit(mods);
      await equip('judge', 6, 6);
      await shot(`judge-${k}-hip`);
      await studio('judge', mods, SIDE.slice(0, 2).map(([n, y, x]) => [`judge-${k}-${n}`, y, x]));
    }
    await close('judge', [
      ['judge-close-right', [0.32, 0.0, 0.03], [0, -0.02, 0.03]],
      ['judge-close-left', [-0.32, 0.0, 0.03], [0, -0.02, 0.03]],
      ['judge-close-hammer', [0.12, 0.12, 0.2], [0, 0.05, 0.05]],
    ]);
    // The fan pose: the off hand over the hammer, then a slap.
    await page.evaluate(() => window.__vm.rig.setCharge(1));
    await step(0.4);
    await shot('judge-both-fanhold');
    await page.evaluate(() => window.__vm.rig.fire(0.6));
    await step(0.04);
    await shot('judge-both-fanslap');
    await page.evaluate(() => window.__vm.rig.setCharge(0));
    await step(0.4);
  }
  return page.evaluate(() => {
    const d = window.__vm.rig.allDefs;
    return Object.fromEntries(['deuce', 'shotgun', 'thresher', 'judge'].map(id => [id, { tris: d[id].model.triangles, draws: d[id].model.draws }]));
  });
}
