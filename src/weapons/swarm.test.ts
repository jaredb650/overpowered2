/**
 * The Quiver: painting marks, filling a salvo, how a missile steers and what it does when its mark dies. The pure rules
 * first, then the real Weapons, Combat and Projectiles on the test range.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MissileTarget } from '../core/gameplay';
import { TUNING, WEAPONS } from './data';
import { Painter, angleOff, heavy, nextMark, retarget, stackOn, turnToward, weave, type PaintCandidate } from './swarm';
import { makeRange, type Dummy, type Range } from './testkit';
import { ROCKET_LASER } from './laser';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const target = (x: number, z: number, extra: Partial<MissileTarget> = {}): MissileTarget & { alive: boolean } =>
  ({ center: v(x, 1.2, z), alive: true, ...extra }) as MissileTarget & { alive: boolean };
const seen = (...list: [MissileTarget, number][]): PaintCandidate[] => list.map(([t, angle]) => ({ target: t, angle }));
const T = TUNING.quiver;

describe('painting rules', () => {
  it('measures a target off the crosshair, inside the cone and the reach only', () => {
    const eye = v(0, 1, 0);
    const fwd = v(0, 0, -1);
    const cos = Math.cos(T.cone);
    expect(angleOff(eye, fwd, v(0, 1, -20), T.range, cos)).toBeCloseTo(0, 5);
    expect(angleOff(eye, fwd, v(2, 1, -20), T.range, cos)).toBeCloseTo(Math.atan2(2, 20), 3);
    // Outside the cone, behind, and past the reach.
    expect(angleOff(eye, fwd, v(8, 1, -20), T.range, cos)).toBe(-1);
    expect(angleOff(eye, fwd, v(0, 1, 20), T.range, cos)).toBe(-1);
    expect(angleOff(eye, fwd, v(0, 1, -(T.range + 1)), T.range, cos)).toBe(-1);
  });

  it('marks the unmarked target nearest the crosshair first', () => {
    const a = target(0, -20);
    const b = target(1, -20);
    const c = target(-2, -20);
    const view = seen([b, 0.05], [a, 0.0], [c, 0.1]);
    expect(nextMark([], view)).toBe(a);
    expect(nextMark([a], view)).toBe(b);
    expect(nextMark([a, b], view)).toBe(c);
  });

  it('with nobody new in view, stacks on a boss or a vehicle first, then on the one nearest the crosshair', () => {
    const near = target(0, -20);
    const far = target(3, -20);
    expect(nextMark([near, far], seen([near, 0.01], [far, 0.12]))).toBe(near);
    const boss = target(3, -20, { isBoss: true });
    expect(nextMark([near, boss], seen([near, 0.01], [boss, 0.12]))).toBe(boss);
    const tank = target(3, -20, { paintRadius: 3 });
    expect(heavy(tank)).toBe(true);
    expect(stackOn([near, tank], seen([near, 0.01], [tank, 0.12]))).toBe(tank);
    // A marked target that has gone behind a wall is not in view, so it takes no spare.
    expect(stackOn([near, far], seen([far, 0.12]))).toBe(far);
    expect(stackOn([near], [])).toBeNull();
  });

  it('a tap leaves no mark; holding lays one every paintEvery, up to the salvo', () => {
    const p = new Painter(0.2);
    const a = target(0, -20);
    const b = target(1, -20);
    const look = () => seen([a, 0], [b, 0.05]);
    p.begin(4);
    expect(p.update(0.1, look)).toBeNull();
    expect(p.marks).toEqual([]);
    expect(p.update(0.1, look)).toBe(a);
    expect(p.update(0.1, look)).toBeNull();
    expect(p.update(0.1, look)).toBe(b);
    // Two targets, four marks: the spares stack on the one nearest the crosshair.
    p.update(0.2, look);
    p.update(0.2, look);
    expect(p.marks).toEqual([a, b, a, a]);
    expect(p.full).toBe(true);
    expect(p.update(0.2, look)).toBeNull();
    expect(p.marks.length).toBe(4);
  });

  it('a mark is paid for by time held, not by frame rate', () => {
    for (const fps of [30, 60, 144]) {
      const p = new Painter(0.2);
      const a = target(0, -20);
      p.begin(4);
      let held = 0;
      while (!p.full) {
        p.update(1 / fps, () => seen([a, 0]));
        held += 1 / fps;
      }
      expect(held, `${fps} fps`).toBeGreaterThan(0.79);
      expect(held, `${fps} fps`).toBeLessThan(0.81 + 1 / fps);
    }
  });

  it('waits with nothing in view and paints on the first frame someone shows', () => {
    const p = new Painter(0.2);
    const a = target(0, -20);
    let view: PaintCandidate[] = [];
    p.begin(4);
    p.update(1, () => view);
    expect(p.marks.length).toBe(0);
    view = seen([a, 0]);
    expect(p.update(1 / 60, () => view)).toBe(a);
  });

  it('drops a mark whose target died, which frees the place', () => {
    const p = new Painter(0.2);
    const a = target(0, -20);
    const b = target(1, -20);
    p.begin(2);
    p.update(0.2, () => seen([a, 0], [b, 0.05]));
    p.update(0.2, () => seen([a, 0], [b, 0.05]));
    expect(p.marks).toEqual([a, b]);
    a.alive = false;
    p.update(0.01, () => seen([b, 0.05]));
    expect(p.marks).toEqual([b]);
  });

  it('release fills every missile: the marks in order, then the spares, or nothing for a dumb salvo', () => {
    const p = new Painter(0.2);
    const a = target(0, -20);
    const boss = target(2, -20, { isBoss: true });
    const out: (MissileTarget | null)[] = [];
    p.begin(4);
    p.update(0.2, () => seen([a, 0], [boss, 0.1]));
    p.update(0.2, () => seen([a, 0], [boss, 0.1]));
    // Let go after two marks: the two spares go on the boss.
    expect(p.release(out, 4, seen([a, 0], [boss, 0.1]))).toBe(4);
    expect(out).toEqual([a, boss, boss, boss]);
    expect(p.painting).toBe(false);
    expect(p.marks.length).toBe(0);

    p.begin(4);
    p.update(0.05, () => seen([a, 0]));
    expect(p.release(out, 4, seen([a, 0]))).toBe(0);
    expect(out).toEqual([null, null, null, null]);

    // A mark that died before the release is not fired at; the one left takes the salvo.
    p.begin(4);
    p.update(0.2, () => seen([a, 0], [boss, 0.1]));
    p.update(0.2, () => seen([a, 0], [boss, 0.1]));
    a.alive = false;
    expect(p.release(out, 4, seen([boss, 0.1]))).toBe(4);
    expect(out).toEqual([boss, boss, boss, boss]);
  });
});

describe('steering', () => {
  it('turns the nose no faster than the turn rate and keeps the speed', () => {
    const vel = v(0, 0, -50);
    const want = v(1, 0, 0);
    const left = turnToward(vel, want, 0.1);
    expect(vel.length()).toBeCloseTo(50, 6);
    expect(vel.clone().normalize().angleTo(v(0, 0, -1))).toBeCloseTo(0.1, 6);
    expect(left).toBeCloseTo(Math.PI / 2 - 0.1, 6);
    // Inside one step it lands on the line exactly.
    const close = v(0, 0, -50);
    expect(turnToward(close, v(0.05, 0, -1).normalize(), 0.1)).toBe(0);
    expect(close.clone().normalize().angleTo(v(0.05, 0, -1))).toBeLessThan(1e-6);
    // Straight behind still turns, about any axis.
    const back = v(0, 0, -50);
    turnToward(back, v(0, 0, 1), 0.2);
    expect(back.clone().normalize().angleTo(v(0, 0, -1))).toBeCloseTo(0.2, 5);
  });

  it('a missile whose mark died takes the nearest live target ahead, never one behind', () => {
    const at = v(0, 1, 0);
    const heading = v(0, 0, -40);
    const ahead = target(2, -15);
    const nearer = target(-1, -8);
    const behind = target(0, 4);
    const dead = target(0, -3);
    dead.alive = false;
    expect(retarget(at, heading, [ahead, nearer, behind, dead], T.retargetRange)).toBe(nearer);
    expect(retarget(at, heading, [ahead, behind], T.retargetRange)).toBe(ahead);
    expect(retarget(at, heading, [behind, dead], T.retargetRange)).toBeNull();
    expect(retarget(at, heading, [target(0, -80)], T.retargetRange)).toBeNull();
  });

  it('weaves either side of the line by no more than it is given', () => {
    const base = v(0.3, -0.1, -1).normalize();
    let most = 0;
    for (let phase = 0; phase < 12; phase += 0.1) {
      const d = weave(base.clone(), phase, 0.2);
      expect(d.length()).toBeCloseTo(1, 6);
      most = Math.max(most, d.angleTo(base));
    }
    expect(most).toBeGreaterThan(0.1);
    expect(most).toBeLessThan(0.27);
    expect(weave(base.clone(), 1, 0).angleTo(base)).toBe(0);
  });
});

describe('the Quiver in the weapon system', () => {
  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
    r.weapons.give('rocket');
    r.weapons.give('quiver');
  });
  const draw = () => {
    r.tap('weapon3');
    r.run(0.4);
    r.tap('weapon3');
    r.run(0.5);
    expect(r.weapons.current).toBe('quiver');
  };
  const missiles = () => r.combat.projectiles.active.filter(p => p.source === 'quiver');
  const hitsBy = (d: Dummy) => d.hits.filter(h => h.source === 'quiver');
  const hold = (seconds: number) => {
    r.input.simulate('fire', true);
    r.run(seconds);
    r.input.simulate('fire', false);
  };

  it('is bought separately from the rocket, on key 3, with its own four rounds', () => {
    expect(r.weapons.owned.has('quiver')).toBe(true);
    expect(r.weapons.ammo('quiver').mag).toBe(4);
    draw();
    expect(r.weapons.ammo('rocket').mag).toBe(WEAPONS.rocket.magSize);
  });

  it('paints four targets one after another, then fires four missiles a tube apart, each on its own mark', () => {
    const marks = [r.enemies.add(-3, -30), r.enemies.add(-1, -30), r.enemies.add(1, -30), r.enemies.add(3, -30)];
    draw();
    r.input.simulate('fire', true);
    r.run(T.paintEvery * 4 + 0.05);
    const paint = r.weapons.paint!;
    expect(paint.painting).toBe(true);
    expect(new Set(paint.marks).size).toBe(4);
    expect(r.record.sounds.filter(s => s === 'quiver_lock').length).toBe(4);
    expect(r.record.sounds).toContain('quiver_full');
    expect(missiles().length).toBe(0);

    // Let go. The four leave over three intervals.
    r.input.simulate('fire', false);
    r.run(1 / 60);
    expect(missiles().length).toBe(1);
    r.run(WEAPONS.quiver.interval * 3 + 0.02);
    expect(missiles().length).toBe(4);
    expect(r.weapons.ammo('quiver').mag).toBe(0);
    expect(r.record.sounds.filter(s => s === 'quiver_fire').length).toBe(4);
    expect(new Set(missiles().map(p => p.target)).size).toBe(4);

    r.run(2.5);
    for (const d of marks) expect(hitsBy(d).length, `dummy at ${d.position.x}`).toBeGreaterThan(0);
  });

  it('with one target in view, all four marks and all four missiles go on it', () => {
    const lone = r.enemies.add(0, -25);
    draw();
    hold(T.paintEvery * 4 + 0.05);
    r.run(0.4);
    expect(new Set(missiles().map(p => p.target))).toEqual(new Set([lone]));
    r.run(2.5);
    // Each missile lands a direct hit and its blast.
    expect(hitsBy(lone).filter(h => h.type === 'explosive').length).toBeGreaterThanOrEqual(4);
  });

  it('a tap fires all four straight, in a loose spread, at nobody', () => {
    // Off to the side, so none of the four is stopped before they are counted.
    r.enemies.add(30, -25);
    draw();
    r.tap('fire');
    r.run(0.5);
    const m = missiles();
    expect(m.length).toBe(4);
    expect(m.every(p => p.target === null)).toBe(true);
    const dirs = m.map(p => p.velocity.clone().normalize());
    let widest = 0;
    for (const a of dirs) for (const b of dirs) widest = Math.max(widest, a.angleTo(b));
    expect(widest).toBeGreaterThan(0.02);
    expect(widest).toBeLessThan(0.3);
  });

  it('a dumb missile weaves about the line it left on and does not wander off it', () => {
    r.enemies.add(30, -25);
    draw();
    r.tap('fire');
    r.run(0.05);
    const first = missiles()[0]!;
    const line = first.line.clone();
    let worst = 0;
    for (let i = 0; i < 90; i++) {
      r.run(1 / 60);
      if (!first.live) break;
      worst = Math.max(worst, first.velocity.clone().normalize().angleTo(line));
    }
    expect(worst).toBeLessThan(T.weave * 0.6);
  });

  it('a guided missile\'s fuse is for its own mark; a plain rocket\'s still goes off on anyone it skims', () => {
    // Straight down -Z past a bystander 0.9 m off the line: outside a direct hit, inside the near-miss fuse.
    const fly = (guided: boolean) => {
      r.reset();
      const mark = r.enemies.add(0, -40);
      const bystander = r.enemies.add(0.9, -15);
      r.combat.spawnProjectile({
        origin: new THREE.Vector3(0, 1.2, -2), velocity: new THREE.Vector3(0, 0, -50), kind: 'rocket', team: 'player',
        damage: 100, source: 'test', explosion: { radius: 1, damage: 50, kind: 'rocket' },
        ...(guided ? { target: mark, turnRate: 0.001, steerDelay: 99 } : {}),
      });
      r.run(1.2);
      return { mark: mark.hits.length, bystander: bystander.hits.length, at: r.record.blasts.map(b => Math.round(b.z)) };
    };
    const guided = fly(true);
    expect(guided.bystander).toBe(0);
    expect(guided.mark).toBeGreaterThan(0);
    expect(guided.at.length).toBe(1);
    expect(Math.abs(guided.at[0]! + 40)).toBeLessThanOrEqual(1.5);
    // The plain rocket's near-miss fuse goes off beside the bystander, as it always has.
    const plain = fly(false);
    expect(plain.mark).toBe(0);
    expect(plain.at.length).toBe(1);
    expect(Math.abs(plain.at[0]! + 15)).toBeLessThanOrEqual(1);
  });

  it('turns onto a mark well off the line it left on', () => {
    const side = r.enemies.add(9, -40);
    draw();
    // Face it, paint it, then let go facing straight ahead: every missile has to come round.
    r.player.forward.set(9, 0.2, -40).normalize();
    hold(T.paintEvery + 0.05);
    r.player.forward.set(0, 0, -1);
    r.run(3);
    expect(hitsBy(side).length).toBeGreaterThan(0);
  });

  it('a missile whose mark dies flies on to the nearest live enemy ahead', () => {
    const first = r.enemies.add(0, -40);
    const second = r.enemies.add(4, -32);
    draw();
    // Paint only the first: the second is outside the cone while the trigger is held.
    r.player.forward.set(-0.6, 0, -40).normalize();
    hold(T.paintEvery + 0.05);
    r.run(0.5);
    expect(missiles().every(p => p.target === first)).toBe(true);
    first.alive = false;
    r.run(2.5);
    expect(hitsBy(second).length).toBeGreaterThan(0);
    expect(hitsBy(first).length).toBe(0);
  });

  it('cannot paint through a wall', () => {
    r.wall(-10, 1);
    r.enemies.add(0, -25);
    draw();
    r.input.simulate('fire', true);
    r.run(1);
    expect(r.weapons.paint!.marks.length).toBe(0);
    r.input.simulate('fire', false);
  });

  it('right click lets go of the marks and keeps the missiles', () => {
    r.enemies.add(0, -25);
    draw();
    r.input.simulate('fire', true);
    r.run(0.5);
    r.tap('aim');
    r.input.simulate('fire', false);
    r.run(0.5);
    expect(missiles().length).toBe(0);
    expect(r.weapons.ammo('quiver').mag).toBe(4);
    expect(r.record.sounds).toContain('quiver_cancel');
  });

  it('reloads all four tubes in one reload, after the salvo is gone', () => {
    draw();
    r.tap('fire');
    r.run(0.2);
    expect(r.weapons.reloading).toBe(false);
    r.run(0.4);
    expect(r.weapons.reloading).toBe(true);
    r.run(WEAPONS.quiver.reloadTime + 0.1);
    expect(r.weapons.ammo('quiver').mag).toBe(4);
    expect(r.weapons.ammo('quiver').reserve).toBe(WEAPONS.quiver.reserve - 4);
  });

  it('a salvo on one target outweighs three rockets, from four blasts each smaller than the rocket\'s', () => {
    expect(T.radius).toBeLessThan(TUNING.rocket.radius);
    const lone = r.enemies.add(0, -25);
    draw();
    hold(T.paintEvery * 4 + 0.05);
    r.run(3);
    const dealt = hitsBy(lone).reduce((n, h) => n + h.amount, 0);
    expect(dealt).toBeGreaterThan(WEAPONS.rocket.damage * 2 * 3);
  });

  it('right click braids four unguided rockets around one flight line and converges on the aimed body', () => {
    r.enemies.add(0, -25);
    draw();
    r.tap('aim');
    const m = missiles();
    expect(m.length).toBe(4);
    expect(r.weapons.ammo('quiver').mag).toBe(0);
    expect(r.weapons.paint!.marks.length).toBe(0);
    expect(m.every(p => p.target === null && p.weave === 0)).toBe(true);
    // Across the line of flight (-Z) the four sit on the corners of a square `square` a side.
    const corners = () => m.map(p => `${Math.sign(Math.round(p.position.x * 10))},${Math.sign(Math.round((p.position.y - 1) * 10))}`).sort();
    expect(corners()).toEqual(['-1,-1', '-1,1', '1,-1', '1,1']);
    const start = m[0]!.helixOffset.clone();
    expect(m.every(p => p.helix?.pitch === T.helixPitch)).toBe(true);
    r.run(0.15);
    expect(m[0]!.helixOffset.angleTo(start)).toBeGreaterThan(0.5);
    const centre = m.reduce((sum, rocket) => sum.add(rocket.position), new THREE.Vector3()).multiplyScalar(0.25);
    expect(centre.x).toBeCloseTo(0, 5);
    expect(centre.y).toBeCloseTo(1, 5);
    const radii = m.map(p => Math.hypot(p.position.x, p.position.y - 1));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0]!, 5);
    expect(radii[0]).toBeLessThanOrEqual(T.helixRadius);
    r.run(1);
    expect(r.record.explosions).toBe(4);
    expect(missiles()).toHaveLength(0);
  });

  it('right click with two tubes loaded fires the two', () => {
    draw();
    r.weapons.ammo('quiver').mag = 2;
    r.tap('aim');
    expect(missiles().length).toBe(2);
    expect(r.weapons.ammo('quiver').mag).toBe(0);
  });
});

describe('the Rocket\'s laser', () => {
  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
    r.weapons.give('rocket');
    r.tap('weapon3');
    r.run(0.5);
    expect(r.weapons.current).toBe('rocket');
  });
  const rockets = () => r.combat.projectiles.active.filter(p => p.source === 'rocket');

  it('has no sights: right click toggles the laser, with a click, and the view stays as it is', () => {
    expect(WEAPONS.rocket.ads).toBeUndefined();
    r.tap('aim');
    expect(ROCKET_LASER.sight).toBe(true);
    expect(ROCKET_LASER.on).toBe(true);
    expect(r.record.sounds).toContain('rocket_laser');
    r.run(0.4);
    expect(r.weapons.aim).toBe(0);
    r.tap('aim');
    expect(ROCKET_LASER.sight).toBe(false);
    expect(ROCKET_LASER.on).toBe(false);
  });

  it('the dot sits where the crosshair meets the first wall', () => {
    r.wall(-30, 1);
    r.tap('aim');
    expect(ROCKET_LASER.at.z).toBeCloseTo(-29.5, 0);
  });

  it('a rocket in flight turns toward where the crosshair points now, no faster than its turn rate', () => {
    r.tap('aim');
    r.tap('fire');
    const p = rockets()[0]!;
    const start = p.velocity.clone().normalize();
    // Swing the aim hard right: the rocket comes round in an arc, not at once.
    r.player.forward.set(1, 0, -1).normalize();
    r.run(0.1);
    const turned = p.velocity.clone().normalize().angleTo(start);
    expect(turned).toBeGreaterThan(0.05);
    expect(turned).toBeLessThanOrEqual(TUNING.rocket.laserTurn * 0.15 + 1e-3);
    r.run(0.8);
    expect(p.velocity.x).toBeGreaterThan(0);
    // Heading for the dot down the new line.
    const want = ROCKET_LASER.at.clone().sub(p.position).normalize();
    expect(p.velocity.clone().normalize().angleTo(want)).toBeLessThan(0.15);
  });

  it('with the laser off it flies straight, and switching off or putting the launcher away leaves a rocket on its line', () => {
    r.tap('fire');
    const p = rockets()[0]!;
    r.player.forward.set(1, 0, -1).normalize();
    r.run(0.3);
    expect(p.velocity.x).toBeCloseTo(0, 5);

    r.player.forward.set(0, 0, -1);
    r.run(WEAPONS.rocket.reloadTime + 0.5);
    r.tap('aim');
    r.tap('fire');
    const q = rockets().find(x => x !== p)!;
    r.tap('aim');
    r.player.forward.set(1, 0, -1).normalize();
    r.run(0.3);
    expect(q.velocity.x).toBeCloseTo(0, 5);

    // The sight is still up, but a launcher put away guides nothing.
    r.player.forward.set(0, 0, -1);
    r.run(WEAPONS.rocket.reloadTime + 0.5);
    r.tap('aim');
    r.tap('fire');
    const w = rockets().find(x => x !== p && x !== q)!;
    expect(w).toBeDefined();
    r.run(0.05);
    r.tap('weapon1');
    r.player.forward.set(1, 0, -1).normalize();
    r.run(0.3);
    expect(ROCKET_LASER.sight).toBe(true);
    expect(ROCKET_LASER.on).toBe(false);
    expect(w.velocity.x).toBeCloseTo(0, 5);
  });
});

describe('the Thresher', () => {
  let r: Range;
  beforeEach(async () => {
    r = await makeRange();
    r.reset();
    r.weapons.give('thresher');
  });
  const draw = () => {
    r.tap('weapon2');
    r.run(0.4);
    r.tap('weapon2');
    r.run(0.5);
    expect(r.weapons.current).toBe('thresher');
  };

  it('is bought separately from the shotgun on key 2 and fires five shells a second, held', () => {
    expect(r.weapons.owned.has('thresher')).toBe(true);
    const d = r.enemies.add(0, -8);
    draw();
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    const shells = WEAPONS.thresher.magSize - r.weapons.ammo('thresher').mag;
    expect(shells).toBeGreaterThanOrEqual(5);
    expect(shells).toBeLessThanOrEqual(6);
    expect(d.hits.filter(h => h.source === 'thresher').length).toBeLessThanOrEqual(shells * WEAPONS.thresher.pellets);
  });

  it('holds twenty, and the pump stays the harder single hit', () => {
    expect(WEAPONS.thresher.magSize).toBe(20);
    const shell = (id: 'shotgun' | 'thresher') => WEAPONS[id].pellets * WEAPONS[id].damage;
    expect(shell('thresher')).toBeLessThan(shell('shotgun'));
    expect(WEAPONS.thresher.reloadTime).toBeGreaterThan(WEAPONS.shotgun.reloadTime * 1.5);
  });

  it('climbs: a burst walks the aim up for the player to pull down', () => {
    draw();
    const before = r.player.pitch;
    r.input.simulate('fire', true);
    r.run(1);
    r.input.simulate('fire', false);
    expect(r.player.pitch - before).toBeGreaterThan(WEAPONS.thresher.climb!.pitch * 4);
    expect(r.player.pitch - before).toBeLessThan(0.12);
  });
});
