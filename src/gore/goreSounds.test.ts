import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
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
  it('registers all 9 gore3 sound ids as non-critical 3D world sounds', () => {
    const ids = [
      'flesh_bullet_impact',
      'flesh_bullet_hard',
      'torso_gib',
      'blood_spritz',
      'blood_dribble',
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
    expect(lookup('flesh_bullet_impact')!.files!.length).toBe(9);
    expect(lookup('torso_gib')!.files!.length).toBe(3);
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
});
