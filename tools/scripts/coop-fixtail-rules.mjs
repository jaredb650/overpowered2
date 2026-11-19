// Co-op proof: a guest's page and the host's agree on the rules of the run.
//
// The world is the host's, so the run's rules are the host's on every screen: the Crucible's custom rules, the wave an enemy
// is scaled for, how many are left, what the shop has released, and what each man wears. A guest's own saved rules never apply.
//
// The Crucible (default). The host's saved rules are custom (enemy health 200 %, enemy damage 150 %, helmets from wave 1,
// Gunners from wave 1); the guest's own saved rules are different again (health 50 %, damage 400 %, no helmets, start on wave
// 7, waves three times the size). On wave 1 and again on wave 21 the same enemies are stood in front of both, and every
// number is read on both pages: each enemy's health, what it hits for, its limb pools, its plates and armour; the rules in
// play; the wave; the count of enemies left (with a queue on the host); what the shop has released; the unranked tag. Then a
// third player joins on wave 21 and reads the same.
//
// RULES_PART=humans: Endless Humans. The Commander fields heavy helmets, one man is made the sonar jammer (a whip antenna),
// and every man's gear, helmet plate, armour, health and rank are read on both pages.
//
//   OP2_NO_HMR=1 npx vite --port 5520 --strictPort
//   node tools/shot.mjs --port 5520 --dpr 2 --w 1440 --h 900 --wait 500 --timeout 600 \
//     --script tools/scripts/coop-fixtail-rules.mjs --out tools/out/coop/fix-tail/rules.png
//
//   COOP_SIM=lag:120,jitter:40,loss:0.05   the game's network simulator on every page
//   RULES_TAG=clean                        names the evidence file and the pictures
import { writeFileSync } from 'node:fs';
import { button, calm, inMatch, kit, lateGuest, live, spawn, startParty } from './coop-kit.mjs';

const PART = process.env.RULES_PART ?? 'crucible';
const SIM = process.env.COOP_SIM ?? '';
const TAG = process.env.RULES_TAG ?? `${PART}-${SIM ? 'lag' : 'clean'}`;
const KEY = 'op2.crucible.rules.v1';
/** What the host has saved: every one of these shows on a guest's screen. */
const HOSTS = { healthPct: 200, damagePct: 150, helmetsFrom: 1, types: { gunner: { from: 1 } } };
/** What the guest has saved for its own runs: none of it may show in the host's run. */
const GUESTS = { healthPct: 50, damagePct: 400, helmetsFrom: 0, startWave: 7, sizePct: 300 };

/** This page alone reads `rules` as its saved Crucible rules (the pages of a loopback proof share one profile's storage). */
const savedRules = (page, rules) => page.addInitScript(([key, text]) => {
  const get = Storage.prototype.getItem;
  Storage.prototype.getItem = function (k) { return k === key && this === window.localStorage ? text : get.call(this, k); };
}, [KEY, JSON.stringify(rules)]);

/** Every number a page has that depends on the rules of the run. */
const read = page => page.evaluate(() => {
  const { ctx } = window.__op2;
  const m = ctx.enemies, waves = ctx.waves, r2 = n => Math.round(n * 100) / 100;
  const commander = m.outpost?.commander;
  const foes = {};
  for (const e of m.alive) {
    const s = m.outpost?.soldiers.find(soldier => soldier.e === e);
    foes[e.uid] = { id: e.id, max: r2(e.maxHealth), health: r2(e.health), hits: Math.round(e.damageMul * 1000) / 1000, armor: r2(e.armor),
      plates: e.plates.map(p => r2(p.hp)), shown: e.plates.filter(p => p.mesh.visible).length,
      limbs: Object.fromEntries([...e.limbHp].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, r2(v)])),
      ...(s ? { rank: s.rank, gear: commander.gearOf(s) } : {}) };
  }
  const rules = waves.rules;
  return {
    wave: waves.wave, level: m.level, tuning: { ...m.tuning },
    rules: rules ? { healthPct: rules.healthPct, damagePct: rules.damagePct, helmetsFrom: rules.helmetsFrom, startWave: rules.startWave, sizePct: rules.sizePct, gunnerFrom: rules.types.gunner.from } : null,
    left: m.remaining, hud: { wave: ctx.hud.state.wave, left: ctx.hud.state.remaining, unranked: ctx.hud.state.customRules },
    cleared: window.__shop ? window.__shop.view().cleared : null,
    locked: window.__shop ? [...window.__shop.weaponOffers(), ...window.__shop.modOffers(), ...window.__shop.implantOffers(), ...window.__shop.chipOffers()].filter(o => o.locked).length : null,
    line: ctx.coop.world.team.customRules, foes,
  };
});

