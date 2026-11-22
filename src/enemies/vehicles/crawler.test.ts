/** Unit & behavioral tests for Old Mother's active multi-phase boss fight and exposed Stern Engine. */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import type { MissileTarget } from '../../core/gameplay';
import { PANS } from '../../world/map/holdfast/plan';
import { CRAWLER, CrawlerState, OldMother } from './crawler';

function makeMockCtx() {
  let nextHandle = 1;
  const colliders = new Map<number, { handle: number; pos: THREE.Vector3; rot: THREE.Quaternion; removed: boolean }>();
  const signals: string[] = [];
  const feeds: string[] = [];
  const follows: { label: string; color: string }[] = [];
  const playerDamage: { amount: number; source: string; type: string }[] = [];
  const playerPushes: THREE.Vector3[] = [];
  const explosions: THREE.Vector3[] = [];
  const sounds: string[] = [];
  const loops: string[] = [];
  const scene = new THREE.Scene();

  const ctx = {
    time: { elapsed: 0, dt: 0.016 },
    render: {
      scene,
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
    },
    physics: {
      addStaticBox: (pos: THREE.Vector3) => {
        const handle = nextHandle++;
        const rec = { handle, pos: pos.clone(), rot: new THREE.Quaternion(), removed: false };
        colliders.set(handle, rec);
        return {
          handle,
          setTranslation: (v: THREE.Vector3) => rec.pos.copy(v),
          setRotation: (q: THREE.Quaternion) => rec.rot.copy(q),
        };
      },
      world: {
        removeCollider: (c: { handle: number }) => {
          const rec = colliders.get(c.handle);
          if (rec) rec.removed = true;
        },
      },
    },
    player: {
      position: new THREE.Vector3(-90, 0, 15),
      eye: new THREE.Vector3(-90, 4.2, 15),
      velocity: new THREE.Vector3(),
      alive: true,
      takeDamage: (d: { amount: number; source: string; type: string }) => playerDamage.push(d),
      push: (v: THREE.Vector3) => playerPushes.push(v.clone()),
    },
    audio: {
      play: (id: string) => sounds.push(id),
      startLoop: (id: string) => {
        loops.push(id);
        return { alive: true, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn(), stop: vi.fn() };
      },
    },
    fx: {
      explosion: (p: THREE.Vector3) => explosions.push(p.clone()),
      chips: vi.fn(),
      embers: vi.fn(),
      smoke: vi.fn(),
      dust: vi.fn(),
      slam: vi.fn(),
      ring: vi.fn(),
      flame: vi.fn(),
      heatShimmer: vi.fn(),
      muzzleFlash: vi.fn(),
      tracer: vi.fn(),
    },
    hud: {
      hitMarker: vi.fn(),
      feed: (text: string) => feeds.push(text),
      follow: (_at: THREE.Vector3, label: string, color: string) => {
        follows.push({ label, color });
        return () => {};
      },
    },
    camera: { addTrauma: vi.fn() },
    campaign: { signal: (s: string) => signals.push(s) },
    progression: { award: vi.fn() },
    combat: { spawnProjectile: vi.fn() },
  } as unknown as Ctx;

  return { ctx, colliders, signals, feeds, follows, playerDamage, playerPushes, explosions, sounds, loops, scene };
}

describe('CrawlerState (Old Mother)', () => {
  it('ignores damage while dormant and starts full speed in hunt', () => {
    const s = new CrawlerState();
    expect(s.hit('trackL', 500).dealt).toBe(0);
    s.phase = 'hunt';
    expect(s.tracksAlive).toBe(2);
    expect(s.speed).toBe(CRAWLER.speedFull);
    expect(s.barFraction()).toBe(1);
  });

  it('slows when one track breaks and enters enraged drag phase when both tracks break', () => {
    const s = new CrawlerState();
    s.phase = 'hunt';

    const h1 = s.hit('trackL', CRAWLER.hp.trackL);
    expect(h1.broke).toBe(true);
    expect(h1.phaseChanged).toBeNull();
    expect(s.tracksAlive).toBe(1);
    expect(s.speed).toBe(CRAWLER.speedCrippled);

    const h2 = s.hit('trackR', CRAWLER.hp.trackR);
    expect(h2.broke).toBe(true);
    expect(h2.phaseChanged).toBe('drag');
    expect(s.phase).toBe('drag');
    expect(s.speed).toBe(0);
  });

  it('immediately exposes the Stern Engine (deck phase) once weapons are stripped or drag timer expires', () => {
    const s = new CrawlerState();
    s.phase = 'drag';
    s.hp.trackL = 0;
    s.hp.trackR = 0;

    s.hit('turretF', CRAWLER.hp.turretF);
    s.hit('turretA', CRAWLER.hp.turretA);
    expect(s.phase).toBe('drag');
    expect(s.engineExposed).toBe(false);

    const last = s.hit('launcher', CRAWLER.hp.launcher);
    expect(last.phaseChanged).toBe('deck');
    expect(s.phase).toBe('deck');
    expect(s.engineExposed).toBe(true);

    // Timeout path in drag also opens Stern Engine directly
    const s2 = new CrawlerState();
    s2.phase = 'drag';
    expect(s2.tickDrag(10)).toBe(false);
    expect(s2.tickDrag(CRAWLER.dragMaxSeconds)).toBe(true);
    expect(s2.phase).toBe('deck');
    expect(s2.engineExposed).toBe(true);
  });

  it('protects the stern engine until exposed, then dies when engine breaks', () => {
    const s = new CrawlerState();
    s.phase = 'hunt';
    expect(s.hit('engine', 500).dealt).toBe(0);

    s.phase = 'deck';
    expect(s.barFraction()).toBe(1);
    const partial = s.hit('engine', CRAWLER.hp.engine / 2);
    expect(partial.dealt).toBe(CRAWLER.hp.engine / 2);
    expect(partial.broke).toBe(false);
    expect(s.barFraction()).toBeCloseTo(0.5);

    const kill = s.hit('engine', CRAWLER.hp.engine);
    expect(kill.broke).toBe(true);
    expect(kill.phaseChanged).toBe('dead');
    expect(s.phase).toBe('dead');
    expect(s.barFraction()).toBe(0);
  });
});

