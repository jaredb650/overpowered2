// Co-op gore proof: the same shots fired by the host and by a guest, with a third page watching both, and what each screen
// made of them compared (docs/notes/coop.md, "Gore on every screen").
//
//   OP2_NO_HMR=1 npx vite --port <port> --strictPort
//   node tools/shot.mjs --port <port> --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-gore-shots.mjs --out tools/out/coop/gore/shots.png
//   COOP_SIM=lag:120,jitter:40,loss:0.05   the same under a bad network (the tag in the file names changes)
//   COOP_CASES=pistol,limb                 only these cases
//
// Each case puts one still enemy in front of the shooter, fires, waits, and reads from every page what its own gore, effects,
// sound and HUD were asked to do since the shot (a recorder wrapped round ctx.gore, ctx.fx, ctx.audio and ctx.hud). Checks:
//   - a guest's own hit is drawn on the frame its gun fires: the first wound and the first blood puff carry the shot's frame;
//   - the host answers it, and how long that took (the guest's own clock);
//   - every screen wounds the body as many times and as deeply (the summed severity agrees), throws a puff a round, cuts the
//     same limbs off the living body (what a later pellet does to the corpse is each screen's own), leaves the body in the same state (alive, what is left of it, crawling or not) and, when it dies, kills it
//     the same kind of way; ragdolls, gibs and corpses are each screen's own;
//   - the shooter gets the same feedback as host and as guest: the same hit markers and the same shooter's sounds, and nobody
//     else gets any.
// Evidence JSON and two screenshots a kept case go beside --out.
import { writeFileSync } from 'node:fs';
import { ahead, aimAt, calm, dummy, give, inMatch, kit, startParty, teleport } from './coop-kit.mjs';

const SIM = process.env.COOP_SIM || '';
const TAG = `gore-shots-${SIM ? 'badnet' : 'clean'}`;
const ONLY = (process.env.COOP_CASES ?? '').split(',').filter(Boolean);

/**
 * `gun` in hand, `range` metres from a `kind`, aimed at `aim` (a gore region, or the chest), the trigger held `hold` ms and
 * the screens read `settle` ms later. `health`: the body's, so that it lives (or does not). `pools`: every limb pool is set
 * to this, so a limb comes off (small) or stays on (huge) by the case's choice and not by the dice.
 */
const CASES = {
  pistol: { gun: 'rivet', kind: 'trooper', range: 7, hold: 60, settle: 900, health: 4000, pools: 1e6, bullets: true },
  rifle: { gun: 'harrow', kind: 'trooper', range: 7, hold: 60, settle: 900, health: 4000, pools: 1e6, bullets: true },
  shotgunPointBlank: { gun: 'shotgun', kind: 'trooper', range: 2.2, hold: 60, settle: 1500, bullets: true, dies: true },
  explosive: { gun: 'rocket', kind: 'husk', range: 11, hold: 60, settle: 2200, dies: true },
  sword: { gun: 'sword', kind: 'husk', range: 1.9, hold: 120, settle: 1800, dies: true },
  limb: { gun: 'shotgun', kind: 'trooper', range: 3, aim: 'legL', hold: 60, settle: 1600, health: 6000, pools: 1, bullets: true, severs: true },
  headshotKill: { gun: 'harrow', kind: 'husk', range: 8, aim: 'head', hold: 60, settle: 1500, health: 30, bullets: true, dies: true, head: true },
};

