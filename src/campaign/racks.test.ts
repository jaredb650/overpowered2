import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../core/contracts';
import type { ModId, WeaponId } from '../core/gameplay';
import { Racks } from './racks';

function makeCtx() {
  const scene = new THREE.Scene();
  const marker = vi.fn(() => () => {});
  const feed = vi.fn();
  const give = vi.fn();
  const grantMod = vi.fn();
  const fitMod = vi.fn();
  const switchTo = vi.fn();
  const ammoState = { mag: 100, magSize: 200 };
  const ammo = vi.fn(() => ammoState);
  const pickupSparkle = vi.fn();
  const play = vi.fn();
  const playerPos = new THREE.Vector3(20, 0, 20);

  const ctx = {
    render: {
      scene,
      materials: { world: () => new THREE.MeshBasicMaterial() },
    },
    player: { position: playerPos },
    hud: { marker, feed },
    weapons: { give, grantMod, fitMod, switchTo, ammo },
    fx: { pickupSparkle },
    audio: { play },
  } as unknown as Ctx;

  return { ctx, scene, playerPos, marker, feed, give, grantMod, fitMod, switchTo, ammoState, pickupSparkle, play };
}

describe('Racks', () => {
  it('places a HUD marker for normal racks and does not announce SECRET CACHE', () => {
    const h = makeCtx();
    const racks = new Racks(h.ctx);
    const took = vi.fn();
    racks.add('mgl', { at: [0, 0, 0] }, took, undefined, 'RGL');

    expect(h.marker).toHaveBeenCalledTimes(1);
    h.playerPos.set(0, 0, 0);
    racks.update(0.016);

    expect(h.give).toHaveBeenCalledWith('mgl');
    expect(h.switchTo).toHaveBeenCalledWith('mgl');
    expect(h.feed).not.toHaveBeenCalled();
    expect(took).toHaveBeenCalledTimes(1);
  });

  it('omits HUD marker for hidden racks, fits all mods, tops off mag, and announces SECRET CACHE on pickup', () => {
    const h = makeCtx();
    const racks = new Racks(h.ctx);
    const took = vi.fn();
    const mods: ModId[] = ['flailHeavy', 'flailAp', 'flailStock', 'flailHolo', 'flailLam', 'flailBox', 'flailBolt'];

    racks.add('flail' as WeaponId, { at: [-44, 0, -51] }, took, mods, 'Flail Custom', true);
    expect(h.marker).not.toHaveBeenCalled();

    h.playerPos.set(-44, 0, -51);
    racks.update(0.016);

    expect(h.give).toHaveBeenCalledWith('flail');
    for (const m of mods) {
      expect(h.grantMod).toHaveBeenCalledWith(m);
      expect(h.fitMod).toHaveBeenCalledWith(m, true);
    }
    expect(h.ammoState.mag).toBe(200);
    expect(h.switchTo).toHaveBeenCalledWith('flail');
    expect(h.feed).toHaveBeenCalledWith('SECRET CACHE: Flail Custom', '#ffc14a');
    expect(took).toHaveBeenCalledTimes(1);
  });
});
