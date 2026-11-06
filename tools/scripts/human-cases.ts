// The rules of surrender and capture, on the real EnemyManager, squads and wounds on the real Kill House, with no browser. Each case sets
// up the situation, runs real time, and prints what happened. Where it matters a case is repeated across many men, because a rule about
// who gives up is a rule about odds.
//
//   nice -n 19 npx tsx tools/scripts/human-cases.ts [case,case] [seed]
//
// Cases: oneshot ranks execute refuse rescue rearm question grab orders ambush, and with HUMAN_MAP=outpost: tower lane
import * as THREE from 'three';

const globals = globalThis as unknown as Record<string, unknown>;
const MAP = process.env.HUMAN_MAP ?? 'killhouse';
globals.location = { search: `?contract=outpost&map=${MAP}` };
const gradient = { addColorStop() {} };
const paint: unknown = new Proxy({}, {
  get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : String(key).endsWith('Gradient') ? () => gradient : () => undefined),
  set: () => true,
});
globals.document = { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) };

const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : null;
const seed = Number(process.argv[3] ?? 7);

const { mulberry32 } = await import('../../src/core/math');
Math.random = mulberry32(seed);
const { createHeadlessGame } = await import('../../src/player/testkit/headless');
const { World } = await import('../../src/world/World');
const { EnemyManager } = await import('../../src/enemies/EnemyManager');
const { noop } = await import('../../src/core/stubs');
const { soldierOf } = await import('../../src/enemies/outpost');
const { RANKS } = await import('../../src/enemies/outpost/rank');

function fakeCharacter(id: string): unknown {
  const root = new THREE.Group();
  const bones = Array.from({ length: 17 }, () => new THREE.Bone());
  for (const b of bones) root.add(b);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.2, 1.42, 0.55);
  root.add(muzzle);
  const anim = { posture: 'stand', onFootstep: null, setLocomotion() {}, play: () => 0, flinch() {}, update() {}, disarm() {}, rearm() {}, setPosture(p: string) { this.posture = p; } };
  // One gun in the right hand, so a man has something to drop and come back for.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6));
  root.add(gun);
  return {
    archetype: id, rig: { height: 1.85, bones: [] }, root, bones, mesh: root, anim, severed: new Set(), props: [{ bone: 10, object: gun }], muzzle,
    hideLimb() {}, addWound() {}, setBloodiness() {}, hitFlash() {}, attachProp() {}, setBurn() {}, setFrost() {}, setLod() {}, release() { root.removeFromParent(); },
    fracture() { return true; }, isFractured() { return false; },
  };
}

const game = await createHeadlessGame(() => {});
const ctx = game.ctx as unknown as Record<string, any>;
ctx.render.scene = new THREE.Scene();
ctx.render.materials = { patch: (m: unknown) => m };
ctx.render.decals = noop('decals');
let highlit = 0;
ctx.render.highlight = (meshes: unknown[]) => { highlit = Math.max(highlit, meshes.length); };
ctx.characters = { spawn: fakeCharacter };
const marks: string[] = [];
ctx.hud = new Proxy(noop('hud') as object, { get: (t, k) => (k === 'marker' || k === 'follow' ? (_: unknown, label: string) => { marks.push(label); return () => {}; } : (t as any)[k]) });
ctx.progression = noop('progression');
ctx.weapons = noop('weapons');
ctx.campaign = noop('campaign');
ctx.combat = { spawnProjectile() {}, enemyMuzzle() {}, explode() {}, fireRay() { return null; } };

const world = new World(game.ctx);
ctx.world = world;
await world.build();
ctx.physics.flushQueries?.();
const manager = new EnemyManager(game.ctx);
ctx.enemies = manager;
const outpost = manager.outpost!;
const waves = outpost.waves;
ctx.waves = waves;
waves.update = () => {};
manager.init(game.ctx);
const player = game.player;
const input = game.input;
const YARD = new THREE.Vector3(-30, 0.1, 6);

