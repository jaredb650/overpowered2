/**
 * Allies without a browser: the friendly rules both ways, the crosshair, the E key and revives. The game's systems are stood in
 * for by a context that records what was asked of it, so what is tested is what the allies' own code does.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import { ENEMIES } from '../enemies/data';
import { Ally } from './ally';
import { ALLY, ALLY_SOURCE, ALLY_TYPES } from './data';
import { AllyGuns } from './fire';
import { AllySystem } from './index';
import { Orders, type OrderHost } from './orders';
import { crosshairRead, followSlot, OrderKey, prefersAlly, revive, reviveCost, takeHit, type Vitals } from './rules';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function fakeChar() {
  const bones = Array.from({ length: 40 }, () => new THREE.Bone());
  return {
    archetype: 'trooper', root: new THREE.Object3D(), bones, rig: { height: 1.85 }, mesh: new THREE.Object3D(),
    anim: { play: vi.fn(), flinch: vi.fn(), setPosture: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() },
    hitFlash: vi.fn(), release: vi.fn(), setLod: vi.fn(),
  };
}

/** A context that records what it was asked. The player stands at the origin looking down -Z. */
function fakeCtx() {
  const player = {
    position: v(0, 0, 0), eye: v(0, 1.6, 0), forward: v(0, 0, -1), velocity: v(0, 0, 0), yaw: 0, alive: true, parked: false,
    takeDamage: vi.fn(),
  };
  const ctx = {
    time: { elapsed: 0, dt: 1 / 60, playerDt: 1 / 60 },
    player,
    physics: { raycast: vi.fn(() => null), radialListeners: new Set(), radialImpulse: vi.fn() },
    enemies: { raycast: vi.fn(() => null), applyDamage: vi.fn(), query: vi.fn(() => 0), outpost: null, vehicles: null },
    combat: { fireRay: vi.fn(), explode: vi.fn(), spawnProjectile: vi.fn() },
    gore: {
      wound: vi.fn(), ragdoll: vi.fn(),
      // A body is a 0.4 m ball round its chest.
      raycastCharacter: vi.fn((char: { root: THREE.Object3D }, o: THREE.Vector3, d: THREE.Vector3, max: number) => {
        const c = char.root.position.clone().setY(char.root.position.y + 1.2);
        const t = c.clone().sub(o).dot(d);
        if (t < 0 || t > max) return null;
        const p = o.clone().addScaledVector(d, t);
        return p.distanceTo(c) < 0.4 ? { distance: t, point: p, normal: v(0, 0, 1), bone: 5, region: 'chest' } : null;
      }),
    },
    fx: { sparks: vi.fn(), tracer: vi.fn(), muzzleFlash: vi.fn(), bloodHit: vi.fn(), impact: vi.fn(), explosion: vi.fn(), smoke: vi.fn() },
    audio: { play: vi.fn() },
    hud: { floatText: vi.fn(), feed: vi.fn(), follow: vi.fn(() => () => {}) },
    events: { on: vi.fn(), emit: vi.fn() },
    render: { materials: { patch: (m: unknown) => m }, scene: new THREE.Scene() },
    world: { nav: { nearest: () => false } },
    input: { pressed: vi.fn(() => false), isDown: vi.fn(() => false), labelFor: () => 'E' },
    progression: {},
  };
  return ctx;
}

/** A rifleman standing at `at`, put straight on the roster. */
function stand(sys: AllySystem, at: THREE.Vector3, ctx: ReturnType<typeof fakeCtx>): Ally {
  const a = new Ally();
  const char = fakeChar();
  char.root.position.copy(at);
  a.body.char = char as never;
  a.body.def = ENEMIES.trooper;
  a.body.position.copy(at);
  a.body.center.copy(at).setY(at.y + 1.2);
  a.def = ALLY_TYPES.rifleman;
  a.maxHealth = a.health = a.def.hp;
  sys.allies.push(a);
  void ctx;
  return a;
}

