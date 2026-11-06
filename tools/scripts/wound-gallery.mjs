// Close-ups of every kind of damage on the real game, on the Test Range. Hits go through the real damage path; only the
// camera and the clock are taken over, so a wound can be looked at from anywhere.
//
//   WG_SCENES=bullets,shotgun node tools/shot.mjs --url "/?map=range" --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 \
//     --quiet --script tools/scripts/wound-gallery.mjs --out tools/out/wounds.png
//
// Env: WG_SCENES (comma list, default all), WG_TYPE (archetype, default trooper).
const SCENES = (process.env.WG_SCENES ?? 'bullets,shotgun,blast,cannon,sword,burn,fracture,corpse').split(',');
const TYPE = process.env.WG_TYPE ?? 'trooper';

function install() {
  const { ctx, game } = window.__op2;
  const lab = window.__lab;
  const r = ctx.render;
  r.dynamicResolution.enabled = false;
  r.viewScene.visible = false;
  lab.flags.gibbing = false;
  lab.flags.explosiveDeaths = false;
  const V = ctx.player.position.constructor;
  const raf = k => new Promise(res => {
    const step = () => (--k <= 0 ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const freeze = () => { game.frame = () => {}; };
  const thaw = () => { delete game.frame; };
  const place = (id, x, z, yaw = 0) => {
    const e = lab.spawner.place(id, new V(x, 0, z), 'off');
    e.yaw = yaw;
    // Health only stops the hit killing: the size of a wound reads maxHealth.
    e.health = 1e6;
    return e;
  };
  /** A real ray at a real bone: from `from`, through a point in that bone's frame. */
  const shoot = (e, source, type, amount, from, bone, off = [0, 0, 0], extra = {}) => {
    e.char.root.updateMatrixWorld(true);
    const o = new V(...from);
    const aim = new V(...off).applyMatrix4(e.char.bones[bone].matrixWorld);
    const dir = aim.clone().sub(o).normalize();
    const hit = ctx.gore.raycastCharacter(e.char, o, dir, 30);
    if (!hit) return null;
    return ctx.enemies.applyDamage(e, { amount, type, point: hit.point.clone(), dir, force: 0, source, region: hit.region, bone: hit.bone, ...extra });
  };
  const look = (pos, target, fov = 40) => {
    const c = r.camera;
    c.position.set(...pos);
    c.fov = fov;
    c.updateProjectionMatrix();
    c.lookAt(...target);
    c.updateMatrixWorld();
  };
  const frame = () => new Promise(res => requestAnimationFrame(() => { r.render(); requestAnimationFrame(res); }));
  const clear = async () => {
    thaw();
    ctx.enemies.reset();
    lab.spawner.clearBodies();
    await raf(4);
  };
  window.__wg = { ctx, lab, V, raf, freeze, thaw, place, shoot, look, frame, clear };
}

const SCENE = {
  async bullets(page, h, type) {
    await page.evaluate(async type => {
      const w = window.__wg;
      await w.clear();
      const e = w.place(type, 0, 0, 0);
      await w.raf(30);
      w.freeze();
      const F = [0.2, 1.4, 3];
      for (const [bone, off] of [[2, [0.06, 0.1, 0.1]], [2, [-0.09, 0.16, 0.1]], [1, [0.05, 0.05, 0.1]], [11, [0, -0.22, 0.05]], [2, [-0.12, 0.02, 0.1]]]) w.shoot(e, 'smg', 'bullet', 12, F, bone, off);
      w.shoot(e, 'judge', 'bullet', 60, F, 1, [-0.07, 0.1, 0.1]);
      await w.frame();
    }, type);
    await page.evaluate(() => { window.__wg.look([0.25, 1.35, 1.5], [0, 1.2, 0], 34); return window.__wg.frame(); });
    await h.shot('bullets-1m5');
    await page.evaluate(() => { window.__wg.look([0.2, 1.3, 0.55], [0, 1.2, 0], 34); return window.__wg.frame(); });
    await h.shot('bullets-close');
    await page.evaluate(() => { window.__wg.look([-0.3, 1.35, -1.4], [0, 1.2, 0], 34); return window.__wg.frame(); });
    await h.shot('bullets-back');
    await page.evaluate(() => { window.__wg.look([0.5, 1.5, 10], [0, 1.1, 0], 40); return window.__wg.frame(); });
    await h.shot('bullets-10m');
  },
};

export default async function gallery(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.addStyleTag({ content: 'body > *:not(canvas):not(#game) { visibility: hidden !important; }' });
  await page.evaluate(install);
  const out = {};
  for (const name of SCENES) {
    if (!SCENE[name]) continue;
    out[name] = (await SCENE[name](page, h, TYPE)) ?? 'ok';
  }
  return out;
}
