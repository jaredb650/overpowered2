/**
 * Guns on the ground, shared (weapons/dropped.ts keeps them and decides; this carries its news). A guest's drop or take goes to
 * the host; the host's word goes to everyone, and to a guest who has just arrived.
 */
import type { WireGun } from '../../weapons/handover';
import type { DroppedGuns } from '../../weapons/dropped';
import type { WorldContext } from './context';

/**
 * A gun on the ground (weapons/dropped.ts).
 * Guest to host: `drop` (my gun, as a kit, with my request number `q` and how far it fell), `take` (that one, by id), `void`
 * (the drop you numbered late: I have that gun back in hand, remove it).
 * Host to all: `add` (with the dropper's `slot` and that guest's request number `q`, the `fall`, and its `age` for a late guest) and
 * `gone` (`to`: the name of who took it). Host to one: `give` (you took it first), `back` (your drop `q` is refused, keep it).
 */
export type GunEvent = {
  t: 'gun'; op: 'drop' | 'take' | 'add' | 'gone' | 'give' | 'back' | 'void';
  id?: number; gun?: WireGun; q?: number; slot?: number; fall?: number; age?: number; to?: string;
};

export class Guns {
  constructor(private readonly w: WorldContext) {
    w.router.both('gun', (value, from) => this.gunIn(value, from));
  }

  private get dropped(): DroppedGuns | undefined {
    return (this.w.ctx.weapons as unknown as { dropped?: DroppedGuns }).dropped;
  }

  /** A dropped gun's news (weapons/dropped.ts): a guest's drop or take goes to the host, the host's word to everyone. */
  send(event: GunEvent, to?: string): void {
    this.w.send(event, to);
  }

  /** Host: a guest's world is up: tell it the guns lying out. */
  catchUp(id: string): void {
    this.dropped?.catchUp(id);
  }

  private gunIn(value: GunEvent, from: string): void {
    // The lobby lets a guest hear only the host (lobby.ts `gameplay`).
    if (!this.w.hosting) return this.dropped?.guestIn(value);
    const remote = this.w.session.remotes.get(from);
    if (remote) this.dropped?.hostIn(value, from, remote.char.root.position, remote.player.name, this.w.session.lobby.players.find(p => p.id === from)?.slot ?? -1);
  }
}
