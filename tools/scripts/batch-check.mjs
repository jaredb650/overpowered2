// The small batch in the real game, on real bodies: the dev panel by real clicks, head knockdowns, shaped charges, the waist tear, machines in a blast, and a big crowd.
//   node tools/shot.mjs --url "/?map=range" --script tools/scripts/batch-check.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 150 --out tools/out/batch.png
// Add &contract=outpost for the human rules. /?dev=1&autostart=1 runs the panel alone, on the real game. BATCH=panel,head,charge,waist,machines,crowd picks the parts.
const parts = (process.env.BATCH ?? 'panel,head,charge,waist,machines,crowd').split(',').filter(Boolean);
// Only one seat can be taken in a run. BATCH_SEAT=ac130:KeyM or attackChopper:KeyH tries another.
const seats = (process.env.BATCH_SEAT ?? 'doorGunner:KeyJ').split(',').map(pair => pair.split(':'));

export default async function batchCheck(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const out = {};
  await page.evaluate(() => {
    const lab = window.__lab;
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    window.V = V;
    window.frame = () => new Promise(r => requestAnimationFrame(r));
    window.world = async seconds => {
      const end = ctx.time.elapsed + seconds;
      while (ctx.time.elapsed < end) await window.frame();
    };
    window.wipe = async () => {
      ctx.enemies.killAll('lab');
      ctx.enemies.reset();
      lab.spawner.clearBodies();
      ctx.player.teleport(new V(0, 0.1, 12), 0);
      await window.world(0.1);
    };
    window.look = t => {
      const d = new V().subVectors(t, ctx.player.eye);
      ctx.player.yaw = Math.atan2(-d.x, -d.z);
      ctx.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
    window.boneAt = (e, bone) => {
      e.char.bones[bone].updateWorldMatrix(true, false);
      return new V().setFromMatrixPosition(e.char.bones[bone].matrixWorld);
    };
    /** A real ray from the player's eye at this bone, through Combat. */
    window.shoot = (e, bone, spec) => {
      const at = window.boneAt(e, bone);
      const dir = new V().subVectors(at, ctx.player.eye).normalize();
      return ctx.combat.fireRay(ctx.player.eye.clone(), dir, { team: 'player', tracer: 'bullet', ...spec });
    };
    window.hits = [];
    ctx.events.on('enemy:hit', e => window.hits.push({ dealt: +e.result.dealt.toFixed(1), blocked: e.result.blocked, killed: e.result.killed, pierces: e.damage.pierces === true, reach: e.damage.reach, type: e.damage.type }));
  });

  if (parts.includes('panel')) {
    await page.evaluate(() => {
      window.started = [];
      window.__op2.ctx.events.on('perk:start', e => window.started.push(e.id));
    });
    await h.keyDown('F1');
    await h.keyUp('F1');
    await h.sleep(300);
    const labels = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.lab-panel h2')];
      const section = name => {
        const h2 = heads.find(x => x.textContent === name);
        const buttons = [];
        for (let n = h2?.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) buttons.push(...n.querySelectorAll('button'));
        return buttons.map(b => b.textContent);
      };
      return { calls: section('CALL-INS TO INVENTORY'), perks: section('PERKS'), powerups: section('POWERUPS'), combo: section('COMBO') };
    });
    await page.screenshot({ path: `${h.outDir}/batch-panel.png` });
    const click = text => page.locator('.lab-panel button', { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click({ timeout: 4000 });
    // A rung set by hand pays out on the next kill, when combos are on, which is the default everywhere but the range.
    await click('15');
    const rung = await page.evaluate(async () => {
      const { ctx } = window.__op2;
      const lab = window.__lab;
      const before = [...ctx.progression.callIns];
      const e = lab.spawner.place('husk', new window.V(0, 0, 6), 'off');
      await window.frame();
      if (e) ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', point: e.center.clone(), dir: new window.V(0, 0, -1), force: 4, source: 'smg', region: 'chest' });
      await window.frame();
      return { progression: lab.flags.progression, before, after: [...ctx.progression.callIns], combo: ctx.progression.combo };
    });
    for (const label of labels.calls) await click(label);
    const held = await page.evaluate(() => [...window.__op2.ctx.progression.callIns]);
    const failed = [];
    for (const label of [...labels.perks, ...labels.powerups]) {
      const before = await page.evaluate(() => window.started.length);
      await click(label);
      await h.sleep(60);
      if (await page.evaluate(n => window.started.length === n, before)) failed.push(label);
    }
    const combos = {};
    for (const label of labels.combo) {
      await click(label);
      combos[label] = await page.evaluate(() => window.__op2.ctx.progression.combo);
    }
    await page.screenshot({ path: `${h.outDir}/batch-granted.png` });
    await h.keyDown('Escape');
    await h.keyUp('Escape');
    await h.sleep(300);
    out.panel = { labels, held, perksFailed: failed, started: await page.evaluate(() => window.started.length), combos, rung };
    const seat = {};
    for (const [id, key] of seats) {
      const before = await page.evaluate(() => window.__op2.ctx.progression.callIns.size);
      await h.keyDown(key);
      await h.keyUp(key);
      await h.sleep(1200);
      seat[id] = await page.evaluate(n => {
        const p = window.__op2.ctx.progression;
        return { used: p.callIns.size < n, targeting: p.targeting, parked: window.__op2.ctx.player.parked };
      }, before);
      if (seat[id].targeting) {
        await page.mouse.down();
        await h.sleep(80);
        await page.mouse.up();
        await h.sleep(600);
        seat[id].afterClick = await page.evaluate(() => ({ targeting: window.__op2.ctx.progression.targeting, cooling: window.__op2.ctx.progression.callInCooldown('ac130') }));
      }
    }
    await page.screenshot({ path: `${h.outDir}/batch-callin.png` });
    out.seat = seat;
  }

  if (parts.includes('head')) {
    out.head = await page.evaluate(async () => {
      const lab = window.__lab;
      const { ctx } = window.__op2;
      const human = !!ctx.enemies.outpost;
      const id = human ? 'trooper' : 'brute';
      const heavy = { damage: 120, source: 'judge', force: 40, headshotMult: 1 };
      const pellet = { damage: 20, source: 'shotgun', type: 'pellet', force: 18, headshotMult: 2 };
      const light = { damage: 8, source: 'smg', force: 4, headshotMult: 1 };
      const cases = human
        ? [['helmet, pellet', pellet, true], ['helmet, smg', light, true]]
        : [['plate, pellet', pellet, true], ['plate, smg', light, true], ['bare, pellet', pellet, false], ['bare, heavy', heavy, false], ['bare, smg', light, false]];
      const rows = [];
      for (const [name, spec, plated] of cases) {
        await window.wipe();
        const e = lab.spawner.place(id, new window.V(0, 0, 5), 'off');
        await window.world(0.4);
        if (!plated) {
          for (const p of e.plates) p.hp = 0;
          e.armor = 0;
        }
        window.look(window.boneAt(e, 4));
        window.hits.length = 0;
        const hp = e.health;
        const armor = e.armor;
        const shot = window.shoot(e, 4, spec);
        const row = { name, hit: window.hits[0] ?? null, hp: [hp, +e.health.toFixed(1)], armor: [armor, +e.armor.toFixed(1)], alive: e.alive, downed: e.downed, stagger: +e.stagger.toFixed(2), kills: shot?.kills };
        for (let i = 0; i < 7 / 0.25 && (e.downed || e.rising > 0); i++) await window.world(0.25);
        row.upAgain = e.alive && !e.downed && e.rising <= 0;
        rows.push(row);
      }
      return rows;
    });
  }

  if (parts.includes('charge')) {
    out.charge = await page.evaluate(async () => {
      const lab = window.__lab;
      const { ctx } = window.__op2;
      const human = !!ctx.enemies.outpost;
      const id = human ? 'trooper' : 'brute';
      const rocket = { kind: 'rocket', team: 'player', damage: 100, source: 'rocket', force: 90, severMult: 1, gib: true, explosion: { radius: 8, damage: 100, kind: 'rocket' } };
      const fire = (e, spec) => {
        const at = window.boneAt(e, 2);
        const origin = at.clone().add(new window.V(0, 0, 2.4));
        const dir = new window.V().subVectors(at, origin).normalize();
        ctx.combat.spawnProjectile({ ...spec, origin, velocity: dir.multiplyScalar(40) });
      };
      const rows = [];
      for (const plated of [true, false]) {
        await window.wipe();
        const e = lab.spawner.place(id, new window.V(0, 0, 5), 'off');
        e.yaw = 0;
        e.maxHealth = e.health = 900;
        await window.world(0.3);
        if (!plated) {
          for (const p of e.plates) p.hp = 0;
          e.armor = 0;
        }
        const armor = e.armor;
        window.hits.length = 0;
        fire(e, rocket);
        await window.world(0.25);
        rows.push({ name: `rocket direct, ${plated ? 'armoured' : 'bare'}`, armor: [armor, +e.armor.toFixed(1)], hits: window.hits.slice(0, 2) });
      }
      for (const plated of [true, false]) {
        await window.wipe();
        const e = lab.spawner.place(id, new window.V(0, 0, 5), 'off');
        e.maxHealth = e.health = 900;
        await window.world(0.3);
        if (!plated) {
          for (const p of e.plates) p.hp = 0;
          e.armor = 0;
        }
        window.hits.length = 0;
        ctx.combat.explode(new window.V(3, 0.5, 5), { radius: 8, damage: 100, kind: 'rocket', source: 'rocket', team: 'player' });
        await window.world(0.1);
        rows.push({ name: `rocket splash at 3 m, ${plated ? 'armoured' : 'bare'}`, hits: window.hits.slice(0, 1) });
      }
      return rows;
    });
  }

  if (parts.includes('waist')) {
    out.waist = await page.evaluate(async () => {
      const lab = window.__lab;
      const { ctx } = window.__op2;
      let cut = 0;
      const off = ctx.events.on('enemy:severed', e => { if (e.region === 'abdomen') cut++; });
      let kills = 0;
      let waistHalves = 0;
      for (let i = 0; i < 14; i++) {
        await window.wipe();
        const e = lab.spawner.place('trooper', new window.V(0, 0, 9.8), 'off');
        for (const p of e.plates) p.hp = 0;
        e.armor = 0;
        await window.world(0.2);
        window.look(window.boneAt(e, 2));
        const before = cut;
        for (let n = 0; n < 12 && e.alive; n++) window.shoot(e, 1, { damage: 200, source: 'shotgun', type: 'pellet', force: 118, severMult: 7, headshotMult: 2 });
        if (!e.alive) kills++;
        if (cut > before) waistHalves++;
        await window.world(0.1);
      }
      off?.();
      return { kills, waistHalves };
    });
  }

  if (parts.includes('machines')) {
    out.machines = await page.evaluate(async () => {
      const lab = window.__lab;
      const { ctx } = window.__op2;
      const model = ctx.enemies.model;
      const rolled = model.rolled;
      const seen = {};
      model.rolled = function (e, d, a) {
        const r = rolled.call(this, e, d, a);
        if (r) seen[r.outcome] = (seen[r.outcome] ?? 0) + 1;
        return r;
      };
      const bloodHit = ctx.fx.bloodHit;
      let blood = 0;
      ctx.fx.bloodHit = function (...a) { blood++; return bloodHit.apply(this, a); };
      const sparks = ctx.fx.sparks;
      let spark = 0;
      ctx.fx.sparks = function (...a) { spark++; return sparks.apply(this, a); };
      for (let t = 0; t < 3; t++) {
        await window.wipe();
        for (let i = 0; i < 8; i++) lab.spawner.place(i % 2 ? 'skitter' : 'drone', new window.V(Math.cos(i * 2.4) * (1 + i * 0.6), 0, Math.sin(i * 2.4) * (1 + i * 0.6)), 'off');
        await window.world(0.3);
        ctx.combat.explode(new window.V(0.4, 0.3, -0.3), { radius: 7, damage: 190, kind: 'grenade', source: 'test', team: 'player' });
        await window.world(1.4);
      }
      model.rolled = rolled;
      ctx.fx.bloodHit = bloodHit;
      ctx.fx.sparks = sparks;
      return { seen, blood, spark };
    });
  }

  if (parts.includes('crowd')) {
    out.crowd = await page.evaluate(async () => {
      const lab = window.__lab;
      const { ctx } = window.__op2;
      const model = ctx.enemies.model;
      const sever = model.sever;
      let cuts = 0;
      model.sever = function (e, r, d, res) {
        const before = e.char.severed.size;
        sever.call(this, e, r, d, res);
        if (e.char.severed.size > before) cuts++;
      };
      const rows = [];
      for (const [id, count] of [['trooper', 12], ['husk', 36]]) {
        await window.wipe();
        ctx.player.park(new window.V(0, 7.5, 14));
        const crowd = [];
        for (let i = 0; i < count; i++) {
          const a = i * 2.399963;
          const d = 5.5 * Math.sqrt((i + 0.5) / count);
          crowd.push(lab.spawner.place(id, new window.V(Math.cos(a) * d, 0, Math.sin(a) * d), 'off'));
        }
        await window.world(0.4);
        cuts = 0;
        const t0 = performance.now();
        ctx.combat.explode(new window.V(0.4, 0.3, -0.3), { radius: 7, damage: 190, kind: 'grenade', source: 'test', team: 'player' });
        const blastMs = +(performance.now() - t0).toFixed(1);
        const row = { id, count, placed: crowd.filter(Boolean).length, cuts, blastMs, peakKnock: 0, peakRags: 0, peakStep: 0, peakFrame: 0 };
        let last = performance.now();
        for (let f = 0; f < 150; f++) {
          await window.frame();
          const now = performance.now();
          const s = ctx.gore.stats();
          row.peakKnock = Math.max(row.peakKnock, s.knockdowns);
          row.peakRags = Math.max(row.peakRags, s.ragdolls);
          row.peakStep = Math.max(row.peakStep, +ctx.physics.stepMs.toFixed(1));
          row.peakFrame = Math.max(row.peakFrame, +(now - last).toFixed(1));
          last = now;
        }
        await window.world(4);
        const alive = crowd.filter(e => e?.alive);
        row.alive = alive.length;
        row.stillDown = alive.filter(e => e.downed).length;
        rows.push(row);
      }
      model.sever = sever;
      return rows;
    });
  }
  return out;
}