/** Runs in each page: counts what the game asks of gore, effects, sound and the HUD, with the frame it asked on. */
function record() {
  const { ctx } = window.__op2;
  const log = [];
  const uids = new WeakMap();
  const uidOf = char => {
    for (const e of ctx.enemies.alive) uids.set(e.char, e.uid);
    return uids.get(char) ?? -1;
  };
  const note = (k, more) => log.push({ k, f: ctx.time.frame, t: performance.now(), ...more });
  const wrap = (object, name, say) => {
    const real = object[name];
    if (typeof real !== 'function') return;
    object[name] = function (...args) {
      const before = say.before ? say.before(...args) : undefined;
      const result = real.apply(this, args);
      say.after?.(result, before, ...args);
      return result;
    };
  };
  const gore = ctx.gore;
  wrap(gore, 'wound', { before: (char, d, severity) => note('wound', { uid: uidOf(char), severity, type: d.type, from: d.from ? 1 : 0 }) });
  // A cut on the living (or on the way into its death) is the host's decision and every screen's; one a later pellet makes on
  // the corpse, once gore has the body, is that screen's own gore (corpses are each machine's own): counted apart.
  wrap(gore, 'sever', { before: char => [uidOf(char), !gore.owns(char) || !!gore.downed(char)], after: (cut, [uid, living], _char, region) => { if (cut) note(living ? 'sever' : 'corpseCut', { uid, region }); } });
  wrap(gore, 'knockdown', { before: char => [uidOf(char), !!gore.downed(char)], after: (ok, [uid, was]) => { if (ok && !was) note('knockdown', { uid }); } });
  for (const death of ['ragdoll', 'collapse', 'headshot', 'gib', 'slice', 'vaporize']) wrap(gore, death, { before: char => note('death', { uid: uidOf(char), how: death }) });
  for (const fx of ['bloodPuff', 'bloodHit', 'bloodSpray', 'bloodMist']) wrap(ctx.fx, fx, { before: () => note(fx) });
  wrap(ctx.fx, 'impact', { before: (_p, _n, surface) => { if (surface === 'armor') note('armourSparks'); } });
  const HEARD = /^(bullet_body|machine_hit|impact_armor|ricochet|limb_sever|limb_rip|headshot|headshot_crack|headshot_puff|hit_marker|hit_marker_head|hit_marker_kill|hit_confirm|hit_punch|gib_squelch|vox_scream|armour_stopped|armour_through|armour_broken|plate_destroyed)$/;
  wrap(ctx.audio, 'play', { before: id => { if (HEARD.test(id)) note('sound', { id }); } });
  wrap(ctx.hud, 'hitMarker', { before: kind => note('marker', { kind }) });
  ctx.events.on('weapon:fired', () => note('fired'));
  ctx.events.on('enemy:hit', e => note('evt:hit', { uid: e.enemy.uid, killSoon: e.result.killSoon ? 1 : 0 }));
  ctx.events.on('enemy:killed', e => note('evt:killed', { uid: e.enemy.uid }));
  ctx.events.on('enemy:severed', e => note('evt:severed', { uid: e.enemy.uid, region: e.region }));
  // The answers as they arrive, and whether the hit they answer was still waiting for one (a guest only).
  const hits = ctx.coop.world.hits;
  if (!ctx.coop.hosting && hits) {
    const ackIn = hits.ackIn, predict = hits.predict;
    hits.ackIn = function (value, now) { const slot = this.pending[value.c % 256]; note('ack', { c: value.c, waiting: slot.live && slot.claim === value.c ? 1 : 0 }); return ackIn.call(this, value, now); };
    hits.predict = function (enemy, damage) { note('predict', { c: damage.claim, uid: enemy.uid }); return predict.call(this, enemy, damage); };
  }
  window.__goreLog = { log, mark: 0, world: ctx.coop.world };
}

const mark = page => page.evaluate(() => { window.__goreLog.mark = window.__goreLog.log.length; const seen = window.__op2.ctx.coop.world.hitsSeen; window.__goreSeen = { ...seen }; });

