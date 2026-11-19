/**
 * A player's shots as the others see and hear them. Every local shot goes out as `fire`; the host checks a guest's (it left
 * their body, at a rate their gun allows: authority.ts), draws it and passes it on; a guest draws what the host sends.
 * Drawing is a tracer, a muzzle flash and the gun's sounds from the friend's own gun. The shot counter also numbers hit claims
 * (hits.ts). Gun Kata's notice is here too: it opens the host's fire-rate check for the burst.
 */
import * as THREE from 'three';
import { CG } from '../../core/contracts';
import type { WeaponId } from '../../core/gameplay';
import { WEAPONS } from '../../weapons/data';
import { isMelee } from '../../weapons/melee/data';
import type { WorldContext } from './context';
import { validVec, type Vec } from './wire';

/** `ak`: from two guns (the akimbo mod), so the host allows twice the gun's rate. `slot` is stamped by the host. */
export type FireEvent = { t: 'fire'; shot: number; weapon: string; origin: Vec; dir: Vec; slot?: number; ak?: 1 };
/** Guest to host: my Gun Kata brain chip went. Its burst outruns the gun's rate for `KATA.window` s (authority.ts `kata`). */
export type KataEvent = { t: 'kata' };

export class RemoteFire {
  /** The number of the local player's latest shot, which their hit claims carry. */
  shot = 0;
  /** When and with what the local player last sent a shot. */
  firedAt = -Infinity;
  weapon = '';

  constructor(private readonly w: WorldContext) {
    w.listen('weapon:fired', event => this.fire(event.weapon, event.origin, event.dir));
    // A guest's Gun Kata: the host lets its burst through the fire-rate check (authority.ts `kata`).
    if (!w.hosting) w.listen('chip:kata', () => w.send({ t: 'kata' }));
    w.router.host('fire', (value, from, now) => this.fireIn(value, from, now));
    w.router.guest('fire', value => this.draw(value));
    w.router.host('kata', (_value, from, now) => { if (w.sender(from, now)) w.validator.kata(from, now); });
  }

  /** The local player fired: tell the others. Twice within 20 ms from one gun is one shot. */
  fire(weapon: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const { ctx, session } = this.w;
    if (!ctx.player.alive) return;
    const now = performance.now();
    if (now - this.firedAt < 20 && weapon === this.weapon) return;
    this.shot++;
    this.firedAt = now;
    this.weapon = weapon;
    this.w.send({ t: 'fire', shot: this.shot, weapon, origin: origin.toArray() as Vec, dir: dir.toArray() as Vec,
      slot: session.lobby.me?.slot, ...(ctx.weapons.akimbo ? { ak: 1 as const } : {}) });
  }

  /** Host: a guest's shot, checked, drawn here and passed on to the other guests. */
  private fireIn(value: FireEvent, from: string, now: number): void {
    const remote = this.w.sender(from, now);
    if (!remote) return;
    const eye = remote.char.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    if (validVec(value.origin) && validVec(value.dir) && new THREE.Vector3(...value.origin).distanceTo(eye) < 7
      && !this.w.life(from).down && this.w.validator.acceptFire(from, value.shot, value.weapon, now, value.ak === 1)) {
      const event = { ...value, slot: remote.player.slot };
      this.draw(event);
      this.w.relay(event, from);
    }
  }

  private draw(event: FireEvent): void {
    const { ctx, session } = this.w;
    if (!validVec(event.origin) || !validVec(event.dir) || !Object.hasOwn(WEAPONS, event.weapon)) return;
    const def = WEAPONS[event.weapon as WeaponId];
    const origin = new THREE.Vector3(...event.origin), dir = new THREE.Vector3(...event.dir).normalize();
    const wall = ctx.physics.raycast(origin, dir, 100, CG.World);
    const end = wall?.point ?? origin.clone().addScaledVector(dir, 100);
    const remote = [...session.remotes.values()].find(remote => remote.player.slot === event.slot);
    // Flash and tracer leave the friend's own gun; the shot itself is still traced from their eye, as they aimed it.
    const muzzle = remote ? remote.muzzle(new THREE.Vector3()) : origin;
    if (!isMelee(event.weapon) && !/^sword/.test(event.weapon)) {
      ctx.fx.tracer(muzzle, end, 'bullet');
      ctx.fx.muzzleFlash(muzzle, dir, def.muzzle);
    }
    // Positional: a friend's gun is heard from where they stand.
    for (const sound of def.sounds) ctx.audio.play(sound.id, { ...sound, position: muzzle, volume: (sound.volume ?? 1) * 0.65 });
    remote?.char.anim.play('shoot', 1.4);
  }
}
