// Key 5 in the real game on the Test Range: real keys and the real mouse through pointer lock, real enemies with AI off,
// real gore. Reports who each weapon reached in a line at 1.5, 2.5, 3.5, 5 and 8 m (eye to the front of the body),
// what it did to them, and takes stills.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/melee-live.mjs --wait 500 --timeout 300 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/melee/live.png
//
// MELEE_ONLY=keys,reach,four,back,baton,crowbar,fling,edge,dash reruns named steps.
const only = (process.env.MELEE_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function meleeLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.kills = [];
    ctx.events.on('enemy:killed', k => window.kills.push({ src: k.damage.source, type: k.damage.type, sliced: k.sliced, head: k.headshot, gib: k.gibbed, at: k.enemy.position.clone() }));
    window.start = ctx.player.position.clone();
    window.startYaw = ctx.player.yaw;
    window.home = async () => {
      ctx.player.teleport(window.start, window.startYaw);
      ctx.player.pitch = -0.12;
      await window.world(0.3);
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      window.__lab.spawner.clearBodies();
      window.kills.length = 0;
      await window.frame();
    };
    window.line = async (id = 'trooper', backs = false) => {
      await window.wipe();
      await window.home();
      const lab = window.__lab;
      Object.assign(lab.settings, { spawn: id, ai: 'off' });
      lab.changed();
      const before = new Set(ctx.enemies.alive);
      lab.melee(backs);
      window.crew = ctx.enemies.alive.filter(e => !before.has(e)).sort((a, b) => a.position.distanceTo(ctx.player.position) - b.position.distanceTo(ctx.player.position));
      await window.world(0.6);
      return window.crew.length;
    };
    const FRACTURE_BONES = 24;
    window.read = () => window.crew.map(e => {
      let broken = 0;
      for (let b = 0; b < FRACTURE_BONES; b++) if (e.char.isFractured?.(b)) broken++;
      return { hp: e.alive ? Math.round(e.health) : 0, down: e.downed || e.rising > 0, broken, severed: e.char.severed.size };
    });
    window.moved = () => +ctx.player.position.distanceTo(window.start).toFixed(2);
  });
  const out = {};
  const draw = id => page.evaluate(async w => {
    window.__lab.draw(w);
    await window.world(0.5);
  }, id);
  const swing = async (ms = 60, button = 'left') => {
    await page.mouse.down({ button });
    await h.sleep(ms);
    await page.mouse.up({ button });
  };

  await page.mouse.click(400, 500);
  await h.sleep(500);

  if (wants('keys')) {
    await draw('sword');
    const seq = [];
    for (let i = 0; i < 5; i++) {
      await h.press('Digit5', 60);
      await h.sleep(600);
      seq.push(await page.evaluate(() => window.__op2.ctx.weapons.current));
      if (i === 0) await h.shot('hud-knife');
    }
    out.keys = seq.join(' ');
  }

  if (wants('reach')) {
    // The katana, standing, the button held through a whole chain.
    out.reach = {};
    await page.evaluate(() => window.line());
    await draw('sword');
    await page.mouse.down();
    await h.sleep(90);
    await h.shot('katana-swing');
    await h.sleep(900);
    await page.mouse.up();
    await h.sleep(800);
    out.reach.sword = await page.evaluate(() => ({ line: window.read(), moved: window.moved(), kills: window.kills.map(k => `${k.src}${k.sliced ? '/sliced' : ''}`) }));
  }

  if (wants('four')) {
    out.four = {};
    for (const id of ['knife', 'crowbar', 'shovel', 'baton']) {
      await page.evaluate(() => window.line());
      await draw(id);
      await page.mouse.down();
      await h.sleep(1200);
      await page.mouse.up();
      await h.sleep(900);
      out.four[id] = await page.evaluate(() => ({ line: window.read(), moved: window.moved(), kills: window.kills.map(k => `${k.src}:${k.type}${k.sliced ? '/sliced' : ''}`) }));
      await h.shot(`four-${id}`);
    }
  }

  if (wants('back')) {
    // One cut of the Shiv on the nearest, face on and back turned.
    out.back = {};
    for (const backs of [false, true]) {
      await page.evaluate(b => window.line('gunner', b), backs);
      await draw('knife');
      await swing(60);
      await h.sleep(500);
      out.back[backs ? 'behind' : 'front'] = await page.evaluate(() => window.read()[0]);
    }
  }

  if (wants('baton')) {
    // The Cosh on one Trooper: blows until it goes down, and how much health it has left when it does.
    await page.evaluate(() => window.line());
    await draw('baton');
    const log = [];
    for (let i = 0; i < 8; i++) {
      await swing(60);
      await h.sleep(320);
      const r = await page.evaluate(() => window.read()[0]);
      log.push(`${r.hp}${r.down ? 'D' : ''}`);
      if (i === 2) await h.shot('baton-down');
    }
    out.baton = log.join(' ');
  }

  if (wants('crowbar')) {
    // The Prybar's overhead on a Trooper's arm: look a little down and to its side.
    out.crowbar = {};
    await page.evaluate(() => window.line());
    await draw('crowbar');
    await page.evaluate(() => { window.__op2.ctx.player.pitch = -0.3; });
    await swing(60);
    await h.sleep(900);
    out.crowbar.body = await page.evaluate(() => window.read()[0]);
    await page.evaluate(() => window.line('brute'));
    await draw('crowbar');
    await swing(60, 'right');
    await h.sleep(900);
    out.crowbar.brute = await page.evaluate(() => ({ r: window.read()[0], armor: Math.round(window.crew[0].armor), max: window.crew[0].maxHealth }));
  }

  if (wants('fling')) {
    // The face of the Spade on a Trooper with the health for one blow: how far the body ends up from where it stood.
    out.fling = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.line());
      await page.evaluate(() => { window.crew[0].health = 20; window.stood = window.crew[0].position.clone(); });
      await draw('shovel');
      await swing(60);
      await h.sleep(250);
      if (i === 0) await h.shot('spade-fling');
      await h.sleep(2200);
      out.fling.push(await page.evaluate(() => {
        const e = window.crew[0];
        const hips = e.char.bones[0].getWorldPosition(new e.position.constructor());
        return { dead: !e.alive, hips: +Math.hypot(hips.x - window.stood.x, hips.z - window.stood.z).toFixed(2), kills: window.kills.map(k => k.type) };
      }));
    }
  }

  if (wants('edge')) {
    // The Spade's edge at head height on a Trooper: does it take the head.
    out.edge = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.line());
      await page.evaluate(() => { window.__op2.ctx.player.pitch = 0.0; });
      await draw('shovel');
      await swing(60, 'right');
      await h.sleep(380);
      if (i === 0) await h.shot('spade-edge');
      await h.sleep(320);
      out.edge.push(await page.evaluate(() => ({ r: window.read()[0], kills: window.kills.map(k => `${k.type}${k.sliced ? '/sliced' : ''}${k.head ? '/head' : ''}`), head: window.crew[0].char.severed.has('head') })));
    }
  }

  if (wants('dash')) {
    // Running at a Trooper 9 m off and swinging at 6.5: the dash. Then the same swing standing still at 6.5.
    out.dash = {};
    for (const run of [true, false]) {
      await page.evaluate(() => window.wipe());
      await page.evaluate(() => window.home());
      await page.evaluate(() => {
        const { ctx } = window.__op2;
        const f = ctx.player.forward;
        const at = ctx.player.position.clone().addScaledVector(new f.constructor(f.x, 0, f.z).normalize(), 9.4);
        Object.assign(window.__lab.settings, { spawn: 'trooper', ai: 'off' });
        window.crew = [window.__lab.spawner.place('trooper', at, 'off')];
      });
      await draw('sword');
      let peak = 0;
      if (run) {
        await h.keyDown('KeyW');
        for (let i = 0; i < 40; i++) {
          const d = await page.evaluate(() => window.crew[0].position.distanceTo(window.__op2.ctx.player.position));
          if (d < 6.9) break;
          await h.sleep(16);
        }
      }
      await swing(40);
      for (let i = 0; i < 20; i++) {
        peak = Math.max(peak, await page.evaluate(() => Math.hypot(window.__op2.ctx.player.velocity.x, window.__op2.ctx.player.velocity.z)));
        await h.sleep(16);
      }
      if (run) await h.keyUp('KeyW');
      await h.sleep(500);
      out.dash[run ? 'running' : 'standing'] = await page.evaluate(p => ({ peak: +p.toFixed(1), r: window.read()[0], moved: window.moved() }), peak);
    }
  }
  return out;
}
