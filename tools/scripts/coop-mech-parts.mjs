// Co-op proof: bidirectional custom Distraint Frame mech parts (src/frame/loadout.ts, src/frame/puppet.ts).
//   1. Guest -> Host: Guest boards a custom mech (30 mm Rotary left, Red Beam right, FPV Hive + Metal Storm shoulders,
//      Spider Legs, Twin-Mount Cockpit, Jump-Jet Engine), climbs via Jump-Jet (Space held), and fires both arms.
//      Host's mirror.frameOf(1) reflects the custom arms, occupied state, elevated altitude, and remote weapon FX.
//   2. Host -> Guest: Host boards a custom mech (Mech Shotgun left, Bomblet Cannon right, Mortar Rack + MIRV + Point Defence
//      shoulders, Treads, Open Frame Cockpit, Diesel Engine) and fires both arms.
//      Guest's mirror.frameOf(0) reflects the custom arms, occupied state, and remote weapon FX.
//
// Run:
//   node tools/shot.mjs --port 5312 --dpr 2 --w 1440 --h 900 --timeout 400 \
//     --script tools/scripts/coop-mech-parts.mjs --out tools/out/mech-parts/coop-mech-parts/coop-mech-parts.png
import { kit, live, startParty } from './coop-kit.mjs';

const GUEST_LOADOUT = {
  leftArm: 'vulcan30L',
  rightArm: 'beamR',
  shoulders: ['fpvHive', 'stormPod'],
  legs: 'legsSpider',
  cockpit: 'cockpitTwin',
  engine: 'engineJet',
};

const HOST_LOADOUT = {
  leftArm: 'shotgunL',
  rightArm: 'clusterR',
  shoulders: ['mortarRack', 'mirv', 'pointDefence'],
  legs: 'legsTreads',
  cockpit: 'cockpitOpen',
  engine: 'engineDiesel',
};

/** Installs lightweight spies on a watcher's `ctx.fx` and `mirror.mechNews` to verify remote weapon FX arrival. */
const installWatcherSpy = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  const fx = ctx.fx;
  const mirror = ctx.progression.callinLink?.mirror ?? ctx.progression.callInsManager?.mirror;
  const stats = (window.__mechFxSpy = {
    muzzleFlash: 0,
    tracer: 0,
    beam: 0,
    explosion: 0,
    ring: 0,
    sparks: 0,
    news: {},
  });
  const wrap = (obj, method, fn) => {
    if (!obj || typeof obj[method] !== 'function' || obj[method].__mechSpied) return;
    const orig = obj[method].bind(obj);
    const wrapped = (...args) => { fn(...args); return orig(...args); };
    wrapped.__mechSpied = true;
    obj[method] = wrapped;
  };
  wrap(fx, 'muzzleFlash', () => { stats.muzzleFlash++; });
  wrap(fx, 'tracer', () => { stats.tracer++; });
  wrap(fx, 'beam', () => { stats.beam++; });
  wrap(fx, 'explosion', () => { stats.explosion++; });
  wrap(fx, 'ring', () => { stats.ring++; });
  wrap(fx, 'sparks', () => { stats.sparks++; });
  wrap(mirror, 'mechNews', (_slot, kind) => {
    stats.news[kind] = (stats.news[kind] ?? 0) + 1;
  });
  return true;
});

const resetWatcherSpy = page => page.evaluate(() => {
  const s = window.__mechFxSpy;
  if (!s) return null;
  s.muzzleFlash = 0;
  s.tracer = 0;
  s.beam = 0;
  s.explosion = 0;
  s.ring = 0;
  s.sparks = 0;
  s.news = {};
  return true;
});

const readWatcherSpy = page => page.evaluate(() => {
  const s = window.__mechFxSpy;
  return s ? { ...s, news: { ...s.news } } : null;
});

const readMirrorFrame = (page, slot) => page.evaluate(s => {
  const m = window.__op2.ctx.progression.callinLink?.mirror ?? window.__op2.ctx.progression.callInsManager?.mirror;
  const p = m?.frameOf(s);
  if (!p) return null;
  return {
    left: p.armOf('left'),
    right: p.armOf('right'),
    occupied: p.occupied,
    deployed: p.deployed,
    y: Math.round(p.position.y * 1000) / 1000,
    pos: [
      Math.round(p.position.x * 100) / 100,
      Math.round(p.position.y * 100) / 100,
      Math.round(p.position.z * 100) / 100,
    ],
  };
}, slot);

