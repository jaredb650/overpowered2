/**
 * Progression sandbox.
 *
 *   /?sandbox=progression                     headless assertions: the whole ladder, timers, stacking, modifiers,
 *                                             targeting and strike timelines, on a stubbed world and a simulated clock
 *   /?sandbox=progression&mode=game           the real game, plus the grants below
 *     &perk=hellfire,berserk                  grants perks or powerups once the run starts
 *     &callin=airstrike,nuke                  grants call-ins
 *
 * window.__op2.results holds the assertion report. In game mode, window.__prog grants from a script and reports what ran.
 */
import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { makeCtx } from './harness';
import { noop } from '../core/stubs';
import { createProgression } from '../progression';
import { COMBO_WINDOW, STYLE_GATE } from '../progression/data';
import type { Action, Ctx, DamageInfo, GradeName, InputSystem, PlayerModifiers } from '../core/contracts';
import type {
  CallInId, EnemyInstance, ExplosionSpec, KillEvent, PerkId, PowerupId, ProjectileSpec, WeaponModifiers,
} from '../core/gameplay';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

class FakeInput {
  private down = new Set<Action>();
  private edgeDown = new Set<Action>();
  private edgeUp = new Set<Action>();
  isDown(a: Action): boolean { return this.down.has(a); }
  pressed(a: Action): boolean { return this.edgeDown.has(a); }
  released(a: Action): boolean { return this.edgeUp.has(a); }
  simulate(a: Action, on: boolean): void {
    if (on && !this.down.has(a)) this.edgeDown.add(a);
    if (!on && this.down.has(a)) this.edgeUp.add(a);
    if (on) this.down.add(a);
    else this.down.delete(a);
  }
  endFrame(): void {
    this.edgeDown.clear();
    this.edgeUp.clear();
  }
}

function neutralWeapons(): WeaponModifiers {
  return {
    damage: 1, fireRate: 1, bottomlessMag: false, pellets: 1, explosiveRounds: false, blastRadius: 1, instakillBlast: false,
    akimbo: false, ricochet: 0, shockRounds: false, alwaysSever: false, tracer: null, shotLayers: [],
  };
}

