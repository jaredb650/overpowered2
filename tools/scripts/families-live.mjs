// Weapon families and penetration in the real game, on the Test Range's piercing gallery: real keys, real enemies,
// real walls. Reports what each gun reached behind which wall, and takes stills of the HUD strip, the sonar picture,
// the thick tracer and the exit holes.
//
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/families-live.mjs --wait 500 --timeout 280 \
//     --dpr 2 --w 1440 --h 900 --out tools/out/fam/live.png
//
// FAM_ONLY=keys,gallery,holes,tracer,cost,shield,hellfire,lance,reach,exits reruns named steps.
const only = (process.env.FAM_ONLY ?? '').split(',').filter(Boolean);
const wants = step => only.length === 0 || only.includes(step);

export default async function familiesLive(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => {
    const { ctx } = window.__op2;
    window.V = ctx.player.position.constructor;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.wipe = async () => {
      ctx.enemies.reset();
      window.__lab.spawner.clearBodies();
      await window.frame();
    };
    /** Health of everyone standing in the gallery, nearest bay first. Dead reads 0. */
    window.bays = () => window.galleryCrew.map(e => (e.alive ? Math.round(e.health) : 0));
    window.fill = async (id = 'trooper') => {
      await window.wipe();
      const lab = window.__lab;
      Object.assign(lab.settings, { spawn: id, ai: 'off' });
      lab.changed();
      const before = new Set(ctx.enemies.alive);
      const placed = lab.gallery();
      window.galleryCrew = ctx.enemies.alive.filter(e => !before.has(e)).sort((a, b) => a.position.x - b.position.x);
      // Flat enough to be on the chest of the body in the last bay, 25 m off.
      ctx.player.pitch = -0.012;
      await window.world(0.8);
      return placed;
    };
  });
  const out = {};
  const key = async code => {
    await h.press(code, 60);
    await h.sleep(650);
    return page.evaluate(() => window.__op2.ctx.weapons.current);
  };
  const draw = id => page.evaluate(async w => {
    window.__lab.draw(w);
    await window.world(0.6);
  }, id);
  const fire = async ms => {
    await h.click(ms);
    await h.sleep(500);
  };

  // Real pointer lock, so the number keys and the trigger are the player's.
  await page.mouse.click(400, 500);
  await h.sleep(500);

  if (wants('keys')) {
    const seq = [];
    await draw('smg');
    for (const code of ['Digit1', 'Digit1', 'Digit1', 'Digit2', 'Digit1', 'Digit4', 'Digit4', 'Digit6', 'Digit6', 'KeyQ', 'Digit1']) {
      seq.push(`${code.replace('Digit', '').replace('Key', '')}:${await key(code)}`);
      if (seq.length === 1) await h.shot('hud-harrow');
      if (seq.length === 7) await h.shot('hud-sabot');
      if (seq.length === 9) await h.shot('hud-rivet');
    }
    out.keys = seq.join(' ');
    out.strip = await page.evaluate(() => [...document.querySelectorAll('.arm-strip .slot')].map(s =>
      `${s.querySelector('.slot-key').textContent}${s.classList.contains('active') ? '*' : ''}${[...s.querySelectorAll('.slot-pip')].map(p => (p.classList.contains('on') ? '#' : 'o')).join('')}`).join(' '));
    out.family = await page.evaluate(() => document.querySelector('.arm-family')?.textContent);
  }

  if (wants('gallery')) {
    out.gallery = {};
    out.gallery.placed = await page.evaluate(() => window.fill());
    out.gallery.stand = await page.evaluate(() => {
      const p = window.__op2.ctx.player;
      return { x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), fx: +p.forward.x.toFixed(2) };
    });
    // The owner's loop: ping, see them through the walls, shoot them through the walls.
    await draw('sabot');
    await h.press('KeyT', 80);
    await h.sleep(1500);
    await h.shot('sonar');
    out.gallery.before = await page.evaluate(() => window.bays());
    await page.mouse.down();
    await h.sleep(40);
    await h.shot('sabot-shot');
    await page.mouse.up();
    await h.sleep(900);
    out.gallery.sabot = await page.evaluate(() => window.bays());
    await h.shot('sabot-after');

    for (const [id, ms] of [['harrow', 700], ['smg', 700], ['rivet', 120], ['autocannon', 120]]) {
      await page.evaluate(() => window.fill());
      await draw(id);
      await fire(ms);
      await h.sleep(600);
      out.gallery[id] = await page.evaluate(() => window.bays());
    }
    // Something big enough to live through one: a Brute's plates and a dart.
    await page.evaluate(() => window.fill('brute'));
    await draw('sabot');
    await fire(120);
    out.gallery.sabotBrutes = await page.evaluate(() => window.bays());
    // A projectile with a budget, down the same lane.
    await page.evaluate(() => window.fill());
    out.gallery.projectile = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const p = ctx.player;
      ctx.combat.spawnProjectile({
        origin: p.eye.clone(), velocity: p.forward.clone().multiplyScalar(240), kind: 'bullet', team: 'player', damage: 400, source: 'sabot',
        penetrate: 5, bodyCost: 0.12, tracer: 'heavy',
      });
      await window.world(0.6);
      return window.bays();
    });
  }

  if (wants('holes')) {
    await page.evaluate(() => window.fill());
    await draw('sabot');
    await fire(120);
    await page.evaluate(async () => {
      const p = window.__op2.ctx.player;
      // In the bay behind the 0.6 m wall, looking back at the face the round came out of.
      p.teleport(new window.V(13.2, 0.1, 22), Math.PI / 2);
      p.pitch = -0.1;
      await window.world(0.3);
    });
    await h.shot('exit-hole');
    await page.evaluate(async () => {
      const p = window.__op2.ctx.player;
      p.teleport(new window.V(3.4, 0.1, 22), -Math.PI / 2);
      p.pitch = -0.1;
      await window.world(0.3);
    });
    await h.shot('entry-hole');
    out.decals = await page.evaluate(() => {
      const d = window.__op2.ctx.render.decals;
      return d.count ?? d.live ?? null;
    });
  }

  if (wants('tracer')) {
    // From the open side of the lane, with the world slowed, so the thick tracer and the puff behind each wall can be seen.
    await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.fill();
      const p = ctx.player;
      p.teleport(new window.V(14, 0.1, 9), Math.PI);
      p.pitch = 0.02;
      await window.world(0.4);
      window.__lab.setSpeed(0.05);
      ctx.combat.fireRay(new window.V(1.5, 1.35, 22), new window.V(1, 0, 0), {
        damage: 600, source: 'sabot', team: 'player', tracer: 'sabot', penetrate: 5, bodyCost: 0.12, impactScale: 2.2, force: 140, armorPiercing: true,
      });
    });
    await h.sleep(120);
    await h.shot('tracer-1');
    await h.sleep(500);
    await h.shot('tracer-2');
    await page.evaluate(async () => {
      window.__lab.setSpeed(1);
      await window.world(0.5);
    });
    await h.shot('tracer-after');
  }

  // A line of bodies in the open, nearest first, and the player aimed down it. Returns the crew.
  const lineUp = ids => page.evaluate(async ids => {
    const { ctx } = window.__op2;
    const lab = window.__lab;
    await window.wipe();
    const p = ctx.player;
    p.teleport(new window.V(0, 0.1, 10), 0);
    await window.world(0.4);
    const f = p.forward.clone().setY(0).normalize();
    window.crew = ids.map((id, i) => lab.spawner.place(id, p.position.clone().addScaledVector(f, 8 + i * 3).setY(0), 'off'));
    await window.world(0.8);
    // Aim at the chest of the last one: the line passes through everyone before it.
    for (let i = 0; i < 3; i++) {
      const d = window.crew[window.crew.length - 1].center.clone().sub(p.eye).normalize();
      p.yaw = Math.atan2(-d.x, -d.z);
      p.pitch = Math.asin(d.y);
      await window.frame();
    }
    window.hits.length = 0;
    window.blasts.length = 0;
    return window.crew.map(e => Math.round(e.health));
  }, ids);
  const crew = () => page.evaluate(() => window.crew.map(e => (e.alive ? Math.round(e.health) : 0)));
  if (['shield', 'hellfire', 'lance', 'reach'].some(wants)) {
    await page.evaluate(() => {
      const { ctx } = window.__op2;
      window.hits = [];
      window.blasts = [];
      ctx.events.on('enemy:hit', e => window.hits.push(`${e.enemy.id} ${e.damage.source} ${e.damage.type} amt${Math.round(e.damage.amount)} dealt${Math.round(e.result.dealt)}${e.result.blocked ? ' blocked' : ''}`));
      const explosion = ctx.fx.explosion.bind(ctx.fx);
      ctx.fx.explosion = (at, look) => {
        window.blasts.push([at.x, at.y, at.z].map(v => +v.toFixed(1)));
        return explosion(at, look);
      };
    });
  }

  if (wants('shield')) {
    // A Riot facing the player with two Troopers behind him. The dart goes through shield, man and both Troopers; the
    // Harrow's round is stopped by the shield, as every other gun's is.
    out.shield = {};
    for (const id of ['sabot', 'harrow']) {
      const before = await lineUp(['riot', 'trooper', 'trooper']);
      await draw(id);
      await fire(id === 'sabot' ? 120 : 60);
      out.shield[id] = { before, after: await crew(), hits: await page.evaluate(() => window.hits.slice(0, 6)) };
    }
  }

  if (wants('hellfire')) {
    // Hellfire Rounds through the real perk: the first burst has to be on the man the round hit, 8 m out, for every gun.
    // The Harrow and the Sabot go on through him, so they burst again further on, where they stop.
    out.hellfire = {};
    await page.evaluate(async () => {
      const lab = window.__lab;
      lab.settings.progression = true;
      lab.changed();
      await window.world(0.2);
    });
    for (const id of ['smg', 'harrow', 'sabot']) {
      await lineUp(['trooper']);
      await page.evaluate(async () => {
        window.__op2.ctx.progression.grant('hellfire');
        await window.world(0.2);
      });
      await draw(id);
      const on = await page.evaluate(() => window.__op2.ctx.weapons.modifiers.explosiveRounds);
      await page.evaluate(() => { window.blasts.length = 0; });
      await fire(id === 'sabot' ? 120 : 60);
      out.hellfire[id] = await page.evaluate(on => {
        const p = window.__op2.ctx.player;
        const first = window.blasts[0];
        const from = at => +Math.hypot(at[0] - p.position.x, at[2] - p.position.z).toFixed(1);
        return { perk: on, burstsAt: window.blasts.map(from), firstAt: first ? from(first) : null };
      }, on);
    }
    await page.evaluate(async () => {
      const lab = window.__lab;
      lab.settings.progression = false;
      lab.changed();
      window.__op2.ctx.progression.reset?.();
      await window.world(0.2);
    });
  }

  if (wants('lance')) {
    // The rule it had before budgets: two walls, each up to 1.6 m, of anything. Down the gallery that is the 0.3 and
    // 0.6 m panels, so the first two bays die and the third wall stops it. What tells this rule from a total of 1.6 m
    // is in penetration.test.ts; the gallery's walls give the same answer under both.
    await page.evaluate(() => window.fill());
    await draw('lance');
    await page.mouse.down();
    await h.sleep(1300);
    await page.mouse.up();
    await h.sleep(700);
    out.lance = await page.evaluate(() => window.bays());
  }

  if (wants('reach')) {
    // One Juggernaut 50 m off: what a round of each gun deals out there.
    out.reach = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.wipe();
      const p = ctx.player;
      p.teleport(new window.V(-28, 0.1, 14), -Math.PI / 2);
      await window.world(0.4);
      const f = p.forward.clone().setY(0).normalize();
      const far = window.__lab.spawner.place('juggernaut', p.position.clone().addScaledVector(f, 50).setY(0), 'off');
      await window.world(0.8);
      window.crew = [far];
      const d = far.center.clone().sub(p.eye).normalize();
      p.yaw = Math.atan2(-d.x, -d.z);
      p.pitch = Math.asin(d.y);
      await window.frame();
      return { distance: +far.center.distanceTo(p.eye).toFixed(1), clear: !ctx.physics.raycast(p.eye, d, far.center.distanceTo(p.eye) - 1, 1) };
    });
    for (const id of ['smg', 'harrow', 'rivet']) {
      await draw(id);
      await page.evaluate(() => { window.hits.length = 0; });
      await fire(40);
      out.reach[id] = await page.evaluate(() => window.hits[0] ?? null);
    }
  }

  if (wants('exits')) {
    // Three darts through the 0.3 m panel, square on and at two slants, then the far face seen from the bay behind it.
    out.exits = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const V = window.V;
      await window.wipe();
      const sabot = { damage: 600, source: 'sabot', team: 'player', tracer: 'sabot', penetrate: 5, bodyCost: 0.12, impactScale: 2.2, force: 140, armorPiercing: true };
      const harrow = { damage: 50, source: 'harrow', team: 'player', tracer: 'carbine', penetrate: 0.5, impactScale: 1.25, force: 14 };
      const mark = (z0, slope, y, spec) => {
        const dir = new V(1, 0, slope).normalize();
        const origin = new V(1.5, y, z0);
        ctx.combat.fireRay(origin, dir, spec);
        const t = (6.3 - origin.x) / dir.x;
        return [6.3, y, +(origin.z + dir.z * t).toFixed(2)];
      };
      const marks = { square: mark(21, 0, 1.5, sabot), deg32: mark(19.2, 0.62, 1.5, sabot), deg46: mark(18.6, 1.05, 1.5, sabot), harrow: mark(20.2, 0, 1.5, harrow) };
      window.marks = marks;
      await window.world(1.5);
      return marks;
    });
    const stand = (x, y, z, at) => page.evaluate(async ([x, y, z, at]) => {
      const p = window.__op2.ctx.player;
      p.teleport(new window.V(x, y, z), 0);
      await window.world(0.3);
      for (let i = 0; i < 3; i++) {
        const d = new window.V(at[0], at[1], at[2]).sub(p.eye).normalize();
        p.yaw = Math.atan2(-d.x, -d.z);
        p.pitch = Math.asin(d.y);
        await window.frame();
      }
      await window.world(0.3);
    }, [x, y, z, at]);
    await draw('rivet');
    // All four on the far face at once, from the middle of the bay.
    await stand(8.8, 0.1, 21.9, [6.3, 1.5, 21.9]);
    await h.shot('exits-far-face');
    // The most slanted one, close and nearly edge on: a mark that stood off the wall would show here as a sliver.
    const m = out.exits.deg46;
    await stand(7.0, 0.1, m[2] - 1.2, m);
    await h.shot('exits-slant-edge');
    // The near face, for the holes going in.
    await stand(4.2, 0.1, 21.4, [6.0, 1.5, 21.4]);
    await h.shot('exits-near-face');
  }

  if (wants('cost')) {
    out.cost = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      await window.fill('juggernaut');
      const p = ctx.player;
      const time = (spec, n = 300) => {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) ctx.combat.fireRay(p.eye, p.forward, spec);
        return +((performance.now() - t0) / n).toFixed(4);
      };
      const base = { damage: 0.001, source: 'test', team: 'player' };
      return {
        msPlain: time(base),
        msHarrow: time({ ...base, penetrate: 0.5 }),
        msSabot: time({ ...base, penetrate: 5, bodyCost: 0.12 }),
      };
    });
  }
  await page.evaluate(() => window.wipe());
  return out;
}