describe('rules', () => {
  it('stands followers behind the player, on both sides, between near and far', () => {
    const out = { x: 0, z: 0 };
    for (let i = 0; i < 8; i++) {
      followSlot(i, 8, 0, 0, 0, -1, out);
      // The player faces -Z, so behind is +Z.
      expect(out.z).toBeGreaterThan(0);
      const d = Math.hypot(out.x, out.z);
      expect(d).toBeGreaterThanOrEqual(ALLY.followNear - 1e-6);
      expect(d).toBeLessThanOrEqual(ALLY.followFar + 1e-6);
      if (i < 2) expect(Math.sign(out.x)).toBe(i === 0 ? -1 : 1);
    }
  });

  it('reads the crosshair: nearer body wins, a wall hides both, nothing hostile reads green', () => {
    expect(crosshairRead(10, Infinity, Infinity)).toBe('hostile');
    expect(crosshairRead(Infinity, 6, Infinity)).toBe('friendly');
    expect(crosshairRead(10, 6, Infinity)).toBe('friendly');
    expect(crosshairRead(6, 10, Infinity)).toBe('hostile');
    expect(crosshairRead(10, 6, 4)).toBeNull();
    expect(crosshairRead(Infinity, Infinity, Infinity)).toBeNull();
    // An enemy in front of an ally is never shown as a friend.
    for (let e = 1; e < 30; e += 3) for (let a = e + 0.5; a < 40; a += 4) expect(crosshairRead(e, a, Infinity)).toBe('hostile');
  });

  it('turns an enemy on an ally when the player is out of sight or further', () => {
    expect(prefersAlly(false, 10, 30)).toBe(true);
    expect(prefersAlly(true, 30, 10)).toBe(true);
    expect(prefersAlly(true, 10, 30)).toBe(false);
  });

  it('puts a man down before it kills him, and a dead man stays dead', () => {
    const m: Vitals = { health: 150, maxHealth: 150, state: 'up' };
    expect(takeHit(m, 100, false)).toBe('none');
    expect(takeHit(m, 100, false)).toBe('down');
    expect(m.health).toBeCloseTo(150 * ALLY.downPool);
    expect(revive(m)).toBe(true);
    expect(m.state).toBe('up');
    expect(m.health).toBeCloseTo(150 * ALLY.reviveHealth);
    expect(takeHit(m, 10, true)).toBe('down');
    expect(takeHit(m, 999, false)).toBe('dead');
    expect(revive(m)).toBe(false);
    expect(m.state).toBe('dead');
    const n: Vitals = { health: 150, maxHealth: 150, state: 'up' };
    expect(takeHit(n, 150 * ALLY.overwhelming, false)).toBe('dead');
  });

  it('prices a revive by the stims on hand', () => {
    expect(reviveCost(null)).toBe('free');
    expect(reviveCost({ count: 2 })).toBe('stim');
    expect(reviveCost({ count: 0 })).toBe('none');
  });

  it('tells a tap from a hold, and a revive needs the longer hold', () => {
    const k = new OrderKey();
    const dt = 1 / 60;
    expect(k.update(dt, true, true, false)).toBeNull();
    expect(k.update(dt, false, false, false)).toBe('tap');
    let got: string | null = null;
    k.update(dt, true, true, false);
    for (let t = 0; t < 1 && !got; t += dt) got = k.update(dt, false, true, false);
    expect(got).toBe('hold');
    // The key is still down after the hold: nothing more until it is pressed again.
    expect(k.update(dt, false, true, false)).toBeNull();
    expect(k.update(dt, false, false, false)).toBeNull();
    got = null;
    let t = 0;
    k.update(dt, true, true, true);
    for (; t < 2 && !got; t += dt) got = k.update(dt, false, true, true);
    expect(got).toBe('revive');
    expect(t).toBeGreaterThanOrEqual(ALLY.revive - 2 * dt);
    // Let go early on a downed man: nothing, not an order.
    k.update(dt, true, true, true);
    expect(k.update(dt, false, false, true)).toBeNull();
  });

  it('tags every ally source so nothing pays for it', () => {
    for (const t of Object.values(ALLY_TYPES)) expect(ALLY_SOURCE.test(t.gun.source)).toBe(true);
    expect(ALLY_SOURCE.test('smg')).toBe(false);
  });
});

