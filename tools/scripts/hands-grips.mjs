// Both hands on every gun: the first-person view at the hip and aimed, then close-ups of each hand from outside.
//
//   GRIP_IDS=smg,judge node tools/shot.mjs --url "/?sandbox=viewmodels&manual=1" --script tools/scripts/hands-grips.mjs \
//     --dpr 2 --w 1440 --h 900 --wait 1500 --timeout 600 --out tools/out/hands2/after.png
//
// Screenshots: <out>-<id>-<view>.png, views hip, ads, under (left hand from below and left), side (both hands from the
// left), top (from above, the thumbs), right (the firing hand from the right); on request close (the left hand from
// its left) and front (both hands from ahead and left).
const ids = (process.env.GRIP_IDS ?? 'smg').split(',').filter(Boolean);
const views = (process.env.GRIP_VIEWS ?? 'hip,ads,under,side,top,right').split(',');

export default async function grips(page, h) {
  await page.waitForFunction(() => !!window.__vm, null, { timeout: 60000 });
  const out = {};
  for (const id of ids) {
    await page.evaluate(id => {
      const v = window.__vm;
      v.cam(0, 0, 0, 0, 0, -1);
      v.rig.setAim(0);
      v.rig.equip(id, 0.01);
      v.step(0.8);
      if (v.rig.currentDef?.id !== id) throw new Error(`No viewmodel for ${id}`);
    }, id);
    const shot = async name => {
      if (!views.includes(name)) return;
      await h.sleep(90);
      await h.shot(`${id}-${name}`);
    };
    await shot('hip');
    if (views.includes('ads')) {
      await page.evaluate(() => { window.__vm.rig.setAim(1); window.__vm.step(0.8); });
      await shot('ads');
      await page.evaluate(() => { window.__vm.rig.setAim(0); window.__vm.step(0.8); });
    }
    // Palm centres in view space: the wrist bone plus the palm's offset in hand space.
    out[id] = await page.evaluate(() => {
      const v = window.__vm;
      const palm = arm => {
        const b = arm.bones[3];
        b.updateWorldMatrix(true, false);
        const p = b.localToWorld(v.player.position.clone().set(0, -0.027, -0.062));
        return p.toArray();
      };
      // The wrist's bend, degrees: the forearm's line seen in the hand's frame. `ext` > 0 bends the back of the hand
      // toward the forearm, `dev` > 0 toward the hand's +X (the right hand's pinky, the left hand's thumb).
      const bend = arm => {
        const [, fore, , hand] = arm.bones;
        const d = hand.position.clone().sub(fore.position).normalize().applyQuaternion(hand.quaternion.clone().invert());
        const deg = r => Math.round((r * 180) / Math.PI);
        return { ext: deg(Math.atan2(-d.y, -d.z)), dev: deg(Math.atan2(-d.x, -d.z)) };
      };
      const one = arm => (arm.mesh.visible ? { palm: palm(arm), ...bend(arm) } : null);
      return { L: one(v.rig.armL), R: one(v.rig.armR) };
    });
    const L = out[id].L?.palm;
    const R = out[id].R?.palm;
    const at = L ?? R;
    const look = (o, t) => page.evaluate(([o, t]) => window.__vm.cam(...o, ...t), [o, t]);
    if (at) {
      await look([at[0] - 0.3, at[1] - 0.24, at[2] - 0.1], at);
      await shot('under');
      const mid = R ? [(at[0] + R[0]) / 2, (at[1] + R[1]) / 2 + 0.03, (at[2] + R[2]) / 2] : at;
      await look([mid[0] - 0.55, mid[1] + 0.02, mid[2] + 0.02], mid);
      await shot('side');
      await look([mid[0] - 0.12, mid[1] + 0.45, mid[2] + 0.12], mid);
      await shot('top');
      if (views.includes('close')) {
        await look([at[0] - 0.28, at[1] + 0.03, at[2]], at);
        await shot('close');
      }
      if (views.includes('front')) {
        await look([at[0] - 0.12, at[1] - 0.04, at[2] - 0.3], at);
        await shot('front');
      }
    }
    if (R) {
      await look([R[0] + 0.36, R[1] - 0.03, R[2] - 0.12], R);
      await shot('right');
    }
    await page.evaluate(() => window.__vm.cam(0, 0, 0, 0, 0, -1));
  }
  return out;
}
