// Fire on bodies, from the player's eye, as a trigger for tools/sheet.mjs (frozen clock, seeded dice): the same command
// gives the same sheet, so `?fire=0` (fire as it was) and the new fire can be laid side by side.
//
//   FIRE_CASE=slow FIRE_DIST=5 node tools/sheet.mjs --port <yours> --url "/?map=range" --script tools/scripts/fire-look.mjs \
//     --frames 13 --every 1000 --cols 7 --w 1440 --h 900 --dpr 2 --out tools/out/<you>/slow-5m.png
//
// Env:
//   FIRE_CASE  slow    a man set alight as the Kiln's napalm coats him, left to burn, die and smoulder (default)
//              fast    the flamethrower's own bites, 9 a bite and 30 a second: dead in about a quarter of a second
//              corpse  as `fast`: use a long clip (--every 3000) for burning, smouldering and cold
//              limb    set alight, then an arm cut off: the arm burns where it lands
//              zombie  a burning Husk with its brain on, coming at the player
//              panic   a burning Trooper with his brain on
//              ten     ten men alight in view, standing (the cost check: tools/scripts/fire-bench.mjs times it)
//              tendead ten men killed by fire at once: ten corpses burning
//              tencold the same ten men, not on fire (the bench's baseline)
//              blast   a rocket's burn outcome
//              burntgib a man burnt black on his feet, then blown apart by a rocket: his pieces
//   FIRE_DIST  metres from the eye (default 5)
//   FIRE_TYPE  archetype (default trooper; husk for `zombie`)
//   FIRE_SIDE  1: the camera stands off to the side instead of at the player's eye
//   FIRE_GUN   1: keep the weapon and HUD in the picture
//   FIRE_YAW   radians the player turns from where the range starts them (default 2.2, away from the moon's glint)
const CASE = process.env.FIRE_CASE ?? 'slow';
const DIST = Number(process.env.FIRE_DIST ?? 5);
const TYPE = process.env.FIRE_TYPE ?? (CASE === 'zombie' ? 'husk' : 'trooper');
const SIDE = process.env.FIRE_SIDE === '1';
const GUN = process.env.FIRE_GUN === '1';
const YAW = Number(process.env.FIRE_YAW ?? 2.2);

