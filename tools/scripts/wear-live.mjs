// Wear you can see, driven by the game's own damage on the Test Range (frozen clock): rounds into one arm of a Trooper
// until it comes off, a blade into a leg, a round at a time into the chest. After each hit: the pool, the wear drawn, and
// whether the limb is still on. Stills at the steps worth seeing.
//
//   node tools/shot.mjs --port <yours> --url "/?map=range" --wait 0 --script tools/scripts/wear-live.mjs --dpr 2 --w 1440 --h 900 \
//     --timeout 300 --out tools/out/<you>/wear-live.png
//
// WEAR_TYPE: the enemy (default trooper). `?wear=0` in --url shows the same hits with the switch off.
import * as steady from './lib/steady.mjs';

const type = process.env.WEAR_TYPE ?? 'trooper';
export const before = page => steady.install(page, { seed: 7 });

export default async function wearLive(page, h0) {
  const h = steady.helpers(page, h0);
  await steady.ready(page);
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await steady.frames(page, 10, { grace: 30 });
  }
  await page.addStyleTag({ content: '#hud, .hud, [class^="lab"], [class*=" lab"] { display: none !important; }' });
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.__lab.settings.overlay = false;
    window.__lab.changed();
    ctx.viewmodel.root.visible = false;
    window.start = ctx.player.position.clone();
    window.startYaw = ctx.player.yaw;
    window.BONE = { armR: 8, forearmR: 9, legL: 11, shinL: 12, chest: 2, head: 4 };
    window.man = id => {
      ctx.enemies.reset();
      window.__lab.spawner.clearBodies();
      ctx.player.teleport(window.start, window.startYaw);
      ctx.player.pitch = -0.1;
      const f = ctx.player.forward;
      const at = ctx.player.position.clone();
      at.x += f.x * 2.6;
      at.z += f.z * 2.6;
      window.e = window.__lab.spawner.place(id, at, 'off');
      return !!window.e;
    };
    window.hit = (region, type, amount, source, severMult) => {
      const e = window.e;
      if (!e.alive) return { dead: true };
      const bone = window.BONE[region];
      const point = e.char.bones[bone].getWorldPosition(ctx.player.eye.clone());
      const dir = point.clone().sub(ctx.player.eye).normalize();
      const res = ctx.enemies.applyDamage(e, { amount, type, point, dir, force: 0, source, region, bone, severMult });
      const r = v => (v === undefined ? null : +v.toFixed(2));
      return { pool: r(e.limbHp.get(region)), wear: r(e.char.wearOf(region)), on: !e.char.severed.has(region), alive: e.alive, health: r(e.health), severed: res.severed };
    };
  });
  const frames = n => steady.frames(page, n);
  const out = {};
  const run = async (name, region, dmgType, amount, source, max, shots, severMult) => {
    await page.evaluate(id => window.man(id), type);
    await frames(40);
    const log = [];
    for (let i = 1; i <= max; i++) {
      const r = await page.evaluate(a => window.hit(...a), [region, dmgType, amount, source, severMult]);
      log.push(r);
      await frames(6);
      if (shots.includes(i) || r.on === false || r.alive === false) await h.shot(`${name}-${String(i).padStart(2, '0')}${r.on === false ? '-off' : ''}`);
      if (r.on === false || r.alive === false || r.dead) break;
    }
    await frames(50);
    await h.shot(`${name}-after`);
    out[name] = log;
  };
  // The SMG's round is 25; an arm takes a share of it (region and weapon rules are the game's own).
  await run('arm-rounds', 'armR', 'bullet', 9, 'smg', 30, [1, 2, 3, 4, 5, 6, 8, 10]);
  await run('leg-blade', 'legL', 'slash', 6, 'sword', 30, [1, 2, 3, 4, 5], 1);
  await run('chest-rounds', 'chest', 'bullet', 12, 'smg', 30, [1, 2, 3, 4, 5]);
  await run('arm-one-blow', 'armR', 'slash', 60, 'sword', 2, [1], 3);
  return out;
}