const lookAtSlotFrame = (watcher, slot, yOffset = 2.5) => watcher.evaluate(([s, dy]) => {
  const { ctx, game } = window.__op2;
  const m = ctx.progression.callinLink?.mirror ?? ctx.progression.callInsManager?.mirror;
  const p = m?.frameOf(s);
  if (!p) return false;
  const tx = p.position.x, ty = p.position.y + dy, tz = p.position.z;
  const dx = tx - ctx.player.eye.x, y = ty - ctx.player.eye.y, dz = tz - ctx.player.eye.z;
  ctx.player.yaw = Math.atan2(-dx, -dz);
  ctx.player.pitch = Math.atan2(y, Math.hypot(dx, dz));
  if (game.state !== 'playing') game.setState('playing');
  return true;
}, [slot, yOffset]);

export default async function (host, { sleep, outDir }) {
  const out = { checks: [], errors: [], consoleErrors: [], screenshots: [] };
  const { check, progress, shot } = kit(outDir, 'coop-mech-parts', out, sleep);
  const party = await startParty(host, { mode: 'crucible', players: 2, out, progress, sleep });
  await live(party, { enemies: 1 });
  const guest = party.pages[1];

  const watchConsoleErrors = (page, tag) => {
    page.on('console', msg => {
      if (msg.type() === 'error') out.consoleErrors.push(`${tag}: ${msg.text().slice(0, 300)}`);
    });
  };
  watchConsoleErrors(host, 'host');
  watchConsoleErrors(guest, 'guest');

  await installWatcherSpy(host);
  await installWatcherSpy(guest);

  // Place Host at spawn and Guest ~12-16 m away under open sky (raycast upward >= 30 m clear so Crucible's central
  // gantry does not cap Jump-Jet flight) with a clear line of sight between them.
  const spot = await host.evaluate(() => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    const s = ctx.world.playerSpawns[0];
    const fwd = new V(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const side = new V(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const up = new V(0, 1, 0);
    const candidates = [
      [2, 13], [2, -13], [6, 12], [6, -12], [-2, 13], [-2, -13], [14, 10], [14, -10], [8, 0],
    ];
    let best = null;
    for (const [f, r] of candidates) {
      const p = s.position.clone().addScaledVector(fwd, f).addScaledVector(side, r);
      const snapped = p.clone();
      if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
      const skyOrigin = p.clone().setY(p.y + 1.5);
      const ceiling = ctx.physics.raycast(skyOrigin, up, 35, 1);
      if (!ceiling) {
        best = p;
        break;
      }
    }
    const at = best ?? s.position.clone().addScaledVector(side, 12);
    const toGuestYaw = Math.atan2(-(at.x - s.position.x), -(at.z - s.position.z));
    return {
      spawn: s.position.toArray(),
      at: at.toArray(),
      yaw: s.yaw,
      hostYaw: toGuestYaw,
    };
  });

  await host.evaluate(([at, yaw]) => {
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    ctx.player.teleport(new V(...at), yaw);
    ctx.player.pitch = 0.05;
  }, [spot.spawn, spot.hostYaw]);

  // ---------------------------------------------------------------------------
  // Direction 1: Guest -> Host
  // ---------------------------------------------------------------------------
  progress('Part 1 (Guest -> Host): Guest boarding custom flight/beam/vulcan30 mech');
  out.guestBoard = await guest.evaluate(([at, yaw, loadout]) => {
    const { ctx, game } = window.__op2;
    const V = ctx.player.position.constructor;
    const pos = new V(...at);
    ctx.player.teleport(pos, yaw);
    const f = ctx.progression.frame;
    f.board(pos, yaw, Infinity, false, loadout);
    if (game.state !== 'playing') game.setState('playing');
    return {
      left: f.guns.left.kind,
      right: f.guns.right.kind,
      y: Math.round(f.walker.feet.y * 1000) / 1000,
    };
  }, [spot.at, spot.yaw, GUEST_LOADOUT]);

  await host.waitForFunction(() => {
    const m = window.__op2.ctx.progression.callinLink?.mirror ?? window.__op2.ctx.progression.callInsManager?.mirror;
    const p = m?.frameOf(1);
    return !!p && p.occupied && p.armOf('left') === 'vulcan30' && p.armOf('right') === 'beam';
  }, null, { timeout: 15000 }).catch(() => {});
  await sleep(400);

  out.hostMirrorInitial = await readMirrorFrame(host, 1);
  check(
    out.hostMirrorInitial?.left === 'vulcan30'
      && out.hostMirrorInitial?.right === 'beam'
      && out.hostMirrorInitial?.occupied === true,
    "Host's mirror.frameOf(1) shows Guest's custom arms (vulcan30 left, beam right) and occupied === true",
    out.hostMirrorInitial,
  );

  const baseY = out.hostMirrorInitial?.y ?? 0;

  // Guest holds Jump-Jet (Space / 'jump') to climb upward into free flight.
  progress('Part 1: Guest climbing with Jump-Jet (engineJet)');
  await guest.evaluate(() => {
    window.__op2.game.setState('playing');
    window.__op2.ctx.input.simulate('jump', true);
  });

  let peakHostY = baseY;
  let peakGuestY = out.guestBoard?.y ?? baseY;
  for (let i = 0; i < 10; i++) {
    await sleep(110);
    const hFrame = await readMirrorFrame(host, 1);
    const gY = await guest.evaluate(() => Math.round(window.__op2.ctx.progression.frame.walker.feet.y * 1000) / 1000);
    if (hFrame && hFrame.y > peakHostY) peakHostY = hFrame.y;
    if (gY > peakGuestY) peakGuestY = gY;
  }
  await lookAtSlotFrame(host, 1, 2.2);
  await shot(host, 'guest-flight');

  await guest.evaluate(() => window.__op2.ctx.input.simulate('jump', false));
  out.guestFlight = {
    baseY,
    peakHostY,
    riseHostY: Math.round((peakHostY - baseY) * 1000) / 1000,
    peakGuestY,
  };
  check(
    peakHostY - baseY >= 2.0,
    "Host's mirror.frameOf(1) shows Guest's Jump-Jet flight altitude rise",
    out.guestFlight,
  );

  // Wait briefly for Guest to settle, then aim Guest horizontally away from Host and fire Vulcan 30 mm (LMB).
  await sleep(1100);
  await guest.evaluate(yaw => {
    const { ctx, game } = window.__op2;
    const seat = ctx.progression.frame.seat;
    if (seat) { seat.yaw = yaw; seat.pitch = -0.05; }
    if (game.state !== 'playing') game.setState('playing');
  }, spot.yaw);
  await lookAtSlotFrame(host, 1, 2.4);

  progress('Part 1: Guest firing left arm (vulcan30)');
  await resetWatcherSpy(host);
  await guest.evaluate(() => window.__op2.ctx.input.simulate('fire', true));
  await sleep(950);
  await guest.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  await sleep(450);

  out.hostVulcanFx = await readWatcherSpy(host);
  check(
    (out.hostVulcanFx?.news?.vulcan30 ?? 0) > 0
      && (out.hostVulcanFx?.muzzleFlash ?? 0) > 0
      && (out.hostVulcanFx?.tracer ?? 0) > 0,
    "Host receives Guest's remote vulcan30 weapon FX (news, muzzle flashes, tracers)",
    out.hostVulcanFx,
  );

  // Guest charges Red Beam (RMB = 'aim' held >= 1.6 s) and releases to fire the 1.0 s beam.
  progress('Part 1: Guest charging and firing right arm (beam)');
  await resetWatcherSpy(host);
  await guest.evaluate(() => {
    window.__op2.game.setState('playing');
    window.__op2.ctx.input.simulate('aim', true);
  });
  await sleep(2000);
  await guest.evaluate(() => window.__op2.ctx.input.simulate('aim', false));
  await sleep(300);
  await lookAtSlotFrame(host, 1, 2.4);
  await shot(host, 'guest-beam');
  await sleep(500);

  out.hostBeamFx = await readWatcherSpy(host);
  check(
    (out.hostBeamFx?.news?.beam ?? 0) > 0 && (out.hostBeamFx?.beam ?? 0) > 0,
    "Host receives Guest's remote Red Beam weapon FX (beam news + beam render)",
    out.hostBeamFx,
  );

  // Guest exits its Frame so Guest has an unobstructed on-foot view of Host for Part 2.
  await guest.evaluate(() => {
    window.__op2.ctx.progression.frame.leave(true);
    window.__op2.game.setState('playing');
  });
  await sleep(400);

  // ---------------------------------------------------------------------------
  // Direction 2: Host -> Guest
  // ---------------------------------------------------------------------------
  progress('Part 2 (Host -> Guest): Host boarding custom treads/shotgun/cluster mech');
  out.hostBoard = await host.evaluate(([at, yaw, loadout]) => {
    const { ctx, game } = window.__op2;
    const V = ctx.player.position.constructor;
    const pos = new V(...at);
    ctx.player.teleport(pos, yaw);
    const f = ctx.progression.frame;
    f.board(pos, yaw, Infinity, false, loadout);
    if (game.state !== 'playing') game.setState('playing');
    return {
      left: f.guns.left.kind,
      right: f.guns.right.kind,
    };
  }, [spot.spawn, spot.yaw, HOST_LOADOUT]);

  await guest.waitForFunction(() => {
    const m = window.__op2.ctx.progression.callinLink?.mirror ?? window.__op2.ctx.progression.callInsManager?.mirror;
    const p = m?.frameOf(0);
    return !!p && p.occupied && p.armOf('left') === 'shotgun' && p.armOf('right') === 'cluster';
  }, null, { timeout: 15000 }).catch(() => {});
  await sleep(400);

  out.guestMirror = await readMirrorFrame(guest, 0);
  check(
    out.guestMirror?.left === 'shotgun'
      && out.guestMirror?.right === 'cluster'
      && out.guestMirror?.occupied === true,
    "Guest's mirror.frameOf(0) shows Host's custom arms (shotgun left, cluster right) and occupied === true",
    out.guestMirror,
  );

  await lookAtSlotFrame(guest, 0, 2.2);

  // Host fires Mech Shotgun (LMB = 'fire').
  progress('Part 2: Host firing left arm (shotgun)');
  await resetWatcherSpy(guest);
  await host.evaluate(yaw => {
    const { ctx, game } = window.__op2;
    const seat = ctx.progression.frame.seat;
    if (seat) { seat.yaw = yaw + 0.35; seat.pitch = -0.05; }
    if (game.state !== 'playing') game.setState('playing');
    ctx.input.simulate('fire', true);
  }, spot.yaw);
  await sleep(250);
  await host.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  await sleep(550);

  out.guestShotgunFx = await readWatcherSpy(guest);
  check(
    (out.guestShotgunFx?.news?.shotgun ?? 0) > 0
      && (out.guestShotgunFx?.muzzleFlash ?? 0) > 0
      && (out.guestShotgunFx?.tracer ?? 0) > 0,
    "Guest receives Host's remote Mech Shotgun weapon FX (news, muzzle flashes, tracers)",
    out.guestShotgunFx,
  );

  // Host fires Bomblet Cannon (RMB = 'aim').
  progress('Part 2: Host firing right arm (cluster)');
  await resetWatcherSpy(guest);
  await host.evaluate(yaw => {
    const { ctx, game } = window.__op2;
    const seat = ctx.progression.frame.seat;
    if (seat) { seat.yaw = yaw + 0.25; seat.pitch = -0.08; }
    if (game.state !== 'playing') game.setState('playing');
    ctx.input.simulate('aim', true);
  }, spot.yaw);
  await sleep(250);
  await host.evaluate(() => window.__op2.ctx.input.simulate('aim', false));
  await sleep(350);
  await lookAtSlotFrame(guest, 0, 2.2);
  await shot(guest, 'host-cluster');
  await sleep(1100);

  out.guestClusterFx = await readWatcherSpy(guest);
  check(
    (out.guestClusterFx?.news?.cluster ?? 0) > 0
      && (out.guestClusterFx?.ring ?? 0) > 0
      && (out.guestClusterFx?.explosion ?? 0) > 0,
    "Guest receives Host's remote Bomblet Cannon weapon FX (cluster news, airburst ring, bomblet explosions)",
    out.guestClusterFx,
  );

  check(
    out.errors.length === 0 && out.consoleErrors.length === 0,
    'Zero page errors and zero console errors on both Host and Guest',
    { errors: out.errors, consoleErrors: out.consoleErrors },
  );

  return out;
}