export default async function fireLook(page, h) {
  await page.waitForFunction(() => window.__op2?.ctx && window.__lab, null, { timeout: 120000 });
  await h.sleep(600);
  // FIRE_TUNE: JSON merged into gore's FireTuning before the scene starts, e.g. '{"shimmers":0}', to cost one part of it.
  if (process.env.FIRE_TUNE) {
    await page.evaluate(async tune => Object.assign((await import('/src/gore/fire.ts')).FireTuning, JSON.parse(tune)), process.env.FIRE_TUNE);
  }
  const out = await page.evaluate(([CASE, DIST, TYPE, SIDE, GUN, YAW]) => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    const r = ctx.render;
    r.dynamicResolution.enabled = false;
    lab.settings.overlay = false;
    if (!GUN) {
      r.viewScene.visible = false;
      const css = document.createElement('style');
      css.textContent = '.lab-hint, .hud, #hud, .crosshair { visibility: hidden !important; }';
      document.head.appendChild(css);
    }
    const p = ctx.player;
    p.modifiers.invulnerable = true;
    const V = p.position.constructor;
    // Turned away from the moon: straight under it the wet floor throws a white glint where the body would lie, which
    // washes out a fire's light and its scorch.
    p.teleport(p.position.clone(), p.yaw + YAW);
    p.pitch = 0;
    const f = new V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new V(-f.z, 0, f.x);
    const at = p.position.clone().addScaledVector(f, DIST);
    at.y = 0;
    const place = (id, pos, ai) => lab.spawner.place(id, pos, ai);
    const bite = e => {
      const point = e.char.bones[2].getWorldPosition(new V());
      point.addScaledVector(f, -0.15);
      ctx.enemies.applyDamage(e, { amount: 9, type: 'fire', point, dir: f.clone(), force: 1, source: 'kiln', bone: 2, region: 'chest' });
    };
    const made = [];
    const state = { CASE, bites: 0 };
    window.__fire = { made, state, bite };
    if (CASE === 'ten' || CASE === 'tencold' || CASE === 'tendead') {
      for (let i = 0; i < 10; i++) {
        const e = place(TYPE, at.clone().addScaledVector(right, (i % 5 - 2) * 1.3).addScaledVector(f, Math.floor(i / 5) * 2.2), 'off');
        if (!e) continue;
        // `ten` stand and burn for as long as the clip runs; `tendead` die of it at once and burn as corpses.
        if (CASE === 'ten') e.health = e.maxHealth = 1e5;
        if (CASE !== 'tencold') ctx.enemies.afflict(e, 'burn', 600);
        if (CASE === 'tendead') ctx.enemies.applyDamage(e, { amount: 1e4, type: 'fire', point: e.center.clone(), dir: f.clone(), force: 1, source: 'kiln', bone: 2, region: 'chest' });
        made.push(e);
      }
    } else {
      const ai = CASE === 'zombie' || CASE === 'panic' ? 'on' : 'off';
      const e = place(TYPE, at, ai);
      made.push(e);
      if (!e) return { error: 'no body' };
      if (CASE === 'slow' || CASE === 'zombie' || CASE === 'panic' || CASE === 'limb' || CASE === 'burntgib') ctx.enemies.afflict(e, 'burn', CASE === 'zombie' ? 60 : 8);
      if (CASE === 'burntgib') {
        // Burnt black on his feet, then a rocket at his feet: what comes off him is burnt too.
        e.health = e.maxHealth = 1e5;
        e.charred = 1;
      }
      if (CASE === 'zombie') e.health = e.maxHealth = 1e5;
      if (CASE === 'blast') {
        const c = e.char.bones[2].getWorldPosition(new V());
        ctx.combat.explode(c.clone().addScaledVector(f, -2.4).setY(0.3), { radius: 6, damage: 60, kind: 'rocket', source: 'rocket', team: 'player' });
      }
    }
    if (SIDE) {
      // The player steps off to the side and looks back at the body: the game's own camera, so its own lens.
      p.teleport(at.clone().addScaledVector(right, DIST).addScaledVector(f, -0.5), Math.atan2(right.x, right.z) + Math.PI);
    }
    p.pitch = -0.08 - 0.5 / Math.max(DIST, 2);
    return { type: made[0]?.def.id, at: [at.x, at.z], fire: ctx.gore.fire ? 'new' : 'old' };
  }, [CASE, DIST, TYPE, SIDE, GUN, YAW]);

  // What happens after the first frame rides on the page's own frames, so the sheet's stepping drives it.
  await page.evaluate(([CASE]) => {
    const { ctx } = window.__op2;
    const { made, state, bite } = window.__fire;
    const e = made[0];
    let last = ctx.time.elapsed;
    const start = last;
    let cut = false;
    const tick = () => {
      requestAnimationFrame(tick);
      const now = ctx.time.elapsed;
      const t = now - start;
      if ((CASE === 'fast' || CASE === 'corpse') && e.alive) {
        // 30 bites a second, as the Kiln's stream.
        while (last + 1 / 30 <= now && e.alive) {
          last += 1 / 30;
          bite(e);
          state.bites++;
          ctx.enemies.afflict(e, 'burn', 4);
        }
        if (!e.alive) state.deadAt = t;
      }
      if (CASE === 'burntgib' && !cut && t > 0.8) {
        cut = true;
        e.health = 1;
        const V = ctx.player.position.constructor;
        const c = e.char.bones[2].getWorldPosition(new V());
        ctx.combat.explode(c.clone().setY(0.2), { radius: 5, damage: 400, kind: 'rocket', source: 'rocket', team: 'player' });
      }
      if (CASE === 'limb' && !cut && t > 1.2) {
        cut = true;
        const V = ctx.player.position.constructor;
        const point = e.char.bones[5].getWorldPosition(new V());
        ctx.gore.sever(e.char, 'armL', { amount: 60, type: 'slash', point, dir: new V(0.4, 0.3, -0.2).normalize(), force: 40, source: 'sword' });
      }
      if (!e.alive && state.deadAt === undefined) state.deadAt = t;
    };
    requestAnimationFrame(tick);
  }, [CASE]);
  console.error('[fire-look]', JSON.stringify(out));
  return out;
}
