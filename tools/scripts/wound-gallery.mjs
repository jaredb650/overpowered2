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
  lab.settings.overlay = false;
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
  /** Long enough for hit flashes to fade, which they do on the world clock. */
  const settle = async () => {
    thaw();
    await raf(80);
    freeze();
  };
  /** A point in front of the body under test, as if it stood at the origin. */
  const front = (x, y, z) => {
    const at = window.__wgBody.char.root.position;
    return [x + at.x, y, z + at.z];
  };
  window.__wg = { ctx, lab, V, raf, freeze, thaw, place, shoot, look, frame, clear, settle, front };
}

/** Runs `build` on a fresh body, then takes a picture from each named view. */
async function scene(page, h, name, type, build, views) {
  await page.evaluate(async ([type, src]) => {
    const w = window.__wg;
    await w.clear();
    const e = w.place(type, 8, -6, 0);
    await w.raf(30);
    w.freeze();
    window.__wgBody = e;
    await (0, eval)(`(${src})`)(w, e);
    await w.settle();
  }, [type, build.toString()]);
  for (const [view, pos, target, fov] of views) {
    await page.evaluate(([pos, target, fov]) => {
      const w = window.__wg;
      // Knockback moves a body while the hit flash fades, so every view goes from where it ended up.
      const at = window.__wgBody.char.root.position;
      w.look([pos[0] + at.x, pos[1], pos[2] + at.z], [target[0] + at.x, target[1], target[2] + at.z], fov);
      return w.frame();
    }, [pos, target, fov]);
    await h.shot(`${name}-${view}`);
  }
}

const NEAR = [['1m5', [0.25, 1.35, 1.5], [0, 1.2, 0], 34], ['close', [0.2, 1.3, 0.6], [0, 1.2, 0], 34], ['10m', [0.5, 1.5, 10], [0, 1.1, 0], 34]];
const BACK = ['back', [-0.3, 1.35, -1.4], [0, 1.2, 0], 34];
const SCENE = {
  bullets: (p, h, t) => scene(p, h, 'bullets', t, async (w, e) => {
    const F = w.front(0.2, 1.4, 3);
    for (const [bone, off] of [[2, [0.06, 0.1, 0.1]], [2, [-0.09, 0.16, 0.1]], [1, [0.05, 0.05, 0.1]], [11, [0, -0.22, 0.05]], [2, [-0.12, 0.02, 0.1]]]) w.shoot(e, 'smg', 'bullet', 12, F, bone, off);
    w.shoot(e, 'judge', 'bullet', 40, F, 1, [-0.07, 0.1, 0.1]);
  }, [...NEAR, BACK]),
  shotgun: (p, h, t) => scene(p, h, 'shotgun', t, async (w, e) => {
    const F = w.front(0.1, 1.35, 2);
    for (let i = 0; i < 6; i++) w.shoot(e, 'shotgun', 'pellet', 20, F, 2, [0.05 + (Math.random() - 0.5) * 0.16, 0.02 + (Math.random() - 0.5) * 0.16, 0.1]);
  }, NEAR),
  blast: (p, h, t) => scene(p, h, 'blast', t, async (w, e) => {
    const { V, ctx } = w;
    const c = e.char.bones[2].getWorldPosition(new V());
    c.y += 0.12;
    const dir = new V(0.1, -0.05, -1).normalize();
    ctx.enemies.applyDamage(e, { amount: 60, type: 'explosive', point: c, dir, force: 0, source: 'rocket' });
  }, NEAR),
  belly: (p, h, t) => scene(p, h, 'belly', t, async (w, e) => {
    const { V, ctx } = w;
    const c = e.char.bones[1].getWorldPosition(new V());
    const dir = new V(-0.1, 0.05, -1).normalize();
    ctx.enemies.applyDamage(e, { amount: 55, type: 'explosive', point: c, dir, force: 0, source: 'rocket' });
  }, [['1m5', [0.2, 1.1, 1.5], [0, 1.05, 0], 34], ['close', [0.15, 1.1, 0.65], [0, 1.05, 0], 34]]),
  cannon: (p, h, t) => scene(p, h, 'cannon', t, async (w, e) => {
    w.shoot(e, 'autocannon', 'bullet', 90, w.front(0.3, 1.4, 6), 2, [0.04, 0.08, 0.1]);
  }, [...NEAR, BACK]),
  sword: (p, h, t) => scene(p, h, 'sword', t, async (w, e) => {
    const { V } = w;
    w.shoot(e, 'sword', 'slash', 40, w.front(0, 1.4, 2), 2, [-0.02, 0.1, 0.1], { slicePlaneNormal: new V(0.5, 0.86, 0).normalize() });
    w.shoot(e, 'sword', 'slash', 25, w.front(0.3, 1.4, 2), 11, [0, -0.2, 0.05], { slicePlaneNormal: new V(0.2, 0.98, 0).normalize() });
  }, NEAR),
  burn: (p, h, t) => scene(p, h, 'burn', t, async (w, e) => {
    e.char.setBurn(0.85);
  }, NEAR),
  scorch: (p, h, t) => scene(p, h, 'scorch', t, async (w, e) => {
    w.shoot(e, 'kiln', 'fire', 9, w.front(0.1, 1.4, 2), 2, [0.05, 0.1, 0.1]);
    w.shoot(e, 'kiln', 'fire', 9, w.front(0.1, 1.4, 2), 1, [-0.05, 0.1, 0.1]);
    w.shoot(e, 'kiln', 'fire', 9, w.front(0.1, 1.4, 2), 11, [0, -0.15, 0.08]);
  }, NEAR),
  fracture: (p, h, t) => scene(p, h, 'fracture', t, async (w, e) => {
    w.shoot(e, 'judge', 'bullet', 30, w.front(0.6, 0.6, 3), 12, [0, -0.15, 0.06]);
    w.shoot(e, 'judge', 'bullet', 30, w.front(0.6, 1.2, 3), 9, [-0.04, -0.12, 0.05]);
    w.shoot(e, 'judge', 'bullet', 30, w.front(-0.8, 1.3, 3), 5, [0.05, -0.14, 0.05]);
  }, [['full', [0.8, 1.0, 3.2], [0, 0.95, 0], 36], ['side', [3.2, 1.0, 0.3], [0, 0.95, 0], 36], ['knee', [0.15, 0.6, 1], [0, 0.5, 0], 36], ['arm', [-0.7, 1.3, 1.1], [0.2, 1.15, 0.1], 36]]),
};

