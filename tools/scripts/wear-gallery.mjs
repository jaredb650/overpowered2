// Wear you can see (src/characters/anatomy/wear.ts): one enemy type at 3, 10 and 20 m from the player's eye on the Test
// Range, its AI off, on a frozen clock, with one region's health pool spent to each of WEAR_AT in turn.
//
//   WEAR_TYPE=trooper WEAR_REGIONS=armR,legL,chest node tools/shot.mjs --port <yours> --url "/?map=range" --wait 0 \
//     --script tools/scripts/wear-gallery.mjs --dpr 2 --w 1440 --h 900 --timeout 300 --out tools/out/<you>/wear.png
//
// Writes `<out>-<type>-<region>-<kind>-<percent>.png`, the three bodies side by side (3 m left, 10 m middle, 20 m right).
//   WEAR_TYPE     trooper (default), gunner, brute, husk, ...; several with commas, one after another on the one page
//   WEAR_REGIONS  any of head chest abdomen armL forearmL armR forearmR legL shinL legR shinR; "arm" is armR and forearmR
//                 together, "leg" legL and shinL, "limbs" both, "trunk" chest and abdomen (default "arm,leg,chest")
//   WEAR_KIND     tear (rounds, default), cut (a blade), strip (a blast)
//   WEAR_AT       percent of the pool spent, in rising order (default "0,30,60,90")
//   WEAR_BACK=1   the bodies turn their backs
import * as steady from './lib/steady.mjs';

const types = (process.env.WEAR_TYPE ?? 'trooper').split(',').filter(Boolean);
const regions = (process.env.WEAR_REGIONS ?? 'arm,leg,chest').split(',').filter(Boolean);
const kindName = process.env.WEAR_KIND ?? 'tear';
const kind = { tear: 0, cut: 1, strip: 2 }[kindName] ?? 0;
const levels = (process.env.WEAR_AT ?? '0,30,60,90').split(',').map(Number);
const GROUPS = { arm: ['armR', 'forearmR'], leg: ['legL', 'shinL'], trunk: ['chest', 'abdomen'], limbs: ['armR', 'forearmR', 'legL', 'shinL'] };

export const before = page => steady.install(page, { seed: 7 });

export default async function wear(page, h0) {
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
  });
  const stage = type => page.evaluate(([id, back]) => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    ctx.enemies.reset();
    lab.spawner.clearBodies();
    ctx.player.teleport(window.start, window.startYaw);
    ctx.player.pitch = -0.06;
    const eye = ctx.player.position;
    const f = ctx.player.forward;
    const yaw = Math.atan2(f.x, f.z);
    window.crew = [];
    // 3 m well to the left, 10 m ahead, 20 m a little right, so no body hides another.
    for (const [dist, turn] of [[3, 0.42], [10, 0.02], [20, -0.13]]) {
      const a = yaw + turn;
      const at = eye.clone();
      at.x += Math.sin(a) * dist;
      at.z += Math.cos(a) * dist;
      const e = lab.spawner.place(id, at, 'off');
      if (!e) continue;
      if (back) e.yaw += Math.PI;
      window.crew.push(e);
    }
    return window.crew.length;
  }, [type, process.env.WEAR_BACK === '1']);
  const out = {};
  for (const type of types) for (const name of regions) {
    const list = GROUPS[name] ?? [name];
    out[`${type} ${name}`] = await stage(type);
    await steady.frames(page, 40);
    for (const pct of levels) {
      await page.evaluate(([rs, amount, k]) => {
        for (const e of window.crew) for (const r of rs) e.char.setWear(r, amount, k);
      }, [list, pct / 100, kind]);
      await steady.frames(page, 2);
      await h.shot(`${type}-${name}-${kindName}-${String(pct).padStart(2, '0')}`);
    }
  }
  return out;
}
