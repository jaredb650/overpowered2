// The gore update's "one look" checks, at night in The Crucible on the frozen clock (same picture every run): the things the
// six lanes each drew, in one frame, to see whether they agree. Stills only; the numbers behind them go to stderr.
//
//   FIT_CASE=blood node tools/shot.mjs --port <yours> --url "/?autostart=1" --wait 0 --dpr 2 --w 1440 --h 900 --timeout 600 \
//     --script tools/scripts/fit-look.mjs --out tools/out/<you>/look.png
//
// FIT_CASE
//   blood   three Troopers: one worn on a leg and an arm and left standing, one killed at arm's length with the shotgun
//           (puff, spray, a stain, blood on the weapon), one burst by a rocket (pieces, torn faces, ribbons). Stills at
//           FIT_SHOTS seconds (default 0.25,2,20,70,130) and again at the end with the weapon light on.
//   wear    Troopers with a leg and an arm worn 0.35, 0.6 and 0.9 through, standing at 5, 10, 15 and 20 m, with the
//           weapon light off and on: does wear glow at range?
//   burnt   a Trooper burnt to death at 4 m and another at 8 m: stills while they burn, as they smoulder and cold, light
//           off and on.
//   rims    a big wet stain with wet drops laid on it, looked down on from standing, light off and on.
//   organ   a Trooper's chest blown out from behind (the blow-out throws an organ): the hole, close, from the side it left by.
//   heap    eight bodies killed on one spot, then one burst on top of them: where the pieces and the guts come to rest.
// FIT_SHOTS  seconds at which to take stills, for the cases that take them at times.
// FIT_LIGHT  0: never fit the weapon light.
import * as steady from './lib/steady.mjs';

const CASE = process.env.FIT_CASE ?? 'blood';
const SHOTS = (process.env.FIT_SHOTS ?? '0.25,2,20,70,130').split(',').map(Number).sort((a, b) => a - b);
const LIGHT = process.env.FIT_LIGHT !== '0';

export const before = page => steady.install(page, { seed: Number(process.env.STEADY_SEED ?? 3) });

/** In the page: a quiet floor in the Crucible, the player on it, and the handles the cases use. */
async function install() {
  const { ctx } = window.__op2;
  const r = ctx.render;
  const P = ctx.player;
  const V = P.eye.constructor;
  r.dynamicResolution.enabled = false;
  ctx.waves.update = () => {};
  ctx.waves.start = () => {};
  P.modifiers.invulnerable = true;
  ctx.weapons.modifiers.bottomlessMag = true;
  for (const id of ['smg', 'shotgun']) if (!ctx.weapons.owned.has(id)) ctx.weapons.give(id);
  const css = document.createElement('style');
  css.textContent = '.hud { visibility: hidden !important; }';
  document.head.appendChild(css);
  for (const e of [...ctx.enemies.alive]) ctx.enemies.withdraw(e);
  const hitOf = () => ({ point: new V(), normal: new V(), distance: 0, surface: 'concrete', collider: null });
  const ground = (x, y, z) => {
    const h = hitOf();
    return ctx.physics.raycastInto(new V(x, y + 1.5, z), new V(0, -1, 0), 40, 1, h) ? h.point.clone() : new V(x, y, z);
  };
  // The longest clear way out from the middle of the floor: the scene is laid along it.
  const view = ctx.world.spec.views.core_floor ?? Object.values(ctx.world.spec.views)[0];
  const origin = new V(...view.pos);
  let heading = 0;
  let longest = 0;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const h = hitOf();
    const d = ctx.physics.raycastInto(new V(origin.x, origin.y + 1, origin.z), new V(Math.sin(a), 0, Math.cos(a)), 40, 1, h) ? h.distance : 40;
    if (d > longest) {
      longest = d;
      heading = a;
    }
  }
  const fwd = new V(Math.sin(heading), 0, Math.cos(heading));
  const side = new V(fwd.z, 0, -fwd.x);
  const home = ground(origin.x, origin.y, origin.z);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  const along = (d, s = 0) => ground(origin.x + fwd.x * d + side.x * s, origin.y, origin.z + fwd.z * d + side.z * s);
  const look = t => {
    const d = new V().subVectors(t, P.eye);
    P.yaw = Math.atan2(-d.x, -d.z);
    P.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  P.teleport(home, yaw);
  /** A body that stands where it is put and does nothing. */
  const stand = (id, at, health = 1e5) => {
    const e = ctx.enemies.spawn(id, at);
    if (!e) return null;
    e.health = e.maxHealth = health;
    e.speedMul = 0;
    e.yaw = Math.atan2(P.position.x - at.x, P.position.z - at.z);
    return e;
  };
  const round = (e, region, amount = 14, type = 'bullet', source = 'smg') => {
    const bone = e.char.rig.bones.findIndex(b => b.region === region);
    const point = e.char.bones[Math.max(bone, 0)].getWorldPosition(new V());
    const dir = new V().subVectors(point, P.eye).normalize();
    return { amount, type, point, dir, force: 18, source, region, bone: bone >= 0 ? bone : undefined };
  };
  const light = on => {
    const id = `${ctx.weapons.current?.id ?? 'smg'}Light`;
    try { ctx.weapons.fitMod(id, on); } catch { /* a gun that takes none */ }
  };
  window.__fit = { ctx, P, V, fwd, side, home, along, look, stand, round, light, made: [], state: {} };
  return { longest: +longest.toFixed(1) };
}