describe('friendly fire', () => {
  it("the player's round passes through an ally: no damage, a green spark, CHECK FIRE", () => {
    const ctx = fakeCtx();
    const sys = new AllySystem(ctx as unknown as Ctx);
    const a = stand(sys, v(0, 0, -10), ctx);
    (sys as unknown as { checkFire(o: THREE.Vector3, d: THREE.Vector3): void }).checkFire(v(0, 1.2, 0), v(0, 0, -1));
    expect(a.health).toBe(a.maxHealth);
    expect(a.state).toBe('up');
    expect(ctx.enemies.applyDamage).not.toHaveBeenCalled();
    expect(ctx.fx.sparks).toHaveBeenCalledWith(expect.anything(), expect.anything(), 8, 0x3dff7a);
    expect(ctx.hud.floatText).toHaveBeenCalledWith(expect.anything(), 'CHECK FIRE', expect.any(String));
    // A second round inside the gap sparks but does not call it again.
    (sys as unknown as { checkFire(o: THREE.Vector3, d: THREE.Vector3): void }).checkFire(v(0, 1.2, 0), v(0, 0, -1));
    expect(ctx.hud.floatText).toHaveBeenCalledTimes(1);
  });

  it('the crosshair finds the ally, and not through a wall the caller tests', () => {
    const ctx = fakeCtx();
    const sys = new AllySystem(ctx as unknown as Ctx);
    stand(sys, v(0, 0, -10), ctx);
    const hit = sys.raycast(v(0, 1.2, 0), v(0, 0, -1), 250);
    expect(hit?.distance).toBeCloseTo(10, 0);
    expect(sys.raycast(v(0, 1.2, 0), v(1, 0, 0), 250)).toBeNull();
  });

  it("an ally's rounds test only the enemy: never the player, never another ally", () => {
    const ctx = fakeCtx();
    const sys = new AllySystem(ctx as unknown as Ctx);
    const shooter = stand(sys, v(0, 0, 0), ctx);
    const other = stand(sys, v(0, 0, -6), ctx);
    // The player well off the line.
    ctx.player.position.set(8, 0, 0);
    const guns = new AllyGuns(ctx as unknown as Ctx, () => {});
    expect(guns.fire(shooter, v(0, 1.2, -20), 1, 0)).toBe(true);
    expect(ctx.enemies.raycast).toHaveBeenCalled();
    expect(ctx.gore.raycastCharacter).not.toHaveBeenCalled();
    expect(ctx.player.takeDamage).not.toHaveBeenCalled();
    expect(ctx.combat.fireRay).not.toHaveBeenCalled();
    expect(other.health).toBe(other.maxHealth);
  });

  it('holds fire with the player in the line', () => {
    const ctx = fakeCtx();
    const sys = new AllySystem(ctx as unknown as Ctx);
    const shooter = stand(sys, v(0, 0, 0), ctx);
    ctx.player.position.set(0, 0, -8);
    const guns = new AllyGuns(ctx as unknown as Ctx, () => {});
    expect(guns.fire(shooter, v(0, 1.2, -20), 1, 0)).toBe(false);
    expect(ctx.enemies.raycast).not.toHaveBeenCalled();
  });

  it("an ally's rocket bursts on the enemy without the player's blast: no self damage, no push, no hit marker", () => {
    const ctx = fakeCtx();
    const sys = new AllySystem(ctx as unknown as Ctx);
    const r = stand(sys, v(0, 0, 0), ctx);
    r.def = ALLY_TYPES.rocketeer;
    const enemy = { alive: true, center: v(0, 1.2, -20), position: v(0, 0, -20) };
    ctx.enemies.query = vi.fn((_c: THREE.Vector3, _r: number, out: unknown[]) => {
      out[0] = enemy;
      return 1;
    }) as never;
    ctx.player.position.set(0, 0, -19);
    const guns = new AllyGuns(ctx as unknown as Ctx, () => {});
    // Fired from beside the line: the player stands next to the target and still takes nothing.
    ctx.player.position.set(3, 0, -19);
    expect(guns.fire(r, v(0, 1.2, -20), 0, 0)).toBe(true);
    guns.update(5);
    expect(ctx.enemies.applyDamage).toHaveBeenCalledWith(enemy, expect.objectContaining({ source: 'ally_rocket', type: 'explosive' }));
    expect(ctx.combat.explode).not.toHaveBeenCalled();
    expect(ctx.player.takeDamage).not.toHaveBeenCalled();
  });

  it("an enemy round at an ally hurts the ally, and only him", () => {
    const ctx = fakeCtx();
    const sys = new AllySystem(ctx as unknown as Ctx);
    const a = stand(sys, v(0, 0, -10), ctx);
    const shotAt = (sys as unknown as { shotAt(a: Ally, from: THREE.Vector3, d: number, m: number, s: string): void }).shotAt.bind(sys);
    // Point blank and steady: every round lands.
    for (let i = 0; i < 5; i++) shotAt(a, v(0, 1.2, -16), 7, 0, 'trooper');
    expect(a.health).toBeLessThan(a.maxHealth);
    expect(ctx.player.takeDamage).not.toHaveBeenCalled();
    expect(ctx.fx.tracer).toHaveBeenCalledTimes(5);
  });
});

