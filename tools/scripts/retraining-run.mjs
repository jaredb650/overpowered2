// Plays Retraining (docs/design/tutorial.md) from the clone bay to the door, with a screenshot at every station and through the nuke.
// It uses the player's own keys wherever a bot can (crouch, slide, slam, rocket jump, shooting, the shop, the stim, the blade, sonar,
// Gun Kata, questioning, release, capture, the nuke) and says so under `cheats` every time it has to teleport or kill instead.
//
//   node tools/shot.mjs --port 5214 --url "/?contract=retraining&autostart=1&dev=1" --script tools/scripts/retraining-run.mjs \
//     --out tools/out/retraining/run.png --wait 12000 --timeout 600 --dpr 2 --w 1440 --h 900 --quiet
export default async function run(page, h) {
  const out = { beats: [], cheats: [], notes: [] };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => {
    const op = window.__op2;
    const V = op.ctx.player.position.constructor;
    const p = () => op.ctx.player;
    window.__t = {
      beat: () => op.campaign.runner.beat?.id ?? null,
      tp(x, y, z, yaw = 0, pitch = 0) { p().teleport(new V(x, y, z), yaw); p().pitch = pitch; },
      look(x, y, z) {
        const q = p();
        const dx = x - q.eye.x, dy = y - q.eye.y, dz = z - q.eye.z;
        q.yaw = Math.atan2(-dx, -dz);
        q.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      },
      hold(k, on) { op.ctx.input.simulate(k, on); },
      god() { const q = p(); q.health = Math.max(q.health, 100); },
      godOn() {
        // The bot is testing the lessons, not its aim under fire: health topped up every frame.
        const loop = () => { const q = p(); if (q.alive) q.health = q.maxHealth; requestAnimationFrame(loop); };
        loop();
      },
      pos() { const q = p().position; return [q.x, q.y, q.z].map(v => Math.round(v * 10) / 10); },
      state: () => p().state,
      men() {
        return op.ctx.enemies.alive.map(e => ({ uid: e.uid, x: e.position.x, y: e.position.y, z: e.position.z, cy: e.center.y, plates: e.plates?.length ?? 0 }));
      },
      kill(uid) {
        const e = op.ctx.enemies.alive.find(m => m.uid === uid);
        if (!e) return false;
        op.ctx.enemies.applyDamage(e, { amount: 9999, type: 'bullet', point: e.center.clone(), dir: new V(0, 0, -1), force: 0, source: 'smg', team: 'player' });
        return true;
      },
      soldiers() {
        const o = op.ctx.enemies.outpost;
        return o ? o.soldiers.filter(s => s.e.alive).map(s => ({ uid: s.e.uid, dummy: !!s.e.dummy, fighting: s.fighting, surrendered: s.surrendered && !s.released && !s.cuffed, x: s.e.position.x, z: s.e.position.z })) : [];
      },
      credits: () => op.ctx.contracts.shop?.credits ?? null,
      buy: id => op.ctx.contracts.shop?.buy({ kind: 'mod', id }) ?? 'no shop',
      fitted: id => op.ctx.weapons.fitted.has(id),
      open: () => op.ctx.events.emit('shop:open', {}),
      say: () => op.campaign.runner.describe().radio,
      state2: () => op.game.state,
    };
  });
  const t = (name, ...args) => ev(([n, a]) => window.__t[n](...a), [name, args]);
  const beat = () => t('beat');
  const shot = async name => { await h.shot(name); out.notes.push(`shot ${name} at ${await beat()}`); };
  const waitBeat = async (id, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if ((await beat()) === id) { out.beats.push(id); return true; }
      await h.sleep(150);
    }
    out.notes.push(`waited for ${id}, still ${await beat()}`);
    return false;
  };
  const cheat = async (why, fn) => { out.cheats.push(why); await fn(); };
  const press = async (k, ms = 90) => { await t('hold', k, true); await h.sleep(ms); await t('hold', k, false); };
  const killAll = async (filter = () => true) => { for (const m of (await t('men')).filter(filter)) await t('kill', m.uid); };
  const shootAt = async (m, head, ms) => {
    await t('look', m.x, m.y + (head ? 1.62 : 1.25), m.z);
    await t('hold', 'fire', true);
    await h.sleep(ms);
    await t('hold', 'fire', false);
  };

  // FROM=yard starts at the Yard (the page with &beat=surrender), for the prisoners and the finale alone.
  if (process.env.FROM !== 'yard') {
    // Intake: the Council's opening, and the door behind the pod.
    await h.sleep(2500);
    await shot('01-intake');
    await t('tp', 0, 0.3, 8.5, Math.PI, 0.1);
    await h.sleep(900);
    await shot('02-intake-exit-door');
    await t('tp', 0, 0, -2, 0, 0);
    await waitBeat('crouch');

    // Crouch: real input through the duct.
    await shot('03-duct');
    await t('hold', 'slide', true);
    await t('hold', 'forward', true);
    await waitBeat('slide', 6000);
    await t('hold', 'slide', false);
    await t('hold', 'forward', false);
    if ((await beat()) !== 'slide') await cheat('duct: teleported past', () => t('tp', 0, 0, -14, 0, 0));

    // Slide: run at the slot and press the key once.
    await t('tp', 0, 0, -20, 0, 0);
    await h.sleep(300);
    await t('hold', 'forward', true);
    await h.sleep(380);
    await t('hold', 'slide', true);
    await h.sleep(350);
    await shot('04-slide');
    const slid = await waitBeat('dash', 4000);
    await t('hold', 'slide', false);
    await t('hold', 'forward', false);
    if (!slid) await cheat('slide: signalled', () => ev(() => window.__op2.campaign.runner.signal('ok:slide')));

    // Dash: from the top of the mantle wall, jump, double jump, dash.
    await t('tp', 0, 2.8, -42, 0, 0);
    await h.sleep(500);
    await shot('05-dash-gap');
    await t('hold', 'forward', true);
    await h.sleep(250);
    await press('jump');
    await h.sleep(380);
    await press('jump');
    await h.sleep(160);
    await press('dash');
    await h.sleep(200);
    await press('dash');
    const dashed = await waitBeat('wallrun', 3000);
    await t('hold', 'forward', false);
    if (!dashed) await cheat('dash gap: teleported across', () => t('tp', 0, 2.8, -65, 0, 0));
    await waitBeat('wallrun', 3000);

    // Wall run: a look at the pit, then across.
    await t('tp', 5, 2.8, -66, 0.12, 0);
    await h.sleep(500);
    await shot('06-wallrun-pit');
    await t('hold', 'forward', true);
    await t('hold', 'right', true);
    await h.sleep(150);
    await press('jump');
    await h.sleep(500);
    await shot('07-wallrun');
    await h.sleep(900);
    await press('jump');
    await h.sleep(300);
    await press('jump');
    await h.sleep(150);
    await press('dash');
    await h.sleep(250);
    await press('dash');
    const ran = await waitBeat('chimney', 3000);
    await t('hold', 'forward', false);
    await t('hold', 'right', false);
    if (!ran) await cheat('wall run: teleported across', () => t('tp', 0, 2.8, -97, 0, 0));
    await waitBeat('chimney', 3000);

    // Chimney.
    await t('tp', 0, 2.8, -97, 0, 0.5);
    await h.sleep(500);
    await shot('08-chimney');
    await cheat('chimney: teleported to the top', () => t('tp', 0, 14.8, -104.5, 0, -0.5));
    await waitBeat('slam');

    // Slam: off the edge, crouch in the air.
    await h.sleep(1200);
    await shot('09-slam-ring');
    await t('hold', 'forward', true);
    await h.sleep(450);
    await t('hold', 'forward', false);
    await h.sleep(200);
    await press('slide', 150);
    await h.sleep(900);
    await shot('10-slam-landed');
    if (!(await waitBeat('rocket', 5000))) await cheat('slam: signalled', () => ev(() => window.__op2.ctx.events.emit('player:slam', { impact: 30, position: window.__op2.ctx.player.position, radius: 10, big: true })));

    // Rocket jump: look down, jump, fire, jump again, hold forward.
    await t('tp', 0, 0, -121, 0, 0.1);
    await h.sleep(900);
    await shot('11-rocket-ledge');
    await t('tp', 0, 0, -124, 0, -1.45);
    await h.sleep(500);
    await press('jump', 60);
    await press('fire', 60);
    await h.sleep(420);
    await t('hold', 'forward', true);
    await press('jump', 80);
    await h.sleep(900);
    await t('hold', 'forward', false);
    if (!(await waitBeat('jet', 3000))) await cheat('rocket jump: teleported up', () => t('tp', 0, 7, -129, 0, 0));
    await waitBeat('jet');

    // Jump Jet: jump, then hold jump to burn, onto the tower.
    await t('tp', 1, 7, -129, Math.PI / 2, 0.15);
    await h.sleep(900);
    await shot('11b-jet-tower');
    await t('hold', 'forward', true);
    await press('jump', 80);
    await h.sleep(200);
    await t('hold', 'jump', true);
    await h.sleep(500);
    await shot('11c-jet-burn');
    await h.sleep(1100);
    await t('hold', 'jump', false);
    await h.sleep(600);
    await t('hold', 'forward', false);
    if (!(await waitBeat('lane', 3000))) await cheat('jet: teleported up', () => t('tp', -5.8, 14, -129, 0, 0));
    await waitBeat('lane');

    // The Gallery: hollow points on a shirt.
    await t('tp', 0, 7, -135, 0, -0.1);
    await h.sleep(1200);
    await shot('12-gallery');
    await t('tp', 0, 0, -152, 0, 0);
    await t('god');
    await h.sleep(1000);
    await press('weapon1');
    await h.sleep(700);
    let lane = (await t('men'))[0];
    if (lane) await shootAt(lane, false, 900);
    await h.sleep(300);
    await shot('13-lane-hp');
    if (!(await waitBeat('armour', 3000))) await cheat('lane subject: killed', () => killAll());
    await waitBeat('armour');

    // The armoured man: hollow points stop on his plate.
    await h.sleep(1600);
    const armoured = (await t('men'))[0];
    out.notes.push(`armoured man plates ${armoured?.plates}`);
    if (armoured) await shootAt(armoured, false, 700);
    await shot('14-armour-hp-stopped');
    if (!(await waitBeat('shop', 3000))) await cheat('armour: signalled stopped', () => ev(() => window.__op2.campaign.runner.signal('stopped:armoured')));

    // The pod, the shop, AP.
    await h.sleep(7000);
    await t('look', 8, 1, -162);
    await shot('15-supply-pod');
    await t('tp', 7, 0, -159, 0, 0);
    await h.sleep(500);
    await t('open');
    await h.sleep(900);
    await shot('16-shop');
    out.notes.push(`buy smgAp: ${await t('buy', 'smgAp')}, credits ${await t('credits')}`);
    await page.keyboard.press('Escape');
    await h.sleep(600);
    await ev(() => window.__op2.game.setState('playing'));
    await waitBeat('ap', 4000);
    await t('tp', 0, 0, -152, 0, 0);
    await h.sleep(400);
    const again = (await t('men'))[0];
    if (again) await shootAt(again, false, 1400);
    await h.sleep(400);
    await shot('17-ap-kill');
    if (!(await waitBeat('grenade', 3000))) await cheat('armoured man: killed', () => killAll());
    await waitBeat('grenade');

    // Grenade into the trench.
    await h.sleep(1500);
    await t('tp', 0, 0, -178, 0, 0);
    await t('look', 0, 3.5, -186);
    await t('hold', 'grenade', true);
    await h.sleep(1100);
    await t('hold', 'grenade', false);
    await h.sleep(1900);
    await shot('18-grenade');
    if (!(await waitBeat('stim', 2500))) await cheat('trench: killed the rest', () => killAll());
    await waitBeat('stim');
    await h.sleep(600);
    await press('stim');
    await h.sleep(500);
    await shot('19-stim');
    await waitBeat('blade');

    // The Cutting Room: guns drained, the blade.
    await h.sleep(2500);
    await shot('20-blade-room');
    for (const m of await t('men')) {
      await t('tp', m.x, 0, m.z + 1.8, 0, 0);
      await t('look', m.x, 1.2, m.z);
      await h.sleep(150);
      for (let i = 0; i < 4; i++) { await press('melee'); await h.sleep(380); }
    }
    await shot('21-blade');
    if (!(await waitBeat('energy', 2500))) await cheat('blade: killed the rest', () => killAll());
    await waitBeat('energy');
    await h.sleep(1200);
    await press('weapon5');
    await h.sleep(500);
    for (const m of await t('men')) {
      await t('tp', m.x, 0, m.z + 2.6, 0, 0);
      await t('look', m.x, 1.3, m.z);
      await h.sleep(200);
      await shot('21b-energy-blade');
      for (let i = 0; i < 3; i++) { await press('aim', 80); await h.sleep(450); }
    }
    await h.sleep(400);
    await shot('21c-energy-cut');
    if (!(await waitBeat('sonar', 2500))) await cheat('energy blade: killed the rest', () => killAll());
    await waitBeat('sonar');

    // The Quiet Room: lights out, sonar.
    await t('tp', 0, 0, -230, 0, 0);
    await h.sleep(1800);
    await shot('22-dark');
    await press('sonar');
    await h.sleep(900);
    await shot('23-sonar');
    for (const m of await t('men')) {
      await t('tp', m.x, 0, m.z + 3.5, 0, 0);
      await h.sleep(120);
      await shootAt(m, true, 400);
    }
    if (!(await waitBeat('kata', 2500))) await cheat('hidden: killed the rest', () => killAll());
    await waitBeat('kata');

    // The Ring: akimbo, hold T for Gun Kata.
    await t('tp', 0, 0, -258, 0, 0);
    await h.sleep(1600);
    await shot('24-ring');
    await t('hold', 'sonar', true);
    await h.sleep(900);
    await shot('25-kata-charging');
    await h.sleep(700);
    await t('hold', 'sonar', false);
    await h.sleep(1600);
    await shot('26-kata');
    if (!(await waitBeat('surrender', 3000))) await cheat('kata: event', () => ev(() => window.__op2.ctx.events.emit('chip:kata', {})));
    await waitBeat('surrender');
  }

  // The Yard.
  await t('godOn');
  await t('tp', 0, 0, -276, 0, 0);
  await h.sleep(3500);
  await shot('27-yard');
  const yardMen = async () => (await t('soldiers')).filter(s => !s.dummy && s.x < 10);
  for (let i = 0; i < 2; i++) {
    const a = (await yardMen()).filter(s => s.fighting);
    if (a.length > 1) await cheat('yard: killed one of squad A', () => t('kill', a[0].uid));
    await h.sleep(800);
  }
  let kneeling = null;
  for (let i = 0; i < 80 && !kneeling; i++) {
    await t('god');
    kneeling = (await t('soldiers')).find(s => s.surrendered);
    await h.sleep(250);
  }
  await waitBeat('question', 4000);
  if (kneeling) {
    await t('tp', kneeling.x, 0, kneeling.z + 2.2, 0, 0);
    await t('look', kneeling.x, 0.8, kneeling.z);
    await h.sleep(400);
    await shot('28-surrendered');
    await press('interact', 90);
    await h.sleep(900);
    await shot('29-questioned-reveal');
    await waitBeat('release', 3000);
    await h.sleep(1500);
    await press('interact', 90);
    await h.sleep(1200);
    await shot('30-released');
  } else out.notes.push('nobody surrendered in squad A');
  if (!(await waitBeat('capture', 4000))) await cheat('release: signalled', () => ev(() => window.__op2.campaign.runner.signal('released')));

  await h.sleep(1500);
  const b = (await t('soldiers')).filter(s => !s.dummy && s.fighting);
  out.notes.push(`shed squad before the fight: ${JSON.stringify(b)}`);
  if (b.length > 1) await cheat('shed: killed one of squad B', () => t('kill', b[0].uid));
  let prisoner = null;
  for (let i = 0; i < 80 && !prisoner; i++) {
    await t('god');
    prisoner = (await t('soldiers')).find(s => s.surrendered);
    await h.sleep(250);
  }
  if (prisoner) {
    await t('tp', prisoner.x - 2.2, 0, prisoner.z, -Math.PI / 2, 0);
    await t('look', prisoner.x, 0.8, prisoner.z);
    await h.sleep(300);
    await t('hold', 'interact', true);
    await h.sleep(650);
    await t('hold', 'interact', false);
    await t('tp', prisoner.x - 9, 0, prisoner.z + 4, 0, 0);
    await t('look', prisoner.x, 4, prisoner.z);
    await h.sleep(900);
    await shot('31-cuffed');
    await h.sleep(900);
    await shot('32-skyhook');
    await h.sleep(1100);
    await shot('33-skyhook-lift');
  } else out.notes.push('nobody surrendered in squad B');
  if (!(await waitBeat('balcony', 6000))) await cheat('capture: event', () => ev(() => window.__op2.ctx.events.emit('prisoner:secured', {})));
  await waitBeat('balcony');

  // The finale.
  await t('tp', 0, 6, -341, 0, -0.35);
  await waitBeat('nuke', 6000);
  await h.sleep(2500);
  await shot('34-balcony-town');
  await h.sleep(5000);
  await t('look', 0, 0, -372);
  await press('callinNuke', 120);
  await h.sleep(700);
  await shot('35-nuke-aim');
  await press('fire', 100);
  for (const [n, ms] of [['36-nuke-1', 1200], ['37-nuke-2', 1500], ['38-nuke-3', 2500], ['39-nuke-after', 4000]]) {
    await h.sleep(ms);
    await t('god');
    await shot(n);
  }
  if (!(await waitBeat('after', 4000))) out.notes.push('nuke not used');
  await h.sleep(14000);
  await shot('40-home');
  out.notes.push(`home at ${JSON.stringify(await t('pos'))}`);
  await t('tp', 0, 0, 13, Math.PI, 0);
  await t('hold', 'forward', true);
  await h.sleep(1500);
  await shot('41-leaving');
  await t('hold', 'forward', false);
  await h.sleep(5500);
  await shot('42-menu');
  out.notes.push(`state ${await t('state2')}, seen ${await ev(() => localStorage.getItem('op2.retraining.v1'))}`);
  return out;
}
