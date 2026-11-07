import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/math';
import type { AiWorld } from '../aiWorld';
import { aimRound, TargetTrack } from './aim';
import { RANKS, type Rank } from './rank';

const SPEED = 88;
const RANGE = 25;
const WIDTH = 0.45;

/** Share of rounds from a man `RANGE` metres off that pass close enough to hit, with the target going sideways at `speed`. */
function hitRate(rank: Rank, speed: number, turnEvery = 0): number {
  const random = Math.random;
  Math.random = mulberry32(5);
  const from = new THREE.Vector3(0, 1.4, 0);
  const player = { chest: new THREE.Vector3(0, 1, RANGE), velocity: new THREE.Vector3(speed, 0, 0), evasion: Math.min(speed / 11.5, 1) };
  const w = { player } as unknown as AiWorld;
  const track = new TargetTrack();
  const dir = new THREE.Vector3();
  const dt = 1 / 60;
  let hits = 0, shots = 0, clock = 0;
  for (let f = 0; f < 60 * 60; f++) {
    clock += dt;
    if (turnEvery > 0 && clock >= turnEvery) {
      clock = 0;
      player.velocity.x = -player.velocity.x;
    }
    track.update(dt, player.velocity);
    if (f % 6 !== 0) continue;
    aimRound(w, track, from, dir, SPEED, RANKS[rank], 1, 1, 1);
    // Where the target really is by the time the round gets there, turning or not.
    const flight = RANGE / SPEED;
    const at = player.chest.clone().addScaledVector(player.velocity, flight);
    const along = at.clone().sub(from).dot(dir);
    if (from.clone().addScaledVector(dir, along).distanceTo(at) < WIDTH) hits++;
    shots++;
  }
  Math.random = random;
  return hits / shots;
}

describe('aim', () => {
  it('still hits a sprinter in a straight line', () => {
    expect(hitRate('regular', 12)).toBeGreaterThan(0.25);
    expect(hitRate('elite', 12)).toBeGreaterThan(0.7);
  });

  it('is beaten by a change of direction, not by a speed', () => {
    expect(hitRate('veteran', 12, 0.3)).toBeLessThan(hitRate('veteran', 12) * 0.7);
  });

  it('gets better with rank at every speed', () => {
    for (const speed of [0, 6, 12]) {
      expect(hitRate('regular', speed)).toBeGreaterThan(hitRate('conscript', speed));
      expect(hitRate('elite', speed)).toBeGreaterThan(hitRate('regular', speed));
    }
  });
});
