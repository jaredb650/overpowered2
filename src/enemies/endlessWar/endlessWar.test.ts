/**
 * Endless War — Nonstop Combined-Arms Frontline Mode verification:
 *   1. Contract, menu, co-op, starter, and shop registration (`endless_war`).
 *   2. Uncapped Threat Escalation (`1 -> ∞`) and safe active entity caps.
 *   3. Destructible Strategic Facilities: damage, chain detonation, bounties, rebuild scaling.
 *   4. War Command Console reinforcements: credit deduction, cooldowns, Spearhead / Airborne /
 *      Air Wing / Artillery / Mobilize / FOB Overdrive.
 *   5. Infinite 4-second player redeploy while FOB Core stands vs Game Over once FOB falls.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CONTRACTS } from '../../contracts/data';
import { pickContract } from '../../contracts/select';
import { SHOP_CONTRACTS } from '../../contracts/shop/data';
import { defaultStarter, hasStarter } from '../../contracts/starter';
import { WORLD_MODES } from '../../net';
import { COOP_MODES } from '../../net/lobby';
import { SURVIVAL_MAPS, modesOn } from '../../ui/screens/mainmenu';
import {
  ENDLESS_WAR_BASTION_GATES,
  ENDLESS_WAR_FACILITIES,
  ENDLESS_WAR_FOB_MAX_HP,
  ENDLESS_WAR_PLAYER_SPAWN,
} from '../../world/map/endlessWar/plan';
import type { Ctx } from '../../core/contracts';
import type { EnemyManager } from '../EnemyManager';
import type { Outpost } from '../outpost';
import { BastionDefenseSystem } from './bastionDefense';
import { StrategicFacilitySystem } from './facilities';
import { FobDefenseSystem } from './fobDefense';
import { WarTacticalCommander } from './tacticalAi';
import { WAR_BOOSTS } from './warConsoleUi';
import {
  ENDLESS_WAR_MOMENTUM_SEC,
  ENDLESS_WAR_REDEPLOY_SEC,
  ENDLESS_WAR_THREAT_STEP_SEC,
  EndlessWarWaves,
  endlessWarEnemyCaps,
  endlessWarThreatLevel,
} from './waves';

function makeWarHarness(initialCredits = 10_000) {
  const scene = new THREE.Scene();
  const feeds: string[] = [];
  const awarded: { amount: number; reason: string }[] = [];
  const spawnedAllies: { type: string; at: THREE.Vector3 }[] = [];
  const spawnedEnemies: { id: string; at: THREE.Vector3 }[] = [];
  const spawnedGround: { kind: string }[] = [];
  const teleports: THREE.Vector3[] = [];
  const playerDamageCalls: unknown[] = [];
  const podCalls: THREE.Vector3[] = [];

  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const events = {
    on(name: string, fn: (payload: unknown) => void) {
      let set = listeners.get(name);
      if (!set) { set = new Set(); listeners.set(name, set); }
      set.add(fn);
      return () => { set?.delete(fn); };
    },
    emit(name: string, payload: unknown) {
      for (const fn of listeners.get(name) ?? []) fn(payload);
    },
  };

  const shop = { credits: initialCredits };
  const player = {
    alive: true,
    health: 100,
    maxHealth: 100,
    armor: 50,
    position: new THREE.Vector3(...ENDLESS_WAR_PLAYER_SPAWN),
    velocity: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: 0,
    teleport(pos: THREE.Vector3) {
      this.position.copy(pos);
      teleports.push(pos.clone());
    },
    heal(amount: number) {
      this.health = Math.min(this.maxHealth, this.health + amount);
    },
    reset() {
      this.alive = true;
      this.health = this.maxHealth;
    },
    takeDamage(d: unknown) {
      playerDamageCalls.push(d);
      this.alive = false;
    },
  };

  const vehicles = {
    live: [] as unknown[],
    extras: [] as unknown[],
    friendlyTargets: [] as unknown[],
    addExtra(t: unknown) { this.extras.push(t); },
    removeExtra(t: unknown) {
      const i = this.extras.indexOf(t);
      if (i >= 0) this.extras.splice(i, 1);
    },
    registerFriendlyTarget(t: unknown) { this.friendlyTargets.push(t); },
    setFriendlyVehicles: vi.fn(),
    spawnGround: vi.fn((kind: string) => { spawnedGround.push({ kind }); }),
    spawnChopper: vi.fn(),
    spawnTransport: vi.fn(),
    blast: vi.fn(),
  };

  const ctx = {
    time: { dt: 0.1, elapsed: 0 },
    events,
    render: {
      scene,
      lights: { flash: vi.fn() },
      materials: { patch: <T>(m: T) => m },
    },
    audio: { play: vi.fn() },
    fx: {
      explosion: vi.fn(),
      smoke: vi.fn(),
      sparks: vi.fn(),
      tracer: vi.fn(),
    },
    hud: {
      feed: (msg: string) => feeds.push(msg),
      follow: vi.fn(() => () => {}),
    },
    input: {
      pressed: () => false,
      labelFor: () => 'E',
    },
    player,
    world: {
      nav: { groundHeight: () => 0 },
    },
    contracts: { shop },
    progression: {
      award(amount: number, reason: string) { awarded.push({ amount, reason }); },
      pods: { call(at: THREE.Vector3) { podCalls.push(at.clone()); } },
      frame: { deployed: false, occupied: false, board: vi.fn(), deploy: vi.fn() },
    },
    allies: {
      allies: [] as unknown[],
      extraFoeProvider: null as unknown,
      spawn(type: string, at: THREE.Vector3, post?: THREE.Vector3) {
        const ally = {
          alive: true,
          expendable: false,
          detached: false,
          post: (post ?? at).clone(),
          body: { position: at.clone() },
          shotAt: vi.fn(),
        };
        this.allies.push(ally);
        spawnedAllies.push({ type, at: at.clone() });
        return ally;
      },
    },
    enemies: {
      vehicles,
      alive: [] as unknown[],
      applyDamage: vi.fn(),
    },
  } as unknown as Ctx;

  const aliveEnemies: unknown[] = [];
  const manager = {
    alive: aliveEnemies,
    vehicles,
    spawn(id: string, at: THREE.Vector3) {
      const e = { alive: true, id, position: at.clone(), maxHealth: 100 };
      aliveEnemies.push(e);
      spawnedEnemies.push({ id, at: at.clone() });
      return e;
    },
  } as unknown as EnemyManager;

  const adoptCalls: { at: THREE.Vector3; time: number }[] = [];
  const outpost = {
    w: { now: 1.0 },
    muster: vi.fn(() => {
      const members: { fighting: boolean; e: { position: THREE.Vector3 } }[] = [];
      return {
        id: 1,
        knownAt: -1,
        members,
        fighters: () => members.filter(m => m.fighting).length,
        adopt: vi.fn((at: THREE.Vector3, time: number) => {
          adoptCalls.push({ at: at.clone(), time });
        }),
      };
    }),
    enlistInto: vi.fn((sq: { members?: unknown[] }, id: string, at: THREE.Vector3) => {
      const e = manager.spawn(id as never, at);
      if (sq?.members && e) {
        sq.members.push({ fighting: true, e });
      }
      return e;
    }),
  } as unknown as Outpost;

  return {
    ctx,
    manager,
    outpost,
    shop,
    player,
    feeds,
    awarded,
    spawnedAllies,
    spawnedEnemies,
    spawnedGround,
    teleports,
    playerDamageCalls,
    podCalls,
    adoptCalls,
  };
}

describe('Endless War registration and pure scaling math', () => {
  it('registers endless_war across contracts, menu, co-op, shop, and starter rules', () => {
    const def = CONTRACTS.find(c => c.id === 'endless_war');
    expect(def).toBeDefined();
    expect(def!.map).toBe('endless_war');
    expect(def!.faction).toBe('humans');
    expect(def!.noCommander).toBe(true);
    expect(def!.locked).toBeUndefined();
    expect(pickContract('endless_war', null).map).toBe('endless_war');
    expect(pickContract(null, 'endless_war').def.id).toBe('endless_war');
    expect(SHOP_CONTRACTS).toContain('endless_war');
    expect(hasStarter('endless_war')).toBe(true);
    expect(defaultStarter('endless_war')).toBe('harrow');
    expect(SURVIVAL_MAPS.some(m => m.map === 'endless_war')).toBe(true);
    expect(modesOn('endless_war').map(c => c.id)).toEqual(['endless_war']);
    expect(COOP_MODES).toContain('endless_war');
    expect(WORLD_MODES).toContain('endless_war');
  });

  it('ramps Threat Level without cap and scales high-density active caps safely under Endless War cap (68)', () => {
    expect(endlessWarThreatLevel(0).level).toBe(1);
    expect(endlessWarThreatLevel(ENDLESS_WAR_THREAT_STEP_SEC).level).toBe(2);
    expect(endlessWarThreatLevel(ENDLESS_WAR_THREAT_STEP_SEC * 14).level).toBe(15);
    // Deep sabotage pressure accelerates enemy escalation
    expect(endlessWarThreatLevel(ENDLESS_WAR_THREAT_STEP_SEC - 20, 1).level).toBe(2);

    const t1 = endlessWarEnemyCaps(1);
    const t4 = endlessWarEnemyCaps(4);
    const t20 = endlessWarEnemyCaps(20);
    expect(t1.infantryCap).toBeGreaterThanOrEqual(38);
    expect(t1.groundVehCap).toBeGreaterThanOrEqual(6);
    expect(t1.chopperCap).toBe(0);
    expect(t1.jetCap).toBe(0);
    expect(t4.chopperCap).toBeGreaterThanOrEqual(1);
    expect(t4.jetCap).toBeGreaterThanOrEqual(1);
    expect(t20.infantryCap).toBeLessThanOrEqual(62);
    expect(t20.groundVehCap).toBeGreaterThanOrEqual(12);
    expect(t20.infantryInterval).toBeLessThan(t1.infantryInterval);
    expect(t20.armorInterval).toBeLessThan(t1.armorInterval);
  });
});

describe('StrategicFacilitySystem sabotage and rebuild lifecycle', () => {
  it('spawns all 5 facilities, awards bounties on sabotage, and rebuilds stronger after timer', () => {
    const h = makeWarHarness(500);
    const destroyed: string[] = [];
    const rebuilt: string[] = [];
    const sys = new StrategicFacilitySystem(h.ctx, {
      onDestroyed: p => destroyed.push(p.id),
      onRebuilt: p => rebuilt.push(p.id),
    });
    sys.init();

    expect(sys.getSnapshots()).toHaveLength(ENDLESS_WAR_FACILITIES.length);
    expect(sys.isAlive('fuel_depot')).toBe(true);

    const fuelPlan = ENDLESS_WAR_FACILITIES.find(f => f.id === 'fuel_depot')!;
    sys.damageById('fuel_depot', fuelPlan.maxHp + 100);

    expect(sys.isAlive('fuel_depot')).toBe(false);
    expect(sys.destroyedCount).toBe(1);
    expect(destroyed).toEqual(['fuel_depot']);
    expect(h.shop.credits).toBe(500 + fuelPlan.bounty);
    expect(h.awarded.some(a => a.amount === fuelPlan.bounty)).toBe(true);

    // Advance clock past rebuild time at Threat 6 -> facility returns with scaled HP
    sys.update(fuelPlan.rebuildSec + 5, 6);
    expect(sys.isAlive('fuel_depot')).toBe(true);
    expect(rebuilt).toEqual(['fuel_depot']);
    const snap = sys.getSnapshots().find(s => s.id === 'fuel_depot')!;
    expect(snap.maxHp).toBeGreaterThan(fuelPlan.maxHp);

    sys.dispose();
  });
});

describe('EndlessWarWaves director, War Command Console & FOB redeploy/loss', () => {
  it('seeds immediate combined-arms clash, drops permanent FOB supply pod, and triggers Momentum Surge on sabotage', () => {
    const h = makeWarHarness(5000);
    const dir = new EndlessWarWaves(h.ctx, h.outpost, h.manager);
    dir.init();
    dir.start();

    expect(h.spawnedAllies.length).toBeGreaterThanOrEqual(12);
    expect(h.spawnedEnemies.length).toBeGreaterThanOrEqual(15);
    expect(h.spawnedGround.length).toBeGreaterThanOrEqual(2);

    // First update drops the permanent FOB Procurement Supply Pod
    dir.update();
    expect(h.podCalls).toHaveLength(1);

    // Destroying a strategic facility triggers a 30 s Momentum Surge
    const artPlan = ENDLESS_WAR_FACILITIES.find(f => f.id === 'artillery_battery')!;
    dir.facilities.damageById('artillery_battery', artPlan.maxHp + 50);
    expect(dir.momentumLeft).toBeCloseTo(ENDLESS_WAR_MOMENTUM_SEC, 1);

    dir.dispose();
  });

  it('validates War Command Console boost costs, cooldowns, and FOB Overdrive heal', () => {
    const h = makeWarHarness(2000);
    const dir = new EndlessWarWaves(h.ctx, h.outpost, h.manager);
    dir.init();
    dir.start();

    const spearhead = WAR_BOOSTS.find(b => b.id === 'spearhead')!;
    // First order succeeds and deducts credits
    expect(dir.orderBoost('spearhead')).toBe(true);
    expect(h.shop.credits).toBe(2000 - spearhead.cost);
    expect(dir.boostsCalled).toBe(1);
    // Immediate repeat rejected by cooldown
    expect(dir.orderBoost('spearhead')).toBe(false);

    // FOB Overdrive heals damaged FOB Core
    dir.fob.takeDamage(6000);
    const damagedHp = dir.fob.hp;
    h.shop.credits = 2000;
    expect(dir.orderBoost('fob_overdrive')).toBe(true);
    expect(dir.fob.hp).toBeGreaterThan(damagedHp);
    expect(dir.fob.overdriveLeft).toBeGreaterThan(0);

    // Insufficient credits rejected
    h.shop.credits = 0;
    expect(dir.orderBoost('artillery')).toBe(false);

    dir.dispose();
  });

  it('redeploys the player infinitely at FOB Vanguard in 4 s while Core stands, then ends run when FOB Core falls', () => {
    const h = makeWarHarness(1000);
    const dir = new EndlessWarWaves(h.ctx, h.outpost, h.manager);
    dir.init();
    dir.start();

    // Player dies far north across the river while FOB Core is alive
    h.player.alive = false;
    h.player.position.set(12, 0, -180);
    expect(dir.redeploy()).toBe(true);
    expect(h.player.alive).toBe(false);

    // Advance 4.1 s -> player teleports back to FOB Vanguard at full health
    h.ctx.time.dt = ENDLESS_WAR_REDEPLOY_SEC + 0.1;
    dir.update();
    expect(h.player.alive).toBe(true);
    expect(h.teleports.length).toBe(1);
    expect(h.player.position.z).toBeCloseTo(ENDLESS_WAR_PLAYER_SPAWN[2], 1);

    // Now destroy the 25,000 HP FOB Core -> loss condition triggers, redeploy() returns false
    dir.fob.takeDamage(ENDLESS_WAR_FOB_MAX_HP + 500);
    expect(dir.fobLost).toBe(true);
    expect(dir.fob.alive).toBe(false);
    expect(h.playerDamageCalls.length).toBe(1);
    expect(dir.redeploy()).toBe(false);

    dir.dispose();
  });

  it('FobDefenseSystem tracks breach count and fires on approaching threats', () => {
    const h = makeWarHarness(0);
    let lost = false;
    const fob = new FobDefenseSystem(h.ctx, () => { lost = true; });
    fob.init();

    const breachedEnemy = {
      alive: true,
      position: new THREE.Vector3(0, 0, 265),
      maxHealth: 100,
    };
    fob.update(0.5, [breachedEnemy as never], [], []);
    expect(fob.breachedCount).toBe(1);
    expect(h.ctx.enemies.applyDamage).toHaveBeenCalled();
    expect(lost).toBe(false);

    fob.dispose();
  });
});

describe('BastionDefenseSystem Blast Gates and Iron Bastion AT turrets', () => {
  it('seals all 3 Iron Bastion gates, resists small arms, breaches on heavy ordnance, pays bounty, and rebuilds', () => {
    const h = makeWarHarness(500);
    const breached: string[] = [];
    const rebuilt: string[] = [];
    const bastion = new BastionDefenseSystem(h.ctx, {
      onGateBreached: p => breached.push(p.id),
      onGateRebuilt: p => rebuilt.push(p.id),
    });
    bastion.init();

    expect(bastion.getGateSnapshots()).toHaveLength(ENDLESS_WAR_BASTION_GATES.length);
    expect(bastion.isGateSealed('center')).toBe(true);
    expect(bastion.getSiegeTargets()).toHaveLength(3);

    // Small-arms chip deals only 25% damage
    const centerPlan = ENDLESS_WAR_BASTION_GATES.find(g => g.lane === 'center')!;
    bastion.damageGateByLane('center', 400, 'rifle', false);
    const afterChip = bastion.getGateSnapshots().find(g => g.lane === 'center')!;
    expect(afterChip.hp).toBe(centerPlan.maxHp - 100);
    expect(bastion.isGateSealed('center')).toBe(true);

    // Heavy explosive ordnance breaches the gate and awards bounty
    bastion.damageGateByLane('center', centerPlan.maxHp, 'tank_shell', true);
    expect(bastion.isGateSealed('center')).toBe(false);
    expect(breached).toEqual(['ew_gate_center']);
    expect(h.shop.credits).toBe(500 + centerPlan.bounty);
    expect(bastion.getSiegeTargets()).toHaveLength(2);

    // Bastion AT turrets engage friendly tanks breaching inside z < -250
    const intrudingTank = {
      alive: true,
      disposed: false,
      airborne: false,
      aimLift: 1.6,
      position: new THREE.Vector3(-42, 0, -270),
      takeDamage: vi.fn(),
    };
    bastion.update(1.5, 2, [intrudingTank as never], [], []);
    expect(intrudingTank.takeDamage).toHaveBeenCalled();

    // Advance timer past rebuildSec with doorway clear -> gate seals again stronger
    bastion.update(centerPlan.rebuildSec + 5, 4, [], [], []);
    expect(bastion.isGateSealed('center')).toBe(true);
    expect(rebuilt).toEqual(['ew_gate_center']);

    bastion.dispose();
  });
});

describe('WarTacticalCommander two-army intelligence, pacing & anti-armor combat', () => {
  it('actively marches enemy squads via adopt(), fields AT rocketeers on Threat 1, and holds friendly armor outside sealed Bastion gates', () => {
    const h = makeWarHarness(5000);
    const dir = new EndlessWarWaves(h.ctx, h.outpost, h.manager);
    dir.init();
    dir.start();

    // Enemy squads wake up & march immediately via adopt() (never sit idle in base!)
    expect(h.adoptCalls.length).toBeGreaterThanOrEqual(6);
    // Threat 1 squads include AT rocketeers from second 1
    expect(h.spawnedEnemies.some(e => e.id === 'rocketeer')).toBe(true);
    // All 3 Iron Bastion gates start sealed in AiVehicleFleet
    expect(dir.allyFleet.isGateOpen('ew_gate_center')).toBe(false);
    expect(dir.allyFleet.isGateOpen('ew_gate_west')).toBe(false);
    expect(dir.allyFleet.isGateOpen('ew_gate_east')).toBe(false);
    // Friendly armor spawns with combatHold & frontline holdNorthZ pacing
    for (const u of dir.allyFleet.units) {
      expect(u.combatHold).toBe(true);
      expect(u.holdNorthZ).not.toBeNull();
    }

    // Breaching the Center Blast Gate opens ew_gate_center for friendly armor & spawns QRF
    const beforeEnemies = h.spawnedEnemies.length;
    dir.bastion.damageGateByLane('center', 10_000, 'player', true);
    expect(dir.allyFleet.isGateOpen('ew_gate_center')).toBe(true);
    expect(h.spawnedEnemies.length).toBeGreaterThan(beforeEnemies);

    dir.dispose();
  });

  it('reacts to FOB & Iron Bastion intrusions, targets intruders with enemy air/AT, and stops troop trucks at the frontline', () => {
    const h = makeWarHarness(0);
    const cmd = new WarTacticalCommander();
    const fob = new FobDefenseSystem(h.ctx, () => {});
    const bastion = new BastionDefenseSystem(h.ctx);
    fob.init();
    bastion.init();

    // 1. Friendly tank breaching inside Iron Bastion walls -> enemy posture snaps to defend_bastion + air targets tank!
    const friendlyTank = {
      id: 'ally_mbt_1',
      alive: true,
      disposed: false,
      airborne: false,
      kind: 'aegis',
      role: 'ground',
      position: new THREE.Vector3(-140, 0, -278),
      asFoe: () => ({
        alive: true,
        center: new THREE.Vector3(-140, 1.6, -278),
        shotAt: vi.fn(),
        blast: vi.fn(),
      }),
    };
    const sit1 = cmd.evaluate(0.6, [], [friendlyTank as never], [], [], new THREE.Vector3(0, 0, 200), bastion);
    expect(sit1.enemyPosture).toBe('defend_bastion');
    expect(sit1.bastionBreachLane).toBe('west');
    expect(cmd.shouldTriggerBastionQrf()).toBe(true);

    const airTarget = cmd.pickEnemyAirStrikeTarget(null as never, [friendlyTank as never], new THREE.Vector3(0, 0, 200), 4);
    expect(airTarget).not.toBeNull();
    expect(airTarget!.z).toBeCloseTo(-278, 1);

    // 2. Enemy AT rocketeer resolves friendly tank as Foe; breaching soldier resolves FOB Core as Foe!
    const atSoldier = { e: { id: 'rocketeer', position: new THREE.Vector3(-135, 0, -255) } };
    const atFoe = cmd.resolveExtraFoe(atSoldier as never, [friendlyTank as never], fob);
    expect(atFoe).not.toBeNull();
    expect(atFoe!.center.z).toBeCloseTo(-278, 1);

    const breachingSoldier = { e: { id: 'trooper', position: new THREE.Vector3(6, 0, 310) } };
    const fobFoe = cmd.resolveExtraFoe(breachingSoldier as never, [], fob);
    expect(fobFoe).not.toBeNull();
    const hpBefore = fob.hp;
    fobFoe!.blast(fob.position, 5, 100, 0.1, 'enemy_rpg');
    expect(fob.hp).toBeLessThan(hpBefore);

    // 3. Enemy tank inside FOB Vanguard -> allied posture snaps to defend_fob!
    const enemyTank = {
      alive: true,
      retired: false,
      def: { kind: 'tank' },
      position: new THREE.Vector3(145, 0, 272),
    };
    const sit2 = cmd.evaluate(0.6, [], [], [], [enemyTank as never], null, bastion);
    expect(sit2.allyPosture).toBe('defend_fob');
    expect(sit2.fobBreachLane).toBe('east');

    // 4. Troop truck route stops near the active frontline, whereas enemy tank pushes all the way to FOB Vanguard
    const truckRoute = cmd.buildEnemyVehicleRoute('center', 'truck');
    const tankRoute = cmd.buildEnemyVehicleRoute('center', 'tank');
    expect(truckRoute[truckRoute.length - 1]!.z).toBeLessThan(220);
    expect(tankRoute[tankRoute.length - 1]!.z).toBeGreaterThan(300);

    fob.dispose();
    bastion.dispose();
  });
});

