// Partial head wounds, close up and at range, in the gore sandbox (docs/proposals/partial-head-wounds.md). One contact sheet
// of both bodies of the `headpartial` scenario (left: shot in the face, right: in the side of the head), round each head from
// its own front, sides, three-quarters, top and back, then from 10 and 18 m, just after the shot and again once it has landed.
//   node tools/shot.mjs --url "/?sandbox=gore&scenario=headpartial&arch=trooper&hold=1" --script tools/scripts/headpartial-shots.mjs \
//     --dpr 2 --w 1440 --h 900 --wait 1500 --out tools/out/headpartial2/sheet.png
// HP_CHECK=1 then bursts the left head and shoots off the right one as a corpse would, shoots the right one's flight, and
// returns what was left on each body and after the pool reset it. HP_AT="24,160" picks the frames, HP_TAG names the files. Full-size close-ups land next to --out as <tag>-f<frame>-<body>-<view>.png.
const frames = (process.env.HP_AT ?? '24,160').split(',').map(Number);
const tag = process.env.HP_TAG ?? 'hp';
const close = (process.env.HP_CLOSE ?? '').split(',').filter(Boolean);
const check = process.env.HP_CHECK === '1';

const VIEWS = [
  ['front', [0, 0.05, 1], 0.8], ['3q+x', [0.7, 0.15, 0.7], 0.8], ['side+x', [1, 0.1, 0], 0.8], ['3q-x', [-0.7, 0.15, 0.7], 0.8],
  ['side-x', [-1, 0.1, 0], 0.8], ['top', [0.2, 1, 0.4], 0.8], ['back', [0.3, 0.2, -1], 0.8], ['10m', [0.5, 0.05, 1], 10], ['18m', [0.4, 0.04, 1], 18],
];

export default async function shots(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => (window.__gore?.gore.standIns?.size ?? 0) >= 2)) break;
    await h.sleep(250);
  }
  for (const f of frames) {
    const names = await page.evaluate(([f, VIEWS]) => {
      const g = window.__gore;
      g.hold();
      while (g.stage.frame < f) g.step(1);
      for (const c of g.stage.row) c.setLod?.(0);
      const cam = g.ctx.render.camera;
      const V = cam.position.constructor;
      const canvas = document.querySelector('canvas');
      const dpr = devicePixelRatio;
      const cols = 5;
      const w = Math.floor((innerWidth * dpr) / cols);
      const hh = Math.floor(w * 0.75);
      const out = document.createElement('canvas');
      out.width = w * cols;
      out.height = hh * 2 * g.stage.row.length;
      const c2 = out.getContext('2d');
      c2.font = `${12 * dpr}px monospace`;
      g.stage.row.forEach((c, body) => {
        const head = c.bones[4];
        head.updateWorldMatrix(true, false);
        const q = head.getWorldQuaternion(new cam.quaternion.constructor());
        const at = new V(0, 0.09, 0).applyQuaternion(q).add(new V().setFromMatrixPosition(head.matrixWorld));
        VIEWS.forEach(([name, d, dist], i) => {
          const col = i % cols, row = body * 2 + Math.floor(i / cols);
          // Round the head as it lies, but never from under the floor; range views from the scenario camera's side.
          const dir = dist > 2 ? new V(...d) : new V(...d).normalize().applyQuaternion(q);
          dir.y = Math.max(dir.y, dist > 2 ? 0.04 : 0.25);
          dir.normalize();
          cam.fov = dist > 2 ? 12 : 40;
          cam.aspect = innerWidth / innerHeight;
          cam.updateProjectionMatrix();
          cam.position.copy(at).addScaledVector(dir, dist);
          cam.lookAt(at);
          g.ctx.render.render();
          // The middle of the frame, in the tile's aspect.
          const sw = canvas.width * 0.62, sh = sw * 0.75;
          c2.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, col * w, row * hh, w, hh);
          c2.fillStyle = '#ffee44';
          c2.fillText(`f${f} ${body ? 'R side' : 'L face'} ${name}`, col * w + 6 * dpr, row * hh + 16 * dpr);
        });
      });
      out.style.cssText = `position:fixed;left:0;top:0;z-index:9;background:#000;width:${innerWidth}px`;
      out.id = 'hp-sheet';
      document.body.appendChild(out);
      canvas.style.visibility = 'hidden';
      return VIEWS.map(v => v[0]);
    }, [f, VIEWS]);
    await h.sleep(300);
    await h.shot(`${tag}-f${f}-sheet`);
    await page.evaluate(() => {
      document.getElementById('hp-sheet').remove();
      document.querySelector('canvas').style.visibility = '';
    });
    // Full-frame close-ups of the views asked for, as `body:view` (L or R).
    for (const want of close) {
      const [body, view] = want.split(':');
      if (!names.includes(view)) continue;
      await page.evaluate(([row, v]) => {
        const g = window.__gore;
        const cam = g.ctx.render.camera;
        const V = cam.position.constructor;
        const c = g.stage.row[row];
        const head = c.bones[4];
        const q = head.getWorldQuaternion(new cam.quaternion.constructor());
        const at = new V(0, 0.09, 0).applyQuaternion(q).add(new V().setFromMatrixPosition(head.matrixWorld));
        cam.fov = v[2] > 2 ? 8 : 30;
        cam.updateProjectionMatrix();
        const dir = v[2] > 2 ? new V(...v[1]) : new V(...v[1]).normalize().applyQuaternion(q);
        dir.y = Math.max(dir.y, v[2] > 2 ? 0.04 : 0.25);
        cam.position.copy(at).addScaledVector(dir.normalize(), v[2]);
        cam.lookAt(at);
        g.ctx.render.render();
      }, [body === 'R' ? 1 : 0, VIEWS.find(x => x[0] === view)]);
      await h.sleep(150);
      await h.shot(`${tag}-f${f}-${body}-${view}`);
    }
  }
  if (!check) return;
  const result = await page.evaluate(() => {
    const g = window.__gore;
    const [L, R] = g.stage.row;
    const V = g.ctx.render.camera.position.constructor;
    const standIn = c => c.props.find(p => p.untilReset);
    const shown = c => { const p = standIn(c); return p ? p.object.visible && p.object.parent === c.bones[4] && c.bones[3].scale.x > 0.5 : false; };
    const before = { L: shown(L), R: shown(R), shared: L.skeleton.boneInverses === L.a.bindInverses };
    const hit = c => ({ amount: 200, type: 'bullet', point: new V().setFromMatrixPosition(c.bones[4].matrixWorld), dir: new V(0, 0, -1), force: 1, source: 'rifle' });
    g.gore.headshot(L, hit(L), undefined, 'burst');
    g.gore.sever(R, 'head', hit(R));
    g.step(10);
    const after = { L: shown(L), R: shown(R), Lneck: L.bones[3].scale.x, Rneck: R.bones[3].scale.x };
    // The severed head carries a copy of the stand-in.
    let flying = 0;
    g.ctx.render.scene.traverse(o => { if (o.name === 'trooperHeadPartialSide' || o.name === 'trooperHeadPartialTop') if (o.visible && o.parent && !g.stage.row.some(c => c.bones.includes(o.parent))) flying++; });
    L.release();
    const reset = { props: L.props.filter(p => p.untilReset).length, inverses: L.skeleton.boneInverses === L.a.bindInverses, head: L.bones[4].scale.x, helmetVisible: L.props.filter(p => p.bone === 4).map(p => p.object.visible) };
    return { before, after, flying, reset };
  });
  console.log(JSON.stringify(result));
  await h.shot(`${tag}-check`);
  return result;
}
