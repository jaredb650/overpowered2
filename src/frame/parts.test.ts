/** Unit tests for the Distraint Frame's locational damage, armour bounce, rear reactor weak point, leg limps, pod loss, and canopy cracks. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FRAME_PARTS, FrameParts } from './parts';

const FEET = new THREE.Vector3(0, 0, 0);
/** Camera yaw = 0 faces -Z (forward = (0,0,-1), right = (1,0,0), behind = (0,0,+1)). */
const YAW = 0;

describe('FrameParts', () => {
  it('starts whole with full hull, both legs, rocket pod online, and intact canopy', () => {
    const p = new FrameParts();
    expect(p.hp).toBe(FRAME_PARTS.hull);
    expect(p.alive).toBe(true);
    expect(p.speedScale).toBe(1);
    expect(p.limpSide).toBe(0);
    expect(p.podOnline).toBe(true);
    expect(p.cracks).toBe(0);
  });

  it('bounces small arms fire below the threshold with zero hull damage', () => {
    const p = new FrameParts();
    const res = p.hit({ amount: 18, type: 'bullet', source: 'trooper_rifle', from: new THREE.Vector3(0, 3.5, -15) }, FEET, YAW);
    expect(res.blocked).toBe(true);
    expect(res.dealt).toBe(0);
    expect(p.hp).toBe(FRAME_PARTS.hull);
  });

  it('applies 2.5x damage multiplier on rear reactor hits', () => {
    const p = new FrameParts();
    const res = p.hit({ amount: 200, type: 'explosive', source: 'enemy_rocket', from: new THREE.Vector3(0, 3.5, 18) }, FEET, YAW);
    expect(res.part).toBe('reactor');
    expect(res.dealt).toBe(Math.round(200 * FRAME_PARTS.rearMult));
    expect(p.hp).toBe(FRAME_PARTS.hull - res.dealt);
    expect(p.rearFlash).toBe(1);
  });

  it('cripples speed and reports limpSide when legs break', () => {
    const p = new FrameParts();
    let broke: string | null = null;
    for (let i = 0; i < 4; i++) {
      const r = p.hit({ amount: 300, type: 'explosive', source: 'sapper', from: new THREE.Vector3(-4, 1.0, -4) }, FEET, YAW);
      if (r.broke) broke = r.broke;
    }
    expect(broke).toBe('leftLeg');
    expect(p.leftLeg).toBe(0);
    expect(p.speedScale).toBe(FRAME_PARTS.speedOneLeg);
    expect(p.limpSide).toBe(-1);

    for (let i = 0; i < 4; i++) {
      p.hit({ amount: 300, type: 'explosive', source: 'sapper', from: new THREE.Vector3(4, 1.0, -4) }, FEET, YAW);
    }
    expect(p.rightLeg).toBe(0);
    expect(p.speedScale).toBe(FRAME_PARTS.speedNoLegs);
    expect(p.limpSide).toBe(0);
  });

  it('disables the shoulder rocket pod when high right hits break it', () => {
    const p = new FrameParts();
    let broke: string | null = null;
    for (let i = 0; i < 3; i++) {
      const r = p.hit({ amount: 220, type: 'explosive', source: 'enemy_rocket', from: new THREE.Vector3(10, 5.4, -6) }, FEET, YAW);
      if (r.broke) broke = r.broke;
    }
    expect(broke).toBe('pod');
    expect(p.podOnline).toBe(false);
    expect(p.pod).toBe(0);
  });

  it('cracks the canopy glass up to 3 stages on sniper rounds', () => {
    const p = new FrameParts();
    for (let i = 1; i <= 4; i++) {
      const r = p.hit({ amount: 45, type: 'bullet', source: 'sniper', from: new THREE.Vector3(0, 4.8, -30) }, FEET, YAW);
      expect(r.cracked).toBe(i <= 3);
      expect(p.cracks).toBe(Math.min(3, i));
    }
  });

  it('resets cleanly back to full integrity', () => {
    const p = new FrameParts();
    p.hit({ amount: 1200, type: 'explosive', source: 'tank', from: new THREE.Vector3(0, 3.5, 18) }, FEET, YAW);
    p.hit({ amount: 45, type: 'bullet', source: 'sniper', from: new THREE.Vector3(0, 4.8, -30) }, FEET, YAW);
    p.reset();
    expect(p.hp).toBe(FRAME_PARTS.hull);
    expect(p.cracks).toBe(0);
    expect(p.podOnline).toBe(true);
    expect(p.speedScale).toBe(1);
  });
});