async function headless(): Promise<void> {
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail: unknown = ''): void => {
    checks.push({ name, pass, detail: String(detail) });
  };
  const near = (a: number, b: number, tol = 0.051): boolean => Math.abs(a - b) <= tol;

  const physics = await Physics.create();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(300, 0.5, 300), null, 'concrete');
  physics.flushQueries();

  const input = new FakeInput();
  const grades: GradeName[] = [];
  const explosions: { position: THREE.Vector3; spec: ExplosionSpec; at: number }[] = [];
  const projectiles: { spec: ProjectileSpec; at: number }[] = [];
  const position = new THREE.Vector3(0, 0, 0);
  const eye = new THREE.Vector3(0, 1.7, 0);
  const forward = new THREE.Vector3(0, -0.5, -1).normalize();
  const velocity = new THREE.Vector3();
  const playerMods: PlayerModifiers = { speed: 1, jump: 1, damageTaken: 1, invulnerable: false, infiniteDash: false };
  const weaponMods = neutralWeapons();
  let holstered = false;
  let waveCount = 0;
  let enemyUid = 0;
  const aliveList: EnemyInstance[] = [];

  const scene = new THREE.Scene();
  const render = {
    scene,
    viewScene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    viewCamera: new THREE.PerspectiveCamera(),
    materials: { patch: <T>(m: T) => m, world: () => new THREE.MeshBasicMaterial() },
    post: new Proxy({}, { get: (_t, k) => (k === 'setGrade' ? (g: GradeName) => grades.push(g) : () => undefined) }),
    lights: noop('lights'),
    decals: noop('decals'),
  };

  const ctx = makeCtx({
    physics,
    input: input as unknown as InputSystem,
    render: render as unknown as Ctx['render'],
  });
  const c = ctx as unknown as Record<string, unknown>;
  const health = { value: 100 };
  const body = { grounded: true };
  c.player = {
    position, eye, velocity, forward, modifiers: playerMods, maxHealth: 100, armor: 0, alive: true,
    get grounded() { return body.grounded; },
    get health() { return health.value; },
    set health(v: number) { health.value = v; },
    heal(n: number) { health.value = Math.min(100, health.value + n); },
    addArmor() { /* not asserted */ },
    launch() { /* not asserted */ },
  };
  c.weapons = {
    modifiers: weaponMods,
    owned: new Set(['smg']),
    ammo: () => ({ mag: 30, magSize: 30, reserve: 60, maxReserve: 120 }),
    refillMagazines() { /* not asserted */ },
    addAmmo() { /* not asserted */ },
    addGrenades() { /* not asserted */ },
    give() { /* not asserted */ },
    switchTo() { /* not asserted */ },
    setHolstered(on: boolean) { holstered = on; },
  };
  c.enemies = {
    alive: aliveList,
    remaining: 0,
    query(_c: THREE.Vector3, _r: number, out: EnemyInstance[]) {
      out.length = 0;
      out.push(...aliveList);
      return out.length;
    },
    applyDamage: () => ({ dealt: 0, killed: false, headshot: false, severed: [], blocked: false }),
  };
  c.combat = {
    fireRay: () => ({ hitEnemy: false, headshot: false, killed: false, end: new THREE.Vector3() }),
    spawnProjectile(spec: ProjectileSpec) { projectiles.push({ spec, at: simTime }); },
    explode(pos: THREE.Vector3, spec: ExplosionSpec) { explosions.push({ position: pos.clone(), spec, at: simTime }); },
  };
  c.waves = { phase: 'clearing', wave: 1 };
  c.viewmodel = noop('viewmodel');
  c.hud = noop('hud');
  c.fx = new Proxy({}, { get: (_t, k) => (k === 'attachEmitter' ? () => ({ stop() { /* stub */ }, alive: false }) : () => undefined) });
  c.audio = new Proxy({}, { get: (_t, k) => (k === 'startLoop' ? () => noop('loop') : () => undefined) });
  c.camera = noop('camera');
  (ctx.world as unknown as { pickupSpots: THREE.Vector3[] }).pickupSpots = [];
  c.world = { pickupSpots: [] };

  const prog = createProgression(ctx);
  prog.init?.(ctx);
  prog.reset?.();

  let simTime = 0;
  const step = (seconds: number): void => {
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames; i++) {
      ctx.time.tick(1 / 60);
      simTime += 1 / 60;
      prog.update?.();
      input.endFrame();
    }
  };

  const enemy = (): EnemyInstance => ({
    uid: ++enemyUid, id: 'husk', char: { rig: { height: 1.85 } } as unknown as EnemyInstance['char'],
    position: new THREE.Vector3(10, 0, 0), velocity: new THREE.Vector3(), yaw: 0, health: 0, maxHealth: 50, armor: 0, alive: false,
    score: 100, center: new THREE.Vector3(10, 1, 0), isBoss: false, frozen: 0, burning: 0, machine: false,
  });

  const kill = (over: Partial<KillEvent> & { source?: string } = {}): void => {
    const { source, ...rest } = over;
    const e: KillEvent = {
      enemy: enemy(),
      damage: { amount: 50, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), force: 0, source: source ?? 'smg' },
      headshot: false, gibbed: false, sliced: false, severedCount: 0, playerAirborne: false, playerSliding: false,
      playerWallRunning: false, playerSpeed: 10, distance: 10, explosionId: null, ...rest,
    };
    ctx.events.emit('enemy:killed', e);
  };

  const fresh = (): void => {
    prog.reset?.();
    ctx.time.clearScales();
    velocity.set(0, 0, 0);
    health.value = 100;
    body.grounded = true;
    explosions.length = 0;
    projectiles.length = 0;
    grades.length = 0;
    (c.waves as { phase: string }).phase = 'clearing';
    step(0.02);
  };

  // --- The ladder ------------------------------------------------------------------------------
  fresh();
  const seen: Record<string, number> = {};
  const offs = [
    ctx.events.on('perk:start', e => { seen[e.id] ??= prog.combo; }),
    ctx.events.on('callin:ready', e => { seen[e.id] ??= prog.combo; }),
  ];
  for (let i = 1; i <= 50; i++) {
    kill();
    if (i < 50) step(0.5);
  }
  offs.forEach(off => off());
  check('Blood Thirst at kill 4 (4 in 5 s)', seen.bloodthirst === 4, seen.bloodthirst);
  check('Airstrike at combo 8', seen.airstrike === 8, seen.airstrike);
  check('Hellfire at kill 10 (10 in 10 s)', seen.hellfire === 10, seen.hellfire);
  check('Warthog at combo 12', seen.warthog === 12, seen.warthog);
  check('Berserk at combo 15', seen.berserk === 15, seen.berserk);
  check('Sentinels at combo 20', seen.sentinels === 20, seen.sentinels);
  check('Orbital at combo 25', seen.orbital === 25, seen.orbital);
  check('Chain Storm at combo 30', seen.chainStorm === 30, seen.chainStorm);
  check('Black Sun at combo 40', seen.blackSun === 40, seen.blackSun);
  check('Nuke at combo 50', seen.nuke === 50, seen.nuke);
  check('Berserk does not reset the combo', prog.combo === 50, prog.combo);

  // --- Combo rules -----------------------------------------------------------------------------
  fresh();
  kill();
  step(1);
  kill();
  check('Combo counts within the window', prog.combo === 2, prog.combo);
  step(COMBO_WINDOW + 0.1);
  check('Combo dies after 5 s', prog.combo === 0, prog.combo);
  kill();
  check('Next kill restarts at 1', prog.combo === 1, prog.combo);
  kill();
  (c.waves as { phase: string }).phase = 'intermission';
  step(20);
  check('Wave break pauses the combo', prog.combo === 2 && prog.comboTimer > 0.9, `${prog.combo} ${prog.comboTimer}`);
  (c.waves as { phase: string }).phase = 'spawning';
  step(COMBO_WINDOW + 0.1);
  check('Combo resumes after the break', prog.combo === 0, prog.combo);

  // --- Perk timers, retrigger and stacking -----------------------------------------------------
  fresh();
  prog.grant('bloodthirst');
  step(0.1);
  const bt = prog.effects.find(e => e.id === 'bloodthirst')!;
  check('Blood Thirst counts down live', near(bt.remaining, 9.9), bt.remaining);
  prog.grant('bloodthirst');
  check('Blood Thirst does not refresh', near(bt.remaining, 9.9), bt.remaining);
  check('Blood Thirst modifiers', weaponMods.damage === 2 && weaponMods.bottomlessMag && weaponMods.pellets === 2, JSON.stringify(weaponMods));
  check('Layered shot audio', weaponMods.shotLayers.includes('bloodthirsty_shot'), weaponMods.shotLayers);
  step(9.95);
  check('Blood Thirst ends at 10 s', !prog.isActive('bloodthirst') && weaponMods.damage === 1, prog.effects.length);

  fresh();
  prog.grant('hellfire');
  step(0.05);
  check('Hellfire modifiers', weaponMods.explosiveRounds && weaponMods.instakillBlast && weaponMods.blastRadius === 2.5 && weaponMods.tracer === 'hellfire', JSON.stringify(weaponMods));
  step(5.1);
  check('Hellfire ends at 5 s', !prog.isActive('hellfire') && !weaponMods.explosiveRounds);

  fresh();
  prog.grant('bloodthirst');
  prog.grant('berserk');
  prog.grant('quad');
  prog.grant('haste');
  step(0.05);
  check('Damage multiplies: 2 x 5 x 4', weaponMods.damage === 40, weaponMods.damage);
  check('Fire rate multiplies: 3 x 1.5', near(weaponMods.fireRate, 4.5, 1e-6), weaponMods.fireRate);
  check('Pellets 6 x 6 = 36 in Blood Thirst and Berserk', weaponMods.pellets === 6, weaponMods.pellets);
  check('Speed 2 x 1.5', near(playerMods.speed, 3, 1e-6), playerMods.speed);
  check('Berserk invulnerable and akimbo', playerMods.invulnerable && weaponMods.akimbo);
  check('Three layers while buffed', weaponMods.shotLayers.length === 2, weaponMods.shotLayers);
  check('Berserk tracer wins', weaponMods.tracer === 'berserk', weaponMods.tracer);
  check('Grade: Berserk outranks Blood Thirst', grades[grades.length - 1] === 'berserk', grades.join());
  prog.grant('slowmo');
  prog.grant('hellfire');
  step(0.05);
  check('Grade: Berserk outranks SLOWMO and Hellfire', grades[grades.length - 1] === 'berserk', grades.join());
  step(5.1);
  ctx.time.clearScales();
  step(5.1);
  check('Grade falls to the remaining effect', grades[grades.length - 1] !== 'berserk', grades.join());
  step(5.1);
  check('Grade clears when all end', grades[grades.length - 1] === 'default', grades.join());

  fresh();
  prog.grant('hellfire');
  prog.grant('slowmo');
  step(0.05);
  check('Grade: SLOWMO outranks Hellfire', grades[grades.length - 1] === 'slowmo', grades.join());
  step(5.1);
  check('Grade back to neutral after both', grades[grades.length - 1] === 'default', grades.join());
  check('All modifiers neutral at the end', weaponMods.damage === 1 && weaponMods.fireRate === 1 && playerMods.speed === 1 && !playerMods.invulnerable);

  fresh();
  for (let i = 1; i <= 9; i++) {
    kill({ source: 'sword' });
    step(0.3);
    if (i === 3) check('Adrenaline x1 on sword kill 3', prog.effects.find(e => e.id === 'adrenaline')?.stacks === 1);
    if (i === 6) check('Adrenaline x2 on sword kill 6', prog.effects.find(e => e.id === 'adrenaline')?.stacks === 2);
  }
  const ad = prog.effects.find(e => e.id === 'adrenaline');
  check('Adrenaline x3 on sword kill 9', ad?.stacks === 3, ad?.stacks);
  check('Adrenaline timer reset, not added', near(ad?.remaining ?? 0, 4.7), ad?.remaining);
  check('Adrenaline speed', near(playerMods.speed, 1.45, 1e-6), playerMods.speed);
  step(5.1);
  check('All Adrenaline stacks fall together', !prog.isActive('adrenaline') && playerMods.speed === 1);

  // --- SLOWMO ----------------------------------------------------------------------------------
  fresh();
  const hit = (headshot: boolean, killed = false) => ctx.events.emit('enemy:hit', {
    enemy: enemy(),
    damage: { amount: 25, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: 'smg' },
    result: { dealt: 25, killed, headshot, severed: [], blocked: false },
  });
  hit(true);
  step(0.5);
  hit(true);
  step(0.5);
  hit(true);
  check('3 headshots in 3 s start SLOWMO', prog.isActive('slowmo'));
  step(0.25);
  check('Eases toward 0.25, not a hard cut', near(ctx.time.slowmo, 0.25, 0.02), ctx.time.slowmo);
  check('World slowed, player not', near(ctx.time.dt, ctx.time.playerDt * 0.25, 0.001), `${ctx.time.dt} ${ctx.time.playerDt}`);
  const slowLeft = prog.effects.find(e => e.id === 'slowmo')!;
  check('SLOWMO runs on real time', near(slowLeft.remaining, 4.75), slowLeft.remaining);
  step(4.8);
  check('SLOWMO ends after 5 real seconds', !prog.isActive('slowmo'));
  step(0.6);
  check('Eases back to 1', near(ctx.time.slowmo, 1, 0.001), ctx.time.slowmo);

  fresh();
  prog.grant('slowmo');
  step(0.3);
  ctx.events.emit('player:died', { source: 'test' });
  step(0.6);
  check('Dying in SLOWMO clears the time scale', near(ctx.time.slowmo, 1, 0.001) && prog.effects.length === 0, ctx.time.slowmo);

  // --- Style perks -----------------------------------------------------------------------------
  const sever = (type: DamageInfo['type'], source = 'shotgun', who = enemy()): void => ctx.events.emit('enemy:severed', {
    enemy: who, region: 'armL',
    damage: { amount: 50, type, point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source },
  });
  const butcher = (): void => {
    for (let i = 0; i < 5; i++) sever('pellet');
  };

  fresh();
  for (let i = 0; i < 4; i++) sever('pellet');
  step(0.05);
  check('Four limbs are not Butcher yet', !prog.isActive('butcher'));
  sever('pellet');
  step(0.05);
  check('Butcher on 5 bodies in 4 s', prog.isActive('butcher') && weaponMods.alwaysSever);

  fresh();
  const victim = enemy();
  for (let i = 0; i < 6; i++) sever('pellet', 'shotgun', victim);
  step(0.05);
  check('All the limbs of one body are one for Butcher', !prog.isActive('butcher'));

  fresh();
  for (let i = 0; i < 6; i++) sever('explosive', 'rocket');
  step(0.05);
  check('Limbs lost to a blast do not count for Butcher', !prog.isActive('butcher'));

  fresh();
  body.grounded = false;
  for (let i = 0; i < 4; i++) kill({ playerAirborne: true });
  step(0.05);
  check('A kill on the way up a hop is not Skyfall', !prog.isActive('skyfall'));
  step(0.4);
  for (let i = 0; i < 4; i++) kill({ playerAirborne: true });
  step(0.05);
  check('Skyfall on 4 kills with real hang time', prog.isActive('skyfall') && playerMods.infiniteDash);
  explosions.length = 0;
  ctx.events.emit('player:slam', { impact: 20, position: new THREE.Vector3(), radius: 8 } as never);
  check('Skyfall slam detonates', explosions.length === 1 && explosions[0]!.spec.source === 'skyfall');
  check('The slam blast stands clear of the floor', explosions[0]!.position.y > 0.3, explosions[0]!.position.y);
  step(8.1);
  check('Skyfall ends and returns dash charges', !playerMods.infiniteDash);

  fresh();
  for (let i = 0; i < 5; i++) {
    kill({ playerSpeed: 20 });
    step(1.7);
  }
  check('Overdrive on 5 kills above 18 m/s', prog.isActive('overdrive'));
  velocity.set(27, 0, 0);
  step(0.05);
  check('Overdrive damage follows speed', near(weaponMods.damage, 3, 1e-6), weaponMods.damage);
  velocity.set(12.5, 0, 0);
  step(0.05);
  check('Overdrive neutral at run speed', near(weaponMods.damage, 1, 1e-6), weaponMods.damage);

  fresh();
  prog.grant('berserk');
  step(0.05);
  for (let i = 0; i < 5; i++) {
    kill({ playerSpeed: 24 });
    step(0.1);
  }
  check('Berserk speed does not earn Overdrive', !prog.isActive('overdrive'));

  fresh();
  for (let i = 0; i < 4; i++) kill({ explosionId: 7 });
  step(0.2);
  check('Chain Reaction on 4 kills from one explosion', prog.isActive('chainReaction'));
  explosions.length = 0;
  kill();
  step(0.2);
  check('Chain Reaction: the dead explode, a beat later', explosions.length === 1 && explosions[0]!.spec.source === 'chain_reaction', explosions.length);

  fresh();
  kill({ explosionId: 1 });
  kill({ explosionId: 2 });
  kill({ explosionId: 3 });
  kill({ explosionId: 4 });
  step(0.05);
  check('Separate explosions do not count', !prog.isActive('chainReaction'));

  fresh();
  prog.grant('hellfire');
  step(0.05);
  for (let i = 0; i < 6; i++) kill({ explosionId: 9 });
  step(0.05);
  check('Hellfire blasts do not earn Chain Reaction', !prog.isActive('chainReaction'));

  // --- Style gate ------------------------------------------------------------------------------
  fresh();
  butcher();
  step(0.05);
  for (let i = 0; i < 4; i++) kill({ explosionId: 3 });
  step(0.05);
  check('A second style perk waits out the gate', prog.isActive('butcher') && !prog.isActive('chainReaction'));
  step(STYLE_GATE.spacing + 0.1);
  for (let i = 0; i < 4; i++) kill({ explosionId: 4 });
  step(0.05);
  check('The gate opens again', prog.isActive('chainReaction'));

  fresh();
  butcher();
  step(8.1);
  butcher();
  step(0.05);
  check('A style perk does not restart straight after it ends', !prog.isActive('butcher'));
  step(STYLE_GATE.rearm + 0.1);
  butcher();
  step(0.05);
  check('It re-arms in the end', prog.isActive('butcher'));

  // --- Assist kills ----------------------------------------------------------------------------
  fresh();
  kill({});
  step(2);
  const timerBefore = prog.comboTimer;
  for (let i = 0; i < 30; i++) kill({ source: 'airstrike' });
  step(0.05);
  check('Strike kills do not climb the combo', prog.combo === 1, prog.combo);
  check('Strike kills keep the combo alive', prog.comboTimer > timerBefore, prog.comboTimer);
  fresh();
  for (let i = 0; i < 30; i++) kill({ source: 'chopper' });
  step(0.05);
  check('Gunner seat kills climb at half rate', prog.combo === 15, prog.combo);
  fresh();
  for (let i = 0; i < 30; i++) kill({ source: 'airstrike' });
  step(0.05);
  check('Strike kills feed no perk window', !prog.isActive('bloodthirst') && !prog.isActive('hellfire'));
  check('Strike kills pay full score', prog.kills === 30 && prog.score >= 3000, prog.score);

  fresh();
  for (let i = 0; i < 48; i++) kill({ source: 'nuke', playerAirborne: true, playerSpeed: 30, explosionId: 2 });
  step(0.05);
  check('A nuke starts no style perk', prog.effects.every(e => e.id === 'berserk' || e.id === 'sentinels'), prog.effects.map(e => e.id).join());

  // --- SLOWMO counts heads, not rounds ---------------------------------------------------------
  fresh();
  const same = enemy();
  for (let i = 0; i < 3; i++) {
    ctx.events.emit('enemy:hit', {
      enemy: same,
      damage: { amount: 25, type: 'bullet', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: 'smg' },
      result: { dealt: 25, killed: false, headshot: true, severed: [], blocked: false },
    });
    step(0.1);
  }
  check('A burst into one head is one headshot to SLOWMO', !prog.isActive('slowmo'));

  // --- Score -----------------------------------------------------------------------------------
  fresh();
  kill();
  check('Base kill 100', prog.score === 100, prog.score);
  fresh();
  kill({ headshot: true });
  check('Headshot +50', prog.score === 150, prog.score);
  fresh();
  velocity.set(22, 0, 0);
  kill();
  check('Speed tier 1.5x at 20+ m/s', prog.score === 150, prog.score);
  fresh();
  for (let i = 0; i < 5; i++) {
    kill();
    step(1.3);
  }
  check('Combo tier applies from 5', prog.multiplier === 1.5, prog.multiplier);
  check('Tier arithmetic', prog.score === 100 * 4 + 150, prog.score);
  fresh();
  kill({ distance: 2 });
  check('Point blank bonus', prog.score === 150, prog.score);
  fresh();
  kill();
  kill();
  check('Double kill +100', prog.score === 100 + 200, prog.score);
  fresh();
  ctx.events.emit('wave:clear', { wave: 1, bonus: 500 });
  check('Wave clear bonus is unmultiplied', prog.score === 500, prog.score);
  fresh();
  hit(true);
  check('Non-lethal headshot pays +50', prog.score === 50 && prog.headshots === 1, prog.score);
  hit(true);
  check('Second enemy, same frame, counts', prog.headshots === 2, prog.headshots);

  // --- Targeting -------------------------------------------------------------------------------
  const press = (a: Action): void => {
    input.simulate(a, true);
    step(1 / 60);
    input.simulate(a, false);
    step(1 / 60);
  };

  fresh();
  prog.grantCallIn('airstrike');
  input.simulate('fire', true);
  step(0.1);
  press('streak');
  check('Key enters targeting', prog.targeting === 'airstrike');
  check('Gun holstered while targeting', holstered);
  step(0.2);
  check('Held button does not confirm', prog.targeting === 'airstrike');
  input.simulate('fire', false);
  step(0.05);
  press('aim');
  check('RMB cancels', prog.targeting === null);
  check('Cancel keeps the call-in', prog.callIns.has('airstrike'));
  step(0.5);
  check('Gun comes back after a cancel', !holstered);

  press('streak');
  forward.set(0, 1, 0);
  step(0.1);
  press('fire');
  check('Sky aim is rejected', prog.targeting === 'airstrike' && prog.callIns.has('airstrike'));
  forward.set(0, -0.5, -1).normalize();
  step(0.1);
  let used: { id: CallInId; position: THREE.Vector3 } | null = null;
  const offUsed = ctx.events.on('callin:used', e => { used = { id: e.id, position: e.position.clone() }; });
  const t0 = simTime;
  press('fire');
  offUsed();
  check('Fresh click confirms', prog.targeting === null && !prog.callIns.has('airstrike') && used !== null);
  check('Target is where the crosshair was', used !== null && near((used as { position: THREE.Vector3 }).position.z, -3.4, 0.2), used && (used as { position: THREE.Vector3 }).position.z);
  check('Cooldown runs', near(prog.callInCooldown?.('airstrike') ?? 0, 30, 0.1));

  step(3.9);
  check('No rockets before T+4', projectiles.length === 0, projectiles.length);
  step(1.6);
  check('15 rockets by T+5.5', projectiles.length === 15, projectiles.length);
  check('Rockets 100 ms apart', near(projectiles[14]!.at - projectiles[0]!.at, 1.4, 0.05), projectiles[14]!.at - projectiles[0]!.at);
  check('First rocket at T+4', near(projectiles[0]!.at - t0, 4, 0.06), projectiles[0]!.at - t0);
  const before = explosions.length;
  step(2.5);
  const finale = explosions.find(e => e.spec.instakill);
  check('Finale lands near T+7.1', !!finale && near(finale.at - t0, 7.08, 0.12), finale && finale.at - t0);
  check('Finale radius 20, player safe', finale?.spec.radius === 20 && finale.spec.selfDamage === 0, before);

  // --- Warthog ---------------------------------------------------------------------------------
  fresh();
  prog.grantCallIn('warthog');
  press('callinWarthog');
  step(0.05);
  const w0 = simTime;
  press('fire');
  step(4.2);
  check('Warthog waits for the drag gesture to end', projectiles.length > 0, projectiles.length);
  step(3);
  check('50 shells', projectiles.length === 50, projectiles.length);
  const shells = projectiles.map(p => p.at - w0);
  check('First shell at T+4', near(shells[0]!, 4, 0.06), shells[0]);
  check('Shells 50 ms apart, done by T+6.5', near(shells[49]!, 6.45, 0.08), shells[49]);
  check('Shells never hurt the player', projectiles.every(p => p.spec.explosion?.selfDamage === 0));

  fresh();
  prog.grantCallIn('warthog');
  press('callinWarthog');
  input.simulate('fire', true);
  step(0.05);
  check('Warthog click pins the corridor', prog.targeting === 'warthog');
  forward.set(1, -0.1, 0).normalize();
  step(0.05);
  input.simulate('fire', false);
  step(0.05);
  check('Warthog release confirms', prog.targeting === null && !prog.callIns.has('warthog'));
  step(4.6);
  const first = projectiles[0]!.spec.origin.clone();
  step(2.5);
  const lastShell = projectiles[projectiles.length - 1]!.spec.origin;
  const delta = lastShell.clone().sub(first);
  check('Dragged heading rules the run', Math.abs(delta.x) > Math.abs(delta.z), `${delta.x} ${delta.z}`);
  forward.set(0, -0.5, -1).normalize();

  // --- Reset -----------------------------------------------------------------------------------
  fresh();
  prog.grantCallIn('airstrike');
  press('streak');
  press('fire');
  prog.grant('hellfire');
  prog.grant('sentinels');
  kill();
  step(1);
  prog.reset?.();
  projectiles.length = 0;
  explosions.length = 0;
  step(10);
  check('reset() cancels pending strikes', projectiles.length === 0 && explosions.length === 0, `${projectiles.length} ${explosions.length}`);
  check('reset() clears effects, combo, score', prog.effects.length === 0 && prog.combo === 0 && prog.score === 0 && prog.kills === 0);
  check('reset() clears cooldowns and modifiers', prog.callInCooldown?.('airstrike') === 0 && weaponMods.damage === 1);

  // --- Everything grants and ends cleanly -------------------------------------------------------
  const all: (PerkId | PowerupId)[] = [
    'bloodthirst', 'hellfire', 'berserk', 'adrenaline', 'slowmo', 'sentinels', 'chainStorm', 'butcher', 'skyfall', 'chainReaction',
    'overdrive', 'quad', 'haste', 'vampire', 'ricochet', 'shock', 'ghost', 'magnet', 'regen', 'frostNova', 'timeWarp',
  ];
  fresh();
  for (const id of all) prog.grant(id);
  step(0.2);
  const running = prog.effects.length;
  step(25);
  check('Every effect grants and ends', running === all.length - 1 && prog.effects.length === 0, `${running} then ${prog.effects.length}`);
  check('Time scale back to 1', near(ctx.time.slowmo, 1, 0.001), ctx.time.slowmo);

  report(checks);
}