/** `a` and `b` as text, for an exact comparison of numbers already rounded. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default async function (host, { sleep, outDir }) {
  const out = { tag: TAG, part: PART, sim: SIM || 'off', transport: process.env.COOP_NET ?? 'loop', errors: [], checks: [], screenshots: [], reads: {} };
  const { check: hard, progress } = kit(outDir, `rules-${TAG}`, out, sleep);
  out.failed = [];
  const check = (condition, message, detail) => {
    if (condition) out.checks.push(message);
    else { out.failed.push({ message, detail }); progress(`FAILED: ${message} :: ${JSON.stringify(detail)?.slice(0, 500)}`); }
  };
  let party;
  try {
    party = await startParty(host, { mode: PART === 'humans' ? 'outpost' : 'crucible', players: 2, startNow: false, net: SIM || undefined, out, progress, sleep });
    const guest = party.guests[0];
    if (PART !== 'humans') { await savedRules(host, HOSTS); await savedRules(guest, GUESTS); }
    await sleep(200);
    await button(host, party.mode.label).click(); await button(host, 'Start').click();
    progress(`countdown to ${party.mode.label}`);
    await live(party, { enemies: 1 });

    /** The same on both pages: waits until the guest has every enemy the host has, then reads both. */
    const both = async (name, pages = [host, guest]) => {
      const uids = await host.evaluate(() => window.__op2.ctx.enemies.alive.map(e => e.uid));
      for (const page of pages.slice(1)) {
        await page.waitForFunction(uids => { const mine = new Set(window.__op2.ctx.enemies.alive.map(e => e.uid)); return uids.every(u => mine.has(u)) && mine.size === uids.length; }, uids, { timeout: 30000 }).catch(() => {});
      }
      // The count of what is left is told four times a second, an identity ten: both have settled a second on.
      await sleep(SIM ? 2500 : 1300);
      const reads = await Promise.all(pages.map(read));
      out.reads[name] = reads;
      return reads;
    };
    /** One enemy and one page-wide number at a time, the guest's against the host's. */
    const agree = (name, [h, g], who = 'the guest') => {
      const uids = Object.keys(h.foes);
      check(uids.length > 0 && same(Object.keys(g.foes).sort(), uids.sort()), `${name}: ${who} has the host's ${uids.length} enemies`, { host: uids, guest: Object.keys(g.foes) });
      for (const key of ['max', 'health', 'hits', 'armor', 'plates', 'shown', 'limbs', 'rank', 'gear']) {
        const off = uids.filter(u => g.foes[u] && !same(h.foes[u][key], g.foes[u][key]));
        if (uids.some(u => h.foes[u][key] !== undefined)) check(off.length === 0, `${name}: every enemy's ${NAMES[key]} is the host's on ${who}'s page (${uids.length - off.length} of ${uids.length})`,
          off.slice(0, 4).map(u => ({ id: h.foes[u].id, host: h.foes[u][key], guest: g.foes[u][key] })));
      }
      check(g.wave === h.wave && g.hud.wave === h.hud.wave, `${name}: the wave is the host's (${g.hud.wave})`, { host: h.wave, guest: g.wave, hud: g.hud.wave });
      check(g.level === h.level, `${name}: enemies are scaled for the host's wave (${g.level})`, { host: h.level, guest: g.level });
      check(g.left === h.left && g.hud.left === h.hud.left, `${name}: the enemies left are the host's count (${g.hud.left})`, { host: h.left, guest: g.left, hostHud: h.hud.left, guestHud: g.hud.left });
      if (h.rules) {
        check(same(g.rules, h.rules), `${name}: the rules in play are the host's (health ${g.rules?.healthPct} %, damage ${g.rules?.damagePct} %, helmets from wave ${g.rules?.helmetsFrom})`, { host: h.rules, guest: g.rules });
        check(same(g.tuning, h.tuning), `${name}: enemies are built with the host's numbers`, { host: h.tuning, guest: g.tuning });
      }
      check(g.hud.unranked === h.hud.unranked, `${name}: the unranked tag is the host's (${g.hud.unranked})`, { host: h.hud.unranked, guest: g.hud.unranked });
      if (h.cleared !== null) check(g.cleared === h.cleared && g.locked === h.locked, `${name}: the shop has released what the host's has (cleared ${g.cleared}, ${g.locked} rows locked)`, { host: [h.cleared, h.locked], guest: [g.cleared, g.locked] });
    };
    const NAMES = { max: 'full health', health: 'health', hits: 'damage multiplier', armor: 'armour', plates: 'plate strengths', shown: 'plates worn', limbs: 'limb pools', rank: 'rank', gear: 'gear' };
    const pictures = async (name, pages) => {
      for (const [i, page] of pages.entries()) {
        const path = `${outDir}/rules-${TAG}-${name}-${i === 0 ? 'host' : `guest${i}`}.png`;
        await page.screenshot({ path, timeout: 120000 });
        out.screenshots.push(path);
      }
    };
    /** Everyone looks at the row of enemies from the spawn. */
    const face = pages => Promise.all(pages.map((page, i) => page.evaluate(i => {
      const { ctx } = window.__op2, s = ctx.world.playerSpawns[0];
      if (!ctx.player.parked) ctx.player.teleport(s.position.clone().add(new s.position.constructor(Math.cos(s.yaw) * (i * 1.5 - 1), 0, -Math.sin(s.yaw) * (i * 1.5 - 1))));
      ctx.player.yaw = s.yaw; ctx.player.pitch = -0.05; ctx.player.velocity.set(0, 0, 0);
    }, i)));

    if (PART === 'humans') {
      // ---- Endless Humans: what each man wears --------------------------------------------------------------------
      await calm(host);
      await host.evaluate(() => { window.__op2.ctx.waves.update = () => {}; window.__op2.ctx.enemies.outpost.commander.have.add('helmets'); });
      const men = await spawn(host, 'trooper', 4, { ahead: 9, hold: true, spacing: 1.8 });
      men.push(...await spawn(host, 'gunner', 2, { ahead: 12, hold: true, spacing: 1.8 }));
      let reads = await both('heavy helmets');
      agree('heavy helmets', reads);
      const HEAVY = 1 << 12, VISOR = 1 << 3, WHIP = 1;
      check(Object.values(reads[0].foes).every(f => (f.gear & HEAVY) !== 0 && (f.gear & VISOR) !== 0), 'heavy helmets: every man on the host has the heavy helmet and its visor', Object.values(reads[0].foes).map(f => f.gear));
      check(Object.values(reads[1].foes).every(f => (f.gear & HEAVY) !== 0 && (f.gear & VISOR) !== 0), 'heavy helmets: and so has every copy on the guest', Object.values(reads[1].foes).map(f => f.gear));
      // One of them is given a job after he is in the field: the sonar jammer's whip antenna.
      await host.evaluate(uid => {
        const o = window.__op2.ctx.enemies.outpost;
        o.commander.units.enrol(o.soldiers.find(s => s.e.uid === uid), 'jammer');
      }, men[1]);
      reads = await both('the jammer');
      agree('the jammer', reads);
      check((reads[0].foes[men[1]]?.gear & WHIP) !== 0 && (reads[1].foes[men[1]]?.gear & WHIP) !== 0, "the jammer: the whip antenna is on the host's man and on the guest's copy of him", [reads[0].foes[men[1]]?.gear, reads[1].foes[men[1]]?.gear]);
      check(Object.entries(reads[1].foes).filter(([uid]) => Number(uid) !== men[1]).every(([, f]) => (f.gear & WHIP) === 0), 'the jammer: and on nobody else', Object.values(reads[1].foes).map(f => f.gear));
      await face([host, guest]);
      await sleep(300);
      await pictures('men', [host, guest]);
    } else {
      // ---- The Crucible: custom rules, wave 1 and wave 21 ---------------------------------------------------------
      const stage = async wave => {
        await calm(host);
        await host.evaluate(wave => {
          const { ctx } = window.__op2;
          ctx.waves.update = () => {};
          ctx.waves.wave = wave; ctx.waves.phase = 'spawning';
          ctx.enemies.setWave(wave);
        }, wave);
        await sleep(400);
        for (const [kind, count, ahead] of [['husk', 2, 8], ['trooper', 2, 10], ['gunner', 2, 12], ['rocketeer', 1, 14], ['brute', 1, 16]]) await spawn(host, kind, count, { ahead, hold: true, spacing: 2 });
        // Twenty-three more to come, as far as the host's count goes.
        await host.evaluate(() => { window.__op2.ctx.enemies.queued = 23; });
      };
      for (const wave of [1, 21]) {
        const name = `wave ${wave}`;
        await stage(wave);
        const reads = await both(name);
        agree(name, reads);
        const [h, g] = reads;
        const husk = Object.values(h.foes).find(f => f.id === 'husk'), gunner = Object.values(g.foes).find(f => f.id === 'gunner');
        out[`husk${wave}`] = husk;
        // The host's rules, by their numbers: twice the health, half as much again the damage, on top of the wave's own.
        const scale = 1 + 0.085 * (wave - 1), hits = Math.min(1 + 0.05 * (wave - 1), 2.6) * 1.5;
        const guestHusk = Object.values(g.foes).find(f => f.id === 'husk');
        check(h.tuning.health === 2 && g.tuning.health === 2 && guestHusk?.max === husk.max, `${name}: enemy health is 200 % on both pages (a Husk has ${husk.max}, ${(husk.max / (2 * scale)).toFixed(0)} by the wave's ${scale.toFixed(2)} by 2)`, { host: h.tuning, guest: g.tuning, husk, guestHusk });
        check(Object.values(g.foes).every(f => Math.abs(f.hits - hits) < 0.002), `${name}: every copy on the guest hits for ${hits.toFixed(2)} times (the wave's ${(hits / 1.5).toFixed(2)} by the host's 150 %)`, Object.values(g.foes).map(f => f.hits));
        check(gunner?.plates.length === 1 && gunner.shown === 1, `${name}: a Gunner wears his helmet on the guest (the host's "helmets from wave 1"; the guest's own rules say never)`, gunner);
        check(h.left === Object.keys(h.foes).length + 23, `${name}: the host counts ${h.left} left (8 alive and 23 to come), and so does the guest (${g.hud.left})`, { host: h.left, guest: g.hud.left });
        check(g.hud.unranked === true && g.line === true, `${name}: the guest's screen says the run is unranked, by the host's rules`, g.hud);
        check(g.rules.startWave === 1 && g.rules.sizePct === 100, `${name}: none of the guest's own saved rules is in play (start wave ${g.rules.startWave}, size ${g.rules.sizePct} %)`, g.rules);
        await face([host, guest]);
        await sleep(300);
        await pictures(name.replace(' ', ''), [host, guest]);
      }
      // ---- A third player arrives on wave 21 ----------------------------------------------------------------------
      progress('a third player joins on wave 21');
      const late = await lateGuest(party, 'GUEST-THREE');
      await inMatch([late], party.mode.contract);
      await late.evaluate(() => { window.__op2.ctx.player.modifiers.invulnerable = true; window.__op2.game.setState('playing'); });
      const reads = await both('late joiner', [host, guest, late]);
      agree('late joiner', [reads[0], reads[2]], 'the late joiner');
      agree('late joiner, the first guest still', [reads[0], reads[1]]);
      check(reads[2].hud.unranked === true && reads[2].line === true, "late joiner: told the host's custom rules apply", reads[2].hud);
      await face([host, guest, late]);
      await sleep(300);
      await pictures('late', [late]);
    }
    check(out.errors.length === 0, 'No page exceptions', out.errors);
    hard(out.failed.length === 0, 'Every check passed', out.failed.map(f => f.message));
    return out;
  } catch (error) {
    out.failure = error.stack ?? String(error);
    throw error;
  } finally {
    writeFileSync(`${outDir}/rules-${TAG}-evidence.json`, JSON.stringify(out, null, 2));
    for (const page of party?.guests ?? []) await page.close().catch(() => {});
  }
}