const SCENES = {
  /** Wear, a close kill and a burst, side by side. */
  blood() {
    const f = window.__fit;
    const { ctx, along, stand, round, look } = f;
    const worn = stand('trooper', along(4.2, -1.9));
    const shot = stand('trooper', along(2.6, 0.1), 60);
    const burst = stand('trooper', along(5.2, 1.9), 60);
    f.made.push(worn, shot, burst);
    // Rounds into one leg and one arm until each pool is well spent: wear shows, nothing comes off.
    // (Its pools and its wear are sized by the health it was made with: that stays, and its health is topped up.)
    worn.maxHealth = worn.health = 70;
    for (const region of ['legL', 'armR']) {
      const whole = worn.limbHp.get(region);
      for (let i = 0; i < 40 && worn.alive; i++) {
        const left = worn.limbHp.get(region);
        if (left === undefined || left < whole * 0.3) break;
        ctx.enemies.applyDamage(worn, round(worn, region, 5));
        worn.health = worn.maxHealth;
      }
    }
    worn.health = worn.maxHealth = 1e5;
    ctx.weapons.equip?.('shotgun');
    look(shot.center);
    f.state.fireAt = 6;
    f.state.burstAt = 6;
    let frame = 0;
    const tick = () => {
      requestAnimationFrame(tick);
      frame++;
      if (frame === f.state.fireAt) ctx.input.simulate('fire', true);
      if (frame === f.state.fireAt + 4) ctx.input.simulate('fire', false);
      if (frame === f.state.burstAt && burst.alive) {
        burst.health = 1;
        ctx.combat.explode(burst.center.clone().setY(burst.position.y + 0.2), { radius: 4, damage: 400, kind: 'rocket', source: 'rocket', team: 'player' });
      }
      if (frame === 40) look(along(4.2, 0).setY(f.home.y + 0.7));
    };
    requestAnimationFrame(tick);
    return { worn: [...worn.limbHp.entries()].map(([k, v]) => [k, Math.round(v)]) };
  },
  wear() {
    const f = window.__fit;
    const { along, stand, look } = f;
    const worn = [0.35, 0.6, 0.9];
    [5, 10, 15, 20].forEach((d, row) => worn.forEach((w, i) => {
      const e = stand('trooper', along(d, (i - 1) * 1.5 + (row % 2 ? 0.4 : 0)));
      if (!e) return;
      f.made.push(e);
      // Tears on the leg and the arm toward the camera, a blade's cuts on the other arm.
      e.char.setWear?.('legL', w, 0);
      e.char.setWear?.('shinL', w * 0.8, 0);
      e.char.setWear?.('armR', w, 0);
      e.char.setWear?.('forearmL', w, 1);
    }));
    look(along(10, 0).setY(f.home.y + 1.1));
    return {};
  },
  burnt() {
    const f = window.__fit;
    const { ctx, along, stand, look, V } = f;
    for (const [d, s] of [[4, -0.6], [8, 0.9]]) {
      const e = stand('trooper', along(d, s), 70);
      if (!e) continue;
      f.made.push(e);
      ctx.enemies.afflict(e, 'burn', 20);
    }
    let last = ctx.time.elapsed;
    const tick = () => {
      requestAnimationFrame(tick);
      const now = ctx.time.elapsed;
      // The Kiln's own bites, 30 a second, until each is dead of it.
      while (last + 1 / 30 <= now) {
        last += 1 / 30;
        for (const e of f.made) {
          if (!e.alive) continue;
          const point = e.char.bones[2].getWorldPosition(new V());
          ctx.enemies.applyDamage(e, { amount: 9, type: 'fire', point, dir: f.fwd.clone(), force: 1, source: 'kiln', bone: 2, region: 'chest' });
          ctx.enemies.afflict(e, 'burn', 4);
        }
      }
    };
    requestAnimationFrame(tick);
    look(along(5.5, 0).setY(f.home.y + 0.3));
    return {};
  },
  rims() {
    const f = window.__fit;
    const { ctx, along, look, V } = f;
    const d = ctx.render.decals;
    const at = along(1.5, 0);
    const up = new V(0, 1, 0);
    d.big('burst', at, up, 2.2, f.fwd);
    // Drops and small splashes onto the wet sheet, as a second kill over the first leaves them.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 46; i++) {
      const p = new V(at.x + (rnd() - 0.5) * 1.5, at.y, at.z + (rnd() - 0.5) * 1.5);
      const size = 0.05 + rnd() * rnd() * 0.3;
      d.splat(p, up, size, new V((rnd() - 0.5) * 2, -4 - rnd() * 3, (rnd() - 0.5) * 2), size > 0.2 ? 'splash' : 'drop');
    }
    look(at.clone().setY(at.y + 0.02));
    return {};
  },
  organ() {
    const f = window.__fit;
    const { ctx, along, stand, V } = f;
    const e = stand('trooper', along(2.4, 0));
    f.made.push(e);
    e.char.root.updateMatrixWorld(true);
    // Through the chest from his right to his left: the far side opens toward +side of him.
    const chest = e.char.bones[2].getWorldPosition(new V());
    const q = e.char.root.quaternion;
    const hisLeft = new V(1, 0, 0).applyQuaternion(q);
    const dir = hisLeft.clone().addScaledVector(f.fwd, 0.15).normalize();
    const point = chest.clone().addScaledVector(dir, -0.18);
    point.y += 0.08;
    ctx.gore.blowOut(e.char, { amount: 200, type: 'bullet', point, dir, force: 60, source: 'sabot', bone: 2, region: 'chest' });
    f.state.organs = e.char.organsGone ?? null;
    // The player steps round to the side the round left by and looks into the hole.
    const eye = chest.clone().addScaledVector(dir, 1.25).addScaledVector(f.fwd, -0.35);
    f.P.teleport(new V(eye.x, f.home.y, eye.z), 0);
    f.look(chest.clone().setY(chest.y + 0.05));
    return { organs: f.state.organs };
  },
  heap() {
    const f = window.__fit;
    const { ctx, along, stand, V } = f;
    const spot = along(3.6, 0);
    let frame = 0;
    let made = 0;
    const tick = () => {
      requestAnimationFrame(tick);
      frame++;
      // One body every forty frames, dropped dead on the spot, each a little off the last.
      if (made < 8 && frame % 40 === 1) {
        const e = stand(made % 3 === 2 ? 'gunner' : 'trooper', spot.clone().add(new V(((made * 7) % 5 - 2) * 0.16, 0, ((made * 3) % 5 - 2) * 0.16)), 50);
        made++;
        if (e) ctx.enemies.applyDamage(e, { amount: 500, type: 'bullet', point: e.center.clone(), dir: f.fwd.clone(), force: 12, source: 'smg', bone: 2, region: 'chest' });
      }
      // Then one stood on the heap and burst.
      if (frame === 8 * 40 + 200) {
        const e = stand('trooper', spot.clone(), 50);
        if (e) {
          f.made.push(e);
          f.state.burst = e;
        }
      }
      if (frame === 8 * 40 + 206 && f.state.burst?.alive) {
        const e = f.state.burst;
        e.health = 1;
        ctx.combat.explode(e.center.clone().setY(e.position.y + 0.6), { radius: 3, damage: 400, kind: 'grenade', source: 'grenade', team: 'player' });
      }
    };
    requestAnimationFrame(tick);
    f.look(spot.clone().setY(spot.y + 0.3));
    return {};
  },
};

