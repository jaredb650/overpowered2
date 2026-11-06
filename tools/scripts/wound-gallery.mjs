// Close-ups of every kind of damage on the real game, on the Test Range. Hits go through the real damage path; only the
// camera and the clock are taken over, so a wound can be looked at from anywhere.
//
//   WG_SCENES=bullets,shotgun node tools/shot.mjs --url "/?map=range" --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 \
//     --quiet --script tools/scripts/wound-gallery.mjs --out tools/out/wounds.png
//
// Env: WG_SCENES (comma list, default all), WG_TYPE (archetype, default trooper).
const SCENES = (process.env.WG_SCENES ?? 'warm,bullets,shotgun,blast,belly,cannon,sword,burn,scorch,fracture,limb,corpse').split(',');
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
    for (const k of [...e.limbHp.keys()]) e.limbHp.set(k, 1e6);
    return e;
  };
  /** A real ray at a real bone: from `from`, through a point in that bone's frame. */
  const shoot = (e, source, type, amount, from, bone, off = [0, 0, 0], extra = {}) => {
    e.char.root.updateMatrixWorld(true);
    const o = new V(...from);
    // Pellets read the range from the player.
    ctx.player.eye.copy(o);
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
  // Bodies stay on their feet for the camera. A hit that would have floored one staggers it.
  ctx.gore.knockdown = () => false;
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
  const list = await page.evaluate(() => {
    const c = window.__wgBody.char;
    const b = c.book;
    const K = ['hole', 'exit', 'crater', 'gash', 'burn', 'graze', 'dent'];
    const rows = [];
    for (let i = 0; i < b.count; i++) rows.push(`${K[b.kind(i)]} r=${b.radius(i).toFixed(3)} d=${b.depth(i).toFixed(3)}`);
    return { wounds: rows, open: b.open, health: window.__wgBody.health, alive: window.__wgBody.alive, severed: [...c.severed], down: window.__wgBody.downed };
  });
  console.error(name, JSON.stringify(list));
  for (const [view, pos, target, fov] of views) {
    await page.evaluate(([pos, target, fov]) => {
      const w = window.__wg;
      // Knockback moves a body while the hit flash fades, so every view goes from where it ended up.
      const at = window.__wgBody.char.bones[2].getWorldPosition(new w.V());
      // A hit can put a body on the floor, and then the views look down at it from above.
      const down = at.y < 0.8;
      const y = at.y - 1.25;
      if (down) w.look([at.x + pos[0] * 0.5, at.y + pos[2], at.z + pos[0]], [at.x, at.y, at.z], fov);
      else w.look([pos[0] + at.x, pos[1] + y, pos[2] + at.z], [target[0] + at.x, target[1] + y, target[2] + at.z], fov);
      return w.frame();
    }, [pos, target, fov]);
    await h.shot(`${name}-${view}`);
  }
}

const NEAR = [['1m5', [0.25, 1.35, 1.5], [0, 1.2, 0], 34], ['close', [0.2, 1.3, 0.6], [0, 1.2, 0], 34], ['10m', [0.5, 1.5, 10], [0, 1.1, 0], 34]];
const BACK = ['back', [-0.3, 1.35, -1.4], [0, 1.2, 0], 34];
const SCENE = {
  healthy: (p, h, t) => scene(p, h, 'healthy', t, async () => {}, [['neck', [0.3, 1.55, 1.1], [0, 1.45, 0], 34]]),
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
    w.shoot(e, 'sword', 'slash', 40, w.front(0.1, 1.1, 2), 1, [0.02, 0.06, 0.1], { slicePlaneNormal: new V(0.5, 0.86, 0).normalize() });
    w.shoot(e, 'sword', 'slash', 25, w.front(0.3, 0.9, 2), 11, [0, -0.2, 0.05], { slicePlaneNormal: new V(0.2, 0.98, 0).normalize() });
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
    w.shoot(e, 'judge', 'bullet', 50, w.front(0.6, 0.6, 3), 12, [0, -0.15, 0.06]);
    w.shoot(e, 'judge', 'bullet', 50, w.front(0.6, 1.2, 3), 9, [-0.04, -0.12, 0.05]);
    w.shoot(e, 'judge', 'bullet', 50, w.front(-0.8, 1.3, 3), 5, [0.05, -0.14, 0.05]);
  }, [['full', [0.8, 1.0, 3.2], [0, 0.95, 0], 36], ['side', [3.2, 1.0, 0.3], [0, 0.95, 0], 36], ['knee', [0.15, 0.6, 1], [0, 0.5, 0], 36], ['arm', [-0.7, 1.3, 1.1], [0.2, 1.15, 0.1], 36]]),
};

