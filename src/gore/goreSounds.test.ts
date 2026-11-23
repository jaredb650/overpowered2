import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { lookup } from '../audio/catalog';
import { HumanoidBone } from '../characters/rig';
import { type AudioSystem, type PlayOptions } from '../core/contracts';
import { makeRange } from '../weapons/testkit';

interface RecordedPlay {
  id: string;
  position: THREE.Vector3 | undefined;
  volume: number;
}

describe('positional gore3 body sounds', () => {
  it('registers all 12 gore3 sound ids as non-critical 3D world sounds', () => {
    const ids = [
      'flesh_bullet_impact',
      'flesh_bullet_hard',
      'torso_gib',
      'head_burst',
      'skull_fragments',
      'blood_spritz',
      'blood_dribble',
      'blood_spray_jet',
      'blood_spray_long',
      'blood_spray_short',
      'blood_splash',
      'blood_squish',
    ];
    for (const id of ids) {
      const def = lookup(id);
      expect(def, id).toBeDefined();
      expect(def!.critical, id).toBe(false);
      expect(def!.near, id).toBeGreaterThan(0);
      expect(def!.far, id).toBeGreaterThan(def!.near);
    }
    const impactFiles = lookup('flesh_bullet_impact')!.files!;
    expect(impactFiles.length).toBe(7);
    expect(impactFiles).not.toContain('gore3/bullet_impact_1.mp3');
    expect(impactFiles).not.toContain('gore3/bullet_impact_5.mp3');
    expect(lookup('blood_spritz')!.file).toBe('gore3/blood_spritz_1.mp3');
    expect(lookup('blood_spritz')!.files).toBeUndefined();
    expect(lookup('torso_gib')!.files!.length).toBe(3);
    expect(lookup('head_burst')!.files!.length).toBe(5);
    expect(lookup('blood_spray_jet')!.files!.length).toBe(4);
    expect(lookup('blood_dribble')!.files!.length).toBe(6);
    // blood_spray_long stays significantly quieter than before (level 0.06 / loudness 0.199 ~= 0.30).
    expect(lookup('blood_spray_long')!.volume).toBeLessThan(0.35);
  });

  it('plays positional 3D flesh bullet impacts and spritz on live body hits (normal and heavy)', async () => {
    const r = await makeRange();
    const plays: RecordedPlay[] = [];
    r.ctx.audio = {
      play: (id: string, o: PlayOptions = {}) => {
        plays.push({ id, position: o.position?.clone(), volume: o.volume ?? 1 });
      },
      playOneOf: () => {},
    } as unknown as AudioSystem;

    const a = r.enemies.add(0, -10, 200);
    const pt = a.center.clone();
    const up = new THREE.Vector3(0, 0, 1);
    const dir = new THREE.Vector3(0, 0, -1);

    const light = r.combat.strikeOptions('bullet', 'smg');
    r.combat.strike(a, pt, up, dir, HumanoidBone.chest, 'chest', 20, light);

    const lightImpact = plays.find(p => p.id === 'flesh_bullet_impact');
    const spritz = plays.find(p => p.id === 'blood_spritz');
    expect(lightImpact).toBeDefined();
    expect(lightImpact!.position).toBeDefined();
    expect(spritz).toBeDefined();
    expect(spritz!.position).toBeDefined();

    plays.length = 0;
    const heavy = r.combat.strikeOptions('pellet', 'shotgun');
    heavy.force = 35;
    r.combat.strike(a, pt, up, dir, HumanoidBone.chest, 'chest', 60, heavy);

    const hardImpact = plays.find(p => p.id === 'flesh_bullet_hard');
    expect(hardImpact).toBeDefined();
    expect(hardImpact!.position).toBeDefined();
  });

  it('plays head_burst, skull_fragments, and blood_spray_jet on head bursts while keeping blood_spray_long rare and quiet', async () => {
    const { Physics } = await import('../physics/Physics');
    const { makeCtx } = await import('../sandbox/harness');
    const { humanoidRig } = await import('../characters/rig');
    const { createGoreSystem } = await import('./index');
    const { TestDummy } = await import('./testDummy');

    const physics = await Physics.create();
    const scene = new THREE.Scene();
    const plays: RecordedPlay[] = [];
    const ctx = makeCtx({
      physics,
      render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as import('../core/contracts').Ctx['render'],
      fx: new Proxy({}, { get: () => () => null }) as unknown as import('../core/contracts').Ctx['fx'],
      audio: {
        play: (id: string, o: PlayOptions = {}) => {
          plays.push({ id, position: o.position?.clone(), volume: o.volume ?? 1 });
        },
        playOneOf: () => {},
      } as unknown as AudioSystem,
    });
    const gore = createGoreSystem(ctx);
    gore.init();

    const makeDummy = (x: number) => {
      const char = new TestDummy(humanoidRig('human'));
      char.root.position.set(x, 0, 0);
      scene.add(char.root);
      char.root.updateMatrixWorld(true);
      return char;
    };

    const dmg = (pt: THREE.Vector3) => ({
      amount: 200,
      type: 'bullet' as const,
      point: pt,
      dir: new THREE.Vector3(0, 0, -1),
      force: 40,
      source: 'sabot',
      bone: HumanoidBone.head,
      region: 'head' as const,
    });

    // Normal roll (0.4): head_burst + skull_fragments + blood_spray_jet, no blood_spray_long.
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.4);
    try {
      ctx.time.tick(1 / 60);
      const a = makeDummy(0);
      gore.headshot(a, dmg(a.root.position.clone().setY(1.6)), undefined, 'burst');

      expect(plays.find(p => p.id === 'head_burst')).toBeDefined();
      expect(plays.find(p => p.id === 'skull_fragments')).toBeDefined();
      expect(plays.find(p => p.id === 'blood_spray_jet')).toBeDefined();
      expect(plays.find(p => p.id === 'blood_spray_long')).toBeUndefined();

      const advance = (seconds: number) => {
        for (let t = 0; t < seconds; t += 0.05) ctx.time.tick(0.05);
      };

      // Rare roll (0.05) after stump cooldown: blood_spray_long plays once at reduced volume,
      // then stays gated for 12s while blood_spray_jet covers subsequent stumps.
      rng.mockReturnValue(0.05);
      plays.length = 0;
      advance(3.0);
      const b = makeDummy(2);
      gore.headshot(b, dmg(b.root.position.clone().setY(1.6)), undefined, 'burst');
      const longPlay = plays.find(p => p.id === 'blood_spray_long');
      expect(longPlay).toBeDefined();
      expect(longPlay!.volume).toBeLessThanOrEqual(0.56);

      plays.length = 0;
      advance(3.0); // only 3s since lastLongSpray (< 12s cooldown)
      const c = makeDummy(4);
      gore.headshot(c, dmg(c.root.position.clone().setY(1.6)), undefined, 'burst');
      expect(plays.find(p => p.id === 'blood_spray_long')).toBeUndefined();
      expect(plays.find(p => p.id === 'blood_spray_jet')).toBeDefined();
    } finally {
      rng.mockRestore();
      gore.clear();
    }
  });
});