/** What the floor holds now, for the stills' captions. */
const stats = () => {
  const { ctx } = window.__fit;
  const g = ctx.gore;
  const pieces = g.chunks.all.filter(c => c.alive);
  return {
    t: +ctx.time.elapsed.toFixed(2), gore: g.stats(), fire: g.fire.stats(), decals: ctx.render.decals.total ?? null,
    piecesUp: pieces.filter(c => c.perched).length, pieces: pieces.length,
    gutsTop: Math.max(0, ...g.ropes.ropes.filter(r => r.alive).map(r => Math.max(...Array.from({ length: r.x.length / 3 }, (_, i) => r.x[i * 3 + 1])))),
    calls: ctx.render.drawCalls?.(), tris: ctx.render.triangles?.(),
  };
};

export default async function fitLook(page, h0) {
  const h = steady.helpers(page, h0);
  await steady.ready(page, { until: '!!(window.__op2 && window.__op2.game && window.__op2.game.state === "playing")' });
  await steady.frames(page, 90);
  const scene = await page.evaluate(install);
  await steady.frames(page, 10);
  const made = await page.evaluate(`(${SCENES[CASE].toString().replace(/^[a-z]+\(\)/, 'function()')})()`);
  console.error('[fit-look]', CASE, JSON.stringify({ scene, made }));
  const rows = [];
  const still = async name => {
    const row = await page.evaluate(stats);
    rows.push({ name, ...row });
    console.error('[fit-look]', name, JSON.stringify(row));
    await h.shot(name);
  };
  const run = async seconds => steady.frames(page, Math.round(seconds * 1000 / steady.FRAME_MS));
  const withLight = async name => {
    if (!LIGHT) return;
    await page.evaluate(() => window.__fit.light(true));
    await steady.frames(page, 4);
    await still(`${name}-light`);
    await page.evaluate(() => window.__fit.light(false));
    await steady.frames(page, 2);
  };
  if (CASE === 'blood') {
    let at = 0;
    for (const t of SHOTS) {
      await run(t - at);
      at = t;
      await still(`blood-${String(t).replace('.', '_')}s`);
    }
    await withLight('blood-end');
  } else if (CASE === 'wear') {
    await run(0.6);
    await still('wear');
    await withLight('wear');
  } else if (CASE === 'burnt') {
    let at = 0;
    for (const [t, name] of [[3, 'burning'], [14, 'smoulder'], [50, 'cold']]) {
      await run(t - at);
      at = t;
      await still(`burnt-${name}`);
    }
    await withLight('burnt-cold');
    // And close on the nearer one.
    await page.evaluate(() => {
      const f = window.__fit;
      const body = f.ctx.gore.bodies[0];
      if (!body) return;
      const at = body.rag ? body.rag.center.clone() : body.char.root.position.clone();
      f.P.teleport(new f.V(at.x - f.fwd.x * 1.9, f.home.y, at.z - f.fwd.z * 1.9), 0);
      f.look(at);
    });
    await steady.frames(page, 4);
    await still('burnt-cold-close');
    await withLight('burnt-cold-close');
  } else if (CASE === 'rims') {
    await run(1.5);
    await still('rims-wet');
    await withLight('rims-wet');
    await run(60);
    await still('rims-drying');
    await withLight('rims-drying');
  } else if (CASE === 'organ') {
    await run(0.05);
    await still('organ-0s');
    await run(0.6);
    await still('organ-1s');
  } else if (CASE === 'heap') {
    await run((8 * 40 + 206) * steady.FRAME_MS / 1000 + 0.4);
    await still('heap-burst');
    await run(5);
    await still('heap-after');
    // From above.
    await page.evaluate(() => {
      const f = window.__fit;
      const spot = f.along(3.6, 0);
      f.P.teleport(new f.V(spot.x - f.fwd.x * 1.2, f.home.y, spot.z - f.fwd.z * 1.2), 0);
      f.look(spot.clone().setY(spot.y + 0.15));
    });
    await steady.frames(page, 4);
    await still('heap-after-near');
  }
  return { scene, made, rows };
}