describe('orders and revive', () => {
  function host(ally: Ally, stims: { count: number; spend(): boolean } | null): OrderHost & { toggles: number; squads: number; revives: number } {
    return {
      allies: [ally], stims, toggles: 0, squads: 0, revives: 0,
      toggle() { this.toggles++; },
      toggleSquad() { this.squads++; },
      playerRevive() { this.revives++; return true; },
    };
  }

  function addressed() {
    const ctx = fakeCtx();
    const a = new Ally();
    a.body.position.set(0, 0, -2);
    a.body.center.set(0, 1.4, -2);
    a.def = ALLY_TYPES.rifleman;
    a.maxHealth = a.health = 150;
    return { ctx, a };
  }

  /** Holds E for `seconds` at 60 Hz, then lets go. */
  function press(ctx: ReturnType<typeof fakeCtx>, orders: Orders, seconds: number): void {
    const dt = 1 / 60;
    ctx.time.playerDt = dt;
    ctx.input.pressed.mockReturnValueOnce(true);
    ctx.input.isDown.mockReturnValue(true);
    for (let t = 0; t <= seconds; t += dt) orders.update(dt);
    ctx.input.isDown.mockReturnValue(false);
    orders.update(dt);
  }

  it('a tap on the man in front sends him, a hold sends the squad', () => {
    const { ctx, a } = addressed();
    const h = host(a, null);
    const orders = new Orders(ctx as unknown as Ctx, h);
    press(ctx, orders, 0.1);
    expect(h.toggles).toBe(1);
    expect(h.squads).toBe(0);
    press(ctx, orders, 0.8);
    expect(h.squads).toBe(1);
    expect(h.toggles).toBe(1);
  });

  it('a hold reaches the squad with nobody in front, a tap does nothing', () => {
    const { ctx, a } = addressed();
    a.body.position.set(10, 0, 10);
    a.body.center.set(10, 1.4, 10);
    const h = host(a, null);
    const orders = new Orders(ctx as unknown as Ctx, h);
    press(ctx, orders, 0.1);
    expect(h.toggles).toBe(0);
    press(ctx, orders, 0.8);
    expect(h.squads).toBe(1);
  });

  it('a hold on a downed man is a revive, and nothing while the player sits in a seat', () => {
    const { ctx, a } = addressed();
    a.state = 'down';
    const h = host(a, { count: 1, spend: () => true });
    const orders = new Orders(ctx as unknown as Ctx, h);
    press(ctx, orders, 0.6);
    expect(h.revives).toBe(0);
    expect(h.squads).toBe(0);
    press(ctx, orders, ALLY.revive + 0.1);
    expect(h.revives).toBe(1);
    ctx.player.parked = true;
    press(ctx, orders, ALLY.revive + 0.1);
    expect(h.revives).toBe(1);
  });

  it('a revive by the player spends one stim, and without one he stays down', () => {
    const ctx = fakeCtx();
    const kit = { count: 1, spend() { if (this.count <= 0) return false; this.count--; return true; } };
    (ctx.progression as { stims?: unknown }).stims = kit;
    const sys = new AllySystem(ctx as unknown as Ctx);
    const a = stand(sys, v(0, 0, -3), ctx);
    sys.hurt(a, 200, a.body.center, v(0, 0, -1), undefined, 'chest', 'bullet', 'trooper');
    expect(a.state).toBe('down');
    expect(sys.playerRevive(a)).toBe(true);
    expect(kit.count).toBe(0);
    expect(a.state).toBe('up');
    expect(a.health).toBeCloseTo(a.maxHealth * ALLY.reviveHealth);
    sys.hurt(a, 200, a.body.center, v(0, 0, -1), undefined, 'chest', 'bullet', 'trooper');
    expect(a.state).toBe('down');
    expect(sys.playerRevive(a)).toBe(false);
    expect(a.state).toBe('down');
  });

  it('a dead ally cannot be revived', () => {
    const ctx = fakeCtx();
    const sys = new AllySystem(ctx as unknown as Ctx);
    const a = stand(sys, v(0, 0, -3), ctx);
    sys.hurt(a, a.maxHealth * ALLY.overwhelming, a.body.center, v(0, 0, -1), undefined, 'chest', 'explosive', 'rocketeer');
    expect(a.state).toBe('dead');
    expect(ctx.gore.ragdoll).toHaveBeenCalled();
    expect(sys.allies).not.toContain(a);
    expect(sys.playerRevive(a)).toBe(false);
  });
});