/** A body with damage on it, then dead, then shot again where it lies. */
SCENE.corpse = async (page, h, type) => {
  await page.evaluate(async type => {
    const w = window.__wg;
    await w.clear();
    const e = w.place(type, 8, -6, 0);
    window.__wgBody = e;
    await w.raf(30);
    w.freeze();
    const F = w.front(0.1, 1.35, 2);
    for (let i = 0; i < 6; i++) w.shoot(e, 'shotgun', 'pellet', 20, F, 2, [0.05 + (Math.random() - 0.5) * 0.12, 0.05 + (Math.random() - 0.5) * 0.12, 0.1]);
    w.shoot(e, 'judge', 'bullet', 30, w.front(0.6, 0.6, 3), 12, [0, -0.15, 0.06]);
    e.health = 1;
    w.shoot(e, 'smg', 'bullet', 20, F, 1, [0, 0.05, 0.1]);
    w.thaw();
    await w.raf(150);
    w.freeze();
    window.__wgStats = { corpses: w.ctx.gore.stats().corpses, ragdolls: w.ctx.gore.stats().ragdolls };
    const hips = e.char.bones[0].getWorldPosition(new w.V());
    w.look([hips.x + 1.2, 1.0, hips.z + 1.6], [hips.x, 0.25, hips.z], 40);
    await w.frame();
  }, type);
  await h.shot('corpse-down');
  const after = await page.evaluate(async () => {
    const w = window.__wg;
    const { ctx, V } = w;
    const e = ctx.gore.bodies?.[0]?.char ?? null;
    const c = ctx.gore.bodies[0].char;
    const hips = c.bones[2].getWorldPosition(new V());
    const from = new V(hips.x + 0.8, hips.y + 1.2, hips.z + 0.9);
    const dir = hips.clone().sub(from).normalize();
    w.thaw();
    await w.raf(2);
    for (let i = 0; i < 4; i++) {
      const hit = ctx.gore.raycastCorpses(from, dir, 4);
      if (hit) ctx.gore.damageCorpse(hit, { amount: 20, type: 'pellet', point: hit.point, dir, force: 5, source: 'shotgun', severMult: 0 });
    }
    await w.raf(40);
    w.freeze();
    const p = c.bones[2].getWorldPosition(new V());
    w.look([p.x + 0.9, p.y + 0.9, p.z + 1.1], [p.x, p.y, p.z], 40);
    await w.frame();
    return { body: !!e, corpses: ctx.gore.stats().corpses };
  });
  await h.shot('corpse-shot');
  return after;
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
