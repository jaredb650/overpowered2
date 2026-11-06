// First-person gallery in the real game: real map, real lighting, waves off. Run through the harness:
//
//   VM_WEAPONS=smg,shotgun VM_SPOTS=core,ring node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk" \
//     --script tools/scripts/viewmodel-gallery.mjs --w 1920 --h 1080 --wait 1000 --out tools/out/vm/g.png
//
// One screenshot per weapon per spot, named <out>-<spot>-<weapon>.png. VM_DEVICES=1 adds grenade and call-in devices.
const weapons = (process.env.VM_WEAPONS ?? 'smg,shotgun,rocket,autocannon,sword,judge,lance,buzzsaw,kiln,stakegun').split(',').filter(Boolean);
const spots = (process.env.VM_SPOTS ?? 'bright,dark').split(',').filter(Boolean);
const settle = Number(process.env.VM_SETTLE ?? 700);

export default async function gallery(page, h) {
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => !!window.__range)) break;
    await h.sleep(1000);
  }
  await page.evaluate(() => {
    const R = window.__range;
    const { ctx } = R;
    ctx.player.modifiers.invulnerable = true;
    window.__vmg = {
      /** Picks spots by what the light volume actually holds there, so "dark" stays dark when the map changes. */
      survey() {
        const spots = ctx.world.pickupSpots;
        const r = ctx.render;
        const out = [];
        for (const s of spots) {
          const hit = ctx.physics.raycast(s.clone().setY(s.y + 1), new s.constructor(0, 1, 0), 40);
          out.push({ x: s.x, y: s.y, z: s.z, roof: hit ? hit.distance : 99 });
        }
        return out;
      },
      go(x, y, z, yaw, pitch) {
        const P = ctx.player;
        P.teleport(new P.position.constructor(x, y + 0.1, z));
        P.velocity.set(0, 0, 0);
        P.yaw = yaw;
        P.pitch = pitch;
      },
    };
  });
  const result = { spots: {}, tris: await page.evaluate(() => {
    const { ctx } = window.__range;
    const o = {};
    for (const [k, d] of Object.entries(ctx.viewmodel.allDefs)) o[k] = [Math.round(d.model.triangles), d.model.draws];
    return o;
  }) };
  const list = await page.evaluate(() => window.__vmg.survey());
  const named = JSON.parse(process.env.VM_AT ?? 'null') ?? {
    bright: list.find(s => s.roof > 30) ?? list[0],
    dark: [...list].sort((a, b) => a.roof - b.roof)[0],
  };
  for (const spot of spots) {
    const s = named[spot];
    if (!s) continue;
    await page.evaluate(({ x, y, z, yaw, pitch }) => window.__vmg.go(x, y, z, yaw ?? 0.6, pitch ?? -0.05), s);
    await h.sleep(500);
    result.spots[spot] = s;
    for (const id of weapons) {
      await page.evaluate(w => window.__range.ctx.weapons.switchTo(w), id);
      await h.sleep(settle);
      await h.shot(`${spot}-${id}`);
    }
  }
  return result;
}