/** What this page was asked to do since the mark, about `uid` or about nobody in particular, and how that body stands now. */
const read = (page, uid) => page.evaluate(uid => {
  const { ctx } = window.__op2;
  const all = window.__goreLog.log.slice(window.__goreLog.mark);
  const mine = all.filter(e => e.uid === undefined || e.uid === uid || e.uid === -1);
  const of = k => mine.filter(e => e.k === k);
  const enemy = ctx.enemies.alive.find(e => e.uid === uid);
  const seen = ctx.coop.world.hitsSeen, was = window.__goreSeen;
  const fired = of('fired')[0];
  const firstBlood = mine.find(e => e.k === 'wound' || e.k === 'bloodPuff' || e.k === 'armourSparks');
  return {
    host: ctx.coop.hosting,
    fired: of('fired').length, firedFrame: fired?.f ?? null, firstBloodFrame: firstBlood?.f ?? null,
    bloodDelayMs: fired && firstBlood ? Math.round(firstBlood.t - fired.t) : null,
    wounds: of('wound').length, severity: Math.round(of('wound').reduce((sum, e) => sum + e.severity, 0) * 1000) / 1000,
    shooterEye: of('wound').filter(e => e.from).length,
    puffs: of('bloodPuff').length, bloodHits: of('bloodHit').length, sprays: of('bloodSpray').length, mists: of('bloodMist').length, armourSparks: of('armourSparks').length,
    knockdowns: of('knockdown').length, severs: of('sever').map(e => e.region).sort(), corpseCuts: of('corpseCut').map(e => e.region).sort(), deaths: of('death').map(e => e.how),
    sounds: of('sound').map(e => e.id), markers: of('marker').map(e => e.kind),
    ownHits: of('evt:hit').length, ownKills: of('evt:killed').length, ownSevers: of('evt:severed').length, killSoon: of('evt:hit').filter(e => e.killSoon).length,
    alive: !!enemy, health: enemy ? Math.round(enemy.health) : 0, lost: enemy ? [...enemy.char.severed].sort() : null, maim: enemy ? { ...enemy.maim } : null, downed: enemy ? enemy.downed : null,
    answersHeard: of('ack').length, answersMatched: of('ack').filter(e => e.waiting).length, hitsNumbered: of('predict').map(e => e.c), sameWorld: window.__goreLog.world === ctx.coop.world,
    predicted: seen.predicted - was.predicted, shown: seen.shown - was.shown, acks: seen.acks - was.acks, corrected: seen.corrected - was.corrected, lateKills: seen.lateKills - was.lateKills,
    ackMs: seen.acks > was.acks ? Math.round((seen.ackMs - was.ackMs) / (seen.acks - was.acks)) : null, ackMsMax: Math.round(seen.ackMsMax),
  };
}, uid);

/** The shooter's gun on the enemy's `region` (its bone as drawn on this page), trigger held `hold` ms. */
async function shoot(page, uid, region, hold, sleep) {
  const aimed = await page.evaluate(([uid, region]) => {
    const { ctx, game } = window.__op2;
    const enemy = ctx.enemies.alive.find(e => e.uid === uid);
    if (!enemy) return false;
    const V = ctx.player.eye.constructor;
    let target = enemy.center.clone();
    if (region) {
      const index = enemy.char.rig.bones.findIndex(b => b.region === region);
      if (index >= 0) {
        enemy.char.root.updateMatrixWorld(true);
        target = new V().setFromMatrixPosition(enemy.char.bones[index].matrixWorld);
        // A bone's origin is its joint: a little down the thigh, the middle of the skull.
        if (region.startsWith('leg')) target.y -= 0.18;
        if (region === 'head') target.y += 0.08;
      }
    }
    const delta = target.sub(ctx.player.eye);
    ctx.player.yaw = Math.atan2(-delta.x, -delta.z); ctx.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
    game.setState('playing');
    ctx.weapons.refillMagazines();
    return true;
  }, [uid, region ?? null]);
  if (!aimed) return false;
  await sleep(120);
  // The trigger is held until the gun has fired (on a loaded machine it may still be coming up), then `hold` ms more.
  const before = await page.evaluate(() => { const n = window.__goreLog.log.filter(e => e.k === 'fired').length; window.__op2.ctx.input.simulate('fire', true); return n; });
  await page.waitForFunction(n => window.__goreLog.log.filter(e => e.k === 'fired').length > n, before, { timeout: 6000 }).catch(() => {});
  await sleep(hold);
  await page.evaluate(() => window.__op2.ctx.input.simulate('fire', false));
  return true;
}

const SHOOTER_ONLY = /^(headshot|headshot_crack|headshot_puff|hit_marker|hit_marker_head|hit_marker_kill|hit_confirm|armour_stopped|armour_through|armour_broken|plate_destroyed)$/;
const kinds = list => [...new Set(list)].sort().join(',');
/** A ragdoll and a collapse are the same death on screens that saw the body in different stances. */
const deathKind = deaths => kinds(deaths.map(how => (how === 'collapse' ? 'ragdoll' : how)));