function report(checks: Check[]): void {
  const failed = checks.filter(k => !k.pass);
  (window as unknown as { __op2: unknown }).__op2 = {
    results: { total: checks.length, failed: failed.map(f => `${f.name}: ${f.detail}`) },
    stats: () => ({ total: checks.length, failed: failed.length }),
  };
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:0;margin:0;padding:18px;background:#0a0d12;color:#cfe8ff;font:12px/1.35 monospace;overflow:auto;z-index:99;columns:2';
  el.textContent = checks.map(k => `${k.pass ? 'ok  ' : 'FAIL'} ${k.name}${k.pass ? '' : `  [${k.detail}]`}`).join('\n')
    + `\n\n${checks.length - failed.length}/${checks.length} passed`;
  document.body.appendChild(el);
  console.log(`[progression] ${checks.length - failed.length}/${checks.length} passed`);
  for (const f of failed) console.error(`[progression] FAIL ${f.name}: ${f.detail}`);
}

async function live(params: URLSearchParams): Promise<void> {
  const { startGame } = await import('../core/Game');
  params.set('autostart', '1');
  await startGame(params);
  const g = window as unknown as { __op2: { ctx: Ctx }; __prog: unknown };
  const { progression } = g.__op2.ctx;
  const grant = (id: string): void => progression.grant(id as PerkId | PowerupId);
  const callIn = (id: string): void => progression.grantCallIn(id as CallInId);
  g.__prog = {
    grant,
    callIn,
    pickup: progression.spawnPickup.bind(progression),
    report: () => ({
      score: progression.score, combo: progression.combo, effects: progression.effects.map(e => e.id), held: [...progression.callIns],
      targeting: progression.targeting, pickups: progression.pickups.length,
    }),
  };
  (params.get('perk') ?? '').split(',').filter(Boolean).forEach(grant);
  (params.get('callin') ?? '').split(',').filter(Boolean).forEach(callIn);
}

export default async function progression(params: URLSearchParams): Promise<void> {
  if (params.get('mode') === 'game') await live(params);
  else await headless();
}
