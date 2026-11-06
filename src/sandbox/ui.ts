/**
 * HUD and menu sandbox. /?sandbox=ui&state=<state> or &screen=<screen>.
 * States: full, lowhealth, perks, boss, targeting, scope, long, clean. Screens: loading, splash, menu, guide, settings,
 * pause, gameover. A fake game drives the real HUD through the same ctx fields it reads in a run, over a painted
 * cold-and-hot scene so legibility gets tested against both a dark floor and a bright explosion.
 */
import * as THREE from 'three';
import { makeCtx, runLoop } from './harness';
import { createHud, type Hud } from '../ui';
import type { ActiveEffect, CallInId, EnemyId, EnemyInstance, PerkId, PowerupId, WeaponId } from '../core/gameplay';
import { EFFECTS } from '../progression/data';
import type { Action, Ctx, GameState } from '../core/contracts';
import { DEFAULT_BINDINGS } from '../input/bindings';

function paintScene(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const g = canvas.getContext('2d')!;
  const w = innerWidth;
  const h = innerHeight;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#6c8aa3');
  sky.addColorStop(0.55, '#3b5165');
  sky.addColorStop(1, '#1b2731');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#26343f';
  for (let i = 0; i < 16; i++) {
    const bw = w * (0.05 + 0.04 * ((i * 37) % 5));
    const bh = h * (0.18 + 0.05 * ((i * 53) % 7));
    g.fillRect((i / 16) * w, h * 0.62 - bh, bw, bh + h * 0.4);
  }
  g.fillStyle = '#12191f';
  g.fillRect(0, h * 0.72, w, h * 0.28);
  g.strokeStyle = '#7fe9ff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, h * 0.68);
  g.lineTo(w, h * 0.64);
  g.stroke();
  // Bright fire across the corners that hold HUD, because that is where legibility fails first.
  const blob = (x: number, y: number, r: number) => {
    const fire = g.createRadialGradient(x, y, 0, x, y, r);
    fire.addColorStop(0, '#fff6d0');
    fire.addColorStop(0.25, '#ffc838');
    fire.addColorStop(0.6, '#ff5a14');
    fire.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = fire;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(w * 0.13, h * 0.88, h * 0.26);
  blob(w * 0.86, h * 0.8, h * 0.24);
  blob(w * 0.62, h * 0.42, h * 0.16);
}

function fakeMinimap(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d151c';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#3a5262';
  g.lineWidth = 10;
  g.strokeRect(40, 40, 432, 432);
  g.lineWidth = 6;
  g.strokeStyle = '#2b3f4d';
  g.beginPath();
  g.arc(256, 256, 80, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#20303c';
  for (let i = 0; i < 26; i++) g.fillRect((i * 97) % 480, (i * 53) % 480, 34, 22);
  return c;
}

const effect = (id: PerkId | PowerupId, frac: number, stacks = 1): ActiveEffect => {
  const def = EFFECTS[id];
  const duration = def.seconds || 5;
  return { id, label: def.label, color: def.color, remaining: duration * frac, duration, stacks };
};

function enemy(id: EnemyId, x: number, z: number, y = 0, boss = false): EnemyInstance {
  const position = new THREE.Vector3(x, y, z);
  return {
    uid: (Math.abs(x * 31 + z * 17) | 0) + 1, id, position, center: position.clone().setY(y + 1), velocity: new THREE.Vector3(),
    yaw: 0, health: boss ? 6200 : 50, maxHealth: boss ? 10000 : 50, armor: boss ? 1800 : 0, alive: true, score: 100,
    isBoss: boss, frozen: 0, burning: 0, char: { severed: new Set(['armL', 'forearmL']) },
  } as unknown as EnemyInstance;
}

export default async function ui(params: URLSearchParams): Promise<void> {
  const state = params.get('state') ?? 'full';
  const screen = params.get('screen');
  paintScene();

  const camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, 1.7, 0);
  camera.updateMatrixWorld();

  const pressed = new Set<Action>();
  const fake = {
    locked: false,
    player: {
      position: new THREE.Vector3(0, 0, 0),
      eye: new THREE.Vector3(0, 1.7, 0),
      velocity: new THREE.Vector3(31, 0, 0),
      forward: new THREE.Vector3(0, 0, -1),
      health: 78, maxHealth: 100, armor: 60, grounded: false, sliding: false, wallRunning: false, dashing: false, alive: true,
      dashCharges: 1.4,
    },
    weapons: {
      current: 'smg' as WeaponId,
      owned: new Set<WeaponId>(['smg', 'shotgun', 'rocket', 'autocannon', 'sword', 'judge', 'lance']),
      reloading: false, reloadProgress: 0, scoped: false, grenades: 3, charge: 0, spread: 0,
      modifiers: { bottomlessMag: false },
      ammo: () => ({ mag: 22, magSize: 30, reserve: 240, maxReserve: 300 }),
    },
    progression: {
      score: 1204350, kills: 212, headshots: 61, highScore: 3480200, combo: 12, comboTimer: 0.64, multiplier: 3.5,
      effects: [] as ActiveEffect[], callIns: new Set<CallInId>(['airstrike', 'warthog']), targeting: null as CallInId | null,
    },
    waves: { wave: 7, phase: 'clearing', nextWaveIn: 0 },
    enemies: {
      alive: [] as EnemyInstance[], remaining: 23,
      raycast: () => null,
    },
  };

  const ctx = makeCtx({
    render: { camera, viewScene: new THREE.Scene(), post: {}, setQuality() {} } as unknown as Ctx['render'],
    input: {
      get locked() { return fake.locked; },
      isDown: () => false,
      pressed: (a: Action) => pressed.has(a),
      labelFor: (a: Action) => ({ streak: 'X', callinWarthog: 'Z', callinOrbital: 'V', callinBlackSun: 'B', callinNuke: 'N' } as Record<string, string>)[a] ?? a,
      requestLock: () => { fake.locked = true; },
      releaseLock: () => { fake.locked = false; },
      bindingsFor: (a: Action) => DEFAULT_BINDINGS[a],
      conflicts: () => [],
    } as unknown as Ctx['input'],
    player: fake.player as unknown as Ctx['player'],
    physics: { raycast: () => ({ distance: 142.4 }) } as unknown as Ctx['physics'],
    world: {
      zones: [],
      minimap: { image: fakeMinimap(), bounds: new THREE.Box3(new THREE.Vector3(-170, 0, -170), new THREE.Vector3(170, 0, 170)) },
    } as unknown as Ctx['world'],
    audio: { play() {}, playOneOf() {}, setVolumes() {}, unlock() {}, music() {} } as unknown as Ctx['audio'],
  });
  const ext = ctx as unknown as Record<string, unknown>;
  ext.weapons = fake.weapons;
  ext.progression = fake.progression;
  ext.waves = fake.waves;
  ext.enemies = fake.enemies;

  const hud: Hud = createHud(ctx);
  ctx.hud = hud;
  hud.init();

  const game = {
    state: 'menu' as GameState,
    setState(to: GameState) {
      const from = game.state;
      if (from === to) return;
      game.state = to;
      ctx.events.emit('game:state', { from, to });
    },
    newRun() {
      ctx.events.emit('run:start', {} as Record<string, never>);
      game.setState('playing');
    },
    clearRun() {},
  };

  runLoop(ctx, () => {
    hud.update();
    pressed.clear();
  });
  const op2 = window as unknown as { __op2: Record<string, unknown> };
  op2.__op2.game = game;
  op2.__op2.fake = fake;
  op2.__op2.hud = hud;

  const p = fake.progression;
  const pl = fake.player;
  const w = fake.weapons;

  fake.enemies.alive = [
    enemy('husk', 20, -30), enemy('husk', 26, -26), enemy('trooper', -30, -18), enemy('gunner', 10, 22), enemy('sniper', -44, -40, 12),
    enemy('drone', 4, -48, -9), enemy('husk', 50, 8), enemy('brute', -18, 34),
  ];

  game.newRun();

  const seedFeed = () => {
    hud.feed('Enemy eliminated +350');
    hud.feed('HEADSHOT +700', '#ffe500');
    hud.feed('AIRBORNE +1,050', '#ffb400');
    hud.feed('Health restored +25');
    hud.feed('MULTI KILL +500', '#ff5a14');
  };
  const seedWorld = () => {
    hud.floatText(new THREE.Vector3(3, 2, -9), '+700 HEADSHOT', '#ffe500');
    hud.floatText(new THREE.Vector3(-4, 1.5, -10), '+350');
    hud.marker(new THREE.Vector3(60, 4, -120), 'CACHE', '#ff5a14');
    hud.marker(new THREE.Vector3(-90, 2, 20), 'QUAD', '#4a7dff');
    hud.marker(new THREE.Vector3(30, 0, 100), 'MEGA', '#ffffff');
    hud.marker(new THREE.Vector3(-8, 0, -30), 'HASTE', '#ffe14a');
  };

  switch (state) {
    case 'clean':
      p.combo = 0;
      p.callIns.clear();
      fake.enemies.alive = [];
      pl.velocity.set(0, 0, 0);
      pl.armor = 0;
      pl.health = 100;
      pl.grounded = true;
      p.score = 0;
      fake.waves.wave = 1;
      fake.enemies.remaining = 12;
      break;
    case 'full':
      p.effects = [effect('bloodthirst', 0.74), effect('adrenaline', 0.5, 2), effect('quad', 0.6)];
      seedFeed();
      seedWorld();
      break;
    case 'lowhealth':
      pl.health = 14;
      pl.armor = 0;
      w.ammo = () => ({ mag: 4, magSize: 30, reserve: 12, maxReserve: 300 });
      seedFeed();
      break;
    case 'perks':
      p.effects = [
        effect('berserk', 0.8), effect('bloodthirst', 0.55), effect('hellfire', 0.42), effect('slowmo', 0.3),
        effect('adrenaline', 0.7, 3), effect('overdrive', 0.2), effect('chainStorm', 0.92), effect('vampire', 0.12),
      ];
      p.combo = 34;
      p.multiplier = 12;
      w.modifiers.bottomlessMag = true;
      break;
    case 'boss':
      fake.enemies.alive.push(enemy('titan', 0, -40, 0, true));
      fake.waves.wave = 10;
      fake.waves.phase = 'boss';
      p.combo = 5;
      p.multiplier = 1.5;
      seedFeed();
      break;
    case 'targeting':
      p.targeting = (params.get('callin') as CallInId) ?? 'airstrike';
      break;
    case 'scope':
      w.current = 'autocannon';
      w.scoped = true;
      w.ammo = () => ({ mag: 4, magSize: 5, reserve: 40, maxReserve: 60 });
      break;
    case 'long':
      p.score = 9999999;
      p.highScore = 99999990;
      p.combo = 128;
      p.multiplier = 24.5;
      p.effects = [
        effect('berserk', 0.8), effect('bloodthirst', 0.55), effect('hellfire', 0.42), effect('slowmo', 0.3),
        effect('adrenaline', 0.7, 3), effect('chainReaction', 0.2), effect('shock', 0.92), effect('chainStorm', 0.12),
      ];
      p.callIns = new Set(['airstrike', 'warthog', 'orbital', 'blackSun', 'nuke']);
      w.ammo = () => ({ mag: 300, magSize: 300, reserve: 9999, maxReserve: 9999 });
      w.grenades = 5;
      w.current = 'autocannon';
      fake.waves.wave = 99;
      fake.enemies.remaining = 148;
      pl.health = 200;
      pl.armor = 200;
      pl.velocity.set(58, 0, 0);
      for (let i = 0; i < 7; i++) hud.feed(`Very long kill feed line for testing truncation number ${i} +9,999,999`);
      for (let i = 0; i < 6; i++) hud.floatText(new THREE.Vector3(i - 3, 1, -10), '+9,999,999');
      ctx.events.emit('score:gain', { points: 9999999, reason: 'CHAIN REACTION', position: undefined });
      ctx.events.emit('score:gain', { points: 42000, reason: 'WALL RUN', position: undefined });
      ctx.events.emit('score:gain', { points: 700, reason: 'HEADSHOT', position: undefined });
      break;
    default:
      break;
  }

  if (state === 'full' || state === 'long') {
    ctx.events.emit('score:gain', { points: 1050, reason: 'AIRBORNE', position: undefined });
    ctx.events.emit('score:gain', { points: 700, reason: 'HEADSHOT', position: undefined });
  }

  if (screen) {
    if (screen !== 'pause') game.setState(screen === 'gameover' ? 'gameover' : 'menu');
    if (screen === 'gameover') {
      const r = hud.report;
      Object.assign(r, {
        score: 4812350, highAtStart: 3480200, kills: 412, headshots: 133, wave: 14, seconds: 1104, shots: 5120, hits: 3390,
        bestCombo: 58, bestMultiplier: 9, topSpeed: 52.6, limbs: 318, damageTaken: 2140, callIns: 7, killedBy: 'juggernaut',
      });
      r.weaponKills.set('smg', 180).set('shotgun', 96).set('rocket', 74).set('sword', 42).set('airstrike', 20);
      r.perks.set('bloodthirst', 9).set('hellfire', 4).set('berserk', 3).set('overdrive', 2).set('quad', 1);
    }
    if (screen === 'pause') {
      game.setState('paused');
      Object.assign(hud.report, { wave: 7, seconds: 402, kills: 212, headshots: 61, score: 1204350, shots: 2200, hits: 1400, bestCombo: 22, bestMultiplier: 4, topSpeed: 41.2, limbs: 88, damageTaken: 410, callIns: 2 });
    }
    hud.showScreen(screen as never);
    if (screen === 'loading') hud.loading(0.62, 'Walking the floors');
  }
}