/**
 * Real weapons, real keys: whatever the hand-built hits above miss between a trigger and a wound. Fires each weapon at a
 * standing body and reports what it left.
 */
SCENE.live = async (page, h) => {
  const out = {};
  for (const [weapon, type, range] of [['smg', 'trooper', 7], ['shotgun', 'gunner', 2.5], ['judge', 'husk', 7], ['autocannon', 'brute', 9], ['rocket', 'riot', 12], ['sword', 'husk', 2.2]]) {
    await page.evaluate(async ([weapon, type, range]) => {
      const w = window.__wg;
      const { ctx, V } = w;
      await w.clear();
      const e = w.lab.spawner.place(type, new V(8, 0, -6), 'off');
      window.__wgBody = e;
      ctx.player.teleport(new V(8, 0.1, -6 + range), 0);
      ctx.weapons.switchTo(weapon);
      await w.raf(50);
      const d = new V(8, 1.1 * (e.char.rig.height / 1.85), -6).sub(ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z);
      ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      ctx.input.simulate('fire', true);
      await w.raf(weapon === 'smg' ? 24 : 6);
      ctx.input.simulate('fire', false);
      await w.raf(50);
    }, [weapon, type, range]);
    out[weapon] = await page.evaluate(() => {
      const e = window.__wgBody;
      const b = e.char.book;
      const K = ['hole', 'exit', 'crater', 'gash', 'burn', 'graze', 'dent'];
      const kinds = {};
      for (let i = 0; i < b.count; i++) kinds[K[b.kind(i)]] = (kinds[K[b.kind(i)]] ?? 0) + 1;
      return { alive: e.alive, live: e.char.live, kinds };
    });
    await page.evaluate(() => {
      const w = window.__wg;
      const at = window.__wgBody.char.bones[2].getWorldPosition(new w.V());
      w.freeze();
      w.look([at.x + 0.7, at.y + 0.5, at.z + 1.5], [at.x, at.y - 0.1, at.z], 40);
      return w.frame();
    });
    await h.shot(`live-${weapon}`);
    await page.evaluate(() => window.__wg.thaw());
  }
  return out;
};