export default async function (host, { sleep, outDir }) {
  const out = { errors: [], checks: [], screenshots: [], sim: SIM || 'clean', cases: {} };
  const { check, progress, shot } = kit(outDir, TAG, out, sleep);
  let party;
  try {
    party = await startParty(host, { mode: 'crucible', players: 3, net: SIM || undefined, out, progress, sleep });
    const [shooterGuest, watcher] = party.guests;
    await inMatch(party.pages, party.mode.contract);
    for (const page of party.pages) await page.evaluate(() => { const { ctx, game } = window.__op2; ctx.player.modifiers.invulnerable = true; game.setState('playing'); });
    // The host's wave director is stopped: every enemy from here on is one the proof put there.
    await host.evaluate(() => { const { ctx } = window.__op2; ctx.waves.update = () => {}; });
    await calm(host);
    // Every page well into its match before anything is measured: a page still coming up (the deploy gate, a slow load on
    // a bad network) starts its world late, and a recorder put on before that watches the wrong one.
    for (const page of party.pages) await page.waitForFunction(() => window.__op2.ctx.time.frame > 240 && !!window.__op2.ctx.coop?.world, null, { timeout: 120000 });
    for (const page of party.pages) await page.evaluate(record);
    const spot = await ahead(host, 14);
    const lagMs = SIM ? 500 : 0;

    const one = async (name, c, shooter, role) => {
      const uid = await dummy(host, spot.at, c.kind);
      await host.evaluate(([uid, c]) => {
        const enemy = window.__op2.ctx.enemies.alive.find(e => e.uid === uid);
        if (c.health) enemy.health = enemy.maxHealth = c.health;
        if (c.pools) for (const region of [...enemy.limbHp.keys()]) enemy.limbHp.set(region, region === 'head' ? 1e6 : c.pools);
        // It faces the players' spawn and stays where it was put.
        enemy.speedMul = 0;
      }, [uid, c]);
      for (const page of party.guests) await page.waitForFunction(uid => window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 20000 });
      // The shooter stands `range` short of it; the other two stand back and to the side, watching.
      const from = await ahead(host, 14 - c.range);
      const others = party.pages.filter(page => page !== shooter);
      await teleport(shooter, from.at, from.yaw);
      for (let i = 0; i < others.length; i++) {
        const back = await ahead(host, 14 - c.range - 4 - i * 1.5);
        await teleport(others[i], [back.at[0] + (i ? 2.5 : -2.5), back.at[1], back.at[2]], back.yaw);
      }
      await give(shooter, c.gun);
      // Long enough for the weapon to come up, the pose to reach the host and the replica to settle where the host has it.
      await sleep(900 + lagMs);
      // The watchers look at it too, so the screenshots show what they saw.
      for (const page of others) await aimAt(page, uid);
      for (const page of party.pages) await mark(page);
      const fired = await shoot(shooter, uid, c.aim, c.hold, sleep);
      await sleep(c.settle + lagMs * 2);
      // On a bad network a reliable message that was lost holds up every one behind it: wait for the host's answers (and
      // for every screen to have heard of the death) rather than trust a fixed pause.
      if (shooter !== host) await shooter.waitForFunction(uid => {
        const { ctx } = window.__op2, seen = ctx.coop.world.hitsSeen, was = window.__goreSeen;
        return seen.acks - was.acks >= seen.predicted - was.predicted || !ctx.enemies.alive.some(e => e.uid === uid);
      }, uid, { timeout: 8000 }).catch(() => {});
      if (c.dies) for (const page of party.guests) await page.waitForFunction(uid => !window.__op2.ctx.enemies.alive.some(e => e.uid === uid), uid, { timeout: 8000 }).catch(() => {});
      if (SIM) await sleep(600);
      const screens = {};
      screens.host = await read(host, uid); screens.guest = await read(shooterGuest, uid); screens.watcher = await read(watcher, uid);
      // What the host made of the claims so far (claims.ts), for a case that comes back unanswered.
      screens.host.claims = await host.evaluate(() => { const world = window.__op2.ctx.coop.world; return { accepted: world.stats.accepted, rejected: world.stats.rejected, refused: { ...world.claims.refused } }; });
      for (const [key, screen] of Object.entries(screens)) if (!screen.sameWorld) throw new Error(`${name}: the ${key}'s co-op world was rebuilt during the proof (a reconnect): its recorder watched the old one`);
      // A picture of two of the cases, for the eye. On a loaded machine a screenshot can time out: the checks do not need it.
      if (name === 'shotgunPointBlank' || name === 'limb') {
        for (const [page, who] of [[host, 'host'], [shooterGuest, 'guest']]) await shot(page, `${name}-${role}-shoots-${who}-screen`).catch(() => progress(`no screenshot of ${name} on the ${who}'s screen`));
      }
      await host.evaluate(uid => { const { ctx } = window.__op2; const enemy = ctx.enemies.alive.find(e => e.uid === uid); if (enemy) ctx.enemies.withdraw(enemy); }, uid);
      await sleep(900 + lagMs);
      return { fired, uid, screens };
    };

    for (const [name, c] of Object.entries(CASES)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      progress(`${name}: the host shoots`);
      const asHost = await one(name, c, host, 'host');
      progress(`${name}: the guest shoots`);
      const asGuest = await one(name, c, shooterGuest, 'guest');
      out.cases[name] = { asHost: asHost.screens, asGuest: asGuest.screens };
      const H = asHost.screens, G = asGuest.screens;
      const label = text => `${name}: ${text}`;
      check(asHost.fired && asGuest.fired && H.host.fired >= 1 && G.guest.fired >= 1, label('both shooters fired'), [H.host.fired, G.guest.fired]);

      // 1. The guest's own hit is drawn on the frame of the shot, before any answer could have come.
      if (c.bullets) {
        check(G.guest.predicted >= 1, label('the guest drew its own hit itself'), G.guest);
        check(G.guest.firstBloodFrame !== null && G.guest.firstBloodFrame === G.guest.firedFrame, label('the guest\'s first blood is on the frame its gun fired'), { fired: G.guest.firedFrame, blood: G.guest.firstBloodFrame, ms: G.guest.bloodDelayMs });
        check(H.host.firstBloodFrame === H.host.firedFrame, label('as the host\'s is'), { fired: H.host.firedFrame, blood: H.host.firstBloodFrame });
      } else check(G.guest.predicted >= 1, label('the guest drew its own hit itself'), G.guest);
      // 2. The host answered every hit it drew, with no picture sent back to the shooter.
      // (A body that died of the first pellets has no answer for the rest of the blast: on the host they met a corpse.)
      check(c.dies ? G.guest.acks <= G.guest.predicted : G.guest.acks === G.guest.predicted, label('the host answered each of the guest\'s hits on the living body'), { predicted: G.guest.predicted, acks: G.guest.acks });
      check(G.guest.shown === 0, label('the shooter was sent no picture of its own hits'), G.guest.shown);

      // 3. Every screen made the same of it, whoever fired.
      for (const [who, run, shooterKey] of [['host', H, 'host'], ['guest', G, 'guest']]) {
        const shooter = run[shooterKey];
        const rest = Object.entries(run).filter(([key]) => key !== shooterKey);
        for (const [key, screen] of rest) {
          const where = `${who} shoots, ${key}'s screen`;
          // The yardstick is the host's count: it decided the hits. A guest shooter drew every pellet of its blast, where
          // the host's enemy died of the first few and the rest met a corpse.
          const decided = run.host;
          if (key !== 'host' || !c.dies) {
            check(screen.wounds === decided.wounds, label(`${where}: as many wounds as the host decided`), { host: decided.wounds, here: screen.wounds });
            check(Math.abs(screen.severity - decided.severity) <= Math.max(0.02, decided.severity * 0.12), label(`${where}: as deep`), { host: decided.severity, here: screen.severity });
          }
          if (c.bullets) check(screen.puffs >= 1 && Math.abs(screen.puffs - shooter.puffs) <= 1, label(`${where}: the blood puffs`), { shooter: shooter.puffs, here: screen.puffs });
          check(kinds(screen.severs) === kinds(shooter.severs), label(`${where}: the same limbs cut`), { shooter: shooter.severs, here: screen.severs });
          check(screen.alive === shooter.alive, label(`${where}: alive or dead alike`), { shooter: shooter.alive, here: screen.alive });
          if (shooter.alive) check(JSON.stringify(screen.maim) === JSON.stringify(shooter.maim) && kinds(screen.lost) === kinds(shooter.lost), label(`${where}: what is left of the body`), { shooter: shooter.maim, here: screen.maim });
          else check(deathKind(screen.deaths) === deathKind(shooter.deaths), label(`${where}: the same kind of death`), { shooter: shooter.deaths, here: screen.deaths });
          // Nobody but the shooter is told of the hit. (The host's own event bus carries every hit, as the one that decides
          // them; what listens there skips a teammate's, which is why its markers and sounds are checked instead.)
          check(screen.markers.length === 0 && (screen.host || screen.ownHits === 0) && !screen.sounds.some(id => SHOOTER_ONLY.test(id)), label(`${where}: no hit marker, no hit sounds, no score events`), { markers: screen.markers, hits: screen.ownHits, sounds: screen.sounds.filter(id => SHOOTER_ONLY.test(id)) });
          if (c.bullets && !c.dies) check(screen.sounds.includes('bullet_body'), label(`${where}: the round is heard landing`), screen.sounds);
        }
      }
      // 4. The body ends the same whoever shot it.
      if (c.dies) check(!H.host.alive && !G.guest.alive && !G.host.alive, label('it dies for either shooter, on the host'), [H.host.alive, G.host.alive]);
      else check(H.host.alive && G.host.alive, label('it lives for either shooter'), [H.host.alive, G.host.alive]);
      if (c.severs) {
        check(H.host.severs.length >= 1 && G.host.severs.length >= 1, label('the limb comes off for either shooter'), [H.host.severs, G.host.severs]);
        check(G.guest.ownSevers >= 1 && G.guest.sounds.includes('limb_sever'), label('the guest\'s own cut is its own news: the event, the sound'), { events: G.guest.ownSevers, sounds: G.guest.sounds });
        check(G.guest.maim.legs < 2 && G.watcher.maim.legs < 2, label('a body short of a leg is short of it on every screen (updateMaim)'), [G.guest.maim, G.watcher.maim]);
      }
      // 5. The shooter is told the same things as host and as guest.
      check(kinds(G.guest.markers) === kinds(H.host.markers), label('the same hit markers for the guest as for the host'), { host: H.host.markers, guest: G.guest.markers });
      const told = screen => kinds(screen.sounds.filter(id => SHOOTER_ONLY.test(id)));
      check(told(G.guest) === told(H.host), label('the same shooter\'s sounds'), { host: told(H.host), guest: told(G.guest) });
      // (Fewer than it drew when the body died of the first: a round into a body already told dead is nobody's hit.)
      check(G.guest.ownHits >= 1 && (c.dies ? G.guest.ownHits <= G.guest.predicted : G.guest.ownHits === G.guest.predicted), label('the guest\'s hits are its own `enemy:hit`'), { hits: G.guest.ownHits, predicted: G.guest.predicted });
      if (c.dies) check(G.guest.ownKills === 1 && G.guest.markers.filter(kind => kind === 'kill').length === 1, label('the guest is told of its kill once'), { kills: G.guest.ownKills, markers: G.guest.markers });
      if (c.head) check(G.guest.sounds.includes('headshot') && !G.guest.sounds.includes('headshot_crack') && G.guest.killSoon >= 1, label('a killing headshot sounds like one at once, by the guest\'s own guess'), G.guest.sounds);
      out.cases[name].ackMs = G.guest.ackMs;
    }
    const answers = Object.values(out.cases).map(c => c.ackMs).filter(ms => ms !== null);
    out.ackMs = { mean: Math.round(answers.reduce((a, b) => a + b, 0) / Math.max(1, answers.length)), most: Math.max(0, ...answers) };
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/${TAG}-evidence.json`, JSON.stringify(out, null, 2));
    for (const guest of party?.guests ?? []) await guest.close().catch(() => {});
  }
}
