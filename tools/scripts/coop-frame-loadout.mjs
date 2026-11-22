// Co-op proof: another player sees the Frame you actually have (src/frame/loadout.ts). The host boards a Frame with a 40 mm on
// the left and a 105 mm on the right; the guest's copy wears the same arms, fires the 105 mm's shell when the host does, and goes
// back to the standard arms when the host boards a standard one.
//   node tools/shot.mjs --port 5281 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 400 --script tools/scripts/coop-frame-loadout.mjs --out tools/out/menu-update/coop-loadout.png
import { kit, live, startParty } from './coop-kit.mjs';

export default async function (host, { sleep, outDir }) {
  const out = { checks: [], errors: [], screenshots: [] };
  const { check, progress } = kit(outDir, 'frame-loadout', out, sleep);
  const party = await startParty(host, { mode: 'crucible', players: 2, out, progress, sleep });
  await live(party, { enemies: 1 });
  const guest = party.pages[1];
  const board = kitIds => host.evaluate(ids => {
    const { ctx } = window.__op2;
    const f = ctx.progression.frame;
    const P = ctx.player;
    const loadout = ids ? { leftArm: 'cannonL', rightArm: 'howitzerR', shoulders: ['pod6'], legs: 'legsStandard', cockpit: 'cockpitStandard', engine: 'engineStandard' } : undefined;
    f.board(P.position.clone(), P.yaw, Infinity, false, loadout);
    return { left: f.guns.left.kind, right: f.guns.right.kind };
  }, kitIds);
  const seen = () => guest.evaluate(() => {
    const m = window.__op2.ctx.progression.callinLink?.mirror ?? window.__op2.ctx.progression.callInsManager?.mirror;
    const p = m?.frameOf(0);
    return p ? { left: p.armOf('left'), right: p.armOf('right'), occupied: p.occupied } : null;
  });
  out.host = await board(true);
  await sleep(2000);
  out.guest = await seen();
  check(out.guest?.left === 'cannon40' && out.guest?.right === 'howitzer105', "the guest's copy wears the host's arms (40 mm left, 105 mm right)", out.guest);
  // RMB: the 105 mm fires on the host, and a shell flies and bursts on the guest's screen.
  const booms = await guest.evaluate(() => { window.__booms = 0; const fx = window.__op2.ctx.fx; const e = fx.explosion.bind(fx); fx.explosion = (...a) => { window.__booms++; return e(...a); }; return 0; });
  await host.evaluate(() => window.__op2.ctx.input.simulate('aim', true));
  await sleep(300);
  await host.evaluate(() => window.__op2.ctx.input.simulate('aim', false));
  await sleep(3000);
  out.guestBooms = await guest.evaluate(() => window.__booms);
  check(out.guestBooms > booms, "the host's 105 mm shell bursts on the guest's screen", out.guestBooms);
  await guest.screenshot({ path: `${outDir}/coop-loadout-guest.png` });
  // A standard Frame: the guest's copy goes back to the rotary and the 40 mm.
  out.host2 = await board(false);
  await sleep(2000);
  out.guest2 = await seen();
  check(out.guest2?.left === 'rotary' && out.guest2?.right === 'cannon40', "a standard Frame is drawn standard again", out.guest2);
  return out;
}