/** Whether a hole reaches the moon's shadow map: a hole straight through along the moon's line, and the floor behind it. */
SCENE.shadow = async page => {
  const brightness = () => page.evaluate(async () => {
    const w = window.__wg;
    await w.frame();
    const { ctx, V } = w;
    const e = window.__wgBody;
    const chest = e.char.bones[2].getWorldPosition(new V()).add(new V(0, 0.1, 0));
    const moon = ctx.render.engine.opMoonDir.value.clone().normalize();
    const floor = chest.clone().addScaledVector(moon, -chest.y / moon.y);
    const hit = floor.clone().project(ctx.render.camera);
    return { x: (hit.x + 1) / 2, y: (1 - hit.y) / 2, moon: moon.toArray().map(v => +v.toFixed(2)) };
  });
  await page.evaluate(async () => {
    const w = window.__wg;
    await w.clear();
    const e = w.place('trooper', 8, -6, 0);
    window.__wgBody = e;
    await w.raf(40);
    w.freeze();
    const { ctx, V } = w;
    const chest = e.char.bones[2].getWorldPosition(new V()).add(new V(0, 0.1, 0));
    const moon = ctx.render.engine.opMoonDir.value.clone().normalize();
    const floor = chest.clone().addScaledVector(moon, -chest.y / moon.y);
    w.look([floor.x + 0.3, 1.6, floor.z + 1.8], [floor.x, 0, floor.z], 40);
  });
  const shots = {};
  const sample = async name => {
    const at = await brightness();
    const png = await page.screenshot({ type: 'png' });
    shots[name] = at;
    return png;
  };
  const { writeFileSync } = await import('node:fs');
  const dir = process.env.WG_OUT ?? 'tools/out';
  writeFileSync(`${dir}/shadow-whole.png`, await sample('whole'));
  await page.evaluate(async () => {
    const w = window.__wg;
    const { ctx, V } = w;
    const c = window.__wgBody.char;
    const moon = ctx.render.engine.opMoonDir.value.clone().normalize();
    const chest = c.bones[2].getWorldPosition(new V()).add(new V(0, 0.1, 0));
    const into = moon.clone().negate();
    const front = chest.clone().addScaledVector(moon, 0.16);
    const back = chest.clone().addScaledVector(moon, -0.16);
    c.wound({ kind: 2, bone: 2, point: front, dir: into, radius: 0.13, depth: 0.1, ragged: 0 });
    c.wound({ kind: 2, bone: 2, point: back, dir: moon, radius: 0.13, depth: 0.1, ragged: 0 });
    await w.frame();
  });
  writeFileSync(`${dir}/shadow-holed.png`, await sample('holed'));
  return shots;
};

/** Takes the skin away and leaves only what lies under the wounds, for when a hole shows the wrong thing. */
SCENE.under = async (page, h, type) => {
  await SCENE.bullets(page, h, type);
  await page.evaluate(async () => {
    const w = window.__wg;
    const c = window.__wgBody.char;
    c.mesh.visible = false;
    c.backing.visible = false;
    const at = c.bones[2].getWorldPosition(new w.V());
    w.look([at.x + 0.2, at.y + 0.05, at.z + 0.6], [at.x, at.y - 0.05, at.z], 34);
    await w.frame();
  });
  await h.shot('under-front');
};

/** The same damage across the cast, so a fit that fails on one body shape shows up. */
SCENE.types = async (page, h) => {
  for (const type of (process.env.WG_TYPES ?? 'brute,gunner,juggernaut,leaper').split(',')) {
    await scene(page, h, `type-${type}`, type, async (w, e) => {
      const { V, ctx } = w;
      const s = e.char.rig.height / 1.85;
      const F = w.front(0.1 * s, 1.35 * s, 2);
      for (let i = 0; i < 6; i++) w.shoot(e, 'shotgun', 'pellet', 20, F, 1, [(Math.random() - 0.5) * 0.14 * s, (0.1 + (Math.random() - 0.5) * 0.14) * s, 0.1 * s]);
      const c = e.char.bones[2].getWorldPosition(new V());
      c.y += 0.12 * s;
      ctx.enemies.applyDamage(e, { amount: e.maxHealth * 0.8, type: 'explosive', point: c, dir: new V(0.1, -0.05, -1).normalize(), force: 1, source: 'rocket' });
      w.shoot(e, 'judge', 'bullet', 0.9 * e.maxHealth, w.front(0.4 * s, 0.6 * s, 3), 12, [0, -0.15 * s, 0.06 * s]);
    }, [['1m5', [0.3, 1.35, 1.7], [0, 1.25, 0], 44]]);
  }
};

