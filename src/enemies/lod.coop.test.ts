/**
 * The level of detail an enemy is animated and drawn at. On a co-op host the AI's `e.dist` and `e.inView` are measured from
 * the player the enemy is after; what the host sees must go by the host's own eye, or an enemy beside the host that hunts a
 * far guest moves at the far, skipped-frame rate (review-game, finding 5).
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { archetypeById, rigFor } from '../characters/archetypes';
import type { CharacterInstance, Ctx } from '../core/contracts';
import type { EnemyId } from '../core/gameplay';
import { makeCtx } from '../sandbox/harness';
import type { Enemy } from './Enemy';
import { EnemyManager } from './EnemyManager';

function character(id: EnemyId) {
  const rig = rigFor(archetypeById(id));
  const root = new THREE.Group();
  new THREE.Scene().add(root);
  const bones = rig.bones.map(() => new THREE.Bone());
  rig.bones.forEach((def, i) => (def.parent >= 0 ? bones[def.parent]! : root).add(bones[i]!));
  const anim = { flinch: vi.fn(), stumble: vi.fn(), play: vi.fn(), setLocomotion: vi.fn(), update: vi.fn() };
  const setLod = vi.fn();
  const char = { archetype: id, rig, root, bones, severed: new Set(), anim, hitFlash: vi.fn(), setBloodiness: vi.fn(), isFractured: () => false,
    attachProp: (bone: number, prop: THREE.Object3D) => bones[bone]!.add(prop), release: vi.fn(), setLod } as unknown as CharacterInstance;
  return { char, anim, setLod };
}

function game(coop: unknown) {
  const player = { position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    grounded: true, alive: true, sliding: false, wallRunning: false, speed: 0 };
  const made: ReturnType<typeof character>[] = [];
  const ctx = makeCtx({
    player: player as unknown as Ctx['player'],
    characters: { spawn: (id: EnemyId) => { const c = character(id); made.push(c); return c.char; } } as unknown as Ctx['characters'],
  });
  (ctx as { progression: unknown }).progression = { isActive: () => false };
  (ctx as { coop: unknown }).coop = coop;
  const manager = new EnemyManager(ctx);
  const animate = (e: Enemy) => (manager as unknown as { animate(e: Enemy, dt: number, aiming: boolean): void }).animate(e, 1 / 60, false);
  return { manager, made, animate, player };
}

/** An enemy three metres in front of this screen's player whose AI numbers say its quarry is 70 m off and looking away. */
function besideMe(g: ReturnType<typeof game>, id: EnemyId = 'husk'): Enemy {
  const e = g.manager.spawn(id, new THREE.Vector3(0, 0, -3))! as Enemy;
  e.dist = 70;
  e.inView = false;
  return e;
}

describe('the level of detail an enemy is drawn at', () => {
  it('alone it is the AI\'s own, as it always was', () => {
    const g = game(undefined);
    const e = besideMe(g);
    g.animate(e);
    expect(e.lod).toBe(3);
    expect(g.made[0]!.anim.update).toHaveBeenLastCalledWith(1 / 60, 3);
    expect(g.made[0]!.setLod).toHaveBeenLastCalledWith(3);
  });

  it('on a co-op host, an enemy beside the host that hunts a far guest is animated at full rate, and the AI keeps its number', () => {
    const g = game({ world: {}, hosting: true });
    const e = besideMe(g);
    g.animate(e);
    expect(e.lod).toBe(3);
    expect(g.made[0]!.anim.update).toHaveBeenLastCalledWith(1 / 60, 0);
    expect(g.made[0]!.setLod).toHaveBeenLastCalledWith(0);
  });

  it('on a co-op host, an enemy far from the host that is on top of a guest is drawn as the far thing it is here', () => {
    const g = game({ world: {}, hosting: true });
    const e = g.manager.spawn('husk', new THREE.Vector3(0, 0, 80))! as Enemy;
    e.dist = 2;
    e.inView = true;
    g.animate(e);
    expect(e.lod).toBe(0);
    // 80 m behind the host: the far level, one more for out of view.
    expect(g.made[0]!.anim.update).toHaveBeenLastCalledWith(1 / 60, 3);
  });

  it('when the host is the one hunted, both numbers agree', () => {
    const g = game({ world: {}, hosting: true });
    const e = g.manager.spawn('husk', new THREE.Vector3(0, 0, -40))! as Enemy;
    e.dist = 40;
    e.inView = true;
    g.animate(e);
    expect(e.lod).toBe(1);
    expect(g.made[0]!.anim.update).toHaveBeenLastCalledWith(1 / 60, 1);
  });

  it('a co-op guest and a session with no world keep the plain rule', () => {
    for (const coop of [{ world: {}, hosting: false }, { world: null, hosting: true }]) {
      const g = game(coop);
      const e = besideMe(g);
      g.animate(e);
      expect(g.made[0]!.anim.update).toHaveBeenLastCalledWith(1 / 60, 3);
    }
  });
});
