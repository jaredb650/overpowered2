// Every viewmodel state the game can drive, in the real game: real map, real weapons system, waves off.
//
//   VM_STEPS=scope,lance node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk" \
//     --script tools/scripts/viewmodel-live.mjs --w 1920 --h 1080 --wait 1000 --out tools/out/vm/l.png
//
// Steps: scope, lance, buzzsaw, kiln, sword, grenade, callins, reloads, perks, align, cost.
// Screenshots: <out>-<step>-<n>.png. align reports how far muzzle() and ejectPort() land from the drawn gun, in pixels,
// standing, running and strafing through a flick. cost is the GPU time of the view scene, by render with and without it.
const steps = (process.env.VM_STEPS ?? 'scope,lance,buzzsaw,kiln,sword,grenade,callins,perks').split(',').filter(Boolean);
const at = JSON.parse(process.env.VM_AT ?? '{"x":66,"y":0,"z":-6,"yaw":0.6,"pitch":-0.05}');

export default async function live(page, h) {
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => !!window.__range)) break;
    await h.sleep(1000);
  }
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(s => {
    const { ctx } = window.__range;
    const P = ctx.player;
    P.modifiers.invulnerable = true;
    P.teleport(new P.position.constructor(s.x, s.y + 0.1, s.z));
    P.velocity.set(0, 0, 0);
    P.yaw = s.yaw;
    P.pitch = s.pitch;
    window.__in = (a, d) => ctx.input.simulate(a, d);
    window.__w = id => ctx.weapons.switchTo(id);
  }, at);
  await h.sleep(600);
  const down = a => ev(x => window.__in(x, true), a);
  const up = a => ev(x => window.__in(x, false), a);
  const tap = async (a, ms = 60) => { await down(a); await h.sleep(ms); await up(a); };
  const equip = async id => { await ev(w => window.__w(w), id); await h.sleep(500); };
  const log = {};

  const STEPS = {
    async scope() {
      await equip('autocannon');
      await h.shot('scope-0');
      await tap('aim');
      await h.sleep(30);
      await h.shot('scope-1');
      await h.sleep(250);
      await h.shot('scope-2');
      log.scoped = await ev(() => { const { ctx } = window.__range; return { scoped: ctx.weapons.scoped, shown: ctx.viewmodel.currentDef.model.root.parent.visible }; });
      await tap('aim');
      await h.sleep(400);
      await h.shot('scope-3');
    },
    async lance() {
      await equip('lance');
      await down('fire');
      await h.sleep(450);
      await h.shot('lance-0');
      await h.sleep(900);
      await h.shot('lance-1');
      await up('fire');
      await h.sleep(40);
      await h.shot('lance-2');
      await h.sleep(250);
      await h.shot('lance-3');
    },
    async buzzsaw() {
      await equip('buzzsaw');
      await down('fire');
      await h.sleep(1100);
      await h.shot('buzzsaw-0');
      await h.sleep(1200);
      await h.shot('buzzsaw-1');
      await up('fire');
      await h.sleep(300);
      await h.shot('buzzsaw-2');
    },
    async kiln() {
      await equip('kiln');
      await h.shot('kiln-0');
      await down('fire');
      await h.sleep(700);
      await h.shot('kiln-1');
      await up('fire');
    },
    async sword() {
      await equip('sword');
      await tap('fire', 40);
      await h.sleep(30);
      await h.shot('sword-0');
      await h.sleep(260);
      await tap('fire', 40);
      await h.shot('sword-1');
      await h.sleep(300);
      await tap('fire', 40);
      await h.shot('sword-2');
      await h.sleep(700);
      await down('aim');
      await h.sleep(420);
      await h.shot('sword-3');
      await up('aim');
      await h.sleep(90);
      await h.shot('sword-4');
      await h.sleep(800);
      // Chain two lights into the finisher.
      await tap('fire', 40);
      await h.sleep(280);
      await tap('fire', 40);
      await h.sleep(140);
      await tap('aim', 200);
      await h.sleep(60);
      await h.shot('sword-5');
      await h.sleep(900);
    },
    async grenade() {
      await equip('smg');
      await down('grenade');
      await h.sleep(420);
      await h.shot('grenade-0');
      await up('grenade');
      await h.sleep(40);
      await h.shot('grenade-1');
      await h.sleep(600);
      await h.shot('grenade-2');
    },
    async callins() {
      await equip('smg');
      await ev(() => window.__range.ctx.progression.grantCallIn?.('airstrike'));
      await tap('streak');
      await h.sleep(520);
      await h.shot('callins-walkie');
      log.targeting = await ev(() => window.__range.ctx.progression.targeting);
      await tap('aim');
      await h.sleep(800);
      await h.shot('callins-back');
      await ev(() => window.__range.ctx.progression.grantCallIn?.('orbital'));
      await tap('callinOrbital');
      await h.sleep(520);
      await h.shot('callins-designator');
      log.targeting2 = await ev(() => window.__range.ctx.progression.targeting);
      await tap('aim');
      await h.sleep(600);
    },
    async reloads() {
      for (const [id, s] of [['shotgun', 1.25], ['judge', 1.5], ['smg', 1.0]]) {
        await equip(id);
        await ev(w => { window.__range.ctx.weapons.ammo(w).mag = 1; }, id);
        await tap('reload');
        await h.sleep(s * 400);
        await h.shot(`reloads-${id}`);
        await h.sleep(s * 800);
      }
    },
    async align() {
      await ev(() => {
        const { ctx } = window.__range;
        const V = ctx.player.eye.constructor;
        const r = ctx.render;
        const m = new V();
        const e = new V();
        const q = new V();
        const S = { muzzle: [], eject: [] };
        window.__al = S;
        let fresh = false;
        const update = ctx.weapons.update.bind(ctx.weapons);
        ctx.weapons.update = () => {
          update();
          ctx.viewmodel.muzzle(m);
          ctx.viewmodel.ejectPort(e);
          fresh = true;
        };
        const px = (p, cam) => {
          q.copy(p).project(cam);
          return [(q.x * 0.5 + 0.5) * innerWidth, (0.5 - q.y * 0.5) * innerHeight];
        };
        const gap = (world, name) => {
          const sock = ctx.viewmodel.a.model.sockets[name];
          if (!sock) return null;
          const a = px(world, r.camera);
          const b = px(new V().setFromMatrixPosition(sock.matrixWorld), r.viewCamera);
          return Math.hypot(a[0] - b[0], a[1] - b[1]);
        };
        const check = () => {
          requestAnimationFrame(check);
          if (!fresh) return;
          fresh = false;
          const a = gap(m, 'muzzle');
          const b = gap(e, 'eject');
          if (a !== null) S.muzzle.push(a);
          if (b !== null) S.eject.push(b);
        };
        requestAnimationFrame(check);
      });
      const take = () => ev(() => {
        const S = window.__al;
        const st = a => {
          const s = [...a].sort((x, y) => x - y);
          return [Number((s[Math.floor(s.length / 2)] ?? 0).toFixed(1)), Number((s[s.length - 1] ?? 0).toFixed(1))];
        };
        const out = { n: S.muzzle.length, speed: Number(window.__range.ctx.player.speed.toFixed(1)), muzzle: st(S.muzzle), eject: st(S.eject) };
        S.muzzle.length = S.eject.length = 0;
        return out;
      });
      log.align = {};
      for (const id of (process.env.VM_IDS ?? 'smg,shotgun,rocket,autocannon,judge,lance,buzzsaw,kiln,stakegun').split(',')) {
        await equip(id);
        await take();
        const row = {};
        await h.sleep(350);
        row.still = await take();
        await down('forward');
        await h.sleep(600);
        await take();
        await h.sleep(450);
        row.run = await take();
        await up('forward');
        await down('left');
        if (!process.env.VM_NOFIRE) await down('fire');
        await ev(() => {
          const { ctx } = window.__range;
          window.__flick = setInterval(() => ctx.input.simulateLook(Math.sin(ctx.time.realElapsed * 9) * 70, 0), 16);
        });
        await h.sleep(600);
        row.flick = await take();
        await ev(() => clearInterval(window.__flick));
        await up('fire');
        await up('left');
        log.align[id] = row;
        await ev(s => {
          const P = window.__range.ctx.player;
          P.teleport(new P.position.constructor(s.x, s.y + 0.1, s.z));
          P.velocity.set(0, 0, 0);
          P.yaw = s.yaw;
          P.pitch = s.pitch;
        }, at);
      }
    },
    async cost() {
      log.cost = {};
      for (const id of ['smg', 'lance', 'autocannon', 'sword']) {
        await equip(id);
        log.cost[id] = await ev(() => {
          const { ctx } = window.__range;
          const r = ctx.render;
          const gl = r.renderer.getContext();
          const px = new Uint8Array(4);
          const time = n => {
            const t0 = performance.now();
            for (let i = 0; i < n; i++) {
              r.render();
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            }
            return (performance.now() - t0) / n;
          };
          const root = ctx.viewmodel.root;
          time(4);
          const on = [];
          const off = [];
          for (let k = 0; k < 4; k++) {
            root.visible = true;
            on.push(time(8));
            root.visible = false;
            off.push(time(8));
          }
          root.visible = true;
          const min = a => Math.min(...a);
          return { on: Number(min(on).toFixed(2)), off: Number(min(off).toFixed(2)), view: Number((min(on) - min(off)).toFixed(2)) };
        });
      }
    },
    async perks() {
      await equip('smg');
      const P = id => ev(p => window.__range.ctx.progression.grant(p), id);
      await P('hellfire');
      await P('slowmo');
      await h.sleep(900);
      await h.shot('perks-hellfire');
      await down('fire');
      await h.sleep(300);
      await h.shot('perks-hellfire-fire');
      await up('fire');
      await h.sleep(6500);
      await P('berserk');
      await h.sleep(700);
      await h.shot('perks-berserk');
      await down('fire');
      await h.sleep(300);
      await h.shot('perks-akimbo-fire');
      await up('fire');
      log.akimbo = await ev(() => { const v = window.__range.ctx.viewmodel; return { w: v.akimboW, rage: v.rage }; });
      await h.sleep(10500);
      await P('frostNova');
      await h.sleep(800);
      await h.shot('perks-frost');
    },
  };
  for (const s of steps) {
    try {
      await STEPS[s]();
    } catch (e) {
      log[`error-${s}`] = String(e);
    }
  }
  return log;
}