function run(seconds: number, each?: () => void): void {
  for (let f = 0; f < seconds * 60; f++) {
    ctx.time.tick(1 / 60);
    player.update();
    manager.update();
    world.update();
    input.endFrame();
    each?.();
  }
}

function fresh(): void {
  for (const e of [...manager.alive]) manager.withdraw(e as never);
  run(0.05);
  manager.reset();
  marks.length = 0;
  player.modifiers.invulnerable = true;
  player.teleport(YARD.clone(), 0);
  player.health = player.maxHealth = 100;
  run(0.05);
}

/** Men in the open at `offset` metres from the player, as one squad of this grade. */
function squad(ids: string[], grade: any, at: THREE.Vector3): any[] {
  outpost.formSquad(ids.length, at);
  const q = outpost.squads[outpost.squads.length - 1]!;
  q.grade = grade;
  const men: any[] = [];
  ids.forEach((id, i) => {
    const p = at.clone();
    p.x += (i % 3) * 1.5;
    p.z += Math.floor(i / 3) * 1.5;
    world.nav.nearest(p, 4, p);
    men.push(manager.spawn(id as never, p));
  });
  return men;
}

const hit = (e: any, amount: number, region = 'chest', type = 'bullet') => manager.applyDamage(e, {
  amount, type, point: e.center.clone(), dir: e.center.clone().sub(player.eye).normalize(), force: 0, source: 'shotgun', region,
} as never);
const near = (x: number, z: number) => YARD.clone().add(new THREE.Vector3(x, 0, z));
const tally: Record<string, unknown> = {};

/** Hands up, as the judgement would have left him. */
function kneel(e: any): void {
  const s = soldierOf(e)!;
  outpost.collapse(s, 'surrender');
  for (let i = 0; i < 90 && !s.surrendered; i++) run(1 / 60);
  if (!s.surrendered) throw new Error(`did not kneel: fate ${s.fate} alive ${e.alive} behaviour ${e.behaviour?.name} stagger ${e.stagger} downed ${s.downed}/${e.downed} pos ${e.position.toArray()}`);
}