/** Machines take dents, and nothing behind them. */
SCENE.machines = async (page, h) => {
  for (const [type, bone, y, reach] of [['skitter', 0, 0.5, 1.4], ['drone', 0, 2.4, 1.6], ['titan', 2, 4.6, 5]]) {
    await scene(page, h, `machine-${type}`, type, async (w, e) => {
      const at = e.char.bones[0].getWorldPosition(new w.V());
      for (let i = 0; i < 4; i++) w.shoot(e, 'smg', 'bullet', 15, [at.x + 0.3, at.y + 0.3, at.z + 3], 0, [(i - 1.5) * 0.06, 0.02, 0]);
      w.shoot(e, 'autocannon', 'bullet', 50, [at.x, at.y + 0.3, at.z + 4], 0, [0.02, 0.03, 0]);
    }, [['view', [0.3 * reach, y + 0.2 - 1.25 + 1.25, reach], [0, y, 0], 34]]);
  }
};

/** Wounds leave with a limb. Then the limb is shot again where it lies. */
SCENE.limb = async (page, h, type) => {
  await scene(page, h, 'limb', type, async (w, e) => {
    const { V, ctx } = w;
    const F = w.front(1.2, 1.1, 2);
    w.shoot(e, 'judge', 'bullet', 40, F, 8, [-0.05, -0.14, 0.05]);
    w.shoot(e, 'judge', 'bullet', 40, F, 9, [-0.04, -0.1, 0.05]);
    const b = e.char.bones[8].getWorldPosition(new V());
    ctx.gore.sever(e.char, 'armR', { amount: 100, type: 'bullet', point: b, dir: new V(1, 0, 0), force: 20, source: 'test' });
  }, []);
  const out = await page.evaluate(async () => {
    const w = window.__wg;
    const { ctx, V } = w;
    w.thaw();
    await w.raf(60);
    w.freeze();
    const c = ctx.gore.limbCenter(0, new V());
    w.look([c.x + 0.5, c.y + 0.55, c.z + 0.5], [c.x, c.y, c.z], 36);
    await w.frame();
    return { limbs: ctx.gore.stats().limbs, at: c.toArray() };
  });
  await h.shot('limb-down');
  await page.evaluate(async () => {
    const w = window.__wg;
    const { ctx, V } = w;
    const c = ctx.gore.limbCenter(0, new V());
    const from = c.clone().add(new V(0.2, 0.7, 0.3));
    const dir = c.clone().sub(from).normalize();
    w.thaw();
    await w.raf(2);
    for (let i = 0; i < 3; i++) {
      const hit = ctx.gore.raycastCorpses(from, dir, 3);
      if (hit) ctx.gore.damageCorpse(hit, { amount: 5, type: 'bullet', point: hit.point, dir, force: 1, source: 'judge', severMult: 0 });
    }
    await w.raf(50);
    w.freeze();
    const p = ctx.gore.limbCenter(0, new V());
    w.look([p.x + 0.45, p.y + 0.5, p.z + 0.45], [p.x, p.y, p.z], 36);
    await w.frame();
  });
  await h.shot('limb-shot');
  return out;
};

/** Whether the first wound of a run stalls on a shader. Run this first, on a fresh page. */
SCENE.warm = async page => page.evaluate(async () => {
  const w = window.__wg;
  const { ctx } = w;
  const r = ctx.render.renderer;
  const before = r.info.programs.length;
  const e = w.place('trooper', 8, -6, 0);
  window.__wgBody = e;
  await w.raf(30);
  const mid = r.info.programs.length;
  w.shoot(e, 'judge', 'bullet', 30, w.front(0.2, 1.1, 3), 1, [0, 0.05, 0.1]);
  const t0 = performance.now();
  ctx.render.render();
  const first = performance.now() - t0;
  const t1 = performance.now();
  ctx.render.render();
  return { programsAtStart: before, afterSpawn: mid, afterWound: r.info.programs.length, firstFrameMs: +first.toFixed(1), nextFrameMs: +(performance.now() - t1).toFixed(1) };
});

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
    w.shoot(e, 'judge', 'bullet', 50, w.front(0.6, 0.6, 3), 12, [0, -0.15, 0.06]);
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
