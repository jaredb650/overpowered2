/**
 * `EnemyManager.focus`: on a co-op host, what the enemy side does outside one enemy's own update is done about the player it
 * concerns, by pointing the AI's picture of "the player" at them. Alone there is one player and it does nothing.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Ctx, PlayerSystem } from '../core/contracts';
import { makeCtx } from '../sandbox/harness';
import type { AiWorld } from './aiWorld';
import { EnemyManager } from './EnemyManager';

const body = (x: number, speed = 0): PlayerSystem => ({
  position: new THREE.Vector3(x, 0, 0), eye: new THREE.Vector3(x, 1.6, 0), velocity: new THREE.Vector3(speed, 0, 0), forward: new THREE.Vector3(0, 0, -1),
  grounded: true, alive: true,
} as unknown as PlayerSystem);

function game(coop: boolean, hosting = true) {
  const host = body(0);
  const guest = body(50, 9);
  const ctx = makeCtx({ player: host });
  (ctx as { progression: unknown }).progression = { isActive: () => false };
  const world = { targetPlayer: null as PlayerSystem | null, ghosted: (p: PlayerSystem) => p === guest, me: host };
  if (coop) (ctx as { coop: unknown }).coop = { world, hosting };
  const manager = new EnemyManager(ctx as Ctx);
  const w = (manager as unknown as { w: AiWorld }).w;
  return { manager, w, host, guest, world };
}

describe('pointing the enemy side at one player', () => {
  it('on a co-op host, "the player" becomes the one named, in both of the places the AI reads it', () => {
    const g = game(true);
    g.manager.focus(g.guest);
    expect(g.w.player.position.x).toBe(50);
    expect(g.w.player.chest.y).toBe(1);
    expect(g.w.player.speed).toBe(9);
    expect(g.w.ctx.player).toBe(g.guest);
    // A friend's Ghost is their own, not the host's perks.
    expect(g.w.player.ghost).toBe(true);
  });

  it('null, or the host\'s own player, puts the host back', () => {
    const g = game(true);
    g.manager.focus(g.guest);
    g.manager.focus(null);
    expect(g.w.player.position.x).toBe(0);
    expect(g.w.ctx.player).toBe(g.host);
    expect(g.w.player.ghost).toBe(false);
    g.manager.focus(g.guest);
    g.manager.focus(g.host);
    expect(g.world.targetPlayer).toBeNull();
    expect(g.w.player.position.x).toBe(0);
  });

  it('alone, and on a guest, it does nothing at all', () => {
    for (const g of [game(false), game(true, false)]) {
      g.w.player.position.set(7, 0, 7);
      g.manager.focus(g.guest);
      expect(g.w.player.position.x).toBe(7);
      expect(g.world.targetPlayer).toBeNull();
      expect(g.w.ctx.player).toBe(g.host);
    }
  });
});