describe('OldMother active combat, exposed Stern Engine & chain detonation', () => {
  it('stays dangerous in Phase 2 (drag) with thruster lunges, mortar rings, steam vents, and hull casemates', () => {
    const m = makeMockCtx();
    const mother = new OldMother(m.ctx, null);
    mother.startFight();
    mother.position.set(-90, 0, -10);
    mother.yaw = 0;

    // Wreck both tracks to enter active Phase 2 (`drag`)
    const trackL = { handle: 2 } as never;
    const trackR = { handle: 3 } as never;
    mother.direct(trackL, mother.position, CRAWLER.hp.trackL, 'rocket', 'frame_howitzer');
    mother.direct(trackR, mother.position, CRAWLER.hp.trackR, 'rocket', 'frame_howitzer');
    expect(mother.state.phase).toBe('drag');
    expect(m.signals).toContain('mother:drag');

    // Place player 35 m ahead so thruster lunge & mortar barrage trigger cleanly
    m.ctx.player.position.set(-90, 0, 25);
    m.ctx.player.eye.set(-90, 4.2, 25);
    const startPos = mother.position.clone();

    for (let i = 0; i < 160; i++) {
      m.ctx.time.elapsed += 0.05;
      mother.update(0.05);
    }

    // Old Mother moved via auxiliary thruster lunge and stayed within PANS bounds
    expect(mother.position.distanceTo(startPos)).toBeGreaterThan(4);
    expect(mother.position.x).toBeGreaterThanOrEqual(PANS.x0);
    expect(mother.position.x).toBeLessThanOrEqual(PANS.x1);
    expect(mother.position.z).toBeGreaterThanOrEqual(PANS.z0);
    expect(mother.position.z).toBeLessThanOrEqual(PANS.z1);

    // Mortar rings & thruster lunge telegraphed in feed and mortar detonations fired
    expect(m.feeds.some(f => f.includes('MORTAR BARRAGE'))).toBe(true);
    expect(m.feeds.some(f => f.includes('THRUSTER LUNGE'))).toBe(true);
    expect(m.explosions.length).toBeGreaterThan(0);

    // Move player right up against her hull -> triggers superheated steam vent!
    m.ctx.player.position.copy(mother.position).add(new THREE.Vector3(6, 0, 0));
    m.ctx.player.eye.copy(m.ctx.player.position).setY(3.8);
    for (let i = 0; i < 60; i++) {
      m.ctx.time.elapsed += 0.05;
      mother.update(0.05);
    }
    expect(m.feeds.some(f => f.includes('STEAM VENT'))).toBe(true);
    expect(m.playerDamage.some(d => d.source === 'crawler_steam')).toBe(true);
    expect(m.playerPushes.length).toBeGreaterThan(0);

    mother.dispose();
  });

  it('blows open an unmistakable Stern Engine destroyable by 105mm Howitzer or bullets, then chain-detonates', () => {
    const m = makeMockCtx();
    const mother = new OldMother(m.ctx, null);
    mother.startFight();
    mother.position.set(-90, 0, -10);
    mother.yaw = 0;

    // Destroy tracks + outer weapons -> Stern Engine blows open immediately
    for (const handle of [2, 3, 4, 5, 6]) {
      mother.direct({ handle } as never, mother.position, 2000, 'rocket', 'frame_howitzer');
    }
    expect(mother.state.phase).toBe('deck');
    expect(mother.engineExposed).toBe(true);
    expect(m.signals).toContain('mother:exposed');
    expect(m.follows.some(f => f.label === 'STERN ENGINE — DESTROY')).toBe(true);
    expect(m.loops).toContain('alarm_klaxon');

    // Engine is paintable by Frame missiles while exposed
    const targets: MissileTarget[] = [];
    mother.paintable(targets);
    expect(targets.length).toBe(1);
    expect(targets[0]!.alive).toBe(true);

    // Both on-foot bullets and 105mm Howitzer blasts/direct hits damage the Stern Engine cleanly
    const engineCollider = { handle: 7 } as never;
    const engWorld = mother.localToWorld(0, 7.6, -11.6);
    const hpBefore = mother.state.hp.engine;
    expect(mother.shot(engineCollider, engWorld, 120, 'autocannon')).toBe(true);
    expect(mother.state.hp.engine).toBe(hpBefore - 120);

    const blastHits = mother.blast(engWorld, {
      radius: 8,
      damage: 400,
      kind: 'shell',
      source: 'frame_howitzer',
      team: 'player',
    });
    expect(blastHits).toBe(1);
    expect(mother.state.hp.engine).toBeLessThan(hpBefore - 500);

    // Finish off the Stern Engine with a 105mm Howitzer direct hit!
    const preKillExplosions = m.explosions.length;
    mother.direct(engineCollider, engWorld, 1500, 'shell', 'frame_howitzer');
    expect(mother.state.phase).toBe('dead');
    expect(m.signals).toContain('mother:engine');
    expect(m.signals).toContain('mother:destroyed');

    // Stepping update advances the multi-stage chain detonation across the hull
    for (let i = 0; i < 40; i++) {
      m.ctx.time.elapsed += 0.05;
      mother.update(0.05);
    }
    expect(m.explosions.length).toBeGreaterThanOrEqual(preKillExplosions + 5);

    // Backward compatibility helpers still return valid coordinates
    expect(mother.deckLandingPoint().y).toBeCloseTo(CRAWLER.deckY + 0.35);
    expect(mother.harbourmasterPoint().y).toBeCloseTo(CRAWLER.deckY);
    mother.enterDeck(true);
    expect(mother.state.phase).toBe('deck');

    mother.dispose();
  });

  it('explodes into 18-26 physical debris chunks, hides intact hull, clears colliders, and cleans up on hide/dispose', () => {
    const m = makeMockCtx();
    const mother = new OldMother(m.ctx, null);
    mother.enterDeck(true);
    mother.position.set(-90, 0, -10);
    mother.yaw = 0.35;
    mother.update(0.016);

    const childrenBeforeKill = m.scene.children.length;
    const engineCollider = { handle: 7 } as never;
    const engWorld = mother.localToWorld(0, 7.6, -11.6);

    // Destroy the exposed Stern Engine -> catastrophic breakup!
    mother.direct(engineCollider, engWorld, CRAWLER.hp.engine * 2, 'shell', 'frame_howitzer');
    expect(mother.state.phase).toBe('dead');
    expect(mother.root.visible).toBe(false);

    // Static hull and part colliders are parked far underground; deck colliders are removed.
    expect(m.colliders.get(1)!.pos.y).toBeLessThan(-500);
    for (let h = 2; h <= 7; h++) {
      expect(m.colliders.get(h)!.pos.y).toBeLessThan(-500);
    }
    const deckColliders = [...m.colliders.values()].filter(c => c.handle > 7);
    expect(deckColliders.length).toBeGreaterThan(0);
    expect(deckColliders.every(c => c.removed)).toBe(true);

    // 18-26 debris chunks spawned into the scene.
    expect(mother.debrisCount).toBeGreaterThanOrEqual(18);
    expect(mother.debrisCount).toBeLessThanOrEqual(26);
    expect(m.scene.children.length).toBe(childrenBeforeKill + mother.debrisCount);

    // Snapshot initial debris positions, then simulate 1.5s -> chunks must fly outward and tumble.
    const debrisMeshes = m.scene.children.slice(childrenBeforeKill);
    const initialPos = debrisMeshes.map(o => o.position.clone());
    for (let i = 0; i < 30; i++) {
      m.ctx.time.elapsed += 0.05;
      mother.update(0.05);
    }
    const movedCount = debrisMeshes.filter((o, i) => o.position.distanceTo(initialPos[i]!) > 3).length;
    expect(movedCount).toBeGreaterThanOrEqual(15);

    // hide() cleanly removes and disposes every debris chunk from the scene.
    mother.hide();
    expect(mother.debrisCount).toBe(0);
    expect(m.scene.children.length).toBe(childrenBeforeKill);

    mother.dispose();
  });
});

