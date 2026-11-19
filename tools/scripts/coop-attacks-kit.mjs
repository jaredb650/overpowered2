// Shared by the enemy-attack co-op proofs (coop-attacks-*.mjs): a recorder that notes, with the wall clock, everything a page
// shows of an enemy's attack, and the steps that stage one enemy doing one attack at one player.
//
// The wall clock (Date.now) is the same on every page of one machine, so a guest's times can be set against the host's.

/**
 * Runs in a page: from here on `window.__atk.ev` lists what the page drew, played and took, each with `at` (wall ms).
 *   snd / loop    a sound or a looping sound started (id)
 *   flash         a muzzle flash (kind)
 *   tracer        a tracer line (kind)
 *   glint, laser, laserSolid, zone, lane      the warnings (telegraph.ts)
 *   proj          a harmless copy of a host projectile began to fly (kind, id)
 *   projGone      the host said projectile `id` is gone
 *   hurt          the host's damage reached this player (amount, source, type); on the host, its own player's
 *   shove         an enemy threw this player
 *   boom          an explosion was drawn
 *   clip          an attack clip started on an enemy's body (uid, clip)
 */
export function record() {
  if (window.__atk) { window.__atk.ev.length = 0; return; }
  const { ctx } = window.__op2;
  const ev = [];
  window.__atk = { ev };
  const note = (k, d) => { ev.push({ at: Date.now(), k, ...d }); if (ev.length > 4000) ev.splice(0, 1000); };
  const wrap = (object, name, tell) => {
    const real = object[name];
    if (typeof real !== 'function') return;
    object[name] = function (...args) { try { tell(...args); } catch { /* the recorder never breaks the game */ } return real.apply(this, args); };
  };
  wrap(ctx.audio, 'play', id => note('snd', { id }));
  wrap(ctx.audio, 'startLoop', id => note('loop', { id }));
  wrap(ctx.fx, 'muzzleFlash', (_p, _d, kind) => note('flash', { kind }));
  wrap(ctx.fx, 'tracer', (_a, _b, kind) => note('tracer', { kind }));
  wrap(ctx.fx, 'explosion', () => note('boom', {}));
  const t = ctx.enemies.aiWorld.telegraphs;
  wrap(t, 'glint', () => note('glint', {}));
  wrap(t, 'acquireLaser', () => note('laser', {}));
  wrap(t, 'setLaserStrength', (_h, s) => { if (s > 1) note('laserSolid', {}); });
  wrap(t, 'zone', (p, r) => note('zone', { r, at3: [p.x, p.y, p.z] }));
  wrap(t, 'lane', () => note('lane', {}));
  wrap(ctx.combat, 'spawnCopy', (spec, id) => note('proj', { kind: spec.kind, id }));
  wrap(ctx.combat, 'dropProjectileCopy', id => note('projGone', { id }));
  const world = ctx.coop.world;
  const hosting = ctx.coop.hosting;
  wrap(ctx.player, 'takeDamage', d => { if (hosting || world.receivingDamage) note('hurt', { amount: d.amount, source: d.source, type: d.type }); });
  wrap(ctx.player, 'launch', v => note('shove', { v: [v.x, v.y, v.z] }));
  wrap(ctx.player, 'push', v => note('shove', { v: [v.x, v.y, v.z], push: true }));
  // Attack clips on enemy bodies: each animator's `play`, wrapped as bodies appear.
  const seen = new WeakSet();
  const CLIPS = new Set(['attackMelee', 'attackHeavy', 'shoot', 'throw', 'leap', 'roar']);
  window.__atk.watch = () => {
    for (const e of ctx.enemies.alive) {
      const anim = e.char.anim;
      if (seen.has(anim)) { anim.__uid = e.uid; continue; }
      seen.add(anim); anim.__uid = e.uid;
      wrap(anim, 'play', clip => { if (CLIPS.has(clip)) note('clip', { uid: anim.__uid, clip }); });
    }
  };
  setInterval(window.__atk.watch, 50);
}

/** A page's record since `since`, with its attack log (what the host sent, or what a guest played). */
export const readRecord = (page, since = 0) => page.evaluate(since => {
  const { ctx } = window.__op2;
  const world = ctx.coop.world;
  return {
    ev: window.__atk.ev.filter(e => e.at >= since),
    log: world.attacks.log.filter(e => e.at >= since),
    seen: { attacks: { ...world.attacks.seen }, fire: { ...world.enemyFire.seen }, warnings: { ...world.warnings.seen } },
    copies: (ctx.combat.projectiles?.active ?? []).filter(p => p.cosmetic).length,
    health: ctx.player.health,
  };
}, since);

/**
 * Host: one enemy of `kind` at `at`, standing still, that can only do the attack named `attack` (all of its attacks if
 * none is named). `setup` is the name of a tweak the attack needs (see below). Returns its uid.
 */
export const stage = (host, kind, at, attack, setup) => host.evaluate(([kind, at, attack, setup]) => {
  const { ctx } = window.__op2, V = ctx.player.position.constructor;
  const p = new V(...at); const snapped = p.clone();
  if (ctx.world.nav.nearest?.(p, 4, snapped)) p.copy(snapped);
  const e = ctx.enemies.spawn(kind, p);
  if (!e) return 0;
  // A drone has to keep flying to shoot; everything else is stood still.
  if (setup !== 'fly') { e.behaviours = []; e.mode = 'hold'; e.dummy = true; e.face = 'player'; }
  if (attack) e.attacks = e.attacks.filter(a => a.name === attack);
  // A leaper pounces from a wall: here it is simply held where it stands.
  if (setup === 'pinned') e.pinned = true;
  // The Juggernaut's rocket salvo is a late-phase attack.
  if (setup === 'phase2' && e.boss) e.boss.phase = 2;
  if (setup === 'legless') { e.maim.legs = 0; }
  // Long enough for every guest to have drawn him before he starts.
  e.attackReadyAt = ctx.time.elapsed + 0.9;
  return e.uid;
}, [kind, at, attack, setup]);

/** Host: takes an enemy out of the world without a kill. */
export const unstage = (host, uid) => host.evaluate(uid => {
  const { ctx } = window.__op2;
  const e = ctx.enemies.alive.find(e => e.uid === uid);
  if (e) ctx.enemies.withdraw(e);
}, uid);

/** Puts a player at a point on the floor near `at`, facing `yaw`, and keeps them alive. */
export const put = (page, at, yaw = 0) => page.evaluate(([at, yaw]) => {
  const { ctx } = window.__op2; const V = ctx.player.position.constructor;
  const p = new V(...at); const snapped = p.clone();
  if (ctx.world.nav.nearest?.(p, 6, snapped)) p.copy(snapped);
  ctx.player.teleport(p, yaw);
  ctx.player.modifiers.invulnerable = true;
  return p.toArray();
}, [at, yaw]);

/** The first time, in a record, of an event matching `test`; undefined if none. */
export const first = (events, test) => events.find(test)?.at;