const CASES: Record<string, () => void> = {
  oneshot() {
    // One man in a healthy squad shot once in the chest, in a fight they are winning.
    let gaveUp = 0, shot = 0;
    for (let t = 0; t < 60; t++) {
      fresh();
      const men = squad(['trooper', 'trooper', 'gunner', 'trooper'], t % 2 ? 'conscript' : 'regular', near(14, 0));
      run(1);
      hit(men[t % 4], 20);
      shot++;
      run(6);
      for (const e of men) if (soldierOf(e)?.surrendered) gaveUp++;
    }
    tally.oneshot = `${gaveUp} men gave up across ${shot} squads with one man shot once`;
  },
  ranks() {
    // The last man of a squad wiped out, alone and badly hurt, with the field lost. It is the same situation for each grade.
    const rows: Record<string, string> = {};
    for (const grade of ['conscript', 'regular', 'veteran', 'elite']) {
      let gave = 0;
      const trials = 60;
      for (let t = 0; t < trials; t++) {
        fresh();
        const men = squad(['trooper', 'trooper', 'trooper', 'trooper', 'trooper'], grade, near(30, 0));
        const last = men[4];
        const s = soldierOf(last)!;
        s.rank = grade as never;
        s.rankDef = RANKS[grade as keyof typeof RANKS];
        for (let i = 0; i < 4; i++) manager.withdraw(men[i]);
        run(0.1);
        last.health = last.maxHealth * 0.3;
        s.morale = 40;
        outpost.peakHostile = 5;
        s.mag = 0;
        s.reserve = 0;
        s.hitAt = -99;
        run(6);
        if (s.surrendered) gave++;
      }
      rows[grade] = `${Math.round((gave / trials) * 100)}%`;
    }
    tally.ranks = rows;
  },
  execute() {
    let dead = 0, trials = 0;
    const plated: string[] = [];
    for (let t = 0; t < 12; t++) {
      fresh();
      const [e] = squad(['trooper', 'trooper', 'trooper'], 'regular', near(5, 0));
      run(0.5);
      kneel(e);
      trials++;
      // One shotgun shell's worth, as eight pellets into the chest of a man in a plate carrier.
      for (let i = 0; i < 8 && e.alive; i++) hit(e, 9, 'chest', 'pellet');
      if (!e.alive) dead++;
      if (t === 0) plated.push(`armor ${Math.round(e.armor)}`);
    }
    tally.execute = `${dead} of ${trials} kneeling men died to one shell`;
  },
  refuse() {
    fresh();
    const [e] = squad(['trooper', 'trooper', 'trooper'], 'regular', near(5, 0));
    run(0.5);
    kneel(e);
    const s = soldierOf(e)!;
    const before = outpost.prisoners;
    hit(e, 3, 'legL');
    run(0.5);
    tally.refuse = { alive: e.alive, fate: s.fate, surrendered: s.surrendered, refused: s.refused, prisonersBefore: before, prisonersAfter: outpost.prisoners, behaviour: e.behaviour?.name, moved: +e.velocity.length().toFixed(1) };
  },
  rescue() {
    const out: Record<string, number> = { rejoined: 0, fled: 0, stayed: 0 };
    for (let t = 0; t < 30; t++) {
      fresh();
      player.teleport(YARD.clone().add(new THREE.Vector3(-14, 0, 0)), 0);
      const men = squad(['trooper', 'trooper', 'trooper'], 'regular', near(5, 0));
      run(0.5);
      kneel(men[0]);
      const s = soldierOf(men[0])!;
      // A friend opens up beside him.
      soldierOf(men[1])!.firedAt = ctx.time.elapsed;
      s.judgeAt = 0;
      run(2, () => { soldierOf(men[1])!.firedAt = ctx.time.elapsed; });
      if (s.fate === 'none' && !s.surrendered) out.rejoined!++;
      else if (s.fate === 'flee') out.fled!++;
      else out.stayed!++;
    }
    tally.rescue = out;
  },
  rearm() {
    const rows: Record<string, number> = {};
    for (const grade of ['conscript', 'regular', 'veteran', 'elite']) {
      let back = 0;
      const trials = 30;
      for (let t = 0; t < trials; t++) {
        fresh();
        // Far behind the player's back, behind a wall, with the player gone.
        player.teleport(new THREE.Vector3(30, 0.1, -4), 0);
        const men = squad(['trooper', 'trooper', 'trooper'], grade, new THREE.Vector3(-30, 0.1, 6));
        const e = men[0];
        const s = soldierOf(e)!;
        s.rankDef = RANKS[grade as keyof typeof RANKS];
        manager.withdraw(men[1]);
        manager.withdraw(men[2]);
        run(0.2);
        kneel(e);
        s.watchedAt = -99;
        run(18);
        if (!s.surrendered && s.fate === 'none' && s.weapon === 'primary') back++;
      }
      rows[grade] = back;
    }
    tally.rearm = rows;
  },
  question() {
    fresh();
    const men = squad(['trooper', 'trooper', 'trooper'], 'conscript', near(3, 0));
    const others = squad(['trooper', 'gunner', 'trooper'], 'regular', new THREE.Vector3(30, 0.1, -4));
    run(0.5);
    kneel(men[0]);
    const e = men[0];
    const s = soldierOf(e)!;
    const lines: string[] = [];
    const off = ctx.events.on('comms:line', (l: any) => lines.push(`${l.speaker}: ${l.text}`));
    player.teleport(e.position.clone().add(new THREE.Vector3(0, 0, 2)), 0);
    run(0.2);
    input.simulate('interact', true);
    run(0.1);
    input.simulate('interact', false);
    run(0.3);
    off();
    tally.question = { questioned: s.questioned, marks: [...marks], said: lines.slice(-1), highlit, othersKnown: others.length };
  },
  grab() {
    fresh();
    const men = squad(['trooper', 'trooper', 'trooper'], 'regular', near(3, 0));
    const shooter = squad(['trooper', 'trooper', 'trooper'], 'veteran', near(-18, 0));
    run(0.5);
    const e = men[0];
    kneel(e);
    const s = soldierOf(e)!;
    player.teleport(e.position.clone().add(new THREE.Vector3(0, 0, 2)), 0);
    player.yaw = 0;
    run(0.2);
    input.simulate('interact', true);
    run(0.55);
    input.simulate('interact', false);
    run(0.1);
    const held = outpost.captives.held === s;
    const distance = +e.position.distanceTo(player.position).toFixed(2);
    player.modifiers.invulnerable = false;
    // A rifle round from the front, then one from behind.
    const front = player.position.clone().addScaledVector(player.forward, 20);
    const behind = player.position.clone().addScaledVector(player.forward, -20);
    const armorBefore = e.armor, healthBefore = e.health, playerBefore = player.health;
    player.takeDamage({ amount: 7, from: front, type: 'bullet', source: 'trooper' });
    const afterFront = { player: player.health, armor: e.armor, health: e.health };
    player.takeDamage({ amount: 7, from: behind, type: 'bullet', source: 'trooper' });
    const afterBehind = player.health;
    player.modifiers.invulnerable = true;
    // How long his friends hold fire, for a man in front of the shield and one behind it.
    const asked = soldierOf(shooter[0])!;
    const stopped = (rank: keyof typeof RANKS, at: THREE.Vector3): boolean => {
      asked.rankDef = RANKS[rank];
      shooter[0].position.copy(at);
      return outpost.captives.stopsFire(asked);
    };
    const stops = { conscript: stopped('conscript', front), veteran: stopped('veteran', front), flanker: stopped('conscript', behind) };
    run(3);
    const stopsLate = { conscript: stopped('conscript', front), veteran: stopped('veteran', front) };
    const moved = player.position.clone();
    input.simulate('forward', true);
    run(1.2);
    input.simulate('forward', false);
    const speed = +(player.position.distanceTo(moved) / 1.2).toFixed(1);
    input.simulate('interact', true);
    run(0.1);
    input.simulate('interact', false);
    run(0.3);
    tally.grab = {
      held, distance, playerBefore, afterFront, armorBefore, healthBefore, afterBehind, stops, stopsLate, speedWithHim: speed,
      letGo: outpost.captives.held === null, fate: s.fate, released: s.released, freed: outpost.captives.freed,
    };
  },
  orders() {
    fresh();
    player.teleport(new THREE.Vector3(0, 0.1, -19), 0);
    const seen: string[] = [];
    const given = new Map<string, number>();
    ctx.events.on('commander:bark', (b: any) => seen.push(`${b.vars?.squad}: ${b.id}`));
    ctx.events.on('commander:order', (o: any) => given.set(o.squad, ctx.time.elapsed));
    const obeyed: string[] = [];
    ctx.events.on('commander:obeyed', (o: any) => obeyed.push(`${o.squad} ${o.drill} after ${o.seconds.toFixed(1)}s`));
    outpost.commander.orders.reset();
    squad(['trooper', 'trooper', 'brute', 'trooper'], 'regular', new THREE.Vector3(19, 0.1, -19));
    squad(['trooper', 'gunner', 'trooper', 'gunner'], 'veteran', new THREE.Vector3(-19, 0.1, -19));
    outpost.onWaveStart();
    run(70);
    const { issued, obeyed: done } = outpost.commander.orders;
    tally.orders = { issued, done, seen: seen.slice(0, 5), obeyed: obeyed.slice(0, 5) };
  },
  tower() {
    // A gun and a marksman on Tower Two's platform, the player out on the apron 50 m down the East lane. Measures whether they stay up there.
    fresh();
    const top = new THREE.Vector3(40, 9.1, 12);
    if (!world.nav.nearest(top, 4, top)) throw new Error('no floor on the tower');
    player.teleport(new THREE.Vector3(40, 0.3, 62), 0);
    run(0.2);
    const men = squad(['brute', 'sniper'], 'veteran', top);
    let shots = 0, rounds = 0;
    ctx.combat.spawnProjectile = () => { rounds++; };
    ctx.combat.fireRay = () => { shots++; return null; };
    const y0 = men[0].position.y;
    run(25);
    tally.tower = { top: top.toArray().map(v => +v.toFixed(1)), stayedUp: men.map(e => +(e.position.y - y0).toFixed(1)), rounds, snipes: shots, sees: men.map(e => soldierOf(e)!.sees), range: +men[0].dist.toFixed(1), task: men.map(e => soldierOf(e)!.task), drill: soldierOf(men[0])!.squad.drill };
  },
  climb() {
    // A belt at the foot of the wall. Does he go up onto something?
    fresh();
    player.teleport(new THREE.Vector3(30, 0.3, 50), 0);
    run(0.2);
    const foot = new THREE.Vector3(36, 0.3, 18);
    world.nav.nearest(foot, 5, foot);
    const men = squad(['brute', 'trooper', 'trooper'], 'veteran', foot);
    const y0 = men[0].position.y;
    const trail: string[] = [];
    for (let i = 0; i < 12; i++) {
      run(5);
      const s = soldierOf(men[0])!;
      trail.push(`${men[0].position.toArray().map((v: number) => v.toFixed(0)).join(',')} ${s.task} ${s.squad.drill}`);
    }
    tally.climb = { trail, y0: +y0.toFixed(1), y: +men[0].position.y.toFixed(1), route: soldierOf(men[0])!.route.count, stalls: soldierOf(men[0])!.stalls, spot: soldierOf(men[0])!.spot?.position.toArray().map(v => +v.toFixed(1)), high: outpost.cover.spots.filter(s => s.position.y > 4).length, spots: outpost.cover.spots.length };
  },
  ambush() {
    fresh();
    player.teleport(new THREE.Vector3(30, 0.1, -4), 0);
    const men = squad(['trooper', 'trooper', 'gunner', 'trooper'], 'veteran', new THREE.Vector3(6.6, 0.1, 3));
    const q = soldierOf(men[0])!.squad;
    q.lieStill();
    outpost.onWaveStart();
    run(5);
    const beforeFired = men.map(e => soldierOf(e)!.firedAt);
    const quiet = men.every(e => soldierOf(e)!.silent);
    const log: string[] = [];
    const t0 = ctx.time.elapsed;
    const off = ctx.events.on('comms:line', (l: any) => log.push(`${(ctx.time.elapsed - t0).toFixed(1)} ${l.speaker}: ${l.text}`));
    // Walks towards them. Nothing happens until it does.
    let sprungAt = -1, range = 0, minD = 99;
    for (let i = 0; i < 40 * 60 && sprungAt < 0; i++) {
      const to = men[0].position;
      const d = new THREE.Vector3(to.x - player.position.x, 0, to.z - player.position.z);
      const len = d.length();
      if (len > 1) player.teleport(player.position.clone().addScaledVector(d.normalize(), Math.min(len, 4 / 60)), Math.atan2(-d.x, -d.z));
      run(1 / 60);
      minD = Math.min(minD, len);
      if (men.some(e => !soldierOf(e)!.silent)) {
        sprungAt = ctx.time.elapsed - t0;
        range = len;
      }
    }
    tally.ambushDebug = { minDist: minD, sees: men.map(e => soldierOf(e)!.sees), notice: men.map(e => +soldierOf(e)!.notice.toFixed(2)), los: men.map(e => e.hasLos), behaviours: men.map(e => e.behaviour?.name), stage: men.map(e => soldierOf(e)!.stage), goal: q.goal, known: +(ctx.time.elapsed - q.knownAt).toFixed(1) };
    const afterFired = () => men.filter((e, i) => soldierOf(e)!.firedAt > beforeFired[i]!).length;
    run(2);
    off();
    tally.ambush = { quietAtStart: quiet, sprungAt: +sprungAt.toFixed(1), range: +range.toFixed(1), firedWithin2s: afterFired(), drill: q.drill, heard: log.slice(0, 4) };
  },
};

for (const name of Object.keys(CASES)) if (!only || only.includes(name)) CASES[name]!();
console.log(JSON.stringify(tally, null, 1));
